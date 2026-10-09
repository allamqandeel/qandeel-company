/**
 * P1-CHAT-INTEL-01 — the Founder ↔ Employee Chat: a dedicated screen over the company, not a section of a profile.
 *
 * - One conversation per Employee (the direct thread), its whole history paged from the canonical thread (older pages on
 *   demand; nothing is ever dropped), Founder and Employee turns told apart, day-grouped, Arabic right-to-left in its own
 *   block.
 * - Each Founder message shows the truthful state of its reply (queued, writing, waiting for budget, blocked, failed,
 *   replied) with the canonical reason code humanized — never "thinking" for work that ended, never a retry from here.
 *   The reply's Work Item is execution infrastructure: it never appears in the transcript as a task card.
 * - The next message's reasoning level (E1..E4) is chosen here, for that one reply only: it is sent with the message and
 *   recorded by the server as the reply's durable one-task override. The Employee's standing profile is changed only in
 *   Employee Intelligence on the profile, through the governed preview.
 * - The skeleton is built once: a live refresh replaces the transcript and side facts but never the composer, so the
 *   draft, the caret and the reading position survive. Drafts are also kept per conversation for this browser session.
 * - Closing (× or Escape) only hides the screen: the Company keeps running, in-flight replies continue, history stays.
 */
import { dirOf, fmtDate, fmtDateTime, fmtMoneyMicros, fmtTime, hasArabic, humanize, PURPOSE_LABEL, STATE_LABEL, t } from '../model/format.js';
import type { CompanyUniverse } from '../model/types.js';
import { LEVEL_SHORT, LEVEL_THINKING, LEVELS, levelState, modelLabel, reasonText, REPLY_LABEL, type Level } from '../model/intelligence.js';
import { api, ApiError } from './api.js';
import { h } from './panels.js';

type Json = Record<string, unknown>;

const reason = (code: string | null | undefined): string => reasonText(code, humanize);

export interface ChatHost {
  readonly universe: CompanyUniverse | null;
  nameOf(ref: string): string;
  deptNameOf(id: string): string;
  /** The accent of an Employee's Department column (gold for the CEO). */
  accentOf(employeeId: string): string;
  openEmployee(id: string): void;
  /** Opens the model providers read (where an additive E3 / E4 profile is provisioned, as a governed preview). */
  runCommand(text: string): Promise<void>;
  note(text: string, kind: 'semantic' | 'system'): void;
  /** Called when the Founder closes the chat (× / Escape). */
  closeChat(): void;
  lock(code: string): void;
}

const DRAFT_KEY = (threadId: string): string => `qandeel.chat.draft.${threadId}`;
function draftGet(threadId: string): { text: string; key: string | null } {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY(threadId));
    const v = raw ? (JSON.parse(raw) as { text?: unknown; key?: unknown }) : null;
    return { text: typeof v?.text === 'string' ? v.text : '', key: typeof v?.key === 'string' ? v.key : null };
  } catch {
    return { text: '', key: null };
  }
}
function draftSet(threadId: string, text: string, key: string | null): void {
  try {
    if (text === '') sessionStorage.removeItem(DRAFT_KEY(threadId));
    else sessionStorage.setItem(DRAFT_KEY(threadId), JSON.stringify({ text, key }));
  } catch {
    // a per-viewer convenience only: the in-memory draft still survives refreshes and navigation in this page
  }
}

const newKey = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase();

const contentEl = (tag: string, text: string, cls: string): HTMLElement => {
  const e = h(tag, { class: `${cls} content ${hasArabic(text) ? 'is-arabic' : ''}`.trim(), text });
  e.dir = dirOf(text);
  if (hasArabic(text)) e.lang = 'ar';
  return e;
};

interface Identity {
  readonly name: string;
  readonly given: string;
  readonly title: string;
  readonly dept: string | null;
  readonly state: string;
  readonly accent: string;
  readonly isCeo: boolean;
}

interface Conversation {
  threadId: string;
  employeeId: string;
  /** Every message loaded so far, by seq (history is append-only: an older page is never re-fetched on refresh). */
  messages: Map<number, Json>;
  replies: Map<string, Json>;
  hasOlder: boolean;
  intel: Json | null;
  thread: Json | null;
  /** The level chosen for the NEXT message (null = the Employee's default). Reset after each send. */
  level: Level | null;
  /** Ask for a reply, or leave a note without one. */
  mode: 'ASK' | 'NOTE';
  /** The idempotency key of the draft being sent (kept until the server confirms it, so a retry never duplicates). */
  key: string | null;
  sending: boolean;
  error: string | null;
}

export class ChatScreen {
  readonly #root: HTMLElement;
  readonly #host: ChatHost;
  #c: Conversation | null = null;
  // Persistent skeleton.
  readonly #head = h('header', { class: 'chat-head' });
  readonly #scroller = h('div', { class: 'chat-scroll', tabindex: -1 });
  readonly #list = h('ol', { class: 'chat-list', 'aria-live': 'polite' });
  readonly #older = h('button', { type: 'button', class: 'btn btn-quiet chat-older', text: 'Show earlier messages', 'data-keep': 'chat-older' });
  readonly #side = h('aside', { class: 'chat-side', 'aria-label': 'Employee intelligence for this conversation' });
  readonly #form = h('form', { class: 'chat-composer', novalidate: true }) as HTMLFormElement;
  readonly #text = h('textarea', { name: 'body', rows: 2, maxlength: 4000, dir: 'auto', 'data-keep': 'chat-text' }) as HTMLTextAreaElement;
  readonly #levels = h('div', { class: 'chat-levels', role: 'radiogroup' });
  readonly #modes = h('div', { class: 'chat-modes', role: 'radiogroup', 'aria-label': 'Reply' });
  readonly #levelNote = h('p', { class: 'chat-level-note', 'aria-live': 'polite' });
  readonly #error = h('p', { class: 'chat-error', role: 'alert' });
  readonly #send = h('button', { type: 'submit', class: 'btn btn-primary chat-send', text: 'Send', 'data-keep': 'chat-send' });
  readonly #restriction = h('p', { class: 'chat-restriction' });
  #loadingOlder = false;

  constructor(root: HTMLElement, host: ChatHost) {
    this.#root = root;
    this.#host = host;
    const close = h('button', { type: 'button', class: 'btn btn-ghost chat-close', 'aria-label': 'Close the chat', title: 'Close (Esc)', 'data-keep': 'chat-close' }, h('span', { 'aria-hidden': 'true', text: '×' }));
    close.addEventListener('click', () => this.#host.closeChat());
    this.#closeBtn = close;
    this.#older.addEventListener('click', () => void this.#loadOlder());
    this.#scroller.append(this.#older, this.#list);
    const foot = h('div', { class: 'chat-foot' }, h('span', { class: 'hint', text: 'Enter sends · Shift+Enter for a new line' }), this.#send);
    this.#form.append(this.#restriction, h('div', { class: 'chat-controls' }, this.#modes, this.#levels), this.#levelNote, this.#text, this.#error, foot);
    this.#text.addEventListener('input', () => {
      if (this.#c) draftSet(this.#c.threadId, this.#text.value, this.#c.key);
    });
    this.#text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.#form.requestSubmit();
      }
    });
    this.#form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.#submit();
    });
    const main = h('div', { class: 'chat-main' }, this.#scroller, this.#form);
    this.#root.replaceChildren(this.#head, h('div', { class: 'chat-body' }, main, this.#side));
    // Escape closes the chat (the app-level handler gives a confirmation or a hall precedence first).
    this.#root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        this.#host.closeChat();
      }
    });
    this.#scroller.addEventListener('scroll', () => {
      if (this.#scroller.scrollTop < 24 && this.#c?.hasOlder && !this.#loadingOlder) void this.#loadOlder();
    });
  }

  readonly #closeBtn: HTMLElement;

  get threadId(): string | null {
    return this.#c?.threadId ?? null;
  }

  /** Opens (or re-opens) the conversation: the same thread, its history, and the draft left in it. */
  async open(threadId: string, employeeId: string): Promise<void> {
    if (this.#c?.threadId !== threadId) {
      const draft = draftGet(threadId);
      this.#c = { threadId, employeeId, messages: new Map(), replies: new Map(), hasOlder: false, intel: null, thread: null, level: null, mode: 'ASK', key: draft.key, sending: false, error: null };
      this.#text.value = draft.text;
      this.#list.replaceChildren(h('li', { class: 'chat-empty', text: 'Opening the conversation…' }));
    }
    this.#root.hidden = false;
    await this.refresh(true);
    if (!this.#root.contains(document.activeElement)) this.#text.focus({ preventScroll: true });
  }

  hide(): void {
    this.#root.hidden = true;
  }

  /** A live refresh: the newest page and the reply states. The composer, the draft and older pages are kept. */
  async refresh(stick = false): Promise<void> {
    const c = this.#c;
    if (!c || this.#root.hidden) return;
    const atBottom = stick || this.#scroller.scrollHeight - this.#scroller.scrollTop - this.#scroller.clientHeight < 64;
    const anchor = atBottom ? null : this.#anchor();
    try {
      const d = await api.get<{ thread: Json; messages: Json[]; hasOlder: boolean; replies: Json[]; intelligence: Json | null }>(`/api/threads/${c.threadId}/messages?limit=50`);
      if (this.#c !== c) return;
      c.thread = d.thread;
      c.intel = d.intelligence;
      const newest = d.messages.map((m) => Number(m.seq));
      const lowest = newest.length ? Math.min(...newest) : Number.MAX_SAFE_INTEGER;
      // The first load sets "older exists"; later loads keep what older pages already showed.
      if (c.messages.size === 0 || [...c.messages.keys()].every((s) => s >= lowest)) c.hasOlder = d.hasOlder;
      for (const m of d.messages) c.messages.set(Number(m.seq), m);
      for (const r of d.replies) c.replies.set(String(r.messageId), r);
      this.#render();
      if (atBottom) this.#scroller.scrollTop = this.#scroller.scrollHeight;
      else if (anchor) this.#restoreAnchor(anchor);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return this.#host.lock(e.code);
      if (c.messages.size === 0) this.#list.replaceChildren(h('li', { class: 'chat-empty chat-failed', text: `The conversation could not be opened (${e instanceof ApiError ? humanize(e.code) : 'connection error'}). Nothing was changed.` }));
    }
  }

  async #loadOlder(): Promise<void> {
    const c = this.#c;
    if (!c || !c.hasOlder || this.#loadingOlder) return;
    this.#loadingOlder = true;
    this.#older.setAttribute('aria-busy', 'true');
    const first = Math.min(...c.messages.keys());
    const before = this.#scroller.scrollHeight - this.#scroller.scrollTop;
    try {
      const d = await api.get<{ messages: Json[]; hasOlder: boolean; replies: Json[] }>(`/api/threads/${c.threadId}/messages?before=${first}&limit=50`);
      if (this.#c !== c) return;
      for (const m of d.messages) c.messages.set(Number(m.seq), m);
      for (const r of d.replies) c.replies.set(String(r.messageId), r);
      c.hasOlder = d.hasOlder;
      this.#render();
      // Keep the message the Founder was reading where it was.
      this.#scroller.scrollTop = this.#scroller.scrollHeight - before;
    } catch (e) {
      this.#host.note(`Earlier messages could not load (${e instanceof ApiError ? humanize(e.code) : 'connection error'})`, 'system');
    } finally {
      this.#loadingOlder = false;
      this.#older.removeAttribute('aria-busy');
    }
  }

  #anchor(): { seq: string; top: number } | null {
    const box = this.#scroller.getBoundingClientRect();
    for (const li of this.#list.querySelectorAll<HTMLElement>('li[data-seq]')) {
      const r = li.getBoundingClientRect();
      if (r.bottom > box.top) return { seq: li.dataset.seq ?? '', top: r.top - box.top };
    }
    return null;
  }

  #restoreAnchor(a: { seq: string; top: number }): void {
    const li = this.#list.querySelector<HTMLElement>(`li[data-seq="${CSS.escape(a.seq)}"]`);
    if (!li) return;
    const box = this.#scroller.getBoundingClientRect();
    this.#scroller.scrollTop += li.getBoundingClientRect().top - box.top - a.top;
  }

  // --- rendering ---------------------------------------------------------------------------------------------

  #identity(): Identity {
    const c = this.#c as Conversation;
    const u = this.#host.universe;
    const e = u?.employees.find((x) => x.id === c.employeeId);
    const seat = e ? u?.seats.find((s) => s.holderEmployeeId === e.id) : undefined;
    const isCeo = seat?.kind === 'CEO' || c.thread?.kind === 'FOUNDER_CEO';
    const name = e ? `${e.name.given} ${e.name.family}` : String(c.thread?.subject ?? 'Conversation');
    return {
      name,
      given: e?.name.given ?? name,
      title: isCeo ? 'Chief Executive Officer' : seat ? String(seat.title) : 'No seat',
      dept: e?.departmentId && !isCeo ? this.#host.deptNameOf(e.departmentId) : null,
      state: String(c.intel?.employeeState ?? e?.state ?? ''),
      accent: this.#host.accentOf(c.employeeId),
      isCeo,
    };
  }

  #render(): void {
    const c = this.#c;
    if (!c) return;
    const id = this.#identity();
    this.#root.style.setProperty('--accent', id.accent);
    this.#root.setAttribute('aria-label', `Chat with ${id.name}`);
    // Head: who this is, their state, the way to their profile, and the × that closes the chat.
    const profile = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Profile', 'aria-label': `Open the profile of ${id.name}`, 'data-keep': 'chat-profile' });
    profile.addEventListener('click', () => this.#host.openEmployee(c.employeeId));
    const titleEl = contentEl('h2', id.name, 'chat-title');
    titleEl.id = 'chat-title';
    this.#head.replaceChildren(
      h('span', { class: 'avatar avatar-lg chat-avatar', text: initials(id.name), style: `--dept:${id.accent}`, 'aria-hidden': 'true' }),
      h('div', { class: 'chat-who' }, titleEl, h('p', { class: 'chat-sub' }, h('span', { text: id.title }), id.dept ? h('span', { class: 'sep' }) : null, id.dept ? h('span', { class: 'sheet-dept', text: id.dept }) : null, id.state ? h('span', { class: `pill pill-state state-${id.state.toLowerCase()}`, text: t(STATE_LABEL, id.state) }) : null)),
      h('div', { class: 'chat-head-actions' }, profile, this.#closeBtn),
    );
    this.#renderList(id);
    this.#renderSide(id);
    this.#renderControls(id);
  }

  #renderList(id: Identity): void {
    const c = this.#c as Conversation;
    this.#older.hidden = !c.hasOlder;
    const items: HTMLElement[] = [];
    let lastDay = '';
    const today = fmtDate(new Date().toISOString());
    const seqs = [...c.messages.keys()].sort((a, b) => a - b);
    // The replies an Employee wrote, by the Founder message they answer (shown under that message's status).
    for (const seq of seqs) {
      const m = c.messages.get(seq) as Json;
      const at = String(m.createdAt);
      const day = fmtDate(at);
      if (day !== lastDay) {
        lastDay = day;
        items.push(h('li', { class: 'chat-day', 'aria-hidden': 'true' }, h('span', { text: day === today ? 'Today' : day })));
      }
      const mine = m.senderKind === 'FOUNDER';
      const li = h('li', { class: `chat-msg ${mine ? 'from-founder' : 'from-employee'}`, 'data-seq': String(seq) });
      const bubble = h('div', { class: 'chat-bubble' });
      const brief = m.brief as Json | null;
      if (brief) {
        const row = (title: string, text: string): HTMLElement => h('div', { class: 'brief-row' }, h('h4', { text: title }), contentEl('p', text, ''));
        bubble.append(h('div', { class: 'brief' }, row('What is happening', String(brief.happening)), row('Why it matters', String(brief.matters)), row('Recommendation', String(brief.recommendation)), row('Decision needed', brief.decisionNeeded ? String(brief.decision ?? 'Yes') : 'No decision needed')));
      } else bubble.append(contentEl('p', String(m.body), 'chat-text'));
      const purpose = String(m.purpose);
      const meta = h('div', { class: 'chat-meta' }, h('span', { class: 'chat-sender', text: mine ? 'You' : id.name }), purpose !== 'QUESTION' && purpose !== 'RESULT' ? h('span', { class: `chat-purpose purpose-${purpose.toLowerCase()}`, text: t(PURPOSE_LABEL, purpose) }) : null, h('time', { class: 'chat-time', text: fmtTime(at), title: fmtDateTime(at), datetime: at }));
      if (!mine) li.append(h('span', { class: 'avatar avatar-sm chat-msg-avatar', text: initials(id.name), style: `--dept:${id.accent}`, 'aria-hidden': 'true' }));
      li.append(h('div', { class: 'chat-stack' }, meta, bubble, mine ? this.#replyLine(m, id) : null));
      items.push(li);
    }
    // A reply being written right now: the one place a "writing" indicator appears (never for ended work).
    const running = [...c.replies.values()].filter((r) => r.status === 'RUNNING');
    if (running.length > 0) items.push(h('li', { class: 'chat-typing', 'aria-label': `${id.given} is writing a reply` }, h('span', { class: 'avatar avatar-sm chat-msg-avatar', text: initials(id.name), style: `--dept:${id.accent}`, 'aria-hidden': 'true' }), h('span', { class: 'chat-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { class: 'chat-typing-text', text: `${id.given} is writing…` })));
    if (seqs.length === 0) items.push(h('li', { class: 'chat-empty' }, h('strong', { text: 'No messages yet.' }), h('span', { text: ` Write to ${id.given} in English or Arabic. ${id.state === 'ACTIVE' ? `The reply comes from ${id.isCeo ? 'the CEO’s' : 'their'} own governed run.` : ''}` })));
    this.#list.replaceChildren(...items);
  }

  /** The status line under a Founder message: what happened to its reply, at which level, and what it cost. */
  #replyLine(m: Json, id: { given: string }): HTMLElement | null {
    const c = this.#c as Conversation;
    if (!m.replyWorkItemId) return m.responseRequired === false ? h('p', { class: 'chat-status status-note', text: 'Note — no reply requested' }) : null;
    const r = c.replies.get(String(m.id));
    if (!r) return h('p', { class: 'chat-status', text: 'Reply status unavailable' });
    const status = String(r.status);
    const parts: (HTMLElement | string)[] = [];
    parts.push(h('span', { class: `chat-status-dot dot-${status.toLowerCase()}`, 'aria-hidden': 'true' }), h('strong', { text: REPLY_LABEL[status] ?? humanize(status) }));
    const why = reason(r.reasonCode as string | null);
    if (why && status !== 'REPLIED' && status !== 'RUNNING') parts.push(h('span', { class: 'chat-why', text: ` — ${why}` }));
    const answered = (r.answeredClasses as string[] | undefined) ?? [];
    const level = r.requestedClass ? `${String(r.requestedClass)} chosen` : answered.length ? `${answered.at(-1) ?? ''}` : '';
    const facts: string[] = [];
    if (level) facts.push(level);
    if (answered.length > 1) facts.push(`${answered.length} calls`);
    const currency = r.currency ? String(r.currency) : null;
    if (currency && Number(r.spentMoney) > 0) facts.push(`spent ${fmtMoneyMicros(Number(r.spentMoney), currency)}`);
    if (currency && Number(r.reservedMoney) > 0) facts.push(`held ${fmtMoneyMicros(Number(r.reservedMoney), currency)}`);
    if (facts.length) parts.push(h('span', { class: 'chat-facts', text: ` · ${facts.join(' · ')}` }));
    const line = h('p', { class: `chat-status status-${status.toLowerCase()}`, title: currency ? `Reply cap ${fmtMoneyMicros(Number(r.capMoney), currency)} (a hard ceiling, not spending)` : '' }, ...parts);
    if (status === 'FAILED' || status === 'BLOCKED') line.append(h('span', { class: 'chat-why', text: ` ${id.given} did not answer this one. It is never retried automatically; you can ask again.` }));
    return line;
  }

  #renderSide(id: Identity): void {
    const c = this.#c as Conversation;
    const intel = c.intel;
    const dl = h('dl', { class: 'facts chat-facts-list' });
    const fact = (k: string, v: string): void => {
      dl.append(h('dt', { text: k }), h('dd', { text: v }));
    };
    fact('Model', modelLabel(intel));
    if (intel) {
      const def = String(intel.defaultClass) as Level;
      const max = String(intel.ceilingClass) as Level;
      fact('Default level', `${def} · ${LEVEL_THINKING[def] ?? ''}`);
      fact('Maximum level', `${max} · ${LEVEL_THINKING[max] ?? ''}`);
      const env = intel.envelope as Json | null;
      if (env) fact('Budget', `${fmtMoneyMicros(Number(env.spentMoney), String(env.currency))} spent · ${fmtMoneyMicros(Number(env.reservedMoney), String(env.currency))} held · cap ${fmtMoneyMicros(Number(env.capMoney), String(env.currency))}`);
    }
    // This conversation's own spending (the replies loaded here), distinct from the envelope's cap and holds.
    const replies = [...c.replies.values()];
    const currency = replies.find((r) => r.currency)?.currency as string | undefined;
    if (currency) fact('This conversation', `${replies.length} replies requested · ${fmtMoneyMicros(replies.reduce((n, r) => n + Number(r.spentMoney ?? 0), 0), currency)} spent`);
    const change = h('button', { type: 'button', class: 'link', text: 'Change default or maximum', 'data-keep': 'chat-intel-profile' });
    change.addEventListener('click', () => this.#host.openEmployee(c.employeeId));
    this.#side.replaceChildren(h('h3', { class: 'chat-side-title', text: 'Employee Intelligence' }), dl, h('p', { class: 'muted small', text: `A level chosen in the chat applies to the next message only. ${id.given}’s standing default and maximum change only on the profile, through a preview you confirm.` }), change);
  }

  #renderControls(id: Identity): void {
    const c = this.#c as Conversation;
    const active = id.state === 'ACTIVE';
    if (!active && c.mode === 'ASK') c.mode = 'NOTE';
    this.#restriction.hidden = active;
    this.#restriction.textContent = active ? '' : `${id.given} is ${t(STATE_LABEL, id.state).toLowerCase() || 'not active'}. Messages are kept in this conversation as notes; an AI reply starts only after the Academy activates ${id.given}. Chat never grants authority or counts as certification evidence.`;
    // Ask (a reply from their governed run) or leave a note (no reply, no spending).
    const mode = (value: 'ASK' | 'NOTE', label: string, disabled: boolean): HTMLElement => {
      const b = h('button', { type: 'button', role: 'radio', class: `chip chip-choice${c.mode === value ? ' is-active' : ''}`, 'aria-checked': c.mode === value ? 'true' : 'false', 'data-keep': `chat-mode-${value}`, text: label });
      if (disabled) b.setAttribute('disabled', '');
      b.addEventListener('click', () => {
        c.mode = value;
        this.#renderControls(id);
      });
      return b;
    };
    this.#modes.replaceChildren(mode('ASK', 'Ask for a reply', !active), mode('NOTE', 'Note, no reply', false));
    // The next message's level: Default, or E1..E4 where this Employee and the conversation route allow it.
    const intel = c.intel;
    const def = intel ? (String(intel.defaultClass) as Level) : null;
    this.#levels.setAttribute('aria-label', 'Reasoning level for the next message');
    const pick = (value: Level | null, label: string, sub: string, enabled: boolean, title: string): HTMLElement => {
      const on = c.level === value;
      const b = h('button', { type: 'button', role: 'radio', class: `chat-level${on ? ' is-active' : ''}`, 'aria-checked': on ? 'true' : 'false', 'data-keep': `chat-level-${value ?? 'default'}`, title }, h('span', { class: 'chat-level-name', text: label }), h('span', { class: 'chat-level-sub', text: sub }));
      if (!enabled) b.setAttribute('aria-disabled', 'true');
      b.addEventListener('click', () => {
        if (!enabled) {
          this.#explain(value as Level);
          return;
        }
        c.level = value;
        this.#levelNote.textContent = value === null ? '' : `${value} (${LEVEL_THINKING[value].toLowerCase()}) for the next message only. ${id.given}’s standing level stays ${def ?? 'unchanged'}.`;
        this.#renderControls(id);
      });
      return b;
    };
    const asking = c.mode === 'ASK';
    const buttons = [pick(null, 'Default', def ? `${def} · ${LEVEL_SHORT[def]}` : '—', asking, 'The Employee’s standing default level')];
    for (const l of LEVELS) {
      const s = levelState(intel, l);
      buttons.push(pick(l, l, LEVEL_SHORT[l], asking && s.available, s.available ? `${LEVEL_THINKING[l]} — for the next message only` : `${LEVEL_THINKING[l]} — ${reason(s.code)}`));
    }
    this.#levels.replaceChildren(...buttons);
    this.#levels.hidden = !asking;
    if (c.level !== null && !levelState(intel, c.level).available) c.level = null;
    if (!asking) this.#levelNote.textContent = '';
    this.#text.setAttribute('aria-label', `Message to ${id.name}`);
    this.#text.placeholder = asking ? `Write to ${id.given} in English or Arabic…` : `A note for ${id.given} (no reply, nothing is spent)…`;
    this.#send.textContent = c.sending ? 'Sending…' : asking ? 'Send' : 'Save note';
    this.#send.toggleAttribute('disabled', c.sending);
    this.#text.toggleAttribute('readonly', c.sending);
    this.#error.textContent = c.error ?? '';
  }

  /** Why a level cannot be used for the next message, and the governed way to change that. */
  #explain(level: Level): void {
    const c = this.#c as Conversation;
    const s = levelState(c.intel, level);
    const id = this.#identity();
    const way =
      s.code === 'ABOVE_EMPLOYEE_CEILING'
        ? ` Raising ${id.given}’s maximum is a permanent profile change: open the profile, Employee Intelligence, and confirm the preview (certifications become due for review).`
        : s.code === 'NOT_PROVISIONED' || s.code === 'ABOVE_ROUTE_POLICY'
          ? ' Adding E3 / E4 for conversation is a governed provisioning: open Model providers and confirm the preview.'
          : '';
    this.#levelNote.replaceChildren(h('span', { text: `${level} is ${reason(s.code)}.${way}` }));
    if (s.code === 'ABOVE_EMPLOYEE_CEILING') {
      const b = h('button', { type: 'button', class: 'link', text: 'Open the profile' });
      b.addEventListener('click', () => this.#host.openEmployee(c.employeeId));
      this.#levelNote.append(' ', b);
    } else if (s.code === 'NOT_PROVISIONED' || s.code === 'ABOVE_ROUTE_POLICY') {
      const b = h('button', { type: 'button', class: 'link', text: 'Open Model providers' });
      b.addEventListener('click', () => void this.#host.runCommand('show providers'));
      this.#levelNote.append(' ', b);
    }
  }

  async #submit(): Promise<void> {
    const c = this.#c;
    if (!c || c.sending) return;
    const body = this.#text.value.trim();
    if (!body) return;
    c.key ??= newKey();
    draftSet(c.threadId, this.#text.value, c.key);
    c.sending = true;
    c.error = null;
    const id = this.#identity();
    this.#renderControls(id);
    const ask = c.mode === 'ASK';
    try {
      await api.post(`/api/threads/${c.threadId}/messages`, { purpose: ask ? 'QUESTION' : 'FYI', body, responseRequired: ask, clientKey: c.key, ...(ask && c.level !== null ? { reasoningClass: c.level } : {}) });
      // Only now is the draft gone: the server holds the message.
      this.#text.value = '';
      c.key = null;
      c.level = null;
      this.#levelNote.textContent = '';
      draftSet(c.threadId, '', null);
      c.sending = false;
      await this.refresh(true);
    } catch (e) {
      c.sending = false;
      if (e instanceof ApiError && e.status === 401) return this.#host.lock(e.code);
      const why = e instanceof ApiError ? reason(typeof e.details.reason === 'string' ? e.details.reason : e.code) : 'the connection failed';
      // A refusal keeps the draft and its key: sending again is safe (a duplicate is impossible).
      c.error = `Not sent — ${why}. Your message is kept here.`;
      if (!(e instanceof ApiError)) c.error = 'Not confirmed — the connection failed. Your message is kept; sending again cannot create a duplicate.';
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) c.key = null;
    } finally {
      this.#renderControls(this.#identity());
    }
  }
}
