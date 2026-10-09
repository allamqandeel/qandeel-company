/**
 * P1-REASON-AUTO-RECOVERY-01 — Reasoning Demand (policy RD-1): the deterministic AUTO selector of a Work Item's
 * starting reasoning class (Stage 13 D13-C.1: "start at the minimum SUFFICIENT qualified reasoning level, not
 * mechanically at the cheapest tier"; D13-A.4: routing is a deterministic policy engine, not another LLM).
 *
 * AUTO is a selection policy over the existing classes E1..E4, never a fifth level. It never calls a model: it reads
 * the request the Work Item was created for and returns an IDEAL class with content-free reason codes, a consequence
 * tier and a policy confidence. The runtime then bounds that ideal by the Employee ceiling, the route policy and the
 * classes actually provisioned (`resolveAutoClass`) and records both, so a constrained choice is never shown as the
 * unconstrained ideal. Nothing here grants authority, money or a class: routing, the reservation and the ceilings
 * still decide.
 *
 * Two axes, deliberately not length or keywords alone:
 * - COMPLEXITY — strategic planning, comparison / trade-off, analysis depth, organization design, several interacting
 *   decisions, a multi-part request (structure: questions and enumerated items).
 * - CONSEQUENCE — financial / legal stakes, market or expansion scope, staffing, urgency / irreversibility, an
 *   executive decision, a Founder decision purpose or attention level.
 * The lexical cues are bilingual (English, Modern Standard Arabic and Egyptian colloquial), normalized (NFKC, case,
 * Arabic diacritics and letter variants) and only count when the message actually asks for work (a request, a question
 * or a decision): a statement that merely mentions "strategy" is an acknowledgement, and a transformation request
 * (translate, rewrite, summarize) is bounded however much content it carries. Length is never a level by itself.
 *
 * Uncertainty policy (documented, deterministic): confidence is POLICY uncertainty, not a calibrated probability that
 * an answer will be correct. UNCERTAIN + HIGH consequence → at least E3 ("prefer an appropriately stronger available
 * level"); UNCERTAIN + low consequence keeps the economical level, except a substantial unclear request (more than 60
 * words with no signal) which starts at E2. Nothing raises a class to E4 on uncertainty alone.
 *
 * Limits (stated, not hidden): a lexical-structural policy cannot read intent it is not shown; it can under- or
 * over-estimate an unforeseen task. Evidence-based escalation (D13-C.3) and the Founder's manual level remain the
 * correction paths, and the expectation set in the tests measures the policy, never guarantees it.
 */
import { REASONING_CLASSES, reasoningRank, type ReasoningClass } from './classes.js';

export const REASONING_DEMAND_POLICY = 'RD-1';

export const DEMAND_REASONS = [
  'ROUTINE_ACKNOWLEDGEMENT',
  'INFORMATIONAL_NOTE',
  'SIMPLE_QUESTION',
  'TRANSFORMATION_TASK',
  'ANALYSIS_DEPTH',
  'COMPARISON_OR_TRADEOFF',
  'STRATEGIC_PLANNING',
  'ORGANIZATION_DESIGN',
  'MULTI_DECISION',
  'MULTI_PART_REQUEST',
  'FINANCIAL_OR_LEGAL_STAKES',
  'MARKET_OR_EXPANSION_SCOPE',
  'STAFFING_CONSEQUENCE',
  'URGENT_OR_IRREVERSIBLE',
  'EXECUTIVE_DECISION',
  'FOUNDER_DECISION_PURPOSE',
  'NO_STRONG_SIGNAL',
  'UNCERTAIN_HIGH_CONSEQUENCE',
  'UNCERTAIN_SUBSTANTIAL_REQUEST',
] as const;
export type DemandReason = (typeof DEMAND_REASONS)[number];

export type ModelClass = Exclude<ReasoningClass, 'E0'>;
export const MODEL_CLASSES: readonly ModelClass[] = ['E1', 'E2', 'E3', 'E4'];
export const isModelClass = (v: unknown): v is ModelClass => typeof v === 'string' && (MODEL_CLASSES as readonly string[]).includes(v);

export interface ReasoningDemand {
  readonly policy: typeof REASONING_DEMAND_POLICY;
  /** The lowest class the policy judges sufficient, before any ceiling, route or provisioning bound. */
  readonly level: ModelClass;
  readonly complexity: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
  readonly consequence: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
  readonly confidence: 'CLEAR' | 'UNCERTAIN';
  readonly reasons: readonly DemandReason[];
}

export interface DemandInput {
  readonly text: string;
  /** The message purpose (Stage 9), when the request is a Founder message. */
  readonly purpose?: string | null;
  /** The Founder attention level, when stated. */
  readonly attentionLevel?: string | null;
  /** The Employee answers for the Company (the CEO seat): a decision it is asked for is an executive decision. */
  readonly executive?: boolean;
}

/** NFKC, lower case, Arabic diacritics / tatweel removed and letter variants unified; punctuation (but ? and ؟) → space. */
export function normalizeDemandText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}?؟$\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ARABIC = /[؀-ۿ]/;
/**
 * A cue matcher: English cues match at a word start (prefix stems allowed unless `exact`, so a request verb never matches
 * its past tense: "reviewed" is a report, not a request); Arabic cues allow the common clitics.
 */
function cues(list: readonly string[], exact = false): (t: string) => number {
  const res = list.map((raw) => {
    const c = normalizeDemandText(raw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return ARABIC.test(raw) ? new RegExp(`(?:^|\\s)(?:[وفبلك]?(?:ال)?|لل)${c}`, 'u') : raw === '$' ? /\$/u : new RegExp(`(?:^|[^\\p{L}\\p{N}])${c}${exact ? '(?![\\p{L}\\p{N}])' : ''}`, 'u');
  });
  return (t: string) => res.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);
}

const ROUTINE = cues(['thanks', 'thank you', 'thx', 'ok', 'okay', 'noted', 'got it', 'sounds good', 'perfect', 'good morning', 'good night', 'hello', 'hi ', 'hey', 'cheers', 'شكرا', 'متشكر', 'تمام', 'اوكي', 'ماشي', 'تسلم', 'صباح الخير', 'مساء الخير', 'السلام عليكم', 'اهلا', 'مرحبا', 'وصلت', 'جميل'], true);
const INFO = cues(['fyi', 'for your information', 'just so you know', 'reminder', 'rescheduled', 'moved to', 'has moved', 'i sent', 'i finished', 'i have sent', 'للعلم', 'للعلم فقط', 'تذكير', 'اتنقل', 'اتاجل', 'تاجل', 'خلصت', 'بعتلك', 'اتعمل']);
const REQUEST = cues(['please', 'can you', 'could you', 'would you', 'i need', 'i want', 'we need', 'prepare', 'draft', 'write', 'give me', 'tell me', 'send me', 'propose', 'recommend', 'suggest', 'help', 'explain', 'analyze', 'analyse', 'evaluate', 'review', 'decide', 'build', 'create', 'what do you think', 'من فضلك', 'لو سمحت', 'ممكن', 'عايز', 'عاوز', 'عايزك', 'محتاج', 'اريد', 'اعمل', 'جهز', 'حضر', 'اكتب', 'قولي', 'ابعت', 'اقترح', 'رشح', 'اشرح', 'حلل', 'قيم', 'راجع', 'قرر', 'خطط', 'صمم', 'اعطني', 'رايك'], true);
const SIMPLE = cues(['what time', 'when is', 'when are', 'when will', 'where is', 'who is', 'how many', 'how much is', 'what is the', 'what s the', 'status of', 'did you', 'have you', 'is it', 'امتي', 'فين', 'مين', 'كام', 'الساعه كام', 'هل خلصت', 'هل وصلت', 'هو فين']);
const SIMPLE_START = /^(?:is|are|did|does|has|have|was|were|will|can i|هل)\s/u;
const TRANSFORM = cues(['translate', 'rewrite', 'rephrase', 'proofread', 'reformat', 'format this', 'summarize', 'summarise', 'shorten', 'fix the grammar', 'ترجم', 'اعد صياغه', 'تعيد صياغه', 'صياغه', 'صيغ', 'لخص', 'اختصر', 'نسق', 'صحح']);
const ANALYSIS = cues(['analy', 'evaluat', 'assess', 'why ', 'root cause', 'implication', 'impact', 'scenario', 'forecast', 'diagnos', 'consequence', 'deep dive', 'حلل', 'تحليل', 'قيم', 'تقييم', 'ليه', 'لماذا', 'السبب', 'اسباب', 'الاثر', 'التاثير', 'تاثير', 'سيناريو', 'توقع', 'تشخيص', 'عواقب', 'تبعات']);
const COMPARISON = cues(['compare', 'comparison', 'versus', ' vs ', 'trade off', 'tradeoff', 'pros and cons', 'which is better', 'which one', 'options', 'alternative', 'rather than', 'instead of', 'prioriti', 'قارن', 'مقارنه', 'مقابل', 'ولا ', 'افضل', 'احسن', 'البدائل', 'بديل', 'خيارات', 'مميزات وعيوب', 'الايجابيات والسلبيات', 'اولويه', 'الاولويات']);
const STRATEGY = cues(['strateg', 'roadmap', 'vision', 'long term', 'expansion', 'expand', 'go to market', 'market entry', 'positioning', 'competitive', 'competitor', 'growth plan', 'business model', 'master plan', 'five year', 'three year', 'استراتيج', 'خارطه الطريق', 'خريطه الطريق', 'رويه', 'التوسع', 'توسع', 'نتوسع', 'المنافس', 'نموذج العمل', 'خطه', 'المدي الطويل', 'النمو']);
const ENTRY = cues(['enter', 'entry', 'entering', 'ندخل', 'دخول']);
const ORGANIZATION = cues(['hire', 'hiring', 'recruit', 'team structure', 'org structure', 'organization', 'organisation', 'department head', 'heads of department', 'restructur', 'roles and responsibilities', 'appoint', 'staffing', 'team lead', 'تعيين', 'توظيف', 'فرق العمل', 'فريق العمل', 'رؤساء الاقسام', 'روساء الاقسام', 'رييس قسم', 'الهيكل', 'هيكل تنظيمي', 'الادوار', 'المسووليات', 'نعين', 'نوظف']);
const DECISION = cues(['decide', 'decision', 'should we', 'should i', 'approve', 'approval', 'choose', 'select ', 'pick ', 'recommend', 'go no go', 'final call', 'commit to', 'what do you think', 'نقرر', 'قرار', 'هل نبدا', 'نختار', 'اختيار', 'اختار', 'رشح', 'نرشح', 'nominate', 'نوافق', 'موافقه', 'توصي', 'توصيه', 'رايك', 'نعتمد', 'نلتزم'], true);
const FINANCE = cues(['budget', 'invest', 'funding', 'valuation', 'pricing', 'price', 'revenue', 'cost', 'profit', 'margin', 'cash', 'burn', 'million', '$', 'usd', 'egp', 'legal', 'contract', 'lawsuit', 'compliance', 'regulat', 'license', 'liability', 'equity', 'shares', 'acquisition', 'merger', 'partnership', 'ميزانيه', 'استثمار', 'تمويل', 'تسعير', 'السعر', 'الاسعار', 'ايرادات', 'تكلفه', 'تكاليف', 'ربح', 'ارباح', 'هامش', 'كاش', 'مليون', 'دولار', 'جنيه', 'ريال', 'قانوني', 'عقد', 'عقود', 'امتثال', 'ترخيص', 'رخصه', 'شراكه', 'استحواذ', 'حصص', 'deal', 'صفقه']);
const MARKET = cues(['market', 'regional', 'global', 'international', 'countries', 'gcc', 'gulf', 'mena', 'saudi', 'ksa', 'uae', 'egypt', 'europe', 'launch', 'rollout', 'roll out', 'السوق', 'اسواق', 'الاسواق', 'اقليمي', 'عالمي', 'دولي', 'الخليج', 'السعوديه', 'الامارات', 'مصر', 'الشرق الاوسط', 'اطلاق', 'نطلق', 'اوروبا', 'امريكا']);
const URGENT = cues(['urgent', 'asap', 'immediately', 'critical', 'irreversible', 'final decision', 'deadline', 'cannot be undone', 'point of no return', 'عاجل', 'ضروري', 'فورا', 'حالا', 'حاسم', 'نهايي', 'لا رجعه', 'مصيري']);

const DECISION_PURPOSES: ReadonlySet<string> = new Set(['DECISION_REQUEST', 'ESCALATION', 'BLOCKER']);
const DECISION_ATTENTION: ReadonlySet<string> = new Set(['NEEDS_DECISION', 'URGENT']);
const TIERS = ['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'] as const;

/** The deterministic Reasoning Demand of one request (RD-1). Pure: the same input always gives the same demand. */
export function assessReasoningDemand(input: DemandInput): ReasoningDemand {
  const raw = typeof input.text === 'string' ? input.text : '';
  const full = normalizeDemandText(raw);
  const words = full === '' ? 0 : full.split(' ').length;
  // A transformation request (translate, rewrite, summarize) is scored on its own instruction, never on the content it
  // carries after a colon, a line break, a quote or its question: that content is material to transform, not the task.
  const end = raw.search(/[:：\n"“«]|[?؟]\s*\S/u);
  const head = end > 0 ? raw.slice(0, end + 1) : raw;
  const transform = TRANSFORM(normalizeDemandText(head)) > 0;
  const scope = transform ? head : raw;
  const t = transform ? normalizeDemandText(head) : full;
  const questions = (scope.match(/[?؟]/g) ?? []).length;
  const enumerated = (scope.match(/(?:^|\n)\s*(?:\d{1,2}\s*[.)\-:]|[-*•]|اولا|ثانيا|ثالثا|رابعا)\s*\S/gu) ?? []).length;
  const reasons = new Set<DemandReason>();
  const note = (points: number, reason: DemandReason): number => {
    reasons.add(reason);
    return points;
  };
  const decisions = DECISION(t);
  const asks = REQUEST(t) > 0 || questions > 0 || decisions > 0 || input.purpose === 'DECISION_REQUEST' || input.purpose === 'REQUEST';
  const routine = ROUTINE(full) > 0 || INFO(full) > 0;

  // Complexity.
  let c = 0;
  const strategic = STRATEGY(t) > 0 || (ENTRY(t) > 0 && MARKET(t) > 0);
  if (strategic) c += note(2, 'STRATEGIC_PLANNING');
  if (ANALYSIS(t) > 0) c += note(1, 'ANALYSIS_DEPTH');
  if (COMPARISON(t) > 0) c += note(1, 'COMPARISON_OR_TRADEOFF');
  const org = ORGANIZATION(t) > 0;
  if (org) c += note(1, 'ORGANIZATION_DESIGN');
  if (decisions >= 2 || (decisions >= 1 && (questions >= 2 || enumerated >= 2))) c += note(1, 'MULTI_DECISION');
  if (enumerated >= 3 || questions >= 3) c += note(1, 'MULTI_PART_REQUEST');

  // Consequence.
  let k = 0;
  if (FINANCE(t) > 0) k += note(1, 'FINANCIAL_OR_LEGAL_STAKES');
  if (MARKET(t) > 0) k += note(1, 'MARKET_OR_EXPANSION_SCOPE');
  if (org) k += note(1, 'STAFFING_CONSEQUENCE');
  if (URGENT(t) > 0) k += note(1, 'URGENT_OR_IRREVERSIBLE');
  if (decisions > 0 && input.executive === true) k += note(1, 'EXECUTIVE_DECISION');
  if ((input.purpose && DECISION_PURPOSES.has(input.purpose)) || (input.attentionLevel && DECISION_ATTENTION.has(input.attentionLevel))) k += note(1, 'FOUNDER_DECISION_PURPOSE');

  let cTier = c === 0 ? 0 : c <= 2 ? 1 : c <= 4 ? 2 : 3;
  let kTier = k === 0 ? 0 : k === 1 ? 1 : k <= 3 ? 2 : 3;
  const demand = (level: ModelClass, confidence: ReasoningDemand['confidence'], extra: DemandReason[] = []): ReasoningDemand => {
    for (const r of extra) reasons.add(r);
    return Object.freeze({ policy: REASONING_DEMAND_POLICY, level, complexity: TIERS[cTier] ?? 'LOW', consequence: TIERS[kTier] ?? 'LOW', confidence, reasons: Object.freeze(DEMAND_REASONS.filter((r) => reasons.has(r))) });
  };

  // A message that asks for nothing: an acknowledgement or a note. It is answered economically, whatever it mentions.
  if (!asks) {
    if (routine || words === 0) return demand('E1', 'CLEAR', [ROUTINE(full) > 0 && INFO(full) === 0 ? 'ROUTINE_ACKNOWLEDGEMENT' : 'INFORMATIONAL_NOTE']);
    return demand(cTier >= 2 || kTier >= 2 ? 'E2' : 'E1', cTier >= 2 || kTier >= 2 ? 'UNCERTAIN' : 'CLEAR', ['INFORMATIONAL_NOTE']);
  }
  // A transformation of given content is bounded (at most E2), unless its own instruction also asks for a decision, an
  // analysis or a strategy.
  if (transform && decisions === 0 && !reasons.has('ANALYSIS_DEPTH') && !strategic) {
    cTier = Math.min(cTier, 1);
    kTier = Math.min(kTier, 1);
    reasons.add('TRANSFORMATION_TASK');
  }
  // A simple factual / status question with no complexity of its own: E1, or E2 when real stakes are named.
  const simple = SIMPLE(t) > 0 || SIMPLE_START.test(t);
  if (simple && c === 0) return demand(kTier >= 2 ? 'E2' : 'E1', 'CLEAR', ['SIMPLE_QUESTION']);

  const top = Math.max(cTier, kTier);
  // E4 needs real breadth on both axes (a very high one with the other high, or eight signals in all); high on both is E3.
  let level: ModelClass = (cTier === 3 && kTier >= 1) || (kTier === 3 && cTier >= 2) || c + k >= 8 ? 'E4' : top >= 2 ? 'E3' : top === 1 ? 'E2' : 'E1';
  // The uncertainty policy.
  let confidence: ReasoningDemand['confidence'] = 'CLEAR';
  if (cTier === 0 && kTier >= 2) {
    // High stakes, complexity unclear: an appropriately stronger level, never E4 on uncertainty alone.
    confidence = 'UNCERTAIN';
    if (reasoningRank(level) < reasoningRank('E3')) level = 'E3';
    reasons.add('UNCERTAIN_HIGH_CONSEQUENCE');
  } else if (c === 0 && k === 0) {
    if ((transform ? t.split(' ').length : words) > 60 && !routine) {
      confidence = 'UNCERTAIN';
      level = 'E2';
      reasons.add('UNCERTAIN_SUBSTANTIAL_REQUEST');
    } else reasons.add(routine ? 'ROUTINE_ACKNOWLEDGEMENT' : 'NO_STRONG_SIGNAL');
  }
  return demand(level, confidence);
}

/** A stored demand read back from a Work Item's input (closed shape; anything else is treated as absent). */
export function isReasoningDemand(v: unknown): v is ReasoningDemand {
  const d = v as Partial<ReasoningDemand> | null;
  return (
    typeof d === 'object' && d !== null && d.policy === REASONING_DEMAND_POLICY && isModelClass(d.level) &&
    (TIERS as readonly unknown[]).includes(d.complexity) && (TIERS as readonly unknown[]).includes(d.consequence) &&
    (d.confidence === 'CLEAR' || d.confidence === 'UNCERTAIN') && Array.isArray(d.reasons) && d.reasons.length <= DEMAND_REASONS.length &&
    d.reasons.every((r) => (DEMAND_REASONS as readonly unknown[]).includes(r))
  );
}

/** Why the class AUTO runs at is below its ideal (null = it runs at the ideal). */
export type AutoConstraint = 'EMPLOYEE_CEILING' | 'ROUTE_POLICY' | 'NOT_PROVISIONED';

export interface AutoResolution {
  readonly selected: ModelClass;
  readonly ideal: ModelClass;
  readonly constraint: AutoConstraint | null;
}

/**
 * Bounds an AUTO ideal by the Employee ceiling, the route policy and the classes with a provisioned, eligible deployment
 * now. The result is the highest permitted class at or below the ideal (never above it); a constrained result names its
 * constraint so the surface never presents it as the ideal. The route policy minimum still lifts (minimum sufficient).
 */
export function resolveAutoClass(ideal: ModelClass, bounds: { readonly ceiling: ReasoningClass; readonly policyMin: ReasoningClass; readonly policyMax: ReasoningClass; readonly available: readonly ReasoningClass[] }): AutoResolution {
  const rank = reasoningRank;
  const allowedMax = rank(bounds.ceiling) <= rank(bounds.policyMax) ? bounds.ceiling : bounds.policyMax;
  let constraint: AutoConstraint | null = null;
  let target: ReasoningClass = ideal;
  if (rank(ideal) > rank(allowedMax)) {
    target = allowedMax;
    constraint = rank(bounds.ceiling) <= rank(bounds.policyMax) ? 'EMPLOYEE_CEILING' : 'ROUTE_POLICY';
  }
  if (rank(target) < rank(bounds.policyMin)) target = bounds.policyMin;
  const avail = new Set(bounds.available);
  if (!avail.has(target)) {
    const lower = REASONING_CLASSES.filter((x) => x !== 'E0' && avail.has(x) && rank(x) < rank(target) && rank(x) >= rank(bounds.policyMin)).at(-1);
    if (lower !== undefined) return { selected: lower as ModelClass, ideal, constraint: 'NOT_PROVISIONED' };
  }
  return { selected: (target === 'E0' ? 'E1' : target) as ModelClass, ideal, constraint };
}

/**
 * The per-class output allowance of a call (B1): `max_tokens` bounds thinking + answer on a thinking model, so a deeper
 * class gets a larger allowance. Chosen against the deployment limits (E1 4,096 · E2 16,384 · E3 32,768 · E4 65,536) and
 * the live evidence: an E1 MESSAGE used 804 tokens; an E2 escalation exhausted 1,024. E1 2,048 holds the longest legal
 * MESSAGE body (4,000 characters) with its envelope at no thinking; E2 4,096 / E3 8,192 / E4 16,384 leave the thinking
 * room each effort needs. The worst case of the actual allowance is reserved before every call.
 */
export const OUTPUT_ALLOWANCE_BY_CLASS: Readonly<Record<ModelClass, number>> = Object.freeze({ E1: 2_048, E2: 4_096, E3: 8_192, E4: 16_384 });

/** The hard ceiling of a same-class continuation after output exhaustion (never above the deployment's own maximum). */
export const OUTPUT_CONTINUATION_MAX_TOKENS = 32_768;

/**
 * The allowance of the one same-class continuation after an exhausted output: double the exhausted allowance, bounded
 * by the deployment maximum and the continuation ceiling. Null when it would not be larger (no continuation helps).
 */
export function continuationAllowance(exhausted: number, deploymentMax: number): number | null {
  const next = Math.min(exhausted * 2, deploymentMax, OUTPUT_CONTINUATION_MAX_TOKENS);
  return next > exhausted ? next : null;
}
