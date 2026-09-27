/**
 * C2 concurrency proof: independent OS processes reserve against one shared budget chain at the
 * same instant. The hierarchy never overspends and never goes negative. C2-PROOF: concurrent-reservations
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { newId } from '@qandeel-company/domain';

import { CompanyStore, GovernanceStore } from '../../src/index.js';
import { acquireSupervisor, beginGovernedRun, claimNext } from '../../src/runtime-authority.js';
import { C2_KINDS, governedItem, seed } from '../c2-helpers.js';
import { TEST_SUPERVISOR_TTL_MS, removeRoot, tempRoot, type Harness } from '../helpers.js';
import { fixture, spawnScript } from '../process-harness.js';

describe('C2 concurrent reservations (multi-process)', () => {
  test('eight processes race for a cap that fits three: exactly three reserve, none overspends', async () => {
    const root = tempRoot('c2-race');
    const store = CompanyStore.open(root);
    try {
      const supervisor = acquireSupervisor(store, newId(), TEST_SUPERVISOR_TTL_MS);
      const h = { store, claimOpts: (workerId = 'w', leaseMs = 120_000) => ({ workerId, leaseMs, kinds: C2_KINDS, supervisor }) } as unknown as Harness;
      const s = seed(store, { employeeCap: 3_500 });
      const fences = [];
      for (let i = 0; i < 8; i++) {
        governedItem(h, s, s.employee, { cap: 1_000 });
        const claim = claimNext(store, { workerId: `proc-${i}`, leaseMs: 120_000, kinds: C2_KINDS, supervisor });
        assert.ok(claim);
        assert.ok(beginGovernedRun(store, claim.fence).ok);
        fences.push(claim.fence);
      }
      const startAt = Date.now() + 1_500;
      const children = fences.map((f) => spawnScript(fixture('reserver'), [root, JSON.stringify(f), s.actions.append, '1000', String(startAt)]));
      const results = await Promise.all(children.map(async (c) => JSON.parse(await c.waitFor((l) => l.startsWith('{'), 40_000)) as { ok: boolean; code?: string; error?: string }));
      await Promise.all(children.map((c) => c.exited()));
      assert.equal(results.filter((r) => r.ok).length, 3, JSON.stringify(results));
      assert.ok(results.filter((r) => !r.ok).every((r) => r.code === 'BUDGET_EXHAUSTED'), JSON.stringify(results));
      const gov = GovernanceStore.for(store);
      const emp = gov.budgetFor('EMPLOYEE', s.employee.id);
      assert.equal(emp?.reservedMoney, 3_000);
      assert.equal(gov.budgetFor('COMPANY', 'company')?.reservedMoney, 3_000);
      assert.deepEqual(gov.accountingInvariants(), []);
      assert.equal(store.integrityCheck(), 'ok');
    } finally {
      store.close();
      removeRoot(root);
    }
  });
});
