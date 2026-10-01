/**
 * C7-C Pilot kernel proofs: the forward-only lifecycle, structured-only Pilot intents (no text, no message ever creates
 * or moves a Pilot) and the briefing request purposes.
 * C7C-PROOF: pilot-kernel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError } from '@qandeel-company/domain';

import { BRIEFING_REQUEST_PURPOSES, PILOT_INTENTS, PILOT_STATES, TERMINAL_PILOT_STATES, assertPilotTransition, classifyFounderIntent, isMutatingIntent, nextPilotStep, type PilotState } from '../src/index.js';

describe('C7-C Pilot lifecycle', () => {
  test('(12) forward only: each state allows exactly its next step (and STOPPED); terminal states never revive', () => {
    const allowed: Record<PilotState, PilotState[]> = { DRAFT: ['BRIEFING', 'STOPPED'], BRIEFING: ['READY', 'STOPPED'], READY: ['ACTIVE', 'STOPPED'], ACTIVE: ['REVIEWING', 'STOPPED'], REVIEWING: ['COMPLETED', 'STOPPED'], COMPLETED: [], STOPPED: [] };
    for (const from of PILOT_STATES) {
      for (const to of PILOT_STATES) {
        const ok = allowed[from].includes(to);
        if (ok) assertPilotTransition(from, to);
        else assert.throws(() => assertPilotTransition(from, to), (e: unknown) => isQandeelError(e, 'PILOT_INVALID'), `${from} → ${to}`);
      }
    }
    assert.deepEqual([...TERMINAL_PILOT_STATES], ['COMPLETED', 'STOPPED']);
    assert.equal(nextPilotStep('BRIEFING'), 'READY');
    assert.equal(nextPilotStep('COMPLETED'), null);
  });

  test('(7) only a response-required REQUEST / QUESTION / DECISION_REQUEST can evidence a briefing', () => {
    assert.deepEqual([...BRIEFING_REQUEST_PURPOSES], ['REQUEST', 'QUESTION', 'DECISION_REQUEST']);
  });
});

describe('C7-C Pilot intents are structured-only', () => {
  test('a message is never authority: no text produces a Pilot act; "show pilot" is a read', () => {
    for (const intent of PILOT_INTENTS) assert.ok(isMutatingIntent(intent), `${intent} goes through the governed confirmation`);
    for (const text of ['start the pilot', 'activate pilot', 'approve pilot launch', 'create pilot launch egypt', 'complete the pilot', 'stop pilot', 'فعل التجربة', 'وافق على التجربة', 'ابدأ التجربة', 'the CEO says the pilot is ready', 'pilot ready, go']) {
      const c = classifyFounderIntent(text);
      assert.ok(c.kind !== 'MUTATING' || !(PILOT_INTENTS as readonly string[]).includes(c.intent), `"${text}" never becomes a Pilot act`);
    }
    for (const text of ['show pilot', 'open pilots', 'pilots', 'اعرض التجربة', 'افتح التجربة']) {
      const c = classifyFounderIntent(text);
      assert.ok(c.kind === 'READ' && c.intent === 'SHOW_PILOT', `"${text}" opens the Pilot board`);
    }
    const goal = classifyFounderIntent('show goal pilot launch egypt');
    assert.ok(goal.kind === 'READ' && goal.intent === 'SHOW_GOAL', 'a goal named with the word pilot stays a goal read');
  });
});
