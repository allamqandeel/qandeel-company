/**
 * P1-CONTEXT-INTEL-01 (D-P1-14) — G4 Context & Skill Intelligence, the pure kernel (no I/O, synthetic text only):
 *   - C2: the Founder-approved need table and the tier of a Skill (metadata only), measured on the synthetic development set
 *     (never the sealed held-out set HO-1);
 *   - C3: `terms()` (TI-0) is byte-identical to the previous release; TI-1 salience terms and the union query are
 *     deterministic, bounded, and never produce a term the previous release could confuse with a `~` index row;
 *   - CP-1 (Founder decision G3): the step order, share isolation, protected TASK_REQUIRED Skills and history, the
 *     knowledge / memory anchors before SUPPORTING Skills, canonical overflow first in the spill, every rule unchanged,
 *     and every critical item classified.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Timestamp } from '@qandeel-company/domain';
import { taskSignals, type TaskSignal } from '@qandeel-company/governance';

import {
  DEFAULT_CONTEXT_POLICY,
  SKILL_NEED_TABLE,
  SKILL_NEED_TABLE_VERSION,
  normalizeText,
  planContext,
  queryTerms,
  salienceTerms,
  skillNeedRank,
  skillTier,
  terms,
  type ContextCandidate,
  type ContextPlan,
} from '../src/index.js';

const NOW = '2026-10-13T06:00:00.000Z' as Timestamp;
const REPLY = 'founder.reply';

interface DevCase { readonly id: string; readonly lang: string; readonly kind: string; readonly text: string; readonly required: readonly string[] }
const dev = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'governance', 'test', 'fixtures', 'task-signals-dev-set.json'), 'utf8')) as { policy: string; skills: Record<string, string>; cases: DevCase[] };
const TASK_SKILLS = Object.keys(SKILL_NEED_TABLE).filter((c) => c !== 'ceo.founder-partnership');
const signalsOf = (text: string): readonly TaskSignal[] => taskSignals({ text, purpose: 'QUESTION', executive: true }).signals;
const tiersOf = (text: string): Record<string, string | null> => Object.fromEntries(Object.keys(SKILL_NEED_TABLE).map((c) => [c, skillTier(c, signalsOf(text), REPLY)]));
const requiredOf = (text: string): string[] => TASK_SKILLS.filter((c) => tiersOf(text)[c] === 'TASK_REQUIRED');

describe('P1-CONTEXT-INTEL-01 C2: the need table and the tier of a Skill (metadata only)', () => {
  test('the table is the Founder-approved G2 table, release-pinned', () => {
    assert.equal(SKILL_NEED_TABLE_VERSION, 'SN-1');
    assert.deepEqual(JSON.parse(JSON.stringify(SKILL_NEED_TABLE)), {
      'ceo.governance-discipline': { required: ['AUTHORITY'], supporting: ['BASELINE'] },
      'ceo.founder-partnership': { required: ['FOUNDER_CONVERSATION'], supporting: [] },
      'ceo.executive-judgment': { required: ['EXECUTIVE_DECISION', 'MULTI_DECISION', 'COMPARISON_OR_TRADEOFF', 'URGENT_OR_IRREVERSIBLE', 'FOUNDER_DECISION_PURPOSE', 'PRIORITIZATION'], supporting: ['STRATEGIC_PLANNING', 'ANALYSIS_DEPTH', 'UNCERTAIN_HIGH_CONSEQUENCE', 'UNCERTAIN_SUBSTANTIAL_REQUEST'] },
      'ceo.evidence-and-economics': { required: ['FINANCIAL_OR_LEGAL_STAKES', 'EVIDENCE', 'BUDGET_SUFFIXED'], supporting: ['ANALYSIS_DEPTH', 'MARKET_OR_EXPANSION_SCOPE', 'STRATEGIC_PLANNING', 'COMPARISON_OR_TRADEOFF'] },
      'ceo.organization-leadership': { required: ['ORGANIZATION_DESIGN', 'STAFFING_CONSEQUENCE', 'OWNERSHIP', 'ORG_ROLE'], supporting: ['STRATEGIC_PLANNING', 'CROSS_DEPARTMENT'] },
      'ceo.cross-functional-synthesis': { required: ['CROSS_DEPARTMENT', 'MARKET_DECISION'], supporting: ['MARKET_OR_EXPANSION_SCOPE', 'STRATEGIC_PLANNING', 'MULTI_PART_REQUEST', 'ANALYSIS_DEPTH'] },
    });
    assert.deepEqual(Object.keys(SKILL_NEED_TABLE).map(skillNeedRank), [0, 1, 2, 3, 4, 5], 'declaration order is the intra-tier priority');
  });

  test('an undeclared Skill keeps the legacy path; a Founder conversation needs founder-partnership unless it is a transformation; governance is the baseline', () => {
    assert.equal(skillTier('market.research', signalsOf('Compare Egypt and Saudi.'), REPLY), null);
    assert.equal(skillTier('ceo.founder-partnership', signalsOf('What do you think about our plan?'), REPLY), 'TASK_REQUIRED');
    assert.equal(skillTier('ceo.founder-partnership', signalsOf('Translate this paragraph into Arabic please.'), REPLY), 'NON_RELEVANT');
    assert.equal(skillTier('ceo.founder-partnership', signalsOf('What do you think about our plan?'), 'draft.memo'), 'NON_RELEVANT', 'only a Founder conversation');
    assert.equal(skillTier('ceo.governance-discipline', signalsOf('Thanks, noted.'), REPLY), 'SUPPORTING');
    assert.equal(skillTier('ceo.governance-discipline', signalsOf('Can you raise your own budget without asking me?'), REPLY), 'TASK_REQUIRED');
    assert.equal(skillTier('ceo.cross-functional-synthesis', signalsOf('Thanks, noted.'), REPLY), 'NON_RELEVANT', 'never all six Skills');
  });

  test('development set (synthetic EN / MSA / EG): recall >= 0.95 overall, per language and per Skill; precision >= 0.80', () => {
    assert.equal(dev.policy, 'TS-1');
    assert.ok(dev.cases.length >= 200, `a substantial development set (${dev.cases.length})`);
    let tp = 0, fn = 0, fp = 0;
    const lang = new Map<string, [number, number]>();
    const skill = new Map<string, [number, number]>();
    for (const c of dev.cases) {
      const want = c.required.map((k) => dev.skills[k] as string);
      const got = requiredOf(c.text);
      for (const w of want) {
        const hit = got.includes(w) ? 1 : 0;
        tp += hit;
        fn += 1 - hit;
        const l = lang.get(c.lang) ?? [0, 0];
        lang.set(c.lang, [l[0] + hit, l[1] + 1]);
        const s = skill.get(w) ?? [0, 0];
        skill.set(w, [s[0] + hit, s[1] + 1]);
      }
      fp += got.filter((g) => !want.includes(g)).length;
    }
    assert.ok(tp / (tp + fn) >= 0.95, `recall ${tp}/${tp + fn}`);
    assert.ok(tp / (tp + fp) >= 0.8, `precision ${tp}/${tp + fp}`);
    for (const [l, [a, b]] of lang) assert.ok(a / b >= 0.95, `recall ${l} ${a}/${b}`);
    for (const [s, [a, b]] of skill) assert.ok(a / b >= 0.9, `recall ${s} ${a}/${b}`);
  });

  test('simple messages: routine, thanks and translation need no task Skill; a factual or status question needs at most one; none loads four or more', () => {
    const simple = dev.cases.filter((c) => c.kind === 'SIMPLE');
    assert.ok(simple.length >= 30);
    for (const c of simple) {
      const t = tiersOf(c.text);
      const required = requiredOf(c.text);
      assert.ok(required.length <= 1, `${c.id}: ${required.join(',')}`);
      const loaded = Object.values(t).filter((x) => x === 'TASK_REQUIRED' || x === 'SUPPORTING').length;
      assert.ok(loaded < 4, `${c.id} loads ${loaded}`);
    }
    for (const text of ['Thanks, noted.', 'شكرا، وصلت.', 'تمام، متشكر', 'Translate this paragraph into Arabic please.', 'ترجم هذه الفقرة إلى الإنجليزية من فضلك.', 'Good morning! Hope you had a nice weekend.']) {
      assert.deepEqual(requiredOf(text), [], text);
    }
    // A Founder status check with several questions (the S2 shape): names roles and spending to report, needs no task Skill.
    assert.deepEqual(requiredOf('سؤالين سريعين: إحنا واقفين فين النهارده؟ عندنا كام موظف وأنهي أقسام ليها مدير، والصرف ماشي إزاي؟'), []);
    assert.deepEqual(requiredOf('Two quick questions: where do we stand today? How many employees do we have, which departments have a director, and how is spending going?'), []);
  });

  test('deterministic and metadata-only: the same message gives the same tiers; tiers are closed codes', () => {
    for (const c of dev.cases.slice(0, 60)) {
      assert.deepEqual(tiersOf(c.text), tiersOf(c.text));
      for (const v of Object.values(tiersOf(c.text))) assert.ok(v === 'TASK_REQUIRED' || v === 'SUPPORTING' || v === 'NON_RELEVANT');
    }
  });
});

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
    cand({ key: 'skill:gov', kind: 'SKILL', layer: 'SKILL', status: 'CURRENT', tier: 'TASK_REQUIRED', needRank: 0, authorityWeight: 15, terms: ['governance'], estTokens: 2_318 }),
    cand({ key: 'skill:fp', kind: 'SKILL', layer: 'SKILL', status: 'CURRENT', tier: 'TASK_REQUIRED', needRank: 1, authorityWeight: 15, terms: ['founder'], estTokens: 2_120 }),
    cand({ key: 'skill:ee', kind: 'SKILL', layer: 'SKILL', status: 'CURRENT', tier: 'TASK_REQUIRED', needRank: 3, authorityWeight: 15, terms: ['evidence'], estTokens: 1_950 }),
    cand({ key: 'skill:ej', kind: 'SKILL', layer: 'SKILL', status: 'CURRENT', tier: 'SUPPORTING', needRank: 2, authorityWeight: 5, terms: ['judgment'], estTokens: over.supportingBytes ?? 1_900 }),
    cand({ key: 'skill:ol', kind: 'SKILL', layer: 'SKILL', status: 'CURRENT', tier: 'SUPPORTING', needRank: 4, authorityWeight: 5, terms: ['organization'], estTokens: over.supportingBytes ?? 1_840 }),
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
    // Knowledge and memory overfilled: SUPPORTING Skills that fit the SKILL share are still selected in their own pass.
    const small = selectedKeys(plan60(populated({ knowledge: 40, memory: 60 })));
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
      const { tier, needRank, ...rest } = x;
      void tier;
      void needRank;
      return rest;
    });
    const withoutTier = plan60(untiered, undefined);
    assert.deepEqual(layered.selected.map((x) => x.candidate.key), withoutTier.selected.map((x) => x.candidate.key), 'tiers never act outside CP-1');
    assert.throws(() => planContext(c, { ...DEFAULT_CONTEXT_POLICY, order: 'FO1' as 'CP1' }, Q, NOW), /order must be LAYERED or CP1/);
  });
});
