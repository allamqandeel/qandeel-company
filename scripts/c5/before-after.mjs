// A before/after contact sheet for the Founder's eye: old and new frames of the same scenes side by side,
// composed as one HTML page and rendered by the same headless browser the proof uses (no image library).
// Pairs are named by scene; a scene missing on either side is shown alone with a note.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { openPage } from './cdp.mjs';

/** Scenes to compare: [title, before file, after file]. */
const PAIRS = [
  ['Company Live', '01-company-live.png', '01-company-live.png'],
  ['Employee Focus', '02-employee-focus.png', '02-employee-focus.png'],
  ['Goal Focus', '03-goal-focus.png', '03-goal-focus.png'],
  ['Conversation', '04-conversation.png', '04-conversation.png'],
  ['Founder Attention', '05-founder-attention-ceo-brief.png', '05-founder-attention-ceo-brief.png'],
  ['Governed action', '06-governed-action-preview.png', '06-governed-action-preview.png'],
  ['Scale', '11-scale.png', '10-scale.png'],
];

const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function contactSheet(port, { before, after, out, title = 'C5 — from the orbital direction to the Tree of Light' }) {
  const rows = PAIRS.map(([name, b, a]) => {
    const bf = path.join(before, b);
    const af = path.join(after, a);
    const cell = (file, label) => (existsSync(file) ? `<figure><img src="${dataUri(file)}" alt="${esc(name)} — ${label}"><figcaption>${label}</figcaption></figure>` : `<figure class="missing"><div>no ${label} frame</div><figcaption>${label}</figcaption></figure>`);
    return `<section><h2>${esc(name)}</h2><div class="pair">${cell(bf, 'Before')}${cell(af, 'After')}</div></section>`;
  }).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    :root { color-scheme: dark; }
    body { margin: 0; background: #0b0d1c; color: #ebe8f6; font: 14px/1.5 'Segoe UI', system-ui, sans-serif; padding: 28px 32px; }
    h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
    p.lede { margin: 0 0 22px; color: #9d98c4; }
    section { margin-bottom: 26px; }
    h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #b9b4d2; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    figure { margin: 0; }
    img { width: 100%; display: block; border-radius: 8px; border: 1px solid rgba(186,182,226,0.18); }
    figcaption { margin-top: 6px; font-size: 12px; color: #837ea6; }
    .missing div { aspect-ratio: 16 / 10; display: grid; place-items: center; border: 1px dashed rgba(186,182,226,0.3); border-radius: 8px; color: #837ea6; }
  </style></head><body><h1>${esc(title)}</h1><p class="lede">Same seeded company, same scenes. Left: the rejected orbital direction (previous proof). Right: the accepted Tree of Light direction (current head).</p>${rows}</body></html>`;
  const file = path.join(after, 'before-after.html');
  writeFileSync(file, html);
  const page = await openPage(port, `file:///${file.replace(/\\/g, '/')}`);
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.waitUntil(`document.readyState === 'complete' && [...document.images].every((i) => i.complete)`, 20_000);
    const { contentSize } = await page.send('Page.getLayoutMetrics');
    const height = Math.ceil(contentSize.height);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height, deviceScaleFactor: 1, mobile: false });
    const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1600, height, scale: 1 } });
    writeFileSync(out, Buffer.from(data, 'base64'));
    return out;
  } finally {
    await page.close().catch(() => undefined);
  }
}
