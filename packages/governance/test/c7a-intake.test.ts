/**
 * C7-A intake kernel proofs — allowlist-first, content-free normalization of operational facts and external outcome
 * observations; refusal by reason code without echoing content; provider-neutral contracts; forward-only source
 * lifecycle; the operational-fact ≠ outcome-evidence role matrix. Pure: no I/O. C7A-PROOF: intake-kernel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Timestamp } from '@qandeel-company/domain';

import {
  EXTERNAL_CONTRACTS,
  OPERATIONAL_DOMAINS,
  OUTCOME_FAMILIES,
  assertSourceRegistration,
  bindableRole,
  contractOf,
  forbiddenKeyClass,
  nextSourceState,
  normalizeOccurrence,
} from '../src/index.js';

const NOW = '2026-09-26T12:00:00.000Z' as Timestamp;
const OPS = { family: 'APP_OPERATIONS' as const, contractCode: 'ops.events', contractVersion: 1 };
const WEB = { family: 'WEB_ANALYTICS' as const, contractCode: 'outcome.metrics', contractVersion: 1 };
const refused = (reason: string) => (e: unknown): boolean => isQandeelError(e, 'INTAKE_REJECTED') && e.details.reason === reason;

const op = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({ sourceKey: 'app-operations.production', contractCode: 'ops.events', contractVersion: 1, producerEventId: 'evt-1', type: 'service.health', occurredAt: '2026-09-26T11:00:00.000Z', fields: { service: 'voice-api', state: 'DEGRADED' }, ...patch });
const web = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  sourceKey: 'web-analytics.main', contractCode: 'outcome.metrics', contractVersion: 1, producerEventId: 'obs-1', type: 'web.conversions', occurredAt: '2026-09-26T11:00:00.000Z',
  scope: { kind: 'SITE', ref: 'qandeel-site' }, window: { from: '2026-09-19T00:00:00.000Z', to: '2026-09-26T00:00:00.000Z' }, fields: { value: 42 }, ...patch,
});

describe('C7-A intake kernel: allowlist first, content never echoed', () => {
  test('a valid operational fact normalizes to declared scalars, its domain and a failure signal; no scope, value or window', () => {
    const n = normalizeOccurrence(op(), OPS, NOW);
    assert.deepEqual([n.lane, n.domain, n.type, n.failureSignal, n.userScoped, n.scope, n.value, n.window], ['OPERATIONAL_EVENT', 'SERVICE_HEALTH', 'service.health', true, false, null, null, null]);
    assert.deepEqual(n.fields, { service: 'voice-api', state: 'DEGRADED' });
    assert.equal(normalizeOccurrence(op({ fields: { service: 'voice-api', state: 'UP' } }), OPS, NOW).failureSignal, false);
    assert.equal(normalizeOccurrence(op({ type: 'app.crash', fields: { errorClass: 'NULL_POINTER', release: '2.4.1', platform: 'ANDROID', count: 3 } }), OPS, NOW).failureSignal, true);
  });

  test('a valid outcome observation keeps its metric, family, contract-fixed unit, scope, window and value — never a producer-chosen unit', () => {
    const n = normalizeOccurrence(web(), WEB, NOW);
    assert.deepEqual([n.lane, n.domain, n.unit, n.value, n.scope, n.window?.to], ['EXTERNAL_OUTCOME', 'WEB_ANALYTICS', 'COUNT', 42, { kind: 'SITE', ref: 'qandeel-site' }, '2026-09-26T00:00:00.000Z']);
    assert.throws(() => normalizeOccurrence(web({ fields: { value: 42, unit: 'PERCENT' } }), WEB, NOW), refused('UNKNOWN_FIELD'));
    assert.throws(() => normalizeOccurrence(web({ fields: { value: 4.5 } }), WEB, NOW), refused('INVALID_FIELD'), 'a count is an integer');
    assert.throws(() => normalizeOccurrence(web({ type: 'web.conversion_rate', fields: { value: 1.5 } }), WEB, NOW), refused('INVALID_FIELD'), 'a ratio is within [0, 1]');
    assert.throws(() => normalizeOccurrence(web({ type: 'search.clicks' }), WEB, NOW), refused('NOT_ALLOWED_FOR_SOURCE'), 'a web source cannot report search metrics');
    assert.throws(() => normalizeOccurrence(web({ window: undefined }), WEB, NOW), refused('MISSING_FIELD'));
    assert.throws(() => normalizeOccurrence(web({ window: { from: '2026-09-26T00:00:00.000Z', to: '2026-09-19T00:00:00.000Z' } }), WEB, NOW), refused('INVALID_WINDOW'));
    assert.throws(() => normalizeOccurrence(web({ scope: { kind: 'STORE_LISTING', ref: 'x' } }), WEB, NOW), refused('INVALID_FIELD'));
    assert.throws(() => normalizeOccurrence(web({ type: 'business.revenue', scope: { kind: 'APP', ref: 'qandeel' } }), { ...WEB, family: 'BUSINESS' }, NOW), refused('MISSING_FIELD'), 'money states its currency');
  });

  test('private content, credentials, raw payloads and free-form bags are refused by name — at any depth — before the allowlist', () => {
    const cases: [Record<string, unknown>, string][] = [
      [op({ message: 'x' }), 'PRIVATE_CONTENT_FIELD'],
      [op({ fields: { service: 'voice-api', state: 'DOWN', conversationText: 'x' } }), 'PRIVATE_CONTENT_FIELD'],
      [op({ transcript: 'x' }), 'PRIVATE_CONTENT_FIELD'],
      [op({ audioUrl: 'x' }), 'PRIVATE_CONTENT_FIELD'],
      [op({ prompt: 'x' }), 'PRIVATE_CONTENT_FIELD'],
      [op({ completion: 'x' }), 'PRIVATE_CONTENT_FIELD'],
      [op({ fields: { service: 'voice-api', state: 'DOWN', modelResponse: 'x' } }), 'PRIVATE_CONTENT_FIELD'],
      [op({ memoryContent: 'x' }), 'PRIVATE_CONTENT_FIELD'],
      [op({ qandeelUnderstanding: 'x' }), 'PRIVATE_CONTENT_FIELD'],
      [op({ privateWorld: 'x' }), 'PRIVATE_CONTENT_FIELD'],
      [op({ userEmail: 'x' }), 'PRIVATE_CONTENT_FIELD'],
      [op({ password: 'x' }), 'CREDENTIAL_FIELD'],
      [op({ Authorization: 'x' }), 'CREDENTIAL_FIELD'],
      [op({ session_cookie: 'x' }), 'CREDENTIAL_FIELD'],
      [op({ requestBody: 'x' }), 'RAW_PAYLOAD_FIELD'],
      [op({ rawEvent: 'x' }), 'RAW_PAYLOAD_FIELD'],
      [op({ exception: 'x' }), 'RAW_PAYLOAD_FIELD'],
      [op({ attributes: { a: 1 } }), 'FREE_FORM_BAG'],
      [op({ context: { a: 1 } }), 'FREE_FORM_BAG'],
      [op({ fields: { service: 'voice-api', state: 'DOWN', dimensions: { a: 'b' } } }), 'FREE_FORM_BAG'],
      [op({ fields: { service: 'voice-api', state: 'DOWN', extra: 1 } }), 'FREE_FORM_BAG'],
      [web({ scope: { kind: 'SITE', ref: 'qandeel-site', tags: { a: 'b' } } }), 'FREE_FORM_BAG'],
    ];
    for (const [raw, reason] of cases) assert.throws(() => normalizeOccurrence(raw, raw.contractCode === 'ops.events' ? OPS : WEB, NOW), refused(reason), JSON.stringify(Object.keys(raw)));
  });

  test('unknown fields, arrays, free text and secret-shaped values never pass; refusals name only DECLARED fields', () => {
    // Built at run time so no secret-shaped literal sits in the repository (verifier rule no-plaintext-secrets).
    const secretLike = ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', ['sk', 'live', 'a'.repeat(24)].join('-'), `gh${'p'}_${'a'.repeat(36)}`, `AK${'IA'}${'B'.repeat(16)}`, 'Bearer.x', ['xoxb', '1'.repeat(12)].join('-'), `AI${'za'}${'c'.repeat(35)}`];
    for (const s of secretLike) assert.throws(() => normalizeOccurrence(op({ fields: { service: s, state: 'DOWN' } }), OPS, NOW), refused('CREDENTIAL_VALUE'), s);
    assert.throws(() => normalizeOccurrence(op({ fields: { service: 'voice api', state: 'DOWN' } }), OPS, NOW), refused('FREE_TEXT_VALUE'));
    assert.throws(() => normalizeOccurrence(op({ type: 'app.error', fields: { errorCode: 'Could not load the user message', component: 'chat', count: 1 } }), OPS, NOW), refused('FREE_TEXT_VALUE'), 'raw error text never becomes telemetry');
    assert.throws(() => normalizeOccurrence(op({ type: 'app.error', fields: { errorCode: 'could_not_load', component: 'chat', count: 1 } }), OPS, NOW), refused('INVALID_FIELD'), 'an error is a bounded upper-case code');
    assert.throws(() => normalizeOccurrence(op({ fields: { service: ['voice-api'], state: 'DOWN' } }), OPS, NOW), refused('ARRAY_NOT_ALLOWED'));
    let error: unknown;
    try {
      normalizeOccurrence(op({ fields: { service: 'voice-api', state: 'DOWN', 'my private note about a user': 1 } }), OPS, NOW);
    } catch (e) {
      error = e;
    }
    assert.ok(refused('PRIVATE_CONTENT_FIELD')(error) || refused('UNKNOWN_FIELD')(error));
    assert.ok(!JSON.stringify((error as { details: unknown }).details).includes('private note') && !String((error as Error).message).includes('private note'), 'an unknown key (possibly content) is never echoed');
    const big = 'a'.repeat(300);
    assert.throws(() => normalizeOccurrence(op({ producerEventId: big }), OPS, NOW), refused('TOO_LARGE'));
    assert.throws(() => normalizeOccurrence(op({ fields: { service: 'voice-api', state: 'DOWN', a: { b: { c: { d: 1 } } } } }), OPS, NOW), (e) => isQandeelError(e, 'INTAKE_REJECTED'));
    assert.throws(() => normalizeOccurrence('not an object', OPS, NOW), refused('NOT_AN_OBJECT'));
    assert.throws(() => normalizeOccurrence(op({ type: 'service.unknown' }), OPS, NOW), refused('UNKNOWN_TYPE'));
    assert.throws(() => normalizeOccurrence(op({ contractVersion: 2 }), OPS, NOW), refused('UNKNOWN_CONTRACT'));
    assert.throws(() => normalizeOccurrence(op(), WEB, NOW), refused('CONTRACT_MISMATCH'));
    assert.throws(() => normalizeOccurrence(op({ occurredAt: '2026-09-26T12:10:00.000Z' }), OPS, NOW), refused('OCCURRED_IN_FUTURE'));
    assert.throws(() => normalizeOccurrence(op({ occurredAt: 'yesterday' }), OPS, NOW), refused('INVALID_TIME'));
    assert.throws(() => normalizeOccurrence(op({ fields: { service: 'voice-api' } }), OPS, NOW), (e) => refused('MISSING_FIELD')(e) && (e as { details: { field: string } }).details.field === 'state');
  });

  test('a user-scoped diagnostic carries only a pseudonym, used for identity and never kept in the normalized fields', () => {
    const p = 'ab'.repeat(32);
    const n = normalizeOccurrence(op({ type: 'user.diagnostic', fields: { userPseudonym: p, code: 'NETWORK_TIMEOUT', state: 'FAILED' } }), OPS, NOW);
    assert.equal(n.userScoped, true);
    assert.deepEqual(n.fields, { code: 'NETWORK_TIMEOUT', state: 'FAILED' });
    assert.ok(JSON.stringify(n.identity).includes(p), 'identity (hashed by storage) distinguishes users');
    assert.throws(() => normalizeOccurrence(op({ type: 'user.diagnostic', fields: { userPseudonym: 'user-42', code: 'X', state: 'FAILED' } }), OPS, NOW), refused('INVALID_FIELD'), 'a raw user id is not a pseudonym');
  });
});

describe('C7-A contracts: the frozen App operational domains, provider-neutral outcome families, governed lifecycle', () => {
  test('every frozen App → Company operational domain and every outcome family is representable; no contract names a provider', () => {
    const events = EXTERNAL_CONTRACTS.flatMap((c) => c.eventTypes);
    for (const d of OPERATIONAL_DOMAINS) assert.ok(events.some((e) => e.domain === d), d);
    const metrics = EXTERNAL_CONTRACTS.flatMap((c) => c.metrics);
    for (const f of OUTCOME_FAMILIES) assert.ok(metrics.some((m) => m.family === f), f);
    const names = JSON.stringify(EXTERNAL_CONTRACTS.map((c) => [c.code, c.eventTypes.map((e) => e.type), c.metrics.map((m) => m.metric)]));
    assert.doesNotMatch(names, /google|meta|facebook|instagram|tiktok|youtube|apple|stripe|openai|anthropic|twitter|linkedin/i);
    // A declared field is never itself refused by name (the allowlist and the refusal list never disagree).
    for (const e of events) for (const k of Object.keys(e.fields)) assert.equal(forbiddenKeyClass(k), null, k);
    assert.equal(contractOf('ops.events', 1)?.lane, 'OPERATIONAL_EVENT');
    assert.equal(contractOf('ops.events', 2), null);
    assert.ok(Object.isFrozen(EXTERNAL_CONTRACTS) && Object.isFrozen(contractOf('outcome.metrics', 1)?.metrics) && Object.isFrozen(contractOf('ops.events', 1)?.eventTypes[0]?.fields), 'the catalog is deeply immutable');
  });

  test('a source registers one known (contract, version) of a family it serves; its lifecycle moves forward only', () => {
    assert.equal(assertSourceRegistration({ sourceKey: 'search.console', family: 'SEARCH', contractCode: 'outcome.metrics', contractVersion: 1 }).contract.lane, 'EXTERNAL_OUTCOME');
    assert.throws(() => assertSourceRegistration({ sourceKey: 'Search Console', family: 'SEARCH', contractCode: 'outcome.metrics', contractVersion: 1 }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => assertSourceRegistration({ sourceKey: 'ops.prod', family: 'APP_OPERATIONS', contractCode: 'outcome.metrics', contractVersion: 1 }), (e) => isQandeelError(e) && e.details.reason === 'CONTRACT_FAMILY_MISMATCH');
    assert.equal(nextSourceState('DRAFT', 'ACTIVATE'), 'ACTIVE');
    assert.equal(nextSourceState('ACTIVE', 'SUSPEND'), 'SUSPENDED');
    assert.equal(nextSourceState('SUSPENDED', 'ACTIVATE'), 'ACTIVE');
    assert.equal(nextSourceState('SUSPENDED', 'RETIRE'), 'RETIRED');
    for (const [from, d] of [['DRAFT', 'SUSPEND'], ['ACTIVE', 'ACTIVATE'], ['RETIRED', 'ACTIVATE'], ['RETIRED', 'RETIRE']] as const) assert.throws(() => nextSourceState(from, d), (e) => isQandeelError(e, 'INVALID_TRANSITION'), `${from} ${d}`);
  });

  test('an operational fact is never outcome evidence; it may only explain a Work Item failure as an external dependency', () => {
    const fact = { lane: 'OPERATIONAL_EVENT' as const, failureSignal: true };
    const healthy = { lane: 'OPERATIONAL_EVENT' as const, failureSignal: false };
    const observation = { lane: 'EXTERNAL_OUTCOME' as const, failureSignal: false };
    assert.equal(bindableRole(fact, 'OUTCOME_EVIDENCE', 'WORK_ITEM'), false);
    assert.equal(bindableRole(fact, 'DEPENDENCY_FAILURE', 'WORK_ITEM'), true);
    assert.equal(bindableRole(fact, 'DEPENDENCY_FAILURE', 'GOAL'), false);
    assert.equal(bindableRole(healthy, 'DEPENDENCY_FAILURE', 'WORK_ITEM'), false);
    assert.equal(bindableRole(observation, 'OUTCOME_EVIDENCE', 'WORK_ITEM'), true);
    assert.equal(bindableRole(observation, 'OUTCOME_EVIDENCE', 'GOAL'), true);
    assert.equal(bindableRole(observation, 'DEPENDENCY_FAILURE', 'WORK_ITEM'), false);
  });
});
