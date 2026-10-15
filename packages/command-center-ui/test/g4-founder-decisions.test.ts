/**
 * G4-FINAL-CLOSURE-01 (D-P1-17) — recording a Founder decision from the Founder's own message (the surface model).
 *
 * Nothing here records anything: the cue only highlights "Record as decision" on explicit, first-person decision wording
 * (and chooses the action it opens with); a question, an opinion request, a hypothetical, a proposal to discuss or a
 * quotation of someone else is never cued. The draft keeps the Founder's words whole (bounded, never cut silently), and the
 * request is the structured governed preview the Founder confirms.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DECISION_STATEMENT_MAX, decisionCue, decisionOfMessage, decisionRequest, draftProblem, newDecisionDraft, type DecisionRecord } from '../src/model/decisions.js';

const inForce: DecisionRecord = { id: 'k1', decisionKey: 'founder-decision.0123456789abcdef', decisionVersion: 1, subject: 'ميزانية التسويق للربع الجاي', statement: '40,000 جنيه، سارة مسؤولة.', audience: 'CEO', dataClass: 'D2', status: 'ACTIVE', inForce: true, sourceMessageId: 'm1', supersedesId: null, supersededById: null, recordedAt: '2026-10-15T06:00:00.000Z', version: 1 };

describe('G4-FINAL-CLOSURE-01: decision cues (deterministic; they never record)', () => {
  test('S10: discussion, questions, proposals, hypotheticals and quotations are never cued', () => {
    for (const body of [
      'إيه رأيك في ميزانية 40 ألف؟',
      'ممكن نفكر في تعيين سارة.',
      'خلينا نناقش الموضوع.',
      'سارة قالت: «اعتمدت الحملة».',
      '> I approve the campaign.\nده كلام الوكالة.',
      'لو اعتمدنا 40 ألف هيحصل إيه',
      'فكّرني، اتفقنا على إيه بالظبط في موضوع ميزانية التسويق؟',
      'What do you think about a 40,000 budget?',
      'Should we raise the cap?',
      'تمام، شكرًا يا أحمد.',
    ]) assert.equal(decisionCue(body), null, body);
  });

  test('explicit decisions are cued — record, amend, revoke', () => {
    assert.equal(decisionCue('اعتمدت ميزانية التسويق 40 ألف.'), 'RECORD');
    assert.equal(decisionCue('قررت تكليف سارة بالمهمة.'), 'RECORD');
    assert.equal(decisionCue('قررنا الأسبوع اللي فات إن ميزانية التسويق للربع الجاي 40 ألف جنيه بالظبط، وإن سارة مدير النمو هي المسؤولة عنها، وأي زيادة ترجع لي.'), 'RECORD');
    assert.equal(decisionCue('I approve the 40,000 marketing budget for next quarter.'), 'RECORD');
    assert.equal(decisionCue('عدّل الميزانية من 40 إلى 30 ألف.'), 'AMEND');
    assert.equal(decisionCue('Change the marketing budget from 40,000 to 30,000.'), 'AMEND');
    assert.equal(decisionCue('ألغي القرار السابق.'), 'REVOKE');
    assert.equal(decisionCue('I revoke the decision on the agency.'), 'REVOKE');
  });
});

describe('G4-FINAL-CLOSURE-01: the draft and the governed request', () => {
  test('a new decision: the message prefilled whole, a subject required, D2 and the CEO by default', () => {
    const d = newDecisionDraft('m9', '  اعتمدت ميزانية التسويق 40 ألف.  ', []);
    assert.deepEqual([d.mode, d.statement, d.audience, d.dataClass, d.targetId], ['RECORD', 'اعتمدت ميزانية التسويق 40 ألف.', 'CEO', 'D2', null]);
    assert.equal(draftProblem(d), 'Give the decision a short subject.');
    d.subject = 'ميزانية التسويق';
    assert.equal(draftProblem(d), null);
    assert.deepEqual(decisionRequest(d), { intent: 'FOUNDER_DECISION_RECORD', payload: { messageId: 'm9', subject: 'ميزانية التسويق', statement: 'اعتمدت ميزانية التسويق 40 ألف.', audience: 'CEO', dataClass: 'D2' } });
  });

  test('an amendment or a revocation targets a decision in force; with none, the draft is a new decision', () => {
    const amend = newDecisionDraft('m10', 'عدّل الميزانية من 40 إلى 30 ألف.', [inForce]);
    assert.deepEqual([amend.mode, amend.targetId, amend.subject], ['AMEND', 'k1', inForce.subject]);
    assert.deepEqual(decisionRequest(amend).payload.supersedesId, 'k1');
    const revoke = newDecisionDraft('m11', 'ألغي القرار السابق.', [inForce]);
    assert.deepEqual(decisionRequest(revoke), { intent: 'FOUNDER_DECISION_REVOKE', payload: { decisionId: 'k1', messageId: 'm11' } });
    assert.equal(newDecisionDraft('m12', 'ألغي القرار السابق.', []).mode, 'RECORD');
  });

  test('a decision longer than the bound is refused before the preview, never cut', () => {
    const d = newDecisionDraft('m13', 'x'.repeat(DECISION_STATEMENT_MAX + 5), []);
    d.subject = 'subject';
    assert.match(String(draftProblem(d)), /at most 1500 characters \(now 1505\)/);
    assert.equal(d.statement.length, DECISION_STATEMENT_MAX + 5, 'the words stay whole');
  });

  test('what a message already holds is said truthfully: in force, replaced or revoked', () => {
    assert.equal(decisionOfMessage([inForce], 'm1')?.label, 'Recorded decision v1 · in force');
    assert.equal(decisionOfMessage([{ ...inForce, status: 'SUPERSEDED', inForce: false }], 'm1')?.label, 'Recorded decision v1 · replaced by a later version');
    assert.equal(decisionOfMessage([{ ...inForce, status: 'ARCHIVED', inForce: false }], 'm1')?.label, 'Recorded decision v1 · revoked');
    assert.equal(decisionOfMessage([inForce], 'other'), null);
  });
});
