/**
 * C6 resilience proofs (Stage 15): the encrypted portable package round-trips through an isolated external
 * destination, fails closed when tampered with or opened with the wrong recovery passphrase, restores a clean
 * environment with identities / work / evaluation / learning / audit lineage and artifacts, revokes the lost
 * device's Founder sessions; retention keeps generations (never only the latest, never none); restore drills
 * are recorded; a schema update is rehearsed, verified, activated — or rolled back into UPDATE_HOLD.
 * C6-PROOF: storage-resilience
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { isQandeelError, sha256Hex } from '@qandeel-company/domain';
import { standardWorkOutcomeDefinition } from '@qandeel-company/mind';

import {
  ArtifactStore,
  CompanyStore,
  DirectoryDestination,
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
  runRestoreDrill,
  verifyPortableBackup,
} from '../src/index.js';
import { safeUpgradeInternal } from '../src/maintenance.js';
import { recordToolIntent, recordToolResult, settle } from '../src/runtime-authority.js';
import { openStoreForTests } from '../src/store.js';
import { claimGoverned, governedItem, seed } from './c2-helpers.js';
import { backoff, harness, removeRoot, tempRoot } from './helpers.js';

const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;
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
      assert.deepEqual([report.fromVersion, report.toVersion], [9, 10]);
      const s = CompanyStore.open(root);
      try {
        assert.equal(s.schemaVersion, 10);
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
      const migrations = [...loadReleasedMigrations(), { version: 11, name: 'probe', sql: extra, sha256: migrationChecksum(extra) }];
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
      const migrations = [...loadReleasedMigrations(), { version: 11, name: 'probe', sql: extra, sha256: migrationChecksum(extra) }];
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
        assert.equal(back.schemaVersion, 10, 'no unsafe downgrade and no half-applied update: the compatible snapshot');
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
});
