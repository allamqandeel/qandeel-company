/**
 * C4 runtime fixtures. A reviewer is made through the real path, with the runtime executing every piece of
 * work: seeded before start (Employee with the domain's reviewer role, Skill pipeline, blueprint, program),
 * then certified by the Academy through runs, admitted to CALIBRATION, calibrated on two real shadow reviews
 * judged by the Founder, and promoted. The only test-only element is the armed Founder surface (C2 seam).
 */
import type { Id } from '@qandeel-company/domain';
import { ASSESSMENT_DIMENSIONS, DEFAULT_CRITICAL_DIMENSIONS, DETERMINISTIC_DIMENSIONS } from '@qandeel-company/mind';
import { AcademyStore, CompanyStore, GovernanceStore, SkillStore, type EmployeeRecord } from '@qandeel-company/storage';
import { activateEmployeeForTest } from '@qandeel-company/storage/testing';

import type { CompanyRuntime } from '../../src/index.js';
import { eventually } from '../helpers.js';
import { final, nextName, script, submitTask, type C2World } from '../c2/c2-seed.js';

export const DOMAIN = 'quality.general';

export const reviewDecision = (outcome: string, rationale = 'Checked against the rubric.'): unknown => ({ type: 'REVIEW_DECISION', outcome, reasonCode: 'rubric.applied', rationale, evidenceRefs: ['evidence:rubric'] });

/** A plan whose (scripted) reviewer instructions make the fake provider emit `outcome` for the reviewer. */
export const plan = (appliesTo: 'OUTPUT' | 'ACTIONS' | 'BOTH', outcome = 'PASS', over: Record<string, unknown> = {}): Record<string, unknown> => ({
  domain: DOMAIN,
  appliesTo,
  keys: [{ kind: 'SPECIALIST' }],
  rubric: { code: 'quality.rubric', version: 1 },
  reviewerInstructions: script(reviewDecision(outcome), final('review.done')),
  reviewTaskClass: 'draft.memo',
  reviewBudget: { money: 200_000, tokens: 200_000 },
  ...over,
});

export interface ReviewerWorld {
  readonly reviewer: EmployeeRecord;
  readonly programVersionId: Id;
  readonly scenarios: { readonly practice: Id; readonly holdout: Id };
}

/** Before the runtime starts: the reviewer Employee and its domain's Academy program (opened on its own connection). */
export function seedReviewer(root: string, w: C2World, domain = DOMAIN): ReviewerWorld {
  const store = CompanyStore.open(root);
  try {
    const gov = GovernanceStore.for(store);
    const role = `role:reviewer.${domain}`;
    const e = gov.createEmployee(w.founder, { name: nextName(), profile: { personality: 'exacting' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: role, positionRef: 'position:reviewer-1', departmentId: w.departmentId, managerRef: w.founder });
    gov.transitionEmployee(w.founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(w.founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    const reviewer = activateEmployeeForTest(gov, w.founder, e.id);
    gov.createBudget(w.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 5_000_000, capTokens: 5_000_000, reasonCode: 'seed' });
    gov.grant(w.founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'seed' });
    const skills = SkillStore.for(store);
    const skill = skills.registerSkill(w.founder, { code: `review.${domain.replace(/[^a-z0-9]/g, '')}`, name: 'Review craft', skillType: 'EXTERNAL', ownerRef: 'department:product' });
    let v = skills.registerSkillVersion(w.founder, { skillId: skill.id, versionLabel: '1.0.0', sourceRef: 'github:example.review', sourceRevision: 'r1', authorRef: 'org:example', licenseSpdx: 'MIT', dependencies: [], instructions: 'Guidance: judge against the rubric, cite evidence, never guess.' });
    v = skills.checkLicenseAndDependencies(skills.inspectSkillVersion(v.id).id);
    v = skills.advanceSkillVersion(w.founder, v.id, 'SECURITY_QUARANTINE', { reasonCode: 'quarantine' });
    v = skills.advanceSkillVersion(w.founder, v.id, 'SANDBOXED', { reasonCode: 'security.reviewed', evidenceRef: 'review:seed', securityPassed: true });
    v = skills.advanceSkillVersion(w.founder, v.id, 'BENCHMARKED', { reasonCode: 'benchmarked', evidenceRef: 'benchmark:seed' });
    v = skills.advanceSkillVersion(w.founder, v.id, 'COMPARED', { reasonCode: 'compared' });
    skills.advanceSkillVersion(w.founder, v.id, 'APPROVED', { reasonCode: 'approved' });
    skills.publishBlueprint(w.founder, role, [{ skillId: skill.id, category: 'REQUIRED', minProficiency: 'QUALIFIED', critical: true }]);
    const academy = AcademyStore.for(store);
    const program = academy.createProgram(w.founder, { code: `program.reviewer.${domain}`, roleRef: role });
    const pv = academy.publishProgramVersion(w.founder, program.id, {
      curriculum: ['QANDEEL_FUNDAMENTALS', 'FOUNDER_UNDERSTANDING', 'ROLE_MASTERY', 'REAL_CASE_STUDIES', 'MARKET_INTELLIGENCE', 'COMPANY_OPERATING_SKILLS'].map((category, i) => ({ code: `module-${i}`, category, sourceRefs: ['authority:stage-11'] })),
      dimensions: ASSESSMENT_DIMENSIONS.map((dimension) => ({ dimension, critical: DEFAULT_CRITICAL_DIMENSIONS.includes(dimension), passPct: 60 })),
      passAveragePct: 70,
      assessmentTrials: 1,
      holdoutRequired: true,
      maxRepeatedCriticalFailures: 2,
      certificationValidityDays: 365,
      probation: { minCases: 1, maxCriticalFailures: 0 },
      skillTargets: [{ skillId: skill.id, proficiency: 'QUALIFIED' }],
    });
    const sc = (code: string, kind: 'PRACTICE' | 'HOLDOUT'): Id => academy.addScenario(w.founder, pv.id, { code, kind, content: `Review case ${code}: judge a content draft against its rubric.`, sourceRef: 'authority:stage-11', budgetMicros: 1_000_000 }).id;
    return { reviewer, programVersionId: pv.id, scenarios: { practice: sc('practice-1', 'PRACTICE'), holdout: sc('holdout-1', 'HOLDOUT') } };
  } finally {
    store.close();
  }
}

const done = (rt: CompanyRuntime, id: Id, states: readonly string[]): Promise<string> =>
  eventually(() => (states.includes(rt.view.getWorkItem(id).state) ? rt.view.getWorkItem(id).state : undefined), 30_000, `work item ${id} → ${states.join('|')}`);

function release(rt: CompanyRuntime, w: C2World, workItemId: Id): void {
  rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItemId, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'seed' });
  rt.transitionWorkItem(workItemId, { to: 'READY', reasonCode: 'release' });
}

/** With the runtime running: certification (every attempt and shadow case is a real run), calibration, promotion. */
export async function certifyAndPromote(rt: CompanyRuntime, w: C2World, rw: ReviewerWorld, domain = DOMAIN): Promise<Id> {
  const academy = rt.mind.academy;
  const e = academy.enroll(w.founder, rw.reviewer.id, rw.programVersionId);
  for (let i = 0; i < 6; i++) academy.recordModuleCompletion(w.founder, e.id, `module-${i}`, `evidence:module-${i}`);
  academy.advance(e.id);
  const attempt = async (scenarioId: Id, kind: 'SIMULATION' | 'ASSESSMENT'): Promise<void> => {
    const started = academy.startAttempt(e.id, { scenarioId, kind, taskClass: 'draft.memo' });
    release(rt, w, started.workItemId);
    await done(rt, started.workItemId, ['COMPLETED']);
    academy.evaluateDeterministic(started.attempt.id);
    academy.recordEvaluation(w.founder, started.attempt.id, ASSESSMENT_DIMENSIONS.filter((d) => !DETERMINISTIC_DIMENSIONS.includes(d)).map((dimension) => ({ dimension, scorePct: 90 })));
  };
  await attempt(rw.scenarios.practice, 'SIMULATION');
  academy.advance(e.id);
  await attempt(rw.scenarios.holdout, 'ASSESSMENT');
  academy.advance(e.id);
  const { workItem: shadow } = rt.submitWorkItem({ objective: 'shadow review work', ownerRef: rw.reviewer.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 128, instructions: script(final('shadow.done')) } });
  academy.assignShadowWork(w.founder, e.id, shadow.id);
  release(rt, w, shadow.id);
  await done(rt, shadow.id, ['COMPLETED']);
  academy.collectShadowEvidence(e.id);
  for (const kind of ['QUALITY', 'DEMONSTRATED_LEARNING', 'COST_DISCIPLINE', 'CORRECT_ESCALATION', 'COLLABORATION'] as const) academy.recordProbationEvidence(w.founder, e.id, { kind, workItemId: shadow.id, positive: true });
  academy.advance(e.id);
  academy.decideProbationReview(w.founder, e.id, 'PASS');
  academy.advance(e.id);
  const review = rt.org.review;
  const q = review.admitReviewer(w.founder, { employeeId: rw.reviewer.id, domain, level: 'QUALIFIED', maxDataClass: 'D3', reasonCode: 'pool.admitted' });
  // Bootstrap calibration: two real outputs, each shadow-reviewed by the calibrating reviewer's own run.
  for (let i = 0; i < 2; i++) {
    const subject = submitTaskWithPlan(rt, w, script(final(`calibration.${i}`)), plan('OUTPUT', 'PASS', { domain }));
    await done(rt, subject, ['WAITING_REVIEW']);
    const request = await eventually(() => review.requests({ workItemId: subject }).find((r) => r.state === 'OPEN'), 10_000, 'calibration request');
    const shadowKey = review.assignments(request.id).find((a) => a.keyKind === 'SHADOW');
    if (!shadowKey?.reviewWorkItemId) throw new Error('no shadow assignment');
    await done(rt, shadowKey.reviewWorkItemId, ['COMPLETED']);
    const decision = await eventually(() => review.decisions(request.id).find((d) => d.assignmentId === shadowKey.id), 10_000, 'shadow decision');
    review.calibrateShadowDecision(w.founder, decision.id, 'PASS');
  }
  return review.promoteReviewer(w.founder, q.id, 'pool.promoted').id;
}

/** A governed task whose Review Plan is declared before it is released (Stage 11 §1). */
export function submitTaskWithPlan(rt: CompanyRuntime, w: C2World, instructions: string, reviewPlan: Record<string, unknown>, extra: { employee?: EmployeeRecord } = {}): Id {
  const { workItem } = rt.submitWorkItem({ objective: 'reviewed governed task', ownerRef: (extra.employee ?? w.employee).ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 256, instructions } });
  rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'seed' });
  rt.org.review.declarePlan(w.founder, workItem.id, reviewPlan);
  rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  return workItem.id;
}

export { submitTask };
