/**
 * COMPANY-TALENT-01 — what a leader does from its own governed run, and the scalable Academy evaluation (D4, D5).
 *
 * - `talent.propose`: a CEO or Director proposes an identity profile, a program, a Skill, a retraining or a Department
 *   budget. A proposal is evidence and a request: an identity / program proposal is an editable DRAFT in the Talent
 *   Catalog; nothing is approved, hired, granted, spent or certified until the Founder decides.
 * - `academy.evaluation.propose`: a qualified manager (ACTIVE, a valid role certification, the evaluation grant) scores
 *   ONE attempt of a direct report the Founder assigned it, from the evaluation Work Item created for it. A practice
 *   attempt's scores apply at once; an assessment / holdout (a critical evaluation: it counts toward certification) waits
 *   for an independent review — by the Founder, or by the evaluator's own qualified manager (`academy.evaluation.review`).
 * - Never self-evaluation: neither the evaluator nor the reviewer is ever the trainee (refused here and by the datastore),
 *   and the reviewer is never the evaluator. CEO and Director trainees are evaluated by the Founder only (strategic
 *   roles), and Founder Calibration stays the Founder's (D6).
 */
import { QandeelError, assertId, isQandeelError, newId, sha256Hex, type Id } from '@qandeel-company/domain';
import { ASSESSMENT_DIMENSIONS, DETERMINISTIC_DIMENSIONS, containsSecretMaterial } from '@qandeel-company/mind';

import { txApplyManagerEvaluation } from './academy.js';
import { txAnswerOf } from './answers.js';
import { getEmployeeRow, txAllocateWorkItemBudget } from './governance-core.js';
import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { liveCertifications } from './mind-core.js';
import { effectiveManagerRefAt, getPosition, primaryAssignmentAt } from './org-core.js';
import type { Fence } from './records.js';
import { txSaveDraft } from './talent-catalog.js';
import { txCreateWorkItem, txTransition } from './work-items.js';

const EVALUATOR_DIMENSIONS = ASSESSMENT_DIMENSIONS.filter((d) => !DETERMINISTIC_DIMENSIONS.includes(d));
const WORK_DONE = ['COMPLETED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'];

type Out = { readonly ref: string } | { readonly refused: string };
const no = (code: string): Out => ({ refused: code });

/** The seat an Employee holds as PRIMARY now (kind, department), or null. */
export function txPrimarySeat(ctx: StoreContext, employeeId: Id): { positionId: Id; kind: string; departmentId: Id | null; roleRef: string } | null {
  const a = primaryAssignmentAt(ctx, employeeId, ts(ctx));
  if (!a) return null;
  const p = getPosition(ctx, a.positionId);
  return { positionId: p.id, kind: p.kind, departmentId: p.departmentId, roleRef: p.roleRef };
}

/** Whether `managerId` is the accountable manager of `employeeId` now (the holder of its seat's reports-to seat). */
export function txIsDirectManager(ctx: StoreContext, managerId: Id, employeeId: Id): boolean {
  return effectiveManagerRefAt(ctx, getEmployeeRow(ctx, employeeId), ts(ctx)) === `employee:${managerId}`;
}

/** A qualified manager: ACTIVE, with a live VALID certification for its own current role. */
export function txQualifiedManager(ctx: StoreContext, employeeId: Id): boolean {
  const e = getEmployeeRow(ctx, employeeId);
  return e.state === 'ACTIVE' && liveCertifications(ctx, e.id, false).some((c) => c.status === 'VALID' && c.roleRef === e.roleRef);
}

const plainObject = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype ? (v as Record<string, unknown>) : null);

/** `talent.propose` (from the leader's run; the grant was checked by the caller). */
export function txTalentPropose(ctx: StoreContext, fence: Fence, e: { id: Id; ref: string }, argsInput: unknown): Out {
  const args = plainObject(argsInput);
  if (!args) return no('INVALID_ARGS');
  for (const k of Object.keys(args)) if (!['kind', 'rationale', 'roleRef', 'departmentCode', 'subjectEmployeeId', 'code', 'definition', 'skill', 'capMoney', 'capTokens'].includes(k)) return no('INVALID_ARGS');
  const seat = txPrimarySeat(ctx, e.id);
  // Only a leader's seat proposes (a title alone proposes nothing).
  if (!seat || (seat.kind !== 'CEO' && seat.kind !== 'DIRECTOR')) return no('SEAT_NOT_HELD');
  const kind = args.kind;
  if (kind !== 'IDENTITY_PROFILE' && kind !== 'ACADEMY_PROGRAM' && kind !== 'SKILL' && kind !== 'RETRAIN' && kind !== 'DEPARTMENT_BUDGET') return no('INVALID_ARGS');
  const rationale = typeof args.rationale === 'string' && args.rationale.trim().length > 0 && args.rationale.length <= 2000 ? args.rationale.trim() : null;
  if (rationale === null) return no('RATIONALE_REQUIRED');
  const payload: Record<string, unknown> = {};
  let roleRef: string | null = null;
  let departmentId: Id | null = null;
  let subjectId: Id | null = null;
  const deptOf = (code: unknown): Id | null => (typeof code === 'string' ? ((ctx.db.get<{ id: string }>(`SELECT id FROM departments WHERE code = ? AND status = 'ACTIVE'`, code)?.id ?? null) as Id | null) : null);
  // A Director proposes for its own Department only; the CEO for the Company.
  const inScope = (dept: Id | null): boolean => seat.kind === 'CEO' || (dept !== null && dept === seat.departmentId);
  if (kind === 'DEPARTMENT_BUDGET') {
    if (seat.kind !== 'CEO') return no('CEO_ONLY');
    departmentId = deptOf(args.departmentCode);
    if (departmentId === null) return no('DEPARTMENT_NOT_FOUND');
    const cap = args.capMoney;
    if (typeof cap !== 'number' || !Number.isSafeInteger(cap) || cap <= 0) return no('INVALID_ARGS');
    payload.capMoney = cap;
    payload.capTokens = typeof args.capTokens === 'number' && Number.isSafeInteger(args.capTokens) && args.capTokens > 0 ? args.capTokens : Math.max(1_000_000, cap * 2);
  } else if (kind === 'RETRAIN') {
    try {
      subjectId = assertId(args.subjectEmployeeId, 'subjectEmployeeId');
    } catch {
      return no('INVALID_ARGS');
    }
    if (subjectId === e.id) return no('SELF_PROPOSAL');
    const subject = getEmployeeRow(ctx, subjectId);
    if (subject.state !== 'ACTIVE') return no('SUBJECT_NOT_ACTIVE');
    if (!inScope(subject.departmentId)) return no('OUT_OF_SCOPE');
    roleRef = subject.roleRef;
    departmentId = subject.departmentId;
  } else {
    roleRef = typeof args.roleRef === 'string' && /^role:[a-z][a-z0-9.-]{1,60}$/.test(args.roleRef) ? args.roleRef : null;
    if (roleRef === null) return no('INVALID_ARGS');
    departmentId = deptOf(args.departmentCode) ?? seat.departmentId;
    if (!inScope(departmentId)) return no('OUT_OF_SCOPE');
    if (kind === 'SKILL') {
      const skill = plainObject(args.skill);
      if (!skill) return no('INVALID_ARGS');
      payload.skill = skill;
    }
  }
  const text = JSON.stringify({ rationale, payload, definition: args.definition ?? null });
  if (containsSecretMaterial(text)) return no('SECRET_MATERIAL');
  if (text.length > 380_000) return no('PROPOSAL_TOO_LARGE');
  const id = newId();
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO talent_proposals (id, kind, proposer_employee_id, proposer_position_id, run_id, subject_employee_id, department_id, role_ref, rationale, payload_json, definition_id, state, decided_by_ref, decided_at, result_ref, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'PROPOSED', NULL, NULL, NULL, 1, ?, ?)`,
    id, kind, e.id, seat.positionId, fence.runId, subjectId, departmentId, roleRef, rationale, JSON.stringify(payload), at, at,
  );
  if (kind === 'IDENTITY_PROFILE' || kind === 'ACADEMY_PROGRAM') {
    // The proposed content becomes an editable draft of the Talent Catalog (validated at submission, approved by the Founder).
    const body = plainObject(args.definition);
    if (!body || body.roleRef !== roleRef) return no('INVALID_ARGS');
    try {
      const d = txSaveDraft(ctx, e.ref, { kind, body, code: args.code, proposalId: id as Id });
      ctx.db.run('UPDATE talent_proposals SET definition_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = 1', d.id, at, id);
    } catch (error) {
      if (isQandeelError(error, 'VALIDATION_FAILED')) return no('INVALID_DEFINITION');
      throw error;
    }
  }
  appendAudit(ctx, 'talent.proposed', 'talent_proposal', id, { actorRef: e.ref }, 'OK', kind, { proposerEmployeeId: e.id });
  return { ref: `talent_proposal:${id}` };
}

/** The scores a manager states: every evaluator dimension 0..100, and every competency the program assesses. */
function parseScores(args: Record<string, unknown>, competencyCodes: readonly string[]): { dimensions: Record<string, number>; competencies: Record<string, number> } | null {
  const dims = plainObject(args.dimensions);
  const comps = args.competencies === undefined ? {} : plainObject(args.competencies);
  if (!dims || !comps) return null;
  const pct = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
  if (Object.keys(dims).length !== EVALUATOR_DIMENSIONS.length || EVALUATOR_DIMENSIONS.some((d) => !pct(dims[d]))) return null;
  if (Object.keys(comps).length !== competencyCodes.length || competencyCodes.some((c) => !pct(comps[c]))) return null;
  return { dimensions: Object.fromEntries(EVALUATOR_DIMENSIONS.map((d) => [d, dims[d] as number])), competencies: Object.fromEntries(competencyCodes.map((c) => [c, comps[c] as number])) };
}

function competencyCodesOf(ctx: StoreContext, enrollmentId: string): string[] {
  const def = ctx.db.get<{ d: string }>('SELECT v.definition_json AS d FROM academy_enrollments n JOIN academy_program_versions v ON v.id = n.program_version_id WHERE n.id = ?', enrollmentId)?.d;
  const parsed = def ? (JSON.parse(def) as { competencies?: { code: string }[] }) : {};
  return (parsed.competencies ?? []).map((c) => c.code);
}

/** `academy.evaluation.propose`: the assigned manager's scores, from the evaluation Work Item created for it. */
export function txManagerEvaluationPropose(ctx: StoreContext, fence: Fence, e: { id: Id; ref: string }, workItemId: Id, argsInput: unknown): Out {
  const args = plainObject(argsInput);
  if (!args) return no('INVALID_ARGS');
  const m = ctx.db.get<{ id: string; evaluator_employee_id: string; trainee_employee_id: string; work_item_id: string | null; state: string; review_required: number; enrollment_id: string; attempt_id: string }>('SELECT * FROM academy_manager_evaluations WHERE id = ?', typeof args.evaluationId === 'string' ? args.evaluationId : '');
  if (!m) return no('EVALUATION_NOT_FOUND');
  if (m.evaluator_employee_id !== e.id || m.work_item_id !== workItemId) return no('NOT_THE_ASSIGNED_EVALUATOR');
  if (m.trainee_employee_id === e.id) return no('SELF_EVALUATION');
  if (m.state !== 'ASSIGNED') return no('EVALUATION_NOT_OPEN');
  if (!txQualifiedManager(ctx, e.id) || !txIsDirectManager(ctx, e.id, m.trainee_employee_id as Id)) return no('NOT_A_QUALIFIED_MANAGER');
  const scores = parseScores(args, competencyCodesOf(ctx, m.enrollment_id));
  if (!scores) return no('SCORES_INCOMPLETE');
  const at = ts(ctx);
  const applyNow = m.review_required === 0;
  ctx.db.run(`UPDATE academy_manager_evaluations SET scores_json = ?, proposed_at = ?, state = ?, updated_at = ? WHERE id = ? AND state = 'ASSIGNED'`, JSON.stringify(scores), at, applyNow ? 'APPLIED' : 'PROPOSED', at, m.id);
  appendAudit(ctx, 'academy.manager_evaluation_proposed', 'academy_manager_evaluation', m.id, { actorRef: e.ref }, 'OK', applyNow ? 'APPLIED' : 'AWAITING_REVIEW', { attemptId: m.attempt_id });
  if (applyNow) txApplyManagerEvaluation(ctx, m.id as Id);
  return { ref: `academy_manager_evaluation:${m.id}` };
}

/**
 * The independent review of a manager's assessment evaluation. `reviewerRef` is the Founder, or an Employee that is the
 * evaluator's own qualified manager (checked by the caller for an Employee). CONFIRM applies the scores; REJECT closes
 * the evaluation (the attempt stays open for another evaluation).
 */
export function txReviewManagerEvaluation(ctx: StoreContext, evaluationId: Id, reviewerRef: string, decision: 'CONFIRM' | 'REJECT'): Id {
  const m = ctx.db.get<{ id: string; evaluator_employee_id: string; trainee_employee_id: string; state: string; review_required: number; attempt_id: string }>('SELECT * FROM academy_manager_evaluations WHERE id = ?', evaluationId);
  if (!m) throw new QandeelError('NOT_FOUND', 'manager evaluation not found', { evaluationId });
  if (m.state !== 'PROPOSED' || m.review_required !== 1) throw new QandeelError('INVALID_TRANSITION', 'only a proposed assessment evaluation is reviewed', { reason: 'NOT_AWAITING_REVIEW', state: m.state });
  if (reviewerRef === `employee:${m.evaluator_employee_id}` || reviewerRef === `employee:${m.trainee_employee_id}`) throw new QandeelError('SELF_ESCALATION_REFUSED', 'the reviewer is neither the evaluator nor the trainee', { reason: 'REVIEW_NOT_INDEPENDENT' });
  const at = ts(ctx);
  ctx.db.run(`UPDATE academy_manager_evaluations SET state = ?, reviewed_by_ref = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND state = 'PROPOSED'`, decision === 'CONFIRM' ? 'APPLIED' : 'REJECTED', reviewerRef, at, at, m.id);
  appendAudit(ctx, 'academy.manager_evaluation_reviewed', 'academy_manager_evaluation', m.id, { actorRef: reviewerRef }, 'OK', decision, { attemptId: m.attempt_id });
  if (decision === 'CONFIRM') txApplyManagerEvaluation(ctx, m.id as Id);
  return m.id as Id;
}

/** `academy.evaluation.review` from an Employee's run: the evaluator's own qualified manager reviews independently. */
export function txManagerEvaluationReviewAct(ctx: StoreContext, e: { id: Id; ref: string }, argsInput: unknown): Out {
  const args = plainObject(argsInput);
  if (!args || (args.decision !== 'CONFIRM' && args.decision !== 'REJECT') || typeof args.evaluationId !== 'string') return no('INVALID_ARGS');
  const m = ctx.db.get<{ evaluator_employee_id: string; trainee_employee_id: string }>('SELECT evaluator_employee_id, trainee_employee_id FROM academy_manager_evaluations WHERE id = ?', args.evaluationId);
  if (!m) return no('EVALUATION_NOT_FOUND');
  if (e.id === m.evaluator_employee_id || e.id === m.trainee_employee_id) return no('REVIEW_NOT_INDEPENDENT');
  if (!txQualifiedManager(ctx, e.id) || !txIsDirectManager(ctx, e.id, m.evaluator_employee_id as Id)) return no('NOT_THE_EVALUATORS_MANAGER');
  try {
    return { ref: `academy_manager_evaluation:${txReviewManagerEvaluation(ctx, args.evaluationId as Id, e.ref, args.decision)}` };
  } catch (error) {
    if (error instanceof QandeelError) return no(String(error.details.reason ?? error.code));
    throw error;
  }
}

// --- The Founder's assignment of a manager evaluation -----------------------------------------------------------------

export interface EvaluationAssignPlan {
  readonly attemptId: Id;
  readonly attemptKind: string;
  readonly scenarioCode: string;
  readonly scenarioKind: string;
  readonly enrollmentId: Id;
  readonly traineeId: Id;
  readonly evaluatorId: Id;
  readonly answerId: Id;
  readonly answerSha256: string;
  readonly reviewRequired: boolean;
  readonly taskClass: string;
  readonly capMicros: number;
  readonly competencies: readonly string[];
}

/**
 * Validates the Founder's assignment of one attempt to a manager (the preview and the act run the same check): the
 * attempt finished with an answer and is not yet decided; the evaluator is the trainee's direct, qualified manager and
 * holds the evaluation grant and model access for the task class; the trainee is not a CEO / Director (strategic roles
 * are evaluated by the Founder); the evaluator's envelope covers the cap. Nothing runs before the confirmation.
 */
export function txPlanEvaluationAssign(ctx: StoreContext, input: { attemptId: unknown; evaluatorEmployeeId: unknown; taskClass?: unknown; capMicros?: unknown }): EvaluationAssignPlan {
  const refuse = (reason: string, message: string): never => {
    throw new QandeelError('VALIDATION_FAILED', message, { reason });
  };
  const attemptId = assertId(input.attemptId, 'attemptId');
  const a = ctx.db.get<{ state: string; work_item_id: string; enrollment_id: string; kind: string; scenario_id: string }>('SELECT state, work_item_id, enrollment_id, kind, scenario_id FROM academy_attempts WHERE id = ?', attemptId);
  if (!a) throw new QandeelError('NOT_FOUND', 'attempt not found', { attemptId });
  if (a.state !== 'OPEN') refuse('ATTEMPT_DECIDED', 'this attempt already has its outcome');
  if (!WORK_DONE.includes(getWorkItemRow(ctx, a.work_item_id as Id).state)) refuse('ATTEMPT_RUNNING', 'the attempt has not finished running');
  const answer = txAnswerOf(ctx, a.work_item_id as Id);
  if (!answer) refuse('NO_ANSWER', 'an attempt without an answer is closed deterministically, never evaluated');
  const en = ctx.db.get<{ employee_id: string }>('SELECT employee_id FROM academy_enrollments WHERE id = ?', a.enrollment_id);
  const traineeId = String(en?.employee_id) as Id;
  const evaluatorId = assertId(input.evaluatorEmployeeId, 'evaluatorEmployeeId');
  if (evaluatorId === traineeId) refuse('SELF_EVALUATION', 'an Employee never evaluates itself');
  const traineeSeat = txPrimarySeat(ctx, traineeId);
  if (traineeSeat && (traineeSeat.kind === 'CEO' || traineeSeat.kind === 'DIRECTOR')) refuse('STRATEGIC_ROLE_FOUNDER_ONLY', 'a CEO or Director trainee is evaluated by the Founder');
  if (!txIsDirectManager(ctx, evaluatorId, traineeId)) refuse('NOT_THE_DIRECT_MANAGER', 'only the trainee\'s direct manager evaluates it');
  if (!txQualifiedManager(ctx, evaluatorId)) refuse('MANAGER_NOT_QUALIFIED', 'the manager must be ACTIVE with a valid certification for its own role');
  const at = ts(ctx);
  if (!ctx.db.get(`SELECT 1 AS x FROM permission_grants WHERE employee_id = ? AND capability = 'org.academy.evaluate' AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > ?)`, evaluatorId, at)) refuse('NO_EVALUATION_GRANT', 'the manager holds no Academy evaluation grant (leadership policy)');
  const taskClass = typeof input.taskClass === 'string' && input.taskClass.length > 0 ? input.taskClass : 'academy.attempt';
  if (!ctx.db.get(`SELECT 1 AS x FROM permission_grants WHERE employee_id = ? AND capability = 'model.invoke' AND status = 'ACTIVE' AND resource_scope IN (?, '*')`, evaluatorId, taskClass)) refuse('NO_MODEL_ACCESS', 'the manager has no model access for this task class');
  const capMicros = input.capMicros === undefined || input.capMicros === null ? 20_000 : input.capMicros;
  if (typeof capMicros !== 'number' || !Number.isSafeInteger(capMicros) || capMicros <= 0 || capMicros > 5_000_000) refuse('CAP', 'the evaluation cap is a bounded positive amount');
  const sc = ctx.db.get<{ code: string; kind: string }>('SELECT code, kind FROM academy_scenarios WHERE id = ?', a.scenario_id);
  if (ctx.db.get(`SELECT 1 AS x FROM academy_manager_evaluations WHERE attempt_id = ? AND state IN ('ASSIGNED', 'PROPOSED', 'APPLIED')`, attemptId)) refuse('EVALUATION_OPEN', 'this attempt already has an open manager evaluation');
  return {
    attemptId, attemptKind: a.kind, scenarioCode: String(sc?.code ?? ''), scenarioKind: String(sc?.kind ?? ''), enrollmentId: a.enrollment_id as Id, traineeId, evaluatorId,
    answerId: (answer as { id: Id }).id, answerSha256: sha256Hex((answer as { body: string }).body), reviewRequired: a.kind === 'ASSESSMENT', taskClass, capMicros: Number(capMicros), competencies: competencyCodesOf(ctx, a.enrollment_id),
  };
}

/** Creates the evaluation and the manager's bounded evaluation Work Item (inside the confirm). */
export function txExecuteEvaluationAssign(ctx: StoreContext, founderRef: string, plan: EvaluationAssignPlan): Id {
  const id = newId();
  const at = ts(ctx);
  const evaluator = getEmployeeRow(ctx, plan.evaluatorId);
  const answer = txAnswerOf(ctx, (ctx.db.get<{ w: string }>('SELECT work_item_id AS w FROM academy_attempts WHERE id = ?', plan.attemptId)?.w ?? '') as Id);
  if (!answer || answer.id !== plan.answerId) throw new QandeelError('INVALID_TRANSITION', 'the answer changed since the preview', { reason: 'ANSWER_CHANGED' });
  const scenario = ctx.db.get<{ content: string }>('SELECT s.content FROM academy_scenarios s JOIN academy_attempts a ON a.scenario_id = s.id WHERE a.id = ?', plan.attemptId)?.content ?? '';
  const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n)} …[truncated]`);
  const instructions = [
    `QANDEEL Academy evaluation of a direct report's ${plan.attemptKind.toLowerCase()} attempt (evaluation ${id}). You are the evaluator; you never evaluate yourself and you grant nothing.`,
    `Scenario (${plan.scenarioKind}):\n${cut(scenario, 4_000)}`,
    `The candidate's answer:\n${cut(answer.body, 5_500)}`,
    `Score each dimension 0..100 on the answer itself: ${EVALUATOR_DIMENSIONS.join(', ')}.${plan.competencies.length > 0 ? ` Score each specialty competency 0..100: ${plan.competencies.join(', ')}.` : ''} Authority compliance and cost discipline are computed from run facts; never score them.`,
    `Reply with exactly one proposal: {"type":"ORG_ACTION","action":"academy.evaluation.propose","args":{"evaluationId":"${id}","dimensions":{...},"competencies":{...}}}. ${plan.reviewRequired ? 'This is an assessment: your scores count only after an independent review.' : 'This is practice: your scores apply when recorded.'}`,
  ].join('\n\n');
  const { workItem } = txCreateWorkItem(ctx, { objective: 'Academy evaluation of a direct report', ownerRef: evaluator.ref, riskLevel: 'R0', processorKind: 'c2.employee-task', processorInput: { taskClass: plan.taskClass, dataClass: 'D1', maxOutputTokens: 2_048, instructions } }, { actorRef: founderRef });
  ctx.db.run(
    `INSERT INTO academy_manager_evaluations (id, attempt_id, enrollment_id, evaluator_employee_id, trainee_employee_id, work_item_id, answer_id, answer_sha256, review_required, scores_json, state, assigned_by_ref, proposed_at, reviewed_by_ref, reviewed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'ASSIGNED', ?, NULL, NULL, NULL, ?, ?)`,
    id, plan.attemptId, plan.enrollmentId, plan.evaluatorId, plan.traineeId, workItem.id, plan.answerId, plan.answerSha256, plan.reviewRequired ? 1 : 0, founderRef, at, at,
  );
  txAllocateWorkItemBudget(ctx, workItem.id, evaluator.id, { money: plan.capMicros, tokens: 60_000 }, founderRef, 'academy.evaluation');
  txTransition(ctx, workItem.id, { to: 'READY', reasonCode: 'academy.evaluation.released', actorRef: founderRef });
  appendAudit(ctx, 'academy.manager_evaluation_assigned', 'academy_manager_evaluation', id, { actorRef: founderRef }, 'OK', plan.reviewRequired ? 'REVIEW_REQUIRED' : 'PRACTICE', { attemptId: plan.attemptId, evaluatorEmployeeId: plan.evaluatorId });
  return id as Id;
}
