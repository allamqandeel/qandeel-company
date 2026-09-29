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
export const READ_INTENTS = ['OPEN_EMPLOYEE', 'SHOW_DEPARTMENT', 'SHOW_GOAL', 'WHO_WORKS_ON', 'WHAT_IS_BLOCKED', 'NEEDS_MY_APPROVAL', 'SHOW_BRIEFS', 'RETURN_TO_LIVE', 'SHOW_CEO', 'SHOW_TIMELINE', 'SHOW_REPORT', 'SHOW_PERFORMANCE'] as const;
export const MUTATING_INTENTS = ['APPROVAL_DECIDE', 'GOAL_APPROVE', 'GOAL_STATE', 'GOAL_PROPOSE', 'STAFFING_DECIDE', 'CONFLICT_RESOLVE', 'BUDGET_CEILING', 'DELEGATE_WORK'] as const;
export type ReadIntent = (typeof READ_INTENTS)[number];
export type MutatingIntent = (typeof MUTATING_INTENTS)[number];

export type FounderIntent =
  | { readonly kind: 'READ'; readonly intent: ReadIntent; readonly argument: string | null }
  | { readonly kind: 'MUTATING'; readonly intent: MutatingIntent; readonly argument: string | null; readonly amount: { readonly currency: string; readonly value: number } | null; readonly decision: 'APPROVE' | 'REJECT' | null }
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
  readonly intent: ReadIntent | MutatingIntent;
  readonly kind: 'READ' | 'MUTATING';
  readonly decision?: 'APPROVE' | 'REJECT';
}

// Order matters: the first match wins; mutating verbs are tested before generic "show" reads. A word ends
// at whitespace or the end of input (`\b` is ASCII-only and never sits between an Arabic letter and a space).
const W = String.raw`(?=\s|$)`;
const PATTERNS: readonly Pattern[] = [
  { re: /^(?:رجوع|ارجع|عوده|عد)(?:\s+(?:الي|ل))?\s*(?:الحي|المباشر|live)?$|^(?:return|back|go back)(?:\s+to)?\s*live$|^live$/, intent: 'RETURN_TO_LIVE', kind: 'READ' },
  { re: new RegExp(String.raw`(?:وافق|اعتمد|approve|accept|شغل|نفذ|run|launch|start|حدد|set)${W}.*(?:ميزانيه|budget|سقف|ceiling)`), intent: 'BUDGET_CEILING', kind: 'MUTATING' },
  { re: new RegExp(String.raw`(?:ارفض|refuse|reject|deny)${W}`), intent: 'APPROVAL_DECIDE', kind: 'MUTATING', decision: 'REJECT' },
  { re: new RegExp(String.raw`(?:وافق|اعتمد|اقبل|approve|accept|grant)${W}.*(?:هدف|goal)`), intent: 'GOAL_APPROVE', kind: 'MUTATING' },
  { re: new RegExp(String.raw`(?:وافق|اعتمد|اقبل|approve|accept|grant)${W}`), intent: 'APPROVAL_DECIDE', kind: 'MUTATING', decision: 'APPROVE' },
  { re: new RegExp(String.raw`(?:اقترح|انشئ|انشيء|add|create|propose)${W}.*(?:هدف|goal)`), intent: 'GOAL_PROPOSE', kind: 'MUTATING' },
  { re: new RegExp(String.raw`(?:اوقف|فعل|activate|pause|resume|achieve|cancel|الغ|الغي)${W}.*(?:هدف|goal)`), intent: 'GOAL_STATE', kind: 'MUTATING' },
  { re: new RegExp(String.raw`(?:فوض|delegate|assign)${W}`), intent: 'DELEGATE_WORK', kind: 'MUTATING' },
  { re: new RegExp(String.raw`(?:حل|resolve)${W}.*(?:تعارض|خلاف|conflict)`), intent: 'CONFLICT_RESOLVE', kind: 'MUTATING' },
  { re: new RegExp(String.raw`(?:توظيف|staffing|hire)${W}`), intent: 'STAFFING_DECIDE', kind: 'MUTATING' },
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
  { re: /(?:افتح|اعرض|اظهر|open|show)\s+(.+)/, intent: 'OPEN_EMPLOYEE', kind: 'READ' },
];

const ARGUMENT_STRIP = /^(?:افتح|اعرض|اظهر|عرض|show|open|approve|accept|reject|refuse|deny|وافق|اعتمد|اقبل|ارفض|delegate|فوض|فوّض|activate|pause|resume|cancel|فعل|اوقف|أوقف|الغ|الغي|propose|create|add|اقترح|انشئ|أنشئ)\s+/;
const FILLERS = /^(?:علي|على|في|the|a|an|ال|لـ|ل|to|for|on)\s+/;

function argumentOf(normalized: string, intent: ReadIntent | MutatingIntent): string | null {
  let rest = normalized.replace(ARGUMENT_STRIP, '').trim();
  if (intent === 'WHO_WORKS_ON') {
    const m = /(?:علي|على|في|on)\s+(.+)$/.exec(rest);
    rest = m?.[1] ?? '';
  }
  if (intent === 'SHOW_GOAL' || intent === 'GOAL_APPROVE' || intent === 'GOAL_STATE' || intent === 'GOAL_PROPOSE') rest = rest.replace(/^(?:هدف|goal)\s*/, '').replace(/\s*(?:هدف|goal)$/, '');
  if (intent === 'SHOW_DEPARTMENT') rest = rest.replace(/^(?:قسم|اداره|إدارة|department)\s*/, '');
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
  const text = normalize(input.slice(0, COMMAND_MAX));
  if (text.length === 0) return { kind: 'UNKNOWN' };
  for (const p of PATTERNS) {
    if (!p.re.test(text)) continue;
    const argument = argumentOf(text, p.intent);
    if (p.kind === 'READ') {
      if (p.intent === 'OPEN_EMPLOYEE' && argument === null) return { kind: 'UNKNOWN' };
      return { kind: 'READ', intent: p.intent as ReadIntent, argument: p.intent === 'RETURN_TO_LIVE' || p.intent === 'WHAT_IS_BLOCKED' || p.intent === 'NEEDS_MY_APPROVAL' || p.intent === 'SHOW_BRIEFS' || p.intent === 'SHOW_CEO' || p.intent === 'SHOW_TIMELINE' ? null : argument };
    }
    return { kind: 'MUTATING', intent: p.intent as MutatingIntent, argument, amount: amountOf(input), decision: p.decision ?? null };
  }
  return { kind: 'UNKNOWN' };
}
