#!/usr/bin/env node
// C3 mutation check: proves the C3 Memory / Context / Skills / Academy gates are not vacuous.
//
// Each mutation removes (or bypasses) one gate in the COMPILED output (packages/*/dist) — some need
// two coordinated edits where the gate is enforced twice (defence in depth) — runs the proof tests
// that must catch it, requires them to FAIL, and restores every file (always, in `finally`). Sources
// are never touched. Run after `npm run build`:
//
//   npm run c3:mutation
//
// A mutation the tests do not catch — or one that no longer applies because the guarded code moved —
// fails this script.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Proof tests resolve the test-only Founder seam through the `qandeel-test` condition (D-C2-13).
const TEST_ENV = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=qandeel-test`.trim() };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = { cwd: 'packages/mind', tests: ['dist/test/mind-kernel.test.js'] };
const STORAGE = { cwd: 'packages/storage', tests: ['dist/test/c3-mind.test.js'] };
const RUNTIME = { cwd: 'packages/runtime', tests: ['dist/test/c3/c3-runtime.test.js'] };
const CRASH = { cwd: 'packages/runtime', tests: ['dist/test/faults/c3-fault.test.js'] };

const MIND = 'packages/mind/dist/src';
const STORE = 'packages/storage/dist/src';

const MUTATIONS = [
  {
    id: 'memory-secret-stored',
    gate: 'secrets never enter memory',
    edits: [{ file: `${MIND}/memory.js`, search: "    if (containsSecretMaterial(c.content))\n        return { decision: 'REFUSE', reason: 'SECRET_MATERIAL', duplicateOf: null };\n", replace: '    /* mutation: secret refusal removed */\n' }],
    runs: [KERNEL],
  },
  {
    id: 'memory-contradicts-canonical',
    gate: 'Canonical Truth outranks memory',
    edits: [{ file: `${MIND}/memory.js`, search: "            return { decision: 'REFUSE', reason: 'CONTRADICTS_CANONICAL', duplicateOf: null };", replace: "            void 'mutation: canonical precedence removed';" }],
    runs: [KERNEL],
  },
  {
    id: 'memory-model-sets-confidence',
    gate: 'the policy, not the model, caps an unevidenced claim\'s confidence',
    edits: [{ file: `${MIND}/memory.js`, search: '        confidencePct = Math.min(confidencePct, UNEVIDENCED_CONFIDENCE_CAP);', replace: '        confidencePct = c.confidencePct; /* mutation: model chooses confidence */' }],
    runs: [KERNEL, STORAGE],
  },
  {
    id: 'context-budget-soft',
    gate: 'the context budget is hard (required items must fit)',
    edits: [{ file: `${MIND}/context.js`, search: '    if (requiredTokens > budget) {', replace: '    if (false) { /* mutation: hard budget removed */' }],
    runs: [KERNEL, STORAGE],
  },
  {
    id: 'critical-dimension-compensated',
    gate: 'a critical-dimension failure fails the attempt whatever the average',
    edits: [{ file: `${MIND}/academy.js`, search: "    const outcome = criticalFailures.length > 0 ? 'FAIL' : missingDimensions.length > 0", replace: "    const outcome = missingDimensions.length > 0" }],
    runs: [KERNEL, STORAGE],
  },
  {
    id: 'skill-license-unclear-eligible',
    gate: 'no production use without a clear free license',
    edits: [{ file: `${MIND}/skills.js`, search: "        reasons.push('LICENSE_NOT_CLEAR');", replace: "        void 'mutation: license gate removed';" }],
    runs: [KERNEL, STORAGE],
  },
  {
    id: 'skill-paid-dependency-silent',
    gate: 'FREE_SKILL_PAID_DEPENDENCY needs an explicit acknowledgement',
    edits: [{ file: `${MIND}/skills.js`, search: "        reasons.push('PAID_DEPENDENCY_UNACKNOWLEDGED');", replace: "        void 'mutation: paid dependency gate removed';" }],
    runs: [KERNEL, STORAGE],
  },
  {
    id: 'skill-executable-content-passes',
    gate: 'static inspection rejects executable content',
    edits: [{ file: `${MIND}/skills.js`, search: "        findings.add('EXECUTABLE_CONTENT');", replace: "        void 'mutation: executable-content finding removed';" }],
    runs: [KERNEL, STORAGE],
  },
  {
    id: 'reservation-without-manifest',
    gate: 'a model reservation is bound to this run\'s OK context manifest',
    edits: [
      { file: `${STORE}/governed-writes.js`, search: "        if (!manifest)\n            return refuse('CONTEXT_MANIFEST_REQUIRED', 'NO_OK_MANIFEST');\n", replace: '        /* mutation: manifest requirement removed */\n' },
      { file: `${STORE}/governed-writes.js`, search: '        if (input.tokens < manifest.estimatedInputTokens)', replace: '        if (manifest && input.tokens < manifest.estimatedInputTokens)' },
    ],
    runs: [STORAGE],
  },
  {
    id: 'knowledge-scope-leak',
    gate: 'Founder-only / restricted knowledge needs exact authority (SQL filter and code re-check)',
    edits: [
      { file: `${STORE}/mind-writes.js`, search: "          OR (scope = 'RESTRICTED' AND scope_ref IN (SELECT value FROM json_each(?))))", replace: "          OR (scope IN ('RESTRICTED', 'FOUNDER_ONLY') AND ? IS NOT NULL))" },
      { file: `${STORE}/mind-writes.js`, search: '        if (!knowledgeReadable(k, access))\n            continue; // defence in depth: re-checked in code\n', replace: '        /* mutation: knowledge re-check removed */\n' },
    ],
    runs: [STORAGE],
  },
  {
    id: 'memory-other-employee-visible',
    gate: 'an Employee\'s memory pool is its own',
    edits: [{ file: `${STORE}/mind-writes.js`, search: "      WHERE employee_id = ? AND integrity = 'OK' AND status IN ('ACTIVE', 'LOW_CONFIDENCE', 'STALE')", replace: "      WHERE (employee_id = ? OR 1) AND integrity = 'OK' AND status IN ('ACTIVE', 'LOW_CONFIDENCE', 'STALE')" }],
    runs: [STORAGE],
  },
  {
    id: 'corrupt-content-used',
    gate: 'content hash is verified on every load',
    edits: [{ file: `${STORE}/mind-core.js`, search: '    if (sha256Hex(String(row.t)) === row.s)\n        return String(row.t);', replace: '    return String(row.t); /* mutation: integrity check removed */' }],
    runs: [STORAGE],
  },
  {
    id: 'unpinned-skill-loads',
    gate: 'only a production-eligible pinned version loads',
    edits: [{ file: `${STORE}/mind-core.js`, search: "    if (!e.eligible)\n        return { ok: false, reason: e.reasons[0] ?? 'NOT_APPROVED' };", replace: '    /* mutation: eligibility check removed */' }],
    runs: [STORAGE],
  },
  {
    id: 'capability-gate-bypassed',
    gate: 'capability eligibility is decided before any model or tool call',
    edits: [{ file: `${STORE}/governed-writes.js`, search: "    if (!gate.ok)\n        return { ok: false, code: 'CAPABILITY_GAP', state: e.state, gapId: gate.gapId };", replace: '    /* mutation: capability gate removed */' }],
    runs: [STORAGE, RUNTIME],
  },
  {
    id: 'academy-authority-unconstrained',
    gate: 'Academy attempts / shadow work cannot act externally',
    edits: [{ file: `${STORE}/governed-writes.js`, search: "        return deny('ACADEMY_CONSTRAINED', { toolActionId: action.id, risk: action.risk });", replace: "        void 'mutation: academy constraint removed';" }],
    runs: [STORAGE],
  },
  {
    id: 'holdout-reused',
    gate: 'a holdout already exposed never certifies',
    edits: [{ file: `${STORE}/academy.js`, search: "            if (s.kind === 'HOLDOUT' && exposed > 0)", replace: '            if (false) /* mutation: holdout exposure check removed */' }],
    runs: [STORAGE],
  },
  {
    id: 'evaluator-sets-run-facts',
    gate: 'deterministic dimensions come only from run facts (no self-certification by assertion)',
    edits: [{ file: `${STORE}/academy.js`, search: '                if (DETERMINISTIC_DIMENSIONS.includes(r.dimension))', replace: '                if (false) /* mutation: deterministic-dimension guard removed */' }],
    runs: [STORAGE],
  },
  {
    id: 'model-accepts-foreign-context',
    gate: 'the model runtime accepts only a context the assembler minted',
    edits: [{ file: 'packages/runtime/dist/src/c2/model-runtime.js', search: "        if (!isAssembledContext(context))\n            return { kind: 'CONTEXT', code: 'CONTEXT_NOT_ASSEMBLED' };", replace: '        /* mutation: minted-context check removed */' }],
    runs: [RUNTIME],
  },
  {
    id: 'pending-candidates-not-recovered',
    gate: 'recovery decides memory candidates left by a crash',
    edits: [{ file: 'packages/runtime/dist/src/recovery.js', search: '        const n = decidePendingCandidates(store, supervisor, BATCH);', replace: '        const n = 0; /* mutation: candidate recovery removed */' }],
    runs: [CRASH],
  },
];

function failed(r) {
  return r.status !== 0 && (/^# fail [1-9]/m.test(r.stdout ?? '') || /^ℹ fail [1-9]/m.test(r.stdout ?? ''));
}

let failures = 0;
for (const m of MUTATIONS) {
  const originals = new Map();
  let applicable = true;
  for (const e of m.edits) {
    const file = path.join(ROOT, e.file);
    const text = originals.get(file) ?? readFileSync(file, 'utf8');
    originals.set(file, text);
    const count = text.split(e.search).length - 1;
    if (count !== (e.expectedCount ?? 1)) {
      console.log(`c3-mutation: FAIL ${m.id} — expected ${e.expectedCount ?? 1} occurrence(s) of the gate in ${e.file}, found ${count} (rebuild, or update this check with the code)`);
      applicable = false;
    }
  }
  if (!applicable) {
    failures++;
    continue;
  }
  try {
    const mutated = new Map(originals);
    for (const e of m.edits) {
      const file = path.join(ROOT, e.file);
      mutated.set(file, (mutated.get(file) ?? '').split(e.search).join(e.replace));
    }
    for (const [file, text] of mutated) writeFileSync(file, text);
    const caughtBy = m.runs.filter(({ cwd, tests }) => failed(spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: path.join(ROOT, cwd), encoding: 'utf8', shell: false, windowsHide: true, timeout: 600_000, env: TEST_ENV })));
    if (caughtBy.length > 0) {
      console.log(`c3-mutation: ok   ${m.id} (${m.gate}) — caught by ${caughtBy.map((r) => r.tests.join(',')).join(' + ')}`);
    } else {
      console.log(`c3-mutation: FAIL ${m.id} (${m.gate}) — no proof test caught the mutation`);
      failures++;
    }
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text);
  }
}
if (failures) {
  console.log(`c3-mutation: FAIL — ${failures} of ${MUTATIONS.length} mutation(s) not caught`);
  process.exit(1);
}
console.log(`c3-mutation: PASS — ${MUTATIONS.length}/${MUTATIONS.length} mutations caught`);
