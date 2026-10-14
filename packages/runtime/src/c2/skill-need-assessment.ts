/**
 * `c2.skill-need-assessment` — the governed processor of one Skill Need Assessment (G4-C2-SNA-01, D-P1-15).
 *
 * One Work Item, one model step: the Employee's own governed call under the assessment task class, pinned at E1 (never the
 * class the Founder chose for the reply, never one of the reply's calls), with its own short timeout and output allowance,
 * through the unchanged Context Assembly → authorization → Router Policy → reservation → settlement path. The output is
 * one closed SKILL_NEED proposal, bound by the store to exactly the offered Skills; anything else — and every failure to get
 * an answer — records the conservative fallback with its cause, and the reply plans with it. Nothing is retried here, and
 * an assessment never waits: an open circuit, a budget refusal or an unavailable provider ends it at once.
 *
 * The processor can only call its model and record its result: the runtime gives it no tool, message, memory,
 * organizational, review, goal or answer path (`skillNeedOnly`).
 */
import type { Id, ProcessorContext, ProcessorResult } from '@qandeel-company/domain';
import { SKILL_NEED_CALL_TIMEOUT_MS, SKILL_NEED_MAX_OUTPUT_TOKENS, SKILL_NEED_TASK_CLASS, type SkillNeedOutcome } from '@qandeel-company/governance';
import { SKILL_NEED_ASSESSMENT_KIND } from '@qandeel-company/storage';

import type { GovernedProcessor, GovernedRunServices, ModelCallOutcome } from './types.js';

export { SKILL_NEED_ASSESSMENT_KIND };

/** The run's own bound: the call's timeout plus the store work around it (never the reply's ten minutes). */
export const SKILL_NEED_RUN_MS = 60_000;

/** Why no classification exists, for each way the governed call can end without one (content-free codes). */
function fallbackOf(out: Exclude<ModelCallOutcome, { kind: 'OK' }>): SkillNeedOutcome {
  switch (out.kind) {
    case 'DENIED':
      return 'ACCESS_DENIED';
    case 'BUDGET':
      return out.code === 'RUN_LIMIT' ? 'RUN_LIMIT' : 'BUDGET_REFUSED';
    case 'CONTEXT':
      return 'CONTEXT_REFUSED';
    case 'CIRCUIT_OPEN':
      return 'CIRCUIT_OPEN';
    case 'FAILED':
      return 'PROVIDER_FAILED';
    case 'UNCERTAIN':
      return 'PROVIDER_UNCERTAIN';
    case 'NO_LLM':
    case 'ESCALATION_REFUSED':
    case 'UNAVAILABLE':
      return 'PROVIDER_UNAVAILABLE';
  }
}

/**
 * The class and output allowance the assessment's call is pinned at. Production is E1 / 256 (`skillNeedAssessmentProcessor`).
 * G4-C2-REASONING-GATE-01: the isolated DEV pilot measures E2 (thinking low) with the Company's E2 allowance through the same
 * governed path. Pinning a class here grants nothing: the call still routes only to a deployment qualified for the task
 * class at that class, under the route policy, the Employee ceiling and the reservation — the production Skill-need profile
 * qualifies E1 only, so an E2 pin there makes no call and ends in the PROVIDER_UNAVAILABLE fallback.
 */
export interface SkillNeedCallLevel {
  readonly reasoningClass: 'E1' | 'E2';
  readonly maxOutputTokens: number;
}

export function skillNeedAssessmentProcessorAt(level: SkillNeedCallLevel): GovernedProcessor {
  const { reasoningClass, maxOutputTokens } = level;
  if ((reasoningClass !== 'E1' && reasoningClass !== 'E2') || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) throw new Error('INVALID_SKILL_NEED_CALL_LEVEL');
  return Object.freeze<GovernedProcessor>({
    kind: SKILL_NEED_ASSESSMENT_KIND,
    // No external effect: one model call (reserved and settled by the Model Runtime) and one fenced record.
    sideEffects: 'IDEMPOTENT',
    governed: true,
    maxRunMs: SKILL_NEED_RUN_MS,
    run: () => Promise.resolve({ type: 'PERMANENT_FAILURE', code: 'GOVERNANCE_REQUIRED' }),
    async runGoverned(_ctx: ProcessorContext, gov: GovernedRunServices): Promise<ProcessorResult> {
      let state;
      try {
        state = gov.skillNeedState();
      } catch {
        return { type: 'PERMANENT_FAILURE', code: 'INVALID_TASK_INPUT' };
      }
      // A decision exists (the reply's window passed, an earlier run recorded it) or the reply ended: no call is useful.
      if (state.decided) return { type: 'COMPLETED', evidence: { summaryCode: 'skill_need.already_decided', modelCalls: 0 } };
      if (state.replyEnded) return { type: 'COMPLETED', evidence: { summaryCode: 'skill_need.reply_ended', modelCalls: 0 } };
      const out = await gov.invokeModel({ taskClass: SKILL_NEED_TASK_CLASS, reasoningClass, step: 0, maxOutputTokens, timeoutMs: SKILL_NEED_CALL_TIMEOUT_MS });
      if (out.kind !== 'OK') {
        const outcome = fallbackOf(out);
        gov.recordSkillNeed({ kind: 'FALLBACK', outcome });
        return { type: 'PERMANENT_FAILURE', code: `SKILL_NEED_${outcome}` };
      }
      if (out.proposal.type === 'SKILL_NEED') {
        const r = gov.recordSkillNeed({ kind: 'PROPOSAL', proposal: out.proposal, manifestId: out.manifestId as Id });
        if (!r.recorded) return { type: 'COMPLETED', evidence: { summaryCode: 'skill_need.late', modelCalls: 1 } };
        // A SKILL_NEED that names other Skills than the offered ones is refused whole by the store (OUTPUT_INVALID).
        if (r.record.source === 'MODEL') return { type: 'COMPLETED', evidence: { summaryCode: 'skill_need.classified', modelCalls: 1, reasoningClass: out.reasoningClass } };
        return { type: 'PERMANENT_FAILURE', code: 'SKILL_NEED_OUTPUT_INVALID' };
      }
      // Any other output (another proposal type, malformed, truncated) is never executed: its content-free cause is noted.
      if (out.proposal.type === 'INVALID') gov.noteInvalidOutput(0, out.proposal.code, out.reasoningClass, ...(out.invalidReason !== null ? [{ malformedReason: out.invalidReason }] : []));
      else gov.noteInvalidOutput(0, 'WRONG_PROPOSAL_TYPE', out.reasoningClass, { proposalType: out.proposal.type });
      const outcome: SkillNeedOutcome = out.proposal.type === 'INVALID' && out.proposal.code === 'OUTPUT_TRUNCATED' ? 'OUTPUT_TRUNCATED' : 'OUTPUT_INVALID';
      gov.recordSkillNeed({ kind: 'FALLBACK', outcome });
      return { type: 'PERMANENT_FAILURE', code: `SKILL_NEED_${outcome}` };
    },
  });
}

/** The production assessment: E1 (thinking off, temperature 0) with the 256-token allowance. */
export const skillNeedAssessmentProcessor: GovernedProcessor = skillNeedAssessmentProcessorAt({ reasoningClass: 'E1', maxOutputTokens: SKILL_NEED_MAX_OUTPUT_TOKENS });

/**
 * The services a Skill Need Assessment run receives: its model call, its state, its one result and the content-free output
 * diagnosis. Every other path is closed here (and refused again by the store's own fences).
 */
export function skillNeedOnly(s: GovernedRunServices): GovernedRunServices {
  const code = 'SKILL_NEED_ASSESSMENT_ONLY';
  return Object.freeze({
    context: s.context,
    invokeModel: s.invokeModel,
    skillNeedState: s.skillNeedState,
    recordSkillNeed: s.recordSkillNeed,
    noteInvalidOutput: s.noteInvalidOutput,
    proposeMemory: () => ({ kind: 'REFUSED' as const, code }),
    executeTool: () => Promise.resolve({ kind: 'DENIED' as const, code, paused: false }),
    orgAct: () => ({ outcome: 'REFUSED' as const, code, after: 'CONTINUE' as const, paused: false }),
    submitReviewDecision: () => ({ outcome: 'REFUSED' as const, code }),
    openHandoffs: () => 0,
    clarificationsRequested: () => 0,
    refuseFinal: () => undefined,
    sendMessage: () => ({ outcome: 'REFUSED' as const, code, messageId: null }),
    goalAct: () => ({ outcome: 'REFUSED' as const, code, resultRef: null }),
    recordAnswer: () => ({ outcome: 'REFUSED' as const, code, answerId: null }),
  });
}
