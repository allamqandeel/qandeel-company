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
      assert.deepEqual(s1.migration, { fromVersion: 0, toVersion: CURRENT_SCHEMA_VERSION, applied: Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, i) => i + 1) });
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
      const next = CURRENT_SCHEMA_VERSION + 1;
      const broken = fixture(next, 'broken', 'CREATE TABLE half_done (x INTEGER) STRICT;\nINSERT INTO no_such_table VALUES (1);\n');
      assert.throws(() => openStoreForTests(root, { clock, migrations: [...base, broken] }), (e) => isQandeelError(e, 'MIGRATION_FAILED') && e.details.version === next);
      const again = CompanyStore.open(root, { clock });
      assert.equal(again.schemaVersion, CURRENT_SCHEMA_VERSION);
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
      assert.deepEqual(current.migration.applied, Array.from({ length: CURRENT_SCHEMA_VERSION - 1 }, (_, i) => i + 2));
      assert.equal(current.getWorkItem(workItem.id).objective, 'created on schema v1');
      assert.equal(current.history(workItem.id).length, 1);
      current.close();
    } finally {
      removeRoot(root);
    }
  });

  test('C4-PROOF: real released v6 → current (v8 + the C5 v9 tables) preserves every C2 organization / money row and adopts existing Departments by code', () => {
    const root = tempRoot('mig-v6-v8');
    try {
      const v6 = openStoreForTests(root, { clock, migrations: loadReleasedMigrations(6) });
      const db = storeContext(v6).db;
      const at = '2026-01-01T00:00:00.000Z';
      const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      db.immediate('v6 fixture', () => {
        db.run(`INSERT INTO departments (id, code, name, status, created_at, updated_at) VALUES (?, 'growth', 'Growth (pre-C4)', 'ACTIVE', ?, ?)`, id(1), at, at);
        db.run(`INSERT INTO departments (id, code, name, status, created_at, updated_at) VALUES (?, 'finance', 'Finance', 'ACTIVE', ?, ?)`, id(2), at, at);
        db.run(
          `INSERT INTO employees (id, given_name, family_name, name_origin, profile_json, cognitive_profile_json, role_ref, position_ref, department_id, manager_ref, state, version, created_at, updated_at)
           VALUES (?, 'Nour', 'Hassan', 'EG', '{}', '{"ceilingClass":"E2","costDiscipline":"BALANCED","defaultClass":"E1"}', 'role:analyst', 'position:p1', ?, 'founder:x', 'CANDIDATE', 1, ?, ?)`,
          id(3), id(1), at, at,
        );
        db.run(`INSERT INTO budgets (id, scope, scope_id, parent_id, currency, cap_money, cap_tokens, version, created_by_ref, created_at, updated_at) VALUES (?, 'COMPANY', 'company', NULL, 'USD', 1000, 1000, 1, 'founder:x', ?, ?)`, id(4), at, at);
        db.run(`INSERT INTO budgets (id, scope, scope_id, parent_id, currency, cap_money, cap_tokens, version, created_by_ref, created_at, updated_at) VALUES (?, 'DEPARTMENT', ?, ?, 'USD', 500, 500, 1, 'founder:x', ?, ?)`, id(5), id(1), id(4), at, at);
        db.run(`INSERT INTO budgets (id, scope, scope_id, parent_id, currency, cap_money, cap_tokens, version, created_by_ref, created_at, updated_at) VALUES (?, 'EMPLOYEE', ?, ?, 'USD', 100, 100, 1, 'founder:x', ?, ?)`, id(6), id(3), id(5), at, at);
      });
      v6.close();
      const v8 = CompanyStore.open(root, { clock });
      try {
      // C5 appended 0009 (Founder surface tables only): the C4 rows are still preserved across the full upgrade.
      assert.deepEqual(v8.migration.applied, [7, 8, 9]);
      const d8 = storeContext(v8).db;
      const growth = d8.get<{ id: string; name: string }>(`SELECT id, name FROM departments WHERE code = 'growth'`);
      assert.deepEqual({ ...growth }, { id: id(1), name: 'Growth (pre-C4)' }, 'an existing Department is adopted by code, never duplicated or renamed');
      assert.equal(d8.get<{ n: number }>(`SELECT COUNT(*) AS n FROM departments`)?.n, 6, 'the four missing canonical Departments are added; the extra one is kept');
      assert.deepEqual({ ...d8.get(`SELECT department_id, org_scope, role_ref, state FROM employees WHERE id = ?`, id(3)) }, { department_id: id(1), org_scope: 'DEPARTMENT', role_ref: 'role:analyst', state: 'CANDIDATE' });
      assert.deepEqual(d8.all<{ id: string; status: string }>(`SELECT id, status FROM budgets ORDER BY id`).map((b) => [b.id, b.status]), [[id(4), 'OPEN'], [id(5), 'OPEN'], [id(6), 'OPEN']]);
      assert.equal(d8.get<{ id: string }>(`SELECT director_position_id AS id FROM department_charters WHERE department_id = ?`, id(1))?.id !== undefined, true, 'the adopted Department gets its baseline charter and Director seat');
      assert.deepEqual(d8.all('PRAGMA foreign_key_check'), []);
      assert.equal(v8.quickCheck(), 'ok');
      } finally {
        v8.close();
      }
    } finally {
      removeRoot(root);
    }
  });

  test('real released v2 → v3 (durable wake generation): data kept, generation starts at 0 and advances with queued work', () => {
    const root = tempRoot('mig-v2-v3');
    try {
      const v2 = openStoreForTests(root, { clock, migrations: loadReleasedMigrations(2) });
      assert.equal(v2.schemaVersion, 2);
      assert.ok(!tables(v2).includes('runtime_wake'));
      const { workItem } = v2.createWorkItem({ objective: 'queued on schema v2', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY' });
      v2.close();
      const v3 = openStoreForTests(root, { clock, migrations: loadReleasedMigrations(3) });
      assert.deepEqual(v3.migration, { fromVersion: 2, toVersion: 3, applied: [3] });
      assert.equal(v3.getWorkItem(workItem.id).state, 'READY');
      assert.equal(v3.jobsFor(workItem.id)[0]?.state, 'QUEUED', 'the v2 job survives the upgrade');
      assert.equal(v3.wakeGeneration(), 0, 'the upgrade itself signals nothing; startup recovery pumps anyway');
      v3.createWorkItem({ objective: 'queued on schema v3', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY' });
      assert.equal(v3.wakeGeneration(), 1);
      // The counter is guarded like history: it never decreases and its row is never deleted.
      const db = storeContext(v3).db;
      const refused = (text: RegExp) => (e: unknown) => isQandeelError(e, 'STORAGE_INVARIANT') && text.test(String((e as Error).cause));
      assert.throws(() => db.immediate('t', () => db.run('UPDATE runtime_wake SET generation = 0 WHERE id = 1')), refused(/only ever increases/));
      assert.throws(() => db.immediate('t', () => db.run('DELETE FROM runtime_wake')), refused(/permanent/));
      assert.throws(() => db.immediate('t', () => db.run('INSERT INTO runtime_wake (id, generation) VALUES (2, 5)')));
      v3.close();
    } finally {
      removeRoot(root);
    }
  });

  test('a database from a future release is refused; nothing is downgraded', () => {
    const root = tempRoot('mig-future');
    try {
      CompanyStore.open(root, { clock }).close();
      assert.throws(() => openStoreForTests(root, { clock, migrations: loadReleasedMigrations(1) }), (e) => isQandeelError(e, 'SCHEMA_FROM_FUTURE'));
      // A v2 (pre-remediation) runtime refuses the v3 database instead of running without wake truth.
      assert.throws(() => openStoreForTests(root, { clock, migrations: loadReleasedMigrations(2) }), (e) => isQandeelError(e, 'SCHEMA_FROM_FUTURE'));
      const s = CompanyStore.open(root, { clock });
      assert.equal(s.schemaVersion, CURRENT_SCHEMA_VERSION);
      s.close();
    } finally {
      removeRoot(root);
    }
  });

  test('the public open() never executes caller-supplied migrations (no SQL surface)', () => {
    const root = tempRoot('mig-public');
    try {
      const sql = 'CREATE TABLE smuggled (x INTEGER) STRICT;\n';
      const smuggled = { version: CURRENT_SCHEMA_VERSION + 1, name: 'x', sql, sha256: migrationChecksum(sql) };
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
      assert.doesNotMatch(sql, /\bDELETE\s+FROM\b|ON\s+DELETE\s+CASCADE/i, pin.file);
      // The only DROP TABLE a migration may contain is the row-preserving rebuild of D-C4-01: the table is
      // first copied whole into a TEMP table, re-created, every row copied back, then the TEMP copy dropped.
      const drops = [...sql.matchAll(/\bDROP\s+TABLE\s+([A-Za-z0-9_.]+)/gi)].map((m) => String(m[1]));
      for (const target of drops) {
        const temp = /^temp\.(c4_copy_[a-z0-9_]+)$/.exec(target);
        if (temp) {
          assert.ok(new RegExp(`CREATE TEMP TABLE ${temp[1]} AS SELECT \\* FROM main\\.`).test(sql), `${pin.file}: ${target} is a rebuild copy`);
          continue;
        }
        const main = /^main\.([a-z_]+)$/.exec(target);
        assert.ok(main, `${pin.file}: DROP TABLE ${target} is not part of a row-preserving rebuild`);
        const t = String(main?.[1]);
        assert.match(sql, new RegExp(`CREATE TEMP TABLE c4_copy_${t} AS SELECT \\* FROM main\\.${t};\\s*DROP TABLE main\\.${t};\\s*CREATE TABLE ${t} \\(`), `${pin.file}: ${t} is copied whole before it is re-created`);
        assert.match(sql, new RegExp(`INSERT INTO ${t} \\([^)]*\\)\\s*SELECT [^;]* FROM temp\\.c4_copy_${t};`), `${pin.file}: every row of ${t} is copied back`);
      }
    }
  });
});
