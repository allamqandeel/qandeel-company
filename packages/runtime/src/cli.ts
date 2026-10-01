#!/usr/bin/env node
/**
 * qandeel-company — the C1 engineering CLI. Runs under the signed Node runtime; no shell, no
 * network listener, no service installation. Every command takes an explicit `--workspace`; no
 * Founder path is built in. Output is content-free JSON (IDs, states, counts, codes).
 *
 *   init            --workspace <dir>                      create/validate the workspace, migrate a NEW one (an existing
 *                                                          Company with pending migrations is refused: SCHEMA_UPDATE_REQUIRED
 *                                                          → safe-upgrade; `start` runs safe-upgrade automatically)
 *   start           --workspace <dir> [--concurrency <n>]  run the Runtime Supervisor until SIGINT/SIGTERM
 *   health          --workspace <dir>                      read-only health/readiness inspection
 *   submit          --workspace <dir> --kind <c1.noop|c1.steps> [--owner <kind:id>] [--steps <n>] [--step-ms <n>] [--idempotency-key <k>]
 *   cancel          --workspace <dir> --work-item <id> [--reason <CODE>]
 *   backup          --workspace <dir>                      online backup + isolated verification
 *   verify-backup   --workspace <dir> --backup <id>
 *   restore-check   --workspace <dir> --backup <id> --target <new empty dir>   isolated verification copy: permanently
 *                   held (RESTORE_CHECK_COPY) — never started, upgraded or cleared; a Company is restored live only
 *                   through restore-portable
 *   verify-artifacts --workspace <dir>                     re-hash every artifact object
 *
 * C2 read-only commands (content-free counts / IDs / codes):
 *   governance      --workspace <dir>                      governance health
 *   approvals       --workspace <dir>                      pending approvals (IDs, risk, action codes)
 *
 * C3 read-only commands (content-free counts / IDs / hashes / codes — never memory, knowledge,
 * skill or scenario text):
 *   mind            --workspace <dir>                      memory / knowledge / context / skills / academy health
 *   capability-gaps --workspace <dir>                      open capability gaps (work item, employee, missing codes)
 *   context-manifest --workspace <dir> --manifest <id>     one context manifest: selected / rejected IDs, versions, hashes
 *
 * C4 read-only commands (content-free: IDs, codes, states, counts — never staffing evidence, handoff
 * messages, reviewer instructions or rationale):
 *   organization    --workspace <dir>                      seats, holders, departments, executive queues, health
 *   reviews         --workspace <dir>                      review requests, conflicts, holds, Review Pool health
 *
 * C6 commands (content-free: IDs, codes, states, counts, checksums — never the recovery passphrase, which is
 * read from QANDEEL_RECOVERY_PASSPHRASE and used in memory only):
 *   improvement     --workspace <dir>                      evaluation / learning health and recovery status
 *   report          --workspace <dir> --cadence <DAILY|WEEKLY|MONTHLY>   generate (idempotently) and print typed claims
 *   portable-backup --workspace <dir> --destination <dir> [--attest-off-device]   encrypted package outside the workspace
 *                   (off-device ONLY when attested: a separate volume may be a partition of the same disk)
 *   restore-portable --workspace <new empty dir> --package <file> [--discard-partial-restore]   clean-environment restore
 *                   (runtime not started): reports the backup point and data age, holds effect-capable work for
 *                   reconciliation, and runs safe-upgrade when the package is from an older schema. The target is held
 *                   (RESTORE_IN_PROGRESS) from its first byte until the controlled restore commits; rerunning with the
 *                   same package resumes an interrupted restore (finalize or redo); another package needs
 *                   --discard-partial-restore
 *   restore-status  --workspace <dir>                      the target's hold and live-restore marker (phase, attempt,
 *                   package; never opens the database)
 *   restore-drill   --workspace <dir>                      isolated restore drill of the newest generation
 *   prune-backups   --workspace <dir> [--keep-last <n>] [--daily <n>] [--weekly <n>] [--monthly <n>]
 *   safe-upgrade    --workspace <dir>                      Preflight → Backup → Rehearse → Migrate → Verify → Activate
 *   clear-update-hold --workspace <dir> --reason <code>    operator acknowledgement of an UPDATE_HOLD (refused for a
 *                   restore-check verification copy and for a live restore in progress)
 *   rollback-update --workspace <dir> --update <id> [--discard-post-update-work]   restore a kept pre-update snapshot
 *                   (bounded period); refused when work was recorded after activation unless acknowledged; the
 *                   replaced live database is retained as a pre-rollback snapshot
 * C7-A read-only command (content-free: source ids, states, lanes, counts — never a record payload, a producer
 * payload or a user reference; there is no intake, register, activate or bind command on any CLI):
 *   external        --workspace <dir>                      external-outcome availability and governed source health
 * * There is deliberately no Founder write command (no register-founder, approve or reject): a
 * Founder reference typed on a command line is not authentication. Founder authority arrives with
 * the authenticated Founder surface (C5); until then R3 work stays WAITING_APPROVAL (D-C2-13).
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { assertCode, assertId, isQandeelError } from '@qandeel-company/domain';
import { readFileSync } from 'node:fs';

import {
  ArtifactStore,
  CapabilityStore,
  CompanyStore,
  DEFAULT_RETENTION,
  DirectoryDestination,
  ExternalEvidenceStore,
  GovernanceStore,
  ImprovementStore,
  MemoryStore,
  OrganizationStore,
  ReviewStore,
  clearUpdateHold,
  createBackup,
  createPortableBackup,
  pruneLocalBackups,
  resilienceStatus,
  restorePortableBackup,
  restoreStatus,
  restoreToIsolatedWorkspace,
  rollbackSchemaUpdate,
  runRestoreDrill,
  safeUpgrade,
  verifyBackup,
} from '@qandeel-company/storage';

import { c3HealthOf } from './c3/health.js';
import { DETERMINISTIC_PROCESSORS } from './deterministic-processors.js';
import { inspectWorkspace, runtimeHealth } from './health.js';
import { Logger, jsonLinesSink } from './logger.js';
import { CompanyRuntime, RUNTIME_VERSION } from './runtime.js';
import { notifyRuntime } from './wake.js';

const USAGE = 'usage: qandeel-company <init|start|health|submit|cancel|backup|verify-backup|restore-check|verify-artifacts|governance|approvals|mind|capability-gaps|context-manifest|organization|reviews|improvement|external|report|portable-backup|restore-portable|restore-status|restore-drill|prune-backups|safe-upgrade|clear-update-hold|rollback-update> --workspace <dir> [options]';

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
      manifest: { type: 'string' },
      cadence: { type: 'string' },
      destination: { type: 'string' },
      'attest-off-device': { type: 'boolean' },
      package: { type: 'string' },
      'keep-last': { type: 'string' },
      daily: { type: 'string' },
      weekly: { type: 'string' },
      monthly: { type: 'string' },
      update: { type: 'string' },
      'discard-post-update-work': { type: 'boolean' },
      'discard-partial-restore': { type: 'boolean' },
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
      // RR4-1: the target is a verification copy, never a Company; the output says so and names the only live path.
      out({ ok: true, command, backupId: r.backupId, schemaVersionAfter: r.schemaVersionAfter, quickCheck: r.quickCheck, counts: r.counts, restoreKind: 'VERIFICATION_COPY', startable: false, hold: r.hold, note: 'VERIFICATION_COPY: this target is permanently held (RESTORE_CHECK_COPY) and can never be started, upgraded or cleared; to restore a Company live use restore-portable (controlled restore: effect-capable work held for reconciliation, safe-upgrade)' });
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
    case 'governance': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        out({ ok: true, command, ...GovernanceStore.for(store).healthCounts() });
      } finally {
        store.close();
      }
      return;
    }
    case 'approvals': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const pending = GovernanceStore.for(store).listApprovals('PENDING').map((a) => ({ approvalId: a.id, risk: a.risk, action: a.action, workItemId: a.workItemId, subjectRef: a.subjectRef, requestedAt: a.createdAt }));
        out({ ok: true, command, pending });
      } finally {
        store.close();
      }
      return;
    }
    case 'mind': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        out({ ok: true, command, ...c3HealthOf(store) });
      } finally {
        store.close();
      }
      return;
    }
    case 'capability-gaps': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const open = CapabilityStore.for(store).gaps('OPEN').map((g) => ({ gapId: g.id, workItemId: g.workItemId, employeeId: g.employeeId, missing: g.missing.map((m) => m.code), createdAt: g.createdAt }));
        out({ ok: true, command, open });
      } finally {
        store.close();
      }
      return;
    }
    case 'context-manifest': {
      const id = assertId(values.manifest, 'manifest');
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const m = MemoryStore.for(store);
        out({ ok: true, command, manifest: m.manifest(id), entries: m.manifestEntries(id) });
      } finally {
        store.close();
      }
      return;
    }
    case 'organization': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const org = OrganizationStore.for(store);
        const seats = org.positions().map((p) => {
          const h = org.seatHolder(p.id);
          return { positionId: p.id, code: p.code, kind: p.kind, scope: p.scope, departmentId: p.departmentId, status: p.status, reportsToPositionId: p.reportsToPositionId, holderEmployeeId: h.holder?.employeeId ?? null, holderKind: h.holder?.kind ?? null };
        });
        out({ ok: true, command, departments: org.departments(), seats, queues: org.executiveQueues(), health: org.health() });
      } finally {
        store.close();
      }
      return;
    }
    case 'reviews': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const rv = ReviewStore.for(store);
        const live = rv.requests().filter((r) => ['OPEN', 'CONFLICT', 'ESCALATED'].includes(r.state)).map((r) => ({ requestId: r.id, kind: r.kind, workItemId: r.workItemId, subjectKind: r.subjectKind, risk: r.riskLevel, state: r.state, waitingReason: r.waitingReason }));
        out({ ok: true, command, live, conflicts: rv.conflicts('OPEN').map((c) => ({ conflictId: c.id, requestId: c.requestId, origin: c.origin })), holds: rv.holds().map((h) => ({ holdId: h.id, targetKind: h.targetKind, reasonCode: h.reasonCode })), health: rv.health() });
      } finally {
        store.close();
      }
      return;
    }
    case 'improvement': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const im = ImprovementStore.for(store);
        out({ ok: true, command, health: im.health(), systemic: im.systemicFindings().map((f) => ({ findingId: f.id, state: f.state, targetKind: f.targetKind, cause: f.cause, occurrences: f.occurrences })), resilience: resilienceStatus(store) });
      } finally {
        store.close();
      }
      return;
    }
    case 'external': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const ex = ExternalEvidenceStore.for(store);
        out({ ok: true, command, availability: ex.availability(), health: ex.health(), sources: ex.sources().map((x) => ({ sourceId: x.id, family: x.family, lane: x.lane, state: x.state, contractVersion: x.contract?.version ?? null })) });
      } finally {
        store.close();
      }
      return;
    }
    case 'report': {
      const cadence = values.cadence ?? 'DAILY';
      if (cadence !== 'DAILY' && cadence !== 'WEEKLY' && cadence !== 'MONTHLY') fail('USAGE', '--cadence must be DAILY, WEEKLY or MONTHLY', 2);
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const r = ImprovementStore.for(store).generateReport(cadence);
        out({ ok: true, command, reportId: r.report.id, changed: r.changed, period: { from: r.report.periodFrom, to: r.report.periodTo }, claims: r.report.claims });
      } finally {
        store.close();
      }
      return;
    }
    case 'portable-backup': {
      if (values.destination === undefined) fail('USAGE', '--destination <directory outside the workspace> is required', 2);
      const passphrase = process.env.QANDEEL_RECOVERY_PASSPHRASE;
      if (passphrase === undefined) fail('USAGE', 'set QANDEEL_RECOVERY_PASSPHRASE (the recovery passphrase is never taken from the command line)', 2);
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const r = await createPortableBackup(store, { destination: new DirectoryDestination(path.resolve(values.destination), { attestOffDevice: values['attest-off-device'] === true }), passphrase, runtimeVersion: RUNTIME_VERSION });
        // R2-28: a different volume may be a second partition of the same disk; only the operator's attestation counts.
        out({ ok: true, command, ...r, ...(r.offDevice ? {} : { offDeviceNote: 'NOT_OFF_DEVICE: this destination does not meet the off-device objective unless you attest it is outside this laptop (--attest-off-device); a separate volume may be a partition of the same disk' }) });
      } finally {
        store.close();
      }
      return;
    }
    case 'restore-portable': {
      if (values.package === undefined) fail('USAGE', '--package <file> is required (the target is --workspace, a new empty directory)', 2);
      const passphrase = process.env.QANDEEL_RECOVERY_PASSPHRASE;
      if (passphrase === undefined) fail('USAGE', 'set QANDEEL_RECOVERY_PASSPHRASE', 2);
      // FB-2: the same package resumes an interrupted restore (finalize a committed attempt, else redo it); another
      // package replaces a partial restore only when the operator says so explicitly.
      const r = restorePortableBackup(readFileSync(path.resolve(values.package)), workspace, { passphrase, discardPartialRestore: values['discard-partial-restore'] === true });
      // An older snapshot is restored at its own version (m-25): it is brought current only through safe-upgrade.
      const upgrade = r.schemaUpdateRequired ? await safeUpgrade(workspace, { runtimeVersion: RUNTIME_VERSION }) : null;
      out({ ok: true, command, restoreKind: 'CONTROLLED_LIVE_RESTORE', ...r, ...(upgrade ? { safeUpgrade: upgrade } : {}) });
      return;
    }
    case 'restore-drill': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        out({ ok: true, command, ...runRestoreDrill(store) });
      } finally {
        store.close();
      }
      return;
    }
    case 'prune-backups': {
      const policy = { keepLast: positiveInt(values['keep-last'], 'keep-last', DEFAULT_RETENTION.keepLast, 1000) || 1, daily: positiveInt(values.daily, 'daily', DEFAULT_RETENTION.daily, 1000), weekly: positiveInt(values.weekly, 'weekly', DEFAULT_RETENTION.weekly, 1000), monthly: positiveInt(values.monthly, 'monthly', DEFAULT_RETENTION.monthly, 1000) };
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        out({ ok: true, command, policy, ...pruneLocalBackups(store, policy) });
      } finally {
        store.close();
      }
      return;
    }
    case 'restore-status': {
      // Read-only and content-free; never opens the database (it may be partial while a live restore is in progress).
      out({ ok: true, command, ...restoreStatus(workspace) });
      return;
    }
    case 'safe-upgrade': {
      out({ ok: true, command, ...(await safeUpgrade(workspace, { runtimeVersion: RUNTIME_VERSION })) });
      return;
    }
    case 'clear-update-hold': {
      out({ ok: true, command, ...clearUpdateHold(workspace, assertCode(values.reason ?? '', 'reason').toLowerCase()) });
      return;
    }
    case 'rollback-update': {
      // R2-31: refused when work was recorded after activation unless the operator explicitly acknowledges discarding it.
      out({ ok: true, command, ...(await rollbackSchemaUpdate(workspace, assertId(values.update, 'update'), { discardPostUpdateWork: values['discard-post-update-work'] === true })) });
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
