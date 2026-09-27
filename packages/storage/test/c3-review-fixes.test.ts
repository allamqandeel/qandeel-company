/**
 * Regression proofs for the C3 internal review findings (wake-ups, recovery isolation, durable recent
 * results, compaction stability, market context, revalidation, canonical precedence at write time,
 * D3 / D4 retention, learning-path dead ends, certification pins, recertification magnitude, licence
 * review, constrained attempts). C3-PROOF: review-fixes
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Id } from '@qandeel-company/domain';

import { AcademyStore, CapabilityStore, MemoryStore, SkillStore } from '../src/index.js';
import { decidePendingCandidates, recordStepResult, renewSupervisor, submitMemoryCandidate, type Claim } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { hire, seed, type Seed } from './c2-helpers.js';
import { academyWorld, approvedSkill, assemble, certify, claimFor, complete, prepareCertification, propose, shadowCases, workItem } from './c3-helpers.js';
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

function run(h: Harness, s: Seed, input: Record<string, unknown> = {}, caps?: Parameters<CapabilityStore['declareRequirements']>[1]): Claim {
  const { claim, begun } = claimFor(h, workItem(h, s, s.employee, input, caps));
  assert.ok(begun.ok, `run begins: ${JSON.stringify(begun)}`);
  return claim;
}

const jobState = (h: Harness, wi: Id): string => h.store.jobsFor(wi).at(-1)?.state ?? 'NONE';
const days = (h: Harness, n: number): void => {
  for (let d = 0; d < n; d++) {
    h.clock.advance(86_400_000);
    renewSupervisor(h.store, h.supervisor, TEST_SUPERVISOR_TTL_MS);
  }
};

describe('C3 review fixes: wake-ups and recovery', () => {
  test('work held on a memory conflict wakes when a Founder correction resolves it (same transaction)', () => {
    withSeed((h, s) => {
      const c = run(h, s);
      propose(h, c, 1, { content: 'Egypt launch: before Ramadan.', claimKey: 'egypt.launch.timing', claimValue: 'before-ramadan' });
      const b = propose(h, c, 2, { content: 'Egypt launch: after Ramadan.', claimKey: 'egypt.launch.timing', claimValue: 'after-ramadan' });
      complete(h, c);
      const held = run(h, s, {}, { requirements: [], importance: 'IMPORTANT', topics: ['egypt.launch'] });
      assert.equal(assemble(h, held, 0).outcome, 'CONFLICT_HOLD');
      complete(h, held, { type: 'WAIT', reasonCode: 'MEMORY_CONFLICT_REVIEW' });
      assert.equal(jobState(h, held.workItem.id), 'WAITING');
      MemoryStore.for(h.store).correctMemory(s.founder, b.decided?.resultMemoryId as string, { disposition: 'INCORRECT', reasonCode: 'founder.says.before' });
      assert.equal(jobState(h, held.workItem.id), 'QUEUED', 'the resolution woke the held work');
    });
  });

  test('a capability gap that closes while the run is settling is re-checked at the WAIT settle (no lost wake)', () => {
    withSeed((h, s) => {
      const { skill, version } = approvedSkill(h, s, 'payments.research');
      const wi = workItem(h, s, s.employee, {}, { requirements: [{ kind: 'SKILL', skillId: skill.id, minProficiency: 'LEARNING' }] });
      const { claim, begun } = claimFor(h, wi);
      assert.ok(!begun.ok && begun.code === 'CAPABILITY_GAP');
      // The passport opens while the run is still running: the targeted wake finds nothing parked yet.
      SkillStore.for(h.store).openPassportEntry(s.founder, s.employee.id, version.id);
      complete(h, claim, { type: 'WAIT', reasonCode: 'CAPABILITY_GAP' });
      assert.equal(jobState(h, wi), 'QUEUED', 'the settle re-ran the gate and woke the work at once');
      assert.equal(CapabilityStore.for(h.store).gapFor(wi)?.state, 'RESOLVED');
    });
  });

  test('a cancelled gap wakes its work to end it: the next run start fails typed, audited, never re-routed', () => {
    withSeed((h, s) => {
      const { skill } = approvedSkill(h, s, 'payments.research');
      const wi = workItem(h, s, s.employee, {}, { requirements: [{ kind: 'SKILL', skillId: skill.id, minProficiency: 'LEARNING' }] });
      const { claim } = claimFor(h, wi);
      complete(h, claim, { type: 'WAIT', reasonCode: 'CAPABILITY_GAP' });
      const cap = CapabilityStore.for(h.store);
      const gap = cap.gapFor(wi);
      cap.cancelGap(s.founder, gap?.id as string, 'requirement.withdrawn');
      assert.equal(jobState(h, wi), 'QUEUED');
      assert.ok(h.store.auditByAction('capability.gap_cancelled').some((x) => x.entityId === gap?.id));
      const next = claimFor(h, wi, 'w-after').begun;
      assert.ok(!next.ok && next.code === 'CAPABILITY_GAP_CANCELLED');
    });
  });

  test('recovery decides each pending candidate on its own: a tampered candidate is refused with a code, the others are decided', () => {
    withSeed((h, s) => {
      const c = run(h, s);
      const a = submitMemoryCandidate(h.store, c.fence, 1, { kind: 'MEMORY', memoryClass: 'EXPERIENCE', topic: 'egypt.payments', claimKey: null, claimValue: null, content: 'Egypt payments: Alexandria merchants use Fawry.', confidencePct: 60 });
      const b = submitMemoryCandidate(h.store, c.fence, 2, { kind: 'MEMORY', memoryClass: 'EXPERIENCE', topic: 'egypt.payments', claimKey: null, claimValue: null, content: 'Egypt payments: Luxor merchants prefer cash on delivery.', confidencePct: 60 });
      assert.ok(a.kind === 'SUBMITTED' && b.kind === 'SUBMITTED');
      const db = storeContext(h.store).db;
      db.execScript('DROP TRIGGER memory_candidates_decided_once');
      db.run("UPDATE memory_candidates SET content = 'Egypt payments: tampered text.' WHERE id = ?", a.candidateId);
      assert.equal(decidePendingCandidates(h.store, h.supervisor), 2);
      const m = MemoryStore.for(h.store);
      const byId = new Map(m.candidates(c.workItem.id).map((x) => [x.id, x]));
      assert.deepEqual([byId.get(a.candidateId)?.state, byId.get(a.candidateId)?.decisionReason], ['REFUSED', 'INTEGRITY_FAILED']);
      assert.equal(byId.get(b.candidateId)?.state, 'ACCEPTED');
      assert.deepEqual(m.pendingCandidates(), []);
    });
  });
});

describe('C3 review fixes: context', () => {
  test('recent results come from durable step records only, chronologically; only the newest is required, so long loops never fail on them', () => {
    withSeed((h, s) => {
      const c = run(h, s, { contextBudgetTokens: 4_000 });
      for (let step = 0; step < 8; step++) recordStepResult(h.store, c.fence, step, 'TOOL_RESULT', JSON.stringify({ step, result: 'r'.repeat(1_800) }));
      recordStepResult(h.store, c.fence, 7, 'TOOL_RESULT', 'a second record for the same step is ignored');
      const a = assemble(h, c, 8);
      assert.equal(a.outcome, 'OK', 'older results are dropped under the budget, never a hard failure');
      if (a.outcome !== 'OK') return;
      const tools = a.messages.filter((m) => m.role === 'tool').map((m) => (JSON.parse(m.content) as { step: number }).step);
      assert.ok(tools.length >= 1 && tools.length < 8, `a bounded subset is selected (${tools.length})`);
      assert.equal(tools.at(-1), 7, 'the newest result is always present');
      assert.deepEqual(tools, [...tools].sort((x, y) => x - y), 'rendered in the order they happened');
      const early = assemble(h, c, 3);
      const earlySteps = early.outcome === 'OK' ? early.messages.filter((m) => m.role === 'tool').map((m) => (JSON.parse(m.content) as { step: number }).step) : [];
      assert.ok(earlySteps.includes(2) && earlySteps.every((x) => x < 3), 'a step sees only earlier steps, the newest always');
    });
  });

  test('a compaction summary is reused across differently worded tasks (no churn); claim-bearing memories are never compacted', () => {
    withSeed((h, s) => {
      const c = run(h, s);
      const places = ['Cairo', 'Alexandria', 'Giza', 'Luxor', 'Aswan', 'Mansoura'];
      places.forEach((p, i) => propose(h, c, i + 1, { content: `Egypt payments: merchants in ${p} report wallet adoption rising.` }));
      const claimed = propose(h, c, 20, { content: 'Egypt payments: the preferred rail is wallets.', claimKey: 'egypt.payments.rail', claimValue: 'wallets' });
      complete(h, c);
      const m = MemoryStore.for(h.store);
      const a1 = assemble(h, run(h, s, { instructions: 'Egypt payments memo for merchants.' }), 0);
      const a2 = assemble(h, run(h, s, { instructions: 'Wallet adoption report: payments trends.' }), 0);
      const sums = m.summaries(s.employee.id);
      assert.equal(sums.length, 1, 'one summary, reused');
      assert.equal(sums[0]?.status, 'VALID');
      for (const man of [a1, a2]) {
        const entries = m.manifestEntries(man.manifestId);
        assert.ok(entries.some((e) => e.itemId === sums[0]?.id && e.decision === 'SELECTED'));
        assert.ok(entries.some((e) => e.itemId === claimed.decided?.resultMemoryId && e.reasonCode !== 'COMPACTED'), 'the claim-bearing memory stays individually governed');
      }
    });
  });
});

describe('C3 review fixes: memory and knowledge', () => {
  test('what a Work Item teaches keeps its market: memories and lessons carry the market ref and are not served elsewhere', () => {
    withSeed((h, s) => {
      const eg = run(h, s, {}, { requirements: [], marketRef: 'market:eg', topics: ['egypt.payments'] });
      const mem = propose(h, eg, 1, { content: 'Egypt payments: wallets dominate small merchants.' });
      const obs = propose(h, eg, 2, { kind: 'OBSERVATION', memoryClass: null, content: 'Egypt payments: settlement slows before Eid.' });
      complete(h, eg);
      const m = MemoryStore.for(h.store);
      assert.equal(m.memory(mem.decided?.resultMemoryId as Id).marketRef, 'market:eg');
      assert.equal(m.lesson(obs.decided?.resultLessonId as Id).marketRef, 'market:eg');
      const sa = assemble(h, run(h, s, { instructions: 'Payments memo about wallets and merchants.' }, { requirements: [], marketRef: 'market:sa' }), 0);
      assert.equal(m.manifestEntries(sa.manifestId).find((e) => e.itemId === mem.decided?.resultMemoryId)?.reasonCode, 'MARKET_MISMATCH');
    });
  });

  test('staleness is decay, not deletion: re-observing a stale memory re-validates it; the Founder can re-validate too', () => {
    withSeed((h, s) => {
      const c = run(h, s);
      const x = propose(h, c, 1, { memoryClass: 'CURRENT_WORK', content: 'The Egypt payments memo is waiting on Finance numbers.' });
      const y = propose(h, c, 2, { memoryClass: 'CURRENT_WORK', content: 'The Egypt payments memo needs the Fawry fee table.' });
      complete(h, c);
      days(h, 31);
      assemble(h, run(h, s), 0);
      const m = MemoryStore.for(h.store);
      assert.equal(m.memory(x.decided?.resultMemoryId as Id).status, 'STALE');
      const again = propose(h, run(h, s), 1, { memoryClass: 'CURRENT_WORK', content: 'The Egypt payments memo is waiting on Finance numbers.' });
      assert.deepEqual([again.decided?.state, again.decided?.decisionReason, again.decided?.resultMemoryId], ['ACCEPTED', 'REVALIDATED', x.decided?.resultMemoryId]);
      const back = m.memory(x.decided?.resultMemoryId as Id);
      assert.equal(back.status, 'ACTIVE');
      assert.ok((back.reviewAt ?? '') > h.store.now());
      assert.equal(m.revalidateMemory(s.founder, y.decided?.resultMemoryId as string, 'founder.confirmed').status, 'ACTIVE');
    });
  });

  test('canonical truth binds at write time too: pending lessons are rejected and nothing contradicting it can be promoted', () => {
    withSeed((h, s) => {
      const c = run(h, s);
      const l1 = propose(h, c, 1, { memoryClass: 'PERSONAL_LESSON', content: 'Lesson: launch Egypt payments before Ramadan.', claimKey: 'egypt.launch.timing', claimValue: 'before-ramadan' });
      const l2 = propose(h, c, 2, { memoryClass: 'PERSONAL_LESSON', content: 'Lesson: Egypt launches go before Ramadan.', claimKey: 'egypt.launch.timing', claimValue: 'before-ramadan' });
      complete(h, c);
      const m = MemoryStore.for(h.store);
      const validated = l1.decided?.resultLessonId as Id;
      m.validateLesson(s.founder, validated, { decision: 'VALIDATE', reasonCode: 'founder.validated' });
      m.recordCanonicalTruth(s.founder, { level: 'DECISION', topic: 'egypt.launch', claimKey: 'egypt.launch.timing', claimValue: 'after-ramadan', statement: 'QANDEEL launches in Egypt after Ramadan.', dataClass: 'D1', sourceRef: 'decision:launch' });
      assert.equal(m.lesson(l2.decided?.resultLessonId as Id).stage, 'REJECTED', 'a pending contradicting lesson is rejected');
      assert.throws(() => m.requestPromotion(s.employee.ref, validated, 'PERSONAL'), reason('CONTRADICTS_CANONICAL'));
      assert.deepEqual(m.memories(s.employee.id).filter((x) => x.claimKey === 'egypt.launch.timing'), []);
    });
  });

  test('D4 context is never retained; D3 lessons are never shared; promotions are one per target and never claim Founder authority', () => {
    withSeed((h, s) => {
      const d4 = run(h, s, { dataClass: 'D4' });
      assert.deepEqual([propose(h, d4, 1, { content: 'Egypt payments: sovereign detail.' }).decided?.state, propose(h, d4, 2, { content: 'Egypt payments: another sovereign detail.' }).decided?.decisionReason], ['REFUSED', 'DATA_CLASS_NOT_RETAINED']);
      complete(h, d4);
      const d3 = run(h, s, { dataClass: 'D3' });
      const obs = propose(h, d3, 1, { kind: 'OBSERVATION', memoryClass: null, content: 'Egypt payments: partner fee structure pattern.' });
      complete(h, d3);
      const m = MemoryStore.for(h.store);
      const lesson = m.nominateLesson(s.founder, obs.decided?.resultLessonId as string, 'pattern.confirmed').id;
      m.validateLesson(s.founder, lesson, { decision: 'VALIDATE', reasonCode: 'ok' });
      assert.throws(() => m.requestPromotion('founder:someone', lesson, 'COMPANY'), code('VALIDATION_FAILED'));
      const shared = m.requestPromotion(s.employee.ref, lesson, 'COMPANY');
      assert.throws(() => m.requestPromotion(s.employee.ref, lesson, 'COMPANY'), reason('PROMOTION_EXISTS'));
      assert.throws(() => m.decidePromotion(s.founder, shared.id, { decision: 'APPROVE', reasonCode: 'ok' }), reason('DATA_CLASS_NOT_SHAREABLE'));
      m.requestPromotion(s.employee.ref, lesson, 'PERSONAL');
      assert.throws(() => m.requestPromotion(s.employee.ref, lesson, 'PERSONAL'), reason('PROMOTION_EXISTS'), 'no duplicate personal memories');
    });
  });
});

describe('C3 review fixes: Academy and Skills', () => {
  test('probation FAIL → diagnosis → retraining → new shadow work in a new evidence epoch; EXTEND → more shadow work; old cases never count again', () => {
    withSeed((h, s) => {
      const w = academyWorld(h, s);
      const trainee = hire(s.gov, s.founder, s.departmentId, false);
      s.gov.transitionEmployee(s.founder, trainee.id, { to: 'TRAINING', reasonCode: 'onboarding' });
      s.gov.transitionEmployee(s.founder, trainee.id, { to: 'PROBATION', reasonCode: 'trained' });
      const e = prepareCertification(h, s, trainee, w, false);
      const a = AcademyStore.for(h.store);
      assert.equal(a.enrollment(e).stage, 'PROBATION_REVIEW');
      a.decideProbationReview(s.founder, e, 'EXTEND');
      assert.equal(a.enrollment(e).stage, 'SHADOW_WORK');
      assert.equal(a.advance(e).stage, 'PROBATION_REVIEW', 'extended: back to review with the same epoch\'s cases');
      a.decideProbationReview(s.founder, e, 'FAIL');
      assert.deepEqual([a.enrollment(e).stage, a.enrollment(e).evidenceEpoch], ['RETRY', 2]);
      const rem = a.remediations(e).at(-1);
      assert.ok(rem?.probationReviewId && rem.attemptId === null && rem.categories.length > 0);
      assert.equal(a.advance(e).stage, 'RETRY', 'waits for retraining');
      a.completeRetraining(s.founder, rem.id, 'evidence:retrained');
      assert.equal(a.advance(e).stage, 'SHADOW_WORK');
      assert.equal(a.remediations(e).at(-1)?.state, 'RETESTED');
      assert.equal(a.advance(e).stage, 'SHADOW_WORK', 'the failed epoch\'s cases do not count');
      shadowCases(h, s, trainee, e, 2);
      assert.equal(a.advance(e).stage, 'PROBATION_REVIEW');
      a.decideProbationReview(s.founder, e, 'PASS');
      assert.equal(a.advance(e).stage, 'ACTIVATION_APPROVAL');
    });
  });

  test('a rejected activation closes the enrollment (history kept) and the Employee may enroll again', () => {
    withSeed((h, s) => {
      const w = academyWorld(h, s);
      const trainee = hire(s.gov, s.founder, s.departmentId, false);
      s.gov.transitionEmployee(s.founder, trainee.id, { to: 'TRAINING', reasonCode: 'onboarding' });
      s.gov.transitionEmployee(s.founder, trainee.id, { to: 'PROBATION', reasonCode: 'trained' });
      const { enrollmentId } = certify(h, s, trainee, w);
      const a = AcademyStore.for(h.store);
      a.decideActivation(s.founder, a.activationRequests(trainee.id)[0]?.id as string, { decision: 'REJECT', reasonCode: 'not.yet' });
      assert.equal(a.enrollment(enrollmentId).stage, 'WITHDRAWN');
      assert.equal(a.enroll(s.founder, trainee.id, w.programVersionId).stage, 'LEARN');
    });
  });

  test('a certification pins a current, rolled-out version — never the target of an unfinished update', () => {
    withSeed((h, s) => {
      const w = academyWorld(h, s);
      const reg = SkillStore.for(h.store);
      let v2 = reg.registerSkillVersion(s.founder, { skillId: w.skill.id, versionLabel: '2.0.0', sourceRef: 'github:example.market.research', sourceRevision: 'r2', authorRef: 'org:example', licenseSpdx: 'MIT', dependencies: [], instructions: 'Guidance v2 for market research.', previousVersionId: w.version.id });
      v2 = reg.checkLicenseAndDependencies(reg.inspectSkillVersion(v2.id).id);
      for (const [to, extra] of [['SECURITY_QUARANTINE', {}], ['SANDBOXED', { evidenceRef: 'review:s2', securityPassed: true }], ['BENCHMARKED', { evidenceRef: 'benchmark:b2' }], ['COMPARED', {}], ['APPROVED', {}]] as const) v2 = reg.advanceSkillVersion(s.founder, v2.id, to, { reasonCode: 'step', ...extra });
      reg.planUpdate(s.founder, { fromVersionId: w.version.id, toVersionId: v2.id, material: false, recertificationImpact: 'NONE' });
      const trainee = hire(s.gov, s.founder, s.departmentId, false);
      s.gov.transitionEmployee(s.founder, trainee.id, { to: 'TRAINING', reasonCode: 'onboarding' });
      s.gov.transitionEmployee(s.founder, trainee.id, { to: 'PROBATION', reasonCode: 'trained' });
      certify(h, s, trainee, w);
      assert.equal(AcademyStore.for(h.store).certifications(trainee.id)[0]?.skillPins[0]?.skillVersionId, w.version.id);
    });
  });

  test('recertification matches the change: an unchanged blueprint keeps certifications VALID; a TARGETED update re-tests the skill only', () => {
    withSeed((h, s) => {
      const w = academyWorld(h, s);
      certify(h, s, s.employee, w);
      const reg = SkillStore.for(h.store);
      reg.publishBlueprint(s.founder, w.roleRef, [{ skillId: w.skill.id, category: 'REQUIRED', minProficiency: 'QUALIFIED', critical: true }]);
      assert.equal(AcademyStore.for(h.store).certifications(s.employee.id)[0]?.status, 'VALID', 'no material blueprint change');
      let v2 = reg.registerSkillVersion(s.founder, { skillId: w.skill.id, versionLabel: '2.0.0', sourceRef: 'github:example.market.research', sourceRevision: 'r2', authorRef: 'org:example', licenseSpdx: 'MIT', dependencies: [], instructions: 'Guidance v2 for market research.', previousVersionId: w.version.id });
      v2 = reg.checkLicenseAndDependencies(reg.inspectSkillVersion(v2.id).id);
      for (const [to, extra] of [['SECURITY_QUARANTINE', {}], ['SANDBOXED', { evidenceRef: 'review:s2', securityPassed: true }], ['BENCHMARKED', { evidenceRef: 'benchmark:b2' }], ['COMPARED', {}], ['APPROVED', {}]] as const) v2 = reg.advanceSkillVersion(s.founder, v2.id, to, { reasonCode: 'step', ...extra });
      reg.rolloutUpdate(s.founder, reg.planUpdate(s.founder, { fromVersionId: w.version.id, toVersionId: v2.id, material: true, recertificationImpact: 'TARGETED' }).id);
      assert.equal(reg.passport(s.employee.id)[0]?.status, 'RECERTIFICATION_REQUIRED');
      assert.equal(AcademyStore.for(h.store).certifications(s.employee.id)[0]?.status, 'VALID', 'a targeted update re-tests the skill, not the role');
      reg.publishBlueprint(s.founder, w.roleRef, [{ skillId: w.skill.id, category: 'REQUIRED', minProficiency: 'PROFICIENT', critical: true }]);
      assert.equal(AcademyStore.for(h.store).certifications(s.employee.id)[0]?.status, 'REVIEW_DUE', 'a stricter mandatory requirement is material');
    });
  });

  test('a licence with obligations waits for a recorded licence review: cleared with evidence it continues; rejected it ends', () => {
    withSeed((h, s) => {
      const reg = SkillStore.for(h.store);
      const mk = (code: string, license: string) => {
        const skill = reg.registerSkill(s.founder, { code, name: code, skillType: 'EXTERNAL', ownerRef: 'department:growth' });
        return reg.checkLicenseAndDependencies(reg.inspectSkillVersion(reg.registerSkillVersion(s.founder, { skillId: skill.id, versionLabel: '1.0.0', sourceRef: `github:example.${code}`, sourceRevision: 'r1', authorRef: 'org:example', licenseSpdx: license, dependencies: [], instructions: `Guidance for ${code.replace('.', ' ')}.` }).id).id);
      };
      let byCc = mk('market.brief', 'CC-BY-4.0');
      assert.deepEqual([byCc.pipelineState, byCc.licenseStatus], ['LICENSE_DEPENDENCY_CHECKED', 'REVIEW_REQUIRED']);
      assert.throws(() => reg.advanceSkillVersion(s.founder, byCc.id, 'SECURITY_QUARANTINE', { reasonCode: 'q' }), reason('LICENSE_REVIEW_REQUIRED'));
      byCc = reg.reviewLicense(s.founder, byCc.id, { decision: 'CLEAR', evidenceRef: 'legal:review-1', reasonCode: 'attribution.kept' });
      assert.equal(byCc.licenseStatus, 'CLEARED_BY_REVIEW');
      for (const [to, extra] of [['SECURITY_QUARANTINE', {}], ['SANDBOXED', { evidenceRef: 'review:s1', securityPassed: true }], ['BENCHMARKED', { evidenceRef: 'benchmark:b1' }], ['COMPARED', {}], ['APPROVED', {}]] as const) byCc = reg.advanceSkillVersion(s.founder, byCc.id, to, { reasonCode: 'step', ...extra });
      assert.equal(reg.eligibility(byCc.id).eligible, true);
      const gpl = reg.reviewLicense(s.founder, mk('copyleft.helper', 'GPL-3.0-only').id, { decision: 'REJECT', evidenceRef: 'legal:review-2', reasonCode: 'copyleft.not.accepted' });
      assert.deepEqual([gpl.pipelineState, gpl.failureReason], ['REJECTED', 'LICENSE_REVIEW_REJECTED']);
    });
  });

  test('a suspended Employee cannot take its open attempt (no constrained run for a non-executing state)', () => {
    withSeed((h, s) => {
      const w = academyWorld(h, s);
      const a = AcademyStore.for(h.store);
      const e = a.enroll(s.founder, s.employee.id, w.programVersionId);
      for (let i = 0; i < 6; i++) a.recordModuleCompletion(s.founder, e.id, `module-${i}`, `evidence:m${i}`);
      a.advance(e.id);
      const started = a.startAttempt(e.id, { scenarioId: w.scenarios.practice, kind: 'SIMULATION', taskClass: 'draft.memo' });
      h.store.transitionWorkItem(started.workItemId, { to: 'READY', reasonCode: 'release' });
      s.gov.transitionEmployee(s.founder, s.employee.id, { to: 'SUSPENDED', reasonCode: 'incident' });
      const begun = claimFor(h, started.workItemId).begun;
      assert.ok(!begun.ok && begun.code === 'EMPLOYEE_NOT_ELIGIBLE');
      assert.equal(a.exposures(s.employee.id, w.scenarios.practice), 0, 'nothing was assembled, nothing exposed');
    });
  });
});
