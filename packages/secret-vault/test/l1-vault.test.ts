/**
 * L1-01 secret vault proofs. L1-PROOF: secret-vault
 *
 * On Windows the real DPAPI (CurrentUser) round trip runs through the signed PowerShell host into a disposable
 * directory; elsewhere the Windows vault fails closed with VAULT_UNAVAILABLE (both are the platform-correct
 * behaviour, never a skipped test). No proof ever writes a secret to a log, a fixture or a command line.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { InMemorySecretVault, VAULT_FORMAT, VaultError, WindowsUserVault, assertSecretValue, vaultName } from '../src/index.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
// A value that is secret-shaped for the proofs but matches no real key format (never a provider key).
const SAMPLE = 'vault-proof-' + 'Zx9Qp3Lm7Tq2Wd5Hv8Nb1Kc4';

function tempDir(label: string): string {
  return mkdtempSync(path.join(tmpdir(), `qc-vault-${label}-`));
}

describe('L1 secret vault: references and values', () => {
  test('a reference is vault:<name>; a value is one bounded line; an in-memory vault resolves only inside use()', async () => {
    assert.equal(vaultName('vault:deepseek-company'), 'deepseek-company');
    for (const bad of ['deepseek-company', 'vault:', 'vault:Upper', 'vault:a b', 'vault:-x', `vault:${'a'.repeat(59)}`]) assert.throws(() => vaultName(bad), (e) => e instanceof VaultError && e.code === 'INVALID_REF', bad);
    for (const bad of ['', ' x', 'x\n', 'a\u0000b', 'x'.repeat(4097)]) assert.throws(() => assertSecretValue(bad), (e) => e instanceof VaultError && e.code === 'SECRET_INVALID');
    const vault = new InMemorySecretVault();
    assert.equal(await vault.has('vault:deepseek-company'), false);
    await assert.rejects(vault.use('vault:deepseek-company', () => 1), (e) => e instanceof VaultError && e.code === 'SECRET_NOT_FOUND');
    vault.set('deepseek-company', SAMPLE);
    assert.equal(await vault.has('vault:deepseek-company'), true);
    const seen = await vault.use('vault:deepseek-company', (s) => s.length);
    assert.equal(seen, SAMPLE.length, 'the value reaches the callback and nothing else');
    assert.equal(vault.kind, 'IN_MEMORY');
    assert.deepEqual(Object.keys(vault), ['kind'], 'no public field carries a value');
  });
});

describe('L1 secret vault: the Windows user vault (DPAPI, CurrentUser) through the signed PowerShell host', () => {
  test('Windows: protect → file holds no plaintext → unprotect round trip; a tampered blob is refused; overwrite is explicit; elsewhere: VAULT_UNAVAILABLE', async () => {
    const dir = path.join(tempDir('dpapi'), 'خزنة');
    const vault = new WindowsUserVault({ directory: dir });
    try {
      if (!WindowsUserVault.available()) {
        assert.equal(process.platform === 'win32', false);
        await assert.rejects(vault.set('deepseek-company', SAMPLE), (e) => e instanceof VaultError && e.code === 'VAULT_UNAVAILABLE');
        await assert.rejects(vault.use('vault:deepseek-company', () => 1), (e) => e instanceof VaultError && e.code === 'VAULT_UNAVAILABLE');
        assert.equal(await vault.has('vault:deepseek-company'), false);
        return;
      }
      assert.equal(await vault.has('vault:deepseek-company'), false);
      const stored = await vault.set('deepseek-company', SAMPLE);
      assert.equal(stored.ref, 'vault:deepseek-company');
      assert.ok(stored.file.startsWith(dir) && stored.file.endsWith('.dpapi.json'), 'the blob lives in the vault directory, outside any workspace');
      const file = readFileSync(stored.file, 'utf8');
      assert.ok(!file.includes(SAMPLE) && !file.includes(Buffer.from(SAMPLE).toString('base64')), 'no plaintext (or trivially encoded plaintext) in the vault file');
      const blob = JSON.parse(file) as { format: string; scope: string; protected: string };
      assert.equal(blob.format, VAULT_FORMAT);
      assert.equal(blob.scope, 'CurrentUser');
      assert.ok(blob.protected.length > 64, 'a DPAPI blob');
      assert.equal(await vault.has('vault:deepseek-company'), true);
      assert.deepEqual(vault.list(), ['deepseek-company']);
      const seen = await vault.use('vault:deepseek-company', (s) => s);
      assert.equal(seen, SAMPLE, 'the same user unprotects the same value');
      // Overwrite is an explicit operator action.
      await assert.rejects(vault.set('deepseek-company', `${SAMPLE}-2`), (e) => e instanceof VaultError && e.code === 'ALREADY_EXISTS');
      await vault.set('deepseek-company', `${SAMPLE}-2`, { replace: true });
      assert.equal(await vault.use('vault:deepseek-company', (s) => s), `${SAMPLE}-2`);
      // A tampered blob (one byte flipped) is refused by Windows, never read as a value.
      const flipped = Buffer.from(blob.protected, 'base64');
      flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 0x5a;
      writeFileSync(stored.file, JSON.stringify({ ...blob, protected: flipped.toString('base64') }));
      await assert.rejects(vault.use('vault:deepseek-company', () => 1), (e) => e instanceof VaultError && e.code === 'VAULT_TAMPERED');
      writeFileSync(stored.file, '{"not":"a blob"}');
      await assert.rejects(vault.use('vault:deepseek-company', () => 1), (e) => e instanceof VaultError && e.code === 'VAULT_TAMPERED');
      assert.equal(vault.remove('deepseek-company'), true);
      assert.equal(await vault.has('vault:deepseek-company'), false);
    } finally {
      rmSync(path.dirname(dir), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  test('the CLI refuses a secret on the command line and a non-interactive prompt; it never prints a value; the vault directory is never a workspace', () => {
    const dir = tempDir('cli');
    try {
      const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', shell: false, windowsHide: true, input: `${SAMPLE}\n` });
      for (const args of [['set', 'deepseek-company', '--secret', SAMPLE], ['set', 'deepseek-company', `--secret=${SAMPLE}`], ['set', 'deepseek-company', '--value', SAMPLE], ['set', 'deepseek-company', '--api-key', SAMPLE], ['set', 'deepseek-company', SAMPLE]]) {
        const r = run(...args, '--directory', dir);
        assert.equal(r.status, 2, `${args.join(' ')} is refused before anything happens`);
        assert.ok(/SECRET_ON_COMMAND_LINE/.test(r.stderr), r.stderr);
        assert.ok(!r.stdout.includes(SAMPLE) && !r.stderr.includes(SAMPLE), 'the value is never echoed');
      }
      // A piped stdin is not an interactive terminal: the hidden prompt refuses it (a secret is typed by a person).
      const piped = run('set', 'deepseek-company', '--directory', dir);
      assert.notEqual(piped.status, 0);
      assert.ok(/SECRET_INVALID|VAULT_UNAVAILABLE/.test(piped.stderr), piped.stderr);
      assert.ok(!piped.stdout.includes(SAMPLE) && !piped.stderr.includes(SAMPLE));
      const listed = run('list', '--directory', dir);
      assert.equal(listed.status, 0, listed.stderr);
      const parsed = JSON.parse(listed.stdout) as { names: string[]; directory: string };
      assert.deepEqual(parsed.names, []);
      assert.equal(path.resolve(parsed.directory), path.resolve(dir));
      const usage = run();
      assert.equal(usage.status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  test('the default vault directory is the user\'s local application data, never a Company workspace or this checkout', () => {
    if (process.platform !== 'win32') {
      assert.equal(new WindowsUserVault({ directory: 'x' }).directory, 'x', 'an explicit directory is honoured; the default needs LOCALAPPDATA (Windows)');
      return;
    }
    const dir = new WindowsUserVault().directory;
    assert.ok(/QANDEEL_COMPANY[\\/]vault$/.test(dir), dir);
    assert.ok(dir.startsWith(process.env.LOCALAPPDATA ?? '\u0000'), 'under LOCALAPPDATA');
    assert.ok(!path.resolve(dir).startsWith(path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))), 'outside the repository checkout');
  });
});
