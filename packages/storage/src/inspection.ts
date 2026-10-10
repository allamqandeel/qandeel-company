/**
 * Cross-version schema inspection (P1-DESKTOP-UPGRADE-CORR-01): what a NEWER release may learn about a Company whose
 * schema is older than its own, before anything upgrades it. Read-only and content-free: versions, a hold-free verified
 * history, and who holds the Company (the supervisor lease and its runtime instance).
 *
 * `CompanyStore.open({ migrationMode: 'verify' })` refuses a database with pending migrations (SCHEMA_NOT_READY): no
 * store runs on a schema it was not built for. An activation still has to tell, from the new release, a schema that is
 * only behind (a verified, upgradable history: UPDATE_REQUIRED) from one it must refuse, and whether the previous release
 * still runs it. The history is checked exactly as every open checks it (`pendingMigrations`): a future schema, an
 * incoherent history and a drifted migration keep their own refusal codes. The lease and instance rows are the durable
 * C1 tables of migration 0001, which no later migration changes. A live restore is refused as for every open.
 */
import { QandeelError, systemClock } from '@qandeel-company/domain';

import { appliedMigrations, loadReleasedMigrations, pendingMigrations, userVersion } from './migrations.js';
import { readInstance, readSupervisorLease, type RuntimeInstanceRecord, type SupervisorLease } from './runtime-state.js';
import { SqliteConnection } from './sqlite/connection.js';
import { DEFAULT_BUSY_TIMEOUT_MS } from './store.js';
import { assertRestoreGate } from './update-hold.js';
import { openWorkspace } from './workspace.js';

export interface SchemaInspection {
  /** CURRENT: this release runs it as is. UPDATE_REQUIRED: a verified older history that safe-upgrade brings current. */
  readonly schema: 'CURRENT' | 'UPDATE_REQUIRED';
  readonly databaseVersion: number;
  readonly releaseVersion: number;
  readonly lease: SupervisorLease | null;
  /** The lease holder's runtime instance record (IDs, PID, state and times only). */
  readonly instance: Pick<RuntimeInstanceRecord, 'id' | 'pid' | 'state' | 'startedAt' | 'updatedAt'> | null;
}

/** Inspects an existing Company's schema and holder from this release (never creates, migrates or writes a row). */
export function inspectCompanySchema(root: string, options: { readonly busyTimeoutMs?: number } = {}): SchemaInspection {
  assertRestoreGate(root, undefined);
  const workspace = openWorkspace(root, { create: false });
  const migrations = loadReleasedMigrations();
  const db = SqliteConnection.open({ path: workspace.databasePath, busyTimeoutMs: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS });
  try {
    return db.snapshot(() => {
      const databaseVersion = userVersion(db);
      const pending = pendingMigrations(databaseVersion, appliedMigrations(db), migrations);
      if (databaseVersion < 1) throw new QandeelError('SCHEMA_NOT_READY', 'the database holds no Company schema', { databaseVersion, runtimeVersion: migrations.length });
      const ctx = { db, clock: systemClock, fault: () => undefined };
      const lease = readSupervisorLease(ctx);
      const record = lease ? readInstance(ctx, lease.holderId) : null;
      const instance = record ? { id: record.id, pid: record.pid, state: record.state, startedAt: record.startedAt, updatedAt: record.updatedAt } : null;
      return { schema: pending.length === 0 ? 'CURRENT' : 'UPDATE_REQUIRED', databaseVersion, releaseVersion: migrations.length, lease, instance };
    });
  } finally {
    db.close();
  }
}
