/**
 * C5 kernel proofs: the Founder command grammar (read vs mutating; never "execute"), the Goal lifecycle, the
 * MESSAGE / GOAL_ACTION proposal parsers and the Founder attention filter.
 * C5-PROOF: c5-kernel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Timestamp } from '@qandeel-company/domain';

import { GOAL_ACTIONS, assertCapability, assertGoalTransition, briefAttentionLevel, classifyFounderIntent, decideOrgAct, goalActCapability, goalTransitionNeedsFounder, isFounderBrief, isOrgCapability, parseProposal, warrantsFounderAttention, type FounderIntent, type GrantView } from '../src/index.js';

describe('AC-01 kernel (PO-R2-D): goal acts need their own explicit, Founder-delegable capability', () => {
  test('AC-01: org.goal.derive / org.goal.link are registered org capabilities, one per goal act, neither implying the other', () => {
    const at = '2026-01-01T00:00:00.000Z' as Timestamp;
    const grant = (capability: string): GrantView => ({ id: 'g', capability, resourceScope: '*', riskCeiling: 'R1', dataClassCeiling: 'D1', expiresAt: null, maxUses: null, uses: 0, status: 'ACTIVE' });
    assert.deepEqual(GOAL_ACTIONS.map((a) => goalActCapability(a)), ['org.goal.derive', 'org.goal.link']);
    for (const a of GOAL_ACTIONS) {
      const cap = goalActCapability(a) ?? '';
      assert.equal(assertCapability(cap), cap);
      assert.equal(isOrgCapability(cap), true, `${cap} is delegated only through the Founder org-delegation path`);
      assert.deepEqual(decideOrgAct('ACTIVE', [], { capability: cap, resource: '*', at }), { effect: 'DENY', code: 'NO_GRANT' });
      assert.equal(decideOrgAct('ACTIVE', [grant(cap)], { capability: cap, resource: '*', at }).effect, 'ALLOW');
    }
    assert.equal(decideOrgAct('ACTIVE', [grant('org.goal.derive')], { capability: 'org.goal.link', resource: '*', at }).effect, 'DENY', 'derive does not imply link');
    assert.equal(decideOrgAct('ACTIVE', [grant('org.goal.link')], { capability: 'org.goal.derive', resource: '*', at }).effect, 'DENY', 'link does not imply derive');
    assert.equal(goalActCapability('toString'), null, 'own-key lookup only');
    assert.equal(goalActCapability('goal.approve'), null);
    assert.throws(() => assertCapability('org.goal.approve'), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
  });
});

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

  test('R2-23: a goal-state command carries the target state of its own verb; the verb is never lost to argument stripping', () => {
    const stateOf = (text: string): [string | null, string | null, string | null] => {
      const r = classifyFounderIntent(text);
      return r.kind === 'MUTATING' ? [r.intent, (r as { goalState?: string | null }).goalState ?? null, r.argument] : [intentOf(r), null, null];
    };
    assert.deepEqual(stateOf('pause the growth engine goal'), ['GOAL_STATE', 'PAUSED', 'growth engine']);
    assert.deepEqual(stateOf('cancel the growth engine goal'), ['GOAL_STATE', 'CANCELLED', 'growth engine']);
    assert.deepEqual(stateOf('achieve goal growth engine'), ['GOAL_STATE', 'ACHIEVED', 'growth engine']);
    assert.deepEqual(stateOf('resume goal growth engine'), ['GOAL_STATE', 'ACTIVE', 'growth engine']);
    assert.deepEqual(stateOf('activate goal growth engine'), ['GOAL_STATE', 'ACTIVE', 'growth engine']);
    assert.deepEqual(stateOf('أوقف هدف growth engine'), ['GOAL_STATE', 'PAUSED', 'growth engine']);
    assert.deepEqual(stateOf('الغ هدف growth engine'), ['GOAL_STATE', 'CANCELLED', 'growth engine']);
    assert.deepEqual(stateOf('فعل هدف growth engine'), ['GOAL_STATE', 'ACTIVE', 'growth engine']);
    assert.notDeepEqual(stateOf('deactivate goal growth engine').slice(0, 2), ['GOAL_STATE', 'ACTIVE'], 'a verb inside another word is not that verb');
    const other = classifyFounderIntent('approve the campaign request');
    assert.ok(other.kind === 'MUTATING' && (other as { goalState?: string | null }).goalState === null, 'only a goal-state command carries a goal state');
  });

  test('R2-24: a named act routes to its own intent with an explicit decision; a noun in the argument never flips it into another act', () => {
    const r = (text: string): [string | null, string | null, string | null] => {
      const x = classifyFounderIntent(text);
      return x.kind === 'MUTATING' ? [x.intent, x.decision, x.argument] : [intentOf(x), null, null];
    };
    assert.deepEqual(r('approve goal Deny competitor entry'), ['GOAL_APPROVE', null, 'deny competitor entry'], 'a goal title is an argument, never a verb');
    assert.deepEqual(r('reject the staffing request analyst'), ['STAFFING_DECIDE', 'REJECT', 'staffing request analyst']);
    assert.deepEqual(r('approve staffing request analyst'), ['STAFFING_DECIDE', 'APPROVE', 'staffing request analyst']);
    assert.equal(r('staffing analyst')[1], null, 'no decision stated: none is assumed');
    assert.deepEqual(r('resolve the conflict with rework').slice(0, 2), ['CONFLICT_RESOLVE', 'REJECT']);
    assert.deepEqual(r('resolve the conflict as pass').slice(0, 2), ['CONFLICT_RESOLVE', 'APPROVE']);
    assert.equal(r('resolve the conflict')[1], null, 'no silent default decision');
    assert.deepEqual(r('ارفض الطلب').slice(0, 2), ['APPROVAL_DECIDE', 'REJECT']);
  });

  test("RR1-1 (R2-23/R2-24): the command's own leading verb decides the intent; a verb or noun inside a title never selects or changes it", () => {
    const r = (text: string): [string | null, string | null, string | null, string | null] => {
      const x = classifyFounderIntent(text);
      return x.kind === 'MUTATING' ? [x.intent, x.decision, x.goalState, x.argument] : [intentOf(x), null, null, x.kind === 'READ' ? x.argument : null];
    };
    // A goal-state verb leads: the title's approve / accept / reject / deny / budget / hiring / conflict words change nothing.
    assert.deepEqual(r('cancel the accept vendor returns goal'), ['GOAL_STATE', null, 'CANCELLED', 'accept vendor returns']);
    assert.deepEqual(r('الغ هدف accept vendor returns'), ['GOAL_STATE', null, 'CANCELLED', 'accept vendor returns']);
    assert.deepEqual(r('pause goal Approve budget of EGP 5000'), ['GOAL_STATE', null, 'PAUSED', 'approve budget of egp 5000']);
    assert.deepEqual(r('pause the reject staffing freeze goal'), ['GOAL_STATE', null, 'PAUSED', 'reject staffing freeze']);
    assert.deepEqual(r('achieve goal Resolve every conflict'), ['GOAL_STATE', null, 'ACHIEVED', 'resolve every conflict']);
    assert.deepEqual(r('please cancel the Deny competitor entry goal'), ['GOAL_STATE', null, 'CANCELLED', 'deny competitor entry']);
    assert.deepEqual(r('اوقف هدف وافق على الموردين'), ['GOAL_STATE', null, 'PAUSED', 'وافق علي الموردين']);
    assert.deepEqual(r('أوقف هدف ارفض العروض'), ['GOAL_STATE', null, 'PAUSED', 'ارفض العروض']);
    assert.deepEqual(r('الغ هدف اعتمد ميزانية التوظيف'), ['GOAL_STATE', null, 'CANCELLED', 'اعتمد ميزانيه التوظيف']);
    assert.deepEqual(r('من فضلك الغ هدف قبول المرتجعات'), ['GOAL_STATE', null, 'CANCELLED', 'قبول المرتجعات']);
    // An approve verb leads: a goal-state / reject / budget / hiring word in the title never changes the act or the decision.
    assert.deepEqual(r('approve the cancel legacy plan goal'), ['GOAL_APPROVE', null, null, 'cancel legacy plan']);
    assert.deepEqual(r('approve goal Reject low bids'), ['GOAL_APPROVE', null, null, 'reject low bids']);
    assert.deepEqual(r('approve the budget review goal'), ['GOAL_APPROVE', null, null, 'budget review']);
    assert.deepEqual(r('approve the hiring freeze goal'), ['GOAL_APPROVE', null, null, 'hiring freeze']);
    assert.deepEqual(r('اعتمد هدف الغ الرسوم'), ['GOAL_APPROVE', null, null, 'الغ الرسوم']);
    assert.deepEqual(r('اعتمد هدف ارفض العروض الضعيفه'), ['GOAL_APPROVE', null, null, 'ارفض العروض الضعيفه']);
    // A reject verb leads: the decision is REJECT whatever the argument says.
    assert.deepEqual(r('reject the approve vendor request').slice(0, 2), ['APPROVAL_DECIDE', 'REJECT']);
    assert.deepEqual(r('ارفض طلب وافق على المورد').slice(0, 2), ['APPROVAL_DECIDE', 'REJECT']);
    // A read verb leads: a mutating word in its argument never makes it an act.
    assert.equal(intentOf(classifyFounderIntent('open the pause hiring goal')), 'SHOW_GOAL');
    assert.equal(intentOf(classifyFounderIntent('show goal Approve vendors')), 'SHOW_GOAL');
    assert.equal(intentOf(classifyFounderIntent('who is working on reject low bids')), 'WHO_WORKS_ON');
    assert.equal(intentOf(classifyFounderIntent('اعرض هدف الغ الرسوم')), 'SHOW_GOAL');
    // No leading verb: never an act guessed from a verb further in.
    assert.equal(classifyFounderIntent('the accept vendor returns goal').kind, 'UNKNOWN');
    assert.equal(classifyFounderIntent('vendor returns: approve').kind, 'UNKNOWN');
    // The governed forms keep working (vocative, polite lead, budget clause with an amount).
    assert.deepEqual(r('Ehab, run the Saudi campaign with a maximum budget of EGP 50,000').slice(0, 1), ['BUDGET_CEILING']);
    assert.deepEqual(r('approve Ehab Tarek campaign with a budget of EGP 50,000').slice(0, 1), ['BUDGET_CEILING']);
    assert.deepEqual(r('please approve the campaign request').slice(0, 2), ['APPROVAL_DECIDE', 'APPROVE']);
    assert.equal(classifyFounderIntent('run the pause hiring goal').kind, 'UNKNOWN', 'a run verb without a budget clause is no act');
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
