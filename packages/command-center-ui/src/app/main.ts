/**
 * The Founder Command Center application: one living company surface. Boot → session check → universe
 * projection → the Tree of Light view → lenses, attention, conversation, governed confirmation, timeline.
 * Server-Sent "changed" nudges re-project; nothing polls.
 */
import { deptName, fmtRelative, INTENT_LABEL, LEVEL_LABEL, RELATION_LABEL, RESULT_LABEL, SOURCE_LABEL, t } from '../model/format.js';
import { layoutUniverse } from '../model/layout.js';
import { applyLens, attentionSpotlight, chainNodeIds, showsRelations } from '../model/lenses.js';
import type { CompanyUniverse, Emphasis, Layout, LayoutNode, Lens } from '../model/types.js';
import { api, ApiError, subscribeChanges } from './api.js';
import { h, renderActivity, renderAttentionRail, renderCalendar, renderConversation, renderEmployeeFocus, renderGoalFocus, renderHealthLine, renderPalette, renderPreview, renderTimeline, type PanelHost } from './panels.js';
import { departmentColor, TreeView } from './view.js';

type Json = Record<string, unknown>;

const $ = (id: string): HTMLElement => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e;
};

class App implements PanelHost {
  universe: CompanyUniverse | null = null;
  layout: Layout | null = null;
  emphasis: Emphasis | null = null;
  lens: Lens = { kind: 'LIVE' };
  lane: 'NEEDS_ME' | 'CEO_BRIEFS' | 'THREADS' | null = null;
  historyAt: string | null = null;
  view = new TreeView();
  activity: { at: string; text: string; kind: 'semantic' | 'system' }[] = [];
  stream: 'open' | 'closed' = 'closed';
  reduced: boolean;
  paletteResult: Json | null = null;
  timelineBounds = { earliest: new Date(Date.now() - 86_400_000).toISOString(), now: new Date().toISOString() };
  #refreshing = false;
  #dirty = false;
  #previousRelationIds = new Set<string>();
  #previousAttentionIds = new Set<string>();
  #railOpen = false;
  #toastTimer = 0;
  /** The attention item under the Founder's eye (its spotlight outlives the live refreshes of a working company). */
  #spotlight: { itemId: string; el: HTMLElement | null } | null = null;

  constructor() {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stored = safeGet('qandeel.reducedMotion');
    this.reduced = stored === null ? mq.matches : stored === '1';
    mq.addEventListener('change', () => {
      if (safeGet('qandeel.reducedMotion') === null) this.setReduced(mq.matches);
    });
  }

  async boot(): Promise<void> {
    document.documentElement.dataset.renderer = 'dom';
    try {
      await api.get('/api/session');
    } catch (e) {
      this.lock(e instanceof ApiError ? e.code : 'FOUNDER_SESSION_INVALID');
      return;
    }
    this.view.mount($('universe'), {
      onSelect: (id, node) => this.select(id, node),
      onSelectDepartment: (departmentId) => this.openDepartment(departmentId),
      onAttention: (nodeId) => {
        const a = this.universe?.attention.find((x) => `attention:${x.id}` === nodeId);
        if (a) this.focusSource(a.sourceRef);
      },
      onOpenAttention: () => (this.#railOpen ? this.closeRail() : this.showLane(null)),
      onHoverAttention: (nodeId, itemEl) => this.spotlightAttention(nodeId === null ? null : nodeId.replace('attention:', ''), itemEl),
    });
    this.view.setReducedMotion(this.reduced);
    $('motion-toggle').addEventListener('click', () => this.setReduced(!this.reduced));
    this.#renderMotionToggle();
    window.addEventListener('keydown', (e) => this.#hotkeys(e));
    $('logout').addEventListener('click', () => void api.post('/api/session/logout').then(() => location.reload()));
    $('palette-open').addEventListener('click', () => this.openPalette());
    $('legend-toggle').addEventListener('click', () => $('legend').toggleAttribute('hidden'));
    $('attention-toggle').addEventListener('click', () => (this.#railOpen ? this.closeRail() : this.showLane(null)));
    this.#paletteInput();
    await this.refresh(true);
    subscribeChanges(
      () => void this.refresh(false),
      (s) => {
        this.stream = s;
        renderHealthLine($('health'), this.universe, s);
      },
    );
    $('app').removeAttribute('data-booting');
  }

  lock(code: string): void {
    const lock = $('lock');
    lock.hidden = false;
    const codeEl = lock.querySelector('[data-code]');
    if (codeEl) codeEl.textContent = code;
    $('app').setAttribute('hidden', '');
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    safeSet('qandeel.reducedMotion', reduced ? '1' : '0');
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
    this.view.setReducedMotion(reduced);
    this.#renderMotionToggle();
  }

  #renderMotionToggle(): void {
    const b = $('motion-toggle');
    b.textContent = this.reduced ? 'Motion: reduced' : 'Motion: full';
    b.setAttribute('aria-pressed', this.reduced ? 'true' : 'false');
    document.documentElement.dataset.motion = this.reduced ? 'reduced' : 'full';
  }

  async refresh(initial: boolean): Promise<void> {
    if (this.#refreshing) {
      this.#dirty = true;
      return;
    }
    this.#refreshing = true;
    try {
      const at = this.historyAt;
      const u = await api.get<CompanyUniverse>(`/api/universe${at ? `?at=${encodeURIComponent(at)}` : ''}`);
      this.applyUniverse(u, initial);
      if (!at) {
        const [attention, calendar, timeline] = await Promise.all([api.get<{ items: Json[]; health: Json }>('/api/attention'), api.get<{ events: Json[] }>('/api/calendar'), api.get<{ earliest: string; now: string }>('/api/timeline')]);
        this.#renderRail(attention);
        renderCalendar($('calendar'), calendar, this);
        this.timelineBounds = { earliest: timeline.earliest, now: timeline.now };
      }
      renderTimeline($('timeline'), { live: at === null, at, earliest: this.timelineBounds.earliest, now: this.timelineBounds.now }, this);
      renderHealthLine($('health'), u, this.stream);
      if (this.lens.kind === 'EMPLOYEE' || this.lens.kind === 'CONVERSATION' || this.lens.kind === 'GOAL') {
        await this.#renderFocus();
        this.#applyTether();
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.lock(e.code);
      else this.note(`Could not refresh (${e instanceof ApiError ? e.code : 'error'})`, 'system');
    } finally {
      this.#refreshing = false;
      if (this.#dirty) {
        this.#dirty = false;
        void this.refresh(false);
      }
    }
  }

  #renderRail(attention: { items: Json[]; health: Json }): void {
    const counts = renderAttentionRail($('rail'), attention, this, this.lane);
    const total = counts.needsMe + counts.briefs;
    $('attention-count').textContent = String(total);
    $('attention-toggle').classList.toggle('has-items', total > 0);
  }

  applyUniverse(u: CompanyUniverse, initial: boolean): void {
    const previous = this.universe;
    this.universe = u;
    this.layout = layoutUniverse(u);
    this.view.setLayout(this.layout, u);
    this.view.setLive(u.live);
    document.documentElement.dataset.live = u.live ? 'live' : 'history';
    this.#applyLens(initial);
    // Semantic motion only on real change between snapshots: new relations pulse, new attention arrives.
    if (previous && u.live) {
      const relationIds = new Set(u.relations.map((r) => r.id));
      for (const r of u.relations) if (!this.#previousRelationIds.has(r.id)) {
        this.view.pulseEdge(r.id);
        this.note(`New ${t(RELATION_LABEL, r.kind).toLowerCase()}: ${this.nameOf(r.from)} → ${this.nameOf(r.to)}`, 'semantic');
      }
      this.#previousRelationIds = relationIds;
      const attentionIds = new Set(u.attention.map((a) => a.id));
      for (const a of u.attention) if (!this.#previousAttentionIds.has(a.id)) {
        this.view.arriveAttention(`attention:${a.id}`);
        this.note(`Needs you: ${t(SOURCE_LABEL, a.sourceKind).toLowerCase()} — ${t(LEVEL_LABEL, a.level).toLowerCase()}`, 'semantic');
      }
      this.#previousAttentionIds = attentionIds;
    } else {
      this.#previousRelationIds = new Set(u.relations.map((r) => r.id));
      this.#previousAttentionIds = new Set(u.attention.map((a) => a.id));
    }
  }

  nameOf(ref: string): string {
    if (ref === 'founder' || ref.startsWith('founder:')) return 'Founder';
    const e = this.universe?.employees.find((x) => `employee:${x.id}` === ref);
    if (e) return `${e.name.given} ${e.name.family}`;
    if (ref.startsWith('work_item:')) return this.workTitleOf(ref.slice('work_item:'.length)) ?? 'a work item';
    if (ref.startsWith('goal:')) return this.universe?.goals.find((g) => g.id === ref.slice(5))?.title ?? 'a goal';
    if (ref.startsWith('department:')) return this.deptNameOf(ref.slice('department:'.length));
    return ref.replace(/^[a-z_]+:/, '').replace(/[0-9a-f-]{36}/, 'an item');
  }

  deptNameOf(id: string): string {
    const d = this.universe?.departments.find((x) => x.id === id);
    return d ? deptName(d.code, d.name) : 'a department';
  }

  workTitleOf(id: string): string | null {
    return this.universe?.work.find((w) => w.id === id)?.objective ?? null;
  }

  #deptColorOf(employeeId: string | null): string {
    const n = employeeId ? this.layout?.byId.get(`employee:${employeeId}`) : undefined;
    return departmentColor(n?.column ?? null);
  }

  deptColorOf(id: string): string {
    return departmentColor(this.layout?.columns.find((c) => c.departmentId === id)?.index ?? null);
  }

  colorOf(ref: string): string {
    if (ref === 'founder' || (this.layout && ref === this.layout.ceoId)) return '#c48a1f';
    return departmentColor(this.layout?.byId.get(ref)?.column ?? null);
  }

  /**
   * The Founder reads one attention item (in the dock beside the Founder or in the open attention surface):
   * the company spotlights the person, their chain, their Department and the goal it is about, and a tether
   * runs from the person to the item. Null restores the lens. Attention semantics are untouched: this is
   * emphasis only.
   */
  spotlightAttention(itemId: string | null, itemEl: HTMLElement | null): void {
    if (!this.universe || !this.layout) return;
    if (itemId === null) {
      this.#spotlight = null;
      if (this.emphasis) this.view.setEmphasis(this.emphasis);
      this.#applyTether();
      return;
    }
    this.#spotlight = { itemId, el: itemEl };
    const nodeId = `attention:${itemId}`;
    const spot = attentionSpotlight(this.universe, this.layout, nodeId);
    this.view.setEmphasis(spot);
    const owner = this.layout.byId.get(nodeId)?.employeeId ?? null;
    const anchor = itemEl && itemEl.isConnected ? itemEl : this.#railOpen ? $('rail') : null;
    this.view.setTether(owner ? `employee:${owner}` : null, anchor);
  }

  /** The tether follows the lens: a context sheet is tied to what it is about. */
  #applyTether(): void {
    const focus = $('focus');
    const lens = this.lens;
    if (focus.hidden || !(lens.kind === 'EMPLOYEE' || lens.kind === 'CONVERSATION' || lens.kind === 'GOAL')) {
      this.view.setTether(null, null);
      return;
    }
    this.view.setTether(lens.kind === 'GOAL' ? `goal:${lens.goalId}` : `employee:${lens.employeeId}`, focus);
  }

  #applyLens(immediate: boolean): void {
    if (!this.universe || !this.layout) return;
    this.emphasis = applyLens(this.universe, this.layout, this.lens);
    this.view.setEmphasis(this.emphasis);
    if (this.#spotlight) this.spotlightAttention(this.#spotlight.itemId, this.#spotlight.el);
    this.view.setRelationsVisible(showsRelations(this.lens));
    this.view.setSelection(this.emphasis.focusNodeId);
    if (!immediate) this.view.focus(this.emphasis.focusNodeId);
    $('lens').textContent = lensTitle(this.lens, this.universe, this.layout);
    document.documentElement.dataset.lens = this.lens.kind;
  }

  setLens(lens: Lens): void {
    this.lens = lens;
    this.#applyLens(false);
    const focus = $('focus');
    if (lens.kind === 'EMPLOYEE' || lens.kind === 'GOAL' || lens.kind === 'CONVERSATION') {
      // The sheet docks on the side that keeps what it is about in view: a person in the two right-hand
      // columns (or a goal served there) gets the sheet on the left, and so does the CEO (the desk left of the
      // spine is empty; the right holds what needs the Founder). With the attention surface open, right.
      const nodeId = lens.kind === 'GOAL' ? `goal:${lens.goalId}` : `employee:${lens.employeeId}`;
      const node = this.layout?.byId.get(nodeId);
      const columns = this.layout?.columns.length ?? 5;
      const column = node?.kind === 'goal' ? (node.anchors.length ? node.anchors.reduce((s, i) => s + i, 0) / node.anchors.length : null) : node?.column ?? null;
      const spine = node !== undefined && node.kind !== 'goal' && node.column === null;
      const left = !this.#railOpen && (spine || (column !== null && column >= columns / 2));
      focus.classList.toggle('is-left', left);
      focus.classList.remove('is-below-desk');
      focus.hidden = false;
      // Collision-aware: a sheet on the right never covers the Founder's "Needs you" chips. When the two would
      // meet, the sheet starts beneath the chips (the desk's height is measured by the view, never assumed).
      if (!left && !this.#railOpen) {
        const desk = document.querySelector('.dock-attention')?.getBoundingClientRect();
        const sheet = focus.getBoundingClientRect();
        if (desk && sheet.left < desk.right + 8 && sheet.top < desk.bottom + 8) focus.classList.add('is-below-desk');
      }
      void this.#renderFocus().then(() => this.#applyTether());
    } else {
      focus.hidden = true;
      focus.replaceChildren();
      this.#applyTether();
    }
    if (lens.kind === 'ATTENTION') {
      this.lane = lens.lane;
      this.#setRail(true);
      void api.get<{ items: Json[]; health: Json }>('/api/attention').then((a) => this.#renderRail(a));
    }
  }

  #setRail(open: boolean): void {
    this.#railOpen = open;
    $('rail').hidden = !open;
    if (open) $('focus').classList.remove('is-left', 'is-below-desk');
    if (!open) this.spotlightAttention(null, null);
    $('attention-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    document.documentElement.dataset.rail = open ? 'open' : 'closed';
  }

  async #renderFocus(): Promise<void> {
    const focus = $('focus');
    try {
      if (this.lens.kind === 'EMPLOYEE') renderEmployeeFocus(focus, await api.get<Json>(`/api/employees/${this.lens.employeeId}`), this, this.#deptColorOf(this.lens.employeeId));
      else if (this.lens.kind === 'GOAL') renderGoalFocus(focus, await api.get<Json>(`/api/goals/${this.lens.goalId}`), this);
      else if (this.lens.kind === 'CONVERSATION') renderConversation(focus, await api.get<{ thread: Json; messages: Json[]; pending: Json[] }>(`/api/threads/${this.lens.threadId}/messages`), this, this.universe, this.#deptColorOf(this.lens.employeeId));
    } catch (e) {
      focus.replaceChildren(h('p', { class: 'empty', text: `Could not open the details (${e instanceof ApiError ? e.code : 'error'}).` }));
    }
  }

  select(id: string, node: LayoutNode): void {
    if (node.kind === 'founder') return this.returnToLive();
    if (node.kind === 'employee' && node.employeeId) return this.setLens({ kind: 'EMPLOYEE', employeeId: node.employeeId });
    if (node.kind === 'seat' && node.departmentId) return this.setLens({ kind: 'DEPARTMENT', departmentId: node.departmentId });
    if (node.kind === 'goal') return this.setLens({ kind: 'GOAL', goalId: id.slice('goal:'.length) });
    if (node.kind === 'attention') {
      const a = this.universe?.attention.find((x) => `attention:${x.id}` === id);
      if (a) this.focusSource(a.sourceRef);
      return;
    }
  }

  // --- PanelHost ------------------------------------------------------------------------------------

  openEmployee(id: string): void {
    this.setLens({ kind: 'EMPLOYEE', employeeId: id });
  }

  openGoal(id: string): void {
    this.setLens({ kind: 'GOAL', goalId: id });
  }

  openDepartment(id: string): void {
    this.setLens({ kind: 'DEPARTMENT', departmentId: id });
  }

  openThread(threadId: string, employeeId: string): void {
    this.setLens({ kind: 'CONVERSATION', threadId, employeeId });
  }

  startConversation(employeeId: string | null): void {
    // The CEO's conversation is the Founder ↔ CEO thread itself (one thread, whoever holds the seat).
    const ceo = this.universe?.seats.find((s) => s.kind === 'CEO')?.holderEmployeeId ?? null;
    void api
      .post<{ thread: Json }>('/api/threads', { employeeId: employeeId !== null && employeeId === ceo ? null : employeeId })
      .then((r) => this.openThread(String(r.thread.id), String(r.thread.employeeId)))
      .catch((e: unknown) => this.note(`Could not open the conversation (${e instanceof ApiError ? e.code : 'error'})`, 'system'));
  }

  showLane(lane: 'NEEDS_ME' | 'CEO_BRIEFS' | 'THREADS' | null): void {
    this.setLens({ kind: 'ATTENTION', lane });
  }

  closeRail(): void {
    this.#setRail(false);
    if (this.lens.kind === 'ATTENTION') {
      this.lane = null;
      this.setLens({ kind: 'LIVE' });
    }
  }

  returnToLive(): void {
    this.historyAt = null;
    this.lane = null;
    this.#setRail(false);
    this.setLens({ kind: 'LIVE' });
    void this.refresh(false);
  }

  scrubTo(at: string): void {
    this.historyAt = at;
    this.lens = { kind: 'HISTORY', at };
    void this.refresh(false);
    this.note(`Showing the company as it was ${fmtRelative(at)}`, 'system');
  }

  focusSource(sourceRef: string): void {
    const [kind, id] = sourceRef.split(':') as [string, string];
    if (kind === 'goal') return this.openGoal(id);
    if (kind === 'employee') return this.openEmployee(id);
    if (kind === 'department') return this.openDepartment(id);
    if (kind === 'thread') {
      const th = this.universe?.attention.find((a) => a.sourceRef === sourceRef);
      const emp = th?.ownerRef?.replace('employee:', '') ?? '';
      return this.openThread(id, emp);
    }
    if (kind === 'message') {
      void api.get<{ items: Json[] }>('/api/attention').then((a) => {
        const item = a.items.find((i) => i.sourceRef === sourceRef) as (Json & { message?: Json }) | undefined;
        const threadId = item?.message ? String(item.message.threadId) : null;
        if (threadId) this.openThread(threadId, String(item?.ownerRef ?? '').replace('employee:', ''));
      });
      return;
    }
    if (kind === 'approval' || kind === 'work_item' || kind === 'work_delegation' || kind === 'staffing_request' || kind === 'review_conflict') {
      // Find the employee who owns the work behind the source and focus them (the chain shows the path to the Founder).
      const u = this.universe;
      if (!u) return;
      const rel = u.relations.find((r) => r.sourceRef === sourceRef);
      const owner = rel ? (rel.from.startsWith('employee:') ? rel.from : rel.to) : null;
      if (owner && owner.startsWith('employee:')) return this.openEmployee(owner.slice('employee:'.length));
      const w = kind === 'work_item' ? u.work.find((x) => x.id === id) : undefined;
      if (w?.ownerEmployeeId) return this.openEmployee(w.ownerEmployeeId);
      this.setLens({ kind: 'ATTENTION', lane: 'NEEDS_ME' });
    }
  }

  async runCommand(text: string): Promise<void> {
    this.openPalette(text);
    this.#paletteInput(true);
    try {
      const r = await api.post<Json>('/api/command', { text });
      this.paletteResult = r;
      const intent = r.intent as Json;
      const focus = r.focus as Json | undefined;
      if (intent.kind === 'READ' && focus) this.#applyFocus(focus);
      if (r.preview) this.showPreview(r.preview as Json);
      this.note(intent.kind === 'READ' ? `Read: ${t(INTENT_LABEL, String(intent.intent))}` : intent.kind === 'MUTATING' ? `Governed action: ${t(INTENT_LABEL, String(intent.intent))} — awaiting your confirmation` : 'Command not understood', 'system');
    } catch (e) {
      this.paletteResult = { intent: { kind: 'UNKNOWN' } };
      this.note(`The command failed (${e instanceof ApiError ? e.code : 'error'})`, 'system');
    } finally {
      this.#paletteInput(false);
    }
  }

  #applyFocus(focus: Json): void {
    const lens = String(focus.lens);
    const target = focus.targetId as string | null | undefined;
    if (lens === 'LIVE') return this.returnToLive();
    if (lens === 'CEO') return target ? this.openEmployee(target) : this.setLens({ kind: 'CEO' });
    if (lens === 'EMPLOYEE' && target) return this.openEmployee(target);
    if (lens === 'GOAL' && target) return this.openGoal(target);
    if (lens === 'DEPARTMENT' && target) return this.openDepartment(target);
    if (lens === 'BLOCKED') return this.setLens({ kind: 'BLOCKED' });
    if (lens === 'ATTENTION') return this.setLens({ kind: 'ATTENTION', lane: (focus.query as 'NEEDS_ME' | 'CEO_BRIEFS' | 'THREADS' | null) ?? null });
    if (lens === 'HISTORY') return this.scrubTo(new Date(Date.now() - 3_600_000).toISOString());
  }

  openPalette(prefill = ''): void {
    const p = $('palette');
    p.hidden = false;
    const input = this.#paletteInput(false);
    if (prefill) input.value = prefill;
    input.focus();
  }

  #paletteInput(busy = false): HTMLInputElement {
    const p = $('palette');
    const previous = p.querySelector<HTMLInputElement>('.palette-input')?.value ?? '';
    const input = renderPalette(p, this, this.paletteResult, busy);
    input.value = previous;
    return input;
  }

  showPreview(preview: Json): void {
    const d = $('preview');
    d.hidden = false;
    renderPreview(d, preview, this);
  }

  async confirmPreview(previewId: string, fingerprint: string): Promise<void> {
    try {
      const r = await api.post<{ resultRef: string }>(`/api/previews/${previewId}/confirm`, { fingerprint });
      $('preview').hidden = true;
      const kind = String(r.resultRef).split(':')[0] ?? '';
      this.note(`Executed at the real boundary: ${t(RESULT_LABEL, kind)}`, 'semantic');
      await this.refresh(false);
    } catch (e) {
      this.note(`Not executed (${e instanceof ApiError ? e.code : 'error'})`, 'system');
    }
  }

  async rejectPreview(previewId: string): Promise<void> {
    $('preview').hidden = true;
    await api.post(`/api/previews/${previewId}/reject`, { reasonCode: 'founder.cancelled' }).catch(() => undefined);
    this.note('Preview cancelled. Nothing changed.', 'system');
  }

  async dismissAttention(itemId: string): Promise<void> {
    await api.post(`/api/attention/${itemId}/dismiss`, { reasonCode: 'founder.dismissed' }).catch((e: unknown) => this.note(`Could not dismiss (${e instanceof ApiError ? e.code : 'error'})`, 'system'));
    await this.refresh(false);
  }

  async sendMessage(threadId: string, purpose: string, body: string): Promise<void> {
    try {
      await api.post(`/api/threads/${threadId}/messages`, { purpose, body });
      this.note('Sent. A reply comes from their own governed run.', 'semantic');
      await this.refresh(false);
    } catch (e) {
      this.note(`Not sent (${e instanceof ApiError ? e.code : 'error'})`, 'system');
    }
  }

  note(text: string, kind: 'semantic' | 'system'): void {
    const line = { at: new Date().toISOString(), text, kind };
    this.activity.push(line);
    if (this.activity.length > 40) this.activity.shift();
    renderActivity($('activity'), line);
    clearTimeout(this.#toastTimer);
    this.#toastTimer = window.setTimeout(() => renderActivity($('activity'), null), 7000);
  }

  #hotkeys(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.openPalette();
    } else if (e.key === 'Escape') {
      const preview = $('preview');
      if (!preview.hidden) {
        preview.hidden = true;
        return;
      }
      if (!$('palette').hidden) {
        $('palette').hidden = true;
        return;
      }
      this.returnToLive();
    }
  }
}

function lensTitle(lens: Lens, u: CompanyUniverse, layout: Layout): string {
  switch (lens.kind) {
    case 'LIVE':
      return 'Company Live';
    case 'HISTORY':
      return `Historical focus — ${fmtRelative(lens.at)}`;
    case 'ATTENTION':
      return lens.lane === null ? 'Founder attention' : lens.lane === 'NEEDS_ME' ? 'Needs me' : lens.lane === 'CEO_BRIEFS' ? 'CEO briefs' : 'Conversations';
    case 'CEO':
      return 'Focus: Chief Executive';
    case 'EMPLOYEE':
    case 'CONVERSATION': {
      const n = layout.byId.get(`employee:${lens.employeeId}`);
      return `${lens.kind === 'CONVERSATION' ? 'Conversation' : 'Focus'}: ${n?.label ?? ''}`;
    }
    case 'GOAL':
      return `Goal: ${u.goals.find((g) => g.id === lens.goalId)?.title ?? ''}`;
    case 'DEPARTMENT': {
      const d = u.departments.find((x) => x.id === lens.departmentId);
      return `Department: ${d ? deptName(d.code, d.name) : ''}`;
    }
    case 'BLOCKED':
      return 'Blocked now';
  }
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    // per-viewer convenience only
  }
}

export function chainForTest(u: CompanyUniverse, layout: Layout, employeeId: string): string[] {
  return chainNodeIds(u, layout, employeeId);
}

const app = new App();
void app.boot();
