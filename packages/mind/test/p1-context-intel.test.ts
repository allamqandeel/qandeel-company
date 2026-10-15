/**
 * P1-CONTEXT-INTEL-01 (D-P1-14) and G4-SIMPLE-01 (D-P1-16) — G4 Context & Skill Intelligence, the pure kernel (no I/O,
 * synthetic text only):
 *   - C3: `terms()` (TI-0) is byte-identical to the previous release; TI-1 salience terms and the union query are
 *     deterministic, bounded, and never produce a term the previous release could confuse with a `~` index row;
 *   - CP-1 (Founder decision G3): the step order, share isolation, protected TASK_REQUIRED Skills and history, the
 *     knowledge / memory anchors before SUPPORTING Skills, canonical overflow first in the spill, every rule unchanged,
 *     and every critical item classified;
 *   - G4-SIMPLE-01: the CEO's six certified Skills (their real v7 sizes), all SUPPORTING, fit their share at 60K on an empty
 *     and on a full store, and never take the knowledge, memory or canonical space.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Timestamp } from '@qandeel-company/domain';

import {
  CEO_ACADEMY_PACKAGE_V7,
  DEFAULT_CONTEXT_POLICY,
  SKILL_TIERS,
  normalizeText,
  planContext,
  queryTerms,
  salienceTerms,
  terms,
  type ContextCandidate,
  type ContextPlan,
} from '../src/index.js';

const NOW = '2026-10-13T06:00:00.000Z' as Timestamp;

interface DevCase { readonly id: string; readonly lang: string; readonly kind: string; readonly text: string; readonly required: readonly string[] }
// Synthetic EN / MSA / EG texts (samples for the C3 term functions only; never a classification set).
const dev = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'governance', 'test', 'fixtures', 'task-signals-dev-set.json'), 'utf8')) as { cases: DevCase[] };

/** The previous release's `terms()`, frozen verbatim (TI-0). */
const STOP0 = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'not', 'but', 'you', 'your', 'our', 'its', 'into', 'about', 'what', 'when', 'which', 'will', 'have', 'has', 'had', 'been', 'than', 'then', 'they', 'them', 'their', 'there', 'also', 'any', 'all', 'can', 'may', 'must', 'should', 'would', 'could', 'في', 'من', 'على', 'الى', 'الي', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'او', 'ان', 'كان', 'لا', 'ما', 'هو', 'هي', 'كل', 'قد']);
function termsV0(s: string, max = 48): string[] {
  const out = new Set<string>();
  for (const token of normalizeText(s).split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 2 || STOP0.has(token)) continue;
    out.add(token.length > 40 ? token.slice(0, 40) : token);
  }
  return [...out].sort().slice(0, max);
}

describe('P1-CONTEXT-INTEL-01 C3: TI-0 unchanged, TI-1 salience terms and the union query', () => {
  const samples = [...dev.cases.map((c) => c.text), `${'Egypt payments wallets merchants settlement delays '.repeat(30)} zeta`, 'الشركة الخطة المرحلة الفريق العمل التنفيذ '.repeat(20), '', '~tilde, punctuation; and 123 numbers — دلوقتي؟'];

  test('terms() is byte-identical to the previous release (TI-0: stored terms_json and today\'s index rows never change)', () => {
    for (const s of samples) assert.deepEqual(terms(s), termsV0(s));
  });

  test('salienceTerms: frequency first (not alphabetical), bounded, sorted, deterministic, stopwords removed', () => {
    const long = `${Array.from({ length: 60 }, (_, i) => `aa${String(i).padStart(2, '0')}`).join(' ')} ${'zwallet '.repeat(3)}`;
    assert.equal(terms(long).includes('zwallet'), false, 'TI-0 keeps the alphabetical first 48: the repeated topic word is cut');
    assert.equal(salienceTerms(long).includes('zwallet'), true, 'TI-1 keeps the most frequent word');
    for (const s of samples) {
      const t = salienceTerms(s);
      assert.ok(t.length <= 48);
      assert.deepEqual(t, [...t].sort());
      assert.deepEqual(t, salienceTerms(s));
      for (const w of ['ده', 'عشان', 'ازاي', 'please', 'the']) assert.equal(t.includes(normalizeText(w)), false, w);
    }
  });

  test('queryTerms: topics ∪ TI-0 ∪ TI-1 ∪ Arabic proclitic variants ∪ extras, with no alphabetical cut', () => {
    const body = 'عايزين نراجع ميزانية التسويق والمنتج في السعودية';
    const q = queryTerms(body, ['ceo', 'founder'], ['governance', 'discipline']);
    for (const t of [...terms(body), ...salienceTerms(body), 'ceo', 'founder', 'governance', 'discipline']) assert.ok(q.includes(t), t);
    assert.ok(q.includes('ميزانيه') && q.includes('الميزانيه'), 'ال + stem is a query-side variant');
    assert.ok(q.includes('التسويق') && q.includes('تسويق'), 'a stem without its article is a query-side variant');
    assert.equal(terms(body).includes('الميزانيه'), false, 'stored terms are never stemmed or expanded');
    const longBody = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const topics = Array.from({ length: 80 }, (_, i) => `topic${i}`);
    assert.equal(queryTerms(longBody, topics).length, new Set([...terms(longBody), ...salienceTerms(longBody), ...topics]).size, 'the whole union');
    assert.ok(queryTerms(longBody, topics).length > 96, 'no alphabetical cut at 96');
  });

  test('DG-1n: every query term (previous release or union) is [\\p{L}\\p{N}]+, so it can never match a `~` index row', () => {
    const plain = /^[\p{L}\p{N}]+$/u;
    for (const s of samples) for (const t of [...termsV0(s), ...queryTerms(s, terms('ceo founder'), terms('ceo governance discipline'))]) assert.ok(plain.test(t), JSON.stringify(t));
  });
});

// --- CP-1 ----------------------------------------------------------------------------------------

const base = { version: 1, authorityWeight: 0, status: 'ACTIVE', stale: false, dataClass: 'D1', marketRef: null, terms: ['budget'], confidencePct: 100, createdAt: '2026-10-01T00:00:00.000Z', validatedAt: null, claimKey: null, claimValue: null, conflictHeld: false, sha256: 'x', required: false, provenanceRef: 'p' } as const;
const cand = (o: Partial<ContextCandidate> & Pick<ContextCandidate, 'key' | 'kind' | 'layer' | 'estTokens'>): ContextCandidate => ({ ...base, itemId: o.key, ...o }) as ContextCandidate;
const Q = { terms: ['budget', 'hiring', 'egypt'], marketRef: null, dataClassCeiling: 'D2', importance: 'ORDINARY' } as const;

/** A populated Founder reply at 60K: required items, history, six Skills, canonical, overfilled knowledge / memory, rule items, two tools. */
function populated(over: { canonicalBig?: boolean; supportingBytes?: number; knowledge?: number; memory?: number } = {}): ContextCandidate[] {
  const c: ContextCandidate[] = [
    cand({ key: 'preamble', kind: 'PREAMBLE', layer: 'AUTHORITY', required: true, estTokens: 10_142 }),
    cand({ key: 'work', kind: 'WORK_INSTRUCTIONS', layer: 'WORK', required: true, estTokens: 7_600 }), // a 4,000-character Arabic message
    cand({ key: 'conversation', kind: 'WORK_INSTRUCTIONS', layer: 'WORK', authorityWeight: 5, estTokens: 11_846 }),
    cand({ key: 'skill:gov', kind: 'SKILL', layer: 'SKILL', status: 'CURRENT', tier: 'TASK_REQUIRED', authorityWeight: 15, terms: ['governance'], estTokens: 2_318 }),
    cand({ key: 'skill:fp', kind: 'SKILL', layer: 'SKILL', status: 'CURRENT', tier: 'TASK_REQUIRED', authorityWeight: 15, terms: ['founder'], estTokens: 2_120 }),
    cand({ key: 'skill:ee', kind: 'SKILL', layer: 'SKILL', status: 'CURRENT', tier: 'TASK_REQUIRED', authorityWeight: 15, terms: ['evidence'], estTokens: 1_950 }),
    cand({ key: 'skill:ej', kind: 'SKILL', layer: 'SKILL', status: 'CURRENT', tier: 'SUPPORTING', authorityWeight: 5, terms: ['judgment'], estTokens: over.supportingBytes ?? 1_900 }),
    cand({ key: 'skill:ol', kind: 'SKILL', layer: 'SKILL', status: 'CURRENT', tier: 'SUPPORTING', authorityWeight: 5, terms: ['organization'], estTokens: over.supportingBytes ?? 1_840 }),
    // canonical: three relevant statements and one claim (relevance by claim), all small enough for the AUTHORITY share
    cand({ key: 'canonical:c1', kind: 'CANONICAL', layer: 'AUTHORITY', authorityWeight: 20, estTokens: over.canonicalBig ? 9_000 : 1_700, terms: ['budget', 'hiring'] }),
    cand({ key: 'canonical:c2', kind: 'CANONICAL', layer: 'AUTHORITY', authorityWeight: 18, estTokens: over.canonicalBig ? 5_000 : 1_500, terms: ['egypt'] }),
    cand({ key: 'canonical:c3', kind: 'CANONICAL', layer: 'AUTHORITY', authorityWeight: 16, estTokens: 1_300, terms: ['budget'], claimKey: 'company.budget.ceiling', claimValue: '5usd' }),
    cand({ key: 'canonical:irrelevant', kind: 'CANONICAL', layer: 'AUTHORITY', authorityWeight: 20, estTokens: 900, terms: ['server'] }),
    // rule items: above the ceiling, stale, contradicting canonical
    cand({ key: 'knowledge:d3', kind: 'KNOWLEDGE', layer: 'KNOWLEDGE', dataClass: 'D3', estTokens: 1_800 }),
    cand({ key: 'memory:stale', kind: 'MEMORY', layer: 'MEMORY', stale: true, estTokens: 900 }),
    cand({ key: 'memory:contradicts', kind: 'MEMORY', layer: 'MEMORY', estTokens: 700, claimKey: 'company.budget.ceiling', claimValue: '50usd' }),
    cand({ key: 'recent:000000', kind: 'TOOL_RESULT', layer: 'RECENT', authorityWeight: 7, estTokens: 2_212 }),
    cand({ key: 'recent:000001', kind: 'TOOL_RESULT', layer: 'RECENT', required: true, authorityWeight: 8, estTokens: 2_212 }),
  ];
  for (let i = 0; i < (over.knowledge ?? 18); i++) c.push(cand({ key: `knowledge:k${String(i).padStart(2, '0')}`, kind: 'KNOWLEDGE', layer: 'KNOWLEDGE', authorityWeight: i === 0 ? 12 : 5, terms: i % 2 === 0 ? ['budget', 'hiring'] : ['budget'], estTokens: 1_500 + ((i * 937) % 5_900) }));
  for (let i = 0; i < (over.memory ?? 24); i++) c.push(cand({ key: `memory:m${String(i).padStart(2, '0')}`, kind: 'MEMORY', layer: 'MEMORY', authorityWeight: i === 0 ? 15 : 0, terms: i % 3 === 0 ? ['egypt', 'hiring'] : ['egypt'], estTokens: 600 + ((i * 613) % 2_400) }));
  return c;
}
const plan60 = (c: readonly ContextCandidate[], order: 'CP1' | undefined = 'CP1', total = 60_000): ContextPlan => planContext(c, { ...DEFAULT_CONTEXT_POLICY, totalTokens: total, ...(order ? { order } : {}) }, Q, NOW);
const selectedKeys = (p: ContextPlan): Set<string> => new Set(p.selected.map((x) => x.candidate.key));
const why = (p: ContextPlan): Map<string, string> => new Map(p.rejected.map((r) => [r.candidate.key, r.reason]));

describe('P1-CONTEXT-INTEL-01 CP-1 (Founder decision G3): the context priority order on a populated store at 60K', () => {
  test('canonical truth, TASK_REQUIRED Skills and the history are kept; every rule item is rejected with its exact code; used <= budget', () => {
    const p = plan60(populated());
    assert.equal(p.outcome, 'OK');
    const sel = selectedKeys(p);
    for (const k of ['canonical:c1', 'canonical:c2', 'canonical:c3', 'skill:gov', 'skill:fp', 'skill:ee', 'conversation', 'recent:000001']) assert.ok(sel.has(k), k);
    const r = why(p);
    assert.equal(r.get('knowledge:d3'), 'DATA_CLASS_ABOVE_CONTEXT');
    assert.equal(r.get('memory:stale'), 'STALE');
    assert.equal(r.get('memory:contradicts'), 'HIGHER_AUTHORITY_OVERRIDES');
    assert.equal(r.get('canonical:irrelevant'), 'NOT_RELEVANT');
    assert.ok(p.usedTokens <= 60_000 - DEFAULT_CONTEXT_POLICY.frameTokens);
  });

  test('every critical item is classified: selected, relevance rejection, budget rejection or item limit (the planner accounts for every candidate)', () => {
    const c = populated();
    const p = plan60(c);
    const sel = selectedKeys(p);
    const r = why(p);
    for (const x of c) {
      const cls = sel.has(x.key) ? 'SELECTED' : r.get(x.key);
      assert.ok(cls !== undefined, `${x.key} is accounted for`);
      assert.ok(['SELECTED', 'NOT_RELEVANT', 'BUDGET_EXCEEDED', 'LAYER_ITEM_LIMIT', 'DATA_CLASS_ABOVE_CONTEXT', 'STALE', 'HIGHER_AUTHORITY_OVERRIDES'].includes(cls), `${x.key}: ${cls}`);
    }
    assert.ok([...r.values()].includes('BUDGET_EXCEEDED'), 'the overfilled knowledge / memory meets the budget');
  });

  test('the best knowledge and memory items come before SUPPORTING Skills', () => {
    // A budget where, after canonical, TASK_REQUIRED Skills and the history, only the two anchors fit — not the SUPPORTING Skills.
    // At 60K, the governance preamble is sized so that after it, canonical truth, TASK_REQUIRED Skills and the history, exactly
    // the two anchors fit (100 tokens to spare).
    const c0 = populated({ knowledge: 2, memory: 2 }).filter((x) => x.key !== 'recent:000000');
    const others = c0.filter((x) => (x.required && x.key !== 'preamble') || (x.kind === 'CANONICAL' && x.key !== 'canonical:irrelevant') || x.key === 'conversation' || x.tier === 'TASK_REQUIRED').reduce((n, x) => n + x.estTokens, 0);
    const anchors = (c0.find((x) => x.key === 'knowledge:k00')?.estTokens ?? 0) + (c0.find((x) => x.key === 'memory:m00')?.estTokens ?? 0);
    const c = c0.map((x) => (x.key === 'preamble' ? { ...x, estTokens: 60_000 - 512 - others - anchors - 100 } : x));
    const cp1 = plan60(c);
    const s = selectedKeys(cp1);
    assert.ok(s.has('knowledge:k00') && s.has('memory:m00'), 'CP-1: the anchors');
    assert.ok(!s.has('skill:ej') && !s.has('skill:ol'), 'CP-1: SUPPORTING waits');
    assert.equal(why(cp1).get('skill:ej'), 'BUDGET_EXCEEDED');
  });

  test('share isolation: knowledge cannot take the SKILL share, and SUPPORTING Skills cannot take the knowledge / memory shares', () => {
    // Knowledge and memory overfilled: SUPPORTING Skills that fit the SKILL share are still selected in their own pass (a
    // short message, so the required items leave the budget for every share).
    const small = selectedKeys(plan60(populated({ knowledge: 40, memory: 60 }).map((x) => (x.key === 'work' ? { ...x, estTokens: 1_500 } : x))));
    assert.ok(small.has('skill:ej') && small.has('skill:ol'), 'SUPPORTING within the SKILL share');
    // SUPPORTING Skills too large for what the TASK_REQUIRED Skills leave of the SKILL share: knowledge and memory keep their shares.
    const big = plan60(populated({ supportingBytes: 9_000 }));
    const kept = (kind: string): number => big.selected.filter((x) => x.candidate.kind === kind).length;
    assert.ok(kept('KNOWLEDGE') >= 2 && kept('MEMORY') >= 2, `knowledge ${kept('KNOWLEDGE')}, memory ${kept('MEMORY')}`);
    for (const k of ['skill:gov', 'skill:fp', 'skill:ee']) assert.ok(selectedKeys(big).has(k), k);
  });

  test('TASK_REQUIRED Skills and the history survive overfilled knowledge, memory and SUPPORTING Skills', () => {
    const p = plan60(populated({ knowledge: 40, memory: 60, supportingBytes: 9_000 }));
    const s = selectedKeys(p);
    for (const k of ['skill:gov', 'skill:fp', 'skill:ee', 'conversation']) assert.ok(s.has(k), k);
  });

  test('canonical truth beyond the AUTHORITY share is first in the spill; with the stores overfilled it is a recorded budget rejection (the pinned bound)', () => {
    // 9,000 + 5,000 + 1,300 > the AUTHORITY share (11,897): one statement waits for the spill.
    const roomy = plan60(populated({ canonicalBig: true, knowledge: 0, memory: 0 }).filter((x) => x.key !== 'recent:000000'));
    for (const k of ['canonical:c1', 'canonical:c2', 'canonical:c3']) assert.ok(selectedKeys(roomy).has(k), `${k} (spill first)`);
    const full = plan60(populated({ canonicalBig: true }));
    const lost = full.rejected.filter((r) => r.candidate.kind === 'CANONICAL' && r.reason !== 'NOT_RELEVANT');
    assert.ok(lost.every((r) => r.reason === 'BUDGET_EXCEEDED'), 'recorded, never silent');
    assert.ok(lost.length <= 1, 'only what exceeds the share');
  });

  test('deterministic; the layered order (every other Work Item) is unchanged when no CP-1 order is set', () => {
    const c = populated();
    assert.deepEqual(plan60(c).selected.map((x) => x.candidate.key), plan60(c).selected.map((x) => x.candidate.key));
    const layered = plan60(c, undefined);
    const untiered = c.map((x): ContextCandidate => {
      const { tier, ...rest } = x;
      void tier;
      return rest;
    });
    const withoutTier = plan60(untiered, undefined);
    assert.deepEqual(layered.selected.map((x) => x.candidate.key), withoutTier.selected.map((x) => x.candidate.key), 'tiers never act outside CP-1');
    assert.throws(() => planContext(c, { ...DEFAULT_CONTEXT_POLICY, order: 'FO1' as 'CP1' }, Q, NOW), /order must be LAYERED or CP1/);
  });

  // G4-FINAL-QUALITY-CORR-01 (WP2): the score's relevance part saturates at four matched terms, so a specific item tied
  // with generic ones and lost to recency. CP-1 ranks knowledge and memory by matched terms weighted by rarity, then score.
  describe('relevance order: a specific item beats generic ones that tie it on the saturated score', () => {
    const QS = { ...Q, terms: ['company', 'team', 'plan', 'quarter', 'fawry', 'egp', 'devaluation', 'price'] } as const;
    const generic = (i: number, kind: 'KNOWLEDGE' | 'MEMORY'): ContextCandidate =>
      cand({ key: `${kind.toLowerCase()}:generic${String(i).padStart(2, '0')}`, kind, layer: kind, terms: ['company', 'team', 'plan', 'quarter', 'week'], estTokens: 2_400, createdAt: '2026-10-12T00:00:00.000Z' as Timestamp });
    const specific = (kind: 'KNOWLEDGE' | 'MEMORY', est: number): ContextCandidate =>
      cand({ key: `${kind.toLowerCase()}:specific`, kind, layer: kind, terms: ['company', 'egp', 'fawry', 'devaluation', 'price', 'plan'], estTokens: est, createdAt: '2026-10-01T00:00:00.000Z' as Timestamp });
    const world = (kind: 'KNOWLEDGE' | 'MEMORY', est = 2_400): ContextCandidate[] => [
      ...populated({ knowledge: 0, memory: 0 }),
      ...Array.from({ length: 30 }, (_, i) => generic(i, kind)),
      specific(kind, est),
    ];
    const plan = (c: readonly ContextCandidate[], order?: 'CP1'): ContextPlan => planContext(c, { ...DEFAULT_CONTEXT_POLICY, totalTokens: 60_000, ...(order ? { order } : {}) }, QS, NOW);

    test('the older specific item ties the generic ones on the score and loses under it; CP-1 selects it', () => {
      for (const kind of ['KNOWLEDGE', 'MEMORY'] as const) {
        const c = world(kind);
        const layered = plan(c);
        const cp1 = plan(c, 'CP1');
        const key = `${kind.toLowerCase()}:specific`;
        const score = (p: ContextPlan, k: string): number | undefined => [...p.selected, ...p.rejected].find((x) => x.candidate.key === k)?.score;
        assert.equal(score(layered, key), score(layered, `${kind.toLowerCase()}:generic00`), `${kind}: the same saturated score`);
        assert.equal(selectedKeys(layered).has(key), false, `${kind}: the layered order (score only) loses the specific item`);
        assert.equal(why(layered).get(key), 'BUDGET_EXCEEDED');
        assert.ok(selectedKeys(cp1).has(key), `${kind}: CP-1 selects it`);
      }
    });

    test('a large specific item (beyond the layer share) is the protected anchor instead of a budget rejection', () => {
      assert.ok(selectedKeys(plan(world('KNOWLEDGE', 7_400), 'CP1')).has('knowledge:specific'));
    });

    test('a term every candidate shares weighs less than a rare one: more generic matches never outrank a specific match', () => {
      const c = [
        ...populated({ knowledge: 0, memory: 0 }),
        ...Array.from({ length: 40 }, (_, i) => cand({ key: `knowledge:g${i}`, kind: 'KNOWLEDGE', layer: 'KNOWLEDGE', terms: ['company', 'team', 'plan', 'quarter', 'price'], estTokens: 2_400 })),
        cand({ key: 'knowledge:rare', kind: 'KNOWLEDGE', layer: 'KNOWLEDGE', terms: ['fawry', 'egp'], estTokens: 2_400 }),
      ];
      assert.ok(selectedKeys(plan(c, 'CP1')).has('knowledge:rare'), 'two rare terms outrank five common ones');
      assert.equal(selectedKeys(plan(c)).has('knowledge:rare'), false, 'under the score alone the five common matches win');
    });

    test('deterministic, and the layered order (every Work Item without CP-1) keeps the score order exactly', () => {
      const c = world('MEMORY');
      const a = plan(c, 'CP1');
      const b = plan([...c].reverse(), 'CP1');
      assert.deepEqual(a.selected.map((x) => x.candidate.key).sort(), b.selected.map((x) => x.candidate.key).sort());
      const scores = plan(c).selected.filter((x) => x.candidate.layer === 'MEMORY').map((x) => x.score);
      assert.deepEqual(scores, [...scores].sort((x, y) => y - x), 'layered memory stays in score order');
    });
  });
});

describe('G4-SIMPLE-01 (D-P1-16): the CEO\'s six Skills loaded directly — all SUPPORTING, their real v7 sizes — at 60K', () => {
  const six = CEO_ACADEMY_PACKAGE_V7.skills.map((s, i) => cand({ key: `skill:${s.code}`, kind: 'SKILL', layer: 'SKILL', status: 'CURRENT', tier: 'SUPPORTING', authorityWeight: 5, terms: [`skill${i}`], estTokens: Buffer.byteLength(s.instructions, 'utf8') + 96 }));
  const share = (layer: keyof typeof DEFAULT_CONTEXT_POLICY.layerSharePct): number => Math.floor(((60_000 - DEFAULT_CONTEXT_POLICY.frameTokens) * DEFAULT_CONTEXT_POLICY.layerSharePct[layer]) / 100);
  const keys = (p: ContextPlan, kind: string): string[] => p.selected.filter((x) => x.candidate.kind === kind).map((x) => x.candidate.key).sort();

  test('six Skills, all within the SKILL share; on an empty store every one loads', () => {
    assert.deepEqual([...SKILL_TIERS], ['TASK_REQUIRED', 'SUPPORTING']);
    assert.equal(six.length, 6);
    assert.ok(six.reduce((n, x) => n + x.estTokens, 0) <= share('SKILL'), 'the six fit their own share');
    const empty = populated({ knowledge: 0, memory: 0 }).filter((x) => x.kind !== 'SKILL' && x.kind !== 'CANONICAL');
    const p = plan60([...empty, ...six]);
    assert.equal(p.outcome, 'OK');
    assert.deepEqual(keys(p, 'SKILL'), six.map((x) => x.key).sort());
  });

  test('on a full store with an ordinary message every Skill loads; canonical truth, the history and the anchors are untouched; knowledge and memory fill their own shares', () => {
    const full = populated({ knowledge: 40, memory: 60 }).filter((x) => x.kind !== 'SKILL').map((x) => (x.key === 'work' ? { ...x, estTokens: 1_500 } : x));
    const withSix = plan60([...full, ...six]);
    const without = plan60(full);
    assert.equal(withSix.outcome, 'OK');
    assert.deepEqual(keys(withSix, 'SKILL'), six.map((x) => x.key).sort(), 'all six');
    assert.deepEqual(keys(withSix, 'CANONICAL'), keys(without, 'CANONICAL'), 'canonical truth is never displaced');
    assert.ok(selectedKeys(withSix).has('conversation') && selectedKeys(withSix).has('knowledge:k00') && selectedKeys(withSix).has('memory:m00'), 'history and anchors');
    for (const kind of ['KNOWLEDGE', 'MEMORY'] as const) {
      const used = withSix.selected.filter((x) => x.candidate.kind === kind).reduce((n, x) => n + x.candidate.estTokens, 0);
      assert.ok(used >= share(kind) - Math.max(...full.filter((x) => x.kind === kind).map((x) => x.estTokens)), `${kind}: its share is filled (${used})`);
    }
    assert.ok(withSix.usedTokens <= 60_000 - DEFAULT_CONTEXT_POLICY.frameTokens);
  });

  test('saturated (a 4,000-character Arabic message, full history, two tool results, overfilled stores): knowledge and memory keep their shares; a Skill that no longer fits is a recorded budget rejection, never silent', () => {
    const full = populated({ knowledge: 40, memory: 60 }).filter((x) => x.kind !== 'SKILL');
    const withSix = plan60([...full, ...six]);
    const without = plan60(full);
    assert.equal(withSix.outcome, 'OK');
    assert.deepEqual(keys(withSix, 'CANONICAL'), keys(without, 'CANONICAL'), 'canonical truth is never displaced');
    for (const kind of ['KNOWLEDGE', 'MEMORY'] as const) {
      const used = withSix.selected.filter((x) => x.candidate.kind === kind).reduce((n, x) => n + x.candidate.estTokens, 0);
      assert.ok(used >= share(kind) - Math.max(...full.filter((x) => x.kind === kind).map((x) => x.estTokens)), `${kind}: its share is filled (${used})`);
    }
    assert.ok(selectedKeys(withSix).has('conversation'), 'history');
    const lost = six.filter((x) => !selectedKeys(withSix).has(x.key));
    assert.ok(lost.length > 0 && lost.length < 6, `some Skills wait (${lost.length})`);
    for (const x of lost) assert.equal(why(withSix).get(x.key), 'BUDGET_EXCEEDED');
  });
});
