/**
 * Child-process fixture: ANOTHER local process that commits to the Company workspace while a
 * runtime is running, the way the CLI `submit` / `cancel` commands do. It opens its own store
 * (its own SQLite connection), commits one change, prints one JSON line, then writes the wake-file
 * hint exactly like the CLI. The parent decides whether that hint reaches the runtime.
 *
 * argv: <workspaceRoot> submit
 *       <workspaceRoot> cancel <workItemId>
 */
import { assertId } from '@qandeel-company/domain';
import { CompanyStore } from '@qandeel-company/storage';

import { notifyRuntime } from '../../src/index.js';

const [root, mode, target] = process.argv.slice(2);
const store = CompanyStore.open(String(root), { create: false, migrationMode: 'verify', busyTimeoutMs: 10_000 });
try {
  // Taken before the commit: the measured discovery time can only be over-, never under-stated.
  const committedAtMs = Date.now();
  if (mode === 'submit') {
    const { workItem } = store.createWorkItem({ objective: 'committed by another process', ownerRef: 'owner:founder', processorKind: 'c1.noop', initialState: 'READY' });
    process.stdout.write(`${JSON.stringify({ committed: 'submit', workItemId: workItem.id, committedAtMs, wakeGeneration: store.wakeGeneration() })}\n`);
  } else if (mode === 'cancel') {
    store.requestCancellation(assertId(target, 'workItemId'), { reasonCode: 'OPERATOR_CANCEL' });
    process.stdout.write(`${JSON.stringify({ committed: 'cancel', committedAtMs, wakeGeneration: store.wakeGeneration() })}\n`);
  } else {
    throw new Error('unknown mode');
  }
} finally {
  store.close();
}
notifyRuntime(String(root));
