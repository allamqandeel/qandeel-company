/**
 * L1-01 governed-runtime proofs with the REAL DeepSeek adapter behind a deterministic fake transport and an
 * in-memory vault (no network, no credential, no paid call): the Founder ↔ CEO path through Context Assembly →
 * authorization → routing → reservation → the adapter → settlement; authorization and budget refusals before
 * any network; D3 / D4 never leave; alias drift holds the deployment; chain-of-thought and the credential are
 * never persisted; retry / fallback semantics unchanged. L1-PROOF: runtime-l1
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';
import { ProviderError, worstCase } from '@qandeel-company/governance';
import { DEEPSEEK_CHAT_COMPLETIONS_PATH, DEEPSEEK_MODELS_PATH, DEEPSEEK_MODEL_CODE, DEEPSEEK_V41_FLASH_PROFILE, DeepSeekProviderAdapter, FakeDeepSeekTransport, fakeChatAnswer, fakeModelsAnswer, type DeepSeekRequest, type DeepSeekResponse } from '@qandeel-company/model-providers';
import { InMemorySecretVault } from '@qandeel-company/secret-vault';
import { CompanyStore, GovernanceStore, OrganizationStore, type EmployeeRecord } from '@qandeel-company/storage';
import { activateEmployeeForTest } from '@qandeel-company/storage/testing';

import { Logger, employeeTaskProcessor, type CompanyRuntime, type LogRecord } from '../../src/index.js';
import { eventually, removeRoot, runtimeFor, tempRoot } from '../helpers.js';
import { nextName, seedWorld, type C2World } from '../c2/c2-seed.js';

// Secret-shaped for the proofs; matches no real provider key format.
const KEY = 'vault-proof-' + 'Hs8Kd2Pq6Vw1Zb4Nx7Ct3Lm9';
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const MESSAGE = JSON.stringify({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'أهلاً يا محمد. فهمت أننا نستعد لإطلاق قنديل، وعندي ثلاثة أسئلة قبل أن نبدأ.', brief: null, contextRefs: [] });
const FINAL = '{"type":"FINAL","summaryCode":"reply.sent"}';
/** A real model answers the Founder with ONE message, then — seeing it recorded in its context — proposes FINAL. */
function replyThenFinal(request: DeepSeekRequest): string {
  const messages = (request.body as { messages: { content: string }[] }).messages;
  return messages.some((m) => m.content.includes('RECORDED')) ? FINAL : MESSAGE;
}

interface World {
  readonly root: string;
  readonly w: C2World;
  readonly ceo: EmployeeRecord;
  readonly transport: FakeDeepSeekTransport;
  readonly adapter: DeepSeekProviderAdapter;
  readonly rt: CompanyRuntime;
  readonly logs: LogRecord[];
  readonly deployments: Id[];
  readonly providerId: Id;
}

/** The fake answers GET /models with the qualified identity and POST /chat/completions by `chat`. */
function transportWith(chat: (request: DeepSeekRequest) => DeepSeekResponse, identity = fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: 'DeepSeek-V4.1-Flash' }])): FakeDeepSeekTransport {
  return new FakeDeepSeekTransport().respondWith((request) => (request.path === DEEPSEEK_MODELS_PATH ? identity : chat(request)));
}

/** Seam-seeded identities (as every acceptance does); DeepSeek provisioned through the canonical catalog APIs. */
function seedL1(root: string, w: C2World): { ceo: EmployeeRecord; deployments: Id[]; providerId: Id } {
  const store = CompanyStore.open(root);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const seat = org.positionByCode('company.ceo');
    if (!seat) throw new Error('the CEO seat is release-seeded');
    const e = gov.createEmployee(w.founder, { name: nextName(), profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: seat.roleRef, positionRef: 'position:p1', departmentId: w.departmentId, managerRef: w.founder });
    gov.transitionEmployee(w.founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(w.founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, w.founder, e.id);
    gov.createBudget(w.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 2_000_000, capTokens: 2_000_000, reasonCode: 'seed' });
    gov.grant(w.founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'seed' });
    org.assignPrimary(w.founder, { positionId: seat.id, employeeId: e.id, reasonCode: 'placed' });
    gov.recordModelIdentityCheck({ providerCode: 'deepseek', modelCode: DEEPSEEK_MODEL_CODE, expectedName: 'DeepSeek-V4.1-Flash', observedName: 'DeepSeek-V4.1-Flash', result: 'MATCH' });
    const out = gov.provisionProviderProfile(w.founder, DEEPSEEK_V41_FLASH_PROFILE, { capMoney: 1, capTokens: 1, reasonCode: 'l1.pilot' });
    return { ceo: gov.getEmployee(e.id), deployments: [...out.deploymentIds], providerId: out.providerId };
  } finally {
    store.close();
  }
}

async function withWorld(label: string, chat: (request: DeepSeekRequest) => DeepSeekResponse, fn: (x: World) => Promise<void>, identity?: DeepSeekResponse): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const { ceo, deployments, providerId } = seedL1(root, w);
  const vault = new InMemorySecretVault().set('deepseek-company', KEY);
  const transport = transportWith(chat, identity);
  const adapter = new DeepSeekProviderAdapter({ vault, transport });
  const logs: LogRecord[] = [];
  const rt = runtimeFor(root, { processors: [employeeTaskProcessor], governance: { providers: [adapter], provisioningProfiles: [DEEPSEEK_V41_FLASH_PROFILE], modelCallTimeoutMs: 5_000 }, logger: new Logger((r) => logs.push(r)) });
  try {
    await rt.start();
    await fn({ root, w, ceo, transport, adapter, rt, logs, deployments, providerId });
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

const chatRequests = (t: FakeDeepSeekTransport) => t.requests.filter((r) => r.path === DEEPSEEK_CHAT_COMPLETIONS_PATH);
const state = (rt: CompanyRuntime, id: Id): string => rt.view.getWorkItem(id).state;
const settled = (rt: CompanyRuntime, id: Id): Promise<string> => eventually(() => (['COMPLETED', 'FAILED', 'WAITING', 'BLOCKED'].includes(state(rt, id)) ? state(rt, id) : undefined), 15_000, `work item ${id}`);

describe('L1 runtime: the Founder ↔ CEO path thinks through DeepSeek inside the governed Model Runtime', () => {
  test('Founder message → reply Work Item → C3 context → model.invoke → route (E1, LIMITED_PRODUCTION) → worst-case reservation → the adapter → truthful settlement → MESSAGE proposal → the thread; no bypass, no chain-of-thought, no credential anywhere durable', () =>
    withWorld('l1-reply', (request) => {
      const body = request.body as { thinking: unknown; messages: { role: string; content: string }[]; max_tokens: number; model: string };
      assert.deepEqual(body.thinking, { type: 'disabled' }, 'E1 → no thinking');
      assert.equal(body.model, 'deepseek-flash');
      assert.equal(body.max_tokens, 1_024, 'the Founder reply ceiling bounds max_tokens');
      assert.ok(body.messages[0]?.content.includes('"type":"MESSAGE"'), 'the stable prefix tells a real model how to answer the Founder');
      const prompt = body.messages.reduce((n, m) => n + m.content.length, 0);
      const answer = fakeChatAnswer(replyThenFinal(request), { prompt: Math.ceil(prompt / 4), completion: 60, hit: 16 });
      const choice = (answer.body as { choices: { message: Record<string, unknown> }[] }).choices[0];
      if (!choice) throw new Error('the fake answer has no choice');
      choice.message['reasoning_' + 'content'] = 'PRIVATE-COT-MARKER';
      return answer;
    }, async ({ rt, w, ceo, transport, logs, root, deployments }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      assert.equal(thread.employeeId, ceo.id);
      const sent = comm.send(w.founder, thread.id, { purpose: 'REQUEST', body: 'أنا محمد، Founder لـQANDEEL. قبل ما نبدأ الشغل عايزك تتعرف على المشروع وتسألني الأسئلة اللي محتاجها.' });
      assert.ok(sent.replyWorkItemId);
      await eventually(() => comm.messages(thread.id).some((m) => m.senderKind === 'EMPLOYEE'), 15_000, 'the CEO answers');
      assert.equal(await settled(rt, sent.replyWorkItemId as Id), 'COMPLETED');
      const reply = comm.messages(thread.id).find((m) => m.senderKind === 'EMPLOYEE');
      assert.equal(reply?.senderRef, ceo.ref);
      assert.ok(reply?.body.startsWith('أهلاً يا محمد'), 'the final content reached the canonical Founder surface');
      assert.deepEqual(transport.requests.map((r) => r.path), [DEEPSEEK_MODELS_PATH, DEEPSEEK_CHAT_COMPLETIONS_PATH, DEEPSEEK_CHAT_COMPLETIONS_PATH], 'identity check, the reply call, then the FINAL call');
      assert.ok(transport.requests.every((r) => r.bearerSha256 === sha(KEY)), 'the vault credential reached only the transport');
      const usage = rt.governance.usage({ workItemId: sent.replyWorkItemId as Id });
      assert.equal(usage.length, 2, 'two governed calls (the reply, then FINAL), each reserved and settled');
      const [u] = usage;
      assert.ok(u);
      assert.equal(u.deploymentId, deployments[0], 'the E1 deployment');
      assert.equal(u.cachedInputTokens, 16);
      assert.ok(u.billingBand === 'PEAK' || u.billingBand === 'OFF_PEAK', 'the settling clock decided the band');
      const card = rt.governance.priceCard(u.priceCardId as Id);
      const reserved = rt.governance.reservations(u.runId).find((r) => r.id === u.reservationId);
      assert.ok(reserved && reserved.state === 'SETTLED');
      assert.ok(u.economicMicros <= reserved.money, 'actual never exceeds the reservation');
      assert.equal(reserved.money, worstCase(card, reserved.tokens - 1_024, 1_024).economicMicros, 'the reservation is the peak, all-cache-miss worst case of the context bound + the output ceiling');
      assert.ok(u.billedMicros <= u.economicMicros, 'the truthful bill never exceeds the governed cost');
      assert.equal(rt.governance.accountingInvariants().length, 0);
      // Nothing durable holds the chain-of-thought marker or the credential: the database, the logs, the audit.
      await rt.stop();
      const db = readFileSync(path.join(root, 'state', 'company.sqlite3'));
      for (const needle of ['PRIVATE-COT-MARKER', KEY, 'reasoning_' + 'content']) assert.equal(db.includes(needle), false, `${needle.slice(0, 12)} is not in the database`);
      const logText = JSON.stringify(logs);
      for (const needle of ['PRIVATE-COT-MARKER', KEY, 'أهلاً']) assert.equal(logText.includes(needle), false, 'logs are content-free');
    }));

  test('authorization is checked before any network: a CEO without model.invoke sends nothing; a budget refusal parks the work before any network', () =>
    withWorld('l1-before-network', () => fakeChatAnswer(MESSAGE, { prompt: 10, completion: 10 }), async ({ rt, w, ceo, transport }) => {
      for (const g of rt.governance.grants(ceo.id).filter((x) => x.capability === 'model.invoke')) rt.governance.revokeGrant(w.founder, g.id, 'test');
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const denied = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'سؤال' });
      assert.equal(await settled(rt, denied.replyWorkItemId as Id), 'FAILED');
      assert.equal(transport.requests.length, 0, 'denied before the identity check and the call');
      rt.governance.grant(w.founder, { employeeId: ceo.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'test' });
      const tiny = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'سؤال آخر', replyCap: { money: 5, tokens: 5 } });
      assert.equal(await settled(rt, tiny.replyWorkItemId as Id), 'WAITING');
      assert.equal(rt.view.jobsFor(tiny.replyWorkItemId as Id).at(-1)?.waitReason, 'BUDGET_EXHAUSTED');
      assert.equal(transport.requests.length, 0, 'a budget refusal happens before any network');
    }));

  test('D3 and D4 work never reaches the external deployment (egress fails closed before cost); a D1 task on a class the profile routes goes through', () =>
    withWorld('l1-egress', () => fakeChatAnswer('{"type":"FINAL","summaryCode":"done"}', { prompt: 10, completion: 5 }), async ({ rt, w, ceo, transport }) => {
      const submit = (dataClass: string): Id => {
        const { workItem } = rt.submitWorkItem({ objective: 'l1 egress proof', ownerRef: ceo.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'founder.brief', dataClass, maxOutputTokens: 128, instructions: 'Summarize the week.' } });
        rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 100_000, capTokens: 100_000, reasonCode: 'test' });
        rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
        return workItem.id;
      };
      for (const cls of ['D3', 'D4']) {
        const id = submit(cls);
        assert.notEqual(await settled(rt, id), 'COMPLETED', `${cls} never completes through an external deployment`);
        assert.equal(chatRequests(transport).length, 0, `${cls} never reached DeepSeek`);
      }
      const ok = submit('D1');
      assert.equal(await settled(rt, ok), 'COMPLETED');
      assert.equal(chatRequests(transport).length, 1);
    }));

  test('alias drift fails closed: when the alias names another public model, the call is refused as MODEL_DEPRECATED, the deployment is held and no chat call is sent', () =>
    withWorld('l1-drift', () => fakeChatAnswer(MESSAGE, { prompt: 10, completion: 10 }), async ({ rt, w, transport, deployments }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const sent = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'سؤال' });
      assert.notEqual(await settled(rt, sent.replyWorkItemId as Id), 'COMPLETED');
      assert.equal(chatRequests(transport).length, 0, 'nothing was sent to an unqualified model');
      assert.ok(transport.requests.some((r) => r.path === DEEPSEEK_MODELS_PATH), 'the identity was checked');
      const held = deployments.map((id) => rt.governance.deployment(id)).filter((d) => d.status === 'HOLD');
      assert.ok(held.length >= 1 && held.every((d) => d.holdReason === 'MODEL_DEPRECATED'), 'the routed deployment is held for requalification');
    }, fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: 'DeepSeek-V5-Flash' }])));

  test('provider failures keep the C2 semantics: 401 is a provider hold with no retry; a 500 is retried once on the same (unbilled) deployment; a timeout after send is held, never retried', async () => {
    let mode: 'auth' | 'flaky' | 'hang' = 'auth';
    let flakyCalls = 0;
    await withWorld('l1-failures', (request) => {
      if (mode === 'auth') return { status: 401, body: { error: { message: 'Authentication Fails' } }, oversize: false, malformed: false };
      if (mode === 'flaky') return flakyCalls++ === 0 ? { status: 500, body: null, oversize: false, malformed: false } : fakeChatAnswer(replyThenFinal(request), { prompt: 10, completion: 10 });
      throw new ProviderError('TIMEOUT_AFTER_SEND');
    }, async ({ rt, w, transport, providerId }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const first = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'واحد' });
      assert.notEqual(await settled(rt, first.replyWorkItemId as Id), 'COMPLETED');
      assert.equal(chatRequests(transport).length, 1, '401: exactly one call, no retry loop');
      assert.equal(rt.governance.provider(providerId).status, 'HOLD', 'an auth failure is an operational hold');
      rt.governance.setHold(w.founder, { entity: 'provider', id: providerId }, false, 'test.release');
      mode = 'flaky';
      const second = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'اثنان' });
      assert.equal(await settled(rt, second.replyWorkItemId as Id), 'COMPLETED');
      assert.equal(chatRequests(transport).length, 4, '500, the retried reply, then FINAL: one bounded retry');
      const kinds = rt.governance.reservations(rt.view.runsForWorkItem(second.replyWorkItemId as Id)[0]?.id as Id).map((r) => r.attemptKind).sort();
      assert.deepEqual(kinds, ['PRIMARY', 'PRIMARY', 'RETRY'], 'the retry is a separate, attributed attempt (then the FINAL turn is its own PRIMARY)');
      mode = 'hang';
      const third = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'ثلاثة' });
      assert.notEqual(await settled(rt, third.replyWorkItemId as Id), 'COMPLETED');
      const held = rt.governance.reservations(rt.view.runsForWorkItem(third.replyWorkItemId as Id)[0]?.id as Id).filter((r) => r.state === 'RECONCILIATION_REQUIRED');
      assert.equal(held.length, 1, 'a possibly billed call keeps its reservation held for reconciliation');
    });
  });
});
