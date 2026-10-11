/**
 * P1-CHAT-REFS-CORR-01 — the message fence re-checks the runtime's claim that a Founder reply's malformed references were
 * discarded: only a reply to one Founder message, a count of 1..8 within the reference bound, and kept references in the
 * closed grammar. The discard is recorded content-free, in the same transaction as the message and only with it. The fence's
 * other rules (thread, body bounds, secret material, idempotency) are unchanged.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';

import { CommunicationStore } from '../src/index.js';
import { recordMessage, settle } from '../src/runtime-authority.js';
import { seed } from './c2-helpers.js';
import { claimItem, placed } from './c4-helpers.js';
import { backoff, harness, type Harness } from './helpers.js';

const base = { purpose: 'RESULT' as const, attentionLevel: 'INFORMATIONAL' as const, brief: null };
const discards = (h: Harness): Record<string, unknown>[] => h.store.auditByAction('communication.message_refs_discarded').map((a) => ({ outcome: a.outcome, reason: a.reasonCode, ...a.details }));

function withReply(fn: (h: Harness, x: { reply: Id; thread: Id; comm: CommunicationStore }) => void): void {
  const h = harness();
  try {
    const s = seed(h.store);
    placed(h, s, 'company.ceo');
    const comm = CommunicationStore.for(h.store);
    const thread = comm.directThread(s.founder, null);
    const sent = comm.send(s.founder, thread.id, { purpose: 'QUESTION', body: 'Where does the product stand?' });
    fn(h, { reply: sent.replyWorkItemId as Id, thread: thread.id, comm });
  } finally {
    h.close();
  }
}

describe('P1-CHAT-REFS-CORR-01: the message fence and a discarded reference', () => {
  test('a Founder reply records the message with only its valid references and one content-free CHAT_REFS_DISCARDED row', () =>
    withReply((h, { reply, thread, comm }) => {
      const claim = claimItem(h, reply, 'w-refs');
      const out = recordMessage(h.store, claim.fence, { ...base, body: 'Cited in the body: docs/ROADMAP.md @ 1a2b3c4.', contextRefs: ['memory:abc123'], refsDiscarded: 2 });
      assert.deepEqual([out.outcome, out.code], ['RECORDED', 'RECORDED']);
      const m = comm.messages(thread).find((x) => x.senderKind === 'EMPLOYEE');
      assert.ok(m);
      assert.deepEqual([m.body, m.contextRefs], ['Cited in the body: docs/ROADMAP.md @ 1a2b3c4.', ['memory:abc123']], 'the body is the output\'s; only valid references are kept');
      assert.deepEqual(discards(h), [{ outcome: 'OK', reason: 'CHAT_REFS_DISCARDED', messageId: m.id, runId: claim.fence.runId, discarded: 2, kept: 1 }]);
      // A replay of the same body is the same message and records nothing more.
      const again = recordMessage(h.store, claim.fence, { ...base, body: 'Cited in the body: docs/ROADMAP.md @ 1a2b3c4.', contextRefs: ['memory:abc123'], refsDiscarded: 2 });
      assert.deepEqual([again.code, again.messageId, discards(h).length], ['REPLAYED', m.id, 1]);
      assert.equal(JSON.stringify(h.store.auditByAction('communication.message_refs_discarded')).includes('ROADMAP'), false, 'content-free (Rule A)');
      settle(h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
    }));

  test('a claim the fence cannot verify is refused with nothing recorded', () =>
    withReply((h, { reply, thread, comm }) => {
      const claim = claimItem(h, reply, 'w-refs');
      const refused: [string, Parameters<typeof recordMessage>[2]][] = [
        ['zero', { ...base, body: 'a', contextRefs: [], refsDiscarded: 0 }],
        ['negative', { ...base, body: 'b', contextRefs: [], refsDiscarded: -1 }],
        ['fraction', { ...base, body: 'c', contextRefs: [], refsDiscarded: 1.5 }],
        ['over the bound', { ...base, body: 'd', contextRefs: ['memory:a'], refsDiscarded: 8 }],
        ['a kept path', { ...base, body: 'e', contextRefs: ['docs/ROADMAP.md'], refsDiscarded: 1 }],
      ];
      for (const [why, input] of refused) assert.deepEqual([recordMessage(h.store, claim.fence, input).code], ['INVALID_ARGS'], why);
      // Secret material is still refused first by the unchanged scan, discard or not.
      const secret = ['Bearer ', 'abcdefghjkmnpqrstuvwxyz23456789a'].join('');
      assert.equal(recordMessage(h.store, claim.fence, { ...base, body: `key ${secret}`, contextRefs: [], refsDiscarded: 1 }).code, 'SECRET_MATERIAL');
      assert.equal(comm.messages(thread).filter((x) => x.senderKind === 'EMPLOYEE').length, 0);
      assert.equal(discards(h).length, 0);
      settle(h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
    }));

  test('a CEO brief (no Founder message) never accepts a discard count; without one it records as before', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      placed(h, s, 'company.ceo');
      const comm = CommunicationStore.for(h.store);
      const b = comm.requestCeoBrief({ subject: 's', contextKind: 'APPROVAL', contextRef: 'approval:1', reasonCode: 'brief.test', instructions: 'brief' });
      const claim = claimItem(h, b.workItemId, 'w-brief');
      assert.equal(recordMessage(h.store, claim.fence, { ...base, body: 'x', contextRefs: [], refsDiscarded: 1 }).code, 'INVALID_ARGS');
      assert.equal(recordMessage(h.store, claim.fence, { ...base, body: 'x', contextRefs: ['memory:a'] }).outcome, 'RECORDED');
      assert.equal(discards(h).length, 0);
    } finally {
      h.close();
    }
  });
});
