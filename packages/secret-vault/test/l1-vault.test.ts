/**
 * L1-01 secret vault proofs. L1-PROOF: secret-vault
 *
 * On Windows the real DPAPI (CurrentUser) round trip runs through the signed PowerShell host into a disposable
 * directory; elsewhere the Windows vault fails closed with VAULT_UNAVAILABLE (both are the platform-correct
 * behaviour, never a skipped test). No proof ever writes a secret to a log, a fixture or a command line.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

describe('L1 secret vault: the two security gates observed on every platform (validation / proof portability)', () => {
  // The real DPAPI round trip above is the authoritative runtime proof and runs only on Windows. Elsewhere set() and
  // the CLI's `set` fail closed at the platform gate BEFORE the Protect call and before the hidden prompt, so a
  // mutation of either gate (`l1-vault-plaintext`, `l1-vault-piped-secret-accepted`) was invisible to non-Windows CI.
  // These proofs observe the gates themselves everywhere, without real DPAPI: the platform gate is lifted inside a
  // throwaway child process only, the protection host is made unreachable (a system root that does not exist) and the
  // child's stdin is a pipe. No production semantics change; the compiled contract (dist) is inspected as well, so the
  // ORDER of each gate holds.
  const DIST_VAULT = fileURLToPath(new URL('../src/windows-dpapi.js', import.meta.url));
  const DIST_INDEX = fileURLToPath(new URL('../src/index.js', import.meta.url));
  const READ_STDIN = 'const value = (await new Promise((res) => { let s = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (c) => { s += c; }); process.stdin.on("end", () => res(s)); })).trim();';

  /** Runs one ES-module script in a child whose stdin is a pipe carrying the sample (never a TTY), and parses its JSON line. */
  function runModule(lines: readonly string[], env: NodeJS.ProcessEnv): { outcome: Record<string, unknown>; stderr: string; stdout: string } {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', lines.join('\n')], { encoding: 'utf8', shell: false, windowsHide: true, input: `${SAMPLE}\n`, env, timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    return { outcome: JSON.parse(r.stdout) as Record<string, unknown>, stderr: r.stderr, stdout: r.stdout };
  }

  test('with no protection host, set() stores nothing: the plaintext (or its base64) is never written as a fallback', () => {
    const root = tempDir('hostless');
    const dir = path.join(root, 'vault');
    try {
      const { outcome, stdout, stderr } = runModule(
        [
          "import { pathToFileURL } from 'node:url';",
          'const { WindowsUserVault, VaultError } = await import(pathToFileURL(process.env.QC_VAULT_INDEX).href);',
          READ_STDIN,
          // The platform gate is lifted HERE ONLY, so the Protect gate itself is what this proof observes; the system root
          // (where the signed PowerShell host lives) is pointed at a directory that does not exist, after Node started.
          'WindowsUserVault.available = () => true;',
          'process.env.SystemRoot = process.env.QC_NO_ROOT; process.env.windir = process.env.QC_NO_ROOT;',
          'const vault = new WindowsUserVault({ directory: process.env.QC_VAULT_DIR, timeoutMs: 10000 });',
          "try { const r = await vault.set('deepseek-company', value); console.log(JSON.stringify({ stored: true, file: r.file })); }",
          'catch (e) { console.log(JSON.stringify({ stored: false, vaultError: e instanceof VaultError, code: e.code })); }',
        ],
        { ...process.env, QC_VAULT_INDEX: DIST_INDEX, QC_VAULT_DIR: dir, QC_NO_ROOT: path.join(root, 'no-windows') },
      );
      assert.deepEqual(outcome, { stored: false, vaultError: true, code: 'VAULT_UNAVAILABLE' }, 'no protection host → a classified refusal, never a stored secret');
      assert.equal(existsSync(dir) ? readdirSync(dir).length : 0, 0, 'nothing is written without DPAPI (no blob, no temp file)');
      assert.ok(!stdout.includes(SAMPLE) && !stderr.includes(SAMPLE), 'the value is never echoed');
      // Compiled contract: the stored `protected` field is the DPAPI Protect result, computed before the write.
      const compiled = readFileSync(DIST_VAULT, 'utf8');
      const protect = compiled.indexOf("const protectedBase64 = await this.#dpapi('Protect', ");
      assert.ok(protect >= 0, 'the blob is protected by the DPAPI Protect call');
      assert.ok(compiled.indexOf('writeFileSync(') > protect && compiled.includes('protected: protectedBase64'), 'the Protect call precedes the write and its result is what is stored');
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  test('promptHidden refuses a non-interactive stdin with SECRET_INVALID before the prompt is shown or raw mode is touched', () => {
    const { outcome, stdout, stderr } = runModule(
      [
        "import { pathToFileURL } from 'node:url';",
        'const { promptHidden } = await import(pathToFileURL(process.env.QC_VAULT_CLI).href);',
        'const { VaultError } = await import(pathToFileURL(process.env.QC_VAULT_INDEX).href);',
        "const outcome = await promptHidden('PROMPT-MARKER: ').then((s) => ({ accepted: true, chars: s.length }), (e) => ({ accepted: false, vaultError: e instanceof VaultError, code: e.code }));",
        'console.log(JSON.stringify(outcome));',
      ],
      { ...process.env, QC_VAULT_CLI: CLI, QC_VAULT_INDEX: DIST_INDEX },
    );
    assert.deepEqual(outcome, { accepted: false, vaultError: true, code: 'SECRET_INVALID' }, "a piped stdin is refused with the vault's own code: never accepted, never a crash");
    assert.ok(!stderr.includes('PROMPT-MARKER'), 'refused before the prompt is even shown');
    assert.ok(!stdout.includes(SAMPLE) && !stderr.includes(SAMPLE), 'the value is never echoed');
    // Compiled contract: the non-interactive guard precedes every raw-mode step.
    const compiled = readFileSync(CLI, 'utf8');
    const guard = compiled.indexOf("if (!stdin.isTTY || typeof stdin.setRawMode !== 'function')");
    assert.ok(guard >= 0 && guard < compiled.indexOf('setRawMode(true)'), 'the guard is present and precedes raw-mode handling');
  });
});
