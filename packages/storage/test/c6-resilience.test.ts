/**
 * C6 resilience proofs (Stage 15): the encrypted portable package round-trips through an isolated external
 * destination, fails closed when tampered with or opened with the wrong recovery passphrase, restores a clean
 * environment with identities / work / evaluation / learning / audit lineage and artifacts, revokes the lost
 * device's Founder sessions; retention keeps generations (never only the latest, never none); restore drills
 * are recorded; a schema update is rehearsed, verified, activated — or rolled back into UPDATE_HOLD.
 * C6-PROOF: storage-resilience
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { isQandeelError, newId, sha256Hex, type Id } from '@qandeel-company/domain';
import { standardWorkOutcomeDefinition } from '@qandeel-company/mind';

import {
  ArtifactStore,
  AttentionStore,
  CURRENT_SCHEMA_VERSION,
  CompanyStore,
  DirectoryDestination,
  FounderAuthStore,
  GovernanceStore,
  ImprovementStore,
  clearUpdateHold,
  createBackup,
  createPortableBackup,
  listBackups,
  loadReleasedMigrations,
  migrationChecksum,
  planRetention,
  pruneLocalBackups,
  readUpdateHold,
  resilienceStatus,
  restorePortableBackup,
  restoreStatus,
  rollbackSchemaUpdate,
  runRestoreDrill,
  safeUpgrade,
  verifyPortableBackup,
  type BackupDestination,
  type CleanRestoreReport,
} from '../src/index.js';
import { safeUpgradeInternal } from '../src/maintenance.js';
import { restorePortableBackupInternal, type RestoreFaultPoint } from '../src/resilience.js';
import { recordToolIntent, recordToolResult, settle } from '../src/runtime-authority.js';
import { SqliteConnection } from '../src/sqlite/connection.js';
import { openRestoredStore, openStoreForTests } from '../src/store.js';
import { fixture, spawnScript } from './process-harness.js';
import { armFounderTestSurface } from '../src/testing/founder-seam.js';
import { claimGoverned, governedItem, hire, seed } from './c2-helpers.js';
import { backoff, harness, owner, removeRoot, tempRoot } from './helpers.js';

const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;
const refused = (c: string, reason: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c && e.details.reason === reason;

/** A destination whose volume differs from the workspace's — e.g. the second partition of the same NVMe disk (R2-28). */
function separateVolume(dir: string): BackupDestination {
  const d = new DirectoryDestination(dir);
  return { kind: d.kind, ref: d.ref, failureDomain: () => 'SEPARATE_VOLUME', put: (n, b) => d.put(n, b), get: (n) => d.get(n), exists: (n) => d.exists(n), remove: (n) => d.remove(n), list: () => d.list() };
}

/** An EXISTING Company (it has history) at an older released schema version. */
function oldCompany(root: string, version: number): void {
  const old = openStoreForTests(root, { migrations: loadReleasedMigrations(version) });
  try {
    old.recordAudit('seed.row', 'test', 'seed', 'OK', null);
  } finally {
    old.close();
  }
}
// Assembled at run time: no literal credential-shaped value is committed.
const PASSPHRASE = ['correct', 'horse', 'battery', 'staple', String(Date.now())].join('-');

function externalDir(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'qc-offdevice-')), 'external');
}

describe('C6 encrypted portable backup: sealed, verified, isolated', () => {
  test('C6-PROOF: the package round-trips through an external destination; tampering, the wrong passphrase and a destination inside the workspace all fail closed', async () => {
    const h = harness();
    const ext = externalDir();
    try {
      const s = seed(h.store);
      const m = ImprovementStore.for(h.store);
      const d = m.registerDefinition(s.founder, standardWorkOutcomeDefinition());
      m.activateDefinition(s.founder, d.id, m.calibrateDefinition(s.founder, d.id).id);
      assert.throws(() => new DirectoryDestination(path.join(h.root, 'backups', 'x')).failureDomain(h.root), code('UNSAFE_WORKSPACE'));
      const dest = new DirectoryDestination(ext);
      await assert.rejects(createPortableBackup(h.store, { destination: dest, passphrase: 'short' }), code('VALIDATION_FAILED'));
      const pkg = await createPortableBackup(h.store, { destination: dest, passphrase: PASSPHRASE });
      assert.equal(pkg.failureDomain, 'SAME_VOLUME', 'a disposable CI directory on the same volume is honestly NOT off-device');
      const bytes = dest.get(pkg.name);
      assert.equal(sha256Hex(bytes), pkg.packageSha256);
      assert.ok(!bytes.includes(Buffer.from('CREATE TABLE')), 'the database is encrypted inside the package');
      assert.ok(!bytes.includes(Buffer.from(PASSPHRASE)), 'the passphrase is never packaged');
      assert.deepEqual(verifyPortableBackup(h.store, pkg.packageId, dest, PASSPHRASE), { ok: true, code: 'PACKAGE_OPENED' });
      assert.equal(verifyPortableBackup(h.store, pkg.packageId, dest, `${PASSPHRASE}-wrong`).ok, false);
      // Tamper one byte in the ciphertext: authentication fails; nothing is restored.
      const tampered = Buffer.from(bytes);
      tampered[tampered.length - 40] = (tampered[tampered.length - 40] ?? 0) ^ 0xff;
      const target = tempRoot('tamper');
      assert.throws(() => restorePortableBackup(tampered, target, { passphrase: PASSPHRASE }), code('BACKUP_INTEGRITY'));
      assert.throws(() => restorePortableBackup(bytes, target, { passphrase: `${PASSPHRASE}-wrong` }), code('BACKUP_INTEGRITY'));
      removeRoot(target);
      // The status tells the truth: a package exists, but it is not proven off-device.
      const status = resilienceStatus(h.store);
      assert.equal(status.portableBackup?.offDevice, false);
      assert.ok(status.exceptions.some((x) => x.code === 'OFF_DEVICE_NOT_PROVEN' && x.material));
      const attested = new DirectoryDestination(externalDir(), { attestOffDevice: true });
      const offDevice = await createPortableBackup(h.store, { destination: attested, passphrase: PASSPHRASE });
      assert.equal(offDevice.failureDomain, 'ATTESTED_OFF_DEVICE');
      assert.equal(resilienceStatus(h.store).portableBackup?.withinOffDeviceRpo, true);
      // The recovery point is the age of the data: re-verifying an old package never makes it fresh.
      h.clock.advance(200 * 3_600_000);
      assert.equal(verifyPortableBackup(h.store, offDevice.packageId, attested, PASSPHRASE).ok, true);
      const aged = resilienceStatus(h.store);
      assert.equal(aged.portableBackup?.withinOffDeviceRpo, false);
      assert.ok(aged.exceptions.some((x) => x.code === 'OFF_DEVICE_BACKUP_STALE' && x.material));
    } finally {
      h.close();
      rmSync(path.dirname(ext), { recursive: true, force: true });
    }
  });

  test('C6-PROOF: a second partition of the same disk is not off-device — only an operator-attested destination meets the off-device objective (R2-28)', async () => {
    const h = harness();
    const dirs = [externalDir(), externalDir(), externalDir()];
    try {
      seed(h.store);
      const [a, b, c] = dirs as [string, string, string];
      const separate = await createPortableBackup(h.store, { destination: separateVolume(a), passphrase: PASSPHRASE });
      assert.equal(separate.failureDomain, 'SEPARATE_VOLUME', 'the volume is recorded honestly');
      assert.equal(separate.offDevice, false, 'a different volume id is not proof of a different device');
      const status = resilienceStatus(h.store);
      assert.equal(status.portableBackup?.offDevice, false, 'the copy dies with the laptop: the off-device objective is NOT met');
      assert.equal(status.portableBackup?.withinOffDeviceRpo, false);
      assert.ok(status.exceptions.some((x) => x.code === 'OFF_DEVICE_NOT_PROVEN' && x.material && x.ref === `portable_backup:${separate.packageId}`));
      h.clock.advance(60_000);
      const attested = await createPortableBackup(h.store, { destination: new DirectoryDestination(b, { attestOffDevice: true }), passphrase: PASSPHRASE });
      assert.equal(attested.offDevice, true);
      h.clock.advance(60_000);
      await createPortableBackup(h.store, { destination: separateVolume(c), passphrase: PASSPHRASE });
      const after = resilienceStatus(h.store);
      assert.equal(after.portableBackup?.id, attested.packageId, 'the newest ATTESTED package is the off-device recovery point, not a newer separate-volume one');
      assert.equal(after.portableBackup?.offDevice, true);
      assert.ok(!after.exceptions.some((x) => x.code === 'OFF_DEVICE_NOT_PROVEN'));
    } finally {
      h.close();
      for (const d of dirs) rmSync(path.dirname(d), { recursive: true, force: true });
    }
  });

  test('C6-PROOF: a malformed portable header fails closed as BACKUP_INTEGRITY before any key derivation (m-24)', () => {
    const target = tempRoot('bad-header');
    try {
      const headers = [
        { format: 'qandeel-company-portable/1', cipher: 'aes-256-gcm', ivHex: '0'.repeat(24) },
        { format: 'qandeel-company-portable/1', cipher: 'aes-256-gcm', ivHex: '0'.repeat(24), packageId: 'p', backupId: 'b', createdAt: '2026-01-01T00:00:00.000Z', schemaVersion: 10, kdf: null },
        { format: 'qandeel-company-portable/1', cipher: 'aes-256-gcm', ivHex: '0'.repeat(24), packageId: 'p', backupId: 'b', createdAt: '2026-01-01T00:00:00.000Z', schemaVersion: 10, kdf: { name: 'scrypt', N: '32768', r: 8, p: 1, saltHex: 7 } },
      ];
      for (const header of headers) {
        const bytes = Buffer.concat([Buffer.from('QCPKG1\n', 'ascii'), Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'), Buffer.alloc(64)]);
        assert.throws(() => restorePortableBackup(bytes, target, { passphrase: PASSPHRASE }), code('BACKUP_INTEGRITY'));
      }
    } finally {
      removeRoot(target);
    }
  });

  test('C6-PROOF: a clean-environment restore preserves identities, work, evaluation and audit lineage, restores artifact objects, records its drill, and never overwrites an existing company (sessions: C6 acceptance)', async () => {
    const h = harness();
    const ext = externalDir();
    const target = tempRoot('clean-device');
    try {
      const s = seed(h.store);
      const m = ImprovementStore.for(h.store);
      const d = m.registerDefinition(s.founder, standardWorkOutcomeDefinition());
      m.activateDefinition(s.founder, d.id, m.calibrateDefinition(s.founder, d.id).id);
      const { workItem } = h.store.createWorkItem({ objective: 'restored work', ownerRef: s.employee.ref });
      const artifact = new ArtifactStore(h.store).put({ content: 'تقرير الاستعادة: النسخة المحمولة', mediaType: 'text/plain', workItemId: workItem.id });
      const pkg = await createPortableBackup(h.store, { destination: new DirectoryDestination(ext), passphrase: PASSPHRASE });
      const report = restorePortableBackup(new DirectoryDestination(ext).get(pkg.name), target, { passphrase: PASSPHRASE, clock: h.clock });
      assert.equal(report.quickCheck, 'ok');
      assert.equal(report.schemaVersionAfter, report.schemaVersionBefore);
      const restored = CompanyStore.open(target, { clock: h.clock });
      try {
        assert.equal(restored.getWorkItem(workItem.id).objective, 'restored work');
        assert.equal(new ArtifactStore(restored).read(artifact.id).toString('utf8'), 'تقرير الاستعادة: النسخة المحمولة', 'artifact objects travel inside the package');
        assert.equal(report.artifactsRestored, 1);
        const rm = ImprovementStore.for(restored);
        assert.deepEqual(rm.definitions().map((x) => [x.code, x.status]), [['work-outcome.standard', 'ACTIVE']]);
        assert.equal(restored.audit(d.id).length, h.store.audit(d.id).length, 'audit lineage survives');
        assert.ok(restored.auditByAction('recovery.clean_restore').length === 1);
        assert.equal(resilienceStatus(restored).lastDrills.find((x) => x.kind === 'PORTABLE_RESTORE')?.result, 'PASS');
      } finally {
        restored.close();
      }
      assert.throws(() => restorePortableBackup(new DirectoryDestination(ext).get(pkg.name), target, { passphrase: PASSPHRASE }), code('UNSAFE_WORKSPACE'), 'never over an existing company');
    } finally {
      h.close();
      removeRoot(target);
      rmSync(path.dirname(ext), { recursive: true, force: true });
    }
  });
});

describe('C6 recovery never repeats an uncertain external effect; a substituted package is detected', () => {
  test('C6-PROOF: after a clean restore, an uncertain UNSAFE tool effect is still held for reconciliation (never released for retry)', async () => {
    const h = harness();
    const ext = externalDir();
    const target = tempRoot('uncertain');
    try {
      const s = seed(h.store);
      const tool = s.gov.registerTool(s.founder, { code: 'syncer', driverCode: 'fake-syncer', egress: 'NONE' });
      s.gov.registerToolAction(s.founder, { toolId: tool.id, code: 'sync', risk: 'R1', sideEffects: 'UNSAFE', mutatesExternal: false, dataClassCeiling: 'D3', argsSchema: { fields: {} }, costPerCallMicros: 100 });
      s.gov.grant(s.founder, { employeeId: s.employee.id, capability: 'tool:syncer.sync', riskCeiling: 'R1', dataClassCeiling: 'D3', reasonCode: 'seed' });
      const wi = governedItem(h, s);
      const { claim } = claimGoverned(h);
      const intent = recordToolIntent(h.store, claim.fence, { toolCode: 'syncer', actionCode: 'sync', args: {}, idempotencyKey: `wi:${wi}:s0` });
      if (intent.kind !== 'EXECUTE') throw new Error(intent.kind);
      assert.equal(recordToolResult(h.store, claim.fence, intent.invocationId, { ok: false, code: 'DRIVER_OUTCOME_UNKNOWN', sent: 'UNKNOWN' }), 'RECONCILIATION_REQUIRED');
      settle(h.store, claim.fence, { type: 'RECONCILIATION_REQUIRED', code: 'TOOL_OUTCOME_UNCERTAIN' }, { backoff });
      const pkg = await createPortableBackup(h.store, { destination: new DirectoryDestination(ext), passphrase: PASSPHRASE });
      const report = restorePortableBackup(new DirectoryDestination(ext).get(pkg.name), target, { passphrase: PASSPHRASE, clock: h.clock });
      assert.equal(report.reconciliationPending.toolInvocationsUncertain, 1);
      assert.equal(report.reconciliationPending.jobsHeld, 1);
      const restored = CompanyStore.open(target, { clock: h.clock });
      try {
        assert.equal(restored.getJob(claim.fence.jobId).state, 'RECONCILIATION_HOLD', 'the restored Company does not blindly repeat the uncertain effect');
        assert.equal(GovernanceStore.for(restored).toolInvocations(wi).find((i) => i.id === intent.invocationId)?.state, 'RECONCILIATION_REQUIRED');
      } finally {
        restored.close();
      }
    } finally {
      h.close();
      removeRoot(target);
      rmSync(path.dirname(ext), { recursive: true, force: true });
    }
  });

  test('C6-PROOF: a clean restore is an ambiguity boundary — every live job that could reach an external effect is held for reconciliation, effect-free work is not, and the report lists the holds and the data age (R2-29, m-25)', async () => {
    const h = harness();
    const ext = externalDir();
    const target = tempRoot('past-backup-point');
    try {
      const s = seed(h.store); // the seeded Employee holds grants on UNSAFE / external-mutating tool actions
      // Claimed without any tool intent at the backup point (the lost device may have run it to completion afterwards).
      const claimedItem = governedItem(h, s);
      const { claim } = claimGoverned(h);
      assert.equal(h.store.getJob(claim.fence.jobId).workItemId, claimedItem);
      const queuedItem = governedItem(h, s);
      // Effect-free: an Employee whose only tool grant is a side-effect-free read, and plain C1 deterministic work.
      const reader = hire(s.gov, s.founder, s.departmentId);
      s.gov.createBudget(s.founder, { scope: 'EMPLOYEE', scopeId: reader.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'seed' });
      s.gov.grant(s.founder, { employeeId: reader.id, capability: 'tool:notes.read', riskCeiling: 'R0', dataClassCeiling: 'D3', reasonCode: 'seed' });
      const readerItem = governedItem(h, s, reader);
      const noop = h.store.createWorkItem({ objective: 'deterministic work', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY' }).workItem.id;
      const job = (id: string): string => String(h.store.jobsFor(id as never).at(-1)?.id);
      const pkgAt = h.store.now();
      const pkg = await createPortableBackup(h.store, { destination: new DirectoryDestination(ext), passphrase: PASSPHRASE });
      h.clock.advance(5 * 3_600_000);
      const report = restorePortableBackup(new DirectoryDestination(ext).get(pkg.name), target, { passphrase: PASSPHRASE, clock: h.clock });
      assert.deepEqual([...report.reconciliationPending.heldJobIds].sort(), [claim.fence.jobId, job(queuedItem)].sort(), 'exactly the effect-capable live jobs are held (IDs only)');
      assert.equal(report.reconciliationPending.heldByRestore, 2);
      assert.equal(report.reconciliationPending.jobsHeld, 2, 'the count is of actual holds');
      assert.deepEqual(report.backupPoint, { packageCreatedAt: pkgAt, dataAgeHours: 5 }, 'the authenticated backup point and data age are disclosed');
      armFounderTestSurface(target);
      const restored = CompanyStore.open(target, { clock: h.clock });
      try {
        for (const id of [claim.fence.jobId, job(queuedItem)]) {
          const j = restored.getJob(id as never);
          assert.equal(j.state, 'RECONCILIATION_HOLD', 'never dispatched blindly on the replacement device');
          assert.equal(j.lastFailureCode, 'RESTORED_PAST_BACKUP_POINT');
        }
        assert.equal(restored.getWorkItem(queuedItem).state, 'BLOCKED');
        assert.ok(restored.getJob(claim.fence.jobId).fencingToken > claim.fence.fencingToken, 'the lost worker is fenced out');
        assert.equal(restored.runsFor(claim.fence.jobId).at(-1)?.state, 'INTERRUPTED', 'the orphaned run is closed, never resumed');
        assert.equal(restored.getJob(job(readerItem) as never).state, 'QUEUED', 'effect-free governed work is not held');
        assert.equal(restored.getJob(job(noop) as never).state, 'QUEUED', 'effect-free C1 work is not held');
        assert.equal(restored.auditByAction('job.reconciliation_required').length, 2);
        // R2 integration (R2-29 × R2-21 / R2-22): a job held before it ever ran has no attributed run, yet it is an
        // Employee's work — it reaches Founder Attention and is the Founder's decision, never the C1 operator's.
        const surfaced = (AttentionStore.for(restored).sync(), AttentionStore.for(restored).list({ state: 'OPEN' }).map((i) => i.sourceRef));
        for (const id of [claim.fence.jobId, job(queuedItem)]) assert.ok(surfaced.includes(`queue_job:${id}`), `the restore hold ${id} reaches Founder Attention`);
        assert.throws(() => restored.resolveReconciliation(job(queuedItem) as never, 'RETRY', 'LOST_DEVICE_REVIEWED', 'operator:cli'), (e: unknown) => isQandeelError(e), 'a never-run Employee job is not decided through the operator entry point');
        assert.equal(restored.getJob(job(queuedItem) as never).state, 'RECONCILIATION_HOLD');
        // Resolvable per job through the existing reconciliation path (governed work through Founder authority).
        assert.equal(restored.resolveReconciliation(claim.fence.jobId as never, 'FAILED', 'LOST_DEVICE_REVIEWED', s.founder).jobState, 'FAILED');
        assert.equal(restored.resolveReconciliation(job(queuedItem) as never, 'RETRY', 'LOST_DEVICE_REVIEWED', s.founder).jobState, 'QUEUED');
      } finally {
        restored.close();
      }
    } finally {
      h.close();
      removeRoot(target);
      rmSync(path.dirname(ext), { recursive: true, force: true });
    }
  });

  test('C6-PROOF: a package substituted at the destination (authentic, but not the recorded one) fails re-verification', async () => {
    const h = harness();
    const ext = externalDir();
    try {
      seed(h.store);
      const dest = new DirectoryDestination(ext);
      const a = await createPortableBackup(h.store, { destination: dest, passphrase: PASSPHRASE });
      h.clock.advance(60_000);
      const b = await createPortableBackup(h.store, { destination: dest, passphrase: PASSPHRASE });
      const bytesB = dest.get(b.name);
      dest.remove(a.name);
      dest.put(a.name, bytesB);
      assert.deepEqual(verifyPortableBackup(h.store, a.packageId, dest, PASSPHRASE), { ok: false, code: 'BACKUP_INTEGRITY' });
      assert.equal(verifyPortableBackup(h.store, b.packageId, dest, PASSPHRASE).ok, true);
    } finally {
      h.close();
      rmSync(path.dirname(ext), { recursive: true, force: true });
    }
  });
});

describe('C6 generational retention and restore drills', () => {
  test('C6-PROOF: retention keeps several generations — never only the latest, never none — and discovery follows the records', async () => {
    const h = harness();
    try {
      seed(h.store);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        h.clock.advance(3_600_000);
        ids.push((await createBackup(h.store)).backupId);
      }
      const plan = planRetention(ids.map((id, i) => ({ id, createdAt: new Date(Date.UTC(2026, 8, 1 + i * 8)).toISOString() })), { keepLast: 2, daily: 3, weekly: 0, monthly: 0 });
      assert.ok(plan.keep.length >= 3 && plan.keep.length < 5);
      assert.throws(() => planRetention([], { keepLast: 0, daily: 0, weekly: 0, monthly: 0 }), code('VALIDATION_FAILED'));
      const out = pruneLocalBackups(h.store, { keepLast: 2, daily: 0, weekly: 0, monthly: 0 });
      assert.equal(out.kept.length, 2);
      assert.equal(out.retired.length, 3);
      assert.deepEqual(listBackups(h.store).sort(), [...out.kept].sort(), 'a retired generation is no longer canonical');
      assert.equal(resilienceStatus(h.store).localBackup?.liveGenerations, 2);
      const drill = runRestoreDrill(h.store);
      assert.equal(drill.result, 'PASS');
      assert.equal(resilienceStatus(h.store).lastDrills.find((x) => x.kind === 'ISOLATED_RESTORE')?.result, 'PASS');
    } finally {
      h.close();
    }
  });

  test('C6-PROOF: status and retention count only restorable generations — a record whose files are gone is never the recovery point (m-23)', async () => {
    const h = harness();
    try {
      seed(h.store);
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        h.clock.advance(3_600_000);
        ids.push((await createBackup(h.store)).backupId);
      }
      const [, second, newest] = ids as [string, string, string];
      rmSync(path.join(h.store.workspace.backupsDir, newest), { recursive: true, force: true });
      const status = resilienceStatus(h.store);
      assert.equal(status.localBackup?.id, second, 'the newest RESTORABLE generation is the local recovery point');
      assert.equal(status.localBackup?.liveGenerations, 2);
      assert.ok(status.exceptions.some((x) => x.code === 'BACKUP_FILES_MISSING' && x.ref === `backup:${newest}`));
      const out = pruneLocalBackups(h.store, { keepLast: 1, daily: 0, weekly: 0, monthly: 0 });
      assert.deepEqual(out.kept, [second], 'retention keeps a restorable generation, never a lost one in its place');
    } finally {
      h.close();
    }
  });
});

describe('C6 update / migration safety', () => {
  test('C6-PROOF: a real schema update is snapshotted, rehearsed, verified and activated; a running Company is refused', async () => {
    const root = tempRoot('upgrade');
    try {
      const old = openStoreForTests(root, { migrations: loadReleasedMigrations(9) });
      assert.equal(old.schemaVersion, 9);
      old.recordAudit('seed.row', 'test', 'seed', 'OK', null);
      old.close();
      const report = await safeUpgradeInternal(root, {}, {});
      assert.equal(report.outcome, 'ACTIVATED');
      assert.deepEqual([report.fromVersion, report.toVersion], [9, loadReleasedMigrations().length]);
      const s = CompanyStore.open(root);
      try {
        assert.equal(s.schemaVersion, loadReleasedMigrations().length);
        assert.equal(s.auditByAction('maintenance.schema_update').length, 1);
        assert.equal(s.auditByAction('seed.row').length, 1, 'no row lost');
      } finally {
        s.close();
      }
      assert.equal((await safeUpgradeInternal(root, {}, {})).outcome, 'UP_TO_DATE');
    } finally {
      removeRoot(root);
    }
    const h = harness();
    try {
      const extra = 'CREATE TABLE c6_upgrade_probe (id INTEGER PRIMARY KEY) STRICT;\n';
      const migrations = [...loadReleasedMigrations(), { version: loadReleasedMigrations().length + 1, name: 'probe', sql: extra, sha256: migrationChecksum(extra) }];
      await assert.rejects(safeUpgradeInternal(h.root, {}, { migrations }), (e: unknown) => isQandeelError(e) && e.code === 'MAINTENANCE_REFUSED');
    } finally {
      h.close();
    }
  });

  test('C6-PROOF: a failed update never cascades — the live database is restored from the compatible snapshot and the workspace is held until the operator clears it', async () => {
    const root = tempRoot('update-hold');
    try {
      const s = CompanyStore.open(root);
      s.recordAudit('seed.row', 'test', 'seed', 'OK', null);
      s.close();
      const extra = 'CREATE TABLE c6_upgrade_probe (id INTEGER PRIMARY KEY) STRICT;\n';
      const migrations = [...loadReleasedMigrations(), { version: loadReleasedMigrations().length + 1, name: 'probe', sql: extra, sha256: migrationChecksum(extra) }];
      // Rehearsal failure: the live database is never touched.
      const rehearsal = await safeUpgradeInternal(root, {}, { migrations, failAt: 'rehearsal' });
      assert.equal(rehearsal.outcome, 'ROLLED_BACK_UPDATE_HOLD');
      assert.ok(readUpdateHold(root));
      assert.throws(() => CompanyStore.open(root), code('UPDATE_HOLD'), 'a held workspace is never reopened (so never re-migrated)');
      const inspection = CompanyStore.open(root, { migrationMode: 'verify' });
      inspection.close(); // read-only inspection (never migrates) still works while held
      await assert.rejects(safeUpgradeInternal(root, {}, { migrations }), code('UPDATE_HOLD'));
      assert.deepEqual(clearUpdateHold(root, 'operator.reviewed'), { cleared: true });
      // Live failure after migrating: restored from the snapshot, held again, the version is the compatible one.
      const live = await safeUpgradeInternal(root, {}, { migrations, failAt: 'live-verify' });
      assert.equal(live.outcome, 'ROLLED_BACK_UPDATE_HOLD');
      clearUpdateHold(root, 'operator.reviewed');
      const back = CompanyStore.open(root);
      try {
        assert.equal(back.schemaVersion, loadReleasedMigrations().length, 'no unsafe downgrade and no half-applied update: the compatible snapshot');
        assert.equal(back.auditByAction('seed.row').length, 1);
        const status = resilienceStatus(back);
        assert.equal(status.lastMaintenance?.outcome, 'ROLLED_BACK_UPDATE_HOLD');
        assert.ok(status.exceptions.some((x) => x.code === 'UPDATE_ROLLED_BACK'));
      } finally {
        back.close();
      }
    } finally {
      removeRoot(root);
    }
  });

  test('C6-PROOF: an existing Company is never migrated live at open — ordinary open refuses it (SCHEMA_UPDATE_REQUIRED) and a clean restore keeps an older snapshot at its own version until safe-upgrade (R2-30, m-25)', async () => {
    const root = tempRoot('no-live-migration');
    const ext = externalDir();
    const target = tempRoot('old-package');
    try {
      oldCompany(root, CURRENT_SCHEMA_VERSION - 1);
      assert.throws(() => CompanyStore.open(root), code('SCHEMA_UPDATE_REQUIRED'), 'no snapshot, no rehearsal, no record: refused');
      const still = openStoreForTests(root, { migrations: loadReleasedMigrations(CURRENT_SCHEMA_VERSION - 1) });
      try {
        assert.equal(still.schemaVersion, CURRENT_SCHEMA_VERSION - 1, 'the refused open changed nothing');
        // A portable package taken at the older version (the lost laptop ran the previous release).
        const pkg = await createPortableBackup(still, { destination: new DirectoryDestination(ext), passphrase: PASSPHRASE });
        const report = restorePortableBackup(new DirectoryDestination(ext).get(pkg.name), target, { passphrase: PASSPHRASE });
        assert.deepEqual([report.schemaVersionBefore, report.schemaVersionAfter, report.schemaUpdateRequired], [CURRENT_SCHEMA_VERSION - 1, CURRENT_SCHEMA_VERSION - 1, true], 'restored at its own version, never migrated through plain open');
      } finally {
        still.close();
      }
      assert.throws(() => CompanyStore.open(target), code('SCHEMA_UPDATE_REQUIRED'));
      const upgraded = await safeUpgrade(target);
      assert.equal(upgraded.outcome, 'ACTIVATED', 'the restored Company is brought current only through the lifecycle');
      const s = CompanyStore.open(target);
      try {
        assert.equal(s.schemaVersion, CURRENT_SCHEMA_VERSION);
        assert.equal(resilienceStatus(s).lastMaintenance?.outcome, 'ACTIVATED');
      } finally {
        s.close();
      }
    } finally {
      removeRoot(root);
      removeRoot(target);
      rmSync(path.dirname(ext), { recursive: true, force: true });
    }
  });

  test('C6-PROOF: an update is refused while another connection holds the database open, and a live failure writes the hold before the restore touches any file (m-22)', async () => {
    const root = tempRoot('in-use');
    try {
      oldCompany(root, CURRENT_SCHEMA_VERSION - 1);
      const databasePath = path.join(root, 'state', 'company.sqlite3');
      const other = SqliteConnection.open({ path: databasePath, busyTimeoutMs: 1_000 });
      try {
        other.get('SELECT COUNT(*) AS n FROM work_items');
        await assert.rejects(safeUpgradeInternal(root, {}, {}), refused('MAINTENANCE_REFUSED', 'DATABASE_IN_USE'));
      } finally {
        other.close();
      }
      assert.equal(readUpdateHold(root), null, 'a refused preflight writes nothing');
      // A connection that races in after the preflight (it opens while the pre-update snapshot is taken): on Windows the
      // restore cannot replace files another process holds open. Whatever the restore does, the hold is already in force.
      const pending = safeUpgradeInternal(root, {}, { failAt: 'live-verify' });
      const racer = SqliteConnection.open({ path: databasePath, busyTimeoutMs: 1_000 });
      let outcome: unknown;
      try {
        racer.get('SELECT COUNT(*) AS n FROM work_items');
        outcome = await pending.catch((e: unknown) => e);
      } finally {
        racer.close();
      }
      assert.ok(readUpdateHold(root), 'the workspace is held');
      if (process.platform === 'win32') assert.ok(isQandeelError(outcome, 'MAINTENANCE_FAILED') && outcome.details.reason === 'RESTORE_FAILED' && outcome.details.hold === true, 'a coded failure, hold kept');
      else assert.equal((outcome as { outcome?: string }).outcome, 'ROLLED_BACK_UPDATE_HOLD');
      assert.throws(() => CompanyStore.open(root), code('UPDATE_HOLD'), 'no ordinary open runs on a database in transition');
    } finally {
      removeRoot(root);
    }
  });

  test('C6-PROOF: a rollback never silently destroys post-activation work — refused unless acknowledged; the replaced database is retained and what was discarded is reported (R2-31)', async () => {
    const root = tempRoot('rollback');
    try {
      oldCompany(root, CURRENT_SCHEMA_VERSION - 1);
      const up = await safeUpgradeInternal(root, {}, {});
      assert.equal(up.outcome, 'ACTIVATED');
      const updateId = String(up.updateId);
      const s = CompanyStore.open(root);
      const postActivation = s.createWorkItem({ objective: 'work done after the update', ownerRef: owner }).workItem.id;
      s.close();
      await assert.rejects(rollbackSchemaUpdate(root, updateId), refused('MAINTENANCE_REFUSED', 'POST_UPDATE_WORK_EXISTS'));
      assert.equal(readUpdateHold(root), null, 'a refused rollback changes nothing');
      const intact = CompanyStore.open(root);
      assert.equal(intact.getWorkItem(postActivation).objective, 'work done after the update');
      intact.close();
      const rb = await rollbackSchemaUpdate(root, updateId, { discardPostUpdateWork: true });
      assert.equal(rb.discardAcknowledged, true);
      assert.equal(rb.postUpdateWork.exists, true);
      assert.equal(rb.postUpdateWork.rowsAddedAfterActivation.work_items, 1);
      assert.ok(rb.postUpdateWork.auditRowsAfterActivation >= 1);
      assert.ok(typeof rb.activatedAt === 'string');
      assert.equal(readUpdateHold(root)?.code, 'OPERATOR_ROLLBACK');
      const retained = path.join(root, 'maintenance', updateId, rb.preRollbackSnapshot.file);
      assert.equal(sha256Hex(readFileSync(retained)), rb.preRollbackSnapshot.sha256);
      const copy = SqliteConnection.open({ path: retained, busyTimeoutMs: 1_000, readOnly: true });
      try {
        assert.ok(copy.get('SELECT id FROM work_items WHERE id = ?', postActivation), 'the discarded work is retained in the pre-rollback snapshot');
        assert.ok(copy.get(`SELECT id FROM maintenance_records WHERE id = ?`, updateId), 'so is the maintenance record');
      } finally {
        copy.close();
      }
      // Clearing the hold never re-migrates at open: the next upgrade is rehearsed again through safe-upgrade.
      clearUpdateHold(root, 'operator.reviewed');
      assert.throws(() => CompanyStore.open(root), code('SCHEMA_UPDATE_REQUIRED'));
      const again = await safeUpgradeInternal(root, {}, {});
      assert.equal(again.outcome, 'ACTIVATED');
      assert.ok(existsSync(retained), 'a pre-rollback snapshot is never pruned');
      // Nothing after activation: no acknowledgement is needed, and nothing is reported as discarded.
      const quiet = await rollbackSchemaUpdate(root, String(again.updateId));
      assert.deepEqual([quiet.postUpdateWork.exists, quiet.discardAcknowledged], [false, false]);
    } finally {
      removeRoot(root);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// FB-2: a live portable restore is fail-closed from its first byte until the controlled restore commits.

const HELD_FOR_RESTORE = (e: unknown): boolean => isQandeelError(e, 'UPDATE_HOLD') && (e as { details: { code?: unknown } }).details.code === 'RESTORE_IN_PROGRESS';
const BINDING_REFUSED = (e: unknown): boolean => isQandeelError(e, 'UPDATE_HOLD') && (e as { details: { reason?: unknown } }).details.reason === 'RESTORE_BINDING_MISMATCH';

interface CrashWorld {
  readonly h: ReturnType<typeof harness>;
  readonly ext: string;
  readonly packageFile: string;
  readonly bytesA: Buffer;
  readonly bytesB: Buffer;
  readonly packageA: Id;
  readonly packageB: Id;
  readonly schemaVersion: number;
  readonly claimedJob: Id;
  readonly queuedJob: Id;
  readonly artifacts: readonly { readonly id: Id; readonly text: string }[];
}

describe('FB-2 a live portable restore is fail-closed from its first byte until the controlled restore commits', () => {
  let world: CrashWorld;
  const targets: string[] = [];
  const target = (label: string): string => {
    const t = tempRoot(label); // an Arabic workspace segment: every crash target is a non-ASCII Windows path
    targets.push(t);
    return t;
  };

  before(async () => {
    const h = harness();
    const s = seed(h.store); // the seeded Employee holds grants on UNSAFE / external-mutating tool actions
    governedItem(h, s);
    const { claim } = claimGoverned(h); // claimed at the backup point: the lost device may have run it afterwards
    const queuedItem = governedItem(h, s);
    const auth = FounderAuthStore.for(h.store);
    auth.redeemLaunchToken(auth.mintLaunchToken().token); // a live Founder session of the lost device
    auth.mintLaunchToken(); // and an unconsumed launch token
    const texts = ['مسودة الاستعادة الأولى', 'مسودة الاستعادة الثانية'];
    const artifacts = texts.map((text) => ({ id: new ArtifactStore(h.store).put({ content: text, mediaType: 'text/plain', workItemId: queuedItem }).id, text }));
    const ext = externalDir();
    const dest = new DirectoryDestination(ext);
    const a = await createPortableBackup(h.store, { destination: dest, passphrase: PASSPHRASE });
    h.clock.advance(60_000);
    const b = await createPortableBackup(h.store, { destination: dest, passphrase: PASSPHRASE });
    const bytesA = dest.get(a.name);
    const packageFile = path.join(path.dirname(ext), 'package-a.qcpkg');
    writeFileSync(packageFile, bytesA);
    process.env.QC_TEST_RECOVERY_PASSPHRASE = PASSPHRASE; // inherited by the crashing child, never on its command line
    world = { h, ext, packageFile, bytesA, bytesB: dest.get(b.name), packageA: a.packageId, packageB: b.packageId, schemaVersion: h.store.schemaVersion, claimedJob: claim.fence.jobId, queuedJob: h.store.jobsFor(queuedItem).at(-1)?.id as Id, artifacts };
  });

  after(() => {
    delete process.env.QC_TEST_RECOVERY_PASSPHRASE;
    world.h.close();
    rmSync(path.dirname(world.ext), { recursive: true, force: true });
    for (const t of targets) removeRoot(t);
  });

  /** Runs the restore in a child process that dies (a real exit, no catch / finally) at `point`. */
  async function crashAt(point: RestoreFaultPoint, root: string): Promise<void> {
    const child = spawnScript(fixture('restore-crasher'), [world.packageFile, root, point]);
    assert.equal(await child.exited(120_000), 77, `the child died at ${point} (stderr: ${child.stderr()})`);
  }

  /** Everything an operator (or a runtime) could do with the target is refused, and nothing changes it. */
  async function assertHeld(root: string, phase: string, completeDatabase: boolean): Promise<void> {
    assert.equal(readUpdateHold(root)?.code, 'RESTORE_IN_PROGRESS', 'the marker is in force');
    const status = restoreStatus(root);
    assert.deepEqual([status.blocked, status.markerReadable, status.restoreInProgress?.packageId, status.restoreInProgress?.phase], [true, true, world.packageA, phase], 'the marker tells the truth');
    const db = path.join(root, 'state', 'company.sqlite3');
    const bytesBefore = existsSync(db) ? sha256Hex(readFileSync(db)) : null;
    assert.throws(() => CompanyStore.open(root), HELD_FOR_RESTORE, 'ordinary (runtime / init) open refuses it');
    assert.throws(() => CompanyStore.open(root, { create: false, migrationMode: 'verify' }), HELD_FOR_RESTORE, 'read-only inspection refuses it too (the database may be partial)');
    await assert.rejects(safeUpgrade(root), HELD_FOR_RESTORE, 'never upgraded (the runtime start path)');
    await assert.rejects(rollbackSchemaUpdate(root, newId()), HELD_FOR_RESTORE, 'never rolled back');
    assert.throws(() => clearUpdateHold(root, 'operator.reviewed'), refused('MAINTENANCE_REFUSED', 'RESTORE_IN_PROGRESS'), 'the generic hold clearance refuses it');
    assert.equal(readUpdateHold(root)?.code, 'RESTORE_IN_PROGRESS', 'still held after every attempt');
    assert.equal(existsSync(db) ? sha256Hex(readFileSync(db)) : null, bytesBefore, 'no refused path touched the database');
    if (completeDatabase) assert.equal(readFileSync(db).readUInt32BE(60), world.schemaVersion, 'never silently migrated');
  }

  /** The finished restore: marker lifted to history, the controlled restore applied exactly once, startable. */
  function assertRestoredOnce(root: string, report: CleanRestoreReport, packageId: Id): void {
    assert.deepEqual([report.packageId, report.quickCheck, report.foundersSessionsRevoked], [packageId, 'ok', 1]);
    assert.deepEqual([...report.reconciliationPending.heldJobIds].sort(), [world.claimedJob, world.queuedJob].sort(), 'exactly the effect-capable live jobs are held');
    assert.equal(readUpdateHold(root), null, 'the marker is lifted');
    const status = restoreStatus(root);
    assert.equal(status.blocked, false);
    assert.ok(status.history.some((x) => x.outcome === 'COMPLETED' && x.attemptId === report.restoreAttemptId), 'the completed attempt is kept as history');
    assert.equal(report.restoreRecord, `RESTORE_IN_PROGRESS.completed-${report.restoreAttemptId}.json`);
    const store = CompanyStore.open(root);
    try {
      for (const id of [world.claimedJob, world.queuedJob]) {
        const j = store.getJob(id);
        assert.deepEqual([j.state, j.lastFailureCode], ['RECONCILIATION_HOLD', 'RESTORED_PAST_BACKUP_POINT'], 'no effect-capable job can be claimed');
      }
      const audit = store.auditByAction('recovery.clean_restore');
      assert.equal(audit.length, 1, 'the controlled restore is recorded exactly once');
      assert.deepEqual([audit[0]?.correlationId, audit[0]?.details.packageId, audit[0]?.details.restoreAttemptId], [report.restoreAttemptId, packageId, report.restoreAttemptId], 'the committed restore names its attempt and package');
      assert.deepEqual([store.quickCheck(), store.foreignKeyViolations()], ['ok', 0]);
      for (const a of world.artifacts) assert.equal(new ArtifactStore(store).read(a.id).toString('utf8'), a.text, 'artifact objects restored byte-exact');
    } finally {
      store.close();
    }
    const db = SqliteConnection.open({ path: path.join(root, 'state', 'company.sqlite3'), busyTimeoutMs: 5_000, readOnly: true });
    try {
      assert.equal(Number(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM founder_sessions WHERE revoked_at IS NULL')?.n), 0, 'the lost device sessions are revoked');
      assert.equal(Number(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM founder_launch_tokens WHERE consumed_at IS NULL')?.n), 0, 'and its launch tokens');
    } finally {
      db.close();
    }
    assert.throws(() => restorePortableBackup(world.bytesA, root, { passphrase: PASSPHRASE }), code('UNSAFE_WORKSPACE'), 'a finished restore is never re-applied');
  }

  const POINTS: readonly { point: RestoreFaultPoint; phase: string; completeDatabase: boolean; resume: 'REDONE' | 'FINALIZED' }[] = [
    { point: 'before-db-copy', phase: 'PREPARING', completeDatabase: false, resume: 'REDONE' },
    { point: 'mid-db-copy', phase: 'PREPARING', completeDatabase: false, resume: 'REDONE' },
    { point: 'after-db-copy', phase: 'PREPARING', completeDatabase: true, resume: 'REDONE' },
    { point: 'mid-artifacts', phase: 'PREPARING', completeDatabase: true, resume: 'REDONE' },
    { point: 'before-controlled-restore', phase: 'DATA_WRITTEN', completeDatabase: true, resume: 'REDONE' },
    { point: 'in-controlled-restore', phase: 'DATA_WRITTEN', completeDatabase: true, resume: 'REDONE' },
    { point: 'after-commit', phase: 'DATA_WRITTEN', completeDatabase: true, resume: 'FINALIZED' },
    { point: 'after-phase-committed', phase: 'COMMITTED', completeDatabase: true, resume: 'FINALIZED' },
  ];

  for (const c of POINTS) {
    test(`FB-2 C6-PROOF: a process death at ${c.point} leaves the target held (never an ordinary, startable Company); the same package then ${c.resume === 'FINALIZED' ? 'only finalizes the committed attempt' : 'redoes the interrupted attempt from the package'} — one controlled restore`, async () => {
      const root = target(`fb2-${c.point}`);
      await crashAt(c.point, root);
      if (c.point === 'before-db-copy') {
        assert.deepEqual(readdirSync(root), ['maintenance'], 'the marker exists before the first database byte');
      }
      if (c.point === 'mid-db-copy') {
        assert.ok(readFileSync(path.join(root, 'state', 'company.sqlite3')).length < world.bytesA.length, 'the database copy is partial');
      }
      await assertHeld(root, c.phase, c.completeDatabase);
      const crashed = restoreStatus(root).restoreInProgress?.attemptId as Id;
      const report = restorePortableBackup(world.bytesA, root, { passphrase: PASSPHRASE });
      assert.equal(report.restoreLifecycle, c.resume);
      if (c.resume === 'FINALIZED') assert.equal(report.restoreAttemptId, crashed, 'the committed attempt is recognised, not repeated');
      else {
        assert.notEqual(report.restoreAttemptId, crashed, 'an interrupted attempt is redone under a new attempt id');
        assert.ok(restoreStatus(root).history.some((x) => x.outcome === 'ABANDONED' && x.attemptId === crashed), 'the interrupted attempt is kept as history');
      }
      assertRestoredOnce(root, report, world.packageA);
      // A second finalize call can never re-apply it either: the target is now a Company.
    });
  }

  test('FB-2 C6-PROOF: a failure thrown inside the controlled-restore transaction rolls it back and leaves the target held; the retry redoes it (a committed row would have been finalized) — exactly one restore', async () => {
    const root = target('fb2-throw');
    assert.throws(
      () => restorePortableBackupInternal(world.bytesA, root, { passphrase: PASSPHRASE }, { fault: (p) => { if (p === 'in-controlled-restore') throw new Error('injected'); } }),
      /injected/,
    );
    await assertHeld(root, 'DATA_WRITTEN', true);
    const report = restorePortableBackup(world.bytesA, root, { passphrase: PASSPHRASE });
    assert.equal(report.restoreLifecycle, 'REDONE', 'nothing of the rolled-back transaction survived');
    assertRestoredOnce(root, report, world.packageA);
  });

  test('FB-2 C6-PROOF: the restore bypass is bound to the marker attempt AND package — no other open (internal, test-only or generic) passes the marker', async () => {
    const root = target('fb2-binding');
    await crashAt('after-db-copy', root);
    const m = restoreStatus(root).restoreInProgress;
    assert.ok(m);
    const v = world.schemaVersion;
    assert.throws(() => openRestoredStore(root, { atVersion: v, restoreAttempt: { attemptId: m.attemptId, packageId: newId() } }), BINDING_REFUSED, 'another package cannot use this attempt');
    assert.throws(() => openRestoredStore(root, { atVersion: v, restoreAttempt: { attemptId: newId(), packageId: m.packageId } }), BINDING_REFUSED, 'another attempt of the package cannot either');
    assert.throws(() => openRestoredStore(root, { atVersion: v }), HELD_FOR_RESTORE, 'an unbound internal open is refused');
    assert.throws(() => openStoreForTests(root, { liveSchemaUpdate: true }), HELD_FOR_RESTORE, 'a live-migrating open is refused');
    assert.throws(() => openRestoredStore(root, { atVersion: v, liveSchemaUpdate: true, restoreAttempt: { attemptId: m.attemptId, packageId: m.packageId } }), code('STORAGE_INVARIANT'), 'the binding never combines with a live migration');
    const own = openRestoredStore(root, { atVersion: v, restoreAttempt: { attemptId: m.attemptId, packageId: m.packageId } });
    own.close();
    await assertHeld(root, 'PREPARING', true);
    assertRestoredOnce(root, restorePortableBackup(world.bytesA, root, { passphrase: PASSPHRASE }), world.packageA);
  });

  test('FB-2 C6-PROOF: another package cannot hijack a partial restore; an explicit discard restarts it (history kept) and a torn / unreadable marker is only ever discarded explicitly', async () => {
    const root = target('fb2-hijack');
    await crashAt('mid-artifacts', root);
    const m = restoreStatus(root).restoreInProgress;
    assert.throws(() => restorePortableBackup(world.bytesB, root, { passphrase: PASSPHRASE }), refused('UNSAFE_WORKSPACE', 'restore-in-progress-other-package'), 'a different package is refused');
    assert.deepEqual(restoreStatus(root).restoreInProgress, m, 'the partial restore is untouched');
    await assertHeld(root, 'PREPARING', true);
    const report = restorePortableBackup(world.bytesB, root, { passphrase: PASSPHRASE, discardPartialRestore: true });
    assert.equal(report.restoreLifecycle, 'DISCARDED_AND_RESTARTED');
    assert.ok(restoreStatus(root).history.some((x) => x.outcome === 'DISCARDED' && x.attemptId === m?.attemptId), 'the discarded attempt is kept as history');
    assertRestoredOnce(root, report, world.packageB);

    // A RESTORE_IN_PROGRESS marker whose metadata cannot be read, and a torn first marker write: held, never guessed.
    for (const text of ['{"updateId":"x","code":"RESTORE_IN_PROGRESS","restore":{}}\n', '{"updateId":']) {
      const torn = target('fb2-torn');
      mkdirSync(path.join(torn, 'maintenance'), { recursive: true });
      writeFileSync(path.join(torn, 'maintenance', 'UPDATE_HOLD.json'), text);
      assert.throws(() => CompanyStore.open(torn), (e: unknown) => isQandeelError(e, 'UPDATE_HOLD'), 'held');
      if (text.includes('RESTORE_IN_PROGRESS')) assert.throws(() => clearUpdateHold(torn, 'operator.reviewed'), refused('MAINTENANCE_REFUSED', 'RESTORE_IN_PROGRESS'), 'never cleared generically');
      assert.throws(() => restorePortableBackup(world.bytesA, torn, { passphrase: PASSPHRASE }), (e: unknown) => isQandeelError(e, 'UPDATE_HOLD') || isQandeelError(e, 'UNSAFE_WORKSPACE'), 'no implicit restart');
      assertRestoredOnce(torn, restorePortableBackup(world.bytesA, torn, { passphrase: PASSPHRASE, discardPartialRestore: true }), world.packageA);
    }
  });
});