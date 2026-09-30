/**
 * UPDATE_HOLD (Stage 15 D15-D.5): after a failed update the workspace is held, and every store open refuses it
 * until the operator clears the hold — a failed migration is never retried in a startup loop. The hold is a
 * file (a failed update may leave no database to write into). Kept free of store imports (no module cycle).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { QandeelError, type Id } from '@qandeel-company/domain';

export const HOLD_FILE = 'UPDATE_HOLD.json';

/**
 * The permanent hold of a restore-CHECK verification copy (RR4-1): the copy an isolated restore check / drill
 * produces is never a Company. It is marked before its database exists, every ordinary open refuses it (the runtime,
 * safe-upgrade, rollback, `init`), and `clear-update-hold` refuses to clear it; read-only verify-mode inspection still
 * opens it. A restored Company becomes live only through the controlled restore (`restorePortableBackup`).
 */
export const RESTORE_CHECK_COPY = 'RESTORE_CHECK_COPY';

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
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(reasonCode)) throw new QandeelError('VALIDATION_FAILED', 'reasonCode is a short code', { field: 'reasonCode' });
  renameSync(file, path.join(maintenanceDir(root), `UPDATE_HOLD.cleared-${Date.now()}-${reasonCode}.json`));
  return { cleared: true };
}
