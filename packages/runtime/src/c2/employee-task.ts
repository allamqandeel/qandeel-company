/**
 * `c2.employee-task` — the runtime-owned agent loop for one Employee Work Item (Stage 13 D13-D).
 *
 * The runtime owns the loop; the model proposes ONE typed next action per turn. A proposal is data:
 * FINAL completes, TOOL_REQUEST is handed to the Tool Executor (which enforces authority), anything
 * else is invalid and never executed. Every turn is checkpointed before its side effect, so a
 * resumed run continues the same step with the same idempotency key. Waiting (approval, budget,
 * review) is an event-driven WAIT that consumes no tokens.
 */
import { assertIntInRange, boundedText, type JsonValue, type ProcessorContext, type ProcessorResult } from '@qandeel-company/domain';
import { assertTaskClass, isDataClass, isReasoningClass, providerFailedRunCode, unavailableRunCode, type ModelProposal, type ReasoningClass } from '@qandeel-company/governance';
import { containsSecretMaterial } from '@qandeel-company/mind';

import type { GovernedProcessor, GovernedRunServices, OrgActProposal, ReviewDecisionProposal, ToolRequest } from './types.js';

export const EMPLOYEE_TASK_KIND = 'c2.employee-task';

export interface EmployeeTaskInput {
  readonly taskClass: string;
  /** Declared data class of the context (D0..D4); default D1. Set by the submitter, never the model. */
  readonly dataClass?: string;
  readonly reasoningClass?: ReasoningClass;
  /** Instructions (context payload): sent only to the provider, never to logs, events or audit. */
  readonly instructions: string;
  readonly maxTurns?: number;
  readonly maxOutputTokens?: number;
}

interface LoopState {
  readonly turn: number;
  /** FINAL: the model already decided to finish (R1 B-F4) — a resume completes without another call. */
  readonly phase: 'MODEL' | 'TOOL' | 'ORG' | 'FINAL';
  readonly summaryCode?: string | null;
  readonly pending: ToolRequest | null;
  /** C4: a checkpointed organizational act or review decision (resume replays the recorded outcome). */
  readonly pendingOrg?: OrgActProposal | ReviewDecisionProposal | null;
  readonly modelCalls: number;
  readonly invalid: number;
}


function readInput(input: JsonValue): Required<Omit<EmployeeTaskInput, 'reasoningClass' | 'dataClass'>> & { reasoningClass: ReasoningClass | null } {
  const o = (input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, JsonValue>;
  // An invalid data class is refused outright (classification never fails open).
  if (o.dataClass !== undefined && !isDataClass(o.dataClass)) throw new Error('invalid dataClass');
  if (o.reasoningClass !== undefined && !isReasoningClass(o.reasoningClass)) throw new Error('invalid reasoningClass');
  // C3 context controls are validated up front (a typed refusal, never a failure inside assembly).
  if (o.contextDataClassCeiling !== undefined && !isDataClass(o.contextDataClassCeiling)) throw new Error('invalid contextDataClassCeiling');
  if (o.contextBudgetTokens !== undefined) assertIntInRange(o.contextBudgetTokens, 'contextBudgetTokens', 1_024, 64_000);
  const instructions = boundedText(o.instructions, 'instructions', 12_000);
  // Instructions are sent to a provider: secret material never enters a prompt (Stage 14, R1-01).
  if (containsSecretMaterial(instructions)) throw new Error('instructions carry secret material');
  return {
    taskClass: assertTaskClass(o.taskClass),
    instructions,
    maxTurns: o.maxTurns === undefined ? 8 : assertIntInRange(o.maxTurns, 'maxTurns', 1, 32),
    maxOutputTokens: o.maxOutputTokens === undefined ? 512 : assertIntInRange(o.maxOutputTokens, 'maxOutputTokens', 1, 32_768),
    reasoningClass: isReasoningClass(o.reasoningClass) ? o.reasoningClass : null,
  };
}

function readState(ctx: ProcessorContext): LoopState {
  const s = ctx.resumeFrom?.state as Partial<LoopState> | null | undefined;
  if (ctx.resumeFrom?.kind !== 'employee-loop' || typeof s !== 'object' || s === null || typeof s.turn !== 'number') return { turn: 0, phase: 'MODEL', pending: null, modelCalls: 0, invalid: 0 };
  const phase = s.phase === 'TOOL' ? 'TOOL' : s.phase === 'ORG' ? 'ORG' : s.phase === 'FINAL' ? 'FINAL' : 'MODEL';
  return { turn: s.turn, phase, pending: (s.pending ?? null) as ToolRequest | null, pendingOrg: (s.pendingOrg ?? null) as OrgActProposal | ReviewDecisionProposal | null, modelCalls: Number(s.modelCalls ?? 0), invalid: Number(s.invalid ?? 0), summaryCode: typeof s.summaryCode === 'string' ? s.summaryCode : null };
}

const save = (ctx: ProcessorContext, s: LoopState): Promise<void> => ctx.checkpoint('employee-loop', s as unknown as JsonValue);


export const employeeTaskProcessor: GovernedProcessor = {
  kind: EMPLOYEE_TASK_KIND,
  // External effects happen only through tools with idempotency keys and tool-level reconciliation;
  // an interrupted run resumes from its checkpoint and never repeats a recorded effect.
  sideEffects: 'IDEMPOTENT',
  governed: true,
  maxRunMs: 10 * 60_000,
  run: () => Promise.resolve({ type: 'PERMANENT_FAILURE', code: 'GOVERNANCE_REQUIRED' }),
  async runGoverned(ctx: ProcessorContext, gov: GovernedRunServices): Promise<ProcessorResult> {
    let s = readState(ctx);
    // A FINAL decision checkpointed before a crash is honoured on resume first: the work already
    // finished, so nothing about its input is re-judged and no new model call or action happens.
    if (s.phase === 'FINAL') return { type: 'COMPLETED', evidence: { summaryCode: s.summaryCode ?? 'final', turns: s.turn, modelCalls: s.modelCalls, resumed: true } };
    let cfg;
    try {
      cfg = readInput(ctx.input);
    } catch {
      return { type: 'PERMANENT_FAILURE', code: 'INVALID_TASK_INPUT' };
    }
    let escalateFrom: { fromClass: ReasoningClass; evidence: 'OUTPUT_FAILED_VALIDATION' | 'CONTEXT_OVERFLOW' } | null = null;
    let escalated = false;
    while (s.turn < cfg.maxTurns) {
      if (ctx.signal.aborted) return { type: 'CANCELLED' };
      if (s.phase === 'ORG' && s.pendingOrg) {
        const p = s.pendingOrg;
        const next: LoopState = { ...s, turn: s.turn + 1, phase: 'MODEL', pending: null, pendingOrg: null };
        if (p.type === 'REVIEW_DECISION') {
          const out = gov.submitReviewDecision(p, s.turn);
          await save(ctx, next);
          // A recorded decision is the review Work Item's deliverable; a refusal is context for the next turn.
          if (out.outcome === 'RECORDED') return { type: 'COMPLETED', evidence: { reviewDecision: p.outcome, turns: s.turn, modelCalls: s.modelCalls } };
          s = next;
          continue;
        }
        const out = gov.orgAct(p, s.turn);
        await save(ctx, next);
        if (out.paused) return { type: 'PERMANENT_FAILURE', code: 'EMPLOYEE_CONTAINED' };
        if (out.outcome === 'DONE' && out.after === 'END_REFUSED') return { type: 'PERMANENT_FAILURE', code: 'HANDOFF_REFUSED' };
        if (out.outcome === 'DONE' && out.after === 'WAIT_CLARIFICATION') return { type: 'WAIT', reasonCode: 'AWAITING_CLARIFICATION' };
        if (out.outcome === 'DONE' && out.after === 'WAIT_ESCALATION') return { type: 'WAIT', reasonCode: 'AWAITING_ESCALATION' };
        s = next;
        continue;
      }
      if (s.phase === 'TOOL' && s.pending) {
        const out = await gov.executeTool(s.pending, s.turn);
        switch (out.kind) {
          case 'SUCCEEDED':
            s = { ...s, turn: s.turn + 1, phase: 'MODEL', pending: null };
            await save(ctx, s);
            continue;
          case 'DENIED':
            if (out.paused || out.code === 'EMPLOYEE_NOT_ELIGIBLE') return { type: 'PERMANENT_FAILURE', code: 'EMPLOYEE_CONTAINED' };
            s = { ...s, turn: s.turn + 1, phase: 'MODEL', pending: null };
            await save(ctx, s);
            continue;
          case 'APPROVAL_REQUIRED':
            return { type: 'WAIT', reasonCode: 'AWAITING_APPROVAL' };
          case 'REVIEW_REQUIRED':
            return { type: 'WAIT', reasonCode: 'AWAITING_INDEPENDENT_REVIEW' };
          case 'BUDGET':
            return out.code === 'BUDGET_EXHAUSTED' ? { type: 'WAIT', reasonCode: 'BUDGET_EXHAUSTED' } : { type: 'PERMANENT_FAILURE', code: out.code };
          case 'RECONCILIATION_REQUIRED':
            return { type: 'RECONCILIATION_REQUIRED', code: 'TOOL_OUTCOME_UNCERTAIN' };
          case 'NOT_EXECUTED':
            return { type: 'RETRYABLE_FAILURE', code: 'TOOL_NOT_EXECUTED' };
          case 'FAILED':
            return { type: 'PERMANENT_FAILURE', code: 'TOOL_FAILED' };
        }
      }
      const requested = escalateFrom === null ? (cfg.reasoningClass ?? undefined) : undefined;
      const out = await gov.invokeModel({
        taskClass: cfg.taskClass,
        ...(requested !== undefined ? { reasoningClass: requested } : {}),
        ...(escalateFrom !== null ? { escalation: escalateFrom } : {}),
        // No messages: the runtime assembles this step's context (C3 Context Assembler) from durable state —
        // instructions, skills, knowledge, memory and the results its own services recorded for earlier steps.
        step: s.turn,
        maxOutputTokens: cfg.maxOutputTokens,
      });
      if (escalateFrom !== null) escalated = true;
      escalateFrom = null;
      switch (out.kind) {
        case 'NO_LLM':
          // E0: deterministic work, no model call at all.
          return { type: 'COMPLETED', evidence: { reasoningClass: 'E0', modelCalls: 0, turns: s.turn } };
        case 'DENIED':
          return { type: 'PERMANENT_FAILURE', code: out.code === 'EMPLOYEE_NOT_ELIGIBLE' ? 'EMPLOYEE_CONTAINED' : 'MODEL_ACCESS_DENIED' };
        case 'BUDGET':
          return out.code === 'BUDGET_EXHAUSTED' ? { type: 'WAIT', reasonCode: 'BUDGET_EXHAUSTED' } : { type: 'PERMANENT_FAILURE', code: out.code === 'RUN_LIMIT' ? 'RUN_LIMIT' : out.code };
        case 'ESCALATION_REFUSED':
          return { type: 'PERMANENT_FAILURE', code: 'ESCALATION_REFUSED' };
        case 'UNAVAILABLE':
          // No answer never crashes the Company: bounded C1 retry, then dead letter. The run records the real
          // cause from the shared run-failure vocabulary (R2-12): a missing route policy, a local settlement
          // failure or an abort is never blamed on the provider.
          return { type: 'RETRYABLE_FAILURE', code: unavailableRunCode(out.code) };
        case 'UNCERTAIN':
          // The provider broke the contract or its outcome is unknown after send (money held).
          return { type: 'RETRYABLE_FAILURE', code: 'PROVIDER_FAILURE' };
        case 'FAILED':
          // One evidence-based escalation per run step; never re-escalate from the class that just failed.
          if (out.failure === 'CONTEXT_OVERFLOW' && !escalated && cfg.reasoningClass !== 'E4') {
            escalateFrom = { fromClass: cfg.reasoningClass ?? gov.context.cognitiveProfile.defaultClass, evidence: 'CONTEXT_OVERFLOW' };
            continue;
          }
          return { type: 'PERMANENT_FAILURE', code: providerFailedRunCode(out.failure) };
        case 'CONTEXT':
          // Typed context outcomes: an IMPORTANT unresolved conflict or conflicting skills park the work
          // for review (zero tokens); a context that cannot fit or fails integrity never reaches a model.
          if (out.code === 'CONFLICT_HOLD') return { type: 'WAIT', reasonCode: 'MEMORY_CONFLICT_REVIEW' };
          if (out.code === 'SKILL_CONFLICT') return { type: 'WAIT', reasonCode: 'SKILL_CONFLICT_REVIEW' };
          return { type: 'PERMANENT_FAILURE', code: out.code };
        case 'OK':
          break;
      }
      s = { ...s, modelCalls: s.modelCalls + 1 };
      const proposal: ModelProposal = out.proposal;
      if (proposal.type === 'FINAL') {
        // Accountability stays with the delegator (Stage 8 §23): work with open handoffs does not finish; it
        // waits (zero tokens) and resumes when a delegate answers or its work ends.
        if (gov.openHandoffs() > 0) {
          // R2-04: a delegate's pending question is this run's to answer (`handoff.clarify`): parking would wait on
          // itself. RR2-2: the refused FINAL is recorded as this step's result (code FINAL_REFUSED_CLARIFICATION_PENDING,
          // naming the delegations that asked), so the next turn's governed context tells the model why it cannot
          // finish and what to answer. The loop continues (bounded by maxTurns; a delegator that ends unfinished
          // closes its handoffs and cancels the work it delegated). Every other open handoff — offered, accepted,
          // escalated to the Founder — parks the work at zero tokens.
          if (gov.clarificationsRequested() > 0) {
            gov.refuseFinal(s.turn, 'FINAL_REFUSED_CLARIFICATION_PENDING');
            s = { ...s, turn: s.turn + 1, phase: 'MODEL', pending: null };
            await save(ctx, s);
            continue;
          }
          s = { ...s, turn: s.turn + 1, phase: 'MODEL', pending: null };
          await save(ctx, s);
          return { type: 'WAIT', reasonCode: 'AWAITING_DELEGATION' };
        }
        await save(ctx, { ...s, phase: 'FINAL', pending: null, summaryCode: proposal.summaryCode });
        return { type: 'COMPLETED', evidence: { summaryCode: proposal.summaryCode, turns: s.turn, modelCalls: s.modelCalls, reasoningClass: out.reasoningClass } };
      }
      if (proposal.type === 'MEMORY_CANDIDATE' || proposal.type === 'OBSERVATION') {
        // Only a candidate: the Memory Write Policy decides. The loop learns the decision code, never more.
        gov.proposeMemory(proposal, s.turn);
        s = { ...s, turn: s.turn + 1, phase: 'MODEL', pending: null };
        await save(ctx, s);
        continue;
      }
      if (proposal.type === 'MESSAGE' || proposal.type === 'GOAL_ACTION') {
        // C5: a message into the run's own Founder thread, or a Director's goal act. Both are fenced writes,
        // idempotent per Work Item (a resumed run never posts or derives twice); the loop learns the code only.
        if (proposal.type === 'MESSAGE') {
          const sent = gov.sendMessage(proposal, s.turn);
          if (sent.outcome === 'RECORDED') {
            // D-L1-09: a thread-bound item (a Founder reply or a CEO brief) exists to deliver one message. Once the
            // fence has recorded it the work is done: the runtime ends the run here, so a second message, a wasted
            // model call or a RUN_LIMIT failure after a delivered answer cannot happen whatever the model proposes.
            const summaryCode = proposal.purpose === 'BRIEF' ? 'brief.sent' : 'reply.sent';
            await save(ctx, { ...s, phase: 'FINAL', pending: null, summaryCode });
            return { type: 'COMPLETED', evidence: { summaryCode, turns: s.turn, modelCalls: s.modelCalls, reasoningClass: out.reasoningClass, messageId: sent.messageId } };
          }
        } else gov.goalAct(proposal, s.turn);
        s = { ...s, turn: s.turn + 1, phase: 'MODEL', pending: null };
        await save(ctx, s);
        continue;
      }
      if (proposal.type === 'INVALID') {
        // Observable evidence (the output failed validation) may justify one escalation.
        s = { ...s, invalid: s.invalid + 1 };
        if (s.invalid >= 2 || escalated) return { type: 'PERMANENT_FAILURE', code: 'MODEL_OUTPUT_INVALID' };
        escalateFrom = { fromClass: out.reasoningClass, evidence: 'OUTPUT_FAILED_VALIDATION' };
        continue;
      }
      if (proposal.type === 'ORG_ACTION' || proposal.type === 'REVIEW_DECISION') {
        // Checkpointed before its effect, like a tool request: resume replays it at the same step.
        s = { ...s, phase: 'ORG', pending: null, pendingOrg: proposal };
        await save(ctx, s);
        continue;
      }
      // Checkpoint the planned action before any side effect: resume re-presents the same request.
      s = { ...s, phase: 'TOOL', pending: { tool: proposal.tool, action: proposal.action, args: proposal.args } };
      await save(ctx, s);
    }
    return { type: 'PERMANENT_FAILURE', code: 'MAX_TURNS' };
  },
};
