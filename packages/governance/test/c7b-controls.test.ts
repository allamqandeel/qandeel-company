/**
 * C7-B kernel proofs: the closed seven-family control contract, typed scopes and values, no generic execution, the
 * empty Approved Remote Configuration register, the negative-only Route Hold, exact-act fingerprints and the R3
 * authority decision of a control act.
 * C7B-PROOF: control-kernel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { canonicalJson, isQandeelError, type Timestamp } from '@qandeel-company/domain';

import {
  APP_CONTROL_CAPABILITY,
  CONTROL_FAMILIES,
  FAMILY_SCOPES,
  FEATURE_FLAG_STATES,
  ISSUED_CONTROL_ENVELOPE_KEYS,
  ORG_ACTIONS,
  ORG_CAPABILITIES,
  PRODUCTION_REMOTE_CONFIG_FAMILIES,
  assertCapability,
  assertRemoteConfigFamily,
  controlChangeProblem,
  controlGrantResource,
  controlProposalFingerprint,
  controlRevisionDigest,
  decideEmployeeAction,
  isControlFamily,
  normalizeControlProposal,
  orgActRequest,
  orgActionCapability,
  type GrantView,
} from '../src/index.js';

const refused = (reason: string) => (e: unknown): boolean => isQandeelError(e, 'CONTROL_REFUSED') && e.details.reason === reason;
const flag = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ family: 'FEATURE_FLAG', scope: { kind: 'CAPABILITY', capability: 'voice.call' }, operation: 'SET', value: { state: 'EMERGENCY_DISABLED' }, reasonCode: 'incident.voice-errors', expectedRevision: 0, ...over });
const AT = '2026-10-01T00:00:00.000Z' as Timestamp;

describe('C7-B closed family catalogue', () => {
  test('(8) exactly seven control families exist; (9) an eighth is refused in code', () => {
    assert.deepEqual([...CONTROL_FAMILIES], ['FEATURE_FLAG', 'KILL_SWITCH', 'MAINTENANCE_MODE', 'ROLLOUT_CONTROL', 'MINIMUM_SUPPORTED_VERSION', 'APPROVED_REMOTE_CONFIGURATION', 'ROUTE_HOLD']);
    assert.equal(Object.keys(FAMILY_SCOPES).length, 7);
    for (const eighth of ['REMOTE_EXECUTION', 'COMMAND', 'SCRIPT', 'feature_flag', 'DATA_DELETE']) {
      assert.equal(isControlFamily(eighth), false);
      assert.throws(() => normalizeControlProposal(flag({ family: eighth })), refused('UNKNOWN_CONTROL_FAMILY'));
    }
  });

  test('(19) the family admits only its own scope kinds; scope identifiers are short opaque codes, never PII or selectors', () => {
    assert.throws(() => normalizeControlProposal(flag({ scope: { kind: 'APP' } })), refused('SCOPE_NOT_ALLOWED_FOR_FAMILY'));
    assert.throws(() => normalizeControlProposal(flag({ scope: { kind: 'PROVIDER', provider: 'p1' } })), refused('SCOPE_NOT_ALLOWED_FOR_FAMILY'));
    assert.throws(() => normalizeControlProposal(flag({ scope: { kind: 'CAPABILITY' } })), refused('MISSING_FIELD'));
    assert.throws(() => normalizeControlProposal(flag({ scope: { kind: 'CAPABILITY', capability: 'voice.call', userId: 'u-1' } })), refused('PRIVATE_FIELD_REFUSED'));
    for (const bad of ['user@example.com', '+201001234567', 'voice call', 'cap*', "x' OR 1=1", 'a', 'VOICE', 'user-201001234567', 'c0ffee12-1234-4abc-8def-001122334455']) {
      assert.throws(() => normalizeControlProposal(flag({ scope: { kind: 'CAPABILITY', capability: bad } })), (e) => isQandeelError(e, 'CONTROL_REFUSED'), bad);
    }
    const n = normalizeControlProposal(flag({ scope: { capability: 'voice.call', kind: 'CAPABILITY' } }));
    assert.equal(n.scopeKey, canonicalJson({ kind: 'CAPABILITY', capability: 'voice.call' }), 'key order is irrelevant');
  });
});

describe('C7-B family contracts (typed, bounded, restrict-only)', () => {
  test('(31–33) Feature Flags: only the frozen states; exact capability scope; ENABLED is only removal of Company restriction', () => {
    for (const st of FEATURE_FLAG_STATES) assert.equal(normalizeControlProposal(flag({ value: { state: st } })).value?.state, st);
    for (const st of ['ON', 'OFF', 'enabled', 'PERCENT_50', '']) assert.throws(() => normalizeControlProposal(flag({ value: { state: st } })), refused('INVALID_VALUE'));
    assert.throws(() => normalizeControlProposal(flag({ value: { state: 'ENABLED', grantsEntitlement: true } })), refused('UNKNOWN_FIELD'));
    assert.throws(() => normalizeControlProposal(flag({ value: { state: 'ENABLED', targeting: 'country == EG' } })), refused('GENERIC_EXECUTION_REFUSED'));
  });

  test('(34–36) Kill Switch: an exact capability out of service; never a command, script or process kill', () => {
    const k = normalizeControlProposal({ family: 'KILL_SWITCH', scope: { kind: 'CAPABILITY', capability: 'worlds.matching' }, operation: 'SET', value: { effect: 'OUT_OF_SERVICE' }, reasonCode: 'incident.matching', expectedRevision: 0 });
    assert.deepEqual(k.value, { effect: 'OUT_OF_SERVICE' });
    for (const v of [{ effect: 'KILL_PROCESS' }, { effect: 'OUT_OF_SERVICE', command: 'pkill node' }, { script: 'process.exit(1)' }, { sql: 'DELETE FROM users' }]) {
      assert.throws(() => normalizeControlProposal({ family: 'KILL_SWITCH', scope: { kind: 'CAPABILITY', capability: 'worlds.matching' }, operation: 'SET', value: v, reasonCode: 'x', expectedRevision: 0 }), (e) => isQandeelError(e, 'CONTROL_REFUSED'));
    }
    assert.throws(() => normalizeControlProposal({ family: 'KILL_SWITCH', scope: { kind: 'APP' }, operation: 'SET', value: { effect: 'OUT_OF_SERVICE' }, reasonCode: 'x', expectedRevision: 0 }), refused('SCOPE_NOT_ALLOWED_FOR_FAMILY'));
  });

  test('(37–39) Maintenance: structured scope and operational reason; no user-facing copy can ride in the payload', () => {
    const m = normalizeControlProposal({ family: 'MAINTENANCE_MODE', scope: { kind: 'APP' }, operation: 'SET', value: { reason: 'PLANNED_MAINTENANCE' }, reasonCode: 'ops.window', expectedRevision: 0 });
    assert.equal(m.scopeKey, '{"kind":"APP"}');
    assert.throws(() => normalizeControlProposal({ family: 'MAINTENANCE_MODE', scope: { kind: 'APP' }, operation: 'SET', value: { reason: 'PLANNED_MAINTENANCE', message: 'We will be back soon' }, reasonCode: 'x', expectedRevision: 0 }), refused('PRIVATE_FIELD_REFUSED'));
    assert.throws(() => normalizeControlProposal({ family: 'MAINTENANCE_MODE', scope: { kind: 'APP' }, operation: 'SET', value: { reason: 'Back at 5pm' }, reasonCode: 'x', expectedRevision: 0 }), refused('INVALID_VALUE'));
    assert.throws(() => normalizeControlProposal({ family: 'MAINTENANCE_MODE', scope: { kind: 'APP' }, operation: 'SET', value: { reason: 'OUTAGE_DETECTED', copy: 'x' }, reasonCode: 'x', expectedRevision: 0 }), (e) => isQandeelError(e, 'CONTROL_REFUSED'));
  });

  test('(40–43) Rollout: one opaque cohort of one capability, exposure only; no PII, percentage, expression or cross-cohort list', () => {
    const r = normalizeControlProposal({ family: 'ROLLOUT_CONTROL', scope: { kind: 'COHORT', capability: 'worlds.public', cohort: 'pilot-a' }, operation: 'SET', value: { exposure: 'LIMITED_ROLLOUT' }, reasonCode: 'rollout.step', expectedRevision: 0 });
    assert.equal(r.scope.cohort, 'pilot-a');
    const base = { family: 'ROLLOUT_CONTROL', operation: 'SET', reasonCode: 'x', expectedRevision: 0 };
    assert.throws(() => normalizeControlProposal({ ...base, scope: { kind: 'COHORT', capability: 'worlds.public', cohort: 'pilot-a', email: 'a@b.c' }, value: { exposure: 'ENABLED' } }), refused('PRIVATE_FIELD_REFUSED'));
    assert.throws(() => normalizeControlProposal({ ...base, scope: { kind: 'COHORT', capability: 'worlds.public', cohort: ['pilot-a', 'pilot-b'] }, value: { exposure: 'ENABLED' } }), refused('INVALID_SCOPE_IDENTIFIER'));
    assert.throws(() => normalizeControlProposal({ ...base, scope: { kind: 'COHORT', capability: 'worlds.public', cohort: 'country == EG' }, value: { exposure: 'ENABLED' } }), refused('INVALID_SCOPE_IDENTIFIER'));
    assert.throws(() => normalizeControlProposal({ ...base, scope: { kind: 'COHORT', capability: 'worlds.public', cohort: 'pilot-a' }, value: { exposure: 'ENABLED', percentage: 50 } }), refused('GENERIC_EXECUTION_REFUSED'));
    assert.throws(() => normalizeControlProposal({ ...base, scope: { kind: 'CAPABILITY', capability: 'worlds.public' }, value: { exposure: 'ENABLED' } }), refused('SCOPE_NOT_ALLOWED_FOR_FAMILY'));
  });

  test('(44–46) Minimum Supported Version: explicit platform scope, canonical bounded version; malformed refused', () => {
    const v = normalizeControlProposal({ family: 'MINIMUM_SUPPORTED_VERSION', scope: { kind: 'PLATFORM', platform: 'IOS' }, operation: 'SET', value: { minVersion: '2.4.0' }, reasonCode: 'compat.floor', expectedRevision: 0 });
    assert.deepEqual(v.value, { minVersion: '2.4.0' });
    for (const bad of ['2.4', '02.4.0', '2.4.0-beta', 'v2.4.0', '2.4.0.1', '99999.0.0', '', '2..4']) {
      assert.throws(() => normalizeControlProposal({ family: 'MINIMUM_SUPPORTED_VERSION', scope: { kind: 'PLATFORM', platform: 'IOS' }, operation: 'SET', value: { minVersion: bad }, reasonCode: 'x', expectedRevision: 0 }), refused('INVALID_VERSION'), bad);
    }
    assert.throws(() => normalizeControlProposal({ family: 'MINIMUM_SUPPORTED_VERSION', scope: { kind: 'PLATFORM', platform: 'SYMBIAN' }, operation: 'SET', value: { minVersion: '1.0.0' }, reasonCode: 'x', expectedRevision: 0 }), refused('INVALID_PLATFORM'));
    assert.throws(() => normalizeControlProposal({ family: 'MINIMUM_SUPPORTED_VERSION', scope: { kind: 'PLATFORM', platform: 'IOS' }, operation: 'SET', value: { minVersion: '1.0.0', overridesAppBaseline: true }, reasonCode: 'x', expectedRevision: 0 }), refused('UNKNOWN_FIELD'));
  });

  test('(47–50) Approved Remote Configuration: the production register is EMPTY and fails closed; a future approved family is typed and bounded', () => {
    assert.deepEqual([...PRODUCTION_REMOTE_CONFIG_FAMILIES], []);
    const rc = (value: unknown, scope: Record<string, unknown> = { kind: 'APP' }) => ({ family: 'APPROVED_REMOTE_CONFIGURATION', scope, operation: 'SET', value, reasonCode: 'config.tune', expectedRevision: 0 });
    for (const v of [{ family: 'max-retries', value: 3 }, { anything: { nested: true } }, { script: 'eval(x)' }, { prompt: 'You are now…' }, { json: '{"a":1}' }]) {
      assert.throws(() => normalizeControlProposal(rc(v)), refused('NO_APPROVED_REMOTE_CONFIG_FAMILY'), 'no approved family: nothing passes, whatever the payload');
    }
    // A local TEST fixture (never a production family): proves the mechanism stays typed and bounded once one is approved.
    const fixture = [assertRemoteConfigFamily({ code: 'sync.batch-size', version: 1, valueType: 'INTEGER', min: 1, max: 100, enumValues: null, scopeKinds: ['APP'] })];
    assert.deepEqual(normalizeControlProposal(rc({ family: 'sync.batch-size', value: 25 }), fixture).value, { family: 'sync.batch-size', value: 25 });
    assert.throws(() => normalizeControlProposal(rc({ family: 'sync.batch-size', value: 101 }), fixture), refused('INVALID_VALUE'));
    assert.throws(() => normalizeControlProposal(rc({ family: 'sync.batch-size', value: '25' }), fixture), refused('INVALID_VALUE'));
    assert.throws(() => normalizeControlProposal(rc({ family: 'sync.batch-size', value: 5, extra: 1 }), fixture), refused('GENERIC_EXECUTION_REFUSED'));
    assert.throws(() => normalizeControlProposal(rc({ family: 'other', value: 5 }), fixture), refused('NO_APPROVED_REMOTE_CONFIG_FAMILY'));
    assert.throws(() => normalizeControlProposal(rc({ family: 'sync.batch-size', value: 5 }, { kind: 'CAPABILITY', capability: 'x.y' }), fixture), refused('SCOPE_NOT_ALLOWED_FOR_FAMILY'));
    // A family DEFINITION can never be generic: no free-text type, no unbounded integer, code-shaped enums only.
    for (const def of [
      { code: 'copy.text', version: 1, valueType: 'STRING', min: null, max: null, enumValues: null, scopeKinds: ['APP'] },
      { code: 'n', version: 1, valueType: 'INTEGER', min: null, max: null, enumValues: null, scopeKinds: ['APP'] },
      { code: 'mode.x', version: 1, valueType: 'ENUM', min: null, max: null, enumValues: ['ok', 'You are a helpful…'], scopeKinds: ['APP'] },
      { code: 'route.x', version: 1, valueType: 'BOOLEAN', min: null, max: null, enumValues: null, scopeKinds: ['PROVIDER'] },
      { code: 'blob', version: 1, valueType: 'JSON', min: null, max: null, enumValues: null, scopeKinds: ['APP'], schema: {} },
    ]) assert.throws(() => assertRemoteConfigFamily(def), (e) => isQandeelError(e, 'CONTROL_REFUSED'));
  });

  test('(51–54) Route Hold is negative only: it holds a provider or route; it never selects, forces, ranks or chooses FAST / DEEP', () => {
    const h = normalizeControlProposal({ family: 'ROUTE_HOLD', scope: { kind: 'PROVIDER', provider: 'provider-a' }, operation: 'SET', value: { hold: 'HELD' }, reasonCode: 'provider.degraded', expectedRevision: 0 });
    assert.deepEqual(h.value, { hold: 'HELD' });
    const hold = (value: unknown) => () => normalizeControlProposal({ family: 'ROUTE_HOLD', scope: { kind: 'ROUTE', route: 'conversation.primary' }, operation: 'SET', value, reasonCode: 'x', expectedRevision: 0 });
    assert.throws(hold({ hold: 'HELD', model: 'model-b' }), refused('SELECTION_REFUSED'));
    assert.throws(hold({ hold: 'HELD', fallback: 'provider-b' }), refused('SELECTION_REFUSED'));
    assert.throws(hold({ hold: 'HELD', mode: 'FAST' }), refused('SELECTION_REFUSED'));
    assert.throws(hold({ force: 'provider-b' }), refused('SELECTION_REFUSED'));
    assert.throws(hold({ hold: 'PREFER' }), refused('INVALID_VALUE'));
    assert.throws(hold({ hold: 'HELD', deep: true }), refused('SELECTION_REFUSED'));
    // RELEASE only removes the hold: it carries no value at all.
    assert.equal(normalizeControlProposal({ family: 'ROUTE_HOLD', scope: { kind: 'PROVIDER', provider: 'provider-a' }, operation: 'RELEASE', reasonCode: 'provider.recovered', expectedRevision: 1 }).value, null);
    assert.throws(() => normalizeControlProposal({ family: 'ROUTE_HOLD', scope: { kind: 'PROVIDER', provider: 'provider-a' }, operation: 'RELEASE', value: { hold: 'HELD' }, reasonCode: 'x', expectedRevision: 1 }), refused('RELEASE_HAS_NO_VALUE'));
  });

  test('(35, 49, 55) no generic remote execution and no private content: every executable / private field name is refused anywhere', () => {
    for (const k of ['code', 'script', 'sql', 'query', 'command', 'exec', 'eval', 'expression', 'rule', 'prompt', 'url', 'webhook', 'payload', 'args', 'patch', 'ota']) {
      assert.throws(() => normalizeControlProposal(flag({ value: { state: 'DISABLED', [k]: 'x' } })), refused('GENERIC_EXECUTION_REFUSED'), k);
      assert.throws(() => normalizeControlProposal({ ...flag(), [k]: 'x' }), refused('GENERIC_EXECUTION_REFUSED'), `top-level ${k}`);
    }
    for (const k of ['conversation', 'transcript', 'audio', 'memory', 'analysis', 'userId', 'email', 'phone', 'content', 'message']) {
      assert.throws(() => normalizeControlProposal(flag({ value: { state: 'DISABLED', [k]: 'x' } })), refused('PRIVATE_FIELD_REFUSED'), k);
    }
    assert.throws(() => normalizeControlProposal(flag({ reasonCode: 'please disable it now' })), refused('INVALID_REASON_CODE'));
    assert.throws(() => normalizeControlProposal(flag({ evidenceRefs: ['free text evidence'] })), refused('INVALID_EVIDENCE_REFS'));
  });
});

describe('C7-B exact act, revision law and R3 authority', () => {
  test('(18) a material change of family, scope, value, operation, reason, evidence or expected revision is a different fingerprint', () => {
    const base = normalizeControlProposal(flag());
    const fp = controlProposalFingerprint(base);
    assert.equal(controlProposalFingerprint(normalizeControlProposal({ ...flag(), scope: { capability: 'voice.call', kind: 'CAPABILITY' } })), fp, 'canonical: key order never changes the act');
    for (const changed of [flag({ value: { state: 'DISABLED' } }), flag({ scope: { kind: 'CAPABILITY', capability: 'voice.note' } }), flag({ reasonCode: 'other.reason' }), flag({ evidenceRefs: ['external_record:r1'] }), flag({ expectedRevision: 1 }), { family: 'KILL_SWITCH', scope: { kind: 'CAPABILITY', capability: 'voice.call' }, operation: 'SET', value: { effect: 'OUT_OF_SERVICE' }, reasonCode: 'incident.voice-errors', expectedRevision: 0 }]) {
      assert.notEqual(controlProposalFingerprint(normalizeControlProposal(changed)), fp);
    }
    const d1 = controlRevisionDigest({ seriesId: 's', revision: 1, family: 'FEATURE_FLAG', scope: base.scope, operation: 'SET', value: base.value, priorDigest: null });
    assert.notEqual(d1, controlRevisionDigest({ seriesId: 's', revision: 2, family: 'FEATURE_FLAG', scope: base.scope, operation: 'SET', value: base.value, priorDigest: d1 }));
  });

  test('(22–23) RELEASE needs a live SET; a SET identical to the current one is no change', () => {
    const set = { operation: 'SET' as const, value: { state: 'DISABLED' } };
    assert.equal(controlChangeProblem(null, { operation: 'RELEASE', value: null }), 'NOTHING_TO_RELEASE');
    assert.equal(controlChangeProblem({ operation: 'RELEASE', value: null }, { operation: 'RELEASE', value: null }), 'NOTHING_TO_RELEASE');
    assert.equal(controlChangeProblem(set, { operation: 'RELEASE', value: null }), null);
    assert.equal(controlChangeProblem(set, set), 'NO_CHANGE');
    assert.equal(controlChangeProblem(set, { operation: 'SET', value: { state: 'ENABLED' } }), null);
  });

  test('(11, 7) a control act is R3 on its family: the grant alone never suffices — review AND Founder approval follow; titles are not capabilities', () => {
    assert.ok(ORG_ACTIONS.includes('control.propose'));
    assert.equal(orgActionCapability('control.propose'), APP_CONTROL_CAPABILITY);
    assert.equal(assertCapability(APP_CONTROL_CAPABILITY), 'app-control.issue');
    assert.equal(ORG_CAPABILITIES.includes(APP_CONTROL_CAPABILITY as never), false, 'never delegable as an R1 organizational capability');
    for (const generic of ['app.execute', 'remote.execute', 'app-control.execute', 'app-control.*', 'role:product.app-operations-release-lead']) assert.throws(() => assertCapability(generic), (e) => isQandeelError(e, 'VALIDATION_FAILED'), generic);
    assert.deepEqual(orgActRequest('control.propose', { family: 'KILL_SWITCH' }), { risk: 'R3', resource: 'kill-switch' });
    assert.deepEqual(orgActRequest('work.delegate', {}), { risk: 'R1', resource: '*' });
    assert.equal(controlGrantResource('NOT_A_FAMILY'), 'app-control-invalid');
    const grant = (o: Partial<GrantView>): GrantView => ({ id: 'g', capability: APP_CONTROL_CAPABILITY, resourceScope: '*', riskCeiling: 'R3', dataClassCeiling: 'D1', expiresAt: null, maxUses: null, uses: 0, status: 'ACTIVE', ...o });
    const req = { capability: APP_CONTROL_CAPABILITY, resource: 'kill-switch', risk: 'R3' as const, dataClass: 'D1' as const, at: AT };
    assert.deepEqual(decideEmployeeAction('EMPLOYEE', 'ACTIVE', [], req), { effect: 'DENY', code: 'NO_GRANT' }, 'a seat or title without a grant decides nothing');
    assert.deepEqual(decideEmployeeAction('EMPLOYEE', 'ACTIVE', [grant({ riskCeiling: 'R1' })], req), { effect: 'DENY', code: 'NO_GRANT' }, 'an R1 (delegated) grant never covers R3');
    assert.deepEqual(decideEmployeeAction('EMPLOYEE', 'ACTIVE', [grant({ resourceScope: 'feature-flag' })], req), { effect: 'DENY', code: 'NO_GRANT' }, 'a family-scoped grant covers that family only');
    assert.deepEqual(decideEmployeeAction('EMPLOYEE', 'ACTIVE', [grant({})], req), { effect: 'ALLOW', grantId: 'g', approval: 'FOUNDER', review: 'INDEPENDENT' }, 'R3: independent review AND Founder approval, cumulative');
  });

  test('(57) the outbound envelope carries bounded operational state only', () => {
    assert.deepEqual([...ISSUED_CONTROL_ENVELOPE_KEYS], ['companyState', 'digest', 'family', 'issuedAt', 'operation', 'revision', 'scope', 'seriesId', 'value']);
  });
});
