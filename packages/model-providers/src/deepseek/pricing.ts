/**
 * The DeepSeek V4.1 Flash pricing basis and provisioning profile (D-L1-04, D-L1-06). Rates are USD micro-units
 * per million tokens, read from the official pricing page on 2026-10-05 (in effect since 2026-09-10 04:00 UTC):
 *
 *   input cache miss  peak $0.30 / M   off-peak $0.15 / M
 *   input cache hit   peak $0.006 / M  off-peak $0.003 / M
 *   output            peak $1.20 / M   off-peak $0.60 / M
 *   peak = 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday, excluding Chinese public holidays; everything else
 *   (weekends and those holidays in full) is off-peak at half the peak rates.
 *
 * The card's base rates are the PEAK, cache-miss rates (what every reservation holds); the schedule is the
 * off-peak discount. The 2026 holiday dates are the State Council's published 2026 arrangement (notice of
 * 2025-11-04); during the UTC peak windows the UTC date equals the Beijing date, so UTC dates apply exactly.
 * A later price change is a NEW basis version: historical usage never changes.
 */
import type { PriceSchedule, ProviderProvisioningProfile, RoutePolicyBody } from '@qandeel-company/governance';

import { DEEPSEEK_CLASS_LIMITS, DEEPSEEK_CREDENTIAL_REF, DEEPSEEK_EXPECTED_PUBLIC_NAME, DEEPSEEK_MODEL_CODE, DEEPSEEK_PINNED_REVISION, DEEPSEEK_PROVIDER_CODE } from './declaration.js';

export const DEEPSEEK_PRICING_BASIS_SOURCE = 'https://api-docs.deepseek.com/quick_start/pricing';
export const DEEPSEEK_PRICING_BASIS_DATE = '2026-10-05';
export const DEEPSEEK_PRICING_EFFECTIVE_FROM = '2026-09-10T04:00:00.000Z';

/** USD micro-units per million tokens (1 USD = 1 000 000 micro-units). */
export const DEEPSEEK_FLASH_PEAK_RATES = Object.freeze({ inputPerMTok: 300_000, cachedInputPerMTok: 6_000, outputPerMTok: 1_200_000 });
export const DEEPSEEK_FLASH_OFF_PEAK_RATES = Object.freeze({ inputPerMTok: 150_000, cachedInputPerMTok: 3_000, outputPerMTok: 600_000 });

/** Chinese public holidays of 2026 (State Council notice, 2025-11-04), as UTC dates; off-peak in full. */
export const PRC_PUBLIC_HOLIDAYS_2026: readonly string[] = Object.freeze([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
]);

export const DEEPSEEK_FLASH_SCHEDULE: PriceSchedule = Object.freeze({
  offPeakInputPerMTok: DEEPSEEK_FLASH_OFF_PEAK_RATES.inputPerMTok,
  offPeakCachedInputPerMTok: DEEPSEEK_FLASH_OFF_PEAK_RATES.cachedInputPerMTok,
  offPeakOutputPerMTok: DEEPSEEK_FLASH_OFF_PEAK_RATES.outputPerMTok,
  // 01:00–04:00 and 06:00–10:00 UTC.
  peakWindows: Object.freeze([{ fromMinute: 60, toMinute: 240 }, { fromMinute: 360, toMinute: 600 }]),
  // Monday … Friday.
  peakWeekdays: Object.freeze([1, 2, 3, 4, 5]),
  holidayDates: PRC_PUBLIC_HOLIDAYS_2026,
  basisSource: DEEPSEEK_PRICING_BASIS_SOURCE,
  basisDate: DEEPSEEK_PRICING_BASIS_DATE,
});

/** The versioned price card of every DeepSeek V4.1 Flash deployment: peak cache-miss base rates + the schedule. */
export const DEEPSEEK_FLASH_PRICE_CARD: ProviderProvisioningProfile['priceCard'] = Object.freeze({
  currency: 'USD',
  billingMode: 'METERED',
  billedInputPerMTok: DEEPSEEK_FLASH_PEAK_RATES.inputPerMTok,
  billedOutputPerMTok: DEEPSEEK_FLASH_PEAK_RATES.outputPerMTok,
  billedPerCall: 0,
  // The Company's governed economic cost equals the peak bill: no provider discount ever lowers what budgets charge.
  economicInputPerMTok: DEEPSEEK_FLASH_PEAK_RATES.inputPerMTok,
  economicOutputPerMTok: DEEPSEEK_FLASH_PEAK_RATES.outputPerMTok,
  economicPerCall: 0,
  billedCachedInputPerMTok: DEEPSEEK_FLASH_PEAK_RATES.cachedInputPerMTok,
  schedule: DEEPSEEK_FLASH_SCHEDULE,
});

/** The task classes the first pilot routes to DeepSeek: the Founder ↔ CEO conversation and CEO briefs. */
export const DEEPSEEK_PILOT_TASK_CLASSES: readonly string[] = Object.freeze(['founder.reply', 'founder.brief']);

const PILOT_ROUTE_POLICY: RoutePolicyBody = Object.freeze({
  minClass: 'E1',
  maxClass: 'E2',
  allowLimitedProduction: true,
  maxRetriesPerCall: 1,
  maxCallsPerRun: 4,
  fallbackCostCeilingMicros: null,
  escalation: Object.freeze({ maxDepth: 1, maxOverheadMicros: 200_000 }),
});

/**
 * The release-pinned DeepSeek V4.1 Flash profile: one provider, one model identity, four immutable deployment
 * profiles (E1–E4) with conservative limits, the versioned pricing basis, D2 egress (D3 / D4 never leave), the
 * LIMITED_PRODUCTION pilot qualification and the two pilot route policies. Registered only through the
 * governed `PROVIDER_PROVISION` confirmation (or the seam-seeded L1 harness).
 */
export const DEEPSEEK_V41_FLASH_PROFILE: ProviderProvisioningProfile = Object.freeze({
  code: 'deepseek-v4-1-flash',
  provider: Object.freeze({ code: DEEPSEEK_PROVIDER_CODE, locality: 'EXTERNAL', credentialRef: DEEPSEEK_CREDENTIAL_REF }),
  model: Object.freeze({ code: DEEPSEEK_MODEL_CODE, expectedPublicName: DEEPSEEK_EXPECTED_PUBLIC_NAME }),
  deployments: Object.freeze((['E1', 'E2', 'E3', 'E4'] as const).map((cls) => Object.freeze({
    code: `deepseek-flash-${cls.toLowerCase()}`,
    reasoningClass: cls,
    pinnedRevision: DEEPSEEK_PINNED_REVISION,
    contextWindowTokens: DEEPSEEK_CLASS_LIMITS[cls].contextWindowTokens,
    maxOutputTokens: DEEPSEEK_CLASS_LIMITS[cls].maxOutputTokens,
    taskClasses: DEEPSEEK_PILOT_TASK_CLASSES,
  }))),
  priceCard: DEEPSEEK_FLASH_PRICE_CARD,
  egressMaxDataClass: 'D2',
  qualificationTarget: 'LIMITED_PRODUCTION',
  routePolicies: Object.freeze(DEEPSEEK_PILOT_TASK_CLASSES.map((taskClass) => Object.freeze({ taskClass, body: PILOT_ROUTE_POLICY }))),
});

/**
 * L1-02 (D-L1-14): the task classes the first production CEO activation needs — the two L1-01 Founder classes plus
 * the CEO Academy package's three (a Skill benchmark case, an Academy attempt, probation shadow work). Nothing else.
 */
export const DEEPSEEK_ACADEMY_TASK_CLASSES: readonly string[] = Object.freeze([...DEEPSEEK_PILOT_TASK_CLASSES, 'skill.benchmark', 'academy.attempt', 'academy.shadow']);

/**
 * L1-02 (D-L1-14): a NEW versioned profile for the first production activation, never a silent widening of
 * `DEEPSEEK_V41_FLASH_PROFILE` (which is unchanged). Same provider, model identity, pricing basis, D2 egress ceiling,
 * LIMITED_PRODUCTION qualification and bounded route policy (E1..E2, one retry, four calls per run), and only the two
 * conservative deployments E1 / E2: the thinking-heavy E3 / E4 profiles are not registered for this first activation.
 */
export const DEEPSEEK_V41_FLASH_ACADEMY_PROFILE: ProviderProvisioningProfile = Object.freeze({
  code: 'deepseek-v4-1-flash-academy',
  provider: Object.freeze({ code: DEEPSEEK_PROVIDER_CODE, locality: 'EXTERNAL', credentialRef: DEEPSEEK_CREDENTIAL_REF }),
  model: Object.freeze({ code: DEEPSEEK_MODEL_CODE, expectedPublicName: DEEPSEEK_EXPECTED_PUBLIC_NAME }),
  deployments: Object.freeze((['E1', 'E2'] as const).map((cls) => Object.freeze({
    code: `deepseek-flash-${cls.toLowerCase()}`,
    reasoningClass: cls,
    pinnedRevision: DEEPSEEK_PINNED_REVISION,
    contextWindowTokens: DEEPSEEK_CLASS_LIMITS[cls].contextWindowTokens,
    maxOutputTokens: DEEPSEEK_CLASS_LIMITS[cls].maxOutputTokens,
    taskClasses: DEEPSEEK_ACADEMY_TASK_CLASSES,
  }))),
  priceCard: DEEPSEEK_FLASH_PRICE_CARD,
  egressMaxDataClass: 'D2',
  qualificationTarget: 'LIMITED_PRODUCTION',
  routePolicies: Object.freeze(DEEPSEEK_ACADEMY_TASK_CLASSES.map((taskClass) => Object.freeze({ taskClass, body: PILOT_ROUTE_POLICY }))),
});
