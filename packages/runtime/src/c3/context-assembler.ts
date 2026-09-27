/**
 * The runtime side of governed Context Assembly (C3, Stage 5 / Stage 13 D13-D). Every model inference
 * receives its context from here and nowhere else: the storage transaction selects, verifies, budgets
 * and records the context (manifest), and this module hands the result over as an opaque, frozen value
 * that only this module can mint. `GovernedModelRuntime.call` accepts nothing else — a processor cannot
 * build messages of its own, so it cannot bypass data-class derivation, memory / knowledge access
 * control, the hard budget, Skill pinning or manifest generation (verifier rule
 * `context-assembly-mandatory`).
 */
import type { Id } from '@qandeel-company/domain';
import type { DataClass, ProviderMessage } from '@qandeel-company/governance';
import type { CompanyStore, Fence } from '@qandeel-company/storage';
import { assembleContext } from '@qandeel-company/storage/runtime-authority';

export interface AssembledContext {
  readonly manifestId: Id;
  readonly messages: readonly ProviderMessage[];
  readonly estimatedInputTokens: number;
  readonly dataClass: DataClass;
}

/** Why no context was produced: each is a typed outcome, never a silent truncation. */
export type ContextRefusal = 'CONTEXT_BUDGET_EXHAUSTED' | 'CONFLICT_HOLD' | 'SKILL_CONFLICT' | 'INTEGRITY_FAILURE';

export type AssemblyOutcome = { readonly kind: 'OK'; readonly context: AssembledContext } | { readonly kind: 'REFUSED'; readonly code: ContextRefusal; readonly manifestId: Id };

const MINTED = new WeakSet<object>();

/** True only for a context minted by `assembleGovernedContext` in this process (never a look-alike). */
export function isAssembledContext(value: unknown): value is AssembledContext {
  return typeof value === 'object' && value !== null && MINTED.has(value);
}

/** Assembles this run's context for one step through the governed storage path. */
export function assembleGovernedContext(store: CompanyStore, fence: Fence, request: { readonly step: number }): AssemblyOutcome {
  const r = assembleContext(store, fence, { step: request.step });
  if (r.outcome !== 'OK') return { kind: 'REFUSED', code: r.outcome, manifestId: r.manifestId };
  const context: AssembledContext = Object.freeze({
    manifestId: r.manifestId,
    messages: Object.freeze(r.messages.map((m) => Object.freeze({ role: m.role, content: m.content }))),
    estimatedInputTokens: r.estimatedInputTokens,
    dataClass: r.dataClass,
  });
  MINTED.add(context);
  return { kind: 'OK', context };
}
