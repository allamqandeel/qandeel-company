/**
 * P1-E4-RELIABILITY-01 (D-P1-12) — the Founder's own E4 through the REAL governed runtime and the REAL DeepSeek adapter behind
 * a deterministic fake transport (no network, no credential, no paid call). Proves:
 *   - a Founder E4 is still `reasoning_effort=max`, now with ONE call of `max_tokens=32,768`, reserved at that worst case;
 *     every other reply keeps the unchanged table, and a Work Item created before keeps its recorded input;
 *   - an exhausted or invalid output at the Founder's E4 is never re-sent (no restart, no identical replay), including
 *     from a checkpoint an earlier release wrote; a budget that cannot fund the 32,768 call parks it before any call;
 *   - deadline-aware admission: a call whose own timeout (plus the margin) would outlast the run is not sent and nothing is
 *     reserved; the reply continues in a new run, where the call is admitted; a step after a tool result still runs at E4.
 * P1-PROOF: e4-reliability
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';
import { MANUAL_E4_OUTPUT_ALLOWANCE, OUTPUT_ALLOWANCE_BY_CLASS, worstCase, type ReasoningClass } from '@qandeel-company/governance';
import { DEEPSEEK_MODELS_PATH, DEEPSEEK_MODEL_CODE, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DEEPSEEK_V41_FLASH_REASONING_PROFILE, DeepSeekProviderAdapter, FakeDeepSeekTransport, fakeChatAnswer, fakeModelsAnswer, type DeepSeekResponse } from '@qandeel-company/model-providers';
import { InMemorySecretVault } from '@qandeel-company/secret-vault';
import { CompanyStore, GovernanceStore, OrganizationStore, type EmployeeRecord } from '@qandeel-company/storage';
import { activateEmployeeForTest } from '@qandeel-company/storage/testing';

import { MODEL_CALL_DEADLINE_MARGIN_MS, admitsCall, modelCallTimeoutMs } from '../../src/c2/model-runtime.js';
import { employeeTaskProcessor, type CompanyRuntime, type GovernedProcessor } from '../../src/index.js';
import { eventually, removeRoot, runtimeFor, tempRoot } from '../helpers.js';
import { fakes, nextName, seedWorld, type C2World } from '../c2/c2-seed.js';

const KEY = 'vault-proof-' + 'Rk7Tq2Wm9Xz4Lb6Nc1Pv8Hs3';
const STRATEGY = 'Prepare a three-year go-to-market strategy for launching QANDEEL across the GCC. Compare the pricing options, recommend the budget split, and tell me which roles we must hire first.';
const message = (body: string): string => JSON.stringify({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body, brief: null, contextRefs: [] });
const ok = (body = 'Done.'): DeepSeekResponse => fakeChatAnswer(message(body), { prompt: 300, completion: 30 });
const extraField = (): DeepSeekResponse => fakeChatAnswer(JSON.stringify({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'x', brief: null, contextRefs: [], note: 'extra field' }), { prompt: 300, completion: 60 });
const notJson = (): DeepSeekResponse => fakeChatAnswer('not json', { prompt: 300, completion: 20 });
const noteTool = (): DeepSeekResponse => fakeChatAnswer(JSON.stringify({ type: 'TOOL_REQUEST', tool: 'brief-notes', action: 'append', args: { text: 'evidence for the plan' } }), { prompt: 300, completion: 40 });
const PARTIAL = '{"type":"MESSAGE","purpose":"RESULT","attentionLevel":"INFORMATIONAL","body":"The plan has three par';
function truncated(maxTokens: number): DeepSeekResponse {
  return fakeChatAnswer(PARTIAL, { prompt: 300, completion: maxTokens }, {
    choices: [{ index: 0, message: { role: 'assistant', content: PARTIAL }, finish_reason: 'length' }],
    usage: { prompt_tokens: 300, completion_tokens: maxTokens, total_tokens: 300 + maxTokens, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 300, completion_tokens_details: { reasoning_tokens: maxTokens } },
  });
}
const later = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));

interface Sent {
  readonly thinking: unknown;
  readonly effort: unknown;
  readonly maxTokens: number;
}
interface World {
  readonly w: C2World;
  readonly ceo: EmployeeRecord;
  readonly rt: CompanyRuntime;
  readonly sent: Sent[];
  readonly notes: ReturnType<typeof fakes>['drivers']['notes'];
}
interface Options {
  /** The runtime's base model-call timeout (default 5 s); the allowance scales it (D-P1-09). */
  readonly callTimeoutMs?: number;
  /** The employee-task processor, or a proof wrapper around it (a shorter run limit, a legacy checkpoint). */
  readonly processor?: GovernedProcessor;
}

type Chat = (n: number, maxTokens: number) => DeepSeekResponse | Promise<DeepSeekResponse>;

/** The LIVE shape: the CEO (AUTO, E1 default, E4 maximum) with E3 / E4 provisioned for conversation, and one R1 note tool. */
function seed(root: string, w: C2World): EmployeeRecord {
  const store = CompanyStore.open(root);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const seat = org.positionByCode('company.ceo');
    if (!seat) throw new Error('the CEO seat is release-seeded');
    const e = gov.createEmployee(w.founder, { name: nextName(), profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E4', costDiscipline: 'BALANCED', selection: 'AUTO' }, roleRef: seat.roleRef, positionRef: 'position:p1', departmentId: w.departmentId, managerRef: w.founder });
    gov.transitionEmployee(w.founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(w.founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, w.founder, e.id);
    gov.createBudget(w.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 2_000_000, capTokens: 2_000_000, reasonCode: 'seed' });
    gov.grant(w.founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'seed' });
    // A D2 note tool (the reply's own data class, like the product-docs read): its result never lifts the context above E4's route.
    const tool = gov.registerTool(w.founder, { code: 'brief-notes', driverCode: 'fake-notes', egress: 'NONE' });
    gov.registerToolAction(w.founder, { toolId: tool.id, code: 'append', risk: 'R1', sideEffects: 'NONE', mutatesExternal: false, dataClassCeiling: 'D2', argsSchema: { fields: { text: { type: 'string', required: true, maxLength: 500 } } }, costPerCallMicros: 50 });
    gov.grant(w.founder, { employeeId: e.id, capability: 'tool:brief-notes.append', riskCeiling: 'R1', dataClassCeiling: 'D2', reasonCode: 'seed' });
    org.assignPrimary(w.founder, { positionId: seat.id, employeeId: e.id, reasonCode: 'placed' });
    gov.recordModelIdentityCheck({ providerCode: 'deepseek', modelCode: DEEPSEEK_MODEL_CODE, expectedName: 'DeepSeek-V4.1-Flash', observedName: 'DeepSeek-V4.1-Flash', result: 'MATCH' });
    gov.provisionProviderProfile(w.founder, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, { capMoney: 5_000_000, capTokens: 50_000_000, reasonCode: 'l1.activation' });
    gov.provisionProviderProfile(w.founder, DEEPSEEK_V41_FLASH_REASONING_PROFILE, { capMoney: 0, capTokens: 0, reasonCode: 'p1.chat_levels' });
    return gov.getEmployee(e.id);
  } finally {
    store.close();
  }
}

async function withWorld(label: string, o: Options, chat: Chat, fn: (x: World) => Promise<void>): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const ceo = seed(root, w);
  const sent: Sent[] = [];
  const transport = new FakeDeepSeekTransport().respondWith((request) => {
    if (request.path === DEEPSEEK_MODELS_PATH) return fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: 'DeepSeek-V4.1-Flash' }]);
    const body = request.body as { thinking: unknown; reasoning_effort?: unknown; max_tokens: number };
    sent.push({ thinking: body.thinking, effort: body.reasoning_effort, maxTokens: body.max_tokens });
    return chat(sent.length, body.max_tokens) as DeepSeekResponse;
  });
  const notes = fakes().drivers.notes;
  const adapter = new DeepSeekProviderAdapter({ vault: new InMemorySecretVault().set('deepseek-company', KEY), transport });
  const rt = runtimeFor(root, { processors: [o.processor ?? employeeTaskProcessor], governance: { providers: [adapter], provisioningProfiles: [DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DEEPSEEK_V41_FLASH_REASONING_PROFILE], toolDrivers: [notes], modelCallTimeoutMs: o.callTimeoutMs ?? 5_000 } });
  try {
    await rt.start();
    await fn({ w, ceo, rt, sent, notes });
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

const state = (rt: CompanyRuntime, id: Id): string => rt.view.getWorkItem(id).state;
const settled = (rt: CompanyRuntime, id: Id, within = 20_000): Promise<string> => eventually(() => (['COMPLETED', 'FAILED', 'WAITING', 'BLOCKED'].includes(state(rt, id)) ? state(rt, id) : undefined), within, `work item ${id}`);
const audits = (rt: CompanyRuntime, id: Id, action: string): Record<string, unknown>[] => rt.view.runsForWorkItem(id).flatMap((r) => rt.view.audit(r.id)).filter((a) => a.action === action).map((a) => ({ reason: a.reasonCode, ...a.details }));
const reservations = (rt: CompanyRuntime, id: Id) => rt.view.runsForWorkItem(id).flatMap((r) => rt.governance.reservations(r.id)).filter((r) => r.purpose === 'MODEL_CALL');
const failure = (rt: CompanyRuntime, id: Id): string | null | undefined => rt.view.runsForWorkItem(id).at(-1)?.failureCode;
const ask = (rt: CompanyRuntime, w: C2World, body: string, reasoningClass?: ReasoningClass, replyCap?: { money: number; tokens: number }): Id => {
  const comm = rt.founder.communications;
  const thread = comm.directThread(w.founder, null);
  return comm.send(w.founder, thread.id, { purpose: 'QUESTION', body, ...(reasoningClass ? { reasoningClass } : {}), ...(replyCap ? { replyCap } : {}) }).replyWorkItemId as Id;
};
const replyState = (rt: CompanyRuntime, w: C2World, id: Id) => {
  const comm = rt.founder.communications;
  const s = comm.replyStates(comm.directThread(w.founder, null).id).find((r) => r.replyWorkItemId === id);
  assert.ok(s, 'the reply state of the message');
  return s;
};
const employeeMessages = (rt: CompanyRuntime, w: C2World) => {
  const comm = rt.founder.communications;
  return comm.messages(comm.directThread(w.founder, null).id).filter((m) => m.senderKind === 'EMPLOYEE');
};
const input = (rt: CompanyRuntime, id: Id): { maxOutputTokens?: number; maxOutputTokensByClass?: Record<string, number> } => rt.view.getWorkItem(id).processorInput as never;

describe('P1-E4-RELIABILITY-01: deadline admission (the arithmetic)', () => {
  test('a call is admitted only while its own timeout plus the margin fits the run: E4 at 32,768 needs 272,144 ms of a 600,000 ms run; the timeouts themselves are unchanged', () => {
    assert.equal(MODEL_CALL_DEADLINE_MARGIN_MS, 10_000);
    assert.equal(modelCallTimeoutMs(120_000, MANUAL_E4_OUTPUT_ALLOWANCE), 262_144, 'D-P1-09 scaling, unchanged');
    assert.equal(admitsCall(272_144, 120_000, 32_768), true);
    assert.equal(admitsCall(272_143, 120_000, 32_768), false);
    assert.equal(admitsCall(130_000, 120_000, 2_048), true, 'a small call keeps the base timeout');
    assert.equal(admitsCall(129_999, 120_000, 2_048), false);
    assert.equal(admitsCall(-1, 120_000, 2_048), false, 'a passed deadline admits nothing');
    // A fresh 10-minute run admits a Founder E4 call twice over, never three times: a third call waits for a new run.
    assert.equal(admitsCall(600_000 - 2 * 262_144, 120_000, 32_768), false);
    assert.equal(admitsCall(600_000 - 262_144, 120_000, 32_768), true);
  });
});

describe('P1-E4-RELIABILITY-01: the Founder\'s E4 (D-P1-12)', () => {
  test('1, 4, 5, 10 · a Founder E4 sends reasoning_effort=max with max_tokens=32,768; the valid answer is accepted and reserved at the 32,768 worst case; replies at another level or AUTO keep the unchanged table', () =>
    withWorld('p1e4-manual', {}, () => ok('A focused strategic answer.'), async ({ rt, w, sent }) => {
      const e4 = ask(rt, w, STRATEGY, 'E4');
      assert.equal(await settled(rt, e4), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.thinking, s.effort, s.maxTokens]), [[{ type: 'enabled' }, 'max', 32_768]], 'thinking max, never downgraded; one allowance for thinking and answer');
      const [r] = reservations(rt, e4);
      assert.ok(r);
      assert.deepEqual([r.attemptKind, r.state, rt.governance.deployment(r.deploymentId as Id).reasoningClass], ['PRIMARY', 'SETTLED', 'E4']);
      const card = rt.governance.priceCard(r.priceCardId as Id);
      assert.equal(r.money, worstCase(card, r.tokens - 32_768, 32_768).economicMicros, 'the reservation is the worst case of the actual 32,768 allowance');
      assert.deepEqual(input(rt, e4).maxOutputTokensByClass, { ...OUTPUT_ALLOWANCE_BY_CLASS, E4: 32_768 });
      assert.equal(input(rt, e4).maxOutputTokens, 32_768);
      const s = replyState(rt, w, e4);
      assert.deepEqual([s.status, s.selection.mode, s.requestedClass, s.answeredClasses, s.reservedMoney], ['REPLIED', 'MANUAL', 'E4', ['E4'], 0]);
      assert.deepEqual(employeeMessages(rt, w).map((m) => m.body), ['A focused strategic answer.']);
      // Every other reply keeps the approved table (E4 16,384), so an escalation or a default never inherits the larger call.
      const auto = ask(rt, w, 'Thanks, got it.');
      const e3 = ask(rt, w, STRATEGY, 'E3');
      assert.equal(await settled(rt, auto), 'COMPLETED');
      assert.equal(await settled(rt, e3), 'COMPLETED');
      for (const id of [auto, e3]) assert.deepEqual(input(rt, id).maxOutputTokensByClass, OUTPUT_ALLOWANCE_BY_CLASS);
      assert.deepEqual(sent.slice(1).map((x) => [x.effort ?? 'off', x.maxTokens]), [['off', 2_048], ['high', 8_192]]);
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('3 · an invalid output at the Founder\'s E4 (MALFORMED, NOT_JSON) ends MODEL_OUTPUT_INVALID after exactly one paid call: no identical replay, no other level, no message', () =>
    withWorld('p1e4-invalid', {}, (n) => (n === 1 ? extraField() : notJson()), async ({ rt, w, sent }) => {
      const malformed = ask(rt, w, STRATEGY, 'E4');
      assert.equal(await settled(rt, malformed), 'FAILED');
      const garbled = ask(rt, w, STRATEGY, 'E4');
      assert.equal(await settled(rt, garbled), 'FAILED');
      assert.deepEqual(sent.map((s) => [s.effort, s.maxTokens]), [['max', 32_768], ['max', 32_768]], 'one call per reply');
      for (const id of [malformed, garbled]) {
        assert.equal(failure(rt, id), 'MODEL_OUTPUT_INVALID');
        assert.deepEqual(reservations(rt, id).map((r) => [r.attemptKind, r.state]), [['PRIMARY', 'SETTLED']], 'charged once, truthfully');
        const s = replyState(rt, w, id);
        assert.deepEqual([s.status, s.reasonCode, s.replyMessageId], ['FAILED', 'MODEL_OUTPUT_INVALID', null]);
      }
      assert.deepEqual([...audits(rt, malformed, 'run.model_output_invalid'), ...audits(rt, garbled, 'run.model_output_invalid')].map((a) => [a.reason, a.reasoningClass, a.malformedReason ?? null]), [['MALFORMED', 'E4', 'FIELD_SET'], ['NOT_JSON', 'E4', null]], 'the real cause is recorded, content-free');
      assert.equal(employeeMessages(rt, w).length, 0);
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('3, 11 · after two tool steps at the Founder\'s E4, an invalid third output is reported as what it is (MODEL_OUTPUT_INVALID), never as the call bound, and is not re-sent', () =>
    withWorld('p1e4-invalid-third', {}, (n) => (n <= 2 ? noteTool() : notJson()), async ({ rt, w, sent, notes }) => {
      const id = ask(rt, w, STRATEGY, 'E4');
      assert.equal(await settled(rt, id), 'FAILED');
      assert.deepEqual(sent.map((s) => [s.effort, s.maxTokens]), [['max', 32_768], ['max', 32_768], ['max', 32_768]], 'two legitimate steps after tool results, then the failed one: no fourth call');
      assert.equal(notes.invocations.length, 2);
      assert.equal(failure(rt, id), 'MODEL_OUTPUT_INVALID');
      assert.deepEqual([replyState(rt, w, id).status, replyState(rt, w, id).reasonCode], ['FAILED', 'MODEL_OUTPUT_INVALID']);
    }));

  test('6 · a reply budget that could fund a 16,384 call but not the 32,768 one parks the Founder\'s E4 before any call; the same budget funds a Founder E3', () =>
    withWorld('p1e4-budget', {}, () => ok('Answered at E3.'), async ({ rt, w, sent }) => {
      const cap = { money: 500_000, tokens: 30_000 };
      const e4 = ask(rt, w, STRATEGY, 'E4', cap);
      await eventually(() => replyState(rt, w, e4).status === 'WAITING_FOR_BUDGET' || undefined, 20_000, 'the budget wait');
      assert.deepEqual([sent.length, reservations(rt, e4).length, replyState(rt, w, e4).reasonCode], [0, 0, 'BUDGET_EXHAUSTED'], 'no paid call, nothing reserved, no silent budget increase');
      const e3 = ask(rt, w, STRATEGY, 'E3', cap);
      assert.equal(await settled(rt, e3), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.effort, s.maxTokens]), [['high', 8_192]]);
    }));

  test('7, 8, 11 · after a tool result the next E4 step is refused before any reservation when the run has too little time left for its call; a new run admits it and the reply lands — the tool ran once, every call at E4 32,768', () => {
    // A 13.5 s run and a 1 s base timeout: an E4 call (32,768 → 2.19 s) needs 12.19 s of run left. The first call takes 1.5 s,
    // so the second step has at most 12.0 s: it is not sent. The next run starts with 13.5 s and admits it.
    const short: GovernedProcessor = { ...employeeTaskProcessor, maxRunMs: 13_500 };
    return withWorld('p1e4-deadline', { processor: short, callTimeoutMs: 1_000 }, (n) => (n === 1 ? later(1_500, noteTool()) : ok('The plan, with the evidence noted.')), async ({ rt, w, sent, notes }) => {
      const id = ask(rt, w, STRATEGY, 'E4');
      assert.equal(await settled(rt, id), 'COMPLETED');
      const runs = rt.view.runsForWorkItem(id);
      assert.deepEqual(runs.map((r) => r.failureCode ?? null), ['RUN_DEADLINE_INSUFFICIENT', null], 'the first run stopped before the call it could not finish; the second answered');
      assert.deepEqual(runs.map((r) => rt.governance.reservations(r.id).map((x) => [x.purpose, x.attemptKind, x.state])), [[['MODEL_CALL', 'PRIMARY', 'SETTLED'], ['TOOL_CALL', 'PRIMARY', 'SETTLED']], [['MODEL_CALL', 'PRIMARY', 'SETTLED']]], 'the call, then the tool; the refused call reserved nothing; nothing is held');
      assert.deepEqual(sent.map((s) => [s.effort, s.maxTokens]), [['max', 32_768], ['max', 32_768]], 'exactly the two E4 calls the reply needed');
      assert.equal(notes.invocations.length, 1, 'the tool step is not repeated by the new run');
      const s = replyState(rt, w, id);
      assert.deepEqual([s.status, s.answeredClasses, s.callDetails.map((c) => [c.reasoningClass, c.maxOutputTokens])], ['REPLIED', ['E4', 'E4'], [['E4', 32_768], ['E4', 32_768]]]);
      assert.equal(rt.governance.accountingInvariants().length, 0);
    });
  });

  test('a checkpoint an earlier release wrote (an invalid E4 output awaiting its same-class retry) is not re-sent at the Founder\'s E4; a Founder E3 keeps its one same-class retry', () => {
    let stale: Record<string, unknown> | null = null;
    const legacy: GovernedProcessor = {
      ...employeeTaskProcessor,
      async runGoverned(ctx, gov) {
        if (!ctx.resumeFrom && stale !== null) {
          await ctx.checkpoint('employee-loop', stale as never);
          return { type: 'RETRYABLE_FAILURE', code: 'PROVIDER_FAILURE' };
        }
        return employeeTaskProcessor.runGoverned(ctx, gov);
      },
    };
    return withWorld('p1e4-legacy', { processor: legacy }, () => ok('Retried at E3.'), async ({ rt, w, sent }) => {
      stale = { turn: 0, phase: 'MODEL', pending: null, modelCalls: 1, invalid: 1 };
      const e4 = ask(rt, w, STRATEGY, 'E4');
      assert.equal(await settled(rt, e4), 'FAILED');
      assert.deepEqual([failure(rt, e4), reservations(rt, e4).length, sent.length], ['MODEL_OUTPUT_INVALID', 0, 0], 'no identical E4 replay');
      const e3 = ask(rt, w, STRATEGY, 'E3');
      assert.equal(await settled(rt, e3), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.effort, s.maxTokens]), [['high', 8_192]], 'MANUAL E3 is unchanged');
    });
  });

  test('12 · a Work Item created before (E4 16,384 in its recorded input) is never rewritten: its Founder E4 call uses 16,384 and an exhaustion still ends after that one call', () =>
    withWorld('p1e4-old-item', {}, (_n, max) => truncated(max), async ({ rt, w, ceo, sent }) => {
      const recorded = { taskClass: 'founder.reply', dataClass: 'D2', maxOutputTokens: 16_384, maxOutputTokensByClass: { ...OUTPUT_ALLOWANCE_BY_CLASS }, maxTurns: 3, maxModelCalls: 3, instructions: 'Founder message (QUESTION): plan the launch.' };
      const { workItem } = rt.submitWorkItem({ objective: 'an earlier reply', ownerRef: ceo.ref, processorKind: 'c2.employee-task', processorInput: recorded });
      rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 500_000, capTokens: 200_000, reasonCode: 'seed' });
      rt.governance.setWorkItemReasoningOverride(w.founder, workItem.id, { reasoningClass: 'E4', reasonCode: 'founder.one_task' });
      rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
      assert.equal(await settled(rt, workItem.id), 'FAILED');
      assert.deepEqual(rt.view.getWorkItem(workItem.id).processorInput, recorded, 'the recorded input is unchanged');
      assert.deepEqual(sent.map((s) => [s.effort, s.maxTokens]), [['max', 16_384]], 'its own allowance, and no restart');
      assert.equal(failure(rt, workItem.id), 'MODEL_OUTPUT_TRUNCATED');
    }));
});
