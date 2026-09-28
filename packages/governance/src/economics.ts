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

/** A versioned, immutable price card (price provenance). Rates are micro-units per million tokens. */
export interface PriceCard {
  readonly id: string;
  readonly version: number;
  readonly currency: string;
  readonly billingMode: BillingMode;
  readonly billedInputPerMTok: number;
  readonly billedOutputPerMTok: number;
  readonly billedPerCall: number;
  readonly economicInputPerMTok: number;
  readonly economicOutputPerMTok: number;
  readonly economicPerCall: number;
}

/** Validates price-card rates. METERED economic rates may not be below billed rates. */
export function assertPriceCardRates(c: Omit<PriceCard, 'id' | 'version'>): void {
  assertCurrency(c.currency);
  if (!(BILLING_MODES as readonly string[]).includes(c.billingMode)) throw new QandeelError('VALIDATION_FAILED', 'unknown billing mode', { field: 'billingMode' });
  for (const k of ['billedInputPerMTok', 'billedOutputPerMTok', 'billedPerCall', 'economicInputPerMTok', 'economicOutputPerMTok', 'economicPerCall'] as const) assertMoney(c[k], k);
  if (c.billingMode !== 'METERED' && (c.billedInputPerMTok !== 0 || c.billedOutputPerMTok !== 0 || c.billedPerCall !== 0)) {
    throw new QandeelError('VALIDATION_FAILED', 'FREE / SUBSCRIPTION cards bill nothing per call; their economic rates carry the internal cost', { field: 'billingMode' });
  }
  if (c.billingMode === 'METERED' && (c.economicInputPerMTok < c.billedInputPerMTok || c.economicOutputPerMTok < c.billedOutputPerMTok || c.economicPerCall < c.billedPerCall)) {
    throw new QandeelError('VALIDATION_FAILED', 'METERED economic rates cannot understate billed rates', { field: 'economic' });
  }
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

export function costOf(card: PriceCard, inputTokens: number, outputTokens: number): Cost {
  const billed = addMoney(addMoney(tokenCost(inputTokens, card.billedInputPerMTok, 'input'), tokenCost(outputTokens, card.billedOutputPerMTok, 'output')), card.billedPerCall);
  const economic = addMoney(addMoney(tokenCost(inputTokens, card.economicInputPerMTok, 'input'), tokenCost(outputTokens, card.economicOutputPerMTok, 'output')), card.economicPerCall);
  return { billedMicros: billed, economicMicros: economic, tokens: addTokens(inputTokens, outputTokens) };
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
