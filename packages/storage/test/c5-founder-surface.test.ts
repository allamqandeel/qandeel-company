/**
 * C5 storage proofs: the authenticated Founder surface fails closed (a ref is not authentication; sessions
 * are hashes, expire, revoke; the scope is synchronous), the durable Goal model, Founder-facing communication
 * (an Employee writes only from its own run, into its own thread, and never gains authority), Founder
 * Attention (dedup, cooldown, routine excluded), governed action previews and the deterministic,
 * time-correct Company Universe projection.
 * C5-PROOF: founder-surface
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { QandeelError, isQandeelError, type Id } from '@qandeel-company/domain';

import { AttentionStore, CommunicationStore, FounderActionStore, FounderAuthStore, GoalStore, OrganizationStore, LAUNCH_TOKEN_TTL_MS, ReviewStore, SESSION_TTL_MS, projectUniverse, runRestoreDrill } from '../src/index.js';
import { recordGoalAct, recordMessage, recordToolIntent, recordToolResult, settle } from '../src/runtime-authority.js';
import { armFounderTestSurface, disarmFounderTestSurface } from '../src/testing/founder-seam.js';
import { GOVERNED_KIND, claimGoverned, governedItem, hire, seed, type Seed } from './c2-helpers.js';
import { activeReviewer, claimItem, decideAssignment, newSeat, placed, reviewPlan, runFor, seat } from './c4-helpers.js';
import { backoff, harness, type Harness } from './helpers.js';

/** The value a proof relies on, present by construction of the fixture. */
function must<T>(v: T | null | undefined, what = 'value'): T {
  if (v === null || v === undefined) throw new Error(`${what} is missing`);
  return v;
}

const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;

function withSeed(fn: (h: Harness, s: Seed) => void): void {
  const h = harness();
  try {
    fn(h, seed(h.store));
  } finally {
    h.close();
  }
}

/** A live session for the seeded workspace (the launch token stands in for the Windows-user boundary). */
function session(h: Harness): { auth: FounderAuthStore; cookie: string; csrf: string; session: ReturnType<FounderAuthStore['verifySession']> } {
  const auth = FounderAuthStore.for(h.store);
  const { token } = auth.mintLaunchToken();
  const out = auth.redeemLaunchToken(token);
  return { auth, cookie: out.cookieValue, csrf: out.csrf, session: out.session };
}

const pendingApproval = (h: Harness, s: Seed): Id => {
  const { workItem } = h.store.createWorkItem({ objective: 'campaign', ownerRef: s.employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', instructions: 'x' }, riskLevel: 'R3', approvalRequired: true, initialState: 'READY' });
  return s.gov.requestWorkItemApproval(s.employee.ref, workItem.id).id;
};

describe('C5 Founder surface — authentication fails closed', () => {
  test('C5-PROOF: production has no armed surface: a Founder ref is not authentication; a verified session arms exactly one synchronous scope', () => {
    withSeed((h, s) => {
      disarmFounderTestSurface(h.root);
      const goals = GoalStore.for(h.store);
      const input = { kind: 'COMPANY' as const, title: 'إطلاق السعودية', summary: 'دخول السوق.', ownerRef: s.employee.ref };
      assert.throws(() => goals.propose(s.founder, input), code('FOUNDER_SURFACE_UNAVAILABLE'), 'outside any session the chokepoint stays closed');
      assert.equal(h.store.auditByAction('governance.refused').length >= 1, true, 'the refusal is audited (content-free)');
      const { auth, session: sess } = session(h);
      const g = auth.withSession(sess, (founderRef) => {
        assert.equal(founderRef, s.founder);
        return goals.propose(founderRef, input);
      });
      assert.equal(g.state, 'PROPOSED');
      assert.throws(() => goals.transition(s.founder, g.id, { to: 'APPROVED', reasonCode: 'x' }), code('FOUNDER_SURFACE_UNAVAILABLE'), 'the scope closed with the callback');
      assert.throws(() => auth.withSession(sess, () => Promise.resolve(1) as unknown as number), code('ASYNC_IN_TRANSACTION'), 'a scope never spans an await');
      assert.throws(() => auth.withSession({ id: sess.id, founderRef: sess.founderRef, expiresAt: sess.expiresAt }, () => 1), code('FOUNDER_SESSION_INVALID'), 'a look-alike handle is not a verified session');
      armFounderTestSurface(h.root);
    });
  });

  test('C5-PROOF: launch tokens are single-use and short-lived; sessions are hashed at rest, verified per request, expire and revoke', () => {
    withSeed((h) => {
      const auth = FounderAuthStore.for(h.store);
      const { token } = auth.mintLaunchToken();
      assert.throws(() => auth.redeemLaunchToken('not-a-token'), code('FOUNDER_SESSION_INVALID'));
      const first = auth.redeemLaunchToken(token);
      assert.throws(() => auth.redeemLaunchToken(token), code('FOUNDER_SESSION_INVALID'), 'consumed once');
      const { token: stale } = auth.mintLaunchToken();
      h.clock.advance(LAUNCH_TOKEN_TTL_MS + 1);
      assert.throws(() => auth.redeemLaunchToken(stale), code('FOUNDER_SESSION_INVALID'), 'expired');
      // Hashes only at rest: no session row contains the cookie or CSRF value.
      const rows = auth.sessions();
      assert.equal(rows.length, 1);
      assert.ok(!JSON.stringify(rows).includes(first.cookieValue) && !JSON.stringify(rows).includes(first.csrf));
      const verified = auth.verifySession(first.cookieValue);
      assert.equal(verified.founderRef, first.session.founderRef);
      assert.throws(() => auth.verifySession(first.cookieValue.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))), code('FOUNDER_SESSION_INVALID'));
      assert.throws(() => auth.verifySession(first.cookieValue, 'x'.repeat(43)), code('FOUNDER_SESSION_INVALID'), 'CSRF mismatch');
      assert.equal(auth.verifySession(first.cookieValue, first.csrf).id, first.session.id);
      auth.revokeSession(first.session.id, 'founder.logout');
      assert.throws(() => auth.verifySession(first.cookieValue), code('FOUNDER_SESSION_INVALID'), 'revoked');
      assert.throws(() => auth.withSession(first.session, () => 1), code('FOUNDER_SESSION_INVALID'), 'a revoked session cannot enter a scope even with the old handle');
      const second = auth.redeemLaunchToken(auth.mintLaunchToken().token);
      // Kept alive by use (every hour, well inside the idle window) … until the absolute TTL, which no activity extends.
      const hour = 60 * 60 * 1000;
      for (let i = 0; i < 7; i++) {
        h.clock.advance(hour);
        assert.equal(auth.verifySession(second.cookieValue).id, second.session.id, 'an active session stays valid inside its TTL');
      }
      h.clock.advance(SESSION_TTL_MS - 7 * hour + 1);
      assert.throws(() => auth.verifySession(second.cookieValue), code('FOUNDER_SESSION_INVALID'), 'expired session (absolute TTL, even while in use)');
      assert.throws(() => auth.withSession(second.session, () => 1), code('FOUNDER_SESSION_INVALID'), 'an expired handle cannot enter a scope either');
      assert.equal(auth.revokeAll('surface.stopped'), 1, 'stop revokes every unrevoked row, expired or not (fail closed)');
      const refusals = h.store.auditByAction('founder.request_refused');
      assert.ok(refusals.length >= 4 && refusals.every((a) => !JSON.stringify(a.details).includes(first.cookieValue)), 'refusals are audited without the secret');
    });
  });
});

describe('C5 Goals', () => {
  test('C5-PROOF: a company goal is Founder-approved; a Department goal derives from an approved parent; links and history are durable', () => {
    withSeed((h, s) => {
      const goals = GoalStore.for(h.store);
      const g = goals.propose(s.founder, { kind: 'COMPANY', title: 'إطلاق السعودية', summary: 'دخول السوق السعودي.', ownerRef: s.employee.ref, horizonTo: '2026-12-31T00:00:00.000Z' });
      assert.throws(() => goals.propose(s.founder, { kind: 'DEPARTMENT', departmentId: s.departmentId, parentGoalId: g.id, title: 'x', summary: 'y', ownerRef: s.employee.ref }), code('GOAL_INVALID'), 'no derivation from an unapproved parent');
      assert.throws(() => goals.transition(s.founder, g.id, { to: 'ACTIVE', reasonCode: 'x' }), code('GOAL_INVALID'), 'PROPOSED → ACTIVE skips approval');
      const approved = goals.transition(s.founder, g.id, { to: 'APPROVED', reasonCode: 'goal.approved' });
      assert.equal(approved.approvedByRef, s.founder);
      h.clock.advance(1_000);
      const active = goals.transition(s.founder, g.id, { to: 'ACTIVE', reasonCode: 'goal.activated' });
      const child = goals.propose(s.founder, { kind: 'DEPARTMENT', departmentId: s.departmentId, parentGoalId: active.id, title: 'نمو عضوي', summary: 'محتوى عربي.', ownerRef: s.employee.ref });
      assert.equal(child.parentGoalId, g.id);
      const { workItem } = h.store.createWorkItem({ objective: 'keyword map', ownerRef: s.employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', instructions: 'x' } });
      const link = goals.linkWork(s.founder, g.id, workItem.id);
      assert.equal(goals.linkWork(s.founder, g.id, workItem.id).id, link.id, 'idempotent');
      assert.deepEqual(goals.links({ goalId: g.id, live: true }).map((l) => l.workItemId), [workItem.id]);
      goals.unlinkWork(s.founder, link.id, 'goal.rescoped');
      assert.equal(goals.links({ goalId: g.id, live: true }).length, 0);
      assert.deepEqual(goals.history(g.id).map((x) => x.toState), ['PROPOSED', 'APPROVED', 'ACTIVE']);
      assert.equal(goals.stateAt(g.id, must(goals.history(g.id)[1]).occurredAt), 'APPROVED');
      const audit = h.store.auditByAction('goal.proposed');
      assert.ok(audit.length >= 2 && !JSON.stringify(audit).includes('السعودية'), 'goal text never enters audit (Rule A)');
      // An employee actor never decides a company goal by ref.
      assert.throws(() => goals.transition(s.employee.ref, child.id, { to: 'APPROVED', reasonCode: 'x' }), (e: unknown) => isQandeelError(e) && ['AUTHORITY_DENIED', 'FOUNDER_ONLY', 'SELF_ESCALATION_REFUSED'].includes(e.code));
    });
  });
});

describe('C5 communication', () => {
  test('C5-PROOF: the Founder\'s question creates the reply Work Item; only that run posts into the thread; a message grants nothing', () => {
    withSeed((h, s) => {
      const org = OrganizationStore.for(h.store);
      const ceo = placed(h, s, 'company.ceo');
      const comm = CommunicationStore.for(h.store);
      assert.throws(() => comm.send(s.founder, '00000000-0000-4000-8000-000000000000', { purpose: 'QUESTION', body: 'x' }), code('NOT_FOUND'));
      const thread = comm.directThread(s.founder, null);
      assert.deepEqual([thread.kind, thread.employeeId, thread.accessScope], ['FOUNDER_CEO', ceo.id, 'FOUNDER_ONLY']);
      assert.equal(comm.directThread(s.founder, null).id, thread.id, 'one open direct thread per employee');
      const grantsBefore = s.gov.grants(ceo.id).length;
      const sent = comm.send(s.founder, thread.id, { purpose: 'QUESTION', body: 'ما وضع الإطلاق؟' });
      assert.ok(sent.replyWorkItemId);
      const reply = h.store.getWorkItem(must(sent.replyWorkItemId));
      assert.deepEqual([reply.ownerRef, reply.state, reply.riskLevel], [ceo.ref, 'READY', 'R1']);
      assert.ok(s.gov.budgetFor('WORK_ITEM', reply.id), 'funded from the CEO envelope');
      assert.deepEqual(comm.pendingReplies().map((p) => p.replyWorkItemId), [reply.id]);
      // Another employee's run cannot post into this thread.
      const other = hire(s.gov, s.founder, s.departmentId);
      s.gov.createBudget(s.founder, { scope: 'EMPLOYEE', scopeId: other.id, capMoney: 100_000, capTokens: 100_000, reasonCode: 'seed' });
      const { workItem: foreign } = h.store.createWorkItem({ objective: 'foreign', ownerRef: other.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', instructions: 'x', founderThreadId: thread.id } });
      s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: foreign.id, capMoney: 10_000, capTokens: 10_000, reasonCode: 'seed' });
      h.store.transitionWorkItem(foreign.id, { to: 'READY', reasonCode: 'release' });
      const foreignClaim = claimItem(h, foreign.id, 'w-foreign');
      const refused = recordMessage(h.store, foreignClaim.fence, { purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'hi', brief: null, contextRefs: [] });
      assert.deepEqual([refused.outcome, refused.code], ['REFUSED', 'NOT_THREAD_PARTICIPANT']);
      settle(h.store, foreignClaim.fence, { type: 'COMPLETED' }, { backoff });
      // The CEO's own reply run posts once; a replay of the same body is not a second message.
      const claim = claimItem(h, reply.id, 'w-ceo');
      const first = recordMessage(h.store, claim.fence, { purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'الإطلاق على المسار.', brief: null, contextRefs: [] });
      assert.deepEqual([first.outcome, first.code], ['RECORDED', 'RECORDED']);
      const again = recordMessage(h.store, claim.fence, { purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'الإطلاق على المسار.', brief: null, contextRefs: [] });
      assert.deepEqual([again.outcome, again.code, again.messageId], ['RECORDED', 'REPLAYED', first.messageId]);
      const bad = recordMessage(h.store, claim.fence, { purpose: 'BRIEF', attentionLevel: 'NEEDS_DECISION', body: 'x', brief: null, contextRefs: [] });
      assert.equal(bad.code, 'BRIEF_SHAPE');
      settle(h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
      assert.equal(comm.pendingReplies().length, 0, 'answered');
      const meta = comm.messageMeta(thread.id);
      assert.deepEqual(meta.map((m) => [m.senderKind, m.purpose]), [['FOUNDER', 'QUESTION'], ['EMPLOYEE', 'RESULT']]);
      assert.ok(!('body' in (meta[0] as object)), 'metadata carries no body');
      assert.equal(s.gov.grants(ceo.id).length, grantsBefore, 'conversation ≠ authority');
      const audit = JSON.stringify(h.store.auditByAction('communication.message'));
      assert.ok(audit.includes('QUESTION') && !audit.includes('الإطلاق'), 'message bodies never enter audit (Rule A)');
      void org;
    });
  });

  test('C5-PROOF: a CEO brief is a governed run of the CEO seat holder; one open brief per context; the brief itself needs the standard', () => {
    withSeed((h, s) => {
      const comm = CommunicationStore.for(h.store);
      assert.throws(() => comm.requestCeoBrief({ subject: 'x', contextKind: 'APPROVAL', contextRef: 'approval:1', reasonCode: 'brief.test', instructions: 'brief' }), code('ORG_NOT_ELIGIBLE'), 'a vacant CEO seat cannot brief');
      const ceo = placed(h, s, 'company.ceo');
      const a = comm.requestCeoBrief({ subject: 'قرار مطلوب', contextKind: 'APPROVAL', contextRef: 'approval:1', reasonCode: 'brief.test', instructions: 'brief' });
      const b = comm.requestCeoBrief({ subject: 'قرار مطلوب', contextKind: 'APPROVAL', contextRef: 'approval:1', reasonCode: 'brief.test', instructions: 'brief' });
      assert.deepEqual([a.thread.id === b.thread.id, b.replayed, a.workItemId === b.workItemId], [true, true, true], 'one open brief per context');
      assert.equal(h.store.getWorkItem(a.workItemId).ownerRef, ceo.ref);
      const claim = claimItem(h, a.workItemId, 'w-brief');
      const shaped = recordMessage(h.store, claim.fence, { purpose: 'BRIEF', attentionLevel: 'INFORMATIONAL', body: 'موجز', brief: { happening: 'a', matters: 'b', recommendation: 'c', decisionNeeded: true, decision: 'd' }, contextRefs: [] });
      assert.equal(shaped.outcome, 'RECORDED');
      const m = must(comm.messages(a.thread.id).find((x) => x.purpose === 'BRIEF'));
      assert.equal(m.attentionLevel, 'NEEDS_DECISION', 'a decision-needed brief is NEEDS_DECISION whatever the model said');
      assert.equal(m.responseRequired, true);
      settle(h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
    });
  });
});

describe('C5 Founder Attention', () => {
  test('C5-PROOF: derived from canonical sources, deduplicated, cooled down, resolved with the source; routine work never enters', () => {
    withSeed((h, s) => {
      const attention = AttentionStore.for(h.store);
      assert.equal(attention.sync().open, 0);
      // Routine completed work: nothing.
      const { workItem: routine } = h.store.createWorkItem({ objective: 'routine', ownerRef: s.employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', instructions: 'x' }, initialState: 'READY' });
      s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: routine.id, capMoney: 10_000, capTokens: 10_000, reasonCode: 'seed' });
      const c = claimItem(h, routine.id, 'w-r');
      settle(h.store, c.fence, { type: 'COMPLETED' }, { backoff });
      assert.equal(attention.sync().open, 0, 'a completed task is not Founder attention');
      const approvalId = pendingApproval(h, s);
      const first = attention.sync();
      assert.deepEqual([first.opened, first.open], [1, 1]);
      const [item] = attention.list();
      assert.deepEqual([must(item).lane, must(item).level, must(item).sourceKind, must(item).sourceRef, must(item).signalCount], ['NEEDS_ME', 'NEEDS_DECISION', 'APPROVAL', `approval:${approvalId}`, 1]);
      assert.deepEqual([attention.sync().opened, attention.sync().signalled], [0, 0], 'idempotent: no storm');
      const goals = GoalStore.for(h.store);
      const g = goals.propose(s.founder, { kind: 'COMPANY', title: 'x', summary: 'y', ownerRef: s.employee.ref });
      assert.equal(attention.sync().open, 2, 'a proposed company goal needs the Founder');
      goals.transition(s.founder, g.id, { to: 'APPROVED', reasonCode: 'ok' });
      const afterApprove = attention.sync();
      assert.deepEqual([afterApprove.resolved, afterApprove.open], [1, 1], 'resolved with its source');
      const dismissed = attention.dismiss(s.founder, must(item).id, 'founder.later');
      assert.equal(dismissed.state, 'DISMISSED');
      assert.equal(attention.sync().open, 0, 'a dismissal stands while the source is unchanged (silence is never approval: the approval is still PENDING)');
      assert.equal(s.gov.getApproval(approvalId).state, 'PENDING');
      s.gov.decideApproval(s.founder, approvalId, { decision: 'REJECT', reasonCode: 'no' });
      assert.equal(attention.sync().resolved, 1);
      assert.equal(attention.list({ state: 'RESOLVED' }).length, 2);
      const audit = JSON.stringify(h.store.auditByAction('founder.attention_synced'));
      assert.ok(audit.includes('opened') && !audit.includes('routine'));
    });
  });
});

describe('C5 governed action previews', () => {
  test('C5-PROOF: a preview mutates nothing; confirmation needs the same session, the exact fingerprint and a live preview; R4 is never offered', () => {
    withSeed((h, s) => {
      const { auth, session: sess } = session(h);
      const actions = FounderActionStore.for(h.store, auth);
      const approvalId = pendingApproval(h, s);
      assert.throws(() => actions.preview(sess, 'EXECUTE_ANYTHING', {}), code('VALIDATION_FAILED'));
      const p = actions.preview(sess, 'APPROVAL_DECIDE', { approvalId, decision: 'APPROVE' });
      assert.deepEqual([p.state, p.intentKind, p.payload.approvalId], ['PREVIEW', 'APPROVAL_DECIDE', approvalId]);
      assert.equal(s.gov.getApproval(approvalId).state, 'PENDING', 'a preview decides nothing');
      assert.throws(() => actions.confirm(sess, p.id, 'wrong'), code('FOUNDER_CONFIRMATION_REQUIRED'));
      assert.equal(s.gov.getApproval(approvalId).state, 'PENDING');
      const other = session(h);
      assert.throws(() => actions.confirm(other.session, p.id, p.fingerprint), code('FOUNDER_CONFIRMATION_REQUIRED'), 'another session cannot confirm');
      const out = actions.confirm(sess, p.id, p.fingerprint);
      assert.deepEqual([out.preview.state, out.resultRef], ['CONFIRMED', `approval:${approvalId}`]);
      // Approving a work_item.execute approval releases the work and consumes the approval in the same transaction.
      assert.ok(['APPROVED', 'CONSUMED'].includes(s.gov.getApproval(approvalId).state), 'decided at the real boundary, inside the session scope');
      assert.throws(() => actions.confirm(sess, p.id, p.fingerprint), code('FOUNDER_CONFIRMATION_REQUIRED'), 'decided exactly once');
      // Expiry.
      const q = actions.preview(sess, 'GOAL_PROPOSE', { kind: 'COMPANY', title: 't', summary: 's', ownerRef: s.employee.ref });
      h.clock.advance(11 * 60_000);
      assert.throws(() => actions.confirm(sess, q.id, q.fingerprint), code('FOUNDER_CONFIRMATION_REQUIRED'));
      assert.equal(actions.get(q.id).state, 'EXPIRED');
      // R4: never previewable (Founder-only sovereignty stays outside the approval engine).
      const { workItem: r4 } = h.store.createWorkItem({ objective: 'r4', ownerRef: s.employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', instructions: 'x' }, riskLevel: 'R4', approvalRequired: true, initialState: 'READY' });
      const r4Approval = s.gov.requestWorkItemApproval(s.employee.ref, r4.id);
      assert.throws(() => actions.preview(sess, 'APPROVAL_DECIDE', { approvalId: r4Approval.id, decision: 'APPROVE' }), code('FOUNDER_ONLY'));
      const audits = h.store.auditByAction('founder.action_confirmed');
      assert.ok(audits.length === 1 && !JSON.stringify(audits).includes('campaign'));
    });
  });
});

/** A governed job held after an uncertain UNSAFE tool effect (the invocation and the job both wait for the Founder). */
function heldExternalEffect(h: Harness, s: Seed): { wi: Id; jobId: Id; invocationId: Id } {
  const tool = s.gov.registerTool(s.founder, { code: 'syncer', driverCode: 'fake-syncer', egress: 'NONE' });
  s.gov.registerToolAction(s.founder, { toolId: tool.id, code: 'sync', risk: 'R1', sideEffects: 'UNSAFE', mutatesExternal: false, dataClassCeiling: 'D3', argsSchema: { fields: {} }, costPerCallMicros: 100 });
  s.gov.grant(s.founder, { employeeId: s.employee.id, capability: 'tool:syncer.sync', riskCeiling: 'R1', dataClassCeiling: 'D3', reasonCode: 'seed' });
  const wi = governedItem(h, s);
  const { claim } = claimGoverned(h);
  const intent = recordToolIntent(h.store, claim.fence, { toolCode: 'syncer', actionCode: 'sync', args: {}, idempotencyKey: `wi:${wi}:s0` });
  if (intent.kind !== 'EXECUTE') throw new Error(intent.kind);
  assert.equal(recordToolResult(h.store, claim.fence, intent.invocationId, { ok: false, code: 'DRIVER_OUTCOME_UNKNOWN', sent: 'UNKNOWN' }), 'RECONCILIATION_REQUIRED');
  settle(h.store, claim.fence, { type: 'RECONCILIATION_REQUIRED', code: 'TOOL_OUTCOME_UNCERTAIN' }, { backoff });
  assert.equal(h.store.getJob(claim.fence.jobId).state, 'RECONCILIATION_HOLD');
  return { wi, jobId: claim.fence.jobId, invocationId: intent.invocationId };
}

describe('R2 — the Founder exception loop, attention identity and confirm atomicity', () => {
  test('R2-26: a confirm is one transaction — an interruption after the effect leaves no effect and no half-decided preview; a multi-step goal act is all-or-nothing', () => {
    withSeed((h, s) => {
      const { auth, session: sess } = session(h);
      const actions = FounderActionStore.for(h.store, auth);
      const goals = GoalStore.for(h.store);
      const propose = GoalStore.prototype.propose;
      const transition = GoalStore.prototype.transition;
      try {
        const p = actions.preview(sess, 'GOAL_PROPOSE', { kind: 'COMPANY', title: 'Launch KSA', summary: 's', ownerRef: s.employee.ref });
        // The process is interrupted right after the effect (STORAGE_BUSY on the next write, a crash, …).
        GoalStore.prototype.propose = function (this: GoalStore, ...args: Parameters<GoalStore['propose']>) {
          propose.apply(this, args);
          throw new QandeelError('STORAGE_BUSY', 'interrupted after the effect');
        };
        assert.throws(() => actions.confirm(sess, p.id, p.fingerprint), code('STORAGE_BUSY'));
        GoalStore.prototype.propose = propose;
        assert.deepEqual([actions.get(p.id).state, goals.list().length], ['FAILED', 0], 'the effect rolled back with the confirm: FAILED means not executed');
        assert.throws(() => actions.confirm(sess, p.id, p.fingerprint), code('FOUNDER_CONFIRMATION_REQUIRED'));
        assert.equal(goals.list().length, 0, 'a retry never re-executes the act');
        // A multi-step act (approve + activate) commits all of its steps or none.
        const g = goals.propose(s.founder, { kind: 'COMPANY', title: 'Growth Engine', summary: 's', ownerRef: s.employee.ref });
        const q = actions.preview(sess, 'GOAL_APPROVE', { goalId: g.id, activate: true });
        GoalStore.prototype.transition = function (this: GoalStore, actorRef: string, goalId: string, input: Parameters<GoalStore['transition']>[2]) {
          if (input.to === 'ACTIVE') throw new QandeelError('STORAGE_BUSY', 'interrupted between steps');
          return transition.call(this, actorRef, goalId, input);
        };
        assert.throws(() => actions.confirm(sess, q.id, q.fingerprint), code('STORAGE_BUSY'));
        GoalStore.prototype.transition = transition;
        assert.deepEqual([goals.get(g.id).state, actions.get(q.id).state], ['PROPOSED', 'FAILED'], 'no half-approved goal');
        const r = actions.preview(sess, 'GOAL_APPROVE', { goalId: g.id, activate: true });
        const out = actions.confirm(sess, r.id, r.fingerprint);
        assert.deepEqual([out.preview.state, goals.get(g.id).state, goals.history(g.id).map((x) => x.toState).join('>')], ['CONFIRMED', 'ACTIVE', 'PROPOSED>APPROVED>ACTIVE'], 'the effect and CONFIRMED commit together');
      } finally {
        GoalStore.prototype.propose = propose;
        GoalStore.prototype.transition = transition;
      }
    });
  });

  test('R2-21 / R2-22: an uncertain external effect and an escalated review reach Founder Attention per entity and are decided through governed previews in the session (no test seam)', () => {
    withSeed((h, s) => {
      const held = heldExternalEffect(h, s);
      activeReviewer(h, s);
      const review = ReviewStore.for(h.store);
      const { workItemId: reviewedWi, claim } = runFor(h, s, s.employee, { reviewPlan: reviewPlan({ appliesTo: 'OUTPUT' }) });
      settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
      const request = must(review.requests({ workItemId: reviewedWi }).find((r) => r.state === 'OPEN'));
      const key = must(review.assignments(request.id).find((a) => a.keyKind !== 'SHADOW' && a.state === 'ASSIGNED'));
      decideAssignment(h, must(key.reviewWorkItemId), 'INSUFFICIENT_EVIDENCE');
      assert.equal(review.request(request.id).state, 'ESCALATED');
      const attention = AttentionStore.for(h.store);
      const first = attention.sync();
      const open = (): string[] => attention.list({ state: 'OPEN' }).map((i) => i.sourceRef).sort();
      assert.ok(open().includes(`tool_invocation:${held.invocationId}`), 'the uncertain external effect needs the Founder');
      assert.ok(open().includes(`review_request:${request.id}`), 'the escalated required review needs the Founder');
      assert.ok(!open().includes(`queue_job:${held.jobId}`), 'the held job waits for its tool decision first (only decidable items are surfaced)');
      assert.ok(first.opened >= 2);
      const stable = attention.sync();
      assert.deepEqual([stable.opened, stable.signalled, stable.resolved], [0, 0, 0], 'a stable change time: zero-delta syncs stay silent');
      // Production: only an authenticated session arms Founder authority.
      const { auth, session: sess } = session(h);
      const actions = FounderActionStore.for(h.store, auth);
      disarmFounderTestSurface(h.root);
      try {
        assert.throws(() => actions.preview(sess, 'JOB_RECONCILE', { jobId: held.jobId, decision: 'RETRY' }), code('INVALID_TRANSITION'), 'the tool decision comes first');
        assert.throws(() => actions.preview(sess, 'TOOL_RECONCILE', { invocationId: held.invocationId, outcome: 'MAYBE' }), code('VALIDATION_FAILED'));
        const t = actions.preview(sess, 'TOOL_RECONCILE', { invocationId: held.invocationId, outcome: 'CONFIRMED_SUCCEEDED' });
        assert.equal(s.gov.toolInvocations(held.wi)[0]?.state, 'RECONCILIATION_REQUIRED', 'a preview decides nothing');
        assert.equal(actions.confirm(sess, t.id, t.fingerprint).resultRef, `tool_invocation:${held.invocationId}`);
        assert.equal(s.gov.toolInvocations(held.wi)[0]?.state, 'SUCCEEDED', 'decided at the real boundary, inside the session scope');
        assert.throws(() => actions.preview(sess, 'TOOL_RECONCILE', { invocationId: held.invocationId, outcome: 'CONFIRMED_SUCCEEDED' }), code('INVALID_TRANSITION'), 'decided once');
        const afterTool = attention.sync();
        assert.ok(afterTool.resolved >= 1 && open().includes(`queue_job:${held.jobId}`) && !open().includes(`tool_invocation:${held.invocationId}`), 'the tool item resolves; the job is now decidable and surfaced');
        const j = actions.preview(sess, 'JOB_RECONCILE', { jobId: held.jobId, decision: 'RETRY' });
        actions.confirm(sess, j.id, j.fingerprint);
        assert.equal(h.store.getJob(held.jobId).state, 'QUEUED');
        assert.throws(() => actions.preview(sess, 'REVIEW_ESCALATION_RESOLVE', { requestId: request.id, decision: 'MAYBE' }), code('VALIDATION_FAILED'));
        const e = actions.preview(sess, 'REVIEW_ESCALATION_RESOLVE', { requestId: request.id, decision: 'REWORK' });
        actions.confirm(sess, e.id, e.fingerprint);
        assert.equal(h.store.getWorkItem(reviewedWi).state, 'READY', 'rework resolved the escalation');
        const done = attention.sync();
        assert.ok(done.resolved >= 2 && !open().some((x) => x.startsWith('queue_job:') || x.startsWith('review_request:')), 'every decided item leaves attention');
        // A payload carries IDs / codes / bounded numbers only; unknown or oversized values are refused.
        assert.throws(() => actions.preview(sess, 'RESERVATION_RECONCILE', { reservationId: held.wi, decision: 'CHARGE', inputTokens: -1, outputTokens: 0 }), (x: unknown) => isQandeelError(x) && ['VALIDATION_FAILED', 'NOT_FOUND'].includes(x.code));
        assert.throws(() => actions.preview(sess, 'SYSTEMIC_DECIDE', { findingId: held.wi, decision: 'VALIDATE' }), code('NOT_FOUND'));
        assert.throws(() => actions.preview(sess, 'OUTCOME_VERIFY', { workItemId: held.wi, verdict: 'ACHIEVED', evidenceClasses: [], evidenceRefs: [] }), (x: unknown) => isQandeelError(x));
      } finally {
        armFounderTestSurface(h.root);
      }
      const audit = JSON.stringify(h.store.auditByAction('founder.action_confirmed'));
      assert.ok(audit.includes('TOOL_RECONCILE') && audit.includes('JOB_RECONCILE') && audit.includes('REVIEW_ESCALATION_RESOLVE'));
    });
  });

  test('R2-25: a resilience exception is one item per instance, and a dismissed item reopens when its source changes', () => {
    withSeed((h, s) => {
      const attention = AttentionStore.for(h.store);
      assert.equal(runRestoreDrill(h.store).result, 'FAIL');
      attention.sync();
      const first = must(attention.list({ state: 'OPEN' }).find((i) => i.dedupKey.startsWith('resilience:')));
      attention.dismiss(s.founder, first.id, 'founder.dismissed');
      h.clock.advance(5 * 3_600_000);
      assert.equal(runRestoreDrill(h.store).result, 'FAIL');
      const later = attention.sync();
      const now = attention.list({ state: 'OPEN' }).filter((i) => i.dedupKey.startsWith('resilience:'));
      assert.equal(later.opened, 1, 'a later failed drill is a new exception, never swallowed by an earlier dismissal');
      assert.equal(now.length, 1);
      assert.notEqual(must(now[0]).sourceRef, first.sourceRef, 'the item points at the new failure');
      // A dismissed thread reopens when a later message arrives in it.
      const ceo = placed(h, s, 'company.ceo');
      const comm = CommunicationStore.for(h.store);
      const thread = comm.directThread(s.founder, null);
      const ask = (body: string): void => {
        const sent = comm.send(s.founder, thread.id, { purpose: 'QUESTION', body });
        const c = claimItem(h, must(sent.replyWorkItemId), `w-${body}`);
        assert.equal(recordMessage(h.store, c.fence, { purpose: 'QUESTION', attentionLevel: 'URGENT', body: `${body}?`, brief: null, contextRefs: [] }).outcome, 'RECORDED');
        settle(h.store, c.fence, { type: 'COMPLETED' }, { backoff });
      };
      ask('one');
      attention.sync();
      const item = must(attention.list({ state: 'OPEN' }).find((i) => i.sourceRef === `thread:${thread.id}`));
      attention.dismiss(s.founder, item.id, 'founder.later');
      assert.equal(attention.sync().opened, 0, 'the dismissal stands while the thread is unchanged');
      h.clock.advance(60_000);
      ask('two');
      const reopened = attention.sync();
      const again = must(attention.list({}).find((i) => i.id === item.id));
      assert.deepEqual([reopened.opened, again.state, again.signalCount > item.signalCount], [1, 'OPEN', true], 'a later URGENT message in a dismissed thread is not silent');
      void ceo;
    });
  });

  test('m-20: model-authored goal text is secret-scanned like its siblings (Founder proposal and Director derivation)', () => {
    withSeed((h, s) => {
      const goals = GoalStore.for(h.store);
      // A bearer-shaped credential built at run time (the repository holds no secret-shaped literal).
      const secret = ['Bearer ', 'abcdefghjkmnpqrstuvwxyz23456789a'].join('');
      assert.throws(() => goals.propose(s.founder, { kind: 'COMPANY', title: 'x', summary: `key ${secret}`, ownerRef: s.employee.ref }), (e: unknown) => isQandeelError(e) && e.details['reason'] === 'SECRET_MATERIAL');
      assert.throws(() => goals.propose(s.founder, { kind: 'COMPANY', title: 'x', summary: 'y', successCriteria: [`use ${secret}`], ownerRef: s.employee.ref }), (e: unknown) => isQandeelError(e) && e.details['reason'] === 'SECRET_MATERIAL');
      let parent = goals.propose(s.founder, { kind: 'COMPANY', title: 'p', summary: 's', ownerRef: s.employee.ref });
      parent = goals.transition(s.founder, parent.id, { to: 'APPROVED', reasonCode: 'ok' });
      const director = placed(h, s, 'director.product');
      const { claim } = runFor(h, s, director);
      const refused = recordGoalAct(h.store, claim.fence, 'goal.derive', { parentGoalId: parent.id, title: 't', summary: `token ${secret}` });
      assert.deepEqual([refused.outcome, refused.code], ['REFUSED', 'SECRET_MATERIAL']);
      assert.equal(goals.list({ kind: 'DEPARTMENT' }).length, 0);
      const ok = recordGoalAct(h.store, claim.fence, 'goal.derive', { parentGoalId: parent.id, title: 't', summary: 'clean' });
      assert.equal(ok.outcome, 'DONE');
      // A model-authored CEO brief is scanned field by field, like a message body.
      placed(h, s, 'company.ceo');
      const b = CommunicationStore.for(h.store).requestCeoBrief({ subject: 's', contextKind: 'APPROVAL', contextRef: 'approval:1', reasonCode: 'brief.test', instructions: 'brief' });
      const bc = claimItem(h, b.workItemId, 'w-brief-secret');
      const brief = recordMessage(h.store, bc.fence, { purpose: 'BRIEF', attentionLevel: 'INFORMATIONAL', body: 'brief', brief: { happening: `a ${secret}`, matters: 'b', recommendation: 'c', decisionNeeded: false }, contextRefs: [] });
      assert.deepEqual([brief.outcome, brief.code], ['REFUSED', 'SECRET_MATERIAL']);
    });
  });
});

describe('C5 Company Universe projection', () => {
  test('C5-PROOF: deterministic, live-only relations, seats as truth (vacant / acting), time-correct at T', () => {
    withSeed((h, s) => {
      const org = OrganizationStore.for(h.store);
      const ceo = placed(h, s, 'company.ceo');
      const director = placed(h, s, 'director.product');
      const reportSeat = newSeat(h, s, 'product.analyst-1', 'director.product');
      const analyst = placed(h, s, 'product.analyst-1');
      const t0 = h.store.now();
      const a = projectUniverse(h.store);
      const b = projectUniverse(h.store);
      assert.equal(JSON.stringify(a), JSON.stringify(b), 'byte-identical for the same state');
      assert.equal(a.departments.map((d) => d.code).join(','), 'strategic-market-intelligence,growth,brand-creative,product,engineering', 'canonical sector order');
      const ceoSeat = must(a.seats.find((x) => x.kind === 'CEO'));
      assert.deepEqual([ceoSeat.holderEmployeeId, ceoSeat.holderKind, ceoSeat.reportsToFounder], [ceo.id, 'PRIMARY', true]);
      const an = must(a.employees.find((e) => e.id === analyst.id));
      assert.deepEqual(an.chain.map((c) => c.kind), ['SPECIALIST', 'DIRECTOR', 'CEO', 'FOUNDER'], 'the chain inward to the Founder');
      assert.equal(must(an.chain[1]).employeeId, director.id);
      assert.ok(a.seats.filter((x) => x.kind === 'DIRECTOR' && x.holderEmployeeId === null).length >= 4, 'vacant Director seats are shown vacant, never invented');
      assert.equal(a.relations.length, 0, 'no live relation → no edge');
      // Goal → Work traceability is part of the projection (never an LLM story).
      const goals = GoalStore.for(h.store);
      let goal = goals.propose(s.founder, { kind: 'COMPANY', title: 'g', summary: 's', ownerRef: ceo.ref });
      goal = goals.transition(s.founder, goal.id, { to: 'APPROVED', reasonCode: 'ok' });
      goal = goals.transition(s.founder, goal.id, { to: 'ACTIVE', reasonCode: 'ok' });
      const { workItem: served } = h.store.createWorkItem({ objective: 'served', ownerRef: analyst.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', instructions: 'x' } });
      goals.linkWork(s.founder, goal.id, served.id);
      const linked = projectUniverse(h.store);
      assert.deepEqual(linked.work.find((w) => w.id === served.id)?.goalIds, [goal.id]);
      assert.deepEqual(linked.goals.find((g) => g.id === goal.id)?.workItemIds, [served.id]);
      assert.deepEqual(linked.goals.find((g) => g.id === goal.id)?.anchorDepartmentIds, [analyst.departmentId]);
      // Acting coverage is visible as such; a pending approval is a live relation to the Founder.
      h.clock.advance(1_000);
      org.assignActing(s.founder, { positionId: seat(h, 'director.growth').id, employeeId: analyst.id, until: new Date(Date.parse(h.store.now()) + 5 * 86_400_000).toISOString(), reasonCode: 'cover' });
      const approvalId = pendingApproval(h, s);
      AttentionStore.for(h.store).sync();
      const live = projectUniverse(h.store);
      const growth = must(live.seats.find((x) => x.code === 'director.growth'));
      assert.deepEqual([growth.holderEmployeeId, growth.holderKind], [analyst.id, 'ACTING']);
      assert.deepEqual(live.relations.map((r) => [r.kind, r.to]), [['APPROVAL', 'founder']]);
      assert.equal(must(live.relations[0]).sourceRef, `approval:${approvalId}`);
      assert.equal(live.attention.length, 1);
      assert.equal(live.signals.waitingApproval, 1);
      // Time-correct: at t0 the acting coverage did not exist yet and no approval was pending.
      const past = projectUniverse(h.store, { at: t0 });
      assert.equal(past.live, false);
      assert.equal(past.seats.find((x) => x.code === 'director.growth')?.holderEmployeeId, null);
      assert.equal(past.relations.length, 0);
      assert.equal(past.attention.length, 0);
      // After the analyst's assignment ends, the past still shows it and live does not.
      h.clock.advance(1_000);
      const primary = must(org.assignmentsOfEmployee(analyst.id).find((x) => x.kind === 'PRIMARY'));
      org.endAssignment(s.founder, primary.id, 'transfer');
      assert.equal(projectUniverse(h.store).seats.find((x) => x.id === reportSeat.id)?.holderEmployeeId, null);
      assert.equal(projectUniverse(h.store, { at: t0 }).seats.find((x) => x.id === reportSeat.id)?.holderEmployeeId, analyst.id, 'history is not reconstructed from current rows');
      assert.ok(!JSON.stringify(live).includes('vault:'), 'no credential reference reaches the projection');
    });
  });
});
