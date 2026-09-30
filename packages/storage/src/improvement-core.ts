/**
 * C6 storage internals: the Work Item evidence the evaluator reads, built only from canonical C1–C5 rows
 * (work lineage, review decisions, outcome verification, runs, tool invocations, context manifests, usage,
 * delegations, approvals). Counts, codes and ids only — never message bodies, rationale or artifacts (Rule A).
 * Not exported from the package.
 */
import { type Id } from '@qandeel-company/domain';
import type { DirectCause, EvaluationFact, EvidenceClass, FollowupFact, ItemDimension, RiskLevel, ValidatedAttributionFact, Verdict, WorkEvidence } from '@qandeel-company/mind';

import type { StoreContext } from './internal.js';
import { getWorkItemRow } from './internal.js';

const n = (v: unknown): number => Number(v ?? 0);

// Run failure codes by cause family (codes the governed runtime records on runs.failure_code).
const PROVIDER_CODES = ['PROVIDER_UNAVAILABLE', 'PROVIDER_FAILURE', 'FALLBACK_REFUSED', 'NO_ELIGIBLE_ROUTE'];
const MODEL_CODES = ['MODEL_OUTPUT_INVALID'];
const TOOL_CODES = ['TOOL_FAILED', 'TOOL_NOT_EXECUTED', 'DRIVER_NOT_REGISTERED', 'DRIVER_OUTCOME_UNKNOWN', 'TOOL_OUTCOME_UNCERTAIN'];
const CONTEXT_CODES = ['CONTEXT_BUDGET_EXHAUSTED', 'CONTEXT_NOT_ASSEMBLED', 'CONFLICT_HOLD', 'SKILL_CONFLICT'];
const WORKFLOW_CODES = ['NO_ROUTE_POLICY', 'BUDGET_EXHAUSTED', 'GOVERNANCE_REQUIRED'];
const REQUIREMENT_CODES = ['INVALID_TASK_INPUT'];
const BOUNDARY_CODES = ['ESCALATION_REFUSED', 'HANDOFF_REFUSED', 'END_REFUSED', 'EMPLOYEE_CONTAINED'];

/** Comparable-work key: the governed task class when the work names one, else its processor kind. */
export function comparableKeyOf(processorKind: string | null, processorInput: unknown): string {
  const input = (processorInput ?? {}) as Record<string, unknown>;
  const taskClass = typeof input.taskClass === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(input.taskClass) ? input.taskClass : null;
  return (taskClass ?? processorKind ?? 'unclassified').slice(0, 96);
}

/** The Employee a Work Item's performance belongs to: its governed runs' attribution, else its owner ref. */
export function subjectOf(ctx: StoreContext, workItemId: Id): { employeeId: Id | null; departmentId: Id | null } {
  const a = ctx.db.get<{ employee_id: string; department_id: string | null }>('SELECT employee_id, department_id FROM run_attributions WHERE work_item_id = ? ORDER BY created_at DESC, run_id DESC LIMIT 1', workItemId);
  if (a) return { employeeId: a.employee_id as Id, departmentId: (a.department_id ?? null) as Id | null };
  const w = getWorkItemRow(ctx, workItemId);
  const m = /^employee:([0-9a-f-]{36})$/.exec(String(w.ownerRef));
  if (!m) return { employeeId: null, departmentId: null };
  const e = ctx.db.get<{ id: string; department_id: string | null }>('SELECT id, department_id FROM employees WHERE id = ?', m[1] ?? '');
  return e ? { employeeId: e.id as Id, departmentId: (e.department_id ?? null) as Id | null } : { employeeId: null, departmentId: null };
}

export function latestVerdict(ctx: StoreContext, workItemId: Id): { id: Id; verdict: 'ACHIEVED' | 'NOT_ACHIEVED' | 'INCONCLUSIVE' } | null {
  const decisive = ctx.db.get<{ id: string; verdict: string }>(`SELECT id, verdict FROM outcome_verifications WHERE work_item_id = ? AND verdict <> 'INCONCLUSIVE' LIMIT 1`, workItemId);
  const any = decisive ?? ctx.db.get<{ id: string; verdict: string }>('SELECT id, verdict FROM outcome_verifications WHERE work_item_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', workItemId);
  return any ? { id: any.id as Id, verdict: any.verdict as 'ACHIEVED' | 'NOT_ACHIEVED' | 'INCONCLUSIVE' } : null;
}

/** Builds the evaluator's view of one Work Item. Deterministic for a given database state. */
export function gatherWorkEvidence(ctx: StoreContext, workItemId: Id): { evidence: WorkEvidence; refs: string[] } {
  const w = getWorkItemRow(ctx, workItemId);
  const { employeeId, departmentId } = subjectOf(ctx, workItemId);
  const transitions = new Set(ctx.db.all<{ to_state: string }>('SELECT DISTINCT to_state FROM work_item_transitions WHERE work_item_id = ?', workItemId).map((r) => r.to_state));
  const completed = transitions.has('COMPLETED') || ['COMPLETED', 'WAITING_REVIEW', 'REVIEWED', 'OUTCOME_VERIFIED'].includes(w.state);
  const reviewed = transitions.has('REVIEWED') || w.state === 'REVIEWED' || w.state === 'OUTCOME_VERIFIED';
  const verdict = latestVerdict(ctx, workItemId);

  const decisions = ctx.db.all<{ id: string; outcome: string }>(
    `SELECT d.id, d.outcome FROM review_decisions d JOIN review_requests r ON r.id = d.request_id WHERE r.work_item_id = ? AND r.kind = 'REQUIRED' AND d.counts = 1 ORDER BY d.created_at, d.id`,
    workItemId,
  );
  const count = (o: string): number => decisions.filter((d) => d.outcome === o).length;
  const rework = n(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM review_requests WHERE work_item_id = ? AND kind = 'REQUIRED' AND state = 'REWORK'`, workItemId)?.n);
  const openConflict = ctx.db.get(`SELECT 1 AS x FROM review_conflicts c JOIN review_requests r ON r.id = c.request_id WHERE r.work_item_id = ? AND c.state = 'OPEN'`, workItemId) !== undefined;

  const runs = ctx.db.all<{ id: string; state: string; attempt: number; failure_code: string | null }>('SELECT id, state, attempt, failure_code FROM runs WHERE work_item_id = ? ORDER BY started_at, run_seq', workItemId);
  // R2-13: a failure is RECOVERED when a later run of the same Work Item succeeded (the retry got past it); a
  // permanent failure, or a failed attempt no successful run followed, is UNRECOVERED — only those can cause the
  // outcome. A failure inside a run that itself succeeded was handled by that run.
  const lastSuccess = runs.map((r) => r.state).lastIndexOf('SUCCEEDED');
  const unrecoveredRuns = new Set(runs.filter((r, i) => r.state !== 'SUCCEEDED' && (r.state === 'FAILED_PERMANENT' || i > lastSuccess)).map((r) => r.id));
  const unrecoveredRun = (runId: string): boolean => unrecoveredRuns.has(runId) || !runs.some((r) => r.id === runId);
  const codeCount = (codes: readonly string[], recovered = false): number => runs.filter((r) => r.failure_code !== null && codes.includes(r.failure_code) && unrecoveredRun(r.id) !== recovered).length;
  const anyRunCode = (codes: readonly string[]): number => runs.filter((r) => r.failure_code !== null && codes.includes(r.failure_code)).length;
  const toolRows = ctx.db.all<{ state: string; code: string; run_id: string }>(
    `SELECT i.state, a.code, i.run_id FROM tool_invocations i JOIN tool_actions a ON a.id = i.tool_action_id WHERE i.work_item_id = ? ORDER BY i.created_at, i.id`,
    workItemId,
  );
  const failedTools = toolRows.filter((t) => t.state === 'FAILED');
  const contextFailed = ctx.db.all<{ run_id: string }>(`SELECT run_id FROM context_manifests WHERE work_item_id = ? AND outcome <> 'OK'`, workItemId);
  // R2-20: the cost buckets are ECONOMIC micros — what the budget ledger charges (D13-G.3 / G.8); a subscription or
  // free route bills 0 but is not free work. The bill is carried separately (reporting only).
  const usage = ctx.db.all<{ attempt_kind: string; outcome: string; billed_micros: number; economic_micros: number; charged_tokens: number; created_at: string }>(
    'SELECT attempt_kind, outcome, billed_micros, economic_micros, charged_tokens, created_at FROM usage_records WHERE work_item_id = ? ORDER BY created_at, id',
    workItemId,
  );
  const firstRework = ctx.db.get<{ at: string | null }>(`SELECT MIN(h.occurred_at) AS at FROM review_request_history h JOIN review_requests r ON r.id = h.request_id WHERE r.work_item_id = ? AND h.to_state = 'REWORK'`, workItemId)?.at ?? null;
  let productive = 0;
  let retry = 0;
  let fallback = 0;
  let escalation = 0;
  let failedCharged = 0;
  let reworkCost = 0;
  let tokens = 0;
  let billed = 0;
  for (const u of usage) {
    const m = n(u.economic_micros);
    billed += n(u.billed_micros);
    tokens += n(u.charged_tokens);
    if (u.outcome === 'FAILED_CHARGED') failedCharged += m;
    else if (firstRework !== null && u.created_at > firstRework) reworkCost += m;
    else if (u.attempt_kind === 'RETRY') retry += m;
    else if (u.attempt_kind === 'FALLBACK') fallback += m;
    else if (u.attempt_kind === 'ESCALATION') escalation += m;
    else productive += m;
  }
  const escalations = n(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM handoff_messages h JOIN work_delegations d ON d.id = h.delegation_id WHERE d.child_work_item_id = ? AND h.kind = 'ESCALATION'`, workItemId)?.n);
  const correctEscalations = n(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM handoff_messages h JOIN work_delegations d ON d.id = h.delegation_id WHERE d.child_work_item_id = ? AND h.kind = 'ESCALATION' AND d.state = 'COMPLETED'`, workItemId)?.n);
  const founderInterventions =
    n(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM review_conflicts c JOIN review_requests r ON r.id = c.request_id WHERE r.work_item_id = ? AND c.state = 'RESOLVED'`, workItemId)?.n) +
    toolRows.filter((t) => t.state === 'RECONCILIATION_REQUIRED').length;
  const gateCatches = n(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM approvals WHERE work_item_id = ? AND state = 'REJECTED'`, workItemId)?.n);
  const messages = n(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM communication_messages WHERE run_id IN (SELECT id FROM runs WHERE work_item_id = ?)`, workItemId)?.n);
  const artifacts = n(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM artifacts WHERE work_item_id = ? AND state = 'READY'`, workItemId)?.n);
  const input = (w.processorInput ?? {}) as Record<string, unknown>;
  const planned = Array.isArray(input.plannedRoute) ? input.plannedRoute.filter((x): x is string => typeof x === 'string').slice(0, 32) : [];
  const taken = toolRows.map((t) => t.code).slice(0, 32);
  const risk = (['R0', 'R1', 'R2', 'R3', 'R4'].includes(w.riskLevel) ? w.riskLevel : 'R1') as RiskLevel;
  const classes = new Set<EvidenceClass>(['WORK_LINEAGE']);
  if (decisions.length > 0) classes.add('REVIEW_DECISION');
  if (verdict !== null) classes.add('OUTCOME_VERIFICATION');
  if (runs.length > 0) classes.add('RUN_TRACE');
  if (toolRows.length > 0) classes.add('TOOL_RESULT');
  if (artifacts > 0) classes.add('ARTIFACT');
  if (usage.length > 0) classes.add('COST_USAGE');
  if (rework > 0) classes.add('REWORK');
  if (escalations + founderInterventions > 0) classes.add('INTERVENTION');
  if (ctx.db.get('SELECT 1 AS x FROM academy_attempts WHERE work_item_id = ?', workItemId)) classes.add('ACADEMY');
  const evidence: WorkEvidence = {
    workItemId,
    employeeId,
    departmentId,
    comparableKey: comparableKeyOf(w.processorKind, w.processorInput),
    riskLevel: risk,
    completed,
    reviewed,
    outcome: verdict?.verdict ?? null,
    review: { pass: count('PASS'), fail: count('FAIL'), uncertain: count('UNCERTAIN'), insufficient: count('INSUFFICIENT_EVIDENCE'), rework, openConflict },
    runs: { total: runs.length, failed: runs.filter((r) => r.state === 'FAILED_PERMANENT' || r.state === 'FAILED_RETRYABLE').length, retried: runs.filter((r) => r.attempt > 1).length },
    failures: {
      tool: codeCount(TOOL_CODES) + failedTools.filter((t) => unrecoveredRun(t.run_id)).length,
      // A cause is read from the run's own recorded failure classification. A FAILED_CHARGED usage row says a
      // call was billed and failed — not why (it may be the call in flight when a tool failure failed the run):
      // it is cost overhead (failedChargedMicros), never by itself a provider cause.
      provider: codeCount(PROVIDER_CODES),
      model: codeCount(MODEL_CODES),
      context: codeCount(CONTEXT_CODES) + contextFailed.filter((c) => unrecoveredRun(c.run_id)).length,
      external: 0, // No governed external-outcome source exists before C7.
      workflow: codeCount(WORKFLOW_CODES),
      requirementChanged: anyRunCode(REQUIREMENT_CODES) > 0 || w.state === 'SUPERSEDED',
    },
    recoveredFailures: {
      tool: codeCount(TOOL_CODES, true) + failedTools.filter((t) => !unrecoveredRun(t.run_id)).length,
      provider: codeCount(PROVIDER_CODES, true),
      model: codeCount(MODEL_CODES, true),
      context: codeCount(CONTEXT_CODES, true) + contextFailed.filter((c) => !unrecoveredRun(c.run_id)).length,
      workflow: codeCount(WORKFLOW_CODES, true),
    },
    interventions: { escalations, correctEscalations, founder: founderInterventions },
    // A boundary refusal is the Employee's own act, recovered from or not.
    authorityRefusals: anyRunCode(BOUNDARY_CODES),
    gateCatches,
    route: { planned, taken },
    cost: { productiveMicros: productive, retryMicros: retry, fallbackMicros: fallback, escalationMicros: escalation, failedChargedMicros: failedCharged, reworkMicros: reworkCost, billedMicros: billed },
    activity: { messages, toolCalls: toolRows.length, tokens, runs: runs.length },
    evidenceClasses: [...classes],
  };
  const refs = [`work_item:${workItemId}`, ...decisions.map((d) => `review_decision:${d.id}`), ...(verdict ? [`outcome_verification:${verdict.id}`] : []), ...runs.map((r) => `run:${r.id}`)].slice(0, 60);
  return { evidence, refs };
}

// ---------------------------------------------------------------------------------------------------------
// Read models for the kernel.

interface EvalRow {
  id: string;
  work_item_id: string;
  comparable_key: string;
  risk_level: string;
  created_at: string;
  evidence_state: string;
  qualified_outcome: number;
  dimensions_json: string;
  cost_json: string;
  observability_json: string;
  work_started_at: string;
}

/** A stored evaluation with the time its work started (R2-15). */
export type StoredEvaluationFact = EvaluationFact & { readonly workStartedAt: string };

export function toEvaluationFact(r: EvalRow): StoredEvaluationFact {
  const dims = JSON.parse(r.dimensions_json) as { dimension: ItemDimension; verdict: Verdict }[];
  const cost = JSON.parse(r.cost_json) as Record<string, number>;
  const obs = JSON.parse(r.observability_json) as Record<string, number>;
  const overhead = n(cost.retryMicros) + n(cost.fallbackMicros) + n(cost.escalationMicros) + n(cost.failedChargedMicros) + n(cost.reworkMicros);
  return {
    evaluationId: r.id,
    workItemId: r.work_item_id,
    comparableKey: r.comparable_key,
    riskLevel: r.risk_level as RiskLevel,
    at: r.created_at,
    evidenceState: r.evidence_state as EvaluationFact['evidenceState'],
    qualifiedOutcome: r.qualified_outcome === 1,
    verdicts: Object.fromEntries(dims.map((d) => [d.dimension, d.verdict])),
    cost: { productiveMicros: n(cost.productiveMicros), overheadMicros: overhead, billedMicros: n(cost.billedMicros) },
    activity: { messages: n(obs.messages), toolCalls: n(obs.toolCalls), tokens: n(obs.tokens), runs: n(obs.runs) },
    workStartedAt: r.work_started_at,
  };
}

/**
 * R2-14: the unit of evidence is the Work Item. Of its live evaluations (one per definition — several versions of
 * a code in a database written before the fix, or several codes), only the LATEST speaks for it in every profile,
 * report, economics and health read.
 */
export const LATEST_LIVE_EVALUATION = `e.superseded_by IS NULL AND NOT EXISTS (SELECT 1 FROM evaluation_results n WHERE n.work_item_id = e.work_item_id AND n.superseded_by IS NULL AND (n.created_at > e.created_at OR (n.created_at = e.created_at AND n.rowid > e.rowid)))`;

// R2-15: when the work itself started — its first run, else its creation — never the evaluation's time.
const LIVE_EVALS = `SELECT e.id, e.work_item_id, e.comparable_key, e.risk_level, e.created_at, e.evidence_state, e.qualified_outcome, e.dimensions_json, e.cost_json, e.observability_json,
  COALESCE((SELECT MIN(r.started_at) FROM runs r WHERE r.work_item_id = e.work_item_id), (SELECT w.created_at FROM work_items w WHERE w.id = e.work_item_id)) AS work_started_at
  FROM evaluation_results e WHERE ${LATEST_LIVE_EVALUATION}`;

export function liveEvaluations(ctx: StoreContext, filter: { employeeId?: Id; departmentId?: Id; from?: string; to?: string; workItemIds?: readonly Id[] } = {}): StoredEvaluationFact[] {
  const clauses: string[] = [];
  const params: string[] = [];
  const add = (clause: string, value: string): void => {
    clauses.push(clause);
    params.push(value);
  };
  if (filter.employeeId !== undefined) add('e.employee_id = ?', filter.employeeId);
  if (filter.departmentId !== undefined) add('e.department_id = ?', filter.departmentId);
  if (filter.from !== undefined) add('e.created_at >= ?', filter.from);
  if (filter.to !== undefined) add('e.created_at <= ?', filter.to);
  const rows = ctx.db.all(`${LIVE_EVALS}${clauses.length ? ` AND ${clauses.join(' AND ')}` : ''} ORDER BY e.created_at DESC, e.rowid DESC LIMIT 5000`, ...params) as unknown as EvalRow[];
  // The newest 5000 live evaluations, returned oldest first (a bound that never drops recent evidence).
  rows.reverse();
  const set = filter.workItemIds ? new Set(filter.workItemIds) : null;
  return rows.filter((r) => set === null || set.has(r.work_item_id as Id)).map(toEvaluationFact);
}

export function attributionFacts(ctx: StoreContext, employeeId?: Id): { workItemId: string; state: 'PROPOSED' | 'VALIDATED' | 'REJECTED'; employeeAccountable: boolean; overall: string }[] {
  const rows = employeeId === undefined
    ? ctx.db.all<{ work_item_id: string; state: string; employee_accountable: number; overall: string }>(`SELECT work_item_id, state, employee_accountable, overall FROM causal_attributions WHERE state IN ('PROPOSED', 'VALIDATED')`)
    : ctx.db.all<{ work_item_id: string; state: string; employee_accountable: number; overall: string }>(`SELECT work_item_id, state, employee_accountable, overall FROM causal_attributions WHERE state IN ('PROPOSED', 'VALIDATED') AND employee_id = ?`, employeeId);
  return rows.map((r) => ({ workItemId: r.work_item_id, state: r.state as 'PROPOSED' | 'VALIDATED', employeeAccountable: r.employee_accountable === 1, overall: r.overall }));
}

/** A validated attribution with the time it was decided (a VALIDATED row is not updated again while it stays VALIDATED). */
export type DecidedAttributionFact = ValidatedAttributionFact & { readonly decidedAt: string };

export function validatedAttributionFacts(ctx: StoreContext): DecidedAttributionFact[] {
  return ctx.db
    .all<{ id: string; work_item_id: string; employee_id: string | null; comparable_key: string; overall: string; causes_json: string; updated_at: string }>(`SELECT id, work_item_id, employee_id, comparable_key, overall, causes_json, updated_at FROM causal_attributions WHERE state = 'VALIDATED' ORDER BY created_at, id`)
    .map((r) => ({ attributionId: r.id, workItemId: r.work_item_id, employeeId: r.employee_id, comparableKey: r.comparable_key, overall: r.overall as ValidatedAttributionFact['overall'], causes: JSON.parse(r.causes_json) as ValidatedAttributionFact['causes'], decidedAt: r.updated_at }));
}

/**
 * Evaluations with the causes validated as the Employee's (for learning-effect assessment), each with the time its
 * work started (R2-15) and the state of its attribution (R2-17: live PROPOSED / VALIDATED, else REJECTED, else NONE).
 */
export function followupFacts(ctx: StoreContext, employeeId: Id, comparableKey: string): FollowupFact[] {
  const accountable = new Map<string, DirectCause[]>();
  for (const r of ctx.db.all<{ work_item_id: string; causes_json: string }>(`SELECT work_item_id, causes_json FROM causal_attributions WHERE state = 'VALIDATED' AND employee_accountable = 1 AND employee_id = ?`, employeeId)) {
    const causes = JSON.parse(r.causes_json) as { category: DirectCause; role: string }[];
    accountable.set(r.work_item_id, causes.filter((c) => c.role === 'PRIMARY').map((c) => c.category));
  }
  const attribution = new Map<string, FollowupFact['attributionState']>();
  for (const r of ctx.db.all<{ work_item_id: string; state: string }>(`SELECT work_item_id, state FROM causal_attributions WHERE employee_id = ? AND state IN ('PROPOSED', 'VALIDATED', 'REJECTED')`, employeeId)) {
    const live = r.state === 'PROPOSED' || r.state === 'VALIDATED';
    if (live || !attribution.has(r.work_item_id)) attribution.set(r.work_item_id, r.state as FollowupFact['attributionState']);
  }
  return liveEvaluations(ctx, { employeeId })
    .filter((f) => f.comparableKey === comparableKey)
    .map((f) => ({ ...f, attributionState: attribution.get(f.workItemId) ?? 'NONE', accountableCauses: accountable.get(f.workItemId) ?? [] }));
}
