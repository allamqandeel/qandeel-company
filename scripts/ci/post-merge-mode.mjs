#!/usr/bin/env node
// Post-merge CI mode (D-R1-07, D-C4-08). A push to main whose resulting tree is EXACTLY the tree a green pull
// request run already proved (that run recorded it in its `tested-tree` artifact) needs only a fast integrity
// proof; anything else — no associated pull request, no green run, a missing or different tree, any API or git
// error — runs the FULL proof set. Fails closed; it never decides "skip".
//
//   node scripts/ci/post-merge-mode.mjs --repo <owner/name> --sha <pushed sha>   emits `mode=fast-integrity|full`
//
// Uses the GitHub CLI with the workflow token (read-only: actions, pull-requests, contents).

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function emit(mode, reason) {
  console.log(`mode=${mode} (${reason})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
}

const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? String(argv[argv.indexOf(name) + 1] ?? '') : '');
const repo = arg('--repo');
const sha = arg('--sha');
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let dir = null;
try {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('bad arguments');
  // D-R1-07: the fast path applies to the Company's merge-commit form only (two parents); anything else is full.
  const parents = execFileSync('git', ['rev-list', '--parents', '-n', '1', sha], { encoding: 'utf8' }).trim().split(/\s+/).slice(1);
  if (parents.length !== 2) throw new Error(`not a merge commit (${parents.length} parent(s))`);
  const tree = execFileSync('git', ['rev-parse', `${sha}^{tree}`], { encoding: 'utf8' }).trim();
  const prs = JSON.parse(gh('api', `repos/${repo}/commits/${sha}/pulls`));
  const pr = Array.isArray(prs) ? prs.find((p) => p.merged_at && p.base?.ref === 'main') : undefined;
  if (!pr) throw new Error('no merged pull request for this commit');
  const runs = JSON.parse(gh('run', 'list', '--repo', repo, '--workflow', 'ci.yml', '--event', 'pull_request', '--branch', String(pr.head.ref), '--json', 'databaseId,headSha,conclusion,status', '--limit', '50'));
  const green = runs.filter((r) => r.headSha === pr.head.sha && r.status === 'completed' && r.conclusion === 'success');
  if (green.length === 0) throw new Error('no green pull request run for the merged head');
  dir = mkdtempSync(path.join(tmpdir(), 'qc-tree-'));
  gh('run', 'download', String(green[0].databaseId), '--repo', repo, '--name', 'tested-tree', '--dir', dir);
  const tested = readFileSync(path.join(dir, 'tested-tree.txt'), 'utf8').trim();
  if (!/^[0-9a-f]{40}$/.test(tested)) throw new Error('unreadable tested tree');
  if (tested !== tree) throw new Error(`tree ${tree.slice(0, 12)} differs from the tested ${tested.slice(0, 12)}`);
  emit('fast-integrity', `tree ${tree.slice(0, 12)} was proven by pull request #${pr.number} run ${green[0].databaseId}`);
} catch (error) {
  emit('full', `${String(error?.message ?? error).slice(0, 160)}: fail closed`);
} finally {
  if (dir) rmSync(dir, { recursive: true, force: true });
}
