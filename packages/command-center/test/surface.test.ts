/**
 * The Founder surface end to end over real HTTP on loopback: launch token → session → projection → command
 * (read) → preview → confirmation at the real boundary; forged CSRF, foreign Host, stale token and missing
 * session all fail closed; nothing in a log line carries a message body.
 * C5-PROOF: founder-listener
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CompanyStore, GovernanceStore, OrganizationStore } from '@qandeel-company/storage';
import { activateEmployeeForTest, armFounderTestSurface } from '@qandeel-company/storage/testing';

import { CSRF_COOKIE, CSRF_HEADER, FounderSurface, SESSION_COOKIE } from '../src/index.js';

/** The value a proof relies on, present by construction of the fixture. */
function must<T>(v: T | null | undefined, what = 'value'): T {
  if (v === null || v === undefined) throw new Error(`${what} is missing`);
  return v;
}

/** Status of a raw GET with exactly these headers (a forged Host never reaches the server through `fetch`). */
function rawStatus(origin: string, pathname: string, headers: Record<string, string>): Promise<number> {
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

// <root>/packages/command-center/dist/test/surface.test.js → <root>/packages/command-center-ui
const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'command-center-ui');

interface World {
  readonly founder: string;
  readonly ceoId: string;
  readonly analystId: string;
}

function seed(company: string): World {
  armFounderTestSurface(company);
  const store = CompanyStore.open(company);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const founder = gov.registerFounder().ref;
    gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: 50_000_000, capTokens: 50_000_000, currency: 'EGP', reasonCode: 'seed' });
    const growth = must(gov.departmentByCode('growth'));
    gov.createBudget(founder, { scope: 'DEPARTMENT', scopeId: growth.id, capMoney: 20_000_000, capTokens: 20_000_000, reasonCode: 'seed' });
    const hire = (given: string, family: string, roleRef: string): string => {
      const e = gov.createEmployee(founder, { name: { given, family }, profile: {}, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef, positionRef: 'position:p1', departmentId: growth.id, managerRef: founder });
      gov.transitionEmployee(founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
      gov.transitionEmployee(founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
      activateEmployeeForTest(gov, founder, e.id);
      gov.createBudget(founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 5_000_000, capTokens: 5_000_000, reasonCode: 'seed' });
      return e.id;
    };
    const ceoSeat = must(org.positionByCode('company.ceo'));
    const ceoId = hire('إيهاب', 'طارق', ceoSeat.roleRef);
    org.assignPrimary(founder, { positionId: ceoSeat.id, employeeId: ceoId, reasonCode: 'placed' });
    const dirSeat = must(org.positionByCode('director.growth'));
    const analystId = hire('ليلى', 'مراد', dirSeat.roleRef);
    org.assignPrimary(founder, { positionId: dirSeat.id, employeeId: analystId, reasonCode: 'placed' });
    // A pending R3 approval for the analyst's campaign: the "Needs Me" item the Founder will decide.
    const { workItem } = store.createWorkItem({ objective: 'حملة أداء', ownerRef: `employee:${analystId}`, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', instructions: 'x' }, riskLevel: 'R3', approvalRequired: true, initialState: 'READY' });
    gov.requestWorkItemApproval(`employee:${analystId}`, workItem.id);
    return { founder, ceoId, analystId };
  } finally {
    store.close();
  }
}

async function withSurface(fn: (ctx: { surface: FounderSurface; world: World; origin: string; company: string }) => Promise<void>): Promise<void> {
  const base = mkdtempSync(path.join(tmpdir(), 'qc-c5-surface-'));
  const company = path.join(base, 'مساحة-العمل');
  const world = seed(company);
  const logs: string[] = [];
  const surface = new FounderSurface({ workspace: company, roots: { app: path.join(uiRoot, 'dist', 'src'), public: path.join(uiRoot, 'public') }, runtime: { supervisorTtlMs: 3_000 }, briefing: false, log: (event, fields) => logs.push(`${event} ${JSON.stringify(fields)}`) });
  try {
    await surface.start();
    await fn({ surface, world, origin: surface.origin, company });
    assert.ok(logs.every((l) => !l.includes('حملة') && !l.includes('إيهاب')), 'no log line carries content');
  } finally {
    await surface.stop().catch(() => undefined);
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

interface Client {
  cookies: Record<string, string>;
  get(path: string, headers?: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }>;
  post(path: string, body: unknown, headers?: Record<string, string>, opts?: { noCsrf?: boolean }): Promise<{ status: number; body: Record<string, unknown> }>;
}

function client(origin: string): Client {
  const c: Client = {
    cookies: {},
    async get(p, headers = {}) {
      const res = await fetch(`${origin}${p}`, { headers: { Cookie: cookieHeader(c.cookies), ...headers } });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    async post(p, body, headers = {}, opts = {}) {
      const res = await fetch(`${origin}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin', Cookie: cookieHeader(c.cookies), ...(opts.noCsrf ? {} : { [CSRF_HEADER]: c.cookies[CSRF_COOKIE] ?? '' }), ...headers }, body: JSON.stringify(body) });
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const [k, v] = (pair ?? '').split('=');
        if (k && v !== undefined) c.cookies[k.trim()] = v.trim();
      }
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
  };
  return c;
}

const cookieHeader = (cookies: Record<string, string>): string => Object.entries(cookies).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${v}`).join('; ');

describe('Founder surface over loopback HTTP', () => {
  test('C5-PROOF: no session → 401 everywhere except the launch page; a used or unknown launch token fails closed', () =>
    withSurface(async ({ surface, origin }) => {
      const c = client(origin);
      assert.equal((await c.get('/api/universe')).status, 401);
      assert.equal((await c.get('/api/session')).status, 401);
      const launched = await c.post('/api/session/launch', { token: 'x'.repeat(43) }, {}, { noCsrf: true });
      assert.equal(launched.status, 401);
      const url = surface.launchUrl();
      const token = must(url.split('#')[1]);
      const ok = await c.post('/api/session/launch', { token }, {}, { noCsrf: true });
      assert.equal(ok.status, 200);
      assert.ok(c.cookies[SESSION_COOKIE] && c.cookies[CSRF_COOKIE], 'session and CSRF cookies issued');
      const again = await c.post('/api/session/launch', { token }, {}, { noCsrf: true });
      assert.equal(again.status, 401, 'a launch token is single-use');
      const page = await fetch(`${origin}/`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /lang="en" dir="ltr"/);
      assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    }));

  test('C5-PROOF: the projection, a read command, a governed preview and its confirmation at the real approval boundary', () =>
    withSurface(async ({ surface, origin, world }) => {
      const c = client(origin);
      await c.post('/api/session/launch', { token: surface.launchUrl().split('#')[1] }, {}, { noCsrf: true });
      const session = await c.get('/api/session');
      assert.equal(session.status, 200);
      assert.equal(session.body.founderRef, world.founder);
      const u = await c.get('/api/universe');
      assert.equal(u.status, 200);
      const seats = u.body.seats as { kind: string; holderEmployeeId: string | null }[];
      assert.ok(seats.some((s) => s.kind === 'CEO' && s.holderEmployeeId === world.ceoId));
      assert.equal((u.body.departments as unknown[]).length, 5);
      const relations = u.body.relations as { kind: string; to: string }[];
      assert.ok(relations.some((r) => r.kind === 'APPROVAL' && r.to === 'founder'), 'the pending approval is a live relation to the Founder');
      const attention = await c.get('/api/attention');
      const items = attention.body.items as { lane: string; sourceKind: string }[];
      assert.ok(items.some((i) => i.lane === 'NEEDS_ME' && i.sourceKind === 'APPROVAL'));
      // A read command changes focus only.
      const read = await c.post('/api/command', { text: 'افتح ليلى' });
      assert.equal(read.status, 200);
      assert.equal((read.body.intent as { kind: string }).kind, 'READ');
      assert.equal((read.body.focus as { lens: string; targetId: string }).targetId, world.analystId);
      // A mutating command becomes a preview; the approval is still pending.
      const gov = surface.runtime.governance;
      const [pending] = gov.listApprovals('PENDING');
      assert.ok(pending);
      // The command names the approval's work (R2-24: an argument that names nothing never falls back to "the" pending approval).
      const cmd = await c.post('/api/command', { text: 'approve حملة أداء' });
      assert.equal(cmd.status, 200);
      const preview = cmd.body.preview as { id: string; fingerprint: string; state: string };
      assert.equal(preview.state, 'PREVIEW');
      assert.equal(gov.getApproval(pending.id).state, 'PENDING', 'the text alone decided nothing');
      // Wrong fingerprint: refused, still pending.
      const wrong = await c.post(`/api/previews/${preview.id}/confirm`, { fingerprint: 'f'.repeat(64) });
      assert.equal(wrong.status, 409);
      assert.equal(gov.getApproval(pending.id).state, 'PENDING');
      // Forged CSRF header: refused at the gate before any handler.
      const forged = await c.post(`/api/previews/${preview.id}/confirm`, { fingerprint: preview.fingerprint }, { [CSRF_HEADER]: 'z'.repeat(43) });
      assert.equal(forged.status, 403);
      // Foreign Host (DNS rebinding): refused.
      // (`fetch` silently drops a caller-set Host header, so the forged request goes over node:http.)
      const rebinding = await rawStatus(origin, '/api/universe', { Host: 'evil.example:1', Cookie: cookieHeader(c.cookies) });
      assert.ok(rebinding === 403 || rebinding === 400, `foreign Host refused (${rebinding})`);
      // The real confirmation: the approval engine decides, the preview is CONFIRMED, the audit is content-free.
      const confirmed = await c.post(`/api/previews/${preview.id}/confirm`, { fingerprint: preview.fingerprint });
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
      assert.ok(['APPROVED', 'CONSUMED'].includes(gov.getApproval(pending.id).state), 'decided (and, for work execution, consumed on release)');
      assert.equal((confirmed.body.preview as { state: string }).state, 'CONFIRMED');
      const audit = surface.runtime.view.auditByAction('founder.action_confirmed');
      assert.ok(audit.length >= 1 && JSON.stringify(audit).includes('APPROVAL_DECIDE') && !JSON.stringify(audit).includes('حملة'));
      // A second confirmation of the same preview: refused (decided exactly once).
      const twice = await c.post(`/api/previews/${preview.id}/confirm`, { fingerprint: preview.fingerprint });
      assert.equal(twice.status, 409);
      // Logout revokes; the cookie is dead afterwards.
      await c.post('/api/session/logout', {});
      c.cookies[SESSION_COOKIE] = c.cookies[SESSION_COOKIE] ?? '';
      const after = await fetch(`${origin}/api/session`, { headers: { Cookie: cookieHeader(c.cookies) } });
      assert.equal(after.status, 401);
    }));

  test('R2-23 / R2-24: a goal-state command previews its own verb; an unmatched argument previews nothing; a rail act posts a structured preview (Reject reachable)', () =>
    withSurface(async ({ surface, origin, world }) => {
      const c = client(origin);
      await c.post('/api/session/launch', { token: surface.launchUrl().split('#')[1] }, {}, { noCsrf: true });
      const goals = surface.runtime.founder.goals;
      const gov = surface.runtime.governance;
      const pending = must(gov.listApprovals('PENDING')[0]);
      // Fixture goals (Founder acts through the test seam armed for this workspace).
      const owner = `employee:${world.ceoId}`;
      const growth = goals.propose(world.founder, { kind: 'COMPANY', title: 'Growth Engine', summary: 's', ownerRef: owner });
      goals.transition(world.founder, growth.id, { to: 'APPROVED', reasonCode: 'ok' });
      goals.transition(world.founder, growth.id, { to: 'ACTIVE', reasonCode: 'ok' });
      const to = async (text: string): Promise<string | null> => ((await c.post('/api/command', { text })).body.preview as { payload: { to: string } } | undefined)?.payload.to ?? null;
      assert.equal(await to('pause the growth engine goal'), 'PAUSED');
      assert.equal(await to('cancel the growth engine goal'), 'CANCELLED');
      assert.equal(await to('اوقف هدف growth engine'), 'PAUSED');
      assert.equal(await to('achieve goal growth engine'), 'ACHIEVED');
      assert.equal(await to('activate goal growth engine'), null, 'an ACTIVE goal is not "activated" again: the transition is checked at preview');
      assert.equal(goals.get(growth.id).state, 'ACTIVE', 'previews changed nothing');
      const deny = goals.propose(world.founder, { kind: 'COMPANY', title: 'Deny competitor entry', summary: 's', ownerRef: owner });
      const named = (await c.post('/api/command', { text: 'approve goal Deny competitor entry' })).body.preview as { intentKind: string; payload: { goalId: string } } | undefined;
      assert.deepEqual([named?.intentKind, named?.payload.goalId], ['GOAL_APPROVE', deny.id], 'the goal named by its title — never an unrelated approval');
      // RR1-1: the command's own verb decides; an approve word inside the title never activates the goal.
      const accept = goals.propose(world.founder, { kind: 'COMPANY', title: 'Accept vendor returns', summary: 's', ownerRef: owner });
      for (const text of ['cancel the accept vendor returns goal', 'الغ هدف accept vendor returns']) {
        const p = (await c.post('/api/command', { text })).body.preview as { intentKind: string; payload: { goalId: string; to?: string } } | undefined;
        assert.deepEqual([p?.intentKind, p?.payload.goalId, p?.payload.to], ['GOAL_STATE', accept.id, 'CANCELLED'], `${text}: previews the cancellation it says`);
      }
      assert.equal(goals.get(accept.id).state, 'PROPOSED', 'previews changed nothing');
      for (const text of ['approve the campaign', 'reject goal Deny competitor entry', 'approve Launch KSA', 'resolve the conflict']) {
        const out = await c.post('/api/command', { text });
        assert.equal(out.body.preview, undefined, `${text}: an argument that names nothing (or no stated decision) previews nothing`);
      }
      assert.equal(gov.getApproval(pending.id).state, 'PENDING');
      // The rail posts the structured act it shows: Reject is reachable, and the summary says what will happen.
      const rail = await c.post('/api/previews', { intent: 'APPROVAL_DECIDE', payload: { approvalId: pending.id, decision: 'REJECT' } });
      assert.equal(rail.status, 200, JSON.stringify(rail.body));
      const rp = rail.body.preview as { id: string; fingerprint: string; summary: string; intentKind: string };
      assert.match(rp.summary, /^Reject /);
      const done = await c.post(`/api/previews/${rp.id}/confirm`, { fingerprint: rp.fingerprint });
      assert.equal(done.status, 200, JSON.stringify(done.body));
      assert.equal(gov.getApproval(pending.id).state, 'REJECTED');
      const goal = await c.post('/api/previews', { intent: 'GOAL_APPROVE', payload: { goalId: deny.id, activate: true } });
      assert.match((goal.body.preview as { summary: string }).summary, /Deny competitor entry/);
    }));

  test('C5-PROOF: a Founder ↔ CEO thread is opened through the session; a message needing an answer creates the reply Work Item', () =>
    withSurface(async ({ surface, origin, world }) => {
      const c = client(origin);
      await c.post('/api/session/launch', { token: surface.launchUrl().split('#')[1] }, {}, { noCsrf: true });
      const opened = await c.post('/api/threads', { employeeId: null });
      assert.equal(opened.status, 200);
      const thread = opened.body.thread as { id: string; kind: string; employeeId: string };
      assert.deepEqual([thread.kind, thread.employeeId], ['FOUNDER_CEO', world.ceoId]);
      const sent = await c.post(`/api/threads/${thread.id}/messages`, { purpose: 'QUESTION', body: 'ما وضع الإطلاق؟' });
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      const replyId = sent.body.replyWorkItemId as string;
      assert.ok(replyId);
      const item = surface.runtime.view.getWorkItem(replyId as never);
      assert.equal(item.ownerRef, `employee:${world.ceoId}`);
      assert.ok(['READY', 'QUEUED', 'IN_PROGRESS', 'FAILED', 'BLOCKED'].includes(item.state) || item.state.startsWith('WAITING'), item.state);
      const msgs = await c.get(`/api/threads/${thread.id}/messages`);
      assert.equal((msgs.body.messages as unknown[]).length, 1);
      // Direct communication changed no authority: the CEO holds no new grant, no approval moved.
      assert.equal(surface.runtime.governance.grants(world.ceoId as never).length, 0);
    }));

  test('P1-CHAT-INTEL-01: the chat API pages history, reports each reply\'s state and the Employee\'s intelligence, sends idempotently, and refuses an unroutable level before anything is recorded', () =>
    withSurface(async ({ surface, origin, world }) => {
      const c = client(origin);
      await c.post('/api/session/launch', { token: surface.launchUrl().split('#')[1] }, {}, { noCsrf: true });
      const thread = (await c.post('/api/threads', { employeeId: world.analystId })).body.thread as { id: string; employeeId: string };
      assert.equal(thread.employeeId, world.analystId);
      // Talk again returns the same conversation, never a new empty one.
      assert.equal(((await c.post('/api/threads', { employeeId: world.analystId })).body.thread as { id: string }).id, thread.id);
      const first = await c.post(`/api/threads/${thread.id}/messages`, { purpose: 'QUESTION', body: 'أول سؤال', responseRequired: true, clientKey: 'p1-surface-key-01' });
      assert.equal(first.status, 200, JSON.stringify(first.body));
      const again = await c.post(`/api/threads/${thread.id}/messages`, { purpose: 'QUESTION', body: 'أول سؤال', responseRequired: true, clientKey: 'p1-surface-key-01' });
      assert.deepEqual([again.body.replayed, (again.body.message as { id: string }).id], [true, (first.body.message as { id: string }).id], 'a repeated send is the same message');
      for (let i = 0; i < 3; i++) assert.equal((await c.post(`/api/threads/${thread.id}/messages`, { purpose: 'FYI', body: `note ${i}`, responseRequired: false })).status, 200);
      // No conversation route is provisioned in this Company: an explicit level is refused, and nothing is recorded.
      const refused = await c.post(`/api/threads/${thread.id}/messages`, { purpose: 'QUESTION', body: 'E2 please', reasoningClass: 'E2' });
      assert.equal(refused.status >= 400 && refused.status < 500, true, JSON.stringify(refused.body));
      assert.equal((refused.body.details as { reason?: string } | undefined)?.reason, 'NO_ROUTE_POLICY');
      const newest = await c.get(`/api/threads/${thread.id}/messages?limit=2`);
      assert.equal(newest.status, 200);
      assert.deepEqual((newest.body.messages as { seq: number }[]).map((m) => m.seq), [3, 4]);
      assert.equal(newest.body.hasOlder, true);
      const intel = newest.body.intelligence as { levels: { availability: string }[]; defaultClass: string; ceilingClass: string };
      assert.deepEqual([intel.defaultClass, intel.ceilingClass, intel.levels.map((l) => l.availability)], ['E1', 'E2', ['NO_ROUTE_POLICY', 'NO_ROUTE_POLICY', 'NO_ROUTE_POLICY', 'NO_ROUTE_POLICY']]);
      const older = await c.get(`/api/threads/${thread.id}/messages?before=3&limit=2`);
      assert.deepEqual((older.body.messages as { seq: number }[]).map((m) => m.seq), [1, 2]);
      assert.equal(older.body.hasOlder, false);
      assert.equal(older.body.intelligence, null, 'intelligence only with the newest page');
      const replies = older.body.replies as { messageId: string; status: string; replyWorkItemId: string }[];
      assert.deepEqual(replies.map((r) => r.messageId), [(first.body.message as { id: string }).id], 'the reply state of the Founder question on that page');
      assert.ok(['QUEUED', 'RUNNING', 'FAILED', 'BLOCKED', 'WAITING', 'WAITING_FOR_BUDGET'].includes(replies[0]?.status ?? ''), replies[0]?.status);
      assert.equal((await c.get(`/api/threads/${thread.id}/messages?limit=0`)).status, 400);
      assert.equal((await c.get(`/api/threads/${thread.id}/messages?before=x`)).status, 400);
      // The profile carries Employee Intelligence (a read; no route → no level is offered).
      const detail = await c.get(`/api/employees/${world.analystId}`);
      assert.equal((detail.body.intelligence as { employeeId: string }).employeeId, world.analystId);
      assert.equal(surface.runtime.governance.reasoningControl(world.analystId as never).overrides.length, 0, 'no override was recorded by the refused send');
      // CORR-01 over HTTP: a note replays by its key too; a reused key with another message is a 409 that names nothing.
      const note = await c.post(`/api/threads/${thread.id}/messages`, { purpose: 'FYI', body: 'ملاحظة', responseRequired: false, clientKey: 'p1-surface-key-02' });
      const noteAgain = await c.post(`/api/threads/${thread.id}/messages`, { purpose: 'FYI', body: 'ملاحظة', responseRequired: false, clientKey: 'p1-surface-key-02' });
      assert.deepEqual([noteAgain.status, noteAgain.body.replayed, (noteAgain.body.message as { id: string }).id, noteAgain.body.replyWorkItemId], [200, true, (note.body.message as { id: string }).id, null]);
      const conflict = await c.post(`/api/threads/${thread.id}/messages`, { purpose: 'FYI', body: 'another note', responseRequired: false, clientKey: 'p1-surface-key-02' });
      assert.deepEqual([conflict.status, conflict.body.code, (conflict.body.details as { reason?: string }).reason], [409, 'IDEMPOTENCY_CONFLICT', 'CLIENT_KEY_REUSED']);
      assert.equal(JSON.stringify(conflict.body).includes((note.body.message as { id: string }).id), false, 'a conflict never names the recorded message');
      assert.equal(((await c.get(`/api/threads/${thread.id}/messages?limit=50`)).body.messages as unknown[]).length, 5, 'one note, never a duplicate or the conflicting one');
    }));
});
