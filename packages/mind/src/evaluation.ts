/**
 * The QANDEEL Evaluation kernel (Stage 17, C6). Pure and deterministic; no I/O.
 *
 * - QANDEEL owns its evaluation semantics: an Eval Definition is a versioned, provider-independent contract
 *   (dimensions, required evidence classes, evaluator kind, minimum evidence, reference cases). No model
 *   provider or grader prompt is the owner of what "good work" means.
 * - Evidence before judgement: an evaluation reads only durable Company facts (work lineage, review
 *   decisions, outcome verification, run / tool / cost facts, interventions). Missing required evidence gives
 *   INSUFFICIENT_EVIDENCE; contradictory evidence gives CONFLICTING_EVIDENCE — never an invented verdict.
 * - Completed ≠ Reviewed ≠ Outcome Verified: completion alone never makes an outcome qualified.
 * - Activity (messages, tool calls, tokens, runs) is observability only; no verdict reads it.
 * - A valid creative path is not penalized for differing from the expected route.
 * - Causal attribution separates the Employee's judgement from model, tool, context, workflow, provider,
 *   requirement and external causes; an Employee is accountable only when their judgement is the primary cause.
 * - The evaluator itself is evaluated: a definition carries reference cases (known-good, known-bad, ambiguous,
 *   non-employee cause, valid creative path) and cannot be activated unless it behaves correctly on all of them.
 */
import { QandeelError } from '@qandeel-company/domain';

/** Strong-v1 Performance Profile dimensions (C6 §6.2). Role-specific dimensions may extend them later. */
export const PERFORMANCE_DIMENSIONS = ['OUTCOME', 'QUALITY', 'JUDGMENT', 'EFFICIENCY', 'INITIATIVE', 'LEARNING_VELOCITY', 'INDEPENDENCE', 'SYSTEM_CONTRIBUTION'] as const;
export type PerformanceDimension = (typeof PERFORMANCE_DIMENSIONS)[number];

/** Dimensions a single Work Item can speak to; learning velocity and system contribution are longer-horizon evidence. */
export const ITEM_DIMENSIONS = ['OUTCOME', 'QUALITY', 'JUDGMENT', 'EFFICIENCY', 'INITIATIVE', 'INDEPENDENCE'] as const;
export type ItemDimension = (typeof ITEM_DIMENSIONS)[number];

export const VERDICTS = ['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'NOT_ASSESSED'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const EVIDENCE_STATES = ['SUFFICIENT_EVIDENCE', 'INSUFFICIENT_EVIDENCE', 'CONFLICTING_EVIDENCE'] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

export const CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const CAUSE_CATEGORIES = ['EMPLOYEE_JUDGMENT', 'MODEL', 'TOOL', 'CONTEXT_RETRIEVAL', 'WORKFLOW_PROCESS', 'PROVIDER', 'REQUIREMENT', 'EXTERNAL_DEPENDENCY', 'MIXED', 'UNKNOWN'] as const;
export type CauseCategory = (typeof CAUSE_CATEGORIES)[number];
/** The categories a single cause entry may carry (MIXED / UNKNOWN describe the whole attribution). */
export const DIRECT_CAUSES = ['EMPLOYEE_JUDGMENT', 'MODEL', 'TOOL', 'CONTEXT_RETRIEVAL', 'WORKFLOW_PROCESS', 'PROVIDER', 'REQUIREMENT', 'EXTERNAL_DEPENDENCY'] as const;
export type DirectCause = (typeof DIRECT_CAUSES)[number];

export const EVIDENCE_CLASSES = ['WORK_LINEAGE', 'REVIEW_DECISION', 'OUTCOME_VERIFICATION', 'RUN_TRACE', 'TOOL_RESULT', 'ARTIFACT', 'COST_USAGE', 'REWORK', 'INTERVENTION', 'ACADEMY', 'COMPARABLE_HISTORY', 'EXTERNAL_OUTCOME'] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

/** Evaluator kinds. MODEL_GRADER is a registrable seam; C6 ships no executable model grader (it fails closed). */
export const EVALUATOR_KINDS = ['DETERMINISTIC_RULES', 'REVIEW_POOL', 'FOUNDER', 'MODEL_GRADER'] as const;
export type EvaluatorKind = (typeof EVALUATOR_KINDS)[number];
export const EXECUTABLE_EVALUATORS: readonly EvaluatorKind[] = ['DETERMINISTIC_RULES'];

export const REFERENCE_CASE_KINDS = ['KNOWN_GOOD', 'KNOWN_BAD', 'AMBIGUOUS', 'NON_EMPLOYEE_CAUSE', 'CREATIVE_PATH'] as const;
export type ReferenceCaseKind = (typeof REFERENCE_CASE_KINDS)[number];

export const RISK_LEVELS = ['R0', 'R1', 'R2', 'R3', 'R4'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * C7-A: external outcome evidence is RUNTIME truth, never a compile-time flag. Whether a governed external outcome source
 * exists is read from durable source state by the caller (storage) and passed in; absent that, nothing may require or
 * cite external outcomes (fail closed). Usable evidence itself is decided by storage from governed records and bindings.
 */
export interface ExternalOutcomeContext {
  /** At least one governed external outcome source is ACTIVE. */
  readonly governedSource: boolean;
}
export const NO_EXTERNAL_OUTCOME_SOURCE: ExternalOutcomeContext = Object.freeze({ governedSource: false });

/**
 * The durable facts of one Work Item as the evaluator sees them: counts, codes and references only (Rule A —
 * no content). Built by storage from canonical rows; the kernel never reads anything else.
 */
export interface WorkEvidence {
  readonly workItemId: string;
  readonly employeeId: string | null;
  readonly departmentId: string | null;
  /** Comparable-work key (task class / processor kind); trends and capabilities compare only like with like. */
  readonly comparableKey: string;
  readonly riskLevel: RiskLevel;
  readonly completed: boolean;
  readonly reviewed: boolean;
  readonly outcome: 'ACHIEVED' | 'NOT_ACHIEVED' | 'INCONCLUSIVE' | null;
  readonly review: { readonly pass: number; readonly fail: number; readonly uncertain: number; readonly insufficient: number; readonly rework: number; readonly openConflict: boolean };
  readonly runs: { readonly total: number; readonly failed: number; readonly retried: number };
  /**
   * UNRECOVERED system failures: those the work did not get past (a permanent failure, or a failed attempt no later
   * successful run followed) — the only failures that can be the cause of the work's outcome.
   */
  readonly failures: { readonly tool: number; readonly provider: number; readonly model: number; readonly context: number; readonly external: number; readonly workflow: number; readonly requirementChanged: boolean };
  /**
   * R2-13: failures the work RECOVERED from (a later run of the same Work Item succeeded). Observability and
   * overhead (their cost is already retry / failed-charged cost) — never the primary cause of a merits failure.
   */
  readonly recoveredFailures: { readonly tool: number; readonly provider: number; readonly model: number; readonly context: number; readonly workflow: number };
  readonly interventions: { readonly escalations: number; readonly correctEscalations: number; readonly founder: number };
  readonly authorityRefusals: number;
  /** Gates (review, approval, budget, reconciliation) that stopped a harmful path before it happened. */
  readonly gateCatches: number;
  readonly route: { readonly planned: readonly string[]; readonly taken: readonly string[] };
  /**
   * Cost buckets in ECONOMIC micros — what the budget ledger charges (D13-G.3 / G.8), so a subscription or free
   * route is not free work (R2-20). `billedMicros` is the provider bill, carried separately for reporting only.
   */
  readonly cost: { readonly productiveMicros: number; readonly retryMicros: number; readonly fallbackMicros: number; readonly escalationMicros: number; readonly failedChargedMicros: number; readonly reworkMicros: number; readonly billedMicros: number };
  /** Observability only — never read by a verdict. */
  readonly activity: { readonly messages: number; readonly toolCalls: number; readonly tokens: number; readonly runs: number };
  readonly evidenceClasses: readonly EvidenceClass[];
}

export interface MinimumEvidence {
  /** Comparable evaluated items before a dimension is interpreted at all. */
  readonly minSample: number;
  /** Items needed in EACH half of the window before a trend is claimed. */
  readonly minTrendSample: number;
  /** Evidence older than this is outside the profile window. */
  readonly recencyDays: number;
}

/** Conservative Strong-v1 defaults, calibratable in the Pilot (not statistically derived thresholds). */
export const DEFAULT_MINIMUM_EVIDENCE: MinimumEvidence = Object.freeze({ minSample: 3, minTrendSample: 3, recencyDays: 90 });

export interface ReferenceCase {
  readonly id: string;
  readonly kind: ReferenceCaseKind;
  readonly evidence: WorkEvidence;
}

export interface EvalDefinitionSpec {
  readonly code: string;
  readonly evaluationType: 'WORK_OUTCOME';
  readonly subjectType: 'WORK_ITEM';
  readonly applicability: { readonly roles: readonly string[]; readonly domains: readonly string[] };
  readonly dimensions: readonly ItemDimension[];
  readonly requiredEvidence: readonly EvidenceClass[];
  readonly evaluatorKind: EvaluatorKind;
  readonly minimumEvidence: MinimumEvidence;
  readonly referenceCases: readonly ReferenceCase[];
}

const CODE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const has = <T>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);

/** Structural validation of a definition (the registry refuses anything else). */
export function assertEvalDefinition(spec: EvalDefinitionSpec, external: ExternalOutcomeContext = NO_EXTERNAL_OUTCOME_SOURCE): void {
  const bad = (field: string, why: string): never => {
    throw new QandeelError('EVAL_INVALID', `eval definition ${why}`, { field });
  };
  if (typeof spec.code !== 'string' || !CODE.test(spec.code)) bad('code', 'code is a short lowercase code');
  if (spec.evaluationType !== 'WORK_OUTCOME') bad('evaluationType', 'type is WORK_OUTCOME in C6');
  if (spec.subjectType !== 'WORK_ITEM') bad('subjectType', 'subject is a Work Item in C6');
  if (!Array.isArray(spec.dimensions) || spec.dimensions.length === 0 || !spec.dimensions.every((d) => has(ITEM_DIMENSIONS, d))) bad('dimensions', 'names known item dimensions');
  if (new Set(spec.dimensions).size !== spec.dimensions.length) bad('dimensions', 'lists each dimension once');
  if (!Array.isArray(spec.requiredEvidence) || !spec.requiredEvidence.every((c) => has(EVIDENCE_CLASSES, c))) bad('requiredEvidence', 'names known evidence classes');
  if (spec.requiredEvidence.includes('EXTERNAL_OUTCOME') && !external.governedSource) bad('requiredEvidence', 'cannot require external outcomes while no governed external outcome source is active');
  if (!has(EVALUATOR_KINDS, spec.evaluatorKind)) bad('evaluatorKind', 'names a known evaluator kind');
  const m = spec.minimumEvidence;
  if (!m || !Number.isInteger(m.minSample) || m.minSample < 1 || m.minSample > 1000 || !Number.isInteger(m.minTrendSample) || m.minTrendSample < 1 || m.minTrendSample > 1000 || !Number.isInteger(m.recencyDays) || m.recencyDays < 1 || m.recencyDays > 3660) bad('minimumEvidence', 'bounds minimum evidence');
  for (const list of [spec.applicability?.roles, spec.applicability?.domains]) if (!Array.isArray(list) || list.length > 32 || !list.every((r) => typeof r === 'string' && r.length >= 1 && r.length <= 96)) bad('applicability', 'lists roles / domains as short refs');
  if (!Array.isArray(spec.referenceCases) || spec.referenceCases.length > 32) bad('referenceCases', 'carries at most 32 reference cases');
  const ids = new Set<string>();
  for (const c of spec.referenceCases) {
    if (!has(REFERENCE_CASE_KINDS, c.kind) || typeof c.id !== 'string' || !CODE.test(c.id) || ids.has(c.id)) bad('referenceCases', 'names each case once with a known kind');
    ids.add(c.id);
  }
}

// ---------------------------------------------------------------------------------------------------------
// The reference evaluator (DETERMINISTIC_RULES).

export interface ItemDimensionResult {
  readonly dimension: ItemDimension;
  readonly verdict: Verdict;
  /** Why (a code, never content). */
  readonly basis: string;
}

export interface EvaluationOutcome {
  readonly evidenceState: EvidenceState;
  /** A qualified outcome: independently reviewed AND outcome verified as achieved. */
  readonly qualifiedOutcome: boolean;
  readonly dimensions: readonly ItemDimensionResult[];
  readonly missingEvidence: readonly EvidenceClass[];
  readonly conflicts: readonly string[];
}

const overheadOf = (c: WorkEvidence['cost']): number => c.retryMicros + c.fallbackMicros + c.escalationMicros + c.failedChargedMicros + c.reworkMicros;

/** The route differs from the declared plan (a different path, not necessarily a worse one). */
export const routeDeviated = (ev: WorkEvidence): boolean =>
  ev.route.planned.length > 0 && (ev.route.taken.length !== ev.route.planned.length || ev.route.taken.some((t, i) => t !== ev.route.planned[i]));

export function qualifiedOutcome(ev: WorkEvidence): boolean {
  return ev.reviewed && ev.outcome === 'ACHIEVED';
}

function dimensionVerdict(dimension: ItemDimension, ev: WorkEvidence, qualified: boolean): ItemDimensionResult {
  const r = (verdict: Verdict, basis: string): ItemDimensionResult => ({ dimension, verdict, basis });
  switch (dimension) {
    case 'OUTCOME':
      if (ev.outcome === 'ACHIEVED') return r('POSITIVE', 'OUTCOME_VERIFIED');
      if (ev.outcome === 'NOT_ACHIEVED') return r('NEGATIVE', 'OUTCOME_NOT_ACHIEVED');
      return r('NOT_ASSESSED', ev.completed ? 'COMPLETION_IS_NOT_SUCCESS' : 'NO_OUTCOME_EVIDENCE');
    case 'QUALITY':
      if (ev.review.pass + ev.review.fail === 0) return r('NOT_ASSESSED', 'NOT_REVIEWED');
      if (ev.review.rework >= 2 || (ev.review.fail > 0 && ev.outcome === 'NOT_ACHIEVED')) return r('NEGATIVE', 'REPEATED_REWORK_OR_FAILED_REVIEW');
      if (ev.review.fail === 0 && ev.review.rework === 0 && ev.review.pass > 0) return r('POSITIVE', 'PASSED_INDEPENDENT_REVIEW');
      return r('NEUTRAL', 'PASSED_AFTER_REWORK');
    case 'JUDGMENT':
      if (ev.authorityRefusals > 0) return r('NEGATIVE', 'AUTHORITY_BOUNDARY_REFUSED');
      if (ev.interventions.correctEscalations > 0) return r('POSITIVE', 'CORRECT_ESCALATION');
      if (routeDeviated(ev) && qualified) return r('POSITIVE', 'JUSTIFIED_ROUTE_CHOICE');
      return r('NOT_ASSESSED', 'NO_JUDGMENT_EVIDENCE');
    case 'EFFICIENCY': {
      // Efficiency is judged only on a qualified outcome: a cheap failure is not efficient.
      if (!qualified) return r('NOT_ASSESSED', 'NO_QUALIFIED_OUTCOME');
      const overhead = overheadOf(ev.cost);
      // m-31: no recorded cost is no evidence of efficiency (never "free, therefore efficient").
      if (ev.cost.productiveMicros + overhead === 0) return r('NOT_ASSESSED', 'NO_COST_EVIDENCE');
      if (ev.review.rework >= 2 || overhead > ev.cost.productiveMicros) return r('NEGATIVE', 'WASTE_EXCEEDS_PRODUCTIVE_COST');
      if (ev.review.rework === 0 && overhead * 4 <= ev.cost.productiveMicros) return r('POSITIVE', 'LOW_WASTE_QUALIFIED');
      return r('NEUTRAL', 'SOME_WASTE_QUALIFIED');
    }
    case 'INITIATIVE':
      // A different path is never a defect by itself; a proven different path is initiative.
      if (routeDeviated(ev) && qualified) return r('POSITIVE', 'VALID_CREATIVE_PATH');
      return r('NOT_ASSESSED', 'NO_INITIATIVE_EVIDENCE');
    case 'INDEPENDENCE':
      if (ev.interventions.founder > 0) return r('NEGATIVE', 'FOUNDER_INTERVENTION_NEEDED');
      if (qualified && ev.interventions.escalations - ev.interventions.correctEscalations <= 0) return r('POSITIVE', 'QUALIFIED_WITHOUT_INTERVENTION');
      return r('NOT_ASSESSED', 'NO_INDEPENDENCE_EVIDENCE');
  }
}

/** Contradictions in the evidence itself: never averaged away. */
export function evidenceConflicts(ev: WorkEvidence): string[] {
  const out: string[] = [];
  if (ev.review.openConflict) out.push('REVIEW_CONFLICT_OPEN');
  if (ev.outcome === 'NOT_ACHIEVED' && ev.review.pass > 0 && ev.review.fail === 0) out.push('REVIEW_PASSED_OUTCOME_FAILED');
  if (ev.outcome === 'ACHIEVED' && !ev.reviewed && ev.review.fail > 0) out.push('OUTCOME_ACHIEVED_REVIEW_FAILED');
  return out;
}

/** Evaluates one Work Item under one definition (the reference DETERMINISTIC_RULES evaluator). */
export function evaluateWork(spec: EvalDefinitionSpec, ev: WorkEvidence): EvaluationOutcome {
  if (!EXECUTABLE_EVALUATORS.includes(spec.evaluatorKind)) throw new QandeelError('EVAL_INVALID', 'no executable evaluator of this kind exists (fail closed)', { evaluatorKind: spec.evaluatorKind });
  const missing = spec.requiredEvidence.filter((c) => !ev.evidenceClasses.includes(c));
  const notAssessed = (basis: string): ItemDimensionResult[] => spec.dimensions.map((dimension) => ({ dimension, verdict: 'NOT_ASSESSED' as const, basis }));
  if (missing.length > 0) return { evidenceState: 'INSUFFICIENT_EVIDENCE', qualifiedOutcome: false, dimensions: notAssessed('MISSING_REQUIRED_EVIDENCE'), missingEvidence: missing, conflicts: [] };
  const conflicts = evidenceConflicts(ev);
  if (conflicts.length > 0) return { evidenceState: 'CONFLICTING_EVIDENCE', qualifiedOutcome: false, dimensions: notAssessed('CONFLICTING_EVIDENCE'), missingEvidence: [], conflicts };
  if (ev.outcome === 'INCONCLUSIVE' || (ev.review.uncertain + ev.review.insufficient > 0 && ev.review.pass + ev.review.fail === 0)) {
    return { evidenceState: 'INSUFFICIENT_EVIDENCE', qualifiedOutcome: false, dimensions: notAssessed('EVIDENCE_INCONCLUSIVE'), missingEvidence: [], conflicts: [] };
  }
  const qualified = qualifiedOutcome(ev);
  return { evidenceState: 'SUFFICIENT_EVIDENCE', qualifiedOutcome: qualified, dimensions: spec.dimensions.map((d) => dimensionVerdict(d, ev, qualified)), missingEvidence: [], conflicts: [] };
}

// ---------------------------------------------------------------------------------------------------------
// Causal attribution.

export interface AttributedCause {
  readonly category: DirectCause;
  readonly role: 'PRIMARY' | 'CONTRIBUTING';
  readonly confidence: Confidence;
  readonly basis: string;
}

export interface AttributionProposal {
  /** False when nothing went wrong: no attribution is needed. */
  readonly needed: boolean;
  readonly overall: CauseCategory;
  readonly causes: readonly AttributedCause[];
  /** The Employee is accountable only when their own judgement is the PRIMARY cause. */
  readonly employeeAccountable: boolean;
  readonly confidence: Confidence;
}

/** Something went wrong that deserves a cause (a failure, a rejected output, an unachieved outcome, a boundary refusal). */
export function adverseOutcome(ev: WorkEvidence): boolean {
  return ev.outcome === 'NOT_ACHIEVED' || ev.review.fail > 0 || ev.review.rework > 0 || ev.runs.failed > 0 || ev.authorityRefusals > 0;
}

const NON_EMPLOYEE_SIGNALS: readonly { category: DirectCause; present: (ev: WorkEvidence) => boolean; basis: string }[] = [
  { category: 'TOOL', present: (ev) => ev.failures.tool > 0, basis: 'TOOL_FAILURE_RECORDED' },
  { category: 'PROVIDER', present: (ev) => ev.failures.provider > 0, basis: 'PROVIDER_FAILURE_RECORDED' },
  { category: 'MODEL', present: (ev) => ev.failures.model > 0, basis: 'MODEL_FAILURE_RECORDED' },
  { category: 'CONTEXT_RETRIEVAL', present: (ev) => ev.failures.context > 0, basis: 'CONTEXT_ASSEMBLY_FAILED' },
  { category: 'WORKFLOW_PROCESS', present: (ev) => ev.failures.workflow > 0, basis: 'WORKFLOW_BLOCKED' },
  { category: 'REQUIREMENT', present: (ev) => ev.failures.requirementChanged, basis: 'REQUIREMENT_CHANGED' },
  { category: 'EXTERNAL_DEPENDENCY', present: (ev) => ev.failures.external > 0, basis: 'EXTERNAL_DEPENDENCY_FAILED' },
];

/** R2-13: failures the work got past (a later run succeeded) — their recorded causes, by family. */
const RECOVERED_SIGNALS: readonly { category: DirectCause; count: (r: WorkEvidence['recoveredFailures']) => number; basis: string }[] = [
  { category: 'TOOL', count: (r) => r.tool, basis: 'TOOL_FAILURE_RECOVERED' },
  { category: 'PROVIDER', count: (r) => r.provider, basis: 'PROVIDER_FAILURE_RECOVERED' },
  { category: 'MODEL', count: (r) => r.model, basis: 'MODEL_FAILURE_RECOVERED' },
  { category: 'CONTEXT_RETRIEVAL', count: (r) => r.context, basis: 'CONTEXT_FAILURE_RECOVERED' },
  { category: 'WORKFLOW_PROCESS', count: (r) => r.workflow, basis: 'WORKFLOW_BLOCK_RECOVERED' },
];

/**
 * Proposes a causal attribution from the evidence. A proposal is never truth: it must be validated
 * (independently of the subject Employee) before anything learns from it or a profile counts it.
 * Only an UNRECOVERED system failure can be the primary cause of the outcome; a failure the work recovered from
 * (a retry succeeded) did not cause a later merits failure — it is at most a low-confidence contributing cause.
 */
export function proposeAttribution(ev: WorkEvidence): AttributionProposal {
  if (!adverseOutcome(ev)) return { needed: false, overall: 'UNKNOWN', causes: [], employeeAccountable: false, confidence: 'LOW' };
  const system = NON_EMPLOYEE_SIGNALS.filter((s) => s.present(ev));
  const recovered = RECOVERED_SIGNALS.filter((s) => s.count(ev.recoveredFailures) > 0 && !system.some((x) => x.category === s.category));
  const causes: AttributedCause[] = system.map((s, i) => ({ category: s.category, role: i === 0 ? 'PRIMARY' : 'CONTRIBUTING', confidence: system.length === 1 ? 'HIGH' : 'MEDIUM', basis: s.basis }));
  const employeeSignal = ev.authorityRefusals > 0 || ev.review.fail > 0 || ev.outcome === 'NOT_ACHIEVED';
  if (system.length === 0 && employeeSignal) {
    const strong = ev.review.fail > 0 && (ev.outcome === 'NOT_ACHIEVED' || ev.authorityRefusals > 0);
    causes.push({ category: 'EMPLOYEE_JUDGMENT', role: 'PRIMARY', confidence: strong ? 'HIGH' : 'MEDIUM', basis: ev.authorityRefusals > 0 ? 'AUTHORITY_BOUNDARY_REFUSED' : 'REVIEW_REJECTED_OUTPUT' });
    for (const s of recovered) causes.push({ category: s.category, role: 'CONTRIBUTING', confidence: 'LOW', basis: s.basis });
  } else if (system.length === 0 && recovered.length > 0) {
    // Nothing went wrong but attempts the work recovered from: the failed attempts' own recorded cause.
    recovered.forEach((s, i) => causes.push({ category: s.category, role: i === 0 ? 'PRIMARY' : 'CONTRIBUTING', confidence: recovered.length === 1 ? 'HIGH' : 'MEDIUM', basis: s.basis }));
  } else if (system.length > 0 && ev.authorityRefusals > 0) {
    // A boundary refusal is the Employee's own act even when a tool also failed.
    causes.push({ category: 'EMPLOYEE_JUDGMENT', role: 'CONTRIBUTING', confidence: 'MEDIUM', basis: 'AUTHORITY_BOUNDARY_REFUSED' });
  }
  return summarizeCauses(causes);
}

/**
 * RR3: an attribution is DUE — something adverse happened AND the evidence names a cause to propose. This is the
 * one predicate behind both the evaluator's proposal (the store records a proposal exactly then) and "pending
 * attribution" in every reader (`adverseStanding`): a negative on work where no attribution is due can never be
 * pending, because no proposal can ever arrive for anyone to decide.
 */
export function attributionDue(ev: WorkEvidence): boolean {
  // proposeAttribution names no cause when nothing adverse happened (needed: false), so this implies `needed`.
  return proposeAttribution(ev).causes.length > 0;
}

/** Derives the overall category, accountability and confidence from a cause list (proposal or validated input). */
export function summarizeCauses(causes: readonly AttributedCause[]): AttributionProposal {
  if (causes.length === 0) return { needed: true, overall: 'UNKNOWN', causes: [], employeeAccountable: false, confidence: 'LOW' };
  const primaries = causes.filter((c) => c.role === 'PRIMARY');
  if (primaries.length !== 1) throw new QandeelError('ATTRIBUTION_INVALID', 'an attribution names exactly one primary cause', { primaries: primaries.length });
  const primary = primaries[0];
  if (primary === undefined) throw new QandeelError('ATTRIBUTION_INVALID', 'an attribution names exactly one primary cause', {});
  const distinct = new Set(causes.map((c) => c.category));
  if (distinct.size !== causes.length) throw new QandeelError('ATTRIBUTION_INVALID', 'a cause category appears once', {});
  const overall: CauseCategory = distinct.size > 1 ? 'MIXED' : primary.category;
  const rank = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
  const confidence = distinct.size > 1 ? (rank[primary.confidence] >= 1 ? 'MEDIUM' : 'LOW') : primary.confidence;
  const employeeAccountable = primary.category === 'EMPLOYEE_JUDGMENT' && primary.confidence !== 'LOW';
  return { needed: true, overall, causes, employeeAccountable, confidence };
}

export function assertCauses(value: unknown): AttributedCause[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > DIRECT_CAUSES.length) throw new QandeelError('ATTRIBUTION_INVALID', 'causes are a non-empty list', { field: 'causes' });
  return value.map((c: unknown, i) => {
    const o = (c ?? {}) as Record<string, unknown>;
    if (!has(DIRECT_CAUSES, o.category) || (o.role !== 'PRIMARY' && o.role !== 'CONTRIBUTING') || !has(CONFIDENCE_LEVELS, o.confidence) || typeof o.basis !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(o.basis)) {
      throw new QandeelError('ATTRIBUTION_INVALID', 'a cause has a category, role, confidence and a basis code', { field: `causes[${i}]` });
    }
    return { category: o.category, role: o.role, confidence: o.confidence, basis: o.basis };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Meta-evaluation: the evaluator is itself evaluated on reference cases.

export interface ReferenceCaseResult {
  readonly id: string;
  readonly kind: ReferenceCaseKind;
  readonly pass: boolean;
  readonly observed: string;
}

export interface CalibrationResult {
  readonly passed: boolean;
  readonly coverage: readonly ReferenceCaseKind[];
  readonly missingKinds: readonly ReferenceCaseKind[];
  readonly cases: readonly ReferenceCaseResult[];
}

function judgeCase(spec: EvalDefinitionSpec, c: ReferenceCase): ReferenceCaseResult {
  const e = evaluateWork(spec, c.evidence);
  const a = proposeAttribution(c.evidence);
  const verdicts = e.dimensions.map((d) => d.verdict);
  const judged = verdicts.some((v) => v === 'POSITIVE' || v === 'NEGATIVE');
  let pass: boolean;
  switch (c.kind) {
    case 'KNOWN_GOOD':
      pass = e.evidenceState === 'SUFFICIENT_EVIDENCE' && e.qualifiedOutcome && !verdicts.includes('NEGATIVE');
      break;
    case 'KNOWN_BAD':
      // Bad work of the Employee: judged negative, and — where no unrecovered system failure explains it — attributed
      // to the Employee's own judgement (a failure the work recovered from never exonerates it; R2-13).
      pass = e.evidenceState === 'SUFFICIENT_EVIDENCE' && !e.qualifiedOutcome && verdicts.includes('NEGATIVE') && (NON_EMPLOYEE_SIGNALS.some((s) => s.present(c.evidence)) || (a.employeeAccountable && a.causes.some((x) => x.role === 'PRIMARY' && x.category === 'EMPLOYEE_JUDGMENT')));
      break;
    case 'AMBIGUOUS':
      // The only correct answer to ambiguous evidence is "not known": no confident verdict either way.
      pass = e.evidenceState !== 'SUFFICIENT_EVIDENCE' && !judged && !e.qualifiedOutcome;
      break;
    case 'NON_EMPLOYEE_CAUSE':
      pass = a.needed && !a.employeeAccountable && a.overall !== 'EMPLOYEE_JUDGMENT';
      break;
    case 'CREATIVE_PATH':
      pass = routeDeviated(c.evidence) && e.qualifiedOutcome && !verdicts.includes('NEGATIVE');
      break;
  }
  return { id: c.id, kind: c.kind, pass, observed: `${e.evidenceState}:${e.qualifiedOutcome ? 'QUALIFIED' : 'UNQUALIFIED'}:${a.overall}` };
}

/** Runs every reference case; a definition calibrates only when it covers every kind and passes every case. */
export function calibrateDefinition(spec: EvalDefinitionSpec, external: ExternalOutcomeContext = NO_EXTERNAL_OUTCOME_SOURCE): CalibrationResult {
  assertEvalDefinition(spec, external);
  if (!EXECUTABLE_EVALUATORS.includes(spec.evaluatorKind)) {
    return { passed: false, coverage: [], missingKinds: [...REFERENCE_CASE_KINDS], cases: [] };
  }
  const cases = spec.referenceCases.map((c) => judgeCase(spec, c));
  const coverage = REFERENCE_CASE_KINDS.filter((k) => spec.referenceCases.some((c) => c.kind === k));
  const missingKinds = REFERENCE_CASE_KINDS.filter((k) => !coverage.includes(k));
  return { passed: missingKinds.length === 0 && cases.every((c) => c.pass), coverage, missingKinds, cases };
}

// ---------------------------------------------------------------------------------------------------------
// A standard reference-case set (callers may use it or supply their own).

const baseEvidence = (id: string): WorkEvidence => ({
  workItemId: `reference-${id}`,
  employeeId: null,
  departmentId: null,
  comparableKey: 'reference',
  riskLevel: 'R1',
  completed: true,
  reviewed: true,
  outcome: 'ACHIEVED',
  review: { pass: 1, fail: 0, uncertain: 0, insufficient: 0, rework: 0, openConflict: false },
  runs: { total: 1, failed: 0, retried: 0 },
  failures: { tool: 0, provider: 0, model: 0, context: 0, external: 0, workflow: 0, requirementChanged: false },
  recoveredFailures: { tool: 0, provider: 0, model: 0, context: 0, workflow: 0 },
  interventions: { escalations: 0, correctEscalations: 0, founder: 0 },
  authorityRefusals: 0,
  gateCatches: 0,
  route: { planned: [], taken: [] },
  cost: { productiveMicros: 1_000, retryMicros: 0, fallbackMicros: 0, escalationMicros: 0, failedChargedMicros: 0, reworkMicros: 0, billedMicros: 1_000 },
  activity: { messages: 1, toolCalls: 1, tokens: 100, runs: 1 },
  evidenceClasses: ['WORK_LINEAGE', 'REVIEW_DECISION', 'OUTCOME_VERIFICATION', 'RUN_TRACE', 'COST_USAGE'],
});

export function standardReferenceCases(): ReferenceCase[] {
  const good = baseEvidence('known-good');
  const bad: WorkEvidence = { ...baseEvidence('known-bad'), outcome: 'NOT_ACHIEVED', reviewed: false, review: { pass: 0, fail: 1, uncertain: 0, insufficient: 0, rework: 1, openConflict: false } };
  const ambiguous: WorkEvidence = { ...baseEvidence('ambiguous'), reviewed: false, outcome: null, review: { pass: 0, fail: 0, uncertain: 1, insufficient: 0, rework: 0, openConflict: false }, evidenceClasses: ['WORK_LINEAGE', 'RUN_TRACE', 'COST_USAGE'] };
  const nonEmployee: WorkEvidence = { ...baseEvidence('tool-failure'), outcome: 'NOT_ACHIEVED', reviewed: false, runs: { total: 2, failed: 2, retried: 1 }, failures: { ...baseEvidence('x').failures, tool: 2 }, review: { pass: 0, fail: 1, uncertain: 0, insufficient: 0, rework: 0, openConflict: false } };
  const creative: WorkEvidence = { ...baseEvidence('creative'), route: { planned: ['research', 'draft', 'review'], taken: ['prototype', 'measure', 'review'] } };
  // R2-13: a transient tool failure the work recovered from (the retry succeeded), then the output failed its review
  // on the merits and the outcome was not achieved — the Employee's judgement, not the tool.
  const recovered: WorkEvidence = { ...bad, workItemId: 'reference-recovered-tool-failure', runs: { total: 3, failed: 1, retried: 1 }, recoveredFailures: { ...baseEvidence('x').recoveredFailures, tool: 1 }, cost: { ...bad.cost, retryMicros: 200, billedMicros: 1_200 } };
  return [
    { id: 'known-good', kind: 'KNOWN_GOOD', evidence: good },
    { id: 'known-bad', kind: 'KNOWN_BAD', evidence: bad },
    { id: 'recovered-tool-failure', kind: 'KNOWN_BAD', evidence: recovered },
    { id: 'ambiguous', kind: 'AMBIGUOUS', evidence: ambiguous },
    { id: 'tool-failure', kind: 'NON_EMPLOYEE_CAUSE', evidence: nonEmployee },
    { id: 'creative-path', kind: 'CREATIVE_PATH', evidence: creative },
  ];
}

/** The Strong-v1 standard work-outcome definition (a starting contract; the registry versions it). */
export function standardWorkOutcomeDefinition(code = 'work-outcome.standard'): EvalDefinitionSpec {
  return {
    code,
    evaluationType: 'WORK_OUTCOME',
    subjectType: 'WORK_ITEM',
    applicability: { roles: [], domains: [] },
    dimensions: [...ITEM_DIMENSIONS],
    requiredEvidence: ['WORK_LINEAGE', 'REVIEW_DECISION', 'OUTCOME_VERIFICATION'],
    evaluatorKind: 'DETERMINISTIC_RULES',
    minimumEvidence: DEFAULT_MINIMUM_EVIDENCE,
    referenceCases: standardReferenceCases(),
  };
}
