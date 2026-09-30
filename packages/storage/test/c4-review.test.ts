/**
 * C4 storage proofs: Review Plans, the dynamic Review Pool (eligibility before LIMIT, independence, re-check at
 * the decision boundary), output and action review, conflicts, escalation, Independent Oversight, calibration,
 * and P-07 (a charged-failure deployment is excluded for the same Work Item across runs).
 * C4-PROOF: storage-review
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, newId, type Id } from '@qandeel-company/domain';

import { OrganizationStore, ReviewStore, type ReviewAssignmentRecord } from '../src/index.js';
import { beginGovernedRun, claimJob, holdReservation, reconcileOrganization, recordOrgAct, recordReviewDecision, recordToolIntent, recordToolResult, reserveBudget, settle, settleReservation } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { C2_KINDS, hire, seed, testManifest, type Seed } from './c2-helpers.js';
import { activeReviewer, budgetDepartment, certifiedCandidate, decideActionReview, decideAssignment, departmentId, newSeat, placed, reviewPlan, reviewedOutput, runFor } from './c4-helpers.js';
import { backoff, harness, type Harness } from './helpers.js';

const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;

function withSeed(fn: (h: Harness, s: Seed) => void): void {
  const h = harness();
  try {
    fn(h, seed(h.store));
  } finally {
    h.close();
  }
}

const OUTPUT_PLAN = reviewPlan({ appliesTo: 'OUTPUT' });
const ACTION_PLAN = reviewPlan({ appliesTo: 'ACTIONS' });

/** Completes an output-reviewed Work Item and returns its open review request and the counting assignment(s). */
function completeForReview(h: Harness, s: Seed, plan = OUTPUT_PLAN, owner = s.employee) {
  const rv = ReviewStore.for(h.store);
  const { workItemId, claim } = runFor(h, s, owner, { reviewPlan: plan });
  settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
  assert.equal(h.store.getWorkItem(workItemId).state, 'WAITING_REVIEW', 'review-required work is not "done"');
  const request = rv.requests({ workItemId }).find((r) => r.state === 'OPEN');
  assert.ok(request, 'the review request is created in the completion transaction');
  return { workItemId, request, keys: rv.assignments(request.id).filter((a) => a.keyKind !== 'SHADOW' && a.state === 'ASSIGNED') };
}

let w = 0;
function claimRun(h: Harness, workItemId: Id) {
  const job = h.store.jobsFor(workItemId).find((j) => j.state === 'QUEUED');
  if (!job) throw new Error('nothing queued');
  const claim = claimJob(h.store, job.id, { ...h.claimOpts(`w-rv-${++w}`, 600_000), kinds: C2_KINDS });
  if (!claim) throw new Error('claim failed');
  const begun = beginGovernedRun(h.store, claim.fence);
  if (!begun.ok) throw new Error(begun.code);
  return claim;
}

describe('C4 output review: designed before execution, bound to the exact output, never self-review', () => {
  test('C4-PROOF: PASS makes the exact output REVIEWED and releases its dependents; the rationale stays local (Rule A)', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      const { reviewer } = activeReviewer(h, s);
      const { workItemId, claim } = runFor(h, s, s.employee, { reviewPlan: OUTPUT_PLAN });
      const dependent = h.store.createWorkItem({ objective: 'publish after review', ownerRef: s.employee.ref, dependsOn: [workItemId], initialState: 'READY' }).workItem;
      settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
      const request = rv.requests({ workItemId }).find((r) => r.state === 'OPEN');
      const key = request ? rv.assignments(request.id).find((a) => a.keyKind === 'SPECIALIST') : undefined;
      assert.equal(key?.reviewerEmployeeId, reviewer.id);
      assert.notEqual(key?.reviewerEmployeeId, s.employee.id, 'the executor never reviews its own work');
      assert.equal(h.store.getWorkItem(dependent.id).state, 'BLOCKED', 'unreviewed work does not satisfy dependents');
      decideAssignment(h, key?.reviewWorkItemId as Id, 'PASS', 'Accurate figures; brand voice consistent.');
      assert.equal(rv.request(request?.id as Id).state, 'SATISFIED');
      assert.equal(h.store.getWorkItem(workItemId).state, 'REVIEWED');
      assert.equal(h.store.getWorkItem(dependent.id).state, 'READY');
      const [decision] = rv.decisions(request?.id as Id).filter((d) => d.counts);
      assert.equal(rv.rationale(decision?.id as Id), 'Accurate figures; brand voice consistent.', 'the rationale is durable local evidence');
      const telemetry = JSON.stringify([...h.store.pendingEvents(5_000), ...h.store.audit(request?.id as Id), ...h.store.audit(decision?.id as Id)]);
      assert.ok(!telemetry.includes('brand voice') && !telemetry.includes('Judge the subject'), 'rationale and reviewer instructions never enter telemetry');
    });
  });

  test('C4-PROOF: FAIL sends the work back; the rework is a new subject reviewed afresh', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      const first = completeForReview(h, s);
      decideAssignment(h, first.keys[0]?.reviewWorkItemId as Id, 'FAIL', 'Figures unsourced.');
      assert.equal(rv.request(first.request.id).state, 'REWORK');
      assert.equal(h.store.getWorkItem(first.workItemId).state, 'READY');
      const rework = claimRun(h, first.workItemId);
      settle(h.store, rework.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v2' } }, { backoff });
      const second = rv.requests({ workItemId: first.workItemId }).find((r) => r.state === 'OPEN');
      assert.ok(second && second.id !== first.request.id);
      assert.notEqual(second.subjectFingerprint, first.request.subjectFingerprint, 'a materially different output is a different subject');
    });
  });

  test('C4-PROOF: independence — when the only qualified reviewer is the executor, the review waits visibly (never self-review)', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      const { reviewer } = activeReviewer(h, s);
      const before = rv.health().waitingForReviewer;
      const c = completeForReview(h, s, OUTPUT_PLAN, reviewer);
      assert.deepEqual(c.keys, [], 'no counting key is filled');
      assert.equal(rv.request(c.request.id).waitingReason, 'REVIEWER_UNAVAILABLE');
      assert.equal(rv.health().waitingForReviewer, before + 1, 'visible in health');
    });
  });

  test('C4-PROOF: the review carries the subject\'s EFFECTIVE data class (a tool result raises it), so a lower-cleared reviewer never sees it', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      const { workItemId, claim } = runFor(h, s, s.employee, { reviewPlan: OUTPUT_PLAN });
      const read = recordToolIntent(h.store, claim.fence, { toolCode: 'notes', actionCode: 'append', args: { text: 'x' }, idempotencyKey: `wi:${workItemId}:s1` });
      if (read.kind === 'EXECUTE') recordToolResult(h.store, claim.fence, read.invocationId, { ok: true, result: { rows: 1 } });
      settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'done' } }, { backoff });
      const request = rv.requests({ workItemId }).find((r) => r.state === 'OPEN');
      assert.equal(request?.dataClass, 'D3', 'the D3 tool result governs the review, not the D1 declaration');
    });
  });

  test('C4-PROOF: a decision about a subject that has since changed is refused as stale (freshness at the decision boundary)', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      const c = completeForReview(h, s);
      h.store.transitionWorkItem(c.workItemId, { to: 'READY', reasonCode: 'reopened.by.owner' });
      const out = decideAssignment(h, c.keys[0]?.reviewWorkItemId as Id, 'PASS');
      assert.deepEqual([out.outcome, out.code], ['REFUSED', 'REVIEW_STALE']);
      assert.equal(rv.request(c.request.id).state, 'STALE');
      assert.notEqual(h.store.getWorkItem(c.workItemId).state, 'REVIEWED', 'a stale review never marks the new state reviewed');
    });
  });

  test('C4-PROOF: a Review Plan is declared before execution; a plan after the first run is refused', () => {
    withSeed((h, s) => {
      const { workItemId } = runFor(h, s, s.employee);
      assert.throws(() => ReviewStore.for(h.store).declarePlan(s.founder, workItemId, OUTPUT_PLAN), code('INVALID_TRANSITION'));
      assert.throws(() => ReviewStore.for(h.store).declarePlan(s.founder, workItemId, reviewPlan({ keys: [{ kind: 'MANAGER' }] })), code('VALIDATION_FAILED'));
    });
  });
});

describe('C4 two-key review, conflicts, escalation and the decision-boundary re-check', () => {
  test('C4-PROOF: two keys go to two distinct reviewers; disagreement is an explicit conflict resolved by the Founder, never averaged', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      activeReviewer(h, s);
      const c = completeForReview(h, s, reviewPlan({ appliesTo: 'OUTPUT', keys: [{ kind: 'SPECIALIST' }, { kind: 'SPECIALIST' }] }));
      assert.equal(c.keys.length, 2);
      assert.notEqual(c.keys[0]?.reviewerEmployeeId, c.keys[1]?.reviewerEmployeeId, 'one reviewer never holds two keys');
      decideAssignment(h, c.keys[0]?.reviewWorkItemId as Id, 'PASS');
      assert.equal(rv.request(c.request.id).state, 'OPEN', 'one key is not the review');
      decideAssignment(h, c.keys[1]?.reviewWorkItemId as Id, 'FAIL');
      assert.equal(rv.request(c.request.id).state, 'CONFLICT');
      assert.equal(h.store.getWorkItem(c.workItemId).state, 'WAITING_REVIEW', 'a conflict parks the subject');
      const [conflict] = rv.conflicts('OPEN');
      assert.equal(conflict?.origin, 'KEY_DISAGREEMENT');
      assert.throws(() => rv.resolveConflict(s.employee.ref, conflict?.id as string, 'PASS', 'x'));
      rv.resolveConflict(s.founder, conflict?.id as string, 'PASS', 'founder.judgement');
      assert.equal(h.store.getWorkItem(c.workItemId).state, 'REVIEWED');
    });
  });

  test('C4-PROOF: explicit uncertainty escalates (guessing is never preferred); the Founder resolves it', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      const c = completeForReview(h, s);
      decideAssignment(h, c.keys[0]?.reviewWorkItemId as Id, 'INSUFFICIENT_EVIDENCE');
      assert.equal(rv.request(c.request.id).state, 'ESCALATED');
      rv.resolveEscalation(s.founder, c.request.id, 'REWORK', 'needs.sources');
      assert.equal(h.store.getWorkItem(c.workItemId).state, 'READY');
    });
  });

  test('C4-PROOF: eligibility is re-checked at the decision — a Quality Hold placed after assignment refuses the decision and the key is refilled', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      const a = activeReviewer(h, s);
      const b = activeReviewer(h, s);
      const c = completeForReview(h, s);
      const first = c.keys[0];
      const other = first?.reviewerEmployeeId === a.reviewer.id ? b.reviewer : a.reviewer;
      rv.placeQualityHold(s.founder, { targetKind: 'REVIEWER', targetRef: `employee:${String(first?.reviewerEmployeeId)}`, reasonCode: 'calibration.drift' });
      const out = decideAssignment(h, first?.reviewWorkItemId as Id, 'PASS');
      assert.deepEqual([out.outcome, out.code], ['REFUSED', 'REVIEWER_NOT_ELIGIBLE']);
      const refilled = rv.assignments(c.request.id).find((x) => x.state === 'ASSIGNED' && x.keyKind === 'SPECIALIST');
      assert.equal(refilled?.reviewerEmployeeId, other.id, 'the key goes to an eligible, independent reviewer');
      assert.equal(rv.request(c.request.id).state, 'OPEN');
    });
  });

  test('C4-PROOF: a review Work Item that ends without its decision frees the key for another reviewer, in the same transaction', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      activeReviewer(h, s);
      const c = completeForReview(h, s);
      const first = c.keys[0];
      h.store.requestCancellation(first?.reviewWorkItemId as Id, { reasonCode: 'reviewer.unavailable' });
      assert.equal(rv.assignments(c.request.id).find((a) => a.id === first?.id)?.state, 'WITHDRAWN');
      const refilled = rv.assignments(c.request.id).find((a) => a.state === 'ASSIGNED' && a.keyKind === 'SPECIALIST');
      assert.ok(refilled && refilled.reviewerEmployeeId !== first?.reviewerEmployeeId, 'the key is refilled at once, never left dangling until a restart');
    });
  });

  test('C4-PROOF: eligibility is decided BEFORE the ranking LIMIT — ineligible reviewers never crowd an eligible one out', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      const a = activeReviewer(h, s);
      const b = activeReviewer(h, s);
      const firstRanked = [a.reviewer.id, b.reviewer.id].sort()[0] as Id;
      const eligible = firstRanked === a.reviewer.id ? b.reviewer.id : a.reviewer.id;
      rv.placeQualityHold(s.founder, { targetKind: 'REVIEWER', targetRef: `employee:${firstRanked}`, reasonCode: 'hold' });
      assert.deepEqual(rv.pool('quality.general', 'D1', 1).map((x) => x.employeeId), [eligible], 'a page of one still finds the eligible reviewer');
      const c = completeForReview(h, s);
      assert.equal(c.keys[0]?.reviewerEmployeeId, eligible);
      rv.suspendReviewer(s.founder, rv.qualifications({ employeeId: eligible })[0]?.id as string, 'suspended');
      assert.equal(rv.request(c.request.id).waitingReason, 'REVIEWER_UNAVAILABLE', 'no eligible reviewer left: the review waits, visibly');
      assert.equal(rv.pool('quality.general').length, 0);
    });
  });
});

describe('C4 action review (R2 / R3), R4 sovereignty and the lost-wake window', () => {
  test('C4-PROOF: R2 executes only after an independent review of exactly that action; a rejected action stays rejected', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      const { workItemId, claim } = runFor(h, s, s.employee, { reviewPlan: ACTION_PLAN });
      const merge = (text: string, key: string) => recordToolIntent(h.store, claim.fence, { toolCode: 'review', actionCode: 'merge', args: { text }, idempotencyKey: `wi:${workItemId}:${key}` });
      assert.equal(merge('v1', 's1').kind, 'REVIEW_REQUIRED');
      decideActionReview(h, workItemId, 'PASS');
      assert.equal(merge('v1', 's1').kind, 'EXECUTE', 'R2 needs no Founder approval once independently reviewed');
      assert.equal(s.gov.listApprovals().length, 0);
      assert.equal(merge('v2', 's2').kind, 'REVIEW_REQUIRED', 'a different action is a new subject');
      decideActionReview(h, workItemId, 'FAIL');
      assert.deepEqual(merge('v2', 's2'), { kind: 'DENIED', code: 'REVIEW_REJECTED', paused: false });
      assert.deepEqual(merge('v2', 's3'), { kind: 'DENIED', code: 'REVIEW_REJECTED', paused: false }, 'the exact rejected action is not re-reviewed');
      assert.equal(s.gov.getEmployee(s.employee.id).state, 'ACTIVE', 'a review verdict is not an authority violation');
      assert.equal(rv.requests({ workItemId }).filter((r) => r.state === 'REWORK').length, 1);
    });
  });

  test('C4-PROOF: R4 stays Founder-only — no review is even requested', () => {
    withSeed((h, s) => {
      activeReviewer(h, s);
      const { workItemId, claim } = runFor(h, s, s.employee, { reviewPlan: ACTION_PLAN });
      assert.deepEqual(recordToolIntent(h.store, claim.fence, { toolCode: 'ledger', actionCode: 'transfer', args: { text: 'x' }, idempotencyKey: `wi:${workItemId}:s1` }), { kind: 'DENIED', code: 'FOUNDER_ONLY', paused: false });
      assert.equal(ReviewStore.for(h.store).requests({ workItemId }).length, 0);
    });
  });

  test('C4-PROOF: a review decided while the executor is still claimed wakes it at the WAIT settle (R1-06 family); undecided, it stays parked', () => {
    withSeed((h, s) => {
      activeReviewer(h, s);
      const parked = runFor(h, s, s.employee, { reviewPlan: ACTION_PLAN });
      recordToolIntent(h.store, parked.claim.fence, { toolCode: 'review', actionCode: 'merge', args: { text: 'a' }, idempotencyKey: `wi:${parked.workItemId}:s1` });
      settle(h.store, parked.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_INDEPENDENT_REVIEW' }, { backoff });
      assert.equal(h.store.jobsFor(parked.workItemId).at(-1)?.state, 'WAITING', 'the re-check is not a free wake');
      decideActionReview(h, parked.workItemId, 'PASS');
      assert.equal(h.store.jobsFor(parked.workItemId).at(-1)?.state, 'QUEUED', 'the decision wakes exactly the waiting Work Item');
      const racing = runFor(h, s, s.employee, { reviewPlan: ACTION_PLAN });
      recordToolIntent(h.store, racing.claim.fence, { toolCode: 'review', actionCode: 'merge', args: { text: 'b' }, idempotencyKey: `wi:${racing.workItemId}:s1` });
      decideActionReview(h, racing.workItemId, 'PASS'); // the executor's job is still CLAIMED: nothing to wake yet
      settle(h.store, racing.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_INDEPENDENT_REVIEW' }, { backoff });
      assert.equal(h.store.jobsFor(racing.workItemId).at(-1)?.state, 'QUEUED', 'the lost-wake window is closed');
    });
  });
});

describe('C4 Review Pool trust and Independent Oversight', () => {
  test('C4-PROOF: admission needs the reviewer-role certification; independent authority needs Gold cases AND calibration; calibration counts once', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      const uncertified = hire(s.gov, s.founder, s.departmentId, true, 'role:reviewer.quality.general');
      assert.throws(() => rv.admitReviewer(s.founder, { employeeId: uncertified.id, domain: 'quality.general', level: 'EXPERT', maxDataClass: 'D3', reasonCode: 'x' }), code('REVIEWER_NOT_ELIGIBLE'), 'seniority is not evidence');
      const { reviewer, qualification } = activeReviewer(h, s);
      assert.deepEqual([qualification.mode, qualification.goldCasesPassed >= 1, qualification.calibrationAgreements, qualification.admittedByRef], ['ACTIVE', true, 2, s.founder]);
      const shadowDecision = rv.decisions(rv.requests().find((r) => rv.assignments(r.id).some((a) => a.keyKind === 'SHADOW' && a.reviewerEmployeeId === reviewer.id))?.id as Id).find((d) => !d.counts);
      assert.equal(rv.calibrateShadowDecision(s.founder, shadowDecision?.id as string, 'PASS'), 'ALREADY_CALIBRATED');
      assert.equal(rv.qualifications({ employeeId: reviewer.id })[0]?.calibrationAgreements, 2);
      // A second, certified reviewer is admitted to CALIBRATION only: no independent authority without evidence.
      const { qualification: fresh } = certifiedCandidate(h, s);
      assert.equal(fresh.mode, 'CALIBRATION');
      assert.throws(() => rv.promoteReviewer(s.founder, fresh.id, 'x'), code('REVIEWER_NOT_ELIGIBLE'));
      const reinstated = rv.reinstateReviewer.bind(rv);
      rv.suspendReviewer(s.founder, qualification.id, 'drift');
      assert.equal(reinstated(s.founder, qualification.id, 'retrain').mode, 'CALIBRATION', 'trust is rebuilt through calibration, never restored by decree');
    });
  });

  test('C4-PROOF: Independent Oversight never satisfies a gate; it is independent of the required reviewers; a FAIL opens a finding and a conflict', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      activeReviewer(h, s);
      const c = completeForReview(h, s);
      const requiredReviewer = c.keys[0]?.reviewerEmployeeId;
      decideAssignment(h, c.keys[0]?.reviewWorkItemId as Id, 'PASS');
      assert.equal(h.store.getWorkItem(c.workItemId).state, 'REVIEWED');
      const oversight = rv.requestOversight(s.founder, c.workItemId, 'sampling');
      const [key] = rv.assignments(oversight.id);
      assert.equal(key?.keyKind, 'OVERSIGHT');
      assert.notEqual(key?.reviewerEmployeeId, requiredReviewer, 'oversight is independent of the review it audits');
      decideAssignment(h, key?.reviewWorkItemId as Id, 'FAIL');
      assert.equal(rv.findings()[0]?.state, 'OPEN');
      assert.equal(rv.request(c.request.id).state, 'CONFLICT');
      assert.equal(rv.conflicts('OPEN')[0]?.origin, 'OVERSIGHT');
      rv.advanceFinding(s.founder, rv.findings()[0]?.id as string, { to: 'ROOT_CAUSED', rootCauseCode: 'rubric.gap', reasonCode: 'analysed' });
      assert.throws(() => rv.advanceFinding(s.founder, rv.findings()[0]?.id as string, { to: 'OPEN', reasonCode: 'x' }), code('STORAGE_INVARIANT'), 'the corrective-action loop moves forward only');
    });
  });

  test('C4-PROOF: a reviewer decides only its own review Work Item', () => {
    withSeed((h, s) => {
      activeReviewer(h, s);
      const own = runFor(h, s, s.employee);
      assert.deepEqual(recordReviewDecision(h.store, own.claim.fence, { outcome: 'PASS', reasonCode: 'x', rationale: null, evidenceRefs: [] }), { outcome: 'REFUSED', code: 'NOT_A_REVIEW_WORK_ITEM', requestState: null });
    });
  });
});

describe('C4 P-07: a charged-failure deployment is excluded for the same Work Item across runs', () => {
  test('C4-PROOF: a FAILED_CHARGED (or possibly billed) attempt excludes its deployment for this Work Item only, until an evidenced Founder release', () => {
    withSeed((h, s) => {
      const reserve = (fence: Parameters<typeof reserveBudget>[1]) =>
        reserveBudget(h.store, fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: s.deploymentId, priceCardId: s.priceCardId, routePolicyId: s.policyId, money: 1_000, tokens: 100, contextManifestId: testManifest(h, fence, s.employee.id) });
      const { workItemId, claim } = runFor(h, s, s.employee);
      const r1 = reserve(claim.fence);
      assert.ok(r1.ok);
      if (r1.ok) settleReservation(h.store, claim.fence, r1.reservation.id, { inputTokens: 50, outputTokens: 0, withinBounds: true, sessionId: null, outcome: 'FAILED_CHARGED' });
      settle(h.store, claim.fence, { type: 'RETRYABLE_FAILURE', code: 'PROVIDER_UNAVAILABLE' }, { backoff });
      h.clock.advance(120_000);
      // A NEW run (a new job attempt) of the same logical Work Item.
      const again = claimRun(h, workItemId);
      assert.notEqual(again.fence.runId, claim.fence.runId);
      const refused = reserve(again.fence);
      assert.deepEqual(refused.ok ? null : [refused.code, refused.detail], ['ROUTE_NO_LONGER_ELIGIBLE', 'CHARGED_FAILURE_EXCLUDED']);
      assert.deepEqual(s.gov.chargedExclusions(workItemId), [s.deploymentId]);
      // Another Work Item is unaffected.
      const other = runFor(h, s, s.employee);
      assert.ok(reserve(other.claim.fence).ok);
      // Only an explicit, evidenced Founder release — for exactly this Work Item and deployment.
      assert.throws(() => s.gov.releaseChargedExclusion(s.employee.ref, { workItemId, deploymentId: s.deploymentId, reasonCode: 'x', evidenceRef: 'evidence:x' }));
      s.gov.releaseChargedExclusion(s.founder, { workItemId, deploymentId: s.deploymentId, reasonCode: 'provider.fixed', evidenceRef: 'incident:provider-42' });
      const after = reserve(again.fence);
      assert.ok(after.ok, 'released');
      // A later possibly-billed attempt excludes it again (the release covered only the past).
      if (after.ok) holdReservation(h.store, again.fence, after.reservation.id, 'USAGE_UNREPORTED');
      assert.deepEqual(s.gov.chargedExclusions(workItemId), [s.deploymentId]);
    });
  });
});

// A secret-shaped value assembled at runtime: no secret-looking literal sits in the repository.
const FAKE_KEY = ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz99'].join('-');
const refusedBy = (message: RegExp) => (e: unknown): boolean => isQandeelError(e, 'STORAGE_INVARIANT') && message.test(String((e as Error).cause));
const lastJob = (h: Harness, workItemId: Id) => h.store.jobsFor(workItemId).at(-1);
const shownTo = (h: Harness, a: ReviewAssignmentRecord | undefined): string => String((h.store.getWorkItem(a?.reviewWorkItemId as Id).processorInput as { instructions?: unknown }).instructions);

describe('R2 K1: review integrity and Review Pool eligibility', () => {
  test('R2-01: the executor never re-designs its own Review Plan (application and datastore); a rejected exact action stays rejected across plan versions', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      activeReviewer(h, s);
      const { workItemId, claim } = runFor(h, s, s.employee, { reviewPlan: ACTION_PLAN });
      // The ordinary delegable capability (e.g. to plan the review of work it delegates) — never over its own work.
      s.gov.grant(s.founder, { employeeId: s.employee.id, capability: 'org.review.plan', riskCeiling: 'R1', dataClassCeiling: 'D3', reasonCode: 'plans.for.delegation' });
      const merge = (key: string) => recordToolIntent(h.store, claim.fence, { toolCode: 'review', actionCode: 'merge', args: { text: 'risky change' }, idempotencyKey: `wi:${workItemId}:${key}` });
      assert.equal(merge('s1').kind, 'REVIEW_REQUIRED');
      decideActionReview(h, workItemId, 'FAIL');
      const act = recordOrgAct(h.store, claim.fence, 1000, 'review.plan.declare', { workItemId, plan: ACTION_PLAN });
      assert.deepEqual([act.outcome, act.code], ['REFUSED', 'SELF_REVIEW_REDESIGN'], 'the executor never supersedes the plan of its own work');
      assert.deepEqual(rv.plans(workItemId).map((p) => [p.version, p.status]), [[1, 'ACTIVE']]);
      // Defence in depth: the datastore refuses an executor-declared later version, whatever the path.
      const ctx = storeContext(h.store);
      const forged = (): unknown => ctx.db.immediate('forge plan', () => ctx.db.run(
        `INSERT INTO review_plans (id, work_item_id, version, status, domain, applies_to, keys_json, independence_json, required_evidence_json, rubric_code, rubric_version, reviewer_instructions, reviewer_instructions_sha256, review_task_class, review_budget_money, review_budget_tokens, deadline_at, declared_by_ref, declared_run_id, created_at, operational_judgment)
         SELECT ?, work_item_id, 2, 'SUPERSEDED', domain, applies_to, keys_json, independence_json, required_evidence_json, rubric_code, rubric_version, reviewer_instructions, reviewer_instructions_sha256, review_task_class, review_budget_money, review_budget_tokens, deadline_at, ?, NULL, created_at, operational_judgment
           FROM review_plans WHERE work_item_id = ? AND version = 1`,
        newId(), s.employee.ref, workItemId,
      ));
      assert.throws(forged, refusedBy(/the executor never re-designs its own review/));
      // A Founder supersession is designed — and it never re-opens the exact action a reviewer rejected (D-C4-05).
      rv.declarePlan(s.founder, workItemId, ACTION_PLAN);
      assert.deepEqual(merge('s2'), { kind: 'DENIED', code: 'REVIEW_REJECTED', paused: false }, 'rejected under v1, still rejected under v2');
      assert.equal(rv.requests({ workItemId }).filter((r) => r.subjectKind === 'ACTION').length, 1, 'no fresh review is drawn for the rejected action');
    });
  });

  test('R2-02: a plan change wakes the executor parked on its action review — at supersession, when an applying plan arrives, during the run and at restart', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      const intent = (workItemId: Id, fence: Parameters<typeof recordToolIntent>[1]) => recordToolIntent(h.store, fence, { toolCode: 'review', actionCode: 'merge', args: { text: 'a' }, idempotencyKey: `wi:${workItemId}:s1` });
      const V2 = reviewPlan({ appliesTo: 'ACTIONS', rubric: { code: 'quality.rubric', version: 2 } });
      // (a) The plan is superseded while the executor waits on its request.
      const a = runFor(h, s, s.employee, { reviewPlan: ACTION_PLAN });
      assert.equal(intent(a.workItemId, a.claim.fence).kind, 'REVIEW_REQUIRED');
      settle(h.store, a.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_INDEPENDENT_REVIEW' }, { backoff });
      assert.equal(lastJob(h, a.workItemId)?.state, 'WAITING');
      rv.declarePlan(s.founder, a.workItemId, V2);
      assert.equal(rv.requests({ workItemId: a.workItemId })[0]?.state, 'STALE');
      assert.equal(lastJob(h, a.workItemId)?.state, 'QUEUED', 'the supersession wakes exactly the stranded waiter');
      // (b) The executor waits for a plan that reviews actions; declaring one wakes it.
      const b = runFor(h, s, s.employee, { reviewPlan: OUTPUT_PLAN });
      assert.deepEqual(intent(b.workItemId, b.claim.fence), { kind: 'REVIEW_REQUIRED', code: 'REVIEW_PLAN_MISSING', reviewRequestId: null });
      settle(h.store, b.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_INDEPENDENT_REVIEW' }, { backoff });
      assert.equal(lastJob(h, b.workItemId)?.state, 'WAITING', 'no plan for actions: the wait holds (never a model loop)');
      rv.declarePlan(s.founder, b.workItemId, ACTION_PLAN);
      assert.equal(lastJob(h, b.workItemId)?.state, 'QUEUED');
      // (c) Superseded while the executor is still claimed: the WAIT settle re-check closes the lost-wake window.
      const c = runFor(h, s, s.employee, { reviewPlan: ACTION_PLAN });
      intent(c.workItemId, c.claim.fence);
      rv.declarePlan(s.founder, c.workItemId, V2);
      settle(h.store, c.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_INDEPENDENT_REVIEW' }, { backoff });
      assert.equal(lastJob(h, c.workItemId)?.state, 'QUEUED');
      // (d) A waiter stranded before this correction (a database from an earlier release) is woken by the bounded recovery sweep.
      const job = lastJob(h, a.workItemId);
      storeContext(h.store).db.immediate('strand', () => storeContext(h.store).db.run(`UPDATE queue_jobs SET state = 'WAITING', wait_reason = 'AWAITING_INDEPENDENT_REVIEW' WHERE id = ?`, job?.id as Id));
      assert.equal(lastJob(h, a.workItemId)?.state, 'WAITING');
      reconcileOrganization(h.store, h.supervisor, 500);
      assert.equal(lastJob(h, a.workItemId)?.state, 'QUEUED', 'restart recovery wakes a waiter whose request went stale');
    });
  });

  test('R2-07: the MANAGER key is satisfiable — one eligibility predicate at selection and decision; manager keys are filled first; a transient withdrawal is not permanent', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      const growth = departmentId(s, 'growth');
      budgetDepartment(s, growth);
      const { reviewer: spec } = activeReviewer(h, s);
      const mgrSeat = newSeat(h, s, 'growth.qmgr-1', 'director.growth', 'role:reviewer.quality.general', 'MANAGER');
      const { reviewer: mgr } = activeReviewer(h, s, 'quality.general', growth);
      OrganizationStore.for(h.store).assignPrimary(s.founder, { positionId: mgrSeat.id, employeeId: mgr.id, reasonCode: 'placed' });
      newSeat(h, s, 'growth.analyst-1', 'growth.qmgr-1');
      const exec = placed(h, s, 'growth.analyst-1');
      const openKeys = (w: Id) => {
        const r = rv.requests({ workItemId: w }).find((x) => x.state === 'OPEN');
        return { request: r, keys: r ? rv.assignments(r.id).filter((a) => a.state === 'ASSIGNED' && a.keyKind !== 'SHADOW') : [] };
      };
      // (a) Department independence exempts the manager at selection — and at the decision boundary.
      const w1 = reviewedOutput(h, s, exec, reviewPlan({ appliesTo: 'OUTPUT', keys: [{ kind: 'SPECIALIST' }, { kind: 'MANAGER' }], independence: { excludeSameDepartment: true } }));
      const m1 = openKeys(w1).keys.find((a) => a.keyKind === 'MANAGER');
      assert.equal(m1?.reviewerEmployeeId, mgr.id);
      assert.equal(decideAssignment(h, m1?.reviewWorkItemId as Id, 'PASS').code, 'RECORDED', 'the manager is not refused by the exclusion selection exempted it from');
      // (b) The manager's own key is filled before a SPECIALIST key it could otherwise take.
      const w2 = reviewedOutput(h, s, exec, reviewPlan({ appliesTo: 'OUTPUT', keys: [{ kind: 'SPECIALIST' }, { kind: 'MANAGER' }] }));
      const k2 = openKeys(w2);
      assert.deepEqual(k2.keys.map((a) => [a.keyKind, a.reviewerEmployeeId]).sort(), [['MANAGER', mgr.id], ['SPECIALIST', spec.id]].sort());
      // (c) Withdrawn for a transient reason (a Quality Hold), the manager returns once the hold is lifted.
      const m2 = k2.keys.find((a) => a.keyKind === 'MANAGER');
      const hold = rv.placeQualityHold(s.founder, { targetKind: 'REVIEWER', targetRef: `employee:${mgr.id}`, reasonCode: 'reviewer.drift' });
      assert.equal(decideAssignment(h, m2?.reviewWorkItemId as Id, 'PASS').code, 'REVIEWER_NOT_ELIGIBLE');
      rv.liftQualityHold(s.founder, hold.id, 'reviewer.recalibrated');
      const back = openKeys(w2).keys.find((a) => a.keyKind === 'MANAGER');
      assert.equal(back?.reviewerEmployeeId, mgr.id, 'a withdrawn reviewer is not excluded from the subject for ever');
      for (const k of openKeys(w2).keys) decideAssignment(h, k.reviewWorkItemId as Id, 'PASS');
      assert.equal(h.store.getWorkItem(w2).state, 'REVIEWED');
    });
  });

  test('R2-08: a RUBRIC Quality Hold stops reliance at the decision boundary (the same predicate as selection)', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      const c = completeForReview(h, s);
      rv.placeQualityHold(s.founder, { targetKind: 'RUBRIC', targetRef: 'quality.rubric@1', reasonCode: 'rubric.suspect' });
      const out = decideAssignment(h, c.keys[0]?.reviewWorkItemId as Id, 'PASS');
      assert.deepEqual([out.outcome, out.code], ['REFUSED', 'REVIEWER_NOT_ELIGIBLE']);
      assert.deepEqual([rv.request(c.request.id).state, rv.request(c.request.id).waitingReason], ['OPEN', 'QUALITY_HOLD']);
      assert.equal(h.store.getWorkItem(c.workItemId).state, 'WAITING_REVIEW', 'nothing is reviewed under a held rubric');
    });
  });

  test('R2-11: the action reviewer sees the whole action on every fill; an oversized subject fails closed; secret-shaped arguments are refused before any request', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      activeReviewer(h, s);
      const mailer = s.gov.registerTool(s.founder, { code: 'mailer', driverCode: 'fake-mailer', egress: 'NONE' });
      s.gov.registerToolAction(s.founder, { toolId: mailer.id, code: 'send', risk: 'R2', sideEffects: 'IDEMPOTENT', mutatesExternal: false, dataClassCeiling: 'D3', argsSchema: { fields: { body: { type: 'string', required: true, maxLength: 8000 }, recipient: { type: 'string', required: true, maxLength: 200 } } }, costPerCallMicros: 0 });
      s.gov.grant(s.founder, { employeeId: s.employee.id, capability: 'tool:mailer.send', riskCeiling: 'R3', dataClassCeiling: 'D3', reasonCode: 'seed' });
      const body = 'Quarterly summary line. '.repeat(200);
      const send = (fence: Parameters<typeof recordToolIntent>[1], workItemId: Id, args: { body: string; recipient: string }, key: string) => recordToolIntent(h.store, fence, { toolCode: 'mailer', actionCode: 'send', args, idempotencyKey: `wi:${workItemId}:${key}` });
      const w = runFor(h, s, s.employee, { reviewPlan: ACTION_PLAN });
      assert.equal(send(w.claim.fence, w.workItemId, { body, recipient: 'finance-team' }, 's1').kind, 'REVIEW_REQUIRED');
      const request = rv.requests({ workItemId: w.workItemId }).find((r) => r.subjectKind === 'ACTION' && r.state === 'OPEN');
      const first = rv.assignments(request?.id as Id).find((a) => a.keyKind === 'SPECIALIST' && a.state === 'ASSIGNED');
      assert.ok(shownTo(h, first).includes(body) && shownTo(h, first).includes('"recipient":"finance-team"'), 'the reviewer sees every argument the review binds (sorted last included)');
      // Every refill shows the same durable subject.
      h.store.requestCancellation(first?.reviewWorkItemId as Id, { reasonCode: 'reviewer.unavailable' });
      const refilled = rv.assignments(request?.id as Id).find((a) => a.keyKind === 'SPECIALIST' && a.state === 'ASSIGNED');
      assert.ok(refilled && refilled.id !== first?.id);
      assert.equal(shownTo(h, refilled), shownTo(h, first), 'a refill never rebuilds the subject without its arguments');
      // Plan instructions + the whole subject beyond the reviewer's input bound: refused, never truncated.
      const big = runFor(h, s, s.employee, { reviewPlan: reviewPlan({ appliesTo: 'ACTIONS', reviewerInstructions: 'Judge the subject against the rubric. '.repeat(210) }) });
      assert.deepEqual(send(big.claim.fence, big.workItemId, { body, recipient: 'finance-team' }, 's1'), { kind: 'DENIED', code: 'REVIEW_SUBJECT_TOO_LARGE', paused: false });
      assert.equal(rv.requests({ workItemId: big.workItemId }).length, 0);
      // Secret-shaped arguments never reach a reviewer's Work Item: refused before any request exists.
      const sec = runFor(h, s, s.employee, { reviewPlan: ACTION_PLAN });
      assert.deepEqual(send(sec.claim.fence, sec.workItemId, { body: `use api_key=${FAKE_KEY}`, recipient: 'finance-team' }, 's1'), { kind: 'DENIED', code: 'SECRET_MATERIAL', paused: false });
      assert.equal(rv.requests({ workItemId: sec.workItemId }).length, 0);
      assert.equal(storeContext(h.store).db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM work_items WHERE instr(processor_input_json, ?) > 0`, FAKE_KEY)?.n, 0);
    });
  });

  test('m-11: a dead-lettered review Work Item releases its key in the same transaction', () => {
    withSeed((h, s) => {
      const rv = ReviewStore.for(h.store);
      activeReviewer(h, s);
      activeReviewer(h, s);
      const c = completeForReview(h, s);
      const first = c.keys[0];
      for (let i = 0; i < 20 && lastJob(h, first?.reviewWorkItemId as Id)?.state !== 'DEAD_LETTER'; i++) {
        h.clock.advance(120_000);
        const claim = claimRun(h, first?.reviewWorkItemId as Id);
        settle(h.store, claim.fence, { type: 'RETRYABLE_FAILURE', code: 'PROVIDER_UNAVAILABLE' }, { backoff });
      }
      assert.equal(lastJob(h, first?.reviewWorkItemId as Id)?.state, 'DEAD_LETTER');
      assert.equal(h.store.getWorkItem(first?.reviewWorkItemId as Id).state, 'BLOCKED');
      assert.equal(rv.assignments(c.request.id).find((a) => a.id === first?.id)?.state, 'WITHDRAWN');
      const refilled = rv.assignments(c.request.id).find((a) => a.state === 'ASSIGNED' && a.keyKind === 'SPECIALIST');
      assert.ok(refilled && refilled.reviewerEmployeeId !== first?.reviewerEmployeeId, 'the key goes to another reviewer at once');
    });
  });
});
