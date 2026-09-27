import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { removeRoot, tempRoot } from '../helpers.js';
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
});
