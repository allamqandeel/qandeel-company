/**
 * The DeepSeek provider adapter (D-L1-03). It turns one bounded `ProviderRequest` into one non-streaming Chat
 * Completions call and returns the provider contract — final assistant `content` plus normalized usage with the
 * cache-hit metering extension — and nothing else: no thinking / chain-of-thought field is ever read into a
 * result, no header, no bearer, no raw body. The credential is resolved privately from the vault for each call.
 * Failures are normalized into the QANDEEL taxonomy; the adapter never retries (retry / fallback belong to the
 * Model Runtime). It has no reference to Company authority, Work, budgets or tools.
 *
 * Alias drift fails closed (D-L1-05): `deepseek-flash` is an alias; before the first call (and after each
 * identity TTL) the adapter asks GET /models what the alias names. If the public name is not the qualified
 * identity, every call fails as MODEL_DEPRECATED (an operational hold of the deployment), never silently
 * served by another model.
 */
import { ProviderError, type ProviderAdapter, type ProviderFailureClass, type ProviderRequest, type ProviderResponse, type ReasoningClass } from '@qandeel-company/governance';
import { VaultError, type SecretVault } from '@qandeel-company/secret-vault';

import { DEEPSEEK_CHAT_COMPLETIONS_PATH, DEEPSEEK_CREDENTIAL_REF, DEEPSEEK_EXPECTED_PUBLIC_NAME, DEEPSEEK_MODELS_PATH, DEEPSEEK_MODEL_CODE, DEEPSEEK_PROVIDER_CODE, DEEPSEEK_REQUEST_FIELDS, DEEPSEEK_THINKING_BY_CLASS, PROBE_MAX_TOKENS, PROBE_THINKING_MAX_TOKENS, type DeepSeekThinkingEffort } from './declaration.js';
import { DeepSeekTransportFailure, type DeepSeekResponse, type DeepSeekTransport } from './transport.js';

export interface DeepSeekAdapterOptions {
  readonly vault: SecretVault;
  readonly transport: DeepSeekTransport;
  readonly credentialRef?: string;
  /** How long a MATCH identity check stays trusted before the alias is re-checked (default one hour). */
  readonly identityTtlMs?: number;
  readonly now?: () => number;
}

/** One chat request body: exactly the allowlisted fields (verifier-checked), nothing of the Company. */
export interface DeepSeekChatBody {
  readonly model: string;
  readonly messages: readonly { readonly role: 'system' | 'user'; readonly content: string }[];
  readonly max_tokens: number;
  readonly stream: false;
  /** Official wire shape: `thinking` carries only the switch; the effort is the TOP-LEVEL `reasoning_effort`. */
  readonly thinking: { readonly type: 'enabled' | 'disabled' };
  readonly reasoning_effort?: Exclude<DeepSeekThinkingEffort, 'none'>;
  readonly response_format: { readonly type: 'json_object' };
}

/**
 * The thinking fields for a reasoning class, in the official request shape (`thinking: { type }` plus a top-level
 * `reasoning_effort`): E1 → `thinking.disabled` and no effort field at all; E2 / E3 / E4 → `thinking.enabled` with
 * `reasoning_effort` low / high / max beside it. Nesting the effort inside `thinking` is the wrong contract (the
 * provider ignores it and thinks at its default effort), which the proofs, a mutation and a verifier rule refuse.
 */
export function thinkingFor(reasoningClass: ReasoningClass): Pick<DeepSeekChatBody, 'thinking' | 'reasoning_effort'> {
  if (reasoningClass === 'E0') throw new ProviderError('INVALID_REQUEST');
  const effort = DEEPSEEK_THINKING_BY_CLASS[reasoningClass];
  return effort === 'none' ? { thinking: { type: 'disabled' } } : { thinking: { type: 'enabled' }, reasoning_effort: effort };
}

/**
 * Maps the provider-neutral request to the chat body. System and user messages keep their roles; a Company
 * `tool` message (a recorded tool result the runtime placed in context) is presented as a user message — the
 * provider's own tool protocol is never used (no `tools`, no tool calls; QANDEEL tools run only in the Tool
 * Executor). The output ceiling bounds `max_tokens`; JSON output mode asks for the one JSON proposal.
 */
export function buildChatBody(request: ProviderRequest): DeepSeekChatBody {
  if (request.providerCode !== DEEPSEEK_PROVIDER_CODE || request.modelCode !== DEEPSEEK_MODEL_CODE) throw new ProviderError('INVALID_REQUEST');
  if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > 393_216) throw new ProviderError('INVALID_REQUEST');
  if (request.messages.length === 0) throw new ProviderError('INVALID_REQUEST');
  const messages = request.messages.map((m) => {
    if (typeof m.content !== 'string') throw new ProviderError('INVALID_REQUEST');
    return { role: m.role === 'system' ? ('system' as const) : ('user' as const), content: m.content };
  });
  const body: DeepSeekChatBody = { model: DEEPSEEK_MODEL_CODE, messages, max_tokens: request.maxOutputTokens, stream: false, ...thinkingFor(request.reasoningClass), response_format: { type: 'json_object' } };
  for (const k of Object.keys(body)) if (!(DEEPSEEK_REQUEST_FIELDS as readonly string[]).includes(k)) throw new ProviderError('INVALID_REQUEST');
  return body;
}

/** HTTP status → QANDEEL failure class (official DeepSeek error codes; others fail closed as UNKNOWN). */
export function failureForStatus(status: number): ProviderFailureClass {
  switch (status) {
    case 400:
    case 422:
      return 'INVALID_REQUEST';
    case 401:
      return 'AUTH';
    case 402:
      return 'BILLING';
    case 429:
      return 'RATE_LIMITED';
    case 500:
      return 'TRANSIENT';
    case 503:
      return 'CAPACITY';
    default:
      return 'UNKNOWN';
  }
}

function tokens(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/** Validated usage from a response body, or null when the body carries no usable usage object. */
function usageOf(body: unknown): { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null | 'INVALID' {
  const u = (body as { usage?: unknown } | null)?.usage;
  if (u === undefined || u === null) return null;
  if (typeof u !== 'object') return 'INVALID';
  const o = u as { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_cache_hit_tokens?: unknown; prompt_cache_miss_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } | null };
  const input = tokens(o.prompt_tokens);
  const output = tokens(o.completion_tokens);
  if (input === null || output === null) return 'INVALID';
  const hit = o.prompt_cache_hit_tokens === undefined ? null : tokens(o.prompt_cache_hit_tokens);
  const miss = o.prompt_cache_miss_tokens === undefined ? null : tokens(o.prompt_cache_miss_tokens);
  if ((o.prompt_cache_hit_tokens !== undefined && hit === null) || (o.prompt_cache_miss_tokens !== undefined && miss === null)) return 'INVALID';
  // Cache hit + miss account for the whole prompt: anything else is an unusable report.
  if (hit !== null && miss !== null && hit + miss !== input) return 'INVALID';
  if (hit !== null && hit > input) return 'INVALID';
  const detail = o.prompt_tokens_details && typeof o.prompt_tokens_details === 'object' ? tokens(o.prompt_tokens_details.cached_tokens) : null;
  const cached = hit ?? detail ?? 0;
  if (cached > input) return 'INVALID';
  return { inputTokens: input, outputTokens: output, cachedInputTokens: cached };
}

/**
 * Reads a chat answer into the provider contract. Only `choices[0].message.content` and `usage` are read; the
 * finish reason classifies a non-answer; the response model must still be the alias. Everything else in the body
 * (including any thinking / reasoning field) is never read.
 */
export function parseChatResponse(res: DeepSeekResponse): ProviderResponse {
  if (res.oversize) throw new ProviderError('CONTRACT_VIOLATION');
  if (res.status !== 200) {
    const u = usageOf(res.body);
    throw new ProviderError(failureForStatus(res.status), u !== null && u !== 'INVALID' ? u : null);
  }
  if (res.malformed || typeof res.body !== 'object' || res.body === null) throw new ProviderError('CONTRACT_VIOLATION');
  const body = res.body as { model?: unknown; choices?: unknown };
  if (body.model !== undefined && body.model !== DEEPSEEK_MODEL_CODE) throw new ProviderError('CONTRACT_VIOLATION');
  const usage = usageOf(res.body);
  if (usage === 'INVALID' || usage === null) throw new ProviderError('CONTRACT_VIOLATION');
  const choice = Array.isArray(body.choices) ? (body.choices[0] as { message?: { content?: unknown } | null; finish_reason?: unknown } | undefined) : undefined;
  if (!choice || typeof choice !== 'object') throw new ProviderError('CONTRACT_VIOLATION', usage);
  switch (choice.finish_reason) {
    case 'content_filter':
      throw new ProviderError('CONTENT_POLICY', usage);
    case 'insufficient_system_resource':
      throw new ProviderError('CAPACITY', usage);
    case 'aborted':
      throw new ProviderError('UNKNOWN', usage);
    case 'tool_calls':
      // The Company sends no tools; a tool call is outside the contract.
      throw new ProviderError('CONTRACT_VIOLATION', usage);
    case 'stop':
    case 'length':
      break;
    default:
      throw new ProviderError('CONTRACT_VIOLATION', usage);
  }
  const content = choice.message?.content;
  // The provider documents occasional empty content in JSON mode: it is the provider's (empty) answer, which the
  // proposal layer refuses as invalid output; a non-string is a broken contract.
  const outputText = typeof content === 'string' ? content : content === null ? '' : undefined;
  if (outputText === undefined) throw new ProviderError('CONTRACT_VIOLATION', usage);
  return { outputText, usage };
}

export type IdentityCheckResult = 'MATCH' | 'DRIFT' | 'MODEL_MISSING' | 'UNREACHABLE' | 'AUTH' | 'BILLING' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'CONTRACT_VIOLATION' | 'CREDENTIAL_UNAVAILABLE';

export interface IdentityCheck {
  readonly result: IdentityCheckResult;
  readonly modelCode: string;
  readonly expectedName: string;
  readonly observedName: string | null;
  readonly observedContextWindow: number | null;
  readonly observedMaxOutputTokens: number | null;
}

/** Reads GET /models into a content-free identity verdict (public name and limits only). */
export function parseModelsResponse(res: DeepSeekResponse): IdentityCheck {
  const base = { modelCode: DEEPSEEK_MODEL_CODE, expectedName: DEEPSEEK_EXPECTED_PUBLIC_NAME, observedName: null, observedContextWindow: null, observedMaxOutputTokens: null };
  if (res.oversize || res.malformed) return { ...base, result: 'CONTRACT_VIOLATION' };
  if (res.status !== 200) {
    const f = failureForStatus(res.status);
    return { ...base, result: f === 'AUTH' ? 'AUTH' : f === 'BILLING' ? 'BILLING' : f === 'RATE_LIMITED' ? 'RATE_LIMITED' : res.status >= 500 ? 'PROVIDER_ERROR' : 'CONTRACT_VIOLATION' };
  }
  const data = (res.body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return { ...base, result: 'CONTRACT_VIOLATION' };
  const m = data.find((x) => typeof x === 'object' && x !== null && (x as { id?: unknown }).id === DEEPSEEK_MODEL_CODE) as { name?: unknown; context_window?: unknown; max_output_tokens?: unknown } | undefined;
  if (!m) return { ...base, result: 'MODEL_MISSING' };
  const name = typeof m.name === 'string' && m.name.length > 0 && m.name.length <= 120 ? m.name : null;
  const observed = { observedName: name, observedContextWindow: tokens(m.context_window), observedMaxOutputTokens: tokens(m.max_output_tokens) };
  if (name === null) return { ...base, ...observed, result: 'CONTRACT_VIOLATION' };
  return { ...base, ...observed, result: name === DEEPSEEK_EXPECTED_PUBLIC_NAME ? 'MATCH' : 'DRIFT' };
}

/** A transport failure → failure class: not sent is transient; a timeout or an unknown phase may have been billed. */
function failureForTransport(error: unknown): ProviderError {
  if (error instanceof DeepSeekTransportFailure) return new ProviderError(error.phase === 'BEFORE_SEND' ? 'TRANSIENT' : error.phase === 'TIMEOUT' ? 'TIMEOUT_AFTER_SEND' : 'UNKNOWN');
  if (error instanceof ProviderError) return error;
  return new ProviderError('UNKNOWN');
}

export class DeepSeekProviderAdapter implements ProviderAdapter {
  readonly providerCode = DEEPSEEK_PROVIDER_CODE;
  readonly #vault: SecretVault;
  readonly #transport: DeepSeekTransport;
  readonly #credentialRef: string;
  readonly #identityTtlMs: number;
  readonly #now: () => number;
  #identityOkUntil = 0;
  #calls = 0;

  constructor(options: DeepSeekAdapterOptions) {
    this.#vault = options.vault;
    this.#transport = options.transport;
    this.#credentialRef = options.credentialRef ?? DEEPSEEK_CREDENTIAL_REF;
    this.#identityTtlMs = options.identityTtlMs ?? 60 * 60_000;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Chat calls this adapter sent (observability for proofs; never content). */
  get calls(): number {
    return this.#calls;
  }

  get credentialRef(): string {
    return this.#credentialRef;
  }

  /** One request with the credential resolved for its duration only. */
  async #send(method: 'GET' | 'POST', path: string, body: unknown, signal: AbortSignal): Promise<DeepSeekResponse> {
    try {
      return await this.#vault.use(this.#credentialRef, (bearer) => this.#transport.send(body === undefined ? { method, path, bearer } : { method, path, bearer, body }, signal));
    } catch (error) {
      if (error instanceof VaultError) throw new ProviderError('AUTH');
      throw failureForTransport(error);
    }
  }

  /** The identity / health check: what the alias names right now (content-free; the operator records it). */
  async checkIdentity(signal: AbortSignal = new AbortController().signal): Promise<IdentityCheck> {
    const base = { modelCode: DEEPSEEK_MODEL_CODE, expectedName: DEEPSEEK_EXPECTED_PUBLIC_NAME, observedName: null, observedContextWindow: null, observedMaxOutputTokens: null };
    let res: DeepSeekResponse;
    try {
      res = await this.#send('GET', DEEPSEEK_MODELS_PATH, undefined, signal);
    } catch (error) {
      if (error instanceof ProviderError && error.failure === 'AUTH' && !(await this.#vault.has(this.#credentialRef).catch(() => false))) return { ...base, result: 'CREDENTIAL_UNAVAILABLE' };
      if (error instanceof ProviderError && error.failure === 'AUTH') return { ...base, result: 'AUTH' };
      return { ...base, result: 'UNREACHABLE' };
    }
    const check = parseModelsResponse(res);
    if (check.result === 'MATCH') this.#identityOkUntil = this.#now() + this.#identityTtlMs;
    return check;
  }

  /**
   * A bounded connectivity probe: one tiny answer; returns metering only (never the text). E1 (the default) is
   * non-thinking at 32 output tokens; a thinking class sends the official thinking fields with a small ceiling that
   * also bounds the thinking tokens (`PROBE_THINKING_MAX_TOKENS`), so a wire-contract check costs a known maximum.
   */
  async probe(signal: AbortSignal = new AbortController().signal, reasoningClass: Exclude<ReasoningClass, 'E0'> = 'E1', maxOutputTokens?: number): Promise<{ usage: ProviderResponse['usage']; outputChars: number; maxOutputTokens: number; finishReason: string | null; reasoningTokens: number | null; latencyMs: number }> {
    // P1-CHAT-OPS-01: an explicit allowance probes a class at a real bound (the chat bound); the default stays tiny.
    const max = maxOutputTokens ?? (reasoningClass === 'E1' ? PROBE_MAX_TOKENS : PROBE_THINKING_MAX_TOKENS);
    const request: ProviderRequest = {
      providerCode: DEEPSEEK_PROVIDER_CODE,
      modelCode: DEEPSEEK_MODEL_CODE,
      deploymentCode: 'probe',
      reasoningClass,
      messages: [{ role: 'user', content: 'Reply with exactly this json object and nothing else: {"ok":true}' }],
      maxOutputTokens: max,
    };
    const started = performance.now();
    const res = await this.#send('POST', DEEPSEEK_CHAT_COMPLETIONS_PATH, buildChatBody(request), signal);
    const latencyMs = Math.round(performance.now() - started);
    const answer = parseChatResponse(res);
    this.#calls++;
    // Metering only: the finish reason and the reasoning-token COUNT (never any reasoning or answer text).
    const body = res.body as { choices?: { finish_reason?: unknown }[]; usage?: { completion_tokens_details?: { reasoning_tokens?: unknown } | null } } | null;
    const finish = body?.choices?.[0]?.finish_reason;
    const reasoning = body?.usage?.completion_tokens_details?.reasoning_tokens;
    return { usage: answer.usage, outputChars: answer.outputText.length, maxOutputTokens: max, finishReason: typeof finish === 'string' ? finish : null, reasoningTokens: typeof reasoning === 'number' && Number.isSafeInteger(reasoning) && reasoning >= 0 ? reasoning : null, latencyMs };
  }

  async generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const body = buildChatBody(request);
    if (this.#now() >= this.#identityOkUntil) {
      const check = await this.checkIdentity(signal);
      if (check.result !== 'MATCH') throw new ProviderError(check.result === 'DRIFT' || check.result === 'MODEL_MISSING' ? 'MODEL_DEPRECATED' : check.result === 'AUTH' || check.result === 'CREDENTIAL_UNAVAILABLE' ? 'AUTH' : check.result === 'BILLING' ? 'BILLING' : check.result === 'RATE_LIMITED' ? 'RATE_LIMITED' : check.result === 'CONTRACT_VIOLATION' ? 'CONTRACT_VIOLATION' : 'TRANSIENT');
    }
    if (signal.aborted) throw new ProviderError('TRANSIENT');
    this.#calls++;
    return parseChatResponse(await this.#send('POST', DEEPSEEK_CHAT_COMPLETIONS_PATH, body, signal));
  }
}
