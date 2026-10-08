/**
 * D2-CTRL-01 (D-D2-01) — lifecycle control inside the Command Center window, with real processes: the RUNNING host arms
 * the stopped-state desktop controller only for an authenticated Founder request; the controller refuses every request
 * that is not its own window's (wrong Host, another site or loopback port, missing fetch metadata, a non-JSON body, a
 * preflight, a missing / wrong control key, a wrong / replayed ticket) and serves nothing of the Company; once its window
 * redeems the ticket it runs the canonical controlled stop, keeps the window usable while STOPPED, starts the SAME Company
 * only through `ensureRunning` (READY on the canonical health), and hands the window back through the canonical single-use
 * launch token, which yields a valid Founder session. Restart goes through the same path. Closing the window (its watch
 * stream) ends the controller and never stops or starts the Company; reopening finds one host. Durable state survives
 * every transition, and no ticket, key or launch token reaches the host log.
 * OPS-PROOF: desktop-lifecycle-control
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CompanyStore } from '@qandeel-company/storage';

import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../src/index.js';
import { hostPaths } from '../src/host/descriptor.js';
import { DESKTOP_CONTROL_LOCK_FILE, DESKTOP_KEY_HEADER } from '../src/host/desktop-control.js';
import { discoverHost, launcherConfigPath, openCompany, stopHost, writeLauncherConfig } from '../src/host/lifecycle.js';

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const root = mkdtempSync(path.join(tmpdir(), 'qc-desk-ctl-'));
const ws = path.join(root, 'company');
// An isolated per-user profile: the launcher configuration the controller obeys lives here, never in the real one.
process.env.LOCALAPPDATA = path.join(root, 'local');
CompanyStore.open(ws).close();
writeLauncherConfig(launcherConfigPath(), { version: 1, workspace: ws, providers: [] });
{
  const store = CompanyStore.open(ws, { create: false, migrationMode: 'verify' });
  try {
    for (const n of [1, 2, 3]) store.recordAudit('desktop.control_sentinel', 'desktop_control_test', 'desktop-control-sentinel', 'OK', null, { n });
  } finally {
    store.close();
  }
}
const start = { cliPath, providers: [] as string[], browser: false };
const secrets: string[] = [];

after(async () => {
  await stopHost(ws, { force: true, timeoutMs: 30_000 });
  rmSync(root, { recursive: true, force: true });
});

interface Reply {
  status: number;
  body: string;
  json: Record<string, unknown>;
  cookies: Record<string, string>;
}

function request(port: number, method: string, pathname: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: { Host: `127.0.0.1:${port}`, ...headers }, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const cookies: Record<string, string> = {};
        for (const c of res.headers['set-cookie'] ?? []) {
          const [kv] = c.split(';');
          const i = (kv ?? '').indexOf('=');
          if (i > 0) cookies[(kv ?? '').slice(0, i)] = (kv ?? '').slice(i + 1);
        }
        const text = Buffer.concat(chunks).toString('utf8');
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(text) as Record<string, unknown>;
        } catch {
          // not JSON (a static file)
        }
        resolve({ status: res.statusCode ?? 0, body: text, json, cookies });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

const portOf = (origin: string): number => Number(new URL(origin).port);

/** A Founder session on the running host, through the canonical launch token. */
async function founderSession(): Promise<{ origin: string; port: number; cookie: string; csrf: string }> {
  const opened = await openCompany(ws, start);
  assert.equal(opened.ok, true, opened.outcome);
  const url = new URL(opened.launchUrl as string);
  secrets.push(url.hash.slice(1));
  const port = portOf(url.origin);
  const r = await request(port, 'POST', '/api/session/launch', { Origin: url.origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, JSON.stringify({ token: url.hash.slice(1) }));
  assert.equal(r.status, 200);
  return { origin: url.origin, port, cookie: `${SESSION_COOKIE}=${r.cookies[SESSION_COOKIE]}; ${CSRF_COOKIE}=${r.cookies[CSRF_COOKIE]}`, csrf: r.cookies[CSRF_COOKIE] as string };
}

const hostPost = (s: { origin: string; port: number; cookie: string; csrf: string }, pathname: string, body: unknown, extra: Record<string, string> = {}): Promise<Reply> =>
  request(s.port, 'POST', pathname, { Origin: s.origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', Cookie: s.cookie, [CSRF_HEADER]: s.csrf, ...extra }, JSON.stringify(body));

/** The controller's own window: exact Origin, same-origin fetch metadata, JSON, and the control key once redeemed. */
const ctl = (port: number, pathname: string, body: unknown, key?: string, extra: Record<string, string> = {}): Promise<Reply> =>
  request(port, 'POST', pathname, { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...(key ? { [DESKTOP_KEY_HEADER]: key } : {}), ...extra }, JSON.stringify(body));

/** Opens the window's watch stream and resolves once a snapshot matches (or fails after the timeout). */
function watch(port: number, key: string): { phases: string[]; until: (phase: string, timeoutMs?: number) => Promise<Record<string, unknown>>; close: () => void } {
  const phases: string[] = [];
  const waiters: { phase: string; resolve: (s: Record<string, unknown>) => void }[] = [];
  let last: Record<string, unknown> | null = null;
  const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/desktop/watch', agent: false, headers: { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', [DESKTOP_KEY_HEADER]: key } }, (res) => {
    let buf = '';
    res.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const snap = JSON.parse(buf.slice(0, nl)) as Record<string, unknown>;
        buf = buf.slice(nl + 1);
        last = snap;
        if (phases.at(-1) !== snap.phase) phases.push(String(snap.phase));
        for (const w of [...waiters]) if (w.phase === snap.phase) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(snap);
        }
        nl = buf.indexOf('\n');
      }
    });
  });
  req.on('error', () => undefined);
  req.end('{}');
  return {
    phases,
    until: (phase, timeoutMs = 120_000) =>
      new Promise((resolve, reject) => {
        const current: Record<string, unknown> | null = last;
        if (current !== null && current.phase === phase) return resolve(current);
        const timer = setTimeout(() => reject(new Error(`phase ${phase} not reached; saw ${phases.join(' → ')}`)), timeoutMs);
        waiters.push({
          phase,
          resolve: (s) => {
            clearTimeout(timer);
            resolve(s);
          },
        });
      }),
    close: () => req.destroy(),
  };
}

const fingerprint = (): string => {
  const store = CompanyStore.open(ws, { create: false, migrationMode: 'verify' });
  try {
    return JSON.stringify({ sentinel: store.audit('desktop-control-sentinel').map((a) => a.id), integrity: store.quickCheck() });
  } finally {
    store.close();
  }
};

const lockFile = (): string => path.join(hostPaths(ws).runtimeDir, DESKTOP_CONTROL_LOCK_FILE);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function controllerGone(port: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive = await request(port, 'GET', '/desktop').then(() => true, () => false);
    if (!alive && !existsSync(lockFile())) return true;
    await sleep(250);
  }
  return false;
}

describe('D2-CTRL-01 desktop lifecycle control (real host, real controller)', { concurrency: false }, () => {
  const before = fingerprint();
  let session: Awaited<ReturnType<typeof founderSession>>;
  let ctlPort = 0;
  let ticket = '';
  let key = '';

  test('the desktop routes exist only behind the Founder session and its CSRF secret', async () => {
    session = await founderSession();
    assert.equal((await request(session.port, 'GET', '/api/desktop/status')).status, 401);
    const status = await request(session.port, 'GET', '/api/desktop/status', { Cookie: session.cookie });
    assert.equal(status.status, 200);
    assert.equal(status.json.available, true);
    assert.equal(status.json.state, 'RUNNING');
    assert.equal(status.json.runtimeState, 'READY');
    assert.equal((await hostPost(session, '/api/desktop/control', { intent: 'STOP' }, { [CSRF_HEADER]: 'wrong' })).status, 403);
    assert.equal((await hostPost(session, '/api/desktop/control', { intent: 'STOP' }, { Origin: 'http://127.0.0.1:1' })).status, 403);
    assert.equal((await hostPost(session, '/api/desktop/control', { intent: 'DELETE_COMPANY' })).status, 400);
  });

  test('an authenticated Stop arms the controller; nothing stops until the window redeems the ticket', async () => {
    const r = await hostPost(session, '/api/desktop/control', { intent: 'STOP' });
    assert.equal(r.status, 200, r.body);
    assert.match(String(r.json.controller), /^http:\/\/127\.0\.0\.1:\d+\/desktop$/);
    assert.match(String(r.json.ticket), /^[A-Za-z0-9_-]{43}$/);
    ticket = String(r.json.ticket);
    secrets.push(ticket);
    ctlPort = portOf(String(r.json.controller));
    assert.notEqual(ctlPort, session.port);
    // One controller per workspace.
    const second = await hostPost(session, '/api/desktop/control', { intent: 'RESTART' });
    assert.equal(second.status, 409);
    assert.equal(second.json.code, 'DESKTOP_CONTROL_BUSY');
    assert.equal((await discoverHost(ws)).state, 'RUNNING');
  });

  test('the controller refuses every request that is not its own window, and serves nothing of the Company', async () => {
    const page = await request(ctlPort, 'GET', '/desktop');
    assert.equal(page.status, 200);
    assert.match(page.body, /Company control/);
    for (const p of ['/', '/index.html', '/launch', '/app/app/main.js', '/api/universe', '/api/session', '/host/identity', '/desktop.html/../index.html']) assert.equal((await request(ctlPort, 'GET', p)).status, 404, p);
    // DNS rebinding / another name for loopback.
    assert.equal((await request(ctlPort, 'GET', '/desktop', { Host: `localhost:${ctlPort}` })).status, 403);
    assert.equal((await ctl(ctlPort, '/desktop/redeem', { ticket }, undefined, { Host: `evil.example:${ctlPort}` })).status, 403);
    // Another loopback port (a local page — even the Command Center's own origin) or another site.
    const sameSite = await ctl(ctlPort, '/desktop/redeem', { ticket }, undefined, { Origin: session.origin, 'Sec-Fetch-Site': 'same-site' });
    assert.equal(sameSite.json.code, 'NOT_SAME_ORIGIN');
    assert.equal((await ctl(ctlPort, '/desktop/redeem', { ticket }, undefined, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await ctl(ctlPort, '/desktop/redeem', { ticket }, undefined, { Origin: 'https://evil.example' })).json.code, 'ORIGIN_NOT_CONTROLLER');
    // A client that omits the browser's fetch metadata is refused, not trusted.
    const noMeta = await request(ctlPort, 'POST', '/desktop/redeem', { Origin: `http://127.0.0.1:${ctlPort}`, 'Content-Type': 'application/json' }, JSON.stringify({ ticket }));
    assert.equal(noMeta.json.code, 'NOT_SAME_ORIGIN');
    // A simple (preflight-free) form post, and the preflight itself.
    assert.equal((await ctl(ctlPort, '/desktop/redeem', { ticket }, undefined, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await request(ctlPort, 'OPTIONS', '/desktop/redeem', { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' })).status, 405);
    // No act without the control key; a wrong ticket is refused and consumes nothing.
    for (const p of ['/desktop/act', '/desktop/status', '/desktop/enter', '/desktop/watch']) assert.equal((await ctl(ctlPort, p, { action: 'STOP' })).json.code, 'CONTROL_KEY_INVALID', p);
    assert.equal((await ctl(ctlPort, '/desktop/act', { action: 'STOP' }, 'A'.repeat(43))).json.code, 'CONTROL_KEY_INVALID');
    assert.equal((await ctl(ctlPort, '/desktop/redeem', { ticket: 'B'.repeat(43) })).json.code, 'TICKET_INVALID');
    assert.equal((await discoverHost(ws)).state, 'RUNNING');
  });

  test('the window redeems once; the ticket cannot be replayed; the canonical controlled stop runs and the window stays usable', async () => {
    const preStop = session;
    const r = await ctl(ctlPort, '/desktop/redeem', { ticket });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.intent, 'STOP');
    key = String(r.json.key);
    secrets.push(key);
    assert.equal((await ctl(ctlPort, '/desktop/redeem', { ticket })).json.code, 'TICKET_SPENT');
    const w = watch(ctlPort, key);
    const stopped = await w.until('STOPPED');
    assert.equal(stopped.state, 'STOPPED');
    assert.ok(w.phases.includes('STOPPING'), w.phases.join(' → '));
    assert.equal((await discoverHost(ws)).state, 'STOPPED');
    // The old Command Center origin is gone with its host; its Founder sessions were revoked by the stop.
    assert.equal(await request(session.port, 'GET', '/api/session', { Cookie: session.cookie }).then(() => 'answered', () => 'gone'), 'gone');
    // The window stays usable: a status read while stopped.
    const status = await ctl(ctlPort, '/desktop/status', {}, key);
    assert.equal(status.json.phase, 'STOPPED');
    assert.equal(fingerprint(), before);
    // Start: STARTING → READY only on the canonical health; a wrong key starts nothing.
    assert.equal((await ctl(ctlPort, '/desktop/act', { action: 'START' }, 'C'.repeat(43))).status, 403);
    assert.equal((await ctl(ctlPort, '/desktop/act', { action: 'START' }, key)).status, 202);
    const ready = await w.until('READY');
    assert.equal(ready.state, 'RUNNING');
    assert.ok(w.phases.includes('STARTING'), w.phases.join(' → '));
    const host = await discoverHost(ws);
    assert.equal(host.state, 'RUNNING');
    assert.equal(host.runtimeState, 'READY');
    // Back into the SAME Company through the canonical single-use launch token → a valid Founder session.
    const entered = await ctl(ctlPort, '/desktop/enter', {}, key);
    assert.equal(entered.status, 200, entered.body);
    const launch = new URL(String(entered.json.launchUrl));
    assert.equal(launch.origin, host.origin);
    assert.equal(launch.pathname, '/launch');
    secrets.push(launch.hash.slice(1));
    w.close();
    assert.equal(await controllerGone(ctlPort), true, 'the controller exits once the window is back');
    const port = portOf(launch.origin);
    const redeemed = await request(port, 'POST', '/api/session/launch', { Origin: launch.origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, JSON.stringify({ token: launch.hash.slice(1) }));
    assert.equal(redeemed.status, 200);
    session = { origin: launch.origin, port, cookie: `${SESSION_COOKIE}=${redeemed.cookies[SESSION_COOKIE]}; ${CSRF_COOKIE}=${redeemed.cookies[CSRF_COOKIE]}`, csrf: redeemed.cookies[CSRF_COOKIE] as string };
    assert.equal((await request(port, 'GET', '/api/session', { Cookie: session.cookie })).status, 200);
    // The stop revoked every Founder session it had: the pre-stop session is refused by the new host too.
    assert.equal((await request(port, 'GET', '/api/session', { Cookie: preStop.cookie })).status, 401);
    // The launch token was single-use.
    assert.equal((await request(port, 'POST', '/api/session/launch', { Origin: launch.origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, JSON.stringify({ token: launch.hash.slice(1) }))).status, 401);
    assert.equal(fingerprint(), before);
  });

  test('Restart from inside the window: RESTARTING through a controlled stop to the canonical READY, then back in', async () => {
    const instanceBefore = (await discoverHost(ws)).instanceId;
    const r = await hostPost(session, '/api/desktop/control', { intent: 'RESTART' });
    assert.equal(r.status, 200, r.body);
    const port = portOf(String(r.json.controller));
    secrets.push(String(r.json.ticket));
    const redeemed = await ctl(port, '/desktop/redeem', { ticket: r.json.ticket });
    assert.equal(redeemed.json.intent, 'RESTART');
    secrets.push(String(redeemed.json.key));
    const w = watch(port, String(redeemed.json.key));
    await w.until('READY');
    assert.ok(w.phases.includes('RESTARTING'), w.phases.join(' → '));
    assert.ok(!w.phases.includes('STOPPED'), 'a restart never reports a resting STOPPED');
    const host = await discoverHost(ws);
    assert.equal(host.state, 'RUNNING');
    assert.notEqual(host.instanceId, instanceBefore);
    const entered = await ctl(port, '/desktop/enter', {}, String(redeemed.json.key));
    const launch = new URL(String(entered.json.launchUrl));
    secrets.push(launch.hash.slice(1));
    w.close();
    assert.equal(await controllerGone(port), true);
    const lp = portOf(launch.origin);
    const s = await request(lp, 'POST', '/api/session/launch', { Origin: launch.origin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, JSON.stringify({ token: launch.hash.slice(1) }));
    assert.equal(s.status, 200);
    session = { origin: launch.origin, port: lp, cookie: `${SESSION_COOKIE}=${s.cookies[SESSION_COOKIE]}; ${CSRF_COOKIE}=${s.cookies[CSRF_COOKIE]}`, csrf: s.cookies[CSRF_COOKIE] as string };
    assert.equal(fingerprint(), before);
  });

  test('closing the window (X) never stops a running Company; closing it while stopped ends the controller and starts nothing', async () => {
    // An armed controller whose window never arrives: the Company keeps running (exercised here by abandoning a ticket).
    const abandoned = await hostPost(session, '/api/desktop/control', { intent: 'STOP' });
    assert.equal(abandoned.status, 200);
    secrets.push(String(abandoned.json.ticket));
    assert.equal((await discoverHost(ws)).state, 'RUNNING');
    // The window closes after a Stop: the controller exits after its grace, the Company stays stopped (an explicit choice).
    const port = portOf(String(abandoned.json.controller));
    const redeemed = await ctl(port, '/desktop/redeem', { ticket: abandoned.json.ticket });
    secrets.push(String(redeemed.json.key));
    const w = watch(port, String(redeemed.json.key));
    await w.until('STOPPED');
    w.close();
    assert.equal(await controllerGone(port, 40_000), true, 'the controller ends with its window');
    assert.equal((await discoverHost(ws)).state, 'STOPPED');
    // Reopen (the Desktop shortcut's `open`), then reopen again: exactly one host, the same Company. (Concurrent launchers
    // are separate processes; that path is proven by founder-host-lifecycle.)
    const opened = [await openCompany(ws, start), await openCompany(ws, start)];
    for (const o of opened) assert.equal(o.ok, true, JSON.stringify({ outcome: o.outcome, state: o.status.state, reason: o.status.reason }));
    for (const o of opened) secrets.push(new URL(o.launchUrl as string).hash.slice(1));
    assert.equal(new Set(opened.map((o) => o.status.instanceId)).size, 1);
    assert.equal((await discoverHost(ws)).state, 'RUNNING');
    assert.equal(fingerprint(), before);
  });

  test('D-D2-01 /launch exception: a same-site page may only LOAD the static launch page; it obtains, redeems and changes nothing', async () => {
    const host = await discoverHost(ws);
    const port = host.port as number;
    const nav = { 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
    // The returning window's navigation loads the static page — no token, no cookie, no session in the response.
    const page = await request(port, 'GET', '/launch', nav);
    assert.equal(page.status, 200);
    assert.match(page.body, /Opening the Company/);
    assert.deepEqual(page.cookies, {});
    assert.doesNotMatch(page.body, /[A-Za-z0-9_-]{43}/, 'the page carries no token');
    // Everything else a same-site (unrelated local) origin might try stays refused.
    for (const p of ['/', '/index.html', '/api/session', '/api/universe', '/app/app/launch.js', '/launch.html']) assert.equal((await request(port, 'GET', p, nav)).json.code, 'CROSS_SITE_REQUEST', p);
    assert.equal((await request(port, 'GET', '/launch', { ...nav, 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' })).status, 403, 'a fetch from another port cannot read it');
    assert.equal((await request(port, 'GET', '/launch', { ...nav, 'Sec-Fetch-Dest': 'iframe' })).status, 403, 'it cannot be framed');
    assert.equal((await request(port, 'GET', '/launch', { ...nav, 'Sec-Fetch-Site': 'cross-site' })).status, 403, 'an internet site cannot load it');
    assert.equal((await request(port, 'GET', '/launch', { ...nav, Host: `evil.example:${port}` })).status, 403, 'DNS rebinding');
    // A valid, unspent launch token cannot be redeemed from another origin (same-site or not) — only by the page itself.
    const opened = await openCompany(ws, start);
    const token = new URL(opened.launchUrl as string).hash.slice(1);
    secrets.push(token);
    const body = JSON.stringify({ token });
    const json = { 'Content-Type': 'application/json' };
    assert.equal((await request(port, 'POST', '/api/session/launch', { ...json, Origin: 'http://127.0.0.1:9', 'Sec-Fetch-Site': 'same-site' }, body)).status, 403);
    assert.equal((await request(port, 'POST', '/api/session/launch', { ...json, Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' }, body)).status, 403);
    assert.equal((await request(port, 'POST', '/api/session/launch', { ...json, Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, body)).status, 403);
    assert.equal((await request(port, 'POST', '/api/session/launch', { 'Content-Type': 'text/plain', Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' }, body)).status, 415);
    // ...and lifecycle control stays session + CSRF only, even for a navigation-shaped same-site request.
    assert.equal((await request(port, 'POST', '/api/desktop/control', { ...json, ...nav, Origin: 'http://127.0.0.1:9' }, JSON.stringify({ intent: 'STOP' }))).status, 403);
    assert.equal((await request(port, 'GET', '/api/desktop/status', nav)).status, 403);
    assert.equal((await discoverHost(ws)).state, 'RUNNING');
    // The token was never spent by those attempts: the real page (same origin) still redeems it, once.
    const ok = await request(port, 'POST', '/api/session/launch', { ...json, Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' }, body);
    assert.equal(ok.status, 200);
  });

  test('no ticket, control key or launch token ever reaches the host log', () => {
    const log = readFileSync(hostPaths(ws).log, 'utf8');
    assert.ok(log.includes('desktop_control.phase'), 'the controller logs its content-free phases');
    for (const s of secrets) assert.ok(!log.includes(s), 'a secret reached the host log');
  });
});
