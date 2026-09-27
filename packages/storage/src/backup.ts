/**
 * Local, application-consistent backup primitives (Stage 12 §30–§33, Stage 15 D15-A.5).
 *
 * C1 scope: a live-database snapshot through SQLite's Online Backup API (`node:sqlite`
 * `backup()`), a manifest with checksums, isolated verification, and a restore into an isolated
 * workspace with a dry start. The active database file is never copied directly, and the live
 * database is never replaced. Encrypted off-device copies, generational retention, immutable
 * copies, device-loss promotion and production rollback are deferred to C6/L1.
 */
import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as sleepMs } from 'node:timers/promises';
import path from 'node:path';

import { QandeelError, assertId, canonicalJson, isQandeelError, newId, sha256Hex, type Clock, type Id, type Timestamp, systemClock } from '@qandeel-company/domain';

import { appendAudit, ts } from './internal.js';
import { CURRENT_SCHEMA_VERSION, RELEASED_MIGRATIONS, appliedMigrations, loadReleasedMigrations, migrate, userVersion } from './migrations.js';
import { SqliteConnection } from './sqlite/connection.js';
import { CompanyStore, DEFAULT_BUSY_TIMEOUT_MS, storeContext } from './store.js';
import { assertLocalPathSyntax, containedPath, isWithin, layoutFor, openWorkspace, DATABASE_FILE } from './workspace.js';

export const BACKUP_FORMAT = 'qandeel-company-backup/1';
const MANIFEST_FILE = 'manifest.json';

export interface BackupCounts {
  readonly workItems: number;
  readonly jobs: number;
  readonly runs: number;
  readonly checkpoints: number;
  readonly events: number;
  readonly auditEvents: number;
  readonly artifacts: number;
}

export interface BackupManifest {
  readonly format: typeof BACKUP_FORMAT;
  readonly backupId: Id;
  readonly createdAt: Timestamp;
  readonly runtimeVersion: string;
  readonly schemaVersion: number;
  readonly migrations: readonly { version: number; sha256: string }[];
  readonly snapshot: { readonly file: string; readonly sha256: string; readonly sizeBytes: number; readonly pages: number };
  readonly integrity: 'ok';
  readonly counts: BackupCounts;
  readonly artifacts: { readonly count: number; readonly manifestSha256: string; readonly entries: readonly { id: Id; sha256: string; sizeBytes: number }[] };
}

export interface BackupResult {
  readonly backupId: Id;
  readonly directory: string;
  readonly manifest: BackupManifest;
  readonly manifestSha256: string;
  /** How the live record was written: attempts used by the bounded finalization retry (D-C1-24). */
  readonly finalization: { readonly outcome: 'RECORDED' | 'ALREADY_RECORDED'; readonly attempts: number };
}

function countsOf(db: SqliteConnection): BackupCounts {
  const n = (table: string): number => Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0);
  return {
    workItems: n('work_items'),
    jobs: n('queue_jobs'),
    runs: n('runs'),
    checkpoints: n('run_checkpoints'),
    events: n('events'),
    auditEvents: n('audit_events'),
    artifacts: n('artifacts'),
  };
}

function artifactEntries(db: SqliteConnection): { id: Id; sha256: string; sizeBytes: number }[] {
  return db
    .all<{ id: string; sha256: string; size_bytes: number }>(`SELECT id, sha256, size_bytes FROM artifacts WHERE state = 'READY' ORDER BY id`)
    .map((r) => ({ id: r.id as Id, sha256: r.sha256, sizeBytes: Number(r.size_bytes) }));
}

function fsyncPath(target: string, kind: 'file' | 'dir' = 'file'): void {
  // Windows FlushFileBuffers needs a writable handle for files; directories are synced on POSIX only.
  const fd = openSync(target, kind === 'file' ? 'r+' : 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fileSha256(file: string): string {
  return sha256Hex(readFileSync(file));
}

/**
 * Bounded retry policy for the final `backup_records` transaction (D-C1-24).
 *
 * Only that one short `BEGIN IMMEDIATE` is retried, and only on STORAGE_BUSY (SQLITE_BUSY /
 * SQLITE_LOCKED at write-lock acquisition). Each attempt waits at most the store's own bounded busy
 * timeout (unchanged; DEFAULT_BUSY_TIMEOUT_MS = 5 s) inside SQLite's busy handler, then control is
 * released completely and the next attempt starts after a jittered delay taken OUTSIDE any
 * transaction. Worst case with the defaults: 4 attempts x 5 s + at most 0.7 s of delays, about 21 s.
 * The snapshot itself is never redone on BUSY.
 */
export interface BackupFinalizationPolicy {
  /** Total attempts including the first (1..10). */
  readonly maxAttempts: number;
  /** Delay before retry n is min(maxDelayMs, baseDelayMs * 2^(n-1)) scaled by a jitter in [0.5, 1]. */
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
}

export const DEFAULT_BACKUP_FINALIZATION_POLICY: BackupFinalizationPolicy = Object.freeze({
  maxAttempts: 4,
  baseDelayMs: 100,
  maxDelayMs: 1_000,
  sleep: (ms: number) => sleepMs(ms),
  random: Math.random,
});

/** Delay before retry `retry` (1-based), always within [0.5, 1] x min(maxDelayMs, base * 2^(retry-1)). */
export function finalizationDelayMs(policy: BackupFinalizationPolicy, retry: number): number {
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (retry - 1));
  const jitter = 0.5 + 0.5 * Math.min(1, Math.max(0, policy.random()));
  return Math.round(ceiling * jitter);
}

function resolvePolicy(overrides: Partial<BackupFinalizationPolicy> = {}): BackupFinalizationPolicy {
  const policy = { ...DEFAULT_BACKUP_FINALIZATION_POLICY, ...overrides };
  const boundedInt = (n: number, min: number, max: number): boolean => Number.isInteger(n) && n >= min && n <= max;
  if (!boundedInt(policy.maxAttempts, 1, 10) || !boundedInt(policy.baseDelayMs, 0, 5_000) || !boundedInt(policy.maxDelayMs, policy.baseDelayMs, 5_000)) {
    throw new QandeelError('VALIDATION_FAILED', 'backup finalization policy must be bounded (1..10 attempts, delays 0..5000 ms)');
  }
  return policy;
}

/** Exactly what the live Company records for one backup. */
export interface BackupRecordInput {
  readonly backupId: Id;
  readonly createdAt: Timestamp;
  readonly schemaVersion: number;
  readonly snapshotSha256: string;
  readonly manifestSha256: string;
  readonly integrity: 'ok';
  readonly artifactCount: number;
  readonly pages: number;
}

export function backupRecordFor(manifest: BackupManifest, manifestSha256: string): BackupRecordInput {
  return {
    backupId: manifest.backupId,
    createdAt: manifest.createdAt,
    schemaVersion: manifest.schemaVersion,
    snapshotSha256: manifest.snapshot.sha256,
    manifestSha256,
    integrity: manifest.integrity,
    artifactCount: manifest.artifacts.count,
    pages: manifest.snapshot.pages,
  };
}

export type BackupFinalizationOutcome = 'RECORDED' | 'ALREADY_RECORDED';

/**
 * One short idempotent write transaction. No row → insert it (plus one audit row). An identical
 * row → already finalized: nothing is written. The same backup ID with any differing field → fail
 * closed; the existing row is never modified (no INSERT OR REPLACE).
 */
export function recordBackupOnce(store: CompanyStore, record: BackupRecordInput): BackupFinalizationOutcome {
  const ctx = storeContext(store);
  return ctx.db.immediate('record backup', () => {
    const existing = ctx.db.get<{ created_at: string; schema_version: number; snapshot_sha256: string; manifest_sha256: string; integrity_result: string; artifact_count: number }>(
      'SELECT created_at, schema_version, snapshot_sha256, manifest_sha256, integrity_result, artifact_count FROM backup_records WHERE id = ?',
      record.backupId,
    );
    if (existing) {
      const identical =
        existing.created_at === record.createdAt &&
        Number(existing.schema_version) === record.schemaVersion &&
        existing.snapshot_sha256 === record.snapshotSha256 &&
        existing.manifest_sha256 === record.manifestSha256 &&
        existing.integrity_result === record.integrity &&
        Number(existing.artifact_count) === record.artifactCount;
      if (identical) return 'ALREADY_RECORDED';
      throw new QandeelError('STORAGE_INVARIANT', 'a different backup is already recorded under this backup id', { backupId: record.backupId });
    }
    ctx.db.run(
      `INSERT INTO backup_records (id, created_at, schema_version, snapshot_sha256, manifest_sha256, integrity_result, artifact_count) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      record.backupId,
      record.createdAt,
      record.schemaVersion,
      record.snapshotSha256,
      record.manifestSha256,
      record.integrity,
      record.artifactCount,
    );
    appendAudit(ctx, 'backup.created', 'backup', record.backupId, {}, 'OK', null, { schemaVersion: record.schemaVersion, pages: record.pages, artifacts: record.artifactCount });
    return 'RECORDED';
  });
}

/**
 * Records a produced backup with bounded retry. Only STORAGE_BUSY is retried; every other error
 * (including a conflicting record) fails immediately. The delay runs between transactions, never
 * inside one. Exhaustion throws STORAGE_BUSY with the attempt count.
 */
export async function finalizeBackupRecord(
  store: CompanyStore,
  record: BackupRecordInput,
  policy: BackupFinalizationPolicy = DEFAULT_BACKUP_FINALIZATION_POLICY,
): Promise<{ outcome: BackupFinalizationOutcome; attempts: number }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return { outcome: recordBackupOnce(store, record), attempts: attempt };
    } catch (error) {
      if (!isQandeelError(error, 'STORAGE_BUSY')) throw error;
      if (attempt >= policy.maxAttempts) {
        throw new QandeelError('STORAGE_BUSY', 'backup finalization did not acquire the database write lock within its bounded retry envelope', { backupId: record.backupId, attempts: attempt }, { cause: error });
      }
    }
    await policy.sleep(finalizationDelayMs(policy, attempt));
  }
}

/** Test-only knobs for createBackupInternal (not exported from the package entry point). */
export interface BackupInternals {
  readonly policy?: Partial<BackupFinalizationPolicy>;
  readonly backupId?: Id;
  readonly discard?: (directory: string) => void;
}

function discardDirectory(directory: string): void {
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

/**
 * Removes this attempt's own directory after a failure. The path is `<backups>/<backupId>` for the
 * ID this call generated (and created with a non-recursive mkdir), never caller-supplied, so an
 * earlier backup can never be touched. If removal fails the original error is kept (with
 * `attemptDiscarded: false`); discovery is record-based, so the leftover is still not canonical.
 */
function failAttempt(error: unknown, directory: string, backupId: Id, discard: (directory: string) => void): never {
  let discarded = true;
  try {
    discard(directory);
  } catch {
    discarded = false;
  }
  if (error instanceof QandeelError) {
    const message = error.message.startsWith(`${error.code}: `) ? error.message.slice(error.code.length + 2) : error.message;
    throw new QandeelError(error.code, message, { ...error.details, backupId, attemptDiscarded: discarded }, { cause: error });
  }
  throw error;
}

/**
 * Creates a verified backup of the live store under `<workspace>/backups/<backupId>/`.
 * The source is read through a dedicated connection with the Online Backup API while the store
 * stays live; the snapshot is a consistent point-in-time image (mutations committed after the
 * backup step began are not required to appear). The backup is canonical only once the live
 * Company has recorded it; any failure removes this attempt's directory (D-C1-24).
 */
export async function createBackup(store: CompanyStore, options: { runtimeVersion?: string } = {}): Promise<BackupResult> {
  return createBackupInternal(store, options, {});
}

export async function createBackupInternal(store: CompanyStore, { runtimeVersion = '0.1.0' }: { runtimeVersion?: string }, internals: BackupInternals): Promise<BackupResult> {
  const ctx = storeContext(store);
  const policy = resolvePolicy(internals.policy);
  const backupId = internals.backupId === undefined ? newId() : assertId(internals.backupId, 'backupId');
  const directory = containedPath(store.workspace.backupsDir, backupId);
  mkdirSync(directory); // non-recursive: fails if the directory exists, so no earlier backup is reused
  try {
    const staging = containedPath(directory, `${DATABASE_FILE}.partial`);
    const snapshot = containedPath(directory, DATABASE_FILE);

    const source = SqliteConnection.open({ path: store.workspace.databasePath, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS });
    let pages: number;
    try {
      pages = await source.backupTo(staging);
    } finally {
      source.close();
    }

    const snap = SqliteConnection.open({ path: staging, busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS, keepJournalMode: true });
    let manifestBody: Omit<BackupManifest, 'snapshot'> & { snapshot?: BackupManifest['snapshot'] };
    try {
      snap.convertSnapshotToRollbackJournal();
      const integrity = snap.integrityCheck();
      if (integrity.length !== 1 || integrity[0] !== 'ok') {
        throw new QandeelError('BACKUP_INTEGRITY', 'snapshot failed integrity_check', { backupId, problems: integrity.length });
      }
      if (snap.all('PRAGMA foreign_key_check').length !== 0) throw new QandeelError('BACKUP_INTEGRITY', 'snapshot failed foreign_key_check', { backupId });
      const entries = artifactEntries(snap);
      manifestBody = {
        format: BACKUP_FORMAT,
        backupId,
        createdAt: ts(ctx),
        runtimeVersion,
        schemaVersion: userVersion(snap),
        migrations: appliedMigrations(snap).map((m) => ({ version: m.version, sha256: m.sha256 })),
        integrity: 'ok',
        counts: countsOf(snap),
        artifacts: { count: entries.length, manifestSha256: sha256Hex(canonicalJson(entries)), entries },
      };
    } finally {
      snap.close();
    }
    renameSync(staging, snapshot);
    const manifest: BackupManifest = {
      ...manifestBody,
      snapshot: { file: DATABASE_FILE, sha256: fileSha256(snapshot), sizeBytes: statSync(snapshot).size, pages },
    } as BackupManifest;
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestTmp = containedPath(directory, `${MANIFEST_FILE}.partial`);
    writeFileSync(manifestTmp, manifestText, { flag: 'wx' });
    renameSync(manifestTmp, containedPath(directory, MANIFEST_FILE));
    const manifestSha256 = sha256Hex(manifestText);
    // Make the backup durable before the live store records it as 'ok' (synchronous=FULL there).
    for (const file of [snapshot, containedPath(directory, MANIFEST_FILE)]) fsyncPath(file);
    if (process.platform !== 'win32') fsyncPath(directory, 'dir');

    const finalization = await finalizeBackupRecord(store, backupRecordFor(manifest, manifestSha256), policy);
    return { backupId, directory, manifest, manifestSha256, finalization };
  } catch (error) {
    failAttempt(error, directory, backupId, internals.discard ?? discardDirectory);
  }
}

export interface BackupVerification {
  readonly backupId: Id;
  readonly ok: true;
  readonly schemaVersion: number;
  readonly counts: BackupCounts;
  readonly integrity: 'ok';
  readonly snapshotSha256: string;
  readonly artifactObjectsChecked: number;
}

function readManifest(directory: string): BackupManifest {
  const file = path.join(directory, MANIFEST_FILE);
  if (!existsSync(file)) throw new QandeelError('BACKUP_INTEGRITY', 'backup manifest is missing');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8')) as BackupManifest;
  } catch (error) {
    throw new QandeelError('BACKUP_INTEGRITY', 'backup manifest is not valid JSON', {}, { cause: error });
  }
  if (manifest.format !== BACKUP_FORMAT || manifest.snapshot?.file !== DATABASE_FILE) throw new QandeelError('BACKUP_INTEGRITY', 'unknown backup format');
  assertId(manifest.backupId, 'backupId');
  if (path.basename(directory) !== manifest.backupId) throw new QandeelError('BACKUP_INTEGRITY', 'backup directory does not match its manifest');
  return manifest;
}

/**
 * Verifies a backup in isolation: checksum, read-only open of the snapshot (never the live
 * database), full `integrity_check`, foreign keys, schema/migration compatibility, and a critical
 * read proof against the manifest. Optionally checks that referenced artifact objects exist and
 * hash correctly in `artifactObjectsDir`.
 */
/** Canonical fingerprint of a database's user schema (tables, indexes, triggers, views). */
function schemaFingerprint(db: SqliteConnection): string {
  const rows = db.all<{ type: string; name: string; tbl_name: string; sql: string | null }>(
    `SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
  );
  return sha256Hex(canonicalJson(rows.map((r) => ({ type: r.type, name: r.name, tbl_name: r.tbl_name, sql: r.sql ?? null }))));
}

const expectedFingerprints = new Map<number, string>();

/** Fingerprint of the schema the released migrations produce at `version` (computed once, in a temp file). */
function releasedSchemaFingerprint(version: number): string {
  const cached = expectedFingerprints.get(version);
  if (cached) return cached;
  const dir = mkdtempSync(path.join(tmpdir(), 'qc-schema-'));
  try {
    const db = SqliteConnection.open({ path: path.join(dir, DATABASE_FILE), busyTimeoutMs: 1_000 });
    try {
      migrate(db, loadReleasedMigrations(version), { clock: systemClock, runtimeVersion: 'schema-probe' });
      const fp = schemaFingerprint(db);
      expectedFingerprints.set(version, fp);
      return fp;
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

export interface ExpectedBackup {
  /** From the live store's `backup_records`: binds the on-disk pair to what this Company recorded. */
  readonly snapshotSha256: string;
  readonly manifestSha256: string;
}

export function verifyBackup(
  directory: string,
  { liveDatabasePath, artifactObjectsDir, expected }: { liveDatabasePath?: string; artifactObjectsDir?: string; expected?: ExpectedBackup } = {},
): BackupVerification {
  const manifest = readManifest(directory);
  if (expected !== undefined) {
    const manifestSha = fileSha256(path.join(directory, MANIFEST_FILE));
    if (manifestSha !== expected.manifestSha256 || manifest.snapshot.sha256 !== expected.snapshotSha256) {
      throw new QandeelError('BACKUP_INTEGRITY', 'backup does not match the record the live Company holds for it', { backupId: manifest.backupId });
    }
  }
  const snapshot = path.join(directory, DATABASE_FILE);
  if (!existsSync(snapshot)) throw new QandeelError('BACKUP_INTEGRITY', 'backup snapshot is missing', { backupId: manifest.backupId });
  if (liveDatabasePath !== undefined && isWithin(liveDatabasePath, snapshot)) {
    throw new QandeelError('BACKUP_INTEGRITY', 'refusing to verify the live database as a backup');
  }
  const sha = fileSha256(snapshot);
  if (sha !== manifest.snapshot.sha256) throw new QandeelError('BACKUP_INTEGRITY', 'snapshot checksum does not match the manifest', { backupId: manifest.backupId });

  const db = SqliteConnection.open({ path: snapshot, busyTimeoutMs: 1_000, readOnly: true });
  try {
    if (db.journalMode !== 'delete') throw new QandeelError('BACKUP_INTEGRITY', 'snapshot is not self-contained', { backupId: manifest.backupId });
    const integrity = db.integrityCheck();
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new QandeelError('BACKUP_INTEGRITY', 'snapshot failed integrity_check', { backupId: manifest.backupId });
    if (db.all('PRAGMA foreign_key_check').length !== 0) throw new QandeelError('BACKUP_INTEGRITY', 'snapshot failed foreign_key_check', { backupId: manifest.backupId });
    const version = userVersion(db);
    const applied = appliedMigrations(db);
    if (version !== manifest.schemaVersion || version < 1 || version > CURRENT_SCHEMA_VERSION) {
      throw new QandeelError('BACKUP_INTEGRITY', 'snapshot schema version is not compatible with this runtime', { backupId: manifest.backupId, version });
    }
    for (const a of applied) {
      const pin = RELEASED_MIGRATIONS[a.version - 1];
      if (!pin || pin.sha256 !== a.sha256) throw new QandeelError('BACKUP_INTEGRITY', 'snapshot migration history does not match this release', { backupId: manifest.backupId, version: a.version });
    }
    // No extra tables, triggers or views: the snapshot schema is exactly what the release produces.
    if (schemaFingerprint(db) !== releasedSchemaFingerprint(version)) {
      throw new QandeelError('BACKUP_INTEGRITY', 'snapshot schema differs from the released schema of its version', { backupId: manifest.backupId, version });
    }
    // Critical read proof: the snapshot's durable content matches what the manifest recorded.
    const counts = countsOf(db);
    if (canonicalJson(counts) !== canonicalJson(manifest.counts)) throw new QandeelError('BACKUP_INTEGRITY', 'snapshot contents do not match the manifest counts', { backupId: manifest.backupId });
    const entries = artifactEntries(db);
    if (sha256Hex(canonicalJson(entries)) !== manifest.artifacts.manifestSha256) {
      throw new QandeelError('BACKUP_INTEGRITY', 'artifact manifest does not match the snapshot', { backupId: manifest.backupId });
    }
    db.get('SELECT id, state, version FROM work_items ORDER BY created_at DESC LIMIT 1');
    db.get('SELECT id, state, fencing_token FROM queue_jobs ORDER BY created_at DESC LIMIT 1');
    let checked = 0;
    if (artifactObjectsDir !== undefined) {
      for (const entry of entries) {
        const object = containedPath(artifactObjectsDir, entry.sha256.slice(0, 2), entry.sha256.slice(2, 4), entry.sha256);
        if (!existsSync(object) || fileSha256(object) !== entry.sha256) {
          throw new QandeelError('BACKUP_INTEGRITY', 'an artifact referenced by the backup is missing or corrupt', { backupId: manifest.backupId, artifactId: entry.id });
        }
        checked++;
      }
    }
    return { backupId: manifest.backupId, ok: true, schemaVersion: version, counts, integrity: 'ok', snapshotSha256: sha, artifactObjectsChecked: checked };
  } finally {
    db.close();
  }
}

export interface IsolatedRestoreReport {
  readonly backupId: Id;
  readonly workspace: string;
  readonly schemaVersionBefore: number;
  readonly schemaVersionAfter: number;
  readonly quickCheck: string;
  readonly counts: BackupCounts;
}

/**
 * Restores a verified backup into a separate, empty workspace and dry-starts it there
 * (Validate → Integrity → Restore isolated → Migration check → Dry start → Compare). Promotion
 * over a live Company is deliberately not implemented in C1.
 */
export function restoreToIsolatedWorkspace(
  directory: string,
  targetRoot: string,
  { clock = systemClock, liveDatabasePath, expected }: { clock?: Clock; liveDatabasePath?: string; expected?: ExpectedBackup } = {},
): IsolatedRestoreReport {
  // Validate the target's syntax before touching it (no network share is ever contacted).
  assertLocalPathSyntax(targetRoot);
  const verification = verifyBackup(directory, { ...(liveDatabasePath !== undefined ? { liveDatabasePath } : {}), ...(expected !== undefined ? { expected } : {}) });
  const target = layoutFor(path.resolve(targetRoot));
  if (liveDatabasePath !== undefined && isWithin(path.dirname(path.dirname(liveDatabasePath)), target.root)) {
    throw new QandeelError('UNSAFE_WORKSPACE', 'isolated restore target must be outside the live workspace', { reason: 'inside-live-workspace' });
  }
  if (existsSync(target.root) && readdirSync(target.root).length > 0) {
    throw new QandeelError('UNSAFE_WORKSPACE', 'isolated restore target must be a new or empty directory', { reason: 'not-empty' });
  }
  const layout = openWorkspace(target.root, { create: true });
  copyFileSync(path.join(directory, DATABASE_FILE), layout.databasePath, fsConstants.COPYFILE_EXCL);
  const restored = CompanyStore.open(layout.root, { clock });
  try {
    const quick = restored.quickCheck();
    if (quick !== 'ok') throw new QandeelError('BACKUP_INTEGRITY', 'restored workspace failed quick_check', { backupId: verification.backupId });
    if (restored.foreignKeyViolations() !== 0) throw new QandeelError('BACKUP_INTEGRITY', 'restored workspace has foreign-key violations', { backupId: verification.backupId });
    const ctx = storeContext(restored);
    const counts = countsOf(ctx.db);
    if (canonicalJson(counts) !== canonicalJson(verification.counts)) throw new QandeelError('BACKUP_INTEGRITY', 'restored workspace differs from the backup', { backupId: verification.backupId });
    return { backupId: verification.backupId, workspace: layout.root, schemaVersionBefore: verification.schemaVersion, schemaVersionAfter: restored.schemaVersion, quickCheck: quick, counts };
  } finally {
    restored.close();
  }
}

/**
 * Canonical backup discovery: the backups the live Company has recorded (`backup_records`) whose
 * directory still holds a manifest. A directory without a record (a failed or interrupted attempt)
 * is never listed, whatever its name or contents (D-C1-24).
 */
export function listBackups(store: CompanyStore): Id[] {
  const ctx = storeContext(store);
  const backupsDir = store.workspace.backupsDir;
  return ctx.db
    .all<{ id: string }>(`SELECT id FROM backup_records WHERE integrity_result = 'ok' ORDER BY id`)
    .map((r) => r.id)
    .filter((id) => /^[0-9a-f-]{36}$/.test(id) && existsSync(path.join(backupsDir, id, MANIFEST_FILE))) as Id[];
}
