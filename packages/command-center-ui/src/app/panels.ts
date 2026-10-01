/**
 * The DOM surfaces around the company: the attention surface (opens beside the Founder on demand), the
 * context sheet (a person, a goal, a conversation — docked beside the company, tethered to what it is about),
 * the command palette, the governed-action confirmation, the time control, the upcoming dock and the activity
 * note. The application speaks English; company content is shown as written (an Arabic message reads
 * right-to-left inside its own block). Every control names its action; no code or identifier reaches the
 * Founder as a code. The sheets share the company's language: the same avatars, Department accents, gold,
 * radii and status grammar as the cards in the columns.
 */
import { ACTION_LABEL, CALENDAR_LABEL, CAPABILITY_LABEL, DECISION_LABEL, dirOf, EVIDENCE_LABEL, FIELD_LABEL, fmtDate, fmtDateTime, fmtMoneyMicros, fmtNumber, fmtRelative, fmtTime, hasArabic, humanize, INTENT_LABEL, KIND_LABEL, LANE_LABEL, MARKET_CLAIM_LABEL, PILOT_DECISION_LABEL, PILOT_MODE_LABEL, plural, PURPOSE_LABEL, READINESS_LABEL, RELATION_LABEL, SCOPE_LABEL, SOURCE_LABEL, STATE_LABEL, t } from '../model/format.js';
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
const GOLD = '#c48a1f';

export interface PanelHost {
  openEmployee(id: string): void;
  openGoal(id: string): void;
  openDepartment(id: string): void;
  openThread(threadId: string, employeeId: string): void;
  startConversation(employeeId: string | null): void;
  runCommand(text: string): Promise<void>;
  /** A structured act the surface already knows (IDs / codes): posted as a governed preview, never re-typed as text. */
  previewAction(intent: string, payload: Json): Promise<void>;
  confirmPreview(previewId: string, fingerprint: string): Promise<void>;
  rejectPreview(previewId: string): Promise<void>;
  dismissAttention(itemId: string): Promise<void>;
  sendMessage(threadId: string, purpose: string, body: string): Promise<void>;
  showLane(lane: 'NEEDS_ME' | 'CEO_BRIEFS' | 'THREADS' | null): void;
  closeRail(): void;
  returnToLive(): void;
  scrubTo(at: string): void;
  focusSource(sourceRef: string): void;
  /** The Founder reads one attention item: the company spotlights where it lives (null when the eye moves on). */
  spotlightAttention(itemId: string | null, itemEl: HTMLElement | null): void;
  /** A human name for an entity ref (`employee:<id>` → the person's name; `founder` → Founder; else readable words). */
  nameOf(ref: string): string;
  /** The Department's name for its id. */
  deptNameOf(id: string): string;
  /** The Department's accent for its id (the column's colour). */
  deptColorOf(id: string): string;
  /** The accent of an entity ref: a person takes their column's colour, the Founder and the CEO the gold. */
  colorOf(ref: string): string;
  /** A work item's objective for its id, when it is on the map. */
  workTitleOf(id: string): string | null;
}

// --- shared pieces -----------------------------------------------------------------------------------

/** A person as the columns draw them: initials in their Department's accent. */
const personAvatar = (name: string, color: string, cls = ''): HTMLElement => h('span', { class: `avatar ${cls}`.trim(), text: initials(name), style: `--dept:${color}`, 'aria-hidden': 'true' });

/** A named person, clickable when they are on the map. */
function personRef(host: PanelHost, ref: string, color: string, sub?: string): HTMLElement {
  const name = host.nameOf(ref);
  const row = h('span', { class: 'person' });
  if (ref === 'founder') row.append(h('span', { class: 'avatar avatar-founder', text: 'Q', 'aria-hidden': 'true' }), h('span', { class: 'person-name', text: 'Founder' }));
  else if (ref.startsWith('employee:')) {
    const b = h('button', { type: 'button', class: 'person-name link', text: name });
    b.dir = dirOf(name);
    b.addEventListener('click', () => host.openEmployee(ref.slice('employee:'.length)));
    row.append(personAvatar(name, color), b);
  } else row.append(content('span', name, 'person-name'));
  if (sub) row.append(h('span', { class: 'person-sub', text: sub }));
  return row;
}

/** The Founder Communication Standard brief: four named parts, read in order, as an executive memo. */
function briefBlock(brief: Json): HTMLElement {
  const row = (title: string, text: string, cls = ''): HTMLElement => h('div', { class: `brief-row ${cls}`.trim() }, h('h4', { text: title }), content('p', text));
  return h('div', { class: 'brief' }, row('What is happening', String(brief.happening)), row('Why it matters', String(brief.matters)), row('Recommendation', String(brief.recommendation)), row('Decision needed', brief.decisionNeeded ? String(brief.decision ?? 'Yes') : 'No decision needed', brief.decisionNeeded ? 'is-decision' : ''));
}

function sheetHead(host: PanelHost, title: string, sub: (Node | string | null)[], avatar: HTMLElement | null): HTMLElement {
  const back = h('button', { type: 'button', class: 'btn btn-ghost sheet-close', 'aria-label': 'Back to Company Live', text: 'Company Live' });
  back.addEventListener('click', () => host.returnToLive());
  const identity = h('div', { class: 'identity' }, avatar, h('div', { class: 'identity-text' }, content('h2', title, 'sheet-title'), h('p', { class: 'sheet-sub' }, ...sub)));
  return h('div', { class: 'sheet-head' }, identity, back);
}

const sectionEl = (title: string, ...body: (Node | null)[]): HTMLElement => h('section', { class: 'sheet-section' }, h('h3', { text: title }), ...body);

const statePill = (state: string): HTMLElement => h('span', { class: `pill pill-state state-${state.toLowerCase()}`, text: t(STATE_LABEL, state) });

// --- attention surface --------------------------------------------------------------------------------

export function renderAttentionRail(root: HTMLElement, data: { items: Json[]; health: Json }, host: PanelHost, activeLane: string | null): { needsMe: number; briefs: number } {
  root.replaceChildren();
  const lanes: ('NEEDS_ME' | 'CEO_BRIEFS' | 'THREADS')[] = ['NEEDS_ME', 'CEO_BRIEFS', 'THREADS'];
  const counts = Object.fromEntries(lanes.map((l) => [l, data.items.filter((i) => i.lane === l).length])) as Record<string, number>;
  const close = h('button', { type: 'button', class: 'btn btn-ghost sheet-close', 'aria-label': 'Close attention', text: 'Close' });
  close.addEventListener('click', () => host.closeRail());
  const total = data.items.length;
  root.append(h('div', { class: 'sheet-head rail-head' }, h('div', { class: 'identity-text' }, h('h2', { class: 'sheet-title', text: 'Founder attention' }), h('p', { class: 'sheet-sub', text: total === 0 ? 'Nothing needs you right now.' : `${plural(total, 'item needs', 'items need')} you.` })), close));
  const tabs = h('div', { class: 'rail-tabs', role: 'tablist', 'aria-label': 'Attention lanes' });
  for (const lane of lanes) {
    const b = h('button', { type: 'button', role: 'tab', class: `rail-tab${activeLane === lane ? ' is-active' : ''}`, 'aria-selected': activeLane === lane ? 'true' : 'false' }, h('span', { text: LANE_LABEL[lane] ?? lane }), h('span', { class: 'count', text: String(counts[lane]) }));
    b.addEventListener('click', () => host.showLane(activeLane === lane ? null : lane));
    tabs.append(b);
  }
  root.append(tabs);
  const list = h('ul', { class: 'rail-list', role: 'list' });
  const items = data.items.filter((i) => activeLane === null || i.lane === activeLane);
  if (items.length === 0) list.append(h('li', { class: 'empty rail-empty' }, h('strong', { text: activeLane === null ? 'Nothing needs you.' : 'Nothing in this lane.' }), h('span', { text: activeLane === null ? ' The company is working; a decision, a brief or a conversation that needs you will appear here.' : ' Items arrive here as the company raises them.' })));
  for (const i of items) list.append(attentionItem(i, host));
  root.append(list);
  return { needsMe: counts.NEEDS_ME ?? 0, briefs: counts.CEO_BRIEFS ?? 0 };
}

function attentionItem(i: Json, host: PanelHost): HTMLElement {
  const level = String(i.level);
  const li = h('li', { class: `rail-item level-${level.toLowerCase()}`, tabindex: 0, 'data-id': String(i.id) });
  const ownerRef = i.ownerRef ? String(i.ownerRef) : null;
  const owner = ownerRef ? host.nameOf(ownerRef) : null;
  const approval = i.approval as Json | undefined;
  const message = i.message as Json | undefined;
  const staffing = i.staffing as Json | undefined;
  const goal = i.goal as Json | undefined;
  const escalation = i.escalation as Json | undefined;
  const conflict = i.conflict as Json | undefined;
  const effect = i.uncertainEffect as Json | undefined;
  const reservation = i.heldReservation as Json | undefined;
  const job = i.heldJob as Json | undefined;
  const reviewEsc = i.reviewEscalation as Json | undefined;
  const systemic = i.systemic as Json | undefined;
  const judgment = i.judgment as Json | undefined;
  const outcome = i.outcome as Json | undefined;
  const brief = message?.brief as Json | null | undefined;
  const isBrief = String(i.sourceKind) === 'BRIEF' || Boolean(brief);
  const head = h('div', { class: 'rail-item-head' }, h('span', { class: `level-mark level-${level.toLowerCase()}`, 'aria-hidden': 'true' }), h('span', { class: 'rail-kind', text: isBrief ? 'CEO brief' : t(SOURCE_LABEL, String(i.sourceKind)) }), owner ? h('span', { class: 'rail-owner', text: owner }) : null, h('time', { class: 'rail-time', text: fmtRelative(String(i.lastSignalAt)) }));
  li.append(head);
  // The ask, in one line the Founder can act on.
  const ask = h('p', { class: 'rail-ask' });
  if (approval) ask.append(h('span', { text: `${String(approval.risk)} approval to ${t(ACTION_LABEL, String(approval.action))} for ` }), content('span', host.nameOf(String(approval.subjectRef)), 'rail-strong'));
  else if (goal) ask.append(h('span', { text: 'Proposed goal: ' }), content('span', String(goal.title), 'rail-strong'));
  else if (staffing) ask.append(h('span', { text: 'Staffing request for ' }), h('span', { class: 'rail-strong', text: String(staffing.positionTitle) }), h('span', { text: ` — the CEO recommends ${staffing.ceoRecommendation === 'APPROVE' ? 'approving' : staffing.ceoRecommendation === 'REJECT' ? 'rejecting' : 'no decision yet'}` }));
  else if (escalation) {
    const title = host.workTitleOf(String(escalation.childWorkItemId));
    ask.append(h('span', { text: 'Escalation on ' }), title ? content('span', title, 'rail-strong') : h('span', { text: 'a work item' }));
  } else if (conflict) ask.append(h('span', { class: 'rail-strong', text: 'Reviewers disagree' }), h('span', { text: ' — pass the work or send it back' }));
  else if (effect) ask.append(h('span', { class: 'rail-strong', text: 'An external effect is uncertain' }), h('span', { text: ' — did it happen? It is never repeated without your answer' }));
  else if (reservation) ask.append(h('span', { class: 'rail-strong', text: 'Money is held for an uncertain call' }), h('span', { text: ' — release it if nothing was billed' }));
  else if (job) {
    const title = host.workTitleOf(String(job.workItemId));
    ask.append(h('span', { text: 'Held after an uncertain effect: ' }), title ? content('span', title, 'rail-strong') : h('span', { class: 'rail-strong', text: 'a work item' }));
  } else if (reviewEsc) {
    const title = host.workTitleOf(String(reviewEsc.workItemId));
    ask.append(h('span', { text: 'A reviewer could not decide on ' }), title ? content('span', title, 'rail-strong') : h('span', { class: 'rail-strong', text: 'a work item' }));
  } else if (systemic) ask.append(h('span', { class: 'rail-strong', text: 'A repeated failure pattern' }), h('span', { text: ' — is it systemic?' }));
  else if (judgment) ask.append(h('span', { class: 'rail-strong', text: judgment.subjectKind === 'LESSON' ? 'A lesson the Review Pool could not settle' : 'A cause the Review Pool could not settle' }));
  else if (outcome) {
    const title = host.workTitleOf(String(outcome.workItemId));
    ask.append(h('span', { text: 'Reviewers could not verify the outcome of ' }), title ? content('span', title, 'rail-strong') : h('span', { class: 'rail-strong', text: 'a work item' }));
  } else if (message && !brief) ask.append(h('span', { text: `${t(PURPOSE_LABEL, String(message.purpose ?? 'REQUEST'))} from ` }), h('span', { class: 'rail-strong', text: owner ?? 'the company' }));
  else if (brief) ask.append(h('span', { class: 'rail-strong', text: brief.decisionNeeded ? 'A decision is needed' : 'For your information' }));
  li.append(ask);
  const body = h('div', { class: 'rail-item-body' });
  if (message) {
    if (brief) body.append(briefBlock(brief));
    else body.append(content('p', String(message.body), 'msg-body'));
  }
  if (body.childElementCount) li.append(body);
  const actions = h('div', { class: 'rail-actions' });
  // Every decision button posts the structured act it shows (R2-24): a governed preview the Founder confirms.
  const act = (text: string, intent: string, payload: Json, primary = false): void => {
    const b = h('button', { type: 'button', class: `btn ${primary ? 'btn-primary' : 'btn-quiet'}`, text });
    b.addEventListener('click', () => void host.previewAction(intent, payload));
    actions.append(b);
  };
  const decided = approval || goal || staffing || conflict || effect || reservation || job || reviewEsc || (systemic && systemic.state === 'CANDIDATE') || judgment;
  if (approval) {
    act('Approve', 'APPROVAL_DECIDE', { approvalId: String(approval.id), decision: 'APPROVE' }, true);
    act('Reject', 'APPROVAL_DECIDE', { approvalId: String(approval.id), decision: 'REJECT' });
  }
  if (goal) act('Approve goal', 'GOAL_APPROVE', { goalId: String(goal.id), activate: true }, true);
  if (staffing) {
    act('Approve', 'STAFFING_DECIDE', { requestId: String(staffing.id), decision: 'APPROVE' }, true);
    act('Reject', 'STAFFING_DECIDE', { requestId: String(staffing.id), decision: 'REJECT' });
  }
  if (conflict) {
    act('Pass', 'CONFLICT_RESOLVE', { conflictId: String(conflict.id), resolution: 'PASS' }, true);
    act('Rework', 'CONFLICT_RESOLVE', { conflictId: String(conflict.id), resolution: 'REWORK' });
  }
  if (effect) {
    act('Confirm executed', 'TOOL_RECONCILE', { invocationId: String(effect.id), outcome: 'CONFIRMED_SUCCEEDED' }, true);
    act('Confirm not executed', 'TOOL_RECONCILE', { invocationId: String(effect.id), outcome: 'CONFIRMED_NOT_EXECUTED' });
  }
  // Charging a held reservation needs the provider-reported usage: that decision stays on the structured API (PG-04).
  if (reservation) act('Release (nothing billed)', 'RESERVATION_RECONCILE', { reservationId: String(reservation.id), decision: 'RELEASE' }, true);
  if (job) {
    act('Confirm completed', 'JOB_RECONCILE', { jobId: String(job.id), decision: 'CONFIRMED_COMPLETED' }, true);
    act('Retry', 'JOB_RECONCILE', { jobId: String(job.id), decision: 'RETRY' });
    act('Mark failed', 'JOB_RECONCILE', { jobId: String(job.id), decision: 'FAILED' });
  }
  if (reviewEsc) {
    // R4 work is never made executable by review: only rework is offered.
    if (reviewEsc.risk !== 'R4') act('Pass', 'REVIEW_ESCALATION_RESOLVE', { requestId: String(reviewEsc.id), decision: 'PASS' }, true);
    act('Rework', 'REVIEW_ESCALATION_RESOLVE', { requestId: String(reviewEsc.id), decision: 'REWORK' }, reviewEsc.risk === 'R4');
  }
  if (systemic && systemic.state === 'CANDIDATE') {
    act('Validate', 'SYSTEMIC_DECIDE', { findingId: String(systemic.id), decision: 'VALIDATE' }, true);
    act('Reject', 'SYSTEMIC_DECIDE', { findingId: String(systemic.id), decision: 'REJECT' });
  }
  if (judgment) {
    const [intent, key] = judgment.subjectKind === 'LESSON' ? ['LESSON_DECIDE', 'lessonId'] : ['ATTRIBUTION_DECIDE', 'attributionId'];
    act('Validate', intent, { [key]: String(judgment.subjectId), decision: 'VALIDATE' }, true);
    act('Reject', intent, { [key]: String(judgment.subjectId), decision: 'REJECT' });
  }
  // Verifying an outcome needs the evidence classes and records the Founder cites: structured API only (PG-04).
  if (message) {
    const reply = h('button', { type: 'button', class: `btn ${decided ? 'btn-quiet' : 'btn-primary'}`, text: 'Reply' });
    reply.addEventListener('click', () => host.openThread(String(message.threadId), String(i.ownerRef ?? '').replace('employee:', '')));
    actions.append(reply);
  }
  const open = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Show in company' });
  open.addEventListener('click', () => host.focusSource(String(i.sourceRef)));
  actions.append(open);
  const dismiss = h('button', { type: 'button', class: 'btn btn-ghost', text: 'Dismiss', 'aria-label': 'Dismiss this item (silence is not approval)' });
  dismiss.addEventListener('click', () => void host.dismissAttention(String(i.id)));
  actions.append(dismiss);
  li.append(actions);
  // Reading an item spotlights where it lives in the company.
  li.addEventListener('pointerenter', () => host.spotlightAttention(String(i.id), li));
  li.addEventListener('focusin', () => host.spotlightAttention(String(i.id), li));
  li.addEventListener('pointerleave', () => host.spotlightAttention(null, null));
  li.addEventListener('focusout', (e) => {
    if (!(e.relatedTarget instanceof Node) || !li.contains(e.relatedTarget)) host.spotlightAttention(null, null);
  });
  return li;
}

// --- context sheet: employee ----------------------------------------------------------------------------

export function renderEmployeeFocus(root: HTMLElement, d: Json, host: PanelHost, deptColor: string): void {
  root.replaceChildren();
  root.dataset.sheet = 'employee';
  root.style.setProperty('--accent', deptColor);
  const e = d.employee as Json;
  const seat = d.seat as Json | null;
  const dept = d.department as Json | null;
  const name = e.name as { given: string; family: string };
  const full = `${name.given} ${name.family}`;
  const chain = (e.chain as Json[]) ?? [];
  const deptLabel = dept ? host.deptNameOf(String(dept.id)) : 'Company';
  const isCeo = seat?.kind === 'CEO';
  root.append(sheetHead(host, full, [h('span', { text: seat ? (isCeo ? 'Chief Executive Officer' : String(seat.title)) : 'No seat' }), h('span', { class: 'sep' }), h('span', { class: 'sheet-dept', text: deptLabel }), seat && seat.holderKind === 'ACTING' ? h('span', { class: 'pill pill-acting', text: 'Acting cover' }) : null, statePill(String(e.state))], personAvatar(full, deptColor, 'avatar-lg')));
  // Reports to: the seat chain inward, every link a person with a name, drawn like the lane in the column.
  const chainEl = h('ol', { class: 'chain', 'aria-label': 'Reporting line to the Founder' });
  for (const link of chain) {
    if (String(link.employeeId) === String(e.id)) continue;
    const li = h('li', {});
    if (link.kind === 'FOUNDER') li.append(personRef(host, 'founder', GOLD, 'Owner of the company'));
    else if (link.employeeId) li.append(personRef(host, `employee:${String(link.employeeId)}`, host.colorOf(`employee:${String(link.employeeId)}`), t(KIND_LABEL, String(link.kind))));
    else li.append(h('span', { class: 'person' }, h('span', { class: 'avatar avatar-vacant', 'aria-hidden': 'true' }), h('span', { class: 'person-name muted', text: 'Vacant seat' }), h('span', { class: 'person-sub', text: t(KIND_LABEL, String(link.kind)) })));
    chainEl.append(li);
  }
  root.append(sectionEl(isCeo ? 'Reports to' : 'Reports to', chainEl));
  const work = (d.work as Json[]) ?? [];
  const workEl = h('ul', { class: 'work-list' });
  if (work.length === 0) workEl.append(h('li', { class: 'empty', text: 'No live work right now.' }));
  for (const w of work) workEl.append(workRow(w, host, { owner: false, goals: true }));
  root.append(sectionEl('Working on', workEl));
  const rel = (d.relations as Json[]) ?? [];
  if (rel.length > 0) {
    const relEl = h('ul', { class: 'rel-list' });
    for (const r of rel) {
      const outgoing = String(r.from) === `employee:${String(e.id)}`;
      const other = outgoing ? String(r.to) : String(r.from);
      const li = h('li', {}, h('span', { class: 'rel-kind', text: t(RELATION_LABEL, String(r.kind)) }), h('span', { class: 'rel-dir', text: outgoing ? 'to' : 'from' }));
      li.append(personRef(host, other, host.colorOf(other)));
      relEl.append(li);
    }
    root.append(sectionEl('Live relations', relEl));
  }
  const budget = d.budget as Json | null;
  const grants = (d.grants as Json[]) ?? [];
  const authority = h('div', { class: 'authority' });
  if (budget) {
    const spent = Number(budget.spentMoney);
    const cap = Number(budget.capMoney);
    const ratio = cap > 0 ? Math.min(1, spent / cap) : 0;
    authority.append(h('div', { class: 'meter', role: 'img', 'aria-label': `${fmtMoneyMicros(spent, String(budget.currency))} spent of ${fmtMoneyMicros(cap, String(budget.currency))}` }, h('span', { class: 'meter-bar' }, h('span', { class: 'meter-fill', style: `width:${Math.round(ratio * 100)}%` })), h('span', { class: 'meter-text' }, h('strong', { text: fmtMoneyMicros(spent, String(budget.currency)) }), h('span', { class: 'muted', text: ` of ${fmtMoneyMicros(cap, String(budget.currency))}` }))));
  }
  const may = h('div', { class: 'chips' });
  if (grants.length === 0) may.append(h('span', { class: 'muted', text: 'Nothing granted yet' }));
  for (const g of grants) may.append(h('span', { class: 'chip chip-grant' }, h('span', { text: t(CAPABILITY_LABEL, String(g.capability)) }), h('span', { class: 'chip-state', text: String(g.riskCeiling) })));
  authority.append(may);
  root.append(sectionEl('Authority', authority));
  const talk = h('button', { type: 'button', class: 'btn btn-primary btn-wide', text: `Talk to ${name.given}` });
  talk.addEventListener('click', () => host.startConversation(String(e.id)));
  const ceiling = h('button', { type: 'button', class: 'btn btn-quiet btn-wide', text: 'Set budget ceiling' });
  ceiling.addEventListener('click', () => void host.runCommand(`set ${full} budget ceiling EGP 0`));
  root.append(h('div', { class: 'sheet-actions' }, talk, budget ? ceiling : null));
}

function workRow(w: Json, host: PanelHost, opts: { owner: boolean; goals: boolean }): HTMLElement {
  const goals = (w.goalIds as string[]) ?? [];
  const li = h('li', { class: `work state-${String(w.state).toLowerCase()}` }, h('span', { class: 'work-state', text: t(STATE_LABEL, String(w.state)) }), content('span', String(w.objective), 'work-objective'));
  const foot = h('span', { class: 'work-foot' });
  if (opts.owner && w.ownerEmployeeId) foot.append(personRef(host, `employee:${String(w.ownerEmployeeId)}`, host.colorOf(`employee:${String(w.ownerEmployeeId)}`)));
  if (w.blockedReason) foot.append(content('span', `Blocked: ${humanize(String(w.blockedReason))}`, 'work-reason'));
  if (w.waitReason) foot.append(h('span', { class: 'work-reason', text: `Waiting: ${humanize(String(w.waitReason))}` }));
  if (opts.goals) for (const gid of goals) {
    const g = h('button', { type: 'button', class: 'link work-goal' }, h('span', { class: 'serves', 'aria-hidden': 'true' }), content('span', host.nameOf(`goal:${gid}`)));
    g.addEventListener('click', () => host.openGoal(gid));
    foot.append(g);
  }
  if (foot.childElementCount) li.append(foot);
  return li;
}

// --- context sheet: goal ----------------------------------------------------------------------------------

export function renderGoalFocus(root: HTMLElement, d: Json, host: PanelHost): void {
  root.replaceChildren();
  root.dataset.sheet = 'goal';
  root.style.setProperty('--accent', GOLD);
  const g = d.goal as Json;
  const company = g.kind === 'COMPANY';
  const proposed = g.state === 'PROPOSED' || g.state === 'DRAFT';
  const emblem = h('span', { class: `goal-emblem ${company ? '' : 'is-department'}`.trim(), 'aria-hidden': 'true' });
  root.append(sheetHead(host, String(g.title), [h('span', { class: 'goal-kind-sub', text: company ? 'Company goal' : 'Department goal' }), h('span', { class: 'sep' }), proposed ? h('span', { class: 'pill pill-needs_decision', text: 'Awaiting your decision' }) : statePill(String(g.state)), g.horizonTo ? h('span', { class: 'muted', text: `by ${fmtDate(String(g.horizonTo))}` }) : null], emblem));
  root.append(content('p', String(g.summary), 'sheet-summary'));
  const criteria = (g.successCriteria as string[]) ?? [];
  if (criteria.length) root.append(sectionEl('Success looks like', h('ul', { class: 'plain' }, ...criteria.map((c) => content('li', c)))));
  const work = (d.work as Json[]) ?? [];
  const path = h('ol', { class: 'goal-path', 'aria-label': 'How the goal becomes action' });
  const ownerRef = String(g.ownerRef);
  path.append(h('li', {}, h('span', { class: 'step', text: 'Owner' }), personRef(host, ownerRef, host.colorOf(ownerRef))));
  const depts = (d.departments as string[]) ?? [];
  const deptEl = h('span', { class: 'chips' });
  if (depts.length === 0) deptEl.append(h('span', { class: 'muted', text: proposed ? 'No department until you decide' : 'No department linked yet' }));
  for (const id of depts) {
    const b = h('button', { type: 'button', class: 'chip chip-dept', text: host.deptNameOf(id), style: `--dept:${host.deptColorOf(id)}` });
    b.addEventListener('click', () => host.openDepartment(id));
    deptEl.append(b);
  }
  path.append(h('li', {}, h('span', { class: 'step', text: depts.length === 1 ? 'Serving department' : 'Serving departments' }), deptEl));
  const workEl = h('ul', { class: 'work-list' });
  if (work.length === 0) workEl.append(h('li', { class: 'empty', text: proposed ? 'No work yet — the company lines its work up behind a goal once you approve it.' : 'No work linked yet — this goal has not turned into action.' }));
  for (const w of work) workEl.append(workRow(w, host, { owner: true, goals: false }));
  path.append(h('li', {}, h('span', { class: 'step', text: plural(work.length, 'Work item', 'Work items') }), workEl));
  const paths = (d.paths as Json[]) ?? [];
  path.append(h('li', {}, h('span', { class: 'step', text: 'Reviews and approvals' }), h('span', { class: paths.length === 0 ? 'muted' : '', text: paths.length === 0 ? 'None open' : paths.map((p) => t(RELATION_LABEL, String(p.kind))).join(', ') })));
  root.append(sectionEl('From goal to action', path));
  const children = (d.children as Json[]) ?? [];
  if (children.length) root.append(sectionEl('Derived goals', h('ul', { class: 'plain' }, ...children.map((c) => { const b = h('button', { type: 'button', class: 'link', text: String(c.title) }); b.dir = dirOf(String(c.title)); b.addEventListener('click', () => host.openGoal(String(c.id))); return h('li', {}, b, h('span', { class: 'muted', text: ` · ${t(STATE_LABEL, String(c.state))}` })); }))));
  if (company && g.state === 'PROPOSED') {
    const approve = h('button', { type: 'button', class: 'btn btn-primary btn-wide', text: 'Approve this goal' });
    approve.addEventListener('click', () => void host.previewAction('GOAL_APPROVE', { goalId: String(g.id), activate: true }));
    root.append(h('div', { class: 'sheet-actions' }, approve));
  }
}

// --- context sheet: conversation -----------------------------------------------------------------------

export function renderConversation(root: HTMLElement, d: { thread: Json; messages: Json[]; pending: Json[] }, host: PanelHost, universe: CompanyUniverse | null, deptColor: string): void {
  // A live company refreshes the thread while the Founder types: the draft and the chosen purpose survive it.
  const draft = root.querySelector<HTMLTextAreaElement>('.composer textarea')?.value ?? '';
  const draftPurpose = root.querySelector<HTMLElement>('.chip-choice.is-active')?.dataset.purpose ?? 'QUESTION';
  // The newest exchange stays under the eye: the ledger opens at its end, and follows it unless the Founder
  // has scrolled back to read.
  const wasReading = root.dataset.sheet === 'conversation' && root.scrollHeight - root.scrollTop - root.clientHeight > 48;
  root.replaceChildren();
  root.dataset.sheet = 'conversation';
  const th = d.thread;
  const employee = universe?.employees.find((e) => e.id === th.employeeId);
  const name = employee ? `${employee.name.given} ${employee.name.family}` : String(th.subject);
  const given = employee?.name.given ?? name;
  const seat = employee ? universe?.seats.find((s) => s.holderEmployeeId === employee.id) : undefined;
  const isCeo = th.kind === 'FOUNDER_CEO' || th.kind === 'CEO_BRIEF' || seat?.kind === 'CEO';
  const accent = isCeo ? GOLD : deptColor;
  root.style.setProperty('--accent', accent);
  const deptLabel = employee?.departmentId ? host.deptNameOf(employee.departmentId) : 'Company';
  const manager = employee?.chain?.[1];
  const reportsTo = isCeo ? 'reports to you' : manager?.kind === 'FOUNDER' ? 'reports to you' : manager?.employeeId ? `reports to ${host.nameOf(`employee:${String(manager.employeeId)}`)}` : null;
  root.append(sheetHead(host, name, [h('span', { text: seat ? (isCeo ? 'Chief Executive Officer' : seat.title) : 'Direct conversation' }), ...(employee?.departmentId && !isCeo ? [h('span', { class: 'sep' }), h('span', { class: 'sheet-dept', text: deptLabel })] : []), reportsTo ? h('span', { class: 'muted', text: `· ${reportsTo}` }) : null], personAvatar(name, accent, 'avatar-lg')));
  // Context: the work this person is carrying and the goals it serves — the conversation happens inside the
  // company, not beside it.
  const work = employee ? (universe?.work ?? []).filter((w) => w.ownerEmployeeId === employee.id && w.state !== 'COMPLETED' && w.state !== 'CANCELLED') : [];
  const goalIds = [...new Set(work.flatMap((w) => w.goalIds as readonly string[]))];
  const context = h('div', { class: 'conv-context' });
  if (work.length) {
    const chips = h('div', { class: 'chips context-chips', 'aria-label': `What ${given} is carrying now` });
    for (const w of work.slice(0, 4)) chips.append(h('span', { class: `chip chip-${String(w.state).toLowerCase()}` }, h('span', { class: 'chip-state', text: t(STATE_LABEL, w.state) }), content('span', w.objective)));
    context.append(h('p', { class: 'conv-context-title', text: isCeo ? 'Carrying now' : `${given} is carrying now` }), chips);
  }
  if (goalIds.length) {
    const goals = h('div', { class: 'chips context-chips', 'aria-label': 'Goals this work serves' });
    for (const gid of goalIds) {
      const b = h('button', { type: 'button', class: 'chip chip-goal' }, h('span', { class: 'serves', 'aria-hidden': 'true' }), content('span', host.nameOf(`goal:${gid}`)));
      b.addEventListener('click', () => host.openGoal(gid));
      goals.append(b);
    }
    context.append(goals);
  }
  if (context.childElementCount) root.append(context);
  const list = h('ol', { class: 'ledger', 'aria-live': 'polite', 'aria-label': `Conversation with ${name}` });
  let lastDay = '';
  for (const m of d.messages) {
    const at = String(m.createdAt);
    const day = fmtDate(at);
    if (day !== lastDay) {
      lastDay = day;
      const today = fmtDate(new Date().toISOString()) === day;
      list.append(h('li', { class: 'ledger-day', 'aria-hidden': 'true' }, h('span', { text: today ? 'Today' : day })));
    }
    const mine = m.senderKind === 'FOUNDER';
    const meta = h('div', { class: 'entry-meta' }, mine ? h('span', { class: 'avatar avatar-founder avatar-sm', text: 'Q', 'aria-hidden': 'true' }) : personAvatar(name, accent, 'avatar-sm'), h('span', { class: 'who', text: mine ? 'You' : name }), h('span', { class: `purpose purpose-${String(m.purpose).toLowerCase()}`, text: t(PURPOSE_LABEL, String(m.purpose)) }), h('time', { class: 'when', text: fmtTime(at), title: fmtDateTime(at) }));
    const li = h('li', { class: `entry ${mine ? 'from-founder' : 'from-employee'}` }, meta);
    const brief = m.brief as Json | null;
    if (brief) li.append(briefBlock(brief));
    else li.append(content('p', String(m.body), 'entry-body'));
    list.append(li);
  }
  for (const p of d.pending) list.append(h('li', { class: 'entry pending' }, h('span', { class: 'pending-ring', 'aria-hidden': 'true' }), h('span', { class: 'who', text: name }), h('span', { text: ` is working on a reply · ${t(STATE_LABEL, String(p.workItemState))}` })));
  if (d.messages.length === 0 && d.pending.length === 0) list.append(h('li', { class: 'entry empty' }, h('strong', { text: 'Nothing said yet.' }), h('span', { text: ` Write to ${given} in English or Arabic; the reply comes from ${isCeo ? 'the CEO’s' : 'their'} own governed run.` })));
  root.append(list);
  const form = h('form', { class: 'composer' }) as HTMLFormElement;
  const purposes = ['QUESTION', 'REQUEST', 'DECISION_REQUEST', 'FYI', 'CORRECTION'];
  let purpose = purposes.includes(draftPurpose) ? draftPurpose : 'QUESTION';
  const chips = h('div', { class: 'purpose-chips', role: 'radiogroup', 'aria-label': 'Message purpose' });
  const chipEls = purposes.map((p) => {
    const b = h('button', { type: 'button', role: 'radio', class: `chip chip-choice${p === purpose ? ' is-active' : ''}`, 'aria-checked': p === purpose ? 'true' : 'false', 'data-purpose': p, text: t(PURPOSE_LABEL, p) });
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
  const text = h('textarea', { 'aria-label': `Message to ${given}`, name: 'body', rows: 3, placeholder: `Write to ${given} in English or Arabic…`, maxlength: 4000, dir: 'auto' }) as HTMLTextAreaElement;
  text.value = draft;
  const send = h('button', { type: 'submit', class: 'btn btn-primary', text: `Send to ${given}` });
  form.append(h('div', { class: 'composer-head' }, h('span', { class: 'composer-to', text: `To ${given}, as` }), chips), text, h('div', { class: 'composer-foot' }, h('span', { class: 'hint', text: 'Enter sends · Shift+Enter for a new line' }), send), h('p', { class: 'composer-note', text: 'A conversation never grants authority: a budget, an approval or a goal becomes a governed preview you confirm yourself.' }));
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
  if (!wasReading) root.scrollTop = root.scrollHeight;
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
    if (result.pilots) root.append(renderPilots(result.pilots as Json, host));
  }
  return input;
}

const NEXT_PILOT_STEP: Readonly<Record<string, string>> = { DRAFT: 'BRIEFING', BRIEFING: 'READY', READY: 'ACTIVE', ACTIVE: 'REVIEWING', REVIEWING: 'COMPLETED' };

/**
 * C7-C: the Founder's Pilots in the palette (no new canvas, no Tree of Light change). Each Pilot shows its mode, state,
 * the exact decision it waits for, its briefing conversation and — when one is open — the advisory readiness checklist,
 * each criterion with its own evidence state (never a score). Every step is a structured preview the Founder confirms.
 */
function renderPilots(data: Json, host: PanelHost): HTMLElement {
  const section = h('section', { class: 'pilots', 'aria-label': 'Pilots' });
  const list = (data.list as Json[]) ?? [];
  const goals = (data.goals as Json[]) ?? [];
  const board = data.board as Json | undefined;
  section.append(h('h3', { class: 'section-title', text: 'Pilots' }));
  if (list.length === 0) section.append(h('p', { class: 'muted small', text: 'No pilot yet. A pilot starts as a draft: talk with the CEO first, then decide when it is ready.' }));
  const ul = h('ul', { class: 'pilot-list' });
  for (const p of list) {
    const state = String(p.state);
    const li = h('li', { class: 'pilot' }, content('strong', String(p.title)), ' ', h('span', { class: 'pill', text: t(PILOT_MODE_LABEL, String(p.mode)) }), ' ', h('span', { class: 'pill', text: t(STATE_LABEL, state) }));
    const actions = h('div', { class: 'pilot-actions' });
    if (typeof p.briefingThreadId === 'string') {
      const open = h('button', { type: 'button', class: 'link', text: 'Open the CEO briefing' });
      open.addEventListener('click', () => host.openThread(String(p.briefingThreadId), ''));
      actions.append(open);
    }
    const next = NEXT_PILOT_STEP[state];
    if (next !== undefined && next !== 'ACTIVE') {
      const b = h('button', { type: 'button', class: 'btn btn-quiet', text: `Preview: ${t(STATE_LABEL, next)}` });
      b.addEventListener('click', () => void host.previewAction('PILOT_ADVANCE', { pilotId: String(p.id), to: next }));
      actions.append(b);
    }
    if (next === 'ACTIVE') {
      for (const g of goals) {
        const b = h('button', { type: 'button', class: 'btn btn-quiet', text: `Preview: activate on “${String(g.title)}”` });
        b.dir = dirOf(String(g.title));
        b.addEventListener('click', () => void host.previewAction('PILOT_ADVANCE', { pilotId: String(p.id), to: 'ACTIVE', goalId: String(g.id) }));
        actions.append(b);
      }
    }
    if (state !== 'COMPLETED' && state !== 'STOPPED') {
      const stop = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Preview: stop' });
      stop.addEventListener('click', () => void host.previewAction('PILOT_ADVANCE', { pilotId: String(p.id), to: 'STOPPED' }));
      actions.append(stop);
    }
    li.append(actions);
    ul.append(li);
  }
  section.append(ul);
  if (board) {
    const decisions = (board.decisionsNeeded as string[]) ?? [];
    if (decisions.length > 0) section.append(h('p', { class: 'pilot-decisions' }, h('span', { class: 'pill pill-needs_decision', text: 'Your decision' }), ' ', decisions.map((d) => t(PILOT_DECISION_LABEL, d)).join(' · ')));
    const external = (board.external as Json) ?? {};
    section.append(h('p', { class: 'muted small', text: t(MARKET_CLAIM_LABEL, String(external.marketClaim)) }));
    const dl = h('dl', { class: 'facts readiness', 'aria-label': 'Readiness evidence (advisory, never a score)' });
    for (const r of (board.readiness as Json[]) ?? []) dl.append(h('dt', { text: t(READINESS_LABEL, String(r.criterion)) }), h('dd', { text: t(EVIDENCE_LABEL, String(r.state)) }));
    section.append(dl, h('p', { class: 'muted small', text: 'Readiness is advisory evidence. You decide the next phase.' }));
  }
  // Creating a pilot: a title and a mode, posted as a structured preview (nothing exists until you confirm).
  const form = h('form', { class: 'pilot-create' });
  const title = h('input', { type: 'text', maxlength: 160, placeholder: 'Pilot title', 'aria-label': 'Pilot title', dir: 'auto', required: true }) as HTMLInputElement;
  const mode = h('select', { 'aria-label': 'Pilot mode' }, h('option', { value: 'TRAINING_INTERNAL', text: t(PILOT_MODE_LABEL, 'TRAINING_INTERNAL') }), h('option', { value: 'CONTROLLED_REAL', text: t(PILOT_MODE_LABEL, 'CONTROLLED_REAL') })) as HTMLSelectElement;
  form.append(title, mode, h('button', { type: 'submit', class: 'btn btn-quiet', text: 'Preview: create pilot' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (title.value.trim()) void host.previewAction('PILOT_CREATE', { title: title.value.trim(), mode: mode.value });
  });
  section.append(form);
  return section;
}
/** Payload fields the Founder reads: identifiers are resolved to names or dropped, never shown as codes. */
const HIDDEN_FIELDS = new Set(['pilotId', 'threadId', 'reasonCode', 'currency', 'approvalId', 'goalId', 'budgetId', 'requestId', 'conflictId', 'employeeId', 'invocationId', 'reservationId', 'jobId', 'findingId', 'attributionId', 'lessonId', 'promotionId', 'workItemId']);

export function renderPreview(root: HTMLElement, preview: Json, host: PanelHost): void {
  root.replaceChildren();
  const payload = (preview.payload as Json) ?? {};
  const currency = typeof payload.currency === 'string' ? payload.currency : 'EGP';
  const scope = typeof payload.scope === 'string' ? payload.scope : null;
  const value = (k: string, v: unknown): HTMLElement => {
    if (k === 'capMoney' && typeof v === 'number') return h('span', { text: fmtMoneyMicros(v, currency) });
    if (k === 'capTokens' && typeof v === 'number') return h('span', { text: `${fmtNumber(v)} tokens` });
    if (k === 'decision' || k === 'outcome' || k === 'verdict') return h('span', { text: t(DECISION_LABEL, String(v)) });
    if (Array.isArray(v)) return h('span', { text: v.map((x) => humanize(String(x))).join(', ') });
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
  // The safe choice has the focus (m-43): an Enter pressed out of habit cancels, it never executes.
  cancel.focus();
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
