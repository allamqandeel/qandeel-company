/**
 * Work Item repository: creation (with idempotency and deterministic dedupe), guarded manual
 * transitions, dependencies, lineage, cancellation and supersession. No hard delete exists.
 */
import {
  MAX_ATTEMPTS_CEILING,
  OUTCOME_STATUSES,
  PROCESSOR_KIND,
  PROPAGATION_MODES,
  QandeelError,
  RISK_LEVELS,
  TERMINAL_WORK_ITEM_STATES,
  assertCode,
  assertId,
  assertIntInRange,
  assertOpaqueRef,
  boundedJson,
  boundedText,
  canonicalJson,
  initialState,
  isTimestamp,
  requiresReview,
  newId,
  sha256Hex,
  type Id,
  type OpaqueRef,
  type OutcomeStatus,
  type PropagationMode,
  type RiskLevel,
  type Timestamp,
  type WorkItemState,
} from '@qandeel-company/domain';

import { appendAudit, appendEvent, getWorkItemRow, liveJobFor, mapTransition, mapWorkItem, ts, type StoreContext, type TraceContext } from './internal.js';
import type { TransitionRecord, WorkItemRecord } from './records.js';
import {
  DEFAULT_MAX_ATTEMPTS,
  MAX_LINEAGE_DEPTH,
  applyTransition,
  defaultPropagationPolicy,
  dependencyStatus,
  dependsTransitively,
  enqueueJob,
  isSatisfied,
  newTerminationOutcome,
  reevaluateDependencyBlock,
  requestTermination,
  withdrawJob,
  type PropagationPolicy,
  type TerminationOutcome,
} from './work-core.js';

export interface CreateWorkItemInput {
  readonly objective: string;
  readonly ownerRef: string;
  readonly contributors?: readonly string[];
  readonly priority?: number;
  readonly dueAt?: string;
  readonly riskLevel?: RiskLevel;
  readonly completionCriteria?: unknown;
  readonly requiredEvidence?: unknown;
  readonly reviewRequired?: boolean;
  readonly approvalRequired?: boolean;
  /** Deterministic processor that executes this item. Omit for non-executable work. */
  readonly processorKind?: string;
  readonly processorInput?: unknown;
  readonly maxAttempts?: number;
  readonly parentId?: string;
  readonly dependsOn?: readonly string[];
  readonly propagationMode?: PropagationMode;
  readonly dedupeKey?: string;
  /** PROPOSED (default) or released as READY (becomes BLOCKED / WAITING_APPROVAL when gated). */
  readonly initialState?: 'PROPOSED' | 'READY';
}

export interface CreateOptions {
  /** `(scope, key)` idempotency: same key + same input replays; different input conflicts. */
  readonly idempotencyKey?: string;
  readonly actorRef?: string;
  readonly correlationId?: Id;
}

export interface CreateResult {
  readonly workItem: WorkItemRecord;
  readonly replayed: boolean;
  readonly enqueuedJobId: Id | null;
}

export const IDEMPOTENCY_SCOPE_CREATE = 'work_item.create';

interface NormalizedInput {
  objective: string;
  ownerRef: OpaqueRef;
  contributorsJson: string;
  priority: number;
  dueAt: Timestamp | null;
  riskLevel: RiskLevel;
  completionCriteriaJson: string;
  requiredEvidenceJson: string;
  reviewRequired: boolean;
  approvalRequired: boolean;
  processorKind: string | null;
  processorInputJson: string;
  maxAttempts: number;
  parentId: Id | null;
  dependsOn: Id[];
  propagationMode: PropagationMode;
  dedupeKey: string | null;
  initialState: 'PROPOSED' | 'READY';
}

export function normalizeCreateInput(input: CreateWorkItemInput): NormalizedInput {
  const contributors = (input.contributors ?? []).map((c, i) => assertOpaqueRef(c, `contributors[${i}]`));
  if (contributors.length > 32) throw new QandeelError('VALIDATION_FAILED', 'too many contributors', { field: 'contributors' });
  const riskLevel = input.riskLevel ?? 'R1';
  if (!RISK_LEVELS.includes(riskLevel)) throw new QandeelError('VALIDATION_FAILED', 'unknown risk level', { field: 'riskLevel' });
  const propagationMode = input.propagationMode ?? 'PROPAGATE';
  if (!PROPAGATION_MODES.includes(propagationMode)) throw new QandeelError('VALIDATION_FAILED', 'unknown propagation mode', { field: 'propagationMode' });
  if (input.dueAt !== undefined && !isTimestamp(input.dueAt)) throw new QandeelError('VALIDATION_FAILED', 'dueAt must be a canonical UTC timestamp', { field: 'dueAt' });
  if (input.processorKind !== undefined && !(PROCESSOR_KIND.test(input.processorKind) && input.processorKind.length <= 64)) {
    throw new QandeelError('VALIDATION_FAILED', 'processorKind must be a short dotted identifier', { field: 'processorKind' });
  }
  const dependsOn = [...new Set((input.dependsOn ?? []).map((d, i) => assertId(d, `dependsOn[${i}]`)))];
  if (dependsOn.length > 64) throw new QandeelError('VALIDATION_FAILED', 'too many dependencies', { field: 'dependsOn' });
  const initial = input.initialState ?? 'PROPOSED';
  if (initial !== 'PROPOSED' && initial !== 'READY') throw new QandeelError('VALIDATION_FAILED', 'initialState must be PROPOSED or READY', { field: 'initialState' });
  return {
    objective: boundedText(input.objective, 'objective', 4000),
    ownerRef: assertOpaqueRef(input.ownerRef, 'ownerRef'),
    contributorsJson: JSON.stringify(contributors),
    priority: assertIntInRange(input.priority ?? 50, 'priority', 0, 100),
    dueAt: (input.dueAt as Timestamp | undefined) ?? null,
    riskLevel,
    completionCriteriaJson: boundedJson(input.completionCriteria ?? {}, 'completionCriteria', 8192),
    requiredEvidenceJson: boundedJson(input.requiredEvidence ?? [], 'requiredEvidence', 8192),
    // Stage 3 §2/§4: R2 and above always require independent review.
    reviewRequired: requiresReview({ reviewRequired: input.reviewRequired === true, riskLevel }),
    approvalRequired: input.approvalRequired === true,
    processorKind: input.processorKind ?? null,
    processorInputJson: boundedJson(input.processorInput ?? null, 'processorInput', 16384),
    maxAttempts: assertIntInRange(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 'maxAttempts', 1, MAX_ATTEMPTS_CEILING),
    parentId: input.parentId === undefined ? null : assertId(input.parentId, 'parentId'),
    dependsOn,
    propagationMode,
    dedupeKey: input.dedupeKey === undefined ? null : boundedText(input.dedupeKey, 'dedupeKey', 200),
    initialState: initial,
  };
}

export function txCreateWorkItem(ctx: StoreContext, input: CreateWorkItemInput, options: CreateOptions = {}): CreateResult {
  const n = normalizeCreateInput(input);
  const actorRef = options.actorRef === undefined ? null : assertOpaqueRef(options.actorRef, 'actorRef');
  const key = options.idempotencyKey === undefined ? null : boundedText(options.idempotencyKey, 'idempotencyKey', 200);
  const fingerprint = sha256Hex(canonicalJson(n));
  if (key !== null) {
    const prior = ctx.db.get<{ fingerprint: string; result_ref: string }>('SELECT fingerprint, result_ref FROM idempotency_records WHERE scope = ? AND idem_key = ?', IDEMPOTENCY_SCOPE_CREATE, key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new QandeelError('IDEMPOTENCY_CONFLICT', 'idempotency key was already used with different input', { scope: IDEMPOTENCY_SCOPE_CREATE, existing: prior.result_ref });
      }
      const existing = getWorkItemRow(ctx, prior.result_ref as Id);
      return { workItem: existing, replayed: true, enqueuedJobId: null };
    }
  }
  if (n.dedupeKey !== null) {
    const dup = ctx.db.get<{ id: string }>(
      `SELECT id FROM work_items WHERE dedupe_key = ? AND state NOT IN ('CLOSED', 'FAILED', 'CANCELLED', 'SUPERSEDED')`,
      n.dedupeKey,
    );
    if (dup) throw new QandeelError('DEDUPE_CONFLICT', 'equivalent live work already exists for this dedupe key', { existing: dup.id });
  }
  const id = newId();
  let rootId: Id = id;
  let depth = 0;
  let correlationId: Id = options.correlationId ?? newId();
  if (n.parentId !== null) {
    const parent = getWorkItemRow(ctx, n.parentId);
    if (TERMINAL_WORK_ITEM_STATES.has(parent.state)) throw new QandeelError('LINEAGE_INVALID', 'cannot create a child of terminal work', { parentId: parent.id });
    if (parent.lineageDepth + 1 > MAX_LINEAGE_DEPTH) throw new QandeelError('LINEAGE_INVALID', 'lineage depth ceiling reached', { parentId: parent.id });
    rootId = parent.rootId;
    depth = parent.lineageDepth + 1;
    correlationId = parent.correlationId;
  }
  const deps = n.dependsOn.map((d) => getWorkItemRow(ctx, d));
  const unresolved = deps.filter((d) => !isSatisfied(d));
  const state = initialState(n.initialState, n, unresolved.length > 0);
  const blockedFailed = unresolved.some((d) => ['FAILED', 'CANCELLED', 'SUPERSEDED'].includes(d.state));
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO work_items (id, root_id, parent_id, lineage_depth, objective, owner_ref, contributors_json, priority, due_at, risk_level,
       completion_criteria_json, required_evidence_json, review_required, approval_required, max_attempts, processor_kind, processor_input_json,
       state, version, blocked_reason, blocker_ref, propagation_mode, dedupe_key, correlation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    rootId,
    n.parentId,
    depth,
    n.objective,
    n.ownerRef,
    n.contributorsJson,
    n.priority,
    n.dueAt,
    n.riskLevel,
    n.completionCriteriaJson,
    n.requiredEvidenceJson,
    n.reviewRequired ? 1 : 0,
    n.approvalRequired ? 1 : 0,
    n.maxAttempts,
    n.processorKind,
    n.processorInputJson,
    state,
    state === 'BLOCKED' ? (blockedFailed ? 'DEPENDENCY_FAILED' : 'DEPENDENCY') : null,
    state === 'BLOCKED' && unresolved[0] ? `work_item:${unresolved[0].id}` : null,
    n.propagationMode,
    n.dedupeKey,
    correlationId,
    at,
    at,
  );
  for (const d of deps) {
    ctx.db.run('INSERT INTO work_item_dependencies (work_item_id, depends_on_id, created_at, resolved_at) VALUES (?, ?, ?, ?)', id, d.id, at, isSatisfied(d) ? at : null);
  }
  const trace: TraceContext = { correlationId, actorRef };
  ctx.db.run(
    `INSERT INTO work_item_transitions (work_item_id, from_state, to_state, version, reason_code, actor_ref, correlation_id, causation_id, occurred_at)
     VALUES (?, NULL, ?, 1, 'work_item.created', ?, ?, NULL, ?)`,
    id,
    state,
    actorRef,
    correlationId,
    at,
  );
  appendEvent(ctx, 'work_item.created', 'work_item', id as Id, trace, { state, priority: n.priority, rootId, parentId: n.parentId, kind: n.processorKind });
  appendAudit(ctx, 'work_item.created', 'work_item', id, trace, 'OK', null, { state, rootId, depth });
  const created = getWorkItemRow(ctx, id);
  const job = state === 'READY' ? enqueueJob(ctx, created, trace) : undefined;
  if (key !== null) {
    ctx.db.run('INSERT INTO idempotency_records (scope, idem_key, fingerprint, result_ref, created_at) VALUES (?, ?, ?, ?, ?)', IDEMPOTENCY_SCOPE_CREATE, key, fingerprint, id, at);
  }
  return { workItem: created, replayed: false, enqueuedJobId: job?.id ?? null };
}

/**
 * Manual (non-runtime) transitions. The runtime alone moves work into and out of execution.
 * WAITING_APPROVAL is entered only by the creation gate and is never exited toward execution in C1
 * (no approval engine). REVIEWED — and so OUTCOME_VERIFIED — is refused in C1: independent review
 * must be enforced by authority (Stage 3 §4), and no reviewer authority exists until the Review
 * Pool / permission engine (C2/C4). Nothing here can make a record look reviewed or approved.
 */
const MANUAL_TARGETS: ReadonlySet<WorkItemState> = new Set(['READY', 'ASSIGNED', 'BLOCKED', 'WAITING_REVIEW', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED']);
const REVIEW_GATED: ReadonlySet<WorkItemState> = new Set(['REVIEWED', 'OUTCOME_VERIFIED']);
const EXECUTABLE: ReadonlySet<WorkItemState> = new Set(['READY', 'ASSIGNED']);

export interface TransitionInput {
  readonly to: WorkItemState;
  readonly reasonCode: string;
  readonly actorRef?: string;
  readonly expectedVersion?: number;
  readonly outcome?: OutcomeStatus;
  readonly blockedReason?: string;
  readonly blockerRef?: string;
}

export function txTransition(ctx: StoreContext, itemId: Id, input: TransitionInput): WorkItemRecord {
  assertCode(input.reasonCode, 'reasonCode');
  const actorRef = input.actorRef === undefined ? null : assertOpaqueRef(input.actorRef, 'actorRef');
  if (input.outcome !== undefined && !OUTCOME_STATUSES.includes(input.outcome)) throw new QandeelError('VALIDATION_FAILED', 'unknown outcome', { field: 'outcome' });
  const item = getWorkItemRow(ctx, itemId);
  if (!MANUAL_TARGETS.has(input.to)) {
    throw new QandeelError('INVALID_TRANSITION', `${input.to} is reached through the runtime or the cancel/supersede API, not a manual transition`, { from: item.state, to: input.to });
  }
  if (REVIEW_GATED.has(input.to)) {
    throw new QandeelError('REVIEW_PATH_UNAVAILABLE', 'no enforced reviewer authority exists in C1; review outcomes cannot be recorded', { from: item.state, to: input.to });
  }
  if (item.state === 'WAITING_APPROVAL') {
    throw new QandeelError('APPROVAL_PATH_UNAVAILABLE', 'work waiting for approval can only be cancelled or superseded in C1', { from: item.state, to: input.to });
  }
  const job = liveJobFor(ctx, item.id);
  if (item.state === 'IN_PROGRESS' || job?.state === 'CLAIMED') throw new QandeelError('LEASE_HELD', 'work is executing; the runtime owns it until the run settles', { workItemId: item.id });
  if (job?.state === 'RECONCILIATION_HOLD') throw new QandeelError('INVALID_TRANSITION', 'resolve the pending reconciliation first', { workItemId: item.id });
  if (input.to === 'WAITING_REVIEW' && !item.reviewRequired) {
    // Optional review of work that needs none: refuse it once dependents already proceeded on the
    // completed output, because a rework from review would silently invalidate what they used.
    const released = ctx.db.get(`SELECT 1 AS released FROM work_item_dependencies WHERE depends_on_id = ? AND resolved_at IS NOT NULL LIMIT 1`, item.id);
    if (released) throw new QandeelError('INVALID_TRANSITION', 'dependents already proceeded on this completed work; open follow-up work instead of reopening it', { workItemId: item.id });
  }
  if (input.to === 'READY' || input.to === 'ASSIGNED') {
    if (job?.state === 'DEAD_LETTER') throw new QandeelError('INVALID_TRANSITION', 'dead-lettered work is released through the dead-letter requeue path', { workItemId: item.id, jobId: job.id });
    const deps = dependencyStatus(ctx, item.id);
    if (deps.unresolved > 0) throw new QandeelError('INVALID_TRANSITION', 'work with unresolved dependencies cannot be released', { workItemId: item.id, unresolved: deps.unresolved });
  }
  const trace: TraceContext = { correlationId: item.correlationId, actorRef };
  const blockedReason = input.to === 'BLOCKED' ? assertCode(input.blockedReason ?? 'MANUAL', 'blockedReason') : undefined;
  const next = applyTransition(ctx, item, input.to, {
    reasonCode: input.reasonCode,
    trace,
    ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
    ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
    ...(blockedReason !== undefined ? { blockedReason, blockerRef: input.blockerRef === undefined ? null : boundedText(input.blockerRef, 'blockerRef', 161) } : {}),
  });
  appendAudit(ctx, 'work_item.transitioned', 'work_item', item.id, trace, 'OK', input.reasonCode, { from: item.state, to: input.to });
  if (EXECUTABLE.has(next.state)) {
    if (job?.state === 'WAITING') {
      ctx.db.run(`UPDATE queue_jobs SET state = 'QUEUED', available_at = ?, wait_reason = NULL, updated_at = ? WHERE id = ? AND state = 'WAITING'`, ts(ctx), ts(ctx), job.id);
    } else {
      enqueueJob(ctx, next, trace);
    }
  } else if (job && (job.state === 'QUEUED' || job.state === 'WAITING' || job.state === 'DEAD_LETTER')) withdrawJob(ctx, next, trace, input.reasonCode);
  return getWorkItemRow(ctx, item.id);
}

const DEPENDENCY_EDITABLE: ReadonlySet<WorkItemState> = new Set(['PROPOSED', 'READY', 'ASSIGNED', 'BLOCKED', 'WAITING_APPROVAL']);

export function txAddDependency(ctx: StoreContext, itemId: Id, dependsOnId: Id, actorRef?: string): WorkItemRecord {
  if (itemId === dependsOnId) throw new QandeelError('DEPENDENCY_SELF', 'a work item cannot depend on itself', { workItemId: itemId });
  const actor = actorRef === undefined ? null : assertOpaqueRef(actorRef, 'actorRef');
  const item = getWorkItemRow(ctx, itemId);
  const dep = getWorkItemRow(ctx, dependsOnId);
  if (!DEPENDENCY_EDITABLE.has(item.state)) throw new QandeelError('INVALID_TRANSITION', 'dependencies can be added only before execution', { workItemId: item.id, state: item.state });
  if (dependsTransitively(ctx, dependsOnId, itemId)) {
    throw new QandeelError('DEPENDENCY_CYCLE', 'adding this dependency would create a cycle', { workItemId: itemId, dependsOnId });
  }
  const existing = ctx.db.get('SELECT 1 AS present FROM work_item_dependencies WHERE work_item_id = ? AND depends_on_id = ?', itemId, dependsOnId);
  if (existing) return item;
  const at = ts(ctx);
  ctx.db.run('INSERT INTO work_item_dependencies (work_item_id, depends_on_id, created_at, resolved_at) VALUES (?, ?, ?, ?)', itemId, dependsOnId, at, isSatisfied(dep) ? at : null);
  const trace: TraceContext = { correlationId: item.correlationId, actorRef: actor };
  appendEvent(ctx, 'work_item.dependency_added', 'work_item', item.id, trace, { dependsOnId });
  appendAudit(ctx, 'work_item.dependency_added', 'work_item', item.id, trace, 'OK', null, { dependsOnId });
  if (isSatisfied(dep)) return getWorkItemRow(ctx, item.id);
  if (item.state === 'READY' || item.state === 'ASSIGNED') {
    withdrawJob(ctx, item, trace, 'dependency.added');
    const blocked = applyTransition(ctx, getWorkItemRow(ctx, item.id), 'BLOCKED', { reasonCode: 'dependency.added', trace, blockedReason: 'DEPENDENCY', blockerRef: `work_item:${dep.id}` });
    return reevaluateDependencyBlock(ctx, blocked, trace);
  }
  return reevaluateDependencyBlock(ctx, getWorkItemRow(ctx, item.id), trace);
}

export interface TerminationInput {
  readonly reasonCode: string;
  readonly actorRef?: string;
  readonly policy?: PropagationPolicy;
}

export function txRequestCancellation(ctx: StoreContext, itemId: Id, input: TerminationInput): TerminationOutcome {
  assertCode(input.reasonCode, 'reasonCode');
  const actorRef = input.actorRef === undefined ? null : assertOpaqueRef(input.actorRef, 'actorRef');
  const item = getWorkItemRow(ctx, itemId);
  const out = newTerminationOutcome();
  requestTermination(ctx, item.id, { mode: 'CANCELLED', reasonCode: input.reasonCode, trace: { correlationId: item.correlationId, actorRef }, policy: input.policy ?? defaultPropagationPolicy }, out);
  return out;
}

export function txSupersede(ctx: StoreContext, itemId: Id, supersededById: Id, input: TerminationInput): TerminationOutcome {
  assertCode(input.reasonCode, 'reasonCode');
  if (itemId === supersededById) throw new QandeelError('VALIDATION_FAILED', 'work cannot supersede itself', { workItemId: itemId });
  const actorRef = input.actorRef === undefined ? null : assertOpaqueRef(input.actorRef, 'actorRef');
  const item = getWorkItemRow(ctx, itemId);
  const replacement = getWorkItemRow(ctx, supersededById);
  if (TERMINAL_WORK_ITEM_STATES.has(replacement.state) && replacement.state !== 'CLOSED') {
    throw new QandeelError('VALIDATION_FAILED', 'the replacement work item has itself ended without completion', { supersededById });
  }
  // The replacement must not depend on the work it supersedes: that dependency could never resolve.
  if (dependsTransitively(ctx, replacement.id, item.id)) {
    throw new QandeelError('DEPENDENCY_CYCLE', 'the replacement depends on the work it supersedes', { workItemId: item.id, supersededById });
  }
  // The replacement must not be a descendant of the superseded work: propagation would cancel it.
  for (let cursor: WorkItemRecord | null = replacement, hops = 0; cursor?.parentId && hops <= MAX_LINEAGE_DEPTH; hops++) {
    if (cursor.parentId === item.id) throw new QandeelError('LINEAGE_INVALID', 'the replacement is a descendant of the work it supersedes', { workItemId: item.id, supersededById });
    cursor = getWorkItemRow(ctx, cursor.parentId);
  }
  const out = newTerminationOutcome();
  requestTermination(
    ctx,
    item.id,
    { mode: 'SUPERSEDED', reasonCode: input.reasonCode, supersededBy: replacement.id, trace: { correlationId: item.correlationId, actorRef }, policy: input.policy ?? defaultPropagationPolicy },
    out,
  );
  return out;
}

export function history(ctx: StoreContext, itemId: Id): TransitionRecord[] {
  return ctx.db.all('SELECT * FROM work_item_transitions WHERE work_item_id = ? ORDER BY version', itemId).map(mapTransition);
}

export function lineage(ctx: StoreContext, rootId: Id): WorkItemRecord[] {
  return ctx.db.all('SELECT * FROM work_items WHERE root_id = ? ORDER BY lineage_depth, created_at, id', rootId).map(mapWorkItem);
}

export function dependencies(ctx: StoreContext, itemId: Id): { dependsOnId: Id; resolvedAt: Timestamp | null }[] {
  return ctx.db
    .all<{ depends_on_id: string; resolved_at: string | null }>('SELECT depends_on_id, resolved_at FROM work_item_dependencies WHERE work_item_id = ? ORDER BY created_at, depends_on_id', itemId)
    .map((r) => ({ dependsOnId: r.depends_on_id as Id, resolvedAt: r.resolved_at as Timestamp | null }));
}
