/**
 * QANDEEL Academy & Certification rules (Stage 6). Pure and deterministic.
 *
 * - The learning path is durable and ordered; failures are kept, never overwritten.
 * - Assessment dimensions are independent; CRITICAL dimensions gate structurally: a high average
 *   can never compensate for one critical failure.
 * - Final certification needs holdout scenarios the trainee has never been exposed to.
 * - Certification is role-specific, version-bound, time-aware and revocable. It is necessary for
 *   Active Duty but not sufficient: activation also needs a Probation Review and an Activation
 *   Approval, whose authority (authenticated Founder / organization) does not exist yet.
 *
 * Scores are internal integer percentages used for deterministic gating only; they are not a
 * canonical Product scoring contract.
 */
import { QandeelError, type Timestamp } from '@qandeel-company/domain';

import { assertProficiency, type Proficiency } from './skills.js';

export const CURRICULUM_CATEGORIES = ['QANDEEL_FUNDAMENTALS', 'FOUNDER_UNDERSTANDING', 'ROLE_MASTERY', 'REAL_CASE_STUDIES', 'MARKET_INTELLIGENCE', 'COMPANY_OPERATING_SKILLS'] as const;
export type CurriculumCategory = (typeof CURRICULUM_CATEGORIES)[number];

export const LEARNING_STAGES = ['LEARN', 'CASE_STUDIES', 'SIMULATION', 'FEEDBACK', 'RETRY', 'ASSESSMENT', 'SHADOW_WORK', 'PROBATION_REVIEW', 'CERTIFICATION', 'ACTIVATION_APPROVAL', 'ACTIVATED', 'BLOCKED', 'WITHDRAWN'] as const;
export type LearningStage = (typeof LEARNING_STAGES)[number];

/** Stage 6 §2 path. RETRY loops back to SIMULATION; a failed assessment returns to RETRY (retraining). */
export const STAGE_NEXT: Readonly<Record<LearningStage, readonly LearningStage[]>> = {
  LEARN: ['CASE_STUDIES', 'WITHDRAWN'],
  CASE_STUDIES: ['SIMULATION', 'WITHDRAWN'],
  SIMULATION: ['FEEDBACK', 'WITHDRAWN'],
  FEEDBACK: ['RETRY', 'ASSESSMENT', 'WITHDRAWN'],
  // After retraining for a failed probation, new shadow work (a new evidence epoch) — not a re-assessment.
  RETRY: ['SIMULATION', 'ASSESSMENT', 'SHADOW_WORK', 'WITHDRAWN'],
  ASSESSMENT: ['SHADOW_WORK', 'RETRY', 'BLOCKED', 'WITHDRAWN'],
  SHADOW_WORK: ['PROBATION_REVIEW', 'WITHDRAWN'],
  PROBATION_REVIEW: ['CERTIFICATION', 'SHADOW_WORK', 'RETRY', 'WITHDRAWN'],
  CERTIFICATION: ['ACTIVATION_APPROVAL', 'WITHDRAWN'],
  ACTIVATION_APPROVAL: ['ACTIVATED', 'WITHDRAWN'],
  ACTIVATED: [],
  BLOCKED: [],
  WITHDRAWN: [],
};

export function assertStageStep(from: LearningStage, to: LearningStage): void {
  if (!STAGE_NEXT[from].includes(to)) throw new QandeelError('INVALID_TRANSITION', `${from} -> ${to} is not an Academy learning-path step`, { from, to });
}

export const ASSESSMENT_DIMENSIONS = ['REASONING_QUALITY', 'CORRECTNESS', 'EVIDENCE_USE', 'QANDEEL_UNDERSTANDING', 'ROLE_MASTERY', 'AUTHORITY_COMPLIANCE', 'COST_DISCIPLINE', 'COLLABORATION', 'FOUNDER_COMMUNICATION', 'LEARNING_FROM_FEEDBACK'] as const;
export type AssessmentDimension = (typeof ASSESSMENT_DIMENSIONS)[number];

/** Stage 6 §6 critical examples: authority / safety, truth / evidence, serious cost discipline, required role competence. */
export const DEFAULT_CRITICAL_DIMENSIONS: readonly AssessmentDimension[] = ['AUTHORITY_COMPLIANCE', 'EVIDENCE_USE', 'COST_DISCIPLINE', 'ROLE_MASTERY'];

/** Dimensions the runtime can evaluate deterministically from durable run facts (audit, usage). */
export const DETERMINISTIC_DIMENSIONS: readonly AssessmentDimension[] = ['AUTHORITY_COMPLIANCE', 'COST_DISCIPLINE'];

export interface DimensionRule {
  readonly dimension: AssessmentDimension;
  readonly critical: boolean;
  readonly passPct: number;
}

export interface ProbationCriteria {
  readonly minCases: number;
  readonly maxCriticalFailures: number;
  readonly requireDemonstratedLearning: boolean;
  readonly requireCostDiscipline: boolean;
  readonly requireCorrectEscalation: boolean;
  readonly requireCollaboration: boolean;
}

export interface CurriculumModule {
  readonly code: string;
  readonly category: CurriculumCategory;
  /** Approved source references (knowledge / canonical / artifact / authority refs) — never invented content. */
  readonly sourceRefs: readonly string[];
}

export interface ProgramDefinition {
  readonly curriculum: readonly CurriculumModule[];
  readonly dimensions: readonly DimensionRule[];
  readonly passAveragePct: number;
  readonly assessmentTrials: number;
  readonly holdoutRequired: boolean;
  readonly founderCalibrationRequired: boolean;
  /** Critical failures of the same dimension (after retraining) that block certification. */
  readonly maxRepeatedCriticalFailures: number;
  readonly certificationValidityDays: number;
  readonly probation: ProbationCriteria;
  /** Skills a passed certification qualifies, with the proficiency it establishes. */
  readonly skillTargets: readonly { readonly skillId: string; readonly proficiency: Proficiency }[];
}

const MODULE_CODE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,7}$/;
const SOURCE_REF = /^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._:/#-]{1,160}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function assertProgramDefinition(v: unknown): ProgramDefinition {
  const bad = (field: string, why: string): never => {
    throw new QandeelError('VALIDATION_FAILED', `program ${field} ${why}`, { field });
  };
  const o = v as Partial<ProgramDefinition> | null;
  if (typeof o !== 'object' || o === null) bad('', 'must be an object');
  const p = o as Partial<ProgramDefinition>;
  if (!Array.isArray(p.curriculum) || p.curriculum.length === 0 || p.curriculum.length > 64) bad('curriculum', 'must list 1..64 modules');
  const curriculum = (p.curriculum as CurriculumModule[]).map((m, i) => {
    if (typeof m?.code !== 'string' || !MODULE_CODE.test(m.code)) bad(`curriculum[${i}].code`, 'must be a short code');
    if (!(CURRICULUM_CATEGORIES as readonly unknown[]).includes(m.category)) bad(`curriculum[${i}].category`, 'is unknown');
    if (!Array.isArray(m.sourceRefs) || m.sourceRefs.length === 0 || m.sourceRefs.length > 16 || m.sourceRefs.some((r) => typeof r !== 'string' || !SOURCE_REF.test(r))) bad(`curriculum[${i}].sourceRefs`, 'must reference 1..16 approved sources');
    return { code: m.code, category: m.category, sourceRefs: [...m.sourceRefs] };
  });
  for (const c of CURRICULUM_CATEGORIES) if (!curriculum.some((m) => m.category === c)) bad('curriculum', `must cover ${c} (Stage 6 §4 core curriculum)`);
  if (!Array.isArray(p.dimensions)) bad('dimensions', 'must list the assessment dimensions');
  const dims = p.dimensions as DimensionRule[];
  for (const d of ASSESSMENT_DIMENSIONS) if (dims.filter((x) => x?.dimension === d).length !== 1) bad('dimensions', `must define ${d} exactly once`);
  if (dims.length !== ASSESSMENT_DIMENSIONS.length) bad('dimensions', 'must define each dimension once');
  const dimensions = dims.map((d) => {
    if (typeof d.critical !== 'boolean' || !Number.isInteger(d.passPct) || d.passPct < 1 || d.passPct > 100) bad(`dimensions.${d.dimension}`, 'needs critical flag and passPct 1..100');
    return { dimension: d.dimension, critical: d.critical, passPct: d.passPct };
  });
  for (const d of DEFAULT_CRITICAL_DIMENSIONS) if (!dimensions.find((x) => x.dimension === d)?.critical) bad(`dimensions.${d}`, 'is a critical dimension (Stage 6 §6) and cannot be made non-critical');
  const int = (n: unknown, field: string, min: number, max: number): number => (Number.isInteger(n) && (n as number) >= min && (n as number) <= max ? (n as number) : bad(field, `must be ${min}..${max}`));
  const pr = p.probation as Partial<ProbationCriteria> | undefined;
  if (typeof pr !== 'object' || pr === null) bad('probation', 'criteria are required (evidence-based probation)');
  const probation: ProbationCriteria = {
    minCases: int(pr?.minCases, 'probation.minCases', 1, 1000),
    maxCriticalFailures: int(pr?.maxCriticalFailures, 'probation.maxCriticalFailures', 0, 100),
    requireDemonstratedLearning: pr?.requireDemonstratedLearning !== false,
    requireCostDiscipline: pr?.requireCostDiscipline !== false,
    requireCorrectEscalation: pr?.requireCorrectEscalation !== false,
    requireCollaboration: pr?.requireCollaboration !== false,
  };
  if (!Array.isArray(p.skillTargets) || p.skillTargets.length > 64) bad('skillTargets', 'must be a list');
  const skillTargets = (p.skillTargets as { skillId: string; proficiency: Proficiency }[]).map((t, i) => {
    if (typeof t?.skillId !== 'string' || !ID.test(t.skillId)) bad(`skillTargets[${i}].skillId`, 'must be a skill id');
    return { skillId: t.skillId, proficiency: assertProficiency(t.proficiency, `skillTargets[${i}].proficiency`) };
  });
  return {
    curriculum,
    dimensions,
    passAveragePct: int(p.passAveragePct, 'passAveragePct', 1, 100),
    assessmentTrials: int(p.assessmentTrials, 'assessmentTrials', 1, 10),
    holdoutRequired: p.holdoutRequired !== false,
    founderCalibrationRequired: p.founderCalibrationRequired === true,
    maxRepeatedCriticalFailures: int(p.maxRepeatedCriticalFailures, 'maxRepeatedCriticalFailures', 1, 10),
    certificationValidityDays: int(p.certificationValidityDays, 'certificationValidityDays', 1, 3650),
    probation,
    skillTargets,
  };
}

export interface DimensionResult {
  readonly dimension: AssessmentDimension;
  readonly scorePct: number;
}

export interface AttemptEvaluation {
  readonly outcome: 'PASS' | 'FAIL' | 'INCOMPLETE';
  readonly averagePct: number;
  readonly failedDimensions: readonly AssessmentDimension[];
  readonly criticalFailures: readonly AssessmentDimension[];
  readonly missingDimensions: readonly AssessmentDimension[];
}

/**
 * Evaluates one attempt. Every dimension must be recorded; a critical dimension below its pass mark
 * FAILS the attempt whatever the average (Stage 6 §6); otherwise the average must reach the program mark.
 */
export function evaluateAttempt(def: Pick<ProgramDefinition, 'dimensions' | 'passAveragePct'>, results: readonly DimensionResult[]): AttemptEvaluation {
  const missingDimensions = def.dimensions.map((d) => d.dimension).filter((d) => !results.some((r) => r.dimension === d));
  const failedDimensions: AssessmentDimension[] = [];
  const criticalFailures: AssessmentDimension[] = [];
  let sum = 0;
  for (const rule of def.dimensions) {
    const r = results.find((x) => x.dimension === rule.dimension);
    if (!r) continue;
    sum += r.scorePct;
    if (r.scorePct < rule.passPct) {
      failedDimensions.push(rule.dimension);
      if (rule.critical) criticalFailures.push(rule.dimension);
    }
  }
  const recorded = def.dimensions.length - missingDimensions.length;
  const averagePct = recorded === 0 ? 0 : Math.floor(sum / recorded);
  // A critical failure is final for this attempt even before the rest is recorded.
  const outcome = criticalFailures.length > 0 ? 'FAIL' : missingDimensions.length > 0 ? 'INCOMPLETE' : averagePct >= def.passAveragePct ? 'PASS' : 'FAIL';
  return { outcome, averagePct, failedDimensions, criticalFailures, missingDimensions };
}

/** Failure → Diagnosis → Targeted Retraining: which curriculum categories retrain which failed dimension. */
export const RETRAINING_FOR: Readonly<Record<AssessmentDimension, readonly CurriculumCategory[]>> = {
  REASONING_QUALITY: ['ROLE_MASTERY', 'REAL_CASE_STUDIES'],
  CORRECTNESS: ['ROLE_MASTERY'],
  EVIDENCE_USE: ['COMPANY_OPERATING_SKILLS', 'REAL_CASE_STUDIES'],
  QANDEEL_UNDERSTANDING: ['QANDEEL_FUNDAMENTALS'],
  ROLE_MASTERY: ['ROLE_MASTERY'],
  AUTHORITY_COMPLIANCE: ['COMPANY_OPERATING_SKILLS'],
  COST_DISCIPLINE: ['COMPANY_OPERATING_SKILLS'],
  COLLABORATION: ['COMPANY_OPERATING_SKILLS'],
  FOUNDER_COMMUNICATION: ['FOUNDER_UNDERSTANDING'],
  LEARNING_FROM_FEEDBACK: ['FOUNDER_UNDERSTANDING', 'COMPANY_OPERATING_SKILLS'],
};

export function diagnose(failed: readonly AssessmentDimension[], curriculum: readonly CurriculumModule[]): { readonly categories: readonly CurriculumCategory[]; readonly modules: readonly string[] } {
  const categories = [...new Set(failed.flatMap((d) => RETRAINING_FOR[d]))].sort();
  return { categories, modules: curriculum.filter((m) => categories.includes(m.category)).map((m) => m.code) };
}

/** Critical dimensions failed in at least `limit` assessment attempts: certification is blocked (Stage 6 §9). */
export function repeatedCriticalFailures(history: readonly (readonly AssessmentDimension[])[], limit: number): AssessmentDimension[] {
  const counts = new Map<AssessmentDimension, number>();
  for (const attempt of history) for (const d of new Set(attempt)) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= limit).map(([d]) => d).sort();
}

export const PROBATION_EVIDENCE_KINDS = ['CASE', 'CRITICAL_FAILURE', 'DEMONSTRATED_LEARNING', 'COST_DISCIPLINE', 'CORRECT_ESCALATION', 'COLLABORATION', 'QUALITY'] as const;
export type ProbationEvidenceKind = (typeof PROBATION_EVIDENCE_KINDS)[number];

export interface ProbationSummary {
  readonly cases: number;
  readonly stableQualityCases: number;
  readonly criticalFailures: number;
  readonly demonstratedLearning: number;
  readonly costDiscipline: number;
  readonly correctEscalation: number;
  readonly collaboration: number;
}

/** Probation review is evidence-based (Stage 6 §12), never only time-based. */
/** Retraining categories for unmet probation criteria (Stage 6 §9 / §12: failure → diagnosis → retraining). */
const PROBATION_RETRAINING: Readonly<Record<string, readonly CurriculumCategory[]>> = {
  MIN_CASES: ['ROLE_MASTERY'],
  STABLE_QUALITY: ['ROLE_MASTERY', 'REAL_CASE_STUDIES'],
  CRITICAL_FAILURES: ['COMPANY_OPERATING_SKILLS'],
  DEMONSTRATED_LEARNING: ['REAL_CASE_STUDIES'],
  COST_DISCIPLINE: ['COMPANY_OPERATING_SKILLS'],
  CORRECT_ESCALATION: ['COMPANY_OPERATING_SKILLS', 'FOUNDER_UNDERSTANDING'],
  COLLABORATION: ['COMPANY_OPERATING_SKILLS'],
};

export function diagnoseProbation(unmet: readonly string[], curriculum: readonly CurriculumModule[]): { readonly categories: readonly CurriculumCategory[]; readonly modules: readonly string[] } {
  const fallback: readonly CurriculumCategory[] = ['ROLE_MASTERY'];
  const categories = [...new Set((unmet.length > 0 ? unmet : ['STABLE_QUALITY']).flatMap((u): readonly CurriculumCategory[] => PROBATION_RETRAINING[u] ?? fallback))].sort();
  return { categories, modules: curriculum.filter((m) => categories.includes(m.category)).map((m) => m.code) };
}

export function evaluateProbation(c: ProbationCriteria, s: ProbationSummary): { readonly met: boolean; readonly unmet: readonly string[] } {
  const unmet: string[] = [];
  if (s.cases < c.minCases) unmet.push('MIN_CASES');
  if (s.stableQualityCases < c.minCases) unmet.push('STABLE_QUALITY');
  if (s.criticalFailures > c.maxCriticalFailures) unmet.push('CRITICAL_FAILURES');
  if (c.requireDemonstratedLearning && s.demonstratedLearning < 1) unmet.push('DEMONSTRATED_LEARNING');
  if (c.requireCostDiscipline && s.costDiscipline < 1) unmet.push('COST_DISCIPLINE');
  if (c.requireCorrectEscalation && s.correctEscalation < 1) unmet.push('CORRECT_ESCALATION');
  if (c.requireCollaboration && s.collaboration < 1) unmet.push('COLLABORATION');
  return { met: unmet.length === 0, unmet };
}

export interface CertificationInputs {
  readonly passedAssessments: number;
  readonly passedCleanHoldouts: number;
  readonly probationReviewPassed: boolean;
  readonly calibrationApproved: boolean;
  readonly blocked: boolean;
}

/** What the evidence still lacks for certification (empty = certifiable). */
export function certificationGaps(def: Pick<ProgramDefinition, 'assessmentTrials' | 'holdoutRequired' | 'founderCalibrationRequired'>, i: CertificationInputs): string[] {
  const gaps: string[] = [];
  if (i.blocked) gaps.push('BLOCKED_REPEATED_CRITICAL_FAILURE');
  if (i.passedAssessments < def.assessmentTrials) gaps.push('ASSESSMENT_TRIALS');
  if (def.holdoutRequired && i.passedCleanHoldouts < 1) gaps.push('HOLDOUT_PASS');
  if (!i.probationReviewPassed) gaps.push('PROBATION_REVIEW');
  if (def.founderCalibrationRequired && !i.calibrationApproved) gaps.push('FOUNDER_CALIBRATION');
  return gaps;
}

export const CERTIFICATION_STATUSES = ['VALID', 'REVIEW_DUE', 'EXPIRED', 'REVOKED', 'SUPERSEDED'] as const;
export type CertificationStatus = (typeof CERTIFICATION_STATUSES)[number];

/** Status of a certification at `now` (time-aware: an unexpired VALID certificate past its date reads EXPIRED). */
export function certificationStatusAt(c: { readonly status: CertificationStatus; readonly validUntil: Timestamp | null }, now: Timestamp): CertificationStatus {
  if (c.status === 'VALID' && c.validUntil !== null && c.validUntil <= now) return 'EXPIRED';
  return c.status;
}

export const SCENARIO_KINDS = ['PRACTICE', 'ASSESSMENT', 'HOLDOUT'] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];
export const ATTEMPT_KINDS = ['SIMULATION', 'ASSESSMENT'] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

/** Which scenarios an attempt kind may use: holdouts are for assessment only, never practice. */
export function scenarioAllowed(attempt: AttemptKind, scenario: ScenarioKind): boolean {
  return attempt === 'SIMULATION' ? scenario === 'PRACTICE' : scenario === 'ASSESSMENT' || scenario === 'HOLDOUT';
}

/** Stages at which a non-ACTIVE Employee may run constrained Academy work (Stage 6 §11: shadow on real work under constrained authority). */
export const ACADEMY_EXECUTION_STAGES: readonly LearningStage[] = ['SIMULATION', 'FEEDBACK', 'RETRY', 'ASSESSMENT', 'SHADOW_WORK', 'PROBATION_REVIEW'];
