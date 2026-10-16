/**
 * COMPANY-TALENT-01 — the Skills & Academy studio's ordinary form fields for Benchmark cases and specialty competencies
 * (pure; no DOM). The Founder sets what a case expects and how a competency is judged with checkboxes, numbers and
 * lines; the full JSON stays an Advanced option. Nothing here validates for the server: the governed check on save and
 * on approval (`assertAcademyPackage`) stays the only authority. These helpers only keep the edited object in the shape
 * that check expects — an unset constraint is absent (never an empty list), and `critical` names only stated
 * constraints.
 *
 * The closed lists mirror the pure contracts in `@qandeel-company/governance` (ANSWER_*) and `@qandeel-company/mind`
 * (EXPECTATION_KEYS, CURRICULUM_CATEGORIES); the browser bundle does not import those packages.
 */

type Json = Record<string, unknown>;

export const EXPECT_CHOICES = {
  decision: ['PROCEED', 'PROCEED_WITH_CONDITIONS', 'GATHER_EVIDENCE', 'ESCALATE_TO_FOUNDER', 'DECLINE'],
  authority: ['WITHIN_HELD_AUTHORITY', 'NEEDS_FOUNDER', 'NOT_HELD'],
  evidence: ['SUFFICIENT', 'PARTIAL', 'INSUFFICIENT'],
  confidence: ['LOW', 'MEDIUM', 'HIGH'],
} as const;
export type ChoiceKey = keyof typeof EXPECT_CHOICES;

export const EXPECTATION_KEYS = ['decision', 'authority', 'evidence', 'confidence', 'reversible', 'founderDecisionNeeded', 'maxSpendMicros', 'arabicBody', 'minBodyChars', 'forbidden'] as const;
export type ExpectationKey = (typeof EXPECTATION_KEYS)[number];

export const CURRICULUM_CATEGORIES = ['QANDEEL_FUNDAMENTALS', 'FOUNDER_UNDERSTANDING', 'ROLE_MASTERY', 'REAL_CASE_STUDIES', 'MARKET_INTELLIGENCE', 'COMPANY_OPERATING_SKILLS'] as const;

export const BENCHMARK_CASES_MAX = 4;
export const COMPETENCIES_MAX = 12;

const expectOf = (c: Json): Json => {
  if (typeof c.expect !== 'object' || c.expect === null || Array.isArray(c.expect)) c.expect = { critical: [] };
  const e = c.expect as Json;
  if (!Array.isArray(e.critical)) e.critical = [];
  return e;
};

/** Drops `key` from `critical` once the constraint is no longer stated. */
function prune(e: Json, key: ExpectationKey): void {
  if (e[key] === undefined) e.critical = (e.critical as string[]).filter((k) => k !== key);
}

/** The constraints a case states (the only ones `critical` may name). */
export function statedKeys(c: Json): ExpectationKey[] {
  const e = expectOf(c);
  return EXPECTATION_KEYS.filter((k) => e[k] !== undefined);
}

export function hasChoice(c: Json, key: ChoiceKey, value: string): boolean {
  const v = expectOf(c)[key];
  return Array.isArray(v) && v.includes(value);
}

/** Ticks or unticks one accepted answer facet; an empty list is removed (an unset constraint). */
export function setChoice(c: Json, key: ChoiceKey, value: string, on: boolean): void {
  const e = expectOf(c);
  const cur = Array.isArray(e[key]) ? (e[key] as string[]).filter((x) => x !== value) : [];
  const next = on ? (EXPECT_CHOICES[key] as readonly string[]).filter((x) => x === value || cur.includes(x)) : cur;
  if (next.length === 0) Reflect.deleteProperty(e, key);
  else e[key] = next;
  prune(e, key);
}

export type Tri = 'ANY' | 'YES' | 'NO';

export function triOf(c: Json, key: 'reversible' | 'founderDecisionNeeded'): Tri {
  const v = expectOf(c)[key];
  return v === true ? 'YES' : v === false ? 'NO' : 'ANY';
}

export function setTri(c: Json, key: 'reversible' | 'founderDecisionNeeded', v: Tri): void {
  const e = expectOf(c);
  if (v === 'ANY') Reflect.deleteProperty(e, key);
  else e[key] = v === 'YES';
  prune(e, key);
}

export function setArabic(c: Json, on: boolean): void {
  const e = expectOf(c);
  if (on) e.arabicBody = true;
  else delete e.arabicBody;
  prune(e, 'arabicBody');
}

/** A typed number, Arabic-Indic digits and the Arabic decimal separator included; blank or not a number → null. */
export function parseNumber(text: string): number | null {
  const latin = text.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace('٫', '.');
  const n = Number(latin);
  return latin === '' || !Number.isFinite(n) ? null : n;
}

/** A number field: blank (or not a number) unsets the constraint. Spend is entered in USD and kept in micros. */
export function setNumber(c: Json, key: 'maxSpendMicros' | 'minBodyChars', text: string): void {
  const e = expectOf(c);
  const n = parseNumber(text);
  if (n === null) Reflect.deleteProperty(e, key);
  else e[key] = key === 'maxSpendMicros' ? Math.round(n * 1_000_000) : Math.round(n);
  prune(e, key);
}

export function numberText(c: Json, key: 'maxSpendMicros' | 'minBodyChars'): string {
  const v = expectOf(c)[key];
  if (typeof v !== 'number') return '';
  return key === 'maxSpendMicros' ? String(v / 1_000_000) : String(v);
}

/** Forbidden phrases, one per line, kept lower-case (the rubric compares lower-case text). */
export function setForbidden(c: Json, text: string): void {
  const e = expectOf(c);
  const list = text.split('\n').map((x) => x.trim().toLowerCase()).filter((x) => x.length > 0);
  if (list.length === 0) delete e.forbidden;
  else e.forbidden = list;
  prune(e, 'forbidden');
}

export function forbiddenText(c: Json): string {
  const v = expectOf(c).forbidden;
  return Array.isArray(v) ? v.map(String).join('\n') : '';
}

export function isCritical(c: Json, key: ExpectationKey): boolean {
  return (expectOf(c).critical as string[]).includes(key);
}

/** Marks a stated constraint critical (any failure fails the case); an unstated one is never critical. */
export function setCritical(c: Json, key: ExpectationKey, on: boolean): void {
  const e = expectOf(c);
  const rest = (e.critical as string[]).filter((k) => k !== key);
  e.critical = on && e[key] !== undefined ? EXPECTATION_KEYS.filter((k) => k === key || rest.includes(k)) : rest;
}

/** A new case: the safe default most roles start from (thin evidence must be recognised). */
export function newCase(code: string): Json {
  return { code, content: '', expect: { evidence: ['INSUFFICIENT', 'PARTIAL'], critical: ['evidence'] } };
}

/** What still stops this case from passing the governed check, in plain words (null = ready). */
export function caseProblem(c: Json): string | null {
  if (typeof c.code !== 'string' || c.code.trim() === '') return 'the case needs a code';
  if (typeof c.content !== 'string' || c.content.trim() === '') return 'the case needs its text';
  if (statedKeys(c).length === 0) return 'state at least one expectation';
  if ((expectOf(c).critical as string[]).length === 0) return 'mark at least one stated expectation as critical';
  return null;
}

/** A new competency: a distinct UPPER_CASE code, judged critical at 70%, retrained in the role's mastery. */
export function newCompetency(existing: readonly Json[]): Json {
  let n = existing.length + 1;
  while (existing.some((x) => x.code === `COMPETENCY_${n}`)) n += 1;
  return { code: `COMPETENCY_${n}`, title: '', critical: true, passPct: 70, retrain: 'ROLE_MASTERY' };
}

/** A competency code typed in ordinary words becomes the UPPER_CASE code the contract needs. */
export function competencyCode(text: string): string {
  return text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

export function competencyProblem(c: Json, all: readonly Json[]): string | null {
  if (typeof c.code !== 'string' || !/^[A-Z][A-Z0-9_]{2,47}$/.test(c.code)) return 'the code needs at least three letters or digits, starting with a letter';
  if (all.filter((x) => x.code === c.code).length > 1) return 'two competencies share this code';
  if (typeof c.title !== 'string' || c.title.trim() === '') return 'the competency needs a description';
  if (!Number.isInteger(c.passPct) || (c.passPct as number) < 1 || (c.passPct as number) > 100) return 'the pass mark is 1 to 100';
  return null;
}
