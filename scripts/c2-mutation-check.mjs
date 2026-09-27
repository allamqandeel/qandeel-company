#!/usr/bin/env node
// C2 mutation check: proves the C2 authority / budget / tool / routing gates are not vacuous.
//
// Each mutation removes (or bypasses) one gate in the COMPILED output (packages/*/dist), runs the
// proof tests that must catch it, requires them to FAIL, and restores the file (always, in
// `finally`). Sources are never touched. Run after `npm run build`:
//
//   npm run c2:mutation
//
// A mutation the tests do not catch — or one that no longer applies because the guarded code
// moved — fails this script.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = { cwd: 'packages/governance', tests: ['dist/test/governance-kernel.test.js'] };
const STORAGE = { cwd: 'packages/storage', tests: ['dist/test/c2-governance.test.js'] };
const RUNTIME = { cwd: 'packages/runtime', tests: ['dist/test/c2/governed-runtime.test.js'] };
const RACE = { cwd: 'packages/storage', tests: ['dist/test/multiprocess/c2-concurrent-reservations.test.js'] };

const MUTATIONS = [
  {
    id: 'authority-no-default-deny',
    gate: 'default deny (no grant → no action)',
    file: 'packages/governance/dist/src/authority.js',
    search: 'const grant = covering[0];',
    replace: "const grant = covering[0] ?? { id: 'mutation-no-default-deny' };",
    expectedCount: 1,
    runs: [KERNEL, STORAGE],
  },
  {
    id: 'authority-r4-not-founder-only',
    gate: 'R4 Founder-only',
    file: 'packages/governance/dist/src/authority.js',
    search: "    if (req.risk === 'R4')\n        return { effect: 'DENY', code: 'FOUNDER_ONLY' };\n",
    replace: '    /* mutation: R4 gate removed */\n',
    expectedCount: 1,
    runs: [KERNEL],
  },
  {
    id: 'authority-r3-without-founder-approval',
    gate: 'R3 requires Founder approval',
    file: 'packages/governance/dist/src/authority.js',
    search: "approval: req.risk === 'R3' ? 'FOUNDER' : 'NONE'",
    replace: "approval: 'NONE'",
    expectedCount: 1,
    runs: [KERNEL, STORAGE],
  },
  {
    id: 'governance-admin-not-founder-only',
    gate: 'no self-escalation / Founder-only administration',
    file: 'packages/storage/dist/src/governance.js',
    search: '    assertGovernanceAuthority(p.kind, p.ref, subjectRef, what);',
    replace: '    /* mutation: governance authority check removed */',
    expectedCount: 1,
    runs: [STORAGE],
  },
  {
    id: 'approval-self-decision-allowed',
    gate: 'an actor never approves its own request',
    file: 'packages/storage/dist/src/governance.js',
    search: 'if (p.ref === a.subjectRef || p.ref === a.requestedByRef)',
    replace: 'if (false)',
    expectedCount: 1,
    runs: [STORAGE],
  },
  {
    id: 'reservation-without-headroom-check',
    gate: 'hard budget refusal (every level)',
    file: 'packages/storage/dist/src/governed-writes.js',
    search: '    if (!check.ok)\n',
    replace: '    if (false && !check.ok)\n',
    expectedCount: 1,
    runs: [STORAGE, RACE],
  },
  {
    id: 'ineligible-employee-can-run',
    gate: 'suspended / retired employees cannot execute',
    file: 'packages/storage/dist/src/governed-writes.js',
    search: '    if (!canExecute(e.state)) {\n',
    replace: '    if (false) {\n',
    expectedCount: 1,
    runs: [STORAGE],
  },
  {
    id: 'denied-tool-reaches-driver',
    gate: 'model output never executes a tool (denied intent never reaches a driver)',
    file: 'packages/storage/dist/src/governed-writes.js',
    search: "    if (decision.effect === 'DENY')\n        return deny(decision.code, { risk: action.risk });",
    replace: "    if (decision.effect === 'DENY')\n        return { kind: 'EXECUTE', invocationId: 'mutation', reservationId: null, driverCode: String(row.driver_code), actionCode: action.code, sideEffects: action.sideEffects };",
    expectedCount: 1,
    runs: [RUNTIME],
  },
  {
    id: 'idempotent-replay-removed',
    gate: 'idempotency prevents duplicate mutation',
    file: 'packages/storage/dist/src/governed-writes.js',
    search: "        if (existing.state === 'SUCCEEDED')\n",
    replace: '        if (false)\n',
    expectedCount: 1,
    runs: [STORAGE],
  },
  {
    id: 'call-despite-refused-reservation',
    gate: 'reserve before spend (refused reservation → no provider call)',
    file: 'packages/runtime/dist/src/c2/model-runtime.js',
    search: '                if (!reserved.ok) {',
    replace: '                if (false) {',
    expectedCount: 1,
    runs: [RUNTIME],
  },
  {
    id: 'd4-external-egress-allowed',
    gate: 'D4 never egresses to an external provider',
    file: 'packages/governance/dist/src/routing.js',
    search: "if (req.dataClass === 'D4' && d.locality === 'EXTERNAL')",
    replace: 'if (false)',
    expectedCount: 1,
    runs: [KERNEL],
  },
  {
    id: 'silent-expensive-fallback',
    gate: 'fallback never exceeds the original envelope',
    file: 'packages/governance/dist/src/routing.js',
    search: 'const ceiling = Math.max(original.worstCase.economicMicros, policy.fallbackCostCeilingMicros ?? 0);',
    replace: 'const ceiling = Number.MAX_SAFE_INTEGER;',
    expectedCount: 1,
    runs: [KERNEL, RUNTIME],
  },
  {
    id: 'escalation-on-self-reported-uncertainty',
    gate: 'escalation needs observable evidence',
    file: 'packages/governance/dist/src/routing.js',
    search: 'if (!OBSERVABLE_EVIDENCE.has(evidence))',
    replace: 'if (false)',
    expectedCount: 1,
    runs: [KERNEL],
  },
];

function failed(r) {
  return r.status !== 0 && (/^# fail [1-9]/m.test(r.stdout ?? '') || /^ℹ fail [1-9]/m.test(r.stdout ?? ''));
}

let failures = 0;
for (const m of MUTATIONS) {
  const file = path.join(ROOT, m.file);
  const original = readFileSync(file, 'utf8');
  const count = original.split(m.search).length - 1;
  if (count !== m.expectedCount) {
    console.log(`c2-mutation: FAIL ${m.id} — expected ${m.expectedCount} occurrence(s) of the gate in ${m.file}, found ${count} (rebuild, or update this check with the code)`);
    failures++;
    continue;
  }
  try {
    writeFileSync(file, original.split(m.search).join(m.replace));
    const caughtBy = m.runs.filter(({ cwd, tests }) => failed(spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: path.join(ROOT, cwd), encoding: 'utf8', shell: false, windowsHide: true, timeout: 300_000 })));
    if (caughtBy.length > 0) {
      console.log(`c2-mutation: ok   ${m.id} (${m.gate}) — caught by ${caughtBy.map((r) => r.tests.join(',')).join(' + ')}`);
    } else {
      console.log(`c2-mutation: FAIL ${m.id} (${m.gate}) — no proof test caught the mutation`);
      failures++;
    }
  } finally {
    writeFileSync(file, original);
  }
}
if (failures) {
  console.log(`c2-mutation: FAIL — ${failures} of ${MUTATIONS.length} mutation(s) not caught`);
  process.exit(1);
}
console.log(`c2-mutation: PASS — ${MUTATIONS.length}/${MUTATIONS.length} mutations caught`);
