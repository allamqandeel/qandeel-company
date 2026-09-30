/**
 * The Performance Profile, cost per qualified outcome and reviewer meta-evaluation (Stage 17, C6). Pure.
 *
 * - There is NO universal employee score, rank or leaderboard: a profile is one entry per dimension, each with
 *   its own sample, evidence state, confidence, qualitative level and trend. Nothing sums the dimensions.
 * - One excellent task does not make an excellent employee; one failure does not make a bad one: below the
 *   minimum sample a dimension is INSUFFICIENT_EVIDENCE, and a trend needs enough comparable evidence in both
 *   halves of the window (otherwise TREND_NOT_ESTABLISHED).
 * - A negative verdict counts against the Employee only when a VALIDATED attribution makes them accountable;
 *   every other attribution state has ONE meaning, defined by `adverseStanding` (RR3): a pending one is not counted
 *   and never counted as clean (disclosed, withholds a level it outweighs, holds readiness); a REJECTED cause is
 *   decided (no accountable cause) and a negative no attribution is due for is not a cause question — both are
 *   disclosed, never counted and never pending.
 * - Capability (a newly demonstrated class of work) and regression (a lost one) are separate lists.
 * - READY_FOR_GREATER_RESPONSIBILITY_REVIEW is evidence for a governed human decision, never a promotion.
 * - Activity counts are carried as labelled observability, never read by a dimension.
 */
import { QandeelError } from '@qandeel-company/domain';

import type { Confidence, EvidenceState, ItemDimension, PerformanceDimension, RiskLevel, Verdict } from './evaluation.js';
import { DEFAULT_MINIMUM_EVIDENCE, type MinimumEvidence } from './evaluation.js';

/** One stored evaluation as the profile sees it. */
export interface EvaluationFact {
  readonly evaluationId: string;
  readonly workItemId: string;
  readonly comparableKey: string;
  readonly riskLevel: RiskLevel;
  readonly at: string;
  readonly evidenceState: EvidenceState;
  readonly qualifiedOutcome: boolean;
  readonly verdicts: Readonly<Partial<Record<ItemDimension, Verdict>>>;
  /** Economic micros (what the budget ledger charges); `billedMicros` is the provider bill, reporting only (R2-20). */
  readonly cost: { readonly productiveMicros: number; readonly overheadMicros: number; readonly billedMicros?: number };
  readonly activity: { readonly messages: number; readonly toolCalls: number; readonly tokens: number; readonly runs: number };
  /** When the work itself started (its first run, else its creation) — not when it was evaluated (R2-15). */
  readonly workStartedAt?: string;
  /** RR3: whether an attribution was due for this work when it was evaluated (`attributionDue`, the evaluator's own predicate). */
  readonly attributionDue: boolean;
}

/** The attribution of a Work Item as every reader sees it: its live one (PROPOSED / VALIDATED), else its latest decided one. */
export interface AttributionFact {
  readonly workItemId: string;
  readonly state: 'PROPOSED' | 'VALIDATED' | 'REJECTED';
  readonly employeeAccountable: boolean;
  readonly overall: string;
}

export type AttributionState = AttributionFact['state'] | 'NONE';

export const ADVERSE_STANDINGS = ['ACCOUNTABLE', 'NOT_EMPLOYEE', 'PENDING_ATTRIBUTION', 'NO_ACCOUNTABLE_CAUSE', 'NOT_ATTRIBUTABLE'] as const;
export type AdverseStanding = (typeof ADVERSE_STANDINGS)[number];

/**
 * RR3 — THE one meaning of a piece of adverse evidence (a NEGATIVE item verdict, an adverse follow-up) in every
 * attribution state. Every C6 reader (the profile and its readiness signal, capability regression, learning-effect
 * assessment, and the reports built on them) reads adverse evidence through this function and nothing else.
 *
 * - VALIDATED, the Employee's own judgement → ACCOUNTABLE: the ONLY standing counted against the Employee (D-C6-03).
 * - VALIDATED, another cause → NOT_EMPLOYEE: decided; excluded from the Employee's record.
 * - PROPOSED, or no attribution while one is due → PENDING_ATTRIBUTION: undecided. Never counted against the Employee
 *   and never read as clean: disclosed, it holds readiness and keeps a learning effect open (R2-17 / R2-18).
 * - REJECTED → NO_ACCOUNTABLE_CAUSE: DECIDED — the Founder rejected the proposed cause, so no accountable cause was
 *   established. Never pending (nothing is left to decide), never counted against the Employee, never read as
 *   clean: disclosed, and it makes a learning effect INCONCLUSIVE (a recorded, non-final assessment).
 * - No attribution and none due → NOT_ATTRIBUTABLE: nothing the evaluator can attribute (e.g. provider fallback cost
 *   on qualified work, or a Founder intervention): not a cause question, never pending, never counted, disclosed.
 */
export function adverseStanding(input: { readonly attributionDue: boolean; readonly state: AttributionState; readonly employeeAccountable: boolean }): AdverseStanding {
  switch (input.state) {
    case 'VALIDATED':
      return input.employeeAccountable ? 'ACCOUNTABLE' : 'NOT_EMPLOYEE';
    case 'PROPOSED':
      return 'PENDING_ATTRIBUTION';
    case 'REJECTED':
      return 'NO_ACCOUNTABLE_CAUSE';
    case 'NONE':
      return input.attributionDue ? 'PENDING_ATTRIBUTION' : 'NOT_ATTRIBUTABLE';
  }
}

/** The standing of one evaluated Work Item's adverse evidence, from its attribution (if any). */
export function standingOf(fact: Pick<EvaluationFact, 'attributionDue'>, attribution: AttributionFact | undefined): AdverseStanding {
  return adverseStanding({ attributionDue: fact.attributionDue === true, state: attribution?.state ?? 'NONE', employeeAccountable: attribution?.employeeAccountable === true });
}

export const LEARNING_EFFECTS = ['NOT_YET_TESTED', 'IMPROVEMENT_OBSERVED', 'NO_IMPROVEMENT', 'REGRESSION', 'INCONCLUSIVE'] as const;
export type LearningEffect = (typeof LEARNING_EFFECTS)[number];

export interface ContributionFact {
  readonly validatedPatterns: readonly string[];
  readonly verifiedPatternReuses: readonly string[];
  readonly validatedSystemicFindings: readonly string[];
}

export const PROFILE_LEVELS = ['STRONG', 'ADEQUATE', 'WEAK'] as const;
export type ProfileLevel = (typeof PROFILE_LEVELS)[number];
export const TRENDS = ['IMPROVING', 'STABLE', 'DECLINING', 'TREND_NOT_ESTABLISHED'] as const;
export type Trend = (typeof TRENDS)[number];

export interface DimensionProfile {
  readonly dimension: PerformanceDimension;
  readonly state: EvidenceState;
  /** Counted evidence (positive + accountable negative + neutral). */
  readonly sample: number;
  readonly positive: number;
  readonly accountableNegative: number;
  readonly neutral: number;
  /** Negatives whose validated cause is not the Employee (never counted against them). */
  readonly excludedNonEmployee: number;
  /**
   * Negatives whose attribution is PENDING (PROPOSED, or due and not yet recorded): not counted against the
   * Employee (D-C6-03), but never counted as clean either — disclosed, and they hold readiness (R2-18, RR3).
   */
  readonly pendingAttribution: number;
  readonly pendingEvidenceRefs: readonly string[];
  /** RR3: negatives whose proposed cause was REJECTED (no accountable cause established): decided, disclosed, never counted. */
  readonly unattributedAdverse: number;
  readonly unattributedEvidenceRefs: readonly string[];
  /** RR3: negatives on work where no attribution is due (not a cause question): never pending, never counted; disclosed. */
  readonly notAttributable: number;
  /** Qualitative level, only with sufficient evidence — and none while pending adverse evidence outweighs it. */
  readonly level: ProfileLevel | null;
  readonly confidence: Confidence;
  readonly trend: Trend;
  readonly evidenceRefs: readonly string[];
}

export interface CapabilitySignal {
  readonly comparableKey: string;
  readonly kind: 'DEMONSTRATED' | 'REGRESSION_SUSPECTED';
  readonly sample: number;
  readonly evidenceRefs: readonly string[];
}

export const READINESS_SIGNALS = ['READY_FOR_GREATER_RESPONSIBILITY_REVIEW', 'NOT_READY', 'INSUFFICIENT_EVIDENCE'] as const;
export type ReadinessSignal = (typeof READINESS_SIGNALS)[number];

export interface PerformanceProfile {
  readonly employeeId: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly dimensions: readonly DimensionProfile[];
  readonly capabilities: readonly CapabilitySignal[];
  readonly regressions: readonly CapabilitySignal[];
  readonly readiness: { readonly signal: ReadinessSignal; readonly reasons: readonly string[]; readonly isDecision: false };
  readonly economics: CostPerQualifiedOutcome;
  /** Observability only: not performance, never read by any dimension. */
  readonly observability: { readonly workItems: number; readonly messages: number; readonly toolCalls: number; readonly tokens: number; readonly runs: number };
}

export interface ProfileInput {
  readonly employeeId: string;
  readonly at: string;
  readonly evaluations: readonly EvaluationFact[];
  readonly attributions: readonly AttributionFact[];
  readonly learningEffects: readonly { readonly interventionId: string; readonly effect: LearningEffect }[];
  readonly contributions: ContributionFact;
  readonly minimum?: MinimumEvidence;
}

const DAY_MS = 86_400_000;
const confidenceOf = (n: number): Confidence => (n >= 10 ? 'HIGH' : n >= 5 ? 'MEDIUM' : 'LOW');
const levelOf = (positive: number, sample: number): ProfileLevel => (positive * 5 >= sample * 4 ? 'STRONG' : positive * 2 >= sample ? 'ADEQUATE' : 'WEAK');
const RISK_RANK: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };
const ITEM_DIMENSION_SET: ReadonlySet<PerformanceDimension> = new Set(['OUTCOME', 'QUALITY', 'JUDGMENT', 'EFFICIENCY', 'INITIATIVE', 'INDEPENDENCE']);

type Counted = { fact: EvaluationFact; kind: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' };

function trendOf(counted: readonly Counted[], min: number): Trend {
  const ordered = [...counted].sort((a, b) => (a.fact.at < b.fact.at ? -1 : a.fact.at > b.fact.at ? 1 : 0));
  const half = Math.floor(ordered.length / 2);
  const early = ordered.slice(0, half);
  const late = ordered.slice(half);
  if (early.length < min || late.length < min) return 'TREND_NOT_ESTABLISHED';
  const share = (xs: readonly Counted[]): number => xs.filter((x) => x.kind === 'POSITIVE').length / xs.length;
  const delta = share(late) - share(early);
  // A third of the window must move before a direction is claimed (no false precision on small samples).
  if (delta >= 1 / 3) return 'IMPROVING';
  if (delta <= -1 / 3) return 'DECLINING';
  return 'STABLE';
}

function itemDimension(dimension: ItemDimension, facts: readonly EvaluationFact[], attribution: ReadonlyMap<string, AttributionFact>, min: MinimumEvidence): DimensionProfile {
  const counted: Counted[] = [];
  let excluded = 0;
  let pending = 0;
  let unattributed = 0;
  let notAttributable = 0;
  let conflicting = 0;
  const refs: string[] = [];
  const pendingRefs: string[] = [];
  const unattributedRefs: string[] = [];
  for (const f of facts) {
    if (f.evidenceState === 'CONFLICTING_EVIDENCE') conflicting++;
    if (f.evidenceState !== 'SUFFICIENT_EVIDENCE') continue;
    const v = f.verdicts[dimension];
    if (v === undefined || v === 'NOT_ASSESSED') continue;
    if (v === 'NEGATIVE') {
      // RR3: one meaning of adverse evidence in every attribution state (`adverseStanding`).
      const standing = standingOf(f, attribution.get(f.workItemId));
      if (standing === 'PENDING_ATTRIBUTION') {
        pending++;
        pendingRefs.push(`evaluation:${f.evaluationId}`);
        continue;
      }
      if (standing === 'NO_ACCOUNTABLE_CAUSE') {
        unattributed++;
        unattributedRefs.push(`evaluation:${f.evaluationId}`);
        continue;
      }
      if (standing === 'NOT_ATTRIBUTABLE') {
        notAttributable++;
        continue;
      }
      if (standing === 'NOT_EMPLOYEE') {
        excluded++;
        continue;
      }
    }
    counted.push({ fact: f, kind: v === 'POSITIVE' ? 'POSITIVE' : v === 'NEGATIVE' ? 'NEGATIVE' : 'NEUTRAL' });
    refs.push(`evaluation:${f.evaluationId}`);
  }
  const positive = counted.filter((c) => c.kind === 'POSITIVE').length;
  const negative = counted.filter((c) => c.kind === 'NEGATIVE').length;
  const sample = counted.length;
  const state: EvidenceState = conflicting > 0 && conflicting * 3 >= Math.max(1, sample + conflicting) ? 'CONFLICTING_EVIDENCE' : sample < min.minSample ? 'INSUFFICIENT_EVIDENCE' : 'SUFFICIENT_EVIDENCE';
  // R2-18: at least as much pending adverse evidence as counted evidence — no level and no direction is claimed.
  const outweighed = pending > 0 && pending >= sample;
  return {
    dimension,
    state,
    sample,
    positive,
    accountableNegative: negative,
    neutral: sample - positive - negative,
    excludedNonEmployee: excluded,
    pendingAttribution: pending,
    pendingEvidenceRefs: pendingRefs.slice(0, 50),
    unattributedAdverse: unattributed,
    unattributedEvidenceRefs: unattributedRefs.slice(0, 50),
    notAttributable,
    level: state === 'SUFFICIENT_EVIDENCE' && !outweighed ? levelOf(positive, sample) : null,
    confidence: confidenceOf(sample),
    trend: state === 'SUFFICIENT_EVIDENCE' && !outweighed ? trendOf(counted, min.minTrendSample) : 'TREND_NOT_ESTABLISHED',
    evidenceRefs: refs.slice(0, 50),
  };
}

function learningVelocity(effects: ProfileInput['learningEffects']): DimensionProfile {
  const tested = effects.filter((e) => e.effect === 'IMPROVEMENT_OBSERVED' || e.effect === 'NO_IMPROVEMENT' || e.effect === 'REGRESSION');
  const positive = tested.filter((e) => e.effect === 'IMPROVEMENT_OBSERVED').length;
  const negative = tested.length - positive;
  const state: EvidenceState = tested.length < 2 ? 'INSUFFICIENT_EVIDENCE' : 'SUFFICIENT_EVIDENCE';
  return {
    dimension: 'LEARNING_VELOCITY',
    state,
    sample: tested.length,
    positive,
    accountableNegative: negative,
    neutral: 0,
    excludedNonEmployee: 0,
    pendingAttribution: effects.length - tested.length,
    pendingEvidenceRefs: [],
    unattributedAdverse: 0,
    unattributedEvidenceRefs: [],
    notAttributable: 0,
    level: state === 'SUFFICIENT_EVIDENCE' ? levelOf(positive, tested.length) : null,
    confidence: confidenceOf(tested.length),
    trend: 'TREND_NOT_ESTABLISHED',
    evidenceRefs: tested.map((e) => `learning_intervention:${e.interventionId}`),
  };
}

/**
 * System contribution: validated patterns, verified reuses of the Employee's pattern by OTHER Employees (the store
 * supplies only those — reusing one's own pattern is not a contribution to the system, R2-16) and validated
 * systemic findings the Employee reported.
 */
function systemContribution(c: ContributionFact): DimensionProfile {
  const refs = [...c.validatedPatterns.map((id) => `lesson:${id}`), ...c.verifiedPatternReuses.map((id) => `learning_intervention:${id}`), ...c.validatedSystemicFindings.map((id) => `systemic_finding:${id}`)];
  const n = refs.length;
  return {
    dimension: 'SYSTEM_CONTRIBUTION',
    // Contribution is evidence of presence; its absence is "not yet observed", never a negative.
    state: n === 0 ? 'INSUFFICIENT_EVIDENCE' : 'SUFFICIENT_EVIDENCE',
    sample: n,
    positive: n,
    accountableNegative: 0,
    neutral: 0,
    excludedNonEmployee: 0,
    pendingAttribution: 0,
    pendingEvidenceRefs: [],
    unattributedAdverse: 0,
    unattributedEvidenceRefs: [],
    notAttributable: 0,
    level: n === 0 ? null : n >= 3 ? 'STRONG' : 'ADEQUATE',
    confidence: confidenceOf(n),
    trend: 'TREND_NOT_ESTABLISHED',
    evidenceRefs: refs,
  };
}

function capabilitySignals(facts: readonly EvaluationFact[], attribution: ReadonlyMap<string, AttributionFact>, min: MinimumEvidence): { capabilities: CapabilitySignal[]; regressions: CapabilitySignal[] } {
  const byKey = new Map<string, EvaluationFact[]>();
  for (const f of facts) if (f.evidenceState === 'SUFFICIENT_EVIDENCE') byKey.set(f.comparableKey, [...(byKey.get(f.comparableKey) ?? []), f]);
  const capabilities: CapabilitySignal[] = [];
  const regressions: CapabilitySignal[] = [];
  const accountableFailure = (f: EvaluationFact): boolean => {
    if (f.verdicts.OUTCOME !== 'NEGATIVE' && f.verdicts.QUALITY !== 'NEGATIVE') return false;
    return standingOf(f, attribution.get(f.workItemId)) === 'ACCOUNTABLE';
  };
  for (const [key, list] of [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const ordered = [...list].sort((a, b) => (a.at < b.at ? -1 : 1));
    const qualified = ordered.filter((f) => f.qualifiedOutcome);
    if (qualified.length >= min.minSample) capabilities.push({ comparableKey: key, kind: 'DEMONSTRATED', sample: qualified.length, evidenceRefs: qualified.map((f) => `evaluation:${f.evaluationId}`) });
    // Regression: demonstrated early in the window, then accountable failures dominate later.
    const half = Math.floor(ordered.length / 2);
    const early = ordered.slice(0, half);
    const late = ordered.slice(half);
    const earlyQualified = early.filter((f) => f.qualifiedOutcome).length;
    const lateFailures = late.filter(accountableFailure);
    const lateQualified = late.filter((f) => f.qualifiedOutcome).length;
    if (earlyQualified >= min.minSample && lateFailures.length >= 2 && lateFailures.length >= lateQualified) {
      regressions.push({ comparableKey: key, kind: 'REGRESSION_SUSPECTED', sample: late.length, evidenceRefs: lateFailures.map((f) => `evaluation:${f.evaluationId}`) });
    }
  }
  return { capabilities, regressions };
}

export interface CostPerQualifiedOutcome {
  readonly qualifiedOutcomes: number;
  readonly evaluatedItems: number;
  readonly totalCostMicros: number;
  readonly productiveMicros: number;
  /** Retries, fallbacks, escalations, failed charged calls and rework. */
  readonly overheadMicros: number;
  /** The provider bill of the same work (reporting only; the costs above are economic, R2-20). */
  readonly billedMicros: number;
  /** Total cost (productive + overhead, including failed and unqualified work) per qualified outcome; null when none. */
  readonly costPerQualifiedOutcomeMicros: number | null;
  readonly state: 'DEFINED' | 'NO_QUALIFIED_OUTCOME';
}

/**
 * Cost per qualified outcome: everything spent (including failures and rework) divided by the outcomes that
 * passed review AND outcome verification. A cheap run that produced nothing qualified has no defined cost per
 * qualified outcome — it is never "the cheapest".
 */
export function costPerQualifiedOutcome(facts: readonly EvaluationFact[]): CostPerQualifiedOutcome {
  const productive = facts.reduce((s, f) => s + f.cost.productiveMicros, 0);
  const overhead = facts.reduce((s, f) => s + f.cost.overheadMicros, 0);
  const qualified = facts.filter((f) => f.qualifiedOutcome).length;
  const total = productive + overhead;
  return {
    qualifiedOutcomes: qualified,
    evaluatedItems: facts.length,
    totalCostMicros: total,
    productiveMicros: productive,
    overheadMicros: overhead,
    billedMicros: facts.reduce((s, f) => s + (f.cost.billedMicros ?? 0), 0),
    costPerQualifiedOutcomeMicros: qualified > 0 ? Math.ceil(total / qualified) : null,
    state: qualified > 0 ? 'DEFINED' : 'NO_QUALIFIED_OUTCOME',
  };
}

/** The profile entry of one dimension (every profile carries all eight). */
export function dimensionOf(dims: readonly DimensionProfile[], k: PerformanceDimension): DimensionProfile {
  const found = dims.find((x) => x.dimension === k);
  if (found === undefined) throw new QandeelError('VALIDATION_FAILED', 'a profile carries every dimension', { dimension: k });
  return found;
}

function readinessOf(dims: readonly DimensionProfile[], regressions: readonly CapabilitySignal[], facts: readonly EvaluationFact[]): PerformanceProfile['readiness'] {
  const d = (k: PerformanceDimension): DimensionProfile => dimensionOf(dims, k);
  const outcome = d('OUTCOME');
  const quality = d('QUALITY');
  // R2-18 / RR3: adverse evidence whose attribution is PENDING (`adverseStanding`) is not counted against the Employee,
  // but it is never counted as clean: while any is pending, no readiness is signalled. A decided REJECTED cause and a
  // negative no attribution is due for are not pending: they are disclosed, never counted, and hold nothing.
  const pending = dims.some((x) => ITEM_DIMENSION_SET.has(x.dimension) && x.pendingAttribution > 0) ? ['ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'] : [];
  if (outcome.state !== 'SUFFICIENT_EVIDENCE' || quality.state !== 'SUFFICIENT_EVIDENCE') return { signal: 'INSUFFICIENT_EVIDENCE', reasons: ['OUTCOME_OR_QUALITY_EVIDENCE_INSUFFICIENT', ...pending], isDecision: false };
  const reasons: string[] = [...pending];
  if (outcome.level !== 'STRONG') reasons.push('OUTCOMES_NOT_CONSISTENTLY_QUALIFIED');
  if (quality.level !== 'STRONG') reasons.push('QUALITY_NOT_STABLE');
  if (d('JUDGMENT').accountableNegative > 0) reasons.push('ACCOUNTABLE_JUDGMENT_FAILURE');
  const independence = d('INDEPENDENCE');
  if (independence.state !== 'SUFFICIENT_EVIDENCE' || independence.level === 'WEAK') reasons.push('SUPERVISION_STILL_NEEDED');
  if (d('INITIATIVE').positive === 0 && d('SYSTEM_CONTRIBUTION').positive === 0) reasons.push('NO_USEFUL_INITIATIVE_YET');
  const learning = d('LEARNING_VELOCITY');
  if (learning.state === 'SUFFICIENT_EVIDENCE' && learning.level === 'WEAK') reasons.push('LEARNING_NOT_DEMONSTRATED');
  if (regressions.length > 0) reasons.push('CAPABILITY_REGRESSION_SUSPECTED');
  if (!facts.some((f) => f.qualifiedOutcome && RISK_RANK[f.riskLevel] >= 2)) reasons.push('NO_HARDER_OUTCOME_YET');
  if (outcome.trend === 'DECLINING' || quality.trend === 'DECLINING') reasons.push('DECLINING_TREND');
  return { signal: reasons.length === 0 ? 'READY_FOR_GREATER_RESPONSIBILITY_REVIEW' : 'NOT_READY', reasons, isDecision: false };
}

/** Builds the multi-dimensional profile of one Employee over the recency window. */
export function buildPerformanceProfile(input: ProfileInput): PerformanceProfile {
  const min = input.minimum ?? DEFAULT_MINIMUM_EVIDENCE;
  const from = new Date(Date.parse(input.at) - min.recencyDays * DAY_MS).toISOString();
  const facts = input.evaluations.filter((f) => f.at >= from && f.at <= input.at);
  const attribution = new Map(input.attributions.map((a) => [a.workItemId, a]));
  const item = (['OUTCOME', 'QUALITY', 'JUDGMENT', 'EFFICIENCY', 'INITIATIVE', 'INDEPENDENCE'] as const).map((k) => itemDimension(k, facts, attribution, min));
  const dimensions: DimensionProfile[] = [];
  for (const k of ['OUTCOME', 'QUALITY', 'JUDGMENT', 'EFFICIENCY', 'INITIATIVE', 'LEARNING_VELOCITY', 'INDEPENDENCE', 'SYSTEM_CONTRIBUTION'] as const) {
    if (k === 'LEARNING_VELOCITY') dimensions.push(learningVelocity(input.learningEffects));
    else if (k === 'SYSTEM_CONTRIBUTION') dimensions.push(systemContribution(input.contributions));
    else dimensions.push(dimensionOf(item, k));
  }
  const { capabilities, regressions } = capabilitySignals(facts, attribution, min);
  return {
    employeeId: input.employeeId,
    window: { from, to: input.at },
    dimensions,
    capabilities,
    regressions,
    readiness: readinessOf(dimensions, regressions, facts),
    economics: costPerQualifiedOutcome(facts),
    observability: {
      workItems: facts.length,
      messages: facts.reduce((s, f) => s + f.activity.messages, 0),
      toolCalls: facts.reduce((s, f) => s + f.activity.toolCalls, 0),
      tokens: facts.reduce((s, f) => s + f.activity.tokens, 0),
      runs: facts.reduce((s, f) => s + f.activity.runs, 0),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Reviewer meta-evaluation (extends the C4 Review Pool calibration: same rows, later outcome evidence).

export interface ReviewerDecisionFact {
  readonly decisionId: string;
  readonly qualificationId: string;
  readonly workItemId: string;
  readonly outcome: 'PASS' | 'FAIL' | 'UNCERTAIN' | 'INSUFFICIENT_EVIDENCE' | 'NEEDS_SPECIALIST' | 'ESCALATE';
  readonly counts: boolean;
  readonly at: string;
  /** The verified outcome of the reviewed Work Item, when known. */
  readonly laterOutcome: 'ACHIEVED' | 'NOT_ACHIEVED' | null;
  /** A counting FAIL later overturned (conflict resolved PASS) — a false rejection. */
  readonly overturned: boolean;
}

export interface ReviewerCalibrationFact {
  readonly qualificationId: string;
  readonly signal: 'AGREE' | 'DISAGREE';
  readonly at: string;
}

export interface ReviewerMetaEvaluation {
  readonly qualificationId: string;
  readonly decisions: number;
  readonly falseApprovals: number;
  readonly falseRejections: number;
  readonly uncertain: number;
  readonly agreements: number;
  readonly disagreements: number;
  readonly drift: 'RISING_DISAGREEMENT' | 'STABLE' | 'TREND_NOT_ESTABLISHED';
  readonly state: EvidenceState;
  readonly concerns: readonly string[];
  readonly evidenceRefs: readonly string[];
}

/** False approval / false rejection / uncertainty / drift per reviewer qualification (a recommendation input, never an act). */
export function reviewerMetaEvaluation(decisions: readonly ReviewerDecisionFact[], calibrations: readonly ReviewerCalibrationFact[], minSample = 5): ReviewerMetaEvaluation[] {
  const ids = [...new Set([...decisions.map((d) => d.qualificationId), ...calibrations.map((c) => c.qualificationId)])].sort();
  return ids.map((q) => {
    const mine = decisions.filter((d) => d.qualificationId === q);
    const cal = [...calibrations.filter((c) => c.qualificationId === q)].sort((a, b) => (a.at < b.at ? -1 : 1));
    const falseApprovals = mine.filter((d) => d.counts && d.outcome === 'PASS' && d.laterOutcome === 'NOT_ACHIEVED');
    const falseRejections = mine.filter((d) => d.counts && d.outcome === 'FAIL' && d.overturned);
    const uncertain = mine.filter((d) => d.outcome === 'UNCERTAIN' || d.outcome === 'INSUFFICIENT_EVIDENCE').length;
    const agreements = cal.filter((c) => c.signal === 'AGREE').length;
    const disagreements = cal.length - agreements;
    const half = Math.floor(cal.length / 2);
    const rate = (xs: readonly ReviewerCalibrationFact[]): number => xs.filter((c) => c.signal === 'DISAGREE').length / Math.max(1, xs.length);
    const drift = half < 3 ? 'TREND_NOT_ESTABLISHED' : rate(cal.slice(half)) - rate(cal.slice(0, half)) >= 1 / 3 ? 'RISING_DISAGREEMENT' : 'STABLE';
    const sample = mine.length + cal.length;
    const state: EvidenceState = sample < minSample ? 'INSUFFICIENT_EVIDENCE' : 'SUFFICIENT_EVIDENCE';
    const concerns: string[] = [];
    if (falseApprovals.length >= 2 || (state === 'SUFFICIENT_EVIDENCE' && falseApprovals.length * 5 > Math.max(1, mine.length))) concerns.push('FALSE_APPROVALS');
    if (falseRejections.length >= 2) concerns.push('FALSE_REJECTIONS');
    if (drift === 'RISING_DISAGREEMENT') concerns.push('CALIBRATION_DRIFT');
    if (state === 'SUFFICIENT_EVIDENCE' && uncertain * 2 > mine.length) concerns.push('MOSTLY_UNCERTAIN');
    return {
      qualificationId: q,
      decisions: mine.length,
      falseApprovals: falseApprovals.length,
      falseRejections: falseRejections.length,
      uncertain,
      agreements,
      disagreements,
      drift,
      state,
      concerns,
      evidenceRefs: [...falseApprovals, ...falseRejections].map((d) => `review_decision:${d.decisionId}`),
    };
  });
}
