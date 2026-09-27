#!/usr/bin/env node
// C1 mutation check (D-C1-22 / D-C1-23 / D-C1-24): proves the remediation proofs are not vacuous.
//
// Each mutation removes one guard from the COMPILED output (packages/*/dist), runs the proof tests
// that must catch it, requires them to FAIL, and restores the original file (always, in `finally`).
// Sources are never touched. Run after `npm run build`:
//
//   npm run c1:mutation
//
// A mutation that the tests do not catch — or a mutation that no longer applies because the guarded
// code moved — fails this script.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Proof tests resolve the test-only Founder seam through the `qandeel-test` condition (D-C2-13).
const TEST_ENV = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=qandeel-test`.trim() };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MUTATIONS = [
  {
    id: 'claim-without-supervisor-verification',
    finding: 'F1',
    file: 'packages/storage/dist/src/queue.js',
    search: 'verifySupervisor(ctx, opts.supervisor);',
    replace: '/* mutation: supervisor verification removed */',
    expectedCount: 2,
    cwd: 'packages/storage',
    tests: ['dist/test/supervisor-authority.test.js'],
  },
  {
    id: 'recovery-without-supervisor-verification',
    finding: 'F1',
    file: 'packages/storage/dist/src/runtime-authority.js',
    search: 'verifySupervisor(ctx, supervisor);',
    replace: '/* mutation: supervisor verification removed */',
    // 4 C1 recovery writes + the C2 governed-orphan recovery + the C3 pending-candidate decision
    // (all supervisor-fenced).
    expectedCount: 6,
    cwd: 'packages/storage',
    tests: ['dist/test/supervisor-authority.test.js'],
  },
  {
    id: 'heartbeat-without-wake-reconciliation',
    finding: 'F2',
    file: 'packages/runtime/dist/src/runtime.js',
    search: 'this.#reconcileWake(generation);',
    replace: '/* mutation: lost-wake reconciliation removed (the d57b51f behaviour) */',
    expectedCount: 1,
    cwd: 'packages/runtime',
    tests: ['dist/test/integration/lost-wake.test.js'],
  },
  {
    id: 'backup-finalization-without-retry',
    finding: 'D-C1-24',
    file: 'packages/storage/dist/src/backup.js',
    search: 'if (attempt >= policy.maxAttempts) {',
    replace: 'if (true) { /* mutation: a single attempt (the 71f2edf behaviour) */',
    expectedCount: 1,
    cwd: 'packages/storage',
    tests: ['dist/test/backup-finalization.test.js'],
  },
  {
    id: 'backup-failure-leaves-attempt',
    finding: 'D-C1-24',
    file: 'packages/storage/dist/src/backup.js',
    search: '        discard(directory);',
    replace: '        /* mutation: failed attempt not removed */',
    expectedCount: 1,
    cwd: 'packages/storage',
    tests: ['dist/test/backup-finalization.test.js'],
  },
  {
    id: 'backup-record-not-idempotent',
    finding: 'D-C1-24',
    file: 'packages/storage/dist/src/backup.js',
    search: "return 'ALREADY_RECORDED';",
    replace: 'void 0; /* mutation: an identical replay falls through to the conflict path */',
    expectedCount: 1,
    cwd: 'packages/storage',
    tests: ['dist/test/backup-finalization.test.js'],
  },
];

let failures = 0;
for (const m of MUTATIONS) {
  const file = path.join(ROOT, m.file);
  const original = readFileSync(file, 'utf8');
  const count = original.split(m.search).length - 1;
  if (count !== m.expectedCount) {
    console.log(`c1-mutation: FAIL ${m.id} — expected ${m.expectedCount} occurrence(s) of the guard in ${m.file}, found ${count} (rebuild, or update this check with the code)`);
    failures++;
    continue;
  }
  try {
    writeFileSync(file, original.split(m.search).join(m.replace));
    const r = spawnSync(process.execPath, ['--test', ...m.tests], { cwd: path.join(ROOT, m.cwd), encoding: 'utf8', shell: false, windowsHide: true, timeout: 300_000, env: TEST_ENV });
    const failed = /^# fail [1-9]/m.test(r.stdout ?? '') || /^ℹ fail [1-9]/m.test(r.stdout ?? '');
    if (r.status !== 0 && failed) {
      console.log(`c1-mutation: ok   ${m.id} (${m.finding}) — proof tests failed as required`);
    } else {
      console.log(`c1-mutation: FAIL ${m.id} (${m.finding}) — proof tests did not catch the mutation (exit ${r.status})`);
      failures++;
    }
  } finally {
    writeFileSync(file, original);
  }
}
if (failures) {
  console.log(`c1-mutation: FAIL — ${failures} of ${MUTATIONS.length} mutation(s) not caught`);
  process.exit(1);
}
console.log(`c1-mutation: PASS — ${MUTATIONS.length}/${MUTATIONS.length} mutations caught`);
