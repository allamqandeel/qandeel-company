/**
 * Health and readiness (Stage 12 §41, §44). Deterministic and lightweight: counts from indexed
 * queries and a pragma or two — never a full integrity scan per request, never an LLM.
 *
 *   liveness   the runtime process and its loop exist (state not STOPPED/FAILED)
 *   readiness  safe to accept work: workspace validated, DB open, WAL verified, migrations complete,
 *              supervisor authority held, startup recovery complete, artifact store available
 *   snapshot   structured component state for runtime, database, migrations, queue, recovery,
 *              artifacts, backup capability and workspace/disk
 *
 * The output is a plain, content-free JSON-serializable object so a later Founder surface (C5)
 * can consume it without C1 knowing that surface.
 */
import { accessSync, constants as fsConstants } from 'node:fs';

import { CompanyStore, CURRENT_SCHEMA_VERSION, workspaceFreeBytes, type HealthCounts, type WorkspaceLayout } from '@qandeel-company/storage';

import type { CompanyRuntime } from './runtime.js';

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'ATTENTION' | 'CRITICAL';

export const LOW_DISK_BYTES = 1024 * 1024 * 1024;

export interface ReadinessChecks {
  readonly workspace: boolean;
  readonly database: boolean;
  readonly wal: boolean;
  readonly migrations: boolean;
  readonly supervisor: boolean;
  readonly recovery: boolean;
  readonly artifacts: boolean;
}

export interface HealthSnapshot {
  readonly status: HealthStatus;
  readonly generatedAt: string;
  readonly liveness: { readonly alive: boolean; readonly pid: number };
  readonly readiness: { readonly ready: boolean; readonly checks: ReadinessChecks };
  readonly components: {
    readonly runtime: { readonly state: string; readonly instanceId: string | null; readonly uptimeMs: number; readonly activeRuns: number; readonly concurrency: number; readonly failure: string | null };
    readonly database: { readonly open: boolean; readonly journalMode: string | null; readonly schemaVersion: number | null };
    readonly migrations: { readonly current: number | null; readonly expected: number; readonly applied: readonly number[] };
    readonly supervisor: { readonly holderId: string | null; readonly fencingToken: number | null; readonly expiresAt: string | null; readonly live: boolean };
    readonly queue: { readonly jobs: Record<string, number>; readonly dueJobs: number; readonly expiredLeases: number; readonly deadLetters: number; readonly reconciliationHolds: number; readonly pendingEvents: number };
    readonly workItems: Record<string, number>;
    readonly recovery: { readonly completed: boolean; readonly summary: Record<string, unknown> | null };
    readonly artifacts: { readonly counts: Record<string, number>; readonly missing: number; readonly corrupt: number };
    readonly backup: { readonly directoryWritable: boolean; readonly lastBackupId: string | null; readonly lastBackupAt: string | null };
    readonly workspace: { readonly freeBytes: number | null; readonly lowDisk: boolean };
  };
  readonly reasons: readonly string[];
}

function writable(dir: string): boolean {
  try {
    accessSync(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function classify(checksReady: boolean, alive: boolean, counts: HealthCounts | null, lowDisk: boolean, extra: string[]): { status: HealthStatus; reasons: string[] } {
  const reasons = [...extra];
  if (!alive) reasons.push('RUNTIME_NOT_ALIVE');
  if (!checksReady) reasons.push('NOT_READY');
  if (counts) {
    if ((counts.jobs.DEAD_LETTER ?? 0) > 0) reasons.push('DEAD_LETTERS_PRESENT');
    if ((counts.jobs.RECONCILIATION_HOLD ?? 0) > 0) reasons.push('RECONCILIATION_REQUIRED');
    if ((counts.artifacts.MISSING ?? 0) > 0 || (counts.artifacts.CORRUPT ?? 0) > 0) reasons.push('ARTIFACT_INTEGRITY');
    if (counts.expiredLeases > 0) reasons.push('EXPIRED_LEASES');
  }
  if (lowDisk) reasons.push('LOW_DISK');
  let status: HealthStatus = 'HEALTHY';
  if (reasons.includes('EXPIRED_LEASES')) status = 'DEGRADED';
  if (reasons.some((r) => ['DEAD_LETTERS_PRESENT', 'RECONCILIATION_REQUIRED', 'ARTIFACT_INTEGRITY', 'LOW_DISK'].includes(r))) status = 'ATTENTION';
  if (!alive || !checksReady || reasons.includes('WAL_NOT_ACTIVE') || reasons.includes('SCHEMA_MISMATCH')) status = 'CRITICAL';
  return { status, reasons };
}

function snapshotFrom(
  store: CompanyStore | null,
  layout: WorkspaceLayout | null,
  runtime: { state: string; instanceId: string | null; uptimeMs: number; activeRuns: number; concurrency: number; failure: string | null; recovery: Record<string, unknown> | null; ownsLease: boolean | null },
  now: number,
): HealthSnapshot {
  const counts = store && !store.isClosed ? store.healthCounts() : null;
  const lease = store && !store.isClosed ? store.supervisorLease() : null;
  const journalMode = store && !store.isClosed ? store.journalMode : null;
  const freeBytes = layout ? (workspaceFreeBytes(layout) ?? null) : null;
  const lowDisk = freeBytes !== null && freeBytes < LOW_DISK_BYTES;
  const leaseLive = lease !== null && Date.parse(lease.expiresAt) > now;
  const checks: ReadinessChecks = {
    workspace: layout !== null,
    database: counts !== null,
    wal: journalMode === 'wal',
    migrations: counts?.schemaVersion === CURRENT_SCHEMA_VERSION,
    supervisor: runtime.ownsLease === null ? leaseLive : runtime.ownsLease && leaseLive,
    recovery: runtime.recovery !== null,
    artifacts: layout !== null && writable(layout.objectsDir) && writable(layout.artifactTmpDir),
  };
  const ready = runtime.state === 'READY' && Object.values(checks).every(Boolean);
  const alive = !['STOPPED', 'FAILED', 'CREATED', 'NOT_RUNNING'].includes(runtime.state);
  const extra: string[] = [];
  if (counts && journalMode !== 'wal') extra.push('WAL_NOT_ACTIVE');
  if (counts && counts.schemaVersion !== CURRENT_SCHEMA_VERSION) extra.push('SCHEMA_MISMATCH');
  const { status, reasons } = classify(ready, alive, counts, lowDisk, extra);
  return {
    status,
    generatedAt: new Date(now).toISOString(),
    liveness: { alive, pid: process.pid },
    readiness: { ready, checks },
    components: {
      runtime: { state: runtime.state, instanceId: runtime.instanceId, uptimeMs: runtime.uptimeMs, activeRuns: runtime.activeRuns, concurrency: runtime.concurrency, failure: runtime.failure },
      database: { open: counts !== null, journalMode, schemaVersion: counts?.schemaVersion ?? null },
      migrations: { current: counts?.schemaVersion ?? null, expected: CURRENT_SCHEMA_VERSION, applied: counts?.appliedMigrations ?? [] },
      supervisor: { holderId: lease?.holderId ?? null, fencingToken: lease?.fencingToken ?? null, expiresAt: lease?.expiresAt ?? null, live: leaseLive },
      queue: {
        jobs: counts?.jobs ?? {},
        dueJobs: counts?.dueJobs ?? 0,
        expiredLeases: counts?.expiredLeases ?? 0,
        deadLetters: counts?.jobs.DEAD_LETTER ?? 0,
        reconciliationHolds: counts?.jobs.RECONCILIATION_HOLD ?? 0,
        pendingEvents: counts?.pendingEvents ?? 0,
      },
      workItems: counts?.workItems ?? {},
      recovery: { completed: runtime.recovery !== null, summary: runtime.recovery },
      artifacts: { counts: counts?.artifacts ?? {}, missing: counts?.artifacts.MISSING ?? 0, corrupt: counts?.artifacts.CORRUPT ?? 0 },
      backup: { directoryWritable: layout !== null && writable(layout.backupsDir), lastBackupId: counts?.lastBackup?.id ?? null, lastBackupAt: counts?.lastBackup?.createdAt ?? null },
      workspace: { freeBytes, lowDisk },
    },
    reasons,
  };
}

/** Health of a runtime in this process. */
export function runtimeHealth(runtime: CompanyRuntime): HealthSnapshot {
  let store: CompanyStore | null;
  try {
    store = runtime.store;
  } catch {
    store = null;
  }
  const lease = store?.supervisorLease() ?? null;
  const d = runtime.diagnostics();
  return snapshotFrom(
    store,
    store?.workspace ?? null,
    {
      state: d.state,
      instanceId: runtime.instanceId,
      uptimeMs: runtime.uptimeMs,
      activeRuns: d.activeRuns,
      concurrency: runtime.concurrency,
      failure: runtime.failure,
      recovery: runtime.recovery ?? null,
      ownsLease: lease !== null && lease.holderId === runtime.instanceId,
    },
    Date.now(),
  );
}

/**
 * Read-only inspection of a workspace from another process (CLI `health`). It never migrates,
 * never recovers and never claims work; it reports whether a live supervisor holds the lease.
 */
export function inspectWorkspace(root: string): HealthSnapshot {
  const store = CompanyStore.open(root, { create: false, migrationMode: 'verify' });
  try {
    const lease = store.supervisorLease();
    const live = lease !== null && Date.parse(lease.expiresAt) > Date.now();
    const instance = lease ? store.instance(lease.holderId) : null;
    const state = live ? (instance?.state ?? 'UNKNOWN') : 'NOT_RUNNING';
    return snapshotFrom(
      store,
      store.workspace,
      {
        state,
        instanceId: lease?.holderId ?? null,
        uptimeMs: instance ? Date.now() - Date.parse(instance.startedAt) : 0,
        activeRuns: store.healthCounts().jobs.CLAIMED ?? 0,
        concurrency: 0,
        failure: null,
        recovery: live && instance?.state === 'READY' ? instance.recovery : null,
        ownsLease: null,
      },
      Date.now(),
    );
  } finally {
    store.close();
  }
}
