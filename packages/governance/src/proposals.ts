/**
 * Typed model proposals (Stage 13 D13-D.1): the runtime owns the loop; the model proposes one
 * governed next action. Model output is untrusted data (D14-A.6): it is parsed into a closed set of
 * proposal types, and nothing a model writes can name a grant, approval, budget, credential or
 * risk level. A proposal is only data; executing it is the runtime's decision.
 */
import { boundedText, type JsonObject } from '@qandeel-company/domain';

import { isAttentionLevel, isFounderBrief, isMessagePurpose, type AttentionLevel, type FounderBrief, type MessagePurpose } from './founder.js';
import { isOrgAction, type OrgAction } from './organization.js';
import { isOutcomeVerdict, isReviewOutcome, type OutcomeJudgment, type ReviewOutcome } from './review.js';

export type ModelProposal =
  | { readonly type: 'FINAL'; readonly summaryCode: string }
  /**
   * C3: a structured memory CANDIDATE. It is only a proposal: the runtime-owned Memory Write Policy
   * decides whether and how it is stored. Provenance, data class, scope and status are never taken
   * from the model.
   */
  | {
      readonly type: 'MEMORY_CANDIDATE';
      readonly memoryClass: string;
      readonly topic: string;
      readonly claimKey: string | null;
      readonly claimValue: string | null;
      readonly content: string;
      readonly confidencePct: number;
    }
  /** C3: an observation about this Work Item's outcome — the first step of the learning path, never a lesson. */
  | { readonly type: 'OBSERVATION'; readonly topic: string; readonly content: string }
  | { readonly type: 'TOOL_REQUEST'; readonly tool: string; readonly action: string; readonly args: JsonObject }
  /**
   * C4: one organizational act from the closed set (a staffing request, the CEO's synthesis, a delegation,
   * a handoff response…). Only a proposal: the runtime checks the grant, the Position eligibility and the
   * act's own rules at the action boundary. The actor is the run's Employee, never a value in the output.
   */
  | { readonly type: 'ORG_ACTION'; readonly action: OrgAction; readonly args: JsonObject }
  /**
   * C4: a reviewer's decision, proposed from the reviewer's OWN review Work Item. The runtime binds it to that
   * assignment, re-checks eligibility and the subject's version, and never lets it approve anything.
   */
  | { readonly type: 'REVIEW_DECISION'; readonly outcome: ReviewOutcome; readonly reasonCode: string; readonly rationale: string | null; readonly evidenceRefs: readonly string[]; readonly outcomeJudgment?: OutcomeJudgment | null }
  /**
   * C5: a structured Founder-facing message (Stage 9): the Employee's reply in its own Founder thread, or a
   * CEO brief in the Founder Communication Standard. Only a proposal: the runtime binds it to the thread its
   * Work Item answers, re-checks the sender, and never lets a message decide, approve or grant anything
   * (Conversation ≠ Authority). The body is company content, never telemetry.
   */
  | { readonly type: 'MESSAGE'; readonly purpose: MessagePurpose; readonly attentionLevel: AttentionLevel; readonly body: string; readonly brief: FounderBrief | null; readonly contextRefs: readonly string[] }
  /** C5: a Director derives a Department goal or links its own work to a goal (fenced; seat and Department re-checked by the runtime). */
  | { readonly type: 'GOAL_ACTION'; readonly action: GoalAction; readonly args: JsonObject }
  /**
   * L1-02: the typed deliverable of an answer-bearing Work Item (an Academy attempt, a skill benchmark case, shadow
   * work): a bounded prose body plus a closed set of decision facets a deterministic rubric can check. Only data: the
   * runtime binds it to the run's own Work Item through the fence; it never decides, approves, scores or grants
   * anything (the model never evaluates itself — evaluators and the rubric do).
   */
  | ({ readonly type: 'ANSWER'; readonly body: string } & AnswerFacets)
  | { readonly type: 'INVALID'; readonly code: 'NOT_JSON' | 'UNKNOWN_TYPE' | 'MALFORMED' };

export const ANSWER_DECISIONS = ['PROCEED', 'PROCEED_WITH_CONDITIONS', 'GATHER_EVIDENCE', 'ESCALATE_TO_FOUNDER', 'DECLINE'] as const;
export type AnswerDecision = (typeof ANSWER_DECISIONS)[number];
/** Whether the recommended act is within authority the Employee actually holds (never a claim of new authority). */
export const ANSWER_AUTHORITY = ['WITHIN_HELD_AUTHORITY', 'NEEDS_FOUNDER', 'NOT_HELD'] as const;
export type AnswerAuthority = (typeof ANSWER_AUTHORITY)[number];
export const ANSWER_EVIDENCE = ['SUFFICIENT', 'PARTIAL', 'INSUFFICIENT'] as const;
export type AnswerEvidence = (typeof ANSWER_EVIDENCE)[number];
export const ANSWER_CONFIDENCE = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type AnswerConfidence = (typeof ANSWER_CONFIDENCE)[number];
/** Bound of an answer's prose (company content; never telemetry). */
export const ANSWER_BODY_MAX = 6_000;
/** Bound of the spend an answer may propose (micro-units). */
export const ANSWER_SPEND_MAX = 1_000_000_000_000;

/** The closed decision facets of an ANSWER (L1-02): what a deterministic rubric checks, never free text. */
export interface AnswerFacets {
  readonly decision: AnswerDecision;
  readonly reversible: boolean;
  readonly authority: AnswerAuthority;
  readonly evidence: AnswerEvidence;
  readonly confidence: AnswerConfidence;
  readonly founderDecisionNeeded: boolean;
  /** The spend the recommendation proposes now (micro-units, 0 when none). */
  readonly spendMicros: number;
}

const oneOf = <T extends string>(v: unknown, set: readonly T[]): v is T => typeof v === 'string' && (set as readonly string[]).includes(v);

/** The facets of a parsed / stored answer, or null when any is missing or malformed (closed shape). */
export function answerFacetsOf(o: Record<string, unknown>): AnswerFacets | null {
  if (!oneOf(o.decision, ANSWER_DECISIONS) || !oneOf(o.authority, ANSWER_AUTHORITY) || !oneOf(o.evidence, ANSWER_EVIDENCE) || !oneOf(o.confidence, ANSWER_CONFIDENCE)) return null;
  if (typeof o.reversible !== 'boolean' || typeof o.founderDecisionNeeded !== 'boolean') return null;
  if (typeof o.spendMicros !== 'number' || !Number.isSafeInteger(o.spendMicros) || o.spendMicros < 0 || o.spendMicros > ANSWER_SPEND_MAX) return null;
  return { decision: o.decision, reversible: o.reversible, authority: o.authority, evidence: o.evidence, confidence: o.confidence, founderDecisionNeeded: o.founderDecisionNeeded, spendMicros: o.spendMicros };
}

export const GOAL_ACTIONS = ['goal.derive', 'goal.link'] as const;
export type GoalAction = (typeof GOAL_ACTIONS)[number];
export const isGoalAction = (v: unknown): v is GoalAction => typeof v === 'string' && (GOAL_ACTIONS as readonly string[]).includes(v);

const CODE_SHAPE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,7}$/;
/**
 * A proposal code is a short machine code, bounded in length (R1 K4): an unbounded "code" could carry
 * free text into the run evidence, and an oversize one used to break the settle (retry loop).
 * Summary / tool / action codes ≤ 64; topic / claim codes ≤ 96 (the Memory key limit).
 */
const CODE = { test: (s: string): boolean => s.length <= 64 && CODE_SHAPE.test(s) };
const KEY = { test: (s: string): boolean => s.length <= 96 && CODE_SHAPE.test(s) };

export function parseProposal(outputText: string): ModelProposal {
  let raw: unknown;
  try {
    raw = JSON.parse(boundedText(outputText, 'output', 65_536, { allowEmpty: true }));
  } catch {
    return { type: 'INVALID', code: 'NOT_JSON' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { type: 'INVALID', code: 'MALFORMED' };
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(',');
  if (o.type === 'FINAL') {
    if (keys !== 'summaryCode,type' || typeof o.summaryCode !== 'string' || !CODE.test(o.summaryCode)) return { type: 'INVALID', code: 'MALFORMED' };
    return { type: 'FINAL', summaryCode: o.summaryCode };
  }
  if (o.type === 'TOOL_REQUEST') {
    if (keys !== 'action,args,tool,type' || typeof o.tool !== 'string' || !CODE.test(o.tool) || typeof o.action !== 'string' || !CODE.test(o.action)) return { type: 'INVALID', code: 'MALFORMED' };
    if (typeof o.args !== 'object' || o.args === null || Array.isArray(o.args)) return { type: 'INVALID', code: 'MALFORMED' };
    return { type: 'TOOL_REQUEST', tool: o.tool, action: o.action, args: o.args as JsonObject };
  }
  if (o.type === 'MEMORY_CANDIDATE') {
    const allowed = new Set(['type', 'memoryClass', 'topic', 'claimKey', 'claimValue', 'content', 'confidencePct']);
    if (Object.keys(o).some((k) => !allowed.has(k))) return { type: 'INVALID', code: 'MALFORMED' };
    if (typeof o.memoryClass !== 'string' || typeof o.topic !== 'string' || !KEY.test(o.topic) || typeof o.content !== 'string' || o.content.length === 0 || o.content.length > 2_000) return { type: 'INVALID', code: 'MALFORMED' };
    if (typeof o.confidencePct !== 'number' || !Number.isInteger(o.confidencePct) || o.confidencePct < 0 || o.confidencePct > 100) return { type: 'INVALID', code: 'MALFORMED' };
    const claimKey = o.claimKey === undefined || o.claimKey === null ? null : o.claimKey;
    const claimValue = o.claimValue === undefined || o.claimValue === null ? null : o.claimValue;
    if ((claimKey !== null && (typeof claimKey !== 'string' || !KEY.test(claimKey))) || (claimValue !== null && (typeof claimValue !== 'string' || !KEY.test(claimValue)))) return { type: 'INVALID', code: 'MALFORMED' };
    return { type: 'MEMORY_CANDIDATE', memoryClass: o.memoryClass, topic: o.topic, claimKey: claimKey as string | null, claimValue: claimValue as string | null, content: o.content, confidencePct: o.confidencePct };
  }
  if (o.type === 'OBSERVATION') {
    if (keys !== 'content,topic,type' || typeof o.topic !== 'string' || !KEY.test(o.topic) || typeof o.content !== 'string' || o.content.length === 0 || o.content.length > 2_000) return { type: 'INVALID', code: 'MALFORMED' };
    return { type: 'OBSERVATION', topic: o.topic, content: o.content };
  }
  if (o.type === 'ORG_ACTION') {
    if (keys !== 'action,args,type' || !isOrgAction(o.action)) return { type: 'INVALID', code: 'MALFORMED' };
    if (typeof o.args !== 'object' || o.args === null || Array.isArray(o.args)) return { type: 'INVALID', code: 'MALFORMED' };
    return { type: 'ORG_ACTION', action: o.action, args: o.args as JsonObject };
  }
  if (o.type === 'REVIEW_DECISION') {
    const allowed = new Set(['type', 'outcome', 'reasonCode', 'rationale', 'evidenceRefs', 'outcomeVerdict', 'outcomeEvidence']);
    if (Object.keys(o).some((k) => !allowed.has(k))) return { type: 'INVALID', code: 'MALFORMED' };
    if (!isReviewOutcome(o.outcome) || typeof o.reasonCode !== 'string' || !CODE.test(o.reasonCode)) return { type: 'INVALID', code: 'MALFORMED' };
    const rationale = o.rationale === undefined || o.rationale === null ? null : o.rationale;
    if (rationale !== null && (typeof rationale !== 'string' || rationale.length === 0 || rationale.length > 4_000)) return { type: 'INVALID', code: 'MALFORMED' };
    const refs = o.evidenceRefs === undefined ? [] : o.evidenceRefs;
    if (!Array.isArray(refs) || refs.length > 16 || refs.some((r) => typeof r !== 'string' || r.length === 0 || r.length > 128 || !/^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._:-]{1,95}$/.test(r))) return { type: 'INVALID', code: 'MALFORMED' };
    // C6: the reviewer's outcome judgment travels with the review decision (both fields or neither).
    if ((o.outcomeVerdict === undefined) !== (o.outcomeEvidence === undefined)) return { type: 'INVALID', code: 'MALFORMED' };
    let outcomeJudgment: OutcomeJudgment | null = null;
    if (o.outcomeVerdict !== undefined) {
      const classes = o.outcomeEvidence;
      if (!isOutcomeVerdict(o.outcomeVerdict) || !Array.isArray(classes) || classes.length === 0 || classes.length > 8 || classes.some((c) => typeof c !== 'string' || !/^[A-Z][A-Z_]{1,31}$/.test(c))) return { type: 'INVALID', code: 'MALFORMED' };
      outcomeJudgment = { verdict: o.outcomeVerdict, evidenceClasses: classes as string[] };
    }
    return { type: 'REVIEW_DECISION', outcome: o.outcome, reasonCode: o.reasonCode, rationale: rationale as string | null, evidenceRefs: refs as string[], outcomeJudgment };
  }
  if (o.type === 'MESSAGE') {
    const allowed = new Set(['type', 'purpose', 'attentionLevel', 'body', 'brief', 'contextRefs']);
    if (Object.keys(o).some((k) => !allowed.has(k))) return { type: 'INVALID', code: 'MALFORMED' };
    if (!isMessagePurpose(o.purpose) || !isAttentionLevel(o.attentionLevel)) return { type: 'INVALID', code: 'MALFORMED' };
    if (typeof o.body !== 'string' || o.body.trim().length === 0 || o.body.length > 4_000) return { type: 'INVALID', code: 'MALFORMED' };
    const brief = o.brief === undefined || o.brief === null ? null : o.brief;
    if ((o.purpose === 'BRIEF') !== (brief !== null)) return { type: 'INVALID', code: 'MALFORMED' };
    if (brief !== null && !isFounderBrief(brief)) return { type: 'INVALID', code: 'MALFORMED' };
    const refs = o.contextRefs === undefined ? [] : o.contextRefs;
    if (!Array.isArray(refs) || refs.length > 8 || refs.some((r) => typeof r !== 'string' || !/^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._:-]{1,95}$/.test(r))) return { type: 'INVALID', code: 'MALFORMED' };
    return { type: 'MESSAGE', purpose: o.purpose, attentionLevel: o.attentionLevel, body: o.body, brief: brief as FounderBrief | null, contextRefs: refs as string[] };
  }
  if (o.type === 'GOAL_ACTION') {
    if (keys !== 'action,args,type' || !isGoalAction(o.action)) return { type: 'INVALID', code: 'MALFORMED' };
    if (typeof o.args !== 'object' || o.args === null || Array.isArray(o.args)) return { type: 'INVALID', code: 'MALFORMED' };
    return { type: 'GOAL_ACTION', action: o.action, args: o.args as JsonObject };
  }
  if (o.type === 'ANSWER') {
    if (keys !== 'authority,body,confidence,decision,evidence,founderDecisionNeeded,reversible,spendMicros,type') return { type: 'INVALID', code: 'MALFORMED' };
    if (typeof o.body !== 'string' || o.body.trim().length === 0 || o.body.length > ANSWER_BODY_MAX) return { type: 'INVALID', code: 'MALFORMED' };
    const facets = answerFacetsOf(o);
    if (facets === null) return { type: 'INVALID', code: 'MALFORMED' };
    return { type: 'ANSWER', body: o.body, ...facets };
  }
  return { type: 'INVALID', code: 'UNKNOWN_TYPE' };
}
