/**
 * Event-driven wake-up (Stage 8 §13, §18; Stage 12 §15, §18).
 *
 * The durable queue is the truth; a wake is only a hint that it changed. Hints are coalesced and
 * cost no model call.
 *
 *   in-process:    `WakeSignal.signal()` after a local transaction commits (cannot be lost)
 *   cross-process: another process writes `<workspace>/runtime/wake.signal`; the runtime watches
 *                  the directory with the OS change-notification API (fs.watch — inotify /
 *                  ReadDirectoryChangesW). This is the LOW-LATENCY HINT ONLY: Node documents
 *                  fs.watch as not 100% consistent across platforms and unavailable in some
 *                  situations, so its delivery is never relied on for correctness.
 *   lost-hint truth: the durable wake generation (migration 0003) advances in the same
 *                  transaction as any queue change that makes work actionable; the supervisor
 *                  heartbeat observes it and pumps when it moved (D-C1-23). A missed or dropped
 *                  file hint therefore delays pickup by at most one heartbeat interval.
 *
 * A failed watcher is still reported by health (WAKE_WATCHER_UNAVAILABLE → DEGRADED): discovery
 * then runs at heartbeat latency instead of immediately.
 */
import { existsSync, lstatSync, realpathSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import path from 'node:path';

import { layoutFor } from '@qandeel-company/storage';

export class WakeSignal {
  readonly #onWake: () => void;
  readonly #beforeFileHint: (() => void) | undefined;
  #scheduled = false;
  #closed = false;
  #watcher: FSWatcher | undefined;
  signals = 0;
  /** fs.watch hints that reached the dispatcher. */
  fileHints = 0;
  /** fs.watch hints dropped by failure injection (tests only). */
  fileHintsDropped = 0;

  /**
   * @param beforeFileHint failure injection only: if it throws, that file hint is dropped, as if
   *   the operating system never delivered it. Production passes nothing.
   */
  constructor(onWake: () => void, beforeFileHint?: () => void) {
    this.#onWake = onWake;
    this.#beforeFileHint = beforeFileHint;
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
   * that fails the state becomes UNAVAILABLE, which health reports (cross-process work is then
   * discovered by the heartbeat's wake-generation reconciliation, within one heartbeat interval).
   */
  watchWakeFile(wakeFile: string): boolean {
    try {
      const name = path.basename(wakeFile);
      this.#watcher = watch(path.dirname(wakeFile), { persistent: false }, (_event, filename) => {
        if (filename !== null && String(filename) !== name) return;
        try {
          this.#beforeFileHint?.();
        } catch {
          this.fileHintsDropped++;
          return;
        }
        this.fileHints++;
        this.signal();
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

/**
 * Hint a running runtime (in another process) that durable state changed. Best effort: the
 * durable wake generation already recorded the change in the committing transaction.
 */
export function notifyRuntime(workspaceRoot: string): void {
  try {
    const wakeFile = layoutFor(realpathSync.native(workspaceRoot)).wakeFile;
    if (existsSync(wakeFile) && lstatSync(wakeFile).isSymbolicLink()) return; // never write through a link
    writeFileSync(wakeFile, new Date().toISOString());
  } catch {
    // Best effort: the durable queue remains correct without the hint.
  }
}
