/**
 * L1-01 storage proofs: immutable price schedules, truthful settlement (cache hits, UTC bands), model identity
 * checks, governed provisioning through the canonical catalog APIs and the PROVIDER_PROVISION confirmation.
 * L1-PROOF: storage-pricing
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Id } from '@qandeel-company/domain';

/** A datastore gate: the store surfaces a refused write as STORAGE_INVARIANT (the trigger text never travels). */
const gate = (e: unknown): boolean => isQandeelError(e, 'STORAGE_INVARIANT');
import { actualCost, worstCase, type PriceSchedule, type ProviderProvisioningProfile } from '@qandeel-company/governance';

import { FounderActionStore, FounderAuthStore, GovernanceStore, type PriceCardInput } from '../src/index.js';
import { reserveBudget, settleReservation } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { claimGoverned, governedItem, seed, testManifest } from './c2-helpers.js';
import { harness } from './helpers.js';

const schedule: PriceSchedule = {
  offPeakInputPerMTok: 150_000,
  offPeakCachedInputPerMTok: 3_000,
  offPeakOutputPerMTok: 600_000,
  peakWindows: [{ fromMinute: 60, toMinute: 240 }, { fromMinute: 360, toMinute: 600 }],
  peakWeekdays: [1, 2, 3, 4, 5],
  holidayDates: ['2026-10-01'],
  basisSource: 'https://api-docs.deepseek.com/quick_start/pricing',
  basisDate: '2026-10-05',
};
const banded: PriceCardInput = { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: 300_000, billedOutputPerMTok: 1_200_000, billedPerCall: 0, economicInputPerMTok: 300_000, economicOutputPerMTok: 1_200_000, economicPerCall: 0, billedCachedInputPerMTok: 6_000, schedule };

const profile: ProviderProvisioningProfile = {
  code: 'test-flash',
  provider: { code: 'testprov', locality: 'EXTERNAL', credentialRef: 'vault:testprov-company' },
  model: { code: 'test-flash', expectedPublicName: 'Test-Flash-1.0' },
  deployments: [
    { code: 'test-flash-e1', reasoningClass: 'E1', pinnedRevision: 'alias-2026-10', contextWindowTokens: 65_536, maxOutputTokens: 4_096, taskClasses: ['founder.reply'] },
    { code: 'test-flash-e2', reasoningClass: 'E2', pinnedRevision: 'alias-2026-10', contextWindowTokens: 131_072, maxOutputTokens: 16_384, taskClasses: ['founder.reply'] },
  ],
  priceCard: banded,
  egressMaxDataClass: 'D2',
  qualificationTarget: 'LIMITED_PRODUCTION',
  routePolicies: [{ taskClass: 'founder.reply', body: { minClass: 'E1', maxClass: 'E2', allowLimitedProduction: true, maxRetriesPerCall: 1, maxCallsPerRun: 4, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 200_000 } } }],
};

/** A verified Founder session on this workspace (the C5 launch-token path), for the governed confirmation. */
function session(h: ReturnType<typeof harness>) {
  const auth = FounderAuthStore.for(h.store);
  const { session: sess } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
  return { auth, sess };
}

describe('L1 storage: price schedules are part of the immutable card', () => {
  test('a schedule persists with the card, a cached rate needs a schedule, the datastore refuses a discount above the peak rates, and the card is immutable', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      const card = s.gov.addPriceCard(s.founder, s.deploymentId, banded);
      assert.equal(card.billedCachedInputPerMTok, 6_000);
      assert.deepEqual(card.schedule, { ...schedule, peakWeekdays: [1, 2, 3, 4, 5], holidayDates: ['2026-10-01'] });
      assert.equal(s.gov.priceCard(card.id).schedule?.basisDate, '2026-10-05');
      assert.equal(s.gov.routingSnapshot('draft.memo').deployments.find((d) => d.id === s.deploymentId)?.priceCard?.schedule?.offPeakInputPerMTok, 150_000, 'routing sees the same basis');
      assert.throws(() => s.gov.addPriceCard(s.founder, s.deploymentId, { ...banded, schedule: null }), (e) => isQandeelError(e, 'VALIDATION_FAILED'), 'a cached rate travels only with a schedule');
      assert.throws(() => s.gov.addPriceCard(s.founder, s.deploymentId, { ...banded, schedule: { ...schedule, offPeakOutputPerMTok: 1_200_001 } }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
      // Datastore gate: a direct schedule row above the peak rates is refused even without the kernel check.
      const ctx = storeContext(h.store);
      assert.throws(
        () => ctx.db.immediate('attack', () => ctx.db.run(`INSERT INTO price_card_schedules (price_card_id, billed_cached_input_per_mtok, off_peak_input_per_mtok, off_peak_cached_input_per_mtok, off_peak_output_per_mtok, peak_windows_json, peak_weekdays_json, holiday_dates_json, basis_source, basis_date, created_at) VALUES (?, 1, 2000001, 1, 1, '[{"fromMinute":0,"toMinute":1}]', '[1]', '[]', 'https://x.example/p', '2026-10-05', ?)`, s.priceCardId, '2026-10-05T00:00:00.000Z')),
        gate,
      );
      assert.throws(() => ctx.db.immediate('attack', () => ctx.db.run('UPDATE price_card_schedules SET off_peak_input_per_mtok = 1 WHERE price_card_id = ?', card.id)), gate);
      assert.throws(() => ctx.db.immediate('attack', () => ctx.db.run('DELETE FROM price_card_schedules WHERE price_card_id = ?', card.id)), gate);
      const { billedCachedInputPerMTok: _cached, schedule: _schedule, ...flatInput } = banded;
      void _cached;
      void _schedule;
      const plain = s.gov.addPriceCard(s.founder, s.deploymentId, flatInput);
      assert.equal(plain.schedule, null);
      assert.equal(plain.billedCachedInputPerMTok, 300_000, 'without a schedule cached input bills at the fresh rate');
      assert.equal(plain.version, 3);
    } finally {
      h.close();
    }
  });
});

describe('L1 storage: settlement records the truthful provider bill', () => {
  test('reservation holds the peak cache-miss worst case; settlement bills cache hits at the cached rate and the band of the settling clock; the usage row carries both; the datastore refuses more cached than input', () => {
    // Tuesday 2026-10-13 02:00 UTC (peak) at open; the clock then moves into off-peak hours.
    const h = harness();
    try {
      h.clock.advance(Date.UTC(2026, 9, 13, 2, 0, 0) - h.clock.nowMs());
      const s = seed(h.store);
      const card = s.gov.addPriceCard(s.founder, s.deploymentId, banded);
      governedItem(h, s);
      const { claim } = claimGoverned(h);
      const worst = worstCase(card, 10_000, 1_000);
      const r = reserveBudget(h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: s.deploymentId, priceCardId: card.id, routePolicyId: s.policyId, money: worst.economicMicros, tokens: worst.tokens, contextManifestId: testManifest(h, claim.fence, s.employee.id) });
      assert.ok(r.ok);
      if (!r.ok) return;
      assert.equal(s.gov.budgetFor('COMPANY', 'company')?.reservedMoney, 3_000 + 1_200, 'peak + all cache miss + the output ceiling');
      // Settle during peak with 8 000 of 10 000 input tokens served from cache.
      settleReservation(h.store, claim.fence, r.reservation.id, { inputTokens: 10_000, outputTokens: 500, cachedInputTokens: 8_000, withinBounds: true, sessionId: null, outcome: 'OK' });
      const [u] = s.gov.usage({ runId: claim.fence.runId });
      assert.ok(u);
      assert.equal(u.billingBand, 'PEAK');
      assert.equal(u.cachedInputTokens, 8_000);
      // 2 000 miss @ 300 000 + 8 000 hit @ 6 000 + 500 out @ 1 200 000 = 600 + 48 + 600 micros.
      assert.equal(u.billedMicros, 600 + 48 + 600);
      assert.equal(u.economicMicros, 3_000 + 600, 'the governed economic cost is flat');
      assert.equal(u.economicMicros, actualCost(card, { inputTokens: 10_000, outputTokens: 500, cachedInputTokens: 8_000 }, '2026-10-13T02:00:00.000Z').economicMicros);
      assert.equal(s.gov.budgetFor('COMPANY', 'company')?.spentMoney, 3_600);
      assert.equal(s.gov.budgetFor('COMPANY', 'company')?.reservedMoney, 0, 'the unused worst case went back');
      // A second call (its own run) settled off-peak (12:00 UTC) with no cache hits.
      h.clock.advance(10 * 3_600_000);
      governedItem(h, s);
      const second = claimGoverned(h).claim;
      const r2 = reserveBudget(h.store, second.fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: s.deploymentId, priceCardId: card.id, routePolicyId: s.policyId, money: worst.economicMicros, tokens: worst.tokens, contextManifestId: testManifest(h, second.fence, s.employee.id) });
      assert.ok(r2.ok);
      if (!r2.ok) return;
      settleReservation(h.store, second.fence, r2.reservation.id, { inputTokens: 10_000, outputTokens: 1_000, withinBounds: true, sessionId: null, outcome: 'OK' });
      const off = s.gov.usage({ runId: second.fence.runId }).find((x) => x.reservationId === r2.reservation.id);
      assert.deepEqual([off?.billingBand, off?.cachedInputTokens, off?.billedMicros, off?.economicMicros], ['OFF_PEAK', 0, 1_500 + 600, 3_000 + 1_200]);
      assert.deepEqual(s.gov.accountingInvariants(), []);
      // Datastore gate: cached input never exceeds input.
      const ctx = storeContext(h.store);
      assert.throws(() => ctx.db.immediate('attack', () => ctx.db.run('UPDATE usage_records SET cached_input_tokens = 99999 WHERE id = ?', u.id)), gate);
      assert.throws(
        () => ctx.db.immediate('attack', () => ctx.db.run(`INSERT INTO usage_records (id, reservation_id, run_id, work_item_id, employee_id, department_id, purpose, attempt_kind, input_tokens, output_tokens, charged_tokens, billed_micros, economic_micros, within_bounds, outcome, created_at, cached_input_tokens, billing_band) SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reservation_id, run_id, work_item_id, employee_id, department_id, purpose, attempt_kind, 10, 1, 11, 1, 1, 1, 'OK', created_at, 11, 'PEAK' FROM usage_records WHERE id = ?`, u.id)),
        gate,
      );
      // Historical basis: a NEW card version (new rates) changes nothing recorded under the old one.
      s.gov.addPriceCard(s.founder, s.deploymentId, { ...banded, billedInputPerMTok: 600_000, economicInputPerMTok: 600_000 });
      const again = s.gov.usage({ runId: claim.fence.runId }).find((x) => x.id === u.id);
      assert.deepEqual([again?.billedMicros, again?.priceCardVersion, s.gov.priceCard(card.id).billedInputPerMTok], [1_248, 2, 300_000], 'history and the old card are unchanged');
    } finally {
      h.close();
    }
  });
});

describe('L1 storage: identity checks and governed provisioning', () => {
  test('identity checks are append-only system facts; provisioning fails closed without a fresh MATCH, registers the whole profile through the catalog APIs at LIMITED_PRODUCTION with D2 egress, creates the first bounded Company cap, and never repeats', () => {
    const h = harness();
    try {
      const { auth, sess } = session(h);
      const founderRef = sess.founderRef;
      const gov = GovernanceStore.for(h.store);
      // No check yet: provisioning is refused before anything is registered.
      assert.throws(() => auth.withSession(sess, () => gov.provisionProviderProfile(founderRef, profile, { capMoney: 2_000_000, capTokens: 5_000_000, reasonCode: 'l1.pilot' })), (e) => isQandeelError(e, 'VALIDATION_FAILED') && e.details.reason === 'IDENTITY_CHECK_REQUIRED');
      // A DRIFT check does not allow provisioning either.
      gov.recordModelIdentityCheck({ providerCode: 'testprov', modelCode: 'test-flash', expectedName: 'Test-Flash-1.0', observedName: 'Test-Flash-2.0', result: 'DRIFT' });
      assert.throws(() => auth.withSession(sess, () => gov.provisionProviderProfile(founderRef, profile, { capMoney: 2_000_000, capTokens: 5_000_000, reasonCode: 'l1.pilot' })), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
      const check = gov.recordModelIdentityCheck({ providerCode: 'testprov', modelCode: 'test-flash', expectedName: 'Test-Flash-1.0', observedName: 'Test-Flash-1.0', observedContextWindow: 1_048_576, observedMaxOutputTokens: 393_216, result: 'MATCH' });
      assert.equal(gov.modelIdentityChecks('testprov', 'test-flash')[0]?.id, check.id, 'newest first');
      const ctx = storeContext(h.store);
      assert.throws(() => ctx.db.immediate('attack', () => ctx.db.run(`UPDATE model_identity_checks SET result = 'MATCH' WHERE result = 'DRIFT'`)), gate);
      assert.throws(() => gov.recordModelIdentityCheck({ providerCode: 'testprov', modelCode: 'test-flash', expectedName: 'Test-Flash-1.0', observedName: 'sk-' + 'proj-' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', result: 'MATCH' }), (e) => isQandeelError(e, 'VALIDATION_FAILED'), 'a name is never secret material');
      // Without Founder authority the catalog is not touched (a ref is not authentication).
      assert.throws(() => gov.provisionProviderProfile(founderRef, profile, { capMoney: 2_000_000, capTokens: 5_000_000, reasonCode: 'l1.pilot' }), (e) => isQandeelError(e, 'FOUNDER_SURFACE_UNAVAILABLE'));
      const out = auth.withSession(sess, () => gov.provisionProviderProfile(founderRef, profile, { capMoney: 2_000_000, capTokens: 5_000_000, reasonCode: 'l1.pilot' }));
      assert.equal(out.identityCheckId, check.id);
      assert.equal(out.deploymentIds.length, 2);
      const provider = gov.provider(out.providerId);
      assert.deepEqual([provider.code, provider.locality, provider.credentialRef, provider.status], ['testprov', 'EXTERNAL', 'vault:testprov-company', 'ACTIVE']);
      for (const id of out.deploymentIds) {
        const d = gov.deployment(id);
        assert.deepEqual([d.qualification, d.egressMaxDataClass, d.status, d.pinnedRevision], ['LIMITED_PRODUCTION', 'D2', 'ACTIVE', 'alias-2026-10']);
        assert.equal(gov.priceCard(d.priceCardId as Id).schedule?.offPeakInputPerMTok, 150_000);
      }
      const company = gov.budgetFor('COMPANY', 'company');
      assert.deepEqual([company?.capMoney, company?.capTokens, company?.currency], [2_000_000, 5_000_000, 'USD'], 'the first bounded cap; never unlimited');
      const snap = gov.routingSnapshot('founder.reply');
      assert.equal(snap.policy?.allowLimitedProduction, true);
      assert.equal(snap.deployments.filter((d) => d.providerCode === 'testprov').length, 2);
      assert.throws(() => auth.withSession(sess, () => gov.provisionProviderProfile(founderRef, profile, { capMoney: 2_000_000, capTokens: 5_000_000, reasonCode: 'l1.pilot' })), (e) => isQandeelError(e, 'INVALID_TRANSITION'), 'never re-provisioned');
    } finally {
      h.close();
    }
  });

  test('PROVIDER_PROVISION is a structured-only confirmation: unknown or unregistered profiles and a stale identity are refused at preview; the preview shows the cap and peak rates; the confirm provisions inside the one transaction; an unlimited or zero cap is refused', () => {
    const h = harness();
    try {
      const { auth, sess } = session(h);
      const gov = GovernanceStore.for(h.store);
      const none = FounderActionStore.for(h.store, auth);
      assert.throws(() => none.preview(sess, 'PROVIDER_PROVISION', { profileCode: 'test-flash', capMoney: 1, capTokens: 1 }), (e) => isQandeelError(e, 'VALIDATION_FAILED'), 'no profile registered by the host');
      const actions = FounderActionStore.for(h.store, auth, { profiles: [profile] });
      assert.deepEqual(actions.provisioningProfiles().map((p) => [p.code, p.providerCode, p.expectedPublicName]), [['test-flash', 'testprov', 'Test-Flash-1.0']]);
      assert.throws(() => actions.preview(sess, 'PROVIDER_PROVISION', { profileCode: 'other', capMoney: 1_000_000, capTokens: 1_000_000 }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
      assert.throws(() => actions.preview(sess, 'PROVIDER_PROVISION', { profileCode: 'test-flash', capMoney: 1_000_000, capTokens: 1_000_000 }), (e) => isQandeelError(e, 'VALIDATION_FAILED') && e.details.reason === 'IDENTITY_CHECK_REQUIRED');
      gov.recordModelIdentityCheck({ providerCode: 'testprov', modelCode: 'test-flash', expectedName: 'Test-Flash-1.0', observedName: 'Test-Flash-1.0', result: 'MATCH' });
      assert.throws(() => actions.preview(sess, 'PROVIDER_PROVISION', { profileCode: 'test-flash', capMoney: 0, capTokens: 1_000_000 }), (e) => isQandeelError(e, 'VALIDATION_FAILED'), 'a zero cap');
      assert.throws(() => actions.preview(sess, 'PROVIDER_PROVISION', { profileCode: 'test-flash', capMoney: Number.MAX_SAFE_INTEGER, capTokens: 1_000_000 }), (e) => isQandeelError(e, 'ACCOUNTING_OUT_OF_RANGE'), 'an unlimited cap');
      const p = actions.preview(sess, 'PROVIDER_PROVISION', { profileCode: 'test-flash', capMoney: 2_000_000, capTokens: 5_000_000 });
      assert.equal(p.intentKind, 'PROVIDER_PROVISION');
      assert.deepEqual([p.payload.capMoney, p.payload.peakInputPerMTok, p.payload.peakCachedInputPerMTok, p.payload.peakOutputPerMTok, p.payload.offPeakInputPerMTok, p.payload.egressMaxDataClass, p.payload.qualificationTarget, p.payload.observedPublicName], [2_000_000, 300_000, 6_000, 1_200_000, 150_000, 'D2', 'LIMITED_PRODUCTION', 'Test-Flash-1.0'], 'the exact cap and basis are visible before anything happens');
      assert.ok(!JSON.stringify(p.payload).includes('vault:'), 'the payload names no credential reference value beyond the profile code');
      assert.equal(gov.routingSnapshot('founder.reply').deployments.length, 0, 'a preview registers nothing');
      const out = actions.confirm(sess, p.id, p.fingerprint);
      assert.ok(out.resultRef.startsWith('provider:'));
      assert.equal(gov.routingSnapshot('founder.reply').deployments.length, 2);
      assert.equal(gov.budgetFor('COMPANY', 'company')?.capMoney, 2_000_000);
      assert.throws(() => actions.preview(sess, 'PROVIDER_PROVISION', { profileCode: 'test-flash', capMoney: 2_000_000, capTokens: 5_000_000 }), (e) => isQandeelError(e, 'INVALID_TRANSITION'), 'already provisioned');
    } finally {
      h.close();
    }
  });
});
