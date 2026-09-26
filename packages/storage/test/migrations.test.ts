import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { ManualClock, isQandeelError } from '@qandeel-company/domain';

import { CURRENT_SCHEMA_VERSION, CompanyStore, RELEASED_MIGRATIONS, loadReleasedMigrations, migrationChecksum, type Migration } from '../src/index.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { owner, removeRoot, tempRoot } from './helpers.js';

const clock = new ManualClock();

function fixture(version: number, name: string, sql: string): Migration {
  return { version, name, sql, sha256: migrationChecksum(sql) };
}

function tables(store: CompanyStore): string[] {
  return storeContext(store)
    .db.all<{ name: string }>(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .map((r) => r.name);
}

describe('versioned migrations', () => {
  test('released migration files match their pinned SHA-256 (immutability)', () => {
    const loaded = loadReleasedMigrations();
    assert.equal(loaded.length, CURRENT_SCHEMA_VERSION);
    for (const [i, m] of loaded.entries()) assert.equal(m.sha256, RELEASED_MIGRATIONS[i]?.sha256);
    assert.equal(migrationChecksum('a\r\nb\n'), migrationChecksum('a\nb\n'), 'CRLF checkouts do not cause false drift');
  });

  test('clean database: creation goes through the migrations; restart applies nothing', () => {
    const root = tempRoot('mig');
    try {
      const s1 = CompanyStore.open(root, { clock });
      assert.deepEqual(s1.migration, { fromVersion: 0, toVersion: CURRENT_SCHEMA_VERSION, applied: [1, 2] });
      assert.equal(s1.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.ok(tables(s1).includes('work_items') && tables(s1).includes('queue_jobs') && tables(s1).includes('schema_migrations'));
      s1.close();
      const s2 = CompanyStore.open(root, { clock });
      assert.deepEqual(s2.migration.applied, []);
      s2.close();
    } finally {
      removeRoot(root);
    }
  });

  test('a failing migration rolls back and leaves the prior coherent version', () => {
    const root = tempRoot('mig-fail');
    try {
      const base = loadReleasedMigrations();
      CompanyStore.open(root, { clock }).close();
      const broken = fixture(3, 'broken', 'CREATE TABLE half_done (x INTEGER) STRICT;\nINSERT INTO no_such_table VALUES (1);\n');
      assert.throws(() => openStoreForTests(root, { clock, migrations: [...base, broken] }), (e) => isQandeelError(e, 'MIGRATION_FAILED') && e.details.version === 3);
      const again = CompanyStore.open(root, { clock });
      assert.equal(again.schemaVersion, 2);
      assert.ok(!tables(again).includes('half_done'), 'DDL of the failed migration was rolled back');
      again.close();
    } finally {
      removeRoot(root);
    }
  });

  test('a migration that throws just before commit leaves nothing behind', () => {
    const root = tempRoot('mig-throw');
    try {
      assert.throws(
        () => openStoreForTests(root, { clock, migrationFault: (v) => { if (v === 2) throw new Error('injected'); } }),
        (e) => isQandeelError(e, 'MIGRATION_FAILED'),
      );
      const s = openStoreForTests(root, { clock, migrations: loadReleasedMigrations(1) });
      assert.equal(s.schemaVersion, 1);
      assert.ok(!tables(s).includes('queue_jobs'));
      s.close();
    } finally {
      removeRoot(root);
    }
  });

  test('an applied migration whose text changed is refused (checksum drift)', () => {
    const root = tempRoot('mig-drift');
    try {
      const v1 = fixture(1, 'one', 'CREATE TABLE a (x INTEGER) STRICT;\n');
      openStoreForTests(root, { clock, migrations: [v1] }).close();
      const edited = fixture(1, 'one', 'CREATE TABLE a (x INTEGER, y INTEGER) STRICT;\n');
      assert.throws(() => openStoreForTests(root, { clock, migrations: [edited] }), (e) => isQandeelError(e, 'MIGRATION_CHECKSUM_DRIFT'));
      // A text that does not match its own recorded checksum is refused before touching the DB.
      assert.throws(() => openStoreForTests(root, { clock, migrations: [{ ...v1, sql: `${v1.sql}-- x\n` }] }), (e) => isQandeelError(e, 'MIGRATION_CHECKSUM_DRIFT'));
    } finally {
      removeRoot(root);
    }
  });

  test('old schema → current schema preserves data (real released v1 → v2)', () => {
    const root = tempRoot('mig-upgrade');
    try {
      const old = openStoreForTests(root, { clock, migrations: loadReleasedMigrations(1) });
      assert.equal(old.schemaVersion, 1);
      const { workItem } = old.createWorkItem({ objective: 'created on schema v1', ownerRef: owner, initialState: 'READY' });
      old.close();
      const current = CompanyStore.open(root, { clock });
      assert.deepEqual(current.migration.applied, [2]);
      assert.equal(current.getWorkItem(workItem.id).objective, 'created on schema v1');
      assert.equal(current.history(workItem.id).length, 1);
      current.close();
    } finally {
      removeRoot(root);
    }
  });

  test('a database from a future release is refused; nothing is downgraded', () => {
    const root = tempRoot('mig-future');
    try {
      CompanyStore.open(root, { clock }).close();
      assert.throws(() => openStoreForTests(root, { clock, migrations: loadReleasedMigrations(1) }), (e) => isQandeelError(e, 'SCHEMA_FROM_FUTURE'));
      const s = CompanyStore.open(root, { clock });
      assert.equal(s.schemaVersion, 2);
      s.close();
    } finally {
      removeRoot(root);
    }
  });

  test('the public open() never executes caller-supplied migrations (no SQL surface)', () => {
    const root = tempRoot('mig-public');
    try {
      const sql = 'CREATE TABLE smuggled (x INTEGER) STRICT;\n';
      const smuggled = { version: 3, name: 'x', sql, sha256: migrationChecksum(sql) };
      const s = CompanyStore.open(root, { clock, migrations: [...loadReleasedMigrations(), smuggled] } as never);
      assert.equal(s.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.ok(!tables(s).includes('smuggled'));
      s.close();
    } finally {
      removeRoot(root);
    }
  });

  test('migration files carry no destructive statements against history tables', () => {
    for (const pin of RELEASED_MIGRATIONS) {
      const sql = readFileSync(new URL(`../../migrations/${pin.file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(sql, /\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|ON\s+DELETE\s+CASCADE/i, pin.file);
    }
  });
});
