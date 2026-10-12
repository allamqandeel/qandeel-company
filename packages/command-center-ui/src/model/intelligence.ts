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
export const LEVEL_STATE_LABEL: Readonly<Record<string, string>> = { AVAILABLE: 'Available', ABOVE_EMPLOYEE_CEILING: 'Above maximum', ABOVE_ROUTE_POLICY: 'Route limit', BELOW_ROUTE_POLICY: 'Below route minimum', NOT_PROVISIONED: 'Not provisioned', NO_ROUTE_POLICY: 'No route' };

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
  // P1-AUTO-E12-01 R1-04: a technical output failure, never a verdict on the Employee and never a claim of how many calls ran.
  MODEL_OUTPUT_INVALID: 'the model’s output did not follow the required reply format, so it was not used (no invalid or incomplete reply is ever accepted)',
  MODEL_ACCESS_DENIED: 'this Employee has no model access for conversation',
  EMPLOYEE_CONTAINED: 'this Employee is contained',
  RUN_LIMIT: 'the reply reached its bound on model calls',
  MAX_TURNS: 'the reply reached its bound on steps',
  PROVIDER_FAILURE: 'the model provider failed',
  COMPLETED_WITHOUT_REPLY: 'the run ended without recording a message',
  RECONCILIATION_HOLD: 'a provider call has an uncertain outcome and waits for your reconciliation',
  RECONCILIATION_REQUIRED: 'a model call may have been sent and charged, but its outcome is unknown; nothing more is sent for this reply until you reconcile it',
  RETRY_SCHEDULED: 'a transient failure; one bounded retry is scheduled',
  ABOVE_EMPLOYEE_CEILING: 'above this Employee’s maximum level',
  ABOVE_ROUTE_POLICY: 'above the level the conversation route allows',
  BELOW_ROUTE_POLICY: 'below the minimum level the conversation route requires (a chosen level is kept exactly, never raised)',
  NOT_PROVISIONED: 'not provisioned for conversation yet',
  NO_ROUTE_POLICY: 'no conversation route is provisioned',
  REASONING_CLASS: 'not a reasoning level',
  EMPLOYEE_NOT_ELIGIBLE: 'only an ACTIVE Employee can be asked for a reply',
  BUDGET_MISSING: 'this Employee has no budget envelope to answer from',
  // P1-REASON-AUTO-RECOVERY-01
  // P1-E4-RELIABILITY-01 (D-P1-12): no claim of how many calls ran (an E4 you chose makes one; AUTO E2 one repair).
  MODEL_OUTPUT_TRUNCATED: 'the thinking and the reply used up the output allowance before the reply was complete, so no incomplete reply was accepted; the call was charged and is not re-sent on its own',
  OUTPUT_TRUNCATED: 'the output allowance ran out before the reply was complete',
  PROVIDER_CIRCUIT_OPEN: 'the model provider is paused after repeated failures; the reply waits for it and spends nothing meanwhile',
  REASONING_LEVEL_UNAVAILABLE: 'the level you chose has no model deployment now; it was not replaced by another level',
  EMPLOYEE_CEILING: 'held at this Employee’s maximum level',
  ROUTE_POLICY: 'held by the conversation route’s maximum level',
  // P1-AUTO-E12-01 (D-P1-11)
  AUTO_POLICY_CAP: 'AUTO never goes above E2 by itself; choose E3 or E4 for a message that needs deeper thinking',
  AUTO_LEVEL_LIMIT: 'this step required a level above E2, and company policy keeps AUTO at E2 or below, so nothing above E2 ran; choose E3 or E4 for the message if it needs deeper thinking',
  NO_ELIGIBLE_DEPLOYMENT: 'no route can take this reply at its level now; nothing was spent',
  // P1-E4-RELIABILITY-01 (D-P1-12)
  RUN_DEADLINE_INSUFFICIENT: 'too little of the reply’s run time was left for the next model call to finish, so that call was not sent and nothing was charged; the reply continues in a new run, at the same level',
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
export const AUTO_EXPLAINED = 'AUTO picks, for each message, the lowest sufficient level up to E2 (routine and simple → E1, analysis and planning → E2), within the maximum, the route and what is provisioned. It never goes to E3 or E4 by itself — choose E3 or E4 for a message that needs deeper thinking. It is not a fifth level, it makes no extra model call to decide, and a level you choose for a message always wins.';

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

const count = (n: unknown): string | null => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : null);

/**
 * P1-E4-RELIABILITY-01 (D-P1-12) — one content-free line per sent call, oldest first: the level, the attempt, the allowance it
 * had, its token counts (thinking included), the finish reason, the latency and the result code. Numbers and codes only;
 * an answer is never claimed for a call whose output was cut or invalid.
 */
export function callDiagnostics(r: Json): string[] {
  return ((r.callDetails as Json[] | undefined) ?? []).map((c) => {
    const parts = [`${String(c.reasoningClass)} ${String(c.attemptKind).toLowerCase()}`];
    const allowance = count(c.maxOutputTokens);
    if (allowance) parts.push(`allowance ${allowance}`);
    const out = count(c.outputTokens);
    const thinking = count(c.reasoningTokens);
    if (out) parts.push(thinking ? `${out} output tokens (${thinking} thinking)` : `${out} output tokens`);
    if (c.finishReason === 'length') parts.push('output limit reached');
    else if (c.finishReason === 'stop') parts.push('finished');
    if (typeof c.latencyMs === 'number' && Number.isFinite(c.latencyMs)) parts.push(`${(c.latencyMs / 1000).toFixed(1)} s`);
    const invalid = typeof c.invalidCode === 'string' ? c.invalidCode : null;
    parts.push(c.result === 'ANSWERED' && invalid === null ? 'valid output' : (invalid ?? String(c.result)));
    return parts.join(' · ');
  });
}

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
  else if (mode === 'AUTO') {
    // D-P1-11: a step that could not route ran nothing; it is never shown as a level that answered.
    const unrouted = typeof sel.routeUnavailable === 'string' && !((r.callDetails as Json[] | undefined) ?? []).length ? sel.routeUnavailable : null;
    if (unrouted) chosen = `AUTO: nothing ran (${REASON_LABEL[unrouted] ?? unrouted.toLowerCase()})`;
    // R1-04: the demand is AUTO's estimate, never proof that the message needed that level; the policy's choice is named.
    else if (!start) chosen = 'AUTO';
    else if (constraint === 'AUTO_POLICY_CAP') chosen = ideal && ideal !== start ? `AUTO estimated ${ideal} demand; company policy selected ${start}` : `AUTO: company policy selected ${start}`;
    else chosen = constraint && ideal && ideal !== start ? `AUTO estimated ${ideal} demand; selected ${start} (${REASON_LABEL[constraint] ?? constraint.toLowerCase()})` : `AUTO chose ${start}`;
  } else chosen = start ? `default ${start}` : 'default level';
  // R1-04: the level that actually executed is shown from the recorded call, never inferred (no call recorded, no claim).
  const first = ((r.callDetails as Json[] | undefined) ?? [])[0];
  if (first && typeof first.reasoningClass === 'string' && start && first.reasoningClass !== start) chosen += `, ran at ${first.reasoningClass}`;
  const calls = ((r.callDetails as Json[] | undefined) ?? []).slice(1).map((c) => `${ATTEMPT_LABEL[String(c.attemptKind)] ?? String(c.attemptKind).toLowerCase()} → ${String(c.reasoningClass)}${c.finishReason === 'length' ? ' (output limit reached)' : ''}`);
  return { chosen, calls, why: mode === 'AUTO' && reasons.length ? `AUTO: ${reasons.slice(0, 4).join(', ')}` : '' };
}
