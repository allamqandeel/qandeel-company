/**
 * C6 storage internals: the Work Item evidence the evaluator reads, built only from canonical C1–C5 rows
 * (work lineage, review decisions, outcome verification, runs, tool invocations, context manifests, usage,
 * delegations, approvals). Counts, codes and ids only — never message bodies, rationale or artifacts (Rule A).
 * Not exported from the package.
 */
import { type Id } from '@qandeel-company/domain';
import { runFailureCodesOf } from '@qandeel-company/governance';
import type { AdverseSourceEvent, AdverseSourceKind, AttributionFact, AttributionState, DirectCause, EvaluationFact, EvidenceClass, FollowupFact, ItemDimension, RiskLevel, ValidatedAttributionFact, Verdict, WorkEvidence } from '@qandeel-company/mind';

import { externalDependencyFailures, verificationExternalRefs, verificationValidity, type VerificationState } from './external-core.js';
import type { StoreContext } from './internal.js';
import { getWorkItemRow } from './internal.js';

const n = (v: unknown): number => Number(v ?? 0);

// Run failure codes by cause family: read from the ONE run-failure vocabulary the governed runtime emits
// (R2-12), never a hand-copied list. An unclassified code (e.g. a local SETTLEMENT_FAILED) evidences no cause.
const PROVIDER_CODES = runFailureCodesOf('PROVIDER');
const MODEL_CODES = runFailureCodesOf('MODEL');
const TOOL_CODES = runFailureCodesOf('TOOL');
const CONTEXT_CODES = runFailureCodesOf('CONTEXT');
const WORKFLOW_CODES = runFailureCodesOf('WORKFLOW');
const REQUIREMENT_CODES = runFailureCodesOf('REQUIREMENT');
const BOUNDARY_CODES = runFailureCodesOf('BOUNDARY');

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

/**
 * A Work Item's verification as every C6 reader sees it: the decisive one (the end of its replacement chain), else the
 * latest. C7-A: with its CURRENT validity — a verification whose external evidence later had an integrity conflict is
 * CONTESTED until the Founder upholds, replaces or retracts it; only a `current` one is outcome truth.
 */
export function latestVerdict(ctx: StoreContext, workItemId: Id): { id: Id; verdict: 'ACHIEVED' | 'NOT_ACHIEVED' | 'INCONCLUSIVE'; validity: VerificationState; current: boolean } | null {
  const unreplaced = `work_item_id = ? AND NOT EXISTS (SELECT 1 FROM outcome_verifications n WHERE n.replaces_verification_id = v.id)`;
  const decisive = ctx.db.get<{ id: string; verdict: string }>(`SELECT id, verdict FROM outcome_verifications v WHERE ${unreplaced} AND verdict <> 'INCONCLUSIVE' LIMIT 1`, workItemId);
  const any = decisive ?? ctx.db.get<{ id: string; verdict: string }>(`SELECT id, verdict FROM outcome_verifications v WHERE ${unreplaced} ORDER BY created_at DESC, id DESC LIMIT 1`, workItemId);
  if (!any) return null;
  const validity = verificationValidity(ctx, any.id as Id);
  return { id: any.id as Id, verdict: any.verdict as 'ACHIEVED' | 'NOT_ACHIEVED' | 'INCONCLUSIVE', validity: validity.state, current: validity.state === 'VALID' || validity.state === 'UPHELD' };
}

/** Builds the evaluator's view of one Work Item. Deterministic for a given database state. */
export function gatherWorkEvidence(ctx: StoreContext, workItemId: Id): { evidence: WorkEvidence; refs: string[] } {
  const w = getWorkItemRow(ctx, workItemId);
  const { employeeId, departmentId } = subjectOf(ctx, workItemId);
  const transitions = new Set(ctx.db.all<{ to_state: string }>('SELECT DISTINCT to_state FROM work_item_transitions WHERE work_item_id = ?', workItemId).map((r) => r.to_state));
  const completed = transitions.has('COMPLETED') || ['COMPLETED', 'WAITING_REVIEW', 'REVIEWED', 'OUTCOME_VERIFIED'].includes(w.state);
  const reviewed = transitions.has('REVIEWED') || w.state === 'REVIEWED' || w.state === 'OUTCOME_VERIFIED';
  const recorded = latestVerdict(ctx, workItemId);
  // C7-A: a verification that is not current (contested by a later integrity conflict on its external evidence, or
  // retracted) is history, never outcome truth: no current outcome, and a contested one is conflicting evidence.
  const verdict = recorded?.current ? recorded : null;
  const contested = recorded?.validity === 'CONTESTED' ? recorded : null;
  // C7-A: governed external evidence enters only through C6's own paths — the verification that cited it (usable,
  // Founder-bound outcome evidence), and Founder-bound external dependency failures. Never inferred, never a verdict.
  const externalCited = verdict === null ? [] : verificationExternalRefs(ctx, verdict.id);
  const externalFailures = externalDependencyFailures(ctx, workItemId);

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
  // A contested verification is still recorded evidence — evidence in dispute, which the evaluator states as a conflict.
  if (verdict !== null || contested !== null) classes.add('OUTCOME_VERIFICATION');
  if (runs.length > 0) classes.add('RUN_TRACE');
  if (toolRows.length > 0) classes.add('TOOL_RESULT');
  if (artifacts > 0) classes.add('ARTIFACT');
  if (usage.length > 0) classes.add('COST_USAGE');
  if (rework > 0) classes.add('REWORK');
  if (escalations + founderInterventions > 0) classes.add('INTERVENTION');
  if (ctx.db.get('SELECT 1 AS x FROM academy_attempts WHERE work_item_id = ?', workItemId)) classes.add('ACADEMY');
  if (externalCited.length > 0) classes.add('EXTERNAL_OUTCOME');
  const evidence: WorkEvidence = {
    workItemId,
    employeeId,
    departmentId,
    comparableKey: comparableKeyOf(w.processorKind, w.processorInput),
    riskLevel: risk,
    completed,
    reviewed,
    outcome: verdict?.verdict ?? null,
    // Present only when contested, so an uncontested Work Item's evidence (and its digest) is unchanged.
    ...(contested ? { outcomeContested: true } : {}),
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
      external: externalFailures.length,
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
  // A contested verification is cited with the conflicts that contest it: the evaluation says what it could not trust.
  const contestRefs = contested ? [`outcome_verification:${contested.id}`, ...verificationValidity(ctx, contested.id).conflictIds.map((id) => `external_record_conflict:${id}`)] : [];
  const refs = [`work_item:${workItemId}`, ...decisions.map((d) => `review_decision:${d.id}`), ...(verdict ? [`outcome_verification:${verdict.id}`] : []), ...contestRefs, ...externalCited, ...externalFailures, ...runs.map((r) => `run:${r.id}`)].slice(0, EVIDENCE_REF_CAP);
  return { evidence, refs };
}

/** The bound on an evaluation's (and so its attribution's) evidence references. */
export const EVIDENCE_REF_CAP = 60;

// ---------------------------------------------------------------------------------------------------------
// FB-1: adverse source events — learning is timed by the event that happened, not the date someone judged it.

/** One adverse source event of a Work Item with its durable provenance (ids, kinds and times only; Rule A). */
export interface AdverseSourceRow {
  readonly sourceRef: string;
  readonly kind: AdverseSourceKind;
  /** The Employee's act the event judges: its start and end (null = unknown). */
  readonly actStartedAt: string | null;
  readonly actEndedAt: string | null;
  /** When the event itself was recorded (the decision / the run's end / the verification). */
  readonly recordedAt: string;
}

/**
 * Every adverse source event of a Work Item, read from the canonical rows that ARE the events (the same sources the
 * evaluator's `adverseOutcome` reads), each with the time of the act it judges:
 * - a counting REQUIRED review decision that FAILED — an OUTPUT review judges the run its subject names (`run:<id>`,
 *   bound when the request was created); an ACTION review judges the action requested at the request's creation;
 * - a run that failed without the work getting past it (FAILED_PERMANENT, or failed after the last success — R2-13),
 *   or an authority-boundary refusal — that run;
 * - the decisive NOT_ACHIEVED outcome verification — the run that produced the verified output (a pool verification's
 *   reviewed subject; a Founder verification's latest successful run before it).
 */
export function adverseSourceEvents(ctx: StoreContext, workItemId: Id): AdverseSourceRow[] {
  const runs = ctx.db.all<{ id: string; state: string; failure_code: string | null; started_at: string; ended_at: string | null }>('SELECT id, state, failure_code, started_at, ended_at FROM runs WHERE work_item_id = ? ORDER BY started_at, run_seq', workItemId);
  const runById = new Map(runs.map((r) => [r.id, r]));
  const runAct = (ref: string | null | undefined): { actStartedAt: string | null; actEndedAt: string | null } => {
    const m = ref ? /^run:([0-9a-f-]{36})$/.exec(ref) : null;
    const r = m ? runById.get(m[1] ?? '') : undefined;
    return r ? { actStartedAt: r.started_at, actEndedAt: r.ended_at } : { actStartedAt: null, actEndedAt: null };
  };
  const out: AdverseSourceRow[] = [];
  for (const d of ctx.db.all<{ id: string; created_at: string; subject_kind: string; subject_ref: string; requested_at: string }>(
    `SELECT d.id, d.created_at, r.subject_kind, r.subject_ref, r.created_at AS requested_at FROM review_decisions d JOIN review_requests r ON r.id = d.request_id
      WHERE r.work_item_id = ? AND r.kind = 'REQUIRED' AND d.counts = 1 AND d.outcome = 'FAIL' ORDER BY d.created_at, d.id`,
    workItemId,
  )) {
    const act = d.subject_kind === 'ACTION' ? { actStartedAt: d.requested_at, actEndedAt: d.requested_at } : runAct(d.subject_ref);
    out.push({ sourceRef: `review_decision:${d.id}`, kind: 'REVIEW_DECISION', ...act, recordedAt: d.created_at });
  }
  const lastSuccess = runs.map((r) => r.state).lastIndexOf('SUCCEEDED');
  runs.forEach((r, i) => {
    const failed = (r.state === 'FAILED_PERMANENT' || r.state === 'FAILED_RETRYABLE') && (r.state === 'FAILED_PERMANENT' || i > lastSuccess);
    const boundary = r.failure_code !== null && (BOUNDARY_CODES as readonly string[]).includes(r.failure_code);
    if (failed || boundary) out.push({ sourceRef: `run:${r.id}`, kind: 'RUN_FAILURE', actStartedAt: r.started_at, actEndedAt: r.ended_at, recordedAt: r.ended_at ?? r.started_at });
  });
  const verdict = latestVerdict(ctx, workItemId);
  // C7-A: a verification that is not current truth (contested / retracted) is no adverse event of the Employee's act.
  if (verdict?.verdict === 'NOT_ACHIEVED' && verdict.current) {
    const v = ctx.db.get<{ created_at: string; review_request_id: string | null }>('SELECT created_at, review_request_id FROM outcome_verifications WHERE id = ?', verdict.id);
    if (v) {
      const subject = v.review_request_id === null
        ? ctx.db.get<{ ref: string }>(`SELECT 'run:' || id AS ref FROM runs WHERE work_item_id = ? AND state = 'SUCCEEDED' AND ended_at <= ? ORDER BY ended_at DESC, rowid DESC LIMIT 1`, workItemId, v.created_at)?.ref
        : ctx.db.get<{ ref: string }>('SELECT subject_ref AS ref FROM review_requests WHERE id = ?', v.review_request_id)?.ref;
      out.push({ sourceRef: `outcome_verification:${verdict.id}`, kind: 'OUTCOME_VERIFICATION', ...runAct(subject), recordedAt: v.created_at });
    }
  }
  return out;
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
  evidence_json: string;
  work_started_at: string;
}

/** A stored evaluation with the time its work started (R2-15). */
export type StoredEvaluationFact = EvaluationFact & { readonly workStartedAt: string };

export function toEvaluationFact(r: EvalRow): StoredEvaluationFact {
  const dims = JSON.parse(r.dimensions_json) as { dimension: ItemDimension; verdict: Verdict }[];
  const cost = JSON.parse(r.cost_json) as Record<string, number>;
  const obs = JSON.parse(r.observability_json) as Record<string, number>;
  // RR3: the evaluator records `attributionDue` with the evaluation. A row written before it carries none: its due
  // attribution was recorded in the same transaction (evaluate), so its attribution state alone decides.
  const due = (JSON.parse(r.evidence_json) as { attributionDue?: unknown }).attributionDue === true;
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
    attributionDue: due,
  };
}

/**
 * R2-14: the unit of evidence is the Work Item. Of its live evaluations (one per definition — several versions of
 * a code in a database written before the fix, or several codes), only the LATEST speaks for it in every profile,
 * report, economics and health read.
 */
export const LATEST_LIVE_EVALUATION = `e.superseded_by IS NULL AND NOT EXISTS (SELECT 1 FROM evaluation_results n WHERE n.work_item_id = e.work_item_id AND n.superseded_by IS NULL AND (n.created_at > e.created_at OR (n.created_at = e.created_at AND n.rowid > e.rowid)))`;

// R2-15: when the work itself started — its first run, else its creation — never the evaluation's time. (FB-1: adverse
// learning evidence is timed per source event — `adverseSourceEvents` — never by a Work-Item-level "last worked" time.)
const LIVE_EVALS = `SELECT e.id, e.work_item_id, e.comparable_key, e.risk_level, e.created_at, e.evidence_state, e.qualified_outcome, e.dimensions_json, e.cost_json, e.observability_json, e.evidence_json,
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

/**
 * RR3: the attribution of each Work Item as EVERY reader sees it (profile, readiness, learning effect, reports): its
 * live one (its undecided generation, else its VALIDATED generations collapsed), else its latest REJECTED one (a decided "no accountable
 * cause"), else none. `adverseStanding` gives each of these states its one meaning.
 */
export function attributionFacts(ctx: StoreContext, employeeId: Id): AttributionFact[] {
  const out = new Map<string, AttributionFact>();
  const rows = ctx.db.all<{ work_item_id: string; state: string; employee_accountable: number; overall: string }>(
    `SELECT work_item_id, state, employee_accountable, overall FROM causal_attributions WHERE employee_id = ? AND state IN ('PROPOSED', 'VALIDATED', 'REJECTED') ORDER BY updated_at, rowid`,
    employeeId,
  );
  // RB-1: one Work Item is one unit whatever its generations — an undecided generation speaks first (pending, never
  // clean), else its VALIDATED generations (accountable when any is), else its latest REJECTED one.
  const rank = { PROPOSED: 3, VALIDATED: 2, REJECTED: 1 } as const;
  for (const r of rows) {
    const prior = out.get(r.work_item_id);
    const state = r.state as AttributionFact['state'] & keyof typeof rank;
    const next = { workItemId: r.work_item_id, state, employeeAccountable: r.employee_accountable === 1, overall: r.overall };
    if (prior === undefined || rank[state] > rank[prior.state as keyof typeof rank]) out.set(r.work_item_id, next);
    else if (state === prior.state && state === 'VALIDATED') out.set(r.work_item_id, prior.employeeAccountable && !next.employeeAccountable ? prior : next);
    else if (state === prior.state) out.set(r.work_item_id, next);
  }
  return [...out.values()];
}

/** A validated attribution with the time it was decided (a VALIDATED row is not updated again while it stays VALIDATED). */
export type DecidedAttributionFact = ValidatedAttributionFact & { readonly decidedAt: string };

export function validatedAttributionFacts(ctx: StoreContext): DecidedAttributionFact[] {
  return ctx.db
    .all<{ id: string; work_item_id: string; employee_id: string | null; comparable_key: string; overall: string; causes_json: string; updated_at: string }>(`SELECT id, work_item_id, employee_id, comparable_key, overall, causes_json, updated_at FROM causal_attributions WHERE state = 'VALIDATED' ORDER BY created_at, id`)
    .map((r) => ({ attributionId: r.id, workItemId: r.work_item_id, employeeId: r.employee_id, comparableKey: r.comparable_key, overall: r.overall as ValidatedAttributionFact['overall'], causes: JSON.parse(r.causes_json) as ValidatedAttributionFact['causes'], decidedAt: r.updated_at }));
}

type AttributionRow = {
  id: string;
  work_item_id: string;
  employee_id: string | null;
  state: string;
  employee_accountable: number;
  causes_json: string;
  evidence_refs_json: string;
  created_at: string;
  updated_at: string;
};

const primaryCauses = (causesJson: string): DirectCause[] => (JSON.parse(causesJson) as { category: DirectCause; role: string }[]).filter((c) => c.role === 'PRIMARY').map((c) => c.category);

/**
 * FB-1 (B2 / B6 / B7): the ONE attribution that explains an adverse source event — an attribution explains exactly the
 * events its evidence held (its proposing evaluation's references; a Founder-corrected attribution carries its
 * proposal's references, so the event keeps its original time). The first DECIDED attribution of an event stands
 * for it (a later proposal after a REJECT establishes causes for the new events only); an undecided proposal makes
 * it pending. Superseded proposals explain nothing.
 */
function explainEvent(e: AdverseSourceRow, fact: StoredEvaluationFact, rows: readonly AttributionRow[], employeeId: Id): AdverseSourceEvent {
  const holds = rows.filter((a) => (JSON.parse(a.evidence_refs_json) as string[]).includes(e.sourceRef));
  const decided = holds.filter((a) => a.state === 'VALIDATED' || a.state === 'REJECTED').sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.created_at < b.created_at ? -1 : 1))[0];
  const explaining = decided ?? holds.find((a) => a.state === 'PROPOSED');
  const event = { sourceRef: e.sourceRef, kind: e.kind, actStartedAt: e.actStartedAt, actEndedAt: e.actEndedAt };
  if (explaining) {
    const accountable = explaining.state === 'VALIDATED' && explaining.employee_accountable === 1 && explaining.employee_id === employeeId;
    return { ...event, attributionRef: `causal_attribution:${explaining.id}`, attributionState: explaining.state as AttributionState, attributionDue: true, accountableCauses: accountable ? primaryCauses(explaining.causes_json) : [], attributionUnresolved: false };
  }
  const none = { ...event, attributionRef: null, attributionState: 'NONE' as const, accountableCauses: [] };
  // Recorded after the Work Item's live evaluation: not yet evaluated — its attribution is still to come (pending).
  if (e.recordedAt > fact.at) return { ...none, attributionDue: true, attributionUnresolved: false };
  // An attribution whose evidence references hit their bound may hold it unlisted: the record cannot tell who explains it.
  const capped = rows.some((a) => (JSON.parse(a.evidence_refs_json) as string[]).length >= EVIDENCE_REF_CAP && a.created_at >= e.recordedAt);
  if (capped) return { ...none, attributionDue: false, attributionUnresolved: true };
  // RB-1 / RB-2: an undecided generation exists — the new event waits for it to be decided (then the next evaluation
  // gives the events no decided generation covers their own generation): pending, never clean, never unresolvable.
  if (rows.some((a) => a.state === 'PROPOSED')) return { ...none, attributionState: 'PROPOSED', attributionDue: true, attributionUnresolved: false };
  return { ...none, attributionDue: fact.attributionDue, attributionUnresolved: false };
}

/**
 * Evaluations of one Employee's comparable work for learning-effect assessment: each with the time its work started
 * (R2-15), its Work Item attribution as every reader sees it (`attributionFacts`) and validated accountable causes
 * (the baseline share), and — FB-1 — every adverse source event of the work with its own act time and the ONE
 * attribution that explains it (`explainEvent`). No Work-Item-level time or verdict decides when a mistake happened.
 */
export function followupFacts(ctx: StoreContext, employeeId: Id, comparableKey: string): FollowupFact[] {
  const accountable = new Map<string, DirectCause[]>();
  // RB-1: several VALIDATED generations of one Work Item collapse to that ONE Work Item (the union of its causes).
  for (const r of ctx.db.all<{ work_item_id: string; causes_json: string }>(`SELECT work_item_id, causes_json FROM causal_attributions WHERE state = 'VALIDATED' AND employee_accountable = 1 AND employee_id = ? ORDER BY created_at, rowid`, employeeId)) {
    accountable.set(r.work_item_id, [...new Set([...(accountable.get(r.work_item_id) ?? []), ...primaryCauses(r.causes_json)])]);
  }
  const attribution = new Map(attributionFacts(ctx, employeeId).map((a) => [a.workItemId, a.state]));
  return liveEvaluations(ctx, { employeeId })
    .filter((f) => f.comparableKey === comparableKey)
    .map((f) => {
      const rows = ctx.db.all<AttributionRow>(
        `SELECT id, work_item_id, employee_id, state, employee_accountable, causes_json, evidence_refs_json, created_at, updated_at FROM causal_attributions WHERE work_item_id = ? AND state IN ('PROPOSED', 'VALIDATED', 'REJECTED') ORDER BY created_at, rowid`,
        f.workItemId,
      );
      const adverseEvents = adverseSourceEvents(ctx, f.workItemId as Id).map((e) => explainEvent(e, f, rows, employeeId));
      return { ...f, attributionState: attribution.get(f.workItemId) ?? 'NONE', accountableCauses: accountable.get(f.workItemId) ?? [], adverseEvents };
    });
}
