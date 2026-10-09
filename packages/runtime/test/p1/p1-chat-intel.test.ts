/**
 * P1-CHAT-INTEL-01 — the Founder ↔ Employee chat and DeepSeek V4.1 Flash reasoning control, proven through the REAL governed
 * runtime and the REAL DeepSeek adapter behind a deterministic fake transport (no network, no credential, no paid call). The
 * Company is provisioned exactly as the LIVE one was (the Academy profile: E1 / E2 only), then extended by the additive E3 / E4
 * conversation profile. Proves:
 *   - conversation history reaches the next reply through bounded governed context (never a later message), fast-chat bounds;
 *   - a per-message level is the reply's durable one-task override: E1..E4 reach Flash with the official thinking wire shape,
 *     the persistent profile and its certification state never change, and a level above the ceiling sends nothing;
 *   - the additive profile adds deployments and a route-policy version, never re-provisions, never touches a budget;
 *   - a repeated send is idempotent; a failed or budget-parked reply reports its real state and is never retried;
 *   - a trainee's conversation stays open for notes, never for an AI reply; history pages without loss.
 * P1-PROOF: chat-intel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';
import { DEEPSEEK_CHAT_COMPLETIONS_PATH, DEEPSEEK_MODELS_PATH, DEEPSEEK_MODEL_CODE, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DEEPSEEK_V41_FLASH_REASONING_PROFILE, DeepSeekProviderAdapter, FakeDeepSeekTransport, fakeChatAnswer, fakeModelsAnswer, type DeepSeekRequest, type DeepSeekResponse } from '@qandeel-company/model-providers';
import { InMemorySecretVault } from '@qandeel-company/secret-vault';
import { CHAT_REPLY_OUTPUT_TOKENS, CompanyStore, GovernanceStore, OrganizationStore, type EmployeeRecord } from '@qandeel-company/storage';
import { activateEmployeeForTest } from '@qandeel-company/storage/testing';

import { employeeTaskProcessor, type CompanyRuntime } from '../../src/index.js';
import { eventually, removeRoot, runtimeFor, tempRoot } from '../helpers.js';
import { nextName, seedWorld, type C2World } from '../c2/c2-seed.js';

const KEY = 'vault-proof-' + 'Pz3Kd8Qq2Vw5Zb1Nx9Ct7Lm4';
const reply = (body: string): string => JSON.stringify({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body, brief: null, contextRefs: [] });

interface Sent {
  readonly thinking: unknown;
  readonly effort: unknown;
  readonly maxTokens: number;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
}

interface World {
  readonly w: C2World;
  readonly ceo: EmployeeRecord;
  readonly transport: FakeDeepSeekTransport;
  readonly rt: CompanyRuntime;
  readonly sent: Sent[];
}

/** The LIVE shape: the Academy profile (E1 / E2) provisioned through the canonical catalog APIs; the CEO at E1 / E2. */
function seed(root: string, w: C2World): EmployeeRecord {
  const store = CompanyStore.open(root);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const seat = org.positionByCode('company.ceo');
    if (!seat) throw new Error('the CEO seat is release-seeded');
    const e = gov.createEmployee(w.founder, { name: nextName(), profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED', selection: 'DEFAULT' }, roleRef: seat.roleRef, positionRef: 'position:p1', departmentId: w.departmentId, managerRef: w.founder });
    gov.transitionEmployee(w.founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(w.founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, w.founder, e.id);
    gov.createBudget(w.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 2_000_000, capTokens: 2_000_000, reasonCode: 'seed' });
    gov.grant(w.founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'seed' });
    org.assignPrimary(w.founder, { positionId: seat.id, employeeId: e.id, reasonCode: 'placed' });
    gov.recordModelIdentityCheck({ providerCode: 'deepseek', modelCode: DEEPSEEK_MODEL_CODE, expectedName: 'DeepSeek-V4.1-Flash', observedName: 'DeepSeek-V4.1-Flash', result: 'MATCH' });
    gov.provisionProviderProfile(w.founder, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, { capMoney: 5_000_000, capTokens: 50_000_000, reasonCode: 'l1.activation' });
    return gov.getEmployee(e.id);
  } finally {
    store.close();
  }
}

async function withWorld(label: string, chat: (request: DeepSeekRequest, n: number) => DeepSeekResponse, fn: (x: World) => Promise<void>): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const ceo = seed(root, w);
  const sent: Sent[] = [];
  const transport = new FakeDeepSeekTransport().respondWith((request) => {
    if (request.path === DEEPSEEK_MODELS_PATH) return fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: 'DeepSeek-V4.1-Flash' }]);
    const body = request.body as { thinking: unknown; reasoning_effort?: unknown; max_tokens: number; messages: { role: string; content: string }[] };
    sent.push({ thinking: body.thinking, effort: body.reasoning_effort, maxTokens: body.max_tokens, messages: body.messages });
    return chat(request, sent.length);
  });
  const adapter = new DeepSeekProviderAdapter({ vault: new InMemorySecretVault().set('deepseek-company', KEY), transport });
  const rt = runtimeFor(root, { processors: [employeeTaskProcessor], governance: { providers: [adapter], provisioningProfiles: [DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DEEPSEEK_V41_FLASH_REASONING_PROFILE], modelCallTimeoutMs: 5_000 } });
  try {
    await rt.start();
    await fn({ w, ceo, transport, rt, sent });
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

const answer = (body: string) => (): DeepSeekResponse => fakeChatAnswer(reply(body), { prompt: 200, completion: 40 });
const chatCalls = (t: FakeDeepSeekTransport): number => t.requests.filter((r) => r.path === DEEPSEEK_CHAT_COMPLETIONS_PATH).length;
const state = (rt: CompanyRuntime, id: Id): string => rt.view.getWorkItem(id).state;
const settled = (rt: CompanyRuntime, id: Id): Promise<string> => eventually(() => (['COMPLETED', 'FAILED', 'WAITING', 'BLOCKED'].includes(state(rt, id)) ? state(rt, id) : undefined), 15_000, `work item ${id}`);
const refusal = (fn: () => unknown): Record<string, unknown> => {
  try {
    fn();
  } catch (e) {
    return { code: (e as { code?: unknown }).code, ...((e as { details?: Record<string, unknown> }).details ?? {}) };
  }
  throw new Error('expected a refusal');
};

describe('P1-CHAT-INTEL-01: persistent chat with bounded history and fast default replies', () => {
  test('the second reply sees the earlier turns (oldest first, before the message it answers); the first never saw a later one; E1 fast bounds', () =>
    withWorld('p1-history', (_r, n) => fakeChatAnswer(reply(n === 1 ? 'أهلاً، فهمت المطلوب.' : 'Yes — the retention report first.'), { prompt: 300, completion: 30 }), async ({ rt, w, sent, transport }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const first = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'FIRST-TURN: ما أولوياتك هذا الأسبوع؟' });
      assert.equal(await settled(rt, first.replyWorkItemId as Id), 'COMPLETED');
      const second = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'SECOND-TURN: and which one comes first?' });
      assert.equal(await settled(rt, second.replyWorkItemId as Id), 'COMPLETED');
      assert.equal(chatCalls(transport), 2, 'one model call per reply: no loop, no tool step for an ordinary text reply');
      const [a, b] = sent;
      assert.ok(a && b);
      assert.equal(a.messages.some((m) => m.content.includes('SECOND-TURN')), false, 'a reply never sees a message sent after the one it answers');
      assert.equal(a.messages.some((m) => m.content.includes('Earlier messages in this conversation')), false, 'the first turn has no history');
      const users = b.messages.filter((m) => m.role === 'user').map((m) => m.content);
      const historyAt = users.findIndex((c) => c.includes('Earlier messages in this conversation'));
      const askAt = users.findIndex((c) => c.startsWith('Founder message (QUESTION): SECOND-TURN'));
      assert.ok(historyAt >= 0 && askAt > historyAt, 'the earlier turns come before the message to answer');
      const history = users[historyAt] ?? '';
      assert.ok(history.includes('FIRST-TURN') && history.includes('أهلاً، فهمت المطلوب.'), 'both the Founder turn and the Employee reply are in the history');
      assert.ok(history.indexOf('FIRST-TURN') < history.indexOf('أهلاً'), 'oldest first');
      assert.equal(history.includes('SECOND-TURN'), false, 'the message being answered is not duplicated into the history');
      // Fast default: E1, thinking off, the E1 output bound; the persistent profile untouched.
      for (const s of sent) {
        assert.deepEqual(s.thinking, { type: 'disabled' });
        assert.equal(s.effort, undefined);
        assert.equal(s.maxTokens, CHAT_REPLY_OUTPUT_TOKENS.E1);
      }
      const states = comm.replyStates(thread.id);
      assert.deepEqual(states.map((s) => [s.status, s.requestedClass, s.answeredClasses]), [['REPLIED', null, ['E1']], ['REPLIED', null, ['E1']]]);
      assert.ok(states.every((s) => s.calls === 1 && s.spentMoney > 0 && s.spentMoney <= s.capMoney && s.reservedMoney === 0), 'spending is distinguishable from the cap and from what is held');
      // The history in the context manifest is content-free: the thread id, a count and a hash.
      const page = comm.messagesPage(thread.id, { limit: 2 });
      assert.deepEqual(page.messages.map((m) => m.seq), [3, 4]);
      assert.equal(page.hasOlder, true);
      const older = comm.messagesPage(thread.id, { beforeSeq: 3, limit: 2 });
      assert.deepEqual(older.messages.map((m) => m.seq), [1, 2]);
      assert.equal(older.hasOlder, false, 'every message is reachable; nothing is lost');
    }));

  test('a repeated send with the same client key returns the recorded message: one message, one reply, one model call', () =>
    withWorld('p1-idempotent', answer('Noted.'), async ({ rt, w, transport }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const a = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Once only?', clientKey: 'client-key-0001' });
      const b = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Once only?', clientKey: 'client-key-0001' });
      assert.equal(b.replayed, true);
      assert.equal(b.message.id, a.message.id);
      assert.equal(b.replyWorkItemId, a.replyWorkItemId);
      assert.equal(await settled(rt, a.replyWorkItemId as Id), 'COMPLETED');
      assert.equal(comm.messages(thread.id).filter((m) => m.senderKind === 'FOUNDER').length, 1);
      assert.equal(comm.messages(thread.id).filter((m) => m.senderKind === 'EMPLOYEE').length, 1, 'no duplicate response');
      assert.equal(chatCalls(transport), 1);
      // A retry after the reply ENDED (a response lost long ago) still replays the same message and starts nothing.
      const late = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Once only?', clientKey: 'client-key-0001' });
      assert.deepEqual([late.replayed, late.message.id, late.replyWorkItemId], [true, a.message.id, a.replyWorkItemId]);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(chatCalls(transport), 1, 'a replay never starts another run');
      assert.equal(comm.messages(thread.id).length, 2);
      assert.equal(refusal(() => comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'x', clientKey: 'bad key!' })).code, 'VALIDATION_FAILED');
    }));

  test('CORR-01: a note (no reply) is idempotent by its own key: one note, no Work Item, no reservation, no call', () =>
    withWorld('p1-idem-note', answer('never'), async ({ rt, w, transport }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const items = rt.view.listWorkItems({ limit: 1000 }).length;
      const a = comm.send(w.founder, thread.id, { purpose: 'FYI', body: 'For the record.', responseRequired: false, clientKey: 'note-key-0001' });
      const b = comm.send(w.founder, thread.id, { purpose: 'FYI', body: 'For the record.', responseRequired: false, clientKey: 'note-key-0001' });
      assert.deepEqual([a.replayed ?? false, b.replayed, b.message.id, b.replyWorkItemId], [false, true, a.message.id, null]);
      assert.equal(comm.messages(thread.id).length, 1, 'one note, never a duplicate');
      assert.equal(rt.view.listWorkItems({ limit: 1000 }).length, items, 'a note creates no Work Item (so no budget reservation)');
      assert.equal(chatCalls(transport), 0);
    }));

  test('CORR-01: the same key with a different request is IDEMPOTENCY_CONFLICT, records nothing, and never returns another message', () =>
    withWorld('p1-idem-conflict', answer('Noted.'), async ({ rt, w }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const a = comm.send(w.founder, thread.id, { purpose: 'FYI', body: 'Original.', responseRequired: false, clientKey: 'conflict-key-01' });
      const items = rt.view.listWorkItems({ limit: 1000 }).length;
      for (const changed of [
        { purpose: 'FYI', body: 'Edited.', responseRequired: false },
        { purpose: 'QUESTION', body: 'Original.', responseRequired: true },
        { purpose: 'FYI', body: 'Original.', responseRequired: false, attentionLevel: 'NEEDS_ATTENTION' },
      ] as const) {
        const r = refusal(() => comm.send(w.founder, thread.id, { ...changed, clientKey: 'conflict-key-01' }));
        assert.deepEqual([r.code, r.reason], ['IDEMPOTENCY_CONFLICT', 'CLIENT_KEY_REUSED'], JSON.stringify(changed));
        assert.equal(JSON.stringify(r).includes(a.message.id), false, 'the conflict names no message');
      }
      // A level differs too: the ASK with E1 replays only an ASK with E1.
      const q = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Level?', reasoningClass: 'E1', clientKey: 'conflict-key-02' });
      assert.equal(refusal(() => comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Level?', reasoningClass: 'E2', clientKey: 'conflict-key-02' })).code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Level?', reasoningClass: 'E1', clientKey: 'conflict-key-02' }).message.id, q.message.id);
      assert.equal(comm.messages(thread.id).filter((m) => m.senderKind === 'FOUNDER').length, 2, 'no conflicting send was recorded');
      assert.equal(rt.view.listWorkItems({ limit: 1000 }).length, items + 1, 'only the one question made a reply');
    }));

  test('CORR-01: a key is never shared across conversations: reusing it in another Employee\'s thread is a conflict, never their message', () =>
    withWorld('p1-idem-threads', answer('never'), async ({ rt, w }) => {
      const gov = rt.governance;
      const other = gov.createEmployee(w.founder, { name: nextName(), profile: { personality: 'curious' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: 'role:content-strategist', positionRef: 'position:p3', departmentId: w.departmentId, managerRef: w.founder });
      const comm = rt.founder.communications;
      const ceoThread = comm.directThread(w.founder, null);
      const otherThread = comm.directThread(w.founder, other.id);
      const a = comm.send(w.founder, ceoThread.id, { purpose: 'FYI', body: 'Same words.', responseRequired: false, clientKey: 'shared-key-0001' });
      const r = refusal(() => comm.send(w.founder, otherThread.id, { purpose: 'FYI', body: 'Same words.', responseRequired: false, clientKey: 'shared-key-0001' }));
      assert.equal(r.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(JSON.stringify(r).includes(a.message.id), false);
      assert.deepEqual([comm.messages(otherThread.id).length, comm.messages(ceoThread.id).length], [0, 1], 'nothing crossed between conversations');
      // Distinct keys in two conversations are independent.
      assert.equal(comm.send(w.founder, otherThread.id, { purpose: 'FYI', body: 'Same words.', responseRequired: false, clientKey: 'shared-key-0002' }).message.threadId, otherThread.id);
    }));
});

describe('P1-CHAT-INTEL-01: per-message reasoning on DeepSeek V4.1 Flash (E1..E4)', () => {
  test('E2 for one message: thinking low on the wire, a durable one-task override, the next message back at the default, the profile and certifications unchanged', () =>
    withWorld('p1-level-e2', answer('Considered answer.'), async ({ rt, w, ceo, sent }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const before = rt.governance.getEmployee(ceo.id);
      const deep = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Think a little about this.', reasoningClass: 'E2' });
      assert.equal(await settled(rt, deep.replyWorkItemId as Id), 'COMPLETED');
      const plain = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'And quickly this.' });
      assert.equal(await settled(rt, plain.replyWorkItemId as Id), 'COMPLETED');
      assert.deepEqual([sent[0]?.thinking, sent[0]?.effort, sent[0]?.maxTokens], [{ type: 'enabled' }, 'low', CHAT_REPLY_OUTPUT_TOKENS.E2]);
      assert.deepEqual([sent[1]?.thinking, sent[1]?.effort, sent[1]?.maxTokens], [{ type: 'disabled' }, undefined, CHAT_REPLY_OUTPUT_TOKENS.E1], 'the level applied to one message only');
      const after = rt.governance.getEmployee(ceo.id);
      assert.deepEqual([after.cognitiveProfile.defaultClass, after.cognitiveProfile.ceilingClass, after.version], [before.cognitiveProfile.defaultClass, before.cognitiveProfile.ceilingClass, before.version], 'the persistent profile never changed');
      const view = rt.governance.reasoningControl(ceo.id);
      assert.deepEqual(view.overrides.map((o) => [o.workItemId, o.reasoningClass]), [[deep.replyWorkItemId, 'E2']], 'the per-message level is the durable override of that reply');
      assert.deepEqual(comm.replyStates(thread.id).map((s) => [s.requestedClass, s.answeredClasses]), [['E2', ['E2']], [null, ['E1']]]);
    }));

  test('a level above the Employee maximum is refused before anything exists: no message, no reply, no run, no provider call', () =>
    withWorld('p1-level-ceiling', answer('never'), async ({ rt, w, transport }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const items = rt.view.listWorkItems({ limit: 1000 }).length;
      const r = refusal(() => comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Use E3 please.', reasoningClass: 'E3' }));
      assert.equal(r.reason, 'ABOVE_EMPLOYEE_CEILING');
      assert.equal(refusal(() => comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'E0?', reasoningClass: 'E0' })).reason, 'REASONING_CLASS');
      assert.equal(comm.messages(thread.id).length, 0);
      assert.equal(rt.view.listWorkItems({ limit: 1000 }).length, items);
      await new Promise((r2) => setTimeout(r2, 200));
      assert.equal(chatCalls(transport), 0);
      const intel = rt.governance.employeeIntelligence(rt.governance.getEmployee(thread.employeeId).id);
      assert.deepEqual(intel.levels.map((l) => [l.reasoningClass, l.availability]), [['E1', 'AVAILABLE'], ['E2', 'AVAILABLE'], ['E3', 'ABOVE_EMPLOYEE_CEILING'], ['E4', 'ABOVE_EMPLOYEE_CEILING']]);
      assert.equal(intel.model?.publicName, 'DeepSeek-V4.1-Flash');
    }));

  test('E3 / E4 on the LIVE shape: the additive profile adds two Flash deployments and the conversation route v2 (E4) without re-provisioning; with a raised maximum E3 → thinking high, E4 → thinking max', () =>
    withWorld('p1-level-e3e4', answer('Deep answer.'), async ({ rt, w, ceo, sent }) => {
      const gov = rt.governance;
      const company = gov.budgetFor('COMPANY', 'company');
      const deploymentsBefore = gov.routingSnapshot('academy.attempt').deployments.map((d) => [d.code, d.status, d.qualification]);
      // Before: the LIVE route stops at E2 and only E1 / E2 exist.
      assert.equal(gov.routingSnapshot('founder.reply').policy?.maxClass, 'E2');
      assert.equal(refusal(() => gov.provisionProviderProfile(w.founder, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, { capMoney: 1, capTokens: 1, reasonCode: 'again' })).code, 'INVALID_TRANSITION', 'a provisioned provider is never re-provisioned');
      const out = gov.provisionProviderProfile(w.founder, DEEPSEEK_V41_FLASH_REASONING_PROFILE, { capMoney: 0, capTokens: 0, reasonCode: 'p1.chat_levels' });
      assert.equal(out.deploymentIds.length, 2);
      assert.equal(gov.hasDeployments(['deepseek-flash-e3-chat', 'deepseek-flash-e4-chat']), true);
      assert.equal(refusal(() => gov.provisionProviderProfile(w.founder, DEEPSEEK_V41_FLASH_REASONING_PROFILE, { capMoney: 0, capTokens: 0, reasonCode: 'again' })).reason, 'ALREADY_PROVISIONED', 'additive deployments are registered once');
      const route = gov.routingSnapshot('founder.reply');
      assert.equal(route.policy?.maxClass, 'E4');
      assert.equal(route.policy?.version, 2, 'a new route-policy version; v1 is superseded history');
      const codesBefore = new Set(deploymentsBefore.map(([code]) => code));
      assert.deepEqual(gov.routingSnapshot('academy.attempt').deployments.filter((d) => codesBefore.has(d.code)).map((d) => [d.code, d.status, d.qualification]), deploymentsBefore, 'existing deployments untouched');
      assert.deepEqual(gov.routingSnapshot('founder.reply').deployments.filter((d) => !codesBefore.has(d.code)).map((d) => [d.code, d.reasoningClass, d.taskClasses]).sort(), [['deepseek-flash-e3-chat', 'E3', ['founder.reply']], ['deepseek-flash-e4-chat', 'E4', ['founder.reply']]], 'only the two conversation deployments were added');
      assert.equal(gov.routingSnapshot('academy.attempt').policy?.maxClass, 'E2', 'other routes untouched');
      const companyAfter = gov.budgetFor('COMPANY', 'company');
      assert.deepEqual([companyAfter?.id, companyAfter?.capMoney], [company?.id, company?.capMoney], 'no budget was created or changed');
      // Still above Salim-like maximum E2: available only after the governed profile change (REVIEW_DUE semantics there).
      assert.equal(gov.employeeIntelligence(ceo.id).levels.find((l) => l.reasoningClass === 'E3')?.availability, 'ABOVE_EMPLOYEE_CEILING');
      const e = gov.getEmployee(ceo.id);
      gov.changeReasoningProfile(w.founder, e.id, { defaultClass: 'E1', ceilingClass: 'E4', expectedVersion: e.version, reasonCode: 'founder.reasoning_profile' });
      assert.deepEqual(gov.employeeIntelligence(ceo.id).levels.map((l) => l.availability), ['AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE']);
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const e3 = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Think hard.', reasoningClass: 'E3' });
      assert.equal(await settled(rt, e3.replyWorkItemId as Id), 'COMPLETED');
      const e4 = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Think as hard as you can.', reasoningClass: 'E4' });
      assert.equal(await settled(rt, e4.replyWorkItemId as Id), 'COMPLETED');
      const e1 = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Quick one.' });
      assert.equal(await settled(rt, e1.replyWorkItemId as Id), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.thinking, s.effort, s.maxTokens]), [
        [{ type: 'enabled' }, 'high', CHAT_REPLY_OUTPUT_TOKENS.E3],
        [{ type: 'enabled' }, 'max', CHAT_REPLY_OUTPUT_TOKENS.E4],
        [{ type: 'disabled' }, undefined, CHAT_REPLY_OUTPUT_TOKENS.E1],
      ], 'each level reaches DeepSeek V4.1 Flash with its own thinking; the default stays fast');
      assert.deepEqual(comm.replyStates(thread.id).map((s) => s.answeredClasses), [['E3'], ['E4'], ['E1']]);
      assert.equal(gov.employeeIntelligence(ceo.id).usage.map((u) => u.reasoningClass).join(','), 'E1,E3,E4');
      assert.equal(gov.accountingInvariants().length, 0);
    }));
});

describe('P1-CHAT-INTEL-01: the governed paths (preview → fingerprint → confirm)', () => {
  test('the additive E3 / E4 profile is previewed without a cap (the existing Company cap stays), confirmed in one act, and never offered twice; a persistent maximum change is its own preview', () =>
    withWorld('p1-governed', answer('ok'), async ({ rt, ceo }) => {
      const auth = rt.founder.auth;
      const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
      const actions = rt.founder.actions;
      const summary = actions.provisioningProfiles().find((p) => p.code === DEEPSEEK_V41_FLASH_REASONING_PROFILE.code);
      assert.deepEqual([summary?.extendsProvider, summary?.reasoningClasses, summary?.deploymentCodes], [true, ['E3', 'E4'], ['deepseek-flash-e3-chat', 'deepseek-flash-e4-chat']]);
      const cap = rt.governance.budgetFor('COMPANY', 'company')?.capMoney;
      const p = actions.preview(session, 'PROVIDER_PROVISION', { profileCode: summary?.code, profileSha256: summary?.sha256 });
      const pl = p.payload as Record<string, unknown>;
      assert.deepEqual([pl.extendsProvider, pl.capMoney, pl.companyBudgetExists, pl.existingCapMoney, pl.routePolicies], [true, 0, true, cap, ['founder.reply E1..E4']], 'what is added, and that the cap stays');
      assert.equal(rt.governance.hasDeployments(['deepseek-flash-e3-chat']), false, 'a preview changes nothing');
      assert.match(actions.confirm(session, p.id, p.fingerprint).resultRef, /^provider:/);
      assert.equal(rt.governance.hasDeployments(['deepseek-flash-e3-chat', 'deepseek-flash-e4-chat']), true);
      assert.equal(rt.governance.budgetFor('COMPANY', 'company')?.capMoney, cap);
      assert.equal(refusal(() => actions.preview(session, 'PROVIDER_PROVISION', { profileCode: summary?.code, profileSha256: summary?.sha256 })).reason, 'ALREADY_PROVISIONED');
      // The persistent maximum is the EMPLOYEE_REASONING_PROFILE preview (certifications named as REVIEW_DUE there).
      const before = rt.governance.getEmployee(ceo.id);
      const rp = actions.preview(session, 'EMPLOYEE_REASONING_PROFILE', { employeeId: ceo.id, defaultClass: 'E1', ceilingClass: 'E4' });
      const rpl = rp.payload as Record<string, unknown>;
      assert.deepEqual([rpl.previousCeiling, rpl.newCeiling, rpl.authorityChange, rpl.budgetChange, rpl.providerCall], ['E2', 'E4', 'NONE', 'NONE', 'NONE']);
      assert.equal(rt.governance.getEmployee(ceo.id).version, before.version, 'nothing changes until the confirmation');
      actions.confirm(session, rp.id, rp.fingerprint);
      assert.equal(rt.governance.getEmployee(ceo.id).cognitiveProfile.ceilingClass, 'E4');
      assert.deepEqual(rt.governance.employeeIntelligence(ceo.id).levels.map((l) => l.availability), ['AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE']);
    }));
});

describe('P1-CHAT-INTEL-01: truthful reply states, no silent retry', () => {
  test('an unusable model output ends the reply FAILED with its code (never "writing"), and nothing retries it', () =>
    withWorld('p1-failed', () => fakeChatAnswer('not json at all', { prompt: 50, completion: 5 }), async ({ rt, w, transport }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const sent = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Will this fail?', clientKey: 'failed-key-0001' });
      assert.equal(await settled(rt, sent.replyWorkItemId as Id), 'FAILED');
      // CORR-01: a retry of the same send after its reply FAILED replays the message; it never re-asks.
      const again = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Will this fail?', clientKey: 'failed-key-0001' });
      assert.deepEqual([again.replayed, again.message.id, again.replyWorkItemId], [true, sent.message.id, sent.replyWorkItemId]);
      const calls = chatCalls(transport);
      assert.ok(calls >= 1 && calls <= 3, 'bounded by the reply\'s own call limit');
      const [s] = comm.replyStates(thread.id);
      assert.deepEqual([s?.status, s?.reasonCode, s?.replyMessageId], ['FAILED', 'MODEL_OUTPUT_INVALID', null]);
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(chatCalls(transport), calls, 'a failed reply is never retried automatically');
      assert.equal(comm.replyStates(thread.id)[0]?.status, 'FAILED');
    }));

  test('a reply without budget headroom waits for budget before any network, and says so', () =>
    withWorld('p1-budget', answer('never'), async ({ rt, w, transport }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const sent = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Tiny cap.', replyCap: { money: 5, tokens: 5 } });
      assert.equal(await settled(rt, sent.replyWorkItemId as Id), 'WAITING');
      const [s] = comm.replyStates(thread.id);
      assert.deepEqual([s?.status, s?.reasonCode, s?.spentMoney, s?.capMoney], ['WAITING_FOR_BUDGET', 'BUDGET_EXHAUSTED', 0, 5]);
      assert.equal(chatCalls(transport), 0);
    }));

  test('a trainee\'s conversation opens and keeps notes, but never starts an AI reply or spends', () =>
    withWorld('p1-trainee', answer('never'), async ({ rt, w, transport }) => {
      const gov = rt.governance;
      const t = gov.createEmployee(w.founder, { name: nextName(), profile: { personality: 'curious' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: 'role:content-strategist', positionRef: 'position:p2', departmentId: w.departmentId, managerRef: w.founder });
      gov.transitionEmployee(w.founder, t.id, { to: 'TRAINING', reasonCode: 'onboarding' });
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, t.id);
      const note = comm.send(w.founder, thread.id, { purpose: 'FYI', body: 'Welcome to the Academy.', responseRequired: false });
      assert.equal(note.replyWorkItemId, null);
      assert.equal(refusal(() => comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Answer me?' })).code, 'EMPLOYEE_NOT_ELIGIBLE');
      assert.deepEqual(comm.messages(thread.id).map((m) => m.body), ['Welcome to the Academy.']);
      assert.equal(comm.directThread(w.founder, t.id).id, thread.id, 'reopening Talk returns the same conversation');
      assert.equal(chatCalls(transport), 0);
      assert.equal(gov.getEmployee(t.id).state, 'TRAINING', 'a conversation grants nothing and moves no lifecycle');
    }));
});
