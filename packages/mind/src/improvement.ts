/**
 * Learning closure rules (Stage 17 + Stage 5 learning validation, C6). Pure and deterministic.
 *
 *   INTENT → EXECUTE → OBSERVE → REFLECT → ATTRIBUTE → LEARN → VERIFY → GENERALIZE → CHALLENGE THE SYSTEM → GROW
 *
 * - Reflection is a hypothesis, not truth: an Employee's own observation becomes a lesson only with a
 *   validated, independent attribution behind it.
 * - Four learning outputs: MISTAKE_LESSON, SUCCESSFUL_PATTERN, NEAR_MISS_WARNING and SYSTEMIC_PROBLEM
 *   (the last is a finding about the company, not a lesson about one Employee).
 * - A successful pattern is candidate-first; it expands beyond its author only after verified reuse.
 * - Training completed is not learning proven: an intervention's effect is judged on LATER comparable
 *   evidence; the same mistake after repeated targeted retraining escalates to systemic analysis instead of
 *   another retraining cycle.
 * - Real failures become permanent regression / Gold cases only through cause analysis and review; hidden
 *   holdouts are never handed to a trainee as material.
 */
import { QandeelError } from '@qandeel-company/domain';

import type { AttributedCause, CauseCategory, DirectCause, WorkEvidence } from './evaluation.js';
import type { EvaluationFact, LearningEffect } from './performance.js';

export const LEARNING_KINDS = ['MISTAKE_LESSON', 'SUCCESSFUL_PATTERN', 'NEAR_MISS_WARNING', 'SYSTEMIC_PROBLEM'] as const;
export type LearningKind = (typeof LEARNING_KINDS)[number];

export const LEARNING_SOURCES = ['REFLECTION', 'ATTRIBUTION', 'REVIEW', 'GATE_CATCH', 'EVALUATION'] as const;
export type LearningSource = (typeof LEARNING_SOURCES)[number];

// ---------------------------------------------------------------------------------------------------------
// Reflection gate.

/**
 * May a classified observation become validated learning? Independent evidence decides, never the
 * Employee's own interpretation: a mistake lesson needs a VALIDATED attribution making the Employee
 * accountable; a successful pattern needs a qualified evaluation of its work; a reflected near miss needs a
 * validated attribution (a near miss recorded by a gate is its own evidence).
 */
export function learningValidationGate(input: {
  source: LearningSource;
  kind: LearningKind;
  attribution: { state: 'PROPOSED' | 'VALIDATED' | 'REJECTED'; employeeAccountable: boolean } | null;
  qualifiedEvaluation: boolean;
}): { allowed: boolean; reason: string } {
  const a = input.attribution;
  // A systemic problem is a finding about the company, never a lesson about one Employee.
  if (input.kind === 'SYSTEMIC_PROBLEM') return { allowed: false, reason: 'SYSTEMIC_PROBLEM_IS_A_FINDING' };
  if (input.kind === 'MISTAKE_LESSON') {
    if (a === null || a.state !== 'VALIDATED') return { allowed: false, reason: 'ATTRIBUTION_NOT_VALIDATED' };
    if (!a.employeeAccountable) return { allowed: false, reason: 'CAUSE_IS_NOT_THE_EMPLOYEE' };
    return { allowed: true, reason: 'VALIDATED_EMPLOYEE_CAUSE' };
  }
  if (input.kind === 'SUCCESSFUL_PATTERN') return input.qualifiedEvaluation ? { allowed: true, reason: 'QUALIFIED_EVALUATION' } : { allowed: false, reason: 'SUCCESS_NOT_QUALIFIED' };
  if (input.source === 'REFLECTION' && (a === null || a.state !== 'VALIDATED')) return { allowed: false, reason: 'REFLECTION_IS_A_HYPOTHESIS' };
  return { allowed: true, reason: 'EVIDENCE_BACKED' };
}

// ---------------------------------------------------------------------------------------------------------
// Detection: smart success, near miss.

export interface EvaluatedDimensions {
  readonly qualifiedOutcome: boolean;
  readonly verdicts: Readonly<Partial<Record<string, string>>>;
}

/** A smart success: qualified, cleanly reviewed, and either efficient or a proven different path. */
export function isSmartSuccess(e: EvaluatedDimensions): boolean {
  return e.qualifiedOutcome && e.verdicts.QUALITY === 'POSITIVE' && (e.verdicts.INITIATIVE === 'POSITIVE' || e.verdicts.EFFICIENCY === 'POSITIVE');
}

/**
 * Near misses: a harmful result avoided by a gate, a reviewer or a boundary. The final outcome is NOT
 * recast as a failure; the weakness underneath is what is worth learning.
 */
export function nearMissCodes(ev: WorkEvidence): string[] {
  const codes: string[] = [];
  if ((ev.review.fail > 0 || ev.review.rework > 0) && ev.outcome === 'ACHIEVED') codes.push('REVIEW_CAUGHT_BEFORE_RELEASE');
  if (ev.gateCatches > 0) codes.push('GATE_STOPPED_A_RISK');
  if (ev.authorityRefusals > 0) codes.push('AUTHORITY_BOUNDARY_HELD');
  return codes;
}

// ---------------------------------------------------------------------------------------------------------
// Successful pattern expansion.

/** Verified reuses (each an intervention whose effect was IMPROVEMENT_OBSERVED) required to share a pattern. */
export const MIN_VERIFIED_PATTERN_REUSES = 2;

export function patternExpansionAllowed(target: string, verifiedReuses: number): { allowed: boolean; reason: string } {
  if (target === 'PERSONAL') return { allowed: true, reason: 'PERSONAL_SCOPE' };
  if (verifiedReuses < MIN_VERIFIED_PATTERN_REUSES) return { allowed: false, reason: 'PATTERN_REUSE_NOT_VERIFIED' };
  return { allowed: true, reason: 'REUSE_VERIFIED' };
}

// ---------------------------------------------------------------------------------------------------------
// Learning effect verification.

export interface FollowupFact extends EvaluationFact {
  /** The validated cause categories of this follow-up (empty when nothing went wrong or not attributed). */
  readonly accountableCauses: readonly DirectCause[];
}

export interface EffectAssessment {
  readonly effect: LearningEffect;
  readonly basis: string;
  readonly followups: number;
  readonly recurrences: number;
  readonly evidenceRefs: readonly string[];
}

export const MIN_EFFECT_FOLLOWUPS = 2;

/**
 * Judges an intervention on comparable work AFTER the training finished. Recurrence = a follow-up where the
 * same cause category was validated as the Employee's. Baseline recurrence share comes from the evidence that
 * justified the lesson.
 */
export function assessLearningEffect(input: {
  trainingCompletedAt: string | null;
  targetCause: DirectCause;
  comparableKey: string;
  baseline: readonly FollowupFact[];
  followups: readonly FollowupFact[];
}): EffectAssessment {
  if (input.trainingCompletedAt === null) return { effect: 'NOT_YET_TESTED', basis: 'TRAINING_NOT_COMPLETED', followups: 0, recurrences: 0, evidenceRefs: [] };
  const completedAt = input.trainingCompletedAt;
  const later = input.followups.filter((f) => f.at > completedAt && f.comparableKey === input.comparableKey);
  const usable = later.filter((f) => f.evidenceState === 'SUFFICIENT_EVIDENCE');
  const refs = usable.map((f) => `evaluation:${f.evaluationId}`);
  if (later.length === 0) return { effect: 'NOT_YET_TESTED', basis: 'NO_COMPARABLE_WORK_YET', followups: 0, recurrences: 0, evidenceRefs: [] };
  if (usable.length < MIN_EFFECT_FOLLOWUPS) return { effect: later.length > usable.length ? 'INCONCLUSIVE' : 'NOT_YET_TESTED', basis: 'TOO_FEW_SUFFICIENT_FOLLOWUPS', followups: usable.length, recurrences: 0, evidenceRefs: refs };
  const recur = (f: FollowupFact): boolean => f.accountableCauses.includes(input.targetCause);
  const recurrences = usable.filter(recur).length;
  if (recurrences === 0) {
    const qualified = usable.filter((f) => f.qualifiedOutcome).length;
    return qualified >= MIN_EFFECT_FOLLOWUPS
      ? { effect: 'IMPROVEMENT_OBSERVED', basis: 'NO_RECURRENCE_ON_QUALIFIED_WORK', followups: usable.length, recurrences, evidenceRefs: refs }
      : { effect: 'INCONCLUSIVE', basis: 'NO_RECURRENCE_BUT_UNQUALIFIED', followups: usable.length, recurrences, evidenceRefs: refs };
  }
  const baseShare = input.baseline.length === 0 ? 1 : input.baseline.filter(recur).length / input.baseline.length;
  const laterShare = recurrences / usable.length;
  return { effect: laterShare > baseShare ? 'REGRESSION' : 'NO_IMPROVEMENT', basis: 'SAME_MISTAKE_RECURRED', followups: usable.length, recurrences, evidenceRefs: refs };
}

/** Retraining cycles that ended without an effect before the lesson escalates to the system (no infinite loop). */
export const MAX_INEFFECTIVE_RETRAINING_CYCLES = 2;

export type InterventionDecision = 'ALLOW_INTERVENTION' | 'AWAIT_EVIDENCE' | 'ESCALATE_SYSTEMIC';

/** Decides whether another targeted retraining may start for a lesson, given the prior cycles' effects. */
export function nextInterventionDecision(prior: readonly LearningEffect[]): { decision: InterventionDecision; reason: string } {
  if (prior.some((e) => e === 'NOT_YET_TESTED')) return { decision: 'AWAIT_EVIDENCE', reason: 'PRIOR_INTERVENTION_UNTESTED' };
  const ineffective = prior.filter((e) => e === 'NO_IMPROVEMENT' || e === 'REGRESSION').length;
  if (ineffective >= MAX_INEFFECTIVE_RETRAINING_CYCLES) return { decision: 'ESCALATE_SYSTEMIC', reason: 'RETRAINING_EXHAUSTED' };
  return { decision: 'ALLOW_INTERVENTION', reason: 'WITHIN_BOUND' };
}

// ---------------------------------------------------------------------------------------------------------
// Systemic problem detection (double-loop learning).

export const SYSTEMIC_TARGETS = ['WORKFLOW', 'SKILL', 'TOOL', 'CONTEXT', 'MODEL_ROUTE', 'EVALUATOR', 'REQUIREMENT', 'POLICY_ASSUMPTION', 'ROLE_DESIGN', 'GOAL_DEFINITION', 'EXTERNAL_DEPENDENCY'] as const;
export type SystemicTarget = (typeof SYSTEMIC_TARGETS)[number];

const TARGET_FOR: Record<DirectCause, SystemicTarget> = {
  EMPLOYEE_JUDGMENT: 'WORKFLOW',
  MODEL: 'MODEL_ROUTE',
  PROVIDER: 'MODEL_ROUTE',
  TOOL: 'TOOL',
  CONTEXT_RETRIEVAL: 'CONTEXT',
  WORKFLOW_PROCESS: 'WORKFLOW',
  REQUIREMENT: 'REQUIREMENT',
  EXTERNAL_DEPENDENCY: 'EXTERNAL_DEPENDENCY',
};

export interface ValidatedAttributionFact {
  readonly attributionId: string;
  readonly workItemId: string;
  readonly employeeId: string | null;
  readonly comparableKey: string;
  readonly overall: CauseCategory;
  readonly causes: readonly AttributedCause[];
}

export interface SystemicCandidate {
  readonly targetKind: SystemicTarget;
  readonly targetRef: string;
  readonly cause: DirectCause;
  readonly occurrences: number;
  readonly distinctEmployees: number;
  readonly evidenceRefs: readonly string[];
}

export const SYSTEMIC_POLICY = Object.freeze({ minOccurrences: 3, minDistinctEmployees: 2 });

/**
 * Repeated validated causes on the same comparable work become a systemic candidate. A non-employee cause
 * repeating is about the system by definition; repeated EMPLOYEE_JUDGMENT failures by several different
 * Employees on the same work suggests the workflow (not only each person) is wrong.
 */
export function detectSystemicCandidates(facts: readonly ValidatedAttributionFact[], policy = SYSTEMIC_POLICY): SystemicCandidate[] {
  const groups = new Map<string, { cause: DirectCause; key: string; items: ValidatedAttributionFact[] }>();
  for (const f of facts) {
    for (const c of f.causes) {
      if (c.role !== 'PRIMARY') continue;
      const k = `${c.category}|${f.comparableKey}`;
      const g = groups.get(k) ?? { cause: c.category, key: f.comparableKey, items: [] };
      g.items.push(f);
      groups.set(k, g);
    }
  }
  const out: SystemicCandidate[] = [];
  for (const g of [...groups.values()].sort((a, b) => (`${a.cause}|${a.key}` < `${b.cause}|${b.key}` ? -1 : 1))) {
    const employees = new Set(g.items.map((i) => i.employeeId).filter((e): e is string => e !== null));
    const enough = g.items.length >= policy.minOccurrences && (g.cause !== 'EMPLOYEE_JUDGMENT' || employees.size >= policy.minDistinctEmployees);
    if (!enough) continue;
    out.push({ targetKind: TARGET_FOR[g.cause], targetRef: g.key, cause: g.cause, occurrences: g.items.length, distinctEmployees: employees.size, evidenceRefs: g.items.map((i) => `causal_attribution:${i.attributionId}`) });
  }
  return out;
}

/**
 * An observation classified SYSTEMIC_PROBLEM becomes a systemic candidate only on independent evidence: a
 * VALIDATED attribution of its work whose PRIMARY cause is the system (tool, model, context, workflow,
 * provider, requirement, external dependency). An Employee's own judgement is a lesson, not a system problem.
 */
export function reportedSystemicCandidate(input: { signalId: string; observationId: string; attribution: ValidatedAttributionFact | null }): SystemicCandidate {
  const a = input.attribution;
  if (a === null) throw new QandeelError('LEARNING_GATE', 'a reported systemic problem needs a validated attribution of its work', { reason: 'ATTRIBUTION_NOT_VALIDATED' });
  const primary = a.causes.find((c) => c.role === 'PRIMARY');
  if (!primary) throw new QandeelError('LEARNING_GATE', 'the validated attribution names no primary cause', { reason: 'NO_PRIMARY_CAUSE' });
  if (primary.category === 'EMPLOYEE_JUDGMENT') throw new QandeelError('LEARNING_GATE', 'the validated cause is the Employee, not the system', { reason: 'CAUSE_IS_THE_EMPLOYEE' });
  return {
    targetKind: TARGET_FOR[primary.category],
    targetRef: a.comparableKey,
    cause: primary.category,
    occurrences: 1,
    distinctEmployees: a.employeeId === null ? 0 : 1,
    evidenceRefs: [`learning_signal:${input.signalId}`, `lesson:${input.observationId}`, `causal_attribution:${a.attributionId}`],
  };
}

/**
 * Who contributed a reported systemic finding: the Employee who authored the observation, and only when it is
 * their own REFLECTION. An evaluator-, gate- or reviewer-derived observation names no contributor — the subject
 * of a record is never credited as its author. Provenance is credit, never authority.
 */
export function systemicContributor(input: { source: LearningSource; observationEmployeeId: string }): string | null {
  return input.source === 'REFLECTION' ? input.observationEmployeeId : null;
}

// ---------------------------------------------------------------------------------------------------------
// Failure → regression / Gold case lifecycle; hidden holdouts.

export const CASE_STAGES = ['REAL_FAILURE', 'CAUSE_ANALYSIS', 'VALID_FAILURE_CASE', 'REGRESSION_CANDIDATE', 'REGRESSION_CASE', 'GOLD_CASE', 'REJECTED'] as const;
export type CaseStage = (typeof CASE_STAGES)[number];

export const CASE_NEXT: Readonly<Record<CaseStage, readonly CaseStage[]>> = {
  REAL_FAILURE: ['CAUSE_ANALYSIS', 'REJECTED'],
  CAUSE_ANALYSIS: ['VALID_FAILURE_CASE', 'REJECTED'],
  VALID_FAILURE_CASE: ['REGRESSION_CANDIDATE', 'REJECTED'],
  REGRESSION_CANDIDATE: ['REGRESSION_CASE', 'GOLD_CASE', 'REJECTED'],
  REGRESSION_CASE: [],
  GOLD_CASE: [],
  REJECTED: [],
};

export function assertCaseStep(from: CaseStage, to: CaseStage): void {
  if (!CASE_NEXT[from].includes(to)) throw new QandeelError('INVALID_TRANSITION', `${from} -> ${to} is not a failure-case step`, { from, to });
}

export interface CaseMaterial {
  readonly caseId: string;
  readonly stage: CaseStage;
  readonly hidden: boolean;
}

/** Retraining material for a trainee: permanent regression cases only; hidden (holdout / Gold) cases never. */
export function retrainingMaterial(cases: readonly CaseMaterial[]): string[] {
  return cases.filter((c) => c.stage === 'REGRESSION_CASE' && !c.hidden).map((c) => c.caseId);
}
