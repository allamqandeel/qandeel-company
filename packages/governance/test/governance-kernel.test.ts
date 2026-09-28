/**
 * C2 governance kernel proofs (pure, deterministic). C2-PROOF: governance-kernel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Timestamp } from '@qandeel-company/domain';

import {
  FAILURE_DISPOSITIONS,
  MAX_MONEY_MICROS,
  addMoney,
  approvalFingerprint,
  approvalUsable,
  assertActionConsistency,
  assertActivationAvailable,
  assertApprover,
  assertEmployeeName,
  assertEmployeeTransition,
  assertGovernanceAuthority,
  assertPriceCardRates,
  assertQualificationRefs,
  assertToolCode,
  canExecute,
  externalEgressAvailable,
  checkReservation,
  costOf,
  decideEmployeeAction,
  parseProposal,
  planEscalation,
  planFallback,
  requiresIdempotencyKey,
  route,
  subMoney,
  validateArgs,
  worstCase,
  type BudgetLevel,
  type DeploymentView,
  type GrantView,
  type PriceCard,
  type RoutePolicy,
  type RouteRequest,
} from '../src/index.js';

const AT = '2026-09-27T12:00:00.000Z' as Timestamp;
const card = (id: string, inRate: number, outRate: number, mode: PriceCard['billingMode'] = 'METERED'): PriceCard => ({
  id,
  version: 1,
  currency: 'USD',
  billingMode: mode,
  billedInputPerMTok: mode === 'METERED' ? inRate : 0,
  billedOutputPerMTok: mode === 'METERED' ? outRate : 0,
  billedPerCall: 0,
  economicInputPerMTok: inRate,
  economicOutputPerMTok: outRate,
  economicPerCall: 0,
});
const dep = (over: Partial<DeploymentView> & { id: string }): DeploymentView => ({
  code: over.id,
  providerId: 'p',
  providerCode: 'fake',
  providerStatus: 'ACTIVE',
  modelCode: 'm',
  locality: 'LOCAL',
  status: 'ACTIVE',
  qualification: 'QUALIFIED',
  reasoningClass: 'E1',
  taskClasses: ['draft.memo'],
  egressMaxDataClass: 'D3',
  circuitOpenUntil: null,
  contextWindowTokens: 100_000,
  maxOutputTokens: 4_096,
  priceCard: card(`${over.id}-card`, 2_000_000, 8_000_000),
  ...over,
});
const policy: RoutePolicy = {
  id: 'policy',
  taskClass: 'draft.memo',
  version: 1,
  minClass: 'E1',
  maxClass: 'E3',
  allowLimitedProduction: false,
  maxRetriesPerCall: 1,
  maxCallsPerRun: 10,
  fallbackCostCeilingMicros: null,
  escalation: { maxDepth: 1, maxOverheadMicros: 1_000_000 },
};
const req = (over: Partial<RouteRequest> = {}): RouteRequest => ({ taskClass: 'draft.memo', reasoningClass: 'E1', dataClass: 'D1', inputTokensUpperBound: 1_000, maxOutputTokens: 512, employeeCeiling: 'E3', currency: 'USD', ...over });
const grant = (over: Partial<GrantView> = {}): GrantView => ({ id: 'g1', capability: 'tool:notes.append', resourceScope: '*', riskCeiling: 'R1', dataClassCeiling: 'D3', expiresAt: null, maxUses: null, uses: 0, status: 'ACTIVE', ...over });
const action = (over: Partial<Parameters<typeof decideEmployeeAction>[3]> = {}): Parameters<typeof decideEmployeeAction>[3] => ({ capability: 'tool:notes.append', resource: 'notes', risk: 'R1', dataClass: 'D1', at: AT, ...over });

describe('C2 kernel: employees', () => {
  test('lifecycle: Candidate → Training → Shadow/Probation → Active; retired is terminal; retraining never jumps to Active', () => {
    for (const [a, b] of [['CANDIDATE', 'TRAINING'], ['TRAINING', 'SHADOW'], ['SHADOW', 'PROBATION'], ['PROBATION', 'ACTIVE'], ['ACTIVE', 'SUSPENDED'], ['SUSPENDED', 'RETRAINING'], ['RETRAINING', 'PROBATION'], ['ACTIVE', 'RETIRED']] as const) {
      assert.doesNotThrow(() => assertEmployeeTransition(a, b), `${a}->${b}`);
    }
    assert.throws(() => assertEmployeeTransition('CANDIDATE', 'ACTIVE'), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
    assert.throws(() => assertEmployeeTransition('RETRAINING', 'ACTIVE'), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
    assert.throws(() => assertEmployeeTransition('SUSPENDED', 'ACTIVE'), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
    assert.throws(() => assertEmployeeTransition('RETIRED', 'ACTIVE'), (e) => isQandeelError(e, 'TERMINAL_STATE'));
    assert.deepEqual(['CANDIDATE', 'TRAINING', 'SHADOW', 'PROBATION', 'PAUSED', 'ON_LEAVE', 'RETRAINING', 'SUSPENDED', 'RETIRED'].filter((s) => canExecute(s as never)), []);
    assert.equal(canExecute('ACTIVE'), true);
  });

  test('activation fails closed in C2: no Founder attestation or opaque ref substitutes for C3 certification', () => {
    for (const from of ['SHADOW', 'PROBATION'] as const) {
      assert.throws(() => assertActivationAvailable(from), (e) => isQandeelError(e, 'EMPLOYEE_NOT_ELIGIBLE') && e.details['reason'] === 'CERTIFICATION_UNAVAILABLE');
    }
    // Resuming an already-active Employee is not an activation.
    assert.doesNotThrow(() => assertActivationAvailable('PAUSED'));
    assert.doesNotThrow(() => assertActivationAvailable('ON_LEAVE'));
    assert.throws(() => assertQualificationRefs(['academy:cert-1']), 'Academy certification references are C3 and refused in C2');
    assert.throws(() => assertQualificationRefs(['test-seam:x']), 'the test seam label is never accepted from a caller');
  });

  test('names: two human-style parts (Arabic and Latin), no digits or single part', () => {
    assert.deepEqual(assertEmployeeName({ given: 'عبد الرحمن', family: 'المصري' }), { given: 'عبد الرحمن', family: 'المصري' });
    assert.deepEqual(assertEmployeeName({ given: 'Nour', family: 'El-Sayed' }), { given: 'Nour', family: 'El-Sayed' });
    for (const bad of [{ given: 'N', family: 'Ali' }, { given: 'Agent7', family: 'Ali' }, { given: 'Ali' }, { given: ' Ali', family: 'Hassan' }]) assert.throws(() => assertEmployeeName(bad));
  });
});

describe('C2 kernel: authority (default deny, risk ladder, no self-escalation)', () => {
  test('default deny: no grant → DENY NO_GRANT; a covering grant → ALLOW', () => {
    assert.deepEqual(decideEmployeeAction('EMPLOYEE', 'ACTIVE', [], action()), { effect: 'DENY', code: 'NO_GRANT' });
    assert.deepEqual(decideEmployeeAction('EMPLOYEE', 'ACTIVE', [grant()], action()), { effect: 'ALLOW', grantId: 'g1', approval: 'NONE', review: 'NONE' });
  });

  test('every grant dimension must match: capability, resource, risk, data class, expiry, uses, status', () => {
    const deny = (g: GrantView, a = action()): void => assert.equal(decideEmployeeAction('EMPLOYEE', 'ACTIVE', [g], a).effect, 'DENY');
    deny(grant({ capability: 'tool:notes.read' }));
    deny(grant({ resourceScope: 'other' }));
    deny(grant({ riskCeiling: 'R0' }));
    deny(grant({ dataClassCeiling: 'D0' }));
    deny(grant({ expiresAt: AT }));
    deny(grant({ maxUses: 1, uses: 1 }));
    deny(grant({ status: 'REVOKED' }));
  });

  test('C4-PROOF: R2 needs independent review; R3 needs review AND Founder approval; R4 stays Founder-only', () => {
    assert.deepEqual(decideEmployeeAction('EMPLOYEE', 'ACTIVE', [grant({ riskCeiling: 'R3' })], action({ risk: 'R2' })), { effect: 'ALLOW', grantId: 'g1', approval: 'NONE', review: 'INDEPENDENT' });
    assert.deepEqual(decideEmployeeAction('EMPLOYEE', 'ACTIVE', [grant({ riskCeiling: 'R3' })], action({ risk: 'R4' })), { effect: 'DENY', code: 'FOUNDER_ONLY' });
    assert.deepEqual(decideEmployeeAction('EMPLOYEE', 'ACTIVE', [grant({ riskCeiling: 'R3' })], action({ risk: 'R3' })), { effect: 'ALLOW', grantId: 'g1', approval: 'FOUNDER', review: 'INDEPENDENT' });
    assert.throws(() => assertApprover('EMPLOYEE', 'R3'), (e) => isQandeelError(e, 'FOUNDER_ONLY'));
    assert.throws(() => assertApprover('FOUNDER', 'R4'), (e) => isQandeelError(e, 'FOUNDER_ONLY'));
    // Execute ≠ Review ≠ Approve: an approval never substitutes for the independent review of R2.
    assert.throws(() => assertApprover('FOUNDER', 'R2'), (e) => isQandeelError(e, 'REVIEW_REQUIRED'));
    assert.doesNotThrow(() => assertApprover('FOUNDER', 'R3'));
  });
  test('ineligible, non-employee and system actors are denied even with grants', () => {
    for (const s of ['SUSPENDED', 'RETIRED', 'PAUSED', 'PROBATION'] as const) assert.deepEqual(decideEmployeeAction('EMPLOYEE', s, [grant()], action()), { effect: 'DENY', code: 'EMPLOYEE_NOT_ELIGIBLE' });
    assert.deepEqual(decideEmployeeAction('SYSTEM', 'ACTIVE', [grant()], action()), { effect: 'DENY', code: 'NOT_AN_EMPLOYEE' });
  });

  test('governance administration: Founder only; an employee on itself is a self-escalation', () => {
    assert.doesNotThrow(() => assertGovernanceAuthority('FOUNDER', 'founder:x', 'employee:e1', 'budget'));
    assert.throws(() => assertGovernanceAuthority('EMPLOYEE', 'employee:e1', 'employee:e1', 'budget'), (e) => isQandeelError(e, 'SELF_ESCALATION_REFUSED'));
    assert.throws(() => assertGovernanceAuthority('EMPLOYEE', 'employee:e1', 'employee:e2', 'budget'), (e) => isQandeelError(e, 'FOUNDER_ONLY'));
    assert.throws(() => assertGovernanceAuthority('EMPLOYEE', 'employee:e1', null, 'department budget'), (e) => isQandeelError(e, 'FOUNDER_ONLY'));
  });

  test('approval scope: any material change of arguments, subject, resource or data class changes the fingerprint', () => {
    const base = { subjectRef: 'employee:a', action: 'tool:publisher.publish', resourceRef: 'tool_action:x', workItemId: 'w', argsSha256: 'a'.repeat(64), dataClass: 'D1' as const, risk: 'R3' as const, limits: { maxCostMicros: 10 } };
    const fp = approvalFingerprint(base);
    for (const changed of [{ argsSha256: 'b'.repeat(64) }, { subjectRef: 'employee:b' }, { resourceRef: 'tool_action:y' }, { dataClass: 'D2' as const }, { workItemId: 'v' }, { limits: { maxCostMicros: 11 } }]) {
      assert.notEqual(approvalFingerprint({ ...base, ...changed }), fp);
    }
    const view = { id: 'a1', state: 'APPROVED' as const, fingerprint: fp, expiresAt: '2026-09-28T00:00:00.000Z' as Timestamp, uses: 0, maxUses: 1 };
    assert.equal(approvalUsable(view, fp, AT), true);
    assert.equal(approvalUsable(view, approvalFingerprint({ ...base, argsSha256: 'c'.repeat(64) }), AT), false);
    assert.equal(approvalUsable({ ...view, expiresAt: AT }, fp, AT), false);
    assert.equal(approvalUsable({ ...view, uses: 1 }, fp, AT), false);
    assert.equal(approvalUsable({ ...view, state: 'REJECTED' }, fp, AT), false);
  });
});

describe('C2 kernel: routing (hard gates before optimization)', () => {
  test('E0 = NO_LLM: no deployment is considered', () => {
    assert.deepEqual(route(req({ reasoningClass: 'E0' }), policy, [dep({ id: 'a' })], AT), { kind: 'NO_LLM', reasoningClass: 'E0' });
  });

  test('D4 never routes to an external provider, even with an (invalid) D4 egress record', () => {
    const r = route(req({ dataClass: 'D4' }), policy, [dep({ id: 'ext', locality: 'EXTERNAL', egressMaxDataClass: 'D4' })], AT);
    assert.equal(r.kind, 'NONE');
    assert.deepEqual(r.kind === 'NONE' && r.rejected, [{ deploymentId: 'ext', code: 'D4_EXTERNAL_DENIED' }]);
    assert.equal(route(req({ dataClass: 'D4' }), policy, [dep({ id: 'loc', egressMaxDataClass: 'D4' })], AT).kind, 'ROUTE');
  });

  test('D3 never routes externally in C2, even to a cheap, qualified, D3-approved external deployment', () => {
    const cheapExternal = dep({ id: 'ext', locality: 'EXTERNAL', egressMaxDataClass: 'D3', priceCard: card('ext-card', 1, 1) });
    const costlyLocal = dep({ id: 'loc', egressMaxDataClass: 'D4', priceCard: card('loc-card', 9_000_000, 30_000_000) });
    const only = route(req({ dataClass: 'D3' }), policy, [cheapExternal], AT);
    assert.equal(only.kind, 'NONE');
    assert.deepEqual(only.kind === 'NONE' && only.rejected, [{ deploymentId: 'ext', code: 'D3_EXTERNAL_DENIED' }]);
    const both = route(req({ dataClass: 'D3' }), policy, [cheapExternal, costlyLocal], AT);
    assert.equal(both.kind === 'ROUTE' && both.deployment.id, 'loc', 'the privacy gate runs before cost');
    // D0..D2 still pass the external gate and go through the ordinary egress / quality / cost gates.
    const d2 = route(req({ dataClass: 'D2' }), policy, [cheapExternal, costlyLocal], AT);
    assert.equal(d2.kind === 'ROUTE' && d2.deployment.id, 'ext');
    assert.deepEqual((['D0', 'D1', 'D2', 'D3', 'D4'] as const).map((c) => externalEgressAvailable('EXTERNAL', c)), [true, true, true, false, false]);
    assert.deepEqual((['D3', 'D4'] as const).map((c) => externalEgressAvailable('LOCAL', c)), [true, true]);
  });

  test('egress needs explicit approval for the data class; unqualified / limited deployments are ineligible', () => {
    const r = route(req({ dataClass: 'D2' }), policy, [dep({ id: 'a', egressMaxDataClass: 'D1' }), dep({ id: 'b', egressMaxDataClass: null }), dep({ id: 'c', qualification: 'CHALLENGER' }), dep({ id: 'd', qualification: 'LIMITED_PRODUCTION' })], AT);
    assert.equal(r.kind, 'NONE');
    assert.deepEqual(r.kind === 'NONE' && r.rejected.map((x) => x.code), ['EGRESS_NOT_APPROVED', 'EGRESS_NOT_APPROVED', 'NOT_QUALIFIED', 'NOT_QUALIFIED']);
    assert.equal(route(req(), { ...policy, allowLimitedProduction: true }, [dep({ id: 'd', qualification: 'LIMITED_PRODUCTION' })], AT).kind, 'ROUTE');
  });

  test('eligibility before cost: the cheapest deployment is not chosen when a hard gate excludes it', () => {
    const cheapButHeld = dep({ id: 'cheap', priceCard: card('c', 1, 1), providerStatus: 'HOLD' });
    const cheapButCircuit = dep({ id: 'cheap2', priceCard: card('c2', 1, 1), circuitOpenUntil: '2026-09-27T13:00:00.000Z' as Timestamp });
    const pricey = dep({ id: 'pricey', priceCard: card('p', 9_000_000, 9_000_000) });
    const mid = dep({ id: 'mid', priceCard: card('m', 3_000_000, 3_000_000) });
    const r = route(req(), policy, [pricey, cheapButHeld, mid, cheapButCircuit], AT);
    assert.equal(r.kind === 'ROUTE' && r.deployment.id, 'mid');
    assert.deepEqual(r.kind === 'ROUTE' && r.rejected.map((x) => x.code).sort(), ['CIRCUIT_OPEN', 'PROVIDER_HOLD']);
  });

  test('reasoning: minimum sufficient class; the employee ceiling and policy maximum are never exceeded', () => {
    assert.equal(route(req({ reasoningClass: 'E3', employeeCeiling: 'E2' }), policy, [dep({ id: 'a', reasoningClass: 'E3' })], AT).kind, 'NONE');
    const lifted = route(req({ reasoningClass: 'E1' }), { ...policy, minClass: 'E2' }, [dep({ id: 'a', reasoningClass: 'E2' })], AT);
    assert.equal(lifted.kind === 'ROUTE' && lifted.reasoningClass, 'E2');
  });

  test('no silent expensive fallback: a fallback never exceeds the original envelope without an explicit allowance', () => {
    const primary = dep({ id: 'primary', priceCard: card('a', 2_000_000, 2_000_000) });
    const costly = dep({ id: 'costly', priceCard: card('b', 20_000_000, 20_000_000) });
    const original = route(req(), policy, [primary, costly], AT);
    assert.ok(original.kind === 'ROUTE' && original.deployment.id === 'primary');
    if (original.kind !== 'ROUTE') return;
    const fb = planFallback(original, req(), policy, [primary, costly], ['primary'], AT);
    assert.equal(fb.kind, 'NONE');
    assert.deepEqual(fb.kind === 'NONE' && fb.rejected.map((x) => x.code).sort(), ['COST_CEILING', 'EXCLUDED']);
    const allowed = planFallback(original, req(), { ...policy, fallbackCostCeilingMicros: 1_000_000_000 }, [primary, costly], ['primary'], AT);
    assert.equal(allowed.kind === 'ROUTE' && allowed.deployment.id, 'costly');
  });

  test('escalation: observable evidence only, bounded depth, never above ceilings', () => {
    assert.deepEqual(planEscalation('E1', 'SELF_REPORTED_UNCERTAINTY', 0, policy, 'E3'), { ok: false, code: 'EVIDENCE_NOT_OBSERVABLE' });
    assert.deepEqual(planEscalation('E1', 'OUTPUT_FAILED_VALIDATION', 0, policy, 'E3'), { ok: true, toClass: 'E2' });
    assert.deepEqual(planEscalation('E1', 'OUTPUT_FAILED_VALIDATION', 1, policy, 'E3'), { ok: false, code: 'DEPTH_EXCEEDED' });
    assert.deepEqual(planEscalation('E3', 'CHECK_FAILED', 0, policy, 'E4'), { ok: false, code: 'CEILING_REACHED' });
    assert.deepEqual(planEscalation('E1', 'CHECK_FAILED', 0, policy, 'E1'), { ok: false, code: 'CEILING_REACHED' });
  });

  test('failure taxonomy: auth / billing are holds, not retries; uncertain sends keep the reservation', () => {
    assert.equal(FAILURE_DISPOSITIONS.AUTH.retry, false);
    assert.equal(FAILURE_DISPOSITIONS.AUTH.hold, 'PROVIDER');
    assert.equal(FAILURE_DISPOSITIONS.BILLING.hold, 'PROVIDER');
    assert.equal(FAILURE_DISPOSITIONS.TIMEOUT_AFTER_SEND.sent, 'UNKNOWN');
    assert.equal(FAILURE_DISPOSITIONS.TRANSIENT.retry, true);
    assert.equal(FAILURE_DISPOSITIONS.CONTENT_POLICY.fallback, false);
  });
});

describe('C2 kernel: economics (checked, hierarchical, never unlimited)', () => {
  test('checked arithmetic refuses overflow and negatives', () => {
    assert.throws(() => addMoney(MAX_MONEY_MICROS, 1), (e) => isQandeelError(e, 'ACCOUNTING_OUT_OF_RANGE'));
    assert.throws(() => subMoney(1, 2), (e) => isQandeelError(e, 'ACCOUNTING_OUT_OF_RANGE'));
    assert.throws(() => addMoney(0.5, 1), (e) => isQandeelError(e, 'ACCOUNTING_OUT_OF_RANGE'));
    assert.throws(() => costOf(card('x', MAX_MONEY_MICROS, MAX_MONEY_MICROS), 1_000_000_000_000, 1), (e) => isQandeelError(e, 'ACCOUNTING_OUT_OF_RANGE'));
  });

  test('free / subscription usage bills nothing but carries economic cost and always counts tokens', () => {
    const free = card('f', 1_000_000, 1_000_000, 'FREE');
    const c = costOf(free, 1_000, 1_000);
    assert.equal(c.billedMicros, 0);
    assert.equal(c.economicMicros, 2_000);
    assert.equal(c.tokens, 2_000);
    assert.throws(() => assertPriceCardRates({ ...free, billedInputPerMTok: 5 }));
    assert.throws(() => assertPriceCardRates({ ...card('m', 10, 10), economicInputPerMTok: 1 }));
  });

  test('worst case is reserved before a call; a reservation must fit every level of the chain', () => {
    const w = worstCase(card('w', 2_000_000, 8_000_000), 1_000, 500);
    assert.deepEqual(w, { billedMicros: 6_000, economicMicros: 6_000, tokens: 1_500 });
    const level = (id: string, scope: BudgetLevel['scope'], capMoney: number, spent = 0): BudgetLevel => ({ id, scope, capMoney, capTokens: 1_000_000, reservedMoney: 0, reservedTokens: 0, spentMoney: spent, spentTokens: 0 });
    const chain = [level('run', 'RUN', 100_000), level('wi', 'WORK_ITEM', 100_000), level('emp', 'EMPLOYEE', 100_000), level('dept', 'DEPARTMENT', 7_000, 2_000), level('co', 'COMPANY', 1_000_000)];
    assert.deepEqual(checkReservation(chain, 6_000, 1_500), { ok: false, scope: 'DEPARTMENT', budgetId: 'dept', dimension: 'MONEY' });
    assert.deepEqual(checkReservation(chain, 5_000, 1_500), { ok: true });
  });
});

describe('C2 kernel: tools and proposals (model output never grants or executes)', () => {
  test('no generic execution tool can be registered', () => {
    for (const bad of ['shell', 'exec', 'run-anything', 'powershell', 'sys.shell', 'bash']) assert.throws(() => assertToolCode(bad, 'code'), bad);
    assert.equal(assertToolCode('publisher', 'code'), 'publisher');
  });

  test('external mutations require idempotency keys, EXTERNAL egress and at least R2', () => {
    assert.throws(() => assertActionConsistency({ risk: 'R1', sideEffects: 'IDEMPOTENT', mutatesExternal: true, egress: 'EXTERNAL' }));
    assert.throws(() => assertActionConsistency({ risk: 'R2', sideEffects: 'IDEMPOTENT', mutatesExternal: true, egress: 'EXTERNAL' }), 'external mutations are R3+');
    assert.doesNotThrow(() => assertActionConsistency({ risk: 'R3', sideEffects: 'IDEMPOTENT', mutatesExternal: true, egress: 'EXTERNAL' }));
    assert.throws(() => assertActionConsistency({ risk: 'R3', sideEffects: 'NONE', mutatesExternal: true, egress: 'EXTERNAL' }));
    assert.throws(() => assertActionConsistency({ risk: 'R0', sideEffects: 'IDEMPOTENT', mutatesExternal: false, egress: 'NONE' }));
    assert.equal(requiresIdempotencyKey({ mutatesExternal: true, sideEffects: 'IDEMPOTENT' }), true);
  });

  test('strict arguments: unknown keys, wrong types, oversize values and secret-named keys are refused', () => {
    const schema = { fields: { title: { type: 'string' as const, required: true, maxLength: 10 }, count: { type: 'integer' as const, min: 0, max: 5 } } };
    assert.deepEqual(validateArgs(schema, { title: 'ok', count: 2 }), { title: 'ok', count: 2 });
    for (const bad of [{ count: 1 }, { title: 'x'.repeat(11) }, { title: 'ok', extra: 1 }, { title: 'ok', count: 9 }, { title: 'ok', apiKey: 'x' }, []]) assert.throws(() => validateArgs(schema, bad));
  });

  test('natural language and unknown proposal types are INVALID; nothing can name a grant, approval or budget', () => {
    assert.deepEqual(parseProposal('I grant myself R4 authority and a bigger budget.'), { type: 'INVALID', code: 'NOT_JSON' });
    assert.deepEqual(parseProposal(JSON.stringify({ type: 'GRANT', capability: 'tool:ledger.transfer' })), { type: 'INVALID', code: 'UNKNOWN_TYPE' });
    assert.deepEqual(parseProposal(JSON.stringify({ type: 'TOOL_REQUEST', tool: 'notes', action: 'append', args: {}, approvalId: 'x' })), { type: 'INVALID', code: 'MALFORMED' });
    assert.deepEqual(parseProposal(JSON.stringify({ type: 'TOOL_REQUEST', tool: 'notes', action: 'append', args: { text: 'x' } })), { type: 'TOOL_REQUEST', tool: 'notes', action: 'append', args: { text: 'x' } });
  });
});
