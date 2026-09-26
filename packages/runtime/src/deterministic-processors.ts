/**
 * Deterministic processors — the only execution C1 performs.
 *
 * They exist to prove durability: checkpoints, resume, wait, retry, dead-letter and cancellation.
 * They make no model/provider calls, use no tools, touch nothing outside Company state and have
 * no external side effects (`sideEffects: 'NONE'`).
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { SIDE_EFFECT_CLASSES, type JsonValue, type Processor, type ProcessorContext, type ProcessorResult, type SideEffectClass } from '@qandeel-company/domain';

/** Completes immediately. */
export const noopProcessor: Processor = {
  kind: 'c1.noop',
  sideEffects: 'NONE',
  run: async () => ({ type: 'COMPLETED', evidence: { processor: 'c1.noop' } }),
};

export interface StepsInput {
  /** Number of checkpointed steps (1..10000). */
  readonly steps?: number;
  /** Delay per step, in ms (0..60000). */
  readonly stepMs?: number;
  /** Retryable failure on every attempt below this number. */
  readonly failUntilAttempt?: number;
  /** Always fail permanently. */
  readonly permanentFailure?: boolean;
  /** Wait for an explicit wake before the first step. */
  readonly waitFirst?: boolean;
}

function readSteps(input: JsonValue): Required<StepsInput> {
  const o = (input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, JsonValue>;
  const int = (v: JsonValue | undefined, d: number, max: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : d);
  return {
    steps: Math.max(1, int(o.steps, 3, 10_000)),
    stepMs: int(o.stepMs, 0, 60_000),
    failUntilAttempt: int(o.failUntilAttempt, 0, 100),
    permanentFailure: o.permanentFailure === true,
    waitFirst: o.waitFirst === true,
  };
}

function lastStep(ctx: ProcessorContext): number {
  const s = ctx.resumeFrom?.state;
  return s !== null && typeof s === 'object' && !Array.isArray(s) && typeof (s as Record<string, JsonValue>).step === 'number' ? ((s as Record<string, JsonValue>).step as number) : 0;
}

/**
 * Runs N checkpointed steps, resuming after the last durable checkpoint. Honours cancellation
 * between steps by acknowledging it (`CANCELLED`) at a safe point.
 */
export const stepsProcessor: Processor = {
  kind: 'c1.steps',
  sideEffects: 'NONE',
  maxRunMs: 10 * 60_000,
  async run(ctx): Promise<ProcessorResult> {
    const cfg = readSteps(ctx.input);
    if (cfg.permanentFailure) return { type: 'PERMANENT_FAILURE', code: 'DETERMINISTIC_PERMANENT' };
    if (ctx.attempt < cfg.failUntilAttempt) return { type: 'RETRYABLE_FAILURE', code: 'DETERMINISTIC_TRANSIENT' };
    const resumedFrom = lastStep(ctx);
    if (cfg.waitFirst && ctx.resumeFrom === null) {
      await ctx.checkpoint('step', { step: 0, waited: true });
      return { type: 'WAIT', reasonCode: 'AWAITING_WAKE' };
    }
    for (let step = resumedFrom + 1; step <= cfg.steps; step++) {
      if (ctx.signal.aborted) return { type: 'CANCELLED' };
      if (cfg.stepMs > 0) {
        try {
          await sleep(cfg.stepMs, undefined, { signal: ctx.signal });
        } catch {
          return { type: 'CANCELLED' };
        }
      }
      await ctx.checkpoint('step', { step });
    }
    return { type: 'COMPLETED', evidence: { processor: 'c1.steps', steps: cfg.steps, resumedFrom } };
  },
};

export const DETERMINISTIC_PROCESSORS: readonly Processor[] = Object.freeze([noopProcessor, stepsProcessor]);

/** Registry: kind → processor. Duplicate or malformed registrations are refused. */
export class ProcessorRegistry {
  readonly #byKind = new Map<string, Processor>();

  constructor(processors: readonly Processor[]) {
    for (const p of processors) {
      if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(p.kind) || p.kind.length > 64) throw new Error(`invalid processor kind "${p.kind}"`);
      if (!SIDE_EFFECT_CLASSES.includes(p.sideEffects)) throw new Error(`invalid side-effect class for ${p.kind}`);
      if (this.#byKind.has(p.kind)) throw new Error(`duplicate processor kind "${p.kind}"`);
      this.#byKind.set(p.kind, p);
    }
  }

  get(kind: string): Processor | undefined {
    return this.#byKind.get(kind);
  }

  get kinds(): readonly string[] {
    return [...this.#byKind.keys()];
  }

  get sideEffects(): ReadonlyMap<string, SideEffectClass> {
    return new Map([...this.#byKind].map(([k, p]) => [k, p.sideEffects]));
  }
}
