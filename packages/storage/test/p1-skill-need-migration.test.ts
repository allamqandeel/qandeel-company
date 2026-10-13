/**
 * G4-C2-SNA-01 (D-P1-15) — migration 0023 only adds the append-only `skill_need_assessments` table: a released v22 Company
 * upgrades keeping every row of every existing table and 0001–0022 unchanged; the new table starts empty, takes a decision
 * row and refuses any update or delete.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ManualClock, type Id } from '@qandeel-company/domain';
import { CommunicationStore, GovernanceStore, loadReleasedMigrations } from '../src/index.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { seed } from './c2-helpers.js';
import { placed } from './c4-helpers.js';
import { removeRoot, tempRoot, type Harness } from './helpers.js';

describe('D-P1-15: migration 0023', () => {
  test('a released v22 Company upgrades to v23: every existing row and migration 0001–0022 is unchanged; the new table is additive and append-only', () => {
    const root = tempRoot('p1-sna-v22');
    try {
      const v22 = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(22) });
      const s = seed(v22);
      const d22 = storeContext(v22).db;
      const tables = d22.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);
      const snap = (d: typeof d22): string => JSON.stringify(tables.map((t) => [t, d.all(`SELECT * FROM "${t}" ORDER BY 1`)]).filter(([t]) => t !== 'schema_migrations'));
      const before = snap(d22);
      const migrations = JSON.stringify(d22.all('SELECT version, name, sha256, applied_at FROM schema_migrations ORDER BY version'));
      assert.equal(tables.includes('skill_need_assessments'), false);
      v22.close();
      const v23 = openStoreForTests(root, { clock: new ManualClock(), liveSchemaUpdate: true, migrations: loadReleasedMigrations(23) });
      try {
        assert.deepEqual(v23.migration.applied, [23]);
        const d = storeContext(v23).db;
        assert.equal(snap(d), before, 'every row of every existing table is kept as it was');
        assert.equal(JSON.stringify(d.all('SELECT version, name, sha256, applied_at FROM schema_migrations WHERE version <= 22 ORDER BY version')), migrations, '0001–0022 unchanged');
        assert.equal(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM skill_need_assessments')?.n, 0);
        // A decision row for a real message (a CEO seated after the upgrade), then no change.
        const s23 = { ...s, gov: GovernanceStore.for(v23) };
        placed({ store: v23 } as unknown as Harness, s23, 'company.ceo', 1_000_000);
        const thread = CommunicationStore.for(v23).directThread(s.founder, null).id;
        CommunicationStore.for(v23).send(s.founder, thread, { purpose: 'FYI', body: 'SYNTHETIC: a note after the upgrade' });
        const msg = d.get<{ id: string }>('SELECT id FROM communication_messages LIMIT 1') as { id: string };
        const { workItem } = v23.createWorkItem({ objective: 'synthetic reply', ownerRef: s.employee.ref });
        d.immediate('fixture', () => d.run(
          `INSERT INTO skill_need_assessments (id, reply_work_item_id, assessment_work_item_id, employee_id, message_id, message_sha256, policy, prompt_version, prompt_sha256, cards_version, cards_sha256, offered_json, source, outcome, tiers_json, run_id, manifest_id, sealed_by, created_at)
           VALUES (?, ?, NULL, ?, ?, ?, 'SNA-1', NULL, NULL, 'SNC-1', ?, '[]', 'FALLBACK', 'NOT_PROVISIONED', '{}', NULL, NULL, 'SEND', '2026-10-13T00:00:00.000Z')`,
          '00000000-0000-4000-8000-000000000023', workItem.id as Id, s.employee.id, msg.id, 'a'.repeat(64), 'b'.repeat(64),
        ));
        assert.throws(() => d.run(`UPDATE skill_need_assessments SET outcome = 'CLASSIFIED'`), (e: unknown) => /append-only/.test(String((e as { cause?: { message?: string } }).cause?.message)));
        assert.throws(() => d.run('DELETE FROM skill_need_assessments'), (e: unknown) => /append-only/.test(String((e as { cause?: { message?: string } }).cause?.message)));
        // A model result must name its assessment, run, manifest and prompt; only a model result is CLASSIFIED.
        assert.throws(() => d.run(
          `INSERT INTO skill_need_assessments (id, reply_work_item_id, employee_id, message_id, message_sha256, policy, cards_version, cards_sha256, offered_json, source, outcome, tiers_json, sealed_by, created_at)
           VALUES ('00000000-0000-4000-8000-000000000024', ?, ?, ?, ?, 'SNA-1', 'SNC-1', ?, '[]', 'MODEL', 'CLASSIFIED', '{}', 'ASSESSMENT', '2026-10-13T00:00:00.000Z')`,
          v23.createWorkItem({ objective: 'synthetic reply 2', ownerRef: s.employee.ref }).workItem.id, s.employee.id, msg.id, 'a'.repeat(64), 'b'.repeat(64),
        ));
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
