/**
 * P1-CHAT-INTEL-01 (CORR-02) — the send and draft state of ONE conversation, with no DOM.
 *
 * A send is a ticket bound to the conversation, the draft text, the idempotency key and the level it started from. Its
 * result settles only that conversation's state: whatever the Founder opened meanwhile is never touched. The screen applies
 * a settled state to the shared composer only when that conversation is still the one shown.
 *
 * The key is bound to the exact request (body, mode, level): a retry of the same request reuses it (the server replays the
 * message already recorded, never a duplicate); a changed request gets a new key, so it is never a key conflict.
 */
import type { Level } from './intelligence.js';

export type ChatMode = 'ASK' | 'NOTE';

export interface StoredDraft {
  readonly text: string;
  readonly key: string | null;
  readonly sig: string | null;
}

/** Per-conversation draft persistence (the browser session store in the app; a map in tests). */
export interface DraftStore {
  get(threadId: string): StoredDraft;
  set(threadId: string, draft: StoredDraft): void;
}

export interface SendState {
  readonly threadId: string;
  /** The composer text of this conversation (kept while another conversation is shown). */
  draft: string;
  /** The idempotency key of the request being (or last) sent, kept until the server confirms or refuses it. */
  key: string | null;
  /** The request the key belongs to. */
  keySig: string | null;
  /** The level chosen for the NEXT message (null = the Employee's default). Reset after a confirmed send. */
  level: Level | null;
  mode: ChatMode;
  sending: boolean;
  error: string | null;
}

export interface SendTicket {
  readonly threadId: string;
  /** The draft exactly as it was when the send began. */
  readonly text: string;
  readonly body: string;
  readonly key: string;
  readonly mode: ChatMode;
  readonly level: Level | null;
}

export const sendSig = (body: string, mode: ChatMode, level: Level | null): string => JSON.stringify([body, mode, mode === 'ASK' ? level : null]);

export function sendState(threadId: string, stored: StoredDraft): SendState {
  return { threadId, draft: stored.text, key: stored.key, keySig: stored.sig, level: null, mode: 'ASK', sending: false, error: null };
}

const persist = (s: SendState, store: DraftStore): void => store.set(s.threadId, { text: s.draft, key: s.key, sig: s.keySig });

/**
 * P1-CEO-QUALITY-CORR-01 D (D-P1-09) — the message limit, counted exactly as the server counts it: the sent (trimmed) body's
 * length in UTF-16 code units, at most 4,000 (an Arabic letter is one, an emoji two). The composer never cuts text: a draft
 * may run over, it is shown with its count, and it cannot be sent until it fits — the whole draft stays, nothing is lost.
 */
export const MESSAGE_MAX_CHARS = 4000;
/** From here the count warns that the limit is near. */
export const MESSAGE_NEAR_CHARS = 3600;

export interface ComposerLength {
  readonly count: number;
  readonly max: number;
  readonly state: 'OK' | 'NEAR' | 'OVER';
  /** What the Founder sees under the composer ('' when there is nothing to say). */
  readonly label: string;
}

const fmt = (n: number): string => n.toLocaleString('en-US');
const TOO_LONG = 'Not sent — the message is ';

export function composerLength(text: string): ComposerLength {
  const count = text.trim().length;
  if (count > MESSAGE_MAX_CHARS) {
    return { count, max: MESSAGE_MAX_CHARS, state: 'OVER', label: `${fmt(count)} / ${fmt(MESSAGE_MAX_CHARS)} characters — ${fmt(count - MESSAGE_MAX_CHARS)} over the limit. Nothing was cut: shorten it, or send it as two messages.` };
  }
  if (count >= MESSAGE_NEAR_CHARS) return { count, max: MESSAGE_MAX_CHARS, state: 'NEAR', label: `${fmt(count)} / ${fmt(MESSAGE_MAX_CHARS)} characters — close to the limit` };
  return { count, max: MESSAGE_MAX_CHARS, state: 'OK', label: count === 0 ? '' : `${fmt(count)} / ${fmt(MESSAGE_MAX_CHARS)}` };
}

/** What a paste did to the draft: the Founder is told when the pasted text took the message over the limit (never cut). */
export function pasteNotice(before: string, after: string): string | null {
  const was = composerLength(before);
  const now = composerLength(after);
  return now.state === 'OVER' && was.state !== 'OVER' ? `The pasted text made the message ${fmt(now.count)} characters, over the ${fmt(MESSAGE_MAX_CHARS)} limit. All of it is kept in the box — nothing was cut.` : null;
}

/** The Founder edited this conversation's draft. */
export function editDraft(s: SendState, text: string, store: DraftStore): void {
  s.draft = text;
  // The over-limit refusal is about the text: once it fits again, the refusal is gone (other errors stay until a send).
  if (s.error?.startsWith(TOO_LONG) && composerLength(text).state !== 'OVER') s.error = null;
  persist(s, store);
}

/** Starts a send of this conversation's draft, or null when there is nothing to send or a send is already in flight. */
export function beginSend(s: SendState, store: DraftStore, newKey: () => string): SendTicket | null {
  if (s.sending) return null;
  const body = s.draft.trim();
  if (!body) return null;
  // D-P1-09: an over-limit draft is never sent (and never cut into a shorter "original"): it stays whole, with the reason.
  const length = composerLength(body);
  if (length.state === 'OVER') {
    s.error = `${TOO_LONG}${fmt(length.count)} characters; the limit is ${fmt(MESSAGE_MAX_CHARS)}. Your whole text is kept: shorten it, or send it as two messages.`;
    return null;
  }
  const level = s.mode === 'ASK' ? s.level : null;
  const sig = sendSig(body, s.mode, level);
  if (s.key === null || s.keySig !== sig) {
    s.key = newKey();
    s.keySig = sig;
  }
  s.sending = true;
  s.error = null;
  persist(s, store);
  return { threadId: s.threadId, text: s.draft, body, key: s.key, mode: s.mode, level };
}

function own(s: SendState, ticket: SendTicket): void {
  if (s.threadId !== ticket.threadId) throw new Error('a send settles only the conversation it started from');
}

/** The server holds the message: this conversation's sent draft, key and one-message level are cleared. */
export function settleSent(s: SendState, ticket: SendTicket, store: DraftStore): void {
  own(s, ticket);
  s.sending = false;
  s.error = null;
  if (s.key === ticket.key) {
    s.key = null;
    s.keySig = null;
  }
  if (s.level === ticket.level) s.level = null;
  // Text typed after the send began (never possible while it is shown, but kept safe) is not the sent message.
  if (s.draft === ticket.text) s.draft = '';
  persist(s, store);
}

/**
 * The send was not confirmed. The draft always stays. A refusal recorded nothing (or the key belongs to another request):
 * its key is dropped. A lost connection keeps the key, so sending again replays instead of duplicating.
 */
export function settleFailed(s: SendState, ticket: SendTicket, store: DraftStore, failure: { readonly refused: boolean; readonly message: string }): void {
  own(s, ticket);
  s.sending = false;
  s.error = failure.message;
  if (failure.refused && s.key === ticket.key) {
    s.key = null;
    s.keySig = null;
  }
  persist(s, store);
}
