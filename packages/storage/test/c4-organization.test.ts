/**
 * C4 storage proofs: the canonical organization, company-scoped CEO, time-correct assignments and attribution,
 * acting coverage, staffing, Founder → Employee authority delegation, work delegation / support / handoff.
 * C4-PROOF: storage-organization
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Id } from '@qandeel-company/domain';

import { GovernanceStore, OrganizationStore, ReviewStore } from '../src/index.js';
import { beginGovernedRun, claimJob, interruptClaim, reconcileOrganization, recordOrgAct, reserveBudget, settle } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { disarmFounderTestSurface } from '../src/testing/founder-seam.js';
import { C2_KINDS, hire, seed, testManifest, type Seed } from './c2-helpers.js';
import { activeReviewer, budgetDepartment, decideAssignment, departmentId, newSeat, placed, reviewPlan, runFor, seat } from './c4-helpers.js';
import { backoff, harness, type Harness } from './helpers.js';

const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;
const CANONICAL = ['strategic-market-intelligence', 'growth', 'brand-creative', 'product', 'engineering'];

function withSeed(fn: (h: Harness, s: Seed) => void): void {
  const h = harness();
  try {
    fn(h, seed(h.store));
  } finally {
    h.close();
  }
}

const staffingArgs = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  departmentCode: 'growth',
  roleRef: 'role:growth.seo-specialist',
  positionKind: 'SPECIALIST',
  positionTitle: 'SEO Specialist',
  businessNeed: 'Organic acquisition is unowned.',
  workloadEvidence: 'Twelve open SEO items.',
  skillGap: 'No SEO capability.',
  expectedValue: 'Lower acquisition cost.',
  impactIfNotStaffed: 'The organic channel stays dark.',
  alternatives: { redistributeWork: 'No capacity.', improveSkillOrTraining: 'Too slow.', automate: 'Not automatable.', temporarySpecialistOrCapability: 'None available.' },
  expectedCostMicros: 1_000_000,
  ...over,
});

const inAYear = (h: Harness): string => new Date(Date.parse(h.store.now()) + 365 * 86_400_000).toISOString();

describe('C4 canonical organization (release-seeded Product authority, no invented people)', () => {
  test('C4-PROOF: five canonical Departments (Engineering the permanent fifth), a company-scoped CEO seat reporting to the Founder, one Director seat each — all vacant', () => {
    withSeed((h) => {
      const org = OrganizationStore.for(h.store);
      assert.deepEqual(org.departments().map((d) => d.code).filter((c) => CANONICAL.includes(c)).sort(), [...CANONICAL].sort());
      const ceo = seat(h, 'company.ceo');
      assert.deepEqual([ceo.kind, ceo.scope, ceo.departmentId, ceo.reportsToFounder, ceo.reportsToPositionId], ['CEO', 'COMPANY', null, true, null], 'the CEO seat belongs to no Department (never a fake Executive Department)');
      for (const c of CANONICAL) {
        const d = seat(h, `director.${c}`);
        assert.deepEqual([d.kind, d.scope, d.reportsToPositionId], ['DIRECTOR', 'DEPARTMENT', ceo.id], `director.${c} reports to the CEO seat`);
        const charter = org.charter(d.departmentId as Id);
        assert.equal(charter?.status, 'BASELINE');
        assert.equal(charter?.directorPositionId, d.id);
      }
      assert.equal(org.seatHolder(ceo.id).holder, null, 'no CEO identity is invented');
      assert.ok(org.positions().every((p) => org.seatHolder(p.id).holder === null), 'no seat is pre-staffed');
      assert.equal(org.health().ceoSeatVacant, true);
    });
  });

  test('C4-PROOF: the CEO is company-scoped end to end — no Department on the Employee, its runs, reservations or budget chain', () => {
    withSeed((h, s) => {
      const ceo = placed(h, s, 'company.ceo');
      assert.deepEqual([ceo.orgScope, ceo.departmentId, ceo.managerRef], ['COMPANY', null, s.founder], 'Founder → CEO: the Founder stays the Founder (a principal, never an Employee)');
      const envelope = s.gov.budgetFor('EMPLOYEE', ceo.id);
      assert.equal(envelope?.parentId, s.gov.budgetFor('COMPANY', 'company')?.id, 'the envelope follows the placement to the Company level');
      const { claim } = runFor(h, s, ceo);
      const attr = s.gov.runAttribution(claim.fence.runId);
      assert.deepEqual([attr?.orgScope, attr?.departmentId], ['COMPANY', null]);
      const r = reserveBudget(h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: s.deploymentId, priceCardId: s.priceCardId, routePolicyId: s.policyId, money: 1_000, tokens: 100, contextManifestId: testManifest(h, claim.fence, ceo.id) });
      assert.ok(r.ok, 'a company-scoped run reserves through Work Item → Employee → Company');
      assert.equal(r.ok && r.reservation.departmentId, null);
      const snap = OrganizationStore.for(h.store).runOrgSnapshot(claim.fence.runId);
      assert.deepEqual([snap?.orgScope, snap?.departmentId, snap?.source, snap?.assignmentKind, snap?.ceoEmployeeId], ['COMPANY', null, 'ASSIGNMENT', 'PRIMARY', ceo.id]);
      assert.deepEqual(s.gov.accountingInvariants(), []);
    });
  });
});

describe('C4 assignments are canonical and time-correct', () => {
  test('C4-PROOF: a transfer ends the old assignment, moves the projection and the envelope — earlier runs keep their original attribution', () => {
    withSeed((h, s) => {
      const growth = departmentId(s, 'growth');
      budgetDepartment(s, growth);
      const g = newSeat(h, s, 'growth.analyst-1', 'director.growth');
      const p = newSeat(h, s, 'product.analyst-1', 'director.product');
      const e = hire(s.gov, s.founder, s.departmentId);
      s.gov.createBudget(s.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 200_000, capTokens: 200_000, reasonCode: 'seed' });
      const org = OrganizationStore.for(h.store);
      org.assignPrimary(s.founder, { positionId: g.id, employeeId: e.id, reasonCode: 'placed' });
      assert.equal(s.gov.getEmployee(e.id).departmentId, growth);
      const first = runFor(h, s, s.gov.getEmployee(e.id));
      settle(h.store, first.claim.fence, { type: 'COMPLETED' }, { backoff });
      const beforeEnvelope = s.gov.budgetFor('EMPLOYEE', e.id);
      h.clock.advance(60_000);
      org.assignPrimary(s.founder, { positionId: p.id, employeeId: e.id, reasonCode: 'transfer' });
      const moved = s.gov.getEmployee(e.id);
      assert.deepEqual([moved.departmentId, moved.positionRef, moved.state], [s.departmentId, `position:${p.id}`, 'ACTIVE'], 'same Employee ID, same role: stays ACTIVE');
      const history = org.assignmentsOfEmployee(e.id);
      assert.deepEqual(history.map((a) => [a.positionId, a.status, a.endReasonCode]), [[g.id, 'ENDED', 'TRANSFERRED'], [p.id, 'ACTIVE', null]]);
      assert.equal(org.seatHolder(g.id, first.claim.run.startedAt).holder?.employeeId, e.id, 'the past is still answerable: who held the growth seat then');
      assert.equal(org.seatHolder(g.id).holder, null);
      // The first run's attribution and snapshot are history; the second run is attributed to Product.
      assert.equal(s.gov.runAttribution(first.claim.fence.runId)?.departmentId, growth);
      assert.equal(org.runOrgSnapshot(first.claim.fence.runId)?.departmentId, growth);
      const second = runFor(h, s, moved);
      assert.equal(org.runOrgSnapshot(second.claim.fence.runId)?.departmentId, s.departmentId);
      assert.equal(s.gov.budget(beforeEnvelope?.id as Id).status, 'CLOSED', 'the old envelope keeps its history where it was spent');
      assert.equal(s.gov.budgetFor('EMPLOYEE', e.id)?.parentId, s.gov.budgetFor('DEPARTMENT', s.departmentId)?.id);
      assert.deepEqual(s.gov.accountingInvariants(), []);
      // R2-06: the CLOSED envelope can spend nothing more, so it no longer holds the old Department's cap up.
      const growthBudget = s.gov.budgetFor('DEPARTMENT', growth);
      s.gov.changeBudgetCap(s.founder, growthBudget?.id as Id, { capMoney: 150_000, capTokens: growthBudget?.capTokens as number, reasonCode: 'founder.cut' });
      // A placement is organization data: the C2 path can no longer move an organization-managed Employee.
      assert.throws(() => s.gov.reassignEmployee(s.founder, e.id, { departmentId: growth, reasonCode: 'x' }), code('ORG_MANAGED_EMPLOYEE'));
    });
  });

  test('C4-PROOF: acting coverage is explicit, bounded and expires by time; authority delegated for it ends with it', () => {
    withSeed((h, s) => {
      const org = OrganizationStore.for(h.store);
      const director = placed(h, s, 'director.product');
      const cover = placed(h, s, 'product.app-store-release-reputation-lead');
      const d = seat(h, 'director.product');
      const until = new Date(Date.parse(h.store.now()) + 7 * 86_400_000).toISOString();
      assert.throws(() => org.assignActing(s.founder, { positionId: d.id, employeeId: director.id, until, reasonCode: 'x' }), code('ORG_NOT_ELIGIBLE'), 'the permanent holder does not cover its own seat');
      assert.throws(() => org.assignActing(s.founder, { positionId: d.id, employeeId: cover.id, until: inAYear(h), reasonCode: 'x' }), code('VALIDATION_FAILED'), 'longer than the bound');
      const acting = org.assignActing(s.founder, { positionId: d.id, employeeId: cover.id, until, scope: ['work.delegate'], reasonCode: 'leave.cover' });
      const holding = org.seatHolder(d.id);
      assert.deepEqual([holding.holder?.employeeId, holding.ofRecord?.employeeId], [cover.id, director.id], 'the acting holder is accountable; the permanent holder stays of record');
      const delegation = org.delegateAuthority(s.founder, { employeeId: cover.id, capability: 'org.work.delegate', expiresAt: until, purposeCode: 'acting.cover', actingAssignmentId: acting.id, reasonCode: 'cover' });
      h.clock.advance(8 * 86_400_000);
      assert.equal(org.seatHolder(d.id).holder?.employeeId, director.id, 'expiry is read from time, before any write');
      assert.ok(reconcileOrganization(h.store, h.supervisor) >= 1);
      assert.equal(org.assignmentsOfPosition(d.id).find((a) => a.id === acting.id)?.status, 'EXPIRED');
      assert.equal(org.authorityDelegations(cover.id).find((x) => x.id === delegation.id)?.status, 'REVOKED', 'delegated authority ends with the coverage');
      assert.equal(s.gov.grants(cover.id).find((g) => g.id === delegation.grantId)?.status, 'REVOKED');
    });
  });

  test('C4-PROOF: headcount is data — seats are added, paused, re-opened and retired without code; a held seat is not retired', () => {
    withSeed((h, s) => {
      const org = OrganizationStore.for(h.store);
      const extra = newSeat(h, s, 'growth.copywriter-1', 'director.growth');
      const e = placed(h, s, 'growth.copywriter-1');
      assert.throws(() => org.setPositionStatus(s.founder, extra.id, 'RETIRED', 'x'), code('ORG_NOT_ELIGIBLE'));
      org.endAssignment(s.founder, org.assignmentsOfEmployee(e.id)[0]?.id as string, 'role.closed');
      org.setPositionStatus(s.founder, extra.id, 'PAUSED', 'hiring.freeze');
      org.setPositionStatus(s.founder, extra.id, 'ACTIVE', 'reopened');
      org.setPositionStatus(s.founder, extra.id, 'RETIRED', 'retired');
      assert.throws(() => org.setPositionStatus(s.founder, extra.id, 'ACTIVE', 'x'), code('INVALID_TRANSITION'));
      assert.throws(() => org.setPositionStatus(s.founder, seat(h, 'company.ceo').id, 'RETIRED', 'x'), code('ORG_NOT_ELIGIBLE'));
      assert.throws(() => org.createPosition(s.founder, { code: 'product.misfiled-1', title: 'x', scope: 'DEPARTMENT', departmentId: s.departmentId, kind: 'SPECIALIST', roleRef: 'role:analyst', reportsToPositionId: seat(h, 'director.growth').id, reasonCode: 'x' }), code('VALIDATION_FAILED'), 'a Department seat reports inside its Department');
      assert.throws(() => org.createPosition(s.founder, { code: 'growth.director-2', title: 'x', scope: 'DEPARTMENT', departmentId: departmentId(s, 'growth'), kind: 'DIRECTOR', roleRef: 'role:director.growth', reportsToPositionId: seat(h, 'company.ceo').id, reasonCode: 'x' }), code('VALIDATION_FAILED'), 'one live Director seat per Department');
    });
  });
});

describe('C4 Title ≠ Authority: organizational acts need a seat AND an explicit grant', () => {
  test('C4-PROOF: staffing — Directors request, the CEO synthesizes, a capped delegation decides and hires; nobody becomes ACTIVE', () => {
    withSeed((h, s) => {
      const org = OrganizationStore.for(h.store);
      const director = placed(h, s, 'director.growth');
      const ceo = placed(h, s, 'company.ceo');
      const d = runFor(h, s, director);
      // A seat alone authorizes nothing.
      assert.deepEqual(recordOrgAct(h.store, d.claim.fence, 1, 'staffing.request.create', staffingArgs()), { outcome: 'REFUSED', code: 'NO_GRANT', resultRef: null, after: 'CONTINUE', replayed: false, paused: false });
      org.delegateAuthority(s.founder, { employeeId: director.id, capability: 'org.staffing.request', expiresAt: inAYear(h), purposeCode: 'staffing', reasonCode: 'delegated' });
      assert.equal(recordOrgAct(h.store, d.claim.fence, 2, 'staffing.request.create', staffingArgs({ alternatives: { redistributeWork: 'x' } })).code, 'STAFFING_EVIDENCE_INCOMPLETE');
      assert.equal(recordOrgAct(h.store, d.claim.fence, 3, 'staffing.request.create', staffingArgs({ departmentCode: 'product' })).code, 'SEAT_NOT_HELD', 'a Director files for its own Department only');
      const filed = recordOrgAct(h.store, d.claim.fence, 4, 'staffing.request.create', staffingArgs());
      assert.equal(filed.outcome, 'DONE');
      const requestId = String(filed.resultRef).split(':')[1] as Id;
      assert.equal(recordOrgAct(h.store, d.claim.fence, 4, 'staffing.request.create', staffingArgs()).replayed, true, 'a resumed step replays; the act is not repeated');
      assert.equal(recordOrgAct(h.store, d.claim.fence, 4, 'staffing.request.create', staffingArgs({ positionTitle: 'Other' })).code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(org.staffingRequests().length, 1);
      // The CEO challenges / recommends; deciding and hiring need their own, capped delegation.
      const c = runFor(h, s, ceo);
      org.delegateAuthority(s.founder, { employeeId: ceo.id, capability: 'org.staffing.review', expiresAt: inAYear(h), purposeCode: 'staffing', reasonCode: 'delegated' });
      assert.equal(recordOrgAct(h.store, c.claim.fence, 1, 'staffing.request.decide', { requestId, decision: 'APPROVE' }).code, 'NO_GRANT', 'synthesis authority is not decision authority');
      assert.equal(recordOrgAct(h.store, c.claim.fence, 2, 'staffing.request.review', { requestId, action: 'RECOMMEND_APPROVE', priority: 10 }).outcome, 'DONE');
      org.delegateAuthority(s.founder, { employeeId: ceo.id, capability: 'org.staffing.decide', expiresAt: inAYear(h), purposeCode: 'staffing', limits: { maxCostMicros: 500_000, departmentCodes: ['growth'] }, reasonCode: 'delegated' });
      assert.equal(recordOrgAct(h.store, c.claim.fence, 3, 'staffing.request.decide', { requestId, decision: 'APPROVE' }).code, 'DELEGATION_COST_LIMIT', 'the delegation limit binds');
      assert.equal(org.staffingRequest(requestId).state, 'RECOMMENDED');
      org.revokeDelegation(s.founder, org.authorityDelegations(ceo.id).find((x) => x.status === 'ACTIVE' && s.gov.grants(ceo.id).find((g) => g.id === x.grantId)?.capability === 'org.staffing.decide')?.id as string, 'widened');
      org.delegateAuthority(s.founder, { employeeId: ceo.id, capability: 'org.staffing.decide', expiresAt: inAYear(h), purposeCode: 'staffing', limits: { maxCostMicros: 2_000_000, departmentCodes: ['growth'] }, reasonCode: 'delegated' });
      assert.equal(recordOrgAct(h.store, c.claim.fence, 4, 'staffing.request.decide', { requestId, decision: 'APPROVE', positionCode: 'growth.seo-1' }).outcome, 'DONE');
      const approved = org.staffingRequest(requestId);
      assert.equal(approved.state, 'APPROVED');
      assert.match(String(approved.decisionAuthorityRef), /^authority_delegation:/);
      const newSeatRec = org.position(approved.approvedPositionId as Id);
      assert.deepEqual([newSeatRec.code, newSeatRec.reportsToPositionId, newSeatRec.source], ['growth.seo-1', seat(h, 'director.growth').id, 'STAFFING_REQUEST']);
      org.delegateAuthority(s.founder, { employeeId: ceo.id, capability: 'org.staffing.hire', expiresAt: inAYear(h), purposeCode: 'staffing', limits: { maxCostMicros: 2_000_000 }, reasonCode: 'delegated' });
      const hired = recordOrgAct(h.store, c.claim.fence, 5, 'staffing.hire', { requestId, name: { given: 'Rania', family: 'Fouad' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' } });
      assert.equal(hired.outcome, 'DONE');
      const newcomer = s.gov.getEmployee(String(hired.resultRef).split(':')[1] as Id);
      assert.deepEqual([newcomer.state, newcomer.departmentId, newcomer.roleRef], ['CANDIDATE', departmentId(s, 'growth'), 'role:growth.seo-specialist'], 'a hire is a CANDIDATE: the Academy still decides activation');
      assert.equal(org.seatHolder(newSeatRec.id).holder?.employeeId, newcomer.id);
      assert.equal(recordOrgAct(h.store, c.claim.fence, 6, 'staffing.hire', { requestId, name: { given: 'Sara', family: 'Fouad' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' } }).code, 'STAFFING_NOT_HIRABLE', 'one hire per request');
      // Rule A: business evidence never reaches audit or events.
      const telemetry = JSON.stringify([...h.store.audit(d.claim.fence.runId), ...h.store.audit(requestId), ...h.store.pendingEvents(5_000)]);
      assert.ok(!telemetry.includes('Organic acquisition') && !telemetry.includes('Twelve open SEO items'));
    });
  });

  test('C4-PROOF: an Employee never delegates authority; only the Founder does, and never R2 / R4 or approval', () => {
    withSeed((h, s) => {
      const org = OrganizationStore.for(h.store);
      const ceo = placed(h, s, 'company.ceo');
      assert.throws(() => org.delegateAuthority(ceo.ref, { employeeId: ceo.id, capability: 'org.staffing.decide', expiresAt: inAYear(h), purposeCode: 'x', reasonCode: 'x' }), (e) => isQandeelError(e) && ['SELF_ESCALATION_REFUSED', 'FOUNDER_ONLY', 'AUTHORITY_DENIED'].includes(e.code));
      assert.throws(() => org.delegateAuthority(s.founder, { employeeId: ceo.id, capability: 'tool:publisher.publish', expiresAt: inAYear(h), purposeCode: 'x', reasonCode: 'x' }), code('VALIDATION_FAILED'));
      assert.throws(() => org.delegateAuthority(s.founder, { employeeId: ceo.id, capability: 'org.staffing.decide', expiresAt: inAYear(h), purposeCode: 'x', limits: { approveR4: true }, reasonCode: 'x' }), code('VALIDATION_FAILED'));
    });
  });
});

describe('C4 work delegation ≠ authority delegation: bounded, acyclic, accountable handoffs', () => {
  test('C4-PROOF: delegation down the reporting line; support across Departments; cycles and outsiders refused; the child is ordinary lineage work', () => {
    withSeed((h, s) => {
      const org = OrganizationStore.for(h.store);
      const director = placed(h, s, 'director.growth');
      newSeat(h, s, 'growth.analyst-1', 'director.growth');
      const report = placed(h, s, 'growth.analyst-1');
      const productDirector = placed(h, s, 'director.product');
      org.delegateAuthority(s.founder, { employeeId: director.id, capability: 'org.work.delegate', expiresAt: inAYear(h), purposeCode: 'work', reasonCode: 'delegated' });
      org.delegateAuthority(s.founder, { employeeId: director.id, capability: 'org.work.support', expiresAt: inAYear(h), purposeCode: 'work', reasonCode: 'delegated' });
      org.delegateAuthority(s.founder, { employeeId: productDirector.id, capability: 'org.work.support', expiresAt: inAYear(h), purposeCode: 'work', reasonCode: 'delegated' });
      const parent = runFor(h, s, director, { cap: 100_000 });
      const task = { objective: 'Draft the Egypt SEO brief', instructions: 'Keep it short.', taskClass: 'draft.memo', budgetMoney: 80_000, budgetTokens: 10_000 };
      assert.equal(recordOrgAct(h.store, parent.claim.fence, 1, 'work.delegate', { ...task, delegateEmployeeId: productDirector.id }).code, 'DELEGATE_NOT_IN_REPORTING_LINE', 'across Departments it is a support request, never a delegation');
      const delegated = recordOrgAct(h.store, parent.claim.fence, 2, 'work.delegate', { ...task, delegateEmployeeId: report.id });
      assert.equal(delegated.outcome, 'DONE');
      const childId = String(delegated.resultRef).split(':')[1] as Id;
      const child = h.store.getWorkItem(childId);
      assert.deepEqual([child.parentId, child.rootId, child.ownerRef, child.state], [parent.workItemId, parent.workItemId, report.ref, 'READY']);
      assert.equal(s.gov.budgetFor('WORK_ITEM', childId)?.capMoney, 80_000, 'within the parent Work Item cap; no budget is created');
      assert.equal(s.gov.grants(report.id).some((g) => g.capability.startsWith('org.')), false, 'delegating work grants the delegate nothing');
      const [handoff] = org.workDelegations({ parentWorkItemId: parent.workItemId });
      assert.deepEqual([handoff?.state, handoff?.accountableOwnerRef, handoff?.depth], ['OFFERED', director.ref, 1]);
      // Support request: to the accountable holder of the target Department's Director seat.
      const support = recordOrgAct(h.store, parent.claim.fence, 3, 'work.support.request', { ...task, departmentCode: 'product' });
      assert.equal(support.outcome, 'DONE');
      const supportChild = String(support.resultRef).split(':')[1] as Id;
      assert.equal(h.store.getWorkItem(supportChild).ownerRef, productDirector.ref);
      assert.equal(s.gov.budgetFor('WORK_ITEM', supportChild)?.capMoney, 20_000, 'the parent cap bounds what it delegates in aggregate');
      assert.equal(recordOrgAct(h.store, parent.claim.fence, 5, 'work.delegate', { ...task, delegateEmployeeId: report.id }).code, 'PARENT_BUDGET_EXHAUSTED');
      assert.equal(recordOrgAct(h.store, parent.claim.fence, 4, 'work.support.request', { ...task, departmentCode: 'growth' }).code, 'SUPPORT_WITHIN_OWN_DEPARTMENT');
      // The delegator parks at zero tokens: an offered handoff is not an answer, so the re-check is no free wake.
      settle(h.store, parent.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_DELEGATION' }, { backoff });
      assert.equal(h.store.jobsFor(parent.workItemId).at(-1)?.state, 'WAITING');
      // Ping-pong: the support request cannot bounce back to the requester's line.
      const sc = claimItem2(h, supportChild);
      assert.equal(recordOrgAct(h.store, sc.fence, 1, 'work.support.request', { ...task, departmentCode: 'growth' }).code, 'DELEGATION_CYCLE');
      settle(h.store, sc.fence, { type: 'COMPLETED' }, { backoff });
      assert.equal(h.store.jobsFor(parent.workItemId).at(-1)?.state, 'QUEUED', 'the finished support work wakes exactly the delegator (targeted wake, same transaction)');
      const cc = claimItem2(h, childId);
      assert.equal(org.workDelegations({ childWorkItemId: childId })[0]?.state, 'ACCEPTED');
      settle(h.store, cc.fence, { type: 'COMPLETED' }, { backoff });
      assert.equal(org.workDelegations({ childWorkItemId: childId })[0]?.state, 'COMPLETED', 'the handoff follows its work in the same transaction');
    });
  });

  test('C4-PROOF: refusal, clarification and escalation are explicit handoff states; their text stays local (Rule A)', () => {
    withSeed((h, s) => {
      const org = OrganizationStore.for(h.store);
      const director = placed(h, s, 'director.growth');
      newSeat(h, s, 'growth.analyst-1', 'director.growth');
      const report = placed(h, s, 'growth.analyst-1');
      org.delegateAuthority(s.founder, { employeeId: director.id, capability: 'org.work.delegate', expiresAt: inAYear(h), purposeCode: 'work', reasonCode: 'delegated' });
      const parent = runFor(h, s, director);
      const task = { delegateEmployeeId: report.id, objective: 'Brief', instructions: 'Short.', taskClass: 'draft.memo', budgetMoney: 10_000, budgetTokens: 10_000 };
      const a = String(recordOrgAct(h.store, parent.claim.fence, 1, 'work.delegate', task).resultRef).split(':')[1] as Id;
      const b = String(recordOrgAct(h.store, parent.claim.fence, 2, 'work.delegate', task).resultRef).split(':')[1] as Id;
      settle(h.store, parent.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_DELEGATION' }, { backoff });
      // Clarification: the delegate asks and parks; the delegator answers from its own run; the delegate is woken.
      const ca = claimItem2(h, a);
      const asked = recordOrgAct(h.store, ca.fence, 1, 'handoff.clarification.request', { reason: 'Which market segment — Cairo only?' });
      assert.deepEqual([asked.outcome, asked.code, asked.after], ['DONE', 'DONE', 'WAIT_CLARIFICATION']);
      settle(h.store, ca.fence, { type: 'WAIT', reasonCode: 'AWAITING_CLARIFICATION' }, { backoff });
      assert.equal(h.store.jobsFor(parent.workItemId).at(-1)?.state, 'QUEUED', 'the delegator is woken by the question');
      const p2 = claimItem2(h, parent.workItemId);
      const delegationA = org.workDelegations({ childWorkItemId: a })[0];
      assert.equal(recordOrgAct(h.store, p2.fence, 1001, 'handoff.clarify', { delegationId: delegationA?.id, answer: 'Cairo and Alexandria.' }).outcome, 'DONE');
      assert.equal(org.workDelegations({ childWorkItemId: a })[0]?.state, 'ACCEPTED');
      assert.equal(h.store.jobsFor(a).at(-1)?.state, 'QUEUED');
      // Refusal: explicit, reasoned; the child ends and the delegator learns it.
      const cb = claimItem2(h, b);
      const refused = recordOrgAct(h.store, cb.fence, 1, 'handoff.refuse', { reason: 'Outside my certified role.' });
      assert.deepEqual([refused.outcome, refused.after], ['DONE', 'END_REFUSED']);
      assert.equal(org.workDelegations({ childWorkItemId: b })[0]?.state, 'REFUSED');
      settle(h.store, cb.fence, { type: 'PERMANENT_FAILURE', code: 'HANDOFF_REFUSED' }, { backoff });
      // Escalation → the Founder resumes it.
      const ca2 = claimItem2(h, a);
      assert.equal(recordOrgAct(h.store, ca2.fence, 1000, 'handoff.escalate', { reason: 'Conflicting brand guidance.' }).after, 'WAIT_ESCALATION');
      settle(h.store, ca2.fence, { type: 'WAIT', reasonCode: 'AWAITING_ESCALATION' }, { backoff });
      assert.equal(org.executiveQueues().founder.escalatedHandoffIds.length, 1);
      org.resumeEscalatedHandoff(s.founder, delegationA?.id as string, 'guidance.given');
      assert.equal(h.store.jobsFor(a).at(-1)?.state, 'QUEUED');
      assert.equal(org.handoffMessages(delegationA?.id as Id).length, 3);
      const telemetry = JSON.stringify([...h.store.pendingEvents(5_000), ...h.store.audit(delegationA?.id as Id)]);
      for (const text of ['Cairo only', 'Cairo and Alexandria', 'Outside my certified role', 'Conflicting brand']) assert.ok(!telemetry.includes(text), `"${text}" stays out of telemetry`);
    });
  });

  test('R2-04: an escalated handoff parks its delegator at every WAIT settle (one open-handoff set); only an answer wakes it', () => {
    withSeed((h, s) => {
      const org = OrganizationStore.for(h.store);
      const director = placed(h, s, 'director.growth');
      newSeat(h, s, 'growth.analyst-1', 'director.growth');
      const report = placed(h, s, 'growth.analyst-1');
      org.delegateAuthority(s.founder, { employeeId: director.id, capability: 'org.work.delegate', expiresAt: inAYear(h), purposeCode: 'work', reasonCode: 'delegated' });
      const parent = runFor(h, s, director);
      const task = { delegateEmployeeId: report.id, objective: 'Brief', instructions: 'Short.', taskClass: 'draft.memo', budgetMoney: 10_000, budgetTokens: 10_000 };
      const child = String(recordOrgAct(h.store, parent.claim.fence, 1, 'work.delegate', task).resultRef).split(':')[1] as Id;
      settle(h.store, parent.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_DELEGATION' }, { backoff });
      h.clock.advance(1_000);
      const c = claimItem2(h, child);
      assert.equal(recordOrgAct(h.store, c.fence, 1, 'handoff.escalate', { reason: 'Conflicting guidance.' }).after, 'WAIT_ESCALATION');
      settle(h.store, c.fence, { type: 'WAIT', reasonCode: 'AWAITING_ESCALATION' }, { backoff });
      assert.equal(h.store.jobsFor(parent.workItemId).at(-1)?.state, 'QUEUED', 'the escalation itself is news to the delegator: woken once');
      // Its re-run can only wait for the Founder: the ESCALATED handoff is open, so the WAIT settle parks (no re-queue, no paid re-run).
      for (let i = 0; i < 2; i++) {
        h.clock.advance(1_000);
        const p = claimItem2(h, parent.workItemId);
        settle(h.store, p.fence, { type: 'WAIT', reasonCode: 'AWAITING_DELEGATION' }, { backoff });
        assert.equal(h.store.jobsFor(parent.workItemId).at(-1)?.state, 'WAITING');
        if (i === 0) org.resumeEscalatedHandoff(s.founder, org.workDelegations({ childWorkItemId: child })[0]?.id as string, 'guidance.given');
      }
      assert.equal(org.workDelegations({ childWorkItemId: child })[0]?.state, 'ACCEPTED');
    });
  });

  test('R2-04 / m-01: a restart between a clarification request and its WAIT settle keeps the question open', () => {
    withSeed((h, s) => {
      const org = OrganizationStore.for(h.store);
      const director = placed(h, s, 'director.growth');
      newSeat(h, s, 'growth.analyst-1', 'director.growth');
      const report = placed(h, s, 'growth.analyst-1');
      org.delegateAuthority(s.founder, { employeeId: director.id, capability: 'org.work.delegate', expiresAt: inAYear(h), purposeCode: 'work', reasonCode: 'delegated' });
      const parent = runFor(h, s, director);
      const task = { delegateEmployeeId: report.id, objective: 'Brief', instructions: 'Short.', taskClass: 'draft.memo', budgetMoney: 10_000, budgetTokens: 10_000 };
      const child = String(recordOrgAct(h.store, parent.claim.fence, 1, 'work.delegate', task).resultRef).split(':')[1] as Id;
      settle(h.store, parent.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_DELEGATION' }, { backoff });
      const c = claimItem2(h, child);
      assert.equal(recordOrgAct(h.store, c.fence, 1, 'handoff.clarification.request', { reason: 'Which segment?' }).after, 'WAIT_CLARIFICATION');
      interruptClaim(h.store, h.supervisor, c.fence.jobId, 'LEASE_EXPIRED'); // the process died before its WAIT settle
      h.clock.advance(120_000);
      const c2 = claimItem2(h, child);
      assert.equal(org.workDelegations({ childWorkItemId: child })[0]?.state, 'CLARIFICATION_REQUESTED', 'starting work again never answers the question');
      assert.equal(recordOrgAct(h.store, c2.fence, 1, 'handoff.clarification.request', { reason: 'Which segment?' }).after, 'WAIT_CLARIFICATION');
      settle(h.store, c2.fence, { type: 'WAIT', reasonCode: 'AWAITING_CLARIFICATION' }, { backoff });
      assert.equal(h.store.jobsFor(child).at(-1)?.state, 'WAITING');
    });
  });

  test('R2-05: a review-required child closes its handoff only once REVIEWED; rework keeps the delegator waiting', () => {
    withSeed((h, s) => {
      const org = OrganizationStore.for(h.store);
      const review = ReviewStore.for(h.store);
      activeReviewer(h, s);
      activeReviewer(h, s);
      const director = placed(h, s, 'director.growth');
      newSeat(h, s, 'growth.analyst-1', 'director.growth');
      const report = placed(h, s, 'growth.analyst-1');
      org.delegateAuthority(s.founder, { employeeId: director.id, capability: 'org.work.delegate', expiresAt: inAYear(h), purposeCode: 'work', reasonCode: 'delegated' });
      const parent = runFor(h, s, director);
      const out = recordOrgAct(h.store, parent.claim.fence, 1, 'work.delegate', { delegateEmployeeId: report.id, objective: 'Brief', instructions: 'Short.', taskClass: 'draft.memo', budgetMoney: 10_000, budgetTokens: 10_000, reviewPlan: reviewPlan({ appliesTo: 'OUTPUT' }) });
      const child = String(out.resultRef).split(':')[1] as Id;
      settle(h.store, parent.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_DELEGATION' }, { backoff });
      const handoff = () => org.workDelegations({ childWorkItemId: child })[0]?.state;
      const parentJob = () => h.store.jobsFor(parent.workItemId).at(-1)?.state;
      const reviewKey = (): Id => {
        const request = review.requests({ workItemId: child }).find((r) => r.state === 'OPEN');
        return review.assignments(request?.id as Id).find((a) => a.state === 'ASSIGNED')?.reviewWorkItemId as Id;
      };
      settle(h.store, claimItem2(h, child).fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft' } }, { backoff });
      assert.deepEqual([h.store.getWorkItem(child).state, handoff(), parentJob()], ['WAITING_REVIEW', 'ACCEPTED', 'WAITING'], 'finished execution is not reviewed work');
      assert.equal(decideAssignment(h, reviewKey(), 'FAIL').code, 'RECORDED');
      assert.deepEqual([h.store.getWorkItem(child).state, handoff(), parentJob()], ['READY', 'ACCEPTED', 'WAITING'], 'rework stays inside the open handoff');
      settle(h.store, claimItem2(h, child).fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v2' } }, { backoff });
      assert.equal(decideAssignment(h, reviewKey(), 'PASS').code, 'RECORDED');
      assert.deepEqual([h.store.getWorkItem(child).state, handoff(), parentJob()], ['REVIEWED', 'COMPLETED', 'QUEUED'], 'reviewed: the handoff closes and the delegator is woken in the same transaction');
    });
  });

  test('RR2-2 / RR2-5: a handoff never outlives its delegator — a delegator that fails or is cancelled closes its open handoffs and cancels the work it delegated', () => {
    withSeed((h, s) => {
      const org = OrganizationStore.for(h.store);
      const review = ReviewStore.for(h.store);
      activeReviewer(h, s);
      activeReviewer(h, s);
      const director = placed(h, s, 'director.growth');
      newSeat(h, s, 'growth.analyst-1', 'director.growth');
      const report = placed(h, s, 'growth.analyst-1');
      org.delegateAuthority(s.founder, { employeeId: director.id, capability: 'org.work.delegate', expiresAt: inAYear(h), purposeCode: 'work', reasonCode: 'delegated' });
      const task = { delegateEmployeeId: report.id, objective: 'Brief', instructions: 'Short.', taskClass: 'draft.memo', budgetMoney: 10_000, budgetTokens: 10_000 };
      const delegation = (child: Id) => org.workDelegations({ childWorkItemId: child })[0];
      const history = (id: string | undefined): string[] =>
        id === undefined ? [] : storeContext(h.store).db.all<{ t: string; r: string }>('SELECT to_state AS t, reason_code AS r FROM work_delegation_history WHERE delegation_id = ? ORDER BY id', id).map((x) => `${x.t}:${x.r}`);
      const job = (wi: Id) => h.store.jobsFor(wi).at(-1)?.state;
      // (1) The delegator FAILS (e.g. MAX_TURNS) while its delegate's question is pending.
      const p1 = runFor(h, s, director);
      const asked = String(recordOrgAct(h.store, p1.claim.fence, 1, 'work.delegate', task).resultRef).split(':')[1] as Id;
      settle(h.store, p1.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_DELEGATION' }, { backoff });
      const ca = claimItem2(h, asked);
      assert.equal(recordOrgAct(h.store, ca.fence, 1, 'handoff.clarification.request', { reason: 'Which segment?' }).after, 'WAIT_CLARIFICATION');
      settle(h.store, ca.fence, { type: 'WAIT', reasonCode: 'AWAITING_CLARIFICATION' }, { backoff });
      settle(h.store, claimItem2(h, p1.workItemId).fence, { type: 'PERMANENT_FAILURE', code: 'MAX_TURNS' }, { backoff });
      assert.deepEqual([delegation(asked)?.state, delegation(asked)?.responseReasonCode, h.store.getWorkItem(asked).state, job(asked)], ['CANCELLED', 'PARENT_ENDED', 'CANCELLED', 'CANCELLED'], 'no question left open, no child left waiting under a FAILED delegator');
      assert.deepEqual(history(delegation(asked)?.id).slice(-1), ['CANCELLED:PARENT_ENDED']);
      // (2) The delegator is CANCELLED while its review-required child waits for review (retained: it is finished).
      const p2 = runFor(h, s, director);
      const reviewed = String(recordOrgAct(h.store, p2.claim.fence, 1, 'work.delegate', { ...task, reviewPlan: reviewPlan({ appliesTo: 'OUTPUT' }) }).resultRef).split(':')[1] as Id;
      settle(h.store, p2.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_DELEGATION' }, { backoff });
      settle(h.store, claimItem2(h, reviewed).fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft' } }, { backoff });
      const t = h.store.requestCancellation(p2.workItemId, { reasonCode: 'founder.cancel', actorRef: s.founder });
      assert.deepEqual([t.retained, h.store.getWorkItem(reviewed).state, delegation(reviewed)?.state, delegation(reviewed)?.responseReasonCode], [[reviewed], 'WAITING_REVIEW', 'CANCELLED', 'PARENT_ENDED']);
      const request = review.requests({ workItemId: reviewed }).find((r) => r.state === 'OPEN');
      const key = review.assignments(request?.id as Id).find((a) => a.state === 'ASSIGNED')?.reviewWorkItemId as Id;
      assert.equal(decideAssignment(h, key, 'FAIL').code, 'RECORDED');
      assert.deepEqual([h.store.getWorkItem(reviewed).state, job(reviewed)], ['CANCELLED', 'DONE'], 'sent back to rework under a dead delegator: cancelled by the propagation it would have had, never re-queued');
      // (3) A child held for reconciliation is never cancelled (it stays surfaced as a held job); its handoff still closes.
      const p3 = runFor(h, s, director);
      const held = String(recordOrgAct(h.store, p3.claim.fence, 1, 'work.delegate', task).resultRef).split(':')[1] as Id;
      settle(h.store, p3.claim.fence, { type: 'WAIT', reasonCode: 'AWAITING_DELEGATION' }, { backoff });
      settle(h.store, claimItem2(h, held).fence, { type: 'RECONCILIATION_REQUIRED', code: 'TOOL_OUTCOME_UNCERTAIN' }, { backoff });
      h.store.requestCancellation(p3.workItemId, { reasonCode: 'founder.cancel', actorRef: s.founder });
      assert.deepEqual([delegation(held)?.state, h.store.getWorkItem(held).state, job(held)], ['CANCELLED', 'BLOCKED', 'RECONCILIATION_HOLD']);
    });
  });

  test('C4-PROOF: a constrained Academy run acts on nothing organizational; an unknown act is refused', () => {
    withSeed((h, s) => {
      const director = placed(h, s, 'director.growth');
      const r = runFor(h, s, director);
      assert.equal(recordOrgAct(h.store, r.claim.fence, 1, 'founder.approve', {}).code, 'UNKNOWN_ORG_ACTION');
      assert.equal(recordOrgAct(h.store, r.claim.fence, 2, '__proto__', {}).code, 'UNKNOWN_ORG_ACTION');
    });
  });
});

describe('C4 production posture', () => {
  test('C4-PROOF: every Founder organization write fails closed without the authenticated Founder surface', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      disarmFounderTestSurface(h.store.workspace.root);
      const org = OrganizationStore.for(h.store);
      const ceo = seat(h, 'company.ceo');
      for (const attempt of [
        () => org.createPosition(s.founder, { code: 'x.y', title: 'x', scope: 'COMPANY', kind: 'SPECIALIST', roleRef: 'role:x', reportsToPositionId: ceo.id, reasonCode: 'x' }),
        () => org.assignPrimary(s.founder, { positionId: ceo.id, employeeId: s.employee.id, reasonCode: 'x' }),
        () => org.delegateAuthority(s.founder, { employeeId: s.employee.id, capability: 'org.work.delegate', expiresAt: '2099-01-01T00:00:00.000Z', purposeCode: 'x', reasonCode: 'x' }),
        () => org.setPositionStatus(s.founder, ceo.id, 'PAUSED', 'x'),
      ]) assert.throws(attempt, code('FOUNDER_SURFACE_UNAVAILABLE'));
      assert.equal(GovernanceStore.for(h.store).getEmployee(s.employee.id).departmentId, s.departmentId, 'nothing changed');
    } finally {
      h.close();
    }
  });
});

/** Claims one Work Item's queued job and binds its run (a second worker id per call). */
let n = 0;
function claimItem2(h: Harness, workItemId: Id) {
  const job = h.store.jobsFor(workItemId).find((j) => j.state === 'QUEUED');
  if (!job) throw new Error(`nothing queued for ${workItemId}`);
  const claim = claimJob(h.store, job.id, { ...h.claimOpts(`w-org-${++n}`, 600_000), kinds: C2_KINDS });
  if (!claim) throw new Error('claim failed');
  const begun = beginGovernedRun(h.store, claim.fence);
  if (!begun.ok) throw new Error(begun.code);
  return claim;
}

