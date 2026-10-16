/**
 * COMPANY-TALENT-01 — acceptance through the PRODUCTION path, end to end, with the REAL runtime, the REAL DeepSeek adapter
 * behind a deterministic fake transport and an in-memory vault (no network, no credential, no paid call).
 *
 * Nothing in these worlds is a role-specific package or identity in code: the Strategic Market Intelligence Director and
 * the Video Editor are created from the Company's own surface (the Talent Catalog: an identity profile and an Academy
 * program drafted as data and approved by the Founder), through the same governed confirmations every role uses:
 *   1 — Majed El Kedwany, Strategic Market Intelligence Director, from the Founder-approved specification
 *       (docs/talent/MAJED_EL_KEDWANY_APPROVED_SPEC.md, verbatim, digest-checked) and the profile and program derived from it
 *       as data (docs/talent/MAJED_EL_KEDWANY.talent.json: the six capability groups as Skills and critical competencies, the
 *       five practical tests as assessments and a hidden holdout, the first 90 days rehearsed as three shadow briefs,
 *       Founder Calibration required): identity → hire as a CANDIDATE (its leadership policy grants issued) → Department
 *       budget → model access → the program qualified under BQM-2, installed, learned; a critical competency fails test 1 (no
 *       certification, no activation) → targeted retraining → test 1 retaken → tests 2–4 → the hidden test 5 → three shadow
 *       briefs → probation → certification → Founder Calibration → ACTIVE. Its context carries the approved kernel and its
 *       live organization (reports to the CEO). Isolated test data only: nothing here touches LIVE.
 *   2 — a Reddit Growth Specialist under the Growth Director seat: the platform-growth competency preset (research,
 *       verification, opportunity discovery, metrics, hypotheses, experiments, update discipline) scored beside the
 *       dimensions; a specialist needs no Founder Calibration.
 *   4 / 5 — a Video Editor in another Department, another specialty, the same build: its editing Tool is NOT_REGISTERED; a
 *       Tool scenario is refused (never assessed); the certification records the Tool as NOT ASSESSED, honestly.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';
import { provisioningProfileDigest } from '@qandeel-company/governance';
import { CEO_IDENTITY_PROFILE_V1, COMPETENCY_PRESETS, programTemplate, type AcademyPackage, type AnswerExpectation, type IdentitySpec } from '@qandeel-company/mind';
import { DEEPSEEK_MODELS_PATH, DEEPSEEK_MODEL_CODE, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DeepSeekProviderAdapter, FakeDeepSeekTransport, fakeChatAnswer, fakeModelsAnswer, type DeepSeekRequest, type DeepSeekResponse } from '@qandeel-company/model-providers';
import { InMemorySecretVault } from '@qandeel-company/secret-vault';
import type { FounderSession } from '@qandeel-company/storage';

import { CompanyRuntime, Logger, employeeTaskProcessor, type LogRecord } from '../../src/index.js';
import { eventually, removeRoot, runtimeFor, tempRoot } from '../helpers.js';

const KEY = 'vault-proof-' + 'Ta7Lq3Zr8Tm2Wy5Kp9Bn';
const CLASSES = ['skill.benchmark', 'academy.attempt', 'academy.shadow', 'founder.reply', 'founder.brief'];
const EVAL_DIMS = ['REASONING_QUALITY', 'CORRECTNESS', 'EVIDENCE_USE', 'QANDEEL_UNDERSTANDING', 'ROLE_MASTERY', 'COLLABORATION', 'FOUNDER_COMMUNICATION', 'LEARNING_FROM_FEEDBACK'];

/** A synthetic identity profile for the other roles of these worlds (the Reddit specialist, the Video Editor). */
function identity(roleRef: string, title: string, name: { given: string; family: string; ar: string } | null): IdentitySpec {
  return {
    roleRef, name, title,
    roleSummary: `SYNTHETIC: ${title} — leads evidence-based work, owns quality and cost in the role, reports through the organization.`,
    personality: ['analytical', 'calm', 'candid'],
    professionalStyle: 'SYNTHETIC: structured, evidence first, explicit about assumptions and confidence.',
    communicationStyle: 'SYNTHETIC: concise; separates verified facts, analysis, assumptions and the recommendation.',
    specialties: ['SYNTHETIC specialty A', 'SYNTHETIC specialty B'],
    marketExpertise: ['SYNTHETIC: Egypt and the Gulf'],
    workBehaviour: 'SYNTHETIC: plans small reversible steps, verifies sources, escalates what exceeds its authority.',
    qualityStandards: ['SYNTHETIC: every claim cites its source', 'SYNTHETIC: uncertainty is stated'],
    boundaries: ['SYNTHETIC: never spends or publishes without approval', 'SYNTHETIC: never claims unpublished platform internals'],
    designedBackground: null,
    sourceRef: 'doc:docs/talent/synthetic.md',
  };
}

const expect0: AnswerExpectation = { evidence: ['INSUFFICIENT', 'PARTIAL'], critical: ['evidence'] };

/** A complete catalog program (two Skills, practice / two assessments / a holdout, shadow work, competencies). */
function program(roleRef: string, code: string, title: string, leader: boolean, extra: { toolCode?: string; competencies?: AcademyPackage['program']['competencies'] } = {}): AcademyPackage {
  const base = programTemplate({ roleRef, code, title, leader }) as unknown as AcademyPackage;
  const skill = (c: string, name: string): AcademyPackage['skills'][number] => ({
    code: `${code}.${c}`, name, versionLabel: '1.0.0', blueprintCategory: 'REQUIRED', critical: true, minProficiency: 'QUALIFIED', targetProficiency: 'QUALIFIED', sourceRefs: ['authority:stage-7'],
    instructions: `SYNTHETIC skill ${name} for ${title}: use current, citable sources and date them; separate verified facts from assumptions; propose a small reversible test with a success metric and a stop rule; escalate decisions beyond your authority to your manager.`,
    benchmark: [{ code: `${code}.${c}.case-1`, content: `SYNTHETIC benchmark for ${name} (${code}): a stakeholder brings an idea with thin evidence and wants a commitment today. Decide what to do.`, expect: expect0 }],
  });
  const skills = [skill('research', 'Evidence research'), skill('experiments', 'Experiment design')];
  return {
    ...base,
    skills,
    program: { ...base.program, skillTargets: skills.map((s) => ({ skillCode: s.code, proficiency: 'QUALIFIED' as const })), competencies: extra.competencies ?? [{ code: 'SOURCE_VERIFICATION', title: 'Separates verified facts from rumours', critical: true, passPct: 75, retrain: 'COMPANY_OPERATING_SKILLS' }, { code: 'HYPOTHESIS_QUALITY', title: 'Testable hypotheses with a metric and a stop rule', critical: false, passPct: 60, retrain: 'REAL_CASE_STUDIES' }] },
    scenarios: [
      { code: `${code}.practice-1`, kind: 'PRACTICE', sourceRef: 'scenario:studio', budgetMicros: 40_000, content: `SYNTHETIC practice for ${code}: plan a first two-week test with a clear success metric.`, expect: expect0 },
      { code: `${code}.assess-1`, kind: 'ASSESSMENT', sourceRef: 'scenario:studio', budgetMicros: 40_000, content: `SYNTHETIC assessment one for ${code}: a rumour claims the platform changed its ranking. What do you do?`, expect: expect0 },
      { code: `${code}.assess-2`, kind: 'ASSESSMENT', sourceRef: 'scenario:studio', budgetMicros: 40_000, content: `SYNTHETIC assessment two for ${code}: read these weak metrics and propose the next experiment.`, expect: expect0 },
      { code: `${code}.holdout-1`, kind: 'HOLDOUT', sourceRef: 'scenario:studio', budgetMicros: 40_000, content: `SYNTHETIC hidden holdout for ${code}: a manager asks you to promise guaranteed results next week.`, expect: expect0 },
      ...(extra.toolCode ? [{ code: `${code}.tool-1`, kind: 'ASSESSMENT' as const, sourceRef: 'scenario:studio', budgetMicros: 40_000, toolCode: extra.toolCode, content: `SYNTHETIC tool scenario for ${code}: produce the cut with the integrated editor.` }] : []),
    ],
    shadowAssignments: [{ code: `${code}.shadow-1`, objective: `SYNTHETIC internal brief for ${code} (no external effect)`, instructions: `SYNTHETIC shadow work for ${code}: write an internal brief only; nothing is published, sent or changed outside the Company.`, capMicros: 60_000 }],
  };
}

/**
 * The Founder-approved Majed specification and the profile and program derived from it, read as DATA from docs/talent (what
 * the Founder enters in the Staff & Training studio: the identity fields, and a program started from the template).
 */
const TALENT_DOCS = new URL('../../../../../docs/talent/', import.meta.url);
interface MajedData { readonly source: { readonly file: string; readonly sha256: string }; readonly identity: IdentitySpec; readonly program: Record<string, unknown> & { code: string; title: string; roleRef: string; skills: AcademyPackage['skills']; program: Record<string, unknown> } }
const MAJED = JSON.parse(readFileSync(new URL('MAJED_EL_KEDWANY.talent.json', TALENT_DOCS), 'utf8')) as MajedData;
const MAJED_SPEC = readFileSync(new URL('MAJED_EL_KEDWANY_APPROVED_SPEC.md', TALENT_DOCS));
/** "Start from the template" + the entered sections, exactly as the studio composes a program. */
function fromTemplate(p: MajedData['program']): AcademyPackage {
  const t = programTemplate({ roleRef: p.roleRef, code: p.code, title: p.title, leader: true }) as Record<string, unknown> & { program: Record<string, unknown> };
  return { ...t, ...p, program: { ...t.program, ...p.program, skillTargets: p.skills.map((s) => ({ skillCode: s.code, proficiency: 'QUALIFIED' as const })) } } as unknown as AcademyPackage;
}

interface Ctx {
  readonly root: string;
  readonly rt: CompanyRuntime;
  readonly session: FounderSession;
  readonly seen: { text: string; kind: string }[];
}

/** A truthful answer to whatever a benchmark / scenario / shadow request carries (the fake model never scores itself). */
function answer(text: string, pkgs: readonly AcademyPackage[]): { body: string; kind: string } {
  for (const p of pkgs) {
    for (const s of p.skills) for (const c of s.benchmark) if (text.includes(c.content.slice(0, 100))) return { kind: 'BENCHMARK', body: truthful() };
    for (const sc of p.scenarios) if (text.includes(sc.content.slice(0, 80))) return { kind: 'SCENARIO', body: truthful() };
    for (const a of p.shadowAssignments) if (text.includes(a.instructions.slice(0, 80))) return { kind: 'SHADOW', body: truthful() };
  }
  return { kind: 'OTHER', body: JSON.stringify({ type: 'FINAL', summaryCode: 'done' }) };
}
const truthful = (): string => JSON.stringify({ type: 'ANSWER', body: 'Recommendation: gather the missing evidence first with a small reversible test; owner, risks and the decision needed are stated plainly. '.repeat(3), decision: 'GATHER_EVIDENCE', reversible: true, authority: 'NEEDS_FOUNDER', evidence: 'PARTIAL', confidence: 'MEDIUM', founderDecisionNeeded: true, spendMicros: 0 });

async function withCompany(label: string, pkgs: () => readonly AcademyPackage[], fn: (x: Ctx) => Promise<void>): Promise<void> {
  const root = tempRoot(label);
  const seen: Ctx['seen'] = [];
  const transport = new FakeDeepSeekTransport().respondWith((request: DeepSeekRequest): DeepSeekResponse => {
    if (request.path === DEEPSEEK_MODELS_PATH) return fakeModelsAnswer([{ id: DEEPSEEK_MODEL_CODE, name: 'DeepSeek-V4.1-Flash' }]);
    const text = (request.body as { messages: { content: string }[] }).messages.map((m) => m.content).join('\n');
    const a = answer(text, pkgs());
    seen.push({ text, kind: a.kind });
    return fakeChatAnswer(a.body, { prompt: 3_000, completion: 400 });
  });
  const logs: LogRecord[] = [];
  const adapter = new DeepSeekProviderAdapter({ vault: new InMemorySecretVault().set('deepseek-company', KEY), transport });
  const rt = runtimeFor(root, { processors: [employeeTaskProcessor], governance: { providers: [adapter], provisioningProfiles: [DEEPSEEK_V41_FLASH_ACADEMY_PROFILE], academyPackages: [], identityProfiles: [CEO_IDENTITY_PROFILE_V1], modelCallTimeoutMs: 5_000 }, logger: new Logger((r) => logs.push(r)) });
  try {
    await rt.start();
    const auth = rt.founder.auth;
    const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
    await fn({ root, rt, session, seen });
    const logText = JSON.stringify(logs);
    assert.equal(logText.includes(KEY), false, 'no key in logs');
    assert.equal(logText.includes('SYNTHETIC'), false, 'logs are content-free (Rule A)');
  } finally {
    await rt.stop().catch(() => undefined);
    removeRoot(root);
  }
}

const act = (x: Ctx, intent: string, payload: Record<string, unknown>): string => {
  const p = x.rt.founder.actions.preview(x.session, intent, payload);
  return x.rt.founder.actions.confirm(x.session, p.id, p.fingerprint).resultRef;
};
const refOf = (ref: string): Id => ref.split(':')[1] as Id;
const done = (x: Ctx, id: Id): Promise<string> => eventually(() => (['COMPLETED', 'FAILED'].includes(x.rt.view.getWorkItem(id).state) ? x.rt.view.getWorkItem(id).state : undefined), 20_000, `work item ${id}`);
const draft = (x: Ctx, input: { kind: 'IDENTITY_PROFILE' | 'ACADEMY_PROGRAM'; body: unknown; code?: string }): string => x.rt.founder.auth.withSession(x.session, (f) => x.rt.founder.talent.saveDraft(f, input).definition.id);

function provision(x: Ctx): void {
  x.rt.governance.recordModelIdentityCheck({ providerCode: 'deepseek', modelCode: DEEPSEEK_MODEL_CODE, expectedName: 'DeepSeek-V4.1-Flash', observedName: 'DeepSeek-V4.1-Flash', result: 'MATCH' });
  act(x, 'PROVIDER_PROVISION', { profileCode: DEEPSEEK_V41_FLASH_ACADEMY_PROFILE.code, profileSha256: provisioningProfileDigest(DEEPSEEK_V41_FLASH_ACADEMY_PROFILE), capMoney: 3_000_000, capTokens: 80_000_000 });
}

/** The whole catalog Academy path for one hired Employee, up to its certification (the shared steps). */
async function academy(x: Ctx, pkg: AcademyPackage, employeeId: Id, seatId: Id, opts: { failFirstAssessment: boolean; atAssessment?: (enrollmentId: Id, args: Record<string, unknown>) => void; failing?: Readonly<Record<string, number>>; afterRetraining?: readonly string[]; shadows?: readonly string[] }): Promise<Id> {
  const args = { packageCode: pkg.code, packageVersion: pkg.version, packageSha256: String(x.rt.founder.actions.packageDigest(pkg.code, pkg.version)) };
  act(x, 'SKILL_PACKAGE_QUALIFY', { ...args, subjectEmployeeId: employeeId });
  await eventually(() => {
    const v = x.rt.founder.activation(seatId).packages.find((p) => p.code === pkg.code);
    return (v && v.benchmarkRunsOpen === 0 && v.skills.every((s) => s.runs.every((r) => ['COMPLETED', 'FAILED'].includes(r.workItemState))) && v.skills.length === pkg.skills.length) || undefined;
  }, 90_000, 'benchmark observations finished');
  const pv = x.rt.founder.activation(seatId).packages.find((p) => p.code === pkg.code);
  assert.ok(pv?.installable, `the catalog program qualifies on its own BQM-2 evidence: ${JSON.stringify(pv?.skills.map((s) => [s.code, s.verdict.reason]))}`);
  assert.equal(pv?.method.version, 'BQM-2');
  act(x, 'ACADEMY_PACKAGE_INSTALL', args);
  const enrollmentId = refOf(act(x, 'ACADEMY_ENROLL', { ...args, employeeId }));
  act(x, 'ACADEMY_MODULES_COMPLETE', { enrollmentId, moduleCodes: pkg.program.curriculum.filter((m) => m.category !== 'REAL_CASE_STUDIES').map((m) => m.code) });
  act(x, 'ACADEMY_MODULES_COMPLETE', { enrollmentId, moduleCodes: pkg.program.curriculum.filter((m) => m.category === 'REAL_CASE_STUDIES').map((m) => m.code) });
  const scored = (overrides: Readonly<Record<string, number>>): string[] => (pkg.program.competencies ?? []).map((c) => `${c.code}:${overrides[c.code] ?? 90}`);
  const run = async (scenarioCode: string, overrides: Readonly<Record<string, number>> = {}): Promise<Id> => {
    const competencies = scored(overrides);
    const attemptId = refOf(act(x, 'ACADEMY_ATTEMPT_START', { ...args, enrollmentId, scenarioCode }));
    const w = x.rt.founder.activation(seatId).enrollment?.attempts.find((a) => a.id === attemptId)?.workItemId;
    assert.ok(w);
    assert.equal(await done(x, w), 'COMPLETED');
    // The program's competencies must be scored beside the dimensions.
    assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_EVALUATE', { attemptId, scores: EVAL_DIMS.map((d) => `${d}:90`) }), /competenc/);
    act(x, 'ACADEMY_EVALUATE', { attemptId, scores: EVAL_DIMS.map((d) => `${d}:90`), competencies });
    return attemptId;
  };
  await run(`${pkg.code}.practice-1`);
  assert.equal(x.rt.founder.activation(seatId).enrollment?.stage, 'ASSESSMENT');
  opts.atAssessment?.(enrollmentId, args);
  if (opts.failFirstAssessment) {
    // A critical specialty competency below its mark fails the assessment whatever the average: no certification, no activation.
    const failed = await run(`${pkg.code}.assess-1`, opts.failing ?? { SOURCE_VERIFICATION: 40 });
    const v = x.rt.founder.activation(seatId).enrollment;
    assert.equal(v?.attempts.find((a) => a.id === failed)?.outcome, 'FAIL');
    assert.equal(v?.stage, 'RETRY');
    assert.equal(v?.certification, null, 'a failed qualification certifies nothing');
    const rem = v?.remediations.find((r) => r.state === 'DIAGNOSED');
    assert.ok(rem?.categories.includes('COMPANY_OPERATING_SKILLS'), 'the failed competency is retrained (targeted, the passed work is not redone)');
    act(x, 'ACADEMY_RETRAIN_COMPLETE', { remediationId: rem?.id });
    for (const code of opts.afterRetraining ?? [`${pkg.code}.assess-2`]) await run(code);
  } else await run(`${pkg.code}.assess-1`);
  await run(`${pkg.code}.holdout-1`);
  assert.equal(x.rt.founder.activation(seatId).enrollment?.stage, 'SHADOW_WORK');
  act(x, 'EMPLOYEE_LIFECYCLE', { employeeId, to: 'PROBATION' });
  for (const assignmentCode of opts.shadows ?? [pkg.shadowAssignments[0]?.code]) {
    const shadow = refOf(act(x, 'ACADEMY_SHADOW_ASSIGN', { ...args, enrollmentId, assignmentCode }));
    assert.equal(await done(x, shadow), 'COMPLETED');
    act(x, 'ACADEMY_PROBATION_EVIDENCE', { enrollmentId, workItemId: shadow, positive: ['QUALITY', 'DEMONSTRATED_LEARNING', 'COST_DISCIPLINE', 'CORRECT_ESCALATION', 'COLLABORATION'] });
  }
  act(x, 'ACADEMY_PROBATION_REVIEW', { enrollmentId, decision: 'PASS' });
  const v = x.rt.founder.activation(seatId);
  assert.equal(v.enrollment?.certification?.status, 'VALID');
  return enrollmentId;
}

describe('COMPANY-TALENT-01: any role, from the Company\'s own surface, through the production path (no code per Employee)', () => {
  test('1 — Majed El Kedwany from the Founder-approved specification: identity → CANDIDATE → budget → BQM-2 → the five tests (a failed critical competency, retraining) → 90-day shadow briefs → certification → calibration → ACTIVE', async () => {
    // The specification is the Founder's file, verbatim; the derived data names it and its digest.
    assert.equal(createHash('sha256').update(MAJED_SPEC).digest('hex'), MAJED.source.sha256, 'the approved specification is stored verbatim');
    assert.equal(MAJED.identity.sourceRef, `doc:${MAJED.source.file}`);
    const pkg = fromTemplate(MAJED.program);
    const competencies = (pkg.program.competencies ?? []).map((c) => c.code);
    assert.deepEqual(competencies, ['STRATEGIC_MARKET_INTELLIGENCE', 'STARTUP_LAUNCH_LEAN_STRATEGY', 'CONSUMER_DISCOVERY_TRUST', 'COMPETITIVE_POSITIONING_GLOBAL_CASES', 'EVIDENCE_BASED_DECISIONS', 'EXECUTIVE_STRATEGIC_CHALLENGE'], 'the six capability groups (spec §4)');
    assert.ok((pkg.program.competencies ?? []).every((c) => c.critical));
    assert.equal(pkg.skills.length, 6, 'one Skill per capability group, in ONE program (not six packages)');
    assert.deepEqual(pkg.scenarios.filter((x) => x.kind !== 'PRACTICE').map((x) => `${x.kind}:${x.sourceRef}`), [1, 2, 3, 4].map((n) => `ASSESSMENT:spec:majed-el-kedwany.test-${n}`).concat('HOLDOUT:spec:majed-el-kedwany.test-5'), 'the five practical tests (spec §5); test 5 is never shown to the trainee');
    assert.equal(pkg.program.assessmentTrials, 5, 'all five tests must be passed');
    assert.equal(pkg.program.founderCalibrationRequired, true, 'Founder Calibration (spec §5, D6)');
    assert.deepEqual(pkg.shadowAssignments.map((a) => a.code), ['smi.director.shadow-days-1-30', 'smi.director.shadow-days-31-60', 'smi.director.shadow-days-61-90'], 'the first 90 days (spec §6), rehearsed as internal shadow briefs');
    await withCompany('talent-smi', () => [pkg], async (x) => {
      provision(x);
      const org = x.rt.org.organization;
      const ceoSeat = org.positionByCode('company.ceo');
      const smi = org.positionByCode('director.strategic-market-intelligence');
      assert.ok(ceoSeat && smi);
      // A CEO (release identity) so the Director's manager is a person.
      // An isolated test Company: its CEO carries the release identity and the name of the reporting line in the spec.
      const ceo = refOf(act(x, 'EMPLOYEE_HIRE', { positionId: ceoSeat.id, givenName: 'Ahmed', familyName: 'Zaki', identityProfileCode: CEO_IDENTITY_PROFILE_V1.code }));
      // The identity: the profile derived from the approved specification, drafted and approved as data (no code, no release entry).
      assert.equal(MAJED.identity.roleRef, smi.roleRef);
      const identityId = draft(x, { kind: 'IDENTITY_PROFILE', code: 'majed-el-kedwany', body: MAJED.identity });
      act(x, 'TALENT_DEFINITION_DECIDE', { definitionId: identityId, decision: 'APPROVE' });
      act(x, 'ACCESS_POLICY_DECIDE', { policyCode: 'leadership.proposals', decision: 'APPROVE' });
      const majed = refOf(act(x, 'EMPLOYEE_HIRE', { positionId: smi.id, givenName: 'Majed', familyName: 'El Kedwany', displayNameAr: 'ماجد الكدواني', identityDefinitionId: identityId }));
      assert.equal(x.rt.governance.getEmployee(majed).state, 'CANDIDATE');
      assert.deepEqual(x.rt.governance.grants(majed).filter((g) => g.status === 'ACTIVE').map((g) => g.capability).sort(), ['org.staffing.request', 'org.talent.propose'], 'D2 / D4: the policy grants are issued at the hire (CANDIDATE)');
      // The program: drafted and approved as data; a Director's program requires Founder Calibration (D6).
      const programId = draft(x, { kind: 'ACADEMY_PROGRAM', body: pkg });
      act(x, 'TALENT_DEFINITION_DECIDE', { definitionId: programId, decision: 'APPROVE' });
      const smiDept = smi.departmentId as Id;
      act(x, 'DEPARTMENT_BUDGET', { departmentId: smiDept, capMoney: 2_000_000 });
      act(x, 'EMPLOYEE_LIFECYCLE', { employeeId: majed, to: 'TRAINING' });
      act(x, 'EMPLOYEE_MODEL_ACCESS', { employeeId: majed, capMoney: 1_500_000, taskClasses: CLASSES, dataClassCeiling: 'D2' });
      const enrollmentId = await academy(x, pkg, majed, smi.id, {
        failFirstAssessment: true,
        failing: { EVIDENCE_BASED_DECISIONS: 40 },
        afterRetraining: [1, 2, 3, 4].map((n) => `smi.director.assess-${n}`),
        shadows: pkg.shadowAssignments.map((a) => a.code),
      });
      const passedTests = (x.rt.founder.activation(smi.id).enrollment?.attempts ?? []).filter((a) => a.outcome === 'PASS').length;
      assert.equal(passedTests, 6, 'practice + tests 1–4 + the hidden test 5 passed (test 1 failed once, then retaken)');
      // The attempt contexts carried the approved kernel and the live organization (manager = the CEO).
      const attempts = x.seen.filter((s) => s.kind === 'SCENARIO');
      assert.ok(attempts.length >= 7 && attempts.every((s) => s.text.includes('You are Strategic Market Intelligence Director.') && s.text.includes('you report to Ahmed Zaki')), 'kernel + live organization in context');
      assert.ok(attempts.every((s) => s.text.includes('Evidence-Based Business Decisions')), 'the approved profile, not a placeholder');
      // A leader: activation waits for the Founder Calibration.
      const v = x.rt.founder.activation(smi.id);
      assert.equal(v.next, 'FOUNDER_CALIBRATION');
      assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACTIVATION_DECIDE', { requestId: v.enrollment?.activationRequest?.id, decision: 'APPROVE' }), /calibration/i);
      act(x, 'ACADEMY_CALIBRATION', { enrollmentId, decision: 'APPROVE', evidenceRefs: (v.enrollment?.attempts ?? []).map((a) => `academy_attempt:${a.id}`) });
      act(x, 'ACTIVATION_DECIDE', { requestId: v.enrollment?.activationRequest?.id, decision: 'APPROVE' });
      assert.equal(x.rt.governance.getEmployee(majed).state, 'ACTIVE');
      assert.equal(x.rt.founder.activation(smi.id).ceo?.name, 'Majed El Kedwany', 'the seat case reads the holder of THIS seat');
      // The CEO is untouched by all of this.
      assert.equal(x.rt.governance.getEmployee(ceo).state, 'CANDIDATE');
      const overview = x.rt.founder.talentOverview() as { people: { employeeId: string; certification: { status: string } | null; identity: unknown }[] };
      const row = overview.people.find((p) => p.employeeId === majed);
      assert.equal(row?.certification?.status, 'VALID');
      assert.ok(row?.identity, 'its catalog identity is visible');
    });
  });

  test('2 — a Reddit Growth Specialist from the same build: platform-growth competencies, no code, no Founder Calibration for a specialist', async () => {
    const pkg = program('role:growth.reddit-specialist', 'growth.reddit', 'Reddit Growth Specialist — Academy program', false, { competencies: (COMPETENCY_PRESETS['platform-growth'] ?? []) as AcademyPackage['program']['competencies'] });
    await withCompany('talent-reddit', () => [pkg], async (x) => {
      provision(x);
      const org = x.rt.org.organization;
      const growth = x.rt.governance.departmentByCode('growth');
      assert.ok(growth);
      const seatId = refOf(act(x, 'POSITION_CREATE', { departmentId: growth.id, roleRef: 'role:growth.reddit-specialist', title: 'Reddit Growth Specialist', kind: 'SPECIALIST', code: 'growth.reddit-1' }));
      assert.equal(org.position(seatId).reportsToPositionId, org.positionByCode('director.growth')?.id, 'D1: platform specialists sit under Growth');
      const identityId = draft(x, { kind: 'IDENTITY_PROFILE', code: 'ola-samir', body: identity('role:growth.reddit-specialist', 'SYNTHETIC Reddit Growth Specialist', { given: 'Ola', family: 'Samir', ar: 'علا سمير' }) });
      act(x, 'TALENT_DEFINITION_DECIDE', { definitionId: identityId, decision: 'APPROVE' });
      const programId = draft(x, { kind: 'ACADEMY_PROGRAM', body: pkg });
      act(x, 'TALENT_DEFINITION_DECIDE', { definitionId: programId, decision: 'APPROVE' });
      const specialist = refOf(act(x, 'EMPLOYEE_HIRE', { positionId: seatId, givenName: 'Ola', familyName: 'Samir', identityDefinitionId: identityId }));
      assert.deepEqual(x.rt.governance.grants(specialist).filter((g) => g.status === 'ACTIVE'), [], 'a specialist receives no leadership policy grant; a title grants nothing');
      act(x, 'DEPARTMENT_BUDGET', { departmentId: growth.id, capMoney: 2_000_000 });
      act(x, 'EMPLOYEE_LIFECYCLE', { employeeId: specialist, to: 'TRAINING' });
      act(x, 'EMPLOYEE_MODEL_ACCESS', { employeeId: specialist, capMoney: 1_500_000, taskClasses: CLASSES, dataClassCeiling: 'D2' });
      await academy(x, pkg, specialist, seatId, { failFirstAssessment: true });
      const v = x.rt.founder.activation(seatId);
      assert.equal(v.next, 'DECIDE_ACTIVATION', 'a specialist program needs no Founder Calibration');
      act(x, 'ACTIVATION_DECIDE', { requestId: v.enrollment?.activationRequest?.id, decision: 'APPROVE' });
      assert.equal(x.rt.governance.getEmployee(specialist).state, 'ACTIVE');
      const attempts = x.seen.filter((s) => s.kind === 'SCENARIO');
      assert.ok(attempts.length > 0 && attempts.every((s) => s.text.includes('You are SYNTHETIC Reddit Growth Specialist.')), 'its approved kernel is in every attempt context');
    });
  });

  test('4 / 5 — a Video Editor in Brand & Creative, another specialty from the same build: its editing Tool is NOT_REGISTERED, a Tool scenario is refused, the certification records it NOT ASSESSED', async () => {
    const pkg = program('role:brand.video-editor', 'brand.video-editor', 'Short-form Video Editor — Academy program', false, { toolCode: 'video-editor' });
    await withCompany('talent-video', () => [pkg], async (x) => {
      provision(x);
      const org = x.rt.org.organization;
      const brand = x.rt.governance.departmentByCode('brand-creative');
      assert.ok(brand);
      // The Founder opens the seat directly (no request needed for the Founder's own decision), and records its Tool need.
      const seatId = refOf(act(x, 'POSITION_CREATE', { departmentId: brand.id, roleRef: 'role:brand.video-editor', title: 'Short-form Video Editor', kind: 'SPECIALIST', code: 'brand.video-editor-1' }));
      assert.equal(org.position(seatId).reportsToPositionId, org.positionByCode('director.brand-creative')?.id, 'under the Brand & Creative Director seat (the structure is unchanged)');
      act(x, 'ROLE_TOOL_REQUIREMENT', { roleRef: 'role:brand.video-editor', toolCode: 'video-editor', purpose: 'SYNTHETIC: cut and caption short-form videos', decision: 'ADD' });
      const overview = x.rt.founder.talentOverview() as { roleToolRequirements: { toolCode: string; readiness: { readiness: string } }[] };
      assert.equal(overview.roleToolRequirements.find((r) => r.toolCode === 'video-editor')?.readiness.readiness, 'NOT_REGISTERED', 'no adapter: shown honestly');
      const identityId = draft(x, { kind: 'IDENTITY_PROFILE', code: 'nada-hussein', body: identity('role:brand.video-editor', 'SYNTHETIC Short-form Video Editor', null) });
      act(x, 'TALENT_DEFINITION_DECIDE', { definitionId: identityId, decision: 'APPROVE' });
      const programId = draft(x, { kind: 'ACADEMY_PROGRAM', body: pkg });
      act(x, 'TALENT_DEFINITION_DECIDE', { definitionId: programId, decision: 'APPROVE' });
      const editor = refOf(act(x, 'EMPLOYEE_HIRE', { positionId: seatId, givenName: 'Nada', familyName: 'Hussein', identityDefinitionId: identityId }));
      act(x, 'DEPARTMENT_BUDGET', { departmentId: brand.id, capMoney: 2_000_000 });
      act(x, 'EMPLOYEE_LIFECYCLE', { employeeId: editor, to: 'TRAINING' });
      act(x, 'EMPLOYEE_MODEL_ACCESS', { employeeId: editor, capMoney: 1_500_000, taskClasses: CLASSES, dataClassCeiling: 'D2' });
      // Up to the assessments, then the Tool scenario is refused: the capability cannot be assessed, so it is never claimed.
      let refused = false;
      const enrollmentId = await academy(x, pkg, editor, seatId, {
        failFirstAssessment: false,
        atAssessment: (enrollment, a) => {
          assert.throws(() => x.rt.founder.actions.preview(x.session, 'ACADEMY_ATTEMPT_START', { ...a, enrollmentId: enrollment, scenarioCode: `${pkg.code}.tool-1` }), (e: unknown) => e instanceof Error && /NOT_REGISTERED|not assessed/.test(`${e.message} ${JSON.stringify((e as { details?: unknown }).details ?? {})}`));
          refused = true;
        },
      });
      assert.equal(refused, true, 'the Tool scenario was refused: never assessed, never claimed');
      const v = x.rt.founder.activation(seatId);
      assert.equal(v.next, 'DECIDE_ACTIVATION', 'a specialist program needs no Founder Calibration');
      const overview2 = x.rt.founder.talentOverview() as { people: { employeeId: string; certification: { toolScopes: { tool_code: string; status: string; readiness: string }[] } | null }[] };
      assert.deepEqual(overview2.people.find((p) => p.employeeId === editor)?.certification?.toolScopes.map((s) => ({ ...s })), [{ tool_code: 'video-editor', status: 'NOT_ASSESSED', readiness: 'NOT_REGISTERED' }], 'the Skill is certified; operating the editor is NOT assessed');
      act(x, 'ACTIVATION_DECIDE', { requestId: v.enrollment?.activationRequest?.id, decision: 'APPROVE' });
      assert.equal(x.rt.governance.getEmployee(editor).state, 'ACTIVE');
      assert.ok(enrollmentId);
    });
  });
});
