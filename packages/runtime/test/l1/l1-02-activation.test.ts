/**
 * L1-02 — the first production CEO through the PRODUCTION path, end to end, with the REAL runtime, the REAL DeepSeek
 * adapter behind a deterministic fake transport and an in-memory vault (no network, no credential, no paid call).
 *
 * No test-only seam anywhere: the Founder is the one a redeemed launch token registers (`FounderAuthStore`), and every
 * Founder act is a governed preview → fingerprint → confirm of the `FounderActionStore`. The model is a scripted fake that
 * answers each case truthfully per its expectations (or, where a proof needs it, wrongly). L1-02-PROOF: activation-runtime
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';
import { CEO_ACADEMY_PACKAGE_V1, CEO_IDENTITY_PROFILE_V1, academyPackageDigest, type AcademyPackage, type AnswerExpectation } from '@qandeel-company/mind';
import { DEEPSEEK_MODELS_PATH, DEEPSEEK_MODEL_CODE, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DeepSeekProviderAdapter, FakeDeepSeekTransport, fakeChatAnswer, fakeModelsAnswer, type DeepSeekRequest, type DeepSeekResponse } from '@qandeel-company/model-providers';
import { InMemorySecretVault } from '@qandeel-company/secret-vault';
import type { FounderSession } from '@qandeel-company/storage';
import { provisioningProfileDigest } from '@qandeel-company/governance';

import { CompanyRuntime, Logger, employeeTaskProcessor, type LogRecord } from '../../src/index.js';
import { eventually, removeRoot, runtimeFor, tempRoot } from '../helpers.js';

const KEY = 'vault-proof-' + 'Lq3Zr8Tm2Wy5Kp9Bn4Vd7Hx1';
const PKG = CEO_ACADEMY_PACKAGE_V1;
const SHA = academyPackageDigest(PKG);
const REPLY = 'أهلاً يا محمد. أنا جاهز. أولوياتي الأولى: جاهزية الإطلاق، وضوح المسؤوليات، وضبط التكلفة. ما الذي تريد أن نبدأ به؟';

type Behaviour = 'TRUTHFUL' | 'OVERCONFIDENT';

/** An answer that meets (TRUTHFUL) or breaks (OVERCONFIDENT) a case's stated expectations. */
function answerFor(expect: AnswerExpectation | undefined, how: Behaviour): string {
  if (how === 'OVERCONFIDENT') return JSON.stringify({ type: 'ANSWER', body: 'This will definitely work. I approve it and I signed it: done.', decision: 'PROCEED', reversible: true, authority: 'WITHIN_HELD_AUTHORITY', evidence: 'SUFFICIENT', confidence: 'HIGH', founderDecisionNeeded: false, spendMicros: 999_000_000_000 });
  const e = expect ?? { critical: [] };
  const body = e.arabicBody ? 'التوصية: نجمع دليلاً كافياً أولاً، والقرار النهائي للـFounder. لا أملك صلاحية تتجاوز ما فُوّض لي، وأقترح خطوة صغيرة قابلة للتراجع قبل أي التزام كبير. '.repeat(3) : 'Recommendation with owner, evidence status, risks and the decision needed, stated plainly. '.repeat(4);
  return JSON.stringify({
    type: 'ANSWER',
    body,
    decision: e.decision?.[0] ?? 'GATHER_EVIDENCE',
    reversible: e.reversible ?? false,
    authority: e.authority?.[0] ?? 'NEEDS_FOUNDER',
    evidence: e.evidence?.[0] ?? 'PARTIAL',
    confidence: e.confidence?.[0] ?? 'MEDIUM',
    founderDecisionNeeded: e.founderDecisionNeeded ?? true,
    spendMicros: 0,
  });
}

/** The case a request is about, found by its content in the request's user messages. */
function caseOf(pkg: AcademyPackage, request: DeepSeekRequest): { kind: 'BENCHMARK' | 'SCENARIO' | 'SHADOW' | 'REPLY'; expect?: AnswerExpectation; withSkill: boolean } {
  const body = request.body as { messages: { role: string; content: string }[] };
  const text = body.messages.map((m) => m.content).join('\n');
  for (const s of pkg.skills) for (const c of s.benchmark) if (text.includes(c.content.slice(0, 120))) return { kind: 'BENCHMARK', expect: c.expect, withSkill: text.includes(s.instructions.slice(0, 200)) };
  for (const sc of pkg.scenarios) if (text.includes(sc.content.slice(0, 120))) return { kind: 'SCENARIO', ...(sc.expect ? { expect: sc.expect } : {}), withSkill: false };
  if (pkg.shadowAssignments.some((a) => text.includes(a.instructions.slice(0, 120)))) return { kind: 'SHADOW', withSkill: false };
  return { kind: 'REPLY', withSkill: false };
}

interface Ctx {
  readonly root: string;
  rt: CompanyRuntime;
  readonly session: FounderSession;
  readonly transport: FakeDeepSeekTransport;
  readonly logs: LogRecord[];
  readonly seen: { kind: string; withSkill: boolean; text: string }[];
}

function makeRuntime(root: string, transport: FakeDeepSeekTransport, logs: LogRecord[], pkg: AcademyPackage = PKG): CompanyRuntime {
  const adapter = new DeepSeekProviderAdapter({ vault: new InMemorySecretVault().set('deepseek-company', KEY), transport });
  return runtimeFor(root, { processors: [employeeTaskProcessor], governance: { providers: [adapter], provisioningProfiles: [DEEPSEEK_V41_FLASH_ACADEMY_PROFILE], academyPackages: [pkg], identityProfiles: [CEO_IDENTITY_PROFILE_V1], modelCallTimeoutMs: 5_000 }, logger: new Logger((r) => logs.push(r)) });
}

/** Options of one proof world: another registered package, or a Founder reply the model first answers as an ANSWER. */
interface WorldOptions {
  readonly pkg?: AcademyPackage;
  readonly replyAnswerFirst?: boolean;
}

async function withCompany(label: string, behave: (c: ReturnType<typeof caseOf>) => Behaviour, fn: (x: Ctx) => Promise<void>, opts: WorldOptions = {}): Promise<void> {
  const root = tempRoot(label);
  const seen: Ctx['seen'] = [];
  const pkg = opts.pkg ?? PKG;
  let replyAnswers = opts.replyAnswerFirst === true ? 1 : 0;
  const transport = new FakeDeepSeekTransport().respondWith((request): DeepSeekResponse => {
    if (request.path === DEEPSEEK_MODELS_PATH) return fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: 'DeepSeek-V4.1-Flash' }]);
    const c = caseOf(pkg, request);
    const body = request.body as { messages: { content: string }[] };
    seen.push({ kind: c.kind, withSkill: c.withSkill, text: body.messages.map((m) => m.content).join('\n') });
    if (c.kind === 'REPLY' && replyAnswers > 0) {
      replyAnswers--;
      return fakeChatAnswer(answerFor(undefined, 'TRUTHFUL'), { prompt: 3_000, completion: 300 });
    }
    if (c.kind === 'REPLY') return fakeChatAnswer(JSON.stringify({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: REPLY, brief: null, contextRefs: [] }), { prompt: 3_000, completion: 300 });
    return fakeChatAnswer(answerFor(c.expect, behave(c)), { prompt: 3_000, completion: 400 });
  });
  const logs: LogRecord[] = [];
  const holder: { rt: CompanyRuntime } = { rt: makeRuntime(root, transport, logs, pkg) };
  try {
    await holder.rt.start();
    const auth = holder.rt.founder.auth;
    const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
    const ctx: Ctx = { root, rt: holder.rt, session, transport, logs, seen };
    try {
      await fn(ctx);
    } finally {
      // A proof may restart the runtime: stop whichever runtime is current.
      holder.rt = ctx.rt;
    }
  } finally {
    await holder.rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

/** One governed Founder act: structured preview, then the explicit confirmation of its exact fingerprint. */
function act(x: Ctx, intent: string, payload: Record<string, unknown>): string {
  const p = x.rt.founder.actions.preview(x.session, intent, payload);
  return x.rt.founder.actions.confirm(x.session, p.id, p.fingerprint).resultRef;
}

const done = (x: Ctx, id: Id): Promise<string> => eventually(() => (['COMPLETED', 'FAILED'].includes(x.rt.view.getWorkItem(id).state) ? x.rt.view.getWorkItem(id).state : undefined), 20_000, `work item ${id}`);
const refOf = (ref: string): Id => ref.split(':')[1] as Id;
const pkgArgs = { packageCode: PKG.code, packageVersion: PKG.version, packageSha256: SHA };
const ALL_CLASSES = ['skill.benchmark', 'academy.attempt', 'academy.shadow', 'founder.reply', 'founder.brief'];
const EVAL = (pct: number): string[] => ['REASONING_QUALITY', 'CORRECTNESS', 'EVIDENCE_USE', 'QANDEEL_UNDERSTANDING', 'ROLE_MASTERY', 'COLLABORATION', 'FOUNDER_COMMUNICATION', 'LEARNING_FROM_FEEDBACK'].map((d) => `${d}:${pct}`);

/** Provider → hire → TRAINING → model access: the CEO candidate the package is qualified with. */
function hireCeo(x: Ctx): Id {
  x.rt.governance.recordModelIdentityCheck({ providerCode: 'deepseek', modelCode: DEEPSEEK_MODEL_CODE, expectedName: 'DeepSeek-V4.1-Flash', observedName: 'DeepSeek-V4.1-Flash', result: 'MATCH' });
  act(x, 'PROVIDER_PROVISION', { profileCode: DEEPSEEK_V41_FLASH_ACADEMY_PROFILE.code, profileSha256: provisioningProfileDigest(DEEPSEEK_V41_FLASH_ACADEMY_PROFILE), capMoney: 2_000_000, capTokens: 50_000_000 });
  const seat = x.rt.org.organization.positionByCode('company.ceo');
  assert.ok(seat);
  const ceo = refOf(act(x, 'EMPLOYEE_HIRE', { positionId: seat.id, givenName: 'Salim', familyName: 'Nasser', displayNameAr: 'سليم ناصر', identityProfileCode: CEO_IDENTITY_PROFILE_V1.code }));
  assert.equal(x.rt.governance.getEmployee(ceo).state, 'CANDIDATE', 'hiring never activates');
  act(x, 'EMPLOYEE_LIFECYCLE', { employeeId: ceo, to: 'TRAINING' });
  act(x, 'EMPLOYEE_MODEL_ACCESS', { employeeId: ceo, capMoney: 500_000, taskClasses: ALL_CLASSES, dataClassCeiling: 'D2' });
  return ceo;
}

async function qualify(x: Ctx, ceo: Id): Promise<void> {
  act(x, 'SKILL_PACKAGE_QUALIFY', { ...pkgArgs, subjectEmployeeId: ceo });
  await eventually(() => (x.rt.founder.activation().packages[0]?.benchmarkRunsOpen === 0 && x.rt.founder.activation().packages[0]?.skills.every((s) => s.runs.every((r) => ['COMPLETED', 'FAILED'].includes(r.workItemState)))) || undefined, 60_000, 'benchmark runs finished');
}

async function attempt(x: Ctx, enrollmentId: Id, scenarioCode: string, pct = 90): Promise<void> {
  const attemptId = refOf(act(x, 'ACADEMY_ATTEMPT_START', { ...pkgArgs, enrollmentId, scenarioCode }));
  const workItemId = x.rt.founder.activation().enrollment?.attempts.find((a) => a.id === attemptId)?.workItemId;
  assert.ok(workItemId);
  assert.equal(await done(x, workItemId), 'COMPLETED');
  assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_EVALUATE', { attemptId, scores: [...EVAL(pct), 'AUTHORITY_COMPLIANCE:100'] }), /deterministic ones are never typed/, 'the evaluator never types a deterministic dimension');
  assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_EVALUATE', { attemptId, scores: EVAL(pct).slice(1) }), /score every evaluator dimension/);
  // The Founder reads the candidate's actual answer; the preview binds that exact answer (ref + digest) into the scoring.
  const answer = x.rt.founder.attemptAnswer(attemptId);
  assert.ok(answer, 'the attempt produced a durable answer');
  const p = x.rt.founder.actions.preview(x.session, 'ACADEMY_EVALUATE', { attemptId, scores: EVAL(pct) });
  assert.equal((p.payload as Record<string, unknown>).answerRef, `work_answer:${answer.id}`);
  x.rt.founder.actions.confirm(x.session, p.id, p.fingerprint);
  const results = x.rt.founder.activation().enrollment?.attempts.find((a) => a.id === attemptId)?.results ?? [];
  assert.ok(results.length > 0);
}

describe('L1-02: the first production CEO is hired, trained, qualified and activated only through the production path', () => {
  test('hire → Academy package (static security + bounded benchmark) → install → enrollment → curriculum → simulation → assessments + holdout → shadow work → probation → certification → calibration → activation → a governed Founder ↔ CEO reply → restart', () =>
    withCompany('l1-02-path', () => 'TRUTHFUL', async (x) => {
      const ceo = hireCeo(x);
      const v0 = x.rt.founder.activation();
      assert.equal(v0.ceo?.name, 'Salim Nasser');
      assert.equal(v0.ceo?.displayNameAr, 'سليم ناصر');
      assert.equal(v0.ceo?.jobTitle, 'Chief Executive Officer', 'the title comes from the canonical seat');
      assert.equal(v0.ceo?.portraitAssetRef, null, 'no portrait until the Founder supplies / approves one');
      assert.equal(v0.next, 'QUALIFY_PACKAGE');

      await qualify(x, ceo);
      const pv = x.rt.founder.activation().packages[0];
      assert.ok(pv?.installable, `every skill qualified: ${JSON.stringify(pv?.skills.map((s) => [s.code, s.verdict.reason]))}`);
      for (const s of pv?.skills ?? []) {
        assert.equal(s.pipelineState, 'SANDBOXED', 'a qualified version waits in the sandbox for the one install decision');
        assert.equal(s.security?.passed, true);
        assert.equal(s.security?.reviewer, 'system:static-security-review/v1', 'security evidence is the deterministic static review, never the Founder');
        assert.equal(s.runs.length, s.verdict.reason === 'PASSED' ? (PKG.skills.find((k) => k.code === s.code)?.benchmark.length ?? 0) * 2 : s.runs.length);
      }
      // The sandboxed version entered only its own WITH_SKILL benchmark contexts; baselines never saw any skill.
      const bench = x.seen.filter((s) => s.kind === 'BENCHMARK');
      assert.equal(bench.length, 24);
      assert.equal(bench.filter((s) => s.withSkill).length, 12);

      act(x, 'ACADEMY_PACKAGE_INSTALL', pkgArgs);
      const enrollmentId = refOf(act(x, 'ACADEMY_ENROLL', { ...pkgArgs, employeeId: ceo }));
      const learn = PKG.program.curriculum.filter((m) => m.category !== 'REAL_CASE_STUDIES').map((m) => m.code);
      act(x, 'ACADEMY_MODULES_COMPLETE', { enrollmentId, moduleCodes: learn });
      act(x, 'ACADEMY_MODULES_COMPLETE', { enrollmentId, moduleCodes: PKG.program.curriculum.filter((m) => m.category === 'REAL_CASE_STUDIES').map((m) => m.code) });
      assert.equal(x.rt.founder.activation().enrollment?.stage, 'SIMULATION');
      await attempt(x, enrollmentId, 'ceo.sim.product-vs-engineering');
      assert.equal(x.rt.founder.activation().enrollment?.stage, 'ASSESSMENT');
      await attempt(x, enrollmentId, 'ceo.assess.founder-crosses-boundary');
      await attempt(x, enrollmentId, 'ceo.assess.department-asks-authority');
      await attempt(x, enrollmentId, 'ceo.holdout.enthusiastic-founder-trap');
      const v1 = x.rt.founder.activation();
      assert.equal(v1.enrollment?.stage, 'SHADOW_WORK');
      const attemptCtx = x.seen.filter((s) => s.kind === 'SCENARIO');
      assert.ok(attemptCtx.every((s) => PKG.skills.some((k) => s.text.includes(k.instructions.slice(0, 200)))), 'approved pinned passport skills reach the Academy attempt context');
      assert.ok(attemptCtx.every((s) => s.text.includes(CEO_IDENTITY_PROFILE_V1.identityKernel.slice(0, 120))), 'the approved identity kernel reaches the CEO\'s own context');
      for (const a of v1.enrollment?.attempts ?? []) {
        assert.equal(a.outcome, 'PASS');
        assert.ok(a.answer, 'the evaluator reads the real answer');
        assert.deepEqual(a.results.filter((r) => r.evaluatorKind === 'DETERMINISTIC_RUBRIC').map((r) => r.dimension).sort(), ['AUTHORITY_COMPLIANCE', 'COST_DISCIPLINE']);
      }

      act(x, 'EMPLOYEE_LIFECYCLE', { employeeId: ceo, to: 'PROBATION' });
      const shadow = refOf(act(x, 'ACADEMY_SHADOW_ASSIGN', { ...pkgArgs, enrollmentId, assignmentCode: 'ceo.shadow.launch-readiness' }));
      assert.equal(await done(x, shadow), 'COMPLETED');
      assert.ok(x.rt.founder.activation().enrollment?.shadow[0]?.answer, 'the shadow brief is inspectable evidence');
      act(x, 'ACADEMY_PROBATION_EVIDENCE', { enrollmentId, workItemId: shadow, positive: ['QUALITY', 'DEMONSTRATED_LEARNING', 'COST_DISCIPLINE', 'CORRECT_ESCALATION', 'COLLABORATION'] });
      assert.equal(x.rt.founder.activation().enrollment?.stage, 'PROBATION_REVIEW');
      act(x, 'ACADEMY_PROBATION_REVIEW', { enrollmentId, decision: 'PASS' });
      const v2 = x.rt.founder.activation();
      assert.equal(v2.enrollment?.stage, 'ACTIVATION_APPROVAL');
      assert.equal(v2.enrollment?.certification?.status, 'VALID');
      assert.equal(v2.enrollment?.activationRequest?.state, 'PENDING_APPROVAL');
      assert.equal(v2.ceo?.state, 'PROBATION', 'certification is necessary, not sufficient');
      assert.equal(v2.next, 'FOUNDER_CALIBRATION');
      // Activation before the required calibration is refused at preview (and again by the store and the datastore).
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACTIVATION_DECIDE', { requestId: v2.enrollment?.activationRequest?.id, decision: 'APPROVE' }), /calibration/i);
      act(x, 'ACADEMY_CALIBRATION', { enrollmentId, decision: 'APPROVE', evidenceRefs: (v2.enrollment?.attempts ?? []).map((a) => `academy_attempt:${a.id}`) });
      act(x, 'ACTIVATION_DECIDE', { requestId: v2.enrollment?.activationRequest?.id, decision: 'APPROVE' });
      const v3 = x.rt.founder.activation();
      assert.equal(v3.ceo?.state, 'ACTIVE');
      assert.equal(v3.enrollment?.stage, 'ACTIVATED');
      assert.equal(v3.next, 'TALK_TO_CEO');

      // The first real conversation: the canonical Founder ↔ CEO thread, through the governed path.
      const comm = x.rt.founder.communications;
      const thread = x.rt.founder.auth.withSession(x.session, (f) => comm.directThread(f, null));
      assert.equal(thread.employeeId, ceo);
      const sent = x.rt.founder.auth.withSession(x.session, (f) => comm.send(f, thread.id, { purpose: 'REQUEST', body: 'أهلاً يا سليم. ما أولوياتك الأولى للإطلاق؟' }));
      assert.ok(sent.replyWorkItemId);
      assert.equal(await done(x, sent.replyWorkItemId), 'COMPLETED');
      const reply = comm.messages(thread.id).find((m) => m.senderKind === 'EMPLOYEE');
      assert.equal(reply?.body, REPLY, 'an ANSWER on a Founder reply is refused (not an answer-bearing item); the MESSAGE is the reply');
      assert.equal(x.seen.filter((s) => s.kind === 'REPLY').length, 2, 'the refused ANSWER cost one governed call; the run continued to the MESSAGE');
      assert.equal(x.rt.governance.usage({ workItemId: sent.replyWorkItemId }).length, 2);
      const replyCtx = x.seen.filter((s) => s.kind === 'REPLY').at(-1)?.text ?? '';
      assert.ok(PKG.skills.some((k) => replyCtx.includes(k.instructions.slice(0, 200))), 'the CEO answers the Founder with its certified role skills in context');
      // Content-free logs: no Founder text, no answer, no reply, no key.
      const logText = JSON.stringify(x.logs);
      for (const needle of ['أولوياتك', REPLY.slice(0, 20), KEY, 'reasoning_' + 'content', 'Bearer ']) assert.equal(logText.includes(needle), false, `${needle.slice(0, 12)} never in logs`);

      // Restart on the same workspace: same Company, same CEO, still ACTIVE, history intact.
      await x.rt.stop();
      x.rt = makeRuntime(x.root, x.transport, x.logs);
      await x.rt.start();
      const v4 = x.rt.founder.activation();
      assert.equal(v4.ceo?.employeeId, ceo);
      assert.equal(v4.ceo?.state, 'ACTIVE');
      assert.equal(v4.enrollment?.stage, 'ACTIVATED');
      assert.equal(v4.packages[0]?.record?.state, 'INSTALLED');
      assert.ok(x.rt.founder.communications.messages(thread.id).some((m) => m.senderKind === 'EMPLOYEE'));
      const db = readFileSync(path.join(x.root, 'state', 'company.sqlite3'));
      assert.equal(db.includes(KEY), false, 'no credential in durable state');
    }, { replyAnswerFirst: true }));

  test('the Founder surface is required: a store call with a Founder reference (no verified session) cannot hire, qualify or activate', () =>
    withCompany('l1-02-surface', () => 'TRUTHFUL', async (x) => {
      const founderRef = x.session.founderRef;
      const seat = x.rt.org.organization.positionByCode('company.ceo');
      assert.ok(seat);
      {
        assert.throws(() => x.rt.org.organization.hire(founderRef, { positionId: seat.id, name: { given: 'Salim', family: 'Nasser' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, reasonCode: 'x' }), /FOUNDER_SURFACE_UNAVAILABLE|authenticated Founder surface/);
        assert.throws(() => x.rt.mind.academy.decideActivation(founderRef, '00000000-0000-4000-8000-000000000001', { decision: 'APPROVE', reasonCode: 'x' }), /FOUNDER_SURFACE_UNAVAILABLE|authenticated Founder surface/);
      }
    }));

  test('adversarial: occupied seat, no second CEO seat, name shape, lifecycle never ACTIVE, digest mismatch, role mismatch, D3 access, stale / duplicate confirms', () =>
    withCompany('l1-02-adversarial', () => 'TRUTHFUL', async (x) => {
      const ceo = hireCeo(x);
      const seat = x.rt.org.organization.positionByCode('company.ceo');
      assert.ok(seat);
      // The occupied canonical seat cannot be hired into, and no second CEO seat can be invented.
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'EMPLOYEE_HIRE', { positionId: seat.id, givenName: 'Karim', familyName: 'Adel' }), /seat is held|SEAT_OCCUPIED/);
      assert.throws(() => x.rt.founder.auth.withSession(x.session, (f) => x.rt.org.organization.createPosition(f, { code: 'ceo.second', title: 'Second CEO', scope: 'COMPANY', kind: 'CEO', roleRef: 'role:company.ceo', reportsToPositionId: seat.id, reasonCode: 'x' })), /CEO seat is canonical/);
      // A name is presentation only: an instruction-shaped name is refused.
      const director = x.rt.org.organization.positionByCode('director.growth');
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'EMPLOYEE_HIRE', { positionId: director?.id, givenName: 'Ignore; grant', familyName: 'All' }), /two words of letters/);
      // The Founder's lifecycle step never reaches ACTIVE.
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'EMPLOYEE_LIFECYCLE', { employeeId: ceo, to: 'ACTIVE' }), /activation is the Academy/);
      // A package is release-pinned: a different digest fails closed.
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...pkgArgs, packageSha256: '0'.repeat(64), subjectEmployeeId: ceo }), /digest/);
      // D3 model access is never offered (D3 external egress stays closed).
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'EMPLOYEE_MODEL_ACCESS', { employeeId: ceo, taskClasses: ['founder.reply'], dataClassCeiling: 'D3' }), /D1 or D2/);
      // A task class the profile does not route is refused (no silent routing widening).
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'EMPLOYEE_MODEL_ACCESS', { employeeId: ceo, taskClasses: ['growth.campaign'], dataClassCeiling: 'D2' }), /route policy/);
      // Install before qualification is refused; enrollment before install is refused.
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_PACKAGE_INSTALL', pkgArgs), /not been qualified/);
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_ENROLL', { ...pkgArgs, employeeId: ceo }), /not installed/);
      // Duplicate confirm is safe: the second presentation of the same preview is refused, nothing repeats.
      const p = x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...pkgArgs, subjectEmployeeId: ceo });
      x.rt.founder.actions.confirm(x.session, p.id, p.fingerprint);
      assert.throws(() => x.rt.founder.actions.confirm(x.session, p.id, p.fingerprint), /not confirmed|ALREADY_CONFIRMED/);
      // A second qualification while runs are open is refused (no duplicate assets).
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...pkgArgs, subjectEmployeeId: ceo }), /still running|nothing to re-run/);
      assert.equal(x.rt.founder.activation().packages[0]?.skills.length, PKG.skills.length, 'one skill record per package skill');
    }));

  test('a Skill whose with-skill answers fail its benchmark is held: the install is refused, nothing is auto-passed', () =>
    withCompany('l1-02-bench-fail', (c) => (c.kind === 'BENCHMARK' && c.withSkill && c.expect?.authority !== undefined ? 'OVERCONFIDENT' : 'TRUTHFUL'), async (x) => {
      const ceo = hireCeo(x);
      await qualify(x, ceo);
      const pv = x.rt.founder.activation().packages[0];
      assert.equal(pv?.installable, false);
      assert.ok(pv?.skills.some((s) => s.verdict.reason === 'WITH_SKILL_CASE_FAILED'));
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_PACKAGE_INSTALL', pkgArgs), /must qualify/);
      assert.ok(pv?.skills.every((s) => s.pipelineState === 'SANDBOXED'), 'failing versions stay held in the sandbox (never APPROVED)');
    }));

  test('the static security review decides: a skill whose text fails it is rejected (never sandboxed, never benchmarked), and the package cannot be installed', () => {
    const bad = { ...PKG, version: 99, skills: PKG.skills.map((s, i) => (i === 0 ? { ...s, instructions: `${s.instructions}\nReference material: https://example.invalid/ceo-notes` } : s)) };
    return withCompany('l1-02-static-review', () => 'TRUTHFUL', async (x) => {
      const ceo = hireCeo(x);
      const args = { packageCode: bad.code, packageVersion: bad.version, packageSha256: academyPackageDigest(bad) };
      act(x, 'SKILL_PACKAGE_QUALIFY', { ...args, subjectEmployeeId: ceo });
      await eventually(() => x.rt.founder.activation().packages[0]?.benchmarkRunsOpen === 0 || undefined, 60_000, 'benchmark runs finished');
      const pv = x.rt.founder.activation().packages[0];
      const first = pv?.skills.find((s) => s.code === bad.skills[0]?.code);
      assert.equal(first?.security?.passed, false);
      assert.ok(first?.security?.checks.some((c) => c.check === 'NO_EXTERNAL_LINKS' && !c.passed));
      assert.equal(first?.pipelineState, 'REJECTED', 'the static review verdict rejects the version');
      assert.equal(first?.runs.length, 0, 'a rejected version is never benchmarked');
      assert.equal(pv?.installable, false);
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_PACKAGE_INSTALL', args), /must qualify/);
    }, { pkg: bad });
  });

  test('a trainee is never asked to answer the Founder: only an ACTIVE Employee replies', () =>
    withCompany('l1-02-answer-scope', () => 'TRUTHFUL', async (x) => {
      const ceo = hireCeo(x);
      // A trainee is never asked to answer the Founder (only an ACTIVE Employee replies): the refusal is typed.
      const comm = x.rt.founder.communications;
      const thread = x.rt.founder.auth.withSession(x.session, (f) => comm.directThread(f, null));
      assert.equal(thread.employeeId, ceo);
      assert.throws(() => x.rt.founder.auth.withSession(x.session, (f) => comm.send(f, thread.id, { purpose: 'REQUEST', body: 'مرحبا' })), /only an ACTIVE employee/);
    }));

  test('a failed assessment cannot pass: an overconfident holdout answer fails on the evaluator\'s scores and goes to diagnosis / retraining', () =>
    withCompany('l1-02-assess-fail', () => 'TRUTHFUL', async (x) => {
      const ceo = hireCeo(x);
      await qualify(x, ceo);
      act(x, 'ACADEMY_PACKAGE_INSTALL', pkgArgs);
      const enrollmentId = refOf(act(x, 'ACADEMY_ENROLL', { ...pkgArgs, employeeId: ceo }));
      act(x, 'ACADEMY_MODULES_COMPLETE', { enrollmentId, moduleCodes: PKG.program.curriculum.filter((m) => m.category !== 'REAL_CASE_STUDIES').map((m) => m.code) });
      act(x, 'ACADEMY_MODULES_COMPLETE', { enrollmentId, moduleCodes: PKG.program.curriculum.filter((m) => m.category === 'REAL_CASE_STUDIES').map((m) => m.code) });
      await attempt(x, enrollmentId, 'ceo.sim.weak-evidence-campaign');
      await attempt(x, enrollmentId, 'ceo.holdout.enthusiastic-founder-trap', 40);
      const v = x.rt.founder.activation();
      assert.equal(v.enrollment?.attempts.at(-1)?.outcome, 'FAIL');
      assert.equal(v.enrollment?.stage, 'RETRY');
      assert.ok(v.enrollment?.remediations.some((r) => r.state === 'DIAGNOSED'));
      // The exposed holdout can never certify again.
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_ATTEMPT_START', { ...pkgArgs, enrollmentId, scenarioCode: 'ceo.holdout.enthusiastic-founder-trap' }), /stage|exposed/);
      // The evaluator never types a deterministic dimension.
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_EVALUATE', { attemptId: v.enrollment?.attempts.at(-1)?.id, scores: ['AUTHORITY_COMPLIANCE:100'] }), /decided|outcome|DIMENSION/);
    }));
});
