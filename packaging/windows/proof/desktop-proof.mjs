#!/usr/bin/env node
/**
 * npm run desktop:proof -- --workspace <disposable dir> [--cache <dir>] [--keep]
 *
 * The focused Desktop v1 proof (D1, D-D1-07). Disposable only: an isolated LOCALAPPDATA, an isolated shortcut root, a
 * disposable Company workspace — never the real profile, never LIVE. Every installed operation runs the INSTALLED CLI on
 * the INSTALLED private Node runtime with a PATH that holds no Node, npm or Git, from a directory outside the checkout.
 * Setup.exe's own file copy is mirrored here (copy the bundle into `Programs\QANDEEL COMPANY\versions\<version>`); the
 * real Setup.exe end to end is `desktop:e2e` (Windows CI).
 *
 *   packaging   pinned Node version / hash, corrupt download and cache refused, wrong architecture refused, release
 *               manifest intact, tampering refused, source → release → bundle traceability, no development path,
 *               no secret, approved icon, installer definition (per-user, no elevation, no PATH / autostart / data
 *               deletion);
 *   install     no configuration → SETUP_REQUIRED and nothing created; missing / invalid workspace → nothing created;
 *               another runtime refused; the existing Company adopted; shortcuts on the private runtime with the icon;
 *   runtime     open, reopen, concurrent open → one host, status, controlled stop, restart, hard kill → recovery, no
 *               token / credential in process arguments, logs, shortcuts or configuration;
 *   update      A → B side by side (verified backup, pin, health, shortcuts → B); failed C rolls back to B unchanged;
 *   repair      missing application file and shortcut restored, the same Company;
 *   uninstall   host stopped, application and shortcuts gone, Company data / vault / releases / pin / configuration kept;
 *               reinstall returns to the same Company;
 *   detached    the installed product runs with the checkout's packages and node_modules made unavailable.
 *
 * Exercises: the installed release's @qandeel-company/command-center CLI (desktop-install / desktop-uninstall / open /
 * status / stop / restart) and reads Company state through @qandeel-company/storage and @qandeel-company/runtime.
 */
import { createServer } from 'node:http';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { readIco } from '../lib/png-ico.mjs';
import { PACKAGING_DIR, ROOT, authenticode, composeBundle, fetchPinned, loadPins, peMachine, productModules, scanForLeaks, sha256, sha256File, sourceState, verifyNodeRuntime } from '../lib/desktop-build.mjs';
import { companyFingerprint, devModules, isolatedEnv, launchLikeWindows, listTree, pathWithoutDevTools, powershellJson, processesNaming, readShortcut, recorder, runInstalled, seedSentinel, sleep, splitCommandLine, variantRelease } from '../lib/proof-kit.mjs';

const { values } = parseArgs({ options: { workspace: { type: 'string' }, cache: { type: 'string' }, keep: { type: 'boolean', default: false } } });
const scratch = path.resolve(values.workspace ?? mkdtempSync(path.join(tmpdir(), 'qc-desktop-proof-')));
const insideCheckout = (p) => {
  const rel = path.relative(ROOT, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
if (insideCheckout(scratch)) throw new Error('the proof workspace must lie outside the checkout');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

// A previous run that died while the checkout was made unavailable is healed first (never leave the checkout broken).
const OFF = '.desktop-proof-off';
for (const d of ['node_modules', 'packages']) if (!existsSync(path.join(ROOT, d)) && existsSync(path.join(ROOT, d + OFF))) renameSync(path.join(ROOT, d + OFF), path.join(ROOT, d));

const { check, failures } = recorder();
const pins = loadPins();
const cacheDir = path.resolve(values.cache ?? path.join(tmpdir(), 'qandeel-desktop-cache'));
const nodeExe = await fetchPinned({ url: pins.node.url, sha256: pins.node.sha256, cacheDir, name: 'node.exe' });
const nodeLicense = await fetchPinned({ url: pins.node.licenseUrl, sha256: pins.node.licenseSha256, cacheDir, name: 'node-LICENSE' });
const { desktop } = await productModules();
const { runtime } = await devModules();
const throwsCode = (fn, code) => {
  try {
    fn();
    return false;
  } catch (e) {
    return String(e.message).startsWith(code);
  }
};
const rejectsCode = async (p, code) => {
  try {
    await p;
    return false;
  } catch (e) {
    return String(e.message).startsWith(code);
  }
};

// ─── packaging ──────────────────────────────────────────────────────────────────────────────────────────────────────
const A = await composeBundle({ out: path.join(scratch, 'build-A'), pins, nodeExe, nodeLicense });
const source = sourceState();
check('packaging.node-pinned', pins.node.version.startsWith('24.') && A.manifest.node.version === pins.node.version && A.manifest.node.sha256 === pins.node.sha256 && sha256File(path.join(A.bundleDir, 'node', 'node.exe')) === pins.node.sha256, `Node ${pins.node.version} win-x64 ${pins.node.sha256.slice(0, 16)}…`);
check('packaging.node-is-x64-image', peMachine(readFileSync(nodeExe)) === 'x64');
if (process.platform === 'win32') {
  const sig = authenticode(nodeExe);
  check('packaging.node-officially-signed', sig.status === 'Valid' && /OpenJS Foundation/i.test(sig.signer ?? ''), `${sig.status} ${sig.signer ?? ''}`.trim());
}
{
  const corrupt = path.join(scratch, 'corrupt-node.exe');
  const buf = Buffer.from(readFileSync(nodeExe));
  buf[buf.length - 1] ^= 0xff;
  writeFileSync(corrupt, buf);
  check('packaging.corrupt-runtime-refused', throwsCode(() => verifyNodeRuntime(corrupt, pins), 'RUNTIME_HASH_MISMATCH'));
  const arm = Buffer.from(readFileSync(nodeExe));
  arm.writeUInt16LE(0xaa64, arm.readUInt32LE(0x3c) + 4);
  const armFile = path.join(scratch, 'arm64.exe');
  writeFileSync(armFile, arm);
  check('packaging.wrong-architecture-refused', throwsCode(() => verifyNodeRuntime(armFile, { node: { ...pins.node, sha256: sha256(arm) } }), 'RUNTIME_ARCH_MISMATCH'), 'an arm64 image whose hash matches its pin is still refused');
  // A corrupt download is refused and never cached; a corrupt cache entry is discarded and re-fetched.
  const server = createServer((req, res) => res.end(req.url === '/good' ? readFileSync(nodeExe) : buf)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const dlCache = path.join(scratch, 'cache-proof');
  check('packaging.corrupt-download-refused', await rejectsCode(fetchPinned({ url: `http://127.0.0.1:${port}/bad`, sha256: pins.node.sha256, cacheDir: dlCache, name: 'node.exe' }), 'PIN_MISMATCH'));
  check('packaging.corrupt-download-not-cached', listTree(dlCache).length === 0);
  mkdirSync(dlCache, { recursive: true });
  writeFileSync(path.join(dlCache, `${pins.node.sha256.slice(0, 16)}-node.exe`), buf);
  const healed = await fetchPinned({ url: `http://127.0.0.1:${port}/good`, sha256: pins.node.sha256, cacheDir: dlCache, name: 'node.exe' });
  check('packaging.corrupt-cache-replaced', sha256File(healed) === pins.node.sha256);
  server.close();
}
{
  const bundleCheck = desktop.verifyDesktopBundle(A.bundleDir);
  const rel = runtime.verifyReleaseTree(path.join(A.bundleDir, 'release'));
  check('packaging.release-intact', bundleCheck.ok && rel.ok && rel.manifest.releaseId === A.manifest.release.releaseId, `release ${A.manifest.release.releaseId.slice(0, 16)}…`);
  const tamper = (name, change, reason) => {
    const dir = path.join(scratch, `tamper-${name}`);
    cpSync(A.bundleDir, dir, { recursive: true });
    change(dir);
    const r = desktop.verifyDesktopBundle(dir);
    check(`packaging.tamper-refused.${name}`, !r.ok && r.reason === reason, r.ok ? 'accepted' : r.reason);
  };
  const someJs = rel.ok ? rel.manifest.files.find((f) => f.path.endsWith('.js')).path : 'x';
  tamper('release-file', (d) => appendFileSync(path.join(d, 'release', ...someJs.split('/')), '\n// edited\n'), 'RELEASE_TAMPERED');
  tamper('runtime', (d) => appendFileSync(path.join(d, 'node', 'node.exe'), 'x'), 'BUNDLE_TAMPERED');
  tamper('icon', (d) => appendFileSync(path.join(d, 'app', 'qandeel-company.ico'), 'x'), 'BUNDLE_TAMPERED');
  tamper('extra-file', (d) => writeFileSync(path.join(d, 'app', 'extra.cmd'), 'echo'), 'BUNDLE_TAMPERED');
  tamper('manifest', (d) => {
    const f = path.join(d, 'qandeel-desktop-bundle.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace(`"desktopVersion": "${A.manifest.desktopVersion}"`, '"desktopVersion": "9.9.9"'));
  }, 'BUNDLE_TAMPERED');
  const relManifest = rel.ok ? rel.manifest : null;
  check('packaging.traceable', A.manifest.source.commit === source.commit && relManifest?.sourceCommit === source.commit && A.manifest.bundleId === desktop.bundleIdOf(A.manifest) && A.versionDir === `${A.manifest.desktopVersion}-${A.manifest.bundleId.slice(0, 12)}`, `source ${String(source.commit).slice(0, 12)} → release ${A.manifest.release.releaseId.slice(0, 12)} → bundle ${A.manifest.bundleId.slice(0, 12)}`);
  const leaks = scanForLeaks(A.bundleDir);
  check('packaging.no-dev-path-no-secret', leaks.length === 0, leaks.join('; '));
  const dirty = path.join(scratch, 'leak-probe');
  mkdirSync(dirty, { recursive: true });
  writeFileSync(path.join(dirty, 'a.json'), JSON.stringify({ p: path.join(ROOT, 'packages') }));
  writeFileSync(path.join(dirty, 'b.js'), `const k = 'sk-${'A1b2C3d4'.repeat(4)}';`);
  const found = scanForLeaks(dirty);
  check('packaging.leak-scanner-detects', found.some((f) => f.includes('development checkout')) && found.some((f) => f.includes('credential')));
}
{
  const ico = readFileSync(path.join(PACKAGING_DIR, pins.icon.file));
  const entries = readIco(ico);
  const prov = JSON.parse(readFileSync(path.join(PACKAGING_DIR, pins.icon.provenance), 'utf8'));
  const svg = readFileSync(path.join(PACKAGING_DIR, 'assets', 'source', 'APP_ICON_B_DARK_LUMINOUS.svg'));
  check('packaging.icon-approved', sha256(ico) === pins.icon.sha256 && prov.ico.sha256 === pins.icon.sha256 && sha256(svg) === prov.sourceSha256 && prov.fidelityAgainstBrandPackageIosRenders.every((f) => f.maxAbsDiff === 0) && [16, 32, 48, 256].every((n) => entries.some((e) => e.size === n)), `ico ${entries.map((e) => e.size).join('/')} from I-08B2.5 ${prov.sourceSha256.slice(0, 12)}…`);
}
{
  const iss = readFileSync(path.join(PACKAGING_DIR, 'qandeel-company.iss'), 'utf8');
  const code = iss.split('\n').filter((l) => !l.trim().startsWith(';')).join('\n');
  check('packaging.installer-per-user-no-elevation', /^PrivilegesRequired=lowest$/m.test(code) && !/PrivilegesRequiredOverridesAllowed/.test(code) && /^DefaultDirName=\{autopf\}\\/m.test(code));
  check('packaging.installer-no-path-autostart-registry', !/^\[(Registry|Icons|UninstallDelete|InstallDelete)\]/m.test(code) && /^ChangesEnvironment=no$/m.test(code) && !/CurrentVersion\\Run|\{commonstartup\}|\{userstartup\}|DelTree|DeleteFile|RemoveDir/i.test(code));
  check('packaging.installer-delegates-to-canonical-activation', code.includes('desktop-install --bundle') && code.includes('desktop-uninstall') && /DestDir: "\{app\}\\versions\\\{#VersionDir\}"/.test(code));
}

// ─── Windows: install / runtime / update / repair / uninstall ──────────────────────────────────────────────────────
if (process.platform !== 'win32') {
  process.stdout.write('PROOF NOTE install/runtime/update/repair/uninstall run on Windows only (the plan always includes the Windows run)\n');
} else {
  const LAD = path.join(scratch, 'LocalAppData');
  const shell = path.join(scratch, 'Shell');
  const ws = path.join(scratch, 'company');
  const programRoot = path.join(LAD, 'Programs', 'QANDEEL COMPANY');
  const companyData = path.join(LAD, 'QANDEEL_COMPANY');
  mkdirSync(LAD, { recursive: true });
  const env = isolatedEnv(LAD);
  const devToolsVisible = env.PATH.split(path.delimiter).filter((d) => ['node.exe', 'npm.cmd', 'git.exe'].some((t) => existsSync(path.join(d, t))));
  check('install.no-global-node-npm-git-on-path', devToolsVisible.length === 0 && pathWithoutDevTools(env.PATH) === env.PATH);
  // The supported Founder-local install (D-D1-08): the bundle as the Founder receives it (a folder, e.g. in Downloads),
  // installed by its own official node.exe with desktop-local-install. A scratch per-user key stands in for the real
  // "Apps" entry; uninstall runs exactly the command that entry holds.
  const appsKey = `HKCU:\\Software\\QANDEEL_COMPANY_DESKTOP_PROOF\\${path.basename(scratch).replace(/[^\w-]/g, '')}-${process.pid}`;
  const cliOf = (dir) => path.join(dir, 'release', 'node_modules', '@qandeel-company', 'command-center', 'dist', 'src', 'cli.js');
  const layDown = (bundle) => {
    const download = path.join(scratch, 'Downloads', `QANDEEL-COMPANY-${bundle.versionDir}`);
    if (!existsSync(download)) cpSync(bundle.bundleDir, download, { recursive: true });
    const dir = path.join(programRoot, 'versions', bundle.versionDir);
    return { dir, node: path.join(dir, 'node', 'node.exe'), cli: cliOf(dir), src: { dir: download, node: path.join(download, 'node', 'node.exe'), cli: cliOf(download) } };
  };
  const run = (inst, args, timeoutMs) => runInstalled({ node: inst.node, cli: inst.cli, args, env, cwd: scratch, ...(timeoutMs ? { timeoutMs } : {}) });
  const install = (inst, extra = []) => run(inst.src, ['desktop-local-install', '--bundle', inst.src.dir, '--shortcut-root', shell, '--uninstall-key', appsKey, ...extra], 900_000);
  // The registered uninstall command: System32 conhost → System32 PowerShell → an encoded script naming the INSTALLED runtime.
  const uninstallScript = (entry) => Buffer.from(/-EncodedCommand\s+(\S+)/.exec(String(entry?.UninstallString ?? ''))?.[1] ?? '', 'base64').toString('utf16le');
  const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32').toLowerCase();
  const signedWindowsOnly = (entry) => { const l = String(entry?.UninstallString ?? '').toLowerCase(); return l.startsWith(`"${system32}\\conhost.exe" --headless "${system32}\\windowspowershell\\v1.0\\powershell.exe"`); };
  const appsEntry = () => powershellJson(`$k = '${appsKey}'; if (Test-Path -LiteralPath $k) { Get-ItemProperty -LiteralPath $k | Select-Object DisplayName, DisplayVersion, DisplayIcon, InstallLocation, UninstallString | ConvertTo-Json -Compress } else { 'null' }`);
  const lnk = (name) => path.join(shell, 'Desktop', `${name}.lnk`);
  const startLnks = () => listTree(path.join(shell, 'Programs', 'QANDEEL COMPANY'));
  const pinOf = () => runtime.readReleasePin(ws);
  const lower = (p) => String(p ?? '').toLowerCase();
  const serveProcesses = () => processesNaming(' serve --workspace ').filter((p) => lower(p.commandLine).includes(lower(path.basename(ws))) && lower(p.commandLine).includes(lower(scratch)));
  try {
    const stepsOf = (json) => Object.fromEntries((json.steps ?? []).map((st) => [st.step.replace(/^INSTALLED\./, ''), st.result]));
    // install: no configuration → bounded SETUP_REQUIRED, nothing installed, nothing created
    const instA = layDown(A);
    const none = await install(instA);
    check('install.no-config-setup-required', none.code === 2 && none.json.outcome === 'SETUP_REQUIRED' && !existsSync(companyData) && !existsSync(programRoot) && appsEntry() === null && listTree(shell).length === 0, `exit ${none.code} ${none.json.outcome}`);
    const empty = path.join(scratch, 'empty-folder');
    mkdirSync(empty);
    const invalid = await install(instA, ['--workspace', empty]);
    check('install.invalid-workspace-creates-nothing', invalid.code === 1 && invalid.json.outcome === 'WORKSPACE_INVALID' && readdirSync(empty).length === 0 && !existsSync(companyData) && !existsSync(programRoot), `${invalid.json.outcome}`);
    const missing = path.join(scratch, 'no-such-company');
    const miss = await install(instA, ['--workspace', missing]);
    check('install.missing-workspace-creates-nothing', miss.code === 1 && miss.json.outcome === 'WORKSPACE_MISSING' && !existsSync(missing) && !existsSync(companyData) && !existsSync(programRoot), `${miss.json.outcome}`);
    const foreign = await runInstalled({ node: process.execPath, cli: instA.src.cli, args: ['desktop-local-install', '--bundle', instA.src.dir, '--shortcut-root', shell, '--uninstall-key', appsKey], env: { ...env, PATH: process.env.PATH }, cwd: scratch });
    check('install.private-runtime-required', foreign.code === 1 && foreign.json.outcome === 'PRIVATE_RUNTIME_REQUIRED', `${foreign.json.outcome}`);

    // the existing Founder Company (as OPS left it: a workspace and the launcher configuration)
    const { storage } = await devModules();
    storage.CompanyStore.open(ws).close();
    await seedSentinel(ws);
    const fp0 = await companyFingerprint(ws);
    const configFile = path.join(companyData, 'launcher', 'founder-launcher.json');
    mkdirSync(path.dirname(configFile), { recursive: true });
    writeFileSync(configFile, `${JSON.stringify({ version: 1, workspace: ws, providers: [] }, null, 2)}\n`);
    const configBytes = readFileSync(configFile);
    const vaultBlob = path.join(companyData, 'vault', 'desktop-proof.dpapi.json');
    mkdirSync(path.dirname(vaultBlob), { recursive: true });
    writeFileSync(vaultBlob, JSON.stringify({ format: 'QANDEEL_COMPANY_VAULT_DPAPI_V1', scope: 'CurrentUser', protected: 'placeholder-not-a-secret', createdAt: new Date().toISOString() }));
    const vaultBytes = readFileSync(vaultBlob);
    const first = await install(instA);
    const steps = stepsOf(first.json);
    check('install.existing-company-adopted', first.code === 0 && first.json.outcome === 'INSTALLED' && steps.COPY === 'INSTALLED' && steps['ACTIVATE.BACKUP'] === 'VERIFIED' && steps['ACTIVATE.HEALTH'] === 'READY' && pinOf()?.releaseId === A.manifest.release.releaseId, `${first.json.outcome} ${(first.json.steps ?? []).map((s) => `${s.step}=${s.result}`).join(' ')}`);
    check('install.release-in-canonical-releases-dir', lower(pinOf()?.root).startsWith(lower(path.join(companyData, 'releases'))));
    check('install.launcher-config-preserved', readFileSync(configFile).equals(configBytes));
    const entryA = appsEntry();
    check('install.apps-entry', entryA?.DisplayName === 'QANDEEL COMPANY' && entryA?.DisplayVersion === '1.0.0' && lower(entryA?.InstallLocation) === lower(programRoot) && signedWindowsOnly(entryA) && lower(uninstallScript(entryA)).includes(lower(`'${instA.node}'`)) && uninstallScript(entryA).includes("'desktop-local-uninstall'") && lower(uninstallScript(entryA)).includes(lower(`'${programRoot}'`)) && lower(entryA?.DisplayIcon).endsWith('qandeel-company.ico'), entryA ? `${entryA.DisplayName} ${entryA.DisplayVersion}` : 'no entry');
    check('install.from-download-not-referenced', !lower(JSON.stringify(entryA)).includes(lower(path.join(scratch, 'Downloads'))) && !lower(readFileSync(path.join(companyData, 'launcher', 'desktop-product.json'), 'utf8')).includes('downloads'));
    const sc = readShortcut(lnk('QANDEEL COMPANY'));
    const conhost = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'conhost.exe');
    const cliA = path.join(pinOf()?.root ?? '', 'node_modules', '@qandeel-company', 'command-center', 'dist', 'src', 'cli.js');
    check('install.shortcut-private-runtime-headless-icon', sc !== null && lower(sc.target) === lower(conhost) && lower(sc.arguments).startsWith(lower(`--headless "${instA.node}" "${cliA}" open`)) && lower(sc.icon) === lower(`${path.join(instA.dir, 'app', 'qandeel-company.ico')},0`), sc ? `${sc.target} ${sc.arguments.replace(/"[^"]*"/g, '"…"')}` : 'no shortcut');
    check('install.start-menu-entries', ['QANDEEL COMPANY.lnk', 'QANDEEL COMPANY — Restart.lnk', 'QANDEEL COMPANY — Status.lnk', 'QANDEEL COMPANY — Stop.lnk'].every((n) => startLnks().includes(n)), startLnks().join(', '));
    check('install.company-unchanged', (await companyFingerprint(ws)) === fp0);

    // runtime
    const cliInst = { node: instA.node, cli: cliA };
    const status1 = await run(cliInst, ['status']);
    check('runtime.status', status1.json.state === 'RUNNING' && status1.json.admitted === 'ADMITTED', `${status1.json.state} ${status1.json.admitted}`);
    const open1 = await run(cliInst, ['open', '--no-browser']);
    check('runtime.open', open1.code === 0 && open1.json.ok === true && open1.json.instanceId === status1.json.instanceId && String(open1.json.launchUrl ?? '').startsWith('http://127.0.0.1:'), `${open1.json.outcome}`);
    const reopen = await run(cliInst, ['open', '--no-browser']);
    check('runtime.reopen', reopen.json.outcome === 'REUSED' && reopen.json.instanceId === status1.json.instanceId);
    const many = await Promise.all([1, 2, 3].map(() => run(cliInst, ['open', '--no-browser'])));
    check('runtime.concurrent-open-one-host', many.every((m) => m.json.ok === true && m.json.instanceId === status1.json.instanceId) && serveProcesses().length === 1, `${serveProcesses().length} host process(es)`);
    check('runtime.close-ui-host-remains', (await run(cliInst, ['status'])).json.state === 'RUNNING', 'the launcher exited; the host keeps running');
    const host = serveProcesses()[0];
    check('runtime.host-on-private-runtime', host !== undefined && lower(host.exe) === lower(instA.node) && lower(host.commandLine).includes(lower(pinOf()?.root)), host ? host.exe : 'no host');
    check('runtime.no-token-in-process-args', serveProcesses().every((p) => !/launch|#|token|sk-/i.test(p.commandLine.replace(/--workspace\s+("[^"]*"|\S+)/, ''))));
    const stop = await run(cliInst, ['stop']);
    check('runtime.controlled-stop', stop.json.outcome === 'STOPPED' && (await run(cliInst, ['status'])).json.state === 'STOPPED' && serveProcesses().length === 0);
    const restart = await run(cliInst, ['restart', '--no-browser']);
    check('runtime.restart', restart.json.ok === true && (await run(cliInst, ['status'])).json.state === 'RUNNING', `${restart.json.outcome}`);
    const killed = serveProcesses()[0];
    if (killed) process.kill(killed.pid, 'SIGKILL');
    for (let i = 0; i < 50 && serveProcesses().length > 0; i++) await sleep(200);
    const afterKill = await run(cliInst, ['status']);
    const recovered = await run(cliInst, ['open', '--no-browser']);
    check('runtime.hard-kill-recovery', killed !== undefined && afterKill.json.state !== 'RUNNING' && recovered.json.ok === true && recovered.json.instanceId !== restart.json.instanceId && (await run(cliInst, ['status'])).json.state === 'RUNNING', `after kill ${afterKill.json.state}; ${recovered.json.outcome}`);
    const hostLog = readFileSync(path.join(ws, 'runtime', 'founder-host.log'), 'utf8');
    check('runtime.no-token-in-host-log', !hostLog.includes('/launch#') && !/sk-[A-Za-z0-9]{20,}/.test(hostLog));
    // The Start-menu Stop shortcut's own command line, launched the way Windows launches it (conhost --headless → the
    // private runtime → the release CLI); its effect is the proof (the Founder notice is left out: no pop-up here).
    const stopLnk = readShortcut(path.join(shell, 'Programs', 'QANDEEL COMPANY', 'QANDEEL COMPANY — Stop.lnk'));
    launchLikeWindows(stopLnk?.target ?? 'missing', String(stopLnk?.arguments ?? '').replace(/ --notify$/, ''), env, scratch);
    const viaShortcut = await run(cliInst, ['status']);
    check('runtime.shortcut-command-headless', viaShortcut.json.state === 'STOPPED' && serveProcesses().length === 0, `${viaShortcut.json.state}`);
    check('runtime.open-after-shortcut-stop', (await run(cliInst, ['open', '--no-browser'])).json.ok === true);
    check('runtime.company-unchanged', (await companyFingerprint(ws)) === fp0);

    // update A → B (side by side)
    const relB = await variantRelease(A.releaseRoot, path.join(scratch, 'releases-B'), 'b', (d) => writeFileSync(path.join(d, 'node_modules', '@qandeel-company', 'domain', 'dist', 'src', 'desktop-proof-b.json'), '{"build":"B"}\n'));
    const B = await composeBundle({ out: path.join(scratch, 'build-B'), pins, nodeExe, nodeLicense, desktopVersion: '1.0.1', releaseRoot: relB });
    const instB = layDown(B);
    const nodeABefore = sha256File(instA.node);
    const up = await install(instB);
    const upSteps = stepsOf(up.json);
    const cliB = path.join(pinOf()?.root ?? '', 'node_modules', '@qandeel-company', 'command-center', 'dist', 'src', 'cli.js');
    check('update.a-to-b', up.code === 0 && up.json.outcome === 'INSTALLED' && up.json.previousReleaseId === A.manifest.release.releaseId && pinOf()?.releaseId === B.manifest.release.releaseId && pinOf()?.previous?.releaseId === A.manifest.release.releaseId && upSteps['ACTIVATE.BACKUP'] === 'VERIFIED' && upSteps['ACTIVATE.HEALTH'] === 'READY', `${up.json.outcome} ${(up.json.steps ?? []).map((s) => `${s.step}=${s.result}`).join(' ')}`);
    check('update.side-by-side', instA.dir !== instB.dir && existsSync(instA.node) && sha256File(instA.node) === nodeABefore && desktop.verifyDesktopBundle(instA.dir).ok);
    const scB = readShortcut(lnk('QANDEEL COMPANY'));
    check('update.shortcuts-and-runtime-on-b', lower(scB?.arguments).startsWith(lower(`--headless "${instB.node}" "${cliB}"`)) && lower(serveProcesses()[0]?.exe) === lower(instB.node));
    check('update.company-unchanged', (await companyFingerprint(ws)) === fp0);
    check('update.apps-entry-on-b', appsEntry()?.DisplayVersion === '1.0.1' && signedWindowsOnly(appsEntry()) && lower(uninstallScript(appsEntry())).includes(lower(`'${instB.node}'`)));

    // failed update C → rollback to B
    const relC = await variantRelease(relB, path.join(scratch, 'releases-C'), 'c', (d) => appendFileSync(path.join(d, 'node_modules', '@qandeel-company', 'command-center', 'dist', 'src', 'cli.js'), '\nif (process.argv.includes("serve")) process.exit(9);\n'));
    const C = await composeBundle({ out: path.join(scratch, 'build-C'), pins, nodeExe, nodeLicense, desktopVersion: '1.0.2', releaseRoot: relC });
    const instC = layDown(C);
    const scBefore = JSON.stringify(readShortcut(lnk('QANDEEL COMPANY')));
    const recordFile = path.join(companyData, 'launcher', 'desktop-product.json');
    const recordBefore = readFileSync(recordFile);
    const failed = await install(instC);
    const fSteps = stepsOf(failed.json);
    check('update.failed-c-rolled-back', failed.code === 1 && failed.json.outcome === 'UPDATE_ROLLED_BACK' && fSteps['ACTIVATE.ROLLBACK_PIN'] === 'PREVIOUS' && fSteps['ACTIVATE.ROLLBACK_START'] === 'RUNNING', `${failed.json.outcome} ${(failed.json.steps ?? []).map((s) => `${s.step}=${s.result}`).join(' ')}`);
    const afterFail = await run({ node: instB.node, cli: cliB }, ['status']);
    check('update.failed-c-previous-pin-and-host', pinOf()?.releaseId === B.manifest.release.releaseId && afterFail.json.state === 'RUNNING' && afterFail.json.admitted === 'ADMITTED');
    check('update.failed-c-no-half-update', JSON.stringify(readShortcut(lnk('QANDEEL COMPANY'))) === scBefore && readFileSync(recordFile).equals(recordBefore) && desktop.verifyDesktopBundle(instB.dir).ok);
    check('update.failed-c-company-unchanged', (await companyFingerprint(ws)) === fp0);
    check('update.failed-c-apps-entry-kept', appsEntry()?.DisplayVersion === '1.0.1' && fSteps.APPS_ENTRY === 'KEPT', `${appsEntry()?.DisplayVersion} ${fSteps.APPS_ENTRY}`);

    // repair (the same bundle B installed again): missing application file and shortcut restored
    const uiFile = runtime.verifyReleaseTree(path.join(instB.dir, 'release')).manifest.files.find((f) => f.path.includes('command-center-ui/'))?.path;
    rmSync(path.join(instB.dir, 'app', 'qandeel-company.ico'));
    if (uiFile) rmSync(path.join(instB.dir, 'release', ...uiFile.split('/')));
    rmSync(lnk('QANDEEL COMPANY'));
    check('repair.damage-detected', !desktop.verifyDesktopBundle(instB.dir).ok);
    const repaired = await install(instB);
    const rSteps = stepsOf(repaired.json);
    check('repair.files-restored', repaired.json.outcome === 'INSTALLED' && rSteps.COPY === 'RESTORED' && rSteps['COPY.STOP'] === 'STOPPED' && desktop.verifyDesktopBundle(instB.dir).ok && listTree(path.join(programRoot, 'versions')).every((f) => !f.startsWith('.')), `${repaired.json.outcome} COPY=${rSteps.COPY} STOP=${rSteps['COPY.STOP']}`);
    check('repair.shortcut-restored', lower(readShortcut(lnk('QANDEEL COMPANY'))?.arguments).startsWith(lower(`--headless "${instB.node}"`)));
    check('repair.same-release-previous-kept', pinOf()?.releaseId === B.manifest.release.releaseId && pinOf()?.previous?.releaseId === A.manifest.release.releaseId);
    check('repair.company-unchanged', (await companyFingerprint(ws)) === fp0 && (await run({ node: instB.node, cli: cliB }, ['status'])).json.state === 'RUNNING');

    // uninstall: the application only
    const releasesBefore = listTree(path.join(companyData, 'releases')).length;
    const backupsBefore = listTree(path.join(ws, 'backups')).length;
    const pinBefore = readFileSync(runtime.releasePinPath(ws));
    // Windows "Apps" → Uninstall: exactly the registered command (conhost --headless → the installed node.exe).
    const command = splitCommandLine(appsEntry()?.UninstallString);
    const uninstallRun = launchLikeWindows(command.target, command.rest, env, scratch);
    for (let i = 0; i < 120 && (existsSync(programRoot) || appsEntry() !== null); i++) await sleep(500);
    const removed = { code: uninstallRun.launched && !existsSync(programRoot) ? 0 : 1, json: { outcome: uninstallRun.launched && !existsSync(programRoot) ? 'UNINSTALLED' : 'NOT_REMOVED', steps: [] } };
    check('uninstall.host-stopped', removed.code === 0 && removed.json.outcome === 'UNINSTALLED' && serveProcesses().length === 0, `${removed.json.outcome} ${(removed.json.steps ?? []).map((s) => `${s.step}=${s.result}`).join(' ')}`);
    check('uninstall.application-and-shortcuts-gone', !existsSync(programRoot) && appsEntry() === null && !existsSync(lnk('QANDEEL COMPANY')) && !existsSync(path.join(shell, 'Programs', 'QANDEEL COMPANY')) && !existsSync(recordFile));
    check('uninstall.company-data-preserved', (await companyFingerprint(ws)) === fp0 && readFileSync(runtime.releasePinPath(ws)).equals(pinBefore) && listTree(path.join(companyData, 'releases')).length === releasesBefore && listTree(path.join(ws, 'backups')).length === backupsBefore && backupsBefore > 0);
    check('uninstall.vault-and-config-preserved', readFileSync(vaultBlob).equals(vaultBytes) && readFileSync(configFile).equals(configBytes));

    // reinstall → the same Company
    const instB2 = layDown(B);
    const again = await install(instB2);
    check('reinstall.same-company', again.code === 0 && again.json.outcome === 'INSTALLED' && pinOf()?.releaseId === B.manifest.release.releaseId && pinOf()?.previous?.releaseId === A.manifest.release.releaseId && (await companyFingerprint(ws)) === fp0 && existsSync(lnk('QANDEEL COMPANY')), `${again.json.outcome}`);

    // detached: the installed product without the development checkout's code or modules
    const leaks = [...scanForLeaks(LAD), ...listTree(shell).filter((f) => f.endsWith('.lnk')).flatMap((f) => (lower(readShortcut(path.join(shell, ...f.split('/')))?.arguments).includes(lower(ROOT)) ? [`${f} references the checkout`] : []))];
    check('detached.no-installed-reference-to-checkout-or-secret', leaks.length === 0, leaks.slice(0, 5).join('; '));
    const moved = [];
    try {
      for (const d of ['node_modules', 'packages']) {
        renameSync(path.join(ROOT, d), path.join(ROOT, d + OFF));
        moved.push(d);
      }
      const cli2 = { node: instB2.node, cli: cliB };
      const s1 = await run(cli2, ['stop']);
      const o1 = await run(cli2, ['open', '--no-browser']);
      const st = await run(cli2, ['status']);
      check('detached.runs-without-checkout-code-and-modules', s1.json.ok === true && o1.json.ok === true && st.json.state === 'RUNNING' && st.json.admitted === 'ADMITTED' && lower(serveProcesses()[0]?.exe) === lower(instB2.node), `stop ${s1.json.outcome}, open ${o1.json.outcome}, ${st.json.state}`);
    } finally {
      for (const d of moved) renameSync(path.join(ROOT, d + OFF), path.join(ROOT, d));
    }
  } finally {
    // Disposable host: stop it whatever happened.
    for (const p of serveProcesses()) {
      try {
        process.kill(p.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    // The scratch "Apps" key (never the real Uninstall entry).
    powershellJson(`Remove-Item -LiteralPath '${appsKey}' -Recurse -Force -ErrorAction SilentlyContinue; $p = 'HKCU:\\Software\\QANDEEL_COMPANY_DESKTOP_PROOF'; if ((Test-Path $p) -and -not (Get-ChildItem $p)) { Remove-Item -LiteralPath $p -Force }; 'null'`);
  }
}

const failed = failures();
process.stdout.write(`\nDesktop proof: ${failed === 0 ? 'PASS' : `FAIL (${failed})`}\n`);
if (!values.keep) {
  await sleep(500);
  rmSync(scratch, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
