/**
 * CompanyStore — the storage API the runtime depends on. It exposes Company operations, never a
 * database handle or an "execute SQL" method. Each mutating method is one short `BEGIN IMMEDIATE`
 * transaction; nothing awaits while a write transaction is open.
 */
import { QandeelError, assertCode, isId, isQandeelError, systemClock, type BackoffPolicy, type Clock, type Id, type Timestamp } from '@qandeel-company/domain';

import { appendAudit, getJobRow, getWorkItemRow, mapCheckpoint, mapJob, mapRun, mapWorkItem, ts, type FaultHook, type StoreContext } from './internal.js';
import { CURRENT_SCHEMA_VERSION, appliedMigrations, loadReleasedMigrations, migrate, userVersion, type Migration, type MigrationFaultHook, type MigrationReport } from './migrations.js';
import {
  expiredClaims,
  foreignClaims,
  latestValidCheckpoint,
  nextDueAt,
  txRequeueDeadLetter,
  txResolveReconciliation,
  txWake,
  type Claim,
  type ReconciliationDecision,
  type SettleOutcome,
} from './queue.js';
import type { AuditRecord, CheckpointRecord, EventRecord, JobRecord, RunRecord, TransitionRecord, WorkItemRecord } from './records.js';
import {
  auditByAction,
  auditFor,
  eventsFor,
  pendingEvents,
  readInstance,
  readSupervisorLease,
  readWakeGeneration,
  txMarkDispatched,
  type RuntimeInstanceRecord,
  type SupervisorLease,
} from './runtime-state.js';
import { SqliteConnection } from './sqlite/connection.js';
import { openWorkspace, type WorkspaceLayout } from './workspace.js';
import {
  dependencies,
  history,
  lineage,
  txAddDependency,
  txCreateWorkItem,
  txRequestCancellation,
  txSupersede,
  txTransition,
  type CreateOptions,
  type CreateResult,
  type CreateWorkItemInput,
  type TerminationInput,
  type TransitionInput,
} from './work-items.js';
import type { TerminationOutcome } from './work-core.js';

export const STORAGE_VERSION = '0.1.0';

export interface OpenStoreOptions {
  readonly clock?: Clock;
  /** Recorded with each migration and runtime instance. */
  readonly runtimeVersion?: string;
  readonly busyTimeoutMs?: number;
  /**
   * Failure injection at named durability boundaries (tests only; production passes nothing). The
   * hook can only observe or abort — it has no database access.
   */
  readonly fault?: FaultHook;
  /** Create workspace directories if missing (default true). */
  readonly create?: boolean;
  /**
   * `apply` (default) brings the schema current. `verify` refuses to change the schema — used by
   * inspection tools so they never migrate underneath a live runtime.
   */
  readonly migrationMode?: 'apply' | 'verify';
}

/**
 * Storage-internal options: a migration set other than the released one. Only this package's own
 * tests use them (via `openStoreForTests`, which the package entry point does not export), so no
 * public API can make the store execute caller-supplied SQL.
 */
interface InternalOpenOptions extends OpenStoreOptions {
  readonly migrations?: readonly Migration[];
  readonly migrationFault?: MigrationFaultHook;
}

const OPEN_INTERNAL: unique symbol = Symbol('CompanyStore.openInternal');

export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

const noFault: FaultHook = () => undefined;

// Storage-internal access for sibling modules (artifacts, backup). The package entry point does
// not export `storeContext`, and the `exports` map forbids deep imports, so the connection never
// leaves @qandeel-company/storage.
const INTERNALS = new WeakMap<CompanyStore, StoreContext>();

export function storeContext(store: CompanyStore): StoreContext {
  const ctx = INTERNALS.get(store);
  if (!ctx || store.isClosed) throw new QandeelError('RUNTIME_STOPPING', 'store is closed');
  return ctx;
}

export class CompanyStore {
  readonly workspace: WorkspaceLayout;
  readonly migration: MigrationReport;
  readonly #ctx: StoreContext;
  #closed = false;

  private constructor(workspace: WorkspaceLayout, ctx: StoreContext, migration: MigrationReport) {
    this.workspace = workspace;
    this.#ctx = ctx;
    this.migration = migration;
  }

  /**
   * Validates the workspace, opens the WAL database and completes migrations. A store is never
   * returned before its schema is current: readiness depends on this.
   */
  static open(workspaceRoot: string, options: OpenStoreOptions = {}): CompanyStore {
    // Public entry: only the released, pinned migrations; unknown option keys carry no weight.
    const { clock, runtimeVersion, busyTimeoutMs, fault, create, migrationMode } = options;
    return CompanyStore[OPEN_INTERNAL](workspaceRoot, {
      ...(clock ? { clock } : {}),
      ...(runtimeVersion !== undefined ? { runtimeVersion } : {}),
      ...(busyTimeoutMs !== undefined ? { busyTimeoutMs } : {}),
      ...(fault ? { fault } : {}),
      ...(create !== undefined ? { create } : {}),
      ...(migrationMode ? { migrationMode } : {}),
    });
  }

  static [OPEN_INTERNAL](workspaceRoot: string, options: InternalOpenOptions): CompanyStore {
    const workspace = openWorkspace(workspaceRoot, { create: options.create ?? true });
    const clock = options.clock ?? systemClock;
    const db = SqliteConnection.open({ path: workspace.databasePath, busyTimeoutMs: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS });
    try {
      const migrations = options.migrations ?? loadReleasedMigrations();
      const report = migrate(db, migrations, {
        clock,
        runtimeVersion: options.runtimeVersion ?? STORAGE_VERSION,
        readOnlyCheck: options.migrationMode === 'verify',
        ...(options.migrationFault ? { beforeCommit: options.migrationFault } : {}),
      });
      const ctx: StoreContext = { db, clock, fault: options.fault ?? noFault };
      const store = new CompanyStore(workspace, ctx, report);
      INTERNALS.set(store, ctx);
      return store;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  get clock(): Clock {
    return this.#ctx.clock;
  }

  /** Statement counters (idle-runtime proof). */
  get stats(): Readonly<{ statements: number; writeTransactions: number }> {
    return this.#ctx.db.stats;
  }

  get schemaVersion(): number {
    return userVersion(this.#ctx.db);
  }

  get journalMode(): string {
    return this.#ctx.db.journalMode;
  }

  now(): Timestamp {
    return ts(this.#ctx);
  }

  #write<T>(operation: string, fn: (ctx: StoreContext) => T): T {
    this.#assertOpen();
    return this.#ctx.db.immediate(operation, () => fn(this.#ctx));
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    this.#assertOpen();
    return this.#ctx.db.snapshot(() => fn(this.#ctx));
  }

  #assertOpen(): void {
    if (this.#closed) throw new QandeelError('RUNTIME_STOPPING', 'store is closed');
  }

  // --- Work Items -------------------------------------------------------------------------------

  createWorkItem(input: CreateWorkItemInput, options: CreateOptions = {}): CreateResult {
    try {
      return this.#write('create work item', (ctx) => txCreateWorkItem(ctx, input, options));
    } catch (error) {
      // The rejected transaction rolled back; the rejection itself is audited separately.
      if (isQandeelError(error, 'IDEMPOTENCY_CONFLICT') || isQandeelError(error, 'DEDUPE_CONFLICT')) {
        const existing = String(error.details.existing ?? '');
        try {
          this.#write('audit conflict', (ctx) => appendAudit(ctx, error.code === 'IDEMPOTENCY_CONFLICT' ? 'idempotency.conflict' : 'dedupe.conflict', 'work_item', existing, {}, 'REJECTED', error.code, {}));
        } catch {
          // Auditing a rejection must never mask the rejection itself.
        }
      }
      throw error;
    }
  }

  transitionWorkItem(id: Id, input: TransitionInput): WorkItemRecord {
    return this.#write('transition work item', (ctx) => txTransition(ctx, id, input));
  }

  addDependency(id: Id, dependsOnId: Id, actorRef?: string): WorkItemRecord {
    return this.#write('add dependency', (ctx) => txAddDependency(ctx, id, dependsOnId, actorRef));
  }

  requestCancellation(id: Id, input: TerminationInput): TerminationOutcome {
    return this.#write('request cancellation', (ctx) => txRequestCancellation(ctx, id, input));
  }

  supersede(id: Id, supersededById: Id, input: TerminationInput): TerminationOutcome {
    return this.#write('supersede', (ctx) => txSupersede(ctx, id, supersededById, input));
  }

  getWorkItem(id: Id): WorkItemRecord {
    return this.#read((ctx) => getWorkItemRow(ctx, id));
  }

  /** Work Items, oldest first, optionally filtered by state (bounded page). */
  listWorkItems({ state, limit = 100 }: { state?: WorkItemRecord['state']; limit?: number } = {}): WorkItemRecord[] {
    const n = Math.max(1, Math.min(1_000, Math.trunc(limit)));
    return this.#read((ctx) =>
      (state === undefined
        ? ctx.db.all('SELECT * FROM work_items ORDER BY created_at, id LIMIT ?', n)
        : ctx.db.all('SELECT * FROM work_items WHERE state = ? ORDER BY created_at, id LIMIT ?', state, n)
      ).map(mapWorkItem),
    );
  }

  history(id: Id): TransitionRecord[] {
    return this.#read((ctx) => history(ctx, id));
  }

  lineage(rootId: Id): WorkItemRecord[] {
    return this.#read((ctx) => lineage(ctx, rootId));
  }

  dependencies(id: Id): { dependsOnId: Id; resolvedAt: Timestamp | null }[] {
    return this.#read((ctx) => dependencies(ctx, id));
  }

  // --- Queue, runs, leases ----------------------------------------------------------------------

  expiredClaims(limit = 100): Id[] {
    return this.#read((ctx) => expiredClaims(ctx, limit));
  }

  foreignClaims(ownerPrefix: string, limit = 100): Id[] {
    return this.#read((ctx) => foreignClaims(ctx, ownerPrefix, limit));
  }

  wake(workItemId: Id, reasonCode: string, actorRef?: string): boolean {
    return this.#write('wake', (ctx) => {
      const item = getWorkItemRow(ctx, workItemId);
      return txWake(ctx, workItemId, reasonCode, { correlationId: item.correlationId, actorRef: actorRef ?? null });
    });
  }

  requeueDeadLetter(jobId: Id, reasonCode: string, actorRef?: string): JobRecord {
    return this.#write('requeue dead letter', (ctx) => txRequeueDeadLetter(ctx, jobId, reasonCode, { actorRef: actorRef ?? null }));
  }

  resolveReconciliation(jobId: Id, decision: ReconciliationDecision, reasonCode: string, actorRef?: string): SettleOutcome {
    return this.#write('resolve reconciliation', (ctx) => txResolveReconciliation(ctx, jobId, decision, reasonCode, { actorRef: actorRef ?? null }));
  }

  nextDueAt(kinds: readonly string[]): Timestamp | null {
    return this.#read((ctx) => nextDueAt(ctx, kinds));
  }

  getJob(id: Id): JobRecord {
    return this.#read((ctx) => getJobRow(ctx, id));
  }

  jobsFor(workItemId: Id): JobRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM queue_jobs WHERE work_item_id = ? ORDER BY created_at, id', workItemId).map(mapJob));
  }

  runsFor(jobId: Id): RunRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM runs WHERE job_id = ? ORDER BY run_seq', jobId).map(mapRun));
  }

  runsForWorkItem(workItemId: Id): RunRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM runs WHERE work_item_id = ? ORDER BY started_at, run_seq', workItemId).map(mapRun));
  }

  checkpoints(jobId: Id): CheckpointRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM run_checkpoints WHERE job_id = ? ORDER BY id', jobId).map(mapCheckpoint));
  }

  latestCheckpoint(jobId: Id): CheckpointRecord | null {
    return this.#read((ctx) => latestValidCheckpoint(ctx, jobId));
  }

  runningRunsWithoutClaim(limit = 100): Id[] {
    return this.#read((ctx) =>
      ctx.db
        .all<{ id: string }>(
          `SELECT r.id FROM runs r JOIN queue_jobs j ON j.id = r.job_id WHERE r.state = 'RUNNING' AND (j.state <> 'CLAIMED' OR j.current_run_id <> r.id) LIMIT ?`,
          limit,
        )
        .map((r) => r.id as Id),
    );
  }

  /** Durable termination intent whose job is no longer running: finalize it (recovery). */
  danglingTerminations(limit = 100): Id[] {
    return this.#read((ctx) =>
      ctx.db
        .all<{ id: string }>(
          `SELECT w.id FROM work_items w WHERE w.termination_requested IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM queue_jobs j WHERE j.work_item_id = w.id AND j.state IN ('CLAIMED', 'RECONCILIATION_HOLD')) LIMIT ?`,
          limit,
        )
        .map((r) => r.id as Id),
    );
  }

  // --- Supervisor and runtime instances ---------------------------------------------------------

  supervisorLease(): SupervisorLease | null {
    return this.#read((ctx) => readSupervisorLease(ctx));
  }

  /** Durable wake generation (D-C1-23): changes whenever work may have become actionable. */
  wakeGeneration(): number {
    return this.#read((ctx) => readWakeGeneration(ctx));
  }

  instance(id: Id): RuntimeInstanceRecord | null {
    return this.#read((ctx) => readInstance(ctx, id));
  }

  // --- Outbox and audit -------------------------------------------------------------------------

  pendingEvents(limit = 500): EventRecord[] {
    return this.#read((ctx) => pendingEvents(ctx, limit));
  }

  markDispatched(ids: readonly Id[]): number {
    if (ids.length === 0) return 0;
    return this.#write('mark dispatched', (ctx) => txMarkDispatched(ctx, ids));
  }

  events(aggregateId: Id, limit = 1_000): EventRecord[] {
    return this.#read((ctx) => eventsFor(ctx, aggregateId).slice(0, Math.max(1, limit)));
  }

  audit(entityId: string): AuditRecord[] {
    return this.#read((ctx) => auditFor(ctx, entityId));
  }

  auditByAction(action: string, limit?: number): AuditRecord[] {
    return this.#read((ctx) => auditByAction(ctx, action, limit));
  }

  recordAudit(action: string, entityType: string, entityId: string, outcome: 'OK' | 'REJECTED' | 'ERROR', reasonCode: string | null, details: Record<string, string | number | boolean | null> = {}): void {
    assertCode(action, 'action');
    assertCode(entityType, 'entityType');
    if (!isId(entityId)) assertCode(entityId, 'entityId');
    if (reasonCode !== null) assertCode(reasonCode, 'reasonCode');
    this.#write('record audit', (ctx) => appendAudit(ctx, action, entityType, entityId, {}, outcome, reasonCode, details));
  }

  // --- Health (lightweight, deterministic; no full integrity scan) ------------------------------

  healthCounts(): HealthCounts {
    return this.#read((ctx) => {
      const byState = (sql: string): Record<string, number> =>
        Object.fromEntries(ctx.db.all<{ state: string; n: number }>(sql).map((r) => [r.state, Number(r.n)]));
      const at = ts(ctx);
      const lastBackup = ctx.db.get<{ id: string; created_at: string; integrity_result: string }>('SELECT id, created_at, integrity_result FROM backup_records ORDER BY created_at DESC LIMIT 1');
      return {
        workItems: byState('SELECT state, COUNT(*) AS n FROM work_items GROUP BY state'),
        jobs: byState('SELECT state, COUNT(*) AS n FROM queue_jobs GROUP BY state'),
        runs: byState('SELECT state, COUNT(*) AS n FROM runs GROUP BY state'),
        artifacts: byState('SELECT state, COUNT(*) AS n FROM artifacts GROUP BY state'),
        dueJobs: Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM queue_jobs WHERE state = 'QUEUED' AND available_at <= ?`, at)?.n ?? 0),
        expiredLeases: Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM queue_jobs WHERE state = 'CLAIMED' AND lease_expires_at <= ?`, at)?.n ?? 0),
        pendingEvents: Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE dispatched_at IS NULL')?.n ?? 0),
        lastBackup: lastBackup ? { id: lastBackup.id as Id, createdAt: lastBackup.created_at as Timestamp, integrity: lastBackup.integrity_result } : null,
        schemaVersion: userVersion(ctx.db),
        appliedMigrations: appliedMigrations(ctx.db).map((m) => m.version),
      };
    });
  }

  /** The live Company's own record of a backup (binds on-disk files to what was produced). */
  backupRecord(backupId: Id): { snapshotSha256: string; manifestSha256: string } | null {
    return this.#read((ctx) => {
      const r = ctx.db.get<{ snapshot_sha256: string; manifest_sha256: string }>('SELECT snapshot_sha256, manifest_sha256 FROM backup_records WHERE id = ?', backupId);
      return r ? { snapshotSha256: r.snapshot_sha256, manifestSha256: r.manifest_sha256 } : null;
    });
  }

  /** Bounded startup check (SQLite `quick_check`); the full `integrity_check` runs on backups. */
  quickCheck(): string {
    this.#assertOpen();
    const rows = this.#ctx.db.all<{ quick_check: string }>('PRAGMA quick_check(10)');
    return rows.map((r) => r.quick_check).join('; ');
  }

  /** Full `PRAGMA integrity_check`: expensive; explicit verification and tests only. */
  integrityCheck(): string {
    this.#assertOpen();
    return this.#ctx.db.integrityCheck().join('; ');
  }

  foreignKeyViolations(): number {
    this.#assertOpen();
    return this.#ctx.db.all('PRAGMA foreign_key_check').length;
  }

  /**
   * A frozen, read-only inspection capability over this store (D-C1-22). It carries bound read
   * methods only: no write, no claim, no connection and no path back to the store itself. The
   * runtime hands this — never its mutable store — to status tooling and tests.
   */
  readView(): CompanyReadView {
    const view = {
      getWorkItem: (id: Id) => this.getWorkItem(id),
      listWorkItems: (filter?: { state?: WorkItemRecord['state']; limit?: number }) => this.listWorkItems(filter),
      history: (id: Id) => this.history(id),
      lineage: (rootId: Id) => this.lineage(rootId),
      dependencies: (id: Id) => this.dependencies(id),
      getJob: (id: Id) => this.getJob(id),
      jobsFor: (workItemId: Id) => this.jobsFor(workItemId),
      runsFor: (jobId: Id) => this.runsFor(jobId),
      runsForWorkItem: (workItemId: Id) => this.runsForWorkItem(workItemId),
      checkpoints: (jobId: Id) => this.checkpoints(jobId),
      latestCheckpoint: (jobId: Id) => this.latestCheckpoint(jobId),
      events: (aggregateId: Id, limit?: number) => this.events(aggregateId, limit),
      audit: (entityId: string) => this.audit(entityId),
      auditByAction: (action: string, limit?: number) => this.auditByAction(action, limit),
      healthCounts: () => this.healthCounts(),
      supervisorLease: () => this.supervisorLease(),
      instance: (id: Id) => this.instance(id),
      wakeGeneration: () => this.wakeGeneration(),
      backupRecord: (backupId: Id) => this.backupRecord(backupId),
      integrityCheck: () => this.integrityCheck(),
    };
    const live = (get: () => unknown): PropertyDescriptor => ({ get, enumerable: true });
    Object.defineProperties(view, {
      workspace: live(() => this.workspace),
      schemaVersion: live(() => this.schemaVersion),
      journalMode: live(() => this.journalMode),
      stats: live(() => this.stats),
      isClosed: live(() => this.isClosed),
    });
    return Object.freeze(view) as unknown as CompanyReadView;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#ctx.db.close();
  }

  get isClosed(): boolean {
    return this.#closed;
  }
}

/** Read-only inspection capability (see `CompanyStore.readView`). */
export interface CompanyReadView {
  readonly workspace: WorkspaceLayout;
  readonly schemaVersion: number;
  readonly journalMode: string;
  readonly stats: Readonly<{ statements: number; writeTransactions: number }>;
  readonly isClosed: boolean;
  getWorkItem(id: Id): WorkItemRecord;
  listWorkItems(filter?: { state?: WorkItemRecord['state']; limit?: number }): WorkItemRecord[];
  history(id: Id): TransitionRecord[];
  lineage(rootId: Id): WorkItemRecord[];
  dependencies(id: Id): { dependsOnId: Id; resolvedAt: Timestamp | null }[];
  getJob(id: Id): JobRecord;
  jobsFor(workItemId: Id): JobRecord[];
  runsFor(jobId: Id): RunRecord[];
  runsForWorkItem(workItemId: Id): RunRecord[];
  checkpoints(jobId: Id): CheckpointRecord[];
  latestCheckpoint(jobId: Id): CheckpointRecord | null;
  events(aggregateId: Id, limit?: number): EventRecord[];
  audit(entityId: string): AuditRecord[];
  auditByAction(action: string, limit?: number): AuditRecord[];
  healthCounts(): HealthCounts;
  supervisorLease(): SupervisorLease | null;
  instance(id: Id): RuntimeInstanceRecord | null;
  wakeGeneration(): number;
  backupRecord(backupId: Id): { snapshotSha256: string; manifestSha256: string } | null;
  integrityCheck(): string;
}

export interface HealthCounts {
  readonly workItems: Record<string, number>;
  readonly jobs: Record<string, number>;
  readonly runs: Record<string, number>;
  readonly artifacts: Record<string, number>;
  readonly dueJobs: number;
  readonly expiredLeases: number;
  readonly pendingEvents: number;
  readonly lastBackup: { id: Id; createdAt: Timestamp; integrity: string } | null;
  readonly schemaVersion: number;
  readonly appliedMigrations: readonly number[];
}

export { CURRENT_SCHEMA_VERSION };
export type { BackoffPolicy, Claim, SettleOutcome, ReconciliationDecision };

/** Storage tests only (not exported by the package): open with a fixture migration set. */
export function openStoreForTests(workspaceRoot: string, options: InternalOpenOptions): CompanyStore {
  return CompanyStore[OPEN_INTERNAL](workspaceRoot, options);
}
