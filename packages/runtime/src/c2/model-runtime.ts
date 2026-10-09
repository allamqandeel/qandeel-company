/**
 * The governed Model Runtime (Stage 13): the ONLY code that calls a provider adapter (verifier rule
 * `model-calls-confined`). Adapters are handed over at construction and held privately.
 *
 * One call = governed context (C3 assembler only) → authorize (`model.invoke`, default deny) → Router Policy (hard gates, then cost) →
 * worst-case reservation committed → provider call → settle actual usage (unused reservation
 * released) or hold it when the outcome is uncertain. Retry, fallback and escalation are separate
 * attempts with separate reasons, each reserved and attributed on its own. The model's output is
 * returned as a typed proposal; this module has no reference to the Tool Executor.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { newId, parseTimestamp, toTimestamp, type Id, type Timestamp } from '@qandeel-company/domain';
import {
  continuationAllowance,
  effectiveClass,
  failureDisposition,
  hardGate,
  isReasoningDemand,
  maxDataClass,
  mayRetry,
  parseProposalDetailed,
  planEscalation,
  planFallback,
  reasoningSelectionOf,
  resolveAutoClass,
  route,
  utf8TokenUpperBound,
  type AttemptKind,
  type DeploymentView,
  type ReasoningClass,
  type RoutePolicy,
  type PriceCard,
  type ProviderAdapter,
  type ProviderFailureClass,
  type RouteDecision,
  type RouteRequest,
} from '@qandeel-company/governance';
import { GovernanceStore, type CompanyStore, type Fence } from '@qandeel-company/storage';
import { authorizeModelCall, containProviderFault, holdReservation, recordDeploymentOutcome, recordModelCallObservation, recordReasoningSelection, releaseReservation, reserveBudget, settleReservation, type GovernedRunContext } from '@qandeel-company/storage/runtime-authority';

import { isAssembledContext, type AssembledContext } from '../c3/context-assembler.js';
import { answerSnapshot, errorSnapshot, failureSnapshot, type ProviderSnapshot, type SnapshotBounds } from './provider-boundary.js';
import type { ModelCallOutcome, ModelCallRequest, ReasoningSelectionRecord } from './types.js';

export const DEFAULT_MODEL_CALL_TIMEOUT_MS = 120_000;

/**
 * What a failed attempt's accounting actually recorded: provably not billed (reservation released),
 * charged (settled FAILED_CHARGED), or possibly billed (held for reconciliation). Only an UNBILLED
 * attempt may be retried on the same deployment.
 */
type AttemptAccounting = 'UNBILLED' | 'CHARGED' | 'HELD';
interface AttemptFailure {
  readonly failure: ProviderFailureClass;
  readonly accounting: AttemptAccounting;
}

/** Module-private runtime-control markers for the adapter race (never comparable to provider data). */
const TIMED_OUT: unique symbol = Symbol('model-call.timed-out');
const CANCELLED: unique symbol = Symbol('model-call.cancelled');

export class GovernedModelRuntime {
  readonly #adapters: ReadonlyMap<string, ProviderAdapter>;
  readonly #timeoutMs: number;
  #calls = 0;
  /**
   * Deployments whose provider fault is known but whose containment the store refused to write
   * together with the money (R1-09): never routed by this process, and contained at the next route
   * boundary. Empty whenever the store accepts writes.
   */
  readonly #uncontained = new Set<string>();

  constructor(adapters: readonly ProviderAdapter[], timeoutMs = DEFAULT_MODEL_CALL_TIMEOUT_MS) {
    const map = new Map<string, ProviderAdapter>();
    for (const a of adapters) {
      if (map.has(a.providerCode)) throw new Error(`duplicate provider adapter "${a.providerCode}"`);
      map.set(a.providerCode, a);
    }
    this.#adapters = map;
    this.#timeoutMs = timeoutMs;
  }

  /** Provider calls issued by this runtime instance (idle proof: stays 0 without work). */
  get providerCalls(): number {
    return this.#calls;
  }

  get adapterCodes(): readonly string[] {
    return [...this.#adapters.keys()];
  }

  /**
   * One governed model step. `context` must be a value minted by the C3 Context Assembler for this
   * run: anything else (a hand-built message list, a copy) is refused before any authorization,
   * routing or reservation — the model only ever sees governed, budgeted, manifest-bound context.
   */
  async call(store: CompanyStore, fence: Fence, run: GovernedRunContext, req: ModelCallRequest, context: AssembledContext, signal: AbortSignal): Promise<ModelCallOutcome> {
    if (!isAssembledContext(context)) return { kind: 'CONTEXT', code: 'CONTEXT_NOT_ASSEMBLED' };
    // Authorization (and the durable effective data class) is re-evaluated before EVERY attempt:
    // a revoked grant or a context raised by a tool result or by assembled context applies at once.
    const auth = authorizeModelCall(store, fence, { taskClass: req.taskClass, dataClass: maxDataClass(run.dataClass, context.dataClass) });
    if (!auth.ok) return { kind: 'DENIED', code: auth.code };
    for (const id of this.#uncontained) {
      try {
        recordDeploymentOutcome(store, fence, id as Id, 'CONTRACT_VIOLATION');
        this.#uncontained.delete(id);
      } catch {
        // Still refused: it stays out of this process's routing until it is written.
      }
    }
    const governance = GovernanceStore.for(store);
    // P-07 (D-R1-03 / D-C4-07): a deployment that charged (or may have billed) a failed attempt for this
    // Work Item in ANY earlier run is not routed to again for it; the reservation re-checks the same rule.
    const excluded = new Set<string>(governance.chargedExclusions(run.workItemId));
    const routable = <T extends { readonly id: string }>(ds: readonly T[]): readonly T[] => (this.#uncontained.size === 0 && excluded.size === 0 ? ds : ds.filter((x) => !this.#uncontained.has(x.id) && !excluded.has(x.id)));
    const snapshot = governance.routingSnapshot(req.taskClass);
    const policy = snapshot.policy;
    if (!policy) return { kind: 'UNAVAILABLE', code: 'NO_ROUTE_POLICY' };
    // The deployments this process may route to for this Work Item (uncontained and charged-excluded ones removed).
    const eligible = routable(snapshot.deployments);
    const profile = run.cognitiveProfile;
    const now = store.now();
    // P1-REASON-AUTO-RECOVERY-01 precedence of the starting class (D-L1-44 amended, D-P1-04): the Founder's one-task level
    // (durable, read at the run's begin) — PINNED, never raised or lowered; else the processor's pinned class (a method
    // pin such as an Academy observation); else, with AUTO on, the governed Reasoning Demand bounded by the ceiling, the
    // route policy and what is provisioned; else the Employee default. Bounded evidence escalation may raise an AUTO or
    // DEFAULT start only; the Employee ceiling, the route policy, qualified deployments and the reservation still bind.
    let requested: ReasoningClass | undefined;
    let firstKind: AttemptKind = 'PRIMARY';
    let selection: ReasoningSelectionRecord | null = null;
    if (req.escalation) {
      if (run.reasoningOverride !== null) return { kind: 'ESCALATION_REFUSED', code: 'CLASS_PINNED_BY_FOUNDER' };
      const done = governance.reservations(run.runId).filter((r) => r.attemptKind === 'ESCALATION').length;
      const plan = planEscalation(req.escalation.fromClass, req.escalation.evidence, done, policy, profile.ceilingClass);
      if (!plan.ok) return { kind: 'ESCALATION_REFUSED', code: plan.code };
      requested = plan.toClass;
      firstKind = 'ESCALATION';
    } else if (req.continuation) {
      // The same class again with a larger allowance (a separately reserved RETRY attempt), never another class.
      requested = req.continuation.reasoningClass;
      firstKind = 'RETRY';
    }
    const currency = governance.budgetFor('COMPANY', 'company')?.currency ?? 'XXX';
    // The request without its class: the context's effective data class comes from durable state (declared class raised
    // by tool results already in context): neither the model nor the processor can lower it.
    const base = { taskClass: req.taskClass, dataClass: auth.dataClass, inputTokensUpperBound: Math.max(utf8TokenUpperBound(context.messages), context.estimatedInputTokens), employeeCeiling: profile.ceilingClass, currency };
    // The deployments that serve this task class now (the continuation ceiling and the pinned-level check read only these).
    const serving = eligible.filter((x) => x.taskClasses.includes(req.taskClass) && x.status === 'ACTIVE' && x.providerStatus === 'ACTIVE');
    if (selection === null && !req.escalation && !req.continuation) {
      // AUTO only offers a class that some eligible deployment could take for THIS request with that class's own allowance
      // (every hard gate but a temporary circuit): a class that would only fail to route is never selected.
      const fits = (c: ReasoningClass): boolean => {
        const max = outputAllowance(req, c, serving);
        return max !== null && eligible.some((x) => hardGate(x, { ...base, reasoningClass: c, maxOutputTokens: max }, policy, effectiveClass({ reasoningClass: c }, policy), NEVER) === null);
      };
      selection = startSelection(run, req, policy, (['E1', 'E2', 'E3', 'E4'] as const).filter(fits));
      requested = selection.startClass;
    }
    // Every branch above set it; the default is only the type checker’s fallback.
    const asked: ReasoningClass = requested ?? profile.defaultClass;
    const startClass = effectiveClass({ reasoningClass: asked }, policy);
    const maxOutputTokens = outputAllowance(req, startClass, serving);
    if (maxOutputTokens === null) return { kind: 'ESCALATION_REFUSED', code: 'CONTINUATION_NOT_LARGER' };
    const routeReq: RouteRequest = {
      ...base,
      reasoningClass: asked,
      // B1: the allowance of the class this call routes at (never the starting class's when it escalated).
      maxOutputTokens,
    };
    let decision: RouteDecision = route(routeReq, policy, eligible, now);
    if (decision.kind === 'NO_LLM') return { kind: 'NO_LLM' };
    if (decision.kind === 'NONE') {
      // B3: a route that only an open circuit holds is a timed wait until the circuit may be tried, never a spent attempt.
      if (decision.code === 'NO_ELIGIBLE_DEPLOYMENT') {
        const until = circuitReopen(routeReq, policy, eligible, now);
        if (until !== null) return { kind: 'CIRCUIT_OPEN', until };
        // A Founder-pinned class with no deployment of that class at all is never substituted by another class.
        if (run.reasoningOverride !== null && !snapshot.deployments.some((x) => x.reasoningClass === decision.reasoningClass && x.taskClasses.includes(req.taskClass))) return { kind: 'UNAVAILABLE', code: 'REASONING_LEVEL_UNAVAILABLE' };
      }
      return { kind: 'UNAVAILABLE', code: decision.code };
    }
    if (selection !== null) recordSelection(store, fence, run, req, selection);
    let attemptKind: AttemptKind = firstKind;
    let retries = 0;
    const failed: string[] = [];
    let lastFailure: ProviderFailureClass = 'UNKNOWN';
    const ceiling = policy.maxRetriesPerCall + snapshot.deployments.length + 1;
    for (let attempt = 1; attempt <= ceiling; attempt++) {
      if (signal.aborted) return { kind: 'UNAVAILABLE', code: 'ABORTED' };
      if (attempt > 1) {
        const again = authorizeModelCall(store, fence, { taskClass: req.taskClass, dataClass: routeReq.dataClass });
        if (!again.ok) return { kind: 'DENIED', code: again.code };
      }
      const d = decision as Extract<RouteDecision, { kind: 'ROUTE' }>;
      const adapter = this.#adapters.get(d.deployment.providerCode);
      if (!adapter) {
        failed.push(d.deployment.id);
        lastFailure = 'CONTRACT_VIOLATION';
      } else {
        const reserved = reserveBudget(store, fence, {
          purpose: 'MODEL_CALL',
          attemptKind,
          deploymentId: d.deployment.id as Id,
          priceCardId: d.deployment.priceCard?.id as Id,
          routePolicyId: policy.id as Id,
          money: d.worstCase.economicMicros,
          tokens: d.worstCase.tokens,
          // The reservation is bound to this run's OK manifest (store and datastore both check it).
          contextManifestId: context.manifestId,
        });
        if (!reserved.ok) {
          if (reserved.code === 'ROUTE_NO_LONGER_ELIGIBLE') {
            failed.push(d.deployment.id);
          } else {
            return { kind: 'BUDGET', code: reserved.code, detail: reserved.detail };
          }
        } else {
          const reservationId = reserved.reservation.id;
          const sessionId = newId();
          this.#calls++;
          // The provider boundary: the answer or thrown failure is read once into a frozen snapshot of
          // plain values; everything below decides from the snapshot only (R1-09).
          const provided = await this.#call(
            adapter,
            // The route's reasoning class travels with the request (L1-01): the adapter maps it to its bounded profile.
            { providerCode: d.deployment.providerCode, modelCode: d.deployment.modelCode, deploymentCode: d.deployment.code, reasoningClass: d.reasoningClass, messages: context.messages, maxOutputTokens: routeReq.maxOutputTokens },
            { inputUpperBound: routeReq.inputTokensUpperBound, maxOutputTokens: routeReq.maxOutputTokens, priceCard: (d.deployment.priceCard as PriceCard | undefined) ?? null },
            signal,
          );
          // From here on the call may have been billed. Bookkeeping that fails (an out-of-range usage
          // report, a busy store) never escapes as a processor error that would retry the same route:
          // the money stays held for reconciliation and the deployment is held as a contract violation
          // (R1-09, D13-F.1/.8, D-C2-07). The run-settle backstop holds anything still reserved.
          let settled: { readonly done: ModelCallOutcome } | AttemptFailure;
          try {
            settled = this.#account(store, fence, d, reservationId, sessionId, provided, attempt, context.manifestId, routeReq.maxOutputTokens);
          } catch {
            // Whether the PROVIDER broke the contract was decided at the boundary, never inferred from
            // whichever local error the store threw (R1 re-review).
            observe(store, fence, run, req, { attemptKind, d, maxOutputTokens: routeReq.maxOutputTokens, s: provided, outcome: null });
            return this.#containAccountingFailure(store, fence, reservationId, d.deployment.id, provided.providerFault);
          }
          // B2: one content-free observation per sent call (class, allowance, tokens, finish reason, validation).
          observe(store, fence, run, req, { attemptKind, d, maxOutputTokens: routeReq.maxOutputTokens, s: provided, outcome: 'done' in settled ? settled.done : null, failure: 'done' in settled ? null : settled.failure });
          if ('done' in settled) return settled.done;
          const failure = settled.failure;
          lastFailure = failure;
          const disp = failureDisposition(failure);
          // Same-deployment retry only for an attempt this runtime provably did not pay for: a charged or
          // held attempt is never retried on the same deployment (the retry contract, R1-09 Technical
          // Lead decision); fallback to another qualified route stays as the policy allows.
          if (settled.accounting === 'UNBILLED' && mayRetry(disp.retry, retries, policy)) {
            retries++;
            attemptKind = 'RETRY';
            await sleep(Math.min(2_000, 50 * 2 ** retries), undefined, { signal }).catch(() => undefined);
            continue;
          }
          if (!disp.fallback) return disp.sent === 'UNKNOWN' ? { kind: 'UNCERTAIN', failure } : { kind: 'FAILED', failure, reasoningClass: d.reasoningClass };
          failed.push(d.deployment.id);
        }
      }
      // Fallback: another prequalified route, same quality/privacy contract, no costlier envelope.
      const fresh = governance.routingSnapshot(req.taskClass);
      const fallback = planFallback(d, routeReq, policy, routable(fresh.deployments), failed, store.now());
      if (fallback.kind !== 'ROUTE') return { kind: 'UNAVAILABLE', code: fallback.kind === 'NONE' && fallback.rejected.some((x) => x.code === 'COST_CEILING') ? 'FALLBACK_REFUSED_COST' : `PROVIDER_${lastFailure}` };
      decision = fallback;
      attemptKind = 'FALLBACK';
      retries = 0;
    }
    return { kind: 'UNAVAILABLE', code: 'ATTEMPTS_EXHAUSTED' };
  }

  /**
   * Accounts for one sent call: settle actual usage (the unused reservation is released), hold it when
   * the spend is uncertain, release it only when the call provably was not sent; then record the
   * deployment's health. Returns the finished outcome, or the failure class that drives retry / fallback.
   */
  #account(
    store: CompanyStore,
    fence: Fence,
    d: Extract<RouteDecision, { kind: 'ROUTE' }>,
    reservationId: Id,
    sessionId: Id,
    s: ProviderSnapshot,
    attempt: number,
    manifestId: Id,
    maxOutputTokens: number,
  ): { readonly done: ModelCallOutcome } | AttemptFailure {
    const deploymentId = d.deployment.id as Id;
    const usage = s.usage;
    if (s.answered) {
      if (usage.state !== 'REPORTED') {
        // Unusable usage report: the provider answered but broke the contract. Hold the full
        // reservation (spend is uncertain) and contain the deployment in one transaction; never retry
        // blindly. A store failure here escapes to the caller's containment.
        containProviderFault(store, fence, reservationId, 'USAGE_UNREPORTED');
        return { done: { kind: 'UNCERTAIN', failure: 'CONTRACT_VIOLATION' } };
      }
      // A provider fault (usage outside the bounds / the accounting range) contains the deployment
      // inside this same settle transaction; only a healthy answer's health is best effort.
      settleReservation(store, fence, reservationId, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens, withinBounds: usage.withinBounds, sessionId, outcome: 'OK' }, s.providerFault);
      if (!s.providerFault) recordHealth(store, fence, deploymentId, null);
      // B2: an answer the provider cut at the allowance (`length`) is incomplete: it is charged as the provider accepted
      // and billed it, but its text never becomes a proposal (provider acceptance ≠ valid output ≠ completed work).
      const parsed = s.finishReason === 'length' ? { proposal: { type: 'INVALID', code: 'OUTPUT_TRUNCATED' } as const, reason: null } : parseProposalDetailed(s.outputText);
      return { done: { kind: 'OK', proposal: parsed.proposal, usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens }, deploymentId: d.deployment.id, reasoningClass: d.reasoningClass, attempts: attempt, manifestId, maxOutputTokens, finishReason: s.finishReason, invalidReason: parsed.reason } };
    }
    const failure = s.failure ?? 'UNKNOWN';
    const disp = failureDisposition(failure);
    if (usage.state === 'REPORTED') {
      // Billed despite failing: charged truthfully, never hidden. A provider fault (usage outside the
      // bounds, or a failure it classified as a contract violation) contains the deployment inside the
      // settle transaction, never by a separate best-effort write, and the same route is not retried.
      settleReservation(store, fence, reservationId, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens, withinBounds: usage.withinBounds, sessionId, outcome: 'FAILED_CHARGED' }, s.providerFault);
      if (s.providerFault) return { failure: 'CONTRACT_VIOLATION', accounting: 'CHARGED' };
      recordHealth(store, fence, deploymentId, failure);
      return { failure, accounting: 'CHARGED' };
    }
    if (usage.state === 'UNUSABLE') {
      // A failed call whose reported usage is unusable: the provider broke the contract.
      containProviderFault(store, fence, reservationId, 'USAGE_UNUSABLE');
      return { failure: 'CONTRACT_VIOLATION', accounting: 'HELD' };
    }
    if (failure === 'CONTRACT_VIOLATION') {
      // A malformed answer: possibly billed AND the provider's fault — money held and deployment
      // contained in one transaction.
      containProviderFault(store, fence, reservationId, failure);
      return { failure, accounting: 'HELD' };
    }
    let accounting: AttemptAccounting;
    if (disp.sent === 'UNKNOWN') {
      holdReservation(store, fence, reservationId, failure);
      accounting = 'HELD';
    } else {
      releaseReservation(store, fence, reservationId, failure);
      accounting = 'UNBILLED';
    }
    recordHealth(store, fence, deploymentId, failure);
    return { failure, accounting };
  }

  /**
   * A call that may have been billed whose bookkeeping failed (R1-09): the reservation is held for
   * reconciliation (never left RESERVED, never released), so the same route is never called again
   * blindly. Only a failure the provider's answer caused contains the deployment — in the same
   * transaction as the money hold; a local store failure of any kind (busy, I/O, invariant) is never
   * blamed on the provider (R1 re-review). If the store refuses even that write, nothing durable names
   * the provider: this process keeps the deployment out of routing until the containment is written
   * (next route boundary), and the run-settle backstop / startup recovery hold the reservation.
   */
  #containAccountingFailure(store: CompanyStore, fence: Fence, reservationId: Id, deploymentId: string, providerFault: boolean): ModelCallOutcome {
    if (providerFault) {
      try {
        containProviderFault(store, fence, reservationId, 'SETTLEMENT_FAILED');
        return { kind: 'UNCERTAIN', failure: 'CONTRACT_VIOLATION' };
      } catch {
        this.#uncontained.add(deploymentId);
      }
    }
    try {
      holdReservation(store, fence, reservationId, 'SETTLEMENT_FAILED');
    } catch {
      // Already final or the store is unavailable: the backstop holds it.
    }
    // A local accounting failure is marked as such (R2-12): the money is held, but the run never records it
    // as the provider's failure.
    return providerFault ? { kind: 'UNCERTAIN', failure: 'CONTRACT_VIOLATION' } : { kind: 'UNAVAILABLE', code: 'SETTLEMENT_FAILED' };
  }

  /**
   * One bounded adapter call, returned as the provider-boundary snapshot: any adapter misbehaviour is
   * normalized there, never propagated, and the raw answer / error is not read again.
   */
  async #call(adapter: ProviderAdapter, request: Parameters<ProviderAdapter['generate']>[0], bounds: SnapshotBounds, runSignal: AbortSignal): Promise<ProviderSnapshot> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    runSignal.addEventListener('abort', onAbort, { once: true });
    const timer = new AbortController();
    try {
      // Runtime-control outcomes are private markers no provider value can equal (R1-09 sweep): any
      // value the adapter resolves with — even the string 'TIMEOUT' — goes through the boundary.
      const timeout = sleep(this.#timeoutMs, TIMED_OUT, { signal: timer.signal }).catch(() => CANCELLED);
      const result: unknown = await Promise.race([adapter.generate(request, controller.signal), timeout]);
      if (result === TIMED_OUT || result === CANCELLED) {
        controller.abort();
        return failureSnapshot('TIMEOUT_AFTER_SEND');
      }
      return answerSnapshot(result, bounds);
    } catch (error) {
      return errorSnapshot(error, bounds);
    } finally {
      timer.abort();
      runSignal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Deployment health of an answer the provider did NOT break is observability for routing, recorded
 * after the money write has committed: a failure to record it (e.g. a busy store) never discards a
 * paid, valid answer or blames the provider. A known provider fault is never recorded here — it is
 * contained inside the money transaction (R1-09, Technical Lead follow-up).
 */
function recordHealth(store: CompanyStore, fence: Fence, deploymentId: Id, failure: ProviderFailureClass | null): void {
  try {
    recordDeploymentOutcome(store, fence, deploymentId, failure);
  } catch {
    // Best effort by design (see above).
  }
}
/** A routing instant no circuit reaches: AUTO asks what a class could take, never whether its circuit is open right now. */
const NEVER = '9999-12-31T23:59:59.999Z' as Timestamp;

/**
 * The starting class of a step and how it was chosen (D-P1-04 precedence): the Founder's one-task level, else the
 * processor's method pin, else AUTO (when the Employee's profile selects it and the Work Item carries a governed Reasoning
 * Demand), else the Employee default.
 */
function startSelection(run: GovernedRunContext, req: ModelCallRequest, policy: RoutePolicy, available: readonly ReasoningClass[]): ReasoningSelectionRecord {
  const profile = run.cognitiveProfile;
  if (run.reasoningOverride !== null) return { mode: 'MANUAL', startClass: run.reasoningOverride, idealClass: null, constraint: null };
  if (req.reasoningClass !== undefined) return { mode: 'SYSTEM_PINNED', startClass: req.reasoningClass, idealClass: null, constraint: null };
  if (reasoningSelectionOf(profile) === 'AUTO' && isReasoningDemand(req.reasoningDemand)) {
    const r = resolveAutoClass(req.reasoningDemand.level, { ceiling: profile.ceilingClass, policyMin: policy.minClass, policyMax: policy.maxClass, available });
    return { mode: 'AUTO', startClass: r.selected, idealClass: r.ideal, constraint: r.constraint };
  }
  return { mode: 'DEFAULT', startClass: profile.defaultClass, idealClass: null, constraint: null };
}

/**
 * B1: the output allowance of a call at `cls` — the Work Item's per-class allowance when it declares one, else its single
 * allowance; a continuation doubles the exhausted allowance within the deployment maximum (null = it would not grow).
 */
function outputAllowance(req: ModelCallRequest, cls: ReasoningClass, deployments: readonly DeploymentView[]): number | null {
  if (req.continuation) {
    const deploymentMax = Math.max(0, ...deployments.filter((x) => x.reasoningClass === cls).map((x) => x.maxOutputTokens));
    return continuationAllowance(req.continuation.exhaustedTokens, deploymentMax);
  }
  const byClass = cls === 'E0' ? undefined : req.maxOutputTokensByClass?.[cls];
  return typeof byClass === 'number' ? byClass : req.maxOutputTokens;
}

/**
 * B3: when no deployment is eligible NOW, the earliest instant at which an open circuit's reopening alone makes the same
 * request routable (every other hard gate unchanged), or null when the route is unavailable for any other reason.
 */
function circuitReopen(req: RouteRequest, policy: RoutePolicy, deployments: readonly DeploymentView[], now: Timestamp): Timestamp | null {
  const reopenings = [...new Set(deployments.map((x) => x.circuitOpenUntil).filter((t): t is Timestamp => t !== null && t > now))].sort();
  // Five seconds past the later of the reopening and now, so the timed wait still names a future instant when the run
  // settles after a slow (busy-store) commit — an expired WAIT would cost an attempt (INVALID_WAIT).
  for (const at of reopenings) if (route(req, policy, deployments, at).kind === 'ROUTE') return toTimestamp(Math.max(parseTimestamp(at), parseTimestamp(now)) + 5_000);
  return null;
}

/** The step's class selection, as one content-free audit row of the run (observability: never blocks the call). */
function recordSelection(store: CompanyStore, fence: Fence, run: GovernedRunContext, req: ModelCallRequest, sel: ReasoningSelectionRecord): void {
  try {
    const demand = sel.mode === 'AUTO' && isReasoningDemand(req.reasoningDemand) ? req.reasoningDemand : null;
    recordReasoningSelection(store, fence, { step: run.stepBase + req.step, mode: sel.mode, startClass: sel.startClass, idealClass: sel.idealClass, constraint: sel.constraint, demand });
  } catch {
    // Best effort by design: a busy store never blocks or fails the governed call it describes.
  }
}

/** One content-free observation of a sent call (B2): class, allowance, token counts, finish reason, validation codes. */
function observe(
  store: CompanyStore,
  fence: Fence,
  run: GovernedRunContext,
  req: ModelCallRequest,
  o: { attemptKind: AttemptKind; d: Extract<RouteDecision, { kind: 'ROUTE' }>; maxOutputTokens: number; s: ProviderSnapshot; outcome: ModelCallOutcome | null; failure?: ProviderFailureClass | null },
): void {
  try {
    const u = o.s.usage;
    const ok = o.outcome?.kind === 'OK' ? o.outcome : null;
    recordModelCallObservation(store, fence, {
      step: run.stepBase + req.step,
      attemptKind: o.attemptKind,
      reasoningClass: o.d.reasoningClass,
      deploymentCode: o.d.deployment.code,
      maxOutputTokens: o.maxOutputTokens,
      inputTokens: u.state === 'REPORTED' ? u.inputTokens : null,
      outputTokens: u.state === 'REPORTED' ? u.outputTokens : null,
      reasoningTokens: o.s.reasoningTokens,
      finishReason: o.s.finishReason,
      result: ok ? 'ANSWERED' : (o.failure ?? o.s.failure ?? (o.outcome?.kind === 'UNCERTAIN' ? o.outcome.failure : 'UNKNOWN')),
      proposalType: ok ? ok.proposal.type : null,
      invalidCode: ok && ok.proposal.type === 'INVALID' ? ok.proposal.code : null,
      malformedReason: ok ? ok.invalidReason : null,
    });
  } catch {
    // Best effort by design (observability never changes the money or the outcome of the call).
  }
}
