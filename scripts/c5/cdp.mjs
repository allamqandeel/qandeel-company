// A zero-dependency Chrome DevTools Protocol client on Node 24's built-in WebSocket and fetch, plus a
// headless browser launcher (Edge or Chrome, whichever is installed; both are signed on the Founder host and
// present on GitHub runners). Used by the C5 browser smoke and the visual proof — never by product code.
//
// Every command is bounded: a request the browser does not answer within its timeout is rejected with the
// method name, the helper and step that issued it, and what the connection saw (a crashed or detached target,
// how many other requests were still pending), and it is removed from the pending map. The harness can
// therefore never wait silently for a browser that stopped answering; the CI step's own timeout is only the
// emergency ceiling.

import { spawn } from 'node:child_process';
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
    ...extraArgs,
    // Harness-only knobs for reproducing a runner locally (e.g. `--force-prefers-reduced-motion`); never product.
    ...(process.env.QANDEEL_BROWSER_ARGS ?? '').split(/\s+/).filter(Boolean),
    'about:blank',
  ];
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
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
    async close() {
      try {
        proc.kill();
      } catch {
        // already gone
      }
      await sleep(300);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
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
