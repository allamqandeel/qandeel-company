import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';

import { isQandeelError } from '@qandeel-company/domain';

import { ArtifactStore, CURRENT_SCHEMA_VERSION, CompanyStore, clearUpdateHold, createBackup, listBackups, readUpdateHold, restoreToIsolatedWorkspace, rollbackSchemaUpdate, safeUpgrade, verifyBackup } from '../src/index.js';
import { SqliteConnection } from '../src/sqlite/connection.js';
import { backoff, executable, harness, owner, removeRoot, tempRoot } from './helpers.js';
import { checkpoint, claimNext, settle } from '../src/runtime-authority.js';

describe('online backup and isolated verification', () => {
  test('backup produces a self-contained verified snapshot + manifest; verification and isolated restore pass', async () => {
    const h = harness();
    const restoreRoot = tempRoot('restore');
    try {
      const id = executable(h.store);
      const claim = claimNext(h.store, h.claimOpts());
      assert.ok(claim);
      checkpoint(h.store, claim.fence, 'step', { step: 1 }, 1, 10_000);
      settle(h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
      const artifacts = new ArtifactStore(h.store);
      artifacts.put({ content: 'evidence', mediaType: 'text/plain', workItemId: id });

      const result = await createBackup(h.store, { runtimeVersion: '0.1.0-test' });
      assert.deepEqual(readdirSync(result.directory).sort(), ['company.sqlite3', 'manifest.json'], 'no -wal/-shm: the snapshot is one file');
      const m = result.manifest;
      assert.equal(m.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(m.integrity, 'ok');
      assert.equal(m.runtimeVersion, '0.1.0-test');
      assert.equal(m.counts.workItems, 1);
      assert.equal(m.artifacts.count, 1);
      assert.match(m.snapshot.sha256, /^[0-9a-f]{64}$/);
      assert.deepEqual(listBackups(h.store), [result.backupId]);
      assert.equal(h.store.healthCounts().lastBackup?.id, result.backupId);

      const v = verifyBackup(result.directory, { liveDatabasePath: h.store.workspace.databasePath, artifactObjectsDir: h.store.workspace.objectsDir });
      assert.equal(v.ok, true);
      assert.equal(v.artifactObjectsChecked, 1);

      const liveBefore = readFileSync(h.store.workspace.databasePath);
      const restored = restoreToIsolatedWorkspace(result.directory, restoreRoot, { liveDatabasePath: h.store.workspace.databasePath });
      assert.equal(restored.quickCheck, 'ok');
      assert.deepEqual(restored.counts, m.counts);
      assert.ok(readFileSync(h.store.workspace.databasePath).equals(liveBefore), 'the live database was never replaced');
      // The verification copy is inspected read-only (RR4-1: it is never opened as a Company).
      const reopened = CompanyStore.open(restoreRoot, { create: false, migrationMode: 'verify' });
      assert.equal(reopened.getWorkItem(id).state, 'COMPLETED');
      reopened.close();
    } finally {
      h.close();
      removeRoot(restoreRoot);
    }
  });

  test('RR4-1: an isolated restore-check target is a permanently held verification copy — no ordinary open, upgrade, rollback or hold-clear makes it a Company', async () => {
    const h = harness();
    const target = tempRoot('restore-check-copy');
    try {
      executable(h.store);
      const r = await createBackup(h.store);
      const report = restoreToIsolatedWorkspace(r.directory, target, { liveDatabasePath: h.store.workspace.databasePath });
      assert.deepEqual([report.quickCheck, report.verificationCopy, report.hold], ['ok', true, 'RESTORE_CHECK_COPY'], 'the report says it is a verification copy');
      const held = (e: unknown): boolean => isQandeelError(e, 'UPDATE_HOLD') && (e as { details?: { code?: string } }).details?.code === 'RESTORE_CHECK_COPY';
      assert.throws(() => CompanyStore.open(target), held, 'the ordinary open (the runtime\'s, init\'s) refuses the copy');
      assert.throws(() => CompanyStore.open(target, { create: false }), held);
      await assert.rejects(safeUpgrade(target), held, 'safe-upgrade (the runtime\'s automatic upgrade) refuses it');
      assert.throws(() => clearUpdateHold(target, 'operator.reviewed'), (e) => isQandeelError(e, 'MAINTENANCE_REFUSED'), 'the operator cannot clear a verification copy\'s hold');
      await assert.rejects(rollbackSchemaUpdate(target, '00000000-0000-4000-8000-000000000000'), (e) => isQandeelError(e, 'MAINTENANCE_REFUSED'), 'a rollback never replaces the permanent hold');
      assert.equal(readUpdateHold(target)?.code, 'RESTORE_CHECK_COPY', 'the hold is still in force');
      // Read-only verify-mode inspection still works.
      const inspect = CompanyStore.open(target, { create: false, migrationMode: 'verify' });
      assert.equal(inspect.quickCheck(), 'ok');
      inspect.close();
      // The live Company is untouched by the check.
      assert.equal(readUpdateHold(h.store.workspace.root), null);
    } finally {
      h.close();
      removeRoot(target);
    }
  });

  test('tampering is detected: snapshot bytes, manifest counts, and restore onto a non-empty target', async () => {
    const h = harness();
    const target = tempRoot('restore-nonempty');
    try {
      executable(h.store);
      const r = await createBackup(h.store);
      const manifestPath = path.join(r.directory, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { counts: { workItems: number } };
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, counts: { ...manifest.counts, workItems: 7 } }));
      assert.throws(() => verifyBackup(r.directory), (e) => isQandeelError(e, 'BACKUP_INTEGRITY'));

      const r2 = await createBackup(h.store);
      const snap = path.join(r2.directory, 'company.sqlite3');
      const bytes = readFileSync(snap);
      bytes[bytes.length - 100] = (bytes[bytes.length - 100] ?? 0) ^ 0xff;
      writeFileSync(snap, bytes);
      assert.throws(() => verifyBackup(r2.directory), (e) => isQandeelError(e, 'BACKUP_INTEGRITY'));

      // A replaced snapshot+manifest pair is detected against the live Company's own record.
      const r4 = await createBackup(h.store);
      const record = h.store.backupRecord(r4.backupId);
      assert.ok(record);
      assert.throws(() => verifyBackup(r4.directory, { expected: { ...record, manifestSha256: '0'.repeat(64) } }), (e) => isQandeelError(e, 'BACKUP_INTEGRITY'));
      assert.equal(verifyBackup(r4.directory, { expected: record }).ok, true);

      // A snapshot with an extra trigger (schema drift) is refused even when its hashes are re-signed.
      const r5 = await createBackup(h.store);
      const snap5 = path.join(r5.directory, 'company.sqlite3');
      const raw = SqliteConnection.open({ path: snap5, busyTimeoutMs: 1_000, keepJournalMode: true });
      raw.execScript('CREATE TRIGGER planted AFTER INSERT ON work_items BEGIN SELECT 1; END;');
      raw.close();
      const m5Path = path.join(r5.directory, 'manifest.json');
      const m5 = JSON.parse(readFileSync(m5Path, 'utf8')) as { snapshot: { sha256: string } };
      m5.snapshot.sha256 = createHash('sha256').update(readFileSync(snap5)).digest('hex');
      writeFileSync(m5Path, JSON.stringify(m5));
      assert.throws(() => verifyBackup(r5.directory), (e) => isQandeelError(e, 'BACKUP_INTEGRITY') && /schema/.test(e.message));

      // The restore target must be outside the live workspace.
      assert.throws(
        () => restoreToIsolatedWorkspace(r4.directory, path.join(h.root, 'runtime', 'nested'), { liveDatabasePath: h.store.workspace.databasePath }),
        (e) => isQandeelError(e, 'UNSAFE_WORKSPACE'),
      );

      const r3 = await createBackup(h.store);
      writeFileSync(path.join(path.dirname(target), 'marker'), 'x');
      CompanyStore.open(target).close();
      assert.throws(() => restoreToIsolatedWorkspace(r3.directory, target), (e) => isQandeelError(e, 'UNSAFE_WORKSPACE'));
    } finally {
      h.close();
      removeRoot(target);
    }
  });

  test('backup while the database is actively written by another connection yields a consistent snapshot', async () => {
    const h = harness();
    try {
      const writer = h.open();
      for (let i = 0; i < 200; i++) writer.createWorkItem({ objective: `seed ${i}`, ownerRef: owner });
      let writes = 0;
      let stop = false;
      const load = (async () => {
        while (!stop) {
          writer.createWorkItem({ objective: `during backup ${writes}`, ownerRef: owner, initialState: 'READY', processorKind: 'test.noop' });
          writes++;
          await tick();
        }
      })();
      const results = [];
      for (let i = 0; i < 3; i++) results.push(await createBackup(h.store));
      stop = true;
      await load;
      assert.ok(writes > 0, 'writes really happened concurrently');
      for (const r of results) {
        const v = verifyBackup(r.directory);
        assert.equal(v.integrity, 'ok');
        assert.ok(v.counts.workItems >= 200, 'snapshot contains at least everything committed before it began');
        assert.equal(v.counts.jobs, v.counts.workItems - 200, 'every READY item in the snapshot has its job: a transactionally consistent image');
        assert.ok(!existsSync(path.join(r.directory, 'company.sqlite3-wal')));
      }
    } finally {
      h.close();
    }
  });
});
