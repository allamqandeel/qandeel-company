// A zero-dependency Chrome DevTools Protocol client on Node 24's built-in WebSocket and fetch, plus a
// headless browser launcher (Edge or Chrome, whichever is installed; both are signed on the Founder host and
// present on GitHub runners). Used by the C5 browser smoke and the visual proof — never by product code.

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

export function findBrowser() {
  return CANDIDATES.find((c) => c && existsSync(c)) ?? null;
}

export async function launchBrowser({ width = 1440, height = 900, headless = true } = {}) {
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

/** One CDP page session: attach to a new target, send commands, await events. */
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
    send: (method, params = {}) => browser.send(method, params, sessionId),
    on: (event, handler) => browser.on(event, sessionId, handler),
    async navigate(target) {
      const loaded = page.waitFor('Page.loadEventFired', 30_000);
      await page.send('Page.navigate', { url: target });
      await loaded;
    },
    waitFor: (event, timeoutMs = 10_000) => browser.waitFor(event, sessionId, timeoutMs),
    async evaluate(expression, { awaitPromise = true } = {}) {
      const r = await page.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
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
    async screenshot(file) {
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(data, 'base64');
      if (file) (await import('node:fs')).writeFileSync(file, buf);
      return buf;
    },
    async close() {
      try {
        await browser.send('Target.closeTarget', { targetId });
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

class CdpConnection {
  #ws;
  #next = 1;
  #pending = new Map();
  #listeners = new Set();
  ready;
  constructor(url) {
    this.#ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.#ws.addEventListener('open', () => resolve());
      this.#ws.addEventListener('error', (e) => reject(new Error(`CDP socket error: ${e.message ?? 'unknown'}`)));
    });
    this.#ws.addEventListener('message', (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.id !== undefined) {
        const p = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else p.resolve(msg.result);
        return;
      }
      for (const l of this.#listeners) if (l.event === msg.method && (l.sessionId === undefined || l.sessionId === msg.sessionId)) l.handler(msg.params);
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.#next++;
    const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify(payload));
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
        reject(new Error(`timed out waiting for ${event}`));
      }, timeoutMs);
    });
  }
  close() {
    try {
      this.#ws.close();
    } catch {
      // ignore
    }
  }
}
