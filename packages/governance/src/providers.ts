/**
 * Provider-neutral model adapter contract and failure taxonomy (Stage 13 D13-A, D13-F).
 *
 * QANDEEL owns routing, qualification, runtime state and cost authority; a provider adapter only
 * turns one bounded request into one response with reported usage. Adapters never receive secret
 * values in the request, never see authority or budget state, and never execute tools: model output
 * is returned as text that the runtime parses into a typed proposal.
 */
import { QandeelError } from '@qandeel-company/domain';

import { assertTokens } from './economics.js';

export interface ProviderMessage {
  readonly role: 'system' | 'user' | 'tool';
  readonly content: string;
}

/** One bounded inference request. There is deliberately no credential, grant or budget field. */
export interface ProviderRequest {
  readonly providerCode: string;
  readonly modelCode: string;
  readonly deploymentCode: string;
  readonly messages: readonly ProviderMessage[];
  /** Enforced output ceiling; the reservation was computed from it. */
  readonly maxOutputTokens: number;
}

export interface ProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ProviderResponse {
  readonly outputText: string;
  readonly usage: ProviderUsage;
}

/**
 * The adapter contract. A real adapter obtains its credential privately from the host's protected
 * vault (Stage 14 D14-A.4 / D14-D.5) through its own constructor; it is never passed through Company
 * state, prompts or requests.
 */
export interface ProviderAdapter {
  readonly providerCode: string;
  generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>;
}

/**
 * The runtime's provider-neutral input bound used for every worst-case reservation: the UTF-8 byte
 * length of every message plus a fixed per-message
 * framing allowance. Byte-level tokenizers never produce more tokens than bytes.
 */
export function utf8TokenUpperBound(messages: readonly ProviderMessage[]): number {
  return messages.reduce((n, m) => n + Buffer.byteLength(m.content, 'utf8') + Buffer.byteLength(m.role, 'utf8') + 8, 16);
}

/** QANDEEL provider failure taxonomy (D13-F.1). Adapters normalize every error into one class. */
export const PROVIDER_FAILURE_CLASSES = [
  'TRANSIENT',
  'RATE_LIMITED',
  'TIMEOUT_AFTER_SEND',
  'CAPACITY',
  'AUTH',
  'BILLING',
  'QUOTA_EXHAUSTED',
  'INVALID_REQUEST',
  'CONTENT_POLICY',
  'CONTEXT_OVERFLOW',
  'MODEL_DEPRECATED',
  'CONTRACT_VIOLATION',
  'UNKNOWN',
] as const;
export type ProviderFailureClass = (typeof PROVIDER_FAILURE_CLASSES)[number];

export interface FailureDisposition {
  /** Same deployment again (bounded) — only for transient failures that were not billed. */
  readonly retry: boolean;
  /** A different prequalified route within the same envelope. */
  readonly fallback: boolean;
  /** An operational hold, never a retry loop (D13-F.8). */
  readonly hold: 'PROVIDER' | 'DEPLOYMENT' | null;
  /** Counts toward the per-deployment circuit breaker. */
  readonly circuit: boolean;
  /** Whether the request may have been processed (and billed): UNKNOWN keeps the reservation for reconciliation. */
  readonly sent: 'NO' | 'UNKNOWN';
}

const D = (retry: boolean, fallback: boolean, hold: FailureDisposition['hold'], circuit: boolean, sent: FailureDisposition['sent']): FailureDisposition => Object.freeze({ retry, fallback, hold, circuit, sent });

export const FAILURE_DISPOSITIONS: Readonly<Record<ProviderFailureClass, FailureDisposition>> = Object.freeze({
  TRANSIENT: D(true, true, null, true, 'NO'),
  RATE_LIMITED: D(true, true, null, false, 'NO'),
  TIMEOUT_AFTER_SEND: D(false, true, null, true, 'UNKNOWN'),
  CAPACITY: D(false, true, null, true, 'NO'),
  AUTH: D(false, true, 'PROVIDER', false, 'NO'),
  BILLING: D(false, true, 'PROVIDER', false, 'NO'),
  QUOTA_EXHAUSTED: D(false, true, 'DEPLOYMENT', false, 'NO'),
  INVALID_REQUEST: D(false, false, null, false, 'NO'),
  CONTENT_POLICY: D(false, false, null, false, 'NO'),
  CONTEXT_OVERFLOW: D(false, false, null, false, 'NO'),
  MODEL_DEPRECATED: D(false, true, 'DEPLOYMENT', false, 'NO'),
  CONTRACT_VIOLATION: D(false, false, 'DEPLOYMENT', true, 'UNKNOWN'),
  UNKNOWN: D(false, false, null, true, 'UNKNOWN'),
});

/** Consecutive circuit-counted failures that open a deployment's circuit, and for how long. */
export const CIRCUIT_THRESHOLD = 3;
export const CIRCUIT_OPEN_MS = 5 * 60_000;

/** The only error an adapter may throw: a normalized failure class, no provider message text. */
export class ProviderError extends Error {
  readonly failure: ProviderFailureClass;
  /** Usage the provider reported for a failed call, if any (it is charged, never hidden). */
  readonly usage: ProviderUsage | null;

  constructor(failure: ProviderFailureClass, usage: ProviderUsage | null = null) {
    super(`provider failure: ${failure}`);
    this.name = 'ProviderError';
    this.failure = failure;
    this.usage = usage;
  }
}

/** Anything an adapter throws that is not a ProviderError is UNKNOWN (possibly sent). */
export function classifyProviderError(error: unknown): ProviderFailureClass {
  return error instanceof ProviderError && (PROVIDER_FAILURE_CLASSES as readonly string[]).includes(error.failure) ? error.failure : 'UNKNOWN';
}

/** Validates reported usage against the enforced bounds; a violation is a contract failure. */
export function normalizeUsage(usage: unknown, bounds: { inputUpperBound: number; maxOutputTokens: number }): { usage: ProviderUsage; withinBounds: boolean } {
  const u = usage as Partial<ProviderUsage> | null;
  if (typeof u !== 'object' || u === null) throw new QandeelError('PROVIDER_FAILURE', 'provider reported no usage', { failure: 'CONTRACT_VIOLATION' });
  const inputTokens = assertTokens(u.inputTokens, 'usage.inputTokens');
  const outputTokens = assertTokens(u.outputTokens, 'usage.outputTokens');
  return { usage: { inputTokens, outputTokens }, withinBounds: inputTokens <= bounds.inputUpperBound && outputTokens <= bounds.maxOutputTokens };
}
