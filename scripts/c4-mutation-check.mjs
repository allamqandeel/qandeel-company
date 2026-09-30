#!/usr/bin/env node
// C4 mutation check: proves the C4 Organization / Delegation / Review / P-07 gates are not vacuous.
//
// Each mutation removes (or bypasses) one gate in the COMPILED output (packages/*/dist) — some need two
// coordinated edits where the gate is enforced twice — runs the proof tests that must catch it, requires
// them to FAIL, and restores every file (always, in `finally`). Sources are never touched. Run after
// `npm run build`:
//
//   npm run c4:mutation                          all mutations
//   npm run c4:mutation -- --shard 2/3           the second of three disjoint shards (CI parallelism)
//   npm run c4:mutation -- --report <file.json>  also write the ids run / caught (CI proof parity)
//
// A mutation the tests do not catch — or one that no longer applies because the guarded code moved — fails
// this script.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Proof tests resolve the test-only Founder seam through the `qandeel-test` condition (D-C2-13).
const TEST_ENV = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=qandeel-test`.trim() };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = { cwd: 'packages/governance', tests: ['dist/test/c4-kernel.test.js'] };
const ORG = { cwd: 'packages/storage', tests: ['dist/test/c4-organization.test.js'] };
const REVIEW = { cwd: 'packages/storage', tests: ['dist/test/c4-review.test.js'] };
const C2GOV = { cwd: 'packages/storage', tests: ['dist/test/c2-governance.test.js'] };
const RUNTIME = { cwd: 'packages/runtime', tests: ['dist/test/c4/c4-runtime.test.js'] };

const GOV = 'packages/governance/dist/src';
const STORE = 'packages/storage/dist/src';
const RT = 'packages/runtime/dist/src';

const MUTATIONS = [
  {
    id: 'c4-org-act-grant-bypassed',
    gate: 'Title ≠ Authority: an organizational act needs an explicit grant, whatever the seat',
    edits: [{ file: `${STORE}/org-writes.js`, search: '    if (capability !== null) {', replace: '    if (false) { /* mutation: grant check removed */', expectedCount: 1 }],
    runs: [ORG],
  },
  {
    id: 'c4-org-seat-eligibility-removed',
    gate: 'a grant alone is not enough: Directors file for their own Department, only the CEO seat synthesizes / decides / hires',
    edits: [{ file: `${STORE}/org-writes.js`, search: "refuse('SEAT_NOT_HELD');", replace: 'void 0;', expectedCount: 4 }],
    runs: [ORG],
  },
  {
    id: 'c4-delegation-limits-ignored',
    gate: 'a delegated staffing decision stays inside every policy limit of its delegation',
    edits: [{ file: `${STORE}/org-writes.js`, search: '    if (!verdict.ok)\n        refuse(verdict.reason);\n', replace: '    /* mutation: delegation limits ignored */\n', expectedCount: 1 }],
    runs: [ORG],
  },
  {
    id: 'c4-delegation-cycle-allowed',
    gate: 'work never bounces back along its own delegation chain (A → B → A)',
    edits: [{ file: `${STORE}/org-writes.js`, search: "        refuse('DELEGATION_CYCLE');", replace: '        void 0;', expectedCount: 1 }],
    runs: [ORG],
  },
  {
    id: 'c4-delegation-outside-reporting-line',
    gate: 'work is delegated down the reporting line only; across Departments it is a support request',
    edits: [{ file: `${STORE}/org-writes.js`, search: 'if (!reportsTo(ctx, e.id, delegateId, action))', replace: 'if (false)', expectedCount: 1 }],
    runs: [ORG],
  },
  {
    id: 'c4-self-review-allowed',
    gate: 'the executor never reviews its own work',
    edits: [{ file: `${STORE}/review-core.js`, search: '...(executor ? [executor] : []), ', replace: '', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4-quality-hold-ignored-in-selection',
    gate: 'reviewer selection excludes held reviewers before the ranking LIMIT',
    edits: [{ file: `${STORE}/review-core.js`, search: "          AND NOT EXISTS (SELECT 1 FROM quality_holds h WHERE h.state = 'ACTIVE' AND (\n", replace: "          AND NOT EXISTS (SELECT 1 FROM quality_holds h WHERE 0 AND (\n", expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4-decision-not-rechecked',
    gate: 'a reviewer\'s eligibility is re-checked at the decision boundary',
    edits: [{ file: `${STORE}/review-core.js`, search: '        if (qualificationVersion === null) {', replace: '        if (false) {', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4-stale-subject-decision-counts',
    gate: 'a decision about a subject that has since changed is refused as stale',
    edits: [{ file: `${STORE}/review-core.js`, search: '    if (stale) {', replace: '    if (false) {', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4-action-review-gate-removed',
    gate: 'R2 / R3 actions need an independent review of exactly that action',
    edits: [{ file: `${STORE}/governed-writes.js`, search: "if (decision.review === 'INDEPENDENT') {", replace: 'if (false) {', expectedCount: 1 }],
    runs: [REVIEW, C2GOV],
  },
  {
    id: 'c4-action-review-reusable',
    gate: 'a satisfied action review authorizes exactly one intent',
    edits: [{ file: `${STORE}/governed-writes.js`, search: '        consumeActionReview(ctx, reviewRequestId, invocationId);', replace: '        void reviewRequestId;', expectedCount: 1 }],
    runs: [C2GOV],
  },
  {
    id: 'c4-rejected-action-rereviewed',
    gate: 'an action a reviewer rejected stays rejected (it is not re-reviewed until approved)',
    edits: [{ file: `${STORE}/review-core.js`, search: "        if (rejected)\n            return { kind: 'REWORK', requestId: rejected.id };\n", replace: '        /* mutation: rejection forgotten */\n', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4-review-wait-not-rechecked',
    gate: 'a review decided while the executor is still claimed is not a lost wake',
    edits: [{ file: `${STORE}/governed-writes.js`, search: '        recheckReviewWait(ctx, workItemId, runId);\n        return;', replace: '        return;', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4-delegation-wait-free-wake',
    gate: 'an offered handoff is not an answer: the delegator\'s wait is not a free wake (no model loop)',
    edits: [{ file: `${STORE}/governed-writes.js`, search: '        if (answered || !open)', replace: '        if (true)', expectedCount: 1 }],
    runs: [ORG],
  },
  {
    id: 'c4-open-handoff-completes',
    gate: 'work with an open handoff does not finish; it waits for its delegates',
    edits: [{ file: `${RT}/c2/employee-task.js`, search: 'if (gov.openHandoffs() > 0) {', replace: 'if (false) {', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'c4-open-handoff-set-narrowed',
    gate: 'R2-04: one open-handoff set — an escalated handoff parks the delegator (no re-run per WAIT settle)',
    edits: [{ file: `${STORE}/org-core.js`, search: "export const OPEN_HANDOFF_STATES = ['OFFERED', 'ACCEPTED', 'CLARIFICATION_REQUESTED', 'ESCALATED'];", replace: "export const OPEN_HANDOFF_STATES = ['OFFERED', 'ACCEPTED'];", expectedCount: 1 }],
    runs: [ORG, RUNTIME],
  },
  {
    id: 'c4-delegator-waits-on-own-clarification',
    gate: 'R2-04: a delegate\'s pending question is answered by the delegator\'s next turn, never waited on',
    edits: [{ file: `${RT}/c2/employee-task.js`, search: '                    if (gov.clarificationsRequested() > 0) {\n', replace: '                    if (false) { /* mutation: the delegator parks on its own pending question */\n', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'rr2-2-final-refusal-silent',
    gate: 'RR2-2: a FINAL refused for a pending question is told to the model (a step result), never a silent continue',
    edits: [{ file: `${RT}/c2/employee-task.js`, search: "                        gov.refuseFinal(s.turn, 'FINAL_REFUSED_CLARIFICATION_PENDING');\n", replace: '                        /* mutation: the refusal is silent */\n', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'rr2-2-failed-delegator-keeps-children',
    gate: 'RR2-2: a delegator that FAILS cancels the work it delegated (no child left waiting under a dead parent)',
    edits: [{ file: `${STORE}/work-core.js`, search: '    if (to === \'FAILED\')\n        cancelDelegatedChildren(ctx, item.id, opts.trace);\n', replace: '    /* mutation: a FAILED delegator leaves its delegated work running */\n', expectedCount: 1 }],
    runs: [ORG],
  },
  {
    id: 'rr2-5-rework-under-ended-lineage',
    gate: 'RR2-5: work never re-enters the queue under an ended delegator (retained completed child sent back to rework)',
    edits: [{ file: `${STORE}/work-core.js`, search: '    if (ended !== null) {', replace: '    if (false) { /* mutation: re-queued under a dead parent */', expectedCount: 1 }],
    runs: [ORG],
  },
  {
    id: 'c4-restart-answers-clarification',
    gate: 'm-01: starting work again accepts only an OFFERED handoff (a pending question stays open)',
    edits: [{ file: `${STORE}/org-core.js`, search: "AND delegate_employee_id = ? AND state = 'OFFERED'`", replace: "AND delegate_employee_id = ? AND state IN ('OFFERED', 'CLARIFICATION_REQUESTED')`", expectedCount: 1 }],
    runs: [ORG],
  },
  {
    id: 'c4-p07-reservation-unchecked',
    gate: 'P-07: the reserving transaction refuses a charged-failure deployment for the same Work Item',
    edits: [{ file: `${STORE}/governed-writes.js`, search: 'if (chargedExclusions(ctx, a.workItemId).includes(input.deploymentId))', replace: 'if (false)', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4-p07-router-unfiltered',
    gate: 'P-07: the router never proposes a charged-failure deployment for the same Work Item',
    edits: [{ file: `${RT}/c2/model-runtime.js`, search: 'const excluded = new Set(governance.chargedExclusions(run.workItemId));', replace: 'const excluded = new Set();', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'c4-p07-release-covers-future',
    gate: 'P-07: a Founder release covers only the failures that existed when it was recorded',
    edits: [{ file: `${STORE}/governance-core.js`, search: 'AND covered_failures >= ? LIMIT 1', replace: 'AND covered_failures >= 0 * ? LIMIT 1', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4-acting-never-expires',
    gate: 'acting coverage is bounded: it ends by time',
    edits: [{ file: `${GOV}/organization.js`, search: '    return a.effectiveFrom <= at && (a.effectiveTo === null || at < a.effectiveTo);', replace: '    return a.effectiveFrom <= at;', expectedCount: 1 }],
    runs: [KERNEL, ORG],
  },
  {
    id: 'c4-acting-authority-outlives-cover',
    gate: 'authority delegated for acting coverage ends with the coverage',
    edits: [{ file: `${STORE}/org-core.js`, search: "        revokeActingDelegations(ctx, a.id, 'ACTING_EXPIRED', SYSTEM_ORG_REF);", replace: '        void 0;', expectedCount: 1 }],
    runs: [ORG],
  },
  {
    id: 'c4-ceo-needs-department',
    gate: 'a company-scoped executive run is budgeted under the Company, never a fake Department',
    edits: [{ file: `${STORE}/governed-writes.js`, search: "        return dept?.scope === 'COMPANY' ? chain : null;", replace: '        return null;', expectedCount: 1 }],
    runs: [ORG],
  },
  {
    id: 'c4-calibration-counted-twice',
    gate: 'calibration evidence counts once per shadow decision',
    edits: [{ file: `${STORE}/review-core.js`, search: "    if (ctx.db.get('SELECT 1 AS x FROM review_calibrations WHERE decision_id = ?', decisionId))\n        return 'ALREADY_CALIBRATED';\n", replace: '    /* mutation: calibration once-guard removed */\n', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4-promotion-without-evidence',
    gate: 'independent review authority needs Gold cases and calibration evidence',
    edits: [{ file: `${STORE}/review.js`, search: '            if (gaps.length > 0)', replace: '            if (false)', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4-org-managed-reassignable',
    gate: 'an organization-managed Employee is placed only through Position assignments',
    edits: [{ file: `${STORE}/governance.js`, search: 'if (isOrgManaged(ctx, id) &&', replace: 'if (false &&', expectedCount: 1 }],
    runs: [ORG],
  },
  {
    id: 'c4-staffing-alternatives-optional',
    gate: 'a staffing request must address every Stage 10 alternative before a persistent Employee',
    edits: [{ file: `${GOV}/organization.js`, search: "            throw new QandeelError('VALIDATION_FAILED', 'every Stage 10 staffing alternative must be addressed before a persistent employee', { field: `alternatives.${k}`, reason: 'STAFFING_EVIDENCE_INCOMPLETE' });", replace: "            return [k, String(v ?? '')];", expectedCount: 1 }],
    runs: [KERNEL, ORG],
  },
  // R2 K1 (docs/R2_FULL_STRONG_V1_INDEPENDENT_REVIEW_REPORT.md §8): review integrity and Review Pool eligibility.
  {
    id: 'c4r2-executor-redesigns-own-plan',
    gate: 'R2-01: the executor never supersedes the Review Plan of its own work (the application refusal, ahead of the 0011 trigger)',
    edits: [{ file: `${STORE}/org-writes.js`, search: "refuse('SELF_REVIEW_REDESIGN');", replace: 'void 0;', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4r2-rework-scoped-by-plan',
    gate: 'R2-01: a rejected exact action stays rejected under every later plan version (D-C4-05)',
    edits: [{ file: `${STORE}/review-core.js`, search: "AND state = 'REWORK' LIMIT 1`, s.item.id, s.fingerprint);", replace: "AND state = 'REWORK' AND plan_id = ? LIMIT 1`, s.item.id, s.fingerprint, plan.id);", expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4r2-stranded-action-wait-not-woken',
    gate: 'R2-02: a plan change wakes the executor parked on its action review (supersession, a newly applying plan, the WAIT settle, restart)',
    edits: [{ file: `${STORE}/review-core.js`, search: "wakeWorkItemJob(ctx, workItemId, ['AWAITING_INDEPENDENT_REVIEW'], 'review.plan_changed');", replace: 'void 0;', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4r2-manager-key-department-bound',
    gate: 'R2-07: the decision re-check exempts the MANAGER key from department independence, exactly as selection does',
    edits: [{ file: `${STORE}/review-core.js`, search: "a.keyKind !== 'MANAGER' && a.keyKind !== 'SHADOW'", replace: "a.keyKind !== 'SHADOW'", expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4r2-manager-key-filled-last',
    gate: 'R2-07: MANAGER / FOUNDER keys are filled before a SPECIALIST key the manager could otherwise take',
    edits: [{ file: `${STORE}/review-core.js`, search: "(kind === 'MANAGER' || kind === 'FOUNDER' ? 0 : 1)", replace: '(0)', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4r2-withdrawn-reviewer-excluded-forever',
    gate: 'R2-07 / m-12: only reviewers holding or having decided a key (or who abandoned it) are excluded from the subject',
    edits: [{ file: `${STORE}/review-core.js`, search: "(a.state === 'ASSIGNED' || a.state === 'DECIDED' || a.withdrawReason === 'REVIEW_WORK_ENDED')", replace: '(true)', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4r2-rubric-hold-not-rechecked',
    gate: 'R2-08: a RUBRIC Quality Hold stops reliance at the decision boundary (the shared eligibility predicate)',
    edits: [{ file: `${STORE}/review-core.js`, search: "OR (h.target_kind = 'RUBRIC' AND ? IS NOT NULL AND h.target_ref = ?)", replace: 'OR (0 AND ? IS NOT NULL AND h.target_ref = ?)', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4r2-action-subject-truncated',
    gate: 'R2-11: the action reviewer is shown every canonical argument the review fingerprint binds',
    edits: [{ file: `${STORE}/governed-writes.js`, search: 'with arguments ${canonicalJson(args)}`;', replace: 'with arguments ${canonicalJson(args).slice(0, 3000)}`;', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4r2-oversized-subject-admitted',
    gate: 'R2-11: an action that cannot be shown whole to its reviewer is refused before its request exists, never cut to fit',
    edits: [{ file: `${STORE}/review-core.js`, search: 'planInstructions(ctx, plan.id).length + 1 + s.actionSubject.length > REVIEWER_INPUT_MAX', replace: 'false', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4r2-secret-arguments-reach-reviewer',
    gate: 'R2-11: secret-shaped action arguments are refused before any review request or reviewer Work Item exists',
    edits: [{ file: `${STORE}/governed-writes.js`, search: 'if (containsSecretMaterial(actionSubject))', replace: 'if (false)', expectedCount: 1 }],
    runs: [REVIEW],
  },
  {
    id: 'c4r2-dead-letter-keeps-review-key',
    gate: 'm-11: a dead-lettered review Work Item releases its key in the dead-letter transaction',
    edits: [{ file: `${STORE}/queue.js`, search: 'releaseAbandonedReviewWork(ctx, wi.id);', replace: 'void 0;', expectedCount: 1 }],
    runs: [REVIEW],
  },
];

// --shard i/n (1-based) runs a disjoint slice; --report <file> records the ids run and caught.
const args = process.argv.slice(2);
const shardArg = args.includes('--shard') ? String(args[args.indexOf('--shard') + 1]) : '1/1';
const reportFile = args.includes('--report') ? String(args[args.indexOf('--report') + 1]) : null;
const [shardIndex, shardCount] = shardArg.split('/').map(Number);
if (!(Number.isInteger(shardIndex) && Number.isInteger(shardCount) && shardCount >= 1 && shardIndex >= 1 && shardIndex <= shardCount)) throw new Error(`--shard must be i/n with 1 <= i <= n (got ${shardArg})`);
const inShard = (i) => i % shardCount === shardIndex - 1;

function failed(r) {
  return r.status !== 0 && (/^# fail [1-9]/m.test(r.stdout ?? '') || /^ℹ fail [1-9]/m.test(r.stdout ?? ''));
}

let failures = 0;
const ran = [];
const caught = [];
let index = -1;
for (const m of MUTATIONS) {
  index++;
  if (!inShard(index)) continue;
  ran.push(m.id);
  const originals = new Map();
  let applicable = true;
  for (const e of m.edits) {
    const file = path.join(ROOT, e.file);
    const text = originals.get(file) ?? readFileSync(file, 'utf8');
    originals.set(file, text);
    const count = text.split(e.search).length - 1;
    if (count !== (e.expectedCount ?? 1)) {
      console.log(`c4-mutation: FAIL ${m.id} — expected ${e.expectedCount ?? 1} occurrence(s) of the gate in ${e.file}, found ${count} (rebuild, or update this check with the code)`);
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
    const caughtBy = m.runs.filter(({ cwd, tests }) => failed(spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: path.join(ROOT, cwd), encoding: 'utf8', shell: false, windowsHide: true, timeout: 900_000, env: TEST_ENV })));
    if (caughtBy.length > 0) {
      caught.push(m.id);
      console.log(`c4-mutation: ok   ${m.id} (${m.gate}) — caught by ${caughtBy.map((r) => r.tests.join(',')).join(' + ')}`);
    } else {
      console.log(`c4-mutation: FAIL ${m.id} (${m.gate}) — no proof test caught the mutation`);
      failures++;
    }
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text);
  }
}
if (reportFile) writeFileSync(reportFile, `${JSON.stringify({ script: 'c4:mutation', shard: shardArg, total: MUTATIONS.length, ran, caught }, null, 2)}\n`);
if (failures) {
  console.log(`c4-mutation: FAIL — ${failures} of ${ran.length} mutation(s) not caught (shard ${shardArg})`);
  process.exit(1);
}
console.log(`c4-mutation: PASS — ${caught.length}/${ran.length} mutations caught (shard ${shardArg}, ${MUTATIONS.length} total)`);
