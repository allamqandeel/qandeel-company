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
  outputSubjectFingerprint,
  parseReviewPlan,
  planAppliesTo,
  reviewerLevelRank,
  reviewerRoleFor,
  type DataClass,
  type ReviewOutcome,
} from '@qandeel-company/governance';
import { containsSecretMaterial } from '@qandeel-company/mind';

import { employeeIdFromRef, getEmployeeRow, txAllocateWorkItemBudget, wakeWorkItemJob } from './governance-core.js';
import { appendAudit, appendEvent, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { effectiveDataClass } from './governed-writes.js';
import { delegationChain, founderPrincipalRef, getPosition, primaryAssignmentAt, seatHolder } from './org-core.js';
import { mapQualification, mapReviewAssignment, mapReviewPlan, mapReviewRequest, type ReviewAssignmentRecord, type ReviewPlanRecord, type ReviewRequestRecord } from './org-records.js';
import type { WorkItemRecord } from './records.js';
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
  if (current) {
    ctx.db.run(`UPDATE review_plans SET status = 'SUPERSEDED' WHERE id = ?`, current.id);
    for (const r of ctx.db.all(`SELECT * FROM review_requests WHERE plan_id = ? AND state IN ('OPEN', 'SATISFIED', 'CONFLICT', 'ESCALATED')`, current.id).map(mapReviewRequest)) {
      for (const a of assignmentsOf(ctx, r.id)) withdrawAssignment(ctx, a, 'PLAN_SUPERSEDED');
      setRequestState(ctx, r, 'STALE', 'review.plan_superseded', actorRef);
    }
  }
  const id = newId();
  try {
    ctx.db.run(
      `INSERT INTO review_plans (id, work_item_id, version, status, domain, applies_to, keys_json, independence_json, required_evidence_json, rubric_code, rubric_version, reviewer_instructions, reviewer_instructions_sha256, review_task_class, review_budget_money, review_budget_tokens, deadline_at, declared_by_ref, declared_run_id, created_at)
       VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, item.id, version, plan.domain, plan.appliesTo, JSON.stringify(plan.keys), canonicalJson(plan.independence), JSON.stringify(plan.requiredEvidence), plan.rubric.code, plan.rubric.version,
      plan.reviewerInstructions, sha256Hex(plan.reviewerInstructions), plan.reviewTaskClass, plan.reviewBudget.money, plan.reviewBudget.tokens, plan.deadlineAt, actorRef, runId, ts(ctx),
    );
  } catch (error) {
    if (error instanceof QandeelError && error.code === 'STORAGE_INVARIANT') throw new QandeelError('INVALID_TRANSITION', 'a review plan is declared before the Work Item first runs', { workItemId: item.id, reason: 'REVIEW_PLAN_AFTER_EXECUTION' });
    throw error;
  }
  if (planAppliesTo(plan.appliesTo, 'OUTPUT') && !item.reviewRequired && !['COMPLETED', 'WAITING_REVIEW', 'REVIEWED', 'OUTCOME_VERIFIED'].includes(item.state)) {
    ctx.db.run('UPDATE work_items SET review_required = 1, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', ts(ctx), item.id, item.version);
  }
  appendAudit(ctx, 'review.plan_declared', 'review_plan', id, { actorRef }, 'OK', null, { workItemId: item.id, version, keys: plan.keys.length, appliesTo: plan.appliesTo });
  const declared = mapReviewPlan(ctx.db.get('SELECT * FROM review_plans WHERE id = ?', id) ?? {});
  // A subject already waiting for review under this plan is picked up at once.
  if (getWorkItemRow(ctx, item.id).state === 'WAITING_REVIEW') ensureOutputReview(ctx, item.id);
  return declared;
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

export interface SelectionFilter {
  readonly domain: string;
  readonly mode: 'ACTIVE' | 'CALIBRATION';
  readonly dataClass: DataClass;
  readonly excluded: readonly string[];
  readonly excludeDepartmentId: Id | null;
  readonly minLevelRank: number;
  readonly onlyEmployeeId: Id | null;
  readonly limit: number;
}

/**
 * The qualified, independent, available reviewers for one key — every eligibility condition in the WHERE
 * clause, so nothing ineligible can crowd an eligible reviewer out of the bounded page (R1-12 family).
 * Seniority, titles and Positions play no part: only qualification evidence and current state.
 */
export function eligibleReviewers(ctx: StoreContext, f: SelectionFilter): { qualificationId: Id; employeeId: Id; level: string; qualificationVersion: number }[] {
  const at = ts(ctx);
  return ctx.db
    .all<{ qid: string; eid: string; level: string; qv: number }>(
      `SELECT q.id AS qid, q.employee_id AS eid, q.level AS level, q.qualification_version AS qv,
              (SELECT COUNT(*) FROM review_assignments ra WHERE ra.reviewer_employee_id = q.employee_id AND ra.state = 'ASSIGNED') AS open_count
         FROM reviewer_qualifications q
         JOIN employees e ON e.id = q.employee_id
         JOIN certifications c ON c.id = q.certification_id
        WHERE q.domain = ? AND q.mode = ?
          AND (? IS NULL OR q.employee_id = ?)
          AND e.state = 'ACTIVE'
          AND c.employee_id = q.employee_id AND c.status = 'VALID' AND c.valid_until > ? AND c.role_ref = ?
          AND q.max_data_rank >= ?
          AND (CASE q.level WHEN 'EXPERT' THEN 2 WHEN 'SENIOR' THEN 1 ELSE 0 END) >= ?
          AND q.employee_id NOT IN (SELECT value FROM json_each(?))
          AND (? IS NULL OR e.department_id IS NOT ?)
          AND NOT EXISTS (SELECT 1 FROM quality_holds h WHERE h.state = 'ACTIVE' AND (
                (h.target_kind = 'REVIEWER' AND h.target_ref = 'employee:' || q.employee_id)
             OR (h.target_kind = 'QUALIFICATION' AND h.target_ref = q.id)
             OR (h.target_kind = 'DOMAIN' AND h.target_ref = q.domain)))
          AND NOT EXISTS (SELECT 1 FROM json_each(c.skill_pins_json) p JOIN skill_versions v ON v.id = json_extract(p.value, '$.skillVersionId')
                           WHERE v.freshness IN ('SECURITY_HOLD', 'RETIRED') OR v.integrity <> 'OK')
          AND EXISTS (SELECT 1 FROM budgets b WHERE b.scope = 'EMPLOYEE' AND b.scope_id = q.employee_id AND b.status = 'OPEN')
          AND (SELECT COUNT(*) FROM review_assignments ra WHERE ra.reviewer_employee_id = q.employee_id AND ra.state = 'ASSIGNED') < ?
        ORDER BY open_count ASC, (CASE q.level WHEN 'EXPERT' THEN 0 WHEN 'SENIOR' THEN 1 ELSE 2 END), q.employee_id
        LIMIT ?`,
      f.domain, f.mode, f.onlyEmployeeId, f.onlyEmployeeId, at, reviewerRoleFor(f.domain), dataRank(f.dataClass), f.minLevelRank,
      JSON.stringify(f.excluded), f.excludeDepartmentId, f.excludeDepartmentId, MAX_OPEN_REVIEWS_PER_REVIEWER, Math.max(1, Math.min(50, f.limit)),
    )
    .map((r) => ({ qualificationId: r.qid as Id, employeeId: r.eid as Id, level: r.level, qualificationVersion: Number(r.qv) }));
}

function assignmentsOf(ctx: StoreContext, requestId: Id): ReviewAssignmentRecord[] {
  return ctx.db.all('SELECT * FROM review_assignments WHERE request_id = ? ORDER BY created_at, id', requestId).map(mapReviewAssignment);
}

/** Who must not review this subject: its executor, the delegation chain, and everyone already on the request. */
function exclusionsFor(ctx: StoreContext, request: ReviewRequestRecord, exceptAssignmentId: Id | null = null, extra: readonly string[] = []): { executor: Id | null; excluded: string[] } {
  const item = getWorkItemRow(ctx, request.workItemId);
  const executor = employeeIdFromRef(item.ownerRef);
  const prior = assignmentsOf(ctx, request.id).filter((a) => a.id !== exceptAssignmentId).map((a) => a.reviewerEmployeeId).filter((x): x is Id => x !== null);
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

/** Creates the reviewer's own governed review Work Item (owned by the reviewer, budgeted within its envelope). */
function reviewWorkItem(ctx: StoreContext, plan: ReviewPlanRecord, request: ReviewRequestRecord, assignmentId: Id, reviewerId: Id, subjectText: string): Id {
  const instructions = `${planInstructions(ctx, plan.id)}\n${subjectText}`.slice(0, 11_000);
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

function subjectTextFor(ctx: StoreContext, request: ReviewRequestRecord, actionText: string | null): string {
  if (request.subjectKind === 'ACTION') return actionText ?? `Subject: action ${request.subjectRef} proposed in Work Item ${request.workItemId}.`;
  return outputSubjectText(ctx, getWorkItemRow(ctx, request.workItemId));
}

/**
 * Fills every unassigned key of an OPEN request with an eligible reviewer (and one shadow / calibration
 * reviewer when available). A key that no eligible reviewer can fill leaves the request OPEN and visible
 * (`REVIEWER_UNAVAILABLE`) — never filled by someone ineligible, never silently skipped.
 */
export function fillAssignments(ctx: StoreContext, request: ReviewRequestRecord, actionText: string | null = null): ReviewRequestRecord {
  if (request.state !== 'OPEN') return request;
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
  const text = subjectTextFor(ctx, request, actionText);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const all = assignmentsOf(ctx, request.id);
    if (all.some((a) => a.keyIndex === keyIndex && a.state === 'ASSIGNED')) continue;
    const decided = all.filter((a) => a.keyIndex === keyIndex && a.state === 'DECIDED').at(-1);
    const lastOutcome = decided ? ctx.db.get<{ o: string }>('SELECT outcome AS o FROM review_decisions WHERE assignment_id = ?', decided.id)?.o : undefined;
    if (decided && lastOutcome !== 'NEEDS_SPECIALIST') continue;
    const key = keys[keyIndex] as { kind: string };
    const { executor, excluded } = exclusionsFor(ctx, request);
    // NEEDS_SPECIALIST: a stronger reviewer than the one who asked for it.
    const minLevelRank = decided && decided.qualificationId ? Math.min(2, reviewerLevelRank((mapQualification(ctx.db.get('SELECT * FROM reviewer_qualifications WHERE id = ?', decided.qualificationId) ?? {})).level) + 1) : 0;
    const filter: SelectionFilter = { domain, mode: 'ACTIVE', dataClass: request.dataClass, excluded, excludeDepartmentId: plan?.excludeSameDepartment ? executorDept : null, minLevelRank, onlyEmployeeId: null, limit: 1 };
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
    const shadow = eligibleReviewers(ctx, { domain, mode: 'CALIBRATION', dataClass: request.dataClass, excluded, excludeDepartmentId: null, minLevelRank: 0, onlyEmployeeId: null, limit: 1 })[0];
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
export function ensureRequest(ctx: StoreContext, s: { item: WorkItemRecord; subjectKind: 'OUTPUT' | 'ACTION'; fingerprint: string; subjectRef: string; dataClass: DataClass; risk: string; actionText: string | null }): ReviewRequestRecord | 'PLAN_MISSING' {
  const plan = activePlan(ctx, s.item.id);
  if (!plan || !planAppliesTo(plan.appliesTo, s.subjectKind)) return 'PLAN_MISSING';
  const live = ctx.db.get(`SELECT * FROM review_requests WHERE work_item_id = ? AND subject_fingerprint = ? AND kind = 'REQUIRED' AND state IN ('OPEN', 'SATISFIED', 'CONFLICT', 'ESCALATED')`, s.item.id, s.fingerprint);
  if (live) {
    const r = mapReviewRequest(live);
    if (r.planId === plan.id) return r.state === 'OPEN' ? fillAssignments(ctx, r, s.actionText) : r;
    // Reviewed under a superseded plan: that review no longer counts; the subject is reviewed afresh.
    for (const a of assignmentsOf(ctx, r.id)) withdrawAssignment(ctx, a, 'PLAN_SUPERSEDED');
    setRequestState(ctx, r, 'STALE', 'review.plan_superseded', SYSTEM_REVIEW_REF);
  }
  const id = newId();
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO review_requests (id, kind, plan_id, work_item_id, subject_kind, subject_fingerprint, subject_ref, data_class, risk_level, state, version, created_at, updated_at) VALUES (?, 'REQUIRED', ?, ?, ?, ?, ?, ?, ?, 'OPEN', 1, ?, ?)`,
    id, plan.id, s.item.id, s.subjectKind, s.fingerprint, s.subjectRef.slice(0, 161), s.dataClass, s.risk, at, at,
  );
  requestHistory(ctx, id as Id, 1, null, 'OPEN', 'review.requested', SYSTEM_REVIEW_REF);
  appendAudit(ctx, 'review.requested', 'review_request', id, { actorRef: SYSTEM_REVIEW_REF }, 'OK', null, { workItemId: s.item.id, subjectKind: s.subjectKind });
  return fillAssignments(ctx, getRequest(ctx, id as Id), s.actionText);
}

/** Output review of a Work Item waiting for review (idempotent; called at completion, reconciliation and recovery). */
export function ensureOutputReview(ctx: StoreContext, workItemId: Id): ReviewRequestRecord | 'PLAN_MISSING' | null {
  const item = getWorkItemRow(ctx, workItemId);
  if (item.state !== 'WAITING_REVIEW') return null;
  const subject = currentOutputSubject(ctx, item);
  // The subject's EFFECTIVE class: declared, every assembled context and every tool result (the reviewer sees the output).
  const dataClass = effectiveDataClass(ctx, item.id);
  return ensureRequest(ctx, { item, subjectKind: 'OUTPUT', fingerprint: subject.fingerprint, subjectRef: subject.ref, dataClass, risk: item.riskLevel, actionText: null });
}

// --- Decisions ------------------------------------------------------------------------------------------

export interface DecisionInput {
  readonly outcome: ReviewOutcome;
  readonly reasonCode: string;
  readonly rationale: string | null;
  readonly evidenceRefs: readonly string[];
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
    // Same conditions as selection, except capacity (this very assignment is the slot it holds).
    if (!reviewerEligibleIgnoringOwnSlot(ctx, a, q.domain, request, excluded, plan?.excludeSameDepartment === true && exec ? getEmployeeRow(ctx, exec).departmentId : null)) {
      withdrawAssignment(ctx, a, 'REVIEWER_NOT_ELIGIBLE');
      request = fillAssignments(ctx, request);
      return { recorded: false, code: 'REVIEWER_NOT_ELIGIBLE', request };
    }
    qualificationVersion = q.qualificationVersion;
  }
  const id = newId();
  const counts = a.keyKind === 'SHADOW' ? 0 : 1;
  ctx.db.run(
    `INSERT INTO review_decisions (id, assignment_id, request_id, reviewer_ref, reviewer_employee_id, outcome, reason_code, rationale, rationale_sha256, evidence_refs_json, plan_id, plan_version, rubric_code, rubric_version,
       subject_fingerprint, qualification_id, qualification_version, independence_json, counts, run_id, decision_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    id, a.id, request.id, reviewerRef, a.reviewerEmployeeId, d.outcome, d.reasonCode, d.rationale, d.rationale === null ? null : sha256Hex(d.rationale), JSON.stringify(d.evidenceRefs),
    plan?.id ?? null, plan?.version ?? null, plan?.rubricCode ?? null, plan?.rubricVersion ?? null, request.subjectFingerprint, a.qualificationId, qualificationVersion,
    canonicalJson({ executorExcluded: true, delegationChainExcluded: true, distinctFromOtherKeys: true, keyKind: a.keyKind }), counts, runId, ts(ctx),
  );
  ctx.db.run(`UPDATE review_assignments SET state = 'DECIDED', version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, ts(ctx), a.id, a.version);
  appendAudit(ctx, 'review.decided', 'review_decision', id, { actorRef: reviewerRef }, 'OK', d.outcome, { requestId: request.id, keyKind: a.keyKind, counts: counts === 1 });
  request = counts === 1 ? resolveRequest(ctx, request.id) : getRequest(ctx, request.id);
  return { recorded: true, code: 'RECORDED', request };
}

/** Eligibility of an already-assigned reviewer (its own open slot does not count against its capacity). */
function reviewerEligibleIgnoringOwnSlot(ctx: StoreContext, a: ReviewAssignmentRecord, domain: string, request: ReviewRequestRecord, excluded: readonly string[], excludeDepartmentId: Id | null): boolean {
  if (a.reviewerEmployeeId === null || excluded.includes(a.reviewerEmployeeId)) return false;
  const at = ts(ctx);
  return ctx.db.get(
    `SELECT 1 AS ok FROM reviewer_qualifications q JOIN employees e ON e.id = q.employee_id JOIN certifications c ON c.id = q.certification_id
      WHERE q.id = ? AND q.domain = ? AND q.mode = ? AND e.state = 'ACTIVE' AND c.status = 'VALID' AND c.valid_until > ? AND c.role_ref = ? AND q.max_data_rank >= ?
        AND (? IS NULL OR e.department_id IS NOT ?)
        AND NOT EXISTS (SELECT 1 FROM quality_holds h WHERE h.state = 'ACTIVE' AND ((h.target_kind = 'REVIEWER' AND h.target_ref = 'employee:' || q.employee_id) OR (h.target_kind = 'QUALIFICATION' AND h.target_ref = q.id) OR (h.target_kind = 'DOMAIN' AND h.target_ref = q.domain)))
        AND NOT EXISTS (SELECT 1 FROM json_each(c.skill_pins_json) p JOIN skill_versions v ON v.id = json_extract(p.value, '$.skillVersionId') WHERE v.freshness IN ('SECURITY_HOLD', 'RETIRED') OR v.integrity <> 'OK')`,
    a.qualificationId, domain, a.keyKind === 'SHADOW' ? 'CALIBRATION' : 'ACTIVE', at, reviewerRoleFor(domain), dataRank(request.dataClass), excludeDepartmentId, excludeDepartmentId,
  ) !== undefined;
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
  } else {
    const ready = applyTransition(ctx, item, 'READY', { reasonCode: 'review.rework', trace });
    enqueueJob(ctx, ready, trace);
  }
  appendAudit(ctx, outcome === 'SATISFIED' ? 'review.subject_reviewed' : 'review.subject_rework', 'work_item', item.id, trace, 'OK', null, { reviewRequestId: request.id });
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

export type ActionGate = { kind: 'SATISFIED'; requestId: Id } | { kind: 'REWORK'; requestId: Id } | { kind: 'WAIT'; code: 'REVIEW_PLAN_MISSING' | 'REVIEW_PENDING' | 'REVIEW_CONFLICT' | 'REVIEW_ESCALATED'; requestId: Id | null };

/**
 * The independent-review gate of an R2 / R3 action, inside the tool-intent transaction: the review must be
 * of exactly this action (its approval-scope fingerprint), under the Work Item's active plan. A satisfied
 * review is consumed by the one intent it authorized (like an approval's single use).
 */
export function actionReviewGate(ctx: StoreContext, s: { item: WorkItemRecord; fingerprint: string; subjectRef: string; dataClass: DataClass; risk: string; actionText: string }): ActionGate {
  const plan = activePlan(ctx, s.item.id);
  if (!plan || !planAppliesTo(plan.appliesTo, 'ACTION')) return { kind: 'WAIT', code: 'REVIEW_PLAN_MISSING', requestId: null };
  // A rework verdict on exactly this action (under the active plan) refuses it for good, like a rejected
  // approval; the model may propose something else, which is a new subject reviewed afresh.
  const live = ctx.db.get(`SELECT 1 AS x FROM review_requests WHERE work_item_id = ? AND subject_fingerprint = ? AND kind = 'REQUIRED' AND state IN ('OPEN', 'SATISFIED', 'CONFLICT', 'ESCALATED')`, s.item.id, s.fingerprint);
  if (!live) {
    const rejected = ctx.db.get<{ id: string }>(`SELECT id FROM review_requests WHERE work_item_id = ? AND subject_fingerprint = ? AND kind = 'REQUIRED' AND state = 'REWORK' AND plan_id = ? LIMIT 1`, s.item.id, s.fingerprint, plan.id);
    if (rejected) return { kind: 'REWORK', requestId: rejected.id as Id };
  }
  const r = ensureRequest(ctx, { item: s.item, subjectKind: 'ACTION', fingerprint: s.fingerprint, subjectRef: s.subjectRef, dataClass: s.dataClass, risk: s.risk, actionText: s.actionText });
  if (r === 'PLAN_MISSING') return { kind: 'WAIT', code: 'REVIEW_PLAN_MISSING', requestId: null };
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
}

/** New reviewer capacity in a domain (admission, promotion, hold lifted): refill the requests waiting for it. */
export function refillDomain(ctx: StoreContext, domain: string | null): number {
  const rows = ctx.db.all(
    `SELECT r.* FROM review_requests r LEFT JOIN review_plans p ON p.id = r.plan_id WHERE r.state = 'OPEN' AND r.waiting_reason IS NOT NULL AND (? IS NULL OR p.domain = ?) ORDER BY r.created_at LIMIT 500`,
    domain, domain,
  ).map(mapReviewRequest);
  for (const r of rows) fillAssignments(ctx, r);
  return rows.length;
}

/** A review Work Item that ended without a decision (failed, cancelled): its key is withdrawn and refilled. */
export function releaseAbandonedAssignment(ctx: StoreContext, reviewWorkItemId: Id): void {
  const row = ctx.db.get(`SELECT * FROM review_assignments WHERE review_work_item_id = ? AND state = 'ASSIGNED'`, reviewWorkItemId);
  if (!row) return;
  const a = mapReviewAssignment(row);
  const item = getWorkItemRow(ctx, reviewWorkItemId);
  if (!['FAILED', 'CANCELLED', 'SUPERSEDED', 'COMPLETED', 'CLOSED', 'WAITING_REVIEW', 'REVIEWED'].includes(item.state)) return;
  withdrawAssignment(ctx, a, 'REVIEW_WORK_ENDED');
  const r = getRequest(ctx, a.requestId);
  if (r.state === 'OPEN') fillAssignments(ctx, r);
}

/**
 * Completion hook of the C1 queue (same transaction as the completion): a subject now WAITING_REVIEW gets its
 * review request (or waits visibly for a plan), and a finished review Work Item that recorded no decision
 * frees its key for another reviewer.
 */
export function reviewAfterCompletion(ctx: StoreContext, wi: WorkItemRecord): void {
  if (wi.state === 'WAITING_REVIEW') ensureOutputReview(ctx, wi.id);
  releaseAbandonedAssignment(ctx, wi.id);
}

/** Recovery sweep (bounded): output subjects waiting for review without a live request, and abandoned assignments. */
export function sweepReviews(ctx: StoreContext, limit: number): number {
  let n = 0;
  for (const { id } of ctx.db.all<{ id: string }>(`SELECT w.id FROM work_items w WHERE w.state = 'WAITING_REVIEW' AND EXISTS (SELECT 1 FROM review_plans p WHERE p.work_item_id = w.id AND p.status = 'ACTIVE') ORDER BY w.updated_at LIMIT ?`, limit)) {
    const r = ensureOutputReview(ctx, id as Id);
    if (r !== null) n++;
  }
  for (const { w } of ctx.db.all<{ w: string }>(`SELECT a.review_work_item_id AS w FROM review_assignments a JOIN work_items i ON i.id = a.review_work_item_id WHERE a.state = 'ASSIGNED' AND i.state IN ('FAILED', 'CANCELLED', 'SUPERSEDED', 'COMPLETED', 'CLOSED') LIMIT ?`, limit)) {
    releaseAbandonedAssignment(ctx, w as Id);
    n++;
  }
  return n;
}

export const isoNow = (ctx: StoreContext): Timestamp => ts(ctx);
