/**
 * P1-CHAT-INTEL-01 — the pure vocabulary of Employee Intelligence and reply states: a level is offered only when the
 * server says AVAILABLE (an unknown or missing level is never offered), the fixed model reads as a person reads it, and
 * ended work is never shown as "writing".
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { humanize } from '../src/model/format.js';
import { isEndedReply, isLevel, LEVEL_THINKING, LEVELS, levelState, modelLabel, reasonText, REPLY_LABEL } from '../src/model/intelligence.js';

const intel = { model: { providerCode: 'deepseek', modelCode: 'deepseek-flash', publicName: 'DeepSeek-V4.1-Flash' }, levels: [{ reasoningClass: 'E1', availability: 'AVAILABLE' }, { reasoningClass: 'E2', availability: 'AVAILABLE' }, { reasoningClass: 'E3', availability: 'ABOVE_EMPLOYEE_CEILING' }, { reasoningClass: 'E4', availability: 'NOT_PROVISIONED' }] };

describe('P1-CHAT-INTEL-01: Employee Intelligence vocabulary', () => {
  test('the four Flash levels map to the four thinking settings', () => {
    assert.deepEqual(LEVELS.map((l) => LEVEL_THINKING[l]), ['Thinking off', 'Thinking low', 'Thinking high', 'Thinking max']);
    assert.equal(isLevel('E0'), false);
    assert.equal(isLevel('E4'), true);
  });
  test('a level is offered only when the server says AVAILABLE; a missing read offers nothing', () => {
    assert.deepEqual(LEVELS.map((l) => levelState(intel, l)), [{ available: true, code: 'AVAILABLE' }, { available: true, code: 'AVAILABLE' }, { available: false, code: 'ABOVE_EMPLOYEE_CEILING' }, { available: false, code: 'NOT_PROVISIONED' }]);
    assert.deepEqual(LEVELS.map((l) => levelState(null, l).available), [false, false, false, false]);
    assert.match(reasonText('ABOVE_EMPLOYEE_CEILING', humanize), /maximum/);
    assert.equal(reasonText('SOME_NEW_CODE', humanize), 'some new code', 'an unknown code is shown, never hidden');
  });
  test('the model is named as a person reads it, and only when provisioned', () => {
    assert.equal(modelLabel(intel), 'DeepSeek V4.1 Flash');
    assert.equal(modelLabel({ model: null }), 'No model provisioned');
  });
  test('ended replies are never "writing"', () => {
    for (const s of ['FAILED', 'BLOCKED', 'CANCELLED', 'REPLIED']) assert.equal(isEndedReply(s), true, s);
    for (const s of ['QUEUED', 'RUNNING', 'WAITING_FOR_BUDGET', 'WAITING']) assert.equal(isEndedReply(s), false, s);
    assert.equal(REPLY_LABEL.RUNNING, 'Writing a reply');
    assert.notEqual(REPLY_LABEL.FAILED, REPLY_LABEL.RUNNING);
  });
});
