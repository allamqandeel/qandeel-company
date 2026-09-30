/**
 * GoalStore — the durable Goal model (C5, Stage 2 §3): stable identity, kind / scope, lifecycle with
 * append-only history, ownership, derivation (Department ← Company), horizon and Goal → Work links.
 *
 * Founder acts (propose, approve, activate, pause, achieve, cancel, supersede, link) pass the Founder
 * chokepoint: they fail closed outside an authenticated session (or the test seam). A Director derives a
 * Department goal only from inside its own governed run (`txGoalAct`, fenced, runtime-authority), never by
 * presenting a reference. Goals never carry authority, budget or a second Work Item engine.
 */
import { QandeelError, assertCode, assertId, boundedJson, boundedText, isTimestamp, newId, type Id, type Timestamp } from '@qandeel-company/domain';
import { assertGoalTransition, goalTransitionNeedsFounder, isGoalKind, isGoalState, type GoalKind, type GoalState } from '@qandeel-company/governance';
import { containsSecretMaterial } from '@qandeel-company/mind';

import { getEmployeeRow } from './governance-core.js';
import { founder, founderAdminWrite } from './governance.js';
import { mapGoal, mapGoalHistory, mapGoalWorkLink, mustRow, type GoalHistoryRecord, type GoalRecord, type GoalWorkLinkRecord } from './founder-records.js';
import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { enforceRoleCertification } from './mind-core.js';
import { academyRun } from './mind-writes.js';
import { holdsSeat } from './org-core.js';
import { storeContext, type CompanyStore } from './store.js';

export interface ProposeGoalInput {
  readonly kind: GoalKind;
  readonly departmentId?: string | null;
  readonly parentGoalId?: string | null;
  readonly title: string;
  readonly summary: string;
  readonly successCriteria?: readonly string[];
  readonly ownerRef: string;
  readonly horizonFrom?: string | null;
  readonly horizonTo?: string | null;
}

export function getGoal(ctx: StoreContext, id: Id): GoalRecord {
  const r = ctx.db.get('SELECT * FROM goals WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'goal not found', { goalId: id });
  return mapGoal(r);
}

function goalHistory(ctx: StoreContext, goalId: Id, version: number, from: GoalState | null, to: GoalState, reasonCode: string, actorRef: string): void {
  ctx.db.run('INSERT INTO goal_history (goal_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', goalId, version, from, to, reasonCode, actorRef, ts(ctx));
}

const optionalTs = (v: unknown, field: string): Timestamp | null => {
  if (v === undefined || v === null) return null;
  if (!isTimestamp(v)) throw new QandeelError('VALIDATION_FAILED', `${field} must be a canonical UTC timestamp`, { field });
  return v;
};

/** Inserts a goal (DRAFT or PROPOSED) in the caller's transaction; shared by the Founder act and the fenced Director act. */
export function txInsertGoal(ctx: StoreContext, input: ProposeGoalInput, actorRef: string, initial: 'DRAFT' | 'PROPOSED', reasonCode: string): GoalRecord {
  if (!isGoalKind(input.kind)) throw new QandeelError('VALIDATION_FAILED', 'kind is COMPANY or DEPARTMENT', { field: 'kind' });
  const dept = input.kind === 'DEPARTMENT' ? assertId(input.departmentId, 'departmentId') : null;
  if (input.kind === 'COMPANY' && input.departmentId !== undefined && input.departmentId !== null) throw new QandeelError('VALIDATION_FAILED', 'a company goal has no Department', { field: 'departmentId' });
  if (dept !== null && !ctx.db.get(`SELECT 1 AS ok FROM departments WHERE id = ? AND status = 'ACTIVE'`, dept)) throw new QandeelError('NOT_FOUND', 'department not found', { departmentId: dept });
  const parent = input.kind === 'DEPARTMENT' ? getGoal(ctx, assertId(input.parentGoalId, 'parentGoalId')) : null;
  if (input.kind === 'COMPANY' && input.parentGoalId !== undefined && input.parentGoalId !== null) throw new QandeelError('VALIDATION_FAILED', 'a company goal derives from nothing', { field: 'parentGoalId' });
  if (parent !== null && (parent.kind !== 'COMPANY' || (parent.state !== 'APPROVED' && parent.state !== 'ACTIVE'))) throw new QandeelError('GOAL_INVALID', 'a Department goal derives from an approved company goal', { parentGoalId: parent.id, state: parent.state });
  const from = optionalTs(input.horizonFrom, 'horizonFrom');
  const to = optionalTs(input.horizonTo, 'horizonTo');
  if (from !== null && to !== null && to < from) throw new QandeelError('VALIDATION_FAILED', 'horizonTo precedes horizonFrom', { field: 'horizonTo' });
  const criteria = (input.successCriteria ?? []).map((c, i) => boundedText(c, `successCriteria[${i}]`, 400));
  if (criteria.length > 12) throw new QandeelError('VALIDATION_FAILED', 'too many success criteria', { field: 'successCriteria' });
  // m-20: goal text (Founder-typed or model-authored through `goal.derive`) is secret-scanned like every sibling text.
  for (const [field, text] of [['title', input.title], ['summary', input.summary], ...criteria.map((c, i) => [`successCriteria[${i}]`, c] as const)] as const) {
    if (typeof text === 'string' && containsSecretMaterial(text)) throw new QandeelError('VALIDATION_FAILED', 'goal text carries secret material', { field, reason: 'SECRET_MATERIAL' });
  }
  const id = newId();
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO goals (id, kind, department_id, title, summary, success_criteria_json, state, owner_ref, parent_goal_id, horizon_from, horizon_to, approved_by_ref, approved_at, superseded_by, created_by_ref, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 1, ?, ?)`,
    id, input.kind, dept, boundedText(input.title, 'title', 160), boundedText(input.summary, 'summary', 2000), boundedJson(criteria, 'successCriteria', 4096), initial,
    boundedText(input.ownerRef, 'ownerRef', 161), parent?.id ?? null, from, to, actorRef, at, at,
  );
  goalHistory(ctx, id, 1, null, initial, reasonCode, actorRef);
  appendAudit(ctx, 'goal.proposed', 'goal', id, { actorRef }, 'OK', reasonCode, { kind: input.kind, departmentId: dept, parentGoalId: parent?.id ?? null, state: initial });
  return getGoal(ctx, id);
}

/** One lifecycle step in the caller's transaction (the actor's authority is the caller's responsibility). */
export function txGoalTransition(ctx: StoreContext, goalId: Id, to: GoalState, actorRef: string, reasonCode: string, extra: { supersededBy?: Id } = {}): GoalRecord {
  const g = getGoal(ctx, goalId);
  assertGoalTransition(g.state, to);
  const at = ts(ctx);
  const approving = (to === 'APPROVED' || to === 'ACTIVE') && g.approvedByRef === null && g.kind === 'COMPANY';
  if (approving && !actorRef.startsWith('founder:')) throw new QandeelError('FOUNDER_ONLY', 'a company goal is approved by the Founder', { goalId: g.id });
  const superseded = to === 'SUPERSEDED' ? assertId(extra.supersededBy, 'supersededBy') : null;
  if (superseded !== null) {
    const next = getGoal(ctx, superseded);
    if (next.id === g.id || next.kind !== g.kind) throw new QandeelError('GOAL_INVALID', 'a goal is superseded by a live goal of the same kind', { goalId: g.id, supersededBy: superseded });
  }
  const changed = ctx.db.run(
    `UPDATE goals SET state = ?, approved_by_ref = COALESCE(approved_by_ref, ?), approved_at = COALESCE(approved_at, ?), superseded_by = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
    to, approving ? actorRef : null, approving ? at : null, superseded, at, g.id, g.version,
  ).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'goal changed concurrently', { goalId: g.id });
  goalHistory(ctx, g.id, g.version + 1, g.state, to, reasonCode, actorRef);
  appendAudit(ctx, `goal.${to.toLowerCase()}`, 'goal', g.id, { actorRef }, 'OK', reasonCode, { from: g.state, to, kind: g.kind });
  return getGoal(ctx, g.id);
}

export function txLinkGoalWork(ctx: StoreContext, goalId: Id, workItemId: Id, linkKind: 'SERVES' | 'DERIVED', actorRef: string): GoalWorkLinkRecord {
  const g = getGoal(ctx, goalId);
  if (g.state === 'CANCELLED' || g.state === 'SUPERSEDED' || g.state === 'ACHIEVED') throw new QandeelError('GOAL_INVALID', 'a closed goal accepts no new work', { goalId: g.id, state: g.state });
  getWorkItemRow(ctx, workItemId);
  const existing = ctx.db.get('SELECT * FROM goal_work_links WHERE goal_id = ? AND work_item_id = ? AND ended_at IS NULL', g.id, workItemId);
  if (existing) return mapGoalWorkLink(existing);
  const id = newId();
  ctx.db.run('INSERT INTO goal_work_links (id, goal_id, work_item_id, link_kind, created_by_ref, created_at, ended_at, end_reason_code) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)', id, g.id, workItemId, linkKind, actorRef, ts(ctx));
  appendAudit(ctx, 'goal.work_linked', 'goal', g.id, { actorRef }, 'OK', linkKind, { workItemId });
  return mapGoalWorkLink(mustRow(ctx.db.get('SELECT * FROM goal_work_links WHERE id = ?', id), 'goal work link'));
}

/** Fenced Director act (reached through runtime-authority only): derive a Department goal or link own work to a goal. */
export function txGoalAct(ctx: StoreContext, employeeId: Id, employeeRef: string, departmentId: Id | null, workItemId: Id, runId: Id, action: 'goal.derive' | 'goal.link', args: Record<string, unknown>): { outcome: 'DONE' | 'REFUSED'; code: string; resultRef: string | null } {
  const at = ts(ctx);
  // m-21: the same eligibility boundary as an organizational act (`txOrgAct`): a lapsed role certification
  // moves an ACTIVE Employee to RETRAINING here, and a constrained Academy / shadow run acts on nothing.
  const e = enforceRoleCertification(ctx, getEmployeeRow(ctx, employeeId));
  if (e.state !== 'ACTIVE') return { outcome: 'REFUSED', code: 'EMPLOYEE_NOT_ELIGIBLE', resultRef: null };
  if (academyRun(ctx, runId)) return { outcome: 'REFUSED', code: 'ACADEMY_CONSTRAINED', resultRef: null };
  try {
    if (action === 'goal.derive') {
      if (departmentId === null || holdsSeat(ctx, employeeId, 'DIRECTOR', departmentId, at, 'goal.derive') === null) return { outcome: 'REFUSED', code: 'SEAT_NOT_HELD', resultRef: null };
      // Idempotent per (Employee, parent, title): a resumed run never derives the same goal twice.
      const prior = ctx.db.get<{ id: string }>(`SELECT id FROM goals WHERE kind = 'DEPARTMENT' AND department_id = ? AND parent_goal_id = ? AND title = ? AND created_by_ref = ? AND state NOT IN ('CANCELLED', 'SUPERSEDED')`, departmentId, String(args.parentGoalId ?? ''), String(args.title ?? ''), employeeRef);
      if (prior) return { outcome: 'DONE', code: 'REPLAYED', resultRef: `goal:${prior.id}` };
      const g = txInsertGoal(ctx, { kind: 'DEPARTMENT', departmentId, parentGoalId: String(args.parentGoalId ?? ''), title: String(args.title ?? ''), summary: String(args.summary ?? ''), successCriteria: Array.isArray(args.successCriteria) ? args.successCriteria.map(String) : [], ownerRef: employeeRef, horizonFrom: (args.horizonFrom as string | null | undefined) ?? null, horizonTo: (args.horizonTo as string | null | undefined) ?? null }, employeeRef, 'PROPOSED', 'goal.derived');
      // A derived Department goal inside authority activates without a second Founder act (Stage 2 §3).
      txGoalTransition(ctx, g.id, 'APPROVED', employeeRef, 'goal.derived');
      const active = txGoalTransition(ctx, g.id, 'ACTIVE', employeeRef, 'goal.derived');
      return { outcome: 'DONE', code: 'GOAL_DERIVED', resultRef: `goal:${active.id}` };
    }
    const goal = getGoal(ctx, assertId(args.goalId, 'goalId'));
    if (goal.kind === 'DEPARTMENT' && goal.departmentId !== departmentId) return { outcome: 'REFUSED', code: 'GOAL_OUTSIDE_DEPARTMENT', resultRef: null };
    const link = txLinkGoalWork(ctx, goal.id, workItemId, 'SERVES', employeeRef);
    return { outcome: 'DONE', code: 'GOAL_LINKED', resultRef: `goal_work_link:${link.id}` };
  } catch (error) {
    if (error instanceof QandeelError) return { outcome: 'REFUSED', code: error.details['reason'] === 'SECRET_MATERIAL' ? 'SECRET_MATERIAL' : error.code, resultRef: null };
    throw error;
  }
}

export class GoalStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): GoalStore {
    return new GoalStore(store);
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  #admin<T>(operation: string, actorRef: string, fn: (ctx: StoreContext) => T): T {
    return founderAdminWrite(this.#store, operation, actorRef, fn);
  }

  /** The Founder proposes (or drafts) a goal; a company goal still needs its explicit approval step. */
  propose(actorRef: string, input: ProposeGoalInput, options: { draft?: boolean; reasonCode?: string } = {}): GoalRecord {
    return this.#admin('propose goal', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'goal proposal');
      return txInsertGoal(ctx, input, p.ref, options.draft ? 'DRAFT' : 'PROPOSED', assertCode(options.reasonCode ?? 'goal.proposed', 'reasonCode'));
    });
  }

  /** One explicit lifecycle step: APPROVED / ACTIVE / PAUSED / ACHIEVED / CANCELLED / SUPERSEDED / back to DRAFT. */
  transition(actorRef: string, goalId: string, input: { to: GoalState; reasonCode: string; supersededBy?: string }): GoalRecord {
    return this.#admin('goal transition', actorRef, (ctx) => {
      if (!isGoalState(input.to)) throw new QandeelError('VALIDATION_FAILED', 'unknown goal state', { field: 'to' });
      const p = founder(ctx, actorRef, null, 'goal lifecycle');
      const g = getGoal(ctx, assertId(goalId, 'goalId'));
      if (goalTransitionNeedsFounder(g.kind, input.to) && p.kind !== 'FOUNDER') throw new QandeelError('FOUNDER_ONLY', 'company goals are decided by the Founder', { goalId: g.id });
      return txGoalTransition(ctx, g.id, input.to, p.ref, assertCode(input.reasonCode, 'reasonCode'), input.supersededBy === undefined ? {} : { supersededBy: assertId(input.supersededBy, 'supersededBy') });
    });
  }

  linkWork(actorRef: string, goalId: string, workItemId: string, linkKind: 'SERVES' | 'DERIVED' = 'SERVES'): GoalWorkLinkRecord {
    return this.#admin('link goal work', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'goal link');
      if (linkKind !== 'SERVES' && linkKind !== 'DERIVED') throw new QandeelError('VALIDATION_FAILED', 'linkKind is SERVES or DERIVED', { field: 'linkKind' });
      return txLinkGoalWork(ctx, assertId(goalId, 'goalId'), assertId(workItemId, 'workItemId'), linkKind, p.ref);
    });
  }

  unlinkWork(actorRef: string, linkId: string, reasonCode: string): GoalWorkLinkRecord {
    return this.#admin('unlink goal work', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'goal link');
      const id = assertId(linkId, 'linkId');
      const row = ctx.db.get('SELECT * FROM goal_work_links WHERE id = ?', id);
      if (!row) throw new QandeelError('NOT_FOUND', 'goal link not found', { linkId: id });
      const link = mapGoalWorkLink(row);
      if (link.endedAt !== null) return link;
      ctx.db.run('UPDATE goal_work_links SET ended_at = ?, end_reason_code = ? WHERE id = ?', ts(ctx), assertCode(reasonCode, 'reasonCode'), id);
      appendAudit(ctx, 'goal.work_unlinked', 'goal', link.goalId, { actorRef: p.ref }, 'OK', reasonCode, { workItemId: link.workItemId });
      return mapGoalWorkLink(mustRow(ctx.db.get('SELECT * FROM goal_work_links WHERE id = ?', id), 'goal work link'));
    });
  }

  get(id: Id): GoalRecord {
    return this.#read((ctx) => getGoal(ctx, id));
  }

  list(filter: { state?: GoalState; kind?: GoalKind; departmentId?: Id | null; live?: boolean } = {}): GoalRecord[] {
    return this.#read((ctx) =>
      ctx.db
        .all('SELECT * FROM goals ORDER BY created_at, id')
        .map(mapGoal)
        .filter((g) => (filter.state === undefined || g.state === filter.state) && (filter.kind === undefined || g.kind === filter.kind) && (filter.departmentId === undefined || g.departmentId === filter.departmentId) && (!filter.live || ['PROPOSED', 'APPROVED', 'ACTIVE', 'PAUSED'].includes(g.state))),
    );
  }

  history(goalId: Id): GoalHistoryRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM goal_history WHERE goal_id = ? ORDER BY version', goalId).map(mapGoalHistory));
  }

  links(filter: { goalId?: Id; workItemId?: Id; live?: boolean } = {}): GoalWorkLinkRecord[] {
    return this.#read((ctx) =>
      ctx.db
        .all('SELECT * FROM goal_work_links ORDER BY created_at, id')
        .map(mapGoalWorkLink)
        .filter((l) => (filter.goalId === undefined || l.goalId === filter.goalId) && (filter.workItemId === undefined || l.workItemId === filter.workItemId) && (!filter.live || l.endedAt === null)),
    );
  }

  /** The goal's state at T from its history (time-correct Historical Focus). */
  stateAt(goalId: Id, at: Timestamp): GoalState | null {
    return this.#read((ctx) => {
      const g = ctx.db.get<{ created_at: string }>('SELECT created_at FROM goals WHERE id = ?', goalId);
      if (!g || g.created_at > at) return null;
      const h = ctx.db.get<{ to_state: string }>('SELECT to_state FROM goal_history WHERE goal_id = ? AND occurred_at <= ? ORDER BY version DESC LIMIT 1', goalId, at);
      return (h?.to_state as GoalState | undefined) ?? null;
    });
  }
}
