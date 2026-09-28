/**
 * R1 Independent Core Review — runtime regression proofs through the real Runtime Supervisor with the
 * deterministic fake provider and tools. R1-PROOF: runtime-review
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { ExponentialBackoff, QandeelError, type Id, type Processor, type ProcessorContext, type ProcessorResult } from '@qandeel-company/domain';

import { CompanyRuntime, DETERMINISTIC_PROCESSORS, type CompanyRuntime as Runtime } from '../../src/index.js';
import { eventually, removeRoot, tempRoot } from '../helpers.js';
import { fakes, final, governedRuntime, script, seedWorld, submitTask, toolReq, type C2World, type Fakes } from '../c2/c2-seed.js';

async function withWorld(label: string, fn: (ctx: { root: string; w: C2World; f: Fakes; rt: Runtime }) => Promise<void>, extra: Parameters<typeof governedRuntime>[2] = {}): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const f = fakes();
  const rt = governedRuntime(root, f, extra);
  try {
    await rt.start();
    await fn({ root, w, f, rt });
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

const state = (rt: Runtime, id: Id): string => rt.view.getWorkItem(id).state;
const settled = (rt: Runtime, id: Id, states: readonly string[]): Promise<string> => eventually(() => (states.includes(state(rt, id)) ? state(rt, id) : undefined), 15_000, `work item ${id} to reach ${states.join('/')}`);
const calls = (f: Fakes): number => f.local.totalCalls + f.cloud.totalCalls;

describe('R1-03: a reworked Work Item\'s new job continues in its own step range', () => {
  test('the new job sees the first job\'s recorded result and never re-presents (and stale-replays) its step-0 action', () =>
    withWorld('r1-rework', async ({ w, f, rt }) => {
      const { workItem } = rt.submitWorkItem({ objective: 'reviewed memo', ownerRef: w.employee.ref, processorKind: 'c2.employee-task', reviewRequired: true, processorInput: { taskClass: 'draft.memo', maxOutputTokens: 256, instructions: script(toolReq('notes', 'append', { text: 'draft v1' }), final('memo.v1')) } });
      rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'seed' });
      rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
      assert.equal(await settled(rt, workItem.id, ['WAITING_REVIEW', 'FAILED']), 'WAITING_REVIEW');
      assert.equal(calls(f), 2, 'job 1: the tool step, then FINAL');
      // Returned for rework: a NEW job of the same Work Item (its loop starts again at step 0).
      rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'rework' });
      await eventually(() => rt.view.jobsFor(workItem.id).length === 2 && state(rt, workItem.id) === 'WAITING_REVIEW', 15_000, 'the rework job to finish');
      assert.equal(calls(f), 3, 'job 2 saw job 1\'s result in its context and finished with ONE call (no stale re-proposal)');
      assert.equal(f.drivers.notes.invocations.length, 1, 'the effect happened once');
      const inv = rt.governance.toolInvocations(workItem.id);
      assert.equal(inv.length, 1);
      assert.equal(inv[0]?.attempts, 1, 'no second presentation of the step-0 key');
    }));
});

describe('R1-09: a provider answer whose accounting fails is contained', () => {
  test('an out-of-range usage report holds the money and the deployment; the route is not called again', () =>
    withWorld('r1-usage', async ({ w, f, rt }) => {
      f.cloud.reportUsage('cloud-e1', { inputTokens: 999_999_999_999, outputTokens: 999_999_999_999 });
      const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
      await settled(rt, id, ['COMPLETED', 'FAILED']);
      assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'the misbehaving deployment was called exactly once');
      const first = rt.view.runsForWorkItem(id)[0];
      assert.equal(rt.governance.reservations(first?.id as Id)[0]?.state, 'RECONCILIATION_REQUIRED', 'possibly billed: held, never left RESERVED');
      assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'HOLD');
    }));
});

describe('R1-09 attribution: local store contention is never blamed on the provider', () => {
  test('a busy store at the settlement commit holds the money but not the healthy deployment; the work completes on retry', async () => {
    let fired = false;
    await withWorld(
      'r1-busy',
      async ({ w, f, rt }) => {
        const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
        assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED']), 'COMPLETED');
        assert.ok(fired, 'the contention was injected');
        const first = rt.view.runsForWorkItem(id)[0];
        assert.equal(rt.governance.reservations(first?.id as Id)[0]?.state, 'RECONCILIATION_REQUIRED', 'possibly billed: held');
        assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'ACTIVE', 'the provider is not held for a local failure');
        assert.equal(f.cloud.calls.get('cloud-e1'), 2, 'the retry used the same healthy route');
      },
      {
        storageFault: (p) => {
          if (p === 'settlement.beforeCommit' && !fired) {
            fired = true;
            throw new QandeelError('STORAGE_BUSY', 'simulated write-lock contention at the settlement commit');
          }
        },
      },
    );
  });
});

describe('R1 B-F4: a FINAL decision survives a crash before the settle', () => {
  test('resuming from the FINAL checkpoint completes without another model call or action', async () => {
    let fired = false;
    await withWorld(
      'r1-final',
      async ({ w, f, rt }) => {
        const id = submitTask(rt, w, { instructions: script(final('decided')) });
        assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED']), 'COMPLETED');
        assert.ok(fired, 'the fault fired after the FINAL checkpoint committed');
        assert.equal(calls(f), 1, 'the resumed run honoured the checkpointed FINAL: no second model call');
        assert.equal(rt.view.runsForWorkItem(id).length, 2);
      },
      {
        storageFault: (p) => {
          if (p === 'checkpoint.afterCommit' && !fired) {
            fired = true;
            throw new Error('simulated crash after the FINAL checkpoint');
          }
        },
      },
    );
  });
});

describe('R1-01: secret material never reaches a provider through the instructions', () => {
  test('a Work Item whose instructions carry a credential is refused before any model call', () =>
    withWorld('r1-instr', async ({ w, f, rt }) => {
      const id = submitTask(rt, w, { instructions: `Use ${['sk', '-proj-', 'Q'.repeat(32)].join('')} to call the API.` });
      assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED']), 'FAILED');
      assert.equal(rt.view.runsForWorkItem(id)[0]?.failureCode, 'INVALID_TASK_INPUT');
      assert.equal(calls(f), 0);
    }));
});

describe('R1-08: a job re-claimed after an in-process lease loss stays tracked', () => {
  test('the new run survives the old run\'s completion: cancellation reaches it and stop waits for it', async () => {
    const root = tempRoot('r1-active');
    let offset = 0;
    const clock = { nowMs: () => Date.now() + offset };
    let live = 0;
    const aborted: string[] = [];
    const slow: Processor = {
      kind: 'test.slow',
      sideEffects: 'NONE',
      async run(ctx: ProcessorContext): Promise<ProcessorResult> {
        live++;
        ctx.signal.addEventListener('abort', () => aborted.push(ctx.runId), { once: true });
        try {
          // Honours abort only at its next safe point (after its current unit of work).
          await sleep(ctx.attempt === 1 ? 1_500 : 4_000);
          return ctx.signal.aborted ? { type: 'CANCELLED' } : { type: 'COMPLETED' };
        } finally {
          live--;
        }
      },
    };
    const rt = new CompanyRuntime({ workspace: root, processors: [...DETERMINISTIC_PROCESSORS, slow], concurrency: 2, clock, supervisorTtlMs: 3_000, jobLeaseMs: 1_200, backoff: new ExponentialBackoff({ baseMs: 20, maxMs: 100 }), shutdownGraceMs: 6_000 });
    try {
      await rt.start();
      const { workItem } = rt.submitWorkItem({ objective: 'slow', ownerRef: 'owner:founder', processorKind: 'test.slow', initialState: 'READY' });
      await eventually(() => live === 1, 5_000, 'the first run to start');
      offset += 5_000; // the host slept: the lease is expired
      rt.submitWorkItem({ objective: 'poke', ownerRef: 'owner:founder', processorKind: 'c1.noop', initialState: 'READY' });
      await eventually(() => rt.view.runsForWorkItem(workItem.id).length === 2 && live === 2, 5_000, 'the re-claim while the old processor is still in its grace');
      await eventually(() => live === 1, 5_000, 'the old processor to finish');
      assert.equal(rt.diagnostics().activeRuns, 1, 'the new run is still tracked (the old run did not remove its entry)');
      const newRun = rt.view.runsForWorkItem(workItem.id).at(-1)?.id as string;
      rt.cancel(workItem.id, { reasonCode: 'founder.cancel' });
      await eventually(() => aborted.includes(newRun), 2_000, 'the cancellation to reach the new run');
      await rt.stop();
      assert.equal(live, 0, 'stop waited for the live processor');
    } finally {
      await rt.stop().catch(() => undefined);
      removeRoot(root);
    }
  });
});
