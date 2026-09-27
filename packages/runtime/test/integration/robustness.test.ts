/**
 * Liveness and robustness proofs from the internal durability review (Reviewer B):
 * no free re-run loops, no completed result lost to transient contention, and a host sleep that
 * does not silently kill the runtime.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { ManualClock, toTimestamp, type Processor } from '@qandeel-company/domain';
import { CompanyStore } from '@qandeel-company/storage';
import { acquireSupervisor } from '@qandeel-company/storage/runtime-authority';

import { eventually, owner, removeRoot, runtimeFor, tempRoot } from '../helpers.js';
import { spawnScript } from '../process-harness.js';

describe('runtime robustness', () => {
  test('a processor that stops on its own or waits for the past is a bounded failure, never a free loop', async () => {
    const root = tempRoot('loop');
    let runs = 0;
    const quitter: Processor = { kind: 'test.quitter', sideEffects: 'NONE', run: async () => (runs++, { type: 'CANCELLED' }) };
    const pastWaiter: Processor = { kind: 'test.past-waiter', sideEffects: 'NONE', run: async () => (runs++, { type: 'WAIT', reasonCode: 'X', until: toTimestamp(Date.now() - 60_000) }) };
    const runtime = runtimeFor(root, { processors: [quitter, pastWaiter] });
    try {
      await runtime.start();
      const a = runtime.submitWorkItem({ objective: 'quits', ownerRef: owner, processorKind: 'test.quitter', maxAttempts: 3, initialState: 'READY' }).workItem;
      const b = runtime.submitWorkItem({ objective: 'waits for the past', ownerRef: owner, processorKind: 'test.past-waiter', maxAttempts: 3, initialState: 'READY' }).workItem;
      await eventually(() => runtime.view.jobsFor(a.id)[0]?.state === 'DEAD_LETTER' && runtime.view.jobsFor(b.id)[0]?.state === 'DEAD_LETTER', 10_000, 'both dead-lettered');
      await sleep(300);
      assert.equal(runs, 6, 'exactly maxAttempts runs each, then nothing');
      assert.deepEqual(runtime.view.runsForWorkItem(a.id).map((r) => r.failureCode), ['PROCESSOR_STOPPED_UNPROMPTED', 'PROCESSOR_STOPPED_UNPROMPTED', 'PROCESSOR_STOPPED_UNPROMPTED']);
      assert.deepEqual(runtime.view.runsForWorkItem(b.id).map((r) => r.failureCode), ['INVALID_WAIT', 'INVALID_WAIT', 'INVALID_WAIT']);
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });

  test('a completed result survives transient write contention: settle retries, no re-execution', async () => {
    const root = tempRoot('busy');
    let executions = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const gated: Processor = {
      kind: 'test.gated',
      sideEffects: 'NONE',
      async run() {
        executions++;
        await gate;
        return { type: 'COMPLETED' };
      },
    };
    const runtime = runtimeFor(root, { processors: [gated], busyTimeoutMs: 200 });
    try {
      await runtime.start();
      const w = runtime.submitWorkItem({ objective: 'contended settle', ownerRef: owner, processorKind: 'test.gated', initialState: 'READY' }).workItem;
      await eventually(() => runtime.view.jobsFor(w.id)[0]?.state === 'CLAIMED', 5_000, 'claimed');
      // Another process holds the write lock for 1.2 s — six times the runtime's busy timeout.
      const locker = spawnScript(fileURLToPath(new URL('../../../../storage/dist/test/fixtures/locker.js', import.meta.url)), [runtime.view.workspace.databasePath, '1200']);
      await locker.waitFor((l) => l === 'LOCKED');
      release();
      await locker.exited();
      await eventually(() => runtime.view.getWorkItem(w.id).state === 'COMPLETED', 10_000, 'completed after contention');
      assert.equal(executions, 1, 'the processor ran once');
      assert.deepEqual(runtime.view.runsForWorkItem(w.id).map((r) => r.state), ['SUCCEEDED']);
      assert.equal(runtime.view.jobsFor(w.id)[0]?.attemptCount, 0);
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });

  test('host sleep longer than the supervisor TTL: no takeover → the runtime keeps authority and keeps running', async () => {
    const root = tempRoot('sleep');
    const clock = new ManualClock(Date.now());
    const runtime = runtimeFor(root, { clock, supervisorTtlMs: 900 });
    try {
      await runtime.start();
      clock.advance(5_000); // the laptop slept
      await eventually(() => runtime.view.auditByAction('supervisor.renewed_after_expiry').length > 0, 5_000, 'renewed after expiry');
      assert.equal(runtime.state, 'READY');
      const w = runtime.submitWorkItem({ objective: 'after sleep', ownerRef: owner, processorKind: 'c1.noop', initialState: 'READY' }).workItem;
      await eventually(() => runtime.view.getWorkItem(w.id).state === 'COMPLETED', 5_000, 'still working');
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });

  test('a real takeover fail-stops the old runtime loudly (onFailStop), never silently', async () => {
    const root = tempRoot('takeover');
    const clock = new ManualClock(Date.now());
    const failures: string[] = [];
    const runtime = runtimeFor(root, { clock, supervisorTtlMs: 900, onFailStop: (code) => failures.push(code) });
    try {
      await runtime.start();
      clock.advance(5_000);
      const other = CompanyStore.open(root, { clock });
      acquireSupervisor(other, '00000000-0000-4000-8000-00000000000b' as never, 60_000); // takeover after expiry
      other.close();
      await eventually(() => runtime.state === 'FAILED', 5_000, 'fail-stop');
      assert.deepEqual(failures, ['SUPERVISOR_NOT_AUTHORITATIVE']);
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });
});
