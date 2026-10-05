/**
 * L1-01 economics proofs (pure): time-banded, cached-input billing; worst-case reservations; provisioning profiles.
 * L1-PROOF: economics-bands
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError } from '@qandeel-company/domain';

import { actualCost, assertPriceCardRates, assertPriceSchedule, assertProvisioningProfile, billingBandAt, costOf, normalizeUsage, provisioningProfileDigest, worstCase, type PriceCard, type PriceSchedule, type ProviderProvisioningProfile, type ProvisioningDeployment } from '../src/index.js';

const schedule: PriceSchedule = {
  offPeakInputPerMTok: 150_000,
  offPeakCachedInputPerMTok: 3_000,
  offPeakOutputPerMTok: 600_000,
  peakWindows: [{ fromMinute: 60, toMinute: 240 }, { fromMinute: 360, toMinute: 600 }],
  peakWeekdays: [1, 2, 3, 4, 5],
  holidayDates: ['2026-10-01', '2026-10-02'],
  basisSource: 'https://api-docs.deepseek.com/quick_start/pricing',
  basisDate: '2026-10-05',
};
const card: PriceCard = { id: 'card', version: 1, currency: 'USD', billingMode: 'METERED', billedInputPerMTok: 300_000, billedOutputPerMTok: 1_200_000, billedPerCall: 0, economicInputPerMTok: 300_000, economicOutputPerMTok: 1_200_000, economicPerCall: 0, billedCachedInputPerMTok: 6_000, schedule };
const flat: PriceCard = { id: 'flat', version: 1, currency: 'USD', billingMode: 'METERED', billedInputPerMTok: 300_000, billedOutputPerMTok: 1_200_000, billedPerCall: 10, economicInputPerMTok: 400_000, economicOutputPerMTok: 1_200_000, economicPerCall: 10 };

describe('L1 economics: bands', () => {
  test('UTC band boundaries, weekdays, holidays and the FLAT card; the same instant always gives the same band', () => {
    const tuesday = (hhmm: string): string => `2026-10-13T${hhmm}:00.000Z`;
    assert.deepEqual(['00:59', '01:00', '03:59', '04:00', '05:59', '06:00', '09:59', '10:00', '23:59'].map((t) => billingBandAt(card, tuesday(t))), ['OFF_PEAK', 'PEAK', 'PEAK', 'OFF_PEAK', 'OFF_PEAK', 'PEAK', 'PEAK', 'OFF_PEAK', 'OFF_PEAK']);
    assert.equal(billingBandAt(card, '2026-10-17T02:00:00.000Z'), 'OFF_PEAK', 'Saturday');
    assert.equal(billingBandAt(card, '2026-10-18T02:00:00.000Z'), 'OFF_PEAK', 'Sunday');
    assert.equal(billingBandAt(card, '2026-10-01T02:00:00.000Z'), 'OFF_PEAK', 'a published holiday (Thursday)');
    assert.equal(billingBandAt(card, '2026-10-05T02:00:00.000Z'), 'PEAK', 'a Monday that is not in this card\'s holiday list');
    assert.equal(billingBandAt(flat, '2026-10-13T02:00:00.000Z'), 'FLAT');
    assert.equal(billingBandAt(card, '2026-10-13T02:00:00.000Z'), billingBandAt(card, '2026-10-13T02:00:00.000Z'));
    assert.throws(() => billingBandAt(card, 'not a time'), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
  });

  test('reservation = peak + every input token a cache miss + the configured max output; it never discounts', () => {
    const w = worstCase(card, 10_000, 2_000);
    assert.deepEqual(w, { billedMicros: 3_000 + 2_400, economicMicros: 3_000 + 2_400, tokens: 12_000 });
    assert.deepEqual(costOf(card, 10_000, 2_000), w);
    for (const at of ['2026-10-13T02:00:00.000Z', '2026-10-13T05:00:00.000Z', '2026-10-17T02:00:00.000Z']) {
      const a = actualCost(card, { inputTokens: 10_000, outputTokens: 2_000, cachedInputTokens: 10_000 }, at);
      assert.ok(a.billedMicros <= w.billedMicros, `actual (${a.band}) never exceeds the reservation`);
      assert.equal(a.economicMicros, w.economicMicros, 'the governed economic cost is flat');
    }
  });

  test('actual billing records cache hits and the band truthfully; cached input is a subset of input; ceil per component', () => {
    const peakHit = actualCost(card, { inputTokens: 1_000_000, outputTokens: 10, cachedInputTokens: 1_000_000 }, '2026-10-13T02:00:00.000Z');
    assert.deepEqual([peakHit.band, peakHit.billedMicros, peakHit.cachedInputTokens], ['PEAK', 6_000 + 12, 1_000_000]);
    const peakMixed = actualCost(card, { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 500_000 }, '2026-10-13T02:00:00.000Z');
    assert.equal(peakMixed.billedMicros, 150_000 + 3_000);
    const off = actualCost(card, { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 500_000 }, '2026-10-13T12:00:00.000Z');
    assert.deepEqual([off.band, off.billedMicros, off.economicMicros], ['OFF_PEAK', 75_000 + 1_500 + 600_000, 1_500_000]);
    const noCacheField = actualCost(card, { inputTokens: 1_000, outputTokens: 0 }, '2026-10-13T12:00:00.000Z');
    assert.equal(noCacheField.cachedInputTokens, 0, 'no report = no cache hits (never assumed)');
    assert.throws(() => actualCost(card, { inputTokens: 10, outputTokens: 0, cachedInputTokens: 11 }, '2026-10-13T12:00:00.000Z'), (e) => isQandeelError(e, 'ACCOUNTING_OUT_OF_RANGE'));
    const f = actualCost(flat, { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000 }, '2026-10-13T12:00:00.000Z');
    assert.deepEqual([f.band, f.billedMicros], ['FLAT', 300_010], 'a FLAT card bills cached input at the fresh rate');
    assert.equal(actualCost(card, { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, '2026-10-13T12:00:00.000Z').billedMicros, 2, 'each component rounds up');
  });

  test('validation: discounts never exceed the peak rates; economic never understates billed; FREE / SUBSCRIPTION carry no schedule; malformed schedules are refused', () => {
    assertPriceCardRates(card);
    assert.throws(() => assertPriceCardRates({ ...card, billedCachedInputPerMTok: 300_001 }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => assertPriceCardRates({ ...card, schedule: { ...schedule, offPeakInputPerMTok: 300_001 } }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => assertPriceCardRates({ ...card, schedule: { ...schedule, offPeakCachedInputPerMTok: 6_001 } }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => assertPriceCardRates({ ...card, schedule: { ...schedule, offPeakOutputPerMTok: 1_200_001 } }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => assertPriceCardRates({ ...card, economicInputPerMTok: 299_999 }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => assertPriceCardRates({ ...card, billingMode: 'SUBSCRIPTION', billedInputPerMTok: 0, billedOutputPerMTok: 0, billedCachedInputPerMTok: 0 }), (e) => isQandeelError(e, 'VALIDATION_FAILED'), 'a schedule on a subscription card');
    for (const bad of [
      { ...schedule, peakWindows: [] },
      { ...schedule, peakWindows: [{ fromMinute: 100, toMinute: 100 }] },
      { ...schedule, peakWindows: [{ fromMinute: 0, toMinute: 1_441 }] },
      { ...schedule, peakWeekdays: [1, 1] },
      { ...schedule, peakWeekdays: [7] },
      { ...schedule, holidayDates: ['2026-13-01'] },
      { ...schedule, holidayDates: ['tomorrow'] },
      { ...schedule, basisSource: 'http://insecure.example' },
      { ...schedule, basisDate: '2026/10/05' },
    ]) assert.throws(() => assertPriceSchedule(bad), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    const normalized = assertPriceSchedule({ ...schedule, peakWeekdays: [5, 1, 3], holidayDates: ['2026-10-02', '2026-10-01'] });
    assert.deepEqual([normalized.peakWeekdays, normalized.holidayDates], [[1, 3, 5], ['2026-10-01', '2026-10-02']], 'canonical order');
  });

  test('usage normalization carries cached input (default 0) and refuses more cached than input', () => {
    assert.deepEqual(normalizeUsage({ inputTokens: 10, outputTokens: 2 }, { inputUpperBound: 100, maxOutputTokens: 10 }).usage, { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0 });
    assert.deepEqual(normalizeUsage({ inputTokens: 10, outputTokens: 2, cachedInputTokens: 4 }, { inputUpperBound: 100, maxOutputTokens: 10 }).usage, { inputTokens: 10, outputTokens: 2, cachedInputTokens: 4 });
    assert.throws(() => normalizeUsage({ inputTokens: 10, outputTokens: 2, cachedInputTokens: 11 }, { inputUpperBound: 100, maxOutputTokens: 10 }), (e) => isQandeelError(e, 'PROVIDER_FAILURE'));
    assert.throws(() => normalizeUsage({ inputTokens: 10, outputTokens: 2, cachedInputTokens: -1 }, { inputUpperBound: 100, maxOutputTokens: 10 }));
  });
});

describe('L1 economics: provisioning profiles', () => {
  const profile: ProviderProvisioningProfile = {
    code: 'test-profile',
    provider: { code: 'testprov', locality: 'EXTERNAL', credentialRef: 'vault:testprov' },
    model: { code: 'test-model', expectedPublicName: 'Test Model 1.0' },
    deployments: [{ code: 'test-e1', reasoningClass: 'E1', pinnedRevision: 'r1', contextWindowTokens: 8_192, maxOutputTokens: 1_024, taskClasses: ['draft.memo'] }],
    priceCard: { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: 10, billedOutputPerMTok: 20, billedPerCall: 0, economicInputPerMTok: 10, economicOutputPerMTok: 20, economicPerCall: 0 },
    egressMaxDataClass: 'D2',
    qualificationTarget: 'LIMITED_PRODUCTION',
    routePolicies: [{ taskClass: 'draft.memo', body: { minClass: 'E1', maxClass: 'E1', allowLimitedProduction: true, maxRetriesPerCall: 1, maxCallsPerRun: 2, fallbackCostCeilingMicros: null, escalation: { maxDepth: 0, maxOverheadMicros: 0 } } }],
  };

  test('a profile is validated whole; an external profile never asks for D3 / D4; QUALIFIED is never a target; a credential is only a vault reference; the digest is stable', () => {
    const p = assertProvisioningProfile(profile);
    assert.equal(provisioningProfileDigest(p), provisioningProfileDigest({ ...profile, deployments: [...profile.deployments] }));
    assert.throws(() => assertProvisioningProfile({ ...profile, egressMaxDataClass: 'D3' }), (e) => isQandeelError(e, 'EGRESS_DENIED'));
    assert.throws(() => assertProvisioningProfile({ ...profile, egressMaxDataClass: 'D4' }), (e) => isQandeelError(e, 'EGRESS_DENIED'));
    assert.throws(() => assertProvisioningProfile({ ...profile, qualificationTarget: 'QUALIFIED' }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => assertProvisioningProfile({ ...profile, provider: { ...profile.provider, credentialRef: 'sk-not-a-reference' } }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => assertProvisioningProfile({ ...profile, deployments: [] }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    const first = profile.deployments[0] as ProvisioningDeployment;
    assert.throws(() => assertProvisioningProfile({ ...profile, deployments: [{ ...first, reasoningClass: 'E0' as never }] }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.throws(() => assertProvisioningProfile({ ...profile, deployments: [{ ...first, maxOutputTokens: 8_192 }] }), (e) => isQandeelError(e, 'VALIDATION_FAILED'), 'output must fit inside the context window');
    assert.throws(() => assertProvisioningProfile({ ...profile, priceCard: { ...profile.priceCard, economicInputPerMTok: 1 } }), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
    assert.notEqual(provisioningProfileDigest(p), provisioningProfileDigest(assertProvisioningProfile({ ...profile, priceCard: { ...profile.priceCard, billedInputPerMTok: 9 } })), 'a price change is another digest');
  });
});
