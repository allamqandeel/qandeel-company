/**
 * Explicit, ordered, checksummed schema migrations (Stage 12 §37, Stage 15 D15-D).
 *
 * - Migration files are immutable. Each has a version, a name and a SHA-256 of its text (line
 *   endings normalized to LF, so a Windows checkout cannot cause false drift).
 * - The release pins every checksum in `RELEASED_MIGRATIONS`; a file that no longer matches its
 *   pin is refused before anything touches the database.
 * - Each migration runs in its own `BEGIN IMMEDIATE` transaction together with its
 *   `schema_migrations` row and `PRAGMA user_version`; a failure rolls back to the prior coherent
 *   version.
 * - Startup refuses an applied migration whose checksum changed (drift), an applied version the
 *   release does not know, and a `user_version` ahead of the release (future schema). Nothing is
 *   ever downgraded automatically.
 * - The very first database creation goes through the same path (0001 creates the schema).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { QandeelError, type Clock, now, sha256Hex } from '@qandeel-company/domain';

import type { SqliteConnection } from './sqlite/connection.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly sha256: string;
}

export interface MigrationPin {
  readonly version: number;
  readonly name: string;
  readonly file: string;
  readonly sha256: string;
}

/** Released migrations. Adding a migration = appending a pin; never edit an existing row. */
export const RELEASED_MIGRATIONS: readonly MigrationPin[] = Object.freeze([
  { version: 1, name: 'work_foundation', file: '0001_work_foundation.sql', sha256: '3022ed5ed626f9394cfa9a7e897d2ed4e7bcb9b94c8de7a9a4bde7c0c658436e' },
  { version: 2, name: 'queue_runs_artifacts', file: '0002_queue_runs_artifacts.sql', sha256: 'b3060a1ea7a3e57e8bf0f76a4edba437c9f1b8d2886ef97ff5ca2b6920b0a7c2' },
  { version: 3, name: 'runtime_wake_generation', file: '0003_runtime_wake_generation.sql', sha256: 'f47cf341f677585d762672929bdf2f41eeb4bf7440463b68846bac0c777762e4' },
  { version: 4, name: 'c2_governance', file: '0004_c2_governance.sql', sha256: '51dd9a38df306751eace1dc6cf82e231b92e487b7e913b061f336e8c25a0066c' },
  { version: 5, name: 'c3_memory_context', file: '0005_c3_memory_context.sql', sha256: '2c2f0d8092f108de2596c15e795ba6ba8d17b316761d0ac59e45d8845409e44a' },
  { version: 6, name: 'c3_skills_academy', file: '0006_c3_skills_academy.sql', sha256: 'a4b8709915fbad924212e3278b64d2f58d4d1e40c5ba1ff937cb7c50637d57d8' },
  { version: 7, name: 'c4_organization', file: '0007_c4_organization.sql', sha256: '9c46b838c21caf7b38d5db1244fc6fdd83c5e47f1a24fe2f973a9828f417fc3b' },
  { version: 8, name: 'c4_review_quality', file: '0008_c4_review_quality.sql', sha256: 'd937856f2a730ff33d3fb83f61c8e6b3ce0c932c4189492d6c50e8eeafb899f5' },
  { version: 9, name: 'c5_founder_surface', file: '0009_c5_founder_surface.sql', sha256: '803f9eef58fad2afaabbca562c509648aaf59cc21ad647728957fa31d6ab00b1' },
  { version: 10, name: 'c6_improvement_engine', file: '0010_c6_improvement_engine.sql', sha256: 'a8696420f2c20abc8dfe1b62b729adedc57314cfecd7e644bc31687fa9c989ee' },
  { version: 11, name: 'r2_integrity', file: '0011_r2_integrity.sql', sha256: '97ab99eebf4fc8ce49c1e1550eb4448f8a9e515a7b02259381ab33fe95ae2550' },
  { version: 12, name: 'c7a_operational_data_external_outcomes', file: '0012_c7a_operational_data_external_outcomes.sql', sha256: '31eeff9a49e284bec44915842ea39453550cc225c9e58b100483a7ad45aaaf09' },
  { version: 13, name: 'c7b_governed_app_controls', file: '0013_c7b_governed_app_controls.sql', sha256: '6eb49123e3079c1256fc95d92c2de47582245109744995f437bb07c57f2d3610' },
]);

export const CURRENT_SCHEMA_VERSION = RELEASED_MIGRATIONS.length;

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

export function migrationChecksum(sql: string): string {
  return sha256Hex(sql.replace(/\r\n/g, '\n'));
}

/** Loads the released migration files and verifies each against its pin. */
export function loadReleasedMigrations(upTo: number = CURRENT_SCHEMA_VERSION): Migration[] {
  return RELEASED_MIGRATIONS.filter((p) => p.version <= upTo).map((pin) => {
    const sql = readFileSync(fileURLToPath(new URL(pin.file, MIGRATIONS_DIR)), 'utf8');
    const sha256 = migrationChecksum(sql);
    if (sha256 !== pin.sha256) {
      throw new QandeelError('MIGRATION_CHECKSUM_DRIFT', `released migration ${pin.file} does not match its pinned checksum`, { version: pin.version });
    }
    return { version: pin.version, name: pin.name, sql, sha256 };
  });
}

function assertOrdered(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new QandeelError('STORAGE_INVARIANT', 'migrations must be numbered 1..N without gaps', { version: m.version });
    if (migrationChecksum(m.sql) !== m.sha256) throw new QandeelError('MIGRATION_CHECKSUM_DRIFT', 'migration text does not match its checksum', { version: m.version });
  });
}

const BOOTSTRAP = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version          INTEGER NOT NULL PRIMARY KEY CHECK (version >= 1),
  name             TEXT    NOT NULL,
  sha256           TEXT    NOT NULL CHECK (length(sha256) = 64),
  runtime_version  TEXT    NOT NULL,
  applied_at       TEXT    NOT NULL
) STRICT`;

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly sha256: string;
  readonly runtimeVersion: string;
  readonly appliedAt: string;
}

export function appliedMigrations(connection: SqliteConnection): AppliedMigration[] {
  const exists = connection.get(`SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'`);
  if (!exists) return [];
  return connection
    .all<{ version: number; name: string; sha256: string; runtime_version: string; applied_at: string }>(
      'SELECT version, name, sha256, runtime_version, applied_at FROM schema_migrations ORDER BY version',
    )
    .map((r) => ({ version: r.version, name: r.name, sha256: r.sha256, runtimeVersion: r.runtime_version, appliedAt: r.applied_at }));
}

export function userVersion(connection: SqliteConnection): number {
  return Number(connection.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0);
}

export interface MigrationReport {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly applied: readonly number[];
}

/** Hook for failure-injection tests; production passes nothing. */
export type MigrationFaultHook = (version: number) => void;

/**
 * An EXISTING Company: a database with schema (user_version ≥ 1) AND history — rows that no migration ever writes
 * (audit, events, Work Items, runtime instances). A fresh database (including one a concurrent first opener is still
 * migrating: nothing but migration rows yet) has none. Read inside the caller's snapshot.
 */
function hasCompanyHistory(connection: SqliteConnection): boolean {
  const present = new Set(connection.all<{ name: string }>(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('audit_events', 'events', 'work_items', 'runtime_instances')`).map((r) => r.name));
  for (const table of ['audit_events', 'events', 'work_items', 'runtime_instances']) {
    if (present.has(table) && connection.get(`SELECT 1 AS x FROM ${table} LIMIT 1`) !== undefined) return true;
  }
  return false;
}

/**
 * Brings the schema to `migrations.length`, or refuses to continue. Never downgrades.
 * `readOnlyCheck` validates without applying (used when opening backup snapshots).
 * `refuseExistingCompany` (the ordinary open path, R2-30): an existing Company with pending migrations is never
 * migrated live here — it is upgraded only through the safe-upgrade lifecycle (Preflight → Backup → Rehearse →
 * Verify → Activate). Fresh creation still migrates at open.
 */
export function migrate(
  connection: SqliteConnection,
  migrations: readonly Migration[],
  { clock, runtimeVersion, readOnlyCheck = false, beforeCommit, refuseExistingCompany = false }: { clock: Clock; runtimeVersion: string; readOnlyCheck?: boolean; beforeCommit?: MigrationFaultHook; refuseExistingCompany?: boolean },
): MigrationReport {
  assertOrdered(migrations);
  // One read snapshot: a concurrent opener may commit a migration between two separate reads (and history is judged
  // in the same snapshot, so a concurrent first open that finished meanwhile is never mistaken for an old Company).
  const { applied, fromVersion, existing } = connection.snapshot(() => {
    const v = userVersion(connection);
    return { applied: appliedMigrations(connection), fromVersion: v, existing: refuseExistingCompany && v >= 1 && v < migrations.length && hasCompanyHistory(connection) };
  });
  const known = migrations.length;

  if (fromVersion > known || applied.some((a) => a.version > known)) {
    throw new QandeelError('SCHEMA_FROM_FUTURE', 'database schema is newer than this runtime; refusing to run (no automatic downgrade)', { databaseVersion: Math.max(fromVersion, ...applied.map((a) => a.version)), runtimeVersion: known });
  }
  if (applied.length !== fromVersion || applied.some((a, i) => a.version !== i + 1)) {
    throw new QandeelError('STORAGE_INVARIANT', 'schema_migrations and user_version disagree; database is not coherent', { userVersion: fromVersion, appliedCount: applied.length });
  }
  for (const a of applied) {
    const m = migrations[a.version - 1];
    if (m === undefined || m.sha256 !== a.sha256 || m.name !== a.name) {
      throw new QandeelError('MIGRATION_CHECKSUM_DRIFT', `applied migration ${a.version} no longer matches its source; refusing to start`, { version: a.version });
    }
  }
  const pending = migrations.slice(fromVersion);
  if (readOnlyCheck) {
    if (pending.length) throw new QandeelError('SCHEMA_NOT_READY', 'database is behind this runtime', { databaseVersion: fromVersion, runtimeVersion: known });
    return { fromVersion, toVersion: fromVersion, applied: [] };
  }
  if (pending.length && existing) {
    throw new QandeelError('SCHEMA_UPDATE_REQUIRED', 'this Company has pending migrations; upgrade it through safe-upgrade (Preflight → Backup → Rehearse → Verify → Activate), never live at open', { databaseVersion: fromVersion, runtimeVersion: known, next: 'safe-upgrade' });
  }
  const done: number[] = [];
  for (const m of pending) {
    let appliedHere = false;
    try {
      connection.immediate(`migration ${m.version}`, () => {
        // Another process may have applied this migration since the check above (concurrent first
        // open). Re-read inside the write transaction and skip what is already durable.
        if (userVersion(connection) >= m.version) return;
        appliedHere = true;
        connection.execScript(BOOTSTRAP);
        connection.execScript(m.sql);
        connection.run(
          'INSERT INTO schema_migrations (version, name, sha256, runtime_version, applied_at) VALUES (?, ?, ?, ?, ?)',
          m.version,
          m.name,
          m.sha256,
          runtimeVersion,
          now(clock),
        );
        // PRAGMA user_version is transactional; the value is a validated integer, not input.
        connection.execScript(`PRAGMA user_version = ${Math.trunc(m.version)}`);
        beforeCommit?.(m.version);
      });
    } catch (error) {
      if (error instanceof QandeelError && error.code === 'STORAGE_BUSY') throw error;
      throw new QandeelError('MIGRATION_FAILED', `migration ${m.version} failed and was rolled back`, { version: m.version }, { cause: error });
    }
    if (appliedHere) done.push(m.version);
  }
  // Whatever another process applied concurrently must still match this release exactly.
  for (const a of appliedMigrations(connection)) {
    const m = migrations[a.version - 1];
    if (m === undefined || m.sha256 !== a.sha256) throw new QandeelError('MIGRATION_CHECKSUM_DRIFT', `applied migration ${a.version} does not match this release`, { version: a.version });
  }
  return { fromVersion, toVersion: userVersion(connection), applied: done };
}
