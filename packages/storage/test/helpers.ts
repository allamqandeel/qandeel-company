import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ExponentialBackoff, ManualClock, newId, type Id, type SideEffectClass } from '@qandeel-company/domain';

import { CompanyStore, type OpenStoreOptions } from '../src/index.js';

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
  open(options?: OpenStoreOptions): CompanyStore;
  close(): void;
}

/** Opens a store on a fresh workspace with a deterministic clock. */
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
  return {
    root,
    clock,
    store,
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

export function claimOpts(workerId = 'w1', leaseMs = 10_000) {
  return { workerId, leaseMs, kinds: KINDS };
}

export { newId };
