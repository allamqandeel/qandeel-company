/**
 * C4 review rules (Stage 11; Stage 3 §4; Stage 8 §31–§33). Pure and deterministic, no I/O.
 *
 *   Execute ≠ Review ≠ Approve. A review decision judges quality; it never approves an action (R3 still
 *   needs the Founder's approval), never stands in for R4 and never grants authority. Seniority and titles
 *   never make anyone a reviewer: qualification evidence does.
 */
import { QandeelError, assertCode, boundedText, canonicalJson, isTimestamp, sha256Hex, type RiskLevel, type Timestamp } from '@qandeel-company/domain';

import { TASK_CLASS } from './classes.js';
import { assertMoney, assertTokens } from './economics.js';

export const REVIEW_KEY_KINDS = ['SPECIALIST', 'MANAGER', 'FOUNDER'] as const;
export type ReviewKeyKind = (typeof REVIEW_KEY_KINDS)[number];

export const REVIEW_OUTCOMES = ['PASS', 'FAIL', 'UNCERTAIN', 'INSUFFICIENT_EVIDENCE', 'NEEDS_SPECIALIST', 'ESCALATE'] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export const REVIEW_APPLIES = ['OUTPUT', 'ACTIONS', 'BOTH'] as const;
export type ReviewApplies = (typeof REVIEW_APPLIES)[number];

/**
 * Who makes the C6 operational judgments on a Work Item (Stage 11 §1: a Review Plan may specify outcome
 * verification): outcome verification, attribution validation and learning validation. REVIEW_POOL: the plan's
 * own independent qualified reviewers — never the executor, never a title — decide them; FOUNDER (the default):
 * the Founder does. A judgment is never execution authority: it grants, approves, funds and routes nothing.
 */
export const OPERATIONAL_JUDGMENTS = ['FOUNDER', 'REVIEW_POOL'] as const;
export type OperationalJudgment = (typeof OPERATIONAL_JUDGMENTS)[number];

export const OUTCOME_VERDICTS = ['ACHIEVED', 'NOT_ACHIEVED', 'INCONCLUSIVE'] as const;
export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number];
/** A reviewer's judgment of the outcome, cited to evidence classes (validated against the C6 classes by storage). */
export interface OutcomeJudgment {
  readonly verdict: OutcomeVerdict;
  readonly evidenceClasses: readonly string[];
}

export const REVIEWER_LEVELS = ['QUALIFIED', 'SENIOR', 'EXPERT'] as const;
export type ReviewerLevel = (typeof REVIEWER_LEVELS)[number];
export const reviewerLevelRank = (l: ReviewerLevel): number => REVIEWER_LEVELS.indexOf(l);

const isMember = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
export const isReviewOutcome = (v: unknown): v is ReviewOutcome => isMember(REVIEW_OUTCOMES, v);
export const isReviewerLevel = (v: unknown): v is ReviewerLevel => isMember(REVIEWER_LEVELS, v);
export const isOutcomeVerdict = (v: unknown): v is OutcomeVerdict => isMember(OUTCOME_VERDICTS, v);

/** Review domains are dotted work-type codes (`growth.seo`, `engineering.release`). */
export const REVIEW_DOMAIN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,7}$/;
export function assertReviewDomain(v: unknown, field = 'domain'): string {
  if (typeof v !== 'string' || v.length > 64 || !REVIEW_DOMAIN.test(v)) throw new QandeelError('VALIDATION_FAILED', `${field} must be a dotted work-type code`, { field });
  return v;
}

/** The reviewer role of a domain: a reviewer is certified for THIS role by the C3 Academy (Gold Cases = holdouts). */
export const reviewerRoleFor = (domain: string): string => `role:reviewer.${domain}`;

/** Engineering defaults (tunable policy values, not Product constants). */
export const MIN_GOLD_CASES = 1;
export const MIN_CALIBRATION_AGREEMENTS = 2;
export const MIN_CALIBRATION_AGREEMENT_PCT = 80;
export const MAX_OPEN_REVIEWS_PER_REVIEWER = 5;

export interface ReviewPlan {
  readonly domain: string;
  readonly appliesTo: ReviewApplies;
  readonly keys: readonly { readonly kind: ReviewKeyKind }[];
  readonly independence: { readonly excludeSameDepartment: boolean };
  readonly requiredEvidence: readonly string[];
  readonly rubric: { readonly code: string; readonly version: number };
  readonly reviewerInstructions: string;
  readonly reviewTaskClass: string;
  readonly reviewBudget: { readonly money: number; readonly tokens: number };
  readonly deadlineAt: Timestamp | null;
  readonly operationalJudgment: OperationalJudgment;
}

const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
function plain(v: unknown, field: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) throw new QandeelError('VALIDATION_FAILED', `${field} must be a plain object`, { field });
  return v as Record<string, unknown>;
}

/**
 * A Review Plan by own fields only. Every plan has at least one independent SPECIALIST key (a qualified
 * reviewer): a MANAGER or FOUNDER key alone would let authority stand in for independent review, and a
 * FOUNDER key alone would let the R3 approval double as the review (Execute ≠ Review ≠ Approve).
 */
export function parseReviewPlan(input: unknown): ReviewPlan {
  const o = plain(input, 'reviewPlan');
  for (const k of Object.keys(o)) {
    if (!['domain', 'appliesTo', 'keys', 'independence', 'requiredEvidence', 'rubric', 'reviewerInstructions', 'reviewTaskClass', 'reviewBudget', 'deadlineAt', 'operationalJudgment'].includes(k)) throw new QandeelError('VALIDATION_FAILED', 'review plan has an unknown field', { field: `reviewPlan.${k.slice(0, 32)}` });
  }
  const appliesTo = own(o, 'appliesTo');
  if (!isMember(REVIEW_APPLIES, appliesTo)) throw new QandeelError('VALIDATION_FAILED', 'appliesTo is OUTPUT, ACTIONS or BOTH', { field: 'appliesTo' });
  const rawKeys = own(o, 'keys');
  if (!Array.isArray(rawKeys) || rawKeys.length < 1 || rawKeys.length > 3) throw new QandeelError('VALIDATION_FAILED', 'a review plan has one to three keys', { field: 'keys' });
  const keys = rawKeys.map((k, i) => {
    const kind = own(plain(k, `keys[${i}]`), 'kind');
    if (!isMember(REVIEW_KEY_KINDS, kind)) throw new QandeelError('VALIDATION_FAILED', 'a key is SPECIALIST, MANAGER or FOUNDER', { field: `keys[${i}].kind` });
    return { kind };
  });
  if (!keys.some((k) => k.kind === 'SPECIALIST')) throw new QandeelError('VALIDATION_FAILED', 'every review plan needs an independent qualified SPECIALIST key', { field: 'keys', reason: 'SPECIALIST_KEY_REQUIRED' });
  if (keys.filter((k) => k.kind !== 'SPECIALIST').some((k, i, all) => all.findIndex((x) => x.kind === k.kind) !== i)) throw new QandeelError('VALIDATION_FAILED', 'a MANAGER or FOUNDER key appears at most once', { field: 'keys' });
  const independence = plain(own(o, 'independence') ?? {}, 'independence');
  for (const k of Object.keys(independence)) if (k !== 'excludeSameDepartment') throw new QandeelError('VALIDATION_FAILED', 'independence has an unknown field', { field: 'independence' });
  const exclude = own(independence, 'excludeSameDepartment');
  if (exclude !== undefined && typeof exclude !== 'boolean') throw new QandeelError('VALIDATION_FAILED', 'independence.excludeSameDepartment is a boolean', { field: 'independence' });
  const ev = own(o, 'requiredEvidence') ?? [];
  if (!Array.isArray(ev) || ev.length > 16) throw new QandeelError('VALIDATION_FAILED', 'requiredEvidence is a list of evidence codes', { field: 'requiredEvidence' });
  const rubric = plain(own(o, 'rubric'), 'rubric');
  const version = own(rubric, 'version');
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > 1_000_000) throw new QandeelError('VALIDATION_FAILED', 'rubric.version is a positive integer', { field: 'rubric.version' });
  const code = own(rubric, 'code');
  if (typeof code !== 'string' || code.length > 64 || !REVIEW_DOMAIN.test(code)) throw new QandeelError('VALIDATION_FAILED', 'rubric.code is a dotted code', { field: 'rubric.code' });
  const taskClass = own(o, 'reviewTaskClass');
  if (typeof taskClass !== 'string' || taskClass.length > 64 || !TASK_CLASS.test(taskClass)) throw new QandeelError('VALIDATION_FAILED', 'reviewTaskClass is a task class', { field: 'reviewTaskClass' });
  const budget = plain(own(o, 'reviewBudget'), 'reviewBudget');
  const deadline = own(o, 'deadlineAt');
  if (deadline !== undefined && deadline !== null && !isTimestamp(deadline)) throw new QandeelError('VALIDATION_FAILED', 'deadlineAt is a canonical UTC timestamp', { field: 'deadlineAt' });
  const judgment = own(o, 'operationalJudgment') ?? 'FOUNDER';
  if (!isMember(OPERATIONAL_JUDGMENTS, judgment)) throw new QandeelError('VALIDATION_FAILED', 'operationalJudgment is FOUNDER or REVIEW_POOL', { field: 'operationalJudgment' });
  // A plan that reserves a FOUNDER key keeps the Founder's judgment: the pool never stands in for it.
  if (judgment === 'REVIEW_POOL' && keys.some((k) => k.kind === 'FOUNDER')) throw new QandeelError('VALIDATION_FAILED', 'a plan with a FOUNDER key keeps Founder judgment', { field: 'operationalJudgment', reason: 'FOUNDER_KEY_RESERVES_JUDGMENT' });
  return {
    operationalJudgment: judgment,
    domain: assertReviewDomain(own(o, 'domain')),
    appliesTo,
    keys,
    independence: { excludeSameDepartment: exclude === true },
    requiredEvidence: ev.map((x, i) => assertCode(x, `requiredEvidence[${i}]`)),
    rubric: { code, version },
    reviewerInstructions: boundedText(own(o, 'reviewerInstructions'), 'reviewerInstructions', 8000),
    reviewTaskClass: taskClass,
    reviewBudget: { money: assertMoney(own(budget, 'money'), 'reviewBudget.money'), tokens: assertTokens(own(budget, 'tokens'), 'reviewBudget.tokens') },
    deadlineAt: (deadline as Timestamp | undefined) ?? null,
  };
}

/** Whether a plan governs this subject (a Work Item's output, or an action proposed inside it). */
export const planAppliesTo = (applies: ReviewApplies, subject: 'OUTPUT' | 'ACTION'): boolean => applies === 'BOTH' || (subject === 'OUTPUT' ? applies === 'OUTPUT' : applies === 'ACTIONS');

export type RequestState = 'OPEN' | 'SATISFIED' | 'REWORK' | 'CONFLICT' | 'ESCALATED';

/**
 * The one deterministic evaluation of a review request from its keys' CURRENT counting decisions:
 * - an explicit uncertainty (UNCERTAIN / INSUFFICIENT_EVIDENCE / ESCALATE) escalates — guessing is never
 *   preferred to uncertainty (Stage 11 §15);
 * - NEEDS_SPECIALIST re-assigns that key to a stronger, different reviewer;
 * - until every key has decided, the request stays OPEN;
 * - all PASS → SATISFIED; all FAIL → REWORK; any PASS/FAIL mix → CONFLICT (never averaged, §20).
 */
export function evaluateRequest(keyCount: number, decisions: readonly { readonly keyIndex: number; readonly outcome: ReviewOutcome }[]): { state: RequestState; reassign: readonly number[] } {
  const byKey = new Map<number, ReviewOutcome>();
  for (const d of decisions) if (Number.isInteger(d.keyIndex) && d.keyIndex >= 0 && d.keyIndex < keyCount) byKey.set(d.keyIndex, d.outcome);
  const outcomes = [...byKey.values()];
  if (outcomes.some((x) => x === 'UNCERTAIN' || x === 'INSUFFICIENT_EVIDENCE' || x === 'ESCALATE')) return { state: 'ESCALATED', reassign: [] };
  const reassign = [...byKey.entries()].filter(([, x]) => x === 'NEEDS_SPECIALIST').map(([k]) => k).sort((a, b) => a - b);
  if (reassign.length > 0) return { state: 'OPEN', reassign };
  if (byKey.size < keyCount) return { state: 'OPEN', reassign: [] };
  if (outcomes.every((x) => x === 'PASS')) return { state: 'SATISFIED', reassign: [] };
  if (outcomes.every((x) => x === 'FAIL')) return { state: 'REWORK', reassign: [] };
  return { state: 'CONFLICT', reassign: [] };
}

/** Why a candidate may not review this subject (independence, Stage 3 §4 / Stage 11 §3, §10), or null. */
export function independenceViolation(c: { readonly reviewerId: string; readonly executorId: string | null; readonly delegationChain: readonly string[]; readonly otherKeyReviewers: readonly string[]; readonly priorReviewers: readonly string[] }): string | null {
  if (c.executorId !== null && c.reviewerId === c.executorId) return 'SELF_REVIEW';
  if (c.delegationChain.includes(c.reviewerId)) return 'DELEGATION_CHAIN';
  if (c.otherKeyReviewers.includes(c.reviewerId)) return 'SAME_REVIEWER_TWO_KEYS';
  if (c.priorReviewers.includes(c.reviewerId)) return 'ALREADY_REVIEWED';
  return null;
}

/** A shadow (calibration) decision against the authoritative outcome: evidence for reviewer trust (§13, §14). */
export function calibrationSignal(shadow: ReviewOutcome, final: 'SATISFIED' | 'REWORK'): 'AGREE' | 'DISAGREE' | 'NONE' {
  if (shadow !== 'PASS' && shadow !== 'FAIL') return 'NONE';
  return (shadow === 'PASS') === (final === 'SATISFIED') ? 'AGREE' : 'DISAGREE';
}

/** What still keeps a calibration-mode reviewer from independent (ACTIVE) review authority. */
export function promotionGaps(q: { readonly goldPassed: number; readonly agreements: number; readonly disagreements: number }): string[] {
  const gaps: string[] = [];
  if (q.goldPassed < MIN_GOLD_CASES) gaps.push('GOLD_CASES_MISSING');
  if (q.agreements < MIN_CALIBRATION_AGREEMENTS) gaps.push('CALIBRATION_EVIDENCE_MISSING');
  const total = q.agreements + q.disagreements;
  if (total > 0 && q.agreements * 100 < MIN_CALIBRATION_AGREEMENT_PCT * total) gaps.push('CALIBRATION_AGREEMENT_LOW');
  return gaps;
}

/**
 * The versioned subject of an OUTPUT review: the Work Item, the run whose result is judged and the content
 * hashes of its objective, input and result. Any rework / new completion is a different subject.
 */
export function outputSubjectFingerprint(s: { readonly workItemId: string; readonly runRef: string; readonly resultSha256: string; readonly objectiveSha256: string; readonly inputSha256: string }): string {
  return sha256Hex(canonicalJson({ v: 1, kind: 'OUTPUT', ...s }));
}

/** Risk levels whose actions need independent review (Stage 3 §2 / §4). R4 never executes at all. */
export const actionNeedsReview = (risk: RiskLevel): boolean => risk === 'R2' || risk === 'R3';

// --- C6 operational judgment through the Review Pool (Verification authority ≠ execution authority) ---------

/**
 * Who judges a Work Item's C6 subjects (outcome, attribution, learning): its plan's Review Pool only when the plan
 * says so, and never for R4 (Founder-only sovereignty). No plan → the Founder. Everything else a judgment might
 * touch (grants, budgets, approvals, routing, risk ceilings) is outside this rule entirely.
 */
export function judgmentRoute(s: { readonly planJudgment: OperationalJudgment | null; readonly risk: RiskLevel }): { readonly judge: 'REVIEW_POOL' | 'FOUNDER'; readonly reason: string } {
  if (s.risk === 'R4') return { judge: 'FOUNDER', reason: 'R4_FOUNDER_ONLY' };
  if (s.planJudgment === null) return { judge: 'FOUNDER', reason: 'NO_REVIEW_PLAN' };
  if (s.planJudgment !== 'REVIEW_POOL') return { judge: 'FOUNDER', reason: 'PLAN_RESERVES_FOUNDER' };
  return { judge: 'REVIEW_POOL', reason: 'PLAN_DELEGATES_JUDGMENT' };
}

/**
 * The verified outcome of a SATISFIED output review whose plan delegates judgment to the pool, from each counting
 * key's own outcome judgment — never averaged (Stage 11 §20):
 * - a key that gave no judgment → nothing is verified (the outcome stays unverified and visible);
 * - any INCONCLUSIVE → INCONCLUSIVE; ACHIEVED beside NOT_ACHIEVED → INCONCLUSIVE (a conflict the Founder resolves);
 * - every key ACHIEVED → ACHIEVED; every key NOT_ACHIEVED → NOT_ACHIEVED.
 */
export function outcomeFromReviewKeys(keyCount: number, judgments: readonly { readonly keyIndex: number; readonly verdict: OutcomeVerdict | null }[]): { readonly verdict: OutcomeVerdict | null; readonly reason: 'KEYS_AGREE' | 'OUTCOME_JUDGMENT_MISSING' | 'OUTCOME_INCONCLUSIVE' | 'OUTCOME_CONFLICT' } {
  const byKey = new Map<number, OutcomeVerdict | null>();
  for (const j of judgments) if (Number.isInteger(j.keyIndex) && j.keyIndex >= 0 && j.keyIndex < keyCount) byKey.set(j.keyIndex, j.verdict);
  const verdicts = [...byKey.values()];
  if (keyCount < 1 || byKey.size < keyCount || verdicts.some((v) => v === null)) return { verdict: null, reason: 'OUTCOME_JUDGMENT_MISSING' };
  if (verdicts.includes('INCONCLUSIVE')) return { verdict: 'INCONCLUSIVE', reason: 'OUTCOME_INCONCLUSIVE' };
  if (verdicts.every((v) => v === 'ACHIEVED')) return { verdict: 'ACHIEVED', reason: 'KEYS_AGREE' };
  if (verdicts.every((v) => v === 'NOT_ACHIEVED')) return { verdict: 'NOT_ACHIEVED', reason: 'KEYS_AGREE' };
  return { verdict: 'INCONCLUSIVE', reason: 'OUTCOME_CONFLICT' };
}

/** A pool judge's review outcome on a C6 subject: PASS validates, FAIL rejects, any uncertainty escalates to the Founder. */
export function judgmentFromReview(outcome: ReviewOutcome): 'VALIDATE' | 'REJECT' | 'ESCALATE' {
  if (outcome === 'PASS') return 'VALIDATE';
  if (outcome === 'FAIL') return 'REJECT';
  return 'ESCALATE';
}
