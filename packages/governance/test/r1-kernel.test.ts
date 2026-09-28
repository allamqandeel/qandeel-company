/**
 * R1 Independent Core Review — governance kernel regression proofs. R1-PROOF: governance-kernel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { canonicalJson, isQandeelError } from '@qandeel-company/domain';

import { ProviderError, assertArgsSchema, classifyProviderError, parseProposal, validateArgs } from '../src/index.js';

const schema = assertArgsSchema({ fields: { text: { type: 'string', required: true, maxLength: 200 } } });

describe('R1-02: tool arguments are validated by own schema fields only', () => {
  for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__proto__']) {
    test(`a model-proposed "${key}" argument is an unknown argument, never an inherited field`, () => {
      const args = JSON.parse(`{"text":"ok","${key}":{"to":"someone","body":"smuggled"}}`) as unknown;
      assert.throws(() => validateArgs(schema, args), (e) => isQandeelError(e, 'VALIDATION_FAILED') && /unknown tool argument/.test(e.message));
    });
  }

  test('a declared field is still validated strictly and a clean request still passes', () => {
    assert.deepEqual(validateArgs(schema, { text: 'ok' }), { text: 'ok' });
    assert.throws(() => validateArgs(schema, { text: 5 }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => validateArgs(schema, {}), (e) => isQandeelError(e, 'VALIDATION_FAILED') && /required/.test(e.message));
  });

  test('a schema may not declare a field that shadows an Object.prototype member', () => {
    assert.throws(() => assertArgsSchema({ fields: { constructor: { type: 'string' } } }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => assertArgsSchema({ fields: { toString: { type: 'string' } } }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
  });

  test('canonical JSON keeps a "__proto__" key as data (it cannot vanish from a fingerprint)', () => {
    const a = canonicalJson(JSON.parse('{"a":1,"__proto__":{"x":1}}'));
    const b = canonicalJson(JSON.parse('{"a":1}'));
    assert.notEqual(a, b);
    assert.match(a, /__proto__/);
  });
});

describe('R1-09 (final re-review 3): a thrown failure class is read once — the class validated is the class used', () => {
  test('a shifting or prototype-named failure class never escapes classification', () => {
    const shifting = (...values: string[]): ProviderError => {
      const e = new ProviderError('TRANSIENT');
      let i = 0;
      Object.defineProperty(e, 'failure', { get: () => values[Math.min(i++, values.length - 1)] });
      return e;
    };
    assert.equal(classifyProviderError(shifting('TIMEOUT_AFTER_SEND', 'constructor')), 'TIMEOUT_AFTER_SEND');
    assert.equal(classifyProviderError(shifting('CONTRACT_VIOLATION', '__proto__')), 'CONTRACT_VIOLATION');
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'BOGUS']) assert.equal(classifyProviderError(shifting(name)), 'UNKNOWN', name);
    assert.equal(classifyProviderError(new Error('plain')), 'UNKNOWN');
  });
});

describe('R1 K4: proposal codes are bounded machine codes', () => {
  test('an oversize FINAL summary code is MALFORMED, never persisted as evidence', () => {
    const long = `a${'b'.repeat(4_999)}`;
    assert.deepEqual(parseProposal(JSON.stringify({ type: 'FINAL', summaryCode: long })), { type: 'INVALID', code: 'MALFORMED' });
    assert.deepEqual(parseProposal(JSON.stringify({ type: 'FINAL', summaryCode: 'a'.repeat(65) })), { type: 'INVALID', code: 'MALFORMED' });
    assert.deepEqual(parseProposal(JSON.stringify({ type: 'FINAL', summaryCode: 'report.done' })), { type: 'FINAL', summaryCode: 'report.done' });
  });

  test('tool / action codes are bounded; topics keep the 96-character memory key limit', () => {
    assert.equal(parseProposal(JSON.stringify({ type: 'TOOL_REQUEST', tool: 'n'.repeat(65), action: 'append', args: {} })).type, 'INVALID');
    assert.equal(parseProposal(JSON.stringify({ type: 'OBSERVATION', topic: 't'.repeat(96), content: 'x' })).type, 'OBSERVATION');
    assert.equal(parseProposal(JSON.stringify({ type: 'OBSERVATION', topic: 't'.repeat(97), content: 'x' })).type, 'INVALID');
  });
});
