#!/usr/bin/env node
// C5 local acceptance harness — for the Founder-host review (and CI), runnable without editing source.
//
//   npm run c5:acceptance -- --workspace <disposable directory> [--keep]
//
// The directory must not exist yet, or be empty. The harness writes an ownership marker, creates a Company
// workspace in <dir>/company and proves, with the deterministic fake provider (no network, no commercial
// provider, no credential), the Founder Command Center backend contracts:
//
// - production fail-closed first: no Founder surface is armed; a Founder ref is not authentication; the
//   launcher CLI has no write command; a garbage session fails; a launch token yields a session whose scope
//   arms authority for exactly one synchronous call;
// - then, through the TEST-ONLY seam standing in for the launch-token session while seeding: a representative
//   organization (CEO, Directors, managers, specialists, a vacant Director seat covered ACTING, vacant
//   specialist seats), a live company (running, blocked, awaiting approval, delegated work), Goals with
//   Goal → Work links, a Founder ↔ CEO thread answered by the CEO's own governed run, a CEO brief;
// - the Company Universe projection (Founder centre, CEO nearest, five sectors, truthful seats, live-only
//   relations, Goal traceability), deterministic and time-correct;
// - Founder Attention (Needs Me / CEO Briefs; routine work excluded; dedup);
// - the governed confirmation boundary over real loopback HTTP (text → preview → confirm; forged CSRF,
//   wrong fingerprint and foreign Host refused);
// - conversation ≠ authority, restart durability, content-free logs / health.
//
// At the end it deletes only what it created unless --keep is given.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { seedLive, seedStatic } from './c5/seed-company.mjs';

const MARKER = '.qandeel-c5-acceptance';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FOUNDER_CLI = path.join(ROOT, 'packages/command-center/dist/src/cli.js');

const { values } = parseArgs({ strict: true, options: { workspace: { type: 'string' }, keep: { type: 'boolean', default: false } } });
const { FounderSurface, CSRF_HEADER, CSRF_COOKIE, SESSION_COOKIE } = await import('@qandeel-company/command-center');
const { CompanyStore, FounderAuthStore, GoalStore, CURRENT_SCHEMA_VERSION, projectUniverse } = await import('@qandeel-company/storage');

function refuse(message) {
  console.error(JSON.stringify({ ok: false, verdict: 'REFUSED', message }));
  process.exit(2);
}
if (!values.workspace) refuse('usage: npm run c5:acceptance -- --workspace <new or empty directory> [--keep]');
const sandbox = path.resolve(values.workspace);
for (let dir = sandbox; ; dir = path.dirname(dir)) {
  if (existsSync(path.join(dir, '.git'))) refuse('the acceptance directory must not be inside a Git working tree (source checkouts are never touched)');
  if (path.dirname(dir) === dir) break;
}
if (existsSync(sandbox) && readdirSync(sandbox).length > 0) refuse('the acceptance directory must not exist or must be empty');
const preExisting = existsSync(sandbox);
mkdirSync(sandbox, { recursive: true });
writeFileSync(path.join(sandbox, MARKER), 'created by the QANDEEL COMPANY C5 acceptance harness; safe to delete\n');
const company = path.join(sandbox, 'company');

const results = [];
let failed = false;
const check = (cond, what) => {
  if (!cond) throw new Error(what);
};

/** Status of a raw GET with exactly these headers (`fetch` silently drops a caller-set Host, so a forged Host goes over node:http). */
function rawStatus(origin, pathname, headers) {
  const u = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: Number(u.port), path: pathname, method: 'GET', headers, setHost: false }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}
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
const refusedWith = (fn, code) => {
  try {
    fn();
  } catch (error) {
    return error?.code === code;
  }
  return false;
};
const cliRun = (...args) => spawnSync(process.execPath, [FOUNDER_CLI, ...args], { encoding: 'utf8', shell: false, windowsHide: true });

const CONTENT = ['إطلاق السعودية', 'ما وضع إطلاق', 'الإطلاق السعودي على المسار', 'حملة الإطلاق السعودي جاهزة'];
const logs = [];
const cookieHeader = (cookies) => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
function client(origin) {
  const c = { cookies: {} };
  c.get = async (p, headers = {}) => {
    const res = await fetch(`${origin}${p}`, { headers: { Cookie: cookieHeader(c.cookies), ...headers } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  c.post = async (p, body, headers = {}, { noCsrf = false } = {}) => {
    const res = await fetch(`${origin}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin', Cookie: cookieHeader(c.cookies), ...(noCsrf ? {} : { [CSRF_HEADER]: c.cookies[CSRF_COOKIE] ?? '' }), ...headers }, body: JSON.stringify(body) });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [k, v] = pair.split('=');
      if (k && v !== undefined) c.cookies[k.trim()] = v.trim();
    }
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  return c;
}

await step('production-founder-surface-closed', () => {
  const store = CompanyStore.open(company);
  try {
    check(store.schemaVersion === CURRENT_SCHEMA_VERSION && CURRENT_SCHEMA_VERSION >= 9, 'schema carries the C5 migration');
    const f = 'founder:00000000-0000-4000-8000-000000000000';
    const goals = GoalStore.for(store);
    check(refusedWith(() => goals.propose(f, { kind: 'COMPANY', title: 'x', summary: 'y', ownerRef: 'employee:x' }), 'FOUNDER_SURFACE_UNAVAILABLE'), 'a Founder ref is not authentication');
    const auth = FounderAuthStore.for(store);
    check(refusedWith(() => auth.verifySession('garbage'), 'FOUNDER_SESSION_INVALID'), 'a garbage session fails closed');
    check(refusedWith(() => auth.redeemLaunchToken('x'.repeat(43)), 'FOUNDER_SESSION_INVALID'), 'an unknown launch token fails closed');
    const { token } = auth.mintLaunchToken();
    const { session, cookieValue } = auth.redeemLaunchToken(token);
    check(refusedWith(() => auth.redeemLaunchToken(token), 'FOUNDER_SESSION_INVALID'), 'a launch token is single-use');
    check(auth.verifySession(cookieValue).founderRef === session.founderRef, 'the session verifies against its hash');
    check(!JSON.stringify(auth.sessions()).includes(cookieValue), 'no session value at rest (hashes only)');
    const g = auth.withSession(session, (founderRef) => goals.propose(founderRef, { kind: 'COMPANY', title: 'x', summary: 'y', ownerRef: 'employee:x' }));
    check(g.state === 'PROPOSED', 'inside the session scope the Founder acts');
    check(refusedWith(() => goals.transition(session.founderRef, g.id, { to: 'APPROVED', reasonCode: 'x' }), 'FOUNDER_SURFACE_UNAVAILABLE'), 'outside the scope the chokepoint is closed again');
    auth.revokeAll('acceptance');
    check(refusedWith(() => auth.verifySession(cookieValue), 'FOUNDER_SESSION_INVALID'), 'revoked');
    goals.transition;
  } finally {
    store.close();
  }
  for (const cmd of ['approve', 'reject', 'register-founder', 'decide', 'confirm']) check(cliRun(cmd, '--workspace', company).status === 2, `the launcher CLI has no ${cmd} command`);
  return { founderSurface: 'SESSION_ONLY', cli: 'no write command' };
});

// The first workspace holds the fail-closed goal; the seeded company gets its own clean workspace.
rmSync(company, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
const world = seedStatic(company);
let surface = new FounderSurface({ workspace: company, fakes: { providers: ['fake-local'], drivers: ['fake-notes', 'fake-publisher'] }, runtime: { supervisorTtlMs: 2_000, concurrency: 6, governance: { modelCallTimeoutMs: 300_000 } }, briefing: false, log: (event, fields) => logs.push(`${event} ${JSON.stringify(fields)}`) });
let live;
let t0;
try {
  await surface.start();
  t0 = surface.runtime.founder.universe().at;
  await step('seed-live-company', async () => {
    live = await seedLive(surface, world, { holdMs: 120_000 });
    return { running: 1, blocked: 1, awaitingApproval: 1, delegated: 1, threads: 3 };
  });
  await step('company-universe-projection', () => {
    const u = surface.runtime.founder.universe();
    check(u.founderRef === world.founder && u.live, 'the Founder is the principal at the centre');
    check(u.departments.map((d) => d.code).join(',') === 'strategic-market-intelligence,growth,brand-creative,product,engineering', 'five canonical sectors in canonical order');
    const ceo = u.seats.find((s) => s.kind === 'CEO');
    check(ceo.holderEmployeeId === world.employees['company.ceo'].id && ceo.reportsToFounder, 'the CEO holds the nearest orbit and reports to the Founder');
    const brand = u.seats.find((s) => s.code === 'director.brand-creative');
    check(brand.holderKind === 'ACTING' && brand.holderEmployeeId === world.employees['director.product'].id && brand.coveredEmployeeId === null, 'a vacant Director seat covered ACTING is shown truthfully (nobody invented)');
    check(u.seats.filter((s) => s.status === 'ACTIVE' && s.holderEmployeeId === null).length === 2, 'two vacant specialist seats');
    const kinds = new Set(u.relations.map((r) => r.kind));
    check(kinds.has('DELEGATION') && kinds.has('APPROVAL'), `live relations only: ${[...kinds].join(',')}`);
    check(u.work.some((w) => w.running) && u.work.some((w) => w.state === 'BLOCKED') && u.work.some((w) => w.state === 'WAITING_APPROVAL'), 'running, blocked and awaiting-approval work visible');
    const saudi = u.goals.find((g) => g.id === world.goals.saudi);
    check(saudi.workItemIds.length >= 3 && saudi.anchorDepartmentIds.length >= 2, 'Goal → Work traceability from durable links');
    const analyst = u.employees.find((e) => e.id === world.employees['smi.analyst-1'].id);
    check(analyst.chain.map((c) => c.kind).join('>') === 'SPECIALIST>DIRECTOR>CEO>FOUNDER', 'the chain inward to the Founder');
    const again = surface.runtime.founder.universe();
    check(JSON.stringify(again.seats) === JSON.stringify(u.seats) && JSON.stringify(again.goals) === JSON.stringify(u.goals), 'deterministic');
    return { employees: u.employees.length, seats: u.seats.length, relations: u.relations.length, goals: u.goals.length, signals: u.signals };
  });
  await step('founder-attention-lanes', () => {
    const attention = surface.runtime.founder.attention;
    attention.sync(world.founder);
    const items = attention.list();
    const needsMe = items.filter((i) => i.lane === 'NEEDS_ME');
    const briefs = items.filter((i) => i.lane === 'CEO_BRIEFS');
    check(needsMe.some((i) => i.sourceRef === `approval:${live.approvalId}`), 'the pending R3 approval needs the Founder');
    check(needsMe.some((i) => i.sourceRef === `goal:${world.goals.rating}`), 'the proposed company goal needs the Founder');
    check(briefs.length === 1 && briefs[0].level === 'NEEDS_DECISION', 'one CEO brief, decision-needed');
    check(!items.some((i) => i.sourceRef === `work_item:${live.analysis}` || i.sourceRef === `thread:${live.directThreadId}`), 'a completed task and a plain FYI thread never enter Founder Attention');
    const before = items.length;
    attention.sync(world.founder);
    check(attention.list().length === before, 'idempotent: no notification storm');
    return { needsMe: needsMe.length, briefs: briefs.length, threads: items.filter((i) => i.lane === 'THREADS').length };
  });
  await step('ceo-answers-from-its-own-governed-run', () => {
    const comm = surface.runtime.founder.communications;
    const msgs = comm.messages(live.ceoThreadId);
    check(msgs.length === 2 && msgs[0].senderKind === 'FOUNDER' && msgs[1].senderKind === 'EMPLOYEE' && msgs[1].runId !== null, 'the CEO reply is bound to its run');
    check(comm.pendingReplies().length === 0, 'the pending request resolved');
    const brief = comm.messages(live.briefThreadId).find((m) => m.purpose === 'BRIEF');
    check(brief && brief.brief.decisionNeeded === true && brief.brief.happening.length > 0, 'the brief follows the Founder Communication Standard');
    check(surface.runtime.governance.grants(world.employees['company.ceo'].id).filter((g) => g.capability !== 'model.invoke' && g.capability !== 'tool:notes.append').length === 0, 'conversation ≠ authority');
    return { replyRunId: msgs[1].runId, brief: 'STANDARD' };
  });
  await step('governed-action-over-loopback-http', async () => {
    const c = client(surface.origin);
    check((await c.get('/api/universe')).status === 401, 'no session → 401');
    const token = surface.launchUrl().split('#')[1];
    check((await c.post('/api/session/launch', { token }, {}, { noCsrf: true })).status === 200, 'launch');
    check((await c.get('/api/universe')).status === 200, 'projection with a session');
    const gov = surface.runtime.governance;
    const ceoBudget = gov.budgetFor('EMPLOYEE', world.employees['company.ceo'].id);
    const capBefore = ceoBudget.capMoney;
    const cmd = await c.post('/api/command', { text: 'وافق على حملة إيهاب طارق بميزانية EGP 50,000' });
    check(cmd.status === 200 && cmd.body.intent.kind === 'MUTATING' && cmd.body.preview?.state === 'PREVIEW', 'a mutating instruction becomes a structured preview');
    check(gov.budgetFor('EMPLOYEE', world.employees['company.ceo'].id).capMoney === capBefore, 'the text alone changed nothing');
    const p = cmd.body.preview;
    check((await c.post(`/api/previews/${p.id}/confirm`, { fingerprint: 'f'.repeat(64) })).status === 409, 'wrong fingerprint refused');
    check((await c.post(`/api/previews/${p.id}/confirm`, { fingerprint: p.fingerprint }, { [CSRF_HEADER]: 'z'.repeat(43) })).status === 403, 'forged CSRF refused at the gate');
    const rebinding = await rawStatus(surface.origin, '/api/universe', { Host: 'evil.example:80', Cookie: cookieHeader(c.cookies) });
    check(rebinding === 403 || rebinding === 400, `a foreign Host is refused (${rebinding})`);
    const confirmed = await c.post(`/api/previews/${p.id}/confirm`, { fingerprint: p.fingerprint });
    check(confirmed.status === 200 && confirmed.body.preview.state === 'CONFIRMED', `confirmed: ${JSON.stringify(confirmed.body).slice(0, 120)}`);
    check(gov.budgetFor('EMPLOYEE', world.employees['company.ceo'].id).capMoney === 50_000 * 1_000_000, 'the ceiling changed at the real boundary, inside the session scope');
    check((await c.post(`/api/previews/${p.id}/confirm`, { fingerprint: p.fingerprint })).status === 409, 'decided exactly once');
    const audits = surface.runtime.view.auditByAction('founder.action_confirmed');
    check(audits.length === 1 && !JSON.stringify(audits).includes('إيهاب'), 'the confirmation is audited, content-free');
    // A read command changes focus only.
    const read = await c.post('/api/command', { text: 'افتح ليلى مراد' });
    check(read.body.intent.kind === 'READ' && read.body.focus.targetId === world.employees['growth.manager-1'].id, 'a read command resolves a focus target');
    check((await c.post('/api/session/logout', {})).status === 200, 'logout');
    check((await fetch(`${surface.origin}/api/session`, { headers: { Cookie: cookieHeader(c.cookies) } })).status === 401, 'the cookie is dead after logout');
    return { capBefore, capAfter: 50_000 * 1_000_000, sessionCookie: c.cookies[SESSION_COOKIE] ? 'issued' : 'none' };
  });
  await step('historical-focus-is-time-correct', () => {
    const past = surface.runtime.founder.universe({ at: t0 });
    const now = surface.runtime.founder.universe();
    check(!past.live && past.relations.length === 0 && now.relations.length >= 2, 'before the live seed there were no relations; now there are');
    check(past.seats.find((s) => s.kind === 'CEO').holderEmployeeId === now.seats.find((s) => s.kind === 'CEO').holderEmployeeId, 'the same company, another instant');
    check(past.goals.length === now.goals.length && past.goals.every((g) => g.workItemIds.length === 0), 'goal links did not exist yet at T');
    return { pastRelations: past.relations.length, liveRelations: now.relations.length };
  });
  await step('restart-durability-and-fail-closed-sessions', async () => {
    const c = client(surface.origin);
    await c.post('/api/session/launch', { token: surface.launchUrl().split('#')[1] }, {}, { noCsrf: true });
    await surface.stop();
    surface = new FounderSurface({ workspace: company, fakes: { providers: ['fake-local'], drivers: ['fake-notes', 'fake-publisher'] }, runtime: { supervisorTtlMs: 2_000, concurrency: 6 }, briefing: false, log: (event, fields) => logs.push(`${event} ${JSON.stringify(fields)}`) });
    await surface.start();
    const store = surface.runtime.founder;
    check(store.auth.sessions().every((s) => s.revokedAt !== null), 'every session was revoked at stop (fail closed)');
    check(store.goals.list({ live: true }).length === 3 && store.communications.threads().length >= 3, 'goals and threads survive a restart');
    const u = store.universe();
    check(u.seats.find((s) => s.kind === 'CEO').holderEmployeeId === world.employees['company.ceo'].id, 'placements survive');
    return { restarted: true, sessionsRevoked: store.auth.sessions().length };
  });
  await step('health-logs-and-cli-content-free', () => {
    const f = surface.runtime.founder;
    const health = JSON.stringify({ attention: f.attention.health(), communication: f.communications.health(), org: surface.runtime.orgHealth() });
    const joined = logs.join('\n');
    for (const c of CONTENT) {
      check(!health.includes(c), `health carries content: ${c}`);
      check(!joined.includes(c), `a log line carries content: ${c}`);
    }
    check(!joined.includes(world.employees['company.ceo'].name.given), 'logs carry no names');
    const launch = cliRun('launch', '--workspace', company);
    check(launch.status === 0 && /launchUrl/.test(launch.stdout) && !/founder:[0-9a-f-]{36}/.test(launch.stdout), 'the launcher prints a URL, never a principal');
    const reopened = CompanyStore.open(company, { create: false, migrationMode: 'verify' });
    let u;
    try {
      u = JSON.stringify(projectUniverse(reopened));
    } finally {
      reopened.close();
    }
    check(!u.includes('vault:') && !u.includes('token'), 'the projection carries no credential reference');
    return { logLines: logs.length };
  });
} finally {
  await surface.stop().catch(() => undefined);
}

const verdict = failed ? 'C5 LOCAL ACCEPTANCE — FAIL' : 'C5 LOCAL ACCEPTANCE — PASS';
console.log(JSON.stringify({ verdict, steps: results.length, node: process.versions.node, platform: process.platform, sandbox: values.keep ? sandbox : '(removed)' }));
if (!values.keep && existsSync(path.join(sandbox, MARKER))) {
  if (preExisting) for (const entry of [MARKER, 'company']) rmSync(path.join(sandbox, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  else rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
process.exit(failed ? 1 : 0);
