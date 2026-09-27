/**
 * C1-PROOF: backup-finalization-contention (D-C1-24, Founder-host failure on 71f2edf).
 *
 * The final `backup_records` transaction of `createBackup` can lose the write-lock race to another
 * writer. These tests make that BUSY deterministic: a second, independent SQLite connection holds
 * `BEGIN IMMEDIATE` on the live database, the store under test uses a small busy timeout, and the
 * retry delay is an injected function (the only place the locker is released). No wall-clock race
 * decides the outcome.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { isQandeelError, newId, sha256Hex, type Id } from '@qandeel-company/domain';

import { CompanyStore, createBackup, listBackups, verifyBackup } from '../src/index.js';
import {
  DEFAULT_BACKUP_FINALIZATION_POLICY,
  backupRecordFor,
  createBackupInternal,
  finalizationDelayMs,
  finalizeBackupRecord,
  recordBackupOnce,
  type BackupFinalizationPolicy,
} from '../src/backup.js';
import { SqliteConnection } from '../src/sqlite/connection.js';
import { executable, harness, type Harness } from './helpers.js';

const BUSY_MS = 50;

const openLockers: { release(): void }[] = [];

/** Releases any lock a failed assertion left held, so cleanup (and the real failure) stays visible on Windows. */
function releaseLockers(): void {
  for (const l of openLockers.splice(0)) l.release();
}

/** A second connection that holds the live database's write lock until `release()`. */
function lockWriter(h: Harness): { release(): void; held(): boolean } {
  const db = SqliteConnection.open({ path: h.store.workspace.databasePath, busyTimeoutMs: 1_000 });
  db.execScript('BEGIN IMMEDIATE');
  let held = true;
  const locker = {
    release() {
      if (!held) return;
      db.execScript('COMMIT');
      db.close();
      held = false;
    },
    held: () => held,
  };
  openLockers.push(locker);
  return locker;
}

function backupRows(store: CompanyStore): number {
  return store.auditByAction('backup.created').length;
}

describe('backup finalization under write contention (D-C1-24)', () => {
  test('first finalization attempt is BUSY, the lock is released during the retry delay, the retry records exactly one row', async () => {
    const h = harness({ busyTimeoutMs: BUSY_MS });
    try {
      executable(h.store);
      const earlier = await createBackup(h.store);
      const locker = lockWriter(h);
      const delays: number[] = [];
      const result = await createBackupInternal(h.store, {}, {
        policy: {
          random: () => 1,
          sleep: async (ms) => {
            delays.push(ms);
            // The store's own connection is outside any transaction here: a nested one would throw.
            assert.notEqual(h.store.backupRecord(earlier.backupId), null);
            locker.release();
          },
        },
      });
      assert.equal(locker.held(), false);
      assert.deepEqual(result.finalization, { outcome: 'RECORDED', attempts: 2 }, 'the first attempt really met BUSY; the second one recorded');
      assert.deepEqual(delays, [DEFAULT_BACKUP_FINALIZATION_POLICY.baseDelayMs], 'exactly one delay, taken outside any transaction');

      // Exactly one live record for this backup, bound to the bytes on disk.
      assert.deepEqual(listBackups(h.store), [earlier.backupId, result.backupId].sort());
      assert.equal(backupRows(h.store), 2, 'one audit row per recorded backup, none for the failed attempt');
      const record = h.store.backupRecord(result.backupId);
      assert.ok(record);
      assert.equal(record.snapshotSha256, sha256Hex(readFileSync(path.join(result.directory, 'company.sqlite3'))));
      assert.equal(record.manifestSha256, sha256Hex(readFileSync(path.join(result.directory, 'manifest.json'))));
      assert.equal(record.manifestSha256, result.manifestSha256);
      assert.equal(verifyBackup(result.directory, { liveDatabasePath: h.store.workspace.databasePath, expected: record }).ok, true);
      assert.equal(h.store.healthCounts().lastBackup?.id !== undefined, true);

      // No orphan, staging or quarantine entry from the successful attempt.
      assert.deepEqual(readdirSync(h.store.workspace.backupsDir).sort(), [earlier.backupId, result.backupId].sort());
      assert.deepEqual(readdirSync(result.directory).sort(), ['company.sqlite3', 'manifest.json']);
    } finally {
      releaseLockers();
      h.close();
    }
  });

  test('a lock held past the whole retry envelope fails cleanly and boundedly; nothing canonical remains; the earlier backup is untouched', { timeout: 20_000 }, async () => {
    const h = harness({ busyTimeoutMs: BUSY_MS });
    try {
      executable(h.store);
      const earlier = await createBackup(h.store);
      const earlierRecord = h.store.backupRecord(earlier.backupId);
      assert.ok(earlierRecord);
      const earlierBytes = readFileSync(path.join(earlier.directory, 'company.sqlite3'));
      const locker = lockWriter(h);
      const attemptId = newId();
      const delays: number[] = [];
      const started = Date.now();
      let caught: unknown;
      try {
        await createBackupInternal(h.store, {}, { backupId: attemptId, policy: { maxAttempts: 3, random: () => 1, sleep: async (ms) => void delays.push(ms) } });
      } catch (error) {
        caught = error;
      }
      const elapsed = Date.now() - started;
      assert.ok(isQandeelError(caught, 'STORAGE_BUSY'), `bounded STORAGE_BUSY, got ${String(caught)}`);
      assert.equal(caught.details.attempts, 3);
      assert.equal(caught.details.backupId, attemptId);
      assert.equal(caught.details.attemptDiscarded, true);
      assert.match(caught.message, /bounded retry envelope/);
      assert.deepEqual(delays, [100, 200], 'exactly maxAttempts - 1 delays, exponential');
      assert.ok(elapsed < 5_000, `bounded: failed after ${elapsed} ms (3 x ${BUSY_MS} ms busy waits + snapshot)`);
      assert.ok(locker.held(), 'the lock was held for the whole envelope');
      locker.release();

      // The failed attempt is gone and is not discoverable in any way.
      assert.equal(existsSync(path.join(h.store.workspace.backupsDir, attemptId)), false, 'attempt directory removed');
      assert.deepEqual(readdirSync(h.store.workspace.backupsDir), [earlier.backupId]);
      assert.deepEqual(listBackups(h.store), [earlier.backupId]);
      assert.equal(h.store.backupRecord(attemptId), null);
      assert.equal(h.store.healthCounts().lastBackup?.id, earlier.backupId);
      assert.equal(backupRows(h.store), 1);

      // The earlier backup is byte-identical and still verifies against its live record.
      assert.ok(readFileSync(path.join(earlier.directory, 'company.sqlite3')).equals(earlierBytes));
      assert.equal(verifyBackup(earlier.directory, { expected: earlierRecord }).ok, true);
      assert.equal(h.store.quickCheck(), 'ok');
      assert.equal(h.store.foreignKeyViolations(), 0);

      // With the lock gone, the next backup succeeds on its first attempt.
      const next = await createBackup(h.store);
      assert.deepEqual(next.finalization, { outcome: 'RECORDED', attempts: 1 });
    } finally {
      releaseLockers();
      h.close();
    }
  });

  test('an identical replay of a recorded backup succeeds without a duplicate row or audit', async () => {
    const h = harness();
    try {
      executable(h.store);
      const r = await createBackup(h.store);
      const record = backupRecordFor(r.manifest, r.manifestSha256);
      const before = h.store.backupRecord(r.backupId);
      assert.equal(recordBackupOnce(h.store, record), 'ALREADY_RECORDED');
      assert.deepEqual(await finalizeBackupRecord(h.store, record), { outcome: 'ALREADY_RECORDED', attempts: 1 });
      assert.deepEqual(h.store.backupRecord(r.backupId), before, 'no rewrite');
      assert.deepEqual(listBackups(h.store), [r.backupId]);
      assert.equal(backupRows(h.store), 1, 'no duplicate audit history for a replay');
    } finally {
      releaseLockers();
      h.close();
    }
  });

  test('the same backup ID with a different hash or metadata fails closed, is not retried, and never rewrites the existing row', async () => {
    const h = harness();
    try {
      executable(h.store);
      const r = await createBackup(h.store);
      const record = backupRecordFor(r.manifest, r.manifestSha256);
      const before = h.store.backupRecord(r.backupId);
      assert.ok(before);
      const conflicts = [
        { ...record, snapshotSha256: '0'.repeat(64) },
        { ...record, manifestSha256: 'f'.repeat(64) },
        { ...record, schemaVersion: record.schemaVersion - 1 },
        { ...record, artifactCount: record.artifactCount + 1 },
        { ...record, createdAt: '2020-01-01T00:00:00.000Z' as typeof record.createdAt },
      ];
      for (const conflict of conflicts) {
        const delays: number[] = [];
        await assert.rejects(
          finalizeBackupRecord(h.store, conflict, { ...DEFAULT_BACKUP_FINALIZATION_POLICY, sleep: async (ms) => void delays.push(ms) }),
          (e) => isQandeelError(e, 'STORAGE_INVARIANT'),
        );
        assert.deepEqual(delays, [], 'a conflict is not retryable');
      }
      assert.deepEqual(h.store.backupRecord(r.backupId), before);
      assert.equal(backupRows(h.store), 1);
      assert.equal(verifyBackup(r.directory, { expected: before }).ok, true);
    } finally {
      releaseLockers();
      h.close();
    }
  });

  test('a produced attempt whose ID already carries a conflicting record is not blessed: fail closed, directory removed, record kept', async () => {
    const h = harness();
    try {
      executable(h.store);
      const id = newId();
      const r = await createBackup(h.store);
      // A foreign record under the ID the next attempt will use (its directory does not exist).
      recordBackupOnce(h.store, { ...backupRecordFor(r.manifest, r.manifestSha256), backupId: id, snapshotSha256: 'a'.repeat(64) });
      const foreign = h.store.backupRecord(id);
      await assert.rejects(createBackupInternal(h.store, {}, { backupId: id }), (e) => isQandeelError(e, 'STORAGE_INVARIANT') && e.details.attemptDiscarded === true);
      assert.equal(existsSync(path.join(h.store.workspace.backupsDir, id)), false, 'the conflicting on-disk attempt was removed');
      assert.deepEqual(h.store.backupRecord(id), foreign, 'the existing row was not modified');
      assert.deepEqual(listBackups(h.store), [r.backupId], 'a record without its directory is not a canonical backup either');
      // An existing directory is never reused or overwritten by a new attempt.
      await assert.rejects(createBackupInternal(h.store, {}, { backupId: r.backupId }), (e: NodeJS.ErrnoException) => e.code === 'EEXIST');
      const kept = h.store.backupRecord(r.backupId);
      assert.ok(kept);
      assert.equal(verifyBackup(r.directory, { expected: kept }).ok, true);
    } finally {
      releaseLockers();
      h.close();
    }
  });

  test('if removing the failed attempt also fails, the original error is kept and the leftover is still not canonical', async () => {
    const h = harness({ busyTimeoutMs: BUSY_MS });
    try {
      executable(h.store);
      const locker = lockWriter(h);
      const id = newId();
      let caught: unknown;
      try {
        await createBackupInternal(h.store, {}, {
          backupId: id,
          policy: { maxAttempts: 1 },
          discard: () => {
            throw Object.assign(new Error('EPERM: simulated'), { code: 'EPERM' });
          },
        });
      } catch (error) {
        caught = error;
      }
      locker.release();
      assert.ok(isQandeelError(caught, 'STORAGE_BUSY'), 'the original failure is surfaced, not the cleanup failure');
      assert.equal(caught.details.attemptDiscarded, false);
      assert.ok(isQandeelError(caught.cause, 'STORAGE_BUSY'));
      assert.ok(existsSync(path.join(h.store.workspace.backupsDir, id, 'manifest.json')), 'the valid-looking leftover exists');
      assert.deepEqual(listBackups(h.store), [], 'discovery is record-based: the leftover is not listed');
      assert.equal(h.store.backupRecord(id), null, 'verify-backup / restore-check refuse it (no live record)');
      assert.equal(h.store.healthCounts().lastBackup, null);
    } finally {
      releaseLockers();
      h.close();
    }
  });

  test('the retry policy is bounded and validated; delays grow exponentially inside [0.5, 1] x the capped ceiling', async () => {
    const p = (random: number): BackupFinalizationPolicy => ({ ...DEFAULT_BACKUP_FINALIZATION_POLICY, random: () => random });
    assert.deepEqual([1, 2, 3, 4, 5].map((n) => finalizationDelayMs(p(1), n)), [100, 200, 400, 800, 1_000]);
    assert.deepEqual([1, 2, 3].map((n) => finalizationDelayMs(p(0), n)), [50, 100, 200]);
    const d = DEFAULT_BACKUP_FINALIZATION_POLICY;
    assert.equal(d.maxAttempts, 4);
    const worstDelays = [1, 2, 3].map((n) => finalizationDelayMs(p(1), n)).reduce((a, b) => a + b, 0);
    assert.equal(worstDelays, 700, 'documented envelope: 4 attempts x the store busy timeout + at most 700 ms of delays');
    const h = harness();
    try {
      for (const policy of [{ maxAttempts: 0 }, { maxAttempts: 11 }, { maxAttempts: 1.5 }, { baseDelayMs: -1 }, { maxDelayMs: 60_000 }, { baseDelayMs: 500, maxDelayMs: 100 }]) {
        await assert.rejects(createBackupInternal(h.store, {}, { policy }), (e) => isQandeelError(e, 'VALIDATION_FAILED'), JSON.stringify(policy));
      }
      assert.deepEqual(readdirSync(h.store.workspace.backupsDir), [], 'an invalid policy is refused before anything is written');
      // The finalization helper validates too: a non-finite bound can never loop forever.
      const r = await createBackup(h.store);
      for (const maxAttempts of [Number.NaN, Number.POSITIVE_INFINITY]) {
        await assert.rejects(finalizeBackupRecord(h.store, backupRecordFor(r.manifest, r.manifestSha256), { maxAttempts }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
      }
    } finally {
      releaseLockers();
      h.close();
    }
  });

  test('non-busy failures are not retried (a closed store fails immediately)', async () => {
    const h = harness();
    const r = await createBackup(h.store);
    const record = { ...backupRecordFor(r.manifest, r.manifestSha256), backupId: newId() as Id };
    h.store.close();
    const delays: number[] = [];
    try {
      await assert.rejects(finalizeBackupRecord(h.store, record, { ...DEFAULT_BACKUP_FINALIZATION_POLICY, sleep: async (ms) => void delays.push(ms) }), (e) => isQandeelError(e, 'RUNTIME_STOPPING'));
      assert.deepEqual(delays, []);
    } finally {
      releaseLockers();
      h.close();
    }
  });
});
