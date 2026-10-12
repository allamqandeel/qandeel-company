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

import { isQandeelError, newId, type Id } from '@qandeel-company/domain';
import { reasoningSelectionOf } from '@qandeel-company/governance';

import { AcademyStore, CommunicationStore, FounderActionStore, FounderAuthStore, OrganizationStore, ReviewStore } from '../src/index.js';
import { claimNext, holdReservation, interruptClaim, recordOrgAct, recoverGovernedOrphans, releaseReservation, reserveBudget, settle, settleReservation } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { C2_KINDS, GOVERNED_KIND, governedItem, seed, testManifest, type Seed } from './c2-helpers.js';
import { academyWorld, certify, claimFor } from './c3-helpers.js';
import { certifiedCandidate, newSeat, placed, reviewedOutput, runFor } from './c4-helpers.js';
import { backoff, harness, type Harness } from './helpers.js';

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

  test('P1-AUTO-E12-01 (D-P1-11): an AUTO Work Item never reserves above E2 (ABOVE_AUTO_POLICY_CAP), re-derived from durable state — with or without a demand, whatever a non-Academy input pins (R1-02); the same E3 deployment stays reservable for a Founder level, a genuine Academy attempt and a DEFAULT Employee', () => {
    withSeed((h, s, actions, sess) => {
      legacy(h, s.employee.id, '{"ceilingClass":"E4","costDiscipline":"BALANCED","defaultClass":"E1","selection":"AUTO"}');
      const modelId = s.gov.deployment(s.deploymentId).modelId;
      const d = s.gov.registerDeployment(s.founder, { code: 'local-e3', modelId, pinnedRevision: 'r1', reasoningClass: 'E3', contextWindowTokens: 100_000, maxOutputTokens: 8_192, taskClasses: ['draft.memo'] });
      const card = s.gov.addPriceCard(s.founder, d.id, { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: 6_000_000, billedOutputPerMTok: 24_000_000, billedPerCall: 0, economicInputPerMTok: 6_000_000, economicOutputPerMTok: 24_000_000, economicPerCall: 0 });
      for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED'] as const) s.gov.setQualification(s.founder, d.id, q, 'qualification.step');
      s.gov.approveEgress(s.founder, d.id, 'D3', 'egress.approved');
      const policy = s.gov.createRoutePolicy(s.founder, 'draft.memo', { minClass: 'E1', maxClass: 'E4', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 5, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 50_000 } });
      const demand = { policy: 'RD-1', level: 'E4', complexity: 'VERY_HIGH', consequence: 'VERY_HIGH', confidence: 'CLEAR', reasons: ['STRATEGIC_PLANNING'] };
      const item = (input: Record<string, unknown>, founderLevel?: 'E3'): Id => {
        const { workItem } = h.store.createWorkItem({ objective: 'auto cap', ownerRef: s.employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', dataClass: 'D1', instructions: 'x', ...input } });
        s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 100_000, capTokens: 100_000, reasonCode: 'seed' });
        if (founderLevel) {
          const p = actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: workItem.id, reasoningClass: founderLevel });
          actions.confirm(sess, p.id, p.fingerprint);
        }
        h.store.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
        return workItem.id;
      };
      const reserveAt = (id: Id, deploymentId: Id, priceCardId: Id): { auto: boolean; r: ReturnType<typeof reserveBudget> } => {
        const { claim, begun } = claimFor(h, id);
        assert.ok(begun.ok);
        const manifest = testManifest(h, claim.fence, s.employee.id);
        return { auto: begun.context.autoReasoning, r: reserveBudget(h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'RETRY', deploymentId, priceCardId, routePolicyId: policy.id as Id, money: 1_000, tokens: 2_000, contextManifestId: manifest }) };
      };
      const auto = reserveAt(item({ reasoningDemand: demand }), d.id, card.id);
      assert.equal(auto.auto, true, 'the run context carries the durable AUTO verdict');
      assert.ok(!auto.r.ok && auto.r.code === 'ROUTE_NO_LONGER_ELIGIBLE' && auto.r.detail === 'ABOVE_AUTO_POLICY_CAP', JSON.stringify(auto.r));
      const autoE1 = reserveAt(item({ reasoningDemand: demand }), s.deploymentId, s.priceCardId);
      assert.ok(autoE1.r.ok, 'at or below E2 an AUTO item reserves as before');
      // Correction R1-02: an AUTO Employee's item without a demand (a CEO brief, a handoff, a review, work queued before) and an
      // item that pins a class outside the Academy are AUTO too — no submitter bypasses the cap by omitting or pinning a class.
      for (const [label, id] of [['AUTO without a demand', item({})], ['a pin outside the Academy', item({ reasoningDemand: demand, reasoningClass: 'E3' })]] as const) {
        const x = reserveAt(id, d.id, card.id);
        assert.equal(x.auto, true, label);
        assert.ok(!x.r.ok && x.r.code === 'ROUTE_NO_LONGER_ELIGIBLE' && x.r.detail === 'ABOVE_AUTO_POLICY_CAP', `${label}: ${JSON.stringify(x.r)}`);
      }
      // The approved exceptions keep E3: the Founder's level (MANUAL), a genuine Academy item (its contract fixes its class)
      // and an Employee whose profile actually selects DEFAULT.
      const founderLevel = reserveAt(item({ reasoningDemand: demand }, 'E3'), d.id, card.id);
      assert.equal(founderLevel.auto, false, 'Founder level');
      assert.ok(founderLevel.r.ok, `Founder level: E3 reservable (${JSON.stringify(founderLevel.r)})`);
      const a = AcademyStore.for(h.store);
      const w = academyWorld(h, s);
      const enrollment = a.enroll(s.founder, s.employee.id, w.programVersionId);
      for (let i = 0; i < 6; i++) a.recordModuleCompletion(s.founder, enrollment.id, `module-${i}`, `evidence:module-${i}`);
      a.advance(enrollment.id);
      const attempt = a.startAttempt(enrollment.id, { scenarioId: w.scenarios.practice, kind: 'SIMULATION', taskClass: 'draft.memo' });
      if (h.store.getWorkItem(attempt.workItemId).state === 'PROPOSED') h.store.transitionWorkItem(attempt.workItemId, { to: 'READY', reasonCode: 'release' });
      s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: attempt.workItemId, capMoney: 100_000, capTokens: 100_000, reasonCode: 'seed' });
      const academy = reserveAt(attempt.workItemId, d.id, card.id);
      assert.equal(academy.auto, false, 'an Academy attempt is never AUTO (answerTask, the one Academy predicate)');
      assert.ok(academy.r.ok, `Academy attempt: E3 reservable (${JSON.stringify(academy.r)})`);
      assert.equal(reasoningSelectionOf(s.gov.getEmployee(s.employee.id).cognitiveProfile), 'AUTO', 'nothing here changes the profile');
      legacy(h, s.employee.id, '{"ceilingClass":"E4","costDiscipline":"BALANCED","defaultClass":"E1","selection":"DEFAULT"}');
      const byDefault = reserveAt(item({ reasoningDemand: demand }), d.id, card.id);
      assert.equal(byDefault.auto, false, 'DEFAULT');
      assert.ok(byDefault.r.ok, `DEFAULT: E3 reservable (${JSON.stringify(byDefault.r)})`);
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

/**
 * P1-AUTO-E12-01 Correction R1-01 (Founder-approved) — a model call that may have been sent and billed, with its outcome
 * unsettled, never lets its Work Item run again on its own: the governed settle and the claim recovery decide it from the
 * run's durable reservations in their own transaction and use the existing RECONCILIATION_REQUIRED hold. The held money is
 * never settled or released by it, the Founder's reconciliation stays the only authorization of a new run, the Founder's
 * cancellation is unchanged, and a provably unsent or settled call keeps the ordinary retry.
 */
describe('P1-AUTO-E12-01 R1-01: no paid re-execution after an uncertain model call without reconciliation', () => {
  type Begun = { id: Id; fence: Parameters<typeof settle>[1]; reserve: () => Id };
  const begin = (h: Harness, s: Seed): Begun => {
    const id = governedItem(h, s);
    const { claim, begun } = claimFor(h, id, `w-${id.slice(0, 8)}`);
    assert.ok(begun.ok);
    const manifest = testManifest(h, claim.fence, s.employee.id);
    const reserve = (): Id => {
      const r = reserveBudget(h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: s.deploymentId, priceCardId: s.priceCardId, routePolicyId: s.policyId, money: 1_000, tokens: 2_000, contextManifestId: manifest });
      assert.ok(r.ok, JSON.stringify(r));
      return r.reservation.id;
    };
    return { id, fence: claim.fence, reserve };
  };
  const money = (s: Seed, runId: Id): unknown[] => s.gov.reservations(runId).map((r) => [r.state, r.reasonCode, r.money, r.tokens]);
  const lastRunCode = (h: Harness, id: Id): string | null | undefined => h.store.runsForWorkItem(id).at(-1)?.failureCode;
  const claimable = (h: Harness): boolean => claimNext(h.store, { ...h.claimOpts('w-next', 60_000), kinds: C2_KINDS }) !== null;
  const withHarness = (fn: (h: Harness, s: Seed) => void): void => {
    const h = harness();
    try {
      fn(h, seed(h.store));
    } finally {
      h.close();
    }
  };

  test('a held (possibly billed) call then a retryable result is held for reconciliation: the job is not re-queued, the money is untouched, and only the Founder\'s RETRY queues it again', () =>
    withHarness((h, s) => {
      const b = begin(h, s);
      holdReservation(h.store, b.fence, b.reserve(), 'TIMEOUT_AFTER_SEND');
      const held = money(s, b.fence.runId);
      const out = settle(h.store, b.fence, { type: 'RETRYABLE_FAILURE', code: 'PROVIDER_FAILURE' }, { backoff });
      assert.deepEqual([out.jobState, out.runState, out.workItemState], ['RECONCILIATION_HOLD', 'RECONCILIATION_REQUIRED', 'BLOCKED']);
      assert.equal(lastRunCode(h, b.id), 'PROVIDER_FAILURE', 'the run keeps its own code (no new failure code)');
      assert.deepEqual(money(s, b.fence.runId), held, 'the held money is neither settled nor released');
      assert.equal(claimable(h), false, 'nothing can run for it');
      const job = h.store.jobsFor(b.id)[0];
      assert.ok(job);
      assert.equal(h.store.resolveReconciliation(job.id, 'RETRY', 'CHECKED', s.founder).jobState, 'QUEUED', 'the Founder\'s reconciliation authorizes one new run');
      assert.deepEqual(money(s, b.fence.runId), held, 'still untouched: reconciling the job is not reconciling the money');
      assert.deepEqual(s.gov.accountingInvariants(), []);
    }));

  test('a call still in flight when its run times out, stops at shutdown or ends unprompted is held the same way (the backstop holds its money)', () =>
    withHarness((h, s) => {
      for (const [result, code] of [
        [{ type: 'RETRYABLE_FAILURE', code: 'RUN_TIMEOUT' }, 'RUN_TIMEOUT'],
        [{ type: 'CANCELLED' }, 'RUN_ABORTED'],
        [{ type: 'RETRYABLE_FAILURE', code: 'PROCESSOR_STOPPED_UNPROMPTED' }, 'PROCESSOR_STOPPED_UNPROMPTED'],
      ] as const) {
        const b = begin(h, s);
        b.reserve();
        const out = settle(h.store, b.fence, result, { backoff });
        assert.deepEqual([out.jobState, out.workItemState], ['RECONCILIATION_HOLD', 'BLOCKED'], code);
        assert.equal(lastRunCode(h, b.id), code);
        assert.deepEqual(s.gov.reservations(b.fence.runId).map((r) => [r.state, r.reasonCode]), [['RECONCILIATION_REQUIRED', 'RUN_ENDED_UNSETTLED']], `${code}: possibly billed, held`);
      }
      assert.equal(claimable(h), false);
    }));

  test('a crash or lost lease while a call may have been sent holds the job instead of resuming it; the orphan recovery holds the money; nothing is claimable afterwards', () =>
    withHarness((h, s) => {
      const b = begin(h, s);
      b.reserve();
      assert.deepEqual(interruptClaim(h.store, h.supervisor, b.fence.jobId, 'LEASE_EXPIRED'), { disposition: 'RECONCILIATION_REQUIRED', jobState: 'RECONCILIATION_HOLD' });
      assert.equal(h.store.getWorkItem(b.id).state, 'BLOCKED');
      assert.equal(recoverGovernedOrphans(h.store, h.supervisor).reservationsHeld, 1);
      assert.deepEqual(s.gov.reservations(b.fence.runId).map((x) => [x.state, x.reasonCode]), [['RECONCILIATION_REQUIRED', 'RUN_INTERRUPTED']]);
      assert.equal(claimable(h), false, 'no resume from the checkpoint, no retry');
    }));

  test('controls: a provably unsent (released) or settled call keeps the ordinary C1 retry and resume; the Founder\'s cancellation is finalized as before, with the money still held', () =>
    withHarness((h, s) => {
      const unsent = begin(h, s);
      releaseReservation(h.store, unsent.fence, unsent.reserve(), 'TRANSIENT');
      assert.equal(settle(h.store, unsent.fence, { type: 'RETRYABLE_FAILURE', code: 'PROVIDER_UNAVAILABLE' }, { backoff }).jobState, 'QUEUED', 'provably unsent: the retry stays');
      const charged = begin(h, s);
      settleReservation(h.store, charged.fence, charged.reserve(), { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, withinBounds: true, sessionId: newId(), outcome: 'FAILED_CHARGED' });
      assert.equal(settle(h.store, charged.fence, { type: 'RETRYABLE_FAILURE', code: 'PROVIDER_UNAVAILABLE' }, { backoff }).jobState, 'QUEUED', 'a settled (charged) failure is not uncertain');
      const crashed = begin(h, s);
      releaseReservation(h.store, crashed.fence, crashed.reserve(), 'TRANSIENT');
      assert.equal(interruptClaim(h.store, h.supervisor, crashed.fence.jobId, 'LEASE_EXPIRED')?.jobState, 'QUEUED', 'a crash with nothing uncertain still resumes');
      const cancelled = begin(h, s);
      holdReservation(h.store, cancelled.fence, cancelled.reserve(), 'TIMEOUT_AFTER_SEND');
      h.store.requestCancellation(cancelled.id, { reasonCode: 'founder.cancel', actorRef: s.founder });
      const out = settle(h.store, cancelled.fence, { type: 'CANCELLED' }, { backoff });
      assert.deepEqual([out.jobState, out.workItemState], ['CANCELLED', 'CANCELLED'], 'the Founder\'s cancellation stands: no hold, and no new run');
      assert.deepEqual(s.gov.reservations(cancelled.fence.runId).map((x) => x.state), ['RECONCILIATION_REQUIRED'], 'its money stays held for reconciliation');
      const crashCancelled = begin(h, s);
      crashCancelled.reserve();
      h.store.requestCancellation(crashCancelled.id, { reasonCode: 'founder.cancel', actorRef: s.founder });
      assert.deepEqual(interruptClaim(h.store, h.supervisor, crashCancelled.fence.jobId, 'LEASE_EXPIRED'), { disposition: 'TERMINATED', jobState: 'CANCELLED' }, 'a cancellation is never turned into a hold or a re-run');
      assert.deepEqual(s.gov.accountingInvariants(), []);
    }));
});

/**
 * P1-AUTO-E12-01 Correction R1-02 — the AUTO cap covers every Work Item of an AUTO Employee, not only a Founder reply that
 * carries a Reasoning Demand: the run's durable verdict (the one `txAutoReasoning` that the runtime guard and `txReserve`
 * share) is AUTO for a CEO brief, a handoff, a review Work Item and a general item, all created by their real paths
 * without a demand; an Academy item and a DEFAULT Employee's item are not.
 */
describe('P1-AUTO-E12-01 R1-02: AUTO covers every non-Academy Work Item of an AUTO Employee', () => {
  test('a CEO brief, a handoff, a review Work Item and a general item, none with a demand, all run under the AUTO verdict; a DEFAULT Employee\'s item does not', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      const verdict = (workItemId: Id): boolean => {
        const { begun } = claimFor(h, workItemId, `w-${workItemId.slice(0, 8)}`);
        assert.ok(begun.ok, JSON.stringify(begun));
        return begun.context.autoReasoning;
      };
      const noDemand = (workItemId: Id): void => assert.equal((h.store.getWorkItem(workItemId).processorInput as { reasoningDemand?: unknown }).reasoningDemand, undefined);
      // A CEO brief (communications), created for the CEO seat holder.
      const ceo = placed(h, s, 'company.ceo');
      assert.equal(reasoningSelectionOf(ceo.cognitiveProfile), 'AUTO', 'a new Employee selects AUTO');
      const brief = CommunicationStore.for(h.store).requestCeoBrief({ subject: 'brief', contextKind: 'APPROVAL', contextRef: 'approval:1', reasonCode: 'brief.test', instructions: 'brief' });
      noDemand(brief.workItemId);
      // A handoff (work delegation down the reporting line).
      const director = placed(h, s, 'director.growth');
      newSeat(h, s, 'growth.analyst-1', 'director.growth');
      const report = placed(h, s, 'growth.analyst-1');
      OrganizationStore.for(h.store).delegateAuthority(s.founder, { employeeId: director.id, capability: 'org.work.delegate', expiresAt: new Date(Date.parse(h.store.now()) + 365 * 86_400_000).toISOString(), purposeCode: 'work', reasonCode: 'delegated' });
      const parent = runFor(h, s, director, { cap: 100_000 });
      const delegated = recordOrgAct(h.store, parent.claim.fence, 1, 'work.delegate', { objective: 'Draft the brief', instructions: 'Keep it short.', taskClass: 'draft.memo', budgetMoney: 80_000, budgetTokens: 10_000, delegateEmployeeId: report.id });
      assert.equal(delegated.outcome, 'DONE');
      const handoff = String(delegated.resultRef).split(':')[1] as Id;
      noDemand(handoff);
      // A review Work Item (a calibrating reviewer's shadow key on a completed output).
      const { reviewer } = certifiedCandidate(h, s);
      const subject = reviewedOutput(h, s, s.employee);
      const request = ReviewStore.for(h.store).requests({ workItemId: subject }).find((r) => r.state === 'OPEN');
      const key = request ? ReviewStore.for(h.store).assignments(request.id).find((a) => a.reviewerEmployeeId === reviewer.id) : undefined;
      assert.ok(key?.reviewWorkItemId, 'the reviewer holds a review Work Item');
      noDemand(key.reviewWorkItemId);
      // A general Employee Work Item.
      const general = governedItem(h, s, report);
      for (const [label, id] of [['CEO brief', brief.workItemId], ['handoff', handoff], ['review', key.reviewWorkItemId], ['general', general]] as const) assert.equal(verdict(id), true, `${label}: AUTO without a demand`);
      legacy(h, report.id);
      assert.equal(verdict(governedItem(h, s, report)), false, 'an Employee whose profile is DEFAULT keeps DEFAULT');
    } finally {
      h.close();
    }
  });
});
