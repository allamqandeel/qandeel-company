/**
 * C6 resilience (Stage 15, D15-A..D) over the C1 backup machinery — extended, never replaced.
 *
 * - Recovery objectives are set by criticality class (Critical / Important / Rebuildable), not one number.
 *   The defaults are conservative Strong-v1 values, calibrated in the Pilot; they are not production SLAs.
 * - An encrypted PORTABLE package (application-consistent database snapshot + its manifest + every READY
 *   artifact object + a re-key list) can be placed outside the laptop failure domain through a destination
 *   abstraction. Encryption: scrypt-derived key → AES-256-GCM (`node:crypto` only). The passphrase is the
 *   separately protected recovery material: supplied by the operator, never stored, logged or packaged.
 * - Generational retention keeps several generations (last N + daily + weekly + monthly) and never the
 *   latest alone; the database refuses to retire the last live generation.
 * - Clean-environment restore verifies the package, restores database and artifacts into a NEW workspace,
 *   runs the migration-compatibility and integrity checks, revokes every Founder session of the lost device,
 *   holds for reconciliation every live job that could reach an external effect the lost device may already have
 *   performed after the backup point, and reports the backup point, data age and the credential references that
 *   must be re-keyed; the runtime's own startup recovery then resumes effect-free work and keeps uncertain external
 *   side effects held (never blindly repeated).
 * - Restore drills are recorded (result, duration): `Backup != Recovery Proof`.
 *
 * Nothing here contacts a network; a "destination" is a directory the operator chooses (an external drive,
 * a mounted encrypted remote folder). CI uses a disposable directory as the external target.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { QandeelError, isQandeelError, newId, sha256Hex, type Clock, type Id, type Timestamp } from '@qandeel-company/domain';

import { createBackup, restoreToIsolatedWorkspace, verifyBackup, type BackupManifest } from './backup.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { CURRENT_SCHEMA_VERSION } from './migrations.js';
import { txHoldForReconciliation } from './queue.js';
import { openRestoredStore, storeContext, type CompanyStore } from './store.js';
import {
  HOLD_FILE,
  RESTORE_IN_PROGRESS,
  archiveRestoreMarker,
  beginRestoreMarker,
  completeRestoreMarker,
  fsyncDirectory,
  maintenanceDir,
  readRestoreMarker,
  readUpdateHold,
  replaceRestoreMarker,
  replaceUnreadableRestoreHold,
  type RestoreBinding,
  type RestoreMarker,
} from './update-hold.js';
import { assertLocalPathSyntax, assertWorkspaceLocation, containedPath, isWithin, layoutFor, openWorkspace } from './workspace.js';

// ---------------------------------------------------------------------------------------------------------
// Recovery objectives by criticality (D15-A.2 / A.3).

export const CRITICALITY_CLASSES = ['CRITICAL', 'IMPORTANT', 'REBUILDABLE'] as const;
export type CriticalityClass = (typeof CRITICALITY_CLASSES)[number];

export interface RecoveryObjective {
  readonly criticality: CriticalityClass;
  readonly covers: readonly string[];
  /** Maximum age of the newest verified same-device generation (hours); null = rebuilt, not restored. */
  readonly localRpoHours: number | null;
  /** Maximum age of the newest verified package outside the device failure domain (hours). */
  readonly offDeviceRpoHours: number | null;
  /** Target time to a controlled restart on a clean environment (hours). */
  readonly rtoHours: number;
  readonly calibration: 'STRONG_V1_DEFAULT_PILOT_CALIBRATED';
}

export const RECOVERY_OBJECTIVES: readonly RecoveryObjective[] = Object.freeze([
  {
    criticality: 'CRITICAL',
    covers: ['work lineage, queue, runs, checkpoints', 'governance, authority, approvals, budgets, usage', 'organization, Goals, Founder decisions', 'memory, knowledge, lessons, Academy, certifications', 'evaluations, attributions, learning, reports', 'audit and outbox'],
    localRpoHours: 24,
    offDeviceRpoHours: 168,
    rtoHours: 8,
    calibration: 'STRONG_V1_DEFAULT_PILOT_CALIBRATED',
  },
  { criticality: 'IMPORTANT', covers: ['artifact objects (content-addressed)'], localRpoHours: 24, offDeviceRpoHours: 168, rtoHours: 24, calibration: 'STRONG_V1_DEFAULT_PILOT_CALIBRATED' },
  { criticality: 'REBUILDABLE', covers: ['Company Universe projection, profiles and report views (derived)', 'runtime wake signal, artifact staging', 'Founder sessions (re-issued after restore)'], localRpoHours: null, offDeviceRpoHours: null, rtoHours: 1, calibration: 'STRONG_V1_DEFAULT_PILOT_CALIBRATED' },
]);

const critical = (): RecoveryObjective => {
  const c = RECOVERY_OBJECTIVES.find((o) => o.criticality === 'CRITICAL');
  if (!c) throw new QandeelError('STORAGE_INVARIANT', 'the critical recovery objective is missing');
  return c;
};

// ---------------------------------------------------------------------------------------------------------
// Destinations.

export type FailureDomain = 'SAME_VOLUME' | 'SEPARATE_VOLUME' | 'ATTESTED_OFF_DEVICE';

/** The off-device objective is met only by the operator's attestation (D-C6-06), never by a volume id (R2-28). */
export function isOffDevice(domain: string): boolean {
  return domain === 'ATTESTED_OFF_DEVICE';
}

export interface BackupDestination {
  readonly kind: 'DIRECTORY';
  /** SHA-256 of the canonical location (the path itself is never recorded). */
  readonly ref: string;
  failureDomain(workspaceRoot: string): FailureDomain;
  put(name: string, bytes: Buffer): void;
  get(name: string): Buffer;
  exists(name: string): boolean;
  remove(name: string): void;
  list(): string[];
}

const PACKAGE_NAME = /^[a-z0-9][a-z0-9.-]{0,95}$/;

/**
 * A directory outside the workspace — an external drive, a mounted encrypted folder. `attestOffDevice` is the
 * operator's statement that the directory is outside this laptop's failure domain (recorded as such), and ONLY that
 * statement satisfies the off-device objective (D-C6-06, R2-28). Without it, a path on another volume is
 * SEPARATE_VOLUME and one on the workspace's volume is SAME_VOLUME — and neither is off-device: a different volume
 * id cannot tell a second partition of the same physical disk (which dies with the laptop) from a removable drive.
 */
export class DirectoryDestination implements BackupDestination {
  readonly kind = 'DIRECTORY' as const;
  readonly ref: string;
  readonly #root: string;
  readonly #attested: boolean;

  constructor(root: string, options: { attestOffDevice?: boolean } = {}) {
    assertLocalPathSyntax(root);
    this.#root = path.resolve(root);
    this.#attested = options.attestOffDevice === true;
    this.ref = sha256Hex(this.#root.toLowerCase());
  }

  failureDomain(workspaceRoot: string): FailureDomain {
    const ws = path.resolve(workspaceRoot);
    if (isWithin(ws, this.#root) || isWithin(this.#root, ws)) throw new QandeelError('UNSAFE_WORKSPACE', 'a backup destination is never inside (or around) the live workspace', { reason: 'destination-overlaps-workspace' });
    if (this.#attested) return 'ATTESTED_OFF_DEVICE';
    // The device id distinguishes mounted volumes on every platform (on POSIX every path shares the root '/').
    mkdirSync(this.#root, { recursive: true });
    if (existsSync(ws)) return statSync(ws).dev === statSync(this.#root).dev ? 'SAME_VOLUME' : 'SEPARATE_VOLUME';
    return path.parse(ws).root.toLowerCase() === path.parse(this.#root).root.toLowerCase() ? 'SAME_VOLUME' : 'SEPARATE_VOLUME';
  }

  #file(name: string): string {
    if (!PACKAGE_NAME.test(name)) throw new QandeelError('VALIDATION_FAILED', 'package names are short lowercase codes', { field: 'name' });
    return containedPath(this.#root, name);
  }

  put(name: string, bytes: Buffer): void {
    mkdirSync(this.#root, { recursive: true });
    const target = this.#file(name);
    const partial = `${target}.partial`;
    writeFileSync(partial, bytes, { flag: 'wx' });
    const fd = openSync(partial, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (existsSync(target)) {
      rmSync(partial, { force: true });
      throw new QandeelError('BACKUP_INTEGRITY', 'a package of that name already exists at the destination', { name });
    }
    renameSync(partial, target);
  }

  get(name: string): Buffer {
    const f = this.#file(name);
    if (!existsSync(f)) throw new QandeelError('NOT_FOUND', 'package not found at the destination', { name });
    return readFileSync(f);
  }

  exists(name: string): boolean {
    return existsSync(this.#file(name));
  }

  remove(name: string): void {
    rmSync(this.#file(name), { force: true });
  }

  list(): string[] {
    return existsSync(this.#root) ? readdirSync(this.#root).filter((f) => PACKAGE_NAME.test(f) && f.endsWith('.qcpkg')).sort() : [];
  }
}

// ---------------------------------------------------------------------------------------------------------
// The encrypted portable package.

export const PORTABLE_FORMAT = 'qandeel-company-portable/1';
const MAGIC = Buffer.from('QCPKG1\n', 'ascii');
const TAG_BYTES = 16;
/** Payloads above this are refused rather than risking memory exhaustion (streaming is a recorded residual). */
export const MAX_PORTABLE_PAYLOAD_BYTES = 1_536 * 1024 * 1024;
export const MIN_PASSPHRASE_LENGTH = 16;
const KDF = Object.freeze({ name: 'scrypt', N: 32_768, r: 8, p: 1, keyBytes: 32 });

interface PackageHeader {
  readonly format: typeof PORTABLE_FORMAT;
  readonly packageId: Id;
  readonly backupId: Id;
  readonly createdAt: Timestamp;
  readonly schemaVersion: number;
  readonly cipher: 'aes-256-gcm';
  readonly kdf: { readonly name: 'scrypt'; readonly N: number; readonly r: number; readonly p: number; readonly saltHex: string };
  readonly ivHex: string;
}

interface PayloadEntry {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

function assertPassphrase(passphrase: unknown): string {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH || passphrase.length > 1024) {
    throw new QandeelError('VALIDATION_FAILED', `the recovery passphrase is at least ${MIN_PASSPHRASE_LENGTH} characters`, { field: 'passphrase' });
  }
  return passphrase;
}

function deriveKey(passphrase: string, kdf: PackageHeader['kdf']): Buffer {
  if (kdf.name !== 'scrypt' || kdf.N !== KDF.N || kdf.r !== KDF.r || kdf.p !== KDF.p || !/^[0-9a-f]{32}$/.test(kdf.saltHex)) throw new QandeelError('BACKUP_INTEGRITY', 'unsupported key derivation parameters');
  return scryptSync(passphrase, Buffer.from(kdf.saltHex, 'hex'), KDF.keyBytes, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * 1024 * 1024 });
}

/** payload := <index json>\n<blob 1><blob 2>… (a simple length-indexed container; no external archiver). */
function buildPayload(entries: readonly { path: string; bytes: Buffer }[]): Buffer {
  const index: PayloadEntry[] = entries.map((e) => ({ path: e.path, size: e.bytes.length, sha256: sha256Hex(e.bytes) }));
  const head = Buffer.from(`${JSON.stringify({ entries: index })}\n`, 'utf8');
  const total = head.length + entries.reduce((s, e) => s + e.bytes.length, 0);
  if (total > MAX_PORTABLE_PAYLOAD_BYTES) throw new QandeelError('VALIDATION_FAILED', 'the Company is larger than the portable package bound', { reason: 'PACKAGE_TOO_LARGE' });
  return Buffer.concat([head, ...entries.map((e) => e.bytes)]);
}

function parsePayload(payload: Buffer): Map<string, Buffer> {
  const nl = payload.indexOf(0x0a);
  if (nl < 0) throw new QandeelError('BACKUP_INTEGRITY', 'portable payload has no index');
  let index: { entries: PayloadEntry[] };
  try {
    index = JSON.parse(payload.subarray(0, nl).toString('utf8')) as { entries: PayloadEntry[] };
  } catch (error) {
    throw new QandeelError('BACKUP_INTEGRITY', 'portable payload index is unreadable', {}, { cause: error });
  }
  const out = new Map<string, Buffer>();
  let offset = nl + 1;
  for (const e of index.entries ?? []) {
    if (typeof e.path !== 'string' || !/^(?:manifest\.json|company\.sqlite3|recovery-notes\.json|artifacts\/[0-9a-f]{64})$/.test(e.path) || !Number.isInteger(e.size) || e.size < 0) throw new QandeelError('BACKUP_INTEGRITY', 'portable payload entry is malformed');
    const bytes = payload.subarray(offset, offset + e.size);
    if (bytes.length !== e.size || sha256Hex(bytes) !== e.sha256) throw new QandeelError('BACKUP_INTEGRITY', 'portable payload entry checksum mismatch', { entry: e.path.slice(0, 64) });
    out.set(e.path, bytes);
    offset += e.size;
  }
  if (offset !== payload.length) throw new QandeelError('BACKUP_INTEGRITY', 'portable payload has trailing bytes');
  for (const required of ['manifest.json', 'company.sqlite3']) if (!out.has(required)) throw new QandeelError('BACKUP_INTEGRITY', 'portable payload is incomplete', { entry: required });
  return out;
}

function entry(entries: ReadonlyMap<string, Buffer>, name: string): Buffer {
  const e = entries.get(name);
  if (!e) throw new QandeelError('BACKUP_INTEGRITY', 'portable payload is incomplete', { entry: name });
  return e;
}

export function sealPackage(header: Omit<PackageHeader, 'kdf' | 'ivHex' | 'cipher' | 'format'>, payload: Buffer, passphrase: string): { bytes: Buffer; header: PackageHeader } {
  const full: PackageHeader = {
    format: PORTABLE_FORMAT,
    ...header,
    cipher: 'aes-256-gcm',
    kdf: { name: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, saltHex: randomBytes(16).toString('hex') },
    ivHex: randomBytes(12).toString('hex'),
  };
  const headerBytes = Buffer.from(`${JSON.stringify(full)}\n`, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', deriveKey(assertPassphrase(passphrase), full.kdf), Buffer.from(full.ivHex, 'hex'));
  cipher.setAAD(headerBytes);
  const body = Buffer.concat([cipher.update(payload), cipher.final()]);
  return { bytes: Buffer.concat([MAGIC, headerBytes, body, cipher.getAuthTag()]), header: full };
}

/**
 * The header is untrusted until authenticated, and it is read BEFORE authentication (it carries the KDF parameters):
 * every field is shape-checked first, so a malformed header fails closed as BACKUP_INTEGRITY, never a raw TypeError (m-24).
 */
function assertHeaderShape(header: unknown): asserts header is PackageHeader {
  const h = header as Record<string, unknown> | null;
  const kdf = (typeof h === 'object' && h !== null ? h.kdf : undefined) as Record<string, unknown> | null | undefined;
  const ok =
    typeof h === 'object' && h !== null && !Array.isArray(h) &&
    h.format === PORTABLE_FORMAT && h.cipher === 'aes-256-gcm' && typeof h.ivHex === 'string' && /^[0-9a-f]{24}$/.test(h.ivHex) &&
    typeof h.packageId === 'string' && typeof h.backupId === 'string' && typeof h.createdAt === 'string' && !Number.isNaN(Date.parse(h.createdAt)) &&
    Number.isInteger(h.schemaVersion) &&
    typeof kdf === 'object' && kdf !== null && !Array.isArray(kdf) && typeof kdf.name === 'string' && Number.isInteger(kdf.N) && Number.isInteger(kdf.r) && Number.isInteger(kdf.p) && typeof kdf.saltHex === 'string';
  if (!ok) throw new QandeelError('BACKUP_INTEGRITY', 'unknown portable package format');
}

/** Opens (authenticates, decrypts, checks every entry) a portable package. Any tampering fails closed. */
export function openPackage(bytes: Buffer, passphrase: string): { header: PackageHeader; entries: Map<string, Buffer> } {
  assertPassphrase(passphrase);
  if (bytes.length < MAGIC.length + TAG_BYTES + 2 || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new QandeelError('BACKUP_INTEGRITY', 'not a portable package');
  const nl = bytes.indexOf(0x0a, MAGIC.length);
  if (nl < 0) throw new QandeelError('BACKUP_INTEGRITY', 'portable package header is missing');
  const headerBytes = bytes.subarray(MAGIC.length, nl + 1);
  let header: PackageHeader;
  try {
    header = JSON.parse(headerBytes.toString('utf8')) as PackageHeader;
  } catch (error) {
    throw new QandeelError('BACKUP_INTEGRITY', 'portable package header is unreadable', {}, { cause: error });
  }
  assertHeaderShape(header);
  const body = bytes.subarray(nl + 1, bytes.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, header.kdf), Buffer.from(header.ivHex, 'hex'));
  decipher.setAAD(headerBytes);
  decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
  let payload: Buffer;
  try {
    payload = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch (error) {
    throw new QandeelError('BACKUP_INTEGRITY', 'portable package failed authentication (tampered, truncated or wrong passphrase)', {}, { cause: error });
  }
  const entries = parsePayload(payload);
  const manifest = JSON.parse(entry(entries, 'manifest.json').toString('utf8')) as BackupManifest;
  if (manifest.backupId !== header.backupId || sha256Hex(entry(entries, 'company.sqlite3')) !== manifest.snapshot.sha256) throw new QandeelError('BACKUP_INTEGRITY', 'portable package does not match its manifest');
  for (const a of manifest.artifacts.entries) {
    const obj = entries.get(`artifacts/${a.sha256}`);
    if (!obj || sha256Hex(obj) !== a.sha256) throw new QandeelError('BACKUP_INTEGRITY', 'portable package is missing an artifact object', { artifactId: a.id });
  }
  return { header, entries };
}

const packageNameFor = (createdAt: string, packageId: string): string => `qandeel-${createdAt.replace(/[-:.]/g, '').toLowerCase()}-${packageId.slice(0, 8)}.qcpkg`;

export interface PortableBackupResult {
  readonly packageId: Id;
  readonly backupId: Id;
  readonly name: string;
  readonly packageSha256: string;
  readonly sizeBytes: number;
  readonly failureDomain: FailureDomain;
  /** True only for an operator-attested destination (a separate volume may be a partition of the same disk). */
  readonly offDevice: boolean;
  readonly artifacts: number;
  readonly verifiedAt: Timestamp;
}

/**
 * Creates a verified local generation (C1 path, recorded), seals it with its artifact objects into an
 * encrypted package, writes it to the destination, reads it back and opens it (the verification), and only
 * then records it. A failure leaves no record (and removes the partial package).
 */
export async function createPortableBackup(store: CompanyStore, options: { destination: BackupDestination; passphrase: string; runtimeVersion?: string }): Promise<PortableBackupResult> {
  const passphrase = assertPassphrase(options.passphrase);
  const failureDomain = options.destination.failureDomain(store.workspace.root);
  const started = Date.now();
  const local = await createBackup(store, options.runtimeVersion === undefined ? {} : { runtimeVersion: options.runtimeVersion });
  const snapshot = readFileSync(path.join(local.directory, 'company.sqlite3'));
  const manifestBytes = readFileSync(path.join(local.directory, 'manifest.json'));
  const artifacts = local.manifest.artifacts.entries.map((a) => {
    const object = containedPath(store.workspace.objectsDir, a.sha256.slice(0, 2), a.sha256.slice(2, 4), a.sha256);
    const bytes = readFileSync(object);
    if (sha256Hex(bytes) !== a.sha256) throw new QandeelError('BACKUP_INTEGRITY', 'an artifact object is corrupt; the package is not sealed', { artifactId: a.id });
    return { path: `artifacts/${a.sha256}`, bytes };
  });
  const ctx = storeContext(store);
  const rekey = ctx.db.snapshot(() => rekeyReferences(ctx));
  const notes = Buffer.from(`${JSON.stringify({ rekeyRequired: rekey, note: 'credential references only; secrets are never packaged' })}\n`, 'utf8');
  const unique = new Map(artifacts.map((a) => [a.path, a]));
  const payload = buildPayload([{ path: 'manifest.json', bytes: manifestBytes }, { path: 'company.sqlite3', bytes: snapshot }, { path: 'recovery-notes.json', bytes: notes }, ...unique.values()]);
  const packageId = newId();
  const { bytes, header } = sealPackage({ packageId, backupId: local.backupId, createdAt: store.now(), schemaVersion: local.manifest.schemaVersion }, payload, passphrase);
  const name = packageNameFor(header.createdAt, packageId);
  options.destination.put(name, bytes);
  try {
    const back = options.destination.get(name);
    if (sha256Hex(back) !== sha256Hex(bytes)) throw new QandeelError('BACKUP_INTEGRITY', 'the destination did not return the package that was written');
    openPackage(back, passphrase);
  } catch (error) {
    options.destination.remove(name);
    recordDrill(store, 'BACKUP_VERIFY', `backup:${local.backupId}`, 'FAIL', isQandeelError(error) ? error.code : 'ERROR', Date.now() - started);
    throw error;
  }
  const sha = sha256Hex(bytes);
  const verifiedAt = store.now();
  ctx.db.immediate('record portable backup', () => {
    ctx.db.run(
      `INSERT INTO portable_backups (id, backup_id, destination_kind, destination_ref, failure_domain, package_name, package_sha256, size_bytes, format, kdf_json, state, verified_at, retired_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, NULL, ?)`,
      packageId, local.backupId, options.destination.kind, options.destination.ref, failureDomain, name, sha, bytes.length, PORTABLE_FORMAT, JSON.stringify({ name: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p }), verifiedAt, header.createdAt,
    );
    appendAudit(ctx, 'backup.portable_created', 'portable_backup', packageId, { actorRef: 'system:resilience' }, 'OK', failureDomain, { backupId: local.backupId, sizeBytes: bytes.length, artifacts: unique.size });
  });
  recordDrill(store, 'BACKUP_VERIFY', `portable_backup:${packageId}`, 'PASS', 'PACKAGE_OPENED', Date.now() - started);
  return { packageId, backupId: local.backupId, name, packageSha256: sha, sizeBytes: bytes.length, failureDomain, offDevice: isOffDevice(failureDomain), artifacts: unique.size, verifiedAt };
}

/** Re-verifies a recorded package at its destination (checksum + authenticated open); records the drill. */
export function verifyPortableBackup(store: CompanyStore, packageId: Id, destination: BackupDestination, passphrase: string): { ok: boolean; code: string } {
  const ctx = storeContext(store);
  const row = ctx.db.get<{ package_name: string; package_sha256: string; state: string; destination_ref: string }>('SELECT package_name, package_sha256, state, destination_ref FROM portable_backups WHERE id = ?', packageId);
  if (!row) throw new QandeelError('NOT_FOUND', 'portable backup not found', { packageId });
  const started = Date.now();
  let code = 'PACKAGE_OPENED';
  try {
    if (row.destination_ref !== destination.ref) throw new QandeelError('BACKUP_INTEGRITY', 'this is not the destination the package was written to');
    const bytes = destination.get(row.package_name);
    if (sha256Hex(bytes) !== row.package_sha256) throw new QandeelError('BACKUP_INTEGRITY', 'package checksum does not match the record');
    openPackage(bytes, passphrase);
  } catch (error) {
    code = isQandeelError(error) ? error.code : 'ERROR';
  }
  const ok = code === 'PACKAGE_OPENED';
  if (ok) ctx.db.immediate('re-verify portable backup', () => ctx.db.run(`UPDATE portable_backups SET verified_at = ? WHERE id = ? AND state = 'VERIFIED'`, ts(ctx), packageId));
  recordDrill(store, 'BACKUP_VERIFY', `portable_backup:${packageId}`, ok ? 'PASS' : 'FAIL', code, Date.now() - started);
  return { ok, code };
}

/** Credential references a restored Company must re-key on the new device (references only, never secrets). */
function rekeyReferences(ctx: StoreContext): string[] {
  const refs = [
    ...ctx.db.all<{ r: string }>('SELECT DISTINCT credential_ref AS r FROM model_providers WHERE credential_ref IS NOT NULL'),
    ...ctx.db.all<{ r: string }>('SELECT DISTINCT credential_ref AS r FROM tools WHERE credential_ref IS NOT NULL'),
  ].map((x) => x.r);
  return [...new Set(refs)].sort();
}

export interface CleanRestoreReport {
  readonly backupId: Id;
  readonly packageId: Id;
  readonly workspace: string;
  readonly schemaVersionBefore: number;
  readonly schemaVersionAfter: number;
  readonly quickCheck: string;
  readonly artifactsRestored: number;
  readonly foundersSessionsRevoked: number;
  readonly rekeyRequired: readonly string[];
  /**
   * The authenticated package creation time (the backup point) and the age of the restored data at restore time: work
   * the lost device did after this point is not in the restored Company (m-25).
   */
  readonly backupPoint: { readonly packageCreatedAt: Timestamp; readonly dataAgeHours: number };
  /**
   * Work that must be reconciled before anything repeats. `jobsHeld` counts the jobs actually in RECONCILIATION_HOLD
   * after the restore; `heldJobIds` are the jobs THIS restore held because they could reach an external effect the lost
   * device may already have performed after the backup point (R2-29; IDs only, bounded list, `heldByRestore` the count).
   */
  readonly reconciliationPending: { readonly jobsHeld: number; readonly heldByRestore: number; readonly heldJobIds: readonly Id[]; readonly toolInvocationsUncertain: number };
  /** An older snapshot is restored at its own version and never migrated through plain open: run safe-upgrade (the runtime does it at start). */
  readonly schemaUpdateRequired: boolean;
  readonly durationMs: number;
  /**
   * The live restore attempt (FB-2) whose controlled restore made this target a Company, and how this call reached it:
   * NEW (fresh target), REDONE (an interrupted attempt of the same package was discarded and redone from the package),
   * DISCARDED_AND_RESTARTED (an explicitly discarded partial restore), FINALIZED (the attempt had already committed; this
   * call only verified it and lifted the marker — nothing was applied twice). `restoreRecord` names the history file.
   */
  readonly restoreAttemptId: Id;
  readonly restoreLifecycle: 'NEW' | 'REDONE' | 'DISCARDED_AND_RESTARTED' | 'FINALIZED';
  readonly restoreRecord: string;
}

/** Reason code of the holds a clean restore places (resolved through the existing reconciliation path, per job). */
export const RESTORE_HOLD_CODE = 'RESTORED_PAST_BACKUP_POINT';
const HELD_ID_LIST_BOUND = 1_000;

/**
 * Non-terminal jobs whose Work Item could reach an external effect (R2-29). "Could reach" is decided conservatively
 * from durable facts: an earlier run of the job declared UNSAFE side effects, or the Work Item's owner holds an ACTIVE
 * grant on a tool action that is UNSAFE or mutates external state (expiry and use limits deliberately ignored: if in
 * doubt, hold). Effect-free work (no such run, no such grant) is left to the ordinary startup recovery.
 */
function effectCapableLiveJobs(ctx: StoreContext): Id[] {
  return ctx.db
    .all<{ id: string }>(
      `SELECT j.id FROM queue_jobs j JOIN work_items w ON w.id = j.work_item_id
        WHERE j.state IN ('QUEUED', 'WAITING', 'CLAIMED')
          AND (EXISTS (SELECT 1 FROM runs r WHERE r.job_id = j.id AND r.side_effects = 'UNSAFE')
            OR (w.owner_ref GLOB 'employee:*' AND EXISTS (
                  SELECT 1 FROM permission_grants g JOIN tool_actions a JOIN tools t ON t.id = a.tool_id
                   WHERE g.employee_id = substr(w.owner_ref, 10) AND g.status = 'ACTIVE'
                     AND g.capability = 'tool:' || t.code || '.' || a.code
                     AND (a.side_effects = 'UNSAFE' OR a.mutates_external = 1))))
        ORDER BY j.id`,
    )
    .map((r) => r.id as Id);
}

/**
 * Clean-environment (device-loss) recovery into a NEW, empty workspace: authenticate + decrypt, verify the
 * snapshot against this release (schema, pins, fingerprint, counts), restore the database and artifact objects,
 * open it AT ITS OWN VERSION (an older compatible snapshot is never migrated forward through plain open — the report
 * says `schemaUpdateRequired` and safe-upgrade does it; a newer one is refused), integrity-check, revoke the lost
 * device's Founder sessions, hold for reconciliation every non-terminal job that could reach an external effect (the
 * lost device may have performed it after the backup point, R2-29) and report the credential references to re-key.
 * It never starts the runtime: the operator starts it, and its startup recovery reconciles in-flight work.
 */
export function restorePortableBackup(packageBytes: Buffer, targetRoot: string, options: RestorePortableOptions): CleanRestoreReport {
  return restorePortableBackupInternal(packageBytes, targetRoot, options, {});
}

export interface RestorePortableOptions {
  readonly passphrase: string;
  readonly clock?: Clock;
  /**
   * Explicitly discard a partial live restore of ANOTHER package on this target (or a restore marker that cannot be
   * read) and restart with this package. Never needed to resume the same package.
   */
  readonly discardPartialRestore?: boolean;
}

/** Named crash points of the live restore lifecycle (tests inject a real process exit or a throw). */
export type RestoreFaultPoint = 'before-db-copy' | 'mid-db-copy' | 'after-db-copy' | 'mid-artifacts' | 'before-controlled-restore' | 'in-controlled-restore' | 'after-commit' | 'after-phase-committed';

/** Storage-internal (not exported by the package entry point): failure injection for the crash-atomicity proofs. */
export interface RestoreInternals {
  readonly fault?: (point: RestoreFaultPoint) => void;
}

type PriorRestore = { readonly kind: 'NONE' } | { readonly kind: 'MARKER'; readonly marker: RestoreMarker } | { readonly kind: 'UNREADABLE_MARKER' };

/**
 * FB-2: what already occupies a live restore target. A target is acceptable when it is new, empty, or holds a live
 * restore in progress (RESTORE_IN_PROGRESS); a marker that cannot be read is acceptable only with an explicit discard
 * (an unparseable hold file only when it is the ONLY thing on the target: a torn first marker write, before any byte).
 * Anything else — a Company, a verification copy, an update hold, stray files — is refused.
 */
function priorRestoreOn(root: string, discard: boolean): PriorRestore {
  if (!existsSync(root) || readdirSync(root).length === 0) return { kind: 'NONE' };
  const hold = readUpdateHold(root);
  if (hold?.code === RESTORE_IN_PROGRESS) {
    try {
      const marker = readRestoreMarker(root);
      if (marker !== null) return { kind: 'MARKER', marker };
    } catch (error) {
      if (!(discard && isQandeelError(error, 'UPDATE_HOLD') && error.details.reason === 'RESTORE_MARKER_UNREADABLE')) throw error;
      return { kind: 'UNREADABLE_MARKER' };
    }
  }
  if (discard && hold?.code === 'HOLD_FILE_UNREADABLE' && onlyFileIs(root, path.join(maintenanceDir(root), HOLD_FILE))) return { kind: 'UNREADABLE_MARKER' };
  throw new QandeelError('UNSAFE_WORKSPACE', 'a clean restore target must be a new or empty directory, or hold a live restore in progress', { reason: 'not-empty' });
}

/** True when `only` is the one file under `root` (empty directories aside) and nothing is a link: nothing else to lose. */
function onlyFileIs(root: string, only: string): boolean {
  const files: string[] = [];
  const walk = (p: string): boolean => {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) return false;
    if (!st.isDirectory()) {
      files.push(p);
      return true;
    }
    return readdirSync(p).every((child) => walk(path.join(p, child)));
  };
  return walk(root) && files.length === 1 && path.resolve(files[0] ?? '') === path.resolve(only);
}

/**
 * Removes a restore attempt's partial bytes (everything except the maintenance directory that holds the marker). Never
 * trusted, never reused: a redo rewrites everything from the authenticated package. `unlinkSync` / `rmdirSync`, not
 * `rmSync` (D-R2-08: on Windows, Node 24 `rmSync` of a locked file under a non-ASCII path terminates the process).
 */
function discardPartialFiles(root: string): void {
  const removeTree = (p: string): void => {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new QandeelError('UNSAFE_WORKSPACE', 'a restore target never contains links', { reason: 'not-a-plain-directory' });
    if (st.isDirectory()) {
      for (const child of readdirSync(p)) removeTree(path.join(p, child));
      rmdirSync(p);
    } else {
      unlinkSync(p);
    }
  };
  for (const name of readdirSync(root)) if (name !== 'maintenance') removeTree(path.join(root, name));
  fsyncDirectory(root);
}

const WRITE_CHUNK = 64 * 1024;

/** Exclusive create, chunked write, fsync. `afterFirstChunk` is a crash point while the file is still partial. */
function writeNewFileDurably(file: string, bytes: Buffer, afterFirstChunk?: () => void): void {
  const fd = openSync(file, 'wx');
  try {
    let offset = 0;
    let hook = afterFirstChunk;
    while (offset < bytes.length) {
      offset += writeSync(fd, bytes, offset, Math.min(WRITE_CHUNK, bytes.length - offset));
      if (hook !== undefined && offset < bytes.length) {
        hook();
        hook = undefined;
      }
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Every artifact object of the package is on the target and its content matches its name (C4). */
function verifyRestoredArtifacts(objectsDir: string, entries: ReadonlyMap<string, Buffer>): number {
  let n = 0;
  for (const p of entries.keys()) {
    if (!p.startsWith('artifacts/')) continue;
    const sha = p.slice('artifacts/'.length);
    const file = containedPath(objectsDir, sha.slice(0, 2), sha.slice(2, 4), sha);
    if (!existsSync(file) || sha256Hex(readFileSync(file)) !== sha) throw new QandeelError('BACKUP_INTEGRITY', 'a restored artifact object is missing or does not match its name');
    n++;
  }
  return n;
}

const nowIso = (clock: Clock | undefined): string => new Date(clock ? clock.nowMs() : Date.now()).toISOString();

/**
 * C5 / C6: a restore attempt of this same package whose controlled restore already COMMITTED (its `recovery.clean_restore`
 * audit row carries the attempt id) is only verified and finalized — nothing is applied twice. Returns null when the
 * attempt did not commit, or when its bytes cannot be proven good (integrity, foreign keys, artifacts): such an attempt
 * is redone from the package, never trusted. A database that cannot even be opened is exactly such a case (a partial
 * copy), so its open failure means "not committed"; hold / binding / invariant refusals still propagate.
 */
function finalizeCommittedAttempt(root: string, marker: RestoreMarker, header: PackageHeader, entries: ReadonlyMap<string, Buffer>, clock: Clock | undefined, started: number): CleanRestoreReport | null {
  const bound: RestoreBinding = { attemptId: marker.attemptId, packageId: marker.packageId };
  if (!existsSync(layoutFor(root).databasePath)) return null;
  let report: Omit<CleanRestoreReport, 'restoreRecord'>;
  try {
    const store = openRestoredStore(root, { ...(clock ? { clock } : {}), atVersion: marker.sourceSchemaVersion, restoreAttempt: bound });
    try {
      const ctx = storeContext(store);
      const rows = ctx.db.all<{ details_json: string }>(`SELECT details_json FROM audit_events WHERE action = 'recovery.clean_restore' AND correlation_id = ?`, marker.attemptId);
      const quick = rows.length === 1 ? store.quickCheck() : 'not-committed';
      if (rows.length !== 1 || quick !== 'ok' || store.foreignKeyViolations() !== 0) return null;
      const artifacts = verifyRestoredArtifacts(store.workspace.objectsDir, entries);
      const d = JSON.parse(String(rows[0]?.details_json ?? '{}')) as { sessionsRevoked?: number; jobsHeldByRestore?: number; dataAgeHours?: number };
      const held = ctx.db.all<{ id: string }>(`SELECT id FROM queue_jobs WHERE state = 'RECONCILIATION_HOLD' AND last_failure_code = ? ORDER BY id`, RESTORE_HOLD_CODE).map((r) => r.id as Id);
      const notes = entries.has('recovery-notes.json') ? (JSON.parse(entry(entries, 'recovery-notes.json').toString('utf8')) as { rekeyRequired?: string[] }) : {};
      report = {
        backupId: header.backupId,
        packageId: header.packageId,
        workspace: store.workspace.root,
        schemaVersionBefore: marker.sourceSchemaVersion,
        schemaVersionAfter: store.schemaVersion,
        quickCheck: quick,
        artifactsRestored: artifacts,
        foundersSessionsRevoked: Number(d.sessionsRevoked ?? 0),
        rekeyRequired: notes.rekeyRequired ?? rekeyReferences(ctx),
        backupPoint: { packageCreatedAt: header.createdAt, dataAgeHours: Number(d.dataAgeHours ?? 0) },
        reconciliationPending: {
          jobsHeld: Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM queue_jobs WHERE state = 'RECONCILIATION_HOLD'`)?.n ?? 0),
          heldByRestore: Number(d.jobsHeldByRestore ?? held.length),
          heldJobIds: held.slice(0, HELD_ID_LIST_BOUND),
          toolInvocationsUncertain: Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM tool_invocations WHERE state IN ('INTENT_RECORDED', 'RECONCILIATION_REQUIRED')`)?.n ?? 0),
        },
        schemaUpdateRequired: store.schemaVersion < CURRENT_SCHEMA_VERSION,
        durationMs: Date.now() - started,
        restoreAttemptId: marker.attemptId,
        restoreLifecycle: 'FINALIZED',
      };
    } finally {
      store.close();
    }
  } catch (error) {
    if (isQandeelError(error, 'UPDATE_HOLD') || isQandeelError(error, 'STORAGE_INVARIANT')) throw error;
    return null;
  }
  if (marker.phase !== 'COMMITTED') replaceRestoreMarker(root, bound, { ...marker, phase: 'COMMITTED', phaseAt: nowIso(clock) });
  return { ...report, restoreRecord: completeRestoreMarker(root, bound) };
}

/**
 * The live restore lifecycle (FB-2): "a restore is blocked until it is fully safe to become a Company".
 *   1. The package is authenticated and its snapshot verified in a scratch directory; nothing touches the target yet.
 *   2. C1: a RESTORE_IN_PROGRESS marker (attempt id, package id, backup id, source schema, start, phase) is created
 *      exclusively and made durable BEFORE any database or artifact byte; from here every ordinary open refuses the target.
 *   3. Database and artifacts are written (exclusive create, fsync) and verified; phase DATA_WRITTEN.
 *   4. C3 / C4: the lifecycle opens the target bound to its attempt + package, checks integrity and foreign keys, and one
 *      transaction revokes the lost device's sessions and launch tokens, holds effect-capable live jobs and records the
 *      drill and the `recovery.clean_restore` audit row carrying the attempt id. The marker stays through the commit.
 *   5. C5: after the store is closed the phase becomes COMMITTED and the marker is atomically renamed to
 *      `RESTORE_IN_PROGRESS.completed-<attempt>.json` — the only lift.
 * C6: a crash at any point leaves the target held. Calling this again with the SAME package resumes: a committed attempt
 * is only finalized; any other is redone from the package under a new attempt id (its partial bytes discarded, its
 * marker kept as history). A DIFFERENT package is refused unless `discardPartialRestore` is set. A thrown failure is
 * treated exactly like a crash: the target stays held, never half-restored and startable.
 */
export function restorePortableBackupInternal(packageBytes: Buffer, targetRoot: string, options: RestorePortableOptions, internals: RestoreInternals): CleanRestoreReport {
  const started = Date.now();
  const fault = internals.fault ?? ((): void => undefined);
  assertWorkspaceLocation(targetRoot);
  const root = path.resolve(targetRoot);
  const discard = options.discardPartialRestore === true;
  const prior = priorRestoreOn(root, discard);
  const { header, entries } = openPackage(packageBytes, options.passphrase);
  const stage = mkdtempSync(path.join(tmpdir(), 'qc-restore-'));
  try {
    const dir = path.join(stage, header.backupId);
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'manifest.json'), entry(entries, 'manifest.json'), { flag: 'wx' });
    writeFileSync(path.join(dir, 'company.sqlite3'), entry(entries, 'company.sqlite3'), { flag: 'wx' });
    const verification = verifyBackup(dir);

    let lifecycle: CleanRestoreReport['restoreLifecycle'] = 'NEW';
    if (prior.kind === 'MARKER') {
      const m = prior.marker;
      if (m.packageId === header.packageId) {
        if (m.backupId !== header.backupId || m.sourceSchemaVersion !== verification.schemaVersion) throw new QandeelError('BACKUP_INTEGRITY', 'the package does not match the live restore marker that names it');
        const finalized = finalizeCommittedAttempt(root, m, header, entries, options.clock, started);
        if (finalized !== null) return finalized;
        lifecycle = 'REDONE';
      } else if (options.discardPartialRestore !== true) {
        throw new QandeelError('UNSAFE_WORKSPACE', 'a live restore of another package is in progress on this target; resume it with that package, or discard it explicitly (--discard-partial-restore)', { reason: 'restore-in-progress-other-package' });
      } else {
        lifecycle = 'DISCARDED_AND_RESTARTED';
      }
    } else if (prior.kind === 'UNREADABLE_MARKER') {
      lifecycle = 'DISCARDED_AND_RESTARTED';
    }

    const attemptId = newId();
    const startedAt = nowIso(options.clock);
    const marker: RestoreMarker = { attemptId, packageId: header.packageId, backupId: header.backupId, sourceSchemaVersion: verification.schemaVersion, startedAt, phase: 'PREPARING', phaseAt: startedAt, restartOf: prior.kind === 'MARKER' ? prior.marker.attemptId : null };
    const binding: RestoreBinding = { attemptId, packageId: header.packageId };
    // The marker's only lift (C5), called once the controlled restore has committed and its store is closed.
    const finish = (): string => {
      replaceRestoreMarker(root, binding, { ...marker, phase: 'COMMITTED', phaseAt: nowIso(options.clock) });
      fault('after-phase-committed');
      return completeRestoreMarker(root, binding);
    };
    if (prior.kind === 'NONE') {
      // C1: the target is fail-closed BEFORE its first database or artifact byte.
      beginRestoreMarker(root, marker);
    } else if (prior.kind === 'MARKER') {
      // The interrupted attempt stays as history; the hold is replaced atomically (it exists at every instant), and only
      // then are its partial bytes discarded.
      archiveRestoreMarker(root, prior.marker, prior.marker.packageId === header.packageId ? 'abandoned' : 'discarded');
      replaceRestoreMarker(root, { attemptId: prior.marker.attemptId, packageId: prior.marker.packageId }, marker);
      discardPartialFiles(root);
    } else {
      replaceUnreadableRestoreHold(root, marker);
      discardPartialFiles(root);
    }
    fault('before-db-copy');

    const layout = openWorkspace(root, { create: true });
    writeNewFileDurably(layout.databasePath, entry(entries, 'company.sqlite3'), () => fault('mid-db-copy'));
    fsyncDirectory(layout.stateDir);
    fault('after-db-copy');
    const objectDirs = new Set<string>();
    let written = 0;
    for (const [p, bytes] of entries) {
      if (!p.startsWith('artifacts/')) continue;
      const sha = p.slice('artifacts/'.length);
      const dest = containedPath(layout.objectsDir, sha.slice(0, 2), sha.slice(2, 4), sha);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeNewFileDurably(dest, bytes);
      objectDirs.add(path.dirname(dest));
      if (++written === 1) fault('mid-artifacts');
    }
    for (const d of objectDirs) fsyncDirectory(d);
    const restoredArtifacts = verifyRestoredArtifacts(layout.objectsDir, entries);
    replaceRestoreMarker(root, binding, { ...marker, phase: 'DATA_WRITTEN', phaseAt: nowIso(options.clock) });

    // C3: opened only by this attempt (bound to the marker's attempt and package), at the snapshot's own version: plain
    // open never migrates an older snapshot forward (R2-30 / m-25).
    let report: Omit<CleanRestoreReport, 'restoreRecord'>;
    const restored = openRestoredStore(root, { ...(options.clock ? { clock: options.clock } : {}), atVersion: verification.schemaVersion, restoreAttempt: binding });
    try {
      const quick = restored.quickCheck();
      if (quick !== 'ok' || restored.foreignKeyViolations() !== 0) throw new QandeelError('BACKUP_INTEGRITY', 'restored workspace failed its integrity checks', { backupId: header.backupId });
      const ctx = storeContext(restored);
      const notes = entries.has('recovery-notes.json') ? (JSON.parse(entry(entries, 'recovery-notes.json').toString('utf8')) as { rekeyRequired?: string[] }) : {};
      fault('before-controlled-restore');
      const out = ctx.db.immediate('controlled restore', () => {
        const at = ts(ctx);
        // The lost device's browser sessions and launch tokens never come back (D15-B.6: credentials not blindly reused).
        const revoked = ctx.db.run(`UPDATE founder_sessions SET revoked_at = ?, revoke_reason = 'RESTORED_ON_NEW_DEVICE' WHERE revoked_at IS NULL`, at).changes;
        ctx.db.run(`UPDATE founder_launch_tokens SET consumed_at = ? WHERE consumed_at IS NULL`, at);
        // A restore is an ambiguity boundary (R2-29): the lost device may have executed, after the backup point, work this
        // snapshot still shows as queued / waiting / claimed. Anything that could reach an external effect is held for
        // reconciliation (never dispatched blindly), in this same transaction.
        const held = effectCapableLiveJobs(ctx).filter((jobId) => txHoldForReconciliation(ctx, jobId, RESTORE_HOLD_CODE));
        const jobsHeld = Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM queue_jobs WHERE state = 'RECONCILIATION_HOLD'`)?.n ?? 0);
        const uncertain = Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM tool_invocations WHERE state IN ('INTENT_RECORDED', 'RECONCILIATION_REQUIRED')`)?.n ?? 0);
        const dataAgeHours = Math.max(0, Math.floor((Date.parse(at) - Date.parse(header.createdAt)) / 3_600_000));
        const durationMs = Date.now() - started;
        ctx.db.run(`INSERT INTO recovery_drills (id, kind, subject_ref, result, code, duration_ms, actor_ref, created_at) VALUES (?, 'PORTABLE_RESTORE', ?, 'PASS', 'CLEAN_RESTORE', ?, 'system:resilience', ?)`, newId(), `portable_backup:${header.packageId}`, durationMs, at);
        // The attempt id is the audit row's correlation id: a resumed call recognises a committed attempt by it (C5).
        appendAudit(ctx, 'recovery.clean_restore', 'backup', header.backupId, { actorRef: 'system:resilience', correlationId: attemptId }, 'OK', 'CLEAN_RESTORE', { packageId: header.packageId, restoreAttemptId: attemptId, sessionsRevoked: revoked, artifacts: restoredArtifacts, jobsHeldByRestore: held.length, dataAgeHours });
        fault('in-controlled-restore');
        return { revoked, held, jobsHeld, uncertain, dataAgeHours, durationMs };
      });
      report = {
        backupId: header.backupId,
        packageId: header.packageId,
        workspace: layout.root,
        schemaVersionBefore: verification.schemaVersion,
        schemaVersionAfter: restored.schemaVersion,
        quickCheck: quick,
        artifactsRestored: restoredArtifacts,
        foundersSessionsRevoked: out.revoked,
        rekeyRequired: notes.rekeyRequired ?? rekeyReferences(ctx),
        backupPoint: { packageCreatedAt: header.createdAt, dataAgeHours: out.dataAgeHours },
        reconciliationPending: { jobsHeld: out.jobsHeld, heldByRestore: out.held.length, heldJobIds: out.held.slice(0, HELD_ID_LIST_BOUND), toolInvocationsUncertain: out.uncertain },
        schemaUpdateRequired: restored.schemaVersion < CURRENT_SCHEMA_VERSION,
        durationMs: out.durationMs,
        restoreAttemptId: attemptId,
        restoreLifecycle: lifecycle,
      };
    } finally {
      restored.close();
    }
    // C5: only after the commit and the store's close is the marker lifted (phase COMMITTED, then the atomic rename).
    fault('after-commit');
    const history = finish();
    return { ...report, restoreRecord: history };
  } finally {
    rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Restore drills.

function recordDrill(store: CompanyStore, kind: 'BACKUP_VERIFY' | 'ISOLATED_RESTORE' | 'PORTABLE_RESTORE', subjectRef: string, result: 'PASS' | 'FAIL', code: string, durationMs: number): void {
  const ctx = storeContext(store);
  ctx.db.immediate('record restore drill', () => {
    const id = newId();
    ctx.db.run(`INSERT INTO recovery_drills (id, kind, subject_ref, result, code, duration_ms, actor_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, 'system:resilience', ?)`, id, kind, subjectRef, result, code.slice(0, 64), Math.max(0, Math.round(durationMs)), ts(ctx));
    appendAudit(ctx, 'recovery.drill', 'recovery_drill', id, { actorRef: 'system:resilience' }, result === 'PASS' ? 'OK' : 'ERROR', code.slice(0, 64), { kind, durationMs: Math.max(0, Math.round(durationMs)) });
  });
}

/** An isolated restore drill of a recorded generation (Validate → Restore isolated → Dry start → Compare). */
export function runRestoreDrill(store: CompanyStore, options: { backupId?: Id } = {}): { result: 'PASS' | 'FAIL'; code: string; durationMs: number; backupId: Id | null } {
  const ctx = storeContext(store);
  const backupId = options.backupId ?? (ctx.db.get<{ id: string }>(`SELECT id FROM backup_records WHERE integrity_result = 'ok' AND id NOT IN (SELECT backup_id FROM backup_retirements) ORDER BY created_at DESC, rowid DESC LIMIT 1`)?.id as Id | undefined) ?? null;
  const started = Date.now();
  if (backupId === null) {
    recordDrill(store, 'ISOLATED_RESTORE', 'backup:none', 'FAIL', 'NO_BACKUP', 0);
    return { result: 'FAIL', code: 'NO_BACKUP', durationMs: 0, backupId: null };
  }
  const expected = store.backupRecord(backupId);
  const scratch = mkdtempSync(path.join(tmpdir(), 'qc-drill-'));
  let code = 'RESTORED_AND_VERIFIED';
  try {
    restoreToIsolatedWorkspace(path.join(store.workspace.backupsDir, backupId), path.join(scratch, 'ws'), { liveDatabasePath: store.workspace.databasePath, ...(expected ? { expected } : {}) });
  } catch (error) {
    code = isQandeelError(error) ? error.code : 'ERROR';
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  const durationMs = Date.now() - started;
  const result = code === 'RESTORED_AND_VERIFIED' ? 'PASS' : 'FAIL';
  recordDrill(store, 'ISOLATED_RESTORE', `backup:${backupId}`, result, code, durationMs);
  return { result, code, durationMs, backupId };
}

// ---------------------------------------------------------------------------------------------------------
// Generational retention (D15-B.2).

export interface RetentionPolicy {
  readonly keepLast: number;
  readonly daily: number;
  readonly weekly: number;
  readonly monthly: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = Object.freeze({ keepLast: 3, daily: 7, weekly: 4, monthly: 6 });

export interface Generation {
  readonly id: string;
  readonly createdAt: string;
}

const isoWeek = (d: Date): string => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${w}`;
};

/**
 * Grandfather-father-son planning: keep the newest `keepLast`, the newest generation of each of the last
 * `daily` days, `weekly` ISO weeks and `monthly` months. The newest generation is always kept. Pure.
 */
export function planRetention(generations: readonly Generation[], policy: RetentionPolicy = DEFAULT_RETENTION): { keep: string[]; prune: string[] } {
  for (const k of ['keepLast', 'daily', 'weekly', 'monthly'] as const) if (!Number.isInteger(policy[k]) || policy[k] < 0 || policy[k] > 1000) throw new QandeelError('VALIDATION_FAILED', 'retention policy is bounded', { field: k });
  if (policy.keepLast < 1) throw new QandeelError('VALIDATION_FAILED', 'retention keeps at least the newest generation', { field: 'keepLast' });
  const ordered = [...generations].sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : a.id > b.id ? -1 : 1));
  const keep = new Set(ordered.slice(0, policy.keepLast).map((g) => g.id));
  const bucket = (limit: number, key: (d: Date) => string): void => {
    const seen = new Set<string>();
    for (const g of ordered) {
      const k = key(new Date(g.createdAt));
      if (seen.has(k)) continue;
      if (seen.size >= limit) break;
      seen.add(k);
      keep.add(g.id);
    }
  };
  bucket(policy.daily, (d) => d.toISOString().slice(0, 10));
  bucket(policy.weekly, isoWeek);
  bucket(policy.monthly, (d) => d.toISOString().slice(0, 7));
  return { keep: ordered.filter((g) => keep.has(g.id)).map((g) => g.id), prune: ordered.filter((g) => !keep.has(g.id)).map((g) => g.id) };
}

/**
 * A restorable local generation (m-23): recorded (the record is canonical, D-C1-24), integrity ok, not retired — AND
 * its manifest is present in this workspace. Discovery stays record-first; the file check only removes records whose
 * material is gone (e.g. every earlier generation after a clean restore onto a new device).
 */
function liveLocalRecords(ctx: StoreContext): { id: string; created_at: string }[] {
  return ctx.db.all<{ id: string; created_at: string }>(`SELECT id, created_at FROM backup_records WHERE integrity_result = 'ok' AND id NOT IN (SELECT backup_id FROM backup_retirements) ORDER BY created_at DESC, rowid DESC`);
}

const hasBackupFiles = (backupsDir: string, id: string): boolean => /^[0-9a-f-]{36}$/.test(id) && existsSync(path.join(backupsDir, id, 'manifest.json'));

/** Retires local generations the policy no longer keeps: record first (the database keeps one live), then files. */
export function pruneLocalBackups(store: CompanyStore, policy: RetentionPolicy = DEFAULT_RETENTION): { kept: string[]; retired: string[] } {
  const ctx = storeContext(store);
  // Plan over RESTORABLE generations only: a record without files is never "kept" in place of a restorable one (m-23).
  const live = ctx.db.snapshot(() => liveLocalRecords(ctx)).filter((g) => hasBackupFiles(store.workspace.backupsDir, g.id));
  const plan = planRetention(live.map((g) => ({ id: g.id, createdAt: g.created_at })), policy);
  ctx.db.immediate('retire backup generations', () => {
    for (const id of plan.prune) {
      ctx.db.run(`INSERT INTO backup_retirements (backup_id, reason_code, policy_json, actor_ref, retired_at) VALUES (?, 'RETENTION_POLICY', ?, 'system:resilience', ?)`, id, JSON.stringify(policy), ts(ctx));
      appendAudit(ctx, 'backup.retired', 'backup', id, { actorRef: 'system:resilience' }, 'OK', 'RETENTION_POLICY', {});
    }
  });
  for (const id of plan.prune) rmSync(containedPath(store.workspace.backupsDir, id), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  return { kept: plan.keep, retired: plan.prune };
}

/** Retires portable packages the policy no longer keeps (record first; the database keeps one verified). */
export function prunePortableBackups(store: CompanyStore, destination: BackupDestination, policy: RetentionPolicy = DEFAULT_RETENTION): { kept: string[]; retired: string[] } {
  const ctx = storeContext(store);
  const live = ctx.db.snapshot(() => ctx.db.all<{ id: string; created_at: string; package_name: string }>(`SELECT id, created_at, package_name FROM portable_backups WHERE state = 'VERIFIED' AND destination_ref = ?`, destination.ref));
  const plan = planRetention(live.map((g) => ({ id: g.id, createdAt: g.created_at })), policy);
  ctx.db.immediate('retire portable packages', () => {
    for (const id of plan.prune) {
      ctx.db.run(`UPDATE portable_backups SET state = 'RETIRED', retired_at = ? WHERE id = ?`, ts(ctx), id);
      appendAudit(ctx, 'backup.portable_retired', 'portable_backup', id, { actorRef: 'system:resilience' }, 'OK', 'RETENTION_POLICY', {});
    }
  });
  for (const id of plan.prune) {
    const name = live.find((g) => g.id === id)?.package_name;
    if (name !== undefined) destination.remove(name);
  }
  return { kept: plan.keep, retired: plan.prune };
}

// ---------------------------------------------------------------------------------------------------------
// Recovery health facts (D15 handoff to Stage 17: freshness, verification, drills, reconciliation burden).

export interface ResilienceStatus {
  readonly objectives: readonly RecoveryObjective[];
  readonly localBackup: { readonly id: string; readonly at: string; readonly ageHours: number; readonly withinRpo: boolean; readonly liveGenerations: number } | null;
  readonly portableBackup: { readonly id: string; readonly createdAt: string; readonly verifiedAt: string; readonly ageHours: number; readonly failureDomain: FailureDomain; readonly offDevice: boolean; readonly withinOffDeviceRpo: boolean; readonly liveGenerations: number } | null;
  readonly lastDrills: readonly { readonly kind: string; readonly id: string; readonly result: string; readonly code: string; readonly durationMs: number; readonly at: string }[];
  readonly reconciliationBurden: { readonly jobsHeld: number; readonly deadLetters: number; readonly toolInvocationsUncertain: number };
  readonly lastMaintenance: { readonly id: string; readonly outcome: string; readonly fromVersion: number; readonly toVersion: number; readonly at: string } | null;
  readonly exceptions: readonly { readonly code: string; readonly ref: string; readonly material: boolean; readonly at: string }[];
}

/**
 * `files.backupsDir` (given by `resilienceStatus`): the local recovery point is the newest RESTORABLE generation (its
 * files present), and a live record whose files are gone raises BACKUP_FILES_MISSING (m-23). Without it (callers that
 * hold only a transaction context) the status is record-based.
 */
export function txResilienceStatus(ctx: StoreContext, now: string, files?: { readonly backupsDir: string }): ResilienceStatus {
  const hours = (at: string): number => Math.max(0, Math.floor((Date.parse(now) - Date.parse(at)) / 3_600_000));
  const obj = critical();
  const records = liveLocalRecords(ctx);
  const restorable = files === undefined ? records : records.filter((g) => hasBackupFiles(files.backupsDir, g.id));
  const missingFiles = records.filter((g) => !restorable.includes(g));
  const local = restorable[0];
  const liveLocal = restorable.length;
  // The recovery point is the age of the data in the package (created_at); re-verifying an old package never makes it fresh.
  // Only an operator-attested destination is off-device (R2-28): prefer the newest ATTESTED package, else the newest at all.
  const portable = ctx.db.get<{ id: string; verified_at: string; created_at: string; failure_domain: string }>(`SELECT id, verified_at, created_at, failure_domain FROM portable_backups WHERE state = 'VERIFIED' AND failure_domain = 'ATTESTED_OFF_DEVICE' ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    ?? ctx.db.get<{ id: string; verified_at: string; created_at: string; failure_domain: string }>(`SELECT id, verified_at, created_at, failure_domain FROM portable_backups WHERE state = 'VERIFIED' ORDER BY created_at DESC, rowid DESC LIMIT 1`);
  const livePortable = Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM portable_backups WHERE state = 'VERIFIED'`)?.n ?? 0);
  const drills = ctx.db.all<{ id: string; kind: string; result: string; code: string; duration_ms: number; created_at: string }>(
    `SELECT d.id, d.kind, d.result, d.code, d.duration_ms, d.created_at FROM recovery_drills d WHERE d.id = (SELECT x.id FROM recovery_drills x WHERE x.kind = d.kind ORDER BY x.created_at DESC, x.rowid DESC LIMIT 1) ORDER BY d.kind`,
  );
  const n = (sql: string): number => Number(ctx.db.get<{ n: number }>(sql)?.n ?? 0);
  const burden = { jobsHeld: n(`SELECT COUNT(*) AS n FROM queue_jobs WHERE state = 'RECONCILIATION_HOLD'`), deadLetters: n(`SELECT COUNT(*) AS n FROM queue_jobs WHERE state = 'DEAD_LETTER'`), toolInvocationsUncertain: n(`SELECT COUNT(*) AS n FROM tool_invocations WHERE state = 'RECONCILIATION_REQUIRED'`) };
  const maint = ctx.db.get<{ id: string; outcome: string; from_version: number; to_version: number; finished_at: string }>('SELECT id, outcome, from_version, to_version, finished_at FROM maintenance_records ORDER BY finished_at DESC, rowid DESC LIMIT 1');
  const exceptions: { code: string; ref: string; material: boolean; at: string }[] = [];
  const localStatus = local ? { id: local.id, at: local.created_at, ageHours: hours(local.created_at), withinRpo: hours(local.created_at) <= (obj.localRpoHours ?? Infinity), liveGenerations: liveLocal } : null;
  if (localStatus === null) exceptions.push({ code: 'NO_VERIFIED_BACKUP', ref: 'backups:none', material: false, at: now });
  else if (!localStatus.withinRpo) exceptions.push({ code: 'BACKUP_STALE', ref: `backup:${localStatus.id}`, material: false, at: localStatus.at });
  const newestMissing = missingFiles[0];
  if (newestMissing !== undefined) exceptions.push({ code: 'BACKUP_FILES_MISSING', ref: `backup:${newestMissing.id}`, material: false, at: newestMissing.created_at });
  const offDevice = portable !== undefined && isOffDevice(portable.failure_domain);
  const portableStatus = portable
    ? { id: portable.id, createdAt: portable.created_at, verifiedAt: portable.verified_at, ageHours: hours(portable.created_at), failureDomain: portable.failure_domain as FailureDomain, offDevice, withinOffDeviceRpo: offDevice && hours(portable.created_at) <= (obj.offDeviceRpoHours ?? Infinity), liveGenerations: livePortable }
    : null;
  if (portableStatus === null) exceptions.push({ code: 'NO_OFF_DEVICE_BACKUP', ref: 'portable_backups:none', material: false, at: now });
  else if (!portableStatus.offDevice) exceptions.push({ code: 'OFF_DEVICE_NOT_PROVEN', ref: `portable_backup:${portableStatus.id}`, material: true, at: portableStatus.verifiedAt });
  else if (!portableStatus.withinOffDeviceRpo) exceptions.push({ code: 'OFF_DEVICE_BACKUP_STALE', ref: `portable_backup:${portableStatus.id}`, material: true, at: portableStatus.createdAt });
  for (const d of drills) if (d.result === 'FAIL') exceptions.push({ code: 'RESTORE_DRILL_FAILED', ref: `recovery_drill:${d.id}`, material: true, at: d.created_at });
  if (burden.jobsHeld + burden.toolInvocationsUncertain > 0) exceptions.push({ code: 'RECONCILIATION_PENDING', ref: 'queue:reconciliation', material: false, at: now });
  if (maint?.outcome === 'ROLLED_BACK_UPDATE_HOLD') exceptions.push({ code: 'UPDATE_ROLLED_BACK', ref: `maintenance:${maint.id}`, material: true, at: maint.finished_at });
  return {
    objectives: RECOVERY_OBJECTIVES,
    localBackup: localStatus,
    portableBackup: portableStatus,
    lastDrills: drills.map((d) => ({ kind: d.kind, id: d.id, result: d.result, code: d.code, durationMs: Number(d.duration_ms), at: d.created_at })),
    reconciliationBurden: burden,
    lastMaintenance: maint ? { id: maint.id, outcome: maint.outcome, fromVersion: Number(maint.from_version), toVersion: Number(maint.to_version), at: maint.finished_at } : null,
    exceptions,
  };
}

export function resilienceStatus(store: CompanyStore, options: { at?: string } = {}): ResilienceStatus {
  const ctx = storeContext(store);
  return ctx.db.snapshot(() => txResilienceStatus(ctx, options.at ?? ts(ctx), { backupsDir: store.workspace.backupsDir }));
}

