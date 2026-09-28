/**
 * C4 storage test helpers. Everything goes through the real public / runtime-authority paths: a reviewer is
 * certified by the Academy (C3), enters the Review Pool in CALIBRATION, earns calibration evidence through
 * real shadow reviews judged by the Founder, and is promoted with that evidence. The only test-only element
 * is the armed Founder surface (C2 seam) standing in for the authenticated Founder surface of C5.
 */
import type { Id } from '@qandeel-company/domain';

import { GovernanceStore, OrganizationStore, ReviewStore, type EmployeeRecord, type Fence, type PositionRecord, type ReviewerQualificationRecord } from '../src/index.js';
import { beginGovernedRun, claimJob, recordReviewDecision, recordToolIntent, settle, type Claim, type ToolIntent, type ToolIntentInput } from '../src/runtime-authority.js';
import { academyWorld, certify, type AcademyWorld } from './c3-helpers.js';
import { C2_KINDS, GOVERNED_KIND, hire, type Seed } from './c2-helpers.js';
import { backoff, type Harness } from './helpers.js';

export const REVIEW_DOMAIN = 'quality.general';

const WORLDS = new Map<string, AcademyWorld>();

export const reviewPlan = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  domain: REVIEW_DOMAIN,
  appliesTo: 'BOTH',
  keys: [{ kind: 'SPECIALIST' }],
  rubric: { code: 'quality.rubric', version: 1 },
  reviewerInstructions: 'Judge the subject against the rubric; cite evidence.',
  reviewTaskClass: 'draft.memo',
  reviewBudget: { money: 20_000, tokens: 20_000 },
  ...over,
});

export const stores4 = (h: Harness) => ({ org: OrganizationStore.for(h.store), review: ReviewStore.for(h.store), gov: GovernanceStore.for(h.store) });

/** A canonical or created seat by code (the canonical skeleton is release-seeded, D-C4-02). */
export function seat(h: Harness, code: string): PositionRecord {
  const p = OrganizationStore.for(h.store).positionByCode(code);
  if (!p) throw new Error(`no seat ${code}`);
  return p;
}

export function departmentId(s: Seed, code: string): Id {
  const d = s.gov.departmentByCode(code);
  if (!d) throw new Error(`no department ${code}`);
  return d.id;
}

/** Makes sure a Department is budgeted (Employee envelopes hang under it). */
export function budgetDepartment(s: Seed, deptId: Id, cap = 2_000_000): void {
  if (!s.gov.budgetFor('DEPARTMENT', deptId)) s.gov.createBudget(s.founder, { scope: 'DEPARTMENT', scopeId: deptId, capMoney: cap, capTokens: cap, reasonCode: 'seed' });
}

/**
 * An ACTIVE Employee holding a seat as its PRIMARY assignment. It is hired with the seat's role (so the shared
 * role-change certification rule keeps it ACTIVE), budgeted, then placed through the Founder's assignment.
 */
export function placed(h: Harness, s: Seed, seatCode: string, cap = 500_000): EmployeeRecord {
  const p = seat(h, seatCode);
  const home = p.departmentId ?? s.departmentId;
  budgetDepartment(s, home);
  const e = hire(s.gov, s.founder, home, true, p.roleRef);
  s.gov.createBudget(s.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: cap, capTokens: cap, reasonCode: 'seed' });
  OrganizationStore.for(h.store).assignPrimary(s.founder, { positionId: p.id, employeeId: e.id, reasonCode: 'placed' });
  return s.gov.getEmployee(e.id);
}

/** A seat below `parentCode` in the same Department (headcount is data: a Founder-created Position). */
export function newSeat(h: Harness, s: Seed, code: string, parentCode: string, roleRef = 'role:analyst', kind: 'MANAGER' | 'LEAD' | 'SPECIALIST' = 'SPECIALIST'): PositionRecord {
  const parent = seat(h, parentCode);
  return OrganizationStore.for(h.store).createPosition(s.founder, { code, title: `Seat ${code}`, scope: parent.scope, departmentId: parent.departmentId, kind, roleRef, reportsToPositionId: parent.id, reasonCode: 'headcount.added' });
}

/** A released governed Work Item owned by `e`, claimed and bound: a run inside which `e` can act. */
export function runFor(h: Harness, s: Seed, e: EmployeeRecord, opts: { cap?: number; reviewPlan?: Record<string, unknown>; risk?: 'R1' | 'R3' | 'R4' } = {}): { workItemId: Id; claim: Claim } {
  const { workItem } = h.store.createWorkItem({ objective: 'organizational work', ownerRef: e.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', dataClass: 'D1', instructions: 'x' }, riskLevel: opts.risk ?? 'R1' });
  s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: opts.cap ?? 100_000, capTokens: 100_000, reasonCode: 'seed' });
  if (opts.reviewPlan) ReviewStore.for(h.store).declarePlan(s.founder, workItem.id, opts.reviewPlan);
  h.store.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  return { workItemId: workItem.id, claim: claimItem(h, workItem.id, `w-${workItem.id.slice(0, 6)}`) };
}

/** Claims exactly this Work Item's queued job and binds its run. */
export function claimItem(h: Harness, workItemId: Id, workerId = 'w-c4'): Claim {
  const job = h.store.jobsFor(workItemId).find((j) => j.state === 'QUEUED');
  if (!job) throw new Error(`no queued job for ${workItemId}`);
  const claim = claimJob(h.store, job.id, { ...h.claimOpts(workerId, 600_000), kinds: C2_KINDS });
  if (!claim) throw new Error('claim failed');
  const begun = beginGovernedRun(h.store, claim.fence);
  if (!begun.ok) throw new Error(`run refused: ${begun.code}`);
  return claim;
}

/** The reviewer runs its own review Work Item and records one decision through the fenced path. */
export function decideAssignment(h: Harness, reviewWorkItemId: Id, outcome: string, rationale: string | null = null): ReturnType<typeof recordReviewDecision> {
  const claim = claimItem(h, reviewWorkItemId, `w-review-${reviewWorkItemId.slice(0, 6)}`);
  const out = recordReviewDecision(h.store, claim.fence, { outcome, reasonCode: 'rubric.applied', rationale, evidenceRefs: ['evidence:rubric'] });
  settle(h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
  return out;
}

/** A completed, plan-governed output Work Item owned by `owner` (so its review request is created at completion). */
export function reviewedOutput(h: Harness, s: Seed, owner: EmployeeRecord, plan = reviewPlan({ appliesTo: 'OUTPUT' })): Id {
  const { workItem } = h.store.createWorkItem({ objective: 'calibration subject', ownerRef: owner.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', dataClass: 'D1', instructions: 'x' } });
  s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 100_000, capTokens: 100_000, reasonCode: 'seed' });
  ReviewStore.for(h.store).declarePlan(s.founder, workItem.id, plan);
  h.store.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  const claim = claimItem(h, workItem.id, 'w-subject');
  settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'done' } }, { backoff });
  return workItem.id;
}

/** A reviewer-role Employee certified by the Academy and admitted to the domain's Review Pool in CALIBRATION. */
export function certifiedCandidate(h: Harness, s: Seed, domain = REVIEW_DOMAIN, departmentId: Id = s.departmentId): { reviewer: EmployeeRecord; qualification: ReviewerQualificationRecord } {
  // C3 certifies an Employee for its CURRENT role (D-C3-24): a reviewer is an Employee holding the domain's reviewer role.
  const reviewer = hire(s.gov, s.founder, departmentId, true, `role:reviewer.${domain}`);
  s.gov.createBudget(s.founder, { scope: 'EMPLOYEE', scopeId: reviewer.id, capMoney: 500_000, capTokens: 500_000, reasonCode: 'seed' });
  // One role blueprint / program per domain per workspace: re-publishing it would put earlier reviewers' certifications up for review.
  const key = `${h.root}|${domain}`;
  const w = WORLDS.get(key) ?? academyWorld(h, s, `role:reviewer.${domain}`, {}, `rv.${domain.replace(/[^a-z0-9]/g, '')}`);
  WORLDS.set(key, w);
  certify(h, s, reviewer, w);
  const qualification = ReviewStore.for(h.store).admitReviewer(s.founder, { employeeId: reviewer.id, domain, level: 'QUALIFIED', maxDataClass: 'D3', reasonCode: 'pool.admitted' });
  return { reviewer, qualification };
}

/**
 * An ACTIVE reviewer of `domain`, through the whole real path: hired (ACTIVE via the C2 test seam, like
 * every C2 fixture Employee), budgeted, Academy-certified for `role:reviewer.<domain>` (its clean holdout is
 * the Gold case), admitted to CALIBRATION, two shadow reviews calibrated by the Founder, promoted.
 */
export function activeReviewer(h: Harness, s: Seed, domain = REVIEW_DOMAIN, departmentId: Id = s.departmentId): { reviewer: EmployeeRecord; qualification: ReviewerQualificationRecord } {
  const rv = ReviewStore.for(h.store);
  const { reviewer, qualification } = certifiedCandidate(h, s, domain, departmentId);
  let q = qualification;
  // Bootstrap calibration: the calibrating reviewer shadows two real subjects; the Founder judges them.
  for (let i = 0; i < 2; i++) {
    const subject = reviewedOutput(h, s, s.employee, reviewPlan({ appliesTo: 'OUTPUT', domain }));
    const request = rv.requests({ workItemId: subject }).find((r) => r.state === 'OPEN');
    const shadow = request ? rv.assignments(request.id).find((a) => a.keyKind === 'SHADOW' && a.reviewerEmployeeId === reviewer.id) : undefined;
    if (!request || !shadow?.reviewWorkItemId) throw new Error('no shadow assignment for the calibrating reviewer');
    decideAssignment(h, shadow.reviewWorkItemId, 'PASS');
    const decision = rv.decisions(request.id).find((d) => d.assignmentId === shadow.id);
    if (!decision) throw new Error('shadow decision missing');
    rv.calibrateShadowDecision(s.founder, decision.id, 'PASS');
  }
  q = rv.promoteReviewer(s.founder, q.id, 'pool.promoted');
  return { reviewer, qualification: q };
}

/**
 * A tool intent for an action that needs independent review (R2 / R3): the first attempt parks on the review,
 * the assigned reviewer passes it through its own run, and the same intent is presented again.
 */
export function intentThroughReview(h: Harness, fence: Fence, workItemId: Id, input: ToolIntentInput): ToolIntent {
  const first = recordToolIntent(h.store, fence, input);
  if (first.kind !== 'REVIEW_REQUIRED') return first;
  decideActionReview(h, workItemId, 'PASS');
  return recordToolIntent(h.store, fence, input);
}

/** Passes (or fails) the open ACTION review of a Work Item through its assigned reviewer's own run. */
export function decideActionReview(h: Harness, workItemId: Id, outcome = 'PASS'): void {
  const rv = ReviewStore.for(h.store);
  const request = rv.requests({ workItemId }).find((r) => r.state === 'OPEN' && r.subjectKind === 'ACTION');
  if (!request) throw new Error('no open action review');
  const a = rv.assignments(request.id).find((x) => x.state === 'ASSIGNED' && x.keyKind === 'SPECIALIST');
  if (!a?.reviewWorkItemId) throw new Error(`no assigned reviewer (waiting: ${String(request.waitingReason)})`);
  decideAssignment(h, a.reviewWorkItemId, outcome);
}
