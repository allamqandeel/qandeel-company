/**
 * Model / tool economics (Stage 3 §6, Stage 13 D13-G). Deterministic, checked integer arithmetic:
 * money is integer micro-units of one Company currency; usage is integer token quantities.
 *
 * SQLite silently turns an overflowing integer expression into a REAL, so no accounting arithmetic
 * is ever done in SQL: every sum is computed here, range-checked, and stored as an INTEGER.
 */
import { QandeelError } from '@qandeel-company/domain';

/** Ceiling for any stored money amount (micro-units): 10^15 < 2^53, so sums stay exact. */
export const MAX_MONEY_MICROS = 1_000_000_000_000_000;
/** Ceiling for any stored token quantity. */
export const MAX_TOKENS = 1_000_000_000_000;

export function assertMoney(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > MAX_MONEY_MICROS) {
    throw new QandeelError('ACCOUNTING_OUT_OF_RANGE', `${field} must be an integer amount in [0, ${MAX_MONEY_MICROS}] micro-units`, { field });
  }
  return v;
}

export function assertTokens(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > MAX_TOKENS) {
    throw new QandeelError('ACCOUNTING_OUT_OF_RANGE', `${field} must be an integer token count in [0, ${MAX_TOKENS}]`, { field });
  }
  return v;
}

/** Checked addition: refuses negatives and results above the ceiling (no overflow, no wrap). */
export function addMoney(a: number, b: number, field = 'money'): number {
  return assertMoney(assertMoney(a, field) + assertMoney(b, field), field);
}

export function addTokens(a: number, b: number, field = 'tokens'): number {
  return assertTokens(assertTokens(a, field) + assertTokens(b, field), field);
}

/** Checked subtraction that refuses a negative result (no negative accounting). */
export function subMoney(a: number, b: number, field = 'money'): number {
  const r = assertMoney(a, field) - assertMoney(b, field);
  if (r < 0) throw new QandeelError('ACCOUNTING_OUT_OF_RANGE', `${field} would become negative`, { field });
  return r;
}

export function subTokens(a: number, b: number, field = 'tokens'): number {
  const r = assertTokens(a, field) - assertTokens(b, field);
  if (r < 0) throw new QandeelError('ACCOUNTING_OUT_OF_RANGE', `${field} would become negative`, { field });
  return r;
}

export const CURRENCY = /^[A-Z]{3}$/;

export function assertCurrency(v: unknown, field = 'currency'): string {
  if (typeof v !== 'string' || !CURRENCY.test(v)) throw new QandeelError('VALIDATION_FAILED', `${field} must be an ISO-4217 style code`, { field });
  return v;
}

/**
 * Billing modes. Provider billed cost ≠ internal economic usage (D13-G.3): FREE and SUBSCRIPTION
 * usage bills 0 per call, but it still carries an internal economic rate and always counts tokens,
 * so it is never treated as unlimited.
 */
export const BILLING_MODES = ['METERED', 'SUBSCRIPTION', 'FREE'] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

/**
 * L1-01 (D-L1-04): a provider-neutral time-banded billing basis. A provider may bill cached ("cache hit")
 * input tokens below fresh input, and may bill less outside its peak windows. The card's base rates are
 * the PEAK, all-cache-miss rates: they are what every worst-case reservation uses. The schedule only
 * ever discounts them, and it is part of the immutable, versioned card (price provenance): a later
 * price change is a new card version, so historical usage never changes.
 */
export interface PriceSchedule {
  /** Off-peak rates (micro-units per million tokens); each is at most the card's peak counterpart. */
  readonly offPeakInputPerMTok: number;
  readonly offPeakCachedInputPerMTok: number;
  readonly offPeakOutputPerMTok: number;
  /** Peak windows as UTC minutes of day, [fromMinute, toMinute), applied on `peakWeekdays` (0 = Sunday … 6 = Saturday). */
  readonly peakWindows: readonly { readonly fromMinute: number; readonly toMinute: number }[];
  readonly peakWeekdays: readonly number[];
  /** UTC calendar dates (YYYY-MM-DD) that are off-peak in full whatever the weekday (the provider's published holidays). */
  readonly holidayDates: readonly string[];
  /** Where and when the basis was read (an https URL and a YYYY-MM-DD date); recorded, never fetched. */
  readonly basisSource: string;
  readonly basisDate: string;
}

/** A versioned, immutable price card (price provenance). Rates are micro-units per million tokens. */
export interface PriceCard {
  readonly id: string;
  readonly version: number;
  readonly currency: string;
  readonly billingMode: BillingMode;
  /** Peak, cache-miss input rate: the reservation (worst-case) rate. */
  readonly billedInputPerMTok: number;
  readonly billedOutputPerMTok: number;
  readonly billedPerCall: number;
  readonly economicInputPerMTok: number;
  readonly economicOutputPerMTok: number;
  readonly economicPerCall: number;
  /** Peak rate of a cached ("cache hit") input token; defaults to the fresh input rate (no discount). */
  readonly billedCachedInputPerMTok?: number;
  /** Off-peak discounts and their UTC schedule; absent / null = one flat band. */
  readonly schedule?: PriceSchedule | null;
}

export const BILLING_BANDS = ['FLAT', 'PEAK', 'OFF_PEAK'] as const;
export type BillingBand = (typeof BILLING_BANDS)[number];

const UTC_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const MAX_SCHEDULE_ITEMS = 64;

export function assertPriceSchedule(s: unknown): PriceSchedule {
  const v = s as Partial<PriceSchedule> | null;
  if (typeof v !== 'object' || v === null) throw new QandeelError('VALIDATION_FAILED', 'price schedule must be an object', { field: 'schedule' });
  for (const k of ['offPeakInputPerMTok', 'offPeakCachedInputPerMTok', 'offPeakOutputPerMTok'] as const) assertMoney(v[k], k);
  if (!Array.isArray(v.peakWindows) || v.peakWindows.length === 0 || v.peakWindows.length > MAX_SCHEDULE_ITEMS) throw new QandeelError('VALIDATION_FAILED', 'peakWindows must be a non-empty bounded list', { field: 'peakWindows' });
  const windows = v.peakWindows.map((w) => {
    const o = w as Partial<{ fromMinute: number; toMinute: number }> | null;
    const from = o?.fromMinute;
    const to = o?.toMinute;
    if (typeof from !== 'number' || typeof to !== 'number' || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > 1_440 || from >= to) throw new QandeelError('VALIDATION_FAILED', 'a peak window is [fromMinute, toMinute) within one UTC day', { field: 'peakWindows' });
    return { fromMinute: from, toMinute: to };
  });
  if (!Array.isArray(v.peakWeekdays) || v.peakWeekdays.length === 0 || v.peakWeekdays.length > 7 || v.peakWeekdays.some((d) => typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) || new Set(v.peakWeekdays).size !== v.peakWeekdays.length) throw new QandeelError('VALIDATION_FAILED', 'peakWeekdays are distinct weekdays 0..6', { field: 'peakWeekdays' });
  if (!Array.isArray(v.holidayDates) || v.holidayDates.length > MAX_SCHEDULE_ITEMS || v.holidayDates.some((d) => typeof d !== 'string' || !UTC_DATE.test(d))) throw new QandeelError('VALIDATION_FAILED', 'holidayDates are bounded YYYY-MM-DD UTC dates', { field: 'holidayDates' });
  if (typeof v.basisSource !== 'string' || !/^https:\/\/[a-z0-9.-]+(?:\/[\w./%-]*)?$/i.test(v.basisSource) || v.basisSource.length > 256) throw new QandeelError('VALIDATION_FAILED', 'basisSource is an https URL', { field: 'basisSource' });
  if (typeof v.basisDate !== 'string' || !UTC_DATE.test(v.basisDate)) throw new QandeelError('VALIDATION_FAILED', 'basisDate is a YYYY-MM-DD date', { field: 'basisDate' });
  return { offPeakInputPerMTok: v.offPeakInputPerMTok as number, offPeakCachedInputPerMTok: v.offPeakCachedInputPerMTok as number, offPeakOutputPerMTok: v.offPeakOutputPerMTok as number, peakWindows: windows, peakWeekdays: [...(v.peakWeekdays as number[])].sort((a, b) => a - b), holidayDates: [...(v.holidayDates as string[])].sort(), basisSource: v.basisSource, basisDate: v.basisDate };
}

/** The peak cached-input rate of a card (the fresh input rate when the card declares no cache discount). */
export function cachedInputRate(c: Pick<PriceCard, 'billedInputPerMTok' | 'billedCachedInputPerMTok'>): number {
  return c.billedCachedInputPerMTok ?? c.billedInputPerMTok;
}

/**
 * Validates price-card rates. METERED economic rates may not be below billed rates; a cached-input rate and
 * every off-peak rate may never exceed the peak (reservation) rate it discounts (the worst case stays the
 * worst case, D13-G.5).
 */
export function assertPriceCardRates(c: Omit<PriceCard, 'id' | 'version'>): void {
  assertCurrency(c.currency);
  if (!(BILLING_MODES as readonly string[]).includes(c.billingMode)) throw new QandeelError('VALIDATION_FAILED', 'unknown billing mode', { field: 'billingMode' });
  for (const k of ['billedInputPerMTok', 'billedOutputPerMTok', 'billedPerCall', 'economicInputPerMTok', 'economicOutputPerMTok', 'economicPerCall'] as const) assertMoney(c[k], k);
  if (c.billedCachedInputPerMTok !== undefined) assertMoney(c.billedCachedInputPerMTok, 'billedCachedInputPerMTok');
  if (c.billingMode !== 'METERED' && (c.billedInputPerMTok !== 0 || c.billedOutputPerMTok !== 0 || c.billedPerCall !== 0 || (c.billedCachedInputPerMTok ?? 0) !== 0 || (c.schedule ?? null) !== null)) {
    throw new QandeelError('VALIDATION_FAILED', 'FREE / SUBSCRIPTION cards bill nothing per call; their economic rates carry the internal cost', { field: 'billingMode' });
  }
  if (c.billingMode === 'METERED' && (c.economicInputPerMTok < c.billedInputPerMTok || c.economicOutputPerMTok < c.billedOutputPerMTok || c.economicPerCall < c.billedPerCall)) {
    throw new QandeelError('VALIDATION_FAILED', 'METERED economic rates cannot understate billed rates', { field: 'economic' });
  }
  if (cachedInputRate(c) > c.billedInputPerMTok) throw new QandeelError('VALIDATION_FAILED', 'a cached-input rate never exceeds the fresh (reservation) input rate', { field: 'billedCachedInputPerMTok' });
  if (c.schedule !== undefined && c.schedule !== null) {
    const s = assertPriceSchedule(c.schedule);
    if (s.offPeakInputPerMTok > c.billedInputPerMTok || s.offPeakOutputPerMTok > c.billedOutputPerMTok || s.offPeakCachedInputPerMTok > cachedInputRate(c)) {
      throw new QandeelError('VALIDATION_FAILED', 'off-peak rates never exceed the peak (reservation) rates', { field: 'schedule' });
    }
  }
}

/** The UTC calendar date (YYYY-MM-DD), weekday and minute of day of a timestamp. */
function utcParts(at: string): { date: string; weekday: number; minute: number } {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new QandeelError('VALIDATION_FAILED', 'billing time must be a timestamp', { field: 'at' });
  const d = new Date(ms);
  return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/**
 * The billing band a card applies at `at` (UTC): PEAK inside a peak window on a peak weekday that is not a
 * published holiday, OFF_PEAK otherwise; FLAT for a card without a schedule. Deterministic: the same
 * instant always gives the same band.
 */
export function billingBandAt(card: Pick<PriceCard, 'schedule'>, at: string): BillingBand {
  const s = card.schedule ?? null;
  if (s === null) return 'FLAT';
  const { date, weekday, minute } = utcParts(at);
  if (!s.peakWeekdays.includes(weekday) || s.holidayDates.includes(date)) return 'OFF_PEAK';
  return s.peakWindows.some((w) => minute >= w.fromMinute && minute < w.toMinute) ? 'PEAK' : 'OFF_PEAK';
}

/** ceil(tokens * ratePerMTok / 10^6), exact via BigInt, range-checked. */
function tokenCost(tokens: number, ratePerMTok: number, field: string): number {
  const exact = (BigInt(assertTokens(tokens, field)) * BigInt(assertMoney(ratePerMTok, field)) + 999_999n) / 1_000_000n;
  if (exact > BigInt(MAX_MONEY_MICROS)) throw new QandeelError('ACCOUNTING_OUT_OF_RANGE', `${field} cost exceeds the accounting ceiling`, { field });
  return Number(exact);
}

export interface Cost {
  readonly billedMicros: number;
  readonly economicMicros: number;
  readonly tokens: number;
}

/**
 * The worst-case (peak, every input token a cache miss) cost of a call: what a reservation holds and what
 * routing compares. Never a discount.
 */
export function costOf(card: PriceCard, inputTokens: number, outputTokens: number): Cost {
  const billed = addMoney(addMoney(tokenCost(inputTokens, card.billedInputPerMTok, 'input'), tokenCost(outputTokens, card.billedOutputPerMTok, 'output')), card.billedPerCall);
  const economic = addMoney(addMoney(tokenCost(inputTokens, card.economicInputPerMTok, 'input'), tokenCost(outputTokens, card.economicOutputPerMTok, 'output')), card.economicPerCall);
  return { billedMicros: billed, economicMicros: economic, tokens: addTokens(inputTokens, outputTokens) };
}

/** Validated usage of one call as the provider reported it (cached input tokens are a subset of input tokens). */
export interface UsageAmounts {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
}

export interface ActualCost extends Cost {
  readonly band: BillingBand;
  readonly cachedInputTokens: number;
}

/**
 * The truthful provider bill of one call (D13-G.2/.3, D-L1-04): cache-hit input at the cached rate, cache-miss
 * input at the fresh rate, output at the output rate, each at the band the card applies at `at`; plus the
 * per-call amount. The governed economic cost keeps the card's flat economic rates (it is the Company's
 * internal cost of the tokens, never a provider discount), so economic ≥ billed always holds for a METERED
 * card. Settlement calls this with the clock of the settling transaction.
 */
export function actualCost(card: PriceCard, usage: UsageAmounts, at: string): ActualCost {
  const input = assertTokens(usage.inputTokens, 'usage.inputTokens');
  const output = assertTokens(usage.outputTokens, 'usage.outputTokens');
  const cached = assertTokens(usage.cachedInputTokens ?? 0, 'usage.cachedInputTokens');
  if (cached > input) throw new QandeelError('ACCOUNTING_OUT_OF_RANGE', 'cached input tokens exceed input tokens', { field: 'usage.cachedInputTokens' });
  const band = billingBandAt(card, at);
  const s = card.schedule ?? null;
  const rates = band === 'OFF_PEAK' && s !== null
    ? { input: s.offPeakInputPerMTok, cached: s.offPeakCachedInputPerMTok, output: s.offPeakOutputPerMTok }
    : { input: card.billedInputPerMTok, cached: cachedInputRate(card), output: card.billedOutputPerMTok };
  const billed = addMoney(addMoney(addMoney(tokenCost(input - cached, rates.input, 'input'), tokenCost(cached, rates.cached, 'cachedInput')), tokenCost(output, rates.output, 'output')), card.billedPerCall);
  const economic = addMoney(addMoney(tokenCost(input, card.economicInputPerMTok, 'input'), tokenCost(output, card.economicOutputPerMTok, 'output')), card.economicPerCall);
  return { billedMicros: billed, economicMicros: economic, tokens: addTokens(input, output), band, cachedInputTokens: cached };
}

/**
 * Worst-case authorized spend of one call, reserved before execution (D13-G.5): the input upper
 * bound plus the enforced maximum output. Budgets are charged the economic amount and the tokens.
 */
export function worstCase(card: PriceCard, inputTokensUpperBound: number, maxOutputTokens: number): Cost {
  return costOf(card, inputTokensUpperBound, maxOutputTokens);
}

/** Attempt kinds: retry ≠ fallback ≠ escalation (D13-C.7); each attempt is attributed separately. */
export const ATTEMPT_KINDS = ['PRIMARY', 'RETRY', 'FALLBACK', 'ESCALATION'] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

/** Budget hierarchy (Stage 3 §6): Company → Department → Employee → Work Item → Run. */
export const BUDGET_SCOPES = ['COMPANY', 'DEPARTMENT', 'EMPLOYEE', 'WORK_ITEM', 'RUN'] as const;
export type BudgetScope = (typeof BUDGET_SCOPES)[number];
export const PARENT_SCOPE: Readonly<Record<BudgetScope, BudgetScope | null>> = { COMPANY: null, DEPARTMENT: 'COMPANY', EMPLOYEE: 'DEPARTMENT', WORK_ITEM: 'EMPLOYEE', RUN: 'WORK_ITEM' };

/**
 * C4 (D-C4-02): the parent scope of a budget given the owning Employee's organizational scope. A
 * company-scoped executive (the CEO seat) belongs to no Department, so its EMPLOYEE budget hangs directly
 * under the Company budget — never under a fake Department — and every Company cap still applies.
 */
export function parentScopeFor(scope: BudgetScope, orgScope: 'COMPANY' | 'DEPARTMENT'): BudgetScope | null {
  if (scope === 'EMPLOYEE' && orgScope === 'COMPANY') return 'COMPANY';
  return PARENT_SCOPE[scope];
}

export interface BudgetLevel {
  readonly id: string;
  readonly scope: BudgetScope;
  readonly capMoney: number;
  readonly capTokens: number;
  readonly reservedMoney: number;
  readonly reservedTokens: number;
  readonly spentMoney: number;
  readonly spentTokens: number;
}

export type ReservationCheck = { readonly ok: true } | { readonly ok: false; readonly scope: BudgetScope; readonly budgetId: string; readonly dimension: 'MONEY' | 'TOKENS' };

/** Every level of the chain must have headroom; the first exhausted level is reported. */
export function checkReservation(chain: readonly BudgetLevel[], money: number, tokens: number): ReservationCheck {
  for (const b of chain) {
    if (addMoney(addMoney(b.reservedMoney, b.spentMoney), money) > b.capMoney) return { ok: false, scope: b.scope, budgetId: b.id, dimension: 'MONEY' };
    if (addTokens(addTokens(b.reservedTokens, b.spentTokens), tokens) > b.capTokens) return { ok: false, scope: b.scope, budgetId: b.id, dimension: 'TOKENS' };
  }
  return { ok: true };
}

/** Near-limit threshold for health (percentage of the cap already reserved or spent). */
export const NEAR_LIMIT_PERCENT = 90;

export function utilisationPercent(b: Pick<BudgetLevel, 'capMoney' | 'capTokens' | 'reservedMoney' | 'reservedTokens' | 'spentMoney' | 'spentTokens'>): number {
  const pct = (used: number, cap: number): number => (cap === 0 ? 100 : Math.floor((used * 100) / cap));
  return Math.max(pct(b.reservedMoney + b.spentMoney, b.capMoney), pct(b.reservedTokens + b.spentTokens, b.capTokens));
}
