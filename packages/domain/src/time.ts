import { QandeelError } from './errors.js';

/**
 * Canonical persisted time: ISO-8601 UTC with millisecond precision and a `Z` suffix,
 * always 24 characters (`YYYY-MM-DDTHH:mm:ss.sssZ`). Fixed width makes lexicographic order equal
 * chronological order, so SQLite compares timestamps as plain TEXT. Local time zones are never
 * persisted.
 */
export type Timestamp = string & { readonly __brand: 'Timestamp' };

const TIMESTAMP = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;

export function isTimestamp(value: unknown): value is Timestamp {
  return typeof value === 'string' && TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

export function toTimestamp(epochMs: number): Timestamp {
  if (!Number.isFinite(epochMs)) throw new QandeelError('VALIDATION_FAILED', 'timestamp is not finite');
  const iso = new Date(epochMs).toISOString();
  if (!TIMESTAMP.test(iso)) throw new QandeelError('VALIDATION_FAILED', 'timestamp is outside the supported range');
  return iso as Timestamp;
}

export function parseTimestamp(value: string): number {
  if (!isTimestamp(value)) throw new QandeelError('VALIDATION_FAILED', 'malformed timestamp');
  return Date.parse(value);
}

/** Injected time source. Production uses real UTC time; tests advance time deterministically. */
export interface Clock {
  nowMs(): number;
}

export const systemClock: Clock = Object.freeze({ nowMs: () => Date.now() });

export function now(clock: Clock): Timestamp {
  return toTimestamp(clock.nowMs());
}

/** Deterministic clock for tests: time moves only when `advance`/`set` is called. */
export class ManualClock implements Clock {
  #ms: number;

  constructor(start: number | string = Date.UTC(2026, 8, 26, 12, 0, 0, 0)) {
    this.#ms = typeof start === 'number' ? start : parseTimestamp(start);
  }

  nowMs(): number {
    return this.#ms;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new QandeelError('VALIDATION_FAILED', 'a manual clock only moves forward');
    this.#ms += ms;
  }

  set(epochMs: number): void {
    if (epochMs < this.#ms) throw new QandeelError('VALIDATION_FAILED', 'a manual clock only moves forward');
    this.#ms = epochMs;
  }
}
