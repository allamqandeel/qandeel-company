/**
 * Transactional core of the Work Operating System (Stage 8). Every function here runs inside a
 * write transaction opened by a repository method, so the state change, its history row, the
 * outbox event and the audit row commit atomically.
 */
import {
  COMPLETED_FAMILY,
  DEPENDENCY_FAILED_STATES,
  QandeelError,
  TERMINAL_WORK_ITEM_STATES,
  assertTransition,
  satisfiesDependents,
  newId,
  toTimestamp,
  type Id,
  type OutcomeStatus,
  type Timestamp,
  type WorkItemState,
} from '@qandeel-company/domain';

import { releaseBudgetAdmission } from './governance-core.js';
import { appendAudit, appendEvent, getWorkItemRow, liveJobFor, ts, type StoreContext, type TraceContext } from './internal.js';
import type { JobRecord, WorkItemRecord } from './records.js';
import { releaseAbandonedReviewWork } from './review-core.js';

export interface TransitionOptions {
  readonly reasonCode: string;
  readonly trace: TraceContext;
  readonly outcome?: OutcomeStatus;
  readonly blockedReason?: string;
  readonly blockerRef?: string | null;
  readonly supersededBy?: Id;
  readonly expectedVersion?: number;
}

/** Validates and applies one Work Item transition, recording history and an outbox event. */
export function applyTransition(ctx: StoreContext, item: WorkItemRecord, to: WorkItemState, opts: TransitionOptions): WorkItemRecord {
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== item.version) {
    throw new QandeelError('VERSION_CONFLICT', 'work item changed since it was read', { workItemId: item.id, expected: opts.expectedVersion, actual: item.version });
  }
  assertTransition(item, opts.outcome === undefined ? { to } : { to, outcome: opts.outcome });
  if (to === 'BLOCKED' && opts.blockedReason === undefined) {
    throw new QandeelError('VALIDATION_FAILED', 'a BLOCKED transition records its reason', { workItemId: item.id });
  }
  const at = ts(ctx);
  const blockedReason = to === 'BLOCKED' ? (opts.blockedReason ?? null) : null;
  const blockerRef = to === 'BLOCKED' ? (opts.blockerRef ?? null) : null;
  const terminal = TERMINAL_WORK_ITEM_STATES.has(to);
  const changed = ctx.db.run(
    `UPDATE work_items
        SET state = ?, version = version + 1, updated_at = ?, outcome = ?, blocked_reason = ?, blocker_ref = ?,
            superseded_by = ?, termination_requested = ?, termination_reason = ?
      WHERE id = ? AND version = ?`,
    to,
    at,
    opts.outcome ?? item.outcome,
    blockedReason,
    blockerRef,
    to === 'SUPERSEDED' ? (opts.supersededBy ?? item.supersededBy) : item.supersededBy,
    terminal ? null : item.terminationRequested,
    terminal ? (to === 'CANCELLED' || to === 'SUPERSEDED' ? opts.reasonCode : item.terminationReason) : item.terminationReason,
    item.id,
    item.version,
  ).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'work item changed concurrently', { workItemId: item.id });
  ctx.db.run(
    `INSERT INTO work_item_transitions (work_item_id, from_state, to_state, version, reason_code, actor_ref, correlation_id, causation_id, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id,
    item.state,
    to,
    item.version + 1,
    opts.reasonCode,
    opts.trace.actorRef ?? null,
    opts.trace.correlationId,
    opts.trace.causationId ?? null,
    at,
  );
  appendEvent(ctx, 'work_item.transitioned', 'work_item', item.id, opts.trace, { from: item.state, to, version: item.version + 1, reason: opts.reasonCode });
  // C4 / C6: a review or judge Work Item that ends (failed, cancelled, superseded) without its decision frees its
  // review key / judgment for another eligible reviewer in this same transaction, whatever path ended it. A
  // dead-lettered one (BLOCKED, not terminal) is released by the queue's dead-letter path (m-11).
  if (terminal) releaseAbandonedReviewWork(ctx, item.id);
  // RR2-2 / RR2-5: a handoff never outlives its delegator. The datastore closes the open handoffs of work that ends
  // unfinished (0011 `work_delegations_follow_parent`, this same statement); a CANCELLED / SUPERSEDED parent then
  // propagates to its children (`terminateNow`), and a FAILED one cancels the work it delegated here.
  if (to === 'FAILED') cancelDelegatedChildren(ctx, item.id, opts.trace);
  return getWorkItemRow(ctx, item.id);
}

/**
 * RR2-2: the Work Items a FAILED delegator handed off are cancelled through the canonical propagation path (same
 * transaction): a running one records durable intent, completed work is retained (it is finished), and one held for
 * reconciliation is retained and stays surfaced as a held job — its handoff is closed all the same.
 */
function cancelDelegatedChildren(ctx: StoreContext, parentId: Id, trace: TraceContext): void {
  const out = newTerminationOutcome();
  for (const { c } of ctx.db.all<{ c: string }>('SELECT child_work_item_id AS c FROM work_delegations WHERE parent_work_item_id = ? ORDER BY created_at, id', parentId)) {
    requestTermination(ctx, c as Id, { mode: 'CANCELLED', reasonCode: 'PARENT_FAILED', trace: { ...trace, causationId: parentId }, policy: defaultPropagationPolicy }, out, true, 1);
  }
}

/**
 * RR2-5: executable work never re-enters the queue under a lineage that ended — e.g. a delegated child retained as
 * completed (WAITING_REVIEW) when its delegator was cancelled, then sent back to rework by its review. It is
 * cancelled by the same propagation its parent's end would have applied had it not been finished then. `null`:
 * the parent (if any) is live, or the child is independent of it.
 */
function endedLineageReason(ctx: StoreContext, item: WorkItemRecord): string | null {
  if (item.parentId === null) return null;
  const parent = getWorkItemRow(ctx, item.parentId);
  if ((parent.state === 'CANCELLED' || parent.state === 'SUPERSEDED') && defaultPropagationPolicy(item, parent.state) === 'TERMINATE') return parent.state === 'CANCELLED' ? 'PARENT_CANCELLED' : 'PARENT_SUPERSEDED';
  if (parent.state === 'FAILED' && ctx.db.get('SELECT 1 AS x FROM work_delegations WHERE child_work_item_id = ? AND parent_work_item_id = ?', item.id, parent.id)) return 'PARENT_FAILED';
  return null;
}

/** Non-state field update (blocker refresh, termination intent). Still bumps the version. */
export function updateItemMeta(
  ctx: StoreContext,
  item: WorkItemRecord,
  fields: { blockedReason?: string | null; blockerRef?: string | null; terminationRequested?: 'CANCELLED' | 'SUPERSEDED' | null; terminationReason?: string | null; supersededBy?: Id | null },
): WorkItemRecord {
  const pick = <T>(v: T | undefined, current: T): T => (v === undefined ? current : v);
  const changed = ctx.db.run(
    `UPDATE work_items SET version = version + 1, updated_at = ?, blocked_reason = ?, blocker_ref = ?,
            termination_requested = ?, termination_reason = ?, superseded_by = ?
      WHERE id = ? AND version = ?`,
    ts(ctx),
    pick(fields.blockedReason, item.blockedReason),
    pick(fields.blockerRef, item.blockerRef),
    pick(fields.terminationRequested, item.terminationRequested),
    pick(fields.terminationReason, item.terminationReason),
    pick(fields.supersededBy, item.supersededBy),
    item.id,
    item.version,
  ).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'work item changed concurrently', { workItemId: item.id });
  return getWorkItemRow(ctx, item.id);
}

export const DEFAULT_MAX_ATTEMPTS = 3;

function maxAttemptsOf(ctx: StoreContext, item: WorkItemRecord): number {
  const row = ctx.db.get<{ max_attempts: number }>('SELECT max_attempts FROM work_items WHERE id = ?', item.id);
  return Number(row?.max_attempts ?? DEFAULT_MAX_ATTEMPTS);
}

/** Puts an executable Work Item on the durable queue (one live job per item). */
export function enqueueJob(ctx: StoreContext, item: WorkItemRecord, trace: TraceContext, availableAt?: Timestamp): JobRecord | undefined {
  if (item.processorKind === null) return undefined;
  const existing = liveJobFor(ctx, item.id);
  if (existing) return existing;
  const ended = endedLineageReason(ctx, item);
  if (ended !== null) {
    requestTermination(ctx, item.id, { mode: 'CANCELLED', reasonCode: ended, trace: { ...trace, causationId: item.parentId as Id }, policy: defaultPropagationPolicy }, newTerminationOutcome(), true, 1);
    return undefined;
  }
  const id = newId();
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO queue_jobs (id, work_item_id, root_work_item_id, processor_kind, state, priority, available_at, max_attempts, correlation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?)`,
    id,
    item.id,
    item.rootId,
    item.processorKind,
    item.priority,
    availableAt ?? at,
    maxAttemptsOf(ctx, item),
    item.correlationId,
    at,
    at,
  );
  appendEvent(ctx, 'job.enqueued', 'job', id, trace, { workItemId: item.id, kind: item.processorKind, priority: item.priority });
  return liveJobFor(ctx, item.id);
}

/** Cancels a not-running live job (QUEUED / WAITING / DEAD_LETTER) when its item leaves execution. */
export function withdrawJob(ctx: StoreContext, item: WorkItemRecord, trace: TraceContext, reasonCode: string): void {
  const job = liveJobFor(ctx, item.id);
  if (!job) return;
  if (job.state === 'CLAIMED' || job.state === 'RECONCILIATION_HOLD') {
    throw new QandeelError('STORAGE_INVARIANT', 'a claimed or held job cannot be withdrawn', { jobId: job.id, state: job.state });
  }
  // FA-1 (A5): a withdrawn (admitted, not yet running) job's budget capacity goes to the next eligible waiter now.
  releaseBudgetAdmission(ctx, job.id, 'JOB_LEFT_QUEUE');
  ctx.db.run(`UPDATE queue_jobs SET state = 'CANCELLED', updated_at = ?, wait_reason = NULL WHERE id = ? AND state = ?`, ts(ctx), job.id, job.state);
  appendAudit(ctx, 'job.withdrawn', 'job', job.id, trace, 'OK', reasonCode, { workItemId: item.id, from: job.state });
}

// ---------------------------------------------------------------------------------------------
// Dependencies (Stage 8 §15–19)

export interface DependencyStatus {
  readonly unresolved: number;
  readonly failed: number;
  readonly firstBlocker: Id | null;
}

export function dependencyStatus(ctx: StoreContext, itemId: Id): DependencyStatus {
  const rows = ctx.db.all<{ depends_on_id: string; state: string }>(
    `SELECT d.depends_on_id, w.state FROM work_item_dependencies d JOIN work_items w ON w.id = d.depends_on_id
      WHERE d.work_item_id = ? AND d.resolved_at IS NULL ORDER BY d.created_at, d.depends_on_id`,
    itemId,
  );
  const failed = rows.filter((r) => DEPENDENCY_FAILED_STATES.has(r.state as WorkItemState));
  const first = failed[0] ?? rows[0];
  return { unresolved: rows.length, failed: failed.length, firstBlocker: first ? (first.depends_on_id as Id) : null };
}

/** Recomputes the dependency block of one BLOCKED item: unblock, or refresh its reason/blocker. */
export function reevaluateDependencyBlock(ctx: StoreContext, item: WorkItemRecord, trace: TraceContext): WorkItemRecord {
  if (item.state !== 'BLOCKED' || (item.blockedReason !== 'DEPENDENCY' && item.blockedReason !== 'DEPENDENCY_FAILED')) return item;
  const status = dependencyStatus(ctx, item.id);
  if (status.unresolved === 0) {
    const ready = applyTransition(ctx, item, 'READY', { reasonCode: 'dependency.resolved', trace });
    appendEvent(ctx, 'work_item.unblocked', 'work_item', item.id, trace, {});
    enqueueJob(ctx, ready, trace);
    return getWorkItemRow(ctx, item.id);
  }
  const reason = status.failed > 0 ? 'DEPENDENCY_FAILED' : 'DEPENDENCY';
  const blocker = status.firstBlocker ? `work_item:${status.firstBlocker}` : null;
  if (reason !== item.blockedReason || blocker !== item.blockerRef) {
    const updated = updateItemMeta(ctx, item, { blockedReason: reason, blockerRef: blocker });
    appendAudit(ctx, 'work_item.block_updated', 'work_item', item.id, trace, 'OK', reason, { blocker });
    return updated;
  }
  return item;
}

/** A dependency became satisfying (D-C1-09): resolve its edges and wake only affected dependents. */
export function resolveDependents(ctx: StoreContext, completedId: Id, trace: TraceContext): Id[] {
  if (!isSatisfied(getWorkItemRow(ctx, completedId))) return []; // e.g. completed but still awaiting review
  const dependents = ctx.db.all<{ work_item_id: string }>(
    'SELECT work_item_id FROM work_item_dependencies WHERE depends_on_id = ? AND resolved_at IS NULL ORDER BY work_item_id',
    completedId,
  );
  ctx.db.run('UPDATE work_item_dependencies SET resolved_at = ? WHERE depends_on_id = ? AND resolved_at IS NULL', ts(ctx), completedId);
  const unblocked: Id[] = [];
  for (const { work_item_id } of dependents) {
    const before = getWorkItemRow(ctx, work_item_id as Id);
    const after = reevaluateDependencyBlock(ctx, before, trace);
    if (before.state === 'BLOCKED' && after.state === 'READY') unblocked.push(after.id);
  }
  return unblocked;
}

/** A dependency ended without completion: dependents stay blocked, now with a visible reason. */
export function failDependents(ctx: StoreContext, failedId: Id, trace: TraceContext): void {
  const dependents = ctx.db.all<{ work_item_id: string }>(
    'SELECT work_item_id FROM work_item_dependencies WHERE depends_on_id = ? AND resolved_at IS NULL ORDER BY work_item_id',
    failedId,
  );
  for (const { work_item_id } of dependents) reevaluateDependencyBlock(ctx, getWorkItemRow(ctx, work_item_id as Id), trace);
}

/** True if `from` already (transitively) depends on `target` — adding target→from would cycle. */
export function dependsTransitively(ctx: StoreContext, from: Id, target: Id): boolean {
  const row = ctx.db.get(
    `WITH RECURSIVE reach(id) AS (
       SELECT depends_on_id FROM work_item_dependencies WHERE work_item_id = ?
       UNION
       SELECT d.depends_on_id FROM work_item_dependencies d JOIN reach r ON d.work_item_id = r.id
     )
     SELECT 1 AS hit FROM reach WHERE id = ? LIMIT 1`,
    from,
    target,
  );
  return row !== undefined;
}

/** D-C1-09: review-required work satisfies dependents only once REVIEWED; other work once COMPLETED. */
export function isSatisfied(item: Pick<WorkItemRecord, 'state' | 'reviewRequired'>): boolean {
  return satisfiesDependents(item);
}

// ---------------------------------------------------------------------------------------------
// Cancellation / supersession (Stage 8 §42)

export type TerminationMode = 'CANCELLED' | 'SUPERSEDED';

/** Decides, per child, whether a parent's cancellation/supersession propagates. Extensible (C4). */
export type PropagationPolicy = (child: WorkItemRecord, mode: TerminationMode) => 'TERMINATE' | 'RETAIN';

/** Default: propagate unless the child is explicitly marked INDEPENDENT. */
export const defaultPropagationPolicy: PropagationPolicy = (child) => (child.propagationMode === 'INDEPENDENT' ? 'RETAIN' : 'TERMINATE');

export interface TerminationOutcome {
  /** Items that reached CANCELLED / SUPERSEDED in this transaction. */
  readonly terminated: Id[];
  /** Items whose intent is durable but whose running job must first stop (signal these jobs). */
  readonly requested: Id[];
  readonly signalJobIds: Id[];
  /** Children deliberately not terminated (independent, already completed, or under reconciliation). */
  readonly retained: Id[];
  readonly alreadyTerminal: Id[];
}

export function newTerminationOutcome(): TerminationOutcome {
  return { terminated: [], requested: [], signalJobIds: [], retained: [], alreadyTerminal: [] };
}

export const MAX_LINEAGE_DEPTH = 32;

export interface TerminationRequest {
  readonly mode: TerminationMode;
  readonly reasonCode: string;
  readonly trace: TraceContext;
  readonly supersededBy?: Id;
  readonly policy: PropagationPolicy;
}

/**
 * Durable termination. Not-running work terminates now (and propagates to its children); running
 * work records durable intent first and is finalized when its worker settles or its lease is
 * recovered — never by trusting an in-memory signal alone.
 */
export function requestTermination(ctx: StoreContext, itemId: Id, req: TerminationRequest, out: TerminationOutcome, propagated = false, depth = 0): void {
  if (depth > MAX_LINEAGE_DEPTH) throw new QandeelError('LINEAGE_INVALID', 'propagation exceeded the lineage depth ceiling', { workItemId: itemId });
  const item = getWorkItemRow(ctx, itemId);
  if (TERMINAL_WORK_ITEM_STATES.has(item.state)) {
    out.alreadyTerminal.push(item.id);
    return;
  }
  const retain = (reason: string): void => {
    out.retained.push(item.id);
    appendAudit(ctx, 'work_item.propagation_retained', 'work_item', item.id, req.trace, 'OK', reason, { mode: req.mode });
  };
  if (req.mode === 'CANCELLED' && COMPLETED_FAMILY.has(item.state)) {
    if (propagated) return retain('ALREADY_COMPLETED');
    throw new QandeelError('INVALID_TRANSITION', 'completed work cannot be cancelled; supersede it instead', { workItemId: item.id, from: item.state, to: 'CANCELLED' });
  }
  const job = liveJobFor(ctx, item.id);
  if (job?.state === 'RECONCILIATION_HOLD') {
    if (propagated) return retain('RECONCILIATION_PENDING');
    throw new QandeelError('INVALID_TRANSITION', 'resolve the pending reconciliation before terminating this work', { workItemId: item.id, jobId: job.id });
  }
  if (job?.state === 'CLAIMED') {
    if (item.terminationRequested === null) {
      updateItemMeta(ctx, item, { terminationRequested: req.mode, terminationReason: req.reasonCode, supersededBy: req.mode === 'SUPERSEDED' ? (req.supersededBy ?? null) : item.supersededBy });
      ctx.db.run('UPDATE queue_jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?', ts(ctx), job.id);
      appendEvent(ctx, 'work_item.cancel_requested', 'work_item', item.id, req.trace, { mode: req.mode, jobId: job.id, reason: req.reasonCode });
      appendAudit(ctx, 'work_item.termination_requested', 'work_item', item.id, req.trace, 'OK', req.reasonCode, { mode: req.mode, jobId: job.id });
    }
    out.requested.push(item.id);
    out.signalJobIds.push(job.id);
    return;
  }
  if (job) withdrawJob(ctx, item, req.trace, req.reasonCode);
  terminateNow(ctx, item, req, out, depth);
}

/** Applies the terminal state, informs dependents and propagates to children. */
export function terminateNow(ctx: StoreContext, item: WorkItemRecord, req: TerminationRequest, out: TerminationOutcome, depth: number): void {
  const opts: TransitionOptions = req.mode === 'SUPERSEDED' ? { reasonCode: req.reasonCode, trace: req.trace, supersededBy: req.supersededBy ?? (item.supersededBy as Id) } : { reasonCode: req.reasonCode, trace: req.trace };
  applyTransition(ctx, item, req.mode, opts);
  appendAudit(ctx, `work_item.${req.mode.toLowerCase()}`, 'work_item', item.id, req.trace, 'OK', req.reasonCode, {});
  out.terminated.push(item.id);
  failDependents(ctx, item.id, req.trace);
  const children = ctx.db.all<{ id: string }>('SELECT id FROM work_items WHERE parent_id = ? ORDER BY created_at, id', item.id);
  for (const { id } of children) {
    const child = getWorkItemRow(ctx, id as Id);
    if (TERMINAL_WORK_ITEM_STATES.has(child.state)) continue;
    if (req.policy(child, req.mode) === 'RETAIN') {
      out.retained.push(child.id);
      appendAudit(ctx, 'work_item.propagation_retained', 'work_item', child.id, req.trace, 'OK', 'INDEPENDENT', { parent: item.id, mode: req.mode });
      continue;
    }
    requestTermination(
      ctx,
      child.id,
      { mode: 'CANCELLED', reasonCode: req.mode === 'CANCELLED' ? 'PARENT_CANCELLED' : 'PARENT_SUPERSEDED', trace: { ...req.trace, causationId: item.id }, policy: req.policy },
      out,
      true,
      depth + 1,
    );
  }
}

export function futureTimestamp(ctx: StoreContext, deltaMs: number): Timestamp {
  return toTimestamp(ctx.clock.nowMs() + deltaMs);
}
