/**
 * Child-process fixture: an independent process with its own SQLite connection that races to
 * claim one job at an agreed instant. Prints one JSON line with the outcome.
 * argv: <workspaceRoot> <jobId> <workerId> <startAtEpochMs> <supervisorHolderId> <supervisorToken>
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { assertId } from '@qandeel-company/domain';

import { CompanyStore } from '../../src/index.js';
import { adoptSupervisorFenceForStorageTests } from '../../src/queue.js';
import { KINDS } from '../helpers.js';
import { claimJob } from '../../src/runtime-authority.js';

const [root, jobId, workerId, startAt, holderId, token] = process.argv.slice(2);
const supervisor = adoptSupervisorFenceForStorageTests({ holderId: assertId(holderId, 'holderId'), fencingToken: Number(token) });
const store = CompanyStore.open(String(root), { busyTimeoutMs: 10_000 });
const wait = Number(startAt) - Date.now();
if (wait > 0) await sleep(wait);
try {
  const claim = claimJob(store, assertId(jobId, 'jobId'), { workerId: String(workerId), leaseMs: 60_000, kinds: KINDS, supervisor });
  process.stdout.write(`${JSON.stringify({ workerId, claimed: claim !== null, token: claim?.fence.fencingToken ?? null })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ workerId, claimed: false, error: (error as { code?: string }).code ?? 'UNKNOWN' })}\n`);
} finally {
  store.close();
}
