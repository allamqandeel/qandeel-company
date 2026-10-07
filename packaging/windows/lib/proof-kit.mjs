/**
 * Shared helpers of the Desktop proofs (D1): disposable environments, the product's own CLI on its private runtime,
 * shortcut / process inspection, and a content-free Company state fingerprint. Nothing here touches a real profile:
 * every child process gets an isolated LOCALAPPDATA and a PATH without Node, npm or Git.
 */
import { execFile, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT } from './desktop-build.mjs';

const dist = (pkg, file = 'index.js') => pathToFileURL(path.join(ROOT, 'packages', pkg, 'dist', 'src', file)).href;

export async function devModules() {
  const runtime = await import(dist('runtime'));
  const storage = await import(dist('storage'));
  return { runtime, storage };
}

/** One recorded proof line: `PROOF <id> PASS|FAIL <detail>`. `failures()` counts the FAILs. */
export function recorder() {
  const lines = [];
  const check = (id, ok, detail = '') => {
    lines.push({ id, ok: Boolean(ok), detail });
    process.stdout.write(`PROOF ${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` — ${detail}` : ''}\n`);
    return Boolean(ok);
  };
  return { check, lines, failures: () => lines.filter((l) => !l.ok).length };
}

const TOOL_NAMES = ['node.exe', 'npm.cmd', 'npm', 'npx.cmd', 'git.exe', 'git.cmd', 'node'];

/** PATH entries that hold no Node, npm or Git (the product must work without any of them). */
export function pathWithoutDevTools(pathValue = process.env.PATH ?? process.env.Path ?? '') {
  return pathValue
    .split(path.delimiter)
    .filter((d) => d && !TOOL_NAMES.some((t) => existsSync(path.join(d, t))))
    .join(path.delimiter);
}

/** An isolated environment: its own LOCALAPPDATA, no development tools on PATH, nothing inherited that names the checkout. */
export function isolatedEnv(localAppData, extra = {}) {
  const keep = ['SystemRoot', 'windir', 'SystemDrive', 'TEMP', 'TMP', 'USERPROFILE', 'USERNAME', 'COMPUTERNAME', 'PATHEXT', 'ComSpec', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS'];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  env.PATH = pathWithoutDevTools();
  env.LOCALAPPDATA = localAppData;
  return { ...env, ...extra };
}

/** Runs the installed CLI on the installed private runtime. Resolves { code, json } (the last JSON line). */
export function runInstalled({ node, cli, args, env, cwd, timeoutMs = 300_000 }) {
  return new Promise((resolve) => {
    execFile(node, [cli, ...args], { cwd, env, shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const line = `${String(stdout)}\n${String(stderr)}`.trim().split('\n').filter((l) => l.startsWith('{')).at(-1) ?? '{}';
      let json;
      try {
        json = JSON.parse(line);
      } catch {
        json = { unparsable: true };
      }
      resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, json });
    });
  });
}

const PS = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function powershellJson(script, timeoutMs = 60_000) {
  const r = spawnSync(PS(), ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`], { encoding: 'utf8', windowsHide: true, timeout: timeoutMs });
  const text = (r.stdout ?? '').trim();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** A .lnk file's target, arguments, icon and working directory (WScript.Shell; read-only). */
export function readShortcut(file) {
  if (!existsSync(file)) return null;
  return powershellJson(`$l = (New-Object -ComObject WScript.Shell).CreateShortcut(${lit(file)}); [pscustomobject]@{ target = $l.TargetPath; arguments = $l.Arguments; icon = $l.IconLocation; workingDirectory = $l.WorkingDirectory; windowStyle = $l.WindowStyle } | ConvertTo-Json -Compress`);
}

/** Every live process whose command line names the text: { pid, exe, commandLine } (Win32_Process; read-only). */
export function processesNaming(text) {
  const r = powershellJson(`@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains(${lit(text)}) } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; exe = $_.ExecutablePath; commandLine = $_.CommandLine } }) | ConvertTo-Json -Compress -Depth 3`);
  return r === null ? [] : Array.isArray(r) ? r : [r];
}

/** The HKCU uninstall entry of an Inno Setup AppId (`{GUID}_is1`), or null. */
export function uninstallEntry(appId) {
  return powershellJson(`$k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appId}_is1'; if (Test-Path $k) { Get-ItemProperty $k | Select-Object DisplayName, DisplayVersion, InstallLocation, UninstallString, DisplayIcon, Publisher | ConvertTo-Json -Compress } else { 'null' }`);
}

export function machineUninstallEntryExists(appId) {
  return powershellJson(`[bool](Test-Path 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appId}_is1') -or [bool](Test-Path 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${appId}_is1') | ConvertTo-Json`) === true;
}

/** Seeds durable sentinel records in a disposable Company (what "the same Company" is checked against). */
export async function seedSentinel(workspace) {
  const { storage } = await devModules();
  const store = storage.CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
  try {
    for (const i of [1, 2, 3]) store.recordAudit('desktop.proof_sentinel', 'desktop_proof', 'desktop-proof-sentinel', 'OK', null, { n: i });
  } finally {
    store.close();
  }
}

/** A content-free fingerprint of durable Company state: the sentinel records, every work item, integrity. */
export async function companyFingerprint(workspace) {
  const { storage } = await devModules();
  const store = storage.CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
  try {
    const sentinel = store.audit('desktop-proof-sentinel').map((a) => ({ id: a.id, action: a.action, outcome: a.outcome }));
    const work = store.listWorkItems({ limit: 1000 }).map((w) => ({ id: w.id, state: w.state }));
    return JSON.stringify({ sentinel, work, integrity: store.quickCheck() });
  } finally {
    store.close();
  }
}

/** A different build of a release (one added file), re-manifested exactly as staging would produce it. */
export async function variantRelease(fromRoot, parentDir, name, change) {
  const { runtime } = await devModules();
  const dir = path.join(parentDir, `.variant-${name}`);
  rmSync(dir, { recursive: true, force: true });
  cpSync(fromRoot, dir, { recursive: true });
  const manifestFile = path.join(dir, runtime.RELEASE_MANIFEST_FILE);
  const before = JSON.parse(readFileSync(manifestFile, 'utf8'));
  rmSync(manifestFile);
  change(dir);
  const files = runtime.hashReleaseTree(dir) ?? [];
  const releaseId = runtime.releaseIdOf(runtime.RUNTIME_VERSION, files);
  writeFileSync(manifestFile, `${JSON.stringify({ version: 1, releaseId, runtimeVersion: runtime.RUNTIME_VERSION, sourceCommit: before.sourceCommit, stagedAt: new Date().toISOString(), files }, null, 2)}\n`);
  const final = path.join(parentDir, releaseId.slice(0, 16));
  rmSync(final, { recursive: true, force: true });
  renameSync(dir, final);
  return final;
}

/** Every file below a directory (POSIX relative) — for "nothing was created" checks. */
export function listTree(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out.push(r);
    }
  };
  walk('');
  return out.sort();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
