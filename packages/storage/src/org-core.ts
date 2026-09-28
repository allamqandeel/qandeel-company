/**
 * Storage-internal C4 organization core (D-C4-02 / D-C4-03). Every helper runs inside a write or read
 * transaction opened by its caller; nothing here opens or awaits one.
 *
 * Canonical organization truth is the effective-dated Position Assignment. The C2 columns
 * `employees.department_id / position_ref / manager_ref / org_scope` are a projection of it, rewritten here
 * in the same transaction as the assignment change and never read by any C4 authority or attribution
 * decision. A title or seat never grants anything.
 */
import { QandeelError, newId, type Id, type Timestamp } from '@qandeel-company/domain';
import { seatHolderAt, type AssignmentView, type PositionKind } from '@qandeel-company/governance';

import type { EmployeeRecord } from './governance-records.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { mapAssignment, mapPosition, type AssignmentRecord, type PositionRecord } from './org-records.js';

export const SYSTEM_ORG_REF = 'system:runtime';

export function getPosition(ctx: StoreContext, id: Id): PositionRecord {
  const r = ctx.db.get('SELECT * FROM org_positions WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'position not found', { positionId: id });
  return mapPosition(r);
}

export function positionByCode(ctx: StoreContext, code: string): PositionRecord | null {
  const r = ctx.db.get('SELECT * FROM org_positions WHERE code = ?', code);
  return r ? mapPosition(r) : null;
}

export function getAssignment(ctx: StoreContext, id: Id): AssignmentRecord {
  const r = ctx.db.get('SELECT * FROM position_assignments WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'assignment not found', { assignmentId: id });
  return mapAssignment(r);
}

const view = (a: AssignmentRecord): AssignmentView => ({ id: a.id, employeeId: a.employeeId, kind: a.kind, effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo });

/** The accountable holder of a seat at T (one deterministic rule; expiry is read from time). */
export function seatHolder(ctx: StoreContext, positionId: Id, at: Timestamp): { holder: AssignmentRecord | null; ofRecord: AssignmentRecord | null } {
  const all = ctx.db.all('SELECT * FROM position_assignments WHERE position_id = ? AND effective_from <= ? ORDER BY effective_from, id', positionId, at).map(mapAssignment);
  const h = seatHolderAt(all.map(view), at);
  const byId = (x: AssignmentView | null): AssignmentRecord | null => (x === null ? null : (all.find((a) => a.id === x.id) ?? null));
  return { holder: byId(h.holder), ofRecord: byId(h.ofRecord) };
}

/** The Employee's PRIMARY assignment effective at T (its one primary seat, Stage 2 §2), if any. */
export function primaryAssignmentAt(ctx: StoreContext, employeeId: Id, at: Timestamp): AssignmentRecord | null {
  const r = ctx.db.get(
    `SELECT * FROM position_assignments WHERE employee_id = ? AND kind = 'PRIMARY' AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?) ORDER BY effective_from DESC, id LIMIT 1`,
    employeeId, at, at,
  );
  return r ? mapAssignment(r) : null;
}

/** The seats the Employee accountably holds at T: its uncovered primary seat and any acting coverage. */
export function heldSeatsAt(ctx: StoreContext, employeeId: Id, at: Timestamp): { position: PositionRecord; assignment: AssignmentRecord }[] {
  const mine = ctx.db
    .all(`SELECT * FROM position_assignments WHERE employee_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?) ORDER BY effective_from, id`, employeeId, at, at)
    .map(mapAssignment);
  const out: { position: PositionRecord; assignment: AssignmentRecord }[] = [];
  for (const a of mine) {
    const holder = seatHolder(ctx, a.positionId, at).holder;
    if (holder?.id === a.id) out.push({ position: getPosition(ctx, a.positionId), assignment: a });
  }
  return out;
}

/**
 * Position eligibility (never authority): whether the Employee accountably holds, at T, a seat of this kind
 * (in this Department, for Department seats). ACTING coverage counts only for the acts its scope lists (an
 * empty scope covers the seat's whole remit); the covered permanent holder does not act meanwhile.
 */
export function holdsSeat(ctx: StoreContext, employeeId: Id, kind: PositionKind, departmentId: Id | null, at: Timestamp, act?: string): PositionRecord | null {
  for (const { position, assignment } of heldSeatsAt(ctx, employeeId, at)) {
    if (position.kind !== kind || position.status === 'RETIRED') continue;
    if (kind !== 'CEO' && position.departmentId !== departmentId) continue;
    if (assignment.kind === 'ACTING' && act !== undefined && assignment.actingScope.length > 0 && !assignment.actingScope.includes(act)) continue;
    return position;
  }
  return null;
}

export function directorSeatOf(ctx: StoreContext, departmentId: Id): PositionRecord | null {
  const r = ctx.db.get(`SELECT * FROM org_positions WHERE kind = 'DIRECTOR' AND department_id = ? AND status <> 'RETIRED'`, departmentId);
  return r ? mapPosition(r) : null;
}

export function ceoSeat(ctx: StoreContext): PositionRecord | null {
  const r = ctx.db.get(`SELECT * FROM org_positions WHERE kind = 'CEO' AND status <> 'RETIRED'`);
  return r ? mapPosition(r) : null;
}

/** The Founder principal's ref (the CEO seat reports to the Founder, a principal and never an Employee). */
export function founderPrincipalRef(ctx: StoreContext): string | null {
  return ctx.db.get<{ ref: string }>(`SELECT ref FROM principals WHERE kind = 'FOUNDER' AND status = 'ACTIVE'`)?.ref ?? null;
}

/** The seat-level manager reference of a Position: `founder:<id>` for the CEO seat, else the reports-to seat. */
export function managerSeatRef(ctx: StoreContext, p: PositionRecord): string {
  if (p.reportsToFounder) return founderPrincipalRef(ctx) ?? 'founder:unregistered';
  if (p.reportsToPositionId === null) throw new QandeelError('STORAGE_INVARIANT', 'a non-CEO seat reports to a seat', { positionId: p.id });
  return `position:${p.reportsToPositionId}`;
}

/** The person accountable above the Employee at T: the holder of its primary seat's reports-to seat, or the Founder. */
export function effectiveManagerRefAt(ctx: StoreContext, e: EmployeeRecord, at: Timestamp): string {
  const a = primaryAssignmentAt(ctx, e.id, at);
  if (!a) return e.managerRef;
  const p = getPosition(ctx, a.positionId);
  if (p.reportsToFounder) return founderPrincipalRef(ctx) ?? 'founder:unregistered';
  const holder = p.reportsToPositionId === null ? null : seatHolder(ctx, p.reportsToPositionId, at).holder;
  return holder ? `employee:${holder.employeeId}` : `position:${String(p.reportsToPositionId)}`;
}

/**
 * Acting coverage auto-expires (Stage 10 §25): an ACTING assignment past its planned end is materialized
 * EXPIRED (history + audit), and authority delegated for that coverage is revoked with it. Reads never
 * depend on this — they evaluate the effective range — so a missed materialization never extends coverage.
 */
export function materializeExpiredActing(ctx: StoreContext): number {
  const at = ts(ctx);
  const expired = ctx.db.all(`SELECT * FROM position_assignments WHERE kind = 'ACTING' AND status = 'ACTIVE' AND planned_to <= ?`, at).map(mapAssignment);
  for (const a of expired) {
    ctx.db.run(`UPDATE position_assignments SET status = 'EXPIRED', end_reason_code = 'ACTING_EXPIRED', version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, at, a.id, a.version);
    assignmentHistory(ctx, a.id, a.version + 1, 'ACTIVE', 'EXPIRED', 'ACTING_EXPIRED', SYSTEM_ORG_REF);
    appendAudit(ctx, 'org.acting_expired', 'assignment', a.id, { actorRef: SYSTEM_ORG_REF }, 'OK', 'ACTING_EXPIRED', { positionId: a.positionId, employeeId: a.employeeId });
    revokeActingDelegations(ctx, a.id, 'ACTING_EXPIRED', SYSTEM_ORG_REF);
  }
  return expired.length;
}

/** Revokes the grants delegated for one acting coverage (in the caller's transaction). */
export function revokeActingDelegations(ctx: StoreContext, assignmentId: Id, reasonCode: string, actorRef: string): void {
  const at = ts(ctx);
  for (const d of ctx.db.all<{ id: string; grant_id: string }>(`SELECT id, grant_id FROM authority_delegations WHERE acting_assignment_id = ? AND status = 'ACTIVE'`, assignmentId)) {
    ctx.db.run(`UPDATE permission_grants SET status = 'REVOKED', revoked_at = ?, revoked_by_ref = ? WHERE id = ? AND status = 'ACTIVE'`, at, actorRef, d.grant_id);
    ctx.db.run(`UPDATE authority_delegations SET status = 'REVOKED', revoked_at = ?, revoked_by_ref = ? WHERE id = ?`, at, actorRef, d.id);
    appendAudit(ctx, 'org.delegation_revoked', 'authority_delegation', d.id, { actorRef }, 'OK', reasonCode, { grantId: d.grant_id });
  }
}

export function assignmentHistory(ctx: StoreContext, assignmentId: Id, version: number, from: string | null, to: string, reasonCode: string, actorRef: string): void {
  ctx.db.run('INSERT INTO position_assignment_history (assignment_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', assignmentId, version, from, to, reasonCode, actorRef, ts(ctx));
}

export function positionHistory(ctx: StoreContext, positionId: Id, version: number, kind: string, from: string | null, to: string | null, reasonCode: string, actorRef: string): void {
  ctx.db.run('INSERT INTO org_position_history (position_id, version, change_kind, from_value, to_value, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', positionId, version, kind, from, to, reasonCode, actorRef, ts(ctx));
}

/**
 * The C2 projection an Employee's CURRENT primary seat implies (department / scope / position / manager
 * seat), or null when it holds no primary seat (legacy or unassigned Employees keep their last values).
 * The caller writes it through the one C2 reassignment path, so the role-change certification rule
 * (D-C3-24, R1-11, P-01) applies to a C4 assignment exactly as it does to a C2 reassignment.
 */
export function projectionFor(ctx: StoreContext, employeeId: Id, at: Timestamp): { departmentId: Id | null; orgScope: 'COMPANY' | 'DEPARTMENT'; positionRef: string; managerRef: string } | null {
  const a = primaryAssignmentAt(ctx, employeeId, at);
  if (!a) return null;
  const p = getPosition(ctx, a.positionId);
  return { departmentId: p.departmentId, orgScope: p.scope, positionRef: `position:${p.id}`, managerRef: managerSeatRef(ctx, p) };
}

/** An Employee with a live PRIMARY assignment is organization-managed: its C2 placement changes only through C4. */
export function isOrgManaged(ctx: StoreContext, employeeId: Id): boolean {
  return ctx.db.get(`SELECT 1 AS x FROM position_assignments WHERE employee_id = ? AND kind = 'PRIMARY' AND status = 'ACTIVE' LIMIT 1`, employeeId) !== undefined;
}

/**
 * The immutable organization snapshot of a governed run (C6 seam, Stage 17): who the Employee was
 * organizationally when the run began. Written once, in the run's binding transaction.
 */
export function snapshotRunOrganization(ctx: StoreContext, runId: Id, e: EmployeeRecord): void {
  if (ctx.db.get('SELECT 1 AS x FROM run_org_snapshots WHERE run_id = ?', runId)) return;
  const at = ts(ctx);
  const seats = heldSeatsAt(ctx, e.id, at);
  const primary = seats.find((s) => s.assignment.kind === 'PRIMARY') ?? null;
  const acting = seats.find((s) => s.assignment.kind === 'ACTING') ?? null;
  const main = primary ?? acting;
  const ceo = ceoSeat(ctx);
  const ceoHolder = ceo ? seatHolder(ctx, ceo.id, at).holder : null;
  let directorEmployee: string | null = null;
  const deptId = main ? main.position.departmentId : e.departmentId;
  if (deptId !== null) {
    const seat = directorSeatOf(ctx, deptId);
    directorEmployee = seat ? (seatHolder(ctx, seat.id, at).holder?.employeeId ?? null) : null;
  }
  const scope = main ? main.position.scope : e.orgScope;
  ctx.db.run(
    `INSERT INTO run_org_snapshots (run_id, employee_id, org_scope, department_id, position_id, assignment_id, assignment_kind, manager_ref, director_employee_id, ceo_employee_id, source, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    runId, e.id, scope, scope === 'COMPANY' ? null : deptId, main?.position.id ?? null, main?.assignment.id ?? null, main?.assignment.kind ?? null,
    effectiveManagerRefAt(ctx, e, at), directorEmployee, ceoHolder?.employeeId ?? null, main ? 'ASSIGNMENT' : 'LEGACY_PROJECTION', at,
  );
}

/** Employees on the delegation chain from a Work Item back to its root: every delegator and delegate. */
export function delegationChain(ctx: StoreContext, workItemId: Id): Id[] {
  const out: Id[] = [];
  let cursor: string | undefined = workItemId;
  for (let hops = 0; cursor !== undefined && hops < 40; hops++) {
    const d: { parent_work_item_id: string; delegator_employee_id: string; delegate_employee_id: string } | undefined = ctx.db.get<{ parent_work_item_id: string; delegator_employee_id: string; delegate_employee_id: string }>(
      'SELECT parent_work_item_id, delegator_employee_id, delegate_employee_id FROM work_delegations WHERE child_work_item_id = ?',
      cursor,
    );
    if (!d) break;
    out.push(d.delegate_employee_id as Id, d.delegator_employee_id as Id);
    cursor = d.parent_work_item_id;
  }
  return [...new Set(out)];
}

/** Delegation depth of a Work Item (number of delegation edges from its root). */
export function delegationDepth(ctx: StoreContext, workItemId: Id): number {
  let depth = 0;
  let cursor: string | undefined = workItemId;
  for (; cursor !== undefined && depth < 40; depth++) {
    cursor = ctx.db.get<{ p: string }>('SELECT parent_work_item_id AS p FROM work_delegations WHERE child_work_item_id = ?', cursor)?.p;
    if (cursor === undefined) break;
  }
  return depth;
}

export function delegationHistory(ctx: StoreContext, delegationId: Id, version: number, from: string | null, to: string, reasonCode: string, actorRef: string): void {
  ctx.db.run('INSERT INTO work_delegation_history (delegation_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', delegationId, version, from, to, reasonCode, actorRef, ts(ctx));
}

/**
 * Starting work on an offered handoff accepts it (Stage 8 §22): the delegate's first governed run of the
 * child Work Item records the acceptance, the accepting run and history, in the run's binding transaction.
 */
export function acceptDelegationOnStart(ctx: StoreContext, runId: Id, workItemId: Id, employeeId: Id): void {
  const d = ctx.db.get<{ id: string; version: number; state: string }>(
    `SELECT id, version, state FROM work_delegations WHERE child_work_item_id = ? AND delegate_employee_id = ? AND state IN ('OFFERED', 'CLARIFICATION_REQUESTED')`,
    workItemId, employeeId,
  );
  if (!d) return;
  const at = ts(ctx);
  ctx.db.run(`UPDATE work_delegations SET state = 'ACCEPTED', accepted_run_id = COALESCE(accepted_run_id, ?), version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, runId, at, d.id, d.version);
  delegationHistory(ctx, d.id as Id, d.version + 1, d.state, 'ACCEPTED', 'WORK_STARTED', `employee:${employeeId}`);
  appendAudit(ctx, 'org.delegation_accepted', 'work_delegation', d.id, { actorRef: `employee:${employeeId}` }, 'OK', 'WORK_STARTED', { workItemId, runId });
}

export function staffingHistory(ctx: StoreContext, requestId: Id, version: number, from: string | null, to: string, reasonCode: string, actorRef: string): void {
  ctx.db.run('INSERT INTO staffing_request_history (request_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', requestId, version, from, to, reasonCode, actorRef, ts(ctx));
}

/** A delegated or engine-created Work Item's budget cap never exceeds the parent's (no budget is created). */
export const newOrgId = (): Id => newId();
