/**
 * D-L1-24 — the answer-only execution fence of a BQM-2 benchmark observation, proven on the REAL employee loop with
 * scripted governed services: every service that could change Company state records any call, so a proof shows that a
 * wrong (but valid) proposal is never executed, the one same-class retry is shared with parser-invalid outputs, a second
 * failure ends the observation, and the declared two-call bound holds even across a resume. L1-02-PROOF: answer-only
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Id, JsonValue, ProcessorContext, ProcessorResult } from '@qandeel-company/domain';
import { ANSWER_ONLY_OUTPUT_INSTRUCTION_SHA256, OUTPUT_CONTRACT_CODES, PROPOSAL_TYPES, parseProposal, type ModelProposal } from '@qandeel-company/governance';
import { BQM2_DECLARATION } from '@qandeel-company/mind';

import { employeeTaskProcessor, type GovernedRunServices, type ModelCallOutcome } from '../../src/index.js';
import { EMPLOYEE_TASK_KIND } from '../../src/c2/employee-task.js';

/** The processor input a BQM-2 observation's Work Item carries (the store's `txCreateBenchmarkRun`). */
const BQM2_INPUT = { taskClass: 'skill.benchmark', dataClass: 'D1', instructions: 'Benchmark case. Answer the case below.', reasoningClass: 'E1', invalidOutputPolicy: 'SAME_CLASS_RETRY', answerOnly: true, maxModelCalls: 2 };

/** One valid instance of every non-ANSWER proposal type, each checked by the real parser. */
const WRONG: Record<string, Record<string, unknown>> = {
  FINAL: { type: 'FINAL', summaryCode: 'done' },
  TOOL_REQUEST: { type: 'TOOL_REQUEST', tool: 'notes', action: 'append', args: {} },
  MEMORY_CANDIDATE: { type: 'MEMORY_CANDIDATE', memoryClass: 'PERSONAL_LESSON', topic: 'ceo.benchmark-lesson', content: 'A lesson learned from this case.', confidencePct: 80 },
  OBSERVATION: { type: 'OBSERVATION', topic: 'ceo.benchmark-observation', content: 'Something observed in this case.' },
  ORG_ACTION: { type: 'ORG_ACTION', action: 'work.delegate', args: {} },
  REVIEW_DECISION: { type: 'REVIEW_DECISION', outcome: 'PASS', reasonCode: 'looks-fine' },
  MESSAGE: { type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'A message to the Founder.', brief: null, contextRefs: [] },
  GOAL_ACTION: { type: 'GOAL_ACTION', action: 'goal.derive', args: {} },
};
const ANSWER = { type: 'ANSWER', body: 'Recommendation, evidence and the decision needed.', decision: 'GATHER_EVIDENCE', reversible: true, authority: 'NEEDS_FOUNDER', evidence: 'PARTIAL', confidence: 'LOW', founderDecisionNeeded: true, spendMicros: 0 };
const parsed = (raw: Record<string, unknown>): ModelProposal => {
  const p = parseProposal(JSON.stringify(raw));
  assert.equal(p.type, raw.type, `the parser recognizes ${String(raw.type)} (a VALID proposal, not a parser failure)`);
  return p;
};
const NOT_JSON: ModelProposal = parseProposal('not json');

interface Trace {
  readonly calls: { reasoningClass: string | undefined; escalation: boolean }[];
  /** Every state-changing service the loop asked for (must stay empty under the fence). */
  readonly effects: string[];
  readonly diagnoses: { code: string; proposalType?: string; refusalCode?: string }[];
  readonly checkpoints: JsonValue[];
  result: ProcessorResult | null;
}

async function drive(outputs: ModelProposal[], opts: { input?: Record<string, unknown>; resumeFrom?: JsonValue; answerCode?: string } = {}): Promise<Trace> {
  const t: Trace = { calls: [], effects: [], diagnoses: [], checkpoints: [], result: null };
  const effect = <T>(name: string, value: T) => (): T => {
    t.effects.push(name);
    return value;
  };
  const ok = (proposal: ModelProposal): ModelCallOutcome => ({ kind: 'OK', proposal, usage: { inputTokens: 1, outputTokens: 1 }, deploymentId: 'd', reasoningClass: 'E1', attempts: 1, manifestId: 'm', maxOutputTokens: 512, finishReason: null, invalidReason: null });
  const services: GovernedRunServices = {
    context: { cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2' } } as unknown as GovernedRunServices['context'],
    invokeModel: (req) => {
      t.calls.push({ reasoningClass: req.reasoningClass, escalation: req.escalation !== undefined });
      const next = outputs.shift();
      return Promise.resolve(next === undefined ? { kind: 'UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE' } as unknown as ModelCallOutcome : ok(next));
    },
    proposeMemory: effect('proposeMemory', { kind: 'DECIDED', state: 'CANDIDATE', reasonCode: null } as unknown as ReturnType<GovernedRunServices['proposeMemory']>),
    executeTool: () => {
      t.effects.push('executeTool');
      return Promise.resolve({ kind: 'SUCCEEDED', result: {}, replayed: false } as unknown as Awaited<ReturnType<GovernedRunServices['executeTool']>>);
    },
    orgAct: effect('orgAct', { outcome: 'DONE', code: 'OK', after: 'CONTINUE', paused: false } as unknown as ReturnType<GovernedRunServices['orgAct']>),
    submitReviewDecision: effect('submitReviewDecision', { outcome: 'RECORDED', code: 'OK' } as unknown as ReturnType<GovernedRunServices['submitReviewDecision']>),
    openHandoffs: () => 0,
    clarificationsRequested: () => 0,
    refuseFinal: effect('refuseFinal', undefined),
    noteInvalidOutput: (_step, code, _cls, detail) => {
      t.diagnoses.push({ code, ...(detail?.proposalType !== undefined ? { proposalType: detail.proposalType } : {}), ...(detail?.refusalCode !== undefined ? { refusalCode: detail.refusalCode } : {}) });
    },
    sendMessage: effect('sendMessage', { outcome: 'RECORDED', code: 'OK', messageId: null } as unknown as ReturnType<GovernedRunServices['sendMessage']>),
    goalAct: effect('goalAct', { outcome: 'DONE', code: 'OK', resultRef: null } as unknown as ReturnType<GovernedRunServices['goalAct']>),
    recordAnswer: () => {
      t.effects.push('recordAnswer');
      const code = opts.answerCode ?? 'RECORDED';
      return (code === 'RECORDED' ? { outcome: 'RECORDED', code, answerId: 'a' } : { outcome: 'REFUSED', code, answerId: null }) as unknown as ReturnType<GovernedRunServices['recordAnswer']>;
    },
  };
  const ctx: ProcessorContext = {
    workItemId: 'w' as Id,
    rootWorkItemId: 'w' as Id,
    jobId: 'j' as Id,
    runId: 'r' as Id,
    attempt: 1,
    correlationId: 'c' as Id,
    processorKind: EMPLOYEE_TASK_KIND,
    input: (opts.input ?? BQM2_INPUT) as unknown as JsonValue,
    resumeFrom: opts.resumeFrom === undefined ? null : ({ kind: 'employee-loop', state: opts.resumeFrom } as unknown as ProcessorContext['resumeFrom']),
    signal: new AbortController().signal,
    checkpoint: (_kind, state) => {
      t.checkpoints.push(state);
      return Promise.resolve();
    },
    putArtifact: () => Promise.reject(new Error('not used')),
  };
  t.result = await employeeTaskProcessor.runGoverned(ctx, services);
  return t;
}

const failedCode = (r: ProcessorResult | null): string | null => (r !== null && r.type === 'PERMANENT_FAILURE' ? r.code : null);

describe('D-L1-24: a BQM-2 observation is answer-only — a wrong valid proposal is never executed, the bound is two calls', () => {
  test('the declaration states the answer-only fence, the shared failure count and the two-call bound; the diagnostic codes are closed and distinct from the parser codes', () => {
    assert.deepEqual(BQM2_DECLARATION.deliverable, { only: 'ANSWER', otherValidProposal: 'OUTPUT_FAILURE_NEVER_EXECUTED', maxModelCallsPerObservation: 2, genericProposalMenu: 'NOT_RENDERED', outputInstructionSha256: ANSWER_ONLY_OUTPUT_INSTRUCTION_SHA256 });
    assert.deepEqual(BQM2_DECLARATION.invalidOutput.counts, ['NOT_JSON', 'UNKNOWN_TYPE', 'MALFORMED', 'WRONG_PROPOSAL_TYPE', 'ANSWER_REFUSED']);
    assert.deepEqual(OUTPUT_CONTRACT_CODES, ['WRONG_PROPOSAL_TYPE', 'ANSWER_REFUSED']);
    assert.deepEqual(Object.keys(WRONG).sort(), PROPOSAL_TYPES.filter((p) => p !== 'ANSWER').sort(), 'every non-ANSWER proposal type is proven');
  });

  test('1 — a valid FINAL first: never a completion, never VOID; the same-class E1 retry answers; exactly two calls', async () => {
    const t = await drive([parsed(WRONG.FINAL ?? {}), parsed(ANSWER)]);
    assert.equal(t.result?.type, 'COMPLETED');
    assert.equal((t.result as { evidence?: { summaryCode?: string } }).evidence?.summaryCode, 'answer.recorded', 'it completed on the ANSWER, not on the FINAL');
    assert.deepEqual(t.calls, [{ reasoningClass: 'E1', escalation: false }, { reasoningClass: 'E1', escalation: false }]);
    assert.deepEqual(t.diagnoses, [{ code: 'WRONG_PROPOSAL_TYPE', proposalType: 'FINAL' }], 'diagnosed truthfully: the parser recognized it');
    assert.deepEqual(t.effects, ['recordAnswer']);
  });

  test('2 — two valid FINALs: the observation FAILS (MODEL_OUTPUT_INVALID, scored as a FAILED observation), exactly two E1 calls', async () => {
    const t = await drive([parsed(WRONG.FINAL ?? {}), parsed(WRONG.FINAL ?? {})]);
    assert.equal(failedCode(t.result), 'MODEL_OUTPUT_INVALID');
    assert.equal(t.calls.length, 2);
    assert.ok(t.calls.every((c) => c.reasoningClass === 'E1' && !c.escalation), 'never E2');
    assert.deepEqual(t.effects, []);
  });

  test('3 — MEMORY_CANDIDATE then ANSWER: no candidate is ever submitted (no memory, no lesson); the retry answers; two calls', async () => {
    const t = await drive([parsed(WRONG.MEMORY_CANDIDATE ?? {}), parsed(ANSWER)]);
    assert.equal(t.result?.type, 'COMPLETED');
    assert.equal(t.calls.length, 2);
    assert.ok(!t.effects.includes('proposeMemory'));
    assert.deepEqual(t.diagnoses, [{ code: 'WRONG_PROPOSAL_TYPE', proposalType: 'MEMORY_CANDIDATE' }]);
  });

  test('4 — MEMORY_CANDIDATE then OBSERVATION: a FAILED observation with zero learning side effects', async () => {
    const t = await drive([parsed(WRONG.MEMORY_CANDIDATE ?? {}), parsed(WRONG.OBSERVATION ?? {})]);
    assert.equal(failedCode(t.result), 'MODEL_OUTPUT_INVALID');
    assert.deepEqual(t.effects, [], 'no memory candidate, observation or any other effect');
    assert.deepEqual(t.diagnoses.map((d) => d.proposalType), ['MEMORY_CANDIDATE', 'OBSERVATION']);
  });

  test('5 — every other valid wrong deliverable (tool, organizational act, review, Founder message, goal act) has no effect and counts through the same policy', async () => {
    for (const first of Object.keys(WRONG)) {
      for (const second of Object.keys(WRONG)) {
        const t = await drive([parsed(WRONG[first] ?? {}), parsed(WRONG[second] ?? {})]);
        assert.equal(failedCode(t.result), 'MODEL_OUTPUT_INVALID', `${first} → ${second}`);
        assert.deepEqual(t.effects, [], `${first} → ${second}: nothing executed`);
        assert.equal(t.calls.length, 2, `${first} → ${second}: two calls`);
        assert.ok(t.calls.every((c) => c.reasoningClass === 'E1' && !c.escalation));
      }
      // One wrong proposal and one parser-invalid output share the same single retry (either order).
      for (const pair of [[parsed(WRONG[first] ?? {}), NOT_JSON], [NOT_JSON, parsed(WRONG[first] ?? {})]]) {
        const t = await drive(pair);
        assert.equal(failedCode(t.result), 'MODEL_OUTPUT_INVALID');
        assert.equal(t.calls.length, 2);
        assert.deepEqual(t.effects, []);
      }
    }
  });

  test('an ANSWER refused for its own content takes the retry (ANSWER_REFUSED); any other refusal ends the item — never a third call', async () => {
    const refused = await drive([parsed(ANSWER), parsed(ANSWER)], { answerCode: 'SECRET_MATERIAL' });
    assert.equal(failedCode(refused.result), 'MODEL_OUTPUT_INVALID');
    assert.equal(refused.calls.length, 2);
    assert.deepEqual(refused.diagnoses, [{ code: 'ANSWER_REFUSED', refusalCode: 'SECRET_MATERIAL' }, { code: 'ANSWER_REFUSED', refusalCode: 'SECRET_MATERIAL' }]);
    const closed = await drive([parsed(ANSWER), parsed(ANSWER)], { answerCode: 'ANSWER_CLOSED' });
    assert.equal(failedCode(closed.result), 'INVALID_TASK_INPUT', 'a refusal the model did not cause is not an output failure (and is never infrastructure)');
    assert.equal(closed.calls.length, 1);
  });

  test('7 — the two-call bound is an invariant: a resume never earns a fresh retry, and a resumed item at its bound makes no call', async () => {
    const first = await drive([parsed(WRONG.FINAL ?? {})]).catch(() => null);
    // The first failure is checkpointed with its count (the scripted provider then has no answer: the run stops there).
    const saved = first?.checkpoints.at(-1) as { invalid?: number; modelCalls?: number } | undefined;
    assert.deepEqual([saved?.invalid, saved?.modelCalls], [1, 1]);
    const resumed = await drive([parsed(WRONG.OBSERVATION ?? {})], { resumeFrom: saved as unknown as JsonValue });
    assert.equal(failedCode(resumed.result), 'MODEL_OUTPUT_INVALID', 'the resumed run has the one remaining call only');
    assert.equal(resumed.calls.length, 1);
    const atBound = await drive([parsed(ANSWER)], { resumeFrom: { turn: 0, phase: 'MODEL', pending: null, modelCalls: 2, invalid: 0 } as unknown as JsonValue });
    assert.equal(failedCode(atBound.result), 'RUN_LIMIT');
    assert.equal(atBound.calls.length, 0, 'no third call');
  });

  test('8 — BQM-1 / ordinary Work Items are unchanged: FINAL completes, a memory candidate is submitted, an invalid output escalates once', async () => {
    const plain = { taskClass: 'skill.benchmark', dataClass: 'D1', instructions: 'Benchmark case.' };
    const fin = await drive([parsed(WRONG.FINAL ?? {})], { input: plain });
    assert.equal(fin.result?.type, 'COMPLETED');
    const mem = await drive([parsed(WRONG.MEMORY_CANDIDATE ?? {}), parsed(ANSWER)], { input: plain });
    assert.deepEqual(mem.effects, ['proposeMemory', 'recordAnswer']);
    const inv = await drive([NOT_JSON, parsed(ANSWER)], { input: plain });
    assert.equal(inv.result?.type, 'COMPLETED');
    assert.deepEqual(inv.calls.map((c) => c.escalation), [false, true], 'BQM-1 keeps its one evidence-based escalation');
    assert.deepEqual(inv.checkpoints.length, 1, 'and checkpoints exactly as before (only the answer)');
  });
});
