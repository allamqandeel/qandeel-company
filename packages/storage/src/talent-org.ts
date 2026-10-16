/**
 * COMPANY-TALENT-01 — what a leader does from its own governed run, and the scalable Academy evaluation (D4, D5).
 *
 * - `talent.propose`: a CEO or Director proposes an identity profile, a program, a Skill, a retraining or a Department
 *   budget. A proposal is evidence and a request: an identity / program proposal is an editable DRAFT in the Talent
 *   Catalog; nothing is approved, hired, granted, spent or certified until the Founder decides.
 * The scalable Academy evaluation (D5) lives in `academy-manager.ts`, a C3 Academy module, on top of these seat helpers.
 */
import { assertId, isQandeelError, newId, type Id } from '@qandeel-company/domain';
import { containsSecretMaterial } from '@qandeel-company/mind';

import { getEmployeeRow } from './governance-core.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { liveCertifications } from './mind-core.js';
import { effectiveManagerRefAt, getPosition, primaryAssignmentAt } from './org-core.js';
import type { Fence } from './records.js';
import { txSaveDraft } from './talent-catalog.js';

export type Out = { readonly ref: string } | { readonly refused: string };
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

export const plainObject = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype ? (v as Record<string, unknown>) : null);

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
  let departmentId: Id | null;
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

