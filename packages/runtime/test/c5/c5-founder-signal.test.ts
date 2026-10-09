/**
 * C5 Founder change-signalling contract (D-C5-17), proved on the real runtime: a Founder read announces
 * nothing and wakes nothing; a call that throws announces nothing; a successful mutation announces once;
 * attention reconciliation announces only when it opened, signalled or resolved an item, and a stable
 * world stays silent. The Founder surface refreshes itself with reads on every announcement: reads that
 * announced closed that loop into a refresh storm (hundreds of requests a second after one selection).
 * C5-PROOF: runtime-c5-signal
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';
import { CompanyStore, GovernanceStore, OrganizationStore, type EmployeeRecord } from '@qandeel-company/storage';
import { activateEmployeeForTest } from '@qandeel-company/storage/testing';

import type { CompanyRuntime } from '../../src/index.js';
import { removeRoot, tempRoot } from '../helpers.js';
import { fakes, governedRuntime, nextName, seedWorld, type C2World } from '../c2/c2-seed.js';

function must<T>(v: T | null | undefined, what = 'value'): T {
  if (v === null || v === undefined) throw new Error(`${what} is missing`);
  return v;
}

/** The CEO seat placed before start (a direct Founder ↔ CEO thread needs a holder). */
function seedCeo(root: string, w: C2World): EmployeeRecord {
  const store = CompanyStore.open(root);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const seat = must(org.positionByCode('company.ceo'));
    const e = gov.createEmployee(w.founder, { name: nextName(), profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: seat.roleRef, positionRef: 'position:p1', departmentId: w.departmentId, managerRef: w.founder });
    gov.transitionEmployee(w.founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(w.founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, w.founder, e.id);
    gov.createBudget(w.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 5_000_000, capTokens: 5_000_000, reasonCode: 'seed' });
    org.assignPrimary(w.founder, { positionId: seat.id, employeeId: e.id, reasonCode: 'placed' });
    return gov.getEmployee(e.id);
  } finally {
    store.close();
  }
}

/** Counts "the Founder's world changed" announcements and dispatcher wakes from a chosen moment on. */
function meter(rt: CompanyRuntime): { readonly changes: number; readonly wakes: number; reset(): void; off(): void } {
  let changes = 0;
  let wakesAt = rt.diagnostics().wakeSignals;
  const off = rt.onFounderChange(() => {
    changes++;
  });
  return {
    get changes() {
      return changes;
    },
    get wakes() {
      return rt.diagnostics().wakeSignals - wakesAt;
    },
    reset() {
      changes = 0;
      wakesAt = rt.diagnostics().wakeSignals;
    },
    off,
  };
}

async function withRuntime(label: string, fn: (ctx: { rt: CompanyRuntime; w: C2World; ceo: EmployeeRecord }) => Promise<void> | void): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const ceo = seedCeo(root, w);
  const rt = governedRuntime(root, fakes());
  try {
    await rt.start();
    await fn({ rt, w, ceo });
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

const now = (): string => new Date().toISOString();

describe('C5 runtime: the Founder change-signalling contract', () => {
  test('C5-PROOF: Founder reads announce nothing and wake nothing (goals, communications, attention, actions, the universe projection)', () =>
    withRuntime('c5-signal-reads', ({ rt, w, ceo }) => {
      const f = rt.founder;
      // The world to read: one goal, one direct thread with one message (no reply requested), attention reconciled.
      const goal = f.goals.propose(w.founder, { kind: 'COMPANY', title: 'إطلاق السعودية', summary: 'x', ownerRef: ceo.ref });
      const thread = f.communications.directThread(w.founder, null);
      const sent = f.communications.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'ما الوضع؟', responseRequired: false });
      f.attention.sync(w.founder);
      const m = meter(rt);
      try {
        m.reset();
        const at = now();
        f.goals.get(goal.id);
        f.goals.list();
        f.goals.history(goal.id);
        f.goals.links({ goalId: goal.id });
        f.goals.stateAt(goal.id, at as never);
        f.communications.thread(thread.id);
        f.communications.threads();
        f.communications.message(sent.message.id);
        f.communications.messages(thread.id);
        f.communications.messageMeta(thread.id);
        f.communications.pendingReplies();
        f.communications.health();
        f.attention.list();
        f.attention.openAt(at as never);
        f.attention.health();
        f.actions.list();
        f.actions.employeeBudgetId(ceo.id);
        f.universe();
        f.universe({ at });
        assert.equal(m.changes, 0, 'a read never says the Founder\'s world changed');
        assert.equal(m.wakes, 0, 'a read never wakes the dispatcher');
      } finally {
        m.off();
      }
    }));

  test('C5-PROOF: a Founder write that fails announces nothing and wakes nothing, and its error is the store\'s own', () =>
    withRuntime('c5-signal-failed', ({ rt, w, ceo }) => {
      const f = rt.founder;
      const goal = f.goals.propose(w.founder, { kind: 'COMPANY', title: 'هدف', summary: 'x', ownerRef: ceo.ref });
      const m = meter(rt);
      try {
        m.reset();
        const codes: string[] = [];
        const code = (e: unknown): boolean => {
          codes.push(String((e as { code?: unknown }).code));
          return typeof (e as { code?: unknown }).code === 'string';
        };
        assert.throws(() => f.attention.dismiss(w.founder, 'not-an-id', 'x'), code);
        assert.throws(() => f.goals.transition(w.founder, goal.id, { to: 'ACHIEVED', reasonCode: 'x' }), code);
        assert.throws(() => f.actions.confirm({} as never, 'preview', 'fingerprint'), code);
        assert.throws(() => f.communications.send('employee:nobody', 'not-a-thread', { purpose: 'QUESTION', body: 'x' }), code);
        assert.equal(codes.includes('VALIDATION_FAILED'), true, `the original errors are preserved (${codes.join(', ')})`);
        assert.equal(m.changes, 0, 'a failed write never says the Founder\'s world changed');
        assert.equal(m.wakes, 0, 'a failed write never wakes the dispatcher');
      } finally {
        m.off();
      }
    }));

  test('C5-PROOF: a successful Founder mutation announces exactly once and wakes the dispatcher once, after it succeeded', () =>
    withRuntime('c5-signal-write', ({ rt, w, ceo }) => {
      const f = rt.founder;
      const m = meter(rt);
      try {
        m.reset();
        let seenAtAnnouncement: number | null = null;
        const off = rt.onFounderChange(() => {
          seenAtAnnouncement = f.goals.list().length;
        });
        const goal = f.goals.propose(w.founder, { kind: 'COMPANY', title: 'هدف واحد', summary: 'x', ownerRef: ceo.ref });
        off();
        assert.equal(m.changes, 1, 'one mutation, one announcement');
        assert.equal(m.wakes, 1, 'one mutation, one dispatcher wake');
        assert.equal(seenAtAnnouncement, 1, 'the announcement follows the durable write');
        m.reset();
        f.goals.transition(w.founder, goal.id, { to: 'APPROVED', reasonCode: 'ok' });
        f.communications.directThread(w.founder, null);
        assert.equal(m.changes, 2, 'every successful mutation announces once, bounded');
        assert.equal(m.wakes, 2);
      } finally {
        m.off();
      }
    }));

  test('C5-PROOF: attention reconciliation announces only a real delta; a stable world reconciles in silence', () =>
    withRuntime('c5-signal-sync', ({ rt, w, ceo }) => {
      const f = rt.founder;
      const m = meter(rt);
      try {
        const first = f.attention.sync(w.founder);
        m.reset();
        const stable = f.attention.sync(w.founder);
        f.attention.sync(w.founder);
        assert.deepEqual([stable.opened, stable.signalled, stable.resolved], [0, 0, 0], `a second reconciliation has no delta (first: ${JSON.stringify(first)})`);
        assert.equal(m.changes, 0, 'a zero-delta reconciliation is silent');
        assert.equal(m.wakes, 0);
        // A proposed company goal needs the Founder: reconciling it opens one item — one announcement — and no more.
        const goal = f.goals.propose(w.founder, { kind: 'COMPANY', title: 'قرار مطلوب', summary: 'x', ownerRef: ceo.ref });
        m.reset();
        const opened = f.attention.sync(w.founder);
        assert.equal(opened.opened, 1);
        assert.equal(m.changes, 1, 'a real delta announces once');
        assert.equal(m.wakes, 1);
        f.attention.sync(w.founder);
        f.attention.sync(w.founder);
        assert.equal(m.changes, 1, 'the same open item, reconciled again, is silence');
        // The Founder decides: the source resolves, reconciliation announces that once, then falls silent again.
        f.goals.transition(w.founder, goal.id, { to: 'APPROVED', reasonCode: 'ok' });
        m.reset();
        const resolved = f.attention.sync(w.founder);
        assert.equal(resolved.resolved, 1);
        assert.equal(m.changes, 1);
        f.attention.sync(w.founder);
        assert.equal(m.changes, 1);
      } finally {
        m.off();
      }
    }));

  test('C5-PROOF: every public method of every Founder store is classified; the contract cannot drift silently', () =>
    withRuntime('c5-signal-census', ({ rt }) => {
      const f = rt.founder;
      const publicMethods = (o: object): string[] => Object.keys(o).filter((k) => typeof (o as Record<string, unknown>)[k] === 'function').sort();
      assert.deepEqual(publicMethods(f.goals), ['get', 'history', 'linkWork', 'links', 'list', 'propose', 'stateAt', 'transition', 'unlinkWork']);
      assert.deepEqual(publicMethods(f.communications), ['closeThread', 'directThread', 'health', 'message', 'messageMeta', 'messages', 'messagesPage', 'openThread', 'pendingReplies', 'replyStates', 'requestCeoBrief', 'send', 'thread', 'threads']);
      assert.deepEqual(publicMethods(f.attention), ['dismiss', 'health', 'list', 'openAt', 'sync']);
      assert.deepEqual(publicMethods(f.actions), ['activationEnv', 'confirm', 'employeeBudgetId', 'expireStale', 'get', 'list', 'packageDigest', 'preview', 'provisioningProfiles', 'reject']);
      assert.ok(Object.isFrozen(f.goals) && Object.isFrozen(f.attention), 'the contract objects are frozen');
      void (null as Id | null);
    }));
});
