/**
 * Child-process fixture: an independent process with its own SQLite connection that races to
 * claim one job at an agreed instant. Prints one JSON line with the outcome.
 * argv: <workspaceRoot> <jobId> <workerId> <startAtEpochMs>
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { assertId } from '@qandeel-company/domain';

import { CompanyStore } from '../../src/index.js';
import { KINDS } from '../helpers.js';

const [root, jobId, workerId, startAt] = process.argv.slice(2);
const store = CompanyStore.open(String(root), { busyTimeoutMs: 10_000 });
const wait = Number(startAt) - Date.now();
if (wait > 0) await sleep(wait);
try {
  const claim = store.claimJob(assertId(jobId, 'jobId'), { workerId: String(workerId), leaseMs: 60_000, kinds: KINDS });
  process.stdout.write(`${JSON.stringify({ workerId, claimed: claim !== null, token: claim?.fence.fencingToken ?? null })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ workerId, claimed: false, error: (error as { code?: string }).code ?? 'UNKNOWN' })}\n`);
} finally {
  store.close();
}
