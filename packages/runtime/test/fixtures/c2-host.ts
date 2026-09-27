/**
 * Child-process fixture for C2 crash proofs: a governed runtime (fake provider + fake tools) that
 * SIGKILLs itself at a named storage fault point, or drains and exits when idle.
 * argv: <workspaceRoot> <configJson>
 */
import { armFounderTestSurface } from '@qandeel-company/storage/testing';

import { Logger, jsonLinesSink } from '../../src/index.js';
import { fakes, governedRuntime, submitTask, type C2World } from '../c2/c2-seed.js';

interface HostConfig {
  readonly world?: C2World;
  readonly submit?: Record<string, unknown>;
  readonly fault?: string;
  readonly exitWhenIdle?: boolean;
}

const [root, configJson] = process.argv.slice(2);
const config = JSON.parse(String(configJson)) as HostConfig;
const emit = (v: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(v)}\n`);
};
// Work Item budgets are Founder acts: this test process arms the test-only Founder seam (D-C2-13).
armFounderTestSurface(String(root));
const f = fakes();
const rt = governedRuntime(String(root), f, {
  supervisorTtlMs: 1_500,
  acquireTimeoutMs: 30_000,
  logger: new Logger(jsonLinesSink(() => undefined)),
  storageFault: (p) => {
    if (p === config.fault) {
      emit({ host: 'DYING', point: p });
      process.kill(process.pid, 'SIGKILL');
    }
  },
});
const recovery = await rt.start();
emit({ host: 'READY', recovery });
if (config.submit && config.world) {
  const id = submitTask(rt, config.world, config.submit);
  emit({ host: 'SUBMITTED', workItemId: id });
}
if (config.exitWhenIdle) {
  await rt.whenIdle(60_000);
  emit({ host: 'IDLE', providerCalls: f.local.totalCalls + f.cloud.totalCalls, notes: f.drivers.notes.invocations.length });
  await rt.stop();
  emit({ host: 'STOPPED' });
}
