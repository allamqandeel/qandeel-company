import type { Id } from './ids.js';
import type { Timestamp } from './time.js';
import type { JsonObject } from './validation.js';

/**
 * Provider-neutral durable event envelope (outbox). Events are written in the same SQLite
 * transaction as the state change they describe. They are operational records — IDs, states and
 * reason codes — never raw model traces, chain-of-thought or private content (Rule A).
 */
export interface EventEnvelope {
  readonly id: Id;
  readonly type: EventType;
  readonly version: number;
  readonly aggregateType: AggregateType;
  readonly aggregateId: Id;
  readonly correlationId: Id;
  readonly causationId: Id | null;
  readonly createdAt: Timestamp;
  readonly payload: JsonObject;
}

/** C7-A adds `external_source`: a governed source of operational facts / external outcome evidence (0012). */
export const AGGREGATE_TYPES = ['work_item', 'job', 'run', 'artifact', 'runtime', 'backup', 'external_source'] as const;
export type AggregateType = (typeof AGGREGATE_TYPES)[number];

export const EVENT_TYPES = [
  'work_item.created',
  'work_item.transitioned',
  'work_item.dependency_added',
  'work_item.unblocked',
  'work_item.cancel_requested',
  'job.enqueued',
  'job.claimed',
  'job.woken',
  'job.retry_scheduled',
  'job.dead_lettered',
  'job.reconciliation_required',
  'job.requeued',
  'run.checkpointed',
  'run.finished',
  'artifact.ready',
  'artifact.quarantined',
  'runtime.recovered',
  // C2 (content-free: IDs, codes, amounts only).
  'work_item.approval_requested',
  'work_item.approved',
  'run.attributed',
  'run.usage_settled',
  'run.tool_invocation',
  // C7-A (content-free: source / record / binding IDs, codes and counts only — never an intake payload).
  'external_source.registered',
  'external_source.contract_registered',
  'external_source.state_changed',
  'external_record.accepted',
  'external_record.conflict_detected',
  'external_binding.changed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Event payloads carry only short scalar metadata. */
export const EVENT_PAYLOAD_MAX_BYTES = 2_048;
