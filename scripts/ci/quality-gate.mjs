#!/usr/bin/env node
// CI quality gate (D-R1-07, D-C4-08, D0 / D-D0-01): the one stable, required status. It passes only when every
// job the run's mode requires succeeded AND
//   full     — every recorded mutation of every mutation family ran exactly once on EACH operating system across
//              its shards (proof parity: parallelism never deletes coverage);
//   affected — the plan artifact is readable and is exactly the canonical impact map's plan for its files (and,
//              when given, for the pull request's own diff); every planned OS produced a proof listing exactly
//              the planned steps, all passed, bound to the plan digest; and every planned mutation family ran
//              every recorded mutation exactly once on every planned mutation OS;
//   docs / fast-integrity — their jobs succeeded.
// Unknown mode, missing / unreadable plan or proof, a missing required job or any plan/result mismatch fails.
//
//   node scripts/ci/quality-gate.mjs --mode docs|affected|full|fast-integrity --needs <needs.json>
//        [--reports <dir>] [--plan <plan.json>] [--proofs <dir>] [--base <sha> --head <sha>]
//   node scripts/ci/quality-gate.mjs --self-test

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MUTATION_FAMILIES, OPERATING_SYSTEMS, planFor, validatePlan } from './impact-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MUTATION_SCRIPTS = MUTATION_FAMILIES;
export { OPERATING_SYSTEMS };
export const REQUIRED = {
  docs: ['classify', 'docs-fast'],
  'fast-integrity': ['classify', 'integrity'],
  full: ['classify', 'static', 'tests', 'mutation', 'acceptance', 'desktop'],
  affected: ['classify', 'affected-checks'],
};

/** The recorded mutation ids of one script, read from its MUTATIONS table (the same ids the verifier pins). */
export function recordedIds(script) {
  const text = readFileSync(path.join(ROOT, 'scripts', `${script}-mutation-check.mjs`), 'utf8');
  const table = text.slice(text.indexOf('const MUTATIONS = ['), text.indexOf('\n];', text.indexOf('const MUTATIONS = [')));
  return [...table.matchAll(/^ {4}id: '([^']+)',/gm)].map((m) => m[1]);
}

/** Proof parity for one OS: the union of the shards' `ran` lists is exactly the recorded ids, each once. */
export function parity(reports, os, scripts = MUTATION_SCRIPTS, ids = recordedIds) {
  const problems = [];
  for (const script of scripts) {
    const mine = reports.filter((r) => r.os === os && r.script === `${script}:mutation`);
    const ran = mine.flatMap((r) => (Array.isArray(r.ran) ? r.ran : []));
    const want = ids(script);
    const dup = ran.filter((id, i) => ran.indexOf(id) !== i);
    const missing = want.filter((id) => !ran.includes(id));
    const unknown = ran.filter((id) => !want.includes(id));
    if (mine.length === 0) problems.push(`${os}: no ${script}:mutation report`);
    if (dup.length) problems.push(`${os}: ${script} ran ${dup.join(',')} more than once`);
    if (missing.length) problems.push(`${os}: ${script} never ran ${missing.join(',')}`);
    if (unknown.length) problems.push(`${os}: ${script} ran unrecorded ${unknown.join(',')}`);
    if (mine.some((r) => r.total !== want.length)) problems.push(`${os}: ${script} reports a total other than ${want.length}`);
  }
  return problems;
}

/**
 * The pure gate decision. `diffFiles` (the pull request's own diff, re-derived by the gate) is optional; when
 * present the plan must be the plan for exactly those files.
 */
export function evaluate({ mode, needs, reports = [], plan, proofs = [], diffFiles, ids = recordedIds }) {
  const problems = [];
  if (!Object.hasOwn(REQUIRED, mode)) return [`unknown mode ${JSON.stringify(mode)} (fail closed)`];
  if (!needs || typeof needs !== 'object') return ['needs are unreadable (fail closed)'];
  for (const job of REQUIRED[mode]) {
    const result = needs?.[job]?.result;
    if (result !== 'success') problems.push(`job ${job} is ${JSON.stringify(result ?? 'missing')}, not success`);
  }
  if (mode === 'full') {
    for (const os of OPERATING_SYSTEMS) problems.push(...parity(reports, os, MUTATION_SCRIPTS, ids));
  }
  if (mode === 'affected') {
    if (plan === undefined) return [...problems, 'affected plan is missing (fail closed)'];
    const invalid = validatePlan(plan);
    if (invalid.length) return [...problems, ...invalid];
    if (plan.mode !== 'affected') problems.push(`plan mode ${plan.mode} is not affected (fail closed)`);
    if (diffFiles !== undefined && planFor(diffFiles).digest !== plan.digest) problems.push('plan does not match the pull request diff re-derived by the gate');
    const fams = plan.mutation?.families ?? [];
    const mutResult = needs?.['affected-mutation']?.result;
    if (fams.length > 0 && mutResult !== 'success') problems.push(`job affected-mutation is ${JSON.stringify(mutResult ?? 'missing')}, not success`);
    if (fams.length === 0 && mutResult !== 'skipped') problems.push(`job affected-mutation is ${JSON.stringify(mutResult ?? 'missing')} although the plan has no mutation family`);
    for (const os of plan.os) {
      const mine = proofs.filter((p) => p?.os === os);
      if (mine.length !== 1) {
        problems.push(`${os}: ${mine.length} affected proof(s), expected exactly 1`);
        continue;
      }
      const p = mine[0];
      if (p.digest !== plan.digest) problems.push(`${os}: proof is bound to another plan`);
      const want = plan.steps.map((s) => s.id);
      const got = Array.isArray(p.steps) ? p.steps.map((s) => s.id) : [];
      if (got.join('\n') !== want.join('\n')) problems.push(`${os}: proof steps [${got.join(', ')}] are not the planned [${want.join(', ')}]`);
      for (const s of Array.isArray(p.steps) ? p.steps : []) if (s.status !== 'passed') problems.push(`${os}: step ${s.id} is ${JSON.stringify(s.status)}`);
    }
    for (const p of proofs) if (!plan.os.includes(p?.os)) problems.push(`unexpected affected proof for ${JSON.stringify(p?.os)}`);
    for (const os of plan.mutation?.os ?? []) problems.push(...parity(reports, os, fams, ids));
    const extra = reports.filter((r) => !(plan.mutation?.os ?? []).includes(r.os) || !fams.includes(String(r.script).replace(':mutation', '')));
    if (extra.length) problems.push(`mutation reports outside the plan: ${extra.map((r) => `${r.os}/${r.script}`).join(', ')}`);
  }
  return problems;
}

function readJsonDir(dir, decorate = (_f, x) => x) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => decorate(f, JSON.parse(readFileSync(path.join(dir, f), 'utf8'))));
}

// ---------------------------------------------------------------------------------------------------------

export function selfTest() {
  const failures = [];
  const ids = (s) => [`${s}-a`, `${s}-b`];
  const ok = { result: 'success' };
  const fullNeeds = { classify: ok, static: ok, tests: ok, mutation: ok, acceptance: ok, desktop: ok };
  const fullReports = OPERATING_SYSTEMS.flatMap((os) => MUTATION_SCRIPTS.flatMap((s) => [
    { os, script: `${s}:mutation`, total: 2, ran: [`${s}-a`] },
    { os, script: `${s}:mutation`, total: 2, ran: [`${s}-b`] },
  ]));
  const expect = (name, problems, pass) => {
    if (pass && problems.length) failures.push(`${name}: expected PASS, got ${problems.join('; ')}`);
    if (!pass && problems.length === 0) failures.push(`${name}: expected FAIL, got PASS`);
  };
  // FULL parity is unchanged.
  expect('full complete', evaluate({ mode: 'full', needs: fullNeeds, reports: fullReports, ids }), true);
  expect('full without the Desktop proof (D1)', evaluate({ mode: 'full', needs: { ...fullNeeds, desktop: { result: 'failure' } }, reports: fullReports, ids }), false);
  expect('full with the Desktop proof skipped', evaluate({ mode: 'full', needs: { ...fullNeeds, desktop: { result: 'skipped' } }, reports: fullReports, ids }), false);
  expect('full missing one mutation on Windows', evaluate({ mode: 'full', needs: fullNeeds, reports: fullReports.filter((r) => !(r.os === 'windows-latest' && r.script === 'l1:mutation' && r.ran[0] === 'l1-b')), ids }), false);
  expect('full duplicate shard on Ubuntu', evaluate({ mode: 'full', needs: fullNeeds, reports: [...fullReports, fullReports.at(-1)], ids }), false);
  expect('full without a family report', evaluate({ mode: 'full', needs: fullNeeds, reports: fullReports.filter((r) => r.script !== 'c3:mutation'), ids }), false);
  expect('full with a failed job', evaluate({ mode: 'full', needs: { ...fullNeeds, mutation: { result: 'failure' } }, reports: fullReports, ids }), false);
  expect('unknown mode', evaluate({ mode: 'skip', needs: fullNeeds, ids }), false);
  expect('empty mode', evaluate({ mode: '', needs: fullNeeds, ids }), false);
  expect('unreadable needs', evaluate({ mode: 'docs', needs: undefined, ids }), false);
  expect('docs', evaluate({ mode: 'docs', needs: { classify: ok, 'docs-fast': ok }, ids }), true);
  expect('fast-integrity without integrity', evaluate({ mode: 'fast-integrity', needs: { classify: ok, integrity: { result: 'skipped' } }, ids }), false);
  // Affected.
  const files = ['packages/command-center-ui/src/app/view.ts'];
  const plan = planFor(files);
  const affNeeds = { classify: ok, 'affected-checks': ok, 'affected-mutation': ok };
  const proofs = plan.os.map((os) => ({ os, digest: plan.digest, steps: plan.steps.map((s) => ({ id: s.id, status: 'passed' })) }));
  const affReports = plan.mutation.os.flatMap((os) => plan.mutation.families.map((s) => ({ os, script: `${s}:mutation`, total: 2, ran: ids(s) })));
  const good = { mode: 'affected', needs: affNeeds, plan, proofs, reports: affReports, diffFiles: files, ids };
  expect('affected complete', evaluate(good), true);
  expect('affected without plan', evaluate({ ...good, plan: undefined }), false);
  expect('affected with unreadable plan', evaluate({ ...good, plan: { schema: 'nope' } }), false);
  expect('affected plan with a mutation family removed', evaluate({ ...good, plan: { ...plan, mutation: { ...plan.mutation, families: ['c5'] } } }), false);
  expect('affected plan for a different diff', evaluate({ ...good, diffFiles: [...files, 'packages/runtime/src/runtime.ts'] }), false);
  expect('affected plan that is really full', evaluate({ ...good, plan: planFor(['packages/runtime/src/runtime.ts']) }), false);
  expect('affected missing the Windows proof', evaluate({ ...good, proofs: proofs.filter((p) => p.os !== 'windows-latest') }), false);
  expect('affected proof missing a required step', evaluate({ ...good, proofs: proofs.map((p) => ({ ...p, steps: p.steps.filter((s) => s.id !== 'acceptance:c5:spike') })) }), false);
  expect('affected proof with a failed step', evaluate({ ...good, proofs: proofs.map((p) => ({ ...p, steps: p.steps.map((s) => (s.id === 'lint' ? { ...s, status: 'failed' } : s)) })) }), false);
  expect('affected proof bound to another plan', evaluate({ ...good, proofs: proofs.map((p) => ({ ...p, digest: '0'.repeat(64) })) }), false);
  expect('affected missing a mutation family report', evaluate({ ...good, reports: affReports.filter((r) => r.script !== 'l1:mutation') }), false);
  expect('affected mutation job skipped', evaluate({ ...good, needs: { ...affNeeds, 'affected-mutation': { result: 'skipped' } } }), false);
  expect('affected checks job missing', evaluate({ ...good, needs: { classify: ok, 'affected-mutation': ok } }), false);
  return failures;
}

function main(argv) {
  if (argv.includes('--self-test')) {
    const failures = selfTest();
    for (const f of failures) console.error(`quality-gate self-test FAILED: ${f}`);
    if (failures.length) process.exit(1);
    console.log('quality-gate self-test ok');
    return;
  }
  const arg = (name) => (argv.includes(name) ? String(argv[argv.indexOf(name) + 1] ?? '') : '');
  const mode = arg('--mode');
  const pre = [];
  let needs;
  try {
    needs = JSON.parse(readFileSync(arg('--needs'), 'utf8'));
  } catch {
    needs = undefined;
  }
  let reports = [];
  let plan;
  let proofs = [];
  let diffFiles;
  try {
    if (mode === 'full' || mode === 'affected') reports = readJsonDir(arg('--reports'), (f, x) => ({ ...x, os: f.split('__')[0] }));
  } catch {
    pre.push('mutation reports are unreadable (fail closed)');
  }
  if (mode === 'affected') {
    try {
      plan = JSON.parse(readFileSync(arg('--plan'), 'utf8'));
    } catch {
      plan = undefined;
    }
    try {
      proofs = readJsonDir(arg('--proofs'));
    } catch {
      pre.push('affected proofs are unreadable (fail closed)');
    }
    const base = arg('--base');
    const head = arg('--head');
    if (/^[0-9a-f]{40}$/.test(base) && /^[0-9a-f]{40}$/.test(head)) {
      try {
        const mergeBase = execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim();
        diffFiles = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--name-only', '--no-renames', mergeBase, head], { encoding: 'utf8' }).split('\n').map((x) => x.trim()).filter(Boolean);
      } catch {
        pre.push('the gate could not re-derive the pull request diff (fail closed)');
      }
    } else {
      pre.push('affected mode needs the pull request base/head to re-derive the plan (fail closed)');
    }
  }
  const problems = [...pre, ...evaluate({ mode, needs, reports, plan, proofs, diffFiles })];
  const lines = [`## Quality gate — ${mode || 'unknown'}`, '', problems.length ? `**FAIL** (${problems.length})` : '**PASS**', '', ...problems.map((p) => `- ${p}`)];
  if (mode === 'full') lines.push('', `Mutation reports: ${reports.length}; ${MUTATION_SCRIPTS.map((s) => `${s}=${recordedIds(s).length}`).join(', ')} recorded, each proven on ${OPERATING_SYSTEMS.join(' and ')}.`);
  if (mode === 'affected' && plan?.mutation) {
    lines.push('', `Affected plan ${String(plan.digest).slice(0, 12)}: boundaries ${plan.boundaries?.join(', ')}; checks on ${plan.os?.join(', ')}; steps ${plan.steps?.map((s) => s.id).join(' → ')}.`);
    lines.push(`Mutation reports: ${reports.length}; ${plan.mutation.families.map((s) => `${s}=${recordedIds(s).length}`).join(', ')} recorded, each proven on ${plan.mutation.os.join(' and ')}.`);
    lines.push('Affected proof qualifies an ordinary iteration only; a Desktop release candidate needs one green FULL gate on its exact tree (D-D0-01).');
  }
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  if (problems.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
