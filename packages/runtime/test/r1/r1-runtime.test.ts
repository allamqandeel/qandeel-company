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

  test('usage over the enforced bounds is the provider\'s fault even when the settle also hits contention (R1 re-review)', async () => {
    let fired = false;
    await withWorld(
      'r1-over-bounds',
      async ({ w, f, rt }) => {
        // One token over the step's maxOutputTokens (256): a range-valid, priceable report that breaks the bound.
        f.cloud.reportUsage('cloud-e1', { inputTokens: 100, outputTokens: 257 });
        const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
        await settled(rt, id, ['COMPLETED', 'FAILED']);
        assert.ok(fired, 'the contention was injected');
        assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'the over-bounds deployment was not called again');
        const first = rt.view.runsForWorkItem(id)[0];
        assert.equal(rt.governance.reservations(first?.id as Id)[0]?.state, 'RECONCILIATION_REQUIRED', 'possibly billed: held');
        assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'HOLD', 'held on the first attempt');
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

describe('R1-09 (Technical Lead follow-up): a known provider fault stays contained across the accounting → health boundary', () => {
  const contention = (): QandeelError => new QandeelError('STORAGE_BUSY', 'simulated write-lock contention at the deployment-health write');
  const cloudReservation = (rt: Runtime, w: C2World, id: Id): string | undefined =>
    rt.view
      .runsForWorkItem(id)
      .flatMap((r) => rt.governance.reservations(r.id))
      .find((r) => r.deploymentId === w.deployments.cloudE1)?.state;

  test('money settles, the provider fault is known, the HOLD write fails once: the violator is never reusable — now, at the next route, after a restart', async () => {
    const root = tempRoot('r1-tl-contain');
    const w = seedWorld(root);
    const f = fakes();
    let fired = 0;
    const rt = governedRuntime(root, f, {
      storageFault: (p) => {
        if (p === 'deploymentOutcome.beforeCommit' && fired === 0) {
          fired++;
          throw contention();
        }
      },
    });
    try {
      await rt.start();
      // One token over the step's maxOutputTokens (256): the provider's own answer breaks the contract.
      f.cloud.reportUsage('cloud-e1', { inputTokens: 100, outputTokens: 257 });
      const first = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
      assert.equal(await settled(rt, first, ['COMPLETED', 'FAILED']), 'COMPLETED', 'the work is served by another qualified route');
      assert.equal(fired, 1, 'the deployment-health / HOLD write failed once');
      assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'the violating deployment was not called again');
      assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'HOLD', 'contained although the health write failed');
      assert.equal(cloudReservation(rt, w, first), 'RECONCILIATION_REQUIRED', 'not an ordinary settled call: possibly billed, held for reconciliation, never released');
      // The next route boundary: a new Work Item is never routed to the violator.
      const second = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('again')) });
      assert.equal(await settled(rt, second, ['COMPLETED', 'FAILED']), 'COMPLETED');
      assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'routing never selects the contained deployment');
      assert.equal(cloudReservation(rt, w, second), undefined, 'not even reserved');
    } finally {
      await rt.stop().catch(() => undefined);
    }
    // Restart: the containment is durable state, not process memory.
    const rt2 = governedRuntime(root, f);
    try {
      await rt2.start();
      assert.equal(rt2.governance.deployment(w.deployments.cloudE1).status, 'HOLD');
      const third = submitTask(rt2, w, { dataClass: 'D1', instructions: script(final('after.restart')) });
      assert.equal(await settled(rt2, third, ['COMPLETED', 'FAILED']), 'COMPLETED');
      assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'still never selected after the restart');
    } finally {
      await rt2.stop().catch(() => undefined);
      removeRoot(root);
    }
  });

  test('a healthy provider whose health write fails locally is never held or blamed', async () => {
    let fired = 0;
    await withWorld(
      'r1-tl-healthy',
      async ({ w, f, rt }) => {
        const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
        assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED']), 'COMPLETED');
        assert.equal(fired, 1, 'the health write failed once');
        assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'the paid, valid answer was used');
        assert.equal(cloudReservation(rt, w, id), 'SETTLED', 'the money write is unaffected');
        const dep = rt.governance.deployment(w.deployments.cloudE1);
        assert.equal(dep.status, 'ACTIVE', 'no false HOLD');
        assert.equal(rt.governance.provider(w.providers.cloud).status, 'ACTIVE');
        const next = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('again')) });
        assert.equal(await settled(rt, next, ['COMPLETED', 'FAILED']), 'COMPLETED');
        assert.equal(f.cloud.calls.get('cloud-e1'), 2, 'still routable');
      },
      {
        storageFault: (p) => {
          if (p === 'deploymentOutcome.beforeCommit' && fired === 0) {
            fired++;
            throw contention();
          }
        },
      },
    );
  });

  test('a malformed answer (contract violation without usage) holds the money and contains the deployment together, even when that write fails once', async () => {
    let fired = 0;
    await withWorld(
      'r1-tl-malformed',
      async ({ w, f, rt }) => {
        f.cloud.failNext('cloud-e1', 'CONTRACT_VIOLATION');
        const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
        await settled(rt, id, ['COMPLETED', 'FAILED']);
        assert.equal(fired, 1, 'the containment write failed once');
        assert.equal(f.cloud.calls.get('cloud-e1'), 1);
        assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'HOLD', 'a known violator never stays routable');
        assert.equal(cloudReservation(rt, w, id), 'RECONCILIATION_REQUIRED', 'possibly billed: held');
      },
      {
        storageFault: (p) => {
          if (p === 'deploymentOutcome.beforeCommit' && fired === 0) {
            fired++;
            throw contention();
          }
        },
      },
    );
  });

  test('a charged failure the provider classified as a contract violation settles and contains together; the violator is never paid again (focused re-review)', async () => {
    let fired = 0;
    await withWorld(
      'r1-tl-charged-violation',
      async ({ w, f, rt }) => {
        // A failed call that still reports (within-bounds, billable) usage.
        f.cloud.failNextCharged('cloud-e1', 'CONTRACT_VIOLATION', { inputTokens: 100, outputTokens: 10 });
        const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
        assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED']), 'COMPLETED');
        assert.equal(fired, 1, 'the containment write failed once');
        assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'the violator was not called (and paid) again');
        assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'HOLD');
        assert.notEqual(cloudReservation(rt, w, id), 'RESERVED');
        assert.notEqual(cloudReservation(rt, w, id), 'RELEASED', 'possibly billed: never silently released');
      },
      {
        storageFault: (p) => {
          if (p === 'deploymentOutcome.beforeCommit' && fired === 0) {
            fired++;
            throw contention();
          }
        },
      },
    );
  });

  for (const [label, arrange] of [
    ['an answer whose usage report is unusable', (f: Fakes) => f.cloud.reportUsage('cloud-e1', { inputTokens: -1, outputTokens: 10 })],
    ['a charged failure whose usage report is unusable', (f: Fakes) => f.cloud.failNextCharged('cloud-e1', 'TRANSIENT', { inputTokens: -1, outputTokens: 10 })],
  ] as const) {
    test(`${label}: money held and deployment contained together, even when that write fails once (focused re-review)`, async () => {
      let fired = 0;
      await withWorld(
        'r1-tl-unusable',
        async ({ w, f, rt }) => {
          arrange(f);
          const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
          await settled(rt, id, ['COMPLETED', 'FAILED']);
          assert.equal(fired, 1, 'the containment write failed once');
          assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'never called again');
          assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'HOLD');
          assert.equal(cloudReservation(rt, w, id), 'RECONCILIATION_REQUIRED', 'spend unknown: held');
        },
        {
          storageFault: (p) => {
            if (p === 'deploymentOutcome.beforeCommit' && fired === 0) {
              fired++;
              throw contention();
            }
          },
        },
      );
    });
  }

  test('an answer object whose usage cannot be read is the provider\'s contract violation, never an escaped error that retries the paid route (focused re-review)', () =>
    withWorld('r1-tl-lazy-answer', async ({ w, f, rt }) => {
      const generate = f.cloud.generate.bind(f.cloud);
      let broken = true;
      f.cloud.generate = async (request, signal) => {
        const answer = await generate(request, signal);
        if (!broken || request.deploymentCode !== 'cloud-e1') return answer;
        broken = false;
        return {
          outputText: answer.outputText,
          get usage(): never {
            throw new Error('lazy usage read failed');
          },
        };
      };
      const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
      assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED', 'BLOCKED']), 'COMPLETED', 'served by another route');
      assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'the paid route was not called again');
      assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'HOLD');
      assert.equal(cloudReservation(rt, w, id), 'RECONCILIATION_REQUIRED', 'possibly billed: held');
    }));

  // Final re-review (b0ac2b7): the usage VALUES are snapshotted once, so the fault check and the
  // settlement can never see different numbers from a shifting getter.
  const shiftingUsage = (f: Fakes, first: { inputTokens: number; outputTokens: number }, second: () => number): void => {
    const generate = f.cloud.generate.bind(f.cloud);
    let armed = true;
    f.cloud.generate = async (request, signal) => {
      const answer = await generate(request, signal);
      if (!armed || request.deploymentCode !== 'cloud-e1') return answer;
      armed = false;
      let reads = 0;
      return {
        outputText: answer.outputText,
        usage: {
          get inputTokens(): number {
            return first.inputTokens;
          },
          get outputTokens(): number {
            return reads++ === 0 ? first.outputTokens : second();
          },
        },
      };
    };
  };

  test('usage fields that change between reads are read once: a single refused write cannot turn the answer into an uncontained, re-paid fault (final re-review)', async () => {
    let fired = 0;
    await withWorld(
      'r1-final-shifting',
      async ({ w, f, rt }) => {
        shiftingUsage(f, { inputTokens: 100, outputTokens: 10 }, () => {
          throw new Error('second read fails');
        });
        const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
        assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED', 'BLOCKED']), 'COMPLETED');
        assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'one consistent answer: never called (and paid) again');
        assert.equal(cloudReservation(rt, w, id), 'SETTLED', 'settled on the values the fault check saw');
        assert.ok(fired >= 1, 'the health write was refused');
      },
      {
        storageFault: (p) => {
          if (p === 'deploymentOutcome.beforeCommit' && fired === 0) {
            fired++;
            throw contention();
          }
        },
      },
    );
  });

  test('usage first reported outside the bounds is contained, whatever a later read would say (final re-review)', () =>
    withWorld('r1-final-over-then-in', async ({ w, f, rt }) => {
      shiftingUsage(f, { inputTokens: 100, outputTokens: 257 }, () => 10);
      const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
      await settled(rt, id, ['COMPLETED', 'FAILED', 'BLOCKED']);
      assert.equal(f.cloud.calls.get('cloud-e1'), 1);
      assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'HOLD', 'the violation the provider reported is contained');
    }));

  test('a charged failure reporting usage outside the bounds is contained once (no double circuit count) and never retried on the same route', () =>
    withWorld('r1-tl-charged-over-bounds', async ({ w, f, rt }) => {
      f.cloud.failNextCharged('cloud-e1', 'TRANSIENT', { inputTokens: 100, outputTokens: 257 });
      const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
      assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED']), 'COMPLETED');
      assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'a transient class does not buy a retry once the usage broke the contract');
      const dep = rt.governance.deployment(w.deployments.cloudE1);
      assert.equal(dep.status, 'HOLD');
      assert.equal(dep.circuitFailures, 1, 'one call, one circuit count');
      assert.equal(cloudReservation(rt, w, id), 'SETTLED', 'charged truthfully');
    }));

  test('while even the next-route containment write is refused, routing still never selects the violator', async () => {
    let fired = 0;
    await withWorld(
      'r1-tl-flush-refused',
      async ({ w, f, rt }) => {
        f.cloud.reportUsage('cloud-e1', { inputTokens: 100, outputTokens: 257 });
        const first = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
        assert.equal(await settled(rt, first, ['COMPLETED', 'FAILED']), 'COMPLETED');
        assert.equal(fired, 3, 'settle-with-containment, hold-with-containment and the first next-route containment were all refused');
        assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'excluded from routing although the store still says ACTIVE');
        // The store accepts writes again: the next route boundary writes the containment.
        const second = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('again')) });
        assert.equal(await settled(rt, second, ['COMPLETED', 'FAILED']), 'COMPLETED');
        assert.equal(f.cloud.calls.get('cloud-e1'), 1);
        assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'HOLD');
      },
      {
        storageFault: (p) => {
          if (p === 'deploymentOutcome.beforeCommit' && fired < 3) {
            fired++;
            throw contention();
          }
        },
      },
    );
  });

  test('when the store refuses the money write AND the containment, the violator is kept out of routing until the containment is written', async () => {
    let fired = 0;
    await withWorld(
      'r1-tl-uncontained',
      async ({ w, f, rt }) => {
        f.cloud.reportUsage('cloud-e1', { inputTokens: 100, outputTokens: 257 });
        const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
        assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED']), 'COMPLETED');
        assert.equal(fired, 2, 'the settle-with-containment and the hold-with-containment were both refused');
        assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'the violator was not called again meanwhile');
        assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'HOLD', 'contained at the next route boundary');
        assert.equal(cloudReservation(rt, w, id), 'RECONCILIATION_REQUIRED', 'possibly billed: held');
      },
      {
        storageFault: (p) => {
          if (p === 'deploymentOutcome.beforeCommit' && fired < 2) {
            fired++;
            throw contention();
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
