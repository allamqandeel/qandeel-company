#!/usr/bin/env node
// C4 local acceptance harness — for the Founder-host review (and CI), runnable without editing source.
//
//   npm run c4:acceptance -- --workspace <disposable directory> [--keep]
//
// The directory must not exist yet, or be empty. The harness writes an ownership marker, creates a
// Company workspace in <dir>/company and proves, with the deterministic fake provider (no network, no
// commercial provider, no credential):
//
// - production fail-closed first: with no Founder surface armed, no organization / delegation / review
//   authority act can be performed by presenting a reference, and the CLI has no C4 write command;
// - the canonical Strong-v1 skeleton (Founder → company-scoped CEO seat → five Director seats, Engineering the
//   permanent fifth), vacant — no CEO identity or headcount invented;
// - then, through the TEST-ONLY Founder seam (loaded only under --conditions=qandeel-test, never a product
//   path) standing in for the authenticated Founder surface C5 will provide: placements (a company-scoped
//   CEO, Directors, a report), headcount as data, bounded acting coverage, a reviewer certified by the
//   Academy and calibrated through real shadow reviews, staffing (Director request → CEO synthesis → capped
//   delegated decision → CANDIDATE hire), work delegation with a parked delegator, output review by the
//   reviewer's own run, R3 = review AND approval, P-07 across runs, restart durability, C4 health and the
//   read-only CLI — all content-free.
//
// At the end it deletes only what it created unless --keep is given.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const MARKER = '.qandeel-c4-acceptance';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'packages/runtime/dist/src/cli.js');

const { values } = parseArgs({ strict: true, options: { workspace: { type: 'string' }, keep: { type: 'boolean', default: false } } });
const { CompanyRuntime, DeterministicFakeProvider, FakeToolDriver, employeeTaskProcessor, runtimeHealth } = await import('@qandeel-company/runtime');
const { AcademyStore, CompanyStore, GovernanceStore, OrganizationStore, ReviewStore, SkillStore, CURRENT_SCHEMA_VERSION } = await import('@qandeel-company/storage');
const { ASSESSMENT_DIMENSIONS, DEFAULT_CRITICAL_DIMENSIONS, DETERMINISTIC_DIMENSIONS } = await import('@qandeel-company/mind');
// Test-only seam: resolvable only because this harness runs with --conditions=qandeel-test.
const { activateEmployeeForTest, armFounderTestSurface } = await import('@qandeel-company/storage/testing');

function refuse(message) {
  console.error(JSON.stringify({ ok: false, verdict: 'REFUSED', message }));
  process.exit(2);
}
if (!values.workspace) refuse('usage: npm run c4:acceptance -- --workspace <new or empty directory> [--keep]');
const sandbox = path.resolve(values.workspace);
for (let dir = sandbox; ; dir = path.dirname(dir)) {
  if (existsSync(path.join(dir, '.git'))) refuse('the acceptance directory must not be inside a Git working tree (source checkouts are never touched)');
  if (path.dirname(dir) === dir) break;
}
if (existsSync(sandbox) && readdirSync(sandbox).length > 0) refuse('the acceptance directory must not exist or must be empty');
const preExisting = existsSync(sandbox);
mkdirSync(sandbox, { recursive: true });
writeFileSync(path.join(sandbox, MARKER), 'created by the QANDEEL COMPANY C4 acceptance harness; safe to delete\n');
const company = path.join(sandbox, 'company');

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
    console.log(JSON.stringify({ step: name, result: 'FAIL', ms: Date.now() - started, code: error?.code ?? 'ERROR', message: String(error?.message ?? error).slice(0, 300) }));
  }
}
const cliRun = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', shell: false, windowsHide: true });
const refusedWith = (fn, code) => {
  try {
    fn();
  } catch (error) {
    return error?.code === code;
  }
  return false;
};
const script = (...o) => JSON.stringify({ script: o });
const FINAL = (code = 'done') => ({ type: 'FINAL', summaryCode: code });
const CANONICAL = ['strategic-market-intelligence', 'growth', 'brand-creative', 'product', 'engineering'];
const DOMAIN = 'quality.general';
const EVIDENCE = 'Organic search in Egypt is unowned; twelve SEO items waited six weeks.';
const RATIONALE = 'Figures cross-checked against the cited sources.';
const inAYear = () => new Date(Date.now() + 365 * 86_400_000).toISOString();
const reviewPlan = (appliesTo, outcome = 'PASS', rationale = RATIONALE) => ({
  domain: DOMAIN,
  appliesTo,
  keys: [{ kind: 'SPECIALIST' }],
  rubric: { code: 'quality.rubric', version: 1 },
  reviewerInstructions: script({ type: 'REVIEW_DECISION', outcome, reasonCode: 'rubric.applied', rationale, evidenceRefs: ['evidence:rubric'] }, FINAL('review.done')),
  reviewTaskClass: 'draft.memo',
  reviewBudget: { money: 200_000, tokens: 200_000 },
});

const world = {};
await step('production-c4-authority-closed', () => {
  const store = CompanyStore.open(company);
  try {
    check(store.schemaVersion === CURRENT_SCHEMA_VERSION && CURRENT_SCHEMA_VERSION >= 8, 'schema carries the C4 migrations');
    const f = 'founder:00000000-0000-4000-8000-000000000000';
    const closed = 'FOUNDER_SURFACE_UNAVAILABLE';
    const org = OrganizationStore.for(store);
    const ceo = org.positionByCode('company.ceo');
    check(refusedWith(() => org.setPositionStatus(f, ceo.id, 'PAUSED', 'x'), closed), 'seats change only through the authenticated Founder surface');
    check(refusedWith(() => org.delegateAuthority(f, { employeeId: ceo.id, capability: 'org.staffing.decide', expiresAt: inAYear(), purposeCode: 'x', reasonCode: 'x' }), closed), 'authority is delegated only through the authenticated Founder surface');
    check(refusedWith(() => ReviewStore.for(store).admitReviewer(f, { employeeId: ceo.id, domain: DOMAIN, level: 'EXPERT', maxDataClass: 'D1', reasonCode: 'x' }), closed), 'the Review Pool admits only through the authenticated Founder surface');
  } finally {
    store.close();
  }
  for (const cmd of ['assign', 'hire', 'delegate', 'approve-staffing', 'admit-reviewer', 'resolve-conflict', 'declare-plan']) check(cliRun(cmd, '--workspace', company).status === 2, `the CLI has no ${cmd} command`);
  return { founderSurface: 'UNAVAILABLE_UNTIL_C5' };
});

await step('canonical-skeleton-vacant', () => {
  const store = CompanyStore.open(company);
  try {
    const org = OrganizationStore.for(store);
    check(CANONICAL.every((c) => org.departments().some((d) => d.code === c)), 'the five canonical Departments exist (Engineering the permanent fifth)');
    const ceo = org.positionByCode('company.ceo');
    check(ceo.scope === 'COMPANY' && ceo.departmentId === null && ceo.reportsToFounder, 'the CEO seat is company-scoped and reports to the Founder');
    check(CANONICAL.every((c) => org.positionByCode(`director.${c}`)?.reportsToPositionId === ceo.id), 'every Director seat reports to the CEO seat');
    check(org.positions().every((p) => org.seatHolder(p.id).holder === null), 'no seat is pre-staffed: no identity or headcount is invented');
    check(CANONICAL.every((c) => org.charter(org.departments().find((d) => d.code === c).id)?.status === 'BASELINE'), 'baseline charters from Product authority');
    return { departments: 5, seats: org.positions().length };
  } finally {
    store.close();
  }
});

await step('seed-and-place-via-test-seam', () => {
  armFounderTestSurface(company);
  const store = CompanyStore.open(company);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const founder = gov.registerFounder().ref;
    gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: 50_000_000, capTokens: 50_000_000, currency: 'USD', reasonCode: 'acceptance' });
    const dept = (code) => gov.departmentByCode(code).id;
    for (const c of ['growth', 'product']) gov.createBudget(founder, { scope: 'DEPARTMENT', scopeId: dept(c), capMoney: 20_000_000, capTokens: 20_000_000, reasonCode: 'acceptance' });
    const p = gov.registerProvider(founder, { code: 'fake-local', locality: 'LOCAL' });
    const model = gov.registerModel(founder, { providerId: p.id, code: 'fake-small' });
    const deployment = (code, rate) => {
      const d = gov.registerDeployment(founder, { code, modelId: model.id, pinnedRevision: 'r1', reasoningClass: 'E1', contextWindowTokens: 100_000, maxOutputTokens: 2_048, taskClasses: ['draft.memo'] });
      gov.addPriceCard(founder, d.id, { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: rate, billedOutputPerMTok: rate * 4, billedPerCall: 0, economicInputPerMTok: rate, economicOutputPerMTok: rate * 4, economicPerCall: 0 });
      for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED']) gov.setQualification(founder, d.id, q, 'acceptance');
      gov.approveEgress(founder, d.id, 'D4', 'local.only');
      return d.id;
    };
    world.deployments = { a: deployment('local-a', 1_000_000), b: deployment('local-b', 2_000_000) };
    gov.createRoutePolicy(founder, 'draft.memo', { minClass: 'E1', maxClass: 'E2', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 8, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 100_000 } });
    const pub = gov.registerTool(founder, { code: 'publisher', driverCode: 'fake-publisher', egress: 'EXTERNAL', credentialRef: 'vault:publisher' });
    gov.registerToolAction(founder, { toolId: pub.id, code: 'publish', risk: 'R3', sideEffects: 'IDEMPOTENT', mutatesExternal: true, dataClassCeiling: 'D1', argsSchema: { fields: { text: { type: 'string', required: true, maxLength: 200 } } }, costPerCallMicros: 100 });
    let n = 0;
    const names = ['Nour', 'Karim', 'Salma', 'Omar', 'Laila', 'Hany', 'Mona'];
    const hireAs = (roleRef, deptCode) => {
      const e = gov.createEmployee(founder, { name: { given: names[n++ % names.length], family: `Mansour${'abcdefg'[n % 7]}` }, profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef, positionRef: 'position:p1', departmentId: dept(deptCode), managerRef: founder });
      gov.transitionEmployee(founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
      gov.transitionEmployee(founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
      activateEmployeeForTest(gov, founder, e.id);
      gov.createBudget(founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 5_000_000, capTokens: 5_000_000, reasonCode: 'acceptance' });
      gov.grant(founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'acceptance' });
      return e;
    };
    const place = (e, code) => org.assignPrimary(founder, { positionId: org.positionByCode(code).id, employeeId: e.id, reasonCode: 'placed' });
    const ceo = hireAs('role:company.ceo', 'product');
    place(ceo, 'company.ceo');
    const director = hireAs('role:director.growth', 'growth');
    place(director, 'director.growth');
    const analystSeat = org.createPosition(founder, { code: 'growth.analyst-1', title: 'Growth Analyst', scope: 'DEPARTMENT', departmentId: dept('growth'), kind: 'SPECIALIST', roleRef: 'role:content-strategist', reportsToPositionId: org.positionByCode('director.growth').id, reasonCode: 'headcount.added' });
    const analyst = hireAs('role:content-strategist', 'growth');
    place(analyst, 'growth.analyst-1');
    gov.grant(founder, { employeeId: analyst.id, capability: 'tool:publisher.publish', riskCeiling: 'R3', dataClassCeiling: 'D1', reasonCode: 'acceptance' });
    // A reviewer: an Employee holding the domain's reviewer role; certified later by the Academy through runs.
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
    Object.assign(world, { founder, ceo, director, analyst, analystSeat, reviewer, programVersionId: pv.id, scenarios: { practice: sc('practice-1', 'PRACTICE'), holdout: sc('holdout-1', 'HOLDOUT') } });
    const placedCeo = gov.getEmployee(ceo.id);
    check(placedCeo.orgScope === 'COMPANY' && placedCeo.departmentId === null && placedCeo.managerRef === founder, 'the CEO is company-scoped; its manager is the Founder, who stays the Founder');
    check(gov.budgetFor('EMPLOYEE', ceo.id).parentId === gov.budgetFor('COMPANY', 'company').id, "the CEO's envelope hangs under the Company, never a fake Department");
    return { placed: 4, reviewerCandidate: 1 };
  } finally {
    store.close();
  }
});

const provider = new DeterministicFakeProvider('fake-local');
const publisher = new FakeToolDriver('fake-publisher');
let runtime = new CompanyRuntime({ workspace: company, processors: [employeeTaskProcessor], supervisorTtlMs: 2_000, governance: { providers: [provider], toolDrivers: [publisher] } });
const until = async (fn, what, ms = 45_000) => {
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
const submit = (owner, instructions, plan) => {
  const { workItem } = runtime.submitWorkItem({ objective: 'acceptance task', ownerRef: owner.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 256, instructions } });
  runtime.governance.createBudget(world.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'acceptance' });
  if (plan) runtime.org.review.declarePlan(world.founder, workItem.id, plan);
  runtime.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  return workItem.id;
};

try {
  await runtime.start();
  const { organization: org, review } = runtime.org;
  await step('idle-zero-provider-calls', async () => {
    await sleep(400);
    check(provider.totalCalls === 0, 'an idle organization calls no provider (no polling, no manager loops)');
    return { providerCalls: 0 };
  });
  await step('headcount-is-data-and-acting-is-bounded', async () => {
    const extra = org.createPosition(world.founder, { code: 'growth.copywriter-1', title: 'Copywriter', scope: 'DEPARTMENT', departmentId: world.director.departmentId, kind: 'SPECIALIST', roleRef: 'role:content-strategist', reportsToPositionId: org.positionByCode('director.growth').id, reasonCode: 'headcount.added' });
    org.setPositionStatus(world.founder, extra.id, 'PAUSED', 'freeze');
    org.setPositionStatus(world.founder, extra.id, 'ACTIVE', 'reopen');
    const d = org.positionByCode('director.growth');
    const acting = org.assignActing(world.founder, { positionId: d.id, employeeId: world.analyst.id, until: new Date(Date.now() + 1_500).toISOString(), reasonCode: 'leave.cover' });
    check(org.seatHolder(d.id).holder?.employeeId === world.analyst.id && org.seatHolder(d.id).ofRecord?.employeeId === world.director.id, 'acting coverage takes accountability; the holder of record stays');
    await sleep(1_700);
    check(org.seatHolder(d.id).holder?.employeeId === world.director.id, 'coverage ends by time, without any write');
    return { actingAssignment: acting.id };
  });
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
    check(refusedWith(() => review.promoteReviewer(world.founder, q.id, 'x'), 'REVIEWER_NOT_ELIGIBLE'), 'no independent review authority without calibration evidence');
    for (let i = 0; i < 2; i++) {
      const subject = submit(world.analyst, script(FINAL(`calibration.${i}`)), reviewPlan('OUTPUT'));
      await until(() => stateOf(subject) === 'WAITING_REVIEW', 'calibration subject');
      const req = await until(() => review.requests({ workItemId: subject }).find((r) => r.state === 'OPEN'), 'calibration request');
      const key = review.assignments(req.id).find((a) => a.keyKind === 'SHADOW');
      await until(() => stateOf(key.reviewWorkItemId) === 'COMPLETED', 'shadow review run');
      review.calibrateShadowDecision(world.founder, review.decisions(req.id).find((d) => d.assignmentId === key.id).id, 'PASS');
    }
    const promoted = review.promoteReviewer(world.founder, q.id, 'pool.promoted');
    check(promoted.mode === 'ACTIVE' && promoted.goldCasesPassed >= 1 && promoted.calibrationAgreements === 2, 'promoted on Gold cases + calibration evidence, admitted by the Founder');
    return { reviewer: 'ACTIVE', goldCases: promoted.goldCasesPassed };
  });
  await step('staffing-request-synthesis-delegated-decision-hire', async () => {
    org.delegateAuthority(world.founder, { employeeId: world.director.id, capability: 'org.staffing.request', expiresAt: inAYear(), purposeCode: 'staffing', reasonCode: 'delegated' });
    const args = { departmentCode: 'growth', roleRef: 'role:growth.seo-specialist', positionKind: 'SPECIALIST', positionTitle: 'SEO Specialist', businessNeed: EVIDENCE, workloadEvidence: 'Twelve items', skillGap: 'No SEO', expectedValue: 'Lower CAC', impactIfNotStaffed: 'Dark channel', alternatives: { redistributeWork: 'No capacity', improveSkillOrTraining: 'Too slow', automate: 'Not automatable', temporarySpecialistOrCapability: 'None' }, expectedCostMicros: 1_000_000 };
    const filed = submit(world.director, script({ type: 'ORG_ACTION', action: 'staffing.request.create', args }, FINAL('filed')));
    await until(() => stateOf(filed) === 'COMPLETED', 'the Director files');
    const [request] = org.staffingRequests();
    check(request?.state === 'SUBMITTED', 'a Staffing Request is evidence and a proposal, never hiring authority');
    for (const capability of ['org.staffing.review', 'org.staffing.hire']) org.delegateAuthority(world.founder, { employeeId: world.ceo.id, capability, expiresAt: inAYear(), purposeCode: 'staffing', limits: capability === 'org.staffing.hire' ? { maxCostMicros: 2_000_000 } : undefined, reasonCode: 'delegated' });
    org.delegateAuthority(world.founder, { employeeId: world.ceo.id, capability: 'org.staffing.decide', expiresAt: inAYear(), purposeCode: 'staffing', limits: { maxCostMicros: 2_000_000, departmentCodes: ['growth'] }, reasonCode: 'delegated' });
    const ceoRun = submit(world.ceo, script(
      { type: 'ORG_ACTION', action: 'staffing.request.review', args: { requestId: request.id, action: 'RECOMMEND_APPROVE', priority: 5 } },
      { type: 'ORG_ACTION', action: 'staffing.request.decide', args: { requestId: request.id, decision: 'APPROVE', positionCode: 'growth.seo-1' } },
      { type: 'ORG_ACTION', action: 'staffing.hire', args: { requestId: request.id, name: { given: 'Rania', family: 'Fouad' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' } } },
      FINAL('staffed'),
    ));
    await until(() => stateOf(ceoRun) === 'COMPLETED', 'the CEO synthesizes and decides within its delegation');
    const decided = org.staffingRequest(request.id);
    check(decided.state === 'APPROVED' && String(decided.decisionAuthorityRef).startsWith('authority_delegation:'), 'decided within an explicit, capped delegation');
    const hire = runtime.governance.getEmployee(decided.hiredEmployeeId);
    check(hire.state === 'CANDIDATE', 'a hire is a CANDIDATE: the Academy still decides activation');
    return { staffing: 'SUBMITTED→RECOMMENDED→APPROVED', hire: hire.state };
  });
  await step('work-delegation-parks-the-delegator', async () => {
    org.delegateAuthority(world.founder, { employeeId: world.director.id, capability: 'org.work.delegate', expiresAt: inAYear(), purposeCode: 'work', reasonCode: 'delegated' });
    const parent = submit(world.director, script({ type: 'ORG_ACTION', action: 'work.delegate', args: { delegateEmployeeId: world.analyst.id, objective: 'Draft the SEO brief', instructions: script(FINAL('brief.done')), taskClass: 'draft.memo', budgetMoney: 200_000, budgetTokens: 200_000 } }, FINAL('parent.done')));
    await until(() => stateOf(parent) === 'COMPLETED', 'delegated work completes, then the delegator');
    const [handoff] = org.workDelegations({ parentWorkItemId: parent });
    check(handoff?.state === 'COMPLETED' && stateOf(handoff.childWorkItemId) === 'COMPLETED', 'the handoff followed its work');
    check(runtime.view.runsForWorkItem(parent).length >= 2, 'the delegator waited (zero tokens) and resumed');
    return { handoff: handoff.state };
  });
  await step('output-review-by-the-reviewers-own-run', async () => {
    const id = submit(world.analyst, script(FINAL('draft.done')), reviewPlan('OUTPUT'));
    await until(() => stateOf(id) === 'REVIEWED', 'independent review');
    const req = review.requests({ workItemId: id }).find((r) => r.state === 'SATISFIED');
    const key = review.assignments(req.id).find((a) => a.keyKind === 'SPECIALIST');
    check(key.reviewerEmployeeId === world.reviewer.id && key.reviewerEmployeeId !== world.analyst.id, 'reviewed by a qualified, independent reviewer');
    return { review: 'SATISFIED' };
  });
  await step('r3-needs-review-and-approval', async () => {
    const id = submit(world.analyst, script({ type: 'TOOL_REQUEST', tool: 'publisher', action: 'publish', args: { text: 'launch notes' } }, FINAL('published')), reviewPlan('ACTIONS'));
    await until(() => runtime.view.jobsFor(id).at(-1)?.waitReason === 'AWAITING_APPROVAL', 'the review passes, then the approval is asked');
    check(publisher.invocations.length === 0, 'nothing executes before the Founder approves');
    const [pending] = runtime.governance.listApprovals('PENDING');
    runtime.governance.decideApproval(world.founder, pending.id, { decision: 'APPROVE', reasonCode: 'founder.ok' });
    await until(() => stateOf(id) === 'COMPLETED', 'executes once');
    check(publisher.invocations.length === 1, 'exactly once');
    return { executed: 1 };
  });
  await step('p07-charged-failure-excluded-across-runs', async () => {
    provider.failNextCharged('local-a', 'TRANSIENT', { inputTokens: 40, outputTokens: 0 });
    provider.failNext('local-b', 'CAPACITY');
    const before = provider.calls.get('local-a') ?? 0;
    const id = submit(world.analyst, script(FINAL('done')));
    await until(() => stateOf(id) === 'COMPLETED', 'retried work completes');
    check((provider.calls.get('local-a') ?? 0) - before === 1, 'the charged deployment is not selected again for this Work Item');
    check(runtime.governance.chargedExclusions(id).includes(world.deployments.a), 'the exclusion is visible');
    return { runs: runtime.view.runsForWorkItem(id).length };
  });
  await step('restart-durability', async () => {
    await runtime.stop();
    runtime = new CompanyRuntime({ workspace: company, processors: [employeeTaskProcessor], supervisorTtlMs: 2_000, governance: { providers: [provider], toolDrivers: [publisher] } });
    await runtime.start();
    const o = runtime.org.organization;
    check(o.seatHolder(o.positionByCode('company.ceo').id).holder?.employeeId === world.ceo.id, 'placements survive a restart');
    check(runtime.org.review.qualifications({ employeeId: world.reviewer.id })[0]?.mode === 'ACTIVE', 'the Review Pool survives a restart');
    return { restarted: true };
  });
  await step('health-and-cli-content-free', () => {
    const h = runtimeHealth(runtime);
    const json = JSON.stringify(h);
    check(h.readiness.ready && h.components.organization !== null, 'C4 health present');
    check(!json.includes(EVIDENCE) && !json.includes(RATIONALE), 'health is content-free');
    const orgOut = cliRun('organization', '--workspace', company);
    const rev = cliRun('reviews', '--workspace', company);
    check(orgOut.status === 0 && rev.status === 0, 'read-only CLI commands');
    check(![orgOut.stdout, rev.stdout].some((o) => o.includes('Organic search') || o.includes('cross-checked') || o.includes('REVIEW_DECISION')), 'CLI output is content-free');
    check(runtime.governance.accountingInvariants().length === 0, 'accounting invariants hold');
    return { status: h.status, reasons: h.reasons.join(',') };
  });
} finally {
  await runtime.stop().catch(() => undefined);
}

const verdict = failed ? 'C4 LOCAL ACCEPTANCE — FAIL' : 'C4 LOCAL ACCEPTANCE — PASS';
console.log(JSON.stringify({ verdict, steps: results.length, node: process.versions.node, platform: process.platform, sandbox: values.keep ? sandbox : '(removed)' }));
if (!values.keep && existsSync(path.join(sandbox, MARKER))) {
  if (preExisting) for (const entry of [MARKER, 'company']) rmSync(path.join(sandbox, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  else rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
process.exit(failed ? 1 : 0);
