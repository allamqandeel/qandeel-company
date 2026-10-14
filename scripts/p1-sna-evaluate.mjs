#!/usr/bin/env node
// G4-C2-SNA-01 (D-P1-15) — the Skill Need Assessment measured through the REAL governed runtime.
//
//   node --conditions=qandeel-test scripts/p1-sna-evaluate.mjs --label <run label> --ledger <file.jsonl>
//        --set <dir>/<PREFIX> [--set ...] [--out <per-item.jsonl>] [--concurrency 4] [--fake] [--keep]
//        [--ho2 <HO-2-MANIFEST.md>] [--cp1] [--level E1|E2]
//
// NOT a CI test. In a disposable workspace (never inside a Git tree, never the Founder's Company) it seeds, through the
// TEST-ONLY Founder seam, a CEO holding the six CEO Skills (synthetic payloads: the assessment reads the SN-2 need cards
// only, never a Skill text), provisions the release DeepSeek Academy profile plus the additive Skill-need profile, grants
// `model.invoke` for `skill.need.assessment` ONLY, and starts the runtime with the assessment processor ONLY (the Founder
// replies are created and wait; none ever runs, so no reply call is made). Each labelled message is sent into the
// Founder ↔ CEO thread exactly as the surface does; its assessment runs on its own Work Item, reservation and settlement;
// the harness reads the recorded decision, the usage rows and the run timings.
//
// Money (Founder approval for G4-C2-SNA-01: $5 in total for every paid run, HO-2 included; $0.02 per classification):
//   - every paid run appends its spend to the ledger; the Company cap of the disposable workspace is set to what is left
//     of the $5, so the governed reservation itself refuses a call that would pass the total (no harness arithmetic is
//     trusted alone); each assessment's own Work Item cap is the $0.02 of SKILL_NEED_CAP;
//   - failed, charged and uncertain calls count: the spend is the larger of billed and economic micros of every usage
//     row, plus any reservation never settled or released;
//   - at most 3 distinct prompt versions (SHA-256 of the preamble) may ever be paid for.
// The DeepSeek key stays in the Windows vault: it is never read, printed or passed here (only `has()` is checked; the
// leak check compares inside `vault.use`).
//
// Output is content-free: ids, codes, counts, metrics, money and milliseconds. No message text is printed or written.
// G4-C2-TEMP-01: it also counts the `temperature` each chat call carried on the wire (counts only) and records the sampling.
// --ho2 is the one-shot held-out mode: it verifies the sealed hashes, requires a clean tracked tree, refuses a second
// HO-2 run in the ledger, writes no per-item file and prints aggregates only.
// G4-HO2-FINAL-01 (fixed before HO-2 was opened): the scorer is scripts/p1-sna-score.mjs (pre-registered gates, six-Skill
// scope, loaded-set and tier-confusion metrics, over-assignment as evidence only); --ho2 (or --cp1) then measures the content
// effect on CP-1 with scripts/p1-sna-cp1-effect.mjs, free and local, from tiers held in memory only.
// G4-C2-REASONING-GATE-01: --level E2 is the isolated DEV pilot. In the disposable workspace only, it provisions a DEV-only
// pilot profile (one E2 deployment for the assessment class, the production route policy at E2..E2) INSTEAD of the release
// Skill-need profile, and pins the assessment at E2 (thinking low) with the Company's E2 allowance; prompt, cards, timeout,
// window, caps and the governed path are unchanged. The wire is checked for thinking low and no temperature. Production is
// E1 and is never touched. Every run also scores the tiers the reply would plan with in production: an assessment recorded
// after the 20-second window counts as the fallback (every eligible Skill SUPPORTING).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

import { cp1Effect } from './p1-sna-cp1-effect.mjs';
import { N, SIX, score } from './p1-sna-score.mjs';

const TOTAL_CAP_MICROS = 5_000_000;
// G4-SNA-01 allowed 3 paid prompt versions (SNP-1..SNP-3, all SN-2). G4-FINAL-QUALITY-CORR-01 approves a new version for
// the corrected definitions (SN-3) under a bounded number of design reviews: at most 3 more (SNP-4..SNP-6), 6 in total.
const MAX_PROMPT_VERSIONS = 6;
const ITEM_DEADLINE_MS = 90_000;

const { values: o } = parseArgs({
  strict: true,
  options: {
    label: { type: 'string' },
    ledger: { type: 'string' },
    set: { type: 'string', multiple: true },
    out: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    fake: { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
    ho2: { type: 'string' },
    limit: { type: 'string' },
    cp1: { type: 'boolean', default: false },
    level: { type: 'string', default: 'E1' },
  },
});

function refuse(code, message) {
  console.error(JSON.stringify({ ok: false, verdict: 'REFUSED', code, message }));
  process.exit(2);
}
const say = (step, fields) => console.log(JSON.stringify({ step, ...fields }));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const rd = (f) => readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));

if (!o.label || !/^[A-Za-z0-9._-]{1,64}$/.test(o.label)) refuse('USAGE', '--label is 1..64 letters, digits, dot, dash or underscore');
if (!o.ledger) refuse('USAGE', '--ledger <file.jsonl> is required (it carries the $5 total across runs)');
if (!o.set || o.set.length === 0) refuse('USAGE', 'at least one --set <dir>/<PREFIX>');
const concurrency = Number(o.concurrency);
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) refuse('USAGE', '--concurrency is 1..8');
if (o.level !== 'E1' && o.level !== 'E2') refuse('USAGE', '--level is E1 (production) or E2 (the isolated DEV pilot)');
if (o.level === 'E2' && o.ho2) refuse('HELD_OUT', 'the E2 pilot never opens a held-out set');
const limit = o.limit === undefined ? Infinity : Number(o.limit);
if (o.limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) refuse('USAGE', '--limit is a positive integer');

const sets = o.set.map((s) => ({ dir: path.dirname(path.resolve(s)), prefix: path.basename(s) }));
const heldOut = sets.some((s) => /^HO/i.test(s.prefix));
if (heldOut && !o.ho2) refuse('HELD_OUT', 'a held-out set is opened only in the sealed one-shot mode (--ho2 <manifest>)');
if (o.ho2 && (sets.length !== 1 || !/^HO2$/.test(sets[0].prefix))) refuse('HELD_OUT', '--ho2 evaluates exactly the HO2 set');
if (o.ho2 && (o.out || o.fake || Number.isFinite(limit))) refuse('HELD_OUT', '--ho2 writes no per-item file, runs paid and whole');

const ledgerFile = path.resolve(o.ledger);
const ledger = existsSync(ledgerFile) ? rd(ledgerFile) : [];
const spentBefore = ledger.reduce((a, r) => a + (r.spendMicros ?? 0), 0);

// ---------------------------------------------------------------------------------------------------------------- seal
let freeze = null;
if (o.ho2) {
  if (ledger.some((r) => r.ho2 === true)) refuse('HELD_OUT', 'HO-2 was already evaluated once; it is never reused');
  const manifest = readFileSync(path.resolve(o.ho2), 'utf8');
  const dir = sets[0].dir;
  for (const file of ['HO2-items.jsonl', 'HO2-reference.jsonl']) {
    const want = manifest.match(new RegExp(`([0-9a-f]{64}) \\*${file.replace('.', '\\.')}`))?.[1];
    if (!want) refuse('SEAL', `the manifest pins no hash for ${file}`);
    if (sha(readFileSync(path.join(dir, file))) !== want) refuse('SEAL', `${file} does not match its sealed hash`);
  }
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repo, encoding: 'utf8' }).trim();
  if (dirty) refuse('FREEZE', 'the tracked tree must be clean (frozen at a recorded commit) before HO-2 is opened');
  freeze = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), manifestSha256: sha(manifest) };
  say('ho2-seal', { result: 'VERIFIED', ...freeze });
}

// ------------------------------------------------------------------------------------------------------------- imports
const gov = await import('@qandeel-company/governance');
const mind = await import('@qandeel-company/mind');
const mp = await import('@qandeel-company/model-providers');
const { InMemorySecretVault, WindowsUserVault } = await import('@qandeel-company/secret-vault');
const { CompanyRuntime, Logger, skillNeedAssessmentProcessor, skillNeedAssessmentProcessorAt } = await import('@qandeel-company/runtime');
const { CompanyStore, GovernanceStore, OrganizationStore, SkillStore } = await import('@qandeel-company/storage');
// Test-only seam: resolvable only because this harness runs with --conditions=qandeel-test.
const { activateEmployeeForTest, armFounderTestSurface } = await import('@qandeel-company/storage/testing');

const SKILLS = Object.keys(mind.SKILL_NEED_CARDS);
// G4-C2-REASONING-GATE-01: the DEV-only E2 pilot profile (never a release profile; provisioned in this workspace only).
const E2_PILOT_PROFILE = (() => {
  const p = mp.DEEPSEEK_V41_FLASH_SKILL_NEED_PROFILE;
  const r = p.routePolicies[0];
  return Object.freeze({
    ...p,
    code: 'deepseek-v4-1-flash-skill-need-e2-pilot',
    deployments: Object.freeze([Object.freeze({ ...p.deployments[0], code: 'deepseek-flash-e2-skill-need-pilot', reasoningClass: 'E2', contextWindowTokens: mp.DEEPSEEK_CLASS_LIMITS.E2.contextWindowTokens, maxOutputTokens: mp.DEEPSEEK_CLASS_LIMITS.E2.maxOutputTokens })]),
    routePolicies: Object.freeze([Object.freeze({ taskClass: r.taskClass, body: Object.freeze({ ...r.body, minClass: 'E2', maxClass: 'E2' }) })]),
  });
})();
const pilot = o.level === 'E2';
const skillNeedProfile = pilot ? E2_PILOT_PROFILE : mp.DEEPSEEK_V41_FLASH_SKILL_NEED_PROFILE;
const assessor = pilot ? skillNeedAssessmentProcessorAt({ reasoningClass: 'E2', maxOutputTokens: gov.OUTPUT_ALLOWANCE_BY_CLASS.E2 }) : skillNeedAssessmentProcessor;
const callLevel = pilot ? { reasoningClass: 'E2', thinking: 'low', maxOutputTokens: gov.OUTPUT_ALLOWANCE_BY_CLASS.E2 } : { reasoningClass: 'E1', thinking: 'none', maxOutputTokens: gov.SKILL_NEED_MAX_OUTPUT_TOKENS };
if (SKILLS.join() !== SIX.join()) refuse('USAGE', 'the scorer and the need cards must name the same six Skills in the same order');
const promptSha = gov.SKILL_NEED_PREAMBLE_SHA256;
const versions = new Set(ledger.filter((r) => !r.fake).map((r) => r.promptSha256));
if (!o.fake && !versions.has(promptSha) && versions.size >= MAX_PROMPT_VERSIONS) refuse('PROMPT_VERSIONS', `${MAX_PROMPT_VERSIONS} prompt versions were already paid for`);

// --------------------------------------------------------------------------------------------------------------- items
const rows = [];
for (const s of sets) {
  const items = rd(path.join(s.dir, `${s.prefix}-items.jsonl`));
  const ref = new Map(rd(path.join(s.dir, `${s.prefix}-reference.jsonl`)).map((r) => [r.id, r]));
  for (const it of items) {
    const r = ref.get(it.id);
    if (!r || r.excluded) continue;
    rows.push({ id: it.id, lang: it.lang, cat: String(it.category).toUpperCase(), text: it.text, labels: r.labels });
  }
}
if (Number.isFinite(limit)) rows.splice(limit);
const remaining = TOTAL_CAP_MICROS - spentBefore;
const perCall = gov.SKILL_NEED_CAP.money;
if (!o.fake && remaining < perCall) refuse('BUDGET', `the $5 total is spent (${spentBefore} µUSD recorded)`);
say('plan', { label: o.label, level: callLevel, mode: o.fake ? 'FAKE' : o.ho2 ? 'HO2_ONE_SHOT' : 'PAID_DEV', items: rows.length, sets: sets.map((s) => s.prefix), promptVersion: gov.SKILL_NEED_PROMPT_VERSION, promptSha256: promptSha, cardsVersion: mind.SKILL_NEED_CARDS_VERSION, cardsSha256: mind.skillNeedCardsDigest(SKILLS), spentBeforeMicros: spentBefore, companyCapMicros: o.fake ? 0 : remaining, perClassificationCapMicros: perCall, concurrency });

// ----------------------------------------------------------------------------------------------------------- transport
const realVault = o.fake ? new InMemorySecretVault().set('deepseek-company', 'fake-' + 'k'.repeat(24)) : new WindowsUserVault();
// G4-FINAL-QUALITY-CORR-01 (WP3): how long resolving the credential takes (the DPAPI host process on Windows), timed around
// `use()` only — the callback (the request itself) is timed by the transport below. The value is never read here.
const vaultMs = [];
const vault = {
  kind: realVault.kind,
  has: (ref) => realVault.has(ref),
  list: () => realVault.list(),
  async use(ref, fn) {
    const t0 = performance.now();
    let inside = null;
    try {
      return await realVault.use(ref, (secret) => {
        inside = performance.now();
        return fn(secret);
      });
    } finally {
      if (inside !== null) vaultMs.push(Math.round(inside - t0));
    }
  },
};
if (!o.fake) {
  if (process.platform !== 'win32') refuse('VAULT_UNAVAILABLE', 'the paid run uses the Founder host DPAPI vault');
  if (!(await vault.has(mp.DEEPSEEK_CREDENTIAL_REF))) refuse('CREDENTIAL_UNAVAILABLE', `no secret is stored for ${mp.DEEPSEEK_CREDENTIAL_REF}; the paid part stops`);
}
const providerMs = [];
// G4-C2-TEMP-01: what sampling actually reached the wire (counts only; the body is never kept or printed).
const wire = { chatCalls: 0, temperatureZero: 0, temperatureOther: 0, temperatureAbsent: 0, thinkingDisabled: 0, thinkingLow: 0, thinkingOther: 0, maxTokensMismatch: 0 };
const inner = o.fake
  ? new mp.FakeDeepSeekTransport().respondWith((request) => {
      if (request.path === mp.DEEPSEEK_MODELS_PATH) return mp.fakeModelsAnswer([{ id: mp.DEEPSEEK_MODEL_CODE, name: mp.DEEPSEEK_EXPECTED_PUBLIC_NAME }]);
      return mp.fakeChatAnswer(JSON.stringify({ type: 'SKILL_NEED', skills: SKILLS.map((code) => ({ code, tier: 'SUPPORTING' })) }), { prompt: 2_600, completion: 70 });
    })
  : new mp.DeepSeekHttpsTransport();
const transport = {
  async send(request, signal) {
    const t0 = performance.now();
    if (request.path !== mp.DEEPSEEK_MODELS_PATH) {
      wire.chatCalls++;
      const t = request.body && typeof request.body === 'object' && 'temperature' in request.body ? request.body.temperature : undefined;
      if (t === undefined) wire.temperatureAbsent++;
      else if (t === 0) wire.temperatureZero++;
      else wire.temperatureOther++;
      // G4-C2-REASONING-GATE-01: the thinking switch, the effort and the allowance that reached the wire (counts only).
      const b = request.body ?? {};
      if (b.thinking?.type === 'disabled' && b.reasoning_effort === undefined) wire.thinkingDisabled++;
      else if (b.thinking?.type === 'enabled' && b.reasoning_effort === 'low') wire.thinkingLow++;
      else wire.thinkingOther++;
      if (b.max_tokens !== callLevel.maxOutputTokens) wire.maxTokensMismatch++;
    }
    try {
      return await inner.send(request, signal);
    } finally {
      if (request.path !== mp.DEEPSEEK_MODELS_PATH) providerMs.push(Math.round(performance.now() - t0));
    }
  },
};
const adapter = new mp.DeepSeekProviderAdapter({ vault, transport });

// ----------------------------------------------------------------------------------------------------------- workspace
const sandbox = mkdtempSync(path.join(os.tmpdir(), 'qandeel-sna-'));
for (let dir = sandbox; ; dir = path.dirname(dir)) {
  if (existsSync(path.join(dir, '.git'))) refuse('USAGE', 'the workspace must not be inside a Git working tree');
  if (path.dirname(dir) === dir) break;
}
const company = path.join(sandbox, 'company');
mkdirSync(company);
const world = {};
armFounderTestSurface(company);
{
  const store = CompanyStore.open(company);
  try {
    const g = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const founder = g.registerFounder().ref;
    const seat = org.positionByCode('company.ceo');
    const dept = g.departmentByCode('growth');
    const cap = o.fake ? 50_000_000 : remaining;
    const id = await adapter.checkIdentity();
    g.recordModelIdentityCheck({ providerCode: mp.DEEPSEEK_V41_FLASH_ACADEMY_PROFILE.provider.code, modelCode: mp.DEEPSEEK_V41_FLASH_ACADEMY_PROFILE.model.code, expectedName: mp.DEEPSEEK_V41_FLASH_ACADEMY_PROFILE.model.expectedPublicName, observedName: id.observedName, observedContextWindow: id.observedContextWindow, observedMaxOutputTokens: id.observedMaxOutputTokens, result: id.result });
    if (id.result !== 'MATCH') refuse('IDENTITY', `model identity check: ${id.result}`);
    g.provisionProviderProfile(founder, mp.DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, { capMoney: cap, capTokens: 50_000_000, reasonCode: 'p1.skill_need' });
    g.provisionProviderProfile(founder, skillNeedProfile, { capMoney: 0, capTokens: 0, reasonCode: 'p1.skill_need' });
    g.createBudget(founder, { scope: 'DEPARTMENT', scopeId: dept.id, capMoney: cap, capTokens: 50_000_000, reasonCode: 'p1.skill_need' });
    const e = g.createEmployee(founder, { name: { given: 'Eval', family: 'CEO' }, profile: { personality: 'steady' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED', selection: 'AUTO' }, roleRef: seat.roleRef, positionRef: 'position:p1', departmentId: dept.id, managerRef: founder });
    g.transitionEmployee(founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    g.transitionEmployee(founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(g, founder, e.id);
    g.createBudget(founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: cap, capTokens: 50_000_000, reasonCode: 'p1.skill_need' });
    // The assessment's class ONLY: no founder.reply grant, so no reply could ever reach a provider from this workspace.
    g.grant(founder, { employeeId: e.id, capability: 'model.invoke', resourceScope: gov.SKILL_NEED_TASK_CLASS, riskCeiling: 'R0', dataClassCeiling: 'D2', reasonCode: 'p1.skill_need' });
    org.assignPrimary(founder, { positionId: seat.id, employeeId: e.id, reasonCode: 'placed' });
    const reg = SkillStore.for(store);
    for (const code of SKILLS) {
      const skill = reg.registerSkill(founder, { code, name: `Skill ${code}`, skillType: 'QANDEEL_NATIVE', ownerRef: 'department:growth' });
      let v = reg.registerSkillVersion(founder, { skillId: skill.id, versionLabel: '1.0.0', sourceRef: `qandeel:${code}`, sourceRevision: 'r1', authorRef: 'department:growth', licenseSpdx: null, dependencies: [], instructions: `Synthetic payload for ${code}.` });
      v = reg.checkLicenseAndDependencies(reg.inspectSkillVersion(v.id).id);
      for (const [to, extra] of [['SECURITY_QUARANTINE', {}], ['SANDBOXED', { evidenceRef: 'review:s1', securityPassed: true }], ['BENCHMARKED', { evidenceRef: 'benchmark:b1' }], ['COMPARED', {}], ['APPROVED', {}]]) v = reg.advanceSkillVersion(founder, v.id, to, { reasonCode: 'step', ...extra });
      reg.openPassportEntry(founder, e.id, v.id);
    }
    Object.assign(world, { founder, ceoId: e.id });
  } finally {
    store.close();
  }
}

// ----------------------------------------------------------------------------------------------------------------- run
const logs = [];
const runtime = new CompanyRuntime({ workspace: company, processors: [assessor], concurrency, supervisorTtlMs: 5_000, governance: { providers: [adapter], provisioningProfiles: [mp.DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, skillNeedProfile], modelCallTimeoutMs: 180_000 }, logger: new Logger((r) => logs.push(JSON.stringify(r))) });
await runtime.start();
const comm = runtime.founder.communications;
const thread = comm.directThread(world.founder, null);
const results = new Map();
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const started = Date.now();

async function assess(row) {
  const sentAt = Date.now();
  const sent = comm.send(world.founder, thread.id, { purpose: 'QUESTION', body: row.text });
  const reply = sent.replyWorkItemId;
  let record = null;
  let assessment = null;
  while (Date.now() - sentAt < ITEM_DEADLINE_MS) {
    record ??= runtime.mind.skillNeed.forReply(reply);
    assessment ??= runtime.mind.skillNeed.assessmentOf(reply);
    if (record && (assessment === null || TERMINAL.has(runtime.view.getWorkItem(assessment).state))) break;
    await sleep(100);
  }
  const usage = assessment ? runtime.governance.usage({ workItemId: assessment }) : [];
  const runs = assessment ? runtime.view.runsForWorkItem(assessment) : [];
  const open = runs.flatMap((r) => runtime.governance.reservations(r.id)).filter((r) => r.state !== 'SETTLED' && r.state !== 'RELEASED');
  const all = runs.flatMap((r) => runtime.governance.reservations(r.id));
  results.set(row.id, {
    record,
    usage,
    heldMicros: open.reduce((a, r) => a + r.money, 0),
    replyUsage: runtime.governance.usage({ workItemId: reply }).length,
    reservations: all.map((r) => ({ state: r.state, money: r.money })),
    endToEndMs: record ? Date.parse(record.createdAt) - sentAt : null,
    runMs: runs.map((r) => (r.endedAt ? Date.parse(r.endedAt) - Date.parse(r.startedAt) : null)).filter((x) => x !== null),
  });
}

let next = 0;
let stopCode = null;
async function lane() {
  while (next < rows.length && stopCode === null) {
    const spent = [...results.values()].reduce((a, r) => a + r.usage.reduce((b, u) => b + Math.max(u.billedMicros, u.economicMicros), 0) + r.heldMicros, 0);
    if (!o.fake && spent + perCall * concurrency > remaining) {
      stopCode = 'TOTAL_CAP_REACHED';
      break;
    }
    await assess(rows[next++]);
  }
}
try {
  await Promise.all(Array.from({ length: concurrency }, () => lane()));
} finally {
  await runtime.stop();
}
const wallMs = Date.now() - started;

// ----------------------------------------------------------------------------------------------------- privacy checks
const db = readFileSync(path.join(company, 'state', 'company.sqlite3'));
const logText = logs.join('\n');
const keyLeak = o.fake ? false : await realVault.use(mp.DEEPSEEK_CREDENTIAL_REF, (key) => db.includes(key) || logText.includes(key));
const textInLogs = rows.filter((r) => r.text.length >= 12 && logText.includes(r.text.slice(0, 24))).length;

// ------------------------------------------------------------------------------------------------------------- scoring
// G4-HO2-FINAL-01: the scorer lives in scripts/p1-sna-score.mjs (pure; its self-test replays the recorded runs exactly).
const r3 = (a, b) => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null;
};
const outcomes = {};
const perItem = [];
const scored = rows.filter((r) => results.has(r.id));
const tierSet = new Set(gov.SKILL_NEED_TIERS);
const records = [];
for (const row of scored) {
  const res = results.get(row.id);
  const rec = res.record;
  if (rec) records.push(rec);
  const outcome = rec ? rec.outcome : 'HARNESS_TIMEOUT';
  outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  // What the reply would plan with: the model's tiers, or (fallback) every eligible Skill SUPPORTING.
  row.pred = Object.fromEntries(SKILLS.map((s) => [s, rec?.source === 'MODEL' ? rec.tiers[s] ?? 'NON_RELEVANT' : 'SUPPORTING']));
  // G4-C2-REASONING-GATE-01: in production a classification recorded after the window loses to the reply's fallback.
  row.lateForWindow = res.endToEndMs !== null && res.endToEndMs > gov.SKILL_NEED_WINDOW_MS;
  row.source = rec?.source ?? 'NONE';
  row.outcome = outcome;
  perItem.push({ id: row.id, lang: row.lang, cat: row.cat, source: row.source, outcome, lateForWindow: row.lateForWindow, pred: row.pred, usage: res.usage.map((u) => ({ in: u.inputTokens, cached: u.cachedInputTokens, out: u.outputTokens, billed: u.billedMicros, economic: u.economicMicros, outcome: u.outcome, band: u.billingBand })), endToEndMs: res.endToEndMs, runMs: res.runMs });
}
const usageAll = [...results.values()].flatMap((r) => r.usage);
// Integrity facts the gate needs from the harness (each true when held): every message decided; the frozen prompt and cards
// on every record; exactly the six eligible Skills offered; well-formed model tiers bound to those codes (anything else is a
// fallback); one deployment for every call; no Founder reply ever called a model; temperature 0 on every call; no leak.
const sortedSkills = [...SKILLS].sort().join();
const integrity = {
  everyMessageDecided: records.length === scored.length,
  frozenPromptAndCards: records.every((r) => r.cardsSha256 === mind.skillNeedCardsDigest(SKILLS) && (r.source !== 'MODEL' || r.promptSha256 === promptSha)),
  offeredExactlyEligible: records.every((r) => r.offered.map((x) => x.code).sort().join() === sortedSkills),
  modelTiersWellFormed: records.filter((r) => r.source === 'MODEL').every((r) => Object.keys(r.tiers).sort().join() === sortedSkills && Object.values(r.tiers).every((t) => tierSet.has(t))),
  singleDeployment: new Set(usageAll.map((u) => String(u.deploymentId))).size <= 1,
  noReplyModelCall: [...results.values()].every((r) => r.replyUsage === 0),
  // E1: temperature 0 and thinking off on every call; the E2 pilot: thinking low and no temperature on every call. Both: the
  // pinned allowance on every call.
  allTemperatureZero: pilot ? wire.chatCalls > 0 && wire.temperatureAbsent === wire.chatCalls && wire.thinkingLow === wire.chatCalls && wire.maxTokensMismatch === 0 : wire.chatCalls > 0 && wire.temperatureZero === wire.chatCalls && wire.thinkingDisabled === wire.chatCalls && wire.maxTokensMismatch === 0,
  noCredentialOrTextLeak: !keyLeak && textInLogs === 0,
};
const sc = score(scored, integrity);
// G4-C2-REASONING-GATE-01: the same scorer on what the reply would plan with in production (late → fallback).
const lateCount = scored.filter((r) => r.lateForWindow).length;
const effective = score(scored.map((r) => (r.lateForWindow ? { ...r, pred: Object.fromEntries(SKILLS.map((s) => [s, 'SUPPORTING'])) } : r)), integrity);
const metrics = sc.metrics;
const spendMicros = usageAll.reduce((a, u) => a + Math.max(u.billedMicros, u.economicMicros), 0) + [...results.values()].reduce((a, r) => a + r.heldMicros, 0);
const billed = usageAll.reduce((a, u) => a + u.billedMicros, 0);
const economic = usageAll.reduce((a, u) => a + u.economicMicros, 0);
const classifications = scored.length;
const e2e = [...results.values()].map((r) => r.endToEndMs).filter((x) => x !== null);
const runMs = [...results.values()].flatMap((r) => r.runMs);
const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const fallback = scored.filter((r) => r.source !== 'MODEL').length;
// G4-HO2-FINAL-01: the pre-registered gates (scripts/p1-sna-score.mjs). Over-assignment is descriptive evidence only.
const gate = sc.gates;
const cost = {
  spendMicros, billedMicros: billed, economicMicros: economic,
  perClassificationBilledMicros: classifications ? Math.round(billed / classifications) : null,
  perClassificationEconomicMicros: classifications ? Math.round(economic / classifications) : null,
  per1000MessagesUsd: classifications ? Math.round((economic / classifications) * 1000) / 1e6 : null,
  maxCallBilledMicros: Math.max(0, ...usageAll.map((u) => u.billedMicros)),
  bands: usageAll.reduce((a, u) => ({ ...a, [u.billingBand ?? 'NONE']: (a[u.billingBand ?? 'NONE'] ?? 0) + 1 }), {}),
  outputTokensP50: pct(usageAll.map((u) => u.outputTokens), 50), outputTokensP95: pct(usageAll.map((u) => u.outputTokens), 95),
  inputTokensAvg: avg(usageAll.map((u) => u.inputTokens)), cachedInputTokensAvg: avg(usageAll.map((u) => u.cachedInputTokens)), outputTokensAvg: avg(usageAll.map((u) => u.outputTokens)), outputTokensMax: Math.max(0, ...usageAll.map((u) => u.outputTokens)),
  calls: usageAll.length,
};
// G4-C2-TEMP-01: the accounting split the Founder asked for. Reservations are worst-case holds that end SETTLED (to the
// actual usage) or RELEASED (provably unsent); only a HELD / still-open one is money of uncertain outcome.
const resAll = [...results.values()].flatMap((r) => r.reservations);
const accounting = {
  economicMicros: economic,
  providerBilledMicros: billed,
  reservations: { count: resAll.length, worstCaseMicros: resAll.reduce((a, r) => a + r.money, 0), byState: resAll.reduce((a, r) => ({ ...a, [r.state]: (a[r.state] ?? 0) + 1 }), {}) },
  heldOrUncertainMicros: [...results.values()].reduce((a, r) => a + r.heldMicros, 0),
  chargedToTrialCapMicros: spendMicros,
};
const latency = { vaultAvgMs: avg(vaultMs), vaultP50Ms: pct(vaultMs, 50), vaultP95Ms: pct(vaultMs, 95), vaultMaxMs: vaultMs.length ? Math.max(...vaultMs) : null, providerAvgMs: avg(providerMs), providerP50Ms: pct(providerMs, 50), providerP95Ms: pct(providerMs, 95), providerMaxMs: providerMs.length ? Math.max(...providerMs) : null, runAvgMs: avg(runMs), runP95Ms: pct(runMs, 95), endToEndAvgMs: avg(e2e), endToEndP50Ms: pct(e2e, 50), endToEndP95Ms: pct(e2e, 95), endToEndMaxMs: e2e.length ? Math.max(...e2e) : null, withinReplyWindow: e2e.filter((x) => x <= gov.SKILL_NEED_WINDOW_MS).length, wallMs };
const rates = { fallbackRate: r3(fallback, classifications), timeoutRate: r3((outcomes.PROVIDER_UNCERTAIN ?? 0) + (outcomes.HARNESS_TIMEOUT ?? 0), classifications), failureRate: r3(classifications - (outcomes.CLASSIFIED ?? 0), classifications), invalidRate: r3((outcomes.OUTPUT_INVALID ?? 0) + (outcomes.OUTPUT_TRUNCATED ?? 0), classifications), outcomes };
const privacy = { credentialInDbOrLogs: keyLeak, messageTextInLogs: textInLogs };
const sampling = { ...wire, allDeterministic: wire.chatCalls > 0 && wire.temperatureZero === wire.chatCalls, wireAsPinned: integrity.allTemperatureZero };

const entry = { at: new Date().toISOString(), label: o.label, fake: o.fake, ho2: Boolean(o.ho2), sets: sets.map((s) => s.prefix), items: classifications, promptVersion: gov.SKILL_NEED_PROMPT_VERSION, promptSha256: promptSha, cardsSha256: mind.skillNeedCardsDigest(SKILLS), sampling: sampling.allDeterministic ? 'TEMPERATURE_0' : 'PROVIDER_DEFAULT_OR_MIXED', level: callLevel.reasoningClass, freeze, spendMicros: o.fake ? 0 : spendMicros, billedMicros: o.fake ? 0 : billed, economicMicros: o.fake ? 0 : economic, calls: cost.calls, stopCode, verdict: sc.verdict, gatePass: sc.verdict === 'PASS', effectiveVerdict: effective.verdict, lateForWindow: lateCount };
appendFileSync(ledgerFile, JSON.stringify(entry) + '\n');
if (o.out && !o.ho2) writeFileSync(path.resolve(o.out), perItem.map((x) => JSON.stringify(x)).join('\n') + '\n');
say('result', { label: o.label, level: callLevel, effective: { lateForWindow: lateCount, verdict: effective.verdict, metrics: effective.metrics, sixSkillScope: effective.six, failed: effective.failed }, metrics, sixSkillScope: sc.six, content: sc.content, overAssignment: sc.overAssignment, gate, scopeDisagreement: sc.scopeDisagreement, failed: sc.failed, verdict: sc.verdict, gatePass: entry.gatePass, cost, accounting, sampling, latency, rates, privacy, stopCode, totalSpentMicros: spentBefore + entry.spendMicros, totalCapMicros: TOTAL_CAP_MICROS });

// G4-HO2-FINAL-01: the content effect on CP-1 (free, local, after the money is recorded), from tiers held in memory only.
if (o.ho2 || o.cp1) {
  try {
    const data = scored.map((r) => ({ text: r.text, ref: Object.fromEntries(SKILLS.map((s) => [s, N(r.labels[s])])), pred: r.pred }));
    say('cp1-effect', await cp1Effect(data));
  } catch (error) {
    say('cp1-effect', { result: 'ERROR', code: error?.code ?? error?.name ?? 'UNKNOWN' });
  }
}

if (!o.keep) rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
else say('kept', { sandbox });
// The vault's PowerShell child and the HTTPS sockets close on their own; a bounded unref'd fallback ends a stuck process.
process.exitCode = keyLeak || textInLogs > 0 ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 10_000).unref();
