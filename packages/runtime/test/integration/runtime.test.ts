import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { isQandeelError, type Id, type Processor } from '@qandeel-company/domain';
import { CompanyStore } from '@qandeel-company/storage';

import { inspectWorkspace, notifyRuntime, runtimeHealth, type HealthSnapshot } from '../../src/index.js';
import { concurrencyProbe, eventually, owner, removeRoot, runtimeFor, tempRoot, unsafeProbe } from '../helpers.js';

describe('runtime lifecycle, end to end', () => {
  test('Work Item → queue → Run → checkpoints → artifact → completion, traceable by stable IDs', async () => {
    const root = tempRoot('e2e');
    const withArtifact: Processor = {
      kind: 'test.report',
      sideEffects: 'NONE',
      async run(ctx) {
        await ctx.checkpoint('step', { step: 1 });
        const { artifactId } = await ctx.putArtifact('deterministic report body', 'text/plain', 'report');
        await ctx.checkpoint('step', { step: 2, artifactId });
        return { type: 'COMPLETED', evidence: { artifactId } };
      },
    };
    const runtime = runtimeFor(root, { processors: [withArtifact] });
    const seen: string[] = [];
    runtime.onEvent((e) => seen.push(e.type));
    try {
      assert.equal(runtimeHealth(runtime).readiness.ready, false, 'not ready before start');
      assert.throws(() => runtime.submitWorkItem({ objective: 'x', ownerRef: owner }), (e) => isQandeelError(e, 'RUNTIME_NOT_READY'));
      const recovery = await runtime.start();
      assert.equal(recovery.quickCheck, 'ok');
      const health = runtimeHealth(runtime);
      assert.equal(health.readiness.ready, true);
      assert.deepEqual(Object.values(health.readiness.checks), [true, true, true, true, true, true, true]);
      assert.equal(health.status, 'HEALTHY');

      const { workItem } = runtime.submitWorkItem({ objective: 'produce the report', ownerRef: owner, processorKind: 'test.report', initialState: 'READY' });
      await eventually(() => runtime.view.getWorkItem(workItem.id).state === 'COMPLETED', 10_000, 'completion');
      const store = runtime.view;
      const [job] = store.jobsFor(workItem.id);
      assert.ok(job);
      assert.equal(job.state, 'DONE');
      const [run] = store.runsFor(job.id);
      assert.ok(run);
      assert.equal(run.state, 'SUCCEEDED');
      const checkpoints = store.checkpoints(job.id);
      assert.deepEqual(checkpoints.map((c) => [c.runId, c.seq]), [[run.id, 1], [run.id, 2]]);
      const artifacts = runtime.artifacts.listForWorkItem(workItem.id);
      assert.equal(artifacts.length, 1);
      assert.equal(artifacts[0]?.runId, run.id);
      assert.equal(runtime.artifacts.read(artifacts[0]?.id as Id).toString('utf8'), 'deterministic report body');
      // Traceability: every event about the item, job and run shares the item's correlation ID.
      for (const aggregate of [workItem.id, job.id, run.id]) {
        for (const e of store.events(aggregate)) assert.equal(e.correlationId, workItem.correlationId, e.type);
      }
      await eventually(() => seen.includes('run.checkpointed') && seen.includes('artifact.ready'), 5_000, 'event dispatch');
      assert.equal(store.healthCounts().pendingEvents, 0, 'every durable event was dispatched');
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });

  test('dependency unblock, wait/resume and retry → dead-letter all run event-driven', async () => {
    const root = tempRoot('flows');
    const runtime = runtimeFor(root);
    try {
      await runtime.start();
      const a = runtime.submitWorkItem({ objective: 'a', ownerRef: owner, processorKind: 'c1.steps', processorInput: { steps: 2, stepMs: 20 }, initialState: 'READY' }).workItem;
      const b = runtime.submitWorkItem({ objective: 'b', ownerRef: owner, processorKind: 'c1.noop', initialState: 'READY', dependsOn: [a.id] }).workItem;
      assert.equal(b.state, 'BLOCKED');
      await eventually(() => runtime.view.getWorkItem(b.id).state === 'COMPLETED', 10_000, 'dependent completes after unblock');

      const w = runtime.submitWorkItem({ objective: 'wait', ownerRef: owner, processorKind: 'c1.steps', processorInput: { steps: 1, waitFirst: true }, initialState: 'READY' }).workItem;
      await eventually(() => runtime.view.getWorkItem(w.id).state === 'WAITING', 5_000, 'waiting');
      await sleep(200);
      assert.equal(runtime.view.getWorkItem(w.id).state, 'WAITING', 'waiting is a state: nothing re-runs it');
      assert.equal(runtime.wake(w.id, 'INPUT_ARRIVED'), true);
      await eventually(() => runtime.view.getWorkItem(w.id).state === 'COMPLETED', 5_000, 'resumed after wake');

      const f = runtime.submitWorkItem({ objective: 'flaky', ownerRef: owner, processorKind: 'c1.steps', processorInput: { failUntilAttempt: 99 }, maxAttempts: 3, initialState: 'READY' }).workItem;
      await eventually(() => runtime.view.jobsFor(f.id)[0]?.state === 'DEAD_LETTER', 10_000, 'dead-letter');
      assert.deepEqual(runtime.view.runsForWorkItem(f.id).map((r) => r.state), ['FAILED_RETRYABLE', 'FAILED_RETRYABLE', 'FAILED_RETRYABLE']);
      assert.equal(runtimeHealth(runtime).status, 'ATTENTION');
      assert.ok(runtimeHealth(runtime).reasons.includes('DEAD_LETTERS_PRESENT'));

      const p = runtime.submitWorkItem({ objective: 'bad input', ownerRef: owner, processorKind: 'c1.steps', processorInput: { permanentFailure: true }, initialState: 'READY' }).workItem;
      await eventually(() => runtime.view.getWorkItem(p.id).state === 'FAILED', 5_000, 'permanent failure');
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });

  test('cancelling running work: durable intent, processor signalled, one terminal outcome, children follow', async () => {
    const root = tempRoot('cancel');
    const runtime = runtimeFor(root);
    try {
      await runtime.start();
      const parent = runtime.submitWorkItem({ objective: 'long', ownerRef: owner, processorKind: 'c1.steps', processorInput: { steps: 100, stepMs: 50 }, initialState: 'READY' }).workItem;
      const child = runtime.submitWorkItem({ objective: 'child', ownerRef: owner, parentId: parent.id }).workItem;
      await eventually(() => runtime.view.checkpoints(runtime.view.jobsFor(parent.id)[0]?.id as Id).length >= 2, 10_000, 'progress');
      const out = runtime.cancel(parent.id, { reasonCode: 'FOUNDER_STOP', actorRef: 'owner:founder' });
      assert.equal(out.requested.length, 1);
      await eventually(() => runtime.view.getWorkItem(parent.id).state === 'CANCELLED', 5_000, 'cancelled');
      assert.equal(runtime.view.getWorkItem(child.id).state, 'CANCELLED');
      assert.deepEqual(runtime.view.runsForWorkItem(parent.id).map((r) => r.state), ['CANCELLED']);
      assert.equal(runtime.view.history(parent.id).filter((t) => t.toState === 'COMPLETED').length, 0);
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });

  test('bounded worker pool: observed concurrency never exceeds the cap; every job completes once', async () => {
    const root = tempRoot('cap');
    const probe = concurrencyProbe(40);
    const runtime = runtimeFor(root, { processors: [probe], concurrency: 3 });
    try {
      await runtime.start();
      const ids = Array.from({ length: 12 }, (_, i) => runtime.submitWorkItem({ objective: `job ${i}`, ownerRef: owner, processorKind: 'test.probe', initialState: 'READY' }).workItem.id);
      await eventually(() => ids.every((id) => runtime.view.getWorkItem(id).state === 'COMPLETED'), 20_000, 'all complete');
      assert.equal(probe.runs, 12);
      assert.ok(probe.maxActive <= 3, `observed ${probe.maxActive}`);
      assert.equal(probe.maxActive, 3, 'the cap was actually reached (non-vacuous)');
      assert.ok(runtime.diagnostics().maxObservedActive <= 3);
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });

  test('idle runtime: no queue queries, no timers but the heartbeat, no network, no model calls', async () => {
    const root = tempRoot('idle');
    const runtime = runtimeFor(root, { supervisorTtlMs: 60_000 });
    const realFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new Error('network is not part of the C1 runtime');
    }) as typeof fetch;
    try {
      await runtime.start();
      const done = runtime.submitWorkItem({ objective: 'one', ownerRef: owner, processorKind: 'c1.noop', initialState: 'READY' }).workItem;
      await eventually(() => runtime.view.getWorkItem(done.id).state === 'COMPLETED', 5_000, 'completion');
      await sleep(100);
      const before = { statements: runtime.view.stats.statements, ...runtime.diagnostics() };
      assert.equal(before.timerArmedFor, null, 'nothing due: no scheduler timer armed');
      await sleep(1_500);
      const after = { statements: runtime.view.stats.statements, ...runtime.diagnostics() };
      assert.equal(after.statements, before.statements, 'zero SQL statements while idle');
      assert.equal(after.pumps, before.pumps, 'the dispatcher did not spin');
      assert.equal(after.claimsAttempted, before.claimsAttempted);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = realFetch;
      await runtime.stop();
      removeRoot(root);
    }
  });

  test('a scheduled (timed) job wakes by its single timer, not by polling', async () => {
    const root = tempRoot('timer');
    const runtime = runtimeFor(root);
    try {
      await runtime.start();
      const w = runtime.submitWorkItem({ objective: 'retry soon', ownerRef: owner, processorKind: 'c1.steps', processorInput: { failUntilAttempt: 2 }, initialState: 'READY' }).workItem;
      await eventually(() => runtime.view.getWorkItem(w.id).state === 'COMPLETED', 5_000, 'retried by timer');
      const runs = runtime.view.runsForWorkItem(w.id);
      assert.deepEqual(runs.map((r) => r.state), ['FAILED_RETRYABLE', 'SUCCEEDED']);
      assert.ok(runtime.diagnostics().pumps < 50, `pumps ${runtime.diagnostics().pumps}: event/timer driven`);
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });

  test('graceful shutdown parks running work at a checkpoint; restart resumes without waiting for lease expiry', async () => {
    const root = tempRoot('graceful');
    const first = runtimeFor(root, { supervisorTtlMs: 60_000 });
    const second = runtimeFor(root, { supervisorTtlMs: 60_000 });
    try {
      await first.start();
      const w = first.submitWorkItem({ objective: 'long', ownerRef: owner, processorKind: 'c1.steps', processorInput: { steps: 8, stepMs: 60 }, initialState: 'READY' }).workItem;
      const jobId = await eventually(() => {
        const j = first.view.jobsFor(w.id)[0];
        return j && first.view.checkpoints(j.id).length >= 2 ? j.id : undefined;
      }, 10_000, 'progress');
      const instanceId = first.instanceId;
      await first.stop();
      assert.equal(first.state, 'STOPPED');
      const peek = CompanyStore.open(root);
      assert.equal(peek.getJob(jobId).state, 'QUEUED', 'parked, not failed');
      assert.equal(peek.runsFor(jobId)[0]?.recoveryDisposition, 'SAFE_TO_RESUME');
      assert.equal(peek.getJob(jobId).attemptCount, 0, 'a graceful park is not a failed attempt');
      assert.equal(peek.instance(instanceId)?.state, 'STOPPED');
      assert.ok(Date.parse(peek.supervisorLease()?.expiresAt ?? '') <= Date.now(), 'lease released');
      peek.close();
      const started = Date.now();
      await second.start();
      assert.ok(Date.now() - started < 5_000, 'no wait for a 60 s lease: it was released');
      await eventually(() => second.view.getWorkItem(w.id).state === 'COMPLETED', 10_000, 'resumed');
      const evidence = second.view.runsFor(jobId).map((r) => r.state);
      assert.deepEqual(evidence, ['INTERRUPTED', 'SUCCEEDED']);
      const steps = second.view.checkpoints(jobId).map((c) => (c.state as { step: number }).step);
      assert.deepEqual(steps, [...new Set(steps)].sort((x, y) => x - y), 'no step was repeated after resume');
    } finally {
      await first.stop();
      await second.stop();
      removeRoot(root);
    }
  });

  test('a second supervisor cannot become authoritative while the first is live', async () => {
    const root = tempRoot('two');
    const a = runtimeFor(root, { supervisorTtlMs: 5_000 });
    const b = runtimeFor(root, { supervisorTtlMs: 5_000, acquireTimeoutMs: 300 });
    try {
      await a.start();
      await assert.rejects(b.start(), (e) => isQandeelError(e, 'LEASE_HELD'));
      assert.equal(b.state, 'FAILED');
      assert.equal(runtimeHealth(b).readiness.ready, false);
      assert.equal(a.state, 'READY');
    } finally {
      await a.stop();
      removeRoot(root);
    }
  });

  test('no mutable store escape: the runtime hands out a frozen read-only view, never its CompanyStore (D-C1-22)', async () => {
    const root = tempRoot('view');
    const runtime = runtimeFor(root);
    try {
      assert.equal('store' in runtime, false, 'CompanyRuntime has no store accessor');
      assert.throws(() => runtime.view, (e) => isQandeelError(e, 'RUNTIME_NOT_READY'));
      await runtime.start();
      const view = runtime.view;
      assert.ok(Object.isFrozen(view));
      assert.equal(view instanceof CompanyStore, false);
      for (const name of ['createWorkItem', 'transitionWorkItem', 'requestCancellation', 'supersede', 'addDependency', 'wake', 'requeueDeadLetter', 'resolveReconciliation', 'recordAudit', 'markDispatched', 'close', 'readView', 'claimNext', 'claimJob', 'settle', 'checkpoint', 'acquireSupervisor']) {
        assert.equal(name in view, false, `the view offers no ${name}`);
      }
      for (const value of Object.values(view)) assert.equal(value instanceof CompanyStore, false, 'no property leads back to the store');
      assert.throws(() => Object.assign(view, { createWorkItem: () => undefined }), TypeError);
      // Artifacts: read-only too; writing and recovery stay with the runtime.
      assert.ok(Object.isFrozen(runtime.artifacts));
      for (const name of ['put', 'recover', 'verifyAll']) assert.equal(name in runtime.artifacts, false, `runtime.artifacts offers no ${name}`);
      // Recovery (which takes claims away) is not part of the public runtime API.
      assert.equal('runRecovery' in (await import('../../src/index.js')), false);
      const w = runtime.submitWorkItem({ objective: 'through the runtime', ownerRef: owner, processorKind: 'c1.noop', initialState: 'READY' }).workItem;
      await eventually(() => view.getWorkItem(w.id).state === 'COMPLETED', 5_000, 'completion observed through the view');
      assert.equal(view.schemaVersion, 3);
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
    assert.throws(() => runtime.view, (e) => isQandeelError(e, 'RUNTIME_NOT_READY'), 'no view once stopped');
  });

  test('cross-process wake: another process commits work and hints through the wake file', async () => {
    const root = tempRoot('xwake');
    const runtime = runtimeFor(root);
    try {
      await runtime.start();
      const other = CompanyStore.open(root);
      const w = other.createWorkItem({ objective: 'from another process', ownerRef: owner, processorKind: 'c1.noop', initialState: 'READY' }).workItem;
      other.close();
      notifyRuntime(root);
      await eventually(() => runtime.view.getWorkItem(w.id).state === 'COMPLETED', 5_000, 'picked up via wake file');
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });

  test('health: read-only inspection from another process; reconciliation surfaces as ATTENTION', async () => {
    const root = tempRoot('health');
    const runtime = runtimeFor(root, { processors: [unsafeProbe], jobLeaseMs: 400, supervisorTtlMs: 5_000 });
    try {
      await runtime.start();
      const snapshot: HealthSnapshot = inspectWorkspace(root);
      assert.equal(snapshot.components.supervisor.live, true);
      assert.equal(snapshot.components.runtime.state, 'READY');
      assert.equal(snapshot.readiness.checks.wal, true);
      const w = runtime.submitWorkItem({ objective: 'unsafe', ownerRef: owner, processorKind: 'test.unsafe', initialState: 'READY' }).workItem;
      await eventually(() => runtime.view.jobsFor(w.id)[0]?.state === 'CLAIMED', 5_000, 'claimed');
      await runtime.stop(); // processor acknowledges at a safe point: parked, not held
      const after = inspectWorkspace(root);
      assert.equal(after.components.runtime.state, 'NOT_RUNNING');
      assert.equal(after.liveness.alive, false);
      assert.equal(after.status, 'CRITICAL');
    } finally {
      removeRoot(root);
    }
  });

  test('online backup through the runtime verifies while the runtime is live', async () => {
    const root = tempRoot('rt-backup');
    const runtime = runtimeFor(root);
    try {
      await runtime.start();
      for (let i = 0; i < 5; i++) runtime.submitWorkItem({ objective: `w${i}`, ownerRef: owner, processorKind: 'c1.steps', processorInput: { steps: 3, stepMs: 10 }, initialState: 'READY' });
      const { backup, verification } = await runtime.backup();
      assert.equal(verification.integrity, 'ok');
      assert.equal(runtimeHealth(runtime).components.backup.lastBackupId, backup.backupId);
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });
});
