#!/usr/bin/env node
// C5 visual proof package — from the REAL implemented UI, not a mockup (C5 brief §31).
//
//   npm run c5:visual-proof -- --workspace <disposable dir> --out <dir> [--keep] [--spike]
//
// Seeds a representative organization (deterministic fake provider, no network, no credential), starts the
// Founder surface (runtime + loopback listener) in this process, drives a headless Edge / Chrome through
// the Chrome DevTools Protocol with zero dependencies, and produces:
//   - proof/01..08-*.png      Scenario A–H frames (Company Live, Employee Focus, Goal Focus, Founder
//                             Attention / CEO brief, governed action preview + confirmation, Timeline /
//                             Return to Live, reduced motion, SVG fallback) plus a scale frame;
//   - proof/walkthrough.mp4   a short walkthrough (H.264, encoded offline in the browser with WebCodecs);
//   - proof/manifest.json     what was captured, from which head, with content-free counts.
// With --spike it stops after the technical spike checks (scene boots, Arabic labels, orbits, selection,
// focus / return, reduced motion, no external asset) and prints them as JSON.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { launchBrowser, openPage } from './c5/cdp.mjs';
import { seedLive, seedStatic } from './c5/seed-company.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ strict: true, options: { workspace: { type: 'string' }, out: { type: 'string' }, keep: { type: 'boolean', default: false }, spike: { type: 'boolean', default: false }, width: { type: 'string', default: '1440' }, height: { type: 'string', default: '900' } } });
if (!values.workspace) {
  console.error(JSON.stringify({ ok: false, message: 'usage: --workspace <new or empty dir> [--out <dir>] [--keep] [--spike]' }));
  process.exit(2);
}
const sandbox = path.resolve(values.workspace);
for (let dir = sandbox; ; dir = path.dirname(dir)) {
  if (existsSync(path.join(dir, '.git'))) {
    console.error(JSON.stringify({ ok: false, message: 'the workspace must not be inside a Git working tree' }));
    process.exit(2);
  }
  if (path.dirname(dir) === dir) break;
}
if (existsSync(sandbox) && readdirSync(sandbox).length > 0) {
  console.error(JSON.stringify({ ok: false, message: 'the workspace must not exist or must be empty' }));
  process.exit(2);
}
mkdirSync(sandbox, { recursive: true });
const company = path.join(sandbox, 'company');
const out = path.resolve(values.out ?? path.join(sandbox, 'proof'));
mkdirSync(out, { recursive: true });
const W = Number(values.width);
const H = Number(values.height);

const { FounderSurface } = await import('@qandeel-company/command-center');
const world = seedStatic(company);
const surface = new FounderSurface({ workspace: company, fakes: { providers: ['fake-local'], drivers: ['fake-notes', 'fake-publisher'] }, runtime: { supervisorTtlMs: 3_000, concurrency: 6, governance: { modelCallTimeoutMs: 600_000 } }, briefing: false });
const results = { head: safeHead(), steps: [], spike: {} };
let browser = null;
let page = null;
const frames = [];
let capturing = false;
let captureTimer = null;

const step = async (name, fn) => {
  const started = Date.now();
  try {
    const detail = (await fn()) ?? {};
    results.steps.push({ step: name, result: 'PASS', ms: Date.now() - started, ...detail });
    console.log(JSON.stringify({ step: name, result: 'PASS', ms: Date.now() - started, ...detail }));
  } catch (error) {
    results.steps.push({ step: name, result: 'FAIL', ms: Date.now() - started, message: String(error?.message ?? error).slice(0, 300) });
    console.log(JSON.stringify({ step: name, result: 'FAIL', ms: Date.now() - started, message: String(error?.message ?? error).slice(0, 300) }));
    throw error;
  }
};
const shot = async (name) => {
  const file = path.join(out, `${name}.png`);
  await page.screenshot(file);
  return file;
};
const startCapture = () => {
  capturing = true;
  const tick = async () => {
    if (!capturing) return;
    try {
      const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
      frames.push(`data:image/jpeg;base64,${data}`);
    } catch {
      // a navigation in flight: skip the frame
    }
    captureTimer = setTimeout(tick, 1000 / 12);
  };
  void tick();
};
const stopCapture = () => {
  capturing = false;
  clearTimeout(captureTimer);
};
const settle = (ms = 900) => sleep(ms);
const click = async (selector) => {
  const ok = await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView?.({ block: 'center' }); el.click(); return true; })()`);
  if (!ok) throw new Error(`no element ${selector}`);
};
const type = async (selector, text) => {
  await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
};
const submit = async (selector) => page.evaluate(`(() => { const f = document.querySelector(${JSON.stringify(selector)}); f.requestSubmit(); return true; })()`);

try {
  await surface.start();
  const live = await seedLive(surface, world);
  await step('surface-started', () => ({ origin: surface.origin, employees: Object.keys(world.employees).length }));
  browser = await launchBrowser({ width: W, height: H });
  page = await openPage(browser.port);
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const requests = [];
  const consoleLines = [];
  page.on('Network.requestWillBeSent', (p) => requests.push(p.request.url));
  page.on('Network.responseReceived', (p) => { if (p.response.status >= 400) consoleLines.push(`HTTP ${p.response.status} ${p.response.url}`); });
  page.on('Runtime.consoleAPICalled', (p) => consoleLines.push(`${p.type}: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`));
  page.on('Runtime.exceptionThrown', (p) => consoleLines.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`));
  results.console = consoleLines;
  await page.send('Network.enable');
  await page.navigate(surface.launchUrl());
  await page.waitUntil(`location.pathname === '/'`, 20_000);
  await page.waitUntil(`document.getElementById('app') && !document.getElementById('app').hasAttribute('data-booting')`, 30_000);
  await settle(1500);

  // --- technical spike checks (C5 brief §3) ---
  await step('spike-scene-boots', async () => {
    const renderer = await page.evaluate(`document.documentElement.dataset.renderer`);
    const canvas = await page.evaluate(`!!document.querySelector('#universe canvas, #universe svg')`);
    if (!canvas) throw new Error('no scene element');
    results.spike.renderer = renderer;
    return { renderer };
  });
  await step('spike-arabic-labels-crisp', async () => {
    const labels = await page.evaluate(`[...document.querySelectorAll('.label:not([hidden]) .name')].map((n) => n.textContent)`);
    const arabic = labels.filter((l) => /[؀-ۿ]/.test(l)).length;
    const latin = labels.filter((l) => /[A-Za-z]/.test(l)).length;
    const font = await page.evaluate(`document.fonts.check('14px "IBM Plex Sans Arabic"')`);
    if (arabic < 3) throw new Error(`only ${arabic} Arabic labels visible`);
    if (!font) throw new Error('the bundled Arabic font did not load');
    results.spike.labels = { arabic, latin, font };
    return { arabic, latin, font };
  });
  await step('spike-orbits-present', async () => {
    const rings = await page.evaluate(`[...new Set([...document.querySelectorAll('.label:not([hidden])')].map((l) => l.dataset.kind))]`);
    const seatKinds = await page.evaluate(`[...new Set([...document.querySelectorAll('.label')].map((l) => l.getAttribute('aria-label')))].filter((a) => /المدير التنفيذي|مدير قسم|متخصص/.test(a)).length`);
    if (seatKinds < 3) throw new Error('fewer than three orbit levels labelled');
    results.spike.orbits = { kinds: rings, labelledLevels: seatKinds };
    return { kinds: rings, labelledLevels: seatKinds };
  });
  await step('spike-no-external-asset', async () => {
    const external = requests.filter((u) => !u.startsWith(surface.origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
    if (external.length) throw new Error(`external requests: ${external.slice(0, 3).join(', ')}`);
    results.spike.requests = { total: requests.length, external: 0 };
    return { total: requests.length, external: 0 };
  });
  await step('spike-selection-focus-return', async () => {
    const ceo = world.employees['company.ceo'].id;
    await click(`.label[data-id="employee:${ceo}"]`);
    await page.waitUntil(`document.getElementById('focus') && !document.getElementById('focus').hidden && document.querySelector('#focus .focus-title')`, 10_000);
    const title = await page.evaluate(`document.querySelector('#focus .focus-title').textContent`);
    const lens = await page.evaluate(`document.documentElement.dataset.lens`);
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) && window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await settle(700);
    const back = await page.evaluate(`document.documentElement.dataset.lens`);
    if (lens !== 'EMPLOYEE' || back !== 'LIVE') throw new Error(`lens ${lens} → ${back}`);
    results.spike.selection = { title, lens, back };
    return { title, lens, back };
  });
  await step('spike-reduced-motion-parity', async () => {
    // Parity of meaning, not of pixels: every pinned label (Founder, CEO, Directors, goals, urgent attention)
    // that Company Live shows in full motion is still shown in reduced motion, with no ambient drift.
    const pinnedExpr = `[...document.querySelectorAll('.label:not([hidden])')].filter((l) => ['founder','goal','attention'].includes(l.dataset.kind) || /المدير التنفيذي|مدير قسم/.test(l.getAttribute('aria-label') || '')).map((l) => l.dataset.id).sort()`;
    await settle(1600);
    const before = await page.evaluate(pinnedExpr);
    await click('#motion-toggle');
    await settle(700);
    const mode = await page.evaluate(`document.documentElement.dataset.motion`);
    const after = await page.evaluate(pinnedExpr);
    const missing = before.filter((x) => !after.includes(x));
    if (mode !== 'reduced' || after.length < 3 || missing.length > 0) throw new Error(`reduced motion mode ${mode}; missing ${missing.length} of ${before.length} pinned labels`);
    await click('#motion-toggle');
    await settle(200);
    results.spike.reducedMotion = { mode, pinnedLabels: after.length };
    return { mode, pinnedLabels: after.length };
  });
  if (values.spike) {
    console.log(JSON.stringify({ verdict: 'C5 TECHNICAL SPIKE — PASS', spike: results.spike }));
  } else {
    // --- Scenario frames and the walkthrough ---
    startCapture();
    await step('A-company-live', async () => {
      await settle(2500);
      await shot('01-company-live');
      const signals = await page.evaluate(`document.getElementById('health').textContent`);
      return { signals };
    });
    await step('B-employee-focus', async () => {
      const seo = world.employees['growth.seo-1'].id;
      await click(`.label[data-id="employee:${seo}"]`);
      await page.waitUntil(`!document.getElementById('focus').hidden && document.querySelector('#focus .chain li')`, 10_000);
      await settle(1800);
      await shot('02-employee-focus');
      const chain = await page.evaluate(`document.querySelectorAll('#focus .chain li').length`);
      return { chainLinks: chain };
    });
    await step('C-goal-focus', async () => {
      await click(`.label[data-id="goal:${world.goals.saudi}"]`);
      await page.waitUntil(`document.documentElement.dataset.lens === 'GOAL' && document.querySelector('#focus .goal-path')`, 10_000);
      await settle(1800);
      await shot('03-goal-focus');
      const work = await page.evaluate(`document.querySelectorAll('#focus .work').length`);
      return { linkedWork: work };
    });
    await step('D-founder-attention-brief', async () => {
      await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await settle(500);
      await click('.rail-tab:nth-child(2)');
      await page.waitUntil(`document.querySelector('.rail-item .brief')`, 10_000);
      await settle(1500);
      await shot('04-founder-attention-ceo-brief');
      const needsMe = await page.evaluate(`document.querySelectorAll('.rail-tab')[0].querySelector('.count').textContent`);
      const briefs = await page.evaluate(`document.querySelectorAll('.rail-tab')[1].querySelector('.count').textContent`);
      const ordinary = await page.evaluate(`[...document.querySelectorAll('.rail-item')].some((i) => i.textContent.includes('تحليل المنافسين'))`);
      if (ordinary) throw new Error('a routine completed task entered Founder Attention');
      return { needsMe, briefs, routineExcluded: true };
    });
    await step('E-governed-action', async () => {
      await click('.rail-tab:nth-child(2)');
      await settle(300);
      await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
      await page.waitUntil(`!document.getElementById('palette').hidden`, 5_000);
      await type('.palette-input', 'وافق على حملة إيهاب طارق بميزانية EGP 50,000');
      await submit('.palette-form');
      await page.waitUntil(`!document.getElementById('preview').hidden && document.querySelector('#preview .preview-summary')`, 15_000);
      await settle(1500);
      await shot('05-governed-action-preview');
      const before = surface.runtime.governance.budgetFor('EMPLOYEE', world.employees['company.ceo'].id).capMoney;
      const summary = await page.evaluate(`document.querySelector('#preview .preview-summary').textContent`);
      // The text alone changed nothing:
      if (surface.runtime.governance.budgetFor('EMPLOYEE', world.employees['company.ceo'].id).capMoney !== before) throw new Error('text mutated a budget');
      await click('#preview .btn-primary');
      await page.waitUntil(`document.getElementById('preview').hidden`, 15_000);
      await settle(1200);
      await shot('06-governed-action-confirmed');
      const after = surface.runtime.governance.budgetFor('EMPLOYEE', world.employees['company.ceo'].id).capMoney;
      const audit = surface.runtime.view.auditByAction('founder.action_confirmed').length;
      if (after !== 50_000 * 1_000_000 || audit < 1) throw new Error(`cap ${after}, audits ${audit}`);
      return { summary, capBefore: before, capAfter: after, confirmedAudits: audit };
    });
    await step('F-timeline-return-to-live', async () => {
      await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await settle(400);
      await page.evaluate(`(() => { const r = document.querySelector('.scrubber'); r.value = String(Number(r.min) + 1000); r.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await page.waitUntil(`document.documentElement.dataset.live === 'history'`, 10_000);
      await settle(1800);
      await shot('07-historical-focus');
      const historyEmployees = await page.evaluate(`document.querySelectorAll('.label[data-kind="employee"]').length`);
      await click('.timeline .btn');
      await page.waitUntil(`document.documentElement.dataset.live === 'live'`, 10_000);
      await settle(1200);
      return { historyEmployees };
    });
    await step('G-reduced-motion', async () => {
      await click('#motion-toggle');
      await settle(800);
      await shot('08-reduced-motion');
      await click('#motion-toggle');
      return { mode: 'reduced → full' };
    });
    stopCapture();
    await step('H-svg-fallback', async () => {
      await page.navigate(`${surface.origin}/?renderer=svg`);
      await page.waitUntil(`document.documentElement.dataset.renderer === 'svg' && !document.getElementById('app').hasAttribute('data-booting')`, 30_000);
      await settle(1500);
      await shot('09-svg-fallback');
      const nodes = await page.evaluate(`document.querySelectorAll('.svg-universe g[data-id]').length`);
      return { svgNodes: nodes };
    });
    await step('scale-proof', async () => {
      // A larger synthetic organization: layout only (the same pure module the UI runs), rendered as a frame count.
      const { layoutUniverse } = await import('@qandeel-company/command-center-ui');
      const u = surface.runtime.founder.universe();
      const big = { ...u, employees: [...u.employees], seats: [...u.seats] };
      const growth = u.departments[1];
      for (let i = 0; i < 60; i++) {
        const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
        big.seats.push({ id: `5${id.slice(1)}`, code: `growth.synthetic-${i}`, title: `Seat ${i}`, kind: i % 6 === 0 ? 'MANAGER' : 'SPECIALIST', departmentId: growth.id, reportsToPositionId: growth.directorPositionId, reportsToFounder: false, status: 'ACTIVE', holderEmployeeId: id, holderKind: 'PRIMARY', coveredEmployeeId: null, actingUntil: null });
        big.employees.push({ id, ref: `employee:${id}`, name: { given: `موظف`, family: `${i}` }, state: 'ACTIVE', roleRef: 'role:x', seatId: null, seatKind: 'SPECIALIST', departmentId: growth.id, orgScope: 'DEPARTMENT', chain: [] });
      }
      const started = performance.now();
      const layout = layoutUniverse(big);
      const ms = performance.now() - started;
      const min = Math.min(...layout.nodes.filter((n) => n.kind === 'employee').map((n, _, arr) => Math.min(...arr.filter((m) => m !== n).map((m) => Math.hypot(m.x - n.x, m.z - n.z)))));
      // No spaghetti at scale: 77 employees, and no two of them share a spot (the pure layout the UI runs).
      if (!(min > 0.25)) throw new Error(`employees overlap at scale (min distance ${min})`);
      return { nodes: layout.nodes.length, edges: layout.edges.length, layoutMs: Math.round(ms * 100) / 100, minEmployeeDistance: Math.round(min * 100) / 100 };
    });
    await step('encode-walkthrough', async () => {
      const enc = await openPage(browser.port, `file:///${path.join(ROOT, 'scripts', 'c5', 'encoder.html').replace(/\\/g, '/')}`);
      await enc.waitUntil('window.encoderReady === true', 10_000);
      // Frames are captured as fast as the headless tab yields them (a few per second); 4 fps playback keeps the
      // walkthrough watchable rather than a blur.
      const fps = 4;
      // The frames go over in small batches (one DevTools message per ~1 MB), then the page encodes them.
      await enc.send('Runtime.evaluate', { expression: 'window.__frames = []; true' });
      for (let i = 0; i < frames.length; i += 8) {
        const batch = await enc.send('Runtime.evaluate', { expression: `window.__frames.push(...${JSON.stringify(frames.slice(i, i + 8))}); window.__frames.length`, returnByValue: true });
        if (batch.exceptionDetails) throw new Error(`frame upload failed: ${batch.exceptionDetails.text ?? 'exception'}`);
      }
      const b64 = await enc.send('Runtime.evaluate', { expression: `window.encode(window.__frames, ${fps}, ${W}, ${H})`, awaitPromise: true, returnByValue: true });
      if (b64.exceptionDetails) throw new Error(`encoder failed: ${b64.exceptionDetails.exception?.description ?? b64.exceptionDetails.text ?? 'exception'}`.slice(0, 300));
      const value = b64.result?.value;
      if (typeof value !== 'string' || value.length < 1000) throw new Error(`encoder produced no video (${JSON.stringify(b64).slice(0, 200)})`);
      const file = path.join(out, 'walkthrough.mp4');
      writeFileSync(file, Buffer.from(value, 'base64'));
      await enc.close();
      return { frames: frames.length, seconds: Math.round(frames.length / fps), bytes: Buffer.byteLength(value, 'base64') };
    });
    writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), head: results.head, renderer: results.spike.renderer, frames: readdirSync(out).filter((f) => f.endsWith('.png')), video: existsSync(path.join(out, 'walkthrough.mp4')) ? 'walkthrough.mp4' : null, steps: results.steps, live: { employees: Object.keys(world.employees).length, goals: 3 } }, null, 2));
    console.log(JSON.stringify({ verdict: results.steps.every((s) => s.result === 'PASS') ? 'C5 VISUAL PROOF — PASS' : 'C5 VISUAL PROOF — FAIL', out }));
  }
  void live;
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error?.code ?? 'ERROR', message: String(error?.message ?? error).slice(0, 400), browserConsole: (results.console ?? []).slice(-12) }));
  process.exitCode = 1;
} finally {
  stopCapture();
  await page?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await surface.stop().catch(() => undefined);
  if (!values.keep) rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function safeHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
