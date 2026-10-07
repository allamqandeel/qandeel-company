/**
 * OPS — the Founder host's discovery and control boundary, in process: the descriptor carries a public key only and a
 * signature proves the host (a squatter on a freed port cannot pass); the two host-control routes pass the existing
 * origin gate, carry and create no Founder session, and a controlled stop needs the one-shot workspace proof (no replay);
 * discovery tells RUNNING / STOPPED / STALE / HELD / FOREIGN_RUNTIME / UNHEALTHY / WORKSPACE_* apart without trusting a
 * PID, a port or a file alone, and never creates a Company.
 * OPS-PROOF: founder-host-descriptor
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CompanyRuntime } from '@qandeel-company/runtime';
import { CompanyStore } from '@qandeel-company/storage';

import { FounderSurface } from '../src/index.js';
import { HOST_IDENTITY_PATH, HOST_STOP_PATH, HostIdentity, consumeStopRequest, hostPaths, newNonce, readDescriptor, verifyIdentityProof, writeJsonAtomic, writeStopRequest } from '../src/host/descriptor.js';
import { DISCOVERY_SETTLE_MS, discoverHost, ensureRunning, noticeFor, settleDiscovery, stopHost, type HostStatus } from '../src/host/lifecycle.js';
import { probeIdentity } from '../src/host/probe.js';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'command-center-ui');
const roots = { app: path.join(uiRoot, 'dist', 'src'), public: path.join(uiRoot, 'public') };
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(path.join(tmpdir(), 'qc-host-'));
  dirs.push(d);
  return d;
};
const company = (): string => {
  const ws = path.join(tmp(), 'company');
  CompanyStore.open(ws).close();
  return ws;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function raw(port: number, method: string, pathname: string, headers: Record<string, string>, body?: string): Promise<{ status: number; body: string; setCookie: string[] | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers, setHost: false, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), setCookie: res.headers['set-cookie'] }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function hostSurface(ws: string, onStop?: () => void): Promise<FounderSurface> {
  let surface: FounderSurface | null = null;
  surface = new FounderSurface({ workspace: ws, roots, briefing: false, runtime: { watchWakeFile: false }, host: { onStopRequested: () => (onStop ? onStop() : void surface?.stop()) } });
  await surface.start();
  return surface;
}

describe('host descriptor and identity proof', () => {
  test('the descriptor holds a public key only; a signature proves the instance, nothing else verifies', () => {
    const identity = new HostIdentity('11111111-2222-4333-8444-555555555555');
    const d = identity.descriptor(4242, 50123, '2026-10-07T00:00:00.000Z');
    assert.deepEqual(Object.keys(d).sort(), ['instanceId', 'pid', 'port', 'publicKey', 'startedAt', 'version']);
    const text = JSON.stringify(d) + JSON.stringify(identity);
    assert.doesNotMatch(text, /PRIVATE|BEGIN|pkcs8/i);
    const nonce = newNonce();
    const proof = identity.prove(50123, nonce);
    assert.equal(verifyIdentityProof(d, nonce, proof), true);
    assert.equal(verifyIdentityProof(d, newNonce(), proof), false, 'another nonce');
    assert.equal(verifyIdentityProof({ ...d, port: 50124 }, nonce, proof), false, 'another port');
    assert.equal(verifyIdentityProof(d, nonce, { ...proof, instanceId: '99999999-2222-4333-8444-555555555555' }), false, 'another instance');
    const impostor = new HostIdentity(d.instanceId);
    assert.equal(verifyIdentityProof(d, nonce, impostor.prove(50123, nonce)), false, 'a key that is not the descriptor key');
    assert.equal(verifyIdentityProof(d, nonce, { instanceId: d.instanceId, signature: 'AAAA' }), false);
  });

  test('a torn or foreign descriptor is stale metadata, never a host', () => {
    const paths = hostPaths(company());
    assert.equal(readDescriptor(paths), null);
    writeFileSync(paths.descriptor, '{"version":1,"instanceId":"x"', 'utf8');
    assert.equal(readDescriptor(paths), undefined);
    writeJsonAtomic(paths.descriptor, { version: 1, instanceId: 'not-a-uuid', pid: 1, port: 1, startedAt: 'x', publicKey: 'x' });
    assert.equal(readDescriptor(paths), undefined);
  });

  test('a stop request is one-shot and bound to its instance', () => {
    const paths = hostPaths(company());
    const id = '11111111-2222-4333-8444-555555555555';
    const requestId = writeStopRequest(paths, id);
    assert.equal(consumeStopRequest(paths, '99999999-2222-4333-8444-555555555555', requestId), false, 'another instance');
    assert.equal(consumeStopRequest(paths, id, newNonce()), false, 'another request');
    assert.equal(consumeStopRequest(paths, id, 'short'), false);
    assert.equal(existsSync(paths.stopRequest), true, 'a refused request is not consumed');
    assert.equal(consumeStopRequest(paths, id, requestId), true);
    assert.equal(existsSync(paths.stopRequest), false);
    assert.equal(consumeStopRequest(paths, id, requestId), false, 'no replay');
  });
});

describe('host-control routes on the existing listener', () => {
  test('identity: signed, gated by the loopback origin rules, no session created; stop: one-shot proof + exact Origin', async () => {
    const ws = company();
    let stops = 0;
    const surface = await hostSurface(ws, () => {
      stops++;
    });
    try {
      const port = surface.listener.port;
      const host = `127.0.0.1:${port}`;
      const d = readDescriptor(hostPaths(ws));
      assert.ok(d && d.instanceId === surface.runtime.instanceId && d.port === port && d.pid === process.pid);
      const nonce = newNonce();
      const ok = await probeIdentity(port, nonce);
      assert.equal(ok?.status, 200);
      assert.equal(verifyIdentityProof(d, nonce, ok?.body ?? {}), true);
      assert.equal((await raw(port, 'GET', `${HOST_IDENTITY_PATH}?nonce=abc`, { Host: host })).status, 400);
      assert.equal((await raw(port, 'GET', `${HOST_IDENTITY_PATH}?nonce=${nonce}`, { Host: 'evil.example:80' })).status, 403, 'DNS-rebinding Host');
      assert.equal((await raw(port, 'GET', `${HOST_IDENTITY_PATH}?nonce=${nonce}`, { Host: host, 'Sec-Fetch-Site': 'cross-site' })).status, 403, 'cross-site fetch');
      const identity = await raw(port, 'GET', `${HOST_IDENTITY_PATH}?nonce=${nonce}`, { Host: host });
      assert.equal(identity.setCookie, undefined, 'discovery issues no cookie');
      assert.equal((await raw(port, 'GET', '/api/universe', { Host: host })).status, 401, 'Founder reads still need a session');

      const paths = hostPaths(ws);
      const json = { Host: host, 'Content-Type': 'application/json' };
      const requestId = writeStopRequest(paths, d.instanceId);
      const body = JSON.stringify({ requestId });
      assert.equal((await raw(port, 'POST', HOST_STOP_PATH, json, body)).status, 403, 'no Origin');
      assert.equal((await raw(port, 'POST', HOST_STOP_PATH, { ...json, Origin: 'http://evil.example' }, body)).status, 403, 'foreign Origin');
      assert.equal((await raw(port, 'POST', HOST_STOP_PATH, { Host: host, Origin: `http://${host}`, 'Content-Type': 'text/plain' }, body)).status, 415);
      assert.equal((await raw(port, 'POST', HOST_STOP_PATH, { ...json, Origin: `http://${host}` }, JSON.stringify({ requestId: newNonce() }))).status, 403, 'a guessed request id');
      assert.equal(stops, 0);
      const accepted = await raw(port, 'POST', HOST_STOP_PATH, { ...json, Origin: `http://${host}` }, body);
      assert.equal(accepted.status, 202);
      assert.equal(accepted.setCookie, undefined);
      await new Promise((r) => setImmediate(r));
      assert.equal(stops, 1);
      assert.equal((await raw(port, 'POST', HOST_STOP_PATH, { ...json, Origin: `http://${host}` }, body)).status, 403, 'replay');
      assert.equal((await raw(port, 'GET', HOST_STOP_PATH, { Host: host })).status, 405);
    } finally {
      await surface.stop();
    }
    assert.equal(readDescriptor(hostPaths(ws)), null, 'a stopped host unpublishes itself');
  });

  test('without the host role the routes do not exist', async () => {
    const ws = company();
    const surface = new FounderSurface({ workspace: ws, roots, briefing: false, runtime: { watchWakeFile: false } });
    await surface.start();
    try {
      const port = surface.listener.port;
      assert.equal((await raw(port, 'GET', `${HOST_IDENTITY_PATH}?nonce=${newNonce()}`, { Host: `127.0.0.1:${port}` })).status, 404);
      assert.equal(readDescriptor(hostPaths(ws)), null);
    } finally {
      await surface.stop();
    }
  });
});

describe('discovery', () => {
  test('a missing or non-Company directory is refused and nothing is created', async () => {
    const root = tmp();
    assert.equal((await discoverHost(path.join(root, 'nope'))).state, 'WORKSPACE_MISSING');
    const empty = path.join(root, 'empty');
    mkdirSync(empty);
    const s = await discoverHost(empty);
    assert.equal(s.state, 'WORKSPACE_INVALID');
    const r = await ensureRunning(empty, { cliPath: path.join(root, 'no-such-cli.js'), providers: [] });
    assert.equal(r.code, 'WORKSPACE_INVALID');
    assert.equal(existsSync(path.join(empty, 'state')), false, 'the launcher never seeds a new Company');
  });

  test('STOPPED, RUNNING, controlled stop and STALE are told apart', async () => {
    const ws = company();
    assert.equal((await discoverHost(ws)).state, 'STOPPED');
    const surface = await hostSurface(ws);
    const running = await discoverHost(ws);
    assert.equal(running.state, 'RUNNING');
    assert.equal(running.instanceId, surface.runtime.instanceId);
    assert.equal(running.origin, surface.origin);
    const stopped = await stopHost(ws, { timeoutMs: 20_000 });
    assert.equal(stopped.outcome, 'STOPPED');
    assert.equal(surface.runtime.state, 'STOPPED');
    assert.equal((await discoverHost(ws)).state, 'STOPPED');
    assert.equal((await stopHost(ws)).outcome, 'NOT_RUNNING');
    // A descriptor left by a host that died (no live lease): stale metadata, startable.
    writeJsonAtomic(hostPaths(ws).descriptor, new HostIdentity('11111111-2222-4333-8444-555555555555').descriptor(999_999, 1, new Date().toISOString()));
    const stale = await discoverHost(ws);
    assert.equal(stale.state, 'STALE');
    assert.equal(stale.leaseLive, false);
  });

  test('a squatter on the descriptor port (PID / port reuse) cannot pass for the host', async () => {
    const ws = company();
    const surface = await hostSurface(ws);
    const squatter = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, instanceId: surface.runtime.instanceId, signature: Buffer.alloc(64).toString('base64') }));
    });
    await new Promise<void>((r) => squatter.listen(0, '127.0.0.1', () => r()));
    try {
      const paths = hostPaths(ws);
      const d = readDescriptor(paths);
      assert.ok(d);
      writeJsonAtomic(paths.descriptor, { ...d, port: (squatter.address() as AddressInfo).port });
      const s = await discoverHost(ws);
      assert.equal(s.state, 'UNHEALTHY');
      assert.equal(s.reason, 'HOST_IDENTITY_MISMATCH');
      writeJsonAtomic(paths.descriptor, d);
      assert.equal((await discoverHost(ws)).state, 'RUNNING');
    } finally {
      squatter.close();
      await surface.stop();
    }
  });

  test('D-OPS-09: only a possibly-settling UNHEALTHY is re-read, within a bound; healthy and squatter readings are not', async () => {
    const reading = (state: HostStatus['state'], reason: string | null): HostStatus => ({ state, workspace: 'w', instanceId: null, pid: null, port: null, origin: null, runtimeState: null, leaseLive: true, descriptor: 'VALID', hold: null, reason });
    const scripted = (...seq: HostStatus[]): { classify: () => Promise<HostStatus>; calls: () => number } => {
      let n = 0;
      return { classify: async () => seq[Math.min(n++, seq.length - 1)] as HostStatus, calls: () => n };
    };
    // A healthy host is answered by its first reading: never delayed.
    const healthy = scripted(reading('RUNNING', null));
    assert.equal((await settleDiscovery(healthy.classify, 1_000, 10)).state, 'RUNNING');
    assert.equal(healthy.calls(), 1);
    // A squatter (wrong identity) is reported at once.
    const squat = scripted(reading('UNHEALTHY', 'HOST_IDENTITY_MISMATCH'), reading('STALE', 'HOST_PROCESS_GONE'));
    assert.equal((await settleDiscovery(squat.classify, 1_000, 10)).reason, 'HOST_IDENTITY_MISMATCH');
    assert.equal(squat.calls(), 1);
    // A holder disappearing right now: the store briefly unreadable, or the holder not yet gone, settles to STALE.
    for (const reason of ['STORAGE_BUSY', 'UNCLASSIFIED_ERROR', 'HOST_NOT_ANSWERING']) {
      const dying = scripted(reading('UNHEALTHY', reason), reading('UNHEALTHY', reason), reading('STALE', 'HOST_PROCESS_GONE'));
      assert.equal((await settleDiscovery(dying.classify, 1_000, 10)).state, 'STALE', reason);
      assert.equal(dying.calls(), 3);
    }
    // A holder that stays unhealthy is reported UNHEALTHY once the short bound is spent: no long retry loop.
    const stuck = scripted(reading('UNHEALTHY', 'HOST_NOT_ANSWERING'));
    const t0 = Date.now();
    assert.equal((await settleDiscovery(stuck.classify, 300, 50)).state, 'UNHEALTHY');
    assert.ok(Date.now() - t0 < 1_000 && stuck.calls() <= 8, `bounded: ${stuck.calls()} readings`);
  });

  test('D-OPS-09: a genuinely live holder whose surface does not answer stays UNHEALTHY and no second runtime starts', async () => {
    const ws = company();
    const surface = await hostSurface(ws);
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const hung = http.createServer(() => undefined); // accepts, never answers
    await new Promise<void>((r) => hung.listen(0, '127.0.0.1', () => r()));
    try {
      const paths = hostPaths(ws);
      const d = readDescriptor(paths);
      assert.ok(d);
      for (const port of [deadPort, (hung.address() as AddressInfo).port]) {
        writeJsonAtomic(paths.descriptor, { ...d, port });
        const t0 = Date.now();
        const s = await discoverHost(ws);
        assert.equal(s.state, 'UNHEALTHY', JSON.stringify(s));
        assert.equal(s.reason, 'HOST_NOT_ANSWERING');
        assert.equal(s.instanceId, surface.runtime.instanceId, 'the live lease holder is kept, never ignored');
        assert.ok(Date.now() - t0 < DISCOVERY_SETTLE_MS + 4_000, 'bounded');
        const r = await ensureRunning(ws, { cliPath: path.join(ws, 'no-such-cli.js'), providers: [] });
        assert.equal(r.code, 'HOST_UNHEALTHY');
        assert.equal(r.started, false);
        assert.equal(existsSync(paths.log), false, 'no second host was spawned');
        assert.equal(surface.runtime.state, 'READY', 'the live holder is untouched');
      }
      writeJsonAtomic(paths.descriptor, d);
      assert.equal((await discoverHost(ws)).state, 'RUNNING');
    } finally {
      hung.closeAllConnections();
      hung.close();
      await surface.stop();
    }
  });

  test('a live runtime without the Founder surface is FOREIGN_RUNTIME: never a second runtime beside it', async () => {
    const ws = company();
    const runtime = new CompanyRuntime({ workspace: ws, processors: [], supervisorTtlMs: 600_000, watchWakeFile: false });
    await runtime.start();
    try {
      const soon = await discoverHost(ws);
      assert.equal(soon.state, 'STARTING', 'just READY: may still be publishing its surface');
      const later = await discoverHost(ws, () => Date.now() + 120_000);
      assert.equal(later.state, 'FOREIGN_RUNTIME');
      assert.equal(later.instanceId, runtime.instanceId);
    } finally {
      await runtime.stop();
    }
  });

  test('an update or restore hold is reported and blocks a start before any process is spawned', async () => {
    const ws = company();
    mkdirSync(path.join(ws, 'maintenance'), { recursive: true });
    writeFileSync(path.join(ws, 'maintenance', 'UPDATE_HOLD.json'), JSON.stringify({ updateId: 'u1', code: 'VERIFY_FAILED', fromVersion: 20, toVersion: 21, at: new Date().toISOString() }));
    const s = await discoverHost(ws);
    assert.equal(s.state, 'HELD');
    assert.equal(s.hold, 'VERIFY_FAILED');
    const r = await ensureRunning(ws, { cliPath: path.join(ws, 'no-such-cli.js'), providers: [] });
    assert.equal(r.code, 'UPDATE_HOLD');
    assert.equal(existsSync(hostPaths(ws).log), false, 'no host was spawned');
    writeFileSync(path.join(ws, 'maintenance', 'UPDATE_HOLD.json'), JSON.stringify({ updateId: 'u2', code: 'RESTORE_IN_PROGRESS', fromVersion: 0, toVersion: 21, at: '' }));
    assert.equal((await ensureRunning(ws, { cliPath: 'x', providers: [] })).code, 'RESTORE_IN_PROGRESS');
  });

  test('every Founder outcome has a bounded, content-free bilingual notice', () => {
    for (const code of ['NOT_CONFIGURED', 'WORKSPACE_MISSING', 'WORKSPACE_INVALID', 'UPDATE_HOLD', 'RESTORE_IN_PROGRESS', 'RESTORE_CHECK_COPY', 'HOST_UNHEALTHY', 'HOST_UNRESPONSIVE', 'FOREIGN_RUNTIME', 'BROWSER_UNAVAILABLE', 'BROWSER_HANDOFF_TIMEOUT', 'RUNTIME_RELEASE_REFUSED', 'HOST_START_TIMEOUT', 'HOST_START_FAILED', 'PROVIDER_NOT_READY', 'STOPPED', 'NOT_RUNNING', 'TERMINATED', 'HOST_STOP_TIMEOUT']) {
      const n = noticeFor('open', code);
      assert.ok(n, code);
      assert.match(n.message, /[؀-ۿ]/, `${code}: Arabic line`);
      assert.match(n.message, new RegExp(`\\(${code}\\)$`));
      assert.ok(n.message.length < 400);
    }
    assert.equal(noticeFor('open', 'OPENED'), null, 'a normal open shows no dialog');
    assert.ok(readFileSync(fileURLToPath(import.meta.url), 'utf8').includes('OPS-PROOF'));
  });
});
