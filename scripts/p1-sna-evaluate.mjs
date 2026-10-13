#!/usr/bin/env node
// G4-C2-SNA-01 (D-P1-15) — the Skill Need Assessment measured through the REAL governed runtime.
//
//   node --conditions=qandeel-test scripts/p1-sna-evaluate.mjs --label <run label> --ledger <file.jsonl>
//        --set <dir>/<PREFIX> [--set ...] [--out <per-item.jsonl>] [--concurrency 4] [--fake] [--keep]
//        [--ho2 <HO-2-MANIFEST.md>]
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

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const TOTAL_CAP_MICROS = 5_000_000;
const MAX_PROMPT_VERSIONS = 3;
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
const { CompanyRuntime, Logger, skillNeedAssessmentProcessor } = await import('@qandeel-company/runtime');
const { CompanyStore, GovernanceStore, OrganizationStore, SkillStore } = await import('@qandeel-company/storage');
// Test-only seam: resolvable only because this harness runs with --conditions=qandeel-test.
const { activateEmployeeForTest, armFounderTestSurface } = await import('@qandeel-company/storage/testing');

const SKILLS = Object.keys(mind.SKILL_NEED_CARDS);
const TASK = SKILLS.filter((s) => s !== 'ceo.founder-partnership');
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
say('plan', { label: o.label, mode: o.fake ? 'FAKE' : o.ho2 ? 'HO2_ONE_SHOT' : 'PAID_DEV', items: rows.length, sets: sets.map((s) => s.prefix), promptVersion: gov.SKILL_NEED_PROMPT_VERSION, promptSha256: promptSha, cardsVersion: mind.SKILL_NEED_CARDS_VERSION, cardsSha256: mind.skillNeedCardsDigest(SKILLS), spentBeforeMicros: spentBefore, companyCapMicros: o.fake ? 0 : remaining, perClassificationCapMicros: perCall, concurrency });

// ----------------------------------------------------------------------------------------------------------- transport
const vault = o.fake ? new InMemorySecretVault().set('deepseek-company', 'fake-' + 'k'.repeat(24)) : new WindowsUserVault();
if (!o.fake) {
  if (process.platform !== 'win32') refuse('VAULT_UNAVAILABLE', 'the paid run uses the Founder host DPAPI vault');
  if (!(await vault.has(mp.DEEPSEEK_CREDENTIAL_REF))) refuse('CREDENTIAL_UNAVAILABLE', `no secret is stored for ${mp.DEEPSEEK_CREDENTIAL_REF}; the paid part stops`);
}
const providerMs = [];
// G4-C2-TEMP-01: what sampling actually reached the wire (counts only; the body is never kept or printed).
const wire = { chatCalls: 0, temperatureZero: 0, temperatureOther: 0, temperatureAbsent: 0 };
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
    g.provisionProviderProfile(founder, mp.DEEPSEEK_V41_FLASH_SKILL_NEED_PROFILE, { capMoney: 0, capTokens: 0, reasonCode: 'p1.skill_need' });
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
const runtime = new CompanyRuntime({ workspace: company, processors: [skillNeedAssessmentProcessor], concurrency, supervisorTtlMs: 5_000, governance: { providers: [adapter], provisioningProfiles: [mp.DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, mp.DEEPSEEK_V41_FLASH_SKILL_NEED_PROFILE], modelCallTimeoutMs: 180_000 }, logger: new Logger((r) => logs.push(JSON.stringify(r))) });
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
const keyLeak = o.fake ? false : await vault.use(mp.DEEPSEEK_CREDENTIAL_REF, (key) => db.includes(key) || logText.includes(key));
const textInLogs = rows.filter((r) => r.text.length >= 12 && logText.includes(r.text.slice(0, 24))).length;

// ------------------------------------------------------------------------------------------------------------- scoring
const N = (l) => (l === 'NOT_NEEDED' ? 'NON_RELEVANT' : l);
const r3 = (a, b) => (b === 0 ? null : Math.round((a / b) * 1000) / 1000);
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null;
};
const per = {}, lang = {}, cat = {};
let tp = 0, fn = 0, fp = 0, loaded = 0, severe = 0, refTR = 0, multiLost = 0;
const outcomes = {};
const perItem = [];
const scored = rows.filter((r) => results.has(r.id));
for (const row of scored) {
  const res = results.get(row.id);
  const rec = res.record;
  const outcome = rec ? rec.outcome : 'HARNESS_TIMEOUT';
  outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  // What the reply would plan with: the model's tiers, or (fallback) every eligible Skill SUPPORTING.
  row.pred = Object.fromEntries(SKILLS.map((s) => [s, rec?.source === 'MODEL' ? rec.tiers[s] ?? 'NON_RELEVANT' : 'SUPPORTING']));
  row.source = rec?.source ?? 'NONE';
  for (const s of TASK) {
    const want = N(row.labels[s]), got = row.pred[s];
    per[s] ??= { tp: 0, fn: 0, fp: 0 };
    lang[row.lang] ??= { tp: 0, fn: 0 };
    cat[row.cat] ??= { tp: 0, fn: 0, fp: 0 };
    const w = want === 'TASK_REQUIRED', g = got === 'TASK_REQUIRED';
    if (w) {
      refTR++;
      if (got !== 'NON_RELEVANT') loaded++;
      else {
        severe++;
        if (row.cat === 'MULTI') multiLost++;
      }
    }
    if (w && g) { tp++; per[s].tp++; lang[row.lang].tp++; cat[row.cat].tp++; }
    else if (w) { fn++; per[s].fn++; lang[row.lang].fn++; cat[row.cat].fn++; }
    else if (g) { fp++; per[s].fp++; cat[row.cat].fp++; }
  }
  perItem.push({ id: row.id, lang: row.lang, cat: row.cat, source: row.source, outcome, pred: row.pred, usage: res.usage.map((u) => ({ in: u.inputTokens, cached: u.cachedInputTokens, out: u.outputTokens, billed: u.billedMicros, economic: u.economicMicros, outcome: u.outcome, band: u.billingBand })), endToEndMs: res.endToEndMs, runMs: res.runMs });
}
const lr = Object.fromEntries(Object.entries(lang).map(([l, x]) => [l, r3(x.tp, x.tp + x.fn)]));
const lv = Object.values(lr).filter((x) => x !== null);
const partner = 'ceo.founder-partnership', exec = 'ceo.executive-judgment';
const pr = (s) => {
  const pred = scored.filter((r) => r.pred[s] === 'TASK_REQUIRED').length;
  const ref = scored.filter((r) => r.labels[s] === 'TASK_REQUIRED').length;
  const hit = scored.filter((r) => r.pred[s] === 'TASK_REQUIRED' && r.labels[s] === 'TASK_REQUIRED').length;
  return { R: r3(hit, ref), P: r3(hit, pred), ref, pred, fp: pred - hit, fn: ref - hit };
};
const simple = scored.filter((r) => r.cat.startsWith('SIMPLE'));
const usageAll = [...results.values()].flatMap((r) => r.usage);
const spendMicros = usageAll.reduce((a, u) => a + Math.max(u.billedMicros, u.economicMicros), 0) + [...results.values()].reduce((a, r) => a + r.heldMicros, 0);
const billed = usageAll.reduce((a, u) => a + u.billedMicros, 0);
const economic = usageAll.reduce((a, u) => a + u.economicMicros, 0);
const classifications = scored.length;
const e2e = [...results.values()].map((r) => r.endToEndMs).filter((x) => x !== null);
const runMs = [...results.values()].flatMap((r) => r.runMs);
const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const perSkill = Object.fromEntries(TASK.map((s) => [s.replace('ceo.', ''), { R: r3(per[s].tp, per[s].tp + per[s].fn), P: r3(per[s].tp, per[s].tp + per[s].fp), ref: per[s].tp + per[s].fn, pred: per[s].tp + per[s].fp, fp: per[s].fp, fn: per[s].fn }]));
const fallback = scored.filter((r) => r.source !== 'MODEL').length;
const metrics = {
  items: classifications,
  recallMicro: r3(tp, tp + fn), precisionMicro: r3(tp, tp + fp), tp, fn, fp,
  loadedRecall: r3(loaded, refTR), severeMisses: severe, multiLost,
  perSkill, partnership: pr(partner), executive: pr(exec),
  perLang: lr, gap: lv.length ? Math.round((Math.max(...lv) - Math.min(...lv)) * 1000) / 1000 : null,
  perCat: Object.fromEntries(Object.entries(cat).map(([c, x]) => [c, { R: r3(x.tp, x.tp + x.fn), fp: x.fp }])),
  simple: { n: simple.length, atMostOneTask: simple.filter((r) => TASK.filter((s) => r.pred[s] === 'TASK_REQUIRED').length <= 1).length, noTask: simple.filter((r) => TASK.every((s) => r.pred[s] !== 'TASK_REQUIRED')).length, loadsFour: simple.filter((r) => SKILLS.filter((s) => r.pred[s] !== 'NON_RELEVANT').length >= 4).length },
};
const gate = {
  recallMicro: metrics.recallMicro >= 0.9,
  precisionMicro: metrics.precisionMicro >= 0.8,
  perSkillRecall: Object.values(perSkill).every((x) => x.R === null || x.R >= 0.8),
  perLangRecall: lv.every((x) => x >= 0.85),
  langGap: metrics.gap !== null && metrics.gap <= 0.1,
  noOverAssignment: [metrics.partnership, metrics.executive].every((x) => x.pred <= Math.max(x.ref, 1) * 1.25),
  simpleLimits: metrics.simple.atMostOneTask === metrics.simple.n && metrics.simple.loadsFour === 0,
  noLostInCompound: multiLost === 0,
};
const cost = {
  spendMicros, billedMicros: billed, economicMicros: economic,
  perClassificationBilledMicros: classifications ? Math.round(billed / classifications) : null,
  perClassificationEconomicMicros: classifications ? Math.round(economic / classifications) : null,
  per1000MessagesUsd: classifications ? Math.round((economic / classifications) * 1000) / 1e6 : null,
  maxCallBilledMicros: Math.max(0, ...usageAll.map((u) => u.billedMicros)),
  bands: usageAll.reduce((a, u) => ({ ...a, [u.billingBand ?? 'NONE']: (a[u.billingBand ?? 'NONE'] ?? 0) + 1 }), {}),
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
const latency = { providerAvgMs: avg(providerMs), providerP50Ms: pct(providerMs, 50), providerP95Ms: pct(providerMs, 95), providerMaxMs: providerMs.length ? Math.max(...providerMs) : null, runAvgMs: avg(runMs), runP95Ms: pct(runMs, 95), endToEndAvgMs: avg(e2e), endToEndP95Ms: pct(e2e, 95), withinReplyWindow: e2e.filter((x) => x <= gov.SKILL_NEED_WINDOW_MS).length, wallMs };
const rates = { fallbackRate: r3(fallback, classifications), timeoutRate: r3((outcomes.PROVIDER_UNCERTAIN ?? 0) + (outcomes.HARNESS_TIMEOUT ?? 0), classifications), failureRate: r3(classifications - (outcomes.CLASSIFIED ?? 0), classifications), invalidRate: r3((outcomes.OUTPUT_INVALID ?? 0) + (outcomes.OUTPUT_TRUNCATED ?? 0), classifications), outcomes };
const privacy = { credentialInDbOrLogs: keyLeak, messageTextInLogs: textInLogs };
const sampling = { ...wire, allDeterministic: wire.chatCalls > 0 && wire.temperatureZero === wire.chatCalls };

const entry = { at: new Date().toISOString(), label: o.label, fake: o.fake, ho2: Boolean(o.ho2), sets: sets.map((s) => s.prefix), items: classifications, promptVersion: gov.SKILL_NEED_PROMPT_VERSION, promptSha256: promptSha, cardsSha256: mind.skillNeedCardsDigest(SKILLS), sampling: sampling.allDeterministic ? 'TEMPERATURE_0' : 'PROVIDER_DEFAULT_OR_MIXED', freeze, spendMicros: o.fake ? 0 : spendMicros, billedMicros: o.fake ? 0 : billed, economicMicros: o.fake ? 0 : economic, calls: cost.calls, stopCode, gatePass: Object.values(gate).every(Boolean) };
appendFileSync(ledgerFile, JSON.stringify(entry) + '\n');
if (o.out && !o.ho2) writeFileSync(path.resolve(o.out), perItem.map((x) => JSON.stringify(x)).join('\n') + '\n');
say('result', { label: o.label, metrics, gate, gatePass: entry.gatePass, cost, accounting, sampling, latency, rates, privacy, stopCode, totalSpentMicros: spentBefore + entry.spendMicros, totalCapMicros: TOTAL_CAP_MICROS });

if (!o.keep) rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
else say('kept', { sandbox });
// The vault's PowerShell child and the HTTPS sockets close on their own; a bounded unref'd fallback ends a stuck process.
process.exitCode = keyLeak || textInLogs > 0 ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 10_000).unref();
