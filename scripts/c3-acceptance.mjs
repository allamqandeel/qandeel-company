#!/usr/bin/env node
// C3 local acceptance harness — for the Founder-host review (and CI), runnable without editing source.
//
//   npm run c3:acceptance -- --workspace <disposable directory> [--keep]
//
// The directory must not exist yet, or be empty. The harness writes an ownership marker, creates a
// Company workspace in <dir>/company and proves, with the deterministic fake provider (no network, no
// commercial provider, no credential):
//
// - production fail-closed first: with no Founder surface armed, no C3 authority act (canonical truth,
//   knowledge, skill pipeline, Academy, activation) can be performed by presenting a reference, and the
//   CLI has no C3 write command;
// - then, through the TEST-ONLY Founder seam (loaded only under --conditions=qandeel-test, never a
//   product path) standing in for the authenticated Founder surface C5 will provide: the Skill
//   pipeline (license / inspection / paid dependency), a role blueprint and Academy program, a trainee
//   who is NOT activated by any seam, Academy attempts and shadow work executed by the real runtime in
//   constrained mode through the governed Context Assembler, certification, an activation request
//   that production cannot approve, Founder (seam) activation that re-checks the evidence, governed
//   memory proposals decided by policy, manifest-bound reservations, a durable capability gap, C3
//   health and the read-only CLI — all content-free.
//
// At the end it deletes only what it created unless --keep is given.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const MARKER = '.qandeel-c3-acceptance';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'packages/runtime/dist/src/cli.js');

const { values } = parseArgs({ strict: true, options: { workspace: { type: 'string' }, keep: { type: 'boolean', default: false } } });
const { CompanyRuntime, DeterministicFakeProvider, FakeToolDriver, employeeTaskProcessor, runtimeHealth } = await import('@qandeel-company/runtime');
const { AcademyStore, CompanyStore, GovernanceStore, MemoryStore, SkillStore, CURRENT_SCHEMA_VERSION } = await import('@qandeel-company/storage');
const { ASSESSMENT_DIMENSIONS, DEFAULT_CRITICAL_DIMENSIONS, DETERMINISTIC_DIMENSIONS } = await import('@qandeel-company/mind');
// Test-only seam: resolvable only because this harness runs with --conditions=qandeel-test.
const { activateEmployeeForTest, armFounderTestSurface, disarmFounderTestSurface } = await import('@qandeel-company/storage/testing');

function refuse(message) {
  console.error(JSON.stringify({ ok: false, verdict: 'REFUSED', message }));
  process.exit(2);
}
if (!values.workspace) refuse('usage: npm run c3:acceptance -- --workspace <new or empty directory> [--keep]');
const sandbox = path.resolve(values.workspace);
for (let dir = sandbox; ; dir = path.dirname(dir)) {
  if (existsSync(path.join(dir, '.git'))) refuse('the acceptance directory must not be inside a Git working tree (source checkouts are never touched)');
  if (path.dirname(dir) === dir) break;
}
if (existsSync(sandbox) && readdirSync(sandbox).length > 0) refuse('the acceptance directory must not exist or must be empty');
const preExisting = existsSync(sandbox);
mkdirSync(sandbox, { recursive: true });
writeFileSync(path.join(sandbox, MARKER), 'created by the QANDEEL COMPANY C3 acceptance harness; safe to delete\n');
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
const MEMORY_TEXT = 'Egypt payments: Cairo merchants settle mostly through Vodafone Cash wallets.';
const SCENARIO_TEXT = 'Scenario: advise an Egypt merchant on wallet payments versus Fawry kiosks.';

const world = {};
await step('production-c3-authority-closed', () => {
  const store = CompanyStore.open(company);
  try {
    check(store.schemaVersion === CURRENT_SCHEMA_VERSION && CURRENT_SCHEMA_VERSION >= 6, 'schema carries the C3 migrations');
    const f = 'principal:00000000-0000-4000-8000-000000000000';
    const closed = 'FOUNDER_SURFACE_UNAVAILABLE';
    check(refusedWith(() => MemoryStore.for(store).recordCanonicalTruth(f, { level: 'POLICY', topic: 'x', statement: 'x', dataClass: 'D1', sourceRef: 'policy:x' }), closed), 'canonical truth needs the authenticated Founder surface');
    check(refusedWith(() => MemoryStore.for(store).recordKnowledge(f, { scope: 'COMPANY', topic: 'x', content: 'x', dataClass: 'D1' }), closed), 'company knowledge needs the authenticated Founder surface');
    check(refusedWith(() => SkillStore.for(store).registerSkill(f, { code: 'x.y', name: 'x', skillType: 'EXTERNAL', ownerRef: 'department:x' }), closed), 'the skill registry needs the authenticated Founder surface');
    check(refusedWith(() => AcademyStore.for(store).createProgram(f, { code: 'program.x', roleRef: 'role:x' }), closed), 'the Academy needs the authenticated Founder surface');
  } finally {
    store.close();
  }
  for (const cmd of ['certify', 'activate', 'approve-activation', 'record-knowledge', 'correct-memory', 'approve-skill']) check(cliRun(cmd, '--workspace', company).status === 2, `the CLI has no ${cmd} command`);
  return { founderSurface: 'UNAVAILABLE_UNTIL_C5' };
});

await step('seed-company-skills-academy-via-test-seam', () => {
  armFounderTestSurface(company);
  const store = CompanyStore.open(company);
  try {
    const gov = GovernanceStore.for(store);
    const founder = gov.registerFounder().ref;
    gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: 20_000_000, capTokens: 20_000_000, currency: 'USD', reasonCode: 'acceptance' });
    const dept = gov.createDepartment(founder, { code: 'growth', name: 'Growth' });
    gov.createBudget(founder, { scope: 'DEPARTMENT', scopeId: dept.id, capMoney: 10_000_000, capTokens: 10_000_000, reasonCode: 'acceptance' });
    const p = gov.registerProvider(founder, { code: 'fake-local', locality: 'LOCAL' });
    const d = gov.registerDeployment(founder, { code: 'local-e1', modelId: gov.registerModel(founder, { providerId: p.id, code: 'fake-small' }).id, pinnedRevision: 'r1', reasoningClass: 'E1', contextWindowTokens: 100_000, maxOutputTokens: 2_048, taskClasses: ['draft.memo'] });
    gov.addPriceCard(founder, d.id, { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: 1_000_000, billedOutputPerMTok: 4_000_000, billedPerCall: 0, economicInputPerMTok: 1_000_000, economicOutputPerMTok: 4_000_000, economicPerCall: 0 });
    for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED']) gov.setQualification(founder, d.id, q, 'acceptance');
    gov.approveEgress(founder, d.id, 'D4', 'local.only');
    gov.createRoutePolicy(founder, 'draft.memo', { minClass: 'E1', maxClass: 'E2', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 8, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 100_000 } });
    const pub = gov.registerTool(founder, { code: 'publisher', driverCode: 'fake-publisher', egress: 'EXTERNAL', credentialRef: 'vault:publisher' });
    gov.registerToolAction(founder, { toolId: pub.id, code: 'publish', risk: 'R3', sideEffects: 'IDEMPOTENT', mutatesExternal: true, dataClassCeiling: 'D1', argsSchema: { fields: { text: { type: 'string', required: true, maxLength: 200 } } }, costPerCallMicros: 100 });
    // The trainee: onboarding → TRAINING → PROBATION. It is NEVER activated by the seam.
    const e = gov.createEmployee(founder, { name: { given: 'سلمى', family: 'المصري' }, profile: { personality: 'curious' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: 'role:growth-analyst', positionRef: 'position:growth-2', departmentId: dept.id, managerRef: founder });
    gov.transitionEmployee(founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    gov.createBudget(founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 5_000_000, capTokens: 5_000_000, reasonCode: 'acceptance' });
    gov.grant(founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'acceptance' });
    gov.grant(founder, { employeeId: e.id, capability: 'tool:publisher.publish', riskCeiling: 'R3', dataClassCeiling: 'D1', reasonCode: 'acceptance' });
    // A second, already-ACTIVE colleague (C2 seam) owns ordinary work for the capability-gap proof.
    const colleague = gov.createEmployee(founder, { name: { given: 'Omar', family: 'Farouk' }, profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: 'role:growth-analyst', positionRef: 'position:growth-3', departmentId: dept.id, managerRef: founder });
    gov.transitionEmployee(founder, colleague.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(founder, colleague.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, founder, colleague.id);
    gov.createBudget(founder, { scope: 'EMPLOYEE', scopeId: colleague.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'acceptance' });
    gov.grant(founder, { employeeId: colleague.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'acceptance' });

    const skills = SkillStore.for(store);
    const pipeline = (code, license, paid = false) => {
      const skill = skills.registerSkill(founder, { code, name: `Skill ${code}`, skillType: 'EXTERNAL', ownerRef: 'department:growth' });
      let v = skills.registerSkillVersion(founder, { skillId: skill.id, versionLabel: '1.0.0', sourceRef: `github:example.${code}`, sourceRevision: 'r1', authorRef: 'org:example', licenseSpdx: license, dependencies: paid ? [{ name: 'paid-api', kind: 'SERVICE', paid: true }] : [], instructions: `Guidance for ${code.replace(/[.-]/g, ' ')}: cite sources, separate facts from estimates.` });
      v = skills.inspectSkillVersion(v.id);
      v = skills.checkLicenseAndDependencies(v.id);
      if (v.pipelineState === 'REJECTED') return { skill, version: v };
      v = skills.advanceSkillVersion(founder, v.id, 'SECURITY_QUARANTINE', { reasonCode: 'quarantine' });
      v = skills.advanceSkillVersion(founder, v.id, 'SANDBOXED', { reasonCode: 'security.reviewed', evidenceRef: 'review:acceptance', securityPassed: true });
      v = skills.advanceSkillVersion(founder, v.id, 'BENCHMARKED', { reasonCode: 'benchmarked', evidenceRef: 'benchmark:acceptance' });
      v = skills.advanceSkillVersion(founder, v.id, 'COMPARED', { reasonCode: 'compared' });
      return { skill, version: v };
    };
    const unlicensed = pipeline('seo.audit', null);
    check(unlicensed.version.pipelineState === 'REJECTED' && unlicensed.version.failureReason === 'LICENSE_UNCLEAR', 'an unlicensed external skill never reaches production');
    const paid = pipeline('ads.optimizer', 'MIT', true);
    check(refusedWith(() => skills.advanceSkillVersion(founder, paid.version.id, 'APPROVED', { reasonCode: 'approve' }), 'VALIDATION_FAILED'), 'FREE_SKILL_PAID_DEPENDENCY needs an explicit acknowledgement');
    check(skills.eligibility(paid.version.id).costLabel === 'FREE_SKILL_PAID_DEPENDENCY', 'the paid dependency is visible');
    const research = pipeline('market.research', 'MIT');
    const approved = skills.advanceSkillVersion(founder, research.version.id, 'APPROVED', { reasonCode: 'approved' });
    check(skills.eligibility(approved.id).eligible, 'an approved, clearly licensed, security-cleared version is eligible');

    skills.publishBlueprint(founder, 'role:growth-analyst', [{ skillId: research.skill.id, category: 'REQUIRED', minProficiency: 'QUALIFIED', critical: true }]);
    const academy = AcademyStore.for(store);
    const program = academy.createProgram(founder, { code: 'program.growth-analyst', roleRef: 'role:growth-analyst' });
    const dims = [...ASSESSMENT_DIMENSIONS];
    const pv = academy.publishProgramVersion(founder, program.id, {
      curriculum: ['QANDEEL_FUNDAMENTALS', 'FOUNDER_UNDERSTANDING', 'ROLE_MASTERY', 'REAL_CASE_STUDIES', 'MARKET_INTELLIGENCE', 'COMPANY_OPERATING_SKILLS'].map((category, i) => ({ code: `module-${i}`, category, sourceRefs: ['authority:stage-6'] })),
      dimensions: dims.map((dimension) => ({ dimension, critical: DEFAULT_CRITICAL_DIMENSIONS.includes(dimension), passPct: 60 })),
      passAveragePct: 70,
      assessmentTrials: 1,
      holdoutRequired: true,
      maxRepeatedCriticalFailures: 2,
      certificationValidityDays: 365,
      probation: { minCases: 1, maxCriticalFailures: 0 },
      skillTargets: [{ skillId: research.skill.id, proficiency: 'QUALIFIED' }],
    });
    const sc = (code, kind) => academy.addScenario(founder, pv.id, { code, kind, content: `${SCENARIO_TEXT} (${code})`, sourceRef: 'authority:stage-6', budgetMicros: 1_000_000 }).id;
    Object.assign(world, { founder, trainee: e, colleague, departmentId: dept.id, skill: research.skill, version: approved, programVersionId: pv.id, dims, scenarios: { practice: sc('practice-1', 'PRACTICE'), holdout: sc('holdout-1', 'HOLDOUT') } });
    return { skills: { rejected: 'LICENSE_UNCLEAR', paidDependency: 'ACKNOWLEDGEMENT_REQUIRED', approved: 1 }, trainee: 'PROBATION' };
  } finally {
    store.close();
  }
});

const provider = new DeterministicFakeProvider('fake-local');
const publisher = new FakeToolDriver('fake-publisher');
const runtime = new CompanyRuntime({ workspace: company, processors: [employeeTaskProcessor], supervisorTtlMs: 2_000, governance: { providers: [provider], toolDrivers: [publisher] } });
const script = (...o) => JSON.stringify({ script: o });
const release = (workItemId, cap = 1_000_000) => {
  runtime.governance.createBudget(world.founder, { scope: 'WORK_ITEM', scopeId: workItemId, capMoney: cap, capTokens: 1_000_000, reasonCode: 'acceptance' });
  runtime.transitionWorkItem(workItemId, { to: 'READY', reasonCode: 'release' });
};
const until = async (fn, what, ms = 30_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(25);
  }
  throw new Error(`timed out: ${what}`);
};
const stateOf = (id) => runtime.view.getWorkItem(id).state;

try {
  await runtime.start();
  const { academy, memory, capability } = runtime.mind;
  await step('idle-zero-provider-calls-zero-assemblies', async () => {
    await sleep(400);
    check(provider.totalCalls === 0 && runtime.mindHealth().memory.contextManifests === 0, 'an idle runtime assembles nothing and calls no provider');
    return { providerCalls: 0, contextManifests: 0 };
  });
  await step('academy-path-in-constrained-mode', async () => {
    const e = academy.enroll(world.founder, world.trainee.id, world.programVersionId);
    for (let i = 0; i < 6; i++) academy.recordModuleCompletion(world.founder, e.id, `module-${i}`, `evidence:module-${i}`);
    check(academy.advance(e.id).stage === 'SIMULATION', 'curriculum and case studies gate the simulation');
    const runAttempt = async (scenarioId, kind) => {
      const started = academy.startAttempt(e.id, { scenarioId, kind, taskClass: 'draft.memo' });
      release(started.workItemId);
      await until(() => stateOf(started.workItemId) === 'COMPLETED', `${kind} attempt`);
      academy.evaluateDeterministic(started.attempt.id);
      return academy.recordEvaluation(world.founder, started.attempt.id, world.dims.filter((d) => !DETERMINISTIC_DIMENSIONS.includes(d)).map((dimension) => ({ dimension, scorePct: 88 })));
    };
    check((await runAttempt(world.scenarios.practice, 'SIMULATION')).outcome === 'PASS', 'the simulation passes');
    check(academy.advance(e.id).stage === 'ASSESSMENT', 'feedback → assessment');
    check(academy.exposures(world.trainee.id, world.scenarios.holdout) === 0, 'the holdout was never exposed during practice');
    check((await runAttempt(world.scenarios.holdout, 'ASSESSMENT')).outcome === 'PASS', 'the holdout assessment passes');
    check(academy.advance(e.id).stage === 'SHADOW_WORK', 'assessment → shadow work');
    const shadowWork = async (instructions) => {
      const { workItem } = runtime.submitWorkItem({ objective: 'shadow work', ownerRef: world.trainee.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 128, instructions } });
      academy.assignShadowWork(world.founder, e.id, workItem.id);
      release(workItem.id);
      await until(() => stateOf(workItem.id) === 'COMPLETED', 'shadow work');
      academy.collectShadowEvidence(e.id);
      for (const kind of ['QUALITY', 'DEMONSTRATED_LEARNING', 'COST_DISCIPLINE', 'CORRECT_ESCALATION', 'COLLABORATION']) academy.recordProbationEvidence(world.founder, e.id, { kind, workItemId: workItem.id, positive: true });
      return workItem.id;
    };
    // Shadow work that attempts an external action: refused (constrained authority) AND counted as a critical failure.
    await shadowWork(script({ type: 'TOOL_REQUEST', tool: 'publisher', action: 'publish', args: { text: 'shadow release' } }, { type: 'FINAL', summaryCode: 'shadow.done' }));
    check(publisher.invocations.length === 0, 'shadow work never acts externally (constrained authority)');
    check(academy.advance(e.id).stage === 'PROBATION_REVIEW', 'shadow cases → probation review');
    check(refusedWith(() => academy.decideProbationReview(world.founder, e.id, 'PASS'), 'VALIDATION_FAILED'), 'probation cannot pass over a critical failure');
    academy.decideProbationReview(world.founder, e.id, 'FAIL');
    const rem = academy.remediations(e.id).at(-1);
    check(rem?.probationReviewId && academy.enrollment(e.id).stage === 'RETRY', 'failure → diagnosis → retraining');
    academy.completeRetraining(world.founder, rem.id, 'evidence:retrained');
    check(academy.advance(e.id).stage === 'SHADOW_WORK' && academy.enrollment(e.id).evidenceEpoch === 2, 'new shadow work in a new evidence epoch');
    const shadow = { id: await shadowWork(script({ type: 'FINAL', summaryCode: 'shadow.done' })) };
    check(academy.advance(e.id).stage === 'PROBATION_REVIEW', 'clean shadow cases → probation review');
    academy.decideProbationReview(world.founder, e.id, 'PASS');
    check(academy.advance(e.id).stage === 'ACTIVATION_APPROVAL', 'certified → activation approval');
    const manifests = runtime.view.runsForWorkItem(shadow.id).flatMap((r) => memory.manifestsFor(r.id));
    check(manifests.length > 0 && manifests.every((m) => m.outcome === 'OK'), 'every trainee inference went through the governed assembler');
    world.enrollmentId = e.id;
    return { stage: 'ACTIVATION_APPROVAL', externalActions: 0, probation: 'FAIL_RETRAIN_PASS' };
  });
  await step('certification-necessary-not-sufficient', () => {
    const cert = academy.certifications(world.trainee.id)[0];
    check(cert?.status === 'VALID' && cert.skillPins[0]?.skillVersionId === world.version.id, 'the certification pins the exact skill version');
    check(runtime.governance.getEmployee(world.trainee.id).state === 'PROBATION', 'certified but not active');
    check(refusedWith(() => runtime.governance.transitionEmployee(world.founder, world.trainee.id, { to: 'ACTIVE', reasonCode: 'certified' }), 'EMPLOYEE_NOT_ELIGIBLE'), 'the generic transition cannot activate');
    check(refusedWith(() => runtime.governance.transitionEmployee(world.founder, world.trainee.id, { to: 'ACTIVE', reasonCode: 'certified', qualificationRefs: [`academy:${cert.id}`] }), 'VALIDATION_FAILED'), 'the generic transition cannot even carry an Academy reference');
    const req = academy.activationRequests(world.trainee.id)[0];
    check(req?.state === 'PENDING_APPROVAL', 'an activation request waits for real approval');
    disarmFounderTestSurface(company);
    try {
      check(refusedWith(() => academy.decideActivation(world.founder, req.id, { decision: 'APPROVE', reasonCode: 'x' }), 'FOUNDER_SURFACE_UNAVAILABLE'), 'production cannot approve activation without the authenticated Founder surface');
    } finally {
      armFounderTestSurface(company);
    }
    check(runtime.governance.getEmployee(world.trainee.id).state === 'PROBATION', 'still not active');
    world.activationRequestId = req.id;
    world.certificationId = cert.id;
    return { certification: 'VALID', activation: 'FAIL_CLOSED_IN_PRODUCTION' };
  });
  await step('activation-through-founder-approval-rechecks-evidence', () => {
    academy.decideActivation(world.founder, world.activationRequestId, { decision: 'APPROVE', reasonCode: 'founder.approved' });
    const e = runtime.governance.getEmployee(world.trainee.id);
    check(e.state === 'ACTIVE' && e.qualificationRefs.includes(`academy:${world.certificationId}`) && !e.qualificationRefs.some((r) => r.startsWith('test-seam:')), 'activated by certification + probation + activation approval, not by the seam');
    check(academy.activationRequests(world.trainee.id)[0]?.state === 'CONSUMED', 'the request is consumed once');
    return { state: 'ACTIVE' };
  });
  await step('governed-memory-proposal-and-recall', async () => {
    const submit = (instructions) => {
      const { workItem } = runtime.submitWorkItem({ objective: 'governed memo', ownerRef: world.trainee.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 128, instructions } });
      release(workItem.id);
      return workItem.id;
    };
    const a = submit(script({ type: 'MEMORY_CANDIDATE', memoryClass: 'EXPERIENCE', topic: 'egypt.payments', claimKey: null, claimValue: null, content: MEMORY_TEXT, confidencePct: 95 }, { type: 'FINAL', summaryCode: 'egypt.payments.noted' }));
    await until(() => stateOf(a) === 'COMPLETED', 'memory task');
    const mem = memory.memories(world.trainee.id);
    check(mem.length === 1 && mem[0].confidencePct === 70 && mem[0].provenanceRef.startsWith('run:'), 'the policy stored a capped, attributed memory');
    const runA = runtime.view.runsForWorkItem(a)[0].id;
    const reservations = runtime.governance.reservations(runA).filter((r) => r.purpose === 'MODEL_CALL');
    const manifests = memory.manifestsFor(runA);
    check(reservations.length === manifests.length && reservations.every((r) => manifests.some((m) => m.id === r.contextManifestId)), 'every model reservation is bound to its manifest');
    const b = submit(script({ type: 'FINAL', summaryCode: 'egypt.payments.market.research' }));
    await until(() => stateOf(b) === 'COMPLETED', 'recall task');
    const m2 = memory.manifestsFor(runtime.view.runsForWorkItem(b)[0].id)[0];
    check(memory.manifestEntries(m2.id).some((x) => x.itemId === mem[0].id && x.decision === 'SELECTED'), 'the memory is recalled through the assembler in a later run');
    check(memory.manifestEntries(m2.id).some((x) => x.itemId === world.version.id && x.decision === 'SELECTED'), 'the certified, pinned skill version is loaded progressively');
    world.manifestId = m2.id;
    return { memories: 1, manifests: manifests.length + 1 };
  });
  await step('capability-gap-durable-no-rerouting', async () => {
    const before = provider.totalCalls;
    const { workItem } = runtime.submitWorkItem({ objective: 'research task', ownerRef: world.colleague.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 128, instructions: script({ type: 'FINAL', summaryCode: 'researched' }) } });
    capability.declareRequirements(workItem.id, { requirements: [{ kind: 'SKILL', skillId: world.skill.id, minProficiency: 'QUALIFIED' }, { kind: 'CERTIFICATION', roleRef: 'role:growth-analyst' }] });
    release(workItem.id);
    await until(() => stateOf(workItem.id) === 'WAITING', 'gap parks the work');
    const gap = capability.gapFor(workItem.id);
    check(gap?.state === 'OPEN' && gap.employeeId === world.colleague.id, 'the gap is durable and belongs to the owner (never re-routed)');
    check(runtime.view.jobsFor(workItem.id)[0]?.waitReason === 'CAPABILITY_GAP' && provider.totalCalls === before, 'no model call on a capability gap');
    return { missing: gap.missing.map((m) => m.code).join(',') };
  });
  await step('health-and-cli-content-free', () => {
    const h = runtimeHealth(runtime);
    const json = JSON.stringify(h);
    check(h.readiness.ready && h.components.mind !== null, 'C3 health present');
    check(h.reasons.includes('CAPABILITY_GAPS_OPEN'), 'the open gap is visible');
    check(!json.includes('Vodafone') && !json.includes('Fawry'), 'health is content-free');
    const mind = cliRun('mind', '--workspace', company);
    const man = cliRun('context-manifest', '--workspace', company, '--manifest', world.manifestId);
    const gaps = cliRun('capability-gaps', '--workspace', company);
    check(mind.status === 0 && man.status === 0 && gaps.status === 0, 'read-only CLI commands');
    check(![mind.stdout, man.stdout, gaps.stdout].some((o) => o.includes('Vodafone') || o.includes('Fawry') || o.includes('Guidance for')), 'CLI output is content-free');
    check(JSON.parse(gaps.stdout).open.length === 1, 'CLI lists the open gap');
    check(runtime.governance.accountingInvariants().length === 0, 'accounting invariants hold');
    return { status: h.status, reasons: h.reasons.join(',') };
  });
} finally {
  await runtime.stop().catch(() => undefined);
}

const verdict = failed ? 'C3 LOCAL ACCEPTANCE — FAIL' : 'C3 LOCAL ACCEPTANCE — PASS';
console.log(JSON.stringify({ verdict, steps: results.length, node: process.versions.node, platform: process.platform, sandbox: values.keep ? sandbox : '(removed)' }));
if (!values.keep && existsSync(path.join(sandbox, MARKER))) {
  if (preExisting) for (const entry of [MARKER, 'company']) rmSync(path.join(sandbox, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  else rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
process.exit(failed ? 1 : 0);
