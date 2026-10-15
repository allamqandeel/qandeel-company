/**
 * G4-FINAL-CLOSURE-01 (D-P1-17) — the pure kernel (no I/O, synthetic text only):
 *   - `messageLanguage`: the language of the CURRENT message, deterministic, quoted text excluded, mixed → none;
 *   - CP-1 step 3b: the Founder's recorded decisions in force that bear on the task come right after canonical truth —
 *     before the history, the knowledge anchors and the Skills — within the KNOWLEDGE share; an unrelated one is never
 *     loaded; the LAYERED order (every other Work Item) is unchanged.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Timestamp } from '@qandeel-company/domain';

import { DEFAULT_CONTEXT_POLICY, messageLanguage, planContext, type ContextCandidate, type ContextPlan } from '../src/index.js';

const NOW = '2026-10-15T06:00:00.000Z' as Timestamp;

describe('G4-FINAL-CLOSURE-01: messageLanguage', () => {
  test('English, Egyptian Arabic (with English product words), quoted text and mixed messages', () => {
    assert.equal(messageLanguage('We have budget for only one of two things next quarter. Which do you recommend, and what would make you change your mind?'), 'ENGLISH');
    assert.equal(messageLanguage('Go ahead and sign the marketing agency contract today, and raise the Growth budget cap to 200,000 EGP yourself.'), 'ENGLISH');
    assert.equal(messageLanguage('يا أحمد، عايز نناقش تأسيس قسم Strategic Market Intelligence في الشركة. إيه رأيك في الفكرة، وإزاي تقترح نبدأه: مين يقوده، يبدأ بكام شخص، وأول حاجة يطلّعها لنا إيه؟'), 'ARABIC');
    assert.equal(messageLanguage('تمام، شكرًا يا أحمد.'), 'ARABIC');
    assert.equal(messageLanguage('كام سعر باقة Pro في تطبيق قنديل دلوقتي؟'), 'ARABIC');
    assert.equal(messageLanguage('ترجم لي ده: "We have budget for only one of two things next quarter, which one?"'), 'ARABIC', 'quoted text does not decide');
    assert.equal(messageLanguage('> The board update is due on the 30th.\nرد عليه باختصار.'), 'ARABIC', 'a quoted line does not decide');
    assert.equal(messageLanguage('رد بالإنجليزي: «تمام»'), 'ARABIC');
    assert.equal(messageLanguage('OK تمام go ahead يلا'), null, 'mixed: none');
    assert.equal(messageLanguage('👍 2026'), null, 'too little text: none');
    assert.equal(messageLanguage('ok'), null);
  });
});

const base = { version: 1, authorityWeight: 0, status: 'ACTIVE', stale: false, dataClass: 'D1', marketRef: null, terms: ['budget'], confidencePct: 100, createdAt: '2026-10-01T00:00:00.000Z', validatedAt: null, claimKey: null, claimValue: null, conflictHeld: false, sha256: 'x', required: false, provenanceRef: 'p' } as const;
const cand = (o: Partial<ContextCandidate> & Pick<ContextCandidate, 'key' | 'kind' | 'layer' | 'estTokens'>): ContextCandidate => ({ ...base, itemId: o.key, ...o }) as ContextCandidate;
const Q = { terms: ['budget', 'marketing', 'quarter', 'sara'], marketRef: null, dataClassCeiling: 'D2', importance: 'ORDINARY' } as const;
const unflag = (c: readonly ContextCandidate[]): ContextCandidate[] => c.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'founderDecision')) as unknown as ContextCandidate);
const plan = (c: readonly ContextCandidate[], order: 'CP1' | undefined = 'CP1', total = 60_000): ContextPlan => planContext(c, { ...DEFAULT_CONTEXT_POLICY, totalTokens: total, ...(order ? { order } : {}) }, Q, NOW);

/** A saturated Founder reply: required items, a large history, six Skills, many knowledge items matching more terms, one decision. */
function saturated(decisionTerms: readonly string[] = ['budget', 'marketing'], preamble = 12_000): ContextCandidate[] {
  const c: ContextCandidate[] = [
    cand({ key: 'preamble', kind: 'PREAMBLE', layer: 'AUTHORITY', required: true, estTokens: preamble }),
    cand({ key: 'work', kind: 'WORK_INSTRUCTIONS', layer: 'WORK', required: true, estTokens: 7_600 }),
    cand({ key: 'conversation', kind: 'WORK_INSTRUCTIONS', layer: 'WORK', authorityWeight: 5, estTokens: 11_846 }),
    cand({ key: 'canonical:c1', kind: 'CANONICAL', layer: 'AUTHORITY', authorityWeight: 20, estTokens: 1_700, terms: ['budget'] }),
    cand({ key: 'decision:d1', kind: 'KNOWLEDGE', layer: 'KNOWLEDGE', authorityWeight: 12, estTokens: 420, terms: decisionTerms, founderDecision: true, createdAt: '2026-09-01T00:00:00.000Z' as Timestamp }),
  ];
  for (const s of ['gov', 'fp', 'ej', 'ee', 'ol', 'cs']) c.push(cand({ key: `skill:${s}`, kind: 'SKILL', layer: 'SKILL', status: 'CURRENT', tier: 'SUPPORTING', authorityWeight: 5, terms: [s], estTokens: 1_850 }));
  // Knowledge that matches MORE of the query than the decision and is newer: without step 3b it would win every slot.
  for (let i = 0; i < 20; i++) c.push(cand({ key: `knowledge:k${String(i).padStart(2, '0')}`, kind: 'KNOWLEDGE', layer: 'KNOWLEDGE', authorityWeight: 12, terms: ['budget', 'marketing', 'quarter', 'sara'], estTokens: 2_600, createdAt: '2026-10-10T00:00:00.000Z' as Timestamp }));
  return c;
}

describe('G4-FINAL-CLOSURE-01 CP-1 step 3b: the Founder\'s recorded decisions in force', () => {
  test('a relevant decision is taken right after canonical truth — before the history and every other knowledge item — even when newer knowledge matches more terms', () => {
    const p = plan(saturated());
    assert.equal(p.outcome, 'OK');
    const sel = new Set(p.selected.map((x) => x.candidate.key));
    for (const k of ['decision:d1', 'canonical:c1', 'conversation']) assert.ok(sel.has(k), k);
    // Room left after the required items and canonical truth: enough for the history OR the decision, not both.
    const tight = saturated(['budget', 'marketing'], 59_488 - 7_600 - 1_700 - 12_000);
    const t = new Set(plan(tight).selected.map((x) => x.candidate.key));
    assert.ok(t.has('canonical:c1') && t.has('decision:d1') && !t.has('conversation'), 'the decision is taken before the history');
    const u = new Set(plan(unflag(tight)).selected.map((x) => x.candidate.key));
    assert.ok(u.has('conversation') && !u.has('decision:d1'), 'without step 3b the history would have taken the room');
    assert.ok(p.usedTokens <= 60_000 - DEFAULT_CONTEXT_POLICY.frameTokens);
  });

  test('with a small KNOWLEDGE share the decision still has its slot; the newer, more relevant items take the rest', () => {
    // A small KNOWLEDGE share: with step 3b the decision has its slot; without it the newer, more relevant items fill the share.
    const small = { ...DEFAULT_CONTEXT_POLICY, totalTokens: 60_000, order: 'CP1' as const, layerSharePct: { ...DEFAULT_CONTEXT_POLICY.layerSharePct, KNOWLEDGE: 5 } };
    const withStep = planContext(saturated(), small, Q, NOW);
    const without = planContext(unflag(saturated()), small, Q, NOW);
    assert.ok(withStep.selected.some((x) => x.candidate.key === 'decision:d1'));
    assert.equal(without.selected.filter((x) => x.candidate.layer === 'KNOWLEDGE').length > 0, true);
    assert.ok(without.selected.filter((x) => x.candidate.key.startsWith('knowledge:')).length >= withStep.selected.filter((x) => x.candidate.key.startsWith('knowledge:')).length);
  });

  test('an unrelated decision is never loaded (NOT_RELEVANT): nothing is injected into every reply', () => {
    const p = plan(saturated(['server', 'office']));
    assert.equal(p.selected.some((x) => x.candidate.key === 'decision:d1'), false);
    assert.equal(p.rejected.find((r) => r.candidate.key === 'decision:d1')?.reason, 'NOT_RELEVANT');
  });

  test('within the KNOWLEDGE share and the budget: a decision too large for the share waits for the later passes, never past the budget', () => {
    const c = saturated().map((x) => (x.key === 'decision:d1' ? { ...x, estTokens: 30_000 } : x));
    const p = plan(c);
    assert.equal(p.outcome, 'OK');
    assert.ok(p.usedTokens <= 60_000 - DEFAULT_CONTEXT_POLICY.frameTokens);
    assert.ok(p.selected.some((x) => x.candidate.key === 'conversation'), 'the history is not displaced by an oversized item');
  });

  test('the LAYERED order (every Work Item without CP-1) keeps its selection: the flag changes nothing there', () => {
    const c = saturated();
    const flagged = plan(c, undefined, 24_000).selected.map((x) => x.candidate.key);
    const plain = plan(unflag(c), undefined, 24_000).selected.map((x) => x.candidate.key);
    assert.deepEqual(flagged, plain);
  });
});
