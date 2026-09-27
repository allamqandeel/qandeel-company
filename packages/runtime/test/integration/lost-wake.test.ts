/**
 * C1-PROOF: lost-wake-reconciliation (D-C1-23, independent-review finding F2).
 *
 * The fs.watch wake file is only a low-latency hint. These proofs deliberately DROP that hint (the
 * runtime's watcher is active, the other process writes the wake file, and every delivered
 * notification is discarded before it reaches the dispatcher) and show that an idle READY runtime
 * still discovers work committed by another OS process — through the durable wake generation that
 * the supervisor heartbeat observes — within one heartbeat interval plus a small test margin. No
 * wake()/pump() is called by the test, no other job or timer exists, nothing polls the queue, and
 * no model/provider call is made.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Id, Processor } from '@qandeel-company/domain';

import type { CompanyRuntime, RuntimeFaultPoint } from '../../src/index.js';
import { eventually, owner, removeRoot, runtimeFor, tempRoot } from '../helpers.js';
import { spawnScript } from '../process-harness.js';

const COMMITTER = new URL('../fixtures/external-committer.js', import.meta.url);
const SUPERVISOR_TTL_MS = 1_500; // heartbeat = TTL / 3 = 500 ms
/** Scheduling slack for loaded CI hosts (Windows included); the bound itself is the heartbeat interval. */
const TEST_MARGIN_MS = 1_500;

/** Drops every fs.watch wake hint — as if the operating system never delivered it. */
const dropFileHints = (point: RuntimeFaultPoint): void => {
  if (point === 'wake.fileHint') throw new Error('hint dropped by the lost-wake proof');
};

async function commitFromAnotherProcess(root: string, ...args: string[]): Promise<{ workItemId?: Id; committedAtMs: number; wakeGeneration: number }> {
  const child = spawnScript(COMMITTER, [root, ...args]);
  const line = await child.waitFor((l) => l.startsWith('{'), 20_000);
  assert.equal(await child.exited(20_000), 0, child.stderr());
  return JSON.parse(line) as { workItemId?: Id; committedAtMs: number; wakeGeneration: number };
}

/** Waits until the runtime is READY, has no active run, and has no timer armed: truly idle. */
async function idle(runtime: CompanyRuntime): Promise<void> {
  await runtime.whenIdle(10_000);
  await eventually(() => runtime.diagnostics().activeRuns === 0 && runtime.diagnostics().timerArmedFor === null, 5_000, 'idle');
  assert.equal(runtime.state, 'READY');
}

function stubFetch(): { calls: () => number; restore: () => void } {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error('network is not part of the C1 runtime');
  }) as typeof fetch;
  return { calls: () => calls, restore: () => (globalThis.fetch = real) };
}

describe('lost-wake reconciliation (fs.watch hint deliberately dropped)', () => {
  test('an idle READY runtime discovers work committed by another process within one heartbeat interval; no busy loop', async (t) => {
    const root = tempRoot('lostwake');
    const runtime = runtimeFor(root, { supervisorTtlMs: SUPERVISOR_TTL_MS, fault: dropFileHints });
    const network = stubFetch();
    try {
      await runtime.start();
      await idle(runtime);
      const start = runtime.diagnostics();
      assert.equal(start.wakeWatcher, 'ACTIVE', 'the primary hint path is armed — and will be dropped');
      assert.equal(start.lostWakeBoundMs, SUPERVISOR_TTL_MS / 3);
      const generationBefore = runtime.view.wakeGeneration();
      assert.equal(start.observedWakeGeneration, generationBefore, 'the last pump saw everything committed so far');

      const committed = await commitFromAnotherProcess(root, 'submit');
      const workItemId = committed.workItemId as Id;
      assert.ok(committed.wakeGeneration > generationBefore, 'the commit advanced the durable wake generation in its own transaction');

      // No wake(), no pump(), no other job, no timer: only the heartbeat can find it.
      await eventually(() => runtime.view.getWorkItem(workItemId).state === 'COMPLETED', start.lostWakeBoundMs + TEST_MARGIN_MS + 5_000, 'completion of the externally committed work');
      const [run] = runtime.view.runsForWorkItem(workItemId);
      assert.ok(run);
      assert.equal(run.state, 'SUCCEEDED');
      const discoveryMs = Date.parse(run.startedAt) - committed.committedAtMs;
      assert.ok(discoveryMs <= start.lostWakeBoundMs + TEST_MARGIN_MS, `claimed ${discoveryMs} ms after commit; bound ${start.lostWakeBoundMs} ms + ${TEST_MARGIN_MS} ms margin`);

      const found = runtime.diagnostics();
      t.diagnostic(`lost-wake discovery ${discoveryMs} ms after commit (bound ${start.lostWakeBoundMs} ms); fs.watch hints dropped: ${found.wakeFileHintsDropped}`);
      assert.equal(found.wakeFileHints, 0, 'no fs.watch hint reached the dispatcher');
      assert.ok(found.reconciliationWakes >= 1, 'the heartbeat observed the generation change and pumped');
      assert.ok(found.heartbeats >= 1);

      // Idle again: heartbeats continue (they renew authority), but nothing pumps, claims or scans.
      await idle(runtime);
      await sleep(200);
      const quiet = { statements: runtime.view.stats.statements, ...runtime.diagnostics() };
      await sleep(4 * start.lostWakeBoundMs);
      const later = { statements: runtime.view.stats.statements, ...runtime.diagnostics() };
      const beats = later.heartbeats - quiet.heartbeats;
      assert.ok(beats >= 2, `heartbeats kept their cadence (${beats})`);
      assert.equal(later.pumps, quiet.pumps, 'no pump while the generation is unchanged');
      assert.equal(later.claimsAttempted, quiet.claimsAttempted, 'no claim attempts while idle');
      assert.equal(later.reconciliationWakes, quiet.reconciliationWakes);
      t.diagnostic(`idle: ${beats} heartbeats, ${later.statements - quiet.statements} SQL statements, 0 pumps, 0 claims`);
      assert.ok(later.statements - quiet.statements <= beats * 12, `bounded SQL per heartbeat: ${later.statements - quiet.statements} statements over ${beats} beats`);
      assert.equal(network.calls(), 0, 'zero model/provider (network) calls');
    } finally {
      network.restore();
      await runtime.stop();
      removeRoot(root);
    }
  });

  test('with no watcher at all, cross-process work is still discovered by the heartbeat', async () => {
    const root = tempRoot('nowatch');
    const runtime = runtimeFor(root, { supervisorTtlMs: SUPERVISOR_TTL_MS, watchWakeFile: false });
    try {
      await runtime.start();
      await idle(runtime);
      assert.equal(runtime.diagnostics().wakeWatcher, 'DISABLED');
      const committed = await commitFromAnotherProcess(root, 'submit');
      await eventually(() => runtime.view.getWorkItem(committed.workItemId as Id).state === 'COMPLETED', runtime.diagnostics().lostWakeBoundMs + TEST_MARGIN_MS + 5_000, 'completion');
      assert.ok(runtime.diagnostics().reconciliationWakes >= 1);
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });

  test('a cancellation committed by another process reaches the running processor although its hint was dropped', async () => {
    const root = tempRoot('lostcancel');
    let started = false;
    const waiter: Processor = {
      kind: 'test.waiter',
      sideEffects: 'NONE',
      async run(ctx) {
        started = true;
        await sleep(60_000, undefined, { signal: ctx.signal }).catch(() => undefined);
        return { type: 'CANCELLED' };
      },
    };
    const runtime = runtimeFor(root, { supervisorTtlMs: SUPERVISOR_TTL_MS, fault: dropFileHints, processors: [waiter], jobLeaseMs: 60_000 });
    try {
      await runtime.start();
      const w = runtime.submitWorkItem({ objective: 'long running', ownerRef: owner, processorKind: 'test.waiter', initialState: 'READY' }).workItem;
      await eventually(() => started, 5_000, 'processor running');
      const committed = await commitFromAnotherProcess(root, 'cancel', w.id);
      await eventually(() => runtime.view.getWorkItem(w.id).state === 'CANCELLED', runtime.diagnostics().lostWakeBoundMs + TEST_MARGIN_MS + 5_000, 'cancellation honoured');
      assert.equal(runtime.diagnostics().wakeFileHints, 0);
      assert.ok(runtime.diagnostics().reconciliationWakes >= 1);
      const cancelledAt = runtime.view.history(w.id).find((t) => t.toState === 'CANCELLED')?.occurredAt;
      assert.ok(cancelledAt && Date.parse(cancelledAt) - committed.committedAtMs <= runtime.diagnostics().lostWakeBoundMs + TEST_MARGIN_MS);
    } finally {
      await runtime.stop();
      removeRoot(root);
    }
  });
});
