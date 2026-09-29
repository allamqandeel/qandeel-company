// A zero-dependency Chrome DevTools Protocol client on Node 24's built-in WebSocket and fetch, plus a
// headless browser launcher (Edge or Chrome, whichever is installed; both are signed on the Founder host and
// present on GitHub runners). Used by the C5 browser smoke and the visual proof — never by product code.
//
// Every command is bounded: a request the browser does not answer within its timeout is rejected with the
// method name, the helper and step that issued it, and what the connection saw (a crashed or detached target,
// how many other requests were still pending), and it is removed from the pending map. The harness can
// therefore never wait silently for a browser that stopped answering; the CI step's own timeout is only the
// emergency ceiling.

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CANDIDATES = [
  process.env.QANDEEL_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/microsoft-edge',
  '/opt/google/chrome/chrome',
];

/** The default bound for one CDP command: an ordinary evaluate, input or DOM read answers in milliseconds. */
export const DEFAULT_TIMEOUT_MS = Number(process.env.QANDEEL_CDP_TIMEOUT_MS) > 0 ? Number(process.env.QANDEEL_CDP_TIMEOUT_MS) : 20_000;

/** A command the browser did not answer in time (`code: 'CDP_TIMEOUT'`), with where it was issued from. */
export class CdpTimeoutError extends Error {
  constructor(method, timeoutMs, detail) {
    super(`${method} did not answer within ${timeoutMs} ms${detail.context ? ` — ${detail.context}` : ''}${detail.crashes.length ? ` — target ${detail.crashes.map((c) => c.event).join(', ')}` : ''}${detail.pending ? ` — ${detail.pending} other request(s) still pending` : ''}`);
    this.name = 'CdpTimeoutError';
    this.code = 'CDP_TIMEOUT';
    this.method = method;
    this.timeoutMs = timeoutMs;
    this.context = detail.context;
    this.crashes = detail.crashes;
    this.pending = detail.pending;
  }
}

export function findBrowser() {
  return CANDIDATES.find((c) => c && existsSync(c)) ?? null;
}

export async function launchBrowser({ width = 1440, height = 900, headless = true, extraArgs = [] } = {}) {
  const exe = findBrowser();
  if (!exe) throw new Error('no Chromium-based browser found (set QANDEEL_BROWSER)');
  const profile = mkdtempSync(path.join(tmpdir(), 'qc-c5-browser-'));
  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-features=Translate,MediaRouter',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--force-device-scale-factor=1',
    '--lang=ar',
    // The browser's own log (GPU, renderer and crash diagnostics; no page content) on its stderr, kept in a
    // bounded ring in memory and read back only when a command was never answered. No file: nothing to hold open.
    '--enable-logging=stderr',
    '--v=0',
    ...extraArgs,
    // Harness-only knobs for reproducing a runner locally (e.g. `--force-prefers-reduced-motion`); never product.
    ...(process.env.QANDEEL_BROWSER_ARGS ?? '').split(/\s+/).filter(Boolean),
    'about:blank',
  ];
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const logRing = [];
  let logRest = '';
  proc.stderr.on('data', (chunk) => {
    const lines = (logRest + String(chunk)).split(/\r?\n/);
    logRest = lines.pop() ?? '';
    for (const l of lines) {
      if (!l) continue;
      logRing.push(l.replace(/launch#[^\s"'&]+/g, 'launch#<redacted>').replaceAll(profile, '<profile>').slice(0, 300));
      if (logRing.length > 200) logRing.shift();
    }
  });
  proc.stderr.on('error', () => undefined);
  const portFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 30_000;
  let port = 0;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const [first] = readFileSync(portFile, 'utf8').split('\n');
      port = Number(first);
      if (port > 0) break;
    }
    await sleep(100);
  }
  if (!port) {
    proc.kill();
    throw new Error('the browser did not expose a DevTools port');
  }
  return {
    exe,
    port,
    args,
    pid: proc.pid,
    /** Is the browser process itself still running (a wedged browser is alive; a crashed one is not)? */
    alive: () => proc.exitCode === null && proc.signalCode === null,
    /**
     * The last lines of the browser's own log (every line redacted of the launch fragment and of the profile
     * path). Diagnostics about the browser, never about the page.
     */
    logTail: (lines = 40) => logRing.slice(-lines),
    /**
     * The browser's process tree right now: each process's role (`--type=` — renderer, gpu-process, utility — or
     * the browser itself), working set and CPU time, so a spinning or ballooning process is named in a failure.
     * Only processes of this profile; no command lines are reported. Bounded; failures are reported, not thrown.
     */
    processes: () => sampleProcesses(exe, profile),
    async close() {
      // The whole tree (GPU, renderers, utilities): on Windows a child can outlive the browser process for a
      // moment and hold the profile (its log) open, which would leave the throwaway profile behind.
      if (process.platform === 'win32' && proc.pid) {
        await new Promise((resolve) => execFile('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { timeout: 10_000, windowsHide: true }, () => resolve()));
      }
      try {
        proc.kill();
      } catch {
        // already gone
      }
      await sleep(300);
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
      } catch {
        // A profile the OS still holds is left to the temp directory; it carries nothing of the page.
      }
    },
  };
}

async function sampleProcesses(exe, profile) {
  const run = (file, args) => new Promise((resolve) => {
    execFile(file, args, { timeout: 15_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => resolve(error && !stdout ? { error: String(error?.message ?? error).slice(0, 120) } : { stdout: String(stdout) }));
  });
  const image = path.basename(exe);
  const rows = [];
  if (process.platform === 'win32') {
    // Single-quoted PowerShell literals (a quote doubled): no escaping of the path's backslashes.
    const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const script = `$ErrorActionPreference='SilentlyContinue'; $needle = ${lit(profile)}; Get-CimInstance Win32_Process -Filter "Name='${image.replace(/'/g, "''")}'" | ForEach-Object { $c = [string]$_.CommandLine; if ($c.Contains($needle)) { $t = 'browser'; if ($c -match '--type=([a-z-]+)') { $t = $Matches[1] }; '{0}|{1}|{2}|{3}' -f $_.ProcessId, $t, [math]::Round($_.WorkingSetSize / 1MB), [math]::Round(($_.KernelModeTime + $_.UserModeTime) / 1e7, 1) } }`;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
    if (r.error) return { error: r.error };
    for (const line of r.stdout.split(/\r?\n/)) {
      const [pid, type, wsMb, cpuS] = line.trim().split('|');
      if (pid) rows.push({ pid: Number(pid), type, wsMb: Number(wsMb), cpuS: Number(cpuS) });
    }
  } else {
    const r = await run('ps', ['-eo', 'pid=,rss=,time=,args=']);
    if (r.error) return { error: r.error };
    for (const line of r.stdout.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (!m || !m[4].includes(profile)) continue;
      const type = m[4].match(/--type=([a-z-]+)/)?.[1] ?? 'browser';
      rows.push({ pid: Number(m[1]), type, wsMb: Math.round(Number(m[2]) / 1024), cpu: m[3] });
    }
  }
  return { count: rows.length, processes: rows.sort((a, b) => b.wsMb - a.wsMb).slice(0, 12) };
}

/** One CDP page session: attach to a new target, send bounded commands, await events. */
export async function openPage(port, url = 'about:blank') {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = new CdpConnection(version.webSocketDebuggerUrl);
  await browser.ready;
  const { targetId } = await browser.send('Target.createTarget', { url });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const page = {
    browser,
    sessionId,
    targetId,
    /** Where the next commands are issued from (a helper, a step): carried into any timeout error. */
    context: '',
    send: (method, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => browser.send(method, params, sessionId, { timeoutMs, context: page.context }),
    on: (event, handler) => browser.on(event, sessionId, handler),
    async navigate(target, timeoutMs = 30_000) {
      const loaded = page.waitFor('Page.loadEventFired', timeoutMs);
      await page.send('Page.navigate', { url: target }, { timeoutMs });
      await loaded;
    },
    waitFor: (event, timeoutMs = 10_000) => browser.waitFor(event, sessionId, timeoutMs),
    async evaluate(expression, { awaitPromise = true, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
      const r = await page.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, { timeoutMs });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async waitUntil(expression, timeoutMs = 20_000, everyMs = 100) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (await page.evaluate(expression)) return true;
        if (Date.now() > deadline) throw new Error(`timed out waiting for: ${expression}`);
        await sleep(everyMs);
      }
    },
    async screenshot(file, { timeoutMs = 30_000 } = {}) {
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' }, { timeoutMs });
      const buf = Buffer.from(data, 'base64');
      if (file) (await import('node:fs')).writeFileSync(file, buf);
      return buf;
    },
    /**
     * What browser this is and how it draws (product and JavaScript engine; the GPU backend actually in use —
     * renderer, vendor, whether compositing is hardware or software). Content-free facts about the browser, read
     * once at start so a slow or wedged run on one host names its backend. Every probe is bounded and optional.
     */
    async info() {
      const out = {};
      try {
        const v = await browser.send('Browser.getVersion', {}, undefined, { timeoutMs: 5_000, context: 'browser info' });
        out.product = v.product;
        out.jsVersion = v.jsVersion;
      } catch (e) {
        out.product = `unknown (${String(e?.message ?? e).slice(0, 60)})`;
      }
      try {
        const s = await browser.send('SystemInfo.getInfo', {}, undefined, { timeoutMs: 5_000, context: 'browser info' });
        const aux = s.gpu?.auxAttributes ?? {};
        const status = s.gpu?.featureStatus ?? {};
        out.gpu = {
          glRenderer: aux.glRenderer ?? null,
          glVendor: aux.glVendor ?? null,
          glVersion: aux.glVersion ?? null,
          displayType: aux.displayType ?? null,
          skiaBackend: aux.skiaBackendType ?? null,
          inProcessGpu: aux.inProcessGpu ?? null,
          sandboxed: aux.sandboxed ?? null,
          gpuCrashes: aux.processCrashCount ?? null,
          initializationMs: aux.initializationTime ?? null,
          compositing: status.gpu_compositing ?? null,
          rasterization: status.rasterization ?? null,
          canvas: status['2d_canvas'] ?? null,
          devices: (s.gpu?.devices ?? []).map((d) => `${d.vendorString ?? d.vendorId ?? '?'} ${d.deviceString ?? d.deviceId ?? ''}`.trim()),
        };
        out.model = `${s.modelName ?? ''} ${s.modelVersion ?? ''}`.trim() || null;
      } catch (e) {
        out.gpu = `unavailable (${String(e?.message ?? e).slice(0, 60)})`;
      }
      return out;
    },
    /**
     * After a timeout: does the browser process still answer, does this page's renderer still answer, did the
     * connection see the target crash or detach? Every probe is bounded; nothing here can hang.
     */
    async postMortem() {
      const probe = async (fn) => {
        try {
          await fn();
          return true;
        } catch (e) {
          return e?.code === 'CDP_TIMEOUT' ? false : `error: ${String(e?.message ?? e).slice(0, 80)}`;
        }
      };
      const browserAnswers = await probe(() => browser.send('Browser.getVersion', {}, undefined, { timeoutMs: 5_000, context: 'post-mortem' }));
      const pageAnswers = await probe(() => browser.send('Runtime.evaluate', { expression: '1', returnByValue: true }, sessionId, { timeoutMs: 5_000, context: 'post-mortem' }));
      return { browserAnswers, pageAnswers, crashes: browser.crashes, pendingBefore: browser.pendingCount, socket: browser.state };
    },
    async close() {
      try {
        await browser.send('Target.closeTarget', { targetId }, undefined, { timeoutMs: 5_000, context: 'close' });
      } catch {
        // gone
      }
      browser.close();
    },
  };
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  return page;
}

export class CdpConnection {
  #ws;
  #next = 1;
  /** id → { resolve, reject, timer, method } */
  #pending = new Map();
  #listeners = new Set();
  /** Crash / detach events the browser reported, oldest first (content-free: event name and time). */
  crashes = [];
  ready;
  constructor(url) {
    this.#ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.#ws.addEventListener('open', () => resolve());
      this.#ws.addEventListener('error', (e) => reject(new Error(`CDP socket error: ${e.message ?? 'unknown'}`)));
    });
    this.#ws.addEventListener('close', () => this.#rejectAll('the CDP connection closed'));
    this.#ws.addEventListener('message', (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.id !== undefined) {
        const p = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code}) — ${p.method}`));
        else p.resolve(msg.result);
        return;
      }
      if (msg.method === 'Inspector.targetCrashed' || msg.method === 'Target.targetCrashed' || msg.method === 'Inspector.detached') this.crashes.push({ event: msg.method, at: new Date().toISOString(), reason: msg.params?.reason ?? msg.params?.status ?? null });
      for (const l of this.#listeners) if (l.event === msg.method && (l.sessionId === undefined || l.sessionId === msg.sessionId)) l.handler(msg.params);
    });
  }
  get pendingCount() {
    return this.#pending.size;
  }
  get state() {
    return ['connecting', 'open', 'closing', 'closed'][this.#ws.readyState] ?? String(this.#ws.readyState);
  }
  /** Sends one command; rejects with a `CdpTimeoutError` (method, context, what the connection saw) when unanswered. */
  send(method, params = {}, sessionId, { timeoutMs = DEFAULT_TIMEOUT_MS, context = '' } = {}) {
    const id = this.#next++;
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      if (this.#ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`${method} not sent: the CDP connection is ${this.state}${context ? ` — ${context}` : ''}`));
        return;
      }
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CdpTimeoutError(method, timeoutMs, { context, crashes: this.crashes.slice(), pending: this.#pending.size }));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, method });
      try {
        this.#ws.send(JSON.stringify(payload));
      } catch (e) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new Error(`${method} not sent: ${String(e?.message ?? e)}`));
      }
    });
  }
  on(event, sessionId, handler) {
    const l = { event, sessionId, handler };
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }
  waitFor(event, sessionId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const off = this.on(event, sessionId, (params) => {
        clearTimeout(t);
        off();
        resolve(params);
      });
      const t = setTimeout(() => {
        off();
        reject(new Error(`timed out waiting for ${event} (${timeoutMs} ms)`));
      }, timeoutMs);
    });
  }
  #rejectAll(why) {
    for (const [id, p] of this.#pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`${p.method} unanswered: ${why}`));
      this.#pending.delete(id);
    }
  }
  close() {
    this.#rejectAll('the CDP connection was closed by the harness');
    try {
      this.#ws.close();
    } catch {
      // ignore
    }
  }
}
