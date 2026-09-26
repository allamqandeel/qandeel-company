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
