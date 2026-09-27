/**
 * Child-process fixture: an independent process with its own SQLite connection performs one C3 act at
 * an agreed instant (concurrent-certification / activation / promotion proof). Prints one JSON line.
 * argv: <workspaceRoot> <op: advance|activate|promote> <id> <founderRef> <startAtEpochMs>
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { AcademyStore, CompanyStore, MemoryStore } from '../../src/index.js';
import { armFounderTestSurface } from '../../src/testing/founder-seam.js';

const [root, op, id, founder, startAt] = process.argv.slice(2);
// Founder acts stand in for the authenticated surface through the test-only seam (as in every C3 test).
armFounderTestSurface(String(root));
const store = CompanyStore.open(String(root), { busyTimeoutMs: 15_000 });
const wait = Number(startAt) - Date.now();
if (wait > 0) await sleep(wait);
try {
  let out: Record<string, unknown>;
  if (op === 'advance') out = { ok: true, stage: AcademyStore.for(store).advance(String(id)).stage };
  else if (op === 'activate') out = { ok: true, state: AcademyStore.for(store).decideActivation(String(founder), String(id), { decision: 'APPROVE', reasonCode: 'race' }).state };
  else out = { ok: true, state: MemoryStore.for(store).decidePromotion(String(founder), String(id), { decision: 'APPROVE', reasonCode: 'race' }).state };
  process.stdout.write(`${JSON.stringify(out)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: (error as { code?: string }).code ?? 'UNKNOWN' })}\n`);
} finally {
  store.close();
}
