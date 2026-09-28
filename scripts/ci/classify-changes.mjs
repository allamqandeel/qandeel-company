#!/usr/bin/env node
// CI change classifier (D-R1-07, D-C4-08). A change that touches only documentation takes the fast,
// fail-closed docs path (install, build, repository verifier — no Windows suite); ANY other path, an empty or
// unreadable diff, or any error takes the FULL proof set. The decision is pure (`classify`) and self-tested.
//
//   node scripts/ci/classify-changes.mjs --base <sha> --head <sha>   prints and emits `mode=docs|full`
//   node scripts/ci/classify-changes.mjs --force-full                 always `mode=full`
//   node scripts/ci/classify-changes.mjs --self-test                  proves the classifier fails closed

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Documentation only: anything under docs/, or a Markdown file at the repository root. */
export const isDocsPath = (f) => typeof f === 'string' && f.length > 0 && !f.includes('..') && (/^docs\/[^\0]+$/.test(f) || /^[^/]+\.md$/.test(f));

/** `docs` only when there is at least one change and every change is documentation; otherwise `full`. */
export function classify(files) {
  if (!Array.isArray(files) || files.length === 0) return 'full';
  return files.every(isDocsPath) ? 'docs' : 'full';
}

export const SELF_TEST_CASES = [
  [['docs/C4_IMPLEMENTATION_REPORT.md'], 'docs'],
  [['README.md', 'docs/architecture/DECISION_LOG.md'], 'docs'],
  [['docs/diagrams/org.png'], 'docs'],
  [[], 'full'],
  [['packages/storage/src/review.ts'], 'full'],
  [['docs/x.md', 'scripts/verify-bootstrap.mjs'], 'full'],
  [['.github/workflows/ci.yml'], 'full'],
  [['package.json'], 'full'],
  [['packages/storage/migrations/0008_c4_review_quality.sql'], 'full'],
  [['docs/../packages/x.ts'], 'full'],
  [['sub/README.md'], 'full'],
  [[''], 'full'],
  ['not-a-list', 'full'],
];

export function selfTest() {
  return SELF_TEST_CASES.filter(([files, want]) => classify(files) !== want).map(([files, want]) => `classify(${JSON.stringify(files)}) !== ${want}`);
}

function emit(mode, reason) {
  console.log(`mode=${mode} (${reason})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
}

function main(argv) {
  if (argv.includes('--self-test')) {
    const failures = selfTest();
    for (const f of failures) console.error(`classify self-test FAILED: ${f}`);
    if (failures.length) process.exit(1);
    console.log(`classify self-test ok (${SELF_TEST_CASES.length} cases)`);
    return;
  }
  if (argv.includes('--force-full')) return emit('full', 'forced');
  const arg = (name) => (argv.includes(name) ? String(argv[argv.indexOf(name) + 1] ?? '') : '');
  const base = arg('--base');
  const head = arg('--head');
  if (!/^[0-9a-f]{40}$/.test(base) || !/^[0-9a-f]{40}$/.test(head)) return emit('full', 'no comparable base/head: fail closed');
  try {
    const mergeBase = execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim();
    const files = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--name-only', '--no-renames', mergeBase, head], { encoding: 'utf8' }).split('\n').map((x) => x.trim()).filter(Boolean);
    return emit(classify(files), `${files.length} changed file(s)`);
  } catch (error) {
    return emit('full', `diff unavailable (${String(error?.message ?? error).slice(0, 80)}): fail closed`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
