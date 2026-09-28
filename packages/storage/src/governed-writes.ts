/**
 * Fenced C2 execution writes (runtime-authority only, D-C1-22). Each function runs inside one
 * short write transaction opened by `runtime-authority.ts` and presents the run's job fence:
 * a replaced or expired worker can neither reserve budget, record a tool intent nor attribute a run.
 *
 * Settlement and results are the one deliberate exception to lease validity: recording what really
 * happened (actual spend, a tool's actual result) is truthful history, not new authority, so it is
 * accepted from the same worker (same run and fencing token) even after its lease expired.
 *
 * Authorization is re-evaluated at every action boundary (D14-C.6): employee eligibility, grants,
 * risk ladder, approvals, egress and budgets are read inside the same transaction that records the
 * intent or the reservation.
 */
import { QandeelError, canonicalJson, hasSecretNamedKey, isQandeelError, newId, sha256Hex, type Id, type JsonObject, type Timestamp } from '@qandeel-company/domain';
import { containsSecretMaterial } from '@qandeel-company/mind';
import {
  AUTO_PAUSE_DENIALS_PER_RUN,
  CONTAINMENT_SIGNALS,
  CIRCUIT_OPEN_MS,
  CIRCUIT_THRESHOLD,
  FAILURE_DISPOSITIONS,
  addMoney,
  approvalFingerprint,
  approvalUsable,
  assertArgsSchema,
  assertCognitiveProfile,
  canExecute,
  checkReservation,
  dataRank,
  isDataClass,
  isReasoningClass,
  maxDataClass,
  reasoningRank,
  decideEmployeeAction,
  toolCapability,
  validateArgs,
  type AttemptKind,
  type CognitiveProfile,
  type DataClass,
  type ProviderFailureClass,
  type RoutePolicy,
  externalEgressAvailable,
} from '@qandeel-company/governance';

import {
  applyBudgetDelta,
  budgetChain,
  budgetFor,
  employeeIdFromRef,
  getEmployeeRow,
  getReservationRow,
  holdReservationTx,
  releaseReservationTx,
  setEmployeeState,
  settleReservationTx,
  wakeWorkItemJob,
  type SettleUsage,
} from './governance-core.js';
import { mapApproval, mapGrant, mapReservation, mapToolAction, mapToolInvocation, type BudgetRecord, type ReservationRecord, type ToolInvocationRecord } from './governance-records.js';
import { routingSnapshotTx, upsertApprovalRequest, workItemDataClass } from './governance.js';
import { appendAudit, appendEvent, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { enforceRoleCertification } from './mind-core.js';
import { academyExecutionMode, academyRun, constrainedRun, contextClassOf, manifestForReservation, txCapabilityGate } from './mind-writes.js';
import { verifyFence } from './queue.js';
import type { Fence } from './records.js';

export const SYSTEM_RUNTIME_REF = 'system:runtime';

export interface GovernedRunContext {
  readonly runId: Id;
  readonly workItemId: Id;
  readonly employeeId: Id;
  readonly employeeRef: string;
  readonly departmentId: Id;
  readonly cognitiveProfile: CognitiveProfile;
  /** Highest data class of this run's context (declared on the Work Item; the model cannot lower it). */
  readonly dataClass: DataClass;
  /** ACTIVE duty, or constrained Academy / shadow execution by a non-ACTIVE Employee (C3, Stage 6 §11). */
  readonly executionMode: 'ACTIVE' | 'ACADEMY_ATTEMPT' | 'SHADOW_WORK';
  /**
   * R1-03: the first Work-Item-global step of this job. A processor's loop step counts per job (its
   * checkpoints are per job), but idempotency keys, step results and memory candidates are keyed per
   * Work Item. The runtime adds this durable base (job ordinal × GOVERNED_STEP_SPAN) so a re-released
   * Work Item's new job can never collide with — or silently replay — an earlier job's actions, while a
   * resumed run of the SAME job still presents the same keys. The first job's base is 0.
   */
  readonly stepBase: number;
}

/** Steps one governed job may use (the employee loop allows at most 32 turns). */
export const GOVERNED_STEP_SPAN = 100;

/** The durable step bound (migration 0005 CHECKs, the Tool Executor's limit). */
export const MAX_GOVERNED_STEP = 100_000;

export type BeginResult =
  | { readonly ok: true; readonly context: GovernedRunContext }
  | { readonly ok: false; readonly code: 'EMPLOYEE_NOT_ELIGIBLE' | 'NOT_EMPLOYEE_OWNED' | 'CAPABILITY_GAP_CANCELLED' | 'STEP_RANGE_EXHAUSTED'; readonly state: string | null }
  /** C3: the owning Employee does not meet the Work Item's capability requirements (durable gap, work parked). */
  | { readonly ok: false; readonly code: 'CAPABILITY_GAP'; readonly state: string | null; readonly gapId: Id };

function denyAudit(ctx: StoreContext, runId: Id, action: string, code: string, details: Record<string, string | number | boolean | null> = {}): void {
  appendAudit(ctx, action, 'run', runId, { actorRef: SYSTEM_RUNTIME_REF }, 'REJECTED', code, details);
}

/** Binds the run to its Employee (Work Item → Run → Employee → Department) after an eligibility check. */
export function txBeginGovernedRun(ctx: StoreContext, fence: Fence): BeginResult {
  const job = verifyFence(ctx, fence);
  const item = getWorkItemRow(ctx, job.workItemId);
  const employeeId = employeeIdFromRef(item.ownerRef);
  if (employeeId === null) {
    denyAudit(ctx, fence.runId, 'run.not_governed', 'NOT_EMPLOYEE_OWNED');
    return { ok: false, code: 'NOT_EMPLOYEE_OWNED', state: null };
  }
  // D-C3-18: an ACTIVE Employee whose current-role certification was revoked / has expired moves to
  // RETRAINING here, before anything executes, and so starts no ordinary run.
  const e = enforceRoleCertification(ctx, getEmployeeRow(ctx, employeeId));
  // A non-ACTIVE Employee executes only its own open Academy attempt or shadow assignment (C3); an
  // Academy attempt runs in its constrained mode whoever takes it.
  const academyMode = academyExecutionMode(ctx, fence.runId, item, e);
  if (!canExecute(e.state) && academyMode === null) {
    denyAudit(ctx, fence.runId, 'authority.denied', 'EMPLOYEE_NOT_ELIGIBLE', { employeeId, state: e.state });
    return { ok: false, code: 'EMPLOYEE_NOT_ELIGIBLE', state: e.state };
  }
  // Capability eligibility is decided before any model or tool call; a gap parks the work (C3).
  const gate = txCapabilityGate(ctx, item, e);
  if (!gate.ok) {
    if (gate.cancelled) {
      denyAudit(ctx, fence.runId, 'run.not_governed', 'CAPABILITY_GAP_CANCELLED', { gapId: gate.gapId });
      return { ok: false, code: 'CAPABILITY_GAP_CANCELLED', state: e.state };
    }
    return { ok: false, code: 'CAPABILITY_GAP', state: e.state, gapId: gate.gapId };
  }
  // R1-03: this job's Work-Item-global step range (insertion order of the item's jobs is durable and
  // immutable — jobs are never deleted). A range past the durable step bound (0..100000) is refused
  // with a typed code before anything executes, never mid-run after an effect.
  const stepBase = GOVERNED_STEP_SPAN * Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM queue_jobs WHERE work_item_id = ? AND rowid < (SELECT rowid FROM queue_jobs WHERE id = ?)', item.id, fence.jobId)?.n ?? 0);
  if (stepBase + GOVERNED_STEP_SPAN - 1 > MAX_GOVERNED_STEP) {
    denyAudit(ctx, fence.runId, 'run.not_governed', 'STEP_RANGE_EXHAUSTED', { workItemId: item.id });
    return { ok: false, code: 'STEP_RANGE_EXHAUSTED', state: e.state };
  }
  if (!ctx.db.get('SELECT 1 AS ok FROM run_attributions WHERE run_id = ?', fence.runId)) {
    ctx.db.run('INSERT INTO run_attributions (run_id, work_item_id, employee_id, department_id, created_at) VALUES (?, ?, ?, ?, ?)', fence.runId, item.id, e.id, e.departmentId, ts(ctx));
    appendEvent(ctx, 'run.attributed', 'run', fence.runId, { correlationId: item.correlationId }, { employeeId: e.id, departmentId: e.departmentId, workItemId: item.id });
  }
  // Deeply immutable: the processor holds this object, and nothing it does to it can lower the data
  // class or raise the ceiling (the model path also re-derives both from durable state per call).
  const context: GovernedRunContext = Object.freeze({
    runId: fence.runId,
    workItemId: item.id,
    employeeId: e.id,
    employeeRef: e.ref,
    departmentId: e.departmentId,
    cognitiveProfile: Object.freeze({ ...assertCognitiveProfile(e.cognitiveProfile) }),
    dataClass: workItemDataClass(item.processorInput),
    executionMode: academyMode ?? 'ACTIVE',
    stepBase,
  });
  return { ok: true, context };
}

/**
 * The run context's effective data class (D14-B.1): the Work Item's declared class raised by the
 * result class of every tool result already fed into this Work Item's context. Durable, never
 * lowered, never supplied by the processor or the model.
 */
export function effectiveDataClass(ctx: StoreContext, workItemId: Id): DataClass {
  const declared = workItemDataClass(getWorkItemRow(ctx, workItemId).processorInput);
  const results = ctx.db.all<{ c: string }>(`SELECT DISTINCT a.result_data_class AS c FROM tool_invocations i JOIN tool_actions a ON a.id = i.tool_action_id WHERE i.work_item_id = ? AND i.state = 'SUCCEEDED'`, workItemId);
  // C3: whatever an assembled context contained (memory, knowledge, skills) raises the class too, so the
  // model's later output — e.g. tool arguments — can never carry it past a lower egress ceiling.
  return maxDataClass(declared, contextClassOf(ctx, workItemId), ...results.map((r) => r.c).filter(isDataClass));
}

/** The lifecycle state the authority kernel sees: a constrained Academy / shadow run acts as eligible. */
function actingState(ctx: StoreContext, runId: Id, e: ReturnType<typeof getEmployeeRow>): ReturnType<typeof getEmployeeRow>['state'] {
  return canExecute(e.state) || constrainedRun(ctx, runId, e) ? 'ACTIVE' : e.state;
}

interface Attributed {
  readonly employeeId: Id;
  readonly departmentId: Id;
  readonly workItemId: Id;
}

function attributed(ctx: StoreContext, fence: Fence): Attributed {
  const a = ctx.db.get<{ employee_id: string; department_id: string; work_item_id: string }>('SELECT employee_id, department_id, work_item_id FROM run_attributions WHERE run_id = ?', fence.runId);
  if (!a) throw new QandeelError('AUTHORITY_DENIED', 'the run was not attributed to an eligible employee', { runId: fence.runId, reason: 'RUN_NOT_ATTRIBUTED' });
  return { employeeId: a.employee_id as Id, departmentId: a.department_id as Id, workItemId: a.work_item_id as Id };
}

/** Counts this run's authority denials and pauses the employee at the containment threshold. */
function recordDenial(ctx: StoreContext, fence: Fence, employeeId: Id, code: string, details: Record<string, string | number | boolean | null>): { paused: boolean } {
  // Ordinary failures (unknown tool, invalid arguments, a Founder rejection) are audited but never
  // counted toward containment; only authority / bypass signals are (Stage 3 §9).
  if (!CONTAINMENT_SIGNALS.has(code)) {
    denyAudit(ctx, fence.runId, 'tool.refused', code, { employeeId, ...details });
    return { paused: false };
  }
  denyAudit(ctx, fence.runId, 'authority.denied', code, { employeeId, ...details });
  const n = Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ? AND action = 'authority.denied'`, fence.runId)?.n ?? 0);
  const e = getEmployeeRow(ctx, employeeId);
  if (n >= AUTO_PAUSE_DENIALS_PER_RUN && e.state === 'ACTIVE') {
    setEmployeeState(ctx, e, 'PAUSED', 'AUTO_PAUSE_AUTHORITY_DENIALS', SYSTEM_RUNTIME_REF);
    return { paused: true };
  }
  return { paused: false };
}

export type AuthorizeResult = { readonly ok: true; readonly grantId: Id; readonly dataClass: DataClass } | { readonly ok: false; readonly code: string; readonly paused: boolean };

function consumeGrant(ctx: StoreContext, grantId: Id): void {
  ctx.db.run(`UPDATE permission_grants SET uses = uses + 1 WHERE id = ? AND status = 'ACTIVE' AND (max_uses IS NULL OR uses < max_uses)`, grantId);
}

/** `model.invoke` for this task class and data class (R0 read / analyze), re-checked per call. */
export function txAuthorizeModelCall(ctx: StoreContext, fence: Fence, input: { taskClass: string; dataClass: DataClass }): AuthorizeResult {
  verifyFence(ctx, fence);
  const a = attributed(ctx, fence);
  const e = enforceRoleCertification(ctx, getEmployeeRow(ctx, a.employeeId));
  // The durable Work Item's data class governs; a caller may only raise it, never lower it.
  const dataClass = maxDataClass(effectiveDataClass(ctx, a.workItemId), input.dataClass);
  const grants = ctx.db.all(`SELECT * FROM permission_grants WHERE employee_id = ? AND status = 'ACTIVE'`, e.id).map(mapGrant);
  const d = decideEmployeeAction('EMPLOYEE', actingState(ctx, fence.runId, e), grants, { capability: 'model.invoke', resource: input.taskClass, risk: 'R0', dataClass, at: ts(ctx) });
  if (d.effect === 'DENY') return { ok: false, code: d.code, ...recordDenial(ctx, fence, e.id, d.code, { capability: 'model.invoke' }) };
  consumeGrant(ctx, d.grantId as Id);
  return { ok: true, grantId: d.grantId as Id, dataClass };
}

export type ReserveInput =
  /** A model call is reserved only against its own OK Context Manifest (C3: every inference is assembled). */
  | { readonly purpose: 'MODEL_CALL'; readonly attemptKind: AttemptKind; readonly deploymentId: Id; readonly priceCardId: Id; readonly routePolicyId: Id; readonly money: number; readonly tokens: number; readonly contextManifestId: Id }
  | { readonly purpose: 'TOOL_CALL'; readonly attemptKind: 'PRIMARY'; readonly toolActionId: Id; readonly money: number; readonly tokens: 0 };

export type ReserveResult = { readonly ok: true; readonly reservation: ReservationRecord } | { readonly ok: false; readonly code: 'BUDGET_MISSING' | 'BUDGET_EXHAUSTED' | 'EMPLOYEE_NOT_ELIGIBLE' | 'ROUTE_NO_LONGER_ELIGIBLE' | 'RUN_LIMIT' | 'CONTEXT_MANIFEST_REQUIRED'; readonly detail: string };

/** The Work Item budget and its chain, verified to hang under this employee and department. */
function workItemChain(ctx: StoreContext, a: Attributed): BudgetRecord[] | null {
  const wi = budgetFor(ctx, 'WORK_ITEM', a.workItemId);
  if (!wi) return null;
  const chain = budgetChain(ctx, wi.id);
  const [, emp, dept] = chain;
  if (emp?.scope !== 'EMPLOYEE' || emp.scopeId !== a.employeeId || dept?.scope !== 'DEPARTMENT' || dept.scopeId !== a.departmentId) return null;
  return chain;
}

function runBudget(ctx: StoreContext, fence: Fence, wiChain: BudgetRecord[]): BudgetRecord[] {
  const existing = budgetFor(ctx, 'RUN', fence.runId);
  if (existing) return budgetChain(ctx, existing.id);
  const wi = wiChain[0] as BudgetRecord;
  const id = newId();
  ctx.db.run(
    `INSERT INTO budgets (id, scope, scope_id, parent_id, currency, cap_money, cap_tokens, version, created_by_ref, created_at, updated_at) VALUES (?, 'RUN', ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    id,
    fence.runId,
    wi.id,
    wi.currency,
    Math.min(wi.runCapMoney ?? wi.capMoney, wi.capMoney),
    Math.min(wi.runCapTokens ?? wi.capTokens, wi.capTokens),
    SYSTEM_RUNTIME_REF,
    ts(ctx),
    ts(ctx),
  );
  return budgetChain(ctx, id);
}

function policyById(ctx: StoreContext, id: Id): RoutePolicy {
  const r = ctx.db.get<{ task_class: string; status: string }>('SELECT task_class, status FROM route_policies WHERE id = ?', id);
  const snap = r ? routingSnapshotTx(ctx, r.task_class) : null;
  if (!r || r.status !== 'ACTIVE' || !snap?.policy || snap.policy.id !== id) throw new QandeelError('NO_ELIGIBLE_ROUTE', 'the route policy is no longer active', { routePolicyId: id });
  return snap.policy;
}

/**
 * Reserves worst-case spend before a call (D13-G.5) against the Run budget and every ancestor,
 * atomically: either every level has headroom and all are reserved, or nothing is. Also enforces
 * the per-Run call ceiling, escalation depth and retry/fallback/escalation overhead ceiling.
 */
export function txReserve(ctx: StoreContext, fence: Fence, input: ReserveInput): ReserveResult {
  const job = verifyFence(ctx, fence);
  const a = attributed(ctx, fence);
  // D-C3-18: re-checked per reservation, so a run begun before the loss spends nothing after it.
  const e = enforceRoleCertification(ctx, getEmployeeRow(ctx, a.employeeId));
  if (!canExecute(e.state) && !constrainedRun(ctx, fence.runId, e)) return { ok: false, code: 'EMPLOYEE_NOT_ELIGIBLE', detail: e.state };
  const refuse = (code: Extract<ReserveResult, { ok: false }>['code'], detail: string): ReserveResult => {
    appendAudit(ctx, 'budget.refused', 'run', fence.runId, { actorRef: SYSTEM_RUNTIME_REF }, 'REJECTED', code, { detail: detail.slice(0, 64), purpose: input.purpose, attemptKind: input.attemptKind });
    return { ok: false, code, detail };
  };
  if (input.purpose === 'MODEL_CALL') {
    const d = ctx.db.get<{ status: string; price_card_id: string | null; circuit_open_until: string | null; provider_status: string; locality: string; egress_max_data_class: string | null; reasoning_class: string; qualification: string; task_classes_json: string }>(
      `SELECT d.status, d.price_card_id, d.circuit_open_until, d.egress_max_data_class, d.reasoning_class, d.qualification, d.task_classes_json, p.status AS provider_status, p.locality
         FROM deployments d JOIN models m ON m.id = d.model_id JOIN model_providers p ON p.id = m.provider_id WHERE d.id = ?`,
      input.deploymentId,
    );
    if (!d || d.status !== 'ACTIVE' || d.provider_status !== 'ACTIVE' || d.price_card_id !== input.priceCardId || (d.circuit_open_until !== null && d.circuit_open_until > ts(ctx))) return refuse('ROUTE_NO_LONGER_ELIGIBLE', 'deployment');
    const policy = policyById(ctx, input.routePolicyId);
    // C3: the reservation pays for one assembled inference; its manifest's class and input bound bind it.
    const manifest = manifestForReservation(ctx, fence.runId, input.contextManifestId);
    if (!manifest) return refuse('CONTEXT_MANIFEST_REQUIRED', 'NO_OK_MANIFEST');
    if (input.tokens < manifest.estimatedInputTokens) return refuse('CONTEXT_MANIFEST_REQUIRED', 'INPUT_BOUND_BELOW_CONTEXT');
    // Hard gates re-checked from durable state inside the reserving transaction (defence in depth:
    // the router ran outside it on inputs a caller could influence). Privacy first.
    const dataClass = maxDataClass(effectiveDataClass(ctx, a.workItemId), manifest.maxDataClass);
    if (dataClass === 'D4' && d.locality !== 'LOCAL') return refuse('ROUTE_NO_LONGER_ELIGIBLE', 'D4_EXTERNAL_DENIED');
    if (!externalEgressAvailable(d.locality, dataClass)) return refuse('ROUTE_NO_LONGER_ELIGIBLE', 'D3_EXTERNAL_DENIED');
    if (!isDataClass(d.egress_max_data_class) || dataRank(d.egress_max_data_class) < dataRank(dataClass)) return refuse('ROUTE_NO_LONGER_ELIGIBLE', 'EGRESS_NOT_APPROVED');
    if (!(d.qualification === 'QUALIFIED' || (d.qualification === 'LIMITED_PRODUCTION' && policy.allowLimitedProduction))) return refuse('ROUTE_NO_LONGER_ELIGIBLE', 'NOT_QUALIFIED');
    if (!(JSON.parse(d.task_classes_json) as string[]).includes(policy.taskClass)) return refuse('ROUTE_NO_LONGER_ELIGIBLE', 'TASK_CLASS_NOT_QUALIFIED');
    const ceiling = assertCognitiveProfile(e.cognitiveProfile).ceilingClass;
    if (!isReasoningClass(d.reasoning_class) || reasoningRank(d.reasoning_class) > reasoningRank(ceiling) || reasoningRank(d.reasoning_class) > reasoningRank(policy.maxClass)) return refuse('ROUTE_NO_LONGER_ELIGIBLE', 'REASONING_ABOVE_CEILING');
    const calls = ctx.db.all(`SELECT attempt_kind, state, money FROM budget_reservations WHERE run_id = ? AND purpose = 'MODEL_CALL'`, fence.runId);
    if (calls.length >= policy.maxCallsPerRun) return refuse('RUN_LIMIT', 'MAX_CALLS_PER_RUN');
    if (input.attemptKind === 'ESCALATION' && calls.filter((c) => c.attempt_kind === 'ESCALATION').length >= policy.escalation.maxDepth) return refuse('RUN_LIMIT', 'ESCALATION_DEPTH');
    if (input.attemptKind !== 'PRIMARY') {
      // Overhead = retry + fallback + escalation spend of this run (held, or charged when settled).
      const overhead = ctx.db
        .all<{ state: string; money: number; charged: number | null }>(
          `SELECT r.state, r.money, u.economic_micros AS charged FROM budget_reservations r LEFT JOIN usage_records u ON u.reservation_id = r.id WHERE r.run_id = ? AND r.attempt_kind <> 'PRIMARY' AND r.state IN ('RESERVED', 'RECONCILIATION_REQUIRED', 'SETTLED')`,
          fence.runId,
        )
        .reduce((sum, r) => addMoney(sum, r.state === 'SETTLED' ? Number(r.charged ?? 0) : Number(r.money)), 0);
      if (addMoney(overhead, input.money) > policy.escalation.maxOverheadMicros) return refuse('RUN_LIMIT', 'OVERHEAD_CEILING');
    }
  }
  const wiChain = workItemChain(ctx, a);
  if (!wiChain) return refuse('BUDGET_MISSING', 'WORK_ITEM_CHAIN');
  const chain = runBudget(ctx, fence, wiChain);
  const check = checkReservation(chain, input.money, input.tokens);
  if (!check.ok) return refuse('BUDGET_EXHAUSTED', `${check.scope}:${check.dimension}`);
  applyBudgetDelta(ctx, chain, { reservedMoney: input.money, reservedTokens: input.tokens });
  const id = newId();
  ctx.db.run(
    `INSERT INTO budget_reservations (id, budget_id, run_id, job_id, fencing_token, work_item_id, employee_id, department_id, purpose, attempt_kind, deployment_id, price_card_id, tool_action_id, route_policy_id, money, tokens, state, created_at, updated_at, context_manifest_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?)`,
    id,
    (chain[0] as BudgetRecord).id,
    fence.runId,
    job.id,
    fence.fencingToken,
    a.workItemId,
    a.employeeId,
    a.departmentId,
    input.purpose,
    input.attemptKind,
    input.purpose === 'MODEL_CALL' ? input.deploymentId : null,
    input.purpose === 'MODEL_CALL' ? input.priceCardId : null,
    input.purpose === 'TOOL_CALL' ? input.toolActionId : null,
    input.purpose === 'MODEL_CALL' ? input.routePolicyId : null,
    input.money,
    input.tokens,
    ts(ctx),
    ts(ctx),
    input.purpose === 'MODEL_CALL' ? input.contextManifestId : null,
  );
  appendAudit(ctx, 'budget.reserved', 'reservation', id, { actorRef: SYSTEM_RUNTIME_REF }, 'OK', null, { runId: fence.runId, purpose: input.purpose, attemptKind: input.attemptKind, money: input.money, tokens: input.tokens });
  return { ok: true, reservation: getReservationRow(ctx, id) };
}

/** The reservation must belong to this worker's run and token (truthful late settlement). */
function ownReservation(ctx: StoreContext, fence: Fence, reservationId: Id): ReservationRecord {
  const r = getReservationRow(ctx, reservationId);
  if (r.runId !== fence.runId || r.fencingToken !== fence.fencingToken) throw new QandeelError('STALE_LEASE', 'this reservation belongs to another run or worker', { reservationId });
  return r;
}

export function txSettle(ctx: StoreContext, fence: Fence, reservationId: Id, usage: SettleUsage): Id | null {
  const r = ownReservation(ctx, fence, reservationId);
  // Usage outside the enforced bounds is a provider contract violation: the deployment is contained in
  // THIS transaction, so the money record and the containment commit together or not at all — a failed
  // health write can never leave a known violator routable (R1-09, Technical Lead follow-up).
  if (r.purpose === 'MODEL_CALL' && r.deploymentId !== null && !usage.withinBounds) txDeploymentOutcome(ctx, fence, r.deploymentId, 'CONTRACT_VIOLATION');
  if (r.state === 'SETTLED' || r.state === 'RELEASED') {
    // Already reconciled by the Founder: the worker's actual usage is still recorded, as a discrepancy.
    appendAudit(ctx, 'budget.late_usage_discrepancy', 'reservation', r.id, { actorRef: SYSTEM_RUNTIME_REF }, 'REJECTED', 'ALREADY_FINAL', { state: r.state, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    return null;
  }
  const id = settleReservationTx(ctx, r, usage, SYSTEM_RUNTIME_REF);
  ctx.fault('settlement.beforeCommit');
  return id;
}

/**
 * A provider answer that itself broke the contract, when its usage cannot be settled: the money is held
 * for reconciliation (if still reserved) and the reservation's own deployment is contained, in one
 * transaction (R1-09, Technical Lead follow-up). The deployment comes from the reservation, never the caller.
 */
export function txContainProviderFault(ctx: StoreContext, fence: Fence, reservationId: Id, reasonCode: string): void {
  const r = ownReservation(ctx, fence, reservationId);
  holdReservationTx(ctx, r, reasonCode);
  if (r.purpose === 'MODEL_CALL' && r.deploymentId !== null) txDeploymentOutcome(ctx, fence, r.deploymentId, 'CONTRACT_VIOLATION');
}

export function txRelease(ctx: StoreContext, fence: Fence, reservationId: Id, reasonCode: string): void {
  releaseReservationTx(ctx, ownReservation(ctx, fence, reservationId), reasonCode, SYSTEM_RUNTIME_REF);
}

/** A possibly-sent call: the amount stays held until explicit reconciliation (never silently dropped). */
export function txHold(ctx: StoreContext, fence: Fence, reservationId: Id, reasonCode: string): void {
  holdReservationTx(ctx, ownReservation(ctx, fence, reservationId), reasonCode);
}

/**
 * Provider health after one call: success closes the circuit; a counted failure may open it; an
 * auth / billing / quota / deprecation failure is an operational hold, never a retry loop (D13-F).
 */
export function txDeploymentOutcome(ctx: StoreContext, fence: Fence, deploymentId: Id, failure: ProviderFailureClass | null): void {
  // Same worker only (its run and fencing token): a replaced worker cannot open or close circuits or place holds.
  if (!ctx.db.get('SELECT 1 AS ok FROM runs WHERE id = ? AND job_id = ? AND fencing_token = ?', fence.runId, fence.jobId, fence.fencingToken)) throw new QandeelError('STALE_LEASE', 'this run / token did not make the call', { runId: fence.runId });
  const d = ctx.db.get<{ circuit_failures: number; circuit_open_until: string | null; provider_id: string; status: string }>('SELECT d.circuit_failures, d.circuit_open_until, m.provider_id, d.status FROM deployments d JOIN models m ON m.id = d.model_id WHERE d.id = ?', deploymentId);
  if (!d) throw new QandeelError('NOT_FOUND', 'deployment not found', { deploymentId });
  const now = ts(ctx);
  const history = (entity: string, id: string, kind: string, to: string | null, reason: string): void => {
    ctx.db.run('INSERT INTO catalog_history (entity_type, entity_id, change_kind, from_value, to_value, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)', entity, id, kind, to, reason, SYSTEM_RUNTIME_REF, now);
    appendAudit(ctx, `${entity}.${kind.toLowerCase()}`, entity, id, { actorRef: SYSTEM_RUNTIME_REF }, 'OK', reason, { runId: fence.runId });
  };
  if (failure === null) {
    if (Number(d.circuit_failures) !== 0 || d.circuit_open_until !== null) ctx.db.run('UPDATE deployments SET circuit_failures = 0, circuit_open_until = NULL, version = version + 1, updated_at = ? WHERE id = ?', now, deploymentId);
    ctx.fault('deploymentOutcome.beforeCommit');
    return;
  }
  const disp = FAILURE_DISPOSITIONS[failure];
  if (disp.circuit) {
    const failures = Number(d.circuit_failures) + 1;
    const open = failures >= CIRCUIT_THRESHOLD ? new Date(Date.parse(now) + CIRCUIT_OPEN_MS).toISOString() : d.circuit_open_until;
    ctx.db.run('UPDATE deployments SET circuit_failures = ?, circuit_open_until = ?, version = version + 1, updated_at = ? WHERE id = ?', Math.min(failures, 1_000_000), open, now, deploymentId);
    if (open !== d.circuit_open_until) history('deployment', deploymentId, 'CIRCUIT_OPENED', open, failure);
  }
  if (disp.hold === 'PROVIDER') {
    const changed = ctx.db.run(`UPDATE model_providers SET status = 'HOLD', hold_reason = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'ACTIVE'`, failure, now, d.provider_id).changes;
    if (changed) history('provider', d.provider_id, 'HOLD', 'HOLD', failure);
  }
  if (disp.hold === 'DEPLOYMENT' && d.status === 'ACTIVE') {
    ctx.db.run(`UPDATE deployments SET status = 'HOLD', hold_reason = ?, version = version + 1, updated_at = ? WHERE id = ?`, failure, now, deploymentId);
    history('deployment', deploymentId, 'HOLD', 'HOLD', failure);
  }
  ctx.fault('deploymentOutcome.beforeCommit');
}

// --- Tools ----------------------------------------------------------------------------------------

export interface ToolIntentInput {
  readonly toolCode: string;
  readonly actionCode: string;
  readonly args: JsonObject;
  /** Derived by the runtime from durable run state, never supplied by the model. */
  readonly idempotencyKey: string;
}

export type ToolIntent =
  | { readonly kind: 'EXECUTE'; readonly invocationId: Id; readonly reservationId: Id | null; readonly driverCode: string; readonly actionCode: string; readonly sideEffects: string; readonly args: JsonObject }
  /** Another live run of this Work Item holds an unsettled intent for the same key: never supersede it. */
  | { readonly kind: 'IN_FLIGHT'; readonly invocationId: Id }
  | { readonly kind: 'REPLAY'; readonly invocationId: Id; readonly result: unknown }
  | { readonly kind: 'DENIED'; readonly code: string; readonly paused: boolean }
  | { readonly kind: 'APPROVAL_REQUIRED'; readonly approvalId: Id }
  /** R2: independent review is required and the Review Pool (C4) does not exist — fail closed, not a violation. */
  | { readonly kind: 'REVIEW_REQUIRED' }
  | { readonly kind: 'BUDGET'; readonly code: string }
  | { readonly kind: 'RECONCILIATION_REQUIRED'; readonly invocationId: Id }
  | { readonly kind: 'FAILED'; readonly invocationId: Id; readonly code: string };

/**
 * Records a tool intent after the complete authority path, or refuses it (Stage 12 §11/§51):
 * tool/action registry → argument schema → data class / egress → default-deny grant + risk ladder
 * → idempotency (replay / conflict / reconciliation) → scoped Founder approval (R3) → budget
 * reservation → durable intent. The driver is invoked by the Tool Executor only after this commits.
 */
export function txToolIntent(ctx: StoreContext, fence: Fence, input: ToolIntentInput): ToolIntent {
  verifyFence(ctx, fence);
  const a = attributed(ctx, fence);
  const e = enforceRoleCertification(ctx, getEmployeeRow(ctx, a.employeeId));
  const item = getWorkItemRow(ctx, a.workItemId);
  const dataClass = effectiveDataClass(ctx, item.id);
  // Audit details carry registered IDs and codes only: model-written tool / action names never
  // enter telemetry (Rule A).
  const deny = (code: string, extra: Record<string, string | number | boolean | null> = {}): ToolIntent => ({ kind: 'DENIED', code, ...recordDenial(ctx, fence, e.id, code, extra) });
  const row = ctx.db.get(`SELECT a.*, t.code AS tool_code, t.status AS tool_status, t.egress AS tool_egress, t.driver_code AS driver_code FROM tool_actions a JOIN tools t ON t.id = a.tool_id WHERE t.code = ? AND a.code = ?`, input.toolCode, input.actionCode);
  if (!row) return deny('UNKNOWN_TOOL');
  const action = mapToolAction(row);
  if (String(row.tool_status) !== 'ACTIVE' || action.status !== 'ACTIVE') return deny('TOOL_NOT_ACTIVE', { toolActionId: action.id });
  let args: JsonObject;
  try {
    args = validateArgs(assertArgsSchema(action.argsSchema), input.args);
  } catch (error) {
    if (isQandeelError(error, 'VALIDATION_FAILED')) return deny('INVALID_ARGS', { toolActionId: action.id });
    throw error;
  }
  // External tool egress is its own decision (D14-B.7): the run's data class must fit the action.
  // D3 / D4 never leave through an external tool in C2 (no qualified egress profile, D-C2-13).
  if (dataRank(dataClass) > dataRank(action.dataClassCeiling) || !externalEgressAvailable(String(row.tool_egress) === 'EXTERNAL' ? 'EXTERNAL' : 'LOCAL', dataClass)) return deny('EGRESS_DENIED', { toolActionId: action.id, dataClass });
  const capability = toolCapability(input.toolCode, input.actionCode);
  const grants = ctx.db.all(`SELECT * FROM permission_grants WHERE employee_id = ? AND status = 'ACTIVE'`, e.id).map(mapGrant);
  const decision = decideEmployeeAction('EMPLOYEE', actingState(ctx, fence.runId, e), grants, { capability, resource: input.toolCode, risk: action.risk, dataClass, at: ts(ctx) });
  // Academy attempts and shadow work: internal, reversible, non-external actions only (Stage 6 §11) —
  // refused before any review path, so no external action of a trainee ever waits to be approved.
  if (decision.effect === 'ALLOW' || decision.code === 'REVIEW_PATH_UNAVAILABLE') {
    if ((!canExecute(e.state) || academyRun(ctx, fence.runId)) && (String(row.tool_egress) === 'EXTERNAL' || action.mutatesExternal || action.risk === 'R3')) return deny('ACADEMY_CONSTRAINED', { toolActionId: action.id, risk: action.risk });
  }
  if (decision.effect === 'DENY' && decision.code === 'REVIEW_PATH_UNAVAILABLE') {
    appendAudit(ctx, 'tool.review_required', 'run', fence.runId, { actorRef: SYSTEM_RUNTIME_REF }, 'REJECTED', 'REVIEW_PATH_UNAVAILABLE', { toolActionId: action.id });
    return { kind: 'REVIEW_REQUIRED' };
  }
  if (decision.effect === 'DENY') return deny(decision.code, { toolActionId: action.id, risk: action.risk });
  const argsSha256 = sha256Hex(canonicalJson(args));
  if (!/^[A-Za-z0-9:._-]{8,128}$/.test(input.idempotencyKey)) throw new QandeelError('VALIDATION_FAILED', 'idempotency key is a runtime-derived identifier', { field: 'idempotencyKey' });
  const existingRow = ctx.db.get('SELECT * FROM tool_invocations WHERE tool_action_id = ? AND idempotency_key = ?', action.id, input.idempotencyKey);
  const existing: ToolInvocationRecord | null = existingRow ? mapToolInvocation(existingRow) : null;
  if (existing) {
    if (existing.argsSha256 !== argsSha256) return deny('IDEMPOTENCY_CONFLICT', { toolActionId: action.id });
    if (existing.state === 'SUCCEEDED') return { kind: 'REPLAY', invocationId: existing.id, result: existing.result };
    if (existing.state === 'FAILED') return { kind: 'FAILED', invocationId: existing.id, code: existing.failureCode ?? 'FAILED' };
    if (existing.state === 'RECONCILIATION_REQUIRED') return { kind: 'RECONCILIATION_REQUIRED', invocationId: existing.id };
    if (existing.state === 'INTENT_RECORDED') {
      // An unsettled intent is never superseded while its run lives; a dead run's intent is
      // classified exactly as recovery would (the driver may have run: charge or hold, never release).
      const owner = ctx.db.get<{ state: string }>('SELECT state FROM runs WHERE id = ?', existing.runId);
      if (owner?.state === 'RUNNING') return { kind: 'IN_FLIGHT', invocationId: existing.id };
      const next = classifyOrphanIntent(ctx, existing, action.sideEffects);
      if (next === 'RECONCILIATION_REQUIRED') return { kind: 'RECONCILIATION_REQUIRED', invocationId: existing.id };
    }
  }
  // R3: scoped, durable Founder approval for exactly these arguments (Stage 3 §3/§5).
  let usable: ReturnType<typeof mapApproval> | undefined;
  if (decision.approval === 'FOUNDER') {
    const scope = { subjectRef: e.ref, action: capability, resourceRef: `tool_action:${action.id}`, workItemId: item.id, argsSha256, dataClass, risk: action.risk, limits: { maxCostMicros: action.costPerCallMicros } };
    const now = ts(ctx);
    for (const x of ctx.db.all(`SELECT * FROM approvals WHERE work_item_id = ? AND state = 'APPROVED' AND expires_at IS NOT NULL AND expires_at <= ?`, item.id, now).map(mapApproval)) {
      ctx.db.run(`UPDATE approvals SET state = 'EXPIRED', version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, now, x.id, x.version);
      ctx.db.run('INSERT INTO approval_history (approval_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', x.id, x.version + 1, 'APPROVED', 'EXPIRED', 'approval.expired', SYSTEM_RUNTIME_REF, now);
    }
    const fingerprint = approvalFingerprint(scope);
    usable = ctx.db.all(`SELECT * FROM approvals WHERE work_item_id = ? AND action = ? AND state = 'APPROVED' ORDER BY created_at, id`, item.id, capability).map(mapApproval).find((c) => approvalUsable(c, fingerprint, now as Timestamp));
    if (!usable) {
      if (ctx.db.get(`SELECT 1 AS r FROM approvals WHERE fingerprint = ? AND state = 'REJECTED'`, fingerprint)) return deny('APPROVAL_REJECTED', { toolActionId: action.id });
      const req = upsertApprovalRequest(ctx, e.ref, scope, null);
      return { kind: 'APPROVAL_REQUIRED', approvalId: req.id };
    }
  }
  // Reserve before anything is consumed: a refused reservation leaves grant and approval untouched.
  let reservationId: Id | null = null;
  if (action.costPerCallMicros > 0) {
    const r = txReserve(ctx, fence, { purpose: 'TOOL_CALL', attemptKind: 'PRIMARY', toolActionId: action.id, money: action.costPerCallMicros, tokens: 0 });
    if (!r.ok) return { kind: 'BUDGET', code: r.code };
    reservationId = r.reservation.id;
  }
  let approvalId: Id | null = null;
  if (usable) {
    const consumed = usable.uses + 1 >= usable.maxUses;
    ctx.db.run(`UPDATE approvals SET uses = uses + 1, state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, consumed ? 'CONSUMED' : 'APPROVED', ts(ctx), usable.id, usable.version);
    ctx.db.run('INSERT INTO approval_history (approval_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', usable.id, usable.version + 1, 'APPROVED', consumed ? 'CONSUMED' : 'APPROVED', 'approval.used', SYSTEM_RUNTIME_REF, ts(ctx));
    approvalId = usable.id;
  }
  consumeGrant(ctx, decision.grantId as Id);
  const at = ts(ctx);
  let invocationId: Id;
  if (existing) {
    invocationId = existing.id;
    ctx.db.run(
      `UPDATE tool_invocations SET state = 'INTENT_RECORDED', run_id = ?, fencing_token = ?, grant_id = ?, approval_id = ?, reservation_id = ?, attempts = attempts + 1, failure_code = NULL, updated_at = ? WHERE id = ?`,
      fence.runId, fence.fencingToken, decision.grantId, approvalId, reservationId, at, existing.id,
    );
  } else {
    invocationId = newId();
    ctx.db.run(
      `INSERT INTO tool_invocations (id, tool_action_id, idempotency_key, args_sha256, work_item_id, employee_id, run_id, fencing_token, grant_id, approval_id, reservation_id, state, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INTENT_RECORDED', 1, ?, ?)`,
      invocationId, action.id, input.idempotencyKey, argsSha256, item.id, e.id, fence.runId, fence.fencingToken, decision.grantId, approvalId, reservationId, at, at,
    );
  }
  appendEvent(ctx, 'run.tool_invocation', 'run', fence.runId, { correlationId: item.correlationId }, { invocationId, toolActionId: action.id, state: 'INTENT_RECORDED', risk: action.risk });
  appendAudit(ctx, 'tool.intent', 'tool_invocation', invocationId, { actorRef: e.ref, correlationId: item.correlationId }, 'OK', null, { runId: fence.runId, toolActionId: action.id, risk: action.risk, approvalId, grantId: decision.grantId });
  return { kind: 'EXECUTE', invocationId, reservationId, driverCode: String(row.driver_code), actionCode: action.code, sideEffects: action.sideEffects, args };
}


export type ToolDriverOutcome = { readonly ok: true; readonly result: JsonObject } | { readonly ok: false; readonly code: string; readonly sent: 'NO' | 'UNKNOWN' };

/** Records a driver's result (truthful: accepted from the same worker even after lease expiry). */
export function txToolResult(ctx: StoreContext, fence: Fence, invocationId: Id, outcome: ToolDriverOutcome): ToolInvocationRecord['state'] {
  const inv = mapToolInvocation(ctx.db.get('SELECT * FROM tool_invocations WHERE id = ?', invocationId) ?? {});
  if (inv.runId !== fence.runId || Number(ctx.db.get<{ t: number }>('SELECT fencing_token AS t FROM tool_invocations WHERE id = ?', invocationId)?.t) !== fence.fencingToken) {
    throw new QandeelError('STALE_LEASE', 'this invocation belongs to another run or worker', { invocationId });
  }
  if (inv.state !== 'INTENT_RECORDED') throw new QandeelError('ALREADY_SETTLED', 'the invocation is already settled', { invocationId, state: inv.state });
  const r = inv.reservationId ? getReservationRow(ctx, inv.reservationId) : null;
  const at = ts(ctx);
  let state: ToolInvocationRecord['state'];
  if (outcome.ok) {
    let json: string;
    try {
      json = canonicalJson(outcome.result);
      // Secret material in a driver's result never enters ordinary SQLite state (Stage 12 §23, Stage 14;
      // R1-01): the invocation keeps only a digest, exactly as the step result already did.
      if (hasSecretNamedKey(outcome.result) || containsSecretMaterial(json)) json = canonicalJson({ withheld: 'SECRET_MATERIAL', sha256: sha256Hex(json) });
      else if (Buffer.byteLength(json, 'utf8') > 4096) json = canonicalJson({ truncated: true, sha256: sha256Hex(json) });
    } catch {
      json = canonicalJson({ invalid: true });
    }
    ctx.db.run(`UPDATE tool_invocations SET state = 'SUCCEEDED', result_json = ?, result_sha256 = ?, updated_at = ? WHERE id = ?`, json, sha256Hex(json), at, invocationId);
    if (r) settleReservationTx(ctx, r, { inputTokens: 0, outputTokens: 0, withinBounds: true, sessionId: null, outcome: 'OK' }, SYSTEM_RUNTIME_REF);
    state = 'SUCCEEDED';
  } else if (outcome.sent === 'NO') {
    ctx.db.run(`UPDATE tool_invocations SET state = 'RETRYABLE', failure_code = ?, updated_at = ? WHERE id = ?`, outcome.code.slice(0, 64), at, invocationId);
    if (r) releaseReservationTx(ctx, r, 'TOOL_NOT_EXECUTED', SYSTEM_RUNTIME_REF);
    state = 'RETRYABLE';
  } else {
    // The driver may have run. Its cost is the fixed per-call amount, so it is charged (never
    // released); an UNSAFE effect additionally needs reconciliation before anything repeats it.
    const side = String(ctx.db.get<{ s: string }>('SELECT side_effects AS s FROM tool_actions WHERE id = ?', inv.toolActionId)?.s);
    state = side === 'UNSAFE' ? 'RECONCILIATION_REQUIRED' : 'RETRYABLE';
    ctx.db.run(`UPDATE tool_invocations SET state = ?, failure_code = ?, updated_at = ? WHERE id = ?`, state, outcome.code.slice(0, 64), at, invocationId);
    if (r) {
      if (side === 'UNSAFE') holdReservationTx(ctx, r, 'TOOL_OUTCOME_UNKNOWN');
      else settleReservationTx(ctx, r, { inputTokens: 0, outputTokens: 0, withinBounds: true, sessionId: null, outcome: 'FAILED_CHARGED' }, SYSTEM_RUNTIME_REF);
    }
  }
  appendEvent(ctx, 'run.tool_invocation', 'run', fence.runId, { correlationId: getWorkItemRow(ctx, inv.workItemId).correlationId }, { invocationId, state });
  appendAudit(ctx, 'tool.result', 'tool_invocation', invocationId, { actorRef: SYSTEM_RUNTIME_REF }, 'OK', outcome.ok ? null : outcome.code.slice(0, 64), { state, runId: fence.runId });
  return state;
}

/**
 * Backstop at the run's settle (R1-09): a model call's reservation must never outlive its run as
 * RESERVED. The model runtime settles, holds or releases every reservation it makes; if its bookkeeping
 * could not (the call may have been billed), the reservation is held for reconciliation here, in the
 * run's settle transaction — not only at the next startup recovery.
 */
export function txHoldUnsettledModelCalls(ctx: StoreContext, runId: Id): number {
  const open = ctx.db.all(`SELECT * FROM budget_reservations WHERE run_id = ? AND purpose = 'MODEL_CALL' AND state = 'RESERVED'`, runId).map(mapReservation);
  for (const r of open) holdReservationTx(ctx, r, 'RUN_ENDED_UNSETTLED');
  return open.length;
}

// --- WAIT re-check (lost-wake window) ------------------------------------------------------------------

/**
 * Closes the lost-wake window of the C2 waits (R1-06, D-C1-23), as the C3 waits already do: the run
 * learns APPROVAL_REQUIRED / BUDGET_EXHAUSTED in one transaction but parks only when it settles. A
 * Founder decision or cap raise committed in between found the job still CLAIMED, so its targeted wake
 * did nothing. The WAIT settle therefore re-checks, in its own transaction, whether the wait still
 * holds, and wakes the job at once if it does not:
 * - AWAITING_APPROVAL holds while this Work Item still has a PENDING tool approval;
 * - BUDGET_EXHAUSTED holds unless a cap on this Work Item's budget chain changed since the run began
 *   (exactly the event whose targeted wake could have been missed).
 * A spurious wake is harmless: the next run re-checks every gate before any spend.
 */
export function txRecheckGovernedWait(ctx: StoreContext, workItemId: Id, runId: Id, reason: 'AWAITING_APPROVAL' | 'BUDGET_EXHAUSTED'): void {
  const started = ctx.db.get<{ s: string }>('SELECT started_at AS s FROM runs WHERE id = ?', runId)?.s;
  if (reason === 'AWAITING_APPROVAL') {
    // The wait no longer holds when no tool approval of this Work Item is pending, OR when one was
    // decided while this run was in flight (a stale PENDING request from an earlier job must not mask
    // this run's decided approval — R1 re-review). A spurious wake costs nothing: every gate re-runs.
    const pending = ctx.db.get(`SELECT 1 AS x FROM approvals WHERE work_item_id = ? AND action <> 'work_item.execute' AND state = 'PENDING' LIMIT 1`, workItemId);
    const decidedDuringRun = started !== undefined && ctx.db.get(`SELECT 1 AS x FROM approvals WHERE work_item_id = ? AND action <> 'work_item.execute' AND decided_at IS NOT NULL AND decided_at >= ? LIMIT 1`, workItemId, started);
    if (!pending || decidedDuringRun) wakeWorkItemJob(ctx, workItemId, ['AWAITING_APPROVAL'], 'approval.rechecked');
    return;
  }
  const wi = budgetFor(ctx, 'WORK_ITEM', workItemId);
  if (started === undefined || !wi) return;
  const chain = budgetChain(ctx, wi.id).map((b) => b.id);
  const raised = ctx.db.get(`SELECT 1 AS x FROM budget_history WHERE change_kind = 'CAP_CHANGED' AND occurred_at >= ? AND budget_id IN (SELECT value FROM json_each(?)) LIMIT 1`, started, JSON.stringify(chain));
  if (raised) wakeWorkItemJob(ctx, workItemId, ['BUDGET_EXHAUSTED'], 'budget.rechecked');
}

// --- Recovery ---------------------------------------------------------------------------------------

/**
 * An unsettled tool intent whose run is gone. The driver may have run: the fixed per-call cost is
 * charged (never released); NONE / IDEMPOTENT actions become RETRYABLE under the same key, UNSAFE
 * ones require reconciliation with the reservation held.
 */
function classifyOrphanIntent(ctx: StoreContext, inv: ToolInvocationRecord, sideEffects: string): 'RETRYABLE' | 'RECONCILIATION_REQUIRED' {
  const r = inv.reservationId ? getReservationRow(ctx, inv.reservationId) : null;
  const next = sideEffects === 'UNSAFE' ? 'RECONCILIATION_REQUIRED' : 'RETRYABLE';
  ctx.db.run(`UPDATE tool_invocations SET state = ?, failure_code = 'RUN_INTERRUPTED', updated_at = ? WHERE id = ?`, next, ts(ctx), inv.id);
  if (r?.state === 'RESERVED') {
    if (next === 'RECONCILIATION_REQUIRED') holdReservationTx(ctx, r, 'RUN_INTERRUPTED');
    else settleReservationTx(ctx, r, { inputTokens: 0, outputTokens: 0, withinBounds: true, sessionId: null, outcome: 'FAILED_CHARGED' }, SYSTEM_RUNTIME_REF);
  }
  appendAudit(ctx, 'tool.recovered', 'tool_invocation', inv.id, { actorRef: SYSTEM_RUNTIME_REF }, 'OK', next, { runId: inv.runId });
  return next;
}

export interface GovernedRecoverySummary {
  readonly reservationsHeld: number;
  readonly reservationsReleased: number;
  readonly invocationsRetryable: number;
  readonly invocationsHeld: number;
}

/**
 * Classifies governed work left behind by runs that are no longer RUNNING (crash, lease expiry,
 * shutdown): a model-call reservation may have been sent and billed → held for reconciliation
 * (never silently released); a tool intent whose driver may have run → NONE / IDEMPOTENT actions
 * become retryable under the same idempotency key, UNSAFE ones require reconciliation.
 */
export function txRecoverGovernedOrphans(ctx: StoreContext, limit: number): GovernedRecoverySummary {
  let reservationsHeld = 0;
  let reservationsReleased = 0;
  let invocationsRetryable = 0;
  let invocationsHeld = 0;
  const invocations = ctx.db
    .all(`SELECT i.* FROM tool_invocations i JOIN runs r ON r.id = i.run_id WHERE i.state = 'INTENT_RECORDED' AND r.state <> 'RUNNING' LIMIT ?`, limit)
    .map(mapToolInvocation);
  for (const inv of invocations) {
    const side = String(ctx.db.get<{ s: string }>('SELECT side_effects AS s FROM tool_actions WHERE id = ?', inv.toolActionId)?.s);
    const next = classifyOrphanIntent(ctx, inv, side);
    if (next === 'RECONCILIATION_REQUIRED') invocationsHeld++;
    else invocationsRetryable++;
  }
  // Model-call reservations of dead runs: the call may have been sent and billed → held. Tool-call
  // reservations are classified only through their invocation (above), never released blindly here.
  const reservations = ctx.db
    .all(`SELECT b.* FROM budget_reservations b JOIN runs r ON r.id = b.run_id WHERE b.state = 'RESERVED' AND b.purpose = 'MODEL_CALL' AND r.state <> 'RUNNING' LIMIT ?`, limit)
    .map(mapReservation);
  for (const r of reservations) {
    holdReservationTx(ctx, r, 'RUN_INTERRUPTED');
    reservationsHeld++;
  }
  // A tool reservation without an unsettled intent (not reachable today) is released only if no
  // invocation references it at all.
  for (const r of ctx.db
    .all(`SELECT b.* FROM budget_reservations b JOIN runs r ON r.id = b.run_id WHERE b.state = 'RESERVED' AND b.purpose = 'TOOL_CALL' AND r.state <> 'RUNNING'
            AND NOT EXISTS (SELECT 1 FROM tool_invocations i WHERE i.reservation_id = b.id) LIMIT ?`, limit)
    .map(mapReservation)) {
    releaseReservationTx(ctx, r, 'RUN_INTERRUPTED', SYSTEM_RUNTIME_REF);
    reservationsReleased++;
  }
  return { reservationsHeld, reservationsReleased, invocationsRetryable, invocationsHeld };
}
