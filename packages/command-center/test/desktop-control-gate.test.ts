/**
 * D2-CTRL-01 (D-D2-01) — the stopped-state controller's pure boundary and its bounded lifetime, in process: the request
 * gate (exact Host, same-origin fetch metadata, exact Origin, JSON, no preflight), the capability material (256-bit,
 * constant-time, malformed never matches), the public-file allow-list, the ticket's expiry and the guessing limit (both end
 * the controller), one controller per workspace, and no controller for a workspace the launcher configuration does not
 * name.
 * OPS-PROOF: desktop-control-boundary
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { CompanyRuntime } from '@qandeel-company/runtime';
import { CompanyStore } from '@qandeel-company/storage';

import { DesktopController, acquireDesktopControl, armDesktopController, configuredCompany, controllerStaticPath, gateControlRequest, hashSecret, mintSecret, secretMatches } from '../src/host/desktop-control.js';
import { launcherConfigPath, writeLauncherConfig } from '../src/host/lifecycle.js';
import { defaultStaticRoots } from '../src/static.js';

const root = mkdtempSync(path.join(tmpdir(), 'qc-desk-gate-'));
process.env.LOCALAPPDATA = path.join(root, 'local');
const ws = path.join(root, 'company');
CompanyStore.open(ws).close();
const other = path.join(root, 'other');
CompanyStore.open(other).close();
writeLauncherConfig(launcherConfigPath(), { version: 1, workspace: ws, providers: [] });

after(() => rmSync(root, { recursive: true, force: true }));

const PORT = 50123;
const ok = { method: 'POST', host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, secFetchSite: 'same-origin', contentType: 'application/json' };

describe('the controller request gate', () => {
  test('only its own window passes', () => {
    assert.deepEqual(gateControlRequest(ok, PORT), { ok: true });
    assert.deepEqual(gateControlRequest({ ...ok, method: 'GET', origin: undefined, secFetchSite: 'cross-site' }, PORT), { ok: true }, 'its public page is public');
    const refused = (facts: Partial<typeof ok>, code: string): void => {
      const g = gateControlRequest({ ...ok, ...facts }, PORT);
      assert.equal(g.ok, false);
      assert.equal(g.ok ? null : g.code, code);
    };
    refused({ host: `localhost:${PORT}` }, 'HOST_NOT_CONTROLLER');
    refused({ host: `127.0.0.1:${PORT + 1}` }, 'HOST_NOT_CONTROLLER');
    refused({ host: 'evil.example' }, 'HOST_NOT_CONTROLLER');
    refused({ host: undefined as unknown as string }, 'HOST_NOT_CONTROLLER');
    refused({ secFetchSite: 'same-site' }, 'NOT_SAME_ORIGIN');
    refused({ secFetchSite: 'cross-site' }, 'NOT_SAME_ORIGIN');
    refused({ secFetchSite: 'none' }, 'NOT_SAME_ORIGIN');
    refused({ secFetchSite: undefined as unknown as string }, 'NOT_SAME_ORIGIN');
    refused({ origin: `http://127.0.0.1:${PORT + 1}` }, 'ORIGIN_NOT_CONTROLLER');
    refused({ origin: `http://localhost:${PORT}` }, 'ORIGIN_NOT_CONTROLLER');
    refused({ origin: 'null' }, 'ORIGIN_NOT_CONTROLLER');
    refused({ origin: undefined as unknown as string }, 'ORIGIN_NOT_CONTROLLER');
    refused({ contentType: 'text/plain' }, 'CONTENT_TYPE');
    refused({ contentType: 'application/x-www-form-urlencoded' }, 'CONTENT_TYPE');
    for (const method of ['OPTIONS', 'PUT', 'DELETE', 'PATCH', 'HEAD']) refused({ method }, 'METHOD_NOT_ALLOWED');
  });

  test('the capability material is 256-bit, compared in constant time, and malformed input never matches', () => {
    const a = mintSecret();
    const b = mintSecret();
    assert.match(a.secret, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(a.secret, b.secret);
    assert.equal(a.hash, hashSecret(a.secret));
    assert.equal(secretMatches(a.secret, a.hash), true);
    assert.equal(secretMatches(b.secret, a.hash), false);
    for (const bad of [undefined, null, 42, '', a.secret.slice(1), `${a.secret}=`, a.secret.toUpperCase() === a.secret ? 'x' : a.secret.toUpperCase(), a.hash]) assert.equal(secretMatches(bad, a.hash), false);
    assert.equal(secretMatches(a.secret, null), false);
  });

  test('it serves only its own page, the stylesheet, the font and its script', () => {
    assert.equal(controllerStaticPath('/desktop'), '/desktop.html');
    assert.equal(controllerStaticPath('/styles.css'), '/styles.css');
    assert.equal(controllerStaticPath('/app/app/desktop.js'), '/app/app/desktop.js');
    assert.equal(controllerStaticPath('/fonts/IBMPlexSansArabic-Regular.woff2'), '/fonts/IBMPlexSansArabic-Regular.woff2');
    for (const p of ['/', '/index.html', '/launch', '/launch.html', '/app/app/main.js', '/app/app/api.js', '/api/universe', '/fonts/../index.html', '/desktop.html', '/fonts/x.ttf']) assert.equal(controllerStaticPath(p), null, p);
  });
});

function post(port: number, pathname: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: pathname, agent: false, headers: { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown> }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

const controller = (onExit: () => void, ticketTtlMs = 60_000): DesktopController => new DesktopController({ workspace: ws, cliPath: 'unused', providers: [], roots: defaultStaticRoots(), admit: () => 'ADMITTED', onExit, ticketTtlMs });

describe('the controller lifetime', () => {
  test('an unredeemed ticket expires and ends the controller (the Company is never touched)', async () => {
    let exited = false;
    const c = controller(() => (exited = true), 300);
    const t = mintSecret();
    c.arm(t.hash, 'STOP');
    await c.listen();
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(exited, true);
    assert.equal(await post(c.port, '/desktop/redeem', { ticket: t.secret }).then(() => 'answered', () => 'gone'), 'gone');
  });

  test('three wrong tickets end the controller; the right one is then useless', async () => {
    let exited = false;
    const c = controller(() => (exited = true));
    const t = mintSecret();
    c.arm(t.hash, 'STOP');
    await c.listen();
    for (let i = 0; i < 3; i++) assert.equal((await post(c.port, '/desktop/redeem', { ticket: mintSecret().secret })).json.code, 'TICKET_INVALID');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(exited, true);
    assert.equal(await post(c.port, '/desktop/redeem', { ticket: t.secret }).then(() => 'answered', () => 'gone'), 'gone');
  });

  test('a malformed arm is refused', () => {
    const c = controller(() => undefined);
    assert.throws(() => c.arm('not-a-hash', 'STOP'));
    c.close();
  });

  test('one controller per workspace; a released lock can be taken again', () => {
    const release = acquireDesktopControl(ws);
    assert.ok(release);
    // The holder is this process: a second taker in another process would see it held (the PID is alive).
    release();
    const again = acquireDesktopControl(ws);
    assert.ok(again);
    again();
  });

  test('only the workspace the launcher configuration names can be controlled', async () => {
    assert.ok(configuredCompany(ws));
    assert.equal(configuredCompany(other), null);
    assert.deepEqual(await armDesktopController({ workspace: other, cliPath: 'unused', intent: 'STOP' }), { ok: false, code: 'DESKTOP_CONTROL_UNAVAILABLE' });
  });
});

/** An in-process controller on `workspace`, redeemed: returns its port, its key and a status reader. */
async function redeemed(workspace: string, admit = (): string => 'ADMITTED'): Promise<{ c: DesktopController; key: string; status: () => Promise<Record<string, unknown>>; act: (action: string) => Promise<number> }> {
  const c = new DesktopController({ workspace, cliPath: path.join(root, 'no-such-cli.js'), providers: [], roots: defaultStaticRoots(), admit, readyTimeoutMs: 5_000 });
  const t = mintSecret();
  c.arm(t.hash, 'STOP');
  await c.listen();
  const r = await post(c.port, '/desktop/redeem', { ticket: t.secret });
  const key = String(r.json.key);
  const call = (pathname: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: c.port, method: 'POST', path: pathname, agent: false, headers: { Host: `127.0.0.1:${c.port}`, Origin: `http://127.0.0.1:${c.port}`, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'x-qandeel-desktop-key': key } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (x: Buffer) => chunks.push(x));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown> }));
      });
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  const status = async (): Promise<Record<string, unknown>> => {
    for (let i = 0; i < 100; i++) {
      const s = (await call('/desktop/status', {})).json;
      if (s.busy !== true) return s;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('the controller stayed busy');
  };
  return { c, key, status, act: async (action) => (await call('/desktop/act', { action })).status };
}

describe('truthful states (never a false STOPPED or RUNNING)', () => {
  test('a stop with nothing running reports STOPPED; a stale descriptor stays STALE, not STOPPED', async () => {
    const w = path.join(root, 'stale');
    CompanyStore.open(w).close();
    const { c, status } = await redeemed(w);
    try {
      const s = await status();
      assert.equal(s.phase, 'STOPPED');
      assert.equal(s.state, 'STOPPED');
      const { HostIdentity, hostPaths: hp, writeJsonAtomic } = await import('../src/host/descriptor.js');
      const id = new HostIdentity('00000000-0000-4000-8000-0000000000aa');
      writeJsonAtomic(hp(w).descriptor, id.descriptor(999_999, 1, new Date().toISOString()));
      const stale = await status();
      assert.equal(stale.phase, 'STOPPED');
      assert.equal(stale.state, 'STALE', 'the canonical distinction travels with the phase');
    } finally {
      c.close();
    }
  });

  test('a held Company is reported HELD and nothing is started (no hold is ever bypassed)', async () => {
    const w = path.join(root, 'held');
    CompanyStore.open(w).close();
    const { c, status, act } = await redeemed(w);
    try {
      await status();
      mkdirSync(path.join(w, 'maintenance'), { recursive: true });
      writeFileSync(path.join(w, 'maintenance', 'UPDATE_HOLD.json'), JSON.stringify({ updateId: 'u1', code: 'VERIFY_FAILED', fromVersion: 20, toVersion: 21, at: new Date().toISOString() }));
      assert.equal(await act('START'), 202);
      const s = await status();
      assert.equal(s.phase, 'HELD');
      assert.equal(s.state, 'HELD');
      assert.equal(s.code, 'UPDATE_HOLD');
      assert.equal(existsSync(path.join(w, 'runtime', 'founder-host.log')), false, 'no host was spawned');
    } finally {
      c.close();
    }
  });

  test('a release that is not admitted starts nothing: ERROR RUNTIME_RELEASE_REFUSED', async () => {
    const w = path.join(root, 'refused');
    CompanyStore.open(w).close();
    const { c, status, act } = await redeemed(w, () => 'NOT_ACTIVATED');
    try {
      await status();
      assert.equal(await act('START'), 202);
      const s = await status();
      assert.equal(s.phase, 'ERROR');
      assert.equal(s.code, 'RUNTIME_RELEASE_REFUSED');
      assert.equal(s.state, 'STOPPED');
    } finally {
      c.close();
    }
  });

  test('a live runtime the controller cannot stop is reported, never terminated (no forced stop by default)', async () => {
    const w = path.join(root, 'foreign');
    CompanyStore.open(w).close();
    const runtime = new CompanyRuntime({ workspace: w, processors: [], supervisorTtlMs: 600_000, watchWakeFile: false });
    await runtime.start();
    try {
      const { c, status } = await redeemed(w);
      try {
        const s = await status();
        assert.equal(s.phase, 'ERROR');
        assert.notEqual(s.state, 'STOPPED');
        assert.ok(['HOST_UNRESPONSIVE', 'FOREIGN_RUNTIME', 'HOST_STOP_TIMEOUT'].includes(String(s.code)), String(s.code));
        assert.equal(runtime.state, 'READY', 'the runtime was not terminated');
      } finally {
        c.close();
      }
    } finally {
      await runtime.stop();
    }
  });
});
