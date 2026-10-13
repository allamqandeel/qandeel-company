/**
 * P1-CONTEXT-INTEL-01 (D-P1-14, Founder decision G2) — the release-pinned Skill need table and the tier of a Skill for one
 * task. A Skill a task needs is TASK_REQUIRED (protected in Context Assembly, never planner-required: it never fails the
 * assembly), a Skill that helps is SUPPORTING (an ordinary candidate within the SKILL share), and any other declared Skill
 * is NON_RELEVANT (never a candidate, its instructions never read).
 *
 * Inputs are metadata only: the Skill code, the task's TS-1 signals (stored on the Work Item at creation) and its task
 * class. No terms, no instructions. A Skill the table does not declare keeps the legacy lexical path (`skillTier` → null).
 */
import { TASK_SIGNALS, type TaskSignal } from '@qandeel-company/governance';

export const SKILL_TIERS = ['TASK_REQUIRED', 'SUPPORTING', 'NON_RELEVANT'] as const;
export type SkillTier = (typeof SKILL_TIERS)[number];

/** Markers the table uses besides the TS-1 signals: every task (BASELINE) and a Founder conversation that is not a transformation. */
export type NeedSignal = TaskSignal | 'BASELINE' | 'FOUNDER_CONVERSATION';

export interface SkillNeed {
  readonly required: readonly NeedSignal[];
  readonly supporting: readonly NeedSignal[];
}

export const SKILL_NEED_TABLE_VERSION = 'SN-1';

/** Founder conversations: the task classes whose reply is a Founder communication. */
export const FOUNDER_CONVERSATION_TASK_CLASSES: readonly string[] = ['founder.reply'];

/**
 * The need table (Founder-approved G2). Declaration order is the intra-tier priority: governance boundaries first, then
 * the Founder channel, then judgment, evidence, organization and synthesis.
 */
export const SKILL_NEED_TABLE: Readonly<Record<string, SkillNeed>> = Object.freeze({
  'ceo.governance-discipline': { required: ['AUTHORITY'], supporting: ['BASELINE'] },
  'ceo.founder-partnership': { required: ['FOUNDER_CONVERSATION'], supporting: [] },
  'ceo.executive-judgment': {
    required: ['EXECUTIVE_DECISION', 'MULTI_DECISION', 'COMPARISON_OR_TRADEOFF', 'URGENT_OR_IRREVERSIBLE', 'FOUNDER_DECISION_PURPOSE', 'PRIORITIZATION'],
    supporting: ['STRATEGIC_PLANNING', 'ANALYSIS_DEPTH', 'UNCERTAIN_HIGH_CONSEQUENCE', 'UNCERTAIN_SUBSTANTIAL_REQUEST'],
  },
  'ceo.evidence-and-economics': {
    required: ['FINANCIAL_OR_LEGAL_STAKES', 'EVIDENCE', 'BUDGET_SUFFIXED'],
    supporting: ['ANALYSIS_DEPTH', 'MARKET_OR_EXPANSION_SCOPE', 'STRATEGIC_PLANNING', 'COMPARISON_OR_TRADEOFF'],
  },
  'ceo.organization-leadership': { required: ['ORGANIZATION_DESIGN', 'STAFFING_CONSEQUENCE', 'OWNERSHIP', 'ORG_ROLE'], supporting: ['STRATEGIC_PLANNING', 'CROSS_DEPARTMENT'] },
  'ceo.cross-functional-synthesis': { required: ['CROSS_DEPARTMENT', 'MARKET_DECISION'], supporting: ['MARKET_OR_EXPANSION_SCOPE', 'STRATEGIC_PLANNING', 'MULTI_PART_REQUEST', 'ANALYSIS_DEPTH'] },
});

const DECLARED = Object.keys(SKILL_NEED_TABLE);

/** The declared intra-tier priority of a Skill (0 = first), or null when the table does not declare it. */
export function skillNeedRank(code: string): number | null {
  const i = DECLARED.indexOf(code);
  return i < 0 ? null : i;
}

/** The tier of one Skill for one task, or null when the table does not declare the Skill (legacy lexical path). */
export function skillTier(code: string, signals: readonly TaskSignal[], taskClass: string): SkillTier | null {
  const need = Object.hasOwn(SKILL_NEED_TABLE, code) ? SKILL_NEED_TABLE[code] : undefined;
  if (need === undefined) return null;
  const has = new Set<NeedSignal>(signals.filter((s) => (TASK_SIGNALS as readonly string[]).includes(s)));
  has.add('BASELINE');
  if (FOUNDER_CONVERSATION_TASK_CLASSES.includes(taskClass) && !has.has('TRANSFORMATION_TASK')) has.add('FOUNDER_CONVERSATION');
  if (need.required.some((s) => has.has(s))) return 'TASK_REQUIRED';
  if (need.supporting.some((s) => has.has(s))) return 'SUPPORTING';
  return 'NON_RELEVANT';
}
