/**
 * C6-R1 operational-judgment kernel proofs (pure, deterministic): who judges a Work Item's C6 subjects, how a
 * satisfied review's keys verify an outcome (never averaged), and what a pool judge's review outcome means.
 * Verification authority is never execution authority: nothing here touches a grant, budget, approval or route.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError } from '@qandeel-company/domain';

import { judgmentFromReview, judgmentRoute, outcomeFromReviewKeys, parseProposal, parseReviewPlan, type OutcomeVerdict } from '../src/index.js';

const plan = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  domain: 'quality.general',
  appliesTo: 'OUTPUT',
  keys: [{ kind: 'SPECIALIST' }],
  rubric: { code: 'quality.rubric', version: 1 },
  reviewerInstructions: 'Judge the subject against the rubric; cite evidence.',
  reviewTaskClass: 'draft.memo',
  reviewBudget: { money: 20_000, tokens: 20_000 },
  ...over,
});
const keys = (...v: (OutcomeVerdict | null)[]) => v.map((verdict, keyIndex) => ({ keyIndex, verdict }));

describe('C6-R1 judgment kernel: delegated by review policy and risk, never by title', () => {
  test('a Review Plan names who judges: FOUNDER by default, REVIEW_POOL only explicitly, never beside a FOUNDER key', () => {
    assert.equal(parseReviewPlan(plan()).operationalJudgment, 'FOUNDER');
    assert.equal(parseReviewPlan(plan({ operationalJudgment: 'REVIEW_POOL' })).operationalJudgment, 'REVIEW_POOL');
    assert.throws(() => parseReviewPlan(plan({ operationalJudgment: 'MANAGER' })), (e: unknown) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(
      () => parseReviewPlan(plan({ operationalJudgment: 'REVIEW_POOL', keys: [{ kind: 'SPECIALIST' }, { kind: 'FOUNDER' }] })),
      (e: unknown) => isQandeelError(e, 'VALIDATION_FAILED') && e.details.reason === 'FOUNDER_KEY_RESERVES_JUDGMENT',
    );
    // A MANAGER key still sits beside the mandatory independent SPECIALIST key (C4): the pool may judge it.
    assert.equal(parseReviewPlan(plan({ operationalJudgment: 'REVIEW_POOL', keys: [{ kind: 'SPECIALIST' }, { kind: 'MANAGER' }] })).operationalJudgment, 'REVIEW_POOL');
  });

  test('the route: the pool judges only where the plan delegates it — never R4, never without a plan', () => {
    assert.deepEqual(judgmentRoute({ planJudgment: 'REVIEW_POOL', risk: 'R1' }), { judge: 'REVIEW_POOL', reason: 'PLAN_DELEGATES_JUDGMENT' });
    assert.equal(judgmentRoute({ planJudgment: 'REVIEW_POOL', risk: 'R3' }).judge, 'REVIEW_POOL', 'an R3 result is verified operationally; the R3 action itself still needs the Founder approval');
    assert.deepEqual(judgmentRoute({ planJudgment: 'REVIEW_POOL', risk: 'R4' }), { judge: 'FOUNDER', reason: 'R4_FOUNDER_ONLY' });
    assert.deepEqual(judgmentRoute({ planJudgment: 'FOUNDER', risk: 'R0' }), { judge: 'FOUNDER', reason: 'PLAN_RESERVES_FOUNDER' });
    assert.deepEqual(judgmentRoute({ planJudgment: null, risk: 'R0' }), { judge: 'FOUNDER', reason: 'NO_REVIEW_PLAN' });
  });

  test('the keys verify an outcome only when every key judged it — agreement verifies, disagreement is never averaged', () => {
    assert.deepEqual(outcomeFromReviewKeys(1, keys('ACHIEVED')), { verdict: 'ACHIEVED', reason: 'KEYS_AGREE' });
    assert.deepEqual(outcomeFromReviewKeys(2, keys('NOT_ACHIEVED', 'NOT_ACHIEVED')), { verdict: 'NOT_ACHIEVED', reason: 'KEYS_AGREE' });
    assert.deepEqual(outcomeFromReviewKeys(2, keys('ACHIEVED', 'NOT_ACHIEVED')), { verdict: 'INCONCLUSIVE', reason: 'OUTCOME_CONFLICT' });
    assert.deepEqual(outcomeFromReviewKeys(2, keys('ACHIEVED', 'INCONCLUSIVE')), { verdict: 'INCONCLUSIVE', reason: 'OUTCOME_INCONCLUSIVE' });
    // A key that gave no judgment, or a key that never decided: nothing is verified (insufficient evidence stays so).
    assert.deepEqual(outcomeFromReviewKeys(2, keys('ACHIEVED', null)), { verdict: null, reason: 'OUTCOME_JUDGMENT_MISSING' });
    assert.deepEqual(outcomeFromReviewKeys(2, keys('ACHIEVED')), { verdict: null, reason: 'OUTCOME_JUDGMENT_MISSING' });
    assert.deepEqual(outcomeFromReviewKeys(0, []), { verdict: null, reason: 'OUTCOME_JUDGMENT_MISSING' });
    // Out-of-range key indexes are not keys.
    assert.deepEqual(outcomeFromReviewKeys(1, [{ keyIndex: 5, verdict: 'ACHIEVED' }]), { verdict: null, reason: 'OUTCOME_JUDGMENT_MISSING' });
  });

  test('a pool judge validates on PASS, rejects on FAIL, and escalates every uncertainty to the Founder (never guessed)', () => {
    assert.equal(judgmentFromReview('PASS'), 'VALIDATE');
    assert.equal(judgmentFromReview('FAIL'), 'REJECT');
    for (const o of ['UNCERTAIN', 'INSUFFICIENT_EVIDENCE', 'ESCALATE', 'NEEDS_SPECIALIST'] as const) assert.equal(judgmentFromReview(o), 'ESCALATE');
  });

  test('a reviewer\'s outcome judgment is a typed, cited field of its review decision (both parts or none)', () => {
    const base = { type: 'REVIEW_DECISION', outcome: 'PASS', reasonCode: 'rubric.applied', evidenceRefs: ['evidence:rubric'] };
    const withJudgment = parseProposal(JSON.stringify({ ...base, outcomeVerdict: 'ACHIEVED', outcomeEvidence: ['REVIEW_DECISION', 'WORK_LINEAGE'] }));
    assert.equal(withJudgment.type, 'REVIEW_DECISION');
    assert.deepEqual(withJudgment.type === 'REVIEW_DECISION' ? withJudgment.outcomeJudgment : null, { verdict: 'ACHIEVED', evidenceClasses: ['REVIEW_DECISION', 'WORK_LINEAGE'] });
    const without = parseProposal(JSON.stringify(base));
    assert.equal(without.type === 'REVIEW_DECISION' ? without.outcomeJudgment : 'x', null);
    for (const bad of [{ outcomeVerdict: 'ACHIEVED' }, { outcomeEvidence: ['REVIEW_DECISION'] }, { outcomeVerdict: 'GREAT', outcomeEvidence: ['REVIEW_DECISION'] }, { outcomeVerdict: 'ACHIEVED', outcomeEvidence: [] }, { outcomeVerdict: 'ACHIEVED', outcomeEvidence: ['review decision'] }]) {
      assert.deepEqual(parseProposal(JSON.stringify({ ...base, ...bad })), { type: 'INVALID', code: 'MALFORMED' });
    }
  });
});
