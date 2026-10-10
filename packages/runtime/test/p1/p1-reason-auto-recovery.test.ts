/**
 * P1-REASON-AUTO-RECOVERY-01 — reliable replies and company-wide Adaptive Intelligence, proven through the REAL governed
 * runtime and the REAL DeepSeek adapter behind a deterministic fake transport (no network, no credential, no paid call).
 * The Company is provisioned as the LIVE one (the Academy profile, E1 / E2), optionally extended by the additive E3 / E4
 * conversation profile. Proves:
 *   - B1: an escalated call gets the allowance of the class it routes at, and its worst case is reserved for that allowance;
 *   - B2: `finish_reason=length` is never a reply (one bounded same-class continuation, then MODEL_OUTPUT_TRUNCATED); a
 *     MALFORMED message records its closed sub-reason; every call leaves one content-free observation;
 *   - B3: an open circuit is a durable timed wait (no attempt spent, no brief, survives a restart), then the reply lands;
 *   - C1–C4: AUTO starts at the sufficient class (E1 for routine, E3 / E4 for strategy when provisioned and permitted),
 *     a Founder level is pinned (never raised), an Academy method pin is never overridden, missing E3 / E4 are never used,
 *     the budget still parks the work before any call.
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

import { employeeTaskProcessor, type CompanyRuntime } from '../../src/index.js';
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

async function withWorld(label: string, o: Options, chat: (request: DeepSeekRequest, n: number, maxTokens: number) => DeepSeekResponse, fn: (x: World) => Promise<void>): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const ceo = seed(root, w, o);
  const sent: Sent[] = [];
  const clock = new OffsetClock();
  const transport = new FakeDeepSeekTransport().respondWith((request) => {
    if (request.path === DEEPSEEK_MODELS_PATH) return fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: 'DeepSeek-V4.1-Flash' }]);
    const body = request.body as { thinking: unknown; reasoning_effort?: unknown; max_tokens: number };
    sent.push({ thinking: body.thinking, effort: body.reasoning_effort, maxTokens: body.max_tokens });
    return chat(request, sent.length, body.max_tokens);
  });
  const make = (): CompanyRuntime => {
    const adapter = new DeepSeekProviderAdapter({ vault: new InMemorySecretVault().set('deepseek-company', KEY), transport, now: () => clock.nowMs() });
    return runtimeFor(root, { clock, processors: [employeeTaskProcessor], governance: { providers: [adapter], provisioningProfiles: [DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DEEPSEEK_V41_FLASH_REASONING_PROFILE], modelCallTimeoutMs: 5_000 } });
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
  test('4–6, 14 · AUTO starts at the sufficient class: routine and long routine at E1, strategy at E3, a full regional plan at E4 — once E3 / E4 are provisioned and the ceiling permits; no escalation was needed', () =>
    withWorld('p1r-auto', { ceiling: 'E4', reasoningProfile: true }, () => ok(), async ({ rt, w, sent, ceo }) => {
      assert.equal(rt.governance.getEmployee(ceo.id).cognitiveProfile.selection, 'AUTO', 'a newly created Employee selects with AUTO');
      const cases: [string, ReasoningClass][] = [
        ['Thanks, got it.', 'E1'],
        ['Quick update for your records: I archived the old threads, renamed the shared folders, updated the meeting notes, confirmed the room booking for Thursday, refilled the stationery order and sent the reminder about the font files. Everything is done for today. Thanks.', 'E1'],
        ['Compare entering the Saudi and Egyptian markets and recommend which to launch first.', 'E3'],
        ['Prepare a three-year go-to-market strategy for launching QANDEEL across the GCC. Compare the pricing options, recommend the budget split, and tell me which roles we must hire first.', 'E4'],
      ];
      for (const [body, want] of cases) {
        const id = ask(rt, w, body);
        assert.equal(await settled(rt, id), 'COMPLETED');
        const s = replyState(rt, w, id);
        assert.deepEqual([s.selection.mode, s.selection.startClass, s.selection.idealClass, s.selection.constraint, s.answeredClasses], ['AUTO', want, want, null, [want]], body.slice(0, 40));
        assert.ok(s.selection.reasons.length > 0, 'content-free reason codes support the choice');
      }
      assert.deepEqual(sent.map((s) => s.maxTokens), [2048, 2048, 8192, 16384], 'each call has its own class allowance');
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
