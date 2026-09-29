/**
 * C5 kernel proofs: the Founder command grammar (read vs mutating; never "execute"), the Goal lifecycle, the
 * MESSAGE / GOAL_ACTION proposal parsers and the Founder attention filter.
 * C5-PROOF: c5-kernel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError } from '@qandeel-company/domain';

import { assertGoalTransition, briefAttentionLevel, classifyFounderIntent, goalTransitionNeedsFounder, isFounderBrief, parseProposal, warrantsFounderAttention, type FounderIntent } from '../src/index.js';

/** The value a proof relies on, present by construction of the fixture. */
function must<T>(v: T | null | undefined, what = 'value'): T {
  if (v === null || v === undefined) throw new Error(`${what} is missing`);
  return v;
}

const intentOf = (r: FounderIntent): string | null => (r.kind === 'UNKNOWN' ? null : r.intent);

describe('C5 kernel — Founder command intents', () => {
  test('C5-PROOF: read intents change attention only (Arabic and English), with their argument', () => {
    assert.deepEqual(classifyFounderIntent('افتح ليلى مراد'), { kind: 'READ', intent: 'OPEN_EMPLOYEE', argument: 'ليلي مراد' });
    assert.deepEqual(classifyFounderIntent('Open Ehab Tarek'), { kind: 'READ', intent: 'OPEN_EMPLOYEE', argument: 'ehab tarek' });
    assert.equal(intentOf(classifyFounderIntent('اعرض قسم النمو')), 'SHOW_DEPARTMENT');
    assert.equal(intentOf(classifyFounderIntent('Show Engineering')), 'SHOW_DEPARTMENT');
    assert.deepEqual(classifyFounderIntent('من يعمل على إطلاق السعودية؟'), { kind: 'READ', intent: 'WHO_WORKS_ON', argument: 'اطلاق السعوديه' });
    assert.equal(intentOf(classifyFounderIntent('Who is working on Saudi Launch')), 'WHO_WORKS_ON');
    assert.equal(intentOf(classifyFounderIntent('ما المتوقف الآن؟')), 'WHAT_IS_BLOCKED');
    assert.equal(intentOf(classifyFounderIntent("What's blocked right now?")), 'WHAT_IS_BLOCKED');
    assert.equal(intentOf(classifyFounderIntent('ما الذي يحتاج موافقتي؟')), 'NEEDS_MY_APPROVAL');
    assert.equal(intentOf(classifyFounderIntent('What needs my approval?')), 'NEEDS_MY_APPROVAL');
    assert.equal(intentOf(classifyFounderIntent('Show CEO briefs')), 'SHOW_BRIEFS');
    assert.equal(intentOf(classifyFounderIntent('عودة إلى المباشر')), 'RETURN_TO_LIVE');
    assert.equal(intentOf(classifyFounderIntent('Return to Live')), 'RETURN_TO_LIVE');
  });

  test('C5-PROOF: mutating intents are classified, never executed, and carry a parsed amount / decision', () => {
    const budget = classifyFounderIntent('Ehab, run the Saudi campaign with a maximum budget of EGP 50,000');
    assert.equal(budget.kind, 'MUTATING');
    if (budget.kind !== 'MUTATING') return;
    assert.equal(budget.intent, 'BUDGET_CEILING');
    assert.deepEqual(budget.amount, { currency: 'EGP', value: 50_000 });
    const arabic = classifyFounderIntent('وافق على حملة إيهاب بميزانية ٥٠ ألف جنيه');
    assert.equal(arabic.kind, 'MUTATING');
    if (arabic.kind === 'MUTATING') assert.deepEqual(arabic.amount, { currency: 'EGP', value: 50_000 });
    const approve = classifyFounderIntent('approve the campaign request');
    assert.equal(approve.kind, 'MUTATING');
    if (approve.kind === 'MUTATING') assert.deepEqual([approve.intent, approve.decision], ['APPROVAL_DECIDE', 'APPROVE']);
    const reject = classifyFounderIntent('ارفض الطلب');
    if (reject.kind === 'MUTATING') assert.deepEqual([reject.intent, reject.decision], ['APPROVAL_DECIDE', 'REJECT']);
    const goal = classifyFounderIntent('اعتمد هدف إطلاق السعودية');
    if (goal.kind === 'MUTATING') assert.equal(goal.intent, 'GOAL_APPROVE');
    // Nothing in the result is an execution instruction: the closed union has no "execute" member.
    for (const r of [budget, approve, reject, goal]) assert.ok(r.kind === 'READ' || r.kind === 'MUTATING' || r.kind === 'UNKNOWN');
  });

  test('C5-PROOF: unknown / empty / oversized input is UNKNOWN, never a guessed act', () => {
    assert.deepEqual(classifyFounderIntent(''), { kind: 'UNKNOWN' });
    assert.deepEqual(classifyFounderIntent('   '), { kind: 'UNKNOWN' });
    assert.deepEqual(classifyFounderIntent('open'), { kind: 'UNKNOWN' });
    assert.deepEqual(classifyFounderIntent('x'.repeat(10_000)), { kind: 'UNKNOWN' });
    assert.deepEqual(classifyFounderIntent(42 as unknown as string), { kind: 'UNKNOWN' });
  });
});

describe('C5 kernel — Goals', () => {
  test('C5-PROOF: the lifecycle is explicit and forward; company goals need the Founder to go live', () => {
    assertGoalTransition('DRAFT', 'PROPOSED');
    assertGoalTransition('PROPOSED', 'APPROVED');
    assertGoalTransition('APPROVED', 'ACTIVE');
    assertGoalTransition('ACTIVE', 'PAUSED');
    assertGoalTransition('PAUSED', 'ACTIVE');
    assertGoalTransition('ACTIVE', 'ACHIEVED');
    for (const [from, to] of [['ACHIEVED', 'ACTIVE'], ['CANCELLED', 'DRAFT'], ['DRAFT', 'ACTIVE'], ['PROPOSED', 'ACHIEVED'], ['SUPERSEDED', 'ACTIVE']] as const) {
      assert.throws(() => assertGoalTransition(from, to), (e: unknown) => isQandeelError(e) && e.code === 'GOAL_INVALID', `${from} → ${to}`);
    }
    assert.equal(goalTransitionNeedsFounder('COMPANY', 'APPROVED'), true);
    assert.equal(goalTransitionNeedsFounder('COMPANY', 'ACTIVE'), true);
    assert.equal(goalTransitionNeedsFounder('COMPANY', 'PAUSED'), false);
    assert.equal(goalTransitionNeedsFounder('DEPARTMENT', 'APPROVED'), false);
  });
});

describe('C5 kernel — proposals and attention', () => {
  test('C5-PROOF: a MESSAGE proposal parses only in the Founder Communication Standard shape; a BRIEF needs its four answers', () => {
    const ok = parseProposal(JSON.stringify({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'الإطلاق على المسار.', brief: null, contextRefs: ['goal:abc'] }));
    assert.equal(ok.type, 'MESSAGE');
    const brief = parseProposal(JSON.stringify({ type: 'MESSAGE', purpose: 'BRIEF', attentionLevel: 'NEEDS_DECISION', body: 'موجز', brief: { happening: 'x', matters: 'y', recommendation: 'z', decisionNeeded: true, decision: 'اعتماد السقف' }, contextRefs: [] }));
    assert.equal(brief.type, 'MESSAGE');
    if (brief.type === 'MESSAGE') assert.equal(briefAttentionLevel(must(brief.brief)), 'NEEDS_DECISION');
    // Malformed: a BRIEF without its structure, a non-BRIEF with one, an oversize body, an unknown key, an
    // authority-shaped key (nothing a model writes can name a grant or an approval).
    for (const bad of [
      { type: 'MESSAGE', purpose: 'BRIEF', attentionLevel: 'NEEDS_DECISION', body: 'x', brief: null, contextRefs: [] },
      { type: 'MESSAGE', purpose: 'FYI', attentionLevel: 'INFORMATIONAL', body: 'x', brief: { happening: 'a', matters: 'b', recommendation: 'c', decisionNeeded: false }, contextRefs: [] },
      { type: 'MESSAGE', purpose: 'FYI', attentionLevel: 'INFORMATIONAL', body: 'x'.repeat(4_001), brief: null, contextRefs: [] },
      { type: 'MESSAGE', purpose: 'FYI', attentionLevel: 'INFORMATIONAL', body: 'x', brief: null, contextRefs: [], approve: true },
      { type: 'MESSAGE', purpose: 'FYI', attentionLevel: 'INFORMATIONAL', body: 'x', brief: null, contextRefs: [], grant: 'org.staffing.decide' },
      { type: 'MESSAGE', purpose: 'BRIEF', attentionLevel: 'NEEDS_DECISION', body: 'x', brief: { happening: 'a', matters: 'b', recommendation: 'c', decisionNeeded: true }, contextRefs: [] },
    ]) assert.equal(parseProposal(JSON.stringify(bad)).type, 'INVALID', JSON.stringify(bad).slice(0, 80));
    assert.equal(isFounderBrief({ happening: 'a', matters: 'b', recommendation: 'c', decisionNeeded: false, decision: 'd' }), false, 'no decision text without a decision');
  });

  test('C5-PROOF: a GOAL_ACTION proposal is a closed set (derive / link) with object args', () => {
    assert.equal(parseProposal(JSON.stringify({ type: 'GOAL_ACTION', action: 'goal.derive', args: { title: 'x' } })).type, 'GOAL_ACTION');
    assert.equal(parseProposal(JSON.stringify({ type: 'GOAL_ACTION', action: 'goal.approve', args: {} })).type, 'INVALID');
    assert.equal(parseProposal(JSON.stringify({ type: 'GOAL_ACTION', action: 'goal.link', args: [] })).type, 'INVALID');
  });

  test('C5-PROOF: routine traffic never enters Founder Attention; decisions, escalations, blockers and briefs do', () => {
    assert.equal(warrantsFounderAttention('FYI', 'INFORMATIONAL'), false);
    assert.equal(warrantsFounderAttention('RESULT', 'INFORMATIONAL'), false);
    assert.equal(warrantsFounderAttention('RESULT', 'NEEDS_ATTENTION'), false);
    assert.equal(warrantsFounderAttention('DECISION_REQUEST', 'INFORMATIONAL'), true);
    assert.equal(warrantsFounderAttention('ESCALATION', 'INFORMATIONAL'), true);
    assert.equal(warrantsFounderAttention('BLOCKER', 'INFORMATIONAL'), true);
    assert.equal(warrantsFounderAttention('BRIEF', 'INFORMATIONAL'), true);
    assert.equal(warrantsFounderAttention('FYI', 'URGENT'), true);
  });
});
