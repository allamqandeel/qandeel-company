/**
 * Child-process fixture: "Worker A". Claims a job with a short lease, reports its fence, then
 * stalls (as if paused/partitioned) until the parent creates <goFile>. It then wakes late and
 * attempts to checkpoint and to complete. Prints one JSON line per step.
 * argv: <workspaceRoot> <leaseMs> <goFile>
 */
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import { ExponentialBackoff } from '@qandeel-company/domain';

import { CompanyStore } from '../../src/index.js';
import { KINDS } from '../helpers.js';

const [root, leaseMs, goFile] = process.argv.slice(2);
const store = CompanyStore.open(String(root), { busyTimeoutMs: 10_000 });
const claim = store.claimNext({ workerId: 'worker-A', leaseMs: Number(leaseMs), kinds: KINDS });
if (!claim) {
  process.stdout.write(`${JSON.stringify({ step: 'claim', ok: false })}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ step: 'claim', ok: true, jobId: claim.job.id, token: claim.fence.fencingToken })}\n`);
const deadline = Date.now() + 30_000;
while (!existsSync(String(goFile)) && Date.now() < deadline) await sleep(20);
for (const [step, attempt] of [
  ['checkpoint', () => store.checkpoint(claim.fence, 'late', { late: true }, 1, 60_000)],
  ['complete', () => store.settle(claim.fence, { type: 'COMPLETED' }, { backoff: new ExponentialBackoff() })],
] as const) {
  try {
    attempt();
    process.stdout.write(`${JSON.stringify({ step, ok: true })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ step, ok: false, code: (error as { code?: string }).code ?? 'UNKNOWN' })}\n`);
  }
}
store.close();
