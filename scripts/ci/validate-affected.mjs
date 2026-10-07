#!/usr/bin/env node
// Proportional validation runner (D0 / D-D0-01). The supported local validation entrypoint — `npm run
// validate:affected` and `npm run ci` both run it — and the executor of an affected plan on GitHub.
//
//   LOCAL = IMPACTED BOUNDARY. FULL HISTORICAL CONTINUITY PROOF = PARALLEL GITHUB GATE.
//
// It derives the changed files, prints the canonical impact map's plan FIRST, then runs only what the plan's
// boundary needs. It never runs the historical C1→L1 mutation universe: in FULL mode it runs a safe local
// preflight and says that the continuity proof belongs on GitHub.
//
//   npm run validate:affected [-- --base <rev>] [-- --head <rev>] [--plan-only] [--with-mutation]
//     --base <rev>      default: merge-base of HEAD and origin/main (else main)
//     --head <rev>      default: the working tree (committed + staged + unstaged + untracked changes)
//     --plan-only       print the plan, run nothing
//     --with-mutation   affected mode only: also run the plan's own mutation families (never any other family)
//
//   node scripts/ci/validate-affected.mjs --execute-plan <plan.json> --os <runner os> --proof-out <file>
//     CI: re-derive the plan from its own files (a stored plan is never trusted), run its steps, write the proof.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describePlan, planFor, validatePlan } from './impact-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args) => execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

/** The checks a FULL-classified change still gets locally: static checks and the CI self-tests. Never mutation. */
const FULL_PREFLIGHT = [
  { id: 'build', npm: ['run', 'build'] },
  { id: 'typecheck', npm: ['run', 'typecheck'] },
  { id: 'lint', npm: ['run', 'lint'] },
  { id: 'verify', npm: ['run', 'verify'] },
  { id: 'ci-self-test', node: ['scripts/ci/impact-map.mjs', '--self-test'] },
  { id: 'classify-self-test', node: ['scripts/ci/classify-changes.mjs', '--self-test'] },
  { id: 'gate-self-test', node: ['scripts/ci/quality-gate.mjs', '--self-test'] },
  { id: 'post-merge-self-test', node: ['scripts/ci/post-merge-mode.mjs', '--self-test'] },
];

function resolveRev(rev) {
  return git('rev-parse', '--verify', '--quiet', `${rev}^{commit}`).trim();
}

/** Changed files between base and head (or the working tree). Throws on any git failure. */
export function changedFiles({ base, head }) {
  let baseSha;
  if (base) baseSha = resolveRev(base);
  else {
    let upstream;
    for (const ref of ['origin/main', 'main']) {
      try {
        upstream = resolveRev(ref);
        break;
      } catch {
        // try the next candidate
      }
    }
    if (!upstream) throw new Error('no base: pass --base <rev> (neither origin/main nor main resolves)');
    baseSha = git('merge-base', 'HEAD', upstream).trim();
  }
  if (head) {
    const headSha = resolveRev(head);
    const mb = git('merge-base', baseSha, headSha).trim();
    return { base: baseSha, head: headSha, files: lines(git('diff', '--name-only', '--no-renames', mb, headSha)) };
  }
  const tracked = lines(git('diff', '--name-only', '--no-renames', baseSha));
  const untracked = lines(git('ls-files', '--others', '--exclude-standard'));
  return { base: baseSha, head: 'WORKTREE', files: [...new Set([...tracked, ...untracked])] };
}

function quote(arg) {
  return /^[\w@./:=-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

/** Run one step; `scratch` holds the disposable acceptance workspaces. Returns true on success. */
function runStep(step, scratch) {
  const args = step.npm ? [...step.npm] : [...step.node];
  if (step.workspace) args.push('--', '--workspace', path.join(scratch, step.workspace));
  const command = `${step.npm ? 'npm' : quote(process.execPath)} ${args.map(quote).join(' ')}`;
  console.log(`\n▶ ${step.id}: ${command}`);
  const started = Date.now();
  const r = spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true });
  const ok = r.status === 0;
  console.log(`${ok ? '✔' : '✖'} ${step.id} (${Math.round((Date.now() - started) / 1000)}s)`);
  return ok;
}

function runSteps(steps) {
  const scratch = mkdtempSync(path.join(process.env.RUNNER_TEMP || tmpdir(), 'qc-validate-'));
  const results = [];
  try {
    for (const step of steps) {
      const ok = runStep(step, scratch);
      results.push({ id: step.id, status: ok ? 'passed' : 'failed' });
      if (!ok) break;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return results;
}

function executePlan(arg) {
  const os = arg('--os');
  const out = arg('--proof-out');
  let stored;
  try {
    stored = JSON.parse(readFileSync(arg('--execute-plan'), 'utf8'));
  } catch {
    console.error('validate-affected: the plan is unreadable (fail closed)');
    process.exit(1);
  }
  const problems = validatePlan(stored);
  if (problems.length || stored.mode !== 'affected') {
    for (const p of problems) console.error(`validate-affected: ${p}`);
    console.error('validate-affected: only a valid affected plan is executed (fail closed)');
    process.exit(1);
  }
  // Execute the steps derived from the map, never the stored ones.
  const plan = planFor(stored.files);
  if (!plan.os.includes(os)) {
    console.error(`validate-affected: ${os} is not a planned OS (${plan.os.join(', ')})`);
    process.exit(1);
  }
  console.log(describePlan(plan));
  const results = runSteps(plan.steps);
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ schema: 'qandeel.affected-proof/v1', os, digest: plan.digest, boundaries: plan.boundaries, steps: results }, null, 2)}\n`);
  if (results.length !== plan.steps.length || results.some((r) => r.status !== 'passed')) process.exit(1);
}

function main(argv) {
  const arg = (name) => (argv.includes(name) ? String(argv[argv.indexOf(name) + 1] ?? '') : '');
  if (argv.includes('--execute-plan')) return executePlan(arg);

  let change;
  let plan;
  try {
    change = changedFiles({ base: arg('--base') || undefined, head: arg('--head') || undefined });
    plan = planFor(change.files);
  } catch (error) {
    change = { base: '?', head: '?', files: [] };
    plan = { ...planFor([]), reasons: [`changed files unavailable (${String(error?.message ?? error).slice(0, 120)}): fail closed`] };
  }
  console.log(`validate:affected — base ${change.base.slice(0, 12)} … head ${change.head === 'WORKTREE' ? 'working tree' : change.head.slice(0, 12)}`);
  console.log(describePlan(plan));

  const withMutation = argv.includes('--with-mutation');
  let steps;
  if (plan.mode === 'full') {
    // Only the safe preflight, plus the tests of the workspaces this change touches directly. Never mutation.
    const touched = [...new Set(change.files.map((f) => /^packages\/([^/]+)\//.exec(f)?.[1]).filter(Boolean))].sort();
    steps = [...FULL_PREFLIGHT, ...touched.map((w) => ({ id: `test:${w}`, npm: ['run', 'test', '--workspace', `@qandeel-company/${w}`] }))];
    console.log('\nThis change is FULL-boundary. The FULL historical continuity proof (Windows + Ubuntu, every workspace test,');
    console.log('every recorded mutation family sharded with parity, acceptance, verifier) runs on GitHub — push the branch and');
    console.log('open / update the pull request (or run the CI workflow manually). It is never run here as a serial local job.');
    console.log(`Local preflight: ${steps.map((s) => s.id).join(' → ')}`);
    if (withMutation) console.log('--with-mutation is ignored in FULL mode: mutation proof for a FULL change belongs to GitHub.');
  } else {
    steps = [...plan.steps];
    if (withMutation && plan.mode === 'affected') steps.push(...plan.mutation.families.map((f) => ({ id: `mutation:${f}`, npm: ['run', `${f}:mutation`] })));
    else if (plan.mode === 'affected') console.log(`\nMutation families ${plan.mutation.families.join(', ')} run in the GitHub affected proof (add --with-mutation to run exactly these locally).`);
  }
  if (argv.includes('--plan-only')) return;
  const results = runSteps(steps);
  const failed = results.find((r) => r.status !== 'passed');
  console.log(`\nvalidate:affected — ${plan.mode.toUpperCase()} — ${failed ? `FAILED at ${failed.id}` : `${results.length} step(s) passed`}`);
  if (plan.mode !== 'docs') console.log('Release rule: a Desktop release candidate needs one green FULL GitHub quality gate on its exact tree.');
  if (failed) process.exit(1);
}

main(process.argv.slice(2));
