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
    edits: [{ file: `${S}/governed-writes.js`, search: 'keyedSecretJson(json) || containsSecretMaterial(json)', replace: 'false', expectedCount: 1 }],
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
    id: 'r2-03-freed-headroom-wakes-nothing',
    finding: 'R2-03',
    edits: [{ file: `${S}/governance-core.js`, search: "admitBudgetWaiters(ctx, chain.map((b) => b.id), 'budget.freed');", replace: 'void chain; /* mutation: settle / release wake no budget waiter */', expectedCount: 2 }],
    runs: [STORAGE],
  },
  {
    id: 'r2-03-budget-wake-ignores-headroom',
    finding: 'R2-03',
    edits: [{ file: `${S}/governance-core.js`, search: 'const amount = admissibleAmount(w, remaining);', replace: 'const amount = (void remaining, { money: 0, tokens: 0 }); /* mutation: every waiter is admitted, fitting or not */', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r2-03-budget-recheck-ignores-freed-headroom',
    finding: 'R2-03',
    edits: [{ file: `${S}/governed-writes.js`, search: "        admitBudgetWaiters(ctx, null, 'budget.rechecked', jobId);", replace: '        void jobId; /* mutation: the WAIT settle never re-checks a budget wait */', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'rr2-1-budget-wake-ignores-recorded-need',
    finding: 'RR2-1',
    edits: [{ file: `${S}/governance-core.js`, search: '    if (w.need === null) {\n', replace: '    if (w.need !== undefined) { /* mutation: any headroom admits (the storm) */\n', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'rr2-1-budget-need-not-recorded',
    finding: 'RR2-1',
    edits: [{ file: `${S}/governed-writes.js`, search: "        recordBudgetWaitNeed(ctx, { jobId: job.id, runId: fence.runId, workItemId: a.workItemId }, refused, check.dimension, refused.scope === 'RUN' ? wiChain[0] : refused, input.money, input.tokens);\n", replace: '        void refused; /* mutation: the refusal forgets what it needed */\n', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'rr2-1-budget-wake-ignores-fresh-run-cap',
    finding: 'RR2-1',
    edits: [{ file: `${S}/governance-core.js`, search: '    if (need.money > runCapMoney || need.tokens > runCapTokens)\n        return null;\n', replace: '    /* mutation: a need above the per-run cap is woken anyway */\n', expectedCount: 1 }],
    runs: [STORAGE],
  },
  // --- FA-1 (R2-03 family, architecture correction): budget capacity is admitted, not broadcast ---
  {
    id: 'fa1-admission-not-subtracted',
    finding: 'FA-1',
    edits: [{ file: `${S}/governance-core.js`, search: '            r.money -= amount.money;\n            r.tokens -= amount.tokens;\n', replace: '            void r; /* mutation: the pass never subtracts what it admitted (every fitting waiter wakes) */\n', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'fa1-reservation-ignores-admissions',
    finding: 'FA-1',
    edits: [{ file: `${S}/governance-core.js`, search: '        const held = admittedOn(ctx, b.id, exceptJobId);\n', replace: '        const held = (void exceptJobId, { money: 0, tokens: 0 }); /* mutation: a reservation takes admitted headroom */\n', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'fa1-release-not-readmitted',
    finding: 'FA-1',
    edits: [{ file: `${S}/governance-core.js`, search: "    if (readmit)\n        admitBudgetWaiters(ctx, JSON.parse(row.levels_json), 'budget.readmitted');\n", replace: '    void readmit; /* mutation: a released admission is a lost wake */\n', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'fa1-admission-never-consumed',
    finding: 'FA-1',
    edits: [{ file: `${S}/governed-writes.js`, search: '    consumeBudgetAdmission(ctx, job.id, { id, money: input.money, tokens: input.tokens });\n', replace: '    /* mutation: the reservation never consumes its admission (capacity counted twice) */\n', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'fa1-job-exit-keeps-admission',
    finding: 'FA-1',
    edits: [
      { file: `${S}/work-core.js`, search: "    releaseBudgetAdmission(ctx, job.id, 'JOB_LEFT_QUEUE');\n", replace: '    /* mutation: a withdrawn job keeps its admitted capacity */\n', expectedCount: 1 },
      { file: `${S}/queue.js`, search: "        releaseBudgetAdmission(ctx, job.id, 'JOB_LEFT_QUEUE');\n", replace: '        /* mutation: a job leaving the queue keeps its admitted capacity */\n', expectedCount: 1 },
    ],
    runs: [STORAGE],
  },  {
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
    edits: [{ file: `${R}/c2/provider-boundary.js`, search: "if (u.state === 'UNUSABLE' || !u.withinBounds)", replace: "if (u.state === 'UNUSABLE')", expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    // Technical Lead exact-head follow-up: restores the 0ac427e split (money settled in one transaction,
    // the CONTRACT_VIOLATION hold written best effort in another).
    id: 'r1-09-provider-fault-hold-not-durable',
    finding: 'R1-09',
    edits: [
      { file: `${S}/governed-writes.js`, search: "if (r.purpose === 'MODEL_CALL' && r.deploymentId !== null && (!usage.withinBounds || providerFault))", replace: 'if (false)', expectedCount: 1 },
      { file: `${R}/c2/model-runtime.js`, search: "outcome: 'OK' }, s.providerFault);", replace: "outcome: 'OK' });", expectedCount: 1 },
      { file: `${R}/c2/model-runtime.js`, search: 'if (!s.providerFault)', replace: 'if (true)', expectedCount: 1 },
      { file: `${R}/c2/model-runtime.js`, search: 'recordHealth(store, fence, deploymentId, null);', replace: "recordHealth(store, fence, deploymentId, s.providerFault ? 'CONTRACT_VIOLATION' : null);", expectedCount: 1 },
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
    // Provider-boundary hardening (Technical Lead): one boundary reads every provider-controlled field
    // exactly once. This mutation re-reads a usage field after capture (the b0ac2b7 / 8064fc9 family).
    id: 'r1-09-boundary-field-read-twice',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/provider-boundary.js`, search: 'return { inputTokens, outputTokens, cachedInputTokens };', replace: 'return { inputTokens, outputTokens: r.outputTokens, cachedInputTokens };', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    // The thrown class is validated as a listed value before use (the b309b11 family).
    id: 'r1-09-boundary-class-unlisted',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/provider-boundary.js`, search: "listedFailureClass(failure) ?? 'UNKNOWN'", replace: 'failure', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    // Disposition lookup is own-key only: prototype keys never select a disposition.
    id: 'r1-09-disposition-prototype-key',
    finding: 'R1-09',
    edits: [{ file: `${G}/providers.js`, search: 'Object.hasOwn(FAILURE_DISPOSITIONS, failure)', replace: 'failure in FAILURE_DISPOSITIONS', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    // A thrown failure class is read once in the exported classifier as well.
    id: 'r1-09-failure-class-read-twice',
    finding: 'R1-09',
    edits: [{ file: `${G}/providers.js`, search: "? failure : 'UNKNOWN'", replace: "? error.failure : 'UNKNOWN'", expectedCount: 1 }],
    runs: [GOV],
  },
  {
    // Technical Lead decision: a charged (FAILED_CHARGED) attempt is never retried on the same deployment.
    id: 'r1-09-charged-attempt-retried',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: "if (settled.accounting === 'UNBILLED' && mayRetry(disp.retry, retries, policy)) {", replace: "if (settled.accounting !== 'HELD' && mayRetry(disp.retry, retries, policy)) {", expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    // Boundary sweep: runtime-control outcomes are private markers a provider answer can never equal.
    id: 'r1-09-control-marker-forgeable',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: 'if (result === TIMED_OUT || result === CANCELLED) {', replace: "if (result === TIMED_OUT || result === CANCELLED || result === 'TIMEOUT' || result === 'CANCELLED') {", expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    // A provider field read that throws escapes the boundary instead of becoming a contract violation.
    id: 'r1-09-lazy-answer-read-escapes',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/provider-boundary.js`, search: "return failureSnapshot('CONTRACT_VIOLATION');", replace: "throw new Error('mutation: a provider read escapes the boundary');", expectedCount: 3 }],
    runs: [RUNTIME],
  },
  {
    // Focused re-review: the provider-fault verdict of a charged failure is not carried into the settle.
    id: 'r1-09-charged-violation-verdict-dropped',
    finding: 'R1-09',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: "outcome: 'FAILED_CHARGED' }, s.providerFault);", replace: "outcome: 'FAILED_CHARGED' }, false);", expectedCount: 1 }],
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
    edits: [{ file: `${R}/c2/model-runtime.js`, search: 'return this.#containAccountingFailure(store, fence, reservationId, d.deployment.id, provided.providerFault);', replace: "throw new Error('mutation: accounting failure escapes');", expectedCount: 1 }],
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
    edits: [{ file: `${R}/c2/employee-task.js`, search: "phase: 'FINAL', pending: null, summaryCode: proposal.summaryCode", replace: "phase: 'MODEL', pending: null, summaryCode: proposal.summaryCode", expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r1-unbounded-proposal-code',
    finding: 'K4',
    edits: [{ file: `${G}/proposals.js`, search: 's.length <= 64 &&', replace: '', expectedCount: 1 }],
    runs: [GOV],
  },
  // --- R2-10: the R1-09 boundary applied to tool drivers (read once, frozen plain data, screened code) ---
  {
    id: 'r2-10-raw-tool-answer-passed-on',
    finding: 'R2-10',
    edits: [{ file: `${R}/c2/tool-executor.js`, search: 'return toolAnswerSnapshot(r);', replace: 'return r;', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r2-10-tool-result-not-reparsed',
    finding: 'R2-10',
    edits: [{ file: `${R}/c2/tool-boundary.js`, search: 'parsed = JSON.parse(canonicalJson(result));', replace: 'parsed = result;', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r2-10-secret-driver-code-recorded',
    finding: 'R2-10 / m-17',
    edits: [
      { file: `${R}/c2/tool-boundary.js`, search: 'CODE.test(code) && !containsSecretMaterial(code) ?', replace: 'CODE.test(code) ?', expectedCount: 1 },
      { file: `${S}/governed-writes.js`, search: '.test(code) && !containsSecretMaterial(code) ?', replace: '.test(code) ?', expectedCount: 1 },
    ],
    runs: [RUNTIME],
  },
  {
    id: 'r2-10-storage-code-unscreened',
    finding: 'R2-10 / m-17',
    edits: [{ file: `${S}/governed-writes.js`, search: '.test(code) && !containsSecretMaterial(code) ?', replace: '.test(code) ?', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r2-10-storage-rereads-outcome',
    finding: 'R2-10',
    edits: [{ file: `${S}/governed-writes.js`, search: 'const outcome = captureToolOutcome(input);', replace: 'const outcome = input;', expectedCount: 1 }],
    runs: [STORAGE],
  },
  {
    id: 'r2-10-storage-guard-reads-driver-object',
    finding: 'R2-10',
    edits: [{ file: `${S}/governed-writes.js`, search: 'if (keyedSecretJson(json) || containsSecretMaterial(json))', replace: 'if (hasSecretNamedKey(input.result) || containsSecretMaterial(json))', expectedCount: 1 }],
    runs: [STORAGE],
  },
  // --- R2-12: one run-failure vocabulary; local and configuration causes are never the provider ---
  {
    id: 'r2-12-local-settlement-blamed-on-provider',
    finding: 'R2-12',
    edits: [{ file: `${R}/c2/model-runtime.js`, search: "{ kind: 'UNAVAILABLE', code: 'SETTLEMENT_FAILED' }", replace: "{ kind: 'UNCERTAIN', failure: 'UNKNOWN' }", expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r2-12-vocabulary-incomplete',
    finding: 'R2-12',
    edits: [{ file: `${G}/run-failures.js`, search: 'REASONING_ABOVE_CEILING: null,', replace: '', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'r2-12-pg11-family-invented',
    finding: 'R2-12 / PG-11',
    edits: [{ file: `${G}/run-failures.js`, search: 'PROVIDER_INVALID_REQUEST: null,', replace: "PROVIDER_INVALID_REQUEST: 'PROVIDER',", expectedCount: 1 }],
    runs: [RUNTIME],
  },
];

function failed(r) {
  return r.status !== 0 && (/^# fail [1-9]/m.test(r.stdout ?? '') || /^ℹ fail [1-9]/m.test(r.stdout ?? ''));
}

// --shard i/n (1-based) runs a disjoint slice (CI parallelism); --report <file> records the ids this
// invocation ran, so the CI quality gate can prove that every recorded mutation ran exactly once (parity).
const shardArg = process.argv.includes('--shard') ? String(process.argv[process.argv.indexOf('--shard') + 1]) : '1/1';
const reportFile = process.argv.includes('--report') ? String(process.argv[process.argv.indexOf('--report') + 1]) : null;
const [shardIndex, shardCount] = shardArg.split('/').map(Number);
if (!(Number.isInteger(shardIndex) && Number.isInteger(shardCount) && shardCount >= 1 && shardIndex >= 1 && shardIndex <= shardCount)) throw new Error(`--shard must be i/n with 1 <= i <= n (got ${shardArg})`);
const ran = [];
let failures = 0;
let index = -1;
for (const m of MUTATIONS) {
  index++;
  if (index % shardCount !== shardIndex - 1) continue;
  ran.push(m.id);
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
if (reportFile) writeFileSync(reportFile, `${JSON.stringify({ script: 'r1:mutation', shard: shardArg, total: MUTATIONS.length, ran }, null, 2)}\n`);
if (failures) {
  console.log(`r1-mutation: FAIL — ${failures} of ${ran.length} mutation(s) not caught`);
  process.exit(1);
}
console.log(`r1-mutation: PASS — ${ran.length}/${ran.length} mutations caught (shard ${shardArg}, ${MUTATIONS.length} total)`);
