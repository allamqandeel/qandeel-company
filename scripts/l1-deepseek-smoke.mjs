#!/usr/bin/env node
// L1-01 live smoke on the Founder Windows host — the governed Model Runtime thinking through DeepSeek V4.1 Flash.
//
//   npm run l1:smoke -- --workspace <new or empty directory> [--keep] [--probe] [--message "<Founder message>"]
//                        [--cap-micros 2000000] [--reply-cap-micros 500000]
//
// This is the "Company, not curl" proof (task §15, §16). It is NOT a CI test: it needs the real key the Founder stored
// with `qandeel-vault set deepseek-company` (the key is never read, printed or passed here), a network and a tiny spend
// bounded by the caps printed before any live call. In a disposable workspace it:
//
//   1. refuses to run without the vault entry (and prints the exact secure command to create it);
//   2. seeds identities through the TEST-ONLY Founder seam (`--conditions=qandeel-test`), as every acceptance does:
//      the Founder principal, the canonical Growth Department budget, one Employee hired and seam-activated into the
//      release-seeded CEO seat with a bounded envelope and a `model.invoke` grant (production activation is the
//      Academy's; the seam stands in for it here and nowhere else);
//   3. runs the content-free identity check of the `deepseek-flash` alias and records it (alias drift fails closed);
//   4. provisions the release-pinned DeepSeek V4.1 Flash profile through the canonical catalog APIs (provider → model →
//      E1–E4 deployments → versioned pricing basis → LIMITED_PRODUCTION → D2 egress → pilot route policies) and the
//      first bounded Company cap;
//   5. optionally (`--probe`) one tiny bounded connectivity call through the adapter (metering only);
//   6. starts the REAL runtime with the REAL adapter (Windows vault + HTTPS transport) and sends the Founder's message
//      into the canonical Founder ↔ CEO thread (the same store call the authenticated surface makes), then waits for
//      the CEO's governed run: C3 Context Assembly → model.invoke authorization → Router Policy → worst-case reservation
//      → GovernedModelRuntime → DeepSeek → usage settlement → MESSAGE proposal → the thread;
//   7. prints content-free proof (usage, bands, bills, reservations, holds, invariants) and verifies that neither the
//      key nor any thinking text is in the database or the logs; the CEO's reply is shown to the Founder because it is
//      the Founder's own conversation (it is never logged).
//
// No direct chat → provider bypass exists in this script: the only adapter calls outside the runtime are the identity
// check and the optional probe, both metering-only.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const MARKER = '.qandeel-l1-smoke';
const { values } = parseArgs({
  strict: true,
  options: {
    workspace: { type: 'string' },
    keep: { type: 'boolean', default: false },
    probe: { type: 'boolean', default: false },
    message: { type: 'string' },
    'cap-micros': { type: 'string', default: '2000000' },
    'reply-cap-micros': { type: 'string', default: '500000' },
  },
});

function refuse(code, message) {
  console.error(JSON.stringify({ ok: false, verdict: 'REFUSED', code, message }));
  process.exit(2);
}
const log = (step, fields) => console.log(JSON.stringify({ step, ...fields }));

if (!values.workspace) refuse('USAGE', 'npm run l1:smoke -- --workspace <new or empty directory> [--keep] [--probe] [--message "<text>"]');
if (process.platform !== 'win32') refuse('VAULT_UNAVAILABLE', 'the live smoke runs on the Founder Windows host (DPAPI vault)');
const capMicros = Number(values['cap-micros']);
const replyCapMicros = Number(values['reply-cap-micros']);
if (!Number.isSafeInteger(capMicros) || capMicros <= 0 || capMicros > 20_000_000) refuse('USAGE', '--cap-micros is a bounded positive amount (micro-USD; at most 20 000 000 = $20)');
if (!Number.isSafeInteger(replyCapMicros) || replyCapMicros <= 0 || replyCapMicros > capMicros) refuse('USAGE', '--reply-cap-micros must be positive and within the Company cap');

const { WindowsUserVault } = await import('@qandeel-company/secret-vault');
const { DEEPSEEK_V41_FLASH_PROFILE, DEEPSEEK_CREDENTIAL_REF, DeepSeekHttpsTransport, DeepSeekProviderAdapter } = await import('@qandeel-company/model-providers');
const { worstCase } = await import('@qandeel-company/governance');
const { CompanyRuntime, Logger, employeeTaskProcessor, runtimeHealth } = await import('@qandeel-company/runtime');
const { CompanyStore, GovernanceStore, OrganizationStore } = await import('@qandeel-company/storage');
// Test-only seam: resolvable only because this harness runs with --conditions=qandeel-test.
const { activateEmployeeForTest, armFounderTestSurface } = await import('@qandeel-company/storage/testing');

const vault = new WindowsUserVault();
if (!(await vault.has(DEEPSEEK_CREDENTIAL_REF))) {
  refuse('CREDENTIAL_UNAVAILABLE', `no secret is stored for ${DEEPSEEK_CREDENTIAL_REF}. Store it with the hidden prompt (never as an argument): node packages/secret-vault/dist/src/cli.js set deepseek-company`);
}

const sandbox = path.resolve(values.workspace);
for (let dir = sandbox; ; dir = path.dirname(dir)) {
  if (existsSync(path.join(dir, '.git'))) refuse('USAGE', 'the smoke directory must not be inside a Git working tree');
  if (path.dirname(dir) === dir) break;
}
if (existsSync(sandbox) && readdirSync(sandbox).length > 0) refuse('USAGE', 'the smoke directory must not exist or must be empty');
const preExisting = existsSync(sandbox);
mkdirSync(sandbox, { recursive: true });
writeFileSync(path.join(sandbox, MARKER), 'created by the QANDEEL COMPANY L1-01 live smoke; safe to delete\n');
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
    log(name, { result: 'PASS', ms: Date.now() - started, ...detail });
  } catch (error) {
    failed = true;
    results.push({ step: name, result: 'FAIL' });
    log(name, { result: 'FAIL', ms: Date.now() - started, code: error?.code ?? 'ERROR', message: String(error?.message ?? error).slice(0, 200) });
    throw error;
  }
}
const message = values.message ?? 'أنا محمد، Founder لـQANDEEL. قبل ما نبدأ الشغل عايزك تتعرف على المشروع وتسألني الأسئلة اللي محتاجها علشان تفهم إحنا بنبني إيه وإزاي نستعد للإطلاق.';

const adapter = new DeepSeekProviderAdapter({ vault, transport: new DeepSeekHttpsTransport() });
const world = {};
let runtime = null;
const logs = [];

try {
  await step('seed-identities-via-test-seam', () => {
    armFounderTestSurface(company);
    const store = CompanyStore.open(company);
    try {
      const gov = GovernanceStore.for(store);
      const org = OrganizationStore.for(store);
      const founder = gov.registerFounder().ref;
      const seat = org.positionByCode('company.ceo');
      check(seat, 'the CEO seat is release-seeded');
      const dept = gov.departmentByCode('growth');
      check(dept, 'the canonical Growth Department is release-seeded');
      const ceo = gov.createEmployee(founder, { name: { given: 'إيهاب', family: 'طارق' }, profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: seat.roleRef, positionRef: 'position:p1', departmentId: dept.id, managerRef: founder });
      gov.transitionEmployee(founder, ceo.id, { to: 'TRAINING', reasonCode: 'onboarding' });
      gov.transitionEmployee(founder, ceo.id, { to: 'PROBATION', reasonCode: 'trained' });
      activateEmployeeForTest(gov, founder, ceo.id);
      org.assignPrimary(founder, { positionId: seat.id, employeeId: ceo.id, reasonCode: 'placed' });
      Object.assign(world, { founder, ceoId: ceo.id, ceoRef: gov.getEmployee(ceo.id).ref, deptId: dept.id });
      return { founderPrincipal: 'SEAM', ceoActivation: 'TEST_SEAM (production activation is the Academy\'s; recorded as the next L1 seam)', schemaVersion: store.schemaVersion };
    } finally {
      store.close();
    }
  });

  await step('identity-check-alias', async () => {
    const check0 = await adapter.checkIdentity();
    const store = CompanyStore.open(company);
    try {
      const rec = GovernanceStore.for(store).recordModelIdentityCheck({ providerCode: DEEPSEEK_V41_FLASH_PROFILE.provider.code, modelCode: DEEPSEEK_V41_FLASH_PROFILE.model.code, expectedName: DEEPSEEK_V41_FLASH_PROFILE.model.expectedPublicName, observedName: check0.observedName, observedContextWindow: check0.observedContextWindow, observedMaxOutputTokens: check0.observedMaxOutputTokens, result: check0.result });
      check(check0.result === 'MATCH', `identity check: ${check0.result} (observed ${check0.observedName ?? 'nothing'}) — classify: ${({ AUTH: 'AUTH', CREDENTIAL_UNAVAILABLE: 'AUTH', BILLING: 'BILLING', RATE_LIMITED: 'RATE_LIMITED', UNREACHABLE: 'NETWORK', PROVIDER_ERROR: 'PROVIDER', CONTRACT_VIOLATION: 'PROVIDER', DRIFT: 'PROVIDER (alias drift — requalification required)', MODEL_MISSING: 'PROVIDER (alias missing)' })[check0.result] ?? 'COMPANY INTEGRATION'}`);
      return { result: check0.result, observedName: check0.observedName, contextWindow: check0.observedContextWindow, maxOutputTokens: check0.observedMaxOutputTokens, checkId: rec.id };
    } finally {
      store.close();
    }
  });

  await step('provision-profile-canonical-apis', () => {
    const store = CompanyStore.open(company);
    try {
      const gov = GovernanceStore.for(store);
      const out = gov.provisionProviderProfile(world.founder, DEEPSEEK_V41_FLASH_PROFILE, { capMoney: capMicros, capTokens: 4_000_000, reasonCode: 'l1.pilot' });
      gov.createBudget(world.founder, { scope: 'DEPARTMENT', scopeId: world.deptId, capMoney: capMicros, capTokens: 4_000_000, reasonCode: 'l1.pilot' });
      gov.createBudget(world.founder, { scope: 'EMPLOYEE', scopeId: world.ceoId, capMoney: Math.min(capMicros, 1_000_000), capTokens: 2_000_000, reasonCode: 'l1.pilot' });
      gov.grant(world.founder, { employeeId: world.ceoId, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D2', reasonCode: 'l1.pilot' });
      const card = gov.priceCard(out.priceCardIds[0]);
      Object.assign(world, { deployments: out.deploymentIds.map((id) => gov.deployment(id)), providerId: out.providerId });
      return {
        provider: 'deepseek',
        deployments: world.deployments.map((d) => `${d.code} ${d.reasoningClass} ${d.qualification} egress ${d.egressMaxDataClass} ctx ${d.contextWindowTokens} out ${d.maxOutputTokens}`),
        pricingBasis: { source: card.schedule?.basisSource, date: card.schedule?.basisDate, peakInputPerMTok: card.billedInputPerMTok, peakCachedInputPerMTok: card.billedCachedInputPerMTok, peakOutputPerMTok: card.billedOutputPerMTok, offPeakInputPerMTok: card.schedule?.offPeakInputPerMTok, offPeakOutputPerMTok: card.schedule?.offPeakOutputPerMTok, currency: card.currency },
        caps: { companyMicros: capMicros, departmentMicros: capMicros, ceoMicros: Math.min(capMicros, 1_000_000), replyMicros: replyCapMicros, note: 'hard caps; no automatic top-up' },
      };
    } finally {
      store.close();
    }
  });

  if (values.probe) {
    await step('connectivity-probe', async () => {
      const probe = await adapter.probe();
      const card = { id: 'profile', version: 0, ...DEEPSEEK_V41_FLASH_PROFILE.priceCard };
      return { usage: probe.usage, outputChars: probe.outputChars, peakWorstCaseMicros: worstCase(card, 64, 32).billedMicros, note: 'metering only' };
    });
  }

  await step('governed-runtime-founder-ceo', async () => {
    runtime = new CompanyRuntime({ workspace: company, processors: [employeeTaskProcessor], supervisorTtlMs: 5_000, governance: { providers: [adapter], provisioningProfiles: [DEEPSEEK_V41_FLASH_PROFILE], modelCallTimeoutMs: 180_000 }, logger: new Logger((r) => logs.push(r)) });
    await runtime.start();
    check(runtime.governanceDiagnostics().providerCalls === 0, 'idle runtime made no call');
    const comm = runtime.founder.communications;
    const thread = comm.directThread(world.founder, null);
    check(thread.employeeId === world.ceoId, 'the Founder ↔ CEO thread binds the seated CEO');
    log('pre-call-budget', { replyCapMicros, replyCapTokens: 200_000, companyCapMicros: capMicros, visibleBeforeLiveCall: true });
    const sent = comm.send(world.founder, thread.id, { purpose: 'REQUEST', body: message, replyCap: { money: replyCapMicros, tokens: 200_000 } });
    check(sent.replyWorkItemId, 'a reply Work Item was created from the Founder message');
    const deadline = Date.now() + 240_000;
    let state = 'PROPOSED';
    while (Date.now() < deadline) {
      state = runtime.view.getWorkItem(sent.replyWorkItemId).state;
      if (['COMPLETED', 'FAILED', 'BLOCKED', 'WAITING'].includes(state) && (state !== 'WAITING' || runtime.view.jobsFor(sent.replyWorkItemId).at(-1)?.waitReason)) break;
      await sleep(250);
    }
    const gov = runtime.governance;
    const usage = gov.usage({ workItemId: sent.replyWorkItemId });
    const runs = runtime.view.runsForWorkItem(sent.replyWorkItemId);
    const reservations = runs.flatMap((r) => gov.reservations(r.id));
    const reply = comm.messages(thread.id).find((m) => m.senderKind === 'EMPLOYEE');
    const deployments = world.deployments.map((d) => gov.deployment(d.id));
    const provider = gov.provider(world.providerId);
    const detail = {
      workItemState: state,
      waitReason: runtime.view.jobsFor(sent.replyWorkItemId).at(-1)?.waitReason ?? null,
      runs: runs.map((r) => ({ id: r.id, state: r.state, attempt: r.attempt, failureCode: r.failureCode ?? null })),
      usage: usage.map((u) => ({ deployment: deployments.find((d) => d.id === u.deploymentId)?.code ?? u.deploymentId, attempt: u.attemptKind, inputTokens: u.inputTokens, cachedInputTokens: u.cachedInputTokens, outputTokens: u.outputTokens, band: u.billingBand, billedMicros: u.billedMicros, economicMicros: u.economicMicros, outcome: u.outcome, withinBounds: u.withinBounds })),
      reservations: reservations.map((r) => ({ attempt: r.attemptKind, state: r.state, reservedMicros: r.money, reservedTokens: r.tokens, reason: r.reasonCode })),
      providerStatus: provider.status,
      deploymentStatus: deployments.map((d) => `${d.code}:${d.status}${d.holdReason ? `(${d.holdReason})` : ''}`),
      accountingInvariants: gov.accountingInvariants(),
      companyBudget: (() => { const b = gov.budgetFor('COMPANY', 'company'); return { capMicros: b.capMoney, spentMicros: b.spentMoney, reservedMicros: b.reservedMoney }; })(),
      health: runtimeHealth(runtime).status,
      replyRecorded: Boolean(reply),
    };
    check(state === 'COMPLETED' && reply, `the governed run did not complete with a CEO reply (state ${state}; failure ${detail.runs.map((r) => r.failureCode).filter(Boolean).join(',') || 'none'})`);
    check(usage.length >= 1 && usage.every((u) => u.outcome === 'OK' && u.withinBounds), 'every settled call is within bounds');
    check(reservations.every((r) => r.state === 'SETTLED' || r.state === 'RELEASED'), 'no reservation left open');
    check(detail.accountingInvariants.length === 0, 'accounting invariants hold');
    world.reply = reply.body;
    return detail;
  });

  await step('no-secret-no-cot-persisted', async () => {
    await runtime.stop();
    runtime = null;
    const db = readFileSync(path.join(company, 'state', 'company.sqlite3'));
    const logText = JSON.stringify(logs);
    const keyFound = await vault.use(DEEPSEEK_CREDENTIAL_REF, (key) => db.includes(key) || logText.includes(key));
    check(!keyFound, 'the credential value appears in the database or the logs');
    for (const needle of ['reasoning_' + 'content', 'Bearer ']) check(!db.includes(needle) && !logText.includes(needle), `${needle.trim()} appears in durable state or logs`);
    check(!logText.includes(world.reply.slice(0, 24)), 'the reply content leaked into the logs');
    return { databaseBytes: db.length, logRecords: logs.length, credentialInDbOrLogs: false, thinkingFieldInDbOrLogs: false, replyInLogs: false };
  });
} catch {
  // The failing step already reported itself.
} finally {
  if (runtime) await runtime.stop().catch(() => undefined);
}

if (world.reply) console.log(JSON.stringify({ founderVisibleReply: world.reply, note: 'the CEO\'s answer from the canonical thread (your own conversation; never logged)' }));
const verdict = failed ? 'L1-01 LIVE SMOKE — FAIL' : 'L1-01 LIVE SMOKE — PASS';
console.log(JSON.stringify({ verdict, steps: results, node: process.versions.node, platform: process.platform, sandbox: values.keep ? sandbox : '(removed)' }));
if (!values.keep && existsSync(path.join(sandbox, MARKER))) {
  if (preExisting) for (const entry of [MARKER, 'company']) rmSync(path.join(sandbox, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  else rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
process.exit(failed ? 1 : 0);
