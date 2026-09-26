/**
 * Event-driven wake-up (Stage 8 §13, §18; Stage 12 §15, §18).
 *
 * The durable queue is the source of truth; a wake is only a hint that it changed. Hints are
 * coalesced and cost no model call. A lost in-process hint cannot happen (it is issued after every
 * local commit). A lost cross-process hint never loses work — the job stays durable — but pickup
 * waits for the next pump (another commit, a slot release, the next-due timer) or a restart;
 * a failed watcher is therefore reported by health (WAKE_WATCHER_UNAVAILABLE → DEGRADED).
 *
 *   in-process: `WakeSignal.signal()` after a transaction commits
 *   cross-process: another process writes `<workspace>/runtime/wake.signal`; the runtime watches
 *                  the directory with the OS change-notification API (fs.watch — inotify /
 *                  ReadDirectoryChangesW), which is event-driven, not polling
 */
import { existsSync, lstatSync, realpathSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
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

  #watcherState: 'ACTIVE' | 'DISABLED' | 'UNAVAILABLE' = 'DISABLED';
  #rearmed = false;

  get watcherState(): 'ACTIVE' | 'DISABLED' | 'UNAVAILABLE' {
    return this.#watcherState;
  }

  disableWatcher(): void {
    this.#watcherState = 'DISABLED';
  }

  /**
   * Watches the workspace wake file for cross-process hints. A watcher error is re-armed once; if
   * that fails the state becomes UNAVAILABLE, which health reports (cross-process hints would then
   * be picked up only at the next pump, timer or restart — work itself stays durable).
   */
  watchWakeFile(wakeFile: string): boolean {
    try {
      const name = path.basename(wakeFile);
      this.#watcher = watch(path.dirname(wakeFile), { persistent: false }, (_event, filename) => {
        if (filename === null || String(filename) === name) this.signal();
      });
      this.#watcher.on('error', () => {
        this.#watcher?.close();
        this.#watcherState = 'UNAVAILABLE';
        if (!this.#closed && !this.#rearmed) {
          this.#rearmed = true;
          this.watchWakeFile(wakeFile);
        }
      });
      this.#watcherState = 'ACTIVE';
      this.signal(); // anything committed before the watcher started is noticed now
      return true;
    } catch {
      this.#watcherState = 'UNAVAILABLE';
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
    const wakeFile = layoutFor(realpathSync.native(workspaceRoot)).wakeFile;
    if (existsSync(wakeFile) && lstatSync(wakeFile).isSymbolicLink()) return; // never write through a link
    writeFileSync(wakeFile, new Date().toISOString());
  } catch {
    // Best effort: the durable queue remains correct without the hint.
  }
}
