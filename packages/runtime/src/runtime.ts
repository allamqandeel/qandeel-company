/**
 * CompanyRuntime — the Stage 12 Runtime Supervisor. Infrastructure, not an AI employee.
 *
 * Lifecycle: CREATED → STARTING (workspace, WAL store, migrations) → acquire supervisor lease →
 * RECOVERING (startup recovery) → READY (accepts work, dispatches) → STOPPING → STOPPED.
 * Any unrecoverable condition (e.g. lost supervisor authority) moves it to FAILED (fail-stop).
 *
 * Scheduling is event-driven: a pump runs when a transaction commits (in-process wake), when
 * another process hints through the wake file, when a worker slot frees, and when the single
 * next-due timer fires (earliest retry/scheduled job or lease expiry). There is no polling loop.
 * The only periodic activities are deterministic lease heartbeats (supervisor; and per active run,
 * bounded by the concurrency cap) — they never call a model and never scan the queue.
 *
 * Lost-wake reconciliation (D-C1-23): the fs.watch wake file is only a low-latency hint and its
 * delivery is not guaranteed. The durable wake generation (advanced in the same transaction as
 * any queue change that makes work actionable) is the truth: the supervisor heartbeat reads it on
 * every beat and pumps when it moved since the last pump. A missed hint therefore delays pickup
 * by at most one heartbeat interval (supervisorTtlMs / 3), never indefinitely.
 *
 * Authority (D-C1-22): only this Runtime Supervisor claims work — through the runtime-only
 * storage subpath, presenting its supervisor fence — and it never hands out its mutable store;
 * callers get the read-only `view`.
 *
 * Correctness never depends on graceful shutdown: hard termination is handled by lease expiry,
 * fencing and startup recovery.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import {
  ExponentialBackoff,
  QandeelError,
  isQandeelError,
  isTimestamp,
  newId,
  systemClock,
  type BackoffPolicy,
  type Clock,
  type Id,
  type JsonValue,
  type Processor,
  type ProcessorContext,
  type ProcessorResult,
} from '@qandeel-company/domain';
import {
  ArtifactStore,
  CompanyStore,
  createBackup,
  verifyBackup,
  type ArtifactRecord,
  type BackupResult,
  type BackupVerification,
  type Claim,
  type CreateOptions,
  type CreateResult,
  type CreateWorkItemInput,
  type EventRecord,
  type FaultHook,
  type ReconciliationDecision,
  type SettleOutcome,
  type SupervisorFence,
  type TerminationInput,
  type TerminationOutcome,
  type TransitionInput,
  type WorkItemRecord,
  type CompanyReadView,
  GovernanceStore,
  AcademyStore,
  CapabilityStore,
  MemoryStore,
  SkillStore,
} from '@qandeel-company/storage';
import type { ProviderAdapter, ToolDriver } from '@qandeel-company/governance';

import { GovernedModelRuntime } from './c2/model-runtime.js';
import { ToolExecutor } from './c2/tool-executor.js';
import { isGovernedProcessor, type GovernedRunServices, type MemoryProposal, type ModelCallOutcome, type ModelCallRequest, type ToolRequest } from './c2/types.js';
import { assembleGovernedContext } from './c3/context-assembler.js';
import { c3HealthOf, type C3Health } from './c3/health.js';
import { proposeMemory } from './c3/memory-proposals.js';
import {
  acquireSupervisor,
  beginGovernedRun,
  checkpoint,
  claimNext,
  interruptClaim,
  recoverGovernedOrphans,
  registerInstance,
  releaseSupervisor,
  renewLease,
  renewSupervisor,
  settle,
  updateInstance,
} from '@qandeel-company/storage/runtime-authority';

import { ProcessorRegistry } from './deterministic-processors.js';
import { Logger, errorCode, silentLogger } from './logger.js';
import { runRecovery, type RecoverySummary } from './recovery.js';
import { WakeSignal } from './wake.js';

export const RUNTIME_VERSION = '0.1.0';

export type RuntimeState = 'CREATED' | 'STARTING' | 'RECOVERING' | 'READY' | 'STOPPING' | 'STOPPED' | 'FAILED';

/** Named runtime durability boundaries for failure-injection tests (production passes nothing). */
export type RuntimeFaultPoint = 'submit.afterCommit' | 'claim.afterCommit' | 'recovery.afterClaims' | 'wake.fileHint';

export interface RuntimeOptions {
  readonly workspace: string;
  readonly processors: readonly Processor[];
  /** Maximum concurrently executing runs (1..64). */
  readonly concurrency?: number;
  readonly clock?: Clock;
  readonly backoff?: BackoffPolicy;
  readonly supervisorTtlMs?: number;
  readonly jobLeaseMs?: number;
  /** How long start() waits for a previous supervisor's lease to expire (default TTL + 5 s). */
  readonly acquireTimeoutMs?: number;
  /** Bounded settle period for active runs during graceful shutdown. */
  readonly shutdownGraceMs?: number;
  /** Ceiling applied to processors that declare none. */
  readonly defaultMaxRunMs?: number;
  readonly busyTimeoutMs?: number;
  readonly logger?: Logger;
  /** Watch the workspace wake file for cross-process hints (default true). */
  readonly watchWakeFile?: boolean;
  /**
   * Failure injection (tests only). Throwing aborts at the named point; throwing at
   * `wake.fileHint` drops that fs.watch hint (lost-wake proof).
   */
  readonly fault?: (point: RuntimeFaultPoint) => void;
  /**
   * Called once when the runtime fail-stops (e.g. supervisor authority taken over). A host (the
   * CLI) uses it to exit non-zero so a service wrapper or the operator notices; the runtime never
   * silently disappears.
   */
  readonly onFailStop?: (code: string) => void;
  readonly storageFault?: FaultHook;
  /**
   * C2 governed execution. Provider adapters and tool drivers are handed to the governed Model
   * Runtime and Tool Executor here and are reachable from nowhere else. Omitted → none registered:
   * governed work then finds no route / no driver and fails closed.
   */
  readonly governance?: {
    readonly providers?: readonly ProviderAdapter[];
    readonly toolDrivers?: readonly ToolDriver[];
    readonly modelCallTimeoutMs?: number;
    readonly toolCallTimeoutMs?: number;
  };
}

/** Governance administration handed out by the runtime: every call wakes the dispatcher after commit. */
export type GovernanceAdmin = Omit<GovernanceStore, never>;
export interface MindAdmin {
  readonly memory: MemoryStore;
  readonly skills: SkillStore;
  readonly academy: AcademyStore;
  readonly capability: CapabilityStore;
}

const recoverGovernedOrphansCount = (g: { reservationsHeld: number; reservationsReleased: number; invocationsRetryable: number; invocationsHeld: number }): number =>
  g.reservationsHeld + g.reservationsReleased + g.invocationsRetryable + g.invocationsHeld;

interface ActiveRun {
  readonly claim: Claim;
  readonly processor: Processor;
  readonly controller: AbortController;
  reason: 'CANCEL' | 'TIMEOUT' | 'SHUTDOWN' | 'LEASE_LOST' | null;
  fenced: boolean;
  settled: boolean;
  done: Promise<void>;
}

export interface RuntimeDiagnostics {
  readonly state: RuntimeState;
  readonly pumps: number;
  readonly claimsAttempted: number;
  readonly activeRuns: number;
  readonly maxObservedActive: number;
  readonly timerArmedFor: string | null;
  readonly wakeSignals: number;
  /** Cross-process wake watcher state; a lost watcher is reported, never silently ignored. */
  readonly wakeWatcher: 'ACTIVE' | 'DISABLED' | 'UNAVAILABLE';
  /** Wake-file hints delivered by fs.watch (the low-latency path). */
  readonly wakeFileHints: number;
  /** Wake-file hints deliberately dropped (failure injection only). */
  readonly wakeFileHintsDropped: number;
  /** Supervisor heartbeats that observed the durable wake generation (lost-wake reconciliation). */
  readonly heartbeats: number;
  /** Heartbeats that could not observe the generation (sustained contention); each adds one interval. */
  readonly heartbeatsSkipped: number;
  /** Consecutive failed pumps (retried with exponential backoff, 250 ms → 30 s). */
  readonly consecutivePumpErrors: number;
  /** Pumps started because the heartbeat saw the durable wake generation move (a missed hint). */
  readonly reconciliationWakes: number;
  /** The durable wake generation the last pump started from. */
  readonly observedWakeGeneration: number | null;
  /** Maximum delay, after a commit, before the heartbeat discovers work whose hint was lost. */
  readonly lostWakeBoundMs: number;
}

export type EventHandler = (event: EventRecord) => void;

/** Read-only artifact inspection handed out by the runtime. */
export interface ArtifactReadView {
  get(id: Id): ArtifactRecord;
  listForWorkItem(workItemId: Id): ArtifactRecord[];
  read(id: Id): Buffer;
}

const clampInt = (v: number | undefined, d: number, min: number, max: number): number => {
  const n = v ?? d;
  if (!Number.isInteger(n) || n < min || n > max) throw new QandeelError('VALIDATION_FAILED', `runtime option out of range [${min}, ${max}]`);
  return n;
};

export class CompanyRuntime {
  readonly instanceId: Id = newId();
  readonly #opts: RuntimeOptions;
  readonly #registry: ProcessorRegistry;
  readonly #clock: Clock;
  readonly #backoff: BackoffPolicy;
  readonly #log: Logger;
  readonly #concurrency: number;
  readonly #supervisorTtlMs: number;
  readonly #jobLeaseMs: number;
  readonly #wake: WakeSignal;
  readonly #active = new Map<Id, ActiveRun>();
  readonly #handlers = new Set<EventHandler>();
  readonly #models: GovernedModelRuntime;
  readonly #tools: ToolExecutor;
  #governanceAdmin: GovernanceAdmin | undefined;
  #mindAdmin: MindAdmin | undefined;

  #state: RuntimeState = 'CREATED';
  #store: CompanyStore | undefined;
  #view: CompanyReadView | undefined;
  #artifactView: ArtifactReadView | undefined;
  #artifacts: ArtifactStore | undefined;
  #fence: SupervisorFence | undefined;
  #heartbeat: NodeJS.Timeout | undefined;
  #timer: NodeJS.Timeout | undefined;
  #timerFor: string | null = null;
  #pumping = false;
  #pumpAgain = false;
  #recovery: RecoverySummary | undefined;
  #startedAt = 0;
  #workerSeq = 0;
  #pumps = 0;
  #claimsAttempted = 0;
  #maxObservedActive = 0;
  #failure: string | null = null;
  #heartbeatMs = 0;
  #heartbeats = 0;
  #heartbeatsSkipped = 0;
  #pumpErrors = 0;
  #reconciliationWakes = 0;
  #observedGeneration: number | null = null;

  constructor(options: RuntimeOptions) {
    this.#opts = options;
    this.#registry = new ProcessorRegistry(options.processors);
    this.#clock = options.clock ?? systemClock;
    this.#backoff = options.backoff ?? new ExponentialBackoff();
    this.#log = options.logger ?? silentLogger;
    this.#concurrency = clampInt(options.concurrency, 2, 1, 64);
    this.#supervisorTtlMs = clampInt(options.supervisorTtlMs, 30_000, 300, 600_000);
    this.#jobLeaseMs = clampInt(options.jobLeaseMs, 60_000, 300, 3_600_000);
    this.#wake = new WakeSignal(() => this.#pump(), options.fault ? () => options.fault?.('wake.fileHint') : undefined);
    this.#heartbeatMs = Math.max(100, Math.floor(this.#supervisorTtlMs / 3));
    this.#models = new GovernedModelRuntime(options.governance?.providers ?? [], options.governance?.modelCallTimeoutMs);
    this.#tools = new ToolExecutor(options.governance?.toolDrivers ?? [], options.governance?.toolCallTimeoutMs);
  }

  // --- lifecycle --------------------------------------------------------------------------------

  get state(): RuntimeState {
    return this.#state;
  }

  async start(): Promise<RecoverySummary> {
    if (this.#state !== 'CREATED') throw new QandeelError('RUNTIME_NOT_READY', 'a runtime instance starts once', { state: this.#state });
    this.#state = 'STARTING';
    this.#startedAt = this.#clock.nowMs();
    try {
      const store = CompanyStore.open(this.#opts.workspace, {
        clock: this.#clock,
        runtimeVersion: RUNTIME_VERSION,
        ...(this.#opts.busyTimeoutMs !== undefined ? { busyTimeoutMs: this.#opts.busyTimeoutMs } : {}),
        ...(this.#opts.storageFault ? { fault: this.#opts.storageFault } : {}),
      });
      this.#store = store;
      this.#artifacts = new ArtifactStore(store);
      registerInstance(store, this.instanceId, process.pid, RUNTIME_VERSION);
      this.#log.info('runtime.starting', { instanceId: this.instanceId, schemaVersion: store.schemaVersion, migrationsApplied: store.migration.applied.length });

      this.#fence = await this.#acquireSupervisor(store);
      updateInstance(store, this.instanceId, 'RECOVERING', { supervisorToken: this.#fence.fencingToken });
      this.#state = 'RECOVERING';
      this.#startHeartbeat();

      const summary = runRecovery(store, this.#artifacts, {
        instanceId: this.instanceId,
        supervisor: this.#fence,
        ...(this.#opts.fault ? { fault: (p) => this.#opts.fault?.(p) } : {}),
      });
      this.#recovery = summary;
      this.#dispatchEvents();
      updateInstance(store, this.instanceId, 'READY', { recovery: summary });
      store.recordAudit('runtime.ready', 'runtime', this.instanceId, 'OK', null, { supervisorToken: this.#fence.fencingToken, claimsRecovered: summary.claimsRecovered });
      if (this.#opts.watchWakeFile ?? true) this.#wake.watchWakeFile(store.workspace.wakeFile);
      else this.#wake.disableWatcher();
      this.#state = 'READY';
      this.#log.info('runtime.ready', { instanceId: this.instanceId, supervisorToken: this.#fence.fencingToken, claimsRecovered: summary.claimsRecovered, dueJobs: summary.dueJobs });
      this.#pump();
      return summary;
    } catch (error) {
      this.#log.error('runtime.start_failed', { instanceId: this.instanceId, code: errorCode(error) });
      this.#failure = errorCode(error);
      this.#teardown('FAILED');
      throw error;
    }
  }

  async #acquireSupervisor(store: CompanyStore): Promise<SupervisorFence> {
    const deadline = this.#clock.nowMs() + (this.#opts.acquireTimeoutMs ?? this.#supervisorTtlMs + 5_000);
    for (let attempt = 0; attempt < 1_000; attempt++) {
      try {
        return acquireSupervisor(store, this.instanceId, this.#supervisorTtlMs);
      } catch (error) {
        if (!isQandeelError(error, 'LEASE_HELD') && !isQandeelError(error, 'STORAGE_BUSY')) throw error;
        const expiresAt = typeof error.details.expiresAt === 'string' ? Date.parse(error.details.expiresAt) : this.#clock.nowMs() + 250;
        const wait = Math.max(50, Math.min(expiresAt - this.#clock.nowMs() + 25, deadline - this.#clock.nowMs()));
        if (this.#clock.nowMs() >= deadline) throw error;
        this.#log.info('runtime.waiting_for_supervisor_lease', { instanceId: this.instanceId, waitMs: wait });
        await sleep(wait); // one bounded wait for the recorded expiry — not a polling loop
      }
    }
    throw new QandeelError('LEASE_HELD', 'supervisor lease could not be acquired');
  }

  /**
   * The supervisor heartbeat: renews authority and — in the same transaction — reads the durable
   * wake generation (lost-wake reconciliation, D-C1-23). It is the existing infrastructure cycle,
   * not a queue poll: it never scans or claims; it only pumps when the generation moved.
   */
  #startHeartbeat(): void {
    this.#heartbeat = setInterval(() => {
      const store = this.#store;
      if (!store || !this.#fence) return;
      let generation: number;
      try {
        generation = renewSupervisor(store, this.#fence, this.#supervisorTtlMs).wakeGeneration;
      } catch (error) {
        if (!isQandeelError(error, 'STORAGE_BUSY')) {
          this.#log.error('runtime.supervisor_authority_lost', { instanceId: this.instanceId, code: errorCode(error) });
          this.#failStop(errorCode(error));
          return;
        }
        // The TTL leaves two more beats of margin for the renewal. A WAL read never waits on the
        // writer, so reconciliation still observes the generation on this beat.
        try {
          generation = store.wakeGeneration();
        } catch {
          this.#heartbeatsSkipped++; // counted: each skipped beat extends the lost-wake bound by one interval
          return;
        }
      }
      this.#heartbeats++;
      this.#reconcileWake(generation);
    }, this.#heartbeatMs);
  }

  /** A generation the last pump did not start from means a wake hint may have been lost: pump. */
  #reconcileWake(generation: number): void {
    if (this.#state !== 'READY' || generation === this.#observedGeneration) return;
    this.#reconciliationWakes++;
    this.#log.info('runtime.wake_reconciled', { instanceId: this.instanceId, wakeGeneration: generation, observedWakeGeneration: this.#observedGeneration });
    this.#wake.signal();
  }

  /** Lost authority or an unrecoverable storage failure: stop writing, abort everything. */
  #failStop(code: string): void {
    if (this.#state === 'FAILED' || this.#state === 'STOPPED') return;
    this.#failure = code;
    for (const run of this.#active.values()) {
      run.reason = 'LEASE_LOST';
      run.fenced = true;
      run.controller.abort();
    }
    this.#teardown('FAILED');
    try {
      this.#opts.onFailStop?.(code);
    } catch {
      // A host callback never changes the fail-stop itself.
    }
  }

  #teardown(state: 'STOPPED' | 'FAILED'): void {
    this.#state = state;
    clearInterval(this.#heartbeat);
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#timerFor = null;
    this.#wake.close();
    if (this.#store && !this.#store.isClosed) {
      try {
        updateInstance(this.#store, this.instanceId, state);
      } catch {
        // Best effort: the instance is marked ABANDONED by the next supervisor's recovery.
      }
      this.#store.close();
    }
  }

  /**
   * Graceful shutdown: stop accepting work, persist intent, signal active processors, allow a
   * bounded settle period, park or recover what remains, release the lease, close the database.
   */
  async stop(): Promise<void> {
    if (this.#state !== 'READY' && this.#state !== 'RECOVERING') {
      if (this.#state !== 'STOPPED' && this.#state !== 'FAILED' && this.#store) this.#teardown('STOPPED');
      return;
    }
    const store = this.#store as CompanyStore;
    this.#state = 'STOPPING';
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#timerFor = null;
    this.#wake.close();
    updateInstance(store, this.instanceId, 'STOPPING');
    this.#log.info('runtime.stopping', { instanceId: this.instanceId, activeRuns: this.#active.size });
    for (const run of this.#active.values()) {
      run.reason = 'SHUTDOWN';
      run.controller.abort();
    }
    const grace = this.#opts.shutdownGraceMs ?? 10_000;
    const graceTimer = new AbortController();
    await Promise.race([
      Promise.all([...this.#active.values()].map((r) => r.done)),
      sleep(grace, undefined, { signal: graceTimer.signal }).catch(() => undefined),
    ]);
    graceTimer.abort(); // never leave a timer holding the process open
    for (const run of this.#active.values()) {
      // Did not settle within the grace period: fence and classify it now (as recovery would).
      run.fenced = true;
      try {
        if (this.#fence) interruptClaim(store, this.#fence, run.claim.fence.jobId, 'SHUTDOWN_TIMEOUT');
      } catch (error) {
        this.#log.warn('runtime.shutdown_interrupt_failed', { jobId: run.claim.fence.jobId, code: errorCode(error) });
      }
    }
    try {
      if (this.#fence) for (let i = 0; i < 20 && recoverGovernedOrphansCount(recoverGovernedOrphans(store, this.#fence)) > 0; i++);
    } catch (error) {
      this.#log.warn('runtime.shutdown_governed_recovery_failed', { code: errorCode(error) });
    }
    this.#dispatchEvents();
    if (this.#fence) releaseSupervisor(store, this.#fence);
    this.#log.info('runtime.stopped', { instanceId: this.instanceId });
    this.#teardown('STOPPED');
  }

  // --- work API (explicit capabilities; no generic "execute anything") --------------------------

  #ready(): CompanyStore {
    if (this.#state !== 'READY' || !this.#store) throw new QandeelError(this.#state === 'STOPPING' ? 'RUNTIME_STOPPING' : 'RUNTIME_NOT_READY', 'runtime is not accepting work', { state: this.#state });
    return this.#store;
  }

  /** Creates (and, when READY, enqueues) a Work Item; the commit wakes the dispatcher. */
  submitWorkItem(input: CreateWorkItemInput, options: CreateOptions = {}): CreateResult {
    const result = this.#ready().createWorkItem(input, options);
    this.#opts.fault?.('submit.afterCommit');
    this.#wake.signal();
    return result;
  }

  transitionWorkItem(id: Id, input: TransitionInput): WorkItemRecord {
    const r = this.#ready().transitionWorkItem(id, input);
    this.#wake.signal();
    return r;
  }

  addDependency(id: Id, dependsOnId: Id, actorRef?: string): WorkItemRecord {
    const r = this.#ready().addDependency(id, dependsOnId, actorRef);
    this.#wake.signal();
    return r;
  }

  /** Durable cancellation first; then the in-memory signal to any running processor. */
  cancel(id: Id, input: TerminationInput): TerminationOutcome {
    const out = this.#ready().requestCancellation(id, input);
    this.#signalTermination(out);
    return out;
  }

  supersede(id: Id, supersededById: Id, input: TerminationInput): TerminationOutcome {
    const out = this.#ready().supersede(id, supersededById, input);
    this.#signalTermination(out);
    return out;
  }

  #signalTermination(out: TerminationOutcome): void {
    for (const jobId of out.signalJobIds) {
      const run = this.#active.get(jobId);
      if (run) {
        run.reason = 'CANCEL';
        run.controller.abort();
      }
    }
    this.#wake.signal();
  }

  wake(workItemId: Id, reasonCode: string, actorRef?: string): boolean {
    const woke = this.#ready().wake(workItemId, reasonCode, actorRef);
    if (woke) this.#wake.signal();
    return woke;
  }

  requeueDeadLetter(jobId: Id, reasonCode: string, actorRef?: string): void {
    this.#ready().requeueDeadLetter(jobId, reasonCode, actorRef);
    this.#wake.signal();
  }

  resolveReconciliation(jobId: Id, decision: ReconciliationDecision, reasonCode: string, actorRef?: string): SettleOutcome {
    const out = this.#ready().resolveReconciliation(jobId, decision, reasonCode, actorRef);
    this.#wake.signal();
    return out;
  }

  /**
   * Read-only inspection for status tooling and tests (D-C1-22). The runtime never hands out its
   * mutable store: the view has read methods only and no path back to the store.
   */
  get view(): CompanyReadView {
    if (!this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    this.#view ??= this.#store.readView();
    return this.#view;
  }

  /**
   * Read-only artifact inspection (D-C1-22). Writing (processor `putArtifact`, fenced) and artifact
   * recovery belong to the runtime itself, so the mutable ArtifactStore is never handed out.
   */
  get artifacts(): ArtifactReadView {
    const artifacts = this.#artifacts;
    if (!artifacts || !this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    this.#artifactView ??= Object.freeze({
      get: (id: Id) => artifacts.get(id),
      listForWorkItem: (workItemId: Id) => artifacts.listForWorkItem(workItemId),
      read: (id: Id) => artifacts.read(id),
    });
    return this.#artifactView;
  }

  async backup(): Promise<{ backup: BackupResult; verification: BackupVerification }> {
    const store = this.#ready();
    const result = await createBackup(store, { runtimeVersion: RUNTIME_VERSION });
    const expected = store.backupRecord(result.backupId);
    if (!expected) throw new QandeelError('BACKUP_INTEGRITY', 'the live Company holds no record of the backup it just produced', { backupId: result.backupId });
    const verification = verifyBackup(result.directory, {
      liveDatabasePath: store.workspace.databasePath,
      artifactObjectsDir: store.workspace.objectsDir,
      expected,
    });
    return { backup: result, verification };
  }

  /**
   * C2 governance administration (Founder-authority operations, reads, health). It is a capability
   * object, not the store: it executes nothing and claims nothing, and every call signals the
   * dispatcher afterwards so an approval or cap increase that made work actionable is picked up.
   * Founder-authority writes fail closed until the authenticated Founder surface exists (C5,
   * D-C2-13): holding this object, or a Founder reference, grants no authority.
   */
  get governance(): GovernanceAdmin {
    if (!this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    if (!this.#governanceAdmin) {
      const target = GovernanceStore.for(this.#store);
      const wake = (): void => this.#wake.signal();
      this.#governanceAdmin = new Proxy(target, {
        get(t, prop, receiver) {
          const v = Reflect.get(t, prop, receiver) as unknown;
          if (typeof v !== 'function') return v;
          return (...args: unknown[]) => {
            try {
              return (v as (...a: unknown[]) => unknown).apply(t, args);
            } finally {
              wake();
            }
          };
        },
      });
    }
    return this.#governanceAdmin;
  }

  /**
   * C3 administration: memory / knowledge, Skills, Academy and capability requirements. Like
   * `governance`, a capability object that executes nothing and claims nothing; every call signals the
   * dispatcher afterwards (a certification can resolve a capability gap and wake the parked work).
   * Founder-authority writes fail closed until the authenticated Founder surface exists (C5).
   */
  get mind(): MindAdmin {
    if (!this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    if (!this.#mindAdmin) {
      const wake = (): void => this.#wake.signal();
      const wrap = <T extends object>(target: T): T =>
        new Proxy(target, {
          get(t, prop, receiver) {
            const v = Reflect.get(t, prop, receiver) as unknown;
            if (typeof v !== 'function') return v;
            return (...args: unknown[]) => {
              try {
                return (v as (...a: unknown[]) => unknown).apply(t, args);
              } finally {
                wake();
              }
            };
          },
        });
      const s = this.#store;
      this.#mindAdmin = Object.freeze({ memory: wrap(MemoryStore.for(s)), skills: wrap(SkillStore.for(s)), academy: wrap(AcademyStore.for(s)), capability: wrap(CapabilityStore.for(s)) });
    }
    return this.#mindAdmin;
  }

  /** C3 health counts (content-free). */
  mindHealth(): C3Health {
    if (!this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    return c3HealthOf(this.#store);
  }

  /** Governed execution diagnostics (content-free). */
  governanceDiagnostics(): { providerCalls: number; providerAdapters: readonly string[]; toolDrivers: readonly string[] } {
    return { providerCalls: this.#models.providerCalls, providerAdapters: this.#models.adapterCodes, toolDrivers: this.#tools.driverCodes };
  }

  /** In-process subscribers to durable outbox events (delivered at least once, after commit). */
  onEvent(handler: EventHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  get recovery(): RecoverySummary | undefined {
    return this.#recovery;
  }

  get failure(): string | null {
    return this.#failure;
  }

  get concurrency(): number {
    return this.#concurrency;
  }

  get uptimeMs(): number {
    return this.#startedAt === 0 ? 0 : this.#clock.nowMs() - this.#startedAt;
  }

  get processorKinds(): readonly string[] {
    return this.#registry.kinds;
  }

  diagnostics(): RuntimeDiagnostics {
    return {
      state: this.#state,
      pumps: this.#pumps,
      claimsAttempted: this.#claimsAttempted,
      activeRuns: this.#active.size,
      maxObservedActive: this.#maxObservedActive,
      timerArmedFor: this.#timerFor,
      wakeSignals: this.#wake.signals,
      wakeWatcher: this.#wake.watcherState,
      wakeFileHints: this.#wake.fileHints,
      wakeFileHintsDropped: this.#wake.fileHintsDropped,
      heartbeats: this.#heartbeats,
      heartbeatsSkipped: this.#heartbeatsSkipped,
      consecutivePumpErrors: this.#pumpErrors,
      reconciliationWakes: this.#reconciliationWakes,
      observedWakeGeneration: this.#observedGeneration,
      lostWakeBoundMs: this.#heartbeatMs,
    };
  }

  /** Resolves when no run is active and nothing is due right now (test/acceptance helper). */
  async whenIdle(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.#state !== 'READY') return;
      if (this.#active.size === 0 && !this.#pumping && this.#store && this.#store.healthCounts().dueJobs === 0) return;
      await Promise.race([...[...this.#active.values()].map((r) => r.done), sleep(25)]);
    }
    throw new QandeelError('RUNTIME_NOT_READY', 'runtime did not become idle in time');
  }

  // --- dispatcher ---------------------------------------------------------------------------------

  #pump(): void {
    if (this.#state !== 'READY' || !this.#store || !this.#fence) return;
    if (this.#pumping) {
      this.#pumpAgain = true;
      return;
    }
    this.#pumping = true;
    this.#pumps++;
    const store = this.#store;
    try {
      do {
        this.#pumpAgain = false;
        // Read before scanning: a commit after this read moves the generation past it, so the next
        // heartbeat pumps again. Nothing committed can be missed between two pumps.
        this.#observedGeneration = store.wakeGeneration();
        this.#dispatchEvents();
        this.#noticeCrossProcessCancellation(store);
        let interrupted = 0;
        for (const jobId of store.expiredClaims(this.#concurrency)) {
          if (this.#active.has(jobId)) this.#active.get(jobId)?.controller.abort();
          interruptClaim(store, this.#fence, jobId, 'LEASE_EXPIRED');
          interrupted++;
        }
        // Governed work left by an interrupted run is classified at once (held / retryable).
        if (interrupted > 0) for (let i = 0; i < 20 && recoverGovernedOrphansCount(recoverGovernedOrphans(store, this.#fence)) > 0; i++);
        while (this.#active.size < this.#concurrency && this.#state === 'READY') {
          this.#claimsAttempted++;
          const claim = claimNext(store, { workerId: `${this.instanceId}:${++this.#workerSeq}`, leaseMs: this.#jobLeaseMs, kinds: this.#registry.sideEffects, supervisor: this.#fence });
          if (!claim) break;
          this.#opts.fault?.('claim.afterCommit');
          this.#startRun(claim);
        }
      } while (this.#pumpAgain && this.#state === 'READY');
      this.#pumpErrors = 0;
      this.#armTimer(store);
    } catch (error) {
      if (isQandeelError(error, 'SUPERVISOR_NOT_AUTHORITATIVE')) {
        // The lease may merely have expired (host sleep). Renewal is token-conditional: it succeeds
        // only if no other supervisor took over; then the pump simply runs again.
        try {
          renewSupervisor(store, this.#fence, this.#supervisorTtlMs);
          this.#armRetryTimer();
        } catch (renewError) {
          if (isQandeelError(renewError, 'STORAGE_BUSY')) {
            this.#armRetryTimer();
          } else {
            this.#log.error('runtime.supervisor_authority_lost', { instanceId: this.instanceId });
            this.#failStop('SUPERVISOR_NOT_AUTHORITATIVE');
          }
        }
      } else {
        // A persistent error must not become a fixed-rate loop: back off exponentially (250 ms → 30 s).
        this.#pumpErrors++;
        this.#log.warn('runtime.pump_error', { code: errorCode(error), consecutive: this.#pumpErrors });
        this.#armRetryTimer(Math.min(30_000, 250 * 2 ** Math.min(this.#pumpErrors - 1, 7)));
      }
    } finally {
      this.#pumping = false;
    }
  }

  /** A cancellation requested by another process is durable; notice it for local active runs. */
  #noticeCrossProcessCancellation(store: CompanyStore): void {
    for (const [jobId, run] of this.#active) {
      if (run.reason === null && store.getJob(jobId).cancelRequested) {
        run.reason = 'CANCEL';
        run.controller.abort();
      }
    }
  }

  /** One timer for the earliest due job or lease expiry. None when idle or at capacity. */
  #armTimer(store: CompanyStore): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#timerFor = null;
    if (this.#state !== 'READY' || this.#active.size >= this.#concurrency) return;
    const due = store.nextDueAt(this.#registry.kinds);
    if (due === null) return;
    const delay = Date.parse(due) - this.#clock.nowMs();
    this.#timerFor = due;
    // A due-now result while below capacity means the claim could not proceed; back off instead of spinning.
    this.#timer = setTimeout(() => this.#pump(), delay > 0 ? Math.min(delay, 2_147_000_000) : 1_000);
  }

  #armRetryTimer(delayMs = 250): void {
    clearTimeout(this.#timer);
    this.#timerFor = 'retry';
    this.#timer = setTimeout(() => this.#pump(), delayMs);
  }

  #dispatchEvents(): void {
    const store = this.#store;
    if (!store || this.#handlers.size === 0) {
      if (store && this.#handlers.size === 0) {
        const pending = store.pendingEvents(500);
        if (pending.length) store.markDispatched(pending.map((e) => e.id));
      }
      return;
    }
    const pending = store.pendingEvents(500);
    for (const event of pending) {
      for (const handler of this.#handlers) {
        try {
          handler(event);
        } catch (error) {
          this.#log.warn('runtime.event_handler_error', { eventId: event.id, code: errorCode(error) });
        }
      }
    }
    store.markDispatched(pending.map((e) => e.id));
  }

  // --- execution ------------------------------------------------------------------------------------

  #startRun(claim: Claim): void {
    const processor = this.#registry.get(claim.job.processorKind);
    if (!processor) return; // unreachable: claims are filtered by registered kinds
    const run: ActiveRun = { claim, processor, controller: new AbortController(), reason: null, fenced: false, settled: false, done: Promise.resolve() };
    this.#active.set(claim.fence.jobId, run);
    this.#maxObservedActive = Math.max(this.#maxObservedActive, this.#active.size);
    this.#log.info('run.started', { jobId: claim.fence.jobId, runId: claim.fence.runId, workItemId: claim.workItem.id, kind: processor.kind, attempt: claim.run.attempt, fencingToken: claim.fence.fencingToken });
    run.done = this.#execute(run).finally(() => {
      this.#active.delete(claim.fence.jobId);
      this.#wake.signal(); // a slot is free
    });
  }

  async #execute(run: ActiveRun): Promise<void> {
    const { claim, processor } = run;
    const store = this.#store as CompanyStore;
    const leaseMs = this.#jobLeaseMs;
    const renew = setInterval(() => {
      if (run.fenced || run.settled) return;
      try {
        renewLease(store, claim.fence, leaseMs);
      } catch (error) {
        if (isQandeelError(error, 'STORAGE_BUSY')) return;
        run.fenced = true;
        run.reason = 'LEASE_LOST';
        run.controller.abort();
      }
    }, Math.max(100, Math.floor(leaseMs / 3)));
    const maxRunMs = processor.maxRunMs ?? this.#opts.defaultMaxRunMs ?? 10 * 60_000;
    const timeout = setTimeout(() => {
      run.reason = 'TIMEOUT';
      run.controller.abort();
    }, maxRunMs);

    const context: ProcessorContext = {
      workItemId: claim.workItem.id,
      rootWorkItemId: claim.workItem.rootId,
      jobId: claim.fence.jobId,
      runId: claim.fence.runId,
      attempt: claim.run.attempt,
      correlationId: claim.job.correlationId,
      processorKind: processor.kind,
      input: claim.workItem.processorInput as JsonValue,
      resumeFrom: claim.resumeFrom
        ? { runId: claim.resumeFrom.runId, seq: claim.resumeFrom.seq, kind: claim.resumeFrom.kind, kindVersion: claim.resumeFrom.kindVersion, state: claim.resumeFrom.state as JsonValue, createdAt: claim.resumeFrom.createdAt }
        : null,
      signal: run.controller.signal,
      checkpoint: async (kind, state, kindVersion = 1) => {
        if (run.fenced || run.settled) throw new QandeelError('STALE_LEASE', 'this run no longer owns its job', { jobId: claim.fence.jobId });
        try {
          checkpoint(store, claim.fence, kind, state, kindVersion, leaseMs);
        } catch (error) {
          if (isQandeelError(error, 'STALE_LEASE')) {
            run.fenced = true;
            run.controller.abort();
          }
          throw error;
        }
      },
      putArtifact: async (content, mediaType, label) => {
        const record = this.putRunArtifact(claim.fence.jobId, content, mediaType, label);
        return { artifactId: record.id, sha256: record.sha256 };
      },
    };

    let result: ProcessorResult;
    try {
      // After an abort the processor gets a bounded grace period; an unresponsive processor is
      // abandoned (its late writes are fenced) so it cannot pin a worker slot forever.
      const graceTimer = new AbortController();
      const abandoned = new Promise<'ABANDONED'>((resolve) => {
        run.controller.signal.addEventListener(
          'abort',
          () => void sleep(this.#opts.shutdownGraceMs ?? 10_000, undefined, { signal: graceTimer.signal }).then(() => resolve('ABANDONED'), () => undefined),
          { once: true },
        );
      });
      try {
        const outcome = await Promise.race([this.#runProcessor(processor, context, claim, store, run.controller.signal), abandoned]);
        result = outcome === 'ABANDONED' ? { type: 'CANCELLED' } : outcome;
      } finally {
        graceTimer.abort();
      }
    } catch (error) {
      result = isQandeelError(error, 'STALE_LEASE') ? { type: 'CANCELLED' } : processor.sideEffects === 'UNSAFE' ? { type: 'RECONCILIATION_REQUIRED', code: 'PROCESSOR_ERROR' } : { type: 'RETRYABLE_FAILURE', code: 'PROCESSOR_ERROR' };
      this.#log.warn('run.processor_error', { jobId: claim.fence.jobId, runId: claim.fence.runId, code: errorCode(error) });
    } finally {
      clearTimeout(timeout);
    }

    // Without a runtime-initiated stop (cancel, shutdown, timeout, lost lease), a processor that
    // reports CANCELLED stopped on its own: that is a failed attempt, never a free re-queue (a free
    // re-queue could loop without consuming any retry budget).
    if (result.type === 'CANCELLED' && run.reason === null) {
      result = processor.sideEffects === 'UNSAFE' ? { type: 'RECONCILIATION_REQUIRED', code: 'PROCESSOR_STOPPED_UNPROMPTED' } : { type: 'RETRYABLE_FAILURE', code: 'PROCESSOR_STOPPED_UNPROMPTED' };
    }
    // A timed wait must name a future canonical instant; anything else is a processor defect.
    if (result.type === 'WAIT' && result.until !== undefined && !(isTimestamp(result.until) && Date.parse(result.until) > this.#clock.nowMs())) {
      result = { type: 'RETRYABLE_FAILURE', code: 'INVALID_WAIT' };
    }
    if (run.reason === 'TIMEOUT') result = processor.sideEffects === 'UNSAFE' ? { type: 'RECONCILIATION_REQUIRED', code: 'RUN_TIMEOUT' } : { type: 'RETRYABLE_FAILURE', code: 'RUN_TIMEOUT' };
    if (run.fenced || run.reason === 'LEASE_LOST' || store.isClosed) {
      clearInterval(renew);
      this.#log.warn('run.fenced', { jobId: claim.fence.jobId, runId: claim.fence.runId, fencingToken: claim.fence.fencingToken });
      run.settled = true;
      return;
    }
    // A completed result must not be lost to transient write contention: settle is retried with a
    // bounded backoff while the lease heartbeat keeps the claim alive. Only a fenced (stale) or
    // non-transient failure gives up; the claim then expires and recovery classifies it.
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const outcome = settle(store, claim.fence, result, { backoff: this.#backoff, ...(run.reason === 'TIMEOUT' ? { failureCategory: 'TIMEOUT' as const } : {}) });
          this.#log.info('run.settled', { jobId: claim.fence.jobId, runId: claim.fence.runId, result: result.type, jobState: outcome.jobState, workItemState: outcome.workItemState });
          break;
        } catch (error) {
          if (isQandeelError(error, 'STORAGE_BUSY') && attempt < 10 && !run.fenced && !store.isClosed) {
            this.#log.warn('run.settle_retry', { jobId: claim.fence.jobId, attempt: attempt + 1 });
            await sleep(Math.min(2_000, 50 * 2 ** attempt));
            continue;
          }
          this.#log.warn(isQandeelError(error, 'STALE_LEASE') ? 'run.fenced' : 'run.settle_failed', { jobId: claim.fence.jobId, runId: claim.fence.runId, code: errorCode(error) });
          break;
        }
      }
    } finally {
      clearInterval(renew);
      run.settled = true;
    }
  }

  /**
   * Plain processors run as in C1. A governed processor first has its run bound to an eligible
   * Employee (the runtime refuses ineligible Employees before any model or tool call), then receives
   * services bound to this claim's fence — never the store, an adapter or a driver.
   */
  async #runProcessor(processor: Processor, context: ProcessorContext, claim: Claim, store: CompanyStore, signal: AbortSignal): Promise<ProcessorResult> {
    if (!isGovernedProcessor(processor)) return processor.run(context);
    const begun = beginGovernedRun(store, claim.fence);
    if (!begun.ok) {
      this.#log.warn('run.governance_refused', { jobId: claim.fence.jobId, runId: claim.fence.runId, code: begun.code });
      // A capability gap is durable and parks the work (event-driven, zero tokens) until resolved (C3).
      if (begun.code === 'CAPABILITY_GAP') return { type: 'WAIT', reasonCode: 'CAPABILITY_GAP' };
      return { type: 'PERMANENT_FAILURE', code: begun.code };
    }
    const run = begun.context;
    const services: GovernedRunServices = Object.freeze({
      context: run,
      // Every inference goes through governed Context Assembly first (C3): the processor names the
      // step, the runtime builds, budgets and records the context; the model runtime accepts only that.
      invokeModel: async (request: ModelCallRequest): Promise<ModelCallOutcome> => {
        const assembled = assembleGovernedContext(store, claim.fence, { step: request.step, recentResults: request.recentResults });
        if (assembled.kind !== 'OK') return { kind: 'CONTEXT', code: assembled.code };
        return this.#models.call(store, claim.fence, run, request, assembled.context, signal);
      },
      proposeMemory: (proposal: MemoryProposal, step: number) => proposeMemory(store, claim.fence, proposal, step),
      executeTool: (request: ToolRequest, step: number) => this.#tools.execute(store, claim.fence, run, request, step, signal),
    });
    return processor.runGoverned(context, services);
  }

  // --- artifacts from processors ------------------------------------------------------------------

  /**
   * Stores an artifact for a running job. The caller's claim is re-validated (fenced lease renew)
   * first, so a replaced worker cannot attach artifacts to work it no longer owns.
   */
  putRunArtifact(claimJobId: Id, content: Uint8Array | string, mediaType: string, label?: string): ArtifactRecord {
    const run = this.#active.get(claimJobId);
    if (!run || run.fenced || run.settled) throw new QandeelError('STALE_LEASE', 'no active run owns this job', { jobId: claimJobId });
    // The fence is verified inside the same transactions that stage and promote the artifact.
    if (!this.#artifacts || !this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    return this.#artifacts.put({ content, mediaType, workItemId: run.claim.workItem.id, runId: run.claim.fence.runId, fence: run.claim.fence, ...(label !== undefined ? { label } : {}) });
  }
}
