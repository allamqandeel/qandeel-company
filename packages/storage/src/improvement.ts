/**
 * ImprovementStore — the C6 Company Improvement Engine over canonical C1–C5 state (Stage 17 + Stage 15
 * reporting). It extends existing mechanisms and duplicates none of them:
 *
 * - the Eval Registry (versioned, provider-independent, self-calibrated) evaluates Work Items from their
 *   durable evidence; the lesson lifecycle, Academy, Review Pool, usage ledger, Goals and Founder Attention
 *   stay the C3 / C4 / C2 / C5 ones;
 * - Founder acts (definitions, activation, outcome verification, attribution decisions, learning
 *   interventions, systemic decisions, failure cases) pass the Founder chokepoint and fail closed outside an
 *   authenticated session; system acts (evaluate, classify, assess, report) derive records from canonical rows
 *   only and change no authority, role, certification, policy or Goal;
 * - a recommendation, a readiness signal or a report is never permission to act.
 *
 * Audit carries ids, states and codes only (Rule A).
 */
import { QandeelError, assertCode, assertId, canonicalJson, isTimestamp, newId, sha256Hex, type Id } from '@qandeel-company/domain';
import {
  EVIDENCE_CLASSES,
  EXTERNAL_OUTCOMES_AVAILABLE,
  assertCauses,
  assertEvalDefinition,
  assertCaseStep,
  assessLearningEffect,
  buildPerformanceProfile,
  calibrateDefinition,
  composeReport,
  costPerQualifiedOutcome,
  detectSystemicCandidates,
  evaluateWork,
  isSmartSuccess,
  learningValidationGate,
  nearMissCodes,
  nextInterventionDecision,
  patternExpansionAllowed,
  proposeAttribution,
  reportPeriod,
  retrainingMaterial,
  reviewerMetaEvaluation,
  summarizeCauses,
  type AttributedCause,
  type CalibrationResult,
  type CaseStage,
  type CompanyReport,
  type CostPerQualifiedOutcome,
  type DirectCause,
  type EvalDefinitionSpec,
  type LearningEffect,
  type LearningKind,
  type LearningSource,
  type PerformanceProfile,
  type ReportCadence,
  type ReportFacts,
  type ReviewerMetaEvaluation,
  type SystemicCandidate,
  type SystemicTarget,
} from '@qandeel-company/mind';

import { founder, founderAdminWrite } from './governance.js';
import { attributionFacts, followupFacts, gatherWorkEvidence, latestVerdict, liveEvaluations, subjectOf, validatedAttributionFacts } from './improvement-core.js';
import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { insertLesson } from './mind-writes.js';
import { txResilienceStatus } from './resilience.js';
import { storeContext, type CompanyStore } from './store.js';
import { applyTransition } from './work-core.js';

export const SYSTEM_EVALUATOR_REF = 'system:evaluator';
export const SYSTEM_REPORTER_REF = 'system:reporter';
export const STANDARD_DEFINITION_CODE = 'work-outcome.standard';

// ---------------------------------------------------------------------------------------------------------
// Records.

export interface EvalDefinitionRecord {
  readonly id: Id;
  readonly code: string;
  readonly defVersion: number;
  readonly status: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'RETIRED';
  readonly evaluatorKind: string;
  readonly spec: EvalDefinitionSpec;
  readonly specSha256: string;
  readonly calibrationRunId: Id | null;
  readonly provenance: string;
  readonly activatedByRef: string | null;
  readonly createdAt: string;
}

export interface CalibrationRunRecord {
  readonly id: Id;
  readonly definitionId: Id;
  readonly passed: boolean;
  readonly coverage: readonly string[];
  readonly results: CalibrationResult['cases'];
  readonly createdAt: string;
}

export interface EvaluationRecord {
  readonly id: Id;
  readonly workItemId: Id;
  readonly employeeId: Id | null;
  readonly departmentId: Id | null;
  readonly definitionId: Id;
  readonly comparableKey: string;
  readonly evidenceState: string;
  readonly qualifiedOutcome: boolean;
  readonly dimensions: readonly { dimension: string; verdict: string; basis: string }[];
  readonly missingEvidence: readonly string[];
  readonly conflicts: readonly string[];
  readonly cost: Record<string, number>;
  readonly observability: Record<string, number>;
  readonly evidenceRefs: readonly string[];
  readonly supersededBy: Id | null;
  readonly createdAt: string;
}

export interface AttributionRecord {
  readonly id: Id;
  readonly workItemId: Id;
  readonly employeeId: Id | null;
  readonly comparableKey: string;
  readonly overall: string;
  readonly causes: readonly AttributedCause[];
  readonly employeeAccountable: boolean;
  readonly confidence: string;
  readonly source: 'EVALUATOR_PROPOSAL' | 'FOUNDER';
  readonly state: 'PROPOSED' | 'VALIDATED' | 'REJECTED' | 'SUPERSEDED';
  readonly decidedByRef: string | null;
  readonly evidenceRefs: readonly string[];
  readonly createdAt: string;
}

export interface LearningSignalRecord {
  readonly id: Id;
  readonly observationId: Id;
  readonly kind: LearningKind;
  readonly source: LearningSource;
  readonly workItemId: Id;
  readonly attributionId: Id | null;
  readonly evaluationId: Id | null;
  readonly codes: readonly string[];
  readonly createdAt: string;
}

export interface InterventionRecord {
  readonly id: Id;
  readonly lessonId: Id;
  readonly employeeId: Id;
  readonly kind: 'TARGETED_RETRAINING' | 'PATTERN_REUSE';
  readonly cycleNo: number;
  readonly targetCause: DirectCause;
  readonly comparableKey: string;
  readonly remediationId: Id | null;
  readonly state: 'PLANNED' | 'TRAINING_COMPLETED' | 'EFFECT_ASSESSED' | 'CANCELLED';
  readonly effect: LearningEffect;
  readonly effectBasis: string | null;
  readonly evidenceRefs: readonly string[];
  readonly trainingCompletedAt: string | null;
  readonly assessedAt: string | null;
}

export interface SystemicFindingRecord {
  readonly id: Id;
  readonly targetKind: SystemicTarget;
  readonly targetRef: string;
  readonly cause: DirectCause;
  readonly origin: 'REPEATED_ATTRIBUTION' | 'RETRAINING_EXHAUSTED';
  readonly occurrences: number;
  readonly distinctEmployees: number;
  readonly evidenceRefs: readonly string[];
  readonly state: 'CANDIDATE' | 'VALIDATED' | 'REJECTED' | 'ADDRESSED';
  readonly recommendationCode: string;
  readonly oversightFindingId: Id | null;
  readonly decidedByRef: string | null;
}

export interface FailureCaseRecord {
  readonly id: Id;
  readonly workItemId: Id;
  readonly attributionId: Id | null;
  readonly comparableKey: string;
  readonly stage: CaseStage;
  readonly hidden: boolean;
  readonly academyScenarioId: Id | null;
  readonly calibrationRunId: Id | null;
}

export interface ReportRecord {
  readonly id: Id;
  readonly cadence: ReportCadence;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly claims: CompanyReport['claims'];
  readonly claimsSha256: string;
  readonly createdAt: string;
}

type Row = Record<string, unknown>;
const s = (v: unknown): string => String(v);
const os = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const j = <T>(v: unknown): T => JSON.parse(String(v)) as T;

const mapDefinition = (r: Row): EvalDefinitionRecord => ({ id: s(r.id) as Id, code: s(r.code), defVersion: Number(r.def_version), status: s(r.status) as EvalDefinitionRecord['status'], evaluatorKind: s(r.evaluator_kind), spec: j(r.spec_json), specSha256: s(r.spec_sha256), calibrationRunId: os(r.calibration_run_id) as Id | null, provenance: s(r.provenance), activatedByRef: os(r.activated_by_ref), createdAt: s(r.created_at) });
const mapRun = (r: Row): CalibrationRunRecord => ({ id: s(r.id) as Id, definitionId: s(r.definition_id) as Id, passed: Number(r.passed) === 1, coverage: j(r.coverage_json), results: j(r.results_json), createdAt: s(r.created_at) });
const mapEvaluation = (r: Row): EvaluationRecord => ({
  id: s(r.id) as Id,
  workItemId: s(r.work_item_id) as Id,
  employeeId: os(r.employee_id) as Id | null,
  departmentId: os(r.department_id) as Id | null,
  definitionId: s(r.definition_id) as Id,
  comparableKey: s(r.comparable_key),
  evidenceState: s(r.evidence_state),
  qualifiedOutcome: Number(r.qualified_outcome) === 1,
  dimensions: j(r.dimensions_json),
  missingEvidence: j(r.missing_json),
  conflicts: j(r.conflicts_json),
  cost: j(r.cost_json),
  observability: j(r.observability_json),
  evidenceRefs: (j<{ refs?: string[] }>(r.evidence_json).refs ?? []),
  supersededBy: os(r.superseded_by) as Id | null,
  createdAt: s(r.created_at),
});
const mapAttribution = (r: Row): AttributionRecord => ({ id: s(r.id) as Id, workItemId: s(r.work_item_id) as Id, employeeId: os(r.employee_id) as Id | null, comparableKey: s(r.comparable_key), overall: s(r.overall), causes: j(r.causes_json), employeeAccountable: Number(r.employee_accountable) === 1, confidence: s(r.confidence), source: s(r.source) as AttributionRecord['source'], state: s(r.state) as AttributionRecord['state'], decidedByRef: os(r.decided_by_ref), evidenceRefs: j(r.evidence_refs_json), createdAt: s(r.created_at) });
const mapSignal = (r: Row): LearningSignalRecord => ({ id: s(r.id) as Id, observationId: s(r.observation_id) as Id, kind: s(r.kind) as LearningKind, source: s(r.source) as LearningSource, workItemId: s(r.work_item_id) as Id, attributionId: os(r.attribution_id) as Id | null, evaluationId: os(r.evaluation_id) as Id | null, codes: j(r.codes_json), createdAt: s(r.created_at) });
const mapIntervention = (r: Row): InterventionRecord => ({ id: s(r.id) as Id, lessonId: s(r.lesson_id) as Id, employeeId: s(r.employee_id) as Id, kind: s(r.kind) as InterventionRecord['kind'], cycleNo: Number(r.cycle_no), targetCause: s(r.target_cause) as DirectCause, comparableKey: s(r.comparable_key), remediationId: os(r.remediation_id) as Id | null, state: s(r.state) as InterventionRecord['state'], effect: s(r.effect) as LearningEffect, effectBasis: os(r.effect_basis), evidenceRefs: j(r.evidence_refs_json), trainingCompletedAt: os(r.training_completed_at), assessedAt: os(r.assessed_at) });
const mapFinding = (r: Row): SystemicFindingRecord => ({ id: s(r.id) as Id, targetKind: s(r.target_kind) as SystemicTarget, targetRef: s(r.target_ref), cause: s(r.cause) as DirectCause, origin: s(r.origin) as SystemicFindingRecord['origin'], occurrences: Number(r.occurrences), distinctEmployees: Number(r.distinct_employees), evidenceRefs: j(r.evidence_refs_json), state: s(r.state) as SystemicFindingRecord['state'], recommendationCode: s(r.recommendation_code), oversightFindingId: os(r.oversight_finding_id) as Id | null, decidedByRef: os(r.decided_by_ref) });
const mapCase = (r: Row): FailureCaseRecord => ({ id: s(r.id) as Id, workItemId: s(r.work_item_id) as Id, attributionId: os(r.attribution_id) as Id | null, comparableKey: s(r.comparable_key), stage: s(r.stage) as CaseStage, hidden: Number(r.hidden) === 1, academyScenarioId: os(r.academy_scenario_id) as Id | null, calibrationRunId: os(r.calibration_run_id) as Id | null });
const mapReport = (r: Row): ReportRecord => ({ id: s(r.id) as Id, cadence: s(r.cadence) as ReportCadence, periodFrom: s(r.period_from), periodTo: s(r.period_to), claims: j(r.claims_json), claimsSha256: s(r.claims_sha256), createdAt: s(r.created_at) });

const present = (row: Row | undefined): Row => {
  if (!row) throw new QandeelError('STORAGE_INVARIANT', 'a row written in this transaction is missing');
  return row;
};

const must = <T>(row: Row | undefined, map: (r: Row) => T, what: string, id: string): T => {
  if (!row) throw new QandeelError('NOT_FOUND', `${what} not found`, { id: id.slice(0, 64) });
  return map(row);
};

// ---------------------------------------------------------------------------------------------------------
// Shared transaction helpers (also used by the C3 learning gates).

function liveAttribution(ctx: StoreContext, workItemId: Id): AttributionRecord | null {
  const r = ctx.db.get(`SELECT * FROM causal_attributions WHERE work_item_id = ? AND state IN ('PROPOSED', 'VALIDATED')`, workItemId);
  return r ? mapAttribution(r) : null;
}

function liveEvaluationRow(ctx: StoreContext, workItemId: Id): EvaluationRecord | null {
  const r = ctx.db.get(`SELECT * FROM evaluation_results WHERE work_item_id = ? AND superseded_by IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`, workItemId);
  return r ? mapEvaluation(r) : null;
}

/**
 * The C6 gate on the C3 lesson lifecycle (validation) — independent evidence decides, never the Employee's
 * interpretation. Called by `MemoryStore.validateLesson` before VALIDATED; the 0010 trigger backs it up.
 */
export function txLearningValidationGate(ctx: StoreContext, lessonId: Id): { allowed: boolean; reason: string } {
  const l = ctx.db.get<{ observation_id: string | null }>('SELECT observation_id FROM lessons WHERE id = ?', lessonId);
  if (!l?.observation_id) return { allowed: true, reason: 'UNCLASSIFIED' };
  const sig = ctx.db.get('SELECT * FROM learning_signals WHERE observation_id = ?', l.observation_id);
  if (!sig) return { allowed: true, reason: 'UNCLASSIFIED' };
  const signal = mapSignal(sig);
  const a = ctx.db.get<{ state: string; employee_accountable: number }>(`SELECT state, employee_accountable FROM causal_attributions WHERE work_item_id = ? AND state = 'VALIDATED'`, signal.workItemId);
  const qualified = ctx.db.get(`SELECT 1 AS x FROM evaluation_results WHERE work_item_id = ? AND qualified_outcome = 1 AND superseded_by IS NULL`, signal.workItemId) !== undefined;
  return learningValidationGate({ source: signal.source, kind: signal.kind, attribution: a ? { state: 'VALIDATED', employeeAccountable: a.employee_accountable === 1 } : null, qualifiedEvaluation: qualified });
}

/** The C6 gate on the C3 promotion lifecycle: a successful pattern is shared only after verified reuse. */
export function txPatternShareGate(ctx: StoreContext, lessonId: Id, target: string): { allowed: boolean; reason: string } {
  const pattern = ctx.db.get(`SELECT 1 AS x FROM lessons l JOIN learning_signals s ON s.observation_id = l.observation_id WHERE l.id = ? AND s.kind = 'SUCCESSFUL_PATTERN'`, lessonId);
  if (!pattern) return { allowed: true, reason: 'NOT_A_PATTERN' };
  const reuses = Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM learning_interventions WHERE lesson_id = ? AND kind = 'PATTERN_REUSE' AND effect = 'IMPROVEMENT_OBSERVED'`, lessonId)?.n ?? 0);
  return patternExpansionAllowed(target, reuses);
}

function attributionHistory(ctx: StoreContext, id: Id, version: number, from: string | null, to: string, reason: string, actor: string): void {
  ctx.db.run('INSERT INTO causal_attribution_history (attribution_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, version, from, to, reason, actor, ts(ctx));
}

function insertAttribution(ctx: StoreContext, f: { workItemId: Id; evaluationId: Id | null; employeeId: Id | null; comparableKey: string; causes: readonly AttributedCause[]; source: 'EVALUATOR_PROPOSAL' | 'FOUNDER'; state: 'PROPOSED' | 'VALIDATED'; actorRef: string; reasonCode: string; evidenceRefs: readonly string[] }): Id {
  const summary = summarizeCauses(f.causes);
  const id = newId();
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO causal_attributions (id, work_item_id, evaluation_id, employee_id, comparable_key, overall, causes_json, employee_accountable, confidence, source, state, proposed_by_ref, decided_by_ref, reason_code, evidence_refs_json, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id, f.workItemId, f.evaluationId, f.employeeId, f.comparableKey, summary.overall, JSON.stringify(summary.causes), summary.employeeAccountable ? 1 : 0, summary.confidence, f.source, f.state, f.actorRef,
    f.state === 'VALIDATED' ? f.actorRef : null, f.state === 'VALIDATED' ? f.reasonCode : null, JSON.stringify(f.evidenceRefs.slice(0, 60)), at, at,
  );
  attributionHistory(ctx, id, 1, null, f.state, f.reasonCode, f.actorRef);
  appendAudit(ctx, f.state === 'VALIDATED' ? 'attribution.validated' : 'attribution.proposed', 'causal_attribution', id, { actorRef: f.actorRef }, 'OK', f.reasonCode, { workItemId: f.workItemId, overall: summary.overall, employeeAccountable: summary.employeeAccountable });
  return id;
}

function setAttributionState(ctx: StoreContext, a: AttributionRecord, to: AttributionRecord['state'], actorRef: string, reasonCode: string): void {
  const version = Number(ctx.db.get<{ v: number }>('SELECT version AS v FROM causal_attributions WHERE id = ?', a.id)?.v ?? 1);
  const decided = to === 'VALIDATED' || to === 'REJECTED';
  ctx.db.run(`UPDATE causal_attributions SET state = ?, decided_by_ref = COALESCE(decided_by_ref, ?), reason_code = COALESCE(reason_code, ?), version = version + 1, updated_at = ? WHERE id = ?`, to, decided ? actorRef : null, decided ? reasonCode : null, ts(ctx), a.id);
  attributionHistory(ctx, a.id, version + 1, a.state, to, reasonCode, actorRef);
  appendAudit(ctx, `attribution.${to.toLowerCase()}`, 'causal_attribution', a.id, { actorRef }, 'OK', reasonCode, { workItemId: a.workItemId });
}

const TARGET_RECOMMENDATION: Record<string, string> = {
  WORKFLOW: 'REVIEW_WORKFLOW_DESIGN',
  SKILL: 'REVIEW_SKILL_TRAINING_AND_FIT',
  TOOL: 'REPAIR_OR_REPLACE_TOOL',
  CONTEXT: 'REPAIR_CONTEXT_RETRIEVAL',
  MODEL_ROUTE: 'REVIEW_MODEL_ROUTE',
  EVALUATOR: 'RECALIBRATE_EVALUATOR',
  REQUIREMENT: 'CLARIFY_REQUIREMENTS',
  POLICY_ASSUMPTION: 'REVISIT_POLICY_ASSUMPTION',
  ROLE_DESIGN: 'REVISIT_ROLE_DESIGN',
  GOAL_DEFINITION: 'REVISIT_GOAL_DEFINITION',
  EXTERNAL_DEPENDENCY: 'REVIEW_EXTERNAL_DEPENDENCY',
};

function upsertSystemic(ctx: StoreContext, c: SystemicCandidate, origin: 'REPEATED_ATTRIBUTION' | 'RETRAINING_EXHAUSTED', actorRef: string): { id: Id; changed: boolean } {
  const key = `${c.targetKind}|${c.targetRef}|${c.cause}`.slice(0, 200);
  const at = ts(ctx);
  const existing = ctx.db.get('SELECT * FROM systemic_findings WHERE dedup_key = ?', key);
  if (existing) {
    const f = mapFinding(existing);
    if (f.state !== 'CANDIDATE' || c.occurrences <= f.occurrences) return { id: f.id, changed: false };
    ctx.db.run('UPDATE systemic_findings SET occurrences = ?, distinct_employees = ?, evidence_refs_json = ?, version = version + 1, updated_at = ? WHERE id = ?', c.occurrences, c.distinctEmployees, JSON.stringify(c.evidenceRefs.slice(0, 100)), at, f.id);
    appendAudit(ctx, 'systemic.evidence_grew', 'systemic_finding', f.id, { actorRef }, 'OK', null, { occurrences: c.occurrences });
    return { id: f.id, changed: true };
  }
  const id = newId();
  ctx.db.run(
    `INSERT INTO systemic_findings (id, dedup_key, target_kind, target_ref, cause, origin, occurrences, distinct_employees, evidence_refs_json, state, recommendation_code, oversight_finding_id, decided_by_ref, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CANDIDATE', ?, NULL, NULL, 1, ?, ?)`,
    id, key, c.targetKind, c.targetRef, c.cause, origin, c.occurrences, c.distinctEmployees, JSON.stringify(c.evidenceRefs.slice(0, 100)), TARGET_RECOMMENDATION[c.targetKind] ?? 'INVESTIGATE', at, at,
  );
  ctx.db.run('INSERT INTO systemic_finding_history (finding_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, ?, ?, ?, ?)', id, 'CANDIDATE', origin, actorRef, at);
  appendAudit(ctx, 'systemic.candidate', 'systemic_finding', id, { actorRef }, 'OK', origin, { targetKind: c.targetKind, cause: c.cause, occurrences: c.occurrences });
  return { id, changed: true };
}

function detectAndRecordSystemic(ctx: StoreContext, actorRef: string): Id[] {
  return detectSystemicCandidates(validatedAttributionFacts(ctx)).map((c) => upsertSystemic(ctx, c, 'REPEATED_ATTRIBUTION', actorRef).id);
}

/** Records a learning signal on an observation (idempotent per observation). */
function signalOn(ctx: StoreContext, f: { observationId: Id; kind: LearningKind; source: LearningSource; workItemId: Id; codes: readonly string[]; actorRef: string }): Id {
  const existing = ctx.db.get<{ id: string }>('SELECT id FROM learning_signals WHERE observation_id = ?', f.observationId);
  if (existing) return existing.id as Id;
  const id = newId();
  const a = liveAttribution(ctx, f.workItemId);
  const e = liveEvaluationRow(ctx, f.workItemId);
  ctx.db.run(
    `INSERT INTO learning_signals (id, observation_id, kind, source, work_item_id, attribution_id, evaluation_id, codes_json, classified_by_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, f.observationId, f.kind, f.source, f.workItemId, a?.id ?? null, e?.id ?? null, JSON.stringify(f.codes.slice(0, 16)), f.actorRef, ts(ctx),
  );
  appendAudit(ctx, 'learning.classified', 'lesson', f.observationId, { actorRef: f.actorRef }, 'OK', f.kind, { source: f.source, workItemId: f.workItemId });
  return id;
}

/** A system observation (candidate-first): the lifecycle stays OBSERVATION until the Founder nominates it. */
function systemObservation(ctx: StoreContext, employeeId: Id, workItemId: Id, kind: LearningKind, topic: string, codes: readonly string[], comparableKey: string): Id {
  const prior = ctx.db.get<{ observation_id: string }>('SELECT observation_id FROM learning_signals WHERE work_item_id = ? AND kind = ?', workItemId, kind);
  if (prior) return prior.observation_id as Id;
  const label = kind === 'SUCCESSFUL_PATTERN' ? 'Smart success (pattern candidate)' : kind === 'NEAR_MISS_WARNING' ? 'Near miss (harm avoided by a gate or review)' : 'Mistake';
  const content = `${label} on comparable work ${comparableKey}: ${codes.join(', ')}. Recorded by the C6 evaluator from Work Item ${workItemId}; candidate learning, not validated.`;
  const observationId = insertLesson(ctx, { employeeId, kind: 'OBSERVATION', observationId: null, eventRef: `work_item:${workItemId}`, topic, claimKey: null, claimValue: null, content, dataClass: 'D1', marketRef: null, candidateId: null });
  signalOn(ctx, { observationId, kind, source: kind === 'NEAR_MISS_WARNING' ? 'GATE_CATCH' : 'EVALUATION', workItemId, codes, actorRef: SYSTEM_EVALUATOR_REF });
  return observationId;
}

// ---------------------------------------------------------------------------------------------------------
// Report facts.

function reportFacts(ctx: StoreContext, cadence: ReportCadence, at: string): ReportFacts {
  const period = reportPeriod(cadence, at);
  const previous = reportPeriod(cadence, period.from);
  const evaluations = liveEvaluations(ctx, { from: period.from, to: period.to });
  const employees = [...new Set(ctx.db.all<{ e: string }>(`SELECT DISTINCT employee_id AS e FROM evaluation_results WHERE employee_id IS NOT NULL AND superseded_by IS NULL ORDER BY employee_id`).map((r) => r.e))] as Id[];
  const profiles = cadence === 'DAILY' || cadence === 'WEEKLY' || cadence === 'MONTHLY' ? employees.map((e) => txProfile(ctx, e, at)) : [];
  const resilience = txResilienceStatus(ctx, at);
  const verifications = ctx.db.all<{ id: string; work_item_id: string; verdict: string }>('SELECT id, work_item_id, verdict FROM outcome_verifications WHERE created_at >= ? AND created_at <= ? ORDER BY created_at, id', period.from, period.to);
  const signals = (kind: LearningKind): string[] =>
    ctx.db.all<{ id: string }>(`SELECT l.id FROM lessons l JOIN learning_signals s ON s.observation_id = l.observation_id WHERE s.kind = ? AND l.stage = 'VALIDATED' AND l.updated_at >= ? AND l.updated_at <= ? ORDER BY l.id`, kind, period.from, period.to).map((r) => r.id);
  const validated = ctx.db.all<{ id: string }>(`SELECT id FROM lessons WHERE stage = 'VALIDATED' AND updated_at >= ? AND updated_at <= ? ORDER BY id`, period.from, period.to).map((r) => r.id);
  const findings = ctx.db.all(`SELECT * FROM systemic_findings WHERE state IN ('CANDIDATE', 'VALIDATED') ORDER BY created_at, id`).map(mapFinding);
  const effects = ctx.db.all<{ id: string; effect: string }>(`SELECT id, effect FROM learning_interventions WHERE assessed_at IS NOT NULL AND assessed_at >= ? AND assessed_at <= ? ORDER BY id`, period.from, period.to).map((r) => ({ interventionId: r.id, effect: r.effect as LearningEffect }));
  const goals = ctx.db.all<{ id: string; state: string }>(`SELECT id, state FROM goals WHERE state IN ('APPROVED', 'ACTIVE', 'PAUSED', 'ACHIEVED') ORDER BY created_at, id`).map((g) => {
    const links = ctx.db.all<{ w: string }>('SELECT work_item_id AS w FROM goal_work_links WHERE goal_id = ? AND ended_at IS NULL', g.id).map((r) => r.w);
    const qualified = links.filter((w) => ctx.db.get(`SELECT 1 AS x FROM evaluation_results WHERE work_item_id = ? AND qualified_outcome = 1 AND superseded_by IS NULL`, w) !== undefined);
    return { goalId: g.id, state: g.state, linked: links.length, qualified: qualified.length, refs: qualified.map((w) => `work_item:${w}`) };
  });
  const gaps = ctx.db.all<{ id: string; employee_id: string }>(`SELECT id, employee_id FROM capability_gaps WHERE state = 'OPEN' ORDER BY created_at, id`);
  const byDept = new Map<string, string[]>();
  for (const g of gaps) {
    const d = ctx.db.get<{ d: string | null }>('SELECT department_id AS d FROM employees WHERE id = ?', g.employee_id)?.d;
    if (d) byDept.set(d, [...(byDept.get(d) ?? []), `capability_gap:${g.id}`]);
  }
  return {
    cadence,
    period,
    verifications: verifications.map((v) => ({ id: v.id, workItemId: v.work_item_id, verdict: v.verdict as 'ACHIEVED' | 'NOT_ACHIEVED' | 'INCONCLUSIVE' })),
    failedWork: ctx.db.all<{ id: string }>(`SELECT id FROM work_items WHERE state = 'FAILED' AND updated_at >= ? AND updated_at <= ? ORDER BY id LIMIT 200`, period.from, period.to).map((r) => r.id),
    deadLetters: ctx.db.all<{ id: string }>(`SELECT id FROM queue_jobs WHERE state = 'DEAD_LETTER' ORDER BY id LIMIT 200`).map((r) => r.id),
    reconciliationHeld: ctx.db.all<{ id: string }>(`SELECT id FROM queue_jobs WHERE state = 'RECONCILIATION_HOLD' ORDER BY id LIMIT 200`).map((r) => r.id),
    decisionsRequired: ctx.db.all<{ id: string }>(`SELECT id FROM founder_attention_items WHERE state = 'OPEN' AND lane = 'NEEDS_ME' ORDER BY first_seen_at, id`).map((r) => r.id),
    resilienceExceptions: resilience.exceptions.filter((x) => cadence !== 'DAILY' || x.material).map((x) => ({ code: x.code, ref: x.ref })),
    goals,
    evaluations,
    previousEvaluations: liveEvaluations(ctx, { from: previous.from, to: previous.to }).filter((e) => e.at < period.from),
    lessons: { validated, patterns: signals('SUCCESSFUL_PATTERN'), nearMisses: signals('NEAR_MISS_WARNING') },
    systemic: findings.map((f) => ({ findingId: f.id, state: f.state, targetKind: f.targetKind, targetRef: f.targetRef, cause: f.cause, occurrences: f.occurrences, distinctEmployees: f.distinctEmployees, evidenceRefs: f.evidenceRefs })),
    effects,
    profiles,
    reviewers: cadence === 'MONTHLY' ? txReviewerCalibration(ctx) : [],
    capabilityGaps: gaps.map((g) => g.id),
    recertificationDue: ctx.db.all<{ id: string }>(`SELECT id FROM certifications WHERE status = 'REVIEW_DUE' ORDER BY id`).map((r) => r.id),
    departmentGaps: [...byDept.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([departmentId, refs]) => ({ departmentId, openGaps: refs.length, refs })),
    minSample: 3,
  };
}

function txProfile(ctx: StoreContext, employeeId: Id, at: string): PerformanceProfile {
  const patterns = ctx.db.all<{ id: string }>(`SELECT l.id FROM lessons l JOIN learning_signals s ON s.observation_id = l.observation_id WHERE s.kind = 'SUCCESSFUL_PATTERN' AND l.stage = 'VALIDATED' AND l.employee_id = ?`, employeeId).map((r) => r.id);
  const reuses = ctx.db.all<{ id: string }>(`SELECT i.id FROM learning_interventions i JOIN lessons l ON l.id = i.lesson_id WHERE i.kind = 'PATTERN_REUSE' AND i.effect = 'IMPROVEMENT_OBSERVED' AND l.employee_id = ?`, employeeId).map((r) => r.id);
  return buildPerformanceProfile({
    employeeId,
    at,
    evaluations: liveEvaluations(ctx, { employeeId }),
    attributions: attributionFacts(ctx, employeeId),
    learningEffects: ctx.db.all<{ id: string; effect: string }>(`SELECT id, effect FROM learning_interventions WHERE employee_id = ? AND kind = 'TARGETED_RETRAINING'`, employeeId).map((r) => ({ interventionId: r.id, effect: r.effect as LearningEffect })),
    contributions: { validatedPatterns: patterns, verifiedPatternReuses: reuses, validatedSystemicFindings: [] },
  });
}

function txReviewerCalibration(ctx: StoreContext): ReviewerMetaEvaluation[] {
  const decisions = ctx.db
    .all<{ id: string; qualification_id: string; work_item_id: string; outcome: string; counts: number; created_at: string; request_id: string }>(
      `SELECT d.id, d.qualification_id, r.work_item_id, d.outcome, d.counts, d.created_at, d.request_id FROM review_decisions d JOIN review_requests r ON r.id = d.request_id WHERE d.qualification_id IS NOT NULL ORDER BY d.created_at, d.id`,
    )
    .map((d) => {
      const v = latestVerdict(ctx, d.work_item_id as Id);
      const overturned = d.outcome === 'FAIL' && ctx.db.get(`SELECT 1 AS x FROM review_conflicts WHERE request_id = ? AND state = 'RESOLVED' AND resolution = 'PASS'`, d.request_id) !== undefined;
      return { decisionId: d.id, qualificationId: d.qualification_id, workItemId: d.work_item_id, outcome: d.outcome as 'PASS', counts: d.counts === 1, at: d.created_at, laterOutcome: v === null || v.verdict === 'INCONCLUSIVE' ? null : v.verdict, overturned };
    });
  const calibrations = ctx.db.all<{ qualification_id: string; signal: string; created_at: string }>('SELECT qualification_id, signal, created_at FROM review_calibrations ORDER BY created_at').map((c) => ({ qualificationId: c.qualification_id, signal: c.signal as 'AGREE' | 'DISAGREE', at: c.created_at }));
  return reviewerMetaEvaluation(decisions, calibrations);
}

// ---------------------------------------------------------------------------------------------------------

export class ImprovementStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): ImprovementStore {
    return new ImprovementStore(store);
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  #system<T>(operation: string, fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.immediate(operation, () => fn(ctx));
  }

  #admin<T>(operation: string, actorRef: string, fn: (ctx: StoreContext) => T): T {
    return founderAdminWrite(this.#store, operation, actorRef, fn);
  }

  // --- Eval Registry ---------------------------------------------------------------------------------

  /** Registers a new version of a definition (DRAFT until calibrated and activated). */
  registerDefinition(actorRef: string, spec: EvalDefinitionSpec, options: { provenance?: string } = {}): EvalDefinitionRecord {
    return this.#admin('register eval definition', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'eval registry');
      assertEvalDefinition(spec);
      const text = canonicalJson(spec);
      if (text.length > 65_536) throw new QandeelError('EVAL_INVALID', 'eval definition is too large', { field: 'spec' });
      const version = Number(ctx.db.get<{ v: number | null }>('SELECT MAX(def_version) AS v FROM eval_definitions WHERE code = ?', spec.code)?.v ?? 0) + 1;
      const id = newId();
      const at = ts(ctx);
      ctx.db.run(
        `INSERT INTO eval_definitions (id, code, def_version, evaluation_type, subject_type, evaluator_kind, spec_json, spec_sha256, status, calibration_run_id, provenance, review_at, created_by_ref, activated_by_ref, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', NULL, ?, NULL, ?, NULL, 1, ?, ?)`,
        id, spec.code, version, spec.evaluationType, spec.subjectType, spec.evaluatorKind, text, sha256Hex(text), assertCode(options.provenance ?? 'founder.registered', 'provenance'), p.ref, at, at,
      );
      ctx.db.run('INSERT INTO eval_definition_history (definition_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, ?, ?, ?, ?)', id, 'DRAFT', 'eval.registered', p.ref, at);
      appendAudit(ctx, 'eval.registered', 'eval_definition', id, { actorRef: p.ref }, 'OK', null, { code: spec.code, defVersion: version, evaluatorKind: spec.evaluatorKind });
      return mapDefinition(present(ctx.db.get('SELECT * FROM eval_definitions WHERE id = ?', id)));
    });
  }

  /** Runs the definition's reference cases through its evaluator (meta-evaluation) and records the run. */
  calibrateDefinition(actorRef: string, definitionId: string): CalibrationRunRecord {
    return this.#admin('calibrate eval definition', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'eval calibration');
      const d = must(ctx.db.get('SELECT * FROM eval_definitions WHERE id = ?', assertId(definitionId, 'definitionId')), mapDefinition, 'eval definition', definitionId);
      const result = calibrateDefinition(d.spec);
      const id = newId();
      ctx.db.run(`INSERT INTO eval_calibration_runs (id, definition_id, spec_sha256, passed, coverage_json, results_json, actor_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, d.id, d.specSha256, result.passed ? 1 : 0, JSON.stringify(result.coverage), JSON.stringify(result.cases), p.ref, ts(ctx));
      appendAudit(ctx, 'eval.calibrated', 'eval_definition', d.id, { actorRef: p.ref }, result.passed ? 'OK' : 'REJECTED', result.passed ? 'CALIBRATION_PASSED' : 'CALIBRATION_FAILED', { runId: id, cases: result.cases.length, missingKinds: result.missingKinds.length });
      return mapRun(present(ctx.db.get('SELECT * FROM eval_calibration_runs WHERE id = ?', id)));
    });
  }

  /** Activates a calibrated DRAFT (the previous active version of the code is superseded). */
  activateDefinition(actorRef: string, definitionId: string, calibrationRunId: string, reasonCode = 'eval.activated'): EvalDefinitionRecord {
    return this.#admin('activate eval definition', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'eval activation');
      const d = must(ctx.db.get('SELECT * FROM eval_definitions WHERE id = ?', assertId(definitionId, 'definitionId')), mapDefinition, 'eval definition', definitionId);
      const run = must(ctx.db.get('SELECT * FROM eval_calibration_runs WHERE id = ?', assertId(calibrationRunId, 'calibrationRunId')), mapRun, 'calibration run', calibrationRunId);
      if (d.status !== 'DRAFT') throw new QandeelError('INVALID_TRANSITION', 'only a draft definition is activated', { definitionId: d.id, status: d.status });
      if (run.definitionId !== d.id || !run.passed) throw new QandeelError('EVAL_INVALID', 'a definition is activated only on its own passed calibration', { definitionId: d.id, reason: 'CALIBRATION_NOT_PASSED' });
      const reason = assertCode(reasonCode, 'reasonCode');
      const at = ts(ctx);
      const prior = ctx.db.get(`SELECT * FROM eval_definitions WHERE code = ? AND status = 'ACTIVE'`, d.code);
      if (prior) {
        const pr = mapDefinition(prior);
        const pv = Number(ctx.db.get<{ v: number }>('SELECT version AS v FROM eval_definitions WHERE id = ?', pr.id)?.v);
        ctx.db.run(`UPDATE eval_definitions SET status = 'SUPERSEDED', version = version + 1, updated_at = ? WHERE id = ?`, at, pr.id);
        ctx.db.run('INSERT INTO eval_definition_history (definition_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', pr.id, pv + 1, 'ACTIVE', 'SUPERSEDED', reason, p.ref, at);
      }
      const v = Number(ctx.db.get<{ v: number }>('SELECT version AS v FROM eval_definitions WHERE id = ?', d.id)?.v);
      ctx.db.run(`UPDATE eval_definitions SET status = 'ACTIVE', calibration_run_id = ?, activated_by_ref = ?, version = version + 1, updated_at = ? WHERE id = ?`, run.id, p.ref, at, d.id);
      ctx.db.run('INSERT INTO eval_definition_history (definition_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', d.id, v + 1, 'DRAFT', 'ACTIVE', reason, p.ref, at);
      appendAudit(ctx, 'eval.activated', 'eval_definition', d.id, { actorRef: p.ref }, 'OK', reason, { code: d.code, runId: run.id });
      return mapDefinition(present(ctx.db.get('SELECT * FROM eval_definitions WHERE id = ?', d.id)));
    });
  }

  retireDefinition(actorRef: string, definitionId: string, reasonCode: string): EvalDefinitionRecord {
    return this.#admin('retire eval definition', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'eval registry');
      const d = must(ctx.db.get('SELECT * FROM eval_definitions WHERE id = ?', assertId(definitionId, 'definitionId')), mapDefinition, 'eval definition', definitionId);
      if (d.status === 'RETIRED' || d.status === 'SUPERSEDED') return d;
      const v = Number(ctx.db.get<{ v: number }>('SELECT version AS v FROM eval_definitions WHERE id = ?', d.id)?.v);
      ctx.db.run(`UPDATE eval_definitions SET status = 'RETIRED', version = version + 1, updated_at = ? WHERE id = ?`, ts(ctx), d.id);
      ctx.db.run('INSERT INTO eval_definition_history (definition_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', d.id, v + 1, d.status, 'RETIRED', assertCode(reasonCode, 'reasonCode'), p.ref, ts(ctx));
      appendAudit(ctx, 'eval.retired', 'eval_definition', d.id, { actorRef: p.ref }, 'OK', reasonCode, {});
      return mapDefinition(present(ctx.db.get('SELECT * FROM eval_definitions WHERE id = ?', d.id)));
    });
  }

  definitions(filter: { code?: string; status?: EvalDefinitionRecord['status'] } = {}): EvalDefinitionRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM eval_definitions ORDER BY code, def_version').map(mapDefinition).filter((d) => (filter.code === undefined || d.code === filter.code) && (filter.status === undefined || d.status === filter.status)));
  }

  calibrationRuns(definitionId: Id): CalibrationRunRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM eval_calibration_runs WHERE definition_id = ? ORDER BY created_at, id', definitionId).map(mapRun));
  }

  // --- Outcome verification (Completed != Reviewed != Outcome Verified) -----------------------------------

  verifyOutcome(actorRef: string, workItemId: string, input: { verdict: 'ACHIEVED' | 'NOT_ACHIEVED' | 'INCONCLUSIVE'; evidenceClasses: readonly string[]; evidenceRefs: readonly string[]; reasonCode: string }): { verificationId: Id; state: string } {
    return this.#admin('verify outcome', actorRef, (ctx) => {
      const w = getWorkItemRow(ctx, assertId(workItemId, 'workItemId'));
      const subject = subjectOf(ctx, w.id);
      const p = founder(ctx, actorRef, subject.employeeId ? `employee:${subject.employeeId}` : null, 'outcome verification');
      if (!['ACHIEVED', 'NOT_ACHIEVED', 'INCONCLUSIVE'].includes(input.verdict)) throw new QandeelError('VALIDATION_FAILED', 'verdict is ACHIEVED, NOT_ACHIEVED or INCONCLUSIVE', { field: 'verdict' });
      const classes = [...new Set(input.evidenceClasses)];
      if (classes.length === 0 || !classes.every((c) => (EVIDENCE_CLASSES as readonly string[]).includes(c))) throw new QandeelError('EVIDENCE_REQUIRED', 'an outcome verification names its evidence classes', { field: 'evidenceClasses' });
      if (classes.includes('EXTERNAL_OUTCOME') && !EXTERNAL_OUTCOMES_AVAILABLE) throw new QandeelError('EVIDENCE_REQUIRED', 'external outcomes are unavailable until a governed source exists (C7)', { reason: 'EXTERNAL_OUTCOME_UNAVAILABLE' });
      const refs = [...new Set(input.evidenceRefs)];
      if (refs.length === 0 || refs.length > 50 || !refs.every((r) => typeof r === 'string' && /^[a-z_]{2,32}:[A-Za-z0-9._:-]{1,96}$/.test(r))) throw new QandeelError('EVIDENCE_REQUIRED', 'an outcome verification cites its evidence records', { field: 'evidenceRefs' });
      if (!['REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'].includes(w.state)) throw new QandeelError('INVALID_TRANSITION', 'an outcome is verified only after independent review (completion is not success)', { workItemId: w.id, state: w.state, reason: 'NOT_REVIEWED' });
      if (input.verdict !== 'INCONCLUSIVE' && w.state !== 'REVIEWED') throw new QandeelError('INVALID_TRANSITION', 'this Work Item already has its verified outcome', { workItemId: w.id, state: w.state });
      const reason = assertCode(input.reasonCode, 'reasonCode');
      const id = newId();
      ctx.db.run(`INSERT INTO outcome_verifications (id, work_item_id, verdict, evidence_classes_json, evidence_refs_json, verifier_ref, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, w.id, input.verdict, JSON.stringify(classes), JSON.stringify(refs), p.ref, reason, ts(ctx));
      let state: string = w.state;
      if (input.verdict === 'ACHIEVED') state = applyTransition(ctx, w, 'OUTCOME_VERIFIED', { reasonCode: 'outcome.verified', outcome: 'ACHIEVED', trace: { correlationId: w.correlationId, actorRef: p.ref } }).state;
      if (input.verdict === 'NOT_ACHIEVED') state = applyTransition(ctx, w, 'CLOSED', { reasonCode: 'outcome.not_achieved', outcome: 'NOT_ACHIEVED', trace: { correlationId: w.correlationId, actorRef: p.ref } }).state;
      appendAudit(ctx, 'outcome.verified', 'work_item', w.id, { actorRef: p.ref }, 'OK', reason, { verificationId: id, verdict: input.verdict, evidenceClasses: classes.length });
      return { verificationId: id, state };
    });
  }

  // --- Evaluation (system) ----------------------------------------------------------------------------

  /**
   * Evaluates one Work Item under the ACTIVE definition of `definitionCode`. Idempotent: unchanged evidence
   * returns the live result (`changed: false`); changed evidence supersedes it. Also proposes an attribution
   * for an adverse outcome and records candidate-first learning signals (smart success, near miss).
   */
  evaluate(workItemId: string, options: { definitionCode?: string } = {}): { evaluation: EvaluationRecord; changed: boolean; attributionId: Id | null; signals: Id[] } {
    return this.#system('evaluate work item', (ctx) => {
      const wid = assertId(workItemId, 'workItemId');
      const code = options.definitionCode ?? STANDARD_DEFINITION_CODE;
      const defRow = ctx.db.get(`SELECT * FROM eval_definitions WHERE code = ? AND status = 'ACTIVE'`, code);
      if (!defRow) throw new QandeelError('EVAL_INVALID', 'no active, calibrated eval definition for this code', { code: code.slice(0, 64), reason: 'NO_ACTIVE_DEFINITION' });
      const def = mapDefinition(defRow);
      const { evidence, refs } = gatherWorkEvidence(ctx, wid);
      const evidenceText = canonicalJson({ evidence, refs });
      const evidenceSha = sha256Hex(evidenceText);
      const live = ctx.db.get(`SELECT * FROM evaluation_results WHERE work_item_id = ? AND definition_id = ? AND superseded_by IS NULL`, wid, def.id);
      if (live && s(live.evidence_sha256) === evidenceSha) return { evaluation: mapEvaluation(live), changed: false, attributionId: liveAttribution(ctx, wid)?.id ?? null, signals: [] };
      const outcome = evaluateWork(def.spec, evidence);
      const id = newId();
      const at = ts(ctx);
      if (live) ctx.db.run('UPDATE evaluation_results SET superseded_by = ? WHERE id = ?', id, s(live.id));
      ctx.db.run(
        `INSERT INTO evaluation_results (id, work_item_id, employee_id, department_id, definition_id, comparable_key, risk_level, evidence_state, qualified_outcome, dimensions_json, missing_json, conflicts_json, cost_json, observability_json, evidence_json, evidence_sha256, evaluator_ref, superseded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        id, wid, evidence.employeeId, evidence.departmentId, def.id, evidence.comparableKey, evidence.riskLevel, outcome.evidenceState, outcome.qualifiedOutcome ? 1 : 0, JSON.stringify(outcome.dimensions), JSON.stringify(outcome.missingEvidence), JSON.stringify(outcome.conflicts),
        JSON.stringify(evidence.cost), JSON.stringify(evidence.activity), JSON.stringify({ refs, classes: evidence.evidenceClasses }), evidenceSha, SYSTEM_EVALUATOR_REF, at,
      );
      appendAudit(ctx, 'evaluation.recorded', 'evaluation', id, { actorRef: SYSTEM_EVALUATOR_REF }, 'OK', outcome.evidenceState, { workItemId: wid, qualified: outcome.qualifiedOutcome, definitionId: def.id });
      // Attribution: proposed from evidence when something went wrong; validated only by an independent decision.
      let attributionId: Id | null;
      const proposal = proposeAttribution(evidence);
      const current = liveAttribution(ctx, wid);
      if (proposal.needed && proposal.causes.length > 0) {
        if (current === null) attributionId = insertAttribution(ctx, { workItemId: wid, evaluationId: id, employeeId: evidence.employeeId as Id | null, comparableKey: evidence.comparableKey, causes: proposal.causes, source: 'EVALUATOR_PROPOSAL', state: 'PROPOSED', actorRef: SYSTEM_EVALUATOR_REF, reasonCode: 'evaluator.proposed', evidenceRefs: refs });
        else if (current.state === 'PROPOSED' && canonicalJson(current.causes) !== canonicalJson(proposal.causes)) {
          setAttributionState(ctx, current, 'SUPERSEDED', SYSTEM_EVALUATOR_REF, 'evidence.changed');
          attributionId = insertAttribution(ctx, { workItemId: wid, evaluationId: id, employeeId: evidence.employeeId as Id | null, comparableKey: evidence.comparableKey, causes: proposal.causes, source: 'EVALUATOR_PROPOSAL', state: 'PROPOSED', actorRef: SYSTEM_EVALUATOR_REF, reasonCode: 'evaluator.reproposed', evidenceRefs: refs });
        } else attributionId = current.id;
      } else if (current !== null && current.state === 'PROPOSED' && !proposal.needed) {
        // Nothing adverse remains (e.g. reworked and verified): an unvalidated proposal must not stay decidable.
        setAttributionState(ctx, current, 'SUPERSEDED', SYSTEM_EVALUATOR_REF, 'evidence.not_adverse');
        attributionId = null;
      } else attributionId = current?.id ?? null;
      // Candidate-first learning signals (never validated here).
      const signals: Id[] = [];
      if (evidence.employeeId !== null && outcome.evidenceState === 'SUFFICIENT_EVIDENCE') {
        const verdicts = Object.fromEntries(outcome.dimensions.map((d) => [d.dimension, d.verdict]));
        if (isSmartSuccess({ qualifiedOutcome: outcome.qualifiedOutcome, verdicts })) {
          const codes = outcome.dimensions.filter((d) => d.verdict === 'POSITIVE').map((d) => d.basis);
          signals.push(systemObservation(ctx, evidence.employeeId as Id, wid, 'SUCCESSFUL_PATTERN', 'c6.successful-pattern', codes, evidence.comparableKey));
        }
        const near = nearMissCodes(evidence);
        if (near.length > 0 && evidence.outcome === 'ACHIEVED') signals.push(systemObservation(ctx, evidence.employeeId as Id, wid, 'NEAR_MISS_WARNING', 'c6.near-miss', near, evidence.comparableKey));
      }
      return { evaluation: mapEvaluation(present(ctx.db.get('SELECT * FROM evaluation_results WHERE id = ?', id))), changed: true, attributionId, signals };
    });
  }

  evaluation(workItemId: Id): EvaluationRecord | null {
    return this.#read((ctx) => liveEvaluationRow(ctx, workItemId));
  }

  evaluations(filter: { employeeId?: Id; departmentId?: Id; live?: boolean } = {}): EvaluationRecord[] {
    return this.#read((ctx) =>
      ctx.db
        .all('SELECT * FROM evaluation_results ORDER BY created_at, id LIMIT 5000')
        .map(mapEvaluation)
        .filter((e) => (filter.employeeId === undefined || e.employeeId === filter.employeeId) && (filter.departmentId === undefined || e.departmentId === filter.departmentId) && (filter.live === false || e.supersededBy === null)),
    );
  }

  // --- Causal attribution (Founder validation; the subject Employee never decides their own cause) -------

  decideAttribution(actorRef: string, attributionId: string, input: { decision: 'VALIDATE' | 'REJECT'; reasonCode: string; causes?: readonly unknown[] }): { attribution: AttributionRecord; systemicFindings: Id[] } {
    return this.#admin('decide attribution', actorRef, (ctx) => {
      const a = must(ctx.db.get('SELECT * FROM causal_attributions WHERE id = ?', assertId(attributionId, 'attributionId')), mapAttribution, 'attribution', attributionId);
      const p = founder(ctx, actorRef, a.employeeId ? `employee:${a.employeeId}` : null, 'causal attribution');
      if (a.state !== 'PROPOSED') throw new QandeelError('INVALID_TRANSITION', 'only a proposed attribution is decided', { attributionId: a.id, state: a.state });
      const reason = assertCode(input.reasonCode, 'reasonCode');
      let decided: Id = a.id;
      if (input.decision === 'REJECT') setAttributionState(ctx, a, 'REJECTED', p.ref, reason);
      else if (input.causes !== undefined) {
        // The Founder corrects the causes: the proposal is superseded by the Founder's validated attribution.
        const causes = assertCauses(input.causes);
        setAttributionState(ctx, a, 'SUPERSEDED', p.ref, reason);
        decided = insertAttribution(ctx, { workItemId: a.workItemId, evaluationId: null, employeeId: a.employeeId, comparableKey: a.comparableKey, causes, source: 'FOUNDER', state: 'VALIDATED', actorRef: p.ref, reasonCode: reason, evidenceRefs: a.evidenceRefs });
      } else setAttributionState(ctx, a, 'VALIDATED', p.ref, reason);
      const systemic = input.decision === 'VALIDATE' ? detectAndRecordSystemic(ctx, SYSTEM_EVALUATOR_REF) : [];
      return { attribution: mapAttribution(present(ctx.db.get('SELECT * FROM causal_attributions WHERE id = ?', decided))), systemicFindings: systemic };
    });
  }

  attributions(filter: { workItemId?: Id; employeeId?: Id; state?: AttributionRecord['state'] } = {}): AttributionRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM causal_attributions ORDER BY created_at, id').map(mapAttribution).filter((a) => (filter.workItemId === undefined || a.workItemId === filter.workItemId) && (filter.employeeId === undefined || a.employeeId === filter.employeeId) && (filter.state === undefined || a.state === filter.state)));
  }

  // --- Learning signals ---------------------------------------------------------------------------------

  /**
   * Classifies a recorded observation (C3) as mistake / successful pattern / near miss. An observation the
   * Employee submitted from their own run is a REFLECTION: a hypothesis the validation gate will not accept
   * without independent evidence.
   */
  classifyObservation(observationId: string, kind: LearningKind, actorRef = SYSTEM_EVALUATOR_REF): LearningSignalRecord {
    return this.#system('classify observation', (ctx) => {
      const o = ctx.db.get<{ id: string; kind: string; event_ref: string; candidate_id: string | null }>('SELECT id, kind, event_ref, candidate_id FROM lessons WHERE id = ?', assertId(observationId, 'observationId'));
      if (!o || o.kind !== 'OBSERVATION') throw new QandeelError('NOT_FOUND', 'observation not found', { observationId: String(observationId).slice(0, 64) });
      if (!['MISTAKE_LESSON', 'SUCCESSFUL_PATTERN', 'NEAR_MISS_WARNING'].includes(kind)) throw new QandeelError('VALIDATION_FAILED', 'unknown learning kind', { field: 'kind' });
      const m = /^work_item:([0-9a-f-]{36})$/.exec(o.event_ref);
      if (!m) throw new QandeelError('LEARNING_GATE', 'only work-derived observations are classified', { reason: 'NOT_WORK_DERIVED' });
      const source: LearningSource = o.candidate_id !== null ? 'REFLECTION' : 'ATTRIBUTION';
      const id = signalOn(ctx, { observationId: o.id as Id, kind, source, workItemId: m[1] as Id, codes: [], actorRef: assertCode(actorRef.replace(/[^a-z0-9:._-]/gi, '').slice(0, 64) || 'system', 'actorRef') });
      return mapSignal(present(ctx.db.get('SELECT * FROM learning_signals WHERE id = ?', id)));
    });
  }

  signals(filter: { workItemId?: Id; kind?: LearningKind } = {}): LearningSignalRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM learning_signals ORDER BY created_at, id').map(mapSignal).filter((x) => (filter.workItemId === undefined || x.workItemId === filter.workItemId) && (filter.kind === undefined || x.kind === filter.kind)));
  }

  learningGate(lessonId: Id): { allowed: boolean; reason: string } {
    return this.#read((ctx) => txLearningValidationGate(ctx, lessonId));
  }

  // --- Learning interventions and their verified effect --------------------------------------------------

  planIntervention(actorRef: string, lessonId: string, input: { kind: 'TARGETED_RETRAINING' | 'PATTERN_REUSE'; employeeId?: string; comparableKey?: string; remediationId?: string }): { outcome: 'PLANNED' | 'AWAIT_EVIDENCE' | 'ESCALATED_SYSTEMIC'; intervention: InterventionRecord | null; findingId: Id | null } {
    return this.#admin('plan learning intervention', actorRef, (ctx) => {
      const l = ctx.db.get<{ id: string; employee_id: string; stage: string; observation_id: string | null }>('SELECT id, employee_id, stage, observation_id FROM lessons WHERE id = ?', assertId(lessonId, 'lessonId'));
      if (!l) throw new QandeelError('NOT_FOUND', 'lesson not found', { lessonId: String(lessonId).slice(0, 64) });
      const p = founder(ctx, actorRef, null, 'learning intervention');
      if (l.stage !== 'VALIDATED') throw new QandeelError('LEARNING_GATE', 'an intervention follows a validated lesson', { lessonId: l.id, reason: 'LESSON_NOT_VALIDATED' });
      const sig = l.observation_id ? ctx.db.get('SELECT * FROM learning_signals WHERE observation_id = ?', l.observation_id) : undefined;
      const signal = sig ? mapSignal(sig) : null;
      const attr = signal ? ctx.db.get(`SELECT * FROM causal_attributions WHERE work_item_id = ? AND state = 'VALIDATED'`, signal.workItemId) : undefined;
      const attribution = attr ? mapAttribution(attr) : null;
      const targetCause: DirectCause = (attribution?.causes.find((c) => c.role === 'PRIMARY')?.category ?? 'EMPLOYEE_JUDGMENT') as DirectCause;
      const comparableKey = (input.comparableKey ?? attribution?.comparableKey ?? (signal ? liveEvaluationRow(ctx, signal.workItemId)?.comparableKey : undefined) ?? 'unclassified').slice(0, 96);
      const employeeId = assertId(input.employeeId ?? l.employee_id, 'employeeId');
      if (input.kind === 'PATTERN_REUSE' && signal?.kind !== 'SUCCESSFUL_PATTERN') throw new QandeelError('LEARNING_GATE', 'only a validated successful pattern is reused', { lessonId: l.id, reason: 'NOT_A_PATTERN' });
      if (input.kind === 'TARGETED_RETRAINING') {
        const prior = ctx.db.all<{ effect: string }>(`SELECT effect FROM learning_interventions WHERE lesson_id = ? AND kind = 'TARGETED_RETRAINING' AND state <> 'CANCELLED' ORDER BY cycle_no`, l.id).map((r) => r.effect as LearningEffect);
        const decision = nextInterventionDecision(prior);
        if (decision.decision === 'AWAIT_EVIDENCE') return { outcome: 'AWAIT_EVIDENCE' as const, intervention: null, findingId: null };
        if (decision.decision === 'ESCALATE_SYSTEMIC') {
          const f = upsertSystemic(ctx, { targetKind: 'SKILL', targetRef: comparableKey, cause: targetCause, occurrences: prior.length, distinctEmployees: 1, evidenceRefs: [`lesson:${l.id}`, ...ctx.db.all<{ id: string }>('SELECT id FROM learning_interventions WHERE lesson_id = ?', l.id).map((r) => `learning_intervention:${r.id}`)] }, 'RETRAINING_EXHAUSTED', p.ref);
          return { outcome: 'ESCALATED_SYSTEMIC' as const, intervention: null, findingId: f.id };
        }
      }
      const remediation = input.remediationId === undefined ? null : assertId(input.remediationId, 'remediationId');
      const baseline = followupFacts(ctx, employeeId, comparableKey).map((f) => f.evaluationId);
      const cycle = Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM learning_interventions WHERE lesson_id = ? AND kind = ?', l.id, input.kind)?.n ?? 0) + 1;
      const id = newId();
      const at = ts(ctx);
      ctx.db.run(
        `INSERT INTO learning_interventions (id, lesson_id, employee_id, kind, cycle_no, target_cause, comparable_key, remediation_id, baseline_json, state, effect, effect_basis, evidence_refs_json, training_completed_at, assessed_at, created_by_ref, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', 'NOT_YET_TESTED', NULL, '[]', NULL, NULL, ?, 1, ?, ?)`,
        id, l.id, employeeId, input.kind, cycle, targetCause, comparableKey, remediation, JSON.stringify(baseline.slice(0, 100)), p.ref, at, at,
      );
      ctx.db.run('INSERT INTO learning_intervention_history (intervention_id, version, state, effect, reason_code, actor_ref, occurred_at) VALUES (?, 1, ?, ?, ?, ?, ?)', id, 'PLANNED', 'NOT_YET_TESTED', 'intervention.planned', p.ref, at);
      appendAudit(ctx, 'learning.intervention_planned', 'learning_intervention', id, { actorRef: p.ref }, 'OK', input.kind, { lessonId: l.id, cycle });
      return { outcome: 'PLANNED' as const, intervention: mapIntervention(present(ctx.db.get('SELECT * FROM learning_interventions WHERE id = ?', id))), findingId: null };
    });
  }

  /** The training (or the reuse) is done. Its effect is still unknown: that needs later comparable evidence. */
  completeTraining(actorRef: string, interventionId: string, reasonCode = 'training.completed'): InterventionRecord {
    return this.#admin('complete intervention training', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'learning intervention');
      const i = must(ctx.db.get('SELECT * FROM learning_interventions WHERE id = ?', assertId(interventionId, 'interventionId')), mapIntervention, 'intervention', interventionId);
      if (i.state !== 'PLANNED') throw new QandeelError('INVALID_TRANSITION', 'only a planned intervention completes its training', { interventionId: i.id, state: i.state });
      if (i.remediationId !== null) {
        const r = ctx.db.get<{ state: string }>('SELECT state FROM academy_remediations WHERE id = ?', i.remediationId);
        if (r?.state !== 'RETESTED' && r?.state !== 'RETEST_READY') throw new QandeelError('LEARNING_GATE', 'the linked Academy remediation has not completed its retraining', { interventionId: i.id, reason: 'REMEDIATION_NOT_COMPLETE' });
      }
      const at = ts(ctx);
      ctx.db.run(`UPDATE learning_interventions SET state = 'TRAINING_COMPLETED', training_completed_at = ?, version = version + 1, updated_at = ? WHERE id = ?`, at, at, i.id);
      ctx.db.run('INSERT INTO learning_intervention_history (intervention_id, version, state, effect, reason_code, actor_ref, occurred_at) SELECT id, version, state, effect, ?, ?, ? FROM learning_interventions WHERE id = ?', assertCode(reasonCode, 'reasonCode'), p.ref, at, i.id);
      appendAudit(ctx, 'learning.training_completed', 'learning_intervention', i.id, { actorRef: p.ref }, 'OK', reasonCode, {});
      return mapIntervention(present(ctx.db.get('SELECT * FROM learning_interventions WHERE id = ?', i.id)));
    });
  }

  /** Judges an intervention on comparable work after its training (system; idempotent). */
  assessIntervention(interventionId: string): { intervention: InterventionRecord; changed: boolean; findingId: Id | null } {
    return this.#system('assess intervention', (ctx) => {
      const i = must(ctx.db.get('SELECT * FROM learning_interventions WHERE id = ?', assertId(interventionId, 'interventionId')), mapIntervention, 'intervention', interventionId);
      if (i.state === 'CANCELLED' || ['IMPROVEMENT_OBSERVED', 'NO_IMPROVEMENT', 'REGRESSION'].includes(i.effect)) return { intervention: i, changed: false, findingId: null };
      const all = followupFacts(ctx, i.employeeId, i.comparableKey);
      const baselineIds = new Set(j<string[]>(ctx.db.get<{ b: string }>('SELECT baseline_json AS b FROM learning_interventions WHERE id = ?', i.id)?.b ?? '[]'));
      const out = assessLearningEffect({ trainingCompletedAt: i.trainingCompletedAt, targetCause: i.targetCause, comparableKey: i.comparableKey, baseline: all.filter((f) => baselineIds.has(f.evaluationId)), followups: all.filter((f) => !baselineIds.has(f.evaluationId)) });
      // Not yet testable is never news, and an assessed (INCONCLUSIVE) intervention is never regressed to untested.
      if (out.effect === 'NOT_YET_TESTED') return { intervention: i, changed: false, findingId: null };
      if (out.effect === i.effect && canonicalJson(out.evidenceRefs) === canonicalJson(i.evidenceRefs)) return { intervention: i, changed: false, findingId: null };
      const at = ts(ctx);
      ctx.db.run(`UPDATE learning_interventions SET effect = ?, effect_basis = ?, evidence_refs_json = ?, state = 'EFFECT_ASSESSED', assessed_at = ?, version = version + 1, updated_at = ? WHERE id = ?`, out.effect, out.basis, JSON.stringify(out.evidenceRefs.slice(0, 100)), at, at, i.id);
      ctx.db.run('INSERT INTO learning_intervention_history (intervention_id, version, state, effect, reason_code, actor_ref, occurred_at) SELECT id, version, state, effect, ?, ?, ? FROM learning_interventions WHERE id = ?', out.basis, SYSTEM_EVALUATOR_REF, at, i.id);
      appendAudit(ctx, 'learning.effect_assessed', 'learning_intervention', i.id, { actorRef: SYSTEM_EVALUATOR_REF }, 'OK', out.effect, { followups: out.followups, recurrences: out.recurrences });
      // The same mistake after repeated targeted retraining is a question about the system, not another cycle.
      let findingId: Id | null = null;
      if (i.kind === 'TARGETED_RETRAINING' && (out.effect === 'NO_IMPROVEMENT' || out.effect === 'REGRESSION')) {
        const prior = ctx.db.all<{ effect: string }>(`SELECT effect FROM learning_interventions WHERE lesson_id = ? AND kind = 'TARGETED_RETRAINING' AND state <> 'CANCELLED'`, i.lessonId).map((r) => r.effect as LearningEffect);
        if (nextInterventionDecision(prior).decision === 'ESCALATE_SYSTEMIC') {
          findingId = upsertSystemic(ctx, { targetKind: 'SKILL', targetRef: i.comparableKey, cause: i.targetCause, occurrences: prior.length, distinctEmployees: 1, evidenceRefs: [`lesson:${i.lessonId}`, ...ctx.db.all<{ id: string }>('SELECT id FROM learning_interventions WHERE lesson_id = ?', i.lessonId).map((r) => `learning_intervention:${r.id}`)] }, 'RETRAINING_EXHAUSTED', SYSTEM_EVALUATOR_REF).id;
        }
      }
      return { intervention: mapIntervention(present(ctx.db.get('SELECT * FROM learning_interventions WHERE id = ?', i.id))), changed: true, findingId };
    });
  }

  interventions(filter: { lessonId?: Id; employeeId?: Id } = {}): InterventionRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM learning_interventions ORDER BY created_at, id').map(mapIntervention).filter((i) => (filter.lessonId === undefined || i.lessonId === filter.lessonId) && (filter.employeeId === undefined || i.employeeId === filter.employeeId)));
  }

  // --- Systemic findings (recommendations, never acts) ---------------------------------------------------

  decideSystemicFinding(actorRef: string, findingId: string, input: { decision: 'VALIDATE' | 'REJECT' | 'ADDRESSED'; reasonCode: string; oversightFindingId?: string }): SystemicFindingRecord {
    return this.#admin('decide systemic finding', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'systemic finding');
      const f = must(ctx.db.get('SELECT * FROM systemic_findings WHERE id = ?', assertId(findingId, 'findingId')), mapFinding, 'systemic finding', findingId);
      const to = input.decision === 'VALIDATE' ? 'VALIDATED' : input.decision === 'REJECT' ? 'REJECTED' : 'ADDRESSED';
      const allowed = (f.state === 'CANDIDATE' && (to === 'VALIDATED' || to === 'REJECTED')) || (f.state === 'VALIDATED' && to === 'ADDRESSED');
      if (!allowed) throw new QandeelError('INVALID_TRANSITION', `${f.state} -> ${to} is not a systemic finding step`, { findingId: f.id });
      const oversight = input.oversightFindingId === undefined ? f.oversightFindingId : assertId(input.oversightFindingId, 'oversightFindingId');
      if (oversight !== null && !ctx.db.get('SELECT 1 AS x FROM oversight_findings WHERE id = ?', oversight)) throw new QandeelError('NOT_FOUND', 'oversight finding not found', { oversightFindingId: oversight });
      const reason = assertCode(input.reasonCode, 'reasonCode');
      const at = ts(ctx);
      const v = Number(ctx.db.get<{ v: number }>('SELECT version AS v FROM systemic_findings WHERE id = ?', f.id)?.v);
      ctx.db.run('UPDATE systemic_findings SET state = ?, decided_by_ref = ?, oversight_finding_id = ?, version = version + 1, updated_at = ? WHERE id = ?', to, p.ref, oversight, at, f.id);
      ctx.db.run('INSERT INTO systemic_finding_history (finding_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', f.id, v + 1, f.state, to, reason, p.ref, at);
      appendAudit(ctx, `systemic.${to.toLowerCase()}`, 'systemic_finding', f.id, { actorRef: p.ref }, 'OK', reason, { targetKind: f.targetKind });
      return mapFinding(present(ctx.db.get('SELECT * FROM systemic_findings WHERE id = ?', f.id)));
    });
  }

  systemicFindings(filter: { state?: SystemicFindingRecord['state'] } = {}): SystemicFindingRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM systemic_findings ORDER BY created_at, id').map(mapFinding).filter((f) => filter.state === undefined || f.state === filter.state));
  }

  // --- Failure → regression / Gold cases ----------------------------------------------------------------

  openFailureCase(actorRef: string, workItemId: string): FailureCaseRecord {
    return this.#admin('open failure case', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'failure case');
      const w = getWorkItemRow(ctx, assertId(workItemId, 'workItemId'));
      if (!(w.state === 'FAILED' || w.outcome === 'NOT_ACHIEVED')) throw new QandeelError('LEARNING_GATE', 'a failure case starts from a real failure', { workItemId: w.id, reason: 'NOT_A_FAILURE' });
      const existing = ctx.db.get('SELECT * FROM failure_cases WHERE work_item_id = ?', w.id);
      if (existing) return mapCase(existing);
      const id = newId();
      const at = ts(ctx);
      const key = liveEvaluationRow(ctx, w.id)?.comparableKey ?? gatherWorkEvidence(ctx, w.id).evidence.comparableKey;
      ctx.db.run(`INSERT INTO failure_cases (id, work_item_id, attribution_id, comparable_key, stage, hidden, academy_scenario_id, calibration_run_id, created_by_ref, version, created_at, updated_at) VALUES (?, ?, NULL, ?, 'REAL_FAILURE', 0, NULL, NULL, ?, 1, ?, ?)`, id, w.id, key, p.ref, at, at);
      ctx.db.run('INSERT INTO failure_case_history (case_id, version, from_stage, to_stage, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, ?, ?, ?, ?)', id, 'REAL_FAILURE', 'case.opened', p.ref, at);
      appendAudit(ctx, 'failure_case.opened', 'failure_case', id, { actorRef: p.ref }, 'OK', null, { workItemId: w.id });
      return mapCase(present(ctx.db.get('SELECT * FROM failure_cases WHERE id = ?', id)));
    });
  }

  advanceFailureCase(actorRef: string, caseId: string, input: { to: CaseStage; reasonCode: string; attributionId?: string; academyScenarioId?: string; calibrationRunId?: string; hidden?: boolean }): FailureCaseRecord {
    return this.#admin('advance failure case', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'failure case');
      const c = must(ctx.db.get('SELECT * FROM failure_cases WHERE id = ?', assertId(caseId, 'caseId')), mapCase, 'failure case', caseId);
      assertCaseStep(c.stage, input.to);
      const attributionId: Id | null = input.attributionId === undefined ? c.attributionId : (assertId(input.attributionId, 'attributionId') as Id);
      if (input.to === 'VALID_FAILURE_CASE') {
        const a = attributionId ? ctx.db.get<{ state: string; work_item_id: string }>('SELECT state, work_item_id FROM causal_attributions WHERE id = ?', attributionId) : undefined;
        if (!a || a.state !== 'VALIDATED' || a.work_item_id !== c.workItemId) throw new QandeelError('LEARNING_GATE', 'a valid failure case rests on a validated cause analysis', { caseId: c.id, reason: 'CAUSE_NOT_VALIDATED' });
      }
      let scenario: Id | null = c.academyScenarioId;
      let run: Id | null = c.calibrationRunId;
      let hidden = c.hidden;
      if (input.to === 'REGRESSION_CASE' || input.to === 'GOLD_CASE') {
        scenario = assertId(input.academyScenarioId, 'academyScenarioId') as Id;
        run = assertId(input.calibrationRunId, 'calibrationRunId') as Id;
        hidden = input.to === 'GOLD_CASE' ? true : input.hidden === true;
        const sc = ctx.db.get<{ kind: string }>('SELECT kind FROM academy_scenarios WHERE id = ?', scenario);
        if (!sc) throw new QandeelError('NOT_FOUND', 'academy scenario not found', { academyScenarioId: scenario });
        if (hidden !== (sc.kind === 'HOLDOUT')) throw new QandeelError('LEARNING_GATE', 'a hidden case is exactly a holdout scenario; a visible case never is', { caseId: c.id, reason: 'HOLDOUT_MISMATCH' });
        const r = ctx.db.get<{ passed: number }>('SELECT passed FROM eval_calibration_runs WHERE id = ?', run);
        if (r?.passed !== 1) throw new QandeelError('LEARNING_GATE', 'a permanent case is admitted only with a passed calibration', { caseId: c.id, reason: 'CALIBRATION_NOT_PASSED' });
      }
      const reason = assertCode(input.reasonCode, 'reasonCode');
      const at = ts(ctx);
      const v = Number(ctx.db.get<{ v: number }>('SELECT version AS v FROM failure_cases WHERE id = ?', c.id)?.v);
      ctx.db.run('UPDATE failure_cases SET stage = ?, attribution_id = ?, academy_scenario_id = ?, calibration_run_id = ?, hidden = ?, version = version + 1, updated_at = ? WHERE id = ?', input.to, attributionId, scenario, run, hidden ? 1 : 0, at, c.id);
      ctx.db.run('INSERT INTO failure_case_history (case_id, version, from_stage, to_stage, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', c.id, v + 1, c.stage, input.to, reason, p.ref, at);
      appendAudit(ctx, 'failure_case.advanced', 'failure_case', c.id, { actorRef: p.ref }, 'OK', reason, { from: c.stage, to: input.to, hidden });
      return mapCase(present(ctx.db.get('SELECT * FROM failure_cases WHERE id = ?', c.id)));
    });
  }

  failureCases(): FailureCaseRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM failure_cases ORDER BY created_at, id').map(mapCase));
  }

  /** Permanent, visible regression cases a trainee may practise on; hidden holdout / Gold cases never appear. */
  retrainingMaterial(comparableKey?: string): string[] {
    return this.#read((ctx) =>
      retrainingMaterial(
        ctx.db
          .all('SELECT * FROM failure_cases ORDER BY created_at, id')
          .map(mapCase)
          .filter((c) => comparableKey === undefined || c.comparableKey === comparableKey)
          .map((c) => ({ caseId: c.academyScenarioId ?? c.id, stage: c.stage, hidden: c.hidden })),
      ),
    );
  }

  // --- Reporting (system) ---------------------------------------------------------------------------------

  /** Generates (idempotently) the report of a cadence for the period ending `at` (default now). */
  generateReport(cadence: ReportCadence, options: { at?: string } = {}): { report: ReportRecord; changed: boolean } {
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(cadence)) throw new QandeelError('VALIDATION_FAILED', 'cadence is DAILY, WEEKLY or MONTHLY', { field: 'cadence' });
    if (options.at !== undefined && !isTimestamp(options.at)) throw new QandeelError('VALIDATION_FAILED', 'at must be a canonical UTC timestamp', { field: 'at' });
    return this.#system('generate report', (ctx) => {
      const at = options.at ?? ts(ctx);
      const report = composeReport(reportFacts(ctx, cadence, at));
      const text = JSON.stringify(report.claims);
      const sha = sha256Hex(text);
      const same = ctx.db.get('SELECT * FROM report_snapshots WHERE cadence = ? AND period_to = ? AND claims_sha256 = ?', cadence, report.period.to, sha);
      if (same) return { report: mapReport(same), changed: false };
      const id = newId();
      ctx.db.run(`INSERT INTO report_snapshots (id, cadence, period_from, period_to, claims_json, claims_sha256, claim_count, generated_by_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, cadence, report.period.from, report.period.to, text, sha, report.claims.length, SYSTEM_REPORTER_REF, ts(ctx));
      appendAudit(ctx, 'report.generated', 'report', id, { actorRef: SYSTEM_REPORTER_REF }, 'OK', cadence, { claims: report.claims.length });
      return { report: mapReport(present(ctx.db.get('SELECT * FROM report_snapshots WHERE id = ?', id))), changed: true };
    });
  }

  latestReport(cadence: ReportCadence): ReportRecord | null {
    return this.#read((ctx) => {
      const r = ctx.db.get('SELECT * FROM report_snapshots WHERE cadence = ? ORDER BY period_to DESC, created_at DESC, id DESC LIMIT 1', cadence);
      return r ? mapReport(r) : null;
    });
  }

  reports(filter: { cadence?: ReportCadence; limit?: number } = {}): ReportRecord[] {
    const n = Math.max(1, Math.min(200, Math.trunc(filter.limit ?? 30)));
    return this.#read((ctx) => (filter.cadence ? ctx.db.all('SELECT * FROM report_snapshots WHERE cadence = ? ORDER BY period_to DESC, id DESC LIMIT ?', filter.cadence, n) : ctx.db.all('SELECT * FROM report_snapshots ORDER BY period_to DESC, id DESC LIMIT ?', n)).map(mapReport));
  }

  // --- Reads: profiles, economics, meta-evaluation, inspection ------------------------------------------

  profile(employeeId: string, options: { at?: string } = {}): PerformanceProfile {
    return this.#read((ctx) => {
      const id = assertId(employeeId, 'employeeId');
      if (!ctx.db.get('SELECT 1 AS x FROM employees WHERE id = ?', id)) throw new QandeelError('NOT_FOUND', 'employee not found', { employeeId: id });
      return txProfile(ctx, id, options.at ?? ts(ctx));
    });
  }

  economics(scope: { employeeId?: string; departmentId?: string; goalId?: string } = {}): CostPerQualifiedOutcome {
    return this.#read((ctx) => {
      if (scope.goalId !== undefined) {
        const links = ctx.db.all<{ w: string }>('SELECT work_item_id AS w FROM goal_work_links WHERE goal_id = ? AND ended_at IS NULL', assertId(scope.goalId, 'goalId')).map((r) => r.w as Id);
        return costPerQualifiedOutcome(liveEvaluations(ctx, { workItemIds: links }));
      }
      return costPerQualifiedOutcome(liveEvaluations(ctx, { ...(scope.employeeId !== undefined ? { employeeId: assertId(scope.employeeId, 'employeeId') } : {}), ...(scope.departmentId !== undefined ? { departmentId: assertId(scope.departmentId, 'departmentId') } : {}) }));
    });
  }

  reviewerCalibration(): ReviewerMetaEvaluation[] {
    return this.#read((ctx) => txReviewerCalibration(ctx));
  }

  /**
   * On-demand inspection (Stage 17 FD-6): the evidence behind any claim, at Company, Department, Employee,
   * Goal or Work Item level. Ids, codes, counts and references only; no aggregate score at any level.
   */
  inspect(subject: { kind: 'COMPANY' | 'DEPARTMENT' | 'EMPLOYEE' | 'GOAL' | 'WORK_ITEM'; id?: string }): Record<string, unknown> {
    return this.#read((ctx) => {
      const at = ts(ctx);
      switch (subject.kind) {
        case 'WORK_ITEM': {
          const id = assertId(subject.id, 'id');
          const { evidence, refs } = gatherWorkEvidence(ctx, id);
          return {
            subject: { kind: 'WORK_ITEM', id },
            evidence,
            evidenceRefs: refs,
            verification: latestVerdict(ctx, id),
            evaluation: liveEvaluationRow(ctx, id),
            attribution: liveAttribution(ctx, id),
            signals: ctx.db.all('SELECT * FROM learning_signals WHERE work_item_id = ? ORDER BY created_at, id', id).map(mapSignal),
          };
        }
        case 'EMPLOYEE': {
          const id = assertId(subject.id, 'id');
          return { subject: { kind: 'EMPLOYEE', id }, profile: txProfile(ctx, id, at), evaluations: liveEvaluations(ctx, { employeeId: id }).map((e) => e.evaluationId), interventions: ctx.db.all('SELECT * FROM learning_interventions WHERE employee_id = ? ORDER BY created_at, id', id).map(mapIntervention) };
        }
        case 'DEPARTMENT': {
          const id = assertId(subject.id, 'id');
          const evals = liveEvaluations(ctx, { departmentId: id });
          const members = [...new Set(ctx.db.all<{ e: string }>('SELECT DISTINCT employee_id AS e FROM evaluation_results WHERE department_id = ? AND employee_id IS NOT NULL AND superseded_by IS NULL ORDER BY employee_id', id).map((r) => r.e))];
          return { subject: { kind: 'DEPARTMENT', id }, economics: costPerQualifiedOutcome(evals), evaluations: evals.map((e) => e.evaluationId), employees: members, openGaps: ctx.db.all<{ id: string }>(`SELECT g.id FROM capability_gaps g JOIN employees e ON e.id = g.employee_id WHERE g.state = 'OPEN' AND e.department_id = ?`, id).map((r) => r.id) };
        }
        case 'GOAL': {
          const id = assertId(subject.id, 'id');
          const links = ctx.db.all<{ w: string }>('SELECT work_item_id AS w FROM goal_work_links WHERE goal_id = ? AND ended_at IS NULL', id).map((r) => r.w as Id);
          const evals = liveEvaluations(ctx, { workItemIds: links });
          return { subject: { kind: 'GOAL', id }, linkedWork: links, economics: costPerQualifiedOutcome(evals), qualified: evals.filter((e) => e.qualifiedOutcome).map((e) => e.workItemId), evaluations: evals.map((e) => e.evaluationId) };
        }
        case 'COMPANY':
          return {
            subject: { kind: 'COMPANY', id: null },
            economics: costPerQualifiedOutcome(liveEvaluations(ctx)),
            systemic: ctx.db.all(`SELECT * FROM systemic_findings WHERE state IN ('CANDIDATE', 'VALIDATED') ORDER BY created_at, id`).map(mapFinding),
            resilience: txResilienceStatus(ctx, at),
            latestReports: ['DAILY', 'WEEKLY', 'MONTHLY'].map((c) => ctx.db.get<{ id: string; period_to: string }>('SELECT id, period_to FROM report_snapshots WHERE cadence = ? ORDER BY period_to DESC, id DESC LIMIT 1', c) ?? null),
            externalOutcomes: { available: EXTERNAL_OUTCOMES_AVAILABLE, source: 'C7' },
          };
        default:
          throw new QandeelError('VALIDATION_FAILED', 'unknown inspection subject', { field: 'kind' });
      }
    });
  }

  health(): Record<string, number> {
    return this.#read((ctx) => {
      const n = (sql: string): number => Number(ctx.db.get<{ n: number }>(sql)?.n ?? 0);
      return {
        activeDefinitions: n(`SELECT COUNT(*) AS n FROM eval_definitions WHERE status = 'ACTIVE'`),
        evaluations: n(`SELECT COUNT(*) AS n FROM evaluation_results WHERE superseded_by IS NULL`),
        qualifiedOutcomes: n(`SELECT COUNT(*) AS n FROM evaluation_results WHERE superseded_by IS NULL AND qualified_outcome = 1`),
        attributionsProposed: n(`SELECT COUNT(*) AS n FROM causal_attributions WHERE state = 'PROPOSED'`),
        attributionsValidated: n(`SELECT COUNT(*) AS n FROM causal_attributions WHERE state = 'VALIDATED'`),
        learningSignals: n(`SELECT COUNT(*) AS n FROM learning_signals`),
        interventionsOpen: n(`SELECT COUNT(*) AS n FROM learning_interventions WHERE state IN ('PLANNED', 'TRAINING_COMPLETED')`),
        systemicCandidates: n(`SELECT COUNT(*) AS n FROM systemic_findings WHERE state = 'CANDIDATE'`),
        reports: n(`SELECT COUNT(*) AS n FROM report_snapshots`),
      };
    });
  }
}
