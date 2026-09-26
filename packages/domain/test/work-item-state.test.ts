import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  TERMINAL_WORK_ITEM_STATES,
  WORK_ITEM_STATES,
  allowedTransitions,
  assertTransition,
  canTransition,
  initialState,
  isQandeelError,
  requiresReview,
  satisfiesDependents,
  type TransitionSubject,
  type WorkItemState,
} from '../src/index.js';

const subject = (state: WorkItemState, extra: Partial<TransitionSubject> = {}): TransitionSubject => ({
  state,
  reviewRequired: false,
  approvalRequired: false,
  riskLevel: 'R1',
  ...extra,
});

function walk(path: WorkItemState[], extra: Partial<TransitionSubject> = {}, outcome?: 'ACHIEVED' | 'NOT_ACHIEVED'): void {
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1] as WorkItemState;
    const to = path[i] as WorkItemState;
    const req = outcome !== undefined && to === 'OUTCOME_VERIFIED' ? { to, outcome } : { to };
    assert.doesNotThrow(() => assertTransition(subject(from, extra), req), `${from} -> ${to}`);
  }
}

describe('Work Item state machine', () => {
  test('represents every canonical Stage 8 concept as a distinct state', () => {
    for (const s of ['PROPOSED', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'WAITING_REVIEW', 'WAITING_APPROVAL', 'COMPLETED', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED', 'FAILED', 'CANCELLED', 'SUPERSEDED']) {
      assert.ok((WORK_ITEM_STATES as readonly string[]).includes(s), s);
    }
    assert.equal(new Set(WORK_ITEM_STATES).size, 15);
  });

  test('valid paths: full review + outcome path, and the short no-review path', () => {
    walk(['PROPOSED', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'WAITING_REVIEW', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'], { reviewRequired: true }, 'ACHIEVED');
    walk(['READY', 'IN_PROGRESS', 'WAITING', 'IN_PROGRESS', 'BLOCKED', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CLOSED']);
  });

  test('optional states are optional: no forced fake review, no false outcome verification', () => {
    assert.doesNotThrow(() => assertTransition(subject('COMPLETED'), { to: 'CLOSED' }));
    assert.throws(() => assertTransition(subject('COMPLETED', { reviewRequired: true }), { to: 'CLOSED' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
    assert.throws(() => assertTransition(subject('REVIEWED'), { to: 'OUTCOME_VERIFIED' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
    assert.throws(() => assertTransition(subject('REVIEWED'), { to: 'OUTCOME_VERIFIED', outcome: 'NOT_ACHIEVED' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
    // Competent execution whose outcome was not achieved closes as NOT_ACHIEVED (Stage 8 §34).
    assert.doesNotThrow(() => assertTransition(subject('REVIEWED'), { to: 'CLOSED', outcome: 'NOT_ACHIEVED' }));
    // Closing never converts activity into success: ACHIEVED only via OUTCOME_VERIFIED.
    for (const from of ['COMPLETED', 'REVIEWED', 'OUTCOME_VERIFIED'] as const) {
      assert.throws(() => assertTransition(subject(from), { to: 'CLOSED', outcome: 'ACHIEVED' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'), from);
    }
  });

  test('completed, reviewed and outcome verified are distinct and ordered', () => {
    assert.equal(canTransition('IN_PROGRESS', 'REVIEWED'), false);
    assert.equal(canTransition('IN_PROGRESS', 'OUTCOME_VERIFIED'), false);
    assert.equal(canTransition('COMPLETED', 'OUTCOME_VERIFIED'), false);
    assert.equal(canTransition('IN_PROGRESS', 'CLOSED'), false);
  });

  test('invalid skips fail deterministically with INVALID_TRANSITION', () => {
    for (const [from, to] of [['PROPOSED', 'IN_PROGRESS'], ['PROPOSED', 'COMPLETED'], ['READY', 'COMPLETED'], ['BLOCKED', 'IN_PROGRESS'], ['WAITING_REVIEW', 'CLOSED']] as const) {
      assert.throws(() => assertTransition(subject(from), { to }), (e) => isQandeelError(e, 'INVALID_TRANSITION') && e.details.from === from && e.details.to === to);
    }
  });

  test('terminal states accept no transition at all', () => {
    for (const t of TERMINAL_WORK_ITEM_STATES) {
      assert.deepEqual(allowedTransitions(t), []);
      for (const to of WORK_ITEM_STATES) assert.throws(() => assertTransition(subject(t), { to }), (e) => isQandeelError(e, 'TERMINAL_STATE'));
    }
  });

  test('cancellation applies before completion; supersession applies until closed', () => {
    for (const s of ['PROPOSED', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'WAITING_APPROVAL'] as const) {
      assert.ok(canTransition(s, 'CANCELLED'), s);
      assert.ok(canTransition(s, 'SUPERSEDED'), s);
    }
    for (const s of ['COMPLETED', 'WAITING_REVIEW', 'REVIEWED'] as const) {
      assert.equal(canTransition(s, 'CANCELLED'), false, s);
      assert.ok(canTransition(s, 'SUPERSEDED'), s);
    }
  });

  test('approval-gated work (explicit or R3/R4) fails closed: it can never be released in C1', () => {
    for (const extra of [{ approvalRequired: true }, { riskLevel: 'R3' as const }, { riskLevel: 'R4' as const }]) {
      assert.equal(initialState('READY', { approvalRequired: false, riskLevel: 'R1', ...extra }, false), 'WAITING_APPROVAL');
      assert.throws(() => assertTransition(subject('WAITING_APPROVAL', extra), { to: 'READY' }), (e) => isQandeelError(e, 'APPROVAL_PATH_UNAVAILABLE'));
      assert.throws(() => assertTransition(subject('PROPOSED', extra), { to: 'READY' }), (e) => isQandeelError(e, 'APPROVAL_PATH_UNAVAILABLE'));
      assert.doesNotThrow(() => assertTransition(subject('WAITING_APPROVAL', extra), { to: 'CANCELLED' }));
    }
    assert.equal(initialState('READY', { approvalRequired: false, riskLevel: 'R2' }, false), 'READY');
  });

  test('R2 and above require review; review-required work satisfies dependents only once reviewed', () => {
    assert.equal(requiresReview({ reviewRequired: false, riskLevel: 'R1' }), false);
    for (const riskLevel of ['R2', 'R3', 'R4'] as const) assert.equal(requiresReview({ reviewRequired: false, riskLevel }), true, riskLevel);
    assert.equal(satisfiesDependents({ state: 'COMPLETED', reviewRequired: false }), true);
    assert.equal(satisfiesDependents({ state: 'COMPLETED', reviewRequired: true }), false);
    assert.equal(satisfiesDependents({ state: 'WAITING_REVIEW', reviewRequired: true }), false);
    assert.equal(satisfiesDependents({ state: 'REVIEWED', reviewRequired: true }), true);
    assert.equal(satisfiesDependents({ state: 'IN_PROGRESS', reviewRequired: false }), false);
  });

  test('initial state honours unresolved dependencies and the PROPOSED default', () => {
    assert.equal(initialState('READY', { approvalRequired: false, riskLevel: 'R0' }, true), 'BLOCKED');
    assert.equal(initialState('PROPOSED', { approvalRequired: true, riskLevel: 'R4' }, true), 'PROPOSED');
  });

  test('outcome may only be recorded when verifying or closing', () => {
    assert.throws(() => assertTransition(subject('IN_PROGRESS'), { to: 'COMPLETED', outcome: 'ACHIEVED' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
  });

  test('exhaustive table check: canTransition agrees with assertTransition for ungated work', () => {
    for (const from of WORK_ITEM_STATES) {
      for (const to of WORK_ITEM_STATES) {
        if (to === 'OUTCOME_VERIFIED') continue; // additionally needs a verified outcome (tested above)
        let threw = false;
        try {
          assertTransition(subject(from), { to });
        } catch {
          threw = true;
        }
        assert.equal(!threw, canTransition(from, to), `${from} -> ${to}`);
      }
    }
  });
});
