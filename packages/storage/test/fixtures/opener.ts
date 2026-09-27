/**
 * Child-process fixture: opens (and so migrates) a workspace at an agreed instant, racing other
 * openers of the same fresh workspace. Prints one JSON line.
 * argv: <workspaceRoot> <startAtEpochMs>
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { CompanyStore } from '../../src/index.js';

const [root, startAt] = process.argv.slice(2);
const wait = Number(startAt) - Date.now();
if (wait > 0) await sleep(wait);
try {
  const store = CompanyStore.open(String(root), { busyTimeoutMs: 10_000 });
  process.stdout.write(`${JSON.stringify({ ok: true, schemaVersion: store.schemaVersion, applied: store.migration.applied })}\n`);
  store.close();
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: (error as { code?: string }).code ?? 'UNKNOWN' })}\n`);
}
