/**
 * Storage-internal helpers shared by the repositories. Not exported from the package.
 *
 * Every helper here must run inside a transaction opened by the calling repository method: state
 * change, history row, outbox event and audit row commit (or roll back) together.
 */
import {
  EVENT_PAYLOAD_MAX_BYTES,
  QandeelError,
  boundedJson,
  newId,
  now,
  type AggregateType,
  type Clock,
  type EventType,
  type Id,
  type Timestamp,
  type WorkItemState,
} from '@qandeel-company/domain';

import type { AuditRecord, CheckpointRecord, EventRecord, JobRecord, RunRecord, TransitionRecord, WorkItemRecord } from './records.js';
import type { Row, SqliteConnection, SqlValue } from './sqlite/connection.js';

/** Named durability boundaries at which failure-injection tests may kill the process. */
export type FaultPoint =
  | 'checkpoint.beforeCommit'
  | 'checkpoint.afterCommit'
  | 'artifact.afterTempWrite'
  | 'artifact.afterStage'
  | 'artifact.afterRename'
  | 'reservation.afterCommit'
  | 'settlement.beforeCommit'
  | 'toolIntent.afterCommit'
  | 'memoryCandidate.afterCommit';

export type FaultHook = (point: FaultPoint) => void;

export interface StoreContext {
  readonly db: SqliteConnection;
  readonly clock: Clock;
  readonly fault: FaultHook;
}

export interface TraceContext {
  readonly correlationId: Id;
  readonly causationId?: Id | null;
  readonly actorRef?: string | null;
}

export const ts = (ctx: StoreContext): Timestamp => now(ctx.clock);

const bool = (v: SqlValue | undefined): boolean => v === 1;
const str = (v: SqlValue | undefined): string => String(v);
const optStr = (v: SqlValue | undefined): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: SqlValue | undefined): number => Number(v);
const parse = (v: SqlValue | undefined): unknown => JSON.parse(String(v));

export function mapWorkItem(r: Row): WorkItemRecord {
  return {
    id: str(r.id) as Id,
    rootId: str(r.root_id) as Id,
    parentId: optStr(r.parent_id) as Id | null,
    lineageDepth: num(r.lineage_depth),
    objective: str(r.objective),
    ownerRef: str(r.owner_ref) as WorkItemRecord['ownerRef'],
    contributors: parse(r.contributors_json) as WorkItemRecord['contributors'],
    priority: num(r.priority),
    dueAt: optStr(r.due_at) as Timestamp | null,
    riskLevel: str(r.risk_level) as WorkItemRecord['riskLevel'],
    completionCriteria: parse(r.completion_criteria_json),
    requiredEvidence: parse(r.required_evidence_json),
    reviewRequired: bool(r.review_required),
    approvalRequired: bool(r.approval_required),
    processorKind: optStr(r.processor_kind),
    processorInput: parse(r.processor_input_json),
    state: str(r.state) as WorkItemState,
    version: num(r.version),
    outcome: str(r.outcome) as WorkItemRecord['outcome'],
    blockedReason: optStr(r.blocked_reason),
    blockerRef: optStr(r.blocker_ref),
    propagationMode: str(r.propagation_mode) as WorkItemRecord['propagationMode'],
    terminationRequested: optStr(r.termination_requested) as WorkItemRecord['terminationRequested'],
    terminationReason: optStr(r.termination_reason),
    supersededBy: optStr(r.superseded_by) as Id | null,
    dedupeKey: optStr(r.dedupe_key),
    approvalId: optStr(r.approval_id) as Id | null,
    correlationId: str(r.correlation_id) as Id,
    createdAt: str(r.created_at) as Timestamp,
    updatedAt: str(r.updated_at) as Timestamp,
  };
}

export function mapJob(r: Row): JobRecord {
  return {
    id: str(r.id) as Id,
    workItemId: str(r.work_item_id) as Id,
    rootWorkItemId: str(r.root_work_item_id) as Id,
    processorKind: str(r.processor_kind),
    state: str(r.state) as JobRecord['state'],
    priority: num(r.priority),
    availableAt: str(r.available_at) as Timestamp,
    attemptCount: num(r.attempt_count),
    maxAttempts: num(r.max_attempts),
    leaseOwner: optStr(r.lease_owner),
    leaseExpiresAt: optStr(r.lease_expires_at) as Timestamp | null,
    fencingToken: num(r.fencing_token),
    currentRunId: optStr(r.current_run_id) as Id | null,
    cancelRequested: bool(r.cancel_requested),
    waitReason: optStr(r.wait_reason),
    deadLetterReason: optStr(r.dead_letter_reason),
    lastFailureCode: optStr(r.last_failure_code),
    requeueCount: num(r.requeue_count),
    correlationId: str(r.correlation_id) as Id,
    createdAt: str(r.created_at) as Timestamp,
    updatedAt: str(r.updated_at) as Timestamp,
  };
}

export function mapRun(r: Row): RunRecord {
  return {
    id: str(r.id) as Id,
    jobId: str(r.job_id) as Id,
    workItemId: str(r.work_item_id) as Id,
    runSeq: num(r.run_seq),
    attempt: num(r.attempt),
    processorKind: str(r.processor_kind),
    sideEffects: str(r.side_effects) as RunRecord['sideEffects'],
    state: str(r.state) as RunRecord['state'],
    workerId: str(r.worker_id),
    fencingToken: num(r.fencing_token),
    checkpointSeq: num(r.checkpoint_seq),
    retryOfRunId: optStr(r.retry_of_run_id) as Id | null,
    correlationId: str(r.correlation_id) as Id,
    failureCode: optStr(r.failure_code),
    failureCategory: optStr(r.failure_category),
    recoveryDisposition: optStr(r.recovery_disposition) as RunRecord['recoveryDisposition'],
    startedAt: str(r.started_at) as Timestamp,
    endedAt: optStr(r.ended_at) as Timestamp | null,
  };
}

export function mapCheckpoint(r: Row): CheckpointRecord {
  return {
    id: num(r.id),
    runId: str(r.run_id) as Id,
    jobId: str(r.job_id) as Id,
    seq: num(r.seq),
    kind: str(r.kind),
    kindVersion: num(r.kind_version),
    state: parse(r.state_json),
    sha256: str(r.sha256),
    createdAt: str(r.created_at) as Timestamp,
  };
}

export function mapTransition(r: Row): TransitionRecord {
  return {
    id: num(r.id),
    workItemId: str(r.work_item_id) as Id,
    fromState: optStr(r.from_state) as WorkItemState | null,
    toState: str(r.to_state) as WorkItemState,
    version: num(r.version),
    reasonCode: str(r.reason_code),
    actorRef: optStr(r.actor_ref),
    correlationId: str(r.correlation_id) as Id,
    causationId: optStr(r.causation_id) as Id | null,
    occurredAt: str(r.occurred_at) as Timestamp,
  };
}

export function mapEvent(r: Row): EventRecord {
  return {
    seq: num(r.seq),
    id: str(r.id) as Id,
    type: str(r.type) as EventType,
    version: num(r.version),
    aggregateType: str(r.aggregate_type),
    aggregateId: str(r.aggregate_id) as Id,
    correlationId: str(r.correlation_id) as Id,
    causationId: optStr(r.causation_id) as Id | null,
    createdAt: str(r.created_at) as Timestamp,
    payload: parse(r.payload_json) as Record<string, unknown>,
    dispatchedAt: optStr(r.dispatched_at) as Timestamp | null,
  };
}

export function mapAudit(r: Row): AuditRecord {
  return {
    id: num(r.id),
    occurredAt: str(r.occurred_at) as Timestamp,
    action: str(r.action),
    entityType: str(r.entity_type),
    entityId: str(r.entity_id),
    actorRef: optStr(r.actor_ref),
    correlationId: optStr(r.correlation_id) as Id | null,
    causationId: optStr(r.causation_id) as Id | null,
    outcome: str(r.outcome) as AuditRecord['outcome'],
    reasonCode: optStr(r.reason_code),
    details: parse(r.details_json) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------------------------

/** Content-free scalar metadata only: IDs, states, counts, codes (Rule A). */
export type Scalars = Readonly<Record<string, string | number | boolean | null>>;

function scalars(value: Scalars, maxBytes: number, field: string): string {
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' && v.length > 128) throw new QandeelError('VALIDATION_FAILED', 'metadata values are short identifiers or codes, not content', { field: `${field}.${k}` });
  }
  return boundedJson(value, field, maxBytes);
}

export function appendEvent(
  ctx: StoreContext,
  type: EventType,
  aggregateType: AggregateType,
  aggregateId: Id,
  trace: TraceContext,
  payload: Scalars = {},
): Id {
  const id = newId();
  ctx.db.run(
    `INSERT INTO events (id, type, version, aggregate_type, aggregate_id, correlation_id, causation_id, created_at, payload_json)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    id,
    type,
    aggregateType,
    aggregateId,
    trace.correlationId,
    trace.causationId ?? null,
    ts(ctx),
    scalars(payload, EVENT_PAYLOAD_MAX_BYTES, 'event.payload'),
  );
  return id;
}

export function appendAudit(
  ctx: StoreContext,
  action: string,
  entityType: string,
  entityId: string,
  trace: Partial<TraceContext>,
  outcome: 'OK' | 'REJECTED' | 'ERROR',
  reasonCode: string | null,
  details: Scalars = {},
): void {
  ctx.db.run(
    `INSERT INTO audit_events (occurred_at, action, entity_type, entity_id, actor_ref, correlation_id, causation_id, outcome, reason_code, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ts(ctx),
    action,
    entityType,
    entityId,
    trace.actorRef ?? null,
    trace.correlationId ?? null,
    trace.causationId ?? null,
    outcome,
    reasonCode,
    scalars(details, 1024, 'audit.details'),
  );
}

export function getWorkItemRow(ctx: StoreContext, id: Id): WorkItemRecord {
  const row = ctx.db.get('SELECT * FROM work_items WHERE id = ?', id);
  if (!row) throw new QandeelError('NOT_FOUND', 'work item not found', { workItemId: id });
  return mapWorkItem(row);
}

export function getJobRow(ctx: StoreContext, id: Id): JobRecord {
  const row = ctx.db.get('SELECT * FROM queue_jobs WHERE id = ?', id);
  if (!row) throw new QandeelError('NOT_FOUND', 'job not found', { jobId: id });
  return mapJob(row);
}

export function liveJobFor(ctx: StoreContext, workItemId: Id): JobRecord | undefined {
  const row = ctx.db.get(
    `SELECT * FROM queue_jobs WHERE work_item_id = ? AND state IN ('QUEUED', 'CLAIMED', 'WAITING', 'RECONCILIATION_HOLD', 'DEAD_LETTER')`,
    workItemId,
  );
  return row ? mapJob(row) : undefined;
}
