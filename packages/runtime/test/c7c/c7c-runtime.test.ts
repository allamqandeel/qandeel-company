/**
 * C7-C on the real runtime: the Pilot store rides the Founder signalling contract (a step announces once; the Evidence
 * Board, scope, briefing and inspection are reads that announce nothing and wake nothing), a refused step announces
 * nothing, and a Pilot survives a runtime restart unchanged (no Cloud-session source of truth).
 * C7C-PROOF: runtime-c7c
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CompanyStore, GovernanceStore, OrganizationStore, type EmployeeRecord } from '@qandeel-company/storage';
import { activateEmployeeForTest } from '@qandeel-company/storage/testing';

import type { CompanyRuntime } from '../../src/index.js';
import { removeRoot, tempRoot } from '../helpers.js';
import { fakes, governedRuntime, nextName, seedWorld, type C2World } from '../c2/c2-seed.js';

function seedCeo(root: string, w: C2World): EmployeeRecord {
  const store = CompanyStore.open(root);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const seat = org.positionByCode('company.ceo');
    assert.ok(seat);
    const e = gov.createEmployee(w.founder, { name: nextName(), profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: seat.roleRef, positionRef: 'position:p1', departmentId: w.departmentId, managerRef: w.founder });
    gov.transitionEmployee(w.founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(w.founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, w.founder, e.id);
    gov.createBudget(w.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 5_000_000, capTokens: 5_000_000, reasonCode: 'seed' });
    org.assignPrimary(w.founder, { positionId: seat.id, employeeId: e.id, reasonCode: 'placed' });
    return gov.getEmployee(e.id);
  } finally {
    store.close();
  }
}

describe('C7-C Pilots on the runtime', () => {
  test('a Pilot step announces once; board / scope / briefing reads announce and wake nothing; a refused step announces nothing; restart keeps the Pilot', async () => {
    const root = tempRoot('c7c-runtime');
    const w = seedWorld(root);
    seedCeo(root, w);
    let rt: CompanyRuntime = governedRuntime(root, fakes());
    try {
      await rt.start();
      let changes = 0;
      const off = rt.onFounderChange(() => {
        changes++;
      });
      const pilots = rt.founder.pilots;
      const p = pilots.create(w.founder, { mode: 'TRAINING_INTERNAL', title: 'تجربة الإطلاق' });
      assert.equal(changes, 1, 'creating announces once');
      const b = pilots.advance(w.founder, p.id, { to: 'BRIEFING', reasonCode: 'pilot.briefing' });
      assert.equal(changes, 2, 'a step announces once');
      const wakes = rt.diagnostics().wakeSignals;
      changes = 0;
      pilots.board(p.id);
      pilots.scope(p.id);
      pilots.briefing(p.id);
      pilots.list();
      pilots.history(p.id);
      pilots.health();
      assert.deepEqual([changes, rt.diagnostics().wakeSignals - wakes], [0, 0], 'derived reads are silent');
      assert.throws(() => pilots.advance(w.founder, p.id, { to: 'READY', reasonCode: 'pilot.ready' }));
      assert.equal(changes, 0, 'a refused step announces nothing');
      off();
      await rt.stop();
      rt = governedRuntime(root, fakes());
      await rt.start();
      assert.deepEqual(rt.founder.pilots.get(p.id), b, 'the Pilot, its state and its briefing binding survive a restart');
      assert.equal(rt.founder.pilots.list().length, 1);
    } finally {
      await rt.stop().catch(() => undefined);
      removeRoot(root);
    }
  });
});
