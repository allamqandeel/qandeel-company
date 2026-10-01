/**
 * C7-C Pilot evidence semantics (pure, deterministic, no I/O).
 *
 * The Pilot Evidence Board is a PROJECTION of canonical Company evidence — Goals / Work, reviews, the C6 evaluations,
 * attributions, learning and economics, C7-A external evidence — never a second evaluator and never a scoreboard:
 * - readiness is an advisory CHECKLIST of independent criteria, each with its own evidence state, never blended into a
 *   percentage or a grade, and never a decision (the Founder decides the next phase);
 * - "appropriate autonomy" is read from the existing JUDGMENT and INDEPENDENCE dimensions only (no ninth dimension);
 * - failure localization lists where the trace points, while blame stays with the C6-governed causal attribution;
 * - internal training is never market success: a real-world claim needs current governed C7-A evidence.
 * (DORA: no single metric, measures in tension, context matters; agent evals: outcome AND trace, valid creative
 * paths are not defects, errors propagate across steps.)
 */
import type { ItemDimension, PerformanceDimension, Verdict, WorkEvidence } from './evaluation.js';
import type { CostPerQualifiedOutcome, DimensionProfile, EvaluationFact } from './performance.js';
import type { Scalar } from './reporting.js';

/** Advisory evidence states of one readiness criterion (NOT_APPLICABLE only where the Pilot's mode makes it so). */
export const READINESS_STATES = ['INSUFFICIENT_EVIDENCE', 'SUPPORTED', 'CONCERN', 'CONTESTED', 'NOT_APPLICABLE'] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

/** The eight readiness criteria of the brief (§11), each assessed on its own. */
export const READINESS_CRITERIA = [
  'FOUNDER_DIALOGUE', 'GOAL_DECOMPOSITION', 'CROSS_DEPARTMENT_EXECUTION', 'REVIEW_DISCIPLINE',
  'APPROPRIATE_AUTONOMY', 'LEARNING_CLOSURE', 'COST_DISCIPLINE', 'REAL_WORLD_OUTCOME',
] as const;
export type ReadinessCriterion = (typeof READINESS_CRITERIA)[number];

export interface ReadinessItem {
  readonly criterion: ReadinessCriterion;
  readonly state: ReadinessState;
  /** Bounded codes and counts that explain the state (no score, rank or rating). */
  readonly params: Readonly<Record<string, Scalar>>;
  readonly evidenceRefs: readonly string[];
  /** Readiness evidence is advisory: it never decides a phase, a promotion or an authority change. */
  readonly isDecision: false;
}

// --- Appropriate autonomy (JUDGMENT + INDEPENDENCE only) ------------------------------------------------------

/** The autonomy dimensions: the existing C6 JUDGMENT and INDEPENDENCE. There is no autonomy dimension of its own. */
export const AUTONOMY_DIMENSIONS: readonly PerformanceDimension[] = ['JUDGMENT', 'INDEPENDENCE'];

export const AUTONOMY_CLASSES = ['AUTHORITY_BOUNDARY_REFUSED', 'CORRECT_ESCALATION', 'UNNECESSARY_DEPENDENCE_EVIDENCED', 'ROUTINE_HANDLED_INDEPENDENTLY', 'INSUFFICIENT_EVIDENCE'] as const;
export type AutonomyClass = (typeof AUTONOMY_CLASSES)[number];

export interface DimensionVerdict {
  readonly dimension: ItemDimension;
  readonly verdict: Verdict;
  readonly basis: string;
}

/**
 * One Work Item's autonomy evidence, read ONLY from its C6 JUDGMENT and INDEPENDENCE verdicts:
 * - an authority-boundary refusal is never positive evidence, whatever else the item shows;
 * - a correct escalation of a real authority / spend / publication matter is good judgment, never dependence;
 * - Founder intervention the work needed is evidenced dependence (counted against an Employee only through C6
 *   attribution, never here);
 * - a qualified outcome reached without intervention, or a proven different route, is routine work handled
 *   independently.
 * A clarification (a question back to the Founder or a delegator) is not read by any of these — it is never negative.
 */
export function classifyAutonomy(dims: readonly DimensionVerdict[]): AutonomyClass {
  const of = (d: ItemDimension): DimensionVerdict | undefined => dims.find((x) => x.dimension === d);
  const judgment = of('JUDGMENT');
  const independence = of('INDEPENDENCE');
  if (judgment?.verdict === 'NEGATIVE') return 'AUTHORITY_BOUNDARY_REFUSED';
  if (judgment?.verdict === 'POSITIVE' && judgment.basis === 'CORRECT_ESCALATION') return 'CORRECT_ESCALATION';
  if (independence?.verdict === 'NEGATIVE') return 'UNNECESSARY_DEPENDENCE_EVIDENCED';
  if (independence?.verdict === 'POSITIVE' || (judgment?.verdict === 'POSITIVE' && judgment.basis === 'JUSTIFIED_ROUTE_CHOICE')) return 'ROUTINE_HANDLED_INDEPENDENTLY';
  return 'INSUFFICIENT_EVIDENCE';
}

/**
 * The Pilot reads C6 evaluation facts as they are, with one guard: an item whose own JUDGMENT is NEGATIVE (an
 * authority-boundary refusal) never contributes POSITIVE INITIATIVE inside a Pilot — an attempted unauthorized act is
 * never initiative. Everything else (sample, confidence, attribution, trend) stays C6's.
 */
export function pilotScopedFact(fact: EvaluationFact): EvaluationFact {
  if (fact.verdicts.JUDGMENT !== 'NEGATIVE' || fact.verdicts.INITIATIVE !== 'POSITIVE') return fact;
  return { ...fact, verdicts: { ...fact.verdicts, INITIATIVE: 'NOT_ASSESSED' } };
}

// --- Failure localization (outcome + trace; blame stays with C6) ---------------------------------------------------

export const LOCALIZATION_AREAS = ['RESULT', 'TOOL', 'HANDOFF', 'ESCALATION', 'REVIEW', 'MODEL_PROVIDER', 'CONTEXT', 'WORKFLOW', 'REQUIREMENT', 'EXTERNAL_DEPENDENCY'] as const;
export type LocalizationArea = (typeof LOCALIZATION_AREAS)[number];

export interface FailureLocalization {
  /** Where the canonical trace shows a problem (observed signals; never by themselves anyone's fault). */
  readonly areas: readonly LocalizationArea[];
  /** The C6 causal attribution's categories, only once it is VALIDATED (C6 governs causes; the Pilot never assigns them). */
  readonly attributedCauses: readonly string[];
  /** Whether the Employee is accountable — ONLY from a VALIDATED C6 attribution, otherwise null (never inferred here). */
  readonly employeeAccountable: boolean | null;
}

export function localizeFailure(
  ev: WorkEvidence,
  handoffProblems: number,
  attribution: { readonly state: string; readonly employeeAccountable: boolean; readonly categories: readonly string[] } | null,
): FailureLocalization {
  const areas: LocalizationArea[] = [];
  if (ev.outcome === 'NOT_ACHIEVED') areas.push('RESULT');
  if (ev.failures.tool > 0) areas.push('TOOL');
  if (handoffProblems > 0) areas.push('HANDOFF');
  if (ev.authorityRefusals > 0) areas.push('ESCALATION');
  if (ev.review.fail > 0 || ev.review.rework > 0 || ev.review.openConflict) areas.push('REVIEW');
  if (ev.failures.model + ev.failures.provider > 0) areas.push('MODEL_PROVIDER');
  if (ev.failures.context > 0) areas.push('CONTEXT');
  if (ev.failures.workflow > 0) areas.push('WORKFLOW');
  if (ev.failures.requirementChanged) areas.push('REQUIREMENT');
  if (ev.failures.external > 0) areas.push('EXTERNAL_DEPENDENCY');
  const validated = attribution !== null && attribution.state === 'VALIDATED';
  return { areas, attributedCauses: validated ? [...attribution.categories] : [], employeeAccountable: validated ? attribution.employeeAccountable : null };
}

// --- Market claims (C7-A only) ----------------------------------------------------------------------------------

export const MARKET_CLAIMS = ['NOT_CLAIMABLE_TRAINING_INTERNAL', 'NOT_SUPPORTED', 'SUPPORTED_BY_GOVERNED_EVIDENCE', 'CONTESTED'] as const;
export type MarketClaim = (typeof MARKET_CLAIMS)[number];

/**
 * Internal quality is never market success. A TRAINING_INTERNAL Pilot can never claim it. A CONTROLLED_REAL Pilot
 * supports it only through qualified outcomes whose CURRENT verification cites usable governed external evidence; any
 * in-scope verification a later integrity conflict contested makes the claim CONTESTED at once.
 */
export function marketClaimOf(mode: 'TRAINING_INTERNAL' | 'CONTROLLED_REAL', external: { readonly qualifiedWithCurrentExternal: number; readonly contested: number }): MarketClaim {
  if (mode === 'TRAINING_INTERNAL') return 'NOT_CLAIMABLE_TRAINING_INTERNAL';
  if (external.contested > 0) return 'CONTESTED';
  return external.qualifiedWithCurrentExternal > 0 ? 'SUPPORTED_BY_GOVERNED_EVIDENCE' : 'NOT_SUPPORTED';
}

// --- Readiness checklist ----------------------------------------------------------------------------------------

export interface AutonomyProfileFact {
  readonly employeeId: string;
  readonly judgment: DimensionProfile;
  readonly independence: DimensionProfile;
}

export interface PilotReadinessFacts {
  readonly mode: 'TRAINING_INTERNAL' | 'CONTROLLED_REAL';
  readonly requiresExternalOutcome: boolean;
  readonly briefing: { readonly answered: number; readonly pending: number; readonly refs: readonly string[] };
  readonly goal: { readonly bound: boolean; readonly state: string | null; readonly criteria: number; readonly derivedGoals: number; readonly linkedWork: number; readonly refs: readonly string[] };
  readonly collaboration: { readonly departments: number; readonly completedHandoffs: number; readonly problemHandoffs: number; readonly refs: readonly string[] };
  readonly review: { readonly satisfied: number; readonly rework: number; readonly openConflicts: number; readonly makerDecisions: number; readonly refs: readonly string[] };
  readonly autonomy: { readonly profiles: readonly AutonomyProfileFact[]; readonly boundaryRefused: number; readonly refs: readonly string[] };
  readonly learning: { readonly validatedLessons: number; readonly improvementObserved: number; readonly noImprovement: number; readonly regression: number; readonly trainingCompletedUntested: number; readonly refs: readonly string[] };
  readonly economics: CostPerQualifiedOutcome;
  readonly external: { readonly qualifiedWithCurrentExternal: number; readonly contested: number; readonly refs: readonly string[] };
}

const item = (criterion: ReadinessCriterion, state: ReadinessState, params: Record<string, Scalar>, evidenceRefs: readonly string[]): ReadinessItem => ({ criterion, state, params, evidenceRefs: evidenceRefs.slice(0, 50), isDecision: false });

function autonomyState(a: PilotReadinessFacts['autonomy']): { state: ReadinessState; params: Record<string, Scalar> } {
  const dims = a.profiles.flatMap((p) => [p.judgment, p.independence]);
  const count = (pred: (d: DimensionProfile) => boolean): number => dims.filter(pred).length;
  const params = {
    employees: a.profiles.length,
    sufficientDimensions: count((d) => d.state === 'SUFFICIENT_EVIDENCE'),
    conflictingDimensions: count((d) => d.state === 'CONFLICTING_EVIDENCE'),
    accountableNegatives: dims.reduce((s, d) => s + d.accountableNegative, 0),
    pendingAttribution: dims.reduce((s, d) => s + d.pendingAttribution, 0),
    boundaryRefused: a.boundaryRefused,
  };
  if (params.conflictingDimensions > 0) return { state: 'CONTESTED', params };
  if (params.accountableNegatives > 0 || count((d) => d.state === 'SUFFICIENT_EVIDENCE' && d.level === 'WEAK') > 0) return { state: 'CONCERN', params };
  // Pending adverse evidence is never clean: it holds the criterion until C6 attribution decides it.
  if (params.pendingAttribution > 0) return { state: 'INSUFFICIENT_EVIDENCE', params };
  if (count((d) => d.state === 'SUFFICIENT_EVIDENCE' && (d.level === 'STRONG' || d.level === 'ADEQUATE')) > 0) return { state: 'SUPPORTED', params };
  return { state: 'INSUFFICIENT_EVIDENCE', params };
}

/**
 * The advisory readiness checklist. Each criterion is assessed on its own evidence; nothing is averaged, weighted or
 * combined, activity never counts, zero qualified outcomes are never "efficient", and the result never decides.
 */
export function assessReadiness(f: PilotReadinessFacts): ReadinessItem[] {
  const out: ReadinessItem[] = [];
  out.push(item('FOUNDER_DIALOGUE', f.briefing.answered > 0 ? 'SUPPORTED' : 'INSUFFICIENT_EVIDENCE', { answeredRequests: f.briefing.answered, unansweredRequests: f.briefing.pending, conversationIsAuthority: false }, f.briefing.refs));

  const g = f.goal;
  const goalState: ReadinessState = !g.bound ? 'INSUFFICIENT_EVIDENCE' : g.state === 'CANCELLED' || g.state === 'SUPERSEDED' ? 'CONCERN' : g.criteria > 0 && g.derivedGoals + g.linkedWork > 0 ? 'SUPPORTED' : 'INSUFFICIENT_EVIDENCE';
  out.push(item('GOAL_DECOMPOSITION', goalState, { rootGoalBound: g.bound, rootGoalState: g.state, successCriteria: g.criteria, derivedGoals: g.derivedGoals, linkedWork: g.linkedWork }, g.refs));

  const c = f.collaboration;
  // Cross-department work is never manufactured to pass: one Department with no handoff is simply not evidenced.
  const collab: ReadinessState = c.problemHandoffs > 0 ? 'CONCERN' : c.departments >= 2 && c.completedHandoffs > 0 ? 'SUPPORTED' : 'INSUFFICIENT_EVIDENCE';
  out.push(item('CROSS_DEPARTMENT_EXECUTION', collab, { departments: c.departments, completedHandoffs: c.completedHandoffs, problemHandoffs: c.problemHandoffs }, c.refs));

  const r = f.review;
  const review: ReadinessState = r.makerDecisions > 0 || r.openConflicts > 0 ? 'CONCERN' : r.satisfied > 0 ? 'SUPPORTED' : 'INSUFFICIENT_EVIDENCE';
  out.push(item('REVIEW_DISCIPLINE', review, { independentReviewsSatisfied: r.satisfied, reworkKeptAsHistory: r.rework, openConflicts: r.openConflicts, makerSelfDecisions: r.makerDecisions }, r.refs));

  const a = autonomyState(f.autonomy);
  out.push(item('APPROPRIATE_AUTONOMY', a.state, a.params, f.autonomy.refs));

  const l = f.learning;
  // Training completed is not improvement: only a later comparable assessment (C6) says IMPROVEMENT_OBSERVED.
  const learning: ReadinessState = l.regression > 0 || l.noImprovement > 0 ? 'CONCERN' : l.improvementObserved > 0 ? 'SUPPORTED' : 'INSUFFICIENT_EVIDENCE';
  out.push(item('LEARNING_CLOSURE', learning, { validatedLessons: l.validatedLessons, improvementObserved: l.improvementObserved, noImprovement: l.noImprovement, regression: l.regression, trainingCompletedNotYetTested: l.trainingCompletedUntested }, l.refs));

  const e = f.economics;
  // Zero qualified outcomes is never efficiency: money spent with nothing qualified is a concern; nothing spent is no evidence.
  const cost: ReadinessState = e.state === 'DEFINED' ? 'SUPPORTED' : e.totalCostMicros > 0 ? 'CONCERN' : 'INSUFFICIENT_EVIDENCE';
  out.push(item('COST_DISCIPLINE', cost, { qualifiedOutcomes: e.qualifiedOutcomes, evaluatedItems: e.evaluatedItems, totalCostMicros: e.totalCostMicros, overheadMicros: e.overheadMicros, costPerQualifiedOutcomeMicros: e.costPerQualifiedOutcomeMicros }, []));

  const claim = marketClaimOf(f.mode, f.external);
  const real: ReadinessState =
    f.mode === 'TRAINING_INTERNAL' ? 'NOT_APPLICABLE'
    : claim === 'CONTESTED' ? 'CONTESTED'
    : claim === 'SUPPORTED_BY_GOVERNED_EVIDENCE' ? 'SUPPORTED'
    // Absence of external evidence is a concern only when the Pilot explicitly requires it.
    : f.requiresExternalOutcome ? 'CONCERN' : 'INSUFFICIENT_EVIDENCE';
  out.push(item('REAL_WORLD_OUTCOME', real, { mode: f.mode, marketClaim: claim, requiresExternalOutcome: f.requiresExternalOutcome, qualifiedWithCurrentExternal: f.external.qualifiedWithCurrentExternal, contested: f.external.contested }, f.external.refs));
  return out;
}
