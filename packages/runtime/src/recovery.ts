/**
 * Startup recovery (Stage 12 §26–§29, Stage 15 D15-C.4 / D15-C.6).
 *
 * Runs after the supervisor lease is acquired and before READY. Every step is its own short
 * transaction and is idempotent, so a crash during recovery followed by another restart neither
 * corrupts state nor duplicates work. Work is classified, never blindly retried; recovery itself
 * never runs a processor (bounded fan-out: the dispatcher later resumes work under the concurrency
 * cap and priority order).
 */
import type { Id } from '@qandeel-company/domain';
import type { ArtifactStore, CompanyStore, SupervisorFence } from '@qandeel-company/storage';
import { abandonStaleInstances, interruptClaim, interruptOrphanRun, recoverGovernedOrphans, settleDanglingTermination } from '@qandeel-company/storage/runtime-authority';

export interface RecoverySummary {
  [key: string]: number | string | boolean | null;
  quickCheck: string;
  staleInstancesAbandoned: number;
  claimsRecovered: number;
  resumed: number;
  retried: number;
  reconciliationHeld: number;
  deadLettered: number;
  terminationsFinalized: number;
  orphanRunsClosed: number;
  danglingTerminationsSettled: number;
  dueJobs: number;
  pendingEvents: number;
  reconciliationRequired: number;
  deadLetters: number;
  artifactsPromoted: number;
  artifactsAbandoned: number;
  artifactTempFilesRemoved: number;
  artifactsMissing: number;
  artifactOrphansQuarantined: number;
  artifactUnknownFiles: number;
  governedReservationsHeld: number;
  governedReservationsReleased: number;
  governedInvocationsRetryable: number;
  governedInvocationsHeld: number;
}

const BATCH = 100;
const MAX_BATCHES = 1_000;

export type RecoveryFaultHook = (point: 'recovery.afterClaims') => void;

/** Every recovery write presents the supervisor fence this runtime holds (D-C1-22). */
export function runRecovery(store: CompanyStore, artifacts: ArtifactStore, { instanceId, supervisor, fault }: { instanceId: Id; supervisor: SupervisorFence; fault?: RecoveryFaultHook }): RecoverySummary {
  const quick = store.quickCheck();
  if (quick !== 'ok') throw Object.assign(new Error('database failed quick_check at startup'), { code: 'STORAGE_INVARIANT' });

  const summary: RecoverySummary = {
    quickCheck: quick,
    staleInstancesAbandoned: abandonStaleInstances(store, supervisor, instanceId),
    claimsRecovered: 0,
    resumed: 0,
    retried: 0,
    reconciliationHeld: 0,
    deadLettered: 0,
    terminationsFinalized: 0,
    orphanRunsClosed: 0,
    danglingTerminationsSettled: 0,
    dueJobs: 0,
    pendingEvents: 0,
    reconciliationRequired: 0,
    deadLetters: 0,
    artifactsPromoted: 0,
    artifactsAbandoned: 0,
    artifactTempFilesRemoved: 0,
    artifactsMissing: 0,
    artifactOrphansQuarantined: 0,
    artifactUnknownFiles: 0,
    governedReservationsHeld: 0,
    governedReservationsReleased: 0,
    governedInvocationsRetryable: 0,
    governedInvocationsHeld: 0,
  };

  // 1. Claims left by any previous supervisor (expired or not: this supervisor holds the lease, so
  //    their workers are gone or will be fenced). Interruption bumps the fencing token first.
  const ownPrefix = `${instanceId}:`;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const claims = store.foreignClaims(ownPrefix, BATCH);
    if (claims.length === 0) break;
    for (const jobId of claims) {
      const r = interruptClaim(store, supervisor, jobId, 'SUPERVISOR_RESTART');
      if (!r) continue;
      summary.claimsRecovered++;
      if (r.disposition === 'TERMINATED') summary.terminationsFinalized++;
      else if (r.jobState === 'RECONCILIATION_HOLD') summary.reconciliationHeld++;
      else if (r.jobState === 'DEAD_LETTER') summary.deadLettered++;
      else if (r.disposition === 'SAFE_TO_RESUME') summary.resumed++;
      else summary.retried++;
    }
  }
  fault?.('recovery.afterClaims');

  // 2. RUNNING runs whose job no longer points at them (defensive; normally none).
  for (let i = 0; i < MAX_BATCHES; i++) {
    const runs = store.runningRunsWithoutClaim(BATCH);
    if (runs.length === 0) break;
    for (const runId of runs) if (interruptOrphanRun(store, supervisor, runId)) summary.orphanRunsClosed++;
  }

  // 3. Durable cancellation/supersession intent not yet settled.
  for (let i = 0; i < MAX_BATCHES; i++) {
    const pending = store.danglingTerminations(BATCH);
    if (pending.length === 0) break;
    for (const id of pending) {
      settleDanglingTermination(store, supervisor, id);
      summary.danglingTerminationsSettled++;
    }
  }

  // 3b. C2 governed work of runs that are no longer running: model-call reservations whose outcome
  //     is unknown are held for reconciliation (never silently released or re-spent); tool intents
  //     become retryable under the same idempotency key, or reconciliation-required when UNSAFE.
  for (let i = 0; i < MAX_BATCHES; i++) {
    const g = recoverGovernedOrphans(store, supervisor, BATCH);
    summary.governedReservationsHeld += g.reservationsHeld;
    summary.governedReservationsReleased += g.reservationsReleased;
    summary.governedInvocationsRetryable += g.invocationsRetryable;
    summary.governedInvocationsHeld += g.invocationsHeld;
    if (g.reservationsHeld + g.reservationsReleased + g.invocationsRetryable + g.invocationsHeld === 0) break;
  }

  // 4. Cross-store artifact boundary.
  const a = artifacts.recover();
  summary.artifactsPromoted = a.promoted;
  summary.artifactsAbandoned = a.abandoned;
  summary.artifactTempFilesRemoved = a.tempFilesRemoved;
  summary.artifactsMissing = a.missing;
  summary.artifactOrphansQuarantined = a.orphansQuarantined;
  summary.artifactUnknownFiles = a.unknownFiles;

  // 5. What the dispatcher will pick up after READY (reported, not executed here).
  const counts = store.healthCounts();
  summary.dueJobs = counts.dueJobs;
  summary.pendingEvents = counts.pendingEvents;
  summary.reconciliationRequired = counts.jobs.RECONCILIATION_HOLD ?? 0;
  summary.deadLetters = counts.jobs.DEAD_LETTER ?? 0;
  return summary;
}
