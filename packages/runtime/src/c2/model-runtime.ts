/**
 * The governed Model Runtime (Stage 13): the ONLY code that calls a provider adapter (verifier rule
 * `model-calls-confined`). Adapters are handed over at construction and held privately.
 *
 * One call = authorize (`model.invoke`, default deny) → Router Policy (hard gates, then cost) →
 * worst-case reservation committed → provider call → settle actual usage (unused reservation
 * released) or hold it when the outcome is uncertain. Retry, fallback and escalation are separate
 * attempts with separate reasons, each reserved and attributed on its own. The model's output is
 * returned as a typed proposal; this module has no reference to the Tool Executor.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { newId, type Id } from '@qandeel-company/domain';
import {
  FAILURE_DISPOSITIONS,
  ProviderError,
  classifyProviderError,
  mayRetry,
  normalizeUsage,
  parseProposal,
  planEscalation,
  planFallback,
  route,
  utf8TokenUpperBound,
  type AttemptKind,
  type ProviderAdapter,
  type ProviderFailureClass,
  type RouteDecision,
  type RouteRequest,
} from '@qandeel-company/governance';
import { GovernanceStore, type CompanyStore, type Fence } from '@qandeel-company/storage';
import { authorizeModelCall, holdReservation, recordDeploymentOutcome, releaseReservation, reserveBudget, settleReservation, type GovernedRunContext } from '@qandeel-company/storage/runtime-authority';

import type { ModelCallOutcome, ModelCallRequest } from './types.js';

export const DEFAULT_MODEL_CALL_TIMEOUT_MS = 120_000;

export class GovernedModelRuntime {
  readonly #adapters: ReadonlyMap<string, ProviderAdapter>;
  readonly #timeoutMs: number;
  #calls = 0;

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

  async call(store: CompanyStore, fence: Fence, run: GovernedRunContext, req: ModelCallRequest, signal: AbortSignal): Promise<ModelCallOutcome> {
    // Authorization (and the durable effective data class) is re-evaluated before EVERY attempt:
    // a revoked grant or a context raised by a tool result applies to the very next call.
    const auth = authorizeModelCall(store, fence, { taskClass: req.taskClass, dataClass: run.dataClass });
    if (!auth.ok) return { kind: 'DENIED', code: auth.code };
    const governance = GovernanceStore.for(store);
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
      inputTokensUpperBound: utf8TokenUpperBound(req.messages),
      maxOutputTokens: req.maxOutputTokens,
      employeeCeiling: profile.ceilingClass,
      currency,
    };
    let decision: RouteDecision = route(routeReq, policy, snapshot.deployments, store.now());
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
          const outcome = await this.#call(adapter, { providerCode: d.deployment.providerCode, modelCode: d.deployment.modelCode, deploymentCode: d.deployment.code, messages: req.messages, maxOutputTokens: req.maxOutputTokens }, signal);
          if (outcome.ok) {
            let usage;
            try {
              usage = normalizeUsage(outcome.response.usage, { inputUpperBound: routeReq.inputTokensUpperBound, maxOutputTokens: req.maxOutputTokens });
            } catch {
              // Unusable usage report: the provider answered but broke the contract. Hold the full
              // reservation (spend is uncertain), hold the deployment, never retry blindly.
              holdReservation(store, fence, reservationId, 'USAGE_UNREPORTED');
              recordDeploymentOutcome(store, fence, d.deployment.id as Id, 'CONTRACT_VIOLATION');
              return { kind: 'UNCERTAIN', failure: 'CONTRACT_VIOLATION' };
            }
            settleReservation(store, fence, reservationId, { inputTokens: usage.usage.inputTokens, outputTokens: usage.usage.outputTokens, withinBounds: usage.withinBounds, sessionId, outcome: 'OK' });
            recordDeploymentOutcome(store, fence, d.deployment.id as Id, usage.withinBounds ? null : 'CONTRACT_VIOLATION');
            return { kind: 'OK', proposal: parseProposal(outcome.response.outputText), usage: usage.usage, deploymentId: d.deployment.id, reasoningClass: d.reasoningClass, attempts: attempt };
          }
          const failure = outcome.failure;
          lastFailure = failure;
          const disp = FAILURE_DISPOSITIONS[failure];
          if (outcome.usage) {
            // Billed despite failing: charged truthfully, never hidden.
            let u;
            try {
              u = normalizeUsage(outcome.usage, { inputUpperBound: routeReq.inputTokensUpperBound, maxOutputTokens: req.maxOutputTokens });
            } catch {
              u = null;
            }
            if (u) settleReservation(store, fence, reservationId, { inputTokens: u.usage.inputTokens, outputTokens: u.usage.outputTokens, withinBounds: u.withinBounds, sessionId, outcome: 'FAILED_CHARGED' });
            else holdReservation(store, fence, reservationId, failure);
          } else if (disp.sent === 'UNKNOWN') {
            holdReservation(store, fence, reservationId, failure);
          } else {
            releaseReservation(store, fence, reservationId, failure);
          }
          recordDeploymentOutcome(store, fence, d.deployment.id as Id, failure);
          if (mayRetry(disp.retry, retries, policy)) {
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
      const fallback = planFallback(d, routeReq, policy, fresh.deployments, failed, store.now());
      if (fallback.kind !== 'ROUTE') return { kind: 'UNAVAILABLE', code: fallback.kind === 'NONE' && fallback.rejected.some((x) => x.code === 'COST_CEILING') ? 'FALLBACK_REFUSED_COST' : `PROVIDER_${lastFailure}` };
      decision = fallback;
      attemptKind = 'FALLBACK';
      retries = 0;
    }
    return { kind: 'UNAVAILABLE', code: 'ATTEMPTS_EXHAUSTED' };
  }

  /** One bounded adapter call; any adapter misbehaviour is normalized, never propagated. */
  async #call(adapter: ProviderAdapter, request: Parameters<ProviderAdapter['generate']>[0], runSignal: AbortSignal): Promise<{ ok: true; response: Awaited<ReturnType<ProviderAdapter['generate']>> } | { ok: false; failure: ProviderFailureClass; usage: ProviderError['usage'] }> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    runSignal.addEventListener('abort', onAbort, { once: true });
    const timer = new AbortController();
    try {
      const timeout = sleep(this.#timeoutMs, 'TIMEOUT' as const, { signal: timer.signal }).catch(() => 'CANCELLED' as const);
      const result = await Promise.race([adapter.generate(request, controller.signal), timeout]);
      if (result === 'TIMEOUT' || result === 'CANCELLED') {
        controller.abort();
        return { ok: false, failure: 'TIMEOUT_AFTER_SEND', usage: null };
      }
      if (typeof result?.outputText !== 'string') return { ok: false, failure: 'CONTRACT_VIOLATION', usage: null };
      return { ok: true, response: result };
    } catch (error) {
      return { ok: false, failure: classifyProviderError(error), usage: error instanceof ProviderError ? error.usage : null };
    } finally {
      timer.abort();
      runSignal.removeEventListener('abort', onAbort);
    }
  }
}
