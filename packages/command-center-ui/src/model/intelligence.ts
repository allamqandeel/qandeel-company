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
