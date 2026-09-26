import { QandeelError } from './errors.js';

/**
 * Work Item lifecycle (Stage 8 §3, §31, §34, §42).
 *
 * The canonical semantic distinctions are preserved as separate states:
 *   work performed  → IN_PROGRESS
 *   completed       → COMPLETED        (executor finished required work)
 *   reviewed        → REVIEWED         (qualified reviewer/checks validated quality)
 *   outcome verified→ OUTCOME_VERIFIED (intended real-world result verified)
 *   closed          → CLOSED
 * plus the waiting family (WAITING, BLOCKED, WAITING_REVIEW, WAITING_APPROVAL) and the terminal
 * alternatives FAILED, CANCELLED, SUPERSEDED. Optional states are optional: work that needs no
 * review closes from COMPLETED, and CLOSED never implies OUTCOME_VERIFIED.
 */
export const WORK_ITEM_STATES = [
  'PROPOSED',
  'READY',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING',
  'BLOCKED',
  'WAITING_REVIEW',
  'WAITING_APPROVAL',
  'COMPLETED',
  'REVIEWED',
  'OUTCOME_VERIFIED',
  'CLOSED',
  'FAILED',
  'CANCELLED',
  'SUPERSEDED',
] as const;

export type WorkItemState = (typeof WORK_ITEM_STATES)[number];

export const TERMINAL_WORK_ITEM_STATES: ReadonlySet<WorkItemState> = new Set(['CLOSED', 'FAILED', 'CANCELLED', 'SUPERSEDED']);

/** States at or after executor completion. Cancellation no longer applies; supersession still does. */
export const COMPLETED_FAMILY: ReadonlySet<WorkItemState> = new Set(['COMPLETED', 'WAITING_REVIEW', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED']);

/**
 * When a dependency is satisfied (D-C1-09; Stage 8 is silent — reported as a Product gap). The
 * conservative default: work that requires review satisfies its dependents only once REVIEWED
 * (Completed ≠ Reviewed); work that does not require review satisfies them once COMPLETED.
 */
export const REVIEWED_FAMILY: ReadonlySet<WorkItemState> = new Set(['REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED']);

export function satisfiesDependents(item: { readonly state: WorkItemState; readonly reviewRequired: boolean }): boolean {
  return item.reviewRequired ? REVIEWED_FAMILY.has(item.state) : COMPLETED_FAMILY.has(item.state);
}

/** Stage 3 §2 / §4: R2 and above are important actions that require independent review. */
export function requiresReview(subject: { readonly reviewRequired: boolean; readonly riskLevel: RiskLevel }): boolean {
  return subject.reviewRequired || subject.riskLevel === 'R2' || subject.riskLevel === 'R3' || subject.riskLevel === 'R4';
}

/** A dependency that ended without completion never satisfies its dependents. */
export const DEPENDENCY_FAILED_STATES: ReadonlySet<WorkItemState> = new Set(['FAILED', 'CANCELLED', 'SUPERSEDED']);

const PRE_COMPLETION_EXITS = ['CANCELLED', 'SUPERSEDED'] as const;

const TRANSITIONS: Readonly<Record<WorkItemState, readonly WorkItemState[]>> = {
  PROPOSED: ['READY', 'BLOCKED', 'WAITING_APPROVAL', ...PRE_COMPLETION_EXITS],
  READY: ['ASSIGNED', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'WAITING_APPROVAL', ...PRE_COMPLETION_EXITS],
  ASSIGNED: ['READY', 'IN_PROGRESS', 'WAITING', 'BLOCKED', ...PRE_COMPLETION_EXITS],
  IN_PROGRESS: ['READY', 'WAITING', 'BLOCKED', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', ...PRE_COMPLETION_EXITS],
  WAITING: ['READY', 'IN_PROGRESS', 'BLOCKED', 'FAILED', ...PRE_COMPLETION_EXITS],
  // BLOCKED → COMPLETED exists only for reconciliation: an operator confirms that an uncertain
  // external effect did complete (Stage 15 D15-C.5). Ordinary execution completes from IN_PROGRESS.
  BLOCKED: ['READY', 'WAITING', 'COMPLETED', 'FAILED', ...PRE_COMPLETION_EXITS],
  WAITING_APPROVAL: ['READY', 'IN_PROGRESS', ...PRE_COMPLETION_EXITS],
  COMPLETED: ['WAITING_REVIEW', 'REVIEWED', 'CLOSED', 'SUPERSEDED'],
  WAITING_REVIEW: ['REVIEWED', 'READY', 'SUPERSEDED'],
  REVIEWED: ['OUTCOME_VERIFIED', 'CLOSED', 'SUPERSEDED'],
  OUTCOME_VERIFIED: ['CLOSED'],
  CLOSED: [],
  FAILED: [],
  CANCELLED: [],
  SUPERSEDED: [],
};

export function isWorkItemState(value: unknown): value is WorkItemState {
  return typeof value === 'string' && (WORK_ITEM_STATES as readonly string[]).includes(value);
}

export function allowedTransitions(from: WorkItemState): readonly WorkItemState[] {
  return TRANSITIONS[from];
}

export function canTransition(from: WorkItemState, to: WorkItemState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Stage 3 risk ladder, carried as metadata. C1 enforces only the fail-closed approval rule below. */
export const RISK_LEVELS = ['R0', 'R1', 'R2', 'R3', 'R4'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const OUTCOME_STATUSES = ['NOT_ASSESSED', 'ACHIEVED', 'NOT_ACHIEVED'] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

/** Whether cancellation/supersession of a parent propagates to this child (Stage 8 §42). */
export const PROPAGATION_MODES = ['PROPAGATE', 'INDEPENDENT'] as const;
export type PropagationMode = (typeof PROPAGATION_MODES)[number];

/** The facts about a Work Item that transition guards need. */
export interface TransitionSubject {
  readonly state: WorkItemState;
  readonly reviewRequired: boolean;
  readonly approvalRequired: boolean;
  readonly riskLevel: RiskLevel;
}

export interface TransitionRequest {
  readonly to: WorkItemState;
  /** Outcome recorded with the transition, if any. */
  readonly outcome?: OutcomeStatus;
}

/**
 * Stage 1 §1 / Stage 3 §3: sensitive work fails closed when the approval path cannot decide.
 * R3/R4 work always requires approval; explicit `approvalRequired` does too. C1 has no approval
 * engine (C2), so such work may be recorded but can never be released for execution.
 */
export function requiresApproval(subject: Pick<TransitionSubject, 'approvalRequired' | 'riskLevel'>): boolean {
  return subject.approvalRequired || subject.riskLevel === 'R3' || subject.riskLevel === 'R4';
}

/**
 * Validates a transition deterministically. Throws `TERMINAL_STATE`, `INVALID_TRANSITION` or
 * `APPROVAL_PATH_UNAVAILABLE`; returns normally when the transition is allowed.
 */
export function assertTransition(subject: TransitionSubject, request: TransitionRequest): void {
  const { state: from } = subject;
  const { to } = request;
  if (TERMINAL_WORK_ITEM_STATES.has(from)) {
    throw new QandeelError('TERMINAL_STATE', `work item is terminal (${from})`, { from, to });
  }
  if (!canTransition(from, to)) {
    throw new QandeelError('INVALID_TRANSITION', `${from} -> ${to} is not an allowed transition`, { from, to });
  }
  if (requiresApproval(subject) && (to === 'READY' || to === 'IN_PROGRESS' || to === 'ASSIGNED')) {
    throw new QandeelError(
      'APPROVAL_PATH_UNAVAILABLE',
      'work requiring approval cannot be released for execution: no approval path exists in C1',
      { from, to, riskLevel: subject.riskLevel },
    );
  }
  if (from === 'COMPLETED' && to === 'CLOSED' && subject.reviewRequired) {
    throw new QandeelError('INVALID_TRANSITION', 'work that requires review cannot close before it is reviewed', { from, to });
  }
  if (to === 'OUTCOME_VERIFIED' && request.outcome !== 'ACHIEVED') {
    throw new QandeelError('INVALID_TRANSITION', 'OUTCOME_VERIFIED requires a verified ACHIEVED outcome', { from, to });
  }
  if (request.outcome !== undefined && request.outcome !== 'NOT_ASSESSED' && !['OUTCOME_VERIFIED', 'CLOSED'].includes(to)) {
    throw new QandeelError('INVALID_TRANSITION', 'an outcome is recorded only when verifying or closing', { from, to });
  }
  // Stage 8 §34: closing never converts activity into success. ACHIEVED is recorded only by
  // outcome verification; closing may record NOT_ACHIEVED (or leave the outcome unassessed).
  if (to === 'CLOSED' && request.outcome === 'ACHIEVED') {
    throw new QandeelError('INVALID_TRANSITION', 'an ACHIEVED outcome is recorded only through OUTCOME_VERIFIED, never by closing', { from, to });
  }
}

/** Initial state for new work: PROPOSED by default, READY when released, WAITING_APPROVAL when gated. */
export function initialState(
  requested: 'PROPOSED' | 'READY',
  subject: Pick<TransitionSubject, 'approvalRequired' | 'riskLevel'>,
  hasUnresolvedDependencies: boolean,
): WorkItemState {
  if (requested === 'PROPOSED') return 'PROPOSED';
  if (requiresApproval(subject)) return 'WAITING_APPROVAL';
  return hasUnresolvedDependencies ? 'BLOCKED' : 'READY';
}
