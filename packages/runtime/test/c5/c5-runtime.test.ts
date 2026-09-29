/**
 * C5 runtime proofs through the real Runtime Supervisor with deterministic fakes: the CEO answers the
 * Founder from its own governed run with a MESSAGE proposal; a brief follows the Founder Communication
 * Standard; a Director derives a Department goal from inside its run (fenced); a message never grants
 * authority; logs stay content-free; the `founder` admin handle wakes the dispatcher.
 * C5-PROOF: runtime-c5
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';
import { CompanyStore, GovernanceStore, OrganizationStore, type EmployeeRecord } from '@qandeel-company/storage';
import { activateEmployeeForTest } from '@qandeel-company/storage/testing';

import { Logger, type CompanyRuntime, type LogRecord } from '../../src/index.js';
import { eventually, removeRoot, tempRoot } from '../helpers.js';
import { fakes, final, governedRuntime, nextName, script, seedWorld, type C2World, type Fakes } from '../c2/c2-seed.js';

/** The value a proof relies on, present by construction of the fixture. */
function must<T>(v: T | null | undefined, what = 'value'): T {
  if (v === null || v === undefined) throw new Error(`${what} is missing`);
  return v;
}

const state = (rt: CompanyRuntime, id: Id): string => rt.view.getWorkItem(id).state;
const until = (rt: CompanyRuntime, id: Id, states: readonly string[], ms = 30_000): Promise<string> => eventually(() => (states.includes(state(rt, id)) ? state(rt, id) : undefined), ms, `${id} → ${states.join('|')}`);

interface World {
  readonly ceo: EmployeeRecord;
  readonly director: EmployeeRecord;
}

function hireAs(gov: GovernanceStore, w: C2World, roleRef: string, departmentId: Id): EmployeeRecord {
  const e = gov.createEmployee(w.founder, { name: nextName(), profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef, positionRef: 'position:p1', departmentId, managerRef: w.founder });
  gov.transitionEmployee(w.founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
  gov.transitionEmployee(w.founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
  activateEmployeeForTest(gov, w.founder, e.id);
  gov.createBudget(w.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 5_000_000, capTokens: 5_000_000, reasonCode: 'seed' });
  gov.grant(w.founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'seed' });
  return gov.getEmployee(e.id);
}

/** Before start: the CEO seat and the Growth Director placed; task classes for replies and briefs routed. */
function seedC5(root: string, w: C2World): World {
  const store = CompanyStore.open(root);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const ceoSeat = must(org.positionByCode('company.ceo'));
    const ceo = hireAs(gov, w, ceoSeat.roleRef, w.departmentId);
    org.assignPrimary(w.founder, { positionId: ceoSeat.id, employeeId: ceo.id, reasonCode: 'placed' });
    const dirSeat = must(org.positionByCode('director.growth'));
    const director = hireAs(gov, w, dirSeat.roleRef, w.departmentId);
    org.assignPrimary(w.founder, { positionId: dirSeat.id, employeeId: director.id, reasonCode: 'placed' });
    return { ceo: gov.getEmployee(ceo.id), director: gov.getEmployee(director.id) };
  } finally {
    store.close();
  }
}

async function withRuntime(label: string, fn: (ctx: { root: string; w: C2World; f: Fakes; rt: CompanyRuntime; o: World; logs: LogRecord[] }) => Promise<void>): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const o = seedC5(root, w);
  const f = fakes();
  const logs: LogRecord[] = [];
  const rt = governedRuntime(root, f, { logger: new Logger((r) => logs.push(r)) });
  try {
    await rt.start();
    await fn({ root, w, f, rt, o, logs });
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

describe('C5 runtime: Founder communication through governed runs', () => {
  test('C5-PROOF: the Founder asks; the CEO\'s run answers with a MESSAGE proposal into that thread; the pending request resolves; nothing grants authority', () =>
    withRuntime('c5-reply', async ({ rt, w, o, logs }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const body = `ما وضع الإطلاق؟\n${script({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'الإطلاق على المسار: المحتوى قيد المراجعة.', brief: null, contextRefs: [] }, final('reply.sent'))}`;
      const grantsBefore = rt.governance.grants(o.ceo.id).length;
      const sent = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body, replyTaskClass: 'draft.memo' });
      assert.ok(sent.replyWorkItemId);
      await until(rt, must(sent.replyWorkItemId), ['COMPLETED']);
      const messages = comm.messages(thread.id);
      assert.deepEqual(messages.map((m) => [m.senderKind, m.purpose]), [['FOUNDER', 'QUESTION'], ['EMPLOYEE', 'RESULT']]);
      assert.equal(must(messages[1]).senderRef, o.ceo.ref);
      assert.equal(must(messages[1]).runId, rt.view.runsForWorkItem(must(sent.replyWorkItemId))[0]?.id, 'bound to the run that wrote it');
      assert.equal(comm.pendingReplies().length, 0);
      assert.equal(rt.governance.grants(o.ceo.id).length, grantsBefore, 'a message is not authority');
      const joined = JSON.stringify(logs);
      assert.ok(!joined.includes('الإطلاق') && !joined.includes('المحتوى'), 'logs carry no message content (Rule A)');
      assert.ok(rt.founder.attention.sync().open === 0, 'a RESULT to a question is not Founder attention');
    }));

  test('C5-PROOF: a requested CEO brief arrives in the Founder Communication Standard and enters the CEO_BRIEFS lane; a brief without its structure is refused at the fence', () =>
    withRuntime('c5-brief', async ({ rt, w, f, o }) => {
      const brief = { type: 'MESSAGE', purpose: 'BRIEF', attentionLevel: 'INFORMATIONAL', body: 'موجز', brief: { happening: 'حملة جاهزة', matters: 'تأخير يكلف', recommendation: 'اعتمد السقف', decisionNeeded: true, decision: 'اعتماد ٥٠ ألف' }, contextRefs: [] };
      // A well-formed MESSAGE whose purpose says BRIEF but that is posted into a FOUNDER_CEO thread is fine; the same
      // proposal from a run that is not a brief / reply run is refused by the fence (no thread binding).
      // The router picks the cheapest qualified route for the brief's data class; every fake deployment
      // answers the same way so the proof does not depend on the price cards.
      for (const code of ['local-e1', 'local-e2']) f.local.defaultScript(code, [brief, final('brief.sent')]);
      for (const code of ['cloud-e1', 'cloud-e1b']) f.cloud.defaultScript(code, [brief, final('brief.sent')]);
      const req = rt.founder.communications.requestCeoBrief({ subject: 'قرار مطلوب', contextKind: 'APPROVAL', contextRef: 'approval:x', reasonCode: 'brief.test', instructions: 'Brief the Founder.', taskClass: 'draft.memo' });
      assert.equal(rt.view.getWorkItem(req.workItemId).ownerRef, o.ceo.ref);
      await until(rt, req.workItemId, ['COMPLETED']);
      const briefs = rt.founder.communications.messages(req.thread.id).filter((m) => m.purpose === 'BRIEF');
      assert.equal(briefs.length, 1);
      assert.deepEqual([must(briefs[0]).attentionLevel, must(briefs[0]).brief?.decisionNeeded], ['NEEDS_DECISION', true]);
      // An ordinary task run (no thread binding) proposing the same MESSAGE: refused at the fence, nothing recorded.
      const { workItem: stray } = rt.submitWorkItem({ objective: 'stray', ownerRef: o.ceo.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 256, instructions: script(brief, final('done')) } });
      rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: stray.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'seed' });
      rt.transitionWorkItem(stray.id, { to: 'READY', reasonCode: 'release' });
      await until(rt, stray.id, ['COMPLETED']);
      assert.equal(rt.founder.communications.health().briefs, 1, 'a run without a thread binding cannot speak to the Founder');
      const sync = rt.founder.attention.sync(w.founder);
      assert.equal(sync.open, 1);
      assert.equal(rt.founder.attention.list()[0]?.lane, 'CEO_BRIEFS');
    }));

  test('C5-PROOF: a Director derives a Department goal from inside its run (fenced, seat-checked); an ordinary employee cannot', () =>
    withRuntime('c5-goal-act', async ({ rt, w, o }) => {
      const goals = rt.founder.goals;
      let parent = goals.propose(w.founder, { kind: 'COMPANY', title: 'إطلاق السعودية', summary: 'x', ownerRef: o.ceo.ref });
      parent = goals.transition(w.founder, parent.id, { to: 'APPROVED', reasonCode: 'ok' });
      const derive = { type: 'GOAL_ACTION', action: 'goal.derive', args: { parentGoalId: parent.id, title: 'نمو عضوي', summary: 'محتوى عربي', successCriteria: ['x'] } };
      const submit = (e: EmployeeRecord): Id => {
        const { workItem } = rt.submitWorkItem({ objective: 'derive', ownerRef: e.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 256, instructions: script(derive, final('done')) } });
        rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'seed' });
        rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
        return workItem.id;
      };
      const byEmployee = submit(w.employee);
      await until(rt, byEmployee, ['COMPLETED']);
      assert.equal(goals.list({ kind: 'DEPARTMENT' }).length, 0, 'no seat, no derivation');
      const byDirector = submit(o.director);
      await until(rt, byDirector, ['COMPLETED']);
      const derived = goals.list({ kind: 'DEPARTMENT' });
      assert.equal(derived.length, 1);
      assert.deepEqual([must(derived[0]).parentGoalId, must(derived[0]).state, must(derived[0]).departmentId, must(derived[0]).ownerRef], [parent.id, 'ACTIVE', w.departmentId, o.director.ref]);
      const again = submit(o.director);
      await until(rt, again, ['COMPLETED']);
      assert.equal(goals.list({ kind: 'DEPARTMENT' }).length, 1, 'idempotent per (employee, parent, title)');
    }));
});
