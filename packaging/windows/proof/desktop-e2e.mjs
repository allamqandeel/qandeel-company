#!/usr/bin/env node
/**
 * npm run desktop:e2e -- --workspace <disposable dir> [--artifacts <dir>] [--cache <dir>]
 *
 * The real QANDEEL-COMPANY-Setup.exe, end to end (D1, D-D1-07) — on a DISPOSABLE Windows machine only (the GitHub
 * Windows runner). It installs into the machine's real per-user profile (%LOCALAPPDATA%\Programs, HKCU, the real
 * Desktop and Start menu), so it refuses to run where any QANDEEL COMPANY data or installation already exists, and
 * outside CI unless `--disposable-machine` is given. It never runs on the Founder's laptop (that is D2).
 *
 *   builds Setup A (this source), B (a newer release) and C (a release whose host never comes up) with the pinned Inno
 *   Setup → first run without a Company: bounded, nothing created → invalid workspace: nothing created → the existing
 *   Company: per-user install (HKCU only, no HKLM), versioned files, branded shortcuts on the private runtime, the host
 *   READY → the shortcut's own command → update A → B → failed update C rolls back to B → repair → no checkout code or
 *   modules → uninstall (application only) → reinstall (the same Company). A is published as the ENGINEERING artifact.
 *
 * Exercises: the installed release's @qandeel-company/command-center CLI (desktop-install / desktop-uninstall / open /
 * status / stop / restart) and reads Company state through @qandeel-company/storage and @qandeel-company/runtime.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { ROOT, SETUP_NAME, authenticode, bundleVerificationRecord, compileSetup, composeBundle, ensureInno, fetchPinned, loadPins, scanForLeaks, verificationRecord } from '../lib/desktop-build.mjs';
import { companyFingerprint, devModules, isolatedEnv, launchLikeWindows, listTree, machineUninstallEntryExists, powershellJson, processesNaming, readShortcut, recorder, runInstalled, seedSentinel, sleep, splitCommandLine, uninstallEntry, variantRelease } from '../lib/proof-kit.mjs';

const { values } = parseArgs({ options: { workspace: { type: 'string' }, artifacts: { type: 'string' }, cache: { type: 'string' }, 'disposable-machine': { type: 'boolean', default: false } } });
if (process.platform !== 'win32') {
  process.stdout.write('PROOF NOTE desktop:e2e installs the real Windows Setup and runs on Windows only (the plan always includes the Windows run)\n');
  process.exit(0);
}
const LAD = process.env.LOCALAPPDATA;
const companyData = path.join(LAD, 'QANDEEL_COMPANY');
const programRoot = path.join(LAD, 'Programs', 'QANDEEL COMPANY');
if (process.env.GITHUB_ACTIONS !== 'true' && !values['disposable-machine']) throw new Error('REFUSED: desktop:e2e runs on a disposable Windows machine (CI) only — it installs into the real user profile');
if (existsSync(companyData) || existsSync(programRoot)) throw new Error('REFUSED: this machine already holds QANDEEL COMPANY data or an installation; desktop:e2e never touches an existing Company');

const scratch = path.resolve(values.workspace ?? path.join(process.env.RUNNER_TEMP ?? LAD, 'qc-desktop-e2e'));
rmSync(scratch, { recursive: true, force: true });
mkdirSync(path.join(scratch, 'logs'), { recursive: true });
const { check, failures } = recorder();
const pins = loadPins();
const cacheDir = path.resolve(values.cache ?? path.join(scratch, 'cache'));
const nodeExe = await fetchPinned({ url: pins.node.url, sha256: pins.node.sha256, cacheDir, name: 'node.exe' });
const nodeLicense = await fetchPinned({ url: pins.node.licenseUrl, sha256: pins.node.licenseSha256, cacheDir, name: 'node-LICENSE' });
const { runtime } = await devModules();
const iscc = await ensureInno({ pins, cacheDir, toolsDir: path.join(scratch, 'tools') });
check('build.inno-pinned', existsSync(iscc), `Inno Setup ${pins.inno.version}`);

const setupOf = (b, name) => compileSetup({ iscc, bundleDir: b.bundleDir, manifest: b.manifest, versionDir: b.versionDir, pins, outDir: path.join(scratch, `dist-${name}`) });
const A = await composeBundle({ out: path.join(scratch, 'build-A'), pins, nodeExe, nodeLicense });
const setupA = setupOf(A, 'A');
const relB = await variantRelease(A.releaseRoot, path.join(scratch, 'releases-B'), 'b', (d) => writeFileSync(path.join(d, 'node_modules', '@qandeel-company', 'domain', 'dist', 'src', 'desktop-proof-b.json'), '{"build":"B"}\n'));
const B = await composeBundle({ out: path.join(scratch, 'build-B'), pins, nodeExe, nodeLicense, desktopVersion: '1.0.1', releaseRoot: relB });
const setupB = setupOf(B, 'B');
const relC = await variantRelease(relB, path.join(scratch, 'releases-C'), 'c', (d) => appendFileSync(path.join(d, 'node_modules', '@qandeel-company', 'command-center', 'dist', 'src', 'cli.js'), '\nif (process.argv.includes("serve")) process.exit(9);\n'));
const C = await composeBundle({ out: path.join(scratch, 'build-C'), pins, nodeExe, nodeLicense, desktopVersion: '1.0.2', releaseRoot: relC });
const setupC = setupOf(C, 'C');
check('build.setup-compiled', [setupA, setupB, setupC].every((s) => existsSync(s)), 'A 1.0.0, B 1.0.1, C 1.0.2 (C: a host that never comes up)');

// The candidate artifact (ENGINEERING unless signed and clean — see the verification record).
if (values.artifacts) {
  const outDir = path.resolve(values.artifacts);
  mkdirSync(outDir, { recursive: true });
  const record = verificationRecord({ setup: setupA, manifest: A.manifest, versionDir: A.versionDir, signature: authenticode(setupA) });
  cpSync(setupA, path.join(outDir, `${SETUP_NAME}.exe`));
  writeFileSync(path.join(outDir, `${SETUP_NAME}.verification.json`), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(path.join(outDir, `${SETUP_NAME}.exe.sha256`), `${record.setupSha256}  ${SETUP_NAME}.exe\n`);
  writeFileSync(path.join(outDir, 'qandeel-desktop-bundle.json'), `${JSON.stringify(A.manifest, null, 2)}\n`);
  // The supported Founder-local artifact (D-D1-08): the bundle folder itself and its verification record.
  const bundleOut = path.join(outDir, `QANDEEL-COMPANY-Desktop-${A.versionDir}`);
  cpSync(A.bundleDir, bundleOut, { recursive: true });
  const bundleRecord = await bundleVerificationRecord({ bundleDir: bundleOut, manifest: A.manifest, versionDir: A.versionDir });
  writeFileSync(path.join(outDir, 'QANDEEL-COMPANY-Desktop.verification.json'), `${JSON.stringify(bundleRecord, null, 2)}\n`);
  check('artifact.founder-local-bundle', bundleRecord.blockers.length === 0, `${bundleRecord.artifactClass} bundle ${bundleRecord.bundleId.slice(0, 12)} (node.exe ${bundleRecord.node.authenticode.status}) ${bundleRecord.blockers.join(' ')}`);
  check('artifact.recorded', true, `${record.artifactClass} ${record.setupSha256} (Authenticode ${record.authenticode.status})`);
}

let logN = 0;
const runSetup = (setup, args = []) => {
  const log = path.join(scratch, 'logs', `setup-${++logN}.log`);
  const r = spawnSync(setup, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${log}`, ...args], { windowsHide: true, timeout: 900_000 });
  return { code: r.status, log, tail: () => (existsSync(log) ? readFileSync(log, 'utf8').split(/\r?\n/).slice(-25).join(' | ') : 'no log') };
};
const versionDir = (b) => path.join(programRoot, 'versions', b.versionDir);
const inst = (b) => ({ dir: versionDir(b), node: path.join(versionDir(b), 'node', 'node.exe') });
const desktopDir = powershellJson("[Environment]::GetFolderPath('Desktop') | ConvertTo-Json");
const programsDir = powershellJson("[Environment]::GetFolderPath('Programs') | ConvertTo-Json");
const desktopLnk = path.join(desktopDir, 'QANDEEL COMPANY.lnk');
const startDir = path.join(programsDir, 'QANDEEL COMPANY');
const env = isolatedEnv(LAD);
const lower = (p) => String(p ?? '').toLowerCase();
const ws = path.join(scratch, 'company');
const pinOf = () => runtime.readReleasePin(ws);
const cliOf = () => path.join(pinOf()?.root ?? '', 'node_modules', '@qandeel-company', 'command-center', 'dist', 'src', 'cli.js');
const run = (b, args) => runInstalled({ node: inst(b).node, cli: cliOf(), args, env, cwd: scratch });
const hosts = () => processesNaming(' serve --workspace ').filter((p) => lower(p.commandLine).includes(lower(ws)));
const uninstallAndWait = async () => {
  const entry = uninstallEntry(pins.appId);
  const exe = String(entry?.UninstallString ?? '').replace(/^"|"$/g, '');
  if (!exe) return { code: null, gone: true };
  const r = spawnSync(exe, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${path.join(scratch, 'logs', `uninstall-${++logN}.log`)}`], { windowsHide: true, timeout: 600_000 });
  // The Inno uninstaller re-launches itself from a temporary copy and returns at once: wait for its effect, bounded.
  for (let i = 0; i < 240 && (uninstallEntry(pins.appId) !== null || existsSync(path.join(programRoot, 'versions'))); i++) await sleep(500);
  return { code: r.status, gone: uninstallEntry(pins.appId) === null };
};

try {
  // first run without a Company: bounded, nothing created; then an invalid choice: nothing created
  const none = runSetup(setupA);
  check('install.no-company-setup-required', none.code === 102 && !existsSync(companyData) && !existsSync(desktopLnk), `exit ${none.code}${none.code === 102 ? '' : ` — ${none.tail()}`}`);
  await uninstallAndWait();
  const empty = path.join(scratch, 'empty-folder');
  mkdirSync(empty, { recursive: true });
  const bad = runSetup(setupA, [`/WORKSPACE=${empty}`]);
  check('install.invalid-workspace-creates-nothing', bad.code === 101 && listTree(empty).length === 0 && !existsSync(companyData), `exit ${bad.code}`);
  const cleaned = await uninstallAndWait();
  check('uninstall.without-company', cleaned.gone && !existsSync(path.join(programRoot, 'versions')));

  // the existing Company, as OPS left it
  const { storage } = await devModules();
  storage.CompanyStore.open(ws).close();
  await seedSentinel(ws);
  const fp0 = await companyFingerprint(ws);
  const configFile = path.join(companyData, 'launcher', 'founder-launcher.json');
  mkdirSync(path.dirname(configFile), { recursive: true });
  writeFileSync(configFile, `${JSON.stringify({ version: 1, workspace: ws, providers: [] }, null, 2)}\n`);
  const configBytes = readFileSync(configFile);

  const a = runSetup(setupA);
  const entry = uninstallEntry(pins.appId);
  check('install.per-user', a.code === 0 && entry?.DisplayName === 'QANDEEL COMPANY' && entry?.DisplayVersion === '1.0.0' && lower(entry?.InstallLocation).startsWith(lower(path.join(LAD, 'Programs', 'QANDEEL COMPANY'))) && !machineUninstallEntryExists(pins.appId), `exit ${a.code}; HKCU ${entry?.DisplayName} ${entry?.DisplayVersion}`);
  check('install.versioned-files', existsSync(inst(A).node) && existsSync(path.join(inst(A).dir, 'qandeel-desktop-bundle.json')) && pinOf()?.releaseId === A.manifest.release.releaseId);
  const sc = readShortcut(desktopLnk);
  check('install.branded-shortcuts', sc !== null && lower(sc.target).endsWith('\\system32\\conhost.exe') && lower(sc.arguments).startsWith(lower(`--headless "${inst(A).node}"`)) && lower(sc.icon).startsWith(lower(path.join(inst(A).dir, 'app', 'qandeel-company.ico'))) && ['QANDEEL COMPANY.lnk', 'QANDEEL COMPANY — Status.lnk', 'QANDEEL COMPANY — Stop.lnk', 'QANDEEL COMPANY — Restart.lnk'].every((n) => existsSync(path.join(startDir, n))));
  check('install.uninstall-icon', lower(entry?.DisplayIcon).includes('qandeel-company.ico'));
  const host = hosts()[0];
  check('runtime.ready-on-private-runtime', host !== undefined && lower(host.exe) === lower(inst(A).node) && (await run(A, ['status'])).json.state === 'RUNNING');
  check('runtime.no-token-in-process-args', hosts().every((p) => !/launch|#|token/i.test(p.commandLine.replace(/--workspace\s+("[^"]*"|\S+)/, ''))));
  // The Desktop shortcut's own command line (conhost --headless → private node → the release CLI), as `status`.
  // The Stop shortcut's own command line, launched the way Windows launches it; its effect is the proof (no pop-up).
  const stopLnk = readShortcut(path.join(startDir, 'QANDEEL COMPANY — Stop.lnk'));
  launchLikeWindows(stopLnk?.target ?? 'missing', String(stopLnk?.arguments ?? '').replace(/ --notify$/, ''), env, scratch);
  const viaShortcut = await run(A, ['status']);
  check('runtime.shortcut-command-headless', viaShortcut.json.state === 'STOPPED' && hosts().length === 0, `${viaShortcut.json.state}`);
  // The shortcut above stopped the host: open → controlled stop → open again.
  const reopened = await run(A, ['open', '--no-browser']);
  const stop = await run(A, ['stop']);
  const open = await run(A, ['open', '--no-browser']);
  check('runtime.open-stop-open', reopened.json.ok === true && stop.json.outcome === 'STOPPED' && open.json.ok === true && hosts().length === 1, `${reopened.json.outcome} → ${stop.json.outcome} → ${open.json.outcome}`);
  check('install.company-unchanged', (await companyFingerprint(ws)) === fp0 && readFileSync(configFile).equals(configBytes));

  // update A → B
  const b = runSetup(setupB);
  check('update.a-to-b', b.code === 0 && pinOf()?.releaseId === B.manifest.release.releaseId && pinOf()?.previous?.releaseId === A.manifest.release.releaseId && uninstallEntry(pins.appId)?.DisplayVersion === '1.0.1' && existsSync(inst(A).node) && lower(hosts()[0]?.exe) === lower(inst(B).node), `exit ${b.code}`);
  check('update.shortcuts-on-b', lower(readShortcut(desktopLnk)?.arguments).startsWith(lower(`--headless "${inst(B).node}"`)));
  check('update.company-unchanged', (await companyFingerprint(ws)) === fp0);

  // failed update C → rollback to B
  const scBefore = JSON.stringify(readShortcut(desktopLnk));
  const c = runSetup(setupC);
  check('update.failed-c-rolled-back', c.code === 101 && pinOf()?.releaseId === B.manifest.release.releaseId && (await run(B, ['status'])).json.state === 'RUNNING' && JSON.stringify(readShortcut(desktopLnk)) === scBefore, `exit ${c.code}`);
  check('update.failed-c-company-unchanged', (await companyFingerprint(ws)) === fp0);

  // repair: run Setup B again after damage
  rmSync(path.join(inst(B).dir, 'app', 'qandeel-company.ico'));
  rmSync(desktopLnk);
  const r = runSetup(setupB);
  check('repair.restored', r.code === 0 && existsSync(path.join(inst(B).dir, 'app', 'qandeel-company.ico')) && existsSync(desktopLnk) && pinOf()?.releaseId === B.manifest.release.releaseId && pinOf()?.previous?.releaseId === A.manifest.release.releaseId && (await companyFingerprint(ws)) === fp0, `exit ${r.code}`);

  // detached from the development checkout
  const OFF = '.desktop-e2e-off';
  const moved = [];
  try {
    for (const d of ['node_modules', 'packages']) {
      renameSync(path.join(ROOT, d), path.join(ROOT, d + OFF));
      moved.push(d);
    }
    const s1 = await run(B, ['stop']);
    const o1 = await run(B, ['open', '--no-browser']);
    check('detached.runs-without-checkout-code-and-modules', s1.json.ok === true && o1.json.ok === true && (await run(B, ['status'])).json.state === 'RUNNING', `${s1.json.outcome} → ${o1.json.outcome}`);
  } finally {
    for (const d of moved) renameSync(path.join(ROOT, d + OFF), path.join(ROOT, d));
  }
  const leaks = [...scanForLeaks(programRoot), ...scanForLeaks(path.join(companyData, 'launcher')), ...scanForLeaks(path.join(scratch, 'logs'))];
  check('detached.no-checkout-reference-no-secret', leaks.length === 0, leaks.slice(0, 5).join('; '));

  // uninstall: the application only; then reinstall → the same Company
  const pinBytes = readFileSync(runtime.releasePinPath(ws));
  const releases = listTree(path.join(companyData, 'releases')).length;
  const u = await uninstallAndWait();
  check('uninstall.application-gone', u.gone && !existsSync(path.join(programRoot, 'versions')) && !existsSync(desktopLnk) && !existsSync(startDir) && hosts().length === 0);
  check('uninstall.company-data-preserved', (await companyFingerprint(ws)) === fp0 && readFileSync(runtime.releasePinPath(ws)).equals(pinBytes) && readFileSync(configFile).equals(configBytes) && listTree(path.join(companyData, 'releases')).length === releases);
  const again = runSetup(setupB);
  check('reinstall.same-company', again.code === 0 && pinOf()?.releaseId === B.manifest.release.releaseId && (await run(B, ['status'])).json.state === 'RUNNING' && (await companyFingerprint(ws)) === fp0, `exit ${again.code}`);
  await uninstallAndWait();

  // The supported Founder-local install (D-D1-08): no Setup.exe — the bundle as received, installed by its own official
  // node.exe; the real per-user "Apps" entry; uninstall through exactly that entry's command.
  const download = path.join(scratch, 'Downloads', 'QANDEEL-COMPANY-B');
  cpSync(B.bundleDir, download, { recursive: true });
  const srcCli = path.join(download, 'release', 'node_modules', '@qandeel-company', 'command-center', 'dist', 'src', 'cli.js');
  const local = await runInstalled({ node: path.join(download, 'node', 'node.exe'), cli: srcCli, args: ['desktop-local-install', '--bundle', download], env, cwd: scratch, timeoutMs: 900_000 });
  const appsKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QANDEEL COMPANY';
  const appsEntry = () => powershellJson(`$k = '${appsKey}'; if (Test-Path -LiteralPath $k) { Get-ItemProperty -LiteralPath $k | Select-Object DisplayName, DisplayVersion, DisplayIcon, InstallLocation, UninstallString | ConvertTo-Json -Compress } else { 'null' }`);
  const localEntry = appsEntry();
  check('local.install', local.code === 0 && local.json.outcome === 'INSTALLED' && pinOf()?.releaseId === B.manifest.release.releaseId && (await run(B, ['status'])).json.state === 'RUNNING' && lower(hosts()[0]?.exe) === lower(inst(B).node) && existsSync(desktopLnk), `exit ${local.code} ${local.json.outcome}`);
  check('local.apps-entry', localEntry?.DisplayName === 'QANDEEL COMPANY' && localEntry?.DisplayVersion === '1.0.1' && lower(localEntry?.UninstallString).startsWith(lower(`"${path.join(process.env.SystemRoot, 'System32', 'conhost.exe')}" --headless`)), localEntry ? `${localEntry.DisplayName} ${localEntry.DisplayVersion}` : 'no localEntry');
  check('local.company-unchanged', (await companyFingerprint(ws)) === fp0 && readFileSync(configFile).equals(configBytes));
  const cmd = splitCommandLine(localEntry?.UninstallString);
  launchLikeWindows(cmd.target, cmd.rest, env, scratch);
  for (let i = 0; i < 120 && (existsSync(programRoot) || appsEntry() !== null); i++) await sleep(500);
  check('local.uninstall-from-apps', !existsSync(programRoot) && appsEntry() === null && !existsSync(desktopLnk) && !existsSync(startDir) && hosts().length === 0);
  check('local.uninstall-company-preserved', (await companyFingerprint(ws)) === fp0 && readFileSync(configFile).equals(configBytes) && pinOf()?.releaseId === B.manifest.release.releaseId);
} finally {
  for (const p of hosts()) {
    try {
      process.kill(p.pid, 'SIGKILL');
    } catch {
      // gone
    }
  }
}

const failed = failures();
process.stdout.write(`\nDesktop e2e: ${failed === 0 ? 'PASS' : `FAIL (${failed})`}\n`);
if (failed) process.exitCode = 1;
