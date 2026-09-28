/**
 * C4 organization / delegation / review kernel proofs (pure, deterministic). C4-PROOF: c4-kernel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Timestamp } from '@qandeel-company/domain';

import {
  MAX_ACTING_DAYS,
  MAX_DELEGATION_DEPTH,
  MAX_OPEN_DELEGATIONS_PER_PARENT,
  ORG_ACTIONS,
  actionNeedsReview,
  assertActingWindow,
  assertCapability,
  assertDelegationBounds,
  assertPositionTransition,
  assertRoleRef,
  calibrationSignal,
  decideOrgAct,
  delegationCycle,
  evaluateRequest,
  independenceViolation,
  limitsAllow,
  orgActionCapability,
  outputSubjectFingerprint,
  parseDelegationLimits,
  parseProposal,
  parseReviewPlan,
  parseStaffingRequest,
  parentScopeFor,
  planAppliesTo,
  promotionGaps,
  reviewerRoleFor,
  seatHolderAt,
  staffingReviewTarget,
  type AssignmentView,
  type GrantView,
} from '../src/index.js';

const T = (s: string): Timestamp => s as Timestamp;
const A = (id: string, employeeId: string, kind: 'PRIMARY' | 'ACTING', from: string, to: string | null): AssignmentView => ({ id, employeeId, kind, effectiveFrom: T(from), effectiveTo: to === null ? null : T(to) });

const staffing = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  departmentCode: 'growth',
  roleRef: 'role:growth.seo-specialist',
  positionKind: 'SPECIALIST',
  positionTitle: 'SEO Specialist',
  businessNeed: 'Organic acquisition in Egypt is unowned.',
  workloadEvidence: 'Twelve open SEO items over six weeks.',
  skillGap: 'No certified SEO capability in Growth.',
  expectedValue: 'Lower paid acquisition cost.',
  impactIfNotStaffed: 'Organic channel stays dark.',
  alternatives: { redistributeWork: 'Tried; no capacity.', improveSkillOrTraining: 'Academy path is 8 weeks.', automate: 'Not automatable.', temporarySpecialistOrCapability: 'No temporary capability.' },
  expectedCostMicros: 1_000_000,
  ...over,
});

const plan = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  domain: 'growth.content',
  appliesTo: 'BOTH',
  keys: [{ kind: 'SPECIALIST' }],
  rubric: { code: 'content.quality', version: 1 },
  reviewerInstructions: 'Check factual accuracy and brand fit.',
  reviewTaskClass: 'review',
  reviewBudget: { money: 10_000, tokens: 10_000 },
  ...over,
});

describe('C4 kernel — organization', () => {
  test('C4-PROOF: seat holder at T — acting coverage takes accountability for its bounded window, then the primary holder returns', () => {
    const rows = [A('p', 'emp-a', 'PRIMARY', '2026-01-01T00:00:00.000Z', null), A('x', 'emp-b', 'ACTING', '2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z')];
    assert.equal(seatHolderAt(rows, T('2026-01-15T00:00:00.000Z')).holder?.employeeId, 'emp-a');
    const during = seatHolderAt(rows, T('2026-02-15T00:00:00.000Z'));
    assert.equal(during.holder?.employeeId, 'emp-b', 'the acting holder is accountable');
    assert.equal(during.ofRecord?.employeeId, 'emp-a', 'the permanent holder of record is kept');
    assert.equal(seatHolderAt(rows, T('2026-03-01T00:00:00.000Z')).holder?.employeeId, 'emp-a', 'expiry is read from time (end exclusive)');
    assert.equal(seatHolderAt([], T('2026-01-01T00:00:00.000Z')).holder, null, 'a vacant seat has no holder');
    // A transfer: the old primary ended, the new primary starts — never two current owners.
    const moved = [A('p1', 'emp-a', 'PRIMARY', '2026-01-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'), A('p2', 'emp-c', 'PRIMARY', '2026-04-01T00:00:00.000Z', null)];
    assert.equal(seatHolderAt(moved, T('2026-03-31T23:59:59.999Z')).holder?.employeeId, 'emp-a');
    assert.equal(seatHolderAt(moved, T('2026-04-01T00:00:00.000Z')).holder?.employeeId, 'emp-c');
  });

  test('C4-PROOF: acting coverage is explicit and bounded', () => {
    assert.throws(() => assertActingWindow(T('2026-01-02T00:00:00.000Z'), T('2026-01-01T00:00:00.000Z')), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => assertActingWindow(T('2026-01-01T00:00:00.000Z'), T(new Date(Date.parse('2026-01-01T00:00:00.000Z') + (MAX_ACTING_DAYS + 1) * 86_400_000).toISOString())), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.doesNotThrow(() => assertActingWindow(T('2026-01-01T00:00:00.000Z'), T('2026-02-01T00:00:00.000Z')));
  });

  test('C4-PROOF: seat lifecycle is data (add → activate → pause ↔ activate → retire); retired is history', () => {
    assertPositionTransition('PROPOSED', 'ACTIVE');
    assertPositionTransition('ACTIVE', 'PAUSED');
    assertPositionTransition('PAUSED', 'ACTIVE');
    assertPositionTransition('ACTIVE', 'RETIRED');
    assert.throws(() => assertPositionTransition('RETIRED', 'ACTIVE'), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
    assert.throws(() => assertPositionTransition('ACTIVE', 'PROPOSED'), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
    assert.throws(() => assertPositionTransition('__proto__' as never, 'ACTIVE'), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
  });

  test('C4-PROOF: a company-scoped executive budget hangs under the Company, never a fake Department', () => {
    assert.equal(parentScopeFor('EMPLOYEE', 'COMPANY'), 'COMPANY');
    assert.equal(parentScopeFor('EMPLOYEE', 'DEPARTMENT'), 'DEPARTMENT');
  });

  test('C4-PROOF: staffing requests carry the full Stage 10 evidence; incomplete alternatives are refused', () => {
    const r = parseStaffingRequest(staffing());
    assert.equal(r.positionKind, 'SPECIALIST');
    assert.throws(() => parseStaffingRequest(staffing({ alternatives: { redistributeWork: 'x', improveSkillOrTraining: 'y', automate: 'z' } })), (e) => isQandeelError(e, 'VALIDATION_FAILED') && e.details?.reason === 'STAFFING_EVIDENCE_INCOMPLETE');
    assert.throws(() => parseStaffingRequest(staffing({ positionKind: 'CEO' })), (e) => isQandeelError(e, 'VALIDATION_FAILED'), 'the CEO / Director seats are canonical, never requested');
    assert.throws(() => parseStaffingRequest(staffing({ extra: 1 })), (e) => isQandeelError(e, 'VALIDATION_FAILED'), 'unknown fields are refused, never ignored');
    assert.throws(() => parseStaffingRequest(Object.assign(Object.create({ roleRef: 'role:x' }) as object, {})), (e) => isQandeelError(e, 'VALIDATION_FAILED'), 'inherited fields are not read');
  });

  test('C4-PROOF: the CEO synthesizes (challenge / return / prioritize / consolidate / recommend) and never hires', () => {
    assert.equal(staffingReviewTarget('SUBMITTED', 'CHALLENGE'), 'CHALLENGED');
    assert.equal(staffingReviewTarget('CHALLENGED', 'RECOMMEND_APPROVE'), 'RECOMMENDED');
    assert.equal(staffingReviewTarget('SUBMITTED', 'CONSOLIDATE'), 'CONSOLIDATED');
    assert.throws(() => staffingReviewTarget('APPROVED', 'CHALLENGE'), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
    assert.throws(() => staffingReviewTarget('RETURNED_FOR_EVIDENCE', 'PRIORITIZE'), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
  });

  test('C4-PROOF: Title ≠ Authority — every non-reply organizational act needs an explicit grant', () => {
    const grant = (capability: string): GrantView => ({ id: 'g', capability, resourceScope: '*', riskCeiling: 'R1', dataClassCeiling: 'D1', expiresAt: null, maxUses: null, uses: 0, status: 'ACTIVE' });
    const at = T('2026-01-01T00:00:00.000Z');
    for (const a of ORG_ACTIONS) {
      const cap = orgActionCapability(a);
      if (a.startsWith('handoff.')) {
        assert.equal(cap, null, `${a} only answers one's own handoff`);
        continue;
      }
      assert.ok(cap !== null, `${a} needs a capability`);
      assert.equal(assertCapability(cap), cap);
      assert.deepEqual(decideOrgAct('ACTIVE', [], { capability: cap, resource: '*', at }), { effect: 'DENY', code: 'NO_GRANT' }, `${a} without a grant is denied, whatever the seat`);
      assert.equal(decideOrgAct('ACTIVE', [grant(cap)], { capability: cap, resource: '*', at }).effect, 'ALLOW');
      assert.equal(decideOrgAct('SUSPENDED', [grant(cap)], { capability: cap, resource: '*', at }).effect, 'DENY');
    }
    assert.equal(orgActionCapability('toString' as never), null, 'own-key lookup only');
  });

  test('C4-PROOF: delegation limits bind every dimension; unknown limit fields are refused', () => {
    const l = parseDelegationLimits({ maxCostMicros: 2_000_000, roleRefs: ['role:growth.seo-specialist'], positionKinds: ['SPECIALIST'], departmentCodes: ['growth'] });
    const s = { costMicros: 1_000_000, roleRef: 'role:growth.seo-specialist', positionKind: 'SPECIALIST', departmentCode: 'growth' };
    assert.deepEqual(limitsAllow(l, s), { ok: true });
    assert.deepEqual(limitsAllow(l, { ...s, costMicros: 3_000_000 }), { ok: false, reason: 'DELEGATION_COST_LIMIT' });
    assert.deepEqual(limitsAllow(l, { ...s, costMicros: null }), { ok: false, reason: 'DELEGATION_COST_LIMIT' }, 'an unpriced request never passes a cost limit');
    assert.deepEqual(limitsAllow(l, { ...s, roleRef: 'role:other' }), { ok: false, reason: 'DELEGATION_ROLE_LIMIT' });
    assert.deepEqual(limitsAllow(l, { ...s, positionKind: 'MANAGER' }), { ok: false, reason: 'DELEGATION_SEAT_LIMIT' });
    assert.deepEqual(limitsAllow(l, { ...s, departmentCode: 'product' }), { ok: false, reason: 'DELEGATION_DEPARTMENT_LIMIT' });
    assert.throws(() => parseDelegationLimits({ approveR4: true }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => parseDelegationLimits({ positionKinds: ['CEO'] }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
  });

  test('C4-PROOF: work delegation is bounded (depth, fan-out) and never cycles', () => {
    assert.doesNotThrow(() => assertDelegationBounds(MAX_DELEGATION_DEPTH, MAX_OPEN_DELEGATIONS_PER_PARENT - 1));
    assert.throws(() => assertDelegationBounds(MAX_DELEGATION_DEPTH + 1, 0), (e) => isQandeelError(e, 'ORG_NOT_ELIGIBLE') && e.details?.reason === 'DELEGATION_DEPTH_EXCEEDED');
    assert.throws(() => assertDelegationBounds(1, MAX_OPEN_DELEGATIONS_PER_PARENT), (e) => isQandeelError(e, 'ORG_NOT_ELIGIBLE') && e.details?.reason === 'DELEGATION_FANOUT_EXCEEDED');
    assert.equal(delegationCycle(['a', 'b'], 'a'), true, 'A → B → A is refused');
    assert.equal(delegationCycle(['a', 'b'], 'c'), false);
  });

  test('role references are role:<code>', () => {
    assert.equal(assertRoleRef('role:company.ceo'), 'role:company.ceo');
    assert.throws(() => assertRoleRef('position:x'), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
  });
});

describe('C4 kernel — review', () => {
  test('C4-PROOF: a Review Plan always has an independent SPECIALIST key; authority never stands in for review', () => {
    assert.equal(parseReviewPlan(plan()).keys.length, 1);
    assert.throws(() => parseReviewPlan(plan({ keys: [{ kind: 'MANAGER' }] })), (e) => isQandeelError(e, 'VALIDATION_FAILED') && e.details?.reason === 'SPECIALIST_KEY_REQUIRED');
    assert.throws(() => parseReviewPlan(plan({ keys: [{ kind: 'FOUNDER' }] })), (e) => isQandeelError(e, 'VALIDATION_FAILED'), 'the Founder approval never doubles as the review');
    assert.throws(() => parseReviewPlan(plan({ keys: [{ kind: 'SPECIALIST' }, { kind: 'MANAGER' }, { kind: 'MANAGER' }] })), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.equal(parseReviewPlan(plan({ keys: [{ kind: 'SPECIALIST' }, { kind: 'SPECIALIST' }, { kind: 'FOUNDER' }] })).keys.length, 3, 'two-key review plus a Founder key');
    assert.throws(() => parseReviewPlan(plan({ bypass: true })), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.equal(planAppliesTo('OUTPUT', 'ACTION'), false);
    assert.equal(planAppliesTo('BOTH', 'ACTION'), true);
  });

  test('C4-PROOF: one deterministic evaluation — disagreement is a conflict, uncertainty escalates, nothing is averaged', () => {
    assert.deepEqual(evaluateRequest(2, [{ keyIndex: 0, outcome: 'PASS' }]), { state: 'OPEN', reassign: [] });
    assert.deepEqual(evaluateRequest(2, [{ keyIndex: 0, outcome: 'PASS' }, { keyIndex: 1, outcome: 'PASS' }]), { state: 'SATISFIED', reassign: [] });
    assert.deepEqual(evaluateRequest(2, [{ keyIndex: 0, outcome: 'FAIL' }, { keyIndex: 1, outcome: 'FAIL' }]), { state: 'REWORK', reassign: [] });
    assert.deepEqual(evaluateRequest(2, [{ keyIndex: 0, outcome: 'PASS' }, { keyIndex: 1, outcome: 'FAIL' }]), { state: 'CONFLICT', reassign: [] });
    assert.equal(evaluateRequest(1, [{ keyIndex: 0, outcome: 'UNCERTAIN' }]).state, 'ESCALATED');
    assert.equal(evaluateRequest(1, [{ keyIndex: 0, outcome: 'INSUFFICIENT_EVIDENCE' }]).state, 'ESCALATED');
    assert.deepEqual(evaluateRequest(1, [{ keyIndex: 0, outcome: 'NEEDS_SPECIALIST' }]), { state: 'OPEN', reassign: [0] });
    // The latest decision of a key counts (a reassigned key's new reviewer supersedes NEEDS_SPECIALIST).
    assert.equal(evaluateRequest(1, [{ keyIndex: 0, outcome: 'NEEDS_SPECIALIST' }, { keyIndex: 0, outcome: 'PASS' }]).state, 'SATISFIED');
    assert.equal(evaluateRequest(1, [{ keyIndex: 5, outcome: 'PASS' }]).state, 'OPEN', 'a decision outside the plan\'s keys never counts');
  });

  test('C4-PROOF: independence — no self-review, no delegation-chain review, no one reviewer on two keys', () => {
    const c = { reviewerId: 'r', executorId: 'e', delegationChain: ['d'], otherKeyReviewers: ['k'], priorReviewers: [] as string[] };
    assert.equal(independenceViolation(c), null);
    assert.equal(independenceViolation({ ...c, reviewerId: 'e' }), 'SELF_REVIEW');
    assert.equal(independenceViolation({ ...c, reviewerId: 'd' }), 'DELEGATION_CHAIN');
    assert.equal(independenceViolation({ ...c, reviewerId: 'k' }), 'SAME_REVIEWER_TWO_KEYS');
  });

  test('C4-PROOF: reviewer trust is evidence (Gold cases + calibration), never seniority', () => {
    assert.deepEqual(promotionGaps({ goldPassed: 0, agreements: 0, disagreements: 0 }), ['GOLD_CASES_MISSING', 'CALIBRATION_EVIDENCE_MISSING']);
    assert.deepEqual(promotionGaps({ goldPassed: 1, agreements: 2, disagreements: 0 }), []);
    assert.deepEqual(promotionGaps({ goldPassed: 1, agreements: 2, disagreements: 2 }), ['CALIBRATION_AGREEMENT_LOW']);
    assert.equal(calibrationSignal('PASS', 'SATISFIED'), 'AGREE');
    assert.equal(calibrationSignal('PASS', 'REWORK'), 'DISAGREE');
    assert.equal(calibrationSignal('UNCERTAIN', 'REWORK'), 'NONE');
    assert.equal(reviewerRoleFor('growth.content'), 'role:reviewer.growth.content');
  });

  test('C4-PROOF: a review is bound to a versioned subject; R2 / R3 need review, R4 never executes', () => {
    const base = { workItemId: 'w', runRef: 'run:1', resultSha256: 'a'.repeat(64), objectiveSha256: 'b'.repeat(64), inputSha256: 'c'.repeat(64) };
    assert.equal(outputSubjectFingerprint(base), outputSubjectFingerprint({ ...base }));
    assert.notEqual(outputSubjectFingerprint(base), outputSubjectFingerprint({ ...base, runRef: 'run:2' }), 'a rework is a new subject');
    assert.equal(actionNeedsReview('R1'), false);
    assert.equal(actionNeedsReview('R2'), true);
    assert.equal(actionNeedsReview('R3'), true);
    assert.equal(actionNeedsReview('R4'), false);
  });

  test('C4-PROOF: model proposals for org acts and review decisions are parsed by own fields only', () => {
    assert.deepEqual(parseProposal('{"type":"ORG_ACTION","action":"work.delegate","args":{"x":1}}'), { type: 'ORG_ACTION', action: 'work.delegate', args: { x: 1 } });
    assert.equal(parseProposal('{"type":"ORG_ACTION","action":"founder.approve","args":{}}').type, 'INVALID');
    assert.equal(parseProposal('{"type":"ORG_ACTION","action":"work.delegate","args":{},"grant":"x"}').type, 'INVALID');
    assert.equal(parseProposal('{"type":"REVIEW_DECISION","outcome":"PASS","reasonCode":"meets.rubric"}').type, 'REVIEW_DECISION');
    assert.equal(parseProposal('{"type":"REVIEW_DECISION","outcome":"APPROVE","reasonCode":"x"}').type, 'INVALID', 'a reviewer never approves');
  });
});
