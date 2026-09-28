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

import { newId, type Id } from '@qandeel-company/domain';
import {
  failureDisposition,
  maxDataClass,
  mayRetry,
  parseProposal,
  planEscalation,
  planFallback,
  route,
  utf8TokenUpperBound,
  type AttemptKind,
  type PriceCard,
  type ProviderAdapter,
  type ProviderFailureClass,
  type RouteDecision,
  type RouteRequest,
} from '@qandeel-company/governance';
import { GovernanceStore, type CompanyStore, type Fence } from '@qandeel-company/storage';
import { authorizeModelCall, containProviderFault, holdReservation, recordDeploymentOutcome, releaseReservation, reserveBudget, settleReservation, type GovernedRunContext } from '@qandeel-company/storage/runtime-authority';

import { isAssembledContext, type AssembledContext } from '../c3/context-assembler.js';
import { answerSnapshot, errorSnapshot, failureSnapshot, type ProviderSnapshot, type SnapshotBounds } from './provider-boundary.js';
import type { ModelCallOutcome, ModelCallRequest } from './types.js';

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
    const profile = run.cognitiveProfile;
    let requested = req.reasoningClass ?? profile.defaultClass;
    let firstKind: AttemptKind = 'PRIMARY';
    if (req.escalation) {
      const done = governance.reservations(run.runId).filter((r) => r.attemptKind === 'ESCALATION').length;
      const plan = planEscalation(req.escalation.fromClass, req.escalation.evidence, done, policy, profile.ceilingClass);
      if (!plan.ok) return { kind: 'ESCALATION_REFUSED', code: plan.code };
      requested = plan.toClass;
      firstKind = 'ESCALATION';
    }
    const currency = governance.budgetFor('COMPANY', 'company')?.currency ?? 'XXX';
    const routeReq: RouteRequest = {
      taskClass: req.taskClass,
      reasoningClass: requested,
      // The context's effective data class comes from durable state (declared class raised by tool
      // results already in context): neither the model nor the processor can lower it.
      dataClass: auth.dataClass,
      inputTokensUpperBound: Math.max(utf8TokenUpperBound(context.messages), context.estimatedInputTokens),
      maxOutputTokens: req.maxOutputTokens,
      employeeCeiling: profile.ceilingClass,
      currency,
    };
    let decision: RouteDecision = route(routeReq, policy, routable(snapshot.deployments), store.now());
    if (decision.kind === 'NO_LLM') return { kind: 'NO_LLM' };
    if (decision.kind === 'NONE') return { kind: 'UNAVAILABLE', code: decision.code };
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
            { providerCode: d.deployment.providerCode, modelCode: d.deployment.modelCode, deploymentCode: d.deployment.code, messages: context.messages, maxOutputTokens: req.maxOutputTokens },
            { inputUpperBound: routeReq.inputTokensUpperBound, maxOutputTokens: req.maxOutputTokens, priceCard: (d.deployment.priceCard as PriceCard | undefined) ?? null },
            signal,
          );
          // From here on the call may have been billed. Bookkeeping that fails (an out-of-range usage
          // report, a busy store) never escapes as a processor error that would retry the same route:
          // the money stays held for reconciliation and the deployment is held as a contract violation
          // (R1-09, D13-F.1/.8, D-C2-07). The run-settle backstop holds anything still reserved.
          let settled: { readonly done: ModelCallOutcome } | AttemptFailure;
          try {
            settled = this.#account(store, fence, d, reservationId, sessionId, provided, attempt, context.manifestId);
          } catch {
            // Whether the PROVIDER broke the contract was decided at the boundary, never inferred from
            // whichever local error the store threw (R1 re-review).
            return this.#containAccountingFailure(store, fence, reservationId, d.deployment.id, provided.providerFault);
          }
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
          if (!disp.fallback) return disp.sent === 'UNKNOWN' ? { kind: 'UNCERTAIN', failure } : { kind: 'FAILED', failure };
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
      settleReservation(store, fence, reservationId, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, withinBounds: usage.withinBounds, sessionId, outcome: 'OK' }, s.providerFault);
      if (!s.providerFault) recordHealth(store, fence, deploymentId, null);
      return { done: { kind: 'OK', proposal: parseProposal(s.outputText), usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, deploymentId: d.deployment.id, reasoningClass: d.reasoningClass, attempts: attempt, manifestId } };
    }
    const failure = s.failure ?? 'UNKNOWN';
    const disp = failureDisposition(failure);
    if (usage.state === 'REPORTED') {
      // Billed despite failing: charged truthfully, never hidden. A provider fault (usage outside the
      // bounds, or a failure it classified as a contract violation) contains the deployment inside the
      // settle transaction, never by a separate best-effort write, and the same route is not retried.
      settleReservation(store, fence, reservationId, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, withinBounds: usage.withinBounds, sessionId, outcome: 'FAILED_CHARGED' }, s.providerFault);
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
    return { kind: 'UNCERTAIN', failure: providerFault ? 'CONTRACT_VIOLATION' : 'UNKNOWN' };
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