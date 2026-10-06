/**
 * C5 Founder Command Center kernel (pure, deterministic, no I/O): the Goal lifecycle, the structured
 * communication vocabulary (Stage 9), Founder Attention lanes / levels and the Founder command-intent
 * classifier.
 *
 * The classifier is the one place natural language meets the Founder surface, and it is a closed
 * deterministic grammar, not a model: a read intent changes attention (focus, lens, filter) and may run
 * directly; a mutating intent becomes a structured preview that the Founder confirms explicitly at the
 * action boundary. Natural-language input is untrusted data and cannot grant authority (Stage 14
 * D14-A.6, Stage 9 §6): nothing here returns "execute".
 */
import { QandeelError } from '@qandeel-company/domain';

import { PILOT_INTENTS } from './pilot.js';

// --- Goals (Stage 2 §3) -------------------------------------------------------------------------

export const GOAL_KINDS = ['COMPANY', 'DEPARTMENT'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const GOAL_STATES = ['DRAFT', 'PROPOSED', 'APPROVED', 'ACTIVE', 'PAUSED', 'ACHIEVED', 'CANCELLED', 'SUPERSEDED'] as const;
export type GoalState = (typeof GOAL_STATES)[number];

export const TERMINAL_GOAL_STATES: readonly GoalState[] = ['ACHIEVED', 'CANCELLED', 'SUPERSEDED'];
export const LIVE_GOAL_STATES: readonly GoalState[] = ['APPROVED', 'ACTIVE', 'PAUSED'];

const GOAL_TRANSITIONS: Readonly<Record<GoalState, readonly GoalState[]>> = {
  DRAFT: ['PROPOSED', 'CANCELLED'],
  PROPOSED: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['ACTIVE', 'CANCELLED', 'SUPERSEDED'],
  ACTIVE: ['PAUSED', 'ACHIEVED', 'CANCELLED', 'SUPERSEDED'],
  PAUSED: ['ACTIVE', 'CANCELLED', 'SUPERSEDED'],
  ACHIEVED: [],
  CANCELLED: [],
  SUPERSEDED: [],
};

export function isGoalState(v: unknown): v is GoalState {
  return typeof v === 'string' && (GOAL_STATES as readonly string[]).includes(v);
}

export function isGoalKind(v: unknown): v is GoalKind {
  return typeof v === 'string' && (GOAL_KINDS as readonly string[]).includes(v);
}

/** The Goal lifecycle is explicit and forward: a closed goal is history. */
export function assertGoalTransition(from: GoalState, to: GoalState): void {
  if (!GOAL_TRANSITIONS[from].includes(to)) throw new QandeelError('GOAL_INVALID', 'goal transition is not allowed', { from, to });
}

/** Entering APPROVED / ACTIVE is a Founder act for a COMPANY goal (Stage 2 §3); a Director may derive within authority. */
export function goalTransitionNeedsFounder(kind: GoalKind, to: GoalState): boolean {
  return kind === 'COMPANY' && (to === 'APPROVED' || to === 'ACTIVE' || to === 'SUPERSEDED');
}

// --- Communication (Stage 9 §1, §18, §25) -------------------------------------------------------

export const MESSAGE_PURPOSES = ['REQUEST', 'QUESTION', 'FYI', 'REVIEW', 'DECISION_REQUEST', 'BLOCKER', 'ESCALATION', 'RESULT', 'CORRECTION', 'BRIEF'] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

export const ATTENTION_LEVELS = ['INFORMATIONAL', 'NEEDS_ATTENTION', 'NEEDS_DECISION', 'URGENT'] as const;
export type AttentionLevel = (typeof ATTENTION_LEVELS)[number];

export const ATTENTION_LANES = ['NEEDS_ME', 'CEO_BRIEFS', 'THREADS'] as const;
export type AttentionLane = (typeof ATTENTION_LANES)[number];

export const THREAD_KINDS = ['FOUNDER_CEO', 'FOUNDER_EMPLOYEE', 'CEO_BRIEF'] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];

export const CONTEXT_KINDS = ['GOAL', 'WORK_ITEM', 'DECISION', 'REVIEW', 'APPROVAL', 'DEPARTMENT', 'INCIDENT'] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

export const isMessagePurpose = (v: unknown): v is MessagePurpose => typeof v === 'string' && (MESSAGE_PURPOSES as readonly string[]).includes(v);
export const isAttentionLevel = (v: unknown): v is AttentionLevel => typeof v === 'string' && (ATTENTION_LEVELS as readonly string[]).includes(v);
export const isContextKind = (v: unknown): v is ContextKind => typeof v === 'string' && (CONTEXT_KINDS as readonly string[]).includes(v);

/** The Founder Communication Standard (Stage 9 §15): a brief answers four questions, in order. */
export interface FounderBrief {
  readonly happening: string;
  readonly matters: string;
  readonly recommendation: string;
  readonly decisionNeeded: boolean;
  readonly decision?: string;
}

const BRIEF_FIELD_MAX = 1_200;

export function isFounderBrief(v: unknown): v is FounderBrief {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.some((k) => !['happening', 'matters', 'recommendation', 'decisionNeeded', 'decision'].includes(k))) return false;
  const text = (x: unknown): boolean => typeof x === 'string' && x.trim().length > 0 && x.length <= BRIEF_FIELD_MAX;
  if (!text(o.happening) || !text(o.matters) || !text(o.recommendation) || typeof o.decisionNeeded !== 'boolean') return false;
  if (o.decisionNeeded) return text(o.decision);
  return o.decision === undefined;
}

/** Which attention level a brief warrants: a decision request is NEEDS_DECISION, else it informs (Stage 9 §29). */
export function briefAttentionLevel(brief: FounderBrief): AttentionLevel {
  return brief.decisionNeeded ? 'NEEDS_DECISION' : 'INFORMATIONAL';
}

/**
 * Whether a message purpose / level combination belongs in Founder Attention at all (Stage 9 §16):
 * routine FYI / RESULT traffic never enters the Founder's lanes; decisions, escalations, blockers and
 * briefs do. Silence is never approval, so an unanswered DECISION_REQUEST stays until resolved.
 */
export function warrantsFounderAttention(purpose: MessagePurpose, level: AttentionLevel): boolean {
  if (purpose === 'BRIEF' || purpose === 'DECISION_REQUEST' || purpose === 'ESCALATION' || purpose === 'BLOCKER') return true;
  return level === 'NEEDS_DECISION' || level === 'URGENT';
}

// --- Founder command intents ---------------------------------------------------------------------

/** Read intents change attention only; mutating intents become structured previews (explicit confirmation). */
export const READ_INTENTS = ['OPEN_EMPLOYEE', 'SHOW_DEPARTMENT', 'SHOW_GOAL', 'WHO_WORKS_ON', 'WHAT_IS_BLOCKED', 'NEEDS_MY_APPROVAL', 'SHOW_BRIEFS', 'RETURN_TO_LIVE', 'SHOW_CEO', 'SHOW_TIMELINE', 'SHOW_REPORT', 'SHOW_PERFORMANCE', 'SHOW_PILOT', 'SHOW_DIGITAL', 'SHOW_PROVIDERS', 'SHOW_ACTIVATION'] as const;
/**
 * The Founder's exception decisions (R2-21) are STRUCTURED-ONLY intents: no natural-language pattern produces
 * them (like GOAL_PROPOSE); the surface posts them with IDs / codes / bounded numbers, and they are confirmed
 * through the same governed preview as every other act.
 */
export const EXCEPTION_INTENTS = ['TOOL_RECONCILE', 'RESERVATION_RECONCILE', 'JOB_RECONCILE', 'REVIEW_ESCALATION_RESOLVE', 'SYSTEMIC_DECIDE', 'ATTRIBUTION_DECIDE', 'LESSON_DECIDE', 'OUTCOME_VERIFY', 'PROMOTION_DECIDE'] as const;
/**
 * C7-A: what the Company may treat as real-world evidence is a Founder decision — registering a governed source (or a
 * new contract version of it), activating / suspending / retiring it, and binding an accepted record to Company work
 * or a Goal (or ending that binding) — and deciding a verification a later evidence-integrity conflict contested
 * (uphold, replace or retract). Structured-only, like the exception decisions: no text produces them.
 */
export const EXTERNAL_EVIDENCE_INTENTS = ['SOURCE_REGISTER', 'SOURCE_DECIDE', 'EVIDENCE_BIND', 'EVIDENCE_UNBIND', 'OUTCOME_CONTEST_RESOLVE'] as const;
// C7-C: the Pilot intents (`./pilot.ts`) are structured-only too — a Pilot is created and moved only by an explicit,
// confirmed Founder act, never by text and never by a message in the briefing thread.
// L1-01: provisioning a release-pinned provider profile (catalog, pricing basis, egress, route policies, the first
// bounded budget) is a structured-only Founder act of the same boundary: no text pattern produces it, the preview shows
// the exact deployments, peak rates and cap, and the confirm registers everything through the canonical catalog APIs.
export const PROVISIONING_INTENTS = ['PROVIDER_PROVISION'] as const;
/**
 * L1-02 (D-L1-13): the first production activation of a Company role — a hire into a vacant seat, the trainee lifecycle
 * steps (never ACTIVE), the Employee's bounded model access, the release-pinned Academy package's qualification and its
 * one install confirmation, and the Academy's own Founder acts (enrollment, modules, attempts, evaluation, retraining,
 * shadow work, probation, calibration) up to the final Activation decision. Structured-only, like every act of this
 * boundary: no text pattern produces them, and each calls the existing canonical store at confirmation.
 */
export const ACTIVATION_INTENTS = ['EMPLOYEE_HIRE', 'EMPLOYEE_LIFECYCLE', 'EMPLOYEE_MODEL_ACCESS', 'SKILL_PACKAGE_QUALIFY', 'ACADEMY_PACKAGE_INSTALL', 'ACADEMY_ENROLL', 'ACADEMY_MODULES_COMPLETE', 'ACADEMY_ATTEMPT_START', 'ACADEMY_EVALUATE', 'ACADEMY_RETRAIN_COMPLETE', 'ACADEMY_SHADOW_ASSIGN', 'ACADEMY_PROBATION_EVIDENCE', 'ACADEMY_PROBATION_REVIEW', 'ACADEMY_CALIBRATION', 'ACTIVATION_DECIDE'] as const;
export const MUTATING_INTENTS = ['APPROVAL_DECIDE', 'GOAL_APPROVE', 'GOAL_STATE', 'GOAL_PROPOSE', 'STAFFING_DECIDE', 'CONFLICT_RESOLVE', 'BUDGET_CEILING', 'DELEGATE_WORK', ...EXCEPTION_INTENTS, ...EXTERNAL_EVIDENCE_INTENTS, ...PILOT_INTENTS, ...PROVISIONING_INTENTS, ...ACTIVATION_INTENTS] as const;
export type ReadIntent = (typeof READ_INTENTS)[number];
export type MutatingIntent = (typeof MUTATING_INTENTS)[number];

export type FounderIntent =
  | { readonly kind: 'READ'; readonly intent: ReadIntent; readonly argument: string | null }
  | {
      readonly kind: 'MUTATING';
      readonly intent: MutatingIntent;
      readonly argument: string | null;
      readonly amount: { readonly currency: string; readonly value: number } | null;
      /** The decision the words state; null when none is stated (never a silent default). */
      readonly decision: 'APPROVE' | 'REJECT' | null;
      /** GOAL_STATE only: the target state of the command's own verb (never re-read from the argument). */
      readonly goalState: GoalState | null;
    }
  | { readonly kind: 'UNKNOWN' };

export const isMutatingIntent = (v: unknown): v is MutatingIntent => typeof v === 'string' && (MUTATING_INTENTS as readonly string[]).includes(v);

const COMMAND_MAX = 400;
const normalize = (s: string): string =>
  s
    .normalize('NFC')
    .replace(/[ً-ْـ]/g, '') // Arabic diacritics and tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[،,؟?!.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const latinDigits = (s: string): string => s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

const MONEY = /(?:egp|جنيه|usd|\$|sar|ريال|dollars?|دولار)\s*([0-9][0-9,._]*(?:\s*(?:k|ألف|الف))?)|([0-9][0-9,._]*(?:\s*(?:k|ألف|الف))?)\s*(?:egp|جنيه|usd|sar|ريال|dollars?|دولار)/i;

function amountOf(text: string): { currency: string; value: number } | null {
  const m = MONEY.exec(latinDigits(text));
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? '').replace(/[,_\s]/g, '');
  const thousand = /k|ألف|الف/i.test(raw);
  const value = Number(raw.replace(/k|ألف|الف/gi, '')) * (thousand ? 1_000 : 1);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000_000) return null;
  const whole = m[0].toLowerCase();
  const currency = /egp|جنيه/.test(whole) ? 'EGP' : /sar|ريال/.test(whole) ? 'SAR' : 'USD';
  return { currency, value: Math.round(value) };
}

interface Pattern {
  readonly re: RegExp;
  readonly intent: ReadIntent;
  readonly kind: 'READ';
}

// READ patterns. Order matters: the first match wins. A word ends at whitespace or the end of input (`\b` is
// ASCII-only and never sits between an Arabic letter and a space). Mutating intents are NOT matched here: they
// come only from the command's own leading verb (`mutatingOf`, RR1-1), so a verb inside an argument never
// selects an act.
const W = String.raw`(?=\s|$)`;
const PATTERNS: readonly Pattern[] = [
  { re: /^(?:رجوع|ارجع|عوده|عد)(?:\s+(?:الي|ل))?\s*(?:الحي|المباشر|live)?$|^(?:return|back|go back)(?:\s+to)?\s*live$|^live$/, intent: 'RETURN_TO_LIVE', kind: 'READ' },
  { re: new RegExp(String.raw`(?:مين|من)\s+(?:بيشتغل|يشتغل|يعمل|شغال)\s+(?:علي|في)${W}|who(?:'s| is)?\s+working\s+on${W}`), intent: 'WHO_WORKS_ON', kind: 'READ' },
  { re: /(?:ايه|ما|ماذا)\s*(?:اللي|الذي)?\s*(?:ال)?(?:متوقف|معطل|محجوز|blocked)|what(?:'s| is)?\s+blocked/, intent: 'WHAT_IS_BLOCKED', kind: 'READ' },
  { re: /(?:محتاج|يحتاج|بحاجه|في انتظار|ينتظر)\s*(?:ل)?(?:موافقتي|قراري|مني)|needs?\s+my\s+(?:approval|decision)|pending\s+approvals?/, intent: 'NEEDS_MY_APPROVAL', kind: 'READ' },
  // C6: the Daily / Weekly / Monthly reports and on-demand performance inspection (reads; never an act).
  { re: /(?:daily|weekly|monthly|يومي|اليومي|اسبوعي|الاسبوعي|شهري|الشهري)\s*(?:company\s+)?(?:report|review|brief|تقرير|مراجعه|موجز)|(?:report|review|brief|تقرير|مراجعه|موجز)\s*(?:ال)?(?:daily|weekly|monthly|يومي|اسبوعي|شهري)/, intent: 'SHOW_REPORT', kind: 'READ' },
  { re: /(?:performance|اداء)\s+(?:of\s+)?\S|how\s+is\s+.+\s+(?:doing|performing)/, intent: 'SHOW_PERFORMANCE', kind: 'READ' },
  { re: new RegExp(String.raw`(?:اعرض|اظهر|عرض|show|open)${W}.*(?:موجز|ملخصات|briefs?)|^briefs?$|^(?:الموجز|الملخصات)$`), intent: 'SHOW_BRIEFS', kind: 'READ' },
  { re: new RegExp(String.raw`(?:اعرض|اظهر|افتح|عرض|show|open)${W}.*(?:الزمن|التاريخ|timeline|history)|^timeline$`), intent: 'SHOW_TIMELINE', kind: 'READ' },
  { re: new RegExp(String.raw`(?:افتح|اعرض|اظهر|show|open)${W}.*(?:المدير التنفيذي|الرئيس التنفيذي|ceo)${W}|^ceo$|^(?:المدير التنفيذي|الرئيس التنفيذي)$`), intent: 'SHOW_CEO', kind: 'READ' },
  { re: new RegExp(String.raw`(?:اعرض|اظهر|افتح|عرض|show|open)${W}.*(?:هدف|goal)`), intent: 'SHOW_GOAL', kind: 'READ' },
  { re: new RegExp(String.raw`(?:اعرض|اظهر|افتح|عرض|show|open)${W}.*(?:قسم|اداره|department|engineering|growth|product|brand|intelligence|الهندسه|النمو|المنتج|العلامه|الاستخبارات)`), intent: 'SHOW_DEPARTMENT', kind: 'READ' },
  // C7-C: open a Pilot's Evidence Board, after the goal / department reads so a goal named with the word stays a goal (a read; a Pilot is never created or moved by text).
  { re: new RegExp(String.raw`(?:اعرض|اظهر|افتح|عرض|show|open)${W}.*(?:التجربه|تجربه|pilots?)${W}|^pilots?$|^(?:التجربه|التجارب)$`), intent: 'SHOW_PILOT', kind: 'READ' },
  // C7-D: the Company's digital work (projects, previews, candidates, exact external acts awaiting the Founder) — a read; nothing is
  // published, approved or changed by text.
  { re: new RegExp(String.raw`(?:اعرض|اظهر|افتح|عرض|show|open)${W}.*(?:الموقع|موقع|الحضور الرقمي|المشاريع الرقميه|المعاينه|digital|website|previews?)${W}|^(?:digital|website|الموقع|الحضور الرقمي)$`), intent: 'SHOW_DIGITAL', kind: 'READ' },
  // L1-01: the model providers (release-pinned profiles, identity checks, what is provisioned) — a read; provisioning
  // itself is the structured-only PROVIDER_PROVISION confirmation.
  { re: new RegExp(String.raw`(?:اعرض|اظهر|افتح|عرض|show|open)${W}.*(?:المزودين|مزودي النماذج|مزود|النماذج|providers?|models?)${W}|^(?:providers?|models?|المزودين|النماذج)$`), intent: 'SHOW_PROVIDERS', kind: 'READ' },
  // L1-02: the Company activation flow — a read; every activation act is a structured-only confirmation ("activate …"
  // stays a lead verb of the closed grammar and is never a read).
  { re: new RegExp(String.raw`(?:اعرض|اظهر|افتح|عرض|show|open)${W}.*(?:التفعيل|تفعيل الشركه|activation)${W}|^(?:activation|company activation|تفعيل الشركه|التفعيل)$`), intent: 'SHOW_ACTIVATION', kind: 'READ' },
  { re: /(?:افتح|اعرض|اظهر|open|show)\s+(.+)/, intent: 'OPEN_EMPLOYEE', kind: 'READ' },
];

const ARGUMENT_STRIP = /^(?:افتح|اعرض|اظهر|عرض|show|open)\s+/;

// --- The command's own verb (RR1-1) --------------------------------------------------------------------
// A mutating intent comes ONLY from the command's leading verb (after polite words and an addressee): the
// verb selects the intent family and the decision; the object's head noun right after the verb, or the
// trailing noun of "the <title> goal", selects the act within that family. Words inside the argument (a goal
// title, a work objective, a position title) never select or change the intent or the decision, and a
// command with no leading verb is never an act guessed from a verb further in. The grammar stays closed and
// deterministic (D-C5-07).

type VerbFamily = 'APPROVE' | 'REJECT' | 'RESOLVE' | 'GOAL_STATE' | 'PROPOSE' | 'RUN' | 'DELEGATE' | 'STAFFING';
const LEAD_VERBS: ReadonlyMap<string, VerbFamily> = new Map<string, VerbFamily>([
  ...['وافق', 'اعتمد', 'اقبل', 'approve', 'accept', 'grant'].map((v) => [v, 'APPROVE'] as const),
  ...['ارفض', 'refuse', 'reject', 'deny'].map((v) => [v, 'REJECT'] as const),
  ...['حل', 'resolve'].map((v) => [v, 'RESOLVE'] as const),
  ...['اوقف', 'فعل', 'activate', 'pause', 'resume', 'achieve', 'cancel', 'الغ', 'الغي'].map((v) => [v, 'GOAL_STATE'] as const),
  ...['اقترح', 'انشئ', 'انشيء', 'add', 'create', 'propose'].map((v) => [v, 'PROPOSE'] as const),
  ...['شغل', 'نفذ', 'run', 'launch', 'start', 'حدد', 'set'].map((v) => [v, 'RUN'] as const),
  ...['فوض', 'delegate', 'assign'].map((v) => [v, 'DELEGATE'] as const),
  ...['توظيف', 'staffing', 'hire'].map((v) => [v, 'STAFFING'] as const),
]);

/** The target state each goal-state verb names (R2-23): read from the leading verb only, never from the argument. */
const GOAL_STATE_OF_VERB: ReadonlyMap<string, GoalState> = new Map<string, GoalState>([
  ['pause', 'PAUSED'], ['اوقف', 'PAUSED'],
  ['cancel', 'CANCELLED'], ['الغ', 'CANCELLED'], ['الغي', 'CANCELLED'],
  ['achieve', 'ACHIEVED'],
  ['activate', 'ACTIVE'], ['resume', 'ACTIVE'], ['فعل', 'ACTIVE'],
]);

/** Words that may precede (or follow) the command's own verb and carry no meaning. */
const POLITE_LEAD = /^(?:please|pls|kindly|ok|okay|now|so|then|can you|could you|would you|من فضلك|لو سمحت|رجاء|رجاءا|ياريت|يا ريت|ممكن|طيب|الان|دلوقتي)\s+/;
const POLITE_TAIL = /\s+(?:please|pls|now|thanks|thank you|من فضلك|لو سمحت|الان|دلوقتي|شكرا)$/;
/** An addressee before the verb: one word followed by a comma ("Ehab, run …"), or the Arabic vocative "يا <name>". */
const VOCATIVE_COMMA = /^\s*([^\s,،]+)\s*[,،]\s*/;
const VOCATIVE_YA = /^يا\s+(\S+)\s+/;
/** Connective words between the verb and its object. */
const OBJECT_FILLER = /^(?:علي|في|the|a|an|to|for|on|ال|ل)$/;

type ObjectNoun = 'GOAL' | 'BUDGET' | 'STAFFING' | 'CONFLICT';
function nounOf(word: string | undefined): ObjectNoun | null {
  if (word === undefined) return null;
  if (/^(?:ال)?هدف$|^goal$/.test(word)) return 'GOAL';
  if (/^(?:ب|لل|ل)?(?:ال)?(?:ميزانيه|سقف)$|^(?:budget|ceiling)$/.test(word)) return 'BUDGET';
  if (/^(?:ال)?توظيف$|^(?:staffing|hiring)$/.test(word)) return 'STAFFING';
  if (/^(?:ال)?(?:تعارض|خلاف)$|^conflict$/.test(word)) return 'CONFLICT';
  return null;
}
const REQUEST_WORD = /^(?:طلب|request|requests)$/;
/** The noun right after the verb ("goal <title>", "staffing request <title>", "طلب توظيف …", "conflict …"). */
function headNoun(obj: readonly string[]): ObjectNoun | null {
  const n = nounOf(obj[0]);
  if (n !== null) return n;
  return REQUEST_WORD.test(obj[0] ?? '') && nounOf(obj[1]) === 'STAFFING' ? 'STAFFING' : null;
}
/** A closing budget clause: a budget word followed only by an amount and its connectives ("… with a budget of EGP 50,000", "… بميزانيه ٥٠ الف جنيه"). */
const BUDGET_TAIL_WORD = /^(?:of|a|an|the|max|maximum|up|to|at|is|be|من|قدرها|قدره|حد|اقصي|الاقصي|egp|usd|sar|dollars?|جنيه|ريال|دولار|k|الف|\$?[0-9٠-٩۰-۹][0-9٠-٩۰-۹._]*(?:k|الف)?)$/;
function budgetClause(obj: readonly string[]): boolean {
  let i = obj.length - 1;
  while (i >= 0 && nounOf(obj[i]) !== 'BUDGET') i -= 1;
  if (i < 0) return false;
  const after = obj.slice(i + 1);
  return after.length > 0 && after.length <= 8 && after.every((w) => BUDGET_TAIL_WORD.test(w)) && after.some((w) => /[0-9٠-٩۰-۹]/.test(w));
}
/** The noun closing the object ("the <title> goal", "… staffing request", a budget clause). */
function tailNoun(obj: readonly string[]): ObjectNoun | null {
  if (budgetClause(obj)) return 'BUDGET';
  const last = obj[obj.length - 1];
  const n = nounOf(last);
  if (n !== null) return n;
  return REQUEST_WORD.test(last ?? '') && nounOf(obj[obj.length - 2]) === 'STAFFING' ? 'STAFFING' : null;
}
/** A decision stated as the command's closing modifier ("… with rework", "… as pass"); never read from inside the argument. */
function closingDecision(obj: readonly string[]): 'APPROVE' | 'REJECT' | null {
  const last = obj[obj.length - 1] ?? '';
  if (/^(?:ارفض|refuse|reject|deny|rework)$/.test(last)) return 'REJECT';
  if (/^(?:وافق|اعتمد|اقبل|approve|accept|grant|pass)$/.test(last)) return 'APPROVE';
  return null;
}

interface MutatingClass {
  readonly intent: MutatingIntent;
  readonly decision: 'APPROVE' | 'REJECT' | null;
}
/** The act a leading verb names, given the object's own head / closing noun; null when the verb names no act here. */
function actOf(family: VerbFamily, verb: string, obj: readonly string[]): MutatingClass | null {
  const head = headNoun(obj);
  const tail = obj.length > 1 ? tailNoun(obj) : null;
  // "goal <title>" and "the <title> goal" both name a goal: the title between them is only an argument.
  const noun: ObjectNoun | null = head === 'GOAL' || tail === 'GOAL' ? 'GOAL' : (head ?? tail);
  switch (family) {
    case 'APPROVE':
      if (noun === 'GOAL') return { intent: 'GOAL_APPROVE', decision: null };
      if (noun === 'BUDGET') return { intent: 'BUDGET_CEILING', decision: null };
      if (noun === 'STAFFING') return { intent: 'STAFFING_DECIDE', decision: 'APPROVE' };
      if (noun === 'CONFLICT') return { intent: 'CONFLICT_RESOLVE', decision: 'APPROVE' };
      return { intent: 'APPROVAL_DECIDE', decision: 'APPROVE' };
    case 'REJECT':
      if (noun === 'STAFFING') return { intent: 'STAFFING_DECIDE', decision: 'REJECT' };
      if (noun === 'CONFLICT') return { intent: 'CONFLICT_RESOLVE', decision: 'REJECT' };
      return { intent: 'APPROVAL_DECIDE', decision: 'REJECT' };
    case 'RESOLVE':
      return noun === 'CONFLICT' ? { intent: 'CONFLICT_RESOLVE', decision: closingDecision(obj) } : null;
    case 'GOAL_STATE':
      return noun === 'GOAL' ? { intent: 'GOAL_STATE', decision: null } : null;
    case 'PROPOSE':
      return noun === 'GOAL' ? { intent: 'GOAL_PROPOSE', decision: null } : null;
    case 'RUN':
      return head === 'BUDGET' || tail === 'BUDGET' ? { intent: 'BUDGET_CEILING', decision: null } : null;
    case 'DELEGATE':
      return { intent: 'DELEGATE_WORK', decision: null };
    case 'STAFFING':
      return { intent: 'STAFFING_DECIDE', decision: verb === 'hire' ? 'APPROVE' : closingDecision(obj) };
  }
}

/** A mutating command's argument: the object after the verb, without its connectives and (for a goal) the goal noun. */
function mutatingArgument(obj: readonly string[], intent: MutatingIntent, addressee: string | null): string | null {
  let words = [...obj];
  if (intent === 'GOAL_APPROVE' || intent === 'GOAL_STATE' || intent === 'GOAL_PROPOSE') {
    if (nounOf(words[0]) === 'GOAL') words = words.slice(1);
    if (words.length > 0 && nounOf(words[words.length - 1]) === 'GOAL') words = words.slice(0, -1);
    while (words.length > 0 && OBJECT_FILLER.test(words[0] ?? '')) words = words.slice(1);
  }
  if (intent === 'BUDGET_CEILING' && addressee !== null) words = [addressee, ...words];
  const rest = words.join(' ');
  return rest.length > 0 && rest.length <= 120 ? rest : null;
}

/** The command without its polite words and addressee; the addressee (a name) is kept separately. */
function commandCore(input: string): { readonly text: string; readonly addressee: string | null } {
  let raw = input.slice(0, COMMAND_MAX).normalize('NFC');
  let addressee: string | null = null;
  const comma = VOCATIVE_COMMA.exec(raw);
  if (comma?.[1] !== undefined && !LEAD_VERBS.has(normalize(comma[1]))) {
    addressee = normalize(comma[1]);
    raw = raw.slice(comma[0].length);
  }
  let text = normalize(raw);
  for (let i = 0; i < 4; i += 1) {
    const before = text;
    text = text.replace(POLITE_LEAD, '').replace(POLITE_TAIL, '');
    const ya = VOCATIVE_YA.exec(text);
    if (ya?.[1] !== undefined && addressee === null && !LEAD_VERBS.has(ya[1])) {
      addressee = ya[1];
      text = text.slice(ya[0].length);
    }
    if (text === before) break;
  }
  return { text: text.trim(), addressee: addressee !== null && addressee.length > 0 ? addressee : null };
}

const FILLERS = /^(?:علي|على|في|the|a|an|ال|لـ|ل|to|for|on)\s+/;

function argumentOf(normalized: string, intent: ReadIntent): string | null {
  let rest = normalized.replace(ARGUMENT_STRIP, '').trim();
  if (intent === 'WHO_WORKS_ON') {
    const m = /(?:علي|على|في|on)\s+(.+)$/.exec(rest);
    rest = m?.[1] ?? '';
  }
  if (intent === 'SHOW_GOAL') rest = rest.replace(FILLERS, '').replace(/^(?:هدف|goal)\s*/, '').replace(/\s*(?:هدف|goal)$/, '');
  if (intent === 'SHOW_DEPARTMENT') rest = rest.replace(/^(?:قسم|اداره|إدارة|department)\s*/, '');
  if (intent === 'SHOW_PILOT') rest = rest.replace(FILLERS, '').replace(/^(?:ال)?(?:تجربه|التجارب|pilots?)\s*/, '');
  if (intent === 'SHOW_REPORT') return /weekly|اسبوع/.test(rest) ? 'WEEKLY' : /monthly|شهر/.test(rest) ? 'MONTHLY' : 'DAILY';
  if (intent === 'SHOW_PERFORMANCE') rest = (/(?:performance|اداء)\s+(?:of\s+)?(.+)$/.exec(rest)?.[1] ?? /how\s+is\s+(.+?)\s+(?:doing|performing)/.exec(rest)?.[1] ?? '').trim();
  rest = rest.replace(FILLERS, '').trim();
  return rest.length > 0 && rest.length <= 120 ? rest : null;
}

/**
 * Classifies one Founder command. Deterministic and total: every input yields READ, MUTATING or UNKNOWN,
 * and the amount / decision fields are parsed from bounded grammar, never guessed.
 */
export function classifyFounderIntent(input: string): FounderIntent {
  if (typeof input !== 'string') return { kind: 'UNKNOWN' };
  const { text, addressee } = commandCore(input);
  if (text.length === 0) return { kind: 'UNKNOWN' };
  const words = text.split(' ');
  const verb = words[0] ?? '';
  const family = LEAD_VERBS.get(verb);
  if (family !== undefined) {
    // The command's own verb leads: it is an act of that verb's family, or nothing — never a read, never
    // another family's act picked out of the argument.
    const obj = words.slice(1);
    while (obj.length > 0 && OBJECT_FILLER.test(obj[0] ?? '')) obj.shift();
    const act = actOf(family, verb, obj);
    if (act === null) return { kind: 'UNKNOWN' };
    return { kind: 'MUTATING', intent: act.intent, argument: mutatingArgument(obj, act.intent, addressee), amount: amountOf(input), decision: act.decision, goalState: act.intent === 'GOAL_STATE' ? (GOAL_STATE_OF_VERB.get(verb) ?? null) : null };
  }
  for (const p of PATTERNS) {
    if (!p.re.test(text)) continue;
    const argument = argumentOf(text, p.intent);
    if (p.intent === 'OPEN_EMPLOYEE' && argument === null) return { kind: 'UNKNOWN' };
    return { kind: 'READ', intent: p.intent, argument: p.intent === 'RETURN_TO_LIVE' || p.intent === 'WHAT_IS_BLOCKED' || p.intent === 'NEEDS_MY_APPROVAL' || p.intent === 'SHOW_BRIEFS' || p.intent === 'SHOW_CEO' || p.intent === 'SHOW_TIMELINE' || p.intent === 'SHOW_PROVIDERS' || p.intent === 'SHOW_ACTIVATION' ? null : argument };
  }
  return { kind: 'UNKNOWN' };
}
