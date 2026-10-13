/**
 * G4-C2-SNA-01 (D-P1-15) — the Skill Need Assessment processor against scripted governed services (pure, no store): every way
 * its one call can end maps to exactly one recorded fallback cause (never a retry, never a wait); a decided assessment or an
 * ended reply makes no call; the call is pinned to E1 / 256 / 15 s under its own task class; every path but its model call
 * and its result is closed; a call can only shorten its timeout, never extend it.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Id, ProcessorContext } from '@qandeel-company/domain';
import { SKILL_NEED_CALL_TIMEOUT_MS, SKILL_NEED_MAX_OUTPUT_TOKENS, SKILL_NEED_TASK_CLASS, type ModelProposal } from '@qandeel-company/governance';

import { callTimeoutMs, modelCallTimeoutMs } from '../../src/c2/model-runtime.js';
import { skillNeedOnly } from '../../src/c2/skill-need-assessment.js';
import { skillNeedAssessmentProcessor, type GovernedRunServices, type ModelCallOutcome, type ModelCallRequest } from '../../src/index.js';

const ctx = {} as ProcessorContext;
const ok = (proposal: ModelProposal, invalidReason: string | null = null): ModelCallOutcome => ({ kind: 'OK', proposal, usage: { inputTokens: 2_600, outputTokens: 70 }, deploymentId: 'd', reasoningClass: 'E1', attempts: 1, manifestId: 'm', maxOutputTokens: 256, finishReason: 'stop', invalidReason: invalidReason as never });

function drive(outcome: ModelCallOutcome | null, state: { decided?: boolean; replyEnded?: boolean } = {}, recorded = true) {
  const calls: ModelCallRequest[] = [];
  const records: unknown[] = [];
  const notes: unknown[] = [];
  const services = {
    context: {} as GovernedRunServices['context'],
    invokeModel: (req: ModelCallRequest) => {
      calls.push(req);
      return Promise.resolve(outcome as ModelCallOutcome);
    },
    skillNeedState: () => ({ binding: {} as never, decided: state.decided === true, replyEnded: state.replyEnded === true }),
    recordSkillNeed: (input: unknown) => {
      records.push(input);
      const proposal = (input as { kind: string }).kind === 'PROPOSAL';
      return (recorded ? { recorded: true, record: { source: proposal ? 'MODEL' : 'FALLBACK' } } : { recorded: false, code: 'ALREADY_DECIDED', record: {} }) as never;
    },
    noteInvalidOutput: (...a: unknown[]) => void notes.push(a),
  } as unknown as GovernedRunServices;
  return { run: skillNeedAssessmentProcessor.runGoverned(ctx, services), calls, records, notes };
}

describe('G4-C2-SNA-01: the assessment processor', () => {
  test('one call, pinned: its own task class, E1, 256 output, a 15-second timeout, step 0, no escalation or continuation', async () => {
    const d = drive(ok({ type: 'SKILL_NEED', skills: [{ code: 'ceo.governance-discipline', tier: 'SUPPORTING' }] }));
    assert.deepEqual(await d.run, { type: 'COMPLETED', evidence: { summaryCode: 'skill_need.classified', modelCalls: 1, reasoningClass: 'E1' } });
    assert.equal(d.calls.length, 1);
    const [c] = d.calls;
    assert.deepEqual([c?.taskClass, c?.reasoningClass, c?.maxOutputTokens, c?.timeoutMs, c?.step, c?.escalation, c?.continuation, c?.maxOutputTokensByClass], [SKILL_NEED_TASK_CLASS, 'E1', SKILL_NEED_MAX_OUTPUT_TOKENS, SKILL_NEED_CALL_TIMEOUT_MS, 0, undefined, undefined, undefined]);
    assert.deepEqual([SKILL_NEED_MAX_OUTPUT_TOKENS, SKILL_NEED_CALL_TIMEOUT_MS], [256, 15_000]);
    assert.equal((d.records[0] as { kind: string; manifestId: string }).kind, 'PROPOSAL');
  });

  test('a decided assessment or an ended reply makes no call', async () => {
    for (const s of [{ decided: true }, { replyEnded: true }]) {
      const d = drive(ok({ type: 'FINAL', summaryCode: 'x' }), s);
      const r = await d.run;
      assert.equal(r.type, 'COMPLETED');
      assert.equal(d.calls.length, 0);
      assert.equal(d.records.length, 0);
    }
  });

  test('every outcome without a classification records exactly one fallback cause and ends (never a retry, never a wait)', async () => {
    const cases: [ModelCallOutcome, string][] = [
      [{ kind: 'DENIED', code: 'NO_GRANT' }, 'ACCESS_DENIED'],
      [{ kind: 'BUDGET', code: 'BUDGET_EXHAUSTED', detail: '' }, 'BUDGET_REFUSED'],
      [{ kind: 'BUDGET', code: 'RUN_LIMIT', detail: '' }, 'RUN_LIMIT'],
      [{ kind: 'CONTEXT', code: 'INTEGRITY_FAILURE' }, 'CONTEXT_REFUSED'],
      [{ kind: 'CIRCUIT_OPEN', until: '2026-10-13T00:00:00.000Z' }, 'CIRCUIT_OPEN'],
      [{ kind: 'UNAVAILABLE', code: 'NO_ROUTE_POLICY' }, 'PROVIDER_UNAVAILABLE'],
      [{ kind: 'NO_LLM' }, 'PROVIDER_UNAVAILABLE'],
      [{ kind: 'ESCALATION_REFUSED', code: 'X' }, 'PROVIDER_UNAVAILABLE'],
      [{ kind: 'FAILED', failure: 'RATE_LIMITED' }, 'PROVIDER_FAILED'],
      [{ kind: 'UNCERTAIN', failure: 'TIMEOUT_AFTER_SEND' }, 'PROVIDER_UNCERTAIN'],
      [ok({ type: 'INVALID', code: 'OUTPUT_TRUNCATED' }), 'OUTPUT_TRUNCATED'],
      [ok({ type: 'INVALID', code: 'NOT_JSON' }), 'OUTPUT_INVALID'],
      [ok({ type: 'INVALID', code: 'MALFORMED' }, 'SKILLS_INVALID'), 'OUTPUT_INVALID'],
      [ok({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'x', brief: null, contextRefs: [] }), 'OUTPUT_INVALID'],
      [ok({ type: 'TOOL_REQUEST', tool: 'notes', action: 'append', args: {} }), 'OUTPUT_INVALID'],
    ];
    for (const [out, want] of cases) {
      const d = drive(out);
      const r = await d.run;
      assert.deepEqual(r, { type: 'PERMANENT_FAILURE', code: `SKILL_NEED_${want}` }, `${out.kind} → ${want}`);
      assert.deepEqual(d.records, [{ kind: 'FALLBACK', outcome: want }]);
      assert.equal(d.calls.length, 1, 'one call, never a retry');
    }
  });

  test('a late result is accepted quietly (the reply already planned with its decision)', async () => {
    const d = drive(ok({ type: 'SKILL_NEED', skills: [{ code: 'ceo.governance-discipline', tier: 'SUPPORTING' }] }), {}, false);
    assert.deepEqual(await d.run, { type: 'COMPLETED', evidence: { summaryCode: 'skill_need.late', modelCalls: 1 } });
  });

  test('the assessment\'s services: no tool, message, memory, organizational, review, goal or answer path', async () => {
    const touched: string[] = [];
    const full = new Proxy({}, { get: (_t, k) => (...a: unknown[]) => { touched.push(String(k)); return a; } }) as unknown as GovernedRunServices;
    const s = skillNeedOnly(full);
    assert.equal((await s.executeTool({ tool: 'notes', action: 'append', args: {} }, 0)).kind, 'DENIED');
    assert.equal(s.sendMessage({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'x', brief: null, contextRefs: [] }, 0).outcome, 'REFUSED');
    assert.equal(s.proposeMemory({ type: 'OBSERVATION', topic: 'x', content: 'y' }, 0).kind, 'REFUSED');
    assert.equal(s.orgAct({ type: 'ORG_ACTION', action: 'handoff.offer' as never, args: {} }, 0).outcome, 'REFUSED');
    assert.equal(s.submitReviewDecision({ type: 'REVIEW_DECISION', outcome: 'SATISFIED' as never, reasonCode: 'x', rationale: null, evidenceRefs: [] }, 0).outcome, 'REFUSED');
    assert.equal(s.goalAct({ type: 'GOAL_ACTION', action: 'goal.link', args: {} }, 0).outcome, 'REFUSED');
    assert.equal(s.recordAnswer({ type: 'ANSWER', body: 'x', decision: 'PROCEED', reversible: true, authority: 'WITHIN_HELD_AUTHORITY', evidence: 'SUFFICIENT', confidence: 'LOW', founderDecisionNeeded: false, spendMicros: 0 }, 0, 'm').outcome, 'REFUSED');
    assert.deepEqual([s.openHandoffs(), s.clarificationsRequested()], [0, 0]);
    assert.deepEqual(touched, [], 'none of them reached the real services');
    assert.ok(Object.isFrozen(s));
  });

  test('a call may only shorten its timeout (at least one second), never extend the runtime\'s', () => {
    assert.equal(callTimeoutMs(120_000, 256, 15_000), 15_000);
    assert.equal(callTimeoutMs(5_000, 256, 15_000), 5_000, 'never longer than the runtime\'s');
    assert.equal(callTimeoutMs(120_000, 256, 10), 1_000);
    assert.equal(callTimeoutMs(120_000, 16_384), modelCallTimeoutMs(120_000, 16_384), 'every other call is unchanged');
    assert.equal(callTimeoutMs(120_000, 256, Number.NaN), 120_000);
  });

  test('the processor is governed, bounded to one minute and never runs ungoverned', async () => {
    assert.equal(skillNeedAssessmentProcessor.governed, true);
    assert.equal(skillNeedAssessmentProcessor.maxRunMs, 60_000);
    assert.deepEqual(await skillNeedAssessmentProcessor.run(ctx), { type: 'PERMANENT_FAILURE', code: 'GOVERNANCE_REQUIRED' });
    void ('' as Id);
  });
});
