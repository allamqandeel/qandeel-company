/**
 * The DeepSeek transport contract and the deterministic fake for CI. A transport sends one allowlisted request
 * with a bearer it uses for that request only, and answers with a status and a bounded, parsed body — or throws
 * a `DeepSeekTransportFailure` naming only the phase (never provider text, never the bearer).
 */
import { createHash } from 'node:crypto';

import { assertDeepSeekEndpoint } from './declaration.js';

export interface DeepSeekRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  /** The credential for this one request; a transport never logs, stores or returns it. */
  readonly bearer: string;
  readonly body?: unknown;
}

export interface DeepSeekResponse {
  readonly status: number;
  /** The parsed JSON body, or null when it was empty or not JSON (raw text never travels). */
  readonly body: unknown;
  /** True when the body exceeded the bound (it was discarded unread beyond the bound). */
  readonly oversize: boolean;
  /** True when the body was non-empty but not JSON. */
  readonly malformed: boolean;
}

/** Where a transport failure happened: before the request could have left the host, or after it may have. */
export type TransportPhase = 'BEFORE_SEND' | 'AFTER_SEND' | 'TIMEOUT';

export class DeepSeekTransportFailure extends Error {
  readonly phase: TransportPhase;

  constructor(phase: TransportPhase) {
    super(`deepseek transport failure: ${phase}`);
    this.name = 'DeepSeekTransportFailure';
    this.phase = phase;
  }
}

export interface DeepSeekTransport {
  send(request: DeepSeekRequest, signal: AbortSignal): Promise<DeepSeekResponse>;
}

/** What the fake records about a request: everything except the bearer value (its digest only). */
export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly bearerSha256: string;
}

export type FakeAnswer = DeepSeekResponse | { readonly fail: TransportPhase } | { readonly hang: true };

/** Scripted transport for proofs: answers in order, records what was sent (bearer as a digest), never the network. */
export class FakeDeepSeekTransport implements DeepSeekTransport {
  readonly requests: RecordedRequest[] = [];
  readonly #answers: FakeAnswer[] = [];
  #fallback: ((request: DeepSeekRequest) => DeepSeekResponse) | null = null;

  /** Queue answers for the next requests, in order. */
  answer(...answers: FakeAnswer[]): this {
    this.#answers.push(...answers);
    return this;
  }

  /** A computed answer used when the queue is empty. */
  respondWith(fn: (request: DeepSeekRequest) => DeepSeekResponse): this {
    this.#fallback = fn;
    return this;
  }

  async send(request: DeepSeekRequest, signal: AbortSignal): Promise<DeepSeekResponse> {
    assertDeepSeekEndpoint(request.method, request.path);
    this.requests.push({ method: request.method, path: request.path, body: request.body, bearerSha256: createHash('sha256').update(request.bearer).digest('hex') });
    const next = this.#answers.shift();
    if (next === undefined) {
      if (this.#fallback) return this.#fallback(request);
      throw new DeepSeekTransportFailure('BEFORE_SEND');
    }
    if ('hang' in next) {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new DeepSeekTransportFailure('TIMEOUT');
    }
    if ('fail' in next) throw new DeepSeekTransportFailure(next.fail);
    return next;
  }
}

/** A well-formed 200 chat answer for the fake (tests override fields as needed). */
export function fakeChatAnswer(content: string, usage: { prompt: number; completion: number; hit?: number; miss?: number }, extra: Record<string, unknown> = {}): DeepSeekResponse {
  const hit = usage.hit ?? 0;
  const miss = usage.miss ?? usage.prompt - hit;
  return {
    status: 200,
    oversize: false,
    malformed: false,
    body: {
      id: 'fake-completion',
      object: 'chat.completion',
      created: 1_760_000_000,
      model: 'deepseek-flash',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: usage.prompt, completion_tokens: usage.completion, total_tokens: usage.prompt + usage.completion, prompt_cache_hit_tokens: hit, prompt_cache_miss_tokens: miss },
      ...extra,
    },
  };
}

/** A well-formed GET /models answer naming the current alias and public name. */
export function fakeModelsAnswer(models: readonly { id: string; name: string; context_window?: number; max_output_tokens?: number }[]): DeepSeekResponse {
  return { status: 200, oversize: false, malformed: false, body: { object: 'list', data: models.map((m) => ({ object: 'model', owned_by: 'deepseek', ...m })) } };
}
