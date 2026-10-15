/**
 * G4-FINAL-CLOSURE-01 (D-P1-17) — migration 0023 only widens the Founder preview intent CHECK: a released v22 Company (the
 * live schema) upgrades keeping every preview row, every knowledge row and 0001–0022 unchanged, and the two decision intents
 * are accepted afterwards. No other table changes.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ManualClock } from '@qandeel-company/domain';
import { FounderActionStore, FounderAuthStore, loadReleasedMigrations } from '../src/index.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { seed } from './c2-helpers.js';
import { removeRoot, tempRoot } from './helpers.js';

describe('D-P1-17: migration 0023', () => {
  test('a released v22 Company upgrades to v23: previews, knowledge and 0001–0022 unchanged; only founder_action_previews is recreated; the decision intents are accepted', () => {
    const root = tempRoot('g4-fd-v22');
    try {
      const v22 = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(22) });
      const s = seed(v22);
      const auth = FounderAuthStore.for(v22);
      const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
      const company = s.gov.budgetFor('COMPANY', 'company');
      FounderActionStore.for(v22, auth).preview(session, 'BUDGET_CEILING', { budgetId: company?.id, capMoney: 12_000_000 });
      const d22 = storeContext(v22).db;
      const snap = (d: typeof d22, sql: string): string => JSON.stringify(d.all(sql));
      const previews = snap(d22, 'SELECT * FROM founder_action_previews ORDER BY 1, 2');
      const knowledge = snap(d22, 'SELECT * FROM knowledge_items ORDER BY id');
      const migrations = snap(d22, 'SELECT version, name, sha256, applied_at FROM schema_migrations ORDER BY version');
      const tables = snap(d22, "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name <> 'founder_action_previews' AND name NOT LIKE 'sqlite_%' ORDER BY name");
      assert.match(previews, /BUDGET_CEILING/);
      v22.close();
      const v23 = openStoreForTests(root, { clock: new ManualClock(), liveSchemaUpdate: true, migrations: loadReleasedMigrations(23) });
      try {
        assert.deepEqual(v23.migration.applied, [23]);
        const d = storeContext(v23).db;
        assert.equal(snap(d, 'SELECT * FROM founder_action_previews ORDER BY 1, 2'), previews, 'every preview row is kept as it was');
        assert.equal(snap(d, 'SELECT * FROM knowledge_items ORDER BY id'), knowledge, 'knowledge is untouched');
        assert.equal(snap(d, 'SELECT version, name, sha256, applied_at FROM schema_migrations WHERE version <= 22 ORDER BY version'), migrations, '0001–0022 unchanged');
        assert.equal(snap(d, "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name <> 'founder_action_previews' AND name NOT LIKE 'sqlite_%' ORDER BY name"), tables, 'no other table changes');
        const sql = String(d.get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'founder_action_previews'")?.sql);
        for (const intent of ['FOUNDER_DECISION_RECORD', 'FOUNDER_DECISION_REVOKE', 'EMPLOYEE_RENAME', 'PRODUCT_KNOWLEDGE_ACCESS', 'BUDGET_CEILING']) assert.match(sql, new RegExp(`'${intent}'`));
        assert.deepEqual(d.all('PRAGMA foreign_key_check'), []);
        assert.equal(v23.quickCheck(), 'ok');
      } finally {
        v23.close();
      }
    } finally {
      removeRoot(root);
    }
  });
});
