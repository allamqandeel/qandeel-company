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
import { QandeelError, canonicalJson, isQandeelError, newId, sha256Hex, type Id, type JsonObject, type Timestamp } from '@qandeel-company/domain';
import {
  AUTO_PAUSE_DENIALS_PER_RUN,
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
  decideEmployeeAction,
  toolCapability,
  validateArgs,
  type AttemptKind,
  type CognitiveProfile,
  type DataClass,
  type ProviderFailureClass,
  type RoutePolicy,
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
  type SettleUsage,
} from './governance-core.js';
import { mapApproval, mapGrant, mapReservation, mapToolAction, mapToolInvocation, type BudgetRecord, type ReservationRecord, type ToolInvocationRecord } from './governance-records.js';
import { routingSnapshotTx, upsertApprovalRequest, workItemDataClass } from './governance.js';
import { appendAudit, appendEvent, getWorkItemRow, ts, type StoreContext } from './internal.js';
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
}

export type BeginResult = { readonly ok: true; readonly context: GovernedRunContext } | { readonly ok: false; readonly code: 'EMPLOYEE_NOT_ELIGIBLE' | 'NOT_EMPLOYEE_OWNED'; readonly state: string | null };

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
  const e = getEmployeeRow(ctx, employeeId);
  if (!canExecute(e.state)) {
    denyAudit(ctx, fence.runId, 'authority.denied', 'EMPLOYEE_NOT_ELIGIBLE', { employeeId, state: e.state });
    return { ok: false, code: 'EMPLOYEE_NOT_ELIGIBLE', state: e.state };
  }
  if (!ctx.db.get('SELECT 1 AS ok FROM run_attributions WHERE run_id = ?', fence.runId)) {
    ctx.db.run('INSERT INTO run_attributions (run_id, work_item_id, employee_id, department_id, created_at) VALUES (?, ?, ?, ?, ?)', fence.runId, item.id, e.id, e.departmentId, ts(ctx));
    appendEvent(ctx, 'run.attributed', 'run', fence.runId, { correlationId: item.correlationId }, { employeeId: e.id, departmentId: e.departmentId, workItemId: item.id });
  }
  return {
    ok: true,
    context: { runId: fence.runId, workItemId: item.id, employeeId: e.id, employeeRef: e.ref, departmentId: e.departmentId, cognitiveProfile: assertCognitiveProfile(e.cognitiveProfile), dataClass: workItemDataClass(item.processorInput) },
  };
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
  denyAudit(ctx, fence.runId, 'authority.denied', code, { employeeId, ...details });
  const n = Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ? AND action = 'authority.denied'`, fence.runId)?.n ?? 0);
  const e = getEmployeeRow(ctx, employeeId);
  if (n >= AUTO_PAUSE_DENIALS_PER_RUN && e.state === 'ACTIVE') {
    setEmployeeState(ctx, e, 'PAUSED', 'AUTO_PAUSE_AUTHORITY_DENIALS', SYSTEM_RUNTIME_REF);
    return { paused: true };
  }
  return { paused: false };
}

export type AuthorizeResult = { readonly ok: true; readonly grantId: Id } | { readonly ok: false; readonly code: string; readonly paused: boolean };

function consumeGrant(ctx: StoreContext, grantId: Id): void {
  ctx.db.run(`UPDATE permission_grants SET uses = uses + 1 WHERE id = ? AND status = 'ACTIVE' AND (max_uses IS NULL OR uses < max_uses)`, grantId);
}

/** `model.invoke` for this task class and data class (R0 read / analyze), re-checked per call. */
export function txAuthorizeModelCall(ctx: StoreContext, fence: Fence, input: { taskClass: string; dataClass: DataClass }): AuthorizeResult {
  verifyFence(ctx, fence);
  const a = attributed(ctx, fence);
  const e = getEmployeeRow(ctx, a.employeeId);
  const grants = ctx.db.all(`SELECT * FROM permission_grants WHERE employee_id = ? AND status = 'ACTIVE'`, e.id).map(mapGrant);
  const d = decideEmployeeAction('EMPLOYEE', e.state, grants, { capability: 'model.invoke', resource: input.taskClass, risk: 'R0', dataClass: input.dataClass, at: ts(ctx) });
  if (d.effect === 'DENY') return { ok: false, code: d.code, ...recordDenial(ctx, fence, e.id, d.code, { capability: 'model.invoke' }) };
  consumeGrant(ctx, d.grantId as Id);
  return { ok: true, grantId: d.grantId as Id };
}

export type ReserveInput =
  | { readonly purpose: 'MODEL_CALL'; readonly attemptKind: AttemptKind; readonly deploymentId: Id; readonly priceCardId: Id; readonly routePolicyId: Id; readonly money: number; readonly tokens: number }
  | { readonly purpose: 'TOOL_CALL'; readonly attemptKind: 'PRIMARY'; readonly toolActionId: Id; readonly money: number; readonly tokens: 0 };

export type ReserveResult = { readonly ok: true; readonly reservation: ReservationRecord } | { readonly ok: false; readonly code: 'BUDGET_MISSING' | 'BUDGET_EXHAUSTED' | 'EMPLOYEE_NOT_ELIGIBLE' | 'ROUTE_NO_LONGER_ELIGIBLE' | 'RUN_LIMIT'; readonly detail: string };

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
  const e = getEmployeeRow(ctx, a.employeeId);
  if (!canExecute(e.state)) return { ok: false, code: 'EMPLOYEE_NOT_ELIGIBLE', detail: e.state };
  const refuse = (code: Extract<ReserveResult, { ok: false }>['code'], detail: string): ReserveResult => {
    appendAudit(ctx, 'budget.refused', 'run', fence.runId, { actorRef: SYSTEM_RUNTIME_REF }, 'REJECTED', code, { detail: detail.slice(0, 64), purpose: input.purpose, attemptKind: input.attemptKind });
    return { ok: false, code, detail };
  };
  if (input.purpose === 'MODEL_CALL') {
    const d = ctx.db.get<{ status: string; price_card_id: string | null; circuit_open_until: string | null; provider_status: string }>(
      `SELECT d.status, d.price_card_id, d.circuit_open_until, p.status AS provider_status FROM deployments d JOIN models m ON m.id = d.model_id JOIN model_providers p ON p.id = m.provider_id WHERE d.id = ?`,
      input.deploymentId,
    );
    if (!d || d.status !== 'ACTIVE' || d.provider_status !== 'ACTIVE' || d.price_card_id !== input.priceCardId || (d.circuit_open_until !== null && d.circuit_open_until > ts(ctx))) return refuse('ROUTE_NO_LONGER_ELIGIBLE', 'deployment');
    const policy = policyById(ctx, input.routePolicyId);
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
    `INSERT INTO budget_reservations (id, budget_id, run_id, job_id, fencing_token, work_item_id, employee_id, department_id, purpose, attempt_kind, deployment_id, price_card_id, tool_action_id, route_policy_id, money, tokens, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?)`,
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

export function txSettle(ctx: StoreContext, fence: Fence, reservationId: Id, usage: SettleUsage): Id {
  const r = ownReservation(ctx, fence, reservationId);
  const id = settleReservationTx(ctx, r, usage, SYSTEM_RUNTIME_REF);
  ctx.fault('settlement.beforeCommit');
  return id;
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
  if (!ctx.db.get('SELECT 1 AS ok FROM runs WHERE id = ?', fence.runId)) throw new QandeelError('STALE_LEASE', 'unknown run', { runId: fence.runId });
  const d = ctx.db.get<{ circuit_failures: number; circuit_open_until: string | null; provider_id: string; status: string }>('SELECT d.circuit_failures, d.circuit_open_until, m.provider_id, d.status FROM deployments d JOIN models m ON m.id = d.model_id WHERE d.id = ?', deploymentId);
  if (!d) throw new QandeelError('NOT_FOUND', 'deployment not found', { deploymentId });
  const now = ts(ctx);
  const history = (entity: string, id: string, kind: string, to: string | null, reason: string): void => {
    ctx.db.run('INSERT INTO catalog_history (entity_type, entity_id, change_kind, from_value, to_value, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)', entity, id, kind, to, reason, SYSTEM_RUNTIME_REF, now);
    appendAudit(ctx, `${entity}.${kind.toLowerCase()}`, entity, id, { actorRef: SYSTEM_RUNTIME_REF }, 'OK', reason, { runId: fence.runId });
  };
  if (failure === null) {
    if (Number(d.circuit_failures) !== 0 || d.circuit_open_until !== null) ctx.db.run('UPDATE deployments SET circuit_failures = 0, circuit_open_until = NULL, version = version + 1, updated_at = ? WHERE id = ?', now, deploymentId);
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
  | { readonly kind: 'EXECUTE'; readonly invocationId: Id; readonly reservationId: Id | null; readonly driverCode: string; readonly actionCode: string; readonly sideEffects: string }
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
  const e = getEmployeeRow(ctx, a.employeeId);
  const item = getWorkItemRow(ctx, a.workItemId);
  const dataClass = workItemDataClass(item.processorInput);
  const deny = (code: string, extra: Record<string, string | number | boolean | null> = {}): ToolIntent => ({ kind: 'DENIED', code, ...recordDenial(ctx, fence, e.id, code, { tool: input.toolCode.slice(0, 64), action: input.actionCode.slice(0, 64), ...extra }) });
  const row = ctx.db.get(`SELECT a.*, t.code AS tool_code, t.status AS tool_status, t.egress AS tool_egress, t.driver_code AS driver_code FROM tool_actions a JOIN tools t ON t.id = a.tool_id WHERE t.code = ? AND a.code = ?`, input.toolCode, input.actionCode);
  if (!row) return deny('UNKNOWN_TOOL');
  const action = mapToolAction(row);
  if (String(row.tool_status) !== 'ACTIVE' || action.status !== 'ACTIVE') return deny('TOOL_NOT_ACTIVE');
  let args: JsonObject;
  try {
    args = validateArgs(assertArgsSchema(action.argsSchema), input.args);
  } catch (error) {
    if (isQandeelError(error, 'VALIDATION_FAILED')) return deny('INVALID_ARGS');
    throw error;
  }
  // External tool egress is its own decision (D14-B.7): the run's data class must fit the action.
  if (dataRank(dataClass) > dataRank(action.dataClassCeiling) || (String(row.tool_egress) === 'EXTERNAL' && dataClass === 'D4')) return deny('EGRESS_DENIED', { dataClass });
  const capability = toolCapability(input.toolCode, input.actionCode);
  const grants = ctx.db.all(`SELECT * FROM permission_grants WHERE employee_id = ? AND status = 'ACTIVE'`, e.id).map(mapGrant);
  const decision = decideEmployeeAction('EMPLOYEE', e.state, grants, { capability, resource: input.toolCode, risk: action.risk, dataClass, at: ts(ctx) });
  if (decision.effect === 'DENY' && decision.code === 'REVIEW_PATH_UNAVAILABLE') {
    appendAudit(ctx, 'tool.review_required', 'run', fence.runId, { actorRef: SYSTEM_RUNTIME_REF }, 'REJECTED', 'REVIEW_PATH_UNAVAILABLE', { toolActionId: action.id });
    return { kind: 'REVIEW_REQUIRED' };
  }
  if (decision.effect === 'DENY') return deny(decision.code, { risk: action.risk });
  const argsSha256 = sha256Hex(canonicalJson(args));
  if (!/^[A-Za-z0-9:._-]{8,128}$/.test(input.idempotencyKey)) throw new QandeelError('VALIDATION_FAILED', 'idempotency key is a runtime-derived identifier', { field: 'idempotencyKey' });
  const existingRow = ctx.db.get('SELECT * FROM tool_invocations WHERE tool_action_id = ? AND idempotency_key = ?', action.id, input.idempotencyKey);
  const existing: ToolInvocationRecord | null = existingRow ? mapToolInvocation(existingRow) : null;
  if (existing) {
    if (existing.argsSha256 !== argsSha256) return deny('IDEMPOTENCY_CONFLICT');
    if (existing.state === 'SUCCEEDED') return { kind: 'REPLAY', invocationId: existing.id, result: existing.result };
    if (existing.state === 'FAILED') return { kind: 'FAILED', invocationId: existing.id, code: existing.failureCode ?? 'FAILED' };
    if (existing.state === 'RECONCILIATION_REQUIRED') return { kind: 'RECONCILIATION_REQUIRED', invocationId: existing.id };
    if (existing.state === 'INTENT_RECORDED') {
      // A live intent of another worker, or an orphan recovery has not classified yet: never guess.
      if (action.sideEffects === 'UNSAFE') {
        ctx.db.run(`UPDATE tool_invocations SET state = 'RECONCILIATION_REQUIRED', failure_code = 'INTENT_UNSETTLED', updated_at = ? WHERE id = ?`, ts(ctx), existing.id);
        if (existing.reservationId) holdReservationTx(ctx, getReservationRow(ctx, existing.reservationId), 'INTENT_UNSETTLED');
        return { kind: 'RECONCILIATION_REQUIRED', invocationId: existing.id };
      }
      if (existing.reservationId) {
        const r = getReservationRow(ctx, existing.reservationId);
        if (r.state === 'RESERVED') releaseReservationTx(ctx, r, 'SUPERSEDED_BY_RETRY', SYSTEM_RUNTIME_REF);
      }
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
      if (ctx.db.get(`SELECT 1 AS r FROM approvals WHERE fingerprint = ? AND state = 'REJECTED'`, fingerprint)) return deny('APPROVAL_REJECTED');
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
  return { kind: 'EXECUTE', invocationId, reservationId, driverCode: String(row.driver_code), actionCode: action.code, sideEffects: action.sideEffects };
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
      if (Buffer.byteLength(json, 'utf8') > 4096) json = canonicalJson({ truncated: true, sha256: sha256Hex(json) });
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
    ctx.db.run(`UPDATE tool_invocations SET state = 'RECONCILIATION_REQUIRED', failure_code = ?, updated_at = ? WHERE id = ?`, outcome.code.slice(0, 64), at, invocationId);
    if (r) holdReservationTx(ctx, r, 'TOOL_OUTCOME_UNKNOWN');
    state = 'RECONCILIATION_REQUIRED';
  }
  appendEvent(ctx, 'run.tool_invocation', 'run', fence.runId, { correlationId: getWorkItemRow(ctx, inv.workItemId).correlationId }, { invocationId, state });
  appendAudit(ctx, 'tool.result', 'tool_invocation', invocationId, { actorRef: SYSTEM_RUNTIME_REF }, 'OK', outcome.ok ? null : outcome.code.slice(0, 64), { state, runId: fence.runId });
  return state;
}

// --- Recovery ---------------------------------------------------------------------------------------

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
    const r = inv.reservationId ? getReservationRow(ctx, inv.reservationId) : null;
    if (side === 'UNSAFE') {
      ctx.db.run(`UPDATE tool_invocations SET state = 'RECONCILIATION_REQUIRED', failure_code = 'RUN_INTERRUPTED', updated_at = ? WHERE id = ?`, ts(ctx), inv.id);
      if (r?.state === 'RESERVED') holdReservationTx(ctx, r, 'RUN_INTERRUPTED');
      invocationsHeld++;
    } else {
      ctx.db.run(`UPDATE tool_invocations SET state = 'RETRYABLE', failure_code = 'RUN_INTERRUPTED', updated_at = ? WHERE id = ?`, ts(ctx), inv.id);
      if (r?.state === 'RESERVED') {
        releaseReservationTx(ctx, r, 'RUN_INTERRUPTED', SYSTEM_RUNTIME_REF);
        reservationsReleased++;
      }
      invocationsRetryable++;
    }
    appendAudit(ctx, 'tool.recovered', 'tool_invocation', inv.id, { actorRef: SYSTEM_RUNTIME_REF }, 'OK', side === 'UNSAFE' ? 'RECONCILIATION_REQUIRED' : 'RETRYABLE', { runId: inv.runId });
  }
  const reservations = ctx.db
    .all(`SELECT b.* FROM budget_reservations b JOIN runs r ON r.id = b.run_id WHERE b.state = 'RESERVED' AND r.state <> 'RUNNING' LIMIT ?`, limit)
    .map(mapReservation);
  for (const r of reservations) {
    if (r.purpose === 'MODEL_CALL') {
      holdReservationTx(ctx, r, 'RUN_INTERRUPTED');
      reservationsHeld++;
    } else {
      releaseReservationTx(ctx, r, 'RUN_INTERRUPTED', SYSTEM_RUNTIME_REF);
      reservationsReleased++;
    }
  }
  return { reservationsHeld, reservationsReleased, invocationsRetryable, invocationsHeld };
}
