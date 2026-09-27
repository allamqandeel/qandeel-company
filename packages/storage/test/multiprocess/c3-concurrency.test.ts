/**
 * C3 concurrency proofs: independent OS processes perform the same C3 act at the same instant. Exactly
 * one canonical outcome survives — one certification and one activation request per enrollment, one
 * ACTIVE transition per approved request, one knowledge item per promotion. C3-PROOF: concurrent-certification
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { newId } from '@qandeel-company/domain';

import { AcademyStore, CompanyStore, GovernanceStore, MemoryStore } from '../../src/index.js';
import { acquireSupervisor } from '../../src/runtime-authority.js';
import { C2_KINDS, hire, seed } from '../c2-helpers.js';
import { academyWorld, claimFor, complete, prepareCertification, propose, workItem } from '../c3-helpers.js';
import { TEST_SUPERVISOR_TTL_MS, removeRoot, tempRoot, type Harness } from '../helpers.js';
import { fixture, spawnScript } from '../process-harness.js';

type Outcome = { ok: boolean; stage?: string; state?: string; error?: string };

async function race(root: string, op: 'advance' | 'activate' | 'promote', id: string, founder: string, n: number): Promise<Outcome[]> {
  const startAt = Date.now() + 1_500;
  const children = Array.from({ length: n }, () => spawnScript(fixture('c3-racer'), [root, op, id, founder, String(startAt)]));
  const out = await Promise.all(children.map(async (c) => JSON.parse(await c.waitFor((l) => l.startsWith('{'), 40_000)) as Outcome));
  await Promise.all(children.map((c) => c.exited()));
  return out;
}

describe('C3 concurrent certification, activation and promotion (multi-process)', () => {
  test('six processes advance, then four approve, the same certified enrollment: one certification, one request, one ACTIVE transition', async () => {
    const root = tempRoot('c3-race-cert');
    const store = CompanyStore.open(root);
    try {
      const supervisor = acquireSupervisor(store, newId(), TEST_SUPERVISOR_TTL_MS);
      const h = { root, store, claimOpts: (workerId = 'w', leaseMs = 120_000) => ({ workerId, leaseMs, kinds: C2_KINDS, supervisor }) } as unknown as Harness;
      const s = seed(store);
      const w = academyWorld(h, s);
      const trainee = hire(s.gov, s.founder, s.departmentId, false);
      s.gov.transitionEmployee(s.founder, trainee.id, { to: 'TRAINING', reasonCode: 'onboarding' });
      s.gov.transitionEmployee(s.founder, trainee.id, { to: 'PROBATION', reasonCode: 'trained' });
      const enrollmentId = prepareCertification(h, s, trainee, w);
      const advanced = await race(root, 'advance', enrollmentId, s.founder, 6);
      assert.ok(advanced.every((r) => r.ok && r.stage === 'ACTIVATION_APPROVAL'), JSON.stringify(advanced));
      const a = AcademyStore.for(store);
      assert.equal(a.certifications(trainee.id).length, 1, 'exactly one certification');
      const requests = a.activationRequests(trainee.id);
      assert.equal(requests.length, 1, 'exactly one activation request');
      const approved = await race(root, 'activate', requests[0]?.id as string, s.founder, 4);
      assert.equal(approved.filter((r) => r.ok).length, 1, JSON.stringify(approved));
      assert.ok(approved.filter((r) => !r.ok).every((r) => r.error === 'INVALID_TRANSITION'), JSON.stringify(approved));
      const gov = GovernanceStore.for(store);
      assert.equal(gov.getEmployee(trainee.id).state, 'ACTIVE');
      assert.equal(gov.employeeHistory(trainee.id).filter((x) => x.toState === 'ACTIVE').length, 1, 'one ACTIVE transition');
      assert.equal(a.activationRequests(trainee.id)[0]?.state, 'CONSUMED');
      assert.equal(store.integrityCheck(), 'ok');
    } finally {
      store.close();
      removeRoot(root);
    }
  });

  test('four processes approve the same shared promotion: one knowledge item, the others refused', async () => {
    const root = tempRoot('c3-race-promo');
    const store = CompanyStore.open(root);
    try {
      const supervisor = acquireSupervisor(store, newId(), TEST_SUPERVISOR_TTL_MS);
      const h = { root, store, claimOpts: (workerId = 'w', leaseMs = 120_000) => ({ workerId, leaseMs, kinds: C2_KINDS, supervisor }) } as unknown as Harness;
      const s = seed(store);
      const { claim } = claimFor(h, workItem(h, s, s.employee));
      const obs = propose(h, claim, 1, { kind: 'OBSERVATION', memoryClass: null, content: 'Egypt payments: settlement delays spike before Eid.' });
      complete(h, claim);
      const m = MemoryStore.for(store);
      const lessonId = m.nominateLesson(s.founder, obs.decided?.resultLessonId as string, 'pattern.confirmed').id;
      m.validateLesson(s.founder, lessonId, { decision: 'VALIDATE', reasonCode: 'founder.validated' });
      const promo = m.requestPromotion(s.employee.ref, lessonId, 'COMPANY');
      const results = await race(root, 'promote', promo.id, s.founder, 4);
      assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
      assert.ok(results.filter((r) => !r.ok).every((r) => r.error === 'INVALID_TRANSITION'), JSON.stringify(results));
      assert.equal(m.promotions(lessonId as never).filter((p) => p.state === 'APPROVED').length, 1);
      assert.equal(m.healthCounts().knowledge['COMPANY:ACTIVE'], 1, 'exactly one knowledge item');
      assert.equal(store.integrityCheck(), 'ok');
    } finally {
      store.close();
      removeRoot(root);
    }
  });
});
