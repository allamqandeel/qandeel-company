/**
 * OrganizationStore — the C4 organization over one CompanyStore (Stage 2, Stage 8, Stage 10; D-C4-02..04).
 *
 * Canonical organization truth is the effective-dated Position Assignment: Founder → CEO seat (company
 * scope, never a Department) → five Director seats → the Department seats below them. Headcount is data:
 * Positions, assignments, acting coverage, charters and hires are records written through these paths,
 * never code. A title or seat grants nothing (Title ≠ Authority): every organizational act of an Employee
 * still needs an explicit grant, and authority is delegated by the Founder only (D-C4-04).
 *
 * Every Founder write here fails closed without the authenticated Founder surface (D-C2-13) and is one
 * short `BEGIN IMMEDIATE` transaction with its history and a content-free audit row. Reads are metadata:
 * staffing evidence, charters and handoff messages are local governed business content that never enters
 * telemetry (Rule A).
 */
import { QandeelError, assertCode, assertId, boundedText, canonicalJson, newId, type Id, type Timestamp } from '@qandeel-company/domain';
import {
  assertActingWindow,
  assertCapability,
  assertDataClass,
  assertPositionCode,
  assertPositionTransition,
  assertRoleRef,
  assertStaffingDecidable,
  isOrgCapability,
  isPositionKind,
  isPositionScope,
  parseDelegationLimits,
  type PositionKind,
  type PositionScope,
  type PositionStatus,
  type ReasoningClass,
} from '@qandeel-company/governance';

import { getEmployeeRow, txFollowPlacementEnvelope, wakeWorkItemJob } from './governance-core.js';
import { mapDepartment, type EmployeeRecord } from './governance-records.js';
import { founder, founderAdminWrite, txCreateEmployee, txReassignEmployee } from './governance.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import {
  assignmentHistory,
  ceoSeat,
  delegationHistory,
  getAssignment,
  getPosition,
  heldSeatsAt,
  managerSeatRef,
  materializeExpiredActing,
  positionHistory,
  primaryAssignmentAt,
  projectionFor,
  revokeActingDelegations,
  seatHolder,
  staffingHistory,
} from './org-core.js';
import {
  mapAssignment,
  mapAuthorityDelegation,
  mapCharter,
  mapPosition,
  mapRunOrgSnapshot,
  mapStaffingRequest,
  mapWorkDelegation,
  type AssignmentRecord,
  type AuthorityDelegationRecord,
  type CharterRecord,
  type PositionRecord,
  type RunOrgSnapshotRecord,
  type StaffingRequestRecord,
  type WorkDelegationRecord,
} from './org-records.js';
import { storeContext, type CompanyStore } from './store.js';

// --- Placement (shared by the Founder store and delegated organizational acts) --------------------------

export interface AssignmentInput {
  readonly positionId: Id;
  readonly employeeId: Id;
  readonly kind: 'PRIMARY' | 'ACTING';
  readonly plannedTo?: Timestamp;
  readonly actingScope?: readonly string[];
  readonly coversEmployeeId?: Id | null;
  readonly reasonCode: string;
  readonly decidedByRef: string;
  readonly authorityRef?: string | null;
}

/** Inserts one assignment (the datastore refuses a second live holder, a retired seat or a retired Employee). */
export function txInsertAssignment(ctx: StoreContext, a: AssignmentInput): AssignmentRecord {
  const id = newId();
  const at = ts(ctx);
  try {
    ctx.db.run(
      `INSERT INTO position_assignments (id, position_id, employee_id, kind, status, effective_from, planned_to, effective_to, acting_scope_json, covers_employee_id, reason_code, end_reason_code, decided_by_ref, authority_ref, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)`,
      id, a.positionId, a.employeeId, a.kind, at, a.plannedTo ?? null, a.plannedTo ?? null, JSON.stringify(a.actingScope ?? []), a.coversEmployeeId ?? null,
      assertCode(a.reasonCode, 'reasonCode'), a.decidedByRef, a.authorityRef ?? null, at, at,
    );
  } catch (error) {
    if (error instanceof QandeelError && error.code === 'STORAGE_INVARIANT') throw new QandeelError('ORG_NOT_ELIGIBLE', 'the seat already has a live holder of this kind, or the seat / Employee cannot be assigned', { reason: 'SEAT_UNAVAILABLE', positionId: a.positionId });
    throw error;
  }
  assignmentHistory(ctx, id as Id, 1, null, 'ACTIVE', a.reasonCode, a.decidedByRef);
  appendAudit(ctx, 'org.assigned', 'assignment', id, { actorRef: a.decidedByRef }, 'OK', a.reasonCode, { positionId: a.positionId, employeeId: a.employeeId, kind: a.kind });
  return getAssignment(ctx, id as Id);
}

/** Ends a live assignment now (its effective range is kept; history is never rewritten). */
export function txEndAssignment(ctx: StoreContext, a: AssignmentRecord, reasonCode: string, actorRef: string): void {
  if (a.status !== 'ACTIVE') throw new QandeelError('INVALID_TRANSITION', 'this assignment has already ended', { assignmentId: a.id });
  const at = ts(ctx);
  const end = a.effectiveTo !== null && a.effectiveTo < at ? a.effectiveTo : at;
  ctx.db.run(`UPDATE position_assignments SET status = 'ENDED', effective_to = ?, end_reason_code = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, end, assertCode(reasonCode, 'reasonCode'), at, a.id, a.version);
  assignmentHistory(ctx, a.id, a.version + 1, 'ACTIVE', 'ENDED', reasonCode, actorRef);
  appendAudit(ctx, 'org.assignment_ended', 'assignment', a.id, { actorRef }, 'OK', reasonCode, { positionId: a.positionId, employeeId: a.employeeId, kind: a.kind });
  if (a.kind === 'ACTING') revokeActingDelegations(ctx, a.id, reasonCode, actorRef);
}

/**
 * Places an Employee in a vacant seat as its PRIMARY holder: a transfer or promotion ends its previous
 * primary seat, the C2 projection is rewritten through the ONE reassignment path (so the role-change
 * certification rule applies, D-C3-24 / P-01) and its budget envelope follows the placement (D-C4-02).
 */
export function txPlaceEmployee(ctx: StoreContext, employeeId: Id, positionId: Id, actorRef: string, reasonCode: string, authorityRef: string | null): { assignment: AssignmentRecord; employee: EmployeeRecord } {
  const p = getPosition(ctx, positionId);
  if (p.status !== 'ACTIVE') throw new QandeelError('ORG_NOT_ELIGIBLE', 'only an ACTIVE seat is filled', { reason: 'SEAT_NOT_ACTIVE', positionId });
  const e = getEmployeeRow(ctx, employeeId);
  if (e.state === 'RETIRED') throw new QandeelError('TERMINAL_STATE', 'a retired employee holds no seat', { employeeId });
  const at = ts(ctx);
  const current = primaryAssignmentAt(ctx, employeeId, at);
  if (current?.positionId === positionId) throw new QandeelError('ORG_NOT_ELIGIBLE', 'the Employee already holds this seat', { reason: 'ALREADY_HOLDS_SEAT', positionId });
  const occupied = ctx.db.get(`SELECT 1 AS x FROM position_assignments WHERE position_id = ? AND kind = 'PRIMARY' AND status = 'ACTIVE'`, positionId);
  if (occupied) throw new QandeelError('ORG_NOT_ELIGIBLE', 'the seat is held; end the current assignment first', { reason: 'SEAT_OCCUPIED', positionId });
  // A holder never covers its own seat, and nobody acts over a seat they now hold permanently.
  for (const acting of ctx.db.all(`SELECT * FROM position_assignments WHERE employee_id = ? AND position_id = ? AND kind = 'ACTING' AND status = 'ACTIVE'`, employeeId, positionId).map(mapAssignment)) {
    txEndAssignment(ctx, acting, 'BECAME_PRIMARY', actorRef);
  }
  if (current) txEndAssignment(ctx, current, 'TRANSFERRED', actorRef);
  const assignment = txInsertAssignment(ctx, { positionId, employeeId, kind: 'PRIMARY', reasonCode, decidedByRef: actorRef, authorityRef });
  // Read as of the new assignment's own start (a clock tick inside this transaction must not hide it).
  const proj = projectionFor(ctx, employeeId, assignment.effectiveFrom);
  if (!proj) throw new QandeelError('STORAGE_INVARIANT', 'a placed Employee has a primary seat', { employeeId });
  const moved = txReassignEmployee(ctx, employeeId, { roleRef: p.roleRef, positionRef: proj.positionRef, departmentId: proj.departmentId, orgScope: proj.orgScope, managerRef: proj.managerRef, reasonCode }, actorRef);
  txFollowPlacementEnvelope(ctx, moved, actorRef, reasonCode);
  return { assignment, employee: getEmployeeRow(ctx, employeeId) };
}

export interface HireInput {
  readonly positionId: string;
  readonly name: { readonly given: string; readonly family: string };
  readonly cognitiveProfile: { readonly defaultClass: ReasoningClass; readonly ceilingClass: ReasoningClass; readonly costDiscipline: 'STRICT' | 'BALANCED' | 'THOROUGH'; readonly selection?: 'AUTO' | 'DEFAULT' };
  readonly profile?: unknown;
}

/**
 * Hires into a vacant seat: a new persistent Employee (CANDIDATE — the Academy still decides activation,
 * nobody becomes ACTIVE here) holding the seat as its PRIMARY assignment. No budget is created: the
 * Founder budgets the new Employee through the ordinary budget engine.
 */
export function txHire(ctx: StoreContext, input: HireInput, actorRef: string, authorityRef: string | null, reasonCode: string): { employee: EmployeeRecord; assignment: AssignmentRecord } {
  const p = getPosition(ctx, assertId(input.positionId, 'positionId'));
  if (p.status !== 'ACTIVE') throw new QandeelError('ORG_NOT_ELIGIBLE', 'only an ACTIVE seat is filled', { reason: 'SEAT_NOT_ACTIVE', positionId: p.id });
  if (ctx.db.get(`SELECT 1 AS x FROM position_assignments WHERE position_id = ? AND kind = 'PRIMARY' AND status = 'ACTIVE'`, p.id)) throw new QandeelError('ORG_NOT_ELIGIBLE', 'the seat is held', { reason: 'SEAT_OCCUPIED', positionId: p.id });
  const employee = txCreateEmployee(ctx, actorRef, {
    name: input.name,
    ...(input.profile !== undefined ? { profile: input.profile } : {}),
    cognitiveProfile: input.cognitiveProfile,
    roleRef: p.roleRef,
    positionRef: `position:${p.id}`,
    departmentId: p.departmentId,
    orgScope: p.scope,
    managerRef: managerSeatRef(ctx, p),
  });
  const assignment = txInsertAssignment(ctx, { positionId: p.id, employeeId: employee.id, kind: 'PRIMARY', reasonCode, decidedByRef: actorRef, authorityRef });
  return { employee, assignment };
}

/** Creates an APPROVED request's seat (reports to the requesting seat; its role and kind come from the request). */
export function txSeatForRequest(ctx: StoreContext, r: StaffingRequestRecord, code: string | null, title: string | null, actorRef: string): PositionRecord {
  const requester = getPosition(ctx, r.requestedByPositionId);
  const id = newId();
  const at = ts(ctx);
  const seatCode = code === null ? `staffed.${id.slice(0, 8)}` : assertPositionCode(code);
  ctx.db.run(
    `INSERT INTO org_positions (id, code, title, scope, department_id, kind, role_ref, reports_to_position_id, reports_to_founder, accountability_json, status, source, staffing_request_id, version, created_by_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', 'ACTIVE', 'STAFFING_REQUEST', ?, 1, ?, ?, ?)`,
    id, seatCode, title === null ? r.positionTitle : boundedText(title, 'positionTitle', 120), r.scope, r.departmentId, r.positionKind, r.roleRef, requester.id, r.id, actorRef, at, at,
  );
  positionHistory(ctx, id as Id, 1, 'CREATED', null, 'ACTIVE', 'staffing.approved', actorRef);
  appendAudit(ctx, 'org.position_created', 'position', id, { actorRef }, 'OK', 'staffing.approved', { kind: r.positionKind, departmentId: r.departmentId, staffingRequestId: r.id });
  return getPosition(ctx, id as Id);
}

export function getStaffingRequest(ctx: StoreContext, id: Id): StaffingRequestRecord {
  const r = ctx.db.get('SELECT * FROM staffing_requests WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'staffing request not found', { staffingRequestId: id });
  return mapStaffingRequest(r);
}

/** Decides an open staffing request (Founder, or the CEO inside an explicit delegation). */
export function txDecideStaffing(ctx: StoreContext, r: StaffingRequestRecord, decision: 'APPROVE' | 'REJECT', opts: { positionCode: string | null; positionTitle: string | null }, actorRef: string, authorityRef: string | null, reasonCode: string): StaffingRequestRecord {
  assertStaffingDecidable(r.state);
  const at = ts(ctx);
  const seat = decision === 'APPROVE' ? txSeatForRequest(ctx, r, opts.positionCode, opts.positionTitle, actorRef) : null;
  const to = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  ctx.db.run(
    `UPDATE staffing_requests SET state = ?, decided_by_ref = ?, decision_authority_ref = ?, approved_position_id = ?, decided_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
    to, actorRef, authorityRef, seat?.id ?? null, at, at, r.id, r.version,
  );
  staffingHistory(ctx, r.id, r.version + 1, r.state, to, assertCode(reasonCode, 'reasonCode'), actorRef);
  appendAudit(ctx, 'org.staffing_decided', 'staffing_request', r.id, { actorRef }, 'OK', to, { positionId: seat?.id ?? null, delegated: authorityRef !== null });
  return getStaffingRequest(ctx, r.id);
}

/** Records the hire of an APPROVED request into its seat, once. */
export function txHireForRequest(ctx: StoreContext, r: StaffingRequestRecord, input: Omit<HireInput, 'positionId'>, actorRef: string, authorityRef: string | null, reasonCode: string): { employee: EmployeeRecord; request: StaffingRequestRecord } {
  if (r.state !== 'APPROVED' || r.approvedPositionId === null) throw new QandeelError('INVALID_TRANSITION', 'only an APPROVED staffing request is hired against', { staffingRequestId: r.id });
  if (r.hiredEmployeeId !== null) throw new QandeelError('INVALID_TRANSITION', 'this staffing request was already hired against', { staffingRequestId: r.id });
  const { employee } = txHire(ctx, { ...input, positionId: r.approvedPositionId }, actorRef, authorityRef, reasonCode);
  ctx.db.run('UPDATE staffing_requests SET hired_employee_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', employee.id, ts(ctx), r.id, r.version);
  staffingHistory(ctx, r.id, r.version + 1, 'APPROVED', 'APPROVED', 'staffing.hired', actorRef);
  appendAudit(ctx, 'org.staffing_hired', 'staffing_request', r.id, { actorRef }, 'OK', reasonCode, { employeeId: employee.id, positionId: r.approvedPositionId });
  return { employee, request: getStaffingRequest(ctx, r.id) };
}

// --- The store ------------------------------------------------------------------------------------------

export interface CreatePositionInput {
  readonly code: string;
  readonly title: string;
  readonly scope: PositionScope;
  readonly departmentId?: string | null;
  readonly kind: PositionKind;
  readonly roleRef: string;
  readonly reportsToPositionId: string;
  readonly accountability?: readonly string[];
  readonly status?: 'PROPOSED' | 'ACTIVE';
  readonly reasonCode: string;
}

export interface DelegateAuthorityInput {
  readonly employeeId: string;
  readonly capability: string;
  readonly resourceScope?: string;
  readonly dataClassCeiling?: string;
  readonly expiresAt: string;
  readonly maxUses?: number;
  readonly purposeCode: string;
  readonly limits?: unknown;
  readonly actingAssignmentId?: string;
  readonly reasonCode: string;
}

export interface CharterInput {
  readonly mission: string;
  readonly outcomes: readonly string[];
  readonly scope: readonly string[];
  readonly boundaries: readonly string[];
  readonly recurringResponsibilities: readonly string[];
  readonly dependencies: readonly string[];
  readonly measures: readonly string[];
  readonly risks: readonly string[];
  readonly budgetEnvelopeId?: string | null;
  readonly reasonCode: string;
}

export interface EmployeeOrganization {
  readonly employeeId: Id;
  readonly at: Timestamp;
  readonly primary: { readonly position: PositionRecord; readonly assignment: AssignmentRecord } | null;
  readonly heldSeats: readonly { readonly positionId: Id; readonly kind: PositionKind; readonly assignmentKind: 'PRIMARY' | 'ACTING' }[];
  readonly departmentId: Id | null;
  readonly orgScope: PositionScope;
  readonly managerRef: string;
}

export interface OrganizationHealth {
  readonly positions: Record<string, number>;
  readonly vacantActiveSeats: number;
  readonly vacantDirectorSeats: number;
  readonly ceoSeatVacant: boolean;
  readonly actingAssignments: number;
  readonly actingPastEnd: number;
  readonly staffingAwaitingCeo: number;
  readonly staffingAwaitingFounder: number;
  readonly openDelegations: number;
  readonly escalatedHandoffs: number;
  readonly activeAuthorityDelegations: number;
  readonly legacyUnplacedEmployees: number;
}

const list = (v: readonly string[] | undefined, field: string, max = 32): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) throw new QandeelError('VALIDATION_FAILED', `${field} is a list of at most ${max} entries`, { field });
  return v.map((x, i) => boundedText(x, `${field}[${i}]`, 400));
};

export class OrganizationStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): OrganizationStore {
    return new OrganizationStore(store);
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  #admin<T>(operation: string, actorRef: string, fn: (ctx: StoreContext) => T): T {
    return founderAdminWrite(this.#store, operation, actorRef, fn);
  }

  // --- Positions (seats, not people) ---------------------------------------------------------------------

  /** A new seat (Founder). The CEO and Director seats are release-seeded; this adds seats beneath them. */
  createPosition(actorRef: string, input: CreatePositionInput): PositionRecord {
    return this.#admin('create position', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'organization position');
      if (!isPositionKind(input.kind) || input.kind === 'CEO') throw new QandeelError('VALIDATION_FAILED', 'a created seat is a DIRECTOR, MANAGER, LEAD or SPECIALIST (the CEO seat is canonical)', { field: 'kind' });
      if (!isPositionScope(input.scope)) throw new QandeelError('VALIDATION_FAILED', 'scope is COMPANY or DEPARTMENT', { field: 'scope' });
      const dept = input.scope === 'DEPARTMENT' ? assertId(input.departmentId, 'departmentId') : null;
      if (input.scope === 'COMPANY' && input.departmentId !== undefined && input.departmentId !== null) throw new QandeelError('VALIDATION_FAILED', 'a company-scoped seat has no Department', { field: 'departmentId' });
      if (dept !== null && !ctx.db.get(`SELECT 1 AS x FROM departments WHERE id = ? AND status = 'ACTIVE'`, dept)) throw new QandeelError('NOT_FOUND', 'department not found', { departmentId: dept });
      const parent = getPosition(ctx, assertId(input.reportsToPositionId, 'reportsToPositionId'));
      if (parent.status === 'RETIRED') throw new QandeelError('ORG_NOT_ELIGIBLE', 'a seat reports to a live seat', { reason: 'PARENT_RETIRED' });
      // Founder → CEO → Directors: a Director seat reports to the CEO seat; a Department seat stays inside its Department.
      if (input.kind === 'DIRECTOR' && parent.kind !== 'CEO') throw new QandeelError('VALIDATION_FAILED', 'a Director seat reports to the CEO seat', { field: 'reportsToPositionId' });
      if (input.kind !== 'DIRECTOR' && dept !== null && parent.departmentId !== dept) throw new QandeelError('VALIDATION_FAILED', 'a Department seat reports to a seat of the same Department', { field: 'reportsToPositionId' });
      if (input.scope === 'COMPANY' && parent.kind !== 'CEO' && parent.scope !== 'COMPANY') throw new QandeelError('VALIDATION_FAILED', 'a company-scoped seat reports inside the executive line', { field: 'reportsToPositionId' });
      const status = input.status ?? 'ACTIVE';
      if (status !== 'ACTIVE' && status !== 'PROPOSED') throw new QandeelError('VALIDATION_FAILED', 'a new seat is PROPOSED or ACTIVE', { field: 'status' });
      const id = newId();
      const at = ts(ctx);
      try {
        ctx.db.run(
          `INSERT INTO org_positions (id, code, title, scope, department_id, kind, role_ref, reports_to_position_id, reports_to_founder, accountability_json, status, source, staffing_request_id, version, created_by_ref, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'FOUNDER', NULL, 1, ?, ?, ?)`,
          id, assertPositionCode(input.code), boundedText(input.title, 'title', 120), input.scope, dept, input.kind, assertRoleRef(input.roleRef), parent.id, JSON.stringify(list(input.accountability, 'accountability', 16)), status, p.ref, at, at,
        );
      } catch (error) {
        if (error instanceof QandeelError && error.code === 'STORAGE_INVARIANT') throw new QandeelError('VALIDATION_FAILED', 'the code is taken, or this Department already has a live Director seat', { field: 'code' });
        throw error;
      }
      positionHistory(ctx, id as Id, 1, 'CREATED', null, status, assertCode(input.reasonCode, 'reasonCode'), p.ref);
      appendAudit(ctx, 'org.position_created', 'position', id, { actorRef: p.ref }, 'OK', input.reasonCode, { kind: input.kind, departmentId: dept });
      return getPosition(ctx, id as Id);
    });
  }

  /** PROPOSED → ACTIVE → PAUSED ↔ ACTIVE → RETIRED. A held seat is vacated before it retires. */
  setPositionStatus(actorRef: string, positionId: string, to: PositionStatus, reasonCode: string): PositionRecord {
    return this.#admin('set position status', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'organization position');
      const pos = getPosition(ctx, assertId(positionId, 'positionId'));
      assertPositionTransition(pos.status, to);
      if (pos.kind === 'CEO' && to === 'RETIRED') throw new QandeelError('ORG_NOT_ELIGIBLE', 'the CEO seat is permanent', { reason: 'CANONICAL_SEAT' });
      if (to === 'RETIRED') {
        if (ctx.db.get(`SELECT 1 AS x FROM position_assignments WHERE position_id = ? AND status = 'ACTIVE'`, pos.id)) throw new QandeelError('ORG_NOT_ELIGIBLE', 'end the seat\'s assignments before retiring it', { reason: 'SEAT_HELD' });
        if (ctx.db.get(`SELECT 1 AS x FROM org_positions WHERE reports_to_position_id = ? AND status <> 'RETIRED'`, pos.id)) throw new QandeelError('ORG_NOT_ELIGIBLE', 'seats still report to this seat', { reason: 'SEAT_HAS_REPORTS' });
      }
      ctx.db.run('UPDATE org_positions SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', to, ts(ctx), pos.id, pos.version);
      positionHistory(ctx, pos.id, pos.version + 1, 'STATUS', pos.status, to, assertCode(reasonCode, 'reasonCode'), p.ref);
      appendAudit(ctx, 'org.position_status', 'position', pos.id, { actorRef: p.ref }, 'OK', reasonCode, { from: pos.status, to });
      return getPosition(ctx, pos.id);
    });
  }

  /** Fills a vacant seat with an existing Employee (placement, transfer or promotion; the Founder decides). */
  assignPrimary(actorRef: string, input: { positionId: string; employeeId: string; reasonCode: string }): AssignmentRecord {
    return this.#admin('assign position', actorRef, (ctx) => {
      const employeeId = assertId(input.employeeId, 'employeeId');
      const p = founder(ctx, actorRef, `employee:${employeeId}`, 'position assignment');
      return txPlaceEmployee(ctx, employeeId, assertId(input.positionId, 'positionId'), p.ref, assertCode(input.reasonCode, 'reasonCode'), null).assignment;
    });
  }

  /** Ends a live assignment (the seat becomes vacant; acting coverage and its delegated grants end with it). */
  endAssignment(actorRef: string, assignmentId: string, reasonCode: string): AssignmentRecord {
    return this.#admin('end assignment', actorRef, (ctx) => {
      const a = getAssignment(ctx, assertId(assignmentId, 'assignmentId'));
      const p = founder(ctx, actorRef, `employee:${a.employeeId}`, 'position assignment');
      txEndAssignment(ctx, a, reasonCode, p.ref);
      return getAssignment(ctx, a.id);
    });
  }

  /**
   * Explicit, time-bounded acting coverage of a seat (Stage 10 §25): it copies no identity, memory or
   * authority. Authority the acting holder needs is delegated separately and ends with the coverage.
   */
  assignActing(actorRef: string, input: { positionId: string; employeeId: string; until: string; scope?: readonly string[]; reasonCode: string }): AssignmentRecord {
    return this.#admin('assign acting', actorRef, (ctx) => {
      const employeeId = assertId(input.employeeId, 'employeeId');
      const p = founder(ctx, actorRef, `employee:${employeeId}`, 'acting assignment');
      materializeExpiredActing(ctx);
      const pos = getPosition(ctx, assertId(input.positionId, 'positionId'));
      if (pos.status !== 'ACTIVE') throw new QandeelError('ORG_NOT_ELIGIBLE', 'only an ACTIVE seat is covered', { reason: 'SEAT_NOT_ACTIVE' });
      const e = getEmployeeRow(ctx, employeeId);
      if (e.state !== 'ACTIVE') throw new QandeelError('ORG_NOT_ELIGIBLE', 'acting coverage is held by an ACTIVE Employee', { reason: 'EMPLOYEE_NOT_ACTIVE', state: e.state });
      const now = ts(ctx);
      if (typeof input.until !== 'string') throw new QandeelError('VALIDATION_FAILED', 'until is a canonical UTC timestamp', { field: 'until' });
      assertActingWindow(now, input.until as Timestamp);
      const holder = seatHolder(ctx, pos.id, now).ofRecord;
      if (holder?.employeeId === employeeId) throw new QandeelError('ORG_NOT_ELIGIBLE', 'the permanent holder does not cover its own seat', { reason: 'ALREADY_HOLDS_SEAT' });
      const scope = list(input.scope, 'scope', 16).map((x) => assertCode(x, 'scope'));
      return txInsertAssignment(ctx, { positionId: pos.id, employeeId, kind: 'ACTING', plannedTo: input.until as Timestamp, actingScope: scope, coversEmployeeId: holder?.employeeId ?? null, reasonCode: input.reasonCode, decidedByRef: p.ref });
    });
  }

  /** Hires a new CANDIDATE Employee into a vacant seat — against an APPROVED staffing request when one is given. */
  hire(actorRef: string, input: HireInput & { staffingRequestId?: string; reasonCode: string }): EmployeeRecord {
    return this.#admin('hire', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'hiring');
      if (input.staffingRequestId !== undefined) {
        const r = getStaffingRequest(ctx, assertId(input.staffingRequestId, 'staffingRequestId'));
        if (r.approvedPositionId !== input.positionId) throw new QandeelError('VALIDATION_FAILED', 'the hire fills the seat its request approved', { field: 'positionId' });
        return txHireForRequest(ctx, r, input, p.ref, null, input.reasonCode).employee;
      }
      return txHire(ctx, input, p.ref, null, assertCode(input.reasonCode, 'reasonCode')).employee;
    });
  }

  /** The Founder decides a staffing request (APPROVE creates its seat; nobody is hired or activated by it). */
  decideStaffingRequest(actorRef: string, requestId: string, input: { decision: 'APPROVE' | 'REJECT'; positionCode?: string; positionTitle?: string; reasonCode: string }): StaffingRequestRecord {
    return this.#admin('decide staffing request', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'staffing decision');
      if (input.decision !== 'APPROVE' && input.decision !== 'REJECT') throw new QandeelError('VALIDATION_FAILED', 'decision is APPROVE or REJECT', { field: 'decision' });
      const r = getStaffingRequest(ctx, assertId(requestId, 'requestId'));
      return txDecideStaffing(ctx, r, input.decision, { positionCode: input.positionCode ?? null, positionTitle: input.positionTitle ?? null }, p.ref, null, input.reasonCode);
    });
  }

  /**
   * Founder → Employee authority delegation (Stage 3 §3, D-R1-04): an explicit, expiring, revocable grant of
   * one organizational capability plus its policy limits. Only the Founder delegates authority (an Employee
   * never can, so nobody self-escalates); R2 / R4 and approval authority are never delegable.
   */
  delegateAuthority(actorRef: string, input: DelegateAuthorityInput): AuthorityDelegationRecord {
    return this.#admin('delegate authority', actorRef, (ctx) => {
      const employeeId = assertId(input.employeeId, 'employeeId');
      const p = founder(ctx, actorRef, `employee:${employeeId}`, 'authority delegation');
      const capability = assertCapability(input.capability);
      if (!isOrgCapability(capability)) throw new QandeelError('VALIDATION_FAILED', 'only organizational capabilities are delegated here (tool grants stay C2 grants)', { field: 'capability' });
      const e = getEmployeeRow(ctx, employeeId);
      if (e.state === 'RETIRED') throw new QandeelError('TERMINAL_STATE', 'a retired employee receives no authority', { employeeId });
      if (typeof input.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expiresAt) || input.expiresAt <= ts(ctx)) throw new QandeelError('VALIDATION_FAILED', 'a delegation expires in the future', { field: 'expiresAt' });
      const limits = parseDelegationLimits(input.limits);
      let acting: AssignmentRecord | null = null;
      if (input.actingAssignmentId !== undefined) {
        acting = getAssignment(ctx, assertId(input.actingAssignmentId, 'actingAssignmentId'));
        if (acting.kind !== 'ACTING' || acting.status !== 'ACTIVE' || acting.employeeId !== employeeId) throw new QandeelError('VALIDATION_FAILED', 'the acting assignment is this Employee\'s live coverage', { field: 'actingAssignmentId' });
        if (acting.effectiveTo !== null && input.expiresAt > acting.effectiveTo) throw new QandeelError('VALIDATION_FAILED', 'authority delegated for acting coverage ends with it', { field: 'expiresAt' });
      }
      const scope = input.resourceScope ?? '*';
      if (input.maxUses !== undefined && !(Number.isSafeInteger(input.maxUses) && input.maxUses >= 1 && input.maxUses <= 1_000_000)) throw new QandeelError('VALIDATION_FAILED', 'maxUses must be 1..1000000', { field: 'maxUses' });
      const grantId = newId();
      const at = ts(ctx);
      ctx.db.run(
        `INSERT INTO permission_grants (id, employee_id, capability, resource_scope, risk_ceiling, data_class_ceiling, expires_at, max_uses, uses, status, granted_by_ref, reason_code, created_at)
         VALUES (?, ?, ?, ?, 'R1', ?, ?, ?, 0, 'ACTIVE', ?, ?, ?)`,
        grantId, employeeId, capability, scope, assertDataClass(input.dataClassCeiling ?? 'D1', 'dataClassCeiling'), input.expiresAt, input.maxUses ?? null, p.ref, assertCode(input.reasonCode, 'reasonCode'), at,
      );
      const id = newId();
      ctx.db.run(
        `INSERT INTO authority_delegations (id, grant_id, delegator_ref, delegate_employee_id, purpose_code, limits_json, acting_assignment_id, status, reason_code, revoked_by_ref, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, NULL, ?)`,
        id, grantId, p.ref, employeeId, assertCode(input.purposeCode, 'purposeCode'), canonicalJson(limits as unknown as Record<string, unknown>), acting?.id ?? null, input.reasonCode, at,
      );
      appendAudit(ctx, 'org.authority_delegated', 'authority_delegation', id, { actorRef: p.ref }, 'OK', input.reasonCode, { employeeId, capability, grantId });
      return mapAuthorityDelegation(ctx.db.get('SELECT * FROM authority_delegations WHERE id = ?', id) ?? {});
    });
  }

  revokeDelegation(actorRef: string, delegationId: string, reasonCode: string): AuthorityDelegationRecord {
    return this.#admin('revoke delegation', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'authority delegation');
      const d = mapAuthorityDelegation(ctx.db.get('SELECT * FROM authority_delegations WHERE id = ?', assertId(delegationId, 'delegationId')) ?? notFound('authority delegation', delegationId));
      if (d.status !== 'ACTIVE') throw new QandeelError('INVALID_TRANSITION', 'this delegation was already revoked', { delegationId: d.id });
      const at = ts(ctx);
      ctx.db.run(`UPDATE permission_grants SET status = 'REVOKED', revoked_at = ?, revoked_by_ref = ? WHERE id = ? AND status = 'ACTIVE'`, at, p.ref, d.grantId);
      ctx.db.run(`UPDATE authority_delegations SET status = 'REVOKED', revoked_at = ?, revoked_by_ref = ? WHERE id = ?`, at, p.ref, d.id);
      appendAudit(ctx, 'org.delegation_revoked', 'authority_delegation', d.id, { actorRef: p.ref }, 'OK', assertCode(reasonCode, 'reasonCode'), { grantId: d.grantId });
      return mapAuthorityDelegation(ctx.db.get('SELECT * FROM authority_delegations WHERE id = ?', d.id) ?? {});
    });
  }

  /** A new charter version for a Department (Founder): the previous version is superseded, never edited. */
  publishCharter(actorRef: string, departmentId: string, input: CharterInput): CharterRecord {
    return this.#admin('publish charter', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'department charter');
      const dept = assertId(departmentId, 'departmentId');
      const current = ctx.db.get(`SELECT * FROM department_charters WHERE department_id = ? AND status IN ('BASELINE', 'ACTIVE')`, dept);
      if (!current) throw new QandeelError('NOT_FOUND', 'the Department has no charter to supersede', { departmentId: dept });
      const cur = mapCharter(current);
      let envelope: string | null = cur.budgetEnvelopeId;
      if (input.budgetEnvelopeId !== undefined) {
        envelope = input.budgetEnvelopeId === null ? null : assertId(input.budgetEnvelopeId, 'budgetEnvelopeId');
        if (envelope !== null && !ctx.db.get(`SELECT 1 AS x FROM budgets WHERE id = ? AND scope = 'DEPARTMENT' AND scope_id = ?`, envelope, dept)) throw new QandeelError('VALIDATION_FAILED', 'the charter\'s budget envelope is this Department\'s budget', { field: 'budgetEnvelopeId' });
      }
      const at = ts(ctx);
      ctx.db.run(`UPDATE department_charters SET status = 'SUPERSEDED', effective_to = ? WHERE id = ?`, at, cur.id);
      const id = newId();
      const j = (v: readonly string[], f: string): string => JSON.stringify(list(v, f));
      ctx.db.run(
        `INSERT INTO department_charters (id, department_id, version, status, mission, outcomes_json, scope_json, boundaries_json, director_position_id, seats_json, recurring_responsibilities_json, dependencies_json, budget_envelope_id, measures_json, risks_json, source, effective_from, effective_to, created_by_ref, created_at)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FOUNDER', ?, NULL, ?, ?)`,
        id, dept, cur.version + 1, boundedText(input.mission, 'mission', 2000), j(input.outcomes, 'outcomes'), j(input.scope, 'scope'), j(input.boundaries, 'boundaries'), cur.directorPositionId,
        JSON.stringify(cur.seats), j(input.recurringResponsibilities, 'recurringResponsibilities'), j(input.dependencies, 'dependencies'), envelope, j(input.measures, 'measures'), j(input.risks, 'risks'), at, p.ref, at,
      );
      appendAudit(ctx, 'org.charter_published', 'department_charter', id, { actorRef: p.ref }, 'OK', assertCode(input.reasonCode, 'reasonCode'), { departmentId: dept, version: cur.version + 1 });
      return mapCharter(ctx.db.get('SELECT * FROM department_charters WHERE id = ?', id) ?? {});
    });
  }

  /**
   * Resolves an escalated handoff (Founder): the handoff resumes with its delegate and both parked jobs are
   * woken. To stop the work instead, the Founder cancels the child Work Item (the delegation follows it).
   */
  resumeEscalatedHandoff(actorRef: string, delegationId: string, reasonCode: string): WorkDelegationRecord {
    return this.#admin('resume handoff', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'handoff escalation');
      const d = mapWorkDelegation(ctx.db.get('SELECT * FROM work_delegations WHERE id = ?', assertId(delegationId, 'delegationId')) ?? notFound('work delegation', delegationId));
      if (d.state !== 'ESCALATED') throw new QandeelError('INVALID_TRANSITION', 'only an escalated handoff is resumed', { delegationId: d.id, state: d.state });
      const to = d.acceptedRunId === null ? 'OFFERED' : 'ACCEPTED';
      ctx.db.run('UPDATE work_delegations SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', to, ts(ctx), d.id, d.version);
      delegationHistory(ctx, d.id, d.version + 1, 'ESCALATED', to, assertCode(reasonCode, 'reasonCode'), p.ref);
      appendAudit(ctx, 'org.handoff_resumed', 'work_delegation', d.id, { actorRef: p.ref }, 'OK', reasonCode, { childWorkItemId: d.childWorkItemId });
      wakeWorkItemJob(ctx, d.childWorkItemId, ['AWAITING_ESCALATION', 'AWAITING_CLARIFICATION'], 'handoff.resumed');
      wakeWorkItemJob(ctx, d.parentWorkItemId, ['AWAITING_DELEGATION', 'AWAITING_ESCALATION'], 'handoff.resumed');
      return mapWorkDelegation(ctx.db.get('SELECT * FROM work_delegations WHERE id = ?', d.id) ?? {});
    });
  }

  // --- Reads -------------------------------------------------------------------------------------------

  position(id: Id): PositionRecord {
    return this.#read((ctx) => getPosition(ctx, id));
  }

  positionByCode(code: string): PositionRecord | null {
    return this.#read((ctx) => {
      const r = ctx.db.get('SELECT * FROM org_positions WHERE code = ?', code);
      return r ? mapPosition(r) : null;
    });
  }

  positions(filter: { departmentId?: Id | null; status?: PositionStatus } = {}): PositionRecord[] {
    return this.#read((ctx) =>
      ctx.db
        .all('SELECT * FROM org_positions ORDER BY kind, code')
        .map(mapPosition)
        .filter((p) => (filter.departmentId === undefined || p.departmentId === filter.departmentId) && (filter.status === undefined || p.status === filter.status)),
    );
  }

  /** The accountable holder of a seat at T (default: now) — a valid ACTING coverage, else the PRIMARY holder. */
  seatHolder(positionId: Id, at?: Timestamp): { holder: AssignmentRecord | null; ofRecord: AssignmentRecord | null } {
    return this.#read((ctx) => seatHolder(ctx, positionId, at ?? ts(ctx)));
  }

  /** Where an Employee stood in the organization at T (time-correct; assignments are canonical). */
  employeeOrgAt(employeeId: Id, at?: Timestamp): EmployeeOrganization {
    return this.#read((ctx) => {
      const when = at ?? ts(ctx);
      const e = getEmployeeRow(ctx, employeeId);
      const primary = primaryAssignmentAt(ctx, employeeId, when);
      const proj = projectionFor(ctx, employeeId, when);
      return {
        employeeId,
        at: when,
        primary: primary ? { position: getPosition(ctx, primary.positionId), assignment: primary } : null,
        heldSeats: heldSeatsAt(ctx, employeeId, when).map((s) => ({ positionId: s.position.id, kind: s.position.kind, assignmentKind: s.assignment.kind })),
        departmentId: proj ? proj.departmentId : e.departmentId,
        orgScope: proj ? proj.orgScope : e.orgScope,
        managerRef: proj ? proj.managerRef : e.managerRef,
      };
    });
  }

  assignmentsOfPosition(positionId: Id): AssignmentRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM position_assignments WHERE position_id = ? ORDER BY effective_from, id', positionId).map(mapAssignment));
  }

  assignmentsOfEmployee(employeeId: Id): AssignmentRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM position_assignments WHERE employee_id = ? ORDER BY effective_from, id', employeeId).map(mapAssignment));
  }

  assignmentHistory(assignmentId: Id): { version: number; fromStatus: string | null; toStatus: string; reasonCode: string; actorRef: string; occurredAt: string }[] {
    return this.#read((ctx) =>
      ctx.db
        .all<{ version: number; from_status: string | null; to_status: string; reason_code: string; actor_ref: string; occurred_at: string }>('SELECT * FROM position_assignment_history WHERE assignment_id = ? ORDER BY version', assignmentId)
        .map((r) => ({ version: Number(r.version), fromStatus: r.from_status, toStatus: r.to_status, reasonCode: r.reason_code, actorRef: r.actor_ref, occurredAt: r.occurred_at })),
    );
  }

  charter(departmentId: Id): CharterRecord | null {
    return this.#read((ctx) => {
      const r = ctx.db.get(`SELECT * FROM department_charters WHERE department_id = ? AND status IN ('BASELINE', 'ACTIVE')`, departmentId);
      return r ? mapCharter(r) : null;
    });
  }

  charterHistory(departmentId: Id): CharterRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM department_charters WHERE department_id = ? ORDER BY version', departmentId).map(mapCharter));
  }

  staffingRequests(state?: StaffingRequestRecord['state']): StaffingRequestRecord[] {
    return this.#read((ctx) => (state ? ctx.db.all('SELECT * FROM staffing_requests WHERE state = ? ORDER BY created_at, id', state) : ctx.db.all('SELECT * FROM staffing_requests ORDER BY created_at, id')).map(mapStaffingRequest));
  }

  staffingRequest(id: Id): StaffingRequestRecord {
    return this.#read((ctx) => getStaffingRequest(ctx, id));
  }

  /** The request's business evidence (local governed content for the deciding Founder; never telemetry). */
  staffingEvidence(id: Id): { businessNeed: string; workloadEvidence: string; skillGap: string; expectedValue: string; impactIfNotStaffed: string; alternatives: Record<string, string>; ceoNote: string | null } {
    return this.#read((ctx) => {
      const r = ctx.db.get<{ business_need: string; workload_evidence: string; skill_gap: string; expected_value: string; impact_if_not_staffed: string; alternatives_json: string; ceo_note: string | null }>(
        'SELECT business_need, workload_evidence, skill_gap, expected_value, impact_if_not_staffed, alternatives_json, ceo_note FROM staffing_requests WHERE id = ?',
        id,
      );
      if (!r) throw new QandeelError('NOT_FOUND', 'staffing request not found', { staffingRequestId: id });
      return { businessNeed: r.business_need, workloadEvidence: r.workload_evidence, skillGap: r.skill_gap, expectedValue: r.expected_value, impactIfNotStaffed: r.impact_if_not_staffed, alternatives: JSON.parse(r.alternatives_json) as Record<string, string>, ceoNote: r.ceo_note };
    });
  }

  authorityDelegations(employeeId?: Id): AuthorityDelegationRecord[] {
    return this.#read((ctx) => (employeeId ? ctx.db.all('SELECT * FROM authority_delegations WHERE delegate_employee_id = ? ORDER BY created_at, id', employeeId) : ctx.db.all('SELECT * FROM authority_delegations ORDER BY created_at, id')).map(mapAuthorityDelegation));
  }

  workDelegations(filter: { parentWorkItemId?: Id; childWorkItemId?: Id; state?: WorkDelegationRecord['state'] } = {}): WorkDelegationRecord[] {
    return this.#read((ctx) =>
      ctx.db
        .all('SELECT * FROM work_delegations ORDER BY created_at, id')
        .map(mapWorkDelegation)
        .filter((d) => (filter.parentWorkItemId === undefined || d.parentWorkItemId === filter.parentWorkItemId) && (filter.childWorkItemId === undefined || d.childWorkItemId === filter.childWorkItemId) && (filter.state === undefined || d.state === filter.state)),
    );
  }

  delegationHistory(delegationId: Id): { version: number; fromState: string | null; toState: string; reasonCode: string; actorRef: string }[] {
    return this.#read((ctx) =>
      ctx.db
        .all<{ version: number; from_state: string | null; to_state: string; reason_code: string; actor_ref: string }>('SELECT * FROM work_delegation_history WHERE delegation_id = ? ORDER BY version', delegationId)
        .map((r) => ({ version: Number(r.version), fromState: r.from_state, toState: r.to_state, reasonCode: r.reason_code, actorRef: r.actor_ref })),
    );
  }

  /** The handoff messages of one delegation (local governed content for its two parties and the Founder). */
  handoffMessages(delegationId: Id): { id: Id; kind: string; authorEmployeeId: Id; body: string; createdAt: string }[] {
    return this.#read((ctx) =>
      ctx.db
        .all<{ id: string; kind: string; author_employee_id: string; body: string; created_at: string }>('SELECT id, kind, author_employee_id, body, created_at FROM handoff_messages WHERE delegation_id = ? ORDER BY created_at, id', delegationId)
        .map((r) => ({ id: r.id as Id, kind: r.kind, authorEmployeeId: r.author_employee_id as Id, body: r.body, createdAt: r.created_at })),
    );
  }

  /** The immutable organization snapshot of a governed run (time-correct attribution, C6 seam). */
  runOrgSnapshot(runId: Id): RunOrgSnapshotRecord | null {
    return this.#read((ctx) => {
      const r = ctx.db.get('SELECT * FROM run_org_snapshots WHERE run_id = ?', runId);
      return r ? mapRunOrgSnapshot(r) : null;
    });
  }

  /** Work waiting on an executive decision (the CEO's synthesis queue and the Founder's decision queue): IDs and codes only. */
  executiveQueues(): { ceo: { staffingRequestIds: Id[]; escalatedHandoffIds: Id[] }; founder: { staffingRequestIds: Id[]; escalatedHandoffIds: Id[] } } {
    return this.#read((ctx) => {
      const ids = (sql: string): Id[] => ctx.db.all<{ id: string }>(sql).map((r) => r.id as Id);
      const escalated = ids(`SELECT id FROM work_delegations WHERE state = 'ESCALATED' ORDER BY updated_at, id`);
      return {
        ceo: { staffingRequestIds: ids(`SELECT id FROM staffing_requests WHERE state IN ('SUBMITTED', 'CHALLENGED', 'PRIORITIZED') ORDER BY COALESCE(priority, 101), created_at, id`), escalatedHandoffIds: escalated },
        founder: { staffingRequestIds: ids(`SELECT id FROM staffing_requests WHERE state = 'RECOMMENDED' ORDER BY COALESCE(priority, 101), created_at, id`), escalatedHandoffIds: escalated },
      };
    });
  }

  /**
   * Calendar projection (seam, Stage 10 §25): dated organization events in [from, to) — acting coverage
   * ends, delegation due dates, staffing decision dues. Derived; nothing here is a second calendar truth.
   */
  calendar(from: Timestamp, to: Timestamp): { at: string; kind: 'ACTING_ENDS' | 'DELEGATION_DUE' | 'STAFFING_DECISION_DUE'; ref: string }[] {
    return this.#read((ctx) => [
      ...ctx.db.all<{ at: string; id: string }>(`SELECT planned_to AS at, id FROM position_assignments WHERE kind = 'ACTING' AND status = 'ACTIVE' AND planned_to >= ? AND planned_to < ?`, from, to).map((r) => ({ at: r.at, kind: 'ACTING_ENDS' as const, ref: `assignment:${r.id}` })),
      ...ctx.db.all<{ at: string; id: string }>(`SELECT due_at AS at, id FROM work_delegations WHERE due_at IS NOT NULL AND state IN ('OFFERED', 'ACCEPTED', 'CLARIFICATION_REQUESTED', 'ESCALATED') AND due_at >= ? AND due_at < ?`, from, to).map((r) => ({ at: r.at, kind: 'DELEGATION_DUE' as const, ref: `work_delegation:${r.id}` })),
      ...ctx.db.all<{ at: string; id: string }>(`SELECT decision_due_at AS at, id FROM staffing_requests WHERE decision_due_at IS NOT NULL AND state IN ('SUBMITTED', 'CHALLENGED', 'PRIORITIZED', 'RECOMMENDED') AND decision_due_at >= ? AND decision_due_at < ?`, from, to).map((r) => ({ at: r.at, kind: 'STAFFING_DECISION_DUE' as const, ref: `staffing_request:${r.id}` })),
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.ref < b.ref ? -1 : 1)));
  }

  departments(): { id: Id; code: string; name: string; directorPositionId: Id | null }[] {
    return this.#read((ctx) =>
      ctx.db.all('SELECT * FROM departments ORDER BY code').map((r) => {
        const d = mapDepartment(r);
        const seat = ctx.db.get<{ id: string }>(`SELECT id FROM org_positions WHERE kind = 'DIRECTOR' AND department_id = ? AND status <> 'RETIRED'`, d.id);
        return { id: d.id, code: d.code, name: d.name, directorPositionId: (seat?.id ?? null) as Id | null };
      }),
    );
  }

  health(): OrganizationHealth {
    return this.#read((ctx) => {
      const now = ts(ctx);
      const count = (sql: string, ...args: string[]): number => Number(ctx.db.get<{ n: number }>(sql, ...args)?.n ?? 0);
      const positions: Record<string, number> = {};
      for (const r of ctx.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM org_positions GROUP BY status')) positions[r.status] = Number(r.n);
      const vacant = `SELECT COUNT(*) AS n FROM org_positions p WHERE p.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM position_assignments a WHERE a.position_id = p.id AND a.status = 'ACTIVE' AND a.effective_from <= ? AND (a.effective_to IS NULL OR a.effective_to > ?))`;
      const ceo = ceoSeat(ctx);
      return {
        positions,
        vacantActiveSeats: count(vacant, now, now),
        vacantDirectorSeats: count(`${vacant} AND p.kind = 'DIRECTOR'`, now, now),
        ceoSeatVacant: ceo === null || seatHolder(ctx, ceo.id, now).holder === null,
        actingAssignments: count(`SELECT COUNT(*) AS n FROM position_assignments WHERE kind = 'ACTING' AND status = 'ACTIVE' AND effective_to > ?`, now),
        actingPastEnd: count(`SELECT COUNT(*) AS n FROM position_assignments WHERE kind = 'ACTING' AND status = 'ACTIVE' AND planned_to <= ?`, now),
        staffingAwaitingCeo: count(`SELECT COUNT(*) AS n FROM staffing_requests WHERE state IN ('SUBMITTED', 'CHALLENGED', 'PRIORITIZED')`),
        staffingAwaitingFounder: count(`SELECT COUNT(*) AS n FROM staffing_requests WHERE state = 'RECOMMENDED'`),
        openDelegations: count(`SELECT COUNT(*) AS n FROM work_delegations WHERE state IN ('OFFERED', 'ACCEPTED', 'CLARIFICATION_REQUESTED', 'ESCALATED')`),
        escalatedHandoffs: count(`SELECT COUNT(*) AS n FROM work_delegations WHERE state = 'ESCALATED'`),
        activeAuthorityDelegations: count(`SELECT COUNT(*) AS n FROM authority_delegations d JOIN permission_grants g ON g.id = d.grant_id WHERE d.status = 'ACTIVE' AND g.status = 'ACTIVE' AND (g.expires_at IS NULL OR g.expires_at > ?)`, now),
        legacyUnplacedEmployees: count(`SELECT COUNT(*) AS n FROM employees e WHERE e.state <> 'RETIRED' AND NOT EXISTS (SELECT 1 FROM position_assignments a WHERE a.employee_id = e.id AND a.kind = 'PRIMARY' AND a.status = 'ACTIVE')`),
      };
    });
  }
}

function notFound(what: string, id: string): never {
  throw new QandeelError('NOT_FOUND', `${what} not found`, { id: String(id).slice(0, 64) });
}
