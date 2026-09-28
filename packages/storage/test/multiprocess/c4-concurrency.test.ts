/**
 * C4 concurrency proofs: independent OS processes perform the same C4 act at the same instant. Exactly one
 * canonical outcome survives — one PRIMARY holder per seat, one decision (and one created seat) per staffing
 * request. C4-PROOF: concurrent-organization
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { newId, type Id } from '@qandeel-company/domain';

import { CompanyStore, OrganizationStore } from '../../src/index.js';
import { acquireSupervisor, beginGovernedRun, claimJob, recordOrgAct } from '../../src/runtime-authority.js';
import { C2_KINDS, hire, seed } from '../c2-helpers.js';
import { newSeat, placed } from '../c4-helpers.js';
import { TEST_SUPERVISOR_TTL_MS, removeRoot, tempRoot, type Harness } from '../helpers.js';
import { fixture, spawnScript } from '../process-harness.js';

type Outcome = { ok: boolean; state?: string; error?: string };

async function race(root: string, op: 'assign' | 'decide', id: string, founder: string, extra: readonly string[]): Promise<Outcome[]> {
  const startAt = Date.now() + 1_500;
  const children = extra.map((e) => spawnScript(fixture('c4-racer'), [root, op, id, founder, String(startAt), e]));
  const out = await Promise.all(children.map(async (c) => JSON.parse(await c.waitFor((l) => l.startsWith('{'), 40_000)) as Outcome));
  await Promise.all(children.map((c) => c.exited()));
  return out;
}

function world(root: string) {
  const store = CompanyStore.open(root);
  const supervisor = acquireSupervisor(store, newId(), TEST_SUPERVISOR_TTL_MS);
  const h = { root, store, claimOpts: (workerId = 'w', leaseMs = 120_000) => ({ workerId, leaseMs, kinds: C2_KINDS, supervisor }) } as unknown as Harness;
  return { store, h, s: seed(store) };
}

describe('C4 concurrent organization (multi-process)', () => {
  test('five processes place five different Employees in one vacant seat at once: exactly one PRIMARY holder', async () => {
    const root = tempRoot('c4-race-seat');
    const { store, h, s } = world(root);
    try {
      const seat = newSeat(h, s, 'product.analyst-1', 'director.product');
      const candidates = Array.from({ length: 5 }, () => hire(s.gov, s.founder, s.departmentId).id as string);
      const out = await race(root, 'assign', seat.id, s.founder, candidates);
      assert.equal(out.filter((r) => r.ok).length, 1, JSON.stringify(out));
      assert.ok(out.filter((r) => !r.ok).every((r) => r.error === 'ORG_NOT_ELIGIBLE'), JSON.stringify(out));
      const org = OrganizationStore.for(store);
      assert.equal(org.assignmentsOfPosition(seat.id).filter((a) => a.status === 'ACTIVE').length, 1);
      const holder = org.seatHolder(seat.id).holder?.employeeId as Id;
      assert.equal(s.gov.getEmployee(holder).positionRef, `position:${seat.id}`, 'the projection belongs to the one winner');
      assert.equal(candidates.filter((c) => s.gov.getEmployee(c as Id).positionRef === `position:${seat.id}`).length, 1);
      assert.equal(store.integrityCheck(), 'ok');
    } finally {
      store.close();
      removeRoot(root);
    }
  });

  test('four processes decide the same staffing request at once: one decision, one created seat', async () => {
    const root = tempRoot('c4-race-staffing');
    const { store, h, s } = world(root);
    try {
      const director = placed(h, s, 'director.growth');
      const org = OrganizationStore.for(store);
      org.delegateAuthority(s.founder, { employeeId: director.id, capability: 'org.staffing.request', expiresAt: '2099-01-01T00:00:00.000Z', purposeCode: 'staffing', reasonCode: 'delegated' });
      const { workItem } = store.createWorkItem({ objective: 'staffing', ownerRef: director.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', instructions: 'x' } });
      s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 10_000, capTokens: 10_000, reasonCode: 'seed' });
      store.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
      const job = store.jobsFor(workItem.id).find((j) => j.state === 'QUEUED');
      const claim = claimJob(store, job?.id as Id, { ...h.claimOpts('w-race', 120_000), kinds: C2_KINDS });
      if (!claim || !beginGovernedRun(store, claim.fence).ok) throw new Error('no run');
      const filed = recordOrgAct(store, claim.fence, 1, 'staffing.request.create', {
        departmentCode: 'growth',
        roleRef: 'role:growth.seo-specialist',
        positionKind: 'SPECIALIST',
        positionTitle: 'SEO Specialist',
        businessNeed: 'n',
        workloadEvidence: 'w',
        skillGap: 'g',
        expectedValue: 'v',
        impactIfNotStaffed: 'i',
        alternatives: { redistributeWork: 'a', improveSkillOrTraining: 'b', automate: 'c', temporarySpecialistOrCapability: 'd' },
        expectedCostMicros: 1,
      });
      const requestId = String(filed.resultRef).split(':')[1] as string;
      const out = await race(root, 'decide', requestId, s.founder, ['a', 'b', 'c', 'd']);
      assert.equal(out.filter((r) => r.ok).length, 1, JSON.stringify(out));
      assert.equal(org.staffingRequest(requestId as Id).state, 'APPROVED');
      assert.equal(org.positions().filter((p) => p.staffingRequestId === requestId).length, 1, 'one seat per approved request');
      assert.equal(store.integrityCheck(), 'ok');
    } finally {
      store.close();
      removeRoot(root);
    }
  });
});
