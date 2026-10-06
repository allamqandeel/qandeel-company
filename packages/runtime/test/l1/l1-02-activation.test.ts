/**
 * L1-02 — the first production CEO through the PRODUCTION path, end to end, with the REAL runtime, the REAL DeepSeek
 * adapter behind a deterministic fake transport and an in-memory vault (no network, no credential, no paid call).
 *
 * No test-only seam anywhere: the Founder is the one a redeemed launch token registers (`FounderAuthStore`), and every
 * Founder act is a governed preview → fingerprint → confirm of the `FounderActionStore`. The model is a scripted fake that
 * answers each case truthfully per its expectations (or, where a proof needs it, wrongly). L1-02-PROOF: activation-runtime
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { sha256Hex, type Id } from '@qandeel-company/domain';
import { BQM2_DECLARATION, BQM2_DECLARATION_SHA256, CEO_ACADEMY_PACKAGE_V1, CEO_ACADEMY_PACKAGE_V2, CEO_ACADEMY_PACKAGE_V3, CEO_IDENTITY_PROFILE_V1, INVALID_OUTPUT_RESULT, RUBRIC_R2_DECLARATION, academyPackageDigest, benchmarkVerdictBqm2, forbiddenHitsR2, scoreAnswer, scoreAnswerR2, scriptFamily, type AcademyPackage, type AnswerExpectation, type BenchmarkCase, type RubricResult } from '@qandeel-company/mind';
import { DEEPSEEK_MODELS_PATH, DEEPSEEK_MODEL_CODE, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DeepSeekProviderAdapter, FakeDeepSeekTransport, fakeChatAnswer, fakeModelsAnswer, type DeepSeekRequest, type DeepSeekResponse } from '@qandeel-company/model-providers';
import { InMemorySecretVault } from '@qandeel-company/secret-vault';
import type { FounderSession } from '@qandeel-company/storage';
import { ANSWER_ONLY_OUTPUT_INSTRUCTION, ANSWER_AUTHORITY_SEMANTICS, ANSWER_CONFIDENCE_SEMANTICS, ANSWER_CONTRACT_SHA256, ANSWER_CONTRACT_TEXT, ANSWER_CONTRACT_VERSION, ANSWER_DECISION_SEMANTICS, ANSWER_FOUNDER_DECISION_SEMANTICS, ANSWER_REVERSIBLE_SEMANTICS, provisioningProfileDigest } from '@qandeel-company/governance';

import { CompanyRuntime, Logger, employeeTaskProcessor, type LogRecord } from '../../src/index.js';
import { eventually, removeRoot, runtimeFor, tempRoot } from '../helpers.js';

const KEY = 'vault-proof-' + 'Lq3Zr8Tm2Wy5Kp9Bn4Vd7Hx1';

/** D-L1-25: the generic proposal menu of every ordinary context, byte for byte (unchanged by the answer-only path). */
const GENERIC_MENU = 'Propose exactly one next action as JSON: {"type":"FINAL","summaryCode":"..."} | {"type":"TOOL_REQUEST","tool":"...","action":"...","args":{...}} | {"type":"MEMORY_CANDIDATE","memoryClass":"PROFESSIONAL|EXPERIENCE|RELATIONSHIP_COLLABORATION|CURRENT_WORK|PERSONAL_LESSON","topic":"...","claimKey":"optional.claim.key","claimValue":"optional-value","content":"...","confidencePct":0} | {"type":"OBSERVATION","topic":"...","content":"..."}. A memory candidate is only a proposal: the runtime decides whether anything is remembered.';
/** Every non-ANSWER proposal shape a context could advertise (an answer-only observation advertises none of them). */
const OTHER_SHAPES = ['FINAL', 'TOOL_REQUEST', 'MEMORY_CANDIDATE', 'OBSERVATION', 'ORG_ACTION', 'REVIEW_DECISION', 'MESSAGE', 'GOAL_ACTION'].map((t) => `"type":"${t}"`);
const PKG = CEO_ACADEMY_PACKAGE_V1;
const SHA = academyPackageDigest(PKG);
const REPLY = 'أهلاً يا محمد. أنا جاهز. أولوياتي الأولى: جاهزية الإطلاق، وضوح المسؤوليات، وضبط التكلفة. ما الذي تريد أن نبدأ به؟';

type Behaviour = 'TRUTHFUL' | 'OVERCONFIDENT' | 'MALFORMED' | 'NOT_JSON' | 'NONCRITICAL_MISS' | 'FORBIDDEN_HIT' | 'QUESTION_NEGATED' | keyof typeof WRONG_PROPOSALS;

/** D-L1-24: a VALID proposal of every non-ANSWER type (each one a real side effect outside the answer-only fence). */
const WRONG_PROPOSALS = {
  WRONG_FINAL: { type: 'FINAL', summaryCode: 'benchmark-done' },
  WRONG_MEMORY: { type: 'MEMORY_CANDIDATE', memoryClass: 'PERSONAL_LESSON', topic: 'ceo.benchmark-lesson', content: 'Lesson from this benchmark case: escalate earlier.', confidencePct: 80 },
  WRONG_OBSERVATION: { type: 'OBSERVATION', topic: 'ceo.benchmark-observation', content: 'The case shows a pattern worth remembering.' },
  WRONG_TOOL: { type: 'TOOL_REQUEST', tool: 'notes', action: 'append', args: {} },
  WRONG_ORG: { type: 'ORG_ACTION', action: 'work.delegate', args: {} },
  WRONG_REVIEW: { type: 'REVIEW_DECISION', outcome: 'PASS', reasonCode: 'looks-fine' },
  WRONG_MESSAGE: { type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: 'A message to the Founder from a benchmark case.', brief: null, contextRefs: [] },
  WRONG_GOAL: { type: 'GOAL_ACTION', action: 'goal.derive', args: {} },
} as const;

/** D-L1-20: a marker carried by invalid outputs, so a proof can show the output text is never stored. */
const INVALID_CANARY = 'invalid-output-canary-' + 'Qx7Lm2Pz';

/** An answer that meets (TRUTHFUL) or breaks (OVERCONFIDENT) a case's stated expectations. */
function answerFor(expect: AnswerExpectation | undefined, how: Behaviour): string {
  // An extra key (MALFORMED) / prose that is not JSON (NOT_JSON), each carrying the canary.
  if (how === 'MALFORMED') return JSON.stringify({ type: 'ANSWER', body: `${INVALID_CANARY} body`, rationale: INVALID_CANARY, decision: 'GATHER_EVIDENCE', reversible: true, authority: 'NEEDS_FOUNDER', evidence: 'PARTIAL', confidence: 'MEDIUM', founderDecisionNeeded: true, spendMicros: 0 });
  if (how === 'NOT_JSON') return `Here is my answer: ${INVALID_CANARY}`;
  if (how in WRONG_PROPOSALS) return JSON.stringify(WRONG_PROPOSALS[how as keyof typeof WRONG_PROPOSALS]);
  if (how === 'OVERCONFIDENT') return JSON.stringify({ type: 'ANSWER', body: 'This will definitely work. I approve it and I signed it: done.', decision: 'PROCEED', reversible: true, authority: 'WITHIN_HELD_AUTHORITY', evidence: 'SUFFICIENT', confidence: 'HIGH', founderDecisionNeeded: false, spendMicros: 999_000_000_000 });
  const e = expect ?? { critical: [] };
  if (how === 'NONCRITICAL_MISS' || how === 'FORBIDDEN_HIT' || how === 'QUESTION_NEGATED') return variantFor(e, how);
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

/**
 * D-L1-23 answer variants (truthful facets otherwise): every non-critical facet check missed; the case's first forbidden
 * phrase stated affirmatively; or the "Can I grant this? No." question that R1 counted as a forbidden hit.
 */
function variantFor(e: AnswerExpectation, how: 'NONCRITICAL_MISS' | 'FORBIDDEN_HIT' | 'QUESTION_NEGATED'): string {
  const truthful = JSON.parse(answerFor(e, 'TRUTHFUL')) as Record<string, unknown>;
  if (how === 'FORBIDDEN_HIT') return JSON.stringify({ ...truthful, body: `${e.forbidden?.[0] ?? 'permission granted'} — ${String(truthful.body)}` });
  if (how === 'QUESTION_NEGATED') return JSON.stringify({ ...truthful, body: `Can I grant this? No. ${String(truthful.body)}` });
  const miss: Record<string, unknown> = {};
  const other = <T extends string>(all: readonly T[], allowed: readonly T[] | undefined): T | undefined => all.find((v) => !(allowed ?? []).includes(v));
  if (e.evidence && !e.critical.includes('evidence')) miss.evidence = other(['SUFFICIENT', 'PARTIAL', 'INSUFFICIENT'] as const, e.evidence);
  if (e.confidence && !e.critical.includes('confidence')) miss.confidence = other(['LOW', 'MEDIUM', 'HIGH'] as const, e.confidence);
  if (e.authority && !e.critical.includes('authority')) miss.authority = other(['WITHIN_HELD_AUTHORITY', 'NEEDS_FOUNDER', 'NOT_HELD'] as const, e.authority);
  return JSON.stringify({ ...truthful, ...miss });
}

/** The case a request is about, found by its content in the request's user messages. */
function caseOf(pkg: AcademyPackage, request: DeepSeekRequest): { kind: 'BENCHMARK' | 'SCENARIO' | 'SHADOW' | 'REPLY'; expect?: AnswerExpectation; withSkill: boolean; thinking: boolean } {
  const body = request.body as { messages: { role: string; content: string }[]; thinking?: { type?: string } };
  const text = body.messages.map((m) => m.content).join('\n');
  const thinking = body.thinking?.type === 'enabled';
  for (const s of pkg.skills) for (const c of s.benchmark) if (text.includes(c.content.slice(0, 120))) return { kind: 'BENCHMARK', expect: c.expect, withSkill: text.includes(s.instructions.slice(0, 200)), thinking };
  for (const sc of pkg.scenarios) if (text.includes(sc.content.slice(0, 120))) return { kind: 'SCENARIO', ...(sc.expect ? { expect: sc.expect } : {}), withSkill: false, thinking };
  if (pkg.shadowAssignments.some((a) => text.includes(a.instructions.slice(0, 120)))) return { kind: 'SHADOW', withSkill: false, thinking };
  return { kind: 'REPLY', withSkill: false, thinking };
}

interface Ctx {
  readonly root: string;
  rt: CompanyRuntime;
  readonly session: FounderSession;
  readonly transport: FakeDeepSeekTransport;
  readonly logs: LogRecord[];
  readonly seen: { kind: string; withSkill: boolean; text: string; maxTokens: number; thinking: boolean; workItemId: string }[];
}

function makeRuntime(root: string, transport: FakeDeepSeekTransport, logs: LogRecord[], pkg: AcademyPackage | readonly AcademyPackage[] = PKG): CompanyRuntime {
  const adapter = new DeepSeekProviderAdapter({ vault: new InMemorySecretVault().set('deepseek-company', KEY), transport });
  return runtimeFor(root, { processors: [employeeTaskProcessor], governance: { providers: [adapter], provisioningProfiles: [DEEPSEEK_V41_FLASH_ACADEMY_PROFILE], academyPackages: Array.isArray(pkg) ? pkg : [pkg], identityProfiles: [CEO_IDENTITY_PROFILE_V1], modelCallTimeoutMs: 5_000 }, logger: new Logger((r) => logs.push(r)) });
}

/** Options of one proof world: another registered package, or a Founder reply the model first answers as an ANSWER. */
interface WorldOptions {
  readonly pkg?: AcademyPackage;
  readonly replyAnswerFirst?: boolean;
  /** D-L1-19: several registered versions of a package (the case texts are read from `pkg`). */
  readonly packages?: readonly AcademyPackage[];
  /**
   * D-L1-23: a per-call behaviour — `rank` is the order in which this case / arm's Work Items (observations) first called,
   * `call` this Work Item's call number (1, then 2 for a retry). Undefined falls back to `behave`.
   */
  readonly perCall?: (c: ReturnType<typeof caseOf>, rank: number, call: number) => Behaviour | undefined;
}

async function withCompany(label: string, behave: (c: ReturnType<typeof caseOf>) => Behaviour, fn: (x: Ctx) => Promise<void>, opts: WorldOptions = {}): Promise<void> {
  const root = tempRoot(label);
  const seen: Ctx['seen'] = [];
  const pkg = opts.pkg ?? PKG;
  let replyAnswers = opts.replyAnswerFirst === true ? 1 : 0;
  const ranks = new Map<string, string[]>();
  const calls = new Map<string, number>();
  const transport = new FakeDeepSeekTransport().respondWith((request): DeepSeekResponse => {
    if (request.path === DEEPSEEK_MODELS_PATH) return fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: 'DeepSeek-V4.1-Flash' }]);
    const c = caseOf(pkg, request);
    const body = request.body as { messages: { content: string }[]; max_tokens: number };
    const text = body.messages.map((m) => m.content).join('\n');
    const workItemId = /Work Item ([0-9a-f-]{36})/.exec(text)?.[1] ?? '';
    seen.push({ kind: c.kind, withSkill: c.withSkill, text, maxTokens: body.max_tokens, thinking: c.thinking, workItemId });
    const key = `${JSON.stringify(c.expect ?? null)}|${String(c.withSkill)}`;
    const order = ranks.get(key) ?? [];
    if (!order.includes(workItemId)) order.push(workItemId);
    ranks.set(key, order);
    calls.set(workItemId, (calls.get(workItemId) ?? 0) + 1);
    if (c.kind === 'REPLY' && replyAnswers > 0) {
      replyAnswers--;
      return fakeChatAnswer(answerFor(undefined, 'TRUTHFUL'), { prompt: 3_000, completion: 300 });
    }
    if (c.kind === 'REPLY') return fakeChatAnswer(JSON.stringify({ type: 'MESSAGE', purpose: 'RESULT', attentionLevel: 'INFORMATIONAL', body: REPLY, brief: null, contextRefs: [] }), { prompt: 3_000, completion: 300 });
    const how = opts.perCall?.(c, order.indexOf(workItemId), calls.get(workItemId) ?? 1) ?? behave(c);
    return fakeChatAnswer(answerFor(c.expect, how), { prompt: 3_000, completion: 400 });
  });
  const logs: LogRecord[] = [];
  const holder: { rt: CompanyRuntime } = { rt: makeRuntime(root, transport, logs, opts.packages ?? pkg) };
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
  // D-L1-23: every new answer records the exact ANSWER contract it was produced under.
  assert.deepEqual([answer.answerContractVersion, answer.answerContractSha256], [ANSWER_CONTRACT_VERSION, ANSWER_CONTRACT_SHA256]);
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

      // D-L1-20 / D-L1-22: every answer-bearing context (benchmark, attempt, shadow) carries the canonical decision /
      // confidence / reversible semantics; a Founder reply context (MESSAGE) does not.
      for (const kind of ['BENCHMARK', 'SCENARIO', 'SHADOW']) {
        const ctxs = x.seen.filter((r) => r.kind === kind);
        assert.ok(ctxs.length > 0, `${kind} contexts were assembled`);
        assert.ok(ctxs.every((r) => r.text.includes(ANSWER_DECISION_SEMANTICS) && r.text.includes(ANSWER_CONFIDENCE_SEMANTICS) && r.text.includes(ANSWER_REVERSIBLE_SEMANTICS)), `every ${kind} context defines decision, confidence and reversible`);
        // D-L1-23: and the whole AC-4 contract, verbatim (decision, authority, confidence, reversible, founderDecisionNeeded).
        assert.ok(ctxs.every((r) => r.text.includes(ANSWER_CONTRACT_TEXT) && r.text.includes(ANSWER_AUTHORITY_SEMANTICS) && r.text.includes(ANSWER_FOUNDER_DECISION_SEMANTICS)), `every ${kind} context carries the AC-4 contract`);
      }
      // D-L1-25: every context of this (BQM-1) world keeps the generic proposal menu byte for byte; none is answer-only;
      // a Founder reply context still carries its MESSAGE shape.
      assert.ok(x.seen.every((r) => r.text.includes(GENERIC_MENU) && !r.text.includes(ANSWER_ONLY_OUTPUT_INSTRUCTION)), 'ordinary, BQM-1, attempt, shadow and reply contexts are unchanged');
      assert.ok(x.seen.filter((r) => r.kind === 'REPLY').every((r) => r.text.includes('"type":"MESSAGE"')));
      assert.ok(x.seen.filter((r) => r.kind === 'REPLY').every((r) => !r.text.includes(ANSWER_DECISION_SEMANTICS) && !r.text.includes(ANSWER_REVERSIBLE_SEMANTICS) && !r.text.includes(ANSWER_AUTHORITY_SEMANTICS) && !r.text.includes(ANSWER_FOUNDER_DECISION_SEMANTICS) && !r.text.includes('"type":"ANSWER"')), 'a Founder reply (MESSAGE) context is unchanged: no ANSWER contract');

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

// --- D-L1-19: the package-revision seam ------------------------------------------------------------------------------
// L1-02-PROOF: package-revision

const V1 = CEO_ACADEMY_PACKAGE_V1;
const V2 = CEO_ACADEMY_PACKAGE_V2;
/** The digest package v1 was released (and qualified in the live Company) with: v1 is never rewritten. */
const V1_RELEASED_SHA = '546f5bbe279f2a3b1d969242e5381ffef891cee055ed662ac28c7053e2b7bf4b';
const EE = 'ceo.evidence-and-economics';
const EE_EXPECTS: readonly (AnswerExpectation | undefined)[] = V1.skills.find((s) => s.code === EE)?.benchmark.map((b) => b.expect) ?? [];
const argsOf = (p: AcademyPackage): Record<string, unknown> => ({ packageCode: p.code, packageVersion: p.version, packageSha256: academyPackageDigest(p) });
type PackageViewOf = ReturnType<CompanyRuntime['founder']['activation']>['packages'][number];
const viewOf = (x: Ctx, p: AcademyPackage): PackageViewOf | undefined => x.rt.founder.activation().packages.find((v) => v.code === p.code && v.version === p.version && v.sha256 === academyPackageDigest(p));
const isEeWithSkill = (c: ReturnType<typeof caseOf>): boolean => c.kind === 'BENCHMARK' && c.withSkill && EE_EXPECTS.includes(c.expect);
const finished = (v: PackageViewOf | undefined, p: AcademyPackage): boolean => v !== undefined && v.benchmarkRunsOpen === 0 && v.skills.length === p.skills.length && v.skills.every((s) => s.runs.every((r) => ['COMPLETED', 'FAILED'].includes(r.workItemState)));

async function qualifyPkg(x: Ctx, p: AcademyPackage, ceo: Id): Promise<void> {
  act(x, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(p), subjectEmployeeId: ceo });
  await eventually(() => finished(viewOf(x, p), p) || undefined, 60_000, `package v${p.version} benchmark runs finished`);
}

describe('D-L1-19: a failed Academy package is revised by a NEW package version, never rewritten or re-run into a pass', () => {
  test('v1 fails and stays failed history; v2 reuses each Skill identity with a new chained Skill Version, qualifies on its own evidence only, and installs', () => {
    let phase: 'V1' | 'V2' = 'V1';
    const weakV1: AcademyPackage = { ...V1, skills: V1.skills.map((s) => (s.code === EE ? { ...s, benchmark: s.benchmark.map((b) => ({ ...b, expect: { decision: ['PROCEED', 'PROCEED_WITH_CONDITIONS', 'GATHER_EVIDENCE', 'ESCALATE_TO_FOUNDER', 'DECLINE'], critical: ['decision'] } })) } : s)) };
    // Same label as v1 with a different payload; same label as v1 with the same payload.
    const conflict: AcademyPackage = { ...V2, version: 3, skills: V2.skills.map((s, i) => (i === 0 ? { ...s, versionLabel: '1.0.0', instructions: `${s.instructions}\nRevised wording.` } : s)) };
    const taken: AcademyPackage = { ...V2, version: 4, skills: V2.skills.map((s) => ({ ...s, versionLabel: '1.0.0' })) };
    return withCompany('l1-02-revision', (c) => (phase === 'V1' && isEeWithSkill(c) ? 'OVERCONFIDENT' : 'TRUTHFUL'), async (x) => {
      assert.equal(academyPackageDigest(V1), V1_RELEASED_SHA, 'package v1 is exactly the released definition');
      assert.notEqual(academyPackageDigest(V2), V1_RELEASED_SHA, 'v2 is a new immutable package digest');
      const ceo = hireCeo(x);
      await qualifyPkg(x, V1, ceo);
      const v1 = viewOf(x, V1);
      assert.ok(v1?.record);
      assert.equal(v1.installable, false);
      assert.equal(v1.skills.find((s) => s.code === EE)?.verdict.reason, 'WITH_SKILL_CASE_FAILED', 'v1 truthfully failed a scored with-skill case');
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_PACKAGE_INSTALL', argsOf(V1)), /must qualify/);
      const v1Before = JSON.stringify(v1);

      // A revision never rewrites a Skill Version label: refused whole, nothing written.
      assert.throws(() => act(x, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(conflict), subjectEmployeeId: ceo }), /already names a different payload/);
      assert.throws(() => act(x, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(taken), subjectEmployeeId: ceo }), /already qualified in an earlier package/);
      assert.equal(viewOf(x, conflict)?.record ?? null, null, 'a refused revision leaves no package record');
      assert.equal(viewOf(x, taken)?.record ?? null, null);

      phase = 'V2';
      await qualifyPkg(x, V2, ceo);
      const v2 = viewOf(x, V2);
      assert.ok(v2?.record);
      assert.equal(JSON.stringify(viewOf(x, V1)), v1Before, 'v1 stays readable and unchanged after v2 is registered and benchmarked');
      const v1Runs = new Set(v1.skills.flatMap((s) => s.runs.map((r) => r.id)));
      for (const s2 of v2.skills) {
        const s1: PackageViewOf['skills'][number] | undefined = v1.skills.find((s) => s.code === s2.code);
        assert.ok(s1);
        assert.equal(s2.skillId, s1.skillId, `${s2.code}: v2 reuses the semantic Skill identity`);
        assert.notEqual(s2.skillVersionId, s1.skillVersionId, `${s2.code}: v2 qualifies its own new Skill Version`);
        const ver = x.rt.mind.skills.version(s2.skillVersionId);
        assert.equal(ver.versionLabel, '1.0.0+pkg2');
        assert.equal(ver.previousVersionId, s1.skillVersionId, `${s2.code}: the new version is chained to v1's`);
        assert.equal(x.rt.mind.skills.versions(s2.skillId).length, 2, `${s2.code}: one identity, two versions (no duplicate identity, no refused-revision residue)`);
        assert.equal(s2.runs.length, (V2.skills.find((s) => s.code === s2.code)?.benchmark.length ?? 0) * 2, `${s2.code}: exactly v2's own cases x arms`);
        assert.ok(s2.runs.every((r) => !v1Runs.has(r.id)), `${s2.code}: v2's view never sees a v1 run`);
        assert.ok(s2.verdict.benchmarkPassed && s2.verdict.comparePassed);
      }
      assert.equal(v2.installable, true);
      const ceilings = [...new Set(x.seen.filter((r) => r.kind === 'BENCHMARK').map((r) => r.maxTokens))].sort();
      assert.deepEqual(ceilings, [V1.limits.benchmarkMaxOutputTokens, V2.limits.benchmarkMaxOutputTokens].sort(), 'each package ran under its own pinned output ceiling');

      // v1's failure cannot be turned into a pass: no case can be re-run (no VOID run) — its only act is finalizing its
      // scores (D-L1-21: zero runs, zero provider calls) — and its install is still refused.
      const v1Again = x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(V1), subjectEmployeeId: ceo }).payload as Record<string, unknown>;
      assert.deepEqual([v1Again.qualification, v1Again.benchmarkRuns, v1Again.paidProviderCalls], ['FINALIZE_SCORES', 0, 'NONE']);
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_PACKAGE_INSTALL', argsOf(V1)), /must qualify/);

      act(x, 'ACADEMY_PACKAGE_INSTALL', argsOf(V2));
      for (const s2 of v2.skills) assert.equal(x.rt.mind.skills.version(s2.skillVersionId).pipelineState, 'APPROVED');
      for (const s1 of v1.skills) assert.equal(x.rt.mind.skills.version(s1.skillVersionId).pipelineState, 'SANDBOXED', 'v1 versions stay held in the sandbox');

      // A host that registers a rewritten v1 (same code and version, a weaker rubric) never sees it as installable.
      await x.rt.stop();
      x.rt = makeRuntime(x.root, x.transport, x.logs, [V2, weakV1]);
      await x.rt.start();
      const weak = x.rt.founder.activation().packages.find((v) => v.version === V1.version);
      assert.ok(weak?.record, 'the durable v1 record is found by code and version');
      assert.notEqual(weak.record.sha256, academyPackageDigest(weakV1));
      assert.equal(weak.installable, false, 'a definition whose digest differs from the recorded one is never installable');
      assert.throws(() => act(x, 'ACADEMY_PACKAGE_INSTALL', argsOf(weakV1)), /must qualify|different package|digest/);
    }, { packages: [V2, V1, conflict, taken] });
  });

  test('v1 passing evidence never satisfies v2: v2 qualifies only on its own exact versions\' runs', () => {
    let phase: 'V1' | 'V2' = 'V1';
    return withCompany('l1-02-revision-isolation', (c) => (phase === 'V2' && isEeWithSkill(c) ? 'OVERCONFIDENT' : 'TRUTHFUL'), async (x) => {
      const ceo = hireCeo(x);
      await qualifyPkg(x, V1, ceo);
      assert.equal(viewOf(x, V1)?.installable, true, 'v1 qualified here (left uninstalled)');
      phase = 'V2';
      act(x, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(V2), subjectEmployeeId: ceo });
      const fresh = viewOf(x, V2);
      assert.equal(fresh?.installable, false, 'a just-registered v2 inherits nothing from v1');
      assert.ok(fresh?.skills.every((s) => !s.verdict.benchmarkPassed && s.runs.every((r) => r.result === null)));
      await eventually(() => finished(viewOf(x, V2), V2) || undefined, 60_000, 'v2 benchmark runs finished');
      const v2 = viewOf(x, V2);
      assert.equal(v2?.skills.find((s) => s.code === EE)?.verdict.reason, 'WITH_SKILL_CASE_FAILED', 'v2 is judged on its own (failing) evidence, never on v1\'s pass');
      assert.equal(v2?.installable, false);
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_PACKAGE_INSTALL', argsOf(V2)), /must qualify/);
      assert.equal(viewOf(x, V1)?.installable, true, 'v2\'s failure leaves v1 untouched');
    }, { packages: [V2, V1] });
  });

  test('package history only moves forward: a version older than a recorded one is never created beside it', () => {
    const v3: AcademyPackage = { ...V2, version: 3, skills: V2.skills.map((s) => ({ ...s, versionLabel: '1.0.0+pkg3' })) };
    return withCompany('l1-02-revision-order', () => 'TRUTHFUL', async (x) => {
      const ceo = hireCeo(x);
      act(x, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(v3), subjectEmployeeId: ceo });
      assert.throws(() => act(x, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(V2), subjectEmployeeId: ceo }), /newer than every recorded version/);
      assert.equal(viewOf(x, V2)?.record ?? null, null);
    }, { packages: [v3, V2] });
  });
});

// --- D-L1-20: the canonical ANSWER semantics, the content-free invalid-output diagnosis, v2's ceiling, the rubric -----
// L1-02-PROOF: answer-semantics

describe('D-L1-20: pre-run corrections for package v2', () => {
  test('the ANSWER semantics define the primary-proposal decision and the decision-relevant-evidence confidence', () => {
    assert.match(ANSWER_DECISION_SEMANTICS, /PRIMARY proposal/);
    assert.match(ANSWER_DECISION_SEMANTICS, /never of an auxiliary pilot, experiment, investigation or next evidence-gathering step/);
    assert.match(ANSWER_DECISION_SEMANTICS, /run a measured comparison first"\) = GATHER_EVIDENCE, not PROCEED_WITH_CONDITIONS/);
    assert.match(ANSWER_CONFIDENCE_SEMANTICS, /CURRENT evidence supports the decision-relevant factual premise/);
    assert.match(ANSWER_CONFIDENCE_SEMANTICS, /never your confidence that gathering evidence is a good idea/);
    assert.match(ANSWER_CONFIDENCE_SEMANTICS, /LOW or MEDIUM, not HIGH/);
  });

  test('v2\'s benchmark ceiling is 4096, inside every deployment the skill.benchmark route may use; v1 is unchanged', () => {
    assert.equal(V2.limits.benchmarkMaxOutputTokens, 4_096);
    assert.equal(academyPackageDigest(V1), V1_RELEASED_SHA, 'v1 is unchanged');
    assert.deepEqual({ ...V2, version: 1, title: V1.title, skills: V1.skills, limits: V1.limits }, V1, 'v2 differs from v1 only in version, title, Skill Version labels and the benchmark ceiling');
    assert.deepEqual(V2.limits, { ...V1.limits, benchmarkMaxOutputTokens: 4_096 }, 'the money caps are v1\'s');
    const route = DEEPSEEK_V41_FLASH_ACADEMY_PROFILE.routePolicies.find((r) => r.taskClass === V2.taskClasses.benchmark)?.body;
    assert.ok(route);
    const order = ['E1', 'E2', 'E3', 'E4'];
    const eligible = DEEPSEEK_V41_FLASH_ACADEMY_PROFILE.deployments.filter((d) => d.taskClasses.includes(V2.taskClasses.benchmark) && order.indexOf(d.reasoningClass) >= order.indexOf(route.minClass) && order.indexOf(d.reasoningClass) <= order.indexOf(route.maxClass));
    assert.deepEqual(eligible.map((d) => d.reasoningClass), ['E1', 'E2']);
    assert.ok(eligible.every((d) => d.maxOutputTokens >= V2.limits.benchmarkMaxOutputTokens), 'every eligible deployment admits the ceiling');
    assert.equal(Math.min(...eligible.map((d) => d.maxOutputTokens)), 4_096, '4096 is the smallest common eligible ceiling');
  });

  test('the rubric is unchanged: 2 of 3 checks = 66 and fails the 75 mark even when only a non-critical check missed', () => {
    const saudi = V2.skills.flatMap((s) => s.benchmark).find((b) => b.code === 'saudi-thin-information');
    assert.ok(saudi);
    assert.equal(V2.limits.benchmarkPassPct, 75);
    assert.deepEqual(saudi.expect, V1.skills.flatMap((s) => s.benchmark).find((b) => b.code === 'saudi-thin-information')?.expect);
    const facets = { decision: 'GATHER_EVIDENCE', reversible: true, authority: 'NEEDS_FOUNDER', evidence: 'INSUFFICIENT', founderDecisionNeeded: true, spendMicros: 0 } as const;
    const high = scoreAnswer(saudi.expect, { body: 'x'.repeat(200), ...facets, confidence: 'HIGH' }, V2.limits.benchmarkPassPct);
    assert.equal(high.checks.length, 3);
    assert.equal(high.scorePct, 66);
    assert.equal(high.criticalPassed, true, 'only the non-critical confidence check missed');
    assert.equal(high.passed, false, 'a non-critical miss still counts toward the score: 66 < 75 fails');
    assert.equal(scoreAnswer(saudi.expect, { body: 'x'.repeat(200), ...facets, confidence: 'LOW' }, V2.limits.benchmarkPassPct).passed, true);
  });

  test('an invalid model output is diagnosed durably and content-free; retry / escalation behaviour is unchanged', () => {
    // EE with-skill: the first (E1) output is MALFORMED, the one escalation answers. EE baseline: both outputs NOT_JSON.
    const how = (c: ReturnType<typeof caseOf>): Behaviour => {
      if (c.kind !== 'BENCHMARK' || !EE_EXPECTS.includes(c.expect)) return 'TRUTHFUL';
      if (c.withSkill) return c.thinking ? 'TRUTHFUL' : 'MALFORMED';
      return 'NOT_JSON';
    };
    return withCompany('l1-02-invalid-output', how, async (x) => {
      const ceo = hireCeo(x);
      await qualifyPkg(x, V2, ceo);
      const ee = viewOf(x, V2)?.skills.find((s) => s.code === EE);
      assert.ok(ee);
      const invalidRows = (workItemId: Id): { reason: string | null; details: Record<string, unknown> }[] =>
        x.rt.view.runsForWorkItem(workItemId).flatMap((r) => x.rt.view.audit(r.id)).filter((a) => a.action === 'run.model_output_invalid').map((a) => ({ reason: a.reasonCode, details: a.details }));
      for (const r of ee.runs) {
        const calls = x.seen.filter((s) => s.kind === 'BENCHMARK' && s.text.includes(V2.skills.find((k) => k.code === EE)?.benchmark.find((b) => b.code === r.caseCode)?.content.slice(0, 120) ?? '#') && s.text.includes(V2.skills.find((k) => k.code === EE)?.instructions.slice(0, 200) ?? '#') === (r.arm === 'WITH_SKILL'));
        assert.equal(calls.length, 2, `${r.caseCode} ${r.arm}: one first call and exactly one escalation (unchanged)`);
        assert.ok(calls[1]?.maxTokens === V2.limits.benchmarkMaxOutputTokens && calls[1]?.text !== undefined);
        if (r.arm === 'WITH_SKILL') {
          assert.equal(r.workItemState, 'COMPLETED', 'the escalation answered');
          assert.ok(r.answer && !r.answer.body.includes(INVALID_CANARY));
          assert.deepEqual(invalidRows(r.workItemId), [{ reason: 'MALFORMED', details: { step: 0, reasoningClass: 'E1' } }]);
        } else {
          assert.equal(r.workItemState, 'FAILED');
          assert.equal(x.rt.view.runsForWorkItem(r.workItemId)[0]?.failureCode, 'MODEL_OUTPUT_INVALID', 'two invalid outputs still fail the run');
          assert.deepEqual(invalidRows(r.workItemId).map((a) => `${a.reason}:${String(a.details.step)}:${String(a.details.reasoningClass)}`), ['NOT_JSON:0:E1', 'NOT_JSON:0:E2'], 'each invalid output is diagnosed at its exact step and class');
        }
      }
      // Usable after the run finished, and content-free: the invalid output text is nowhere in the workspace's durable
      // state (database + WAL), nor in the logs.
      await x.rt.stop();
      const state = path.join(x.root, 'state');
      for (const f of readdirSync(state)) assert.equal(readFileSync(path.join(state, f)).includes(INVALID_CANARY), false, `${f} never holds invalid output text`);
      assert.equal(JSON.stringify(x.logs).includes(INVALID_CANARY), false);
      x.rt = makeRuntime(x.root, x.transport, x.logs, [V2]);
      await x.rt.start();
      assert.equal(x.rt.view.auditByAction('run.model_output_invalid').length, ee.runs.length / 2 * 3, 'the diagnosis survives the run and a restart (per EE case: 1 with-skill + 2 baseline)');
    }, { packages: [V2] });
  });
});

// --- D-L1-21: benchmark scores are finalized as durable evidence, without the install and without paid calls ------------
// L1-02-PROOF: score-finalization

const GOV = 'ceo.governance-discipline';
const GOV_VOID_EXPECT = V2.skills.find((s) => s.code === GOV)?.benchmark.find((b) => b.code === 'restricted-data-external-vendor')?.expect;

describe('D-L1-21: finished benchmark answers are finalized to durable SCORED evidence; a failed package keeps it', () => {
  test('VOID cases are the only re-runs; finalization scores every answered run durably with zero runs and zero calls, idempotently; install still refuses and erases nothing', () => {
    let phase: 'FIRST' | 'AFTER' = 'FIRST';
    // EE with-skill fails (scored); one baseline case answers nothing in the first pass (VOID), then answers.
    const how = (c: ReturnType<typeof caseOf>): Behaviour => {
      if (isEeWithSkill(c)) return 'OVERCONFIDENT';
      if (phase === 'FIRST' && c.kind === 'BENCHMARK' && !c.withSkill && c.expect === GOV_VOID_EXPECT) return 'NOT_JSON';
      return 'TRUTHFUL';
    };
    return withCompany('l1-02-finalize', how, async (x) => {
      const ceo = hireCeo(x);
      await qualifyPkg(x, V2, ceo);
      const pkgView = (): PackageViewOf => {
        const v = viewOf(x, V2);
        assert.ok(v);
        return v;
      };
      const rows = (): PackageViewOf['skills'][number]['runs'][number][] => pkgView().skills.flatMap((s) => s.runs);
      const calls = (): number => x.seen.filter((r) => r.kind === 'BENCHMARK').length;
      const eeFailed = (): PackageViewOf['skills'][number]['runs'][number] | undefined => pkgView().skills.find((s) => s.code === EE)?.runs.find((r) => r.arm === 'WITH_SKILL' && r.result?.passed === false);
      assert.equal(rows().length, 24);
      assert.equal(rows().filter((r) => r.workItemState === 'FAILED').length, 1, 'one run ended without an answer');
      assert.ok(rows().every((r) => r.state === 'OPEN'), 'nothing is durably scored by the benchmark itself');

      // 1. One VOID case: the preview re-runs exactly it and finalizes the 23 answered runs.
      const re = x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(V2), subjectEmployeeId: ceo });
      const rp = re.payload as Record<string, unknown>;
      assert.deepEqual([rp.qualification, rp.benchmarkRuns, rp.scoresToFinalize, rp.paidProviderCalls], ['REQUALIFY_VOID_RUNS', 1, 23, 'BOUNDED_BY_CAPS']);
      const failedRunId = eeFailed()?.id;
      assert.ok(failedRunId);
      phase = 'AFTER';
      const before = calls();
      x.rt.founder.actions.confirm(x.session, re.id, re.fingerprint);
      assert.equal(rows().filter((r) => r.state === 'SCORED').length, 23, 'the 23 answered runs are durably SCORED in the same confirmation');
      assert.equal(eeFailed()?.state, 'SCORED');
      assert.equal(eeFailed()?.id, failedRunId, 'the scored failure is never re-run');
      await eventually(() => finished(viewOf(x, V2), V2) || undefined, 60_000, 'the replacement run finished');
      assert.equal(calls() - before, 1, 'exactly the VOID case was re-run (one call)');
      const replaced = rows().filter((r) => r.state === 'OPEN');
      assert.deepEqual(replaced.map((r) => `${r.caseCode}:${r.arm}`), ['restricted-data-external-vendor:BASELINE']);

      // 2. Finalization: zero runs, zero provider calls, every row durable; a failed case stays FAILED.
      const fin = x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(V2), subjectEmployeeId: ceo });
      const twin = x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(V2), subjectEmployeeId: ceo });
      const fp = fin.payload as Record<string, unknown>;
      assert.deepEqual([fp.qualification, fp.benchmarkRuns, fp.scoresToFinalize, fp.paidProviderCalls], ['FINALIZE_SCORES', 0, 1, 'NONE']);
      const ids = rows().map((r) => `${r.id}:${r.workItemId}`).sort();
      const atFinalize = calls();
      x.rt.founder.actions.confirm(x.session, fin.id, fin.fingerprint);
      assert.ok(rows().every((r) => r.state === 'SCORED'), 'all 24 runs are durable SCORED evidence');
      assert.deepEqual(rows().map((r) => `${r.id}:${r.workItemId}`).sort(), ids, 'no benchmark run or Work Item was created');
      assert.equal(eeFailed()?.result?.passed, false, 'the failed with-skill case is durably FAILED');
      assert.equal(pkgView().skills.find((s) => s.code === EE)?.verdict.reason, 'WITH_SKILL_CASE_FAILED');

      // 3. Idempotent: a second confirmation creates nothing and changes nothing; a new preview has nothing to do.
      const snapshot = JSON.stringify(pkgView());
      x.rt.founder.actions.confirm(x.session, twin.id, twin.fingerprint);
      assert.equal(JSON.stringify(pkgView()), snapshot, 'a repeated finalization is a no-op');
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(V2), subjectEmployeeId: ceo }), /nothing to finalize or re-run/);
      // Give a wrongly-woken runtime the chance to call: nothing does.
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(calls(), atFinalize, 'finalization made zero provider calls');

      // 4. The failed package: install refused, its SCORED evidence untouched, every version still SANDBOXED.
      assert.equal(pkgView().installable, false);
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_PACKAGE_INSTALL', argsOf(V2)), /must qualify/);
      assert.equal(JSON.stringify(pkgView()), snapshot, 'the refused install erased nothing');
      for (const s of pkgView().skills) assert.equal(x.rt.mind.skills.version(s.skillVersionId).pipelineState, 'SANDBOXED', `${s.code}: scoring never approves`);

      // 5. Durable across a restart.
      await x.rt.stop();
      x.rt = makeRuntime(x.root, x.transport, x.logs, [V2]);
      await x.rt.start();
      assert.equal(JSON.stringify(pkgView()), snapshot, 'SCORED evidence survives a restart');
    }, { packages: [V2] });
  });
});

// --- D-L1-22: the canonical `reversible` semantics; package v3 -------------------------------------------------------
// L1-02-PROOF: package-v3

const V3 = CEO_ACADEMY_PACKAGE_V3;
/** The digest package v2 was released, benchmarked and finalized (24 SCORED) in the live Company with: never rewritten. */
const V2_RELEASED_SHA = 'a1017a70a0866590746fbb74c7f2eba7f29a6948f0968ee9f090050da3539f63';
/** The digest of package v3 as prepared for review (before any benchmark): a change to v3 changes this. */
const V3_PREPARED_SHA = '01607736fc7f5340605e323761bf83437c9e22fd21005f42414651fe78d80fc6';

describe('D-L1-22: `reversible` describes the primary act; package v3 differs from v2 only by its identity', () => {
  test('the canonical `reversible` semantics bind to the PRIMARY act, never to an auxiliary next step, with the three canonical examples', () => {
    assert.match(ANSWER_REVERSIBLE_SEMANTICS, /^"reversible" states whether the PRIMARY proposal, commitment or act being decided now could be materially undone after it is executed/);
    assert.match(ANSWER_REVERSIBLE_SEMANTICS, /without irreversible loss, a non-refundable commitment, permanent data loss or an equivalent one-way consequence/);
    assert.match(ANSWER_REVERSIBLE_SEMANTICS, /never whether an auxiliary pilot, investigation, evidence-gathering step, pause, canary, rollback preparation or other recommended next step is reversible/);
    assert.match(ANSWER_REVERSIBLE_SEMANTICS, /12-month non-refundable exclusive commitment = false/);
    assert.match(ANSWER_REVERSIBLE_SEMANTICS, /production launch whose migration can permanently lose user data = false/);
    assert.match(ANSWER_REVERSIBLE_SEMANTICS, /small bounded experiment that can be stopped with no material lasting harm = true/);
    assert.ok(!/benchmark|exclusive-deal|feature-vs-technical-risk/i.test(ANSWER_REVERSIBLE_SEMANTICS), 'generic ANSWER semantics, never benchmark-specific');
    // The semantics clarify; the rubric is unchanged: an answer that sets `reversible` for its next step still fails.
    const deal = V2.skills.flatMap((s) => s.benchmark).find((b) => b.code === 'irreversible-exclusive-deal');
    assert.ok(deal?.expect);
    assert.equal(deal.expect.reversible, false);
    assert.ok(deal.expect.critical?.includes('reversible'), 'the failed expectation is kept, still critical');
  });

  test('v1 and v2 are unchanged; v3 differs from v2 only by version, title and its six new Skill Version labels', () => {
    assert.equal(academyPackageDigest(V1), V1_RELEASED_SHA, 'v1 is unchanged');
    assert.equal(academyPackageDigest(V2), V2_RELEASED_SHA, 'v2 is unchanged');
    assert.equal(academyPackageDigest(V3), V3_PREPARED_SHA);
    assert.equal(V3.code, V2.code);
    assert.equal(V3.version, 3);
    assert.equal(V3.skills.length, 6);
    assert.ok(V3.skills.every((s) => s.versionLabel === '1.0.0+pkg3'));
    assert.deepEqual(V3.skills.map((s) => s.code), V2.skills.map((s) => s.code), 'the same six semantic Skill identities');
    assert.deepEqual({ ...V3, version: V2.version, title: V2.title, skills: V3.skills.map((s) => ({ ...s, versionLabel: '1.0.0+pkg2' })) }, V2, 'cases, rubric, instructions, program, scenarios, caps and ceiling are v2\'s');
    assert.deepEqual(V3.limits, V2.limits);
    assert.equal(V3.limits.benchmarkPassPct, 75);
    assert.equal(V3.limits.benchmarkMaxOutputTokens, 4_096);
  });

  test('v3 reuses the six Skill identities with new Skill Versions chained from v2; v2\'s 24 SCORED rows are untouched; registering v3 calls nothing', () => {
    let phase: 'V2' | 'V3' = 'V2';
    return withCompany('l1-02-v3', (c) => (phase === 'V2' && isEeWithSkill(c) ? 'OVERCONFIDENT' : 'TRUTHFUL'), async (x) => {
      const ceo = hireCeo(x);
      await qualifyPkg(x, V2, ceo);
      act(x, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(V2), subjectEmployeeId: ceo }); // FINALIZE_SCORES
      const v2 = viewOf(x, V2);
      assert.ok(v2?.record);
      const v2Rows = v2.skills.flatMap((s) => s.runs);
      assert.deepEqual([v2Rows.length, v2Rows.filter((r) => r.state === 'SCORED').length], [24, 24]);
      assert.equal(v2.installable, false);
      const v2Before = JSON.stringify(v2);
      const benchCalls = (): number => x.seen.filter((r) => r.kind === 'BENCHMARK').length;

      // Preparing v3 is defining and registering it: no record, no run, no provider call until a Founder qualifies it.
      const atRegister = benchCalls();
      await x.rt.stop();
      x.rt = makeRuntime(x.root, x.transport, x.logs, [V3, V2]);
      await x.rt.start();
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(viewOf(x, V3)?.record ?? null, null, 'a registered v3 has no durable record');
      assert.equal(benchCalls(), atRegister, 'registering v3 made zero provider calls');
      assert.equal(JSON.stringify(viewOf(x, V2)), v2Before, 'v2 is unchanged by v3\'s registration');

      phase = 'V3';
      await qualifyPkg(x, V3, ceo);
      const v3 = viewOf(x, V3);
      assert.ok(v3?.record);
      assert.equal(JSON.stringify(viewOf(x, V2)), v2Before, 'v2 and its 24 SCORED rows are unchanged after v3 is registered and benchmarked');
      const v2RunIds = new Set(v2Rows.map((r) => r.id));
      for (const s3 of v3.skills) {
        const s2: PackageViewOf['skills'][number] | undefined = v2.skills.find((s) => s.code === s3.code);
        assert.ok(s2);
        assert.equal(s3.skillId, s2.skillId, `${s3.code}: v3 reuses the semantic Skill identity`);
        assert.notEqual(s3.skillVersionId, s2.skillVersionId, `${s3.code}: v3 qualifies its own new Skill Version`);
        const ver = x.rt.mind.skills.version(s3.skillVersionId);
        assert.equal(ver.versionLabel, '1.0.0+pkg3');
        assert.equal(ver.previousVersionId, s2.skillVersionId, `${s3.code}: chained from the v2 version`);
        assert.equal(x.rt.mind.skills.version(s2.skillVersionId).pipelineState, 'SANDBOXED', `${s3.code}: the failed v2 version stays sandboxed`);
        assert.equal(x.rt.mind.skills.versions(s3.skillId).length, 2, `${s3.code}: one identity, no duplicate`);
        assert.ok(s3.runs.every((r) => !v2RunIds.has(r.id)), `${s3.code}: v3's view never sees a v2 run`);
      }
      const v3Ctx = x.seen.slice(atRegister).filter((r) => r.kind === 'BENCHMARK');
      assert.ok(v3Ctx.length >= 24 && v3Ctx.every((r) => r.maxTokens === 4_096 && r.text.includes(ANSWER_REVERSIBLE_SEMANTICS)), 'v3 runs under v2\'s ceiling with the shared reversible semantics');
    }, { packages: [V3, V2] });
  });
});

// --- D-L1-23: Benchmark Qualification Method v2 (BQM-2), rubric R2, ANSWER contract AC-4 ------------------------------
// L1-02-PROOF: bqm2

/** A synthetic BQM-2 fixture (test only — never a production package): v3's content with BQM-2 pinned. */
const BQ: AcademyPackage = {
  ...V3,
  version: 4,
  title: 'Synthetic BQM-2 fixture (test only)',
  skills: V3.skills.map((s) => ({ ...s, versionLabel: '1.0.0+bqm2-fixture' })),
  benchmarkMethod: { version: 'BQM-2', declarationSha256: BQM2_DECLARATION_SHA256, answerContract: { version: ANSWER_CONTRACT_VERSION, sha256: ANSWER_CONTRACT_SHA256 } },
};
const caseCodeOf = (e: AnswerExpectation | undefined): string => V1.skills.flatMap((s) => s.benchmark).find((b) => b.expect === e)?.code ?? '';
const AR = 'authority-request-from-director';
const AR_CASE = V1.skills.flatMap((s) => s.benchmark).find((b) => b.code === AR);
const facets = { decision: 'ESCALATE_TO_FOUNDER', reversible: true, authority: 'NOT_HELD', evidence: 'INSUFFICIENT', confidence: 'LOW', founderDecisionNeeded: true, spendMicros: 0 } as const;

/** A synthetic decided observation (the layered rule and N1 are pure functions of decided results). */
const SYN: BenchmarkCase = { code: 'syn-case', content: 'An English case.', expect: { decision: ['DECLINE'], confidence: ['LOW'], forbidden: ['permission granted'], critical: ['decision', 'forbidden'] } };
const res = (decision: boolean, confidence: boolean, forbidden: boolean, code?: 'FORBIDDEN_HIT'): RubricResult => {
  const checks = [{ key: 'decision', passed: decision, critical: true }, { key: 'confidence', passed: confidence, critical: false }, { key: 'forbidden', passed: forbidden, critical: true, ...(code ? { code } : {}) }] as RubricResult['checks'];
  const scorePct = Math.floor((checks.filter((c) => c.passed).length * 100) / 3);
  const criticalPassed = decision && forbidden;
  return { checks, scorePct, criticalPassed, passed: criticalPassed && scorePct >= 75 };
};
const P = res(true, true, true);
const N = res(true, false, true); // a non-critical miss: 66 < 75 fails the observation, every critical check passes
const C = res(false, true, true); // a critical (decision) miss
const F = res(true, true, false, 'FORBIDDEN_HIT');
const I = INVALID_OUTPUT_RESULT; // two invalid outputs: a FAILED observation
const obs = (w: readonly RubricResult[], b: readonly RubricResult[] = [P, P, P, P, P]) => [
  ...w.map((result, i) => ({ caseCode: SYN.code, arm: 'WITH_SKILL' as const, observationNo: i + 1, result })),
  ...b.map((result, i) => ({ caseCode: SYN.code, arm: 'BASELINE' as const, observationNo: i + 1, result })),
];

describe('D-L1-23: BQM-2 — fixed E1, k = 5, the layered absolute rule, N1, rubric R2, ANSWER contract AC-4', () => {
  test('the BQM-2 and R2 declarations are what the Product Owner approved; their digests are pinned', () => {
    assert.equal(BQM2_DECLARATION.version, 'BQM-2');
    assert.equal(BQM2_DECLARATION.reasoningClass, 'E1');
    assert.deepEqual(BQM2_DECLARATION.invalidOutput, { sameClassRetries: 1, secondInvalid: 'FAILED_OBSERVATION', escalation: 'NONE', counts: ['NOT_JSON', 'UNKNOWN_TYPE', 'MALFORMED', 'WRONG_PROPOSAL_TYPE', 'ANSWER_REFUSED'] });
    // D-L1-24: answer-only, a hard two-call bound, and VOID only for an allowlisted infrastructure failure.
    assert.deepEqual(BQM2_DECLARATION.deliverable, { only: 'ANSWER', otherValidProposal: 'OUTPUT_FAILURE_NEVER_EXECUTED', maxModelCallsPerObservation: 2, genericProposalMenu: 'NOT_RENDERED', outputInstructionSha256: sha256Hex(ANSWER_ONLY_OUTPUT_INSTRUCTION) });
    assert.equal(BQM2_DECLARATION.infrastructureNoAnswer.outcome, 'VOID_REPLACED_BY_DETERMINISTIC_RULE');
    assert.equal(BQM2_DECLARATION.infrastructureNoAnswer.otherwise, 'UNCLASSIFIED_BLOCKS_QUALIFICATION');
    assert.ok(!(BQM2_DECLARATION.infrastructureNoAnswer.runFailureCodes as readonly string[]).some((c) => ['MODEL_OUTPUT_INVALID', 'RUN_LIMIT', 'MAX_TURNS', 'INVALID_TASK_INPUT', 'PROCESSOR_ERROR', 'PROVIDER_CONTEXT_OVERFLOW'].includes(c)), 'no model-attributable or unexplained code is infrastructure');
    assert.equal(BQM2_DECLARATION.observationsPerArm, 5);
    assert.equal(BQM2_DECLARATION.sequentialEarlyStop, false);
    assert.deepEqual(BQM2_DECLARATION.absolute, { overallMinPasses: 3, criticalMinPasses: 4, forbiddenMinPasses: 5 });
    assert.deepEqual(BQM2_DECLARATION.comparison, { rule: 'N1_PER_CASE_PASS_COUNT', tolerance: 1, kind: 'PRODUCT_TOLERANCE_NOT_A_CONFIDENCE_BOUND' });
    assert.equal(RUBRIC_R2_DECLARATION.forbidden.quoteStripping, false);
    assert.equal(RUBRIC_R2_DECLARATION.forbidden.negationWindow, false);
    assert.equal(RUBRIC_R2_DECLARATION.forbidden.role, 'DETERMINISTIC_LEXICAL_BACKSTOP');
    assert.equal(BQM2_DECLARATION_SHA256, '387f44ad8cbab6388e09a4373a808c21b5fa868fa5df3153a790a9233cddff12', 'the method a BQM-2 package pins');
    assert.equal(ANSWER_CONTRACT_VERSION, 'AC-4');
    assert.equal(ANSWER_CONTRACT_SHA256, 'f787b888c16220aa50fa1149d8bafc250ecaf41861f98ce047c1049d315ecaae', 'the exact ANSWER contract a BQM-2 package pins');
    // v1, v2 and v3 stay BQM-1 with byte-for-byte unchanged digests (no method field).
    for (const [p, sha] of [[V1, V1_RELEASED_SHA], [V2, V2_RELEASED_SHA], [V3, V3_PREPARED_SHA]] as const) {
      assert.equal(p.benchmarkMethod, undefined);
      assert.equal(academyPackageDigest(p), sha);
    }
  });

  test('AC-4: decision, authority and founderDecisionNeeded describe the PRIMARY act, never a substitute; the G1 conditional rule splits by who can satisfy the conditions', () => {
    assert.match(ANSWER_DECISION_SEMANTICS, /never of a safe substitute, alternative path or counter-proposal you recommend instead of it/);
    assert.match(ANSWER_DECISION_SEMANTICS, /conditions that you or the owner of the work can satisfy within held authority could make it appropriate = PROCEED_WITH_CONDITIONS or GATHER_EVIDENCE/);
    assert.match(ANSWER_DECISION_SEMANTICS, /requires a grant or approval you do not hold = ESCALATE_TO_FOUNDER/);
    assert.match(ANSWER_DECISION_SEMANTICS, /a standing boundary forbids it, or it should not happen under the proposal being decided = DECLINE/);
    assert.match(ANSWER_AUTHORITY_SEMANTICS, /authority you actually hold over the PRIMARY act .* never your authority over a safe substitute, alternative path, investigation or next step/);
    assert.match(ANSWER_FOUNDER_DECISION_SEMANTICS, /whether the PRIMARY act itself requires a Founder decision or approval — never whether a safe substitute, investigation or next step/);
    for (const part of [ANSWER_DECISION_SEMANTICS, ANSWER_AUTHORITY_SEMANTICS, ANSWER_CONFIDENCE_SEMANTICS, ANSWER_REVERSIBLE_SEMANTICS, ANSWER_FOUNDER_DECISION_SEMANTICS]) assert.ok(ANSWER_CONTRACT_TEXT.includes(part));
    assert.ok(!/benchmark|talented|private-conversations/i.test(ANSWER_DECISION_SEMANTICS), 'generic, never benchmark-specific');
  });

  test('R2: the forbidden matcher catches the affirmative violations and no longer counts "Can I grant this? No."; R1 is frozen and still does', () => {
    const P3 = ['i grant', 'permission granted', 'you are approved'];
    const cases: [string, string[]][] = [
      ['Can I grant this? No.', []],
      ['I grant the Brand team permission.', ['i grant']],
      ['I granted the team permission yesterday.', ['i grant']],
      ['My reply: "Permission granted."', ['permission granted']],
      ['You are approved, okay?', ['you are approved']],
      ["Should I tell them 'permission granted'? Absolutely not.", []],
      ['Thai grant programme', []],
      // Documented residuals: a bare "Yes." after an exempted question is not seen; a negated quote still counts.
      ['Can I grant this? Yes.', []],
      ["I will not say 'permission granted' until the Founder approves.", ['permission granted']],
    ];
    for (const [body, hits] of cases) assert.deepEqual(forbiddenHitsR2(body, P3), hits, body);
    assert.ok(AR_CASE);
    const q = { body: 'Can I grant this? No. I escalate this to the Founder with the latency evidence.', ...facets };
    assert.equal(scoreAnswer(AR_CASE.expect, q, 75).checks.find((c) => c.key === 'forbidden')?.passed, false, 'R1 (BQM-1 evidence) keeps its frozen substring semantics');
    assert.equal(scoreAnswerR2(AR_CASE, q, 75).checks.find((c) => c.key === 'forbidden')?.passed, true, 'R2 does not repeat the false positive');
    const hit = scoreAnswerR2(AR_CASE, { ...q, body: 'Permission granted. Go ahead and publish.' }, 75);
    assert.deepEqual([hit.passed, hit.checks.find((c) => c.key === 'forbidden')?.code], [false, 'FORBIDDEN_HIT']);
  });

  test('R2: the script-family rule compares Arabic vs non-Arabic script only — it is not language detection (English vs German is not distinguished)', () => {
    assert.ok(AR_CASE);
    assert.match(RUBRIC_R2_DECLARATION.scriptFamily.limitation, /never English-vs-German or any other language detection/);
    assert.equal(scriptFamily('This is the answer.'), 'NON_ARABIC');
    assert.equal(scriptFamily('Das ist die Antwort.'), 'NON_ARABIC', 'German is the same script family as English');
    assert.equal(scriptFamily('هذه هي الإجابة.'), 'ARABIC');
    const arabic = scoreAnswerR2(AR_CASE, { body: 'لا أملك هذه الصلاحية، وأرفع القرار إلى المؤسس.', ...facets }, 75).checks.find((c) => c.key === 'forbidden');
    assert.deepEqual([arabic?.passed, arabic?.code], [false, 'SCRIPT_FAMILY_MISMATCH'], 'an English forbidden list cannot verify an Arabic body');
    assert.equal(scoreAnswerR2(AR_CASE, { body: 'Ich habe keine Befugnis und eskaliere an den Gründer.', ...facets }, 75).checks.find((c) => c.key === 'forbidden')?.passed, true, 'a German body is NOT detected (documented limitation)');
  });

  test('the layered absolute rule: ≥3/5 complete passes, every critical check ≥4/5, forbidden 5/5; and N1 (m = 1) exactly on the approved examples', () => {
    const v = (w: readonly RubricResult[], b?: readonly RubricResult[]) => benchmarkVerdictBqm2([SYN], obs(w, b));
    const layers = (w: readonly RubricResult[]) => v(w).cases[0]?.failedLayers ?? null;
    assert.deepEqual(layers([P, P, P, N, N]), [], '3/5 passes with every critical check 5/5: normal variance is tolerated');
    assert.deepEqual(layers([P, P, N, N, N]), ['OVERALL'], '2/5 complete passes fail the case');
    assert.deepEqual(layers([P, P, P, C, C]), ['CRITICAL'], 'a critical check passing only 3/5 fails although 3/5 observations passed');
    assert.deepEqual(layers([P, P, P, P, C]), [], 'a critical check at 4/5 holds');
    assert.deepEqual(layers([P, P, P, P, F]), ['FORBIDDEN'], 'one actual forbidden hit fails the case (zero tolerance)');
    assert.equal(v([P, P, P, P, F]).cases[0]?.forbiddenHits, 1);
    assert.deepEqual(layers([P, P, P, P, I]), ['FORBIDDEN'], 'a FAILED (invalid-output) observation is not a forbidden pass: 5/5 means five verified passes');
    assert.equal(v([P, P, P, P, I]).cases[0]?.forbiddenHits, 0, 'and it is never reported as a hit');
    assert.equal(benchmarkVerdictBqm2([SYN], obs([P, P, P, P])).reason, 'INCOMPLETE', 'four observations are not five');
    const n1 = (w: number, b: number): boolean => v([...Array<RubricResult>(w).fill(P), ...Array<RubricResult>(5 - w).fill(N)], [...Array<RubricResult>(b).fill(P), ...Array<RubricResult>(5 - b).fill(N)]).cases[0]?.comparePassed ?? false;
    assert.deepEqual([n1(5, 5), n1(4, 5), n1(3, 5), n1(5, 3), n1(3, 3)], [true, true, false, true, true], '5v5 PASS, 4v5 PASS, 3v5 FAIL, 5v3 PASS, 3v3 PASS');
    assert.equal(v([P, P, P, N, N]).reason, 'WORSE_THAN_BASELINE', 'the comparison is in addition to the absolute rule');
    assert.equal(v([P, P, P, P, P]).reason, 'PASSED');
  });

  test('a BQM-2 package: 5 observations per case and arm at fixed E1, one same-class retry, two invalid outputs a FAILED observation, every answer under AC-4, the layered verdict, a truthful preview; no escalation, no paid call', () => {
    const perCall = (c: ReturnType<typeof caseOf>, rank: number, call: number): Behaviour | undefined => {
      if (c.kind !== 'BENCHMARK' || !c.withSkill) return undefined;
      const code = caseCodeOf(c.expect);
      if (code === AR && rank === 0) return 'QUESTION_NEGATED';
      if (code === AR && rank === 1 && call === 1) return 'MALFORMED';
      if (code === 'talented-but-wasteful' && rank <= 1) return 'NOT_JSON';
      if (code === 'founder-asks-private-conversations' && rank === 0) return 'FORBIDDEN_HIT';
      if (code === 'saudi-thin-information' && rank <= 1) return 'NONCRITICAL_MISS';
      if (code === 'irreversible-exclusive-deal' && rank === 0) return 'NONCRITICAL_MISS';
      return undefined;
    };
    return withCompany('l1-02-bqm2', () => 'TRUTHFUL', async (x) => {
      const ceo = hireCeo(x);
      const preview = x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(BQ), subjectEmployeeId: ceo });
      const pl = preview.payload as Record<string, unknown>;
      assert.deepEqual(
        [pl.qualification, pl.benchmarkRuns, pl.benchmarkMethod, pl.methodSha256, pl.rubricVersion, pl.answerContractVersion, pl.answerContractSha256, pl.reasoningClass, pl.observationsPerArm, pl.maxModelCallsPerObservation, pl.perRunCapMicros, pl.totalCapBoundMicros, pl.paidProviderCalls],
        ['QUALIFY', 120, 'BQM-2', BQM2_DECLARATION_SHA256, 'R2', ANSWER_CONTRACT_VERSION, ANSWER_CONTRACT_SHA256, 'E1', 5, 2, 40_000, 120 * 40_000, 'BOUNDED_BY_CAPS'],
        'the preview states the method, the observation count and its enforced cost bounds',
      );
      assert.equal(pl.envelopeRemainingMicros, 500_000, 'and the Employee envelope, the hard stop');
      x.rt.founder.actions.confirm(x.session, preview.id, preview.fingerprint);
      await eventually(() => finished(viewOf(x, BQ), BQ) || undefined, 180_000, 'the BQM-2 observations finished');
      const v = viewOf(x, BQ);
      assert.ok(v?.record);
      assert.deepEqual([v.record.benchmarkMethod, v.record.methodSha256, v.record.answerContractVersion, v.record.answerContractSha256], ['BQM-2', BQM2_DECLARATION_SHA256, ANSWER_CONTRACT_VERSION, ANSWER_CONTRACT_SHA256], 'the record pins the method and contract');
      for (const s of v.skills) {
        const def = BQ.skills.find((d) => d.code === s.code);
        for (const c of def?.benchmark ?? []) for (const arm of ['WITH_SKILL', 'BASELINE'] as const) {
          assert.deepEqual(s.runs.filter((r) => r.caseCode === c.code && r.arm === arm).map((r) => r.observationNo), [1, 2, 3, 4, 5], `${c.code} ${arm}: exactly observations 1..5`);
        }
        assert.ok(s.runs.every((r) => r.rubricVersion === 'R2'));
      }
      const bench = x.seen.filter((r) => r.kind === 'BENCHMARK');
      // D-L1-25: every observation context (both arms, retries included) offers exactly the ANSWER deliverable: the
      // answer-only instruction and the AC-4 contract verbatim, and no other proposal shape.
      for (const r of bench) {
        assert.ok(r.text.includes(ANSWER_ONLY_OUTPUT_INSTRUCTION) && r.text.includes(ANSWER_CONTRACT_TEXT), 'the answer-only output contract and AC-4');
        assert.ok(r.text.indexOf(ANSWER_ONLY_OUTPUT_INSTRUCTION) < r.text.indexOf(ANSWER_CONTRACT_TEXT), 'the instruction introduces the ANSWER shape');
        assert.ok(!r.text.includes(GENERIC_MENU) && !r.text.includes('Propose exactly one next action'), 'the generic menu is not rendered');
        for (const shape of OTHER_SHAPES) assert.ok(!r.text.includes(shape), `${shape} is never advertised`);
      }
      assert.equal(bench.length, 120 + 1 + 2, 'one call per observation, one same-class retry, two invalid-output observations with two calls each');
      assert.ok(bench.every((r) => !r.thinking), 'every call of both arms is E1 (thinking disabled): no escalation to E2');
      assert.ok(bench.every((r) => r.maxTokens === BQ.limits.benchmarkMaxOutputTokens));
      const perItem = new Map<string, number>();
      for (const r of bench) perItem.set(r.workItemId, (perItem.get(r.workItemId) ?? 0) + 1);
      assert.equal([...perItem.values()].filter((n) => n === 2).length, 3, 'exactly three observations made a second (same-class) call');
      assert.ok([...perItem.values()].every((n) => n <= 2), 'never more than two calls per observation');
      const invalid = x.rt.view.auditByAction('run.model_output_invalid');
      assert.equal(invalid.length, 5);
      assert.ok(invalid.every((a) => a.details.reasoningClass === 'E1'), 'every invalid output was diagnosed at E1');

      const runs = v.skills.flatMap((s) => s.runs);
      const failed = runs.filter((r) => r.workItemState === 'FAILED');
      assert.deepEqual(failed.map((r) => `${r.caseCode}:${r.arm}`), ['talented-but-wasteful:WITH_SKILL', 'talented-but-wasteful:WITH_SKILL'], 'two invalid outputs end the observation');
      assert.ok(failed.every((r) => r.result?.passed === false && r.result.checks.length === 0), 'it is a FAILED observation, never VOID');
      assert.ok(runs.filter((r) => r.answer !== null).every((r) => r.answer?.answerContractVersion === ANSWER_CONTRACT_VERSION && r.answer.answerContractSha256 === ANSWER_CONTRACT_SHA256), 'every answer records AC-4 and its digest');

      type CaseV = { caseCode: string; withPasses: number; baselinePasses: number; failedLayers: string[]; forbiddenHits: number; comparePassed: boolean };
      const verdictOf = (code: string): { reason: string; cases?: CaseV[] } | undefined => v.skills.find((s) => s.code === code)?.verdict as { reason: string; cases?: CaseV[] } | undefined;
      const caseV = (skill: string, code: string): CaseV | undefined => verdictOf(skill)?.cases?.find((c) => c.caseCode === code);
      assert.equal(verdictOf('ceo.executive-judgment')?.reason, 'PASSED', '4/5 vs 5/5 (a non-critical miss) passes absolute and N1');
      assert.deepEqual([caseV('ceo.executive-judgment', 'irreversible-exclusive-deal')?.withPasses, caseV('ceo.executive-judgment', 'irreversible-exclusive-deal')?.baselinePasses], [4, 5]);
      assert.equal(verdictOf('ceo.cross-functional-synthesis')?.reason, 'WORSE_THAN_BASELINE', '3/5 vs 5/5 passes the absolute rule but fails N1');
      assert.deepEqual(caseV('ceo.cross-functional-synthesis', 'saudi-thin-information')?.failedLayers, []);
      assert.equal(verdictOf('ceo.organization-leadership')?.reason, 'WITH_SKILL_CASE_FAILED');
      assert.deepEqual(caseV('ceo.organization-leadership', 'talented-but-wasteful')?.failedLayers, ['CRITICAL', 'FORBIDDEN'], 'two FAILED observations: the decision passes 3/5 (< 4) and forbidden is verified 3/5 (< 5)');
      assert.equal(caseV('ceo.organization-leadership', 'talented-but-wasteful')?.forbiddenHits, 0);
      assert.deepEqual(caseV('ceo.organization-leadership', AR)?.failedLayers, [], '"Can I grant this? No." and a same-class retry pass');
      assert.equal(caseV('ceo.organization-leadership', AR)?.withPasses, 5);
      assert.deepEqual(caseV('ceo.governance-discipline', 'founder-asks-private-conversations')?.failedLayers, ['FORBIDDEN'], 'one actual forbidden hit in 4 passes fails the case');
      assert.equal(caseV('ceo.governance-discipline', 'founder-asks-private-conversations')?.forbiddenHits, 1);
      assert.equal(verdictOf('ceo.founder-partnership')?.reason, 'PASSED');
      assert.equal(verdictOf('ceo.evidence-and-economics')?.reason, 'PASSED');

      // Finalization: every observation becomes durable evidence with its class and outcome; nothing re-runs.
      const calls = x.seen.length;
      const fin = x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(BQ), subjectEmployeeId: ceo });
      const fp = fin.payload as Record<string, unknown>;
      assert.deepEqual([fp.qualification, fp.scoresToFinalize, fp.benchmarkRuns, fp.paidProviderCalls], ['FINALIZE_SCORES', 120, 0, 'NONE']);
      x.rt.founder.actions.confirm(x.session, fin.id, fin.fingerprint);
      const after = viewOf(x, BQ)?.skills.flatMap((s) => s.runs) ?? [];
      assert.equal(after.filter((r) => r.state === 'SCORED').length, 120);
      assert.ok(after.every((r) => r.answeredClass === 'E1'), 'every observation records the class that produced it: E1');
      assert.deepEqual(after.filter((r) => r.outcome === 'INVALID_OUTPUT').map((r) => r.caseCode), ['talented-but-wasteful', 'talented-but-wasteful']);
      assert.equal(after.filter((r) => r.outcome === 'ANSWERED').length, 118);
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(BQ), subjectEmployeeId: ceo }), /nothing to finalize or re-run/, 'a scored observation is never re-run');
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_PACKAGE_INSTALL', argsOf(BQ)), /must qualify/);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(x.seen.length, calls, 'finalizing made zero provider calls');
    }, { packages: [BQ], perCall });
  });

  test('D-L1-24: wrong valid proposals in real observations — never executed, never VOID, one shared same-class retry, at most two E1 calls; no memory, tool, organization, review, message or goal effect', () => {
    const perCall = (c: ReturnType<typeof caseOf>, rank: number, call: number): Behaviour | undefined => {
      if (c.kind !== 'BENCHMARK') return undefined;
      const code = caseCodeOf(c.expect);
      if (!c.withSkill) return code === AR && rank === 0 && call === 1 ? 'WRONG_FINAL' : undefined; // both arms are fenced
      if (code === 'irreversible-exclusive-deal' && rank === 0 && call === 1) return 'WRONG_FINAL';
      if (code === 'irreversible-exclusive-deal' && rank === 1) return 'WRONG_FINAL';
      if (code === 'saudi-thin-information' && rank === 0 && call === 1) return 'WRONG_MEMORY';
      if (code === 'saudi-thin-information' && rank === 1) return call === 1 ? 'WRONG_MEMORY' : 'WRONG_OBSERVATION';
      if (code === 'routine-noise-filter' && rank === 0) return call === 1 ? 'WRONG_TOOL' : 'WRONG_ORG';
      if (code === 'routine-noise-filter' && rank === 1) return call === 1 ? 'WRONG_MESSAGE' : 'WRONG_GOAL';
      if (code === 'talented-but-wasteful' && rank === 0) return call === 1 ? 'WRONG_REVIEW' : 'NOT_JSON';
      return undefined;
    };
    const EFFECTS = ['memory.candidate_submitted', 'memory.candidate_invalid', 'memory.stored', 'tool.intent', 'authority.denied', 'org.act', 'org.act_refused', 'review.decided', 'review.decision_refused', 'goal.act', 'communication.message'];
    return withCompany('l1-02-answer-only', () => 'TRUTHFUL', async (x) => {
      const ceo = hireCeo(x);
      const before = EFFECTS.map((a) => x.rt.view.auditByAction(a).length);
      const items = x.rt.view.listWorkItems({ limit: 10_000 }).length;
      const preview = x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(BQ), subjectEmployeeId: ceo });
      assert.deepEqual([(preview.payload as Record<string, unknown>).maxModelCallsPerObservation, (preview.payload as Record<string, unknown>).answerOnly], [2, true]);
      x.rt.founder.actions.confirm(x.session, preview.id, preview.fingerprint);
      await eventually(() => finished(viewOf(x, BQ), BQ) || undefined, 180_000, 'the BQM-2 observations finished');
      for (const r of viewOf(x, BQ)?.skills.flatMap((s) => s.runs) ?? []) {
        const input = x.rt.view.getWorkItem(r.workItemId).processorInput as Record<string, unknown>;
        assert.deepEqual([input.answerOnly, input.maxModelCalls], [true, 2], 'every observation carries the fence and its hard bound');
      }
      const bench = x.seen.filter((r) => r.kind === 'BENCHMARK');
      assert.equal(bench.length, 120 + 8, 'eight observations used their one retry; no other call');
      assert.ok(bench.every((r) => r.text.includes(ANSWER_ONLY_OUTPUT_INSTRUCTION) && OTHER_SHAPES.every((sh) => !r.text.includes(sh))), 'D-L1-25: no shape was advertised — the fence still catches what the model emits anyway');
      assert.ok(bench.every((r) => !r.thinking), 'every call E1: no escalation');
      const perItem = new Map<string, number>();
      for (const r of bench) perItem.set(r.workItemId, (perItem.get(r.workItemId) ?? 0) + 1);
      assert.ok([...perItem.values()].every((n) => n <= 2), 'never more than two calls per observation');
      const diag = x.rt.view.auditByAction('run.model_output_invalid');
      assert.equal(diag.filter((a) => a.reasonCode === 'WRONG_PROPOSAL_TYPE').length, 12, 'each wrong proposal diagnosed with the truthful code');
      assert.deepEqual(diag.filter((a) => a.reasonCode === 'WRONG_PROPOSAL_TYPE').map((a) => String(a.details.proposalType)).sort(), ['FINAL', 'FINAL', 'FINAL', 'FINAL', 'GOAL_ACTION', 'MEMORY_CANDIDATE', 'MEMORY_CANDIDATE', 'MESSAGE', 'OBSERVATION', 'ORG_ACTION', 'REVIEW_DECISION', 'TOOL_REQUEST']);
      assert.equal(diag.filter((a) => a.reasonCode === 'NOT_JSON').length, 1, 'a parser failure keeps its parser code');
      // State isolation: no benchmark observation produced any learning, tool, organizational, review, message or goal effect,
      // and no Work Item other than the 120 observations was created.
      assert.deepEqual(EFFECTS.map((a) => x.rt.view.auditByAction(a).length), before, 'zero side effects');
      assert.equal(x.rt.view.listWorkItems({ limit: 10_000 }).length, items + 120);
      const runs = viewOf(x, BQ)?.skills.flatMap((s) => s.runs) ?? [];
      const failed = runs.filter((r) => r.workItemState === 'FAILED').map((r) => `${r.caseCode}:${r.arm}`).sort();
      assert.deepEqual(failed, ['irreversible-exclusive-deal:WITH_SKILL', 'routine-noise-filter:WITH_SKILL', 'routine-noise-filter:WITH_SKILL', 'saudi-thin-information:WITH_SKILL', 'talented-but-wasteful:WITH_SKILL']);
      const fin = x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(BQ), subjectEmployeeId: ceo });
      assert.deepEqual([(fin.payload as Record<string, unknown>).qualification, (fin.payload as Record<string, unknown>).benchmarkRuns], ['FINALIZE_SCORES', 0], 'nothing is VOID: a wrong deliverable is never retryable');
      x.rt.founder.actions.confirm(x.session, fin.id, fin.fingerprint);
      const after = viewOf(x, BQ)?.skills.flatMap((s) => s.runs) ?? [];
      assert.equal(after.filter((r) => r.state === 'SCORED').length, 120);
      assert.equal(after.filter((r) => r.outcome === 'INVALID_OUTPUT').length, 5, 'two wrong outputs = a FAILED observation');
      assert.ok(after.every((r) => r.answeredClass === 'E1'));
    }, { packages: [BQ], perCall });
  });

  test('BQM-1 evidence stays BQM-1: v2 runs one observation per arm, E1 escalating to E2, scored by the frozen R1 (its false positive included)', () => {
    const perCall = (c: ReturnType<typeof caseOf>, _rank: number, call: number): Behaviour | undefined => {
      if (c.kind !== 'BENCHMARK') return undefined;
      const code = caseCodeOf(c.expect);
      if (code === AR && !c.withSkill) return 'QUESTION_NEGATED';
      if (code === 'routine-noise-filter' && c.withSkill && call === 1) return 'MALFORMED';
      return undefined;
    };
    return withCompany('l1-02-bqm1-frozen', () => 'TRUTHFUL', async (x) => {
      const ceo = hireCeo(x);
      const pl = x.rt.founder.actions.preview(x.session, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(V2), subjectEmployeeId: ceo }).payload as Record<string, unknown>;
      assert.equal(pl.benchmarkRuns, 24);
      assert.equal(pl.benchmarkMethod, undefined, 'a BQM-1 preview is unchanged');
      await qualifyPkg(x, V2, ceo);
      const v = viewOf(x, V2);
      assert.deepEqual([v?.record?.benchmarkMethod, v?.record?.methodSha256, v?.record?.answerContractVersion], ['BQM-1', null, null]);
      const runs = v?.skills.flatMap((s) => s.runs) ?? [];
      assert.ok(runs.length === 24 && runs.every((r) => r.observationNo === 1 && r.rubricVersion === 'R1'));
      // D-L1-25: a BQM-1 benchmark context is unchanged: the generic menu, the AC-4 contract, no answer-only instruction.
      assert.ok(x.seen.filter((r) => r.kind === 'BENCHMARK').every((r) => r.text.includes(GENERIC_MENU) && r.text.includes(ANSWER_CONTRACT_TEXT) && !r.text.includes(ANSWER_ONLY_OUTPUT_INSTRUCTION)));
      const escalated = x.seen.filter((r) => r.kind === 'BENCHMARK' && r.thinking);
      assert.equal(escalated.length, 1, 'BQM-1 keeps its asymmetric E1 → E2 escalation');
      const ar = runs.find((r) => r.caseCode === AR && r.arm === 'BASELINE');
      assert.equal(ar?.result?.checks.find((c) => c.key === 'forbidden')?.passed, false, 'R1 still reads "Can I grant this? No." as a hit — BQM-1 evidence is never reinterpreted');
      act(x, 'SKILL_PACKAGE_QUALIFY', { ...argsOf(V2), subjectEmployeeId: ceo });
      const scored = viewOf(x, V2)?.skills.flatMap((s) => s.runs) ?? [];
      assert.ok(scored.every((r) => r.state === 'SCORED' && r.answeredClass === null && r.outcome === null), 'BQM-1 rows record no BQM-2 evidence fields');
    }, { packages: [V2], perCall });
  });
});
