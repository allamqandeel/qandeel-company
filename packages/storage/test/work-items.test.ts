import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Id } from '@qandeel-company/domain';

import { storeContext } from '../src/store.js';
import { backoff, claimOpts, executable, harness, owner } from './helpers.js';

describe('Work Item creation', () => {
  test('stores Stage 8 fields durably with opaque references and an initial history row', () => {
    const h = harness();
    try {
      const { workItem, enqueuedJobId } = h.store.createWorkItem({
        objective: 'حلل سوق مصر لتطبيق قنديل',
        ownerRef: owner,
        contributors: ['employee:e-1', 'employee:e-2'],
        priority: 80,
        dueAt: '2026-10-01T00:00:00.000Z',
        riskLevel: 'R2',
        completionCriteria: { summary: 'market sizing' },
        requiredEvidence: ['sources'],
        reviewRequired: true,
        processorKind: 'test.noop',
        initialState: 'READY',
      });
      assert.equal(workItem.state, 'READY');
      assert.equal(workItem.version, 1);
      assert.equal(workItem.rootId, workItem.id);
      assert.equal(workItem.outcome, 'NOT_ASSESSED');
      assert.deepEqual(workItem.contributors, ['employee:e-1', 'employee:e-2']);
      assert.ok(enqueuedJobId);
      assert.deepEqual(h.store.history(workItem.id).map((t) => [t.fromState, t.toState, t.version]), [[null, 'READY', 1]]);
      assert.equal(h.store.events(workItem.id)[0]?.type, 'work_item.created');
    } finally {
      h.close();
    }
  });

  test('validation fails deterministically before anything is written', () => {
    const h = harness();
    try {
      for (const bad of [{ objective: '', ownerRef: owner }, { objective: 'x', ownerRef: 'nobody' }, { objective: 'x', ownerRef: owner, priority: 101 }, { objective: 'x', ownerRef: owner, processorInput: { apiKey: 'k' } }]) {
        assert.throws(() => h.store.createWorkItem(bad), (e) => isQandeelError(e, 'VALIDATION_FAILED'));
      }
      assert.equal(h.store.healthCounts().workItems.PROPOSED, undefined);
    } finally {
      h.close();
    }
  });

  test('idempotency: same key + same input replays; same key + different input conflicts', () => {
    const h = harness();
    try {
      const input = { objective: 'publish plan', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY' as const };
      const first = h.store.createWorkItem(input, { idempotencyKey: 'req-1' });
      const replay = h.store.createWorkItem({ ...input }, { idempotencyKey: 'req-1' });
      assert.equal(replay.replayed, true);
      assert.equal(replay.workItem.id, first.workItem.id);
      assert.equal(h.store.jobsFor(first.workItem.id).length, 1, 'one canonical operation, one job');
      assert.throws(() => h.store.createWorkItem({ ...input, objective: 'different' }, { idempotencyKey: 'req-1' }), (e) => isQandeelError(e, 'IDEMPOTENCY_CONFLICT'));
      assert.equal(h.store.auditByAction('idempotency.conflict').length, 1);
    } finally {
      h.close();
    }
  });

  test('deterministic dedupe key: one live item per key, reusable after it ends', () => {
    const h = harness();
    try {
      const a = h.store.createWorkItem({ objective: 'weekly SEO check', ownerRef: owner, dedupeKey: 'seo:weekly:2026-39' }).workItem;
      assert.throws(() => h.store.createWorkItem({ objective: 'again', ownerRef: owner, dedupeKey: 'seo:weekly:2026-39' }), (e) => isQandeelError(e, 'DEDUPE_CONFLICT') && e.details.existing === a.id);
      h.store.requestCancellation(a.id, { reasonCode: 'NOT_NEEDED' });
      assert.doesNotThrow(() => h.store.createWorkItem({ objective: 'again', ownerRef: owner, dedupeKey: 'seo:weekly:2026-39' }));
    } finally {
      h.close();
    }
  });

  test('approval-gated work (R3) is recorded but fails closed: never queued, never releasable', () => {
    const h = harness();
    try {
      const { workItem, enqueuedJobId } = h.store.createWorkItem({ objective: 'publish campaign', ownerRef: owner, riskLevel: 'R3', processorKind: 'test.noop', initialState: 'READY' });
      assert.equal(workItem.state, 'WAITING_APPROVAL');
      assert.equal(enqueuedJobId, null);
      assert.throws(() => h.store.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'try' }), (e) => isQandeelError(e, 'APPROVAL_PATH_UNAVAILABLE'));
    } finally {
      h.close();
    }
  });
});

describe('Work Item lifecycle and history', () => {
  test('manual transitions increment the version, record history and respect optimistic versions', () => {
    const h = harness();
    try {
      const id = h.store.createWorkItem({ objective: 'x', ownerRef: owner }).workItem.id;
      const ready = h.store.transitionWorkItem(id, { to: 'READY', reasonCode: 'released', actorRef: 'owner:founder', expectedVersion: 1 });
      assert.equal(ready.version, 2);
      assert.throws(() => h.store.transitionWorkItem(id, { to: 'ASSIGNED', reasonCode: 'x', expectedVersion: 1 }), (e) => isQandeelError(e, 'VERSION_CONFLICT'));
      assert.throws(() => h.store.transitionWorkItem(id, { to: 'COMPLETED' as never, reasonCode: 'x' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
      assert.throws(() => h.store.transitionWorkItem(id, { to: 'CANCELLED' as never, reasonCode: 'x' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
      assert.deepEqual(h.store.history(id).map((t) => t.toState), ['PROPOSED', 'READY']);
      assert.equal(h.store.history(id)[1]?.actorRef, 'owner:founder');
    } finally {
      h.close();
    }
  });

  test('review-required work waits for review, and C1 cannot fake one: REVIEWED fails closed (no reviewer authority)', () => {
    const h = harness();
    try {
      const id = executable(h.store, { reviewRequired: true });
      const claim = h.store.claimNext(claimOpts());
      assert.ok(claim);
      h.store.settle(claim.fence, { type: 'COMPLETED', evidence: { rows: 3 } }, { backoff });
      assert.equal(h.store.getWorkItem(id).state, 'WAITING_REVIEW', 'review-required work is not "done"');
      assert.throws(() => h.store.transitionWorkItem(id, { to: 'CLOSED', reasonCode: 'skip' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
      assert.throws(() => h.store.transitionWorkItem(id, { to: 'REVIEWED', reasonCode: 'self.review', actorRef: owner }), (e) => isQandeelError(e, 'REVIEW_PATH_UNAVAILABLE'));
      assert.throws(() => h.store.transitionWorkItem(id, { to: 'OUTCOME_VERIFIED', reasonCode: 'x', outcome: 'ACHIEVED' }), (e) => isQandeelError(e, 'REVIEW_PATH_UNAVAILABLE'));
      // Rework remains possible: the reviewer path returns work to execution.
      assert.equal(h.store.transitionWorkItem(id, { to: 'READY', reasonCode: 'rework' }).state, 'READY');
      assert.deepEqual(h.store.history(id).map((t) => t.toState), ['READY', 'IN_PROGRESS', 'COMPLETED', 'WAITING_REVIEW', 'READY']);
    } finally {
      h.close();
    }
  });

  test('R2+ work always requires review (Stage 3 §2/§4); R1 does not unless asked', () => {
    const h = harness();
    try {
      assert.equal(h.store.createWorkItem({ objective: 'x', ownerRef: owner, riskLevel: 'R2' }).workItem.reviewRequired, true);
      assert.equal(h.store.createWorkItem({ objective: 'x', ownerRef: owner, riskLevel: 'R1' }).workItem.reviewRequired, false);
    } finally {
      h.close();
    }
  });

  test('closing never records success: ACHIEVED only through OUTCOME_VERIFIED (code and database)', () => {
    const h = harness();
    try {
      const id = executable(h.store);
      const claim = h.store.claimNext(claimOpts());
      assert.ok(claim);
      h.store.settle(claim.fence, { type: 'COMPLETED' }, { backoff });
      assert.throws(() => h.store.transitionWorkItem(id, { to: 'CLOSED', reasonCode: 'x', outcome: 'ACHIEVED' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
      const { db } = storeContext(h.store);
      assert.throws(() => db.run(`UPDATE work_items SET state = 'CLOSED', outcome = 'ACHIEVED', version = version + 1 WHERE id = ?`, id), (e) => isQandeelError(e, 'STORAGE_INVARIANT'));
      const closed = h.store.transitionWorkItem(id, { to: 'CLOSED', reasonCode: 'closed', outcome: 'NOT_ACHIEVED' });
      assert.equal(closed.outcome, 'NOT_ACHIEVED', 'competent work whose outcome was not achieved is recorded honestly');
      assert.deepEqual(h.store.history(id).map((t) => t.toState), ['READY', 'IN_PROGRESS', 'COMPLETED', 'CLOSED']);
    } finally {
      h.close();
    }
  });

  test('no approval can be faked: WAITING_APPROVAL is not a manual target and cannot be exited toward execution', () => {
    const h = harness();
    try {
      const plain = h.store.createWorkItem({ objective: 'x', ownerRef: owner }).workItem.id;
      assert.throws(() => h.store.transitionWorkItem(plain, { to: 'WAITING_APPROVAL' as never, reasonCode: 'x' }), (e) => isQandeelError(e, 'INVALID_TRANSITION'));
      const gated = h.store.createWorkItem({ objective: 'x', ownerRef: owner, approvalRequired: true, initialState: 'READY' }).workItem.id;
      for (const to of ['READY', 'BLOCKED', 'CLOSED'] as const) {
        assert.throws(() => h.store.transitionWorkItem(gated, { to, reasonCode: 'x', actorRef: 'owner:someone' }), (e) => isQandeelError(e, 'APPROVAL_PATH_UNAVAILABLE'), to);
      }
      assert.equal(h.store.requestCancellation(gated, { reasonCode: 'NOT_NEEDED' }).terminated[0], gated);
    } finally {
      h.close();
    }
  });

  test('database guards: no hard delete, append-only history, frozen terminal rows, identity immutable', () => {
    const h = harness();
    try {
      const id = h.store.createWorkItem({ objective: 'x', ownerRef: owner }).workItem.id;
      const { db } = storeContext(h.store);
      assert.throws(() => db.run('DELETE FROM work_items WHERE id = ?', id), (e) => isQandeelError(e, 'STORAGE_INVARIANT'));
      assert.throws(() => db.run('DELETE FROM work_item_transitions WHERE work_item_id = ?', id), (e) => isQandeelError(e, 'STORAGE_INVARIANT'));
      assert.throws(() => db.run(`UPDATE work_item_transitions SET reason_code = 'rewritten' WHERE work_item_id = ?`, id), (e) => isQandeelError(e, 'STORAGE_INVARIANT'));
      assert.throws(() => db.run('UPDATE work_items SET root_id = ? WHERE id = ?', '00000000-0000-4000-8000-000000000000', id), (e) => isQandeelError(e, 'STORAGE_INVARIANT'));
      assert.throws(() => db.run('UPDATE work_items SET priority = 1 WHERE id = ?', id), (e) => isQandeelError(e, 'STORAGE_INVARIANT'), 'every update must bump the version');
      assert.throws(() => db.run('DELETE FROM audit_events'), (e) => isQandeelError(e, 'STORAGE_INVARIANT'));
      h.store.requestCancellation(id, { reasonCode: 'NOT_NEEDED' });
      assert.throws(() => db.run(`UPDATE work_items SET state = 'READY', version = version + 1 WHERE id = ?`, id), (e) => isQandeelError(e, 'STORAGE_INVARIANT'), 'no resurrection');
      assert.equal(h.store.getWorkItem(id).state, 'CANCELLED');
    } finally {
      h.close();
    }
  });
});

describe('dependencies and lineage', () => {
  test('self-dependency and cycles are rejected', () => {
    const h = harness();
    try {
      const [a, b, c] = ['a', 'b', 'c'].map((o) => h.store.createWorkItem({ objective: o, ownerRef: owner }).workItem.id) as [Id, Id, Id];
      assert.throws(() => h.store.addDependency(a, a), (e) => isQandeelError(e, 'DEPENDENCY_SELF'));
      h.store.addDependency(a, b);
      h.store.addDependency(b, c);
      assert.throws(() => h.store.addDependency(c, a), (e) => isQandeelError(e, 'DEPENDENCY_CYCLE'));
      assert.throws(() => h.store.addDependency(b, a), (e) => isQandeelError(e, 'DEPENDENCY_CYCLE'));
      const { db } = storeContext(h.store);
      assert.throws(() => db.run('DELETE FROM work_item_dependencies'), (e) => isQandeelError(e, 'STORAGE_INVARIANT'));
    } finally {
      h.close();
    }
  });

  test('blocked work records its blocker; completion unblocks only the affected dependents', () => {
    const h = harness();
    try {
      const dep = executable(h.store, { objective: 'dependency' });
      const other = executable(h.store, { objective: 'unrelated', priority: 0 });
      const waiter = h.store.createWorkItem({ objective: 'waits', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY', dependsOn: [dep] }).workItem;
      const bystander = h.store.createWorkItem({ objective: 'waits on unrelated', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY', dependsOn: [other] }).workItem;
      assert.equal(waiter.state, 'BLOCKED');
      assert.equal(waiter.blockedReason, 'DEPENDENCY');
      assert.equal(waiter.blockerRef, `work_item:${dep}`);
      assert.equal(h.store.jobsFor(waiter.id).length, 0, 'blocked work is not queued');
      const claim = h.store.claimNext(claimOpts());
      assert.equal(claim?.workItem.id, dep);
      const outcome = h.store.settle(claim.fence, { type: 'COMPLETED' }, { backoff });
      assert.deepEqual(outcome.unblocked, [waiter.id]);
      assert.equal(h.store.getWorkItem(waiter.id).state, 'READY');
      assert.equal(h.store.jobsFor(waiter.id).length, 1);
      assert.equal(h.store.getWorkItem(bystander.id).state, 'BLOCKED', 'no wake storm: unrelated work untouched');
      assert.ok(h.store.dependencies(waiter.id)[0]?.resolvedAt);
    } finally {
      h.close();
    }
  });

  test('a review-required dependency satisfies dependents only once reviewed, not at completion', () => {
    const h = harness();
    try {
      const dep = executable(h.store, { reviewRequired: true });
      const waiter = h.store.createWorkItem({ objective: 'w', ownerRef: owner, initialState: 'READY', dependsOn: [dep] }).workItem.id;
      const c = h.store.claimNext(claimOpts());
      assert.ok(c);
      const out = h.store.settle(c.fence, { type: 'COMPLETED' }, { backoff });
      assert.deepEqual(out.unblocked, []);
      assert.equal(h.store.getWorkItem(waiter).state, 'BLOCKED', 'Completed ≠ Reviewed: the dependent does not proceed');
      assert.equal(h.store.dependencies(waiter)[0]?.resolvedAt, null);
    } finally {
      h.close();
    }
  });

  test('a dependency that ends without completion keeps dependents blocked with a visible reason', () => {
    const h = harness();
    try {
      const dep = h.store.createWorkItem({ objective: 'dep', ownerRef: owner }).workItem.id;
      const waiter = h.store.createWorkItem({ objective: 'w', ownerRef: owner, initialState: 'READY', dependsOn: [dep] }).workItem.id;
      h.store.requestCancellation(dep, { reasonCode: 'DROPPED' });
      const w = h.store.getWorkItem(waiter);
      assert.equal(w.state, 'BLOCKED');
      assert.equal(w.blockedReason, 'DEPENDENCY_FAILED');
    } finally {
      h.close();
    }
  });

  test('adding a dependency to queued work withdraws its job and blocks it', () => {
    const h = harness();
    try {
      const a = executable(h.store);
      const b = h.store.createWorkItem({ objective: 'b', ownerRef: owner }).workItem.id;
      h.store.addDependency(a, b);
      assert.equal(h.store.getWorkItem(a).state, 'BLOCKED');
      assert.deepEqual(h.store.jobsFor(a).map((j) => j.state), ['CANCELLED']);
      assert.equal(h.store.claimNext(claimOpts()), null);
    } finally {
      h.close();
    }
  });

  test('lineage: children share root and correlation; cancellation propagates except to INDEPENDENT children', () => {
    const h = harness();
    try {
      const root = h.store.createWorkItem({ objective: 'launch plan', ownerRef: owner }).workItem;
      const child = h.store.createWorkItem({ objective: 'child', ownerRef: owner, parentId: root.id, processorKind: 'test.noop', initialState: 'READY' }).workItem;
      const grandchild = h.store.createWorkItem({ objective: 'grandchild', ownerRef: owner, parentId: child.id }).workItem;
      const independent = h.store.createWorkItem({ objective: 'keep', ownerRef: owner, parentId: root.id, propagationMode: 'INDEPENDENT' }).workItem;
      assert.equal(grandchild.rootId, root.id);
      assert.equal(grandchild.lineageDepth, 2);
      assert.equal(grandchild.correlationId, root.correlationId);
      const lineage = h.store.lineage(root.id).map((w) => w.id);
      assert.equal(lineage[0], root.id);
      assert.deepEqual(new Set(lineage), new Set([root.id, child.id, grandchild.id, independent.id]));
      const out = h.store.requestCancellation(root.id, { reasonCode: 'STRATEGY_CHANGED', actorRef: 'owner:founder' });
      assert.deepEqual(new Set(out.terminated), new Set([root.id, child.id, grandchild.id]));
      assert.deepEqual(out.retained, [independent.id]);
      assert.equal(h.store.getWorkItem(independent.id).state, 'PROPOSED');
      assert.equal(h.store.getWorkItem(child.id).terminationReason, 'PARENT_CANCELLED');
      assert.deepEqual(h.store.jobsFor(child.id).map((j) => j.state), ['CANCELLED']);
      assert.ok(h.store.auditByAction('work_item.propagation_retained').some((a) => a.entityId === independent.id));
    } finally {
      h.close();
    }
  });

  test('supersession links the replacement and propagates cancellation to children', () => {
    const h = harness();
    try {
      const old = h.store.createWorkItem({ objective: 'old plan', ownerRef: owner }).workItem;
      const child = h.store.createWorkItem({ objective: 'old child', ownerRef: owner, parentId: old.id }).workItem;
      const replacement = h.store.createWorkItem({ objective: 'new plan', ownerRef: owner }).workItem;
      const out = h.store.supersede(old.id, replacement.id, { reasonCode: 'REPLACED' });
      assert.deepEqual(out.terminated, [old.id, child.id]);
      const o = h.store.getWorkItem(old.id);
      assert.equal(o.state, 'SUPERSEDED');
      assert.equal(o.supersededBy, replacement.id);
      assert.equal(h.store.getWorkItem(child.id).terminationReason, 'PARENT_SUPERSEDED');
      assert.equal(h.store.supersede(old.id, replacement.id, { reasonCode: 'AGAIN' }).alreadyTerminal[0], old.id, 'idempotent on terminal work');
      const parent = h.store.createWorkItem({ objective: 'p', ownerRef: owner }).workItem;
      const kid = h.store.createWorkItem({ objective: 'k', ownerRef: owner, parentId: parent.id }).workItem;
      assert.throws(() => h.store.supersede(parent.id, kid.id, { reasonCode: 'SELF_DESCENDANT' }), (e) => isQandeelError(e, 'LINEAGE_INVALID'), 'a replacement inside the lineage would cancel itself');
    } finally {
      h.close();
    }
  });
});
