/**
 * Event-driven wake-up (Stage 8 §13, §18; Stage 12 §15, §18).
 *
 * The durable queue is the source of truth; a wake is only a hint that it changed. Hints are
 * coalesced, cost no model call, and losing one is harmless: startup recovery and the single
 * next-due timer rediscover all durable work.
 *
 *   in-process: `WakeSignal.signal()` after a transaction commits
 *   cross-process: another process writes `<workspace>/runtime/wake.signal`; the runtime watches
 *                  the directory with the OS change-notification API (fs.watch — inotify /
 *                  ReadDirectoryChangesW), which is event-driven, not polling
 */
import { watch, writeFileSync, type FSWatcher } from 'node:fs';
import path from 'node:path';

import { layoutFor } from '@qandeel-company/storage';

export class WakeSignal {
  readonly #onWake: () => void;
  #scheduled = false;
  #closed = false;
  #watcher: FSWatcher | undefined;
  signals = 0;

  constructor(onWake: () => void) {
    this.#onWake = onWake;
  }

  /** Coalesces any number of signals into one wake on the next turn of the event loop. */
  signal(): void {
    this.signals++;
    if (this.#scheduled || this.#closed) return;
    this.#scheduled = true;
    setImmediate(() => {
      this.#scheduled = false;
      if (!this.#closed) this.#onWake();
    });
  }

  /** Watches the workspace wake file for cross-process hints. Returns false if unsupported. */
  watchWakeFile(wakeFile: string): boolean {
    try {
      const name = path.basename(wakeFile);
      this.#watcher = watch(path.dirname(wakeFile), { persistent: false }, (_event, filename) => {
        if (filename === null || String(filename) === name) this.signal();
      });
      this.#watcher.on('error', () => this.#watcher?.close());
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.#closed = true;
    this.#watcher?.close();
  }
}

/** Hint a running runtime (in another process) that durable state changed. */
export function notifyRuntime(workspaceRoot: string): void {
  try {
    writeFileSync(layoutFor(workspaceRoot).wakeFile, new Date().toISOString());
  } catch {
    // Best effort: the durable queue remains correct without the hint.
  }
}
