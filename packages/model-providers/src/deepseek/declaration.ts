/**
 * DeepSeek facts pinned for L1-01 (official API documentation, read 2026-10-05; D-L1-03). Everything here is
 * a constant the adapter enforces: one origin, two endpoints, one model alias, one expected public identity,
 * one bounded thinking profile per reasoning class, and conservative Company-side limits.
 */
import type { ReasoningClass } from '@qandeel-company/governance';

export const DEEPSEEK_PROVIDER_CODE = 'deepseek';
/** The fixed HTTPS origin (OpenAI-compatible base); never configurable, never redirected. */
export const DEEPSEEK_API_ORIGIN = 'https://api.deepseek.com';
export const DEEPSEEK_CHAT_COMPLETIONS_PATH = '/chat/completions';
export const DEEPSEEK_MODELS_PATH = '/models';
/** The current official API model id (an alias that names DeepSeek-V4.1-Flash today; `deepseek-v4-flash` is retired). */
export const DEEPSEEK_MODEL_CODE = 'deepseek-flash';
/** The qualified public identity the alias must still name (`name` in GET /models); anything else is alias drift. */
export const DEEPSEEK_EXPECTED_PUBLIC_NAME = 'DeepSeek-V4.1-Flash';
/** The opaque reference the Founder provisions on the host; never a value. */
export const DEEPSEEK_CREDENTIAL_REF = 'vault:deepseek-company';
/** The revision label deployments are pinned to (the alias + the date it was qualified; not a cryptographic pin). */
export const DEEPSEEK_PINNED_REVISION = 'v4.1-flash-alias-2026-09-10';

export const DEEPSEEK_THINKING_EFFORTS = ['none', 'low', 'high', 'max'] as const;
export type DeepSeekThinkingEffort = (typeof DEEPSEEK_THINKING_EFFORTS)[number];

/**
 * E1–E4 → DeepSeek thinking (Founder-approved initial pilot mapping): LIGHT runs without thinking, STANDARD /
 * DEEP / EXTENDED enable thinking at low / high / max effort. E0 is NO_LLM and never reaches an adapter.
 */
export const DEEPSEEK_THINKING_BY_CLASS: Readonly<Record<Exclude<ReasoningClass, 'E0'>, DeepSeekThinkingEffort>> = Object.freeze({ E1: 'none', E2: 'low', E3: 'high', E4: 'max' });

/**
 * Conservative Strong-v1 Company-side limits per class (the provider advertises 1M context / 384K output; the
 * Company exposes a fraction, bounded by its own reservations). Output ceilings bound `max_tokens`.
 */
export const DEEPSEEK_CLASS_LIMITS: Readonly<Record<Exclude<ReasoningClass, 'E0'>, { readonly contextWindowTokens: number; readonly maxOutputTokens: number }>> = Object.freeze({
  E1: { contextWindowTokens: 65_536, maxOutputTokens: 4_096 },
  E2: { contextWindowTokens: 131_072, maxOutputTokens: 16_384 },
  E3: { contextWindowTokens: 131_072, maxOutputTokens: 32_768 },
  E4: { contextWindowTokens: 131_072, maxOutputTokens: 65_536 },
});

/** Bounded response body (the usual answer is a few kilobytes). */
export const DEEPSEEK_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Bounded request body (the Company's context budget keeps real requests far below this). */
export const DEEPSEEK_MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/** The only fields a chat request ever carries (no tools, no temperature, no stream, nothing of the Company). */
export const DEEPSEEK_REQUEST_FIELDS = ['model', 'messages', 'max_tokens', 'stream', 'thinking', 'response_format'] as const;

/** The closed endpoint allowlist of the transport (method + exact path). */
export const DEEPSEEK_ENDPOINTS: readonly { readonly method: 'GET' | 'POST'; readonly path: string }[] = Object.freeze([
  { method: 'POST', path: DEEPSEEK_CHAT_COMPLETIONS_PATH },
  { method: 'GET', path: DEEPSEEK_MODELS_PATH },
]);

export function assertDeepSeekEndpoint(method: string, path: string): void {
  if (!DEEPSEEK_ENDPOINTS.some((e) => e.method === method && e.path === path)) throw new Error(`DeepSeek endpoint not allowed: ${method} ${path.slice(0, 64)}`);
}
