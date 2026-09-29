/**
 * The Company Universe projection (C5 §20): the one read model the Founder surface renders.
 *
 * Derived, deterministic (stable ordering, no randomness) and time-correct: with `at`, seats come from the
 * effective-dated assignments, lifecycle states from the append-only history tables, goals from their
 * history and attention from its durable rows. It is never written back and never canonical: the source
 * records remain authoritative. It carries Founder-scoped company content (names, titles, objectives) and
 * never a secret, never App data, never telemetry; nothing in it is a score (C6).
 */
import { TERMINAL_WORK_ITEM_STATES, type Id, type Timestamp } from '@qandeel-company/domain';
import type { AttentionLane, AttentionLevel, GoalKind, GoalState, PositionKind } from '@qandeel-company/governance';

import { mapEmployee, type EmployeeRecord } from './governance-records.js';
import { mapGoal } from './founder-records.js';
import { openAtItems } from './universe-attention.js';
import { ts, type StoreContext } from './internal.js';
import { seatHolder } from './org-core.js';
import { mapPosition, type PositionRecord } from './org-records.js';
import { storeContext, type CompanyStore } from './store.js';

export const CANONICAL_DEPARTMENT_ORDER = ['strategic-market-intelligence', 'growth', 'brand-creative', 'product', 'engineering'] as const;

export interface UniverseDepartment {
  readonly id: Id;
  readonly code: string;
  readonly name: string;
  /** Sector index in canonical order (stable spatial memory). */
  readonly sector: number;
  readonly directorPositionId: Id | null;
}

export interface UniverseSeat {
  readonly id: Id;
  readonly code: string;
  readonly title: string;
  readonly kind: PositionKind;
  readonly departmentId: Id | null;
  readonly reportsToPositionId: Id | null;
  readonly reportsToFounder: boolean;
  readonly status: string;
  readonly holderEmployeeId: Id | null;
  readonly holderKind: 'PRIMARY' | 'ACTING' | null;
  /** The permanent holder while acting coverage is in force. */
  readonly coveredEmployeeId: Id | null;
  readonly actingUntil: Timestamp | null;
}

export interface UniverseEmployee {
  readonly id: Id;
  readonly ref: string;
  readonly name: { readonly given: string; readonly family: string };
  readonly state: string;
  readonly roleRef: string;
  readonly seatId: Id | null;
  readonly seatKind: PositionKind | null;
  readonly departmentId: Id | null;
  readonly orgScope: 'DEPARTMENT' | 'COMPANY';
  /** Seat chain inward: this employee's seat, its reports-to seat, … the CEO seat, then the Founder. */
  readonly chain: readonly { readonly positionId: Id | null; readonly kind: PositionKind | 'FOUNDER'; readonly employeeId: Id | null }[];
}

export interface UniverseWork {
  readonly id: Id;
  readonly objective: string;
  readonly state: string;
  readonly riskLevel: string;
  readonly ownerEmployeeId: Id | null;
  readonly ownerRef: string;
  readonly departmentId: Id | null;
  readonly parentId: Id | null;
  readonly rootId: Id;
  readonly dueAt: Timestamp | null;
  readonly blockedReason: string | null;
  readonly waitReason: string | null;
  readonly running: boolean;
  readonly goalIds: readonly Id[];
  readonly updatedAt: Timestamp;
}

export type RelationKind = 'DELEGATION' | 'SUPPORT' | 'REVIEW' | 'APPROVAL' | 'HANDOFF' | 'ESCALATION';

export interface UniverseRelation {
  readonly id: string;
  readonly kind: RelationKind;
  /** `employee:<id>` or `founder`. */
  readonly from: string;
  readonly to: string;
  readonly workItemId: Id | null;
  readonly state: string;
  readonly since: Timestamp;
  readonly sourceRef: string;
}

export interface UniverseGoal {
  readonly id: Id;
  readonly kind: GoalKind;
  readonly title: string;
  readonly state: GoalState;
  readonly departmentId: Id | null;
  readonly parentGoalId: Id | null;
  readonly ownerRef: string;
  readonly horizonTo: Timestamp | null;
  /** Departments this goal is anchored to (its own, or those of the work serving it). */
  readonly anchorDepartmentIds: readonly Id[];
  readonly workItemIds: readonly Id[];
}

export interface UniverseAttention {
  readonly id: Id;
  readonly lane: AttentionLane;
  readonly level: AttentionLevel;
  readonly sourceKind: string;
  readonly sourceRef: string;
  readonly ownerRef: string | null;
  readonly firstSeenAt: Timestamp;
  readonly lastSignalAt: Timestamp;
  readonly signalCount: number;
}

export interface CompanyUniverse {
  readonly at: Timestamp;
  readonly live: boolean;
  readonly founderRef: string | null;
  readonly departments: readonly UniverseDepartment[];
  readonly seats: readonly UniverseSeat[];
  readonly employees: readonly UniverseEmployee[];
  readonly work: readonly UniverseWork[];
  readonly relations: readonly UniverseRelation[];
  readonly goals: readonly UniverseGoal[];
  readonly attention: readonly UniverseAttention[];
  readonly signals: { readonly running: number; readonly blocked: number; readonly waitingReview: number; readonly waitingApproval: number; readonly needsFounder: number; readonly vacantSeats: number; readonly actingSeats: number };
}

const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const employeeIdOf = (ref: string): Id | null => (/^employee:([0-9a-f-]{36})$/.exec(ref)?.[1] as Id | undefined) ?? null;

/** The value of a history column at T (append-only history tables; the last row at or before T). */
function historyAt(ctx: StoreContext, sql: string, ...params: string[]): string | null {
  const r = ctx.db.get<{ v: string }>(sql, ...params);
  return r?.v ?? null;
}

export function projectUniverse(store: CompanyStore, options: { at?: Timestamp } = {}): CompanyUniverse {
  const ctx = storeContext(store);
  return ctx.db.snapshot(() => {
    const now = ts(ctx);
    const at = options.at ?? now;
    const live = options.at === undefined || options.at >= now;
    const founderRef = ctx.db.get<{ ref: string }>(`SELECT ref FROM principals WHERE kind = 'FOUNDER' AND status = 'ACTIVE'`)?.ref ?? null;

    // Departments in canonical order; anything non-canonical follows alphabetically.
    const deptRows = ctx.db.all<{ id: string; code: string; name: string; status: string }>(`SELECT id, code, name, status FROM departments WHERE status = 'ACTIVE'`);
    const order = (code: string): number => {
      const i = CANONICAL_DEPARTMENT_ORDER.indexOf(code as (typeof CANONICAL_DEPARTMENT_ORDER)[number]);
      return i < 0 ? 100 : i;
    };
    deptRows.sort((a, b) => order(a.code) - order(b.code) || (a.code < b.code ? -1 : 1));
    const departments: UniverseDepartment[] = deptRows.map((d, i) => ({
      id: d.id as Id,
      code: d.code,
      name: d.name,
      sector: i,
      directorPositionId: (ctx.db.get<{ id: string }>(`SELECT id FROM org_positions WHERE kind = 'DIRECTOR' AND department_id = ? AND status <> 'RETIRED' AND created_at <= ?`, d.id, at)?.id ?? null) as Id | null,
    }));

    // Seats that existed at T, with their status at T and their accountable holder at T.
    const positions: PositionRecord[] = ctx.db.all('SELECT * FROM org_positions WHERE created_at <= ? ORDER BY id', at).map(mapPosition);
    const seats: UniverseSeat[] = positions.map((p) => {
      const status = live ? p.status : (historyAt(ctx, `SELECT to_value AS v FROM org_position_history WHERE position_id = ? AND change_kind = 'STATUS' AND occurred_at <= ? ORDER BY version DESC LIMIT 1`, p.id, at) ?? p.status);
      const h = seatHolder(ctx, p.id, at);
      const holder = h.holder;
      return {
        id: p.id,
        code: p.code,
        title: p.title,
        kind: p.kind,
        departmentId: p.departmentId,
        reportsToPositionId: p.reportsToPositionId,
        reportsToFounder: p.reportsToFounder,
        status,
        holderEmployeeId: holder?.employeeId ?? null,
        holderKind: holder?.kind ?? null,
        coveredEmployeeId: holder?.kind === 'ACTING' ? (h.ofRecord?.employeeId ?? null) : null,
        actingUntil: holder?.kind === 'ACTING' ? holder.plannedTo : null,
      };
    });
    const seatById = new Map(seats.map((s) => [s.id, s]));
    const seatOfEmployee = new Map<string, UniverseSeat>();
    for (const s of seats) if (s.holderEmployeeId !== null && s.holderKind === 'PRIMARY') seatOfEmployee.set(s.holderEmployeeId, s);
    for (const s of seats) if (s.holderEmployeeId !== null && s.holderKind === 'ACTING' && !seatOfEmployee.has(s.holderEmployeeId)) seatOfEmployee.set(s.holderEmployeeId, s);
    // A covered permanent holder still has its own (covered) seat for placement.
    for (const s of seats) if (s.coveredEmployeeId !== null && !seatOfEmployee.has(s.coveredEmployeeId)) seatOfEmployee.set(s.coveredEmployeeId, s);

    const chainOf = (seat: UniverseSeat | undefined): UniverseEmployee['chain'] => {
      const out: { positionId: Id | null; kind: PositionKind | 'FOUNDER'; employeeId: Id | null }[] = [];
      let cursor: UniverseSeat | undefined = seat;
      for (let hops = 0; cursor !== undefined && hops < 40; hops++) {
        out.push({ positionId: cursor.id, kind: cursor.kind, employeeId: cursor.holderEmployeeId });
        cursor = cursor.reportsToPositionId === null ? undefined : seatById.get(cursor.reportsToPositionId);
      }
      out.push({ positionId: null, kind: 'FOUNDER', employeeId: null });
      return out;
    };

    const employees: UniverseEmployee[] = ctx.db
      .all('SELECT * FROM employees WHERE created_at <= ? ORDER BY id', at)
      .map(mapEmployee)
      .map((e: EmployeeRecord) => {
        const state = live ? e.state : (historyAt(ctx, `SELECT to_state AS v FROM employee_history WHERE employee_id = ? AND change_kind IN ('CREATED', 'LIFECYCLE') AND occurred_at <= ? ORDER BY version DESC LIMIT 1`, e.id, at) ?? e.state);
        const seat = seatOfEmployee.get(e.id);
        return {
          id: e.id,
          ref: e.ref,
          name: e.name,
          state,
          roleRef: e.roleRef,
          seatId: seat?.id ?? null,
          seatKind: seat?.kind ?? null,
          departmentId: seat ? seat.departmentId : e.departmentId,
          orgScope: seat ? (seat.departmentId === null ? 'COMPANY' : 'DEPARTMENT') : e.orgScope,
          chain: chainOf(seat),
        };
      })
      .filter((e) => e.state !== 'RETIRED' || !live);
    const employeeById = new Map(employees.map((e) => [e.id, e]));
    const departmentOfEmployee = (id: Id | null): Id | null => (id === null ? null : (employeeById.get(id)?.departmentId ?? null));

    // Live work at T. Historical state comes from the transitions table; blocked / wait reasons only live.
    const workRows = ctx.db.all<{ id: string; root_id: string; parent_id: string | null; objective: string; owner_ref: string; risk_level: string; state: string; blocked_reason: string | null; due_at: string | null; updated_at: string; created_at: string }>(
      'SELECT id, root_id, parent_id, objective, owner_ref, risk_level, state, blocked_reason, due_at, updated_at, created_at FROM work_items WHERE created_at <= ? ORDER BY id',
      at,
    );
    const goalLinks = ctx.db.all<{ goal_id: string; work_item_id: string }>('SELECT goal_id, work_item_id FROM goal_work_links WHERE created_at <= ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY goal_id, work_item_id', at, at);
    const goalsOfWork = new Map<string, Id[]>();
    for (const l of goalLinks) goalsOfWork.set(l.work_item_id, [...(goalsOfWork.get(l.work_item_id) ?? []), l.goal_id as Id]);
    const jobs = live ? new Map(ctx.db.all<{ work_item_id: string; state: string; wait_reason: string | null }>(`SELECT work_item_id, state, wait_reason FROM queue_jobs WHERE state IN ('QUEUED', 'CLAIMED', 'WAITING', 'RECONCILIATION_HOLD', 'DEAD_LETTER')`).map((j) => [j.work_item_id, j])) : new Map<string, { state: string; wait_reason: string | null }>();
    const work: UniverseWork[] = [];
    for (const w of workRows) {
      const state = live ? w.state : (historyAt(ctx, 'SELECT to_state AS v FROM work_item_transitions WHERE work_item_id = ? AND occurred_at <= ? ORDER BY version DESC LIMIT 1', w.id, at) ?? w.state);
      if (TERMINAL_WORK_ITEM_STATES.has(state as never)) continue;
      const owner = employeeIdOf(w.owner_ref);
      const job = jobs.get(w.id);
      work.push({
        id: w.id as Id,
        objective: w.objective.slice(0, 400),
        state,
        riskLevel: w.risk_level,
        ownerEmployeeId: owner,
        ownerRef: w.owner_ref,
        departmentId: departmentOfEmployee(owner),
        parentId: w.parent_id as Id | null,
        rootId: w.root_id as Id,
        dueAt: w.due_at as Timestamp | null,
        blockedReason: live ? w.blocked_reason : null,
        waitReason: job?.wait_reason ?? null,
        running: job?.state === 'CLAIMED',
        goalIds: goalsOfWork.get(w.id) ?? [],
        updatedAt: w.updated_at as Timestamp,
      });
    }
    const workById = new Map(work.map((w) => [w.id, w]));

    // Typed live relations, only from live rows: delegation / support / handoff / escalation, review, approval.
    const relations: UniverseRelation[] = [];
    for (const d of ctx.db.all<{ id: string; kind: string; parent_work_item_id: string; child_work_item_id: string; delegator_employee_id: string; delegate_employee_id: string; state: string; created_at: string }>('SELECT id, kind, parent_work_item_id, child_work_item_id, delegator_employee_id, delegate_employee_id, state, created_at FROM work_delegations WHERE created_at <= ? ORDER BY id', at)) {
      const state = live ? d.state : (historyAt(ctx, 'SELECT to_state AS v FROM work_delegation_history WHERE delegation_id = ? AND occurred_at <= ? ORDER BY version DESC LIMIT 1', d.id, at) ?? d.state);
      if (!['OFFERED', 'ACCEPTED', 'CLARIFICATION_REQUESTED', 'ESCALATED'].includes(state)) continue;
      const kind: RelationKind = state === 'ESCALATED' ? 'ESCALATION' : state === 'CLARIFICATION_REQUESTED' ? 'HANDOFF' : d.kind === 'SUPPORT' ? 'SUPPORT' : 'DELEGATION';
      const from = state === 'ESCALATED' || state === 'CLARIFICATION_REQUESTED' ? `employee:${d.delegate_employee_id}` : `employee:${d.delegator_employee_id}`;
      const to = state === 'ESCALATED' || state === 'CLARIFICATION_REQUESTED' ? `employee:${d.delegator_employee_id}` : `employee:${d.delegate_employee_id}`;
      relations.push({ id: `delegation:${d.id}`, kind, from, to, workItemId: d.child_work_item_id as Id, state, since: d.created_at as Timestamp, sourceRef: `work_delegation:${d.id}` });
    }
    for (const a of ctx.db.all<{ id: string; request_id: string; reviewer_employee_id: string | null; reviewer_ref: string; state: string; created_at: string; updated_at: string; work_item_id: string; request_state: string }>(
      `SELECT a.id, a.request_id, a.reviewer_employee_id, a.reviewer_ref, a.state, a.created_at, a.updated_at, r.work_item_id, r.state AS request_state FROM review_assignments a JOIN review_requests r ON r.id = a.request_id WHERE a.created_at <= ? AND a.key_kind <> 'SHADOW' ORDER BY a.id`,
      at,
    )) {
      const open = live ? a.state === 'ASSIGNED' && ['OPEN', 'CONFLICT', 'ESCALATED'].includes(a.request_state) : a.state === 'ASSIGNED' || a.updated_at > at;
      if (!open) continue;
      const subject = ctx.db.get<{ owner_ref: string }>('SELECT owner_ref FROM work_items WHERE id = ?', a.work_item_id)?.owner_ref ?? '';
      relations.push({ id: `review:${a.id}`, kind: 'REVIEW', from: a.reviewer_employee_id ? `employee:${a.reviewer_employee_id}` : 'founder', to: subject, workItemId: a.work_item_id as Id, state: 'ASSIGNED', since: a.created_at as Timestamp, sourceRef: `review_request:${a.request_id}` });
    }
    for (const ap of ctx.db.all<{ id: string; subject_ref: string; work_item_id: string | null; state: string; created_at: string; risk_level: string }>('SELECT id, subject_ref, work_item_id, state, created_at, risk_level FROM approvals WHERE created_at <= ? ORDER BY id', at)) {
      const state = live ? ap.state : (historyAt(ctx, 'SELECT to_state AS v FROM approval_history WHERE approval_id = ? AND occurred_at <= ? ORDER BY version DESC LIMIT 1', ap.id, at) ?? ap.state);
      if (state !== 'PENDING') continue;
      relations.push({ id: `approval:${ap.id}`, kind: 'APPROVAL', from: ap.subject_ref, to: 'founder', workItemId: ap.work_item_id as Id | null, state: `PENDING_${ap.risk_level}`, since: ap.created_at as Timestamp, sourceRef: `approval:${ap.id}` });
    }
    relations.sort(byId);

    // Goals live at T, anchored to their Department or to the Departments of the work serving them.
    const goals: UniverseGoal[] = [];
    for (const g of ctx.db.all('SELECT * FROM goals WHERE created_at <= ? ORDER BY id', at).map(mapGoal)) {
      const state = live ? g.state : ((historyAt(ctx, 'SELECT to_state AS v FROM goal_history WHERE goal_id = ? AND occurred_at <= ? ORDER BY version DESC LIMIT 1', g.id, at) as GoalState | null) ?? g.state);
      if (!['PROPOSED', 'APPROVED', 'ACTIVE', 'PAUSED'].includes(state)) continue;
      const workItemIds = goalLinks.filter((l) => l.goal_id === g.id).map((l) => l.work_item_id as Id).filter((id) => workById.has(id));
      const anchors = new Set<Id>();
      if (g.departmentId !== null) anchors.add(g.departmentId);
      for (const id of workItemIds) {
        const d = workById.get(id)?.departmentId;
        if (d) anchors.add(d);
      }
      goals.push({ id: g.id, kind: g.kind, title: g.title, state, departmentId: g.departmentId, parentGoalId: g.parentGoalId, ownerRef: g.ownerRef, horizonTo: g.horizonTo, anchorDepartmentIds: [...anchors].sort(), workItemIds });
    }

    const attention: UniverseAttention[] = openAtItems(ctx, at).map((i) => ({ id: i.id, lane: i.lane, level: i.level, sourceKind: i.sourceKind, sourceRef: i.sourceRef, ownerRef: i.ownerRef, firstSeenAt: i.firstSeenAt, lastSignalAt: i.lastSignalAt, signalCount: i.signalCount }));

    const activeSeats = seats.filter((s) => s.status === 'ACTIVE');
    const signals = {
      running: work.filter((w) => w.running).length,
      blocked: work.filter((w) => w.state === 'BLOCKED').length,
      waitingReview: work.filter((w) => w.state === 'WAITING_REVIEW').length,
      waitingApproval: work.filter((w) => w.state === 'WAITING_APPROVAL').length,
      needsFounder: attention.filter((a) => a.lane === 'NEEDS_ME').length,
      vacantSeats: activeSeats.filter((s) => s.holderEmployeeId === null).length,
      actingSeats: activeSeats.filter((s) => s.holderKind === 'ACTING').length,
    };
    return { at, live, founderRef, departments, seats: [...seats].sort(byId), employees: [...employees].sort(byId), work, relations, goals, attention, signals };
  });
}
