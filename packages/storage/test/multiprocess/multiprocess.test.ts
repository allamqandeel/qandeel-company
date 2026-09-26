import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { ExponentialBackoff, assertId, isQandeelError } from '@qandeel-company/domain';

import { CompanyStore, createBackup, verifyBackup } from '../../src/index.js';
import { KINDS, owner, removeRoot, tempRoot } from '../helpers.js';
import { fixture, spawnScript } from '../process-harness.js';

describe('multi-process proofs (independent OS processes, independent SQLite connections)', () => {
  test('atomic claim: six processes race for one job — exactly one winner, one run, one lease', async () => {
    const root = tempRoot('mp-claim');
    const store = CompanyStore.open(root);
    try {
      const { workItem } = store.createWorkItem({ objective: 'contended', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY' });
      const jobId = store.jobsFor(workItem.id)[0]?.id;
      assert.ok(jobId);
      const startAt = Date.now() + 1_500;
      const children = Array.from({ length: 6 }, (_, i) => spawnScript(fixture('claimer'), [root, jobId, `proc-${i}`, String(startAt)]));
      const results = await Promise.all(children.map(async (c) => JSON.parse(await c.waitFor((l) => l.startsWith('{'))) as { workerId: string; claimed: boolean; error?: string }));
      await Promise.all(children.map((c) => c.exited()));
      const winners = results.filter((r) => r.claimed);
      assert.equal(winners.length, 1, `exactly one winner: ${JSON.stringify(results)}`);
      assert.ok(results.filter((r) => !r.claimed).every((r) => r.error === undefined), 'losers get a deterministic "not claimed", not an error');
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

  test('stale-worker fencing across processes: late worker A is rejected; worker B stays authoritative', async () => {
    const root = tempRoot('mp-fence');
    const store = CompanyStore.open(root);
    try {
      const { workItem } = store.createWorkItem({ objective: 'fenced', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY' });
      const go = path.join(path.dirname(root), 'go');
      const a = spawnScript(fixture('stale-worker'), [root, '400', go]);
      const claimLine = JSON.parse(await a.waitFor((l) => l.includes('"claim"'))) as { ok: boolean; jobId: string; token: number };
      assert.equal(claimLine.ok, true);
      await sleep(600); // A's lease expires while A is stalled
      const expired = store.expiredClaims();
      assert.deepEqual(expired, [claimLine.jobId]);
      store.interruptClaim(assertId(claimLine.jobId, 'jobId'), 'LEASE_EXPIRED');
      const b = store.claimNext({ workerId: 'worker-B', leaseMs: 60_000, kinds: KINDS });
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
      store.settle(b.fence, { type: 'COMPLETED' }, { backoff: new ExponentialBackoff() });
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

  test('online backup while another process writes continuously: every snapshot verifies and is transactionally consistent', async () => {
    const root = tempRoot('mp-backup');
    const store = CompanyStore.open(root);
    const writer = spawnScript(fixture('writer'), [root]);
    try {
      await writer.waitFor((l) => l === 'WROTE 50');
      const results = [];
      for (let i = 0; i < 3; i++) results.push(await createBackup(store));
      await writer.waitFor((l) => l.startsWith('WROTE') && Number(l.split(' ')[1]) >= 100);
      writer.process.kill('SIGKILL');
      await writer.exited();
      for (const r of results) {
        const v = verifyBackup(r.directory, { liveDatabasePath: store.workspace.databasePath });
        assert.equal(v.integrity, 'ok');
        assert.ok(v.counts.workItems >= 50);
        assert.equal(v.counts.jobs, v.counts.workItems, 'each committed item arrives with its job, never half a transaction');
      }
      assert.ok(store.quickCheck() === 'ok', 'live database intact after the writer was killed mid-stream');
    } finally {
      writer.process.kill('SIGKILL');
      store.close();
      removeRoot(root);
    }
  });
});
