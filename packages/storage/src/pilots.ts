/**
 * PilotStore — C7-C Pilot Instrumentation (D-C7C-02 … D-C7C-08).
 *
 * A Pilot is a durable, Founder-decided CONTEXT over the canonical Company systems:
 * - its identity, mode and forward-only lifecycle (DRAFT → BRIEFING → READY → ACTIVE → REVIEWING → COMPLETED, STOPPED
 *   from any non-terminal state) with append-only history — every step a Founder act through the chokepoint (and, in
 *   production, the governed confirmation); no metric, message or Employee ever moves it;
 * - ONE binding to its primary Founder ↔ CEO briefing thread (an existing C5 thread — no message body is copied) and
 *   ONE binding to its root Company Goal (an existing, Founder-approved C5 Goal — never created or approved here).
 *
 * Everything else is DERIVED, never stored: the Pilot's scope is root Goal → its derived Department Goals → their live
 * Goal → Work links → the lineage of that work; the Evidence Board reads Work, reviews, delegation, C6 evaluations,
 * attributions, learning and economics, C7-A evidence and C7-B proposals from their own tables and reuses the C6
 * kernel (Performance Profile, cost per qualified outcome) on that scope. No score, rank, leaderboard or blended
 * number exists anywhere; readiness is an advisory checklist (`@qandeel-company/mind` pilot-evidence).
 *
 * Rule A: audit rows carry ids, states and codes only — never the Pilot title, a message body or Goal text.
 */
import { QandeelError, assertCode, assertId, boundedText, newId, type Id } from '@qandeel-company/domain';
import { BRIEFING_REQUEST_PURPOSES, TERMINAL_PILOT_STATES, assertPilotTransition, isPilotMode, isPilotState, type PilotMode, type PilotState } from '@qandeel-company/governance';
import {
  assessReadiness, buildPerformanceProfile, classifyAutonomy, containsSecretMaterial, costPerQualifiedOutcome, dimensionOf, localizeFailure, marketClaimOf, pilotScopedFact,
  type AutonomyClass, type DimensionProfile, type DimensionVerdict, type FailureLocalization, type LearningEffect, type ReadinessItem,
} from '@qandeel-company/mind';

import { getThread, txOpenThread } from './communications.js';
import { boundEvidence, externalAvailability, verificationExternalRefs } from './external-core.js';
import { founder, founderAdminWrite } from './governance.js';
import { getGoal } from './goals.js';
import { PATTERN_OUTCOME_CURRENT } from './improvement.js';
import { attributionFacts, gatherWorkEvidence, latestVerdict, liveEvaluations } from './improvement-core.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { storeContext, type CompanyStore } from './store.js';

export interface PilotRecord {
  readonly id: Id;
  readonly mode: PilotMode;
  /** Company content under the Founder's access scope (never in audit / events / logs). */
  readonly title: string;
  readonly requiresExternalOutcome: boolean;
  readonly state: PilotState;
  readonly briefingThreadId: Id | null;
  readonly rootGoalId: Id | null;
  readonly createdByRef: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly activatedAt: string | null;
  readonly closedAt: string | null;
}

export interface PilotHistoryRecord {
  readonly pilotId: Id;
  readonly version: number;
  readonly fromState: PilotState | null;
  readonly toState: PilotState;
  readonly reasonCode: string;
  readonly actorRef: string;
  readonly occurredAt: string;
}

export interface CreatePilotInput {
  readonly mode: PilotMode;
  readonly title: string;
  readonly requiresExternalOutcome?: boolean;
}

export interface AdvancePilotInput {
  readonly to: PilotState;
  readonly reasonCode: string;
  /** BRIEFING: an existing open Founder ↔ CEO thread to bind (omitted → a new one is opened for this Pilot). */
  readonly threadId?: string;
  /** ACTIVE: the root Company Goal (Founder-approved, ACTIVE, with success criteria). */
  readonly goalId?: string;
}

type Row = Record<string, string | number | bigint | null | Uint8Array>;
const str = (v: unknown): string => String(v);
const opt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function mapPilot(r: Row): PilotRecord {
  return {
    id: str(r.id) as Id, mode: r.mode as PilotMode, title: str(r.title), requiresExternalOutcome: r.requires_external_outcome === 1, state: r.state as PilotState,
    briefingThreadId: opt(r.briefing_thread_id) as Id | null, rootGoalId: opt(r.root_goal_id) as Id | null, createdByRef: str(r.created_by_ref), version: Number(r.version),
    createdAt: str(r.created_at), updatedAt: str(r.updated_at), activatedAt: opt(r.activated_at), closedAt: opt(r.closed_at),
  };
}

const mapHistory = (r: Row): PilotHistoryRecord => ({ pilotId: str(r.pilot_id) as Id, version: Number(r.version), fromState: opt(r.from_state) as PilotState | null, toState: r.to_state as PilotState, reasonCode: str(r.reason_code), actorRef: str(r.actor_ref), occurredAt: str(r.occurred_at) });

export function getPilot(ctx: StoreContext, id: Id): PilotRecord {
  const r = ctx.db.get<Row>('SELECT * FROM pilots WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'pilot not found', { pilotId: id });
  return mapPilot(r);
}

/** One JSON parameter for an id set (`IN (SELECT value FROM json_each(?))`). */
const idsParam = (ids: readonly string[]): string => JSON.stringify(ids);
const IN_SET = `(SELECT value FROM json_each(?))`;
const n = (v: unknown): number => Number(v ?? 0);

// --- Briefing evidence ---------------------------------------------------------------------------------------------

export interface BriefingStatus {
  readonly threadId: Id | null;
  /** Founder REQUEST / QUESTION / DECISION_REQUEST messages that required a governed response and got one. */
  readonly answered: readonly Id[];
  /** Such requests still awaiting their governed reply (never consent, never READY evidence). */
  readonly pending: readonly Id[];
  /** Whether the READY gate's conversation evidence exists (proof that a conversation happened, not of its quality). */
  readonly conversationEvidenced: boolean;
}

export function txBriefingStatus(ctx: StoreContext, threadId: Id | null): BriefingStatus {
  if (threadId === null) return { threadId, answered: [], pending: [], conversationEvidenced: false };
  const rows = ctx.db.all<{ id: string; answered: number }>(
    `SELECT m.id, EXISTS (SELECT 1 FROM communication_messages r JOIN runs x ON x.id = r.run_id
                           WHERE r.thread_id = m.thread_id AND r.seq > m.seq AND r.sender_kind = 'EMPLOYEE' AND x.work_item_id = m.reply_work_item_id) AS answered
       FROM communication_messages m
      WHERE m.thread_id = ? AND m.sender_kind = 'FOUNDER' AND m.response_required = 1 AND m.reply_work_item_id IS NOT NULL
        AND m.purpose IN (SELECT value FROM json_each(?))
      ORDER BY m.seq`,
    threadId, idsParam(BRIEFING_REQUEST_PURPOSES),
  );
  const answered = rows.filter((r) => r.answered === 1).map((r) => r.id as Id);
  return { threadId, answered, pending: rows.filter((r) => r.answered !== 1).map((r) => r.id as Id), conversationEvidenced: answered.length > 0 };
}

// --- Scope (derived from canonical Goal → Work truth) ------------------------------------------------------------

export interface PilotScope {
  readonly rootGoalId: Id | null;
  readonly derivedGoalIds: readonly Id[];
  /** Work Items linked (live) to the root or a derived Goal. */
  readonly linkedWorkItemIds: readonly Id[];
  /** Linked work plus its canonical lineage (children / delegated sub-work), bounded. */
  readonly workItemIds: readonly Id[];
}

export const PILOT_SCOPE_CAP = 2000;

export function txPilotScope(ctx: StoreContext, p: PilotRecord): PilotScope {
  if (p.rootGoalId === null) return { rootGoalId: null, derivedGoalIds: [], linkedWorkItemIds: [], workItemIds: [] };
  const derived = ctx.db.all<{ id: string }>(`SELECT id FROM goals WHERE kind = 'DEPARTMENT' AND parent_goal_id = ? ORDER BY created_at, id`, p.rootGoalId).map((r) => r.id as Id);
  const goals = [p.rootGoalId, ...derived];
  const linked = ctx.db.all<{ w: string }>(`SELECT DISTINCT work_item_id AS w FROM goal_work_links WHERE goal_id IN ${IN_SET} AND ended_at IS NULL ORDER BY work_item_id`, idsParam(goals)).map((r) => r.w as Id);
  const all = ctx.db.all<{ id: string }>(
    `WITH RECURSIVE lineage(id) AS (SELECT value FROM json_each(?) UNION SELECT w.id FROM work_items w JOIN lineage l ON w.parent_id = l.id)
     SELECT id FROM lineage ORDER BY id LIMIT ${PILOT_SCOPE_CAP}`,
    idsParam(linked),
  ).map((r) => r.id as Id);
  return { rootGoalId: p.rootGoalId, derivedGoalIds: derived, linkedWorkItemIds: linked, workItemIds: all };
}

// --- The Evidence Board (a projection; nothing here is stored) --------------------------------------------------------

export interface PilotPeopleEvidence {
  readonly employeeId: Id;
  /** The eight C6 dimensions exactly, on Pilot-scoped canonical evaluation facts (C6 sample / confidence / attribution rules). */
  readonly dimensions: readonly DimensionProfile[];
  readonly economics: ReturnType<typeof costPerQualifiedOutcome>;
  /** Observability only — never performance. */
  readonly observability: { readonly workItems: number; readonly messages: number; readonly toolCalls: number; readonly tokens: number; readonly runs: number };
}

export interface PilotBoard {
  readonly pilot: PilotRecord;
  readonly at: string;
  readonly briefing: BriefingStatus;
  readonly scope: { readonly rootGoal: { readonly id: Id; readonly state: string; readonly successCriteria: number } | null; readonly derivedGoalIds: readonly Id[]; readonly linkedWork: number; readonly workItems: number; readonly capped: boolean };
  readonly outcomes: {
    readonly lifecycle: Readonly<Record<string, number>>;
    readonly qualifiedOutcomes: number;
    readonly underReview: number;
    readonly rework: number;
    readonly blocked: number;
    readonly failed: number;
    readonly contested: number;
    readonly notAchieved: number;
    readonly completedNotVerified: number;
  };
  readonly reviewIntegrity: { readonly required: Readonly<Record<string, number>>; readonly independentDecisions: number; readonly makerSelfDecisions: number; readonly openConflicts: number; readonly resolvedConflicts: number; readonly refs: readonly string[] };
  readonly founderAttention: { readonly openItems: readonly { readonly id: Id; readonly sourceKind: string; readonly sourceRef: string; readonly level: string }[] };
  readonly decisionsNeeded: readonly string[];
  readonly people: readonly PilotPeopleEvidence[];
  readonly autonomy: { readonly dimensions: readonly ['JUDGMENT', 'INDEPENDENCE']; readonly classes: Readonly<Record<AutonomyClass, number>>; readonly refs: Readonly<Record<AutonomyClass, readonly string[]>> };
  readonly collaboration: { readonly departments: number; readonly ownersWithoutAccountability: number; readonly delegations: Readonly<Record<string, number>>; readonly crossDepartmentHandoffs: number; readonly unresolvedHandoffs: number; readonly refs: readonly string[] };
  readonly learning: { readonly signals: Readonly<Record<string, number>>; readonly validatedLessons: number; readonly interventions: Readonly<Record<string, number>>; readonly systemicFindings: Readonly<Record<string, number>>; readonly refs: readonly string[] };
  readonly economics: ReturnType<typeof costPerQualifiedOutcome>;
  readonly external: { readonly availability: string; readonly marketClaim: string; readonly qualifiedWithCurrentExternal: number; readonly contested: number; readonly goalEvidence: number; readonly refs: readonly string[] };
  readonly controls: { readonly proposals: Readonly<Record<string, number>>; readonly refs: readonly string[]; readonly desiredStateOnly: true; readonly countsAsOutcome: false; readonly appEffectKnown: false };
  readonly readiness: readonly ReadinessItem[];
  /** Observability only (never a measure of success or collaboration quality). */
  readonly observability: { readonly briefingMessages: number; readonly workMessages: number; readonly runs: number; readonly toolCalls: number };
}

const countBy = (rows: readonly { k: string; c: number }[]): Record<string, number> => Object.fromEntries(rows.map((r) => [r.k, n(r.c)]));

/** The open Founder Attention items whose source sits inside this Pilot (no second notification bus). */
function scopedAttention(ctx: StoreContext, p: PilotRecord, scope: PilotScope): PilotBoard['founderAttention']['openItems'] {
  const work = new Set<string>(scope.workItemIds);
  const goals = new Set<string>(scope.rootGoalId === null ? [] : [scope.rootGoalId, ...scope.derivedGoalIds]);
  const workOf: Record<string, string> = {
    approval: 'SELECT work_item_id AS w FROM approvals WHERE id = ?',
    review_conflict: 'SELECT r.work_item_id AS w FROM review_conflicts c JOIN review_requests r ON r.id = c.request_id WHERE c.id = ?',
    review_request: 'SELECT work_item_id AS w FROM review_requests WHERE id = ?',
    work_delegation: 'SELECT child_work_item_id AS w FROM work_delegations WHERE id = ?',
    tool_invocation: 'SELECT work_item_id AS w FROM tool_invocations WHERE id = ?',
    budget_reservation: 'SELECT work_item_id AS w FROM budget_reservations WHERE id = ?',
    queue_job: 'SELECT work_item_id AS w FROM queue_jobs WHERE id = ?',
  };
  const inScope = (ref: string): boolean => {
    const i = ref.indexOf(':');
    const kind = ref.slice(0, i);
    const id = ref.slice(i + 1);
    if (kind === 'work_item') return work.has(id);
    if (kind === 'goal') return goals.has(id);
    if (kind === 'thread') return id === p.briefingThreadId;
    if (kind === 'message') {
      const m = ctx.db.get<{ thread_id: string; w: string | null }>('SELECT thread_id, (SELECT x.work_item_id FROM runs x WHERE x.id = run_id) AS w FROM communication_messages WHERE id = ?', id);
      return m !== undefined && (m.thread_id === p.briefingThreadId || (m.w !== null && work.has(m.w)));
    }
    const sql = workOf[kind];
    if (sql === undefined) return false;
    const w = ctx.db.get<{ w: string | null }>(sql, id)?.w ?? null;
    return w !== null && work.has(w);
  };
  return ctx.db
    .all<{ id: string; source_kind: string; source_ref: string; level: string }>(`SELECT id, source_kind, source_ref, level FROM founder_attention_items WHERE state = 'OPEN' ORDER BY first_seen_at, id`)
    .filter((a) => inScope(a.source_ref))
    .map((a) => ({ id: a.id as Id, sourceKind: a.source_kind, sourceRef: a.source_ref, level: a.level }));
}

/** The exact Founder decisions the Pilot is waiting for (codes; the Founder decides each through the governed confirmation). */
function decisionsNeeded(ctx: StoreContext, p: PilotRecord, briefing: BriefingStatus, attention: number): string[] {
  const out: string[] = [];
  switch (p.state) {
    case 'DRAFT':
      out.push('START_BRIEFING');
      break;
    case 'BRIEFING':
      if (briefing.conversationEvidenced) out.push('DECIDE_READY');
      else out.push(briefing.pending.length > 0 ? 'AWAITING_GOVERNED_REPLY' : 'ASK_CEO_A_BRIEFING_REQUEST');
      break;
    case 'READY': {
      const ready = ctx.db.get(`SELECT 1 AS x FROM goals g WHERE g.kind = 'COMPANY' AND g.state = 'ACTIVE' AND json_array_length(g.success_criteria_json) > 0 AND NOT EXISTS (SELECT 1 FROM pilots q WHERE q.root_goal_id = g.id) LIMIT 1`) !== undefined;
      out.push(ready ? 'DECIDE_ACTIVE_ON_ROOT_GOAL' : 'APPROVE_ROOT_COMPANY_GOAL_WITH_SUCCESS_CRITERIA');
      break;
    }
    case 'ACTIVE':
      if (attention > 0) out.push('DECIDE_OPEN_PILOT_ATTENTION_ITEMS');
      break;
    case 'REVIEWING':
      out.push('DECIDE_COMPLETION');
      if (attention > 0) out.push('DECIDE_OPEN_PILOT_ATTENTION_ITEMS');
      break;
    default:
      break;
  }
  return out;
}

type LiveDims = { readonly work_item_id: string; readonly employee_id: string | null; readonly dimensions_json: string; readonly id: string };

function liveDimensionRows(ctx: StoreContext, ids: readonly string[]): LiveDims[] {
  return ctx.db.all<LiveDims>(
    `SELECT e.id, e.work_item_id, e.employee_id, e.dimensions_json FROM evaluation_results e
      WHERE e.work_item_id IN ${IN_SET} AND e.superseded_by IS NULL
        AND NOT EXISTS (SELECT 1 FROM evaluation_results m WHERE m.work_item_id = e.work_item_id AND m.superseded_by IS NULL AND (m.created_at > e.created_at OR (m.created_at = e.created_at AND m.rowid > e.rowid)))
      ORDER BY e.work_item_id`,
    idsParam(ids),
  );
}

const dimsOf = (json: string): DimensionVerdict[] => JSON.parse(json) as DimensionVerdict[];

export function txPilotBoard(ctx: StoreContext, p: PilotRecord): PilotBoard {
  const at = ts(ctx);
  const scope = txPilotScope(ctx, p);
  const ids = scope.workItemIds;
  const set = idsParam(ids);
  const briefing = txBriefingStatus(ctx, p.briefingThreadId);
  const root = scope.rootGoalId === null ? null : getGoal(ctx, scope.rootGoalId);

  // Outcomes (canonical Work / Review / C6 truth).
  const lifecycle = countBy(ctx.db.all<{ k: string; c: number }>(`SELECT state AS k, COUNT(*) AS c FROM work_items WHERE id IN ${IN_SET} GROUP BY state ORDER BY state`, set));
  const evals = liveEvaluations(ctx, { workItemIds: ids });
  const verdicts = ids.map((id) => latestVerdict(ctx, id));
  const contested = verdicts.filter((v) => v !== null && v.validity === 'CONTESTED').length;
  const notAchieved = verdicts.filter((v) => v !== null && v.current && v.verdict === 'NOT_ACHIEVED').length;
  const requiredStates = countBy(ctx.db.all<{ k: string; c: number }>(`SELECT state AS k, COUNT(*) AS c FROM review_requests WHERE work_item_id IN ${IN_SET} AND kind = 'REQUIRED' GROUP BY state ORDER BY state`, set));
  const qualified = evals.filter((e) => e.qualifiedOutcome).length;

  // Review integrity (the Review Pool's own records; no shortcut).
  const decisions = ctx.db.all<{ id: string; maker: number }>(
    `SELECT d.id, (d.reviewer_ref = w.owner_ref) AS maker FROM review_decisions d JOIN review_requests r ON r.id = d.request_id JOIN work_items w ON w.id = r.work_item_id
      WHERE r.work_item_id IN ${IN_SET} AND d.counts = 1 ORDER BY d.created_at, d.id`,
    set,
  );
  const conflicts = countBy(ctx.db.all<{ k: string; c: number }>(`SELECT c.state AS k, COUNT(*) AS c FROM review_conflicts c JOIN review_requests r ON r.id = c.request_id WHERE r.work_item_id IN ${IN_SET} GROUP BY c.state`, set));

  // Collaboration / handoffs (canonical ownership and delegation; never message volume).
  const delegations = ctx.db.all<{ id: string; state: string; xdept: number }>(
    `SELECT id, state, (source_department_id IS NOT NULL AND target_department_id IS NOT NULL AND source_department_id <> target_department_id) AS xdept FROM work_delegations
      WHERE parent_work_item_id IN ${IN_SET} OR child_work_item_id IN ${IN_SET} ORDER BY created_at, id`,
    set, set,
  );
  const delegationStates = countBy([...delegations.reduce((m, d) => m.set(d.state, (m.get(d.state) ?? 0) + 1), new Map<string, number>())].map(([k, c]) => ({ k, c })));
  const departments = n(ctx.db.get<{ c: number }>(`SELECT COUNT(DISTINCT e.department_id) AS c FROM work_items w JOIN employees e ON w.owner_ref = 'employee:' || e.id WHERE w.id IN ${IN_SET} AND e.department_id IS NOT NULL`, set)?.c);
  const unowned = n(ctx.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM work_items WHERE id IN ${IN_SET} AND owner_ref NOT GLOB 'employee:*' AND owner_ref NOT GLOB 'founder:*'`, set)?.c);
  const unresolved = delegations.filter((d) => d.state === 'ESCALATED' || d.state === 'FAILED');

  // People: the C6 Performance Profile on Pilot-scoped canonical evaluation facts (never a second evaluator).
  const dimRows = liveDimensionRows(ctx, ids);
  const employees = [...new Set(dimRows.map((r) => r.employee_id).filter((e): e is string => e !== null))].sort();
  const signals = ctx.db.all<{ id: string; kind: string; observation_id: string }>(`SELECT id, kind, observation_id FROM learning_signals WHERE work_item_id IN ${IN_SET} ORDER BY created_at, id`, set);
  const observations = idsParam(signals.map((s) => s.observation_id));
  const lessons = ctx.db.all<{ id: string; employee_id: string; stage: string }>(`SELECT id, employee_id, stage FROM lessons WHERE observation_id IN ${IN_SET} ORDER BY created_at, id`, observations);
  const interventions = ctx.db.all<{ id: string; employee_id: string; kind: string; state: string; effect: string; lesson_id: string }>(`SELECT id, employee_id, kind, state, effect, lesson_id FROM learning_interventions WHERE lesson_id IN ${IN_SET} ORDER BY created_at, id`, idsParam(lessons.map((l) => l.id)));
  const findings = ctx.db.all<{ id: string; state: string; contributor_employee_id: string | null }>(`SELECT id, state, contributor_employee_id FROM systemic_findings WHERE source_signal_id IN ${IN_SET} ORDER BY created_at, id`, idsParam(signals.map((s) => s.id)));
  const scopeSet = new Set<string>(ids);
  const people: PilotPeopleEvidence[] = employees.map((employeeId) => {
    const facts = liveEvaluations(ctx, { employeeId: employeeId as Id, workItemIds: ids }).map(pilotScopedFact);
    const patterns = ctx.db.all<{ id: string }>(`SELECT l.id FROM lessons l JOIN learning_signals s ON s.observation_id = l.observation_id WHERE s.kind = 'SUCCESSFUL_PATTERN' AND l.stage = 'VALIDATED' AND l.employee_id = ? AND s.work_item_id IN ${IN_SET} AND ${PATTERN_OUTCOME_CURRENT}`, employeeId, set).map((r) => r.id);
    const reuses = ctx.db.all<{ id: string }>(`SELECT i.id FROM learning_interventions i JOIN lessons l ON l.id = i.lesson_id JOIN learning_signals s ON s.observation_id = l.observation_id WHERE i.kind = 'PATTERN_REUSE' AND i.effect = 'IMPROVEMENT_OBSERVED' AND l.employee_id = ? AND i.employee_id <> l.employee_id AND s.work_item_id IN ${IN_SET} AND ${PATTERN_OUTCOME_CURRENT}`, employeeId, set).map((r) => r.id);
    const profile = buildPerformanceProfile({
      employeeId,
      at,
      evaluations: facts,
      attributions: attributionFacts(ctx, employeeId as Id).filter((a) => scopeSet.has(a.workItemId)),
      learningEffects: interventions.filter((i) => i.employee_id === employeeId && i.kind === 'TARGETED_RETRAINING').map((i) => ({ interventionId: i.id, effect: i.effect as LearningEffect })),
      contributions: { validatedPatterns: patterns, verifiedPatternReuses: reuses, validatedSystemicFindings: findings.filter((f) => f.contributor_employee_id === employeeId && (f.state === 'VALIDATED' || f.state === 'ADDRESSED')).map((f) => f.id) },
    });
    return { employeeId: employeeId as Id, dimensions: profile.dimensions, economics: profile.economics, observability: profile.observability };
  });

  // Appropriate autonomy: JUDGMENT + INDEPENDENCE only.
  const classes = { AUTHORITY_BOUNDARY_REFUSED: 0, CORRECT_ESCALATION: 0, UNNECESSARY_DEPENDENCE_EVIDENCED: 0, ROUTINE_HANDLED_INDEPENDENTLY: 0, INSUFFICIENT_EVIDENCE: 0 } as Record<AutonomyClass, number>;
  const classRefs = { AUTHORITY_BOUNDARY_REFUSED: [], CORRECT_ESCALATION: [], UNNECESSARY_DEPENDENCE_EVIDENCED: [], ROUTINE_HANDLED_INDEPENDENTLY: [], INSUFFICIENT_EVIDENCE: [] } as Record<AutonomyClass, string[]>;
  for (const r of dimRows) {
    const c = classifyAutonomy(dimsOf(r.dimensions_json));
    classes[c] += 1;
    if (classRefs[c].length < 50) classRefs[c].push(`evaluation:${r.id}`);
  }

  // Economics: the canonical C2 / C6 ledger through C6's own cost per qualified outcome (failures and rework included).
  const economics = costPerQualifiedOutcome(evals);

  // External outcomes: C7-A current truth only.
  const qualifiedIds = new Set(evals.filter((e) => e.qualifiedOutcome).map((e) => e.workItemId));
  const externalRefs: string[] = [];
  let withExternal = 0;
  ids.forEach((id, i) => {
    const v = verdicts[i];
    if (v === null || v === undefined) return;
    if (v.validity === 'CONTESTED') externalRefs.push(`outcome_verification:${v.id}`);
    if (!v.current || v.verdict !== 'ACHIEVED' || !qualifiedIds.has(id)) return;
    const cited = verificationExternalRefs(ctx, v.id);
    if (cited.length === 0) return;
    withExternal += 1;
    externalRefs.push(`outcome_verification:${v.id}`, ...cited);
  });
  const goalEvidence = scope.rootGoalId === null ? 0 : boundEvidence(ctx, 'GOAL', scope.rootGoalId).filter((b) => b.usable).length;

  // C7-B: issued desired controls are operational context only — never an outcome, never an App effect.
  const proposals = ctx.db.all<{ id: string; state: string }>(`SELECT id, state FROM app_control_proposals WHERE work_item_id IN ${IN_SET} ORDER BY created_at, id`, set);

  const attention = scopedAttention(ctx, p, scope);
  const learningRefs = [...lessons.filter((l) => l.stage === 'VALIDATED').map((l) => `lesson:${l.id}`), ...interventions.map((i) => `learning_intervention:${i.id}`), ...findings.map((f) => `systemic_finding:${f.id}`)];
  const readiness = assessReadiness({
    mode: p.mode,
    requiresExternalOutcome: p.requiresExternalOutcome,
    briefing: { answered: briefing.answered.length, pending: briefing.pending.length, refs: briefing.answered.map((id) => `message:${id}`) },
    goal: { bound: root !== null, state: root?.state ?? null, criteria: root?.successCriteria.length ?? 0, derivedGoals: scope.derivedGoalIds.length, linkedWork: scope.linkedWorkItemIds.length, refs: root === null ? [] : [`goal:${root.id}`, ...scope.derivedGoalIds.map((g) => `goal:${g}`)] },
    collaboration: { departments, completedHandoffs: delegations.filter((d) => d.state === 'COMPLETED' && d.xdept === 1).length, problemHandoffs: unresolved.length, refs: delegations.map((d) => `work_delegation:${d.id}`) },
    review: { satisfied: n(requiredStates.SATISFIED) + n(requiredStates.CONSUMED), rework: n(requiredStates.REWORK), openConflicts: n(conflicts.OPEN), makerDecisions: decisions.filter((d) => d.maker === 1).length, refs: decisions.map((d) => `review_decision:${d.id}`) },
    autonomy: { profiles: people.map((x) => ({ employeeId: x.employeeId, judgment: dimensionOf(x.dimensions, 'JUDGMENT'), independence: dimensionOf(x.dimensions, 'INDEPENDENCE') })), boundaryRefused: classes.AUTHORITY_BOUNDARY_REFUSED, refs: [...classRefs.CORRECT_ESCALATION, ...classRefs.ROUTINE_HANDLED_INDEPENDENTLY, ...classRefs.AUTHORITY_BOUNDARY_REFUSED, ...classRefs.UNNECESSARY_DEPENDENCE_EVIDENCED] },
    learning: {
      validatedLessons: lessons.filter((l) => l.stage === 'VALIDATED').length,
      improvementObserved: interventions.filter((i) => i.effect === 'IMPROVEMENT_OBSERVED').length,
      noImprovement: interventions.filter((i) => i.effect === 'NO_IMPROVEMENT').length,
      regression: interventions.filter((i) => i.effect === 'REGRESSION').length,
      trainingCompletedUntested: interventions.filter((i) => i.state === 'TRAINING_COMPLETED' && i.effect === 'NOT_YET_TESTED').length,
      refs: learningRefs,
    },
    economics,
    external: { qualifiedWithCurrentExternal: withExternal, contested, refs: externalRefs },
  });

  const obs = ctx.db.get<{ runs: number; tools: number; msgs: number }>(
    `SELECT (SELECT COUNT(*) FROM runs WHERE work_item_id IN ${IN_SET}) AS runs, (SELECT COUNT(*) FROM tool_invocations WHERE work_item_id IN ${IN_SET}) AS tools,
            (SELECT COUNT(*) FROM communication_messages WHERE run_id IN (SELECT id FROM runs WHERE work_item_id IN ${IN_SET})) AS msgs`,
    set, set, set,
  );
  const briefingMessages = p.briefingThreadId === null ? 0 : n(ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM communication_messages WHERE thread_id = ?', p.briefingThreadId)?.c);

  return {
    pilot: p,
    at,
    briefing,
    scope: { rootGoal: root === null ? null : { id: root.id as Id, state: root.state, successCriteria: root.successCriteria.length }, derivedGoalIds: scope.derivedGoalIds, linkedWork: scope.linkedWorkItemIds.length, workItems: ids.length, capped: ids.length >= PILOT_SCOPE_CAP },
    outcomes: {
      lifecycle,
      qualifiedOutcomes: qualified,
      underReview: n(lifecycle.WAITING_REVIEW),
      rework: n(requiredStates.REWORK),
      blocked: n(lifecycle.BLOCKED),
      failed: n(lifecycle.FAILED),
      contested,
      notAchieved,
      // Completion is not success: completed / reviewed work with no current ACHIEVED verification is shown apart.
      completedNotVerified: ids.filter((id, i) => ['COMPLETED', 'REVIEWED'].includes(ctx.db.get<{ s: string }>('SELECT state AS s FROM work_items WHERE id = ?', id)?.s ?? '') && !(verdicts[i]?.current && verdicts[i]?.verdict === 'ACHIEVED')).length,
    },
    reviewIntegrity: { required: requiredStates, independentDecisions: decisions.filter((d) => d.maker !== 1).length, makerSelfDecisions: decisions.filter((d) => d.maker === 1).length, openConflicts: n(conflicts.OPEN), resolvedConflicts: n(conflicts.RESOLVED), refs: decisions.slice(0, 50).map((d) => `review_decision:${d.id}`) },
    founderAttention: { openItems: attention },
    decisionsNeeded: decisionsNeeded(ctx, p, briefing, attention.length),
    people,
    autonomy: { dimensions: ['JUDGMENT', 'INDEPENDENCE'], classes, refs: classRefs },
    collaboration: { departments, ownersWithoutAccountability: unowned, delegations: delegationStates, crossDepartmentHandoffs: delegations.filter((d) => d.xdept === 1).length, unresolvedHandoffs: unresolved.length, refs: delegations.slice(0, 50).map((d) => `work_delegation:${d.id}`) },
    learning: {
      signals: countBy([...signals.reduce((m, s) => m.set(s.kind, (m.get(s.kind) ?? 0) + 1), new Map<string, number>())].map(([k, c]) => ({ k, c }))),
      validatedLessons: lessons.filter((l) => l.stage === 'VALIDATED').length,
      interventions: countBy([...interventions.reduce((m, i) => m.set(i.effect, (m.get(i.effect) ?? 0) + 1), new Map<string, number>())].map(([k, c]) => ({ k, c }))),
      systemicFindings: countBy([...findings.reduce((m, f) => m.set(f.state, (m.get(f.state) ?? 0) + 1), new Map<string, number>())].map(([k, c]) => ({ k, c }))),
      refs: learningRefs.slice(0, 50),
    },
    economics,
    external: { availability: externalAvailability(ctx).state, marketClaim: marketClaimOf(p.mode, { qualifiedWithCurrentExternal: withExternal, contested }), qualifiedWithCurrentExternal: withExternal, contested, goalEvidence, refs: externalRefs.slice(0, 50) },
    controls: { proposals: countBy([...proposals.reduce((m, x) => m.set(x.state, (m.get(x.state) ?? 0) + 1), new Map<string, number>())].map(([k, c]) => ({ k, c }))), refs: proposals.slice(0, 50).map((x) => `app_control_proposal:${x.id}`), desiredStateOnly: true, countsAsOutcome: false, appEffectKnown: false },
    readiness,
    observability: { briefingMessages, workMessages: n(obs?.msgs), runs: n(obs?.runs), toolCalls: n(obs?.tools) },
  };
}

export interface PilotWorkInspection {
  readonly pilotId: Id;
  readonly workItemId: Id;
  /** What happened: the current verification (C6 / C7-A current truth). */
  readonly outcome: ReturnType<typeof latestVerdict>;
  readonly dimensions: readonly DimensionVerdict[];
  readonly autonomy: AutonomyClass;
  /** How it happened: references into the canonical lineage — never a copied trace. */
  readonly lineageRefs: readonly string[];
  readonly localization: FailureLocalization;
}

function txInspectWork(ctx: StoreContext, p: PilotRecord, workItemId: Id): PilotWorkInspection {
  const scope = txPilotScope(ctx, p);
  if (!scope.workItemIds.includes(workItemId)) throw new QandeelError('NOT_FOUND', 'work item is not in this pilot', { pilotId: p.id, workItemId });
  const { evidence, refs } = gatherWorkEvidence(ctx, workItemId);
  const dims = liveDimensionRows(ctx, [workItemId])[0];
  const dimensions = dims === undefined ? [] : dimsOf(dims.dimensions_json);
  const attr = ctx.db.get<{ id: string; state: string; employee_accountable: number; causes_json: string }>(`SELECT id, state, employee_accountable, causes_json FROM causal_attributions WHERE work_item_id = ? AND state IN ('PROPOSED', 'VALIDATED') ORDER BY updated_at DESC, rowid DESC LIMIT 1`, workItemId);
  const handoffs = ctx.db.all<{ id: string; state: string }>(`SELECT id, state FROM work_delegations WHERE parent_work_item_id = ? OR child_work_item_id = ? ORDER BY created_at, id`, workItemId, workItemId);
  const extra = (sql: string, prefix: string): string[] => ctx.db.all<{ id: string }>(sql, workItemId).map((r) => `${prefix}:${r.id}`);
  const lineageRefs = [
    ...refs,
    ...extra('SELECT id FROM review_requests WHERE work_item_id = ? ORDER BY created_at, id', 'review_request'),
    ...handoffs.map((h) => `work_delegation:${h.id}`),
    ...extra('SELECT id FROM approvals WHERE work_item_id = ? ORDER BY created_at, id', 'approval'),
    ...extra('SELECT id FROM tool_invocations WHERE work_item_id = ? ORDER BY created_at, id', 'tool_invocation'),
    ...(dims === undefined ? [] : [`evaluation:${dims.id}`]),
    ...(attr === undefined ? [] : [`causal_attribution:${attr.id}`]),
    ...extra('SELECT id FROM learning_signals WHERE work_item_id = ? ORDER BY created_at, id', 'learning_signal'),
    ...boundEvidence(ctx, 'WORK_ITEM', workItemId).map((b) => b.bindingRef),
    ...extra('SELECT id FROM app_control_proposals WHERE work_item_id = ? ORDER BY created_at, id', 'app_control_proposal'),
  ];
  const categories = attr === undefined ? [] : (JSON.parse(attr.causes_json) as { category: string }[]).map((c) => c.category);
  return {
    pilotId: p.id,
    workItemId,
    outcome: latestVerdict(ctx, workItemId),
    dimensions,
    autonomy: classifyAutonomy(dimensions),
    lineageRefs: [...new Set(lineageRefs)].slice(0, 200),
    localization: localizeFailure(evidence, handoffs.filter((h) => h.state === 'ESCALATED' || h.state === 'FAILED' || h.state === 'REFUSED').length, attr === undefined ? null : { state: attr.state, employeeAccountable: attr.employee_accountable === 1, categories }),
  };
}

// --- Lifecycle acts (Founder only) -------------------------------------------------------------------------------

function history(ctx: StoreContext, p: PilotRecord, from: PilotState | null, reasonCode: string, actorRef: string): void {
  ctx.db.run('INSERT INTO pilot_history (pilot_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', p.id, p.version, from, p.state, reasonCode, actorRef, p.updatedAt);
}

/** Creates a DRAFT Pilot in the caller's transaction (the Founder's authority is the caller's responsibility). */
export function txCreatePilot(ctx: StoreContext, input: CreatePilotInput, founderRef: string, reasonCode: string): PilotRecord {
  if (!isPilotMode(input.mode)) throw new QandeelError('VALIDATION_FAILED', 'mode is TRAINING_INTERNAL or CONTROLLED_REAL', { field: 'mode' });
  const title = boundedText(input.title, 'title', 160);
  if (containsSecretMaterial(title)) throw new QandeelError('VALIDATION_FAILED', 'pilot title carries secret material', { field: 'title', reason: 'SECRET_MATERIAL' });
  const requires = input.requiresExternalOutcome === true;
  if (requires && input.mode !== 'CONTROLLED_REAL') throw new QandeelError('VALIDATION_FAILED', 'only a controlled real-world pilot may require external outcome evidence', { field: 'requiresExternalOutcome' });
  const id = newId();
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO pilots (id, mode, title, requires_external_outcome, state, briefing_thread_id, root_goal_id, created_by_ref, version, created_at, updated_at, activated_at, closed_at)
     VALUES (?, ?, ?, ?, 'DRAFT', NULL, NULL, ?, 1, ?, ?, NULL, NULL)`,
    id, input.mode, title, requires ? 1 : 0, founderRef, at, at,
  );
  const p = getPilot(ctx, id as Id);
  history(ctx, p, null, reasonCode, founderRef);
  appendAudit(ctx, 'pilot.created', 'pilot', p.id, { actorRef: founderRef }, 'OK', reasonCode, { mode: p.mode, requiresExternalOutcome: requires });
  return p;
}

export interface PilotStepPlan {
  readonly pilot: PilotRecord;
  readonly to: PilotState;
  readonly reasonCode: string;
  /** The step was already taken (same target, same bindings): nothing to do. */
  readonly noop: boolean;
  /** BRIEFING: the thread to bind, or null to open a fresh Founder ↔ CEO thread. */
  readonly threadId: Id | null;
  readonly goalId: Id | null;
}

/**
 * Checks one Founder step without any effect — exactly what the step re-checks when it is taken, so a governed preview
 * never offers a step the confirmation would refuse (and the datastore re-checks it again, migration 0014).
 */
export function planPilotStep(ctx: StoreContext, pilotId: Id, input: AdvancePilotInput): PilotStepPlan {
  if (!isPilotState(input.to)) throw new QandeelError('VALIDATION_FAILED', 'unknown pilot state', { field: 'to' });
  const reasonCode = assertCode(input.reasonCode, 'reasonCode');
  const p = getPilot(ctx, pilotId);
  const threadId = input.threadId === undefined || input.threadId === null ? null : assertId(input.threadId, 'threadId');
  const goalId = input.goalId === undefined || input.goalId === null ? null : assertId(input.goalId, 'goalId');
  const plan = { pilot: p, to: input.to, reasonCode, threadId, goalId };
  if (p.state === input.to && (threadId === null || threadId === p.briefingThreadId) && (goalId === null || goalId === p.rootGoalId)) return { ...plan, noop: true };
  assertPilotTransition(p.state, input.to);
  if (input.to !== 'BRIEFING' && threadId !== null) throw new QandeelError('VALIDATION_FAILED', 'a briefing thread is bound only entering BRIEFING', { field: 'threadId' });
  if (input.to !== 'ACTIVE' && goalId !== null) throw new QandeelError('VALIDATION_FAILED', 'the root goal is bound only entering ACTIVE', { field: 'goalId' });
  if (input.to === 'BRIEFING' && threadId !== null) {
    const t = getThread(ctx, threadId);
    if (t.kind !== 'FOUNDER_CEO' || t.state !== 'OPEN') throw new QandeelError('PILOT_INVALID', 'a pilot briefing is an open Founder ↔ CEO thread', { threadId, reason: 'NOT_AN_OPEN_CEO_THREAD' });
    if (ctx.db.get('SELECT 1 AS x FROM pilots WHERE briefing_thread_id = ?', threadId)) throw new QandeelError('PILOT_INVALID', 'this thread already briefs another pilot', { threadId, reason: 'THREAD_ALREADY_BOUND' });
  }
  if (input.to === 'READY' && !txBriefingStatus(ctx, p.briefingThreadId).conversationEvidenced) {
    // Silence is never approval: an unanswered request (or none) never makes a Pilot READY.
    throw new QandeelError('PILOT_INVALID', 'a pilot is READY only after a governed reply to a Founder briefing request', { pilotId: p.id, reason: 'NO_GOVERNED_BRIEFING_REPLY' });
  }
  if (input.to === 'ACTIVE') {
    if (goalId === null) throw new QandeelError('VALIDATION_FAILED', 'activation names the root company goal', { field: 'goalId' });
    const g = getGoal(ctx, goalId);
    // The Pilot never creates or approves its Goal: the existing Founder Goal path must already have done so.
    if (g.kind !== 'COMPANY' || g.state !== 'ACTIVE' || g.approvedByRef === null || g.successCriteria.length === 0) throw new QandeelError('PILOT_INVALID', 'a pilot is ACTIVE only on an active, Founder-approved company goal with success criteria', { goalId, reason: 'ROOT_GOAL_NOT_ACTIVE' });
    if (ctx.db.get('SELECT 1 AS x FROM pilots WHERE root_goal_id = ?', goalId)) throw new QandeelError('PILOT_INVALID', 'this goal is already the root of another pilot', { goalId, reason: 'GOAL_ALREADY_BOUND' });
  }
  return { ...plan, noop: false };
}

/**
 * One explicit Founder step in the caller's transaction. Repeating a step the Pilot already took (same target, same
 * bindings) returns it unchanged — no second history row, binding or audit (deterministic retries).
 */
export function txAdvancePilot(ctx: StoreContext, pilotId: Id, input: AdvancePilotInput, founderRef: string): PilotRecord {
  const plan = planPilotStep(ctx, pilotId, input);
  const p = plan.pilot;
  if (plan.noop) return p;
  let thread = p.briefingThreadId;
  if (plan.to === 'BRIEFING') {
    // A fresh Founder ↔ CEO thread through the existing C5 boundary when none is named (no chat engine of its own; the
    // subject is Company content). Its context is the decision this conversation prepares, so it never becomes the
    // Founder's general direct thread with the CEO.
    thread = plan.threadId ?? txOpenThread(ctx, { kind: 'FOUNDER_CEO', subject: `Pilot: ${p.title}`.slice(0, 160), contextKind: 'DECISION', contextRef: `pilot:${p.id}` }, founderRef).id;
  }
  const goal = plan.to === 'ACTIVE' ? plan.goalId : p.rootGoalId;
  const at = ts(ctx);
  const closing = (TERMINAL_PILOT_STATES as readonly string[]).includes(plan.to);
  const changed = ctx.db.run(
    `UPDATE pilots SET state = ?, briefing_thread_id = ?, root_goal_id = ?, activated_at = COALESCE(activated_at, ?), closed_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
    plan.to, thread, goal, plan.to === 'ACTIVE' ? at : null, closing ? at : null, at, p.id, p.version,
  ).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'pilot changed concurrently', { pilotId: p.id });
  const next = getPilot(ctx, p.id);
  history(ctx, next, p.state, plan.reasonCode, founderRef);
  appendAudit(ctx, `pilot.${plan.to.toLowerCase()}`, 'pilot', p.id, { actorRef: founderRef }, 'OK', plan.reasonCode, { from: p.state, to: plan.to, mode: p.mode, threadId: next.briefingThreadId, goalId: next.rootGoalId });
  return next;
}

export class PilotStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): PilotStore {
    return new PilotStore(store);
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  #admin<T>(operation: string, actorRef: string, fn: (ctx: StoreContext, founderRef: string) => T): T {
    return founderAdminWrite(this.#store, operation, actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'pilot lifecycle');
      // Pilot acts are the Founder's own: never an Employee, a delegate or a reference.
      if (p.kind !== 'FOUNDER') throw new QandeelError('FOUNDER_ONLY', 'a pilot is decided by the Founder', {});
      return fn(ctx, p.ref);
    });
  }

  create(actorRef: string, input: CreatePilotInput, options: { reasonCode?: string } = {}): PilotRecord {
    return this.#admin('create pilot', actorRef, (ctx, ref) => txCreatePilot(ctx, input, ref, assertCode(options.reasonCode ?? 'pilot.created', 'reasonCode')));
  }

  advance(actorRef: string, pilotId: string, input: AdvancePilotInput): PilotRecord {
    return this.#admin('advance pilot', actorRef, (ctx, ref) => txAdvancePilot(ctx, assertId(pilotId, 'pilotId'), input, ref));
  }

  get(id: string): PilotRecord {
    return this.#read((ctx) => getPilot(ctx, assertId(id, 'pilotId')));
  }

  list(filter: { state?: PilotState } = {}): PilotRecord[] {
    return this.#read((ctx) => ctx.db.all<Row>('SELECT * FROM pilots ORDER BY created_at, id').map(mapPilot).filter((p) => filter.state === undefined || p.state === filter.state));
  }

  history(id: string): PilotHistoryRecord[] {
    return this.#read((ctx) => ctx.db.all<Row>('SELECT * FROM pilot_history WHERE pilot_id = ? ORDER BY version', assertId(id, 'pilotId')).map(mapHistory));
  }

  briefing(id: string): BriefingStatus {
    return this.#read((ctx) => txBriefingStatus(ctx, getPilot(ctx, assertId(id, 'pilotId')).briefingThreadId));
  }

  scope(id: string): PilotScope {
    return this.#read((ctx) => txPilotScope(ctx, getPilot(ctx, assertId(id, 'pilotId'))));
  }

  /** The Pilot Evidence Board: a deterministic projection of canonical evidence at this moment (nothing stored). */
  board(id: string): PilotBoard {
    return this.#read((ctx) => txPilotBoard(ctx, getPilot(ctx, assertId(id, 'pilotId'))));
  }

  /** Outcome + trace for one in-scope Work Item: refs into the canonical lineage and where the trace points. */
  inspect(id: string, workItemId: string): PilotWorkInspection {
    return this.#read((ctx) => txInspectWork(ctx, getPilot(ctx, assertId(id, 'pilotId')), assertId(workItemId, 'workItemId')));
  }

  health(): Record<string, number> {
    return this.#read((ctx) => Object.fromEntries(ctx.db.all<{ k: string; c: number }>('SELECT state AS k, COUNT(*) AS c FROM pilots GROUP BY state ORDER BY state').map((r) => [r.k, n(r.c)])));
  }
}

