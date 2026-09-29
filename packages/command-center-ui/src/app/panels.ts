/**
 * The DOM surfaces around the universe: the attention rail (opens on demand), the focus sheet (employee,
 * goal, conversation), the command palette, the governed-action confirmation, the time control, the
 * upcoming dock and the activity note. The application speaks English; company content is shown as written
 * (an Arabic message reads right-to-left inside its own block). Every control names its action; no code or
 * identifier reaches the Founder as a code.
 */
import { ACTION_LABEL, CALENDAR_LABEL, CAPABILITY_LABEL, dirOf, FIELD_LABEL, fmtDateTime, fmtMoneyMicros, fmtNumber, fmtRelative, hasArabic, humanize, INTENT_LABEL, KIND_LABEL, LANE_LABEL, LEVEL_LABEL, plural, PURPOSE_LABEL, RELATION_LABEL, SCOPE_LABEL, SOURCE_LABEL, STATE_LABEL, t } from '../model/format.js';
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
/** Company content as written: direction from its first strong character, Arabic gets the Arabic line-height. */
const content = (tag: string, text: string, cls = ''): HTMLElement => {
  const e = h(tag, { class: `${cls} content ${hasArabic(text) ? 'is-arabic' : ''}`.trim(), text });
  e.dir = dirOf(text);
  if (hasArabic(text)) e.lang = 'ar';
  return e;
};
const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase();
/** A hue with an alpha, for tinted surfaces (`#rrggbb` → `rgba(...)`). */
const tint = (hex: string, alpha: number): string => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1] ?? '0', 16)}, ${parseInt(m[2] ?? '0', 16)}, ${parseInt(m[3] ?? '0', 16)}, ${alpha})` : hex;
};

export interface PanelHost {
  openEmployee(id: string): void;
  openGoal(id: string): void;
  openDepartment(id: string): void;
  openThread(threadId: string, employeeId: string): void;
  startConversation(employeeId: string | null): void;
  runCommand(text: string): Promise<void>;
  confirmPreview(previewId: string, fingerprint: string): Promise<void>;
  rejectPreview(previewId: string): Promise<void>;
  dismissAttention(itemId: string): Promise<void>;
  sendMessage(threadId: string, purpose: string, body: string): Promise<void>;
  showLane(lane: 'NEEDS_ME' | 'CEO_BRIEFS' | 'THREADS' | null): void;
  closeRail(): void;
  returnToLive(): void;
  scrubTo(at: string): void;
  focusSource(sourceRef: string): void;
  /** A human name for an entity ref (`employee:<id>` → the person's name; `founder` → Founder; else readable words). */
  nameOf(ref: string): string;
  /** The Department's name for its id. */
  deptNameOf(id: string): string;
  /** A work item's objective for its id, when it is on the map. */
  workTitleOf(id: string): string | null;
}

// --- shared: the Founder Communication Standard brief ----------------------------------------------

function briefBlock(brief: Json): HTMLElement {
  const row = (title: string, text: string): HTMLElement => h('div', { class: 'brief-row' }, h('h4', { text: title }), content('p', text));
  return h('div', { class: 'brief' }, row('What is happening', String(brief.happening)), row('Why it matters', String(brief.matters)), row('Recommendation', String(brief.recommendation)), row('Decision needed', brief.decisionNeeded ? String(brief.decision ?? 'Yes') : 'No'));
}

// --- attention rail -----------------------------------------------------------------------------------

export function renderAttentionRail(root: HTMLElement, data: { items: Json[]; health: Json }, host: PanelHost, activeLane: string | null): { needsMe: number; briefs: number } {
  root.replaceChildren();
  const lanes: ('NEEDS_ME' | 'CEO_BRIEFS' | 'THREADS')[] = ['NEEDS_ME', 'CEO_BRIEFS', 'THREADS'];
  const counts = Object.fromEntries(lanes.map((l) => [l, data.items.filter((i) => i.lane === l).length])) as Record<string, number>;
  const close = h('button', { type: 'button', class: 'btn btn-ghost sheet-close', 'aria-label': 'Close attention', text: 'Close' });
  close.addEventListener('click', () => host.closeRail());
  root.append(h('div', { class: 'sheet-head' }, h('h2', { class: 'sheet-title', text: 'Founder attention' }), close));
  const tabs = h('div', { class: 'rail-tabs', role: 'tablist', 'aria-label': 'Attention lanes' });
  for (const lane of lanes) {
    const b = h('button', { type: 'button', role: 'tab', class: `rail-tab${activeLane === lane ? ' is-active' : ''}`, 'aria-selected': activeLane === lane ? 'true' : 'false' }, h('span', { text: LANE_LABEL[lane] ?? lane }), h('span', { class: 'count', text: String(counts[lane]) }));
    b.addEventListener('click', () => host.showLane(activeLane === lane ? null : lane));
    tabs.append(b);
  }
  root.append(tabs);
  const list = h('ul', { class: 'rail-list', role: 'list' });
  const items = data.items.filter((i) => activeLane === null || i.lane === activeLane);
  if (items.length === 0) list.append(h('li', { class: 'empty' }, h('strong', { text: activeLane === null ? 'Nothing needs you.' : 'Nothing in this lane.' }), h('span', { text: activeLane === null ? ' The company is working; anything that needs a decision will appear here.' : ' Items arrive here as the company raises them.' })));
  for (const i of items) list.append(attentionItem(i, host));
  root.append(list);
  return { needsMe: counts.NEEDS_ME ?? 0, briefs: counts.CEO_BRIEFS ?? 0 };
}

function attentionItem(i: Json, host: PanelHost): HTMLElement {
  const level = String(i.level);
  const li = h('li', { class: `rail-item level-${level.toLowerCase()}` });
  const owner = i.ownerRef ? host.nameOf(String(i.ownerRef)) : null;
  const head = h('div', { class: 'rail-item-head' }, h('span', { class: `pill pill-${level.toLowerCase()}`, text: t(LEVEL_LABEL, level) }), h('span', { class: 'rail-kind', text: t(SOURCE_LABEL, String(i.sourceKind)) }), owner ? h('span', { class: 'rail-owner', text: owner }) : null, h('time', { class: 'rail-time', text: fmtRelative(String(i.lastSignalAt)) }));
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
    body.append(h('p', {}, h('strong', { text: `${String(approval.risk)} approval` }), ` to ${t(ACTION_LABEL, action)} for `, content('span', subject)));
  }
  if (message) {
    const brief = message.brief as Json | null;
    if (brief) body.append(briefBlock(brief));
    else body.append(content('p', String(message.body), 'msg-body'));
  }
  if (staffing) body.append(h('p', {}, 'Staffing request: ', h('strong', { text: String(staffing.positionTitle) }), ` — the CEO recommends ${staffing.ceoRecommendation === 'APPROVE' ? 'approving' : staffing.ceoRecommendation === 'REJECT' ? 'rejecting' : 'no decision yet'}`));
  if (goal) body.append(h('p', {}, 'Proposed goal: ', content('strong', String(goal.title))));
  if (escalation) {
    const title = host.workTitleOf(String(escalation.childWorkItemId));
    body.append(h('p', {}, 'Escalation on ', title ? content('span', title) : h('span', { text: 'a work item' })));
  }
  li.append(body);
  const actions = h('div', { class: 'rail-actions' });
  const open = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Open source' });
  open.addEventListener('click', () => host.focusSource(String(i.sourceRef)));
  actions.append(open);
  if (approval) {
    const approve = h('button', { type: 'button', class: 'btn btn-primary', text: 'Review decision' });
    approve.addEventListener('click', () => void host.runCommand(`approve ${String(approval.id)}`));
    actions.append(approve);
  }
  if (goal) {
    const approve = h('button', { type: 'button', class: 'btn btn-primary', text: 'Approve goal' });
    approve.addEventListener('click', () => void host.runCommand(`approve goal ${String(goal.title)}`));
    actions.append(approve);
  }
  if (message) {
    const reply = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Reply' });
    reply.addEventListener('click', () => host.openThread(String(message.threadId), String(i.ownerRef ?? '').replace('employee:', '')));
    actions.append(reply);
  }
  const dismiss = h('button', { type: 'button', class: 'btn btn-ghost', text: 'Dismiss', 'aria-label': 'Dismiss this item (silence is not approval)' });
  dismiss.addEventListener('click', () => void host.dismissAttention(String(i.id)));
  actions.append(dismiss);
  li.append(actions);
  return li;
}

// --- focus sheet: employee -----------------------------------------------------------------------------

function sheetHead(host: PanelHost, title: string, sub: (Node | string | null)[], avatar: { text: string; color: string } | null): HTMLElement {
  const back = h('button', { type: 'button', class: 'btn btn-ghost sheet-close', 'aria-label': 'Back to Company Live', text: 'Back to live' });
  back.addEventListener('click', () => host.returnToLive());
  const identity = h('div', { class: 'identity' }, avatar ? h('span', { class: 'avatar', text: avatar.text, style: `background:${tint(avatar.color, 0.26)};border-color:${tint(avatar.color, 0.6)};box-shadow:0 6px 18px ${tint(avatar.color, 0.22)}`, 'aria-hidden': 'true' }) : null, h('div', { class: 'identity-text' }, content('h2', title, 'sheet-title'), h('p', { class: 'sheet-sub' }, ...sub)));
  return h('div', { class: 'sheet-head' }, identity, back);
}

const sectionEl = (title: string, ...body: (Node | null)[]): HTMLElement => h('section', { class: 'sheet-section' }, h('h3', { text: title }), ...body);

export function renderEmployeeFocus(root: HTMLElement, d: Json, host: PanelHost, deptColor: string): void {
  root.replaceChildren();
  const e = d.employee as Json;
  const seat = d.seat as Json | null;
  const dept = d.department as Json | null;
  const name = e.name as { given: string; family: string };
  const full = `${name.given} ${name.family}`;
  const chain = (e.chain as Json[]) ?? [];
  const deptLabel = dept ? host.deptNameOf(String(dept.id)) : 'Company';
  root.append(sheetHead(host, full, [h('span', { text: seat ? String(seat.title) : 'No seat' }), ...(dept ? [h('span', { class: 'sep' }), h('span', { text: deptLabel })] : []), seat && seat.holderKind === 'ACTING' ? h('span', { class: 'pill pill-acting', text: 'Acting' }) : null, h('span', { class: `pill pill-state`, text: t(STATE_LABEL, String(e.state)) })], { text: initials(full), color: deptColor }));
  // Reports to: the seat chain inward, every link a person with a name.
  const chainEl = h('ol', { class: 'chain', 'aria-label': 'Reporting line to the Founder' });
  for (const link of chain) {
    if (String(link.employeeId) === String(e.id)) continue;
    const li = h('li', {});
    if (link.kind === 'FOUNDER') li.append(h('span', { class: 'chain-name', text: 'Founder' }));
    else if (link.employeeId) {
      const b = h('button', { type: 'button', class: 'link chain-name', text: host.nameOf(`employee:${String(link.employeeId)}`) });
      b.addEventListener('click', () => host.openEmployee(String(link.employeeId)));
      li.append(b, h('span', { class: 'chain-kind', text: t(KIND_LABEL, String(link.kind)) }));
    } else li.append(h('span', { class: 'chain-name muted', text: 'Vacant' }), h('span', { class: 'chain-kind', text: t(KIND_LABEL, String(link.kind)) }));
    chainEl.append(li);
  }
  root.append(sectionEl('Reports to', chainEl));
  const work = (d.work as Json[]) ?? [];
  const workEl = h('ul', { class: 'work-list' });
  if (work.length === 0) workEl.append(h('li', { class: 'empty', text: 'No live work right now.' }));
  for (const w of work) workEl.append(workRow(w, host, { owner: false }));
  root.append(sectionEl('Working on', workEl));
  const rel = (d.relations as Json[]) ?? [];
  if (rel.length > 0) {
    const relEl = h('ul', { class: 'rel-list' });
    for (const r of rel) {
      const outgoing = String(r.from) === `employee:${String(e.id)}`;
      const other = outgoing ? String(r.to) : String(r.from);
      const li = h('li', {}, h('span', { class: 'rel-kind', text: t(RELATION_LABEL, String(r.kind)) }), h('span', { class: 'muted', text: outgoing ? 'to' : 'from' }));
      if (other === 'founder') li.append(h('span', { text: 'the Founder' }));
      else {
        const b = h('button', { type: 'button', class: 'link', text: host.nameOf(other) });
        b.addEventListener('click', () => host.openEmployee(other.replace('employee:', '')));
        li.append(b);
      }
      relEl.append(li);
    }
    root.append(sectionEl('Live relations', relEl));
  }
  const budget = d.budget as Json | null;
  const grants = (d.grants as Json[]) ?? [];
  const facts = h('dl', { class: 'facts' });
  if (budget) facts.append(h('dt', { text: 'Budget' }), h('dd', { text: `${fmtMoneyMicros(Number(budget.spentMoney), String(budget.currency))} spent of ${fmtMoneyMicros(Number(budget.capMoney), String(budget.currency))}` }));
  facts.append(h('dt', { text: 'May do' }), h('dd', { text: grants.length === 0 ? 'Nothing granted yet' : grants.map((g) => `${t(CAPABILITY_LABEL, String(g.capability))} (${String(g.riskCeiling)})`).join(' · ') }));
  root.append(sectionEl('Authority', facts));
  const talk = h('button', { type: 'button', class: 'btn btn-primary btn-wide', text: `Talk to ${name.given}` });
  talk.addEventListener('click', () => host.startConversation(String(e.id)));
  const ceiling = h('button', { type: 'button', class: 'btn btn-quiet btn-wide', text: 'Set budget ceiling' });
  ceiling.addEventListener('click', () => void host.runCommand(`set ${full} budget ceiling EGP 0`));
  root.append(h('div', { class: 'sheet-actions' }, talk, budget ? ceiling : null));
}

function workRow(w: Json, host: PanelHost, opts: { owner: boolean }): HTMLElement {
  const goals = (w.goalIds as string[]) ?? [];
  const li = h('li', { class: `work state-${String(w.state).toLowerCase()}` }, h('span', { class: 'work-state', text: t(STATE_LABEL, String(w.state)) }), content('span', String(w.objective), 'work-objective'));
  if (opts.owner && w.ownerEmployeeId) {
    const b = h('button', { type: 'button', class: 'link', text: host.nameOf(`employee:${String(w.ownerEmployeeId)}`) });
    b.addEventListener('click', () => host.openEmployee(String(w.ownerEmployeeId)));
    li.append(b);
  }
  if (w.blockedReason) li.append(content('span', `Blocked: ${String(w.blockedReason)}`, 'work-reason'));
  if (w.waitReason) li.append(h('span', { class: 'work-reason', text: `Waiting: ${humanize(String(w.waitReason))}` }));
  for (const gid of goals) {
    const g = h('button', { type: 'button', class: 'link', text: 'Serves a goal' });
    g.addEventListener('click', () => host.openGoal(gid));
    li.append(g);
  }
  return li;
}

export function renderGoalFocus(root: HTMLElement, d: Json, host: PanelHost): void {
  root.replaceChildren();
  const g = d.goal as Json;
  const company = g.kind === 'COMPANY';
  root.append(sheetHead(host, String(g.title), [h('span', { class: 'goal-kind', text: company ? 'Company goal' : 'Department goal' }), h('span', { class: 'pill pill-state', text: t(STATE_LABEL, String(g.state)) }), g.horizonTo ? h('span', { class: 'muted', text: `Horizon ${fmtDateTime(String(g.horizonTo))}` }) : null], { text: '◆', color: company ? '#ffe3ae' : '#e8c98f' }));
  root.append(content('p', String(g.summary), 'sheet-summary'));
  const criteria = (g.successCriteria as string[]) ?? [];
  if (criteria.length) root.append(sectionEl('Success looks like', h('ul', { class: 'plain' }, ...criteria.map((c) => content('li', c)))));
  const work = (d.work as Json[]) ?? [];
  const path = h('ol', { class: 'goal-path', 'aria-label': 'How the goal becomes action' });
  const owner = host.nameOf(String(g.ownerRef));
  path.append(h('li', {}, h('span', { class: 'step', text: 'Owner' }), content('span', owner)));
  const depts = (d.departments as string[]) ?? [];
  const deptEl = h('span', { class: 'chips' });
  if (depts.length === 0) deptEl.append(h('span', { class: 'muted', text: 'No department linked yet' }));
  for (const id of depts) {
    const b = h('button', { type: 'button', class: 'chip', text: host.deptNameOf(id) });
    b.addEventListener('click', () => host.openDepartment(id));
    deptEl.append(b);
  }
  path.append(h('li', {}, h('span', { class: 'step', text: plural(depts.length, 'Department', 'Departments') }), deptEl));
  const workEl = h('ul', { class: 'work-list' });
  if (work.length === 0) workEl.append(h('li', { class: 'empty', text: 'No work linked yet — this goal has not turned into action.' }));
  for (const w of work) workEl.append(workRow(w, host, { owner: true }));
  path.append(h('li', {}, h('span', { class: 'step', text: plural(work.length, 'Work item', 'Work items') }), workEl));
  const paths = (d.paths as Json[]) ?? [];
  path.append(h('li', {}, h('span', { class: 'step', text: 'Reviews & approvals' }), h('span', { text: paths.length === 0 ? 'None open' : paths.map((p) => t(RELATION_LABEL, String(p.kind))).join(', ') })));
  root.append(sectionEl('From goal to action', path));
  const children = (d.children as Json[]) ?? [];
  if (children.length) root.append(sectionEl('Derived goals', h('ul', { class: 'plain' }, ...children.map((c) => { const b = h('button', { type: 'button', class: 'link', text: String(c.title) }); b.dir = dirOf(String(c.title)); b.addEventListener('click', () => host.openGoal(String(c.id))); return h('li', {}, b, h('span', { class: 'muted', text: ` · ${t(STATE_LABEL, String(c.state))}` })); }))));
  if (company && g.state === 'PROPOSED') {
    const approve = h('button', { type: 'button', class: 'btn btn-primary btn-wide', text: 'Approve this goal' });
    approve.addEventListener('click', () => void host.runCommand(`approve goal ${String(g.title)}`));
    root.append(h('div', { class: 'sheet-actions' }, approve));
  }
}

// --- conversation ------------------------------------------------------------------------------------

export function renderConversation(root: HTMLElement, d: { thread: Json; messages: Json[]; pending: Json[] }, host: PanelHost, universe: CompanyUniverse | null, deptColor: string): void {
  root.replaceChildren();
  const th = d.thread;
  const employee = universe?.employees.find((e) => e.id === th.employeeId);
  const name = employee ? `${employee.name.given} ${employee.name.family}` : String(th.subject);
  const seat = employee ? universe?.seats.find((s) => s.holderEmployeeId === employee.id) : undefined;
  const isCeo = th.kind === 'FOUNDER_CEO' || th.kind === 'CEO_BRIEF' || seat?.kind === 'CEO';
  const deptLabel = employee?.departmentId ? host.deptNameOf(employee.departmentId) : 'Company';
  root.append(sheetHead(host, name, [h('span', { text: seat ? (isCeo ? 'Chief Executive Officer' : seat.title) : 'Direct conversation' }), ...(employee?.departmentId ? [h('span', { class: 'sep' }), h('span', { text: deptLabel })] : [])], { text: initials(name), color: deptColor }));
  // Context: the work this person is carrying, so the conversation happens inside the company, not beside it.
  const work = employee ? (universe?.work ?? []).filter((w) => w.ownerEmployeeId === employee.id && w.state !== 'COMPLETED' && w.state !== 'CANCELLED') : [];
  if (work.length) {
    const chips = h('div', { class: 'chips context-chips', 'aria-label': 'Work in this conversation' });
    for (const w of work.slice(0, 4)) {
      const chip = h('span', { class: `chip chip-${String(w.state).toLowerCase()}` }, h('span', { class: 'chip-state', text: t(STATE_LABEL, w.state) }), content('span', w.objective));
      chips.append(chip);
    }
    root.append(chips);
  }
  root.append(h('p', { class: 'conv-rule', text: 'Conversation never grants authority. A budget, approval or goal request becomes a governed preview you confirm yourself.' }));
  const list = h('ol', { class: 'ledger', 'aria-live': 'polite' });
  for (const m of d.messages) {
    const mine = m.senderKind === 'FOUNDER';
    const li = h('li', { class: `entry ${mine ? 'from-founder' : 'from-employee'}` }, h('div', { class: 'entry-meta' }, h('span', { class: 'who', text: mine ? 'You' : name }), h('span', { class: 'purpose', text: t(PURPOSE_LABEL, String(m.purpose)) }), h('time', { class: 'when', text: fmtRelative(String(m.createdAt)) })));
    const brief = m.brief as Json | null;
    if (brief) li.append(briefBlock(brief));
    else li.append(content('p', String(m.body), 'entry-body'));
    list.append(li);
  }
  for (const p of d.pending) list.append(h('li', { class: 'entry pending' }, h('span', { class: 'who', text: name }), h('span', { text: ` is working on a reply · ${t(STATE_LABEL, String(p.workItemState))}` })));
  if (d.messages.length === 0 && d.pending.length === 0) list.append(h('li', { class: 'entry empty' }, h('strong', { text: 'Nothing said yet.' }), h('span', { text: ` Write to ${employee?.name.given ?? name} in English or Arabic; a reply comes from their own governed run.` })));
  root.append(list);
  const form = h('form', { class: 'composer' }) as HTMLFormElement;
  const purposes = ['QUESTION', 'REQUEST', 'DECISION_REQUEST', 'FYI', 'CORRECTION'];
  let purpose = 'QUESTION';
  const chips = h('div', { class: 'purpose-chips', role: 'radiogroup', 'aria-label': 'Message purpose' });
  const chipEls = purposes.map((p) => {
    const b = h('button', { type: 'button', role: 'radio', class: `chip chip-choice${p === purpose ? ' is-active' : ''}`, 'aria-checked': p === purpose ? 'true' : 'false', text: t(PURPOSE_LABEL, p) });
    b.addEventListener('click', () => {
      purpose = p;
      for (const c of chipEls) {
        c.classList.toggle('is-active', c === b);
        c.setAttribute('aria-checked', c === b ? 'true' : 'false');
      }
    });
    return b;
  });
  chips.append(...chipEls);
  const text = h('textarea', { 'aria-label': 'Message', name: 'body', rows: 3, placeholder: `Write to ${employee?.name.given ?? name} in English or Arabic…`, maxlength: 4000, dir: 'auto' }) as HTMLTextAreaElement;
  const send = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Send' });
  form.append(chips, text, h('div', { class: 'composer-foot' }, h('span', { class: 'hint', text: 'Enter sends · Shift+Enter for a new line' }), send));
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = text.value.trim();
    if (!body) return;
    send.setAttribute('disabled', '');
    void host.sendMessage(String(th.id), purpose, body).finally(() => send.removeAttribute('disabled'));
    text.value = '';
  });
  root.append(form);
}

// --- command palette and governed confirmation ---------------------------------------------------

export function renderPalette(root: HTMLElement, host: PanelHost, result: Json | null, busy: boolean): HTMLInputElement {
  root.replaceChildren();
  const form = h('form', { class: 'palette-form', role: 'search' });
  const input = h('input', { type: 'text', class: 'palette-input', placeholder: 'Ask the company: open Laila · what is blocked? · who is working on the Saudi launch?', 'aria-label': 'Founder command', autocomplete: 'off', maxlength: 400, dir: 'auto' }) as HTMLInputElement;
  const go = h('button', { type: 'submit', class: 'btn btn-primary', text: busy ? '…' : 'Go' });
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
    if (intent.kind === 'UNKNOWN') line.textContent = 'Not understood. Try “open <name>”, “show growth”, “what is blocked?”, “needs my approval”.';
    else if (intent.kind === 'READ') line.append(h('span', { class: 'pill', text: 'Read' }), ' ', h('span', { text: 'Focus changed. No fact changed.' }));
    else if (result.preview) line.append(h('span', { class: 'pill pill-needs_decision', text: 'Governed action' }), ' ', h('span', { text: 'A structured preview is ready. Nothing changes until you confirm.' }));
    else line.append(h('span', { class: 'pill', text: 'Action' }), ' ', h('span', { text: 'No single target matched. Pick it on the map or name it.' }));
    root.append(line);
    const matches = (result.matches as Json[]) ?? [];
    if (matches.length > 1) {
      const ul = h('ul', { class: 'palette-matches' });
      for (const m of matches) {
        const b = h('button', { type: 'button', class: 'link', text: String(m.label) });
        b.dir = dirOf(String(m.label));
        b.addEventListener('click', () => (m.kind === 'employee' ? host.openEmployee(String(m.id)) : m.kind === 'goal' ? host.openGoal(String(m.id)) : host.focusSource(`${String(m.kind)}:${String(m.id)}`)));
        ul.append(h('li', {}, b));
      }
      root.append(ul);
    }
  }
  return input;
}

/** Payload fields the Founder reads: identifiers are resolved to names or dropped, never shown as codes. */
const HIDDEN_FIELDS = new Set(['reasonCode', 'currency', 'approvalId', 'goalId', 'budgetId', 'requestId', 'conflictId', 'employeeId']);

export function renderPreview(root: HTMLElement, preview: Json, host: PanelHost): void {
  root.replaceChildren();
  const payload = (preview.payload as Json) ?? {};
  const currency = typeof payload.currency === 'string' ? payload.currency : 'EGP';
  const scope = typeof payload.scope === 'string' ? payload.scope : null;
  const value = (k: string, v: unknown): HTMLElement => {
    if (k === 'capMoney' && typeof v === 'number') return h('span', { text: fmtMoneyMicros(v, currency) });
    if (k === 'capTokens' && typeof v === 'number') return h('span', { text: `${fmtNumber(v)} tokens` });
    if (k === 'decision') return h('span', { text: v === 'REJECT' ? 'Reject' : 'Approve' });
    if (k === 'activate') return h('span', { text: v ? 'Yes' : 'No' });
    if (k === 'to' || k === 'resolution') return h('span', { text: t(STATE_LABEL, String(v)) });
    if (k === 'scope') return h('span', { text: t(SCOPE_LABEL, String(v)) });
    if (k === 'scopeId') return content('span', scope === 'EMPLOYEE' ? host.nameOf(`employee:${String(v)}`) : scope === 'DEPARTMENT' ? host.deptNameOf(String(v)) : scope === 'COMPANY' ? 'The company' : host.workTitleOf(String(v)) ?? 'A work item');
    if (k === 'expiresAt' && typeof v === 'string') return h('span', { text: fmtDateTime(v) });
    if (k === 'capability') return h('span', { text: t(CAPABILITY_LABEL, String(v)) });
    return h('span', { text: humanize(String(v)) });
  };
  const rows = Object.entries(payload).filter(([k]) => !HIDDEN_FIELDS.has(k));
  root.append(
    h('h2', { class: 'preview-title', text: t(INTENT_LABEL, String(preview.intentKind)) }),
    h('p', { class: 'preview-lede', text: 'This is what will happen when you confirm — nothing more. The words you typed change nothing by themselves.' }),
    content('p', String(preview.summary ?? preview.intentKind), 'preview-summary'),
    h('dl', { class: 'facts' }, ...rows.flatMap(([k, v]) => [h('dt', { text: t(FIELD_LABEL, k) }), h('dd', {}, value(k, v))])),
    h('p', { class: 'muted small', text: `This preview expires ${fmtRelative(String(preview.expiresAt))}.` }),
  );
  const confirm = h('button', { type: 'button', class: 'btn btn-primary', text: 'Confirm and execute' });
  const cancel = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Cancel' });
  confirm.addEventListener('click', () => void host.confirmPreview(String(preview.id), String(preview.fingerprint)));
  cancel.addEventListener('click', () => void host.rejectPreview(String(preview.id)));
  root.append(h('div', { class: 'preview-actions' }, cancel, confirm));
  confirm.focus();
}

// --- time, upcoming, activity ----------------------------------------------------------------------

export function renderTimeline(root: HTMLElement, state: { live: boolean; at: string | null; earliest: string; now: string }, host: PanelHost): void {
  root.replaceChildren();
  root.classList.toggle('is-history', !state.live);
  const live = h('button', { type: 'button', class: `btn ${state.live ? 'btn-live' : 'btn-quiet'}`, text: state.live ? 'Live' : 'Return to live', 'aria-pressed': state.live ? 'true' : 'false' }, );
  live.prepend(h('span', { class: `dot ${state.live ? 'dot-live' : 'dot-off'}`, 'aria-hidden': 'true' }));
  live.addEventListener('click', () => host.returnToLive());
  const min = Date.parse(state.earliest);
  const max = Date.parse(state.now);
  const value = state.at ? Date.parse(state.at) : max;
  // The step follows the span (about 240 stops, a minute at most, never coarser than the span itself), so a young
  // company with seconds of history scrubs just as well as one with months.
  const step = Math.max(1000, Math.min(60_000, Math.floor((max - min) / 240)));
  const range = h('input', { type: 'range', class: 'scrubber', step: String(step), 'aria-label': 'Moment in the company history', 'aria-valuetext': state.at ? fmtDateTime(state.at) : 'Now' }) as HTMLInputElement;
  // Bounds first, value last: a value applied before its bounds is clamped to the default 0–100 range.
  range.min = String(min);
  range.max = String(max);
  range.value = String(value);
  let timer = 0;
  range.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => host.scrubTo(new Date(Number(range.value)).toISOString()), 220);
  });
  const label = h('span', { class: 'time-label', text: state.at ? fmtDateTime(state.at) : 'Now' });
  root.append(live, h('div', { class: 'scrub' }, h('span', { class: 'time-edge', text: fmtDateTime(state.earliest) }), range, label));
}

export function renderCalendar(root: HTMLElement, d: { events: Json[] }, host: PanelHost): void {
  root.replaceChildren();
  const events = d.events.slice(0, 8);
  root.append(h('summary', { class: 'dock-summary' }, h('span', { text: 'Upcoming' }), h('span', { class: 'count', text: String(d.events.length) })));
  const ul = h('ul', { class: 'dock-list' });
  if (events.length === 0) ul.append(h('li', { class: 'empty', text: 'Nothing due in the next thirty days.' }));
  for (const e of events) {
    const li = h('li', {}, h('time', { class: 'dock-when', text: fmtRelative(String(e.at)) }), h('span', { class: 'dock-what' }, h('span', { text: t(CALENDAR_LABEL, String(e.kind)) }), e.title ? content('span', String(e.title), 'dock-title') : null));
    if (String(e.ref).startsWith('goal:') || String(e.ref).startsWith('work_item:')) {
      const b = h('button', { type: 'button', class: 'link', text: 'Open' });
      b.addEventListener('click', () => host.focusSource(String(e.ref)));
      li.append(b);
    }
    ul.append(li);
  }
  root.append(ul);
}

/** The latest activity note: shown for a while, then it recedes. Every semantic motion on the map has one. */
export function renderActivity(root: HTMLElement, line: { at: string; text: string; kind: 'semantic' | 'system' } | null): void {
  root.replaceChildren();
  if (!line) {
    root.classList.remove('is-shown');
    return;
  }
  root.append(h('span', { class: `act-${line.kind}` }, content('span', line.text)));
  root.classList.add('is-shown');
}

export function renderHealthLine(root: HTMLElement, u: CompanyUniverse | null, stream: 'open' | 'closed'): void {
  root.replaceChildren();
  if (!u) return;
  const s = u.signals;
  const parts = [plural(s.running, 'running', 'running'), s.blocked ? plural(s.blocked, 'blocked', 'blocked') : null, s.waitingApproval ? plural(s.waitingApproval, 'awaiting approval', 'awaiting approval') : null, s.waitingReview ? plural(s.waitingReview, 'in review', 'in review') : null, s.vacantSeats ? plural(s.vacantSeats, 'vacant seat', 'vacant seats') : null, s.actingSeats ? plural(s.actingSeats, 'acting cover', 'acting covers') : null].filter((x): x is string => x !== null);
  root.append(h('span', { class: `dot ${stream === 'open' ? 'dot-live' : 'dot-off'}`, 'aria-label': stream === 'open' ? 'Connected to the company' : 'Disconnected, retrying' }), h('span', { text: parts.join(' · ') }));
}
