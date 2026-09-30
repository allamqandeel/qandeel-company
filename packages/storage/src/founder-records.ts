/** C5 record shapes and row mappers (storage-internal mapping; public shapes). */
import { QandeelError, type Id, type Timestamp } from '@qandeel-company/domain';
import type { AttentionLane, AttentionLevel, ContextKind, FounderBrief, GoalKind, GoalState, MessagePurpose, MutatingIntent, ThreadKind } from '@qandeel-company/governance';

import type { Row, SqlValue } from './sqlite/connection.js';

const str = (v: SqlValue | undefined): string => String(v);
const optStr = (v: SqlValue | undefined): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: SqlValue | undefined): number => Number(v);
const arr = (v: SqlValue | undefined): readonly string[] => (JSON.parse(String(v ?? '[]')) as unknown[]).map(String);

export interface GoalRecord {
  readonly id: Id;
  readonly kind: GoalKind;
  readonly departmentId: Id | null;
  readonly title: string;
  readonly summary: string;
  readonly successCriteria: readonly string[];
  readonly state: GoalState;
  readonly ownerRef: string;
  readonly parentGoalId: Id | null;
  readonly horizonFrom: Timestamp | null;
  readonly horizonTo: Timestamp | null;
  readonly approvedByRef: string | null;
  readonly approvedAt: Timestamp | null;
  readonly supersededBy: Id | null;
  readonly createdByRef: string;
  readonly version: number;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export const mapGoal = (r: Row): GoalRecord => ({
  id: str(r.id) as Id,
  kind: str(r.kind) as GoalKind,
  departmentId: optStr(r.department_id) as Id | null,
  title: str(r.title),
  summary: str(r.summary),
  successCriteria: arr(r.success_criteria_json),
  state: str(r.state) as GoalState,
  ownerRef: str(r.owner_ref),
  parentGoalId: optStr(r.parent_goal_id) as Id | null,
  horizonFrom: optStr(r.horizon_from) as Timestamp | null,
  horizonTo: optStr(r.horizon_to) as Timestamp | null,
  approvedByRef: optStr(r.approved_by_ref),
  approvedAt: optStr(r.approved_at) as Timestamp | null,
  supersededBy: optStr(r.superseded_by) as Id | null,
  createdByRef: str(r.created_by_ref),
  version: num(r.version),
  createdAt: str(r.created_at) as Timestamp,
  updatedAt: str(r.updated_at) as Timestamp,
});

export interface GoalHistoryRecord {
  readonly version: number;
  readonly fromState: GoalState | null;
  readonly toState: GoalState;
  readonly reasonCode: string;
  readonly actorRef: string;
  readonly occurredAt: Timestamp;
}

export const mapGoalHistory = (r: Row): GoalHistoryRecord => ({
  version: num(r.version),
  fromState: optStr(r.from_state) as GoalState | null,
  toState: str(r.to_state) as GoalState,
  reasonCode: str(r.reason_code),
  actorRef: str(r.actor_ref),
  occurredAt: str(r.occurred_at) as Timestamp,
});

export interface GoalWorkLinkRecord {
  readonly id: Id;
  readonly goalId: Id;
  readonly workItemId: Id;
  readonly linkKind: 'SERVES' | 'DERIVED';
  readonly createdByRef: string;
  readonly createdAt: Timestamp;
  readonly endedAt: Timestamp | null;
  readonly endReasonCode: string | null;
}

export const mapGoalWorkLink = (r: Row): GoalWorkLinkRecord => ({
  id: str(r.id) as Id,
  goalId: str(r.goal_id) as Id,
  workItemId: str(r.work_item_id) as Id,
  linkKind: str(r.link_kind) as GoalWorkLinkRecord['linkKind'],
  createdByRef: str(r.created_by_ref),
  createdAt: str(r.created_at) as Timestamp,
  endedAt: optStr(r.ended_at) as Timestamp | null,
  endReasonCode: optStr(r.end_reason_code),
});

export interface ThreadRecord {
  readonly id: Id;
  readonly kind: ThreadKind;
  readonly employeeId: Id;
  readonly subject: string;
  readonly contextKind: ContextKind | null;
  readonly contextRef: string | null;
  readonly accessScope: 'FOUNDER_ONLY';
  readonly state: 'OPEN' | 'CLOSED';
  readonly openedByRef: string;
  readonly version: number;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export const mapThread = (r: Row): ThreadRecord => ({
  id: str(r.id) as Id,
  kind: str(r.kind) as ThreadKind,
  employeeId: str(r.employee_id) as Id,
  subject: str(r.subject),
  contextKind: optStr(r.context_kind) as ContextKind | null,
  contextRef: optStr(r.context_ref),
  accessScope: 'FOUNDER_ONLY',
  state: str(r.state) as ThreadRecord['state'],
  openedByRef: str(r.opened_by_ref),
  version: num(r.version),
  createdAt: str(r.created_at) as Timestamp,
  updatedAt: str(r.updated_at) as Timestamp,
});

/** A message with its body: Founder-scoped company content (Stage 9 §24), read only through authorized reads. */
export interface MessageRecord {
  readonly id: Id;
  readonly threadId: Id;
  readonly seq: number;
  readonly senderKind: 'FOUNDER' | 'EMPLOYEE';
  readonly senderRef: string;
  readonly purpose: MessagePurpose;
  readonly attentionLevel: AttentionLevel;
  readonly body: string;
  readonly bodySha256: string;
  readonly brief: FounderBrief | null;
  readonly responseRequired: boolean;
  readonly replyWorkItemId: Id | null;
  readonly runId: Id | null;
  readonly contextRefs: readonly string[];
  readonly supersededBy: Id | null;
  readonly createdAt: Timestamp;
}

export const mapMessage = (r: Row): MessageRecord => ({
  id: str(r.id) as Id,
  threadId: str(r.thread_id) as Id,
  seq: num(r.seq),
  senderKind: str(r.sender_kind) as MessageRecord['senderKind'],
  senderRef: str(r.sender_ref),
  purpose: str(r.purpose) as MessagePurpose,
  attentionLevel: str(r.attention_level) as AttentionLevel,
  body: str(r.body),
  bodySha256: str(r.body_sha256),
  brief: r.brief_json === null || r.brief_json === undefined ? null : (JSON.parse(String(r.brief_json)) as FounderBrief),
  responseRequired: num(r.response_required) === 1,
  replyWorkItemId: optStr(r.reply_work_item_id) as Id | null,
  runId: optStr(r.run_id) as Id | null,
  contextRefs: arr(r.context_refs_json),
  supersededBy: optStr(r.superseded_by) as Id | null,
  createdAt: str(r.created_at) as Timestamp,
});

/** The content-free shape of a message (IDs, codes, hashes): what telemetry and summaries may carry. */
export type MessageMeta = Omit<MessageRecord, 'body' | 'brief'>;
export const messageMeta = (m: MessageRecord): MessageMeta =>
  Object.freeze(Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'body' && k !== 'brief'))) as MessageMeta;

/** A row that the same transaction just wrote: its absence is a storage invariant failure, not a lookup miss. */
export function mustRow<T extends object>(row: T | undefined, what: string): T {
  if (row === undefined) throw new QandeelError('NOT_FOUND', `${what} vanished inside its own transaction`, { what });
  return row;
}

export interface AttentionItemRecord {
  readonly id: Id;
  readonly dedupKey: string;
  readonly lane: AttentionLane;
  readonly level: AttentionLevel;
  readonly sourceKind: 'APPROVAL' | 'STAFFING_REQUEST' | 'ESCALATION' | 'REVIEW_CONFLICT' | 'BRIEF' | 'THREAD' | 'GOAL' | 'DECISION_REQUEST';
  readonly sourceRef: string;
  readonly ownerRef: string | null;
  readonly state: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  readonly firstSeenAt: Timestamp;
  readonly lastSignalAt: Timestamp;
  readonly signalCount: number;
  readonly cooldownUntil: Timestamp | null;
  readonly resolvedAt: Timestamp | null;
  readonly resolvedReason: string | null;
  readonly version: number;
}

export const mapAttentionItem = (r: Row): AttentionItemRecord => ({
  id: str(r.id) as Id,
  dedupKey: str(r.dedup_key),
  lane: str(r.lane) as AttentionLane,
  level: str(r.level) as AttentionLevel,
  sourceKind: str(r.source_kind) as AttentionItemRecord['sourceKind'],
  sourceRef: str(r.source_ref),
  ownerRef: optStr(r.owner_ref),
  state: str(r.state) as AttentionItemRecord['state'],
  firstSeenAt: str(r.first_seen_at) as Timestamp,
  lastSignalAt: str(r.last_signal_at) as Timestamp,
  signalCount: num(r.signal_count),
  cooldownUntil: optStr(r.cooldown_until) as Timestamp | null,
  resolvedAt: optStr(r.resolved_at) as Timestamp | null,
  resolvedReason: optStr(r.resolved_reason),
  version: num(r.version),
});

/** A verified Founder session (never the token: only its id, principal, expiry and the CSRF hash). */
export interface FounderSessionRecord {
  readonly id: Id;
  readonly founderRef: string;
  readonly launchId: Id;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly lastSeenAt: Timestamp;
  readonly revokedAt: Timestamp | null;
  readonly revokeReason: string | null;
}

export const mapFounderSession = (r: Row): FounderSessionRecord => ({
  id: str(r.id) as Id,
  founderRef: str(r.founder_ref),
  launchId: str(r.launch_id) as Id,
  createdAt: str(r.created_at) as Timestamp,
  expiresAt: str(r.expires_at) as Timestamp,
  lastSeenAt: str(r.last_seen_at) as Timestamp,
  revokedAt: optStr(r.revoked_at) as Timestamp | null,
  revokeReason: optStr(r.revoke_reason),
});

export interface ActionPreviewRecord {
  readonly id: Id;
  readonly sessionId: Id;
  readonly intentKind: MutatingIntent;
  /** IDs, codes, bounded numbers — and, for OUTCOME_VERIFY, bounded lists of evidence codes / refs. */
  readonly payload: Record<string, string | number | boolean | null | readonly string[]>;
  readonly fingerprint: string;
  readonly state: 'PREVIEW' | 'CONFIRMED' | 'REJECTED' | 'EXPIRED' | 'FAILED';
  readonly resultRef: string | null;
  readonly resultCode: string | null;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly decidedAt: Timestamp | null;
}

export const mapActionPreview = (r: Row): ActionPreviewRecord => ({
  id: str(r.id) as Id,
  sessionId: str(r.session_id) as Id,
  intentKind: str(r.intent_kind) as MutatingIntent,
  payload: JSON.parse(str(r.payload_json)) as ActionPreviewRecord['payload'],
  fingerprint: str(r.fingerprint),
  state: str(r.state) as ActionPreviewRecord['state'],
  resultRef: optStr(r.result_ref),
  resultCode: optStr(r.result_code),
  createdAt: str(r.created_at) as Timestamp,
  expiresAt: str(r.expires_at) as Timestamp,
  decidedAt: optStr(r.decided_at) as Timestamp | null,
});
