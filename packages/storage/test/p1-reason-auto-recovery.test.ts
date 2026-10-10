/**
 * P1-REASON-AUTO-RECOVERY-01 — Adaptive Intelligence at the store boundary:
 *   - an existing profile (stored before AUTO existed, as the LIVE CEO's) keeps its exact form and means DEFAULT;
 *   - AUTO on / off is the same governed EMPLOYEE_REASONING_PROFILE act: previewed (with the certifications it makes
 *     REVIEW_DUE — a material change, no exemption), version-safe, in Employee history and content-free audit;
 *   - a newly created Employee selects with AUTO but stays a CANDIDATE that runs nothing (activation is unchanged);
 *   - a Founder one-task level is pinned at reservation: neither below nor above it.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Id } from '@qandeel-company/domain';
import { reasoningSelectionOf } from '@qandeel-company/governance';

import { AcademyStore, CommunicationStore, FounderActionStore, FounderAuthStore } from '../src/index.js';
import { reserveBudget } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { GOVERNED_KIND, seed, testManifest, type Seed } from './c2-helpers.js';
import { academyWorld, certify, claimFor } from './c3-helpers.js';
import { harness, type Harness } from './helpers.js';

function withSeed(fn: (h: Harness, s: Seed, actions: FounderActionStore, sess: ReturnType<FounderAuthStore['redeemLaunchToken']>['session']) => void): void {
  const h = harness();
  try {
    const s = seed(h.store);
    const auth = FounderAuthStore.for(h.store);
    const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
    fn(h, s, FounderActionStore.for(h.store, auth), session);
  } finally {
    h.close();
  }
}
const refusedWith = (reason: string) => (e: unknown): boolean => isQandeelError(e) && e.details.reason === reason;
/** Writes the profile exactly as every Employee stored before P1-REASON-AUTO-RECOVERY-01 carries it (no selection key). */
const legacy = (h: Harness, id: Id, json = '{"ceilingClass":"E2","costDiscipline":"BALANCED","defaultClass":"E1"}'): void => void storeContext(h.store).db.run('UPDATE employees SET cognitive_profile_json = ?, version = version + 1 WHERE id = ?', json, id);
const storedProfile = (h: Harness, id: Id): string => storeContext(h.store).db.get<{ p: string }>('SELECT cognitive_profile_json AS p FROM employees WHERE id = ?', id)?.p ?? '';

describe('P1-REASON-AUTO-RECOVERY-01: existing Employees are unchanged until the Founder confirms AUTO', () => {
  test('a stored pre-AUTO profile reads as DEFAULT and keeps its exact stored form through a class-only change', () => {
    withSeed((h, s, actions, sess) => {
      legacy(h, s.employee.id);
      const e = s.gov.getEmployee(s.employee.id);
      assert.equal(e.cognitiveProfile.selection, undefined);
      assert.equal(reasoningSelectionOf(e.cognitiveProfile), 'DEFAULT');
      assert.equal(s.gov.reasoningControl(e.id).selection, 'DEFAULT');
      const p = actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: e.id, ceilingClass: 'E3' });
      assert.deepEqual([p.payload.previousSelection, p.payload.newSelection], ['DEFAULT', 'DEFAULT']);
      actions.confirm(sess, p.id, p.fingerprint);
      assert.equal(storedProfile(h, e.id), '{"ceilingClass":"E3","costDiscipline":"BALANCED","defaultClass":"E1"}', 'no selection key appears for a class-only change');
      const hist = s.gov.employeeHistory(e.id).filter((x) => x.changeKind === 'PROFILE');
      assert.deepEqual([hist[0]?.fromState, hist[0]?.toState], ['E1/E2', 'E1/E3'], 'the D-L1-44 history form');
    });
  });

  test('turning AUTO on is the governed profile act: the preview names the selection and the certifications that become REVIEW_DUE; the confirm writes it with history and audit; off again is the same act', () => {
    withSeed((h, s, actions, sess) => {
      legacy(h, s.employee.id);
      const w = academyWorld(h, s);
      const { certificationId } = certify(h, s, s.employee, w);
      const academy = AcademyStore.for(h.store);
      const before = s.gov.getEmployee(s.employee.id);
      const p = actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: before.id, selection: 'AUTO', reasonCode: 'founder.reasoning_auto' });
      assert.deepEqual([p.payload.previousSelection, p.payload.newSelection, p.payload.previousDefault, p.payload.newDefault, p.payload.previousCeiling, p.payload.newCeiling], ['DEFAULT', 'AUTO', 'E1', 'E1', 'E2', 'E2']);
      assert.deepEqual(p.payload.certificationsReviewDue, [certificationId], 'material: the consequence is shown before the confirm (no exemption)');
      assert.deepEqual([p.payload.authorityChange, p.payload.budgetChange, p.payload.providerCall], ['NONE', 'NONE', 'NONE']);
      assert.equal(reasoningSelectionOf(s.gov.getEmployee(before.id).cognitiveProfile), 'DEFAULT', 'a preview changes nothing');
      actions.confirm(sess, p.id, p.fingerprint);
      const after = s.gov.getEmployee(before.id);
      assert.deepEqual(after.cognitiveProfile, { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED', selection: 'AUTO' });
      assert.equal(after.version, before.version + 1);
      assert.equal(academy.certifications(before.id).find((c) => c.id === certificationId)?.status, 'REVIEW_DUE');
      const hist = s.gov.employeeHistory(before.id).filter((x) => x.changeKind === 'PROFILE');
      assert.deepEqual([hist.at(-1)?.fromState, hist.at(-1)?.toState], ['E1/E2/DEFAULT', 'E1/E2/AUTO']);
      const audit = storeContext(h.store).db.all<{ details_json: string }>(`SELECT details_json FROM audit_events WHERE action = 'employee.reasoning_profile_changed' ORDER BY rowid`);
      assert.deepEqual(JSON.parse(audit.at(-1)?.details_json ?? '{}'), { from: 'E1/E2/DEFAULT', to: 'E1/E2/AUTO', certificationsReviewDue: 1 });
      assert.throws(() => actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: before.id, selection: 'AUTO' }), refusedWith('PROFILE_UNCHANGED'));
      assert.throws(() => actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: before.id, selection: 'SMART' }), refusedWith('REASONING_SELECTION'));
      const off = actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: before.id, selection: 'DEFAULT' });
      actions.confirm(sess, off.id, off.fingerprint);
      assert.equal(reasoningSelectionOf(s.gov.getEmployee(before.id).cognitiveProfile), 'DEFAULT');
    });
  });
});

describe('P1-REASON-AUTO-RECOVERY-01: new Employees, and the pinned Founder level', () => {
  test('a newly created Employee selects with AUTO and is still a CANDIDATE that cannot be asked for a reply (activation and certification are unchanged)', () => {
    withSeed((h, s) => {
      const e = s.gov.createEmployee(s.founder, { name: { given: 'Nour', family: 'Fahmy' }, profile: {}, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: 'role:analyst', positionRef: 'position:analyst', departmentId: s.employee.departmentId as Id, managerRef: s.founder });
      assert.deepEqual([e.state, e.cognitiveProfile.selection], ['CANDIDATE', 'AUTO']);
      const comm = CommunicationStore.for(h.store);
      const thread = comm.directThread(s.founder, e.id);
      assert.throws(() => comm.send(s.founder, thread.id, { purpose: 'QUESTION', body: 'Plan the regional launch.', responseRequired: true }), (err: unknown) => isQandeelError(err) && err.code === 'EMPLOYEE_NOT_ELIGIBLE');
    });
  });

  test('a Founder one-task level is pinned at reservation: a call above it is refused, as a call below it always was', () => {
    withSeed((h, s, actions, sess) => {
      const modelId = s.gov.deployment(s.deploymentId).modelId;
      const d = s.gov.registerDeployment(s.founder, { code: 'local-e2', modelId, pinnedRevision: 'r1', reasoningClass: 'E2', contextWindowTokens: 100_000, maxOutputTokens: 4_096, taskClasses: ['draft.memo'] });
      const card = s.gov.addPriceCard(s.founder, d.id, { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: 6_000_000, billedOutputPerMTok: 24_000_000, billedPerCall: 0, economicInputPerMTok: 6_000_000, economicOutputPerMTok: 24_000_000, economicPerCall: 0 });
      for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED'] as const) s.gov.setQualification(s.founder, d.id, q, 'qualification.step');
      s.gov.approveEgress(s.founder, d.id, 'D3', 'egress.approved');
      const { workItem } = h.store.createWorkItem({ objective: 'pinned work', ownerRef: s.employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', dataClass: 'D1', instructions: 'x' } });
      s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 100_000, capTokens: 100_000, reasonCode: 'seed' });
      const p = actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: workItem.id, reasoningClass: 'E1' });
      actions.confirm(sess, p.id, p.fingerprint);
      h.store.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
      const { claim, begun } = claimFor(h, workItem.id);
      assert.ok(begun.ok);
      const manifest = testManifest(h, claim.fence, s.employee.id);
      const above = reserveBudget(h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'ESCALATION', deploymentId: d.id, priceCardId: card.id, routePolicyId: s.policyId, money: 1_000, tokens: 2_000, contextManifestId: manifest });
      assert.ok(!above.ok && above.code === 'ROUTE_NO_LONGER_ELIGIBLE' && above.detail === 'ABOVE_REASONING_OVERRIDE', JSON.stringify(above));
      const at = reserveBudget(h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: s.deploymentId, priceCardId: s.priceCardId, routePolicyId: s.policyId, money: 1_000, tokens: 2_000, contextManifestId: manifest });
      assert.ok(at.ok, 'at the pinned class it reserves');
    });
  });

  test('D-P1-04 review: a manual level below the route minimum is refused at the preview and the confirm (never lifted), the level view names it, and the reservation compares with the exact manual class', () => {
    withSeed((h, s, actions, sess) => {
      const modelId = s.gov.deployment(s.deploymentId).modelId;
      const d = s.gov.registerDeployment(s.founder, { code: 'local-e2', modelId, pinnedRevision: 'r1', reasoningClass: 'E2', contextWindowTokens: 100_000, maxOutputTokens: 4_096, taskClasses: ['draft.memo'] });
      const card = s.gov.addPriceCard(s.founder, d.id, { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: 6_000_000, billedOutputPerMTok: 24_000_000, billedPerCall: 0, economicInputPerMTok: 6_000_000, economicOutputPerMTok: 24_000_000, economicPerCall: 0 });
      for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED'] as const) s.gov.setQualification(s.founder, d.id, q, 'qualification.step');
      s.gov.approveEgress(s.founder, d.id, 'D3', 'egress.approved');
      const item = (): Id => {
        const { workItem } = h.store.createWorkItem({ objective: 'pinned work', ownerRef: s.employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', dataClass: 'D1', instructions: 'x' } });
        s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 100_000, capTokens: 100_000, reasonCode: 'seed' });
        return workItem.id;
      };
      // Recorded while the route minimum was E1; a preview taken then is confirmed only after the minimum is raised.
      const early = item();
      const set = actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: early, reasoningClass: 'E1' });
      actions.confirm(sess, set.id, set.fingerprint);
      const late = item();
      const stale = actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: late, reasoningClass: 'E1' });
      assert.equal(stale.payload.effectiveClass, 'E1', 'the preview names the exact class it will run at');
      const raised = s.gov.createRoutePolicy(s.founder, 'draft.memo', { minClass: 'E2', maxClass: 'E2', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 5, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 50_000 } });
      assert.throws(() => actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: item(), reasoningClass: 'E1' }), refusedWith('BELOW_ROUTE_POLICY'));
      assert.throws(() => actions.confirm(sess, stale.id, stale.fingerprint), refusedWith('BELOW_ROUTE_POLICY'), 'a confirm re-runs the same check and refuses');
      assert.equal(s.gov.reasoningControl(s.employee.id).overrides.some((o) => o.workItemId === late), false, 'nothing recorded for the refused confirm');
      assert.equal(s.gov.employeeIntelligence(s.employee.id, 'draft.memo').levels.find((l) => l.reasoningClass === 'E1')?.availability, 'BELOW_ROUTE_POLICY');
      // The early E1 level: the reservation compares with E1 exactly, so the E2 deployment the minimum would lift it to is refused.
      h.store.transitionWorkItem(early, { to: 'READY', reasonCode: 'release' });
      const { claim, begun } = claimFor(h, early);
      assert.ok(begun.ok);
      const manifest = testManifest(h, claim.fence, s.employee.id);
      const lifted = reserveBudget(h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: d.id, priceCardId: card.id, routePolicyId: raised.id as Id, money: 1_000, tokens: 2_000, contextManifestId: manifest });
      assert.ok(!lifted.ok && lifted.code === 'ROUTE_NO_LONGER_ELIGIBLE' && lifted.detail === 'ABOVE_REASONING_OVERRIDE', JSON.stringify(lifted));
    });
  });
});
