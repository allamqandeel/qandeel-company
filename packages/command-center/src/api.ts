/**
 * The Founder surface API: explicit capabilities over the runtime's admin handles (Stage 12 §50). No
 * generic "execute anything": every route names one read or one governed act. Reads change attention;
 * mutating natural-language intents become previews; only `confirm` reaches an authority boundary, and
 * it does so inside the verified session scope. Responses carry Founder-scoped company content; the
 * log lines this module emits carry codes and IDs only.
 */
import { QandeelError, isTimestamp, type Id } from '@qandeel-company/domain';
import { classifyFounderIntent, type FounderIntent, type MutatingIntent } from '@qandeel-company/governance';
import type { CompanyUniverse, FounderSession, UniverseEmployee } from '@qandeel-company/storage';
import type { CompanyRuntime } from '@qandeel-company/runtime';

export interface ApiContext {
  readonly runtime: CompanyRuntime;
  readonly session: FounderSession;
}

type Json = Record<string, unknown>;

const str = (v: unknown, field: string, max = 4000): string => {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) throw new QandeelError('VALIDATION_FAILED', `${field} is required`, { field });
  return v;
};
const optStr = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 400 ? v : null);

// --- reads ----------------------------------------------------------------------------------------

export function universe(ctx: ApiContext, query: { at?: string | undefined }): CompanyUniverse {
  const at = query.at;
  if (at !== undefined && !isTimestamp(at)) throw new QandeelError('VALIDATION_FAILED', 'at must be a canonical UTC timestamp', { field: 'at' });
  if (at === undefined) ctx.runtime.founder.attention.sync(ctx.session.founderRef);
  return ctx.runtime.founder.universe(at === undefined ? {} : { at });
}

export function employeeDetail(ctx: ApiContext, employeeId: string): Json {
  const id = str(employeeId, 'employeeId', 36) as Id;
  const u = ctx.runtime.founder.universe();
  const e = u.employees.find((x) => x.id === id);
  if (!e) throw new QandeelError('NOT_FOUND', 'employee not found', { employeeId: id });
  const work = u.work.filter((w) => w.ownerEmployeeId === id);
  const ref = `employee:${id}`;
  const relations = u.relations.filter((r) => r.from === ref || r.to === ref);
  const gov = ctx.runtime.governance;
  const budget = gov.budgetFor('EMPLOYEE', id);
  const grants = gov.grants(id).filter((g) => g.status === 'ACTIVE').map((g) => ({ capability: g.capability, riskCeiling: g.riskCeiling, expiresAt: g.expiresAt }));
  const threads = ctx.runtime.founder.communications.threads({ employeeId: id, state: 'OPEN' }).map((t) => ({ id: t.id, kind: t.kind, subject: t.subject, updatedAt: t.updatedAt }));
  const seat = u.seats.find((s) => s.id === e.seatId) ?? null;
  return {
    employee: e,
    seat,
    department: u.departments.find((d) => d.id === e.departmentId) ?? null,
    manager: managerOf(u, e),
    work,
    relations,
    goals: u.goals.filter((g) => work.some((w) => w.goalIds.includes(g.id))).map((g) => ({ id: g.id, title: g.title, state: g.state })),
    budget: budget ? { currency: budget.currency, capMoney: budget.capMoney, spentMoney: budget.spentMoney, reservedMoney: budget.reservedMoney, id: budget.id } : null,
    grants,
    threads,
    blocked: work.some((w) => w.state === 'BLOCKED'),
    waiting: work.filter((w) => w.state.startsWith('WAITING')).map((w) => w.state),
  };
}

function managerOf(u: CompanyUniverse, e: UniverseEmployee): { kind: string; employeeId: Id | null; positionId: Id | null } | null {
  const above = e.chain[1];
  return above ? { kind: above.kind, employeeId: above.employeeId, positionId: above.positionId } : null;
}

export function goalDetail(ctx: ApiContext, goalId: string): Json {
  const id = str(goalId, 'goalId', 36) as Id;
  const goals = ctx.runtime.founder.goals;
  const g = goals.get(id);
  const u = ctx.runtime.founder.universe();
  const links = goals.links({ goalId: id, live: true });
  const work = u.work.filter((w) => links.some((l) => l.workItemId === w.id));
  const employees = [...new Set(work.map((w) => w.ownerEmployeeId).filter((x): x is Id => x !== null))];
  const departments = [...new Set(work.map((w) => w.departmentId).filter((x): x is Id => x !== null).concat(g.departmentId ? [g.departmentId] : []))];
  const paths = u.relations.filter((r) => r.workItemId !== null && work.some((w) => w.id === r.workItemId));
  return { goal: g, history: goals.history(id), children: goals.list({ live: true }).filter((c) => c.parentGoalId === id).map((c) => ({ id: c.id, title: c.title, state: c.state, departmentId: c.departmentId })), links, work, employees, departments, paths };
}

export function attention(ctx: ApiContext): Json {
  const store = ctx.runtime.founder;
  store.attention.sync(ctx.session.founderRef);
  const items = store.attention.list({ state: 'OPEN' });
  const gov = ctx.runtime.governance;
  const org = ctx.runtime.org.organization;
  const detail = (i: (typeof items)[number]): Json => {
    const [kind, id] = i.sourceRef.split(':') as [string, string];
    try {
      if (kind === 'approval') {
        const a = gov.getApproval(id as Id);
        return { approval: { id: a.id, action: a.action, risk: a.risk, subjectRef: a.subjectRef, workItemId: a.workItemId, state: a.state, createdAt: a.createdAt } };
      }
      if (kind === 'message') {
        const m = store.communications.message(id as Id);
        return { message: { id: m.id, threadId: m.threadId, purpose: m.purpose, senderRef: m.senderRef, body: m.body, brief: m.brief, createdAt: m.createdAt } };
      }
      if (kind === 'staffing_request') {
        const r = org.staffingRequest(id as Id);
        return { staffing: { id: r.id, positionTitle: r.positionTitle, positionKind: r.positionKind, departmentId: r.departmentId, state: r.state, ceoRecommendation: r.ceoRecommendation } };
      }
      if (kind === 'work_delegation') {
        const d = org.workDelegations().find((x) => x.id === id);
        return d ? { escalation: { id: d.id, childWorkItemId: d.childWorkItemId, delegatorEmployeeId: d.delegatorEmployeeId, delegateEmployeeId: d.delegateEmployeeId, state: d.state } } : {};
      }
      if (kind === 'review_conflict') {
        const c = ctx.runtime.org.review.conflicts('OPEN').find((x) => x.id === id);
        return c ? { conflict: { id: c.id, requestId: c.requestId, origin: c.origin } } : {};
      }
      if (kind === 'goal') {
        const g = store.goals.get(id as Id);
        return { goal: { id: g.id, title: g.title, kind: g.kind, state: g.state, ownerRef: g.ownerRef } };
      }
      if (kind === 'thread') {
        const t = store.communications.thread(id as Id);
        return { thread: { id: t.id, subject: t.subject, kind: t.kind, employeeId: t.employeeId } };
      }
    } catch {
      return {};
    }
    return {};
  };
  return { items: items.map((i) => ({ ...i, ...detail(i) })), health: store.attention.health() };
}

export function threads(ctx: ApiContext): Json {
  const c = ctx.runtime.founder.communications;
  return { threads: c.threads({ state: 'OPEN' }).map((t) => ({ ...t, last: c.messages(t.id).at(-1) ?? null })), health: c.health() };
}

export function messages(ctx: ApiContext, threadId: string): Json {
  const c = ctx.runtime.founder.communications;
  const id = str(threadId, 'threadId', 36) as Id;
  return { thread: c.thread(id), messages: c.messages(id), pending: c.pendingReplies().filter((p) => p.threadId === id) };
}

export function calendar(ctx: ApiContext, query: { from?: string | undefined; to?: string | undefined }): Json {
  const now = new Date().toISOString();
  const from = query.from ?? now;
  const to = query.to ?? new Date(Date.now() + 30 * 86_400_000).toISOString();
  if (!isTimestamp(from) || !isTimestamp(to) || to < from) throw new QandeelError('VALIDATION_FAILED', 'from/to must be canonical UTC timestamps', { field: 'from' });
  const org = ctx.runtime.org.organization.calendar(from, to).map((e) => ({ at: e.at, kind: e.kind, ref: e.ref }));
  const goals = ctx.runtime.founder.goals.list({ live: true }).filter((g) => g.horizonTo !== null && g.horizonTo >= from && g.horizonTo < to).map((g) => ({ at: g.horizonTo as string, kind: 'GOAL_HORIZON', ref: `goal:${g.id}`, title: g.title }));
  const u = ctx.runtime.founder.universe();
  const work = u.work.filter((w) => w.dueAt !== null && w.dueAt >= from && w.dueAt < to).map((w) => ({ at: w.dueAt as string, kind: 'WORK_DUE', ref: `work_item:${w.id}`, title: w.objective.slice(0, 80) }));
  const approvals = ctx.runtime.governance.listApprovals('APPROVED').filter((a) => a.expiresAt !== null && a.expiresAt >= from && a.expiresAt < to).map((a) => ({ at: a.expiresAt as string, kind: 'APPROVAL_EXPIRES', ref: `approval:${a.id}` }));
  const sessions = ctx.runtime.founder.auth.sessions().filter((s) => s.revokedAt === null && s.expiresAt >= from && s.expiresAt < to).map((s) => ({ at: s.expiresAt, kind: 'SESSION_EXPIRES', ref: `session:${s.id}` }));
  const events = [...org, ...goals, ...work, ...approvals, ...sessions].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.ref < b.ref ? -1 : 1));
  return { from, to, events };
}

export function timeline(ctx: ApiContext): Json {
  const view = ctx.runtime.view;
  // The company's first instant: its Founder's registration or its first Employee, whichever the store holds
  // (never this process's start, which would leave a seeded company with seconds of history to scrub).
  const first = ['principal.founder_registered', 'employee.created', 'department.created', 'runtime.ready']
    .flatMap((action) => {
      const at = view.auditByAction(action, 1)[0]?.occurredAt;
      return at === undefined ? [] : [String(at)];
    })
    .sort()[0] ?? null;
  const u = ctx.runtime.founder.universe();
  const marks = [
    ...ctx.runtime.founder.goals.list().flatMap((g) => ctx.runtime.founder.goals.history(g.id).map((h) => ({ at: h.occurredAt, kind: `GOAL_${h.toState}`, ref: `goal:${g.id}` }))),
    ...u.attention.map((a) => ({ at: a.firstSeenAt, kind: `ATTENTION_${a.lane}`, ref: a.sourceRef })),
  ].sort((a, b) => (a.at < b.at ? -1 : 1));
  return { earliest: first ?? marks[0]?.at ?? new Date().toISOString(), now: new Date().toISOString(), marks: marks.slice(-200) };
}

export function health(ctx: ApiContext): Json {
  const f = ctx.runtime.founder;
  return { runtime: ctx.runtime.state, attention: f.attention.health(), communication: f.communications.health(), goals: f.goals.list({ live: true }).length, sessions: f.auth.sessions().filter((s) => s.revokedAt === null).length, org: ctx.runtime.orgHealth(), governance: ctx.runtime.governance.healthCounts() };
}

// --- command / previews / writes --------------------------------------------------------------------

export interface CommandResolution {
  readonly intent: FounderIntent;
  readonly focus?: { readonly lens: string; readonly targetId?: string | null; readonly query?: string | null };
  readonly preview?: Json;
  readonly matches?: readonly { id: string; label: string; kind: string }[];
}

/** Resolves a read intent to a focus change, or a mutating one to a preview (never to a mutation). */
export function command(ctx: ApiContext, body: Json): CommandResolution {
  const text = str(body.text, 'text', 400);
  const intent = classifyFounderIntent(text);
  if (intent.kind === 'UNKNOWN') return { intent };
  const u = ctx.runtime.founder.universe();
  if (intent.kind === 'READ') {
    switch (intent.intent) {
      case 'RETURN_TO_LIVE':
        return { intent, focus: { lens: 'LIVE' } };
      case 'SHOW_CEO': {
        const ceo = u.seats.find((s) => s.kind === 'CEO');
        return { intent, focus: { lens: 'CEO', targetId: ceo?.holderEmployeeId ?? null } };
      }
      case 'WHAT_IS_BLOCKED':
        return { intent, focus: { lens: 'BLOCKED' }, matches: u.work.filter((w) => w.state === 'BLOCKED').map((w) => ({ id: w.id, label: w.objective.slice(0, 80), kind: 'work' })) };
      case 'NEEDS_MY_APPROVAL':
        return { intent, focus: { lens: 'ATTENTION', query: 'NEEDS_ME' } };
      case 'SHOW_BRIEFS':
        return { intent, focus: { lens: 'ATTENTION', query: 'CEO_BRIEFS' } };
      case 'SHOW_TIMELINE':
        return { intent, focus: { lens: 'HISTORY' } };
      case 'SHOW_DEPARTMENT': {
        const m = matchDepartment(u, intent.argument ?? '');
        return { intent, focus: { lens: 'DEPARTMENT', targetId: m?.id ?? null, query: intent.argument }, matches: m ? [{ id: m.id, label: m.name, kind: 'department' }] : [] };
      }
      case 'SHOW_GOAL': {
        const ms = matchGoals(u, intent.argument ?? '');
        return { intent, focus: { lens: 'GOAL', targetId: ms[0]?.id ?? null, query: intent.argument }, matches: ms.map((g) => ({ id: g.id, label: g.title, kind: 'goal' })) };
      }
      case 'WHO_WORKS_ON': {
        const ms = matchGoals(u, intent.argument ?? '');
        const g = ms[0];
        const people = g ? [...new Set(u.work.filter((w) => w.goalIds.includes(g.id)).map((w) => w.ownerEmployeeId).filter((x): x is Id => x !== null))] : [];
        return { intent, focus: { lens: 'GOAL', targetId: g?.id ?? null, query: intent.argument }, matches: people.map((id) => ({ id, label: nameOf(u, id), kind: 'employee' })) };
      }
      case 'OPEN_EMPLOYEE': {
        const ms = matchEmployees(u, intent.argument ?? '');
        return { intent, focus: { lens: 'EMPLOYEE', targetId: ms[0]?.id ?? null, query: intent.argument }, matches: ms.map((e) => ({ id: e.id, label: nameOf(u, e.id), kind: 'employee' })) };
      }
    }
  }
  // Mutating: never executed here. A preview is created only when the intent resolves to one concrete target.
  const target = resolveMutatingTarget(ctx, u, intent.intent, intent.argument, intent.amount, intent.decision);
  if (target === null) return { intent, matches: [] };
  const preview = ctx.runtime.founder.actions.preview(ctx.session, target.intent, target.payload);
  return { intent, preview: { ...preview, summary: target.summary } };
}

function nameOf(u: CompanyUniverse, id: Id): string {
  const e = u.employees.find((x) => x.id === id);
  return e ? `${e.name.given} ${e.name.family}` : id;
}

const norm = (s: string): string => s.normalize('NFC').toLowerCase().replace(/[ً-ْ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();

const DEPT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'strategic-market-intelligence': ['intelligence', 'market', 'استخبارات', 'الاستخبارات', 'السوق', 'strategic'],
  growth: ['growth', 'النمو', 'نمو'],
  'brand-creative': ['brand', 'creative', 'العلامه', 'علامه', 'الابداع', 'ابداع', 'براند'],
  product: ['product', 'المنتج', 'منتج'],
  engineering: ['engineering', 'الهندسه', 'هندسه', 'engineers'],
};

function matchDepartment(u: CompanyUniverse, q: string): CompanyUniverse['departments'][number] | null {
  const n = norm(q);
  if (n.length === 0) return null;
  return u.departments.find((d) => d.code === n || norm(d.name) === n || (DEPT_ALIASES[d.code] ?? []).some((a) => n.includes(norm(a)))) ?? null;
}

function matchGoals(u: CompanyUniverse, q: string): CompanyUniverse['goals'] {
  const n = norm(q);
  if (n.length === 0) return u.goals;
  return u.goals.filter((g) => norm(g.title).includes(n) || g.id === q);
}

/**
 * Employees named by a query: the query names the person (a name or role fragment), or — for a longer
 * instruction such as "وافق على حملة إيهاب طارق بميزانية …" — the person's full name occurs inside the query.
 */
function matchEmployees(u: CompanyUniverse, q: string): CompanyUniverse['employees'] {
  const n = norm(q);
  if (n.length === 0) return [];
  return u.employees.filter((e) => {
    const full = norm(`${e.name.given} ${e.name.family}`);
    return e.id === q || full.includes(n) || norm(e.name.given) === n || norm(e.name.family) === n || norm(e.roleRef).includes(n) || (full.length >= 5 && n.includes(full));
  });
}

function resolveMutatingTarget(ctx: ApiContext, u: CompanyUniverse, intent: MutatingIntent, argument: string | null, amount: { currency: string; value: number } | null, decision: 'APPROVE' | 'REJECT' | null): { intent: MutatingIntent; payload: Json; summary: string } | null {
  switch (intent) {
    case 'APPROVAL_DECIDE': {
      const pending = ctx.runtime.governance.listApprovals('PENDING').filter((a) => a.risk !== 'R4' && a.risk !== 'R2');
      const byArg = argument ? pending.filter((a) => a.id === argument || (a.workItemId !== null && u.work.find((w) => w.id === a.workItemId && norm(w.objective).includes(norm(argument))))) : pending;
      const a = byArg.length === 1 ? byArg[0] : pending.length === 1 ? pending[0] : undefined;
      if (!a) return null;
      const subject = a.workItemId !== null ? (u.work.find((w) => w.id === a.workItemId)?.objective ?? a.subjectRef) : a.subjectRef;
      return { intent, payload: { approvalId: a.id, decision: decision ?? 'APPROVE', reasonCode: 'founder.decided' }, summary: `${decision === 'REJECT' ? 'رفض' : 'اعتماد'} طلب الموافقة (${a.risk}) على: ${subject}` };
    }
    case 'GOAL_APPROVE': {
      const gs = matchGoals(u, argument ?? '').filter((g) => g.kind === 'COMPANY' && g.state === 'PROPOSED');
      const g = gs.length === 1 ? gs[0] : undefined;
      if (!g) return null;
      return { intent, payload: { goalId: g.id, activate: true, reasonCode: 'goal.approved' }, summary: `اعتماد هدف الشركة وتفعيله: ${g.title}` };
    }
    case 'GOAL_STATE': {
      const gs = matchGoals(u, argument ?? '');
      const g = gs.length === 1 ? gs[0] : undefined;
      if (!g) return null;
      const to = /pause|اوقف|أوقف/i.test(argument ?? '') ? 'PAUSED' : /cancel|الغ/i.test(argument ?? '') ? 'CANCELLED' : /achiev/i.test(argument ?? '') ? 'ACHIEVED' : 'ACTIVE';
      const verb = to === 'PAUSED' ? 'إيقاف الهدف مؤقتًا' : to === 'CANCELLED' ? 'إلغاء الهدف' : to === 'ACHIEVED' ? 'إعلان تحقق الهدف' : 'تفعيل الهدف';
      return { intent, payload: { goalId: g.id, to, reasonCode: 'goal.state' }, summary: `${verb}: ${g.title}` };
    }
    case 'BUDGET_CEILING': {
      const es = matchEmployees(u, argument ?? '');
      const e = es.length === 1 ? es[0] : undefined;
      if (!e || amount === null) return null;
      const budgetId = ctx.runtime.founder.actions.employeeBudgetId(e.id);
      if (budgetId === null) return null;
      const b = ctx.runtime.governance.budgetFor('EMPLOYEE', e.id);
      // Money is stored in micro-units of the envelope's currency; a stated ceiling maps 1:1 to that currency.
      return { intent, payload: { budgetId, capMoney: amount.value * 1_000_000, capTokens: b?.capTokens ?? 0, currency: amount.currency, reasonCode: 'founder.ceiling' }, summary: `رفع سقف الغلاف المالي لـ${nameOf(u, e.id)} إلى ${amount.value.toLocaleString('ar-EG')} ${amount.currency === 'EGP' ? 'جنيه' : amount.currency === 'SAR' ? 'ريال' : 'دولار'}` };
    }
    case 'STAFFING_DECIDE': {
      const rs = ctx.runtime.org.organization.staffingRequests('RECOMMENDED');
      const r = rs.length === 1 ? rs[0] : undefined;
      if (!r) return null;
      return { intent, payload: { requestId: r.id, decision: decision ?? 'APPROVE', reasonCode: 'founder.decided' }, summary: `${decision === 'REJECT' ? 'رفض' : 'اعتماد'} طلب التوظيف: ${r.positionTitle}` };
    }
    case 'CONFLICT_RESOLVE': {
      const cs = ctx.runtime.org.review.conflicts('OPEN');
      const c = cs.length === 1 ? cs[0] : undefined;
      if (!c) return null;
      return { intent, payload: { conflictId: c.id, resolution: decision === 'REJECT' ? 'REWORK' : 'PASS', reasonCode: 'founder.resolved' }, summary: `حسم خلاف المراجعة ${decision === 'REJECT' ? 'بإعادة العمل' : 'بالقبول'}` };
    }
    case 'GOAL_PROPOSE':
    case 'DELEGATE_WORK':
      // These need structured input (a form), never free text: the palette returns the intent and the UI opens the form.
      return null;
  }
}

export function createPreview(ctx: ApiContext, body: Json): Json {
  const preview = ctx.runtime.founder.actions.preview(ctx.session, body.intent, body.payload);
  return { preview };
}

export function confirmPreview(ctx: ApiContext, previewId: string, body: Json): Json {
  const out = ctx.runtime.founder.actions.confirm(ctx.session, str(previewId, 'previewId', 36), body.fingerprint);
  ctx.runtime.founder.attention.sync(ctx.session.founderRef);
  return { preview: out.preview, resultRef: out.resultRef };
}

export function rejectPreview(ctx: ApiContext, previewId: string, body: Json): Json {
  return { preview: ctx.runtime.founder.actions.reject(ctx.session, str(previewId, 'previewId', 36), optStr(body.reasonCode) ?? 'founder.rejected') };
}

export function openThread(ctx: ApiContext, body: Json): Json {
  const employeeId = optStr(body.employeeId);
  return ctx.runtime.founder.auth.withSession(ctx.session, (founderRef) => ({ thread: ctx.runtime.founder.communications.directThread(founderRef, employeeId) }));
}

export function sendMessage(ctx: ApiContext, threadId: string, body: Json): Json {
  const purpose = str(body.purpose, 'purpose', 32);
  const text = str(body.body, 'body', 4000);
  return ctx.runtime.founder.auth.withSession(ctx.session, (founderRef) => {
    const out = ctx.runtime.founder.communications.send(founderRef, str(threadId, 'threadId', 36), { purpose: purpose as never, body: text, ...(typeof body.responseRequired === 'boolean' ? { responseRequired: body.responseRequired } : {}), ...(optStr(body.attentionLevel) ? { attentionLevel: body.attentionLevel as never } : {}) });
    return { message: out.message, replyWorkItemId: out.replyWorkItemId };
  });
}

export function dismissAttention(ctx: ApiContext, itemId: string, body: Json): Json {
  return ctx.runtime.founder.auth.withSession(ctx.session, (founderRef) => ({ item: ctx.runtime.founder.attention.dismiss(founderRef, str(itemId, 'itemId', 36), optStr(body.reasonCode) ?? 'founder.dismissed') }));
}

export function proposeGoal(ctx: ApiContext, body: Json): Json {
  const preview = ctx.runtime.founder.actions.preview(ctx.session, 'GOAL_PROPOSE', body);
  return { preview };
}

/** Departments and employees for forms (a read; the universe already carries them, this is the compact form list). */
export function directory(ctx: ApiContext): Json {
  return { departments: ctx.runtime.org.organization.departments(), employees: ctx.runtime.governance.listEmployees().map((e) => ({ id: e.id, name: e.name, state: e.state, roleRef: e.roleRef })) };
}
