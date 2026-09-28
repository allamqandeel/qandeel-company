/**
 * Deterministic fake provider and fake tool drivers — the only model / tool implementations in C2.
 *
 * They make no network call, spend nothing and read no credential. They exist so every governance
 * path (routing, retry / fallback / escalation, reservation / settlement, authority, approvals,
 * idempotency, reconciliation) is proven in CI without a commercial provider (provider neutrality:
 * no real provider is chosen in C2).
 */
import { ProviderError, type ProviderAdapter, type ProviderFailureClass, type ProviderRequest, type ProviderResponse, type ToolDriver, type ToolDriverInput, type ToolDriverResult } from '@qandeel-company/governance';

/**
 * Scripted fake provider. The user message carries `{ "script": [output, ...] }`; the n-th call of a
 * run (n = number of tool messages already in the context) returns `script[n]` as JSON text. Output
 * entries may be proposals or `{ "fail": "<failure class>" }`. Injected failures per deployment code
 * are consumed first, in order.
 */
export class DeterministicFakeProvider implements ProviderAdapter {
  readonly providerCode: string;
  readonly #failures = new Map<string, { failure: ProviderFailureClass; usage: ProviderError['usage'] }[]>();
  readonly #usageOverride = new Map<string, { inputTokens: number; outputTokens: number }>();
  /** Calls received, by deployment code (idle / fallback proofs). */
  readonly calls = new Map<string, number>();

  constructor(providerCode = 'fake-local') {
    this.providerCode = providerCode;
  }

  get totalCalls(): number {
    return [...this.calls.values()].reduce((a, b) => a + b, 0);
  }

  /** Queue failures for a deployment's next calls. */
  failNext(deploymentCode: string, ...failures: ProviderFailureClass[]): this {
    this.#failures.set(deploymentCode, [...(this.#failures.get(deploymentCode) ?? []), ...failures.map((failure) => ({ failure, usage: null }))]);
    return this;
  }

  /** Queue a failure that still reports (billable) usage for the deployment's next call. */
  failNextCharged(deploymentCode: string, failure: ProviderFailureClass, usage: { inputTokens: number; outputTokens: number }): this {
    this.#failures.set(deploymentCode, [...(this.#failures.get(deploymentCode) ?? []), { failure, usage }]);
    return this;
  }

  /** Report this usage for the deployment's calls (contract-violation proofs). */
  reportUsage(deploymentCode: string, usage: { inputTokens: number; outputTokens: number }): this {
    this.#usageOverride.set(deploymentCode, usage);
    return this;
  }

  async generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    this.calls.set(request.deploymentCode, (this.calls.get(request.deploymentCode) ?? 0) + 1);
    if (signal.aborted) throw new ProviderError('TRANSIENT');
    const queued = this.#failures.get(request.deploymentCode);
    const injected = queued?.shift();
    if (injected) throw new ProviderError(injected.failure, injected.usage);
    const turn = request.messages.filter((m) => m.role === 'tool').length;
    let script: unknown[] = [];
    for (const m of request.messages) {
      if (m.role !== 'user') continue;
      try {
        const parsed = JSON.parse(m.content) as { script?: unknown };
        if (Array.isArray(parsed.script)) script = parsed.script;
      } catch {
        // Plain text instructions: no script.
      }
    }
    const entry = script[turn] ?? { type: 'FINAL', summaryCode: 'fake.done' };
    if (typeof entry === 'object' && entry !== null && 'fail' in entry) throw new ProviderError(String((entry as { fail: unknown }).fail) as ProviderFailureClass);
    const outputText = typeof entry === 'string' ? entry : JSON.stringify(entry);
    const inputBytes = request.messages.reduce((n, m) => n + Buffer.byteLength(m.content, 'utf8'), 0);
    const usage = this.#usageOverride.get(request.deploymentCode) ?? { inputTokens: Math.ceil(inputBytes / 4) + 1, outputTokens: Math.min(request.maxOutputTokens, Math.ceil(Buffer.byteLength(outputText, 'utf8') / 4) + 1) };
    return { outputText, usage };
  }
}

/** Deterministic tool drivers. Each records its invocations so tests can prove it was (not) called. */
export class FakeToolDriver implements ToolDriver {
  readonly driverCode: string;
  readonly invocations: ToolDriverInput[] = [];
  /** Effects applied, keyed by idempotency key: a duplicate key never applies twice. */
  readonly applied = new Map<string, number>();
  #hangNext = false;
  #failNext: ToolDriverResult | null = null;

  constructor(driverCode: string) {
    this.driverCode = driverCode;
  }

  /** The next invocation never answers (timeout / uncertain-outcome proofs). */
  hangNext(): this {
    this.#hangNext = true;
    return this;
  }

  failNext(result: Extract<ToolDriverResult, { ok: false }>): this {
    this.#failNext = result;
    return this;
  }

  async invoke(input: ToolDriverInput, signal: AbortSignal): Promise<ToolDriverResult> {
    this.invocations.push(input);
    if (this.#hangNext) {
      this.#hangNext = false;
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return { ok: false, code: 'ABORTED', sent: 'UNKNOWN' };
    }
    if (this.#failNext) {
      const f = this.#failNext;
      this.#failNext = null;
      return f;
    }
    const seen = this.applied.get(input.idempotencyKey);
    if (seen === undefined) this.applied.set(input.idempotencyKey, this.applied.size + 1);
    return { ok: true, result: { driver: this.driverCode, action: input.actionCode, effect: this.applied.get(input.idempotencyKey) ?? 0, duplicate: seen !== undefined } };
  }
}
