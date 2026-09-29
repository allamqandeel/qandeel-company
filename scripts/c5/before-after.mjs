// A before/after contact sheet for the Founder's eye: old and new frames of the same scenes side by side,
// composed as one HTML page and rendered by the same headless browser the proof uses (no image library).
// Pairs are named by scene; a scene missing on either side is shown alone with a note.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { openPage } from './cdp.mjs';

/** Scenes to compare: [title, before file (the v3 proof), after file (the final craft pass)]. */
const PAIRS = [
  ['Company Live', '01-company-live.png', '01-company-live.png'],
  ['Employee Focus', '02-employee-focus.png', '02-employee-focus.png'],
  ['Goal Focus', '03-goal-focus.png', '03-goal-focus.png'],
  ['Conversation — Founder ↔ CEO', '04-conversation.png', '06-conversation-founder-ceo.png'],
  ['Founder Attention — opened', '05-founder-attention-ceo-brief.png', '05-founder-attention-opened.png'],
  ['Governed action', '06-governed-action-preview.png', '09-governed-action-preview.png'],
  ['Scale', '10-scale.png', '13-scale.png'],
];

const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function contactSheet(port, { before, after, out, title = 'C5 — Tree of Light: v3 → the final craft pass', lede = 'Same seeded company, same scenes. Left: the Tree of Light as first implemented (v3). Right: the final craft pass (current head).' }) {
  const rows = PAIRS.map(([name, b, a]) => {
    const bf = path.join(before, b);
    const af = path.join(after, a);
    const cell = (file, label) => (existsSync(file) ? `<figure><img src="${dataUri(file)}" alt="${esc(name)} — ${label}"><figcaption>${label}</figcaption></figure>` : `<figure class="missing"><div>no ${label} frame</div><figcaption>${label}</figcaption></figure>`);
    return `<section><h2>${esc(name)}</h2><div class="pair">${cell(bf, 'Before (v3)')}${cell(af, 'After (final)')}</div></section>`;
  }).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    :root { color-scheme: light; }
    body { margin: 0; background: #f4f2ec; color: #1d1b26; font: 14px/1.5 'Segoe UI', system-ui, sans-serif; padding: 28px 32px; }
    h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
    p.lede { margin: 0 0 22px; color: #5f5c6e; }
    section { margin-bottom: 26px; }
    h2 { margin: 0 0 8px; font-size: 14px; font-weight: 600; color: #7a5310; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    figure { margin: 0; }
    img { width: 100%; display: block; border-radius: 10px; border: 1px solid rgba(29,27,38,0.12); box-shadow: 0 6px 18px rgba(40,34,60,0.08); }
    figcaption { margin-top: 6px; font-size: 12px; color: #8b889a; }
    .missing div { aspect-ratio: 16 / 10; display: grid; place-items: center; border: 1px dashed rgba(29,27,38,0.3); border-radius: 10px; color: #8b889a; }
  </style></head><body><h1>${esc(title)}</h1><p class="lede">${esc(lede)}</p>${rows}</body></html>`;
  const file = path.join(after, 'before-after.html');
  writeFileSync(file, html);
  const page = await openPage(port, `file:///${file.replace(/\\/g, '/')}`);
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.waitUntil(`document.readyState === 'complete' && [...document.images].every((i) => i.complete)`, 20_000);
    const { contentSize } = await page.send('Page.getLayoutMetrics');
    const height = Math.ceil(contentSize.height);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height, deviceScaleFactor: 1, mobile: false });
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1600, height, scale: 1 } }, { timeoutMs: 60_000 });
    writeFileSync(out, Buffer.from(data, 'base64'));
    return out;
  } finally {
    await page.close().catch(() => undefined);
  }
}
