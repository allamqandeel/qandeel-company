/**
 * The narrow SQLite adapter. This is the ONLY module in the codebase that imports `node:sqlite`
 * (a Release Candidate API in Node 24 — Stability 1.2 since v24.15.0), so a later driver change
 * touches this file, not the Company core. It is internal to @qandeel-company/storage: the package
 * never exports it, and no generic "execute arbitrary SQL" method leaves the storage layer.
 *
 * Every connection is opened with, and verifies at open:
 *   - a file-backed database (no `:memory:`),
 *   - `journal_mode=WAL` (result must read back `wal`),
 *   - `synchronous=FULL` (durability over write micro-optimization; see DECISION_LOG D-C1-04),
 *   - foreign keys ON,
 *   - defensive mode ON (probed: `writable_schema` cannot be switched on),
 *   - extension loading disabled at construction (it can then never be enabled),
 *   - double-quoted string literals rejected,
 *   - a bounded busy timeout (lock waits fail with STORAGE_BUSY instead of hanging).
 * `wal_autocheckpoint` is deliberately left at the SQLite default.
 */
import { DatabaseSync, backup as sqliteBackup, type SQLInputValue, type StatementSync } from 'node:sqlite';

import { QandeelError } from '@qandeel-company/domain';

export type SqlValue = SQLInputValue;
export type Row = Record<string, SqlValue>;

export interface ConnectionOptions {
  /** Absolute path of the database file. */
  readonly path: string;
  /** Maximum time a statement waits for a lock before failing with STORAGE_BUSY. */
  readonly busyTimeoutMs: number;
  /** Open an existing database read-only (backup verification). WAL is then not changed. */
  readonly readOnly?: boolean;
  /** Keep the file's journal mode (used for isolated backup snapshots, which use DELETE mode). */
  readonly keepJournalMode?: boolean;
}

/** Statement counters, so tests can prove an idle runtime issues no queries. */
export interface ConnectionStats {
  statements: number;
  writeTransactions: number;
}

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CONSTRAINT = 19;

function primaryCode(error: unknown): number | undefined {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === 'number' ? code & 0xff : undefined;
}

export function isBusyError(error: unknown): boolean {
  const code = primaryCode(error);
  return code === SQLITE_BUSY || code === SQLITE_LOCKED;
}

export function isConstraintError(error: unknown): boolean {
  return primaryCode(error) === SQLITE_CONSTRAINT;
}

/** Translates driver errors into stable Company error codes without leaking SQL or values. */
export function translateError(error: unknown, operation: string): unknown {
  if (error instanceof QandeelError) return error;
  if (isBusyError(error)) {
    return new QandeelError('STORAGE_BUSY', `database lock not acquired within the busy timeout during ${operation}`, { operation }, { cause: error });
  }
  if (isConstraintError(error)) {
    return new QandeelError('STORAGE_INVARIANT', `database constraint rejected ${operation}`, { operation }, { cause: error });
  }
  return error;
}

export class SqliteConnection {
  readonly path: string;
  readonly stats: ConnectionStats = { statements: 0, writeTransactions: 0 };
  readonly #db: DatabaseSync;
  readonly #statements = new Map<string, StatementSync>();
  #inTransaction = false;

  private constructor(db: DatabaseSync, path: string) {
    this.#db = db;
    this.path = path;
  }

  static open(options: ConnectionOptions): SqliteConnection {
    if (options.path === ':memory:' || options.path.trim() === '') {
      throw new QandeelError('SQLITE_CONFIGURATION', 'the operational store must be file-backed');
    }
    if (!(Number.isInteger(options.busyTimeoutMs) && options.busyTimeoutMs >= 0 && options.busyTimeoutMs <= 60_000)) {
      throw new QandeelError('SQLITE_CONFIGURATION', 'busy timeout must be a bounded integer (0..60000 ms)');
    }
    const db = new DatabaseSync(options.path, {
      readOnly: options.readOnly ?? false,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      defensive: true,
      timeout: options.busyTimeoutMs,
    });
    const connection = new SqliteConnection(db, options.path);
    try {
      connection.#verify(options);
    } catch (error) {
      db.close();
      throw error;
    }
    return connection;
  }

  #pragma(sql: string): SqlValue | undefined {
    const row = this.#db.prepare(sql).get() as Row | undefined;
    return row === undefined ? undefined : Object.values(row)[0];
  }

  #verify(options: ConnectionOptions): void {
    const fail = (what: string): never => {
      throw new QandeelError('SQLITE_CONFIGURATION', `SQLite startup invariant failed: ${what}`, { what });
    };
    if (!options.readOnly && !options.keepJournalMode) {
      const mode = this.#pragma('PRAGMA journal_mode = WAL');
      if (String(mode).toLowerCase() !== 'wal') fail('journal_mode=WAL');
    }
    if (!options.readOnly) {
      this.#db.exec('PRAGMA synchronous = FULL');
      if (this.#pragma('PRAGMA synchronous') !== 2) fail('synchronous=FULL');
    }
    if (this.#pragma('PRAGMA foreign_keys') !== 1) fail('foreign_keys=ON');
    // Defensive-mode probe: with SQLITE_DBCONFIG_DEFENSIVE active, writable_schema stays off.
    this.#db.exec('PRAGMA writable_schema = ON');
    if (this.#pragma('PRAGMA writable_schema') !== 0) {
      this.#db.exec('PRAGMA writable_schema = OFF');
      fail('defensive mode');
    }
    if (this.#pragma('PRAGMA trusted_schema') !== 0) this.#db.exec('PRAGMA trusted_schema = OFF');
  }

  get journalMode(): string {
    return String(this.#pragma('PRAGMA journal_mode')).toLowerCase();
  }

  #prepare(sql: string): StatementSync {
    let statement = this.#statements.get(sql);
    if (statement === undefined) {
      statement = this.#db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    this.stats.statements++;
    return statement;
  }

  /** Runs a parameterized statement. SQL text is always a storage-internal constant. */
  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    try {
      const result = this.#prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
    } catch (error) {
      throw translateError(error, 'write');
    }
  }

  get<T extends Row = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    try {
      return this.#prepare(sql).get(...params) as T | undefined;
    } catch (error) {
      throw translateError(error, 'read');
    }
  }

  all<T extends Row = Row>(sql: string, ...params: SqlValue[]): T[] {
    try {
      return this.#prepare(sql).all(...params) as T[];
    } catch (error) {
      throw translateError(error, 'read');
    }
  }

  /** Multi-statement script execution. Used only by the migrator for immutable migration files. */
  execScript(sql: string): void {
    this.stats.statements++;
    this.#db.exec(sql);
  }

  /**
   * Short write transaction with up-front write ownership (`BEGIN IMMEDIATE`). The callback is
   * synchronous by type and checked at run time: returning a Promise/thenable rolls back and
   * throws ASYNC_IN_TRANSACTION, so no code can `await` while holding the write lock.
   */
  immediate<T>(operation: string, fn: () => T): T {
    return this.#transaction('BEGIN IMMEDIATE', operation, fn, true);
  }

  /** Consistent multi-statement read snapshot (deferred transaction). */
  snapshot<T>(fn: () => T): T {
    return this.#transaction('BEGIN', 'read', fn, false);
  }

  #transaction<T>(begin: string, operation: string, fn: () => T, write: boolean): T {
    if (this.#inTransaction) throw new QandeelError('STORAGE_INVARIANT', 'nested transactions are not supported', { operation });
    try {
      this.#db.exec(begin);
    } catch (error) {
      throw translateError(error, operation);
    }
    this.#inTransaction = true;
    try {
      const result = fn();
      if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
        throw new QandeelError('ASYNC_IN_TRANSACTION', 'a transaction callback returned a promise; never await inside a write transaction', { operation });
      }
      this.#db.exec('COMMIT');
      if (write) this.stats.writeTransactions++;
      return result;
    } catch (error) {
      if (this.#db.isTransaction) {
        try {
          this.#db.exec('ROLLBACK');
        } catch {
          // The original error is more useful than a rollback failure on an already-aborted transaction.
        }
      }
      throw translateError(error, operation);
    } finally {
      this.#inTransaction = false;
    }
  }

  get inTransaction(): boolean {
    return this.#inTransaction;
  }

  /**
   * SQLite Online Backup API (`sqlite3_backup_*`) into `targetPath`. The whole database is copied
   * in one step (a very large page batch) so concurrent writers on other connections cannot force
   * endless restarts of a paged backup; WAL readers do not block writers during the step.
   */
  async backupTo(targetPath: string): Promise<number> {
    return sqliteBackup(this.#db, targetPath, { rate: 2_000_000_000 });
  }

  /**
   * Converts a freshly written backup snapshot to the rollback journal so the snapshot is one
   * self-contained file (no -wal/-shm companions). Never used on the live database.
   */
  convertSnapshotToRollbackJournal(): void {
    const mode = this.#pragma('PRAGMA journal_mode = DELETE');
    if (String(mode).toLowerCase() !== 'delete') throw new QandeelError('SQLITE_CONFIGURATION', 'snapshot journal mode could not be set to DELETE');
  }

  /** Full `PRAGMA integrity_check` (expensive: backups and explicit verification only). */
  integrityCheck(): string[] {
    return this.all<{ integrity_check: string }>('PRAGMA integrity_check').map((r) => r.integrity_check);
  }

  close(): void {
    this.#statements.clear();
    if (this.#db.isOpen) this.#db.close();
  }

  get isOpen(): boolean {
    return this.#db.isOpen;
  }
}
