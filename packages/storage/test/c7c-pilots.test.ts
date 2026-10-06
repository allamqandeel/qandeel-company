/**
 * C7-C storage proofs — the Pilot as a durable, Founder-decided context over the canonical Company systems: briefing
 * before activation (conversation ≠ authority, silence ≠ approval), the root Company Goal from the existing Founder
 * path, scope derived from Goal → Work truth, the Evidence Board as a projection that follows C6 / C7-A / C7-B truth
 * (no score, no second evaluator / ledger / review path), Rule A, restart / idempotency / atomicity, the datastore
 * gates of migration 0014 and the governed confirmation. Everything runs through the real paths.
 * C7C-PROOF: storage-pilots
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ManualClock, isQandeelError, newId, type Id } from '@qandeel-company/domain';
import { PERFORMANCE_DIMENSIONS, standardWorkOutcomeDefinition } from '@qandeel-company/mind';

import { AppControlStore, CommunicationStore, ExternalEvidenceStore, FounderActionStore, FounderAuthStore, GoalStore, ImprovementStore, PilotStore, ReviewStore, loadReleasedMigrations, type EmployeeRecord, type PilotRecord } from '../src/index.js';
import { recordMessage, recordOrgAct, recordReviewDecision, reserveBudget, settle, settleReservation } from '../src/runtime-authority.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { armFounderTestSurface, disarmFounderTestSurface } from '../src/testing/founder-seam.js';
import { GOVERNED_KIND, seed, testManifest, type Seed } from './c2-helpers.js';
import { activeReviewer, claimItem, decideActionReview, placed, reviewPlan, runFor } from './c4-helpers.js';
import { backoff, harness, removeRoot, tempRoot, type Harness } from './helpers.js';

const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;
const reason = (r: string) => (e: unknown): boolean => isQandeelError(e) && e.details.reason === r;
const aborts = (fn: () => unknown, what: string): void => assert.throws(fn, (e: unknown) => e instanceof Error, what);
const PLAN = reviewPlan({ appliesTo: 'OUTPUT' });
const TITLE = 'تجربة الإطلاق الداخلية';
const BODY = 'ما رأيك في خطة الإطلاق في مصر؟';

interface W {
  readonly h: Harness;
  readonly s: Seed;
  readonly ceo: EmployeeRecord;
  readonly pilots: PilotStore;
  readonly goals: GoalStore;
  readonly comm: CommunicationStore;
  readonly m: ImprovementStore;
}

function withWorld(fn: (w: W) => void): void {
  const h = harness();
  try {
    const s = seed(h.store);
    const m = ImprovementStore.for(h.store);
    const d = m.registerDefinition(s.founder, standardWorkOutcomeDefinition());
    m.activateDefinition(s.founder, d.id, m.calibrateDefinition(s.founder, d.id).id);
    activeReviewer(h, s);
    const ceo = placed(h, s, 'company.ceo');
    fn({ h, s, ceo, pilots: PilotStore.for(h.store), goals: GoalStore.for(h.store), comm: CommunicationStore.for(h.store), m });
  } finally {
    h.close();
  }
}

const db = (w: W) => storeContext(w.h.store).db;
const count = (w: W, sql: string, ...p: string[]): number => Number(db(w).get<{ n: number }>(sql, ...p)?.n ?? 0);

/** The Founder asks the CEO in the briefing thread; optionally the CEO's governed reply run answers it. */
function ask(w: W, p: PilotRecord, answer = true, purpose: 'QUESTION' | 'REQUEST' | 'DECISION_REQUEST' | 'FYI' = 'QUESTION'): Id | null {
  const sent = w.comm.send(w.s.founder, String(p.briefingThreadId), { purpose, body: BODY });
  if (!answer || sent.replyWorkItemId === null) return sent.replyWorkItemId;
  const claim = claimItem(w.h, sent.replyWorkItemId, `w-ceo-${newId().slice(0, 6)}`);
  assert.equal(recordMessage(w.h.store, claim.fence, { purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'أقترح البدء بالبحث عن السوق المصري.', brief: null, contextRefs: [] }).outcome, 'RECORDED');
  settle(w.h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
  return sent.replyWorkItemId;
}

/** A Founder-approved, ACTIVE Company Goal with success criteria (the existing C5 path). */
function rootGoal(w: W, criteria: string[] = ['موقع إطلاق جاهز للمراجعة']): Id {
  const g = w.goals.propose(w.s.founder, { kind: 'COMPANY', title: 'إطلاق قنديل في مصر', summary: 'تحضير الإطلاق.', ownerRef: w.ceo.ref, successCriteria: criteria });
  w.goals.transition(w.s.founder, g.id, { to: 'APPROVED', reasonCode: 'goal.approved' });
  return w.goals.transition(w.s.founder, g.id, { to: 'ACTIVE', reasonCode: 'goal.activated' }).id;
}

/** A Pilot taken through a real briefing to READY. */
function readyPilot(w: W, mode: 'TRAINING_INTERNAL' | 'CONTROLLED_REAL' = 'TRAINING_INTERNAL', requiresExternalOutcome = false): PilotRecord {
  const p = w.pilots.create(w.s.founder, { mode, title: TITLE, requiresExternalOutcome });
  const b = w.pilots.advance(w.s.founder, p.id, { to: 'BRIEFING', reasonCode: 'pilot.briefing' });
  ask(w, b);
  return w.pilots.advance(w.s.founder, p.id, { to: 'READY', reasonCode: 'pilot.ready' });
}

function activePilot(w: W, mode: 'TRAINING_INTERNAL' | 'CONTROLLED_REAL' = 'TRAINING_INTERNAL', requiresExternalOutcome = false): { pilot: PilotRecord; goalId: Id } {
  const p = readyPilot(w, mode, requiresExternalOutcome);
  const goalId = rootGoal(w);
  return { pilot: w.pilots.advance(w.s.founder, p.id, { to: 'ACTIVE', goalId, reasonCode: 'pilot.active' }), goalId };
}

/** Governed work owned by `who`, prepared by the Founder, executed to its review (optionally with real model cost). */
function prepared(w: W, who: EmployeeRecord = w.s.employee, withCost = true): Id {
  const { workItem } = w.h.store.createWorkItem({ objective: 'launch research', ownerRef: who.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', dataClass: 'D1', instructions: 'x' } });
  w.s.gov.createBudget(w.s.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 100_000, capTokens: 100_000, reasonCode: 'seed' });
  ReviewStore.for(w.h.store).declarePlan(w.s.founder, workItem.id, PLAN);
  if (w.h.store.getWorkItem(workItem.id).state === 'PROPOSED') w.h.store.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  const claim = claimItem(w.h, workItem.id, `w-${newId().slice(0, 8)}`);
  if (withCost) {
    const r = reserveBudget(w.h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: w.s.deploymentId, priceCardId: w.s.priceCardId, routePolicyId: w.s.policyId, money: 1_000, tokens: 1_000, contextManifestId: testManifest(w.h, claim.fence, who.id) });
    assert.ok(r.ok);
    if (r.ok) settleReservation(w.h.store, claim.fence, r.reservation.id, { inputTokens: 100, outputTokens: 50, withinBounds: true, sessionId: null, outcome: 'OK' });
  }
  settle(w.h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
  return workItem.id;
}

function review(w: W, workItemId: Id, outcome: 'PASS' | 'FAIL'): void {
  const rv = ReviewStore.for(w.h.store);
  const request = rv.requests({ workItemId }).find((r) => r.state === 'OPEN');
  const key = request ? rv.assignments(request.id).find((a) => a.keyKind === 'SPECIALIST' && a.state === 'ASSIGNED') : undefined;
  assert.ok(key?.reviewWorkItemId, 'an independent reviewer is assigned');
  const claim = claimItem(w.h, key.reviewWorkItemId, `w-${newId().slice(0, 8)}`);
  assert.equal(recordReviewDecision(w.h.store, claim.fence, { outcome, reasonCode: 'rubric.applied', rationale: null, evidenceRefs: ['evidence:rubric'], outcomeJudgment: null }).code, 'RECORDED');
  settle(w.h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
}

/** Reviewed + outcome-verified + evaluated: a qualified outcome through C6. */
function qualified(w: W, who: EmployeeRecord = w.s.employee): Id {
  const id = prepared(w, who);
  review(w, id, 'PASS');
  w.m.verifyOutcome(w.s.founder, id, { verdict: 'ACHIEVED', evidenceClasses: ['REVIEW_DECISION', 'WORK_LINEAGE'], evidenceRefs: [`work_item:${id}`], reasonCode: 'founder.verified' });
  w.m.evaluate(id);
  return id;
}

const grantsOf = (w: W): number => count(w, 'SELECT COUNT(*) AS n FROM permission_grants') + count(w, 'SELECT COUNT(*) AS n FROM authority_delegations');
const budgetsOf = (w: W): string => JSON.stringify(db(w).all('SELECT id, cap_money, cap_tokens FROM budgets ORDER BY id'));

// =================================================================================================================
describe('C7-C Pilot lifecycle and the pre-execution Founder briefing', () => {
  test('(1, 2) a Pilot exists before any Goal; DRAFT → BRIEFING is durable and binds one open Founder ↔ CEO thread; nothing is copied from it', () => {
    withWorld((w) => {
      // A Pilot act passes the Founder chokepoint: outside an authenticated session (or the test seam) it fails closed.
      disarmFounderTestSurface(w.h.root);
      assert.throws(() => w.pilots.create(w.s.founder, { mode: 'TRAINING_INTERNAL', title: TITLE }), code('FOUNDER_SURFACE_UNAVAILABLE'));
      armFounderTestSurface(w.h.root);
      const goalsBefore = count(w, 'SELECT COUNT(*) AS n FROM goals');
      const p = w.pilots.create(w.s.founder, { mode: 'TRAINING_INTERNAL', title: TITLE });
      assert.deepEqual([p.state, p.rootGoalId, p.briefingThreadId, p.version], ['DRAFT', null, null, 1]);
      assert.equal(count(w, 'SELECT COUNT(*) AS n FROM goals'), goalsBefore, 'a Pilot creates no Goal');
      const b = w.pilots.advance(w.s.founder, p.id, { to: 'BRIEFING', reasonCode: 'pilot.briefing' });
      const thread = w.comm.thread(String(b.briefingThreadId) as Id);
      assert.deepEqual([b.state, thread.kind, thread.employeeId, thread.state], ['BRIEFING', 'FOUNDER_CEO', w.ceo.id, 'OPEN']);
      assert.deepEqual(w.pilots.history(p.id).map((x) => [x.fromState, x.toState, x.actorRef]), [[null, 'DRAFT', w.s.founder], ['DRAFT', 'BRIEFING', w.s.founder]]);
      // An existing open CEO thread can be bound instead; a thread briefs one Pilot only.
      const other = w.pilots.create(w.s.founder, { mode: 'CONTROLLED_REAL', title: 'تجربة ثانية' });
      assert.throws(() => w.pilots.advance(w.s.founder, other.id, { to: 'BRIEFING', threadId: String(b.briefingThreadId), reasonCode: 'pilot.briefing' }), reason('THREAD_ALREADY_BOUND'));
      const direct = w.comm.directThread(w.s.founder, null);
      assert.equal(w.pilots.advance(w.s.founder, other.id, { to: 'BRIEFING', threadId: direct.id, reasonCode: 'pilot.briefing' }).briefingThreadId, direct.id);
      // The Pilot holds ids only: no message column, no body.
      const cols = db(w).all<{ name: string }>('PRAGMA table_info(pilots)').map((c) => c.name);
      assert.ok(!cols.some((c) => /body|message|content|transcript|prompt|text/.test(c)), cols.join());
    });
  });

  test('(3, 4, 5, 6) READY needs a governed reply to a Founder request: none, an FYI, a Founder message alone, an Employee-only message or silence never suffice', () => {
    withWorld((w) => {
      const p = w.pilots.advance(w.s.founder, w.pilots.create(w.s.founder, { mode: 'TRAINING_INTERNAL', title: TITLE }).id, { to: 'BRIEFING', reasonCode: 'pilot.briefing' });
      const ready = () => w.pilots.advance(w.s.founder, p.id, { to: 'READY', reasonCode: 'pilot.ready' });
      assert.throws(ready, reason('NO_GOVERNED_BRIEFING_REPLY'), '(3) no exchange');
      ask(w, p, false, 'FYI');
      assert.throws(ready, reason('NO_GOVERNED_BRIEFING_REPLY'), 'an FYI needs no response and proves nothing');
      ask(w, p, false);
      assert.throws(ready, reason('NO_GOVERNED_BRIEFING_REPLY'), '(4) the Founder message alone');
      // (5) an Employee message in the briefing thread that answers no Founder request is not it either.
      const { workItem: own } = w.h.store.createWorkItem({ objective: 'ceo note', ownerRef: w.ceo.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', instructions: 'x', founderThreadId: String(p.briefingThreadId) } });
      w.s.gov.createBudget(w.s.founder, { scope: 'WORK_ITEM', scopeId: own.id, capMoney: 10_000, capTokens: 10_000, reasonCode: 'seed' });
      w.h.store.transitionWorkItem(own.id, { to: 'READY', reasonCode: 'release' });
      const claim = claimItem(w.h, own.id, 'w-ceo-own');
      assert.equal(recordMessage(w.h.store, claim.fence, { purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'جاهز للبدء.', brief: null, contextRefs: [] }).outcome, 'RECORDED');
      settle(w.h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
      assert.throws(ready, reason('NO_GOVERNED_BRIEFING_REPLY'), '(5) an Employee message alone');
      // (6) silence is never approval: time passing changes nothing.
      w.h.clock.advance(30 * 24 * 3_600_000);
      assert.throws(ready, reason('NO_GOVERNED_BRIEFING_REPLY'), '(6) silence');
      assert.equal(w.pilots.get(p.id).state, 'BRIEFING');
      assert.deepEqual(w.pilots.board(p.id).decisionsNeeded, ['AWAITING_GOVERNED_REPLY']);
      // The datastore refuses it as well, even when TypeScript is bypassed.
      aborts(() => db(w).run(`UPDATE pilots SET state = 'READY', version = version + 1 WHERE id = ?`, p.id), 'datastore READY gate');
    });
  });

  test('TL MAJOR (2af37b6): an exchange in a reused CEO thread from BEFORE the Pilot\'s briefing never briefs it — code and datastore; a new governed exchange does', () => {
    withWorld((w) => {
      // 1–2. The Founder's ordinary direct CEO thread holds a qualifying request and its governed CEO reply, before any Pilot.
      const direct = w.comm.directThread(w.s.founder, null);
      const oldSent = w.comm.send(w.s.founder, direct.id, { purpose: 'QUESTION', body: 'سؤال قديم لا علاقة له بالتجربة' });
      const oldClaim = claimItem(w.h, oldSent.replyWorkItemId as Id, 'w-ceo-old');
      assert.equal(recordMessage(w.h.store, oldClaim.fence, { purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'إجابة قديمة.', brief: null, contextRefs: [] }).outcome, 'RECORDED');
      settle(w.h.store, oldClaim.fence, { type: 'COMPLETED' }, { backoff });
      assert.equal(w.comm.pendingReplies().length, 0, 'the old exchange is a complete governed exchange');
      const history = w.comm.messages(direct.id).map((m) => m.id);
      // 3. A new Pilot binds that same thread entering BRIEFING.
      const p = w.pilots.advance(w.s.founder, w.pilots.create(w.s.founder, { mode: 'TRAINING_INTERNAL', title: TITLE }).id, { to: 'BRIEFING', threadId: direct.id, reasonCode: 'pilot.briefing' });
      assert.deepEqual([p.briefingThreadId, p.briefingFromSeq], [direct.id, history.length + 1], 'the boundary is the thread\'s next message');
      assert.deepEqual(w.pilots.briefing(p.id).answered, [], 'the earlier exchange is not this Pilot\'s briefing');
      // 4. READY is refused in the code path …
      assert.throws(() => w.pilots.advance(w.s.founder, p.id, { to: 'READY', reasonCode: 'pilot.ready' }), reason('NO_GOVERNED_BRIEFING_REPLY'));
      // 5. … and by the datastore when TypeScript is bypassed, including by moving the boundary back to cover the old exchange.
      aborts(() => db(w).run(`UPDATE pilots SET state = 'READY', version = version + 1 WHERE id = ?`, p.id), 'datastore READY gate honours the boundary');
      aborts(() => db(w).run(`UPDATE pilots SET state = 'READY', briefing_from_seq = 1, version = version + 1 WHERE id = ?`, p.id), 'the boundary cannot be moved back to cover the old exchange');
      // 6–7. A new request after BRIEFING with its own governed reply: only now READY succeeds.
      ask(w, p);
      assert.equal(w.pilots.briefing(p.id).answered.length, 1);
      assert.equal(w.pilots.advance(w.s.founder, p.id, { to: 'READY', reasonCode: 'pilot.ready' }).state, 'READY');
      // 8. The old exchange remains communication history, untouched.
      const after = w.comm.messages(direct.id).map((m) => m.id);
      assert.deepEqual(after.slice(0, history.length), history);
      assert.equal(w.comm.message(oldSent.message.id).body, 'سؤال قديم لا علاقة له بالتجربة');
    });
  });

  test('(5, 7, 8, 9) a governed reply is conversation evidence only: READY stays an explicit Founder act, grants nothing and creates / approves no Goal', () => {
    withWorld((w) => {
      const p = w.pilots.advance(w.s.founder, w.pilots.create(w.s.founder, { mode: 'TRAINING_INTERNAL', title: TITLE }).id, { to: 'BRIEFING', reasonCode: 'pilot.briefing' });
      ask(w, p);
      const grants = grantsOf(w);
      const budgets = budgetsOf(w);
      const goals = count(w, 'SELECT COUNT(*) AS n FROM goals');
      assert.equal(w.pilots.get(p.id).state, 'BRIEFING', '(7) the reply moves nothing by itself');
      assert.deepEqual(w.pilots.board(p.id).decisionsNeeded, ['DECIDE_READY']);
      assert.throws(() => w.pilots.advance(w.ceo.ref, p.id, { to: 'READY', reasonCode: 'pilot.ready' }), (e: unknown) => isQandeelError(e) && ['FOUNDER_ONLY', 'AUTHORITY_DENIED', 'SELF_ESCALATION_REFUSED'].includes(e.code), '(5, 8) the CEO cannot mark READY');
      assert.throws(() => w.pilots.advance(w.s.employee.ref, p.id, { to: 'READY', reasonCode: 'pilot.ready' }), (e: unknown) => isQandeelError(e));
      const r = w.pilots.advance(w.s.founder, p.id, { to: 'READY', reasonCode: 'pilot.ready' });
      assert.equal(r.state, 'READY');
      assert.equal(grantsOf(w), grants, 'a briefing grants no authority');
      assert.equal(budgetsOf(w), budgets, 'a briefing grants no budget');
      assert.equal(count(w, 'SELECT COUNT(*) AS n FROM goals'), goals, '(9) READY creates or approves no Goal');
      assert.equal(w.pilots.board(p.id).briefing.answered.length, 1);
    });
  });

  test('(10, 11) ACTIVE needs an active, Founder-approved root Company Goal with success criteria — and grants no tool, budget, role or authority', () => {
    withWorld((w) => {
      const p = readyPilot(w);
      const act = (goalId?: string) => w.pilots.advance(w.s.founder, p.id, { to: 'ACTIVE', reasonCode: 'pilot.active', ...(goalId === undefined ? {} : { goalId }) });
      assert.throws(() => act(), code('VALIDATION_FAILED'), 'no goal named');
      const proposed = w.goals.propose(w.s.founder, { kind: 'COMPANY', title: 'إطلاق', summary: 'x', ownerRef: w.ceo.ref, successCriteria: ['x'] });
      assert.throws(() => act(proposed.id), reason('ROOT_GOAL_NOT_ACTIVE'), 'a proposed goal is not approved');
      const noCriteria = w.goals.propose(w.s.founder, { kind: 'COMPANY', title: 'بدون معايير', summary: 'x', ownerRef: w.ceo.ref });
      w.goals.transition(w.s.founder, noCriteria.id, { to: 'APPROVED', reasonCode: 'goal.approved' });
      w.goals.transition(w.s.founder, noCriteria.id, { to: 'ACTIVE', reasonCode: 'goal.activated' });
      assert.throws(() => act(noCriteria.id), reason('ROOT_GOAL_NOT_ACTIVE'), 'success criteria are required');
      const dept = w.goals.propose(w.s.founder, { kind: 'DEPARTMENT', departmentId: w.s.departmentId, parentGoalId: noCriteria.id, title: 'فرعي', summary: 'x', ownerRef: w.ceo.ref, successCriteria: ['x'] });
      assert.throws(() => act(dept.id), reason('ROOT_GOAL_NOT_ACTIVE'), 'a Department goal is never the root');
      // The datastore refuses an ACTIVE without a qualifying root goal too.
      aborts(() => db(w).run(`UPDATE pilots SET state = 'ACTIVE', root_goal_id = ?, activated_at = updated_at, version = version + 1 WHERE id = ?`, noCriteria.id, p.id), 'datastore ACTIVE gate');
      const goalId = rootGoal(w);
      const grants = grantsOf(w);
      const budgets = budgetsOf(w);
      const positions = JSON.stringify(db(w).all('SELECT * FROM position_assignments ORDER BY id'));
      const active = act(goalId);
      assert.deepEqual([active.state, active.rootGoalId], ['ACTIVE', goalId]);
      assert.equal(grantsOf(w), grants, '(11) no grant or delegation');
      assert.equal(budgetsOf(w), budgets, '(11) no budget');
      assert.equal(JSON.stringify(db(w).all('SELECT * FROM position_assignments ORDER BY id')), positions, '(11) no role');
      const another = readyPilot(w);
      assert.throws(() => w.pilots.advance(w.s.founder, another.id, { to: 'ACTIVE', goalId, reasonCode: 'pilot.active' }), reason('GOAL_ALREADY_BOUND'), 'one root goal never counts for two pilots');
    });
  });

  test('(12, 13) a terminal Pilot never revives; STOPPED is history; the datastore holds the forward-only lifecycle', () => {
    withWorld((w) => {
      const { pilot } = activePilot(w);
      w.pilots.advance(w.s.founder, pilot.id, { to: 'REVIEWING', reasonCode: 'pilot.reviewing' });
      const done = w.pilots.advance(w.s.founder, pilot.id, { to: 'COMPLETED', reasonCode: 'pilot.completed' });
      assert.ok(done.closedAt !== null);
      for (const to of ['ACTIVE', 'REVIEWING', 'STOPPED', 'DRAFT'] as const) assert.throws(() => w.pilots.advance(w.s.founder, pilot.id, { to, reasonCode: 'x' }), code('PILOT_INVALID'), `COMPLETED → ${to}`);
      const draft = w.pilots.create(w.s.founder, { mode: 'TRAINING_INTERNAL', title: 'تجربة متوقفة' });
      const stopped = w.pilots.advance(w.s.founder, draft.id, { to: 'STOPPED', reasonCode: 'pilot.stopped' });
      assert.equal(stopped.state, 'STOPPED');
      assert.throws(() => w.pilots.advance(w.s.founder, draft.id, { to: 'BRIEFING', reasonCode: 'x' }), code('PILOT_INVALID'));
      assert.deepEqual(w.pilots.history(draft.id).map((h) => h.toState), ['DRAFT', 'STOPPED'], 'STOPPED stays as history');
      aborts(() => db(w).run(`UPDATE pilots SET state = 'ACTIVE', closed_at = NULL, version = version + 1 WHERE id = ?`, pilot.id), 'no revival');
      const fresh = w.pilots.create(w.s.founder, { mode: 'TRAINING_INTERNAL', title: 'تجربة' });
      aborts(() => db(w).run(`UPDATE pilots SET mode = 'CONTROLLED_REAL', state = 'STOPPED', closed_at = updated_at, version = version + 1 WHERE id = ?`, fresh.id), 'the mode never changes, even on an allowed step');
      aborts(() => db(w).run('DELETE FROM pilots WHERE id = ?', draft.id), 'no hard delete');
      aborts(() => db(w).run(`UPDATE pilot_history SET reason_code = 'x' WHERE pilot_id = ?`, draft.id), 'history is append-only');
      aborts(() => db(w).run('DELETE FROM pilot_history WHERE pilot_id = ?', draft.id), 'history is append-only');
      aborts(() => db(w).run(`INSERT INTO pilots (id, mode, title, requires_external_outcome, state, briefing_thread_id, root_goal_id, created_by_ref, version, created_at, updated_at, activated_at, closed_at) VALUES (?, 'TRAINING_INTERNAL', 'x', 0, 'ACTIVE', NULL, NULL, ?, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', NULL, NULL)`, newId(), w.s.founder), 'born a DRAFT');
      aborts(() => db(w).run(`INSERT INTO pilot_history (pilot_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, 3, 'STOPPED', 'BRIEFING', 'x', ?, '2026-10-01T00:00:00.000Z')`, draft.id, w.s.employee.ref), 'history is the Founder\'s and matches the pilot');
      assert.throws(() => w.pilots.create(w.s.founder, { mode: 'TRAINING_INTERNAL', title: TITLE, requiresExternalOutcome: true }), code('VALIDATION_FAILED'), 'a training pilot never requires market evidence');
    });
  });
});

// =================================================================================================================
describe('C7-C canonical scope and the Evidence Board', () => {
  test('(14, 15, 16) scope = root Goal → derived Department Goals → live Goal → Work links → their lineage; the board follows canonical Work / Review / C6 changes; no Pilot evaluation store exists', () => {
    withWorld((w) => {
      const { pilot, goalId } = activePilot(w);
      const dept = w.goals.propose(w.s.founder, { kind: 'DEPARTMENT', departmentId: w.s.departmentId, parentGoalId: goalId, title: 'بحث السوق', summary: 'x', ownerRef: w.s.employee.ref });
      const a = prepared(w);
      const b = prepared(w);
      const outside = prepared(w);
      w.goals.linkWork(w.s.founder, goalId, a);
      const linkB = w.goals.linkWork(w.s.founder, dept.id, b);
      const { workItem: child } = w.h.store.createWorkItem({ objective: 'sub-task', ownerRef: w.s.employee.ref, processorKind: 'test.noop', parentId: a });
      const scope = w.pilots.scope(pilot.id);
      assert.deepEqual([...scope.derivedGoalIds], [dept.id]);
      assert.deepEqual(new Set(scope.workItemIds), new Set([a, b, child.id]), 'linked work and its lineage, nothing else');
      assert.ok(!scope.workItemIds.includes(outside));
      w.goals.unlinkWork(w.s.founder, linkB.id, 'goal.rescoped');
      assert.ok(!w.pilots.scope(pilot.id).workItemIds.includes(b), 'an ended link leaves the scope');
      let board = w.pilots.board(pilot.id);
      assert.equal(board.outcomes.qualifiedOutcomes, 0);
      assert.equal(board.outcomes.underReview, 1);
      review(w, a, 'PASS');
      w.m.verifyOutcome(w.s.founder, a, { verdict: 'ACHIEVED', evidenceClasses: ['REVIEW_DECISION', 'WORK_LINEAGE'], evidenceRefs: [`work_item:${a}`], reasonCode: 'founder.verified' });
      w.m.evaluate(a);
      board = w.pilots.board(pilot.id);
      assert.equal(board.outcomes.qualifiedOutcomes, 1, '(16) the board follows C6 truth at once');
      assert.equal(board.reviewIntegrity.independentDecisions, 1);
      assert.equal(board.reviewIntegrity.makerSelfDecisions, 0, '(27) no maker decided its own review');
      // (15) the only new tables are the Pilot identity and its history: no evaluation / profile / cost / review copy.
      const tables = db(w).all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'pilot%' OR name LIKE 'c7c%')`).map((t) => t.name).sort();
      assert.deepEqual(tables, ['pilot_history', 'pilots']);
    });
  });

  test('(17, 50, 48, 49) Rule A: no title, message body or Goal text in audit / events; no private-content column; a secret title is refused at the store and at the preview', () => {
    withWorld((w) => {
      const { pilot } = activePilot(w);
      w.pilots.advance(w.s.founder, pilot.id, { to: 'STOPPED', reasonCode: 'pilot.stopped' });
      const telemetry = JSON.stringify(db(w).all(`SELECT * FROM audit_events WHERE action LIKE 'pilot.%' OR action LIKE 'founder.%'`)) + JSON.stringify(db(w).all('SELECT * FROM events'));
      for (const content of [TITLE, BODY, 'إطلاق قنديل في مصر', 'موقع إطلاق جاهز']) assert.ok(!telemetry.includes(content), `telemetry carries no content: ${content}`);
      assert.ok(w.h.store.auditByAction('pilot.active').length === 1);
      const secret = `launch ${'AKIA'}${'ABCDEFGHIJKLMNOP'}`;
      assert.throws(() => w.pilots.create(w.s.founder, { mode: 'TRAINING_INTERNAL', title: secret }), reason('SECRET_MATERIAL'));
      const auth = FounderAuthStore.for(w.h.store);
      const session = auth.redeemLaunchToken(auth.mintLaunchToken().token).session;
      assert.throws(() => FounderActionStore.for(w.h.store, auth).preview(session, 'PILOT_CREATE', { mode: 'TRAINING_INTERNAL', title: secret }), reason('SECRET_MATERIAL'));
      assert.ok(!JSON.stringify(db(w).all('SELECT * FROM founder_action_previews')).includes('AKIA'), 'a refused secret never enters the durable preview');
      for (const t of ['pilots', 'pilot_history']) {
        const cols = db(w).all<{ name: string }>(`PRAGMA table_info(${t})`).map((c) => c.name);
        assert.ok(!cols.some((c) => /transcript|audio|prompt|conversation|memory|analysis|user|secret|token|credential|score|rank/.test(c)), `${t}: ${cols.join()}`);
      }
    });
  });

  test('(18, 19, 20, 23, 24) activity is observability only; one good task is not broad excellence; the eight C6 dimensions and C6 minimum evidence hold; no score or rank exists', () => {
    withWorld((w) => {
      const { pilot, goalId } = activePilot(w);
      // Activity: several runs / messages / tool-free work, never reviewed.
      for (let i = 0; i < 3; i++) {
        const id = prepared(w);
        w.goals.linkWork(w.s.founder, goalId, id);
        w.m.evaluate(id);
      }
      let board = w.pilots.board(pilot.id);
      const states = Object.fromEntries(board.readiness.map((r) => [r.criterion, r.state]));
      assert.ok(board.observability.runs >= 3);
      for (const c of ['REVIEW_DISCIPLINE', 'APPROPRIATE_AUTONOMY', 'LEARNING_CLOSURE', 'CROSS_DEPARTMENT_EXECUTION'] as const) assert.notEqual(states[c], 'SUPPORTED', `(18) activity never supports ${c}`);
      assert.equal(states.COST_DISCIPLINE, 'CONCERN', '(37) money spent with zero qualified outcomes is never efficient');
      // One qualified task.
      w.goals.linkWork(w.s.founder, goalId, qualified(w));
      board = w.pilots.board(pilot.id);
      const person = board.people.find((p) => p.employeeId === w.s.employee.id);
      assert.ok(person);
      assert.deepEqual(person.dimensions.map((d) => d.dimension), [...PERFORMANCE_DIMENSIONS], '(24) exactly the eight C6 dimensions, no ninth');
      for (const d of person.dimensions) assert.notEqual(d.level, 'STRONG', `(19) one good task never makes ${d.dimension} STRONG`);
      assert.equal(person.dimensions.find((d) => d.dimension === 'OUTCOME')?.state, 'INSUFFICIENT_EVIDENCE', '(20) C6 minimum sample holds');
      assert.deepEqual(board.autonomy.dimensions, ['JUDGMENT', 'INDEPENDENCE'], '(24) autonomy reads JUDGMENT + INDEPENDENCE only');
      // (20) on the same work the scoped profile is the C6 profile (same kernel, same facts).
      const c6 = w.m.profile(w.s.employee.id);
      assert.deepEqual(person.dimensions.map((d) => [d.dimension, d.state, d.sample, d.confidence]), c6.dimensions.map((d) => [d.dimension, d.state, d.sample, d.confidence]));
      // (23) nothing anywhere is a score, rank, leaderboard, rating, grade or percentage; people are listed by id, not by any measure.
      const keys = JSON.stringify(board).match(/"[A-Za-z_]+":/g) ?? [];
      assert.ok(!keys.some((k) => /score|rank|leaderboard|rating|grade|percent|overall/i.test(k)), keys.filter((k) => /score|rank|rating|grade|percent|overall/i.test(k)).join());
      assert.deepEqual(board.people.map((p) => p.employeeId), [...board.people.map((p) => p.employeeId)].sort());
    });
  });

  test('(35, 36) Pilot economics are the canonical ledger through C6 cost per qualified outcome (failures and rework included)', () => {
    withWorld((w) => {
      const { pilot, goalId } = activePilot(w);
      const good = qualified(w);
      const failed = prepared(w);
      review(w, failed, 'FAIL');
      w.goals.linkWork(w.s.founder, goalId, good);
      w.goals.linkWork(w.s.founder, goalId, failed);
      w.m.evaluate(failed);
      const board = w.pilots.board(pilot.id);
      assert.deepEqual(board.economics, w.m.economics({ goalId }), 'the same C6 computation over the same canonical facts');
      assert.deepEqual(w.pilots.decisions(pilot.id), board.decisionsNeeded, 'the cheap decisions read agrees with the board');
      assert.equal(board.economics.qualifiedOutcomes, 1);
      assert.ok(board.economics.totalCostMicros > 0 && board.economics.costPerQualifiedOutcomeMicros === board.economics.totalCostMicros, 'the failed item\'s cost is carried by the qualified outcome');
      assert.equal(board.readiness.find((r) => r.criterion === 'COST_DISCIPLINE')?.state, 'SUPPORTED');
    });
  });
});

// =================================================================================================================
describe('C7-C external outcomes (C7-A) and desired controls (C7-B)', () => {
  test('(38) TRAINING_INTERNAL runs without external evidence and never claims market success', () => {
    withWorld((w) => {
      const { pilot, goalId } = activePilot(w);
      w.goals.linkWork(w.s.founder, goalId, qualified(w));
      const board = w.pilots.board(pilot.id);
      assert.equal(board.external.marketClaim, 'NOT_CLAIMABLE_TRAINING_INTERNAL');
      assert.equal(board.readiness.find((r) => r.criterion === 'REAL_WORLD_OUTCOME')?.state, 'NOT_APPLICABLE');
    });
  });

  test('(39, 40, 41) a CONTROLLED_REAL market claim needs current governed C7-A evidence; a late conflict contests it at once; the Founder\'s resolution follows C7-A current truth', () => {
    withWorld((w) => {
      const { pilot, goalId } = activePilot(w, 'CONTROLLED_REAL', true);
      const plain = qualified(w);
      w.goals.linkWork(w.s.founder, goalId, plain);
      let board = w.pilots.board(pilot.id);
      assert.deepEqual([board.external.marketClaim, board.readiness.find((r) => r.criterion === 'REAL_WORLD_OUTCOME')?.state], ['NOT_SUPPORTED', 'CONCERN'], '(39) internal quality is not market success; required evidence is missing');
      const x = ExternalEvidenceStore.for(w.h.store);
      const src = x.registerSource(w.s.founder, { sourceKey: 'web-analytics.main', family: 'WEB_ANALYTICS', contractCode: 'outcome.metrics', contractVersion: 1 }).source;
      x.decideSource(w.s.founder, src.id, { decision: 'ACTIVATE', reasonCode: 'founder.trusted' });
      const metric = (value: number) => ({ sourceKey: 'web-analytics.main', contractCode: 'outcome.metrics', contractVersion: 1, producerEventId: 'm-1', type: 'web.sessions', occurredAt: '2026-09-26T10:00:00.000Z', scope: { kind: 'SITE', ref: 'qandeel-site' }, window: { from: '2026-09-19T00:00:00.000Z', to: '2026-09-26T00:00:00.000Z' }, fields: { value } });
      const rec = x.ingest(metric(1200)).record;
      const real = prepared(w);
      review(w, real, 'PASS');
      x.bindEvidence(w.s.founder, { recordId: rec.id, subjectKind: 'WORK_ITEM', subjectId: real, role: 'OUTCOME_EVIDENCE', reasonCode: 'founder.relevant' });
      const v = w.m.verifyOutcome(w.s.founder, real, { verdict: 'ACHIEVED', evidenceClasses: ['EXTERNAL_OUTCOME', 'REVIEW_DECISION'], evidenceRefs: [rec.ref], reasonCode: 'founder.verified' });
      w.m.evaluate(real);
      w.goals.linkWork(w.s.founder, goalId, real);
      board = w.pilots.board(pilot.id);
      assert.deepEqual([board.external.marketClaim, board.external.qualifiedWithCurrentExternal], ['SUPPORTED_BY_GOVERNED_EVIDENCE', 1], '(39) supported only by governed evidence');
      assert.throws(() => x.ingest(metric(5)), code('INTAKE_CONFLICT'));
      board = w.pilots.board(pilot.id);
      assert.deepEqual([board.external.marketClaim, board.outcomes.contested, board.readiness.find((r) => r.criterion === 'REAL_WORLD_OUTCOME')?.state], ['CONTESTED', 1, 'CONTESTED'], '(40) a late conflict contests the Pilot claim immediately');
      w.m.resolveOutcomeContest(w.s.founder, v.verificationId, { decision: 'UPHOLD', reasonCode: 'founder.upheld' });
      board = w.pilots.board(pilot.id);
      assert.deepEqual([board.external.marketClaim, board.outcomes.contested], ['SUPPORTED_BY_GOVERNED_EVIDENCE', 0], '(41) the Founder\'s C7-A resolution is current truth again');
      assert.ok(count(w, `SELECT COUNT(*) AS n FROM outcome_verification_validity`) >= 2, 'history is kept, never rewritten');
    });
  });

  test('(42, 43, 44) an issued C7-B control is desired-state context only: never an outcome, never an App effect', () => {
    withWorld((w) => {
      const { pilot, goalId } = activePilot(w);
      const lead = placed(w.h, w.s, 'product.app-operations-release-lead');
      w.s.gov.grant(w.s.founder, { employeeId: lead.id, capability: 'app-control.issue', resourceScope: '*', riskCeiling: 'R3', dataClassCeiling: 'D1', reasonCode: 'founder.grant' });
      const run = runFor(w.h, w.s, lead, { reviewPlan: reviewPlan({ appliesTo: 'ACTIONS' }) });
      const out = recordOrgAct(w.h.store, run.claim.fence, 1, 'control.propose', { family: 'FEATURE_FLAG', scope: { kind: 'CAPABILITY', capability: 'voice.call' }, operation: 'SET', value: { state: 'DISABLED' }, reasonCode: 'incident.voice-errors', evidenceRefs: [], expectedRevision: 0 });
      assert.equal(out.outcome, 'DONE', out.code);
      decideActionReview(w.h, run.workItemId, 'PASS');
      const controls = AppControlStore.for(w.h.store);
      const proposal = controls.proposals({ workItemId: run.workItemId })[0];
      w.s.gov.decideApproval(w.s.founder, String(proposal?.approvalId), { decision: 'APPROVE', reasonCode: 'founder.approved' });
      w.goals.linkWork(w.s.founder, goalId, run.workItemId);
      const board = w.pilots.board(pilot.id);
      assert.equal(board.controls.proposals.ISSUED, 1, '(42) visible as desired-state context');
      assert.deepEqual([board.controls.desiredStateOnly, board.controls.countsAsOutcome, board.controls.appEffectKnown], [true, false, false]);
      assert.equal(board.outcomes.qualifiedOutcomes, 0, '(43) an issued control is never a Pilot outcome');
      assert.ok(!/APPLIED|ACKNOWLEDGED|EFFECTIVE_IN_APP/.test(JSON.stringify(board)), '(44) no App-applied / effective claim');
      assert.ok(w.pilots.inspect(pilot.id, run.workItemId).lineageRefs.some((r) => r.startsWith('app_control_proposal:')), 'the trace references the proposal, never copies it');
    });
  });
});

// =================================================================================================================
describe('C7-C restart, idempotency, atomicity, the governed confirmation and the release', () => {
  test('(45, 46, 47) restart keeps state and bindings; a repeated step is a no-op; a failure around a step leaves neither the step nor a binding', () => {
    withWorld((w) => {
      const p = w.pilots.advance(w.s.founder, w.pilots.create(w.s.founder, { mode: 'TRAINING_INTERNAL', title: TITLE }).id, { to: 'BRIEFING', reasonCode: 'pilot.briefing' });
      ask(w, p, false);
      // (47) the history insert fails inside the step's transaction: nothing of the step survives.
      const threadsBefore = count(w, 'SELECT COUNT(*) AS n FROM communication_threads');
      const draft = w.pilots.create(w.s.founder, { mode: 'TRAINING_INTERNAL', title: 'تجربة ذرية' });
      db(w).run(`CREATE TEMP TRIGGER c7c_fail_history BEFORE INSERT ON pilot_history WHEN NEW.to_state = 'BRIEFING' BEGIN SELECT RAISE(ABORT, 'injected crash'); END`);
      aborts(() => w.pilots.advance(w.s.founder, draft.id, { to: 'BRIEFING', reasonCode: 'pilot.briefing' }), 'the injected failure aborts the step');
      db(w).run('DROP TRIGGER c7c_fail_history');
      assert.deepEqual([w.pilots.get(draft.id).state, w.pilots.get(draft.id).briefingThreadId, count(w, 'SELECT COUNT(*) AS n FROM communication_threads')], ['DRAFT', null, threadsBefore], 'no step, no thread, no binding');
      const retried = w.pilots.advance(w.s.founder, draft.id, { to: 'BRIEFING', reasonCode: 'pilot.briefing' });
      assert.equal(w.pilots.history(draft.id).length, 2, 'exactly one history row for the step');
      // (46) the same step again is deterministic and idempotent.
      assert.deepEqual(w.pilots.advance(w.s.founder, draft.id, { to: 'BRIEFING', reasonCode: 'pilot.briefing' }), retried);
      assert.equal(w.pilots.history(draft.id).length, 2);
      // (45) restart: a new process over the same workspace sees the same Pilot, binding and pending briefing.
      w.h.store.close();
      const reopened = w.h.open();
      const again = PilotStore.for(reopened);
      assert.deepEqual(again.get(p.id), p);
      assert.equal(again.get(p.id).briefingThreadId, p.briefingThreadId);
      assert.equal(again.briefing(p.id).pending.length, 1, 'the open briefing request is not forgotten');
      assert.throws(() => again.advance(w.s.founder, p.id, { to: 'READY', reasonCode: 'pilot.ready' }), reason('NO_GOVERNED_BRIEFING_REPLY'), 'restart never turns silence into acceptance');
      assert.equal(again.list().length, 2, 'no duplicate Pilot');
    });
  });

  test('the governed confirmation: PILOT_CREATE / PILOT_ADVANCE are previewed, fingerprinted and confirmed once; a preview never offers a refused step; GOAL_PROPOSE carries success criteria', () => {
    withWorld((w) => {
      const auth = FounderAuthStore.for(w.h.store);
      const session = auth.redeemLaunchToken(auth.mintLaunchToken().token).session;
      const actions = FounderActionStore.for(w.h.store, auth);
      const create = actions.preview(session, 'PILOT_CREATE', { mode: 'TRAINING_INTERNAL', title: TITLE });
      const created = actions.confirm(session, create.id, create.fingerprint);
      const pilotId = created.resultRef.slice('pilot:'.length);
      assert.equal(w.pilots.get(pilotId).state, 'DRAFT');
      assert.throws(() => actions.confirm(session, create.id, create.fingerprint), code('FOUNDER_CONFIRMATION_REQUIRED'), 'confirmed exactly once');
      assert.equal(w.pilots.list().length, 1, 'no duplicate pilot from a repeated confirm');
      assert.throws(() => actions.preview(session, 'PILOT_ADVANCE', { pilotId, to: 'READY' }), code('PILOT_INVALID'), 'DRAFT → READY is never offered');
      const brief = actions.preview(session, 'PILOT_ADVANCE', { pilotId, to: 'BRIEFING' });
      actions.confirm(session, brief.id, brief.fingerprint);
      assert.throws(() => actions.preview(session, 'PILOT_ADVANCE', { pilotId, to: 'READY' }), reason('NO_GOVERNED_BRIEFING_REPLY'), 'READY is never offered without the governed reply');
      ask(w, w.pilots.get(pilotId));
      const ready = actions.preview(session, 'PILOT_ADVANCE', { pilotId, to: 'READY' });
      assert.deepEqual([ready.payload.answeredBriefingRequests, ready.payload.unansweredBriefingRequests], [1, 0]);
      actions.confirm(session, ready.id, ready.fingerprint);
      const goal = actions.preview(session, 'GOAL_PROPOSE', { kind: 'COMPANY', title: 'إطلاق قنديل في مصر', summary: 'تحضير.', ownerRef: w.ceo.ref, activate: true, successCriteria: ['موقع جاهز', 'خطة إطلاق'] });
      const goalId = actions.confirm(session, goal.id, goal.fingerprint).resultRef.slice('goal:'.length);
      assert.deepEqual(w.goals.get(goalId as Id).successCriteria, ['موقع جاهز', 'خطة إطلاق']);
      const activate = actions.preview(session, 'PILOT_ADVANCE', { pilotId, to: 'ACTIVE', goalId });
      actions.confirm(session, activate.id, activate.fingerprint);
      assert.deepEqual([w.pilots.get(pilotId).state, w.pilots.get(pilotId).rootGoalId], ['ACTIVE', goalId]);
      assert.throws(() => actions.preview(session, 'PILOT_ADVANCE', { pilotId, to: 'ACTIVE', goalId }), code('INVALID_TRANSITION'), 'a step already taken is not offered again');
    });
  });

  test('migration 0014: a released v13 Company upgrades to v14 keeping every preview row; 0001–0013 stay byte-identical', () => {
    const root = tempRoot('c7c-v13');
    try {
      const v13 = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(13) });
      assert.equal(v13.schemaVersion, 13);
      const d13 = storeContext(v13).db;
      const before = { previews: Number(d13.get<{ n: number }>('SELECT COUNT(*) AS n FROM founder_action_previews')?.n), audit: Number(d13.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events')?.n), goals: Number(d13.get<{ n: number }>('SELECT COUNT(*) AS n FROM goals')?.n) };
      v13.close();
      const v14 = openStoreForTests(root, { clock: new ManualClock(), liveSchemaUpdate: true });
      try {
        assert.deepEqual(v14.migration.applied, [14, 15, 16, 17]);
        const d = storeContext(v14).db;
        assert.deepEqual({ previews: Number(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM founder_action_previews')?.n), audit: Number(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events')?.n), goals: Number(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM goals')?.n) }, before);
        assert.equal(Number(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM pilots')?.n), 0, 'the release creates no Pilot');
        assert.deepEqual(d.all('PRAGMA foreign_key_check'), []);
        assert.equal(v14.quickCheck(), 'ok');
      } finally {
        v14.close();
      }
    } finally {
      removeRoot(root);
    }
  });
});
