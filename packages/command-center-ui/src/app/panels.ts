/**
 * The DOM surfaces around the universe: the attention rail (start side), the focus panel (end side), the
 * conversation panel, the command palette, the governed-action confirmation, the timeline control, the
 * calendar strip and the activity strip. Every control names its action; every Arabic string is written
 * in Arabic structure; codes and IDs are LTR islands.
 */
import { ACTION_AR, ar, countNoun, deptName, fmtDateTime, fmtMoneyMicros, fmtNumber, fmtRelative, FIELD_AR, INTENT_AR, KIND_AR, LANE_AR, LEVEL_AR, PURPOSE_AR, RELATION_AR, SOURCE_AR, STATE_AR } from '../model/format.js';
import type { CompanyUniverse } from '../model/types.js';

type Json = Record<string, unknown>;

export const h = (tag: string, attrs: Record<string, string | number | boolean> = {}, ...children: (Node | string | null | undefined)[]): HTMLElement => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (typeof v === 'boolean') {
      if (v) e.setAttribute(k, '');
    } else e.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
};
const ltr = (text: string, cls = 'code'): HTMLElement => h('span', { class: cls, dir: 'ltr', text });

export interface PanelHost {
  openEmployee(id: string): void;
  openGoal(id: string): void;
  openThread(threadId: string, employeeId: string): void;
  startConversation(employeeId: string | null): void;
  runCommand(text: string): Promise<void>;
  confirmPreview(previewId: string, fingerprint: string): Promise<void>;
  rejectPreview(previewId: string): Promise<void>;
  dismissAttention(itemId: string): Promise<void>;
  sendMessage(threadId: string, purpose: string, body: string): Promise<void>;
  showLane(lane: 'NEEDS_ME' | 'CEO_BRIEFS' | 'THREADS' | null): void;
  returnToLive(): void;
  scrubTo(at: string): void;
  focusSource(sourceRef: string): void;
  /** A human name for an entity ref (`employee:<id>` → the person's name; `founder` → المؤسس; else the ref). */
  nameOf(ref: string): string;
}

// --- attention rail -----------------------------------------------------------------------------------

export function renderAttentionRail(root: HTMLElement, data: { items: Json[]; health: Json }, host: PanelHost, activeLane: string | null): void {
  root.replaceChildren();
  const lanes: ('NEEDS_ME' | 'CEO_BRIEFS' | 'THREADS')[] = ['NEEDS_ME', 'CEO_BRIEFS', 'THREADS'];
  const tabs = h('div', { class: 'rail-tabs', role: 'tablist', 'aria-label': 'مسارات الانتباه' });
  for (const lane of lanes) {
    const count = data.items.filter((i) => i.lane === lane).length;
    const b = h('button', { type: 'button', role: 'tab', class: `rail-tab${activeLane === lane ? ' is-active' : ''}`, 'aria-selected': activeLane === lane ? 'true' : 'false' }, h('span', { text: LANE_AR[lane] ?? lane }), h('span', { class: 'count', text: String(count) }));
    b.addEventListener('click', () => host.showLane(activeLane === lane ? null : lane));
    tabs.append(b);
  }
  root.append(h('h2', { class: 'rail-title', text: 'انتباه المؤسس' }), tabs);
  const list = h('ul', { class: 'rail-list', role: 'list' });
  const items = data.items.filter((i) => activeLane === null || i.lane === activeLane);
  if (items.length === 0) list.append(h('li', { class: 'rail-empty', text: activeLane === null ? 'لا شيء يحتاجك الآن. الشركة تعمل.' : 'لا عناصر في هذا المسار.' }));
  for (const i of items) list.append(attentionItem(i, host));
  root.append(list);
}

function attentionItem(i: Json, host: PanelHost): HTMLElement {
  const level = String(i.level);
  const li = h('li', { class: `rail-item level-${level.toLowerCase()}` });
  const head = h('div', { class: 'rail-item-head' }, h('span', { class: `pill pill-${level.toLowerCase()}`, text: ar(LEVEL_AR, level) }), h('span', { class: 'rail-kind', text: ar(SOURCE_AR, String(i.sourceKind)) }), h('span', { class: 'rail-time', text: fmtRelative(String(i.lastSignalAt)) }));
  li.append(head);
  const body = h('div', { class: 'rail-item-body' });
  const approval = i.approval as Json | undefined;
  const message = i.message as Json | undefined;
  const staffing = i.staffing as Json | undefined;
  const goal = i.goal as Json | undefined;
  const escalation = i.escalation as Json | undefined;
  if (approval) {
    const action = String(approval.action);
    const subject = host.nameOf(String(approval.subjectRef));
    body.append(h('p', {}, 'موافقة ', h('strong', { text: String(approval.risk) }), ' على ', ACTION_AR[action] ? h('span', { text: ACTION_AR[action] }) : ltr(action), ' لصالح ', subject === String(approval.subjectRef) ? ltr(subject) : h('span', { text: subject })));
  }
  if (message) {
    const brief = message.brief as Json | null;
    if (brief) {
      body.append(
        h('dl', { class: 'brief' }, h('dt', { text: 'ماذا يحدث؟' }), h('dd', { text: String(brief.happening) }), h('dt', { text: 'لماذا يهم؟' }), h('dd', { text: String(brief.matters) }), h('dt', { text: 'التوصية' }), h('dd', { text: String(brief.recommendation) }), h('dt', { text: 'هل تحتاج قرارًا مني؟' }), h('dd', { text: brief.decisionNeeded ? `نعم — ${String(brief.decision ?? '')}` : 'لا' })),
      );
    } else body.append(h('p', { class: 'msg-body', text: String(message.body) }));
  }
  if (staffing) body.append(h('p', {}, 'طلب توظيف: ', h('strong', { text: String(staffing.positionTitle) }), ' — توصية المدير التنفيذي: ', h('span', { text: staffing.ceoRecommendation === 'APPROVE' ? 'وافق' : staffing.ceoRecommendation === 'REJECT' ? 'ارفض' : 'بلا' })));
  if (goal) body.append(h('p', {}, 'هدف مقترح: ', h('strong', { text: String(goal.title) })));
  if (escalation) body.append(h('p', {}, 'تصعيد على عمل ', ltr(String(escalation.childWorkItemId).slice(0, 8))));
  li.append(body);
  const actions = h('div', { class: 'rail-actions' });
  const open = h('button', { type: 'button', class: 'btn btn-quiet', text: 'افتح المصدر' });
  open.addEventListener('click', () => host.focusSource(String(i.sourceRef)));
  actions.append(open);
  if (approval) {
    const approve = h('button', { type: 'button', class: 'btn btn-primary', text: 'راجع القرار' });
    approve.addEventListener('click', () => void host.runCommand(`وافق ${String(approval.id)}`));
    actions.append(approve);
  }
  if (goal) {
    const approve = h('button', { type: 'button', class: 'btn btn-primary', text: 'اعتمد الهدف' });
    approve.addEventListener('click', () => void host.runCommand(`وافق على هدف ${String(goal.title)}`));
    actions.append(approve);
  }
  if (message) {
    const reply = h('button', { type: 'button', class: 'btn btn-quiet', text: 'ردّ' });
    reply.addEventListener('click', () => host.openThread(String(message.threadId), String(i.ownerRef ?? '').replace('employee:', '')));
    actions.append(reply);
  }
  const dismiss = h('button', { type: 'button', class: 'btn btn-ghost', text: 'تجاهل', 'aria-label': 'تجاهل هذا العنصر (الصمت ليس موافقة)' });
  dismiss.addEventListener('click', () => void host.dismissAttention(String(i.id)));
  actions.append(dismiss);
  li.append(actions);
  return li;
}

// --- focus panel: employee ---------------------------------------------------------------------------

export function renderEmployeeFocus(root: HTMLElement, d: Json, host: PanelHost): void {
  root.replaceChildren();
  const e = d.employee as Json;
  const seat = d.seat as Json | null;
  const dept = d.department as Json | null;
  const name = e.name as { given: string; family: string };
  const manager = d.manager as Json | null;
  const chain = (e.chain as Json[]) ?? [];
  root.append(
    closeButton(host),
    h('p', { class: 'eyebrow-free kicker', text: dept ? deptName(String(dept.code), String(dept.name)) : 'نطاق الشركة' }),
    h('h2', { class: 'focus-title', text: `${name.given} ${name.family}` }),
    h('p', { class: 'focus-sub' }, h('span', { text: seat ? String(seat.title) : 'بلا مقعد' }), seat && seat.holderKind === 'ACTING' ? h('span', { class: 'pill pill-acting', text: 'بالإنابة' }) : null, h('span', { class: `pill pill-state`, text: ar(STATE_AR, String(e.state)) })),
  );
  const chainEl = h('ol', { class: 'chain', 'aria-label': 'سلسلة الإدارة حتى المؤسس' });
  for (const link of chain) {
    const li = h('li', {}, h('span', { class: 'chain-kind', text: ar(KIND_AR, String(link.kind)) }));
    if (link.employeeId && link.employeeId !== e.id) {
      const b = h('button', { type: 'button', class: 'link', text: 'افتح' });
      b.addEventListener('click', () => host.openEmployee(String(link.employeeId)));
      li.append(b);
    } else if (link.kind !== 'FOUNDER' && !link.employeeId) li.append(h('span', { class: 'muted', text: 'شاغر' }));
    chainEl.append(li);
  }
  root.append(h('section', { class: 'focus-section' }, h('h3', { text: manager ? `يتبع: ${ar(KIND_AR, String(manager.kind))}` : 'السلسلة' }), chainEl));
  const work = (d.work as Json[]) ?? [];
  const workEl = h('ul', { class: 'work-list' });
  if (work.length === 0) workEl.append(h('li', { class: 'muted', text: 'لا عمل حي الآن.' }));
  for (const w of work) {
    const goals = (w.goalIds as string[]) ?? [];
    const li = h('li', { class: `work state-${String(w.state).toLowerCase()}` }, h('span', { class: 'work-state', text: ar(STATE_AR, String(w.state)) }), h('span', { class: 'work-objective', text: String(w.objective) }));
    if (w.blockedReason) li.append(h('span', { class: 'work-reason', text: `السبب: ${String(w.blockedReason)}` }));
    if (w.waitReason) li.append(h('span', { class: 'work-reason' }, 'ينتظر: ', ltr(String(w.waitReason))));
    for (const gid of goals) {
      const g = h('button', { type: 'button', class: 'link', text: 'يخدم هدفًا' });
      g.addEventListener('click', () => host.openGoal(gid));
      li.append(g);
    }
    workEl.append(li);
  }
  root.append(h('section', { class: 'focus-section' }, h('h3', { text: 'يعمل الآن على' }), workEl));
  const rel = (d.relations as Json[]) ?? [];
  if (rel.length > 0) {
    const relEl = h('ul', { class: 'rel-list' });
    for (const r of rel) {
      const other = String(r.from) === `employee:${String(e.id)}` ? String(r.to) : String(r.from);
      const li = h('li', {}, h('span', { class: 'rel-kind', text: ar(RELATION_AR, String(r.kind)) }), h('span', { class: 'muted', text: String(r.from) === `employee:${String(e.id)}` ? 'إلى' : 'من' }));
      if (other === 'founder') li.append(h('span', { text: 'المؤسس' }));
      else {
        const b = h('button', { type: 'button', class: 'link', text: host.nameOf(other) });
        b.addEventListener('click', () => host.openEmployee(other.replace('employee:', '')));
        li.append(b);
      }
      relEl.append(li);
    }
    root.append(h('section', { class: 'focus-section' }, h('h3', { text: 'علاقات حية' }), relEl));
  }
  const budget = d.budget as Json | null;
  const grants = (d.grants as Json[]) ?? [];
  const ctxEl = h('dl', { class: 'facts' });
  if (budget) ctxEl.append(h('dt', { text: 'الغلاف المالي' }), h('dd', { text: `${fmtMoneyMicros(Number(budget.spentMoney), String(budget.currency))} من ${fmtMoneyMicros(Number(budget.capMoney), String(budget.currency))}` }));
  ctxEl.append(h('dt', { text: 'الصلاحيات الحية' }), h('dd', {}, grants.length === 0 ? 'لا صلاحيات ممنوحة' : grants.map((g) => `${String(g.capability)} (${String(g.riskCeiling)})`).join('، ')));
  ctxEl.append(h('dt', { text: 'الدور' }), h('dd', {}, ltr(String(e.roleRef))));
  root.append(h('section', { class: 'focus-section' }, h('h3', { text: 'السياق' }), ctxEl));
  const talk = h('button', { type: 'button', class: 'btn btn-primary btn-wide', text: 'تحدّث معه الآن' });
  talk.addEventListener('click', () => host.startConversation(String(e.id)));
  const ceiling = h('button', { type: 'button', class: 'btn btn-quiet btn-wide', text: 'حدّد سقف الميزانية' });
  ceiling.addEventListener('click', () => void host.runCommand(`وافق على حملة ${name.given} ${name.family} بميزانية 0`));
  root.append(h('div', { class: 'focus-actions' }, talk, budget ? ceiling : null));
}

export function renderGoalFocus(root: HTMLElement, d: Json, host: PanelHost): void {
  root.replaceChildren();
  const g = d.goal as Json;
  root.append(closeButton(host), h('p', { class: 'kicker', text: g.kind === 'COMPANY' ? 'هدف الشركة' : 'هدف القسم' }), h('h2', { class: 'focus-title', text: String(g.title) }), h('p', { class: 'focus-sub' }, h('span', { class: 'pill pill-state', text: ar(STATE_AR, String(g.state)) }), g.horizonTo ? h('span', { class: 'muted', text: `الأفق: ${fmtDateTime(String(g.horizonTo))}` }) : null));
  root.append(h('p', { class: 'focus-summary', text: String(g.summary) }));
  const criteria = (g.successCriteria as string[]) ?? [];
  if (criteria.length) root.append(h('section', { class: 'focus-section' }, h('h3', { text: 'معايير النجاح' }), h('ul', { class: 'plain' }, ...criteria.map((c) => h('li', { text: c })))));
  const work = (d.work as Json[]) ?? [];
  const path = h('ol', { class: 'goal-path', 'aria-label': 'كيف يتحول الهدف إلى تنفيذ' });
  path.append(h('li', {}, h('span', { class: 'step', text: 'الهدف' }), h('span', { text: String(g.title) })));
  const owner = host.nameOf(String(g.ownerRef));
  path.append(h('li', {}, h('span', { class: 'step', text: 'القيادة المسؤولة' }), owner === String(g.ownerRef) ? ltr(owner) : h('span', { text: owner })));
  const deptCount = ((d.departments as string[]) ?? []).length;
  path.append(h('li', {}, h('span', { class: 'step', text: 'الأقسام' }), h('span', { text: deptCount === 0 ? 'لا قسم مرتبط بعد' : countNoun(deptCount, { one: 'قسم واحد', two: 'قسمان', few: 'أقسام', many: 'قسمًا' }) })));
  const workEl = h('ul', { class: 'work-list' });
  if (work.length === 0) workEl.append(h('li', { class: 'muted', text: 'لا عمل مرتبط بعد — الهدف لم يتحول إلى تنفيذ.' }));
  for (const w of work) {
    const li = h('li', { class: `work state-${String(w.state).toLowerCase()}` }, h('span', { class: 'work-state', text: ar(STATE_AR, String(w.state)) }), h('span', { class: 'work-objective', text: String(w.objective) }));
    if (w.ownerEmployeeId) {
      const b = h('button', { type: 'button', class: 'link', text: 'المالك' });
      b.addEventListener('click', () => host.openEmployee(String(w.ownerEmployeeId)));
      li.append(b);
    }
    workEl.append(li);
  }
  path.append(h('li', {}, h('span', { class: 'step', text: 'بنود العمل' }), workEl));
  const paths = (d.paths as Json[]) ?? [];
  path.append(h('li', {}, h('span', { class: 'step', text: 'مراجعات وموافقات' }), h('span', { text: paths.length === 0 ? 'لا مراجعة أو موافقة مفتوحة' : paths.map((p) => ar(RELATION_AR, String(p.kind))).join('، ') })));
  root.append(h('section', { class: 'focus-section' }, h('h3', { text: 'من الهدف إلى الفعل' }), path));
  const children = (d.children as Json[]) ?? [];
  if (children.length) root.append(h('section', { class: 'focus-section' }, h('h3', { text: 'أهداف مشتقة' }), h('ul', { class: 'plain' }, ...children.map((c) => { const b = h('button', { type: 'button', class: 'link', text: String(c.title) }); b.addEventListener('click', () => host.openGoal(String(c.id))); return h('li', {}, b, h('span', { class: 'muted', text: ` · ${ar(STATE_AR, String(c.state))}` })); }))));
  if (g.kind === 'COMPANY' && g.state === 'PROPOSED') {
    const approve = h('button', { type: 'button', class: 'btn btn-primary btn-wide', text: 'اعتمد هذا الهدف' });
    approve.addEventListener('click', () => void host.runCommand(`وافق على هدف ${String(g.title)}`));
    root.append(h('div', { class: 'focus-actions' }, approve));
  }
}

function closeButton(host: PanelHost): HTMLElement {
  const b = h('button', { type: 'button', class: 'btn btn-ghost close', 'aria-label': 'العودة إلى الشركة الحية', text: '↩ الحيّ' });
  b.addEventListener('click', () => host.returnToLive());
  return b;
}

// --- conversation ------------------------------------------------------------------------------------

export function renderConversation(root: HTMLElement, d: { thread: Json; messages: Json[]; pending: Json[] }, host: PanelHost, universe: CompanyUniverse | null): void {
  root.replaceChildren();
  const t = d.thread;
  const employee = universe?.employees.find((e) => e.id === t.employeeId);
  const name = employee ? `${employee.name.given} ${employee.name.family}` : String(t.subject);
  root.append(closeButton(host), h('p', { class: 'kicker', text: t.kind === 'FOUNDER_CEO' || t.kind === 'CEO_BRIEF' ? 'المدير التنفيذي' : 'محادثة مباشرة' }), h('h2', { class: 'focus-title', text: name }), h('p', { class: 'focus-sub muted', text: 'الحديث لا يمنح صلاحية: أي أمر يمسّ الميزانية أو الاعتماد يتحول إلى معاينة محكومة تؤكدها بنفسك.' }));
  const list = h('ol', { class: 'messages', 'aria-live': 'polite' });
  for (const m of d.messages) {
    const mine = m.senderKind === 'FOUNDER';
    const li = h('li', { class: `message ${mine ? 'from-founder' : 'from-employee'}` }, h('div', { class: 'message-meta' }, h('span', { class: 'pill', text: ar(PURPOSE_AR, String(m.purpose)) }), h('span', { class: 'muted', text: fmtRelative(String(m.createdAt)) })));
    const brief = m.brief as Json | null;
    if (brief) li.append(h('dl', { class: 'brief' }, h('dt', { text: 'ماذا يحدث؟' }), h('dd', { text: String(brief.happening) }), h('dt', { text: 'لماذا يهم؟' }), h('dd', { text: String(brief.matters) }), h('dt', { text: 'التوصية' }), h('dd', { text: String(brief.recommendation) }), h('dt', { text: 'قرار مطلوب؟' }), h('dd', { text: brief.decisionNeeded ? `نعم — ${String(brief.decision ?? '')}` : 'لا' })));
    else li.append(h('p', { class: 'msg-body', text: String(m.body) }));
    list.append(li);
  }
  for (const p of d.pending) list.append(h('li', { class: 'message pending' }, h('span', { class: 'muted' }, 'ينتظر الرد — عمل الموظف ', h('span', { class: 'pill', text: ar(STATE_AR, String(p.workItemState)) }))));
  root.append(list);
  const form = h('form', { class: 'composer' });
  const purpose = h('select', { 'aria-label': 'غرض الرسالة', name: 'purpose' }) as HTMLSelectElement;
  for (const p of ['QUESTION', 'REQUEST', 'DECISION_REQUEST', 'FYI', 'CORRECTION']) purpose.append(h('option', { value: p, text: ar(PURPOSE_AR, p) }));
  const text = h('textarea', { 'aria-label': 'نص الرسالة', name: 'body', rows: 3, placeholder: 'اكتب للموظف مباشرة…', maxlength: 4000 }) as HTMLTextAreaElement;
  const send = h('button', { type: 'submit', class: 'btn btn-primary', text: 'أرسل' });
  form.append(purpose, text, send);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = text.value.trim();
    if (!body) return;
    send.setAttribute('disabled', '');
    void host.sendMessage(String(t.id), purpose.value, body).finally(() => send.removeAttribute('disabled'));
    text.value = '';
  });
  root.append(form);
}

// --- command palette and governed confirmation ---------------------------------------------------

export function renderPalette(root: HTMLElement, host: PanelHost, result: Json | null, busy: boolean): HTMLInputElement {
  root.replaceChildren();
  const form = h('form', { class: 'palette-form', role: 'search' });
  const input = h('input', { type: 'text', class: 'palette-input', placeholder: 'اسأل الشركة: افتح ليلى، ما المتوقف؟، من يعمل على إطلاق السعودية؟', 'aria-label': 'أمر المؤسس', autocomplete: 'off', maxlength: 400 }) as HTMLInputElement;
  const go = h('button', { type: 'submit', class: 'btn btn-primary', text: busy ? '…' : 'نفّذ' });
  form.append(input, go);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (v) void host.runCommand(v);
  });
  root.append(form);
  if (result) {
    const intent = result.intent as Json;
    const line = h('p', { class: 'palette-result' });
    if (intent.kind === 'UNKNOWN') line.textContent = 'لم أفهم الأمر. جرّب: «افتح <اسم>»، «اعرض قسم النمو»، «ما المتوقف؟»، «يحتاج موافقتي».';
    else if (intent.kind === 'READ') line.append(h('span', { class: 'pill', text: 'قراءة' }), ' ', h('span', { text: 'غيّرتُ التركيز، لم أغيّر أي حقيقة.' }));
    else if (result.preview) line.append(h('span', { class: 'pill pill-needs_decision', text: 'فعل محكوم' }), ' ', h('span', { text: 'أعددت معاينة مهيكلة. لا شيء يتغير قبل تأكيدك.' }));
    else line.append(h('span', { class: 'pill', text: 'فعل' }), ' ', h('span', { text: 'لم أجد هدفًا واحدًا محددًا لهذا الفعل. اختر من الخريطة أو حدد الاسم.' }));
    root.append(line);
    const matches = (result.matches as Json[]) ?? [];
    if (matches.length > 1) {
      const ul = h('ul', { class: 'palette-matches' });
      for (const m of matches) {
        const b = h('button', { type: 'button', class: 'link', text: String(m.label) });
        b.addEventListener('click', () => (m.kind === 'employee' ? host.openEmployee(String(m.id)) : m.kind === 'goal' ? host.openGoal(String(m.id)) : host.focusSource(`${String(m.kind)}:${String(m.id)}`)));
        ul.append(h('li', {}, b));
      }
      root.append(ul);
    }
  }
  return input;
}

export function renderPreview(root: HTMLElement, preview: Json, host: PanelHost): void {
  root.replaceChildren();
  const payload = (preview.payload as Json) ?? {};
  const currency = typeof payload.currency === 'string' ? payload.currency : 'EGP';
  // The structured act in the Founder's words: every field named, money and counts formatted, IDs as LTR islands.
  const value = (k: string, v: unknown): HTMLElement => {
    if (k === 'capMoney' && typeof v === 'number') return h('span', { text: fmtMoneyMicros(v, currency) });
    if (k === 'capTokens' && typeof v === 'number') return h('span', { text: `${fmtNumber(v)} رمز` });
    if (k === 'decision') return h('span', { text: v === 'REJECT' ? 'رفض' : 'اعتماد' });
    if (k === 'activate') return h('span', { text: v ? 'نعم' : 'لا' });
    if (k === 'to' || k === 'resolution') return h('span', { text: ar(STATE_AR, String(v)) });
    if (k === 'scope') return h('span', { text: ar(KIND_AR, String(v)) === String(v) ? ({ EMPLOYEE: 'موظف', DEPARTMENT: 'إدارة', COMPANY: 'الشركة', WORK_ITEM: 'بند عمل' } as Record<string, string>)[String(v)] ?? String(v) : ar(KIND_AR, String(v)) });
    if (k === 'expiresAt' && typeof v === 'string') return h('span', { text: fmtDateTime(v) });
    return ltr(String(v));
  };
  const rows = Object.entries(payload).filter(([k]) => k !== 'reasonCode' && k !== 'currency');
  root.append(
    h('h2', { class: 'preview-title', text: `تأكيد فعل محكوم: ${ar(INTENT_AR, String(preview.intentKind))}` }),
    h('p', { class: 'muted', text: 'هذا ما سينفذ عند التأكيد — لا أكثر. النص الذي كتبته لا يغيّر شيئًا بذاته.' }),
    h('p', { class: 'preview-summary', text: String(preview.summary ?? preview.intentKind) }),
    h('dl', { class: 'facts' }, ...rows.flatMap(([k, v]) => [h('dt', {}, FIELD_AR[k] ? h('span', { text: FIELD_AR[k] }) : ltr(k)), h('dd', {}, value(k, v))])),
    h('p', { class: 'muted small' }, 'بصمة المعاينة: ', ltr(String(preview.fingerprint).slice(0, 16) + '…'), ' — تنتهي ', h('span', { text: fmtRelative(String(preview.expiresAt)) })),
  );
  const confirm = h('button', { type: 'button', class: 'btn btn-primary', text: 'أؤكد التنفيذ' });
  const cancel = h('button', { type: 'button', class: 'btn btn-quiet', text: 'إلغاء' });
  confirm.addEventListener('click', () => void host.confirmPreview(String(preview.id), String(preview.fingerprint)));
  cancel.addEventListener('click', () => void host.rejectPreview(String(preview.id)));
  root.append(h('div', { class: 'preview-actions' }, cancel, confirm));
  confirm.focus();
}

// --- timeline / calendar / activity ------------------------------------------------------------------

export function renderTimeline(root: HTMLElement, state: { live: boolean; at: string | null; earliest: string; now: string }, host: PanelHost): void {
  root.replaceChildren();
  const live = h('button', { type: 'button', class: `btn ${state.live ? 'btn-live' : 'btn-quiet'}`, text: state.live ? '● مباشر' : '↩ عودة إلى المباشر', 'aria-pressed': state.live ? 'true' : 'false' });
  live.addEventListener('click', () => host.returnToLive());
  const min = Date.parse(state.earliest);
  const max = Date.parse(state.now);
  const value = state.at ? Date.parse(state.at) : max;
  // The scrubber is an LTR island: earliest at the left, now at the right, next to the «الآن» label (a range input
  // in RTL would put its maximum on the left, away from the label that names it).
  // The step follows the span (about 240 stops, a minute at most, never coarser than the span itself), so a young
  // company with seconds of history scrubs just as well as one with months.
  const step = Math.max(1000, Math.min(60_000, Math.floor((max - min) / 240)));
  const range = h('input', { type: 'range', class: 'scrubber', dir: 'ltr', step: String(step), 'aria-label': 'لحظة التاريخ', 'aria-valuetext': state.at ? fmtDateTime(state.at) : 'الآن' }) as HTMLInputElement;
  // Bounds first, value last: a value applied before its bounds is clamped to the default 0–100 range.
  range.min = String(min);
  range.max = String(max);
  range.value = String(value);
  let timer = 0;
  range.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => host.scrubTo(new Date(Number(range.value)).toISOString()), 220);
  });
  const label = h('span', { class: 'time-label', text: state.at ? fmtDateTime(state.at) : 'الآن' });
  root.append(label, range, live);
}

export function renderCalendar(root: HTMLElement, d: { events: Json[] }, host: PanelHost): void {
  root.replaceChildren();
  root.append(h('h3', { class: 'strip-title', text: 'القادم' }));
  const KIND: Record<string, string> = { ACTING_ENDS: 'تنتهي الإنابة', DELEGATION_DUE: 'استحقاق تفويض', STAFFING_DECISION_DUE: 'قرار توظيف مستحق', GOAL_HORIZON: 'أفق هدف', WORK_DUE: 'استحقاق عمل', APPROVAL_EXPIRES: 'تنتهي موافقة', SESSION_EXPIRES: 'تنتهي جلستك' };
  const ul = h('ul', { class: 'strip-list' });
  const events = d.events.slice(0, 8);
  if (events.length === 0) ul.append(h('li', { class: 'muted', text: 'لا مواعيد خلال ثلاثين يومًا.' }));
  for (const e of events) {
    const li = h('li', {}, h('span', { class: 'strip-when', text: fmtRelative(String(e.at)) }), h('span', { text: `${KIND[String(e.kind)] ?? String(e.kind)}${e.title ? ' — ' + String(e.title) : ''}` }));
    if (String(e.ref).startsWith('goal:') || String(e.ref).startsWith('work_item:')) {
      const b = h('button', { type: 'button', class: 'link', text: 'افتح' });
      b.addEventListener('click', () => host.focusSource(String(e.ref)));
      li.append(b);
    }
    ul.append(li);
  }
  root.append(ul);
}

export function renderActivity(root: HTMLElement, lines: { at: string; text: string; kind: 'semantic' | 'system' }[]): void {
  // Empty state: what this strip is for, so silence reads as "nothing moved", never as a broken panel.
  const body = lines.length === 0 ? h('p', { class: 'strip-empty', text: 'لم يتحرك شيء بعد. كل حركة على الخريطة لها سطر هنا، والخلفية الحيّة لا تُحسب.' }) : h('ul', { class: 'strip-list' }, ...lines.slice(-6).reverse().map((l) => h('li', { class: `act-${l.kind}` }, h('span', { class: 'strip-when', text: fmtRelative(l.at) }), h('span', { text: l.text }))));
  root.replaceChildren(h('h3', { class: 'strip-title', text: 'ما تحرّك' }), body);
}

export function renderHealthLine(root: HTMLElement, u: CompanyUniverse | null, stream: 'open' | 'closed'): void {
  root.replaceChildren();
  if (!u) return;
  const s = u.signals;
  const parts = [`${s.running} قيد التنفيذ`, `${s.blocked} متوقف`, `${s.waitingApproval} ينتظر موافقة`, `${s.waitingReview} ينتظر مراجعة`, `${s.vacantSeats} مقعد شاغر`, s.actingSeats ? `${s.actingSeats} إنابة` : null].filter((x): x is string => x !== null);
  root.append(h('span', { class: `dot ${stream === 'open' ? 'dot-live' : 'dot-off'}`, 'aria-label': stream === 'open' ? 'متصل بالشركة' : 'انقطع الاتصال، تجري إعادة المحاولة' }), h('span', { text: parts.join(' · ') }));
}
