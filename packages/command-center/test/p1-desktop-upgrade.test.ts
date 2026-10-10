/**
 * P1-DESKTOP-UPGRADE-CORR-01 — the controlled activation across a schema migration, between REAL releases and REAL hosts.
 *
 * The older release is the staged current build with its last released migration withdrawn (its storage pins 0001–0021
 * only): a genuine schema-21 runtime and Founder host, started from its own frozen release, holding its own Company. The
 * newer release is the staged current build (0001–0022). Proven on disposable workspaces:
 *
 *   - the newer release sees the running older host (never "not running" because it cannot open the older schema);
 *   - an invalid or mismatched previous release, a host that does not stop, a squatter on the host's port and a missing
 *     descriptor are refused BEFORE anything is stopped, backed up, pinned or migrated — no duplicate runtime starts;
 *   - 21 → 22 with the previous host running (stopped by its own release, lease release proven) and stopped (and its
 *     holder crashed: the lease is waited out) activates: one READY host, the new pin, schema 22, business data unchanged;
 *   - a schema newer than the runtime and a history that does not match the release are refused at the dry run;
 *   - a rehearsal failure keeps the original data and the UPDATE_HOLD; a failure after the migration is never reported as
 *     a rollback (the previous release cannot open the migrated Company): RECOVERY_HOLD, snapshot kept, nothing cleared.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { RELEASE_MANIFEST_FILE, RUNTIME_VERSION, hashReleaseTree, readReleaseManifest, readReleasePin, releaseIdOf, releasePinPath } from '@qandeel-company/runtime';
import * as currentStorage from '@qandeel-company/storage';
import { inspectCompanySchema } from '@qandeel-company/storage';

import { hostPaths } from '../src/host/descriptor.js';
import { discoverHost, ensureRunning, stopHost } from '../src/host/lifecycle.js';
import { pidAlive } from '../src/host/processes.js';
import { activateRelease, releaseCli, stageRelease } from '../src/host/release.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(here, '..', '..', '..', '..');
const root = mkdtempSync(path.join(tmpdir(), 'qc-upgrade-'));
const releases = path.join(root, 'releases');
const workspaces: string[] = [];

after(async () => {
  for (const ws of workspaces) await stopHost(ws, { force: true, timeoutMs: 30_000 });
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const pkg = (release: string, name: string): string => path.join(release, 'node_modules', '@qandeel-company', name);
const migrationsJs = (release: string): string => path.join(pkg(release, 'storage'), 'dist', 'src', 'migrations.js');

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

/** Replaces exactly one occurrence (a fixture edit that silently matched nothing would prove nothing). */
function edit(file: string, from: RegExp | string, to: string): void {
  const text = readFileSync(file, 'utf8');
  const next = text.replace(from, to);
  assert.notEqual(next, text, `fixture edit applied to ${path.basename(file)}`);
  writeFileSync(file, next);
}

const sha = (text: string): string => createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

function runCli(cli: string, args: readonly string[]): Promise<{ code: number; json: Record<string, unknown> }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { shell: false, windowsHide: true, timeout: 120_000 }, (error, stdout) => {
      const line = String(stdout).trim().split('\n').filter((l) => l.startsWith('{')).at(-1) ?? '{}';
      resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, json: JSON.parse(line) as Record<string, unknown> });
    });
  });
}

type StorageModule = typeof import('@qandeel-company/storage');

/** Business data, content-compared: every Work Item, every Employee, the Company budget. */
function businessData(storage: StorageModule, ws: string): string {
  const store = storage.CompanyStore.open(ws, { create: false, migrationMode: 'verify' });
  try {
    const gov = storage.GovernanceStore.for(store);
    const items = store.listWorkItems({ limit: 1_000 }).sort((a, b) => (a.id < b.id ? -1 : 1));
    const employees = gov.listEmployees().sort((a, b) => (a.id < b.id ? -1 : 1));
    return JSON.stringify({ items, employees, budget: gov.budgetFor('COMPANY', 'company') });
  } finally {
    store.close();
  }
}

const journals = (ws: string): string[] => {
  const dir = path.join(ws, 'maintenance');
  return existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(path.join(dir, d, 'journal.json'))) : [];
};
const journal = (ws: string, id: string): { state: string; code: string; fromVersion: number; toVersion: number } => JSON.parse(readFileSync(path.join(ws, 'maintenance', id, 'journal.json'), 'utf8')) as { state: string; code: string; fromVersion: number; toVersion: number };

describe('P1-DESKTOP-UPGRADE-CORR-01: cross-version Desktop update', { timeout: 900_000 }, () => {
  let next = '';
  let older = '';
  let olderStorage: StorageModule;

  /** A disposable Company created and run by the OLDER release (schema 21), with Founder, budget and Work Items. */
  async function olderCompany(name: string, running: boolean): Promise<{ ws: string; instanceId: string | null; pid: number | null; data: string }> {
    const ws = path.join(root, name);
    workspaces.push(ws);
    const store = olderStorage.CompanyStore.open(ws);
    try {
      const seam = (await import(pathToFileURL(path.join(pkg(older, 'storage'), 'dist', 'src', 'testing', 'founder-seam.js')).href)) as { armFounderTestSurface: (r: string) => void };
      seam.armFounderTestSurface(store.workspace.root);
      const gov = olderStorage.GovernanceStore.for(store);
      const founder = gov.registerFounder().ref;
      gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: 5_000_000, capTokens: 10_000_000, currency: 'USD', reasonCode: 'seed' });
      for (const objective of ['خطة الربع', 'Quarter plan', 'مراجعة']) store.createWorkItem({ objective, ownerRef: founder, initialState: 'PROPOSED' });
      assert.equal(store.schemaVersion, 21);
    } finally {
      store.close();
    }
    const id = readReleaseManifest(older)?.releaseId ?? '';
    mkdirSync(path.dirname(releasePinPath(ws)), { recursive: true });
    writeFileSync(releasePinPath(ws), JSON.stringify({ version: 1, releaseId: id, root: older, activatedAt: new Date().toISOString(), previous: null }));
    const data = businessData(olderStorage, ws);
    if (!running) return { ws, instanceId: null, pid: null, data };
    const started = await ensureRunning(ws, { cliPath: releaseCli(older), providers: [] });
    assert.equal(started.code, null, JSON.stringify(started));
    return { ws, instanceId: started.status.instanceId, pid: started.status.pid, data };
  }

  before(async () => {
    next = stageRelease(checkout, releases).root;
    // The older release: the same build with its last released migration withdrawn (pins and file).
    older = variant(next, 'v21', (d) => {
      edit(migrationsJs(d), /^\s*\{ version: 22, [^\n]*\n/m, '');
      rmSync(path.join(pkg(d, 'storage'), 'migrations', '0022_p1_product_knowledge.sql'));
    });
    olderStorage = (await import(pathToFileURL(path.join(pkg(older, 'storage'), 'dist', 'src', 'index.js')).href)) as StorageModule;
  });

  test('fixture: the older release is a schema-21 runtime; the newer one reads its Company as UPDATE_REQUIRED', async () => {
    assert.equal(olderStorage.CURRENT_SCHEMA_VERSION, 21);
    const { ws } = await olderCompany('fixture', false);
    const check = await runCli(releaseCli(next), ['release-check', '--workspace', ws]);
    assert.equal(check.json.schema, 'UPDATE_REQUIRED', JSON.stringify(check.json));
    assert.equal(check.json.databaseVersion, 21);
    assert.equal(check.json.ok, true);
    assert.equal((await runCli(releaseCli(older), ['release-check', '--workspace', ws])).json.schema, 'CURRENT');
  });

  test('21 → 22 with the previous host RUNNING: found, refused safely when unsafe, then stopped by its own release and upgraded', async () => {
    const old = await olderCompany('running', true);
    const { ws } = old;
    const pinOld = readFileSync(releasePinPath(ws), 'utf8');
    const unchanged = async (label: string): Promise<void> => {
      const s = await discoverHost(ws);
      assert.equal(s.state, 'RUNNING', `${label}: the previous host still runs`);
      assert.equal(s.instanceId, old.instanceId, `${label}: the same host, no second runtime`);
      assert.equal(inspectCompanySchema(ws).databaseVersion, 21, `${label}: schema untouched`);
      assert.equal(readFileSync(releasePinPath(ws), 'utf8'), pinOld, `${label}: pin untouched`);
      assert.deepEqual(journals(ws), [], `${label}: no update started`);
    };

    // Discovery from the NEWER release: the older host is RUNNING (not stopped, not unhealthy), its schema behind.
    const seen = await discoverHost(ws);
    assert.equal(seen.state, 'RUNNING', JSON.stringify(seen));
    assert.equal(seen.schema, 'UPDATE_REQUIRED');
    assert.equal(seen.leaseLive, true);
    assert.equal(seen.instanceId, (await runCli(releaseCli(older), ['status', '--workspace', ws])).json.instanceId, 'the holder the older release itself reports');

    // An invalid previous release: refused before the stop.
    const file = path.join(pkg(older, 'command-center'), 'dist', 'src', 'surface.js');
    const original = readFileSync(file);
    appendFileSync(file, '\n// edited\n');
    const invalid = await activateRelease(ws, next, { providers: [], shortcuts: false });
    writeFileSync(file, original);
    assert.equal(invalid.code, 'PREVIOUS_RELEASE_INVALID', JSON.stringify(invalid));
    assert.deepEqual(invalid.steps.map((s) => s.step), ['VERIFY', 'DRY_RUN', 'PREVIOUS']);
    await unchanged('invalid previous release');

    // A pin that names one release but points at another: refused.
    const pin = JSON.parse(pinOld) as Record<string, unknown>;
    writeFileSync(releasePinPath(ws), JSON.stringify({ ...pin, root: next }));
    const mismatched = await activateRelease(ws, next, { providers: [], shortcuts: false });
    writeFileSync(releasePinPath(ws), pinOld);
    assert.equal(mismatched.code, 'PREVIOUS_RELEASE_MISMATCH', JSON.stringify(mismatched));
    await unchanged('mismatched previous release');

    // A squatter answers on the descriptor's port: the identity fails, the controlled stop never reaches the host, and
    // nothing is terminated — the update is refused before any change.
    const paths = hostPaths(ws);
    const descriptor = readFileSync(paths.descriptor, 'utf8');
    const squatter = http.createServer((_req, res) => res.writeHead(404).end('{}'));
    await new Promise<void>((r) => squatter.listen(0, '127.0.0.1', r));
    const port = (squatter.address() as { port: number }).port;
    writeFileSync(paths.descriptor, JSON.stringify({ ...(JSON.parse(descriptor) as Record<string, unknown>), port }));
    const squatted = await activateRelease(ws, next, { providers: [], shortcuts: false });
    squatter.close();
    writeFileSync(paths.descriptor, descriptor);
    assert.equal(squatted.code, 'HOST_NOT_STOPPED', JSON.stringify(squatted));
    assert.equal(squatted.steps.find((s) => s.step === 'STOP')?.result, 'HOST_UNRESPONSIVE');
    assert.ok(pidAlive(old.pid ?? 0), 'the previous host process was never terminated');
    await unchanged('squatter on the host port');

    // No descriptor at all: a live holder without its Founder surface is never stopped or started beside.
    renameSync(paths.descriptor, `${paths.descriptor}.moved`);
    const hidden = await activateRelease(ws, next, { providers: [], shortcuts: false });
    renameSync(`${paths.descriptor}.moved`, paths.descriptor);
    assert.equal(hidden.ok, false, JSON.stringify(hidden));
    assert.ok(hidden.code === 'FOREIGN_RUNTIME' || hidden.code === 'HOST_NOT_STOPPED', String(hidden.code));
    assert.ok(!hidden.steps.some((s) => s.step === 'PIN'));
    await unchanged('missing descriptor');

    // The update: the previous release stops its own host, the lease release is proven, safe-upgrade migrates in the new
    // host's start, and exactly one READY host of the new release runs schema 22 with the business data unchanged.
    const r = await activateRelease(ws, next, { providers: [], shortcuts: false });
    assert.equal(r.outcome, 'ACTIVATED', JSON.stringify(r));
    assert.deepEqual(r.steps, [
      { step: 'VERIFY', result: 'OK' },
      { step: 'DRY_RUN', result: 'UPDATE_REQUIRED' },
      { step: 'PREVIOUS', result: 'VERIFIED' },
      { step: 'STOP', result: 'STOPPED' },
      { step: 'LEASE', result: 'RELEASED' },
      { step: 'BACKUP', result: 'BY_SAFE_UPGRADE' },
      { step: 'PIN', result: 'OK' },
      { step: 'START', result: 'RUNNING' },
      { step: 'SCHEMA', result: '21->22' },
      { step: 'HEALTH', result: 'READY' },
    ]);
    const now = await discoverHost(ws);
    assert.equal(now.state, 'RUNNING');
    assert.equal(now.runtimeState, 'READY');
    assert.equal(now.schema, 'CURRENT');
    assert.notEqual(now.instanceId, old.instanceId, 'a new host');
    assert.equal(pidAlive(old.pid ?? 0), false, 'the previous host has exited');
    assert.equal(readReleasePin(ws)?.releaseId, readReleaseManifest(next)?.releaseId);
    assert.equal(readReleasePin(ws)?.previous?.releaseId, readReleaseManifest(older)?.releaseId, 'the previous release is kept as the rollback point');
    assert.equal(inspectCompanySchema(ws).databaseVersion, 22);
    const [update] = journals(ws);
    assert.ok(update, 'the safe-upgrade journal');
    assert.equal(journal(ws, update).state, 'ACTIVATED');
    assert.ok(existsSync(path.join(ws, 'maintenance', update, 'pre-update.sqlite3')), 'the verified pre-update snapshot is kept');
    assert.equal(businessData(currentStorage, ws), old.data, 'every Work Item, Employee and the budget unchanged');
    assert.equal((await runCli(releaseCli(older), ['open', '--workspace', ws, '--no-browser'])).json.reason, 'NOT_ACTIVATED', 'the previous release no longer runs it');

    // A schema newer than the runtime: re-activating the older release is refused at its own dry run, nothing changes.
    const back = await activateRelease(ws, older, { providers: [], shortcuts: false });
    assert.equal(back.code, 'DRY_RUN_FAILED', JSON.stringify(back));
    assert.equal((await runCli(releaseCli(older), ['release-check', '--workspace', ws])).json.schema, 'SCHEMA_FROM_FUTURE');
    assert.equal((await discoverHost(ws)).instanceId, now.instanceId, 'the new host was never stopped');
  });

  test('21 → 22 with the previous host STOPPED, and with its holder crashed (the live lease is waited out, never ignored)', async () => {
    const stopped = await olderCompany('stopped', false);
    const r = await activateRelease(stopped.ws, next, { providers: [], shortcuts: false });
    assert.equal(r.outcome, 'ACTIVATED', JSON.stringify(r));
    assert.deepEqual(r.steps.slice(0, 5).map((s) => `${s.step}:${s.result}`), ['VERIFY:OK', 'DRY_RUN:UPDATE_REQUIRED', 'PREVIOUS:VERIFIED', 'STOP:NOT_RUNNING', 'LEASE:RELEASED']);
    assert.equal(inspectCompanySchema(stopped.ws).databaseVersion, 22);
    assert.equal(businessData(currentStorage, stopped.ws), stopped.data);

    const crashed = await olderCompany('crashed', true);
    process.kill(crashed.pid ?? 0);
    const deadline = Date.now() + 15_000;
    while (pidAlive(crashed.pid ?? 0) && Date.now() < deadline) await new Promise((res) => setTimeout(res, 200));
    const stale = await discoverHost(crashed.ws);
    assert.equal(stale.state, 'STALE', 'a crashed holder whose lease is still live');
    assert.equal(stale.leaseLive, true);
    const c = await activateRelease(crashed.ws, next, { providers: [], shortcuts: false });
    assert.equal(c.outcome, 'ACTIVATED', JSON.stringify(c));
    assert.equal(c.steps.find((s) => s.step === 'LEASE')?.result, 'RELEASED');
    assert.equal(businessData(currentStorage, crashed.ws), crashed.data);
  });

  test('a history that does not match the release is refused at the dry run (MIGRATION_CHECKSUM_DRIFT), nothing changes', async () => {
    // A release whose migration 0005 differs from the one this Company applied (file and pin changed together).
    const drifted = variant(next, 'drift', (d) => {
      const file = path.join(pkg(d, 'storage'), 'migrations', '0005_c3_memory_context.sql');
      const text = `${readFileSync(file, 'utf8')}\n-- drift\n`;
      writeFileSync(file, text);
      edit(migrationsJs(d), /(\{ version: 5, [^\n]*sha256: ')[0-9a-f]{64}'/, `$1${sha(text)}'`);
    });
    const { ws, data } = await olderCompany('drift', false);
    assert.equal((await runCli(releaseCli(drifted), ['release-check', '--workspace', ws])).json.schema, 'MIGRATION_CHECKSUM_DRIFT');
    const r = await activateRelease(ws, drifted, { providers: [], shortcuts: false });
    assert.equal(r.code, 'DRY_RUN_FAILED', JSON.stringify(r));
    assert.equal(inspectCompanySchema(ws).databaseVersion, 21);
    assert.equal(readReleasePin(ws)?.releaseId, readReleaseManifest(older)?.releaseId);
    assert.deepEqual(journals(ws), []);
    assert.equal(businessData(olderStorage, ws), data);
  });

  test('an update that fails before the live Company is touched rolls back truthfully; a rehearsal failure keeps the UPDATE_HOLD', async () => {
    /** A release whose migration 0022 carries one more statement (pinned consistently, so it loads and runs). */
    const withStatement = (name: string, statement: string): string =>
      variant(next, name, (d) => {
        const file = path.join(pkg(d, 'storage'), 'migrations', '0022_p1_product_knowledge.sql');
        const text = `${readFileSync(file, 'utf8')}\n${statement}\n`;
        writeFileSync(file, text);
        edit(migrationsJs(d), /(\{ version: 22, [^\n]*sha256: ')[0-9a-f]{64}'/, `$1${sha(text)}'`);
      });
    const old = await olderCompany('rehearsal', true);

    // Fails on any schema (safe-upgrade's own expected-schema build refuses it): the live Company is never touched, the
    // previous release runs it again — a real rollback, reported as one.
    const unbuildable = await activateRelease(old.ws, withStatement('unbuildable', 'INSERT INTO no_such_table VALUES (1);'), { providers: [], shortcuts: false });
    assert.equal(unbuildable.outcome, 'ROLLED_BACK', JSON.stringify(unbuildable));
    assert.equal(unbuildable.steps.find((s) => s.step === 'SCHEMA')?.result, '21->21');
    assert.equal(unbuildable.steps.find((s) => s.step === 'ROLLBACK_START')?.result, 'RUNNING');
    assert.equal(unbuildable.status?.schema, 'UPDATE_REQUIRED', 'the previous release runs the unchanged Company');
    assert.equal(readReleasePin(old.ws)?.releaseId, readReleaseManifest(older)?.releaseId);
    assert.equal(businessData(olderStorage, old.ws), old.data);

    // Fails only on the real data (a unique index over duplicated rows): the rehearsal on the snapshot copy fails, the live
    // Company is never migrated, and the UPDATE_HOLD stays until the operator clears it — RECOVERY_HOLD, not a rollback.
    const r = await activateRelease(old.ws, withStatement('rehearsal', 'CREATE UNIQUE INDEX fixture_rehearsal_unique ON audit_events (outcome);'), { providers: [], shortcuts: false });
    assert.equal(r.outcome, 'RECOVERY_HOLD', JSON.stringify(r));
    assert.equal(r.code, 'UPDATE_HOLD');
    assert.equal(r.steps.find((s) => s.step === 'STOP')?.result, 'STOPPED');
    assert.equal(r.steps.find((s) => s.step === 'ROLLBACK_PIN')?.result, 'PREVIOUS');
    assert.equal(r.steps.at(-1)?.result, 'UPDATE_HOLD');
    assert.equal(readReleasePin(old.ws)?.releaseId, readReleaseManifest(older)?.releaseId, 'the previous pin');
    assert.equal(inspectCompanySchema(old.ws).databaseVersion, 21, 'the live Company was never migrated');
    assert.equal(businessData(olderStorage, old.ws), old.data, 'original data preserved');
    assert.ok(journals(old.ws).some((id) => journal(old.ws, id).state === 'UPDATE_HOLD' && journal(old.ws, id).code.startsWith('REHEARSAL_')));
    const held = await discoverHost(old.ws);
    assert.equal(held.state, 'HELD', 'the hold stays until the operator clears it');
    assert.equal(held.leaseLive, false, 'no host was started on a held Company');
  });

  test('a failure AFTER the migration is never a rollback: RECOVERY_HOLD, pin kept, snapshot kept, nothing discarded', async () => {
    // A release whose host migrates the Company (inside its runtime start) and then dies before it reports READY.
    const dying = variant(next, 'dying', (d) => edit(path.join(pkg(d, 'command-center'), 'dist', 'src', 'cli.js'), 'await surface.start();', 'await surface.start(); process.exit(9);'));
    const old = await olderCompany('after-migration', true);
    const r = await activateRelease(old.ws, dying, { providers: [], shortcuts: false });
    assert.notEqual(r.outcome, 'ROLLED_BACK', 'never reported as a successful rollback');
    assert.equal(r.outcome, 'RECOVERY_HOLD', JSON.stringify(r));
    assert.equal(r.steps.find((s) => s.step === 'SCHEMA')?.result, '21->22');
    assert.equal(r.steps.find((s) => s.step === 'ROLLBACK_PIN')?.result, 'KEPT_SCHEMA_MIGRATED');
    assert.equal(r.steps.at(-1)?.result, 'SCHEMA_MIGRATED');
    assert.equal(readReleasePin(old.ws)?.releaseId, readReleaseManifest(dying)?.releaseId, 'the only release that can open the migrated Company');
    assert.equal(readReleasePin(old.ws)?.previous?.releaseId, readReleaseManifest(older)?.releaseId);
    assert.equal(inspectCompanySchema(old.ws).databaseVersion, 22);
    const [update] = journals(old.ws);
    assert.equal(journal(old.ws, update ?? '').state, 'ACTIVATED');
    assert.ok(existsSync(path.join(old.ws, 'maintenance', update ?? '', 'pre-update.sqlite3')), 'the pre-update snapshot is kept for a Founder-approved rollback-update');
    assert.equal(businessData(currentStorage, old.ws), old.data, 'nothing discarded');
    // The truth behind the outcome: the previous release cannot open the migrated Company.
    assert.equal((await runCli(releaseCli(older), ['release-check', '--workspace', old.ws])).json.schema, 'SCHEMA_FROM_FUTURE');
    const s = await discoverHost(old.ws);
    assert.notEqual(s.state, 'RUNNING');
    assert.ok(s.pid === null || !pidAlive(s.pid), 'no host process left running the Company');
  });
});
