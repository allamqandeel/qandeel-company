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
import { adverseStanding, type AdverseStanding, type AttributionState, type EvaluationFact, type LearningEffect } from './performance.js';
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

/**
 * R2-16: how many verified reuses stand on pairwise-DISJOINT evidence (each reuse's evidence = the follow-up Work
 * Items it was judged on). The same work never counts twice; a reuse with no evidence counts for nothing.
 */
export function disjointVerifiedReuses(reuses: readonly (readonly string[])[]): number {
  const usable = reuses.filter((r) => r.length > 0);
  let best = 0;
  for (let i = 0; i < usable.length; i++) {
    const taken = new Set(usable[i]);
    let n = 1;
    for (let k = 0; k < usable.length; k++) {
      const other = usable[k] ?? [];
      if (k === i || other.some((x) => taken.has(x))) continue;
      for (const x of other) taken.add(x);
      n++;
    }
    best = Math.max(best, n);
  }
  return best;
}

export function patternExpansionAllowed(target: string, verifiedReuses: number): { allowed: boolean; reason: string } {
  if (target === 'PERSONAL') return { allowed: true, reason: 'PERSONAL_SCOPE' };
  if (verifiedReuses < MIN_VERIFIED_PATTERN_REUSES) return { allowed: false, reason: 'PATTERN_REUSE_NOT_VERIFIED' };
  return { allowed: true, reason: 'REUSE_VERIFIED' };
}

// ---------------------------------------------------------------------------------------------------------
// Learning effect verification.

/**
 * FB-1 — the canonical sources of adverse learning evidence. Each is one durable row with its own identity:
 * - REVIEW_DECISION: a counting REQUIRED review decision that FAILED an output or an action;
 * - RUN_FAILURE: a run that failed without the work getting past it (R2-13), or an authority-boundary refusal;
 * - OUTCOME_VERIFICATION: the decisive NOT_ACHIEVED verification of the work's outcome.
 */
export const ADVERSE_SOURCE_KINDS = ['REVIEW_DECISION', 'RUN_FAILURE', 'OUTCOME_VERIFICATION'] as const;
export type AdverseSourceKind = (typeof ADVERSE_SOURCE_KINDS)[number];

/**
 * FB-1: one adverse source event with its durable provenance (ids, kinds, times only — never content). Its time is the
 * time of the Employee's ACT the event judges, never the time anyone judged, evaluated or attributed it:
 * - a failed review: the run that produced the reviewed output (an action review: the moment the action was requested);
 * - a failed run: that run;
 * - a NOT_ACHIEVED outcome: the run that produced the verified output.
 * `actStartedAt` / `actEndedAt` bound the act (null = unknown). The attribution fields describe the ONE attribution
 * that explains this event (the one whose evidence held it; a Founder-corrected attribution keeps its proposal's
 * evidence, so its events keep their original times) — never the Work Item's latest attribution.
 */
export interface AdverseSourceEvent {
  /** Durable source identity (`review_decision:<id>`, `run:<id>`, `outcome_verification:<id>`): one event, counted once. */
  readonly sourceRef: string;
  readonly kind: AdverseSourceKind;
  readonly actStartedAt: string | null;
  readonly actEndedAt: string | null;
  /** The explaining attribution (`causal_attribution:<id>`), or null when none explains this event. */
  readonly attributionRef: string | null;
  /** Its state (NONE when no attribution explains the event). */
  readonly attributionState: AttributionState;
  /** Whether an attribution is due for this event (read with `attributionState` through `adverseStanding`). */
  readonly attributionDue: boolean;
  /** The validated PRIMARY causes making the Employee accountable for this event (empty otherwise). */
  readonly accountableCauses: readonly DirectCause[];
  /** The durable record cannot tell which attribution explains this event (never read as clean, never final). */
  readonly attributionUnresolved: boolean;
}

export interface FollowupFact extends EvaluationFact {
  /** When the follow-up WORK started (first run, else creation) — positive evidence needs work started after training. */
  readonly workStartedAt: string;
  /** The state of the Work Item's causal attribution (the latest decided or live one) — the baseline share reads it. */
  readonly attributionState: AttributionState;
  /** The Work Item's validated accountable cause categories — the baseline share reads it. */
  readonly accountableCauses: readonly DirectCause[];
  /** FB-1: every adverse source event of this Work Item with its own provenance — the effect is judged on these. */
  readonly adverseEvents: readonly AdverseSourceEvent[];
}

/** An adverse follow-up: its outcome or its quality was judged negative. */
const adverseFollowup = (f: FollowupFact): boolean => f.verdicts.OUTCOME === 'NEGATIVE' || f.verdicts.QUALITY === 'NEGATIVE';

/** An adverse source event read through the ONE definition (`adverseStanding`). */
const eventStanding = (e: AdverseSourceEvent): AdverseStanding =>
  adverseStanding({ attributionDue: e.attributionDue, state: e.attributionState, employeeAccountable: e.accountableCauses.length > 0 });

export type EventPhase = 'BEFORE_TRAINING' | 'AFTER_TRAINING' | 'UNPLACEABLE';

/**
 * FB-1: when an adverse act happened relative to the training. Before: the act ended at or before the training
 * completed. After: the act started strictly after it. Anything else (an act spanning the boundary, an unknown
 * time) cannot be placed — it is never read as either side.
 */
export function eventPhase(e: Pick<AdverseSourceEvent, 'actStartedAt' | 'actEndedAt'>, trainingCompletedAt: string): EventPhase {
  if (e.actEndedAt !== null && e.actEndedAt <= trainingCompletedAt) return 'BEFORE_TRAINING';
  if (e.actStartedAt !== null && e.actStartedAt > trainingCompletedAt) return 'AFTER_TRAINING';
  return 'UNPLACEABLE';
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
 * Judges an intervention on comparable work after the training finished. FB-1: learning is timed by the event that
 * happened, not the date someone judged it — adverse evidence is the SOURCE EVENT (a failed review, an unrecovered or
 * boundary run failure, a NOT_ACHIEVED outcome) placed by the time of the Employee's act (`eventPhase`), never by the
 * Work Item's final state, its evaluation, or its attribution's decision.
 * - Positive evidence is only work STARTED after the training that became a qualified outcome (R2-15): finishing
 *   older work after it earns no credit.
 * - A recurrence is an adverse source event whose act happened strictly AFTER the training, explained by a validated
 *   attribution making the Employee accountable for the target cause. A pre-training event stays pre-training however
 *   late it is reviewed, evaluated, attributed or corrected.
 * - Work started before the training counts only through its post-training (or unplaceable) adverse events: earlier
 *   mistakes finished correctly afterwards are neither positive nor negative.
 * - One source event is counted once (dedupe by source identity); the unit of the recurrence share is the Work Item.
 * - Every event is read through `adverseStanding` (the one definition): PENDING keeps the effect open (R2-17);
 *   REJECTED (no accountable cause established) or NOT_ATTRIBUTABLE makes it INCONCLUSIVE — recorded, non-final.
 * - An event that cannot be placed in time, or whose attribution cannot be resolved, and adverse work with no event
 *   provenance never produce a final NO_IMPROVEMENT / REGRESSION they could change (INCONCLUSIVE instead).
 * Baseline recurrence share comes from the evidence that justified the lesson. Evidence references name the
 * considered Work Items, then the source events counted as recurrences.
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
  const byWork = new Map<string, FollowupFact>();
  for (const f of input.followups) if (f.comparableKey === input.comparableKey) byWork.set(f.workItemId, f);
  const comparable = [...byWork.values()];
  const later = comparable.filter((f) => f.workStartedAt > completedAt);
  const usable = later.filter((f) => f.evidenceState === 'SUFFICIENT_EVIDENCE');
  const earlier = comparable.filter((f) => f.workStartedAt <= completedAt && f.evidenceState === 'SUFFICIENT_EVIDENCE');
  // Every adverse source event once (by its durable identity), unless its act happened before the training.
  const seen = new Set<string>();
  const events: { workItemId: string; e: AdverseSourceEvent; phase: EventPhase }[] = [];
  for (const f of [...usable, ...earlier]) {
    for (const e of f.adverseEvents) {
      if (seen.has(e.sourceRef)) continue;
      seen.add(e.sourceRef);
      const phase = eventPhase(e, completedAt);
      if (phase !== 'BEFORE_TRAINING') events.push({ workItemId: f.workItemId, e, phase });
    }
  }
  // Adverse work whose events carry no provenance at all cannot be placed.
  const unplaced = new Set([...usable, ...earlier].filter((f) => adverseFollowup(f) && f.adverseEvents.length === 0).map((f) => f.workItemId));
  const touched = new Set([...events.map((x) => x.workItemId), ...unplaced]);
  const spanning = earlier.filter((f) => touched.has(f.workItemId));
  const considered = [...usable, ...spanning];
  const workRefs = considered.map((f) => `work_item:${f.workItemId}`);
  if (later.length === 0 && spanning.length === 0) return { effect: 'NOT_YET_TESTED', basis: 'NO_COMPARABLE_WORK_YET', followups: 0, recurrences: 0, evidenceRefs: [] };
  if (considered.length < MIN_EFFECT_FOLLOWUPS) return { effect: later.length > usable.length ? 'INCONCLUSIVE' : 'NOT_YET_TESTED', basis: 'TOO_FEW_SUFFICIENT_FOLLOWUPS', followups: considered.length, recurrences: 0, evidenceRefs: workRefs };
  if (events.some((x) => eventStanding(x.e) === 'PENDING_ATTRIBUTION')) return { effect: 'NOT_YET_TESTED', basis: 'ATTRIBUTION_PENDING', followups: considered.length, recurrences: 0, evidenceRefs: workRefs };
  const targetAccountable = (e: AdverseSourceEvent): boolean => !e.attributionUnresolved && eventStanding(e) === 'ACCOUNTABLE' && e.accountableCauses.includes(input.targetCause);
  const recurring = events.filter((x) => x.phase === 'AFTER_TRAINING' && targetAccountable(x.e));
  const recurItems = new Set(recurring.map((x) => x.workItemId));
  // Work that MAY hold a recurrence the record cannot establish: an accountable target cause that cannot be placed in
  // time, an event whose attribution cannot be resolved, adverse work without event provenance.
  const uncertain = new Set(
    [...events.filter((x) => (x.phase === 'UNPLACEABLE' && targetAccountable(x.e)) || x.e.attributionUnresolved).map((x) => x.workItemId), ...unplaced].filter((w) => !recurItems.has(w)),
  );
  const recurrences = recurItems.size;
  const refs = [...workRefs, ...recurring.map((x) => x.e.sourceRef)];
  const base = { followups: considered.length, recurrences, evidenceRefs: refs };
  if (recurrences > 0) {
    const recur = (f: FollowupFact): boolean => f.accountableCauses.includes(input.targetCause);
    const baseShare = input.baseline.length === 0 ? 1 : input.baseline.filter(recur).length / input.baseline.length;
    const least = recurrences / considered.length;
    const most = (recurrences + uncertain.size) / considered.length;
    if (least > baseShare) return { effect: 'REGRESSION', basis: 'SAME_MISTAKE_RECURRED', ...base };
    if (most <= baseShare) return { effect: 'NO_IMPROVEMENT', basis: 'SAME_MISTAKE_RECURRED', ...base };
    return { effect: 'INCONCLUSIVE', basis: 'RECURRENCE_SHARE_NOT_ESTABLISHED', ...base };
  }
  if (uncertain.size > 0) return { effect: 'INCONCLUSIVE', basis: 'ADVERSE_EVENT_NOT_PLACEABLE', ...base };
  if (events.some((x) => { const st = eventStanding(x.e); return st === 'NO_ACCOUNTABLE_CAUSE' || st === 'NOT_ATTRIBUTABLE'; })) {
    return { effect: 'INCONCLUSIVE', basis: 'ADVERSE_WITHOUT_ACCOUNTABLE_CAUSE', ...base };
  }
  const qualified = usable.filter((f) => f.qualifiedOutcome).length;
  return qualified >= MIN_EFFECT_FOLLOWUPS
    ? { effect: 'IMPROVEMENT_OBSERVED', basis: 'NO_RECURRENCE_ON_QUALIFIED_WORK', ...base }
    : { effect: 'INCONCLUSIVE', basis: 'NO_RECURRENCE_BUT_UNQUALIFIED', ...base };
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
      // RB-1: one Work Item is one occurrence, whatever number of validated generations it holds.
      if (!g.items.some((i) => i.workItemId === f.workItemId)) g.items.push(f);
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
