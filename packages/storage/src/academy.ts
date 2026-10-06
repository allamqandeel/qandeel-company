/**
 * AcademyStore — the durable QANDEEL Academy engine (Stage 6) and the C3 activation bridge.
 *
 * Deterministic engine steps (advancing the learning path when its evidence is complete, the
 * deterministic rubric, diagnosis, certification issuance, requesting activation) are system actions:
 * they can only act on evidence that authority already recorded. Every evaluator / reviewer act
 * (module completion, dimension scores, probation evidence and review, Founder Calibration, the final
 * Activation Approval) needs authenticated authority and fails closed until it exists (C4 / C5).
 * The evaluator is never the trainee, and no model output can record evidence.
 *
 * Certification is necessary, not sufficient: ACTIVE also needs a passed Probation Review and an
 * APPROVED Activation Request (checked here and by the datastore's own activation gate).
 */
import { COMPLETED_FAMILY, QandeelError, TERMINAL_WORK_ITEM_STATES, assertCode, assertIntInRange, assertId, assertOpaqueRef, boundedText, canonicalJson, newId, sha256Hex, type Id, type Timestamp } from '@qandeel-company/domain';
import { assertTaskClass } from '@qandeel-company/governance';
import {
  ASSESSMENT_DIMENSIONS,
  DETERMINISTIC_DIMENSIONS,
  PROBATION_EVIDENCE_KINDS,
  addDays,
  assertKeyCode,
  assertProgramDefinition,
  assertStageStep,
  calibrationActivationGap,
  certificationGaps,
  containsSecretMaterial,
  diagnose,
  diagnoseProbation,
  evaluateAttempt,
  evaluateProbation,
  pinnable,
  proficiencyRank,
  repeatedCriticalFailures,
  scenarioAllowed,
  type AssessmentDimension,
  type LearningStage,
  type ProbationEvidenceKind,
  type ProgramDefinition,
  type ScenarioKind,
} from '@qandeel-company/mind';

import { getEmployeeRow, setEmployeeState } from './governance-core.js';
import { founder, founderAdminWrite } from './governance.js';
import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { SYSTEM_MIND_REF, enforceRoleCertification, getSkillVersionRow, liveCertifications, skillVersionView, wakeEmployeeWaits } from './mind-core.js';
import { wakeCapabilityGaps } from './mind-writes.js';
import {
  mapActivation,
  mapAttempt,
  mapCertification,
  mapEnrollment,
  mapPassport,
  mapRemediation,
  mapScenario,
  type ActivationRequestRecord,
  type AttemptRecord,
  type CertificationRecord,
  type EnrollmentRecord,
  type RemediationRecord,
  type ScenarioRecord,
} from './mind-records.js';
import { storeContext, type CompanyStore } from './store.js';
import { txCreateWorkItem, txRequestCancellation } from './work-items.js';

const ACADEMY_TASK = 'c2.employee-task';
const ENROLLABLE: readonly string[] = ['TRAINING', 'SHADOW', 'PROBATION', 'RETRAINING', 'ACTIVE'];

export interface AcademyHealth {
  readonly enrollmentsByStage: Record<string, number>;
  readonly blocked: number;
  readonly attemptsFailed: number;
  readonly attemptsAwaitingEvaluation: number;
  readonly remediationsOpen: number;
  readonly certifications: Record<string, number>;
  readonly calibrationsPending: number;
  readonly activationApprovalsPending: number;
  readonly capabilityGapsOpen: number;
}

function getEnrollment(ctx: StoreContext, id: Id): EnrollmentRecord {
  const r = ctx.db.get('SELECT * FROM academy_enrollments WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'enrollment not found', { enrollmentId: id });
  return mapEnrollment(r);
}

function getAttempt(ctx: StoreContext, id: Id): AttemptRecord {
  const r = ctx.db.get('SELECT * FROM academy_attempts WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'attempt not found', { attemptId: id });
  return mapAttempt(r);
}

function programDef(ctx: StoreContext, programVersionId: Id): ProgramDefinition & { readonly blueprintId: Id; readonly roleRef: string } {
  const r = ctx.db.get<{ definition_json: string; blueprint_id: string; role_ref: string }>('SELECT v.definition_json, v.blueprint_id, p.role_ref FROM academy_program_versions v JOIN academy_programs p ON p.id = v.program_id WHERE v.id = ?', programVersionId);
  if (!r) throw new QandeelError('NOT_FOUND', 'program version not found', { programVersionId });
  return { ...assertProgramDefinition(JSON.parse(r.definition_json)), blueprintId: r.blueprint_id as Id, roleRef: r.role_ref };
}

function setStage(ctx: StoreContext, e: EnrollmentRecord, to: LearningStage, reason: string, actorRef: string, blockedReason: string | null = null): EnrollmentRecord {
  assertStageStep(e.stage, to);
  const changed = ctx.db.run('UPDATE academy_enrollments SET stage = ?, blocked_reason = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', to, blockedReason, ts(ctx), e.id, e.version).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'enrollment changed concurrently', { enrollmentId: e.id });
  ctx.db.run('INSERT INTO academy_stage_history (enrollment_id, version, from_stage, to_stage, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', e.id, e.version + 1, e.stage, to, reason, actorRef, ts(ctx));
  appendAudit(ctx, 'academy.stage', 'academy_enrollment', e.id, { actorRef }, 'OK', reason, { from: e.stage, to, employeeId: e.employeeId });
  return getEnrollment(ctx, e.id);
}

/** Evidence summary of an enrollment (content-free counts), used by the deterministic gates. */
function evidence(ctx: StoreContext, e: EnrollmentRecord) {
  const def = programDef(ctx, e.programVersionId);
  const attempts = ctx.db.all('SELECT * FROM academy_attempts WHERE enrollment_id = ? ORDER BY created_at, id', e.id).map(mapAttempt);
  const completed = new Set(ctx.db.all<{ m: string }>('SELECT module_code AS m FROM academy_module_completions WHERE enrollment_id = ?', e.id).map((r) => r.m));
  // Only the current review round's decision counts (EXTEND / FAIL close a round; the next needs a new decision).
  const review = ctx.db.get<{ id: string; decision: string }>('SELECT id, decision FROM probation_reviews WHERE enrollment_id = ? AND review_round = ?', e.id, e.reviewRound);
  const calibration = ctx.db.get<{ id: string; state: string }>('SELECT id, state FROM founder_calibrations WHERE enrollment_id = ?', e.id);
  const assessments = attempts.filter((a) => a.kind === 'ASSESSMENT' && a.state === 'EVALUATED');
  const passed = assessments.filter((a) => a.outcome === 'PASS');
  const blockedDims = repeatedCriticalFailures(assessments.filter((a) => a.outcome === 'FAIL').map((a) => a.criticalFailures), def.maxRepeatedCriticalFailures);
  return { def, attempts, completed, review, calibration, passed, blockedDims };
}

/**
 * The enrollment's simulations (in trial order) that may decide the SIMULATION / FEEDBACK gates: after a
 * retrained SIMULATION failure, only its retest and later simulations — never the failure it retrained, nor
 * a simulation started before the retraining (R2-34). Before any retraining, all of them.
 */
function simulationsSinceRetraining(ctx: StoreContext, e: EnrollmentRecord, attempts: readonly AttemptRecord[]): AttemptRecord[] {
  const sims = attempts.filter((a) => a.kind === 'SIMULATION').sort((a, b) => a.trialNo - b.trialNo);
  const r = ctx.db.get<{ state: string; failed_trial: number; retest: string | null }>(
    `SELECT r.state, a.trial_no AS failed_trial, r.retest_attempt_id AS retest FROM academy_remediations r JOIN academy_attempts a ON a.id = r.attempt_id
      WHERE r.enrollment_id = ? AND a.kind = 'SIMULATION' AND r.state IN ('RETEST_READY', 'RETESTED') ORDER BY a.trial_no DESC LIMIT 1`,
    e.id,
  );
  if (!r) return sims;
  const retest = sims.find((a) => a.id === r.retest);
  if (retest) return sims.filter((a) => a.trialNo >= retest.trialNo);
  // Retrained, retest not started yet: nothing decides the gate until it is. (A retest linked to a non-simulation
  // attempt: the simulations after the retrained failure.)
  return r.state === 'RETEST_READY' ? [] : sims.filter((a) => a.trialNo > Number(r.failed_trial));
}

export class AcademyStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): AcademyStore {
    return new AcademyStore(store);
  }

  #write<T>(operation: string, fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.immediate(operation, () => fn(ctx));
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  // --- Programs and scenarios (Founder authority) ---------------------------------------------------

  createProgram(actorRef: string, input: { code: string; roleRef: string }): { id: Id; code: string; roleRef: string } {
    return founderAdminWrite(this.#store, 'create academy program', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'academy program');
      const role = assertOpaqueRef(input.roleRef, 'roleRef');
      if (!role.startsWith('role:')) throw new QandeelError('VALIDATION_FAILED', 'a program is for a role ref', { field: 'roleRef' });
      const id = newId();
      ctx.db.run('INSERT INTO academy_programs (id, code, role_ref, created_by_ref, created_at) VALUES (?, ?, ?, ?, ?)', id, assertKeyCode(input.code, 'code'), role, p.ref, ts(ctx));
      appendAudit(ctx, 'academy.program_created', 'academy_program', id, { actorRef: p.ref }, 'OK', null, {});
      return { id, code: input.code, roleRef: role };
    });
  }

  /** A new program version bound to the role's ACTIVE blueprint; its skill targets must be in that blueprint. */
  publishProgramVersion(actorRef: string, programId: string, definition: unknown): { id: Id; version: number; blueprintId: Id } {
    return founderAdminWrite(this.#store, 'publish program version', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'academy program');
      const pid = assertId(programId, 'programId');
      const program = ctx.db.get<{ role_ref: string }>('SELECT role_ref FROM academy_programs WHERE id = ?', pid);
      if (!program) throw new QandeelError('NOT_FOUND', 'program not found', { programId: pid });
      const def = assertProgramDefinition(definition);
      const bp = ctx.db.get<{ id: string }>(`SELECT id FROM role_blueprints WHERE role_ref = ? AND status = 'ACTIVE'`, program.role_ref);
      if (!bp) throw new QandeelError('VALIDATION_FAILED', 'the role has no active skill blueprint', { reason: 'BLUEPRINT_MISSING' });
      const inBlueprint = new Set(ctx.db.all<{ s: string }>('SELECT skill_id AS s FROM role_blueprint_entries WHERE blueprint_id = ?', bp.id).map((r) => r.s));
      for (const t of def.skillTargets) if (!inBlueprint.has(t.skillId)) throw new QandeelError('VALIDATION_FAILED', 'program skill targets come from the role blueprint', { skillId: t.skillId });
      const prior = ctx.db.get<{ id: string; version: number }>(`SELECT id, version FROM academy_program_versions WHERE program_id = ? AND status = 'ACTIVE'`, pid);
      if (prior) ctx.db.run(`UPDATE academy_program_versions SET status = 'SUPERSEDED' WHERE id = ?`, prior.id);
      const id = newId();
      const json = canonicalJson(def);
      ctx.db.run(`INSERT INTO academy_program_versions (id, program_id, version, blueprint_id, definition_json, definition_sha256, status, created_by_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`, id, pid, (prior?.version ?? 0) + 1, bp.id, json, sha256Hex(json), p.ref, ts(ctx));
      appendAudit(ctx, 'academy.program_published', 'academy_program', pid, { actorRef: p.ref }, 'OK', null, { programVersionId: id });
      return { id, version: (prior?.version ?? 0) + 1, blueprintId: bp.id as Id };
    });
  }

  addScenario(actorRef: string, programVersionId: string, input: { code: string; kind: ScenarioKind; content: string; sourceRef: string; budgetMicros: number }): ScenarioRecord {
    return founderAdminWrite(this.#store, 'add scenario', actorRef, (ctx) => {
      founder(ctx, actorRef, null, 'academy scenario');
      const content = boundedText(input.content, 'content', 8_000);
      if (containsSecretMaterial(content)) throw new QandeelError('VALIDATION_FAILED', 'scenario content contains secret-shaped material', { field: 'content' });
      if (!['PRACTICE', 'ASSESSMENT', 'HOLDOUT'].includes(input.kind)) throw new QandeelError('VALIDATION_FAILED', 'unknown scenario kind', { field: 'kind' });
      if (!Number.isSafeInteger(input.budgetMicros) || input.budgetMicros < 0) throw new QandeelError('VALIDATION_FAILED', 'budgetMicros is a non-negative integer', { field: 'budgetMicros' });
      // An assessed scenario always carries a real budget: COST_DISCIPLINE is never passed by default.
      if (input.kind !== 'PRACTICE' && input.budgetMicros === 0) throw new QandeelError('VALIDATION_FAILED', 'an assessment / holdout scenario needs a cost budget', { field: 'budgetMicros' });
      const id = newId();
      ctx.db.run(`INSERT INTO academy_scenarios (id, program_version_id, code, kind, content, content_sha256, source_ref, budget_micros, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`, id, assertId(programVersionId, 'programVersionId'), assertKeyCode(input.code, 'code'), input.kind, content, sha256Hex(content), assertOpaqueRef(input.sourceRef, 'sourceRef'), input.budgetMicros, ts(ctx));
      appendAudit(ctx, 'academy.scenario_added', 'academy_scenario', id, { actorRef: SYSTEM_MIND_REF }, 'OK', input.kind, { programVersionId });
      return mapScenario(ctx.db.get('SELECT * FROM academy_scenarios WHERE id = ?', id) ?? {});
    });
  }

  // --- Enrollment and the learning path --------------------------------------------------------------

  enroll(actorRef: string, employeeId: string, programVersionId: string): EnrollmentRecord {
    return founderAdminWrite(this.#store, 'enroll', actorRef, (ctx) => {
      const eid = assertId(employeeId, 'employeeId');
      const p = founder(ctx, actorRef, `employee:${eid}`, 'academy enrollment');
      const emp = getEmployeeRow(ctx, eid);
      if (!ENROLLABLE.includes(emp.state)) throw new QandeelError('INVALID_TRANSITION', 'this employee cannot enroll now', { state: emp.state });
      const pv = assertId(programVersionId, 'programVersionId');
      const def = programDef(ctx, pv);
      if (ctx.db.get<{ s: string }>('SELECT status AS s FROM academy_program_versions WHERE id = ?', pv)?.s !== 'ACTIVE') throw new QandeelError('VALIDATION_FAILED', 'enroll in the active program version', { reason: 'PROGRAM_VERSION_SUPERSEDED' });
      // Certification is role-specific: an enrollment is for the Employee's current role only.
      if (def.roleRef !== emp.roleRef) throw new QandeelError('VALIDATION_FAILED', 'the program is for another role', { reason: 'ROLE_MISMATCH' });
      const id = newId();
      const at = ts(ctx);
      ctx.db.run(`INSERT INTO academy_enrollments (id, employee_id, program_version_id, role_ref, stage, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'LEARN', 1, ?, ?)`, id, eid, pv, def.roleRef, at, at);
      ctx.db.run(`INSERT INTO academy_stage_history (enrollment_id, version, from_stage, to_stage, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, 'LEARN', 'academy.enrolled', ?, ?)`, id, p.ref, at);
      if (def.founderCalibrationRequired) ctx.db.run(`INSERT INTO founder_calibrations (id, enrollment_id, state, evidence_refs_json, created_at) VALUES (?, ?, 'PENDING', '[]', ?)`, newId(), id, at);
      appendAudit(ctx, 'academy.enrolled', 'academy_enrollment', id, { actorRef: p.ref }, 'OK', null, { employeeId: eid });
      return getEnrollment(ctx, id);
    });
  }

  /** Records a curriculum module as completed (trainer / evaluator authority). */
  recordModuleCompletion(actorRef: string, enrollmentId: string, moduleCode: string, evidenceRef: string): void {
    founderAdminWrite(this.#store, 'module completion', actorRef, (ctx) => {
      const e = getEnrollment(ctx, assertId(enrollmentId, 'enrollmentId'));
      const p = founder(ctx, actorRef, `employee:${e.employeeId}`, 'academy evaluation');
      const def = programDef(ctx, e.programVersionId);
      const code = assertKeyCode(moduleCode, 'moduleCode');
      if (!def.curriculum.some((m) => m.code === code)) throw new QandeelError('NOT_FOUND', 'module not in this program', { moduleCode: code });
      if (ctx.db.run('INSERT OR IGNORE INTO academy_module_completions (enrollment_id, module_code, evidence_ref, recorded_by_ref, recorded_at) VALUES (?, ?, ?, ?, ?)', e.id, code, assertOpaqueRef(evidenceRef, 'evidenceRef'), p.ref, ts(ctx)).changes === 1) {
        appendAudit(ctx, 'academy.module_completed', 'academy_enrollment', e.id, { actorRef: p.ref }, 'OK', null, { moduleCode: code });
      }
    });
  }

  /**
   * Advances the learning path as far as the recorded evidence allows (deterministic; system). It
   * issues the certification and files the activation request when their evidence is complete; it
   * never activates anyone.
   */
  advance(enrollmentId: string): EnrollmentRecord {
    return this.#write('advance enrollment', (ctx) => txAdvance(ctx, enrollmentId));
  }

  // --- Attempts, evaluation, remediation -----------------------------------------------------------

  /**
   * Starts one attempt: exactly one canonical row per (enrollment, kind, trial) and its Work Item,
   * created together. A holdout is valid only if the trainee was never exposed to it before.
   */
  startAttempt(enrollmentId: string, input: { scenarioId: string; kind: 'SIMULATION' | 'ASSESSMENT'; taskClass: string }): { attempt: AttemptRecord; workItemId: Id } {
    return this.#write('start attempt', (ctx) => txStartAttempt(ctx, enrollmentId, input));
  }


  /**
   * The deterministic rubric (system): AUTHORITY_COMPLIANCE from the audit of the attempt's runs (any
   * authority denial counts), COST_DISCIPLINE from its economic spend against the scenario budget.
   */
  evaluateDeterministic(attemptId: string): AttemptRecord {
    return this.#write('deterministic evaluation', (ctx) => txEvaluateDeterministic(ctx, attemptId));
  }

  /** Deterministic probation evidence from finished shadow work (system): a completed case, and any authority denial as a critical failure. */
  collectShadowEvidence(enrollmentId: string): number {
    return this.#write('collect shadow evidence', (ctx) => txCollectShadowEvidence(ctx, enrollmentId));
  }

  /**
   * Records evaluator scores (Founder authority in Strong v1; the Review Pool is C4). The evaluator is
   * never the trainee, and deterministic dimensions come only from the runtime's rubric.
   */
  recordEvaluation(actorRef: string, attemptId: string, results: readonly { dimension: AssessmentDimension; scorePct: number; evidenceRefs?: readonly string[] }[]): AttemptRecord {
    return founderAdminWrite(this.#store, 'record evaluation', actorRef, (ctx) => {
      const a = getAttempt(ctx, assertId(attemptId, 'attemptId'));
      const e = getEnrollment(ctx, a.enrollmentId);
      const p = founder(ctx, actorRef, `employee:${e.employeeId}`, 'academy evaluation');
      if (a.state !== 'OPEN') throw new QandeelError('INVALID_TRANSITION', 'this attempt already has its outcome', { attemptId: a.id });
      for (const r of results) {
        if (!(ASSESSMENT_DIMENSIONS as readonly string[]).includes(r.dimension)) throw new QandeelError('VALIDATION_FAILED', 'unknown dimension', { field: 'dimension' });
        if (DETERMINISTIC_DIMENSIONS.includes(r.dimension)) throw new QandeelError('VALIDATION_FAILED', 'this dimension is evaluated deterministically from run facts', { reason: 'DETERMINISTIC_DIMENSION', dimension: r.dimension });
        if (!Number.isInteger(r.scorePct) || r.scorePct < 0 || r.scorePct > 100) throw new QandeelError('VALIDATION_FAILED', 'scorePct is 0..100', { field: 'scorePct' });
        ctx.db.run(
          `INSERT INTO academy_dimension_results (attempt_id, dimension, score_pct, evaluator_kind, evaluator_ref, evidence_refs_json, recorded_at) VALUES (?, ?, ?, 'EVALUATOR', ?, ?, ?)`,
          a.id, r.dimension, r.scorePct, p.ref, JSON.stringify((r.evidenceRefs ?? []).map((x) => assertOpaqueRef(x, 'evidenceRefs'))), ts(ctx),
        );
      }
      appendAudit(ctx, 'academy.evaluated', 'academy_attempt', a.id, { actorRef: p.ref }, 'OK', null, { dimensions: results.length });
      return finalizeAttempt(ctx, a.id);
    });
  }


  /** Retraining completed for a diagnosed failure (trainer authority): the trainee may be re-tested. */
  completeRetraining(actorRef: string, remediationId: string, evidenceRef: string): RemediationRecord {
    return founderAdminWrite(this.#store, 'complete retraining', actorRef, (ctx) => {
      const r = mapRemediation(ctx.db.get('SELECT * FROM academy_remediations WHERE id = ?', assertId(remediationId, 'remediationId')) ?? notFound('remediation', remediationId));
      const e = getEnrollment(ctx, r.enrollmentId);
      const p = founder(ctx, actorRef, `employee:${e.employeeId}`, 'academy retraining');
      if (r.state !== 'DIAGNOSED' && r.state !== 'RETRAINING') throw new QandeelError('INVALID_TRANSITION', 'this remediation is not in retraining', { state: r.state });
      remediationState(ctx, r.id, r.state, 'RETEST_READY', 'academy.retrained', p.ref);
      appendAudit(ctx, 'academy.retrained', 'academy_remediation', r.id, { actorRef: p.ref }, 'OK', null, { evidence: assertOpaqueRef(evidenceRef, 'evidenceRef').slice(0, 64) });
      return mapRemediation(ctx.db.get('SELECT * FROM academy_remediations WHERE id = ?', r.id) ?? {});
    });
  }

  // --- Shadow work, probation, calibration ----------------------------------------------------------

  /** Assigns real work as shadow work (constrained authority; the Work Item must be the trainee's, not yet released). */
  assignShadowWork(actorRef: string, enrollmentId: string, workItemId: string): void {
    founderAdminWrite(this.#store, 'assign shadow work', actorRef, (ctx) => {
      const e = getEnrollment(ctx, assertId(enrollmentId, 'enrollmentId'));
      const p = founder(ctx, actorRef, `employee:${e.employeeId}`, 'shadow work');
      if (e.stage !== 'SHADOW_WORK') throw new QandeelError('INVALID_TRANSITION', 'shadow work is assigned at the SHADOW_WORK stage', { stage: e.stage });
      const item = getWorkItemRow(ctx, assertId(workItemId, 'workItemId'));
      if (item.ownerRef !== `employee:${e.employeeId}` || item.state !== 'PROPOSED') throw new QandeelError('VALIDATION_FAILED', 'shadow work is the trainee\'s own, unreleased Work Item', { reason: 'SHADOW_WORK_OWNER' });
      ctx.db.run('INSERT INTO academy_shadow_assignments (work_item_id, enrollment_id, assigned_by_ref, created_at) VALUES (?, ?, ?, ?)', item.id, e.id, p.ref, ts(ctx));
      appendAudit(ctx, 'academy.shadow_assigned', 'academy_enrollment', e.id, { actorRef: p.ref }, 'OK', null, { workItemId: item.id });
    });
  }


  /** Evaluator probation evidence (quality, learning, cost discipline, escalation, collaboration). */
  recordProbationEvidence(actorRef: string, enrollmentId: string, input: { kind: ProbationEvidenceKind; workItemId: string; positive: boolean }): void {
    founderAdminWrite(this.#store, 'probation evidence', actorRef, (ctx) => {
      const e = getEnrollment(ctx, assertId(enrollmentId, 'enrollmentId'));
      const p = founder(ctx, actorRef, `employee:${e.employeeId}`, 'probation evidence');
      if (!(PROBATION_EVIDENCE_KINDS as readonly string[]).includes(input.kind) || input.kind === 'CASE') throw new QandeelError('VALIDATION_FAILED', 'cases are collected from shadow work; evaluators record quality evidence', { field: 'kind' });
      const item = getWorkItemRow(ctx, assertId(input.workItemId, 'workItemId'));
      if (!ctx.db.get('SELECT 1 AS ok FROM academy_shadow_assignments WHERE work_item_id = ? AND enrollment_id = ?', item.id, e.id)) throw new QandeelError('VALIDATION_FAILED', 'evidence refers to this enrollment\'s shadow work', { reason: 'NOT_SHADOW_WORK' });
      const id = newId();
      ctx.db.run(`INSERT INTO probation_evidence (id, enrollment_id, kind, work_item_id, positive, recorded_by_kind, recorded_by_ref, epoch, recorded_at) VALUES (?, ?, ?, ?, ?, 'EVALUATOR', ?, ?, ?)`, id, e.id, input.kind, item.id, input.positive ? 1 : 0, p.ref, e.evidenceEpoch, ts(ctx));
      appendAudit(ctx, 'academy.probation_evidence', 'academy_enrollment', e.id, { actorRef: p.ref }, 'OK', input.kind, { evidenceId: id, positive: input.positive });
    });
  }

  /** Probation review (Founder / manager authority): PASS only when the evidence meets the program's criteria. */
  decideProbationReview(actorRef: string, enrollmentId: string, decision: 'PASS' | 'FAIL' | 'EXTEND'): { id: Id; unmet: readonly string[] } {
    return founderAdminWrite(this.#store, 'probation review', actorRef, (ctx) => {
      const e = getEnrollment(ctx, assertId(enrollmentId, 'enrollmentId'));
      const p = founder(ctx, actorRef, `employee:${e.employeeId}`, 'probation review');
      if (e.stage !== 'PROBATION_REVIEW') throw new QandeelError('INVALID_TRANSITION', 'no probation review is due', { stage: e.stage });
      const def = programDef(ctx, e.programVersionId);
      const summary = probationSummary(ctx, e);
      const check = evaluateProbation(def.probation, summary);
      if (decision === 'PASS' && !check.met) throw new QandeelError('VALIDATION_FAILED', 'probation is evidence-based: the criteria are not met', { reason: 'PROBATION_CRITERIA_UNMET', unmet: check.unmet.join(',').slice(0, 120) });
      // D-C3-20: evidence that existed at an EXTEND decision never satisfies the next review on its own.
      if (decision === 'PASS' && awaitingEvidenceAfterExtension(ctx, e)) throw new QandeelError('VALIDATION_FAILED', 'an extended probation needs new evidence recorded after the extension', { reason: 'NO_EVIDENCE_AFTER_EXTENSION' });
      const id = newId();
      const at = ts(ctx);
      ctx.db.run('INSERT INTO probation_reviews (id, enrollment_id, decision, summary_json, unmet_json, decided_by_ref, epoch, review_round, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, e.id, decision, JSON.stringify(summary), JSON.stringify(decision === 'PASS' ? [] : check.unmet), p.ref, e.evidenceEpoch, e.reviewRound, at);
      appendAudit(ctx, 'academy.probation_reviewed', 'academy_enrollment', e.id, { actorRef: p.ref }, 'OK', decision, { reviewId: id });
      if (decision === 'EXTEND') {
        // More shadow evidence in the same epoch; the next review is a new round needing a new decision and
        // new evidence (this review row's summary is the durable extension boundary, D-C3-20).
        const next = bumpEnrollment(ctx, e, { reviewRound: e.reviewRound + 1 });
        setStage(ctx, next, 'SHADOW_WORK', 'PROBATION_EXTENDED', p.ref);
      } else if (decision === 'FAIL') {
        // Failure → diagnosis → targeted retraining (Stage 6 §9, §12); a new evidence epoch after it.
        const d = diagnoseProbation(check.unmet, def.curriculum);
        const remId = newId();
        ctx.db.run(
          `INSERT INTO academy_remediations (id, enrollment_id, probation_review_id, failed_json, critical_failures_json, categories_json, modules_json, state, created_at, updated_at) VALUES (?, ?, ?, '[]', '[]', ?, ?, 'DIAGNOSED', ?, ?)`,
          remId, e.id, id, JSON.stringify(d.categories), JSON.stringify(d.modules), at, at,
        );
        ctx.db.run('INSERT INTO academy_remediation_history (remediation_id, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, NULL, ?, ?, ?, ?)', remId, 'DIAGNOSED', 'PROBATION_FAILED', p.ref, at);
        const next = bumpEnrollment(ctx, e, { reviewRound: e.reviewRound + 1, evidenceEpoch: e.evidenceEpoch + 1 });
        setStage(ctx, next, 'RETRY', 'PROBATION_FAILED', p.ref);
      }
      return { id, unmet: check.unmet };
    });
  }

  /** Founder Calibration decision (strategic roles). Needs the authenticated Founder surface (C5): fails closed until then. */
  decideFounderCalibration(actorRef: string, enrollmentId: string, input: { decision: 'APPROVE' | 'REJECT'; evidenceRefs: readonly string[] }): void {
    founderAdminWrite(this.#store, 'founder calibration', actorRef, (ctx) => {
      const e = getEnrollment(ctx, assertId(enrollmentId, 'enrollmentId'));
      const p = founder(ctx, actorRef, `employee:${e.employeeId}`, 'founder calibration');
      const changed = ctx.db.run(`UPDATE founder_calibrations SET state = ?, evidence_refs_json = ?, decided_by_ref = ?, decided_at = ? WHERE enrollment_id = ? AND state = 'PENDING'`, input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', JSON.stringify(input.evidenceRefs.map((r) => assertOpaqueRef(r, 'evidenceRefs'))), p.ref, ts(ctx), e.id).changes;
      if (changed !== 1) throw new QandeelError('INVALID_TRANSITION', 'no pending calibration for this enrollment', { enrollmentId: e.id });
      appendAudit(ctx, 'academy.calibration_decided', 'academy_enrollment', e.id, { actorRef: p.ref }, 'OK', input.decision, {});
    });
  }

  /** Withdraws an open enrollment (Founder / trainer authority): its evidence stays as history; the Employee may enroll again. */
  withdrawEnrollment(actorRef: string, enrollmentId: string, reasonCode: string): EnrollmentRecord {
    return founderAdminWrite(this.#store, 'withdraw enrollment', actorRef, (ctx) => {
      const e = getEnrollment(ctx, assertId(enrollmentId, 'enrollmentId'));
      const p = founder(ctx, actorRef, `employee:${e.employeeId}`, 'academy withdrawal');
      if (['ACTIVATED', 'BLOCKED', 'WITHDRAWN'].includes(e.stage)) throw new QandeelError('TERMINAL_STATE', 'this enrollment is already closed', { stage: e.stage });
      for (const o of ctx.db.all('SELECT * FROM academy_attempts WHERE enrollment_id = ? AND state = ?', e.id, 'OPEN').map(mapAttempt)) {
        closeUnfinishedAttempt(ctx, o, 'ENROLLMENT_WITHDRAWN');
        // The closed attempt's Work Item must not run on as ordinary (unconstrained) work (R1 AC-F5).
        const item = getWorkItemRow(ctx, o.workItemId);
        if (!TERMINAL_WORK_ITEM_STATES.has(item.state) && !COMPLETED_FAMILY.has(item.state) && item.terminationRequested === null) txRequestCancellation(ctx, item.id, { reasonCode: 'academy.attempt_closed', actorRef: p.ref });
      }
      ctx.db.run(`UPDATE activation_requests SET state = 'REJECTED', decided_by_ref = ?, decided_at = ? WHERE enrollment_id = ? AND state = 'PENDING_APPROVAL'`, p.ref, ts(ctx), e.id);
      return setStage(ctx, e, 'WITHDRAWN', assertCode(reasonCode, 'reasonCode'), p.ref);
    });
  }

  // --- Activation bridge (Stage 6 §13) --------------------------------------------------------------

  /**
   * The final Activation Approval. It needs authenticated Founder / organizational authority, which
   * does not exist yet: in production it fails closed (FOUNDER_SURFACE_UNAVAILABLE). Approval re-checks
   * the evidence (valid role certification, passed probation review, calibration when required) and the
   * datastore's activation gate checks it once more.
   */
  decideActivation(actorRef: string, requestId: string, input: { decision: 'APPROVE' | 'REJECT'; reasonCode: string }): ActivationRequestRecord {
    return founderAdminWrite(this.#store, 'decide activation', actorRef, (ctx) => {
      const r = mapActivation(ctx.db.get('SELECT * FROM activation_requests WHERE id = ?', assertId(requestId, 'requestId')) ?? notFound('activation request', requestId));
      const p = founder(ctx, actorRef, `employee:${r.employeeId}`, 'activation approval');
      if (r.state !== 'PENDING_APPROVAL') throw new QandeelError('INVALID_TRANSITION', 'only a pending activation request is decided', { requestId: r.id, state: r.state });
      const reason = assertCode(input.reasonCode, 'reasonCode');
      const at = ts(ctx);
      if (input.decision === 'REJECT') {
        ctx.db.run(`UPDATE activation_requests SET state = 'REJECTED', decided_by_ref = ?, decided_at = ? WHERE id = ?`, p.ref, at, r.id);
        appendAudit(ctx, 'academy.activation_rejected', 'activation_request', r.id, { actorRef: p.ref }, 'OK', reason, {});
        // The enrollment closes (the Employee may enroll again for the role); its evidence stays as history.
        const en = getEnrollment(ctx, r.enrollmentId);
        if (en.stage === 'ACTIVATION_APPROVAL') setStage(ctx, en, 'WITHDRAWN', 'ACTIVATION_REJECTED', p.ref);
        return mapActivation(ctx.db.get('SELECT * FROM activation_requests WHERE id = ?', r.id) ?? {});
      }
      const emp = getEmployeeRow(ctx, r.employeeId);
      const cert = liveCertifications(ctx, emp.id, true).find((c) => c.id === r.certificationId);
      if (!cert || cert.status !== 'VALID' || cert.roleRef !== emp.roleRef) throw new QandeelError('EMPLOYEE_NOT_ELIGIBLE', 'activation needs a VALID certification for the Employee\'s current role', { reason: 'CERTIFICATION_NOT_VALID' });
      if (ctx.db.get<{ d: string }>('SELECT decision AS d FROM probation_reviews WHERE id = ?', r.probationReviewId)?.d !== 'PASS') throw new QandeelError('EMPLOYEE_NOT_ELIGIBLE', 'activation needs a passed probation review', { reason: 'PROBATION_NOT_PASSED' });
      // D-C3-19: a designated role's Founder Calibration is a pre-activation requirement: this enrollment's
      // calibration must be APPROVED now (pending, rejected or absent refuses), whatever the request recorded.
      const en = getEnrollment(ctx, r.enrollmentId);
      const calibration = ctx.db.get<{ id: string; state: 'PENDING' | 'APPROVED' | 'REJECTED' }>('SELECT id, state FROM founder_calibrations WHERE enrollment_id = ?', en.id);
      const calibrationGap = calibrationActivationGap(programDef(ctx, en.programVersionId), calibration?.state ?? null);
      if (calibrationGap !== null) throw new QandeelError('EMPLOYEE_NOT_ELIGIBLE', 'activation of this role needs an approved Founder Calibration', { reason: calibrationGap });
      if (r.calibrationId !== null && r.calibrationId !== calibration?.id) throw new QandeelError('EMPLOYEE_NOT_ELIGIBLE', 'the calibration does not belong to this activation evidence', { reason: 'CALIBRATION_MISMATCH' });
      // The request records the calibration it was approved with (evidence; the datastore gate re-checks it).
      ctx.db.run(`UPDATE activation_requests SET state = 'APPROVED', calibration_id = ?, decided_by_ref = ?, decided_at = ? WHERE id = ?`, calibration?.state === 'APPROVED' ? calibration.id : null, p.ref, at, r.id);
      if (emp.state === 'SHADOW' || emp.state === 'PROBATION') {
        setEmployeeState(ctx, emp, 'ACTIVE', 'ACADEMY_ACTIVATION_APPROVED', p.ref, [...emp.qualificationRefs.filter((q) => !q.startsWith('academy:')), `academy:${cert.id}`, `probation:${r.probationReviewId}`, `activation:${r.id}`]);
      } else if (emp.state !== 'ACTIVE') {
        throw new QandeelError('INVALID_TRANSITION', 'activation applies to an Employee in SHADOW or PROBATION', { state: emp.state });
      }
      ctx.db.run(`UPDATE activation_requests SET state = 'CONSUMED' WHERE id = ?`, r.id);
      const e = getEnrollment(ctx, r.enrollmentId);
      if (e.stage === 'ACTIVATION_APPROVAL') setStage(ctx, e, 'ACTIVATED', 'ACTIVATION_APPROVED', p.ref);
      appendAudit(ctx, 'academy.activation_approved', 'activation_request', r.id, { actorRef: p.ref }, 'OK', reason, { employeeId: emp.id, certificationId: cert.id });
      return mapActivation(ctx.db.get('SELECT * FROM activation_requests WHERE id = ?', r.id) ?? {});
    });
  }

  /** Material change (role, policy, tools, authority, reasoning profile, runtime, market): certifications of a role become REVIEW_DUE. */
  requireRecertification(actorRef: string, roleRef: string, reasonCode: string): number {
    return founderAdminWrite(this.#store, 'require recertification', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'recertification');
      const reason = assertCode(reasonCode, 'reasonCode');
      let n = 0;
      for (const c of ctx.db.all(`SELECT * FROM certifications WHERE role_ref = ? AND status = 'VALID'`, assertOpaqueRef(roleRef, 'roleRef')).map(mapCertification)) {
        ctx.db.run(`UPDATE certifications SET status = 'REVIEW_DUE', reason_code = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, reason, ts(ctx), c.id, c.version);
        ctx.db.run('INSERT INTO certification_history (certification_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', c.id, c.version + 1, 'VALID', 'REVIEW_DUE', reason, p.ref, ts(ctx));
        n++;
      }
      appendAudit(ctx, 'certification.recertification_required', 'governance', 'academy', { actorRef: p.ref }, 'OK', reason, { certifications: n });
      return n;
    });
  }

  revokeCertification(actorRef: string, certificationId: string, reasonCode: string): CertificationRecord {
    return founderAdminWrite(this.#store, 'revoke certification', actorRef, (ctx) => {
      const c = mapCertification(ctx.db.get('SELECT * FROM certifications WHERE id = ?', assertId(certificationId, 'certificationId')) ?? notFound('certification', certificationId));
      const p = founder(ctx, actorRef, `employee:${c.employeeId}`, 'certification revocation');
      if (!['VALID', 'REVIEW_DUE'].includes(c.status)) throw new QandeelError('TERMINAL_STATE', 'this certification is no longer live', { status: c.status });
      const reason = assertCode(reasonCode, 'reasonCode');
      ctx.db.run(`UPDATE certifications SET status = 'REVOKED', reason_code = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, reason, ts(ctx), c.id, c.version);
      ctx.db.run('INSERT INTO certification_history (certification_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', c.id, c.version + 1, c.status, 'REVOKED', reason, p.ref, ts(ctx));
      appendAudit(ctx, 'certification.revoked', 'certification', c.id, { actorRef: p.ref }, 'OK', reason, { employeeId: c.employeeId });
      // D-C3-18: losing the current-role certification ends ordinary duty now (ACTIVE → RETRAINING).
      enforceRoleCertification(ctx, getEmployeeRow(ctx, c.employeeId));
      return mapCertification(ctx.db.get('SELECT * FROM certifications WHERE id = ?', c.id) ?? {});
    });
  }

  // --- Reads -------------------------------------------------------------------------------------------

  enrollment(id: Id): EnrollmentRecord {
    return this.#read((ctx) => getEnrollment(ctx, id));
  }

  stageHistory(enrollmentId: Id): { version: number; fromStage: string | null; toStage: string; reasonCode: string }[] {
    return this.#read((ctx) => ctx.db.all<{ version: number; from_stage: string | null; to_stage: string; reason_code: string }>('SELECT * FROM academy_stage_history WHERE enrollment_id = ? ORDER BY version', enrollmentId).map((r) => ({ version: Number(r.version), fromStage: r.from_stage, toStage: r.to_stage, reasonCode: r.reason_code })));
  }

  attempts(enrollmentId: Id): AttemptRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM academy_attempts WHERE enrollment_id = ? ORDER BY created_at, id', enrollmentId).map(mapAttempt));
  }

  attempt(id: Id): AttemptRecord {
    return this.#read((ctx) => getAttempt(ctx, id));
  }

  dimensionResults(attemptId: Id): { dimension: string; scorePct: number; evaluatorKind: string; evaluatorRef: string }[] {
    return this.#read((ctx) => ctx.db.all<{ dimension: string; score_pct: number; evaluator_kind: string; evaluator_ref: string }>('SELECT * FROM academy_dimension_results WHERE attempt_id = ? ORDER BY dimension', attemptId).map((r) => ({ dimension: r.dimension, scorePct: Number(r.score_pct), evaluatorKind: r.evaluator_kind, evaluatorRef: r.evaluator_ref })));
  }

  remediations(enrollmentId: Id): RemediationRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM academy_remediations WHERE enrollment_id = ? ORDER BY created_at, id', enrollmentId).map(mapRemediation));
  }

  exposures(employeeId: Id, scenarioId: Id): number {
    return this.#read((ctx) => Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_scenario_exposures WHERE employee_id = ? AND scenario_id = ?', employeeId, scenarioId)?.n ?? 0));
  }

  certifications(employeeId: Id): CertificationRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM certifications WHERE employee_id = ? ORDER BY issued_at, id', employeeId).map(mapCertification));
  }

  certificationHistory(id: Id): { version: number; fromStatus: string | null; toStatus: string; reasonCode: string }[] {
    return this.#read((ctx) => ctx.db.all<{ version: number; from_status: string | null; to_status: string; reason_code: string }>('SELECT * FROM certification_history WHERE certification_id = ? ORDER BY version', id).map((r) => ({ version: Number(r.version), fromStatus: r.from_status, toStatus: r.to_status, reasonCode: r.reason_code })));
  }

  activationRequests(employeeId: Id): ActivationRequestRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM activation_requests WHERE employee_id = ? ORDER BY created_at, id', employeeId).map(mapActivation));
  }

  healthCounts(): AcademyHealth {
    return this.#read((ctx) => {
      const n = (sql: string): number => Number(ctx.db.get<{ n: number }>(sql)?.n ?? 0);
      const group = (sql: string): Record<string, number> => Object.fromEntries(ctx.db.all<{ s: string; n: number }>(sql).map((r) => [r.s, Number(r.n)]));
      return {
        enrollmentsByStage: group('SELECT stage AS s, COUNT(*) AS n FROM academy_enrollments GROUP BY stage'),
        blocked: n(`SELECT COUNT(*) AS n FROM academy_enrollments WHERE stage = 'BLOCKED'`),
        attemptsFailed: n(`SELECT COUNT(*) AS n FROM academy_attempts WHERE outcome = 'FAIL'`),
        attemptsAwaitingEvaluation: n(`SELECT COUNT(*) AS n FROM academy_attempts WHERE state = 'OPEN'`),
        remediationsOpen: n(`SELECT COUNT(*) AS n FROM academy_remediations WHERE state <> 'RETESTED'`),
        certifications: group('SELECT status AS s, COUNT(*) AS n FROM certifications GROUP BY status'),
        calibrationsPending: n(`SELECT COUNT(*) AS n FROM founder_calibrations WHERE state = 'PENDING'`),
        activationApprovalsPending: n(`SELECT COUNT(*) AS n FROM activation_requests WHERE state = 'PENDING_APPROVAL'`),
        capabilityGapsOpen: n(`SELECT COUNT(*) AS n FROM capability_gaps WHERE state = 'OPEN'`),
      };
    });
  }
}

/** Advances the learning path as far as the recorded evidence allows (deterministic; system; in the caller's transaction). */
export function txAdvance(ctx: StoreContext, enrollmentId: string): EnrollmentRecord {
  let e = getEnrollment(ctx, assertId(enrollmentId, 'enrollmentId'));
  for (let i = 0; i < 12; i++) {
    const next = nextStage(ctx, e);
    if (next === null) break;
    const from = e.stage;
    e = setStage(ctx, e, next.to, next.reason, SYSTEM_MIND_REF, next.to === 'BLOCKED' ? next.reason : null);
    if (from === 'RETRY' && e.stage === 'SHADOW_WORK') {
      const rem = ctx.db.get<{ id: string }>(`SELECT id FROM academy_remediations WHERE enrollment_id = ? AND state = 'RETEST_READY' AND probation_review_id IS NOT NULL`, e.id);
      if (rem) remediationState(ctx, rem.id as Id, 'RETEST_READY', 'RETESTED', 'academy.shadow_retest', SYSTEM_MIND_REF);
    }
    if (e.stage === 'CERTIFICATION') issueCertification(ctx, e);
    if (e.stage === 'ACTIVATION_APPROVAL') fileActivationRequest(ctx, e);
  }
  return e;

}

function nextStage(ctx: StoreContext, e: EnrollmentRecord): { to: LearningStage; reason: string } | null {
  const ev = evidence(ctx, e);
  const modules = (pred: (c: string) => boolean): boolean => ev.def.curriculum.filter((m) => pred(m.category)).every((m) => ev.completed.has(m.code));
  // After a retrained SIMULATION failure only the retest and later simulations count (R2-34): the failed
  // simulation it retrained never decides the path again (the ASSESSMENT gate's "retrained" guard, for SIMULATION).
  const sinceRetraining = simulationsSinceRetraining(ctx, e, ev.attempts);
  const sims = sinceRetraining.filter((a) => a.state === 'EVALUATED');
  switch (e.stage) {
    case 'LEARN':
      return modules((c) => c !== 'REAL_CASE_STUDIES') ? { to: 'CASE_STUDIES', reason: 'CURRICULUM_COMPLETED' } : null;
    case 'CASE_STUDIES':
      return modules((c) => c === 'REAL_CASE_STUDIES') ? { to: 'SIMULATION', reason: 'CASE_STUDIES_COMPLETED' } : null;
    case 'SIMULATION':
      return sims.length > 0 && !sinceRetraining.some((a) => a.state === 'OPEN') ? { to: 'FEEDBACK', reason: 'SIMULATION_EVALUATED' } : null;
    case 'FEEDBACK':
      return sims.at(-1)?.outcome === 'PASS' ? { to: 'ASSESSMENT', reason: 'SIMULATION_PASSED' } : { to: 'RETRY', reason: 'SIMULATION_FAILED' };
    case 'RETRY': {
      // Retraining completed → re-test what failed: the simulation, the assessment, or (after a failed
      // probation) new shadow work in a new evidence epoch.
      const rem = ctx.db.get<{ state: string; attempt_id: string | null; probation_review_id: string | null }>('SELECT state, attempt_id, probation_review_id FROM academy_remediations WHERE enrollment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', e.id);
      if (!rem) return null;
      if (rem.probation_review_id !== null) return rem.state === 'RETEST_READY' ? { to: 'SHADOW_WORK', reason: 'RETRAINING_COMPLETED' } : null;
      const failedKind = ev.attempts.find((a) => a.id === rem.attempt_id)?.kind;
      // A simulation retest may already have started from RETRY (the remediation is then RETESTED): it is
      // judged in SIMULATION, which counts only simulations since the retraining.
      if (failedKind === 'SIMULATION') return rem.state === 'RETEST_READY' || rem.state === 'RETESTED' ? { to: 'SIMULATION', reason: 'RETRAINING_COMPLETED' } : null;
      return rem.state === 'RETEST_READY' ? { to: 'ASSESSMENT', reason: 'RETRAINING_COMPLETED' } : null;
    }
    case 'ASSESSMENT': {
      if (ev.blockedDims.length > 0) return { to: 'BLOCKED', reason: 'REPEATED_CRITICAL_FAILURE' };
      const last = ev.attempts.filter((a) => a.kind === 'ASSESSMENT' && a.state === 'EVALUATED').at(-1);
      // A failure already retrained (its remediation is RETEST_READY / RETESTED) never re-triggers RETRY.
      const retrained = last ? ctx.db.get(`SELECT 1 AS x FROM academy_remediations WHERE attempt_id = ? AND state IN ('RETEST_READY', 'RETESTED')`, last.id) !== undefined : false;
      if (last?.outcome === 'FAIL' && !retrained && !ev.attempts.some((a) => a.kind === 'ASSESSMENT' && a.state === 'OPEN')) return { to: 'RETRY', reason: 'ASSESSMENT_FAILED' };
      const cleanHoldout = ev.passed.some((a) => a.holdout && a.holdoutClean);
      return ev.passed.length >= ev.def.assessmentTrials && (!ev.def.holdoutRequired || cleanHoldout) ? { to: 'SHADOW_WORK', reason: 'ASSESSMENT_PASSED' } : null;
    }
    case 'SHADOW_WORK': {
      // Cases of the current evidence epoch only (a failed probation's cases never count again).
      const cases = Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM probation_evidence WHERE enrollment_id = ? AND kind = 'CASE' AND positive = 1 AND epoch = ?`, e.id, e.evidenceEpoch)?.n ?? 0);
      // After EXTEND the next review needs new evidence (D-C3-20); until then the Employee stays in shadow work.
      return cases >= ev.def.probation.minCases && !awaitingEvidenceAfterExtension(ctx, e) ? { to: 'PROBATION_REVIEW', reason: 'SHADOW_CASES_RECORDED' } : null;
    }
    case 'PROBATION_REVIEW':
      if (ev.review?.decision === 'PASS') {
        const gaps = certificationGaps(ev.def, { passedAssessments: ev.passed.length, passedCleanHoldouts: ev.passed.filter((a) => a.holdout && a.holdoutClean).length, probationReviewPassed: true, blocked: ev.blockedDims.length > 0 });
        if (gaps.length > 0) return null;
        // A certification pins exact, current, rolled-out skill versions; without one it waits (typed, audited).
        const missing = ev.def.skillTargets.find((t) => certificationPin(ctx, e.employeeId, t.skillId as Id) === null);
        if (missing) {
          appendAudit(ctx, 'academy.certification_waiting', 'academy_enrollment', e.id, { actorRef: SYSTEM_MIND_REF }, 'REJECTED', 'SKILL_VERSION_UNAVAILABLE', { skillId: missing.skillId });
          return null;
        }
        return { to: 'CERTIFICATION', reason: 'CERTIFICATION_EVIDENCE_COMPLETE' };
      }
      return null;
    case 'CERTIFICATION':
      return ctx.db.get(`SELECT 1 AS ok FROM certifications WHERE enrollment_id = ?`, e.id) ? { to: 'ACTIVATION_APPROVAL', reason: 'CERTIFIED' } : null;
    default:
      return null;
  }
}

/**
 * Starts one attempt (system; in the caller's transaction): exactly one canonical row per (enrollment, kind, trial) and its
 * Work Item. L1-02: an optional output ceiling (default: the processor's own default) and capability topics.
 */
export function txStartAttempt(ctx: StoreContext, enrollmentId: string, input: { scenarioId: string; kind: 'SIMULATION' | 'ASSESSMENT'; taskClass: string; maxOutputTokens?: number }): { attempt: AttemptRecord; workItemId: Id } {
  const e = getEnrollment(ctx, assertId(enrollmentId, 'enrollmentId'));
  const allowedStage = input.kind === 'SIMULATION' ? ['SIMULATION', 'RETRY'] : ['ASSESSMENT'];
  if (!allowedStage.includes(e.stage)) throw new QandeelError('INVALID_TRANSITION', `a ${input.kind} attempt needs stage ${allowedStage.join('/')}`, { stage: e.stage });
  // An open attempt whose Work Item ended without completing never blocks the path: it is voided.
  for (const o of ctx.db.all('SELECT * FROM academy_attempts WHERE enrollment_id = ? AND state = ?', e.id, 'OPEN').map(mapAttempt)) {
    if (['FAILED', 'CANCELLED', 'SUPERSEDED'].includes(getWorkItemRow(ctx, o.workItemId).state)) closeUnfinishedAttempt(ctx, o, 'WORK_NOT_COMPLETED');
  }
  if (ctx.db.get(`SELECT 1 AS x FROM academy_attempts WHERE enrollment_id = ? AND state = 'OPEN'`, e.id)) throw new QandeelError('INVALID_TRANSITION', 'one attempt at a time', { reason: 'ATTEMPT_OPEN' });
  const s = mapScenario(ctx.db.get('SELECT * FROM academy_scenarios WHERE id = ?', assertId(input.scenarioId, 'scenarioId')) ?? notFound('scenario', input.scenarioId));
  if (s.programVersionId !== e.programVersionId || s.status !== 'ACTIVE') throw new QandeelError('VALIDATION_FAILED', 'scenario is not part of this program version', { reason: 'SCENARIO_NOT_IN_PROGRAM' });
  if (!scenarioAllowed(input.kind, s.kind)) throw new QandeelError('VALIDATION_FAILED', `${s.kind} scenarios are not used for ${input.kind}`, { reason: s.kind === 'HOLDOUT' ? 'HOLDOUT_NOT_FOR_PRACTICE' : 'SCENARIO_KIND' });
  const exposed = Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_scenario_exposures WHERE employee_id = ? AND scenario_id = ?', e.employeeId, s.id)?.n ?? 0);
  if (s.kind === 'HOLDOUT' && exposed > 0) throw new QandeelError('VALIDATION_FAILED', 'this holdout was already exposed to the trainee; use a fresh holdout', { reason: 'HOLDOUT_ALREADY_EXPOSED' });
  const trial = Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_attempts WHERE enrollment_id = ? AND kind = ?', e.id, input.kind)?.n ?? 0) + 1;
  const emp = getEmployeeRow(ctx, e.employeeId);
  const { workItem } = txCreateWorkItem(ctx, {
    objective: `QANDEEL Academy ${input.kind.toLowerCase()} attempt`,
    ownerRef: emp.ref,
    processorKind: ACADEMY_TASK,
    processorInput: { taskClass: assertTaskClass(input.taskClass), dataClass: 'D1', instructions: 'QANDEEL Academy attempt: respond to the scenario provided in your context.', ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: assertIntInRange(input.maxOutputTokens, 'maxOutputTokens', 64, 8_192) }) },
  }, {});
  const id = newId();
  ctx.db.run(
    `INSERT INTO academy_attempts (id, enrollment_id, scenario_id, kind, trial_no, work_item_id, holdout, holdout_clean, state, epoch, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, 1, ?)`,
    id, e.id, s.id, input.kind, trial, workItem.id, s.kind === 'HOLDOUT' ? 1 : 0, s.kind === 'HOLDOUT' && exposed === 0 ? 1 : 0, e.evidenceEpoch, ts(ctx),
  );
  // Only an attempt of the failed kind re-tests it: practice in RETRY never consumes a retrained assessment
  // failure's retest (RETESTED would leave RETRY without an exit, R2-34).
  const rem = ctx.db.get<{ id: string }>(`SELECT r.id FROM academy_remediations r JOIN academy_attempts f ON f.id = r.attempt_id WHERE r.enrollment_id = ? AND r.state = 'RETEST_READY' AND f.kind = ?`, e.id, input.kind);
  if (rem) {
    ctx.db.run(`UPDATE academy_remediations SET retest_attempt_id = ? WHERE id = ?`, id, rem.id);
    remediationState(ctx, rem.id as Id, 'RETEST_READY', 'RETESTED', 'academy.retest_started', SYSTEM_MIND_REF);
  }
  appendAudit(ctx, 'academy.attempt_started', 'academy_attempt', id, { actorRef: SYSTEM_MIND_REF }, 'OK', null, { enrollmentId: e.id, kind: input.kind, trial, holdout: s.kind === 'HOLDOUT' });
  return { attempt: getAttempt(ctx, id), workItemId: workItem.id };
}

/** The deterministic rubric of one attempt (system; in the caller's transaction). */
export function txEvaluateDeterministic(ctx: StoreContext, attemptId: string): AttemptRecord {
  const a = getAttempt(ctx, assertId(attemptId, 'attemptId'));
  if (a.state !== 'OPEN') return a;
  const item = getWorkItemRow(ctx, a.workItemId);
  if (!['COMPLETED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'].includes(item.state)) throw new QandeelError('INVALID_TRANSITION', 'the attempt has not finished running', { state: item.state });
  const runs = ctx.db.all<{ id: string; state: string }>('SELECT id, state FROM runs WHERE work_item_id = ? ORDER BY started_at, id', item.id);
  const denials = runs.reduce((n, r) => n + refusals(ctx, r.id), 0);
  // An attempt that never completed has no outcome to score: it is void, never a perfect score. But a
  // refused action is a fact whatever became of the run: it is scored (a critical AUTHORITY_COMPLIANCE
  // failure fails the attempt), so failing the work never hides a breach or buys a free retry.
  if (['FAILED', 'CANCELLED', 'SUPERSEDED'].includes(item.state) || !runs.some((r) => r.state === 'SUCCEEDED')) return closeUnfinishedAttempt(ctx, a, 'WORK_NOT_COMPLETED');
  const spend = Number(ctx.db.get<{ s: number }>('SELECT COALESCE(SUM(economic_micros), 0) AS s FROM usage_records WHERE work_item_id = ?', item.id)?.s ?? 0);
  const budget = Number(ctx.db.get<{ b: number }>('SELECT budget_micros AS b FROM academy_scenarios WHERE id = ?', a.scenarioId)?.b ?? 0);
  const scores: [AssessmentDimension, number][] = [
    ['AUTHORITY_COMPLIANCE', Math.max(0, 100 - 50 * denials)],
    ['COST_DISCIPLINE', budget === 0 || spend <= budget ? 100 : Math.max(0, Math.floor(100 - ((spend - budget) * 100) / budget))],
  ];
  for (const [d, s] of scores) {
    ctx.db.run(`INSERT OR IGNORE INTO academy_dimension_results (attempt_id, dimension, score_pct, evaluator_kind, evaluator_ref, evidence_refs_json, recorded_at) VALUES (?, ?, ?, 'DETERMINISTIC_RUBRIC', ?, ?, ?)`, a.id, d, s, SYSTEM_MIND_REF, JSON.stringify(runs.map((r) => `run:${r.id}`).slice(0, 16)), ts(ctx));
  }
  appendAudit(ctx, 'academy.rubric_evaluated', 'academy_attempt', a.id, { actorRef: SYSTEM_MIND_REF }, 'OK', null, { denials, spend });
  return finalizeAttempt(ctx, a.id);
}

/** Deterministic probation evidence from finished shadow work (system; in the caller's transaction). */
export function txCollectShadowEvidence(ctx: StoreContext, enrollmentId: string): number {
  const e = getEnrollment(ctx, assertId(enrollmentId, 'enrollmentId'));
  let added = 0;
  for (const s of ctx.db.all<{ work_item_id: string }>('SELECT work_item_id FROM academy_shadow_assignments WHERE enrollment_id = ?', e.id)) {
    const item = getWorkItemRow(ctx, s.work_item_id as Id);
    // A refusal is probation evidence whatever became of the work (R1-10): a cancelled / superseded
    // shadow item yields no case, but its refusals are still collected as critical failures.
    const withdrawn = ['CANCELLED', 'SUPERSEDED'].includes(item.state);
    if (!withdrawn && !['COMPLETED', 'FAILED', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'].includes(item.state)) continue;
    const denials = ctx.db.all<{ id: string }>('SELECT id FROM runs WHERE work_item_id = ?', item.id).reduce((n, r) => n + refusals(ctx, r.id), 0);
    const put = (kind: ProbationEvidenceKind, positive: boolean): void => {
      added += ctx.db.run(`INSERT OR IGNORE INTO probation_evidence (id, enrollment_id, kind, work_item_id, positive, recorded_by_kind, recorded_by_ref, epoch, recorded_at) VALUES (?, ?, ?, ?, ?, 'DETERMINISTIC', ?, ?, ?)`, newId(), e.id, kind, item.id, positive ? 1 : 0, SYSTEM_MIND_REF, e.evidenceEpoch, ts(ctx)).changes;
    };
    if (!withdrawn) put('CASE', item.state !== 'FAILED');
    if (denials > 0) put('CRITICAL_FAILURE', false);
  }
  return added;
}

/** Applies the attempt's recorded results once all are in (or a critical dimension already failed). */
function finalizeAttempt(ctx: StoreContext, attemptId: Id): AttemptRecord {
  const a = getAttempt(ctx, attemptId);
  if (a.state !== 'OPEN') return a;
  const e = getEnrollment(ctx, a.enrollmentId);
  const def = programDef(ctx, e.programVersionId);
  const results = ctx.db.all<{ dimension: string; score_pct: number }>('SELECT dimension, score_pct FROM academy_dimension_results WHERE attempt_id = ?', a.id).map((r) => ({ dimension: r.dimension as AssessmentDimension, scorePct: Number(r.score_pct) }));
  const ev = evaluateAttempt(def, results);
  if (ev.outcome === 'INCOMPLETE') return a;
  const at = ts(ctx);
  ctx.db.run(
    `UPDATE academy_attempts SET state = 'EVALUATED', outcome = ?, average_pct = ?, failed_json = ?, critical_failures_json = ?, evaluated_at = ?, version = version + 1 WHERE id = ? AND version = ?`,
    ev.outcome, ev.averagePct, JSON.stringify(ev.failedDimensions), JSON.stringify(ev.criticalFailures), at, a.id, a.version,
  );
  if (ev.outcome === 'FAIL') {
    // Failure → Diagnosis → Targeted Retraining (Stage 6 §9): kept as history, never overwritten.
    const d = diagnose(ev.failedDimensions, def.curriculum);
    const remId = newId();
    ctx.db.run(
      `INSERT INTO academy_remediations (id, enrollment_id, attempt_id, failed_json, critical_failures_json, categories_json, modules_json, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'DIAGNOSED', ?, ?)`,
      remId, e.id, a.id, JSON.stringify(ev.failedDimensions), JSON.stringify(ev.criticalFailures), JSON.stringify(d.categories), JSON.stringify(d.modules), at, at,
    );
    ctx.db.run('INSERT INTO academy_remediation_history (remediation_id, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, NULL, ?, ?, ?, ?)', remId, 'DIAGNOSED', 'ATTEMPT_FAILED', SYSTEM_MIND_REF, at);
  }
  appendAudit(ctx, 'academy.attempt_evaluated', 'academy_attempt', a.id, { actorRef: SYSTEM_MIND_REF }, 'OK', ev.outcome, { averagePct: ev.averagePct, criticalFailures: ev.criticalFailures.length });
  return getAttempt(ctx, a.id);
}

/**
 * Issues the role certification (system) from complete evidence: bound to the program and blueprint
 * versions, pinned skill versions and the evidence IDs; supersedes the Employee's previous live
 * certification for the role; sets passport proficiency; wakes the Employee's capability-gapped work.
 */
function issueCertification(ctx: StoreContext, e: EnrollmentRecord): void {
  if (ctx.db.get('SELECT 1 AS ok FROM certifications WHERE enrollment_id = ?', e.id)) return;
  const ev = evidence(ctx, e);
  const at = ts(ctx);
  const pins = ev.def.skillTargets.map((t) => {
    const version = certificationPin(ctx, e.employeeId, t.skillId as Id);
    if (version === null) throw new QandeelError('VALIDATION_FAILED', 'a certified skill needs an approved, current version', { reason: 'SKILL_VERSION_UNAVAILABLE', skillId: t.skillId });
    return { skillId: t.skillId, skillVersionId: version, proficiency: t.proficiency };
  });
  const review = ev.review;
  const evidenceJson = { attempts: ev.passed.map((a) => a.id), probationReviewId: review?.id ?? null, calibrationId: ev.calibration?.state === 'APPROVED' ? ev.calibration.id : null, programVersionId: e.programVersionId };
  const prior = ctx.db.get<{ id: string; status: string; version: number }>(`SELECT id, status, version FROM certifications WHERE employee_id = ? AND role_ref = ? AND status IN ('VALID', 'REVIEW_DUE')`, e.employeeId, e.roleRef);
  if (prior) {
    ctx.db.run(`UPDATE certifications SET status = 'SUPERSEDED', reason_code = 'RECERTIFIED', version = version + 1, updated_at = ? WHERE id = ?`, at, prior.id);
    ctx.db.run('INSERT INTO certification_history (certification_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', prior.id, prior.version + 1, prior.status, 'SUPERSEDED', 'RECERTIFIED', SYSTEM_MIND_REF, at);
  }
  const id = newId();
  ctx.db.run(
    `INSERT INTO certifications (id, employee_id, role_ref, enrollment_id, program_version_id, blueprint_id, status, evidence_json, skill_pins_json, issued_at, valid_until, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'VALID', ?, ?, ?, ?, 1, ?)`,
    id, e.employeeId, e.roleRef, e.id, e.programVersionId, ev.def.blueprintId, JSON.stringify(evidenceJson), JSON.stringify(pins), at, addDays(at, ev.def.certificationValidityDays), at,
  );
  ctx.db.run(`INSERT INTO certification_history (certification_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, 'VALID', 'CERTIFICATION_ISSUED', ?, ?)`, id, SYSTEM_MIND_REF, at);
  for (const pin of pins) {
    const existing = ctx.db.get('SELECT * FROM passport_entries WHERE employee_id = ? AND skill_id = ?', e.employeeId, pin.skillId);
    if (existing) {
      const pe = mapPassport(existing);
      const proficiency = proficiencyRank(pe.proficiency) > proficiencyRank(pin.proficiency) ? pe.proficiency : pin.proficiency;
      ctx.db.run(
        `UPDATE passport_entries SET skill_version_id = ?, proficiency = ?, status = 'ACTIVE', training_state = 'TRAINED', evidence_refs_json = ?, provenance_ref = ?, last_tested_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
        pin.skillVersionId, proficiency, JSON.stringify([`certification:${id}`]), `certification:${id}`, at, at, pe.id, pe.version,
      );
      ctx.db.run('INSERT INTO passport_history (passport_entry_id, version, skill_version_id, proficiency, status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', pe.id, pe.version + 1, pin.skillVersionId, proficiency, 'ACTIVE', 'CERTIFIED', SYSTEM_MIND_REF, at);
    } else {
      const pid = newId();
      ctx.db.run(
        `INSERT INTO passport_entries (id, employee_id, skill_id, skill_version_id, proficiency, status, training_state, evidence_refs_json, provenance_ref, restrictions_json, last_tested_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', 'TRAINED', ?, ?, '[]', ?, 1, ?, ?)`,
        pid, e.employeeId, pin.skillId, pin.skillVersionId, pin.proficiency, JSON.stringify([`certification:${id}`]), `certification:${id}`, at, at, at,
      );
      ctx.db.run('INSERT INTO passport_history (passport_entry_id, version, skill_version_id, proficiency, status, reason_code, actor_ref, occurred_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?)', pid, pin.skillVersionId, pin.proficiency, 'ACTIVE', 'CERTIFIED', SYSTEM_MIND_REF, at);
    }
  }
  appendAudit(ctx, 'certification.issued', 'certification', id, { actorRef: SYSTEM_MIND_REF }, 'OK', null, { employeeId: e.employeeId, skills: pins.length });
  // Work parked on a capability gap of this Employee is re-evaluated (targeted wake, no polling).
  wakeCapabilityGaps(ctx, e.employeeId, 'certification.issued');
  // Re-pinned passports may lift a skill-directive conflict hold.
  if (pins.length > 0) wakeEmployeeWaits(ctx, e.employeeId, ['SKILL_CONFLICT_REVIEW'], 'certification.issued');
}

/** Files the activation request with its evidence (system). The decision itself needs authenticated authority. */
function fileActivationRequest(ctx: StoreContext, e: EnrollmentRecord): void {
  if (ctx.db.get('SELECT 1 AS ok FROM activation_requests WHERE enrollment_id = ?', e.id)) return;
  const cert = ctx.db.get<{ id: string }>(`SELECT id FROM certifications WHERE enrollment_id = ? AND status = 'VALID'`, e.id);
  const review = ctx.db.get<{ id: string }>(`SELECT id FROM probation_reviews WHERE enrollment_id = ? AND decision = 'PASS' ORDER BY decided_at DESC LIMIT 1`, e.id);
  if (!cert || !review) return;
  const calibration = ctx.db.get<{ id: string }>(`SELECT id FROM founder_calibrations WHERE enrollment_id = ? AND state = 'APPROVED'`, e.id);
  const open = ctx.db.get<{ id: string }>(`SELECT id FROM activation_requests WHERE employee_id = ? AND state IN ('PENDING_APPROVAL', 'APPROVED')`, e.employeeId);
  if (open) {
    appendAudit(ctx, 'academy.activation_request_deferred', 'academy_enrollment', e.id, { actorRef: SYSTEM_MIND_REF }, 'REJECTED', 'ACTIVATION_REQUEST_ALREADY_OPEN', { openRequestId: open.id });
    return;
  }
  const id = newId();
  ctx.db.run(`INSERT INTO activation_requests (id, employee_id, enrollment_id, certification_id, probation_review_id, calibration_id, state, created_at) VALUES (?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?)`, id, e.employeeId, e.id, cert.id, review.id, calibration?.id ?? null, ts(ctx));
  appendAudit(ctx, 'academy.activation_requested', 'activation_request', id, { actorRef: SYSTEM_MIND_REF }, 'OK', 'AWAITING_ACTIVATION_APPROVAL', { employeeId: e.employeeId });
}

/**
 * The skill version a certification pins: the Employee's currently pinned version if it may be newly
 * pinned (eligible, not deprecated), otherwise the newest such version that is not waiting on an
 * unfinished update (a planned update's target is not rolled out; a rolled-back target never returns).
 */
function certificationPin(ctx: StoreContext, employeeId: Id, skillId: Id): Id | null {
  const ok = (id: Id): boolean => {
    const v = getSkillVersionRow(ctx, id);
    const type = ctx.db.get<{ t: string }>('SELECT skill_type AS t FROM skills WHERE id = ?', v.skillId)?.t as Parameters<typeof skillVersionView>[1];
    return pinnable(skillVersionView(v, type));
  };
  const pe = ctx.db.get('SELECT * FROM passport_entries WHERE employee_id = ? AND skill_id = ?', employeeId, skillId);
  const pinned = pe ? mapPassport(pe).skillVersionId : null;
  if (pinned !== null && ok(pinned)) return pinned;
  const held = new Set(ctx.db.all<{ v: string }>(`SELECT to_version_id AS v FROM skill_updates WHERE state IN ('PLANNED', 'ROLLED_BACK', 'CANCELLED')`).map((r) => r.v));
  return (
    ctx.db
      .all<{ id: string }>(`SELECT id FROM skill_versions WHERE skill_id = ? AND pipeline_state IN ('APPROVED', 'TARGETED_LEARNING', 'ROLLED_OUT') ORDER BY created_at DESC, id`, skillId)
      .map((r) => r.id as Id)
      .find((id) => !held.has(id) && ok(id)) ?? null
  );
}

/** Authority refusals of one run (a trainee's attempted breach counts, whichever gate refused it). */
function refusals(ctx: StoreContext, runId: string): number {
  return Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ? AND action IN ('authority.denied', 'tool.refused', 'tool.review_required')`, runId)?.n ?? 0);
}

/**
 * Closes an attempt that will not be scored normally (its work never completed, a new attempt starts, or
 * the enrollment is withdrawn). A refused action is a fact whatever became of the run (R1-10, D-C3-16
 * N2): it is scored first, and a critical AUTHORITY_COMPLIANCE failure fails the attempt. Only an
 * attempt with no refusal is void. Every path that closes an attempt goes through here.
 */
function closeUnfinishedAttempt(ctx: StoreContext, a: AttemptRecord, reason: string): AttemptRecord {
  const runs = ctx.db.all<{ id: string }>('SELECT id FROM runs WHERE work_item_id = ? ORDER BY started_at, id', a.workItemId);
  const denials = runs.reduce((n, r) => n + refusals(ctx, r.id), 0);
  if (denials > 0) {
    ctx.db.run(`INSERT OR IGNORE INTO academy_dimension_results (attempt_id, dimension, score_pct, evaluator_kind, evaluator_ref, evidence_refs_json, recorded_at) VALUES (?, 'AUTHORITY_COMPLIANCE', ?, 'DETERMINISTIC_RUBRIC', ?, ?, ?)`, a.id, Math.max(0, 100 - 50 * denials), SYSTEM_MIND_REF, JSON.stringify(runs.map((r) => `run:${r.id}`).slice(0, 16)), ts(ctx));
    appendAudit(ctx, 'academy.rubric_evaluated', 'academy_attempt', a.id, { actorRef: SYSTEM_MIND_REF }, 'OK', reason, { denials, spend: 0 });
    const scored = finalizeAttempt(ctx, a.id);
    if (scored.state !== 'OPEN') return scored;
  }
  return voidAttempt(ctx, getAttempt(ctx, a.id), reason);
}

function voidAttempt(ctx: StoreContext, a: AttemptRecord, reason: string): AttemptRecord {
  ctx.db.run(`UPDATE academy_attempts SET state = 'VOID', void_reason = ?, version = version + 1 WHERE id = ? AND version = ? AND state = 'OPEN'`, reason, a.id, a.version);
  appendAudit(ctx, 'academy.attempt_voided', 'academy_attempt', a.id, { actorRef: SYSTEM_MIND_REF }, 'OK', reason, { enrollmentId: a.enrollmentId });
  return getAttempt(ctx, a.id);
}

function remediationState(ctx: StoreContext, id: Id, from: string, to: RemediationRecord['state'], reason: string, actorRef: string): void {
  ctx.db.run('UPDATE academy_remediations SET state = ?, updated_at = ? WHERE id = ?', to, ts(ctx), id);
  ctx.db.run('INSERT INTO academy_remediation_history (remediation_id, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?)', id, from, to, reason, actorRef, ts(ctx));
}

/** Content-free counts of the current evidence epoch, as a probation review sees them. */
function probationSummary(ctx: StoreContext, e: EnrollmentRecord) {
  const count = (kind: string, positive: number): number => Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM probation_evidence WHERE enrollment_id = ? AND kind = ? AND positive = ? AND epoch = ?', e.id, kind, positive, e.evidenceEpoch)?.n ?? 0);
  return {
    cases: count('CASE', 1),
    stableQualityCases: count('QUALITY', 1),
    criticalFailures: count('CRITICAL_FAILURE', 0),
    demonstratedLearning: count('DEMONSTRATED_LEARNING', 1),
    costDiscipline: count('COST_DISCIPLINE', 1),
    correctEscalation: count('CORRECT_ESCALATION', 1),
    collaboration: count('COLLABORATION', 1),
  };
}

const positiveEvidence = (s: Record<string, number>): number => Object.entries(s).reduce((n, [k, v]) => (k === 'criticalFailures' ? n : n + Number(v ?? 0)), 0);

/**
 * Founder Decision D-C3-20: after a probation EXTEND, the next review needs at least one new positive
 * evidence item recorded after the extension. The boundary is the EXTEND review row itself (durable,
 * append-only, same epoch): its summary counts what existed then, and evidence is append-only, so a
 * higher positive count now means new evidence. Old evidence stays and still counts alongside it.
 * No numeric amount beyond "at least one" is fixed (Product may tune it later).
 */
function awaitingEvidenceAfterExtension(ctx: StoreContext, e: EnrollmentRecord): boolean {
  const extended = ctx.db.get<{ summary_json: string }>(`SELECT summary_json FROM probation_reviews WHERE enrollment_id = ? AND review_round = ? AND decision = 'EXTEND' AND epoch = ?`, e.id, e.reviewRound - 1, e.evidenceEpoch);
  if (!extended) return false;
  return positiveEvidence(probationSummary(ctx, e)) <= positiveEvidence(JSON.parse(extended.summary_json) as Record<string, number>);
}

function bumpEnrollment(ctx: StoreContext, e: EnrollmentRecord, change: { reviewRound?: number; evidenceEpoch?: number }): EnrollmentRecord {
  const changed = ctx.db.run('UPDATE academy_enrollments SET review_round = ?, evidence_epoch = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', change.reviewRound ?? e.reviewRound, change.evidenceEpoch ?? e.evidenceEpoch, ts(ctx), e.id, e.version).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'enrollment changed concurrently', { enrollmentId: e.id });
  ctx.db.run('INSERT INTO academy_stage_history (enrollment_id, version, from_stage, to_stage, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', e.id, e.version + 1, e.stage, e.stage, change.evidenceEpoch !== undefined ? 'EVIDENCE_EPOCH_OPENED' : 'REVIEW_ROUND_CLOSED', SYSTEM_MIND_REF, ts(ctx));
  return getEnrollment(ctx, e.id);
}

function notFound(what: string, id: string): never {
  throw new QandeelError('NOT_FOUND', `${what} not found`, { id });
}

export type { Timestamp };
