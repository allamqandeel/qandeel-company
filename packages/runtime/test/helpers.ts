import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { ExponentialBackoff, type Processor, type ProcessorResult } from '@qandeel-company/domain';

import { CompanyRuntime, DETERMINISTIC_PROCESSORS, type RuntimeOptions } from '../src/index.js';

export function tempRoot(label = 'rt'): string {
  return path.join(mkdtempSync(path.join(tmpdir(), `qc-${label}-`)), 'مساحة-العمل');
}

export function removeRoot(root: string): void {
  rmSync(path.dirname(root), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

/** Deterministic probe processor that measures real concurrency (no side effects). */
export function concurrencyProbe(stepMs = 40): Processor & { active: number; maxActive: number; runs: number } {
  const probe = {
    kind: 'test.probe',
    sideEffects: 'NONE' as const,
    active: 0,
    maxActive: 0,
    runs: 0,
    async run(): Promise<ProcessorResult> {
      probe.active++;
      probe.runs++;
      probe.maxActive = Math.max(probe.maxActive, probe.active);
      try {
        await sleep(stepMs);
        return { type: 'COMPLETED' };
      } finally {
        probe.active--;
      }
    },
  };
  return probe;
}

/** Deterministic UNSAFE-class processor: it performs no external effect, but declares that it could. */
export const unsafeProbe: Processor = {
  kind: 'test.unsafe',
  sideEffects: 'UNSAFE',
  async run(ctx) {
    await sleep(60_000, undefined, { signal: ctx.signal }).catch(() => undefined);
    return { type: 'CANCELLED' };
  },
};

export const fastBackoff = new ExponentialBackoff({ baseMs: 20, maxMs: 200 });

export function runtimeFor(root: string, extra: Partial<RuntimeOptions> = {}): CompanyRuntime {
  return new CompanyRuntime({
    workspace: root,
    processors: [...DETERMINISTIC_PROCESSORS, ...(extra.processors ?? [])],
    concurrency: 2,
    supervisorTtlMs: 3_000,
    backoff: fastBackoff,
    shutdownGraceMs: 2_000,
    ...extra,
    ...(extra.processors ? { processors: [...DETERMINISTIC_PROCESSORS, ...extra.processors] } : {}),
  });
}

export async function eventually<T>(fn: () => T | undefined | false, timeoutMs = 10_000, label = 'condition'): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined && v !== false) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(20);
  }
}

export const owner = 'owner:founder';
