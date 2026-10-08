#!/usr/bin/env node
/**
 * D2-CTRL-01 (D-D2-01) — the REAL Windows desktop proof of the in-window lifecycle control, beyond mocks: a real Company
 * host, a real stopped-state controller and a real Microsoft Edge app window, driven with trusted mouse input over the
 * DevTools protocol, on a DISPOSABLE Company with an isolated LOCALAPPDATA and an isolated Edge profile. It never touches
 * the Founder's real profile, launcher configuration, vault, releases or LIVE workspace.
 *
 *   npm run desktop:control-proof -- [--out <evidence dir>] [--keep]
 *
 * Scenarios: open (the canonical handoff) → Status → Stop from inside the Command Center → the SAME window shows STOPPED
 * → Start Company → the canonical READY → back in the Command Center with a valid Founder session → Restart from inside →
 * close with X (the Company keeps running) → reopen without a duplicate host → an external Start-menu Stop is shown
 * truthfully → the emergency CLI shortcuts' commands still work → no ticket, control key or launch token in any process
 * command line, the host log or the window's history → the Company's durable state is unchanged. Screenshots of every
 * state go to the evidence directory. Local only (it shows a real window); it is not a CI step.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { ROOT } from '../lib/desktop-build.mjs';
import { companyFingerprint, recorder, seedSentinel, sleep } from '../lib/proof-kit.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' }, keep: { type: 'boolean', default: false } } });
if (process.platform !== 'win32') {
  console.error('desktop-control-proof: Windows only (a real Edge app window)');
  process.exit(2);
}
const edgeExe = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean).map((r) => path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find((p) => existsSync(p));
if (!edgeExe) {
  console.error('desktop-control-proof: Microsoft Edge is not installed');
  process.exit(2);
}

// --- a disposable world -------------------------------------------------------------------------------------------------
const world = mkdtempSync(path.join(os.tmpdir(), 'qc-ctl-proof-'));
const local = path.join(world, 'local');
const ws = path.join(world, 'company');
const edgeProfile = path.join(world, 'edge-profile');
const evidence = path.resolve(values.out ?? path.join(world, 'evidence'));
mkdirSync(evidence, { recursive: true });
mkdirSync(path.join(local, 'QANDEEL_COMPANY', 'launcher'), { recursive: true });
const realLocal = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
if (path.resolve(local, 'QANDEEL_COMPANY').toLowerCase() === path.resolve(realLocal, 'QANDEEL_COMPANY').toLowerCase()) throw new Error('refusing: the isolated profile is the real one');
process.env.LOCALAPPDATA = local; // every host / controller this proof starts inherits the isolated profile

const dist = (pkg, file) => pathToFileURL(path.join(ROOT, 'packages', pkg, 'dist', 'src', file)).href;
const { CompanyStore } = await import(dist('storage', 'index.js'));
const lifecycle = await import(dist('command-center', 'host/lifecycle.js'));
const { hostPaths } = await import(dist('command-center', 'host/descriptor.js'));
const cli = path.join(ROOT, 'packages', 'command-center', 'dist', 'src', 'cli.js');

CompanyStore.open(ws).close();
writeFileSync(path.join(local, 'QANDEEL_COMPANY', 'launcher', 'founder-launcher.json'), `${JSON.stringify({ version: 1, workspace: ws, providers: [] })}\n`);
await seedSentinel(ws);
const before = await companyFingerprint(ws);

const { check, failures } = recorder();
const secrets = new Set();

// --- a minimal DevTools protocol client (Node 24 WebSocket) -------------------------------------------------------------
let edge = null;
async function devtoolsPort() {
  const file = path.join(edgeProfile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(file); i++) await sleep(200);
  return Number(readFileSync(file, 'utf8').split('\n')[0]);
}

/** The product's browser opener, with an isolated Edge profile and a DevTools port (the argument is still only the handoff address). */
const openEdge = async (url) => {
  edge = spawn(edgeExe, [`--user-data-dir=${edgeProfile}`, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--remote-debugging-port=0', '--window-size=1400,900', `--app=${url}`], { detached: true, stdio: 'ignore', shell: false });
  edge.unref();
  return { ok: true, browser: 'edge' };
};

class Page {
  #ws;
  #id = 0;
  #pending = new Map();
  #listeners = [];
  targetId;
  static async attach(port) {
    let target;
    for (let i = 0; i < 100 && !target; i++) {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
      target = list.find((t) => t.type === 'page');
      if (!target) await sleep(200);
    }
    const p = new Page();
    p.targetId = target.id;
    p.#ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      p.#ws.onopen = resolve;
      p.#ws.onerror = reject;
    });
    p.#ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.id !== undefined && p.#pending.has(msg.id)) {
        const { resolve, reject } = p.#pending.get(msg.id);
        p.#pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) for (const l of p.#listeners) l(msg);
    };
    await p.send('Page.enable');
    await p.send('Network.enable');
    return p;
  }
  send(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }
  on(fn) {
    this.#listeners.push(fn);
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return r.result?.value;
  }
  async waitFor(expression, timeoutMs = 120_000, what = expression) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = await this.eval(expression).catch(() => undefined);
      if (v) return v;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await sleep(150);
    }
  }
  /** A trusted mouse click at the element's centre (Input.dispatchMouseEvent, not a synthetic DOM click). */
  async click(selector) {
    const box = await this.waitFor(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.hidden || e.disabled) return null; const r = e.getBoundingClientRect(); return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`, 30_000, selector);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  async shot(name) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(data, 'base64'));
  }
  close() {
    this.#ws.close();
  }
}

/** Every secret the window receives (tickets, control keys, launch tokens), captured from the real responses. */
function captureSecrets(page) {
  const watched = new Map();
  page.on((msg) => {
    if (msg.method === 'Network.responseReceived' && /\/api\/desktop\/control$|\/desktop\/redeem$|\/desktop\/enter$/.test(msg.params.response.url)) watched.set(msg.params.requestId, true);
    if (msg.method === 'Network.loadingFinished' && watched.has(msg.params.requestId)) {
      watched.delete(msg.params.requestId);
      page
        .send('Network.getResponseBody', { requestId: msg.params.requestId })
        .then(({ body }) => {
          const j = JSON.parse(body);
          for (const v of [j.ticket, j.key, typeof j.launchUrl === 'string' ? j.launchUrl.split('#')[1] : undefined]) if (typeof v === 'string' && v.length > 0) secrets.add(v);
        })
        .catch(() => undefined);
    }
    // A ticket or launch token travels in the fragment of the window's navigation (never in a request).
    if (msg.method === 'Page.frameNavigated') {
      const frag = msg.params.frame.urlFragment ?? (msg.params.frame.url.includes('#') ? msg.params.frame.url.split('#')[1] : '');
      const v = frag.replace(/^#/, '');
      if (v.length > 0) secrets.add(v);
    }
  });
}

const commandLines = (needle) =>
  new Promise((resolve) => {
    const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('${needle.replace(/'/g, "''")}') } | ForEach-Object { $_.CommandLine } | ConvertTo-Json -Compress`;
    execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (_e, out) => {
      try {
        const v = JSON.parse(String(out).trim() || '[]');
        resolve(Array.isArray(v) ? v : [v]);
      } catch {
        resolve([]);
      }
    });
  });

const commandLinesOf = (pid) =>
  new Promise((resolve) => {
    const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine | ConvertTo-Json -Compress`], { windowsHide: true }, (_e, out) => {
      try {
        const v = JSON.parse(String(out).trim() || 'null');
        resolve(v === null ? [] : [String(v)]);
      } catch {
        resolve([]);
      }
    });
  });

const runCli = (args) =>
  new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { env: process.env, windowsHide: true, timeout: 300_000 }, (_e, stdout) => {
      const line = String(stdout).trim().split('\n').filter((l) => l.startsWith('{')).at(-1) ?? '{}';
      resolve(JSON.parse(line));
    });
  });

const commandCenterReady = `location.pathname === '/' && !!document.querySelector('#app') && !document.querySelector('#app').hasAttribute('data-booting') && !document.querySelector('#app').hidden`;
const phaseIs = (phase) => `location.pathname === '/desktop' && document.querySelector('#lifecycle')?.dataset.phase === ${JSON.stringify(phase)}`;

let page = null;
try {
  // 1. Open from the Desktop shortcut's path: the canonical openCompany + one-shot handoff, in a real Edge app window.
  const opened = await lifecycle.openCompany(ws, { cliPath: cli, providers: [], browser: true, openBrowser: openEdge });
  check('open.handoff', opened.ok && opened.outcome === 'STARTED_AND_OPENED', opened.outcome);
  page = await Page.attach(await devtoolsPort());
  captureSecrets(page);
  const windowId = page.targetId;
  await page.waitFor(commandCenterReady, 60_000, 'the Command Center');
  check('open.command-center', true, 'Founder session through /launch');
  await page.shot('01-command-center');
  const first = await lifecycle.discoverHost(ws);

  // 2. Status inside the window.
  await page.click('#company-toggle');
  await page.waitFor(`document.querySelector('#company-panel .company-facts')?.textContent.includes('Running — healthy')`, 30_000, 'the status panel');
  check('status.in-window', true, 'Running — healthy');
  await page.shot('02-status-panel');

  // 3. Stop from inside the Command Center → the SAME window shows STOPPED.
  await page.click('#company-stop');
  await page.waitFor(`!!document.querySelector('#company-stop-confirm')`, 10_000, 'the stop confirmation');
  await page.shot('03-stop-confirm');
  await page.click('#company-stop-confirm');
  await page.waitFor(`location.pathname === '/desktop'`, 30_000, 'the controller page');
  check('stop.same-window', page.targetId === windowId, 'one window throughout');
  check('stop.no-fragment-in-history', (await page.eval('location.href')).includes('#') === false, await page.eval('location.href'));
  await page.waitFor(phaseIs('STOPPED'), 120_000, 'STOPPED');
  await page.shot('04-stopped');
  const stopped = await lifecycle.discoverHost(ws);
  check('stop.canonical', stopped.state === 'STOPPED', stopped.state);
  // The live controller's own command line (by the PID in its lock): the signed runtime, this CLI, the workspace — no secret.
  const lock = JSON.parse(readFileSync(path.join(hostPaths(ws).runtimeDir, 'desktop-control.lock'), 'utf8'));
  const ctlLine = (await commandLinesOf(lock.pid))[0] ?? '';
  const ctlArgs = ctlLine.slice(ctlLine.indexOf('cli.js') + 'cli.js'.length).replace(/"/g, '').trim();
  check('secrets.controller-args', ctlArgs === `desktop-control --workspace ${hostPaths(ws).root}` && [...secrets].every((x) => !ctlLine.includes(x)), ctlArgs);
  check('stop.window-usable', (await page.eval(`!document.querySelector('#lc-start').hidden`)) === true, 'Start Company offered');

  // 4–5. Start Company → canonical READY → the same window returns to the Command Center with a valid Founder session.
  await page.click('#lc-start');
  await page.waitFor(`['STARTING','READY','ENTERED'].includes(document.querySelector('#lifecycle')?.dataset.phase) || location.pathname !== '/desktop'`, 30_000, 'STARTING');
  await page.shot('05-starting');
  await page.waitFor(commandCenterReady, 120_000, 'the Command Center after Start');
  const afterStart = await lifecycle.discoverHost(ws);
  check('start.ready', afterStart.state === 'RUNNING' && afterStart.runtimeState === 'READY', `${afterStart.state}/${afterStart.runtimeState}`);
  check('start.same-window', page.targetId === windowId);
  check('start.founder-session', (await page.eval(`fetch('/api/session', { cache: 'no-store' }).then((r) => r.status)`)) === 200, 'GET /api/session 200');
  check('start.same-company', (await companyFingerprint(ws)) === before);
  await page.shot('06-back-in-command-center');

  // 6. Restart from inside the window.
  await page.click('#company-toggle');
  await page.click('#company-restart');
  await page.click('#company-restart-confirm');
  await page.waitFor(phaseIs('RESTARTING'), 30_000, 'RESTARTING');
  // While an operation runs, no conflicting action is offered (rendered, not merely flagged hidden).
  check('restart.no-conflicting-actions', (await page.eval(`['#lc-start', '#lc-status'].every((s) => getComputedStyle(document.querySelector(s)).display === 'none')`)) === true);
  await page.shot('07-restarting');
  await page.waitFor(commandCenterReady, 180_000, 'the Command Center after Restart');
  const afterRestart = await lifecycle.discoverHost(ws);
  check('restart.ready', afterRestart.state === 'RUNNING' && afterRestart.instanceId !== afterStart.instanceId, `${afterStart.instanceId?.slice(0, 8)} → ${afterRestart.instanceId?.slice(0, 8)}`);
  check('restart.founder-session', (await page.eval(`fetch('/api/session', { cache: 'no-store' }).then((r) => r.status)`)) === 200);
  await page.shot('08-after-restart');

  // 7. Close with X (the window's own close): the Company keeps running.
  await page.send('Browser.close').catch(() => undefined);
  page.close();
  page = null;
  await sleep(4_000);
  const afterClose = await lifecycle.discoverHost(ws);
  check('close.company-keeps-running', afterClose.state === 'RUNNING' && afterClose.instanceId === afterRestart.instanceId, afterClose.state);

  // 8. Reopen without a duplicate host.
  rmSync(path.join(edgeProfile, 'DevToolsActivePort'), { force: true });
  const reopened = await lifecycle.openCompany(ws, { cliPath: cli, providers: [], browser: true, openBrowser: openEdge });
  check('reopen.reused', reopened.ok && reopened.outcome === 'OPENED' && reopened.status.instanceId === afterRestart.instanceId, reopened.outcome);
  const hosts = (await commandLines(ws)).filter((c) => / serve /.test(c) && c.includes('--background'));
  check('reopen.one-host', hosts.length === 1, `${hosts.length} host process(es)`);
  page = await Page.attach(await devtoolsPort());
  captureSecrets(page);
  await page.waitFor(commandCenterReady, 60_000, 'the reopened Command Center');
  await page.shot('09-reopened');

  // 9–10. An external emergency Stop (the Start-menu shortcut's command) is shown truthfully; the shortcuts' commands work.
  const ext = await runCli(['stop']);
  check('external-stop.cli', ext.ok === true && ext.outcome === 'STOPPED', ext.outcome);
  await page.waitFor(`!document.querySelector('#unavailable').hidden`, 60_000, 'the not-running screen');
  check('external-stop.truthful', (await page.eval(`document.querySelector('#unavailable').textContent.includes('Desktop shortcut')`)) === true);
  await page.shot('10-external-stop-truthful');
  const status = await runCli(['status']);
  check('emergency.status', status.ok === true && status.state === 'STOPPED', status.state);
  const reopen = await runCli(['open', '--no-browser']);
  check('emergency.open', reopen.ok === true, reopen.outcome);
  const restart = await runCli(['restart', '--no-browser']);
  check('emergency.restart', restart.ok === true, restart.outcome);

  // 11. No secret anywhere it must not be.
  await sleep(1_000);
  const lines = [...(await commandLines('msedge')), ...(await commandLines(ws)), ];
  const log = readFileSync(hostPaths(ws).log, 'utf8');
  check('secrets.captured', secrets.size >= 6, `${secrets.size} tickets / keys / launch tokens observed`);
  check('secrets.no-command-line', [...secrets].every((s) => lines.every((l) => !l.includes(s))) && lines.every((l) => !/\/launch#|\/desktop#/.test(l)), `${lines.length} command lines scanned`);
  check('secrets.no-host-log', [...secrets].every((s) => !log.includes(s)), 'founder-host.log');

  // 12. The Company is the same Company.
  check('state.unchanged', (await companyFingerprint(ws)) === before, 'sentinel + work items + integrity');
  check('first.instance', typeof first.instanceId === 'string');
} catch (error) {
  check('proof.completed', false, error instanceof Error ? error.message : String(error));
  if (page) await page.shot('99-failure').catch(() => undefined);
} finally {
  if (page) {
    await page.send('Browser.close').catch(() => undefined);
    page.close();
  }
  await lifecycle.stopHost(ws, { force: true, timeoutMs: 60_000 }).catch(() => undefined);
  await sleep(1_500);
  // The disposable Company, profile and browser profile go; the evidence stays.
  if (!values.keep) {
    await sleep(3_000); // Edge releases its profile a moment after its window closes
    for (const d of [ws, local, edgeProfile]) {
      try {
        rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
      } catch {
        console.log(`desktop-control-proof: left ${d} (still in use); it is disposable`);
      }
    }
  }
}
const failed = failures();
console.log(`desktop-control-proof: ${failed === 0 ? 'PASS' : `FAIL (${failed})`} — evidence in ${evidence}`);
process.exit(failed === 0 ? 0 : 1);
