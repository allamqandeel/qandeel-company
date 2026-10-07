/**
 * OPS (D-OPS-08) — the production launcher runs the ACTIVATED release, never the mutable development checkout.
 *
 *   1. admission: a pinned workspace admits only its activated release, byte-identical; a development build, another
 *      release, an edited / added file or an unreadable pin are refused with a reason code — and `CompanyRuntime.start`
 *      refuses before it opens, upgrades or migrates anything;
 *   2. the controlled activation (verify → dry run → controlled stop → verified backup → pin → start from the release →
 *      health) brings up the host FROM the frozen release, and the shortcuts target that release, not the checkout;
 *   3. drift: the development checkout's own launcher / host cannot start the pinned Company (bounded
 *      RUNTIME_RELEASE_REFUSED), and an edited release fails closed until it is intact again;
 *   4. replacement: a new release replaces the old one only through activation (the old release is then refused); a
 *      release that fails its dry run changes nothing, and one that fails after the pin rolls back to the previous one.
 * OPS-PROOF: founder-host-release
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isQandeelError } from '@qandeel-company/domain';
import { CompanyRuntime, RELEASE_MANIFEST_FILE, RUNTIME_VERSION, admitRuntimeRelease, hashReleaseTree, readReleaseManifest, readReleasePin, releaseIdOf, releasePinPath } from '@qandeel-company/runtime';
import { CompanyStore } from '@qandeel-company/storage';

import { hostPaths } from '../src/host/descriptor.js';
import { discoverHost, ensureRunning, shortcutSpecs, stopHost } from '../src/host/lifecycle.js';
import { activateRelease, releaseCli, releaseStatus, resolveRelease, stageRelease } from '../src/host/release.js';

// <root>/packages/command-center/dist/test/x.test.js → the development checkout and its compiled CLI
const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(here, '..', '..', '..', '..');
const devCli = path.resolve(here, '..', 'src', 'cli.js');
const root = mkdtempSync(path.join(tmpdir(), 'qc-release-'));
const releases = path.join(root, 'releases');
const ws = path.join(root, 'company');
CompanyStore.open(ws).close();

after(async () => {
  await stopHost(ws, { force: true, timeoutMs: 30_000 });
  rmSync(root, { recursive: true, force: true });
});

const refusal = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return isQandeelError(error, 'RUNTIME_RELEASE_REFUSED') ? String(error.details.reason) : `OTHER:${String(error)}`;
  }
};

/** A different build: a copy of a release with one change, re-manifested (what staging a changed checkout yields). */
function variant(from: string, name: string, change: (dir: string) => void): string {
  const dir = path.join(releases, `.work-${name}`);
  cpSync(from, dir, { recursive: true });
  rmSync(path.join(dir, RELEASE_MANIFEST_FILE));
  change(dir);
  const files = hashReleaseTree(dir) ?? [];
  const releaseId = releaseIdOf(RUNTIME_VERSION, files);
  writeFileSync(path.join(dir, RELEASE_MANIFEST_FILE), JSON.stringify({ version: 1, releaseId, runtimeVersion: RUNTIME_VERSION, sourceCommit: null, stagedAt: new Date().toISOString(), files }));
  const final = path.join(releases, releaseId.slice(0, 16));
  renameSync(dir, final);
  return final;
}

function runCli(cli: string, args: readonly string[]): Promise<{ code: number; json: Record<string, unknown> }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { shell: false, windowsHide: true, timeout: 120_000 }, (error, stdout, stderr) => {
      const line = `${String(stdout)}\n${String(stderr)}`.trim().split('\n').filter((l) => l.startsWith('{')).at(-1) ?? '{}';
      resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, json: JSON.parse(line) as Record<string, unknown> });
    });
  });
}

const instanceLogAdmission = (): string[] =>
  readFileSync(hostPaths(ws).log, 'utf8')
    .split('\n')
    .filter((l) => l.includes('runtime.release_admitted'));

describe('production runtime release (D-OPS-08)', { timeout: 300_000 }, () => {
  let releaseA = '';
  let idA = '';

  test('staging freezes the current build outside the checkout, content-addressed and idempotent', () => {
    const staged = stageRelease(checkout, releases);
    releaseA = staged.root;
    idA = staged.releaseId;
    assert.equal(staged.reused, false);
    const rel = path.relative(checkout, staged.root);
    assert.ok(rel.startsWith('..') || path.isAbsolute(rel), 'the release lives outside the checkout');
    assert.equal(readReleaseManifest(staged.root)?.releaseId, idA);
    const again = stageRelease(checkout, releases);
    assert.equal(again.releaseId, idA);
    assert.equal(again.reused, true, 'the same build is the same release');
    assert.equal(resolveRelease(idA.slice(0, 12), releases), staged.root);
    assert.throws(() => stageRelease(checkout, path.join(checkout, 'releases-inside')), /RELEASES_DIR_INSIDE_CHECKOUT/);
  });

  test('admission: an unpinned Company admits any build; a pinned one only its activated, intact release', () => {
    const other = path.join(root, 'other');
    CompanyStore.open(other).close();
    assert.equal(admitRuntimeRelease(other, null).mode, 'UNPINNED');
    mkdirSync(path.dirname(releasePinPath(other)), { recursive: true });
    writeFileSync(releasePinPath(other), JSON.stringify({ version: 1, releaseId: idA, root: releaseA, activatedAt: new Date().toISOString(), previous: null }));
    assert.equal(admitRuntimeRelease(other, releaseA).mode, 'PINNED');
    assert.equal(refusal(() => admitRuntimeRelease(other, null)), 'NOT_A_RELEASE', 'a development build');
    const b = variant(releaseA, 'b', (d) => writeFileSync(path.join(d, 'node_modules', '@qandeel-company', 'domain', 'dist', 'src', 'note.json'), '{"b":1}'));
    assert.equal(refusal(() => admitRuntimeRelease(other, b)), 'NOT_ACTIVATED', 'another release');
    const tampered = path.join(root, 'tampered');
    cpSync(releaseA, tampered, { recursive: true });
    appendFileSync(path.join(tampered, 'node_modules', '@qandeel-company', 'runtime', 'dist', 'src', 'runtime.js'), '\n// edited\n');
    assert.equal(refusal(() => admitRuntimeRelease(other, tampered)), 'RELEASE_TAMPERED', 'an edited file');
    const added = path.join(root, 'added');
    cpSync(releaseA, added, { recursive: true });
    writeFileSync(path.join(added, 'node_modules', '@qandeel-company', 'runtime', 'dist', 'src', 'extra.js'), 'export {};\n');
    assert.equal(refusal(() => admitRuntimeRelease(other, added)), 'RELEASE_TAMPERED', 'an added file');
    writeFileSync(releasePinPath(other), '{ torn');
    assert.equal(refusal(() => admitRuntimeRelease(other, releaseA)), 'PIN_INVALID', 'an unreadable pin is never treated as unpinned');
  });

  test('CompanyRuntime.start refuses a pinned Company from a development build, before opening or migrating it', async () => {
    const pinned = path.join(root, 'pinned');
    CompanyStore.open(pinned).close();
    mkdirSync(path.dirname(releasePinPath(pinned)), { recursive: true });
    writeFileSync(releasePinPath(pinned), JSON.stringify({ version: 1, releaseId: idA, root: releaseA, activatedAt: new Date().toISOString(), previous: null }));
    const runtime = new CompanyRuntime({ workspace: pinned, processors: [], watchWakeFile: false });
    await assert.rejects(runtime.start(), (e: unknown) => isQandeelError(e, 'RUNTIME_RELEASE_REFUSED') && e.details.reason === 'NOT_A_RELEASE');
    const store = CompanyStore.open(pinned, { create: false, migrationMode: 'verify' });
    try {
      assert.equal(store.supervisorLease(), null, 'no lease taken');
      assert.equal(store.instance(runtime.instanceId), null, 'no runtime instance registered');
    } finally {
      store.close();
    }
  });

  test('activation starts the host FROM the release; the shortcuts target the release, not the checkout', async () => {
    const r = await activateRelease(ws, releaseA, { providers: [], shortcuts: false });
    assert.equal(r.outcome, 'ACTIVATED', JSON.stringify(r));
    assert.deepEqual(r.steps.map((s) => s.step), ['VERIFY', 'DRY_RUN', 'STOP', 'BACKUP', 'PIN', 'START', 'HEALTH']);
    assert.equal(r.steps.find((s) => s.step === 'BACKUP')?.result, 'VERIFIED');
    assert.ok(r.backupId);
    assert.equal(readReleasePin(ws)?.releaseId, idA);
    assert.equal(r.status?.state, 'RUNNING');
    const admitted = instanceLogAdmission().at(-1) ?? '';
    assert.match(admitted, /"mode":"PINNED"/);
    assert.ok(admitted.includes(idA), 'the running host was admitted as the activated release');
    const specs = shortcutSpecs(releaseCli(releaseA), path.join(root, 'launcher'));
    for (const s of specs) {
      assert.ok(s.arguments.includes(releaseA), 'every shortcut runs the release CLI');
      assert.ok(!s.arguments.includes(checkout), 'no shortcut runs the development checkout');
    }
    assert.equal(releaseStatus(ws).intact, true);
  });

  test('drift: the development checkout cannot start the pinned Company (bounded RUNTIME_RELEASE_REFUSED)', async () => {
    const open = await runCli(devCli, ['open', '--workspace', ws, '--no-browser']);
    assert.equal(open.code, 1);
    assert.equal(open.json.outcome, 'RUNTIME_RELEASE_REFUSED');
    assert.equal(open.json.reason, 'NOT_A_RELEASE');
    assert.ok(!('launchUrl' in open.json), 'no token minted for a refused build');
    const status = await runCli(devCli, ['status', '--workspace', ws]);
    assert.equal(status.json.admitted, 'NOT_A_RELEASE');
    const shortcuts = await runCli(devCli, ['install-shortcuts', '--workspace', path.join(root, 'other')]);
    assert.notEqual(shortcuts.code, 0);
    // Even bypassing the launcher's check, a host spawned from the checkout is refused by its own runtime.
    assert.equal((await stopHost(ws)).outcome, 'STOPPED');
    const dev = await ensureRunning(ws, { cliPath: devCli, providers: [] });
    assert.equal(dev.code, 'RUNTIME_RELEASE_REFUSED');
    assert.notEqual((await discoverHost(ws)).state, 'RUNNING');
    // An edited release fails closed until it is intact again.
    const file = path.join(releaseA, 'node_modules', '@qandeel-company', 'command-center', 'dist', 'src', 'surface.js');
    const original = readFileSync(file);
    appendFileSync(file, '\n// drift\n');
    const edited = await runCli(releaseCli(releaseA), ['open', '--workspace', ws, '--no-browser']);
    assert.equal(edited.json.outcome, 'RUNTIME_RELEASE_REFUSED');
    assert.equal(edited.json.reason, 'RELEASE_TAMPERED');
    writeFileSync(file, original);
    const back = await runCli(releaseCli(releaseA), ['open', '--workspace', ws, '--no-browser']);
    assert.equal(back.json.outcome, 'STARTED', JSON.stringify(back.json));
  });

  test('replacement: only activation replaces a release; a failed dry run changes nothing; a failed start rolls back', async () => {
    const b = variant(releaseA, 'b2', (d) => writeFileSync(path.join(d, 'node_modules', '@qandeel-company', 'domain', 'dist', 'src', 'note.json'), '{"b2":1}'));
    const idB = readReleaseManifest(b)?.releaseId ?? '';
    const r = await activateRelease(ws, b, { providers: [], shortcuts: false });
    assert.equal(r.outcome, 'ACTIVATED', JSON.stringify(r));
    assert.equal(r.previousReleaseId, idA);
    assert.equal(readReleasePin(ws)?.previous?.releaseId, idA);
    const oldOne = await runCli(releaseCli(releaseA), ['open', '--workspace', ws, '--no-browser']);
    assert.equal(oldOne.json.reason, 'NOT_ACTIVATED', 'the replaced release no longer runs this Company');

    // A build whose own code cannot even load fails the dry run: nothing is stopped, pinned or backed up.
    const broken = variant(b, 'broken', (d) => appendFileSync(path.join(d, 'node_modules', '@qandeel-company', 'command-center', 'dist', 'src', 'cli.js'), '\nthrow new Error("broken build");\n'));
    const running = await discoverHost(ws);
    const refused = await activateRelease(ws, broken, { providers: [], shortcuts: false });
    assert.equal(refused.outcome, 'REFUSED');
    assert.equal(refused.code, 'DRY_RUN_FAILED');
    assert.equal(readReleasePin(ws)?.releaseId, idB, 'the pin is unchanged');
    assert.equal((await discoverHost(ws)).instanceId, running.instanceId, 'the running host was never stopped');

    // A build that passes its dry run but whose host never comes up is rolled back to the previous release.
    const failing = variant(b, 'failing', (d) => appendFileSync(path.join(d, 'node_modules', '@qandeel-company', 'command-center', 'dist', 'src', 'cli.js'), '\nif (process.argv.includes("serve")) process.exit(9);\n'));
    const rolled = await activateRelease(ws, failing, { providers: [], shortcuts: false });
    assert.equal(rolled.outcome, 'ROLLED_BACK', JSON.stringify(rolled));
    assert.equal(readReleasePin(ws)?.releaseId, idB, 'the previous pin is restored');
    assert.equal(rolled.status?.state, 'RUNNING', 'the previous release runs again');
    assert.ok(instanceLogAdmission().at(-1)?.includes(idB));
  });
});
