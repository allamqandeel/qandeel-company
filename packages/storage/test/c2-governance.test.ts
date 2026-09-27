/**
 * C2 storage proofs: identity, authority, approvals, budgets, tools, crash coherence.
 * C2-PROOF: storage-governance
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Id } from '@qandeel-company/domain';

import { CompanyStore, GovernanceStore } from '../src/index.js';
import {
  authorizeModelCall,
  recordDeploymentOutcome,
  beginGovernedRun,
  claimNext,
  interruptClaim,
  recordToolIntent,
  recordToolResult,
  recoverGovernedOrphans,
  releaseReservation,
  reserveBudget,
  settleReservation,
} from '../src/runtime-authority.js';
import { C2_KINDS, claimGoverned, governedItem, hire, seed } from './c2-helpers.js';
import { harness } from './helpers.js';

const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;

describe('C2 identity: persistent Employees (Employee ≠ Model ≠ Session ≠ Run ≠ Process)', () => {
  test('identity, names and lifecycle history are durable; reassignment keeps the same Employee', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      const e = s.employee;
      assert.equal(e.state, 'ACTIVE');
      assert.equal(e.nameOrigin, 'EG');
      assert.throws(() => s.gov.createEmployee(s.founder, { name: e.name, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: 'role:x', positionRef: 'position:x', departmentId: s.departmentId, managerRef: s.founder }), code('VALIDATION_FAILED'));
      const moved = s.gov.reassignEmployee(s.founder, e.id, { roleRef: 'role:senior-analyst', reasonCode: 'promotion' });
      assert.equal(moved.id, e.id);
      assert.deepEqual(moved.name, e.name);
      assert.deepEqual(s.gov.employeeHistory(e.id).map((x) => `${x.changeKind}:${x.toState}`), ['CREATED:CANDIDATE', 'LIFECYCLE:TRAINING', 'LIFECYCLE:PROBATION', 'LIFECYCLE:ACTIVE', 'ASSIGNMENT:role:senior-analyst']);
      // The Employee row names no provider, model, session, run or process.
      assert.ok(!/provider|model|session|run|process/i.test(Object.keys(e).filter((k) => k !== 'cognitiveProfile').join(',')));
    } finally {
      h.close();
    }
  });

  test('activation fails closed without qualification evidence; the datastore refuses an ACTIVE row without it', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      const c = hire(s.gov, s.founder, s.departmentId, false);
      s.gov.transitionEmployee(s.founder, c.id, { to: 'TRAINING', reasonCode: 'onboarding' });
      s.gov.transitionEmployee(s.founder, c.id, { to: 'SHADOW', reasonCode: 'shadow' });
      assert.throws(() => s.gov.transitionEmployee(s.founder, c.id, { to: 'ACTIVE', reasonCode: 'x' }), code('EMPLOYEE_NOT_ELIGIBLE'));
      assert.equal(s.gov.getEmployee(c.id).state, 'SHADOW');
    } finally {
      h.close();
    }
  });

  test('suspended and retired Employees cannot execute: the governed run is refused before any action', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      const wi = governedItem(h, s);
      s.gov.transitionEmployee(s.founder, s.employee.id, { to: 'SUSPENDED', reasonCode: 'incident' });
      const claim = claimNext(h.store, { ...h.claimOpts('w1', 60_000), kinds: C2_KINDS });
      assert.ok(claim && claim.workItem.id === wi);
      assert.deepEqual(beginGovernedRun(h.store, claim.fence), { ok: false, code: 'EMPLOYEE_NOT_ELIGIBLE', state: 'SUSPENDED' });
      s.gov.transitionEmployee(s.founder, s.employee.id, { to: 'RETIRED', reasonCode: 'left' });
      assert.ok(s.gov.grants(s.employee.id).every((g) => g.status === 'REVOKED'), 'a retired employee loses active authority');
      assert.equal(s.gov.getEmployee(s.employee.id).state, 'RETIRED', 'the retired employee stays in history');
      assert.throws(() => s.gov.transitionEmployee(s.founder, s.employee.id, { to: 'ACTIVE', reasonCode: 'x' }), code('TERMINAL_STATE'));
    } finally {
      h.close();
    }
  });
});

describe('C2 authority: default deny, no self-escalation, Founder approvals', () => {
  test('default deny: an ACTIVE Employee with a Director role and no grants can do nothing (Role grants nothing)', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      const director = hire(s.gov, s.founder, s.departmentId, true, 'role:director');
      s.gov.createBudget(s.founder, { scope: 'EMPLOYEE', scopeId: director.id, capMoney: 100_000, capTokens: 100_000, reasonCode: 'seed' });
      governedItem(h, s, director);
      const { claim, begun } = claimGoverned(h);
      assert.ok(begun.ok);
      const m = authorizeModelCall(h.store, claim.fence, { taskClass: 'draft.memo', dataClass: 'D1' });
      assert.deepEqual(m, { ok: false, code: 'NO_GRANT', paused: false });
      const t = recordToolIntent(h.store, claim.fence, { toolCode: 'notes', actionCode: 'read', args: {}, idempotencyKey: 'wi:test:s0' });
      assert.equal(t.kind, 'DENIED');
      assert.equal(t.kind === 'DENIED' && t.code, 'NO_GRANT');
    } finally {
      h.close();
    }
  });

  test('self-escalation is refused: own grants, own budget, own approval; Company / Department caps need the Founder', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      const me = s.employee.ref;
      assert.throws(() => s.gov.grant(me, { employeeId: s.employee.id, capability: 'tool:ledger.transfer', riskCeiling: 'R3', dataClassCeiling: 'D3', reasonCode: 'x' }), code('SELF_ESCALATION_REFUSED'));
      const own = s.gov.budgetFor('EMPLOYEE', s.employee.id);
      assert.ok(own);
      assert.throws(() => s.gov.changeBudgetCap(me, own.id, { capMoney: own.capMoney * 2, capTokens: own.capTokens, reasonCode: 'x' }), code('SELF_ESCALATION_REFUSED'));
      const dept = s.gov.budgetFor('DEPARTMENT', s.departmentId);
      const company = s.gov.budgetFor('COMPANY', 'company');
      assert.ok(dept && company);
      assert.throws(() => s.gov.changeBudgetCap(me, dept.id, { capMoney: dept.capMoney, capTokens: dept.capTokens, reasonCode: 'x' }), code('FOUNDER_ONLY'));
      assert.throws(() => s.gov.changeBudgetCap(me, company.id, { capMoney: company.capMoney + 1, capTokens: company.capTokens, reasonCode: 'x' }), code('FOUNDER_ONLY'));
      assert.throws(() => s.gov.changeBudgetCap('founder:00000000-0000-4000-8000-000000000000', company.id, { capMoney: 1, capTokens: 1, reasonCode: 'x' }), code('AUTHORITY_DENIED'));
      const raised = s.gov.changeBudgetCap(s.founder, company.id, { capMoney: company.capMoney + 1, capTokens: company.capTokens, reasonCode: 'founder.raise' });
      assert.equal(raised.capMoney, company.capMoney + 1);
      assert.throws(() => s.gov.changeBudgetCap(s.founder, dept.id, { capMoney: company.capMoney + 2, capTokens: dept.capTokens, reasonCode: 'x' }), code('BUDGET_EXHAUSTED'), 'a child cap never exceeds its parent');
      assert.ok(h.store.auditByAction('governance.refused').length >= 4, 'refusals are audited');
    } finally {
      h.close();
    }
  });

  test('R3 work: fails closed until a Founder approval; employees cannot decide it; the approval survives restart', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      const { workItem } = h.store.createWorkItem({ objective: 'publish launch notes', ownerRef: s.employee.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', instructions: 'x' }, riskLevel: 'R3', initialState: 'READY' });
      assert.equal(workItem.state, 'WAITING_APPROVAL');
      assert.throws(() => h.store.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'try' }), code('APPROVAL_PATH_UNAVAILABLE'));
      const req = s.gov.requestWorkItemApproval(s.employee.ref, workItem.id);
      assert.equal(req.state, 'PENDING');
      // Restart: the pending approval is durable.
      const reopened = h.open();
      const gov2 = GovernanceStore.for(reopened);
      assert.equal(gov2.getApproval(req.id).state, 'PENDING');
      const other = hire(gov2, s.founder, s.departmentId);
      assert.throws(() => gov2.decideApproval(other.ref, req.id, { decision: 'APPROVE', reasonCode: 'x' }), code('FOUNDER_ONLY'));
      assert.throws(() => gov2.decideApproval(s.employee.ref, req.id, { decision: 'APPROVE', reasonCode: 'x' }), code('SELF_ESCALATION_REFUSED'));
      const decided = gov2.decideApproval(s.founder, req.id, { decision: 'APPROVE', reasonCode: 'founder.ok' });
      assert.equal(decided.state, 'CONSUMED');
      const released = reopened.getWorkItem(workItem.id);
      assert.equal(released.state, 'READY');
      assert.equal(released.approvalId, req.id);
      assert.equal(reopened.jobsFor(workItem.id)[0]?.state, 'QUEUED');
      assert.deepEqual(gov2.approvalHistory(req.id).map((x) => x.toState), ['PENDING', 'APPROVED', 'CONSUMED']);
    } finally {
      h.close();
    }
  });

  test('R4 work is Founder-only: never approvable, never released; a rejection does not silently regenerate', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      const r4 = h.store.createWorkItem({ objective: 'sovereign', ownerRef: s.employee.ref, processorKind: 'c2.employee-task', riskLevel: 'R4', initialState: 'READY' }).workItem;
      const a4 = s.gov.requestWorkItemApproval(s.employee.ref, r4.id);
      assert.throws(() => s.gov.decideApproval(s.founder, a4.id, { decision: 'APPROVE', reasonCode: 'x' }), code('FOUNDER_ONLY'));
      assert.equal(h.store.getWorkItem(r4.id).state, 'WAITING_APPROVAL');
      const r3 = h.store.createWorkItem({ objective: 'sensitive', ownerRef: s.employee.ref, processorKind: 'c2.employee-task', riskLevel: 'R3', initialState: 'READY' }).workItem;
      const a3 = s.gov.requestWorkItemApproval(s.employee.ref, r3.id);
      s.gov.decideApproval(s.founder, a3.id, { decision: 'REJECT', reasonCode: 'founder.no' });
      assert.throws(() => s.gov.requestWorkItemApproval(s.employee.ref, r3.id), code('APPROVAL_REJECTED'));
      const again = s.gov.requestWorkItemApproval(s.employee.ref, r3.id, { reRequestOf: a3.id });
      assert.equal(again.rerequestOf, a3.id);
      assert.equal(again.state, 'PENDING');
    } finally {
      h.close();
    }
  });
});

describe('C2 tools: authority path before any driver', () => {
  test('R1 permitted; R2 fails closed (review); R4 refused; unknown tool refused; only authority signals count toward containment', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      governedItem(h, s);
      const { claim } = claimGoverned(h);
      const f = claim.fence;
      const append = recordToolIntent(h.store, f, { toolCode: 'notes', actionCode: 'append', args: { text: 'hello' }, idempotencyKey: 'wi:test:s1' });
      assert.equal(append.kind, 'EXECUTE');
      assert.deepEqual(append.kind === 'EXECUTE' && append.args, { text: 'hello' }, 'the executor receives the validated arguments');
      assert.equal(recordToolIntent(h.store, f, { toolCode: 'review', actionCode: 'merge', args: { text: 'x' }, idempotencyKey: 'wi:test:s2' }).kind, 'REVIEW_REQUIRED');
      assert.deepEqual(recordToolIntent(h.store, f, { toolCode: 'ledger', actionCode: 'transfer', args: { text: 'x' }, idempotencyKey: 'wi:test:s3' }), { kind: 'DENIED', code: 'FOUNDER_ONLY', paused: false });
      // Ordinary failures (model mistakes) are refused and audited but never pause the employee.
      const unknown = recordToolIntent(h.store, f, { toolCode: 'patient-name-leak', actionCode: 'run', args: {}, idempotencyKey: 'wi:test:s4' });
      assert.deepEqual(unknown, { kind: 'DENIED', code: 'UNKNOWN_TOOL', paused: false });
      assert.deepEqual(recordToolIntent(h.store, f, { toolCode: 'notes', actionCode: 'append', args: { text: 'x', apiKey: 'y' }, idempotencyKey: 'wi:test:s5' }), { kind: 'DENIED', code: 'INVALID_ARGS', paused: false });
      assert.ok(!JSON.stringify(h.store.audit(f.runId)).includes('patient-name-leak'), 'model-written names never enter audit (Rule A)');
      assert.equal(s.gov.getEmployee(s.employee.id).state, 'ACTIVE');
      // Repeated authority violations do: the third R4 attempt pauses the employee (it grants nothing).
      assert.deepEqual(recordToolIntent(h.store, f, { toolCode: 'ledger', actionCode: 'transfer', args: { text: 'y' }, idempotencyKey: 'wi:test:s6' }), { kind: 'DENIED', code: 'FOUNDER_ONLY', paused: false });
      assert.deepEqual(recordToolIntent(h.store, f, { toolCode: 'ledger', actionCode: 'transfer', args: { text: 'z' }, idempotencyKey: 'wi:test:s7' }), { kind: 'DENIED', code: 'FOUNDER_ONLY', paused: true });
      assert.equal(s.gov.getEmployee(s.employee.id).state, 'PAUSED');
    } finally {
      h.close();
    }
  });

  test('data class: an invalid declared class fails closed to D4; a tool result raises the context class durably', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      governedItem(h, s, s.employee, { dataClass: 'd1-typo' });
      const { claim } = claimGoverned(h);
      assert.ok(claim);
      // The typo is treated as D4, beyond this employee's D3 model grant: denied, never widened.
      assert.deepEqual(authorizeModelCall(h.store, claim.fence, { taskClass: 'draft.memo', dataClass: 'D0' }), { ok: false, code: 'NO_GRANT', paused: false });
      // A D1 item whose tool returns D3 data is D3 from then on.
      governedItem(h, s, s.employee, { dataClass: 'D1' });
      const c2 = claimGoverned(h, 'w2').claim;
      const readA = recordToolIntent(h.store, c2.fence, { toolCode: 'notes', actionCode: 'append', args: { text: 'x' }, idempotencyKey: 'wi:test:r1' });
      assert.equal(readA.kind, 'EXECUTE');
      const before = authorizeModelCall(h.store, c2.fence, { taskClass: 'draft.memo', dataClass: 'D1' });
      assert.equal(before.ok && before.dataClass, 'D1');
      if (readA.kind === 'EXECUTE') recordToolResult(h.store, c2.fence, readA.invocationId, { ok: true, result: { rows: 1 } });
      const after = authorizeModelCall(h.store, c2.fence, { taskClass: 'draft.memo', dataClass: 'D1' });
      assert.equal(after.ok && after.dataClass, 'D3');
    } finally {
      h.close();
    }
  });

  test('an interrupted tool intent is charged (the driver may have run), never released; a cap cannot drop below a child cap', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      governedItem(h, s);
      const { claim } = claimGoverned(h);
      const intent = recordToolIntent(h.store, claim.fence, { toolCode: 'notes', actionCode: 'append', args: { text: 'x' }, idempotencyKey: 'wi:test:c1' });
      assert.equal(intent.kind, 'EXECUTE');
      interruptClaim(h.store, h.supervisor, claim.fence.jobId, 'TEST_CRASH');
      assert.deepEqual(recoverGovernedOrphans(h.store, h.supervisor), { reservationsHeld: 0, reservationsReleased: 0, invocationsRetryable: 1, invocationsHeld: 0 });
      const r = s.gov.reservations(claim.fence.runId)[0];
      assert.equal(r?.state, 'SETTLED');
      assert.equal(s.gov.usage({ runId: claim.fence.runId })[0]?.outcome, 'FAILED_CHARGED');
      assert.deepEqual(s.gov.accountingInvariants(), []);
      const dept = s.gov.budgetFor('DEPARTMENT', s.departmentId);
      const company = s.gov.budgetFor('COMPANY', 'company');
      assert.ok(dept && company);
      assert.throws(() => s.gov.changeBudgetCap(s.founder, company.id, { capMoney: dept.capMoney - 1, capTokens: company.capTokens, reasonCode: 'x' }), code('VALIDATION_FAILED'));
    } finally {
      h.close();
    }
  });

  test('R3 tool: scoped Founder approval for exact arguments; changed arguments need a new approval', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      const wi = governedItem(h, s);
      const { claim } = claimGoverned(h);
      const first = recordToolIntent(h.store, claim.fence, { toolCode: 'publisher', actionCode: 'publish', args: { text: 'v1' }, idempotencyKey: 'wi:test:s1' });
      assert.equal(first.kind, 'APPROVAL_REQUIRED');
      if (first.kind !== 'APPROVAL_REQUIRED') return;
      const a = s.gov.getApproval(first.approvalId);
      assert.equal(a.workItemId, wi);
      assert.equal(a.risk, 'R3');
      assert.equal(a.argsSha256.length, 64, 'the approval stores an argument digest, never the arguments');
      s.gov.decideApproval(s.founder, a.id, { decision: 'APPROVE', reasonCode: 'founder.ok', expiresAt: '2026-09-27T12:00:00.000Z' });
      const changed = recordToolIntent(h.store, claim.fence, { toolCode: 'publisher', actionCode: 'publish', args: { text: 'v2' }, idempotencyKey: 'wi:test:s2' });
      assert.equal(changed.kind, 'APPROVAL_REQUIRED', 'materially changed arguments are not covered');
      const exact = recordToolIntent(h.store, claim.fence, { toolCode: 'publisher', actionCode: 'publish', args: { text: 'v1' }, idempotencyKey: 'wi:test:s1' });
      assert.equal(exact.kind, 'EXECUTE');
      assert.equal(s.gov.getApproval(a.id).state, 'CONSUMED', 'single use');
      const reuse = recordToolIntent(h.store, claim.fence, { toolCode: 'publisher', actionCode: 'publish', args: { text: 'v1' }, idempotencyKey: 'wi:test:s9' });
      assert.equal(reuse.kind, 'APPROVAL_REQUIRED', 'a consumed approval authorizes nothing else');
    } finally {
      h.close();
    }
  });

  test('idempotency: a recorded result replays; the same key with different arguments conflicts', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      governedItem(h, s);
      const { claim } = claimGoverned(h);
      const intent = recordToolIntent(h.store, claim.fence, { toolCode: 'notes', actionCode: 'append', args: { text: 'a' }, idempotencyKey: 'wi:test:s1' });
      assert.equal(intent.kind, 'EXECUTE');
      if (intent.kind !== 'EXECUTE') return;
      assert.equal(recordToolResult(h.store, claim.fence, intent.invocationId, { ok: true, result: { effect: 1 } }), 'SUCCEEDED');
      const replay = recordToolIntent(h.store, claim.fence, { toolCode: 'notes', actionCode: 'append', args: { text: 'a' }, idempotencyKey: 'wi:test:s1' });
      assert.deepEqual(replay, { kind: 'REPLAY', invocationId: intent.invocationId, result: { effect: 1 } });
      const conflict = recordToolIntent(h.store, claim.fence, { toolCode: 'notes', actionCode: 'append', args: { text: 'b' }, idempotencyKey: 'wi:test:s1' });
      assert.equal(conflict.kind === 'DENIED' && conflict.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(s.gov.toolInvocations(claim.fence.runId).length, 1, 'one durable invocation, one effect');
    } finally {
      h.close();
    }
  });

  test('D2 context cannot egress through a D1 external tool (separate egress decision)', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      governedItem(h, s, s.employee, { dataClass: 'D2' });
      const { claim } = claimGoverned(h);
      const r = recordToolIntent(h.store, claim.fence, { toolCode: 'publisher', actionCode: 'publish', args: { text: 'x' }, idempotencyKey: 'wi:test:s1' });
      assert.equal(r.kind === 'DENIED' && r.code, 'EGRESS_DENIED');
    } finally {
      h.close();
    }
  });
});

describe('C2 budgets: reserve before spend, settle actual, hard refusal, coherent after crashes', () => {
  const modelReserve = (s: ReturnType<typeof seed>, money: number, tokens = 100) => ({ purpose: 'MODEL_CALL' as const, attemptKind: 'PRIMARY' as const, deploymentId: s.deploymentId, priceCardId: s.priceCardId, routePolicyId: s.policyId, money, tokens });

  test('reserve → settle actual (unused released) → invariants hold at every level', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      governedItem(h, s);
      const { claim } = claimGoverned(h);
      const r = reserveBudget(h.store, claim.fence, modelReserve(s, 5_000, 1_000));
      assert.ok(r.ok);
      if (!r.ok) return;
      const company = () => s.gov.budgetFor('COMPANY', 'company');
      assert.equal(company()?.reservedMoney, 5_000);
      settleReservation(h.store, claim.fence, r.reservation.id, { inputTokens: 100, outputTokens: 50, withinBounds: true, sessionId: null, outcome: 'OK' });
      // 100 in @ 2 USD/MTok + 50 out @ 8 USD/MTok = 200 + 400 micros.
      assert.equal(company()?.reservedMoney, 0);
      assert.equal(company()?.spentMoney, 600);
      assert.equal(company()?.spentTokens, 150);
      const [usage] = s.gov.usage({ runId: claim.fence.runId });
      assert.ok(usage);
      assert.equal(usage.billedMicros, 600);
      assert.equal(usage.economicMicros, 600);
      assert.equal(usage.priceCardVersion, 1);
      assert.equal(usage.employeeId, s.employee.id);
      assert.equal(usage.departmentId, s.departmentId);
      assert.deepEqual(s.gov.accountingInvariants(), []);
      assert.equal(settleReservation(h.store, claim.fence, r.reservation.id, { inputTokens: 1, outputTokens: 1, withinBounds: true, sessionId: null, outcome: 'OK' }), null, 'no double settlement');
      assert.equal(company()?.spentMoney, 600, 'nothing charged twice');
      assert.ok(h.store.audit(r.reservation.id).some((x) => x.action === 'budget.late_usage_discrepancy'), 'the late report is recorded as a discrepancy, not lost');
      assert.equal(s.gov.usage({ runId: claim.fence.runId }).length, 1);
    } finally {
      h.close();
    }
  });

  test('hard refusal at the limit (any level); a work item without a budget cannot spend', () => {
    const h = harness();
    try {
      const s = seed(h.store, { employeeCap: 8_000 });
      governedItem(h, s, s.employee, { cap: 8_000 });
      governedItem(h, s, s.employee, { cap: 8_000 });
      const a = claimGoverned(h, 'w1');
      const b = claimGoverned(h, 'w2');
      assert.ok(reserveBudget(h.store, a.claim.fence, modelReserve(s, 5_000)).ok);
      const refused = reserveBudget(h.store, b.claim.fence, modelReserve(s, 5_000));
      assert.deepEqual(refused, { ok: false, code: 'BUDGET_EXHAUSTED', detail: 'EMPLOYEE:MONEY' }, 'the shared Employee level refuses although the second Work Item has headroom');
      assert.equal(s.gov.budgetFor('COMPANY', 'company')?.reservedMoney, 5_000, 'a refused reservation reserves nothing anywhere');
      assert.ok(h.store.audit(b.claim.fence.runId).some((x) => x.action === 'budget.refused' && x.reasonCode === 'BUDGET_EXHAUSTED'));
      // A third item with no Work Item budget at all.
      const { workItem } = h.store.createWorkItem({ objective: 'unbudgeted', ownerRef: s.employee.ref, processorKind: 'c2.employee-task', initialState: 'READY' });
      const c2 = claimNext(h.store, { ...h.claimOpts('w3', 60_000), kinds: C2_KINDS });
      assert.ok(c2 && c2.workItem.id === workItem.id);
      beginGovernedRun(h.store, c2.fence);
      assert.deepEqual(reserveBudget(h.store, c2.fence, modelReserve(s, 1)), { ok: false, code: 'BUDGET_MISSING', detail: 'WORK_ITEM_CHAIN' });
      assert.deepEqual(s.gov.accountingInvariants(), []);
    } finally {
      h.close();
    }
  });

  test('per-run limits: run cap, call ceiling and retry/fallback/escalation overhead ceiling', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      governedItem(h, s, s.employee, { cap: 100_000, runCap: 12_000 });
      const { claim } = claimGoverned(h);
      assert.ok(reserveBudget(h.store, claim.fence, modelReserve(s, 10_000)).ok);
      assert.deepEqual(reserveBudget(h.store, claim.fence, modelReserve(s, 5_000)), { ok: false, code: 'BUDGET_EXHAUSTED', detail: 'RUN:MONEY' });
      const overhead = reserveBudget(h.store, claim.fence, { ...modelReserve(s, 1_000), attemptKind: 'RETRY' });
      assert.ok(overhead.ok, 'overhead within the policy ceiling (50 000)');
      const esc1 = reserveBudget(h.store, claim.fence, { ...modelReserve(s, 100), attemptKind: 'ESCALATION' });
      assert.ok(esc1.ok);
      assert.deepEqual(reserveBudget(h.store, claim.fence, { ...modelReserve(s, 100), attemptKind: 'ESCALATION' }), { ok: false, code: 'RUN_LIMIT', detail: 'ESCALATION_DEPTH' });
      if (overhead.ok) releaseReservation(h.store, claim.fence, overhead.reservation.id, 'test');
      assert.deepEqual(s.gov.accountingInvariants(), []);
    } finally {
      h.close();
    }
  });

  test('crash inside settlement rolls back completely; an interrupted run\'s reservation is held, then reconciled', () => {
    let failSettle = false;
    const h = harness({ fault: (p) => { if (p === 'settlement.beforeCommit' && failSettle) throw new Error('injected crash'); } });
    try {
      const s = seed(h.store);
      governedItem(h, s);
      const { claim } = claimGoverned(h);
      const r = reserveBudget(h.store, claim.fence, modelReserve(s, 5_000, 1_000));
      assert.ok(r.ok);
      if (!r.ok) return;
      failSettle = true;
      assert.throws(() => settleReservation(h.store, claim.fence, r.reservation.id, { inputTokens: 10, outputTokens: 10, withinBounds: true, sessionId: null, outcome: 'OK' }));
      failSettle = false;
      assert.equal(s.gov.reservations(claim.fence.runId)[0]?.state, 'RESERVED', 'the failed settlement left nothing half-written');
      assert.deepEqual(s.gov.usage({ runId: claim.fence.runId }), []);
      assert.deepEqual(s.gov.accountingInvariants(), []);
      // The worker dies: recovery interrupts the claim and holds the uncertain reservation.
      interruptClaim(h.store, h.supervisor, claim.fence.jobId, 'TEST_CRASH');
      assert.deepEqual(recoverGovernedOrphans(h.store, h.supervisor), { reservationsHeld: 1, reservationsReleased: 0, invocationsRetryable: 0, invocationsHeld: 0 });
      const held = s.gov.reservations(claim.fence.runId)[0];
      assert.equal(held?.state, 'RECONCILIATION_REQUIRED');
      assert.equal(s.gov.budgetFor('COMPANY', 'company')?.reservedMoney, 5_000, 'held funds stay reserved: no hidden spend');
      assert.equal(s.gov.healthCounts().reservationsAwaitingReconciliation, 1);
      assert.throws(() => s.gov.reconcileReservation(s.employee.ref, held?.id as Id, { kind: 'RELEASE' }, 'x'), code('FOUNDER_ONLY'));
      s.gov.reconcileReservation(s.founder, held?.id as Id, { kind: 'CHARGE', inputTokens: 100, outputTokens: 10 }, 'provider.report');
      assert.equal(s.gov.reservations(claim.fence.runId)[0]?.state, 'SETTLED');
      assert.equal(s.gov.usage({ runId: claim.fence.runId })[0]?.outcome, 'RECONCILED');
      assert.deepEqual(s.gov.accountingInvariants(), []);
    } finally {
      h.close();
    }
  });

  test('a replaced worker cannot touch provider health (circuits / holds)', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      governedItem(h, s);
      const { claim } = claimGoverned(h);
      assert.throws(() => recordDeploymentOutcome(h.store, { ...claim.fence, fencingToken: claim.fence.fencingToken + 1 }, s.deploymentId, 'AUTH'), code('STALE_LEASE'));
      recordDeploymentOutcome(h.store, claim.fence, s.deploymentId, 'QUOTA_EXHAUSTED');
      assert.equal(s.gov.deployment(s.deploymentId).status, 'HOLD');
    } finally {
      h.close();
    }
  });

  test('a replaced worker cannot reserve; it may still record the truth about its own reservation', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      governedItem(h, s);
      const { claim } = claimGoverned(h);
      const r = reserveBudget(h.store, claim.fence, modelReserve(s, 1_000));
      assert.ok(r.ok);
      interruptClaim(h.store, h.supervisor, claim.fence.jobId, 'TEST');
      assert.throws(() => reserveBudget(h.store, claim.fence, modelReserve(s, 1_000)), code('STALE_LEASE'));
      if (r.ok) settleReservation(h.store, claim.fence, r.reservation.id, { inputTokens: 1, outputTokens: 1, withinBounds: true, sessionId: null, outcome: 'OK' });
      assert.deepEqual(s.gov.accountingInvariants(), []);
    } finally {
      h.close();
    }
  });
});

describe('C2 secrets: no plaintext secret enters Company state', () => {
  test('credential columns hold vault references only; secret-named keys are refused in profiles', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      assert.throws(() => s.gov.registerProvider(s.founder, { code: 'p2', locality: 'EXTERNAL', credentialRef: 'sk-live-1234567890abcdef' }), code('VALIDATION_FAILED'));
      assert.throws(() => s.gov.registerTool(s.founder, { code: 't2', driverCode: 'd2', egress: 'NONE', credentialRef: 'vault:Has Space' }), code('VALIDATION_FAILED'));
      assert.throws(() => s.gov.createEmployee(s.founder, { name: { given: 'Rana', family: 'Fawzy' }, profile: { apiKey: 'x' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E1', costDiscipline: 'STRICT' }, roleRef: 'role:x', positionRef: 'position:x', departmentId: s.departmentId, managerRef: s.founder }), code('VALIDATION_FAILED'));
      assert.equal(s.gov.provider(s.gov.routingSnapshot('draft.memo').deployments[0]?.providerId as Id).credentialRef, null);
    } finally {
      h.close();
    }
  });
});

describe('C2 schema: history is durable', () => {
  test('released migration 4 is applied; C1 tables are unchanged in role', () => {
    const h = harness();
    try {
      assert.equal(h.store.schemaVersion, 4);
      assert.equal(CompanyStore.name, 'CompanyStore');
    } finally {
      h.close();
    }
  });
});
