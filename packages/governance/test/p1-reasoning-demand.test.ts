/**
 * P1-REASON-AUTO-RECOVERY-01 — the AUTO Reasoning Demand policy (RD-1), measured against the agreed expectation set
 * (Arabic, Egyptian colloquial and English, with adversarial cases built to defeat a length-only or keyword-only rule),
 * its bounding by ceiling / route / provisioning, the per-class output allowance, and the parser's content-free MALFORMED
 * sub-reasons. A passing set measures the policy; it does not guarantee the right depth for every unforeseen task.
 * P1-AUTO-E12-01 (D-P1-11): RD-1 states the RAW demand (E1..E4, evidence); AUTO EXECUTES at most at E2 (`AUTO_MAX_CLASS`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AUTO_MAX_CLASS, DEMAND_REASONS, MALFORMED_REASONS, OUTPUT_ALLOWANCE_BY_CLASS, assessReasoningDemand, continuationAllowance, isReasoningDemand, isRunFailureCode, parseProposal, parseProposalDetailed, planEscalation, reasoningRank, resolveAutoClass, unavailableRunCode, withinAutoCap, type ModelClass, type RoutePolicy } from '../src/index.js';

interface Case { readonly id: string; readonly text: string; readonly expect: ModelClass; readonly allow?: readonly ModelClass[]; readonly executive?: boolean; readonly kind: string }
const fixture = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures', 'reasoning-demand-cases.json'), 'utf8')) as { policy: string; cases: Case[] };
const demandOf = (c: Case) => assessReasoningDemand({ text: c.text, purpose: 'QUESTION', attentionLevel: 'INFORMATIONAL', executive: c.executive === true });

describe('P1-REASON-AUTO-RECOVERY-01: the Reasoning Demand policy RD-1 against the expectation set', () => {
  test('choice correctness: at least 90% exactly as expected and every case inside its agreed band', () => {
    assert.equal(fixture.policy, 'RD-1');
    assert.ok(fixture.cases.length >= 30, 'a substantial expectation set');
    const misses = fixture.cases.filter((c) => !(c.allow ?? [c.expect]).includes(demandOf(c).level)).map((c) => `${c.id}: ${demandOf(c).level} (want ${c.expect})`);
    assert.deepEqual(misses, [], 'every case inside its band');
    const exact = fixture.cases.filter((c) => demandOf(c).level === c.expect).length;
    assert.ok(exact / fixture.cases.length >= 0.9, `exact ${exact}/${fixture.cases.length}`);
  });

  test('hard invariants: routine and adversarial-length work never reaches E3; short strategic and high-consequence work never runs at E1; nothing reaches E4 on uncertainty alone', () => {
    for (const c of fixture.cases) {
      const d = demandOf(c);
      if (['routine', 'adversarial-length', 'adversarial-keyword', 'informational', 'simple'].includes(c.kind)) assert.ok(reasoningRank(d.level) <= reasoningRank('E2'), `${c.id} stays economical (${d.level})`);
      if (['short-strategic', 'short-high-consequence', 'organization', 'very-high', 'high', 'ambiguous-consequential'].includes(c.kind)) assert.ok(reasoningRank(d.level) >= reasoningRank('E2'), `${c.id} is never answered at E1 (${d.level})`);
      if (d.level === 'E4') assert.equal(d.confidence, 'CLEAR', `${c.id}: E4 only on clear evidence`);
    }
  });

  test('a short strategic request is not E1 because it is short, and a long routine one is not E4 because it is long', () => {
    const short = assessReasoningDemand({ text: 'ندخل السوق السعودي الأول ولا مصر؟', executive: true });
    assert.ok(reasoningRank(short.level) >= reasoningRank('E3'), short.level);
    const long = assessReasoningDemand({ text: `${'I updated the shared folders and the meeting notes. '.repeat(40)}Thanks.` });
    assert.equal(long.level, 'E1');
    const pasted = assessReasoningDemand({ text: `Please translate this: ${'Our strategy is to launch across the Gulf, compare pricing options, invest in hiring and sign the partnership contract. '.repeat(10)}` });
    assert.ok(reasoningRank(pasted.level) <= reasoningRank('E2'), `a translation is bounded however much strategy it carries (${pasted.level})`);
  });

  test('uncertainty policy: unclear complexity with high stakes is lifted to E3 (never E4); unclear low-stakes work stays economical', () => {
    const stakes = assessReasoningDemand({ text: 'What do you think about the contract?', executive: true });
    assert.deepEqual([stakes.level, stakes.confidence, stakes.reasons.includes('UNCERTAIN_HIGH_CONSEQUENCE')], ['E3', 'UNCERTAIN', true]);
    const unclear = assessReasoningDemand({ text: 'Can you do the thing we discussed?' });
    assert.equal(unclear.level, 'E1', 'low confidence alone does not mean E2');
  });

  test('deterministic, content-free and closed: the same input gives the same demand; reasons are closed codes; the stored shape validates', () => {
    for (const c of fixture.cases) {
      const a = demandOf(c);
      assert.deepEqual(demandOf(c), a);
      assert.ok(isReasoningDemand(JSON.parse(JSON.stringify(a))), c.id);
      assert.ok(a.reasons.every((r) => (DEMAND_REASONS as readonly string[]).includes(r)));
      assert.equal(JSON.stringify(a).includes(c.text.slice(0, 12)) && c.text.length > 0, false, 'the demand never carries the text');
    }
    assert.equal(isReasoningDemand({ policy: 'RD-1', level: 'E5', complexity: 'LOW', consequence: 'LOW', confidence: 'CLEAR', reasons: [] }), false);
    assert.equal(isReasoningDemand({ policy: 'RD-1', level: 'E1', complexity: 'LOW', consequence: 'LOW', confidence: 'CLEAR', reasons: ['FREE TEXT'] }), false);
  });
});

describe('P1-REASON-AUTO-RECOVERY-01 / P1-AUTO-E12-01: AUTO is bounded and never misrepresented', () => {
  const all = ['E1', 'E2', 'E3', 'E4'] as const;
  test('the ideal is bounded by the AUTO maximum (E2), the ceiling, the route policy and what is provisioned — and the binding constraint is named', () => {
    assert.equal(AUTO_MAX_CLASS, 'E2');
    // D-P1-11: the raw demand E3 / E4 stays the ideal (evidence); AUTO executes at E2 and says why.
    assert.deepEqual(resolveAutoClass('E3', { ceiling: 'E4', policyMin: 'E1', policyMax: 'E4', available: all }), { selected: 'E2', ideal: 'E3', constraint: 'AUTO_POLICY_CAP' });
    assert.deepEqual(resolveAutoClass('E4', { ceiling: 'E4', policyMin: 'E1', policyMax: 'E4', available: all }), { selected: 'E2', ideal: 'E4', constraint: 'AUTO_POLICY_CAP' });
    assert.deepEqual(resolveAutoClass('E4', { ceiling: 'E4', policyMin: 'E1', policyMax: 'E4', available: ['E1', 'E2'] }), { selected: 'E2', ideal: 'E4', constraint: 'AUTO_POLICY_CAP' });
    // At a tie the Employee's or the route's own bound is named (the AUTO maximum alone would not lift it).
    assert.deepEqual(resolveAutoClass('E4', { ceiling: 'E2', policyMin: 'E1', policyMax: 'E4', available: all }), { selected: 'E2', ideal: 'E4', constraint: 'EMPLOYEE_CEILING' });
    assert.deepEqual(resolveAutoClass('E4', { ceiling: 'E4', policyMin: 'E1', policyMax: 'E2', available: all }), { selected: 'E2', ideal: 'E4', constraint: 'ROUTE_POLICY' });
    assert.deepEqual(resolveAutoClass('E3', { ceiling: 'E1', policyMin: 'E1', policyMax: 'E4', available: all }), { selected: 'E1', ideal: 'E3', constraint: 'EMPLOYEE_CEILING' });
    assert.deepEqual(resolveAutoClass('E2', { ceiling: 'E4', policyMin: 'E1', policyMax: 'E4', available: ['E1', 'E3', 'E4'] }), { selected: 'E1', ideal: 'E2', constraint: 'NOT_PROVISIONED' }, 'an unprovisioned E2 falls to E1, never up to E3');
    assert.deepEqual(resolveAutoClass('E2', { ceiling: 'E4', policyMin: 'E1', policyMax: 'E4', available: all }), { selected: 'E2', ideal: 'E2', constraint: null });
    assert.deepEqual(resolveAutoClass('E1', { ceiling: 'E4', policyMin: 'E2', policyMax: 'E4', available: all }), { selected: 'E2', ideal: 'E1', constraint: null }, 'the route minimum still lifts, up to the AUTO maximum');
    assert.deepEqual(resolveAutoClass('E1', { ceiling: 'E4', policyMin: 'E3', policyMax: 'E4', available: all }), { selected: null, ideal: 'E1', constraint: 'AUTO_POLICY_CAP' }, 'a route minimum above E2 gives no AUTO class: never lifted to E3');
    for (const ideal of all) for (const ceiling of all) for (const policyMin of all) for (const policyMax of all.filter((m) => reasoningRank(m) >= reasoningRank(policyMin))) {
      const r = resolveAutoClass(ideal, { ceiling, policyMin, policyMax, available: all });
      if (r.selected === null) {
        assert.ok(!withinAutoCap(policyMin), `${ideal}/${ceiling}/${policyMin}: refused only when the route minimum is above E2`);
        continue;
      }
      assert.ok(withinAutoCap(r.selected), `${ideal}/${ceiling}/${policyMin}-${policyMax}: never above E2 (${r.selected})`);
      if (policyMin === 'E1') assert.ok(reasoningRank(r.selected) <= reasoningRank(ceiling) && reasoningRank(r.selected) <= reasoningRank(ideal), `${ideal}/${ceiling}: never above the ceiling or the ideal`);
    }
  });

  test('raw demand evidence vs capped execution: RD-1 still tells E3 / E4 work apart, and every AUTO execution of the expectation set runs at E1 or E2', () => {
    const levels = fixture.cases.map((c) => [c, demandOf(c).level] as const);
    assert.ok(levels.some(([, l]) => l === 'E3') && levels.some(([, l]) => l === 'E4'), 'the demand evidence still names deep and extended work');
    for (const [c, level] of levels) {
      const r = resolveAutoClass(level, { ceiling: 'E4', policyMin: 'E1', policyMax: 'E4', available: all });
      const capped = reasoningRank(level) > reasoningRank(AUTO_MAX_CLASS);
      assert.deepEqual(r, { selected: capped ? 'E2' : level, ideal: level, constraint: capped ? 'AUTO_POLICY_CAP' : null }, `${c.id}: raw ${level}`);
    }
  });

  test('AUTO is never escalated above E2 (planEscalation): E1 → E2 on observable evidence, E2 → E3 refused as AUTO_POLICY_CAP; a non-AUTO step is unchanged', () => {
    const policy: RoutePolicy = { id: 'p', taskClass: 'founder.reply', version: 1, minClass: 'E1', maxClass: 'E4', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 6, fallbackCostCeilingMicros: null, escalation: { maxDepth: 2, maxOverheadMicros: 1_000_000 } };
    assert.deepEqual(planEscalation('E1', 'OUTPUT_FAILED_VALIDATION', 0, policy, 'E4', AUTO_MAX_CLASS), { ok: true, toClass: 'E2' });
    for (const from of ['E2', 'E3', 'E4'] as const) for (const evidence of ['OUTPUT_FAILED_VALIDATION', 'CONTEXT_OVERFLOW'] as const) {
      const plan = planEscalation(from, evidence, 0, policy, 'E4', AUTO_MAX_CLASS);
      assert.ok(!plan.ok && (plan.code === 'AUTO_POLICY_CAP' || (from === 'E4' && plan.code === 'CEILING_REACHED')), `${from}/${evidence}: ${JSON.stringify(plan)}`);
    }
    assert.deepEqual(planEscalation('E2', 'OUTPUT_FAILED_VALIDATION', 0, policy, 'E4'), { ok: true, toClass: 'E3' }, 'a DEFAULT step keeps its bounded escalation');
    assert.deepEqual(planEscalation('E1', 'SELF_REPORTED_UNCERTAINTY', 0, policy, 'E4', AUTO_MAX_CLASS), { ok: false, code: 'EVIDENCE_NOT_OBSERVABLE' });
    assert.equal(unavailableRunCode('AUTO_POLICY_CAP'), 'AUTO_LEVEL_LIMIT');
    assert.ok(isRunFailureCode('AUTO_LEVEL_LIMIT'));
  });

  test('B1 allowances: a deeper class has more room for thinking, each within its deployment maximum; one continuation doubles within the bounds, else none', () => {
    assert.deepEqual(OUTPUT_ALLOWANCE_BY_CLASS, { E1: 2048, E2: 4096, E3: 8192, E4: 16384 });
    const limits = { E1: 4096, E2: 16384, E3: 32768, E4: 65536 };
    for (const c of all) assert.ok(OUTPUT_ALLOWANCE_BY_CLASS[c] <= limits[c]);
    assert.equal(continuationAllowance(4096, 16384), 8192);
    assert.equal(continuationAllowance(16384, 65536), 32768, 'the continuation ceiling binds');
    assert.equal(continuationAllowance(4096, 4096), null, 'no larger allowance: no continuation');
  });
});

describe('P1-REASON-AUTO-RECOVERY-01: the parser names the MALFORMED rule (content-free), its proposal unchanged', () => {
  const m = (o: Record<string, unknown>): string => JSON.stringify({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'ok', brief: null, contextRefs: [], ...o });
  test('each MESSAGE rule has its own sub-reason; a valid output has none; parseProposal returns exactly the same proposal', () => {
    const cases: [string, string | null][] = [
      [m({}), null],
      [m({ extra: 1 }), 'FIELD_SET'],
      [m({ purpose: 'CHAT' }), 'PURPOSE_INVALID'],
      [m({ attentionLevel: 'LOUD' }), 'ATTENTION_INVALID'],
      [m({ body: '  ' }), 'BODY_EMPTY'],
      [m({ body: 'x'.repeat(4001) }), 'BODY_TOO_LONG'],
      [m({ purpose: 'BRIEF' }), 'BRIEF_MISMATCH'],
      [m({ contextRefs: ['not a ref'] }), 'REFS_INVALID'],
      ['[1,2]', 'NOT_OBJECT'],
      ['{"type":"FINAL","summaryCode":"Not A Code"}', 'CODE_FORMAT'],
    ];
    for (const [text, reason] of cases) {
      const d = parseProposalDetailed(text);
      assert.equal(d.reason, reason, text.slice(0, 60));
      assert.deepEqual(d.proposal, parseProposal(text));
      if (reason !== null) assert.ok((MALFORMED_REASONS as readonly string[]).includes(reason));
    }
    assert.deepEqual(parseProposalDetailed('{"type":"MESSAGE","purpose":"RES'), { proposal: { type: 'INVALID', code: 'NOT_JSON' }, reason: null }, 'an incomplete JSON is NOT_JSON, never a proposal');
  });
});
