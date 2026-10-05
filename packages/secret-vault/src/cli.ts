#!/usr/bin/env node
/**
 * qandeel-vault — the Founder's local secret-entry command (D-L1-02). Runs under the signed Node runtime.
 *
 *   set <name> [--replace] [--directory <dir>]   prompts for the secret WITHOUT echo on an interactive terminal,
 *                                                protects it at once for the current Windows user (DPAPI) and
 *                                                stores the protected blob; prints only the reference and file
 *   has <name>                                   whether a secret is stored (never its value)
 *   remove <name>                                removes a stored secret (explicit operator action)
 *   list                                         the stored names
 *
 * The secret is never a command-line argument, never read from a pipe or a file, never printed back. `--secret`,
 * `--value`, `--key` or a second positional argument are refused before anything else happens.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { VaultError, assertSecretValue, vaultName } from './vault.js';
import { WindowsUserVault } from './windows-dpapi.js';

const USAGE = 'usage: qandeel-vault <set|has|remove|list> [<name>] [--replace] [--directory <dir>]';
const FORBIDDEN_FLAGS = /^--?(?:secret|value|key|password|token|api-?key)(?:=|$)/i;

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(code: string, message: string, exit = 1): never {
  process.stderr.write(`${JSON.stringify({ ok: false, code, message })}\n`);
  process.exit(exit);
}

/**
 * Reads one line from the interactive terminal in raw mode: nothing is echoed, Backspace edits, Enter accepts,
 * Ctrl-C / Ctrl-D abort. Refuses a non-interactive stdin: a secret is typed by a person, never piped.
 */
export function promptHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return Promise.reject(new VaultError('SECRET_INVALID', 'the secret is entered on an interactive terminal only (no pipe, no file, no argument)'));
  return new Promise<string>((resolve, reject) => {
    process.stderr.write(prompt);
    const chars: string[] = [];
    const finish = (error: Error | null): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(chars.join(''));
    };
    const onData = (chunk: Buffer | string): void => {
      for (const ch of String(chunk)) {
        if (ch === '\u0003' || ch === '\u0004') return finish(new VaultError('SECRET_INVALID', 'secret entry aborted'));
        if (ch === '\r' || ch === '\n') return finish(null);
        if (ch === '\u0008' || ch === '\u007f') {
          chars.pop();
          continue;
        }
        if (ch >= ' ') chars.push(ch);
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}

export async function main(argv: readonly string[]): Promise<void> {
  // Before parsing anything: a secret on the command line is refused, whatever the command.
  if (argv.some((a) => FORBIDDEN_FLAGS.test(a))) fail('SECRET_ON_COMMAND_LINE', 'the secret is never a command-line argument; run "qandeel-vault set <name>" and type it at the hidden prompt', 2);
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({ args: rest, strict: true, allowPositionals: true, options: { replace: { type: 'boolean', default: false }, directory: { type: 'string' } } });
  if (command === undefined) fail('USAGE', USAGE, 2);
  if (positionals.length > 1) fail('SECRET_ON_COMMAND_LINE', 'only the vault name is given on the command line; the secret is typed at the hidden prompt', 2);
  const vault = new WindowsUserVault(values.directory !== undefined ? { directory: values.directory } : {});
  const name = (): string => {
    const n = positionals[0];
    if (n === undefined) fail('USAGE', USAGE, 2);
    return vaultName(`vault:${n}`);
  };
  switch (command) {
    case 'set': {
      const n = name();
      if (!WindowsUserVault.available()) fail('VAULT_UNAVAILABLE', 'the Windows user vault exists only on Windows');
      const secret = await promptHidden(`Enter the secret for vault:${n} (input is hidden, Enter to finish): `);
      assertSecretValue(secret);
      const r = await vault.set(n, secret, { replace: values.replace });
      out({ ok: true, command, ref: r.ref, kind: vault.kind, file: r.file, replaced: values.replace });
      return;
    }
    case 'has': {
      const n = name();
      out({ ok: true, command, ref: `vault:${n}`, stored: await vault.has(`vault:${n}`), kind: vault.kind });
      return;
    }
    case 'remove': {
      const n = name();
      out({ ok: true, command, ref: `vault:${n}`, removed: vault.remove(n) });
      return;
    }
    case 'list': {
      out({ ok: true, command, kind: vault.kind, directory: vault.directory, names: vault.list() });
      return;
    }
    default:
      fail('USAGE', USAGE, 2);
  }
}

const invokedDirectly = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof VaultError) fail(error.code, error.message);
    fail('UNCLASSIFIED_ERROR', 'command failed');
  });
}
