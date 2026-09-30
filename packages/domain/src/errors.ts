/**
 * Deterministic, machine-readable errors. Every failure the runtime can report carries a stable
 * `code` so callers (and later C5 surfaces) branch on the code, never on message text.
 * Messages carry IDs and codes only — never business payload (Rule A: content-free telemetry).
 */

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'INVALID_TRANSITION',
  'TERMINAL_STATE',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'DEDUPE_CONFLICT',
  'DEPENDENCY_SELF',
  'DEPENDENCY_CYCLE',
  'LINEAGE_INVALID',
  'STALE_LEASE',
  'LEASE_HELD',
  'SUPERVISOR_NOT_AUTHORITATIVE',
  'NOT_EXECUTABLE',
  'APPROVAL_PATH_UNAVAILABLE',
  'REVIEW_PATH_UNAVAILABLE',
  'ALREADY_SETTLED',
  'STORAGE_BUSY',
  'STORAGE_INVARIANT',
  'UNSAFE_WORKSPACE',
  'MIGRATION_CHECKSUM_DRIFT',
  'MIGRATION_FAILED',
  'SCHEMA_FROM_FUTURE',
  'SCHEMA_NOT_READY',
  'SQLITE_CONFIGURATION',
  'ASYNC_IN_TRANSACTION',
  'ARTIFACT_INTEGRITY',
  'ARTIFACT_NOT_READY',
  'BACKUP_INTEGRITY',
  'RUNTIME_NOT_READY',
  'RUNTIME_STOPPING',
  'UNKNOWN_PROCESSOR',
  // C2 governance (Employees, authority, routing, tools, budgets).
  'EMPLOYEE_NOT_ELIGIBLE',
  'AUTHORITY_DENIED',
  'SELF_ESCALATION_REFUSED',
  'FOUNDER_ONLY',
  'FOUNDER_SURFACE_UNAVAILABLE',
  'APPROVAL_REQUIRED',
  'APPROVAL_REJECTED',
  'APPROVAL_SCOPE_MISMATCH',
  'EGRESS_DENIED',
  'NO_ELIGIBLE_ROUTE',
  'ESCALATION_REFUSED',
  'FALLBACK_REFUSED',
  'PROVIDER_FAILURE',
  'BUDGET_MISSING',
  'BUDGET_EXHAUSTED',
  'ACCOUNTING_OUT_OF_RANGE',
  'CURRENCY_MISMATCH',
  'TOOL_DENIED',
  'RECONCILIATION_REQUIRED',
  // C4 organization, delegation and review.
  'ORG_NOT_ELIGIBLE',
  'ORG_MANAGED_EMPLOYEE',
  'REVIEW_REQUIRED',
  'REVIEW_STALE',
  'REVIEWER_NOT_ELIGIBLE',
  // C5 Founder surface, Goals and communication.
  'FOUNDER_SESSION_INVALID',
  'FOUNDER_CONFIRMATION_REQUIRED',
  'GOAL_INVALID',
  'COMMUNICATION_INVALID',
  // C6 Company Improvement Engine (evaluation, attribution, learning, reporting, resilience).
  'EVAL_INVALID',
  'EVIDENCE_REQUIRED',
  'ATTRIBUTION_INVALID',
  'LEARNING_GATE',
  'UPDATE_HOLD',
  'MAINTENANCE_REFUSED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Details are restricted to short scalar metadata (IDs, states, counts, codes). */
export type ErrorDetails = Readonly<Record<string, string | number | boolean | null>>;

export class QandeelError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message: string, details: ErrorDetails = {}, options?: { cause?: unknown }) {
    super(`${code}: ${message}`, options);
    this.name = 'QandeelError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function isQandeelError(value: unknown, code?: ErrorCode): value is QandeelError {
  return value instanceof QandeelError && (code === undefined || value.code === code);
}
