/**
 * C3 storage test helpers. Everything goes through the real public / runtime-authority paths; the
 * only test-only element is the armed Founder surface (C2 seam) that stands in for the authenticated
 * Founder surface C5 will provide. The Academy helper walks the complete learning path.
 */
import type { Id, ProcessorResult } from '@qandeel-company/domain';
import { ASSESSMENT_DIMENSIONS, DEFAULT_CRITICAL_DIMENSIONS, DETERMINISTIC_DIMENSIONS, type AssessmentDimension, type Proficiency } from '@qandeel-company/mind';

import { AcademyStore, CapabilityStore, MemoryStore, SkillStore, type EmployeeRecord, type SkillRecord, type SkillVersionRecord } from '../src/index.js';
import { assembleContext, beginGovernedRun, claimJob, decideMemoryCandidate, settle, submitMemoryCandidate, type AssembleResult, type CandidateProposal, type Claim } from '../src/runtime-authority.js';
import { C2_KINDS, GOVERNED_KIND, type Seed } from './c2-helpers.js';
import { backoff, type Harness } from './helpers.js';

export const stores = (h: Harness) => ({ memory: MemoryStore.for(h.store), skills: SkillStore.for(h.store), academy: AcademyStore.for(h.store), capability: CapabilityStore.for(h.store) });

/** A governed Work Item for `employee`: created, capability-declared (optional), budgeted, released. */
export function workItem(h: Harness, s: Seed, employee: EmployeeRecord, input: Record<string, unknown> = {}, caps?: Parameters<CapabilityStore['declareRequirements']>[1], cap = 1_000_000): Id {
  const { workItem: wi } = h.store.createWorkItem({ objective: 'c3 governed work', ownerRef: employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', dataClass: 'D1', instructions: 'Draft the Egypt payments memo.', ...input } });
  if (caps) CapabilityStore.for(h.store).declareRequirements(wi.id, caps);
  s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: wi.id, capMoney: cap, capTokens: cap, reasonCode: 'seed' });
  h.store.transitionWorkItem(wi.id, { to: 'READY', reasonCode: 'release' });
  return wi.id;
}

/** Claims exactly this Work Item's job and binds its run (as the Runtime Supervisor would). */
export function claimFor(h: Harness, workItemId: Id, workerId = 'w-c3'): { claim: Claim; begun: ReturnType<typeof beginGovernedRun> } {
  const job = h.store.jobsFor(workItemId).find((j) => j.state === 'QUEUED');
  if (!job) throw new Error('no queued job for the work item');
  const claim = claimJob(h.store, job.id, { ...h.claimOpts(workerId, 600_000), kinds: C2_KINDS });
  if (!claim) throw new Error('claim failed');
  return { claim, begun: beginGovernedRun(h.store, claim.fence) };
}

export function assemble(h: Harness, claim: Claim, step = 0): AssembleResult {
  return assembleContext(h.store, claim.fence, { step });
}

/** Submits and decides one memory candidate through the policy (two transactions, as the runtime does). */
export function propose(h: Harness, claim: Claim, step: number, p: Partial<CandidateProposal> & Pick<CandidateProposal, 'content'>): { submitted: ReturnType<typeof submitMemoryCandidate>; decided: ReturnType<typeof decideMemoryCandidate> | null } {
  const submitted = submitMemoryCandidate(h.store, claim.fence, step, { kind: 'MEMORY', memoryClass: 'EXPERIENCE', topic: 'egypt.payments', claimKey: null, claimValue: null, confidencePct: 80, ...p });
  const decided = submitted.kind === 'SUBMITTED' || submitted.kind === 'REPLAYED' ? decideMemoryCandidate(h.store, claim.fence, submitted.candidateId) : null;
  return { submitted, decided };
}

export function complete(h: Harness, claim: Claim, result: ProcessorResult = { type: 'COMPLETED' }): void {
  settle(h.store, claim.fence, result, { backoff });
}

/** Runs one Work Item to completion with no model call (as a deterministic processor would). */
export function finish(h: Harness, workItemId: Id): Claim {
  if (h.store.getWorkItem(workItemId).state === 'PROPOSED') h.store.transitionWorkItem(workItemId, { to: 'READY', reasonCode: 'release' });
  const { claim, begun } = claimFor(h, workItemId);
  if (!begun.ok) throw new Error(`run refused: ${begun.code}`);
  complete(h, claim);
  return claim;
}

/** Registers a skill and walks one version through the whole governed pipeline to APPROVED. */
export function approvedSkill(h: Harness, s: Seed, code: string, opts: { license?: string | null; instructions?: string; directives?: Record<string, string>; paid?: boolean; marketCode?: string; stopAt?: 'SECURITY_QUARANTINE' } = {}): { skill: SkillRecord; version: SkillVersionRecord } {
  const reg = SkillStore.for(h.store);
  const skill = reg.registerSkill(s.founder, { code, name: `Skill ${code}`, skillType: 'EXTERNAL', ownerRef: 'department:growth', ...(opts.marketCode ? { marketCode: opts.marketCode } : {}) });
  let v = reg.registerSkillVersion(s.founder, {
    skillId: skill.id,
    versionLabel: '1.0.0',
    sourceRef: `github:example.${code}`,
    sourceRevision: 'r1',
    authorRef: 'org:example',
    licenseSpdx: opts.license === undefined ? 'MIT' : opts.license,
    dependencies: opts.paid ? [{ name: 'paid-api', kind: 'SERVICE', paid: true }] : [],
    directives: opts.directives ?? {},
    instructions: opts.instructions ?? `Guidance for ${code.replace(/[.-]/g, ' ')}: state sources, keep it concise.`,
  });
  v = reg.inspectSkillVersion(v.id);
  if (v.pipelineState === 'REJECTED') return { skill, version: v };
  v = reg.checkLicenseAndDependencies(v.id);
  if (v.pipelineState === 'REJECTED') return { skill, version: v };
  v = reg.advanceSkillVersion(s.founder, v.id, 'SECURITY_QUARANTINE', { reasonCode: 'quarantine' });
  if (opts.stopAt === 'SECURITY_QUARANTINE') return { skill, version: v };
  v = reg.advanceSkillVersion(s.founder, v.id, 'SANDBOXED', { reasonCode: 'security.reviewed', evidenceRef: 'review:sec-1', securityPassed: true });
  v = reg.advanceSkillVersion(s.founder, v.id, 'BENCHMARKED', { reasonCode: 'benchmarked', evidenceRef: 'benchmark:b-1' });
  v = reg.advanceSkillVersion(s.founder, v.id, 'COMPARED', { reasonCode: 'compared' });
  if (opts.paid) v = reg.acknowledgePaidDependency(s.founder, v.id, 'paid.dependency.accepted');
  v = reg.advanceSkillVersion(s.founder, v.id, 'APPROVED', { reasonCode: 'approved' });
  return { skill, version: v };
}

export const program = (skillTargets: readonly { skillId: Id; proficiency: Proficiency }[], over: Record<string, unknown> = {}) => ({
  curriculum: ['QANDEEL_FUNDAMENTALS', 'FOUNDER_UNDERSTANDING', 'ROLE_MASTERY', 'REAL_CASE_STUDIES', 'MARKET_INTELLIGENCE', 'COMPANY_OPERATING_SKILLS'].map((category, i) => ({ code: `module-${i}`, category, sourceRefs: ['authority:stage-6'] })),
  dimensions: ASSESSMENT_DIMENSIONS.map((dimension) => ({ dimension, critical: DEFAULT_CRITICAL_DIMENSIONS.includes(dimension), passPct: 60 })),
  passAveragePct: 70,
  assessmentTrials: 1,
  holdoutRequired: true,
  maxRepeatedCriticalFailures: 2,
  certificationValidityDays: 365,
  probation: { minCases: 2, maxCriticalFailures: 0 },
  skillTargets,
  ...over,
});

export interface AcademyWorld {
  readonly roleRef: string;
  readonly skill: SkillRecord;
  readonly version: SkillVersionRecord;
  readonly programVersionId: Id;
  readonly scenarios: Record<'practice' | 'assessment' | 'holdout' | 'holdout2', Id>;
}

/** Blueprint + program + scenarios for a role, built on one approved skill. */
export function academyWorld(h: Harness, s: Seed, roleRef = 'role:analyst', over: Record<string, unknown> = {}, skillCode = 'market.research'): AcademyWorld {
  const { skill, version } = approvedSkill(h, s, skillCode);
  SkillStore.for(h.store).publishBlueprint(s.founder, roleRef, [{ skillId: skill.id, category: 'REQUIRED', minProficiency: 'QUALIFIED', critical: true }]);
  const a = AcademyStore.for(h.store);
  const prog = a.createProgram(s.founder, { code: `program.${roleRef.slice(5)}.${skillCode}`, roleRef });
  const pv = a.publishProgramVersion(s.founder, prog.id, program([{ skillId: skill.id, proficiency: 'QUALIFIED' }], over));
  const sc = (code: string, kind: 'PRACTICE' | 'ASSESSMENT' | 'HOLDOUT') => a.addScenario(s.founder, pv.id, { code, kind, content: `Scenario ${code}: a realistic ${kind.toLowerCase()} case about Egypt market research.`, sourceRef: 'authority:stage-6', budgetMicros: 1_000_000 }).id;
  return { roleRef, skill, version, programVersionId: pv.id, scenarios: { practice: sc('practice-1', 'PRACTICE'), assessment: sc('assessment-1', 'ASSESSMENT'), holdout: sc('holdout-1', 'HOLDOUT'), holdout2: sc('holdout-2', 'HOLDOUT') } };
}

export const scores = (score: number, override: Partial<Record<AssessmentDimension, number>> = {}) => ASSESSMENT_DIMENSIONS.filter((d) => !DETERMINISTIC_DIMENSIONS.includes(d)).map((dimension) => ({ dimension, scorePct: override[dimension] ?? score }));

/** One attempt: start → run its Work Item → deterministic rubric → evaluator scores. */
export function attempt(h: Harness, s: Seed, enrollmentId: Id, scenarioId: Id, kind: 'SIMULATION' | 'ASSESSMENT', score = 90, override: Partial<Record<AssessmentDimension, number>> = {}) {
  const a = AcademyStore.for(h.store);
  const started = a.startAttempt(enrollmentId, { scenarioId, kind, taskClass: 'draft.memo' });
  finish(h, started.workItemId);
  a.evaluateDeterministic(started.attempt.id);
  return a.recordEvaluation(s.founder, started.attempt.id, scores(score, override));
}

/**
 * The complete Academy path for one Employee up to ACTIVATION_APPROVAL: modules → case studies →
 * simulation → feedback → holdout assessment → shadow work → probation review → certification →
 * activation request. Returns the enrollment and certification.
 */
export function certify(h: Harness, s: Seed, employee: EmployeeRecord, w: AcademyWorld): { enrollmentId: Id; certificationId: Id } {
  const a = AcademyStore.for(h.store);
  const enrollmentId = prepareCertification(h, s, employee, w);
  const done = a.advance(enrollmentId);
  if (done.stage !== 'ACTIVATION_APPROVAL') throw new Error(`academy path ended at ${done.stage}`);
  const cert = a.certifications(employee.id).find((c) => c.enrollmentId === enrollmentId);
  if (!cert) throw new Error('no certification');
  return { enrollmentId, certificationId: cert.id };
}

/** The complete path up to a PASS probation review, one `advance` short of certification. */
export function prepareCertification(h: Harness, s: Seed, employee: EmployeeRecord, w: AcademyWorld, decide = true): Id {
  const a = AcademyStore.for(h.store);
  const e = a.enroll(s.founder, employee.id, w.programVersionId);
  for (let i = 0; i < 6; i++) a.recordModuleCompletion(s.founder, e.id, `module-${i}`, `evidence:module-${i}`);
  a.advance(e.id);
  attempt(h, s, e.id, w.scenarios.practice, 'SIMULATION');
  a.advance(e.id);
  attempt(h, s, e.id, w.scenarios.holdout, 'ASSESSMENT');
  a.advance(e.id);
  for (let i = 0; i < 2; i++) {
    const { workItem: shadow } = h.store.createWorkItem({ objective: 'shadow work', ownerRef: employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', instructions: 'shadow' } });
    a.assignShadowWork(s.founder, e.id, shadow.id);
    finish(h, shadow.id);
    if (i === 0) for (const kind of ['DEMONSTRATED_LEARNING', 'COST_DISCIPLINE', 'CORRECT_ESCALATION', 'COLLABORATION'] as const) a.recordProbationEvidence(s.founder, e.id, { kind, workItemId: shadow.id, positive: true });
    a.recordProbationEvidence(s.founder, e.id, { kind: 'QUALITY', workItemId: shadow.id, positive: true });
  }
  a.collectShadowEvidence(e.id);
  a.advance(e.id);
  if (decide) a.decideProbationReview(s.founder, e.id, 'PASS');
  return e.id;
}

/** Real shadow work for an enrollment at SHADOW_WORK: assigned, run, collected, with positive evaluator evidence. */
export function shadowCases(h: Harness, s: Seed, employee: EmployeeRecord, enrollmentId: Id, n: number): void {
  const a = AcademyStore.for(h.store);
  for (let i = 0; i < n; i++) {
    const { workItem: shadow } = h.store.createWorkItem({ objective: 'shadow work', ownerRef: employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', instructions: 'shadow' } });
    a.assignShadowWork(s.founder, enrollmentId, shadow.id);
    finish(h, shadow.id);
    if (i === 0) for (const kind of ['DEMONSTRATED_LEARNING', 'COST_DISCIPLINE', 'CORRECT_ESCALATION', 'COLLABORATION'] as const) a.recordProbationEvidence(s.founder, enrollmentId, { kind, workItemId: shadow.id, positive: true });
    a.recordProbationEvidence(s.founder, enrollmentId, { kind: 'QUALITY', workItemId: shadow.id, positive: true });
  }
  a.collectShadowEvidence(enrollmentId);
}
