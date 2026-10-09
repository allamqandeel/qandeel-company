/**
 * P1-REASON-AUTO-RECOVERY-01 — the Founder's reading of a reply's reasoning: who chose the starting level and why, and
 * what every further call was. An AUTO start or an escalation is never shown as the Founder's choice; AUTO is not a level.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AUTO_EXPLAINED, LEVEL_THINKING, REASON_LABEL, selectionSummary } from '../src/model/intelligence.js';

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
    assert.equal(held.chosen, `AUTO: E4 needed, ran at E2 (${REASON_LABEL.EMPLOYEE_CEILING ?? ''})`);
  });

  test('a Founder level is the Founder\'s; a same-level retry after the output limit is shown as such', () => {
    const s = selectionSummary({ requestedClass: 'E3', selection: { mode: 'MANUAL', startClass: 'E3', reasons: [] }, callDetails: [call('PRIMARY', 'E3', 'length'), call('RETRY', 'E3')] });
    assert.deepEqual([s.chosen, s.calls], ['E3 chosen by you', ['retried at the same level → E3']]);
  });

  test('AUTO is explained as a policy, not a fifth level; E1 is thinking off; the new failure and wait codes read in plain words', () => {
    assert.match(AUTO_EXPLAINED, /not a fifth level/);
    assert.match(AUTO_EXPLAINED, /no extra model call/);
    assert.equal(LEVEL_THINKING.E1, 'Thinking off');
    for (const code of ['MODEL_OUTPUT_TRUNCATED', 'PROVIDER_CIRCUIT_OPEN', 'REASONING_LEVEL_UNAVAILABLE']) assert.ok(REASON_LABEL[code], code);
  });
});
