/**
 * P1-REASON-AUTO-RECOVERY-01 — the AUTO Reasoning Demand policy (RD-1), measured against the agreed expectation set
 * (Arabic, Egyptian colloquial and English, with adversarial cases built to defeat a length-only or keyword-only rule),
 * its bounding by ceiling / route / provisioning, the per-class output allowance, and the parser's content-free MALFORMED
 * sub-reasons. A passing set measures the policy; it does not guarantee the right depth for every unforeseen task.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DEMAND_REASONS, MALFORMED_REASONS, OUTPUT_ALLOWANCE_BY_CLASS, assessReasoningDemand, continuationAllowance, isReasoningDemand, parseProposal, parseProposalDetailed, reasoningRank, resolveAutoClass, type ModelClass } from '../src/index.js';

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

describe('P1-REASON-AUTO-RECOVERY-01: AUTO is bounded and never misrepresented', () => {
  const all = ['E1', 'E2', 'E3', 'E4'] as const;
  test('the ideal is bounded by the ceiling, then the route policy, then what is provisioned — and the constraint is named', () => {
    assert.deepEqual(resolveAutoClass('E3', { ceiling: 'E4', policyMin: 'E1', policyMax: 'E4', available: all }), { selected: 'E3', ideal: 'E3', constraint: null });
    assert.deepEqual(resolveAutoClass('E4', { ceiling: 'E2', policyMin: 'E1', policyMax: 'E4', available: all }), { selected: 'E2', ideal: 'E4', constraint: 'EMPLOYEE_CEILING' });
    assert.deepEqual(resolveAutoClass('E4', { ceiling: 'E4', policyMin: 'E1', policyMax: 'E2', available: all }), { selected: 'E2', ideal: 'E4', constraint: 'ROUTE_POLICY' });
    assert.deepEqual(resolveAutoClass('E4', { ceiling: 'E4', policyMin: 'E1', policyMax: 'E4', available: ['E1', 'E2'] }), { selected: 'E2', ideal: 'E4', constraint: 'NOT_PROVISIONED' });
    assert.deepEqual(resolveAutoClass('E1', { ceiling: 'E4', policyMin: 'E2', policyMax: 'E4', available: all }), { selected: 'E2', ideal: 'E1', constraint: null }, 'the route minimum still lifts');
    for (const ideal of all) for (const ceiling of all) {
      const r = resolveAutoClass(ideal, { ceiling, policyMin: 'E1', policyMax: 'E4', available: all });
      assert.ok(reasoningRank(r.selected) <= reasoningRank(ceiling) && reasoningRank(r.selected) <= reasoningRank(ideal), `${ideal}/${ceiling}: never above the ceiling or the ideal`);
    }
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
