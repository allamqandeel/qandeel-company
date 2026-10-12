/**
 * P1-REASON-AUTO-RECOVERY-01 — reliable replies and company-wide Adaptive Intelligence, proven through the REAL governed
 * runtime and the REAL DeepSeek adapter behind a deterministic fake transport (no network, no credential, no paid call).
 * The Company is provisioned as the LIVE one (the Academy profile, E1 / E2), optionally extended by the additive E3 / E4
 * conversation profile. Proves:
 *   - B1: an escalated call gets the allowance of the class it routes at, and its worst case is reserved for that allowance;
 *   - B2: `finish_reason=length` is never a reply (one bounded same-class continuation, then MODEL_OUTPUT_TRUNCATED); a
 *     MALFORMED message records its closed sub-reason; every call leaves one content-free observation;
 *   - B3: an open circuit is a durable timed wait (no attempt spent, no brief, survives a restart), then the reply lands;
 *   - C1–C4: AUTO starts at the sufficient class within the AUTO maximum (E1 for routine, E2 for analysis and strategy:
 *     P1-AUTO-E12-01, D-P1-11), a Founder level is pinned (never raised), an Academy method pin is never overridden,
 *     missing E3 / E4 are never used, the budget still parks the work before any call;
 *   - P1-AUTO-E12-01: no AUTO call reaches E3 / E4 by selection, escalation, route-minimum lift, retry, continuation,
 *     fallback or a resumed checkpoint; one bounded E2 repair; truthful limits; MANUAL, pinned and DEFAULT unchanged.
 * P1-PROOF: reason-auto-recovery
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Clock, Id } from '@qandeel-company/domain';
import { worstCase, type ReasoningClass } from '@qandeel-company/governance';
import { DEEPSEEK_MODELS_PATH, DEEPSEEK_MODEL_CODE, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DEEPSEEK_V41_FLASH_REASONING_PROFILE, DeepSeekProviderAdapter, FakeDeepSeekTransport, fakeChatAnswer, fakeModelsAnswer, type DeepSeekRequest, type DeepSeekResponse } from '@qandeel-company/model-providers';
import { InMemorySecretVault } from '@qandeel-company/secret-vault';
import { CHAT_REPLY_OUTPUT_TOKENS, CompanyStore, GovernanceStore, OrganizationStore, type EmployeeRecord } from '@qandeel-company/storage';
import { activateEmployeeForTest } from '@qandeel-company/storage/testing';

import { modelCallTimeoutMs } from '../../src/c2/model-runtime.js';
import { employeeTaskProcessor, type CompanyRuntime, type GovernedProcessor } from '../../src/index.js';
import { eventually, removeRoot, runtimeFor, tempRoot } from '../helpers.js';
import { nextName, seedWorld, type C2World } from '../c2/c2-seed.js';

const KEY = 'vault-proof-' + 'Rk7Tq2Wm9Xz4Lb6Nc1Pv8Hs3';
const message = (body: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body, brief: null, contextRefs: [], ...extra });
const ok = (body = 'Done.'): DeepSeekResponse => fakeChatAnswer(message(body), { prompt: 300, completion: 30 });
const PARTIAL = '{"type":"MESSAGE","purpose":"RESULT","attentionLevel":"INFORMATIONAL","body":"The plan has three par';
/** An answer the provider cut at the allowance: the visible text is incomplete; thinking took most of the tokens. */
function truncated(maxTokens: number): DeepSeekResponse {
  return fakeChatAnswer(PARTIAL, { prompt: 300, completion: maxTokens }, {
    choices: [{ index: 0, message: { role: 'assistant', content: PARTIAL }, finish_reason: 'length' }],
    usage: { prompt_tokens: 300, completion_tokens: maxTokens, total_tokens: 300 + maxTokens, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 300, completion_tokens_details: { reasoning_tokens: maxTokens - 40 } },
  });
}
const transient = (): DeepSeekResponse => ({ status: 500, oversize: false, malformed: false, body: { error: { message: 'busy' } } });

/** The wall clock plus an offset the test moves forward (a circuit window passes without real waiting). */
class OffsetClock implements Clock {
  offset = 0;
  nowMs(): number {
    return Date.now() + this.offset;
  }
}

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
  readonly root: string;
  readonly clock: OffsetClock;
  restart(): Promise<CompanyRuntime>;
}
interface Options {
  /** Omitted = the creation default (AUTO for a newly created Employee). */
  readonly selection?: 'AUTO' | 'DEFAULT';
  readonly ceiling?: ReasoningClass;
  readonly reasoningProfile?: boolean;
  readonly envelopeMoney?: number;
  /** The runtime's base model-call timeout (default 5 s); a larger allowance scales it (D-P1-09). */
  readonly callTimeoutMs?: number;
  /** P1-AUTO-E12-01: the employee-task processor, or a proof wrapper around it (default: the real one). */
  readonly processor?: GovernedProcessor;
}

function seed(root: string, w: C2World, o: Options): EmployeeRecord {
  const store = CompanyStore.open(root);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const seat = org.positionByCode('company.ceo');
    if (!seat) throw new Error('the CEO seat is release-seeded');
    const cognitiveProfile = { defaultClass: 'E1' as const, ceilingClass: o.ceiling ?? 'E2', costDiscipline: 'BALANCED' as const, ...(o.selection ? { selection: o.selection } : {}) };
    const e = gov.createEmployee(w.founder, { name: nextName(), profile: { personality: 'steady' }, cognitiveProfile, roleRef: seat.roleRef, positionRef: 'position:p1', departmentId: w.departmentId, managerRef: w.founder });
    gov.transitionEmployee(w.founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(w.founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, w.founder, e.id);
    gov.createBudget(w.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: o.envelopeMoney ?? 2_000_000, capTokens: 2_000_000, reasonCode: 'seed' });
    gov.grant(w.founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'seed' });
    org.assignPrimary(w.founder, { positionId: seat.id, employeeId: e.id, reasonCode: 'placed' });
    gov.recordModelIdentityCheck({ providerCode: 'deepseek', modelCode: DEEPSEEK_MODEL_CODE, expectedName: 'DeepSeek-V4.1-Flash', observedName: 'DeepSeek-V4.1-Flash', result: 'MATCH' });
    gov.provisionProviderProfile(w.founder, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, { capMoney: 5_000_000, capTokens: 50_000_000, reasonCode: 'l1.activation' });
    if (o.reasoningProfile) gov.provisionProviderProfile(w.founder, DEEPSEEK_V41_FLASH_REASONING_PROFILE, { capMoney: 0, capTokens: 0, reasonCode: 'p1.chat_levels' });
    return gov.getEmployee(e.id);
  } finally {
    store.close();
  }
}

/** A provider answer, possibly one that arrives later (a slow call) or never (a call that outlives its timeout). */
type Chat = (request: DeepSeekRequest, n: number, maxTokens: number) => DeepSeekResponse | Promise<DeepSeekResponse>;

async function withWorld(label: string, o: Options, chat: Chat, fn: (x: World) => Promise<void>): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const ceo = seed(root, w, o);
  const sent: Sent[] = [];
  const clock = new OffsetClock();
  const transport = new FakeDeepSeekTransport().respondWith((request) => {
    if (request.path === DEEPSEEK_MODELS_PATH) return fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: 'DeepSeek-V4.1-Flash' }]);
    const body = request.body as { thinking: unknown; reasoning_effort?: unknown; max_tokens: number };
    sent.push({ thinking: body.thinking, effort: body.reasoning_effort, maxTokens: body.max_tokens });
    // The fake transport awaits what it is given, so a delayed answer is a slow provider call.
    return chat(request, sent.length, body.max_tokens) as DeepSeekResponse;
  });
  const make = (): CompanyRuntime => {
    const adapter = new DeepSeekProviderAdapter({ vault: new InMemorySecretVault().set('deepseek-company', KEY), transport, now: () => clock.nowMs() });
    return runtimeFor(root, { clock, processors: [o.processor ?? employeeTaskProcessor], governance: { providers: [adapter], provisioningProfiles: [DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DEEPSEEK_V41_FLASH_REASONING_PROFILE], modelCallTimeoutMs: o.callTimeoutMs ?? 5_000 } });
  };
  let rt = make();
  try {
    await rt.start();
    const restart = async (): Promise<CompanyRuntime> => {
      await rt.stop();
      rt = make();
      await rt.start();
      return rt;
    };
    await fn({ w, ceo, rt, sent, root, clock, restart });
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

const state = (rt: CompanyRuntime, id: Id): string => rt.view.getWorkItem(id).state;
const settled = (rt: CompanyRuntime, id: Id, within = 15_000): Promise<string> => eventually(() => (['COMPLETED', 'FAILED', 'WAITING', 'BLOCKED'].includes(state(rt, id)) ? state(rt, id) : undefined), within, `work item ${id}`);
const audits = (rt: CompanyRuntime, id: Id, action: string): Record<string, unknown>[] => rt.view.runsForWorkItem(id).flatMap((r) => rt.view.audit(r.id)).filter((a) => a.action === action).map((a) => ({ reason: a.reasonCode, ...a.details }));
/** The reasoning class of every model-call reservation of a Work Item, in order (the class of the deployment reserved). */
const reservedClasses = (rt: CompanyRuntime, id: Id): string[] => rt.view.runsForWorkItem(id).flatMap((r) => rt.governance.reservations(r.id)).filter((r) => r.purpose === 'MODEL_CALL').map((r) => rt.governance.deployment(r.deploymentId as Id).reasoningClass);
const ask = (rt: CompanyRuntime, w: C2World, body: string, reasoningClass?: ReasoningClass): Id => {
  const comm = rt.founder.communications;
  const thread = comm.directThread(w.founder, null);
  const sent = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body, ...(reasoningClass ? { reasoningClass } : {}) });
  return sent.replyWorkItemId as Id;
};
const replyState = (rt: CompanyRuntime, w: C2World, id: Id): ReturnType<CompanyRuntime['founder']['communications']['replyStates']>[number] => {
  const comm = rt.founder.communications;
  const s = comm.replyStates(comm.directThread(w.founder, null).id).find((r) => r.replyWorkItemId === id);
  assert.ok(s, 'the reply state of the message');
  return s;
};

describe('P1-REASON-AUTO-RECOVERY-01 B: reliable replies', () => {
  test('1 · a Default E1 → E2 escalation recomputes the allowance (2,048 → 4,096) and reserves the worst case of the allowance it actually has', () =>
    withWorld('p1r-escalate', { selection: 'DEFAULT' }, (_r, n) => (n === 1 ? fakeChatAnswer(message('x', { note: 'extra field' }), { prompt: 300, completion: 60 }) : ok('Two departments first.')), async ({ rt, w, sent }) => {
      const id = ask(rt, w, 'How should we start?');
      assert.equal(await settled(rt, id), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.thinking, s.effort, s.maxTokens]), [[{ type: 'disabled' }, undefined, CHAT_REPLY_OUTPUT_TOKENS.E1], [{ type: 'enabled' }, 'low', CHAT_REPLY_OUTPUT_TOKENS.E2]], 'the escalated E2 call no longer inherits the E1 allowance');
      const run = rt.view.runsForWorkItem(id).at(-1);
      assert.ok(run);
      const reservations = rt.governance.reservations(run.id);
      assert.deepEqual(reservations.map((r) => r.attemptKind), ['PRIMARY', 'ESCALATION']);
      for (const [r, cap] of reservations.map((x, i) => [x, [CHAT_REPLY_OUTPUT_TOKENS.E1, CHAT_REPLY_OUTPUT_TOKENS.E2][i] ?? 0] as const)) {
        const card = rt.governance.priceCard(r.priceCardId as Id);
        assert.equal(r.money, worstCase(card, r.tokens - cap, cap).economicMicros, `the ${r.attemptKind} reservation is the worst case of its own allowance`);
      }
      // Content-free diagnosis: the closed MALFORMED sub-reason, the class, the allowance, the finish reason.
      assert.deepEqual(audits(rt, id, 'run.model_output_invalid').map((a) => [a.reason, a.reasoningClass, a.malformedReason]), [['MALFORMED', 'E1', 'FIELD_SET']]);
      assert.deepEqual(audits(rt, id, 'run.model_call_observed').map((a) => [a.attemptKind, a.reasoningClass, a.maxOutputTokens, a.finishReason, a.proposalType, a.invalidCode, a.malformedReason]), [
        ['PRIMARY', 'E1', 2048, 'stop', 'INVALID', 'MALFORMED', 'FIELD_SET'],
        ['ESCALATION', 'E2', 4096, 'stop', 'MESSAGE', null, null],
      ]);
      const s = replyState(rt, w, id);
      assert.deepEqual([s.status, s.selection.mode, s.selection.startClass, s.answeredClasses], ['REPLIED', 'DEFAULT', 'E1', ['E1', 'E2']], 'the reply shows it started at the default and was escalated — never as a Founder E2 choice');
      assert.equal(s.requestedClass, null);
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('2 · an exhausted output (finish_reason=length) is never a reply: one same-class continuation with a larger allowance answers; a second exhaustion ends MODEL_OUTPUT_TRUNCATED with no message', () =>
    withWorld('p1r-truncate', { selection: 'DEFAULT' }, (_r, n, max) => (n === 1 || n >= 3 ? truncated(max) : ok('The complete answer.')), async ({ rt, w, sent }) => {
      const first = ask(rt, w, 'Explain the plan.', 'E2');
      assert.equal(await settled(rt, first), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.effort, s.maxTokens]), [['low', 4096], ['low', 8192]], 'the same class (E2), twice the allowance — never an escalation');
      const obs = audits(rt, first, 'run.model_call_observed');
      assert.deepEqual(obs.map((a) => [a.attemptKind, a.reasoningClass, a.finishReason, a.invalidCode, a.outputTokens, a.reasoningTokens]), [['PRIMARY', 'E2', 'length', 'OUTPUT_TRUNCATED', 4096, 4056], ['RETRY', 'E2', 'stop', null, 30, null]]);
      assert.equal(replyState(rt, w, first).status, 'REPLIED');
      // The next reply is cut at its allowance AND at the continuation's: a typed failure, no message, nothing retried.
      const second = ask(rt, w, 'Explain it again.', 'E2');
      assert.equal(await settled(rt, second), 'FAILED');
      const run = rt.view.runsForWorkItem(second).at(-1);
      assert.equal(run?.failureCode, 'MODEL_OUTPUT_TRUNCATED');
      const s = replyState(rt, w, second);
      assert.deepEqual([s.status, s.reasonCode, s.replyMessageId], ['FAILED', 'MODEL_OUTPUT_TRUNCATED', null]);
      assert.deepEqual(s.callDetails.map((c) => [c.attemptKind, c.finishReason, c.invalidCode]), [['PRIMARY', 'length', 'OUTPUT_TRUNCATED'], ['RETRY', 'length', 'OUTPUT_TRUNCATED']]);
      const comm = rt.founder.communications;
      assert.equal(comm.messages(comm.directThread(w.founder, null).id).filter((m) => m.senderKind === 'EMPLOYEE').length, 1, 'a truncated output never became a message');
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('3 · a malformed MESSAGE (body over the bound) records BODY_TOO_LONG; no body text reaches any audit row, event or log', () =>
    withWorld('p1r-malformed', { selection: 'DEFAULT' }, (_r, n) => (n === 1 ? fakeChatAnswer(message('PRIVATE-BODY-MARKER '.repeat(250)), { prompt: 300, completion: 900 }) : ok('Short.')), async ({ rt, w }) => {
      const id = ask(rt, w, 'Write it out in full.');
      assert.equal(await settled(rt, id), 'COMPLETED');
      assert.deepEqual(audits(rt, id, 'run.model_output_invalid').map((a) => a.malformedReason), ['BODY_TOO_LONG']);
      const everything = JSON.stringify([...rt.view.runsForWorkItem(id).flatMap((r) => rt.view.audit(r.id)), rt.view.audit(id)]);
      assert.equal(everything.includes('PRIVATE-BODY-MARKER'), false, 'content-free telemetry (Rule A)');
      const allowed = new Set(['reason', 'step', 'attemptKind', 'reasoningClass', 'deploymentCode', 'maxOutputTokens', 'inputTokens', 'outputTokens', 'reasoningTokens', 'finishReason', 'result', 'proposalType', 'invalidCode', 'malformedReason']);
      for (const a of audits(rt, id, 'run.model_call_observed')) assert.deepEqual(Object.keys(a).filter((k) => !allowed.has(k)), [], 'an observation holds closed codes and counts only');
    }));

  test('11–12 · an open circuit is a durable timed wait: no attempt is spent while it is open, the wait survives a restart, no brief is requested, and the reply lands once the circuit may be tried', () =>
    withWorld('p1r-circuit', { selection: 'DEFAULT' }, (_r, n) => (n <= 3 ? transient() : ok('Back again.')), async ({ rt, w, clock, restart }) => {
      const id = ask(rt, w, 'Are you there?');
      await eventually(() => rt.view.jobsFor(id).at(-1)?.waitReason === 'PROVIDER_CIRCUIT_OPEN' || undefined, 15_000, 'the circuit wait');
      const job = rt.view.jobsFor(id).at(-1);
      assert.ok(job);
      assert.equal(job.state, 'QUEUED', 'a timed wait: queued for the instant the circuit may be tried');
      assert.ok(job.attemptCount < job.maxAttempts, 'the open circuit did not use up the attempts (no premature DEAD_LETTER)');
      const attemptsWhileOpen = job.attemptCount;
      assert.equal(state(rt, id), 'WAITING');
      assert.equal(rt.view.listWorkItems({ limit: 1000 }).filter((x) => (x.dedupeKey ?? '').startsWith('ceo-brief:')).length, 0, 'waiting is not blocked: no CEO brief');
      // A restart keeps the durable wait; the circuit window passes (the clock moves past it) and the reply is written.
      clock.offset += 5 * 60_000 + 10_000;
      const rt2 = await restart();
      assert.equal(await settled(rt2, id, 20_000), 'COMPLETED');
      const after = rt2.view.jobsFor(id).at(-1);
      assert.equal(after?.attemptCount, attemptsWhileOpen, 'the wait itself spent no attempt');
      assert.equal(replyState(rt2, w, id).status, 'REPLIED');
      assert.equal(rt2.view.listWorkItems({ limit: 1000 }).filter((x) => (x.dedupeKey ?? '').startsWith('ceo-brief:')).length, 0);
    }));

  test('11b · a circuit wait keeps the call that was due: E1 invalid → the E2 escalation meets an open circuit → after the wait and a restart the run makes the E2 call (never a second E1)', () =>
    withWorld('p1r-circuit-escalation', { selection: 'DEFAULT' }, (_r, n) => (n <= 3 ? transient() : n === 4 ? fakeChatAnswer(message('x', { note: 'extra field' }), { prompt: 300, completion: 60 }) : ok('After the wait.')), async ({ rt, w, clock, restart, sent }) => {
      // A Founder E2 reply whose three transient failures open the E2 circuit (it then waits on it itself).
      const opener = ask(rt, w, 'Ping.', 'E2');
      await eventually(() => rt.view.jobsFor(opener).at(-1)?.waitReason === 'PROVIDER_CIRCUIT_OPEN' || undefined, 15_000, 'the E2 circuit to open');
      // A default reply: E1 answers MALFORMED, the evidence escalation to E2 meets the open circuit and waits.
      const id = ask(rt, w, 'How should we start?');
      await eventually(() => rt.view.jobsFor(id).at(-1)?.waitReason === 'PROVIDER_CIRCUIT_OPEN' || undefined, 15_000, 'the escalation to wait');
      assert.deepEqual(sent.slice(3).map((x) => x.effort ?? 'off'), ['off'], 'one E1 call so far for this reply');
      clock.offset += 5 * 60_000 + 10_000;
      const rt2 = await restart();
      assert.equal(await settled(rt2, id, 20_000), 'COMPLETED');
      const s = replyState(rt2, w, id);
      assert.deepEqual([s.status, s.answeredClasses], ['REPLIED', ['E1', 'E2']], 'the due escalation was made after the wait');
      const kinds = rt2.view.runsForWorkItem(id).flatMap((r) => rt2.governance.reservations(r.id).map((x) => x.attemptKind));
      assert.deepEqual(kinds, ['PRIMARY', 'ESCALATION']);
      assert.equal(await settled(rt2, opener, 20_000), 'COMPLETED');
    }));

  test('11c · a crash after an invalid output is classified and before the escalation is made: the resumed run makes the due E2 escalation — never a second E1 call, never a fresh retry budget', () => {
    // Fault injection: the runtime is shut down while E1's MALFORMED answer is being returned, so the processor classifies
    // it and then stops before its next call. Only the durable checkpoint survives into the next runtime.
    let crash: (() => void) | null = null;
    let restarted: Promise<CompanyRuntime> | null = null;
    return withWorld('p1r-crash-escalation', { selection: 'DEFAULT' }, (_r, n) => {
      if (n === 1) {
        crash?.();
        return fakeChatAnswer(message('x', { note: 'extra field' }), { prompt: 300, completion: 60 });
      }
      return ok('After the crash.');
    }, async ({ rt, w, restart, sent }) => {
      crash = (): void => {
        crash = null;
        restarted = restart();
      };
      const id = ask(rt, w, 'How should we start?');
      await eventually(() => restarted ?? undefined, 15_000, 'the injected crash');
      const rt2 = await (restarted as unknown as Promise<CompanyRuntime>);
      assert.equal(await settled(rt2, id, 20_000), 'COMPLETED');
      assert.deepEqual(sent.map((x) => x.effort ?? 'off'), ['off', 'low'], 'one E1 call, then the due E2 escalation — no second E1');
      const kinds = rt2.view.runsForWorkItem(id).flatMap((r) => rt2.governance.reservations(r.id).map((x) => x.attemptKind));
      assert.deepEqual(kinds, ['PRIMARY', 'ESCALATION']);
      assert.deepEqual(audits(rt2, id, 'run.model_output_invalid').map((a) => [a.reason, a.reasoningClass]), [['MALFORMED', 'E1']], 'the classification was recorded once, before the crash');
      assert.equal(replyState(rt2, w, id).status, 'REPLIED');
      assert.equal(rt2.governance.accountingInvariants().length, 0);
    });
  });

  test('10 · a budget without headroom for the selected class blocks paid execution: the reply parks WAITING_FOR_BUDGET before any provider call; an envelope that cannot fund a reply sends nothing', () =>
    withWorld('p1r-budget', { selection: 'AUTO', ceiling: 'E4', reasoningProfile: true }, () => ok(), async ({ rt, w, sent }) => {
      const comm = rt.founder.communications;
      const thread = comm.directThread(w.founder, null);
      const parked = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Prepare a three-year go-to-market strategy for the GCC and recommend the budget split.', replyCap: { money: 5, tokens: 5 } });
      const id = parked.replyWorkItemId as Id;
      await eventually(() => replyState(rt, w, id).status === 'WAITING_FOR_BUDGET' || undefined, 15_000, 'the budget wait');
      assert.equal(sent.length, 0, 'no paid call was made at the selected class');
      assert.equal(replyState(rt, w, id).reasonCode, 'BUDGET_EXHAUSTED');
    }).then(() =>
      withWorld('p1r-envelope', { selection: 'AUTO', envelopeMoney: 1 }, () => ok(), async ({ rt, w, sent }) => {
        const comm = rt.founder.communications;
        const thread = comm.directThread(w.founder, null);
        let id: Id | null = null;
        try {
          id = comm.send(w.founder, thread.id, { purpose: 'QUESTION', body: 'Plan the launch.' }).replyWorkItemId as Id;
        } catch {
          // Refused at the send: nothing was recorded, nothing can be spent.
        }
        if (id !== null) await eventually(() => ['WAITING_FOR_BUDGET', 'BLOCKED', 'FAILED'].includes(replyState(rt, w, id as Id).status) || undefined, 15_000, 'the envelope refusal');
        assert.equal(sent.length, 0, 'the Employee envelope is never exceeded by a paid call');
      })));
});

describe('P1-REASON-AUTO-RECOVERY-01 C: Adaptive Intelligence', () => {
  test('4–6, 14 · AUTO starts at the sufficient class within the AUTO maximum (D-P1-11): routine and long routine at E1; strategy and a full regional plan keep their raw E3 / E4 demand as evidence but run at E2 — even with E3 / E4 provisioned and the ceiling at E4', () =>
    withWorld('p1r-auto', { ceiling: 'E4', reasoningProfile: true }, () => ok(), async ({ rt, w, sent, ceo }) => {
      assert.equal(rt.governance.getEmployee(ceo.id).cognitiveProfile.selection, 'AUTO', 'a newly created Employee selects with AUTO');
      const cases: [string, ReasoningClass, ReasoningClass][] = [
        ['Thanks, got it.', 'E1', 'E1'],
        ['Quick update for your records: I archived the old threads, renamed the shared folders, updated the meeting notes, confirmed the room booking for Thursday, refilled the stationery order and sent the reminder about the font files. Everything is done for today. Thanks.', 'E1', 'E1'],
        ['Compare entering the Saudi and Egyptian markets and recommend which to launch first.', 'E3', 'E2'],
        ['Prepare a three-year go-to-market strategy for launching QANDEEL across the GCC. Compare the pricing options, recommend the budget split, and tell me which roles we must hire first.', 'E4', 'E2'],
      ];
      for (const [body, ideal, ran] of cases) {
        const id = ask(rt, w, body);
        assert.equal(await settled(rt, id), 'COMPLETED');
        const s = replyState(rt, w, id);
        assert.deepEqual([s.selection.mode, s.selection.idealClass, s.selection.startClass, s.selection.constraint, s.selection.autoCap, s.answeredClasses], ['AUTO', ideal, ran, ideal === ran ? null : 'AUTO_POLICY_CAP', 'E2', [ran]], body.slice(0, 40));
        assert.ok(s.selection.reasons.length > 0, 'content-free reason codes support the choice');
        assert.deepEqual(reservedClasses(rt, id), [ran], 'reserved at the class that ran, never above E2');
        assert.equal((rt.view.getWorkItem(id).processorInput as { reasoningDemand?: { level?: string } }).reasoningDemand?.level, ideal, 'the recorded demand is never rewritten');
      }
      assert.deepEqual(sent.map((s) => [s.effort ?? 'off', s.maxTokens]), [['off', 2048], ['off', 2048], ['low', 4096], ['low', 4096]], 'each call has its own class allowance; nothing ran with thinking high or max');
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('13 · AUTO never uses a class that is not provisioned or permitted: the ideal E4 runs at E2 and says why (ceiling, then provisioning)', () =>
    withWorld('p1r-auto-bounded', { ceiling: 'E2' }, () => ok(), async ({ rt, w, ceo }) => {
      const strategic = 'Prepare a three-year go-to-market strategy for launching QANDEEL across the GCC. Compare the pricing options, recommend the budget split, and tell me which roles we must hire first.';
      const a = ask(rt, w, strategic);
      assert.equal(await settled(rt, a), 'COMPLETED');
      const sa = replyState(rt, w, a);
      assert.deepEqual([sa.selection.idealClass, sa.selection.startClass, sa.selection.constraint, sa.answeredClasses], ['E4', 'E2', 'EMPLOYEE_CEILING', ['E2']], 'held by the Employee ceiling, shown as such');
      // The ceiling is raised through the governed profile act, but E3 / E4 are not provisioned: held by provisioning.
      const e = rt.governance.getEmployee(ceo.id);
      rt.governance.changeReasoningProfile(w.founder, e.id, { defaultClass: 'E1', ceilingClass: 'E4', expectedVersion: e.version, reasonCode: 'founder.reasoning_profile' });
      const b = ask(rt, w, strategic);
      assert.equal(await settled(rt, b), 'COMPLETED');
      const sb = replyState(rt, w, b);
      assert.deepEqual([sb.selection.idealClass, sb.selection.startClass, sb.answeredClasses], ['E4', 'E2', ['E2']]);
      assert.ok(sb.selection.constraint === 'ROUTE_POLICY' || sb.selection.constraint === 'NOT_PROVISIONED', `held by the route / provisioning (${String(sb.selection.constraint)})`);
    }));

  test('8 · a Founder E3 is pinned: an invalid output is retried at E3 only (no escalation to E4), and the run never reserves another class', () =>
    withWorld('p1r-pinned', { ceiling: 'E4', reasoningProfile: true }, (_r, n) => (n === 1 ? fakeChatAnswer('not json', { prompt: 300, completion: 20 }) : ok('Considered answer.')), async ({ rt, w, sent }) => {
      const id = ask(rt, w, 'Thanks.', 'E3');
      assert.equal(await settled(rt, id), 'COMPLETED');
      assert.deepEqual(sent.map((s) => s.effort), ['high', 'high'], 'both calls at the pinned E3 (thinking high)');
      const run = rt.view.runsForWorkItem(id).at(-1);
      assert.ok(run);
      assert.equal(rt.governance.reservations(run.id).some((r) => r.attemptKind === 'ESCALATION'), false);
      const s = replyState(rt, w, id);
      assert.deepEqual([s.selection.mode, s.selection.startClass, s.requestedClass, s.answeredClasses], ['MANUAL', 'E3', 'E3', ['E3', 'E3']], 'MANUAL wins over AUTO, even for a routine message');
    }));

  test('9 · a class pinned by the Work Item (an Academy method pin) is never replaced by AUTO', () =>
    withWorld('p1r-system-pin', { ceiling: 'E4', reasoningProfile: true }, () => fakeChatAnswer(JSON.stringify({ type: 'FINAL', summaryCode: 'done' }), { prompt: 300, completion: 10 }), async ({ rt, w, ceo, sent }) => {
      const { workItem } = rt.submitWorkItem({ objective: 'method-pinned observation', ownerRef: ceo.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'founder.reply', dataClass: 'D2', reasoningClass: 'E1', invalidOutputPolicy: 'SAME_CLASS_RETRY', maxOutputTokens: 512, reasoningDemand: { policy: 'RD-1', level: 'E4', complexity: 'VERY_HIGH', consequence: 'VERY_HIGH', confidence: 'CLEAR', reasons: ['STRATEGIC_PLANNING'] }, instructions: 'Answer.' } });
      rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 500_000, capTokens: 200_000, reasonCode: 'seed' });
      rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
      assert.equal(await settled(rt, workItem.id), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.thinking, s.maxTokens]), [[{ type: 'disabled' }, 512]], 'the pinned class and its pinned allowance');
      assert.deepEqual(audits(rt, workItem.id, 'run.reasoning_selected').map((a) => [a.mode, a.startClass]), [['SYSTEM_PINNED', 'E1']]);
    }));

  test('15 · an Employee whose profile selects DEFAULT keeps its default whatever the demand; the demand is still recorded on the Work Item', () =>
    withWorld('p1r-default', { selection: 'DEFAULT', ceiling: 'E4', reasoningProfile: true }, () => ok(), async ({ rt, w, sent }) => {
      const id = ask(rt, w, 'Prepare a three-year go-to-market strategy for launching QANDEEL across the GCC. Compare the pricing options, recommend the budget split, and tell me which roles we must hire first.');
      assert.equal(await settled(rt, id), 'COMPLETED');
      assert.deepEqual(sent.map((s) => s.thinking), [{ type: 'disabled' }]);
      const s = replyState(rt, w, id);
      assert.deepEqual([s.selection.mode, s.selection.startClass, s.answeredClasses], ['DEFAULT', 'E1', ['E1']]);
      const input = rt.view.getWorkItem(id).processorInput as { reasoningDemand?: { level?: string } };
      assert.equal(input.reasoningDemand?.level, 'E4', 'the governed demand is recorded, but only AUTO acts on it');
    }));
});

/**
 * P1-CHAT-REFS-CORR-01 — a well-formed Founder reply is never lost only because its optional, non-authoritative contextRefs
 * broke the closed kind:id grammar (the LIVE incident: a document path in contextRefs, MALFORMED / REFS_INVALID twice at a
 * pinned E2). Proven through the real runtime and the real adapter behind the fake transport; no paid call.
 */
describe('P1-CHAT-REFS-CORR-01: a Founder reply with malformed references', () => {
  const PATH_REF = 'docs/ROADMAP.md@1a2b3c4';
  const BODY = 'The roadmap is current (docs/ROADMAP.md @ 1a2b3c4).';
  const hostile = (): DeepSeekResponse => fakeChatAnswer(message(BODY, { contextRefs: Array.from({ length: 9 }, () => PATH_REF) }), { prompt: 300, completion: 60 });
  const employeeMessages = (rt: CompanyRuntime, w: C2World) => {
    const comm = rt.founder.communications;
    return comm.messages(comm.directThread(w.founder, null).id).filter((m) => m.senderKind === 'EMPLOYEE');
  };
  const discards = (rt: CompanyRuntime): Record<string, unknown>[] => rt.view.auditByAction('communication.message_refs_discarded').map((a) => ({ reason: a.reasonCode, discarded: a.details.discarded, kept: a.details.kept }));

  test('refs 1 · at a pinned E2, a MESSAGE whose only defect is a document path in contextRefs is delivered once: body kept, valid reference kept, path discarded, no second (paid) call', () =>
    withWorld('p1r-refs-recover', { selection: 'DEFAULT' }, () => fakeChatAnswer(message(BODY, { contextRefs: [PATH_REF, 'memory:abc123'] }), { prompt: 300, completion: 60 }), async ({ rt, w, sent }) => {
      const id = ask(rt, w, 'Finish the study of the product repository and brief me.', 'E2');
      assert.equal(await settled(rt, id), 'COMPLETED');
      assert.equal(sent.length, 1, 'exactly one model call');
      const out = employeeMessages(rt, w);
      assert.deepEqual(out.map((m) => [m.body, m.contextRefs]), [[BODY, ['memory:abc123']]], 'exactly one reply; the path + commit stays in the body; no reference is invented');
      assert.deepEqual(discards(rt), [{ reason: 'CHAT_REFS_DISCARDED', discarded: 1, kept: 1 }]);
      assert.deepEqual(audits(rt, id, 'run.model_output_invalid'), [], 'not an invalid output: no retry was spent');
      const s = replyState(rt, w, id);
      assert.deepEqual([s.status, s.requestedClass, s.answeredClasses], ['REPLIED', 'E2', ['E2']]);
      assert.deepEqual(s.callDetails.map((c) => [c.attemptKind, c.reasoningClass, c.invalidCode, c.malformedReason]), [['PRIMARY', 'E2', 'MALFORMED', 'REFS_INVALID']], 'the call is still observed truthfully as the raw output was');
      const everything = JSON.stringify([...rt.view.runsForWorkItem(id).flatMap((r) => rt.view.audit(r.id)), rt.view.audit(id), rt.view.auditByAction('communication.message_refs_discarded')]);
      assert.equal(everything.includes('ROADMAP'), false, 'the discarded reference is never stored in telemetry (Rule A)');
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('refs 2 · a hostile reference list (over the bound) is not recovered: the pinned E2 keeps its one same-class retry and its call bound, then MODEL_OUTPUT_INVALID with no message', () =>
    withWorld('p1r-refs-hostile', { selection: 'DEFAULT' }, () => hostile(), async ({ rt, w, sent }) => {
      const id = ask(rt, w, 'Brief me on the product.', 'E2');
      assert.equal(await settled(rt, id), 'FAILED');
      assert.deepEqual(sent.map((s) => s.effort), ['low', 'low'], 'two calls, both at the pinned E2 (never escalated)');
      assert.equal(rt.view.runsForWorkItem(id).at(-1)?.failureCode, 'MODEL_OUTPUT_INVALID');
      assert.deepEqual(audits(rt, id, 'run.model_output_invalid').map((a) => [a.reason, a.malformedReason]), [['MALFORMED', 'REFS_INVALID'], ['MALFORMED', 'REFS_INVALID']]);
      assert.deepEqual([employeeMessages(rt, w).length, discards(rt).length], [0, 0]);
    }));

  test('refs 3 · secret material in the body is still refused by the message fence, recovered references or not; the next turn answers cleanly', () => {
    const secret = ['Bearer ', 'abcdefghjkmnpqrstuvwxyz23456789a'].join('');
    return withWorld('p1r-refs-secret', { selection: 'DEFAULT' }, (_r, n) => (n === 1 ? fakeChatAnswer(message(`key ${secret}`, { contextRefs: [PATH_REF] }), { prompt: 300, completion: 60 }) : ok('Clean answer.')), async ({ rt, w, sent }) => {
      const id = ask(rt, w, 'Status?', 'E2');
      assert.equal(await settled(rt, id), 'COMPLETED');
      assert.equal(sent.length, 2);
      assert.deepEqual(employeeMessages(rt, w).map((m) => m.body), ['Clean answer.'], 'the secret-bearing body never became a message');
      assert.equal(discards(rt).length, 0, 'a refused message records no discard');
    });
  });

  test('refs 4 · a CEO brief is not a Founder reply: malformed references stay an invalid output (escalated as before), never recovered', () =>
    withWorld('p1r-refs-brief', { selection: 'DEFAULT' }, () => fakeChatAnswer(JSON.stringify({ type: 'MESSAGE', purpose: 'BRIEF', attentionLevel: 'NEEDS_DECISION', body: 'Brief.', brief: { happening: 'a', matters: 'b', recommendation: 'c', decisionNeeded: true, decision: 'd' }, contextRefs: [PATH_REF] }), { prompt: 300, completion: 60 }), async ({ rt, sent }) => {
      const req = rt.founder.communications.requestCeoBrief({ subject: 'decision', contextKind: 'APPROVAL', contextRef: 'approval:x', reasonCode: 'brief.test', instructions: 'Brief the Founder.' });
      assert.equal(await settled(rt, req.workItemId), 'FAILED');
      assert.equal(sent.length, 2);
      assert.deepEqual(audits(rt, req.workItemId, 'run.model_output_invalid').map((a) => a.malformedReason), ['REFS_INVALID', 'REFS_INVALID']);
      assert.equal(discards(rt).length, 0);
    }));
});

/**
 * P1-CEO-QUALITY-CORR-01 A (D-P1-09) — the LIVE incident: AUTO chose E4 for a strategic request; thinking took the whole
 * 16,384-token allowance (finish_reason=length), and the one same-class continuation (32,768) was cut by the fixed 120 s
 * call timeout (TIMEOUT_AFTER_SEND), so no reply came. A call's timeout now grows with the allowance it was given. Scaled
 * here: a 1 s base covers 15,000 tokens, so 32,768 gets 2.19 s and an answer after 1.5 s lands (the old fixed 1 s cut it).
 */
describe('P1-CEO-QUALITY-CORR-01 A: an E4 strategic reply can use the allowance it was given', () => {
  const STRATEGY = 'Prepare a three-year go-to-market strategy for launching QANDEEL across the GCC. Compare the pricing options, recommend the budget split, and tell me which roles we must hire first.';
  const later = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));
  const employeeMessages = (rt: CompanyRuntime, w: C2World) => {
    const comm = rt.founder.communications;
    return comm.messages(comm.directThread(w.founder, null).id).filter((m) => m.senderKind === 'EMPLOYEE');
  };

  test('the timeout scales with the allowance, never below the base: E1–E3 keep 120 s, E4 gets 131 s, the largest continuation 262 s', () => {
    assert.deepEqual([2048, 4096, 8192, 15_000, 16_384, 32_768].map((t) => modelCallTimeoutMs(120_000, t)), [120_000, 120_000, 120_000, 120_000, 131_072, 262_144]);
    assert.ok(modelCallTimeoutMs(1_000, 32_768) > 1_500 && modelCallTimeoutMs(1_000, 16_384) < 1_500, 'the slow continuation below is inside its own timeout, and would not be inside a primary call\'s');
  });

  // P1-AUTO-E12-01 (D-P1-11): AUTO no longer reaches E4, so the E4 timeout proofs below run at a Founder-chosen E4 (the only
  // way E4 now runs); the D-P1-09 behaviour they prove is unchanged.
  test('a Founder E4: thinking exhausts 16,384 → one E4 continuation (32,768) that takes longer than the base timeout answers; one message, no escalation or downgrade, nothing held', () =>
    withWorld('p1q-e4-manual', { ceiling: 'E4', reasoningProfile: true, callTimeoutMs: 1_000 }, (_r, n, max) => (n === 1 ? truncated(max) : later(1_500, ok('A focused strategic answer: the decision, why, and the next step.'))), async ({ rt, w, sent }) => {
      const id = ask(rt, w, STRATEGY, 'E4');
      assert.equal(await settled(rt, id), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.effort, s.maxTokens]), [['max', 16_384], ['max', 32_768]], 'E4 both times (thinking max), twice the allowance');
      const s = replyState(rt, w, id);
      assert.deepEqual([s.status, s.selection.mode, s.requestedClass, s.selection.startClass, s.answeredClasses], ['REPLIED', 'MANUAL', 'E4', 'E4', ['E4', 'E4']], 'the Founder\'s E4 is kept exactly');
      assert.deepEqual(s.callDetails.map((c) => [c.attemptKind, c.reasoningClass, c.maxOutputTokens, c.finishReason, c.invalidCode]), [['PRIMARY', 'E4', 16_384, 'length', 'OUTPUT_TRUNCATED'], ['RETRY', 'E4', 32_768, 'stop', null]]);
      assert.deepEqual(employeeMessages(rt, w).map((m) => m.body), ['A focused strategic answer: the decision, why, and the next step.'], 'exactly one complete reply; the cut output never became a message');
      const run = rt.view.runsForWorkItem(id).at(-1);
      assert.ok(run);
      assert.deepEqual(rt.governance.reservations(run.id).map((r) => [r.attemptKind, r.state]), [['PRIMARY', 'SETTLED'], ['RETRY', 'SETTLED']], 'both calls settled: nothing is held for reconciliation');
      assert.equal(s.reservedMoney, 0);
      assert.ok(s.spentMoney > 0 && s.spentMoney <= s.capMoney, 'within the reply\'s own cap');
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('a Founder E4 is pinned: two exhaustions end MODEL_OUTPUT_TRUNCATED after exactly two E4 calls — no third paid call, no other class, no partial message', () =>
    withWorld('p1q-e4-pinned', { ceiling: 'E4', reasoningProfile: true }, (_r, _n, max) => truncated(max), async ({ rt, w, sent }) => {
      const id = ask(rt, w, STRATEGY, 'E4');
      assert.equal(await settled(rt, id), 'FAILED');
      assert.deepEqual(sent.map((s) => s.maxTokens), [16_384, 32_768]);
      assert.equal(new Set(sent.map((s) => String(s.effort))).size, 1, 'one thinking effort: E4 throughout');
      const s = replyState(rt, w, id);
      assert.deepEqual([s.status, s.reasonCode, s.requestedClass, s.selection.mode, s.answeredClasses, s.replyMessageId], ['FAILED', 'MODEL_OUTPUT_TRUNCATED', 'E4', 'MANUAL', ['E4', 'E4'], null]);
      assert.equal(employeeMessages(rt, w).length, 0, 'an incomplete output is never delivered');
      const run = rt.view.runsForWorkItem(id).at(-1);
      assert.ok(run);
      assert.deepEqual(rt.governance.reservations(run.id).map((r) => r.state), ['SETTLED', 'SETTLED'], 'the two answered calls are charged; nothing stays held');
      assert.equal(s.reservedMoney, 0);
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('a continuation that outlives even its scaled timeout is TIMEOUT_AFTER_SEND: its money is held (not spent) and the reply waits for the Founder\'s reconciliation (R1-01) — no resumed run, no third call, no message', () =>
    withWorld('p1q-e4-timeout', { ceiling: 'E4', reasoningProfile: true, callTimeoutMs: 300 }, (_r, n, max) => (n === 1 ? truncated(max) : new Promise<DeepSeekResponse>(() => undefined)), async ({ rt, w, sent }) => {
      const id = ask(rt, w, STRATEGY, 'E4');
      assert.equal(await settled(rt, id), 'BLOCKED');
      assert.equal(sent.length, 2, 'the timed-out continuation is not retried, on any deployment');
      assert.deepEqual(sent.map((s) => [s.effort, s.maxTokens]), [['max', 16_384], ['max', 32_768]]);
      const runs = rt.view.runsForWorkItem(id);
      assert.deepEqual(runs.map((r) => [r.state, r.failureCode]), [['RECONCILIATION_REQUIRED', 'PROVIDER_FAILURE']], 'one run: the job is held, never resumed on its own');
      assert.equal(rt.view.jobsFor(id)[0]?.state, 'RECONCILIATION_HOLD');
      const held = runs.flatMap((r) => rt.governance.reservations(r.id)).map((r) => [r.attemptKind, r.state, r.reasonCode]);
      assert.deepEqual(held, [['PRIMARY', 'SETTLED', null], ['RETRY', 'RECONCILIATION_REQUIRED', 'TIMEOUT_AFTER_SEND']]);
      const s = replyState(rt, w, id);
      assert.deepEqual([s.status, s.reasonCode], ['BLOCKED', 'RECONCILIATION_REQUIRED']);
      assert.ok(s.reservedMoney > 0, 'held, not spent: the Founder reconciles it');
      assert.equal(employeeMessages(rt, w).length, 0);
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));
});

/**
 * P1-AUTO-E12-01 (D-P1-11, Founder decision) — company-wide AUTO reasoning cap and bounded recovery, through the REAL runtime
 * and the REAL adapter behind the fake transport (no paid call). AUTO executes at E1 / E2 only: E3 / E4 are never selected,
 * escalated to, lifted to by a route minimum, retried, continued or resumed into on AUTO; E2 gets at most one technical
 * repair with a real correction (a larger allowance), never a blind replay; a limit is reported truthfully. MANUAL, method
 * pins and DEFAULT keep their behaviour, and no Employee profile changes.
 */
describe('P1-AUTO-E12-01: the company-wide AUTO cap and bounded recovery', () => {
  const STRATEGY = 'Prepare a three-year go-to-market strategy for launching QANDEEL across the GCC. Compare the pricing options, recommend the budget split, and tell me which roles we must hire first.';
  const extraField = (): DeepSeekResponse => fakeChatAnswer(message('x', { note: 'extra field' }), { prompt: 300, completion: 60 });
  const notJson = (): DeepSeekResponse => fakeChatAnswer('not json', { prompt: 300, completion: 20 });
  const failure = (rt: CompanyRuntime, id: Id): string | null | undefined => rt.view.runsForWorkItem(id).at(-1)?.failureCode;
  const kinds = (rt: CompanyRuntime, id: Id): string[] => rt.view.runsForWorkItem(id).flatMap((r) => rt.governance.reservations(r.id)).map((r) => r.attemptKind);
  const employeeMessages = (rt: CompanyRuntime, w: C2World) => {
    const comm = rt.founder.communications;
    return comm.messages(comm.directThread(w.founder, null).id).filter((m) => m.senderKind === 'EMPLOYEE');
  };

  test('3–4 · AUTO E1 → E2 on observable evidence works; at E2 an invalid output ends MODEL_OUTPUT_INVALID after one call (no E3, no blind replay, never reported as the AUTO limit: R1-03); E1 → E2 → invalid ends MODEL_OUTPUT_INVALID; the profile never changes', () =>
    withWorld('p1a-escalate', { ceiling: 'E4', reasoningProfile: true }, (_r, n) => ([1, 4].includes(n) ? extraField() : [3, 5].includes(n) ? notJson() : ok('Two departments first.')), async ({ rt, w, sent, ceo }) => {
      const before = rt.governance.getEmployee(ceo.id);
      const routine = ask(rt, w, 'Thanks, got it.');
      assert.equal(await settled(rt, routine), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.effort ?? 'off', s.maxTokens]), [['off', 2048], ['low', 4096]], 'E1, then the evidence escalation to E2 with its own allowance');
      assert.deepEqual([kinds(rt, routine), reservedClasses(rt, routine)], [['PRIMARY', 'ESCALATION'], ['E1', 'E2']]);
      assert.equal(replyState(rt, w, routine).status, 'REPLIED');

      const strategic = ask(rt, w, STRATEGY);
      assert.equal(await settled(rt, strategic), 'FAILED');
      assert.equal(sent.length, 3, 'exactly one call: no escalation to E3 and no identical E2 replay');
      assert.equal(sent[2]?.effort, 'low');
      assert.deepEqual([failure(rt, strategic), kinds(rt, strategic), reservedClasses(rt, strategic)], ['MODEL_OUTPUT_INVALID', ['PRIMARY'], ['E2']], 'an invalid output is no evidence that a higher level was needed');
      const s = replyState(rt, w, strategic);
      assert.deepEqual([s.status, s.reasonCode, s.replyMessageId, s.selection.idealClass, s.selection.startClass, s.selection.constraint], ['FAILED', 'MODEL_OUTPUT_INVALID', null, 'E4', 'E2', 'AUTO_POLICY_CAP'], 'the failure is reported as what it is; the raw demand is never shown as the class used');
      assert.deepEqual(audits(rt, strategic, 'run.model_output_invalid').map((a) => [a.reason, a.reasoningClass]), [['NOT_JSON', 'E2']]);

      const again = ask(rt, w, 'Thanks again.');
      assert.equal(await settled(rt, again), 'FAILED');
      assert.deepEqual([failure(rt, again), reservedClasses(rt, again)], ['MODEL_OUTPUT_INVALID', ['E1', 'E2']], 'E1 → E2, then the escalated step ends: never E3');
      assert.equal(sent.length, 5);
      assert.ok(sent.every((x) => x.effort === undefined || x.effort === 'low'), 'no call ever ran with thinking high or max');
      const after = rt.governance.getEmployee(ceo.id);
      assert.deepEqual([after.cognitiveProfile, after.version], [before.cognitiveProfile, before.version], 'no profile change, no REVIEW_DUE trigger');
      assert.equal(employeeMessages(rt, w).length, 1);
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('5–6 · AUTO E2 output exhaustion: one E2 repair with a larger allowance (4,096 → 8,192) answers; a second exhaustion ends MODEL_OUTPUT_TRUNCATED, and an invalid repair ends MODEL_OUTPUT_INVALID (R1-03: three distinct codes) — two calls each, never E3 / E4, never a partial message', () =>
    withWorld('p1a-repair', { ceiling: 'E4', reasoningProfile: true }, (_r, n, max) => (n === 2 ? ok('The complete answer.') : n === 6 ? notJson() : truncated(max)), async ({ rt, w, sent }) => {
      const repaired = ask(rt, w, STRATEGY);
      assert.equal(await settled(rt, repaired), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.effort, s.maxTokens]), [['low', 4096], ['low', 8192]], 'the same class, a larger allowance: the correction is concrete');
      assert.deepEqual([kinds(rt, repaired), reservedClasses(rt, repaired)], [['PRIMARY', 'RETRY'], ['E2', 'E2']]);
      assert.deepEqual(replyState(rt, w, repaired).callDetails.map((c) => [c.attemptKind, c.reasoningClass, c.finishReason]), [['PRIMARY', 'E2', 'length'], ['RETRY', 'E2', 'stop']]);

      const exhausted = ask(rt, w, STRATEGY);
      assert.equal(await settled(rt, exhausted), 'FAILED');
      assert.deepEqual([failure(rt, exhausted), reservedClasses(rt, exhausted)], ['MODEL_OUTPUT_TRUNCATED', ['E2', 'E2']]);

      const invalidRepair = ask(rt, w, STRATEGY);
      assert.equal(await settled(rt, invalidRepair), 'FAILED');
      assert.deepEqual([failure(rt, invalidRepair), kinds(rt, invalidRepair), reservedClasses(rt, invalidRepair)], ['MODEL_OUTPUT_INVALID', ['PRIMARY', 'RETRY'], ['E2', 'E2']], 'one repair per step: the invalid repair is not followed by a third call');
      assert.equal(sent.length, 6);
      assert.ok(sent.every((x) => x.effort === 'low'));
      assert.deepEqual(employeeMessages(rt, w).map((m) => m.body), ['The complete answer.'], 'a truncated or invalid output never became a message');
      for (const id of [repaired, exhausted, invalidRepair]) assert.equal(replyState(rt, w, id).reservedMoney, 0, 'every answered call settled: nothing held');
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('3, 10 · a call checkpointed before the cap (an E4 continuation, an E2 → E3 escalation) is never made on resume: AUTO_LEVEL_LIMIT with no call and no reservation; a Founder E4 with the same due continuation still makes it', () => {
    let stale: Record<string, unknown> | null = null;
    // Writes, on a Work Item's first run, the employee-loop checkpoint an earlier release could have left, then stops as a
    // retryable failure: the next run resumes from that durable checkpoint through the real processor.
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
    return withWorld('p1a-stale', { ceiling: 'E4', reasoningProfile: true, processor: legacy }, () => ok('Resumed.'), async ({ rt, w, sent }) => {
      stale = { turn: 0, phase: 'MODEL', pending: null, modelCalls: 0, invalid: 0, truncations: 1, pendingContinuation: { reasoningClass: 'E4', exhaustedTokens: 16_384 } };
      const continuation = ask(rt, w, STRATEGY);
      assert.equal(await settled(rt, continuation), 'FAILED');
      stale = { turn: 0, phase: 'MODEL', pending: null, modelCalls: 0, invalid: 1, pendingEscalation: { fromClass: 'E2', evidence: 'OUTPUT_FAILED_VALIDATION' } };
      const escalation = ask(rt, w, STRATEGY);
      assert.equal(await settled(rt, escalation), 'FAILED');
      assert.equal(sent.length, 0, 'no paid call');
      for (const id of [continuation, escalation]) {
        assert.equal(failure(rt, id), 'AUTO_LEVEL_LIMIT');
        assert.deepEqual(kinds(rt, id), [], 'nothing reserved');
        assert.equal(replyState(rt, w, id).reasonCode, 'AUTO_LEVEL_LIMIT');
      }
      stale = { turn: 0, phase: 'MODEL', pending: null, modelCalls: 0, invalid: 0, truncations: 1, pendingContinuation: { reasoningClass: 'E4', exhaustedTokens: 16_384 } };
      const manual = ask(rt, w, STRATEGY, 'E4');
      assert.equal(await settled(rt, manual), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.effort, s.maxTokens]), [['max', 32_768]], 'MANUAL is not AUTO: its due E4 continuation is made');
      assert.equal(rt.governance.accountingInvariants().length, 0);
    });
  });

  test('7 · a route minimum above E2 gives AUTO no class (AUTO_LEVEL_LIMIT before any reservation) while a Founder E3 runs at exactly E3; with no E1 / E2 route AUTO records why and spends nothing — never routed to the E3 / E4 deployments that are there', () =>
    withWorld('p1a-route', { ceiling: 'E4', reasoningProfile: true }, () => ok('Answer.'), async ({ rt, w, sent }) => {
      const current = rt.governance.routingSnapshot('founder.reply').policy;
      assert.ok(current);
      const body = (minClass: ReasoningClass) => ({ minClass, maxClass: current.maxClass, allowLimitedProduction: current.allowLimitedProduction, maxRetriesPerCall: current.maxRetriesPerCall, maxCallsPerRun: current.maxCallsPerRun, fallbackCostCeilingMicros: current.fallbackCostCeilingMicros, escalation: current.escalation });
      rt.governance.createRoutePolicy(w.founder, 'founder.reply', body('E3'));
      const auto = ask(rt, w, STRATEGY);
      assert.equal(await settled(rt, auto), 'FAILED');
      assert.deepEqual([failure(rt, auto), kinds(rt, auto), sent.length], ['AUTO_LEVEL_LIMIT', [], 0], 'never lifted to E3: no reservation, no call');
      const selected = audits(rt, auto, 'run.reasoning_selected');
      assert.deepEqual(selected.map((a) => [a.mode, a.startClass, a.idealClass, a.constraint, a.autoCap, a.routeUnavailable]), [['AUTO', null, 'E4', 'AUTO_POLICY_CAP', 'E2', 'AUTO_POLICY_CAP']]);
      const allowed = new Set(['reason', 'step', 'mode', 'startClass', 'idealClass', 'constraint', 'autoCap', 'routeUnavailable', 'policy', 'complexity', 'consequence', 'confidence']);
      for (const a of selected) assert.deepEqual(Object.keys(a).filter((k) => !allowed.has(k) && !k.startsWith('reason:')), [], 'closed codes only (Rule A)');
      const sa = replyState(rt, w, auto);
      assert.deepEqual([sa.status, sa.reasonCode, sa.selection.routeUnavailable, sa.selection.startClass], ['FAILED', 'AUTO_LEVEL_LIMIT', 'AUTO_POLICY_CAP', null]);

      const manual = ask(rt, w, STRATEGY, 'E3');
      assert.equal(await settled(rt, manual), 'COMPLETED');
      assert.deepEqual([sent.map((s) => s.effort), reservedClasses(rt, manual)], [['high'], ['E3']], 'the Founder E3 is kept exactly');

      rt.governance.createRoutePolicy(w.founder, 'founder.reply', body('E1'));
      for (const d of rt.governance.routingSnapshot('founder.reply').deployments) if (d.reasoningClass === 'E1' || d.reasoningClass === 'E2') rt.governance.setHold(w.founder, { entity: 'deployment', id: d.id }, true, 'proof.hold');
      const unrouted = ask(rt, w, STRATEGY);
      assert.ok(['FAILED', 'BLOCKED'].includes(await settled(rt, unrouted, 30_000)));
      assert.equal(sent.length, 1, 'no further call: the E3 / E4 deployments were never used for AUTO');
      assert.deepEqual(kinds(rt, unrouted), []);
      assert.ok(rt.view.runsForWorkItem(unrouted).every((r) => r.failureCode === 'NO_ELIGIBLE_ROUTE'), 'the real cause, every run');
      const su = replyState(rt, w, unrouted);
      assert.deepEqual([su.selection.startClass, su.selection.constraint, su.selection.routeUnavailable, su.calls], ['E2', 'AUTO_POLICY_CAP', 'NO_ELIGIBLE_DEPLOYMENT', 0]);
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('9, 11 · an E3 pinned in a non-Academy Work Item of an AUTO Employee is no bypass (R1-02): nothing is reserved or sent above E2; a DEFAULT Employee keeps its bounded escalation E2 → E3 — the cap is AUTO-only and the profiles stay as stored', () =>
    withWorld('p1a-pinned', { ceiling: 'E4', reasoningProfile: true }, () => fakeChatAnswer(JSON.stringify({ type: 'FINAL', summaryCode: 'done' }), { prompt: 300, completion: 10 }), async ({ rt, w, ceo, sent }) => {
      const { workItem } = rt.submitWorkItem({ objective: 'method-pinned observation', ownerRef: ceo.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'founder.reply', dataClass: 'D2', reasoningClass: 'E3', invalidOutputPolicy: 'SAME_CLASS_RETRY', maxOutputTokens: 512, reasoningDemand: { policy: 'RD-1', level: 'E4', complexity: 'VERY_HIGH', consequence: 'VERY_HIGH', confidence: 'CLEAR', reasons: ['STRATEGIC_PLANNING'] }, instructions: 'Answer.' } });
      rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 500_000, capTokens: 200_000, reasonCode: 'seed' });
      rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
      assert.equal(await settled(rt, workItem.id), 'FAILED');
      assert.deepEqual([failure(rt, workItem.id), sent.length, reservedClasses(rt, workItem.id)], ['AUTO_LEVEL_LIMIT', 0, []], 'a submitter cannot pin past the AUTO maximum: no call, no reservation');
      // Genuine Academy items (attempts, benchmarks, shadow work) are never AUTO: the store-boundary proof reserves E3 for one.
      assert.equal(rt.governance.getEmployee(ceo.id).cognitiveProfile.selection, 'AUTO', 'unchanged');
    }).then(() =>
      withWorld('p1a-default', { selection: 'DEFAULT', ceiling: 'E4', reasoningProfile: true }, (_r, n) => (n === 1 ? notJson() : ok('Escalated answer.')), async ({ rt, w, ceo, sent }) => {
        const e = rt.governance.getEmployee(ceo.id);
        rt.governance.changeReasoningProfile(w.founder, e.id, { defaultClass: 'E2', ceilingClass: 'E4', expectedVersion: e.version, reasonCode: 'founder.reasoning_profile' });
        const id = ask(rt, w, STRATEGY);
        assert.equal(await settled(rt, id), 'COMPLETED');
        assert.deepEqual(sent.map((s) => s.effort), ['low', 'high'], 'DEFAULT E2 → E3 on observable evidence, as before');
        const s = replyState(rt, w, id);
        assert.deepEqual([s.selection.mode, s.selection.autoCap, reservedClasses(rt, id)], ['DEFAULT', null, ['E2', 'E3']]);
        assert.equal(rt.governance.getEmployee(ceo.id).cognitiveProfile.selection, 'DEFAULT', 'DEFAULT stays DEFAULT');
      })));
});

/**
 * P1-AUTO-E12-01 Correction R1 (Founder-approved), through the REAL runtime and the REAL adapter behind the fake transport:
 *   - R1-02: an AUTO Employee's Work Item without a Reasoning Demand (a general item, a CEO brief) starts at
 *     min(default, E2) and never runs E3 / E4; MANUAL keeps its exact class;
 *   - R1-01: a call in flight when the runtime stops is never re-sent after the restart: the reply waits for the Founder's
 *     reconciliation with its money held, and no further call or reservation happens.
 */
describe('P1-AUTO-E12-01 Correction R1: AUTO without a demand; no unapproved paid replay across a restart', () => {
  const FINAL = (): DeepSeekResponse => fakeChatAnswer(JSON.stringify({ type: 'FINAL', summaryCode: 'done' }), { prompt: 300, completion: 10 });
  const kinds = (rt: CompanyRuntime, id: Id): string[] => rt.view.runsForWorkItem(id).flatMap((r) => rt.governance.reservations(r.id)).map((r) => r.attemptKind);
  const general = (rt: CompanyRuntime, w: C2World, ceo: EmployeeRecord, instructions: string): Id => {
    const { workItem } = rt.submitWorkItem({ objective: 'general work', ownerRef: ceo.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'founder.reply', dataClass: 'D2', maxOutputTokens: 512, instructions } });
    rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 500_000, capTokens: 200_000, reasonCode: 'seed' });
    rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
    return workItem.id;
  };

  test('R1-02 · an AUTO Employee with default E3: a general Work Item and a CEO brief without a demand run at E2 (company policy), never E3 / E4; an invalid E2 output ends MODEL_OUTPUT_INVALID after one call; a Founder E3 still runs exactly E3', () =>
    withWorld('p1r1-no-demand', { ceiling: 'E4', reasoningProfile: true }, (request) => {
      const text = JSON.stringify(request.body);
      if (text.includes('Return garbage')) return fakeChatAnswer('not json', { prompt: 300, completion: 20 });
      if (text.includes('Answer the general task')) return FINAL();
      return ok('Answer.');
    }, async ({ rt, w, ceo, sent }) => {
      const e = rt.governance.getEmployee(ceo.id);
      rt.governance.changeReasoningProfile(w.founder, e.id, { defaultClass: 'E3', ceilingClass: 'E4', expectedVersion: e.version, reasonCode: 'founder.reasoning_profile' });
      assert.equal(rt.governance.getEmployee(ceo.id).cognitiveProfile.selection, 'AUTO');
      // A general Employee Work Item, created (and queued) with no demand: what any older queued AUTO item looks like.
      const task = general(rt, w, ceo, 'Answer the general task.');
      assert.equal(await settled(rt, task), 'COMPLETED');
      assert.deepEqual([sent.map((s) => s.effort), reservedClasses(rt, task)], [['low'], ['E2']], 'min(default E3, E2) = E2: thinking low');
      assert.deepEqual(audits(rt, task, 'run.reasoning_selected').map((a) => [a.mode, a.startClass, a.idealClass, a.constraint, a.autoCap]), [['AUTO', 'E2', null, 'AUTO_POLICY_CAP', 'E2']], 'no demand: no estimate is recorded, only the policy that held the default');
      // An invalid output at E2: one call, MODEL_OUTPUT_INVALID — never escalated to E3, never replayed.
      const garbage = general(rt, w, ceo, 'Return garbage.');
      assert.equal(await settled(rt, garbage), 'FAILED');
      assert.deepEqual([rt.view.runsForWorkItem(garbage).at(-1)?.failureCode, kinds(rt, garbage), reservedClasses(rt, garbage)], ['MODEL_OUTPUT_INVALID', ['PRIMARY'], ['E2']]);
      // A CEO brief (the CEO seat holder's governed run), with no demand.
      const brief = rt.founder.communications.requestCeoBrief({ subject: 'brief', contextKind: 'APPROVAL', contextRef: 'approval:1', reasonCode: 'brief.test', instructions: 'Brief the Founder.', taskClass: 'founder.reply' });
      await settled(rt, brief.workItemId);
      assert.ok(reservedClasses(rt, brief.workItemId).length >= 1, 'the brief ran');
      assert.ok(reservedClasses(rt, brief.workItemId).every((c) => c === 'E1' || c === 'E2'), `never E3 / E4 (${reservedClasses(rt, brief.workItemId).join(',')})`);
      assert.ok(sent.every((s) => s.effort === undefined || s.effort === 'low'), 'no AUTO call ran with thinking high or max');
      // MANUAL is not AUTO: the Founder's E3 is kept exactly.
      const before = sent.length;
      const manual = ask(rt, w, 'Thanks.', 'E3');
      assert.equal(await settled(rt, manual), 'COMPLETED');
      assert.deepEqual(sent.slice(before).map((s) => s.effort), ['high']);
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('R1-01 · a call in flight when the runtime stops is never re-sent after the restart: the reply is held for the Founder\'s reconciliation, its money stays held, and no further call or reservation happens', () =>
    withWorld('p1r1-restart', { reasoningProfile: true }, () => new Promise<DeepSeekResponse>(() => undefined), async ({ w, sent, rt, restart }) => {
      const id = ask(rt, w, 'Thanks, got it.');
      await eventually(() => sent.length === 1, 10_000, 'the call to be sent');
      const after = await restart();
      assert.equal(await settled(after, id, 30_000), 'BLOCKED');
      assert.equal(after.view.jobsFor(id)[0]?.state, 'RECONCILIATION_HOLD', 'held for reconciliation, not resumed or retried');
      const reservations = (): unknown[] => after.view.runsForWorkItem(id).flatMap((r) => after.governance.reservations(r.id)).map((r) => [r.attemptKind, r.state, r.money]);
      const held = reservations();
      assert.deepEqual(held.map((r) => (r as unknown[]).slice(0, 2)), [['PRIMARY', 'RECONCILIATION_REQUIRED']], 'one reservation, held');
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(sent.length, 1, 'no call after the restart');
      assert.deepEqual(reservations(), held, 'no new reservation, the held money untouched');
      assert.deepEqual([replyState(after, w, id).status, replyState(after, w, id).reasonCode], ['BLOCKED', 'RECONCILIATION_REQUIRED']);
      assert.equal(after.governance.accountingInvariants().length, 0);
    }));
});
