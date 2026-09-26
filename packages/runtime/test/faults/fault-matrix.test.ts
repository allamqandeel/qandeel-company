/**
 * Fault-injection / process-death proofs (C1 §46E, §47, §48). Every scenario runs a real runtime in
 * a child process, kills it WITHOUT graceful shutdown at a controlled durability boundary (the
 * process SIGKILLs itself at a named fault point, or the parent SIGKILLs it after an observed
 * checkpoint), then restarts a fresh runtime process against the same workspace. On Windows,
 * SIGKILL maps to TerminateProcess, so the same harness runs on both CI OS families.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { assertId, type Id } from '@qandeel-company/domain';
import { CompanyStore } from '@qandeel-company/storage';

import { removeRoot, tempRoot } from '../helpers.js';
import { spawnScript, type Child } from '../process-harness.js';

const HOST = new URL('../fixtures/runtime-host.js', import.meta.url);

function host(root: string, config: Record<string, unknown>): Child {
  return spawnScript(HOST, [root, JSON.stringify(config)]);
}

const parse = (line: string): Record<string, unknown> => JSON.parse(line) as Record<string, unknown>;
const isHost = (kind: string) => (l: string): boolean => l.includes(`"host":"${kind}"`);

async function submittedId(child: Child): Promise<Id> {
  return assertId(parse(await child.waitFor(isHost('SUBMITTED'))).workItemId, 'workItemId');
}

/** Restart a clean runtime process and let it drain everything durable. */
async function restartUntilIdle(root: string): Promise<Record<string, unknown>> {
  const child = host(root, { exitWhenIdle: true });
  const ready = parse(await child.waitFor(isHost('READY'), 40_000));
  await child.waitFor(isHost('STOPPED'), 60_000);
  assert.equal(await child.exited(), 0, child.stderr());
  return ready.recovery as Record<string, unknown>;
}

function assertSingleCompletion(store: CompanyStore, id: Id): void {
  assert.equal(store.getWorkItem(id).state, 'COMPLETED');
  assert.equal(store.history(id).filter((t) => t.toState === 'COMPLETED').length, 1, 'exactly one canonical completion');
  assert.equal(store.runsForWorkItem(id).filter((r) => r.state === 'SUCCEEDED').length, 1, 'exactly one successful run');
  assert.equal(store.integrityCheck(), 'ok');
  assert.equal(store.foreignKeyViolations(), 0);
}

describe('fault matrix: process death at durability boundaries', () => {
  test('after Work Item commit, before the in-memory wake → restart finds and completes the work', async () => {
    const root = tempRoot('f-submit');
    try {
      const a = host(root, { submit: { kind: 'c1.noop' }, fault: { point: 'submit.afterCommit' } });
      await a.waitFor(isHost('DYING'));
      await a.exited();
      const peek = CompanyStore.open(root);
      const [item] = peek.listWorkItems();
      assert.ok(item, 'the Work Item committed before the process died');
      assert.equal(item.state, 'READY');
      assert.equal(peek.jobsFor(item.id)[0]?.state, 'QUEUED');
      peek.close();
      const recovery = await restartUntilIdle(root);
      assert.ok(Number(recovery.dueJobs) >= 1, 'recovery saw the durable job');
      const s = CompanyStore.open(root);
      assert.deepEqual(s.healthCounts().workItems, { COMPLETED: 1 });
      assertSingleCompletion(s, item.id);
      s.close();
    } finally {
      removeRoot(root);
    }
  });

  test('after queue claim, before the processor starts → the orphaned claim is recovered, retried once', async () => {
    const root = tempRoot('f-claim');
    try {
      const a = host(root, { submit: { kind: 'c1.noop' }, fault: { point: 'claim.afterCommit' } });
      const id = await submittedId(a);
      await a.waitFor(isHost('DYING'));
      await a.exited();
      const peek = CompanyStore.open(root);
      const job = peek.jobsFor(id)[0];
      assert.equal(job?.state, 'CLAIMED', 'the dead worker still holds a durable claim');
      assert.equal(peek.getWorkItem(id).state, 'IN_PROGRESS');
      peek.close();
      const recovery = await restartUntilIdle(root);
      assert.equal(recovery.claimsRecovered, 1);
      assert.equal(recovery.retried, 1);
      const s = CompanyStore.open(root);
      assertSingleCompletion(s, id);
      assert.deepEqual(s.runsForWorkItem(id).map((r) => [r.state, r.recoveryDisposition]), [['INTERRUPTED', 'SAFE_TO_RETRY'], ['SUCCEEDED', null]]);
      s.close();
    } finally {
      removeRoot(root);
    }
  });

  test('after a checkpoint commits → restart resumes from that checkpoint', async () => {
    const root = tempRoot('f-cp-after');
    try {
      const a = host(root, { submit: { kind: 'c1.steps', input: { steps: 5, stepMs: 20 } }, fault: { point: 'checkpoint.afterCommit', at: 3 } });
      const id = await submittedId(a);
      await a.waitFor(isHost('DYING'));
      await a.exited();
      await restartUntilIdle(root);
      const s = CompanyStore.open(root);
      assertSingleCompletion(s, id);
      const job = s.jobsFor(id)[0];
      assert.ok(job);
      const steps = s.checkpoints(job.id).map((c) => (c.state as { step: number }).step);
      assert.deepEqual(steps, [1, 2, 3, 4, 5], 'resumed at step 4: committed progress was trusted, nothing repeated');
      s.close();
    } finally {
      removeRoot(root);
    }
  });

  test('before a checkpoint commits → the uncommitted checkpoint is not trusted; resume from the previous one', async () => {
    const root = tempRoot('f-cp-before');
    try {
      const a = host(root, { submit: { kind: 'c1.steps', input: { steps: 5, stepMs: 20 } }, fault: { point: 'checkpoint.beforeCommit', at: 3 } });
      const id = await submittedId(a);
      await a.waitFor(isHost('DYING'));
      await a.exited();
      const peek = CompanyStore.open(root);
      const jobId = peek.jobsFor(id)[0]?.id as Id;
      assert.deepEqual(peek.checkpoints(jobId).map((c) => (c.state as { step: number }).step), [1, 2], 'the killed transaction left no checkpoint 3');
      peek.close();
      await restartUntilIdle(root);
      const s = CompanyStore.open(root);
      assertSingleCompletion(s, id);
      assert.deepEqual(s.checkpoints(jobId).map((c) => (c.state as { step: number }).step), [1, 2, 3, 4, 5]);
      s.close();
    } finally {
      removeRoot(root);
    }
  });

  test('crash/restart end to end: external SIGKILL mid-run → recovery before READY → one canonical completion', async () => {
    const root = tempRoot('f-e2e');
    try {
      const a = host(root, { submit: { kind: 'c1.steps', input: { steps: 6, stepMs: 150 } } });
      const id = await submittedId(a);
      await a.waitFor((l) => l.includes('"host":"CHECKPOINTED","n":2'));
      a.process.kill('SIGKILL');
      await a.exited();
      const recovery = await restartUntilIdle(root);
      assert.equal(recovery.claimsRecovered, 1);
      assert.equal(recovery.resumed, 1);
      const s = CompanyStore.open(root);
      assertSingleCompletion(s, id);
      const runs = s.runsForWorkItem(id);
      assert.deepEqual(runs.map((r) => r.state), ['INTERRUPTED', 'SUCCEEDED']);
      assert.equal(runs[0]?.recoveryDisposition, 'SAFE_TO_RESUME');
      const steps = s.checkpoints(runs[0]?.jobId as Id).map((c) => (c.state as { step: number }).step);
      assert.deepEqual(steps.slice(0, 2), [1, 2]);
      assert.equal(steps.at(-1), 6);
      // Recovery completed before READY: the lease recovery is audited before runtime.ready.
      const recovered = s.auditByAction('job.lease_recovered');
      const ready = s.auditByAction('runtime.ready');
      assert.equal(recovered.length, 1);
      assert.ok((ready.at(-1)?.id ?? 0) > (recovered[0]?.id ?? Infinity), 'READY is recorded only after recovery');
      s.close();
    } finally {
      removeRoot(root);
    }
  });

  test('a second crash during recovery neither corrupts state nor duplicates work', async () => {
    const root = tempRoot('f-recovery');
    try {
      const a = host(root, { submit: { kind: 'c1.steps', input: { steps: 4, stepMs: 150 } } });
      const id = await submittedId(a);
      await a.waitFor((l) => l.includes('"host":"CHECKPOINTED","n":1'));
      a.process.kill('SIGKILL');
      await a.exited();
      const b = host(root, { fault: { point: 'recovery.afterClaims' } });
      await b.waitFor(isHost('DYING'), 40_000);
      await b.exited();
      const recovery = await restartUntilIdle(root);
      assert.equal(recovery.claimsRecovered, 0, 'the claim was already recovered durably by the crashed recovery');
      const s = CompanyStore.open(root);
      assertSingleCompletion(s, id);
      const job = s.jobsFor(id)[0];
      assert.equal(s.runsForWorkItem(id).length, 2);
      assert.equal(s.auditByAction('job.lease_recovered').length, 1, 'recovered exactly once');
      assert.equal(job?.attemptCount, 1);
      s.close();
    } finally {
      removeRoot(root);
    }
  });

  test('ambiguous crash of UNSAFE-class work → RECONCILIATION_REQUIRED, never retried blindly', async () => {
    const root = tempRoot('f-unsafe');
    try {
      const a = host(root, { submit: { kind: 'test.unsafe' } });
      const id = await submittedId(a);
      await a.waitFor((l) => l.includes('"host":"CHECKPOINTED","n":1'));
      a.process.kill('SIGKILL');
      await a.exited();
      const recovery = await restartUntilIdle(root);
      assert.equal(recovery.reconciliationHeld, 1);
      const s = CompanyStore.open(root);
      assert.equal(s.getWorkItem(id).state, 'BLOCKED');
      assert.equal(s.getWorkItem(id).blockedReason, 'RECONCILIATION_REQUIRED');
      assert.equal(s.jobsFor(id)[0]?.state, 'RECONCILIATION_HOLD');
      assert.deepEqual(s.runsForWorkItem(id).map((r) => r.recoveryDisposition), ['RECONCILIATION_REQUIRED']);
      s.close();
    } finally {
      removeRoot(root);
    }
  });

  test('duplicate submission with the same idempotency key across a crash yields one canonical Work Item', async () => {
    const root = tempRoot('f-idem');
    try {
      const a = host(root, { submit: { kind: 'c1.noop', idempotencyKey: 'founder-request-7' }, fault: { point: 'submit.afterCommit' } });
      await a.waitFor(isHost('DYING'));
      await a.exited();
      const peek = CompanyStore.open(root);
      const first = peek.listWorkItems()[0]?.id;
      peek.close();
      assert.ok(first, 'first submission committed before the crash');
      const b = host(root, { submit: { kind: 'c1.noop', idempotencyKey: 'founder-request-7' }, exitWhenIdle: true });
      const second = await submittedId(b);
      await b.waitFor(isHost('STOPPED'), 60_000);
      await b.exited();
      assert.equal(second, first, 'the retried request replays the canonical Work Item');
      const s = CompanyStore.open(root);
      assert.deepEqual(s.healthCounts().workItems, { COMPLETED: 1 });
      assertSingleCompletion(s, second);
      s.close();
    } finally {
      removeRoot(root);
    }
  });
});
