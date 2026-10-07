#!/usr/bin/env node
// CI change classifier (D-R1-07, D-C4-08, D0 / D-D0-01). The decision is the canonical impact map's
// (`impact-map.mjs` — the same map `npm run validate:affected` uses locally; there is no second mapping):
//   docs     — documentation only: build + repository verifier;
//   affected — only safely owned boundaries changed: that boundary's declared proof (Windows mandatory);
//   full     — anything else, an empty or unreadable diff, or any error: the FULL continuity proof.
// The pull-request plan is written as a machine-readable artifact (`--plan-out`) that the quality gate re-derives.
//
//   node scripts/ci/classify-changes.mjs --base <sha> --head <sha> [--plan-out <file>]   emits mode / plan outputs
//   node scripts/ci/classify-changes.mjs --force-full                                    always `mode=full`
//   node scripts/ci/classify-changes.mjs --self-test                                     proves it fails closed

import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { isDocsPath, planFor, describePlan } from './impact-map.mjs';

export { isDocsPath };

/** `docs`, `affected` or `full` for a list of changed paths; anything unexpected is `full`. */
export function classify(files) {
  if (!Array.isArray(files) || files.length === 0) return 'full';
  return planFor(files).mode;
}

export const SELF_TEST_CASES = [
  [['docs/C4_IMPLEMENTATION_REPORT.md'], 'docs'],
  [['README.md', 'docs/architecture/DECISION_LOG.md'], 'docs'],
  [['docs/diagrams/org.png'], 'docs'],
  [['packages/command-center-ui/src/app/view.ts'], 'affected'],
  [['packages/command-center/src/host/lifecycle.ts', 'docs/x.md'], 'affected'],
  [[], 'full'],
  [['packages/storage/src/review.ts'], 'full'],
  [['docs/x.md', 'scripts/verify-bootstrap.mjs'], 'full'],
  [['.github/workflows/ci.yml'], 'full'],
  [['scripts/ci/impact-map.mjs'], 'full'],
  [['package.json'], 'full'],
  [['packages/storage/migrations/0008_c4_review_quality.sql'], 'full'],
  [['packages/command-center-ui/src/app/view.ts', 'packages/runtime/src/runtime.ts'], 'full'],
  [['tools/unknown.mjs'], 'full'],
  [['docs/../packages/x.ts'], 'full'],
  [['sub/README.md'], 'full'],
  [[''], 'full'],
  ['not-a-list', 'full'],
];

export function selfTest() {
  return SELF_TEST_CASES.filter(([files, want]) => classify(files) !== want).map(([files, want]) => `classify(${JSON.stringify(files)}) !== ${want}`);
}

function emit(mode, reason, plan) {
  console.log(`mode=${mode} (${reason})`);
  if (plan) console.log(describePlan(plan));
  if (process.env.GITHUB_OUTPUT) {
    const affected = plan?.mode === 'affected';
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `mode=${mode}\naffected_os=${JSON.stringify(affected ? plan.os : [])}\nmutation_matrix=${JSON.stringify(affected ? plan.mutation.matrix : [])}\n`,
    );
  }
}

function main(argv) {
  if (argv.includes('--self-test')) {
    const failures = selfTest();
    for (const f of failures) console.error(`classify self-test FAILED: ${f}`);
    if (failures.length) process.exit(1);
    console.log(`classify self-test ok (${SELF_TEST_CASES.length} cases)`);
    return;
  }
  const arg = (name) => (argv.includes(name) ? String(argv[argv.indexOf(name) + 1] ?? '') : '');
  const planOut = arg('--plan-out');
  const write = (plan) => {
    if (planOut) writeFileSync(planOut, `${JSON.stringify(plan, null, 2)}\n`);
  };
  if (argv.includes('--force-full')) {
    const plan = { ...planFor([]), reasons: ['forced (manual full run)'] };
    write(plan);
    return emit('full', 'forced');
  }
  const base = arg('--base');
  const head = arg('--head');
  if (!/^[0-9a-f]{40}$/.test(base) || !/^[0-9a-f]{40}$/.test(head)) {
    write(planFor([]));
    return emit('full', 'no comparable base/head: fail closed');
  }
  try {
    const mergeBase = execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim();
    const files = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--name-only', '--no-renames', mergeBase, head], { encoding: 'utf8' }).split('\n').map((x) => x.trim()).filter(Boolean);
    const plan = { ...planFor(files), base, head, mergeBase };
    write(plan);
    return emit(plan.mode, `${files.length} changed file(s)`, plan);
  } catch (error) {
    write(planFor([]));
    return emit('full', `diff unavailable (${String(error?.message ?? error).slice(0, 80)}): fail closed`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
