/**
 * P1-DESKTOP-UPGRADE-CORR-01 — the cross-version schema inspection a newer release reads an older Company through:
 * a verified older history is UPDATE_REQUIRED with its supervisor holder still visible; a current one is CURRENT; a
 * future schema, a drifted or incoherent history, a database that is not a Company and a live restore keep their own
 * refusal codes; and the inspection never migrates or writes.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { ManualClock, isQandeelError, newId } from '@qandeel-company/domain';

import { CompanyStore, inspectCompanySchema, loadReleasedMigrations } from '../src/index.js';
import { acquireSupervisor, registerInstance } from '../src/runtime-authority.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { HOLD_FILE, RESTORE_IN_PROGRESS, maintenanceDir } from '../src/update-hold.js';
import { seed } from './c2-helpers.js';
import { removeRoot, tempRoot } from './helpers.js';

const code = (fn: () => unknown): string => {
  try {
    fn();
    return 'NONE';
  } catch (error) {
    return isQandeelError(error) ? error.code : String(error);
  }
};

/** A released v21 Company with history, and (optionally) a live supervisor held by a registered instance. */
function v21Company(label: string, holder: boolean): { root: string; holderId: string | null } {
  const root = tempRoot(label);
  const store = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(21) });
  try {
    seed(store);
    if (!holder) return { root, holderId: null };
    const holderId = newId();
    registerInstance(store, holderId, process.pid, 'test');
    acquireSupervisor(store, holderId, 600_000);
    return { root, holderId };
  } finally {
    store.close();
  }
}

describe('P1-DESKTOP-UPGRADE-CORR-01: cross-version schema inspection', () => {
  test('a verified v21 history is UPDATE_REQUIRED for this release, its live holder visible; nothing is migrated or written', () => {
    const { root, holderId } = v21Company('inspect-v21', true);
    try {
      // The ordinary read-only open of this release refuses it: the reason the activation needs the inspection.
      assert.equal(code(() => CompanyStore.open(root, { create: false, migrationMode: 'verify' })), 'SCHEMA_NOT_READY');
      const r = inspectCompanySchema(root);
      assert.equal(r.schema, 'UPDATE_REQUIRED');
      assert.equal(r.databaseVersion, 21);
      assert.equal(r.releaseVersion, loadReleasedMigrations().length);
      assert.equal(r.lease?.holderId, holderId, 'the previous host stays identifiable');
      assert.equal(r.instance?.id, holderId);
      assert.equal(r.instance?.pid, process.pid);
      const again = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(21) });
      try {
        assert.equal(again.schemaVersion, 21, 'the inspection never migrates');
        assert.equal(storeContext(again).db.get<{ n: number }>("SELECT COUNT(*) AS n FROM schema_migrations")?.n, 21);
      } finally {
        again.close();
      }
    } finally {
      removeRoot(root);
    }
  });

  test('a current Company is CURRENT; one nobody holds shows no lease', () => {
    const root = tempRoot('inspect-current');
    try {
      CompanyStore.open(root).close();
      const r = inspectCompanySchema(root);
      assert.equal(r.schema, 'CURRENT');
      assert.equal(r.databaseVersion, r.releaseVersion);
      assert.equal(r.lease, null);
      assert.equal(r.instance, null);
    } finally {
      removeRoot(root);
    }
  });

  test('refusals keep their codes: future schema, drifted or incoherent history, no Company schema, live restore', () => {
    const { root } = v21Company('inspect-refusals', false);
    try {
      const store = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(21) });
      try {
        // Drift: an applied migration that no longer matches its source.
        const db = storeContext(store).db;
        db.immediate('drift', () => db.run("UPDATE schema_migrations SET sha256 = ? WHERE version = 5", '0'.repeat(64)));
      } finally {
        store.close();
      }
      assert.equal(code(() => inspectCompanySchema(root)), 'MIGRATION_CHECKSUM_DRIFT');

      const coherent = tempRoot('inspect-incoherent');
      const s2 = openStoreForTests(coherent, { clock: new ManualClock(), migrations: loadReleasedMigrations(21) });
      try {
        storeContext(s2).db.execScript('PRAGMA user_version = 20');
      } finally {
        s2.close();
      }
      assert.equal(code(() => inspectCompanySchema(coherent)), 'STORAGE_INVARIANT');
      removeRoot(coherent);

      const future = tempRoot('inspect-future');
      const s3 = CompanyStore.open(future);
      try {
        const d = storeContext(s3).db;
        const next = loadReleasedMigrations().length + 1;
        d.immediate('future', () => {
          d.run("INSERT INTO schema_migrations (version, name, sha256, runtime_version, applied_at) VALUES (?, 'future', ?, 'x', '2026-01-01T00:00:00.000Z')", next, 'f'.repeat(64));
          d.execScript(`PRAGMA user_version = ${next}`);
        });
      } finally {
        s3.close();
      }
      assert.equal(code(() => inspectCompanySchema(future)), 'SCHEMA_FROM_FUTURE');

      const empty = tempRoot('inspect-empty');
      const s4 = openStoreForTests(empty, { clock: new ManualClock(), migrations: [] });
      s4.close();
      assert.equal(code(() => inspectCompanySchema(empty)), 'SCHEMA_NOT_READY', 'a database without a Company schema');
      removeRoot(empty);

      const restoring = tempRoot('inspect-restore');
      CompanyStore.open(restoring).close();
      mkdirSync(maintenanceDir(restoring), { recursive: true });
      writeFileSync(path.join(maintenanceDir(restoring), HOLD_FILE), `${JSON.stringify({ code: RESTORE_IN_PROGRESS, at: new Date().toISOString() })}\n`);
      assert.equal(code(() => inspectCompanySchema(restoring)), 'UPDATE_HOLD', 'a live restore in progress is never read');
      removeRoot(restoring);
      removeRoot(future);
    } finally {
      removeRoot(root);
    }
  });
});
