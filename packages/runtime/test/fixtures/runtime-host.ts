/**
 * Child-process fixture: a real Company runtime process for crash/restart and fault-injection
 * proofs. It prints JSON lines (`{"host": ...}`) at durability boundaries so the parent can kill it
 * at a controlled point, and can kill *itself* (SIGKILL — TerminateProcess on Windows) when a
 * named fault point is reached. No graceful shutdown happens on a kill.
 *
 * argv: <workspaceRoot> <configJson>
 */
import { setTimeout as sleep } from 'node:timers/promises';

import type { Processor } from '@qandeel-company/domain';

import { CompanyRuntime, DETERMINISTIC_PROCESSORS, Logger, jsonLinesSink, type RuntimeFaultPoint } from '../../src/index.js';

interface HostConfig {
  readonly concurrency?: number;
  readonly supervisorTtlMs?: number;
  readonly jobLeaseMs?: number;
  readonly submit?: { readonly kind: string; readonly input?: unknown; readonly idempotencyKey?: string };
  /** Kill this process at the `at`-th occurrence (default 1) of the named fault point. */
  readonly fault?: { readonly point: string; readonly at?: number };
  readonly exitWhenIdle?: boolean;
}

const [root, configJson] = process.argv.slice(2);
const config = JSON.parse(String(configJson)) as HostConfig;

const emit = (value: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const hits = new Map<string, number>();
const reach = (point: string): void => {
  const n = (hits.get(point) ?? 0) + 1;
  hits.set(point, n);
  if (point === 'checkpoint.afterCommit') emit({ host: 'CHECKPOINTED', n });
  if (config.fault?.point === point && n === (config.fault.at ?? 1)) {
    emit({ host: 'DYING', point, n });
    process.kill(process.pid, 'SIGKILL');
  }
};

/** Deterministic UNSAFE-class processor (no real external effect) for the reconciliation proof. */
const unsafe: Processor = {
  kind: 'test.unsafe',
  sideEffects: 'UNSAFE',
  async run(ctx) {
    await ctx.checkpoint('intent', { operation: 'deterministic-probe' });
    await sleep(60_000, undefined, { signal: ctx.signal }).catch(() => undefined);
    return { type: 'CANCELLED' };
  },
};

const runtime = new CompanyRuntime({
  workspace: String(root),
  processors: [...DETERMINISTIC_PROCESSORS, unsafe],
  concurrency: config.concurrency ?? 2,
  supervisorTtlMs: config.supervisorTtlMs ?? 1_500,
  jobLeaseMs: config.jobLeaseMs ?? 60_000,
  acquireTimeoutMs: 30_000,
  logger: new Logger(jsonLinesSink((line) => process.stdout.write(line))),
  fault: (p: RuntimeFaultPoint) => reach(p),
  storageFault: (p) => reach(p),
});

const recovery = await runtime.start();
emit({ host: 'READY', instanceId: runtime.instanceId, recovery });
if (config.submit) {
  const r = runtime.submitWorkItem(
    { objective: 'fault-matrix work', ownerRef: 'owner:founder', processorKind: config.submit.kind, processorInput: config.submit.input ?? null, initialState: 'READY' },
    config.submit.idempotencyKey ? { idempotencyKey: config.submit.idempotencyKey } : {},
  );
  emit({ host: 'SUBMITTED', workItemId: r.workItem.id });
}
if (config.exitWhenIdle) {
  await runtime.whenIdle(60_000);
  emit({ host: 'IDLE' });
  await runtime.stop();
  emit({ host: 'STOPPED' });
}
