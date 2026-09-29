/**
 * The Founder Command Center application: one living company universe. Boot → session check → universe
 * projection → renderer (WebGL 2, or the SVG fallback) → lenses, attention, conversation, governed
 * confirmation, timeline. Server-Sent "changed" nudges re-project; nothing polls.
 */
import { ar, deptName, fmtRelative, INTENT_AR, LEVEL_AR, RELATION_AR, SOURCE_AR } from '../model/format.js';
import { layoutUniverse } from '../model/layout.js';
import { applyLens, cameraTargetFor, chainNodeIds } from '../model/lenses.js';
import type { CompanyUniverse, Emphasis, Layout, LayoutNode, Lens } from '../model/types.js';
import { api, ApiError, subscribeChanges } from './api.js';
import { LabelLayer } from './labels.js';
import { h, renderActivity, renderAttentionRail, renderCalendar, renderConversation, renderEmployeeFocus, renderGoalFocus, renderHealthLine, renderPalette, renderPreview, renderTimeline, type PanelHost } from './panels.js';
import type { UniverseRenderer } from './renderer.js';
import { WebGlUniverse, webgl2Available } from './scene.js';
import { SvgUniverse } from './svg-renderer.js';

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
  renderer: UniverseRenderer;
  labels: LabelLayer;
  activity: { at: string; text: string; kind: 'semantic' | 'system' }[] = [];
  stream: 'open' | 'closed' = 'closed';
  reduced: boolean;
  paletteResult: Json | null = null;
  timelineBounds = { earliest: new Date(Date.now() - 86_400_000).toISOString(), now: new Date().toISOString() };
  #refreshing = false;
  #dirty = false;
  #previousRelationIds = new Set<string>();
  #previousAttentionIds = new Set<string>();

  constructor() {
    const forceSvg = new URLSearchParams(location.search).get('renderer') === 'svg';
    this.renderer = !forceSvg && webgl2Available() ? new WebGlUniverse() : new SvgUniverse();
    this.labels = new LabelLayer($('labels'));
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stored = safeGet('qandeel.reducedMotion');
    this.reduced = stored === null ? mq.matches : stored === '1';
    mq.addEventListener('change', () => {
      if (safeGet('qandeel.reducedMotion') === null) this.setReduced(mq.matches);
    });
  }

  async boot(): Promise<void> {
    document.documentElement.dataset.renderer = this.renderer.kind;
    try {
      await api.get('/api/session');
    } catch (e) {
      this.lock(e instanceof ApiError ? e.code : 'FOUNDER_SESSION_INVALID');
      return;
    }
    const stage = $('universe');
    this.renderer.mount(stage, {
      onSelect: (id, node) => this.select(id, node),
      onHover: (id) => stage.setAttribute('data-hover', id ?? ''),
      onDistance: (d) => this.labels.setDistance(d),
    });
    this.renderer.setReducedMotion(this.reduced);
    this.labels.bind(this.renderer, (id) => {
      const n = this.layout?.byId.get(id);
      if (n) this.select(id, n);
    });
    $('motion-toggle').addEventListener('click', () => this.setReduced(!this.reduced));
    this.#renderMotionToggle();
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('keydown', (e) => this.#hotkeys(e));
    $('logout').addEventListener('click', () => void api.post('/api/session/logout').then(() => location.reload()));
    $('palette-open').addEventListener('click', () => this.openPalette());
    $('legend-toggle').addEventListener('click', () => $('legend').toggleAttribute('hidden'));
    this.#paletteInput();
    await this.refresh(true);
    subscribeChanges(
      () => void this.refresh(false),
      (s) => {
        this.stream = s;
        renderHealthLine($('health'), this.universe, s);
      },
    );
    const tick = (): void => {
      this.labels.update();
      requestAnimationFrame(tick);
    };
    tick();
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
    this.renderer.setReducedMotion(reduced);
    this.#renderMotionToggle();
  }

  #renderMotionToggle(): void {
    const b = $('motion-toggle');
    b.textContent = this.reduced ? 'الحركة: مخفّضة' : 'الحركة: كاملة';
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
        renderAttentionRail($('rail'), attention, this, this.lane);
        renderCalendar($('calendar'), calendar, this);
        this.timelineBounds = { earliest: timeline.earliest, now: timeline.now };
      }
      renderTimeline($('timeline'), { live: at === null, at, earliest: this.timelineBounds.earliest, now: this.timelineBounds.now }, this);
      renderHealthLine($('health'), u, this.stream);
      if (initial) renderActivity($('activity'), this.activity);
      if (this.lens.kind === 'EMPLOYEE' || this.lens.kind === 'CONVERSATION' || this.lens.kind === 'GOAL') await this.#renderFocus();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.lock(e.code);
      else this.note(`تعذّر التحديث (${e instanceof ApiError ? e.code : 'ERROR'})`, 'system');
    } finally {
      this.#refreshing = false;
      if (this.#dirty) {
        this.#dirty = false;
        void this.refresh(false);
      }
    }
  }

  applyUniverse(u: CompanyUniverse, initial: boolean): void {
    const previous = this.universe;
    this.universe = u;
    this.layout = layoutUniverse(u);
    this.renderer.setLayout(this.layout, this.lens);
    this.labels.setLayout(this.layout);
    this.renderer.setLive(u.live);
    document.documentElement.dataset.live = u.live ? 'live' : 'history';
    this.#applyLens(initial);
    // Semantic motion only on real change between snapshots: new relations pulse, new attention arrives.
    if (previous && u.live) {
      const relationIds = new Set(u.relations.map((r) => r.id));
      for (const r of u.relations) if (!this.#previousRelationIds.has(r.id)) {
        this.renderer.pulseEdge(r.id);
        this.note(`علاقة جديدة: ${ar(RELATION_AR, r.kind)} — ${this.nameOf(r.from)} ← ${this.nameOf(r.to)}`, 'semantic');
      }
      this.#previousRelationIds = relationIds;
      const attentionIds = new Set(u.attention.map((a) => a.id));
      for (const a of u.attention) if (!this.#previousAttentionIds.has(a.id)) {
        const owner = a.ownerRef?.startsWith('employee:') ? a.ownerRef : null;
        this.renderer.arriveAttention(`attention:${a.id}`, owner);
        this.note(`يحتاجك: ${ar(SOURCE_AR, a.sourceKind)} — ${ar(LEVEL_AR, a.level)}`, 'semantic');
      }
      this.#previousAttentionIds = attentionIds;
    } else {
      this.#previousRelationIds = new Set(u.relations.map((r) => r.id));
      this.#previousAttentionIds = new Set(u.attention.map((a) => a.id));
    }
  }

  nameOf(ref: string): string {
    if (ref === 'founder' || ref.startsWith('founder:')) return 'المؤسس';
    const e = this.universe?.employees.find((x) => `employee:${x.id}` === ref);
    return e ? `${e.name.given} ${e.name.family}` : ref;
  }

  #applyLens(immediate: boolean): void {
    if (!this.universe || !this.layout) return;
    this.emphasis = applyLens(this.universe, this.layout, this.lens);
    this.renderer.setEmphasis(this.emphasis);
    this.labels.setEmphasis(this.emphasis);
    const target = cameraTargetFor(this.layout, this.emphasis);
    this.renderer.focus(target, immediate);
    this.renderer.setSelection(this.emphasis.focusNodeId);
    this.labels.setSelection(this.emphasis.focusNodeId);
    $('lens').textContent = lensTitle(this.lens, this.universe, this.layout);
    document.documentElement.dataset.lens = this.lens.kind;
  }

  setLens(lens: Lens): void {
    this.lens = lens;
    this.#applyLens(false);
    const focus = $('focus');
    if (lens.kind === 'EMPLOYEE' || lens.kind === 'GOAL' || lens.kind === 'CONVERSATION') {
      focus.hidden = false;
      void this.#renderFocus();
    } else {
      focus.hidden = true;
      focus.replaceChildren();
    }
    if (lens.kind === 'ATTENTION') {
      this.lane = lens.lane;
      void api.get<{ items: Json[]; health: Json }>('/api/attention').then((a) => renderAttentionRail($('rail'), a, this, this.lane));
    }
  }

  async #renderFocus(): Promise<void> {
    const focus = $('focus');
    try {
      if (this.lens.kind === 'EMPLOYEE') renderEmployeeFocus(focus, await api.get<Json>(`/api/employees/${this.lens.employeeId}`), this);
      else if (this.lens.kind === 'GOAL') renderGoalFocus(focus, await api.get<Json>(`/api/goals/${this.lens.goalId}`), this);
      else if (this.lens.kind === 'CONVERSATION') renderConversation(focus, await api.get<{ thread: Json; messages: Json[]; pending: Json[] }>(`/api/threads/${this.lens.threadId}/messages`), this, this.universe);
    } catch (e) {
      focus.replaceChildren(h('p', { class: 'muted', text: `تعذّر فتح التفاصيل (${e instanceof ApiError ? e.code : 'ERROR'})` }));
    }
  }

  select(id: string, node: LayoutNode): void {
    if (node.kind === 'founder') return this.setLens({ kind: 'LIVE' });
    if (node.kind === 'employee' && node.employeeId) return this.setLens(node.seatKind === 'CEO' ? { kind: 'EMPLOYEE', employeeId: node.employeeId } : { kind: 'EMPLOYEE', employeeId: node.employeeId });
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

  openThread(threadId: string, employeeId: string): void {
    this.setLens({ kind: 'CONVERSATION', threadId, employeeId });
  }

  startConversation(employeeId: string | null): void {
    void api
      .post<{ thread: Json }>('/api/threads', { employeeId })
      .then((r) => this.openThread(String(r.thread.id), String(r.thread.employeeId)))
      .catch((e: unknown) => this.note(`تعذّر فتح المحادثة (${e instanceof ApiError ? e.code : 'ERROR'})`, 'system'));
  }

  showLane(lane: 'NEEDS_ME' | 'CEO_BRIEFS' | 'THREADS' | null): void {
    this.setLens({ kind: 'ATTENTION', lane });
  }

  returnToLive(): void {
    this.historyAt = null;
    this.lane = null;
    this.setLens({ kind: 'LIVE' });
    void this.refresh(false);
  }

  scrubTo(at: string): void {
    this.historyAt = at;
    this.lens = { kind: 'HISTORY', at };
    void this.refresh(false);
    this.note(`عرض الشركة كما كانت ${fmtRelative(at)}`, 'system');
  }

  focusSource(sourceRef: string): void {
    const [kind, id] = sourceRef.split(':') as [string, string];
    if (kind === 'goal') return this.openGoal(id);
    if (kind === 'employee') return this.openEmployee(id);
    if (kind === 'department') return this.setLens({ kind: 'DEPARTMENT', departmentId: id });
    if (kind === 'thread') {
      const t = this.universe?.attention.find((a) => a.sourceRef === sourceRef);
      const emp = t?.ownerRef?.replace('employee:', '') ?? '';
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
      this.note(intent.kind === 'READ' ? `أمر قراءة: ${ar(INTENT_AR, String(intent.intent))}` : intent.kind === 'MUTATING' ? `فعل محكوم: ${ar(INTENT_AR, String(intent.intent))} — بانتظار التأكيد` : 'أمر غير مفهوم', 'system');
    } catch (e) {
      this.paletteResult = { intent: { kind: 'UNKNOWN' } };
      this.note(`تعذّر الأمر (${e instanceof ApiError ? e.code : 'ERROR'})`, 'system');
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
    if (lens === 'DEPARTMENT' && target) return this.setLens({ kind: 'DEPARTMENT', departmentId: target });
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
      const RESULT_AR: Record<string, string> = { budget: 'غلاف مالي', approval: 'موافقة', goal: 'هدف', staffing_request: 'طلب توظيف', review_conflict: 'خلاف مراجعة', authority_delegation: 'تفويض صلاحية' };
      const kind = String(r.resultRef).split(':')[0] ?? '';
      this.note(`نُفّذ الفعل المحكوم عند حدّه الحقيقي (${RESULT_AR[kind] ?? kind})`, 'semantic');
      await this.refresh(false);
    } catch (e) {
      this.note(`لم يُنفّذ الفعل (${e instanceof ApiError ? e.code : 'ERROR'})`, 'system');
    }
  }

  async rejectPreview(previewId: string): Promise<void> {
    $('preview').hidden = true;
    await api.post(`/api/previews/${previewId}/reject`, { reasonCode: 'founder.cancelled' }).catch(() => undefined);
    this.note('أُلغيت المعاينة. لم يتغير شيء.', 'system');
  }

  async dismissAttention(itemId: string): Promise<void> {
    await api.post(`/api/attention/${itemId}/dismiss`, { reasonCode: 'founder.dismissed' }).catch((e: unknown) => this.note(`تعذّر التجاهل (${e instanceof ApiError ? e.code : 'ERROR'})`, 'system'));
    await this.refresh(false);
  }

  async sendMessage(threadId: string, purpose: string, body: string): Promise<void> {
    try {
      await api.post(`/api/threads/${threadId}/messages`, { purpose, body });
      this.note('أُرسلت رسالتك؛ الموظف يعمل على الرد.', 'semantic');
      await this.refresh(false);
    } catch (e) {
      this.note(`لم تُرسل الرسالة (${e instanceof ApiError ? e.code : 'ERROR'})`, 'system');
    }
  }

  note(text: string, kind: 'semantic' | 'system'): void {
    this.activity.push({ at: new Date().toISOString(), text, kind });
    if (this.activity.length > 40) this.activity.shift();
    renderActivity($('activity'), this.activity);
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
    } else if (e.key === 'F6') {
      e.preventDefault();
      this.labels.focusFirst();
    }
  }
}

function lensTitle(lens: Lens, u: CompanyUniverse, layout: Layout): string {
  switch (lens.kind) {
    case 'LIVE':
      return 'الشركة الحيّة';
    case 'HISTORY':
      return `لحظة سابقة — ${fmtRelative(lens.at)}`;
    case 'ATTENTION':
      return lens.lane === null ? 'انتباه المؤسس' : lens.lane === 'NEEDS_ME' ? 'يحتاجني' : lens.lane === 'CEO_BRIEFS' ? 'موجزات المدير التنفيذي' : 'محادثاتي';
    case 'CEO':
      return 'تركيز: المدير التنفيذي';
    case 'EMPLOYEE':
    case 'CONVERSATION': {
      const n = layout.byId.get(`employee:${lens.employeeId}`);
      return `${lens.kind === 'CONVERSATION' ? 'محادثة' : 'تركيز'}: ${n?.label ?? ''}`;
    }
    case 'GOAL':
      return `هدف: ${u.goals.find((g) => g.id === lens.goalId)?.title ?? ''}`;
    case 'DEPARTMENT': {
      const d = u.departments.find((x) => x.id === lens.departmentId);
      return `قسم: ${d ? deptName(d.code, d.name) : ''}`;
    }
    case 'BLOCKED':
      return 'المتوقف الآن';
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
