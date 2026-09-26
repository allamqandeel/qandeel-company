import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, newId, toTimestamp } from '@qandeel-company/domain';

import { ArtifactStore, CompanyStore } from '../src/index.js';
import { storeContext } from '../src/store.js';
import { KINDS, backoff, claimOpts, executable, harness, owner } from './helpers.js';

describe('durable queue and atomic claim', () => {
  test('claims in deterministic order: persisted priority, then due time, then creation', () => {
    const h = harness();
    try {
      const low = executable(h.store, { priority: 10 });
      h.clock.advance(1);
      const high = executable(h.store, { priority: 90 });
      h.clock.advance(1);
      const high2 = executable(h.store, { priority: 90 });
      const order = [h.store.claimNext(claimOpts('w1')), h.store.claimNext(claimOpts('w2')), h.store.claimNext(claimOpts('w3'))].map((c) => c?.workItem.id);
      assert.deepEqual(order, [high, high2, low]);
      assert.equal(h.store.claimNext(claimOpts('w4')), null, 'deterministic empty result, not an error');
    } finally {
      h.close();
    }
  });

  test('a claim creates a durable RUNNING run, moves the item IN_PROGRESS and bumps the fencing token', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const claim = h.store.claimNext(claimOpts());
      assert.ok(claim);
      assert.equal(claim.job.state, 'CLAIMED');
      assert.equal(claim.job.fencingToken, 1);
      assert.equal(claim.run.state, 'RUNNING');
      assert.equal(claim.run.attempt, 1);
      assert.equal(claim.workItem.state, 'IN_PROGRESS');
      assert.equal(h.store.getWorkItem(id).state, 'IN_PROGRESS');
      assert.ok(h.store.events(claim.job.id).some((e) => e.type === 'job.claimed'));
    } finally {
      h.close();
    }
  });

  test('two independent connections racing for one job: exactly one winner, deterministic loser result', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const jobId = h.store.jobsFor(id)[0]?.id;
      assert.ok(jobId);
      const other = h.open();
      const a = h.store.claimJob(jobId, claimOpts('A'));
      const b = other.claimJob(jobId, claimOpts('B'));
      assert.ok(a);
      assert.equal(b, null);
      const runs = h.store.runsFor(jobId);
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.workerId, 'A');
    } finally {
      h.close();
    }
  });

  test('unknown processor kinds are never claimed', () => {
    const h = harness();
    try {
      executable(h.store, { processorKind: 'test.other' });
      assert.equal(h.store.claimNext(claimOpts()), null);
    } finally {
      h.close();
    }
  });
});

describe('lease fencing (HARD C1 acceptance condition)', () => {
  test('A claims → A lease expires → B reclaims with a newer token → A late writes are rejected → B stays authoritative', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const storeB = h.open();
      const a = h.store.claimNext(claimOpts('worker-A', 1_000));
      assert.ok(a);
      h.store.checkpoint(a.fence, 'step', { step: 1 }, 1, 1_000);

      h.clock.advance(1_001); // A's lease expires (A is "paused")
      assert.deepEqual(storeB.expiredClaims(), [a.job.id]);
      storeB.interruptClaim(a.job.id, 'LEASE_EXPIRED');
      const b = storeB.claimNext(claimOpts('worker-B', 10_000));
      assert.ok(b);
      assert.ok(b.fence.fencingToken > a.fence.fencingToken, 'newer fencing token');
      assert.deepEqual(b.resumeFrom?.state, { step: 1 }, 'B resumes from A’s committed checkpoint');

      // A wakes late and tries every kind of write: all rejected by the datastore.
      assert.throws(() => h.store.settle(a.fence, { type: 'COMPLETED' }, { backoff }), (e) => isQandeelError(e, 'STALE_LEASE'));
      assert.throws(() => h.store.checkpoint(a.fence, 'step', { step: 2 }, 1, 1_000), (e) => isQandeelError(e, 'STALE_LEASE'));
      assert.throws(() => h.store.renewLease(a.fence, 1_000), (e) => isQandeelError(e, 'STALE_LEASE'));

      const job = storeB.getJob(b.job.id);
      assert.equal(job.state, 'CLAIMED');
      assert.equal(job.leaseOwner, 'worker-B');
      assert.equal(storeB.getWorkItem(id).state, 'IN_PROGRESS');
      assert.equal(storeB.checkpoints(b.job.id).length, 1, 'A’s rejected checkpoint was not written');

      storeB.settle(b.fence, { type: 'COMPLETED' }, { backoff });
      assert.equal(storeB.getWorkItem(id).state, 'COMPLETED');
      const runs = storeB.runsFor(b.job.id);
      assert.deepEqual(runs.map((r) => [r.workerId, r.state]), [['worker-A', 'INTERRUPTED'], ['worker-B', 'SUCCEEDED']]);
      assert.equal(storeB.history(id).filter((t) => t.toState === 'COMPLETED').length, 1, 'exactly one canonical completion');
      assert.equal(storeB.auditByAction('fencing.rejected').length, 3, 'every stale write attempt is audited');
    } finally {
      h.close();
    }
  });

  test('an expired lease is rejected even if nobody reclaimed the job yet', () => {
    const h = harness();
    try {
      executable(h.store);
      const a = h.store.claimNext(claimOpts('A', 500));
      assert.ok(a);
      h.clock.advance(500);
      assert.throws(() => h.store.settle(a.fence, { type: 'COMPLETED' }, { backoff }), (e) => isQandeelError(e, 'STALE_LEASE'));
    } finally {
      h.close();
    }
  });

  test('database refuses to lower a fencing token or rewrite a finished run', () => {
    const h = harness();
    try {
      executable(h.store);
      const a = h.store.claimNext(claimOpts());
      assert.ok(a);
      h.store.settle(a.fence, { type: 'COMPLETED' }, { backoff });
      const { db } = storeContext(h.store);
      assert.throws(() => db.run(`UPDATE runs SET state = 'RUNNING', ended_at = NULL WHERE id = ?`, a.run.id), (e) => isQandeelError(e, 'STORAGE_INVARIANT'));
      assert.throws(() => db.run(`UPDATE queue_jobs SET state = 'QUEUED' WHERE id = ?`, a.job.id), (e) => isQandeelError(e, 'STORAGE_INVARIANT'));
    } finally {
      h.close();
    }
  });
});

describe('fencing: each check on its own (non-vacuity)', () => {
  test('an expired lease rejects checkpoints even before anyone reclaims the job', () => {
    const h = harness();
    try {
      executable(h.store);
      const a = h.store.claimNext(claimOpts('A', 500));
      assert.ok(a);
      h.clock.advance(500);
      assert.throws(() => h.store.checkpoint(a.fence, 'step', { step: 1 }, 1, 500), (e) => isQandeelError(e, 'STALE_LEASE'));
      assert.equal(h.store.checkpoints(a.job.id).length, 0);
    } finally {
      h.close();
    }
  });

  test('a fence with the right run and owner but an old token is rejected', () => {
    const h = harness();
    try {
      executable(h.store);
      const a = h.store.claimNext(claimOpts('A'));
      assert.ok(a);
      const forged = { ...a.fence, fencingToken: a.fence.fencingToken - 1 };
      assert.throws(() => h.store.checkpoint(forged, 'step', { step: 1 }, 1, 10_000), (e) => isQandeelError(e, 'STALE_LEASE'));
      assert.throws(() => h.store.settle(forged, { type: 'COMPLETED' }, { backoff }), (e) => isQandeelError(e, 'STALE_LEASE'));
      const wrongOwner = { ...a.fence, workerId: 'B' };
      assert.throws(() => h.store.renewLease(wrongOwner, 10_000), (e) => isQandeelError(e, 'STALE_LEASE'));
    } finally {
      h.close();
    }
  });

  test('a stale worker cannot attach an artifact: the fence is checked inside the staging transaction', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const a = h.store.claimNext(claimOpts('A', 500));
      assert.ok(a);
      const artifacts = new ArtifactStore(h.store);
      assert.equal(artifacts.put({ content: 'fresh', mediaType: 'text/plain', workItemId: id, runId: a.fence.runId, fence: a.fence }).state, 'READY');
      h.clock.advance(500);
      h.store.interruptClaim(a.job.id, 'LEASE_EXPIRED');
      assert.throws(() => artifacts.put({ content: 'late', mediaType: 'text/plain', workItemId: id, runId: a.fence.runId, fence: a.fence }), (e) => isQandeelError(e, 'STALE_LEASE'));
      assert.deepEqual(h.store.healthCounts().artifacts, { READY: 1 });
      assert.ok(h.store.auditByAction('fencing.rejected').some((a) => a.details.operation === 'artifact'), 'the stale attachment is audited');
    } finally {
      h.close();
    }
  });
});

describe('checkpoints', () => {
  test('are monotonic, checksummed, retained, and a tampered checkpoint is never trusted', () => {
    const h = harness();
    try {
      executable(h.store);
      const c = h.store.claimNext(claimOpts());
      assert.ok(c);
      assert.equal(h.store.checkpoint(c.fence, 'step', { step: 1 }, 1, 10_000), 1);
      assert.equal(h.store.checkpoint(c.fence, 'step', { step: 2 }, 1, 10_000), 2);
      const cps = h.store.checkpoints(c.job.id);
      assert.deepEqual(cps.map((x) => x.seq), [1, 2]);
      assert.deepEqual(h.store.latestCheckpoint(c.job.id)?.state, { step: 2 });
      assert.throws(() => h.store.checkpoint(c.fence, 'step', { password: 'x' }, 1, 10_000), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
      assert.throws(() => h.store.checkpoint(c.fence, 'step', { blob: 'x'.repeat(70_000) }, 1, 10_000), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
      // Simulate on-disk tampering of the newest checkpoint: bypass the append-only trigger.
      const { db } = storeContext(h.store);
      db.execScript('DROP TRIGGER run_checkpoints_append_only_u');
      db.run(`UPDATE run_checkpoints SET state_json = '{"step":99}' WHERE seq = 2`);
      assert.deepEqual(h.store.latestCheckpoint(c.job.id)?.state, { step: 1 }, 'falls back to the latest *valid* checkpoint');
    } finally {
      h.close();
    }
  });
});

describe('bounded retry, dead-letter and requeue', () => {
  test('retryable failures back off with persisted next-attempt times, then dead-letter; requeue is explicit', () => {
    const h = harness();
    try {
      const id = executable(h.store, { maxAttempts: 3 });
      const expectedDelays = [1_000, 2_000];
      for (let attempt = 1; attempt <= 3; attempt++) {
        const c = h.store.claimNext(claimOpts());
        assert.ok(c, `attempt ${attempt} claimable`);
        assert.equal(c.run.attempt, attempt);
        const out = h.store.settle(c.fence, { type: 'RETRYABLE_FAILURE', code: 'TRANSIENT' }, { backoff });
        if (attempt < 3) {
          assert.equal(out.jobState, 'QUEUED');
          assert.equal(out.retryAt, toTimestamp(h.clock.nowMs() + (expectedDelays[attempt - 1] ?? 0)));
          assert.equal(h.store.claimNext(claimOpts()), null, 'not due yet: no immediate retry loop');
          assert.equal(h.store.nextDueAt(['test.noop']), out.retryAt);
          h.clock.advance(expectedDelays[attempt - 1] ?? 0);
        } else {
          assert.equal(out.jobState, 'DEAD_LETTER');
        }
      }
      const item = h.store.getWorkItem(id);
      assert.equal(item.state, 'BLOCKED');
      assert.equal(item.blockedReason, 'RETRIES_EXHAUSTED');
      const job = h.store.jobsFor(id)[0];
      assert.ok(job);
      assert.equal(job.deadLetterReason, 'RETRIES_EXHAUSTED');
      assert.equal(job.attemptCount, 3);
      h.clock.advance(3_600_000);
      assert.equal(h.store.claimNext(claimOpts()), null, 'dead letters are never retried automatically');
      h.store.requeueDeadLetter(job.id, 'OPERATOR_REQUEUE', 'owner:founder');
      const again = h.store.claimNext(claimOpts());
      assert.equal(again?.run.attempt, 1);
      assert.equal(again?.run.runSeq, 4);
    } finally {
      h.close();
    }
  });

  test('permanent failure fails the item (terminal) and informs dependents', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const waiter = h.store.createWorkItem({ objective: 'w', ownerRef: owner, initialState: 'READY', dependsOn: [id] }).workItem.id;
      const c = h.store.claimNext(claimOpts());
      assert.ok(c);
      h.store.settle(c.fence, { type: 'PERMANENT_FAILURE', code: 'INVALID_INPUT' }, { backoff });
      assert.equal(h.store.getWorkItem(id).state, 'FAILED');
      assert.equal(h.store.getWorkItem(waiter).blockedReason, 'DEPENDENCY_FAILED');
    } finally {
      h.close();
    }
  });
});

describe('waiting is a state, not a loop', () => {
  test('event wait parks the job until an explicit wake; timed wait becomes due at its time', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const c = h.store.claimNext(claimOpts());
      assert.ok(c);
      h.store.settle(c.fence, { type: 'WAIT', reasonCode: 'AWAITING_INPUT' }, { backoff });
      assert.equal(h.store.getWorkItem(id).state, 'WAITING');
      assert.equal(h.store.jobsFor(id)[0]?.state, 'WAITING');
      assert.equal(h.store.nextDueAt(['test.noop']), null, 'nothing to schedule while waiting for an event');
      h.clock.advance(86_400_000);
      assert.equal(h.store.claimNext(claimOpts()), null);
      assert.equal(h.store.wake(id, 'INPUT_ARRIVED'), true);
      const again = h.store.claimNext(claimOpts());
      assert.ok(again);
      // A timed wait in the past, or a malformed one, is refused (it could otherwise loop for free).
      assert.throws(() => h.store.settle(again.fence, { type: 'WAIT', reasonCode: 'X', until: toTimestamp(h.clock.nowMs() - 1) }, { backoff }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
      assert.throws(() => h.store.settle(again.fence, { type: 'WAIT', reasonCode: 'X', until: 'soon' as never }, { backoff }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
      h.store.settle(again.fence, { type: 'WAIT', reasonCode: 'AWAITING_INPUT' }, { backoff });
      assert.equal(h.store.wake(id, 'INPUT_ARRIVED'), true);
      const resumed = h.store.claimNext(claimOpts());
      assert.ok(resumed);
      assert.equal(resumed.run.attempt, 1, 'waiting does not consume retry budget');
      const until = toTimestamp(h.clock.nowMs() + 5_000);
      h.store.settle(resumed.fence, { type: 'WAIT', reasonCode: 'COOLDOWN', until }, { backoff });
      assert.equal(h.store.nextDueAt(['test.noop']), until);
      assert.equal(h.store.claimNext(claimOpts()), null);
      h.clock.advance(5_000);
      assert.ok(h.store.claimNext(claimOpts()));
    } finally {
      h.close();
    }
  });
});

describe('recovery classification and reconciliation', () => {
  test('an interrupted UNSAFE run is held for reconciliation, never retried blindly', () => {
    const h = harness();
    try {
      const id = executable(h.store, { processorKind: 'test.unsafe' });
      const c = h.store.claimNext(claimOpts('w', 500));
      assert.ok(c);
      h.clock.advance(500);
      const r = h.store.interruptClaim(c.job.id, 'LEASE_EXPIRED');
      assert.deepEqual(r, { disposition: 'RECONCILIATION_REQUIRED', jobState: 'RECONCILIATION_HOLD' });
      assert.equal(h.store.runsFor(c.job.id)[0]?.recoveryDisposition, 'RECONCILIATION_REQUIRED');
      h.clock.advance(3_600_000);
      assert.equal(h.store.claimNext(claimOpts()), null);
      assert.throws(() => h.store.requestCancellation(id, { reasonCode: 'X' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
      const out = h.store.resolveReconciliation(c.job.id, 'CONFIRMED_COMPLETED', 'VERIFIED_EXTERNALLY', 'owner:founder');
      assert.equal(out.workItemState, 'COMPLETED');
      assert.equal(h.store.auditByAction('job.reconciliation_resolved').length, 1);
    } finally {
      h.close();
    }
  });

  test('an interrupted NONE run resumes (checkpoint) or retries, and repeated interruption dead-letters (crash-loop bound)', () => {
    const h = harness();
    try {
      const id = executable(h.store, { maxAttempts: 2 });
      const c1 = h.store.claimNext(claimOpts('w', 500));
      assert.ok(c1);
      h.store.checkpoint(c1.fence, 'step', { step: 1 }, 1, 500);
      h.clock.advance(500);
      assert.deepEqual(h.store.interruptClaim(c1.job.id, 'LEASE_EXPIRED'), { disposition: 'SAFE_TO_RESUME', jobState: 'QUEUED' });
      const c2 = h.store.claimNext(claimOpts('w', 500));
      assert.ok(c2);
      assert.equal(c2.run.retryOfRunId, c1.run.id);
      h.clock.advance(500);
      assert.deepEqual(h.store.interruptClaim(c2.job.id, 'LEASE_EXPIRED'), { disposition: 'SAFE_TO_RESUME', jobState: 'DEAD_LETTER' });
      assert.equal(h.store.getWorkItem(id).blockedReason, 'INTERRUPTED_ATTEMPTS_EXHAUSTED');
    } finally {
      h.close();
    }
  });
});

describe('cancellation races', () => {
  test('cancellation intent committed first wins over a later completion: one terminal outcome, no resurrection', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const c = h.store.claimNext(claimOpts());
      assert.ok(c);
      const out = h.store.requestCancellation(id, { reasonCode: 'FOUNDER_STOP' });
      assert.deepEqual(out.signalJobIds, [c.job.id]);
      assert.equal(h.store.getWorkItem(id).state, 'IN_PROGRESS', 'intent is durable; state finalizes when the worker stops');
      const settled = h.store.settle(c.fence, { type: 'COMPLETED', evidence: { rows: 2 } }, { backoff });
      assert.equal(settled.workItemState, 'CANCELLED');
      const [run] = h.store.runsFor(c.job.id);
      assert.equal(run?.state, 'SUCCEEDED', 'the run is recorded truthfully: it did finish');
      assert.equal(run?.failureCode, 'TERMINATION_REQUESTED');
      assert.equal(h.store.history(id).filter((t) => t.toState === 'COMPLETED').length, 0);
      assert.throws(() => h.store.settle(c.fence, { type: 'COMPLETED' }, { backoff }), (e) => isQandeelError(e, 'STALE_LEASE'));
    } finally {
      h.close();
    }
  });

  test('termination intent + completion of UNSAFE-class work is never silently resolved: reconciliation hold', () => {
    const h = harness();
    try {
      const id = executable(h.store, { processorKind: 'test.unsafe' });
      const c = h.store.claimNext(claimOpts());
      assert.ok(c);
      h.store.requestCancellation(id, { reasonCode: 'STOP' });
      const out = h.store.settle(c.fence, { type: 'COMPLETED' }, { backoff });
      assert.equal(out.jobState, 'RECONCILIATION_HOLD');
      assert.equal(h.store.getWorkItem(id).blockedReason, 'RECONCILIATION_REQUIRED');
      assert.deepEqual(h.store.danglingTerminations(), [], 'recovery does not try to cancel held work');
      const resolved = h.store.resolveReconciliation(c.job.id, 'RETRY', 'EFFECT_DID_NOT_HAPPEN', 'owner:founder');
      assert.equal(resolved.workItemState, 'CANCELLED', 'retry after reconciliation honours the earlier termination intent');
    } finally {
      h.close();
    }
  });

  test('completion committed first: a later cancellation is refused deterministically', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const c = h.store.claimNext(claimOpts());
      assert.ok(c);
      h.store.settle(c.fence, { type: 'COMPLETED' }, { backoff });
      assert.throws(() => h.store.requestCancellation(id, { reasonCode: 'LATE' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
      assert.equal(h.store.getWorkItem(id).state, 'COMPLETED');
    } finally {
      h.close();
    }
  });

  test('cancellation racing lease expiry: recovery finalizes the durable intent instead of retrying', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const c = h.store.claimNext(claimOpts('w', 500));
      assert.ok(c);
      h.store.requestCancellation(id, { reasonCode: 'STOP' });
      h.clock.advance(500);
      assert.deepEqual(h.store.interruptClaim(c.job.id, 'LEASE_EXPIRED'), { disposition: 'TERMINATED', jobState: 'CANCELLED' });
      assert.equal(h.store.getWorkItem(id).state, 'CANCELLED');
      assert.throws(() => h.store.settle(c.fence, { type: 'COMPLETED' }, { backoff }), (e) => isQandeelError(e, 'STALE_LEASE'));
    } finally {
      h.close();
    }
  });
});

describe('supervisor lease', () => {
  test('one live supervisor; takeover only after expiry with a newer token; stale supervisors cannot claim', () => {
    const h = harness();
    try {
      const a = newId();
      const b = newId();
      const fa = h.store.acquireSupervisor(a, 1_000);
      assert.throws(() => h.store.acquireSupervisor(b, 1_000), (e) => isQandeelError(e, 'LEASE_HELD'));
      assert.equal(h.store.auditByAction('supervisor.acquire_refused').length, 1, 'the refusal is audited durably');
      h.store.renewSupervisor(fa, 1_000);
      executable(h.store);
      h.clock.advance(1_001);
      // Host sleep: the lease expired but nobody took over (holder and token unchanged) → renewable.
      h.store.renewSupervisor(fa, 1_000);
      assert.equal(h.store.auditByAction('supervisor.renewed_after_expiry').length, 1);
      h.clock.advance(1_001);
      const fb = h.store.acquireSupervisor(b, 1_000);
      assert.throws(() => h.store.renewSupervisor(fa, 1_000), (e) => isQandeelError(e, 'SUPERVISOR_NOT_AUTHORITATIVE'), 'after a takeover the old supervisor is fenced');
      assert.equal(fb.fencingToken, fa.fencingToken + 1);
      assert.throws(() => h.store.claimNext({ ...claimOpts(), supervisor: fa }), (e) => isQandeelError(e, 'SUPERVISOR_NOT_AUTHORITATIVE'));
      assert.ok(h.store.claimNext({ ...claimOpts(), supervisor: fb }));
      assert.equal(h.store.releaseSupervisor(fb), true);
      assert.ok(h.store.acquireSupervisor(a, 1_000).fencingToken > fb.fencingToken);
    } finally {
      h.close();
    }
  });

  test('startup against a store opened by another process name shares one durable queue (KINDS sanity)', () => {
    const h = harness();
    try {
      const other = CompanyStore.open(h.root, { clock: h.clock });
      executable(h.store);
      assert.equal(other.claimNext({ workerId: 'x', leaseMs: 1_000, kinds: KINDS })?.job.state, 'CLAIMED');
      other.close();
    } finally {
      h.close();
    }
  });
});
