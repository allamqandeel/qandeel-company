#!/usr/bin/env node
// R1 mutation check: proves the R1 Independent Core Review regression proofs are not vacuous.
//
// Each mutation re-introduces one defect the review fixed — it removes (or bypasses) the fix in the
// COMPILED output (packages/*/dist) — runs the R1 proof tests that must catch it, requires them to FAIL,
// and restores every file (always, in `finally`). Sources are never touched. Run after `npm run build`:
//
//   npm run r1:mutation
//
// A mutation the tests do not catch — or one that no longer applies because the guarded code moved —
// fails this script. The list is pinned by the verifier (rule `mutation-checks-pinned`).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Proof tests resolve the test-only Founder seam through the `qandeel-test` condition (D-C2-13).
const TEST_ENV = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=qandeel-test`.trim() };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOV = { cwd: 'packages/governance', tests: ['dist/test/r1-kernel.test.js'] };
const KERNEL = { cwd: 'packages/mind', tests: ['dist/test/r1-kernel.test.js'] };
const STORAGE = { cwd: 'packages/storage', tests: ['dist/test/r1-review.test.js'] };
const RUNTIME = { cwd: 'packages/runtime', tests: ['dist/test/r1/r1-runtime.test.js'] };

const G = 'packages/governance/dist/src';
const M = 'packages/mind/dist/src';
const S = 'packages/storage/dist/src';
const R = 'packages/runtime/dist/src';

const MUTATIONS = [
  {
    id: 'r1-01-tool-result-secret-stored',
    finding: 'R1-01',
    edits: [{ file: `${S}/governed-writes.js`, search: 'hasSecretNamedKey(outcome.result) || containsSecretMaterial(json)', replace: 'false', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-01-step-result-bounded-before-scan',
    finding: 'R1-01',
    edits: [{ file: `${S}/mind-writes.js`, search: "containsSecretMaterial(full) ? '[result withheld: secret material]'", replace: "containsSecretMaterial(full.slice(0, 2048)) ? '[result withheld: secret material]'", expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-01-secret-instructions-sent',
    finding: 'R1-01',
    edits: [{ file: `${R}/c2/employee-task.js`, search: 'if (containsSecretMaterial(instructions))', replace: 'if (false)', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r1-01-detector-misses-hyphenated-keys',
    finding: 'R1-01',
    edits: [{ file: `${M}/text.js`, search: '/\\bsk-ant-[A-Za-z0-9_-]{20,}/,', replace: '', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'r1-01-step-result-key-guard-dropped',
    finding: 'R1-01',
    edits: [{ file: `${S}/mind-writes.js`, search: 'return hasSecretNamedKey(JSON.parse(text));', replace: 'return false;', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-06-stale-pending-masks-decision',
    finding: 'R1-06',
    edits: [{ file: `${S}/governed-writes.js`, search: 'if (!pending || decidedDuringRun)', replace: 'if (!pending)', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-12-stale-knowledge-eligible',
    finding: 'R1-12',
    edits: [{ file: `${S}/mind-writes.js`, search: 'const kEligible = `x.data_class <= ? AND (x.market_ref IS NULL OR x.market_ref = ?) AND (x.review_at IS NULL OR x.review_at > ?)`;', replace: 'const kEligible = `x.data_class <= ? AND (x.market_ref IS NULL OR x.market_ref = ?) AND ? IS NOT NULL`;', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-02-tool-args-inherited-field',
    finding: 'R1-02',
    edits: [
      { file: `${G}/tools.js`, search: 'Object.hasOwn(schema.fields, k) ? schema.fields[k] : undefined', replace: 'schema.fields[k]', expectedCount: 1 },
      { file: `${G}/tools.js`, search: "if (!f || typeof f !== 'object')", replace: 'if (!f)', expectedCount: 1 },
    ],
    runs: [GOV, STORAGE],
  },
  {
    id: 'r1-03-step-base-ignored',
    finding: 'R1-03',
    edits: [{ file: `${R}/runtime.js`, search: 'return run.stepBase + step;', replace: 'return step;', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r1-03-step-range-unbounded',
    finding: 'R1-03',
    edits: [{ file: `${S}/governed-writes.js`, search: 'if (stepBase + GOVERNED_STEP_SPAN - 1 > MAX_GOVERNED_STEP) {', replace: 'if (false) {', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-09-store-contention-blamed-on-provider',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: 'if (providerFault) {', replace: 'if (true) {', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r1-09-over-bounds-usage-not-blamed',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: 'if (!u.withinBounds)', replace: 'if (false)', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    // Technical Lead exact-head follow-up: restores the 0ac427e split (money settled in one transaction,
    // the CONTRACT_VIOLATION hold written best effort in another).
    id: 'r1-09-provider-fault-hold-not-durable',
    finding: 'R1-09',
    edits: [
      { file: `${S}/governed-writes.js`, search: "if (r.purpose === 'MODEL_CALL' && r.deploymentId !== null && (!usage.withinBounds || providerFault))", replace: 'if (false)', expectedCount: 1 },
      { file: `${R}/c2/model-runtime.js`, search: 'if (usage.withinBounds)', replace: 'if (true)', expectedCount: 1 },
      { file: `${R}/c2/model-runtime.js`, search: 'recordHealth(store, fence, deploymentId, null);', replace: "recordHealth(store, fence, deploymentId, usage.withinBounds ? null : 'CONTRACT_VIOLATION');", expectedCount: 1 },
    ],
    runs: [STORAGE, RUNTIME],
  },
  {
    id: 'r1-09-malformed-answer-hold-split',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: 'containProviderFault(store, fence, reservationId, failure);', replace: "holdReservation(store, fence, reservationId, failure); recordHealth(store, fence, deploymentId, 'CONTRACT_VIOLATION');", expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    // Focused re-review of 59449c2: each unusable-usage branch has its own single-branch mutation.
    id: 'r1-09-unusable-usage-hold-split',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: "containProviderFault(store, fence, reservationId, 'USAGE_UNREPORTED');", replace: "holdReservation(store, fence, reservationId, 'USAGE_UNREPORTED'); recordHealth(store, fence, deploymentId, 'CONTRACT_VIOLATION');", expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r1-09-charged-unusable-usage-not-contained',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: "containProviderFault(store, fence, reservationId, 'USAGE_UNUSABLE');", replace: "holdReservation(store, fence, reservationId, 'USAGE_UNUSABLE');", expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    // Final re-review of b0ac2b7: the usage values are snapshotted (not only the object reference).
    id: 'r1-09-usage-snapshot-shallow',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: 'usage = snapshotUsage(result?.usage);', replace: 'usage = result?.usage;', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    // Final re-review of 8064fc9: a thrown failure's usage is snapshotted to values as well.
    id: 'r1-09-thrown-usage-snapshot-shallow',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: 'snapshotUsage(error.usage)', replace: 'error.usage', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r1-09-lazy-answer-read-escapes',
    finding: 'R1-09',
    edits: [
      { file: `${R}/c2/model-runtime.js`, search: 'usage = snapshotUsage(result?.usage);', replace: '/* mutation: the answer is not snapshotted */', expectedCount: 1 },
      { file: `${R}/c2/model-runtime.js`, search: 'return { ok: true, response: { outputText, usage } };', replace: 'return { ok: true, response: result };', expectedCount: 1 },
    ],
    runs: [RUNTIME],
  },
  {
    // Focused re-review: the provider-fault verdict of a charged failure is not carried into the settle.
    id: 'r1-09-charged-violation-verdict-dropped',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: "outcome: 'FAILED_CHARGED' }, providerFault);", replace: "outcome: 'FAILED_CHARGED' }, false);", expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r1-09-uncontained-filter-removed',
    finding: 'R1-09',
    edits: [
      { file: `${R}/c2/model-runtime.js`, search: 'routable(snapshot.deployments)', replace: 'snapshot.deployments', expectedCount: 1 },
      { file: `${R}/c2/model-runtime.js`, search: 'routable(fresh.deployments)', replace: 'fresh.deployments', expectedCount: 1 },
    ],
    runs: [RUNTIME],
  },
  {
    id: 'r1-09-uncontained-violator-routable',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: 'this.#uncontained.add(deploymentId);', replace: '/* mutation: an uncontained violator stays routable */', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r1-04-governed-reconciliation-unauthenticated',
    finding: 'R1-04',
    edits: [{ file: `${S}/store.js`, search: 'if (this.#read((ctx) => isGovernedJob(ctx, jobId)))', replace: 'if (false)', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-05-approval-releases-unresolved-dependencies',
    finding: 'R1-05',
    edits: [{ file: `${S}/governance.js`, search: 'if (deps.unresolved > 0) {', replace: 'if (false) {', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-06-c2-wait-not-rechecked',
    finding: 'R1-06',
    edits: [{ file: `${S}/runtime-authority.js`, search: 'txRecheckGovernedWait(ctx, wi, fence.runId, result.reasonCode);', replace: 'void wi; /* mutation: C2 wait re-check removed */', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-07-grant-does-not-wake-gap',
    finding: 'R1-07',
    edits: [{ file: `${S}/governance.js`, search: "wakeCapabilityGaps(ctx, employeeId, 'grant.created');", replace: '/* mutation: grant wake removed */', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-08-active-runs-keyed-by-job',
    finding: 'R1-08',
    edits: [
      { file: `${R}/runtime.js`, search: 'this.#active.set(claim.fence.runId, run);', replace: 'this.#active.set(claim.fence.jobId, run);', expectedCount: 1 },
      { file: `${R}/runtime.js`, search: 'this.#active.delete(claim.fence.runId);', replace: 'this.#active.delete(claim.fence.jobId);', expectedCount: 1 },
    ],
    runs: [RUNTIME],
  },
  {
    id: 'r1-09-accounting-failure-escapes',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: 'return this.#containAccountingFailure(store, fence, reservationId, d.deployment.id, providerFault);', replace: "throw new Error('mutation: accounting failure escapes');", expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r1-09-settle-backstop-removed',
    finding: 'R1-09',
    edits: [{ file: `${S}/runtime-authority.js`, search: 'txHoldUnsettledModelCalls(ctx, fence.runId);', replace: '/* mutation: settle backstop removed */', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-10-new-attempt-voids-refusal',
    finding: 'R1-10',
    edits: [{ file: `${S}/academy.js`, search: "closeUnfinishedAttempt(ctx, o, 'WORK_NOT_COMPLETED');", replace: "voidAttempt(ctx, o, 'WORK_NOT_COMPLETED');", expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-10-withdrawal-voids-refusal',
    finding: 'R1-10',
    edits: [{ file: `${S}/academy.js`, search: "closeUnfinishedAttempt(ctx, o, 'ENROLLMENT_WITHDRAWN');", replace: "voidAttempt(ctx, o, 'ENROLLMENT_WITHDRAWN');", expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-10-cancelled-shadow-refusal-skipped',
    finding: 'R1-10',
    edits: [{ file: `${S}/academy.js`, search: "const withdrawn = ['CANCELLED', 'SUPERSEDED'].includes(item.state);", replace: 'const withdrawn = false;', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-11-paused-reassignment-keeps-duty',
    finding: 'R1-11',
    edits: [{ file: `${S}/governance.js`, search: "(e.state === 'ACTIVE' || e.state === 'PAUSED')", replace: "(e.state === 'ACTIVE')", expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-11-on-leave-reassignment-unchecked',
    finding: 'R1-11',
    edits: [{ file: `${S}/governance.js`, search: "if (roleChanged && e.state === 'ON_LEAVE' && !targetCertified())", replace: 'if (false)', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-12-eligibility-after-limit',
    finding: 'R1-12',
    edits: [{ file: `${S}/mind-writes.js`, search: 'AND ${memEligible} AND ${memCurrent}', replace: 'AND ? IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    // The other half of R1-12: ineligible items must still leave their rejection evidence (D-C3-06).
    id: 'r1-12-rejection-evidence-dropped',
    finding: 'R1-12',
    edits: [{ file: `${S}/mind-writes.js`, search: 'new Map([...mEvidence, ...mConflict, ...mEligible])', replace: 'new Map([...mConflict, ...mEligible])', expectedCount: 1 }],
    runs: [STORAGE, { cwd: 'packages/storage', tests: ['dist/test/c3-review-fixes.test.js'] }],
  },
  {
    // Conflict-held memories must keep their own pool (the IMPORTANT-work CONFLICT_HOLD depends on it).
    id: 'r1-12-conflict-pool-dropped',
    finding: 'R1-12',
    edits: [{ file: `${S}/mind-writes.js`, search: 'new Map([...mEvidence, ...mConflict, ...mEligible])', replace: 'new Map([...mEvidence, ...mEligible])', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    // Only conflicts that can hold THIS work belong in the conflict pool (ineligible ones stay evidence).
    id: 'r1-12-conflict-pool-unrestricted',
    finding: 'R1-12',
    edits: [{ file: `${S}/mind-writes.js`, search: 'AND x.data_class <= ? AND (x.market_ref IS NULL OR x.market_ref = ?) AND EXISTS (SELECT 1 FROM memory_conflicts', replace: 'AND ? IS NOT NULL AND ? IS NOT NULL AND EXISTS (SELECT 1 FROM memory_conflicts', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-13-lower-layer-forges-marker',
    finding: 'R1-13',
    edits: [{ file: `${M}/context.js`, search: "(l === 'KNOWLEDGE' || l === 'MEMORY' || l === 'RECENT' ? neutralizeLayerMarkers(text) : text)", replace: '(void l, text)', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r1-final-decision-not-checkpointed',
    finding: 'B-F4',
    edits: [{ file: `${R}/c2/employee-task.js`, search: "phase: 'FINAL', pending: null", replace: "phase: 'MODEL', pending: null", expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r1-unbounded-proposal-code',
    finding: 'K4',
    edits: [{ file: `${G}/proposals.js`, search: 's.length <= 64 &&', replace: '', expectedCount: 1 }],
    runs: [GOV],
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
    if (!originals.has(file)) originals.set(file, readFileSync(file, 'utf8'));
    const count = (originals.get(file) ?? '').split(e.search).length - 1;
    if (count !== (e.expectedCount ?? 1)) {
      console.log(`r1-mutation: FAIL ${m.id} — expected ${e.expectedCount ?? 1} occurrence(s) of the fix in ${e.file}, found ${count} (rebuild, or update this check with the code)`);
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
      console.log(`r1-mutation: ok   ${m.id} (${m.finding}) — caught by ${caughtBy.map((r) => r.tests.join(',')).join(' + ')}`);
    } else {
      console.log(`r1-mutation: FAIL ${m.id} (${m.finding}) — no proof test caught the mutation`);
      failures++;
    }
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text);
  }
}
if (failures) {
  console.log(`r1-mutation: FAIL — ${failures} of ${MUTATIONS.length} mutation(s) not caught`);
  process.exit(1);
}
console.log(`r1-mutation: PASS — ${MUTATIONS.length}/${MUTATIONS.length} mutations caught`);
