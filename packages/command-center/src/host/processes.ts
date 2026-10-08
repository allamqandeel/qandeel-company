/**
 * Every process the Founder host lifecycle starts (OPS, D-OPS-04; verifier rule `founder-host-confined`). Nothing else in
 * the surface package spawns a process, and this module starts exactly four kinds, never through a shell:
 *
 *   1. the Company host itself (and, once per activation, a staged release's own CLI for its dry run, D-OPS-08): the signed Node runtime (`process.execPath`) running this package's own CLI, detached,
 *      windowless, with its content-free log as stdout/stderr and an IPC channel used once for readiness;
 *   2. the Founder's browser (Edge, else Chrome) from its absolute install path, in app-window mode, on the one-shot
 *      loopback handoff address (`host/handoff.ts`, D-OPS-07) — never on the launch URL itself;
 *   3. the signed Windows PowerShell host, by its absolute System32 path, with a fixed encoded command, to show a
 *      fixed Founder notice (WScript.Shell Popup) — the message comes from a fixed table, never from Company content;
 *   4. the same PowerShell host to write (WScript.Shell CreateShortcut) or remove the QANDEEL COMPANY shortcuts, to
 *      register the per-user Windows "Apps" uninstall entry, whose command (run by Windows, not by this module) is the
 *      console host running the same PowerShell host with a fixed encoded uninstall script (D1, D-D1-08);
 *   5. D1 Founder-local install (D-D1-08): the INSTALLED private Node runtime (`installedRuntime`, the pinned official
 *      node.exe of a verified Desktop bundle) running that bundle's own CLI, so the installed product takes over from
 *      the copy it was installed from.
 *
 * No argument ever carries a secret: the host takes a workspace path and provider codes (the provider key stays in the
 * DPAPI vault); the browser takes only `http://127.0.0.1:<port>/`, and receives the launch token over that loopback
 * connection, never in its command line.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function spawnHost(cliPath: string, args: readonly string[], logFd: number): ChildProcess {
  return spawn(process.execPath, [cliPath, ...args], { detached: true, windowsHide: true, shell: false, stdio: ['ignore', logFd, logFd, 'ipc'] });
}

/** Runs a staged release's own CLI once (the activation dry run, D-OPS-08): the signed Node runtime, bounded, no shell. */
export function runReleaseCli(cliPath: string, args: readonly string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cliPath, ...args], { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 }, (error, stdout) => {
      resolve({ ok: error === null, stdout: String(stdout) });
    });
  });
}

/**
 * D1 Founder-local install (D-D1-08): runs a verified, installed Desktop bundle's own CLI on that bundle's own pinned
 * private runtime (the caller has verified the bundle byte for byte, its runtime included). Bounded, no shell.
 */
export function runInstalledRuntime(installedRuntime: string, cliPath: string, args: readonly string[], timeoutMs: number): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(installedRuntime, [cliPath, ...args], { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, stdout: String(stdout) });
    });
  });
}

export type BrowserKind = 'edge' | 'chrome';

/** The installed Founder browsers, by absolute path only (no PATH lookup, no registry, no shell association). */
export function browserCandidates(env: NodeJS.ProcessEnv = process.env): readonly { kind: BrowserKind; exe: string }[] {
  if (process.platform !== 'win32') return [];
  const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter((r): r is string => typeof r === 'string' && path.win32.isAbsolute(r));
  return [
    ...roots.map((r) => ({ kind: 'edge' as const, exe: path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe') })),
    ...roots.map((r) => ({ kind: 'chrome' as const, exe: path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe') })),
  ];
}

export function findBrowser(): { kind: BrowserKind; exe: string } | null {
  return browserCandidates().find((c) => existsSync(c.exe)) ?? null;
}

/** Opens the Founder Command Center in an app window. Resolves false when no browser could be started. */
export function openBrowser(url: string): Promise<{ ok: boolean; browser: BrowserKind | null }> {
  const browser = findBrowser();
  if (browser === null) return Promise.resolve({ ok: false, browser: null });
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(browser.exe, [`--app=${url}`], { detached: true, shell: false, stdio: 'ignore', windowsHide: false });
    } catch {
      resolve({ ok: false, browser: browser.kind });
      return;
    }
    child.once('error', () => resolve({ ok: false, browser: browser.kind }));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true, browser: browser.kind });
    });
  });
}

function powershellExe(): string {
  return path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** A PowerShell single-quoted literal (the only escape inside '…' is a doubled quote). */
export const psLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

function runPowerShell(script: string, timeoutMs: number): Promise<{ ok: boolean; stdout: string; failure: string | null }> {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, stdout: '', failure: 'NOT_WINDOWS' });
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile(powershellExe(), ['-NoProfile', '-NonInteractive', '-NoLogo', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 }, (error, stdout) => {
      // A content-free failure reason only (never the script or its output).
      resolve({ ok: error === null, stdout: String(stdout), failure: error === null ? null : error.killed ? 'TIMEOUT' : `EXIT_${String(error.code ?? 'UNKNOWN')}` });
    });
  });
}

/** A Founder notice (Windows): a fixed title and message, auto-dismissed after `seconds`. */
export async function showNotice(title: string, message: string, kind: 'info' | 'warning' | 'error', seconds = 120): Promise<boolean> {
  const icon = kind === 'error' ? 16 : kind === 'warning' ? 48 : 64;
  const script = `$ErrorActionPreference='Stop'; [void](New-Object -ComObject WScript.Shell).Popup(${psLiteral(message)}, ${Math.max(1, Math.floor(seconds))}, ${psLiteral(title)}, ${icon})`;
  return (await runPowerShell(script, (seconds + 15) * 1000)).ok;
}

export interface ShortcutSpec {
  /** `Desktop` or the Start-menu `Programs` folder of the current user (resolved by Windows, OneDrive-aware). */
  readonly folder: 'Desktop' | 'Programs';
  readonly subfolder?: string;
  readonly name: string;
  readonly target: string;
  readonly arguments: string;
  readonly workingDirectory: string;
  readonly description: string;
  /** The installed product's icon (D1, Desktop v1); absent for a development launcher (the runtime's own icon). */
  readonly icon?: string;
}

/**
 * Where the shortcuts go. Windows resolves the per-user Desktop / Start-menu `Programs` folder (OneDrive-aware); a
 * disposable proof passes `root` so nothing ever lands in the real user profile (`<root>\Desktop`, `<root>\Programs`).
 */
export interface ShortcutRoots {
  readonly root?: string;
}

const shortcutDir = (s: ShortcutSpec, roots: ShortcutRoots): string[] => [
  roots.root === undefined ? `$dir = [Environment]::GetFolderPath(${psLiteral(s.folder)})` : `$dir = Join-Path ${psLiteral(roots.root)} ${psLiteral(s.folder)}`,
  ...(s.subfolder ? [`$dir = Join-Path $dir ${psLiteral(s.subfolder)}`] : []),
];

let shortcutFailure: string | null = null;
/** Why the last shortcut write / removal failed (content-free: TIMEOUT, EXIT_<code>, OUTPUT), or null. */
export const lastShortcutFailure = (): string | null => shortcutFailure;

/**
 * Runs one idempotent shortcut script, bounded. A cold Windows PowerShell / COM start on a fresh machine can be slow,
 * so a failed attempt is retried once (D-D1-01); the scripts overwrite / remove exactly the named .lnk files.
 */
async function shortcutScript(lines: string[]): Promise<string[] | null> {
  lines.push('[Console]::OutputEncoding = [Text.Encoding]::UTF8; ConvertTo-Json -Compress @($out)');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await runPowerShell(lines.join('\n'), 60_000);
    if (!r.ok) {
      shortcutFailure = r.failure;
      continue;
    }
    try {
      const parsed = JSON.parse(r.stdout.trim() || '[]') as unknown;
      shortcutFailure = null;
      return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
    } catch {
      shortcutFailure = 'OUTPUT';
    }
  }
  return null;
}

/** Writes per-user .lnk shortcuts (no elevation). Resolves the written paths, or null when Windows refused. */
export async function writeShortcuts(specs: readonly ShortcutSpec[], roots: ShortcutRoots = {}): Promise<string[] | null> {
  const lines = ["$ErrorActionPreference='Stop'", '$sh = New-Object -ComObject WScript.Shell', '$out = @()'];
  for (const s of specs) {
    lines.push(...shortcutDir(s, roots), '[void](New-Item -ItemType Directory -Force -Path $dir)');
    lines.push(`$p = Join-Path $dir ${psLiteral(`${s.name}.lnk`)}`);
    lines.push('$l = $sh.CreateShortcut($p)');
    lines.push(`$l.TargetPath = ${psLiteral(s.target)}`);
    lines.push(`$l.Arguments = ${psLiteral(s.arguments)}`);
    lines.push(`$l.WorkingDirectory = ${psLiteral(s.workingDirectory)}`);
    lines.push(`$l.Description = ${psLiteral(s.description)}`);
    if (s.icon) lines.push(`$l.IconLocation = ${psLiteral(`${s.icon},0`)}`);
    lines.push('$l.WindowStyle = 7'); // minimized: the launcher's console never takes the screen
    lines.push('$l.Save()');
    lines.push('$out += $p');
  }
  return shortcutScript(lines);
}

/** Removes exactly these shortcuts (and their Start-menu folder once it is empty). Resolves the removed paths. */
export async function removeShortcuts(specs: readonly ShortcutSpec[], roots: ShortcutRoots = {}): Promise<string[] | null> {
  const lines = ["$ErrorActionPreference='Stop'", '$out = @()'];
  for (const s of specs) {
    lines.push(...shortcutDir(s, roots));
    lines.push(`$p = Join-Path $dir ${psLiteral(`${s.name}.lnk`)}`);
    lines.push('if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force; $out += $p }');
    if (s.subfolder) lines.push('if ((Test-Path -LiteralPath $dir) -and -not (Get-ChildItem -LiteralPath $dir -Force)) { Remove-Item -LiteralPath $dir -Force }');
  }
  return shortcutScript(lines);
}

// --- D1 Founder-local install: the per-user "Apps" entry and the program directory (D-D1-08) ---------------------------

/** Only a per-user key: never HKLM, never outside HKCU\Software. */
const userKey = (key: string): boolean => /^HKCU:\\Software\\[^*?]+$/.test(key) && !key.includes('..');
/** Only the product's own program directory: `<…>\Programs\QANDEEL COMPANY`, absolute (never Company data). */
export const isProductProgramDir = (dir: string): boolean => path.win32.isAbsolute(dir) && path.win32.basename(dir) === 'QANDEEL COMPANY' && path.win32.basename(path.win32.dirname(dir)).toLowerCase() === 'programs';

export interface UninstallEntry {
  readonly displayName: string;
  readonly displayVersion: string;
  readonly publisher: string;
  readonly displayIcon: string;
  readonly installLocation: string;
  readonly uninstallString: string;
}

/** Registers (replaces) the per-user Windows "Apps" uninstall entry. No elevation; string values only plus two flags. */
export async function writeUninstallEntry(key: string, entry: UninstallEntry): Promise<boolean> {
  if (process.platform !== 'win32' || !userKey(key)) return false;
  const values: [string, string][] = [
    ['DisplayName', entry.displayName],
    ['DisplayVersion', entry.displayVersion],
    ['Publisher', entry.publisher],
    ['DisplayIcon', entry.displayIcon],
    ['InstallLocation', entry.installLocation],
    ['UninstallString', entry.uninstallString],
    ['QuietUninstallString', entry.uninstallString],
  ];
  const lines = ["$ErrorActionPreference='Stop'", `$k = ${psLiteral(key)}`, '[void](New-Item -Path $k -Force)'];
  for (const [name, value] of values) lines.push(`[void](New-ItemProperty -LiteralPath $k -Name ${psLiteral(name)} -Value ${psLiteral(value)} -PropertyType String -Force)`);
  for (const flag of ['NoModify', 'NoRepair']) lines.push(`[void](New-ItemProperty -LiteralPath $k -Name ${psLiteral(flag)} -Value 1 -PropertyType DWord -Force)`);
  lines.push("'true'");
  for (let attempt = 1; attempt <= 2; attempt++) if ((await runPowerShell(lines.join('\n'), 60_000)).ok) return true;
  return false;
}

/** Whether the per-user uninstall entry exists (read-only). */
export async function uninstallEntryExists(key: string): Promise<boolean> {
  if (process.platform !== 'win32' || !userKey(key)) return false;
  const r = await runPowerShell(`if (Test-Path -LiteralPath ${psLiteral(key)}) { 'true' } else { 'false' }`, 60_000);
  return r.ok && r.stdout.trim() === 'true';
}

/**
 * The Founder-local "Apps" uninstall command line (D-D1-08). Signed Windows binaries only: the console host in headless
 * mode runs the signed Windows PowerShell with a fixed encoded script that
 *   1. runs the INSTALLED runtime's application-only uninstall (controlled stop, shortcuts, product record), and
 *   2. only if that succeeded — and only after the runtime has exited, so nothing in the directory is in use — removes the
 *      product's program directory and then its uninstall entry.
 * Refuses anything but `<…>\Programs\QANDEEL COMPANY` and a per-user key; Company data is never there. (PowerShell
 * started without a console does not run its script, so no detached process is used.)
 */
export function uninstallCommandLine(installedRuntime: string, cliPath: string, args: readonly string[], programDir: string, key: string): string | null {
  if (!isProductProgramDir(programDir) || !userKey(key)) return null;
  const script = [
    `& ${psLiteral(installedRuntime)} ${psLiteral(cliPath)} 'desktop-local-uninstall' ${args.map(psLiteral).join(' ')} | Out-Null`,
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    `$dir = ${psLiteral(programDir)}`,
    'for ($i = 0; $i -lt 40 -and (Test-Path -LiteralPath $dir); $i++) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath $dir) { Start-Sleep -Milliseconds 500 } }',
    `if (Test-Path -LiteralPath $dir) { exit 3 }`,
    `Remove-Item -LiteralPath ${psLiteral(key)} -Recurse -Force -ErrorAction SilentlyContinue`,
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const conhost = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'conhost.exe');
  return `"${conhost}" --headless "${powershellExe()}" -NoProfile -NonInteractive -NoLogo -WindowStyle Hidden -EncodedCommand ${encoded}`;
}

/** Whether a PID names a live process (a hint only: a PID can be reused, so it never proves the host by itself). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The explicit, non-default `stop --force` path: terminates one verified host PID. Recovery handles the rest. */
export function terminateProcess(pid: number): boolean {
  try {
    process.kill(pid, 'SIGKILL'); // no handler runs: the hard-crash path the runtime already recovers from
    return true;
  } catch {
    return false;
  }
}
