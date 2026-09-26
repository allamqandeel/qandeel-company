import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { isQandeelError } from '@qandeel-company/domain';

import { SqliteConnection } from '../src/sqlite/connection.js';
import { assertLocalPathSyntax, openWorkspace } from '../src/workspace.js';
import { removeRoot, tempRoot } from './helpers.js';

describe('workspace', () => {
  test('creates only the directories C1 uses, outside any source checkout', () => {
    const root = tempRoot('ws');
    try {
      const layout = openWorkspace(root);
      assert.deepEqual(readdirSync(root).sort(), ['artifacts', 'backups', 'runtime', 'state']);
      assert.deepEqual(readdirSync(layout.artifactsDir).sort(), ['objects', 'tmp']);
      assert.ok(layout.databasePath.endsWith(path.join('state', 'company.sqlite3')));
    } finally {
      removeRoot(root);
    }
  });

  test('rejects UNC / network / device and relative paths on every platform', () => {
    for (const bad of ['\\\\server\\share\\company', '//server/share/company', '\\\\?\\UNC\\server\\share', '\\\\.\\pipe\\x', 'relative/company', '']) {
      for (const platform of ['win32', 'linux'] as const) {
        assert.throws(() => assertLocalPathSyntax(bad, platform), (e) => isQandeelError(e, 'UNSAFE_WORKSPACE'), `${platform}: ${bad}`);
      }
    }
    assert.doesNotThrow(() => assertLocalPathSyntax('D:\\QANDEEL-TEST\\workspace', 'win32'));
    assert.doesNotThrow(() => assertLocalPathSyntax('\\\\?\\D:\\very\\long\\path', 'win32'));
    assert.throws(() => assertLocalPathSyntax('\\no-drive\\path', 'win32'), (e) => isQandeelError(e, 'UNSAFE_WORKSPACE'));
    assert.doesNotThrow(() => assertLocalPathSyntax('/var/tmp/company', 'linux'));
  });

  test('refuses a workspace inside any Git working tree, and never creates a database when create=false', () => {
    const root = tempRoot('ws-git');
    try {
      const repo = path.dirname(root);
      mkdirSync(path.join(repo, '.git'));
      assert.throws(() => openWorkspace(path.join(repo, 'nested', 'company')), (e) => isQandeelError(e, 'UNSAFE_WORKSPACE') && e.details.reason === 'inside-source-checkout');
      const outside = tempRoot('ws-nodb');
      try {
        mkdirSync(outside, { recursive: true });
        openWorkspace(outside);
        assert.throws(() => openWorkspace(outside, { create: false }), (e) => isQandeelError(e, 'UNSAFE_WORKSPACE') && e.details.reason === 'missing-database');
        assert.equal(existsSync(path.join(outside, 'state', 'company.sqlite3')), false);
      } finally {
        removeRoot(outside);
      }
    } finally {
      removeRoot(root);
    }
  });

  test('refuses a symlinked workspace directory', () => {
    const root = tempRoot('ws-link');
    try {
      mkdirSync(root, { recursive: true });
      const elsewhere = path.join(path.dirname(root), 'elsewhere');
      mkdirSync(elsewhere);
      // A directory junction needs no privilege on Windows; on Linux the type is ignored.
      symlinkSync(elsewhere, path.join(root, 'state'), 'junction');
      assert.throws(() => openWorkspace(root), (e) => isQandeelError(e, 'UNSAFE_WORKSPACE'));
    } finally {
      removeRoot(root);
    }
  });
});

describe('SQLite adapter startup invariants', () => {
  test('WAL, synchronous=FULL, foreign keys, defensive mode, no extensions', () => {
    const root = tempRoot('sqlite');
    try {
      const layout = openWorkspace(root);
      const db = SqliteConnection.open({ path: layout.databasePath, busyTimeoutMs: 200 });
      try {
        assert.equal(db.journalMode, 'wal');
        assert.equal(db.get('PRAGMA synchronous')?.synchronous, 2);
        assert.equal(db.get('PRAGMA foreign_keys')?.foreign_keys, 1);
        db.execScript('PRAGMA writable_schema = ON');
        assert.equal(db.get('PRAGMA writable_schema')?.writable_schema, 0, 'defensive mode keeps writable_schema off');
        db.execScript('PRAGMA journal_mode = OFF');
        assert.equal(db.journalMode, 'wal', 'defensive mode refuses journal_mode=OFF');
        assert.throws(() => db.get(`SELECT load_extension('x')`), /not authorized/);
        db.execScript('CREATE TABLE probe (x INTEGER) STRICT');
        assert.ok(existsSync(`${layout.databasePath}-wal`), 'writes go to the WAL file');
      } finally {
        db.close();
      }
    } finally {
      removeRoot(root);
    }
  });

  test('refuses an in-memory store and unbounded busy timeouts', () => {
    assert.throws(() => SqliteConnection.open({ path: ':memory:', busyTimeoutMs: 100 }), (e) => isQandeelError(e, 'SQLITE_CONFIGURATION'));
    assert.throws(() => SqliteConnection.open({ path: '/tmp/x.sqlite3', busyTimeoutMs: -1 }), (e) => isQandeelError(e, 'SQLITE_CONFIGURATION'));
  });

  test('WAL: a reader sees committed state while another connection holds the write lock; writers wait only the bounded timeout', () => {
    const root = tempRoot('sqlite-wal');
    try {
      const layout = openWorkspace(root);
      const a = SqliteConnection.open({ path: layout.databasePath, busyTimeoutMs: 150 });
      const b = SqliteConnection.open({ path: layout.databasePath, busyTimeoutMs: 150 });
      try {
        a.execScript('CREATE TABLE t (v INTEGER NOT NULL) STRICT; INSERT INTO t VALUES (1);');
        a.execScript('BEGIN IMMEDIATE');
        a.run('INSERT INTO t VALUES (2)');
        assert.equal(b.get('SELECT COUNT(*) AS n FROM t')?.n, 1, 'reader sees the committed snapshot, not the open write');
        const started = Date.now();
        assert.throws(() => b.immediate('contend', () => b.run('INSERT INTO t VALUES (3)')), (e) => isQandeelError(e, 'STORAGE_BUSY'));
        const waited = Date.now() - started;
        assert.ok(waited >= 100 && waited < 5_000, `waited ${waited} ms: bounded, not indefinite`);
        a.execScript('COMMIT');
        assert.equal(b.get('SELECT COUNT(*) AS n FROM t')?.n, 2);
      } finally {
        a.close();
        b.close();
      }
    } finally {
      removeRoot(root);
    }
  });

  test('transactions: async callbacks are refused and rolled back; nested transactions are refused', () => {
    const root = tempRoot('sqlite-tx');
    try {
      const layout = openWorkspace(root);
      const db = SqliteConnection.open({ path: layout.databasePath, busyTimeoutMs: 100 });
      try {
        db.execScript('CREATE TABLE t (v INTEGER NOT NULL) STRICT');
        assert.throws(
          () => db.immediate('bad', () => {
            db.run('INSERT INTO t VALUES (1)');
            return Promise.resolve();
          }),
          (e) => isQandeelError(e, 'ASYNC_IN_TRANSACTION'),
        );
        assert.equal(db.get('SELECT COUNT(*) AS n FROM t')?.n, 0, 'the write was rolled back');
        assert.throws(() => db.immediate('outer', () => db.immediate('inner', () => 1)), (e) => isQandeelError(e, 'STORAGE_INVARIANT'));
        assert.throws(() => db.immediate('throws', () => {
          db.run('INSERT INTO t VALUES (1)');
          throw new Error('boom');
        }), /boom/);
        assert.equal(db.get('SELECT COUNT(*) AS n FROM t')?.n, 0);
      } finally {
        db.close();
      }
    } finally {
      removeRoot(root);
    }
  });
});
