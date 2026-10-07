#!/usr/bin/env node
/**
 * QANDEEL COMPANY Desktop v1 build (D1, D-D1-02).
 *
 *   npm run desktop:bundle  -- [--out <dir>] [--desktop-version x.y.z] [--skip-build]
 *   npm run desktop:setup   -- [--out <dir>] [--class ENGINEERING|FOUNDER-RC] [--skip-build]
 *
 * SOURCE CHECK → build → stage the canonical content-addressed release → the pinned, verified private Node runtime →
 * compose the Desktop bundle (`qandeel.desktop-bundle/v1`) → [compile Setup.exe with the pinned Inno Setup → verify →
 * hashes / verification record]. `--out` (default: the OS temp directory) must lie outside the checkout; nothing is
 * written into the repository, no Company workspace or LIVE is touched. Signing: see `signingFromEnv` (env only).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { ROOT, SETUP_NAME, authenticode, compileSetup, composeBundle, ensureInno, fetchPinned, loadPins, scanForLeaks, signingFromEnv, sourceState, verificationRecord } from './lib/desktop-build.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' }, setup: { type: 'boolean', default: false }, class: { type: 'string', default: 'ENGINEERING' }, 'desktop-version': { type: 'string' }, 'skip-build': { type: 'boolean', default: false } } });
const out = path.resolve(values.out ?? path.join(tmpdir(), 'qandeel-desktop-build'));
const rel = path.relative(ROOT, out);
if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error('BUILD_DIR_INSIDE_CHECKOUT: --out must lie outside the repository');
if (!['ENGINEERING', 'FOUNDER-RC'].includes(values.class)) throw new Error('--class takes ENGINEERING or FOUNDER-RC');

const log = (step, detail = {}) => process.stdout.write(`${JSON.stringify({ step, ...detail })}\n`);
const pins = loadPins();

// SOURCE CHECK
const source = sourceState();
log('SOURCE', source);
if (values.class === 'FOUNDER-RC' && (!source.clean || !source.commit)) throw new Error('SOURCE_NOT_CLEAN: a FOUNDER-RC is built from a clean, exact commit');

// build
if (!values['skip-build']) {
  const r = spawnSync('npm run build', { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error('BUILD_FAILED');
}

// private runtime (pinned, verified)
mkdirSync(out, { recursive: true });
const cacheDir = path.join(out, 'cache');
const nodeExe = await fetchPinned({ url: pins.node.url, sha256: pins.node.sha256, cacheDir, name: 'node.exe' });
const nodeLicense = await fetchPinned({ url: pins.node.licenseUrl, sha256: pins.node.licenseSha256, cacheDir, name: 'node-LICENSE' });
log('RUNTIME', { version: pins.node.version, arch: pins.node.arch, sha256: pins.node.sha256 });

// compose + scan
const composed = await composeBundle({ out, pins, nodeExe, nodeLicense, source, ...(values['desktop-version'] ? { desktopVersion: values['desktop-version'] } : {}) });
const leaks = scanForLeaks(composed.bundleDir);
if (leaks.length) throw new Error(`BUNDLE_LEAK\n${leaks.join('\n')}`);
log('BUNDLE', { dir: composed.bundleDir, bundleId: composed.manifest.bundleId, releaseId: composed.manifest.release.releaseId, versionDir: composed.versionDir, files: composed.manifest.files.length });

if (values.setup) {
  const iscc = await ensureInno({ pins, cacheDir, toolsDir: path.join(out, 'tools') });
  const signing = signingFromEnv();
  const dist = path.join(out, 'dist');
  const setup = compileSetup({ iscc, bundleDir: composed.bundleDir, manifest: composed.manifest, versionDir: composed.versionDir, pins, outDir: dist, signing });
  const signature = authenticode(setup);
  const record = verificationRecord({ setup, manifest: composed.manifest, versionDir: composed.versionDir, signature, requestedClass: values.class });
  writeFileSync(path.join(dist, `${SETUP_NAME}.verification.json`), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(path.join(dist, `${SETUP_NAME}.exe.sha256`), `${record.setupSha256}  ${SETUP_NAME}.exe\n`);
  writeFileSync(path.join(dist, 'qandeel-desktop-bundle.json'), `${JSON.stringify(composed.manifest, null, 2)}\n`);
  log('SETUP', { setup, sha256: record.setupSha256, artifactClass: record.artifactClass, authenticode: signature.status, blockers: record.blockers });
  if (values.class === 'FOUNDER-RC' && record.artifactClass !== 'FOUNDER-RC') {
    process.stdout.write(`${JSON.stringify({ ok: false, outcome: 'NOT_FOUNDER_RC', blockers: record.blockers })}\n`);
    process.exitCode = 1;
  }
}
