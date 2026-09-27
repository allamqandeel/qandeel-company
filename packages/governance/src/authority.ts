/**
 * Runtime authority decisions (Stage 3, Stage 14 D14-A/C). Pure and deterministic.
 *
 *   Intelligence != Authority. Role, Department, Skill, Model and seniority grant nothing:
 *   authority exists only through explicit, scoped, unexpired grants (default deny).
 *
 * Risk ladder (Stage 3 §2):
 *   R0 read/analyze · R1 internal reversible · R2 independent review required (the Review Pool is
 *   C4, so R2 fails closed here) · R3 Founder approval required in Strong-v1 trust-building ·
 *   R4 Founder-only sovereign action (never delegable to an employee, never approvable).
 */
import { QandeelError, canonicalJson, sha256Hex, type RiskLevel, type Timestamp } from '@qandeel-company/domain';

import { dataRank, type DataClass } from './classes.js';
import { canExecute, type EmployeeState } from './employee.js';

export const PRINCIPAL_KINDS = ['FOUNDER', 'EMPLOYEE', 'SYSTEM'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

const RISK_RANK: Readonly<Record<RiskLevel, number>> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };
export const riskRank = (r: RiskLevel): number => RISK_RANK[r];

/** Capability codes: `model.invoke` or `tool:<tool>.<action>`. */
export const CAPABILITY = /^(?:model\.invoke|tool:[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,4})$/;

export function assertCapability(v: unknown, field = 'capability'): string {
  if (typeof v !== 'string' || v.length > 128 || !CAPABILITY.test(v)) throw new QandeelError('VALIDATION_FAILED', 'capability must be "model.invoke" or "tool:<tool>.<action>"', { field });
  return v;
}

export const toolCapability = (toolCode: string, actionCode: string): string => `tool:${toolCode}.${actionCode}`;

/** A resource scope is an exact resource code or `*`. */
export const RESOURCE_SCOPE = /^(?:\*|[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._:-]{1,128}|[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,7})$/;

export interface GrantView {
  readonly id: string;
  readonly capability: string;
  readonly resourceScope: string;
  readonly riskCeiling: RiskLevel;
  readonly dataClassCeiling: DataClass;
  readonly expiresAt: Timestamp | null;
  readonly maxUses: number | null;
  readonly uses: number;
  readonly status: 'ACTIVE' | 'REVOKED';
}

export interface ActionRequest {
  readonly capability: string;
  readonly resource: string;
  readonly risk: RiskLevel;
  readonly dataClass: DataClass;
  readonly at: Timestamp;
}

export type DenyCode =
  | 'NOT_AN_EMPLOYEE'
  | 'EMPLOYEE_NOT_ELIGIBLE'
  | 'FOUNDER_ONLY'
  | 'REVIEW_PATH_UNAVAILABLE'
  | 'NO_GRANT';

export type AuthorityDecision =
  | { readonly effect: 'ALLOW'; readonly grantId: string; readonly approval: 'NONE' | 'FOUNDER' }
  | { readonly effect: 'DENY'; readonly code: DenyCode };

/** Whether one grant covers the request. Every dimension must match; nothing is inferred. */
export function grantCovers(g: GrantView, req: ActionRequest): boolean {
  return (
    g.status === 'ACTIVE' &&
    g.capability === req.capability &&
    (g.resourceScope === '*' || g.resourceScope === req.resource) &&
    (g.expiresAt === null || g.expiresAt > req.at) &&
    (g.maxUses === null || g.uses < g.maxUses) &&
    riskRank(g.riskCeiling) >= riskRank(req.risk) &&
    dataRank(g.dataClassCeiling) >= dataRank(req.dataClass)
  );
}

/**
 * Decides one employee action at the action boundary (D14-C.6). Default deny: with no covering
 * grant the answer is DENY. The caller supplies only the employee's own grants; managerial and
 * departmental hierarchy never contribute (D14-C.4).
 */
export function decideEmployeeAction(actorKind: PrincipalKind, employeeState: EmployeeState | null, grants: readonly GrantView[], req: ActionRequest): AuthorityDecision {
  if (actorKind !== 'EMPLOYEE' || employeeState === null) return { effect: 'DENY', code: 'NOT_AN_EMPLOYEE' };
  if (!canExecute(employeeState)) return { effect: 'DENY', code: 'EMPLOYEE_NOT_ELIGIBLE' };
  if (req.risk === 'R4') return { effect: 'DENY', code: 'FOUNDER_ONLY' };
  if (req.risk === 'R2') return { effect: 'DENY', code: 'REVIEW_PATH_UNAVAILABLE' };
  // Deterministic choice among covering grants: the narrowest (exact resource first), then id.
  const covering = grants.filter((g) => grantCovers(g, req)).sort((a, b) => Number(a.resourceScope === '*') - Number(b.resourceScope === '*') || a.id.localeCompare(b.id));
  const grant = covering[0];
  if (!grant) return { effect: 'DENY', code: 'NO_GRANT' };
  return { effect: 'ALLOW', grantId: grant.id, approval: req.risk === 'R3' ? 'FOUNDER' : 'NONE' };
}

/** Stage 1 §1 / Stage 3 §1: nobody changes their own authority, budget, credentials or reviewer role. */
export function assertNotSelf(actorRef: string, subjectRef: string, what: string): void {
  if (actorRef === subjectRef) throw new QandeelError('SELF_ESCALATION_REFUSED', `an actor cannot change its own ${what}`, { what });
}

/**
 * Governance administration (grants, approvals, budget caps, egress approvals, qualification,
 * holds) is Founder authority in Strong-v1 C2. Director / manager delegation is C4. An employee
 * attempting it on itself is a self-escalation; on anything else it is simply not authorized.
 */
export function assertGovernanceAuthority(actorKind: PrincipalKind, actorRef: string, subjectRef: string | null, what: string): void {
  if (actorKind === 'FOUNDER') return;
  if (subjectRef !== null) assertNotSelf(actorRef, subjectRef, what);
  throw new QandeelError('FOUNDER_ONLY', `${what} requires Founder authority in Strong v1`, { what, actorKind });
}

// --- Approvals ---------------------------------------------------------------------------------

export const APPROVAL_STATES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED', 'REVOKED'] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

/**
 * The durable scope an approval covers (Stage 3 §5): actor, action, resource, context (Work Item),
 * data class, risk and the exact arguments (by SHA-256; arguments are never copied into audit).
 * Any material change produces a different fingerprint, so a prior approval cannot be reused.
 */
export interface ApprovalScope {
  readonly subjectRef: string;
  readonly action: string;
  readonly resourceRef: string;
  readonly workItemId: string | null;
  readonly argsSha256: string;
  readonly dataClass: DataClass;
  readonly risk: RiskLevel;
  readonly limits: { readonly maxCostMicros: number | null };
}

export function approvalFingerprint(scope: ApprovalScope): string {
  return sha256Hex(canonicalJson({ v: 1, ...scope }));
}

/** Who may decide an approval of a given risk (Strong v1: R3 → Founder; R4 is never approvable). */
export function assertApprover(approverKind: PrincipalKind, risk: RiskLevel): void {
  if (risk === 'R4') throw new QandeelError('FOUNDER_ONLY', 'R4 actions are Founder-only and cannot be delegated through an approval', { risk });
  if (risk === 'R2') throw new QandeelError('REVIEW_PATH_UNAVAILABLE', 'R2 needs independent review (Review Pool, C4); an approval does not substitute for it', { risk });
  if (approverKind !== 'FOUNDER') throw new QandeelError('FOUNDER_ONLY', 'Strong-v1 trust-building: R3 approvals are decided by the Founder', { risk, approverKind });
}

export interface ApprovalView {
  readonly id: string;
  readonly state: ApprovalState;
  readonly fingerprint: string;
  readonly expiresAt: Timestamp | null;
  readonly uses: number;
  readonly maxUses: number;
}

/** An approval authorizes exactly its scope, until it expires or is used up. */
export function approvalUsable(a: ApprovalView, fingerprint: string, at: Timestamp): boolean {
  return a.state === 'APPROVED' && a.fingerprint === fingerprint && (a.expiresAt === null || a.expiresAt > at) && a.uses < a.maxUses;
}

// --- Containment ------------------------------------------------------------------------------

/**
 * Deterministic containment (Stage 3 §9, D14-E.5): repeated authority denials inside one run pause
 * the employee (LOG → HOLD). The pause reduces autonomy; it never grants anything.
 */
export const AUTO_PAUSE_DENIALS_PER_RUN = 3;

/**
 * Only authority / bypass signals count toward containment (Stage 3 §9: ordinary task failure does
 * not pause an employee). An unknown tool, malformed arguments or a Founder rejection are ordinary
 * failures: audited, never counted.
 */
export const CONTAINMENT_SIGNALS: ReadonlySet<string> = new Set(['NO_GRANT', 'FOUNDER_ONLY', 'EGRESS_DENIED', 'IDEMPOTENCY_CONFLICT']);
