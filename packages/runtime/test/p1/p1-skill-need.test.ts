/**
 * G4-C2-SNA-01 (D-P1-15) — Skill Need Assessment through the REAL governed runtime and the REAL DeepSeek adapter behind a
 * deterministic fake transport (no network, no credential, no paid call). The Company is provisioned as the LIVE one (the
 * Academy profile) plus the additive Skill-need profile; the CEO holds the six CEO Skills. Proves:
 *   - one assessment per Founder message, run before the reply, at E1 (thinking off) with a 256 allowance, under its own task
 *     class, Work Item, run, manifest and reservation — whatever level the Founder chose for the reply — and never one of
 *     the reply's three calls (the reply's AUTO E1 → E2 recovery and D1's AUTO E2 8,192 are unchanged);
 *   - the reply plans with the classification (TASK_REQUIRED selected, NON_RELEVANT never a candidate payload);
 *   - an invalid answer, a provider failure, a timeout (money held, never a reconciliation brief) or a budget refusal ends the
 *     assessment with a recorded fallback and the reply still lands, with every eligible Skill SUPPORTING;
 *   - a restart keeps the order durable; the Skill-need profile adds one E1 deployment and one route policy only;
 *   - logs and records stay content-free;
 *   - G4-C2-TEMP-01: every assessment call (a retry included) sends temperature 0 with thinking off; no reply call, at any
 *     level (E1 included), carries a temperature field;
 *   - G4-C2-REASONING-GATE-01 (the isolated E2 DEV pilot): an assessment pinned at E2 under a DEV-only pilot profile sends
 *     thinking low with the E2 allowance and no temperature, reserves and settles within its Work Item cap, never stores or
 *     logs the thinking text, falls back on an exhausted allowance or a timeout, leaves the reply's calls unchanged — and
 *     under the production Skill-need profile (E1 only) an E2 pin makes no call at all.
 * P1-PROOF: skill-need
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import type { Clock, Id } from '@qandeel-company/domain';
import { OUTPUT_ALLOWANCE_BY_CLASS, SKILL_NEED_CAP, SKILL_NEED_PREAMBLE, SKILL_NEED_TASK_CLASS, type ProviderProvisioningProfile, type ReasoningClass } from '@qandeel-company/governance';
import { SKILL_NEED_CARDS } from '@qandeel-company/mind';
import { DEEPSEEK_CLASS_LIMITS, DEEPSEEK_MODELS_PATH, DEEPSEEK_MODEL_CODE, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DEEPSEEK_V41_FLASH_SKILL_NEED_PROFILE, DeepSeekProviderAdapter, FakeDeepSeekTransport, fakeChatAnswer, fakeModelsAnswer, type DeepSeekRequest, type DeepSeekResponse } from '@qandeel-company/model-providers';
import { InMemorySecretVault } from '@qandeel-company/secret-vault';
import { CHAT_REPLY_AUTO_OUTPUT_TOKENS, CHAT_REPLY_OUTPUT_TOKENS, CompanyStore, GovernanceStore, OrganizationStore, SkillStore, type EmployeeRecord } from '@qandeel-company/storage';
import { activateEmployeeForTest } from '@qandeel-company/storage/testing';

import { Logger, employeeTaskProcessor, skillNeedAssessmentProcessor, skillNeedAssessmentProcessorAt, type CompanyRuntime, type SkillNeedCallLevel } from '../../src/index.js';
import { eventually, removeRoot, runtimeFor, tempRoot } from '../helpers.js';
import { nextName, seedWorld, type C2World } from '../c2/c2-seed.js';

const KEY = 'vault-proof-' + 'Sn4Tq2Wm9Xz4Lb6Nc1Pv8Hs3';
const CEO_SKILLS = Object.keys(SKILL_NEED_CARDS);
const PAYLOAD = (code: string): string => `PAYLOAD-${code}: synthetic certified guidance for ${code.replace(/[.-]/g, ' ')}; state the decision, the evidence and the owner.`;
const message = (body: string): string => JSON.stringify({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body, brief: null, contextRefs: [] });
const replyOk = (body = 'Done.'): DeepSeekResponse => fakeChatAnswer(message(body), { prompt: 900, completion: 40 });
const skillNeed = (tiers: Record<string, string>): DeepSeekResponse => fakeChatAnswer(JSON.stringify({ type: 'SKILL_NEED', skills: Object.entries(tiers).map(([code, tier]) => ({ code, tier })) }), { prompt: 2_600, completion: 70 });
const tiersWith = (over: Record<string, string>): Record<string, string> => Object.fromEntries(CEO_SKILLS.map((c) => [c, over[c] ?? 'NON_RELEVANT']));
const transient = (): DeepSeekResponse => ({ status: 500, oversize: false, malformed: false, body: { error: { message: 'busy' } } });

class OffsetClock implements Clock {
  offset = 0;
  nowMs(): number {
    return Date.now() + this.offset;
  }
}

interface Sent {
  readonly assessment: boolean;
  readonly thinking: unknown;
  /** The wire `reasoning_effort`, or ABSENT. */
  readonly effort: unknown;
  /** G4-C2-TEMP-01: the wire `temperature`, or ABSENT when the body carries no such field. */
  readonly temperature: unknown;
  readonly maxTokens: number;
  readonly text: string;
}
interface World {
  readonly root: string;
  readonly w: C2World;
  readonly ceo: EmployeeRecord;
  readonly rt: CompanyRuntime;
  readonly sent: Sent[];
  readonly logs: string[];
  readonly versions: Map<string, Id>;
  restart(): Promise<CompanyRuntime>;
}
interface Options {
  readonly ceiling?: ReasoningClass;
  readonly envelopeMoney?: number;
  /** false: the Skill-need profile is not provisioned (no route policy, no deployment for the task class). */
  readonly provision?: boolean;
  readonly callTimeoutMs?: number;
  /** The first runtime runs without the assessment processor (its job waits in the queue); a restart adds it. */
  readonly assessorAfterRestart?: boolean;
  /** G4-C2-REASONING-GATE-01: the class and allowance the assessment is pinned at (default: production E1 / 256). */
  readonly level?: SkillNeedCallLevel;
  /** G4-C2-REASONING-GATE-01: provision the DEV-only E2 pilot profile INSTEAD of the production Skill-need profile. */
  readonly e2Pilot?: boolean;
}

/**
 * G4-C2-REASONING-GATE-01: the DEV-only E2 pilot profile (the same shape the paid harness provisions in its disposable
 * workspace; never a release profile): one E2 deployment qualified for the assessment class only, and the production route
 * policy with E2 as both its minimum and maximum. Everything else is the production Skill-need profile's.
 */
const E2_PILOT_PROFILE: ProviderProvisioningProfile = (() => {
  const p = DEEPSEEK_V41_FLASH_SKILL_NEED_PROFILE;
  const d = p.deployments[0] as ProviderProvisioningProfile['deployments'][number];
  const r = p.routePolicies[0] as ProviderProvisioningProfile['routePolicies'][number];
  return Object.freeze({
    ...p,
    code: 'deepseek-v4-1-flash-skill-need-e2-pilot',
    deployments: Object.freeze([Object.freeze({ ...d, code: 'deepseek-flash-e2-skill-need-pilot', reasoningClass: 'E2' as const, contextWindowTokens: DEEPSEEK_CLASS_LIMITS.E2.contextWindowTokens, maxOutputTokens: DEEPSEEK_CLASS_LIMITS.E2.maxOutputTokens })]),
    routePolicies: Object.freeze([Object.freeze({ taskClass: r.taskClass, body: Object.freeze({ ...r.body, minClass: 'E2' as const, maxClass: 'E2' as const }) })]),
  });
})();
const E2_LEVEL: SkillNeedCallLevel = { reasoningClass: 'E2', maxOutputTokens: OUTPUT_ALLOWANCE_BY_CLASS.E2 };

/** The CEO, its six approved CEO Skills (synthetic text), the Academy profile and (by default) the Skill-need profile. */
function seed(root: string, w: C2World, o: Options): { ceo: EmployeeRecord; versions: Map<string, Id> } {
  const store = CompanyStore.open(root);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const seat = org.positionByCode('company.ceo');
    if (!seat) throw new Error('the CEO seat is release-seeded');
    const e = gov.createEmployee(w.founder, { name: nextName(), profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: o.ceiling ?? 'E2', costDiscipline: 'BALANCED', selection: 'AUTO' }, roleRef: seat.roleRef, positionRef: 'position:p1', departmentId: w.departmentId, managerRef: w.founder });
    gov.transitionEmployee(w.founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(w.founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, w.founder, e.id);
    gov.createBudget(w.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: o.envelopeMoney ?? 2_000_000, capTokens: 2_000_000, reasonCode: 'seed' });
    // Explicit, task-class-scoped model access (never a wildcard): the reply's class and, separately, the assessment's.
    for (const c of ['founder.reply', 'founder.brief', SKILL_NEED_TASK_CLASS]) gov.grant(w.founder, { employeeId: e.id, capability: 'model.invoke', resourceScope: c, riskCeiling: 'R0', dataClassCeiling: 'D2', reasonCode: 'seed' });
    org.assignPrimary(w.founder, { positionId: seat.id, employeeId: e.id, reasonCode: 'placed' });
    gov.recordModelIdentityCheck({ providerCode: 'deepseek', modelCode: DEEPSEEK_MODEL_CODE, expectedName: 'DeepSeek-V4.1-Flash', observedName: 'DeepSeek-V4.1-Flash', result: 'MATCH' });
    gov.provisionProviderProfile(w.founder, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, { capMoney: 5_000_000, capTokens: 50_000_000, reasonCode: 'l1.activation' });
    if (o.provision !== false) gov.provisionProviderProfile(w.founder, o.e2Pilot === true ? E2_PILOT_PROFILE : DEEPSEEK_V41_FLASH_SKILL_NEED_PROFILE, { capMoney: 0, capTokens: 0, reasonCode: 'p1.skill_need' });
    const reg = SkillStore.for(store);
    const versions = new Map<string, Id>();
    for (const code of CEO_SKILLS) {
      const skill = reg.registerSkill(w.founder, { code, name: `Skill ${code}`, skillType: 'QANDEEL_NATIVE', ownerRef: 'department:growth' });
      let v = reg.registerSkillVersion(w.founder, { skillId: skill.id, versionLabel: '1.0.0', sourceRef: `qandeel:${code}`, sourceRevision: 'r1', authorRef: 'department:growth', licenseSpdx: null, dependencies: [], instructions: PAYLOAD(code) });
      v = reg.checkLicenseAndDependencies(reg.inspectSkillVersion(v.id).id);
      for (const [to, extra] of [['SECURITY_QUARANTINE', {}], ['SANDBOXED', { evidenceRef: 'review:s1', securityPassed: true }], ['BENCHMARKED', { evidenceRef: 'benchmark:b1' }], ['COMPARED', {}], ['APPROVED', {}]] as const) v = reg.advanceSkillVersion(w.founder, v.id, to, { reasonCode: 'step', ...extra });
      reg.openPassportEntry(w.founder, e.id, v.id);
      versions.set(code, v.id as Id);
    }
    return { ceo: gov.getEmployee(e.id), versions };
  } finally {
    store.close();
  }
}

type Chat = (request: DeepSeekRequest, assessment: boolean, n: number) => DeepSeekResponse | Promise<DeepSeekResponse>;
const textOf = (request: DeepSeekRequest): string => ((request.body as { messages?: { content: string }[] }).messages ?? []).map((m) => m.content).join('\n');

async function withWorld(label: string, o: Options, chat: Chat, fn: (x: World) => Promise<void>): Promise<void> {
  const root = tempRoot(label);
  const w = seedWorld(root);
  const { ceo, versions } = seed(root, w, o);
  const sent: Sent[] = [];
  const logs: string[] = [];
  const clock = new OffsetClock();
  const transport = new FakeDeepSeekTransport().respondWith((request) => {
    if (request.path === DEEPSEEK_MODELS_PATH) return fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: 'DeepSeek-V4.1-Flash' }]);
    const body = request.body as { thinking: unknown; reasoning_effort?: unknown; max_tokens: number; temperature?: unknown };
    const text = textOf(request);
    const assessment = text.includes(SKILL_NEED_PREAMBLE.split('\n')[0] as string);
    sent.push({ assessment, thinking: body.thinking, effort: body.reasoning_effort ?? 'ABSENT', temperature: 'temperature' in body ? body.temperature : 'ABSENT', maxTokens: body.max_tokens, text });
    return chat(request, assessment, sent.filter((s) => s.assessment === assessment).length) as DeepSeekResponse;
  });
  let starts = 0;
  const make = (): CompanyRuntime => {
    const adapter = new DeepSeekProviderAdapter({ vault: new InMemorySecretVault().set('deepseek-company', KEY), transport, now: () => clock.nowMs() });
    const assessor = o.assessorAfterRestart === true && starts++ === 0 ? [] : [o.level ? skillNeedAssessmentProcessorAt(o.level) : skillNeedAssessmentProcessor];
    return runtimeFor(root, { clock, processors: [employeeTaskProcessor, ...assessor], logger: new Logger((r) => logs.push(JSON.stringify(r))), governance: { providers: [adapter], provisioningProfiles: [DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, o.e2Pilot === true ? E2_PILOT_PROFILE : DEEPSEEK_V41_FLASH_SKILL_NEED_PROFILE], modelCallTimeoutMs: o.callTimeoutMs ?? 5_000 } });
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
    await fn({ root, w, ceo, rt, sent, logs, versions, restart });
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

const state = (rt: CompanyRuntime, id: Id): string => rt.view.getWorkItem(id).state;
const settled = (rt: CompanyRuntime, id: Id, within = 15_000): Promise<string> => eventually(() => (['COMPLETED', 'FAILED', 'WAITING', 'BLOCKED', 'CANCELLED'].includes(state(rt, id)) ? state(rt, id) : undefined), within, `work item ${id}`);
const ask = (rt: CompanyRuntime, w: C2World, body: string, reasoningClass?: ReasoningClass): Id => {
  const comm = rt.founder.communications;
  return comm.send(w.founder, comm.directThread(w.founder, null).id, { purpose: 'QUESTION', body, ...(reasoningClass ? { reasoningClass } : {}) }).replyWorkItemId as Id;
};
const decision = (rt: CompanyRuntime, reply: Id) => rt.mind.skillNeed.forReply(reply);
const assessment = (rt: CompanyRuntime, reply: Id): Id => rt.mind.skillNeed.assessmentOf(reply) as Id;
const reservationsOf = (rt: CompanyRuntime, id: Id) => rt.view.runsForWorkItem(id).flatMap((r) => rt.governance.reservations(r.id)).filter((r) => r.purpose === 'MODEL_CALL');
const replyManifestSkills = (rt: CompanyRuntime, reply: Id, versions: Map<string, Id>): Record<string, string> => {
  const byId = new Map([...versions].map(([c, id]) => [id as string, c]));
  const mem = rt.mind.memory;
  const m = mem.manifestsFor(reply)[0];
  if (!m) return {};
  return Object.fromEntries(mem.manifestEntries(m.id).filter((e) => e.itemKind === 'SKILL' && byId.has(e.itemId)).map((e) => [byId.get(e.itemId) as string, e.decision === 'SELECTED' ? 'SELECTED' : String(e.reasonCode)]));
};

const ORG = 'SYNTHETIC: يا أحمد، مين المفروض يمسك ملف الإطلاق؟ محدش ماسكه لحد دلوقتي.';

describe('G4-C2-SNA-01: the assessment runs first, at E1, outside the reply', () => {
  test('one E1 call (thinking off, 256) under its own class and Work Item, then the reply plans with its tiers; a Founder E2 level never reaches the assessment', () =>
    withWorld('sna-happy', {}, (_r, a) => (a ? skillNeed(tiersWith({ 'ceo.organization-leadership': 'TASK_REQUIRED', 'ceo.founder-partnership': 'SUPPORTING' })) : replyOk('Owner named.')), async ({ rt, w, sent, versions, logs }) => {
      const reply = ask(rt, w, ORG, 'E2');
      assert.equal(await settled(rt, reply), 'COMPLETED');
      assert.deepEqual(sent.map((s) => s.assessment), [true, false], 'the assessment call comes first, then the reply');
      const [a, r] = sent;
      assert.deepEqual([a?.thinking, a?.maxTokens], [{ type: 'disabled' }, 256], 'E1, no thinking, the 256 allowance');
      assert.equal(a?.temperature, 0, 'G4-C2-TEMP-01: the assessment sends temperature 0, explicitly');
      assert.deepEqual(r?.thinking, { type: 'enabled' }, 'the reply keeps the Founder\'s E2');
      assert.equal(r?.temperature, 'ABSENT', 'the reply keeps the provider default (no temperature field)');
      for (const c of CEO_SKILLS) assert.equal(a?.text.includes(`PAYLOAD-${c}`), false, 'the assessment never reads a Skill payload');
      const sna = assessment(rt, reply);
      assert.equal(state(rt, sna), 'COMPLETED');
      const d = decision(rt, reply);
      assert.deepEqual([d?.source, d?.outcome, d?.sealedBy, d?.assessmentWorkItemId], ['MODEL', 'CLASSIFIED', 'ASSESSMENT', sna]);
      // Separate money and calls: the assessment's one reservation is on its own Work Item, under its own deployment.
      const snaRes = reservationsOf(rt, sna);
      assert.equal(snaRes.length, 1);
      assert.equal(rt.governance.deployment(snaRes[0]?.deploymentId as Id).code, 'deepseek-flash-e1-skill-need');
      assert.deepEqual(reservationsOf(rt, reply).map((x) => rt.governance.deployment(x.deploymentId as Id).reasoningClass), ['E2'], 'the reply\'s calls are its own (none spent by the assessment)');
      const skills = replyManifestSkills(rt, reply, versions);
      assert.equal(skills['ceo.organization-leadership'], 'SELECTED');
      assert.equal(skills['ceo.founder-partnership'], 'SELECTED');
      for (const c of ['ceo.governance-discipline', 'ceo.executive-judgment', 'ceo.evidence-and-economics', 'ceo.cross-functional-synthesis']) assert.equal(skills[c], 'NOT_RELEVANT', c);
      assert.ok(r?.text.includes('PAYLOAD-ceo.organization-leadership') && !r.text.includes('PAYLOAD-ceo.executive-judgment'), 'the reply carries exactly the selected payloads');
      const joined = logs.join('\n');
      assert.equal(joined.includes('مين المفروض'), false, 'no message text in the logs');
      assert.equal(joined.includes('TASK_REQUIRED when'), false, 'no card text in the logs');
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('AUTO: a routine reply keeps its own E1 → E2 repair (two of its own calls); the assessment stays one E1 call', () =>
    withWorld('sna-auto-repair', {}, (_r, a, n) => (a ? skillNeed(tiersWith({ 'ceo.founder-partnership': 'SUPPORTING' })) : n === 1 ? fakeChatAnswer('{"type":"MESSAGE"', { prompt: 900, completion: 20 }) : replyOk('Noted.')), async ({ rt, w, sent }) => {
      const reply = ask(rt, w, 'Thanks, got it.');
      assert.equal(await settled(rt, reply), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.assessment, s.maxTokens]), [[true, 256], [false, CHAT_REPLY_OUTPUT_TOKENS.E1], [false, CHAT_REPLY_AUTO_OUTPUT_TOKENS.E2]], 'the assessment, then the reply\'s E1 call and its E2 repair');
      assert.deepEqual(sent.map((s) => [s.thinking, s.temperature]), [[{ type: 'disabled' }, 0], [{ type: 'disabled' }, 'ABSENT'], [{ type: 'enabled' }, 'ABSENT']], 'G4-C2-TEMP-01: temperature 0 is the task class\'s, not E1\'s: the reply\'s own E1 call keeps the default');
      assert.deepEqual(reservationsOf(rt, reply).map((x) => x.attemptKind), ['PRIMARY', 'ESCALATION'], 'the reply\'s calls are its own');
      assert.equal(reservationsOf(rt, assessment(rt, reply)).length, 1);
    }));

  test('AUTO: a strategic reply still starts at E2 with D1\'s 8,192 allowance; the assessment is E1 / 256', () =>
    withWorld('sna-auto-e2', {}, (_r, a) => (a ? skillNeed(tiersWith({ 'ceo.executive-judgment': 'TASK_REQUIRED' })) : replyOk('Keep the date.')), async ({ rt, w, sent }) => {
      const reply = ask(rt, w, 'SYNTHETIC: Should we delay the launch two weeks to fix onboarding, or keep the date? Think it through.');
      assert.equal(await settled(rt, reply), 'COMPLETED');
      assert.deepEqual(sent.map((s) => [s.assessment, s.thinking, s.temperature, s.maxTokens]), [[true, { type: 'disabled' }, 0, 256], [false, { type: 'enabled' }, 'ABSENT', CHAT_REPLY_AUTO_OUTPUT_TOKENS.E2]]);
    }));
});

describe('G4-C2-SNA-01: every failure ends in a recorded fallback and the reply still lands', () => {
  test('an answer that names an unknown Skill: OUTPUT_INVALID, the assessment FAILED (not blocked), all six SUPPORTING in the reply', () =>
    withWorld('sna-invalid', {}, (_r, a) => (a ? skillNeed({ ...tiersWith({}), 'market.research': 'TASK_REQUIRED' }) : replyOk()), async ({ rt, w, versions }) => {
      const reply = ask(rt, w, ORG);
      assert.equal(await settled(rt, reply), 'COMPLETED');
      assert.equal(state(rt, assessment(rt, reply)), 'FAILED');
      assert.deepEqual([decision(rt, reply)?.source, decision(rt, reply)?.outcome], ['FALLBACK', 'OUTPUT_INVALID']);
      const skills = replyManifestSkills(rt, reply, versions);
      assert.deepEqual(Object.keys(skills).sort(), [...CEO_SKILLS].sort());
      assert.equal(Object.values(skills).includes('NOT_RELEVANT'), false, 'the fallback drops no eligible Skill as not relevant');
    }));

  test('a prose answer (not JSON) is never executed: OUTPUT_INVALID', () =>
    withWorld('sna-prose', {}, (_r, a) => (a ? fakeChatAnswer('The CEO needs organization leadership.', { prompt: 2_600, completion: 12 }) : replyOk()), async ({ rt, w }) => {
      const reply = ask(rt, w, ORG);
      assert.equal(await settled(rt, reply), 'COMPLETED');
      assert.equal(decision(rt, reply)?.outcome, 'OUTPUT_INVALID');
    }));

  test('a provider that keeps failing: at most one unbilled retry, then PROVIDER_FAILED / UNAVAILABLE; the reply lands', () =>
    withWorld('sna-500', {}, (_r, a) => (a ? transient() : replyOk()), async ({ rt, w, sent }) => {
      const reply = ask(rt, w, ORG);
      assert.equal(await settled(rt, reply), 'COMPLETED');
      assert.ok(sent.filter((s) => s.assessment).length <= 2, 'never more than the route policy\'s two attempts');
      assert.deepEqual([...new Set(sent.map((s) => `${s.assessment}:${String(s.temperature)}`))].sort(), ['false:ABSENT', 'true:0'], 'G4-C2-TEMP-01: the retry keeps temperature 0; the reply keeps the default');
      assert.ok(['PROVIDER_FAILED', 'PROVIDER_UNAVAILABLE'].includes(String(decision(rt, reply)?.outcome)), String(decision(rt, reply)?.outcome));
      assert.equal(state(rt, assessment(rt, reply)), 'FAILED');
    }));

  test('a call that outlives its timeout: the money is held (never re-sent), PROVIDER_UNCERTAIN, the assessment FAILED (never a reconciliation brief); the reply lands at once', () =>
    withWorld('sna-timeout', { callTimeoutMs: 1_500 }, (_r, a) => (a ? new Promise<DeepSeekResponse>(() => undefined) : replyOk()), async ({ rt, w, sent }) => {
      const reply = ask(rt, w, ORG);
      assert.equal(await settled(rt, reply, 20_000), 'COMPLETED');
      assert.equal(sent.filter((s) => s.assessment).length, 1, 'never re-sent');
      const sna = assessment(rt, reply);
      assert.equal(decision(rt, reply)?.outcome, 'PROVIDER_UNCERTAIN');
      assert.equal(state(rt, sna), 'FAILED', 'not BLOCKED: no reconciliation hold, no brief');
      assert.deepEqual(reservationsOf(rt, sna).map((x) => x.state), ['RECONCILIATION_REQUIRED'], 'the possibly billed call stays held for the Founder\'s reconciliation');
    }));

  test('an envelope that cannot hold the assessment\'s worst case: BUDGET_REFUSED before any call', () =>
    withWorld('sna-budget', { envelopeMoney: 3_000 }, (_r, a) => (a ? skillNeed(tiersWith({})) : replyOk()), async ({ rt, w, sent }) => {
      const reply = ask(rt, w, ORG);
      await eventually(() => decision(rt, reply) ?? undefined, 15_000, 'the decision');
      assert.equal(decision(rt, reply)?.outcome, 'BUDGET_REFUSED');
      assert.equal(sent.filter((s) => s.assessment).length, 0, 'nothing was sent');
    }));

  test('not provisioned (no Skill-need route policy): no assessment, NOT_PROVISIONED, the reply is due at once', () =>
    withWorld('sna-np', { provision: false }, () => replyOk(), async ({ rt, w, sent }) => {
      const reply = ask(rt, w, ORG);
      assert.equal(await settled(rt, reply), 'COMPLETED');
      assert.equal(assessment(rt, reply), null);
      assert.deepEqual([decision(rt, reply)?.outcome, decision(rt, reply)?.sealedBy], ['NOT_PROVISIONED', 'SEND']);
      assert.deepEqual(sent.map((s) => s.assessment), [false]);
    }));
});

describe('G4-C2-SNA-01: durable across a restart', () => {
  test('the reply never starts before its assessment: with no assessor running it waits (no worker held); after the restart the assessment runs first and the reply follows', () =>
    withWorld('sna-restart', { assessorAfterRestart: true }, (_r, a) => (a ? skillNeed(tiersWith({ 'ceo.organization-leadership': 'TASK_REQUIRED' })) : replyOk()), async ({ rt, w, sent, restart }) => {
      const reply = ask(rt, w, ORG);
      // Nothing runs: the assessment has no processor yet and the reply's job is not due before its window.
      await new Promise((r) => setTimeout(r, 1_500));
      assert.equal(sent.length, 0);
      assert.equal(rt.view.jobsFor(reply)[0]?.state, 'QUEUED');
      assert.equal(rt.view.runsForWorkItem(reply).length, 0, 'no worker waited on the reply');
      const again = await restart();
      assert.equal(await settled(again, reply), 'COMPLETED');
      assert.deepEqual(sent.map((s) => s.assessment), [true, false]);
      assert.equal(decision(again, reply)?.outcome, 'CLASSIFIED');
    }));
});

describe('G4-FINAL-QUALITY-CORR-01 (WP3): the reserved assessment lane', () => {
  const occupy = (rt: CompanyRuntime, ceo: EmployeeRecord, n: number, stepMs: number): Id[] =>
    Array.from({ length: n }, () => rt.submitWorkItem({ objective: 'a long run holding a worker slot', ownerRef: ceo.ref, processorKind: 'c1.steps', processorInput: { steps: 1, stepMs }, initialState: 'READY' }).workItem.id);
  const running = (rt: CompanyRuntime, id: Id): boolean => rt.view.runsForWorkItem(id).some((r) => !r.endedAt);
  const lanes = (logs: string[]): { kind: string; lane: string }[] => logs.map((l) => JSON.parse(l) as { event?: string; kind?: string; lane?: string }).filter((r) => r.event === 'run.started').map((r) => ({ kind: r.kind ?? '', lane: r.lane ?? '' }));

  test('every ordinary slot busy with long work: the assessment still runs at once in the reserved slot, well inside its window; the reply waits for an ordinary slot (no worker held)', () =>
    withWorld('sna-lane', {}, (_r, a) => (a ? skillNeed(tiersWith({ 'ceo.organization-leadership': 'TASK_REQUIRED' })) : replyOk()), async ({ rt, w, ceo, logs }) => {
      const busy = occupy(rt, ceo, 2, 6_000);
      await eventually(() => (busy.every((id) => running(rt, id)) ? true : undefined), 5_000, 'both ordinary slots busy');
      const t0 = Date.now();
      const reply = ask(rt, w, ORG);
      await eventually(() => decision(rt, reply) ?? undefined, 5_000, 'the assessment decided while both slots are busy');
      assert.ok(Date.now() - t0 < 5_000, 'decided in seconds, not after the long runs');
      assert.equal(decision(rt, reply)?.outcome, 'CLASSIFIED');
      assert.ok(busy.every((id) => running(rt, id)), 'the long runs were never displaced');
      assert.equal(rt.view.runsForWorkItem(reply).length, 0, 'the reply has not started: it waits for an ordinary slot, holding none');
      assert.equal(await settled(rt, reply, 20_000), 'COMPLETED');
      assert.equal(decision(rt, reply)?.outcome, 'CLASSIFIED', 'the reply planned with the classification, not the window fallback');
      const started = lanes(logs);
      assert.deepEqual(started.filter((s) => s.lane === 'RESERVED').map((s) => s.kind), ['c2.skill-need-assessment'], 'only the assessment ever takes the reserved slot');
      assert.ok(started.filter((s) => s.kind === 'c1.steps' || s.kind === 'c2.employee-task').every((s) => s.lane === 'ORDINARY'));
      assert.ok(rt.diagnostics().maxObservedActive <= 3, 'at most the cap plus the one reserved slot');
    }));

  test('two assessments while every ordinary slot is busy: the reserved slot runs them one at a time; both decide inside the window', () =>
    withWorld('sna-lane-two', {}, (_r, a) => (a ? skillNeed(tiersWith({ 'ceo.evidence-and-economics': 'TASK_REQUIRED' })) : replyOk()), async ({ rt, w, ceo }) => {
      const busy = occupy(rt, ceo, 2, 8_000);
      await eventually(() => (busy.every((id) => running(rt, id)) ? true : undefined), 5_000, 'both ordinary slots busy');
      const r1 = ask(rt, w, 'SYNTHETIC: is the 49 SAR price worth it given the churn data?');
      const r2 = ask(rt, w, 'SYNTHETIC: هل التكلفة دي تستاهل؟');
      await eventually(() => (decision(rt, r1) && decision(rt, r2) ? true : undefined), 6_000, 'both decided');
      assert.deepEqual([decision(rt, r1)?.outcome, decision(rt, r2)?.outcome], ['CLASSIFIED', 'CLASSIFIED']);
      assert.ok(rt.diagnostics().maxObservedActive <= 3, 'never two reserved runs');
    }));
});

describe('G4-C2-SNA-01: the additive Skill-need profile', () => {
  test('one E1 deployment qualified for the assessment class only, its route policy (E1..E1, one retry, two calls, no escalation), D2 egress, no budget', () => {
    const p = DEEPSEEK_V41_FLASH_SKILL_NEED_PROFILE;
    assert.equal(p.extendsProvider, true);
    assert.deepEqual(p.deployments.map((d) => [d.code, d.reasoningClass, [...d.taskClasses]]), [['deepseek-flash-e1-skill-need', 'E1', [SKILL_NEED_TASK_CLASS]]]);
    assert.deepEqual(p.routePolicies.map((r) => [r.taskClass, r.body.minClass, r.body.maxClass, r.body.maxRetriesPerCall, r.body.maxCallsPerRun, r.body.escalation.maxDepth]), [[SKILL_NEED_TASK_CLASS, 'E1', 'E1', 1, 2, 0]]);
    assert.equal(p.egressMaxDataClass, 'D2');
    assert.equal(p.deployments.some((d) => d.taskClasses.includes('founder.reply')), false, 'never founder.reply');
  });
});

describe('G4-C2-REASONING-GATE-01: the isolated E2 pilot (DEV only; production stays E1)', () => {
  const THOUGHT = 'CANARY-THINKING-7Qx: the deliverable is a named owner';
  const thinkingAnswer = (content: string, completion: number, finish = 'stop'): DeepSeekResponse =>
    fakeChatAnswer(content, { prompt: 2_600, completion }, { choices: [{ index: 0, message: { role: 'assistant', content, reasoning_content: THOUGHT }, finish_reason: finish }] });
  const need = (tiers: Record<string, string>): string => JSON.stringify({ type: 'SKILL_NEED', skills: Object.entries(tiers).map(([code, tier]) => ({ code, tier })) });

  test('E2 pinned under the pilot profile: thinking low with the E2 allowance and no temperature; one reservation within the Work Item cap, settled; the thinking text is never stored or logged; the reply\'s calls are unchanged', () =>
    withWorld('sna-e2-pilot', { e2Pilot: true, level: E2_LEVEL }, (_r, a) => (a ? thinkingAnswer(need(tiersWith({ 'ceo.organization-leadership': 'TASK_REQUIRED' })), 900) : replyOk('Owner named.')), async ({ root, rt, w, sent, logs, versions }) => {
      const reply = ask(rt, w, ORG);
      assert.equal(await settled(rt, reply), 'COMPLETED');
      assert.deepEqual(sent.map((s) => s.assessment), [true, false]);
      const [a, r] = sent;
      assert.deepEqual([a?.thinking, a?.effort, a?.temperature, a?.maxTokens], [{ type: 'enabled' }, 'low', 'ABSENT', OUTPUT_ALLOWANCE_BY_CLASS.E2], 'E2 = thinking low, the E2 allowance, no sampling field');
      assert.deepEqual([r?.thinking, r?.effort, r?.temperature], [{ type: 'disabled' }, 'ABSENT', 'ABSENT'], 'the reply keeps its own AUTO E1 and the provider default');
      const sna = assessment(rt, reply);
      assert.deepEqual([decision(rt, reply)?.source, decision(rt, reply)?.outcome], ['MODEL', 'CLASSIFIED']);
      const res = reservationsOf(rt, sna);
      assert.equal(res.length, 1);
      const dep = rt.governance.deployment(res[0]?.deploymentId as Id);
      assert.deepEqual([dep.code, dep.reasoningClass], ['deepseek-flash-e2-skill-need-pilot', 'E2']);
      assert.equal(res[0]?.state, 'SETTLED');
      assert.ok((res[0]?.money ?? Infinity) <= SKILL_NEED_CAP.money, `the worst case ${res[0]?.money} fits the assessment's own cap`);
      assert.ok(reservationsOf(rt, reply).every((x) => rt.governance.deployment(x.deploymentId as Id).code !== dep.code), 'the reply never uses the pilot deployment');
      assert.equal(replyManifestSkills(rt, reply, versions)['ceo.organization-leadership'], 'SELECTED');
      const db = readFileSync(path.join(root, 'state', 'company.sqlite3'));
      assert.equal(db.includes(Buffer.from('CANARY-THINKING-7Qx')), false, 'the thinking text is never stored');
      assert.equal(logs.join('\n').includes('CANARY-THINKING-7Qx'), false, 'nor logged');
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('thinking exhausts the allowance (finish_reason length): one call, never re-sent, OUTPUT_TRUNCATED fallback; the reply lands with every eligible Skill', () =>
    withWorld('sna-e2-trunc', { e2Pilot: true, level: E2_LEVEL }, (_r, a) => (a ? thinkingAnswer('', OUTPUT_ALLOWANCE_BY_CLASS.E2, 'length') : replyOk()), async ({ rt, w, sent, versions }) => {
      const reply = ask(rt, w, ORG);
      assert.equal(await settled(rt, reply), 'COMPLETED');
      assert.equal(sent.filter((s) => s.assessment).length, 1);
      assert.deepEqual([decision(rt, reply)?.source, decision(rt, reply)?.outcome], ['FALLBACK', 'OUTPUT_TRUNCATED']);
      assert.deepEqual(Object.keys(replyManifestSkills(rt, reply, versions)).sort(), [...CEO_SKILLS].sort());
      assert.equal(rt.governance.accountingInvariants().length, 0);
    }));

  test('an E2 call that outlives its timeout: held for reconciliation, never re-sent, PROVIDER_UNCERTAIN; the reply lands', () =>
    withWorld('sna-e2-timeout', { e2Pilot: true, level: E2_LEVEL, callTimeoutMs: 1_500 }, (_r, a) => (a ? new Promise<DeepSeekResponse>(() => undefined) : replyOk()), async ({ rt, w, sent }) => {
      const reply = ask(rt, w, ORG);
      assert.equal(await settled(rt, reply, 20_000), 'COMPLETED');
      assert.equal(sent.filter((s) => s.assessment).length, 1);
      assert.equal(decision(rt, reply)?.outcome, 'PROVIDER_UNCERTAIN');
      assert.deepEqual(reservationsOf(rt, assessment(rt, reply)).map((x) => x.state), ['RECONCILIATION_REQUIRED']);
    }));

  test('isolation: an E2 pin under the production Skill-need profile (E1 only) makes no call — PROVIDER_UNAVAILABLE fallback, nothing reserved; the reply lands', () =>
    withWorld('sna-e2-unqualified', { level: E2_LEVEL }, (_r, a) => (a ? skillNeed(tiersWith({})) : replyOk()), async ({ rt, w, sent }) => {
      const reply = ask(rt, w, ORG);
      assert.equal(await settled(rt, reply), 'COMPLETED');
      assert.equal(sent.filter((s) => s.assessment).length, 0, 'no assessment call');
      assert.deepEqual([decision(rt, reply)?.source, decision(rt, reply)?.outcome], ['FALLBACK', 'PROVIDER_UNAVAILABLE']);
      assert.equal(reservationsOf(rt, assessment(rt, reply)).length, 0);
    }));

  test('the factory accepts E1 / E2 with a positive allowance only; the production processor is E1 / 256', () => {
    for (const bad of [{ reasoningClass: 'E3', maxOutputTokens: 256 }, { reasoningClass: 'E2', maxOutputTokens: 0 }, { reasoningClass: 'E1', maxOutputTokens: 1.5 }]) assert.throws(() => skillNeedAssessmentProcessorAt(bad as unknown as SkillNeedCallLevel), /INVALID_SKILL_NEED_CALL_LEVEL/);
    assert.equal(skillNeedAssessmentProcessorAt(E2_LEVEL).kind, skillNeedAssessmentProcessor.kind, 'the same kind: the reserved lane and the reply order are unchanged');
  });
});
