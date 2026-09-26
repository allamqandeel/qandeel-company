import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ExponentialBackoff, ManualClock, newId, type Id, type SideEffectClass } from '@qandeel-company/domain';

import { CompanyStore, type OpenStoreOptions, type SupervisorFence } from '../src/index.js';
import { acquireSupervisor } from '../src/runtime-authority.js';

/** A disposable OS-owned workspace root. The Arabic segment proves Unicode paths end to end. */
export function tempRoot(label = 'store'): string {
  const base = mkdtempSync(path.join(tmpdir(), `qc-${label}-`));
  return path.join(base, 'مساحة-العمل');
}

export function removeRoot(root: string): void {
  rmSync(path.dirname(root), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

export interface Harness {
  readonly root: string;
  readonly clock: ManualClock;
  readonly store: CompanyStore;
  /** A real Runtime Supervisor lease acquired on this workspace (claims require it, D-C1-22). */
  readonly supervisor: SupervisorFence;
  /** Claim options presenting this harness's supervisor fence. */
  claimOpts(workerId?: string, leaseMs?: number): ClaimOptionsWithSupervisor;
  open(options?: OpenStoreOptions): CompanyStore;
  close(): void;
}

export interface ClaimOptionsWithSupervisor {
  readonly workerId: string;
  readonly leaseMs: number;
  readonly kinds: ReadonlyMap<string, SideEffectClass>;
  readonly supervisor: SupervisorFence;
}

/** Long enough that no test's manual clock advance expires it by accident. */
export const TEST_SUPERVISOR_TTL_MS = 30 * 86_400_000;

/**
 * Opens a store on a fresh workspace with a deterministic clock and acquires a real supervisor
 * lease for it: storage tests claim work the same way the runtime does, never unfenced.
 */
export function harness(options: OpenStoreOptions = {}): Harness {
  const root = tempRoot();
  const clock = new ManualClock();
  const opened: CompanyStore[] = [];
  const open = (extra: OpenStoreOptions = {}): CompanyStore => {
    const s = CompanyStore.open(root, { clock, ...options, ...extra });
    opened.push(s);
    return s;
  };
  const store = open();
  const supervisor = acquireSupervisor(store, newId(), TEST_SUPERVISOR_TTL_MS);
  return {
    root,
    clock,
    store,
    supervisor,
    claimOpts: (workerId = 'w1', leaseMs = 10_000) => ({ workerId, leaseMs, kinds: KINDS, supervisor }),
    open,
    close: () => {
      for (const s of opened) s.close();
      removeRoot(root);
    },
  };
}

export const KINDS: ReadonlyMap<string, SideEffectClass> = new Map([
  ['test.noop', 'NONE'],
  ['test.unsafe', 'UNSAFE'],
]);

export const backoff = new ExponentialBackoff({ baseMs: 1_000, maxMs: 60_000 });

export const owner = 'owner:founder';

export function executable(store: CompanyStore, extra: Record<string, unknown> = {}): Id {
  return store.createWorkItem({ objective: 'deterministic test work', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY', ...extra }).workItem.id;
}


export { newId };
