/**
 * P1-REASON-AUTO-RECOVERY-01 — the Founder's reading of a reply's reasoning: who chose the starting level and why, and
 * what every further call was. An AUTO start or an escalation is never shown as the Founder's choice; AUTO is not a level.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AUTO_EXPLAINED, LEVEL_THINKING, REASON_LABEL, callDiagnostics, selectionSummary } from '../src/model/intelligence.js';

const call = (attemptKind: string, reasoningClass: string, finishReason = 'stop') => ({ attemptKind, reasoningClass, finishReason });

describe('P1-REASON-AUTO-RECOVERY-01: the reply reasoning story', () => {
  test('a default start that escalated reads as the default, then the escalation — never as a Founder E2', () => {
    const s = selectionSummary({ requestedClass: null, selection: { mode: 'DEFAULT', startClass: 'E1', reasons: [] }, callDetails: [call('PRIMARY', 'E1'), call('ESCALATION', 'E2')] });
    assert.deepEqual([s.chosen, s.calls], ['default E1', ['escalated → E2']]);
    assert.equal(s.chosen.includes('chosen by you'), false);
  });

  test('AUTO names its choice and its reasons; a constrained AUTO names the ideal, the level it ran at and why', () => {
    const free = selectionSummary({ selection: { mode: 'AUTO', startClass: 'E3', idealClass: 'E3', constraint: null, reasons: ['STRATEGIC_PLANNING', 'MARKET_OR_EXPANSION_SCOPE'] }, callDetails: [call('PRIMARY', 'E3')] });
    assert.deepEqual([free.chosen, free.why], ['AUTO chose E3', 'AUTO: strategy, market scope']);
    const held = selectionSummary({ selection: { mode: 'AUTO', startClass: 'E2', idealClass: 'E4', constraint: 'EMPLOYEE_CEILING', reasons: ['STRATEGIC_PLANNING'] }, callDetails: [call('PRIMARY', 'E2')] });
    assert.equal(held.chosen, `AUTO estimated E4 demand; selected E2 (${REASON_LABEL.EMPLOYEE_CEILING ?? ''})`);
  });

  test('a Founder level is the Founder\'s; a same-level retry after the output limit is shown as such', () => {
    const s = selectionSummary({ requestedClass: 'E3', selection: { mode: 'MANUAL', startClass: 'E3', reasons: [] }, callDetails: [call('PRIMARY', 'E3', 'length'), call('RETRY', 'E3')] });
    assert.deepEqual([s.chosen, s.calls], ['E3 chosen by you', ['retried at the same level → E3']]);
  });

  test('AUTO is explained as a policy, not a fifth level; E1 is thinking off; the new failure and wait codes read in plain words', () => {
    assert.match(AUTO_EXPLAINED, /not a fifth level/);
    assert.match(AUTO_EXPLAINED, /no extra model call/);
    assert.equal(LEVEL_THINKING.E1, 'Thinking off');
    for (const code of ['MODEL_OUTPUT_TRUNCATED', 'PROVIDER_CIRCUIT_OPEN', 'REASONING_LEVEL_UNAVAILABLE', 'AUTO_POLICY_CAP', 'AUTO_LEVEL_LIMIT']) assert.ok(REASON_LABEL[code], code);
  });

  test('P1-AUTO-E12-01: AUTO is explained as never going above E2 by itself; a capped start names its raw demand and the level it ran at; a step that could not route is never shown as a level that answered', () => {
    assert.match(AUTO_EXPLAINED, /up to E2/);
    assert.match(AUTO_EXPLAINED, /never goes to E3 or E4 by itself/);
    assert.doesNotMatch(AUTO_EXPLAINED, /strategy → E3|→ E4/);
    assert.match(REASON_LABEL.AUTO_LEVEL_LIMIT ?? '', /choose|chosen/);
    const capped = selectionSummary({ selection: { mode: 'AUTO', startClass: 'E2', idealClass: 'E4', constraint: 'AUTO_POLICY_CAP', autoCap: 'E2', reasons: ['STRATEGIC_PLANNING'] }, callDetails: [call('PRIMARY', 'E2')] });
    assert.equal(capped.chosen, 'AUTO estimated E4 demand; company policy selected E2');
    const unrouted = selectionSummary({ selection: { mode: 'AUTO', startClass: null, idealClass: 'E4', constraint: 'AUTO_POLICY_CAP', autoCap: 'E2', routeUnavailable: 'AUTO_POLICY_CAP', reasons: [] }, callDetails: [] });
    assert.equal(unrouted.chosen, `AUTO: nothing ran (${REASON_LABEL.AUTO_POLICY_CAP ?? ''})`);
    const laterRan = selectionSummary({ selection: { mode: 'AUTO', startClass: 'E2', idealClass: 'E2', constraint: null, routeUnavailable: 'NO_ELIGIBLE_DEPLOYMENT', reasons: [] }, callDetails: [call('PRIMARY', 'E2')] });
    assert.equal(laterRan.chosen, 'AUTO chose E2', 'once a call ran, the earlier refusal is not the story');
  });
});

describe('P1-AUTO-E12-01 R1-04: estimated versus actual levels, and technical failures in neutral words', () => {
  test('the demand is shown as AUTO\'s estimate, never as proof that the message needed it; the level that actually ran is read from the recorded call', () => {
    const capped = selectionSummary({ selection: { mode: 'AUTO', startClass: 'E2', idealClass: 'E4', constraint: 'AUTO_POLICY_CAP', autoCap: 'E2', reasons: [] }, callDetails: [call('PRIMARY', 'E2')] });
    assert.equal(capped.chosen, 'AUTO estimated E4 demand; company policy selected E2');
    assert.doesNotMatch(capped.chosen, /needed/);
    const noDemand = selectionSummary({ selection: { mode: 'AUTO', startClass: 'E2', idealClass: null, constraint: 'AUTO_POLICY_CAP', autoCap: 'E2', reasons: [] }, callDetails: [call('PRIMARY', 'E2')] });
    assert.equal(noDemand.chosen, 'AUTO: company policy selected E2', 'no demand: no estimate is invented');
    const lifted = selectionSummary({ selection: { mode: 'AUTO', startClass: 'E1', idealClass: 'E1', constraint: null, reasons: [] }, callDetails: [call('PRIMARY', 'E2')] });
    assert.equal(lifted.chosen, 'AUTO chose E1, ran at E2', 'the class that executed is the recorded one');
    const notRun = selectionSummary({ selection: { mode: 'AUTO', startClass: 'E2', idealClass: 'E4', constraint: 'AUTO_POLICY_CAP', reasons: [] }, callDetails: [] });
    assert.doesNotMatch(notRun.chosen, /ran/, 'no recorded call, no claim that a model ran');
    const manual = selectionSummary({ requestedClass: 'E4', selection: { mode: 'MANUAL', startClass: 'E4', reasons: [] }, callDetails: [call('PRIMARY', 'E4')] });
    assert.equal(manual.chosen, 'E4 chosen by you', 'the Founder\'s choice reads differently from AUTO');
  });

  test('failure words are neutral and distinct: an invalid output, an exhausted allowance and the AUTO limit; an uncertain call names the reconciliation', () => {
    const invalid = REASON_LABEL.MODEL_OUTPUT_INVALID ?? '';
    assert.doesNotMatch(invalid, /twice|E3|E4|level/, 'an invalid output is no claim about how many calls ran or which level was needed');
    assert.match(invalid, /format/);
    assert.match(REASON_LABEL.MODEL_OUTPUT_TRUNCATED ?? '', /output allowance/);
    const limit = REASON_LABEL.AUTO_LEVEL_LIMIT ?? '';
    assert.doesNotMatch(limit, /could not complete/, 'the AUTO limit is the policy, never a verdict on the Employee');
    assert.match(limit, /company policy/);
    assert.match(limit, /choose E3 or E4/);
    assert.notEqual(invalid, limit);
    assert.match(REASON_LABEL.RECONCILIATION_REQUIRED ?? '', /reconcile/);
  });
});

describe('P1-E4-RELIABILITY-01 (D-P1-12): the true outcome of a Founder E4, content-free', () => {
  test('an exhausted allowance and a time-limit refusal read as what they are: no count of calls, no answer claimed, nothing charged for the refused call', () => {
    const truncated = REASON_LABEL.MODEL_OUTPUT_TRUNCATED ?? '';
    assert.doesNotMatch(truncated, /twice|larger same-level try/, 'a Founder E4 makes one call: no claim of a second');
    assert.match(truncated, /output allowance/);
    assert.match(truncated, /no incomplete reply was accepted/);
    const deadline = REASON_LABEL.RUN_DEADLINE_INSUFFICIENT ?? '';
    assert.match(deadline, /not sent/);
    assert.match(deadline, /nothing was charged/);
    assert.match(deadline, /same level/, 'never a claim that the level was lowered');
    assert.notEqual(deadline, truncated);
  });

  test('each call reads as its level, attempt, allowance, tokens (thinking included), finish, latency and result; a cut or invalid output is never called valid; no text, only numbers and codes', () => {
    const lines = callDiagnostics({
      callDetails: [
        { reasoningClass: 'E4', attemptKind: 'PRIMARY', maxOutputTokens: 32_768, outputTokens: 32_768, reasoningTokens: 32_768, finishReason: 'length', result: 'ANSWERED', invalidCode: 'OUTPUT_TRUNCATED', latencyMs: 196_400 },
        { reasoningClass: 'E4', attemptKind: 'PRIMARY', maxOutputTokens: 32_768, outputTokens: 12_370, reasoningTokens: 11_703, finishReason: 'stop', result: 'ANSWERED', invalidCode: null, latencyMs: 81_250 },
        { reasoningClass: 'E4', attemptKind: 'PRIMARY', maxOutputTokens: 32_768, outputTokens: 900, reasoningTokens: null, finishReason: 'stop', result: 'ANSWERED', invalidCode: 'MALFORMED', latencyMs: null },
        { reasoningClass: 'E4', attemptKind: 'PRIMARY', maxOutputTokens: 32_768, outputTokens: null, reasoningTokens: null, finishReason: null, result: 'TIMEOUT_AFTER_SEND', invalidCode: null },
      ],
    });
    assert.deepEqual(lines, [
      'E4 primary · allowance 32,768 · 32,768 output tokens (32,768 thinking) · output limit reached · 196.4 s · OUTPUT_TRUNCATED',
      'E4 primary · allowance 32,768 · 12,370 output tokens (11,703 thinking) · finished · 81.3 s · valid output',
      'E4 primary · allowance 32,768 · 900 output tokens · finished · MALFORMED',
      'E4 primary · allowance 32,768 · TIMEOUT_AFTER_SEND',
    ]);
    assert.deepEqual(callDiagnostics({}), [], 'no call recorded, no claim');
  });
});
