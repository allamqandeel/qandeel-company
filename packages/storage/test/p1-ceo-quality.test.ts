/**
 * P1-CEO-QUALITY-CORR-01 C (D-P1-09) — the CEO's Arabic in the direct Founder conversation. The style rule travels the real
 * send → reply Work Item → claimed run → assembled context path (no model, no provider call):
 *   - a direct CEO turn carries the language guidance once, right after the conversation guidance it refines;
 *   - another Employee's reply and a CEO brief never carry it (their contexts are unchanged);
 *   - the rule covers natural Egyptian Arabic, professional MSA for formal documents, no habitual honorific, no literal
 *     translation, plain terms, and facts kept apart from interpretation, hypotheses and recommendations;
 *   - it lives in the conversation seam (D-P1-05), never in the identity kernel: the CEO's approved kernel is unchanged.
 * A prompt rule cannot guarantee every future model output; this proves the rule reaches the model. Synthetic text only.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';
import { CEO_IDENTITY_PROFILE_V1 } from '@qandeel-company/mind';

import { CommunicationStore } from '../src/index.js';
import { CEO_CONVERSATION_GUIDANCE, CEO_LANGUAGE_GUIDANCE } from '../src/mind-writes.js';
import { assembleContext, type AssembleResult } from '../src/runtime-authority.js';
import { seed, type Seed } from './c2-helpers.js';
import { claimItem, placed } from './c4-helpers.js';
import { harness, type Harness } from './helpers.js';

const BODY = 'SYNTHETIC: يا أحمد، إيه رأيك نبدأ بتعيين رئيس قسم المنتج الأسبوع ده؟';

function withSeed(fn: (h: Harness, s: Seed) => void): void {
  const h = harness();
  try {
    fn(h, seed(h.store));
  } finally {
    h.close();
  }
}

const systemText = (r: AssembleResult): string => (r.outcome === 'OK' ? r.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '');
const assembled = (h: Harness, workItemId: Id, worker: string): AssembleResult => assembleContext(h.store, claimItem(h, workItemId, worker).fence, { step: 0 });
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

describe('P1-CEO-QUALITY-CORR-01 C: the CEO writes natural, correct Arabic and keeps facts apart from hypotheses', () => {
  test('a direct CEO turn carries the language guidance once, right after the conversation guidance', () => {
    withSeed((h, s) => {
      placed(h, s, 'company.ceo');
      const comm = CommunicationStore.for(h.store);
      const sent = comm.send(s.founder, comm.directThread(s.founder, null).id, { purpose: 'QUESTION', body: BODY });
      const ctx = assembled(h, sent.replyWorkItemId as Id, 'w-ceo-lang');
      assert.equal(ctx.outcome, 'OK');
      const sys = systemText(ctx);
      assert.equal(count(sys, CEO_LANGUAGE_GUIDANCE), 1, 'in the governed preamble, once');
      assert.ok(sys.indexOf(CEO_CONVERSATION_GUIDANCE) < sys.indexOf(CEO_LANGUAGE_GUIDANCE), 'it refines the conversation guidance');
    });
  });

  test('another Employee and a CEO brief keep their exact contexts (no language guidance)', () => {
    withSeed((h, s) => {
      placed(h, s, 'company.ceo');
      const director = placed(h, s, 'director.product');
      const comm = CommunicationStore.for(h.store);
      const other = comm.send(s.founder, comm.directThread(s.founder, director.id).id, { purpose: 'QUESTION', body: BODY });
      const otherCtx = assembled(h, other.replyWorkItemId as Id, 'w-director-lang');
      assert.equal(otherCtx.outcome, 'OK');
      assert.equal(systemText(otherCtx).includes(CEO_LANGUAGE_GUIDANCE), false);
      const brief = comm.requestCeoBrief({ subject: 'SYNTHETIC brief', contextKind: 'APPROVAL', contextRef: 'approval:1', reasonCode: 'brief.test', instructions: 'Brief the Founder as a MESSAGE proposal with purpose BRIEF.' });
      const briefCtx = assembled(h, brief.workItemId, 'w-ceo-brief-lang');
      assert.equal(briefCtx.outcome, 'OK');
      assert.equal(systemText(briefCtx).includes(CEO_LANGUAGE_GUIDANCE), false, 'a brief keeps its exact context');
    });
  });

  test('the rule itself: Egyptian Arabic in conversation, MSA for formal documents, no habitual honorific or literal translation, plain terms, facts apart from hypotheses, no stalling', () => {
    const g = CEO_LANGUAGE_GUIDANCE;
    for (const must of [
      'natural, polished Egyptian Arabic',
      'correct spelling and grammar',
      'clear, direct, friendly and confident',
      '«يا فندم» is at most occasional, never a habit or the opening of every reply',
      'never flattery',
      'not English translated word for word',
      'say what it means in plain words the first time',
      'professional Modern Standard Arabic',
      'a verified fact (and its source), your interpretation, a business hypothesis still to test, and your recommendation',
      'never present a hypothesis, an estimate or a projection as an established result',
      'finish what can be finished',
      'within the 4000-character body',
    ]) assert.ok(g.includes(must), must);
    assert.ok(g.length <= 2_000, 'a bounded addition to the preamble');
  });

  test('it lives in the conversation seam, never in the approved identity kernel (no certification-bearing profile change)', () => {
    const kernel = CEO_IDENTITY_PROFILE_V1.identityKernel;
    assert.equal(kernel.includes('Egyptian'), false);
    assert.equal(kernel.includes('يا فندم'), false);
    // The kernel text is byte-for-byte the one on main before this change (P1-CEO-CONVERSATION-UX-01 left it untouched too).
    assert.equal(createHash('sha256').update(kernel).digest('hex'), 'caab7a452326b90920b6caccde5639c3926c54b76f4b22b24808cb96638a0cbf');
    assert.equal(CEO_IDENTITY_PROFILE_V1.code, 'ceo-constitution-v1');
  });
});
