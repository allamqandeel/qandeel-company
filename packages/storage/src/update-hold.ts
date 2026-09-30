/**
 * UPDATE_HOLD (Stage 15 D15-D.5): after a failed update the workspace is held, and every store open refuses it
 * until the operator clears the hold — a failed migration is never retried in a startup loop. The hold is a
 * file (a failed update may leave no database to write into). Kept free of store imports (no module cycle).
 *
 * The same file carries two permanent-until-lifecycle holds that the operator can never clear:
 * - RESTORE_CHECK_COPY (RR4-1): an isolated restore-check target is a verification copy, never a Company.
 * - RESTORE_IN_PROGRESS (FB-2): a LIVE portable restore target is fail-closed from its first byte until the controlled
 *   restore has committed. The marker is written (exclusive create, fsync, directory fsync) before any database or
 *   artifact byte, every open refuses it — read-only verify-mode inspection included, because the database under it may
 *   be partial — and only the restore lifecycle that owns the attempt (bound to the attempt id AND package id recorded
 *   in the marker) opens the target. It is lifted only by an atomic rename to a history name after the commit.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';

import { QandeelError, isId, type Id } from '@qandeel-company/domain';

import { assertLocalPathSyntax } from './workspace.js';

export const HOLD_FILE = 'UPDATE_HOLD.json';

/**
 * The permanent hold of a restore-CHECK verification copy (RR4-1): the copy an isolated restore check / drill
 * produces is never a Company. It is marked before its database exists, every ordinary open refuses it (the runtime,
 * safe-upgrade, rollback, `init`), and `clear-update-hold` refuses to clear it; read-only verify-mode inspection still
 * opens it. A restored Company becomes live only through the controlled restore (`restorePortableBackup`).
 */
export const RESTORE_CHECK_COPY = 'RESTORE_CHECK_COPY';

/** The hold of a live portable restore that has not completed its controlled restore (FB-2). */
export const RESTORE_IN_PROGRESS = 'RESTORE_IN_PROGRESS';

export function maintenanceDir(root: string): string {
  return path.join(path.resolve(root), 'maintenance');
}

export interface UpdateHold {
  readonly updateId: Id;
  readonly code: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly at: string;
}

/** The workspace's update hold, when one is in force. */
export function readUpdateHold(root: string): UpdateHold | null {
  const file = path.join(maintenanceDir(root), HOLD_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as UpdateHold;
  } catch {
    return { updateId: 'unreadable' as Id, code: 'HOLD_FILE_UNREADABLE', fromVersion: 0, toVersion: 0, at: '' };
  }
}

/** Fails closed while an update hold is in force (called by `CompanyStore.open`). */
export function assertNoUpdateHold(root: string): void {
  const hold = readUpdateHold(root);
  if (hold === null) return;
  if (hold.code === RESTORE_IN_PROGRESS) {
    throw new QandeelError('UPDATE_HOLD', 'a live portable restore is in progress on this workspace: it is not a Company until the controlled restore completes (inspect with restore-status; resume or finalize with restore-portable and the same package; restart with another package only with --discard-partial-restore)', { updateId: String(hold.updateId).slice(0, 64), code: RESTORE_IN_PROGRESS });
  }
  if (hold.code === RESTORE_CHECK_COPY) throw new QandeelError('UPDATE_HOLD', 'this workspace is a restore-check verification copy: it is never started, upgraded or used as a Company (a Company is restored live only through restore-portable)', { updateId: String(hold.updateId).slice(0, 64), code: RESTORE_CHECK_COPY });
  throw new QandeelError('UPDATE_HOLD', 'the workspace is in UPDATE_HOLD after a failed update; the operator must clear it', { updateId: String(hold.updateId).slice(0, 64), code: String(hold.code).slice(0, 64) });
}

/** Whether the workspace is a restore-check verification copy (RR4-1). */
export function isRestoreCheckCopy(root: string): boolean {
  return readUpdateHold(root)?.code === RESTORE_CHECK_COPY;
}

/**
 * Marks a new isolated restore target as a verification copy BEFORE its database is written (a crash mid-check never
 * leaves an unmarked, startable copy). Exclusive create: an existing hold is never overwritten.
 */
export function markRestoreCheckCopy(root: string, mark: { readonly backupId: Id; readonly schemaVersion: number; readonly at: string }): void {
  mkdirSync(maintenanceDir(root), { recursive: true });
  writeFileSync(path.join(maintenanceDir(root), HOLD_FILE), `${JSON.stringify({ updateId: mark.backupId, code: RESTORE_CHECK_COPY, fromVersion: mark.schemaVersion, toVersion: mark.schemaVersion, at: mark.at })}\n`, { flag: 'wx' });
}

/** The operator acknowledges a hold (it is kept as history, never deleted). A verification copy's hold is never cleared. */
export function clearUpdateHold(root: string, reasonCode: string): { cleared: boolean } {
  const file = path.join(maintenanceDir(root), HOLD_FILE);
  if (!existsSync(file)) return { cleared: false };
  if (isRestoreCheckCopy(root)) throw new QandeelError('MAINTENANCE_REFUSED', 'this workspace is a restore-check verification copy; its hold is permanent (restore a Company live with restore-portable)', { reason: RESTORE_CHECK_COPY });
  if (readUpdateHold(root)?.code === RESTORE_IN_PROGRESS) throw new QandeelError('MAINTENANCE_REFUSED', 'a live portable restore is in progress; only the restore lifecycle lifts its hold (resume or finalize with restore-portable and the same package)', { reason: RESTORE_IN_PROGRESS });
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(reasonCode)) throw new QandeelError('VALIDATION_FAILED', 'reasonCode is a short code', { field: 'reasonCode' });
  renameSync(file, path.join(maintenanceDir(root), `UPDATE_HOLD.cleared-${Date.now()}-${reasonCode}.json`));
  return { cleared: true };
}

// ---------------------------------------------------------------------------------------------------------
// FB-2: the live portable restore marker.

/**
 * PREPARING: the marker exists, database / artifact bytes may be absent or partial (never trusted).
 * DATA_WRITTEN: every byte is written and fsynced and the artifacts verified; the controlled restore may or may not have
 * committed (the database decides: the `recovery.clean_restore` audit row carrying this attempt id).
 * COMMITTED: the controlled restore committed and the store closed; only the atomic rename to history remains.
 */
export const RESTORE_PHASES = ['PREPARING', 'DATA_WRITTEN', 'COMMITTED'] as const;
export type RestorePhase = (typeof RESTORE_PHASES)[number];

export interface RestoreMarker {
  readonly attemptId: Id;
  readonly packageId: Id;
  readonly backupId: Id;
  readonly sourceSchemaVersion: number;
  readonly startedAt: string;
  readonly phase: RestorePhase;
  readonly phaseAt: string;
  /** The interrupted (or explicitly discarded) attempt this one replaced, if any. */
  readonly restartOf: Id | null;
}

/** What the restore lifecycle presents to open its own target: the attempt AND the package recorded in the marker. */
export interface RestoreBinding {
  readonly attemptId: Id;
  readonly packageId: Id;
}

const RESTORE_HISTORY = /^RESTORE_IN_PROGRESS\.(completed|abandoned|discarded)-([0-9a-f-]{36})\.json$/;

const holdPath = (root: string): string => path.join(maintenanceDir(root), HOLD_FILE);

function markerText(m: RestoreMarker): string {
  return `${JSON.stringify({ updateId: m.attemptId, code: RESTORE_IN_PROGRESS, fromVersion: m.sourceSchemaVersion, toVersion: m.sourceSchemaVersion, at: m.startedAt, restore: m })}\n`;
}

function parseRestoreMarker(raw: unknown): RestoreMarker | null {
  const r = raw as Record<string, unknown> | null | undefined;
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return null;
  const ok =
    isId(r.attemptId) && isId(r.packageId) && isId(r.backupId) && Number.isInteger(r.sourceSchemaVersion) && Number(r.sourceSchemaVersion) >= 1 &&
    typeof r.startedAt === 'string' && typeof r.phaseAt === 'string' && (RESTORE_PHASES as readonly unknown[]).includes(r.phase) && (r.restartOf === null || isId(r.restartOf));
  if (!ok) return null;
  return { attemptId: r.attemptId as Id, packageId: r.packageId as Id, backupId: r.backupId as Id, sourceSchemaVersion: Number(r.sourceSchemaVersion), startedAt: String(r.startedAt), phase: r.phase as RestorePhase, phaseAt: String(r.phaseAt), restartOf: (r.restartOf ?? null) as Id | null };
}

/**
 * The live restore in progress on this target, or null when there is none. A RESTORE_IN_PROGRESS hold whose restore
 * metadata cannot be read fails closed (it is never treated as absent).
 */
export function readRestoreMarker(root: string): RestoreMarker | null {
  const hold = readUpdateHold(root);
  if (hold === null || hold.code !== RESTORE_IN_PROGRESS) return null;
  const marker = parseRestoreMarker((hold as unknown as { restore?: unknown }).restore);
  if (marker === null) throw new QandeelError('UPDATE_HOLD', 'a live portable restore is in progress but its marker is unreadable; restart it explicitly (restore-portable --discard-partial-restore)', { code: RESTORE_IN_PROGRESS, reason: 'RESTORE_MARKER_UNREADABLE' });
  return marker;
}

/**
 * The restore gate of every store open, evaluated BEFORE the workspace is touched (FB-2). Without a binding, a target
 * holding a RESTORE_IN_PROGRESS marker is refused in every mode — verify-mode inspection included (the database under
 * the marker may be partial). With a binding, the open is the restore lifecycle's own: it passes only when the marker
 * exists and names exactly that attempt and that package.
 */
export function assertRestoreGate(root: string, binding: RestoreBinding | undefined): void {
  assertLocalPathSyntax(root); // a UNC / device path is refused before the file system is touched
  if (binding === undefined) {
    if (readUpdateHold(root)?.code === RESTORE_IN_PROGRESS) assertNoUpdateHold(root);
    return;
  }
  const marker = readRestoreMarker(root);
  if (marker === null || marker.attemptId !== binding.attemptId || marker.packageId !== binding.packageId) {
    throw new QandeelError('UPDATE_HOLD', 'this open is not bound to the live restore in progress on this workspace', { code: RESTORE_IN_PROGRESS, reason: 'RESTORE_BINDING_MISMATCH' });
  }
}

/**
 * Makes a directory entry durable. Windows cannot flush a directory handle (FlushFileBuffers on a directory fails with
 * EPERM, some builds EISDIR) while NTFS journals the entry itself: exactly those two codes are tolerated, and only on
 * Windows. Every other error propagates.
 */
export function fsyncDirectory(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, 'r');
    fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!(process.platform === 'win32' && (code === 'EPERM' || code === 'EISDIR'))) throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function removeFileIfPresent(file: string): void {
  try {
    unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Exclusive create + write + fsync; a failed write removes the file it created (it held nothing else). */
function writeNewDurably(file: string, text: string): void {
  const fd = openSync(file, 'wx');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    removeFileIfPresent(file);
    throw error;
  }
  closeSync(fd);
}

/**
 * C1: creates the RESTORE_IN_PROGRESS marker of a new live restore attempt — exclusive create (an existing hold is
 * never overwritten), fsynced, and its directory entries (maintenance dir, workspace root, root's parent) made durable —
 * BEFORE the caller writes any database or artifact byte.
 */
export function beginRestoreMarker(root: string, marker: RestoreMarker): void {
  const dir = maintenanceDir(root);
  mkdirSync(dir, { recursive: true });
  writeNewDurably(holdPath(root), markerText(marker));
  fsyncDirectory(dir);
  fsyncDirectory(path.resolve(root));
  fsyncDirectory(path.dirname(path.resolve(root)));
}

/**
 * Atomically replaces the marker of `expected` (write a durable sibling, rename over the hold): the hold file exists at
 * every instant. Refused unless the marker in force is exactly `expected`.
 */
export function replaceRestoreMarker(root: string, expected: RestoreBinding, next: RestoreMarker): void {
  const current = readRestoreMarker(root);
  if (current === null || current.attemptId !== expected.attemptId || current.packageId !== expected.packageId) {
    throw new QandeelError('UPDATE_HOLD', 'the live restore marker changed underneath this restore attempt', { code: RESTORE_IN_PROGRESS, reason: 'RESTORE_BINDING_MISMATCH' });
  }
  const dir = maintenanceDir(root);
  const tmp = path.join(dir, `${HOLD_FILE}.${next.attemptId}.${next.phase.toLowerCase()}.next`);
  removeFileIfPresent(tmp); // a leftover of an interrupted replacement of this same step
  writeNewDurably(tmp, markerText(next));
  renameSync(tmp, holdPath(root));
  fsyncDirectory(dir);
}

/**
 * Explicit discard of a restore marker that cannot be read (`--discard-partial-restore` only): atomically replaces it
 * with `next`. Accepted only for a RESTORE_IN_PROGRESS hold with unreadable metadata, or an unparseable hold file (the
 * caller admits that one only when the target holds nothing but that file: a torn first marker write, before any byte).
 */
export function replaceUnreadableRestoreHold(root: string, next: RestoreMarker): void {
  const hold = readUpdateHold(root);
  let unreadableRestore = false;
  try {
    readRestoreMarker(root);
  } catch {
    unreadableRestore = true;
  }
  if (!(hold !== null && (hold.code === 'HOLD_FILE_UNREADABLE' || (hold.code === RESTORE_IN_PROGRESS && unreadableRestore)))) {
    throw new QandeelError('UNSAFE_WORKSPACE', 'only an unreadable restore marker is discarded this way', { reason: 'not-an-unreadable-restore-marker' });
  }
  const dir = maintenanceDir(root);
  const tmp = path.join(dir, `${HOLD_FILE}.${next.attemptId}.${next.phase.toLowerCase()}.next`);
  removeFileIfPresent(tmp);
  writeNewDurably(tmp, markerText(next));
  renameSync(tmp, holdPath(root));
  fsyncDirectory(dir);
}

/** Keeps a durable copy of a marker as restore history (an attempt that was abandoned or discarded). */
export function archiveRestoreMarker(root: string, marker: RestoreMarker, outcome: 'abandoned' | 'discarded'): void {
  const file = path.join(maintenanceDir(root), `RESTORE_IN_PROGRESS.${outcome}-${marker.attemptId}.json`);
  if (existsSync(file)) return; // recorded by an earlier interrupted restart of this same attempt
  writeNewDurably(file, markerText(marker));
  fsyncDirectory(maintenanceDir(root));
}

/**
 * C5: the only lift of a RESTORE_IN_PROGRESS hold — after the controlled restore committed and its store closed, the
 * marker is atomically renamed to its durable history name. Refused unless the marker in force is exactly `binding`.
 */
export function completeRestoreMarker(root: string, binding: RestoreBinding): string {
  const current = readRestoreMarker(root);
  if (current === null || current.attemptId !== binding.attemptId || current.packageId !== binding.packageId) {
    throw new QandeelError('UPDATE_HOLD', 'the live restore marker does not belong to this restore attempt', { code: RESTORE_IN_PROGRESS, reason: 'RESTORE_BINDING_MISMATCH' });
  }
  const name = `RESTORE_IN_PROGRESS.completed-${binding.attemptId}.json`;
  renameSync(holdPath(root), path.join(maintenanceDir(root), name));
  fsyncDirectory(maintenanceDir(root));
  return name;
}

export interface RestoreStatus {
  /** True while any hold keeps this workspace from being opened as a Company. */
  readonly blocked: boolean;
  /** The hold code in force (RESTORE_IN_PROGRESS, RESTORE_CHECK_COPY, an update hold code, HOLD_FILE_UNREADABLE) or null. */
  readonly hold: string | null;
  readonly restoreInProgress: RestoreMarker | null;
  /** False when a RESTORE_IN_PROGRESS hold exists but its metadata cannot be read (restart needs --discard-partial-restore). */
  readonly markerReadable: boolean;
  /** Earlier restore attempts on this target (IDs and outcomes only). */
  readonly history: readonly { readonly outcome: string; readonly attemptId: string }[];
  readonly next: string | null;
}

/** Read-only, content-free restore status of a target (never opens its database). */
export function restoreStatus(root: string): RestoreStatus {
  assertLocalPathSyntax(root);
  const hold = readUpdateHold(root);
  let marker: RestoreMarker | null = null;
  let readable = true;
  try {
    marker = readRestoreMarker(root);
  } catch (error) {
    if (!(error instanceof QandeelError && error.details.reason === 'RESTORE_MARKER_UNREADABLE')) throw error;
    readable = false;
  }
  const dir = maintenanceDir(root);
  const history = existsSync(dir)
    ? readdirSync(dir)
        .map((f) => RESTORE_HISTORY.exec(f))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => ({ outcome: String(m[1]).toUpperCase(), attemptId: String(m[2]) }))
        .sort((a, b) => (a.attemptId < b.attemptId ? -1 : 1))
    : [];
  const inProgress = hold?.code === RESTORE_IN_PROGRESS;
  return {
    blocked: hold !== null,
    hold: hold === null ? null : String(hold.code).slice(0, 64),
    restoreInProgress: marker,
    markerReadable: readable,
    history,
    next: inProgress
      ? readable
        ? 'restore-portable with the same package resumes: a committed attempt is only finalized, an interrupted one is redone from the package; another package requires --discard-partial-restore'
        : 'the marker is unreadable: restart with restore-portable --discard-partial-restore'
      : null,
  };
}
