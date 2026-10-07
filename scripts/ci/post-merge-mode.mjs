#!/usr/bin/env node
// Post-merge CI mode (D-R1-07, D-C4-08, D0 / D-D0-01). A push to main whose resulting tree is EXACTLY the tree a
// green pull request run already proved needs only a fast integrity proof. The proving run recorded that tree in
// its `tested-tree` artifact (`tested-tree.json`), which names the proof MODE: `full` or `affected` — both are
// eligible, because the gate already required the complete proof for that mode. Anything else — not a merge
// commit, no associated pull request, no green run for the exact head, a missing / unreadable artifact, an
// unknown mode, a different tree, any API or git error — runs the FULL proof set. Fails closed; never "skip".
//
//   node scripts/ci/post-merge-mode.mjs --repo <owner/name> --sha <pushed sha>   emits `mode=fast-integrity|full`
//   node scripts/ci/post-merge-mode.mjs --record-tested-tree <file> --mode full|affected   (green PR gate)
//   node scripts/ci/post-merge-mode.mjs --self-test
//
// Uses the GitHub CLI with the workflow token (read-only: actions, pull-requests, contents).

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const TESTED_TREE_SCHEMA = 'qandeel.tested-tree/v1';
export const PROOF_MODES = ['full', 'affected'];

/** Parse a `tested-tree.json` artifact; throws on anything that is not a valid record. */
export function parseTestedTree(text) {
  let rec;
  try {
    rec = JSON.parse(String(text));
  } catch {
    throw new Error('unreadable tested-tree artifact');
  }
  if (!rec || rec.schema !== TESTED_TREE_SCHEMA) throw new Error('tested-tree artifact has an unknown schema');
  if (!/^[0-9a-f]{40}$/.test(String(rec.tree))) throw new Error('tested-tree artifact has no valid tree');
  if (!PROOF_MODES.includes(rec.mode)) throw new Error(`tested-tree artifact names unknown proof mode ${JSON.stringify(rec.mode)}`);
  return rec;
}

/** Serialize a `tested-tree.json` record; refuses anything `parseTestedTree` would not accept. */
export function recordTestedTree(tree, mode) {
  const text = `${JSON.stringify({ schema: TESTED_TREE_SCHEMA, tree, mode })}\n`;
  parseTestedTree(text);
  return text;
}

/**
 * The pure decision. `fetchArtifact(runId)` returns the artifact text (or throws). Returns { mode, reason }.
 */
export function decide({ parents, tree, prs, runs, fetchArtifact }) {
  try {
    if (!Array.isArray(parents) || parents.length !== 2) throw new Error(`not a merge commit (${Array.isArray(parents) ? parents.length : '?'} parent(s))`);
    if (!/^[0-9a-f]{40}$/.test(String(tree))) throw new Error('no merged tree');
    const pr = Array.isArray(prs) ? prs.find((p) => p?.merged_at && p.base?.ref === 'main') : undefined;
    if (!pr) throw new Error('no merged pull request for this commit');
    const green = (Array.isArray(runs) ? runs : []).filter((r) => r.headSha === pr.head?.sha && r.status === 'completed' && r.conclusion === 'success');
    if (green.length === 0) throw new Error('no green pull request run for the merged head');
    const rec = parseTestedTree(fetchArtifact(green[0].databaseId));
    if (rec.tree !== tree) throw new Error(`tree ${tree.slice(0, 12)} differs from the tested ${rec.tree.slice(0, 12)}`);
    return { mode: 'fast-integrity', reason: `tree ${tree.slice(0, 12)} was proven (${rec.mode}) by pull request #${pr.number} run ${green[0].databaseId}` };
  } catch (error) {
    return { mode: 'full', reason: `${String(error?.message ?? error).slice(0, 160)}: fail closed` };
  }
}

export function selfTest() {
  const tree = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const base = {
    parents: ['c'.repeat(40), 'd'.repeat(40)],
    tree,
    prs: [{ number: 7, merged_at: '2026-10-07T00:00:00Z', base: { ref: 'main' }, head: { sha: head, ref: 'x' } }],
    runs: [{ databaseId: 1, headSha: head, status: 'completed', conclusion: 'success' }],
  };
  const art = (o) => () => JSON.stringify({ schema: TESTED_TREE_SCHEMA, tree, mode: 'affected', ...o });
  const cases = [
    ['affected exact tree', { ...base, fetchArtifact: art({}) }, 'fast-integrity'],
    ['full exact tree', { ...base, fetchArtifact: art({ mode: 'full' }) }, 'fast-integrity'],
    ['affected mismatched tree', { ...base, fetchArtifact: art({ tree: 'e'.repeat(40) }) }, 'full'],
    ['missing artifact', { ...base, fetchArtifact: () => { throw new Error('artifact not found'); } }, 'full'],
    ['unreadable artifact', { ...base, fetchArtifact: () => 'not json' }, 'full'],
    ['legacy tree-only artifact', { ...base, fetchArtifact: () => `${tree}\n` }, 'full'],
    ['unknown proof mode', { ...base, fetchArtifact: art({ mode: 'docs' }) }, 'full'],
    ['missing proof mode', { ...base, fetchArtifact: art({ mode: undefined }) }, 'full'],
    ['unknown schema', { ...base, fetchArtifact: art({ schema: 'other' }) }, 'full'],
    ['not a merge commit', { ...base, parents: ['c'.repeat(40)], fetchArtifact: art({}) }, 'full'],
    ['no pull request', { ...base, prs: [], fetchArtifact: art({}) }, 'full'],
    ['API failure (prs unreadable)', { ...base, prs: undefined, fetchArtifact: art({}) }, 'full'],
    ['no green run', { ...base, runs: [{ ...base.runs[0], conclusion: 'failure' }], fetchArtifact: art({}) }, 'full'],
    ['green run for another head', { ...base, runs: [{ ...base.runs[0], headSha: 'f'.repeat(40) }], fetchArtifact: art({}) }, 'full'],
  ];
  const failures = cases.filter(([, input, want]) => decide(input).mode !== want).map(([name, , want]) => `${name}: expected ${want}`);
  // The record the gate writes is exactly what the decision reads, for both proof modes; nothing else is written.
  for (const mode of PROOF_MODES) if (decide({ ...base, fetchArtifact: () => recordTestedTree(tree, mode) }).mode !== 'fast-integrity') failures.push(`recorded ${mode} tree is not reusable`);
  for (const bad of [['docs', tree], ['', tree], ['affected', 'nope']]) {
    try {
      recordTestedTree(bad[1], bad[0]);
      failures.push(`recorded an invalid tested tree (${bad.join(', ')})`);
    } catch {
      // expected
    }
  }
  return failures;
}

function emit({ mode, reason }) {
  console.log(`mode=${mode} (${reason})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\naffected_os=[]\nmutation_matrix=[]\n`);
}

function main(argv) {
  if (argv.includes('--self-test')) {
    const failures = selfTest();
    for (const f of failures) console.error(`post-merge self-test FAILED: ${f}`);
    if (failures.length) process.exit(1);
    console.log('post-merge self-test ok');
    return;
  }
  const arg = (name) => (argv.includes(name) ? String(argv[argv.indexOf(name) + 1] ?? '') : '');
  if (argv.includes('--record-tested-tree')) {
    // Written by a green quality gate on a pull request: the proven (merge-ref) tree and the proof mode.
    const text = recordTestedTree(execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(), arg('--mode'));
    writeFileSync(arg('--record-tested-tree'), text);
    console.log(text.trim());
    return;
  }
  const repo = arg('--repo');
  const sha = arg('--sha');
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const dirs = [];
  try {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('bad arguments');
    // D-R1-07: the fast path applies to the Company's merge-commit form only (two parents); anything else is full.
    const parents = execFileSync('git', ['rev-list', '--parents', '-n', '1', sha], { encoding: 'utf8' }).trim().split(/\s+/).slice(1);
    const tree = execFileSync('git', ['rev-parse', `${sha}^{tree}`], { encoding: 'utf8' }).trim();
    const prs = JSON.parse(gh('api', `repos/${repo}/commits/${sha}/pulls`));
    const pr = Array.isArray(prs) ? prs.find((p) => p.merged_at && p.base?.ref === 'main') : undefined;
    const runs = pr ? JSON.parse(gh('run', 'list', '--repo', repo, '--workflow', 'ci.yml', '--event', 'pull_request', '--branch', String(pr.head.ref), '--json', 'databaseId,headSha,conclusion,status', '--limit', '50')) : [];
    const fetchArtifact = (runId) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'qc-tree-'));
      dirs.push(dir);
      gh('run', 'download', String(runId), '--repo', repo, '--name', 'tested-tree', '--dir', dir);
      const file = path.join(dir, 'tested-tree.json');
      if (!existsSync(file)) throw new Error('tested-tree.json missing from the artifact');
      return readFileSync(file, 'utf8');
    };
    emit(decide({ parents, tree, prs, runs, fetchArtifact }));
  } catch (error) {
    emit({ mode: 'full', reason: `${String(error?.message ?? error).slice(0, 160)}: fail closed` });
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
