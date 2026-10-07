/**
 * D1 (D-D1-01 … D-D1-05) — the Desktop v1 orchestration contract, in process and disposable:
 *   1. the bundle manifest: content identity without time, every application file and the release verified, tampering
 *      refused with a reason code;
 *   2. importRelease: the canonical release format and location, byte-verified, idempotent, a conflict refused;
 *   3. desktop-install refuses before touching anything when it does not run on the bundle's own private runtime, and a
 *      missing Company is never created;
 *   4. the shortcuts: the signed console host in headless mode runs the private runtime, with the product icon.
 * The installed lifecycle (install / update / rollback / repair / uninstall) is proven by `npm run desktop:proof`.
 * OPS-PROOF: desktop-orchestration
 */
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DESKTOP_BUNDLE_FILE, DESKTOP_BUNDLE_SCHEMA, DESKTOP_INSTALLER_SCHEMA, DESKTOP_PRODUCT, bundleApplicationFiles, bundleIdOf, desktopInstall, sha256File, verifyDesktopBundle, type DesktopBundleManifest } from '../src/host/desktop.js';
import { headlessConsoleHost, productIcon, shortcutSpecs } from '../src/host/lifecycle.js';
import { importRelease, stageRelease } from '../src/host/release.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(here, '..', '..', '..', '..');
const root = mkdtempSync(path.join(tmpdir(), 'qc-desktop-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** A bundle laid out like a Setup install: a stand-in runtime file, the staged release, the icon, the manifest. */
function makeBundle(dir: string, releaseRoot: string): DesktopBundleManifest {
  mkdirSync(path.join(dir, 'node'), { recursive: true });
  mkdirSync(path.join(dir, 'app'), { recursive: true });
  writeFileSync(path.join(dir, 'node', 'node.exe'), 'stand-in runtime');
  writeFileSync(path.join(dir, 'app', 'qandeel-company.ico'), 'icon');
  cpSync(releaseRoot, path.join(dir, 'release'), { recursive: true });
  const rel = JSON.parse(readFileSync(path.join(dir, 'release', 'qandeel-release.json'), 'utf8')) as { releaseId: string; runtimeVersion: string; files: unknown[] };
  const core = {
    schema: DESKTOP_BUNDLE_SCHEMA,
    product: DESKTOP_PRODUCT,
    desktopVersion: '1.0.0',
    source: { commit: null, clean: false },
    release: { releaseId: rel.releaseId, runtimeVersion: rel.runtimeVersion, files: rel.files.length },
    node: { version: '24.19.0', platform: 'win32', arch: 'x64', file: 'node/node.exe', sha256: sha256File(path.join(dir, 'node', 'node.exe')), url: 'https://nodejs.org/dist/v24.19.0/win-x64/node.exe' },
    icon: { file: 'app/qandeel-company.ico', sha256: sha256File(path.join(dir, 'app', 'qandeel-company.ico')), source: 'test' },
    installer: { schema: DESKTOP_INSTALLER_SCHEMA, tool: 'Inno Setup', version: '6.7.3' },
    files: bundleApplicationFiles(dir),
  } as const;
  const manifest = { ...core, bundleId: bundleIdOf(core as unknown as DesktopBundleManifest), createdAt: new Date().toISOString() } as unknown as DesktopBundleManifest;
  writeFileSync(path.join(dir, DESKTOP_BUNDLE_FILE), JSON.stringify(manifest));
  return manifest;
}

describe('Desktop v1 orchestration (D1)', { timeout: 120_000 }, () => {
  const staged = stageRelease(checkout, path.join(root, 'staged'));
  const bundle = path.join(root, 'bundle');
  const manifest = makeBundle(bundle, staged.root);

  test('the bundle identity is content, not time; every file and the release are verified', () => {
    assert.deepEqual(verifyDesktopBundle(bundle), { ok: true, manifest: JSON.parse(readFileSync(path.join(bundle, DESKTOP_BUNDLE_FILE), 'utf8')) });
    assert.equal(bundleIdOf({ ...manifest, createdAt: '2000-01-01T00:00:00.000Z' }), manifest.bundleId, 'creation time is not identity');
    assert.notEqual(bundleIdOf({ ...manifest, desktopVersion: '1.0.1' }), manifest.bundleId);
    const cases: [string, (d: string) => void, string][] = [
      ['runtime edited', (d) => appendFileSync(path.join(d, 'node', 'node.exe'), 'x'), 'BUNDLE_TAMPERED'],
      ['file added', (d) => writeFileSync(path.join(d, 'app', 'extra.cmd'), 'echo'), 'BUNDLE_TAMPERED'],
      ['release edited', (d) => appendFileSync(path.join(d, 'release', 'node_modules', '@qandeel-company', 'command-center', 'dist', 'src', 'cli.js'), '\n// x\n'), 'RELEASE_TAMPERED'],
      ['manifest unreadable', (d) => writeFileSync(path.join(d, DESKTOP_BUNDLE_FILE), '{ torn'), 'BUNDLE_INVALID'],
      ['identity rewritten', (d) => writeFileSync(path.join(d, DESKTOP_BUNDLE_FILE), JSON.stringify({ ...manifest, desktopVersion: '9.9.9' })), 'BUNDLE_TAMPERED'],
    ];
    for (const [name, change, reason] of cases) {
      const dir = path.join(root, `t-${name.replace(/\s/g, '-')}`);
      cpSync(bundle, dir, { recursive: true });
      change(dir);
      assert.deepEqual(verifyDesktopBundle(dir), { ok: false, reason }, name);
    }
  });

  test('importRelease: the canonical format and location, verified, idempotent; a conflict is refused', () => {
    const dir = path.join(root, 'releases');
    const first = importRelease(path.join(bundle, 'release'), dir);
    assert.equal(first.releaseId, staged.releaseId);
    assert.equal(first.root, path.join(dir, staged.releaseId.slice(0, 16)));
    assert.equal(first.reused, false);
    assert.equal(importRelease(path.join(bundle, 'release'), dir).reused, true);
    appendFileSync(path.join(first.root, 'node_modules', '@qandeel-company', 'domain', 'dist', 'src', 'index.js'), '\n// drift\n');
    assert.throws(() => importRelease(path.join(bundle, 'release'), dir), /RELEASE_DIR_CONFLICT/);
    const broken = path.join(root, 'broken-release');
    cpSync(staged.root, broken, { recursive: true });
    appendFileSync(path.join(broken, 'node_modules', '@qandeel-company', 'domain', 'dist', 'src', 'index.js'), '\n// edited\n');
    assert.throws(() => importRelease(broken, path.join(root, 'releases-2')), /RELEASE_TAMPERED/);
    assert.equal(existsSync(path.join(root, 'releases-2')), false, 'nothing is written for a tampered source');
  });

  test('desktop-install refuses another runtime before it reads or writes any Company state', async () => {
    const before = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = path.join(root, 'lad');
    try {
      const r = await desktopInstall({ bundleDir: bundle, workspace: path.join(root, 'no-company') });
      assert.equal(r.outcome, 'PRIVATE_RUNTIME_REQUIRED');
      assert.deepEqual(r.steps.map((s) => s.step), ['BUNDLE', 'RUNTIME']);
      assert.equal(existsSync(path.join(root, 'lad')), false, 'no configuration, release or record was written');
      assert.equal(existsSync(path.join(root, 'no-company')), false, 'no Company was created');
    } finally {
      if (before === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = before;
    }
  });

  test('the shortcuts run the private runtime through the headless console host, with the product icon', () => {
    const runtime = path.join(bundle, 'node', 'node.exe');
    assert.equal(productIcon(runtime), path.join(bundle, 'app', 'qandeel-company.ico'));
    assert.equal(productIcon(process.execPath), null, 'a development runtime has no product icon');
    const specs = shortcutSpecs(path.join(root, 'cli.js'), path.join(root, 'launcher'), runtime);
    const conhost = headlessConsoleHost();
    for (const s of specs) {
      assert.equal(s.icon, path.join(bundle, 'app', 'qandeel-company.ico'));
      if (conhost === null) assert.equal(s.target, runtime);
      else {
        assert.equal(s.target, conhost);
        assert.ok(s.arguments.startsWith(`--headless "${runtime}" "${path.join(root, 'cli.js')}" `), s.arguments);
      }
      assert.ok(s.arguments.endsWith(' --notify') && !s.arguments.includes('#'));
    }
    assert.deepEqual(specs.map((s) => s.name), ['QANDEEL COMPANY', 'QANDEEL COMPANY', 'QANDEEL COMPANY — Status', 'QANDEEL COMPANY — Stop', 'QANDEEL COMPANY — Restart']);
  });
});
