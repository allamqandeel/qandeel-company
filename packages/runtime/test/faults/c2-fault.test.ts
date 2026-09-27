/**
 * C2 crash proofs: real process death right after a budget reservation commits and right after a
 * tool intent commits; a fresh runtime process recovers coherently. C2-PROOF: governed-crash-recovery
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { assertId, type Id } from '@qandeel-company/domain';
import { CompanyStore, GovernanceStore } from '@qandeel-company/storage';

import { removeRoot, tempRoot } from '../helpers.js';
import { spawnScript, type Child } from '../process-harness.js';
import { final, script, seedWorld, toolReq } from '../c2/c2-seed.js';

const HOST = new URL('../fixtures/c2-host.js', import.meta.url);
const host = (root: string, config: Record<string, unknown>): Child => spawnScript(HOST, [root, JSON.stringify(config)]);
const parse = (line: string): Record<string, unknown> => JSON.parse(line) as Record<string, unknown>;
const isHost = (kind: string) => (l: string): boolean => l.includes(`"host":"${kind}"`);

async function crashThenRecover(root: string, config: Record<string, unknown>): Promise<{ id: Id; recovery: Record<string, unknown>; idle: Record<string, unknown> }> {
  const a = host(root, config);
  const id = assertId(parse(await a.waitFor(isHost('SUBMITTED'), 40_000)).workItemId, 'workItemId');
  await a.waitFor(isHost('DYING'), 40_000);
  await a.exited();
  const b = host(root, { exitWhenIdle: true });
  const ready = parse(await b.waitFor(isHost('READY'), 40_000));
  const idle = parse(await b.waitFor(isHost('IDLE'), 60_000));
  await b.waitFor(isHost('STOPPED'), 30_000);
  assert.equal(await b.exited(), 0, b.stderr());
  return { id, recovery: ready.recovery as Record<string, unknown>, idle };
}

describe('C2 fault matrix: process death at governed durability boundaries', () => {
  test('killed right after a model-call reservation commits → reservation held for reconciliation, work completes once, ledger coherent', async () => {
    const root = tempRoot('c2f-reserve');
    try {
      const world = seedWorld(root);
      const { id, recovery } = await crashThenRecover(root, { world, submit: { instructions: script(final('after.crash')) }, fault: 'reservation.afterCommit' });
      assert.equal(recovery.governedReservationsHeld, 1, JSON.stringify(recovery));
      const store = CompanyStore.open(root, { migrationMode: 'verify', create: false });
      try {
        const gov = GovernanceStore.for(store);
        assert.equal(store.getWorkItem(id).state, 'COMPLETED');
        assert.equal(store.runsForWorkItem(id).filter((r) => r.state === 'SUCCEEDED').length, 1);
        const states = store.runsForWorkItem(id).flatMap((r) => gov.reservations(r.id).map((x) => x.state));
        assert.deepEqual(states.sort(), ['RECONCILIATION_REQUIRED', 'SETTLED'], 'the uncertain first reservation is held, never silently dropped');
        assert.deepEqual(gov.accountingInvariants(), []);
        assert.equal(gov.healthCounts().reservationsAwaitingReconciliation, 1);
        assert.equal(store.integrityCheck(), 'ok');
      } finally {
        store.close();
      }
    } finally {
      removeRoot(root);
    }
  });

  test('killed right after a tool intent commits (driver not yet called) → retried under the same idempotency key: one invocation, one effect', async () => {
    const root = tempRoot('c2f-tool');
    try {
      const world = seedWorld(root);
      const { id, recovery, idle } = await crashThenRecover(root, { world, submit: { instructions: script(toolReq('notes', 'append', { text: 'durable note' }), final('noted')) }, fault: 'toolIntent.afterCommit' });
      assert.equal(recovery.governedInvocationsRetryable, 1, JSON.stringify(recovery));
      assert.equal(idle.notes, 1, 'the driver ran exactly once, in the recovering process');
      const store = CompanyStore.open(root, { migrationMode: 'verify', create: false });
      try {
        const gov = GovernanceStore.for(store);
        assert.equal(store.getWorkItem(id).state, 'COMPLETED');
        const inv = gov.toolInvocations(id);
        assert.equal(inv.length, 1);
        assert.equal(inv[0]?.state, 'SUCCEEDED');
        assert.equal(inv[0]?.attempts, 2);
        assert.deepEqual(gov.accountingInvariants(), []);
      } finally {
        store.close();
      }
    } finally {
      removeRoot(root);
    }
  });
});
