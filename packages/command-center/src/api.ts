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
  /** C7-D: opens an internal Preview on the isolated preview host (absent → the preview capability is unavailable). */
  readonly preview?: PreviewOpener;
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
    // D-L1-44: the standing reasoning default / ceiling, Founder one-task overrides and the classes actually used.
    reasoning: gov.reasoningControl(id) as unknown as Json,
    // P1-CHAT-INTEL-01: Employee Intelligence — the fixed model, the per-level availability for conversation, usage and money.
    intelligence: gov.employeeIntelligence(id) as unknown as Json,
    // D2-UX-01: the record's own "About" facts and training summary (the Academy overview narrowed to this Employee).
    profile: (ctx.runtime.founder.academy({ employeeId: id }).employees[0] ?? null) as unknown as Json,
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
      if (kind === 'systemic_finding') {
        const f = store.improvement.systemicFindings().find((x) => x.id === id);
        return f ? { systemic: { id: f.id, targetKind: f.targetKind, targetRef: f.targetRef, cause: f.cause, origin: f.origin, contributorEmployeeId: f.contributorEmployeeId, occurrences: f.occurrences, distinctEmployees: f.distinctEmployees, recommendationCode: f.recommendationCode, state: f.state } } : {};
      }
      if (kind === 'judgment_assignment') {
        const j = store.improvement.judgments().find((x) => x.id === id);
        return j ? { judgment: { id: j.id, subjectKind: j.subjectKind, subjectId: j.subjectId, workItemId: j.workItemId, judgeEmployeeId: j.judgeEmployeeId, reviewOutcome: j.reviewOutcome, reasonCode: j.reasonCode, state: j.state } } : {};
      }
      // R2-22: the exception subjects the Founder decides through structured previews (read-only IDs / codes).
      if (kind === 'tool_invocation') return { uncertainEffect: { id } };
      if (kind === 'budget_reservation') {
        const r = gov.reservationsInState('RECONCILIATION_REQUIRED').find((x) => x.id === id);
        return r ? { heldReservation: { id: r.id, workItemId: r.workItemId, purpose: r.purpose } } : {};
      }
      if (kind === 'queue_job') {
        const j = ctx.runtime.view.getJob(id as Id);
        return { heldJob: { id: j.id, workItemId: j.workItemId, state: j.state } };
      }
      if (kind === 'review_request') {
        const r = ctx.runtime.org.review.request(id as Id);
        return { reviewEscalation: { id: r.id, workItemId: r.workItemId, subjectKind: r.subjectKind, risk: r.riskLevel, state: r.state } };
      }
      if (kind === 'work_item') return { outcome: { workItemId: id } };
      if (kind === 'recovery_drill' || kind === 'portable_backup' || kind === 'maintenance') {
        return { resilience: { exceptions: ctx.runtime.resilience().exceptions.filter((x) => x.material && x.ref === i.sourceRef).map((x) => x.code) } };
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

/**
 * P1-CHAT-INTEL-01: one page of a conversation (the newest page, or the page before `before`), the truthful state of the
 * replies on that page, and — on the newest page — the Employee's intelligence for the conversation (the levels a next
 * message may use and why the others may not). Founder-scoped content; nothing here writes.
 */
export function messages(ctx: ApiContext, threadId: string, query: { before?: string | undefined; limit?: string | undefined } = {}): Json {
  const c = ctx.runtime.founder.communications;
  const id = str(threadId, 'threadId', 36) as Id;
  const int = (v: string | undefined, field: string, max: number): number | null => {
    if (v === undefined) return null;
    if (!/^\d{1,9}$/.test(v) || Number(v) < 1 || Number(v) > max) throw new QandeelError('VALIDATION_FAILED', `${field} is a positive integer`, { field });
    return Number(v);
  };
  const before = int(query.before, 'before', 1_000_000_000);
  const thread = c.thread(id);
  const page = c.messagesPage(id, { beforeSeq: before, limit: int(query.limit, 'limit', 200) ?? 50 });
  const founderIds = page.messages.filter((m) => m.senderKind === 'FOUNDER' && m.replyWorkItemId !== null).map((m) => m.id);
  return {
    thread,
    messages: page.messages,
    hasOlder: page.hasOlder,
    replies: c.replyStates(id, founderIds),
    // Kept for older views: the Founder messages without a reply yet (durable pending requests, whatever their state).
    pending: before === null ? c.pendingReplies().filter((p) => p.threadId === id) : [],
    intelligence: before === null ? (ctx.runtime.governance.employeeIntelligence(thread.employeeId) as unknown as Json) : null,
  };
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
  // C7-D: the exact windows approved (or awaiting approval) for a scheduled publication — the existing calendar, no second scheduler.
  const publications = ctx.runtime.founder.digital.publicationWindows(from, to).map((p) => ({ at: p.notBefore, kind: 'PUBLICATION_WINDOW', ref: `digital_promotion:${p.promotionId}`, state: p.state, until: p.notAfter }));
  const events = [...org, ...goals, ...work, ...approvals, ...sessions, ...publications].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.ref < b.ref ? -1 : 1));
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

// --- C6: reports, inspection, profiles, resilience ----------------------------------------------------

const CADENCES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
const cadenceOf = (v: unknown): (typeof CADENCES)[number] => {
  if (typeof v !== 'string' || !(CADENCES as readonly string[]).includes(v)) throw new QandeelError('VALIDATION_FAILED', 'cadence is DAILY, WEEKLY or MONTHLY', { field: 'cadence' });
  return v as (typeof CADENCES)[number];
};

/** The latest report of a cadence (a read; never generates). */
export function latestReport(ctx: ApiContext, cadence: string): Json {
  return { report: ctx.runtime.founder.improvement.latestReport(cadenceOf(cadence)) };
}

/** Generates (idempotently) the report of a cadence ending now: a system derivation, announced only when new. */
export function generateReport(ctx: ApiContext, body: Json): Json {
  const out = ctx.runtime.founder.improvement.generateReport(cadenceOf(body.cadence));
  return { report: out.report, changed: out.changed };
}

/** The evidence behind any claim: Company, Department, Employee, Goal or Work Item (no aggregate score). */
export function inspect(ctx: ApiContext, query: { kind: string; id?: string | undefined }): Json {
  const kinds = ['COMPANY', 'DEPARTMENT', 'EMPLOYEE', 'GOAL', 'WORK_ITEM'] as const;
  if (!(kinds as readonly string[]).includes(query.kind)) throw new QandeelError('VALIDATION_FAILED', 'kind is COMPANY, DEPARTMENT, EMPLOYEE, GOAL or WORK_ITEM', { field: 'kind' });
  const kind = query.kind as (typeof kinds)[number];
  return ctx.runtime.founder.improvement.inspect(kind === 'COMPANY' ? { kind } : { kind, id: str(query.id, 'id', 36) });
}

export function profile(ctx: ApiContext, employeeId: string): Json {
  return { profile: ctx.runtime.founder.improvement.profile(str(employeeId, 'employeeId', 36)) };
}

export function resilience(ctx: ApiContext): Json {
  return { resilience: ctx.runtime.resilience() };
}

// --- C7-C: Pilots (reads; a Pilot is created and moved only through structured, confirmed previews) ---------------------

/** Company goals a READY Pilot could be activated on: Founder-approved, ACTIVE, with success criteria, not yet a Pilot's root. */
function activatableGoals(ctx: ApiContext): Json[] {
  const bound = new Set(ctx.runtime.founder.pilots.list().map((p) => p.rootGoalId));
  return ctx.runtime.founder.goals.list({ kind: 'COMPANY', state: 'ACTIVE' }).filter((g) => g.successCriteria.length > 0 && !bound.has(g.id)).map((g) => ({ id: g.id, title: g.title }));
}

/** The Founder's Pilots (identity, mode, state, bindings) with the exact decision each one waits for. */
export function pilots(ctx: ApiContext): Json {
  const store = ctx.runtime.founder.pilots;
  const comm = ctx.runtime.founder.communications;
  return { pilots: store.list().map((p) => ({ ...p, decisionsNeeded: store.decisions(p.id), briefingEmployeeId: p.briefingThreadId === null ? null : comm.thread(p.briefingThreadId).employeeId })), goals: activatableGoals(ctx), health: store.health() };
}

/** One Pilot's Evidence Board: a projection of canonical evidence (no score, no ranking, never a decision). */
export function pilotBoard(ctx: ApiContext, pilotId: string): Json {
  const id = str(pilotId, 'pilotId', 36);
  const store = ctx.runtime.founder.pilots;
  // C7-D: the digital work produced inside the Pilot's scope, as evidence references (counts and states). A provider
  // confirmation is never a Pilot outcome or market success; real outcomes still come only through C7-A.
  return { board: store.board(id), history: store.history(id), digital: ctx.runtime.founder.digital.evidenceForWorkItems(store.scope(id).workItemIds) };
}

// --- C7-D Digital Workshop (reads; a Preview opens on the isolated preview host) ------------------------------

export function digitalProjects(ctx: ApiContext): Json {
  const d = ctx.runtime.founder.digital;
  return { projects: d.projects(), decisions: d.decisions(), targets: d.targets().map((t) => ({ id: t.id, code: t.code, targetClass: t.targetClass, adapterCode: t.adapterCode, externalRef: t.externalRef, state: t.state })), health: d.health() };
}

/**
 * One project for the Founder: what changed (revisions), what can be inspected (previews), what was packaged and
 * reviewed (candidates), and each exact external act with its derived lifecycle — never file-by-file management.
 */
export function digitalProject(ctx: ApiContext, projectId: string): Json {
  const p = ctx.runtime.founder.digital.project(str(projectId, 'projectId', 36));
  return { ...p, publicationIsMarketSuccess: false };
}

export interface PreviewOpener {
  open(previewId: string): Promise<{ readonly url: string; readonly expiresAt: string; readonly mode: 'INTERNAL' }>;
}

/** Opens one internal Preview for the authenticated Founder (a URL on the preview host; nothing is published). */
export async function openDigitalPreview(ctx: ApiContext, previewId: string): Promise<Json> {
  if (!ctx.preview) throw new QandeelError('DIGITAL_REFUSED', 'the internal preview host is not running', { reason: 'PREVIEW_HOST_UNAVAILABLE' });
  return { preview: await ctx.preview.open(str(previewId, 'previewId', 36)) };
}

/** Outcome + trace for one in-scope Work Item (refs into the canonical lineage; blame stays with C6 attribution). */
/**
 * L1-01: the release-pinned provider profiles the host registered, each with its qualified identity, the latest
 * content-free identity check and whether its provider is provisioned. No key, no reference value, no model text.
 */
function providersView(ctx: ApiContext): Json {
  const gov = ctx.runtime.governance;
  const profiles = ctx.runtime.founder.actions.provisioningProfiles().map((p) => {
    const check = gov.modelIdentityChecks(p.providerCode, p.modelCode, 1)[0] ?? null;
    const provider = gov.providerByCode(p.providerCode);
    return {
      code: p.code,
      sha256: p.sha256,
      providerCode: p.providerCode,
      modelCode: p.modelCode,
      expectedPublicName: p.expectedPublicName,
      // L1-02: the cap is labelled in the profile's own currency (was always shown as USD).
      currency: p.currency,
      deployments: p.deployments,
      taskClasses: p.taskClasses,
      // P1-CHAT-INTEL-01: an additive profile is provisioned once its own deployments exist (its base provider already does).
      provisioned: p.extendsProvider ? gov.hasDeployments(p.deploymentCodes) : provider !== null,
      extendsProvider: p.extendsProvider,
      baseProvisioned: provider !== null,
      reasoningClasses: p.reasoningClasses,
      providerStatus: provider?.status ?? null,
      latestCheck: check ? { result: check.result, observedName: check.observedName, checkedAt: check.checkedAt } : null,
    };
  });
  return { profiles } as unknown as Json;
}

export function providers(ctx: ApiContext): Json {
  return providersView(ctx);
}

/**
 * L1-02: the Company activation flow — the durable activation view plus the release-pinned registry the forms post
 * (package codes / versions / digests, scenario and assignment codes, identity profile codes, provider profiles). IDs,
 * codes and the Founder's own Company content only; never a key or a reference value.
 */
function activationPayload(ctx: ApiContext): Json {
  const env = ctx.runtime.founder.actions.activationEnv();
  return {
    view: ctx.runtime.founder.activation(),
    registry: {
      packages: env.packages.map((p) => ({
        code: p.code,
        version: p.version,
        sha256: ctx.runtime.founder.actions.packageDigest(p.code, p.version),
        title: p.title,
        roleRef: p.roleRef,
        skills: p.skills.map((s) => ({ code: s.code, name: s.name, bytes: s.instructions.length, cases: s.benchmark.length, sourceRefs: s.sourceRefs })),
        curriculum: p.program.curriculum.map((m) => ({ code: m.code, category: m.category })),
        scenarios: p.scenarios.map((s) => ({ code: s.code, kind: s.kind, content: s.kind === 'HOLDOUT' ? null : s.content })),
        shadowAssignments: p.shadowAssignments.map((a) => ({ code: a.code, objective: a.objective })),
        taskClasses: p.taskClasses,
        limits: p.limits,
        founderCalibrationRequired: p.program.founderCalibrationRequired,
        assessmentTrials: p.program.assessmentTrials,
      })),
      identities: env.identities.map((i) => ({ code: i.code, roleRef: i.roleRef, sourceRef: i.sourceRef })),
      providers: providersView(ctx),
      evaluatorDimensions: ['REASONING_QUALITY', 'CORRECTNESS', 'EVIDENCE_USE', 'QANDEEL_UNDERSTANDING', 'ROLE_MASTERY', 'COLLABORATION', 'FOUNDER_COMMUNICATION', 'LEARNING_FROM_FEEDBACK'],
    },
  };
}

export function activation(ctx: ApiContext): Json {
  return activationPayload(ctx);
}

/**
 * P1-UX-BUDGET-DARK-01: the Company envelope for the Company panel — a Founder read of the canonical COMPANY budget,
 * in the shape the person sheet already reads for an Employee (ceiling, spent, reserved, currency and the envelope id a
 * BUDGET_CEILING preview addresses). It changes nothing: the ceiling moves only through the existing governed
 * BUDGET_CEILING preview, its fingerprint and the Founder's confirmation.
 */
export function companyBudget(ctx: ApiContext): Json {
  const b = ctx.runtime.governance.budgetFor('COMPANY', 'company');
  return { budget: b ? { id: b.id, currency: b.currency, capMoney: b.capMoney, spentMoney: b.spentMoney, reservedMoney: b.reservedMoney } : null };
}

/**
 * D2-UX-01: the company-wide Academy overview — a Founder read of the canonical Academy, Skills and Employee records
 * (codes, states, scores, dates; never an answer or a scenario's content). It starts no training, qualification,
 * certification or shadow work, calls no model and changes no budget or lifecycle: every Academy act stays a governed
 * preview in the activation flow. Package titles come from the release-pinned registry.
 */
export function academy(ctx: ApiContext): Json {
  const titles = new Map(ctx.runtime.founder.actions.activationEnv().packages.map((p) => [`${p.code}@${p.version}`, p.title]));
  const view = ctx.runtime.founder.academy();
  return { ...view, packages: view.packages.map((p) => ({ ...p, title: titles.get(`${p.code}@${p.version}`) ?? null })) };
}

/**
 * L1-02: the candidate's actual answer to one Academy attempt — what the Founder reads before scoring it. A read of
 * Founder-scoped Company content (the session is the authority; nothing is mutated, and no log line carries the body).
 */
export function attemptAnswer(ctx: ApiContext, attemptId: string): Json {
  const id = str(attemptId, 'attemptId', 36);
  const a = ctx.runtime.founder.attemptAnswer(id);
  return { attemptId: id, answer: a === null ? null : { ref: `work_answer:${a.id}`, runId: a.runId, body: a.body, facets: a.facets, recordedAt: a.createdAt } };
}

export function pilotInspect(ctx: ApiContext, pilotId: string, query: { workItemId?: string | undefined }): Json {
  return { inspection: ctx.runtime.founder.pilots.inspect(str(pilotId, 'pilotId', 36), str(query.workItemId, 'workItemId', 36)) };
}

// --- command / previews / writes --------------------------------------------------------------------

export interface CommandResolution {
  readonly intent: FounderIntent;
  readonly focus?: { readonly lens: string; readonly targetId?: string | null; readonly query?: string | null };
  readonly preview?: Json;
  readonly matches?: readonly { id: string; label: string; kind: string }[];
  /** C6 read intents: the latest report of a cadence, or one Employee's multi-dimensional profile. */
  readonly report?: Json | null;
  readonly profile?: Json;
  /** C7-C read intent: the Pilots and, when exactly one matches, its Evidence Board. */
  readonly pilots?: Json;
  /** L1-01 read intent: the model providers (release-pinned profiles, identity checks, what is provisioned). */
  readonly providers?: Json;
  /** C7-D read intent: the digital projects, the exact external acts awaiting the Founder and (one match) the project. */
  readonly digital?: Json;
  /** L1-02 read intent: the Company activation flow (every step is a structured-only confirmation). */
  readonly activation?: Json;
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
      case 'SHOW_REPORT':
        // A read: the latest report of that cadence as generated (never generated by a question).
        return { intent, report: ctx.runtime.founder.improvement.latestReport(cadenceOf(intent.argument ?? 'DAILY')) as unknown as Json };
      case 'SHOW_PILOT': {
        // A read: the Pilot list, and the board of the one Pilot the words name (never a Pilot act).
        const all = ctx.runtime.founder.pilots.list();
        const want = norm(intent.argument ?? '');
        const ms = want === '' ? all.filter((p) => p.state !== 'COMPLETED' && p.state !== 'STOPPED') : all.filter((p) => p.id === intent.argument || norm(p.title).includes(want));
        const one = ms.length === 1 ? ms[0] : undefined;
        return { intent, focus: { lens: 'PILOT', targetId: one?.id ?? null, query: intent.argument }, matches: ms.map((p) => ({ id: p.id, label: p.title, kind: 'pilot' })), pilots: { list: all.map((p) => ({ ...p, briefingEmployeeId: p.briefingThreadId === null ? null : ctx.runtime.founder.communications.thread(p.briefingThreadId).employeeId })), goals: activatableGoals(ctx), ...(one ? { board: ctx.runtime.founder.pilots.board(one.id) } : {}) } as unknown as Json };
      }
      case 'SHOW_DIGITAL': {
        // A read: the Company's digital projects and the exact external acts awaiting the Founder (decided only through the
        // governed APPROVAL_DECIDE confirmation), and the one project the words name.
        const d = ctx.runtime.founder.digital;
        const all = d.projects();
        const want = norm(intent.argument ?? '').replace(/^(?:ال)?(?:موقع|حضور رقمي|digital|website|previews?)\s*/, '');
        const ms = want === '' ? all : all.filter((p) => p.id === intent.argument || norm(p.title).includes(want));
        const one = ms.length === 1 ? ms[0] : all.length === 1 ? all[0] : undefined;
        return { intent, focus: { lens: 'DIGITAL', targetId: one?.id ?? null, query: intent.argument }, matches: [], digital: { projects: all, decisions: d.decisions(), ...(one ? { project: d.project(one.id) } : {}) } as unknown as Json };
      }
      case 'SHOW_PROVIDERS':
        // L1-01: a read of the model providers; provisioning is the structured-only PROVIDER_PROVISION confirmation.
        return { intent, focus: { lens: 'LIVE', targetId: null, query: null }, matches: [], providers: providersView(ctx) };
      case 'SHOW_ACTIVATION':
        // L1-02: a read of the activation flow; every activation act is a structured-only confirmation.
        return { intent, focus: { lens: 'LIVE', targetId: null, query: null }, matches: [], activation: activationPayload(ctx) };
      case 'SHOW_PERFORMANCE': {
        const ms = matchEmployees(u, intent.argument ?? '');
        const e = ms.length === 1 ? ms[0] : undefined;
        return { intent, focus: { lens: 'EMPLOYEE', targetId: e?.id ?? null, query: intent.argument }, matches: ms.map((x) => ({ id: x.id, label: nameOf(u, x.id), kind: 'employee' })), ...(e ? { profile: ctx.runtime.founder.improvement.profile(e.id) as unknown as Json } : {}) };
      }
    }
  }
  // Mutating: never executed here. A preview is created only when the intent resolves to one concrete target.
  const target = resolveMutatingTarget(ctx, u, intent);
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
 * instruction such as "approve Ehab Tarek's campaign with a budget of …" (or its Arabic form) — the person's
 * full name occurs inside the query.
 */
function matchEmployees(u: CompanyUniverse, q: string): CompanyUniverse['employees'] {
  const n = norm(q);
  if (n.length === 0) return [];
  return u.employees.filter((e) => {
    const full = norm(`${e.name.given} ${e.name.family}`);
    return e.id === q || full.includes(n) || norm(e.name.given) === n || norm(e.name.family) === n || norm(e.roleRef).includes(n) || (full.length >= 5 && n.includes(full));
  });
}

/** Exactly one candidate, or none: a name that matches several (or nothing) never picks one. */
const single = <T>(xs: readonly T[]): T | null => (xs.length === 1 ? (xs[0] as T) : null);

/**
 * What the argument names once the words of the command itself are removed ("staffing request", "conflict",
 * "with rework" …). Empty means the command named no target; a non-empty rest must match (R2-24).
 */
const named = (argument: string | null, noise: RegExp): string => norm(argument ?? '').split(/\s+/).filter((w) => w.length > 0 && !noise.test(w)).join(' ');
const STAFFING_NOISE = /^(?:staffing|request|requests|hire|hiring|for|the|a|an|of|توظيف|طلب|ل|علي|على)$/;
const CONFLICT_NOISE = /^(?:conflict|review|the|a|an|on|about|for|with|as|by|pass|passed|rework|تعارض|خلاف|مراجعه|علي|على|في)$/;

/**
 * Resolves a mutating command to ONE concrete target and the decision the words state, or to nothing. A
 * GIVEN argument that matches nothing never falls back to "the single pending item", and a decision the
 * words do not state is never assumed (R2-24); a goal-state command uses its own verb's target (R2-23).
 */
function resolveMutatingTarget(ctx: ApiContext, u: CompanyUniverse, command: Extract<FounderIntent, { kind: 'MUTATING' }>): { intent: MutatingIntent; payload: Json; summary: string } | null {
  const { intent, argument, amount, decision } = command;
  switch (intent) {
    case 'APPROVAL_DECIDE': {
      if (decision === null) return null;
      const pending = ctx.runtime.governance.listApprovals('PENDING').filter((a) => a.risk !== 'R4' && a.risk !== 'R2');
      const a = single(argument !== null ? pending.filter((x) => x.id === argument || (x.workItemId !== null && u.work.some((w) => w.id === x.workItemId && norm(w.objective).includes(norm(argument))))) : pending);
      if (!a) return null;
      const subject = a.workItemId !== null ? (u.work.find((w) => w.id === a.workItemId)?.objective ?? a.subjectRef) : a.subjectRef;
      return { intent, payload: { approvalId: a.id, decision, reasonCode: 'founder.decided' }, summary: `${decision === 'REJECT' ? 'Reject' : 'Approve'} the ${a.risk} approval request for: ${subject}` };
    }
    case 'GOAL_APPROVE': {
      const g = single(matchGoals(u, argument ?? '').filter((x) => x.kind === 'COMPANY' && x.state === 'PROPOSED'));
      if (!g) return null;
      return { intent, payload: { goalId: g.id, activate: true, reasonCode: 'goal.approved' }, summary: `Approve and activate the company goal: ${g.title}` };
    }
    case 'GOAL_STATE': {
      const to = command.goalState;
      const g = single(matchGoals(u, argument ?? ''));
      if (!g || to === null) return null;
      return { intent, payload: { goalId: g.id, to, reasonCode: 'goal.state' }, summary: `${GOAL_STATE_VERB[to] ?? 'Change the goal'}: ${g.title}` };
    }
    case 'BUDGET_CEILING': {
      const e = single(matchEmployees(u, argument ?? ''));
      if (!e || amount === null) return null;
      const budgetId = ctx.runtime.founder.actions.employeeBudgetId(e.id);
      if (budgetId === null) return null;
      const b = ctx.runtime.governance.budgetFor('EMPLOYEE', e.id);
      // Money is stored in micro-units of the envelope's currency; a stated ceiling maps 1:1 to that currency.
      const capMoney = amount.value * 1_000_000;
      const verb = b === null || capMoney > b.capMoney ? 'Raise' : capMoney < b.capMoney ? 'Lower' : 'Keep';
      return { intent, payload: { budgetId, capMoney, capTokens: b?.capTokens ?? 0, currency: amount.currency, reasonCode: 'founder.ceiling' }, summary: `${verb} the budget ceiling of ${nameOf(u, e.id)} to ${amount.currency} ${amount.value.toLocaleString('en-GB')}` };
    }
    case 'STAFFING_DECIDE': {
      if (decision === null) return null;
      const rs = ctx.runtime.org.organization.staffingRequests('RECOMMENDED');
      const want = named(argument, STAFFING_NOISE);
      const r = single(want === '' ? rs : rs.filter((x) => x.id === want || norm(x.positionTitle).includes(want)));
      if (!r) return null;
      return { intent, payload: { requestId: r.id, decision, reasonCode: 'founder.decided' }, summary: `${decision === 'REJECT' ? 'Reject' : 'Approve'} the staffing request: ${r.positionTitle}` };
    }
    case 'CONFLICT_RESOLVE': {
      if (decision === null) return null;
      const cs = ctx.runtime.org.review.conflicts('OPEN');
      const want = named(argument, CONFLICT_NOISE);
      const objectiveOf = (requestId: Id): string => {
        const wid = ctx.runtime.org.review.request(requestId).workItemId;
        return norm(u.work.find((w) => w.id === wid)?.objective ?? '');
      };
      const c = single(want === '' ? cs : cs.filter((x) => x.id === want || objectiveOf(x.requestId).includes(want)));
      if (!c) return null;
      return { intent, payload: { conflictId: c.id, resolution: decision === 'REJECT' ? 'REWORK' : 'PASS', reasonCode: 'founder.resolved' }, summary: `Resolve the review conflict ${decision === 'REJECT' ? 'with rework' : 'as passed'}` };
    }
    case 'GOAL_PROPOSE':
    case 'DELEGATE_WORK':
    case 'TOOL_RECONCILE':
    case 'RESERVATION_RECONCILE':
    case 'JOB_RECONCILE':
    case 'REVIEW_ESCALATION_RESOLVE':
    case 'SYSTEMIC_DECIDE':
    case 'ATTRIBUTION_DECIDE':
    case 'LESSON_DECIDE':
    case 'OUTCOME_VERIFY':
    case 'PROMOTION_DECIDE':
    case 'SOURCE_REGISTER':
    case 'SOURCE_DECIDE':
    case 'EVIDENCE_BIND':
    case 'EVIDENCE_UNBIND':
    case 'OUTCOME_CONTEST_RESOLVE':
    case 'PILOT_CREATE':
    case 'PILOT_ADVANCE':
    case 'PROVIDER_PROVISION':
    case 'EMPLOYEE_HIRE':
    case 'EMPLOYEE_LIFECYCLE':
    case 'EMPLOYEE_MODEL_ACCESS':
    case 'SKILL_PACKAGE_QUALIFY':
    case 'ACADEMY_PACKAGE_INSTALL':
    case 'ACADEMY_ENROLL':
    case 'ACADEMY_MODULES_COMPLETE':
    case 'ACADEMY_ATTEMPT_START':
    case 'ACADEMY_EVALUATE':
    case 'ACADEMY_RETRAIN_COMPLETE':
    case 'ACADEMY_SHADOW_ASSIGN':
    case 'ACADEMY_PROBATION_EVIDENCE':
    case 'ACADEMY_PROBATION_REVIEW':
    case 'ACADEMY_CALIBRATION':
    case 'ACTIVATION_DECIDE':
    case 'EMPLOYEE_REASONING_PROFILE':
    case 'WORK_ITEM_REASONING_OVERRIDE':
    case 'ACADEMY_FOUNDER_FEEDBACK':
      // Structured only (a form or a rail action posts IDs / codes), never free text (D-C5-07, R2-21, C7-A, C7-C, L1-01, L1-02).
      return null;
  }
}

const GOAL_STATE_VERB: Readonly<Record<string, string>> = { PAUSED: 'Pause the goal', CANCELLED: 'Cancel the goal', ACHIEVED: 'Mark the goal achieved', ACTIVE: 'Activate the goal', APPROVED: 'Approve the goal', SUPERSEDED: 'Supersede the goal' };

/** The sentence a structured preview shows: what will happen at the real boundary (from the validated payload only). */
export function structuredSummary(ctx: ApiContext, preview: { intentKind: string; payload: Record<string, unknown> }): string {
  const p = preview.payload;
  const s = (k: string): string => String(p[k] ?? '');
  switch (preview.intentKind) {
    case 'APPROVAL_DECIDE': {
      // C7-B: a Company → App control is stated as the exact reviewed act it is, and as Company desired state only.
      if (p.controlFamily !== undefined) {
        const verb = p.decision === 'REJECT' ? 'Reject' : 'Approve and issue';
        return `${verb} the R3 Company control ${s('controlFamily')} ${s('controlOperation')} ${s('controlValue')} on ${s('controlScope')} (now: ${s('controlFrom')}; reason: ${s('controlReason')}; independently reviewed). Issued is Company desired state, not applied in the App; a control only restricts and grants no Product authority`;
      }
      const a = ctx.runtime.governance.getApproval(s('approvalId') as Id);
      const subject = a.workItemId !== null ? (ctx.runtime.founder.universe().work.find((w) => w.id === a.workItemId)?.objective ?? a.subjectRef) : a.subjectRef;
      return `${p.decision === 'REJECT' ? 'Reject' : 'Approve'} the ${a.risk} approval request for: ${subject}`;
    }
    case 'GOAL_APPROVE':
      return `Approve${p.to === 'ACTIVE' ? ' and activate' : ''} the company goal: ${s('title')}`;
    case 'GOAL_STATE':
      return `${GOAL_STATE_VERB[s('to')] ?? 'Change the goal'}: ${s('title')}`;
    case 'GOAL_PROPOSE':
      return `Propose the ${p.kind === 'DEPARTMENT' ? 'department' : 'company'} goal: ${s('title')}`;
    case 'STAFFING_DECIDE':
      return `${p.decision === 'REJECT' ? 'Reject' : 'Approve'} the staffing request`;
    case 'CONFLICT_RESOLVE':
      return `Resolve the review conflict ${p.resolution === 'REWORK' ? 'with rework' : 'as passed'}`;
    case 'BUDGET_CEILING': {
      // P1-UX-BUDGET-DARK-01: the envelope is named and the change stated from → to, so a Company ceiling can never be
      // mistaken for a person's.
      const b = ctx.runtime.governance.budget(s('budgetId') as Id);
      const money = (m: number): string => `${b.currency} ${(m / 1_000_000).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const change = `from ${money(b.capMoney)} to ${money(Number(p.capMoney))}`;
      if (b.scope === 'COMPANY') return `Change the COMPANY budget ceiling ${change}. Only the Company envelope changes: its token ceiling, what is spent and reserved, and every other envelope stay as they are`;
      if (b.scope === 'EMPLOYEE') return `Change the budget ceiling of ${nameOf(ctx.runtime.founder.universe(), b.scopeId as Id)} ${change}`;
      return `Change the ${b.scope === 'DEPARTMENT' ? 'Department' : 'Work Item'} budget ceiling ${change}`;
    }
    case 'DELEGATE_WORK':
      return 'Delegate authority for a bounded time';
    case 'TOOL_RECONCILE':
      return p.outcome === 'CONFIRMED_SUCCEEDED'
        ? 'Record that the uncertain external effect DID happen: it is never repeated, and its held money is settled'
        : 'Record that the uncertain external effect did NOT happen: the resumed work may retry it under the same key, and its held money is released';
    case 'RESERVATION_RECONCILE':
      return p.decision === 'CHARGE' ? `Charge the held reservation with the provider-reported usage (${s('inputTokens')} input, ${s('outputTokens')} output tokens)` : 'Release the held reservation: nothing was billed';
    case 'JOB_RECONCILE':
      return p.decision === 'CONFIRMED_COMPLETED' ? 'Record that the held work completed' : p.decision === 'RETRY' ? 'Retry the held work' : 'Record that the held work failed';
    case 'REVIEW_ESCALATION_RESOLVE':
      return p.decision === 'PASS' ? 'Pass the escalated review' : 'Send the escalated review back for rework';
    case 'SYSTEMIC_DECIDE':
      return p.decision === 'VALIDATE' ? 'Validate the systemic finding' : p.decision === 'REJECT' ? 'Reject the systemic finding' : 'Mark the systemic finding addressed';
    case 'ATTRIBUTION_DECIDE':
      return `${p.decision === 'VALIDATE' ? 'Validate' : 'Reject'} the proposed cause of the outcome`;
    case 'LESSON_DECIDE':
      return `${p.decision === 'VALIDATE' ? 'Validate' : 'Reject'} the lesson`;
    case 'OUTCOME_VERIFY':
      return `Record the verified outcome: ${s('verdict').toLowerCase().replace('_', ' ')}`;
    case 'PROMOTION_DECIDE':
      return `${p.decision === 'APPROVE' ? 'Approve' : 'Reject'} sharing the lesson`;
    case 'SOURCE_REGISTER':
      return `Register the governed ${s('family').toLowerCase().replace('_', ' ')} source ${s('sourceKey')} (contract ${s('contractCode')} v${s('contractVersion')}); it is trusted by nothing until activated`;
    case 'SOURCE_DECIDE':
      return p.decision === 'ACTIVATE' ? `Activate the source ${s('sourceKey')}: its accepted records may become evidence` : p.decision === 'SUSPEND' ? `Suspend the source ${s('sourceKey')}: no new evidence from it is used; its history is kept` : `Retire the source ${s('sourceKey')} (final)`;
    case 'EVIDENCE_BIND':
      return `Bind the external record as ${p.role === 'DEPENDENCY_FAILURE' ? 'a dependency failure' : 'outcome evidence'} of the ${p.subjectKind === 'GOAL' ? 'goal' : 'work item'} (evidence, not a verdict)`;
    case 'EVIDENCE_UNBIND':
      return 'End the external evidence binding (its history is kept)';
    case 'OUTCOME_CONTEST_RESOLVE':
      return p.decision === 'UPHOLD'
        ? `Uphold the contested ${s('verdict').toLowerCase().replace('_', ' ')} verification: it counts as current truth again despite the evidence conflict`
        : p.decision === 'REPLACE'
          ? `Replace the contested ${s('verdict').toLowerCase().replace('_', ' ')} verification with a re-verification on the cited evidence (the contested one stays history)`
          : 'Retract the contested verification: the work item has no current verified outcome (history is kept)';
    case 'PILOT_CREATE':
      return `Create the ${p.mode === 'CONTROLLED_REAL' ? 'controlled real-world' : 'internal training'} pilot: ${s('title')} (a draft context; it grants no budget, tool, role or authority)`;
    case 'PROVIDER_PROVISION': {
      // L1-01: the exact profile, its qualified identity, the deployments, the peak reservation rates, the egress ceiling and
      // the first bounded cap — everything the confirm registers, nothing more.
      const deployments = Array.isArray(p.deploymentCodes) ? (p.deploymentCodes as string[]).join(', ') : '';
      const cap = p.companyBudgetExists === true ? `the existing Company cap stays ${s('existingCapMoney')} micro-${s('currency')}` : `first Company cap ${s('capMoney')} micro-${s('currency')} / ${s('capTokens')} tokens (hard; no automatic top-up)`;
      // P1-CHAT-INTEL-01: an additive profile adds deployments and route policy versions to the provisioned provider only.
      if (p.extendsProvider === true) {
        const routes = Array.isArray(p.routePolicies) ? (p.routePolicies as string[]).join(', ') : '';
        return `Add to the provisioned provider ${s('providerCode')} (${s('modelCode')} = ${s('observedPublicName')}, identity checked) the new deployments ${deployments} at ${s('qualificationTarget')}, egress up to ${s('egressMaxDataClass')}, and the route policy versions ${routes} (previous versions superseded, kept as history). No existing deployment, budget, Employee profile or authority changes; reservation rates (peak, cache miss) ${s('peakInputPerMTok')} in / ${s('peakOutputPerMTok')} out micro-${s('currency')} per MTok; ${cap}`;
      }
      return `Provision the model provider ${s('providerCode')} (${s('modelCode')} = ${s('observedPublicName')}, identity checked) with deployments ${deployments} at ${s('qualificationTarget')}, egress up to ${s('egressMaxDataClass')}; reservation rates (peak, cache miss) ${s('peakInputPerMTok')} in / ${s('peakOutputPerMTok')} out micro-${s('currency')} per MTok (cached input ${s('peakCachedInputPerMTok')}; off-peak ${s('offPeakInputPerMTok')} / ${s('offPeakOutputPerMTok')}; basis ${s('pricingBasisDate')}); ${cap}`;
    }
    // --- L1-02: the activation acts, stated as exactly what the canonical store will do (nothing more) ---
    case 'EMPLOYEE_HIRE':
      return `Hire ${s('givenName')} ${s('familyName')}${p.displayNameAr ? ` (${s('displayNameAr')})` : ''} into the seat ${s('positionTitle')} (${s('roleRef')}) as a CANDIDATE — not active, no authority, no budget; cognitive profile ${s('defaultClass')}..${s('ceilingClass')}; portrait pending. The Academy alone decides activation`;
    case 'EMPLOYEE_LIFECYCLE':
      return `Move ${s('name')} from ${s('from')} to ${s('to')} (a trainee step; ACTIVE comes only from the Academy's activation decision)`;
    case 'EMPLOYEE_MODEL_ACCESS':
      return `${p.envelopeExists === true ? 'Keep' : 'Open'} ${s('name')}'s hard envelope of ${s('capMoney')} micro-${s('currency')} and grant model access (R0, up to ${s('dataClassCeiling')}) for: ${Array.isArray(p.taskClasses) ? (p.taskClasses as string[]).join(', ') : ''}. No tools, no external effect`;
    case 'SKILL_PACKAGE_QUALIFY':
      // D-L1-23: a BQM-2 qualification states its method, its fixed class, its observation count and its enforced bounds.
      if (p.benchmarkMethod === 'BQM-2' && p.qualification !== 'FINALIZE_SCORES') return `${p.qualification === 'QUALIFY' ? 'Register and qualify' : `Finalize ${s('scoresToFinalize')} finished benchmark observations (deterministic, never re-run) and re-run the void observations of`} the Academy package ${s('packageCode')} v${s('packageVersion')} (digest ${s('packageSha256').slice(0, 12)}…) under benchmark method BQM-2 (declaration ${s('methodSha256').slice(0, 12)}…, rubric ${s('rubricVersion')}, ANSWER contract ${s('answerContractVersion')} ${s('answerContractSha256').slice(0, 12)}…): inspection, licence check, the deterministic static security review, then ${s('benchmarkRuns')} bounded benchmark observations — ${s('observationsPerArm')} per case and arm, every one at the fixed reasoning class ${s('reasoningClass')} (each delivers only one ANSWER: any other proposal is never executed and counts as an invalid output; one same-class retry after an invalid output; two invalid outputs fail the observation) — each capped at ${s('perRunCapMicros')} micro-units and at a hard maximum of ${s('maxModelCallsPerObservation')} model calls; the enforced cap bound on the total is ${s('totalCapBoundMicros')} micro-units and the hard stop is the Employee envelope (${s('envelopeRemainingMicros')} micro-units remaining): exhausting it leaves the package incomplete, never overspent, and no budget is raised. Nothing is approved here${Array.isArray(p.reusedSkills) && p.reusedSkills.length > 0 ? `. Reused qualified Skill Versions (no new version, no review, no benchmark — their own evidence, bound by fingerprint): ${(p.reusedSkills as string[]).join('; ')}; only ${Array.isArray(p.newlyQualifiedSkills) ? (p.newlyQualifiedSkills as string[]).join(', ') : ''} qualify new versions` : ''}`;
      if (p.qualification === 'FINALIZE_SCORES') return `Finalize the deterministic benchmark scores of the Academy package ${s('packageCode')} v${s('packageVersion')} (digest ${s('packageSha256').slice(0, 12)}…): ${s('scoresToFinalize')} finished, answered benchmark runs become durable SCORED evidence with the deterministic rubric — a failed case stays failed and is never re-run. Creates 0 benchmark runs and makes 0 paid provider calls; nothing is approved or installed`;
      return `${p.qualification === 'QUALIFY' ? 'Register and qualify' : `Finalize ${s('scoresToFinalize')} finished benchmark scores (deterministic, never re-run) and re-run the void benchmark cases of`} the Academy package ${s('packageCode')} v${s('packageVersion')} (digest ${s('packageSha256').slice(0, 12)}…): inspection, licence check, the deterministic static security review, then ${s('benchmarkRuns')} bounded benchmark runs (with / without each skill), each capped at ${s('perRunCapMicros')} micro-units; the hard bound on the total is the Employee envelope (${s('envelopeRemainingMicros')} micro-units remaining). Nothing is approved here`;
    case 'ACADEMY_PACKAGE_INSTALL':
      return `Install the qualified Academy package ${s('packageCode')} v${s('packageVersion')} (digest ${s('packageSha256').slice(0, 12)}…): approve its Skill versions on their own evidence, publish the ${s('roleRef')} blueprint and program (${s('scenarios')}; calibration ${p.founderCalibrationRequired === true ? 'required' : 'not required'}). This authorizes the install; it asserts no test result`;
    case 'ACADEMY_ENROLL':
      return `Enroll ${s('name')} in the ${s('roleRef')} program and open ${s('passports')} LEARNING skill passports (training, not authority)`;
    case 'ACADEMY_MODULES_COMPLETE':
      return `Record the trainer acknowledgement of ${Array.isArray(p.moduleCodes) ? (p.moduleCodes as string[]).length : 0} curriculum module(s); the learning path advances only as far as the evidence allows`;
    case 'ACADEMY_ATTEMPT_START':
      return `Start the ${s('attemptKind').toLowerCase()} attempt on ${s('scenarioKind').toLowerCase()} scenario ${s('scenarioCode')}: one bounded run (cap ${s('capMicros')} micro-units, output ${s('maxOutputTokens')} tokens, task class ${s('taskClass')}), constrained authority, no external effect`;
    case 'ACADEMY_EVALUATE':
      return p.answered === true ? `Record your evaluator scores (${Array.isArray(p.scores) ? (p.scores as string[]).join(', ') : ''}); authority compliance and cost discipline come from run facts, never from you or the model` : 'Close the unanswered attempt through the deterministic rubric (void, or failed on a refusal) — nothing to score';
    case 'ACADEMY_RETRAIN_COMPLETE':
      return `Record that the targeted retraining is done (${Array.isArray(p.categories) ? (p.categories as string[]).join(', ') : ''}); the trainee is re-tested next`;
    case 'ACADEMY_SHADOW_ASSIGN':
      return `Assign the shadow work "${s('objective')}" (internal, no external effect, cap ${s('capMicros')} micro-units)`;
    case 'ACADEMY_PROBATION_EVIDENCE':
      return `Record probation evidence on the shadow work — positive: ${Array.isArray(p.positive) ? (p.positive as string[]).join(', ') || 'none' : 'none'}; negative: ${Array.isArray(p.negative) ? (p.negative as string[]).join(', ') || 'none' : 'none'}`;
    case 'ACADEMY_PROBATION_REVIEW':
      return `Decide the probation review: ${s('decision')} (PASS needs the program's evidence; certification follows only from complete evidence and is not activation)`;
    case 'ACADEMY_CALIBRATION':
      return `${p.decision === 'APPROVE' ? 'Approve' : 'Reject'} the Founder Calibration (evidence: ${Array.isArray(p.evidenceRefs) ? (p.evidenceRefs as string[]).length : 0} item(s))`;
    case 'ACTIVATION_DECIDE':
      return p.decision === 'APPROVE' ? `Activate ${s('name')} (${s('roleRef')}): the Academy activation gate re-checks the valid certification, the passed probation and the approved calibration. Activation grants no authority beyond explicit grants` : `Reject the activation of ${s('name')} (the enrollment closes; its evidence stays)`;
    // --- D-L1-44: Employee Reasoning Control (reasoning is not authority) ---
    case 'EMPLOYEE_REASONING_PROFILE': {
      const due = Array.isArray(p.certificationsReviewDue) ? (p.certificationsReviewDue as string[]).length : 0;
      // P1-REASON-AUTO-RECOVERY-01: the selection (AUTO / DEFAULT) is named whenever it changes.
      const sel = p.previousSelection !== undefined && p.previousSelection !== p.newSelection ? ` Level selection ${s('previousSelection')} → ${s('newSelection')}: ${p.newSelection === 'AUTO' ? 'each task starts at the lowest level the governed AUTO policy judges sufficient, within the ceiling, the route and what is provisioned (AUTO is not a fifth level; a level you choose for a message still wins)' : 'each task starts at the default'}.` : '';
      return `Change ${s('name')}'s standing reasoning profile: default ${s('previousDefault')} → ${s('newDefault')}, ceiling ${s('previousCeiling')} → ${s('newCeiling')}; cost discipline ${s('costDiscipline')} unchanged.${sel} Future work without a one-task override starts from the new ${p.newSelection === 'AUTO' ? 'selection' : 'default'}. A material change: ${due} valid certification(s) become REVIEW_DUE. No authority, tool, data, approval or budget change; no provider call`;
    }
    case 'WORK_ITEM_REASONING_OVERRIDE':
      return `Run this one Work Item (${s('workItemId').slice(0, 8)}…, ${s('taskClass')}) for ${s('name')} at ${s('requestedClass')} (routes at ${s('effectiveClass')}; standing default ${s('employeeDefault')}, ceiling ${s('employeeCeiling')}; route policy max ${s('routePolicyMaxClass')}${p.deploymentAvailable === true ? '' : '; no deployment of that class is provisioned now — the run cannot route until one is'}). This Work Item only: the persistent profile, authority, tools, data and budget are unchanged, and the worst case of the class is reserved before any call`;
    case 'ACADEMY_FOUNDER_FEEDBACK':
      return `Record your feedback (${s('feedbackBytes')} bytes) on ${s('name')}'s ${s('attemptKind').toLowerCase()} #${s('trial')} (${s('scenarioCode')}, ${s('outcome')}), bound to that attempt's recorded answer. It is added, never rewritten: the attempt, its answer and its scores stand as decided. The trainee's later Academy attempts carry it in their context; production work does not. No authority, budget or provider call`;
    case 'PILOT_ADVANCE': {
      const step: Record<string, string> = {
        BRIEFING: 'Start the pilot briefing with the CEO (a conversation; it decides nothing)',
        READY: `Mark the pilot ready: the CEO answered ${s('answeredBriefingRequests')} briefing request(s)${Number(p.unansweredBriefingRequests) > 0 ? `, ${s('unansweredBriefingRequests')} still unanswered (silence is not agreement)` : ''}. Execution still starts only on an approved goal`,
        ACTIVE: 'Activate the pilot on its approved root company goal (work runs through the existing Goals, Work and Review; nothing is granted)',
        REVIEWING: 'Move the pilot to review: look at the evidence before deciding',
        COMPLETED: 'Complete the pilot (your decision; the evidence is advisory and stays as history)',
        STOPPED: 'Stop the pilot (final; its history is kept)',
      };
      return step[s('to')] ?? 'Move the pilot';
    }
    default:
      return preview.intentKind;
  }
}

/** A structured preview (a rail action or a form): IDs / codes only, validated at the store; never a mutation. */
export function createPreview(ctx: ApiContext, body: Json): Json {
  const preview = ctx.runtime.founder.actions.preview(ctx.session, body.intent, body.payload);
  return { preview: { ...preview, summary: structuredSummary(ctx, preview) } };
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
    // P1-CHAT-INTEL-01: the level for this message's reply only (a durable one-task override, refused above the ceiling or
    // the route policy) and the client's idempotency key (a repeated send returns the recorded message, never a second one).
    const out = ctx.runtime.founder.communications.send(founderRef, str(threadId, 'threadId', 36), {
      purpose: purpose as never,
      body: text,
      ...(typeof body.responseRequired === 'boolean' ? { responseRequired: body.responseRequired } : {}),
      ...(optStr(body.attentionLevel) ? { attentionLevel: body.attentionLevel as never } : {}),
      ...(body.reasoningClass !== undefined && body.reasoningClass !== null ? { reasoningClass: str(body.reasoningClass, 'reasoningClass', 2) } : {}),
      ...(body.clientKey !== undefined && body.clientKey !== null ? { clientKey: str(body.clientKey, 'clientKey', 64) } : {}),
    });
    return { message: out.message, replyWorkItemId: out.replyWorkItemId, replayed: out.replayed === true };
  });
}

export function dismissAttention(ctx: ApiContext, itemId: string, body: Json): Json {
  return ctx.runtime.founder.auth.withSession(ctx.session, (founderRef) => ({ item: ctx.runtime.founder.attention.dismiss(founderRef, str(itemId, 'itemId', 36), optStr(body.reasonCode) ?? 'founder.dismissed') }));
}

export function proposeGoal(ctx: ApiContext, body: Json): Json {
  const preview = ctx.runtime.founder.actions.preview(ctx.session, 'GOAL_PROPOSE', body);
  return { preview: { ...preview, summary: structuredSummary(ctx, preview) } };
}

/** Departments and employees for forms (a read; the universe already carries them, this is the compact form list). */
export function directory(ctx: ApiContext): Json {
  return { departments: ctx.runtime.org.organization.departments(), employees: ctx.runtime.governance.listEmployees().map((e) => ({ id: e.id, name: e.name, state: e.state, roleRef: e.roleRef })) };
}
