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
const STORAGE_FIXES = { cwd: 'packages/storage', tests: ['dist/test/c3-review-fixes.test.js'] };
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
      { file: `${STORE}/mind-writes.js`, search: "          OR (x.scope = 'RESTRICTED' AND x.scope_ref IN (SELECT value FROM json_each(?))))", replace: "          OR (x.scope IN ('RESTRICTED', 'FOUNDER_ONLY') AND ? IS NOT NULL))" },
      { file: `${STORE}/mind-writes.js`, search: '        if (!knowledgeReadable(k, access))\n            continue; // defence in depth: re-checked in code\n', replace: '        /* mutation: knowledge re-check removed */\n' },
    ],
    runs: [STORAGE],
  },
  {
    id: 'memory-other-employee-visible',
    gate: 'an Employee\'s memory pool is its own (term index owner and row owner)',
    edits: [
      { file: `${STORE}/mind-writes.js`, search: 'WHERE t.item_kind = ? AND t.owner_key = ? AND t.term IN', replace: 'WHERE t.item_kind = ? AND (t.owner_key = ? OR 1) AND t.term IN' },
      { file: `${STORE}/mind-writes.js`, search: "x.employee_id = ? AND x.integrity", replace: "(x.employee_id = ? OR 1) AND x.integrity" },
      { file: `${STORE}/mind-writes.js`, search: "AND employee_id = ? AND integrity = 'OK' AND status IN ('ACTIVE', 'LOW_CONFIDENCE')`", replace: "AND (employee_id = ? OR 1) AND integrity = 'OK' AND status IN ('ACTIVE', 'LOW_CONFIDENCE')`" },
    ],
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
    edits: [{ file: `${STORE}/governed-writes.js`, search: '    if (!gate.ok) {', replace: '    if (false) { /* mutation: capability gate removed */' }],
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
    id: 'conflict-resolution-no-wake',
    gate: 'resolving a memory conflict wakes the work held for it',
    edits: [
      { file: `${STORE}/memory.js`, search: "        wakeEmployeeWaits(ctx, owner, ['MEMORY_CONFLICT_REVIEW'], 'memory.conflict_resolved');", replace: '        void owner; /* mutation: conflict wake removed */' },
      // Defence in depth: a held memory leaving live state wakes too — remove both.
      { file: `${STORE}/mind-core.js`, search: "wakeEmployeeWaits(ctx, m.employeeId, ['MEMORY_CONFLICT_REVIEW'], 'memory.conflict_member_retired');", replace: 'void 0; /* mutation: member wake removed */' },
    ],
    runs: [STORAGE_FIXES],
  },
  {
    id: 'capability-wait-not-rechecked',
    gate: 'a WAIT on a capability gap re-checks the gate in the settle transaction (no lost wake)',
    edits: [{ file: `${STORE}/runtime-authority.js`, search: '                txRecheckCapabilityWait(ctx, wi);', replace: '                void wi; /* mutation: settle re-check removed */' }],
    runs: [STORAGE_FIXES],
  },
  {
    id: 'processor-supplied-recent-results',
    gate: 'recent results come only from durable step records, the newest required',
    edits: [{ file: `${STORE}/mind-writes.js`, search: "layer: 'RECENT', required: i === 0,", replace: "layer: 'RECENT', required: true," }],
    runs: [STORAGE_FIXES],
  },
  {
    id: 'canonical-binds-only-if-relevant',
    gate: 'canonical claims bind whether or not the statement is relevant',
    edits: [{ file: `${MIND}/context.js`, search: "        else if (c.kind !== 'CANONICAL' && c.claimKey !== null && canonicalClaims.has(c.claimKey) && canonicalClaims.get(c.claimKey) !== c.claimValue)", replace: "        else if (false)" }, { file: `${MIND}/context.js`, search: '    for (const [k, v] of canonicalClaims)', replace: '    for (const [k, v] of [])' }],
    runs: [KERNEL],
  },
  {
    id: 'probation-fail-no-new-epoch',
    gate: 'a failed probation opens a new evidence epoch (old shadow cases never count again)',
    edits: [{ file: `${STORE}/academy.js`, search: "AND kind = 'CASE' AND positive = 1 AND epoch = ?`, e.id, e.evidenceEpoch)", replace: "AND kind = 'CASE' AND positive = 1 AND epoch <= ?`, e.id, e.evidenceEpoch)" }],
    runs: [STORAGE_FIXES],
  },
  {
    id: 'rubric-ignores-refused-actions',
    gate: 'a refused external action in an attempt fails AUTHORITY_COMPLIANCE',
    edits: [{ file: `${STORE}/academy.js`, search: "action IN ('authority.denied', 'tool.refused', 'tool.review_required')", replace: "action IN ('authority.denied')" }],
    runs: [STORAGE],
  },
  {
    id: 'licence-review-skipped',
    gate: 'a licence with obligations never reaches quarantine without a recorded review',
    edits: [{ file: `${STORE}/skill-registry.js`, search: "            if (to === 'SECURITY_QUARANTINE' && !LICENSE_CLEARED.includes(v.licenseStatus))", replace: '            if (false)' }],
    runs: [STORAGE_FIXES],
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
  {
    id: 'context-hold-not-rechecked',
    gate: 'a conflict resolved before the park is re-checked at the WAIT settle',
    edits: [{ file: `${STORE}/runtime-authority.js`, search: 'txRecheckContextHold(ctx, wi, result.reasonCode);', replace: 'void 0; /* mutation: hold re-check removed */' }],
    runs: [STORAGE_FIXES],
  },
  {
    id: 'term-limit-before-filter',
    gate: 'the term index filters to live items before its limit',
    edits: [{ file: `${STORE}/mind-writes.js`, search: 'AND (${live.where})', replace: 'AND (${live.where} OR 1)' }],
    runs: [STORAGE_FIXES],
  },
  {
    id: 'compaction-crosses-markets',
    gate: 'compaction never summarizes market-bound memories',
    edits: [
      { file: `${STORE}/mind-writes.js`, search: 'x.c.marketRef === null && x.c.status', replace: 'x.c.status' },
      { file: `${STORE}/mind-writes.js`, search: 'AND market_ref IS NULL AND (review_at', replace: 'AND (review_at' },
    ],
    runs: [STORAGE_FIXES],
  },
  {
    id: 'failed-attempt-hides-breach',
    gate: 'a refused action is scored even when the attempt fails',
    edits: [{ file: `${STORE}/academy.js`, search: 'if (denials > 0) {', replace: 'if (false) {' }],
    runs: [STORAGE_FIXES],
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
