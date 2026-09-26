/**
 * C1-PROOF: supervisor-claim-authority (D-C1-22, independent-review finding F1).
 *
 * No code can acquire executable work without presenting the current Runtime Supervisor fence:
 * the ordinary storage entry point has no claim at all, and the runtime-only claim path verifies
 * the fence inside the claim transaction. Worker (job) fencing stays an independent guard.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, newId, type Id } from '@qandeel-company/domain';

import * as storage from '../src/index.js';
import { ArtifactStore, CompanyStore } from '../src/index.js';
import * as authority from '../src/runtime-authority.js';
import { acquireSupervisor, checkpoint, claimJob, claimNext, interruptClaim, releaseSupervisor, renewLease, settle } from '../src/runtime-authority.js';
import { KINDS, backoff, executable, harness } from './helpers.js';

const notAuthoritative = (e: unknown): boolean => isQandeelError(e, 'SUPERVISOR_NOT_AUTHORITATIVE');

/** The job is untouched: still QUEUED, no run, token unchanged. */
function assertUnclaimed(store: CompanyStore, workItemId: Id): void {
  const [job] = store.jobsFor(workItemId);
  assert.equal(job?.state, 'QUEUED');
  assert.equal(job?.fencingToken, 0);
  assert.equal(store.runsForWorkItem(workItemId).length, 0);
  assert.equal(store.getWorkItem(workItemId).state, 'READY');
}

describe('Runtime Supervisor claim authority', () => {
  test('the ordinary storage API exposes no claim, no supervisor acquisition and no worker write', () => {
    const forbidden = ['claimNext', 'claimJob', 'acquireSupervisor', 'renewSupervisor', 'releaseSupervisor', 'settle', 'checkpoint', 'renewLease', 'interruptClaim', 'interruptOrphanRun', 'settleDanglingTermination', 'abandonStaleInstances', 'registerInstance', 'updateInstance'];
    for (const name of forbidden) {
      assert.equal(name in storage, false, `@qandeel-company/storage must not export ${name}`);
      assert.equal(name in CompanyStore.prototype, false, `CompanyStore must not offer ${name}`);
      assert.equal(typeof (authority as Record<string, unknown>)[name], 'function', `runtime-authority provides ${name}`);
    }
    for (const key of Object.keys(storage)) assert.doesNotMatch(key, /claim|supervisor|settle/i, `unexpected authority-like export ${key}`);
  });

  test('the package exports map admits the runtime-authority subpath and refuses every deep import', async () => {
    const self = '@qandeel-company/storage';
    const ok = (await import(`${self}/runtime-authority`)) as Record<string, unknown>;
    assert.equal(typeof ok.claimNext, 'function');
    for (const deep of ['dist/src/queue.js', 'dist/src/store.js', 'dist/src/runtime-authority.js', 'src/queue.ts']) {
      await assert.rejects(import(`${self}/${deep}`), (e: NodeJS.ErrnoException) => e.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED', deep);
    }
  });

  test('a claim without a supervisor fence is refused deterministically (claimNext and claimJob), nothing written', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const jobId = h.store.jobsFor(id)[0]?.id as Id;
      const bare = { workerId: 'w', leaseMs: 10_000, kinds: KINDS };
      for (const opts of [bare, { ...bare, supervisor: undefined }, { ...bare, supervisor: null }, { ...bare, supervisor: {} }, { ...bare, supervisor: { holderId: 'nope', fencingToken: 1 } }, { ...bare, supervisor: { holderId: h.supervisor.holderId, fencingToken: 0 } }]) {
        assert.throws(() => claimNext(h.store, opts as never), notAuthoritative);
        assert.throws(() => claimJob(h.store, jobId, opts as never), notAuthoritative);
      }
      assertUnclaimed(h.store, id);
    } finally {
      h.close();
    }
  });

  test('an expired supervisor fence is refused; wrong token and wrong holder are refused; nothing written', () => {
    const h = harness();
    try {
      releaseSupervisor(h.store, h.supervisor);
      const current = acquireSupervisor(h.store, newId(), 1_000);
      const id = executable(h.store);
      const jobId = h.store.jobsFor(id)[0]?.id as Id;
      const base = { workerId: 'w', leaseMs: 10_000, kinds: KINDS };
      for (const supervisor of [{ ...current, fencingToken: current.fencingToken + 1 }, { ...current, fencingToken: current.fencingToken - 1 }, { ...current, holderId: newId() }]) {
        assert.throws(() => claimNext(h.store, { ...base, supervisor }), notAuthoritative);
        assert.throws(() => claimJob(h.store, jobId, { ...base, supervisor }), notAuthoritative);
      }
      h.clock.advance(1_000); // the lease expires (expires_at <= now)
      assert.throws(() => claimNext(h.store, { ...base, supervisor: current }), notAuthoritative);
      assert.throws(() => claimJob(h.store, jobId, { ...base, supervisor: current }), notAuthoritative);
      assertUnclaimed(h.store, id);
    } finally {
      h.close();
    }
  });

  test('a replaced supervisor is refused; the current supervisor can claim (claimNext and claimJob)', () => {
    const h = harness();
    try {
      releaseSupervisor(h.store, h.supervisor);
      const old = acquireSupervisor(h.store, newId(), 1_000);
      h.clock.advance(1_001);
      const current = acquireSupervisor(h.store, newId(), 60_000);
      assert.ok(current.fencingToken > old.fencingToken);
      const a = executable(h.store);
      const b = executable(h.store);
      const jobB = h.store.jobsFor(b)[0]?.id as Id;
      const base = { workerId: 'w', leaseMs: 10_000, kinds: KINDS };
      assert.throws(() => claimNext(h.store, { ...base, supervisor: old }), notAuthoritative);
      assert.throws(() => claimJob(h.store, jobB, { ...base, supervisor: old }), notAuthoritative);
      assertUnclaimed(h.store, a);
      const byJob = claimJob(h.store, jobB, { ...base, workerId: 'wb', supervisor: current });
      assert.equal(byJob?.workItem.id, b);
      const next = claimNext(h.store, { ...base, workerId: 'wa', supervisor: current });
      assert.equal(next?.workItem.id, a);
    } finally {
      h.close();
    }
  });

  test('recovery writes that take a claim away also require the current supervisor', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const c = claimNext(h.store, h.claimOpts('w', 500));
      assert.ok(c);
      h.clock.advance(500);
      const stale = { ...h.supervisor, fencingToken: h.supervisor.fencingToken + 1 };
      assert.throws(() => interruptClaim(h.store, stale, c.job.id, 'LEASE_EXPIRED'), notAuthoritative);
      assert.equal(h.store.getJob(c.job.id).state, 'CLAIMED', 'refused recovery changed nothing');
      assert.deepEqual(interruptClaim(h.store, h.supervisor, c.job.id, 'LEASE_EXPIRED')?.jobState, 'QUEUED');
      assert.equal(h.store.getWorkItem(id).state, 'READY');
    } finally {
      h.close();
    }
  });

  test('worker fencing still independently protects renew, checkpoint, settle and artifact writes', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const a = claimNext(h.store, h.claimOpts('A', 500));
      assert.ok(a);
      h.clock.advance(500);
      interruptClaim(h.store, h.supervisor, a.job.id, 'LEASE_EXPIRED');
      const b = claimNext(h.store, h.claimOpts('B', 10_000));
      assert.ok(b);
      // A presents its (formerly valid) job fence under a perfectly current supervisor: still rejected.
      assert.throws(() => renewLease(h.store, a.fence, 1_000), (e) => isQandeelError(e, 'STALE_LEASE'));
      assert.throws(() => checkpoint(h.store, a.fence, 'late', { x: 1 }, 1, 1_000), (e) => isQandeelError(e, 'STALE_LEASE'));
      assert.throws(() => settle(h.store, a.fence, { type: 'COMPLETED' }, { backoff }), (e) => isQandeelError(e, 'STALE_LEASE'));
      assert.throws(() => new ArtifactStore(h.store).put({ content: 'x', mediaType: 'text/plain', workItemId: id, runId: a.fence.runId, fence: a.fence }), (e) => isQandeelError(e, 'STALE_LEASE'));
      assert.equal(settle(h.store, b.fence, { type: 'COMPLETED' }, { backoff }).workItemState, 'COMPLETED');
    } finally {
      h.close();
    }
  });
});
