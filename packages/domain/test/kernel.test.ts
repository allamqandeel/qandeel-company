import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ExponentialBackoff,
  ManualClock,
  assertOpaqueRef,
  boundedJson,
  boundedText,
  canonicalJson,
  classifyInterruptedRun,
  decideRetry,
  isId,
  isQandeelError,
  isTimestamp,
  newId,
  now,
  parseTimestamp,
  sha256Hex,
  toTimestamp,
} from '../src/index.js';

describe('ids', () => {
  test('are random UUIDv4 values carrying no business meaning', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    assert.equal(ids.size, 1000);
    for (const id of ids) assert.ok(isId(id));
    assert.equal(isId('WI-2026-0001'), false);
  });

  test('opaque references are validated but never claimed as authorized', () => {
    assert.equal(assertOpaqueRef('owner:founder', 'ownerRef'), 'owner:founder');
    assert.throws(() => assertOpaqueRef('founder', 'ownerRef'), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => assertOpaqueRef('owner:../../etc', 'ownerRef'), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
  });
});

describe('time', () => {
  test('persisted timestamps are fixed-width UTC and sort chronologically as text', () => {
    const a = toTimestamp(Date.UTC(2026, 0, 2, 3, 4, 5, 6));
    assert.equal(a, '2026-01-02T03:04:05.006Z');
    assert.equal(a.length, 24);
    const later = toTimestamp(Date.UTC(2026, 0, 2, 3, 4, 5, 7));
    assert.ok(a < later);
    assert.equal(parseTimestamp(a), Date.UTC(2026, 0, 2, 3, 4, 5, 6));
    assert.equal(isTimestamp('2026-01-02T03:04:05+02:00'), false);
    assert.equal(isTimestamp('2026-01-02 03:04:05.006Z'), false);
  });

  test('manual clock moves only forward and only when told to', () => {
    const clock = new ManualClock('2026-09-26T12:00:00.000Z');
    assert.equal(now(clock), '2026-09-26T12:00:00.000Z');
    clock.advance(1500);
    assert.equal(now(clock), '2026-09-26T12:00:01.500Z');
    assert.throws(() => clock.advance(-1));
    assert.throws(() => clock.set(0));
  });
});

describe('validation', () => {
  test('bounded text rejects empty, oversized and control-character input', () => {
    assert.equal(boundedText('تقرير السوق', 'objective', 20), 'تقرير السوق');
    assert.throws(() => boundedText('  ', 'objective', 20), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => boundedText('x'.repeat(21), 'objective', 20), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => boundedText('a\u0000b', 'objective', 20), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
  });

  test('canonical JSON is key-order independent', () => {
    assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
    assert.equal(sha256Hex(canonicalJson({ x: 1, y: 2 })), sha256Hex(canonicalJson({ y: 2, x: 1 })));
  });

  test('bounded JSON enforces size, finiteness, plain objects and refuses credential-named keys', () => {
    assert.equal(boundedJson({ step: 1 }, 'state', 100), '{"step":1}');
    assert.throws(() => boundedJson({ blob: 'x'.repeat(200) }, 'state', 100), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => boundedJson({ n: Number.NaN }, 'state', 100), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => boundedJson({ d: new Date() }, 'state', 100), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    for (const key of ['apiKey', 'password', 'client_secret', 'accessToken', 'privateKey', 'Authorization', 'token', 'refresh-token']) {
      assert.throws(() => boundedJson({ nested: { [key]: 'x' } }, 'state', 1000), (e) => isQandeelError(e, 'VALIDATION_FAILED'), key);
    }
    // Operational identifiers that merely contain the word are not credentials.
    assert.doesNotThrow(() => boundedJson({ fencingToken: 3, tokenCount: 10 }, 'state', 1000));
  });
});

describe('retry policy', () => {
  test('exponential backoff is deterministic and capped', () => {
    const b = new ExponentialBackoff({ baseMs: 100, maxMs: 1000, factor: 2 });
    assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => b.delayMs(n)), [100, 200, 400, 800, 1000, 1000]);
  });

  test('retries are bounded: exhaustion dead-letters, never loops', () => {
    const b = new ExponentialBackoff({ baseMs: 10 });
    assert.deepEqual(decideRetry(1, 3, b), { action: 'RETRY', delayMs: 10 });
    assert.deepEqual(decideRetry(2, 3, b), { action: 'RETRY', delayMs: 20 });
    assert.deepEqual(decideRetry(3, 3, b), { action: 'DEAD_LETTER' });
    assert.deepEqual(decideRetry(9, 3, b), { action: 'DEAD_LETTER' });
  });

  test('interrupted runs are classified, never blindly retried', () => {
    assert.equal(classifyInterruptedRun('NONE', true), 'SAFE_TO_RESUME');
    assert.equal(classifyInterruptedRun('NONE', false), 'SAFE_TO_RETRY');
    assert.equal(classifyInterruptedRun('IDEMPOTENT', false), 'SAFE_TO_RETRY');
    assert.equal(classifyInterruptedRun('UNSAFE', true), 'RECONCILIATION_REQUIRED');
    assert.equal(classifyInterruptedRun('UNSAFE', false), 'RECONCILIATION_REQUIRED');
  });
});
