/**
 * The provider boundary (R1-09, Technical Lead hardening): the ONLY code that reads a provider's answer
 * or thrown failure. Every provider-controlled field is read exactly once, inside a guard; the captured
 * values are validated and converted into a frozen snapshot of plain values. Money (settle / hold /
 * release), retry disposition, deployment health and containment decisions use only the snapshot — the
 * raw answer or error object is never read again, so a changing, throwing or trick-valued field cannot
 * make one decision see a different provider than another.
 */
import { PROVIDER_FAILURE_CLASSES, ProviderError, costOf, normalizeUsage, type PriceCard, type ProviderFailureClass } from '@qandeel-company/governance';

export type SnapshotUsage =
  | { readonly state: 'NONE' }
  | { readonly state: 'UNUSABLE' }
  | { readonly state: 'REPORTED'; readonly inputTokens: number; readonly outputTokens: number; readonly cachedInputTokens: number; readonly withinBounds: boolean };

export interface ProviderSnapshot {
  /** A usable answer (its text was a string); otherwise a failure. */
  readonly answered: boolean;
  /** The answer's text ('' for a failure). */
  readonly outputText: string;
  /** Always a listed class for a failure; null for an answer. */
  readonly failure: ProviderFailureClass | null;
  readonly usage: SnapshotUsage;
  /** The provider's own data broke the contract — decided once, here, from the captured values alone. */
  readonly providerFault: boolean;
}

export interface SnapshotBounds {
  readonly inputUpperBound: number;
  readonly maxOutputTokens: number;
  readonly priceCard: PriceCard | null;
}

const LISTED: ReadonlySet<string> = new Set(PROVIDER_FAILURE_CLASSES);
const NONE: SnapshotUsage = Object.freeze({ state: 'NONE' });
const UNUSABLE: SnapshotUsage = Object.freeze({ state: 'UNUSABLE' });

/** A listed failure class or null — set membership on a primitive, never an object-key lookup. */
export function listedFailureClass(value: unknown): ProviderFailureClass | null {
  return typeof value === 'string' && LISTED.has(value) ? (value as ProviderFailureClass) : null;
}

/** A failure that no provider data can argue with (timeout, abort). */
export function failureSnapshot(failure: ProviderFailureClass): ProviderSnapshot {
  return Object.freeze({ answered: false, outputText: '', failure, usage: NONE, providerFault: failure === 'CONTRACT_VIOLATION' });
}

/** Snapshot of what `adapter.generate` resolved with. */
export function answerSnapshot(result: unknown, bounds: SnapshotBounds): ProviderSnapshot {
  let outputText: unknown;
  let usage: unknown;
  try {
    const r = result as { outputText?: unknown; usage?: unknown } | null | undefined;
    outputText = r?.outputText;
    usage = captureUsage(r?.usage);
  } catch {
    return failureSnapshot('CONTRACT_VIOLATION');
  }
  // A malformed answer is the provider's contract violation (possibly billed, spend unknown).
  if (typeof outputText !== 'string') return failureSnapshot('CONTRACT_VIOLATION');
  const u = usageOf(usage, bounds, true);
  return Object.freeze({ answered: true, outputText, failure: null, usage: u, providerFault: brokeUsage(u, bounds) });
}

/** Snapshot of what `adapter.generate` threw. */
export function errorSnapshot(error: unknown, bounds: SnapshotBounds): ProviderSnapshot {
  let failure: unknown;
  let usage: unknown;
  try {
    // Anything that is not a ProviderError is UNKNOWN (possibly sent): held, never blamed or retried.
    if (!(error instanceof ProviderError)) return failureSnapshot('UNKNOWN');
    const e = error as { failure?: unknown; usage?: unknown };
    failure = e.failure;
    usage = captureUsage(e.usage);
  } catch {
    return failureSnapshot('CONTRACT_VIOLATION');
  }
  const cls = listedFailureClass(failure) ?? 'UNKNOWN';
  const u = usageOf(usage, bounds, false);
  return Object.freeze({ answered: false, outputText: '', failure: cls, usage: u, providerFault: cls === 'CONTRACT_VIOLATION' || brokeUsage(u, bounds) });
}

/** Reads each field of a usage report exactly once, into a plain object (anything else as it is). */
function captureUsage(u: unknown): unknown {
  if (typeof u !== 'object' || u === null) return u;
  const r = u as { inputTokens?: unknown; outputTokens?: unknown; cachedInputTokens?: unknown };
  const inputTokens = r.inputTokens;
  const outputTokens = r.outputTokens;
  // L1-01: cache-hit input (metering only; a report claiming more cached than input is UNUSABLE below).
  const cachedInputTokens = r.cachedInputTokens;
  return { inputTokens, outputTokens, cachedInputTokens };
}

/** Validated usage values; a missing report is UNUSABLE for an answer and NONE for a failure. */
function usageOf(captured: unknown, bounds: SnapshotBounds, answered: boolean): SnapshotUsage {
  if (captured === undefined || captured === null) return answered ? UNUSABLE : NONE;
  try {
    const n = normalizeUsage(captured, { inputUpperBound: bounds.inputUpperBound, maxOutputTokens: bounds.maxOutputTokens });
    return Object.freeze({ state: 'REPORTED', inputTokens: n.usage.inputTokens, outputTokens: n.usage.outputTokens, cachedInputTokens: n.usage.cachedInputTokens, withinBounds: n.withinBounds });
  } catch {
    return UNUSABLE;
  }
}

/** Usage that is unusable, outside the enforced bounds, or outside the accounting range. */
function brokeUsage(u: SnapshotUsage, bounds: SnapshotBounds): boolean {
  if (u.state === 'NONE') return false;
  if (u.state === 'UNUSABLE' || !u.withinBounds) return true;
  if (!bounds.priceCard) return false;
  try {
    costOf(bounds.priceCard, u.inputTokens, u.outputTokens);
    return false;
  } catch {
    return true;
  }
}
