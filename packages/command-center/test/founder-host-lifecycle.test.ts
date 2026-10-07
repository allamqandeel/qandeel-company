/**
 * OPS — the Founder host lifecycle with real processes: the launcher starts ONE detached host (the existing `serve`) only
 * when none runs, reuses it on reopen and under concurrent launches, keeps it running after the launcher exits, stops it
 * through the controlled path (durable state kept, instance STOPPED), restarts it, and after an abnormal termination the
 * next launch performs the runtime's own startup recovery (the dead instance is ABANDONED by the new supervisor). Every
 * session still begins with the canonical single-use launch token; Founder reads need the session and writes the CSRF
 * secret; the host listens on loopback only; neither the descriptor nor the host log carries a token or a key.
 * OPS-PROOF: founder-host-lifecycle
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
import { discoverHost, openCompany, restartHost, stopHost } from '../src/host/lifecycle.js';
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

function request(origin: string, method: string, pathname: string, headers: Record<string, string> = {}, body?: string): Promise<{ status: number; body: string; cookies: Record<string, string> }> {
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
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), cookies });
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

  test('after an abnormal termination the next launch runs the existing startup recovery', async () => {
    const live = await discoverHost(ws);
    assert.equal(live.state, 'RUNNING');
    const crashed = live.instanceId as string;
    process.kill(live.pid as number, 'SIGKILL'); // a controlled proof of a hard crash (TerminateProcess on Windows)
    const deadline = Date.now() + 15_000;
    while (pidAlive(live.pid as number) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    const after = await discoverHost(ws);
    assert.equal(after.state, 'STALE', 'a dead holder is never reported as running');
    const r = await openCompany(ws, start);
    assert.equal(r.outcome, 'STARTED', JSON.stringify(r));
    assert.notEqual(r.status.instanceId, crashed);
    assert.equal(instance(crashed)?.state, 'ABANDONED', 'the new supervisor recovered the crashed instance');
    assert.equal((await stopHost(ws)).outcome, 'STOPPED');
    assert.equal(existsSync(hostPaths(ws).startLock), false);
  });
});
