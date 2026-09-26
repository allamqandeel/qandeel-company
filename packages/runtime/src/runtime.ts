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
 * Correctness never depends on graceful shutdown: hard termination is handled by lease expiry,
 * fencing and startup recovery.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import {
  ExponentialBackoff,
  QandeelError,
  isQandeelError,
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
} from '@qandeel-company/storage';

import { ProcessorRegistry } from './deterministic-processors.js';
import { Logger, errorCode, silentLogger } from './logger.js';
import { runRecovery, type RecoverySummary } from './recovery.js';
import { WakeSignal } from './wake.js';

export const RUNTIME_VERSION = '0.1.0';

export type RuntimeState = 'CREATED' | 'STARTING' | 'RECOVERING' | 'READY' | 'STOPPING' | 'STOPPED' | 'FAILED';

/** Named runtime durability boundaries for failure-injection tests (production passes nothing). */
export type RuntimeFaultPoint = 'submit.afterCommit' | 'claim.afterCommit' | 'recovery.afterClaims';

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
  readonly fault?: (point: RuntimeFaultPoint) => void;
  readonly storageFault?: FaultHook;
}

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
}

export type EventHandler = (event: EventRecord) => void;

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

  #state: RuntimeState = 'CREATED';
  #store: CompanyStore | undefined;
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

  constructor(options: RuntimeOptions) {
    this.#opts = options;
    this.#registry = new ProcessorRegistry(options.processors);
    this.#clock = options.clock ?? systemClock;
    this.#backoff = options.backoff ?? new ExponentialBackoff();
    this.#log = options.logger ?? silentLogger;
    this.#concurrency = clampInt(options.concurrency, 2, 1, 64);
    this.#supervisorTtlMs = clampInt(options.supervisorTtlMs, 30_000, 300, 600_000);
    this.#jobLeaseMs = clampInt(options.jobLeaseMs, 60_000, 300, 3_600_000);
    this.#wake = new WakeSignal(() => this.#pump());
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
      store.registerInstance(this.instanceId, process.pid, RUNTIME_VERSION);
      this.#log.info('runtime.starting', { instanceId: this.instanceId, schemaVersion: store.schemaVersion, migrationsApplied: store.migration.applied.length });

      this.#fence = await this.#acquireSupervisor(store);
      store.updateInstance(this.instanceId, 'RECOVERING', { supervisorToken: this.#fence.fencingToken });
      this.#state = 'RECOVERING';
      this.#startHeartbeat();

      const summary = runRecovery(store, this.#artifacts, {
        instanceId: this.instanceId,
        ...(this.#opts.fault ? { fault: (p) => this.#opts.fault?.(p) } : {}),
      });
      this.#recovery = summary;
      this.#dispatchEvents();
      store.updateInstance(this.instanceId, 'READY', { recovery: summary });
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
        return store.acquireSupervisor(this.instanceId, this.#supervisorTtlMs);
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

  #startHeartbeat(): void {
    const interval = Math.max(100, Math.floor(this.#supervisorTtlMs / 3));
    this.#heartbeat = setInterval(() => {
      if (!this.#store || !this.#fence) return;
      try {
        this.#store.renewSupervisor(this.#fence, this.#supervisorTtlMs);
      } catch (error) {
        if (isQandeelError(error, 'STORAGE_BUSY')) return; // TTL leaves two more beats of margin
        this.#log.error('runtime.supervisor_authority_lost', { instanceId: this.instanceId, code: errorCode(error) });
        this.#failStop(errorCode(error));
      }
    }, interval);
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
        this.#store.updateInstance(this.instanceId, state);
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
    store.updateInstance(this.instanceId, 'STOPPING');
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
        store.interruptClaim(run.claim.fence.jobId, 'SHUTDOWN_TIMEOUT');
      } catch (error) {
        this.#log.warn('runtime.shutdown_interrupt_failed', { jobId: run.claim.fence.jobId, code: errorCode(error) });
      }
    }
    this.#dispatchEvents();
    if (this.#fence) store.releaseSupervisor(this.#fence);
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

  /** Read access for status tooling and tests. Returns the store only while the runtime runs. */
  get store(): CompanyStore {
    if (!this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    return this.#store;
  }

  get artifacts(): ArtifactStore {
    if (!this.#artifacts || !this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    return this.#artifacts;
  }

  async backup(): Promise<{ backup: BackupResult; verification: BackupVerification }> {
    const store = this.#ready();
    const result = await createBackup(store, { runtimeVersion: RUNTIME_VERSION });
    const expected = store.backupRecord(result.backupId);
    const verification = verifyBackup(result.directory, {
      liveDatabasePath: store.workspace.databasePath,
      artifactObjectsDir: store.workspace.objectsDir,
      ...(expected ? { expected } : {}),
    });
    return { backup: result, verification };
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
        this.#dispatchEvents();
        this.#noticeCrossProcessCancellation(store);
        for (const jobId of store.expiredClaims(this.#concurrency)) {
          if (this.#active.has(jobId)) this.#active.get(jobId)?.controller.abort();
          store.interruptClaim(jobId, 'LEASE_EXPIRED');
        }
        while (this.#active.size < this.#concurrency && this.#state === 'READY') {
          this.#claimsAttempted++;
          const claim = store.claimNext({ workerId: `${this.instanceId}:${++this.#workerSeq}`, leaseMs: this.#jobLeaseMs, kinds: this.#registry.sideEffects, supervisor: this.#fence });
          if (!claim) break;
          this.#opts.fault?.('claim.afterCommit');
          this.#startRun(claim);
        }
      } while (this.#pumpAgain && this.#state === 'READY');
      this.#armTimer(store);
    } catch (error) {
      if (isQandeelError(error, 'SUPERVISOR_NOT_AUTHORITATIVE')) {
        this.#log.error('runtime.supervisor_authority_lost', { instanceId: this.instanceId });
        this.#failStop('SUPERVISOR_NOT_AUTHORITATIVE');
      } else {
        this.#log.warn('runtime.pump_error', { code: errorCode(error) });
        this.#armRetryTimer();
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

  #armRetryTimer(): void {
    clearTimeout(this.#timer);
    this.#timerFor = 'retry';
    this.#timer = setTimeout(() => this.#pump(), 250);
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
        store.renewLease(claim.fence, leaseMs);
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
          store.checkpoint(claim.fence, kind, state, kindVersion, leaseMs);
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
        const outcome = await Promise.race([processor.run(context), abandoned]);
        result = outcome === 'ABANDONED' ? { type: 'CANCELLED' } : outcome;
      } finally {
        graceTimer.abort();
      }
    } catch (error) {
      result = isQandeelError(error, 'STALE_LEASE') ? { type: 'CANCELLED' } : processor.sideEffects === 'UNSAFE' ? { type: 'RECONCILIATION_REQUIRED', code: 'PROCESSOR_ERROR' } : { type: 'RETRYABLE_FAILURE', code: 'PROCESSOR_ERROR' };
      this.#log.warn('run.processor_error', { jobId: claim.fence.jobId, runId: claim.fence.runId, code: errorCode(error) });
    } finally {
      clearInterval(renew);
      clearTimeout(timeout);
    }

    if (run.reason === 'TIMEOUT') result = processor.sideEffects === 'UNSAFE' ? { type: 'RECONCILIATION_REQUIRED', code: 'RUN_TIMEOUT' } : { type: 'RETRYABLE_FAILURE', code: 'RUN_TIMEOUT' };
    if (run.fenced || run.reason === 'LEASE_LOST' || store.isClosed) {
      this.#log.warn('run.fenced', { jobId: claim.fence.jobId, runId: claim.fence.runId, fencingToken: claim.fence.fencingToken });
      run.settled = true;
      return;
    }
    try {
      const outcome = store.settle(claim.fence, result, { backoff: this.#backoff, ...(run.reason === 'TIMEOUT' ? { failureCategory: 'TIMEOUT' as const } : {}) });
      this.#log.info('run.settled', { jobId: claim.fence.jobId, runId: claim.fence.runId, result: result.type, jobState: outcome.jobState, workItemState: outcome.workItemState });
    } catch (error) {
      this.#log.warn(isQandeelError(error, 'STALE_LEASE') ? 'run.fenced' : 'run.settle_failed', { jobId: claim.fence.jobId, runId: claim.fence.runId, code: errorCode(error) });
    } finally {
      run.settled = true;
    }
  }

  // --- artifacts from processors ------------------------------------------------------------------

  /**
   * Stores an artifact for a running job. The caller's claim is re-validated (fenced lease renew)
   * first, so a replaced worker cannot attach artifacts to work it no longer owns.
   */
  putRunArtifact(claimJobId: Id, content: Uint8Array | string, mediaType: string, label?: string): ArtifactRecord {
    const run = this.#active.get(claimJobId);
    if (!run || run.fenced || run.settled) throw new QandeelError('STALE_LEASE', 'no active run owns this job', { jobId: claimJobId });
    this.store.renewLease(run.claim.fence, this.#jobLeaseMs);
    return this.artifacts.put({ content, mediaType, workItemId: run.claim.workItem.id, runId: run.claim.fence.runId, ...(label !== undefined ? { label } : {}) });
  }
}
