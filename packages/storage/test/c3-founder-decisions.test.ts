/**
 * C3 Founder Decision closure proofs (D-C3-18 .. D-C3-24): loss of the current-role certification ends
 * ordinary duty (ACTIVE → RETRAINING) while REVIEW_DUE does not; Founder Calibration gates Activation,
 * not certification; an EXTENDed probation needs new evidence; the Unlicense needs a recorded review.
 * C3-PROOF: founder-decisions
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Id } from '@qandeel-company/domain';

import { AcademyStore, CompanyStore, SkillStore } from '../src/index.js';
import { assembleContext, authorizeModelCall, beginGovernedRun, claimJob, recordToolIntent, renewSupervisor, reserveBudget, type Claim } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { C2_KINDS, hire, seed, type Seed } from './c2-helpers.js';
import { academyWorld, attempt, certify, claimFor, prepareCertification, shadowCases, workItem } from './c3-helpers.js';
import { TEST_SUPERVISOR_TTL_MS, harness, type Harness } from './helpers.js';

const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;
const reason = (r: string) => (e: unknown): boolean => isQandeelError(e) && e.details['reason'] === r;

function withSeed(fn: (h: Harness, s: Seed) => void): void {
  const h = harness();
  try {
    fn(h, seed(h.store));
  } finally {
    h.close();
  }
}

const advance = (h: Harness, ms: number): void => {
  h.clock.advance(ms);
  renewSupervisor(h.store, h.supervisor, TEST_SUPERVISOR_TTL_MS);
};
const days = (h: Harness, n: number): void => {
  for (let d = 0; d < n; d++) advance(h, 86_400_000);
};

/** A trainee (PROBATION) hired for `roleRef`. */
function trainee(s: Seed, roleRef = 'role:analyst') {
  const t = hire(s.gov, s.founder, s.departmentId, false, roleRef);
  s.gov.transitionEmployee(s.founder, t.id, { to: 'TRAINING', reasonCode: 'onboarding' });
  s.gov.transitionEmployee(s.founder, t.id, { to: 'PROBATION', reasonCode: 'trained' });
  return t;
}

/**
 * The seed's funded ACTIVE Employee, certified for its current role through the real Academy path and
 * its activation request approved by the (test stand-in) Founder surface.
 */
function activeCertified(h: Harness, s: Seed) {
  const w = academyWorld(h, s);
  const { enrollmentId, certificationId } = certify(h, s, s.employee, w);
  const a = AcademyStore.for(h.store);
  a.decideActivation(s.founder, a.activationRequests(s.employee.id)[0]?.id as string, { decision: 'APPROVE', reasonCode: 'founder.approved' });
  const employee = s.gov.getEmployee(s.employee.id);
  assert.equal(employee.state, 'ACTIVE');
  return { w, employee, enrollmentId, certificationId };
}

const lifecycle = (s: Seed, id: Id) => s.gov.employeeHistory(id).filter((x) => x.changeKind === 'LIFECYCLE').at(-1);

describe('D-C3-18: losing the current-role certification ends ordinary duty', () => {
  test('REVOKED: no new ordinary run; governed transition to RETRAINING; same identity; evidence and history kept', () => {
    withSeed((h, s) => {
      const { employee, certificationId } = activeCertified(h, s);
      const a = AcademyStore.for(h.store);
      const before = a.certifications(employee.id).find((c) => c.id === certificationId);
      assert.ok(claimFor(h, workItem(h, s, employee)).begun.ok, 'certified ACTIVE duty runs');
      const runs = s.gov.runAttributions(employee.id).length;
      a.revokeCertification(s.founder, certificationId, 'conduct.review');
      const now = s.gov.getEmployee(employee.id);
      assert.deepEqual([now.id, now.ref, now.state], [employee.id, employee.ref, 'RETRAINING'], 'same Employee, moved to RETRAINING at once');
      const last = lifecycle(s, employee.id);
      assert.deepEqual([last?.fromState, last?.toState, last?.reasonCode, last?.actorRef], ['ACTIVE', 'RETRAINING', 'ROLE_CERTIFICATION_REVOKED', 'system:runtime'], 'deterministic system transition, not the model or Employee');
      assert.ok(h.store.audit(employee.id).some((x) => x.action === 'employee.certification_lost' && x.reasonCode === 'ROLE_CERTIFICATION_REVOKED' && x.details['certificationId'] === certificationId));
      const begun = claimFor(h, workItem(h, s, employee)).begun;
      assert.ok(!begun.ok && begun.code === 'EMPLOYEE_NOT_ELIGIBLE' && begun.state === 'RETRAINING', 'no new ordinary role execution');
      // Prior evidence is historical, never deleted or rewritten.
      const after = a.certifications(employee.id).find((c) => c.id === certificationId);
      assert.deepEqual([after?.status, after?.evidence, after?.skillPins, after?.issuedAt], ['REVOKED', before?.evidence, before?.skillPins, before?.issuedAt]);
      assert.deepEqual(a.certificationHistory(certificationId).map((x) => x.toStatus), ['VALID', 'REVOKED']);
      assert.equal(s.gov.runAttributions(employee.id).length, runs, 'earlier runs stay in the portfolio; the refused one never ran');
    });
  });

  test('EXPIRED by the clock: the eligibility boundary fails closed without any administrative write, and moves the Employee to RETRAINING', () => {
    withSeed((h, s) => {
      const { employee, certificationId } = activeCertified(h, s);
      days(h, 366);
      const a = AcademyStore.for(h.store);
      assert.equal(s.gov.getEmployee(employee.id).state, 'ACTIVE', 'nothing wrote anything yet');
      const begun = claimFor(h, workItem(h, s, employee)).begun;
      assert.ok(!begun.ok && begun.code === 'EMPLOYEE_NOT_ELIGIBLE' && begun.state === 'RETRAINING');
      assert.equal(s.gov.getEmployee(employee.id).state, 'RETRAINING');
      assert.equal(lifecycle(s, employee.id)?.reasonCode, 'ROLE_CERTIFICATION_EXPIRED');
      assert.equal(a.certifications(employee.id).find((c) => c.id === certificationId)?.status, 'EXPIRED', 'expiry materialized with history');
      assert.deepEqual(a.certificationHistory(certificationId).map((x) => [x.toStatus, x.reasonCode]), [['VALID', 'CERTIFICATION_ISSUED'], ['EXPIRED', 'VALIDITY_ENDED']]);
    });
  });

  /** An ACTIVE certified run begun 30 minutes before expiry, then carried past it (within its job lease). */
  function expiringRun(h: Harness, s: Seed): { claim: Claim; wi: Id; employeeId: Id; manifestId: Id } {
    const { employee } = activeCertified(h, s);
    days(h, 364);
    advance(h, 86_400_000 - 30 * 60_000);
    const wi = workItem(h, s, employee);
    const job = h.store.jobsFor(wi).find((j) => j.state === 'QUEUED');
    const claim = claimJob(h.store, job?.id as Id, { ...h.claimOpts('w-expiry', 3_600_000), kinds: C2_KINDS }) as Claim;
    assert.ok(beginGovernedRun(h.store, claim.fence).ok, 'begins while still certified');
    const ctx = assembleContext(h.store, claim.fence, { step: 0 });
    assert.equal(ctx.outcome, 'OK');
    h.clock.advance(45 * 60_000);
    return { claim, wi, employeeId: employee.id, manifestId: ctx.manifestId };
  }

  test('a run begun before expiry reserves nothing after it (reservation boundary)', () => {
    withSeed((h, s) => {
      const r = expiringRun(h, s);
      const res = reserveBudget(h.store, r.claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: s.deploymentId, priceCardId: s.priceCardId, routePolicyId: s.policyId, money: 1_000, tokens: 100_000, contextManifestId: r.manifestId });
      assert.deepEqual(res, { ok: false, code: 'EMPLOYEE_NOT_ELIGIBLE', detail: 'RETRAINING' });
      assert.equal(s.gov.getEmployee(r.employeeId).state, 'RETRAINING');
    });
  });

  test('a run begun before expiry is refused model authorization after it (authorization boundary)', () => {
    withSeed((h, s) => {
      const r = expiringRun(h, s);
      const auth = authorizeModelCall(h.store, r.claim.fence, { taskClass: 'draft.memo', dataClass: 'D1' });
      assert.deepEqual([auth.ok, auth.ok ? null : auth.code], [false, 'EMPLOYEE_NOT_ELIGIBLE']);
      assert.equal(s.gov.getEmployee(r.employeeId).state, 'RETRAINING');
    });
  });

  test('a run begun before expiry records no tool intent after it (tool boundary)', () => {
    withSeed((h, s) => {
      const r = expiringRun(h, s);
      const intent = recordToolIntent(h.store, r.claim.fence, { toolCode: 'notes', actionCode: 'append', args: { text: 'x' }, idempotencyKey: `wi:${r.wi}:s1` });
      assert.deepEqual([intent.kind, intent.kind === 'DENIED' ? intent.code : null], ['DENIED', 'EMPLOYEE_NOT_ELIGIBLE']);
      assert.equal(s.gov.getEmployee(r.employeeId).state, 'RETRAINING');
    });
  });

  test('no alternate path: resuming a PAUSED Employee whose certification was revoked meanwhile still starts no ordinary run', () => {
    withSeed((h, s) => {
      const { employee, certificationId } = activeCertified(h, s);
      s.gov.transitionEmployee(s.founder, employee.id, { to: 'PAUSED', reasonCode: 'hold' });
      AcademyStore.for(h.store).revokeCertification(s.founder, certificationId, 'conduct.review');
      assert.equal(s.gov.getEmployee(employee.id).state, 'PAUSED', 'only ACTIVE duty is ended by the loss');
      s.gov.transitionEmployee(s.founder, employee.id, { to: 'ACTIVE', reasonCode: 'resume' });
      const begun = claimFor(h, workItem(h, s, employee)).begun;
      assert.ok(!begun.ok && begun.code === 'EMPLOYEE_NOT_ELIGIBLE');
      assert.equal(s.gov.getEmployee(employee.id).state, 'RETRAINING');
    });
  });

  test('REVIEW_DUE alone keeps the Employee ACTIVE; work that requires the certification stays blocked until recertified', () => {
    withSeed((h, s) => {
      const { employee } = activeCertified(h, s);
      assert.equal(AcademyStore.for(h.store).requireRecertification(s.founder, 'role:analyst', 'policy.changed'), 1);
      assert.equal(s.gov.getEmployee(employee.id).state, 'ACTIVE', 'REVIEW_DUE never demotes');
      assert.ok(claimFor(h, workItem(h, s, employee)).begun.ok, 'ordinary work without that requirement continues');
      const gated = claimFor(h, workItem(h, s, employee, {}, { requirements: [{ kind: 'CERTIFICATION', roleRef: 'role:analyst' }] })).begun;
      assert.ok(!gated.ok && gated.code === 'CAPABILITY_GAP', 'work that explicitly needs the certification is blocked');
      assert.equal(s.gov.getEmployee(employee.id).state, 'ACTIVE');
    });
  });

  test('the way back is the Academy: a RETRAINING Employee recertifies and is re-activated only through Activation Approval', () => {
    withSeed((h, s) => {
      const { w, employee, certificationId } = activeCertified(h, s);
      const a = AcademyStore.for(h.store);
      a.revokeCertification(s.founder, certificationId, 'conduct.review');
      const again = certify(h, s, s.gov.getEmployee(employee.id), { ...w, scenarios: { ...w.scenarios, holdout: w.scenarios.holdout2 } });
      assert.equal(s.gov.getEmployee(employee.id).state, 'RETRAINING', 'a new certification alone never re-activates');
      s.gov.transitionEmployee(s.founder, employee.id, { to: 'PROBATION', reasonCode: 'recertified' });
      const req = a.activationRequests(employee.id).find((r) => r.enrollmentId === again.enrollmentId);
      a.decideActivation(s.founder, req?.id as string, { decision: 'APPROVE', reasonCode: 'founder.approved' });
      assert.equal(s.gov.getEmployee(employee.id).state, 'ACTIVE');
      assert.ok(claimFor(h, workItem(h, s, employee)).begun.ok);
    });
  });
});

describe('D-C3-24: ACTIVE role reassignment requires a valid target-role certification', () => {
  test('the role assignment is recorded, but an ACTIVE Employee without a VALID target-role certification moves atomically to RETRAINING', () => {
    withSeed((h, s) => {
      const { employee, certificationId } = activeCertified(h, s);
      const beforeHistory = s.gov.employeeHistory(employee.id);
      const moved = s.gov.reassignEmployee(s.founder, employee.id, { roleRef: 'role:growth-director', reasonCode: 'founder.role_change' });
      assert.deepEqual([moved.id, moved.ref, moved.roleRef, moved.state], [employee.id, employee.ref, 'role:growth-director', 'RETRAINING'], 'same Employee identity, new role recorded, ordinary duty stopped');
      assert.equal(AcademyStore.for(h.store).certifications(employee.id).find((cert) => cert.id === certificationId)?.status, 'VALID', 'the previous-role certification remains truthful history');
      const afterHistory = s.gov.employeeHistory(employee.id);
      assert.equal(afterHistory.length, beforeHistory.length + 2, 'the atomic write records assignment then lifecycle');
      assert.deepEqual(afterHistory.slice(-2).map((x) => [x.changeKind, x.fromState, x.toState, x.reasonCode]), [
        ['ASSIGNMENT', 'role:analyst', 'role:growth-director', 'founder.role_change'],
        ['LIFECYCLE', 'ACTIVE', 'RETRAINING', 'ROLE_REASSIGNMENT_REQUIRES_CERTIFICATION'],
      ]);
      const begun = claimFor(h, workItem(h, s, moved)).begun;
      assert.ok(!begun.ok && begun.code === 'EMPLOYEE_NOT_ELIGIBLE' && begun.state === 'RETRAINING', 'the new role cannot execute ordinary duty');
    });
  });

  test('returning to a role whose prior certification is still VALID does not demote the Employee merely because the role reference changed', () => {
    withSeed((h, s) => {
      const { employee, certificationId: analystCertificationId } = activeCertified(h, s);
      assert.equal(s.gov.reassignEmployee(s.founder, employee.id, { roleRef: 'role:growth-director', reasonCode: 'founder.role_change' }).state, 'RETRAINING');

      const growthWorld = academyWorld(h, s, 'role:growth-director', {}, 'growth.strategy');
      const growthEmployee = s.gov.getEmployee(employee.id);
      const growth = certify(h, s, growthEmployee, growthWorld);
      s.gov.transitionEmployee(s.founder, employee.id, { to: 'PROBATION', reasonCode: 'recertified' });
      const academy = AcademyStore.for(h.store);
      const request = academy.activationRequests(employee.id).find((ar) => ar.enrollmentId === growth.enrollmentId);
      academy.decideActivation(s.founder, request?.id as string, { decision: 'APPROVE', reasonCode: 'founder.approved' });
      assert.deepEqual([s.gov.getEmployee(employee.id).roleRef, s.gov.getEmployee(employee.id).state], ['role:growth-director', 'ACTIVE']);

      assert.equal(academy.certifications(employee.id).find((cert) => cert.id === analystCertificationId)?.status, 'VALID');
      const returned = s.gov.reassignEmployee(s.founder, employee.id, { roleRef: 'role:analyst', reasonCode: 'founder.return_role' });
      assert.deepEqual([returned.roleRef, returned.state], ['role:analyst', 'ACTIVE'], 'a still-valid target-role certification avoids unnecessary retraining');
      assert.ok(claimFor(h, workItem(h, s, returned)).begun.ok, 'ordinary duty remains available');
    });
  });
});

describe('D-C3-19: Founder Calibration gates Activation, not certification', () => {
  test('a designated role is certified before calibration; activation fails closed until it is approved; then the evidence chain proceeds', () => {
    withSeed((h, s) => {
      const w = academyWorld(h, s, 'role:analyst', { founderCalibrationRequired: true });
      const t = trainee(s);
      const { enrollmentId, certificationId } = certify(h, s, t, w);
      const a = AcademyStore.for(h.store);
      assert.equal(a.certifications(t.id).find((c) => c.id === certificationId)?.status, 'VALID', 'professional certification issued while calibration is pending');
      assert.equal(a.enrollment(enrollmentId).stage, 'ACTIVATION_APPROVAL');
      const req = a.activationRequests(t.id)[0];
      assert.equal(req?.calibrationId, null);
      assert.throws(() => a.decideActivation(s.founder, req?.id as string, { decision: 'APPROVE', reasonCode: 'founder.approved' }), reason('CALIBRATION_PENDING'));
      assert.equal(s.gov.getEmployee(t.id).state, 'PROBATION');
      // The datastore's own gate refuses an ACTIVE write whose request does not carry the approved calibration.
      const db = storeContext(h.store).db;
      assert.throws(
        () =>
          db.immediate('bypass', () => {
            db.run(`UPDATE activation_requests SET state = 'APPROVED', decided_by_ref = ?, decided_at = ? WHERE id = ?`, s.founder, '2026-01-01T00:00:00.000Z', req?.id as string);
            db.run(`UPDATE employees SET state = 'ACTIVE', version = version + 1 WHERE id = ?`, t.id);
          }),
        code('STORAGE_INVARIANT'),
      );
      a.decideFounderCalibration(s.founder, enrollmentId, { decision: 'APPROVE', evidenceRefs: ['calibration:session-1'] });
      a.decideActivation(s.founder, req?.id as string, { decision: 'APPROVE', reasonCode: 'founder.approved' });
      assert.equal(s.gov.getEmployee(t.id).state, 'ACTIVE');
      assert.notEqual(a.activationRequests(t.id)[0]?.calibrationId, null, 'the approved calibration is recorded as activation evidence');
    });
  });

  test('a rejected calibration refuses activation', () => {
    withSeed((h, s) => {
      const w = academyWorld(h, s, 'role:analyst', { founderCalibrationRequired: true });
      const t = trainee(s);
      const { enrollmentId } = certify(h, s, t, w);
      const a = AcademyStore.for(h.store);
      a.decideFounderCalibration(s.founder, enrollmentId, { decision: 'REJECT', evidenceRefs: ['calibration:session-1'] });
      assert.throws(() => a.decideActivation(s.founder, a.activationRequests(t.id)[0]?.id as string, { decision: 'APPROVE', reasonCode: 'founder.approved' }), reason('CALIBRATION_REJECTED'));
      assert.equal(s.gov.getEmployee(t.id).state, 'PROBATION');
    });
  });

  test('a non-designated role is unaffected: no calibration exists or is needed', () => {
    withSeed((h, s) => {
      const w = academyWorld(h, s);
      const t = trainee(s);
      const { enrollmentId } = certify(h, s, t, w);
      const a = AcademyStore.for(h.store);
      assert.throws(() => a.decideFounderCalibration(s.founder, enrollmentId, { decision: 'APPROVE', evidenceRefs: [] }), code('INVALID_TRANSITION'));
      a.decideActivation(s.founder, a.activationRequests(t.id)[0]?.id as string, { decision: 'APPROVE', reasonCode: 'founder.approved' });
      assert.equal(s.gov.getEmployee(t.id).state, 'ACTIVE');
    });
  });
});

describe('D-C3-20: an EXTENDed probation needs new evidence after the extension', () => {
  test('EXTEND with no new evidence: no PASS; old evidence stays but alone never satisfies; the boundary survives a restart; new evidence re-opens review', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      const w = academyWorld(h, s);
      const t = trainee(s);
      const e = prepareCertification(h, s, t, w, false);
      const a = AcademyStore.for(h.store);
      assert.equal(a.enrollment(e).stage, 'PROBATION_REVIEW');
      const evidenceRows = (): number => Number(storeContext(h.store).db.get<{ n: number }>('SELECT COUNT(*) AS n FROM probation_evidence WHERE enrollment_id = ?', e)?.n);
      const before = evidenceRows();
      a.decideProbationReview(s.founder, e, 'EXTEND');
      assert.equal(a.advance(e).stage, 'SHADOW_WORK', 'the old evidence meets the criteria but cannot return to review alone');
      assert.equal(evidenceRows(), before, 'the old evidence stays as history');
      assert.throws(() => a.decideProbationReview(s.founder, e, 'PASS'), code('INVALID_TRANSITION'));
      // A negative item is not qualifying new evidence.
      const { workItem: bad } = h.store.createWorkItem({ objective: 'shadow work', ownerRef: t.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', instructions: 'shadow' } });
      a.assignShadowWork(s.founder, e, bad.id);
      a.recordProbationEvidence(s.founder, e, { kind: 'COLLABORATION', workItemId: bad.id, positive: false });
      assert.equal(a.advance(e).stage, 'SHADOW_WORK');
      // Crash / restart: the extension boundary is durable.
      const reopened = CompanyStore.open(h.root, { clock: h.clock });
      try {
        assert.equal(AcademyStore.for(reopened).advance(e).stage, 'SHADOW_WORK', 'the boundary survives a restart');
      } finally {
        reopened.close();
      }
      shadowCases(h, s, t, e, 1);
      assert.equal(a.advance(e).stage, 'PROBATION_REVIEW', 'new qualifying evidence makes the review eligible again');
      a.decideProbationReview(s.founder, e, 'PASS');
      assert.equal(a.advance(e).stage, 'ACTIVATION_APPROVAL');
    } finally {
      h.close();
    }
  });
});

describe('D-C3-21: the Unlicense needs a recorded licence review', () => {
  test('the Unlicense no longer auto-clears; it proceeds only through the recorded licence review; MIT still auto-clears', () => {
    withSeed((h, s) => {
      const reg = SkillStore.for(h.store);
      const mk = (c: string, license: string) => {
        const skill = reg.registerSkill(s.founder, { code: c, name: c, skillType: 'EXTERNAL', ownerRef: 'department:growth' });
        return reg.checkLicenseAndDependencies(reg.inspectSkillVersion(reg.registerSkillVersion(s.founder, { skillId: skill.id, versionLabel: '1.0.0', sourceRef: `github:example.${c}`, sourceRevision: 'r1', authorRef: 'org:example', licenseSpdx: license, dependencies: [], instructions: `Guidance for ${c.replace('.', ' ')}.` }).id).id);
      };
      let un = mk('public.domain.helper', 'Unlicense');
      assert.deepEqual([un.pipelineState, un.licenseStatus], ['LICENSE_DEPENDENCY_CHECKED', 'REVIEW_REQUIRED']);
      assert.throws(() => reg.advanceSkillVersion(s.founder, un.id, 'SECURITY_QUARANTINE', { reasonCode: 'q' }), reason('LICENSE_REVIEW_REQUIRED'));
      un = reg.reviewLicense(s.founder, un.id, { decision: 'CLEAR', evidenceRef: 'legal:review-u1', reasonCode: 'dedication.accepted' });
      assert.equal(un.licenseStatus, 'CLEARED_BY_REVIEW');
      assert.equal(reg.advanceSkillVersion(s.founder, un.id, 'SECURITY_QUARANTINE', { reasonCode: 'q' }).pipelineState, 'SECURITY_QUARANTINE');
      assert.equal(mk('permissive.helper', 'MIT').licenseStatus, 'CLEAR_FREE');
      assert.equal(mk('attribution.helper', 'CC-BY-4.0').licenseStatus, 'REVIEW_REQUIRED');
      const none = mk('unknown.helper', 'NOASSERTION');
      assert.deepEqual([none.pipelineState, none.licenseStatus], ['REJECTED', 'UNCLEAR']);
    });
  });
});

describe('Founder disposition 7.5: practice during RETRY stays practice', () => {
  test('practice is allowed in RETRY, never uses a holdout, and a passed practice is not certification proof', () => {
    withSeed((h, s) => {
      const w = academyWorld(h, s);
      const t = trainee(s);
      const a = AcademyStore.for(h.store);
      const e = a.enroll(s.founder, t.id, w.programVersionId);
      for (let i = 0; i < 6; i++) a.recordModuleCompletion(s.founder, e.id, `module-${i}`, `evidence:module-${i}`);
      a.advance(e.id);
      attempt(h, s, e.id, w.scenarios.practice, 'SIMULATION', 20);
      assert.equal(a.advance(e.id).stage, 'RETRY');
      assert.throws(() => a.startAttempt(e.id, { scenarioId: w.scenarios.holdout, kind: 'SIMULATION', taskClass: 'draft.memo' }), reason('HOLDOUT_NOT_FOR_PRACTICE'));
      assert.equal(a.exposures(t.id, w.scenarios.holdout), 0, 'the holdout stays blind');
      const practice = attempt(h, s, e.id, w.scenarios.practice, 'SIMULATION', 95);
      assert.deepEqual([practice.kind, practice.outcome], ['SIMULATION', 'PASS']);
      assert.equal(a.advance(e.id).stage, 'RETRY', 'a passed practice does not skip retraining or the assessment');
      assert.deepEqual(a.certifications(t.id), [], 'practice is never certification proof');
    });
  });
});
