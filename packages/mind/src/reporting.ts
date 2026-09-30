/**
 * Founder reporting semantics (Stage 17 Founder Decision 6, C6). Pure and deterministic.
 *
 * - Exception-first: a Daily Company Brief, a Weekly Operating Review ("is QANDEEL actually becoming
 *   better?") and a Monthly People & Capability Review, plus on-demand inspection of the evidence behind any
 *   claim.
 * - Every statement is typed FACT, ASSESSMENT, TREND or RECOMMENDATION. A fact cites the records it counts;
 *   an assessment, trend or recommendation must cite evidence AND carry its uncertainty, or it is refused.
 * - Statements are codes with scalar parameters; rendering to words is presentation, so a synthesis layer
 *   (the CEO, a model) may phrase them but cannot add evidence that is not here.
 * - No universal score, rank or leaderboard is ever emitted; a recommendation is never permission to act.
 * - External outcomes (campaigns, traffic, App health) are stated as unavailable until a governed source
 *   exists (C7) — never invented.
 */
import { QandeelError } from '@qandeel-company/domain';

import { EXTERNAL_OUTCOMES_AVAILABLE, type Confidence, type EvidenceState } from './evaluation.js';
import { costPerQualifiedOutcome, dimensionOf, type EvaluationFact, type LearningEffect, type PerformanceProfile, type ReviewerMetaEvaluation } from './performance.js';
import type { SystemicCandidate } from './improvement.js';

export const REPORT_CADENCES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type ReportCadence = (typeof REPORT_CADENCES)[number];

export const CLAIM_KINDS = ['FACT', 'ASSESSMENT', 'TREND', 'RECOMMENDATION'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const SUBJECT_KINDS = ['COMPANY', 'DEPARTMENT', 'EMPLOYEE', 'GOAL', 'WORK_ITEM', 'REVIEWER', 'SYSTEM'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export type Scalar = string | number | boolean | null;

export interface Claim {
  readonly code: string;
  readonly kind: ClaimKind;
  readonly subject: { readonly kind: SubjectKind; readonly id: string | null };
  readonly params: Readonly<Record<string, Scalar>>;
  readonly evidenceRefs: readonly string[];
  readonly uncertainty: { readonly state: EvidenceState; readonly confidence: Confidence; readonly sample: number } | null;
}

/** Statements that describe an absence of evidence and therefore cite none. */
export const EVIDENCE_FREE_CODES: readonly string[] = ['EXTERNAL_OUTCOMES_UNAVAILABLE', 'IMPROVEMENT_NOT_ESTABLISHED', 'NOTHING_MATERIAL', 'NO_QUALIFIED_OUTCOME_YET'];
const FORBIDDEN_PARAM = /score|rank|leaderboard|overall|rating/i;

/** The claim contract: judgement never travels without its evidence and its uncertainty. */
export function assertClaim(c: Claim): Claim {
  if (!(CLAIM_KINDS as readonly string[]).includes(c.kind)) throw new QandeelError('VALIDATION_FAILED', 'unknown claim kind', { code: c.code });
  if (!/^[A-Z0-9_]{1,64}$/.test(c.code)) throw new QandeelError('VALIDATION_FAILED', 'a claim is a statement code', { code: String(c.code).slice(0, 64) });
  for (const [k, v] of Object.entries(c.params)) {
    if (FORBIDDEN_PARAM.test(k)) throw new QandeelError('VALIDATION_FAILED', 'reports carry no universal score or rank', { code: c.code, param: k });
    if (typeof v === 'string' && v.length > 128) throw new QandeelError('VALIDATION_FAILED', 'claim parameters are codes, ids and counts', { code: c.code, param: k });
  }
  const free = c.kind === 'FACT' && EVIDENCE_FREE_CODES.includes(c.code);
  if (!free && c.evidenceRefs.length === 0) throw new QandeelError('EVIDENCE_REQUIRED', 'a claim cites the records behind it', { code: c.code, kind: c.kind });
  if (c.kind !== 'FACT' && c.uncertainty === null) throw new QandeelError('EVIDENCE_REQUIRED', 'a judgement carries its uncertainty', { code: c.code, kind: c.kind });
  return c;
}

export interface ReportFacts {
  readonly cadence: ReportCadence;
  readonly period: { readonly from: string; readonly to: string };
  /** Outcome verifications recorded in the period. */
  readonly verifications: readonly { readonly id: string; readonly workItemId: string; readonly verdict: 'ACHIEVED' | 'NOT_ACHIEVED' | 'INCONCLUSIVE' }[];
  readonly failedWork: readonly string[];
  readonly deadLetters: readonly string[];
  readonly reconciliationHeld: readonly string[];
  readonly decisionsRequired: readonly string[];
  readonly resilienceExceptions: readonly { readonly code: string; readonly ref: string }[];
  readonly goals: readonly { readonly goalId: string; readonly state: string; readonly linked: number; readonly qualified: number; readonly refs: readonly string[] }[];
  readonly evaluations: readonly EvaluationFact[];
  readonly previousEvaluations: readonly EvaluationFact[];
  readonly lessons: { readonly validated: readonly string[]; readonly patterns: readonly string[]; readonly nearMisses: readonly string[] };
  readonly systemic: readonly (SystemicCandidate & { readonly findingId: string; readonly state: string })[];
  readonly effects: readonly { readonly interventionId: string; readonly effect: LearningEffect }[];
  readonly profiles: readonly PerformanceProfile[];
  readonly reviewers: readonly ReviewerMetaEvaluation[];
  readonly capabilityGaps: readonly string[];
  readonly recertificationDue: readonly string[];
  readonly departmentGaps: readonly { readonly departmentId: string; readonly openGaps: number; readonly refs: readonly string[] }[];
  readonly minSample: number;
}

export interface CompanyReport {
  readonly cadence: ReportCadence;
  readonly period: { readonly from: string; readonly to: string };
  readonly claims: readonly Claim[];
}

const fact = (code: string, subject: Claim['subject'], params: Claim['params'], evidenceRefs: readonly string[]): Claim => assertClaim({ code, kind: 'FACT', subject, params, evidenceRefs, uncertainty: null });
const COMPANY = { kind: 'COMPANY', id: null } as const;
const confidenceOf = (n: number): Confidence => (n >= 10 ? 'HIGH' : n >= 5 ? 'MEDIUM' : 'LOW');

function dailyClaims(f: ReportFacts): Claim[] {
  const claims: Claim[] = [];
  const achieved = f.verifications.filter((v) => v.verdict === 'ACHIEVED');
  if (achieved.length > 0) claims.push(fact('OUTCOMES_ACHIEVED', COMPANY, { count: achieved.length }, achieved.map((v) => `outcome_verification:${v.id}`)));
  const notAchieved = f.verifications.filter((v) => v.verdict === 'NOT_ACHIEVED');
  if (notAchieved.length + f.failedWork.length > 0) claims.push(fact('MATERIAL_FAILURES', COMPANY, { outcomesNotAchieved: notAchieved.length, failedWork: f.failedWork.length }, [...notAchieved.map((v) => `outcome_verification:${v.id}`), ...f.failedWork.map((id) => `work_item:${id}`)]));
  if (f.deadLetters.length > 0) claims.push(fact('RISK_DEAD_LETTERS', COMPANY, { count: f.deadLetters.length }, f.deadLetters.map((id) => `job:${id}`)));
  if (f.reconciliationHeld.length > 0) claims.push(fact('RISK_UNCERTAIN_SIDE_EFFECTS', COMPANY, { count: f.reconciliationHeld.length }, f.reconciliationHeld.map((id) => `job:${id}`)));
  if (f.decisionsRequired.length > 0) claims.push(fact('DECISIONS_REQUIRED', COMPANY, { count: f.decisionsRequired.length }, f.decisionsRequired.map((id) => `attention:${id}`)));
  for (const r of f.resilienceExceptions) claims.push(fact(r.code, { kind: 'SYSTEM', id: null }, {}, [r.ref]));
  for (const p of f.profiles) {
    for (const d of p.dimensions) {
      if ((d.dimension === 'OUTCOME' || d.dimension === 'QUALITY') && (d.trend === 'IMPROVING' || d.trend === 'DECLINING')) {
        claims.push(assertClaim({ code: 'EMPLOYEE_MATERIAL_CHANGE', kind: 'TREND', subject: { kind: 'EMPLOYEE', id: p.employeeId }, params: { dimension: d.dimension, trend: d.trend }, evidenceRefs: d.evidenceRefs, uncertainty: { state: d.state, confidence: d.confidence, sample: d.sample } }));
      }
    }
  }
  if (claims.length === 0) claims.push(fact('NOTHING_MATERIAL', COMPANY, {}, []));
  return claims;
}

function improvementHeadline(f: ReportFacts): Claim {
  const now = f.evaluations.filter((e) => e.evidenceState === 'SUFFICIENT_EVIDENCE');
  const before = f.previousEvaluations.filter((e) => e.evidenceState === 'SUFFICIENT_EVIDENCE');
  if (now.length < f.minSample || before.length < f.minSample) {
    return fact('IMPROVEMENT_NOT_ESTABLISHED', COMPANY, { reason: 'INSUFFICIENT_EVIDENCE', current: now.length, previous: before.length, minimum: f.minSample }, []);
  }
  const share = (xs: readonly EvaluationFact[]): number => xs.filter((e) => e.qualifiedOutcome).length / xs.length;
  const rework = (xs: readonly EvaluationFact[]): number => xs.filter((e) => e.verdicts.QUALITY === 'NEGATIVE' || e.verdicts.QUALITY === 'NEUTRAL').length / xs.length;
  const qualifiedDelta = share(now) - share(before);
  const reworkDelta = rework(now) - rework(before);
  const direction = qualifiedDelta >= 0.1 && reworkDelta <= 0 ? 'BETTER' : qualifiedDelta <= -0.1 || reworkDelta >= 0.1 ? 'WORSE' : 'NO_CLEAR_CHANGE';
  const sample = Math.min(now.length, before.length);
  return assertClaim({
    code: 'COMPANY_IMPROVING',
    kind: 'ASSESSMENT',
    subject: COMPANY,
    params: { direction, qualifiedNow: now.filter((e) => e.qualifiedOutcome).length, evaluatedNow: now.length, qualifiedBefore: before.filter((e) => e.qualifiedOutcome).length, evaluatedBefore: before.length },
    evidenceRefs: [...now, ...before].map((e) => `evaluation:${e.evaluationId}`).slice(0, 100),
    uncertainty: { state: 'SUFFICIENT_EVIDENCE', confidence: confidenceOf(sample), sample },
  });
}

function weeklyClaims(f: ReportFacts): Claim[] {
  const claims: Claim[] = [improvementHeadline(f)];
  for (const g of f.goals) if (g.linked > 0) claims.push(fact('GOAL_PROGRESS', { kind: 'GOAL', id: g.goalId }, { state: g.state, linkedWork: g.linked, qualifiedOutcomes: g.qualified }, [`goal:${g.goalId}`, ...g.refs]));
  const economics = costPerQualifiedOutcome(f.evaluations);
  if (economics.state === 'DEFINED') {
    claims.push(fact('COST_PER_QUALIFIED_OUTCOME', COMPANY, { qualifiedOutcomes: economics.qualifiedOutcomes, evaluatedItems: economics.evaluatedItems, totalCostMicros: economics.totalCostMicros, overheadMicros: economics.overheadMicros, billedMicros: economics.billedMicros, costPerQualifiedOutcomeMicros: economics.costPerQualifiedOutcomeMicros }, f.evaluations.map((e) => `evaluation:${e.evaluationId}`).slice(0, 100)));
  } else if (f.evaluations.length > 0) {
    claims.push(fact('NO_QUALIFIED_OUTCOME_YET', COMPANY, { evaluatedItems: economics.evaluatedItems, totalCostMicros: economics.totalCostMicros }, []));
  }
  const reworked = f.evaluations.filter((e) => e.verdicts.QUALITY === 'NEGATIVE' || e.verdicts.QUALITY === 'NEUTRAL');
  if (reworked.length > 0) claims.push(fact('REWORK', COMPANY, { items: reworked.length, of: f.evaluations.length }, reworked.map((e) => `evaluation:${e.evaluationId}`)));
  if (f.failedWork.length + f.deadLetters.length > 0) claims.push(fact('RELIABILITY_EXCEPTIONS', COMPANY, { failedWork: f.failedWork.length, deadLetters: f.deadLetters.length }, [...f.failedWork.map((id) => `work_item:${id}`), ...f.deadLetters.map((id) => `job:${id}`)]));
  for (const s of f.systemic) {
    claims.push(assertClaim({ code: 'REPEATED_FAILURE_PATTERN', kind: 'TREND', subject: { kind: 'SYSTEM', id: s.findingId }, params: { targetKind: s.targetKind, targetRef: s.targetRef, cause: s.cause, occurrences: s.occurrences, distinctEmployees: s.distinctEmployees, state: s.state }, evidenceRefs: s.evidenceRefs, uncertainty: { state: 'SUFFICIENT_EVIDENCE', confidence: confidenceOf(s.occurrences), sample: s.occurrences } }));
  }
  if (f.lessons.validated.length > 0) claims.push(fact('VALIDATED_LESSONS', COMPANY, { count: f.lessons.validated.length }, f.lessons.validated.map((id) => `lesson:${id}`)));
  if (f.lessons.patterns.length > 0) claims.push(fact('SUCCESSFUL_PATTERNS', COMPANY, { count: f.lessons.patterns.length }, f.lessons.patterns.map((id) => `lesson:${id}`)));
  if (f.lessons.nearMisses.length > 0) claims.push(fact('NEAR_MISSES', COMPANY, { count: f.lessons.nearMisses.length }, f.lessons.nearMisses.map((id) => `lesson:${id}`)));
  for (const e of f.effects) if (e.effect !== 'NOT_YET_TESTED') claims.push(fact('LEARNING_EFFECT', COMPANY, { effect: e.effect }, [`learning_intervention:${e.interventionId}`]));
  for (const p of f.profiles) {
    for (const d of p.dimensions) {
      if (d.trend !== 'TREND_NOT_ESTABLISHED') claims.push(assertClaim({ code: 'CAPABILITY_TREND', kind: 'TREND', subject: { kind: 'EMPLOYEE', id: p.employeeId }, params: { dimension: d.dimension, trend: d.trend, level: d.level }, evidenceRefs: d.evidenceRefs, uncertainty: { state: d.state, confidence: d.confidence, sample: d.sample } }));
    }
  }
  for (const r of f.resilienceExceptions) claims.push(fact(r.code, { kind: 'SYSTEM', id: null }, {}, [r.ref]));
  claims.push(fact('EXTERNAL_OUTCOMES_UNAVAILABLE', COMPANY, { available: EXTERNAL_OUTCOMES_AVAILABLE, source: 'C7' }, []));
  return claims;
}

function monthlyClaims(f: ReportFacts): Claim[] {
  const claims: Claim[] = [];
  for (const p of f.profiles) {
    if (p.readiness.signal === 'READY_FOR_GREATER_RESPONSIBILITY_REVIEW') {
      const outcome = dimensionOf(p.dimensions, 'OUTCOME');
      claims.push(assertClaim({ code: 'CONSIDER_GREATER_RESPONSIBILITY_REVIEW', kind: 'RECOMMENDATION', subject: { kind: 'EMPLOYEE', id: p.employeeId }, params: { isDecision: false }, evidenceRefs: p.dimensions.flatMap((d) => d.evidenceRefs).slice(0, 100), uncertainty: { state: outcome.state, confidence: outcome.confidence, sample: outcome.sample } }));
    }
    for (const c of p.capabilities) claims.push(assertClaim({ code: 'CAPABILITY_DEMONSTRATED', kind: 'TREND', subject: { kind: 'EMPLOYEE', id: p.employeeId }, params: { comparableKey: c.comparableKey, sample: c.sample }, evidenceRefs: c.evidenceRefs, uncertainty: { state: 'SUFFICIENT_EVIDENCE', confidence: confidenceOf(c.sample), sample: c.sample } }));
    for (const r of p.regressions) claims.push(assertClaim({ code: 'CAPABILITY_REGRESSION_SUSPECTED', kind: 'TREND', subject: { kind: 'EMPLOYEE', id: p.employeeId }, params: { comparableKey: r.comparableKey, sample: r.sample }, evidenceRefs: r.evidenceRefs, uncertainty: { state: 'SUFFICIENT_EVIDENCE', confidence: confidenceOf(r.sample), sample: r.sample } }));
    // R2-18: adverse evidence whose cause is still pending is disclosed, never hidden behind a clean profile.
    const pendingRefs = [...new Set(p.dimensions.flatMap((d) => d.pendingEvidenceRefs))];
    if (pendingRefs.length > 0) {
      claims.push(fact('ADVERSE_EVIDENCE_PENDING_ATTRIBUTION', { kind: 'EMPLOYEE', id: p.employeeId }, { pendingOutcome: dimensionOf(p.dimensions, 'OUTCOME').pendingAttribution, pendingQuality: dimensionOf(p.dimensions, 'QUALITY').pendingAttribution, items: pendingRefs.length }, pendingRefs.slice(0, 100)));
    }
    // RR3: adverse evidence whose proposed cause was rejected (no accountable cause established) is decided — never
    // pending, never counted against the Employee — and still disclosed, never hidden behind a clean profile.
    const unattributedRefs = [...new Set(p.dimensions.flatMap((d) => d.unattributedEvidenceRefs))];
    if (unattributedRefs.length > 0) {
      claims.push(fact('ADVERSE_EVIDENCE_WITHOUT_ACCOUNTABLE_CAUSE', { kind: 'EMPLOYEE', id: p.employeeId }, { outcome: dimensionOf(p.dimensions, 'OUTCOME').unattributedAdverse, quality: dimensionOf(p.dimensions, 'QUALITY').unattributedAdverse, items: unattributedRefs.length }, unattributedRefs.slice(0, 100)));
    }
    const contribution = dimensionOf(p.dimensions, 'SYSTEM_CONTRIBUTION');
    if (contribution.positive > 0) claims.push(fact('SYSTEM_CONTRIBUTION', { kind: 'EMPLOYEE', id: p.employeeId }, { count: contribution.positive }, contribution.evidenceRefs));
  }
  if (f.capabilityGaps.length > 0) claims.push(fact('SKILL_GAPS_OPEN', COMPANY, { count: f.capabilityGaps.length }, f.capabilityGaps.map((id) => `capability_gap:${id}`)));
  for (const d of f.departmentGaps) if (d.openGaps > 0) claims.push(fact('DEPARTMENT_CAPABILITY_BOTTLENECK', { kind: 'DEPARTMENT', id: d.departmentId }, { openGaps: d.openGaps }, d.refs));
  if (f.recertificationDue.length > 0) claims.push(fact('RECERTIFICATION_DUE', COMPANY, { count: f.recertificationDue.length }, f.recertificationDue.map((id) => `certification:${id}`)));
  const tested = f.effects.filter((e) => e.effect !== 'NOT_YET_TESTED');
  if (tested.length > 0) {
    const by = (x: LearningEffect): number => tested.filter((e) => e.effect === x).length;
    claims.push(fact('RETRAINING_EFFECTIVENESS', COMPANY, { improved: by('IMPROVEMENT_OBSERVED'), noImprovement: by('NO_IMPROVEMENT'), regression: by('REGRESSION'), inconclusive: by('INCONCLUSIVE') }, tested.map((e) => `learning_intervention:${e.interventionId}`)));
  }
  for (const r of f.reviewers) {
    if (r.concerns.length > 0) claims.push(assertClaim({ code: 'REVIEWER_CALIBRATION_CONCERN', kind: 'ASSESSMENT', subject: { kind: 'REVIEWER', id: r.qualificationId }, params: { concerns: r.concerns.join(','), falseApprovals: r.falseApprovals, falseRejections: r.falseRejections, drift: r.drift }, evidenceRefs: r.evidenceRefs.length > 0 ? r.evidenceRefs : [`reviewer_qualification:${r.qualificationId}`], uncertainty: { state: r.state, confidence: confidenceOf(r.decisions), sample: r.decisions } }));
  }
  for (const s of f.systemic) {
    if (s.state === 'VALIDATED') claims.push(assertClaim({ code: 'CONSIDER_PROCESS_CHANGE', kind: 'RECOMMENDATION', subject: { kind: 'SYSTEM', id: s.findingId }, params: { targetKind: s.targetKind, targetRef: s.targetRef, isDecision: false }, evidenceRefs: s.evidenceRefs, uncertainty: { state: 'SUFFICIENT_EVIDENCE', confidence: confidenceOf(s.occurrences), sample: s.occurrences } }));
  }
  if (claims.length === 0) claims.push(fact('NOTHING_MATERIAL', COMPANY, {}, []));
  return claims;
}

/** Composes a report from facts. Deterministic: the same facts always give the same claims in the same order. */
export function composeReport(f: ReportFacts): CompanyReport {
  const claims = f.cadence === 'DAILY' ? dailyClaims(f) : f.cadence === 'WEEKLY' ? weeklyClaims(f) : monthlyClaims(f);
  return { cadence: f.cadence, period: f.period, claims };
}

/** The period a cadence covers, ending at `to` (UTC, inclusive of `from`). */
export function reportPeriod(cadence: ReportCadence, to: string): { from: string; to: string } {
  const days = cadence === 'DAILY' ? 1 : cadence === 'WEEKLY' ? 7 : 30;
  return { from: new Date(Date.parse(to) - days * 86_400_000).toISOString(), to };
}
