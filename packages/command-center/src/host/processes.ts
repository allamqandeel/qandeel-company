/**
 * Every process the Founder host lifecycle starts (OPS, D-OPS-04; verifier rule `founder-host-confined`). Nothing else in
 * the surface package spawns a process, and this module starts exactly four kinds, never through a shell:
 *
 *   1. the Company host itself: the signed Node runtime (`process.execPath`) running this package's own CLI, detached,
 *      windowless, with its content-free log as stdout/stderr and an IPC channel used once for readiness;
 *   2. the Founder's browser (Edge, else Chrome) from its absolute install path, in app-window mode, on the canonical
 *      launch URL;
 *   3. the signed Windows PowerShell host, by its absolute System32 path, with a fixed encoded command, to show a
 *      fixed Founder notice (WScript.Shell Popup) — the message comes from a fixed table, never from Company content;
 *   4. the same PowerShell host to write the QANDEEL COMPANY shortcuts (WScript.Shell CreateShortcut).
 *
 * No argument ever carries a secret: the host takes a workspace path and provider codes (the provider key stays in the
 * DPAPI vault); the browser takes the canonical single-use, 90-second launch token, redeemed on arrival.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function spawnHost(cliPath: string, args: readonly string[], logFd: number): ChildProcess {
  return spawn(process.execPath, [cliPath, ...args], { detached: true, windowsHide: true, shell: false, stdio: ['ignore', logFd, logFd, 'ipc'] });
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
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** A PowerShell single-quoted literal (the only escape inside '…' is a doubled quote). */
export const psLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

function runPowerShell(script: string, timeoutMs: number): Promise<{ ok: boolean; stdout: string }> {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, stdout: '' });
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile(powershellExe(), ['-NoProfile', '-NonInteractive', '-NoLogo', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 }, (error, stdout) => {
      resolve({ ok: error === null, stdout: String(stdout) });
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
}

/** Writes per-user .lnk shortcuts (no elevation). Resolves the written paths, or null when Windows refused. */
export async function writeShortcuts(specs: readonly ShortcutSpec[]): Promise<string[] | null> {
  const lines = ["$ErrorActionPreference='Stop'", '$sh = New-Object -ComObject WScript.Shell', '$out = @()'];
  for (const s of specs) {
    lines.push(`$dir = [Environment]::GetFolderPath(${psLiteral(s.folder)})`);
    if (s.subfolder) lines.push(`$dir = Join-Path $dir ${psLiteral(s.subfolder)}; [void](New-Item -ItemType Directory -Force -Path $dir)`);
    lines.push(`$p = Join-Path $dir ${psLiteral(`${s.name}.lnk`)}`);
    lines.push('$l = $sh.CreateShortcut($p)');
    lines.push(`$l.TargetPath = ${psLiteral(s.target)}`);
    lines.push(`$l.Arguments = ${psLiteral(s.arguments)}`);
    lines.push(`$l.WorkingDirectory = ${psLiteral(s.workingDirectory)}`);
    lines.push(`$l.Description = ${psLiteral(s.description)}`);
    lines.push('$l.WindowStyle = 7'); // minimized: the launcher's console never takes the screen
    lines.push('$l.Save()');
    lines.push('$out += $p');
  }
  lines.push('[Console]::OutputEncoding = [Text.Encoding]::UTF8; ConvertTo-Json -Compress @($out)');
  const r = await runPowerShell(lines.join('\n'), 30_000);
  if (!r.ok) return null;
  try {
    const parsed = JSON.parse(r.stdout.trim()) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    return null;
  }
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
