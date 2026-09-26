#!/usr/bin/env node
// C1 local acceptance harness — for the Founder-host review (and CI), runnable without editing source.
//
//   npm run c1:acceptance -- --workspace <disposable directory> [--keep]
//
// The directory must not exist yet, or be empty. The harness writes an ownership marker into it,
// creates the Company workspace in <dir>/company, and proves: workspace creation, SQLite WAL,
// migrations, the Work Item lifecycle, the atomic queue claim, crash/restart recovery (a real
// child process is killed without shutdown), artifact write/read/hash, online backup, isolated
// backup verification and restore dry start, and health/readiness. At the end it deletes only the
// directory it owns (the marker proves ownership) unless --keep is given.
//
// Safety: it refuses any location inside a Git working tree (so it can never touch a source
// checkout, including the QANDEEL App's), needs no credentials or provider keys, makes no network
// calls and uses no shell.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const MARKER = '.qandeel-c1-acceptance';
const SELF = fileURLToPath(import.meta.url);

const { values } = parseArgs({
  strict: true,
  options: { workspace: { type: 'string' }, keep: { type: 'boolean', default: false }, 'child-host': { type: 'string' } },
});

const { CompanyRuntime, DETERMINISTIC_PROCESSORS, runtimeHealth, inspectWorkspace } = await import('@qandeel-company/runtime');
const { ArtifactStore, CompanyStore, CURRENT_SCHEMA_VERSION, createBackup, verifyBackup, restoreToIsolatedWorkspace } = await import('@qandeel-company/storage');

// ------------------------------------------------------------------------------------------------
// Child mode: a runtime process that the parent kills without graceful shutdown.
if (values['child-host']) {
  // Internal mode: only ever <sandbox>/company of a sandbox this harness created (marker present).
  const childSandbox = path.resolve(values['child-host']);
  if (!existsSync(path.join(childSandbox, MARKER))) {
    console.error(JSON.stringify({ ok: false, verdict: 'REFUSED', message: 'child mode runs only inside a harness-owned sandbox' }));
    process.exit(2);
  }
  const runtime = new CompanyRuntime({ workspace: path.join(childSandbox, 'company'), processors: DETERMINISTIC_PROCESSORS, supervisorTtlMs: 2_000, storageFault: (p) => p === 'checkpoint.afterCommit' && process.stdout.write('CHECKPOINT\n') });
  await runtime.start();
  const { workItem } = runtime.submitWorkItem({ objective: 'acceptance crash probe', ownerRef: 'owner:founder', processorKind: 'c1.steps', processorInput: { steps: 8, stepMs: 200 }, initialState: 'READY' });
  process.stdout.write(`SUBMITTED ${workItem.id}\n`);
  await new Promise(() => undefined); // run until killed
}

// ------------------------------------------------------------------------------------------------

function refuse(message) {
  console.error(JSON.stringify({ ok: false, verdict: 'REFUSED', message }));
  process.exit(2);
}

if (!values.workspace) refuse('usage: npm run c1:acceptance -- --workspace <new or empty directory> [--keep]');
const sandbox = path.resolve(values.workspace);
for (let dir = sandbox; ; dir = path.dirname(dir)) {
  if (existsSync(path.join(dir, '.git'))) refuse('the acceptance directory must not be inside a Git working tree (source checkouts are never touched)');
  if (path.dirname(dir) === dir) break;
}
if (existsSync(sandbox) && readdirSync(sandbox).length > 0) refuse('the acceptance directory must not exist or must be empty');
const preExisting = existsSync(sandbox);
mkdirSync(sandbox, { recursive: true });
writeFileSync(path.join(sandbox, MARKER), 'created by the QANDEEL COMPANY C1 acceptance harness; safe to delete\n');

const company = path.join(sandbox, 'company');
const restoreTarget = path.join(sandbox, 'restore-check');
const results = [];
let failed = false;

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = (await fn()) ?? {};
    results.push({ step: name, result: 'PASS', ms: Date.now() - started, ...detail });
    console.log(JSON.stringify({ step: name, result: 'PASS', ms: Date.now() - started, ...detail }));
  } catch (error) {
    failed = true;
    results.push({ step: name, result: 'FAIL', code: error?.code ?? 'ERROR', message: String(error?.message ?? error) });
    console.log(JSON.stringify({ step: name, result: 'FAIL', code: error?.code ?? 'ERROR', message: String(error?.message ?? error) }));
  }
}

function check(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: 'ACCEPTANCE_CHECK' });
}

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw Object.assign(new Error(`timed out: ${label}`), { code: 'ACCEPTANCE_TIMEOUT' });
    await sleep(25);
  }
}

await step('workspace-wal-migrations', () => {
  const store = CompanyStore.open(company);
  try {
    check(store.journalMode === 'wal', 'journal mode is not WAL');
    check(store.schemaVersion === CURRENT_SCHEMA_VERSION, 'schema is not current');
    check(store.quickCheck() === 'ok', 'quick_check failed');
    for (const d of ['state', 'artifacts', 'backups', 'runtime']) check(existsSync(path.join(company, d)), `missing ${d}/`);
    return { schemaVersion: store.schemaVersion, journalMode: store.journalMode, migrationsApplied: store.migration.applied.length };
  } finally {
    store.close();
  }
});

let lifecycleItem;
await step('work-item-lifecycle-and-claim', async () => {
  const runtime = new CompanyRuntime({ workspace: company, processors: DETERMINISTIC_PROCESSORS, supervisorTtlMs: 2_000 });
  await runtime.start();
  try {
    check(runtimeHealth(runtime).readiness.ready, 'runtime not ready');
    const { workItem } = runtime.submitWorkItem({ objective: 'acceptance lifecycle', ownerRef: 'owner:founder', processorKind: 'c1.steps', processorInput: { steps: 3, stepMs: 10 }, initialState: 'READY' }, { idempotencyKey: 'acceptance-1' });
    const replay = runtime.submitWorkItem({ objective: 'acceptance lifecycle', ownerRef: 'owner:founder', processorKind: 'c1.steps', processorInput: { steps: 3, stepMs: 10 }, initialState: 'READY' }, { idempotencyKey: 'acceptance-1' });
    check(replay.replayed && replay.workItem.id === workItem.id, 'idempotent replay failed');
    await waitFor(() => runtime.store.getWorkItem(workItem.id).state === 'COMPLETED', 20_000, 'lifecycle completion');
    lifecycleItem = workItem.id;
    const history = runtime.store.history(workItem.id).map((t) => t.toState);
    check(JSON.stringify(history) === JSON.stringify(['READY', 'IN_PROGRESS', 'COMPLETED']), `unexpected history ${history}`);
    const [job] = runtime.store.jobsFor(workItem.id);
    check(job.fencingToken === 1 && runtime.store.runsFor(job.id).length === 1, 'claim/run bookkeeping');
    runtime.transitionWorkItem(workItem.id, { to: 'CLOSED', reasonCode: 'acceptance.closed' });
    return { workItemId: workItem.id, history: history.join('>') };
  } finally {
    await runtime.stop();
  }
});

await step('crash-restart-recovery', async () => {
  const child = spawn(process.execPath, [SELF, '--child-host', sandbox], { stdio: ['ignore', 'pipe', 'inherit'], shell: false, windowsHide: true });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (d) => (output += d));
  const exited = new Promise((resolve) => child.on('exit', resolve));
  await waitFor(() => (output.match(/CHECKPOINT/g) ?? []).length >= 2, 30_000, 'child checkpoints');
  const workItemId = /SUBMITTED ([0-9a-f-]{36})/.exec(output)?.[1];
  child.kill('SIGKILL'); // no graceful shutdown
  await exited;
  check(workItemId, 'child did not report its work item');
  const runtime = new CompanyRuntime({ workspace: company, processors: DETERMINISTIC_PROCESSORS, supervisorTtlMs: 2_000, acquireTimeoutMs: 20_000 });
  const recovery = await runtime.start();
  try {
    check(recovery.claimsRecovered === 1 && recovery.resumed === 1, `recovery summary ${JSON.stringify(recovery)}`);
    await waitFor(() => runtime.store.getWorkItem(workItemId).state === 'COMPLETED', 30_000, 'resumed completion');
    const runs = runtime.store.runsForWorkItem(workItemId).map((r) => r.state);
    check(JSON.stringify(runs) === JSON.stringify(['INTERRUPTED', 'SUCCEEDED']), `runs ${runs}`);
    check(runtime.store.history(workItemId).filter((t) => t.toState === 'COMPLETED').length === 1, 'duplicate completion');
    check(runtime.store.integrityCheck() === 'ok', 'integrity_check failed after crash');
    return { workItemId, runs: runs.join('>'), claimsRecovered: recovery.claimsRecovered };
  } finally {
    await runtime.stop();
  }
});

let backupDir;
await step('artifact-write-read-hash', () => {
  const store = CompanyStore.open(company);
  try {
    const artifacts = new ArtifactStore(store);
    const record = artifacts.put({ content: 'قنديل — C1 acceptance artifact', mediaType: 'text/plain', workItemId: lifecycleItem });
    check(record.state === 'READY', 'artifact not READY');
    check(artifacts.read(record.id).toString('utf8') === 'قنديل — C1 acceptance artifact', 'artifact round trip');
    const report = artifacts.verifyAll();
    check(report.corrupt === 0 && report.missing === 0, 'artifact verification');
    return { artifactId: record.id, sha256: record.sha256 };
  } finally {
    store.close();
  }
});

await step('online-backup-and-isolated-verification', async () => {
  const store = CompanyStore.open(company);
  try {
    const live = readFileSync(store.workspace.databasePath);
    const backup = await createBackup(store);
    backupDir = backup.directory;
    const expected = store.backupRecord(backup.backupId);
    check(expected, 'the live Company holds no record of its own backup');
    const verification = verifyBackup(backup.directory, { liveDatabasePath: store.workspace.databasePath, artifactObjectsDir: store.workspace.objectsDir, expected });
    check(verification.integrity === 'ok' && verification.artifactObjectsChecked >= 1, 'backup verification');
    const restored = restoreToIsolatedWorkspace(backup.directory, restoreTarget, { liveDatabasePath: store.workspace.databasePath, expected });
    check(restored.quickCheck === 'ok', 'isolated restore dry start');
    check(readFileSync(store.workspace.databasePath).length >= live.length, 'live database unexpectedly shrank');
    return { backupId: backup.backupId, schemaVersion: verification.schemaVersion, workItems: verification.counts.workItems };
  } finally {
    store.close();
  }
});

await step('health-readiness', async () => {
  const cold = inspectWorkspace(company);
  check(cold.readiness.checks.wal && cold.readiness.checks.migrations, 'cold inspection');
  check(!cold.liveness.alive, 'no runtime should be live now');
  const runtime = new CompanyRuntime({ workspace: company, processors: DETERMINISTIC_PROCESSORS, supervisorTtlMs: 2_000 });
  await runtime.start();
  try {
    const h = runtimeHealth(runtime);
    check(h.readiness.ready && h.status === 'HEALTHY', `health ${h.status} ${h.reasons}`);
    check(h.components.backup.lastBackupId !== null, 'last backup not reported');
    return { status: h.status, ready: h.readiness.ready };
  } finally {
    await runtime.stop();
  }
});

const verdict = failed ? 'C1 LOCAL ACCEPTANCE — FAIL' : 'C1 LOCAL ACCEPTANCE — PASS';
console.log(JSON.stringify({ verdict, steps: results.length, node: process.versions.node, platform: process.platform, sandbox: values.keep ? sandbox : '(removed)', backup: values.keep ? backupDir : undefined }));

if (!values.keep && existsSync(path.join(sandbox, MARKER))) {
  // Delete only what this harness created. A directory the caller supplied (empty) is kept; only
  // the entries the harness wrote inside it are removed.
  if (preExisting) {
    for (const entry of [MARKER, 'company', 'restore-check']) rmSync(path.join(sandbox, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } else {
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
process.exit(failed ? 1 : 0);
