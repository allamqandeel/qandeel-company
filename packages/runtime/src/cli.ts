#!/usr/bin/env node
/**
 * qandeel-company — the C1 engineering CLI. Runs under the signed Node runtime; no shell, no
 * network listener, no service installation. Every command takes an explicit `--workspace`; no
 * Founder path is built in. Output is content-free JSON (IDs, states, counts, codes).
 *
 *   init            --workspace <dir>                      create/validate the workspace, migrate
 *   start           --workspace <dir> [--concurrency <n>]  run the Runtime Supervisor until SIGINT/SIGTERM
 *   health          --workspace <dir>                      read-only health/readiness inspection
 *   submit          --workspace <dir> --kind <c1.noop|c1.steps> [--owner <kind:id>] [--steps <n>] [--step-ms <n>] [--idempotency-key <k>]
 *   cancel          --workspace <dir> --work-item <id> [--reason <CODE>]
 *   backup          --workspace <dir>                      online backup + isolated verification
 *   verify-backup   --workspace <dir> --backup <id>
 *   restore-check   --workspace <dir> --backup <id> --target <new empty dir>
 *   verify-artifacts --workspace <dir>                     re-hash every artifact object
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { assertCode, assertId, isQandeelError } from '@qandeel-company/domain';
import { ArtifactStore, CompanyStore, createBackup, restoreToIsolatedWorkspace, verifyBackup } from '@qandeel-company/storage';

import { DETERMINISTIC_PROCESSORS } from './deterministic-processors.js';
import { inspectWorkspace, runtimeHealth } from './health.js';
import { Logger, jsonLinesSink } from './logger.js';
import { CompanyRuntime, RUNTIME_VERSION } from './runtime.js';
import { notifyRuntime } from './wake.js';

const USAGE = 'usage: qandeel-company <init|start|health|submit|cancel|backup|verify-backup|restore-check|verify-artifacts> --workspace <dir> [options]';

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(code: string, message: string, exit = 1): never {
  process.stderr.write(`${JSON.stringify({ ok: false, code, message })}\n`);
  process.exit(exit);
}

function positiveInt(value: string | undefined, name: string, d: number, max: number): number {
  if (value === undefined) return d;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) fail('USAGE', `--${name} must be an integer in [0, ${max}]`, 2);
  return n;
}

export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    strict: true,
    options: {
      workspace: { type: 'string' },
      concurrency: { type: 'string' },
      kind: { type: 'string' },
      steps: { type: 'string' },
      'step-ms': { type: 'string' },
      'idempotency-key': { type: 'string' },
      'work-item': { type: 'string' },
      reason: { type: 'string' },
      backup: { type: 'string' },
      target: { type: 'string' },
      owner: { type: 'string' },
    },
  });
  if (command === undefined || values.workspace === undefined) fail('USAGE', USAGE, 2);
  const workspace = path.resolve(values.workspace);

  switch (command) {
    case 'init': {
      const store = CompanyStore.open(workspace, { runtimeVersion: RUNTIME_VERSION });
      out({ ok: true, command, schemaVersion: store.schemaVersion, applied: store.migration.applied, journalMode: store.journalMode });
      store.close();
      return;
    }
    case 'start': {
      const runtime = new CompanyRuntime({
        workspace,
        processors: DETERMINISTIC_PROCESSORS,
        concurrency: positiveInt(values.concurrency, 'concurrency', 2, 64) || 1,
        logger: new Logger(jsonLinesSink((line) => process.stdout.write(line))),
        onFailStop: (code) => {
          process.stderr.write(`${JSON.stringify({ ok: false, code, message: 'runtime fail-stopped; restart it to recover' })}\n`);
          process.exit(1);
        },
      });
      let stopping = false;
      const stop = (): void => {
        if (stopping) return;
        stopping = true;
        void runtime.stop().then(() => process.exit(0));
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      if (process.platform === 'win32') process.on('SIGBREAK', stop);
      await runtime.start();
      out({ ok: true, command, state: runtime.state, instanceId: runtime.instanceId, health: runtimeHealth(runtime).status });
      return; // the supervisor heartbeat keeps the process alive until a signal arrives
    }
    case 'health': {
      out(inspectWorkspace(workspace));
      return;
    }
    case 'submit': {
      const kind = values.kind ?? 'c1.noop';
      if (!DETERMINISTIC_PROCESSORS.some((p) => p.kind === kind)) fail('UNKNOWN_PROCESSOR', `--kind must be one of ${DETERMINISTIC_PROCESSORS.map((p) => p.kind).join(', ')}`, 2);
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const r = store.createWorkItem(
          {
            objective: `C1 deterministic ${kind} work`,
            // The accountable owner is explicit; the CLI never defaults it to the Founder.
            ownerRef: values.owner ?? 'owner:c1-cli-operator',
            processorKind: kind,
            processorInput: { steps: positiveInt(values.steps, 'steps', 3, 10_000), stepMs: positiveInt(values['step-ms'], 'step-ms', 0, 60_000) },
            initialState: 'READY',
          },
          values['idempotency-key'] === undefined ? {} : { idempotencyKey: values['idempotency-key'] },
        );
        notifyRuntime(workspace);
        out({ ok: true, command, workItemId: r.workItem.id, state: r.workItem.state, replayed: r.replayed, jobId: r.enqueuedJobId });
      } finally {
        store.close();
      }
      return;
    }
    case 'cancel': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const r = store.requestCancellation(assertId(values['work-item'], 'work-item'), { reasonCode: assertCode(values.reason ?? 'OPERATOR_CANCEL', 'reason') });
        notifyRuntime(workspace);
        out({ ok: true, command, terminated: r.terminated, requested: r.requested, retained: r.retained });
      } finally {
        store.close();
      }
      return;
    }
    case 'backup': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const r = await createBackup(store, { runtimeVersion: RUNTIME_VERSION });
        const v = verifyBackup(r.directory, { liveDatabasePath: store.workspace.databasePath, artifactObjectsDir: store.workspace.objectsDir, expected: { snapshotSha256: r.manifest.snapshot.sha256, manifestSha256: r.manifestSha256 } });
        out({ ok: true, command, backupId: r.backupId, schemaVersion: r.manifest.schemaVersion, snapshotSha256: r.manifest.snapshot.sha256, counts: r.manifest.counts, verified: v.ok });
      } finally {
        store.close();
      }
      return;
    }
    case 'verify-backup': {
      const id = assertId(values.backup, 'backup');
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      const { backupsDir, databasePath, objectsDir } = store.workspace;
      const expected = store.backupRecord(id);
      store.close();
      if (!expected) fail('BACKUP_INTEGRITY', 'this Company holds no record of that backup');
      const v = verifyBackup(path.join(backupsDir, id), { liveDatabasePath: databasePath, artifactObjectsDir: objectsDir, expected });
      out({ command, ...v });
      return;
    }
    case 'restore-check': {
      const id = assertId(values.backup, 'backup');
      if (values.target === undefined) fail('USAGE', '--target <new empty directory> is required', 2);
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      const { backupsDir, databasePath } = store.workspace;
      const expected = store.backupRecord(id);
      store.close();
      if (!expected) fail('BACKUP_INTEGRITY', 'this Company holds no record of that backup');
      const r = restoreToIsolatedWorkspace(path.join(backupsDir, id), path.resolve(values.target), { liveDatabasePath: databasePath, expected });
      out({ ok: true, command, backupId: r.backupId, schemaVersionAfter: r.schemaVersionAfter, quickCheck: r.quickCheck, counts: r.counts });
      return;
    }
    case 'verify-artifacts': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        out({ ok: true, command, ...new ArtifactStore(store).verifyAll() });
      } finally {
        store.close();
      }
      return;
    }
    default:
      fail('USAGE', USAGE, 2);
  }
}

// Compare real paths: argv[1] may be an npm .bin link to this file.
const invokedDirectly = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    if (isQandeelError(error)) fail(error.code, error.message);
    fail('UNCLASSIFIED_ERROR', 'command failed');
  });
}
