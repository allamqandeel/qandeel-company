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

import type { AcademyPackage, EmployeeIdentityProfile } from '@qandeel-company/mind';
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
  type JsonObject,
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
  AttentionStore,
  CapabilityStore,
  CommunicationStore,
  FounderActionStore,
  FounderAuthStore,
  GoalStore,
  ImprovementStore,
  ExternalEvidenceStore,
  PilotStore,
  DigitalStore,
  promotionArgsOf,
  resolvePromotionExport,
  resolvePromotionTarget,
  type PromotionExportResult,
  MemoryStore,
  OrganizationStore,
  ReviewStore,
  SkillStore,
  createPortableBackup,
  activationView,
  academyOverview,
  type AnswerRecord,
  projectUniverse,
  type ActivationView,
  type AcademyOverview,
  pruneLocalBackups,
  prunePortableBackups,
  resilienceStatus,
  runRestoreDrill,
  safeUpgrade,
  type BackupDestination,
  type PortableBackupResult,
  type ResilienceStatus,
  type RetentionPolicy,
  type AttentionSyncReport,
  type CompanyUniverse,
} from '@qandeel-company/storage';
import type { OutputDiagnosticCode, ProviderAdapter, ProviderProvisioningProfile, ToolDriver } from '@qandeel-company/governance';

import { GovernedModelRuntime } from './c2/model-runtime.js';
import { ToolExecutor } from './c2/tool-executor.js';
import { isGovernedProcessor, type AnswerProposal, type GoalActProposal, type GovernedRunServices, type MemoryProposal, type MessageProposal, type ModelCallOutcome, type ModelCallRequest, type OrgActProposal, type ReviewDecisionProposal, type ToolRequest } from './c2/types.js';
import { assembleGovernedContext } from './c3/context-assembler.js';
import { c3HealthOf, type C3Health } from './c3/health.js';
import { proposeMemory } from './c3/memory-proposals.js';
import { c4HealthOf, type C4Health } from './c4/health.js';
import {
  GOVERNED_STEP_SPAN,
  OPEN_HANDOFF_STATES,
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
  recordGoalAct,
  recordAnswer,
  recordMessage,
  recordOrgAct,
  recordReviewDecision,
  recordStepResult,
  recordInvalidOutput,
  settle,
  updateInstance,
} from '@qandeel-company/storage/runtime-authority';

import { ProcessorRegistry } from './deterministic-processors.js';
import { Logger, errorCode, silentLogger } from './logger.js';
import { runRecovery, type RecoverySummary } from './recovery.js';
import { admitRuntimeRelease } from './release.js';
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
    /** L1-01: release-pinned provider profiles the Founder may provision through the governed confirmation. */
    readonly provisioningProfiles?: readonly ProviderProvisioningProfile[];
    /** L1-02: release-pinned Academy packages the Founder may qualify / install through the governed confirmation. */
    readonly academyPackages?: readonly AcademyPackage[];
    /** L1-02: release-pinned Employee identity profiles a governed hire may name. */
    readonly identityProfiles?: readonly EmployeeIdentityProfile[];
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
/** C4 administration: the organization and the Review Pool (Founder writes fail closed until C5). */
export interface OrgAdmin {
  readonly organization: OrganizationStore;
  readonly review: ReviewStore;
}
/** C5 Founder surface administration (see `CompanyRuntime.founder`). */
export interface FounderAdmin {
  readonly auth: FounderAuthStore;
  readonly goals: GoalStore;
  readonly communications: CommunicationStore;
  readonly attention: AttentionStore;
  readonly actions: FounderActionStore;
  /** C6 Company Improvement Engine (evaluation, attribution, learning, reports) under the same signalling contract. */
  readonly improvement: ImprovementStore;
  /** C7-A governed sources, evidence bindings and the content-free intake seam, under the same signalling contract. */
  readonly external: ExternalEvidenceStore;
  /** C7-C Pilots: Founder-decided contexts and their derived Evidence Board, under the same signalling contract. */
  readonly pilots: PilotStore;
  /** C7-D: the Digital Workshop read model and Founder-only promotion-target registration. */
  readonly digital: DigitalStore;
  universe(options?: { at?: string }): CompanyUniverse;
  /** L1-02: the Company activation flow, read from durable state only (silent; never a write). */
  activation(): ActivationView;
  /** D2-UX-01: the company-wide Academy overview, or one Employee's slice of it (silent; never a write, never a call). */
  academy(options?: { employeeId?: Id }): AcademyOverview;
  /** L1-02: the candidate's durable answer to one Academy attempt (Founder-scoped content; silent read), or null. */
  attemptAnswer(attemptId: string): AnswerRecord | null;
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

/** How each public method of a Founder store relates to "the Founder's world changed" (D-C5-17). */
interface SignallingContract {
  /** Announces once after the call returns; a call that throws announces nothing. */
  readonly mutating: readonly string[];
  /** Announces nothing and wakes nothing. */
  readonly reads: readonly string[];
  /** Announces once only when the predicate holds for what the call returned. */
  readonly conditional?: Readonly<Record<string, (result: unknown) => boolean>>;
  /** For a conditional method: announces once when it throws a refusal that nevertheless committed new state. */
  readonly committedRefusal?: Readonly<Record<string, (error: unknown) => boolean>>;
}

/**
 * A Founder store behind its explicit signalling contract. Every public method of the store must be
 * classified, and every classified name must exist: a store that gains a method without a class is refused
 * here, at construction, so nothing is ever defaulted to a write (or, worse, to a read).
 */
function signalling<T extends object>(target: T, changed: () => void, contract: SignallingContract): T {
  const conditional = contract.conditional ?? {};
  const classes = new Map<string, 'mutating' | 'read' | 'conditional'>();
  for (const name of contract.mutating) classes.set(name, 'mutating');
  for (const name of contract.reads) classes.set(name, 'read');
  for (const name of Object.keys(conditional)) classes.set(name, 'conditional');
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(target) as object).filter((name) => name !== 'constructor' && typeof (target as Record<string, unknown>)[name] === 'function');
  const unclassified = methods.filter((name) => !classes.has(name));
  const unknown = [...classes.keys()].filter((name) => !methods.includes(name));
  if (unclassified.length > 0 || unknown.length > 0) throw new QandeelError('VALIDATION_FAILED', 'founder store signalling contract is out of date', { store: target.constructor.name, unclassified: unclassified.join(','), unknown: unknown.join(',') });
  const out: Record<string, unknown> = {};
  for (const name of methods) {
    const fn = (target as Record<string, (...args: unknown[]) => unknown>)[name] as (...args: unknown[]) => unknown;
    const kind = classes.get(name);
    if (kind === 'read') out[name] = (...args: unknown[]) => fn.apply(target, args);
    else if (kind === 'mutating') out[name] = (...args: unknown[]) => { const result = fn.apply(target, args); changed(); return result; };
    else {
      // A refusal that still committed something (e.g. a recorded intake conflict) announces when the contract says so.
      const committedRefusal = contract.committedRefusal?.[name];
      out[name] = (...args: unknown[]) => {
        let result: unknown;
        try {
          result = fn.apply(target, args);
        } catch (error) {
          if (committedRefusal?.(error)) changed();
          throw error;
        }
        if (conditional[name]?.(result)) changed();
        return result;
      };
    }
  }
  return Object.freeze(out) as unknown as T;
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
  /** Active runs of this process, keyed by run ID (a job may briefly have a fenced old run and a new one). */
  readonly #active = new Map<Id, ActiveRun>();
  readonly #handlers = new Set<EventHandler>();
  readonly #models: GovernedModelRuntime;
  readonly #tools: ToolExecutor;
  #governanceAdmin: GovernanceAdmin | undefined;
  #mindAdmin: MindAdmin | undefined;
  #orgAdmin: OrgAdmin | undefined;
  #founderAdmin: FounderAdmin | undefined;
  readonly #founderHandlers = new Set<() => void>();

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
      // OPS (D-OPS-08): a pinned production workspace runs only its activated, intact release — checked before anything
      // opens, upgrades or migrates it.
      const release = admitRuntimeRelease(this.#opts.workspace);
      this.#log.info('runtime.release_admitted', { instanceId: this.instanceId, mode: release.mode, releaseId: release.releaseId });
      const open = (): CompanyStore =>
        CompanyStore.open(this.#opts.workspace, {
          clock: this.#clock,
          runtimeVersion: RUNTIME_VERSION,
          ...(this.#opts.busyTimeoutMs !== undefined ? { busyTimeoutMs: this.#opts.busyTimeoutMs } : {}),
          ...(this.#opts.storageFault ? { fault: this.#opts.storageFault } : {}),
        });
      let store: CompanyStore;
      try {
        store = open();
      } catch (error) {
        // R2-30 / Stage 12 §38: an existing Company with pending migrations is upgraded only through the safe-upgrade
        // lifecycle (pre-update snapshot, rehearsal, verification, activation) — run automatically, before any open
        // that could run on the new schema. A rolled-back update leaves the workspace in UPDATE_HOLD: refuse to start.
        if (!isQandeelError(error, 'SCHEMA_UPDATE_REQUIRED')) throw error;
        const upgrade = await safeUpgrade(this.#opts.workspace, { clock: this.#clock, runtimeVersion: RUNTIME_VERSION });
        this.#log.info('runtime.safe_upgrade', { instanceId: this.instanceId, outcome: upgrade.outcome, code: upgrade.code, fromVersion: upgrade.fromVersion, toVersion: upgrade.toVersion });
        if (upgrade.outcome === 'ROLLED_BACK_UPDATE_HOLD') throw new QandeelError('UPDATE_HOLD', 'the automatic schema update failed and was rolled back; the workspace is held until the operator clears it', { updateId: upgrade.updateId, code: upgrade.code });
        store = open();
      }
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
    const interrupted = new Set<Id>();
    for (const run of this.#active.values()) {
      // Did not settle within the grace period: fence and classify it now (as recovery would). A run
      // that was already fenced no longer holds its claim (it may be another run's now): leave it.
      const wasFenced = run.fenced;
      run.fenced = true;
      if (wasFenced || interrupted.has(run.claim.fence.jobId)) continue;
      interrupted.add(run.claim.fence.jobId);
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
      for (const run of this.#runsOfJob(jobId)) {
        if (run.fenced) continue;
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
   * C6 resilience (Stage 15): a sealed, encrypted, verified portable package written to a destination outside
   * the workspace. The passphrase is the operator's recovery material: used, never stored or logged.
   */
  async portableBackup(options: { destination: BackupDestination; passphrase: string }): Promise<PortableBackupResult> {
    return createPortableBackup(this.#ready(), { ...options, runtimeVersion: RUNTIME_VERSION });
  }

  /** An isolated restore drill of the newest live generation (recorded; `Backup != Recovery Proof`). */
  restoreDrill(): { result: 'PASS' | 'FAIL'; code: string; durationMs: number } {
    return runRestoreDrill(this.#ready());
  }

  /** Generational retention of local generations (and of one destination's packages when given). */
  pruneBackups(policy?: RetentionPolicy, destination?: BackupDestination): { local: { kept: string[]; retired: string[] }; portable: { kept: string[]; retired: string[] } | null } {
    const store = this.#ready();
    return { local: pruneLocalBackups(store, policy), portable: destination ? prunePortableBackups(store, destination, policy) : null };
  }

  /** Recovery health facts (freshness, verification, drills, reconciliation burden, maintenance). */
  resilience(): ResilienceStatus {
    return resilienceStatus(this.#ready());
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

  /**
   * C4 administration: Positions, assignments, acting coverage, staffing, authority delegation, charters,
   * Review Plans and the Review Pool. A capability object like `mind`: it executes and claims nothing, and
   * every call signals the dispatcher (a review decision or handoff answer can make parked work actionable).
   */
  get org(): OrgAdmin {
    if (!this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    if (!this.#orgAdmin) {
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
      this.#orgAdmin = Object.freeze({ organization: wrap(OrganizationStore.for(this.#store)), review: wrap(ReviewStore.for(this.#store)) });
    }
    return this.#orgAdmin;
  }

  /**
   * C5 Founder surface administration: sessions (hashes only), Goals, Founder-facing communication,
   * Founder Attention, governed action previews and the derived Company Universe projection. A capability
   * object like `org`: it executes and claims nothing. Founder-authority writes fail closed outside a
   * verified session (`auth.withSession`) — holding this object grants nothing.
   *
   * The change-signalling contract (D-C5-17): "the Founder's world changed" is announced — and the dispatcher
   * woken — only after a successful mutation, once. A read announces nothing and wakes nothing; a call that
   * throws announces nothing; attention reconciliation announces only when it opened, signalled or resolved
   * an item. Every method is classified explicitly (`signalling`); an unclassified one is refused at
   * construction, never defaulted to a write. The surface subscribes to these announcements and refreshes
   * itself with reads: reads that announced would close that loop into a refresh storm.
   */
  get founder(): FounderAdmin {
    if (!this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    if (!this.#founderAdmin) {
      const changed = (): void => {
        this.#wake.signal();
        this.#founderChanged();
      };
      const s = this.#store;
      const auth = FounderAuthStore.for(s);
      this.#founderAdmin = Object.freeze({
        auth,
        goals: signalling(GoalStore.for(s), changed, { mutating: ['propose', 'transition', 'linkWork', 'unlinkWork'], reads: ['get', 'list', 'history', 'links', 'stateAt'] }),
        communications: signalling(CommunicationStore.for(s), changed, { mutating: ['openThread', 'directThread', 'send', 'requestCeoBrief', 'closeThread'], reads: ['thread', 'threads', 'message', 'messages', 'messagesPage', 'replyStates', 'messageMeta', 'pendingReplies', 'health'] }),
        attention: signalling(AttentionStore.for(s), changed, {
          mutating: ['dismiss'],
          reads: ['list', 'openAt', 'health'],
          // Reconciliation is idempotent: a stable world reports zero deltas and stays silent.
          conditional: { sync: (report) => { const r = report as AttentionSyncReport; return r.opened + r.signalled + r.resolved > 0; } },
        }),
        actions: signalling(FounderActionStore.for(s, auth, { profiles: this.#opts.governance?.provisioningProfiles ?? [], academyPackages: this.#opts.governance?.academyPackages ?? [], identityProfiles: this.#opts.governance?.identityProfiles ?? [] }), changed, { mutating: ['preview', 'confirm', 'reject', 'expireStale'], reads: ['get', 'list', 'employeeBudgetId', 'provisioningProfiles', 'activationEnv', 'packageDigest'] }),
        // C6 (D-C6-07): reads are silent; Founder decisions announce once; the system's idempotent derivations
        // (evaluate, assess, report, plan) announce only when they recorded something new.
        improvement: signalling(ImprovementStore.for(s), changed, {
          mutating: ['registerDefinition', 'calibrateDefinition', 'activateDefinition', 'retireDefinition', 'verifyOutcome', 'resolveOutcomeContest', 'decideAttribution', 'classifyObservation', 'completeTraining', 'completeReviewedTraining', 'decideSystemicFinding', 'openFailureCase', 'advanceFailureCase'],
          reads: ['definitions', 'calibrationRuns', 'evaluation', 'evaluations', 'attributions', 'signals', 'learningGate', 'judgments', 'interventions', 'systemicFindings', 'failureCases', 'retrainingMaterial', 'latestReport', 'reports', 'profile', 'economics', 'reviewerCalibration', 'inspect', 'health'],
          conditional: {
            evaluate: (r) => (r as { changed: boolean }).changed,
            assessIntervention: (r) => (r as { changed: boolean }).changed,
            generateReport: (r) => (r as { changed: boolean }).changed,
            planIntervention: (r) => (r as { outcome: string }).outcome !== 'AWAIT_EVIDENCE',
            // C6-R1 system derivations: news only when they recorded something new.
            requestLearningReview: (r) => (r as { changed: boolean }).changed,
            planReviewedIntervention: (r) => (r as { outcome: string }).outcome !== 'AWAIT_EVIDENCE',
          },
        }),
        // C7-A: Founder registry / lifecycle / binding decisions announce once; intake announces only a NEW accepted record
        // (an exact replay is silent); reads are silent.
        external: signalling(ExternalEvidenceStore.for(s), changed, {
          mutating: ['registerSource', 'decideSource', 'bindEvidence', 'unbindEvidence'],
          reads: ['sources', 'source', 'sourceHistory', 'record', 'bindings', 'evidenceFor', 'availability', 'health'],
          conditional: { ingest: (r) => (r as { changed: boolean }).changed },
          // A NEW conflicting replay commits its conflict (and, D-C7A-11, the contest of the verifications that rested on
          // the record) before refusing: the Founder's world changed. A repeated one changed nothing.
          committedRefusal: { ingest: (e) => isQandeelError(e, 'INTAKE_CONFLICT') && e.details.recorded === true },
        }),
        // C7-C: a Pilot step announces once; the board, scope and inspection are derived reads and stay silent.
        pilots: signalling(PilotStore.for(s), changed, { mutating: ['create', 'advance'], reads: ['get', 'list', 'history', 'briefing', 'scope', 'decisions', 'board', 'inspect', 'health'] }),
        // C7-D: target registration announces once; projects, candidates, the derived promotion lifecycle and the preview
        // resolution are reads and stay silent.
        digital: signalling(DigitalStore.for(s), changed, { mutating: ['registerTarget', 'setTargetState'], reads: ['targets', 'projects', 'project', 'revisionFiles', 'promotion', 'decisions', 'previewResolution', 'evidenceForWorkItems', 'publicationWindows', 'health'] }),
        universe: (options: { at?: string } = {}): CompanyUniverse => {
          if (options.at !== undefined && !isTimestamp(options.at)) throw new QandeelError('VALIDATION_FAILED', 'at must be a canonical UTC timestamp', { field: 'at' });
          return projectUniverse(s, options.at === undefined ? {} : { at: options.at });
        },
        activation: (): ActivationView => activationView(s, this.#opts.governance?.academyPackages ?? []),
        // D2-UX-01: the company-wide Academy overview (a read in one snapshot; nothing acts, nothing is called).
        academy: (options: { employeeId?: Id } = {}): AcademyOverview => academyOverview(s, options),
        attemptAnswer: (attemptId: string): AnswerRecord | null => AcademyStore.for(s).attemptAnswer(attemptId),
      });
    }
    return this.#founderAdmin;
  }

  /** In-process subscribers to "the Founder's world changed" (content-free; a nudge to re-project, never data). */
  onFounderChange(handler: () => void): () => void {
    this.#founderHandlers.add(handler);
    return () => this.#founderHandlers.delete(handler);
  }

  #founderChanged(): void {
    for (const h of this.#founderHandlers) {
      try {
        h();
      } catch (error) {
        this.#log.warn('founder.change_handler_failed', { code: errorCode(error) });
      }
    }
  }

  /** C4 health counts (content-free). */
  orgHealth(): C4Health {
    if (!this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    return c4HealthOf(this.#store);
  }
  /** C3 health counts (content-free). */
  mindHealth(): C3Health {
    if (!this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    return c3HealthOf(this.#store);
  }

  /**
   * C7-D: the read-only, re-verifying promotion source an external promotion driver is wired to by the host. A driver
   * resolves the exact candidate its approved arguments name — never the store, a workspace path or another candidate.
   */
  promotionSource(): { resolve(adapterCode: string, args: JsonObject, options: { includeContent: boolean }): PromotionExportResult; target(adapterCode: string, targetId: string): ReturnType<typeof resolvePromotionTarget>; promotionArgs(promotionId: string): JsonObject | null } {
    const open = (): CompanyStore => {
      if (!this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
      return this.#store;
    };
    return Object.freeze({
      resolve: (adapterCode: string, args: JsonObject, options: { includeContent: boolean }) => resolvePromotionExport(open(), adapterCode, args, options),
      target: (adapterCode: string, targetId: string) => resolvePromotionTarget(open(), adapterCode, targetId),
      promotionArgs: (promotionId: string) => promotionArgsOf(open(), promotionId),
    });
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
          // The local run (if any) lost its claim: fence it before the job can be re-claimed, so it never
          // writes again and a new run of the same job is tracked on its own (R1-08).
          for (const local of this.#runsOfJob(jobId)) {
            local.fenced = true;
            if (local.reason === null) local.reason = 'LEASE_LOST';
            local.controller.abort();
          }
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
    for (const run of this.#active.values()) {
      if (!run.fenced && run.reason === null && store.getJob(run.claim.fence.jobId).cancelRequested) {
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

  #runsOfJob(jobId: Id): ActiveRun[] {
    return [...this.#active.values()].filter((r) => r.claim.fence.jobId === jobId);
  }

  #startRun(claim: Claim): void {
    const processor = this.#registry.get(claim.job.processorKind);
    if (!processor) return; // unreachable: claims are filtered by registered kinds
    const run: ActiveRun = { claim, processor, controller: new AbortController(), reason: null, fenced: false, settled: false, done: Promise.resolve() };
    // Keyed by RUN (R1-08): a job re-claimed while its previous, fenced processor is still in its abort
    // grace gets a separate entry; the old run's completion can never remove the new run's entry.
    this.#active.set(claim.fence.runId, run);
    this.#maxObservedActive = Math.max(this.#maxObservedActive, this.#active.size);
    this.#log.info('run.started', { jobId: claim.fence.jobId, runId: claim.fence.runId, workItemId: claim.workItem.id, kind: processor.kind, attempt: claim.run.attempt, fencingToken: claim.fence.fencingToken });
    run.done = this.#execute(run).finally(() => {
      this.#active.delete(claim.fence.runId);
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
    // R1-03: the processor's loop step counts per job; every Work-Item-keyed record (idempotency keys,
    // step results, memory candidates, manifests) uses the Work-Item-global step = job base + step.
    const globalStep = (step: number): number => {
      if (!Number.isSafeInteger(step) || step < 0 || step >= GOVERNED_STEP_SPAN) throw new QandeelError('VALIDATION_FAILED', `a governed step is 0..${GOVERNED_STEP_SPAN - 1}`, { field: 'step' });
      return run.stepBase + step;
    };
    const services: GovernedRunServices = Object.freeze({
      context: run,
      // Every inference goes through governed Context Assembly first (C3): the processor names the
      // step, the runtime builds, budgets and records the context; the model runtime accepts only that.
      invokeModel: async (request: ModelCallRequest): Promise<ModelCallOutcome> => {
        const assembled = assembleGovernedContext(store, claim.fence, { step: globalStep(request.step) });
        if (assembled.kind !== 'OK') return { kind: 'CONTEXT', code: assembled.code };
        return this.#models.call(store, claim.fence, run, request, assembled.context, signal);
      },
      // The runtime (not the processor) records each step's outcome for later context (layer L6).
      proposeMemory: (proposal: MemoryProposal, step: number) => {
        const g = globalStep(step);
        const out = proposeMemory(store, claim.fence, proposal, g);
        recordStepResult(store, claim.fence, g, 'MEMORY_DECISION', JSON.stringify(out.kind === 'DECIDED' ? { memory: out.state, reason: out.reasonCode } : { memory: out.kind, reason: out.code }));
        return out;
      },
      executeTool: async (request: ToolRequest, step: number) => {
        const g = globalStep(step);
        const out = await this.#tools.execute(store, claim.fence, run, request, g, signal);
        if (out.kind === 'SUCCEEDED') recordStepResult(store, claim.fence, g, 'TOOL_RESULT', JSON.stringify({ tool: request.tool, action: request.action, result: out.result }));
        else if (out.kind === 'DENIED' && !out.paused) recordStepResult(store, claim.fence, g, 'TOOL_REFUSED', JSON.stringify({ tool: request.tool, action: request.action, denied: out.code }));
        return out;
      },
      // C4: organizational acts and review decisions pass the fenced authority path; their outcome (codes and
      // references only) is recorded for later context like a tool result.
      orgAct: (proposal: OrgActProposal, step: number) => {
        const g = globalStep(step);
        const out = recordOrgAct(store, claim.fence, g, proposal.action, proposal.args);
        if (!out.paused) recordStepResult(store, claim.fence, g, out.outcome === 'DONE' ? 'TOOL_RESULT' : 'TOOL_REFUSED', JSON.stringify({ orgAction: proposal.action, outcome: out.outcome, code: out.code, ref: out.resultRef }));
        return { outcome: out.outcome, code: out.code, after: out.after, paused: out.paused };
      },
      submitReviewDecision: (proposal: ReviewDecisionProposal, step: number) => {
        const g = globalStep(step);
        const out = recordReviewDecision(store, claim.fence, { outcome: proposal.outcome, reasonCode: proposal.reasonCode, rationale: proposal.rationale, evidenceRefs: proposal.evidenceRefs, outcomeJudgment: proposal.outcomeJudgment ?? null });
        recordStepResult(store, claim.fence, g, out.outcome === 'RECORDED' ? 'TOOL_RESULT' : 'TOOL_REFUSED', JSON.stringify({ reviewDecision: out.outcome, code: out.code }));
        return { outcome: out.outcome, code: out.code };
      },
      // R2-04: the one open-handoff set, shared with the WAIT settle re-check and the delegation trigger.
      openHandoffs: () => OrganizationStore.for(store).workDelegations({ parentWorkItemId: run.workItemId }).filter((d) => (OPEN_HANDOFF_STATES as readonly string[]).includes(d.state)).length,
      clarificationsRequested: () => OrganizationStore.for(store).workDelegations({ parentWorkItemId: run.workItemId }).filter((d) => d.state === 'CLARIFICATION_REQUESTED').length,
      // RR2-2: a refused FINAL is this step's result — the model learns why it cannot finish and which handoff asked.
      noteInvalidOutput: (step: number, code: OutputDiagnosticCode, reasoningClass: string, detail?: { readonly proposalType?: string; readonly refusalCode?: string }) => recordInvalidOutput(store, claim.fence, { step: globalStep(step), code, reasoningClass, ...(detail?.proposalType !== undefined ? { proposalType: detail.proposalType } : {}), ...(detail?.refusalCode !== undefined ? { refusalCode: detail.refusalCode } : {}) }),
      refuseFinal: (step: number, code: 'FINAL_REFUSED_CLARIFICATION_PENDING') => {
        const asked = OrganizationStore.for(store).workDelegations({ parentWorkItemId: run.workItemId }).filter((d) => d.state === 'CLARIFICATION_REQUESTED').map((d) => d.id);
        recordStepResult(store, claim.fence, globalStep(step), 'TOOL_REFUSED', JSON.stringify({ final: 'REFUSED', code, answerWith: 'handoff.clarify', delegationIds: asked }));
      },
      // C5: Founder-facing messages and goal acts pass the fenced authority path; only codes and references
      // are recorded for later context (the message body is company content, never a step result).
      sendMessage: (proposal: MessageProposal, step: number) => {
        const g = globalStep(step);
        const out = recordMessage(store, claim.fence, { purpose: proposal.purpose, attentionLevel: proposal.attentionLevel, body: proposal.body, brief: proposal.brief, contextRefs: proposal.contextRefs });
        recordStepResult(store, claim.fence, g, out.outcome === 'RECORDED' ? 'TOOL_RESULT' : 'TOOL_REFUSED', JSON.stringify({ message: out.outcome, code: out.code, purpose: proposal.purpose }));
        this.#founderChanged();
        return { outcome: out.outcome, code: out.code, messageId: out.messageId };
      },
      // L1-02: the answer of an answer-bearing Work Item (codes only as the step result; the body is company content).
      recordAnswer: (proposal: AnswerProposal, step: number, manifestId: string) => {
        const g = globalStep(step);
        const out = recordAnswer(store, claim.fence, { body: proposal.body, decision: proposal.decision, reversible: proposal.reversible, authority: proposal.authority, evidence: proposal.evidence, confidence: proposal.confidence, founderDecisionNeeded: proposal.founderDecisionNeeded, spendMicros: proposal.spendMicros }, { manifestId: manifestId as Id, step: g });
        recordStepResult(store, claim.fence, g, out.outcome === 'RECORDED' ? 'TOOL_RESULT' : 'TOOL_REFUSED', JSON.stringify({ answer: out.outcome, code: out.code }));
        this.#founderChanged();
        return { outcome: out.outcome, code: out.code, answerId: out.answerId };
      },
      goalAct: (proposal: GoalActProposal, step: number) => {
        const g = globalStep(step);
        const out = recordGoalAct(store, claim.fence, proposal.action, proposal.args);
        recordStepResult(store, claim.fence, g, out.outcome === 'DONE' ? 'TOOL_RESULT' : 'TOOL_REFUSED', JSON.stringify({ goalAction: proposal.action, outcome: out.outcome, code: out.code, ref: out.resultRef }));
        this.#founderChanged();
        return out;
      },
    });
    return processor.runGoverned(context, services);
  }

  // --- artifacts from processors ------------------------------------------------------------------

  /**
   * Stores an artifact for a running job. The caller's claim is re-validated (fenced lease renew)
   * first, so a replaced worker cannot attach artifacts to work it no longer owns.
   */
  putRunArtifact(claimJobId: Id, content: Uint8Array | string, mediaType: string, label?: string): ArtifactRecord {
    const run = this.#runsOfJob(claimJobId).find((r) => !r.fenced && !r.settled);
    if (!run) throw new QandeelError('STALE_LEASE', 'no active run owns this job', { jobId: claimJobId });
    // The fence is verified inside the same transactions that stage and promote the artifact.
    if (!this.#artifacts || !this.#store || this.#store.isClosed) throw new QandeelError('RUNTIME_NOT_READY', 'runtime store is not open');
    return this.#artifacts.put({ content, mediaType, workItemId: run.claim.workItem.id, runId: run.claim.fence.runId, fence: run.claim.fence, ...(label !== undefined ? { label } : {}) });
  }
}
