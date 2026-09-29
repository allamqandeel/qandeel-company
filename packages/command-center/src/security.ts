/**
 * Pure request-boundary policy for the loopback Founder surface (Stage 12 §47–§52, Stage 14).
 *
 * "localhost is not an authorization policy": every request is checked for the exact loopback origin
 * (Host, Origin, Sec-Fetch-Site), every state change for the per-session CSRF secret, and every privileged
 * call for a verified session (done by the storage layer, not here). Nothing in this module touches I/O,
 * so the policy is unit-tested exhaustively.
 */

export const SESSION_COOKIE = 'qandeel_founder';
export const CSRF_COOKIE = 'qandeel_csrf';
export const CSRF_HEADER = 'x-qandeel-founder-csrf';
export const LOOPBACK_HOST = '127.0.0.1';
export const MAX_BODY_BYTES = 64 * 1024;

export interface RequestFacts {
  readonly method: string;
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly secFetchSite: string | undefined;
  readonly contentType: string | undefined;
  readonly cookies: Readonly<Record<string, string>>;
  readonly csrfHeader: string | undefined;
}

export type Gate = { readonly ok: true } | { readonly ok: false; readonly status: 400 | 403 | 415; readonly code: string };

export function allowedHosts(port: number): readonly string[] {
  return [`${LOOPBACK_HOST}:${port}`, `localhost:${port}`];
}

export function allowedOrigins(port: number): readonly string[] {
  return allowedHosts(port).map((h) => `http://${h}`);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (/^[A-Za-z0-9_]{1,32}$/.test(k) && /^[A-Za-z0-9_-]{0,128}$/.test(v)) out[k] = v;
  }
  return out;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The origin gate. Reads need the exact loopback Host (DNS rebinding sends another Host). State changes
 * additionally need an exact same-origin Origin, a same-origin fetch metadata when the browser sends it,
 * a JSON content type and the CSRF header equal to the CSRF cookie (double submit; the session's CSRF
 * secret is verified against its hash by the storage layer).
 */
export function gateRequest(facts: RequestFacts, port: number, options: { csrfExempt?: boolean } = {}): Gate {
  if (facts.host === undefined || !allowedHosts(port).includes(facts.host.toLowerCase())) return { ok: false, status: 403, code: 'HOST_NOT_LOOPBACK' };
  if (facts.secFetchSite !== undefined && facts.secFetchSite !== 'same-origin' && facts.secFetchSite !== 'none') return { ok: false, status: 403, code: 'CROSS_SITE_REQUEST' };
  if (!MUTATING.has(facts.method)) return { ok: true };
  if (facts.origin === undefined || !allowedOrigins(port).includes(facts.origin.toLowerCase())) return { ok: false, status: 403, code: 'ORIGIN_NOT_LOOPBACK' };
  if (facts.contentType === undefined || !/^application\/json(?:\s*;.*)?$/i.test(facts.contentType)) return { ok: false, status: 415, code: 'CONTENT_TYPE' };
  // The launch exchange has no session yet: it is protected by the single-use token, the exact Origin and
  // the fetch metadata; every other state change also needs the session's CSRF secret (double submit).
  if (options.csrfExempt) return { ok: true };
  const csrfCookie = facts.cookies[CSRF_COOKIE];
  if (facts.csrfHeader === undefined || csrfCookie === undefined || facts.csrfHeader !== csrfCookie) return { ok: false, status: 403, code: 'CSRF_MISMATCH' };
  return { ok: true };
}

export const LAUNCH_PATH = '/api/session/launch';

/** Response headers every page and API response carries (CSP keeps the page self-contained: no remote asset). */
export function securityHeaders(nonce: string): Readonly<Record<string, string>> {
  return {
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}

export function csrfCookie(value: string, maxAgeSeconds: number): string {
  return `${CSRF_COOKIE}=${value}; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}

export const clearedCookies = (): readonly string[] => [`${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`, `${CSRF_COOKIE}=; SameSite=Strict; Path=/; Max-Age=0`];

/** HTTP status for a typed refusal; unknown errors are 500 with the code only (content-free). */
export function statusForCode(code: string): number {
  switch (code) {
    case 'FOUNDER_SESSION_INVALID':
      return 401;
    case 'FOUNDER_SURFACE_UNAVAILABLE':
    case 'FOUNDER_ONLY':
    case 'AUTHORITY_DENIED':
    case 'SELF_ESCALATION_REFUSED':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'FOUNDER_CONFIRMATION_REQUIRED':
    case 'INVALID_TRANSITION':
    case 'VERSION_CONFLICT':
    case 'GOAL_INVALID':
    case 'COMMUNICATION_INVALID':
    case 'ORG_NOT_ELIGIBLE':
    case 'EMPLOYEE_NOT_ELIGIBLE':
    case 'BUDGET_MISSING':
    case 'BUDGET_EXHAUSTED':
    case 'DEDUPE_CONFLICT':
    case 'CURRENCY_MISMATCH':
      return 409;
    case 'VALIDATION_FAILED':
      return 400;
    case 'RUNTIME_NOT_READY':
    case 'RUNTIME_STOPPING':
      return 503;
    default:
      return 500;
  }
}
