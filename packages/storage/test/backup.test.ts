import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';

import { isQandeelError } from '@qandeel-company/domain';

import { ArtifactStore, CompanyStore, createBackup, listBackups, restoreToIsolatedWorkspace, verifyBackup } from '../src/index.js';
import { backoff, claimOpts, executable, harness, owner, removeRoot, tempRoot } from './helpers.js';

describe('online backup and isolated verification', () => {
  test('backup produces a self-contained verified snapshot + manifest; verification and isolated restore pass', async () => {
    const h = harness();
    const restoreRoot = tempRoot('restore');
    try {
      const id = executable(h.store);
      const claim = h.store.claimNext(claimOpts());
      assert.ok(claim);
      h.store.checkpoint(claim.fence, 'step', { step: 1 }, 1, 10_000);
      h.store.settle(claim.fence, { type: 'COMPLETED' }, { backoff });
      const artifacts = new ArtifactStore(h.store);
      artifacts.put({ content: 'evidence', mediaType: 'text/plain', workItemId: id });

      const result = await createBackup(h.store, { runtimeVersion: '0.1.0-test' });
      assert.deepEqual(readdirSync(result.directory).sort(), ['company.sqlite3', 'manifest.json'], 'no -wal/-shm: the snapshot is one file');
      const m = result.manifest;
      assert.equal(m.schemaVersion, 2);
      assert.equal(m.integrity, 'ok');
      assert.equal(m.runtimeVersion, '0.1.0-test');
      assert.equal(m.counts.workItems, 1);
      assert.equal(m.artifacts.count, 1);
      assert.match(m.snapshot.sha256, /^[0-9a-f]{64}$/);
      assert.deepEqual(listBackups(h.store.workspace.backupsDir), [result.backupId]);
      assert.equal(h.store.healthCounts().lastBackup?.id, result.backupId);

      const v = verifyBackup(result.directory, { liveDatabasePath: h.store.workspace.databasePath, artifactObjectsDir: h.store.workspace.objectsDir });
      assert.equal(v.ok, true);
      assert.equal(v.artifactObjectsChecked, 1);

      const liveBefore = readFileSync(h.store.workspace.databasePath);
      const restored = restoreToIsolatedWorkspace(result.directory, restoreRoot, { liveDatabasePath: h.store.workspace.databasePath });
      assert.equal(restored.quickCheck, 'ok');
      assert.deepEqual(restored.counts, m.counts);
      assert.ok(readFileSync(h.store.workspace.databasePath).equals(liveBefore), 'the live database was never replaced');
      const reopened = CompanyStore.open(restoreRoot);
      assert.equal(reopened.getWorkItem(id).state, 'COMPLETED');
      reopened.close();
    } finally {
      h.close();
      removeRoot(restoreRoot);
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
