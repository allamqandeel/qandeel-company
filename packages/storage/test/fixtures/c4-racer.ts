/**
 * Child-process fixture: an independent process with its own SQLite connection performs one C4 act at an
 * agreed instant (concurrent-organization proof). Prints one JSON line.
 * argv: <workspaceRoot> <op: assign|decide> <id> <founderRef> <startAtEpochMs> [employeeId]
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { CompanyStore, OrganizationStore } from '../../src/index.js';
import { armFounderTestSurface } from '../../src/testing/founder-seam.js';

const [root, op, id, founder, startAt, employeeId] = process.argv.slice(2);
// Founder acts stand in for the authenticated surface through the test-only seam (as in every C4 test).
armFounderTestSurface(String(root));
const store = CompanyStore.open(String(root), { busyTimeoutMs: 15_000 });
const wait = Number(startAt) - Date.now();
if (wait > 0) await sleep(wait);
try {
  const org = OrganizationStore.for(store);
  const out =
    op === 'assign'
      ? { ok: true, state: org.assignPrimary(String(founder), { positionId: String(id), employeeId: String(employeeId), reasonCode: 'race' }).status }
      : { ok: true, state: org.decideStaffingRequest(String(founder), String(id), { decision: 'APPROVE', reasonCode: 'race' }).state };
  process.stdout.write(`${JSON.stringify(out)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: (error as { code?: string }).code ?? 'UNKNOWN' })}\n`);
} finally {
  store.close();
}
