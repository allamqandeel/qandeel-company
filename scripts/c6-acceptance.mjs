#!/usr/bin/env node
// C6 local acceptance harness — the Company Improvement Engine, end to end, for the Founder-host review (and CI).
//
//   npm run c6:acceptance -- --workspace <disposable directory> [--keep]
//
// The directory must not exist yet, or be empty. The harness writes an ownership marker, creates a Company in
// <dir>/company and proves — with the deterministic fake provider and fake tool drivers (no network, no commercial
// provider, no credential, no cloud storage) and real SQLite / runtime / storage paths — the C6 Product contracts:
//
// - production fail-closed first (no Founder surface armed: no registry act, no outcome verification);
// - then, through the TEST-ONLY Founder seam standing in for the authenticated session while seeding: a real
//   organization, a reviewer certified by the Academy and calibrated through real shadow reviews, a calibrated
//   Eval Registry definition, a Goal-linked Work Item executed by the governed runtime, independently reviewed by
//   the reviewer's own run and outcome-verified; evaluation, attribution (a real tool failure is not the
//   Employee's fault), reflection gated on independent attribution, a validated lesson → targeted retraining →
//   NOT_YET_TESTED until later comparable work proves IMPROVEMENT_OBSERVED, successful patterns candidate-first,
//   repeated failures across Employees → a systemic finding in Founder Attention, a Gold case bound to a hidden
//   holdout, typed reports without any score, cost per qualified outcome, the C5 change-signalling contract;
// - C6-R1: the ordinary Work → Review → Verify → Evaluate → Attribute → Learn → Retrain → Later-evidence cycle with
//   the Founder surface DISARMED (every Founder act fails closed): the Review Pool verifies, attributes and
//   validates, and an authority / spend fingerprint (grants, budget caps, approvals, routing, seats, delegations,
//   qualifications, certifications) is unchanged; a plan that keeps Founder judgment stays waiting for the Founder;
// - resilience: an encrypted portable package in a disposable external directory (honestly SAME_VOLUME, then an
//   attested off-device one), tamper / wrong-key refusal, generational retention, a restore drill, a clean-device
//   restore preserving identities / work / evaluation / learning / audit lineage / artifacts with the lost device's
//   sessions revoked, a restored runtime that does NOT repeat an uncertain external effect, and a real v9 → v10
//   update that is snapshotted, rehearsed, verified and activated, then rolled back into UPDATE_HOLD.
//
// No real replacement laptop, no real cloud storage and no real App telemetry are claimed (L1 / Pilot / C7).
// At the end it deletes only what it created unless --keep is given.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const MARKER = '.qandeel-c6-acceptance';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'packages/runtime/dist/src/cli.js');

const { values } = parseArgs({ strict: true, options: { workspace: { type: 'string' }, keep: { type: 'boolean', default: false } } });
const { CompanyRuntime, DeterministicFakeProvider, FakeToolDriver, employeeTaskProcessor, runtimeHealth } = await import('@qandeel-company/runtime');
const S = await import('@qandeel-company/storage');
const { AcademyStore, ArtifactStore, CompanyStore, DirectoryDestination, FounderAuthStore, GovernanceStore, ImprovementStore, OrganizationStore, SkillStore } = S;
const { ASSESSMENT_DIMENSIONS, DEFAULT_CRITICAL_DIMENSIONS, DETERMINISTIC_DIMENSIONS, standardWorkOutcomeDefinition } = await import('@qandeel-company/mind');
const { classifyFounderIntent } = await import('@qandeel-company/governance');
// Test-only seam: resolvable only because this harness runs with --conditions=qandeel-test.
const { activateEmployeeForTest, armFounderTestSurface, createWorkspaceAtVersionForTest, disarmFounderTestSurface } = await import('@qandeel-company/storage/testing');

function refuse(message) {
  console.error(JSON.stringify({ ok: false, verdict: 'REFUSED', message }));
  process.exit(2);
}
if (!values.workspace) refuse('usage: npm run c6:acceptance -- --workspace <new or empty directory> [--keep]');
const sandbox = path.resolve(values.workspace);
for (let dir = sandbox; ; dir = path.dirname(dir)) {
  if (existsSync(path.join(dir, '.git'))) refuse('the acceptance directory must not be inside a Git working tree (source checkouts are never touched)');
  if (path.dirname(dir) === dir) break;
}
if (existsSync(sandbox) && readdirSync(sandbox).length > 0) refuse('the acceptance directory must not exist or must be empty');
const preExisting = existsSync(sandbox);
mkdirSync(sandbox, { recursive: true });
writeFileSync(path.join(sandbox, MARKER), 'created by the QANDEEL COMPANY C6 acceptance harness; safe to delete\n');
const company = path.join(sandbox, 'company');
// The disposable "external destination": a directory outside the company workspace (CI has no second device).
const external = path.join(sandbox, 'external-destination');
const attested = path.join(sandbox, 'attested-offdevice-destination');

const results = [];
let failed = false;
const check = (cond, what) => {
  if (!cond) throw new Error(what);
};
async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = (await fn()) ?? {};
    results.push({ step: name, result: 'PASS' });
    console.log(JSON.stringify({ step: name, result: 'PASS', ms: Date.now() - started, ...detail }));
  } catch (error) {
    failed = true;
    results.push({ step: name, result: 'FAIL' });
    console.log(JSON.stringify({ step: name, result: 'FAIL', ms: Date.now() - started, code: error?.code ?? 'ERROR', message: String(error?.message ?? error).slice(0, 400) }));
  }
}
const cliRun = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', shell: false, windowsHide: true });
const refusedWith = (fn, code) => {
  try {
    fn();
  } catch (error) {
    return error?.code === code || error?.details?.reason === code;
  }
  return false;
};
const script = (...o) => JSON.stringify({ script: o });
const FINAL = (code = 'done') => ({ type: 'FINAL', summaryCode: code });
const DOMAIN = 'quality.general';
const REFLECTION = 'I think I skipped sourcing the growth figures because I was rushing the draft.';
const PASSPHRASE = ['acceptance', 'recovery', 'phrase', String(process.pid), String(Date.now())].join('-');
const reviewPlan = () => ({
  domain: DOMAIN,
  appliesTo: 'OUTPUT',
  keys: [{ kind: 'SPECIALIST' }],
  rubric: { code: 'quality.rubric', version: 1 },
  reviewerInstructions: script({ type: 'REVIEW_DECISION', outcome: 'PASS', reasonCode: 'rubric.applied', rationale: 'Checked against the rubric.', evidenceRefs: ['evidence:rubric'] }, FINAL('review.done')),
  reviewTaskClass: 'draft.memo',
  reviewBudget: { money: 200_000, tokens: 200_000 },
});

const world = {};
await step('production-c6-authority-closed', () => {
  const store = CompanyStore.open(company);
  try {
    check(store.schemaVersion === S.CURRENT_SCHEMA_VERSION && S.CURRENT_SCHEMA_VERSION >= 10, 'schema carries the C6 migration');
    const f = 'founder:00000000-0000-4000-8000-000000000000';
    const m = ImprovementStore.for(store);
    check(refusedWith(() => m.registerDefinition(f, standardWorkOutcomeDefinition()), 'FOUNDER_SURFACE_UNAVAILABLE'), 'the Eval Registry changes only through the authenticated Founder surface');
    check(refusedWith(() => m.verifyOutcome(f, '00000000-0000-4000-8000-000000000001', { verdict: 'ACHIEVED', evidenceClasses: ['REVIEW_DECISION'], evidenceRefs: ['work_item:x'], reasonCode: 'x' }), 'FOUNDER_SURFACE_UNAVAILABLE'), 'the Founder\'s own (exception) outcome verification needs the authenticated Founder surface');
  } finally {
    store.close();
  }
  for (const cmd of ['verify-outcome', 'validate-attribution', 'activate-eval', 'promote', 'approve']) check(cliRun(cmd, '--workspace', company).status === 2, `the CLI has no ${cmd} command`);
  return { founderSurface: 'SESSION_ONLY' };
});

await step('seed-organization-and-reviewer-program-via-test-seam', () => {
  armFounderTestSurface(company);
  const store = CompanyStore.open(company);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const founder = gov.registerFounder().ref;
    gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: 90_000_000, capTokens: 90_000_000, currency: 'USD', reasonCode: 'acceptance' });
    const dept = (code) => gov.departmentByCode(code).id;
    for (const c of ['growth', 'product']) gov.createBudget(founder, { scope: 'DEPARTMENT', scopeId: dept(c), capMoney: 40_000_000, capTokens: 40_000_000, reasonCode: 'acceptance' });
    const p = gov.registerProvider(founder, { code: 'fake-local', locality: 'LOCAL' });
    const model = gov.registerModel(founder, { providerId: p.id, code: 'fake-small' });
    const d = gov.registerDeployment(founder, { code: 'local-a', modelId: model.id, pinnedRevision: 'r1', reasoningClass: 'E1', contextWindowTokens: 100_000, maxOutputTokens: 2_048, taskClasses: ['draft.memo'] });
    gov.addPriceCard(founder, d.id, { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: 1_000_000, billedOutputPerMTok: 4_000_000, billedPerCall: 0, economicInputPerMTok: 1_000_000, economicOutputPerMTok: 4_000_000, economicPerCall: 0 });
    for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED']) gov.setQualification(founder, d.id, q, 'acceptance');
    gov.approveEgress(founder, d.id, 'D4', 'local.only');
    gov.createRoutePolicy(founder, 'draft.memo', { minClass: 'E1', maxClass: 'E2', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 8, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 100_000 } });
    const pub = gov.registerTool(founder, { code: 'publisher', driverCode: 'fake-publisher', egress: 'EXTERNAL', credentialRef: 'vault:publisher' });
    gov.registerToolAction(founder, { toolId: pub.id, code: 'publish', risk: 'R3', sideEffects: 'IDEMPOTENT', mutatesExternal: true, dataClassCeiling: 'D1', argsSchema: { fields: { text: { type: 'string', required: true, maxLength: 200 } } }, costPerCallMicros: 100 });
    const notes = gov.registerTool(founder, { code: 'notes', driverCode: 'fake-notes', egress: 'NONE' });
    gov.registerToolAction(founder, { toolId: notes.id, code: 'append', risk: 'R1', sideEffects: 'IDEMPOTENT', mutatesExternal: false, dataClassCeiling: 'D3', argsSchema: { fields: { text: { type: 'string', required: true, maxLength: 200 } } }, costPerCallMicros: 100 });
    const syncer = gov.registerTool(founder, { code: 'syncer', driverCode: 'fake-syncer', egress: 'NONE' });
    gov.registerToolAction(founder, { toolId: syncer.id, code: 'sync', risk: 'R1', sideEffects: 'UNSAFE', mutatesExternal: false, dataClassCeiling: 'D3', argsSchema: { fields: {} }, costPerCallMicros: 100 });
    let n = 0;
    const names = ['Nour', 'Karim', 'Salma', 'Omar', 'Laila', 'Hany', 'Mona'];
    const hireAs = (roleRef, deptCode) => {
      const e = gov.createEmployee(founder, { name: { given: names[n++ % names.length], family: `Hassan${'abcdefg'[n % 7]}` }, profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef, positionRef: 'position:p1', departmentId: dept(deptCode), managerRef: founder });
      gov.transitionEmployee(founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
      gov.transitionEmployee(founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
      activateEmployeeForTest(gov, founder, e.id);
      gov.createBudget(founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 8_000_000, capTokens: 8_000_000, reasonCode: 'acceptance' });
      gov.grant(founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'acceptance' });
      return e;
    };
    const place = (e, code) => org.assignPrimary(founder, { positionId: org.positionByCode(code).id, employeeId: e.id, reasonCode: 'placed' });
    const ceo = hireAs('role:company.ceo', 'product');
    place(ceo, 'company.ceo');
    const director = hireAs('role:director.growth', 'growth');
    place(director, 'director.growth');
    org.createPosition(founder, { code: 'growth.analyst-1', title: 'Growth Analyst', scope: 'DEPARTMENT', departmentId: dept('growth'), kind: 'SPECIALIST', roleRef: 'role:content-strategist', reportsToPositionId: org.positionByCode('director.growth').id, reasonCode: 'headcount.added' });
    const analyst = hireAs('role:content-strategist', 'growth');
    place(analyst, 'growth.analyst-1');
    for (const cap of ['tool:notes.append', 'tool:syncer.sync']) gov.grant(founder, { employeeId: analyst.id, capability: cap, riskCeiling: 'R1', dataClassCeiling: 'D3', reasonCode: 'acceptance' });
    const reviewer = hireAs(`role:reviewer.${DOMAIN}`, 'product');
    const skills = SkillStore.for(store);
    const skill = skills.registerSkill(founder, { code: 'review.quality', name: 'Review craft', skillType: 'EXTERNAL', ownerRef: 'department:product' });
    let v = skills.registerSkillVersion(founder, { skillId: skill.id, versionLabel: '1.0.0', sourceRef: 'github:example.review', sourceRevision: 'r1', authorRef: 'org:example', licenseSpdx: 'MIT', dependencies: [], instructions: 'Guidance: judge against the rubric, cite evidence, never guess.' });
    v = skills.checkLicenseAndDependencies(skills.inspectSkillVersion(v.id).id);
    for (const [to, extra] of [['SECURITY_QUARANTINE', {}], ['SANDBOXED', { evidenceRef: 'review:acceptance', securityPassed: true }], ['BENCHMARKED', { evidenceRef: 'benchmark:acceptance' }], ['COMPARED', {}], ['APPROVED', {}]]) v = skills.advanceSkillVersion(founder, v.id, to, { reasonCode: 'acceptance', ...extra });
    skills.publishBlueprint(founder, `role:reviewer.${DOMAIN}`, [{ skillId: skill.id, category: 'REQUIRED', minProficiency: 'QUALIFIED', critical: true }]);
    const academy = AcademyStore.for(store);
    const program = academy.createProgram(founder, { code: 'program.reviewer.quality', roleRef: `role:reviewer.${DOMAIN}` });
    const pv = academy.publishProgramVersion(founder, program.id, {
      curriculum: ['QANDEEL_FUNDAMENTALS', 'FOUNDER_UNDERSTANDING', 'ROLE_MASTERY', 'REAL_CASE_STUDIES', 'MARKET_INTELLIGENCE', 'COMPANY_OPERATING_SKILLS'].map((category, i) => ({ code: `module-${i}`, category, sourceRefs: ['authority:stage-11'] })),
      dimensions: ASSESSMENT_DIMENSIONS.map((dimension) => ({ dimension, critical: DEFAULT_CRITICAL_DIMENSIONS.includes(dimension), passPct: 60 })),
      passAveragePct: 70,
      assessmentTrials: 1,
      holdoutRequired: true,
      maxRepeatedCriticalFailures: 2,
      certificationValidityDays: 365,
      probation: { minCases: 1, maxCriticalFailures: 0 },
      skillTargets: [{ skillId: skill.id, proficiency: 'QUALIFIED' }],
    });
    const sc = (code, kind) => academy.addScenario(founder, pv.id, { code, kind, content: `Review case ${code}: judge a content draft against its rubric.`, sourceRef: 'authority:stage-11', budgetMicros: 1_000_000 }).id;
    Object.assign(world, { founder, ceo, director, analyst, reviewer, programVersionId: pv.id, scenarios: { practice: sc('practice-1', 'PRACTICE'), holdout: sc('holdout-1', 'HOLDOUT'), gold: sc('gold-figures-1', 'HOLDOUT') } });
    return { placed: 4 };
  } finally {
    store.close();
  }
});

const provider = new DeterministicFakeProvider('fake-local');
const notesDriver = new FakeToolDriver('fake-notes');
let syncerDriver = new FakeToolDriver('fake-syncer');
const publisher = new FakeToolDriver('fake-publisher');
const newRuntime = (workspace) => new CompanyRuntime({ workspace, processors: [employeeTaskProcessor], supervisorTtlMs: 2_000, concurrency: 4, governance: { providers: [provider], toolDrivers: [publisher, notesDriver, syncerDriver], toolCallTimeoutMs: 1_000 } });
let runtime = newRuntime(company);
const until = async (fn, what, ms = 60_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(25);
  }
  throw new Error(`timed out: ${what}`);
};
const stateOf = (id) => runtime.view.getWorkItem(id).state;
const release = (workItemId, cap = 1_000_000) => {
  runtime.governance.createBudget(world.founder, { scope: 'WORK_ITEM', scopeId: workItemId, capMoney: cap, capTokens: 1_000_000, reasonCode: 'acceptance' });
  runtime.transitionWorkItem(workItemId, { to: 'READY', reasonCode: 'release' });
};
const submit = (owner, instructions, { plan = false, goalId = null } = {}) => {
  const { workItem } = runtime.submitWorkItem({ objective: 'acceptance task', ownerRef: owner.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 256, instructions } });
  runtime.governance.createBudget(world.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'acceptance' });
  if (plan) runtime.org.review.declarePlan(world.founder, workItem.id, reviewPlan());
  if (goalId) runtime.founder.goals.linkWork(world.founder, goalId, workItem.id);
  runtime.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  return workItem.id;
};
const im = () => runtime.founder.improvement;
const verify = (id, verdict) => im().verifyOutcome(world.founder, id, { verdict, evidenceClasses: ['REVIEW_DECISION', 'WORK_LINEAGE'], evidenceRefs: [`work_item:${id}`], reasonCode: 'founder.verified' });
/** Governed work, independently reviewed by the reviewer's own run, then outcome-verified and evaluated. */
async function reviewedVerified(owner, verdict, instructions = script(FINAL('draft.done')), goalId = null) {
  const id = submit(owner, instructions, { plan: true, goalId });
  await until(() => stateOf(id) === 'REVIEWED', 'independent review');
  verify(id, verdict);
  return { id, evaluation: im().evaluate(id) };
}
function meter() {
  let changes = 0;
  const off = runtime.onFounderChange(() => changes++);
  return { get changes() { return changes; }, off };
}

try {
  await runtime.start();
  const { review } = runtime.org;
  await step('reviewer-certified-calibrated-promoted-through-runs', async () => {
    const academy = runtime.mind.academy;
    const e = academy.enroll(world.founder, world.reviewer.id, world.programVersionId);
    for (let i = 0; i < 6; i++) academy.recordModuleCompletion(world.founder, e.id, `module-${i}`, `evidence:module-${i}`);
    academy.advance(e.id);
    const attempt = async (scenarioId, kind) => {
      const started = academy.startAttempt(e.id, { scenarioId, kind, taskClass: 'draft.memo' });
      release(started.workItemId);
      await until(() => stateOf(started.workItemId) === 'COMPLETED', `${kind} attempt`);
      academy.evaluateDeterministic(started.attempt.id);
      academy.recordEvaluation(world.founder, started.attempt.id, ASSESSMENT_DIMENSIONS.filter((d) => !DETERMINISTIC_DIMENSIONS.includes(d)).map((dimension) => ({ dimension, scorePct: 90 })));
    };
    await attempt(world.scenarios.practice, 'SIMULATION');
    academy.advance(e.id);
    await attempt(world.scenarios.holdout, 'ASSESSMENT');
    academy.advance(e.id);
    const { workItem: shadow } = runtime.submitWorkItem({ objective: 'shadow review work', ownerRef: world.reviewer.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 128, instructions: script(FINAL('shadow.done')) } });
    academy.assignShadowWork(world.founder, e.id, shadow.id);
    release(shadow.id);
    await until(() => stateOf(shadow.id) === 'COMPLETED', 'shadow work');
    academy.collectShadowEvidence(e.id);
    for (const kind of ['QUALITY', 'DEMONSTRATED_LEARNING', 'COST_DISCIPLINE', 'CORRECT_ESCALATION', 'COLLABORATION']) academy.recordProbationEvidence(world.founder, e.id, { kind, workItemId: shadow.id, positive: true });
    academy.advance(e.id);
    academy.decideProbationReview(world.founder, e.id, 'PASS');
    academy.advance(e.id);
    const q = review.admitReviewer(world.founder, { employeeId: world.reviewer.id, domain: DOMAIN, level: 'QUALIFIED', maxDataClass: 'D3', reasonCode: 'pool.admitted' });
    for (let i = 0; i < 2; i++) {
      const subject = submit(world.analyst, script(FINAL(`calibration.${i}`)), { plan: true });
      await until(() => stateOf(subject) === 'WAITING_REVIEW', 'calibration subject');
      const req = await until(() => review.requests({ workItemId: subject }).find((r) => r.state === 'OPEN'), 'calibration request');
      const key = review.assignments(req.id).find((a) => a.keyKind === 'SHADOW');
      await until(() => stateOf(key.reviewWorkItemId) === 'COMPLETED', 'shadow review run');
      review.calibrateShadowDecision(world.founder, review.decisions(req.id).find((d) => d.assignmentId === key.id).id, 'PASS');
    }
    check(review.promoteReviewer(world.founder, q.id, 'pool.promoted').mode === 'ACTIVE', 'the reviewer holds independent review authority on evidence');
    return { reviewer: 'ACTIVE' };
  });

  await step('eval-registry-calibrates-its-own-evaluator', () => {
    const spec = standardWorkOutcomeDefinition();
    const guessing = im().registerDefinition(world.founder, { ...spec, code: 'work-outcome.guessing', referenceCases: spec.referenceCases.map((c) => (c.kind === 'AMBIGUOUS' ? { ...c, evidence: spec.referenceCases.find((x) => x.kind === 'KNOWN_GOOD').evidence } : c)) });
    const badRun = im().calibrateDefinition(world.founder, guessing.id);
    check(!badRun.passed && badRun.results.some((r) => r.kind === 'AMBIGUOUS' && !r.pass), 'a grader that answers ambiguous evidence confidently fails its own calibration');
    check(refusedWith(() => im().activateDefinition(world.founder, guessing.id, badRun.id), 'CALIBRATION_NOT_PASSED'), 'an uncalibrated grader is never activated');
    const d = im().registerDefinition(world.founder, spec);
    const run = im().calibrateDefinition(world.founder, d.id);
    check(run.passed && ['KNOWN_GOOD', 'KNOWN_BAD', 'AMBIGUOUS', 'NON_EMPLOYEE_CAUSE', 'CREATIVE_PATH'].every((k) => run.results.some((r) => r.kind === k && r.pass)), 'known-good passes, known-bad fails, ambiguous stays unknown, a non-employee cause is not blamed, a creative path passes');
    const active = im().activateDefinition(world.founder, d.id, run.id);
    world.calibrationRunId = run.id;
    return { definition: `${active.code}@${active.defVersion}`, status: active.status };
  });

  await step('goal-linked-work-reviewed-verified-qualified', async () => {
    const goal = runtime.founder.goals.propose(world.founder, { kind: 'COMPANY', title: 'Win Saudi organic search', summary: 'Qualified growth content for KSA.', ownerRef: world.ceo.ref });
    runtime.founder.goals.transition(world.founder, goal.id, { to: 'APPROVED', reasonCode: 'founder.approved' });
    runtime.founder.goals.transition(world.founder, goal.id, { to: 'ACTIVE', reasonCode: 'founder.activated' });
    world.goalId = goal.id;
    const { id, evaluation } = await reviewedVerified(world.analyst, 'ACHIEVED', script(FINAL('draft.done')), goal.id);
    check(stateOf(id) === 'OUTCOME_VERIFIED', 'REVIEWED → OUTCOME_VERIFIED only through a recorded verification');
    check(evaluation.evaluation.qualifiedOutcome && evaluation.evaluation.evidenceState === 'SUFFICIENT_EVIDENCE', 'reviewed + outcome-verified work is a qualified outcome');
    check(evaluation.evaluation.employeeId === world.analyst.id, 'attributed to the executing Employee through the run');
    world.qualifiedWork = id;
    const outcome = im().profile(world.analyst.id).dimensions.find((x) => x.dimension === 'OUTCOME');
    check(outcome.state === 'INSUFFICIENT_EVIDENCE' && outcome.level === null, 'one excellent task is not an excellent employee (minimum sample)');
    const [pattern] = im().signals({ workItemId: id, kind: 'SUCCESSFUL_PATTERN' });
    check(pattern && runtime.mind.memory.lesson(pattern.observationId).stage === 'OBSERVATION', 'a smart success is a pattern CANDIDATE, never automatic Company truth');
    world.patternObservation = pattern.observationId;
    return { goal: goal.id, qualified: true, pattern: 'CANDIDATE' };
  });

  await step('completion-and-activity-are-not-performance', async () => {
    const id = submit(world.analyst, script(FINAL('busy.done')));
    await until(() => stateOf(id) === 'COMPLETED', 'unreviewed work completes');
    check(refusedWith(() => verify(id, 'ACHIEVED'), 'NOT_REVIEWED'), 'COMPLETED work cannot be outcome-verified (review first)');
    const e = im().evaluate(id).evaluation;
    check(!e.qualifiedOutcome && e.evidenceState === 'INSUFFICIENT_EVIDENCE', 'COMPLETED alone is not a qualified success; insufficient evidence stays insufficient');
    check(e.dimensions.every((x) => x.verdict !== 'POSITIVE') && (e.observability.runs ?? 0) >= 1, 'activity is recorded as observability and earns no verdict');
    return { evidenceState: e.evidenceState };
  });

  await step('a-real-tool-failure-is-not-blamed-on-the-employee', async () => {
    notesDriver.failNext({ ok: false, code: 'TOOL_FAILED', sent: 'NOT_SENT' });
    const { id, evaluation } = await reviewedVerified(world.analyst, 'NOT_ACHIEVED', script({ type: 'TOOL_REQUEST', tool: 'notes', action: 'append', args: { text: 'figures' } }, FINAL('draft.done')));
    check(evaluation.evaluation.evidenceState === 'CONFLICTING_EVIDENCE', 'a passed review contradicted by the outcome is conflicting evidence, never averaged');
    const a = im().attributions({ workItemId: id })[0];
    const seen = im().inspect({ kind: 'WORK_ITEM', id }).evidence;
    check(a?.state === 'PROPOSED' && a.overall === 'TOOL' && !a.employeeAccountable, `the evaluator proposes TOOL, not employee judgement (saw ${a?.overall}; failures ${JSON.stringify(seen.failures)}; toolCalls ${seen.activity.toolCalls}; runs ${JSON.stringify(runtime.view.runsForWorkItem(id).map((r) => [r.state, r.failureCode, r.attempt]))}; tools ${JSON.stringify(runtime.governance.toolInvocations(id).map((i) => [i.state, i.failureCode]))}; usage ${JSON.stringify(runtime.governance.usage({ workItemId: id }).map((x) => [x.attemptKind, x.outcome]))})`);
    im().decideAttribution(world.founder, a.id, { decision: 'VALIDATE', reasonCode: 'founder.tool.confirmed' });
    world.toolFailureWork = id;
    return { overall: a.overall, employeeAccountable: false };
  });

  await step('reflection-is-a-hypothesis-then-validated-learning-intervention-and-verified-effect', async () => {
    const { id } = await reviewedVerified(world.analyst, 'NOT_ACHIEVED', script({ type: 'OBSERVATION', topic: 'drafting.figures', content: REFLECTION }, FINAL('draft.done')));
    const memory = runtime.mind.memory;
    const obs = memory.lessons(world.analyst.id).find((l) => l.stage === 'OBSERVATION' && l.eventRef === `work_item:${id}`);
    check(obs, 'the Employee reflected through its own governed run (Memory Write Policy)');
    const signal = im().classifyObservation(obs.id, 'MISTAKE_LESSON');
    check(signal.source === 'REFLECTION', 'an Employee-originated observation is a REFLECTION');
    const lesson = memory.nominateLesson(world.founder, obs.id, 'founder.nominated');
    check(refusedWith(() => memory.validateLesson(world.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'x' }), 'ATTRIBUTION_NOT_VALIDATED'), 'a reflection cannot validate itself (no independent attribution yet)');
    const a = im().attributions({ workItemId: id })[0];
    check(a.overall === 'EMPLOYEE_JUDGMENT', 'with no system cause, the evaluator proposes employee judgement');
    im().decideAttribution(world.founder, a.id, { decision: 'VALIDATE', reasonCode: 'founder.cause.confirmed' });
    check(memory.validateLesson(world.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'founder.validated' }).stage === 'VALIDATED', 'validated on independent evidence');
    check(memory.requestPromotion('system:learning', lesson.id, 'COMPANY').state === 'PENDING_REVIEW', 'even validated, a reflection never self-promotes to Company Knowledge (independent review decides)');
    const planned = im().planIntervention(world.founder, lesson.id, { kind: 'TARGETED_RETRAINING' });
    check(planned.outcome === 'PLANNED', 'validated learning produces a governed intervention');
    check(im().planIntervention(world.founder, lesson.id, { kind: 'TARGETED_RETRAINING' }).outcome === 'AWAIT_EVIDENCE', 'one cycle at a time: no retraining stack');
    im().completeTraining(world.founder, planned.intervention.id);
    check(im().assessIntervention(planned.intervention.id).intervention.effect === 'NOT_YET_TESTED', 'training completed is not learning proven');
    for (let i = 0; i < 2; i++) await reviewedVerified(world.analyst, 'ACHIEVED', script(FINAL(`later.${i}`)));
    const judged = im().assessIntervention(planned.intervention.id).intervention;
    check(judged.effect === 'IMPROVEMENT_OBSERVED' && judged.evidenceRefs.length >= 2, 'improvement is claimed only on later comparable, qualified evidence');
    world.mistakeWork = id;
    world.mistakeAttribution = a.id;
    return { effect: judged.effect, followups: judged.evidenceRefs.length };
  });

  await step('successful-pattern-is-candidate-first', () => {
    const memory = runtime.mind.memory;
    const lesson = memory.nominateLesson(world.founder, world.patternObservation, 'pattern.candidate');
    memory.validateLesson(world.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'pattern.validated' });
    const pr = memory.requestPromotion('system:learning', lesson.id, 'COMPANY');
    check(refusedWith(() => memory.decidePromotion(world.founder, pr.id, { decision: 'APPROVE', reasonCode: 'share' }), 'PATTERN_REUSE_NOT_VERIFIED'), 'one success is not Company best practice');
    return { shared: false };
  });

  await step('repeated-failures-across-employees-become-a-systemic-finding-in-founder-attention', async () => {
    for (const owner of [world.director, world.analyst]) {
      const { id } = await reviewedVerified(owner, 'NOT_ACHIEVED');
      const a = im().attributions({ workItemId: id })[0];
      im().decideAttribution(world.founder, a.id, { decision: 'VALIDATE', reasonCode: 'founder.confirmed' });
    }
    const finding = im().systemicFindings({ state: 'CANDIDATE' }).find((f) => f.targetKind === 'WORKFLOW');
    check(finding && finding.distinctEmployees >= 2 && finding.occurrences >= 3, 'double-loop learning: the workflow, not only each person, is questioned');
    runtime.founder.attention.sync(world.founder);
    check(runtime.founder.attention.list().some((i) => i.sourceRef === `systemic_finding:${finding.id}` && i.lane === 'NEEDS_ME'), 'a material systemic finding reaches Founder Attention');
    const m = meter();
    try {
      runtime.founder.attention.sync(world.founder);
      check(m.changes === 0, 'a stable world reconciles in silence');
    } finally {
      m.off();
    }
    im().decideSystemicFinding(world.founder, finding.id, { decision: 'VALIDATE', reasonCode: 'founder.agreed' });
    check(runtime.founder.attention.sync(world.founder).resolved >= 1, 'deciding it resolves the attention item');
    return { finding: finding.targetKind, occurrences: finding.occurrences };
  });

  await step('real-failure-becomes-a-hidden-gold-case', () => {
    const c = im().openFailureCase(world.founder, world.mistakeWork);
    im().advanceFailureCase(world.founder, c.id, { to: 'CAUSE_ANALYSIS', reasonCode: 'analysis' });
    im().advanceFailureCase(world.founder, c.id, { to: 'VALID_FAILURE_CASE', reasonCode: 'cause.validated', attributionId: world.mistakeAttribution });
    im().advanceFailureCase(world.founder, c.id, { to: 'REGRESSION_CANDIDATE', reasonCode: 'candidate' });
    check(refusedWith(() => im().advanceFailureCase(world.founder, c.id, { to: 'GOLD_CASE', reasonCode: 'gold', academyScenarioId: world.scenarios.practice, calibrationRunId: world.calibrationRunId }), 'HOLDOUT_MISMATCH'), 'a hidden Gold case is bound only to a holdout scenario');
    const gold = im().advanceFailureCase(world.founder, c.id, { to: 'GOLD_CASE', reasonCode: 'gold', academyScenarioId: world.scenarios.gold, calibrationRunId: world.calibrationRunId });
    check(gold.hidden && !im().retrainingMaterial().includes(world.scenarios.gold), 'the hidden holdout is never handed to a trainee');
    check(!JSON.stringify([im().inspect({ kind: 'COMPANY' }), im().inspect({ kind: 'EMPLOYEE', id: world.analyst.id })]).includes('gold-figures-1'), 'inspection never exposes holdout content');
    return { stage: gold.stage, hidden: gold.hidden };
  });

  await step('reports-typed-claims-no-score-and-cost-per-qualified-outcome', () => {
    const reports = ['DAILY', 'WEEKLY', 'MONTHLY'].map((c) => im().generateReport(c).report);
    for (const r of reports) {
      check(r.claims.length > 0 && r.claims.every((c) => c.kind === 'FACT' || (c.evidenceRefs.length > 0 && c.uncertainty !== null)), `${r.cadence}: every judgement cites evidence and carries uncertainty`);
      check(!/score|rank|leaderboard/i.test(JSON.stringify(r.claims.map((c) => [c.code, Object.keys(c.params)]))), `${r.cadence}: no universal score or leaderboard`);
    }
    const [daily, weekly, monthly] = reports;
    check(weekly.claims.some((c) => c.code === 'EXTERNAL_OUTCOMES_UNAVAILABLE'), 'external outcomes are stated as unavailable (C7), never invented');
    check(weekly.claims.some((c) => c.code === 'COST_PER_QUALIFIED_OUTCOME') && weekly.claims.some((c) => c.code === 'GOAL_PROGRESS' && c.subject.id === world.goalId), 'weekly: cost per qualified outcome and Goal progress');
    check(monthly.claims.some((c) => c.code === 'CONSIDER_PROCESS_CHANGE' && c.kind === 'RECOMMENDATION'), 'monthly: a validated systemic finding is a recommendation (never an act)');
    check(im().generateReport('WEEKLY', { at: weekly.periodTo }).changed === false, 'identical regeneration is idempotent');
    const analyst = im().economics({ employeeId: world.analyst.id });
    const director = im().economics({ employeeId: world.director.id });
    check(analyst.state === 'DEFINED' && analyst.costPerQualifiedOutcomeMicros > 0, 'the analyst has a defined cost per qualified outcome');
    check(director.state === 'NO_QUALIFIED_OUTCOME' && director.costPerQualifiedOutcomeMicros === null, 'a cheaper employee with no qualified outcome is never "the cheapest"');
    check(classifyFounderIntent('weekly report').intent === 'SHOW_REPORT' && classifyFounderIntent('how is Nour doing').intent === 'SHOW_PERFORMANCE', 'natural-language inspection extends the existing Founder command channel (reads)');
    return { daily: daily.claims.length, weekly: weekly.claims.length, monthly: monthly.claims.length };
  });

  await step('c5-change-signalling-contract-intact', () => {
    const m = meter();
    try {
      im().definitions();
      im().profile(world.analyst.id);
      im().inspect({ kind: 'GOAL', id: world.goalId });
      im().economics();
      im().reviewerCalibration();
      im().latestReport('WEEKLY');
      runtime.founder.goals.list();
      runtime.founder.attention.list();
      runtime.founder.universe();
      im().evaluate(world.qualifiedWork);
      check(m.changes === 0, 'reads, and an unchanged re-evaluation, announce nothing (no refresh storm)');
    } finally {
      m.off();
    }
    return { announcements: 0 };
  });

  await step('founder-free-ordinary-judgment-cycle-changes-no-authority-or-spend', async () => {
    // Content-free fingerprint of everything that is authority, money ceilings or policy (public reads only).
    const authorityFingerprint = () => {
      const gov = runtime.governance;
      const employees = gov.listEmployees().map((e) => ({ id: e.id, state: e.state, roleRef: e.roleRef, departmentId: e.departmentId }));
      const envelopes = [['COMPANY', 'company'], ...gov.listDepartments().map((d) => ['DEPARTMENT', d.id]), ...employees.map((e) => ['EMPLOYEE', e.id])];
      return JSON.stringify({
        employees,
        grants: employees.flatMap((e) => gov.grants(e.id).map((g) => [g.id, g.capability, g.resourceScope, g.riskCeiling, g.dataClassCeiling, g.expiresAt, g.maxUses, g.status])),
        budgets: envelopes.map(([s, id]) => gov.budgetFor(s, id)).filter(Boolean).map((b) => [b.id, b.capMoney, b.capTokens, b.runCapMoney, b.runCapTokens, b.status]),
        approvals: gov.listApprovals().map((a) => [a.id, a.state]),
        routing: ((r) => ({ policy: r.policy, deployments: r.deployments.map((d) => [d.id, d.status, d.qualification, d.reasoningClass, d.egressMaxDataClass, d.priceCard]) }))(gov.routingSnapshot('draft.memo')),
        seats: runtime.org.organization.positions().map((p) => [p.id, p.status, p.roleRef, p.reportsToPositionId]),
        delegations: runtime.org.organization.authorityDelegations().map((d) => [d.id, d.status]),
        qualifications: review.qualifications().map((q) => [q.id, q.employeeId, q.domain, q.level, q.mode, q.maxDataClass]),
        certifications: employees.flatMap((e) => runtime.mind.academy.certifications(e.id).map((c) => [c.id, c.status, c.roleRef, c.validUntil])),
      });
    };
    // Established beforehand by the Founder (setup, never a judgment): Work Item budgets and Review Plans that
    // delegate operational judgment to the Review Pool; the reviewer's own run cites its outcome judgment.
    const poolPlan = (verdict) => ({ ...reviewPlan(), operationalJudgment: 'REVIEW_POOL', reviewerInstructions: script({ type: 'REVIEW_DECISION', outcome: 'PASS', reasonCode: 'rubric.applied', rationale: 'Checked against the rubric and the outcome evidence.', evidenceRefs: ['evidence:rubric'], outcomeVerdict: verdict, outcomeEvidence: ['REVIEW_DECISION', 'WORK_LINEAGE'] }, FINAL('review.done')) });
    const prepare = (instructions, plan) => {
      const { workItem } = runtime.submitWorkItem({ objective: 'ordinary governed work', ownerRef: world.analyst.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 256, instructions } });
      runtime.governance.createBudget(world.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'acceptance' });
      review.declarePlan(world.founder, workItem.id, plan);
      return workItem.id;
    };
    const w1 = prepare(script({ type: 'OBSERVATION', topic: 'drafting.sources', content: 'I suspect I cited stale sources because I did not re-check them before submitting.' }, FINAL('draft.done')), poolPlan('NOT_ACHIEVED'));
    const later = [prepare(script(FINAL('later.pool.a')), poolPlan('ACHIEVED')), prepare(script(FINAL('later.pool.b')), poolPlan('ACHIEVED'))];
    const founderPlanned = prepare(script(FINAL('founder.judged')), reviewPlan());
    const before = authorityFingerprint();
    const memory = runtime.mind.memory;
    let detail;
    disarmFounderTestSurface(company);
    try {
      check(refusedWith(() => verify(w1, 'ACHIEVED'), 'FOUNDER_SURFACE_UNAVAILABLE'), 'from here on every Founder act fails closed');
      // Work within the existing grant and budget → independent qualified review → the keys verify the outcome.
      runtime.transitionWorkItem(w1, { to: 'READY', reasonCode: 'assigned' });
      await until(() => stateOf(w1) === 'CLOSED', 'reviewed and verified NOT_ACHIEVED by the Review Pool');
      // Evaluation → an attribution proposal → an independent pool judge (never the subject) validates it from its own run.
      im().evaluate(w1);
      const a = im().attributions({ workItemId: w1 })[0];
      check(a?.state === 'PROPOSED' && a.overall === 'EMPLOYEE_JUDGMENT', 'the evaluator proposes; nobody has decided yet');
      check(im().judgments({ subjectId: a.id })[0]?.judgeEmployeeId === world.reviewer.id, 'an independent, qualified pool judge — never the subject Employee');
      await until(() => im().attributions({ workItemId: w1 })[0]?.state === 'VALIDATED', 'the pool judge validates the cause');
      check(im().attributions({ workItemId: w1 })[0].decidedByRef === `employee:${world.reviewer.id}`, 'the validator is the assigned judge');
      // The reflection is a hypothesis → classified → independent Review Pool review → VALIDATED.
      const obs = memory.lessons(world.analyst.id).find((l) => l.stage === 'OBSERVATION' && l.eventRef === `work_item:${w1}`);
      check(obs && im().classifyObservation(obs.id, 'MISTAKE_LESSON').source === 'REFLECTION', 'an Employee reflection');
      const lr = im().requestLearningReview(obs.id);
      await until(() => memory.lesson(lr.lessonId).stage === 'VALIDATED', 'the pool judge validates the lesson');
      const lesson = memory.lesson(lr.lessonId);
      check(lesson.reviewPath === 'INDEPENDENT_REVIEW' && lesson.decidedByRef === `employee:${world.reviewer.id}`, 'validated on the independent review path, never by its maker');
      check(memory.requestPromotion('system:learning', lesson.id, 'COMPANY').state === 'PENDING_REVIEW', 'a validated lesson never becomes Company knowledge by itself');
      check(memory.requestPromotion('system:learning', lesson.id, 'PERSONAL').state === 'APPROVED', 'the lesson is delivered to its own Employee');
      // Targeted retraining inside the existing envelope; training completed is not improvement.
      const planned = im().planReviewedIntervention(lesson.id, 'TARGETED_RETRAINING');
      check(planned.outcome === 'PLANNED' && planned.intervention.remediationId === null, 'ordinary retraining is planned without new budget or authority');
      await sleep(5);
      im().completeReviewedTraining(planned.intervention.id);
      check(im().assessIntervention(planned.intervention.id).intervention.effect === 'NOT_YET_TESTED', 'training completed is not learning proven');
      // Later comparable work decides the effect.
      await sleep(5);
      for (const id of later) {
        runtime.transitionWorkItem(id, { to: 'READY', reasonCode: 'assigned' });
        await until(() => stateOf(id) === 'OUTCOME_VERIFIED', 'reviewed and verified ACHIEVED by the Review Pool');
        check(im().evaluate(id).evaluation.qualifiedOutcome, 'a pool-verified ACHIEVED is a qualified outcome');
      }
      const effect = im().assessIntervention(planned.intervention.id).intervention.effect;
      check(effect === 'IMPROVEMENT_OBSERVED', `later comparable, qualified evidence decides the effect (saw ${effect})`);
      // A plan that keeps the Founder's judgment keeps it: reviewed, never verified without the Founder.
      runtime.transitionWorkItem(founderPlanned, { to: 'READY', reasonCode: 'assigned' });
      await until(() => stateOf(founderPlanned) === 'REVIEWED', 'reviewed under a Founder-judgment plan');
      await sleep(50);
      check(stateOf(founderPlanned) === 'REVIEWED', 'a case that needs the Founder stays waiting for the Founder');
      detail = { verifier: 'REVIEW_POOL', attribution: 'POOL_VALIDATED', lesson: 'POOL_VALIDATED', effect, founderActsDuringCycle: 0 };
    } finally {
      armFounderTestSurface(company);
    }
    check(authorityFingerprint() === before, 'grants, budget caps, approvals, routing, seats, delegations, qualifications and certifications are unchanged');
    check(verify(founderPlanned, 'ACHIEVED').state === 'OUTCOME_VERIFIED', 'the Founder remains the exception authority');
    return detail;
  });

  await step('encrypted-portable-backup-honest-failure-domain-and-attention', async () => {
    const authStore = CompanyStore.open(company);
    try {
      const auth = FounderAuthStore.for(authStore);
      auth.redeemLaunchToken(auth.mintLaunchToken().token);
    } finally {
      authStore.close();
    }
    const writer = CompanyStore.open(company);
    try {
      world.artifact = new ArtifactStore(writer).put({ content: 'تقرير النمو: مسودة معتمدة', mediaType: 'text/plain', workItemId: world.qualifiedWork });
    } finally {
      writer.close();
    }
    // An uncertain UNSAFE external effect, held for reconciliation before the package is sealed.
    syncerDriver.hangNext();
    world.uncertainWork = submit(world.analyst, script({ type: 'TOOL_REQUEST', tool: 'syncer', action: 'sync', args: {} }, FINAL('synced')));
    await until(() => runtime.view.jobsFor(world.uncertainWork).at(-1)?.state === 'RECONCILIATION_HOLD', 'the uncertain effect is held');
    world.syncerCallsBefore = syncerDriver.invocations.length;
    const same = await runtime.portableBackup({ destination: new DirectoryDestination(external), passphrase: PASSPHRASE });
    check(same.failureDomain === 'SAME_VOLUME', 'a directory on the laptop’s own volume is honestly not off-device');
    const status = runtime.resilience();
    check(status.exceptions.some((x) => x.code === 'OFF_DEVICE_NOT_PROVEN' && x.material), 'the status says the off-device objective is not met');
    runtime.founder.attention.sync(world.founder);
    check(runtime.founder.attention.list().some((i) => i.dedupKey === 'resilience:OFF_DEVICE_NOT_PROVEN'), 'a material recovery exception reaches Founder Attention');
    const off = await runtime.portableBackup({ destination: new DirectoryDestination(attested, { attestOffDevice: true }), passphrase: PASSPHRASE });
    check(off.failureDomain === 'ATTESTED_OFF_DEVICE' && runtime.resilience().portableBackup.withinOffDeviceRpo, 'an operator-attested off-device package meets the objective');
    world.package = { name: off.name, dir: attested, artifacts: off.artifacts };
    return { sameVolume: same.packageId, offDevice: off.packageId, artifacts: off.artifacts };
  });

  await step('tampered-or-wrong-key-packages-fail-closed', () => {
    const bytes = new DirectoryDestination(attested).get(world.package.name);
    const tampered = Buffer.from(bytes);
    tampered[tampered.length - 64] ^= 0xff;
    check(refusedWith(() => S.restorePortableBackup(tampered, path.join(sandbox, 'tamper-target'), { passphrase: PASSPHRASE }), 'BACKUP_INTEGRITY'), 'a tampered package fails authentication');
    check(refusedWith(() => S.restorePortableBackup(bytes, path.join(sandbox, 'wrong-key-target'), { passphrase: `${PASSPHRASE}-x` }), 'BACKUP_INTEGRITY'), 'the wrong recovery passphrase fails');
    check(!bytes.includes(Buffer.from(REFLECTION)) && !bytes.includes(Buffer.from(PASSPHRASE)), 'company content and the passphrase never appear in the package in clear');
    return { tamper: 'REFUSED', wrongKey: 'REFUSED' };
  });

  await step('generational-retention-and-restore-drill', async () => {
    for (let i = 0; i < 3; i++) await runtime.backup();
    const pruned = runtime.pruneBackups({ keepLast: 2, daily: 0, weekly: 0, monthly: 0 });
    check(pruned.local.kept.length === 2 && pruned.local.retired.length >= 3, 'several generations kept, older ones retired');
    const store = CompanyStore.open(company);
    try {
      check(S.listBackups(store).length === 2, 'discovery follows the records (retired generations are not canonical)');
    } finally {
      store.close();
    }
    const drill = runtime.restoreDrill();
    check(drill.result === 'PASS', 'an isolated restore drill passes and is recorded');
    return { kept: pruned.local.kept.length, retired: pruned.local.retired.length, drillMs: drill.durationMs };
  });

  const liveFacts = {
    employees: runtime.governance.listEmployees().map((e) => e.id).sort(),
    evaluations: im().evaluations().map((e) => e.id).sort(),
    attributions: im().attributions().map((a) => a.id).sort(),
    lessons: runtime.mind.memory.lessons(world.analyst.id).map((l) => l.id).sort(),
  };
  await runtime.stop();

  await step('clean-device-restore-preserves-the-company-and-rekeys', () => {
    const target = path.join(sandbox, 'replacement-device');
    const report = S.restorePortableBackup(new DirectoryDestination(world.package.dir).get(world.package.name), target, { passphrase: PASSPHRASE });
    check(report.quickCheck === 'ok' && report.foundersSessionsRevoked >= 1, 'integrity verified; the lost device’s Founder sessions are revoked');
    check(report.rekeyRequired.includes('vault:publisher'), 'credential references to re-key are reported (never secrets)');
    check(report.reconciliationPending.toolInvocationsUncertain >= 1, 'the uncertain effect is reported for reconciliation');
    const restored = CompanyStore.open(target);
    try {
      const r = ImprovementStore.for(restored);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      check(same(GovernanceStore.for(restored).listEmployees().map((e) => e.id).sort(), liveFacts.employees), 'Employee identities preserved');
      check(liveFacts.evaluations.every((id) => r.evaluations().some((e) => e.id === id)), 'evaluations preserved');
      check(liveFacts.attributions.every((id) => r.attributions().some((a) => a.id === id)), 'attributions preserved');
      check(new ArtifactStore(restored).read(world.artifact.id).toString('utf8') === 'تقرير النمو: مسودة معتمدة', 'artifact objects restored byte-exact');
      check(restored.auditByAction('outcome.verified').length >= 1 && restored.getWorkItem(world.qualifiedWork).state === 'OUTCOME_VERIFIED', 'work and audit lineage preserved');
    } finally {
      restored.close();
    }
    world.restoredRoot = target;
    return { schema: report.schemaVersionAfter, artifacts: report.artifactsRestored, sessionsRevoked: report.foundersSessionsRevoked };
  });

  await step('restored-company-resumes-without-repeating-an-uncertain-effect', async () => {
    syncerDriver = new FakeToolDriver('fake-syncer');
    const resumed = new CompanyRuntime({ workspace: world.restoredRoot, processors: [employeeTaskProcessor], supervisorTtlMs: 2_000, governance: { providers: [provider], toolDrivers: [publisher, notesDriver, syncerDriver], toolCallTimeoutMs: 1_000 } });
    try {
      await resumed.start();
      await sleep(1_500);
      check(resumed.view.jobsFor(world.uncertainWork).at(-1)?.state === 'RECONCILIATION_HOLD', 'the uncertain effect stays held after the restored start');
      check(syncerDriver.invocations.length === 0, 'the restored Company never blindly repeats it');
      return { held: true };
    } finally {
      await resumed.stop();
    }
  });

  await step('update-is-snapshotted-rehearsed-verified-activated-then-rolled-back-into-hold', async () => {
    const root = path.join(sandbox, 'upgrade-workspace');
    check(createWorkspaceAtVersionForTest(root, 9) === 9, 'a real v9 (C5) workspace');
    const report = await S.safeUpgrade(root);
    check(report.outcome === 'ACTIVATED' && report.fromVersion === 9 && report.toVersion === S.CURRENT_SCHEMA_VERSION && report.snapshotSha256, 'Preflight → Backup → Rehearse → Migrate → Verify → Activate');
    const rollback = await S.rollbackSchemaUpdate(root, report.updateId);
    check(rollback.restored && S.readUpdateHold(root)?.code === 'OPERATOR_ROLLBACK', 'the compatible pre-update snapshot is restored; the workspace is held');
    check(rollback.postUpdateWork.exists === false && /^[0-9a-f]{64}$/.test(rollback.preRollbackSnapshot.sha256), 'nothing after activation was discarded; the replaced database is retained (R2-31)');
    check(refusedWith(() => CompanyStore.open(root), 'UPDATE_HOLD'), 'a held workspace is never reopened (so never re-migrated in a loop)');
    S.clearUpdateHold(root, 'operator.reviewed');
    // After the hold is cleared the next upgrade is rehearsed again through the lifecycle (R2-30), never live at open.
    check((await S.safeUpgrade(root)).outcome === 'ACTIVATED', 'the re-upgrade goes through safe-upgrade');
    const reopened = CompanyStore.open(root);
    try {
      check(reopened.schemaVersion === S.CURRENT_SCHEMA_VERSION, 'after the operator clears the hold, the store opens');
    } finally {
      reopened.close();
    }
    return { outcome: report.outcome, rollback: 'UPDATE_HOLD' };
  });

  await step('health-and-cli-content-free', () => {
    const out = cliRun('improvement', '--workspace', company);
    check(out.status === 0, 'the improvement CLI is a read-only, content-free view');
    check(!out.stdout.includes(REFLECTION) && !out.stdout.includes('Win Saudi'), 'no reflection or Goal text in CLI output');
    const store = CompanyStore.open(company);
    try {
      const audit = JSON.stringify(store.auditByAction('learning.classified').concat(store.auditByAction('evaluation.recorded')));
      check(!audit.includes(REFLECTION), 'audit carries ids and codes only (Rule A)');
    } finally {
      store.close();
    }
    return { cli: 'CONTENT_FREE' };
  });
} finally {
  if (runtime.state === 'READY') await runtime.stop().catch(() => undefined);
  void runtimeHealth;
}

const verdict = failed ? 'FAIL' : 'PASS';
console.log(JSON.stringify({ verdict: `C6 LOCAL ACCEPTANCE — ${verdict}`, steps: results.length, passed: results.filter((r) => r.result === 'PASS').length }));
if (!values.keep) {
  rmSync(preExisting ? company : sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (preExisting) for (const f of readdirSync(sandbox)) rmSync(path.join(sandbox, f), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
process.exit(failed ? 1 : 0);
