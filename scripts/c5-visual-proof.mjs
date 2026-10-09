#!/usr/bin/env node
// C5 visual proof package — from the REAL implemented UI, not a mockup (C5 brief §31; D-C5-14 Tree of Light).
//
//   npm run c5:visual-proof -- --workspace <disposable dir> --out <dir> [--keep] [--spike] [--before <dir>]
//
// Seeds a representative organization (deterministic fake provider, no network, no credential), starts the
// Founder surface (runtime + loopback listener) in this process, drives a headless Edge / Chrome through
// the Chrome DevTools Protocol with zero dependencies, and produces:
//   - proof/01..10-*.png      Company Live, Employee Focus, Goal Focus, Conversation (English UI, Arabic and
//                             English messages), Founder Attention / CEO brief, governed action preview and
//                             confirmation, Historical Focus, reduced motion, and a scale frame over a really
//                             seeded larger company;
//   - proof/walkthrough.mp4   a short walkthrough (H.264, encoded offline in the browser with WebCodecs);
//   - proof/before-after.png  a contact sheet against a previous proof folder (with --before);
//   - proof/manifest.json     what was captured, from which head, with content-free counts.
// With --minimal it captures the smoke checks and Scenario A–D only (plus the sheet beside the chips): the
// frames a presentation-only correction is judged on, without the walkthrough or the scale frame.
// With --spike it stops after the technical smoke checks (the company surface renders — spine, five columns,
// goals, execution lines; English UI with content as written, the Activation surface included (C5-CORR-01);
// selection / focus / return; reduced-motion parity; no external asset) and prints them. The surface is DOM + SVG: no GPU or WebGL is needed anywhere.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { contactSheet } from './c5/before-after.mjs';
import { launchBrowser, openPage } from './c5/cdp.mjs';
import { seedLive, seedScale, seedStatic } from './c5/seed-company.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ strict: true, options: { workspace: { type: 'string' }, out: { type: 'string' }, keep: { type: 'boolean', default: false }, spike: { type: 'boolean', default: false }, minimal: { type: 'boolean', default: false }, before: { type: 'string' }, width: { type: 'string', default: '1440' }, height: { type: 'string', default: '900' } } });
if (!values.workspace) {
  console.error(JSON.stringify({ ok: false, message: 'usage: --workspace <new or empty dir> [--out <dir>] [--keep] [--spike] [--minimal] [--before <dir>]' }));
  process.exit(2);
}
// --minimal: the smoke checks and the frames a presentation-only correction is judged on (Company Live,
// Employee Focus, Goal Focus, Founder Attention compact, the sheet beside the chips); no walkthrough, no scale.
const minimal = values.minimal;
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

// Where the harness is: the current step and the helper inside it. Every CDP command carries this as its
// context, so a command the browser never answers fails as "<method> did not answer within N ms — helper X in
// step Y" instead of a silent gap until the CI step's own ceiling kills the process.
let currentStep = '';
let currentHelper = '';
const setContext = () => {
  if (page) page.context = `${currentHelper ? `helper ${currentHelper}` : 'step body'}${currentStep ? ` in step ${currentStep}` : ''}`;
};
// Every helper call inside a step is timed into the step's record (`trace`, the last forty, as
// "helper(arg) 123ms" or "outer > inner 123ms"): a step that is slow or never returns on one host says where
// its time went, on PASS and on FAIL alike. Content-free: helper names, selectors, milliseconds.
let stepTrace = [];
const step = async (name, fn) => {
  const started = Date.now();
  currentStep = name;
  stepTrace = [];
  setContext();
  try {
    const detail = (await fn()) ?? {};
    const record = { step: name, result: 'PASS', ms: Date.now() - started, ...detail, trace: stepTrace.slice(-40) };
    results.steps.push(record);
    console.log(JSON.stringify(record));
  } catch (error) {
    const fail = { step: name, result: 'FAIL', ms: Date.now() - started, message: String(error?.message ?? error).slice(0, 400), ...(error?.code ? { code: error.code } : {}), trace: stepTrace.slice(-40) };
    results.steps.push(fail);
    console.log(JSON.stringify(fail));
    throw error;
  } finally {
    currentStep = '';
    setContext();
  }
};
// QANDEEL_PROOF_TRACE=1 also prints each helper's timing as it completes (tuning the harness by hand).
// Traced or not, a helper names itself in the context of every command it issues.
const TRACE = process.env.QANDEEL_PROOF_TRACE === '1';
const traced = (name, fn) => async (...args) => {
  const started = Date.now();
  const outer = currentHelper;
  const arg = typeof args[0] === 'string' ? args[0].slice(0, 60) : args[0] === undefined ? undefined : JSON.stringify(args[0]).slice(0, 60);
  currentHelper = arg === undefined ? name : `${name}(${arg})`;
  const label = currentHelper;
  setContext();
  try {
    return await fn(...args);
  } finally {
    currentHelper = outer;
    setContext();
    stepTrace.push(`${outer ? `${outer} > ` : ''}${label} ${Date.now() - started}ms`);
    if (TRACE) console.error(JSON.stringify({ trace: name, ms: Date.now() - started, arg }));
  }
};
const shot = traced('shot', async (name) => {
  const file = path.join(out, `${name}.png`);
  await page.screenshot(file);
  return file;
});
// A close-up of one element (its box plus a margin): a detail frame for the eye. The live tab is never clipped
// (a clipped or scaled capture leaves the headless compositor damaged for later frames): the full frame is
// cropped on a throwaway page.
const closeUp = traced('closeUp', async (name, selector, margin = 16) => {
  const r = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
  if (!r) throw new Error(`no element ${selector}`);
  const x = Math.max(0, r.x - margin);
  const y = Math.max(0, r.y - margin);
  const clip = { x, y, width: Math.min(W - x, r.width + margin * 2), height: Math.min(H - y, r.height + margin * 2), scale: 1 };
  const full = await page.screenshot();
  const crop = await openPage(browser.port);
  try {
    await crop.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    crop.context = `helper closeUp(${name}) crop page`;
    await crop.evaluate(`new Promise((done) => { document.documentElement.style.margin = '0'; document.body.style.margin = '0'; const img = new Image(); img.onload = () => done(true); img.src = 'data:image/png;base64,${full.toString('base64')}'; document.body.append(img); })`, { timeoutMs: 30_000 });
    const { data } = await crop.send('Page.captureScreenshot', { format: 'png', clip }, { timeoutMs: 30_000 });
    const file = path.join(out, `${name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    return { file, width: Math.round(clip.width), height: Math.round(clip.height) };
  } finally {
    await crop.close().catch(() => undefined);
  }
});
// The pointer rests on an element (the surface responds to `pointerenter`; `focus` for keyboard parity).
const hover = traced('hover', async (selector) => {
  const ok = await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false })); return true; })()`);
  if (!ok) throw new Error(`no element ${selector}`);
});
const unhover = traced('unhover', async (selector) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false })); return true; })()`));
const startCapture = () => {
  capturing = true;
  const tick = async () => {
    if (!capturing) return;
    try {
      const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 }, { timeoutMs: 30_000 });
      frames.push(`data:image/jpeg;base64,${data}`);
    } catch {
      // a navigation in flight: skip the frame
    }
    // Four frames a second: the walkthrough plays at that rate, and every capture is a forced paint.
    captureTimer = setTimeout(tick, 250);
  };
  void tick();
};
const stopCapture = () => {
  capturing = false;
  clearTimeout(captureTimer);
};
// Settling drives frames: a headless tab advances its animation clock only when it paints, and the surface has
// no render loop of its own (the DOM is still between changes). Requesting animation frames for the settle time
// gives transitions the frames a visible tab would get for free (no screenshots: painting under software
// rendering is the slow part; a frame request paints once per frame, nothing more).
// Each in-page wait has its own fallback timer; the command that carries it is bounded a little beyond that, so
// a renderer that stops answering fails as that command, never as a hang.
const settle = traced('settle', async (ms = 700) => {
  if (!page) return sleep(ms);
  await page.evaluate(`new Promise((done) => { const end = performance.now() + ${Math.round(ms)}; const tick = () => (performance.now() < end ? requestAnimationFrame(tick) : done()); requestAnimationFrame(tick); setTimeout(done, ${Math.round(ms) + 4000}); })`, { timeoutMs: Math.round(ms) + 12_000 });
});
// Waits, frame by frame, until a painted condition holds (a transition has reached its end, for example).
const untilPainted = traced('untilPainted', async (expression, timeoutMs = 6000) => {
  const ok = await page.evaluate(`new Promise((done) => { const end = performance.now() + ${timeoutMs}; const tick = () => { let v = false; try { v = !!(${expression}); } catch {} if (v) return done(true); if (performance.now() > end) return done(false); requestAnimationFrame(tick); }; requestAnimationFrame(tick); setTimeout(() => done(false), ${timeoutMs + 3000}); })`, { timeoutMs: timeoutMs + 12_000 });
  if (!ok) throw new Error(`not painted in time: ${expression}`);
});
const click = traced('click', async (selector) => {
  const ok = await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView?.({ block: 'center' }); el.click(); return true; })()`);
  if (!ok) throw new Error(`no element ${selector}`);
});
const waitUntil = traced('waitUntil', (expression, timeoutMs) => page.waitUntil(expression, timeoutMs));
const type = traced('type', async (selector, text) => {
  await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
});
const submit = traced('submit', async (selector) => page.evaluate(`(() => { const f = document.querySelector(${JSON.stringify(selector)}); f.requestSubmit(); return true; })()`));
const escape = traced('escape', async () => {
  await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await settle(400);
});
const waitReady = traced('waitReady', async () => {
  await waitUntil(`document.getElementById('app') && !document.getElementById('app').hasAttribute('data-booting') && document.querySelectorAll('.column').length > 0`, 30_000);
  await settle(900);
});
const count = traced('count', (selector) => page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`));
// Motion has two independent layers: the OS / browser preference (`prefers-reduced-motion`, which the application
// honours on start and the stylesheet honours always) and the explicit application mode (`data-motion`, the
// toggle). A runner may start in either; the harness reads the state instead of assuming it.
const motionState = traced('motionState', () => page.evaluate(`(() => { const b = document.getElementById('motion-toggle'); return { mode: document.documentElement.dataset.motion ?? null, osReduce: matchMedia('(prefers-reduced-motion: reduce)').matches, pressed: b ? b.getAttribute('aria-pressed') : null, label: b ? b.textContent.trim() : null }; })()`));
const describeMotion = (s) => `app ${s.mode}, OS ${s.osReduce ? 'reduce' : 'no-preference'}, aria-pressed ${s.pressed}`;
// Drives the real toggle to a target application mode (never a blind click): a click only when the mode differs,
// then an explicit, bounded wait for the dataset and the button's pressed state to agree.
const setMotion = traced('setMotion', async (target) => {
  const from = await motionState();
  if (from.mode === target) return { clicked: false, from, to: from };
  await click('#motion-toggle');
  try {
    await waitUntil(`document.documentElement.dataset.motion === ${JSON.stringify(target)} && document.getElementById('motion-toggle').getAttribute('aria-pressed') === ${JSON.stringify(target === 'reduced' ? 'true' : 'false')}`, 5_000);
  } catch (error) {
    const now = await motionState();
    throw new Error(`the motion toggle did not reach ${target}: initial ${describeMotion(from)}; observed ${describeMotion(now)}`, { cause: error });
  }
  await settle(300);
  return { clicked: true, from, to: await motionState() };
});
// The line layer's geometry against the layout it covers: the SVG size attributes, the company's scroll extent, the
// scroll surface's extent, and the rects the layer must span (the company box plus the goal band). Read only.
const lineLayerGeometry = traced('lineLayerGeometry', () => page.evaluate(`(() => { const c = document.querySelector('.company'); const u = document.querySelector('.universe'); const g = document.querySelector('.goals-host'); const over = document.querySelector('.lines-over'); const under = document.querySelector('.lines-under'); const cr = c.getBoundingClientRect(); const gr = g.getBoundingClientRect(); return { svgH: Number(over.getAttribute('height')), svgUnderH: Number(under.getAttribute('height')), svgW: Number(over.getAttribute('width')), companyScrollH: c.scrollHeight, companyScrollW: c.scrollWidth, universeScrollH: u.scrollHeight, universeClientH: u.clientHeight, universeClientW: u.clientWidth, companyBoxH: Math.round(cr.height), bandH: Math.round(gr.height), unionH: Math.floor(Math.max(cr.height, gr.bottom - cr.top)), unionW: Math.floor(cr.width), builds: Number(c.dataset.builds) }; })()`));
// Forces N line redraws the way the surface itself triggers them (a scroll of the surface schedules one draw per
// frame), lets each one paint before the next, and records the layer's height after every one: a bounded
// in-page loop, one command. Returns how many ran and the distinct heights seen.
const forceRedraws = traced('forceRedraws', (n) => page.evaluate(`new Promise((done) => { const u = document.querySelector('.universe'); const s = document.querySelector('.lines-over'); const heights = new Set(); let i = 0; const frame = () => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 120); }); const loop = async () => { while (i < ${Number(n)}) { u.dispatchEvent(new Event('scroll')); await frame(); heights.add(Number(s.getAttribute('height'))); i += 1; } done({ ran: i, heights: [...heights] }); }; loop(); setTimeout(() => done({ ran: i, heights: [...heights] }), ${Number(n) * 200 + 2000}); })`, { timeoutMs: Number(n) * 200 + 12_000 }));
// What the stylesheet does with motion right now: the ambient drift, the surface's scroll behaviour, a card's tween.
const motionStyles = traced('motionStyles', () => page.evaluate(`({ drift: getComputedStyle(document.querySelector('.stage'), '::before').animationName, scroll: getComputedStyle(document.querySelector('.universe')).scrollBehavior, cardTween: getComputedStyle(document.querySelector('.card')).transitionDuration })`));
// The leader (tether) drawn over the surface: exactly one path, and none of its pieces crosses a card, a
// column head, a goal or a chip (a piece that would is drawn beneath, in the under-layer). Returns the number of
// crossings, or -1 when there is not exactly one leader over the surface.
const leaderCrossings = traced('leaderCrossings', () => page.evaluate(`(() => {
  const paths = [...document.querySelectorAll('.lines-over .line-tether')];
  if (paths.length !== 1) return -1;
  const origin = document.querySelector('.company').getBoundingClientRect();
  const segs = [...paths[0].getAttribute('d').matchAll(/M ([\\d.]+) ([\\d.]+) L ([\\d.]+) ([\\d.]+)/g)].map((m) => m.slice(1).map(Number));
  const blocks = [...document.querySelectorAll('.card, .column-head, .goal, .chip-attention, .founder')].map((e) => e.getBoundingClientRect());
  let n = 0;
  for (const [x0, y0, x1, y1] of segs) {
    const l = Math.min(x0, x1) + origin.left, r = Math.max(x0, x1) + origin.left, t = Math.min(y0, y1) + origin.top, b = Math.max(y0, y1) + origin.top;
    for (const k of blocks) if (l < k.right - 1 && r > k.left + 1 && t < k.bottom - 1 && b > k.top + 1) n++;
  }
  return n;
})()`));
// The context sheet and the Founder's "Needs you" chips never overlap; every chip stays whole and in view.
const chipsClearOfSheet = traced('chipsClearOfSheet', () => page.evaluate(`(() => {
  const s = document.getElementById('focus');
  if (s.hidden) return true;
  const r = s.getBoundingClientRect();
  return [...document.querySelectorAll('.chip-attention, .dock-head')].every((c) => { const k = c.getBoundingClientRect(); return k.right <= r.left + 1 || k.left >= r.right - 1 || k.bottom <= r.top + 1 || k.top >= r.bottom - 1; });
})()`));

try {
  await surface.start();
  const live = await seedLive(surface, world);
  await step('surface-started', () => ({ origin: surface.origin, employees: Object.keys(world.employees).length }));
  browser = await launchBrowser({ width: W, height: H });
  page = await openPage(browser.port);
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  // A headless tab only advances its animation clock when it is the fronted, focused target: the surface's CSS
  // transitions (quieting, sheets) are real motion and must be seen, not skipped. The frames are driven by the
  // settle below; the DevTools Animation domain is deliberately NOT enabled — tracking every transition on the
  // surface (lines, ports, cards) through it makes each interaction five to thirty times slower.
  await page.send('Page.bringToFront').catch(() => undefined);
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
  // Which browser, and how it draws on this host: the product and the GPU backend in use, recorded before the
  // first interaction so a slow or wedged run names its backend (content-free; nothing from the page).
  results.browser = { exe: path.basename(browser.exe), ...(await page.info()), processesAtStart: await browser.processes() };
  console.log(JSON.stringify({ browser: results.browser }));
  const requests = [];
  const consoleLines = [];
  page.on('Network.requestWillBeSent', (p) => requests.push(p.request.url));
  page.on('Network.responseReceived', (p) => { if (p.response.status >= 400) consoleLines.push(`HTTP ${p.response.status} ${p.response.url}`); });
  page.on('Runtime.consoleAPICalled', (p) => consoleLines.push(`${p.type}: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`));
  page.on('Runtime.exceptionThrown', (p) => consoleLines.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`));
  results.console = consoleLines;
  await page.send('Network.enable');
  // D2-UX-01: the proof keeps a handle on the page's change stream, so it can deliver the runtime's own content-free
  // "changed" nudge without writing anything to the Company (a test-only wrapper; the product is untouched).
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: '(() => { const Native = window.EventSource; window.__proofStreams = []; window.EventSource = class extends Native { constructor(...a) { super(...a); window.__proofStreams.push(this); } }; })()' });
  await page.navigate(surface.launchUrl());
  await waitUntil(`location.pathname === '/'`, 20_000);
  await waitReady();
  const ceo = world.employees['company.ceo'].id;

  // --- technical smoke checks (C5 brief §3, on the Tree of Light surface) ---
  await step('spike-company-surface-renders', async () => {
    const renderer = await page.evaluate(`document.documentElement.dataset.renderer`);
    const founder = await count('.founder');
    const ceoCards = await count('.card-ceo');
    const columns = await count('.column');
    const goals = await count('.goal');
    const exec = await count('.line-exec:not(.line-flow)');
    const bundles = await count('.line-bundle:not(.line-casing)');
    const trunk = await count('.line-trunk:not(.line-halo)');
    const bus = await count('.line-branch');
    if (founder !== 1 || ceoCards !== 1 || columns !== 5 || goals < 3 || exec < 2 || bundles < 2 || trunk !== 1 || bus !== 5) throw new Error(`surface: founder ${founder}, ceo ${ceoCards}, columns ${columns}, goals ${goals}, execution lines ${exec}, bundles ${bundles}, trunk ${trunk}, bus ${bus}`);
    results.spike.renderer = renderer;
    results.spike.surface = { columns, goals, executionLines: exec, bundles, bus };
    return { renderer, columns, goals, executionLines: exec, bundles, bus };
  });
  await step('spike-english-ui-content-as-written', async () => {
    // The application is English and left-to-right; company content keeps its own script and direction.
    const lang = await page.evaluate(`document.documentElement.lang + ' ' + document.documentElement.dir`);
    const names = await page.evaluate(`[...document.querySelectorAll('.card-name')].map((n) => n.textContent)`);
    const latin = names.filter((l) => /[A-Za-z]/.test(l)).length;
    const chromeArabic = await page.evaluate(`/[\\u0600-\\u06FF]/.test(document.querySelector('.topbar').textContent + document.querySelector('.bottombar').textContent + [...document.querySelectorAll('.column-name, .goals-title, .dock-title')].map((e) => e.textContent).join(' '))`);
    const font = await page.evaluate(`document.fonts.check('14px "IBM Plex Sans Arabic"')`);
    if (lang !== 'en ltr') throw new Error(`document is ${lang}`);
    if (latin < 10) throw new Error(`only ${latin} Latin names visible`);
    if (chromeArabic) throw new Error('application chrome carries Arabic');
    if (!font) throw new Error('the bundled font did not load');
    results.spike.labels = { latin, font, lang };
    return { latin, font, lang };
  });
  await step('spike-structure-named', async () => {
    const columns = await page.evaluate(`[...document.querySelectorAll('.column-name')].map((t) => t.textContent)`);
    const directorsFirst = await page.evaluate(`[...document.querySelectorAll('.column')].every((c) => c.querySelector('.director .card')?.dataset.rank === 'DIRECTOR' || c.querySelector('.director .card')?.dataset.kind === 'seat')`);
    const ranks = await page.evaluate(`[...new Set([...document.querySelectorAll('.card')].map((c) => c.dataset.rank))].filter(Boolean).length`);
    if (columns.length !== 5) throw new Error(`column names: ${columns.join(', ')}`);
    if (!directorsFirst) throw new Error('a column does not lead with its Director seat');
    if (ranks < 3) throw new Error('fewer than three ranks on the surface');
    results.spike.structure = { columns, ranks };
    return { columns, ranks };
  });
  await step('spike-no-external-asset', async () => {
    const external = requests.filter((u) => !u.startsWith(surface.origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
    if (external.length) throw new Error(`external requests: ${external.slice(0, 3).join(', ')}`);
    results.spike.requests = { total: requests.length, external: 0 };
    return { total: requests.length, external: 0 };
  });
  await step('spike-selection-focus-return', async () => {
    await click(`.card[data-id="employee:${ceo}"]`);
    await waitUntil(`document.getElementById('focus') && !document.getElementById('focus').hidden && document.querySelector('#focus .sheet-title')`, 10_000);
    const title = await page.evaluate(`document.querySelector('#focus .sheet-title').textContent`);
    const lens = await page.evaluate(`document.documentElement.dataset.lens`);
    const quiet = await count('.card.is-quiet');
    // The quieting must be visible, not only a class; and a live refresh never rebuilds an unchanged surface.
    const builds0 = await page.evaluate(`document.querySelector('.company').dataset.builds`);
    await untilPainted(`Number(getComputedStyle(document.querySelector('.card.is-quiet')).opacity) < 0.6`);
    const quietOpacity = await page.evaluate(`Number(getComputedStyle(document.querySelector('.card.is-quiet')).opacity)`);
    await settle(800);
    const builds1 = await page.evaluate(`document.querySelector('.company').dataset.builds`);
    if (builds0 !== builds1) throw new Error(`the surface was rebuilt without a change (${builds0} → ${builds1})`);
    // The context sheet is tethered to the card it is about, and it never covers the strategic direction.
    const tether = await count('.line-tether:not(.is-under)');
    const sheetClear = await page.evaluate(`(() => { const s = document.getElementById('focus').getBoundingClientRect(); const g = document.querySelector('.goals').getBoundingClientRect(); return s.bottom <= g.top + 1; })()`);
    if (tether !== 1 || !sheetClear) throw new Error(`tether ${tether}; sheet clear of the goal band: ${sheetClear}`);
    await escape();
    await settle(200);
    const back = await page.evaluate(`document.documentElement.dataset.lens`);
    const stillQuiet = await count('.card.is-quiet');
    const tetherGone = await count('.line-tether');
    if (lens !== 'EMPLOYEE' || back !== 'LIVE' || quiet < 5 || stillQuiet !== 0 || tetherGone !== 0) throw new Error(`lens ${lens} → ${back}; quiet ${quiet} → ${stillQuiet}; tether ${tetherGone}`);
    results.spike.selection = { title, lens, back, quieted: quiet, quietOpacity, builds: Number(builds1), tether, sheetClearOfGoals: sheetClear };
    return { title, lens, back, quieted: quiet, quietOpacity, builds: Number(builds1), tether, sheetClearOfGoals: sheetClear };
  });
  await step('spike-line-layer-bounded', async () => {
    // Regression proof for the line layer's height: it is read from layout rects (the company box plus the goal
    // band), never from the scroll extent the layer itself creates. Before the fix every redraw grew the layer by
    // one band, the company's and the surface's scroll extents followed, and the renderer crawled until the
    // harness (or the CI step) timed out. Selection, return and twenty forced redraws must leave all three flat.
    const at = { load: await lineLayerGeometry() };
    await click(`.card[data-id="employee:${ceo}"]`);
    await waitUntil(`!document.getElementById('focus').hidden && document.querySelector('.line-tether')`, 10_000);
    await settle(400);
    at.selected = await lineLayerGeometry();
    await escape();
    at.returned = await lineLayerGeometry();
    const redraws = await forceRedraws(20);
    await settle(200);
    at.redrawn = await lineLayerGeometry();
    const phases = Object.keys(at);
    const span = (key) => { const v = phases.map((p) => at[p][key]); return { min: Math.min(...v), max: Math.max(...v) }; };
    const svg = span('svgH');
    const company = span('companyScrollH');
    const universe = span('universeScrollH');
    const width = span('svgW');
    const visibleH = span('universeClientH');
    const visibleW = span('universeClientW');
    // The layer is exactly the company box with the band beneath it, rounded down (so it never opens a scrollbar
    // of its own); every one of the twenty redraws produced that same height; no scroll extent grew across the
    // phases; and the visible surface never changed size (its scrollbars never came and went).
    const expected = at.redrawn.unionH;
    const describe = () => phases.map((p) => `${p}: svg ${at[p].svgH}×${at[p].svgW}, company scroll ${at[p].companyScrollH}, surface scroll ${at[p].universeScrollH} in ${at[p].universeClientW}×${at[p].universeClientH} visible, box ${at[p].companyBoxH} + band ${at[p].bandH} = ${at[p].unionW}×${at[p].unionH}`).join('; ');
    if (redraws.ran !== 20) throw new Error(`only ${redraws.ran} of 20 forced redraws ran (${describe()})`);
    if (redraws.heights.length !== 1 || svg.max - svg.min > 0 || width.max - width.min > 0) throw new Error(`the line layer is not stable across redraws: heights ${redraws.heights.join(', ')}; by phase ${svg.min} → ${svg.max}, width ${width.min} → ${width.max} (${describe()})`);
    if (at.redrawn.svgH !== expected || at.redrawn.svgUnderH !== expected || at.redrawn.svgW !== at.redrawn.unionW) throw new Error(`the line layer is ${at.redrawn.svgW}×${at.redrawn.svgH} (under ${at.redrawn.svgUnderH}) but the company box with the band is ${at.redrawn.unionW}×${expected} (${describe()})`);
    if (company.max - company.min > 0) throw new Error(`the company scroll extent grows across redraws: ${company.min} → ${company.max} (${describe()})`);
    if (universe.max - universe.min > 0) throw new Error(`the surface scroll extent grows across redraws: ${universe.min} → ${universe.max} (${describe()})`);
    if (visibleH.max - visibleH.min > 0 || visibleW.max - visibleW.min > 0) throw new Error(`the surface's scrollbars came and went across redraws: visible ${visibleW.min}–${visibleW.max} × ${visibleH.min}–${visibleH.max} (${describe()})`);
    const detail = { redraws: redraws.ran, redrawHeights: redraws.heights, svgHeight: svg, svgWidth: width, companyScrollHeight: company, surfaceScrollHeight: universe, surfaceVisible: { width: at.redrawn.universeClientW, height: at.redrawn.universeClientH }, expected: { width: at.redrawn.unionW, height: expected }, phases: at };
    results.spike.lineLayer = detail;
    return detail;
  });
  await step('spike-surface-idle-after-selection', async () => {
    // The refresh-storm proof (D-C5-17): a selection and a return are the interaction that used to start it. The
    // surface refreshes on the runtime's "changed" announcement and refreshes with Founder reads; while reads
    // announced, one selection meant hundreds of requests a second, forever. After the return and a grace
    // period for the return's own refresh, an idle surface must stop asking: at most one refresh cycle (a
    // universe read and its companions) may still land in three seconds, never a storm.
    const api = (list) => list.filter((u) => u.includes('/api/'));
    const cycles = (list) => list.filter((u) => u.includes('/api/universe')).length;
    await click(`.card[data-id="employee:${ceo}"]`);
    await waitUntil(`!document.getElementById('focus').hidden && document.querySelector('#focus .sheet-title')`, 10_000);
    await settle(400);
    const whileOpen = requests.length;
    await settle(1500);
    const openIdle = api(requests.slice(whileOpen));
    await escape();
    await waitUntil(`document.documentElement.dataset.lens === 'LIVE'`, 10_000);
    await settle(1000);
    const from = requests.length;
    await settle(3000);
    const idle = api(requests.slice(from));
    const byPath = {};
    for (const u of idle) { const p = u.replace(/^https?:\/\/[^/]+/, '').replace(/[0-9a-f-]{36}/g, ':id').replace(/\?.*$/, ''); byPath[p] = (byPath[p] ?? 0) + 1; }
    if (cycles(openIdle) > 1 || openIdle.length > 6) throw new Error(`the surface keeps refreshing while a sheet is open and nothing changes: ${openIdle.length} API requests in 1.5 s (${cycles(openIdle)} refresh cycles)`);
    if (cycles(idle) > 1 || idle.length > 5) throw new Error(`the surface keeps refreshing while idle after a selection: ${idle.length} API requests in 3 s, ${cycles(idle)} refresh cycles: ${JSON.stringify(byPath)}`);
    const detail = { sheetOpenIdleMs: 1500, apiRequestsWhileSheetOpen: openIdle.length, idleMs: 3000, apiRequestsWhileIdle: idle.length, refreshCyclesWhileIdle: cycles(idle), byPath };
    results.spike.idle = detail;
    return detail;
  });
  await step('spike-reduced-motion-parity', async () => {
    // Parity of meaning, not of pixels: every card, goal, column name and line that Company Live shows in full
    // motion is still shown in reduced motion; only the tweens and the ambient drift go.
    // State-aware: the runner may prefer reduced motion at the OS level, and the application honours that on
    // start, so the smoke reads where it begins, drives the real toggle to `reduced` only when needed, proves
    // parity there, exercises the toggle back to `full`, and leaves the application as it found it.
    const marksExpr = `[...document.querySelectorAll('.card, .goal, .column-name, .line-exec, .line-bundle, .line-trunk, .line-branch, .chip-attention')].map((e) => e.dataset.id || e.textContent || e.getAttribute('class')).sort()`;
    const initial = await motionState();
    if (initial.mode !== 'reduced' && initial.mode !== 'full') throw new Error(`the application has no motion mode: ${describeMotion(initial)}`);
    const before = await page.evaluate(marksExpr);
    const toReduced = await setMotion('reduced');
    const reduced = await motionState();
    const inReduced = await motionStyles();
    const after = await page.evaluate(marksExpr);
    const missing = before.filter((x) => !after.includes(x));
    // In the application's reduced mode every mark stays and every tween goes, whatever the OS prefers.
    if (reduced.mode !== 'reduced' || reduced.pressed !== 'true' || !/reduced/i.test(reduced.label ?? '')) throw new Error(`reduced mode not reached: initial ${describeMotion(initial)}; now ${describeMotion(reduced)}`);
    if (after.length < 20 || missing.length > 0) throw new Error(`reduced motion loses marks: missing ${missing.length} of ${before.length} (${describeMotion(reduced)})`);
    if (inReduced.drift !== 'none' || inReduced.scroll !== 'auto' || inReduced.cardTween !== '0s') throw new Error(`reduced motion still moves: drift ${inReduced.drift}, scroll ${inReduced.scroll}, card tween ${inReduced.cardTween} (${describeMotion(reduced)})`);
    // The real toggle in the other direction: the application goes to `full` and keeps every mark. The ambient
    // drift resumes only when the OS itself does not prefer reduced motion (the stylesheet honours the OS too).
    const toFull = await setMotion('full');
    const full = await motionState();
    const inFull = await motionStyles();
    const afterFull = await page.evaluate(marksExpr);
    const missingFull = before.filter((x) => !afterFull.includes(x));
    if (full.mode !== 'full' || full.pressed !== 'false' || !/full/i.test(full.label ?? '')) throw new Error(`full mode not reached: ${describeMotion(full)}`);
    if (missingFull.length > 0) throw new Error(`full motion loses marks: missing ${missingFull.length} of ${before.length}`);
    if (!full.osReduce && (inFull.drift === 'none' || inFull.scroll !== 'smooth')) throw new Error(`full motion did not resume although the OS prefers motion: drift ${inFull.drift}, scroll ${inFull.scroll}`);
    if (full.osReduce && inFull.drift !== 'none') throw new Error(`the OS prefers reduced motion but the ambient drift runs in app full mode: ${inFull.drift}`);
    // Leave the application as it was found: its initial mode, and no stored preference the smoke created.
    const restored = await setMotion(initial.mode);
    await page.evaluate(`(() => { try { localStorage.removeItem('qandeel.reducedMotion'); } catch {} return true; })()`);
    const detail = { initial: describeMotion(initial), osPrefersReduced: initial.osReduce, marks: after.length, toReduced: toReduced.clicked ? 'clicked' : 'already', reducedStyles: inReduced, toFull: toFull.clicked ? 'clicked' : 'already', fullStyles: inFull, restoredTo: restored.to.mode };
    results.spike.reducedMotion = detail;
    return detail;
  });
  await step('spike-activation-english-chrome', async () => {
    // C5-CORR-01: the Activation surface (L1-02) is application chrome like the rest — English and left-to-right —
    // while company / Founder content in it keeps its own script and direction. The rule is semantic, never "no
    // Arabic in the DOM": chrome is everything in the surface except the named content places (the Employee's Arabic
    // display name, an answer or brief body, the Founder's feedback) and the values the Founder typed; the Founder's
    // Arabic command below must stay Arabic and right-to-left. Content is named by place, never by the `.content`
    // class alone, so chrome dressed as content (the L1-02 regression's bilingual stage labels) still fails.
    const AR = '/[\\u0600-\\u06FF]/';
    const CONTENT = JSON.stringify('.act-name-ar, .act-answer-body, blockquote.content');
    const inspect = () => page.evaluate(`(() => {
      const section = document.querySelector('#palette .activation');
      const clone = section.cloneNode(true);
      clone.querySelectorAll(${CONTENT}).forEach((c) => c.remove());
      const placeholders = [...section.querySelectorAll('[placeholder]')].map((e) => e.getAttribute('placeholder'));
      const labels = [...section.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'));
      const chrome = [clone.textContent, document.querySelector('#palette .palette-result')?.textContent ?? '', ...placeholders, ...labels].join(' ');
      const content = [...section.querySelectorAll(${CONTENT})];
      return {
        title: section.querySelector('.section-title')?.textContent ?? null,
        direction: getComputedStyle(section).direction,
        stages: section.querySelectorAll('.act-stages li').length,
        next: section.querySelector('.act-next')?.textContent.trim() ?? null,
        chromeArabic: ${AR}.test(chrome),
        chromeChars: chrome.length,
        arabicContent: content.filter((c) => ${AR}.test(c.textContent)).length,
        arabicContentNotRtl: content.filter((c) => ${AR}.test(c.textContent) && getComputedStyle(c).direction !== 'rtl').length,
        button: document.getElementById('activation-open').textContent.trim(),
      };
    })()`);
    const check = (r, how) => {
      if (r.chromeArabic) throw new Error(`${how}: the Activation chrome carries Arabic (title ${r.title}; next ${r.next})`);
      if (r.title !== 'Activate the Company' || r.direction !== 'ltr' || r.stages !== 10 || !r.next) throw new Error(`${how}: title ${r.title}, direction ${r.direction}, stages ${r.stages}, next ${r.next}`);
      if (r.button !== 'Activate the Company') throw new Error(`${how}: the top-bar control reads ${JSON.stringify(r.button)}`);
      if (r.arabicContentNotRtl > 0) throw new Error(`${how}: ${r.arabicContentNotRtl} Arabic content block(s) not right-to-left`);
    };
    // 1. The top-bar control opens it (a read: no fact changes).
    await click('#activation-open');
    await waitUntil(`!document.getElementById('palette').hidden && document.querySelector('#palette .activation .act-stages')`, 15_000);
    await settle(600);
    const byButton = await inspect();
    check(byButton, 'top-bar control');
    if (!values.spike) await shot('00-activation-english-chrome');
    // 2. The Founder's own Arabic command reaches the same surface: the typed text stays Arabic and right-to-left
    // (Founder content), and the chrome around it is still English.
    const command = 'تفعيل الشركة';
    await page.evaluate(`(() => { document.querySelector('#palette .activation').dataset.proofStale = '1'; return true; })()`);
    await type('.palette-input', command);
    await submit('.palette-form');
    await waitUntil(`document.querySelector('#palette .activation:not([data-proof-stale]) .act-stages') && document.querySelector('#palette .palette-form .btn-primary')?.textContent === 'Go'`, 15_000);
    await settle(600);
    const byArabic = await inspect();
    check(byArabic, 'Arabic command');
    const typed = await page.evaluate(`(() => { const i = document.querySelector('#palette .palette-input'); return { value: i.value, direction: getComputedStyle(i).direction, matches: i.matches(':dir(rtl)') }; })()`);
    if (typed.value !== command || !typed.matches) throw new Error(`the Founder's Arabic command did not keep its script and direction: ${JSON.stringify(typed)}`);
    // Leave the surface as the next checks expect it: a fresh page (the palette's result is client state only).
    await page.navigate(`${surface.origin}/`);
    await waitReady();
    const detail = { title: byButton.title, direction: byButton.direction, stages: byButton.stages, next: byButton.next, chromeArabic: false, chromeChars: byButton.chromeChars, arabicContentBlocks: byArabic.arabicContent, founderArabicCommand: { kept: true, direction: 'rtl' } };
    results.spike.activation = detail;
    return detail;
  });
  // D2-UX-01 review: a live refresh (the runtime's "changed" nudge on the page's own stream; nothing is written to the
  // Company) leaves the Founder where they were — on the same Academy link with the reading position kept, and in the
  // budget amount with the draft, caret and selection kept. Nothing is submitted, previewed or written.
  await step('spike-refresh-keeps-focus', async () => {
    const writes = [];
    page.on('Network.requestWillBeSent', (p) => { if (p.request.method !== 'GET') writes.push(`${p.request.method} ${new URL(p.request.url).pathname}`); });
    const key = async (k, code, vk) => {
      await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
      await settle(150);
    };
    // Marks the region's current element stale, delivers the nudge, and waits for the region to be rebuilt.
    const liveRefresh = async (selector) => {
      const sent = await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return -1; el.dataset.proofStale = '1'; let n = 0; for (const s of window.__proofStreams ?? []) if (s.readyState === 1) { s.dispatchEvent(new MessageEvent('changed', { data: '{}' })); n += 1; } return n; })()`);
      if (sent < 1) throw new Error(`no live refresh could be delivered (${sent === -1 ? `no ${selector}` : 'no open change stream'})`);
      await waitUntil(`document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(`${selector}[data-proof-stale]`)})`, 15_000);
      await settle(400);
    };
    const where = () => page.evaluate(`(() => { const a = document.activeElement; const hall = document.getElementById('hall'); return { label: a?.getAttribute('aria-label') ?? null, id: a?.id || null, inHall: hall.contains(a), hallScroll: hall.scrollTop, value: a && 'value' in a ? a.value : null, start: a?.selectionStart ?? null, end: a?.selectionEnd ?? null }; })()`);

    // 1. The Academy: Tab from one employee link to the next, scroll the overview, then a live refresh.
    await click('#academy-open');
    await waitUntil(`document.querySelectorAll('#hall .academy-name').length >= 3`, 15_000);
    await settle(300);
    await page.evaluate(`document.querySelector('#hall .academy-name').focus()`);
    await key('Tab', 'Tab', 9);
    const onLink = await where();
    const second = await page.evaluate(`document.querySelectorAll('#hall .academy-name')[1].getAttribute('aria-label')`);
    if (onLink.label !== second) throw new Error(`Tab did not reach the next employee link: ${JSON.stringify(onLink)}`);
    const scrolled = await page.evaluate(`(() => { const h = document.getElementById('hall'); h.scrollTop = Math.min(140, h.scrollHeight - h.clientHeight); return h.scrollTop; })()`);
    await liveRefresh('#hall .hall-body');
    const afterAcademy = await where();
    if (afterAcademy.label !== second || !afterAcademy.inHall || Math.abs(afterAcademy.hallScroll - scrolled) > 1) throw new Error(`a live refresh moved the Founder in the Academy: was on ${second} at ${scrolled}px, now ${JSON.stringify(afterAcademy)}`);
    await key('Tab', 'Tab', 9);
    const third = await page.evaluate(`document.querySelectorAll('#hall .academy-name')[2].getAttribute('aria-label')`);
    const next = await where();
    if (next.label !== third) throw new Error(`keyboard navigation did not continue after the refresh: ${JSON.stringify(next)}`);
    await key('Escape', 'Escape', 27);
    const closed = await page.evaluate(`({ hidden: document.getElementById('hall').hidden, back: document.activeElement?.id })`);
    if (!closed.hidden || closed.back !== 'academy-open') throw new Error(`Escape no longer closes the Academy back to its opener: ${JSON.stringify(closed)}`);

    // 2. The budget amount: typed with the keyboard, part of it selected, then a live refresh, then typing goes on.
    await click(`.card[data-id="employee:${ceo}"]`);
    await waitUntil(`document.querySelector('#focus .sheet-primary')`, 10_000);
    await click('#focus .sheet-primary .btn-quiet');
    await waitUntil(`document.activeElement?.id === 'budget-amount'`, 5_000);
    await page.send('Input.insertText', { text: '35000' });
    await page.evaluate(`document.getElementById('budget-amount').setSelectionRange(1, 3)`);
    await liveRefresh('#budget-amount');
    const afterBudget = await where();
    if (afterBudget.id !== 'budget-amount' || afterBudget.value !== '35000' || afterBudget.start !== 1 || afterBudget.end !== 3) throw new Error(`a live refresh interrupted the budget entry: ${JSON.stringify(afterBudget)}`);
    await page.send('Input.insertText', { text: '9' });
    const typed = await where();
    if (typed.value !== '3900' || typed.start !== 2) throw new Error(`typing did not continue at the caret after the refresh: ${JSON.stringify(typed)}`);
    const preview = await page.evaluate(`!document.getElementById('preview').hidden`);
    await key('Escape', 'Escape', 27);
    const budgetClosed = await page.evaluate(`({ editor: !!document.querySelector('#focus .budget-editor'), back: document.activeElement?.getAttribute('aria-label') ?? null })`);
    if (preview || budgetClosed.editor || !/^Budget of /.test(budgetClosed.back ?? '')) throw new Error(`the budget entry did not stay a draft closed by Escape: preview ${preview}, ${JSON.stringify(budgetClosed)}`);
    if (writes.length) throw new Error(`a refresh or a keystroke wrote to the Company: ${writes.join(', ')}`);
    await page.navigate(`${surface.origin}/`);
    await waitReady();
    const detail = { academy: { link: 'kept', scrollPx: scrolled, tabContinues: true, escapeReturnsToOpener: true }, budget: { focus: 'kept', draft: 'kept', selection: [1, 3], typingContinues: true, previewOpened: false }, writes: 0 };
    results.spike.refreshKeepsFocus = detail;
    return detail;
  });
  await step('spike-chat-screen', async () => {
    // P1-CHAT-INTEL-01: Talk opens a dedicated Chat screen (not a sheet), the reply comes from the governed run with its
    // state under the message, no work card enters the transcript, × and Escape close without stopping anything, an
    // unsent draft survives close / reopen and a page refresh, and the history is the same conversation every time.
    const lead = world.employees['product.lead-1'].id;
    await page.navigate(`${surface.origin}/`);
    await waitReady();
    await click(`.card[data-id="employee:${ceo}"]`);
    await waitUntil(`document.querySelector('#focus .sheet-primary .btn-primary') && document.querySelector('#focus .sheet-close')`, 10_000);
    const profileClose = await page.evaluate(`(() => { const b = document.querySelector('#focus .sheet-close'); const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), label: b.getAttribute('aria-label'), visible: r.width > 0 && r.height > 0 }; })()`);
    if (profileClose.text !== '×' || !profileClose.visible) throw new Error(`the profile has no visible ×: ${JSON.stringify(profileClose)}`);
    const intelligence = await page.evaluate(`[...document.querySelectorAll('#focus .sheet-section h3')].some((h) => h.textContent === 'Employee Intelligence') && document.querySelectorAll('#focus .intel-level').length === 4`);
    if (!intelligence) throw new Error('the profile does not show Employee Intelligence with four levels');
    await shot('p1-01-profile-intelligence');
    await page.evaluate(`(() => { const s = [...document.querySelectorAll('#focus .sheet-section')].find((x) => x.querySelector('h3')?.textContent === 'Employee Intelligence'); s.dataset.proof = 'intelligence'; s.scrollIntoView({ block: 'center' }); return true; })()`);
    await settle(300);
    await closeUp('p1-01b-employee-intelligence', '#focus [data-proof="intelligence"]', 12);
    await click('#focus .sheet-primary .btn-primary');
    await waitUntil(`document.documentElement.dataset.lens === 'CONVERSATION' && !document.getElementById('chat').hidden && document.querySelectorAll('#chat .chat-msg').length >= 2`, 15_000);
    const screen = await page.evaluate(`(() => { const c = document.getElementById('chat').getBoundingClientRect(); const s = document.querySelector('.stage').getBoundingClientRect(); return { focusHidden: document.getElementById('focus').hidden, cover: Math.round(c.width) === Math.round(s.width) && Math.round(c.height) === Math.round(s.height), title: document.getElementById('chat-title')?.textContent ?? null, close: document.querySelector('#chat .chat-close')?.textContent.trim() ?? null }; })()`);
    if (!screen.focusHidden || !screen.cover || screen.close !== '×') throw new Error(`Talk did not open a dedicated chat screen: ${JSON.stringify(screen)}`);
    const historyBefore = await count('#chat .chat-msg');
    // Send in Arabic; the reply comes from the CEO's governed run and its state shows under the message.
    await type('#chat .chat-composer textarea', 'ما الذي تحتاجه مني هذا الأسبوع؟');
    await submit('#chat .chat-composer');
    await waitUntil(`document.querySelectorAll('#chat .chat-msg').length >= ${historyBefore + 2} && document.querySelector('#chat .chat-msg.from-founder:last-of-type .chat-status.status-replied, #chat .chat-status.status-replied')`, 60_000);
    await settle(800);
    await shot('p1-02-chat-replied');
    const transcript = await page.evaluate(`({ cards: document.querySelectorAll('#chat .work, #chat .card, #chat .chip-state, #chat .work-list').length, statuses: [...document.querySelectorAll('#chat .chat-status')].map((s) => s.className.replace('chat-status ', '')), dirs: [...document.querySelectorAll('#chat .chat-text')].map((b) => getComputedStyle(b).direction + ':' + (/[\\u0600-\\u06FF]/.test(b.textContent) ? 'ar' : 'en')), chrome: getComputedStyle(document.querySelector('#chat .chat-composer')).direction, writing: document.querySelectorAll('#chat .chat-typing').length })`);
    if (transcript.cards !== 0) throw new Error(`work cards appear in the chat: ${transcript.cards}`);
    if (!transcript.dirs.includes('rtl:ar') || transcript.chrome !== 'ltr') throw new Error(`directions ${JSON.stringify(transcript)}`);
    // Levels: the fixture's CEO tops out at E2, so E3 / E4 are shown, explained and never sendable.
    const levels = await page.evaluate(`[...document.querySelectorAll('#chat .chat-level')].map((b) => [b.querySelector('.chat-level-name').textContent, b.getAttribute('aria-disabled') === 'true'])`);
    await click('#chat .chat-level[data-keep="chat-level-E3"]');
    const explained = await page.evaluate(`document.querySelector('#chat .chat-level-note').textContent`);
    if (!/maximum|provisioned|route/.test(explained)) throw new Error(`an unavailable level is not explained: "${explained}"`);
    await shot('p1-03-level-explained');
    // An unsent draft, then × — back to the profile; the Company is still running; nothing was sent.
    const messagesBeforeDraft = await count('#chat .chat-msg');
    await type('#chat .chat-composer textarea', 'مسودة لم تُرسل بعد');
    await click('#chat .chat-close');
    await waitUntil(`document.getElementById('chat').hidden && document.documentElement.dataset.lens === 'EMPLOYEE' && !document.getElementById('focus').hidden && document.querySelector('#focus .sheet-primary .btn-primary')`, 10_000);
    const running = await page.evaluate(`fetch('/api/session', { credentials: 'same-origin' }).then((r) => r.status)`);
    if (running !== 200) throw new Error(`closing the chat stopped something: session ${running}`);
    await click('#focus .sheet-primary .btn-primary');
    await waitUntil(`!document.getElementById('chat').hidden && document.querySelectorAll('#chat .chat-msg').length >= ${messagesBeforeDraft}`, 15_000);
    const reopened = await page.evaluate(`({ draft: document.querySelector('#chat .chat-composer textarea').value, msgs: document.querySelectorAll('#chat .chat-msg').length })`);
    if (reopened.draft !== 'مسودة لم تُرسل بعد' || reopened.msgs !== messagesBeforeDraft) throw new Error(`reopening lost the draft or the history: ${JSON.stringify(reopened)}`);
    // A page refresh: the same conversation and the same draft come back.
    await page.navigate(`${surface.origin}/`);
    await waitReady();
    await click(`.card[data-id="employee:${ceo}"]`);
    await waitUntil(`document.querySelector('#focus .sheet-primary .btn-primary')`, 10_000);
    await click('#focus .sheet-primary .btn-primary');
    await waitUntil(`!document.getElementById('chat').hidden && document.querySelectorAll('#chat .chat-msg').length >= ${messagesBeforeDraft}`, 15_000);
    const refreshed = await page.evaluate(`({ draft: document.querySelector('#chat .chat-composer textarea').value, msgs: document.querySelectorAll('#chat .chat-msg').length })`);
    if (refreshed.draft !== 'مسودة لم تُرسل بعد' || refreshed.msgs !== messagesBeforeDraft) throw new Error(`a refresh lost the draft or the history: ${JSON.stringify(refreshed)}`);
    // Escape closes the chat back to the profile; the profile's × closes to the company.
    await page.evaluate(`document.querySelector('#chat .chat-composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await waitUntil(`document.getElementById('chat').hidden && document.documentElement.dataset.lens === 'EMPLOYEE' && document.querySelector('#focus .sheet-close')`, 10_000);
    await click('#focus .sheet-close');
    await waitUntil(`document.getElementById('focus').hidden && document.documentElement.dataset.lens === 'LIVE'`, 10_000);
    // Another person's chat: their own conversation, its own identity.
    await click(`.card[data-id="employee:${lead}"]`);
    await waitUntil(`document.querySelector('#focus .sheet-primary .btn-primary')`, 10_000);
    await click('#focus .sheet-primary .btn-primary');
    await waitUntil(`!document.getElementById('chat').hidden && document.querySelectorAll('#chat .chat-msg').length >= 1`, 15_000);
    const other = await page.evaluate(`({ draft: document.querySelector('#chat .chat-composer textarea').value, title: document.getElementById('chat-title').textContent })`);
    if (other.draft !== '') throw new Error('a draft leaked into another conversation');
    // A narrow window keeps the conversation usable (the side panel folds away).
    await page.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 820, deviceScaleFactor: 1, mobile: false });
    await settle(500);
    const narrow = await page.evaluate(`({ side: getComputedStyle(document.querySelector('#chat .chat-side')).display, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })`);
    await shot('p1-04-chat-narrow');
    await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await settle(500);
    await shot('p1-05-chat-employee');
    if (narrow.side !== 'none' || narrow.overflow) throw new Error(`narrow layout ${JSON.stringify(narrow)}`);
    const detail = { dedicatedScreen: true, profileClose: profileClose.text, statuses: transcript.statuses, workCardsInChat: transcript.cards, directions: transcript.dirs, levels, draftKept: { close: true, refresh: true }, runtimeAfterClose: running, otherConversation: other.title, narrow };
    results.spike.chatScreen = detail;
    await page.navigate(`${surface.origin}/`);
    await waitReady();
    return detail;
  });
  await step('spike-chat-race', async () => {
    // CORR-02: a send settles only the conversation it started from. The browser holds A's POST (CDP Fetch) while the
    // Founder closes A and opens B's chat: A's success, then A's failure, never touch B's draft, composer or error; A
    // keeps its own message (once) or its own draft and retry key.
    const lead = world.employees['product.lead-1'].id;
    const held = [];
    let holding = false;
    page.on('Fetch.requestPaused', (p) => {
      if (holding && p.request.method === 'POST' && /\/api\/threads\/[^/]+\/messages/.test(p.request.url)) held.push(p.requestId);
      else void page.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => undefined);
    });
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/threads/*', requestStage: 'Request' }] });
    const openChat = async (employeeId) => {
      await page.navigate(`${surface.origin}/`);
      await waitReady();
      await click(`.card[data-id="employee:${employeeId}"]`);
      await waitUntil(`document.querySelector('#focus .sheet-primary .btn-primary')`, 10_000);
      await click('#focus .sheet-primary .btn-primary');
      await waitUntil(`!document.getElementById('chat').hidden && document.querySelector('#chat .chat-list li')`, 15_000);
    };
    // In-page navigation keeps the screen (and A's send in flight): × back to the profile, × to the company, B's Talk.
    const switchTo = async (employeeId) => {
      await click('#chat .chat-close');
      await waitUntil(`document.getElementById('chat').hidden && document.querySelector('#focus .sheet-close')`, 10_000);
      await click('#focus .sheet-close');
      await waitUntil(`document.getElementById('focus').hidden`, 10_000);
      await click(`.card[data-id="employee:${employeeId}"]`);
      await waitUntil(`document.querySelector('#focus .sheet-primary .btn-primary')`, 10_000);
      await click('#focus .sheet-primary .btn-primary');
      await waitUntil(`!document.getElementById('chat').hidden && document.querySelector('#chat .chat-list li')`, 15_000);
    };
    const composer = () => page.evaluate(`({ title: document.getElementById('chat-title').textContent, text: document.querySelector('#chat .chat-composer textarea').value, readOnly: document.querySelector('#chat .chat-composer textarea').readOnly, send: document.querySelector('#chat .chat-send').textContent, error: document.querySelector('#chat .chat-error').textContent, mode: document.querySelector('#chat .chat-modes [aria-checked="true"]')?.dataset.keep ?? null })`);
    const founderCount = (text) => page.evaluate(`[...document.querySelectorAll('#chat .chat-msg.from-founder .chat-text')].filter((b) => b.textContent === ${JSON.stringify(text)}).length`);
    try {
      await openChat(ceo);
      const aTitle = (await composer()).title;
      // 1. A succeeds while B is shown.
      await type('#chat .chat-composer textarea', 'سؤال أ أثناء التنقل');
      holding = true;
      await submit('#chat .chat-composer');
      await waitUntil(`document.querySelector('#chat .chat-send').textContent === 'Sending…'`, 10_000);
      for (let i = 0; i < 50 && held.length === 0; i++) await sleep(100);
      if (held.length !== 1) throw new Error(`A's send was not held (${held.length})`);
      await switchTo(lead);
      await type('#chat .chat-composer textarea', 'مسودة ب');
      await click('#chat .chat-modes [data-keep="chat-mode-NOTE"]');
      const bBefore = await composer();
      holding = false;
      await page.send('Fetch.continueRequest', { requestId: held.shift() });
      await settle(1500);
      const bAfter = await composer();
      if (JSON.stringify(bAfter) !== JSON.stringify(bBefore) || bAfter.text !== 'مسودة ب' || bAfter.readOnly || bAfter.title === aTitle) throw new Error(`A's success changed B: ${JSON.stringify({ bBefore, bAfter })}`);
      await shot('p1-06-race-b-intact');
      await switchTo(ceo);
      await waitUntil(`[...document.querySelectorAll('#chat .chat-msg.from-founder .chat-text')].some((b) => b.textContent === 'سؤال أ أثناء التنقل')`, 15_000);
      const aBack = await composer();
      const aOnce = await founderCount('سؤال أ أثناء التنقل');
      if (aBack.text !== '' || aOnce !== 1) throw new Error(`A after success: ${JSON.stringify({ aBack, aOnce })}`);
      // 2. A fails (connection) while B is shown: A keeps its draft and key; B is untouched.
      await type('#chat .chat-composer textarea', 'رسالة أ ستفشل');
      holding = true;
      await submit('#chat .chat-composer');
      for (let i = 0; i < 50 && held.length === 0; i++) await sleep(100);
      if (held.length !== 1) throw new Error(`A's second send was not held (${held.length})`);
      await switchTo(lead);
      const b2Before = await composer();
      holding = false;
      await page.send('Fetch.failRequest', { requestId: held.shift(), errorReason: 'ConnectionFailed' });
      await settle(1200);
      const b2After = await composer();
      if (JSON.stringify(b2After) !== JSON.stringify(b2Before) || b2After.text !== 'مسودة ب') throw new Error(`A's failure changed B: ${JSON.stringify({ b2Before, b2After })}`);
      await switchTo(ceo);
      const aFailed = await composer();
      if (aFailed.text !== 'رسالة أ ستفشل' || !/Not confirmed/.test(aFailed.error) || aFailed.readOnly) throw new Error(`A after failure: ${JSON.stringify(aFailed)}`);
      await shot('p1-07-race-a-kept');
      // The retry with A's kept key sends once.
      await submit('#chat .chat-composer');
      await waitUntil(`[...document.querySelectorAll('#chat .chat-msg.from-founder .chat-text')].some((b) => b.textContent === 'رسالة أ ستفشل') && document.querySelector('#chat .chat-composer textarea').value === ''`, 15_000);
      const retried = await founderCount('رسالة أ ستفشل');
      if (retried !== 1) throw new Error(`the retry duplicated: ${retried}`);
      const detail = { bIntactAfterASuccess: true, aSentOnce: aOnce, bIntactAfterAFailure: true, aDraftKept: aFailed.text, aError: aFailed.error, retrySentOnce: retried };
      results.spike.chatRace = detail;
      return detail;
    } finally {
      holding = false;
      for (const id of held.splice(0)) await page.send('Fetch.continueRequest', { requestId: id }).catch(() => undefined);
      await page.send('Fetch.disable').catch(() => undefined);
      await page.navigate(`${surface.origin}/`);
      await waitReady();
    }
  });
  if (values.spike) {
    console.log(JSON.stringify({ verdict: 'C5 TECHNICAL SPIKE — PASS', spike: results.spike }));
  } else {
    // --- Scenario frames and the walkthrough ---
    if (!minimal) startCapture();
    await step('A-company-live', async () => {
      await settle(1500);
      await shot('01-company-live');
      const signals = await page.evaluate(`document.getElementById('health').textContent`);
      const railOpen = await page.evaluate(`!document.getElementById('rail').hidden`);
      const chips = await count('.chip-attention');
      if (railOpen) throw new Error('the attention rail is open before anything was asked');
      if (chips < 1) throw new Error('nothing beside the Founder although decisions are pending');
      return { signals, attentionChips: chips };
    });
    await step('B-employee-focus', async () => {
      const seo = world.employees['growth.seo-1'].id;
      await click(`.card[data-id="employee:${seo}"]`);
      await waitUntil(`!document.getElementById('focus').hidden && document.querySelector('#focus .chain li')`, 10_000);
      await untilPainted(`Number(getComputedStyle(document.querySelector('.card.is-quiet')).opacity) < 0.6`);
      await settle(600);
      await shot('02-employee-focus');
      const chain = await page.evaluate(`document.querySelectorAll('#focus .chain li').length`);
      const relations = await count('.line-relation');
      const lit = await page.evaluate(`document.querySelectorAll('.card.is-chain').length`);
      const namedGoal = await page.evaluate(`[...document.querySelectorAll('#focus .work-goal')].some((g) => g.textContent.trim().length > 0)`);
      const tether = await count('.line-tether:not(.is-under)');
      if (!namedGoal || tether !== 1) throw new Error(`the goal a work item serves is named: ${namedGoal}; tether ${tether}`);
      // A person in the Growth column: the sheet docks on the right, beneath the Founder's chips (never over
      // them), and the leader that crosses two columns to reach it writes over no card.
      const belowDesk = await page.evaluate(`document.getElementById('focus').classList.contains('is-below-desk')`);
      const chipsClear = await chipsClearOfSheet();
      const crossings = await leaderCrossings();
      const underPieces = await count('.line-tether.is-under');
      if (!belowDesk || !chipsClear || crossings !== 0) throw new Error(`sheet below the desk ${belowDesk}; chips clear of the sheet ${chipsClear}; leader crossings ${crossings}`);
      return { chainLinks: chain, relationLines: relations, chainCards: lit, tether, sheetBelowDesk: belowDesk, chipsClearOfSheet: chipsClear, leaderCrossings: crossings, leaderPiecesBeneath: underPieces };
    });
    await step('C-goal-focus', async () => {
      await click(`.goal[data-id="goal:${world.goals.saudi}"]`);
      await waitUntil(`document.documentElement.dataset.lens === 'GOAL' && document.querySelector('#focus .goal-path')`, 10_000);
      await untilPainted(`Number(getComputedStyle(document.querySelector('.goal.is-quiet')).opacity) < 0.6`);
      await settle(600);
      await shot('03-goal-focus');
      const work = await page.evaluate(`document.querySelectorAll('#focus .work').length`);
      const brightExec = await page.evaluate(`[...document.querySelectorAll('.line-exec:not(.line-flow)')].filter((l) => !l.classList.contains('is-quiet')).length`);
      const litExec = await count('.line-exec.is-lit, .line-bundle.is-lit');
      const quietExec = await page.evaluate(`[...document.querySelectorAll('.line-exec.is-quiet')].length`);
      const quietGoals = await count('.goal.is-quiet');
      const quietColumns = await count('.column.is-quiet');
      const quietCards = await count('.card.is-quiet');
      if (brightExec < 1 || litExec < 1 || quietGoals < 1 || quietColumns < 1 || quietCards < 3) throw new Error(`goal focus did not quiet the rest (bright lines ${brightExec}, lit ${litExec}, quiet goals ${quietGoals}, quiet columns ${quietColumns}, quiet cards ${quietCards})`);
      // The goal's leader leaves its top edge at a column gutter and joins the sheet's side above the rails:
      // it crosses no other goal object, and the sheet stays clear of the chips.
      const crossings = await leaderCrossings();
      const chipsClear = await chipsClearOfSheet();
      if (crossings !== 0 || !chipsClear) throw new Error(`leader crossings ${crossings}; chips clear of the sheet ${chipsClear}`);
      return { linkedWork: work, brightExecutionLines: brightExec, litLines: litExec, quietExecutionLines: quietExec, quietGoals, quietColumns, quietCards, leaderCrossings: crossings, chipsClearOfSheet: chipsClear };
    });
    await step('D-founder-attention-compact', async () => {
      // Idle: what needs the Founder sits beside the Founder. Resting on one item spotlights where it lives —
      // the person, their chain, their Department — and a tether runs from the person to the item.
      await escape();
      await settle(300);
      await hover('.chip-attention');
      await untilPainted(`document.querySelectorAll('.column.is-quiet').length > 0 && Number(getComputedStyle(document.querySelector('.column.is-quiet')).opacity) < 0.7`);
      await settle(500);
      await shot('04-founder-attention-compact');
      const detail = await closeUp('04b-founder-attention-compact-detail', '.spine', 12);
      const tether = await count('.line-tether:not(.is-under)');
      const crossings = await leaderCrossings();
      const quietColumns = await count('.column.is-quiet');
      const railOpen = await page.evaluate(`!document.getElementById('rail').hidden`);
      await unhover('.chip-attention');
      await settle(300);
      const restored = await count('.column.is-quiet');
      if (railOpen || tether !== 1 || crossings !== 0 || quietColumns < 1 || restored !== 0) throw new Error(`rail open ${railOpen}, tether ${tether}, leader crossings ${crossings}, quiet columns ${quietColumns} → ${restored}`);
      return { tether, leaderCrossings: crossings, quietColumns, restored, detail: path.basename(detail.file) };
    });
    await step('D2-sheet-beside-chips', async () => {
      // A context sheet on the right and the Founder's chips, together: the sheet starts beneath the chips, every
      // chip stays whole, and resting on one still spotlights where it lives while the sheet is open.
      const seo = world.employees['growth.seo-1'].id;
      await click(`.card[data-id="employee:${seo}"]`);
      await waitUntil(`!document.getElementById('focus').hidden && document.querySelector('#focus .chain li')`, 10_000);
      await untilPainted(`document.querySelectorAll('.lines-over .line-tether').length === 1`);
      await settle(400);
      const chipsClear = await chipsClearOfSheet();
      await hover('.chip-attention');
      await untilPainted(`document.querySelectorAll('.column.is-quiet').length > 0 && Number(getComputedStyle(document.querySelector('.column.is-quiet')).opacity) < 0.7`);
      await settle(500);
      await shot('14-sheet-beside-chips');
      const chips = await count('.chip-attention');
      const hoverTether = await count('.line-tether:not(.is-under)');
      const crossings = await leaderCrossings();
      await unhover('.chip-attention');
      await settle(300);
      const sheetTether = await count('.line-tether:not(.is-under)');
      const sheetOpen = await page.evaluate(`!document.getElementById('focus').hidden`);
      if (!chipsClear || chips < 1 || hoverTether !== 1 || crossings !== 0 || sheetTether !== 1 || !sheetOpen) throw new Error(`chips clear ${chipsClear}, chips ${chips}, tether on hover ${hoverTether}, leader crossings ${crossings}, sheet tether back ${sheetTether}, sheet open ${sheetOpen}`);
      await escape();
      await settle(300);
      return { chipsClearOfSheet: chipsClear, chips, tetherOnHover: hoverTether, leaderCrossings: crossings, sheetTetherRestored: sheetTether };
    });
    if (minimal) {
      writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), head: results.head, renderer: results.spike.renderer, minimal: true, frames: readdirSync(out).filter((f) => f.endsWith('.png')), video: null, steps: results.steps, live: { employees: Object.keys(world.employees).length, goals: 3 } }, null, 2));
      console.log(JSON.stringify({ verdict: results.steps.every((s) => s.result === 'PASS') ? 'C5 VISUAL PROOF (MINIMAL) — PASS' : 'C5 VISUAL PROOF (MINIMAL) — FAIL', out }));
    } else {
    await step('E-founder-attention-opened', async () => {
      await click('.dock-head');
      await waitUntil(`!document.getElementById('rail').hidden && document.querySelector('.rail-tab')`, 10_000);
      await click('.rail-tab:nth-child(2)');
      await waitUntil(`document.querySelector('.rail-item .brief')`, 10_000);
      await hover('.rail-item');
      await untilPainted(`document.querySelectorAll('.lines-over .line-tether').length === 1`);
      await settle(1000);
      await shot('05-founder-attention-opened');
      const needsMe = await page.evaluate(`document.querySelectorAll('.rail-tab')[0].querySelector('.count').textContent`);
      const briefs = await page.evaluate(`document.querySelectorAll('.rail-tab')[1].querySelector('.count').textContent`);
      const ordinary = await page.evaluate(`[...document.querySelectorAll('.rail-item')].some((i) => i.textContent.includes('Competitor analysis'))`);
      const parts = await count('.rail-item .brief .brief-row');
      // The surface stays beside the Founder and leaves most of the company in view.
      const coverage = await page.evaluate(`(() => { const r = document.getElementById('rail').getBoundingClientRect(); const s = document.querySelector('.stage').getBoundingClientRect(); return Math.round(100 * (r.width * r.height) / (s.width * s.height)); })()`);
      const founderVisible = await page.evaluate(`(() => { const f = document.querySelector('.founder').getBoundingClientRect(); const r = document.getElementById('rail').getBoundingClientRect(); return f.right <= r.left || f.left >= r.right || f.bottom <= r.top; })()`);
      if (ordinary) throw new Error('a routine completed task entered Founder Attention');
      if (parts !== 4 || coverage > 30 || !founderVisible) throw new Error(`brief parts ${parts}, surface covers ${coverage}% of the stage, Founder visible ${founderVisible}`);
      await unhover('.rail-item');
      return { needsMe, briefs, routineExcluded: true, briefParts: parts, coveragePercent: coverage, founderVisible };
    });
    await step('F-conversation-founder-ceo', async () => {
      // The CEO's conversation on its own Chat screen (P1-CHAT-INTEL-01): the Founder's Arabic question and the CEO's
      // Arabic answer already there; the Founder adds an English question; the reply comes from the CEO's own governed run.
      await escape();
      await click(`.card[data-id="employee:${ceo}"]`);
      await waitUntil(`!document.getElementById('focus').hidden && document.querySelector('#focus .sheet-primary .btn-primary')`, 10_000);
      await click('#focus .sheet-primary .btn-primary');
      await waitUntil(`document.documentElement.dataset.lens === 'CONVERSATION' && !document.getElementById('chat').hidden && document.querySelectorAll('#chat .chat-msg').length >= 2`, 15_000);
      await type('#chat .chat-composer textarea', 'Good. What is the first thing you need from me this week?');
      await submit('#chat .chat-composer');
      try {
        await waitUntil(`document.querySelectorAll('#chat .chat-msg').length >= 4`, 60_000);
      } catch (error) {
        const comm = surface.runtime.founder.communications;
        const stored = comm.messages(live.ceoThreadId).length;
        const pending = comm.pendingReplies().length;
        const shown = await count('#chat .chat-msg');
        const toast = await page.evaluate(`document.getElementById('activity').textContent`);
        throw new Error(`${String(error?.message ?? error)} — stored ${stored}, pending replies ${pending}, messages shown ${shown}, note "${toast}"`, { cause: error });
      }
      await settle(1200);
      await shot('06-conversation-founder-ceo');
      const dirs = await page.evaluate(`[...document.querySelectorAll('#chat .chat-text')].map((b) => getComputedStyle(b).direction + ':' + (/[\\u0600-\\u06FF]/.test(b.textContent) ? 'ar' : 'en'))`);
      const layoutDir = await page.evaluate(`getComputedStyle(document.getElementById('chat')).direction`);
      // The conversation is its own screen: no docked sheet, no work card in the transcript.
      const own = await page.evaluate(`({ focusHidden: document.getElementById('focus').hidden, cards: document.querySelectorAll('#chat .work, #chat .chip-state').length })`);
      if (layoutDir !== 'ltr') throw new Error(`the chat is ${layoutDir}`);
      if (!dirs.includes('rtl:ar') || !dirs.includes('ltr:en')) throw new Error(`message directions ${dirs.join(' ')}`);
      if (!own.focusHidden || own.cards !== 0) throw new Error(`the chat is not its own screen: ${JSON.stringify(own)}`);
      return { messages: dirs.length, directions: dirs, dedicatedScreen: true, workCardsInChat: own.cards };
    });
    await step('G-conversation-founder-employee-arabic', async () => {
      // A direct Founder ↔ Employee conversation: the English note already there; the Founder writes in Arabic
      // inside the English application; the reply comes from the employee's own governed run.
      const lead = world.employees['product.lead-1'].id;
      await escape();
      await escape();
      await click(`.card[data-id="employee:${lead}"]`);
      await waitUntil(`!document.getElementById('focus').hidden && document.querySelector('#focus .sheet-primary .btn-primary')`, 10_000);
      await click('#focus .sheet-primary .btn-primary');
      await waitUntil(`document.documentElement.dataset.lens === 'CONVERSATION' && !document.getElementById('chat').hidden && document.querySelectorAll('#chat .chat-msg').length >= 1`, 15_000);
      await type('#chat .chat-composer textarea', 'ما أهم ما تحتاجينه مني هذا الأسبوع لإنجاز تقرير الاحتفاظ؟');
      await submit('#chat .chat-composer');
      await waitUntil(`document.querySelectorAll('#chat .chat-msg').length >= 3`, 60_000);
      await settle(1200);
      await shot('07-conversation-founder-employee');
      // The newest message is in view above the composer (the conversation keeps the latest exchange under the eye).
      const newestVisible = await page.evaluate(`(() => { const e = [...document.querySelectorAll('#chat .chat-msg')].pop(); const r = e.getBoundingClientRect(); const c = document.querySelector('#chat .chat-composer').getBoundingClientRect(); const s = document.querySelector('#chat .chat-scroll').getBoundingClientRect(); return r.bottom <= c.top + 1 && r.top >= s.top; })()`);
      if (!newestVisible) throw new Error('the newest message is not in view');
      const detail = await closeUp('08-arabic-message-in-english-ui', '#chat .chat-main', 0);
      const dirs = await page.evaluate(`[...document.querySelectorAll('#chat .chat-text')].map((b) => getComputedStyle(b).direction + ':' + (/[\\u0600-\\u06FF]/.test(b.textContent) ? 'ar' : 'en'))`);
      const chromeDir = await page.evaluate(`getComputedStyle(document.querySelector('#chat .chat-composer')).direction + ' ' + getComputedStyle(document.querySelector('#chat .chat-meta')).direction`);
      if (!dirs.includes('rtl:ar') || !dirs.includes('ltr:en') || chromeDir !== 'ltr ltr') throw new Error(`directions ${dirs.join(' ')}; chrome ${chromeDir}`);
      return { messages: dirs.length, directions: dirs, chrome: chromeDir, dedicatedScreen: true, detail: path.basename(detail.file) };
    });
    await step('H-governed-action', async () => {
      await escape();
      await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
      await waitUntil(`!document.getElementById('palette').hidden`, 5_000);
      await type('.palette-input', 'approve Ehab Tarek campaign with a budget of EGP 50,000');
      await submit('.palette-form');
      await waitUntil(`!document.getElementById('preview').hidden && document.querySelector('#preview .preview-summary')`, 15_000);
      await settle(1200);
      await shot('09-governed-action-preview');
      const before = surface.runtime.governance.budgetFor('EMPLOYEE', ceo).capMoney;
      const summary = await page.evaluate(`document.querySelector('#preview .preview-summary').textContent`);
      const leaked = await page.evaluate(`/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(document.getElementById('preview').textContent)`);
      if (leaked) throw new Error('an identifier reached the preview');
      // The text alone changed nothing:
      if (surface.runtime.governance.budgetFor('EMPLOYEE', ceo).capMoney !== before) throw new Error('text mutated a budget');
      await click('#preview .btn-primary');
      await waitUntil(`document.getElementById('preview').hidden`, 15_000);
      await settle(1000);
      await shot('10-governed-action-confirmed');
      const after = surface.runtime.governance.budgetFor('EMPLOYEE', ceo).capMoney;
      const audit = surface.runtime.view.auditByAction('founder.action_confirmed').length;
      if (after !== 50_000 * 1_000_000 || audit < 1) throw new Error(`cap ${after}, audits ${audit}`);
      return { summary, capBefore: before, capAfter: after, confirmedAudits: audit };
    });
    await step('I-timeline-return-to-live', async () => {
      await escape();
      await escape();
      await page.evaluate(`(() => { const r = document.querySelector('.scrubber'); r.value = String(Number(r.min) + 1000); r.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await waitUntil(`document.documentElement.dataset.live === 'history'`, 10_000);
      await settle(1400);
      await shot('11-historical-focus');
      const historyEmployees = await count('.card[data-kind="employee"]');
      await click('.timeline .btn');
      await waitUntil(`document.documentElement.dataset.live === 'live'`, 10_000);
      await settle(900);
      return { historyEmployees };
    });
    await step('J-reduced-motion', async () => {
      // The frame in the application's reduced mode, then back to where the runner started (state-aware).
      const initial = await motionState();
      await setMotion('reduced');
      await settle(300);
      await shot('12-reduced-motion');
      const restored = await setMotion(initial.mode);
      return { initial: describeMotion(initial), frame: 'reduced', restoredTo: restored.to.mode };
    });
    stopCapture();
    await step('K-scale', async () => {
      // A larger company, really seeded through the store, then the real UI over it.
      const added = seedScale(company, world, 60);
      await page.navigate(`${surface.origin}/`);
      await waitReady();
      await settle(1500);
      await shot('13-scale');
      const employees = surface.runtime.founder.universe().employees.length;
      const cards = await count('.card[data-id^="employee:"]');
      const columns = await count('.column');
      const growthRows = await page.evaluate(`document.querySelectorAll('.column:nth-child(2) .members .card').length`);
      if (cards !== employees) throw new Error(`${cards} cards for ${employees} employees`);
      if (columns !== 5) throw new Error('columns changed at scale');
      // Density and legibility at scale: no name clipped below its line box, every column name within two lines.
      const clipped = await page.evaluate(`[...document.querySelectorAll('.card-name')].filter((n) => n.scrollHeight > n.clientHeight + 2).length`);
      const columnNamesFit = await page.evaluate(`[...document.querySelectorAll('.column-name')].every((n) => n.getBoundingClientRect().height < 40)`);
      const exec = await count('.line-exec:not(.line-flow)');
      if (clipped > 0 || !columnNamesFit) throw new Error(`clipped names ${clipped}; column names within two lines ${columnNamesFit}`);
      return { added: added.length, employees, cards, growthMembers: growthRows, executionLines: exec, clippedNames: clipped };
    });
    await step('encode-walkthrough', async () => {
      const enc = await openPage(browser.port, `file:///${path.join(ROOT, 'scripts', 'c5', 'encoder.html').replace(/\\/g, '/')}`);
      await enc.waitUntil('window.encoderReady === true', 10_000);
      // Frames are captured as fast as the headless tab yields them; 4 fps playback keeps the walkthrough watchable.
      const fps = 4;
      // The frames go over in small batches (one DevTools message per ~1 MB), then the page encodes them.
      enc.context = 'encoder page in step encode-walkthrough';
      await enc.send('Runtime.evaluate', { expression: 'window.__frames = []; true' });
      for (let i = 0; i < frames.length; i += 8) {
        const batch = await enc.send('Runtime.evaluate', { expression: `window.__frames.push(...${JSON.stringify(frames.slice(i, i + 8))}); window.__frames.length`, returnByValue: true }, { timeoutMs: 60_000 });
        if (batch.exceptionDetails) throw new Error(`frame upload failed: ${batch.exceptionDetails.text ?? 'exception'}`);
      }
      // Encoding is the one long command of the proof: bounded generously, never unbounded.
      const b64 = await enc.send('Runtime.evaluate', { expression: `window.encode(window.__frames, ${fps}, ${W}, ${H})`, awaitPromise: true, returnByValue: true }, { timeoutMs: 240_000 });
      if (b64.exceptionDetails) throw new Error(`encoder failed: ${b64.exceptionDetails.exception?.description ?? b64.exceptionDetails.text ?? 'exception'}`.slice(0, 300));
      const value = b64.result?.value;
      if (typeof value !== 'string' || value.length < 1000) throw new Error(`encoder produced no video (${JSON.stringify(b64).slice(0, 200)})`);
      const file = path.join(out, 'walkthrough.mp4');
      writeFileSync(file, Buffer.from(value, 'base64'));
      await enc.close();
      return { frames: frames.length, seconds: Math.round(frames.length / fps), bytes: Buffer.byteLength(value, 'base64') };
    });
    if (values.before) {
      await step('before-after-board', async () => {
        const file = await contactSheet(browser.port, { before: path.resolve(values.before), after: out, out: path.join(out, 'before-after.png') });
        return { file: path.basename(file) };
      });
    }
    writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), head: results.head, renderer: results.spike.renderer, frames: readdirSync(out).filter((f) => f.endsWith('.png')), video: existsSync(path.join(out, 'walkthrough.mp4')) ? 'walkthrough.mp4' : null, steps: results.steps, live: { employees: Object.keys(world.employees).length, goals: 3 } }, null, 2));
    console.log(JSON.stringify({ verdict: results.steps.every((s) => s.result === 'PASS') ? 'C5 VISUAL PROOF — PASS' : 'C5 VISUAL PROOF — FAIL', out }));
    }
  }
  void live;
} catch (error) {
  // A command the browser never answered: say exactly which, from where, and whether the browser and the page
  // still answer at all (every probe bounded), so a CI failure is a diagnosis and never an eight-minute gap.
  const postMortem = error?.code === 'CDP_TIMEOUT' && browser ? (page ? await page.postMortem().catch((e) => ({ probeFailed: String(e?.message ?? e).slice(0, 120) })) : { pageOpened: false }) : undefined;
  // What the browser's processes were doing when the command went unanswered (a spinning renderer, a ballooning
  // GPU process, a browser that is gone), and the browser's own log tail: the diagnosis of a wedge, not a guess.
  if (postMortem) {
    postMortem.browserAlive = browser.alive();
    postMortem.processes = await browser.processes();
    postMortem.browserLog = browser.logTail(40);
  }
  console.error(JSON.stringify({ ok: false, code: error?.code ?? 'ERROR', message: String(error?.message ?? error).slice(0, 400), ...(error?.code === 'CDP_TIMEOUT' ? { method: error.method, timeoutMs: error.timeoutMs, context: error.context, postMortem } : {}), browser: browser ? { ...(results.browser ?? { exe: path.basename(browser.exe) }), args: browser.args.filter((a) => !a.startsWith('--user-data-dir') && !a.startsWith('--log-file')) } : null, browserConsole: (results.console ?? []).slice(-12) }));
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
