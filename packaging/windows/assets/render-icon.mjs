#!/usr/bin/env node
/**
 * One-time derivation of the Windows product icon (D1, D-D1-03) — run by an engineer, never by the build.
 *
 * Source: the ratified QANDEEL brand authority I-08B2.5 (repository and commit recorded in ICON_PROVENANCE.json),
 * app icon `APP_ICON_B_DARK_LUMINOUS.svg` — copied once, byte-identical, into `source/` (its SHA-256 is checked here). No mark is drawn or altered: the SVG is rasterised by Chromium at each exact
 * Windows icon size (the method the brand package itself used), and the renders are cross-checked against the brand
 * package's own iOS renders of the same file at every size both share.
 *
 *   node packaging/windows/assets/render-icon.mjs [--brand <i-08b2.5 package dir>]
 *
 * Writes `qandeel-company.ico` and `ICON_PROVENANCE.json` beside this script. The product build only verifies them.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { launchBrowser, openPage } from '../../../scripts/c5/cdp.mjs';
import { buildIco, decodePng, imageDiff } from '../lib/png-ico.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, 'source', 'APP_ICON_B_DARK_LUMINOUS.svg');
const SOURCE_SHA256 = '859665d86a7bbf4248ff479034031a8df1f08833c7db36336b3d29832bcddd09';
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const IOS_SIZES = [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180];
const sha = (b) => createHash('sha256').update(b).digest('hex');

const { values } = parseArgs({ options: { brand: { type: 'string' } } });
const svg = readFileSync(SOURCE);
if (sha(svg) !== SOURCE_SHA256) throw new Error('ICON_SOURCE_NOT_CANONICAL: the copied SVG is not the frozen I-08B2.4 Variant B file');

const browser = await launchBrowser({ width: 512, height: 512 });
const renders = {};
try {
  const page = await openPage(browser.port);
  const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  for (const n of [...new Set([...ICO_SIZES, ...IOS_SIZES])].sort((a, b) => a - b)) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: n, height: n, deviceScaleFactor: 1, mobile: false });
    await page.navigate(`data:text/html,${encodeURIComponent(`<!doctype html><html><body style="margin:0;background:#000"><img src="${src}" width="${n}" height="${n}" style="display:block"></body></html>`)}`);
    await page.waitUntil('document.images[0] && document.images[0].complete');
    const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: n, height: n, scale: 1 } });
    renders[n] = Buffer.from(shot.data, 'base64');
  }
  await page.close();
} finally {
  await browser.close();
}

// Fidelity: the brand package's own iOS renders of the same file (an independent Chromium render).
const fidelity = [];
if (values.brand) {
  for (const n of IOS_SIZES) {
    const f = path.join(values.brand, 'app-icon', 'ios', 'AppIcon.appiconset', `AppIcon-${n}.png`);
    if (!existsSync(f)) continue;
    const d = imageDiff(decodePng(renders[n]), decodePng(readFileSync(f)));
    fidelity.push({ size: n, reference: `app-icon/ios/AppIcon.appiconset/AppIcon-${n}.png`, meanAbsDiff: Number(d.mean.toFixed(3)), maxAbsDiff: d.max });
  }
}

const ico = buildIco(Object.fromEntries(ICO_SIZES.map((n) => [n, renders[n]])));
writeFileSync(path.join(here, 'qandeel-company.ico'), ico);
// The source record (authority, repository, commit, path) is the committed provenance; only derived fields change.
const recorded = JSON.parse(readFileSync(path.join(here, 'ICON_PROVENANCE.json'), 'utf8'));
const provenance = {
  schema: 'qandeel.desktop-icon-provenance/v1',
  authority: recorded.authority,
  sourceRepository: recorded.sourceRepository,
  sourceCommit: recorded.sourceCommit,
  sourcePath: recorded.sourcePath,
  sourceSha256: SOURCE_SHA256,
  copiedTo: 'packaging/windows/assets/source/APP_ICON_B_DARK_LUMINOUS.svg',
  derivation: 'Chromium (headless, device scale factor 1) rasterisation of the unmodified SVG at each exact Windows icon size; no redraw, no recolour, no mask',
  icoSizes: ICO_SIZES,
  renders: Object.fromEntries(ICO_SIZES.map((n) => [n, sha(renders[n])])),
  fidelityAgainstBrandPackageIosRenders: fidelity,
  ico: { file: 'packaging/windows/assets/qandeel-company.ico', sha256: sha(ico), bytes: ico.length },
};
writeFileSync(path.join(here, 'ICON_PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, ico: provenance.ico, fidelity })}\n`);
