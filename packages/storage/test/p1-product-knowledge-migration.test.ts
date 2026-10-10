/**
 * P1-PRODUCT-KNOWLEDGE-01 (D-P1-06) — migration 0022 only widens the Founder preview intent CHECK: a released v21 Company
 * upgrades keeping every preview row and 0001–0021 unchanged, and the two new intents are accepted afterwards.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ManualClock } from '@qandeel-company/domain';
import { FounderActionStore, FounderAuthStore, loadReleasedMigrations } from '../src/index.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { seed } from './c2-helpers.js';
import { removeRoot, tempRoot } from './helpers.js';

describe('D-P1-06: migration 0022', () => {
  test('a released v21 Company upgrades to v22: every Founder preview and migration 0001–0021 is unchanged; the rename and product-knowledge intents are accepted', () => {
    const root = tempRoot('p1-pk-v21');
    try {
      const v21 = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(21) });
      const s = seed(v21);
      const auth = FounderAuthStore.for(v21);
      const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
      const company = s.gov.budgetFor('COMPANY', 'company');
      FounderActionStore.for(v21, auth).preview(session, 'BUDGET_CEILING', { budgetId: company?.id, capMoney: 12_000_000 });
      const d21 = storeContext(v21).db;
      const snap = (d: typeof d21): string => JSON.stringify(d.all('SELECT * FROM founder_action_previews ORDER BY 1, 2'));
      const before = snap(d21);
      const migrations = JSON.stringify(d21.all('SELECT version, name, sha256, applied_at FROM schema_migrations ORDER BY version'));
      assert.match(before, /BUDGET_CEILING/);
      v21.close();
      const v22 = openStoreForTests(root, { clock: new ManualClock(), liveSchemaUpdate: true, migrations: loadReleasedMigrations(22) });
      try {
        assert.deepEqual(v22.migration.applied, [22]);
        const d = storeContext(v22).db;
        assert.equal(snap(d), before, 'every preview row is kept as it was');
        assert.equal(JSON.stringify(d.all('SELECT version, name, sha256, applied_at FROM schema_migrations WHERE version <= 21 ORDER BY version')), migrations, '0001–0021 unchanged');
        const sql = String(d.get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'founder_action_previews'")?.sql);
        assert.match(sql, /'EMPLOYEE_RENAME'/);
        assert.match(sql, /'PRODUCT_KNOWLEDGE_ACCESS'/);
        assert.deepEqual(d.all('PRAGMA foreign_key_check'), []);
        assert.equal(v22.quickCheck(), 'ok');
      } finally {
        v22.close();
      }
    } finally {
      removeRoot(root);
    }
  });
});
