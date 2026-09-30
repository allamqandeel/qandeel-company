/**
 * Update / migration safety (Stage 15 D15-D): Preflight → Backup → Rehearse → Migrate → Verify → Activate.
 *
 * - A material schema update takes an application-consistent pre-update snapshot with a known-good manifest
 *   (schema version, migration pins, snapshot checksum, row counts) before anything changes.
 * - The pending migrations are first REHEARSED on a copy of that snapshot and verified there (integrity,
 *   foreign keys, the released schema fingerprint, no row lost). Only then is the live database migrated,
 *   and it is verified again before it is activated.
 * - Any failure stops: the live database is restored from the compatible pre-update snapshot (never an
 *   automatic downgrade script) and the workspace enters UPDATE_HOLD — `CompanyStore.open` refuses it, so no
 *   runtime re-attempts the migration in a loop. The operator clears the hold explicitly.
 * - The runtime must be stopped (no live supervisor lease) and no other connection may hold the database open:
 *   maintenance never races a running Company. The hold is written BEFORE any restore touches a file.
 * - This is the ONLY path that migrates an existing Company (R2-30): `CompanyStore.open` refuses one with pending
 *   migrations (SCHEMA_UPDATE_REQUIRED) and `CompanyRuntime.start` runs this lifecycle automatically.
 * - The previous known-good snapshots stay available for a bounded rollback period (the last two updates). A
 *   rollback never discards post-activation work silently: it is refused unless acknowledged, and the replaced
 *   live database is retained as a pre-rollback snapshot (R2-31).
 *
 * The journal lives on disk (`<workspace>/maintenance/`) because a failed update may leave no usable
 * database to write into; a successful or rolled-back update is also recorded in `maintenance_records`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { QandeelError, canonicalJson, newId, now, sha256Hex, systemClock, type Clock, type Id } from '@qandeel-company/domain';

import { CURRENT_SCHEMA_VERSION, appliedMigrations, loadReleasedMigrations, migrate, userVersion, type Migration } from './migrations.js';
import { SqliteConnection } from './sqlite/connection.js';
import { appendAudit } from './internal.js';
import { DEFAULT_BUSY_TIMEOUT_MS } from './store.js';
import { HOLD_FILE, RESTORE_CHECK_COPY, assertNoUpdateHold, isRestoreCheckCopy, maintenanceDir } from './update-hold.js';
import { layoutFor, openWorkspace } from './workspace.js';

const KEEP_UPDATES = 2;

const CORE_TABLES = ['work_items', 'queue_jobs', 'runs', 'audit_events', 'events', 'employees', 'approvals', 'usage_records', 'lessons', 'knowledge_items', 'goals', 'backup_records'];

function tableCounts(db: SqliteConnection): Record<string, number> {
  const present = new Set(db.all<{ name: string }>(`SELECT name FROM sqlite_schema WHERE type = 'table'`).map((r) => r.name));
  return Object.fromEntries(CORE_TABLES.filter((t) => present.has(t)).map((t) => [t, Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0)]));
}

function fingerprint(db: SqliteConnection): string {
  const rows = db.all<{ type: string; name: string; tbl_name: string; sql: string | null }>(`SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`);
  return sha256Hex(canonicalJson(rows.map((r) => ({ type: r.type, name: r.name, tbl_name: r.tbl_name, sql: r.sql ?? null }))));
}

/** Verifies a migrated database: integrity, foreign keys, exactly the expected schema, and no row lost. */
function verifyMigrated(db: SqliteConnection, expectedFingerprint: string, before: Record<string, number>, toVersion: number): string | null {
  const integrity = db.integrityCheck();
  if (integrity.length !== 1 || integrity[0] !== 'ok') return 'INTEGRITY_CHECK_FAILED';
  if (db.all('PRAGMA foreign_key_check').length !== 0) return 'FOREIGN_KEY_CHECK_FAILED';
  if (userVersion(db) !== toVersion) return 'VERSION_NOT_REACHED';
  if (fingerprint(db) !== expectedFingerprint) return 'SCHEMA_FINGERPRINT_MISMATCH';
  const after = tableCounts(db);
  for (const [t, n] of Object.entries(before)) if ((after[t] ?? 0) < n) return 'ROWS_LOST';
  return null;
}

export interface SafeUpgradeReport {
  readonly outcome: 'UP_TO_DATE' | 'ACTIVATED' | 'ROLLED_BACK_UPDATE_HOLD';
  readonly updateId: Id | null;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly code: string;
  readonly snapshotSha256: string | null;
}

export interface SafeUpgradeOptions {
  readonly clock?: Clock;
  readonly runtimeVersion?: string;
}

/** Storage-internal knobs for tests (not exported by the package): a fixture migration set and failure injection. */
export interface SafeUpgradeInternals {
  readonly migrations?: readonly Migration[];
  readonly failAt?: 'rehearsal' | 'live-migrate' | 'live-verify';
}

export async function safeUpgrade(root: string, options: SafeUpgradeOptions = {}): Promise<SafeUpgradeReport> {
  return safeUpgradeInternal(root, options, {});
}

export async function safeUpgradeInternal(root: string, options: SafeUpgradeOptions, internals: SafeUpgradeInternals): Promise<SafeUpgradeReport> {
  const clock = options.clock ?? systemClock;
  const runtimeVersion = options.runtimeVersion ?? '0.1.0';
  const layout = openWorkspace(path.resolve(root), { create: false });
  assertNoUpdateHold(layout.root);
  const migrations = internals.migrations ?? loadReleasedMigrations();
  const target = migrations.length;

  // 1. Preflight (read-only): coherent, known, not from the future, runtime stopped.
  const probe = SqliteConnection.open({ path: layout.databasePath, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS });
  let fromVersion: number;
  try {
    fromVersion = userVersion(probe);
    if (fromVersion > target) throw new QandeelError('SCHEMA_FROM_FUTURE', 'database schema is newer than this runtime; restore a compatible snapshot instead of downgrading', { databaseVersion: fromVersion, runtimeVersion: target });
    for (const a of appliedMigrations(probe)) {
      const m = migrations[a.version - 1];
      if (!m || m.sha256 !== a.sha256) throw new QandeelError('MIGRATION_CHECKSUM_DRIFT', 'an applied migration does not match this release', { version: a.version });
    }
    if (fromVersion === target) return { outcome: 'UP_TO_DATE', updateId: null, fromVersion, toVersion: target, code: 'NO_PENDING_MIGRATION', snapshotSha256: null };
    const lease = probe.get<{ expires_at: string }>(`SELECT expires_at FROM runtime_leases WHERE name = 'supervisor'`);
    if (lease && lease.expires_at > now(clock)) throw new QandeelError('MAINTENANCE_REFUSED', 'stop the runtime before a schema update (a live supervisor lease is held)', { reason: 'RUNTIME_RUNNING' });
  } finally {
    probe.close();
  }
  assertDatabaseNotInUse(layout.databasePath);

  // 2. Backup: the known-good pre-update snapshot and its manifest.
  const updateId = newId();
  const dir = path.join(maintenanceDir(layout.root), updateId);
  mkdirSync(dir, { recursive: true });
  const startedAt = now(clock);
  const snapshotPath = path.join(dir, 'pre-update.sqlite3');
  const source = SqliteConnection.open({ path: layout.databasePath, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS });
  let before: Record<string, number>;
  try {
    await source.backupTo(`${snapshotPath}.partial`);
    before = tableCounts(source);
  } finally {
    source.close();
  }
  const snap = SqliteConnection.open({ path: `${snapshotPath}.partial`, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS, keepJournalMode: true });
  try {
    snap.convertSnapshotToRollbackJournal();
    const integrity = snap.integrityCheck();
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new QandeelError('BACKUP_INTEGRITY', 'the pre-update snapshot failed integrity_check', { updateId });
  } finally {
    snap.close();
  }
  renameSync(`${snapshotPath}.partial`, snapshotPath);
  const snapshotSha256 = sha256Hex(readFileSync(snapshotPath));
  const journal = (state: string, code: string, extra: Record<string, unknown> = {}): void => {
    writeFileSync(path.join(dir, 'journal.json'), `${JSON.stringify({ updateId, state, code, fromVersion, toVersion: target, snapshotSha256, runtimeVersion, counts: before, migrations: migrations.map((m) => ({ version: m.version, sha256: m.sha256 })), startedAt, at: now(clock), ...extra }, null, 2)}\n`);
  };
  journal('BACKED_UP', 'PRE_UPDATE_SNAPSHOT');

  // The schema the release must produce (computed on a scratch database from the same migration set).
  const probePath = path.join(dir, 'expected-schema.sqlite3');
  const expected = SqliteConnection.open({ path: probePath, busyTimeoutMs: 1_000 });
  let expectedFingerprint: string;
  try {
    migrate(expected, migrations, { clock, runtimeVersion: 'schema-probe' });
    expectedFingerprint = fingerprint(expected);
  } finally {
    expected.close();
  }
  for (const f of readdirSync(dir)) if (f.startsWith('expected-schema.sqlite3')) rmSync(path.join(dir, f), { force: true });

  const hold = (code: string): SafeUpgradeReport => {
    journal('UPDATE_HOLD', code);
    writeFileSync(path.join(maintenanceDir(layout.root), HOLD_FILE), `${JSON.stringify({ updateId, code, fromVersion, toVersion: target, at: now(clock) })}\n`);
    return { outcome: 'ROLLED_BACK_UPDATE_HOLD', updateId, fromVersion, toVersion: target, code, snapshotSha256 };
  };

  // 3. Rehearse on a copy of the snapshot; the live database is untouched until this passes.
  const stagedPath = path.join(dir, 'staged.sqlite3');
  copyFileSync(snapshotPath, stagedPath);
  let rehearsal: string | null;
  const staged = SqliteConnection.open({ path: stagedPath, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS });
  try {
    try {
      migrate(staged, migrations, { clock, runtimeVersion });
      rehearsal = internals.failAt === 'rehearsal' ? 'INJECTED_REHEARSAL_FAILURE' : verifyMigrated(staged, expectedFingerprint, before, target);
    } catch (error) {
      rehearsal = error instanceof QandeelError ? error.code : 'REHEARSAL_ERROR';
    }
  } finally {
    staged.close();
  }
  for (const f of readdirSync(dir)) if (f.startsWith('staged.sqlite3')) rmSync(path.join(dir, f), { force: true });
  if (rehearsal !== null) return hold(`REHEARSAL_${rehearsal}`.slice(0, 64));
  journal('REHEARSED', 'REHEARSAL_VERIFIED');

  // 4 + 5. Migrate the live database, then verify it; any failure restores the compatible snapshot.
  let failure: string | null;
  const live = SqliteConnection.open({ path: layout.databasePath, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS });
  try {
    try {
      if (internals.failAt === 'live-migrate') throw new QandeelError('MIGRATION_FAILED', 'injected live migration failure');
      migrate(live, migrations, { clock, runtimeVersion });
      failure = internals.failAt === 'live-verify' ? 'INJECTED_VERIFY_FAILURE' : verifyMigrated(live, expectedFingerprint, before, target);
      if (failure === null) {
        const quick = live.all<{ quick_check: string }>('PRAGMA quick_check(10)').map((r) => r.quick_check).join('; ');
        if (quick !== 'ok') failure = 'QUICK_CHECK_FAILED';
      }
    } catch (error) {
      failure = error instanceof QandeelError ? error.code : 'MIGRATION_ERROR';
    }
  } finally {
    live.close();
  }
  if (failure !== null) {
    // m-22: the hold (journal first) is in force BEFORE the restore touches any file, so a restore that fails (e.g. a
    // file still open on Windows) can never leave a migrated-but-unverified database that ordinary opens would run.
    const report = hold(`LIVE_${failure}`.slice(0, 64));
    try {
      restoreLiveFromSnapshot(layout.databasePath, snapshotPath);
    } catch (error) {
      journal('UPDATE_HOLD', 'RESTORE_FAILED', { restoreError: error instanceof QandeelError ? error.code : 'FILE_ERROR' });
      throw new QandeelError('MAINTENANCE_FAILED', 'the live database could not be restored from the pre-update snapshot; the workspace stays in UPDATE_HOLD', { updateId, reason: 'RESTORE_FAILED', hold: true }, { cause: error });
    }
    recordMaintenance(layout.databasePath, { updateId, fromVersion, toVersion: target, snapshotSha256, outcome: 'ROLLED_BACK_UPDATE_HOLD', code: report.code, runtimeVersion, startedAt, clock });
    return report;
  }

  // 6. Activate. The journal keeps the activation baseline (row counts, last audit row) so a later rollback can tell
  // exactly what happened after activation (R2-31).
  recordMaintenance(layout.databasePath, { updateId, fromVersion, toVersion: target, snapshotSha256, outcome: 'ACTIVATED', code: 'VERIFIED_AND_ACTIVATED', runtimeVersion, startedAt, clock });
  const activatedAt = now(clock);
  journal('ACTIVATED', 'VERIFIED_AND_ACTIVATED', { activatedAt, activation: readBaseline(layout.databasePath) });
  pruneOldUpdates(layout.root, updateId);
  return { outcome: 'ACTIVATED', updateId, fromVersion, toVersion: target, code: 'VERIFIED_AND_ACTIVATED', snapshotSha256 };
}

/**
 * Removes one file; a missing file is fine. `unlinkSync`, not `rmSync`: on the Founder's Windows host (Node 24),
 * `rmSync` of a file another process holds open under a non-ASCII path (e.g. an Arabic workspace name) terminates
 * the process (0xC0000409) instead of throwing; `unlinkSync` reports EBUSY / EPERM as an ordinary error.
 */
function removeFile(file: string): void {
  try {
    unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Restores the live database from a compatible pre-update snapshot (runtime stopped; WAL files discarded). */
function restoreLiveFromSnapshot(databasePath: string, snapshotPath: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) removeFile(`${databasePath}${suffix}`);
  copyFileSync(snapshotPath, `${databasePath}.restoring`);
  removeFile(databasePath);
  renameSync(`${databasePath}.restoring`, databasePath);
  // Reopening returns the file to WAL mode (SqliteConnection enforces it) and proves it opens cleanly.
  const check = SqliteConnection.open({ path: databasePath, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS });
  try {
    const integrity = check.integrityCheck();
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new QandeelError('BACKUP_INTEGRITY', 'the restored pre-update snapshot failed integrity_check');
  } finally {
    check.close();
  }
}

function recordMaintenance(databasePath: string, r: { updateId: Id; fromVersion: number; toVersion: number; snapshotSha256: string; outcome: 'ACTIVATED' | 'ROLLED_BACK_UPDATE_HOLD'; code: string; runtimeVersion: string; startedAt: string; clock: Clock }): void {
  const db = SqliteConnection.open({ path: databasePath, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS });
  try {
    // A database restored to a version before 0010 has no maintenance table: the on-disk journal is the record.
    if (!db.get(`SELECT 1 AS x FROM sqlite_schema WHERE type = 'table' AND name = 'maintenance_records'`)) return;
    db.immediate('record maintenance', () => {
      db.run(
        `INSERT INTO maintenance_records (id, kind, from_version, to_version, snapshot_sha256, outcome, code, runtime_version, started_at, finished_at) VALUES (?, 'SCHEMA_UPDATE', ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.updateId, r.fromVersion, r.toVersion, r.snapshotSha256, r.outcome, r.code, r.runtimeVersion.slice(0, 32), r.startedAt, now(r.clock),
      );
      appendAudit({ db, clock: r.clock, fault: () => undefined }, 'maintenance.schema_update', 'maintenance', r.updateId, { actorRef: 'system:maintenance' }, r.outcome === 'ACTIVATED' ? 'OK' : 'ERROR', r.code, { fromVersion: r.fromVersion, toVersion: r.toVersion });
    });
  } finally {
    db.close();
  }
}

/** Bounded rollback period: the last KEEP_UPDATES activated snapshots stay; older snapshot files are removed. */
function pruneOldUpdates(root: string, current: Id): void {
  const base = maintenanceDir(root);
  const dirs = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[0-9a-f-]{36}$/.test(d.name))
    .map((d) => {
      const j = path.join(base, d.name, 'journal.json');
      const state = existsSync(j) ? (JSON.parse(readFileSync(j, 'utf8')) as { state?: string; at?: string }) : {};
      return { name: d.name, state: state.state ?? '', at: state.at ?? '' };
    })
    .filter((d) => d.state === 'ACTIVATED' || d.name === current)
    .sort((a, b) => (a.at > b.at ? -1 : 1));
  for (const d of dirs.slice(KEEP_UPDATES)) rmSync(path.join(base, d.name, 'pre-update.sqlite3'), { force: true });
}

/**
 * m-22: preflight runs with the runtime stopped, but another process (a Command Center, an inspection tool) may still
 * hold the database open — and on Windows an open file cannot be replaced, so a later restore would fail half-way.
 * SQLite removes the `-wal` / `-shm` files when the LAST connection closes; after the preflight probe closed, their
 * presence means another connection is open. Refused before anything is written.
 */
function assertDatabaseNotInUse(databasePath: string): void {
  if (existsSync(`${databasePath}-wal`) || existsSync(`${databasePath}-shm`)) {
    throw new QandeelError('MAINTENANCE_REFUSED', 'another connection has the Company database open; close every process using this workspace first', { reason: 'DATABASE_IN_USE' });
  }
}

interface Baseline {
  readonly counts: Record<string, number>;
  readonly lastAuditId: number;
}

function baselineOf(db: SqliteConnection): Baseline {
  return { counts: tableCounts(db), lastAuditId: Number(db.get<{ n: number | null }>('SELECT MAX(id) AS n FROM audit_events')?.n ?? 0) };
}

function readBaseline(databasePath: string): Baseline {
  const db = SqliteConnection.open({ path: databasePath, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS });
  try {
    return db.snapshot(() => baselineOf(db));
  } finally {
    db.close();
  }
}

/** An application-consistent, self-contained, integrity-checked copy of the live database (the same method as the pre-update snapshot). */
async function consistentSnapshot(databasePath: string, target: string): Promise<string> {
  const source = SqliteConnection.open({ path: databasePath, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS });
  try {
    await source.backupTo(`${target}.partial`);
  } finally {
    source.close();
  }
  const snap = SqliteConnection.open({ path: `${target}.partial`, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS, keepJournalMode: true });
  try {
    snap.convertSnapshotToRollbackJournal();
    const integrity = snap.integrityCheck();
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new QandeelError('BACKUP_INTEGRITY', 'the snapshot failed integrity_check');
  } finally {
    snap.close();
  }
  renameSync(`${target}.partial`, target);
  return sha256Hex(readFileSync(target));
}

export interface RollbackReport {
  readonly restored: true;
  readonly updateId: Id;
  readonly rollbackId: Id;
  readonly fromVersion: number;
  readonly activatedAt: string | null;
  /** Work recorded after activation that the rollback discarded from the live database (counts only; kept in the pre-rollback snapshot). */
  readonly postUpdateWork: { readonly exists: boolean; readonly auditRowsAfterActivation: number; readonly rowsAddedAfterActivation: Readonly<Record<string, number>> };
  readonly discardAcknowledged: boolean;
  /** The retained application-consistent copy of the live database taken just before the rollback (never pruned). */
  readonly preRollbackSnapshot: { readonly file: string; readonly sha256: string };
  readonly hold: 'OPERATOR_ROLLBACK';
  readonly next: 'clear-update-hold, then safe-upgrade (the runtime runs it at start)';
}

/**
 * Operator rollback inside the bounded period (R2-31): restores the live database from an update's pre-update snapshot.
 * It destroys nothing silently: post-activation work (rows and audit after the recorded activation baseline) is
 * measured first and the rollback is REFUSED unless the operator explicitly acknowledges discarding it; the hold and
 * rollback journal are written before anything changes; an application-consistent copy of the current live database
 * is taken and RETAINED (`maintenance/<updateId>/rb-<id>.sqlite3`, never pruned); the report states the discarded counts, the
 * activation time and that copy's checksum. The workspace ends in UPDATE_HOLD; after the operator clears it, the next
 * upgrade goes through safe-upgrade (an existing Company is never migrated live at open). The runtime must be stopped.
 * When the rollback window ends ("proven stable") is a Product decision (PG-09), not a time bound here.
 */
export async function rollbackSchemaUpdate(root: string, updateId: string, options: { clock?: Clock; discardPostUpdateWork?: boolean } = {}): Promise<RollbackReport> {
  const clock = options.clock ?? systemClock;
  const layout = layoutFor(path.resolve(root));
  if (!/^[0-9a-f-]{36}$/.test(updateId)) throw new QandeelError('VALIDATION_FAILED', 'updateId is an id', { field: 'updateId' });
  // RR4-1: a verification copy's permanent hold is never replaced by a rollback hold (which the operator could clear).
  if (isRestoreCheckCopy(layout.root)) throw new QandeelError('MAINTENANCE_REFUSED', 'this workspace is a restore-check verification copy; it is never rolled back or started', { reason: RESTORE_CHECK_COPY });
  const dir = path.join(maintenanceDir(layout.root), updateId);
  const snapshotPath = path.join(dir, 'pre-update.sqlite3');
  const journalPath = path.join(dir, 'journal.json');
  if (!existsSync(snapshotPath) || !existsSync(journalPath)) throw new QandeelError('NOT_FOUND', 'no pre-update snapshot is kept for that update (outside the rollback period)', { updateId });
  const j = JSON.parse(readFileSync(journalPath, 'utf8')) as { snapshotSha256: string; fromVersion: number; toVersion?: number; counts?: Record<string, number>; activatedAt?: string; activation?: Baseline };
  if (sha256Hex(readFileSync(snapshotPath)) !== j.snapshotSha256) throw new QandeelError('BACKUP_INTEGRITY', 'the pre-update snapshot does not match its journal', { updateId });

  // Preflight (read-only): runtime stopped, nobody else has the database open, and what happened since activation.
  const probe = SqliteConnection.open({ path: layout.databasePath, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS });
  let current: Baseline;
  try {
    const lease = probe.get<{ expires_at: string }>(`SELECT expires_at FROM runtime_leases WHERE name = 'supervisor'`);
    if (lease && lease.expires_at > now(clock)) throw new QandeelError('MAINTENANCE_REFUSED', 'stop the runtime before a rollback', { reason: 'RUNTIME_RUNNING' });
    current = probe.snapshot(() => baselineOf(probe));
  } finally {
    probe.close();
  }
  assertDatabaseNotInUse(layout.databasePath);
  // The baseline is the activation state (the journal of an older release has only the pre-update counts: then the
  // activation's own record counts as divergence — conservative, never silent).
  const base = j.activation ?? { counts: j.counts ?? {}, lastAuditId: -1 };
  const added = Object.fromEntries(Object.entries(current.counts).map(([t, n]) => [t, Math.max(0, n - (base.counts[t] ?? 0))]).filter(([, n]) => Number(n) > 0)) as Record<string, number>;
  const auditAfter = base.lastAuditId < 0 ? (added.audit_events ?? 0) : Math.max(0, current.lastAuditId - base.lastAuditId);
  const exists = auditAfter > 0 || Object.keys(added).length > 0;
  const acknowledged = options.discardPostUpdateWork === true;
  if (exists && !acknowledged) {
    throw new QandeelError('MAINTENANCE_REFUSED', 'work was recorded after this update was activated; a rollback would discard it (acknowledge explicitly with --discard-post-update-work)', { reason: 'POST_UPDATE_WORK_EXISTS', updateId, auditRowsAfterActivation: auditAfter, workItemsAdded: added.work_items ?? 0, activatedAt: j.activatedAt ?? null });
  }

  // Hold and journal FIRST: from here on no ordinary open can run on a database in transition.
  const rollbackId = newId();
  const rollbackJournal = (state: string, code: string, extra: Record<string, unknown> = {}): void => {
    writeFileSync(path.join(dir, `rollback-${rollbackId}.json`), `${JSON.stringify({ rollbackId, updateId, state, code, fromVersion: j.fromVersion, activatedAt: j.activatedAt ?? null, postUpdateWork: { exists, auditRowsAfterActivation: auditAfter, rowsAddedAfterActivation: added }, discardAcknowledged: acknowledged, at: now(clock), ...extra }, null, 2)}\n`);
  };
  rollbackJournal('ROLLBACK_STARTED', 'OPERATOR_ROLLBACK');
  mkdirSync(maintenanceDir(layout.root), { recursive: true });
  writeFileSync(path.join(maintenanceDir(layout.root), HOLD_FILE), `${JSON.stringify({ updateId, code: 'OPERATOR_ROLLBACK', fromVersion: j.fromVersion, toVersion: CURRENT_SCHEMA_VERSION, at: now(clock) })}\n`);

  // The current live database (post-activation audit, the maintenance record, any work) is retained before it is replaced.
  // A short name: SQLite's Windows VFS does not take paths beyond MAX_PATH, and the workspace path is the operator's.
  const preRollbackFile = `rb-${rollbackId.slice(0, 8)}.sqlite3`;
  let preRollbackSha: string;
  try {
    preRollbackSha = await consistentSnapshot(layout.databasePath, path.join(dir, preRollbackFile));
  } catch (error) {
    rollbackJournal('UPDATE_HOLD', 'PRE_ROLLBACK_SNAPSHOT_FAILED');
    throw new QandeelError('MAINTENANCE_FAILED', 'the pre-rollback snapshot could not be taken; nothing was restored and the workspace stays in UPDATE_HOLD', { updateId, reason: 'PRE_ROLLBACK_SNAPSHOT_FAILED', hold: true }, { cause: error });
  }
  rollbackJournal('PRE_ROLLBACK_SNAPSHOT', 'RETAINED', { preRollbackSnapshot: { file: preRollbackFile, sha256: preRollbackSha } });
  try {
    restoreLiveFromSnapshot(layout.databasePath, snapshotPath);
  } catch (error) {
    rollbackJournal('UPDATE_HOLD', 'RESTORE_FAILED', { preRollbackSnapshot: { file: preRollbackFile, sha256: preRollbackSha } });
    throw new QandeelError('MAINTENANCE_FAILED', 'the live database could not be restored from the pre-update snapshot; the workspace stays in UPDATE_HOLD (the pre-rollback snapshot is kept)', { updateId, reason: 'RESTORE_FAILED', hold: true }, { cause: error });
  }
  rollbackJournal('ROLLED_BACK', 'OPERATOR_ROLLBACK', { preRollbackSnapshot: { file: preRollbackFile, sha256: preRollbackSha } });
  return {
    restored: true,
    updateId: updateId as Id,
    rollbackId,
    fromVersion: j.fromVersion,
    activatedAt: j.activatedAt ?? null,
    postUpdateWork: { exists, auditRowsAfterActivation: auditAfter, rowsAddedAfterActivation: added },
    discardAcknowledged: acknowledged,
    preRollbackSnapshot: { file: preRollbackFile, sha256: preRollbackSha },
    hold: 'OPERATOR_ROLLBACK',
    next: 'clear-update-hold, then safe-upgrade (the runtime runs it at start)',
  };
}
