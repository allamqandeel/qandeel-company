/**
 * The run-failure vocabulary (R2-12): the ONE list of codes a governed run records on `runs.failure_code`,
 * each with the C6 cause family it evidences — or `null`, explicitly unclassified. The runtime emits only
 * these codes and the C6 evidence builder classifies only through this table: neither side keeps a copy.
 *
 * A code names the REAL cause. A local failure (the store could not record a possibly-billed call's
 * accounting) and a configuration gap (no route policy) are never provider codes; only the provider's own
 * unavailability or fault is. A family is never guessed: a code whose cause family is not decided by
 * authority stays unclassified (e.g. PG-11: a provider's INVALID_REQUEST / CONTENT_POLICY verdict).
 */
import { failureDisposition, type ProviderFailureClass } from './providers.js';

/** The C6 cause families a run failure code can evidence (the WorkEvidence failure buckets). */
export const RUN_FAILURE_FAMILIES = ['PROVIDER', 'MODEL', 'TOOL', 'CONTEXT', 'WORKFLOW', 'REQUIREMENT', 'BOUNDARY'] as const;
export type RunFailureFamily = (typeof RUN_FAILURE_FAMILIES)[number];

/**
 * Every code the governed runtime records on a run (failure codes and wait reasons), with its family.
 * `null` = explicitly unclassified: C6 reads no cause from it.
 */
export const RUN_FAILURE_CODES = Object.freeze({
  // The model provider: its own unavailability, fault or refusal of every qualified route.
  PROVIDER_UNAVAILABLE: 'PROVIDER', // unavailable / every attempt used, nothing possibly billed left unexplained
  PROVIDER_FAILURE: 'PROVIDER', // the provider broke the contract or the outcome is unknown after send
  FALLBACK_REFUSED: 'PROVIDER', // the provider failed and the only alternative route was costlier
  NO_ELIGIBLE_ROUTE: 'PROVIDER', // no deployment is eligible for the call
  PROVIDER_CIRCUIT_OPEN: 'PROVIDER', // P1-REASON-AUTO-RECOVERY-01: every eligible route is only held by an open circuit (bounded timed waits used)
  PROVIDER_CONTEXT_OVERFLOW: 'CONTEXT',
  PROVIDER_INVALID_REQUEST: null, // PG-11: family not decided by authority
  PROVIDER_CONTENT_POLICY: null, // PG-11: family not decided by authority
  // Local causes: never the provider.
  SETTLEMENT_FAILED: null, // the store could not record a possibly-billed call's accounting (money held)
  RUN_ABORTED: null, // the run was stopped (cancel / shutdown / timeout) during a model call
  REASONING_ABOVE_CEILING: null, // the requested reasoning class is above the Employee's / policy's ceiling
  REASONING_LEVEL_UNAVAILABLE: null, // P1-REASON-AUTO-RECOVERY-01: a pinned class has no deployment of that class at all (never substituted)
  // Model.
  MODEL_OUTPUT_INVALID: 'MODEL',
  MODEL_OUTPUT_TRUNCATED: 'MODEL', // P1-REASON-AUTO-RECOVERY-01: the output allowance ran out again after the one same-class continuation
  // Tools.
  TOOL_FAILED: 'TOOL',
  TOOL_NOT_EXECUTED: 'TOOL',
  TOOL_OUTCOME_UNCERTAIN: 'TOOL',
  // Context assembly.
  CONTEXT_BUDGET_EXHAUSTED: 'CONTEXT',
  CONTEXT_NOT_ASSEMBLED: 'CONTEXT',
  INTEGRITY_FAILURE: null, // counted through its non-OK context manifest, never twice
  // Workflow / configuration.
  NO_ROUTE_POLICY: 'WORKFLOW',
  BUDGET_EXHAUSTED: 'WORKFLOW',
  GOVERNANCE_REQUIRED: 'WORKFLOW',
  // Requirement.
  INVALID_TASK_INPUT: 'REQUIREMENT',
  // Authority boundary (the Employee's own act).
  ESCALATION_REFUSED: 'BOUNDARY',
  HANDOFF_REFUSED: 'BOUNDARY',
  EMPLOYEE_CONTAINED: 'BOUNDARY',
  // Budget / access refusals passed through from the authority path (unclassified, as before).
  MODEL_ACCESS_DENIED: null,
  BUDGET_MISSING: null,
  RUN_LIMIT: null,
  EMPLOYEE_NOT_ELIGIBLE: null,
  ROUTE_NO_LONGER_ELIGIBLE: null,
  CONTEXT_MANIFEST_REQUIRED: null,
  NOT_EMPLOYEE_OWNED: null,
  CAPABILITY_GAP_CANCELLED: null,
  STEP_RANGE_EXHAUSTED: null,
  MAX_TURNS: null,
  // Waits (a parked run is not a failure).
  AWAITING_APPROVAL: null,
  AWAITING_INDEPENDENT_REVIEW: null,
  AWAITING_CLARIFICATION: null,
  AWAITING_ESCALATION: null,
  AWAITING_DELEGATION: null,
  MEMORY_CONFLICT_REVIEW: null,
  SKILL_CONFLICT_REVIEW: null,
  CAPABILITY_GAP: null,
  // The runtime's own settle overrides.
  PROCESSOR_ERROR: null,
  PROCESSOR_STOPPED_UNPROMPTED: null,
  INVALID_WAIT: null,
  RUN_TIMEOUT: null,
} as const satisfies Readonly<Record<string, RunFailureFamily | null>>);

export type RunFailureCode = keyof typeof RUN_FAILURE_CODES;

/** Own-key membership only (a prototype key such as `constructor` is never a code). */
export function isRunFailureCode(code: unknown): code is RunFailureCode {
  return typeof code === 'string' && Object.hasOwn(RUN_FAILURE_CODES, code);
}

/** The cause family a recorded run code evidences; null when unclassified or not a run code. */
export function runFailureFamily(code: unknown): RunFailureFamily | null {
  return isRunFailureCode(code) ? RUN_FAILURE_CODES[code] : null;
}

/** The codes of one family (what C6 counts for that cause). */
export function runFailureCodesOf(family: RunFailureFamily): readonly RunFailureCode[] {
  return Object.freeze((Object.keys(RUN_FAILURE_CODES) as RunFailureCode[]).filter((c) => RUN_FAILURE_CODES[c] === family));
}

/**
 * The run code for a model call that returned no answer (`UNAVAILABLE`). Configuration and local causes keep
 * their own codes; a route refusal after a provider failure is FALLBACK_REFUSED; the provider's last failure
 * decides between PROVIDER_FAILURE (possibly sent: fault / unknown) and PROVIDER_UNAVAILABLE.
 */
export function unavailableRunCode(code: string): RunFailureCode {
  switch (code) {
    case 'NO_ROUTE_POLICY':
      return 'NO_ROUTE_POLICY';
    case 'NO_ELIGIBLE_DEPLOYMENT':
      return 'NO_ELIGIBLE_ROUTE';
    case 'REASONING_ABOVE_CEILING':
      return 'REASONING_ABOVE_CEILING';
    case 'FALLBACK_REFUSED_COST':
      return 'FALLBACK_REFUSED';
    case 'ABORTED':
      return 'RUN_ABORTED';
    case 'SETTLEMENT_FAILED':
      return 'SETTLEMENT_FAILED';
    case 'REASONING_LEVEL_UNAVAILABLE':
      return 'REASONING_LEVEL_UNAVAILABLE';
    case 'PROVIDER_CIRCUIT_OPEN':
      return 'PROVIDER_CIRCUIT_OPEN';
  }
  const last = code.startsWith('PROVIDER_') ? code.slice('PROVIDER_'.length) : null;
  return last !== null && failureDisposition(last).sent === 'UNKNOWN' ? 'PROVIDER_FAILURE' : 'PROVIDER_UNAVAILABLE';
}

/** The run code for a provider's final failure that allows no fallback (`FAILED`). */
export function providerFailedRunCode(failure: ProviderFailureClass): RunFailureCode {
  const code = `PROVIDER_${failure}`;
  return isRunFailureCode(code) ? code : 'PROVIDER_FAILURE';
}
