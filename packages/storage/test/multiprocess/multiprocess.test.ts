import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { ExponentialBackoff, assertId, isQandeelError, newId } from '@qandeel-company/domain';

import { createBackupInternal } from '../../src/backup.js';
import { CompanyStore, createBackup, listBackups, verifyBackup } from '../../src/index.js';
import { KINDS, TEST_SUPERVISOR_TTL_MS, owner, removeRoot, tempRoot } from '../helpers.js';
import { fixture, spawnScript } from '../process-harness.js';
import { acquireSupervisor, claimNext, interruptClaim, settle } from '../../src/runtime-authority.js';

describe('multi-process proofs (independent OS processes, independent SQLite connections)', () => {
  test('atomic claim: six processes race for one job — exactly one winner, one run, one lease; stale supervisors never win', async () => {
    const root = tempRoot('mp-claim');
    const store = CompanyStore.open(root);
    try {
      const supervisor = acquireSupervisor(store, newId(), TEST_SUPERVISOR_TTL_MS);
      const { workItem } = store.createWorkItem({ objective: 'contended', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY' });
      const jobId = store.jobsFor(workItem.id)[0]?.id;
      assert.ok(jobId);
      const startAt = Date.now() + 1_500;
      // Four processes present the current supervisor fence; two present a stale token (a replaced supervisor).
      const children = Array.from({ length: 6 }, (_, i) =>
        spawnScript(fixture('claimer'), [root, jobId, `proc-${i}`, String(startAt), supervisor.holderId, String(i < 4 ? supervisor.fencingToken : supervisor.fencingToken + 7)]),
      );
      const results = await Promise.all(children.map(async (c) => JSON.parse(await c.waitFor((l) => l.startsWith('{'))) as { workerId: string; claimed: boolean; error?: string }));
      await Promise.all(children.map((c) => c.exited()));
      const winners = results.filter((r) => r.claimed);
      assert.equal(winners.length, 1, `exactly one winner: ${JSON.stringify(results)}`);
      assert.ok(['proc-0', 'proc-1', 'proc-2', 'proc-3'].includes(winners[0]?.workerId ?? ''), 'only a current-supervisor claimant can win');
      assert.deepEqual(results.filter((r) => r.workerId === 'proc-4' || r.workerId === 'proc-5').map((r) => r.error), ['SUPERVISOR_NOT_AUTHORITATIVE', 'SUPERVISOR_NOT_AUTHORITATIVE']);
      assert.ok(results.filter((r) => !r.claimed && ['proc-0', 'proc-1', 'proc-2', 'proc-3'].includes(r.workerId)).every((r) => r.error === undefined), 'losers get a deterministic "not claimed", not an error');
      const runs = store.runsFor(jobId);
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.workerId, winners[0]?.workerId);
      const job = store.getJob(jobId);
      assert.equal(job.state, 'CLAIMED');
      assert.equal(job.leaseOwner, winners[0]?.workerId);
      assert.equal(job.fencingToken, 1);
    } finally {
      store.close();
      removeRoot(root);
    }
  });

  test('concurrent first open: several processes create and migrate one fresh workspace; all succeed, applied once', async () => {
    const root = tempRoot('mp-open');
    try {
      const startAt = Date.now() + 1_500;
      const children = Array.from({ length: 4 }, () => spawnScript(fixture('opener'), [root, String(startAt)]));
      const results = await Promise.all(children.map(async (c) => JSON.parse(await c.waitFor((l) => l.startsWith('{'))) as { ok: boolean; schemaVersion?: number; applied?: number[]; code?: string }));
      await Promise.all(children.map((c) => c.exited()));
      assert.ok(results.every((r) => r.ok && r.schemaVersion === 3), JSON.stringify(results));
      assert.deepEqual(results.flatMap((r) => r.applied ?? []).sort(), [1, 2, 3], 'each migration applied exactly once across all processes');
    } finally {
      removeRoot(root);
    }
  });

  test('stale-worker fencing across processes: late worker A is rejected; worker B stays authoritative', async () => {
    const root = tempRoot('mp-fence');
    const store = CompanyStore.open(root);
    try {
      const supervisor = acquireSupervisor(store, newId(), TEST_SUPERVISOR_TTL_MS);
      const { workItem } = store.createWorkItem({ objective: 'fenced', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY' });
      const go = path.join(path.dirname(root), 'go');
      const a = spawnScript(fixture('stale-worker'), [root, '400', go, supervisor.holderId, String(supervisor.fencingToken)]);
      const claimLine = JSON.parse(await a.waitFor((l) => l.includes('"claim"'))) as { ok: boolean; jobId: string; token: number };
      assert.equal(claimLine.ok, true);
      await sleep(600); // A's lease expires while A is stalled
      const expired = store.expiredClaims();
      assert.deepEqual(expired, [claimLine.jobId]);
      interruptClaim(store, supervisor, assertId(claimLine.jobId, 'jobId'), 'LEASE_EXPIRED');
      const b = claimNext(store, { workerId: 'worker-B', leaseMs: 60_000, kinds: KINDS, supervisor });
      assert.ok(b);
      assert.ok(b.fence.fencingToken > claimLine.token);
      writeFileSync(go, 'go'); // wake A late
      await a.waitFor((l) => l.includes('"complete"'));
      assert.equal(await a.exited(), 0);
      const steps = a.lines.map((l) => JSON.parse(l) as { step: string; ok: boolean; code?: string });
      assert.deepEqual(steps.slice(1), [
        { step: 'checkpoint', ok: false, code: 'STALE_LEASE' },
        { step: 'complete', ok: false, code: 'STALE_LEASE' },
      ]);
      assert.equal(store.getJob(b.job.id).leaseOwner, 'worker-B');
      assert.equal(store.checkpoints(b.job.id).length, 0);
      settle(store, b.fence, { type: 'COMPLETED' }, { backoff: new ExponentialBackoff() });
      assert.equal(store.getWorkItem(workItem.id).state, 'COMPLETED');
      assert.equal(store.history(workItem.id).filter((t) => t.toState === 'COMPLETED').length, 1);
      assert.equal(store.auditByAction('fencing.rejected').length, 2);
    } finally {
      store.close();
      removeRoot(root);
    }
  });

  test('writer contention: a second process waits only its bounded busy timeout; WAL readers keep reading', async () => {
    const root = tempRoot('mp-busy');
    CompanyStore.open(root).close();
    const store = CompanyStore.open(root, { busyTimeoutMs: 250 });
    try {
      const before = store.healthCounts().workItems;
      const locker = spawnScript(fixture('locker'), [store.workspace.databasePath, '2000']);
      await locker.waitFor((l) => l === 'LOCKED');
      const started = Date.now();
      assert.throws(() => store.createWorkItem({ objective: 'blocked writer', ownerRef: owner }), (e) => isQandeelError(e, 'STORAGE_BUSY'));
      const waited = Date.now() - started;
      assert.ok(waited >= 200 && waited < 1_900, `failed after ${waited} ms: bounded, not hanging for the lock holder`);
      assert.deepEqual(store.healthCounts().workItems, before, 'reader sees committed state while the other process holds the write lock');
      await locker.waitFor((l) => l === 'RELEASED');
      assert.equal(await locker.exited(), 0);
      assert.doesNotThrow(() => store.createWorkItem({ objective: 'after release', ownerRef: owner }));
      assert.equal(store.auditByAction('test.lock_held').length, 1);
    } finally {
      store.close();
      removeRoot(root);
    }
  });

  test('online backup while another process writes continuously: every snapshot verifies and is transactionally consistent', async (t) => {
    const root = tempRoot('mp-backup');
    const store = CompanyStore.open(root);
    const writer = spawnScript(fixture('writer'), [root]);
    try {
      await writer.waitFor((l) => l === 'WROTE 50');
      const results = [];
      for (let i = 0; i < 3; i++) {
        const started = Date.now();
        const r = await createBackup(store);
        t.diagnostic(`backup ${i + 1}: ${Date.now() - started} ms, finalization attempts ${r.finalization.attempts}`);
        results.push(r);
      }
      await writer.waitFor((l) => l.startsWith('WROTE') && Number(l.split(' ')[1]) >= 100);
      writer.process.kill('SIGKILL');
      await writer.exited();
      for (const r of results) {
        const record = store.backupRecord(r.backupId);
        assert.ok(record, 'every backup is recorded by the live Company');
        const v = verifyBackup(r.directory, { liveDatabasePath: store.workspace.databasePath, expected: record });
        assert.equal(v.integrity, 'ok');
        assert.ok(v.counts.workItems >= 50);
        assert.equal(v.counts.jobs, v.counts.workItems, 'each committed item arrives with its job, never half a transaction');
      }
      assert.deepEqual(listBackups(store), results.map((r) => r.backupId).sort());
      assert.ok(store.quickCheck() === 'ok', 'live database intact after the writer was killed mid-stream');
    } finally {
      writer.process.kill('SIGKILL');
      store.close();
      removeRoot(root);
    }
  });

  test('backup finalization across processes: another process holds the write lock; the bounded retry records the backup after it releases', async () => {
    const root = tempRoot('mp-backup-lock');
    CompanyStore.open(root).close();
    const store = CompanyStore.open(root, { busyTimeoutMs: 250 });
    try {
      const earlier = await createBackup(store);
      const locker = spawnScript(fixture('locker'), [store.workspace.databasePath, '2000']);
      await locker.waitFor((l) => l === 'LOCKED');
      const started = Date.now();
      // Envelope far larger than the 2 s hold (10 attempts x 250 ms + capped delays): the outcome
      // does not depend on timing, only the attempt count does.
      const r = await createBackupInternal(store, {}, { policy: { maxAttempts: 10, random: () => 1 } });
      const elapsed = Date.now() - started;
      await locker.waitFor((l) => l === 'RELEASED');
      assert.equal(await locker.exited(), 0);
      assert.ok(r.finalization.attempts >= 2, `the first attempt met the other process's lock (attempts ${r.finalization.attempts})`);
      assert.ok(elapsed < 15_000, `bounded: ${elapsed} ms`);
      const record = store.backupRecord(r.backupId);
      assert.ok(record);
      assert.equal(verifyBackup(r.directory, { liveDatabasePath: store.workspace.databasePath, expected: record }).ok, true);
      assert.deepEqual(listBackups(store), [earlier.backupId, r.backupId].sort());
      assert.equal(store.auditByAction('backup.created').length, 2);
    } finally {
      store.close();
      removeRoot(root);
    }
  });
});
