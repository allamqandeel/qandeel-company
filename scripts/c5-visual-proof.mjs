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
// With --spike it stops after the technical smoke checks (the company surface renders — spine, five columns,
// goals, execution lines; English UI with content as written; selection / focus / return; reduced-motion
// parity; no external asset) and prints them. The surface is DOM + SVG: no GPU or WebGL is needed anywhere.

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
const { values } = parseArgs({ strict: true, options: { workspace: { type: 'string' }, out: { type: 'string' }, keep: { type: 'boolean', default: false }, spike: { type: 'boolean', default: false }, before: { type: 'string' }, width: { type: 'string', default: '1440' }, height: { type: 'string', default: '900' } } });
if (!values.workspace) {
  console.error(JSON.stringify({ ok: false, message: 'usage: --workspace <new or empty dir> [--out <dir>] [--keep] [--spike] [--before <dir>]' }));
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
// QANDEEL_PROOF_TRACE=1 prints how long each helper call takes (tuning the harness, never part of the verdict).
const TRACE = process.env.QANDEEL_PROOF_TRACE === '1';
const traced = (name, fn) => async (...args) => {
  const started = Date.now();
  try {
    return await fn(...args);
  } finally {
    if (TRACE) console.error(JSON.stringify({ trace: name, ms: Date.now() - started, arg: typeof args[0] === 'string' ? args[0].slice(0, 60) : args[0] }));
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
const closeUp = async (name, selector, margin = 16) => {
  const r = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
  if (!r) throw new Error(`no element ${selector}`);
  const x = Math.max(0, r.x - margin);
  const y = Math.max(0, r.y - margin);
  const clip = { x, y, width: Math.min(W - x, r.width + margin * 2), height: Math.min(H - y, r.height + margin * 2), scale: 1 };
  const full = await page.screenshot();
  const crop = await openPage(browser.port);
  try {
    await crop.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await crop.evaluate(`new Promise((done) => { document.documentElement.style.margin = '0'; document.body.style.margin = '0'; const img = new Image(); img.onload = () => done(true); img.src = 'data:image/png;base64,${full.toString('base64')}'; document.body.append(img); })`);
    const { data } = await crop.send('Page.captureScreenshot', { format: 'png', clip });
    const file = path.join(out, `${name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    return { file, width: Math.round(clip.width), height: Math.round(clip.height) };
  } finally {
    await crop.close().catch(() => undefined);
  }
};
// The pointer rests on an element (the surface responds to `pointerenter`; `focus` for keyboard parity).
const hover = async (selector) => {
  const ok = await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false })); return true; })()`);
  if (!ok) throw new Error(`no element ${selector}`);
};
const unhover = async (selector) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false })); return true; })()`);
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
const settle = traced('settle', async (ms = 700) => {
  if (!page) return sleep(ms);
  await page.evaluate(`new Promise((done) => { const end = performance.now() + ${Math.round(ms)}; const tick = () => (performance.now() < end ? requestAnimationFrame(tick) : done()); requestAnimationFrame(tick); setTimeout(done, ${Math.round(ms) + 4000}); })`);
});
// Waits, frame by frame, until a painted condition holds (a transition has reached its end, for example).
const untilPainted = traced('untilPainted', async (expression, timeoutMs = 6000) => {
  const ok = await page.evaluate(`new Promise((done) => { const end = performance.now() + ${timeoutMs}; const tick = () => { let v = false; try { v = !!(${expression}); } catch {} if (v) return done(true); if (performance.now() > end) return done(false); requestAnimationFrame(tick); }; requestAnimationFrame(tick); setTimeout(() => done(false), ${timeoutMs + 3000}); })`);
  if (!ok) throw new Error(`not painted in time: ${expression}`);
});
const click = traced('click', async (selector) => {
  const ok = await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView?.({ block: 'center' }); el.click(); return true; })()`);
  if (!ok) throw new Error(`no element ${selector}`);
});
const waitUntil = traced('waitUntil', (expression, timeoutMs) => page.waitUntil(expression, timeoutMs));
const type = async (selector, text) => {
  await page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
};
const submit = async (selector) => page.evaluate(`(() => { const f = document.querySelector(${JSON.stringify(selector)}); f.requestSubmit(); return true; })()`);
const escape = async () => {
  await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await settle(400);
};
const waitReady = async () => {
  await waitUntil(`document.getElementById('app') && !document.getElementById('app').hasAttribute('data-booting') && document.querySelectorAll('.column').length > 0`, 30_000);
  await settle(900);
};
const count = (selector) => page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

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
  const requests = [];
  const consoleLines = [];
  page.on('Network.requestWillBeSent', (p) => requests.push(p.request.url));
  page.on('Network.responseReceived', (p) => { if (p.response.status >= 400) consoleLines.push(`HTTP ${p.response.status} ${p.response.url}`); });
  page.on('Runtime.consoleAPICalled', (p) => consoleLines.push(`${p.type}: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`));
  page.on('Runtime.exceptionThrown', (p) => consoleLines.push(`exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`));
  results.console = consoleLines;
  await page.send('Network.enable');
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
    const tether = await count('.line-tether');
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
  await step('spike-reduced-motion-parity', async () => {
    // Parity of meaning, not of pixels: every card, goal, column name and line that Company Live shows in full
    // motion is still shown in reduced motion; only the tweens and the ambient drift go.
    const marksExpr = `[...document.querySelectorAll('.card, .goal, .column-name, .line-exec, .line-bundle, .line-trunk, .line-branch, .chip-attention')].map((e) => e.dataset.id || e.textContent || e.getAttribute('class')).sort()`;
    const before = await page.evaluate(marksExpr);
    await click('#motion-toggle');
    await settle(500);
    const mode = await page.evaluate(`document.documentElement.dataset.motion`);
    const after = await page.evaluate(marksExpr);
    const drift = await page.evaluate(`getComputedStyle(document.querySelector('.stage'), '::before').animationName`);
    const missing = before.filter((x) => !after.includes(x));
    if (mode !== 'reduced' || after.length < 20 || missing.length > 0 || drift !== 'none') throw new Error(`reduced motion mode ${mode}; missing ${missing.length} of ${before.length} marks; drift ${drift}`);
    await click('#motion-toggle');
    await settle(200);
    results.spike.reducedMotion = { mode, marks: after.length };
    return { mode, marks: after.length };
  });
  if (values.spike) {
    console.log(JSON.stringify({ verdict: 'C5 TECHNICAL SPIKE — PASS', spike: results.spike }));
  } else {
    // --- Scenario frames and the walkthrough ---
    startCapture();
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
      const tether = await count('.line-tether');
      if (!namedGoal || tether !== 1) throw new Error(`the goal a work item serves is named: ${namedGoal}; tether ${tether}`);
      return { chainLinks: chain, relationLines: relations, chainCards: lit, tether };
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
      return { linkedWork: work, brightExecutionLines: brightExec, litLines: litExec, quietExecutionLines: quietExec, quietGoals, quietColumns, quietCards };
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
      const tether = await count('.line-tether');
      const quietColumns = await count('.column.is-quiet');
      const railOpen = await page.evaluate(`!document.getElementById('rail').hidden`);
      await unhover('.chip-attention');
      await settle(300);
      const restored = await count('.column.is-quiet');
      if (railOpen || tether !== 1 || quietColumns < 1 || restored !== 0) throw new Error(`rail open ${railOpen}, tether ${tether}, quiet columns ${quietColumns} → ${restored}`);
      return { tether, quietColumns, restored, detail: path.basename(detail.file) };
    });
    await step('E-founder-attention-opened', async () => {
      await click('.dock-head');
      await waitUntil(`!document.getElementById('rail').hidden && document.querySelector('.rail-tab')`, 10_000);
      await click('.rail-tab:nth-child(2)');
      await waitUntil(`document.querySelector('.rail-item .brief')`, 10_000);
      await hover('.rail-item');
      await untilPainted(`document.querySelectorAll('.line-tether').length === 1`);
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
      // The CEO's conversation: the Founder's Arabic question and the CEO's Arabic answer already there; the
      // Founder adds an English question; the reply comes from the CEO's own governed run (in Arabic).
      await escape();
      await click(`.card[data-id="employee:${ceo}"]`);
      await waitUntil(`!document.getElementById('focus').hidden && document.querySelector('#focus .sheet-actions .btn-primary')`, 10_000);
      await click('#focus .sheet-actions .btn-primary');
      await waitUntil(`document.documentElement.dataset.lens === 'CONVERSATION' && document.querySelectorAll('#focus .entry').length >= 2`, 15_000);
      // Typed and sent in one breath (a live company may refresh the sheet between the two; the draft survives that too).
      await page.evaluate(`(() => { const f = document.querySelector('#focus .composer'); const el = f.querySelector('textarea'); el.focus(); el.value = ${JSON.stringify('Good. What is the first thing you need from me this week?')}; el.dispatchEvent(new Event('input', { bubbles: true })); f.requestSubmit(); return true; })()`);
      try {
        await waitUntil(`document.querySelectorAll('#focus .entry:not(.pending)').length >= 4`, 60_000);
      } catch (error) {
        const comm = surface.runtime.founder.communications;
        const stored = comm.messages(live.ceoThreadId).length;
        const pending = comm.pendingReplies().length;
        const shown = await count('#focus .entry');
        const toast = await page.evaluate(`document.getElementById('activity').textContent`);
        throw new Error(`${String(error?.message ?? error)} — stored ${stored}, pending replies ${pending}, entries shown ${shown}, note "${toast}"`, { cause: error });
      }
      await settle(1200);
      await shot('06-conversation-founder-ceo');
      const dirs = await page.evaluate(`[...document.querySelectorAll('#focus .entry-body')].map((b) => getComputedStyle(b).direction + ':' + (/[\\u0600-\\u06FF]/.test(b.textContent) ? 'ar' : 'en'))`);
      const layoutDir = await page.evaluate(`getComputedStyle(document.querySelector('#focus')).direction`);
      const context = await count('#focus .context-chips .chip');
      if (layoutDir !== 'ltr') throw new Error(`the sheet is ${layoutDir}`);
      if (!dirs.includes('rtl:ar') || !dirs.includes('ltr:en')) throw new Error(`message directions ${dirs.join(' ')}`);
      return { messages: dirs.length, directions: dirs, contextChips: context };
    });
    await step('G-conversation-founder-employee-arabic', async () => {
      // A direct Founder ↔ Employee conversation: the English note already there; the Founder writes in Arabic
      // inside the English application; the reply comes from the employee's own governed run.
      const lead = world.employees['product.lead-1'].id;
      await escape();
      await click(`.card[data-id="employee:${lead}"]`);
      await waitUntil(`!document.getElementById('focus').hidden && document.querySelector('#focus .sheet-actions .btn-primary')`, 10_000);
      await click('#focus .sheet-actions .btn-primary');
      await waitUntil(`document.documentElement.dataset.lens === 'CONVERSATION' && document.querySelectorAll('#focus .entry').length >= 1`, 15_000);
      await page.evaluate(`(() => { const f = document.querySelector('#focus .composer'); const el = f.querySelector('textarea'); el.focus(); el.value = ${JSON.stringify('ما أهم ما تحتاجينه مني هذا الأسبوع لإنجاز تقرير الاحتفاظ؟')}; el.dispatchEvent(new Event('input', { bubbles: true })); f.requestSubmit(); return true; })()`);
      await waitUntil(`document.querySelectorAll('#focus .entry:not(.pending)').length >= 3`, 60_000);
      await settle(1200);
      await shot('07-conversation-founder-employee');
      // The newest entry is in view above the composer (the ledger keeps the latest exchange under the eye).
      const newestVisible = await page.evaluate(`(() => { const e = [...document.querySelectorAll('#focus .entry')].pop(); const r = e.getBoundingClientRect(); const c = document.querySelector('#focus .composer').getBoundingClientRect(); const s = document.getElementById('focus').getBoundingClientRect(); return r.bottom <= c.top + 1 && r.top >= s.top; })()`);
      if (!newestVisible) throw new Error('the newest message is not in view');
      const detail = await closeUp('08-arabic-message-in-english-ui', '#focus', 0);
      const dirs = await page.evaluate(`[...document.querySelectorAll('#focus .entry-body')].map((b) => getComputedStyle(b).direction + ':' + (/[\\u0600-\\u06FF]/.test(b.textContent) ? 'ar' : 'en'))`);
      const chromeDir = await page.evaluate(`getComputedStyle(document.querySelector('#focus .composer')).direction + ' ' + getComputedStyle(document.querySelector('#focus .entry-meta')).direction`);
      const sheetLeft = await page.evaluate(`document.getElementById('focus').classList.contains('is-left')`);
      if (!dirs.includes('rtl:ar') || !dirs.includes('ltr:en') || chromeDir !== 'ltr ltr') throw new Error(`directions ${dirs.join(' ')}; chrome ${chromeDir}`);
      if (!sheetLeft) throw new Error('a person in a right-hand column should get the sheet on the left');
      return { messages: dirs.length, directions: dirs, chrome: chromeDir, sheetDocked: 'left', detail: path.basename(detail.file) };
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
      await click('#motion-toggle');
      await settle(600);
      await shot('12-reduced-motion');
      await click('#motion-toggle');
      return { mode: 'reduced → full' };
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
    if (values.before) {
      await step('before-after-board', async () => {
        const file = await contactSheet(browser.port, { before: path.resolve(values.before), after: out, out: path.join(out, 'before-after.png') });
        return { file: path.basename(file) };
      });
    }
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
