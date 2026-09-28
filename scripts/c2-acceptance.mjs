#!/usr/bin/env node
// C2 local acceptance harness — for the Founder-host review (and CI), runnable without editing source.
//
//   npm run c2:acceptance -- --workspace <disposable directory> [--keep]
//
// The directory must not exist yet, or be empty. The harness writes an ownership marker, creates a
// Company workspace in <dir>/company and proves:
//
// - production fail-closed first (D-C2-13): with no Founder surface armed, Founder authority cannot
//   be created or exercised by presenting a reference, and the CLI has no Founder write command;
// - then, through the TEST-ONLY Founder seam (loaded only under --conditions=qandeel-test, never a
//   product path): department, an Employee reaching ACTIVE through the seam (C2 has no Academy and
//   fakes no certification), a provider-neutral catalog (deterministic fake provider — no
//   commercial provider, no network, no credential), D3 external egress refused, Router Policy,
//   Tool Registry, explicit grants, hierarchical budgets, a governed run with a permitted R1 tool,
//   an R3 tool failing closed before its independent review (C4: no approval before review; the CLI
//   cannot approve; the review → approval → execute-once path is the C4 acceptance's), a hard budget
//   refusal before any provider call, D4 staying local, accounting invariants, health and the
//   read-only CLI.
//
// At the end it deletes only what it created unless --keep is given.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const MARKER = '.qandeel-c2-acceptance';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'packages/runtime/dist/src/cli.js');

const { values } = parseArgs({ strict: true, options: { workspace: { type: 'string' }, keep: { type: 'boolean', default: false } } });
const { CompanyRuntime, DeterministicFakeProvider, FakeToolDriver, employeeTaskProcessor, runtimeHealth } = await import('@qandeel-company/runtime');
const { CompanyStore, GovernanceStore, CURRENT_SCHEMA_VERSION } = await import('@qandeel-company/storage');
// Test-only seam: resolvable only because this harness runs with --conditions=qandeel-test.
const { activateEmployeeForTest, armFounderTestSurface } = await import('@qandeel-company/storage/testing');

function refuse(message) {
  console.error(JSON.stringify({ ok: false, verdict: 'REFUSED', message }));
  process.exit(2);
}
if (!values.workspace) refuse('usage: npm run c2:acceptance -- --workspace <new or empty directory> [--keep]');
const sandbox = path.resolve(values.workspace);
for (let dir = sandbox; ; dir = path.dirname(dir)) {
  if (existsSync(path.join(dir, '.git'))) refuse('the acceptance directory must not be inside a Git working tree (source checkouts are never touched)');
  if (path.dirname(dir) === dir) break;
}
if (existsSync(sandbox) && readdirSync(sandbox).length > 0) refuse('the acceptance directory must not exist or must be empty');
const preExisting = existsSync(sandbox);
mkdirSync(sandbox, { recursive: true });
writeFileSync(path.join(sandbox, MARKER), 'created by the QANDEEL COMPANY C2 acceptance harness; safe to delete\n');
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
    console.log(JSON.stringify({ step: name, result: 'FAIL', ms: Date.now() - started, code: error?.code ?? 'ERROR', message: String(error?.message ?? error).slice(0, 200) }));
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

const world = {};
await step('production-founder-surface-closed', () => {
  const store = CompanyStore.open(company);
  try {
    check(store.schemaVersion === CURRENT_SCHEMA_VERSION, 'schema is current');
    check(refusedWith(() => GovernanceStore.for(store).registerFounder(), 'FOUNDER_SURFACE_UNAVAILABLE'), 'Founder authority cannot be created without the authenticated surface');
  } finally {
    store.close();
  }
  for (const cmd of ['register-founder', 'approve', 'reject']) check(cliRun(cmd, '--workspace', company).status === 2, `the CLI has no ${cmd} command`);
  return { founderSurface: 'UNAVAILABLE_UNTIL_C5' };
});

await step('seed-governance-via-test-seam', () => {
  armFounderTestSurface(company);
  const store = CompanyStore.open(company);
  try {
    const gov = GovernanceStore.for(store);
    const founder = gov.registerFounder().ref;
    gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: 10_000_000, capTokens: 10_000_000, currency: 'USD', reasonCode: 'acceptance' });
    // C4: the canonical Departments are release-seeded (D-C4-02); fixtures adopt them by code.
    const dept = gov.departmentByCode('growth');
    gov.createBudget(founder, { scope: 'DEPARTMENT', scopeId: dept.id, capMoney: 5_000_000, capTokens: 5_000_000, reasonCode: 'acceptance' });
    const e = gov.createEmployee(founder, { name: { given: 'نور', family: 'الشريف' }, profile: { personality: 'analytical' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: 'role:growth-analyst', positionRef: 'position:growth-1', departmentId: dept.id, managerRef: founder });
    gov.transitionEmployee(founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    check(refusedWith(() => gov.transitionEmployee(founder, e.id, { to: 'ACTIVE', reasonCode: 'qualified', qualificationRefs: ['founder-attestation:acceptance'] }), 'EMPLOYEE_NOT_ELIGIBLE'), 'activation fails closed until the C3 Academy');
    activateEmployeeForTest(gov, founder, e.id);
    gov.createBudget(founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'acceptance' });
    const p = gov.registerProvider(founder, { code: 'fake-local', locality: 'LOCAL' });
    const m = gov.registerModel(founder, { providerId: p.id, code: 'fake-small' });
    const d = gov.registerDeployment(founder, { code: 'local-e1', modelId: m.id, pinnedRevision: 'r1', reasoningClass: 'E1', contextWindowTokens: 100_000, maxOutputTokens: 2_048, taskClasses: ['draft.memo'] });
    gov.addPriceCard(founder, d.id, { currency: 'USD', billingMode: 'SUBSCRIPTION', billedInputPerMTok: 0, billedOutputPerMTok: 0, billedPerCall: 0, economicInputPerMTok: 1_000_000, economicOutputPerMTok: 4_000_000, economicPerCall: 0 });
    for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED']) gov.setQualification(founder, d.id, q, 'acceptance');
    gov.approveEgress(founder, d.id, 'D4', 'local.only');
    gov.createRoutePolicy(founder, 'draft.memo', { minClass: 'E1', maxClass: 'E2', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 8, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 100_000 } });
    const notes = gov.registerTool(founder, { code: 'notes', driverCode: 'fake-notes', egress: 'NONE' });
    const pub = gov.registerTool(founder, { code: 'publisher', driverCode: 'fake-publisher', egress: 'EXTERNAL', credentialRef: 'vault:publisher' });
    const text = { fields: { text: { type: 'string', required: true, maxLength: 200 } } };
    gov.registerToolAction(founder, { toolId: notes.id, code: 'append', risk: 'R1', sideEffects: 'NONE', mutatesExternal: false, dataClassCeiling: 'D3', argsSchema: text, costPerCallMicros: 10 });
    gov.registerToolAction(founder, { toolId: pub.id, code: 'publish', risk: 'R3', sideEffects: 'IDEMPOTENT', mutatesExternal: true, dataClassCeiling: 'D1', argsSchema: text, costPerCallMicros: 100 });
    gov.grant(founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'acceptance' });
    gov.grant(founder, { employeeId: e.id, capability: 'tool:notes.append', riskCeiling: 'R1', dataClassCeiling: 'D3', reasonCode: 'acceptance' });
    gov.grant(founder, { employeeId: e.id, capability: 'tool:publisher.publish', riskCeiling: 'R3', dataClassCeiling: 'D1', reasonCode: 'acceptance' });
    Object.assign(world, { founder, employee: gov.getEmployee(e.id) });
    check(gov.employeeHistory(e.id).length === 4, 'employee history recorded');
    // D3 external egress stays closed even for a qualified external deployment (no egress profile).
    const cp = gov.registerProvider(founder, { code: 'fake-cloud', locality: 'EXTERNAL', credentialRef: 'vault:fake-cloud' });
    const cd = gov.registerDeployment(founder, { code: 'cloud-e1', modelId: gov.registerModel(founder, { providerId: cp.id, code: 'fake-hosted' }).id, pinnedRevision: 'r1', reasoningClass: 'E1', contextWindowTokens: 100_000, maxOutputTokens: 2_048, taskClasses: ['draft.memo'] });
    for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED']) gov.setQualification(founder, cd.id, q, 'acceptance');
    check(refusedWith(() => gov.approveEgress(founder, cd.id, 'D3', 'egress.approved'), 'EGRESS_DENIED'), 'D3 external egress refused');
    return { employeeState: 'ACTIVE', activation: 'TEST_SEAM', d3ExternalEgress: 'REFUSED', schemaVersion: store.schemaVersion };
  } finally {
    store.close();
  }
});

const provider = new DeterministicFakeProvider('fake-local');
const drivers = { notes: new FakeToolDriver('fake-notes'), publisher: new FakeToolDriver('fake-publisher') };
const runtime = new CompanyRuntime({ workspace: company, processors: [employeeTaskProcessor], supervisorTtlMs: 2_000, governance: { providers: [provider], toolDrivers: Object.values(drivers) } });
const script = (...o) => JSON.stringify({ script: o });
const submit = (input, cap = 100_000) => {
  const { workItem } = runtime.submitWorkItem({ objective: 'acceptance governed task', ownerRef: world.employee.ref, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 128, ...input } });
  runtime.governance.createBudget(world.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: cap, capTokens: 100_000, reasonCode: 'acceptance' });
  runtime.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  return workItem.id;
};
const until = async (fn, what, ms = 20_000) => {
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
  await step('idle-zero-provider-calls', async () => {
    await sleep(500);
    check(provider.totalCalls === 0 && runtime.governanceDiagnostics().providerCalls === 0, 'idle runtime made provider calls');
    return { providerCalls: 0 };
  });
  await step('governed-run-r1-tool', async () => {
    const id = submit({ dataClass: 'D3', instructions: script({ type: 'TOOL_REQUEST', tool: 'notes', action: 'append', args: { text: 'restricted note' } }, { type: 'FINAL', summaryCode: 'noted' }) });
    await until(() => stateOf(id) === 'COMPLETED', 'R1 task');
    check(drivers.notes.invocations.length === 1, 'R1 driver executed once');
    const usage = runtime.governance.usage({ workItemId: id });
    check(usage.length === 3 && usage.every((u) => u.employeeId === world.employee.id), 'attributed usage');
    check(usage.filter((u) => u.purpose === 'MODEL_CALL').every((u) => u.billedMicros === 0 && u.economicMicros > 0 && u.chargedTokens > 0), 'subscription usage is not unlimited');
    return { modelCalls: usage.filter((u) => u.purpose === 'MODEL_CALL').length, toolCalls: 1 };
  });
  await step('d4-context-never-leaves-its-ceiling', async () => {
    const before = drivers.notes.invocations.length;
    const id = submit({ dataClass: 'D4', instructions: script({ type: 'TOOL_REQUEST', tool: 'notes', action: 'append', args: { text: 'sovereign' } }, { type: 'FINAL', summaryCode: 'kept.local' }) });
    await until(() => stateOf(id) === 'COMPLETED', 'D4 task');
    check(drivers.notes.invocations.length === before, 'a D4 context never reaches a D3-ceiling tool');
    const run = runtime.view.runsForWorkItem(id)[0];
    check(runtime.view.audit(run.id).some((a) => a.action === 'authority.denied' && a.reasonCode === 'EGRESS_DENIED'), 'egress denial audited');
    return { denied: 'EGRESS_DENIED' };
  });
  // C4 (Stage 3 §4, D-C4-05): R3 = independent review AND Founder approval. This C2 world has no
  // Academy-certified reviewer, so R3 must fail closed BEFORE any approval exists; the full path
  // (reviewer run → approval → executed exactly once) is proven by the C4 acceptance and runtime tests.
  await step('r3-tool-fails-closed-before-review-cli-cannot-approve', async () => {
    const id = submit({ dataClass: 'D1', instructions: script({ type: 'TOOL_REQUEST', tool: 'publisher', action: 'publish', args: { text: 'release notes' } }, { type: 'FINAL', summaryCode: 'published' }) });
    await until(() => stateOf(id) === 'WAITING', 'R3 parks');
    const waitReason = runtime.view.jobsFor(id).at(-1)?.waitReason;
    check(waitReason === 'AWAITING_INDEPENDENT_REVIEW', `R3 waits for independent review first (got ${waitReason})`);
    check(drivers.publisher.invocations.length === 0, 'R3 driver must not run before review and approval');
    const cli = spawnSync(process.execPath, [CLI, 'approvals', '--workspace', company], { encoding: 'utf8', shell: false, windowsHide: true });
    check(cli.status === 0 && JSON.parse(cli.stdout).pending.length === 0, 'no approval is requested before the independent review');
    check(cliRun('approve', '--workspace', company, '--actor', world.founder).status !== 0 && stateOf(id) === 'WAITING', 'the CLI cannot approve with a Founder ref');
    await sleep(300);
    check(stateOf(id) === 'WAITING' && drivers.publisher.invocations.length === 0, 'still parked, never executed');
    return { waitReason };
  });
  await step('budget-hard-refusal', async () => {
    const before = provider.totalCalls;
    const id = submit({ instructions: script({ type: 'FINAL', summaryCode: 'x' }) }, 5);
    await until(() => stateOf(id) === 'WAITING', 'budget refusal parks');
    check(runtime.view.jobsFor(id)[0]?.waitReason === 'BUDGET_EXHAUSTED', 'wait reason');
    check(provider.totalCalls === before, 'no provider call beyond the cap');
    return { waitReason: 'BUDGET_EXHAUSTED' };
  });
  await step('accounting-and-health', () => {
    const violations = runtime.governance.accountingInvariants();
    check(violations.length === 0, violations.join('; '));
    const h = runtimeHealth(runtime);
    check(h.readiness.ready && h.components.governance?.executableEmployees === 1, 'governance health');
    const cli = spawnSync(process.execPath, [CLI, 'governance', '--workspace', company], { encoding: 'utf8', shell: false, windowsHide: true });
    check(cli.status === 0 && JSON.parse(cli.stdout).ok === true, 'CLI governance');
    return { status: h.status, reasons: h.reasons.join(',') };
  });
} finally {
  await runtime.stop().catch(() => undefined);
}

const verdict = failed ? 'C2 LOCAL ACCEPTANCE — FAIL' : 'C2 LOCAL ACCEPTANCE — PASS';
console.log(JSON.stringify({ verdict, steps: results.length, node: process.versions.node, platform: process.platform, sandbox: values.keep ? sandbox : '(removed)' }));
if (!values.keep && existsSync(path.join(sandbox, MARKER))) {
  if (preExisting) for (const entry of [MARKER, 'company']) rmSync(path.join(sandbox, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  else rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
process.exit(failed ? 1 : 0);
