/**
 * Storage-internal C2 transaction helpers shared by the Founder-authority store (`governance.ts`)
 * and the runtime's fenced writes (`governed-writes.ts`). Every function runs inside a write
 * transaction opened by its caller; nothing here opens or awaits a transaction.
 *
 * Accounting arithmetic is done in checked JavaScript (governance `addMoney` / `subMoney` …) and
 * stored as integers; the budget CHECK constraints are a second, independent guard.
 */
import { QandeelError, newId, type Id, type Timestamp } from '@qandeel-company/domain';
import { PROVIDER_FAILURE_CLASSES, addMoney, addTokens, costOf, failureDisposition, subMoney, subTokens, type PriceCard, type PrincipalKind } from '@qandeel-company/governance';

import { mapBudget, mapEmployee, mapPriceCard, mapPrincipal, mapReservation, type BudgetRecord, type EmployeeRecord, type PrincipalRecord, type ReservationRecord } from './governance-records.js';

import { appendAudit, appendEvent, ts, type StoreContext } from './internal.js';

export interface Principal {
  readonly kind: PrincipalKind;
  readonly ref: string;
  readonly employeeId: Id | null;
}

/** Resolves an actor reference to a registered, active principal; unknown actors have no authority. */
export function resolvePrincipal(ctx: StoreContext, ref: string): Principal {
  const row = ctx.db.get(`SELECT * FROM principals WHERE ref = ? AND status = 'ACTIVE'`, String(ref).slice(0, 161));
  if (!row) throw new QandeelError('AUTHORITY_DENIED', 'the actor is not a registered principal', { reason: 'UNKNOWN_PRINCIPAL' });
  const p: PrincipalRecord = mapPrincipal(row);
  return { kind: p.kind, ref: p.ref, employeeId: p.employeeId };
}

export function getEmployeeRow(ctx: StoreContext, id: Id): EmployeeRecord {
  const row = ctx.db.get('SELECT * FROM employees WHERE id = ?', id);
  if (!row) throw new QandeelError('NOT_FOUND', 'employee not found', { employeeId: id });
  return mapEmployee(row);
}

export function employeeIdFromRef(ref: string): Id | null {
  const m = /^employee:([0-9a-f-]{36})$/.exec(ref);
  return m ? (m[1] as Id) : null;
}

export function writeEmployeeHistory(ctx: StoreContext, e: EmployeeRecord, changeKind: string, from: string | null, to: string, reasonCode: string, actorRef: string, detail: Record<string, string | number | boolean | null> = {}): void {
  ctx.db.run(
    `INSERT INTO employee_history (employee_id, version, change_kind, from_state, to_state, detail_json, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.id,
    e.version,
    changeKind,
    from,
    to,
    JSON.stringify(detail),
    reasonCode,
    actorRef,
    ts(ctx),
  );
}

/** Lifecycle change applied by either the Founder or runtime containment (which only ever reduces autonomy). */
export function setEmployeeState(ctx: StoreContext, e: EmployeeRecord, to: EmployeeRecord['state'], reasonCode: string, actorRef: string, qualificationRefs?: readonly string[]): EmployeeRecord {
  const at = ts(ctx);
  const changed = ctx.db.run(
    `UPDATE employees SET state = ?, qualification_refs_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
    to,
    JSON.stringify(qualificationRefs ?? e.qualificationRefs),
    at,
    e.id,
    e.version,
  ).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'employee changed concurrently', { employeeId: e.id });
  const next = getEmployeeRow(ctx, e.id);
  writeEmployeeHistory(ctx, next, 'LIFECYCLE', e.state, to, reasonCode, actorRef);
  appendAudit(ctx, 'employee.lifecycle', 'employee', e.id, { actorRef }, 'OK', reasonCode, { from: e.state, to });
  return next;
}

// --- Budgets -----------------------------------------------------------------------------------

export function getBudgetRow(ctx: StoreContext, id: Id): BudgetRecord {
  const row = ctx.db.get('SELECT * FROM budgets WHERE id = ?', id);
  if (!row) throw new QandeelError('NOT_FOUND', 'budget not found', { budgetId: id });
  return mapBudget(row);
}

/**
 * The current budget of a scope. Only an Employee envelope can be CLOSED (per placement, D-C4-02); its
 * successor is the OPEN one. Every other scope has exactly one budget.
 */
export function budgetFor(ctx: StoreContext, scope: BudgetRecord['scope'], scopeId: string): BudgetRecord | null {
  const row = ctx.db.get(`SELECT * FROM budgets WHERE scope = ? AND scope_id = ? AND status = 'OPEN'`, scope, scopeId);
  return row ? mapBudget(row) : null;
}

/**
 * R2-06: a child budget (SQL alias `c`) that can still spend — OPEN (a CLOSED envelope stays where it was spent)
 * and, for a Work Item, work that can still execute: not terminal, not REVIEWED / OUTCOME_VERIFIED, and not
 * COMPLETED unless its required review can still send it back to rework; for a Run, a run still RUNNING. Only
 * such a child holds its parent's cap up (the C2 "a child cap never exceeds its parent" invariant); every
 * reservation still checks every level of its chain, so a finished child's larger cap spends nothing.
 */
export const CHILD_CAN_SPEND_SQL = `c.status = 'OPEN' AND (c.scope NOT IN ('WORK_ITEM', 'RUN')
  OR (c.scope = 'WORK_ITEM' AND EXISTS (SELECT 1 FROM work_items w WHERE w.id = c.scope_id
        AND w.state NOT IN ('CLOSED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'REVIEWED', 'OUTCOME_VERIFIED')
        AND NOT (w.state = 'COMPLETED' AND w.review_required = 0)))
  OR (c.scope = 'RUN' AND EXISTS (SELECT 1 FROM runs r WHERE r.id = c.scope_id AND r.state = 'RUNNING')))`;

/** The budget and all its ancestors, leaf first (parents are immutable, depth ≤ 5). */
export function budgetChain(ctx: StoreContext, leafId: Id): BudgetRecord[] {
  const chain: BudgetRecord[] = [];
  for (let cursor: Id | null = leafId; cursor !== null && chain.length < 6; ) {
    const b = getBudgetRow(ctx, cursor);
    chain.push(b);
    cursor = b.parentId;
  }
  if (chain.at(-1)?.scope !== 'COMPANY') throw new QandeelError('STORAGE_INVARIANT', 'budget chain does not end at the Company budget', { budgetId: leafId });
  return chain;
}

/**
 * C4: the Work Item budget of engine-created work (a delegated / support child, a reviewer's review task).
 * It hangs under the owner's EXISTING Employee budget and is capped by it (and by the caller's cap, e.g. the
 * parent Work Item's): no budget is created out of nothing, and every ancestor cap still binds each
 * reservation (Stage 3 §6 "managers allocate within an approved budget"; Stage 8 §29). Refused, never
 * improvised, when the owner has no Employee budget.
 */
export function txAllocateWorkItemBudget(ctx: StoreContext, workItemId: Id, ownerEmployeeId: Id, cap: { money: number; tokens: number }, actorRef: string, reasonCode: string): BudgetRecord {
  const existing = budgetFor(ctx, 'WORK_ITEM', workItemId);
  if (existing) return existing;
  const parent = budgetFor(ctx, 'EMPLOYEE', ownerEmployeeId);
  if (!parent) throw new QandeelError('BUDGET_MISSING', 'the owner has no Employee budget to allocate from', { scope: 'EMPLOYEE', employeeId: ownerEmployeeId });
  const capMoney = Math.min(cap.money, parent.capMoney);
  const capTokens = Math.min(cap.tokens, parent.capTokens);
  const id = newId();
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO budgets (id, scope, scope_id, parent_id, currency, cap_money, cap_tokens, version, created_by_ref, created_at, updated_at) VALUES (?, 'WORK_ITEM', ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    id, workItemId, parent.id, parent.currency, capMoney, capTokens, actorRef, at, at,
  );
  ctx.db.run('INSERT INTO budget_history (budget_id, change_kind, cap_money, cap_tokens, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, 'CREATED', capMoney, capTokens, reasonCode, actorRef, at);
  appendAudit(ctx, 'budget.created', 'budget', id, { actorRef }, 'OK', reasonCode, { capMoney, capTokens });
  return getBudgetRow(ctx, id);
}

/**
 * C4 (D-C4-02): an Employee's budget envelope follows its placement. When a seat change moves the Employee
 * under a different parent level (a transfer, or a promotion into the company-scoped CEO seat), the current
 * envelope is CLOSED — its history stays where it was spent — and a successor is opened under the new
 * parent, capped by both. With no parent budget yet, nothing is opened: the Employee cannot spend until the
 * Founder budgets that level (fail closed). Called in the Founder-authority assignment transaction.
 */
export function txFollowPlacementEnvelope(ctx: StoreContext, e: EmployeeRecord, actorRef: string, reasonCode: string): BudgetRecord | null {
  const current = budgetFor(ctx, 'EMPLOYEE', e.id);
  if (!current) return null;
  const parent = e.orgScope === 'COMPANY' ? budgetFor(ctx, 'COMPANY', 'company') : e.departmentId === null ? null : budgetFor(ctx, 'DEPARTMENT', e.departmentId);
  if (parent !== null && current.parentId === parent.id) return current;
  const at = ts(ctx);
  const changed = ctx.db.run(`UPDATE budgets SET status = 'CLOSED', closed_at = ?, closed_reason = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND status = 'OPEN'`, at, reasonCode, at, current.id, current.version).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'budget changed concurrently', { budgetId: current.id });
  appendAudit(ctx, 'budget.closed', 'budget', current.id, { actorRef }, 'OK', reasonCode, { scope: 'EMPLOYEE', employeeId: e.id });
  if (parent === null) return null;
  const id = newId();
  const capMoney = Math.min(current.capMoney, parent.capMoney);
  const capTokens = Math.min(current.capTokens, parent.capTokens);
  ctx.db.run(
    `INSERT INTO budgets (id, scope, scope_id, parent_id, currency, cap_money, cap_tokens, version, created_by_ref, created_at, updated_at) VALUES (?, 'EMPLOYEE', ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    id, e.id, parent.id, parent.currency, capMoney, capTokens, actorRef, at, at,
  );
  ctx.db.run('INSERT INTO budget_history (budget_id, change_kind, cap_money, cap_tokens, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, 'CREATED', capMoney, capTokens, reasonCode, actorRef, at);
  appendAudit(ctx, 'budget.created', 'budget', id, { actorRef }, 'OK', reasonCode, { capMoney, capTokens });
  return getBudgetRow(ctx, id);
}

export interface BudgetDelta {
  readonly reservedMoney?: number;
  readonly reservedTokens?: number;
  readonly releaseMoney?: number;
  readonly releaseTokens?: number;
  readonly spendMoney?: number;
  readonly spendTokens?: number;
}

/**
 * Applies one delta to every budget of the chain, computing each new value in checked arithmetic.
 * Returns true when a level had to record an overrun (spend beyond its cap: truthful, never hidden).
 */
export function applyBudgetDelta(ctx: StoreContext, chain: readonly BudgetRecord[], d: BudgetDelta): boolean {
  let overran = false;
  const at = ts(ctx);
  for (const b of chain) {
    const reservedMoney = subMoney(addMoney(b.reservedMoney, d.reservedMoney ?? 0), d.releaseMoney ?? 0, 'reservedMoney');
    const reservedTokens = subTokens(addTokens(b.reservedTokens, d.reservedTokens ?? 0), d.releaseTokens ?? 0, 'reservedTokens');
    const spentMoney = addMoney(b.spentMoney, d.spendMoney ?? 0, 'spentMoney');
    const spentTokens = addTokens(b.spentTokens, d.spendTokens ?? 0, 'spentTokens');
    const needMoney = addMoney(reservedMoney, spentMoney);
    const needTokens = addTokens(reservedTokens, spentTokens);
    const capM = addMoney(b.capMoney, b.overrunMoney);
    const capT = addTokens(b.capTokens, b.overrunTokens);
    const overrunMoney = needMoney > capM ? addMoney(b.overrunMoney, needMoney - capM) : b.overrunMoney;
    const overrunTokens = needTokens > capT ? addTokens(b.overrunTokens, needTokens - capT) : b.overrunTokens;
    if (overrunMoney !== b.overrunMoney || overrunTokens !== b.overrunTokens) overran = true;
    const changed = ctx.db.run(
      `UPDATE budgets SET reserved_money = ?, reserved_tokens = ?, spent_money = ?, spent_tokens = ?, overrun_money = ?, overrun_tokens = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`,
      reservedMoney,
      reservedTokens,
      spentMoney,
      spentTokens,
      overrunMoney,
      overrunTokens,
      at,
      b.id,
      b.version,
    ).changes;
    if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'budget changed concurrently', { budgetId: b.id });
  }
  return overran;
}

export function getReservationRow(ctx: StoreContext, id: Id): ReservationRecord {
  const row = ctx.db.get('SELECT * FROM budget_reservations WHERE id = ?', id);
  if (!row) throw new QandeelError('NOT_FOUND', 'reservation not found', { reservationId: id });
  return mapReservation(row);
}

export function getPriceCard(ctx: StoreContext, id: Id): PriceCard & { deploymentId: Id } {
  const row = ctx.db.get('SELECT * FROM price_cards WHERE id = ?', id);
  if (!row) throw new QandeelError('NOT_FOUND', 'price card not found', { priceCardId: id });
  return mapPriceCard(row);
}

export interface SettleUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly withinBounds: boolean;
  readonly sessionId: Id | null;
  readonly outcome: 'OK' | 'FAILED_CHARGED' | 'RECONCILED';
}

/**
 * Settles a reservation with actual usage: one usage record, the reservation released from every
 * level and the actual economic cost / tokens charged. Unused reservation is thereby released.
 */
export function settleReservationTx(ctx: StoreContext, r: ReservationRecord, usage: SettleUsage, actorRef: string | null): Id {
  if (r.state !== 'RESERVED' && r.state !== 'RECONCILIATION_REQUIRED') throw new QandeelError('ALREADY_SETTLED', 'the reservation is already final', { reservationId: r.id, state: r.state });
  let billed: number;
  let economic: number;
  let tokens: number;
  let providerId: string | null = null;
  let modelId: string | null = null;
  let cardVersion: number | null = null;
  if (r.purpose === 'MODEL_CALL') {
    const card = getPriceCard(ctx, r.priceCardId as Id);
    const cost = costOf(card, usage.inputTokens, usage.outputTokens);
    billed = cost.billedMicros;
    economic = cost.economicMicros;
    tokens = cost.tokens;
    cardVersion = card.version;
    const dep = ctx.db.get<{ provider_id: string; model_id: string }>('SELECT m.provider_id, d.model_id FROM deployments d JOIN models m ON m.id = d.model_id WHERE d.id = ?', r.deploymentId);
    providerId = dep?.provider_id ?? null;
    modelId = dep?.model_id ?? null;
  } else {
    billed = r.money;
    economic = r.money;
    tokens = 0;
  }
  const chain = budgetChain(ctx, r.budgetId);
  // A charge beyond what was reserved is flagged on its own, whatever slack earlier overruns left.
  const beyondReservation = economic > r.money || tokens > r.tokens;
  const overran = applyBudgetDelta(ctx, chain, { releaseMoney: r.money, releaseTokens: r.tokens, spendMoney: economic, spendTokens: tokens }) || beyondReservation;
  const usageId = newId();
  ctx.db.run(
    `INSERT INTO usage_records (id, reservation_id, run_id, work_item_id, employee_id, department_id, purpose, attempt_kind, provider_id, model_id, deployment_id, price_card_id,
       price_card_version, tool_action_id, session_id, input_tokens, output_tokens, charged_tokens, billed_micros, economic_micros, within_bounds, outcome, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    usageId,
    r.id,
    r.runId,
    r.workItemId,
    r.employeeId,
    r.departmentId,
    r.purpose,
    r.attemptKind,
    providerId,
    modelId,
    r.deploymentId,
    r.priceCardId,
    cardVersion,
    r.toolActionId,
    usage.sessionId,
    usage.inputTokens,
    usage.outputTokens,
    tokens,
    billed,
    economic,
    usage.withinBounds && !overran ? 1 : 0,
    usage.outcome,
    ts(ctx),
  );
  ctx.db.run(`UPDATE budget_reservations SET state = 'SETTLED', updated_at = ? WHERE id = ?`, ts(ctx), r.id);
  const trace = { correlationId: r.runId, actorRef };
  appendEvent(ctx, 'run.usage_settled', 'run', r.runId, trace, { reservationId: r.id, purpose: r.purpose, attemptKind: r.attemptKind, economicMicros: economic, tokens, overran });
  appendAudit(ctx, 'budget.settled', 'reservation', r.id, trace, 'OK', overran ? 'OVERRUN_RECORDED' : null, { runId: r.runId, reservedMoney: r.money, chargedMoney: economic, chargedTokens: tokens });
  // R2-03: the unused worst case went back to every level of the chain.
  if (economic < r.money || tokens < r.tokens) wakeBudgetWaiters(ctx, chain.map((b) => b.id), 'budget.freed');
  return usageId;
}

export function releaseReservationTx(ctx: StoreContext, r: ReservationRecord, reasonCode: string, actorRef: string | null): void {
  if (r.state !== 'RESERVED' && r.state !== 'RECONCILIATION_REQUIRED') throw new QandeelError('ALREADY_SETTLED', 'the reservation is already final', { reservationId: r.id, state: r.state });
  const chain = budgetChain(ctx, r.budgetId);
  applyBudgetDelta(ctx, chain, { releaseMoney: r.money, releaseTokens: r.tokens });
  ctx.db.run(`UPDATE budget_reservations SET state = 'RELEASED', reason_code = ?, updated_at = ? WHERE id = ?`, reasonCode, ts(ctx), r.id);
  appendAudit(ctx, 'budget.released', 'reservation', r.id, { actorRef }, 'OK', reasonCode, { runId: r.runId, money: r.money, tokens: r.tokens });
  if (r.money > 0 || r.tokens > 0) wakeBudgetWaiters(ctx, chain.map((b) => b.id), 'budget.freed');
}

export function holdReservationTx(ctx: StoreContext, r: ReservationRecord, reasonCode: string): void {
  if (r.state !== 'RESERVED') return;
  ctx.db.run(`UPDATE budget_reservations SET state = 'RECONCILIATION_REQUIRED', reason_code = ?, updated_at = ? WHERE id = ?`, reasonCode, ts(ctx), r.id);
  appendAudit(ctx, 'budget.reconciliation_required', 'reservation', r.id, {}, 'OK', reasonCode, { runId: r.runId, money: r.money, tokens: r.tokens });
}

/**
 * Hold reasons that record a failed call which may have been billed: a failure class whose disposition is
 * "sent: UNKNOWN", and the provider-fault containments of an unusable answer (R1-09). A crash / backstop
 * hold (RUN_INTERRUPTED, RUN_ENDED_UNSETTLED, SETTLEMENT_FAILED) is not a failed attempt of the deployment.
 */
const POSSIBLY_BILLED_FAILURE_HOLDS: readonly string[] = [...PROVIDER_FAILURE_CLASSES.filter((f) => failureDisposition(f).sent === 'UNKNOWN'), 'USAGE_UNREPORTED', 'USAGE_UNUSABLE'];

/**
 * P-07 (D-R1-03, D-C4-07): deployments that produced a charged — or possibly billed — failed model-call
 * attempt for this Work Item, across every run and job of it. Such a deployment is never selected again for
 * the same logical Work Item automatically; only an explicit Founder release covering every such attempt so far
 * lifts the exclusion (a later attempt excludes again). Computed from the durable money records alone (no second accounting state).
 */
export function chargedFailureCounts(ctx: StoreContext, workItemId: Id): Map<Id, number> {
  const rows = ctx.db.all<{ d: string; n: number }>(
    `SELECT r.deployment_id AS d, COUNT(DISTINCT r.id) AS n
       FROM budget_reservations r LEFT JOIN usage_records u ON u.reservation_id = r.id
      WHERE r.work_item_id = ? AND r.purpose = 'MODEL_CALL' AND r.deployment_id IS NOT NULL
        AND (u.outcome = 'FAILED_CHARGED' OR (r.state IN ('RECONCILIATION_REQUIRED', 'SETTLED') AND r.reason_code IN (SELECT value FROM json_each(?))))
      GROUP BY r.deployment_id`,
    workItemId,
    JSON.stringify(POSSIBLY_BILLED_FAILURE_HOLDS),
  );
  return new Map(rows.map((x) => [x.d as Id, Number(x.n)]));
}

export function chargedExclusions(ctx: StoreContext, workItemId: Id): Id[] {
  return [...chargedFailureCounts(ctx, workItemId).entries()]
    .filter(([d, n]) => !ctx.db.get('SELECT 1 AS released FROM charged_exclusion_releases WHERE work_item_id = ? AND deployment_id = ? AND covered_failures >= ? LIMIT 1', workItemId, d, n))
    .map(([d]) => d)
    .sort();
}
/**
 * Wakes the parked job of one Work Item (targeted wake, Stage 8 §18). The existing queue_jobs
 * trigger advances the durable wake generation in this same transaction.
 */
export function wakeWorkItemJob(ctx: StoreContext, workItemId: Id, waitReasons: readonly string[], reasonCode: string): boolean {
  const at: Timestamp = ts(ctx);
  const job = ctx.db.get<{ id: string; correlation_id: string }>(
    `SELECT id, correlation_id FROM queue_jobs WHERE work_item_id = ? AND state = 'WAITING' AND wait_reason IN (SELECT value FROM json_each(?))`,
    workItemId,
    JSON.stringify(waitReasons),
  );
  if (!job) return false;
  ctx.db.run(`UPDATE queue_jobs SET state = 'QUEUED', available_at = ?, wait_reason = NULL, updated_at = ? WHERE id = ? AND state = 'WAITING'`, at, at, job.id);
  appendEvent(ctx, 'job.woken', 'job', job.id as Id, { correlationId: job.correlation_id as Id }, { reason: reasonCode });
  return true;
}

/**
 * Real headroom: every level a new run of the Work Item would reserve against — all but a Run budget, which the
 * next run gets fresh — can still take something in both dimensions (the reservation check's own arithmetic).
 */
export function chainHasHeadroom(chain: readonly BudgetRecord[]): boolean {
  return chain.every((b) => b.scope === 'RUN' || (addMoney(b.reservedMoney, b.spentMoney) < b.capMoney && addTokens(b.reservedTokens, b.spentTokens) < b.capTokens));
}

/**
 * R2-03: the one resume predicate of a BUDGET_EXHAUSTED wait (Stage 3 §6: work waits on budget contention, and
 * resumes when the budget can take it again). Headroom returns on a settle below the worst case, a release (runtime
 * or Founder reconciliation) and a cap raise; each calls this with the budgets it freed (`null`: any, the startup
 * pass). Waiter-driven — every parked job is considered, never a window of budgets — and headroom-gated: only a
 * waiter whose chain shares a freed level AND whose every non-Run level now has real headroom is woken, so work
 * that is truly exhausted stays asleep. A wake that proves insufficient costs one run that re-parks before any
 * spend (every gate re-runs, the reservation first). The queue_jobs trigger advances the wake generation.
 */
export function wakeBudgetWaiters(ctx: StoreContext, freedBudgetIds: readonly Id[] | null, reasonCode: string): number {
  const freed = freedBudgetIds === null ? null : new Set<string>(freedBudgetIds);
  let woken = 0;
  for (const { work_item_id: workItemId } of ctx.db.all<{ work_item_id: string }>(`SELECT work_item_id FROM queue_jobs WHERE state = 'WAITING' AND wait_reason = 'BUDGET_EXHAUSTED' ORDER BY priority DESC, created_at, id`)) {
    const leaf = budgetFor(ctx, 'WORK_ITEM', workItemId);
    if (!leaf) continue;
    const chain = budgetChain(ctx, leaf.id);
    if (freed !== null && !chain.some((b) => freed.has(b.id))) continue;
    if (chainHasHeadroom(chain) && wakeWorkItemJob(ctx, workItemId as Id, ['BUDGET_EXHAUSTED'], reasonCode)) woken++;
  }
  return woken;
}
