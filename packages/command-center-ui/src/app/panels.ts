/**
 * The DOM surfaces around the company: the attention surface (opens beside the Founder on demand), the
 * context sheet (a person, a goal — docked beside the company, tethered to what it is about; a conversation is its own
 * Chat screen, `chat.ts`),
 * the command palette, the governed-action confirmation, the time control, the upcoming dock and the activity
 * note. The application speaks English; company content is shown as written (an Arabic message reads
 * right-to-left inside its own block). Every control names its action; no code or identifier reaches the
 * Founder as a code. The sheets share the company's language: the same avatars, Department accents, gold,
 * radii and status grammar as the cards in the columns.
 */
import { ACTION_LABEL, CALENDAR_LABEL, CAPABILITY_LABEL, DECISION_LABEL, dirOf, EVIDENCE_LABEL, FIELD_LABEL, fmtDate, fmtDateTime, fmtMoneyMicros, fmtNumber, fmtRelative, hasArabic, humanize, INTENT_LABEL, KIND_LABEL, LANE_LABEL, MARKET_CLAIM_LABEL, PILOT_DECISION_LABEL, PILOT_MODE_LABEL, plural, PROMOTION_KIND_LABEL, PROMOTION_STATE_LABEL, PURPOSE_LABEL, READINESS_LABEL, RELATION_LABEL, SCOPE_LABEL, SOURCE_LABEL, STATE_LABEL, t } from '../model/format.js';
import { isLevel, LEVEL_SHORT, LEVEL_STATE_LABEL, LEVEL_THINKING, LEVELS, levelState, modelLabel, reasonText } from '../model/intelligence.js';
import type { CompanyUniverse } from '../model/types.js';
import { renderActivation } from './activation.js';
import { trainingFacts } from './halls.js';
import { keepFocus, restoreFocus } from './keep-focus.js';

type Json = Record<string, unknown>;

export const h = (tag: string, attrs: Record<string, string | number | boolean> = {}, ...children: (Node | string | null | undefined)[]): HTMLElement => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    // P1-CHAT-INTEL-01: the page's CSP (`style-src 'self'`) drops inline style attributes; declarations go through the
    // CSSOM instead (allowed), so a person's accent and a meter's fill actually render.
    else if (k === 'style') {
      for (const decl of String(v).split(';')) {
        const at = decl.indexOf(':');
        if (at > 0) e.style.setProperty(decl.slice(0, at).trim(), decl.slice(at + 1).trim());
      }
    }
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
const GOLD = '#d8a84a';

export interface PanelHost {
  openEmployee(id: string): void;
  openGoal(id: string): void;
  openDepartment(id: string): void;
  openThread(threadId: string, employeeId: string): void;
  startConversation(employeeId: string | null): void;
  /** D2-UX-01: the company-wide Academy overview (a read). */
  openAcademy(): void;
  /** D2-UX-01: closes the command panel (and the activation view in it); never touches a pending confirmation. */
  closePalette(): void;
  runCommand(text: string): Promise<void>;
  /**
   * A structured act the surface already knows (IDs / codes): posted as a governed preview, never re-typed as text.
   * Resolves to null once the confirmation dialog shows the preview, or to the refusal in words (nothing changed).
   */
  previewAction(intent: string, payload: Json): Promise<string | null>;
  /** C7-D: opens an internal Preview on its isolated host in a new tab without an opener (never in this page). */
  openDigitalPreview(previewId: string): Promise<void>;
  confirmPreview(previewId: string, fingerprint: string): Promise<void>;
  rejectPreview(previewId: string): Promise<void>;
  dismissAttention(itemId: string): Promise<void>;
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

function sheetHead(host: PanelHost, title: string, sub: (Node | string | null)[], avatar: HTMLElement | null, closeLabel = 'Close and return to the company'): HTMLElement {
  // P1-CHAT-INTEL-01: a visible × closes the sheet and returns to the company. The Company keeps running; nothing is lost.
  const back = h('button', { type: 'button', class: 'btn btn-ghost sheet-close', 'aria-label': closeLabel, title: 'Close (Esc)', 'data-keep': 'sheet-close' }, h('span', { 'aria-hidden': 'true', text: '×' }));
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

/**
 * D2-UX-01: one person, read top-down — who they are with the two things the Founder does with them (Talk, Budget) in
 * the sheet's sticky head; then what the record says about them; their skills and training; their reporting line and
 * authority; and only then their work and live relations. Nothing here is invented: a fact the record does not hold is
 * shown as not on record.
 */
export function renderEmployeeFocus(root: HTMLElement, d: Json, host: PanelHost, deptColor: string): void {
  // A live company re-renders the sheet: an open budget entry, its draft amount, the reading position and the focused
  // control (with the caret and selection in the amount) survive it.
  const same = root.dataset.sheet === 'employee' && root.dataset.employeeId === String((d.employee as Json).id);
  const budgetOpen = same && root.querySelector('.budget-editor') !== null;
  const budgetDraft = same ? (root.querySelector<HTMLInputElement>('.budget-editor input')?.value ?? '') : '';
  const intelOpen = same && root.querySelector('.intel-editor') !== null;
  const intelDraft = { defaultClass: root.querySelector<HTMLSelectElement>('#intel-default')?.value ?? '', ceilingClass: root.querySelector<HTMLSelectElement>('#intel-ceiling')?.value ?? '' };
  const scroll = same ? root.scrollTop : 0;
  const kept = same ? keepFocus(root) : null;
  root.replaceChildren();
  root.dataset.sheet = 'employee';
  root.style.setProperty('--accent', deptColor);
  const e = d.employee as Json;
  root.dataset.employeeId = String(e.id);
  const seat = d.seat as Json | null;
  const dept = d.department as Json | null;
  const profile = d.profile as Json | null;
  const name = e.name as { given: string; family: string };
  const full = `${name.given} ${name.family}`;
  const chain = (e.chain as Json[]) ?? [];
  const deptLabel = dept ? host.deptNameOf(String(dept.id)) : 'Company';
  const isCeo = seat?.kind === 'CEO';
  const roleTitle = seat ? (isCeo ? 'Chief Executive Officer' : String(seat.title)) : null;
  const head = sheetHead(host, full, [h('span', { text: roleTitle ?? 'No seat' }), h('span', { class: 'sep' }), h('span', { class: 'sheet-dept', text: deptLabel }), seat && seat.holderKind === 'ACTING' ? h('span', { class: 'pill pill-acting', text: 'Acting cover' }) : null, statePill(String(e.state))], personAvatar(full, deptColor, 'avatar-lg'), `Close the profile of ${full}`);
  // 1. The primary actions live in the sticky head: visible without scrolling past any work, on every window size.
  const budget = d.budget as Json | null;
  const talk = h('button', { type: 'button', class: 'btn btn-primary', text: `Talk to ${name.given}`, 'aria-label': `Talk to ${full}`, 'data-keep': 'talk' });
  talk.addEventListener('click', () => host.startConversation(String(e.id)));
  const budgetBtn = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Budget', 'aria-label': `Budget of ${full}`, 'aria-expanded': 'false', 'aria-controls': 'budget-editor', 'data-keep': 'budget' });
  head.append(h('div', { class: 'sheet-primary', role: 'group', 'aria-label': `Actions for ${full}` }, talk, budgetBtn));
  root.append(head);
  const editorSlot = h('div', { class: 'budget-slot' });
  root.append(editorSlot);
  const closeEditor = (): void => {
    editorSlot.replaceChildren();
    budgetBtn.setAttribute('aria-expanded', 'false');
  };
  const openEditor = (draft: string, focus: boolean): void => {
    editorSlot.replaceChildren(budgetEditor(full, budget, host, draft, () => {
      closeEditor();
      budgetBtn.focus();
    }));
    budgetBtn.setAttribute('aria-expanded', 'true');
    if (focus) editorSlot.querySelector<HTMLElement>('input, .btn')?.focus();
  };
  budgetBtn.addEventListener('click', () => (editorSlot.childElementCount ? closeEditor() : openEditor('', true)));
  if (budgetOpen) openEditor(budgetDraft, false);

  // 2. About: the record's own facts (no biography is invented).
  const about = h('dl', { class: 'facts about-facts' });
  const fact = (k: string, v: Node | string): void => {
    about.append(h('dt', { text: k }), h('dd', {}, v));
  };
  fact('Role', roleTitle ?? humanize(String(e.roleRef)));
  fact('Department', deptLabel);
  if (profile?.displayNameAr) fact('Arabic name', content('span', String(profile.displayNameAr)));
  if (profile?.since) fact('With the company since', fmtDate(String(profile.since)));
  if (profile?.identityProfile) fact('Identity profile', humanize(String(profile.identityProfile)));
  const record = profile?.work as Json | undefined;
  fact('Work on record', record ? `${plural(Number(record.total), 'work item', 'work items')} owned, ${fmtNumber(Number(record.completed))} completed` : 'Not on record');
  root.append(sectionEl(`About ${name.given}`, about, h('p', { class: 'muted small', text: 'Only what the Company record holds. No biography or outside experience is on record.' })));

  // 3. Skills, qualifications and training (the Academy overview narrowed to this person).
  const training = h('div', { class: 'training' });
  if (profile) {
    const f = trainingFacts(profile);
    const tf = h('dl', { class: 'facts' });
    for (const [k, v] of [['Academy', f.stage], ['Programme', f.modules], ['Attempts', f.attempts], ['Certification', f.certification]] as const) tf.append(h('dt', { text: k }), h('dd', { text: v }));
    training.append(tf);
    const skills = (profile.skills as Json[]) ?? [];
    const chips = h('div', { class: 'chips', 'aria-label': 'Skill passport' });
    if (skills.length === 0) chips.append(h('span', { class: 'muted', text: 'No skills on the passport yet' }));
    for (const s of skills) chips.append(h('span', { class: 'chip' }, h('span', { text: String(s.name) }), h('span', { class: 'chip-state', text: t(PROFICIENCY_LABEL, String(s.proficiency)) })));
    training.append(chips);
    const requires = (profile.roleRequires as Json[]) ?? [];
    if (requires.length) training.append(h('p', { class: 'muted small', text: `The role asks for: ${requires.map((r) => `${String(r.name)} (${t(PROFICIENCY_LABEL, String(r.minProficiency)).toLowerCase()}${r.critical ? ', critical' : ''})`).join(', ')}` }));
    const reviewer = (profile.reviewer as Json[]) ?? [];
    if (reviewer.length) training.append(h('p', { class: 'muted small', text: `Review Pool: ${reviewer.map((q) => `${humanize(String(q.domain))} — ${humanize(String(q.level))}, ${humanize(String(q.mode)).toLowerCase()}`).join('; ')}` }));
  } else training.append(h('p', { class: 'muted', text: 'No Academy record.' }));
  const academy = h('button', { type: 'button', class: 'link', text: 'Open the Academy', 'data-keep': 'open-academy' });
  academy.addEventListener('click', () => host.openAcademy());
  training.append(academy);
  root.append(sectionEl('Skills and training', training));

  // 3b. P1-CHAT-INTEL-01: Employee Intelligence — the fixed model, the standing default and maximum, what each level can do
  // in conversation now, and the actual usage and money. Changing the standing levels is the governed preview (never here).
  const intel = (d.intelligence as Json | null) ?? null;
  if (intel) root.append(intelligenceSection(full, name.given, String(e.id), intel, host, intelOpen ? intelDraft : null));

  // 4. Reporting line and authority.
  const chainEl = h('ol', { class: 'chain', 'aria-label': 'Reporting line to the Founder' });
  for (const link of chain) {
    if (String(link.employeeId) === String(e.id)) continue;
    const li = h('li', {});
    if (link.kind === 'FOUNDER') li.append(personRef(host, 'founder', GOLD, 'Owner of the company'));
    else if (link.employeeId) li.append(personRef(host, `employee:${String(link.employeeId)}`, host.colorOf(`employee:${String(link.employeeId)}`), t(KIND_LABEL, String(link.kind))));
    else li.append(h('span', { class: 'person' }, h('span', { class: 'avatar avatar-vacant', 'aria-hidden': 'true' }), h('span', { class: 'person-name muted', text: 'Vacant seat' }), h('span', { class: 'person-sub', text: t(KIND_LABEL, String(link.kind)) })));
    chainEl.append(li);
  }
  root.append(sectionEl('Reports to', chainEl));
  const grants = (d.grants as Json[]) ?? [];
  const authority = h('div', { class: 'authority' });
  authority.append(budget ? budgetMeter(budget) : h('p', { class: 'muted small', text: 'No budget envelope.' }));
  const may = h('div', { class: 'chips' });
  if (grants.length === 0) may.append(h('span', { class: 'muted', text: 'Nothing granted yet' }));
  for (const g of grants) may.append(h('span', { class: 'chip chip-grant' }, h('span', { text: t(CAPABILITY_LABEL, String(g.capability)) }), h('span', { class: 'chip-state', text: String(g.riskCeiling) })));
  authority.append(may);
  root.append(sectionEl('Authority', authority));

  // 5. Work, then live relations.
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
  restoreFocus(root, kept);
  root.scrollTop = scroll;
}

/**
 * P1-CHAT-INTEL-01: Employee Intelligence on the profile. Facts only (codes and numbers from the server); the one act is
 * the existing EMPLOYEE_REASONING_PROFILE governed preview (its confirmation names the certifications that become due for
 * review). A per-message level is chosen in the Chat, never here.
 */
function intelligenceSection(full: string, given: string, employeeId: string, intel: Json, host: PanelHost, draft: { defaultClass: string; ceilingClass: string } | null): HTMLElement {
  const def = String(intel.defaultClass);
  const max = String(intel.ceilingClass);
  const facts = h('dl', { class: 'facts intel-facts' });
  const fact = (k: string, v: Node | string): void => {
    facts.append(h('dt', { text: k }), h('dd', {}, v));
  };
  fact('Model', modelLabel(intel));
  fact('Default level', `${def} · ${isLevel(def) ? LEVEL_THINKING[def] : ''}`);
  fact('Maximum level', `${max} · ${isLevel(max) ? LEVEL_THINKING[max] : ''}`);
  const levels = h('ul', { class: 'intel-levels', 'aria-label': `Reasoning levels for conversation with ${full}` });
  for (const l of LEVELS) {
    const s = levelState(intel, l);
    levels.append(h('li', { class: `intel-level ${s.available ? 'is-available' : 'is-unavailable'}`, title: s.available ? `${LEVEL_THINKING[l]}: available for a message` : `${LEVEL_THINKING[l]}: ${reasonText(s.code, humanize)}` }, h('strong', { text: l }), h('span', { text: LEVEL_SHORT[l] }), h('span', { class: 'intel-level-state', text: l === def && s.available ? 'Default' : (LEVEL_STATE_LABEL[s.code] ?? humanize(s.code)) })));
  }
  const usage = (intel.usage as Json[]) ?? [];
  const env = intel.envelope as Json | null;
  const currency = env ? String(env.currency) : 'USD';
  const usageEl = h('table', { class: 'intel-usage' });
  if (usage.length === 0) usageEl.append(h('caption', { class: 'muted small', text: 'No model calls yet.' }));
  else {
    usageEl.append(h('thead', {}, h('tr', {}, h('th', { text: 'Level' }), h('th', { text: 'Calls' }), h('th', { text: 'Tokens in / out' }), h('th', { text: 'Cost' }))));
    const body = h('tbody');
    for (const u of usage) body.append(h('tr', {}, h('td', { text: String(u.reasoningClass) }), h('td', { text: fmtNumber(Number(u.calls)) }), h('td', { text: `${fmtNumber(Number(u.inputTokens))} / ${fmtNumber(Number(u.outputTokens))}` }), h('td', { text: fmtMoneyMicros(Number(u.economicMicros), currency), title: `Billed by the provider: ${fmtMoneyMicros(Number(u.billedMicros), currency)}` })));
    usageEl.append(body);
  }
  const money = env ? h('p', { class: 'muted small', text: `Envelope: cap ${fmtMoneyMicros(Number(env.capMoney), currency)} (a hard ceiling) · held for calls in flight ${fmtMoneyMicros(Number(env.reservedMoney), currency)} · actually spent ${fmtMoneyMicros(Number(env.spentMoney), currency)}.` }) : h('p', { class: 'muted small', text: 'No budget envelope: no model call can be made.' });
  const slot = h('div', { class: 'intel-slot' });
  const change = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Change default or maximum', 'aria-expanded': 'false', 'data-keep': 'intel-change' });
  const close = (): void => {
    slot.replaceChildren();
    change.setAttribute('aria-expanded', 'false');
  };
  const open = (values: { defaultClass: string; ceilingClass: string }, focus: boolean): void => {
    const box = h('form', { class: 'intel-editor', 'aria-label': `Standing reasoning levels of ${full}` }) as HTMLFormElement;
    const select = (id: string, label: string, value: string): HTMLSelectElement => {
      const s = h('select', { id, 'data-keep': id }) as HTMLSelectElement;
      for (const l of LEVELS) s.append(h('option', { value: l, text: `${l} · ${LEVEL_THINKING[l]}` }));
      s.value = isLevel(value) ? value : def;
      box.append(h('label', { for: id, class: 'budget-label', text: label }), s);
      return s;
    };
    const ds = select('intel-default', 'Default level (every reply starts here)', values.defaultClass || def);
    const cs = select('intel-ceiling', 'Maximum level (the highest any reply may use)', values.ceilingClass || max);
    const error = h('p', { class: 'budget-error', role: 'alert' });
    const cancel = h('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancel', 'data-keep': 'intel-cancel' });
    cancel.addEventListener('click', () => {
      close();
      change.focus();
    });
    box.append(h('p', { class: 'muted small', text: `A permanent change to ${given}’s Cognitive Profile. The preview shows which certifications become due for review; nothing changes until you confirm it. Budgets, authority and the model do not change.` }), error, h('div', { class: 'budget-actions' }, cancel, h('button', { type: 'submit', class: 'btn btn-primary', text: 'Preview the change', 'data-keep': 'intel-preview' })));
    box.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        close();
        change.focus();
      }
    });
    box.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (LEVELS.indexOf(ds.value as never) > LEVELS.indexOf(cs.value as never)) {
        error.textContent = 'The maximum must be at or above the default.';
        return;
      }
      if (ds.value === def && cs.value === max) {
        error.textContent = 'That is already the standing profile.';
        return;
      }
      error.textContent = '';
      void host.previewAction('EMPLOYEE_REASONING_PROFILE', { employeeId, defaultClass: ds.value, ceilingClass: cs.value, reasonCode: 'founder.reasoning_profile' });
    });
    slot.replaceChildren(box);
    change.setAttribute('aria-expanded', 'true');
    if (focus) ds.focus();
  };
  change.addEventListener('click', () => (slot.childElementCount ? close() : open({ defaultClass: def, ceilingClass: max }, true)));
  if (draft) open(draft, false);
  return sectionEl('Employee Intelligence', facts, levels, h('p', { class: 'muted small', text: 'In the Chat a level can be chosen for one message; it never changes these standing levels.' }), usageEl, money, change, slot);
}

const PROFICIENCY_LABEL: Readonly<Record<string, string>> = { LEARNING: 'Learning', QUALIFIED: 'Qualified', PROFICIENT: 'Proficient', EXPERT: 'Expert' };

function budgetMeter(budget: Json): HTMLElement {
  const spent = Number(budget.spentMoney);
  const cap = Number(budget.capMoney);
  const ratio = cap > 0 ? Math.min(1, spent / cap) : 0;
  return h('div', { class: 'meter', role: 'img', 'aria-label': `${fmtMoneyMicros(spent, String(budget.currency))} spent of ${fmtMoneyMicros(cap, String(budget.currency))}` }, h('span', { class: 'meter-bar' }, h('span', { class: 'meter-fill', style: `width:${Math.round(ratio * 100)}%` })), h('span', { class: 'meter-text' }, h('strong', { text: fmtMoneyMicros(spent, String(budget.currency)) }), h('span', { class: 'muted', text: ` of ${fmtMoneyMicros(cap, String(budget.currency))}` })));
}

/**
 * D2-UX-01: a typed budget ceiling in the envelope's own currency → micro-units, or null. Digits with up to two decimals
 * (thousands commas tolerated), strictly above zero: an empty, zero, negative or malformed entry is never sent.
 */
export function budgetCeilingMicros(raw: string): number | null {
  const text = raw.trim().replace(/,/g, '');
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(text)) return null;
  const [units = '0', cents = ''] = text.split('.');
  const micros = Number(units) * 1_000_000 + Number(cents.padEnd(2, '0')) * 10_000;
  return Number.isSafeInteger(micros) && micros > 0 ? micros : null;
}

/**
 * P1-UX-BUDGET-DARK-01: a governed act the boundary refused, in words. In every case nothing changed. A budget ceiling
 * is checked against the envelope above it and the envelopes beneath it only at confirmation, so those refusals are
 * named here; any other act keeps the typed code.
 */
export function refusalText(intent: string, code: string, reason: string | null): string {
  if (code === 'FOUNDER_CONFIRMATION_REQUIRED') {
    if (reason === 'ALREADY_EXPIRED') return 'This preview expired before it was confirmed. Nothing changed — preview the change again.';
    if (reason === 'FINGERPRINT_MISMATCH') return 'This preview no longer matches the record. Nothing changed — preview the change again.';
    if (reason === 'SESSION_MISMATCH') return 'This preview belongs to an earlier session. Nothing changed — preview the change again.';
    if (reason !== null && reason.startsWith('ALREADY_')) return 'This preview was already decided. Nothing changed by this confirmation.';
  }
  if (intent === 'BUDGET_CEILING') {
    if (code === 'BUDGET_EXHAUSTED') return 'A ceiling cannot be higher than the ceiling of the envelope above it (the Company’s, or the Department’s). Raise that one first. Nothing changed.';
    if (code === 'VALIDATION_FAILED') return 'A ceiling cannot drop below what is already spent and reserved, or below the ceiling of an envelope beneath it that can still spend. Nothing changed.';
    if (code === 'CURRENCY_MISMATCH') return 'The amount must be in the envelope’s own currency. Nothing changed.';
    if (code === 'NOT_FOUND') return 'That budget envelope is no longer on record. Nothing changed.';
  }
  return `Not executed (${code}). Nothing changed.`;
}

/** P1-UX-BUDGET-DARK-01: what an envelope can still admit — its ceiling less what is spent and reserved, never below zero. */
export function budgetHeadroomMicros(budget: Json): number {
  return Math.max(0, Number(budget.capMoney) - Number(budget.spentMoney) - Number(budget.reservedMoney ?? 0));
}

/**
 * The budget ceiling, stated explicitly: no default amount. A valid entry becomes the existing BUDGET_CEILING governed
 * preview (fingerprinted, confirmed by the Founder in the confirmation dialog) and nothing else. One editor for every
 * envelope the Founder sets by hand — a person's (the sheet) and the Company's (the Company panel, P1-UX-BUDGET-DARK-01);
 * `idPrefix` keeps the two apart when both are open. The token cap is never sent, so it stays as it is.
 */
export function budgetEditor(full: string, budget: Json | null, host: Pick<PanelHost, 'previewAction'>, draft: string, close: () => void, idPrefix = 'budget'): HTMLElement {
  const id = (part: string): string => `${idPrefix}-${part}`;
  const box = h('section', { class: 'budget-editor', id: id('editor'), 'aria-label': `Budget ceiling of ${full}` });
  const cancel = h('button', { type: 'button', class: 'btn btn-ghost', text: budget ? 'Cancel' : 'Close', 'aria-label': budget ? 'Cancel the budget change' : 'Close the budget panel', 'data-keep': 'budget-cancel' });
  cancel.addEventListener('click', close);
  box.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      close();
    }
  });
  if (!budget) {
    box.append(h('p', { class: 'muted', text: `${full.charAt(0).toUpperCase()}${full.slice(1)} has no budget envelope yet. A ceiling can only be set on an existing envelope, so nothing can be changed here.` }), h('div', { class: 'budget-actions' }, cancel));
    return box;
  }
  const currency = String(budget.currency);
  const current = Number(budget.capMoney);
  box.append(h('p', { class: 'budget-now' }, h('span', { text: 'Current ceiling ' }), h('strong', { text: fmtMoneyMicros(current, currency) }), h('span', { class: 'muted', text: ` · spent ${fmtMoneyMicros(Number(budget.spentMoney), currency)} · reserved ${fmtMoneyMicros(Number(budget.reservedMoney ?? 0), currency)}` })));
  const form = h('form', { class: 'budget-form', novalidate: true }) as HTMLFormElement;
  const input = h('input', { id: id('amount'), type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Amount', 'aria-describedby': `${id('hint')} ${id('error')}`, maxlength: 18 }) as HTMLInputElement;
  input.value = draft;
  const error = h('p', { id: id('error'), class: 'budget-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Preview the new ceiling', 'data-keep': 'budget-preview' });
  form.append(
    h('label', { for: id('amount'), class: 'budget-label', text: `New ceiling (${currency})` }),
    h('div', { class: 'budget-row' }, h('span', { class: 'budget-currency', 'aria-hidden': 'true', text: currency }), input),
    h('p', { id: id('hint'), class: 'muted small', text: 'Up to two decimals. Nothing changes until you confirm the preview.' }),
    error,
    h('div', { class: 'budget-actions' }, cancel, submit),
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const micros = budgetCeilingMicros(input.value);
    const refuse = (text: string): void => {
      error.textContent = text;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    };
    if (micros === null) return refuse(`Enter an amount above zero in ${currency}, with at most two decimals.`);
    if (micros === current) return refuse('That is already the current ceiling.');
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    void host.previewAction('BUDGET_CEILING', { budgetId: String(budget.id), capMoney: micros, currency, reasonCode: 'founder.ceiling' }).then((refused) => {
      if (refused !== null && error.isConnected) refuse(refused);
    });
  });
  box.append(form);
  return box;
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

// --- command palette and governed confirmation ---------------------------------------------------

export function renderPalette(root: HTMLElement, host: PanelHost, result: Json | null, busy: boolean): HTMLInputElement {
  root.replaceChildren();
  const form = h('form', { class: 'palette-form', role: 'search' });
  const input = h('input', { type: 'text', class: 'palette-input', placeholder: 'Ask the company: open Laila · what is blocked? · who is working on the Saudi launch?', 'aria-label': 'Founder command', autocomplete: 'off', maxlength: 400, dir: 'auto' }) as HTMLInputElement;
  const go = h('button', { type: 'submit', class: 'btn btn-primary', text: busy ? '…' : 'Go' });
  const close = h('button', { type: 'button', class: 'btn btn-ghost palette-close', 'aria-label': result && result.activation ? 'Close Activate the Company' : 'Close the command panel', title: 'Close (Esc)' }, h('span', { 'aria-hidden': 'true', text: '×' }));
  close.addEventListener('click', () => host.closePalette());
  form.append(input, go, close);
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
    if (result.digital) root.append(renderDigital(result.digital as Json, host));
    if (result.providers) root.append(renderProviders(result.providers as Json, host));
    if (result.activation) root.append(renderActivation(result.activation as Json, host));
  }
  return input;
}

/**
 * C7-D: the Company's digital work in the palette (no new canvas, no Tree of Light change). The Founder sees summaries —
 * what was made, what can be inspected internally, what was reviewed, and the exact external act waiting for a decision
 * — never a file-by-file editor. A Preview opens on its own isolated host (noopener); a decision is the existing
 * governed approval preview the Founder confirms.
 */
function renderDigital(data: Json, host: PanelHost): HTMLElement {
  const section = h('section', { class: 'pilots digital', 'aria-label': 'Digital work' });
  section.append(h('h3', { class: 'section-title', text: 'Digital work' }));
  const projects = (data.projects as Json[]) ?? [];
  if (projects.length === 0) section.append(h('p', { class: 'muted small', text: 'No digital project yet. The Company researches, drafts and previews internally; you decide only what goes out under the QANDEEL name.' }));
  const decisions = (data.decisions as Json[]) ?? [];
  for (const d of decisions) {
    const line = h('p', { class: 'pilot-decisions' }, h('span', { class: 'pill pill-needs_decision', text: 'Your decision' }), ' ', h('span', { text: `${t(PROMOTION_KIND_LABEL, String(d.kind))} → ${String(d.targetCode)}` }), ' ', content('span', String(d.candidateSummary)));
    const decide = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Preview: approve this exact act' });
    decide.addEventListener('click', () => void host.previewAction('APPROVAL_DECIDE', { approvalId: String(d.approvalId), decision: 'APPROVE' }));
    const reject = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Preview: reject' });
    reject.addEventListener('click', () => void host.previewAction('APPROVAL_DECIDE', { approvalId: String(d.approvalId), decision: 'REJECT' }));
    section.append(line, h('div', { class: 'pilot-actions' }, decide, reject));
  }
  const ul = h('ul', { class: 'pilot-list' });
  for (const p of projects) ul.append(h('li', { class: 'pilot' }, content('strong', String(p.title)), ' ', h('span', { class: 'pill', text: t(STATE_LABEL, String(p.state)) }), ' ', h('span', { class: 'muted small', text: `${fmtNumber(Number(p.revisions))} revisions · ${fmtNumber(Number(p.candidates))} candidates` })));
  section.append(ul);
  const project = data.project as Json | undefined;
  if (project) {
    for (const pv of ((project.previews as Json[]) ?? []).slice(0, 3)) {
      if (pv.state !== 'READY') {
        section.append(h('p', { class: 'muted small', text: `A revision cannot be previewed safely yet (${humanize(String(pv.gapCode))}): nothing is built or run on this computer to make it work.` }));
        continue;
      }
      const open = h('button', { type: 'button', class: 'btn btn-quiet', text: 'Open internal preview (not published)' });
      open.addEventListener('click', () => void host.openDigitalPreview(String(pv.id)));
      section.append(h('div', { class: 'pilot-actions' }, open));
    }
    for (const c of (project.candidates as Json[]) ?? []) {
      const dl = h('dl', { class: 'facts', 'aria-label': 'Release candidate' }, h('dt', { text: 'Candidate' }), h('dd', {}, content('span', String(c.summary))));
      for (const pr of (c.promotions as Json[]) ?? []) dl.append(h('dt', { text: t(PROMOTION_KIND_LABEL, String(pr.kind)) }), h('dd', { text: t(PROMOTION_STATE_LABEL, String(pr.state)) }));
      section.append(dl);
    }
    section.append(h('p', { class: 'muted small', text: 'A provider’s confirmation means the exact act happened — not traffic, ranking or market success. Real results arrive only as governed external evidence.' }));
  }
  return section;
}

const NEXT_PILOT_STEP: Readonly<Record<string, string>> = { DRAFT: 'BRIEFING', BRIEFING: 'READY', READY: 'ACTIVE', ACTIVE: 'REVIEWING', REVIEWING: 'COMPLETED' };

/**
 * C7-C: the Founder's Pilots in the palette (no new canvas, no Tree of Light change). Each Pilot shows its mode, state,
 * the exact decision it waits for, its briefing conversation and — when one is open — the advisory readiness checklist,
 * each criterion with its own evidence state (never a score). Every step is a structured preview the Founder confirms.
 */
/**
 * L1-01: the model providers the host can wire — each release-pinned profile with its qualified identity, the latest
 * content-free identity check and whether it is provisioned. Provisioning is a structured preview (the exact deployments,
 * reservation rates and the first bounded cap are shown before the Founder confirms). Nothing here names a key.
 */
function renderProviders(data: Json, host: PanelHost): HTMLElement {
  const section = h('section', { class: 'pilots providers', 'aria-label': 'Model providers' });
  section.append(h('h3', { class: 'section-title', text: 'Model providers' }));
  const profiles = (data.profiles as Json[]) ?? [];
  if (profiles.length === 0) section.append(h('p', { class: 'muted small', text: 'No live provider is wired on this host. Start the surface with --provider deepseek after storing the key in the Windows vault.' }));
  for (const p of profiles) {
    const check = (p.latestCheck as Json | null) ?? null;
    const provisioned = p.provisioned === true;
    const li = h('div', { class: 'pilot' }, h('strong', { text: `${String(p.providerCode)} · ${String(p.modelCode)}` }), ' ', h('span', { class: 'pill', text: provisioned ? 'Provisioned' : 'Not provisioned' }));
    li.append(h('p', { class: 'muted small', text: `Qualified identity: ${String(p.expectedPublicName)}. Latest identity check: ${check ? `${String(check.result)} (${String(check.observedName ?? 'no name')}, ${fmtRelative(String(check.checkedAt))})` : 'none yet (run provider-check on the host)'}.` }));
    // P1-CHAT-INTEL-01: an additive profile (e.g. E3 / E4 for conversation) extends the provisioned provider: no new cap.
    if (p.extendsProvider === true) {
      li.append(h('p', { class: 'muted small', text: `Adds levels ${((p.reasoningClasses as string[]) ?? []).join(', ')} for ${((p.taskClasses as string[]) ?? []).join(', ')} to the provisioned provider. ${p.baseProvisioned === true ? '' : 'Provision the provider first.'}` }));
      if (!provisioned && p.baseProvisioned === true && check && check.result === 'MATCH') {
        const add = h('button', { type: 'button', class: 'btn btn-quiet', text: `Preview: add ${((p.reasoningClasses as string[]) ?? []).join(' / ')} (${String(p.code)})` });
        add.addEventListener('click', () => void host.previewAction('PROVIDER_PROVISION', { profileCode: String(p.code), profileSha256: String(p.sha256) }));
        li.append(add);
      }
      section.append(li);
      continue;
    }
    if (!provisioned && check && check.result === 'MATCH') {
      const form = h('form', { class: 'pilot-create' });
      const cap = h('input', { type: 'number', min: '0.01', step: '0.01', value: '2', 'aria-label': `First Company cap in ${String(p.currency ?? 'USD')}`, required: true }) as HTMLInputElement;
      form.append(h('label', { class: 'muted small', text: `First Company cap (${String(p.currency ?? 'USD')}, hard, no automatic top-up)` }), cap, h('button', { type: 'submit', class: 'btn btn-quiet', text: `Preview: provision ${String(p.code)}` }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const micros = Math.round(Number(cap.value) * 1_000_000);
        if (Number.isSafeInteger(micros) && micros > 0) void host.previewAction('PROVIDER_PROVISION', { profileCode: String(p.code), profileSha256: String(p.sha256), capMoney: micros, capTokens: Math.max(1_000_000, micros * 2) });
      });
      li.append(form);
    }
    section.append(li);
  }
  return section;
}

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
      open.addEventListener('click', () => host.openThread(String(p.briefingThreadId), String(p.briefingEmployeeId ?? '')));
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
const HIDDEN_FIELDS = new Set(['pilotId', 'threadId', 'reasonCode', 'currency', 'approvalId', 'goalId', 'budgetId', 'requestId', 'conflictId', 'employeeId', 'invocationId', 'reservationId', 'jobId', 'findingId', 'attributionId', 'lessonId', 'promotionId', 'workItemId', 'profileSha256', 'identityCheckId',
  // L1-02: identifiers of the activation acts (the summary says what happens; IDs are never shown as codes).
  'positionId', 'subjectEmployeeId', 'enrollmentId', 'attemptId', 'remediationId', 'certificationId', 'packageSha256']);

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
  // P1-UX-BUDGET-DARK-01: a refused confirmation is stated here, in the dialog the Founder is looking at.
  root.dataset.intent = String(preview.intentKind);
  root.append(h('p', { class: 'preview-error', role: 'alert' }), h('div', { class: 'preview-actions' }, cancel, confirm));
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
