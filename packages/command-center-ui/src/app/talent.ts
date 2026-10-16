/**
 * COMPANY-TALENT-01 — the Staff & Training hall: hiring and qualification for EVERY seat, run from the Company's own
 * surface (no code per Employee).
 *
 * Tabs: Requests (staffing requests with their evidence, leaders' proposals, manager evaluations awaiting review, the
 * leadership access policies), Seats (Departments, budgets, seats, Tool needs and readiness, preparing a hire), the
 * Identity studio, the Skills & Academy studio, and People (progress, cost, certification scope, identity, retraining).
 * A seat opens its own durable case — the same governed path the CEO's activation uses, for any seat.
 *
 * Drafting a definition is Company content (saved with the Founder session, granting nothing). Every decision — approve
 * a definition, open a seat, a Department budget, a hire, a policy, a Tool grant, retraining, an evaluation — is a
 * structured preview the Founder confirms in the existing confirmation dialog. Nothing here holds state a refresh loses
 * except the open editor's unsaved text.
 */
import { dirOf, fmtMoneyMicros, hasArabic, humanize } from '../model/format.js';
import { renderActivation } from './activation.js';
import { api, ApiError } from './api.js';
import { h, type PanelHost } from './panels.js';

type Json = Record<string, unknown>;

export type TalentTab = 'requests' | 'seats' | 'identities' | 'programs' | 'people';

export interface TalentEditor {
  readonly kind: 'IDENTITY_PROFILE' | 'ACADEMY_PROGRAM';
  definitionId: string | null;
  rowVersion: number | null;
  code: string;
  body: Json;
  gaps: readonly { field: string; reason: string }[];
}

export interface TalentState {
  tab: TalentTab;
  /** A seat whose case (hire → Academy → activation) is open. */
  seatCase: string | null;
  seatCaseData: Json | null;
  editor: TalentEditor | null;
}

export interface TalentHost {
  readonly panel: PanelHost;
  closeHall(): void;
  deptNameOf(id: string): string;
  note(text: string, kind: 'semantic' | 'system'): void;
  /** Re-reads the studio (and an open seat case) and renders again. */
  reload(): void;
}

const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const content = (tag: string, text: string, cls = ''): HTMLElement => {
  const e = h(tag, { class: `${cls} content ${hasArabic(text) ? 'is-arabic' : ''}`.trim(), text });
  e.dir = dirOf(text);
  if (hasArabic(text)) e.lang = 'ar';
  return e;
};
const pill = (text: string, cls = ''): HTMLElement => h('span', { class: `pill ${cls}`.trim(), text });
const btn = (text: string, onClick: () => void, primary = false): HTMLElement => {
  const b = h('button', { type: 'button', class: primary ? 'btn btn-primary' : 'btn btn-quiet', text });
  b.addEventListener('click', onClick);
  return b;
};
const field = (label: string, control: HTMLElement, hint = ''): HTMLElement => h('label', { class: 'talent-field' }, h('span', { class: 'talent-label', text: label }), control, hint ? h('span', { class: 'muted small', text: hint }) : null);
const input = (value: string, attrs: Record<string, string | number | boolean> = {}): HTMLInputElement => {
  const i = h('input', { type: 'text', dir: 'auto', ...attrs }) as HTMLInputElement;
  i.value = value;
  return i;
};
const area = (value: string, rows = 3, attrs: Record<string, string | number | boolean> = {}): HTMLTextAreaElement => {
  const t = h('textarea', { rows: String(rows), dir: 'auto', ...attrs }) as HTMLTextAreaElement;
  t.value = value;
  return t;
};
const select = (options: readonly (readonly [string, string])[], value: string, label: string): HTMLSelectElement => {
  const s = h('select', { 'aria-label': label }) as HTMLSelectElement;
  for (const [v, text] of options) s.append(h('option', { value: v, text }));
  s.value = value;
  return s;
};
const lines = (v: unknown): string => (Array.isArray(v) ? (v as unknown[]).map(str).join('\n') : '');
const fromLines = (s: string): string[] => s.split('\n').map((x) => x.trim()).filter((x) => x.length > 0);
const money = (m: unknown, c: unknown = 'USD'): string => fmtMoneyMicros(Number(m ?? 0), str(c) || 'USD');
const toMicros = (v: string): number => Math.round(Number(v) * 1_000_000);

async function preview(host: TalentHost, intent: string, payload: Json): Promise<void> {
  const refused = await host.panel.previewAction(intent, payload);
  if (refused) host.note(refused, 'system');
}

const TABS: readonly (readonly [TalentTab, string])[] = [
  ['requests', 'Requests & decisions'],
  ['seats', 'Seats & hiring'],
  ['identities', 'Identity studio'],
  ['programs', 'Skills & Academy studio'],
  ['people', 'People & progress'],
];

function head(host: TalentHost): HTMLElement {
  const close = h('button', { type: 'button', class: 'btn btn-ghost hall-close', 'aria-label': 'Close Staff & Training', title: 'Close (Esc)', 'data-keep': 'close' }, h('span', { 'aria-hidden': 'true', text: '×' }));
  close.addEventListener('click', () => host.closeHall());
  return h('header', { class: 'hall-head' }, h('span', { class: 'hall-mark hall-mark-academy', 'aria-hidden': 'true' }), h('div', { class: 'hall-titles' }, h('h2', { id: 'hall-title', class: 'hall-title', text: 'Staff & Training' }), h('p', { class: 'hall-sub' }, h('span', { text: 'Hiring, identities, skills and the Academy for every seat. Every decision is a preview you confirm. ' }), h('span', { dir: 'rtl', lang: 'ar', text: 'الموظفون والتأهيل' }))), close);
}

export function renderTalent(root: HTMLElement, data: Json | null, host: TalentHost, state: TalentState, error: string | null): void {
  root.replaceChildren();
  root.dataset.hall = 'talent';
  root.append(head(host));
  const body = h('div', { class: 'hall-body talent' });
  root.append(body);
  if (error !== null) {
    body.append(h('p', { class: 'empty', text: `Staff & Training could not be read (${error}). Nothing was changed.` }));
    return;
  }
  if (data === null) {
    body.append(h('p', { class: 'muted', text: 'Reading Staff & Training…' }));
    return;
  }
  const o = (data.overview as Json) ?? {};
  const nav = h('nav', { class: 'talent-tabs', role: 'tablist', 'aria-label': 'Staff & Training sections' });
  for (const [tab, label] of TABS) {
    const b = h('button', { type: 'button', role: 'tab', class: `btn btn-quiet talent-tab${state.tab === tab && !state.seatCase ? ' is-current' : ''}`, 'aria-selected': state.tab === tab && !state.seatCase ? 'true' : 'false', text: label, 'data-keep': `talent-tab:${tab}` });
    b.addEventListener('click', () => {
      state.tab = tab;
      state.seatCase = null;
      state.seatCaseData = null;
      host.reload();
    });
    nav.append(b);
  }
  body.append(nav);
  if (state.seatCase !== null) {
    body.append(seatCase(host, state, o));
    return;
  }
  if (state.editor !== null) {
    body.append(state.editor.kind === 'IDENTITY_PROFILE' ? identityEditor(host, state) : programEditor(host, state, data));
    return;
  }
  const views: Record<TalentTab, (host: TalentHost, state: TalentState, o: Json, data: Json) => HTMLElement> = { requests, seats, identities, programs, people };
  const view = views[state.tab];
  body.append(view(host, state, o, data));
}

// --- Requests & decisions -------------------------------------------------------------------------------------------

function requests(host: TalentHost, _state: TalentState, o: Json): HTMLElement {
  const box = h('div', { class: 'talent-pane' });
  const staffing = arr(o.staffing);
  const open = staffing.filter((r) => !['APPROVED', 'REJECTED', 'WITHDRAWN', 'CONSOLIDATED'].includes(str(r.state)));
  const sec = (title: string, ...children: (Node | null)[]): HTMLElement => h('section', { class: 'hall-section' }, h('h3', { text: title }), ...children);
  const reqList = h('ul', { class: 'plain hall-list' });
  if (open.length === 0) reqList.append(h('li', { class: 'empty', text: 'No open staffing request. A Director or the CEO files one from its own work; you can also open a seat directly in Seats & hiring.' }));
  for (const r of open) {
    const ev = (r.evidence as Json) ?? {};
    const alt = (ev.alternatives as Json) ?? {};
    const li = h('li', { class: 'talent-card' }, h('strong', { text: `${str(r.positionTitle)} · ${humanize(str(r.positionKind))}` }), ' ', pill(humanize(str(r.state))), ' ', h('span', { class: 'muted small', text: `${str(r.roleRef)} · ${r.departmentId ? host.deptNameOf(str(r.departmentId)) : 'Company'} · ${Number(r.headcount) > 1 ? `${str(r.headcount)} identical seats · ` : ''}requested by ${str(r.requestedBy)}${r.ceoRecommendation ? ` · CEO recommends ${str(r.ceoRecommendation).toLowerCase()}` : ''}` }));
    const d = h('details', { class: 'talent-evidence' }, h('summary', { text: 'Evidence' }));
    for (const [k, label] of [['businessNeed', 'Business need'], ['workloadEvidence', 'Workload evidence'], ['skillGap', 'Skill gap'], ['expectedValue', 'Expected value'], ['impactIfNotStaffed', 'Impact if not staffed']] as const) d.append(h('p', { class: 'small' }, h('strong', { text: `${label}: ` }), content('span', str(ev[k]))));
    for (const [k, v] of Object.entries(alt)) d.append(h('p', { class: 'small muted' }, h('strong', { text: `${humanize(k)}: ` }), content('span', str(v))));
    if (ev.expectedCostMicros !== null && ev.expectedCostMicros !== undefined) d.append(h('p', { class: 'small', text: `Expected cost: ${money(ev.expectedCostMicros)}` }));
    if (r.ceoNote) d.append(h('p', { class: 'small' }, h('strong', { text: 'CEO note: ' }), content('span', str(r.ceoNote))));
    li.append(d);
    if (r.founderDecidable === true) li.append(h('div', { class: 'pilot-actions' }, btn('Preview: approve', () => void preview(host, 'STAFFING_DECIDE', { requestId: str(r.id), decision: 'APPROVE' }), true), btn('Preview: reject', () => void preview(host, 'STAFFING_DECIDE', { requestId: str(r.id), decision: 'REJECT' }))));
    else li.append(h('p', { class: 'muted small', text: 'Waiting for the CEO\'s review (you decide once it is recommended, or directly while no active CEO holds the seat).' }));
    reqList.append(li);
  }
  box.append(sec('Staffing requests', reqList));

  const proposals = arr(o.proposals).filter((p) => p.state === 'PROPOSED');
  const pList = h('ul', { class: 'plain hall-list' });
  if (proposals.length === 0) pList.append(h('li', { class: 'empty', text: 'No open proposal. Leaders propose identities, programs, Skills, retraining and Department budgets from their own work; a proposal decides nothing.' }));
  for (const p of proposals) {
    const payload = (p.payload as Json) ?? {};
    const li = h('li', { class: 'talent-card' }, h('strong', { text: `${humanize(str(p.kind))} · from ${str(p.proposer)}` }), ' ', h('span', { class: 'muted small', text: `${str(p.roleRef)}${p.departmentId ? ` · ${host.deptNameOf(str(p.departmentId))}` : ''}` }), content('p', str(p.rationale), 'small'));
    if (p.kind === 'DEPARTMENT_BUDGET') li.append(h('p', { class: 'small', text: `Proposed Department cap: ${money(payload.capMoney)}` }));
    if (p.kind === 'SKILL') li.append(h('p', { class: 'small', text: `Proposed Skill: ${str((payload.skill as Json | undefined)?.name ?? (payload.skill as Json | undefined)?.code)}` }));
    if (p.definitionId) li.append(h('p', { class: 'muted small', text: 'Its draft is in the studio: edit, then approve it there.' }));
    li.append(h('div', { class: 'pilot-actions' }, btn('Preview: accept', () => void preview(host, 'TALENT_PROPOSAL_DECIDE', { proposalId: str(p.id), decision: 'ACCEPT' }), true), btn('Preview: decline', () => void preview(host, 'TALENT_PROPOSAL_DECIDE', { proposalId: str(p.id), decision: 'DECLINE' }))));
    pList.append(li);
  }
  box.append(sec('Leaders\' proposals', pList));

  const evals = arr(o.evaluations).filter((m) => m.state === 'PROPOSED' && m.reviewRequired === true);
  const eList = h('ul', { class: 'plain hall-list' });
  if (evals.length === 0) eList.append(h('li', { class: 'empty', text: 'No manager evaluation waits for an independent review.' }));
  for (const m of evals) {
    const scores = (m.scores as Json) ?? {};
    const all = { ...((scores.dimensions as Json) ?? {}), ...((scores.competencies as Json) ?? {}) };
    eList.append(h('li', { class: 'talent-card' }, h('strong', { text: `Assessment evaluation by ${host.panel.nameOf(`employee:${str(m.evaluatorEmployeeId)}`)} of ${host.panel.nameOf(`employee:${str(m.traineeEmployeeId)}`)}` }), h('p', { class: 'muted small', text: Object.entries(all).map(([k, v]) => `${humanize(k)} ${str(v)}`).join(' · ') }), h('div', { class: 'pilot-actions' }, btn('Preview: confirm (scores count)', () => void preview(host, 'ACADEMY_EVALUATION_REVIEW', { evaluationId: str(m.id), decision: 'CONFIRM' }), true), btn('Preview: reject', () => void preview(host, 'ACADEMY_EVALUATION_REVIEW', { evaluationId: str(m.id), decision: 'REJECT' })))));
  }
  box.append(sec('Manager evaluations awaiting review', eList));

  const polList = h('ul', { class: 'plain hall-list' });
  for (const p of arr(o.policies)) {
    const li = h('li', { class: 'talent-card' }, h('strong', { text: str(p.title) }), ' ', pill(p.state === 'ACTIVE' ? `In force · ${str(p.activeGrants)} grant(s)` : 'Not approved', p.state === 'ACTIVE' ? 'pill-ok' : ''), h('p', { class: 'muted small', text: `${arr(p.grants).map((g) => `${str(g.capability)} (${str(g.risk)}; ${arr(g.seats).map(str).join(', ')})`).join(' · ')}. Eligibility: a PRIMARY CEO / Director seat; issued at the hire, revoked on leaving the seat, SUSPENDED or RETIRED. A title alone grants nothing.` }));
    if (p.state === 'ACTIVE') li.append(h('div', { class: 'pilot-actions' }, btn('Preview: revoke the policy', () => void preview(host, 'ACCESS_POLICY_DECIDE', { policyCode: str(p.code), decision: 'REVOKE' }))));
    else if (p.source === 'COMPANY') {
      const repo = input('', { placeholder: 'github:<owner>/<repository>', 'aria-label': 'Company documents repository' });
      const form = h('form', { class: 'pilot-create' }, field('Company documents source (first time only)', repo), h('button', { type: 'submit', class: 'btn btn-quiet', text: 'Preview: approve the policy' }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        void preview(host, 'ACCESS_POLICY_DECIDE', { policyCode: str(p.code), decision: 'APPROVE', ...(repo.value.trim() ? { repository: repo.value.trim() } : {}) });
      });
      li.append(form);
    } else li.append(h('div', { class: 'pilot-actions' }, btn('Preview: approve the policy', () => void preview(host, 'ACCESS_POLICY_DECIDE', { policyCode: str(p.code), decision: 'APPROVE' }), true)));
    polList.append(li);
  }
  box.append(sec('Leadership access policies', polList));
  return box;
}

// --- Seats & hiring ---------------------------------------------------------------------------------------------------

function seats(host: TalentHost, state: TalentState, o: Json): HTMLElement {
  const box = h('div', { class: 'talent-pane' });
  const company = o.company as Json | null;
  box.append(h('p', { class: 'muted small', text: company ? `Company cap ${money(company.capMoney, company.currency)} · spent ${money(company.spentMoney, company.currency)}` : 'No Company budget yet (provision the provider first).' }));
  const allSeats = arr(o.seats);
  const reqs = arr(o.roleToolRequirements);
  const company0 = allSeats.filter((s) => s.departmentId === null);
  const group = (title: string, deptId: string | null, list: Json[], budget: Json | null): HTMLElement => {
    const sec = h('section', { class: 'hall-section' }, h('h3', { text: title }));
    if (deptId !== null) {
      if (budget) sec.append(h('p', { class: 'muted small', text: `Department budget ${money(budget.capMoney, budget.currency)} · spent ${money(budget.spentMoney, budget.currency)} · reserved ${money(budget.reservedMoney, budget.currency)}` }), h('div', { class: 'pilot-actions' }, btn('Preview: change the Department ceiling', () => {
        const v = window.prompt('New Department ceiling (USD)', String(Number(budget.capMoney) / 1_000_000));
        if (v !== null && Number(v) > 0) void preview(host, 'BUDGET_CEILING', { budgetId: str(budget.id), capMoney: toMicros(v) });
      })));
      else {
        const cap = input('1', { type: 'number', min: '0.01', step: '0.01', 'aria-label': 'Department cap in USD' });
        const form = h('form', { class: 'pilot-create' }, field('No Department budget yet: its Employees cannot receive an envelope. Cap (USD, hard, within the Company cap)', cap), h('button', { type: 'submit', class: 'btn btn-quiet', text: 'Preview: create the Department budget' }));
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          void preview(host, 'DEPARTMENT_BUDGET', { departmentId: deptId, capMoney: toMicros(cap.value) });
        });
        sec.append(form);
      }
    }
    const ul = h('ul', { class: 'plain hall-list' });
    for (const s of list) {
      const holder = s.holder as Json | null;
      const needs = reqs.filter((r) => r.roleRef === s.roleRef);
      const li = h('li', { class: 'talent-card' }, h('strong', { text: str(s.title) }), ' ', pill(humanize(str(s.kind))), ' ', holder ? pill(`${str(holder.name)} · ${humanize(str(holder.state))}`, 'pill-ok') : pill('Vacant', 'pill-needs_decision'), h('span', { class: 'muted small', text: ` ${str(s.roleRef)}${s.staffingRequestId ? ' · from an approved staffing request' : ''}` }));
      for (const r of needs) li.append(h('p', { class: 'small' }, h('span', { text: `Needs tool ${str(r.toolCode)} (${str(r.purpose)}): ` }), pill(humanize(str((r.readiness as Json).readiness)), (r.readiness as Json).readiness === 'READY' ? 'pill-ok' : 'pill-needs_decision')));
      li.append(h('div', { class: 'pilot-actions' }, btn(holder ? 'Open the seat case (training → activation)' : 'Prepare the hire', () => {
        state.seatCase = str(s.positionId);
        state.seatCaseData = null;
        host.reload();
      }, !holder)));
      ul.append(li);
    }
    if (list.length === 0) ul.append(h('li', { class: 'empty', text: 'No seat yet.' }));
    sec.append(ul);
    if (deptId !== null) {
      const role = input('', { placeholder: 'role:growth.reddit-specialist', 'aria-label': 'Role' });
      const title2 = input('', { placeholder: 'Seat title', 'aria-label': 'Seat title' });
      const kind = select([['SPECIALIST', 'Specialist'], ['LEAD', 'Lead'], ['MANAGER', 'Manager']], 'SPECIALIST', 'Seat kind');
      const form = h('form', { class: 'pilot-create talent-inline' }, field('Open a seat directly (your decision; vacant until a hire)', h('span', {}, role, title2, kind)), h('button', { type: 'submit', class: 'btn btn-quiet', text: 'Preview: open the seat' }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        void preview(host, 'POSITION_CREATE', { departmentId: deptId, roleRef: role.value.trim(), title: title2.value.trim(), kind: kind.value });
      });
      sec.append(form);
    }
    return sec;
  };
  box.append(group('Company leadership', null, company0, null));
  for (const d of arr(o.departments)) box.append(group(str(d.name), str(d.id), allSeats.filter((s) => s.departmentId === d.id), (d.budget as Json | null) ?? null));
  // Tool needs of a role (metadata) and the honest readiness of every registered Tool.
  const tools = h('section', { class: 'hall-section' }, h('h3', { text: 'Tools a role needs' }), h('p', { class: 'muted small', text: 'A Skill is not a Tool: a certification never claims operating a Tool that was not integrated and assessed. A missing adapter shows as Not registered / Not integrated.' }));
  for (const t of arr(o.tools)) tools.append(h('p', { class: 'small' }, h('strong', { text: `${str(t.toolCode)}: ` }), pill(humanize(str(t.readiness)), t.readiness === 'READY' ? 'pill-ok' : '')));
  const role = input('', { placeholder: 'role:brand.video-editor', 'aria-label': 'Role' });
  const tool = input('', { placeholder: 'video-editor', 'aria-label': 'Tool code' });
  const purpose = input('', { placeholder: 'What the role uses it for', 'aria-label': 'Purpose' });
  const form = h('form', { class: 'pilot-create talent-inline' }, field('Record a Tool a role needs', h('span', {}, role, tool, purpose)), h('button', { type: 'submit', class: 'btn btn-quiet', text: 'Preview: record the need' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void preview(host, 'ROLE_TOOL_REQUIREMENT', { roleRef: role.value.trim(), toolCode: tool.value.trim(), purpose: purpose.value.trim(), decision: 'ADD' });
  });
  tools.append(form);
  box.append(tools);
  return box;
}

function seatCase(host: TalentHost, state: TalentState, o: Json): HTMLElement {
  const box = h('div', { class: 'talent-pane' });
  box.append(h('div', { class: 'pilot-actions' }, btn('← Back to the seats', () => {
    state.seatCase = null;
    state.seatCaseData = null;
    host.reload();
  })));
  const data = state.seatCaseData;
  if (data === null) {
    box.append(h('p', { class: 'muted', text: 'Reading the seat…' }));
    return box;
  }
  const seat = ((data.view as Json)?.seat as Json | null) ?? null;
  const approved = arr(o.definitions).filter((d) => d.kind === 'IDENTITY_PROFILE' && d.state === 'APPROVED' && d.roleRef === seat?.roleRef);
  box.append(renderActivation({ ...data, catalogIdentities: approved }, host.panel));
  return box;
}

// --- Identity studio --------------------------------------------------------------------------------------------------

function identities(host: TalentHost, state: TalentState, o: Json): HTMLElement {
  const box = h('div', { class: 'talent-pane' });
  const roles = [...new Set(arr(o.seats).map((s) => str(s.roleRef)))].sort();
  const role = select(roles.map((r) => [r, r] as const), roles[0] ?? '', 'Role');
  const roleFree = input('', { placeholder: 'or another role:<code>', 'aria-label': 'Other role' });
  const code = input('', { placeholder: 'profile code, e.g. majed-el-kedwany', 'aria-label': 'Profile code' });
  const form = h('form', { class: 'pilot-create talent-inline' }, field('New identity profile', h('span', {}, role, roleFree, code)), h('button', { type: 'submit', class: 'btn btn-primary', text: 'Start a draft' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = roleFree.value.trim() || role.value;
    void api.get<{ body: Json }>(`/api/talent/template?kind=IDENTITY_PROFILE&roleRef=${encodeURIComponent(r)}`).then((t) => {
      state.editor = { kind: 'IDENTITY_PROFILE', definitionId: null, rowVersion: null, code: code.value.trim(), body: t.body, gaps: [] };
      host.reload();
    }).catch((err: unknown) => host.note(`No template (${err instanceof ApiError ? err.code : 'error'})`, 'system'));
  });
  box.append(form);
  box.append(definitionList(host, state, arr(o.definitions).filter((d) => d.kind === 'IDENTITY_PROFILE')));
  return box;
}

function definitionList(host: TalentHost, state: TalentState, defs: Json[]): HTMLElement {
  const ul = h('ul', { class: 'plain hall-list' });
  if (defs.length === 0) ul.append(h('li', { class: 'empty', text: 'Nothing here yet.' }));
  for (const d of defs) {
    const li = h('li', { class: 'talent-card' }, h('strong', { text: `${str(d.title)} — ${str(d.code)} v${str(d.version)}` }), ' ', pill(humanize(str(d.state)), d.state === 'APPROVED' ? 'pill-ok' : d.state === 'DRAFT' || d.state === 'SUBMITTED' ? 'pill-needs_decision' : ''), h('span', { class: 'muted small', text: ` ${str(d.roleRef)}${(d.author as Json)?.kind === 'EMPLOYEE' ? ' · proposed by a leader' : ''}${d.sha256 ? ` · digest ${str(d.sha256).slice(0, 12)}…` : ''}${d.kind === 'ACADEMY_PROGRAM' ? ` · ${str(d.skills)} skills · ${str(d.scenarios)} scenarios (${str(d.holdouts)} hidden) · ${str(d.competencies)} competencies${Number(d.toolScenarios) > 0 ? ` · ${str(d.toolScenarios)} tool scenario(s)` : ''}` : ''}` }));
    const actions = h('div', { class: 'pilot-actions' });
    if (d.state === 'DRAFT' || d.state === 'SUBMITTED' || d.state === 'APPROVED') actions.append(btn(d.state === 'DRAFT' ? 'Open the draft' : 'View', () => void openDefinition(host, state, str(d.id))));
    if (d.state === 'DRAFT' || d.state === 'SUBMITTED') actions.append(btn('Preview: approve', () => void preview(host, 'TALENT_DEFINITION_DECIDE', { definitionId: str(d.id), decision: 'APPROVE' }), true));
    if (d.state === 'SUBMITTED') actions.append(btn('Preview: reject', () => void preview(host, 'TALENT_DEFINITION_DECIDE', { definitionId: str(d.id), decision: 'REJECT' })));
    if (d.state === 'APPROVED' && d.kind === 'ACADEMY_PROGRAM') actions.append(btn('New version from this', () => void openDefinition(host, state, str(d.id), true)));
    li.append(actions);
    ul.append(li);
  }
  return ul;
}

async function openDefinition(host: TalentHost, state: TalentState, id: string, asNewVersion = false): Promise<void> {
  try {
    const r = await api.get<{ definition: Json & { body: Json }; check: { gaps: { field: string; reason: string }[] } }>(`/api/talent/definitions/${id}`);
    const d = r.definition;
    const editable = d.state === 'DRAFT' && !asNewVersion;
    const body = asNewVersion ? { ...d.body, version: Number(d.version) + 1, skills: arr(d.body.skills).map((s) => ({ ...s, versionLabel: `${str(s.versionLabel)}.v${Number(d.version) + 1}` })) } : d.body;
    state.editor = { kind: d.kind as TalentEditor['kind'], definitionId: editable ? id : null, rowVersion: editable ? Number(d.rowVersion) : null, code: str(d.code), body, gaps: r.check.gaps };
    host.reload();
  } catch (e) {
    host.note(`The definition could not be read (${e instanceof ApiError ? e.code : 'error'})`, 'system');
  }
}

async function saveDraft(host: TalentHost, state: TalentState, submit: boolean): Promise<void> {
  const ed = state.editor;
  if (!ed) return;
  try {
    const r = await api.post<{ definition: Json; check: { ok: boolean; gaps: { field: string; reason: string }[] } }>('/api/talent/drafts', { kind: ed.kind, body: ed.body, ...(ed.definitionId ? { definitionId: ed.definitionId, expectedRowVersion: ed.rowVersion } : { code: ed.code }) });
    ed.definitionId = str(r.definition.id);
    ed.rowVersion = Number(r.definition.rowVersion);
    ed.gaps = r.check.gaps;
    host.note(r.check.ok ? 'Draft saved: complete, ready to approve.' : `Draft saved: ${r.check.gaps.length} item(s) still missing.`, 'system');
    if (submit && r.check.ok) await preview(host, 'TALENT_DEFINITION_DECIDE', { definitionId: ed.definitionId, decision: 'APPROVE' });
    host.reload();
  } catch (e) {
    host.note(`Not saved (${e instanceof ApiError ? `${e.code}${typeof e.details.reason === 'string' ? `: ${humanize(e.details.reason)}` : ''}` : 'error'}). Nothing changed.`, 'system');
  }
}

function editorFoot(host: TalentHost, state: TalentState): HTMLElement {
  const ed = state.editor as TalentEditor;
  const gaps = h('ul', { class: 'plain talent-gaps' });
  for (const g of ed.gaps) gaps.append(h('li', { class: 'small', text: `Missing: ${g.field} — ${humanize(g.reason)}` }));
  return h('div', { class: 'talent-foot' }, ed.gaps.length > 0 ? gaps : null, h('div', { class: 'pilot-actions' }, btn('Save draft', () => void saveDraft(host, state, false)), btn('Save and preview approval', () => void saveDraft(host, state, true), true), btn('Close the editor', () => {
    state.editor = null;
    host.reload();
  })), h('p', { class: 'muted small', text: 'A draft is Company content: it grants, spends and calls nothing. Approval freezes it by its digest; every use (a hire, a qualification, an enrollment) is its own confirmation.' }));
}

function identityEditor(host: TalentHost, state: TalentState): HTMLElement {
  const ed = state.editor as TalentEditor;
  const b = ed.body;
  const box = h('form', { class: 'talent-pane talent-editor' });
  box.addEventListener('submit', (e) => e.preventDefault());
  box.append(h('h3', { text: `Identity profile ${ed.code || '(new)'} · ${str(b.roleRef)}` }));
  if (!ed.definitionId) {
    const code = input(ed.code, { placeholder: 'profile code', 'aria-label': 'Profile code' });
    code.addEventListener('input', () => (ed.code = code.value.trim()));
    box.append(field('Profile code (one person; e.g. majed-el-kedwany)', code));
  }
  const name = (b.name as Json | null) ?? null;
  const given = input(str(name?.given), { placeholder: 'Given name (Latin)' });
  const family = input(str(name?.family), { placeholder: 'Family name (Latin)' });
  const ar = input(str(name?.ar), { placeholder: 'الاسم بالعربية' });
  const setName = (): void => {
    b.name = given.value.trim() && family.value.trim() ? { given: given.value.trim(), family: family.value.trim(), ar: ar.value.trim() || null } : null;
  };
  for (const i of [given, family, ar]) i.addEventListener('input', setName);
  box.append(field('Proposed name (presentation; the hire states the final name)', h('span', { class: 'talent-row' }, given, family, ar)));
  const text = (key: string, label: string, rows = 2, hint = ''): void => {
    const t = area(str(b[key]), rows);
    t.addEventListener('input', () => (b[key] = t.value));
    box.append(field(label, t, hint));
  };
  const list = (key: string, label: string, hint = 'one per line'): void => {
    const t = area(lines(b[key]), 3);
    t.addEventListener('input', () => (b[key] = fromLines(t.value)));
    box.append(field(label, t, hint));
  };
  text('title', 'Title / professional headline', 1);
  text('roleSummary', 'Role summary (identity and mission)', 3);
  list('personality', 'Personality traits', '2 to 8, one per line');
  text('professionalStyle', 'Professional style', 3);
  text('communicationStyle', 'Communication style', 3);
  list('specialties', 'Specialties');
  list('marketExpertise', 'Market and domain expertise');
  text('workBehaviour', 'How it works (work behaviour)', 3);
  list('qualityStandards', 'Quality standards');
  list('boundaries', 'What it never does');
  const bg = area(str(b.designedBackground), 4);
  bg.addEventListener('input', () => (b.designedBackground = bg.value.trim() ? bg.value : null));
  box.append(field('Designed professional background (optional)', bg, 'Shown as designed, never as real QANDEEL history or achievements (Stage 4 §3).'));
  const src = input(str(b.sourceRef), { placeholder: 'doc:docs/talent/<file>.md' });
  src.addEventListener('input', () => (b.sourceRef = src.value.trim()));
  box.append(field('Source (the approved specification)', src));
  box.append(editorFoot(host, state));
  return box;
}

// --- Skills & Academy studio ------------------------------------------------------------------------------------------

function programs(host: TalentHost, state: TalentState, o: Json): HTMLElement {
  const box = h('div', { class: 'talent-pane' });
  const roles = [...new Set(arr(o.seats).map((s) => str(s.roleRef)))].sort();
  const role = select(roles.map((r) => [r, r] as const), roles[0] ?? '', 'Role');
  const roleFree = input('', { placeholder: 'or another role:<code>', 'aria-label': 'Other role' });
  const code = input('', { placeholder: 'program code, e.g. growth.reddit-specialist', 'aria-label': 'Program code' });
  const title = input('', { placeholder: 'Program title', 'aria-label': 'Program title' });
  const form = h('form', { class: 'pilot-create talent-inline' }, field('New Academy program (Skills, scenarios, hidden holdouts, competencies)', h('span', {}, role, roleFree, code, title)), h('button', { type: 'submit', class: 'btn btn-primary', text: 'Start from the template' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = roleFree.value.trim() || role.value;
    void api.get<{ body: Json }>(`/api/talent/template?kind=ACADEMY_PROGRAM&roleRef=${encodeURIComponent(r)}&code=${encodeURIComponent(code.value.trim())}&title=${encodeURIComponent(title.value.trim())}`).then((t) => {
      state.editor = { kind: 'ACADEMY_PROGRAM', definitionId: null, rowVersion: null, code: str(t.body.code), body: t.body, gaps: [] };
      host.reload();
    }).catch((err: unknown) => host.note(`No template (${err instanceof ApiError ? err.code : 'error'})`, 'system'));
  });
  box.append(form);
  box.append(h('p', { class: 'muted small', text: 'An approved program is qualified (BQM-2: each Skill with vs without, 5 observations), installed, and then any number of Employees of that role enroll — from the seat case. Only clearly free sources may be adapted; no paid Skill Packs.' }));
  box.append(definitionList(host, state, arr(o.definitions).filter((d) => d.kind === 'ACADEMY_PROGRAM')));
  return box;
}

function programEditor(host: TalentHost, state: TalentState, data: Json): HTMLElement {
  const ed = state.editor as TalentEditor;
  const b = ed.body;
  const program = (b.program as Json) ?? {};
  b.program = program;
  const box = h('form', { class: 'talent-pane talent-editor' });
  box.addEventListener('submit', (e) => e.preventDefault());
  box.append(h('h3', { text: `Academy program ${str(b.code)} v${str(b.version)} · ${str(b.roleRef)}` }));
  const t = input(str(b.title));
  t.addEventListener('input', () => (b.title = t.value));
  box.append(field('Title', t));
  const cal = h('input', { type: 'checkbox' }) as HTMLInputElement;
  cal.checked = program.founderCalibrationRequired === true;
  cal.addEventListener('change', () => (program.founderCalibrationRequired = cal.checked));
  box.append(field('Founder Calibration required (mandatory for the CEO and every Director)', cal));

  // Skills
  const skills = arr(b.skills);
  b.skills = skills;
  const sSec = h('section', { class: 'hall-section' }, h('h4', { text: `Skills (${skills.length}/16)` }));
  const syncTargets = (): void => {
    program.skillTargets = skills.map((s) => ({ skillCode: str(s.code), proficiency: str(s.targetProficiency) || 'QUALIFIED' }));
  };
  skills.forEach((s, i) => {
    const row = h('fieldset', { class: 'talent-item' }, h('legend', { text: `Skill ${i + 1}: ${str(s.name) || str(s.code)}` }));
    const bind = (key: string, el: HTMLInputElement | HTMLTextAreaElement, f: (v: string) => unknown = (v) => v): void => {
      el.addEventListener('input', () => {
        s[key] = f(el.value);
        if (key === 'code') syncTargets();
      });
    };
    const c = input(str(s.code));
    bind('code', c);
    const n = input(str(s.name));
    bind('name', n);
    const v = input(str(s.versionLabel));
    bind('versionLabel', v);
    const ins = area(str(s.instructions), 6);
    bind('instructions', ins);
    const refs = input(arr(s.sourceRefs).map(str).join(', '));
    bind('sourceRefs', refs, (x) => x.split(',').map((y) => y.trim()).filter(Boolean));
    const prov = (s.provenance as Json | undefined) ?? null;
    const origin = select([['QANDEEL_ORIGINAL', 'QANDEEL original'], ['ADAPTED_FREE_SOURCE', 'Adapted from clearly free sources']], str(prov?.origin) || 'QANDEEL_ORIGINAL', 'Provenance');
    const sources = input(arr(prov?.sources).map((x) => `${str(x.ref)} ${str(x.licenseSpdx)}`).join(', '), { placeholder: 'ref:… MIT, ref:… CC0-1.0' });
    const setProv = (): void => {
      if (origin.value === 'QANDEEL_ORIGINAL' && sources.value.trim() === '') delete s.provenance;
      else s.provenance = { origin: origin.value, sources: sources.value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => ({ ref: x.split(/\s+/)[0] ?? '', licenseSpdx: x.split(/\s+/)[1] ?? '' })) };
    };
    origin.addEventListener('change', setProv);
    sources.addEventListener('input', setProv);
    const crit = h('input', { type: 'checkbox' }) as HTMLInputElement;
    crit.checked = s.critical === true;
    crit.addEventListener('change', () => (s.critical = crit.checked));
    const cases = area(JSON.stringify(s.benchmark ?? [], null, 2), 6, { class: 'mono' });
    cases.addEventListener('change', () => {
      try {
        s.benchmark = JSON.parse(cases.value) as unknown;
      } catch {
        host.note('The benchmark cases are not valid JSON yet.', 'system');
      }
    });
    row.append(h('div', { class: 'talent-row' }, field('Code', c), field('Name', n), field('Version label', v)), field('Professional instructions (what the Employee loads)', ins), field('Knowledge sources (refs)', refs), h('div', { class: 'talent-row' }, field('Provenance', origin), field('Adapted from (ref + SPDX licence)', sources)), field('Critical Skill', crit), field('Benchmark cases (1–4; success criteria as answer expectations)', cases), btn('Remove this Skill', () => {
      skills.splice(i, 1);
      syncTargets();
      host.reload();
    }));
    sSec.append(row);
  });
  sSec.append(btn('Add a Skill', () => {
    const area0 = str(b.code).split('.').at(-1) ?? 'role';
    skills.push({ code: `${str(b.code)}.skill-${skills.length + 1}`, name: '', versionLabel: '1.0.0', instructions: '', blueprintCategory: 'REQUIRED', critical: true, minProficiency: 'QUALIFIED', targetProficiency: 'QUALIFIED', sourceRefs: ['authority:stage-7'], benchmark: [{ code: `${area0}.case-${skills.length + 1}`, content: '', expect: { evidence: ['INSUFFICIENT', 'PARTIAL'], critical: ['evidence'] } }] });
    syncTargets();
    host.reload();
  }));
  box.append(sSec);

  // Scenarios
  const scenarios = arr(b.scenarios);
  b.scenarios = scenarios;
  const scSec = h('section', { class: 'hall-section' }, h('h4', { text: `Scenarios (${scenarios.length}) — practice, assessment and hidden holdouts (holdout text is never shown to the trainee)` }));
  scenarios.forEach((s, i) => {
    const kind = select([['PRACTICE', 'Practice'], ['ASSESSMENT', 'Assessment'], ['HOLDOUT', 'Hidden holdout']], str(s.kind), 'Kind');
    kind.addEventListener('change', () => (s.kind = kind.value));
    const c = input(str(s.code));
    c.addEventListener('input', () => (s.code = c.value));
    const txt = area(str(s.content), 4);
    txt.addEventListener('input', () => (s.content = txt.value));
    const budget = input(String(Number(s.budgetMicros ?? 40_000) / 1_000_000), { type: 'number', step: '0.01', min: '0' });
    budget.addEventListener('input', () => (s.budgetMicros = toMicros(budget.value)));
    const tool = input(str(s.toolCode), { placeholder: 'tool code (only for a Tool scenario)' });
    tool.addEventListener('input', () => {
      if (tool.value.trim()) s.toolCode = tool.value.trim();
      else delete s.toolCode;
    });
    scSec.append(h('fieldset', { class: 'talent-item' }, h('legend', { text: `${humanize(str(s.kind))} ${i + 1}` }), h('div', { class: 'talent-row' }, field('Kind', kind), field('Code', c), field('Cost budget (USD)', budget), field('Tool scenario', tool)), field('Scenario', txt), btn('Remove', () => {
      scenarios.splice(i, 1);
      host.reload();
    })));
  });
  scSec.append(btn('Add a scenario', () => {
    scenarios.push({ code: `${str(b.code)}.scenario-${scenarios.length + 1}`, kind: 'ASSESSMENT', sourceRef: 'scenario:studio', budgetMicros: 40_000, content: '' });
    host.reload();
  }));
  box.append(scSec);

  // Competencies
  const comps = arr(program.competencies);
  const cSec = h('section', { class: 'hall-section' }, h('h4', { text: `Specialty competencies (${comps.length}) — assessed beside the ten dimensions; a critical one below its mark fails the attempt` }));
  const presets = (data.presets as Json) ?? {};
  const preset = select([['', 'Load a preset…'], ...Object.keys(presets).map((k) => [k, humanize(k)] as const)], '', 'Competency preset');
  preset.addEventListener('change', () => {
    if (!preset.value) return;
    program.competencies = arr(presets[preset.value]).map((x) => ({ ...x }));
    host.reload();
  });
  cSec.append(preset);
  const compText = area(JSON.stringify(comps, null, 2), 8, { class: 'mono' });
  compText.addEventListener('change', () => {
    try {
      const v = JSON.parse(compText.value) as unknown;
      if (Array.isArray(v) && v.length === 0) delete program.competencies;
      else program.competencies = v;
    } catch {
      host.note('The competencies are not valid JSON yet.', 'system');
    }
  });
  cSec.append(compText);
  box.append(cSec);

  // Shadow work
  const shadow = arr(b.shadowAssignments);
  b.shadowAssignments = shadow;
  const shSec = h('section', { class: 'hall-section' }, h('h4', { text: `Shadow work (${shadow.length}) — internal, no external effect` }));
  shadow.forEach((s, i) => {
    const obj = input(str(s.objective));
    obj.addEventListener('input', () => (s.objective = obj.value));
    const ins = area(str(s.instructions), 4);
    ins.addEventListener('input', () => (s.instructions = ins.value));
    shSec.append(h('fieldset', { class: 'talent-item' }, h('legend', { text: `Shadow ${i + 1}` }), field('Objective', obj), field('Instructions', ins), btn('Remove', () => {
      shadow.splice(i, 1);
      host.reload();
    })));
  });
  shSec.append(btn('Add shadow work', () => {
    shadow.push({ code: `${str(b.code)}.shadow-${shadow.length + 1}`, objective: '', instructions: '', capMicros: 60_000 });
    host.reload();
  }));
  box.append(shSec);

  // Everything else (curriculum, dimensions, limits, pins) — the full definition, as JSON.
  const adv = h('details', { class: 'talent-advanced' }, h('summary', { text: 'Advanced: the full definition (curriculum, dimensions, probation, limits, BQM-2 pins)' }));
  const json = area(JSON.stringify(b, null, 2), 16, { class: 'mono' });
  json.addEventListener('change', () => {
    try {
      ed.body = JSON.parse(json.value) as Json;
      host.reload();
    } catch {
      host.note('The definition is not valid JSON yet.', 'system');
    }
  });
  adv.append(json);
  box.append(adv);
  box.append(editorFoot(host, state));
  return box;
}

// --- People & progress ------------------------------------------------------------------------------------------------

function people(host: TalentHost, state: TalentState, o: Json): HTMLElement {
  const box = h('div', { class: 'talent-pane' });
  const defs = arr(o.definitions);
  const tools = arr(o.tools);
  const seatsList = arr(o.seats);
  const ul = h('ul', { class: 'plain hall-list' });
  for (const p of arr(o.people)) {
    const env = p.envelope as Json | null;
    const cert = p.certification as Json | null;
    const en = p.enrollment as Json | null;
    const li = h('li', { class: 'talent-card' }, h('strong', { text: str(p.name) }), ' ', pill(humanize(str(p.state))), h('span', { class: 'muted small', text: ` ${str(p.roleRef)} · ${p.departmentId ? host.deptNameOf(str(p.departmentId)) : 'Company'}` }));
    li.append(h('p', { class: 'small', text: `Envelope ${env ? `${money(env.capMoney, env.currency)} · spent ${money(env.spentMoney, env.currency)}` : 'none'} · Academy spend ${money(p.academySpentMicros)} · Academy ${en ? humanize(str(en.stage)) : 'not enrolled'} · Certification ${cert ? `${humanize(str(cert.status))} until ${str(cert.validUntil).slice(0, 10)}` : 'none'}` }));
    if (cert) for (const sc of arr(cert.toolScopes)) li.append(h('p', { class: 'small' }, h('span', { text: `Tool ${str(sc.tool_code)}: ` }), pill(sc.status === 'ASSESSED' ? 'Operating it was assessed' : `Not assessed (${humanize(str(sc.readiness))})`, sc.status === 'ASSESSED' ? 'pill-ok' : 'pill-needs_decision')));
    if (p.identity) li.append(h('p', { class: 'muted small', text: `Identity: catalog profile (${humanize(str((p.identity as Json).classification))}) since ${str((p.identity as Json).boundAt).slice(0, 10)}` }));
    if (arr(p.policyGrants).length > 0) li.append(h('p', { class: 'muted small', text: `Policy grants: ${arr(p.policyGrants).map((g) => `${str(g.capability)} (${str(g.code)})`).join(', ')}` }));
    const actions = h('div', { class: 'pilot-actions' });
    const seat = seatsList.find((s) => (s.holder as Json | null)?.employeeId === p.employeeId);
    if (seat) actions.append(btn('Open the seat case', () => {
      state.seatCase = str(seat.positionId);
      state.seatCaseData = null;
      host.reload();
    }));
    if (p.state === 'ACTIVE') actions.append(btn('Preview: retrain (ACTIVE → RETRAINING)', () => void preview(host, 'EMPLOYEE_RETRAIN', { employeeId: str(p.employeeId) })));
    const ids = defs.filter((d) => d.kind === 'IDENTITY_PROFILE' && d.state === 'APPROVED' && d.roleRef === p.roleRef && (p.identity as Json | null)?.definitionId !== d.id);
    if (ids.length > 0 && p.state !== 'RETIRED') {
      const sel = select(ids.map((d) => [str(d.id), `${str(d.code)} v${str(d.version)}`] as const), str(ids[0]?.id), 'Identity version');
      const cls = select([['MINOR', 'Minor revision'], ['MATERIAL', 'Material revision (certifications become review due)']], 'MINOR', 'Classification');
      actions.append(h('span', { class: 'talent-row' }, sel, cls, btn('Preview: revise the identity', () => void preview(host, 'EMPLOYEE_IDENTITY_REVISE', { employeeId: str(p.employeeId), definitionId: sel.value, classification: cls.value }))));
    }
    const ready = tools.filter((t0) => t0.readiness === 'READY');
    if (ready.length > 0 && p.state !== 'RETIRED') {
      const opts = ready.flatMap((t0) => arr(t0.actions).filter((a) => a.status === 'ACTIVE' && (a.risk === 'R0' || a.risk === 'R1')).map((a) => [`${str(t0.toolCode)}|${str(a.code)}`, `${str(t0.toolCode)} · ${str(a.code)} (${str(a.risk)})`] as const));
      if (opts.length > 0) {
        const sel = select(opts, opts[0]?.[0] ?? '', 'Tool action');
        actions.append(h('span', { class: 'talent-row' }, sel, btn('Preview: grant the tool', () => {
          const [toolCode, actionCode] = sel.value.split('|');
          void preview(host, 'TOOL_ACCESS', { employeeId: str(p.employeeId), toolCode, actionCode, decision: 'GRANT' });
        })));
      }
    }
    li.append(actions);
    ul.append(li);
  }
  if (arr(o.people).length === 0) ul.append(h('li', { class: 'empty', text: 'No Employee yet.' }));
  box.append(ul);
  return box;
}
