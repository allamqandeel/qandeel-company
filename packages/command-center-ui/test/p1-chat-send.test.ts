/**
 * P1-CHAT-INTEL-01 / CORR-02 — a send settles only the conversation it started from. The Founder can switch from A to B
 * while A's send is in flight: A's success clears A's draft only, A's failure keeps A's draft and its retry key only, and
 * B's text, level, mode, sending state and error are never touched. The key belongs to the exact request, so a retry never
 * duplicates and a changed request never collides.
 *
 * The harness mirrors the Chat screen: one shared composer shows the current conversation; a result is applied to the
 * composer only while its conversation is the one shown. The server is a fake that records each key once (replaying it),
 * as the real store does.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MESSAGE_MAX_CHARS, MESSAGE_NEAR_CHARS, beginSend, composerLength, editDraft, pasteNotice, sendState, settleFailed, settleSent, type DraftStore, type SendState, type SendTicket, type StoredDraft } from '../src/model/chat-send.js';

class MapDrafts implements DraftStore {
  readonly m = new Map<string, StoredDraft>();
  get(threadId: string): StoredDraft {
    return this.m.get(threadId) ?? { text: '', key: null, sig: null };
  }
  set(threadId: string, d: StoredDraft): void {
    if (d.text === '') this.m.delete(threadId);
    else this.m.set(threadId, d);
  }
}

interface Pending {
  readonly ticket: SendTicket;
  resolve(): void;
  reject(e: { status: number } | Error): void;
}

/** A fake server: one message per key (a replay returns it), per thread. */
class Server {
  readonly messages: { threadId: string; key: string; body: string }[] = [];
  readonly pending: Pending[] = [];
  post(ticket: SendTicket): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({
        ticket,
        resolve: () => {
          if (!this.messages.some((m) => m.key === ticket.key)) this.messages.push({ threadId: ticket.threadId, key: ticket.key, body: ticket.body });
          resolve();
        },
        reject,
      });
    });
  }
  /** The response is lost after the server recorded the message (a dropped connection). */
  lose(p: Pending): void {
    if (!this.messages.some((m) => m.key === p.ticket.key)) this.messages.push({ threadId: p.ticket.threadId, key: p.ticket.key, body: p.ticket.body });
    p.reject(new Error('connection lost'));
  }
  bodies(threadId: string): string[] {
    return this.messages.filter((m) => m.threadId === threadId).map((m) => m.body);
  }
}

class Screen {
  readonly drafts = new MapDrafts();
  readonly server = new Server();
  readonly convs = new Map<string, SendState>();
  shown: SendState | null = null;
  /** The shared composer. */
  text = '';
  error = '';
  sendLabel = 'Send';
  #n = 0;
  open(threadId: string): SendState {
    let c = this.convs.get(threadId);
    if (!c) {
      c = sendState(threadId, this.drafts.get(threadId));
      this.convs.set(threadId, c);
    }
    this.shown = c;
    this.#paint(c);
    return c;
  }
  close(): void {
    // Closing only hides the screen: the conversation and its send stay.
  }
  type(text: string): void {
    const c = this.shown as SendState;
    if (c.sending) return; // the composer is read-only while its own send is in flight
    this.text = text;
    editDraft(c, text, this.drafts);
  }
  #paint(c: SendState): void {
    this.text = c.draft;
    this.error = c.error ?? '';
    this.sendLabel = c.sending ? 'Sending…' : c.mode === 'ASK' ? 'Send' : 'Save note';
  }
  submit(): Promise<void> {
    const c = this.shown as SendState;
    const ticket = beginSend(c, this.drafts, () => `key-${++this.#n}`);
    if (!ticket) return Promise.resolve();
    this.#paint(c);
    return this.server.post(ticket).then(
      () => {
        settleSent(c, ticket, this.drafts);
        if (this.shown === c) this.#paint(c);
      },
      (e: { status?: number }) => {
        const refused = typeof e.status === 'number' && e.status >= 400 && e.status < 500;
        settleFailed(c, ticket, this.drafts, { refused, message: refused ? 'Not sent' : 'Not confirmed' });
        if (this.shown === c) this.#paint(c);
      },
    );
  }
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('CORR-02: a chat send is bound to its own conversation', () => {
  test('send A, switch to B before it completes, A succeeds: B\'s draft, level, mode and composer are intact; A is cleared', async () => {
    const s = new Screen();
    const a = s.open('A');
    s.type('hello A');
    a.level = 'E2';
    const done = s.submit();
    const b = s.open('B');
    s.type('draft B');
    b.level = 'E1';
    b.mode = 'NOTE';
    s.server.pending[0]?.resolve();
    await done;
    assert.deepEqual([s.text, s.error, s.sendLabel], ['draft B', '', 'Send'], 'B on screen is untouched (never "Sending…" or cleared by A)');
    assert.deepEqual([b.draft, b.level, b.mode, b.sending, b.key], ['draft B', 'E1', 'NOTE', false, null]);
    assert.deepEqual(s.drafts.get('B'), { text: 'draft B', key: null, sig: null });
    assert.deepEqual([a.draft, a.key, a.level, a.sending], ['', null, null, false], 'A alone is cleared');
    assert.equal(s.drafts.m.has('A'), false);
    // Back to A: the message exists once and the sent draft is gone.
    s.open('A');
    assert.deepEqual([s.text, s.server.bodies('A')], ['', ['hello A']]);
  });

  test('the same race with A failing: A keeps its message and retry key, B is unaffected, and the retry never duplicates', async () => {
    const s = new Screen();
    const a = s.open('A');
    s.type('hello A');
    const done = s.submit();
    const keyA = a.key;
    s.open('B');
    s.type('draft B');
    s.server.lose(s.server.pending[0] as Pending);
    await done;
    assert.deepEqual([s.text, s.error], ['draft B', ''], 'A\'s failure is not shown on B');
    assert.deepEqual([a.draft, a.key, a.error, a.sending], ['hello A', keyA, 'Not confirmed', false]);
    assert.deepEqual(s.drafts.get('A'), { text: 'hello A', key: keyA, sig: a.keySig });
    // Back to A: its draft and error come back; sending again reuses the key and the server replays (one message).
    s.open('A');
    assert.deepEqual([s.text, s.error], ['hello A', 'Not confirmed']);
    const retry = s.submit();
    assert.equal(s.server.pending[1]?.ticket.key, keyA);
    s.server.pending[1]?.resolve();
    await retry;
    assert.deepEqual([s.server.bodies('A'), s.text, a.key], [['hello A'], '', null]);
  });

  test('a refused send keeps the draft but drops its key; an edited request gets a new key (never a key conflict)', async () => {
    const s = new Screen();
    const a = s.open('A');
    s.type('first');
    const one = s.submit();
    const k1 = a.key;
    s.server.pending[0]?.reject({ status: 409 });
    await one;
    assert.deepEqual([a.draft, a.key, a.error], ['first', null, 'Not sent']);
    s.type('first, edited');
    const two = s.submit();
    assert.notEqual(s.server.pending[1]?.ticket.key, k1);
    // A changed level is a different request: a new key too.
    s.server.lose(s.server.pending[1] as Pending);
    await two;
    const kept = a.key;
    a.level = 'E2';
    const three = s.submit();
    assert.notEqual(s.server.pending[2]?.ticket.key, kept);
    s.server.pending[2]?.resolve();
    await three;
  });

  test('two overlapping sends for different Employees never mix messages, keys or composer state', async () => {
    const s = new Screen();
    const a = s.open('A');
    s.type('to A');
    const sa = s.submit();
    const b = s.open('B');
    s.type('to B');
    const sb = s.submit();
    assert.notEqual(a.key, b.key);
    assert.deepEqual([s.server.pending[0]?.ticket.threadId, s.server.pending[1]?.ticket.threadId], ['A', 'B']);
    // B completes first, then A fails, while B is shown.
    s.server.pending[1]?.resolve();
    await sb;
    assert.deepEqual([s.text, s.sendLabel, b.draft], ['', 'Send', '']);
    s.server.pending[0]?.reject({ status: 400 });
    await sa;
    assert.deepEqual([s.text, s.error], ['', ''], 'A\'s refusal never reaches B\'s composer');
    assert.deepEqual([a.draft, a.error], ['to A', 'Not sent']);
    assert.deepEqual([s.server.bodies('A'), s.server.bodies('B')], [[], ['to B']]);
  });

  test('closing and reopening the chat while a send is in flight loses no draft and duplicates nothing', async () => {
    const s = new Screen();
    const a = s.open('A');
    s.type('in flight');
    const done = s.submit();
    s.close();
    s.open('A');
    assert.deepEqual([s.text, s.sendLabel], ['in flight', 'Sending…'], 'the same conversation, still sending');
    await s.submit();
    await flush();
    assert.equal(s.server.pending.length, 1, 'a second submit while sending sends nothing');
    s.server.pending[0]?.resolve();
    await done;
    assert.deepEqual([s.text, a.draft, s.server.bodies('A')], ['', '', ['in flight']]);
  });

  test('a settled ticket never applies to another conversation', () => {
    const drafts = new MapDrafts();
    const a = sendState('A', drafts.get('A'));
    editDraft(a, 'x', drafts);
    const ticket = beginSend(a, drafts, () => 'k-1') as SendTicket;
    const b = sendState('B', drafts.get('B'));
    assert.throws(() => settleSent(b, ticket, drafts), /only the conversation it started from/);
    assert.throws(() => settleFailed(b, ticket, drafts, { refused: true, message: '' }), /only the conversation it started from/);
  });
});

/**
 * P1-CEO-QUALITY-CORR-01 D (D-P1-09) — long messages are never cut. The browser's maxlength used to drop the end of a long
 * paste silently; now the composer counts exactly as the server does (the trimmed body's UTF-16 length, at most 4,000),
 * warns near the limit, says when a paste took the message over it, and refuses to send an over-limit draft while keeping
 * every character of it. Drafts, keys and the one-message level are untouched by the refusal.
 */
describe('P1-CEO-QUALITY-CORR-01 D: the composer count, paste safety and the 4,000-character limit', () => {
  const arabic = (n: number): string => 'ق'.repeat(n);

  test('the count is the server\'s count: trimmed, UTF-16 units (an Arabic letter is one, an emoji two), with a near warning and an over state', () => {
    assert.equal(MESSAGE_MAX_CHARS, 4000);
    assert.deepEqual(composerLength(''), { count: 0, max: 4000, state: 'OK', label: '' });
    assert.deepEqual([composerLength('  مرحبا  ').count, composerLength('  مرحبا  ').label], [5, '5 / 4,000']);
    assert.equal(composerLength('🙂').count, 2, 'what the server counts');
    assert.equal(composerLength(arabic(MESSAGE_NEAR_CHARS - 1)).state, 'OK');
    assert.deepEqual([composerLength(arabic(3600)).state, composerLength(arabic(3600)).label], ['NEAR', '3,600 / 4,000 characters — close to the limit']);
    assert.equal(composerLength(arabic(4000)).state, 'NEAR', 'exactly the limit is still sendable');
    const over = composerLength(arabic(4321));
    assert.equal(over.state, 'OVER');
    assert.equal(over.label, '4,321 / 4,000 characters — 321 over the limit. Nothing was cut: shorten it, or send it as two messages.');
    assert.equal(composerLength(`   ${arabic(4000)}\n\n  `).state, 'NEAR', 'surrounding whitespace is not sent, so it is not counted');
  });

  test('a paste that takes the message over the limit is announced; one that fits, or a draft already over, is not', () => {
    assert.equal(pasteNotice(arabic(3000), arabic(5200)), 'The pasted text made the message 5,200 characters, over the 4,000 limit. All of it is kept in the box — nothing was cut.');
    assert.equal(pasteNotice('', arabic(3999)), null);
    assert.equal(pasteNotice(arabic(4100), arabic(4200)), null, 'the count already says it is over');
  });

  test('an over-limit draft is never sent and never cut: no ticket, no key, the whole text kept, the reason given; shortening it clears the reason and it sends', () => {
    const drafts = new MapDrafts();
    const s = sendState('A', drafts.get('A'));
    const long = `${arabic(4100)} النهاية`;
    editDraft(s, long, drafts);
    assert.equal(beginSend(s, drafts, () => 'k-never'), null, 'nothing is sent');
    assert.deepEqual([s.draft, drafts.get('A').text], [long, long], 'every character stays, in memory and in the session draft');
    assert.deepEqual([s.key, s.sending], [null, false], 'no key was minted for a request that was never made');
    assert.equal(s.error, 'Not sent — the message is 4,108 characters; the limit is 4,000. Your whole text is kept: shorten it, or send it as two messages.');
    editDraft(s, arabic(4050), drafts);
    assert.ok(s.error !== null, 'still over: the reason stays');
    editDraft(s, arabic(3990), drafts);
    assert.equal(s.error, null, 'it fits again: the reason is gone');
    const ticket = beginSend(s, drafts, () => 'k-1') as SendTicket;
    assert.deepEqual([ticket.body.length, ticket.key], [3990, 'k-1'], 'the exact text the Founder sees is what is sent');
  });

  test('a network failure is unaffected: its message stays while the Founder edits, and the retry replays the same key', () => {
    const drafts = new MapDrafts();
    const s = sendState('A', drafts.get('A'));
    editDraft(s, 'رسالة قصيرة', drafts);
    const t1 = beginSend(s, drafts, () => 'k-1') as SendTicket;
    settleFailed(s, t1, drafts, { refused: false, message: 'Not confirmed — the connection failed.' });
    editDraft(s, 'رسالة قصيرة', drafts);
    assert.equal(s.error, 'Not confirmed — the connection failed.', 'only the length refusal clears on edit');
    const t2 = beginSend(s, drafts, () => 'k-2') as SendTicket;
    assert.equal(t2.key, 'k-1', 'the same request keeps its key: no duplicate');
  });
});
