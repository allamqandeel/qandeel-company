/**
 * Child-process fixture: an independent process with its own SQLite connection reserves budget for
 * one claimed run at an agreed instant (concurrent-reservation proof). Prints one JSON line.
 * argv: <workspaceRoot> <fenceJson> <toolActionId> <money> <startAtEpochMs>
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { assertId } from '@qandeel-company/domain';

import { CompanyStore, type Fence } from '../../src/index.js';
import { reserveBudget } from '../../src/runtime-authority.js';

const [root, fenceJson, actionId, money, startAt] = process.argv.slice(2);
const fence = JSON.parse(String(fenceJson)) as Fence;
const store = CompanyStore.open(String(root), { busyTimeoutMs: 15_000 });
const wait = Number(startAt) - Date.now();
if (wait > 0) await sleep(wait);
try {
  const r = reserveBudget(store, fence, { purpose: 'TOOL_CALL', attemptKind: 'PRIMARY', toolActionId: assertId(actionId, 'actionId'), money: Number(money), tokens: 0 });
  process.stdout.write(`${JSON.stringify(r.ok ? { ok: true } : { ok: false, code: r.code, detail: r.detail })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: (error as { code?: string }).code ?? 'UNKNOWN' })}\n`);
} finally {
  store.close();
}
