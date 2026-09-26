/**
 * Runtime-authority storage operations (D-C1-22): Runtime Supervisor lease, execution claims,
 * worker (fenced) writes, claim recovery and runtime-instance bookkeeping.
 *
 * Exported ONLY through the `@qandeel-company/storage/runtime-authority` subpath, which only
 * `@qandeel-company/runtime` may import (ESLint `no-restricted-imports` + verifier rule
 * `runtime-authority-confined`). The ordinary `@qandeel-company/storage` entry point exposes no
 * claim, no supervisor acquisition and no worker write, so a future package cannot acquire
 * executable work outside the Runtime Supervisor.
 *
 * Every claim presents the current Runtime Supervisor fence (mandatory, verified inside the claim
 * transaction). Every worker write presents its job fence. Recovery writes that take a claim away
 * from a worker also present the supervisor fence.
 */
import { isQandeelError, type Id, type JsonValue, type ProcessorResult, type Timestamp } from '@qandeel-company/domain';

import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import {
  prepareCheckpoint,
  txCheckpoint,
  txClaimJob,
  txClaimNext,
  txInterruptClaim,
  txRenewLease,
  txSettle,
  verifySupervisor,
  type Claim,
  type ClaimOptions,
  type SettleOptions,
  type SettleOutcome,
} from './queue.js';
import type { Fence, SupervisorFence } from './records.js';
import {
  readWakeGeneration,
  txAbandonStaleInstances,
  txAcquireSupervisor,
  txRegisterInstance,
  txReleaseSupervisor,
  txRenewSupervisor,
  txUpdateInstance,
  type InstanceState,
} from './runtime-state.js';
import { userVersion } from './migrations.js';
import { storeContext, type CompanyStore } from './store.js';
import { txRequestCancellation, txSupersede } from './work-items.js';
import type { TerminationOutcome } from './work-core.js';

export type { Claim, ClaimOptions, SettleOptions, SettleOutcome } from './queue.js';
export type { InstanceState } from './runtime-state.js';

/** One short `BEGIN IMMEDIATE` transaction on the store's connection (never awaits inside). */
function write<T>(store: CompanyStore, operation: string, fn: (ctx: StoreContext) => T): T {
  const ctx = storeContext(store);
  return ctx.db.immediate(operation, () => fn(ctx));
}

/** Fenced worker write: a STALE_LEASE rejection is itself audited (in its own transaction). */
function fenced<T>(store: CompanyStore, operation: string, fence: Fence, fn: (ctx: StoreContext) => T): T {
  try {
    return write(store, operation, fn);
  } catch (error) {
    if (isQandeelError(error, 'STALE_LEASE')) {
      try {
        write(store, 'audit stale lease', (ctx) =>
          appendAudit(ctx, 'fencing.rejected', 'job', fence.jobId, {}, 'REJECTED', 'STALE_LEASE', {
            operation,
            workerId: fence.workerId,
            presentedToken: fence.fencingToken,
            currentToken: (error.details.currentToken as number | null) ?? null,
          }),
        );
      } catch {
        // Auditing a rejection must never mask the rejection itself.
      }
    }
    throw error;
  }
}

// --- Runtime Supervisor lease -------------------------------------------------------------------

export function acquireSupervisor(store: CompanyStore, holderId: Id, ttlMs: number): SupervisorFence {
  try {
    return write(store, 'acquire supervisor', (ctx) => txAcquireSupervisor(ctx, holderId, ttlMs));
  } catch (error) {
    if (isQandeelError(error, 'LEASE_HELD')) {
      try {
        write(store, 'audit acquire refused', (ctx) =>
          appendAudit(ctx, 'supervisor.acquire_refused', 'runtime', holderId, {}, 'REJECTED', 'LEASE_HELD', {
            holder: String(error.details.holderId ?? ''),
            expiresAt: String(error.details.expiresAt ?? ''),
          }),
        );
      } catch {
        // Auditing a rejection must never mask the rejection itself.
      }
    }
    throw error;
  }
}

export interface SupervisorRenewal {
  readonly expiresAt: Timestamp;
  /** The durable wake generation read in the same transaction (lost-wake reconciliation). */
  readonly wakeGeneration: number;
}

/** Token-conditional renewal; fails (SUPERVISOR_NOT_AUTHORITATIVE) after a takeover. */
export function renewSupervisor(store: CompanyStore, fence: SupervisorFence, ttlMs: number): SupervisorRenewal {
  return write(store, 'renew supervisor', (ctx) => ({ expiresAt: txRenewSupervisor(ctx, fence, ttlMs), wakeGeneration: readWakeGeneration(ctx) }));
}

export function releaseSupervisor(store: CompanyStore, fence: SupervisorFence): boolean {
  return write(store, 'release supervisor', (ctx) => txReleaseSupervisor(ctx, fence));
}

// --- Execution claims (supervisor fence mandatory) ----------------------------------------------

export function claimNext(store: CompanyStore, options: ClaimOptions): Claim | null {
  return write(store, 'claim next job', (ctx) => txClaimNext(ctx, options));
}

export function claimJob(store: CompanyStore, jobId: Id, options: ClaimOptions): Claim | null {
  return write(store, 'claim job', (ctx) => txClaimJob(ctx, jobId, options));
}

// --- Worker writes (job fence mandatory) ---------------------------------------------------------

export function renewLease(store: CompanyStore, fence: Fence, leaseMs: number): Timestamp {
  return fenced(store, 'renew lease', fence, (ctx) => txRenewLease(ctx, fence, leaseMs));
}

export function checkpoint(store: CompanyStore, fence: Fence, kind: string, state: JsonValue, kindVersion: number, leaseMs: number): number {
  const prepared = prepareCheckpoint(kind, state, kindVersion);
  const seq = fenced(store, 'checkpoint', fence, (ctx) => txCheckpoint(ctx, fence, prepared, leaseMs));
  storeContext(store).fault('checkpoint.afterCommit');
  return seq;
}

export function settle(store: CompanyStore, fence: Fence, result: ProcessorResult, options: SettleOptions): SettleOutcome {
  return fenced(store, 'settle', fence, (ctx) => txSettle(ctx, fence, result, options));
}

// --- Claim recovery (supervisor fence mandatory) -------------------------------------------------

export function interruptClaim(store: CompanyStore, supervisor: SupervisorFence, jobId: Id, reasonCode: string): ReturnType<typeof txInterruptClaim> {
  return write(store, 'interrupt claim', (ctx) => {
    verifySupervisor(ctx, supervisor);
    return txInterruptClaim(ctx, jobId, reasonCode);
  });
}

/** Closes RUNNING runs whose job no longer points at them (defensive recovery; normally none). */
export function interruptOrphanRun(store: CompanyStore, supervisor: SupervisorFence, runId: Id): boolean {
  return write(store, 'interrupt orphan run', (ctx) => {
    verifySupervisor(ctx, supervisor);
    const changed = ctx.db.run(
      `UPDATE runs SET state = 'INTERRUPTED', ended_at = ?, failure_category = 'INTERRUPTED', failure_code = 'ORPHAN_RUN', recovery_disposition = 'SAFE_TO_RETRY'
        WHERE id = ? AND state = 'RUNNING' AND NOT EXISTS (SELECT 1 FROM queue_jobs j WHERE j.current_run_id = runs.id AND j.state = 'CLAIMED')`,
      ts(ctx),
      runId,
    ).changes;
    if (changed) appendAudit(ctx, 'run.orphan_interrupted', 'run', runId, {}, 'OK', 'ORPHAN_RUN', {});
    return changed === 1;
  });
}

/** Durable termination intent whose job is no longer running: finalize it (recovery). */
export function settleDanglingTermination(store: CompanyStore, supervisor: SupervisorFence, workItemId: Id): TerminationOutcome {
  return write(store, 'settle dangling termination', (ctx) => {
    verifySupervisor(ctx, supervisor);
    const item = getWorkItemRow(ctx, workItemId);
    const mode = item.terminationRequested;
    if (mode === null) return { terminated: [], requested: [], signalJobIds: [], retained: [], alreadyTerminal: [item.id] };
    return mode === 'SUPERSEDED' && item.supersededBy
      ? txSupersede(ctx, item.id, item.supersededBy, { reasonCode: item.terminationReason ?? 'SUPERSEDED' })
      : txRequestCancellation(ctx, item.id, { reasonCode: item.terminationReason ?? 'CANCELLED' });
  });
}

// --- Runtime instances ---------------------------------------------------------------------------

export function registerInstance(store: CompanyStore, id: Id, pid: number, runtimeVersion: string): void {
  write(store, 'register instance', (ctx) => txRegisterInstance(ctx, id, pid, runtimeVersion, userVersion(ctx.db)));
}

export function updateInstance(store: CompanyStore, id: Id, state: InstanceState, fields: { supervisorToken?: number; recovery?: Record<string, number | string | boolean | null> } = {}): void {
  write(store, 'update instance', (ctx) => txUpdateInstance(ctx, id, state, fields));
}

export function abandonStaleInstances(store: CompanyStore, supervisor: SupervisorFence, currentId: Id): number {
  return write(store, 'abandon stale instances', (ctx) => {
    verifySupervisor(ctx, supervisor);
    return txAbandonStaleInstances(ctx, currentId);
  });
}
