/**
 * L1-01 DeepSeek adapter proofs (deterministic fake transport; no network, no credential). L1-PROOF: deepseek-adapter
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { ProviderError, actualCost, assertProvisioningProfile, billingBandAt, worstCase, type ProviderRequest } from '@qandeel-company/governance';
import { InMemorySecretVault } from '@qandeel-company/secret-vault';

import {
  DEEPSEEK_API_ORIGIN,
  DEEPSEEK_CHAT_COMPLETIONS_PATH,
  DEEPSEEK_EXPECTED_PUBLIC_NAME,
  DEEPSEEK_FLASH_PRICE_CARD,
  DEEPSEEK_MODELS_PATH,
  DEEPSEEK_MODEL_CODE,
  DEEPSEEK_REQUEST_FIELDS,
  DEEPSEEK_THINKING_BY_CLASS,
  DEEPSEEK_V41_FLASH_PROFILE,
  DeepSeekHttpsTransport,
  DeepSeekProviderAdapter,
  FakeDeepSeekTransport,
  assertDeepSeekEndpoint,
  buildChatBody,
  failureForStatus,
  fakeChatAnswer,
  fakeModelsAnswer,
  parseChatResponse,
  parseModelsResponse,
} from '../src/index.js';

// Secret-shaped for the proofs; matches no real provider key format.
const KEY = 'vault-proof-' + 'Qm4Vb7Xc2Zp9Lk1Rt6Yh3Nd8';
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const signal = (): AbortSignal => new AbortController().signal;
/** The first choice of a fake answer, mutable for the proofs (a missing choice is a test bug, never a silent pass). */
function firstChoice(r: { body: unknown }): { message: Record<string, unknown>; finish_reason: string } {
  const c = (r.body as { choices: { message: Record<string, unknown>; finish_reason: string }[] }).choices[0];
  if (!c) throw new Error('the fake answer has no choice');
  return c;
}
const models = (): ReturnType<typeof fakeModelsAnswer> => fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: DEEPSEEK_EXPECTED_PUBLIC_NAME, context_window: 1_048_576, max_output_tokens: 393_216 }, { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro-0813' }]);
const request = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  providerCode: 'deepseek',
  modelCode: DEEPSEEK_MODEL_CODE,
  deploymentCode: 'deepseek-flash-e1',
  reasoningClass: 'E1',
  messages: [
    { role: 'system', content: 'QANDEEL governed employee run. Propose exactly one next action as JSON.' },
    { role: 'user', content: 'Founder message (QUESTION): ما وضع الإطلاق؟' },
    { role: 'tool', content: '{"action":"notes.append","result":{"ok":true}}' },
  ],
  maxOutputTokens: 512,
  ...over,
});

function adapter(transport: FakeDeepSeekTransport, options: { key?: string | null; now?: () => number; ttl?: number } = {}): DeepSeekProviderAdapter {
  const vault = new InMemorySecretVault();
  if (options.key !== null) vault.set('deepseek-company', options.key ?? KEY);
  return new DeepSeekProviderAdapter({ vault, transport, ...(options.now ? { now: options.now } : {}), ...(options.ttl !== undefined ? { identityTtlMs: options.ttl } : {}) });
}

describe('L1 DeepSeek adapter: the request', () => {
  test('fixed host and path, Bearer only at the transport boundary, the alias model, E1–E4 → none / low / high / max, no tools, the output bound, nothing of the Company', async () => {
    assert.equal(DEEPSEEK_API_ORIGIN, 'https://api.deepseek.com');
    assert.deepEqual(DEEPSEEK_THINKING_BY_CLASS, { E1: 'none', E2: 'low', E3: 'high', E4: 'max' });
    assert.throws(() => assertDeepSeekEndpoint('POST', '/v1/anything'));
    assert.throws(() => assertDeepSeekEndpoint('DELETE', DEEPSEEK_MODELS_PATH));
    const body = buildChatBody(request());
    assert.deepEqual(Object.keys(body).sort(), [...DEEPSEEK_REQUEST_FIELDS].filter((f) => f !== 'reasoning_effort').sort(), 'exactly the allowlisted fields; E1 carries no effort field at all');
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.stream, false);
    assert.equal(body.max_tokens, 512);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal('reasoning_effort' in body, false, 'E1 → thinking disabled and no reasoning_effort (top-level or nested)');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user', 'user'], 'a Company tool result is presented as a user message; the provider tool protocol is never used');
    // The official wire shape (api-docs.deepseek.com/guides/thinking_mode): `thinking: { type: 'enabled' }` plus a
    // TOP-LEVEL `reasoning_effort`; the effort is never nested inside `thinking` (the provider would ignore it).
    for (const [cls, effort] of [['E2', 'low'], ['E3', 'high'], ['E4', 'max']] as const) {
      const wire = JSON.parse(JSON.stringify(buildChatBody(request({ reasoningClass: cls })))) as Record<string, unknown>;
      assert.deepEqual(Object.keys(wire).sort(), [...DEEPSEEK_REQUEST_FIELDS].sort(), `${cls}: exactly the allowlisted fields, effort included`);
      assert.deepEqual(wire.thinking, { type: 'enabled' }, `${cls}: thinking carries only the switch`);
      assert.equal(wire.reasoning_effort, effort, `${cls}: top-level reasoning_effort = ${effort}`);
    }
    assert.throws(() => buildChatBody(request({ reasoningClass: 'E0' })), (e) => e instanceof ProviderError && e.failure === 'INVALID_REQUEST');
    assert.throws(() => buildChatBody(request({ modelCode: 'deepseek-v4-flash' })), (e) => e instanceof ProviderError && e.failure === 'INVALID_REQUEST', 'the retired alias is never sent');
    assert.throws(() => buildChatBody(request({ maxOutputTokens: 0 })), (e) => e instanceof ProviderError && e.failure === 'INVALID_REQUEST');
    assert.ok(!JSON.stringify(body).includes('vault:') && !JSON.stringify(body).includes(KEY), 'no credential, grant or budget in the body');
    // Through the adapter: the bearer resolved from the vault reaches only the transport, for that request.
    const t = new FakeDeepSeekTransport().answer(models(), fakeChatAnswer('{"type":"FINAL","summaryCode":"ok"}', { prompt: 120, completion: 9, hit: 64 }));
    const a = adapter(t);
    const out = await a.generate(request(), signal());
    assert.deepEqual(t.requests.map((r) => `${r.method} ${r.path}`), [`GET ${DEEPSEEK_MODELS_PATH}`, `POST ${DEEPSEEK_CHAT_COMPLETIONS_PATH}`], 'identity first, then the call');
    assert.ok(t.requests.every((r) => r.bearerSha256 === sha(KEY)), 'the vault value is the bearer');
    assert.equal(JSON.stringify(t.requests[1]?.body).includes('deployment'), false, 'the ProviderRequest itself never travels');
    assert.deepEqual(out, { outputText: '{"type":"FINAL","summaryCode":"ok"}', usage: { inputTokens: 120, outputTokens: 9, cachedInputTokens: 64 } });
    assert.equal(a.calls, 1);
  });

  test('the HTTPS transport talks to the fixed origin only, never follows a redirect, refuses a path outside the allowlist before any fetch and never surfaces raw text', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{"object":"list","data":[]}', { status: 200 });
    }) as typeof fetch;
    try {
      const t = new DeepSeekHttpsTransport();
      await assert.rejects(t.send({ method: 'GET', path: '/evil', bearer: KEY }, signal()));
      assert.equal(calls.length, 0, 'refused before the network');
      const r = await t.send({ method: 'GET', path: DEEPSEEK_MODELS_PATH, bearer: KEY }, signal());
      assert.equal(calls[0]?.url, `${DEEPSEEK_API_ORIGIN}${DEEPSEEK_MODELS_PATH}`);
      assert.equal(calls[0]?.init.redirect, 'error');
      assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
      assert.deepEqual(r, { status: 200, body: { object: 'list', data: [] }, oversize: false, malformed: false });
      globalThis.fetch = (async () => new Response('<html>not json</html>', { status: 200 })) as typeof fetch;
      const bad = await t.send({ method: 'GET', path: DEEPSEEK_MODELS_PATH, bearer: KEY }, signal());
      assert.deepEqual(bad, { status: 200, body: null, oversize: false, malformed: true }, 'raw text never leaves the transport');
      globalThis.fetch = (async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 })) as typeof fetch;
      const big = await t.send({ method: 'GET', path: DEEPSEEK_MODELS_PATH, bearer: KEY }, signal());
      assert.equal(big.oversize, true);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('L1 DeepSeek adapter: the response', () => {
  test('final content and validated usage only; cache hit + miss must sum to the prompt; thinking fields are never read; malformed usage / content / model is a contract violation; raw bodies never leak', async () => {
    const withThinking = fakeChatAnswer('{"type":"FINAL","summaryCode":"ok"}', { prompt: 50, completion: 40, hit: 0 });
    firstChoice(withThinking).message['reasoning_' + 'content'] = 'private chain of thought';
    (withThinking.body as { usage: Record<string, unknown> }).usage.completion_tokens_details = { reasoning_tokens: 30 };
    const out = parseChatResponse(withThinking);
    assert.equal(out.outputText, '{"type":"FINAL","summaryCode":"ok"}');
    assert.ok(!JSON.stringify(out).includes('chain of thought'), 'no thinking field reaches the result');
    assert.deepEqual(out.usage, { inputTokens: 50, outputTokens: 40, cachedInputTokens: 0 }, 'completion tokens are billed as a whole (reasoning included)');
    const inconsistent = fakeChatAnswer('{}', { prompt: 50, completion: 1, hit: 30, miss: 30 });
    assert.throws(() => parseChatResponse(inconsistent), (e) => e instanceof ProviderError && e.failure === 'CONTRACT_VIOLATION');
    const noUsage = fakeChatAnswer('{}', { prompt: 1, completion: 1 });
    delete (noUsage.body as { usage?: unknown }).usage;
    assert.throws(() => parseChatResponse(noUsage), (e) => e instanceof ProviderError && e.failure === 'CONTRACT_VIOLATION');
    const otherModel = fakeChatAnswer('{}', { prompt: 1, completion: 1 }, { model: 'deepseek-v4-pro' });
    assert.throws(() => parseChatResponse(otherModel), (e) => e instanceof ProviderError && e.failure === 'CONTRACT_VIOLATION', 'an answer from another model than the alias breaks the contract');
    const objectContent = fakeChatAnswer('{}', { prompt: 1, completion: 1 });
    firstChoice(objectContent).message.content = { nested: true };
    assert.throws(() => parseChatResponse(objectContent), (e) => e instanceof ProviderError && e.failure === 'CONTRACT_VIOLATION');
    const empty = fakeChatAnswer('', { prompt: 7, completion: 0 });
    assert.equal(parseChatResponse(empty).outputText, '', 'the documented occasional empty answer is the provider\'s answer (the proposal layer refuses it)');
    const filtered = fakeChatAnswer('', { prompt: 7, completion: 2 });
    firstChoice(filtered).finish_reason = 'content_filter';
    assert.throws(() => parseChatResponse(filtered), (e) => e instanceof ProviderError && e.failure === 'CONTENT_POLICY' && e.usage?.inputTokens === 7);
    const toolCall = fakeChatAnswer('', { prompt: 7, completion: 2 });
    firstChoice(toolCall).finish_reason = 'tool_calls';
    assert.throws(() => parseChatResponse(toolCall), (e) => e instanceof ProviderError && e.failure === 'CONTRACT_VIOLATION', 'the Company sent no tools');
    assert.throws(() => parseChatResponse({ status: 200, body: null, oversize: false, malformed: true }), (e) => e instanceof ProviderError && e.failure === 'CONTRACT_VIOLATION');
    assert.throws(() => parseChatResponse({ status: 200, body: null, oversize: true, malformed: false }), (e) => e instanceof ProviderError && e.failure === 'CONTRACT_VIOLATION');
    for (const e of [inconsistent, otherModel, filtered]) {
      try {
        parseChatResponse(e);
      } catch (error) {
        assert.ok(!String((error as Error).message).includes('deepseek-v4-pro') && !JSON.stringify(error).includes('choices'), 'no raw body in an error');
      }
    }
  });

  test('errors: 400 / 422 invalid, 401 auth hold, 402 billing hold, 429 rate limited, 500 transient, 503 capacity, timeout after send, connection failure before send, unknown status', async () => {
    assert.equal(failureForStatus(400), 'INVALID_REQUEST');
    assert.equal(failureForStatus(422), 'INVALID_REQUEST');
    assert.equal(failureForStatus(401), 'AUTH');
    assert.equal(failureForStatus(402), 'BILLING');
    assert.equal(failureForStatus(429), 'RATE_LIMITED');
    assert.equal(failureForStatus(500), 'TRANSIENT');
    assert.equal(failureForStatus(503), 'CAPACITY');
    assert.equal(failureForStatus(502), 'UNKNOWN');
    const bodyOf = (status: number): ReturnType<typeof fakeChatAnswer> => ({ status, body: { error: { message: 'Authentication Fails', type: 'authentication_error' } }, oversize: false, malformed: false });
    for (const [status, failure] of [[401, 'AUTH'], [402, 'BILLING'], [429, 'RATE_LIMITED'], [500, 'TRANSIENT'], [503, 'CAPACITY'], [400, 'INVALID_REQUEST']] as const) {
      const t = new FakeDeepSeekTransport().answer(models(), bodyOf(status));
      await assert.rejects(adapter(t).generate(request(), signal()), (e) => e instanceof ProviderError && e.failure === failure && !e.message.includes('Authentication'), `${status} → ${failure}`);
    }
    const timeout = new FakeDeepSeekTransport().answer(models(), { fail: 'TIMEOUT' });
    await assert.rejects(adapter(timeout).generate(request(), signal()), (e) => e instanceof ProviderError && e.failure === 'TIMEOUT_AFTER_SEND');
    const hang = new FakeDeepSeekTransport().answer(models(), { hang: true });
    const c = new AbortController();
    const pending = adapter(hang).generate(request(), c.signal);
    while (hang.requests.length < 2) await new Promise((r) => setTimeout(r, 5));
    c.abort();
    await assert.rejects(pending, (e) => e instanceof ProviderError && e.failure === 'TIMEOUT_AFTER_SEND', 'an abort after send may have been billed');
    const aborted = new FakeDeepSeekTransport().answer(models(), fakeChatAnswer('{}', { prompt: 1, completion: 1 }));
    const gone = new AbortController();
    gone.abort();
    await assert.rejects(adapter(aborted).generate(request(), gone.signal), (e) => e instanceof ProviderError && e.failure === 'TRANSIENT', 'aborted before send: not sent');
    const refused = new FakeDeepSeekTransport().answer(models(), { fail: 'BEFORE_SEND' });
    await assert.rejects(adapter(refused).generate(request(), signal()), (e) => e instanceof ProviderError && e.failure === 'TRANSIENT', 'a connection failure never left the host');
    const reset = new FakeDeepSeekTransport().answer(models(), { fail: 'AFTER_SEND' });
    await assert.rejects(adapter(reset).generate(request(), signal()), (e) => e instanceof ProviderError && e.failure === 'UNKNOWN', 'a failure after send is held, never retried blindly');
    const missingKey = new FakeDeepSeekTransport().answer(models());
    await assert.rejects(adapter(missingKey, { key: null }).generate(request(), signal()), (e) => e instanceof ProviderError && e.failure === 'AUTH', 'no credential in the vault is an operational hold');
    assert.equal(missingKey.requests.length, 0, 'nothing is sent without a credential');
  });
});

describe('L1 DeepSeek adapter: alias drift and identity', () => {
  test('the alias must still name the qualified public identity: a changed name holds the deployment (MODEL_DEPRECATED) and nothing is sent; a MATCH is re-checked after its TTL', async () => {
    assert.equal(parseModelsResponse(models()).result, 'MATCH');
    assert.equal(parseModelsResponse(fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: 'DeepSeek-V5-Flash' }])).result, 'DRIFT');
    assert.equal(parseModelsResponse(fakeModelsAnswer([{ id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro-0813' }])).result, 'MODEL_MISSING');
    assert.equal(parseModelsResponse({ status: 401, body: {}, oversize: false, malformed: false }).result, 'AUTH');
    assert.equal(parseModelsResponse({ status: 503, body: {}, oversize: false, malformed: false }).result, 'PROVIDER_ERROR');
    assert.equal(parseModelsResponse({ status: 200, body: { data: 'nope' }, oversize: false, malformed: false }).result, 'CONTRACT_VIOLATION');
    const drifted = new FakeDeepSeekTransport().answer(fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: 'DeepSeek-V5-Flash' }]));
    await assert.rejects(adapter(drifted).generate(request(), signal()), (e) => e instanceof ProviderError && e.failure === 'MODEL_DEPRECATED');
    assert.equal(drifted.requests.length, 1, 'only the identity check was sent; no chat call to an unqualified model');
    let now = 1_000;
    const t = new FakeDeepSeekTransport().answer(models(), fakeChatAnswer('{}', { prompt: 1, completion: 1 }), fakeChatAnswer('{}', { prompt: 1, completion: 1 }), models(), fakeChatAnswer('{}', { prompt: 1, completion: 1 }));
    const a = adapter(t, { now: () => now, ttl: 500 });
    await a.generate(request(), signal());
    await a.generate(request(), signal());
    assert.deepEqual(t.requests.map((r) => r.path), [DEEPSEEK_MODELS_PATH, DEEPSEEK_CHAT_COMPLETIONS_PATH, DEEPSEEK_CHAT_COMPLETIONS_PATH], 'one identity check inside the TTL');
    now += 600;
    await a.generate(request(), signal());
    assert.equal(t.requests.filter((r) => r.path === DEEPSEEK_MODELS_PATH).length, 2, 're-checked after the TTL');
    const check = await a.checkIdentity(signal());
    assert.equal(check.result, 'UNREACHABLE', 'an exhausted fake answers nothing');
    const noKey = adapter(new FakeDeepSeekTransport(), { key: null });
    assert.equal((await noKey.checkIdentity(signal())).result, 'CREDENTIAL_UNAVAILABLE');
  });

  test('the probe is one tiny non-thinking JSON answer and returns metering only', async () => {
    const t = new FakeDeepSeekTransport().answer(fakeChatAnswer('{"ok":true}', { prompt: 20, completion: 5 }));
    const r = await adapter(t).probe(signal());
    assert.deepEqual({ ...r, latencyMs: 0 }, { usage: { inputTokens: 20, outputTokens: 5, cachedInputTokens: 0 }, outputChars: 11, maxOutputTokens: 32, finishReason: 'stop', reasoningTokens: null, latencyMs: 0 });
    assert.deepEqual((t.requests[0]?.body as { thinking: unknown; max_tokens: number }).thinking, { type: 'disabled' });
    assert.equal('reasoning_effort' in (t.requests[0]?.body as object), false);
    assert.equal((t.requests[0]?.body as { max_tokens: number }).max_tokens, 32);
  });

  test('a thinking-class probe sends the official thinking fields (thinking.enabled + top-level reasoning_effort) under a small ceiling', async () => {
    const t = new FakeDeepSeekTransport().answer(fakeChatAnswer('{"ok":true}', { prompt: 20, completion: 9 }));
    const r = await adapter(t).probe(signal(), 'E2');
    assert.deepEqual({ ...r, latencyMs: 0 }, { usage: { inputTokens: 20, outputTokens: 9, cachedInputTokens: 0 }, outputChars: 11, maxOutputTokens: 1024, finishReason: 'stop', reasoningTokens: null, latencyMs: 0 });
    const wire = JSON.parse(JSON.stringify(t.requests[0]?.body)) as Record<string, unknown>;
    assert.deepEqual(wire.thinking, { type: 'enabled' });
    assert.equal(wire.reasoning_effort, 'low');
    assert.equal(wire.max_tokens, 1024);
  });

  test('P1-CHAT-OPS-01: a probe at an explicit bound (the chat bound) reports the finish reason, the reasoning-token count and the latency, never text', async () => {
    const t = new FakeDeepSeekTransport().answer(
      fakeChatAnswer('', { prompt: 20, completion: 8192 }, {
        choices: [{ index: 0, message: { role: 'assistant', content: '', reasoning_content: 'private reasoning' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 20, completion_tokens: 8192, total_tokens: 8212, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 20, completion_tokens_details: { reasoning_tokens: 8192 } },
      }),
    );
    const r = await adapter(t).probe(signal(), 'E4', 8192);
    assert.deepEqual([r.maxOutputTokens, r.finishReason, r.reasoningTokens, r.outputChars, r.usage.outputTokens], [8192, 'length', 8192, 0, 8192]);
    assert.ok(Number.isInteger(r.latencyMs) && r.latencyMs >= 0);
    assert.equal(JSON.stringify(r).includes('private reasoning'), false, 'no reasoning text is ever returned');
    const wire = t.requests[0]?.body as { max_tokens: number; reasoning_effort: string };
    assert.deepEqual([wire.max_tokens, wire.reasoning_effort], [8192, 'max']);
  });
});

describe('L1 DeepSeek pricing basis and profile', () => {
  test('the release-pinned profile validates; reservation is peak + all cache miss + the output ceiling; actual billing honours cache hits, off-peak hours, weekends and holidays; E1–E4 deployments carry the pilot limits', () => {
    const profile = assertProvisioningProfile(DEEPSEEK_V41_FLASH_PROFILE);
    assert.equal(profile.provider.credentialRef, 'vault:deepseek-company');
    assert.deepEqual(profile.deployments.map((d) => [d.code, d.reasoningClass, d.maxOutputTokens]), [['deepseek-flash-e1', 'E1', 4_096], ['deepseek-flash-e2', 'E2', 16_384], ['deepseek-flash-e3', 'E3', 32_768], ['deepseek-flash-e4', 'E4', 65_536]]);
    assert.equal(profile.egressMaxDataClass, 'D2');
    assert.equal(profile.qualificationTarget, 'LIMITED_PRODUCTION');
    const card = { id: 'c', version: 1, ...DEEPSEEK_FLASH_PRICE_CARD };
    // Worst case: 1M input + 1M output at peak cache-miss rates = $0.30 + $1.20.
    const w = worstCase(card, 1_000_000, 1_000_000);
    assert.equal(w.billedMicros, 1_500_000);
    assert.equal(w.economicMicros, 1_500_000);
    // Tuesday 2026-10-13 02:00 UTC is peak; all cache hits bill at the cached rate.
    const peakHit = actualCost(card, { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000 }, '2026-10-13T02:00:00.000Z');
    assert.deepEqual([peakHit.band, peakHit.billedMicros], ['PEAK', 6_000]);
    // Tuesday 2026-10-13 05:30 UTC is between the peak windows → off-peak at half rates.
    const offPeak = actualCost(card, { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0 }, '2026-10-13T05:30:00.000Z');
    assert.deepEqual([offPeak.band, offPeak.billedMicros, offPeak.economicMicros], ['OFF_PEAK', 750_000, 1_500_000], 'economic stays the governed flat cost');
    // Saturday → off-peak; the 2026 National Day holiday (a Thursday at 08:00 UTC) → off-peak.
    assert.equal(billingBandAt(card, '2026-10-17T08:00:00.000Z'), 'OFF_PEAK');
    assert.equal(billingBandAt(card, '2026-10-01T08:00:00.000Z'), 'OFF_PEAK');
    assert.equal(billingBandAt(card, '2026-10-08T08:00:00.000Z'), 'PEAK', 'the first working day after the holiday is peak again');
    // Window boundaries: 01:00 is in, 04:00 is out, 06:00 is in, 10:00 is out (UTC).
    assert.deepEqual(['2026-10-13T01:00:00.000Z', '2026-10-13T03:59:59.000Z', '2026-10-13T04:00:00.000Z', '2026-10-13T06:00:00.000Z', '2026-10-13T09:59:59.000Z', '2026-10-13T10:00:00.000Z'].map((t) => billingBandAt(card, t)), ['PEAK', 'PEAK', 'OFF_PEAK', 'PEAK', 'PEAK', 'OFF_PEAK']);
    assert.ok(JSON.stringify(DEEPSEEK_V41_FLASH_PROFILE).includes('https://api-docs.deepseek.com/quick_start/pricing'), 'the basis source is recorded');
  });
});
