/**
 * Storage-internal C4 review engine (Stage 11; Stage 3 §4; D-C4-05 / D-C4-06). Every function runs inside
 * a write transaction opened by its caller; nothing here opens or awaits one.
 *
 * - A review is bound to a versioned subject: the exact output (Work Item + judged run + content hashes) or
 *   the exact action (the approval-scope fingerprint of tool, arguments, data class, risk and Work Item).
 *   Anything materially different is a new review; a stale decision is refused.
 * - The Review Pool is a registry, not a Department: reviewers are selected from qualifications whose
 *   eligibility (lifecycle, VALID reviewer-role certification, no held / retired pinned Skill, no Quality
 *   Hold, data class, independence, capacity) is decided in SQL BEFORE the ranking LIMIT (R1-12 family).
 * - Reviewers act only through their own review Work Item (governed run); the decision is re-checked at the
 *   decision boundary (eligibility, subject version, plan version) — a prior check never replaces it.
 * - Execute ≠ Review ≠ Approve: nothing here approves an action, and no review makes R4 executable.
 * - Waiting is a state: completion wakes exactly the subject that waits (targeted wake, durable generation).
 */
import { QandeelError, canonicalJson, newId, sha256Hex, type Id, type Timestamp } from '@qandeel-company/domain';
import {
  MAX_OPEN_REVIEWS_PER_REVIEWER,
  calibrationSignal,
  dataRank,
  evaluateRequest,
  judgmentRoute,
  outcomeFromReviewKeys,
  outputSubjectFingerprint,
  parseReviewPlan,
  planAppliesTo,
  reviewerLevelRank,
  reviewerRoleFor,
  type DataClass,
  type OutcomeJudgment,
  type OutcomeVerdict,
  type ReviewOutcome,
} from '@qandeel-company/governance';
import { containsSecretMaterial } from '@qandeel-company/mind';

import { txControlReviewSettled } from './app-controls.js';
import { employeeIdFromRef, getEmployeeRow, txAllocateWorkItemBudget, wakeWorkItemJob } from './governance-core.js';
import { appendAudit, appendEvent, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { effectiveDataClass } from './governed-writes.js';
import { delegationChain, founderPrincipalRef, getPosition, primaryAssignmentAt, seatHolder } from './org-core.js';
import { mapJudgmentAssignment, mapQualification, mapReviewAssignment, mapReviewPlan, mapReviewRequest, type JudgmentAssignmentRecord, type ReviewAssignmentRecord, type ReviewPlanRecord, type ReviewRequestRecord } from './org-records.js';
import { externalEvidenceProblem, isExternalRef } from './external-core.js';
import { assertOutcomeClasses, txRecordOutcome } from './outcome-core.js';
import type { WorkItemRecord } from './records.js';
import type { SqlValue } from './sqlite/connection.js';
import { applyTransition, enqueueJob, resolveDependents } from './work-core.js';
import { txCreateWorkItem } from './work-items.js';

export const SYSTEM_REVIEW_REF = 'system:runtime';
const REVIEW_PROCESSOR = 'c2.employee-task';
const TERMINAL: readonly string[] = ['CLOSED', 'FAILED', 'CANCELLED', 'SUPERSEDED'];

export function activePlan(ctx: StoreContext, workItemId: Id): ReviewPlanRecord | null {
  const r = ctx.db.get(`SELECT * FROM review_plans WHERE work_item_id = ? AND status = 'ACTIVE'`, workItemId);
  return r ? mapReviewPlan(r) : null;
}

export function planInstructions(ctx: StoreContext, planId: Id): string {
  const r = ctx.db.get<{ t: string; s: string }>('SELECT reviewer_instructions AS t, reviewer_instructions_sha256 AS s FROM review_plans WHERE id = ?', planId);
  if (!r || sha256Hex(r.t) !== r.s) throw new QandeelError('STORAGE_INVARIANT', 'review plan instructions failed their integrity check', { planId });
  return r.t;
}

export function getRequest(ctx: StoreContext, id: Id): ReviewRequestRecord {
  const r = ctx.db.get('SELECT * FROM review_requests WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'review request not found', { requestId: id });
  return mapReviewRequest(r);
}

function requestHistory(ctx: StoreContext, id: Id, version: number, from: string | null, to: string, reasonCode: string, actorRef: string): void {
  ctx.db.run('INSERT INTO review_request_history (request_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, version, from, to, reasonCode, actorRef, ts(ctx));
}

export function setRequestState(ctx: StoreContext, r: ReviewRequestRecord, to: ReviewRequestRecord['state'], reasonCode: string, actorRef: string, waitingReason: string | null = null): ReviewRequestRecord {
  const decided = ['SATISFIED', 'REWORK', 'CONFLICT', 'ESCALATED', 'STALE', 'CANCELLED', 'CONSUMED'].includes(to) ? ts(ctx) : null;
  const changed = ctx.db.run(
    'UPDATE review_requests SET state = ?, waiting_reason = ?, decided_at = COALESCE(?, decided_at), version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
    to, waitingReason, decided, ts(ctx), r.id, r.version,
  ).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'review request changed concurrently', { requestId: r.id });
  requestHistory(ctx, r.id, r.version + 1, r.state, to, reasonCode, actorRef);
  appendAudit(ctx, 'review.request_state', 'review_request', r.id, { actorRef }, 'OK', reasonCode, { from: r.state, to, workItemId: r.workItemId });
  return getRequest(ctx, r.id);
}

/**
 * Declares (version 1) or supersedes a Work Item's Review Plan in the caller's transaction. Version 1 must
 * precede the Work Item's first run (datastore trigger, Stage 11 §1). A plan that governs the output makes
 * the Work Item review-required; open requests under the superseded version go STALE (they no longer count).
 */
export function txDeclarePlan(ctx: StoreContext, item: WorkItemRecord, input: unknown, actorRef: string, runId: Id | null): ReviewPlanRecord {
  const plan = parseReviewPlan(input);
  if (TERMINAL.includes(item.state)) throw new QandeelError('TERMINAL_STATE', 'a terminal Work Item gets no review plan', { workItemId: item.id });
  if (containsSecretMaterial(plan.reviewerInstructions)) throw new QandeelError('VALIDATION_FAILED', 'reviewer instructions carry secret material', { field: 'reviewerInstructions' });
  const current = activePlan(ctx, item.id);
  const version = Number(ctx.db.get<{ v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM review_plans WHERE work_item_id = ?', item.id)?.v ?? 0) + 1;
  const freed: (Id | null)[] = [];
  if (current) {
    ctx.db.run(`UPDATE review_plans SET status = 'SUPERSEDED' WHERE id = ?`, current.id);
    for (const r of ctx.db.all(`SELECT * FROM review_requests WHERE plan_id = ? AND state IN ('OPEN', 'SATISFIED', 'CONFLICT', 'ESCALATED')`, current.id).map(mapReviewRequest)) {
      freed.push(...withdrawAll(ctx, r.id, 'PLAN_SUPERSEDED'));
      setRequestState(ctx, r, 'STALE', 'review.plan_superseded', actorRef);
    }
  }
  const id = newId();
  try {
    ctx.db.run(
      `INSERT INTO review_plans (id, work_item_id, version, status, domain, applies_to, keys_json, independence_json, required_evidence_json, rubric_code, rubric_version, reviewer_instructions, reviewer_instructions_sha256, review_task_class, review_budget_money, review_budget_tokens, deadline_at, declared_by_ref, declared_run_id, created_at, operational_judgment)
       VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, item.id, version, plan.domain, plan.appliesTo, JSON.stringify(plan.keys), canonicalJson(plan.independence), JSON.stringify(plan.requiredEvidence), plan.rubric.code, plan.rubric.version,
      plan.reviewerInstructions, sha256Hex(plan.reviewerInstructions), plan.reviewTaskClass, plan.reviewBudget.money, plan.reviewBudget.tokens, plan.deadlineAt, actorRef, runId, ts(ctx), plan.operationalJudgment,
    );
  } catch (error) {
    if (error instanceof QandeelError && error.code === 'STORAGE_INVARIANT') throw new QandeelError('INVALID_TRANSITION', 'a review plan is declared before the Work Item first runs', { workItemId: item.id, reason: 'REVIEW_PLAN_AFTER_EXECUTION' });
    throw error;
  }
  if (planAppliesTo(plan.appliesTo, 'OUTPUT') && !item.reviewRequired && !['COMPLETED', 'WAITING_REVIEW', 'REVIEWED', 'OUTCOME_VERIFIED'].includes(item.state)) {
    ctx.db.run('UPDATE work_items SET review_required = 1, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', ts(ctx), item.id, item.version);
  }
  appendAudit(ctx, 'review.plan_declared', 'review_plan', id, { actorRef }, 'OK', null, { workItemId: item.id, version, keys: plan.keys.length, appliesTo: plan.appliesTo, operationalJudgment: plan.operationalJudgment });
  const declared = mapReviewPlan(ctx.db.get('SELECT * FROM review_plans WHERE id = ?', id) ?? {});
  // A subject already waiting for review under this plan is picked up at once.
  if (getWorkItemRow(ctx, item.id).state === 'WAITING_REVIEW') ensureOutputReview(ctx, item.id);
  // R2-02: an executor parked on an action review whose request just went STALE (or that waited for a plan
  // reviewing actions) re-presents its action under this plan — a targeted wake in this transaction.
  wakeStrandedActionWait(ctx, item.id);
  // RR1-2: the slots the superseded reviews held are free again.
  for (const e of new Set(freed)) reviewerCapacityFreed(ctx, e);
  return declared;
}

/**
 * R2-02: the executor's AWAITING_INDEPENDENT_REVIEW wait can no longer resolve on its own when an ACTIVE plan
 * reviews actions but no live ACTION request of the Work Item exists (the one it waited on went STALE, or it
 * waited for such a plan). Its next run re-presents the action to the gate, which opens the request afresh.
 * Guarded by the active plan: a Work Item still without a plan for actions keeps waiting (never a model loop).
 */
export function wakeStrandedActionWait(ctx: StoreContext, workItemId: Id): void {
  const plan = activePlan(ctx, workItemId);
  if (!plan || !planAppliesTo(plan.appliesTo, 'ACTION')) return;
  if (ctx.db.get(`SELECT 1 AS x FROM review_requests WHERE work_item_id = ? AND subject_kind = 'ACTION' AND kind = 'REQUIRED' AND state IN ('OPEN', 'SATISFIED', 'CONFLICT', 'ESCALATED') LIMIT 1`, workItemId)) return;
  wakeWorkItemJob(ctx, workItemId, ['AWAITING_INDEPENDENT_REVIEW'], 'review.plan_changed');
}

// --- Subjects ------------------------------------------------------------------------------------------

/** The judged output of a Work Item right now: its latest succeeded run and the content hashes. */
export function currentOutputSubject(ctx: StoreContext, item: WorkItemRecord): { fingerprint: string; ref: string } {
  const run = ctx.db.get<{ id: string; result_json: string }>(`SELECT id, result_json FROM runs WHERE work_item_id = ? AND state = 'SUCCEEDED' ORDER BY ended_at DESC, rowid DESC LIMIT 1`, item.id);
  const job = ctx.db.get<{ id: string }>(`SELECT id FROM queue_jobs WHERE work_item_id = ? ORDER BY rowid DESC LIMIT 1`, item.id);
  const runRef = run ? `run:${run.id}` : `job:${job?.id ?? item.id}`;
  return {
    fingerprint: outputSubjectFingerprint({
      workItemId: item.id,
      runRef,
      resultSha256: sha256Hex(run?.result_json ?? '{}'),
      objectiveSha256: sha256Hex(item.objective),
      inputSha256: sha256Hex(canonicalJson(item.processorInput)),
    }),
    ref: runRef,
  };
}

/** What the reviewer is shown about the subject (local governed context of the review Work Item, never telemetry). */
function outputSubjectText(ctx: StoreContext, item: WorkItemRecord): string {
  const run = ctx.db.get<{ result_json: string }>(`SELECT result_json FROM runs WHERE work_item_id = ? AND state = 'SUCCEEDED' ORDER BY ended_at DESC, rowid DESC LIMIT 1`, item.id);
  return `Subject: the completed output of Work Item ${item.id} (risk ${item.riskLevel}). Objective: ${item.objective.slice(0, 1500)} Completion evidence: ${(run?.result_json ?? '{}').slice(0, 1500)}`;
}

// --- Reviewer selection (eligibility BEFORE the LIMIT) ------------------------------------------------------

/** Who may review or judge one subject now: the conditions every selection AND every decision re-check share. */
export interface Eligibility {
  readonly domain: string;
  readonly mode: 'ACTIVE' | 'CALIBRATION';
  readonly dataClass: DataClass;
  readonly excluded: readonly string[];
  readonly excludeDepartmentId: Id | null;
  readonly minLevelRank: number;
  /** The plan's `rubric_code@rubric_version` (a RUBRIC Quality Hold on it stops all reliance), or null. */
  readonly rubricRef: string | null;
}

export interface SelectionFilter extends Eligibility {
  readonly onlyEmployeeId: Id | null;
  readonly limit: number;
}

/**
 * R2-07 / R2-08: ONE eligibility predicate (over `reviewer_qualifications q`, `employees e`, `certifications c`)
 * for reviewer and judge selection and for every decision-boundary re-check, so what selection allowed the
 * decision never refuses, and what stops reliance (a RUBRIC hold, a closed envelope) stops it at both. Capacity
 * is the only selection-only condition (an assigned slot is the slot its holder already has).
 */
const ELIGIBLE = `q.domain = ? AND q.mode = ?
          AND e.state = 'ACTIVE'
          AND c.employee_id = q.employee_id AND c.status = 'VALID' AND c.valid_until > ? AND c.role_ref = ?
          AND q.max_data_rank >= ?
          AND (CASE q.level WHEN 'EXPERT' THEN 2 WHEN 'SENIOR' THEN 1 ELSE 0 END) >= ?
          AND q.employee_id NOT IN (SELECT value FROM json_each(?))
          AND (? IS NULL OR e.department_id IS NOT ?)
          AND NOT EXISTS (SELECT 1 FROM quality_holds h WHERE h.state = 'ACTIVE' AND (
                (h.target_kind = 'REVIEWER' AND h.target_ref = 'employee:' || q.employee_id)
             OR (h.target_kind = 'QUALIFICATION' AND h.target_ref = q.id)
             OR (h.target_kind = 'DOMAIN' AND h.target_ref = q.domain)
             OR (h.target_kind = 'RUBRIC' AND ? IS NOT NULL AND h.target_ref = ?)))
          AND NOT EXISTS (SELECT 1 FROM json_each(c.skill_pins_json) p JOIN skill_versions v ON v.id = json_extract(p.value, '$.skillVersionId')
                           WHERE v.freshness IN ('SECURITY_HOLD', 'RETIRED') OR v.integrity <> 'OK')
          AND EXISTS (SELECT 1 FROM budgets b WHERE b.scope = 'EMPLOYEE' AND b.scope_id = q.employee_id AND b.status = 'OPEN')`;

function eligibleParams(ctx: StoreContext, f: Eligibility): SqlValue[] {
  return [f.domain, f.mode, ts(ctx), reviewerRoleFor(f.domain), dataRank(f.dataClass), f.minLevelRank, JSON.stringify(f.excluded), f.excludeDepartmentId, f.excludeDepartmentId, f.rubricRef, f.rubricRef];
}

/** A reviewer's open load (m-13): its assigned review keys AND its assigned judgments. */
const OPEN_LOAD = `((SELECT COUNT(*) FROM review_assignments ra WHERE ra.reviewer_employee_id = q.employee_id AND ra.state = 'ASSIGNED')
              + (SELECT COUNT(*) FROM judgment_assignments ja WHERE ja.judge_employee_id = q.employee_id AND ja.state = 'ASSIGNED'))`;

/**
 * The qualified, independent, available reviewers for one key — every eligibility condition in the WHERE
 * clause, so nothing ineligible can crowd an eligible reviewer out of the bounded page (R1-12 family).
 * Seniority, titles and Positions play no part: only qualification evidence and current state.
 */
export function eligibleReviewers(ctx: StoreContext, f: SelectionFilter): { qualificationId: Id; employeeId: Id; level: string; qualificationVersion: number }[] {
  return ctx.db
    .all<{ qid: string; eid: string; level: string; qv: number }>(
      `SELECT q.id AS qid, q.employee_id AS eid, q.level AS level, q.qualification_version AS qv, ${OPEN_LOAD} AS open_count
         FROM reviewer_qualifications q
         JOIN employees e ON e.id = q.employee_id
         JOIN certifications c ON c.id = q.certification_id
        WHERE ${ELIGIBLE}
          AND (? IS NULL OR q.employee_id = ?)
          AND ${OPEN_LOAD} < ?
        ORDER BY open_count ASC, (CASE q.level WHEN 'EXPERT' THEN 0 WHEN 'SENIOR' THEN 1 ELSE 2 END), q.employee_id
        LIMIT ?`,
      ...eligibleParams(ctx, f), f.onlyEmployeeId, f.onlyEmployeeId, MAX_OPEN_REVIEWS_PER_REVIEWER, Math.max(1, Math.min(50, f.limit)),
    )
    .map((r) => ({ qualificationId: r.qid as Id, employeeId: r.eid as Id, level: r.level, qualificationVersion: Number(r.qv) }));
}

/** The decision-boundary re-check of an assigned reviewer / judge: the shared predicate, capacity excluded. Its qualification version, or null. */
function stillEligible(ctx: StoreContext, qualificationId: Id | null, employeeId: Id, f: Eligibility): number | null {
  if (qualificationId === null) return null;
  const r = ctx.db.get<{ v: number }>(
    `SELECT q.qualification_version AS v FROM reviewer_qualifications q JOIN employees e ON e.id = q.employee_id JOIN certifications c ON c.id = q.certification_id
      WHERE q.id = ? AND q.employee_id = ? AND ${ELIGIBLE}`,
    qualificationId, employeeId, ...eligibleParams(ctx, f),
  );
  return r === undefined ? null : Number(r.v);
}

const rubricRefOf = (plan: ReviewPlanRecord | null): string | null => (plan === null ? null : `${plan.rubricCode}@${plan.rubricVersion}`);

function assignmentsOf(ctx: StoreContext, requestId: Id): ReviewAssignmentRecord[] {
  return ctx.db.all('SELECT * FROM review_assignments WHERE request_id = ? ORDER BY created_at, id', requestId).map(mapReviewAssignment);
}

/** Withdraws every open assignment of a request; the Employees whose slots it freed (the caller wakes them, RR1-2). */
function withdrawAll(ctx: StoreContext, requestId: Id, reasonCode: string): (Id | null)[] {
  const open = assignmentsOf(ctx, requestId).filter((a) => a.state === 'ASSIGNED');
  for (const a of open) withdrawAssignment(ctx, a, reasonCode);
  return open.map((a) => a.reviewerEmployeeId);
}

/**
 * Who must not review this subject: its executor, the delegation chain, and everyone holding or having decided a
 * key of the request (R2-07 / m-12: a reviewer withdrawn for a transient reason — a lifted hold, a reinstated
 * qualification — may return; one whose own review work ended without a decision does not).
 */
function exclusionsFor(ctx: StoreContext, request: ReviewRequestRecord, exceptAssignmentId: Id | null = null, extra: readonly string[] = []): { executor: Id | null; excluded: string[] } {
  const item = getWorkItemRow(ctx, request.workItemId);
  const executor = employeeIdFromRef(item.ownerRef);
  const prior = assignmentsOf(ctx, request.id)
    .filter((a) => a.id !== exceptAssignmentId && (a.state === 'ASSIGNED' || a.state === 'DECIDED' || a.withdrawReason === 'REVIEW_WORK_ENDED'))
    .map((a) => a.reviewerEmployeeId)
    .filter((x): x is Id => x !== null);
  // Oversight is independent of the required review it audits: its reviewers are excluded too.
  const required = request.kind === 'OVERSIGHT'
    ? ctx.db.all<{ e: string }>(`SELECT DISTINCT a.reviewer_employee_id AS e FROM review_assignments a JOIN review_requests r ON r.id = a.request_id WHERE r.work_item_id = ? AND r.kind = 'REQUIRED' AND a.reviewer_employee_id IS NOT NULL`, request.workItemId).map((x) => x.e)
    : [];
  return { executor, excluded: [...new Set([...(executor ? [executor] : []), ...delegationChain(ctx, request.workItemId), ...prior, ...required, ...extra])] };
}

/** The accountable manager of the executor right now: the holder of its primary seat's reports-to seat (or the Founder). */
function managerOf(ctx: StoreContext, executorId: Id | null): { kind: 'FOUNDER' } | { kind: 'EMPLOYEE'; employeeId: Id } | null {
  if (executorId === null) return null;
  const at = ts(ctx);
  const a = primaryAssignmentAt(ctx, executorId, at);
  if (!a) return null;
  const p = getPosition(ctx, a.positionId);
  if (p.reportsToFounder) return { kind: 'FOUNDER' };
  const holder = p.reportsToPositionId === null ? null : seatHolder(ctx, p.reportsToPositionId, at).holder;
  return holder ? { kind: 'EMPLOYEE', employeeId: holder.employeeId } : null;
}

const founderRef = founderPrincipalRef;

/**
 * The reviewer's / judge's input bound: the governed employee-task processor accepts at most this many
 * characters of instructions. R2-11: a subject is never cut to fit — an action subject that does not fit is
 * refused before its request exists (`REVIEW_SUBJECT_TOO_LARGE`); every other subject is bounded by construction.
 */
export const REVIEWER_INPUT_MAX = 12_000;

function reviewerInstructions(ctx: StoreContext, planId: Id, subjectText: string): string {
  const instructions = `${planInstructions(ctx, planId)}\n${subjectText}`;
  if (instructions.length > REVIEWER_INPUT_MAX) throw new QandeelError('STORAGE_INVARIANT', 'a review subject never exceeds the reviewer input bound', { planId, reason: 'REVIEW_SUBJECT_TOO_LARGE' });
  return instructions;
}

/** Creates the reviewer's own governed review Work Item (owned by the reviewer, budgeted within its envelope). */
function reviewWorkItem(ctx: StoreContext, plan: ReviewPlanRecord, request: ReviewRequestRecord, assignmentId: Id, reviewerId: Id, subjectText: string): Id {
  const instructions = reviewerInstructions(ctx, plan.id, subjectText);
  const created = txCreateWorkItem(
    ctx,
    {
      objective: `Independent review ${request.id} (assignment ${assignmentId})`,
      ownerRef: `employee:${reviewerId}`,
      riskLevel: 'R1',
      processorKind: REVIEW_PROCESSOR,
      processorInput: { taskClass: plan.reviewTaskClass, dataClass: request.dataClass, instructions, maxTurns: 4 },
      dedupeKey: `review-assignment:${assignmentId}`,
      ...(plan.deadlineAt !== null ? { dueAt: plan.deadlineAt } : {}),
      initialState: 'PROPOSED',
    },
    { actorRef: SYSTEM_REVIEW_REF },
  );
  txAllocateWorkItemBudget(ctx, created.workItem.id, reviewerId, { money: plan.reviewBudgetMoney, tokens: plan.reviewBudgetTokens }, SYSTEM_REVIEW_REF, 'review.assignment');
  const released = applyTransition(ctx, created.workItem, 'READY', { reasonCode: 'review.assigned', trace: { correlationId: created.workItem.correlationId, actorRef: SYSTEM_REVIEW_REF } });
  enqueueJob(ctx, released, { correlationId: released.correlationId, actorRef: SYSTEM_REVIEW_REF });
  return created.workItem.id;
}

function insertAssignment(ctx: StoreContext, request: ReviewRequestRecord, keyIndex: number, keyKind: ReviewAssignmentRecord['keyKind'], reviewer: { employeeId: Id; qualificationId: Id } | { founderRef: string }, plan: ReviewPlanRecord | null, subjectText: string): Id {
  const id = newId();
  const at = ts(ctx);
  // The reviewer's own governed review Work Item exists before the assignment that names it (the datastore
  // never lets an assignment be re-pointed afterwards).
  const reviewWorkItemId = 'founderRef' in reviewer || plan === null ? null : reviewWorkItem(ctx, plan, request, id, reviewer.employeeId, subjectText);
  if ('founderRef' in reviewer) {
    ctx.db.run(`INSERT INTO review_assignments (id, request_id, key_index, key_kind, reviewer_employee_id, reviewer_ref, qualification_id, review_work_item_id, state, version, created_at, updated_at) VALUES (?, ?, ?, 'FOUNDER', NULL, ?, NULL, NULL, 'ASSIGNED', 1, ?, ?)`, id, request.id, keyIndex, reviewer.founderRef, at, at);
  } else {
    ctx.db.run(
      `INSERT INTO review_assignments (id, request_id, key_index, key_kind, reviewer_employee_id, reviewer_ref, qualification_id, review_work_item_id, state, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ASSIGNED', 1, ?, ?)`,
      id, request.id, keyIndex, keyKind, reviewer.employeeId, `employee:${reviewer.employeeId}`, reviewer.qualificationId, reviewWorkItemId, at, at,
    );
  }
  appendAudit(ctx, 'review.assigned', 'review_assignment', id, { actorRef: SYSTEM_REVIEW_REF }, 'OK', null, { requestId: request.id, keyIndex, keyKind });
  return id;
}

/**
 * R2-11: what every reviewer of the request is shown. An ACTION subject is the durable text written once when
 * the request was created (the whole action and its canonical arguments, exactly what the fingerprint binds) —
 * never rebuilt, never cut. Null: an ACTION request without its durable subject (created before 0011).
 */
function subjectTextFor(ctx: StoreContext, request: ReviewRequestRecord): string | null {
  if (request.subjectKind === 'ACTION') {
    const r = ctx.db.get<{ t: string; s: string }>('SELECT subject_text AS t, subject_sha256 AS s FROM review_action_subjects WHERE request_id = ?', request.id);
    if (r && sha256Hex(r.t) !== r.s) throw new QandeelError('STORAGE_INVARIANT', 'an action review subject failed its integrity check', { requestId: request.id });
    return r?.t ?? null;
  }
  return outputSubjectText(ctx, getWorkItemRow(ctx, request.workItemId));
}

/** Fill order (R2-07): the keys only one principal can hold (MANAGER, FOUNDER) before keys any pool member can. */
const keyFillRank = (kind: string): number => (kind === 'MANAGER' || kind === 'FOUNDER' ? 0 : 1);

/**
 * Fills every unassigned key of an OPEN request with an eligible reviewer (and one shadow / calibration
 * reviewer when available). A key that no eligible reviewer can fill leaves the request OPEN and visible
 * (`REVIEWER_UNAVAILABLE`) — never filled by someone ineligible, never silently skipped.
 */
export function fillAssignments(ctx: StoreContext, request: ReviewRequestRecord): ReviewRequestRecord {
  if (request.state !== 'OPEN') return request;
  const text = subjectTextFor(ctx, request);
  if (text === null) {
    // Fail closed: nobody reviews an action it cannot be shown in full. The request goes STALE and the waiting
    // executor re-presents the action, which opens a request with its durable subject.
    const stale = setRequestState(ctx, request, 'STALE', 'review.subject_missing', SYSTEM_REVIEW_REF);
    const freed = withdrawAll(ctx, request.id, 'SUBJECT_CHANGED');
    wakeStrandedActionWait(ctx, request.workItemId);
    for (const e of new Set(freed)) reviewerCapacityFreed(ctx, e);
    return getRequest(ctx, stale.id);
  }
  const plan = request.planId === null ? null : mapReviewPlan(ctx.db.get('SELECT * FROM review_plans WHERE id = ?', request.planId) ?? {});
  const keys = request.kind === 'OVERSIGHT' ? [{ kind: 'OVERSIGHT' as const }] : (plan?.keys ?? []);
  const domain = plan?.domain ?? ctx.db.get<{ d: string }>(`SELECT domain AS d FROM review_plans WHERE work_item_id = ? ORDER BY version DESC LIMIT 1`, request.workItemId)?.d ?? '';
  if (ctx.db.get(`SELECT 1 AS x FROM quality_holds WHERE state = 'ACTIVE' AND ((target_kind = 'DOMAIN' AND target_ref = ?) OR (target_kind = 'RUBRIC' AND target_ref = ?)) LIMIT 1`, domain, plan ? `${plan.rubricCode}@${plan.rubricVersion}` : '-')) {
    return request.waitingReason === 'QUALITY_HOLD' ? request : setRequestState(ctx, request, 'OPEN', 'review.quality_hold', SYSTEM_REVIEW_REF, 'QUALITY_HOLD');
  }
  const executorDept = (() => {
    const exec = employeeIdFromRef(getWorkItemRow(ctx, request.workItemId).ownerRef);
    return exec ? getEmployeeRow(ctx, exec).departmentId : null;
  })();
  let unfilled = 0;
  const order = keys.map((_, i) => i).sort((x, y) => keyFillRank((keys[x] as { kind: string }).kind) - keyFillRank((keys[y] as { kind: string }).kind) || x - y);
  for (const keyIndex of order) {
    const all = assignmentsOf(ctx, request.id);
    if (all.some((a) => a.keyIndex === keyIndex && a.state === 'ASSIGNED')) continue;
    const decided = all.filter((a) => a.keyIndex === keyIndex && a.state === 'DECIDED').at(-1);
    const lastOutcome = decided ? ctx.db.get<{ o: string }>('SELECT outcome AS o FROM review_decisions WHERE assignment_id = ?', decided.id)?.o : undefined;
    if (decided && lastOutcome !== 'NEEDS_SPECIALIST') continue;
    const key = keys[keyIndex] as { kind: string };
    const { executor, excluded } = exclusionsFor(ctx, request);
    // NEEDS_SPECIALIST: a stronger reviewer than the one who asked for it.
    const minLevelRank = decided && decided.qualificationId ? Math.min(2, reviewerLevelRank((mapQualification(ctx.db.get('SELECT * FROM reviewer_qualifications WHERE id = ?', decided.qualificationId) ?? {})).level) + 1) : 0;
    const filter: SelectionFilter = { domain, mode: 'ACTIVE', dataClass: request.dataClass, excluded, excludeDepartmentId: plan?.excludeSameDepartment ? executorDept : null, minLevelRank, rubricRef: rubricRefOf(plan), onlyEmployeeId: null, limit: 1 };
    let chosen: { employeeId: Id; qualificationId: Id } | { founderRef: string } | null = null;
    if (key.kind === 'FOUNDER') {
      const f = founderRef(ctx);
      chosen = f ? { founderRef: f } : null;
    } else if (key.kind === 'MANAGER') {
      // The executor's accountable manager — who must ALSO hold an active qualification (a title is not review eligibility).
      const m = managerOf(ctx, executor);
      if (m?.kind === 'FOUNDER') {
        const f = founderRef(ctx);
        chosen = f ? { founderRef: f } : null;
      } else if (m?.kind === 'EMPLOYEE' && !excluded.includes(m.employeeId)) {
        chosen = eligibleReviewers(ctx, { ...filter, onlyEmployeeId: m.employeeId, excludeDepartmentId: null })[0] ?? null;
      }
    } else {
      chosen = eligibleReviewers(ctx, filter)[0] ?? null;
    }
    if (chosen === null) {
      unfilled++;
      continue;
    }
    const kind = (key.kind === 'MANAGER' && 'founderRef' in chosen ? 'FOUNDER' : key.kind) as ReviewAssignmentRecord['keyKind'];
    insertAssignment(ctx, request, keyIndex, kind, chosen, plan, text);
  }
  // Calibration: one shadow reviewer in CALIBRATION mode, whose decision never counts (Stage 11 §14).
  if (request.kind === 'REQUIRED' && plan && !assignmentsOf(ctx, request.id).some((a) => a.keyKind === 'SHADOW')) {
    const { excluded } = exclusionsFor(ctx, request);
    const shadow = eligibleReviewers(ctx, { domain, mode: 'CALIBRATION', dataClass: request.dataClass, excluded, excludeDepartmentId: null, minLevelRank: 0, rubricRef: rubricRefOf(plan), onlyEmployeeId: null, limit: 1 })[0];
    if (shadow) insertAssignment(ctx, request, 7, 'SHADOW', shadow, plan, text);
  }
  const want = unfilled > 0 ? 'REVIEWER_UNAVAILABLE' : null;
  const now = getRequest(ctx, request.id);
  return now.waitingReason === want ? now : setRequestState(ctx, now, 'OPEN', want === null ? 'review.assigned' : 'review.reviewer_unavailable', SYSTEM_REVIEW_REF, want);
}

/**
 * Ensures a REQUIRED review request exists for a subject under the Work Item's ACTIVE plan (created and
 * assigned in the caller's transaction). No applicable plan → `PLAN_MISSING`: the subject waits, fail closed.
 */
export function ensureRequest(ctx: StoreContext, s: { item: WorkItemRecord; subjectKind: 'OUTPUT' | 'ACTION'; fingerprint: string; subjectRef: string; dataClass: DataClass; risk: string; actionSubject: string | null }): ReviewRequestRecord | 'PLAN_MISSING' | 'SUBJECT_TOO_LARGE' {
  const plan = activePlan(ctx, s.item.id);
  if (!plan || !planAppliesTo(plan.appliesTo, s.subjectKind)) return 'PLAN_MISSING';
  const live = ctx.db.get(`SELECT * FROM review_requests WHERE work_item_id = ? AND subject_fingerprint = ? AND kind = 'REQUIRED' AND state IN ('OPEN', 'SATISFIED', 'CONFLICT', 'ESCALATED')`, s.item.id, s.fingerprint);
  if (live) {
    const r = mapReviewRequest(live);
    if (r.planId === plan.id) {
      const now = r.state === 'OPEN' ? fillAssignments(ctx, r) : r;
      if (now.state !== 'STALE') return now;
    } else {
      // Reviewed under a superseded plan: that review no longer counts; the subject is reviewed afresh.
      const freed = withdrawAll(ctx, r.id, 'PLAN_SUPERSEDED');
      setRequestState(ctx, r, 'STALE', 'review.plan_superseded', SYSTEM_REVIEW_REF);
      // RR1-2: the slots it held are a wake (before this subject's own request, which competes for them in order).
      for (const e of new Set(freed)) reviewerCapacityFreed(ctx, e);
    }
  }
  // R2-11: an ACTION subject is shown whole with the plan's instructions, or not at all (never cut to fit).
  if (s.subjectKind === 'ACTION' && (s.actionSubject === null || planInstructions(ctx, plan.id).length + 1 + s.actionSubject.length > REVIEWER_INPUT_MAX)) return 'SUBJECT_TOO_LARGE';
  const id = newId();
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO review_requests (id, kind, plan_id, work_item_id, subject_kind, subject_fingerprint, subject_ref, data_class, risk_level, state, version, created_at, updated_at) VALUES (?, 'REQUIRED', ?, ?, ?, ?, ?, ?, ?, 'OPEN', 1, ?, ?)`,
    id, plan.id, s.item.id, s.subjectKind, s.fingerprint, s.subjectRef.slice(0, 161), s.dataClass, s.risk, at, at,
  );
  // Written once, with the request: every fill, refill and reassignment reads exactly this (local governed evidence, never telemetry).
  if (s.subjectKind === 'ACTION' && s.actionSubject !== null) ctx.db.run('INSERT INTO review_action_subjects (request_id, subject_text, subject_sha256, created_at) VALUES (?, ?, ?, ?)', id, s.actionSubject, sha256Hex(s.actionSubject), at);
  requestHistory(ctx, id as Id, 1, null, 'OPEN', 'review.requested', SYSTEM_REVIEW_REF);
  appendAudit(ctx, 'review.requested', 'review_request', id, { actorRef: SYSTEM_REVIEW_REF }, 'OK', null, { workItemId: s.item.id, subjectKind: s.subjectKind });
  return fillAssignments(ctx, getRequest(ctx, id as Id));
}

/** Output review of a Work Item waiting for review (idempotent; called at completion, reconciliation and recovery). */
export function ensureOutputReview(ctx: StoreContext, workItemId: Id): ReviewRequestRecord | 'PLAN_MISSING' | null {
  const item = getWorkItemRow(ctx, workItemId);
  if (item.state !== 'WAITING_REVIEW') return null;
  const subject = currentOutputSubject(ctx, item);
  // The subject's EFFECTIVE class: declared, every assembled context and every tool result (the reviewer sees the output).
  const dataClass = effectiveDataClass(ctx, item.id);
  const r = ensureRequest(ctx, { item, subjectKind: 'OUTPUT', fingerprint: subject.fingerprint, subjectRef: subject.ref, dataClass, risk: item.riskLevel, actionSubject: null });
  return r === 'SUBJECT_TOO_LARGE' ? null : r;
}

// --- Decisions ------------------------------------------------------------------------------------------

export interface DecisionInput {
  readonly outcome: ReviewOutcome;
  readonly reasonCode: string;
  readonly rationale: string | null;
  readonly evidenceRefs: readonly string[];
  /** C6-R1: the reviewer's own outcome judgment (kept only on a counting Employee decision of an output review). */
  readonly outcomeJudgment?: OutcomeJudgment | null;
}

/** Withdraws an open assignment (and ends its review Work Item's pending work) — the key is refilled by the caller. */
export function withdrawAssignment(ctx: StoreContext, a: ReviewAssignmentRecord, reasonCode: string): void {
  if (a.state !== 'ASSIGNED') return;
  ctx.db.run(`UPDATE review_assignments SET state = 'WITHDRAWN', withdraw_reason = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, reasonCode, ts(ctx), a.id, a.version);
  appendAudit(ctx, 'review.withdrawn', 'review_assignment', a.id, { actorRef: SYSTEM_REVIEW_REF }, 'OK', reasonCode, { requestId: a.requestId });
}

/**
 * Records one decision for an assignment, re-checking at THIS boundary that the request is still open, the
 * plan is the one it was bound to, the subject is still the one reviewed and the reviewer is still eligible
 * and independent. Then evaluates the request and applies its consequences in the same transaction.
 */
export function recordDecision(ctx: StoreContext, a: ReviewAssignmentRecord, reviewerRef: string, d: DecisionInput, runId: Id | null): { recorded: boolean; code: string; request: ReviewRequestRecord } {
  const out = decideAssignment(ctx, a, reviewerRef, d, runId);
  // RR1-2: a decision (or a withdrawal at the decision boundary) frees the slot the reviewer held — a wake of the
  // requests and judgments waiting for it, in this same transaction.
  if (a.state === 'ASSIGNED' && a.reviewerEmployeeId !== null && ctx.db.get(`SELECT 1 AS x FROM review_assignments WHERE id = ? AND state <> 'ASSIGNED'`, a.id) !== undefined) {
    reviewerCapacityFreed(ctx, a.reviewerEmployeeId);
    return { ...out, request: getRequest(ctx, out.request.id) };
  }
  return out;
}

function decideAssignment(ctx: StoreContext, a: ReviewAssignmentRecord, reviewerRef: string, d: DecisionInput, runId: Id | null): { recorded: boolean; code: string; request: ReviewRequestRecord } {
  let request = getRequest(ctx, a.requestId);
  if (a.state === 'DECIDED') return { recorded: false, code: 'ALREADY_DECIDED', request };
  if (a.state !== 'ASSIGNED') return { recorded: false, code: 'ASSIGNMENT_WITHDRAWN', request };
  if (request.state !== 'OPEN') {
    withdrawAssignment(ctx, a, 'REQUEST_CLOSED');
    return { recorded: false, code: 'REVIEW_STALE', request };
  }
  // The plan and the subject are the ones this review was bound to (freshness / version binding, Stage 11 §33).
  const plan = request.planId === null ? null : mapReviewPlan(ctx.db.get('SELECT * FROM review_plans WHERE id = ?', request.planId) ?? {});
  if (request.kind === 'REQUIRED' && plan?.status !== 'ACTIVE') {
    withdrawAssignment(ctx, a, 'PLAN_SUPERSEDED');
    request = setRequestState(ctx, request, 'STALE', 'review.plan_superseded', SYSTEM_REVIEW_REF);
    // R2-02: the executor waiting on this action review re-presents it under the active plan.
    if (request.subjectKind === 'ACTION') wakeStrandedActionWait(ctx, request.workItemId);
    return { recorded: false, code: 'REVIEW_STALE', request };
  }
  const item = getWorkItemRow(ctx, request.workItemId);
  const stale = request.subjectKind === 'OUTPUT'
    ? (request.kind === 'REQUIRED' && item.state !== 'WAITING_REVIEW') || currentOutputSubject(ctx, item).fingerprint !== request.subjectFingerprint
    : TERMINAL.includes(item.state);
  if (stale) {
    withdrawAssignment(ctx, a, 'SUBJECT_CHANGED');
    request = setRequestState(ctx, request, 'STALE', 'review.subject_changed', SYSTEM_REVIEW_REF);
    return { recorded: false, code: 'REVIEW_STALE', request };
  }
  // The reviewer's eligibility and independence are decided again now, not inherited from assignment time.
  let qualificationVersion: number | null = null;
  if (a.reviewerEmployeeId !== null) {
    const q = mapQualification(ctx.db.get('SELECT * FROM reviewer_qualifications WHERE id = ?', a.qualificationId) ?? {});
    const { excluded } = exclusionsFor(ctx, request, a.id);
    const exec = employeeIdFromRef(item.ownerRef);
    // The same predicate as selection, except capacity (this very assignment is the slot it holds) — including the
    // exemptions selection made: the manager's own key and the shadow key are not subject to department independence.
    const departmentBound = plan?.excludeSameDepartment === true && exec !== null && a.keyKind !== 'MANAGER' && a.keyKind !== 'SHADOW';
    qualificationVersion = stillEligible(ctx, a.qualificationId, a.reviewerEmployeeId, {
      domain: q.domain, mode: a.keyKind === 'SHADOW' ? 'CALIBRATION' : 'ACTIVE', dataClass: request.dataClass, excluded, excludeDepartmentId: departmentBound ? getEmployeeRow(ctx, exec).departmentId : null, minLevelRank: 0, rubricRef: rubricRefOf(plan),
    });
    if (qualificationVersion === null) {
      withdrawAssignment(ctx, a, 'REVIEWER_NOT_ELIGIBLE');
      request = fillAssignments(ctx, request);
      return { recorded: false, code: 'REVIEWER_NOT_ELIGIBLE', request };
    }
  }
  const counts = a.keyKind === 'SHADOW' ? 0 : 1;
  // C6-R1: an outcome judgment is kept only where it can count (an independent Employee key of an output
  // review); anywhere else it is simply not recorded. Its evidence classes are checked before anything is written.
  const judgment = d.outcomeJudgment && counts === 1 && a.reviewerEmployeeId !== null && request.kind === 'REQUIRED' && request.subjectKind === 'OUTPUT' ? d.outcomeJudgment : null;
  let judgedClasses: string[] = [];
  if (judgment) {
    try {
      judgedClasses = assertOutcomeClasses(judgment.evidenceClasses);
    } catch {
      return { recorded: false, code: 'OUTCOME_EVIDENCE_INVALID', request };
    }
    // C7-A: a reviewer judges from external outcomes only on usable governed evidence bound to THIS Work Item, cited by
    // its own decision (it cannot bind evidence; only the Founder does). Citing external records requires the class.
    const external = d.evidenceRefs.filter(isExternalRef);
    if (judgedClasses.includes('EXTERNAL_OUTCOME') !== (external.length > 0) || external.some((ref) => externalEvidenceProblem(ctx, ref, request.workItemId) !== null)) {
      return { recorded: false, code: 'OUTCOME_EVIDENCE_INVALID', request };
    }
  }
  const id = newId();
  ctx.db.run(
    `INSERT INTO review_decisions (id, assignment_id, request_id, reviewer_ref, reviewer_employee_id, outcome, reason_code, rationale, rationale_sha256, evidence_refs_json, plan_id, plan_version, rubric_code, rubric_version,
       subject_fingerprint, qualification_id, qualification_version, independence_json, counts, run_id, decision_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    id, a.id, request.id, reviewerRef, a.reviewerEmployeeId, d.outcome, d.reasonCode, d.rationale, d.rationale === null ? null : sha256Hex(d.rationale), JSON.stringify(d.evidenceRefs),
    plan?.id ?? null, plan?.version ?? null, plan?.rubricCode ?? null, plan?.rubricVersion ?? null, request.subjectFingerprint, a.qualificationId, qualificationVersion,
    canonicalJson({ executorExcluded: true, delegationChainExcluded: true, distinctFromOtherKeys: true, keyKind: a.keyKind }), counts, runId, ts(ctx),
  );
  if (judgment) ctx.db.run('INSERT INTO review_outcome_judgments (decision_id, request_id, verdict, evidence_classes_json, created_at) VALUES (?, ?, ?, ?, ?)', id, request.id, judgment.verdict, JSON.stringify(judgedClasses), ts(ctx));
  ctx.db.run(`UPDATE review_assignments SET state = 'DECIDED', version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, ts(ctx), a.id, a.version);
  appendAudit(ctx, 'review.decided', 'review_decision', id, { actorRef: reviewerRef }, 'OK', d.outcome, { requestId: request.id, keyKind: a.keyKind, counts: counts === 1, outcomeVerdict: judgment?.verdict ?? null });
  request = counts === 1 ? resolveRequest(ctx, request.id) : getRequest(ctx, request.id);
  return { recorded: true, code: 'RECORDED', request };
}

/**
 * Evaluates a request from its keys' current counting decisions (one deterministic rule, governance kernel)
 * and applies the consequences in this transaction: REVIEWED + dependents (output PASS), rework (output
 * FAIL), a targeted wake of the waiting action (action decided), an explicit Review Conflict (disagreement),
 * escalation (uncertainty), reassignment (NEEDS_SPECIALIST); calibration evidence for shadow reviewers.
 */
export function resolveRequest(ctx: StoreContext, requestId: Id): ReviewRequestRecord {
  let request = getRequest(ctx, requestId);
  if (request.state !== 'OPEN') return request;
  const keyCount = request.kind === 'OVERSIGHT' ? 1 : ((request.planId === null ? null : mapReviewPlan(ctx.db.get('SELECT * FROM review_plans WHERE id = ?', request.planId) ?? {}))?.keys.length ?? 1);
  const decisions = ctx.db
    .all<{ key_index: number; outcome: string; id: string; created_at: string }>(
      `SELECT a.key_index, d.outcome, d.id, d.created_at FROM review_decisions d JOIN review_assignments a ON a.id = d.assignment_id WHERE d.request_id = ? AND d.counts = 1 ORDER BY d.created_at, d.id`,
      request.id,
    )
    .map((r) => ({ keyIndex: Number(r.key_index), outcome: r.outcome as ReviewOutcome, id: r.id as Id }));
  const evaluation = evaluateRequest(keyCount, decisions);
  if (evaluation.state === 'OPEN') {
    if (evaluation.reassign.length > 0) request = fillAssignments(ctx, request);
    return request;
  }
  if (request.kind === 'OVERSIGHT') return applyOversight(ctx, request, evaluation.state, decisions);
  if (evaluation.state === 'CONFLICT') {
    const latest = new Map<number, Id>();
    for (const d of decisions) latest.set(d.keyIndex, d.id);
    ctx.db.run(`INSERT INTO review_conflicts (id, request_id, origin, state, decision_ids_json, created_at) VALUES (?, ?, 'KEY_DISAGREEMENT', 'OPEN', ?, ?)`, newId(), request.id, JSON.stringify([...latest.values()]), ts(ctx));
    appendAudit(ctx, 'review.conflict_opened', 'review_request', request.id, { actorRef: SYSTEM_REVIEW_REF }, 'OK', 'KEY_DISAGREEMENT', { workItemId: request.workItemId });
    return setRequestState(ctx, request, 'CONFLICT', 'review.conflict', SYSTEM_REVIEW_REF);
  }
  // R4 stays Founder-only: a passing review of an R4 subject escalates to the Founder, never satisfies (Stage 3 §4).
  const next = evaluation.state === 'SATISFIED' && request.riskLevel === 'R4' ? 'ESCALATED' : evaluation.state;
  request = setRequestState(ctx, request, next, next === evaluation.state ? `review.${next.toLowerCase()}` : 'review.r4_founder_only', SYSTEM_REVIEW_REF);
  if (next !== evaluation.state) return request;
  if (evaluation.state === 'SATISFIED' || evaluation.state === 'REWORK') {
    calibrate(ctx, request, evaluation.state);
    applyOutcome(ctx, request, evaluation.state, SYSTEM_REVIEW_REF);
  }
  return getRequest(ctx, request.id);
}

/** Consequences of a settled REQUIRED request for its subject (also used by Founder conflict / escalation resolution). */
export function applyOutcome(ctx: StoreContext, request: ReviewRequestRecord, outcome: 'SATISFIED' | 'REWORK', actorRef: string): void {
  const item = getWorkItemRow(ctx, request.workItemId);
  const trace = { correlationId: item.correlationId, actorRef };
  if (request.subjectKind === 'ACTION') {
    // C7-B: a settled review of a Company → App control proposal puts that exact act to the Founder (or ends it).
    txControlReviewSettled(ctx, request, outcome, actorRef);
    // Exactly the waiting Work Item wakes; its next run re-runs the full authority path before any effect.
    wakeWorkItemJob(ctx, item.id, ['AWAITING_INDEPENDENT_REVIEW'], outcome === 'SATISFIED' ? 'review.passed' : 'review.rework');
    return;
  }
  // Output: only the exact subject that was reviewed advances (freshness re-checked here, Stage 11 §33).
  if (item.state !== 'WAITING_REVIEW' || currentOutputSubject(ctx, item).fingerprint !== request.subjectFingerprint) {
    setRequestState(ctx, getRequest(ctx, request.id), 'STALE', 'review.subject_changed', actorRef);
    return;
  }
  if (outcome === 'SATISFIED') {
    const reviewed = applyTransition(ctx, item, 'REVIEWED', { reasonCode: 'review.passed', trace });
    appendEvent(ctx, 'work_item.transitioned', 'work_item', item.id, trace, { reviewRequestId: request.id, outcome: 'REVIEWED' });
    resolveDependents(ctx, reviewed.id, trace);
    // C6-R1: where the plan delegates judgment, the keys that satisfied the review also verify its outcome
    // from their own cited judgments. A Founder resolution (conflict, escalation) leaves the outcome to the Founder.
    const plan = request.planId === null ? null : mapReviewPlan(ctx.db.get('SELECT * FROM review_plans WHERE id = ?', request.planId) ?? {});
    if (actorRef === SYSTEM_REVIEW_REF && plan !== null && judgmentRoute({ planJudgment: plan.operationalJudgment, risk: item.riskLevel }).judge === 'REVIEW_POOL') verifyFromReviewKeys(ctx, request, plan);
  } else {
    const ready = applyTransition(ctx, item, 'READY', { reasonCode: 'review.rework', trace });
    enqueueJob(ctx, ready, trace);
  }
  appendAudit(ctx, outcome === 'SATISFIED' ? 'review.subject_reviewed' : 'review.subject_rework', 'work_item', item.id, trace, 'OK', null, { reviewRequestId: request.id });
}

/**
 * C6-R1: the outcome of a satisfied output review under a plan that delegates judgment, from the passing keys'
 * own cited outcome judgments (never averaged — governance kernel). Keys that gave none leave the outcome
 * unverified; a disagreement is recorded INCONCLUSIVE for the Founder. Verification grants nothing.
 */
function verifyFromReviewKeys(ctx: StoreContext, request: ReviewRequestRecord, plan: ReviewPlanRecord): void {
  const rows = ctx.db.all<{ key_index: number; id: string; verdict: string | null; classes: string | null }>(
    `SELECT a.key_index, d.id, j.verdict, j.evidence_classes_json AS classes FROM review_decisions d JOIN review_assignments a ON a.id = d.assignment_id
       LEFT JOIN review_outcome_judgments j ON j.decision_id = d.id
      WHERE d.request_id = ? AND d.counts = 1 AND d.outcome = 'PASS' ORDER BY d.created_at, d.id`,
    request.id,
  );
  const out = outcomeFromReviewKeys(plan.keys.length, rows.map((r) => ({ keyIndex: Number(r.key_index), verdict: (r.verdict ?? null) as OutcomeVerdict | null })));
  if (out.verdict === null) {
    appendAudit(ctx, 'outcome.unverified', 'work_item', request.workItemId, { actorRef: SYSTEM_REVIEW_REF }, 'OK', out.reason, { reviewRequestId: request.id });
    return;
  }
  const classes = [...new Set(rows.flatMap((r) => (r.classes === null ? [] : (JSON.parse(r.classes) as string[]))))];
  const refs = [`review_request:${request.id}`, ...rows.map((r) => `review_decision:${r.id}`), `work_item:${request.workItemId}`];
  // C7-A: the external records the passing keys cited, re-checked NOW (a source suspended or a binding ended since the
  // decisions makes them unusable). Unusable external evidence never verifies: the outcome goes to the Founder as
  // INCONCLUSIVE (an exception), never silently ACHIEVED / NOT_ACHIEVED on what remains.
  if (classes.includes('EXTERNAL_OUTCOME')) {
    const external = [...new Set(rows.flatMap((r) => (JSON.parse(ctx.db.get<{ refs: string }>('SELECT evidence_refs_json AS refs FROM review_decisions WHERE id = ?', r.id)?.refs ?? '[]') as string[]).filter(isExternalRef)))];
    if (external.length === 0 || external.some((ref) => externalEvidenceProblem(ctx, ref, request.workItemId) !== null)) {
      const rest = classes.filter((c) => c !== 'EXTERNAL_OUTCOME');
      txRecordOutcome(ctx, getWorkItemRow(ctx, request.workItemId), { verdict: 'INCONCLUSIVE', classes: rest.length > 0 ? rest : ['REVIEW_DECISION'], refs, reasonCode: 'review_keys.external_evidence_unusable' }, { kind: 'REVIEW_POOL', reviewRequestId: request.id });
      return;
    }
    refs.push(...external.slice(0, 16));
  }
  txRecordOutcome(ctx, getWorkItemRow(ctx, request.workItemId), { verdict: out.verdict, classes, refs, reasonCode: `review_keys.${out.reason.toLowerCase()}` }, { kind: 'REVIEW_POOL', reviewRequestId: request.id });
}

/** Shadow (calibration) decisions against the authoritative outcome: evidence for the reviewer's trust. */
function calibrate(ctx: StoreContext, request: ReviewRequestRecord, final: 'SATISFIED' | 'REWORK'): void {
  for (const r of ctx.db.all<{ id: string }>(`SELECT d.id FROM review_decisions d JOIN review_assignments a ON a.id = d.assignment_id WHERE d.request_id = ? AND d.counts = 0 AND a.key_kind = 'SHADOW'`, request.id)) {
    recordCalibration(ctx, r.id as Id, final, 'FINAL_OUTCOME', SYSTEM_REVIEW_REF);
  }
}

/**
 * One piece of calibration evidence for one shadow decision, compared against an authoritative outcome (the
 * request's final outcome, or the Founder's own judgement while a domain has no independent reviewer yet).
 * Recorded at most once per decision; a non-committal decision (UNCERTAIN …) is no evidence either way.
 */
export function recordCalibration(ctx: StoreContext, decisionId: Id, final: 'SATISFIED' | 'REWORK', source: 'FINAL_OUTCOME' | 'FOUNDER', actorRef: string): 'AGREE' | 'DISAGREE' | 'NONE' | 'ALREADY_CALIBRATED' {
  const d = ctx.db.get<{ outcome: string; counts: number; qid: string | null; kind: string }>(
    'SELECT d.outcome, d.counts, a.qualification_id AS qid, a.key_kind AS kind FROM review_decisions d JOIN review_assignments a ON a.id = d.assignment_id WHERE d.id = ?',
    decisionId,
  );
  if (!d || d.qid === null || d.kind !== 'SHADOW' || Number(d.counts) !== 0) throw new QandeelError('VALIDATION_FAILED', 'only a shadow (calibration) decision is calibrated', { decisionId });
  if (ctx.db.get('SELECT 1 AS x FROM review_calibrations WHERE decision_id = ?', decisionId)) return 'ALREADY_CALIBRATED';
  const signal = calibrationSignal(d.outcome as ReviewOutcome, final);
  if (signal === 'NONE') return 'NONE';
  const q = mapQualification(ctx.db.get('SELECT * FROM reviewer_qualifications WHERE id = ?', d.qid) ?? {});
  if (q.mode === 'REVOKED') return 'NONE';
  ctx.db.run('INSERT INTO review_calibrations (decision_id, qualification_id, source, signal, actor_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)', decisionId, q.id, source, signal, actorRef, ts(ctx));
  ctx.db.run(
    `UPDATE reviewer_qualifications SET calibration_agreements = calibration_agreements + ?, calibration_disagreements = calibration_disagreements + ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
    signal === 'AGREE' ? 1 : 0, signal === 'DISAGREE' ? 1 : 0, ts(ctx), q.id, q.version,
  );
  ctx.db.run('INSERT INTO reviewer_qualification_history (qualification_id, version, from_mode, to_mode, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', q.id, q.version + 1, q.mode, q.mode, signal === 'AGREE' ? 'CALIBRATION_AGREE' : 'CALIBRATION_DISAGREE', actorRef, ts(ctx));
  appendAudit(ctx, 'review.calibrated', 'reviewer_qualification', q.id, { actorRef }, 'OK', signal, { source, decisionId });
  return signal;
}

/**
 * Independent Oversight never satisfies or bypasses a gate. A FAIL records a governed finding and, where the
 * required review it audits had passed, an explicit Review Conflict for authorized resolution.
 */
function applyOversight(ctx: StoreContext, request: ReviewRequestRecord, state: string, decisions: readonly { id: Id; outcome: ReviewOutcome }[]): ReviewRequestRecord {
  const closed = setRequestState(ctx, request, state === 'SATISFIED' ? 'SATISFIED' : state === 'REWORK' ? 'REWORK' : 'ESCALATED', `oversight.${state.toLowerCase()}`, SYSTEM_REVIEW_REF);
  if (state === 'REWORK') {
    const at = ts(ctx);
    ctx.db.run(`INSERT INTO oversight_findings (id, target_kind, target_ref, severity, state, review_request_id, reason_code, created_by_ref, version, created_at, updated_at) VALUES (?, 'WORK_ITEM', ?, 'HIGH', 'OPEN', ?, 'OVERSIGHT_FAIL', ?, 1, ?, ?)`, newId(), `work_item:${request.workItemId}`, request.id, SYSTEM_REVIEW_REF, at, at);
    const required = ctx.db.get(`SELECT * FROM review_requests WHERE work_item_id = ? AND kind = 'REQUIRED' AND subject_fingerprint = ? AND state = 'SATISFIED'`, request.workItemId, request.subjectFingerprint);
    if (required) {
      const r = mapReviewRequest(required);
      ctx.db.run(`INSERT INTO review_conflicts (id, request_id, origin, state, decision_ids_json, created_at) VALUES (?, ?, 'OVERSIGHT', 'OPEN', ?, ?)`, newId(), r.id, JSON.stringify(decisions.map((d) => d.id)), at);
      setRequestState(ctx, r, 'CONFLICT', 'oversight.conflict', SYSTEM_REVIEW_REF);
    }
    appendAudit(ctx, 'oversight.finding_opened', 'review_request', request.id, { actorRef: SYSTEM_REVIEW_REF }, 'OK', 'OVERSIGHT_FAIL', { workItemId: request.workItemId });
  }
  return getRequest(ctx, closed.id);
}

// --- Action review gate (txToolIntent) ---------------------------------------------------------------------

export type ActionGate =
  | { kind: 'SATISFIED'; requestId: Id }
  | { kind: 'REWORK'; requestId: Id }
  /** The action cannot be shown whole to a reviewer (R2-11): refused, never truncated; a smaller action is a new subject. */
  | { kind: 'REFUSED'; code: 'REVIEW_SUBJECT_TOO_LARGE' }
  | { kind: 'WAIT'; code: 'REVIEW_PLAN_MISSING' | 'REVIEW_PENDING' | 'REVIEW_CONFLICT' | 'REVIEW_ESCALATED'; requestId: Id | null };

/**
 * The independent-review gate of an R2 / R3 action, inside the tool-intent transaction: the review must be
 * of exactly this action (its approval-scope fingerprint), under the Work Item's active plan. A satisfied
 * review is consumed by the one intent it authorized (like an approval's single use). `actionSubject` is the
 * whole action as its reviewers are shown it — stored once with the request (R2-11).
 */
export function actionReviewGate(ctx: StoreContext, s: { item: WorkItemRecord; fingerprint: string; subjectRef: string; dataClass: DataClass; risk: string; actionSubject: string }): ActionGate {
  const plan = activePlan(ctx, s.item.id);
  if (!plan || !planAppliesTo(plan.appliesTo, 'ACTION')) return { kind: 'WAIT', code: 'REVIEW_PLAN_MISSING', requestId: null };
  // A rework verdict on exactly this action refuses it for good, like a rejected approval — under every plan
  // version (R2-01, D-C4-05: a new plan never re-opens a rejected exact action); the model may propose something
  // else, which is a new subject reviewed afresh.
  const live = ctx.db.get(`SELECT 1 AS x FROM review_requests WHERE work_item_id = ? AND subject_fingerprint = ? AND kind = 'REQUIRED' AND state IN ('OPEN', 'SATISFIED', 'CONFLICT', 'ESCALATED')`, s.item.id, s.fingerprint);
  if (!live) {
    const rejected = ctx.db.get<{ id: string }>(`SELECT id FROM review_requests WHERE work_item_id = ? AND subject_fingerprint = ? AND kind = 'REQUIRED' AND state = 'REWORK' LIMIT 1`, s.item.id, s.fingerprint);
    if (rejected) return { kind: 'REWORK', requestId: rejected.id as Id };
  }
  const r = ensureRequest(ctx, { item: s.item, subjectKind: 'ACTION', fingerprint: s.fingerprint, subjectRef: s.subjectRef, dataClass: s.dataClass, risk: s.risk, actionSubject: s.actionSubject });
  if (r === 'PLAN_MISSING') return { kind: 'WAIT', code: 'REVIEW_PLAN_MISSING', requestId: null };
  if (r === 'SUBJECT_TOO_LARGE') return { kind: 'REFUSED', code: 'REVIEW_SUBJECT_TOO_LARGE' };
  if (r.state === 'SATISFIED') return { kind: 'SATISFIED', requestId: r.id };
  if (r.state === 'CONFLICT') return { kind: 'WAIT', code: 'REVIEW_CONFLICT', requestId: r.id };
  if (r.state === 'ESCALATED') return { kind: 'WAIT', code: 'REVIEW_ESCALATED', requestId: r.id };
  return { kind: 'WAIT', code: 'REVIEW_PENDING', requestId: r.id };
}

export function consumeActionReview(ctx: StoreContext, requestId: Id, invocationId: Id): void {
  const r = getRequest(ctx, requestId);
  if (r.state !== 'SATISFIED') throw new QandeelError('REVIEW_STALE', 'the action review is no longer satisfied', { requestId });
  const changed = ctx.db.run(`UPDATE review_requests SET state = 'CONSUMED', resolution_ref = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND state = 'SATISFIED'`, `tool_invocation:${invocationId}`, ts(ctx), r.id, r.version).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'the action review changed concurrently', { requestId });
  requestHistory(ctx, r.id, r.version + 1, 'SATISFIED', 'CONSUMED', 'review.consumed', SYSTEM_REVIEW_REF);
}

/**
 * C7-B: the satisfied review of a Company → App control proposal is consumed by the one revision it authorized (single
 * use, like `consumeActionReview` for a tool intent), in the issuing transaction.
 */
export function consumeControlReview(ctx: StoreContext, requestId: Id, revisionRef: string): void {
  const r = getRequest(ctx, requestId);
  if (r.state !== 'SATISFIED') throw new QandeelError('REVIEW_STALE', 'the control review is no longer satisfied', { requestId });
  const changed = ctx.db.run(`UPDATE review_requests SET state = 'CONSUMED', resolution_ref = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND state = 'SATISFIED'`, revisionRef, ts(ctx), r.id, r.version).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'the control review changed concurrently', { requestId });
  requestHistory(ctx, r.id, r.version + 1, 'SATISFIED', 'CONSUMED', 'review.consumed', SYSTEM_REVIEW_REF);
}

// --- WAIT re-check / wakes --------------------------------------------------------------------------------

/**
 * Lost-wake window of the review wait (R1-06 family): a decision committed while the executor's job was still
 * CLAIMED found nothing to wake. The WAIT settle re-checks in its own transaction and wakes the job when an
 * action review of this Work Item was decided during the run. A spurious wake costs nothing: the gate re-runs.
 */
export function recheckReviewWait(ctx: StoreContext, workItemId: Id, runId: Id): void {
  const started = ctx.db.get<{ s: string }>('SELECT started_at AS s FROM runs WHERE id = ?', runId)?.s;
  if (started === undefined) return;
  const decided = ctx.db.get(`SELECT 1 AS x FROM review_requests WHERE work_item_id = ? AND subject_kind = 'ACTION' AND state IN ('SATISFIED', 'REWORK') AND decided_at >= ? LIMIT 1`, workItemId, started);
  if (decided) wakeWorkItemJob(ctx, workItemId, ['AWAITING_INDEPENDENT_REVIEW'], 'review.rechecked');
  // R2-02: the plan changed during the run (its request went STALE while the job was still claimed). Guarded by an
  // active plan for actions, so a Work Item still waiting for such a plan is never woken into a loop.
  else wakeStrandedActionWait(ctx, workItemId);
}

// --- Reviewer capacity is a wake (RR1-2) -------------------------------------------------------------------

/** The connections currently inside a capacity refill (a nested freeing is covered by the refill already running). */
const refilling = new WeakSet<object>();

/** A pool judgment subject that is being withdrawn right now: never re-drawn by the refill its own withdrawal runs. */
interface JudgmentSubject {
  readonly kind: JudgmentSubjectKind;
  readonly id: Id;
}

/** Some ACTIVE reviewer of the domain has a free slot (keys AND judgments counted, as selection counts them). */
function domainHasFreeSlot(ctx: StoreContext, domain: string): boolean {
  return ctx.db.get(`SELECT 1 AS x FROM reviewer_qualifications q WHERE q.domain = ? AND q.mode = 'ACTIVE' AND ${OPEN_LOAD} < ? LIMIT 1`, domain, MAX_OPEN_REVIEWS_PER_REVIEWER) !== undefined;
}

/**
 * RR1-2: the OPEN requests of a domain (every domain: null) waiting for a reviewer are filled — REQUIRED requests
 * (blocking gates: an executor's action, an output's completion) before Independent Oversight, oldest first (insertion order breaks
 * a timestamp tie: a deterministic FIFO). Each is
 * re-read before its fill (never a stale version) and filled through `fillAssignments`, whose selection decides every
 * eligibility condition in SQL before its LIMIT; a domain refill stops as soon as no ACTIVE reviewer of the domain
 * has a free slot. Bounded.
 */
function refillWaitingRequests(ctx: StoreContext, domain: string | null, limit: number): number {
  let n = 0;
  for (const { id } of ctx.db.all<{ id: string }>(
    `SELECT r.id FROM review_requests r
      WHERE r.state = 'OPEN' AND r.waiting_reason IS NOT NULL
        AND (? IS NULL OR COALESCE((SELECT p.domain FROM review_plans p WHERE p.id = r.plan_id), (SELECT p2.domain FROM review_plans p2 WHERE p2.work_item_id = r.work_item_id ORDER BY p2.version DESC LIMIT 1)) = ?)
      ORDER BY (CASE r.kind WHEN 'REQUIRED' THEN 0 ELSE 1 END), r.created_at, r.rowid LIMIT ?`,
    domain, domain, Math.max(1, Math.min(500, limit)),
  )) {
    if (domain !== null && !domainHasFreeSlot(ctx, domain)) break;
    const r = getRequest(ctx, id as Id);
    if (r.state !== 'OPEN' || r.waitingReason === null) continue;
    fillAssignments(ctx, r);
    n++;
  }
  return n;
}

/**
 * Reviewer capacity became available in a domain (null: every domain) — a reviewer admitted, promoted or reinstated,
 * a hold lifted (review.ts), or a held slot freed (RR1-2: a review key or a judgment decided, withdrawn or released,
 * `reviewerCapacityFreed`). In the caller's transaction: the waiting REQUIRED requests first (a blocking gate is never
 * starved by non-blocking learning judgments), then oversight, then the pending pool judgments. Never a polling loop:
 * every wake is the transaction that changed the capacity. Returns what it filled or drew.
 */
export function refillDomain(ctx: StoreContext, domain: string | null, limit = 500, except: JudgmentSubject | null = null): number {
  if (refilling.has(ctx.db)) return 0;
  refilling.add(ctx.db);
  try {
    return refillWaitingRequests(ctx, domain, limit) + refillJudgments(ctx, Math.min(200, limit), domain, except);
  } finally {
    refilling.delete(ctx.db);
  }
}

/**
 * RR1-2: a slot this Employee held (a review key or a judgment) was freed — decided, withdrawn or released. Freed
 * capacity IS a wake: every domain it actively reviews in is refilled in the same transaction. (A suspended or
 * revoked reviewer's slot helps nobody: it reviews in no ACTIVE domain.)
 */
export function reviewerCapacityFreed(ctx: StoreContext, employeeId: Id | null, except: JudgmentSubject | null = null): number {
  if (employeeId === null || refilling.has(ctx.db)) return 0;
  let n = 0;
  for (const { d } of ctx.db.all<{ d: string }>(`SELECT DISTINCT domain AS d FROM reviewer_qualifications WHERE employee_id = ? AND mode = 'ACTIVE' ORDER BY domain`, employeeId)) n += refillDomain(ctx, d, 500, except);
  return n;
}

/** RR1-2: a judge is drawn only after the domain's waiting REQUIRED requests had the capacity first. */
function yieldToWaitingReviews(ctx: StoreContext, domain: string): void {
  if (refilling.has(ctx.db) || !domainHasFreeSlot(ctx, domain)) return;
  refilling.add(ctx.db);
  try {
    refillWaitingRequests(ctx, domain, 500);
  } finally {
    refilling.delete(ctx.db);
  }
}

/**
 * A review / judge Work Item has ended without its decision: finished (failed, cancelled, superseded, completed)
 * or dead-lettered (BLOCKED on its DEAD_LETTER job — m-11: until a Founder requeue it never runs again).
 */
const ENDED_STATES: readonly string[] = ['FAILED', 'CANCELLED', 'SUPERSEDED', 'COMPLETED', 'CLOSED', 'WAITING_REVIEW', 'REVIEWED'];
const ENDED_SQL = `(i.state IN ('FAILED', 'CANCELLED', 'SUPERSEDED', 'COMPLETED', 'CLOSED') OR (i.state = 'BLOCKED' AND EXISTS (SELECT 1 FROM queue_jobs j WHERE j.work_item_id = i.id AND j.state = 'DEAD_LETTER')))`;
function reviewWorkEnded(ctx: StoreContext, workItemId: Id): boolean {
  const item = getWorkItemRow(ctx, workItemId);
  return ENDED_STATES.includes(item.state) || (item.state === 'BLOCKED' && ctx.db.get(`SELECT 1 AS x FROM queue_jobs WHERE work_item_id = ? AND state = 'DEAD_LETTER' LIMIT 1`, workItemId) !== undefined);
}

/** A review Work Item that ended without a decision (failed, cancelled, dead-lettered): its key is withdrawn and refilled. */
export function releaseAbandonedAssignment(ctx: StoreContext, reviewWorkItemId: Id): void {
  const row = ctx.db.get(`SELECT * FROM review_assignments WHERE review_work_item_id = ? AND state = 'ASSIGNED'`, reviewWorkItemId);
  if (!row) return;
  const a = mapReviewAssignment(row);
  if (!reviewWorkEnded(ctx, reviewWorkItemId)) return;
  withdrawAssignment(ctx, a, 'REVIEW_WORK_ENDED');
  const r = getRequest(ctx, a.requestId);
  if (r.state === 'OPEN') fillAssignments(ctx, r);
  // RR1-2: the slot its reviewer held is free again: a wake of what waits for it.
  reviewerCapacityFreed(ctx, a.reviewerEmployeeId);
}

/** m-11: every end path of a review / judge Work Item (terminal transition, completion, dead letter) frees what it held. */
export function releaseAbandonedReviewWork(ctx: StoreContext, workItemId: Id): void {
  releaseAbandonedAssignment(ctx, workItemId);
  releaseAbandonedJudgment(ctx, workItemId);
}

/**
 * Completion hook of the C1 queue (same transaction as the completion): a subject now WAITING_REVIEW gets its
 * review request (or waits visibly for a plan), and a finished review Work Item that recorded no decision
 * frees its key for another reviewer.
 */
export function reviewAfterCompletion(ctx: StoreContext, wi: WorkItemRecord): void {
  if (wi.state === 'WAITING_REVIEW') ensureOutputReview(ctx, wi.id);
  releaseAbandonedReviewWork(ctx, wi.id);
}

/**
 * Recovery sweep (bounded; runtime startup recovery): output subjects waiting for review without a live request,
 * executors stranded on an action review whose request went STALE (R2-02), abandoned or dead-lettered
 * assignments and judgments (m-11), every OPEN request still waiting for a reviewer (RR1-2: ACTION requests too),
 * and — after them — pool judgments still undrawn.
 */
export function sweepReviews(ctx: StoreContext, limit: number): number {
  let n = 0;
  for (const { id } of ctx.db.all<{ id: string }>(`SELECT w.id FROM work_items w WHERE w.state = 'WAITING_REVIEW' AND EXISTS (SELECT 1 FROM review_plans p WHERE p.work_item_id = w.id AND p.status = 'ACTIVE') ORDER BY w.updated_at LIMIT ?`, limit)) {
    const r = ensureOutputReview(ctx, id as Id);
    if (r !== null) n++;
  }
  for (const { w } of ctx.db.all<{ w: string }>(
    `SELECT DISTINCT j.work_item_id AS w FROM queue_jobs j WHERE j.state = 'WAITING' AND j.wait_reason = 'AWAITING_INDEPENDENT_REVIEW'
        AND EXISTS (SELECT 1 FROM review_plans p WHERE p.work_item_id = j.work_item_id AND p.status = 'ACTIVE')
        AND NOT EXISTS (SELECT 1 FROM review_requests r WHERE r.work_item_id = j.work_item_id AND r.subject_kind = 'ACTION' AND r.kind = 'REQUIRED' AND r.state IN ('OPEN', 'SATISFIED', 'CONFLICT', 'ESCALATED'))
      LIMIT ?`,
    limit,
  )) {
    wakeStrandedActionWait(ctx, w as Id);
    n++;
  }
  for (const { w } of ctx.db.all<{ w: string }>(`SELECT a.review_work_item_id AS w FROM review_assignments a JOIN work_items i ON i.id = a.review_work_item_id WHERE a.state = 'ASSIGNED' AND ${ENDED_SQL} LIMIT ?`, limit)) {
    releaseAbandonedAssignment(ctx, w as Id);
    n++;
  }
  for (const { w } of ctx.db.all<{ w: string }>(`SELECT a.judge_work_item_id AS w FROM judgment_assignments a JOIN work_items i ON i.id = a.judge_work_item_id WHERE a.state = 'ASSIGNED' AND ${ENDED_SQL} LIMIT ?`, limit)) {
    releaseAbandonedJudgment(ctx, w as Id);
    n++;
  }
  // RR1-2: every OPEN request still waiting for a reviewer (an ACTION request too, whose executor waits on it) is
  // refilled — REQUIRED first — and only then the pool judgments still undrawn.
  return n + refillDomain(ctx, null, limit);
}

// --- C6-R1: operational judgment through the Review Pool ----------------------------------------------------

export type JudgmentSubjectKind = JudgmentAssignmentRecord['subjectKind'];

/** The parties of a judged subject, who never judge it: the executor of the judged work, the subject Employee, and the delegation chain. */
function judgmentParties(ctx: StoreContext, workItemId: Id, subjectEmployeeId: Id | null): Id[] {
  const executor = employeeIdFromRef(getWorkItemRow(ctx, workItemId).ownerRef);
  return [executor, subjectEmployeeId, ...delegationChain(ctx, workItemId)].filter((x): x is Id => x !== null);
}

/**
 * Who must not judge: the parties, and every judge holding, having decided or having escalated the subject, or
 * whose own judgment work ended undecided. A judge withdrawn for a transient reason (a lifted hold, pending
 * evidence, a reinstated qualification) may judge it again (R2-07 / m-12).
 */
function judgmentExclusions(ctx: StoreContext, kind: JudgmentSubjectKind, subjectId: Id, workItemId: Id, subjectEmployeeId: Id | null): string[] {
  const prior = ctx.db.all<{ e: string }>(
    `SELECT judge_employee_id AS e FROM judgment_assignments WHERE subject_kind = ? AND subject_id = ? AND (state IN ('ASSIGNED', 'DECIDED', 'ESCALATED') OR reason_code = 'JUDGMENT_WORK_ENDED')`,
    kind, subjectId,
  ).map((r) => r.e);
  return [...new Set([...judgmentParties(ctx, workItemId, subjectEmployeeId), ...prior])];
}

/**
 * R2-09: a LESSON judge is drawn only through the lesson evidence gate (`txRequestLessonJudgment`, improvement.ts),
 * which registers itself here — review-core never imports improvement.ts (no import cycle). Unregistered, no
 * lesson judge is drawn at all (fail closed); `assignJudge` refuses a LESSON draw that did not pass the gate.
 */
type LessonJudgeDraw = (ctx: StoreContext, lessonId: Id) => Id | null;
let lessonJudgeDraw: LessonJudgeDraw | null = null;
export function registerLessonJudgeDraw(draw: LessonJudgeDraw): void {
  lessonJudgeDraw = draw;
}

/** Draws a judge for a pending C6 subject through its gated path (the one entry the refill, release and reassignment paths use). */
export function drawJudge(ctx: StoreContext, s: { subjectKind: JudgmentSubjectKind; subjectId: Id; workItemId: Id; subjectEmployeeId: Id | null }): boolean {
  if (s.subjectKind === 'LESSON') return lessonJudgeDraw !== null && lessonJudgeDraw(ctx, s.subjectId) !== null;
  return assignJudge(ctx, s) !== null;
}

/** What the judge is shown (local governed context of its own Work Item, never telemetry). */
function judgmentSubjectText(ctx: StoreContext, kind: JudgmentSubjectKind, subjectId: Id, workItemId: Id): string {
  if (kind === 'ATTRIBUTION') {
    const a = ctx.db.get<{ overall: string; causes_json: string; employee_accountable: number; confidence: string }>('SELECT overall, causes_json, employee_accountable, confidence FROM causal_attributions WHERE id = ?', subjectId);
    return `Subject: the proposed cause analysis ${subjectId} of Work Item ${workItemId}. Overall ${a?.overall ?? '?'}, confidence ${a?.confidence ?? '?'}, Employee accountable: ${a?.employee_accountable === 1 ? 'yes' : 'no'}. Causes: ${(a?.causes_json ?? '[]').slice(0, 1500)} PASS validates it as proposed, FAIL rejects it; uncertainty escalates to the Founder.`;
  }
  const l = ctx.db.get<{ content: string; topic: string }>('SELECT content, topic FROM lessons WHERE id = ?', subjectId);
  return `Subject: the lesson candidate ${subjectId} (${l?.topic ?? '?'}) from Work Item ${workItemId}: ${(l?.content ?? '').slice(0, 1500)} PASS validates it on independent evidence, FAIL rejects it; uncertainty escalates to the Founder.`;
}

/**
 * Assigns one independent, qualified judge from the plan's Review Pool domain to a C6 subject — only where the
 * Work Item's plan delegates judgment (governance kernel `judgmentRoute`; never R4). The judge acts from its own
 * governed Work Item funded from the plan's pre-authorized review budget, exactly like a reviewer. Idempotent;
 * no eligible judge (or a Quality Hold) → null: the subject waits, visible, and the Founder can always decide it.
 */
export function assignJudge(ctx: StoreContext, s: { subjectKind: JudgmentSubjectKind; subjectId: Id; workItemId: Id; subjectEmployeeId: Id | null; lessonEvidenceReady?: true }): JudgmentAssignmentRecord | null {
  const open = ctx.db.get(`SELECT * FROM judgment_assignments WHERE subject_kind = ? AND subject_id = ? AND state = 'ASSIGNED'`, s.subjectKind, s.subjectId);
  if (open) return mapJudgmentAssignment(open);
  // R2-09: no judge is spent on a lesson whose independent evidence has not arrived (the gate decides that).
  if (s.subjectKind === 'LESSON' && s.lessonEvidenceReady !== true) return null;
  // An escalated judgment belongs to the Founder now: it is never re-drawn until someone else answers.
  if (ctx.db.get(`SELECT 1 AS x FROM judgment_assignments WHERE subject_kind = ? AND subject_id = ? AND state IN ('DECIDED', 'ESCALATED')`, s.subjectKind, s.subjectId)) return null;
  const item = getWorkItemRow(ctx, s.workItemId);
  const plan = activePlan(ctx, item.id);
  if (!plan || judgmentRoute({ planJudgment: plan.operationalJudgment, risk: item.riskLevel }).judge !== 'REVIEW_POOL') return null;
  if (ctx.db.get(`SELECT 1 AS x FROM quality_holds WHERE state = 'ACTIVE' AND ((target_kind = 'DOMAIN' AND target_ref = ?) OR (target_kind = 'RUBRIC' AND target_ref = ?)) LIMIT 1`, plan.domain, `${plan.rubricCode}@${plan.rubricVersion}`)) return null;
  // RR1-2: a non-blocking judgment never takes the slot a blocking review waits for.
  yieldToWaitingReviews(ctx, plan.domain);
  const executor = employeeIdFromRef(item.ownerRef);
  const dataClass = effectiveDataClass(ctx, item.id);
  const excluded = judgmentExclusions(ctx, s.subjectKind, s.subjectId, item.id, s.subjectEmployeeId);
  const judge = eligibleReviewers(ctx, { domain: plan.domain, mode: 'ACTIVE', dataClass, excluded, excludeDepartmentId: plan.excludeSameDepartment && executor ? getEmployeeRow(ctx, executor).departmentId : null, minLevelRank: 0, rubricRef: rubricRefOf(plan), onlyEmployeeId: null, limit: 1 })[0];
  if (!judge) return null;
  const id = newId();
  const instructions = reviewerInstructions(ctx, plan.id, judgmentSubjectText(ctx, s.subjectKind, s.subjectId, item.id));
  const created = txCreateWorkItem(
    ctx,
    { objective: `Independent judgment ${s.subjectKind.toLowerCase()} ${s.subjectId} (assignment ${id})`, ownerRef: `employee:${judge.employeeId}`, riskLevel: 'R1', processorKind: REVIEW_PROCESSOR, processorInput: { taskClass: plan.reviewTaskClass, dataClass, instructions, maxTurns: 4 }, dedupeKey: `judgment-assignment:${id}`, ...(plan.deadlineAt !== null ? { dueAt: plan.deadlineAt } : {}), initialState: 'PROPOSED' },
    { actorRef: SYSTEM_REVIEW_REF },
  );
  // Funded from the judge's own envelope within the plan's pre-authorized review budget: no budget is created or raised.
  txAllocateWorkItemBudget(ctx, created.workItem.id, judge.employeeId, { money: plan.reviewBudgetMoney, tokens: plan.reviewBudgetTokens }, SYSTEM_REVIEW_REF, 'judgment.assignment');
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO judgment_assignments (id, subject_kind, subject_id, work_item_id, plan_id, judge_employee_id, qualification_id, judge_work_item_id, state, review_outcome, decision, reason_code, evidence_refs_json, run_id, qualification_version, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ASSIGNED', NULL, NULL, NULL, '[]', NULL, NULL, 1, ?, ?)`,
    id, s.subjectKind, s.subjectId, item.id, plan.id, judge.employeeId, judge.qualificationId, created.workItem.id, at, at,
  );
  const released = applyTransition(ctx, created.workItem, 'READY', { reasonCode: 'judgment.assigned', trace: { correlationId: created.workItem.correlationId, actorRef: SYSTEM_REVIEW_REF } });
  enqueueJob(ctx, released, { correlationId: released.correlationId, actorRef: SYSTEM_REVIEW_REF });
  appendAudit(ctx, 'judgment.assigned', 'judgment_assignment', id, { actorRef: SYSTEM_REVIEW_REF }, 'OK', s.subjectKind, { subjectId: s.subjectId, workItemId: item.id, judgeEmployeeId: judge.employeeId, qualificationId: judge.qualificationId });
  return mapJudgmentAssignment(ctx.db.get('SELECT * FROM judgment_assignments WHERE id = ?', id) ?? {});
}

/** The judge is still an eligible, independent pool reviewer of the subject now (re-checked at the decision boundary). */
export function judgeStillEligible(ctx: StoreContext, ja: JudgmentAssignmentRecord, subjectEmployeeId: Id | null): { eligible: boolean; qualificationVersion: number | null } {
  const plan = activePlan(ctx, ja.workItemId);
  const item = getWorkItemRow(ctx, ja.workItemId);
  if (!plan || plan.id !== ja.planId || judgmentRoute({ planJudgment: plan.operationalJudgment, risk: item.riskLevel }).judge !== 'REVIEW_POOL') return { eligible: false, qualificationVersion: null };
  const executor = employeeIdFromRef(item.ownerRef);
  // The shared predicate (R2-08: incl. a RUBRIC hold on the plan's rubric and the judge's OPEN envelope); capacity is
  // not re-counted here: this assignment is the slot the judge already holds.
  const v = stillEligible(ctx, ja.qualificationId, ja.judgeEmployeeId, {
    domain: plan.domain, mode: 'ACTIVE', dataClass: effectiveDataClass(ctx, item.id), excluded: judgmentParties(ctx, item.id, subjectEmployeeId),
    excludeDepartmentId: plan.excludeSameDepartment && executor !== null ? getEmployeeRow(ctx, executor).departmentId : null, minLevelRank: 0, rubricRef: rubricRefOf(plan),
  });
  return { eligible: v !== null, qualificationVersion: v };
}

export function withdrawJudgment(ctx: StoreContext, ja: JudgmentAssignmentRecord, reasonCode: string): void {
  if (ja.state !== 'ASSIGNED') return;
  ctx.db.run(`UPDATE judgment_assignments SET state = 'WITHDRAWN', reason_code = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, reasonCode, ts(ctx), ja.id, ja.version);
  appendAudit(ctx, 'judgment.withdrawn', 'judgment_assignment', ja.id, { actorRef: SYSTEM_REVIEW_REF }, 'OK', reasonCode, { subjectKind: ja.subjectKind, subjectId: ja.subjectId });
  // RR1-2: the judge's slot is free (whoever withdrew it — the Founder deciding the subject, a stale subject, a
  // release): a wake in this transaction. The withdrawn subject itself is left to its own path (re-drawn by the caller
  // through its gate, or about to be decided), never re-drawn by this refill.
  reviewerCapacityFreed(ctx, ja.judgeEmployeeId, { kind: ja.subjectKind, id: ja.subjectId });
}

/** The subject Employee of a judgment subject (never its judge). */
export function judgmentSubjectEmployee(ctx: StoreContext, kind: JudgmentSubjectKind, subjectId: Id): Id | null {
  const r = kind === 'ATTRIBUTION' ? ctx.db.get<{ e: string | null }>('SELECT employee_id AS e FROM causal_attributions WHERE id = ?', subjectId) : ctx.db.get<{ e: string | null }>('SELECT employee_id AS e FROM lessons WHERE id = ?', subjectId);
  return (r?.e ?? null) as Id | null;
}

/**
 * Pending C6 subjects under a pool-delegated plan that have no judge yet (none was eligible when they arose):
 * draw one now. Called when pool capacity returns (admission, promotion, reinstatement, a lifted hold) and by the
 * bounded recovery sweep — never a polling loop. An escalated or decided subject is never re-drawn.
 */
export function refillJudgments(ctx: StoreContext, limit = 200, domain: string | null = null, except: JudgmentSubject | null = null): number {
  let n = 0;
  const pending = `NOT EXISTS (SELECT 1 FROM judgment_assignments j WHERE j.subject_kind = ? AND j.subject_id = s.id AND j.state IN ('ASSIGNED', 'DECIDED', 'ESCALATED'))`;
  const skip = (kind: JudgmentSubjectKind, id: string): boolean => except !== null && except.kind === kind && except.id === id;
  for (const a of ctx.db.all<{ id: string; work_item_id: string; employee_id: string | null }>(
    `SELECT s.id, s.work_item_id, s.employee_id FROM causal_attributions s JOIN review_plans p ON p.work_item_id = s.work_item_id AND p.status = 'ACTIVE' AND p.operational_judgment = 'REVIEW_POOL'
      WHERE s.state = 'PROPOSED' AND (? IS NULL OR p.domain = ?) AND ${pending} ORDER BY s.created_at, s.id LIMIT ?`,
    domain, domain, 'ATTRIBUTION', limit,
  )) if (!skip('ATTRIBUTION', a.id) && assignJudge(ctx, { subjectKind: 'ATTRIBUTION', subjectId: a.id as Id, workItemId: a.work_item_id as Id, subjectEmployeeId: (a.employee_id ?? null) as Id | null })) n++;
  for (const l of ctx.db.all<{ id: string; w: string; employee_id: string }>(
    `SELECT s.id, substr(s.event_ref, 11) AS w, s.employee_id FROM lessons s JOIN review_plans p ON p.work_item_id = substr(s.event_ref, 11) AND p.status = 'ACTIVE' AND p.operational_judgment = 'REVIEW_POOL'
      WHERE s.stage = 'UNDER_REVIEW' AND s.event_ref GLOB 'work_item:*' AND (? IS NULL OR p.domain = ?) AND ${pending} ORDER BY s.created_at, s.id LIMIT ?`,
    domain, domain, 'LESSON', limit,
  )) if (!skip('LESSON', l.id) && drawJudge(ctx, { subjectKind: 'LESSON', subjectId: l.id as Id, workItemId: l.w as Id, subjectEmployeeId: l.employee_id as Id })) n++;
  return n;
}

/** A judge's Work Item that ended without a decision (incl. dead-lettered): the assignment is withdrawn and another judge drawn. */
export function releaseAbandonedJudgment(ctx: StoreContext, judgeWorkItemId: Id): void {
  const row = ctx.db.get(`SELECT * FROM judgment_assignments WHERE judge_work_item_id = ? AND state = 'ASSIGNED'`, judgeWorkItemId);
  if (!row) return;
  const ja = mapJudgmentAssignment(row);
  if (!reviewWorkEnded(ctx, judgeWorkItemId)) return;
  withdrawJudgment(ctx, ja, 'JUDGMENT_WORK_ENDED');
  withdrawnJudgmentRedraw(ctx, ja);
}

/** After a judgment was withdrawn: a still-pending subject gets another judge, through its gated path. */
export function withdrawnJudgmentRedraw(ctx: StoreContext, ja: JudgmentAssignmentRecord): void {
  const pending = ja.subjectKind === 'ATTRIBUTION'
    ? ctx.db.get(`SELECT 1 AS x FROM causal_attributions WHERE id = ? AND state = 'PROPOSED'`, ja.subjectId)
    : ctx.db.get(`SELECT 1 AS x FROM lessons WHERE id = ? AND stage = 'UNDER_REVIEW'`, ja.subjectId);
  if (pending) drawJudge(ctx, { subjectKind: ja.subjectKind, subjectId: ja.subjectId, workItemId: ja.workItemId, subjectEmployeeId: judgmentSubjectEmployee(ctx, ja.subjectKind, ja.subjectId) });
}

export const isoNow = (ctx: StoreContext): Timestamp => ts(ctx);
