/**
 * C4 organization rules (Stage 2 §2, Stage 3, Stage 8 §20–§29, Stage 10; D-R1-04 / D-R1-05 / D-R1-06).
 * Pure and deterministic, no I/O.
 *
 *   Title ≠ Authority. Nothing here grants anything: a Position (CEO, Director, Lead…) is at most an
 *   eligibility / context input; every organizational act still needs an explicit grant (authority.ts).
 *   Work delegation ≠ authority delegation: handing work to someone never widens what they may do.
 */
import { QandeelError, boundedText, type Timestamp } from '@qandeel-company/domain';

import { assertCatalogCode } from './classes.js';
import { assertMoney, assertTokens } from './economics.js';

export const POSITION_SCOPES = ['COMPANY', 'DEPARTMENT'] as const;
export type PositionScope = (typeof POSITION_SCOPES)[number];

export const POSITION_KINDS = ['CEO', 'DIRECTOR', 'MANAGER', 'LEAD', 'SPECIALIST'] as const;
export type PositionKind = (typeof POSITION_KINDS)[number];

/** Seats a Staffing Request may ask for: the CEO and Director seats are part of the canonical map. */
export const STAFFABLE_POSITION_KINDS = ['MANAGER', 'LEAD', 'SPECIALIST'] as const;
export type StaffablePositionKind = (typeof STAFFABLE_POSITION_KINDS)[number];

export const POSITION_STATUSES = ['PROPOSED', 'ACTIVE', 'PAUSED', 'RETIRED'] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];

/** Operational seat changes (D-R1-06): add → activate, pause, re-open, retire — data, never code. */
const POSITION_NEXT: Readonly<Record<PositionStatus, readonly PositionStatus[]>> = Object.freeze({
  PROPOSED: ['ACTIVE', 'RETIRED'],
  ACTIVE: ['PAUSED', 'RETIRED'],
  PAUSED: ['ACTIVE', 'RETIRED'],
  RETIRED: [],
});

export function assertPositionTransition(from: PositionStatus, to: PositionStatus): void {
  if (!Object.hasOwn(POSITION_NEXT, from) || !POSITION_NEXT[from].includes(to)) throw new QandeelError('INVALID_TRANSITION', `${from} -> ${to} is not a position transition`, { from, to });
}

const isMember = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
export const isPositionKind = (v: unknown): v is PositionKind => isMember(POSITION_KINDS, v);
export const isPositionScope = (v: unknown): v is PositionScope => isMember(POSITION_SCOPES, v);
export const isStaffableKind = (v: unknown): v is StaffablePositionKind => isMember(STAFFABLE_POSITION_KINDS, v);

/** `role:<code>` role references (the C3 role vocabulary). */
export const ROLE_REF = /^role:[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,7}$/;
export function assertRoleRef(v: unknown, field = 'roleRef'): string {
  if (typeof v !== 'string' || v.length > 161 || !ROLE_REF.test(v)) throw new QandeelError('VALIDATION_FAILED', `${field} must be "role:<code>"`, { field });
  return v;
}

/** Position codes: short dotted lower-case codes (`director.growth`, `growth.seo-specialist-1`). */
export const POSITION_CODE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,11}$/;
export function assertPositionCode(v: unknown, field = 'code'): string {
  if (typeof v !== 'string' || v.length > 96 || !POSITION_CODE.test(v)) throw new QandeelError('VALIDATION_FAILED', `${field} must be a short lower-case position code`, { field });
  return v;
}

// --- Effective-dated assignments: the ONE rule for "who holds a seat at T" (D-C4-03) -------------------

export interface AssignmentView {
  readonly id: string;
  readonly employeeId: string;
  readonly kind: 'PRIMARY' | 'ACTING';
  readonly effectiveFrom: Timestamp;
  /** Actual end (ended / expired) or, for ACTING, the planned end; null = open-ended PRIMARY. */
  readonly effectiveTo: Timestamp | null;
}

/** An assignment is effective at T when T is inside [effectiveFrom, effectiveTo). Expiry is read from time. */
export function effectiveAt(a: AssignmentView, at: Timestamp): boolean {
  return a.effectiveFrom <= at && (a.effectiveTo === null || at < a.effectiveTo);
}

export interface SeatHolding {
  /** The accountable holder at T: valid ACTING coverage, else the PRIMARY holder, else nobody. */
  readonly holder: AssignmentView | null;
  /** The permanent (PRIMARY) holder of record at T, kept even while someone acts for them. */
  readonly ofRecord: AssignmentView | null;
}

/**
 * Deterministic: a valid ACTING assignment at T takes the seat's accountability for its bounded scope;
 * otherwise the PRIMARY one does. Downstream queries never see two current owners. Ties (which the
 * datastore's partial unique indexes prevent) resolve to the latest start, then the smallest id.
 */
export function seatHolderAt(assignments: readonly AssignmentView[], at: Timestamp): SeatHolding {
  const pick = (kind: 'PRIMARY' | 'ACTING'): AssignmentView | null =>
    assignments
      .filter((a) => a.kind === kind && effectiveAt(a, at))
      .sort((x, y) => (x.effectiveFrom === y.effectiveFrom ? x.id.localeCompare(y.id) : x.effectiveFrom < y.effectiveFrom ? 1 : -1))[0] ?? null;
  const acting = pick('ACTING');
  const primary = pick('PRIMARY');
  return { holder: acting ?? primary, ofRecord: primary };
}

/** Acting coverage is explicit and bounded (Stage 10 §25): an engineering default, tunable policy. */
export const MAX_ACTING_DAYS = 90;

export function assertActingWindow(from: Timestamp, to: Timestamp): void {
  const ms = Date.parse(to) - Date.parse(from);
  if (!(ms > 0)) throw new QandeelError('VALIDATION_FAILED', 'acting coverage ends after it starts', { field: 'effectiveTo' });
  if (ms > MAX_ACTING_DAYS * 86_400_000) throw new QandeelError('VALIDATION_FAILED', `acting coverage is bounded to ${MAX_ACTING_DAYS} days`, { field: 'effectiveTo' });
}

// --- Staffing Requests (Stage 10 §21 / §22) --------------------------------------------------------------

/** Stage 10 §22, in order: every earlier option must be addressed before a persistent Employee. */
export const STAFFING_ALTERNATIVES = ['redistributeWork', 'improveSkillOrTraining', 'automate', 'temporarySpecialistOrCapability'] as const;

export interface StaffingRequestInput {
  readonly departmentCode: string | null;
  readonly roleRef: string;
  readonly positionKind: StaffablePositionKind;
  readonly positionTitle: string;
  readonly businessNeed: string;
  readonly workloadEvidence: string;
  readonly skillGap: string;
  readonly expectedValue: string;
  readonly impactIfNotStaffed: string;
  readonly alternatives: Readonly<Record<(typeof STAFFING_ALTERNATIVES)[number], string>>;
  readonly expectedCostMicros: number | null;
}

const ownString = (o: Record<string, unknown>, key: string): unknown => (Object.hasOwn(o, key) ? o[key] : undefined);

function plainObject(v: unknown, field: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) throw new QandeelError('VALIDATION_FAILED', `${field} must be a plain object`, { field });
  return v as Record<string, unknown>;
}

function onlyKeys(o: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new QandeelError('VALIDATION_FAILED', `${field} has an unknown field`, { field: `${field}.${k.slice(0, 32)}` });
}

/** Parses a Staffing Request by own fields only; incomplete Stage 10 evidence is refused. */
export function parseStaffingRequest(input: unknown): StaffingRequestInput {
  const o = plainObject(input, 'staffingRequest');
  onlyKeys(o, ['departmentCode', 'roleRef', 'positionKind', 'positionTitle', 'businessNeed', 'workloadEvidence', 'skillGap', 'expectedValue', 'impactIfNotStaffed', 'alternatives', 'expectedCostMicros'], 'staffingRequest');
  const dept = ownString(o, 'departmentCode');
  const kind = ownString(o, 'positionKind');
  if (!isStaffableKind(kind)) throw new QandeelError('VALIDATION_FAILED', 'a staffing request asks for a MANAGER, LEAD or SPECIALIST seat', { field: 'positionKind' });
  const alternatives = plainObject(ownString(o, 'alternatives'), 'alternatives');
  onlyKeys(alternatives, STAFFING_ALTERNATIVES, 'alternatives');
  const alt = Object.fromEntries(
    STAFFING_ALTERNATIVES.map((k) => {
      const v = ownString(alternatives, k);
      if (typeof v !== 'string' || v.trim().length === 0) throw new QandeelError('VALIDATION_FAILED', 'every Stage 10 staffing alternative must be addressed before a persistent employee', { field: `alternatives.${k}`, reason: 'STAFFING_EVIDENCE_INCOMPLETE' });
      return [k, boundedText(v, `alternatives.${k}`, 1000)];
    }),
  ) as StaffingRequestInput['alternatives'];
  const cost = ownString(o, 'expectedCostMicros');
  return {
    departmentCode: dept === null || dept === undefined ? null : assertCatalogCode(dept, 'departmentCode'),
    roleRef: assertRoleRef(ownString(o, 'roleRef')),
    positionKind: kind,
    positionTitle: boundedText(ownString(o, 'positionTitle'), 'positionTitle', 120),
    businessNeed: boundedText(ownString(o, 'businessNeed'), 'businessNeed', 2000),
    workloadEvidence: boundedText(ownString(o, 'workloadEvidence'), 'workloadEvidence', 2000),
    skillGap: boundedText(ownString(o, 'skillGap'), 'skillGap', 2000),
    expectedValue: boundedText(ownString(o, 'expectedValue'), 'expectedValue', 2000),
    impactIfNotStaffed: boundedText(ownString(o, 'impactIfNotStaffed'), 'impactIfNotStaffed', 2000),
    alternatives: alt,
    expectedCostMicros: cost === undefined || cost === null ? null : assertMoney(cost, 'expectedCostMicros'),
  };
}

export const STAFFING_STATES = ['SUBMITTED', 'CHALLENGED', 'RETURNED_FOR_EVIDENCE', 'PRIORITIZED', 'RECOMMENDED', 'CONSOLIDATED', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export type StaffingState = (typeof STAFFING_STATES)[number];

/** CEO synthesis acts (D-R1-04): challenge, return for evidence, prioritize, consolidate, recommend. None hires. */
export const STAFFING_REVIEW_ACTIONS = ['CHALLENGE', 'RETURN_FOR_EVIDENCE', 'PRIORITIZE', 'CONSOLIDATE', 'RECOMMEND_APPROVE', 'RECOMMEND_REJECT'] as const;
export type StaffingReviewAction = (typeof STAFFING_REVIEW_ACTIONS)[number];
export const isStaffingReviewAction = (v: unknown): v is StaffingReviewAction => isMember(STAFFING_REVIEW_ACTIONS, v);

const OPEN_STAFFING: readonly StaffingState[] = ['SUBMITTED', 'CHALLENGED', 'PRIORITIZED', 'RECOMMENDED'];
export const isOpenStaffingState = (s: StaffingState): boolean => OPEN_STAFFING.includes(s);

const REVIEW_TARGET: Readonly<Record<StaffingReviewAction, StaffingState>> = Object.freeze({
  CHALLENGE: 'CHALLENGED',
  RETURN_FOR_EVIDENCE: 'RETURNED_FOR_EVIDENCE',
  PRIORITIZE: 'PRIORITIZED',
  CONSOLIDATE: 'CONSOLIDATED',
  RECOMMEND_APPROVE: 'RECOMMENDED',
  RECOMMEND_REJECT: 'RECOMMENDED',
});

/** The CEO's synthesis moves an OPEN request; a decided, returned or consolidated request is history. */
export function staffingReviewTarget(from: StaffingState, action: StaffingReviewAction): StaffingState {
  if (!OPEN_STAFFING.includes(from)) throw new QandeelError('INVALID_TRANSITION', 'only an open staffing request is reviewed', { from, action });
  return REVIEW_TARGET[action];
}

/** A decision (APPROVE / REJECT) is taken on an open request only, by the Founder or explicit delegation. */
export function assertStaffingDecidable(from: StaffingState): void {
  if (!OPEN_STAFFING.includes(from)) throw new QandeelError('INVALID_TRANSITION', 'only an open staffing request is decided', { from });
}

// --- Organization acts of Employees (D-C4-04) ----------------------------------------------------------

/**
 * The closed set of organizational acts an Employee may propose from a governed run. Each needs the
 * capability listed here as an explicit grant (default deny) — except the responses a party makes to its
 * OWN handoff, which exercise no authority over anyone else. Looked up by own key only (R1-02 family).
 */
export const ORG_ACTIONS = [
  'staffing.request.create',
  'staffing.request.review',
  'staffing.request.decide',
  'staffing.hire',
  'work.delegate',
  'work.support.request',
  'work.reprioritize',
  'handoff.refuse',
  'handoff.clarification.request',
  'handoff.clarify',
  'handoff.escalate',
  'review.plan.declare',
] as const;
export type OrgAction = (typeof ORG_ACTIONS)[number];
export const isOrgAction = (v: unknown): v is OrgAction => isMember(ORG_ACTIONS, v);

const ORG_ACTION_CAPABILITY: Readonly<Record<OrgAction, string | null>> = Object.freeze({
  'staffing.request.create': 'org.staffing.request',
  'staffing.request.review': 'org.staffing.review',
  'staffing.request.decide': 'org.staffing.decide',
  'staffing.hire': 'org.staffing.hire',
  'work.delegate': 'org.work.delegate',
  'work.support.request': 'org.work.support',
  'work.reprioritize': 'org.work.reprioritize',
  'handoff.refuse': null,
  'handoff.clarification.request': null,
  'handoff.clarify': null,
  'handoff.escalate': null,
  'review.plan.declare': 'org.review.plan',
});

/** The grant an act needs (`null`: the act only answers one's own handoff). Unknown acts have none. */
export function orgActionCapability(action: OrgAction): string | null {
  return Object.hasOwn(ORG_ACTION_CAPABILITY, action) ? ORG_ACTION_CAPABILITY[action] : null;
}

/** Organization capabilities the Founder may delegate as explicit grants (never R4, never approval). */
export const ORG_CAPABILITIES = ['org.staffing.request', 'org.staffing.review', 'org.staffing.decide', 'org.staffing.hire', 'org.work.delegate', 'org.work.support', 'org.work.reprioritize', 'org.review.plan'] as const;
export const isOrgCapability = (v: unknown): boolean => isMember(ORG_CAPABILITIES, v);

// --- Work delegation bounds (Stage 8 §24–§26, §29) --------------------------------------------------

/** Engineering defaults (tunable policy, not Product constants). */
export const MAX_DELEGATION_DEPTH = 3;
export const MAX_OPEN_DELEGATIONS_PER_PARENT = 5;

export function assertDelegationBounds(depth: number, openFromParent: number): void {
  if (depth > MAX_DELEGATION_DEPTH) throw new QandeelError('ORG_NOT_ELIGIBLE', 'delegation depth limit reached; escalate instead', { reason: 'DELEGATION_DEPTH_EXCEEDED', depth });
  if (openFromParent >= MAX_OPEN_DELEGATIONS_PER_PARENT) throw new QandeelError('ORG_NOT_ELIGIBLE', 'delegation fan-out limit reached for this work item', { reason: 'DELEGATION_FANOUT_EXCEEDED' });
}

/**
 * Ping-pong / cycle prevention (Stage 8 §24): a delegate may not be anyone already on the delegation chain
 * from this Work Item back to its root (A → B → A, A → B → C → A).
 */
export function delegationCycle(chainEmployeeIds: readonly string[], delegateId: string): boolean {
  return chainEmployeeIds.includes(delegateId);
}

export interface DelegationInput {
  readonly delegateEmployeeId: string;
  readonly objective: string;
  readonly instructions: string;
  readonly taskClass: string;
  readonly budgetMoney: number;
  readonly budgetTokens: number;
  readonly dueAt: string | null;
}

// --- Founder → Employee authority delegation limits (Stage 3 §3, D-R1-04) --------------------------------

export interface DelegationLimits {
  readonly maxCostMicros: number | null;
  readonly roleRefs: readonly string[] | null;
  readonly positionKinds: readonly StaffablePositionKind[] | null;
  readonly departmentCodes: readonly string[] | null;
}

const LIMIT_KEYS = ['maxCostMicros', 'roleRefs', 'positionKinds', 'departmentCodes'];

/** Policy limits of a delegation, own fields only (anything unknown is refused, never ignored). */
export function parseDelegationLimits(v: unknown): DelegationLimits {
  const o = plainObject(v ?? {}, 'limits');
  onlyKeys(o, LIMIT_KEYS, 'limits');
  const list = <T>(key: string, check: (x: unknown) => T): readonly T[] | null => {
    const raw = ownString(o, key);
    if (raw === undefined || raw === null) return null;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 16) throw new QandeelError('VALIDATION_FAILED', `limits.${key} must be a non-empty list`, { field: `limits.${key}` });
    return raw.map(check);
  };
  const cost = ownString(o, 'maxCostMicros');
  return {
    maxCostMicros: cost === undefined || cost === null ? null : assertMoney(cost, 'limits.maxCostMicros'),
    roleRefs: list('roleRefs', (x) => assertRoleRef(x, 'limits.roleRefs')),
    positionKinds: list('positionKinds', (x) => {
      if (!isStaffableKind(x)) throw new QandeelError('VALIDATION_FAILED', 'limits.positionKinds lists staffable seats only', { field: 'limits.positionKinds' });
      return x;
    }),
    departmentCodes: list('departmentCodes', (x) => assertCatalogCode(x, 'limits.departmentCodes')),
  };
}

/** Whether a delegated staffing decision stays inside its policy limits (every dimension, nothing inferred). */
export function limitsAllow(l: DelegationLimits, s: { readonly costMicros: number | null; readonly roleRef: string; readonly positionKind: string; readonly departmentCode: string | null }): { ok: true } | { ok: false; reason: string } {
  if (l.maxCostMicros !== null && (s.costMicros === null || s.costMicros > l.maxCostMicros)) return { ok: false, reason: 'DELEGATION_COST_LIMIT' };
  if (l.roleRefs !== null && !l.roleRefs.includes(s.roleRef)) return { ok: false, reason: 'DELEGATION_ROLE_LIMIT' };
  if (l.positionKinds !== null && !(l.positionKinds as readonly string[]).includes(s.positionKind)) return { ok: false, reason: 'DELEGATION_SEAT_LIMIT' };
  if (l.departmentCodes !== null && (s.departmentCode === null || !l.departmentCodes.includes(s.departmentCode))) return { ok: false, reason: 'DELEGATION_DEPARTMENT_LIMIT' };
  return { ok: true };
}

export const assertBudgetCaps = (money: unknown, tokens: unknown): { money: number; tokens: number } => ({ money: assertMoney(money, 'budgetMoney'), tokens: assertTokens(tokens, 'budgetTokens') });
