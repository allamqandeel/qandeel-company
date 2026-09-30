/**
 * The tool-driver boundary (R2-10 — the R1-09 provider-boundary hardening applied to tools): the ONLY code
 * that reads a tool driver's answer. Each driver-controlled field (`ok`, `result`, `code`, `sent`) is read at
 * most once, inside a guard; the result is serialized once and re-parsed into frozen plain data; the failure
 * code is validated once. The durable record, the money (settle / release / hold), the idempotency state,
 * the step result and the model's copy all use this one snapshot — the raw answer is never read again, so a
 * shifting, throwing or Proxy-backed answer cannot make one decision see a different outcome than another.
 */
import { canonicalJson, type JsonObject } from '@qandeel-company/domain';
import { containsSecretMaterial } from '@qandeel-company/mind';

export type ToolSnapshot =
  | { readonly ok: true; readonly result: JsonObject }
  | { readonly ok: false; readonly code: string; readonly sent: 'NO' | 'UNKNOWN' };

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** A driver call that may have run (throw, timeout, malformed or unreadable answer): held, never retried blindly. */
export const TOOL_OUTCOME_UNKNOWN: ToolSnapshot = Object.freeze({ ok: false, code: 'DRIVER_OUTCOME_UNKNOWN', sent: 'UNKNOWN' });

/** A failure the runtime itself decided (e.g. no registered driver). */
export function toolFailureSnapshot(code: string, sent: 'NO' | 'UNKNOWN'): ToolSnapshot {
  return Object.freeze({ ok: false, code: safeCode(code), sent });
}

/** Snapshot of what `driver.invoke` resolved with. */
export function toolAnswerSnapshot(answer: unknown): ToolSnapshot {
  let ok: unknown;
  let result: unknown;
  let code: unknown;
  let sent: unknown;
  try {
    if (typeof answer !== 'object' || answer === null) return TOOL_OUTCOME_UNKNOWN;
    const a = answer as { ok?: unknown; result?: unknown; code?: unknown; sent?: unknown };
    ok = a.ok;
    if (ok === true) {
      result = a.result;
    } else if (ok === false) {
      code = a.code;
      sent = a.sent;
    }
  } catch {
    return TOOL_OUTCOME_UNKNOWN;
  }
  if (ok === true) {
    if (typeof result !== 'object' || result === null) return TOOL_OUTCOME_UNKNOWN;
    return Object.freeze({ ok: true, result: plainResult(result) });
  }
  if (ok === false && typeof code === 'string') return Object.freeze({ ok: false, code: safeCode(code), sent: sent === 'NO' ? 'NO' : 'UNKNOWN' });
  return TOOL_OUTCOME_UNKNOWN;
}

/**
 * The result, serialized ONCE and re-parsed: plain, frozen JSON data whatever the driver handed over (getters,
 * Proxies and prototypes are gone). A result that is not plain JSON is recorded as `{ invalid: true }`
 * everywhere (invocation, step result, model copy) — never recorded one way and returned another (m-19).
 */
function plainResult(result: object): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalJson(result));
  } catch {
    parsed = { invalid: true };
  }
  return deepFreeze(parsed) as JsonObject;
}

/** A driver's failure code enters audit and state only when it is a short code carrying no secret (m-17). */
function safeCode(code: string): string {
  return CODE.test(code) && !containsSecretMaterial(code) ? code : 'DRIVER_FAILURE';
}

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}
