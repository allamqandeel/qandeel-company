import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isQandeelError } from '@qandeel-company/domain';
import { CompanyStore, DirectoryDestination, createPortableBackup } from '@qandeel-company/storage';
import { restorePortableBackupWithFaultForTest } from '@qandeel-company/storage/testing';

import { removeRoot, runtimeFor, tempRoot } from '../helpers.js';
import { spawnScript } from '../process-harness.js';

const CLI = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

function cli(...args: string[]): { status: number | null; json: Record<string, unknown>; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 60_000 });
  const last = r.stdout.trim().split('\n').at(-1) ?? '{}';
  return { status: r.status, json: last.startsWith('{') ? (JSON.parse(last) as Record<string, unknown>) : {}, stderr: r.stderr };
}

describe('engineering CLI (signed Node, no shell, explicit workspace)', () => {
  test('init → submit → start/stop → health → backup → verify-backup → restore-check', async () => {
    const root = tempRoot('cli');
    const restore = path.join(path.dirname(root), 'restored');
    try {
      assert.equal(cli('init').status, 2, 'workspace is mandatory');
      const init = cli('init', '--workspace', root);
      assert.equal(init.status, 0, init.stderr);
      assert.equal(init.json.journalMode, 'wal');

      const submit = cli('submit', '--workspace', root, '--kind', 'c1.steps', '--steps', '3', '--idempotency-key', 'k1');
      assert.equal(submit.status, 0, submit.stderr);
      const replay = cli('submit', '--workspace', root, '--kind', 'c1.steps', '--steps', '3', '--idempotency-key', 'k1');
      assert.equal(replay.json.replayed, true);
      assert.equal(replay.json.workItemId, submit.json.workItemId);

      const running = spawnScript(CLI, ['start', '--workspace', root, '--concurrency', '1']);
      await running.waitFor((l) => l.includes('"event":"run.settled"'), 30_000);
      const live = cli('health', '--workspace', root);
      assert.equal((live.json.components as { supervisor: { live: boolean } }).supervisor.live, true);
      running.process.kill('SIGINT');
      await running.exited(30_000);
      if (process.platform !== 'win32') assert.ok(running.lines.some((l) => l.includes('runtime.stopped')), 'SIGINT triggers graceful shutdown');

      const health = cli('health', '--workspace', root);
      assert.equal(health.status, 0);
      assert.deepEqual((health.json.components as { workItems: Record<string, number> }).workItems, { COMPLETED: 1 });

      const backup = cli('backup', '--workspace', root);
      assert.equal(backup.status, 0, backup.stderr);
      assert.equal(backup.json.verified, true);
      const verify = cli('verify-backup', '--workspace', root, '--backup', String(backup.json.backupId));
      assert.equal(verify.json.integrity, 'ok');
      const check = cli('restore-check', '--workspace', root, '--backup', String(backup.json.backupId), '--target', restore);
      assert.equal(check.status, 0, check.stderr);
      assert.equal(check.json.quickCheck, 'ok');
      // RR4-1: the target is a verification copy — it says so, and it can never be started or un-held.
      assert.deepEqual([check.json.restoreKind, check.json.startable, check.json.hold], ['VERIFICATION_COPY', false, 'RESTORE_CHECK_COPY']);
      const startCopy = cli('start', '--workspace', restore, '--concurrency', '1');
      assert.equal(startCopy.status, 1, 'the runtime refuses to start a verification copy');
      assert.equal(JSON.parse(startCopy.stderr.trim().split('\n').at(-1) ?? '{}').code, 'UPDATE_HOLD');
      const clearCopy = cli('clear-update-hold', '--workspace', restore, '--reason', 'operator.reviewed');
      assert.equal(JSON.parse(clearCopy.stderr.trim().split('\n').at(-1) ?? '{}').code, 'MAINTENANCE_REFUSED', 'its hold cannot be cleared');
      assert.equal(cli('health', '--workspace', restore).status, 0, 'read-only inspection still works');
      assert.equal(cli('verify-artifacts', '--workspace', root).status, 0);

      // C3 read-only inspection: counts / IDs / codes only.
      const mind = cli('mind', '--workspace', root);
      assert.equal(mind.status, 0, mind.stderr);
      assert.equal((mind.json.memory as { contextManifests: number }).contextManifests, 0);
      assert.equal((mind.json.academy as { capabilityGapsOpen: number }).capabilityGapsOpen, 0);
      const gaps = cli('capability-gaps', '--workspace', root);
      assert.deepEqual(gaps.json.open, []);
      const noManifest = cli('context-manifest', '--workspace', root, '--manifest', '00000000-0000-4000-8000-000000000000');
      assert.equal(noManifest.status, 1);
      assert.equal(JSON.parse(noManifest.stderr.trim()).code, 'NOT_FOUND');
      assert.equal(cli('context-manifest', '--workspace', root).status, 1, 'a manifest id is required');

      const bad = cli('submit', '--workspace', root, '--kind', 'rm -rf /');
      assert.equal(bad.status, 2, 'unknown processor kinds are refused');
      const unknown = cli('explode', '--workspace', root);
      assert.equal(unknown.status, 2);
      assert.doesNotMatch(unknown.stderr, /at .*\.js:\d+/, 'no stack traces on the CLI surface');
    } finally {
      removeRoot(root);
    }
  });

  test('FB-2: an interrupted live restore is never started, inspected as a Company or un-held; restore-status shows it and the same package resumes it, then the runtime starts', async () => {
    const root = tempRoot('fb2-cli');
    const base = path.dirname(root);
    const target = path.join(base, 'مساحة-الاستعادة');
    const ext = path.join(base, 'external');
    const packageFile = path.join(base, 'package.qcpkg');
    // Assembled at run time: no literal credential-shaped value is committed.
    const passphrase = ['fb2', 'cli', 'recovery', 'phrase', String(Date.now())].join('-');
    const lastErr = (r: { stderr: string }): Record<string, unknown> => JSON.parse(r.stderr.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>;
    try {
      const source = CompanyStore.open(root);
      const pkg = await createPortableBackup(source, { destination: new DirectoryDestination(ext), passphrase });
      source.close();
      const bytes = new DirectoryDestination(ext).get(pkg.name);
      writeFileSync(packageFile, bytes);
      assert.throws(() => restorePortableBackupWithFaultForTest(bytes, target, { passphrase }, (p) => { if (p === 'before-controlled-restore') throw new Error('interrupted'); }), /interrupted/);

      const rt = runtimeFor(target);
      await assert.rejects(rt.start(), (e: unknown) => isQandeelError(e, 'UPDATE_HOLD') && (e as { details: { code?: unknown } }).details.code === 'RESTORE_IN_PROGRESS', 'the runtime refuses to start a half-restored target');
      for (const command of ['start', 'init', 'health', 'governance']) {
        const r = cli(command, '--workspace', target);
        assert.equal(r.status, 1, `${command} refuses it`);
        assert.equal(lastErr(r).code, 'UPDATE_HOLD', `${command}: ${r.stderr}`);
      }
      assert.equal(lastErr(cli('clear-update-hold', '--workspace', target, '--reason', 'operator.reviewed')).code, 'MAINTENANCE_REFUSED', 'its hold cannot be cleared');
      const status = cli('restore-status', '--workspace', target);
      assert.equal(status.status, 0, status.stderr);
      assert.deepEqual([status.json.blocked, status.json.hold, (status.json.restoreInProgress as { phase: string; packageId: string }).phase, (status.json.restoreInProgress as { packageId: string }).packageId], [true, 'RESTORE_IN_PROGRESS', 'DATA_WRITTEN', pkg.packageId]);

      process.env.QANDEEL_RECOVERY_PASSPHRASE = passphrase; // inherited by the CLI child, never on its command line
      const resumed = cli('restore-portable', '--workspace', target, '--package', packageFile);
      assert.equal(resumed.status, 0, resumed.stderr);
      assert.deepEqual([resumed.json.restoreKind, resumed.json.restoreLifecycle, resumed.json.packageId], ['CONTROLLED_LIVE_RESTORE', 'REDONE', pkg.packageId]);
      assert.equal(cli('restore-status', '--workspace', target).json.blocked, false);
      const started = runtimeFor(target);
      await started.start();
      assert.equal(started.state, 'READY', 'only the completed controlled restore is a startable Company');
      await started.stop();
    } finally {
      delete process.env.QANDEEL_RECOVERY_PASSPHRASE;
      removeRoot(root);
    }
  });
});
