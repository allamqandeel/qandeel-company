/**
 * P1-CEO-CONVERSATION-UX-01 (CEO-CONV-UX-01) — the direct Founder ↔ CEO conversation is told to talk naturally, through the
 * real send → reply Work Item → claimed run → assembled context path (no model, no provider call):
 *   - only a direct CEO turn carries the conversation guidance (in the governed preamble), once;
 *   - its instruction line names the reply shape only and seeds no more retrieval terms than the line it replaces;
 *   - every other Employee's reply keeps its exact line and context; a CEO brief stays a brief (no guidance, no marker);
 *   - the guidance keeps the Founder Communication Standard for real decisions and briefs, and grants nothing.
 * Synthetic fixture text only.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';
import { terms } from '@qandeel-company/mind';

import { CommunicationStore } from '../src/index.js';
import { founderReplyInstructions } from '../src/communications.js';
import { CEO_CONVERSATION_GUIDANCE, CEO_DIRECT_CONVERSATION } from '../src/mind-writes.js';
import { assembleContext, type AssembleResult } from '../src/runtime-authority.js';
import { seed, type Seed } from './c2-helpers.js';
import { claimItem, placed } from './c4-helpers.js';
import { harness, type Harness } from './helpers.js';

const OLD_LINE = 'Answer as a MESSAGE proposal in the Founder Communication Standard when a decision is involved. Communication grants no authority.';
const BODY = 'SYNTHETIC: كيف ترى فكرة مدير لاستخبارات السوق؟ and what worries you about it?';

function withSeed(fn: (h: Harness, s: Seed) => void): void {
  const h = harness();
  try {
    fn(h, seed(h.store));
  } finally {
    h.close();
  }
}

const inputOf = (h: Harness, id: Id): Record<string, unknown> => h.store.getWorkItem(id).processorInput as Record<string, unknown>;
const systemText = (r: AssembleResult): string => (r.outcome === 'OK' ? r.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '');
const assembled = (h: Harness, workItemId: Id, worker: string): AssembleResult => assembleContext(h.store, claimItem(h, workItemId, worker).fence, { step: 0 });
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

describe('P1-CEO-CONVERSATION-UX-01: the CEO converses; reports, briefs and decisions stay available', () => {
  test('a direct CEO turn carries the marker and a reply-shape line; its context holds the conversation guidance once', () => {
    withSeed((h, s) => {
      placed(h, s, 'company.ceo');
      const comm = CommunicationStore.for(h.store);
      const thread = comm.directThread(s.founder, null);
      assert.equal(thread.kind, 'FOUNDER_CEO');
      const sent = comm.send(s.founder, thread.id, { purpose: 'QUESTION', body: BODY });
      const pi = inputOf(h, sent.replyWorkItemId as Id);
      assert.equal(pi.conversation, CEO_DIRECT_CONVERSATION);
      assert.equal(pi.instructions, `Founder message (QUESTION): ${BODY}\n\nReply in this conversation as one MESSAGE proposal. Communication grants no authority.`);
      const ctx = assembled(h, sent.replyWorkItemId as Id, 'w-ceo-chat');
      assert.equal(ctx.outcome, 'OK');
      assert.equal(count(systemText(ctx), CEO_CONVERSATION_GUIDANCE), 1, 'the guidance is in the governed preamble, once');
    });
  });

  test('the CEO line seeds no more retrieval terms than the line it replaces (the Founder topic is never crowded out)', () => {
    const now = terms(founderReplyInstructions('FOUNDER_CEO', 'QUESTION', BODY));
    const before = terms(`Founder message (QUESTION): ${BODY}\n\n${OLD_LINE}`);
    assert.ok(now.length <= before.length);
    for (const t of terms(BODY)) assert.ok(now.includes(t), `the Founder's term survives: ${t}`);
  });

  test('another Employee keeps its exact line and context; a CEO brief stays a brief', () => {
    withSeed((h, s) => {
      placed(h, s, 'company.ceo');
      const director = placed(h, s, 'director.product');
      const comm = CommunicationStore.for(h.store);
      const thread = comm.directThread(s.founder, director.id);
      assert.equal(thread.kind, 'FOUNDER_EMPLOYEE');
      const sent = comm.send(s.founder, thread.id, { purpose: 'QUESTION', body: BODY });
      const pi = inputOf(h, sent.replyWorkItemId as Id);
      assert.equal(pi.conversation, undefined);
      assert.equal(pi.instructions, `Founder message (QUESTION): ${BODY}\n\n${OLD_LINE}`);
      const ctx = assembled(h, sent.replyWorkItemId as Id, 'w-director-chat');
      assert.equal(ctx.outcome, 'OK');
      assert.equal(systemText(ctx).includes(CEO_CONVERSATION_GUIDANCE), false);
      const brief = comm.requestCeoBrief({ subject: 'SYNTHETIC brief', contextKind: 'APPROVAL', contextRef: 'approval:1', reasonCode: 'brief.test', instructions: 'Brief the Founder as a MESSAGE proposal with purpose BRIEF.' });
      assert.equal(inputOf(h, brief.workItemId).conversation, undefined);
      const briefCtx = assembled(h, brief.workItemId, 'w-ceo-brief');
      assert.equal(briefCtx.outcome, 'OK');
      assert.equal(systemText(briefCtx).includes(CEO_CONVERSATION_GUIDANCE), false, 'a brief keeps its exact context');
    });
  });

  test('the guidance: natural by default, structure on request, the Standard for real decisions, judgment kept, nothing granted', () => {
    const g = CEO_CONVERSATION_GUIDANCE;
    for (const must of ["in the Founder's language and tone", 'follow where the conversation is going', 'no opening restatement of what you understood', 'Shorter never means shallower', 'your disagreement', 'Never ask again what this conversation or your context already answers', 'one question, not a list', 'when the Founder asks for one or the subject genuinely requires it', 'for briefs and real decisions, not for every turn', 'DECISION_REQUEST', 'never manufacture a decision', 'State uncertainty honestly', 'grants no authority']) assert.ok(g.includes(must), must);
    assert.ok(g.length <= 2_000, 'a bounded addition to the preamble');
  });
});
