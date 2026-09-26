/**
 * C1-PROOF: product-decisions-d-c1-08-09
 *
 * Regression matrices for the two Product Owner approved C1 decisions (C1 canonical):
 *
 * D-C1-08 — cancel vs completion: the first durable canonical ordering governs the Work Item
 *   state; factual Run history is never falsified; ambiguous external effects stay
 *   RECONCILIATION_REQUIRED.
 * D-C1-09 — dependency satisfaction: work that does not require review satisfies dependents at
 *   COMPLETED (or later in the completed family); work that requires review — including R2+ risk
 *   policy — only at REVIEWED or later. Completed ≠ Reviewed. No OUTCOME_VERIFIED gating mode.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { COMPLETED_FAMILY, REVIEWED_FAMILY, WORK_ITEM_STATES, isQandeelError, satisfiesDependents, type Id } from '@qandeel-company/domain';

import { getWorkItemRow } from '../src/internal.js';
import { applyTransition, resolveDependents } from '../src/work-core.js';
import { storeContext } from '../src/store.js';
import { claimNext, interruptClaim, settle } from '../src/runtime-authority.js';
import { backoff, executable, harness, owner, type Harness } from './helpers.js';

const runEvidence = (h: Harness, runId: Id): string => String(storeContext(h.store).db.get<{ result_json: string }>('SELECT result_json FROM runs WHERE id = ?', runId)?.result_json);
const completions = (h: Harness, id: Id): number => h.store.history(id).filter((t) => t.toState === 'COMPLETED').length;

/**
 * C1 has no review authority (REVIEWED fails closed through every public path). To prove the gate
 * opens exactly at REVIEWED, this applies the committed REVIEWED transition — as the future C2
 * review engine will — through the same internal primitive and transaction shape the store uses.
 */
function commitReviewedForTest(h: Harness, id: Id): Id[] {
  const ctx = storeContext(h.store);
  return ctx.db.immediate('test: reviewed by the future review authority', () => {
    const current = getWorkItemRow(ctx, id);
    const item = applyTransition(ctx, current, 'REVIEWED', { reasonCode: 'review.accepted', trace: { correlationId: current.correlationId } });
    return resolveDependents(ctx, item.id, { correlationId: item.correlationId });
  });
}

describe('D-C1-08 — cancel vs completion (Product Owner approved)', () => {
  test('cancellation first: the item honours it and never resurrects; the finished run and its evidence stay truthful', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const c = claimNext(h.store, h.claimOpts());
      assert.ok(c);
      h.store.requestCancellation(id, { reasonCode: 'FOUNDER_STOP' });
      const out = settle(h.store, c.fence, { type: 'COMPLETED', evidence: { rows: 3 } }, { backoff });
      assert.equal(out.workItemState, 'CANCELLED');
      assert.equal(completions(h, id), 0, 'no COMPLETED transition is invented');
      const [run] = h.store.runsFor(c.job.id);
      assert.equal(run?.state, 'SUCCEEDED', 'the run did finish, and says so');
      assert.equal(runEvidence(h, c.fence.runId), JSON.stringify({ rows: 3 }), 'its evidence is kept');
      assert.throws(() => h.store.transitionWorkItem(id, { to: 'READY', reasonCode: 'resurrect' }), (e) => isQandeelError(e, 'TERMINAL_STATE'));
    } finally {
      h.close();
    }
  });

  test('supersession first: the item ends SUPERSEDED with its replacement link; the finished run stays truthful', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const c = claimNext(h.store, h.claimOpts());
      assert.ok(c);
      const replacement = h.store.createWorkItem({ objective: 'replacement', ownerRef: owner }).workItem.id;
      h.store.supersede(id, replacement, { reasonCode: 'REPLACED' });
      const out = settle(h.store, c.fence, { type: 'COMPLETED', evidence: { ok: true } }, { backoff });
      assert.equal(out.workItemState, 'SUPERSEDED');
      assert.equal(h.store.getWorkItem(id).supersededBy, replacement);
      assert.equal(completions(h, id), 0);
      assert.equal(h.store.runsFor(c.job.id)[0]?.state, 'SUCCEEDED');
    } finally {
      h.close();
    }
  });

  test('completion first: a later cancellation is refused and rewrites nothing', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const c = claimNext(h.store, h.claimOpts());
      assert.ok(c);
      settle(h.store, c.fence, { type: 'COMPLETED' }, { backoff });
      const before = h.store.history(id);
      assert.throws(() => h.store.requestCancellation(id, { reasonCode: 'LATE' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
      assert.equal(h.store.getWorkItem(id).state, 'COMPLETED');
      assert.equal(h.store.getWorkItem(id).terminationRequested, null);
      assert.deepEqual(h.store.history(id), before, 'history unchanged');
      assert.equal(h.store.jobsFor(id)[0]?.state, 'DONE');
    } finally {
      h.close();
    }
  });

  test('ambiguous external effect + earlier termination: never silently resolved; reconciliation stays first-class', () => {
    const h = harness();
    try {
      const id = executable(h.store, { processorKind: 'test.unsafe' });
      const c = claimNext(h.store, h.claimOpts());
      assert.ok(c);
      h.store.requestCancellation(id, { reasonCode: 'STOP' });
      const held = settle(h.store, c.fence, { type: 'COMPLETED', evidence: { sent: 1 } }, { backoff });
      assert.equal(held.jobState, 'RECONCILIATION_HOLD', 'neither cancel nor complete is chosen silently');
      assert.equal(h.store.getWorkItem(id).blockedReason, 'RECONCILIATION_REQUIRED');
      assert.equal(h.store.runsFor(c.job.id)[0]?.state, 'SUCCEEDED', 'the real run evidence is preserved');
      assert.equal(runEvidence(h, c.fence.runId), JSON.stringify({ sent: 1 }));
      // The operator confirms the effect did happen. Termination was durably first → it governs the item.
      const out = h.store.resolveReconciliation(c.job.id, 'CONFIRMED_COMPLETED', 'VERIFIED_EXTERNALLY', 'owner:founder');
      assert.equal(out.workItemState, 'CANCELLED');
      assert.equal(out.jobState, 'DONE', 'the confirmed effect stays on record: the job did its work');
      assert.equal(completions(h, id), 0);
      assert.equal(h.store.auditByAction('job.reconciliation_resolved')[0]?.details.decision, 'CONFIRMED_COMPLETED');
      assert.equal(h.store.auditByAction('work_item.termination_honoured').length, 1);
    } finally {
      h.close();
    }
  });

  test('ambiguous effect interrupted by a crash under termination intent is held, not cancelled, then honoured on any decision', () => {
    for (const decision of ['RETRY', 'FAILED', 'CONFIRMED_COMPLETED'] as const) {
      const h = harness();
      try {
        const id = executable(h.store, { processorKind: 'test.unsafe' });
        const c = claimNext(h.store, h.claimOpts('w', 500));
        assert.ok(c);
        h.store.requestCancellation(id, { reasonCode: 'STOP' });
        h.clock.advance(500);
        assert.equal(interruptClaim(h.store, h.supervisor, c.job.id, 'LEASE_EXPIRED')?.jobState, 'RECONCILIATION_HOLD');
        assert.equal(h.store.getWorkItem(id).state, 'BLOCKED');
        assert.equal(h.store.resolveReconciliation(c.job.id, decision, 'CHECKED', 'owner:founder').workItemState, 'CANCELLED', decision);
      } finally {
        h.close();
      }
    }
  });

  test('without termination intent, reconciliation decisions keep their meaning (confirmed → COMPLETED, failed → FAILED)', () => {
    for (const [decision, expected] of [['CONFIRMED_COMPLETED', 'COMPLETED'], ['FAILED', 'FAILED'], ['RETRY', 'READY']] as const) {
      const h = harness();
      try {
        const id = executable(h.store, { processorKind: 'test.unsafe' });
        const c = claimNext(h.store, h.claimOpts());
        assert.ok(c);
        settle(h.store, c.fence, { type: 'RECONCILIATION_REQUIRED', code: 'UNCERTAIN' }, { backoff });
        assert.equal(h.store.resolveReconciliation(c.job.id, decision, 'CHECKED', 'owner:founder').workItemState, expected);
        assert.equal(h.store.getWorkItem(id).state, expected);
      } finally {
        h.close();
      }
    }
  });

  test('a stale worker cannot overwrite the chosen canonical outcome', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const c = claimNext(h.store, h.claimOpts());
      assert.ok(c);
      h.store.requestCancellation(id, { reasonCode: 'STOP' });
      settle(h.store, c.fence, { type: 'CANCELLED' }, { backoff });
      assert.equal(h.store.getWorkItem(id).state, 'CANCELLED');
      for (const late of [{ type: 'COMPLETED' as const }, { type: 'RETRYABLE_FAILURE' as const, code: 'X' }, { type: 'PERMANENT_FAILURE' as const, code: 'X' }]) {
        assert.throws(() => settle(h.store, c.fence, late, { backoff }), (e) => isQandeelError(e, 'STALE_LEASE'));
      }
      assert.equal(h.store.getWorkItem(id).state, 'CANCELLED');
      assert.deepEqual(h.store.runsFor(c.job.id).map((r) => r.state), ['CANCELLED']);
    } finally {
      h.close();
    }
  });
});

describe('D-C1-09 — dependency satisfaction (Product Owner approved)', () => {
  test('the predicate: review-free work satisfies at COMPLETED or later; review-required work only at REVIEWED or later', () => {
    for (const state of WORK_ITEM_STATES) {
      assert.equal(satisfiesDependents({ state, reviewRequired: false }), COMPLETED_FAMILY.has(state), `no review, ${state}`);
      assert.equal(satisfiesDependents({ state, reviewRequired: true }), REVIEWED_FAMILY.has(state), `review required, ${state}`);
    }
    assert.deepEqual([...REVIEWED_FAMILY].sort(), ['CLOSED', 'OUTCOME_VERIFIED', 'REVIEWED'], 'no separate OUTCOME_VERIFIED gate: it is just a later REVIEWED-family state');
    for (const failed of ['FAILED', 'CANCELLED', 'SUPERSEDED'] as const) {
      assert.equal(satisfiesDependents({ state: failed, reviewRequired: false }), false);
      assert.equal(satisfiesDependents({ state: failed, reviewRequired: true }), false);
    }
  });

  test('no review required: A COMPLETED releases B', () => {
    const h = harness();
    try {
      const a = executable(h.store);
      const b = h.store.createWorkItem({ objective: 'b', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY', dependsOn: [a] }).workItem.id;
      assert.equal(h.store.getWorkItem(b).state, 'BLOCKED');
      const c = claimNext(h.store, h.claimOpts());
      assert.ok(c);
      assert.deepEqual(settle(h.store, c.fence, { type: 'COMPLETED' }, { backoff }).unblocked, [b]);
      assert.equal(h.store.getWorkItem(b).state, 'READY');
      assert.equal(h.store.jobsFor(b)[0]?.state, 'QUEUED');
    } finally {
      h.close();
    }
  });

  for (const [label, extra] of [
    ['review required', { reviewRequired: true }],
    ['R2 risk policy (review mandatory)', { riskLevel: 'R2' }],
  ] as const) {
    test(`${label}: A COMPLETED keeps B blocked; A REVIEWED releases B`, () => {
      const h = harness();
      try {
        const a = executable(h.store, extra);
        assert.equal(h.store.getWorkItem(a).reviewRequired, true);
        const b = h.store.createWorkItem({ objective: 'b', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY', dependsOn: [a] }).workItem.id;
        const c = claimNext(h.store, h.claimOpts());
        assert.ok(c);
        const out = settle(h.store, c.fence, { type: 'COMPLETED' }, { backoff });
        assert.equal(out.workItemState, 'WAITING_REVIEW');
        assert.deepEqual(out.unblocked, []);
        assert.equal(h.store.getWorkItem(b).state, 'BLOCKED', 'Completed ≠ Reviewed');
        assert.equal(h.store.jobsFor(b).length, 0, 'B is not releasable: no job');
        assert.equal(claimNext(h.store, h.claimOpts('w2')), null);
        // C1 itself cannot fake the review: the public path fails closed.
        assert.throws(() => h.store.transitionWorkItem(a, { to: 'REVIEWED', reasonCode: 'self-review' }), (e) => isQandeelError(e, 'REVIEW_PATH_UNAVAILABLE'));
        assert.equal(h.store.getWorkItem(b).state, 'BLOCKED');
        // Once the review authority commits REVIEWED, B is released in the same transaction.
        assert.deepEqual(commitReviewedForTest(h, a), [b]);
        assert.equal(h.store.getWorkItem(b).state, 'READY');
        assert.equal(h.store.jobsFor(b)[0]?.state, 'QUEUED');
      } finally {
        h.close();
      }
    });
  }

  for (const ending of ['FAILED', 'CANCELLED', 'SUPERSEDED'] as const) {
    test(`failure family: A ${ending} never releases B`, () => {
      const h = harness();
      try {
        const a = executable(h.store);
        const b = h.store.createWorkItem({ objective: 'b', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY', dependsOn: [a] }).workItem.id;
        if (ending === 'FAILED') {
          const c = claimNext(h.store, h.claimOpts());
          assert.ok(c);
          settle(h.store, c.fence, { type: 'PERMANENT_FAILURE', code: 'BROKEN' }, { backoff });
        } else if (ending === 'CANCELLED') {
          h.store.requestCancellation(a, { reasonCode: 'DROPPED' });
        } else {
          const replacement = h.store.createWorkItem({ objective: 'replacement', ownerRef: owner }).workItem.id;
          h.store.supersede(a, replacement, { reasonCode: 'REPLACED' });
        }
        assert.equal(h.store.getWorkItem(a).state, ending);
        const w = h.store.getWorkItem(b);
        assert.equal(w.state, 'BLOCKED');
        assert.equal(w.blockedReason, 'DEPENDENCY_FAILED');
        assert.equal(h.store.dependencies(b)[0]?.resolvedAt, null);
        assert.equal(h.store.jobsFor(b).length, 0);
      } finally {
        h.close();
      }
    });
  }
});
