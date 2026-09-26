/**
 * Durable queue, runs, leases/fencing and checkpoints (Stage 12 §4, §12–§19; Stage 15 D15-C).
 *
 * Claims use a short `BEGIN IMMEDIATE` transaction with a conditional update on the job's fencing
 * token, so two claimants — in one process or many — can never both own a job: SQLite admits one
 * writer at a time, and the loser re-reads a job that is no longer QUEUED. Every later worker
 * write (renew, checkpoint, settle) is conditional on the fence it was issued and on an unexpired
 * lease; a replaced or expired worker is rejected by the datastore (STALE_LEASE).
 *
 * Delivery is at-least-once. Nothing here claims "exactly once" or "lock-free".
 */
import {
  QandeelError,
  assertCode,
  boundedJson,
  classifyInterruptedRun,
  decideRetry,
  isQandeelError,
  newId,
  sha256Hex,
  type BackoffPolicy,
  type Id,
  type JsonValue,
  type ProcessorResult,
  type SideEffectClass,
  type Timestamp,
  type WorkItemState,
} from '@qandeel-company/domain';

import { appendAudit, appendEvent, getJobRow, getWorkItemRow, mapCheckpoint, mapJob, mapRun, ts, type StoreContext, type TraceContext } from './internal.js';
import type { CheckpointRecord, Fence, JobRecord, RunRecord, SupervisorFence, WorkItemRecord } from './records.js';
import { applyTransition, defaultPropagationPolicy, failDependents, futureTimestamp, newTerminationOutcome, resolveDependents, terminateNow, type TerminationOutcome } from './work-core.js';

export const CHECKPOINT_MAX_BYTES = 65_536;
export const EVIDENCE_MAX_BYTES = 4_096;

export interface Claim {
  readonly fence: Fence;
  readonly job: JobRecord;
  readonly run: RunRecord;
  readonly workItem: WorkItemRecord;
  readonly resumeFrom: CheckpointRecord | null;
}

export interface ClaimOptions {
  readonly workerId: string;
  readonly leaseMs: number;
  /** Processor kinds this claimant can run, with their declared side-effect class. */
  readonly kinds: ReadonlyMap<string, SideEffectClass>;
  /** When present, the claim commits only while this supervisor lease is current. */
  readonly supervisor?: SupervisorFence;
}

export type SettleOutcome = {
  readonly jobState: JobRecord['state'];
  readonly runState: RunRecord['state'];
  readonly workItemState: WorkItemState;
  readonly retryAt?: Timestamp;
  readonly termination?: TerminationOutcome;
  readonly unblocked?: readonly Id[];
};

const LIVE_EXECUTION_STATES: readonly WorkItemState[] = ['READY', 'ASSIGNED', 'WAITING'];

function assertLeaseMs(leaseMs: number): void {
  if (!Number.isInteger(leaseMs) || leaseMs < 100 || leaseMs > 3_600_000) throw new QandeelError('VALIDATION_FAILED', 'lease duration must be 100 ms .. 1 h');
}

function assertWorkerId(workerId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/.test(workerId)) throw new QandeelError('VALIDATION_FAILED', 'worker id must be a short identifier');
}

export function verifySupervisor(ctx: StoreContext, fence: SupervisorFence): void {
  const row = ctx.db.get(
    `SELECT 1 AS ok FROM runtime_leases WHERE name = 'supervisor' AND holder_id = ? AND fencing_token = ? AND expires_at > ?`,
    fence.holderId,
    fence.fencingToken,
    ts(ctx),
  );
  if (!row) throw new QandeelError('SUPERVISOR_NOT_AUTHORITATIVE', 'supervisor lease is not current; refusing to claim work', { holderId: fence.holderId, fencingToken: fence.fencingToken });
}

/** Throws STALE_LEASE unless `fence` still owns an unexpired claim on its job. */
function verifyFence(ctx: StoreContext, fence: Fence): JobRecord {
  const row = ctx.db.get('SELECT * FROM queue_jobs WHERE id = ?', fence.jobId);
  const job = row ? mapJob(row) : undefined;
  const at = ts(ctx);
  if (
    !job ||
    job.state !== 'CLAIMED' ||
    job.fencingToken !== fence.fencingToken ||
    job.leaseOwner !== fence.workerId ||
    job.currentRunId !== fence.runId ||
    job.leaseExpiresAt === null ||
    job.leaseExpiresAt <= at
  ) {
    throw new QandeelError('STALE_LEASE', 'this worker no longer owns the job; its write was rejected', {
      jobId: fence.jobId,
      presentedToken: fence.fencingToken,
      currentToken: job?.fencingToken ?? null,
      jobState: job?.state ?? null,
    });
  }
  return job;
}

export function latestValidCheckpoint(ctx: StoreContext, jobId: Id): CheckpointRecord | null {
  // Newest first; a checkpoint whose checksum does not verify is skipped, never trusted.
  for (const row of ctx.db.all('SELECT * FROM run_checkpoints WHERE job_id = ? ORDER BY id DESC LIMIT 16', jobId)) {
    if (sha256Hex(String(row.state_json)) === String(row.sha256)) return mapCheckpoint(row);
  }
  return null;
}

function claimRow(ctx: StoreContext, job: JobRecord, opts: ClaimOptions): Claim | null {
  const sideEffects = opts.kinds.get(job.processorKind);
  if (sideEffects === undefined) return null;
  const item = getWorkItemRow(ctx, job.workItemId);
  if (!LIVE_EXECUTION_STATES.includes(item.state)) {
    throw new QandeelError('STORAGE_INVARIANT', 'queued job belongs to a work item that is not executable', { jobId: job.id, state: item.state });
  }
  const runId = newId();
  const token = job.fencingToken + 1;
  const at = ts(ctx);
  const expires = futureTimestamp(ctx, opts.leaseMs);
  const changed = ctx.db.run(
    `UPDATE queue_jobs SET state = 'CLAIMED', lease_owner = ?, lease_expires_at = ?, fencing_token = ?, current_run_id = ?, wait_reason = NULL, updated_at = ?
      WHERE id = ? AND state = 'QUEUED' AND fencing_token = ?`,
    opts.workerId,
    expires,
    token,
    runId,
    at,
    job.id,
    job.fencingToken,
  ).changes;
  if (changed !== 1) return null;
  const seqRow = ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(run_seq), 0) AS n FROM runs WHERE job_id = ?', job.id);
  const prev = ctx.db.get<{ id: string }>(
    `SELECT id FROM runs WHERE job_id = ? AND state IN ('FAILED_RETRYABLE', 'INTERRUPTED') ORDER BY run_seq DESC LIMIT 1`,
    job.id,
  );
  ctx.db.run(
    `INSERT INTO runs (id, job_id, work_item_id, run_seq, attempt, processor_kind, side_effects, state, worker_id, fencing_token, retry_of_run_id, correlation_id, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?, ?, ?, ?, ?)`,
    runId,
    job.id,
    job.workItemId,
    Number(seqRow?.n ?? 0) + 1,
    job.attemptCount + 1,
    job.processorKind,
    sideEffects,
    opts.workerId,
    token,
    prev?.id ?? null,
    job.correlationId,
    at,
  );
  const trace: TraceContext = { correlationId: job.correlationId, causationId: runId };
  const workItem = applyTransition(ctx, item, 'IN_PROGRESS', { reasonCode: 'job.claimed', trace });
  appendEvent(ctx, 'job.claimed', 'job', job.id, trace, { runId, workerId: opts.workerId, fencingToken: token, attempt: job.attemptCount + 1 });
  appendAudit(ctx, 'job.claimed', 'job', job.id, trace, 'OK', null, { runId, workerId: opts.workerId, fencingToken: token });
  const run = mapRun(ctx.db.get('SELECT * FROM runs WHERE id = ?', runId) ?? {});
  return {
    fence: { jobId: job.id, runId: run.id, workerId: opts.workerId, fencingToken: token },
    job: getJobRow(ctx, job.id),
    run,
    workItem,
    resumeFrom: latestValidCheckpoint(ctx, job.id),
  };
}

export function txClaimNext(ctx: StoreContext, opts: ClaimOptions): Claim | null {
  assertLeaseMs(opts.leaseMs);
  assertWorkerId(opts.workerId);
  if (opts.supervisor) verifySupervisor(ctx, opts.supervisor);
  const row = ctx.db.get(
    `SELECT * FROM queue_jobs
      WHERE state = 'QUEUED' AND available_at <= ? AND processor_kind IN (SELECT value FROM json_each(?))
      ORDER BY priority DESC, available_at, created_at, id LIMIT 1`,
    ts(ctx),
    JSON.stringify([...opts.kinds.keys()]),
  );
  return row ? claimRow(ctx, mapJob(row), opts) : null;
}

export function txClaimJob(ctx: StoreContext, jobId: Id, opts: ClaimOptions): Claim | null {
  assertLeaseMs(opts.leaseMs);
  assertWorkerId(opts.workerId);
  if (opts.supervisor) verifySupervisor(ctx, opts.supervisor);
  const row = ctx.db.get(`SELECT * FROM queue_jobs WHERE id = ? AND state = 'QUEUED' AND available_at <= ?`, jobId, ts(ctx));
  return row ? claimRow(ctx, mapJob(row), opts) : null;
}

export function txRenewLease(ctx: StoreContext, fence: Fence, leaseMs: number): Timestamp {
  assertLeaseMs(leaseMs);
  verifyFence(ctx, fence);
  const expires = futureTimestamp(ctx, leaseMs);
  ctx.db.run('UPDATE queue_jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND fencing_token = ?', expires, ts(ctx), fence.jobId, fence.fencingToken);
  return expires;
}

export function prepareCheckpoint(kind: string, state: JsonValue, kindVersion: number): { kind: string; kindVersion: number; json: string; sha256: string } {
  assertCode(kind, 'checkpoint.kind');
  if (!Number.isInteger(kindVersion) || kindVersion < 1 || kindVersion > 1000) throw new QandeelError('VALIDATION_FAILED', 'checkpoint kind version must be a positive integer');
  const json = boundedJson(state, 'checkpoint.state', CHECKPOINT_MAX_BYTES);
  return { kind, kindVersion, json, sha256: sha256Hex(json) };
}

export function txCheckpoint(ctx: StoreContext, fence: Fence, cp: ReturnType<typeof prepareCheckpoint>, leaseMs: number): number {
  assertLeaseMs(leaseMs);
  verifyFence(ctx, fence);
  const run = ctx.db.get<{ checkpoint_seq: number; state: string }>('SELECT checkpoint_seq, state FROM runs WHERE id = ?', fence.runId);
  if (!run || run.state !== 'RUNNING') throw new QandeelError('STALE_LEASE', 'run is no longer running', { runId: fence.runId });
  const seq = Number(run.checkpoint_seq) + 1;
  const at = ts(ctx);
  ctx.db.run(
    'INSERT INTO run_checkpoints (run_id, job_id, seq, kind, kind_version, state_json, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    fence.runId,
    fence.jobId,
    seq,
    cp.kind,
    cp.kindVersion,
    cp.json,
    cp.sha256,
    at,
  );
  ctx.db.run('UPDATE runs SET checkpoint_seq = ? WHERE id = ?', seq, fence.runId);
  ctx.db.run('UPDATE queue_jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ?', futureTimestamp(ctx, leaseMs), at, fence.jobId);
  const job = getJobRow(ctx, fence.jobId);
  appendEvent(ctx, 'run.checkpointed', 'run', fence.runId, { correlationId: job.correlationId, causationId: fence.jobId }, { seq, kind: cp.kind });
  ctx.fault('checkpoint.beforeCommit');
  return seq;
}

function endRun(
  ctx: StoreContext,
  runId: Id,
  state: RunRecord['state'],
  fields: { failureCode?: string | null; failureCategory?: string | null; disposition?: RunRecord['recoveryDisposition']; resultJson?: string },
): void {
  const changed = ctx.db.run(
    `UPDATE runs SET state = ?, ended_at = ?, failure_code = ?, failure_category = ?, recovery_disposition = ?, result_json = ?
      WHERE id = ? AND state = 'RUNNING'`,
    state,
    ts(ctx),
    fields.failureCode ?? null,
    fields.failureCategory ?? null,
    fields.disposition ?? null,
    fields.resultJson ?? '{}',
    runId,
  ).changes;
  if (changed !== 1) throw new QandeelError('STALE_LEASE', 'run already finished', { runId });
}

function setJob(
  ctx: StoreContext,
  job: JobRecord,
  state: JobRecord['state'],
  fields: { availableAt?: Timestamp; attemptCount?: number; deadLetterReason?: string | null; waitReason?: string | null; lastFailureCode?: string | null; bumpToken?: boolean },
): void {
  ctx.db.run(
    `UPDATE queue_jobs SET state = ?, lease_owner = NULL, lease_expires_at = NULL, available_at = ?, attempt_count = ?, dead_letter_reason = ?,
            wait_reason = ?, last_failure_code = ?, fencing_token = fencing_token + ?, updated_at = ?
      WHERE id = ? AND fencing_token = ?`,
    state,
    fields.availableAt ?? job.availableAt,
    fields.attemptCount ?? job.attemptCount,
    fields.deadLetterReason === undefined ? job.deadLetterReason : fields.deadLetterReason,
    fields.waitReason === undefined ? null : fields.waitReason,
    fields.lastFailureCode === undefined ? job.lastFailureCode : fields.lastFailureCode,
    fields.bumpToken ? 1 : 0,
    ts(ctx),
    job.id,
    job.fencingToken,
  );
}

/** Finalizes durable cancellation/supersession intent for a job whose worker has stopped. */
function finalizeTermination(ctx: StoreContext, job: JobRecord, runId: Id | null, trace: TraceContext): SettleOutcome {
  if (runId) endRun(ctx, runId, 'CANCELLED', { failureCategory: 'CANCELLED', failureCode: 'TERMINATION_REQUESTED' });
  setJob(ctx, job, 'CANCELLED', { bumpToken: true });
  const item = getWorkItemRow(ctx, job.workItemId);
  const mode = item.terminationRequested ?? 'CANCELLED';
  const out = newTerminationOutcome();
  terminateNow(
    ctx,
    item,
    mode === 'SUPERSEDED' && item.supersededBy
      ? { mode, reasonCode: item.terminationReason ?? 'SUPERSEDED', trace, supersededBy: item.supersededBy, policy: defaultPropagationPolicy }
      : { mode: 'CANCELLED', reasonCode: item.terminationReason ?? 'CANCELLED', trace, policy: defaultPropagationPolicy },
    out,
    0,
  );
  return { jobState: 'CANCELLED', runState: 'CANCELLED', workItemState: getWorkItemRow(ctx, job.workItemId).state, termination: out };
}

export interface SettleOptions {
  readonly backoff: BackoffPolicy;
  /** Failure category recorded for non-processor outcomes (timeouts, processor errors). */
  readonly failureCategory?: 'TIMEOUT';
}

function validateResult(result: ProcessorResult): { evidenceJson: string } {
  switch (result.type) {
    case 'COMPLETED':
      return { evidenceJson: result.evidence === undefined ? '{}' : boundedJson(result.evidence, 'result.evidence', EVIDENCE_MAX_BYTES) };
    case 'WAIT':
      assertCode(result.reasonCode, 'result.reasonCode');
      return { evidenceJson: '{}' };
    case 'RETRYABLE_FAILURE':
    case 'PERMANENT_FAILURE':
    case 'RECONCILIATION_REQUIRED':
      assertCode(result.code, 'result.code');
      return { evidenceJson: '{}' };
    case 'CANCELLED':
      return { evidenceJson: '{}' };
    default:
      throw new QandeelError('VALIDATION_FAILED', 'unknown processor result');
  }
}

/**
 * Settles a run. Fenced: a stale worker's result is rejected and changes nothing. Durable
 * cancellation/supersession intent recorded before settlement always wins (no resurrection).
 */
export function txSettle(ctx: StoreContext, fence: Fence, result: ProcessorResult, opts: SettleOptions): SettleOutcome {
  const { evidenceJson } = validateResult(result);
  const job = verifyFence(ctx, fence);
  const item = getWorkItemRow(ctx, job.workItemId);
  const trace: TraceContext = { correlationId: job.correlationId, causationId: fence.runId };
  if (job.cancelRequested) return finalizeTermination(ctx, job, fence.runId, trace);

  const at = ts(ctx);
  switch (result.type) {
    case 'COMPLETED': {
      endRun(ctx, fence.runId, 'SUCCEEDED', { resultJson: evidenceJson });
      setJob(ctx, job, 'DONE', {});
      let wi = applyTransition(ctx, item, 'COMPLETED', { reasonCode: 'run.completed', trace });
      if (wi.reviewRequired) wi = applyTransition(ctx, wi, 'WAITING_REVIEW', { reasonCode: 'review.required', trace });
      const unblocked = resolveDependents(ctx, wi.id, trace);
      appendEvent(ctx, 'run.finished', 'run', fence.runId, trace, { outcome: 'SUCCEEDED', jobId: job.id });
      appendAudit(ctx, 'run.succeeded', 'run', fence.runId, trace, 'OK', null, { jobId: job.id, workItemId: wi.id });
      return { jobState: 'DONE', runState: 'SUCCEEDED', workItemState: wi.state, unblocked };
    }
    case 'WAIT': {
      endRun(ctx, fence.runId, 'PARKED', { disposition: 'SAFE_TO_RESUME', failureCode: result.reasonCode });
      if (result.until !== undefined) setJob(ctx, job, 'QUEUED', { availableAt: result.until, waitReason: result.reasonCode });
      else setJob(ctx, job, 'WAITING', { waitReason: result.reasonCode });
      const wi = applyTransition(ctx, item, 'WAITING', { reasonCode: result.reasonCode, trace });
      appendEvent(ctx, 'run.finished', 'run', fence.runId, trace, { outcome: 'PARKED', jobId: job.id, until: result.until ?? null });
      return { jobState: result.until !== undefined ? 'QUEUED' : 'WAITING', runState: 'PARKED', workItemState: wi.state, ...(result.until !== undefined ? { retryAt: result.until } : {}) };
    }
    case 'RETRYABLE_FAILURE': {
      const failed = job.attemptCount + 1;
      const decision = decideRetry(failed, job.maxAttempts, opts.backoff);
      endRun(ctx, fence.runId, 'FAILED_RETRYABLE', { failureCode: result.code, failureCategory: opts.failureCategory ?? 'RETRYABLE', disposition: 'SAFE_TO_RETRY' });
      if (decision.action === 'RETRY') {
        const retryAt = futureTimestamp(ctx, decision.delayMs);
        setJob(ctx, job, 'QUEUED', { availableAt: retryAt, attemptCount: failed, lastFailureCode: result.code });
        const wi = applyTransition(ctx, item, 'READY', { reasonCode: 'run.retry_scheduled', trace });
        appendEvent(ctx, 'job.retry_scheduled', 'job', job.id, trace, { attempt: failed, retryAt, code: result.code });
        return { jobState: 'QUEUED', runState: 'FAILED_RETRYABLE', workItemState: wi.state, retryAt };
      }
      return deadLetter(ctx, job, item, trace, failed, result.code, 'RETRIES_EXHAUSTED');
    }
    case 'PERMANENT_FAILURE': {
      endRun(ctx, fence.runId, 'FAILED_PERMANENT', { failureCode: result.code, failureCategory: 'PERMANENT' });
      setJob(ctx, job, 'FAILED', { lastFailureCode: result.code, attemptCount: job.attemptCount + 1 });
      const wi = applyTransition(ctx, item, 'FAILED', { reasonCode: result.code, trace });
      failDependents(ctx, wi.id, trace);
      appendAudit(ctx, 'run.failed_permanent', 'run', fence.runId, trace, 'OK', result.code, { jobId: job.id });
      return { jobState: 'FAILED', runState: 'FAILED_PERMANENT', workItemState: wi.state };
    }
    case 'RECONCILIATION_REQUIRED': {
      endRun(ctx, fence.runId, 'RECONCILIATION_REQUIRED', { failureCode: result.code, failureCategory: 'RECONCILIATION', disposition: 'RECONCILIATION_REQUIRED' });
      return hold(ctx, job, item, trace, result.code);
    }
    case 'CANCELLED': {
      // Processor stopped at a safe point without durable termination intent (e.g. graceful
      // shutdown): park the job for resumption. Not a failed attempt.
      const hasCheckpoint = latestValidCheckpoint(ctx, job.id) !== null;
      endRun(ctx, fence.runId, 'INTERRUPTED', { failureCategory: 'CANCELLED', failureCode: 'PROCESSOR_STOPPED', disposition: hasCheckpoint ? 'SAFE_TO_RESUME' : 'SAFE_TO_RETRY' });
      setJob(ctx, job, 'QUEUED', { availableAt: at, bumpToken: true });
      const wi = applyTransition(ctx, item, 'READY', { reasonCode: 'run.parked', trace });
      return { jobState: 'QUEUED', runState: 'INTERRUPTED', workItemState: wi.state };
    }
  }
}

function deadLetter(ctx: StoreContext, job: JobRecord, item: WorkItemRecord, trace: TraceContext, failed: number, code: string, reason: string): SettleOutcome {
  setJob(ctx, job, 'DEAD_LETTER', { attemptCount: Math.min(failed, job.maxAttempts), deadLetterReason: reason, lastFailureCode: code, bumpToken: true });
  const wi = applyTransition(ctx, item, 'BLOCKED', { reasonCode: 'job.dead_lettered', trace, blockedReason: reason, blockerRef: `job:${job.id}` });
  appendEvent(ctx, 'job.dead_lettered', 'job', job.id, trace, { attempts: failed, code, reason });
  appendAudit(ctx, 'job.dead_lettered', 'job', job.id, trace, 'OK', reason, { attempts: failed, code });
  return { jobState: 'DEAD_LETTER', runState: 'FAILED_RETRYABLE', workItemState: wi.state };
}

function hold(ctx: StoreContext, job: JobRecord, item: WorkItemRecord, trace: TraceContext, code: string): SettleOutcome {
  setJob(ctx, job, 'RECONCILIATION_HOLD', { lastFailureCode: code, bumpToken: true });
  const wi = applyTransition(ctx, item, 'BLOCKED', { reasonCode: 'job.reconciliation_required', trace, blockedReason: 'RECONCILIATION_REQUIRED', blockerRef: `job:${job.id}` });
  appendEvent(ctx, 'job.reconciliation_required', 'job', job.id, trace, { code });
  appendAudit(ctx, 'job.reconciliation_required', 'job', job.id, trace, 'OK', code, {});
  return { jobState: 'RECONCILIATION_HOLD', runState: 'RECONCILIATION_REQUIRED', workItemState: wi.state };
}

/**
 * Recovers a claim whose worker is gone (expired lease, or a claim left by a previous supervisor).
 * The job is fenced immediately (token bump), then classified: durable termination intent is
 * finalized; UNSAFE side effects go to reconciliation; everything else counts as a failed attempt
 * (crash-loop bound) and is resumed from its checkpoint or retried — or dead-lettered once the
 * attempt budget is exhausted.
 */
export function txInterruptClaim(ctx: StoreContext, jobId: Id, reasonCode: string): { disposition: string; jobState: JobRecord['state'] } | null {
  const job = getJobRow(ctx, jobId);
  if (job.state !== 'CLAIMED') return null;
  const run = job.currentRunId ? ctx.db.get('SELECT * FROM runs WHERE id = ?', job.currentRunId) : undefined;
  const runRecord = run ? mapRun(run) : undefined;
  const trace: TraceContext = { correlationId: job.correlationId, causationId: job.currentRunId };
  appendAudit(ctx, 'job.lease_recovered', 'job', job.id, trace, 'OK', reasonCode, { previousOwner: job.leaseOwner, fencingToken: job.fencingToken });
  if (job.cancelRequested) {
    finalizeTermination(ctx, job, runRecord?.state === 'RUNNING' ? runRecord.id : null, trace);
    return { disposition: 'TERMINATED', jobState: 'CANCELLED' };
  }
  const hasCheckpoint = latestValidCheckpoint(ctx, job.id) !== null;
  const disposition = classifyInterruptedRun(runRecord?.sideEffects ?? 'NONE', hasCheckpoint);
  if (runRecord?.state === 'RUNNING') endRun(ctx, runRecord.id, 'INTERRUPTED', { failureCategory: 'INTERRUPTED', failureCode: reasonCode, disposition });
  const item = getWorkItemRow(ctx, job.workItemId);
  if (disposition === 'RECONCILIATION_REQUIRED') {
    hold(ctx, job, item, trace, reasonCode);
    return { disposition, jobState: 'RECONCILIATION_HOLD' };
  }
  const failed = job.attemptCount + 1;
  if (failed >= job.maxAttempts) {
    deadLetter(ctx, job, item, trace, failed, reasonCode, 'INTERRUPTED_ATTEMPTS_EXHAUSTED');
    return { disposition, jobState: 'DEAD_LETTER' };
  }
  setJob(ctx, job, 'QUEUED', { availableAt: ts(ctx), attemptCount: failed, lastFailureCode: reasonCode, bumpToken: true });
  applyTransition(ctx, item, 'READY', { reasonCode: disposition === 'SAFE_TO_RESUME' ? 'recovery.resume' : 'recovery.retry', trace });
  return { disposition, jobState: 'QUEUED' };
}

export function expiredClaims(ctx: StoreContext, limit: number): Id[] {
  return ctx.db
    .all<{ id: string }>(`SELECT id FROM queue_jobs WHERE state = 'CLAIMED' AND lease_expires_at <= ? ORDER BY lease_expires_at, id LIMIT ?`, ts(ctx), limit)
    .map((r) => r.id as Id);
}

/** Claims not owned by the given worker-id prefix (i.e. left by a previous supervisor). */
export function foreignClaims(ctx: StoreContext, ownerPrefix: string, limit: number): Id[] {
  return ctx.db
    .all<{ id: string }>(`SELECT id FROM queue_jobs WHERE state = 'CLAIMED' AND substr(lease_owner, 1, ?) <> ? ORDER BY id LIMIT ?`, ownerPrefix.length, ownerPrefix, limit)
    .map((r) => r.id as Id);
}

/** Event-driven wake of a parked job. Returns false when there was nothing to wake. */
export function txWake(ctx: StoreContext, workItemId: Id, reasonCode: string, trace: TraceContext): boolean {
  const row = ctx.db.get(`SELECT * FROM queue_jobs WHERE work_item_id = ? AND state IN ('WAITING', 'QUEUED')`, workItemId);
  if (!row) return false;
  const job = mapJob(row);
  const at = ts(ctx);
  if (job.state === 'QUEUED' && job.availableAt <= at) return false;
  ctx.db.run(`UPDATE queue_jobs SET state = 'QUEUED', available_at = ?, wait_reason = NULL, updated_at = ? WHERE id = ? AND fencing_token = ?`, at, at, job.id, job.fencingToken);
  appendEvent(ctx, 'job.woken', 'job', job.id, trace, { reason: reasonCode });
  return true;
}

export function txRequeueDeadLetter(ctx: StoreContext, jobId: Id, reasonCode: string, trace: Omit<TraceContext, 'correlationId'>): JobRecord {
  const job = getJobRow(ctx, jobId);
  if (job.state !== 'DEAD_LETTER') throw new QandeelError('INVALID_TRANSITION', 'only dead-lettered jobs can be requeued', { jobId, state: job.state });
  const full: TraceContext = { ...trace, correlationId: job.correlationId };
  const item = getWorkItemRow(ctx, job.workItemId);
  ctx.db.run(
    `UPDATE queue_jobs SET state = 'QUEUED', available_at = ?, attempt_count = 0, requeue_count = requeue_count + 1, dead_letter_reason = NULL, fencing_token = fencing_token + 1, updated_at = ?
      WHERE id = ? AND fencing_token = ?`,
    ts(ctx),
    ts(ctx),
    job.id,
    job.fencingToken,
  );
  applyTransition(ctx, item, 'READY', { reasonCode: 'job.requeued', trace: full });
  appendEvent(ctx, 'job.requeued', 'job', job.id, full, { reason: reasonCode });
  appendAudit(ctx, 'job.requeued', 'job', job.id, full, 'OK', reasonCode, { previousAttempts: job.attemptCount });
  return getJobRow(ctx, job.id);
}

export type ReconciliationDecision = 'RETRY' | 'CONFIRMED_COMPLETED' | 'FAILED';

/**
 * Explicit resolution of an uncertain side effect, after the operator has checked external
 * reality. C1 records the (opaque, unauthenticated) actor reference; authorization is C2's.
 */
export function txResolveReconciliation(ctx: StoreContext, jobId: Id, decision: ReconciliationDecision, reasonCode: string, trace: Omit<TraceContext, 'correlationId'>): SettleOutcome {
  const job = getJobRow(ctx, jobId);
  if (job.state !== 'RECONCILIATION_HOLD') throw new QandeelError('INVALID_TRANSITION', 'job is not held for reconciliation', { jobId, state: job.state });
  const full: TraceContext = { ...trace, correlationId: job.correlationId };
  const item = getWorkItemRow(ctx, job.workItemId);
  appendAudit(ctx, 'job.reconciliation_resolved', 'job', job.id, full, 'OK', reasonCode, { decision });
  if (decision === 'RETRY') {
    setJob(ctx, job, 'QUEUED', { availableAt: ts(ctx), bumpToken: true });
    return { jobState: 'QUEUED', runState: 'RECONCILIATION_REQUIRED', workItemState: applyTransition(ctx, item, 'READY', { reasonCode: 'reconciliation.retry', trace: full }).state };
  }
  if (decision === 'CONFIRMED_COMPLETED') {
    setJob(ctx, job, 'DONE', { bumpToken: true });
    let wi = applyTransition(ctx, item, 'COMPLETED', { reasonCode: 'reconciliation.confirmed_completed', trace: full });
    if (wi.reviewRequired) wi = applyTransition(ctx, wi, 'WAITING_REVIEW', { reasonCode: 'review.required', trace: full });
    const unblocked = resolveDependents(ctx, wi.id, full);
    return { jobState: 'DONE', runState: 'RECONCILIATION_REQUIRED', workItemState: wi.state, unblocked };
  }
  setJob(ctx, job, 'FAILED', { bumpToken: true });
  const wi = applyTransition(ctx, item, 'FAILED', { reasonCode: 'reconciliation.failed', trace: full });
  failDependents(ctx, wi.id, full);
  return { jobState: 'FAILED', runState: 'RECONCILIATION_REQUIRED', workItemState: wi.state };
}

/** Earliest instant at which the queue needs attention: a due job or an expiring lease. */
export function nextDueAt(ctx: StoreContext, kinds: readonly string[]): Timestamp | null {
  const due = ctx.db.get<{ t: string | null }>(
    `SELECT MIN(available_at) AS t FROM queue_jobs WHERE state = 'QUEUED' AND processor_kind IN (SELECT value FROM json_each(?))`,
    JSON.stringify(kinds),
  )?.t;
  const lease = ctx.db.get<{ t: string | null }>(`SELECT MIN(lease_expires_at) AS t FROM queue_jobs WHERE state = 'CLAIMED'`)?.t;
  const candidates = [due, lease].filter((t): t is string => typeof t === 'string').sort();
  return (candidates[0] as Timestamp | undefined) ?? null;
}

export function isStaleLease(error: unknown): boolean {
  return isQandeelError(error, 'STALE_LEASE');
}

