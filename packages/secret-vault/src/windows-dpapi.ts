/**
 * The Windows user-scoped vault (D-L1-02): each secret is protected with built-in Windows DPAPI in the
 * CurrentUser scope (`System.Security.Cryptography.ProtectedData`) and stored, protected, under the Founder
 * user's local application data — outside every Company workspace, backup and Git checkout. Only the same
 * Windows user account on the same machine can unprotect it (plus the fixed application entropy below, which
 * separates the vault's blobs from other DPAPI users; it is domain separation, not a secret).
 *
 * This module is the ONE reviewed process path in the repository (verifier `l1-vault-protected`, ESLint): it
 * starts the signed Windows PowerShell host by its absolute System32 path, with a fixed argument list, no shell,
 * and passes every secret through the child's standard input — never as a command-line argument, never in a
 * file, never in a log. Smart App Control stays on: PowerShell is a signed Windows component.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { VaultError, assertSecretValue, vaultName, type SecretVault } from './vault.js';

export const VAULT_FORMAT = 'QANDEEL_COMPANY_VAULT_DPAPI_V1';
/** Application entropy: domain separation of this vault's blobs (public, fixed, not a secret). */
const APPLICATION_ENTROPY = 'QANDEEL_COMPANY/secret-vault/v1';
const SCOPE = 'CurrentUser';
const FILE_SUFFIX = '.dpapi.json';
const MAX_BLOB_BYTES = 64 * 1024;

export interface WindowsUserVaultOptions {
  /** Where protected blobs live (default: %LOCALAPPDATA%\QANDEEL_COMPANY\vault). Never inside a workspace. */
  readonly directory?: string;
  /** Bounded time for one DPAPI operation through the PowerShell host. */
  readonly timeoutMs?: number;
}

/** The Founder user's local application data vault directory. */
export function defaultVaultDirectory(): string {
  const base = process.env.LOCALAPPDATA;
  if (!base) throw new VaultError('VAULT_UNAVAILABLE', 'LOCALAPPDATA is not set; the Windows user vault needs the user profile');
  return path.join(base, 'QANDEEL_COMPANY', 'vault');
}

/** The signed Windows PowerShell 5.1 host, by absolute path under the system root (never resolved through PATH). */
function powershellPath(): string {
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** One DPAPI operation: base64 in on stdin, base64 out on stdout; nothing else crosses the process boundary. */
function dpapiScript(operation: 'Protect' | 'Unprotect'): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Security',
    '$in = [Console]::In.ReadToEnd().Trim()',
    '$bytes = [Convert]::FromBase64String($in)',
    `$entropy = [Text.Encoding]::UTF8.GetBytes('${APPLICATION_ENTROPY}')`,
    `$out = [Security.Cryptography.ProtectedData]::${operation}($bytes, $entropy, [Security.Cryptography.DataProtectionScope]::${SCOPE})`,
    '[Console]::Out.Write([Convert]::ToBase64String($out))',
  ].join('; ');
}

interface StoredBlob {
  readonly format: string;
  readonly scope: string;
  readonly protected: string;
  readonly createdAt: string;
}

export class WindowsUserVault implements SecretVault {
  readonly kind = 'WINDOWS_DPAPI_CURRENT_USER';
  readonly #directory: string;
  readonly #timeoutMs: number;

  constructor(options: WindowsUserVaultOptions = {}) {
    this.#directory = options.directory ?? (process.platform === 'win32' ? defaultVaultDirectory() : path.join(process.cwd(), 'unavailable-vault'));
    this.#timeoutMs = options.timeoutMs ?? 20_000;
  }

  /** True on Windows (DPAPI and the PowerShell host exist); the vault fails closed elsewhere. */
  static available(): boolean {
    return process.platform === 'win32';
  }

  get directory(): string {
    return this.#directory;
  }

  /** The protected blob's path for a name (never the value). */
  fileFor(name: string): string {
    return path.join(this.#directory, `${vaultName(`vault:${name}`)}${FILE_SUFFIX}`);
  }

  async has(ref: string): Promise<boolean> {
    try {
      return readBlob(this.fileFor(vaultName(ref))) !== null;
    } catch {
      return false;
    }
  }

  list(): string[] {
    try {
      return readdirSync(this.#directory)
        .filter((f) => f.endsWith(FILE_SUFFIX))
        .map((f) => f.slice(0, -FILE_SUFFIX.length))
        .sort();
    } catch {
      return [];
    }
  }

  /** Protects and stores a secret for the current Windows user. Overwriting an existing secret needs `replace`. */
  async set(name: string, secret: string, options: { readonly replace?: boolean } = {}): Promise<{ ref: string; file: string }> {
    assertAvailable();
    const clean = vaultName(`vault:${name}`);
    const value = assertSecretValue(secret);
    const file = this.fileFor(clean);
    if (!options.replace && readBlob(file) !== null) throw new VaultError('ALREADY_EXISTS', `vault:${clean} already holds a secret; replacing it is an explicit operator action (--replace)`);
    const protectedBase64 = await this.#dpapi('Protect', Buffer.from(value, 'utf8').toString('base64'));
    const blob: StoredBlob = { format: VAULT_FORMAT, scope: SCOPE, protected: protectedBase64, createdAt: new Date().toISOString() };
    mkdirSync(this.#directory, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(blob)}\n`, { encoding: 'utf8', flag: 'w' });
    renameSync(tmp, file);
    return { ref: `vault:${clean}`, file };
  }

  /** Removes a stored blob (an explicit operator action); a tampered file is removed too, never read. */
  remove(name: string): boolean {
    const file = this.fileFor(vaultName(`vault:${name}`));
    if (!existsSync(file)) return false;
    rmSync(file, { force: true });
    return true;
  }

  async use<T>(ref: string, fn: (secret: string) => Promise<T> | T): Promise<T> {
    assertAvailable();
    const file = this.fileFor(vaultName(ref));
    const blob = readBlob(file);
    if (blob === null) throw new VaultError('SECRET_NOT_FOUND', `no secret is stored for ${ref}`);
    const plain = await this.#dpapi('Unprotect', blob.protected);
    const value = Buffer.from(plain, 'base64').toString('utf8');
    assertSecretValue(value);
    return fn(value);
  }

  /** Runs one DPAPI operation in the signed PowerShell host; the payload travels on stdin only. */
  #dpapi(operation: 'Protect' | 'Unprotect', base64Payload: string): Promise<string> {
    if (!/^[A-Za-z0-9+/=]*$/.test(base64Payload) || base64Payload.length > MAX_BLOB_BYTES * 2) throw new VaultError(operation === 'Protect' ? 'SECRET_INVALID' : 'VAULT_TAMPERED', 'the vault payload is not base64');
    const encoded = Buffer.from(dpapiScript(operation), 'utf16le').toString('base64');
    return new Promise<string>((resolve, reject) => {
      const child = execFile(
        powershellPath(),
        ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encoded],
        { windowsHide: true, timeout: this.#timeoutMs, maxBuffer: MAX_BLOB_BYTES * 4, encoding: 'utf8', shell: false },
        (error, stdout) => {
          if (error) {
            // The host's message never travels: a code names the family (missing host, timeout, DPAPI refusal).
            const code = (error as { code?: unknown }).code;
            if (code === 'ENOENT') return reject(new VaultError('VAULT_UNAVAILABLE', 'the Windows PowerShell host was not found'));
            return reject(new VaultError(operation === 'Protect' ? 'PROTECTION_FAILED' : 'VAULT_TAMPERED', operation === 'Protect' ? 'Windows could not protect the secret for the current user' : 'Windows refused to unprotect this blob for the current user (another user, another machine, or a tampered file)'));
          }
          const out = String(stdout ?? '').trim();
          if (!/^[A-Za-z0-9+/=]+$/.test(out)) return reject(new VaultError(operation === 'Protect' ? 'PROTECTION_FAILED' : 'VAULT_TAMPERED', 'the protection host returned no usable blob'));
          resolve(out);
        },
      );
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(base64Payload);
    });
  }
}

function assertAvailable(): void {
  if (!WindowsUserVault.available()) throw new VaultError('VAULT_UNAVAILABLE', 'the Windows user vault exists only on Windows (DPAPI, CurrentUser scope)');
}

/** A stored blob, or null when there is none; a malformed file is VAULT_TAMPERED (never read as a value). */
function readBlob(file: string): StoredBlob | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return null;
    throw new VaultError('VAULT_UNAVAILABLE', 'the vault file could not be read');
  }
  if (text.length > MAX_BLOB_BYTES * 2) throw new VaultError('VAULT_TAMPERED', 'the vault file is oversized');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new VaultError('VAULT_TAMPERED', 'the vault file is not a protected blob');
  }
  const b = parsed as Partial<StoredBlob> | null;
  if (typeof b !== 'object' || b === null || b.format !== VAULT_FORMAT || b.scope !== SCOPE || typeof b.protected !== 'string' || b.protected.length === 0) {
    throw new VaultError('VAULT_TAMPERED', 'the vault file is not a protected blob of this vault');
  }
  return { format: b.format, scope: b.scope, protected: b.protected, createdAt: typeof b.createdAt === 'string' ? b.createdAt : '' };
}
