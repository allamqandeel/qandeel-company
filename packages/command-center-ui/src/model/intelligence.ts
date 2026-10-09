/**
 * P1-CHAT-INTEL-01 — the Founder-facing vocabulary of Employee Intelligence and of a conversation reply's state. Pure
 * functions over the server's read models (codes and numbers only): no DOM, no request, nothing decided here.
 */
type Json = Record<string, unknown>;

export const LEVELS = ['E1', 'E2', 'E3', 'E4'] as const;
export type Level = (typeof LEVELS)[number];
export const isLevel = (v: unknown): v is Level => typeof v === 'string' && (LEVELS as readonly string[]).includes(v);

/** The thinking each level asks of DeepSeek V4.1 Flash (the adapter's fixed mapping: off, low, high, max). */
export const LEVEL_THINKING: Readonly<Record<Level, string>> = { E1: 'Thinking off', E2: 'Thinking low', E3: 'Thinking high', E4: 'Thinking max' };
export const LEVEL_SHORT: Readonly<Record<Level, string>> = { E1: 'Fast', E2: 'Low', E3: 'High', E4: 'Max' };

/** A level's availability in a few words (the full reason is in its title). */
export const LEVEL_STATE_LABEL: Readonly<Record<string, string>> = { AVAILABLE: 'Available', ABOVE_EMPLOYEE_CEILING: 'Above maximum', ABOVE_ROUTE_POLICY: 'Route limit', NOT_PROVISIONED: 'Not provisioned', NO_ROUTE_POLICY: 'No route' };

export const REPLY_LABEL: Readonly<Record<string, string>> = {
  QUEUED: 'Queued',
  RUNNING: 'Writing a reply',
  WAITING_FOR_BUDGET: 'Waiting for budget',
  WAITING: 'Waiting',
  BLOCKED: 'Blocked',
  FAILED: 'No reply — failed',
  CANCELLED: 'Cancelled',
  REPLIED: 'Replied',
};

/** The canonical reason codes the Founder meets on a reply or a level, in plain words. */
export const REASON_LABEL: Readonly<Record<string, string>> = {
  BUDGET_EXHAUSTED: 'the budget has no headroom for this reply; it resumes only when the budget allows, never by spending more on its own',
  RETRIES_EXHAUSTED: 'it failed repeatedly and was set aside; it is not retried automatically',
  MODEL_OUTPUT_INVALID: 'the model did not produce a usable reply twice',
  MODEL_ACCESS_DENIED: 'this Employee has no model access for conversation',
  EMPLOYEE_CONTAINED: 'this Employee is contained',
  RUN_LIMIT: 'the reply reached its bound on model calls',
  MAX_TURNS: 'the reply reached its bound on steps',
  PROVIDER_FAILURE: 'the model provider failed',
  COMPLETED_WITHOUT_REPLY: 'the run ended without recording a message',
  RECONCILIATION_HOLD: 'a provider call has an uncertain outcome and waits for your reconciliation',
  RETRY_SCHEDULED: 'a transient failure; one bounded retry is scheduled',
  ABOVE_EMPLOYEE_CEILING: 'above this Employee’s maximum level',
  ABOVE_ROUTE_POLICY: 'above the level the conversation route allows',
  NOT_PROVISIONED: 'not provisioned for conversation yet',
  NO_ROUTE_POLICY: 'no conversation route is provisioned',
  REASONING_CLASS: 'not a reasoning level',
  EMPLOYEE_NOT_ELIGIBLE: 'only an ACTIVE Employee can be asked for a reply',
  BUDGET_MISSING: 'this Employee has no budget envelope to answer from',
  // P1-REASON-AUTO-RECOVERY-01
  MODEL_OUTPUT_TRUNCATED: 'the reply ran out of its output allowance twice (also after one larger same-level try), so no incomplete reply was accepted',
  OUTPUT_TRUNCATED: 'the output allowance ran out before the reply was complete',
  PROVIDER_CIRCUIT_OPEN: 'the model provider is paused after repeated failures; the reply waits for it and spends nothing meanwhile',
  REASONING_LEVEL_UNAVAILABLE: 'the level you chose has no model deployment now; it was not replaced by another level',
  EMPLOYEE_CEILING: 'held at this Employee’s maximum level',
  ROUTE_POLICY: 'held by the conversation route’s maximum level',
};

export const reasonText = (code: string | null | undefined, humanize: (c: string) => string): string => (code ? (REASON_LABEL[code] ?? humanize(code).toLowerCase()) : '');

/** The public model name as a person reads it ("DeepSeek-V4.1-Flash" → "DeepSeek V4.1 Flash"). */
export function modelLabel(intel: Json | null | undefined): string {
  const m = intel?.model as Json | null | undefined;
  if (!m) return 'No model provisioned';
  const name = typeof m.publicName === 'string' && m.publicName ? m.publicName : String(m.modelCode);
  return name.replace(/-/g, ' ');
}

/** One level's availability for conversation (from the server's intelligence read). */
export function levelState(intel: Json | null | undefined, level: Level): { available: boolean; code: string } {
  const row = ((intel?.levels as Json[] | undefined) ?? []).find((l) => l.reasoningClass === level);
  const code = row ? String(row.availability) : 'NO_ROUTE_POLICY';
  return { available: code === 'AVAILABLE', code };
}

/** Whether a reply's state is ended work (never shown as "thinking"; never retried from the surface). */
export const isEndedReply = (status: string): boolean => status === 'FAILED' || status === 'BLOCKED' || status === 'CANCELLED' || status === 'REPLIED';

/**
 * P1-REASON-AUTO-RECOVERY-01 — how a reply's level was chosen, in the Founder's words. AUTO is a selection policy over E1..E4,
 * never a fifth level; E1 on DeepSeek V4.1 Flash is thinking OFF (a light model call, not "no AI").
 */
export const AUTO_EXPLAINED = 'AUTO picks, for each message, the lowest level the governed policy judges sufficient (routine → E1, analysis → E2, strategy → E3, very broad high-stakes work → E4), within the maximum, the route and what is provisioned. It is not a fifth level, it makes no extra model call to decide, and a level you choose for a message always wins.';

/** The content-free AUTO reason codes, in a few words each. */
export const DEMAND_REASON_LABEL: Readonly<Record<string, string>> = {
  ROUTINE_ACKNOWLEDGEMENT: 'routine', INFORMATIONAL_NOTE: 'a note', SIMPLE_QUESTION: 'a simple question', TRANSFORMATION_TASK: 'rewording given text',
  ANALYSIS_DEPTH: 'analysis', COMPARISON_OR_TRADEOFF: 'comparing options', STRATEGIC_PLANNING: 'strategy', ORGANIZATION_DESIGN: 'organization design',
  MULTI_DECISION: 'several decisions', MULTI_PART_REQUEST: 'a multi-part request', FINANCIAL_OR_LEGAL_STAKES: 'money or legal stakes',
  MARKET_OR_EXPANSION_SCOPE: 'market scope', STAFFING_CONSEQUENCE: 'staffing', URGENT_OR_IRREVERSIBLE: 'urgent or irreversible',
  EXECUTIVE_DECISION: 'an executive decision', FOUNDER_DECISION_PURPOSE: 'your decision is needed', NO_STRONG_SIGNAL: 'no strong signal',
  UNCERTAIN_HIGH_CONSEQUENCE: 'unclear but high stakes', UNCERTAIN_SUBSTANTIAL_REQUEST: 'a substantial, unclear request',
};

const ATTEMPT_LABEL: Readonly<Record<string, string>> = { ESCALATION: 'escalated', RETRY: 'retried at the same level', FALLBACK: 'fallback route' };

/**
 * One reply's reasoning story from the server's reply state (codes only): who chose the starting level and why, then
 * what each further call was. Never presents an AUTO start or an escalation as the Founder's choice.
 */
export function selectionSummary(r: Json): { chosen: string; calls: string[]; why: string } {
  const sel = (r.selection as Json | undefined) ?? {};
  const mode = String(sel.mode ?? (r.requestedClass ? 'MANUAL' : 'DEFAULT'));
  const start = typeof sel.startClass === 'string' ? sel.startClass : typeof r.requestedClass === 'string' ? r.requestedClass : null;
  const ideal = typeof sel.idealClass === 'string' ? sel.idealClass : null;
  const constraint = typeof sel.constraint === 'string' ? sel.constraint : null;
  const reasons = Array.isArray(sel.reasons) ? (sel.reasons as string[]).map((c) => DEMAND_REASON_LABEL[c] ?? c.toLowerCase()) : [];
  let chosen: string;
  if (mode === 'MANUAL') chosen = `${start ?? ''} chosen by you`;
  else if (mode === 'SYSTEM_PINNED') chosen = `${start ?? ''} fixed by the task`;
  else if (mode === 'NOT_RECORDED') chosen = 'level choice not recorded (earlier reply)';
  else if (mode === 'AUTO') chosen = !start ? 'AUTO' : constraint && ideal && ideal !== start ? `AUTO: ${ideal} needed, ran at ${start} (${REASON_LABEL[constraint] ?? constraint.toLowerCase()})` : `AUTO chose ${start}`;
  else chosen = start ? `default ${start}` : 'default level';
  const calls = ((r.callDetails as Json[] | undefined) ?? []).slice(1).map((c) => `${ATTEMPT_LABEL[String(c.attemptKind)] ?? String(c.attemptKind).toLowerCase()} → ${String(c.reasoningClass)}${c.finishReason === 'length' ? ' (output limit reached)' : ''}`);
  return { chosen, calls, why: mode === 'AUTO' && reasons.length ? `AUTO: ${reasons.slice(0, 4).join(', ')}` : '' };
}
