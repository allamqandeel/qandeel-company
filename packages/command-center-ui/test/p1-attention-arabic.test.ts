/**
 * P1-EMPLOYEE-BASELINE-01 C (D-P1-10) — the Founder Attention card's own words are Arabic, and nothing else is:
 *   - every case the card renders is inventoried, and each has fixed Arabic words (no model call), with names, titles and
 *     risk codes inserted exactly as they are;
 *   - the held-money card states the Founder's wording: check billing first, never assume spent or not spent;
 *   - the panel title, the lane tabs, every button and its structured act (intent and payload keys), and the company map's
 *     labels stay English and unchanged.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ATTENTION_CASES, BRIEF_LABEL_AR, HELD_RESERVATION_AR, attentionAskAr, attentionCase, attentionKindAr, type AttentionCase } from '../src/model/attention-text.js';
import { LANE_LABEL, SOURCE_LABEL } from '../src/model/format.js';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const panels = readFileSync(path.join(srcDir, 'app', 'panels.ts'), 'utf8');
const card = panels.slice(panels.indexOf('function attentionItem('), panels.indexOf('// --- context sheet: employee'));

const names = { nameOf: (ref: string) => (ref === 'employee:e1' ? 'Ahmed Zaki' : ref === 'employee:e2' ? 'منى فوزي' : ref), workTitleOf: (id: string) => (id === 'w1' ? 'Q3 plan' : null) };

/** One synthetic attention item per case, shaped as `/api/attention` sends it. */
const ITEMS: Readonly<Record<AttentionCase, Record<string, unknown>>> = {
  APPROVAL: { sourceKind: 'APPROVAL', approval: { id: 'a1', action: 'tool.invoke', risk: 'R2', subjectRef: 'employee:e1' } },
  GOAL: { sourceKind: 'GOAL', goal: { id: 'g1', title: 'Launch in Egypt' } },
  STAFFING: { sourceKind: 'STAFFING_REQUEST', staffing: { id: 's1', positionTitle: 'Director, Product', ceoRecommendation: 'APPROVE' } },
  ESCALATION: { sourceKind: 'ESCALATION', escalation: { id: 'd1', childWorkItemId: 'w1' } },
  CONFLICT: { sourceKind: 'REVIEW_CONFLICT', conflict: { id: 'c1' } },
  UNCERTAIN_EFFECT: { sourceKind: 'DECISION_REQUEST', uncertainEffect: { id: 't1' } },
  HELD_RESERVATION: { sourceKind: 'DECISION_REQUEST', heldReservation: { id: 'r1', workItemId: 'w1', purpose: 'MODEL_CALL' } },
  HELD_JOB: { sourceKind: 'DECISION_REQUEST', heldJob: { id: 'j1', workItemId: 'w-unknown' } },
  REVIEW_ESCALATION: { sourceKind: 'DECISION_REQUEST', reviewEscalation: { id: 'q1', workItemId: 'w1', risk: 'R2' } },
  SYSTEMIC: { sourceKind: 'DECISION_REQUEST', systemic: { id: 'f1', state: 'CANDIDATE' } },
  JUDGMENT: { sourceKind: 'DECISION_REQUEST', judgment: { subjectKind: 'LESSON', subjectId: 'l1' } },
  OUTCOME: { sourceKind: 'DECISION_REQUEST', outcome: { workItemId: 'w1' } },
  MESSAGE: { sourceKind: 'THREAD', ownerRef: 'employee:e2', message: { id: 'm1', threadId: 'th1', purpose: 'QUESTION', body: 'Original text, kept as written', brief: null } },
  BRIEF: { sourceKind: 'BRIEF', ownerRef: 'employee:e1', message: { id: 'm2', threadId: 'th2', purpose: 'BRIEF', body: '', brief: { happening: 'x', matters: 'y', recommendation: 'z', decisionNeeded: true } } },
  NOTICE: { sourceKind: 'DECISION_REQUEST', resilience: { exceptions: ['DRILL_FAILED'] } },
};

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

describe('P1-EMPLOYEE-BASELINE-01 C: Founder Attention card texts in Arabic', () => {
  test('every card case is inventoried and recognised, and its kind and ask are Arabic; the system words carry no English', () => {
    assert.deepEqual(Object.keys(ITEMS), [...ATTENTION_CASES], 'the inventory is complete and ordered as the card tests it');
    for (const c of ATTENTION_CASES) {
      const i = ITEMS[c];
      assert.equal(attentionCase(i), c);
      const kind = attentionKindAr(i);
      assert.ok(ARABIC.test(kind) && !LATIN.test(kind), `${c} kind: ${kind}`);
      const parts = attentionAskAr(i, names);
      assert.ok(parts.length > 0, c);
      for (const p of parts.filter((x) => !x.content)) {
        // Fixed words are Arabic; the only Latin a fixed part may carry is a data code inserted as is (the risk level).
        assert.ok(ARABIC.test(p.text), `${c}: ${p.text}`);
        assert.equal(LATIN.test(p.text.replace(/\bR[0-4]\b/g, '')), false, `${c} has no English words: ${p.text}`);
      }
    }
  });

  test('names, titles and codes are inserted exactly as they are (company content keeps its own language)', () => {
    const text = (c: AttentionCase): string => attentionAskAr(ITEMS[c], names).map((p) => p.text).join('');
    assert.ok(text('APPROVAL').includes('R2') && text('APPROVAL').endsWith('Ahmed Zaki'));
    assert.ok(text('GOAL').includes('Launch in Egypt'));
    assert.ok(text('STAFFING').includes('Director, Product') && text('STAFFING').includes('بيوصي بالموافقة'));
    assert.ok(text('ESCALATION').includes('Q3 plan'));
    assert.ok(text('HELD_JOB').includes('مهمة'), 'an unknown title is named in words, never invented');
    assert.ok(text('MESSAGE').startsWith('سؤال من ') && text('MESSAGE').endsWith('منى فوزي'));
    const content = attentionAskAr(ITEMS.APPROVAL, names).filter((p) => p.content).map((p) => p.text);
    assert.deepEqual(content, ['Ahmed Zaki'], 'a name is a content part (its own direction), never fixed text');
  });

  test('held money: the Founder\'s wording — check billing before releasing, never assume spent or not spent', () => {
    const parts = attentionAskAr(ITEMS.HELD_RESERVATION, names);
    assert.equal(parts.map((p) => p.text).join(''), 'فيه مبلغ محجوز مقابل استدعاء لم تتأكد فاتورته. راجع الفوترة قبل تحرير الحجز، وما تعتبرش المبلغ مصروفًا أو غير مصروف من غير دليل.');
    assert.deepEqual(HELD_RESERVATION_AR, ['فيه مبلغ محجوز مقابل استدعاء لم تتأكد فاتورته.', 'راجع الفوترة قبل تحرير الحجز، وما تعتبرش المبلغ مصروفًا أو غير مصروف من غير دليل.']);
    assert.equal(panels.includes('release it if nothing was billed'), false, 'the old suggestion to release is gone');
  });

  test('the brief headings are Arabic; a brief\'s own text is not translated', () => {
    for (const v of Object.values(BRIEF_LABEL_AR)) assert.ok(ARABIC.test(v) && !LATIN.test(v), v);
    assert.ok(card.length > 0);
    assert.match(panels, /row\(BRIEF_LABEL_AR\.happening, String\(brief\.happening\)\)/);
  });

  test('only the card text is Arabic: buttons, their structured acts, the panel title, the tabs and the map labels are unchanged', () => {
    const buttons = [...card.matchAll(/act\('([^']+)', '([A-Z_]+)'/g)].map((m) => `${m[1]}→${m[2]}`);
    assert.deepEqual(buttons, [
      'Approve→APPROVAL_DECIDE', 'Reject→APPROVAL_DECIDE', 'Approve goal→GOAL_APPROVE', 'Approve→STAFFING_DECIDE', 'Reject→STAFFING_DECIDE',
      'Pass→CONFLICT_RESOLVE', 'Rework→CONFLICT_RESOLVE', 'Confirm executed→TOOL_RECONCILE', 'Confirm not executed→TOOL_RECONCILE',
      'Release (nothing billed)→RESERVATION_RECONCILE', 'Confirm completed→JOB_RECONCILE', 'Retry→JOB_RECONCILE', 'Mark failed→JOB_RECONCILE',
      'Pass→REVIEW_ESCALATION_RESOLVE', 'Rework→REVIEW_ESCALATION_RESOLVE', 'Validate→SYSTEMIC_DECIDE', 'Reject→SYSTEMIC_DECIDE',
    ]);
    for (const label of ["text: 'Reply'", "text: 'Show in company'", "text: 'Dismiss'"]) assert.ok(card.includes(label), label);
    assert.ok(panels.includes("text: 'Founder attention'"));
    assert.deepEqual(LANE_LABEL, { NEEDS_ME: 'Needs me', CEO_BRIEFS: 'CEO briefs', THREADS: 'Conversations' });
    assert.equal(SOURCE_LABEL.APPROVAL, 'Approval', 'the company map keeps its English labels');
    // The RTL direction is set on the card's Arabic text only, never on the panel or the card itself.
    assert.match(card, /h\('p', \{ class: 'rail-ask is-arabic', dir: 'rtl', lang: 'ar' \}\)/);
    assert.equal(/class: `rail-item[^`]*`[^)]*dir:/.test(card), false);
  });
});
