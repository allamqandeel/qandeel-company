/**
 * R1 Independent Core Review — runtime regression proofs through the real Runtime Supervisor with the
 * deterministic fake provider and tools. R1-PROOF: runtime-review
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { ExponentialBackoff, QandeelError, type Id, type Processor, type ProcessorContext, type ProcessorResult } from '@qandeel-company/domain';
import { FAILURE_DISPOSITIONS, PROVIDER_FAILURE_CLASSES, ProviderError, failureDisposition } from '@qandeel-company/governance';

import { CompanyRuntime, DETERMINISTIC_PROCESSORS, type CompanyRuntime as Runtime } from '../../src/index.js';
import { answerSnapshot, errorSnapshot, type ProviderSnapshot } from '../../src/c2/provider-boundary.js';
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

  for (const [label, second] of [
    ['throws', (): number => { throw new Error('second read fails'); }],
    ['moves outside the bounds', (): number => 257],
  ] as const) {
    test(`a charged failure whose usage ${label} on a later read is judged on one snapshot: never a held-but-uncontained split (final re-review 2)`, async () => {
      let fired = 0;
      await withWorld(
        'r1-final-thrown-shifting',
        async ({ w, f, rt }) => {
          let reads = 0;
          f.cloud.failNextCharged('cloud-e1', 'TRANSIENT', {
            get inputTokens(): number {
              return 100;
            },
            get outputTokens(): number {
              return reads++ === 0 ? 10 : second();
            },
          });
          const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
          assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED', 'BLOCKED']), 'COMPLETED');
          const states = rt.view
            .runsForWorkItem(id)
            .flatMap((r) => rt.governance.reservations(r.id))
            .filter((r) => r.deploymentId === w.deployments.cloudE1)
            .map((r) => r.state);
          // Charged on the values the fault check saw; a charged attempt is never retried on the same
          // deployment (Technical Lead decision), so the work completes on the fallback route.
          assert.deepEqual(states, ['SETTLED'], 'charged on the values the fault check saw, no same-deployment retry');
          assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'ACTIVE', 'a consistent within-bounds charge is not a violation');
          assert.ok(fired >= 1, 'a health write was refused');
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

  test('a thrown failure whose class shifts to a prototype key on a later read never releases possibly-billed money (final re-review 3)', () =>
    withWorld('r1-final-shifting-class', async ({ w, f, rt }) => {
      const generate = f.cloud.generate.bind(f.cloud);
      let armed = true;
      f.cloud.generate = async (request, signal) => {
        if (!armed || request.deploymentCode !== 'cloud-e1') return generate(request, signal);
        armed = false;
        const e = new ProviderError('TIMEOUT_AFTER_SEND');
        let reads = 0;
        Object.defineProperty(e, 'failure', { get: () => (reads++ === 0 ? 'TIMEOUT_AFTER_SEND' : 'constructor') });
        throw e;
      };
      const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
      await settled(rt, id, ['COMPLETED', 'FAILED', 'BLOCKED']);
      const first = rt.view
        .runsForWorkItem(id)
        .flatMap((r) => rt.governance.reservations(r.id))
        .find((r) => r.deploymentId === w.deployments.cloudE1);
      assert.equal(first?.state, 'RECONCILIATION_REQUIRED', 'possibly sent: held for reconciliation, never released');
    }));

  test('a charged failed attempt is never retried on the same deployment; a provably unbilled transient still is (Technical Lead decision)', async () => {
    const cloudAttempts = (rt: Runtime, w: C2World, id: Id): string[] =>
      rt.view
        .runsForWorkItem(id)
        .flatMap((r) => rt.governance.reservations(r.id))
        .filter((r) => r.deploymentId === w.deployments.cloudE1)
        .map((r) => `${r.attemptKind}:${r.state}`);
    // Charged: TRANSIENT with valid reported usage → FAILED_CHARGED, then fallback — never a paid retry.
    await withWorld('r1-charged-no-retry', async ({ w, f, rt }) => {
      f.cloud.failNextCharged('cloud-e1', 'TRANSIENT', { inputTokens: 100, outputTokens: 50 });
      const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
      assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED', 'BLOCKED']), 'COMPLETED', 'served by the fallback route');
      assert.equal(f.cloud.calls.get('cloud-e1'), 1, 'the charged deployment was not called again');
      assert.deepEqual(cloudAttempts(rt, w, id), ['PRIMARY:SETTLED']);
      // The runtime itself never attempts the paid retry: the C4 P-07 reservation refusal is only the backstop.
      const refused = rt.view.runsForWorkItem(id).flatMap((r) => rt.view.audit(r.id)).filter((a) => a.action === 'budget.refused');
      assert.deepEqual(refused, [], 'no same-deployment retry was even attempted');
      const run = rt.view.runsForWorkItem(id)[0];
      assert.equal(rt.governance.usage({ runId: run?.id as Id }).find((u) => u.deploymentId === w.deployments.cloudE1)?.outcome, 'FAILED_CHARGED');
      assert.ok(rt.governance.reservations(run?.id as Id).some((r) => r.attemptKind === 'FALLBACK' && r.deploymentId !== w.deployments.cloudE1), 'fallback reserved and accounted on its own');
    });
    // Provably unbilled: TRANSIENT without usage → released, then the bounded same-deployment retry.
    await withWorld('r1-unbilled-retry', async ({ w, f, rt }) => {
      f.cloud.failNext('cloud-e1', 'TRANSIENT');
      const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
      assert.equal(await settled(rt, id, ['COMPLETED', 'FAILED', 'BLOCKED']), 'COMPLETED');
      assert.equal(f.cloud.calls.get('cloud-e1'), 2, 'retried on the same deployment');
      assert.deepEqual(cloudAttempts(rt, w, id), ['PRIMARY:RELEASED', 'RETRY:SETTLED']);
    });
  });

  test('a provider answer equal to a runtime-control outcome (TIMEOUT / CANCELLED) is malformed provider output, contained — never a timeout (boundary sweep)', async () => {
    for (const forged of ['TIMEOUT', 'CANCELLED']) {
      await withWorld(`r1-forged-${forged.toLowerCase()}`, async ({ w, f, rt }) => {
        const generate = f.cloud.generate.bind(f.cloud);
        let armed = true;
        f.cloud.generate = async (request, signal) => {
          if (!armed || request.deploymentCode !== 'cloud-e1') return generate(request, signal);
          armed = false;
          return forged as unknown as Awaited<ReturnType<typeof generate>>;
        };
        const id = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('done')) });
        await settled(rt, id, ['COMPLETED', 'FAILED', 'BLOCKED']);
        assert.equal(rt.governance.deployment(w.deployments.cloudE1).status, 'HOLD', `${forged}: contained as a contract violation`);
        assert.equal(cloudReservation(rt, w, id), 'RECONCILIATION_REQUIRED', `${forged}: possibly billed, held`);
        const next = submitTask(rt, w, { dataClass: 'D1', instructions: script(final('again')) });
        await settled(rt, next, ['COMPLETED', 'FAILED', 'BLOCKED']);
        // The forged answer bypassed the fake's own counter: any counted call is a later routing to it.
        assert.equal(f.cloud.calls.get('cloud-e1') ?? 0, 0, `${forged}: never routed there again`);
      });
    }
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

describe('R1-09 provider boundary (Technical Lead hardening): every provider-controlled field is read exactly once into a frozen snapshot of plain values', () => {
  const bounds = { inputUpperBound: 1_000, maxOutputTokens: 256, priceCard: null };
  const TRICKS = ['constructor', '__proto__', 'prototype', 'toString', 'hasOwnProperty', 'valueOf'];
  type Plan = Record<string, readonly unknown[] | 'THROW'>;
  /** A hostile object: each planned field yields its values in turn (the last repeats) or throws; reads are counted. */
  const hostile = <T extends object>(target: T, plan: Plan, reads: Map<string, number>, name: string): T =>
    new Proxy(target, {
      get(t, key, receiver) {
        if (typeof key !== 'string' || !Object.hasOwn(plan, key)) return Reflect.get(t, key, receiver) as unknown;
        const n = reads.get(`${name}.${key}`) ?? 0;
        reads.set(`${name}.${key}`, n + 1);
        const p = plan[key];
        if (p === 'THROW') throw new Error('hostile read');
        return p?.[Math.min(n, (p?.length ?? 1) - 1)];
      },
    });
  const usageOf = (plan: Plan, reads: Map<string, number>): unknown => hostile({}, plan, reads, 'usage');
  const assertSnapshot = (s: ProviderSnapshot, reads: Map<string, number>, label: string): void => {
    for (const [key, n] of reads) assert.ok(n <= 1, `${label}: ${key} read ${n} times`);
    assert.ok(Object.isFrozen(s) && Object.isFrozen(s.usage), `${label}: frozen`);
    assert.equal(typeof s.outputText, 'string');
    assert.equal(typeof s.providerFault, 'boolean');
    assert.ok(s.failure === null || (PROVIDER_FAILURE_CLASSES as readonly string[]).includes(s.failure), `${label}: listed class`);
    if (s.usage.state === 'REPORTED') assert.ok(typeof s.usage.inputTokens === 'number' && typeof s.usage.outputTokens === 'number');
  };
  const withReads = <R>(fn: (m: Map<string, number>) => R): R => fn(new Map<string, number>());
  const answer = (plan: Plan, reads = new Map<string, number>()): [ProviderSnapshot, Map<string, number>] => [answerSnapshot(hostile({}, plan, reads, 'answer'), bounds), reads];
  const thrown = (plan: Plan, reads = new Map<string, number>()): [ProviderSnapshot, Map<string, number>] => [errorSnapshot(hostile(new ProviderError('TRANSIENT'), plan, reads, 'error'), bounds), reads];

  test('success path: changing, throwing and non-object fields are judged on one read', () => {
    const cases: [string, [ProviderSnapshot, Map<string, number>], Partial<ProviderSnapshot> & { state?: string }][] = [
      ['in-bounds then over', withReads((m) => answer({ outputText: ['ok'], usage: [usageOf({ inputTokens: [100], outputTokens: [10, 257] }, m)] }, m)), { answered: true, providerFault: false }],
      ['over then in-bounds', withReads((m) => answer({ outputText: ['ok'], usage: [usageOf({ inputTokens: [100], outputTokens: [257, 10] }, m)] }, m)), { answered: true, providerFault: true }],
      ['throwing usage field', withReads((m) => answer({ outputText: ['ok'], usage: [usageOf({ inputTokens: [100], outputTokens: 'THROW' }, m)] }, m)), { answered: false, failure: 'CONTRACT_VIOLATION', providerFault: true }],
      ['throwing usage', answer({ outputText: ['ok'], usage: 'THROW' }), { answered: false, failure: 'CONTRACT_VIOLATION', providerFault: true }],
      ['text then number', answer({ outputText: ['ok', 42], usage: [{ inputTokens: 1, outputTokens: 1 }] }), { answered: true, outputText: 'ok', providerFault: false }],
      ['number then text', answer({ outputText: [42, 'ok'], usage: [{ inputTokens: 1, outputTokens: 1 }] }), { answered: false, failure: 'CONTRACT_VIOLATION', providerFault: true }],
      ['non-object usage', answer({ outputText: ['ok'], usage: [5] }), { answered: true, providerFault: true, state: 'UNUSABLE' }],
    ];
    for (const [label, [s, reads], want] of cases) {
      assertSnapshot(s, reads, label);
      const { state, ...fields } = want;
      for (const [k, v] of Object.entries(fields)) assert.equal((s as unknown as Record<string, unknown>)[k], v, `${label}: ${k}`);
      if (state) assert.equal(s.usage.state, state, `${label}: usage`);
    }
  });

  test('thrown path: the class validated is the class used; trick values never become a disposition', () => {
    const cases: [string, [ProviderSnapshot, Map<string, number>], string, boolean][] = [
      ['timeout then prototype key', thrown({ failure: ['TIMEOUT_AFTER_SEND', 'constructor'], usage: [null] }), 'TIMEOUT_AFTER_SEND', false],
      ['violation then prototype key', thrown({ failure: ['CONTRACT_VIOLATION', '__proto__'], usage: [null] }), 'CONTRACT_VIOLATION', true],
      ['throwing class', thrown({ failure: 'THROW' }), 'CONTRACT_VIOLATION', true],
      ['throwing usage', thrown({ failure: ['TRANSIENT'], usage: 'THROW' }), 'CONTRACT_VIOLATION', true],
      ['charged, in-bounds then over', withReads((m) => thrown({ failure: ['TRANSIENT'], usage: [usageOf({ inputTokens: [100], outputTokens: [10, 257] }, m)] }, m)), 'TRANSIENT', false],
      ['charged, over then in-bounds', withReads((m) => thrown({ failure: ['TRANSIENT'], usage: [usageOf({ inputTokens: [100], outputTokens: [257, 10] }, m)] }, m)), 'TRANSIENT', true],
      ...TRICKS.map((t): [string, [ProviderSnapshot, Map<string, number>], string, boolean] => [`trick class ${t}`, thrown({ failure: [t], usage: [null] }), 'UNKNOWN', false]),
    ];
    for (const [label, [s, reads], failure, fault] of cases) {
      assertSnapshot(s, reads, label);
      assert.equal(s.failure, failure, label);
      assert.equal(s.providerFault, fault, `${label}: provider fault`);
    }
    assert.equal(errorSnapshot(new Error('plain'), bounds).failure, 'UNKNOWN', 'anything else thrown is possibly sent');
  });

  test('disposition lookup is own-key only: trick values get the held-for-reconciliation disposition', () => {
    for (const t of TRICKS) assert.equal(failureDisposition(t), FAILURE_DISPOSITIONS.UNKNOWN, t);
    for (const c of PROVIDER_FAILURE_CLASSES) assert.equal(failureDisposition(c), FAILURE_DISPOSITIONS[c], c);
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
