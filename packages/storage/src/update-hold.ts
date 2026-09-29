/**
 * UPDATE_HOLD (Stage 15 D15-D.5): after a failed update the workspace is held, and every store open refuses it
 * until the operator clears the hold — a failed migration is never retried in a startup loop. The hold is a
 * file (a failed update may leave no database to write into). Kept free of store imports (no module cycle).
 */
import { existsSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';

import { QandeelError, type Id } from '@qandeel-company/domain';

export const HOLD_FILE = 'UPDATE_HOLD.json';

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
  if (hold !== null) throw new QandeelError('UPDATE_HOLD', 'the workspace is in UPDATE_HOLD after a failed update; the operator must clear it', { updateId: String(hold.updateId).slice(0, 64), code: String(hold.code).slice(0, 64) });
}

/** The operator acknowledges a hold (it is kept as history, never deleted). */
export function clearUpdateHold(root: string, reasonCode: string): { cleared: boolean } {
  const file = path.join(maintenanceDir(root), HOLD_FILE);
  if (!existsSync(file)) return { cleared: false };
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(reasonCode)) throw new QandeelError('VALIDATION_FAILED', 'reasonCode is a short code', { field: 'reasonCode' });
  renameSync(file, path.join(maintenanceDir(root), `UPDATE_HOLD.cleared-${Date.now()}-${reasonCode}.json`));
  return { cleared: true };
}
