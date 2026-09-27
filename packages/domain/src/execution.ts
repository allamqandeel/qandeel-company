import { QandeelError } from './errors.js';
import type { Id } from './ids.js';
import type { Timestamp } from './time.js';
import type { JsonObject, JsonValue } from './validation.js';

/**
 * Queue Job — the durable unit the runtime schedules (Stage 12 §14, §19).
 *
 *   QUEUED               waiting for a worker; eligible once `available_at` has passed
 *   CLAIMED              exclusively leased to one worker (lease owner + expiry + fencing token)
 *   WAITING              parked until an explicit wake (event-driven wait; no polling)
 *   RECONCILIATION_HOLD  an ambiguous crash left an uncertain side effect; never auto-retried
 *   DEAD_LETTER          retries exhausted / poison job; parked for explicit operator requeue
 *   DONE / FAILED / CANCELLED  final
 */
export const JOB_STATES = ['QUEUED', 'CLAIMED', 'WAITING', 'RECONCILIATION_HOLD', 'DEAD_LETTER', 'DONE', 'FAILED', 'CANCELLED'] as const;
export type JobState = (typeof JOB_STATES)[number];
export const FINAL_JOB_STATES: ReadonlySet<JobState> = new Set(['DONE', 'FAILED', 'CANCELLED']);

/**
 * Run — one durable execution attempt of a job by one worker (Employee ≠ Model ≠ Session ≠ Run ≠
 * Process). A Run is not a model invocation; C1 runs only deterministic processors.
 */
export const RUN_STATES = [
  'RUNNING',
  'SUCCEEDED',
  'PARKED',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT',
  'RECONCILIATION_REQUIRED',
  'CANCELLED',
  'INTERRUPTED',
] as const;
export type RunState = (typeof RUN_STATES)[number];

/** Stage 15 D15-C.2: post-crash classification. Resume, retry and reconcile are distinct actions. */
export const RECOVERY_DISPOSITIONS = ['SAFE_TO_RESUME', 'SAFE_TO_RETRY', 'RECONCILIATION_REQUIRED'] as const;
export type RecoveryDisposition = (typeof RECOVERY_DISPOSITIONS)[number];

/**
 * What a processor may do outside Company state. C1 processors are all `NONE`; the other classes
 * exist so that later Tool Executors cannot be blindly retried across an ambiguous crash.
 *   NONE        only Company-internal, transactional effects
 *   IDEMPOTENT  external effects keyed by a stable operation id (safe to repeat)
 *   UNSAFE      external effects whose outcome is uncertain after a crash → reconcile first
 */
export const SIDE_EFFECT_CLASSES = ['NONE', 'IDEMPOTENT', 'UNSAFE'] as const;
export type SideEffectClass = (typeof SIDE_EFFECT_CLASSES)[number];

export function classifyInterruptedRun(sideEffects: SideEffectClass, hasCheckpoint: boolean): RecoveryDisposition {
  if (sideEffects === 'UNSAFE') return 'RECONCILIATION_REQUIRED';
  return hasCheckpoint ? 'SAFE_TO_RESUME' : 'SAFE_TO_RETRY';
}

// ---------------------------------------------------------------------------------------------
// Retry policy

/** Backoff behind a small interface so C2 can supply provider-aware policies. */
export interface BackoffPolicy {
  /** Delay before the next attempt, given the number of failed attempts so far (≥ 1). */
  delayMs(failedAttempts: number): number;
}

export class ExponentialBackoff implements BackoffPolicy {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly factor: number;

  constructor({ baseMs = 1_000, maxMs = 5 * 60_000, factor = 2 }: { baseMs?: number; maxMs?: number; factor?: number } = {}) {
    if (!(baseMs >= 0 && maxMs >= baseMs && factor >= 1)) throw new QandeelError('VALIDATION_FAILED', 'invalid backoff parameters');
    this.baseMs = baseMs;
    this.maxMs = maxMs;
    this.factor = factor;
  }

  /** Deterministic (no jitter): tests and recovery behave identically on every run. */
  delayMs(failedAttempts: number): number {
    const exponent = Math.max(0, failedAttempts - 1);
    return Math.min(this.maxMs, Math.round(this.baseMs * this.factor ** Math.min(exponent, 60)));
  }
}

export const MAX_ATTEMPTS_CEILING = 25;

export type RetryDecision = { readonly action: 'RETRY'; readonly delayMs: number } | { readonly action: 'DEAD_LETTER' };

/** Bounded retry: after `maxAttempts` failed attempts the job is dead-lettered, never retried again. */
export function decideRetry(failedAttempts: number, maxAttempts: number, backoff: BackoffPolicy): RetryDecision {
  if (failedAttempts >= maxAttempts) return { action: 'DEAD_LETTER' };
  return { action: 'RETRY', delayMs: backoff.delayMs(failedAttempts) };
}

// ---------------------------------------------------------------------------------------------
// Processor contract

export interface CheckpointView {
  readonly runId: Id;
  readonly seq: number;
  readonly kind: string;
  readonly kindVersion: number;
  readonly state: JsonValue;
  readonly createdAt: Timestamp;
}

export interface ProcessorContext {
  readonly workItemId: Id;
  readonly rootWorkItemId: Id;
  readonly jobId: Id;
  readonly runId: Id;
  /** 1 on the first attempt; increases only after a failed or interrupted attempt. */
  readonly attempt: number;
  readonly correlationId: Id;
  readonly processorKind: string;
  /** Bounded deterministic input supplied when the Work Item was created. */
  readonly input: JsonValue;
  /** Latest valid durable checkpoint of this job, if any: resume from here. */
  readonly resumeFrom: CheckpointView | null;
  /** Aborted when cancellation/supersession is requested, the run times out, or the runtime stops. */
  readonly signal: AbortSignal;
  /**
   * Durably records progress. Resolves only after the checkpoint transaction commits; rejects with
   * `STALE_LEASE` if this worker no longer owns the job (it must then stop immediately).
   */
  checkpoint(kind: string, state: JsonValue, kindVersion?: number): Promise<void>;
  /**
   * Stores a durable artifact linked to this Work Item and Run (content outside the database,
   * SHA-256 recorded). Fenced like `checkpoint`: a replaced worker cannot attach artifacts.
   */
  putArtifact(content: Uint8Array | string, mediaType: string, label?: string): Promise<{ readonly artifactId: Id; readonly sha256: string }>;
}

export type ProcessorResult =
  | { readonly type: 'COMPLETED'; readonly evidence?: JsonObject }
  | { readonly type: 'WAIT'; readonly reasonCode: string; readonly until?: Timestamp }
  | { readonly type: 'RETRYABLE_FAILURE'; readonly code: string }
  | { readonly type: 'PERMANENT_FAILURE'; readonly code: string }
  | { readonly type: 'RECONCILIATION_REQUIRED'; readonly code: string }
  | { readonly type: 'CANCELLED' };

/**
 * Narrow plug-in point for later execution (C2/C3). C1 registers deterministic processors only:
 * no model selection, prompts, inference, provider calls, tools or external side effects.
 */
export interface Processor {
  readonly kind: string;
  readonly sideEffects: SideEffectClass;
  /** Hard wall-clock ceiling for one run; the run is aborted and fenced when exceeded. */
  readonly maxRunMs?: number;
  run(context: ProcessorContext): Promise<ProcessorResult>;
}

export const PROCESSOR_KIND = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
