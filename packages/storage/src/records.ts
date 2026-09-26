/** Public record shapes returned by the store. Rows are mapped explicitly; nothing leaks raw SQL rows. */
import type {
  EventType,
  Id,
  JobState,
  OpaqueRef,
  OutcomeStatus,
  PropagationMode,
  RecoveryDisposition,
  RiskLevel,
  RunState,
  SideEffectClass,
  Timestamp,
  WorkItemState,
} from '@qandeel-company/domain';

export interface WorkItemRecord {
  readonly id: Id;
  readonly rootId: Id;
  readonly parentId: Id | null;
  readonly lineageDepth: number;
  readonly objective: string;
  readonly ownerRef: OpaqueRef;
  readonly contributors: readonly OpaqueRef[];
  readonly priority: number;
  readonly dueAt: Timestamp | null;
  readonly riskLevel: RiskLevel;
  readonly completionCriteria: unknown;
  readonly requiredEvidence: unknown;
  readonly reviewRequired: boolean;
  readonly approvalRequired: boolean;
  readonly processorKind: string | null;
  readonly processorInput: unknown;
  readonly state: WorkItemState;
  readonly version: number;
  readonly outcome: OutcomeStatus;
  readonly blockedReason: string | null;
  readonly blockerRef: string | null;
  readonly propagationMode: PropagationMode;
  readonly terminationRequested: 'CANCELLED' | 'SUPERSEDED' | null;
  readonly terminationReason: string | null;
  readonly supersededBy: Id | null;
  readonly dedupeKey: string | null;
  readonly correlationId: Id;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface TransitionRecord {
  readonly id: number;
  readonly workItemId: Id;
  readonly fromState: WorkItemState | null;
  readonly toState: WorkItemState;
  readonly version: number;
  readonly reasonCode: string;
  readonly actorRef: string | null;
  readonly correlationId: Id;
  readonly causationId: Id | null;
  readonly occurredAt: Timestamp;
}

export interface JobRecord {
  readonly id: Id;
  readonly workItemId: Id;
  readonly rootWorkItemId: Id;
  readonly processorKind: string;
  readonly state: JobState;
  readonly priority: number;
  readonly availableAt: Timestamp;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: Timestamp | null;
  readonly fencingToken: number;
  readonly currentRunId: Id | null;
  readonly cancelRequested: boolean;
  readonly waitReason: string | null;
  readonly deadLetterReason: string | null;
  readonly lastFailureCode: string | null;
  readonly requeueCount: number;
  readonly correlationId: Id;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface RunRecord {
  readonly id: Id;
  readonly jobId: Id;
  readonly workItemId: Id;
  readonly runSeq: number;
  readonly attempt: number;
  readonly processorKind: string;
  readonly sideEffects: SideEffectClass;
  readonly state: RunState;
  readonly workerId: string;
  readonly fencingToken: number;
  readonly checkpointSeq: number;
  readonly retryOfRunId: Id | null;
  readonly correlationId: Id;
  readonly failureCode: string | null;
  readonly failureCategory: string | null;
  readonly recoveryDisposition: RecoveryDisposition | null;
  readonly startedAt: Timestamp;
  readonly endedAt: Timestamp | null;
}

export interface CheckpointRecord {
  readonly id: number;
  readonly runId: Id;
  readonly jobId: Id;
  readonly seq: number;
  readonly kind: string;
  readonly kindVersion: number;
  readonly state: unknown;
  readonly sha256: string;
  readonly createdAt: Timestamp;
}

export interface EventRecord {
  readonly seq: number;
  readonly id: Id;
  readonly type: EventType;
  readonly version: number;
  readonly aggregateType: string;
  readonly aggregateId: Id;
  readonly correlationId: Id;
  readonly causationId: Id | null;
  readonly createdAt: Timestamp;
  readonly payload: Record<string, unknown>;
  readonly dispatchedAt: Timestamp | null;
}

export interface AuditRecord {
  readonly id: number;
  readonly occurredAt: Timestamp;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly actorRef: string | null;
  readonly correlationId: Id | null;
  readonly causationId: Id | null;
  readonly outcome: 'OK' | 'REJECTED' | 'ERROR';
  readonly reasonCode: string | null;
  readonly details: Record<string, unknown>;
}

/** Proof of claim ownership. Every worker write must present the fence it was issued. */
export interface Fence {
  readonly jobId: Id;
  readonly runId: Id;
  readonly workerId: string;
  readonly fencingToken: number;
}

/** Proof of supervisor authority, checked inside claim transactions. */
export interface SupervisorFence {
  readonly holderId: Id;
  readonly fencingToken: number;
}
