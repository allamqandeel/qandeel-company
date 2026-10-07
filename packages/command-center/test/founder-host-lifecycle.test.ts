/**
 * OPS — the Founder host lifecycle with real processes: the launcher starts ONE detached host (the existing `serve`) only
 * when none runs, reuses it on reopen and under concurrent launches, keeps it running after the launcher exits, stops it
 * through the controlled path (durable state kept, instance STOPPED), restarts it, and after an abnormal termination the
 * next launch performs the runtime's own startup recovery (the dead instance is ABANDONED by the new supervisor). Every
 * session still begins with the canonical single-use launch token; Founder reads need the session and writes the CSRF
 * secret; the host listens on loopback only; neither the descriptor nor the host log carries a token or a key.
 *
 * D-OPS-07 (adversarial): the browser process is given ONLY the one-shot loopback handoff address — its command line
 * carries no launch credential. A forged, cross-site, rebound or non-navigation request to the handoff is refused and
 * mints nothing; the real navigation receives the token as a redirect to the canonical /launch page, exactly once; a
 * browser that never arrives leaves no token minted at all.
 * OPS-PROOF: founder-host-lifecycle
 * OPS-PROOF: founder-launch-handoff
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CompanyStore } from '@qandeel-company/storage';

import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '../src/index.js';
import { hostPaths, readDescriptor } from '../src/host/descriptor.js';
import { classifyHost, discoverHost, openCompany, restartHost, stopHost } from '../src/host/lifecycle.js';
import { pidAlive } from '../src/host/processes.js';

// <root>/packages/command-center/dist/test/x.test.js → the compiled CLI the shortcuts run
const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const root = mkdtempSync(path.join(tmpdir(), 'qc-host-life-'));
const ws = path.join(root, 'company');
CompanyStore.open(ws).close();
const start = { cliPath, providers: [] as string[], browser: false };

after(async () => {
  await stopHost(ws, { force: true, timeoutMs: 30_000 });
  rmSync(root, { recursive: true, force: true });
});

function request(origin: string, method: string, pathname: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; body: string; cookies: Record<string, string>; location: string | null }> {
  const u = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: Number(u.port), method, path: pathname, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const cookies: Record<string, string> = {};
        for (const c of res.headers['set-cookie'] ?? []) {
          const [kv] = c.split(';');
          const i = (kv ?? '').indexOf('=');
          if (i > 0) cookies[(kv ?? '').slice(0, i)] = (kv ?? '').slice(i + 1);
        }
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), cookies, location: typeof res.headers.location === 'string' ? res.headers.location : null });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function redeem(launchUrl: string): Promise<{ status: number; cookies: Record<string, string>; body: string }> {
  const u = new URL(launchUrl);
  const token = u.hash.slice(1);
  return request(u.origin, 'POST', '/api/session/launch', { Origin: u.origin, 'Content-Type': 'application/json' }, JSON.stringify({ token }));
}

const instance = (id: string): { state: string } | null => {
  const store = CompanyStore.open(ws, { create: false, migrationMode: 'verify' });
  try {
    return store.instance(id as never);
  } finally {
    store.close();
  }
};

const tokens: string[] = [];

const minted = (): number => {
  const store = CompanyStore.open(ws, { create: false, migrationMode: 'verify' });
  try {
    return store.auditByAction('founder.launch_minted', 10_000).length;
  } finally {
    store.close();
  }
};

/** The headers a browser sends for a top-level navigation the user started (typed, or a command-line --app URL). */
const NAVIGATION = { 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-User': '?1' };

describe('Founder host lifecycle (real processes)', { timeout: 240_000 }, () => {
  let firstInstance = '';
  let founderRef = '';

  test('cold start: one detached host; the canonical launch token opens one Founder session, once', async () => {
    const r = await openCompany(ws, start);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.outcome, 'STARTED');
    assert.equal(r.status.state, 'RUNNING');
    assert.ok(r.launchUrl && r.status.origin && r.status.instanceId && r.status.pid);
    assert.notEqual(r.status.pid, process.pid, 'the host is its own process, not the launcher');
    assert.match(r.status.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    firstInstance = r.status.instanceId;
    tokens.push(new URL(r.launchUrl).hash.slice(1));
    const origin = r.status.origin;
    assert.equal((await request(origin, 'GET', '/api/universe')).status, 401, 'no session, no Founder read');
    const session = await redeem(r.launchUrl);
    assert.equal(session.status, 200);
    founderRef = (JSON.parse(session.body) as { founderRef: string }).founderRef;
    assert.equal((await redeem(r.launchUrl)).status, 401, 'the launch token is single-use');
    const cookie = `${SESSION_COOKIE}=${session.cookies[SESSION_COOKIE]}; ${CSRF_COOKIE}=${session.cookies[CSRF_COOKIE]}`;
    assert.equal((await request(origin, 'GET', '/api/session', { Cookie: cookie })).status, 200);
    const json = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
    assert.equal((await request(origin, 'POST', '/api/threads', json, '{}')).status, 403, 'a state change without the CSRF secret');
    assert.notEqual((await request(origin, 'POST', '/api/threads', { ...json, [CSRF_HEADER]: session.cookies[CSRF_COOKIE] ?? '' }, '{}')).status, 403, 'with it, the request reaches the API');
  });

  test('reopen reuses the same host and mints a fresh token; concurrent launches never start a second host', async () => {
    const again = await openCompany(ws, start);
    assert.equal(again.outcome, 'REUSED');
    assert.equal(again.status.instanceId, firstInstance);
    assert.ok(again.launchUrl);
    tokens.push(new URL(again.launchUrl).hash.slice(1));
    assert.notEqual(tokens[1], tokens[0]);
    const many = await Promise.all([openCompany(ws, start), openCompany(ws, start), openCompany(ws, start)]);
    for (const m of many) {
      assert.equal(m.status.instanceId, firstInstance);
      assert.equal(m.started, false);
      if (m.launchUrl) tokens.push(new URL(m.launchUrl).hash.slice(1));
    }
  });

  test('the browser process is given only the one-shot loopback handoff: no launch credential in its command line', async () => {
    const commandLines: string[][] = [];
    let mintedWhenSpawned = -1;
    let navigation: Promise<{ status: number; location: string | null }> = Promise.resolve({ status: 0, location: null });
    const refused: number[] = [];
    const before = minted();
    // A recording browser: it receives exactly the argument vector the real opener gives Edge / Chrome, then behaves like
    // the browser — after a hostile local page and a forger have tried first.
    const recordingBrowser = async (url: string): Promise<{ ok: boolean; browser: string }> => {
      commandLines.push([`--app=${url}`]);
      mintedWhenSpawned = minted();
      navigation = (async () => {
        const u = new URL(url);
        refused.push((await request(u.origin, 'GET', '/')).status); // no fetch metadata: not a browser navigation
        refused.push((await request(u.origin, 'GET', '/', { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' })).status); // a web page navigating to it
        refused.push((await request(u.origin, 'GET', '/', { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' })).status); // a page's fetch
        refused.push((await request(u.origin, 'GET', '/', { ...NAVIGATION, Host: `rebound.example:${u.port}` })).status); // DNS rebinding
        refused.push((await request(u.origin, 'POST', '/', NAVIGATION, '{}')).status);
        refused.push((await request(u.origin, 'GET', '/launch', NAVIGATION)).status);
        return request(u.origin, 'GET', '/', NAVIGATION);
      })();
      return { ok: true, browser: 'recording' };
    };
    const r = await openCompany(ws, { ...start, browser: true, openBrowser: recordingBrowser });
    assert.equal(r.outcome, 'OPENED', JSON.stringify(r));
    assert.equal(r.launchUrl, undefined, 'no launch URL is returned or printed when a browser received it');
    const nav = await navigation;
    assert.deepEqual(refused, [403, 403, 403, 403, 403, 403], 'every non-navigation request is refused');
    assert.equal(nav.status, 303);
    assert.ok(nav.location !== null);
    const target = new URL(nav.location);
    assert.equal(target.origin, r.status.origin, 'the redirect goes to the canonical host');
    assert.equal(target.pathname, '/launch');
    const token = target.hash.slice(1);
    assert.match(token, /^[A-Za-z0-9_-]{20,}$/);
    tokens.push(token);
    // The browser's command line: the handoff address only — loopback, a port, "/" — and never the credential.
    assert.equal(commandLines.length, 1);
    const argv = (commandLines[0] ?? []).join(' ');
    assert.match(argv, /^--app=http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.ok(!argv.includes(token) && !argv.includes('#') && !argv.includes('?') && !argv.includes('/launch'), 'no launch credential in the browser process arguments');
    assert.equal(mintedWhenSpawned, before, 'no token exists yet when the browser process starts');
    assert.equal(minted(), before + 1, 'exactly one token, minted for the one real navigation');
    // The handed-over token is the canonical one: it opens one Founder session, once.
    assert.equal((await redeem(nav.location)).status, 200);
    assert.equal((await redeem(nav.location)).status, 401);
    // One-shot: the handoff is gone after delivery.
    await assert.rejects(request(new URL(argv.slice('--app='.length)).origin, 'GET', '/', NAVIGATION));
  });

  test('a browser that never arrives leaves no token minted (bounded BROWSER_HANDOFF_TIMEOUT)', async () => {
    const before = minted();
    const r = await openCompany(ws, { ...start, browser: true, openBrowser: async () => ({ ok: true, browser: 'absent' }), handoffTimeoutMs: 400 });
    assert.equal(r.ok, false);
    assert.equal(r.outcome, 'BROWSER_HANDOFF_TIMEOUT');
    assert.equal(minted(), before, 'nothing minted');
    const none = await openCompany(ws, { ...start, browser: true, openBrowser: async () => ({ ok: false, browser: null }) });
    assert.equal(none.outcome, 'BROWSER_UNAVAILABLE');
    assert.equal(minted(), before, 'nothing minted when no browser started');
  });

  test('the host keeps running without any launcher, listens on loopback only, and publishes no secret', async () => {
    const s = await discoverHost(ws);
    assert.equal(s.state, 'RUNNING');
    assert.ok(s.pid !== null && pidAlive(s.pid));
    const port = s.port ?? 0;
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (lan) {
      const reached = await new Promise<boolean>((resolve) => {
        const sock = net.connect({ host: lan, port, timeout: 2_000 }, () => {
          sock.destroy();
          resolve(true);
        });
        sock.on('error', () => resolve(false));
        sock.on('timeout', () => {
          sock.destroy();
          resolve(false);
        });
      });
      assert.equal(reached, false, 'the Founder surface is not reachable from the LAN address');
    }
    const descriptorText = readFileSync(hostPaths(ws).descriptor, 'utf8');
    const log = readFileSync(hostPaths(ws).log, 'utf8');
    for (const t of tokens) {
      assert.ok(!descriptorText.includes(t) && !log.includes(t), 'no launch token in the descriptor or the host log');
    }
    assert.doesNotMatch(descriptorText + log, /launch#|PRIVATE KEY|Bearer|vault:/);
  });

  test('controlled stop keeps durable state; restart starts exactly one new host on the same Company', async () => {
    const before = await discoverHost(ws);
    const stopped = await stopHost(ws);
    assert.equal(stopped.outcome, 'STOPPED', JSON.stringify(stopped));
    assert.equal(instance(firstInstance)?.state, 'STOPPED', 'a controlled shutdown, recorded durably');
    assert.equal(readDescriptor(hostPaths(ws)), null);
    const deadline = Date.now() + 15_000;
    while (before.pid !== null && pidAlive(before.pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    assert.equal(before.pid !== null && pidAlive(before.pid), false, 'the host process exited');
    const restarted = await restartHost(ws, start);
    assert.equal(restarted.outcome, 'STARTED');
    assert.notEqual(restarted.status.instanceId, firstInstance);
    assert.ok(restarted.launchUrl);
    const session = await redeem(restarted.launchUrl);
    assert.equal((JSON.parse(session.body) as { founderRef: string }).founderRef, founderRef, 'the same Company and Founder, not a new one');
  });

  test('after an abnormal termination the next launch runs the existing startup recovery', async (t) => {
    const live = await discoverHost(ws);
    assert.equal(live.state, 'RUNNING');
    const crashed = live.instanceId as string;
    process.kill(live.pid as number, 'SIGKILL'); // a controlled proof of a hard crash (TerminateProcess on Windows)
    const deadline = Date.now() + 15_000;
    while (pidAlive(live.pid as number) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    const diag = (s: Awaited<ReturnType<typeof discoverHost>>): string => JSON.stringify({ state: s.state, reason: s.reason, leaseLive: s.leaseLive, runtimeState: s.runtimeState, descriptor: s.descriptor, pid: s.pid, pidAlive: pidAlive(live.pid as number) });
    // D-OPS-09 evidence: the raw single reading right after the kill (it may still be settling) and, started at the same
    // moment, the settled discovery the launcher acts on.
    const [first, after] = await Promise.all([classifyHost(ws), discoverHost(ws)]);
    t.diagnostic(`raw reading after the kill: ${diag(first)}`);
    t.diagnostic(`settled reading: ${diag(after)}`);
    assert.equal(after.state, 'STALE', `a dead holder is never reported as running or unhealthy: ${diag(after)} (first: ${diag(first)})`);
    const r = await openCompany(ws, start);
    assert.equal(r.outcome, 'STARTED', JSON.stringify(r));
    assert.notEqual(r.status.instanceId, crashed);
    assert.equal(instance(crashed)?.state, 'ABANDONED', 'the new supervisor recovered the crashed instance');
    assert.equal((await stopHost(ws)).outcome, 'STOPPED');
    assert.equal(existsSync(hostPaths(ws).startLock), false);
  });
});
