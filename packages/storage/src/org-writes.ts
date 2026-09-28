/**
 * Fenced organizational acts and review decisions of Employees (C4, D-C4-04 / D-C4-05). Reached only
 * through `runtime-authority`: the actor is always the run's attributed Employee, never a caller-supplied
 * reference, and every write presents the run's fence.
 *
 * An act passes, in one transaction: fence → Employee eligibility (constrained Academy runs act on
 * nothing) → idempotency per (Work Item, step) → the act's explicit grant (default deny; a Position or
 * title never substitutes — Title ≠ Authority) → the act's own organizational rules (seat eligibility,
 * delegation limits, bounds, cycles) → the durable effect, its history and a content-free audit row.
 * Work delegation is not authority delegation: delegating work grants the delegate nothing.
 */
import { QandeelError, assertId, boundedText, canonicalJson, isQandeelError, isTimestamp, sha256Hex, type Id, type JsonObject } from '@qandeel-company/domain';
import {
  assertBudgetCaps,
  assertCatalogCode,
  assertDelegationBounds,
  assertTaskClass,
  canExecute,
  decideOrgAct,
  delegationCycle,
  isOrgAction,
  isReviewOutcome,
  isStaffingReviewAction,
  limitsAllow,
  orgActionCapability,
  parseDelegationLimits,
  parseStaffingRequest,
  staffingReviewTarget,
  type OrgAction,
  type ReviewOutcome,
} from '@qandeel-company/governance';
import { containsSecretMaterial } from '@qandeel-company/mind';

import { budgetFor, employeeIdFromRef, getEmployeeRow, txAllocateWorkItemBudget, wakeWorkItemJob } from './governance-core.js';
import { mapGrant } from './governance-records.js';
import { actingState, attributed, consumeGrant, effectiveDataClass, recordDenial } from './governed-writes.js';
import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { enforceRoleCertification } from './mind-core.js';
import { academyRun } from './mind-writes.js';
import { delegationChain, delegationDepth, delegationHistory, getPosition, heldSeatsAt, holdsSeat, newOrgId, primaryAssignmentAt, seatHolder, staffingHistory, directorSeatOf } from './org-core.js';
import { mapReviewAssignment, mapWorkDelegation, type WorkDelegationRecord } from './org-records.js';
import { getStaffingRequest, txDecideStaffing, txHireForRequest } from './organization.js';
import { verifyFence } from './queue.js';
import type { Fence } from './records.js';
import { recordDecision, txDeclarePlan } from './review-core.js';
import { applyTransition, enqueueJob } from './work-core.js';
import { txCreateWorkItem } from './work-items.js';

const EMPLOYEE_TASK = 'c2.employee-task';
const OPEN_DELEGATION: readonly string[] = ['OFFERED', 'ACCEPTED', 'CLARIFICATION_REQUESTED', 'ESCALATED'];

/** What the processor does after the act: continue its loop, or end / park the run. */
export type OrgActAfter = 'CONTINUE' | 'END_REFUSED' | 'WAIT_CLARIFICATION' | 'WAIT_ESCALATION';

export interface OrgActResult {
  readonly outcome: 'DONE' | 'REFUSED';
  readonly code: string;
  readonly resultRef: string | null;
  readonly after: OrgActAfter;
  readonly replayed: boolean;
  /** The actor's containment: an authority denial may pause it (Stage 3 §9). */
  readonly paused: boolean;
}

class Refusal extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const refuse = (code: string): never => {
  throw new Refusal(code);
};

function plain(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) refuse('INVALID_ARGS');
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!keys.includes(k)) refuse('INVALID_ARGS');
  return o;
}
const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const text = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) refuse('INVALID_ARGS');
  if (containsSecretMaterial(v as string)) refuse('SECRET_MATERIAL');
  return v as string;
};
const id = (v: unknown): Id => {
  try {
    return assertId(v, 'id');
  } catch {
    return refuse('INVALID_ARGS');
  }
};

function after(action: OrgAction, actorIsDelegate: boolean): OrgActAfter {
  if (action === 'handoff.refuse') return 'END_REFUSED';
  if (action === 'handoff.clarification.request') return 'WAIT_CLARIFICATION';
  if (action === 'handoff.escalate' && actorIsDelegate) return 'WAIT_ESCALATION';
  return 'CONTINUE';
}

/** The delegation whose CHILD is this Work Item and whose delegate is this Employee (a handoff answered from inside it). */
function ownHandoff(ctx: StoreContext, workItemId: Id, employeeId: Id): WorkDelegationRecord | null {
  const r = ctx.db.get(`SELECT * FROM work_delegations WHERE child_work_item_id = ? AND delegate_employee_id = ?`, workItemId, employeeId);
  return r ? mapWorkDelegation(r) : null;
}

function setDelegationState(ctx: StoreContext, d: WorkDelegationRecord, to: WorkDelegationRecord['state'], reasonCode: string, actorRef: string): void {
  const changed = ctx.db.run('UPDATE work_delegations SET state = ?, response_reason_code = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', to, reasonCode, ts(ctx), d.id, d.version).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'the delegation changed concurrently', { delegationId: d.id });
  delegationHistory(ctx, d.id, d.version + 1, d.state, to, reasonCode, actorRef);
  appendAudit(ctx, 'org.handoff_state', 'work_delegation', d.id, { actorRef }, 'OK', reasonCode, { from: d.state, to, childWorkItemId: d.childWorkItemId });
}

function handoffMessage(ctx: StoreContext, d: WorkDelegationRecord, kind: string, authorId: Id, runId: Id, body: string): void {
  ctx.db.run(
    'INSERT INTO handoff_messages (id, delegation_id, kind, author_employee_id, run_id, body, body_sha256, data_class, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newOrgId(), d.id, kind, authorId, runId, body, sha256Hex(body), effectiveDataClass(ctx, d.childWorkItemId), ts(ctx),
  );
}

/** Whether the delegate sits below one of the actor's seats (its primary seat's reporting line reaches it). */
function reportsTo(ctx: StoreContext, actorId: Id, delegateId: Id, act: OrgAction): boolean {
  const at = ts(ctx);
  // Acting coverage counts only for the acts its scope lists (an empty scope covers the seat's whole remit).
  const mine = new Set(heldSeatsAt(ctx, actorId, at).filter((s) => s.assignment.kind !== 'ACTING' || s.assignment.actingScope.length === 0 || s.assignment.actingScope.includes(act)).map((s) => s.position.id as string));
  if (mine.size === 0) return false;
  const a = primaryAssignmentAt(ctx, delegateId, at);
  let cursor: string | null = a ? getPosition(ctx, a.positionId).reportsToPositionId : null;
  for (let hops = 0; cursor !== null && hops < 40; hops++) {
    if (mine.has(cursor)) return true;
    cursor = getPosition(ctx, cursor as Id).reportsToPositionId;
  }
  return false;
}

/** Creates the delegated / support child Work Item in the parent's lineage, budgeted within caps, and its handoff. */
function delegateWork(ctx: StoreContext, fence: Fence, step: number, actorId: Id, actorRef: string, kind: 'DELEGATION' | 'SUPPORT', delegateId: Id, targetDept: Id | null, a: Record<string, unknown>): string {
  const item = getWorkItemRow(ctx, attributed(ctx, fence).workItemId);
  if (item.ownerRef !== actorRef) refuse('NOT_WORK_ITEM_OWNER');
  if (delegateId === actorId) refuse('DELEGATION_TO_SELF');
  const delegate = getEmployeeRow(ctx, delegateId);
  if (delegate.state !== 'ACTIVE') refuse('DELEGATE_NOT_ACTIVE');
  const root = getWorkItemRow(ctx, item.rootId);
  const rootOwner = employeeIdFromRef(root.ownerRef);
  if (delegationCycle([...delegationChain(ctx, item.id), ...(rootOwner ? [rootOwner] : [])], delegateId)) refuse('DELEGATION_CYCLE');
  const open = Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM work_delegations WHERE parent_work_item_id = ? AND state IN ('OFFERED', 'ACCEPTED', 'CLARIFICATION_REQUESTED', 'ESCALATED')`, item.id)?.n ?? 0);
  const depth = delegationDepth(ctx, item.id) + 1;
  try {
    assertDelegationBounds(depth, open);
  } catch (error) {
    if (isQandeelError(error, 'ORG_NOT_ELIGIBLE')) refuse(String((error as QandeelError).details?.reason ?? 'DELEGATION_BOUNDS'));
    throw error;
  }
  let taskClass: string;
  let caps: { money: number; tokens: number };
  try {
    taskClass = assertTaskClass(own(a, 'taskClass'));
    caps = assertBudgetCaps(own(a, 'budgetMoney'), own(a, 'budgetTokens'));
  } catch {
    return refuse('INVALID_ARGS');
  }
  const objective = text(own(a, 'objective'), 2000);
  const instructions = text(own(a, 'instructions'), 11_000);
  const dueAt = own(a, 'dueAt');
  if (dueAt !== undefined && dueAt !== null && !isTimestamp(dueAt)) refuse('INVALID_ARGS');
  // The child is funded from the delegate's existing envelope, never above the parent Work Item's cap: no budget is created.
  const parentBudget = budgetFor(ctx, 'WORK_ITEM', item.id);
  if (!parentBudget) refuse('PARENT_BUDGET_MISSING');
  if (!budgetFor(ctx, 'EMPLOYEE', delegateId)) refuse('DELEGATE_BUDGET_MISSING');
  // The parent's cap bounds everything it delegates, in aggregate: each child gets at most what is not yet delegated.
  const given = ctx.db.get<{ m: number; t: number }>('SELECT COALESCE(SUM(budget_cap_money), 0) AS m, COALESCE(SUM(budget_cap_tokens), 0) AS t FROM work_delegations WHERE parent_work_item_id = ?', item.id);
  const remaining = { money: (parentBudget?.capMoney ?? 0) - Number(given?.m ?? 0), tokens: (parentBudget?.capTokens ?? 0) - Number(given?.t ?? 0) };
  if (remaining.money <= 0 || remaining.tokens <= 0) refuse('PARENT_BUDGET_EXHAUSTED');
  const created = txCreateWorkItem(
    ctx,
    {
      objective,
      ownerRef: `employee:${delegateId}`,
      riskLevel: item.riskLevel,
      processorKind: EMPLOYEE_TASK,
      processorInput: { taskClass, dataClass: effectiveDataClass(ctx, item.id), instructions },
      parentId: item.id,
      ...(typeof dueAt === 'string' ? { dueAt } : {}),
      dedupeKey: `handoff:${item.id}:${step}`,
      initialState: 'PROPOSED',
    },
    { actorRef },
  );
  const child = created.workItem;
  const childBudget = txAllocateWorkItemBudget(ctx, child.id, delegateId, { money: Math.min(caps.money, remaining.money), tokens: Math.min(caps.tokens, remaining.tokens) }, actorRef, kind === 'SUPPORT' ? 'work.support' : 'work.delegated');
  const plan = own(a, 'reviewPlan');
  if (plan !== undefined) txDeclarePlan(ctx, child, plan, actorRef, fence.runId);
  const ready = applyTransition(ctx, getWorkItemRow(ctx, child.id), 'READY', { reasonCode: kind === 'SUPPORT' ? 'work.support' : 'work.delegated', trace: { correlationId: child.correlationId, actorRef } });
  enqueueJob(ctx, ready, { correlationId: ready.correlationId, actorRef });
  const did = newOrgId();
  const at = ts(ctx);
  const actor = getEmployeeRow(ctx, actorId);
  ctx.db.run(
    `INSERT INTO work_delegations (id, kind, parent_work_item_id, child_work_item_id, root_work_item_id, delegator_employee_id, delegate_employee_id, accountable_owner_ref, source_department_id, target_department_id, depth, state, response_reason_code, accepted_run_id, budget_cap_money, budget_cap_tokens, due_at, created_run_id, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OFFERED', NULL, NULL, ?, ?, ?, ?, 1, ?, ?)`,
    did, kind, item.id, child.id, item.rootId, actorId, delegateId, root.ownerRef, actor.departmentId, targetDept ?? delegate.departmentId, depth, childBudget.capMoney, childBudget.capTokens, typeof dueAt === 'string' ? dueAt : null, fence.runId, at, at,
  );
  delegationHistory(ctx, did, 1, null, 'OFFERED', kind === 'SUPPORT' ? 'work.support' : 'work.delegated', actorRef);
  appendAudit(ctx, kind === 'SUPPORT' ? 'org.support_requested' : 'org.work_delegated', 'work_delegation', did, { actorRef, correlationId: item.correlationId }, 'OK', null, { parentWorkItemId: item.id, childWorkItemId: child.id, delegateEmployeeId: delegateId, depth });
  return `work_item:${child.id}`;
}

/** The one delegation record behind a decide / hire grant (its policy limits bind the act). */
function delegationFor(ctx: StoreContext, grantId: Id): { id: Id; limits: ReturnType<typeof parseDelegationLimits> } {
  const d = ctx.db.get<{ id: string; limits_json: string }>(`SELECT id, limits_json FROM authority_delegations WHERE grant_id = ? AND status = 'ACTIVE'`, grantId);
  if (!d) return refuse('DELEGATION_REQUIRED');
  return { id: d.id as Id, limits: parseDelegationLimits(JSON.parse(d.limits_json)) };
}

function withinLimits(ctx: StoreContext, grantId: Id, r: { expectedCostMicros: number | null; roleRef: string; positionKind: string; departmentId: Id | null }): Id {
  const d = delegationFor(ctx, grantId);
  const code = r.departmentId === null ? null : (ctx.db.get<{ code: string }>('SELECT code FROM departments WHERE id = ?', r.departmentId)?.code ?? null);
  const verdict = limitsAllow(d.limits, { costMicros: r.expectedCostMicros, roleRef: r.roleRef, positionKind: r.positionKind, departmentCode: code });
  if (!verdict.ok) refuse(verdict.reason);
  return d.id;
}

function perform(ctx: StoreContext, fence: Fence, step: number, e: { id: Id; ref: string; departmentId: Id | null }, action: OrgAction, args: Record<string, unknown>, grantId: Id | null): string | null {
  const at = ts(ctx);
  const runId = fence.runId;
  const item = getWorkItemRow(ctx, attributed(ctx, fence).workItemId);
  switch (action) {
    case 'staffing.request.create': {
      let req;
      try {
        req = parseStaffingRequest(args);
      } catch (error) {
        return refuse(isQandeelError(error, 'VALIDATION_FAILED') && (error as QandeelError).details?.reason === 'STAFFING_EVIDENCE_INCOMPLETE' ? 'STAFFING_EVIDENCE_INCOMPLETE' : 'INVALID_ARGS');
      }
      for (const v of [req.businessNeed, req.workloadEvidence, req.skillGap, req.expectedValue, req.impactIfNotStaffed, ...Object.values(req.alternatives)]) if (containsSecretMaterial(v)) refuse('SECRET_MATERIAL');
      const dept = req.departmentCode === null ? null : (ctx.db.get<{ id: string }>(`SELECT id FROM departments WHERE code = ? AND status = 'ACTIVE'`, req.departmentCode)?.id ?? refuse('DEPARTMENT_NOT_FOUND')) as Id | null;
      // Directors file for their Department; the CEO files company-scoped requests. A title alone files nothing.
      const seat = dept === null ? holdsSeat(ctx, e.id, 'CEO', null, at, action) : holdsSeat(ctx, e.id, 'DIRECTOR', dept, at, action);
      if (!seat) refuse('SEAT_NOT_HELD');
      const rid = newOrgId();
      ctx.db.run(
        `INSERT INTO staffing_requests (id, scope, department_id, requested_by_employee_id, requested_by_position_id, requested_run_id, role_ref, position_kind, position_title, business_need, workload_evidence, skill_gap, expected_value, impact_if_not_staffed, alternatives_json, expected_cost_micros, priority, state, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'SUBMITTED', 1, ?, ?)`,
        rid, dept === null ? 'COMPANY' : 'DEPARTMENT', dept, e.id, (seat as { id: Id }).id, runId, req.roleRef, req.positionKind, req.positionTitle, req.businessNeed, req.workloadEvidence, req.skillGap, req.expectedValue, req.impactIfNotStaffed,
        canonicalJson(req.alternatives), req.expectedCostMicros, at, at,
      );
      staffingHistory(ctx, rid, 1, null, 'SUBMITTED', 'staffing.submitted', e.ref);
      appendAudit(ctx, 'org.staffing_submitted', 'staffing_request', rid, { actorRef: e.ref }, 'OK', null, { departmentId: dept, positionKind: req.positionKind });
      return `staffing_request:${rid}`;
    }
    case 'staffing.request.review': {
      const a = plain(args, ['requestId', 'action', 'priority', 'consolidateIntoId', 'note']);
      if (!holdsSeat(ctx, e.id, 'CEO', null, at, action)) refuse('SEAT_NOT_HELD');
      const r = getStaffingRequest(ctx, id(own(a, 'requestId')));
      const act = own(a, 'action');
      if (!isStaffingReviewAction(act)) return refuse('INVALID_ARGS');
      let to;
      try {
        to = staffingReviewTarget(r.state, act);
      } catch {
        return refuse('STAFFING_NOT_OPEN');
      }
      const priority = own(a, 'priority');
      if (priority !== undefined && !(Number.isInteger(priority) && (priority as number) >= 0 && (priority as number) <= 100)) refuse('INVALID_ARGS');
      if (act === 'PRIORITIZE' && priority === undefined) refuse('INVALID_ARGS');
      let into: Id | null = null;
      if (act === 'CONSOLIDATE') {
        into = id(own(a, 'consolidateIntoId'));
        const target = getStaffingRequest(ctx, into);
        if (target.id === r.id || !['SUBMITTED', 'CHALLENGED', 'PRIORITIZED', 'RECOMMENDED'].includes(target.state)) refuse('CONSOLIDATION_TARGET_INVALID');
      }
      const note = own(a, 'note') === undefined ? null : text(own(a, 'note'), 2000);
      const rec = act === 'RECOMMEND_APPROVE' ? 'APPROVE' : act === 'RECOMMEND_REJECT' ? 'REJECT' : null;
      ctx.db.run(
        `UPDATE staffing_requests SET state = ?, priority = COALESCE(?, priority), consolidated_into_id = ?, ceo_recommendation = COALESCE(?, ceo_recommendation), ceo_note = COALESCE(?, ceo_note), version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
        to, priority === undefined ? null : (priority as number), into, rec, note, at, r.id, r.version,
      );
      staffingHistory(ctx, r.id, r.version + 1, r.state, to, `staffing.${act.toLowerCase()}`, e.ref);
      appendAudit(ctx, 'org.staffing_reviewed', 'staffing_request', r.id, { actorRef: e.ref }, 'OK', act, { to });
      return `staffing_request:${r.id}`;
    }
    case 'staffing.request.decide': {
      const a = plain(args, ['requestId', 'decision', 'positionCode', 'positionTitle']);
      if (!holdsSeat(ctx, e.id, 'CEO', null, at, action)) refuse('SEAT_NOT_HELD');
      const r = getStaffingRequest(ctx, id(own(a, 'requestId')));
      const decision = own(a, 'decision');
      if (decision !== 'APPROVE' && decision !== 'REJECT') return refuse('INVALID_ARGS');
      // A delegated decision is taken only on a request the CEO has itself recommended, within every limit.
      if (r.state !== 'RECOMMENDED') refuse('STAFFING_NOT_RECOMMENDED');
      const delegationId = withinLimits(ctx, grantId as Id, r);
      const code = own(a, 'positionCode');
      const title = own(a, 'positionTitle');
      try {
        txDecideStaffing(ctx, r, decision, { positionCode: typeof code === 'string' ? code : null, positionTitle: typeof title === 'string' ? title : null }, e.ref, `authority_delegation:${delegationId}`, 'staffing.decided.delegated');
      } catch (error) {
        if (isQandeelError(error, 'VALIDATION_FAILED')) refuse('INVALID_ARGS');
        throw error;
      }
      return `staffing_request:${r.id}`;
    }
    case 'staffing.hire': {
      const a = plain(args, ['requestId', 'name', 'cognitiveProfile']);
      if (!holdsSeat(ctx, e.id, 'CEO', null, at, action)) refuse('SEAT_NOT_HELD');
      const r = getStaffingRequest(ctx, id(own(a, 'requestId')));
      if (r.state !== 'APPROVED' || r.hiredEmployeeId !== null) refuse('STAFFING_NOT_HIRABLE');
      const delegationId = withinLimits(ctx, grantId as Id, r);
      try {
        const { employee } = txHireForRequest(ctx, r, { name: own(a, 'name') as { given: string; family: string }, cognitiveProfile: own(a, 'cognitiveProfile') as never }, e.ref, `authority_delegation:${delegationId}`, 'staffing.hired.delegated');
        return `employee:${employee.id}`;
      } catch (error) {
        if (isQandeelError(error, 'VALIDATION_FAILED')) refuse('INVALID_ARGS');
        throw error;
      }
    }
    case 'work.delegate': {
      const a = plain(args, ['delegateEmployeeId', 'objective', 'instructions', 'taskClass', 'budgetMoney', 'budgetTokens', 'dueAt', 'reviewPlan']);
      const delegateId = id(own(a, 'delegateEmployeeId'));
      // Work goes down the reporting line; across Departments it is a support request, never a delegation.
      if (!reportsTo(ctx, e.id, delegateId, action)) refuse('DELEGATE_NOT_IN_REPORTING_LINE');
      return delegateWork(ctx, fence, step, e.id, e.ref, 'DELEGATION', delegateId, null, a);
    }
    case 'work.support.request': {
      const a = plain(args, ['departmentCode', 'objective', 'instructions', 'taskClass', 'budgetMoney', 'budgetTokens', 'dueAt', 'reviewPlan']);
      let code: string;
      try {
        code = assertCatalogCode(own(a, 'departmentCode'), 'departmentCode');
      } catch {
        return refuse('INVALID_ARGS');
      }
      const dept = (ctx.db.get<{ id: string }>(`SELECT id FROM departments WHERE code = ? AND status = 'ACTIVE'`, code)?.id ?? refuse('DEPARTMENT_NOT_FOUND')) as Id;
      if (dept === e.departmentId) refuse('SUPPORT_WITHIN_OWN_DEPARTMENT');
      // The request goes to the accountable holder of the target Department's Director seat (it changes no reporting line).
      const seat = directorSeatOf(ctx, dept);
      const holder = seat ? seatHolder(ctx, seat.id, at).holder : null;
      if (!holder) return refuse('SUPPORT_UNSTAFFED');
      return delegateWork(ctx, fence, step, e.id, e.ref, 'SUPPORT', holder.employeeId, dept, a);
    }
    case 'work.reprioritize': {
      const a = plain(args, ['workItemId', 'priority']);
      const target = id(own(a, 'workItemId'));
      const priority = own(a, 'priority');
      if (!(Number.isInteger(priority) && (priority as number) >= 0 && (priority as number) <= 100)) refuse('INVALID_ARGS');
      const d = ctx.db.get(`SELECT * FROM work_delegations WHERE child_work_item_id = ? AND delegator_employee_id = ?`, target, e.id);
      if (!d || !OPEN_DELEGATION.includes(mapWorkDelegation(d).state)) refuse('NOT_DELEGATOR');
      const child = getWorkItemRow(ctx, target);
      ctx.db.run('UPDATE work_items SET priority = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', priority as number, at, child.id, child.version);
      ctx.db.run(`UPDATE queue_jobs SET priority = ?, updated_at = ? WHERE work_item_id = ? AND state IN ('QUEUED', 'WAITING')`, priority as number, at, child.id);
      appendAudit(ctx, 'org.work_reprioritized', 'work_item', child.id, { actorRef: e.ref }, 'OK', null, { from: child.priority, to: priority as number });
      return `work_item:${child.id}`;
    }
    case 'handoff.refuse':
    case 'handoff.clarification.request': {
      const a = plain(args, ['reason']);
      const d = ownHandoff(ctx, item.id, e.id);
      if (!d || !['OFFERED', 'ACCEPTED'].includes(d.state)) return refuse('NO_OPEN_HANDOFF');
      const refusing = action === 'handoff.refuse';
      handoffMessage(ctx, d, refusing ? 'REFUSAL' : 'CLARIFICATION_REQUEST', e.id, runId, text(own(a, 'reason'), 2000));
      setDelegationState(ctx, d, refusing ? 'REFUSED' : 'CLARIFICATION_REQUESTED', refusing ? 'HANDOFF_REFUSED' : 'CLARIFICATION_REQUESTED', e.ref);
      wakeWorkItemJob(ctx, d.parentWorkItemId, ['AWAITING_DELEGATION'], refusing ? 'handoff.refused' : 'handoff.clarification_requested');
      return `work_delegation:${d.id}`;
    }
    case 'handoff.clarify': {
      const a = plain(args, ['delegationId', 'answer']);
      const row = ctx.db.get('SELECT * FROM work_delegations WHERE id = ?', id(own(a, 'delegationId')));
      const d = row ? mapWorkDelegation(row) : null;
      if (!d || d.delegatorEmployeeId !== e.id) return refuse('NOT_DELEGATOR');
      if (d.state !== 'CLARIFICATION_REQUESTED') refuse('NO_CLARIFICATION_REQUESTED');
      handoffMessage(ctx, d, 'CLARIFICATION', e.id, runId, text(own(a, 'answer'), 2000));
      setDelegationState(ctx, d, d.acceptedRunId === null ? 'OFFERED' : 'ACCEPTED', 'CLARIFIED', e.ref);
      wakeWorkItemJob(ctx, d.childWorkItemId, ['AWAITING_CLARIFICATION'], 'handoff.clarified');
      return `work_delegation:${d.id}`;
    }
    case 'handoff.escalate': {
      const a = plain(args, ['delegationId', 'reason']);
      let d = ownHandoff(ctx, item.id, e.id);
      if (own(a, 'delegationId') !== undefined) {
        const row = ctx.db.get('SELECT * FROM work_delegations WHERE id = ?', id(own(a, 'delegationId')));
        d = row ? mapWorkDelegation(row) : null;
        if (d && d.delegatorEmployeeId !== e.id && d.delegateEmployeeId !== e.id) d = null;
      }
      if (!d || !['OFFERED', 'ACCEPTED', 'CLARIFICATION_REQUESTED'].includes(d.state)) return refuse('NO_OPEN_HANDOFF');
      handoffMessage(ctx, d, 'ESCALATION', e.id, runId, text(own(a, 'reason'), 2000));
      setDelegationState(ctx, d, 'ESCALATED', 'HANDOFF_ESCALATED', e.ref);
      wakeWorkItemJob(ctx, d.parentWorkItemId, ['AWAITING_DELEGATION'], 'handoff.escalated');
      return `work_delegation:${d.id}`;
    }
    case 'review.plan.declare': {
      const a = plain(args, ['workItemId', 'plan']);
      const target = getWorkItemRow(ctx, id(own(a, 'workItemId')));
      // The accountable party declares how its work is reviewed: the owner of the Work Item, or its delegator.
      const delegator = ctx.db.get(`SELECT 1 AS x FROM work_delegations WHERE child_work_item_id = ? AND delegator_employee_id = ?`, target.id, e.id);
      if (target.ownerRef !== e.ref && !delegator) refuse('NOT_ACCOUNTABLE');
      try {
        const plan = txDeclarePlan(ctx, target, own(a, 'plan'), e.ref, runId);
        return `review_plan:${plan.id}`;
      } catch (error) {
        if (isQandeelError(error, 'VALIDATION_FAILED')) refuse('INVALID_ARGS');
        if (isQandeelError(error, 'INVALID_TRANSITION') || isQandeelError(error, 'TERMINAL_STATE')) refuse('REVIEW_PLAN_AFTER_EXECUTION');
        throw error;
      }
    }
  }
  return null;
}

/**
 * Proposes one organizational act for the run's Employee at a Work-Item-global step (the runtime derives
 * the step; a resumed run replays the recorded outcome, never repeats the act).
 */
export function txOrgAct(ctx: StoreContext, fence: Fence, step: number, actionInput: unknown, argsInput: unknown): OrgActResult {
  verifyFence(ctx, fence);
  const a = attributed(ctx, fence);
  const e = enforceRoleCertification(ctx, getEmployeeRow(ctx, a.employeeId));
  const item = getWorkItemRow(ctx, a.workItemId);
  const action = isOrgAction(actionInput) ? actionInput : null;
  const args = (argsInput ?? {}) as JsonObject;
  const argsSha256 = sha256Hex(canonicalJson(args));
  const s = Math.max(0, Math.trunc(step));
  const prior = ctx.db.get<{ action: string; args_sha256: string; outcome: string; result_code: string; result_ref: string | null }>('SELECT action, args_sha256, outcome, result_code, result_ref FROM org_act_records WHERE work_item_id = ? AND step = ?', item.id, s);
  const isDelegate = ownHandoff(ctx, item.id, e.id) !== null;
  if (prior) {
    if (prior.action !== (action ?? 'unknown') || prior.args_sha256 !== argsSha256) return { outcome: 'REFUSED', code: 'IDEMPOTENCY_CONFLICT', resultRef: null, after: 'CONTINUE', replayed: true, paused: false };
    const done = prior.outcome === 'DONE';
    return { outcome: done ? 'DONE' : 'REFUSED', code: prior.result_code, resultRef: prior.result_ref, after: done && action ? after(action, isDelegate) : 'CONTINUE', replayed: true, paused: false };
  }
  const record = (outcome: 'DONE' | 'REFUSED', code: string, ref: string | null): void => {
    ctx.db.run('INSERT INTO org_act_records (work_item_id, step, run_id, employee_id, action, args_sha256, outcome, result_code, result_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', item.id, s, fence.runId, e.id, action ?? 'unknown', argsSha256, outcome, code, ref, ts(ctx));
  };
  const refused = (code: string, paused = false): OrgActResult => {
    record('REFUSED', code, null);
    if (!paused) appendAudit(ctx, 'org.act_refused', 'run', fence.runId, { actorRef: e.ref }, 'REJECTED', code, { action: action ?? 'unknown', employeeId: e.id });
    return { outcome: 'REFUSED', code, resultRef: null, after: 'CONTINUE', replayed: false, paused };
  };
  if (action === null) return refused('UNKNOWN_ORG_ACTION');
  // Constrained Academy / shadow runs act on nothing organizational (Stage 6 §11).
  if (!canExecute(e.state) || academyRun(ctx, fence.runId)) return refused('ACADEMY_CONSTRAINED');
  const capability = orgActionCapability(action);
  let grantId: Id | null = null;
  if (capability !== null) {
    const grants = ctx.db.all(`SELECT * FROM permission_grants WHERE employee_id = ? AND status = 'ACTIVE'`, e.id).map(mapGrant);
    const decision = decideOrgAct(actingState(ctx, fence.runId, e), grants, { capability, resource: '*', at: ts(ctx) });
    if (decision.effect === 'DENY') {
      const { paused } = recordDenial(ctx, fence, e.id, decision.code, { capability });
      return refused(decision.code, paused);
    }
    grantId = decision.grantId as Id;
  }
  let ref: string | null;
  try {
    ref = ctx.db.savepoint('org act', () => perform(ctx, fence, s, { id: e.id, ref: e.ref, departmentId: e.departmentId }, action, args as Record<string, unknown>, grantId));
  } catch (error) {
    if (error instanceof Refusal) return refused(error.code);
    throw error;
  }
  if (grantId !== null) consumeGrant(ctx, grantId);
  record('DONE', 'DONE', ref);
  appendAudit(ctx, 'org.act', 'run', fence.runId, { actorRef: e.ref, correlationId: item.correlationId }, 'OK', null, { action, employeeId: e.id, resultRef: ref, grantId });
  return { outcome: 'DONE', code: 'DONE', resultRef: ref, after: after(action, isDelegate), replayed: false, paused: false };
}

// --- Review decisions -----------------------------------------------------------------------------------

export interface ReviewDecisionResult {
  readonly outcome: 'RECORDED' | 'REFUSED';
  readonly code: string;
  readonly requestState: string | null;
}

/**
 * Records the reviewer's decision from inside its own review Work Item (the only path an Employee reviews
 * through). The assignment is the one this run's Work Item was created for; eligibility, independence and
 * subject freshness are re-checked at this boundary (review-core).
 */
export function txReviewDecision(ctx: StoreContext, fence: Fence, input: { outcome: unknown; reasonCode: string; rationale: string | null; evidenceRefs: readonly string[] }): ReviewDecisionResult {
  verifyFence(ctx, fence);
  const a = attributed(ctx, fence);
  const e = enforceRoleCertification(ctx, getEmployeeRow(ctx, a.employeeId));
  const row = ctx.db.get('SELECT * FROM review_assignments WHERE review_work_item_id = ?', a.workItemId);
  const deny = (code: string): ReviewDecisionResult => {
    appendAudit(ctx, 'review.decision_refused', 'run', fence.runId, { actorRef: e.ref }, 'REJECTED', code, { employeeId: e.id });
    return { outcome: 'REFUSED', code, requestState: null };
  };
  if (!row) return deny('NOT_A_REVIEW_WORK_ITEM');
  const assignment = mapReviewAssignment(row);
  if (assignment.reviewerEmployeeId !== e.id) return deny('NOT_THE_ASSIGNED_REVIEWER');
  if (!canExecute(e.state) || academyRun(ctx, fence.runId)) return deny('ACADEMY_CONSTRAINED');
  if (!isReviewOutcome(input.outcome)) return deny('INVALID_ARGS');
  const rationale = input.rationale === null ? null : boundedText(input.rationale, 'rationale', 4000);
  if (rationale !== null && containsSecretMaterial(rationale)) return deny('SECRET_MATERIAL');
  const r = recordDecision(ctx, assignment, e.ref, { outcome: input.outcome as ReviewOutcome, reasonCode: input.reasonCode, rationale, evidenceRefs: input.evidenceRefs }, fence.runId);
  if (!r.recorded) return r.code === 'ALREADY_DECIDED' ? { outcome: 'RECORDED', code: 'ALREADY_DECIDED', requestState: r.request.state } : deny(r.code);
  return { outcome: 'RECORDED', code: 'RECORDED', requestState: r.request.state };
}
