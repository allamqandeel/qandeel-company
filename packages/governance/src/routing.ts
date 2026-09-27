/**
 * Deterministic Router Policy (Stage 13 D13-A.4, D13-B, D13-C, D13-F; Stage 14 D14-B.4).
 *
 * Order is structural: privacy/egress and every other HARD gate run first, per deployment, and only
 * the survivors are optimized. There is no global "best model" ranking: among eligible routes the
 * cheapest worst-case economic cost wins, ties broken by code and id, so the same inputs always
 * give the same route. Routing never expands authority or budget: it only narrows.
 */
import { QandeelError, type Timestamp } from '@qandeel-company/domain';

import { dataRank, reasoningRank, REASONING_CLASSES, type DataClass, type ReasoningClass } from './classes.js';
import { worstCase, type Cost, type PriceCard } from './economics.js';

/** Model qualification lifecycle (D13-B.5), applied to a deployment profile, not a model name. */
export const QUALIFICATION_STATES = ['CANDIDATE', 'BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED'] as const;
export type QualificationState = (typeof QUALIFICATION_STATES)[number];
export const QUALIFICATION_NEXT: Readonly<Record<QualificationState, QualificationState | null>> = {
  CANDIDATE: 'BENCHMARK',
  BENCHMARK: 'SHADOW',
  SHADOW: 'CHALLENGER',
  CHALLENGER: 'LIMITED_PRODUCTION',
  LIMITED_PRODUCTION: 'QUALIFIED',
  QUALIFIED: null,
};

export const OPERATIONAL_STATUSES = ['ACTIVE', 'HOLD', 'RETIRED'] as const;
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

export const LOCALITIES = ['LOCAL', 'EXTERNAL'] as const;
export type Locality = (typeof LOCALITIES)[number];

export interface DeploymentView {
  readonly id: string;
  readonly code: string;
  readonly providerId: string;
  readonly providerCode: string;
  readonly providerStatus: OperationalStatus;
  readonly modelCode: string;
  readonly locality: Locality;
  readonly status: OperationalStatus;
  readonly qualification: QualificationState;
  readonly reasoningClass: ReasoningClass;
  readonly taskClasses: readonly string[];
  /** Highest data class explicitly approved for this deployment's egress profile; null = none. */
  readonly egressMaxDataClass: DataClass | null;
  readonly circuitOpenUntil: Timestamp | null;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly priceCard: PriceCard | null;
}

export interface EscalationPolicy {
  /** Maximum escalations per Run. */
  readonly maxDepth: number;
  /** Ceiling on retry + fallback + escalation spend per Run (economic micro-units). */
  readonly maxOverheadMicros: number;
}

export interface RoutePolicy {
  readonly id: string;
  readonly taskClass: string;
  readonly version: number;
  readonly minClass: ReasoningClass;
  readonly maxClass: ReasoningClass;
  readonly allowLimitedProduction: boolean;
  readonly maxRetriesPerCall: number;
  readonly maxCallsPerRun: number;
  /**
   * An explicit allowance for a fallback whose worst case exceeds the original route's
   * (D13-F.4 / Stage 3 §6). Null = a fallback may never cost more than the route it replaces.
   */
  readonly fallbackCostCeilingMicros: number | null;
  readonly escalation: EscalationPolicy;
}

export interface RouteRequest {
  readonly taskClass: string;
  readonly reasoningClass: ReasoningClass;
  /** Highest data class present in the outbound context (set by the runtime, never by the model). */
  readonly dataClass: DataClass;
  readonly inputTokensUpperBound: number;
  readonly maxOutputTokens: number;
  /** The Employee's Cognitive Profile ceiling. */
  readonly employeeCeiling: ReasoningClass;
  readonly currency: string;
  /** Optional hard ceiling on worst-case economic cost (fallback envelope). */
  readonly costCeilingMicros?: number;
  readonly excludeDeploymentIds?: readonly string[];
}

export type RejectionCode =
  | 'EXCLUDED'
  | 'PROVIDER_HOLD'
  | 'DEPLOYMENT_HOLD'
  | 'CIRCUIT_OPEN'
  | 'D4_EXTERNAL_DENIED'
  | 'D3_EXTERNAL_DENIED'
  | 'EGRESS_NOT_APPROVED'
  | 'NOT_QUALIFIED'
  | 'TASK_CLASS_NOT_QUALIFIED'
  | 'REASONING_CLASS_MISMATCH'
  | 'OUTPUT_LIMIT'
  | 'CONTEXT_WINDOW'
  | 'NO_PRICE_CARD'
  | 'CURRENCY_MISMATCH'
  | 'COST_CEILING';

export interface Rejection {
  readonly deploymentId: string;
  readonly code: RejectionCode;
}

export type RouteDecision =
  | { readonly kind: 'NO_LLM'; readonly reasoningClass: 'E0' }
  | { readonly kind: 'ROUTE'; readonly reasoningClass: ReasoningClass; readonly deployment: DeploymentView; readonly worstCase: Cost; readonly rejected: readonly Rejection[] }
  | { readonly kind: 'NONE'; readonly reasoningClass: ReasoningClass; readonly code: 'REASONING_ABOVE_CEILING' | 'NO_ELIGIBLE_DEPLOYMENT'; readonly rejected: readonly Rejection[] };

/** The class a request actually routes at: lifted to the policy minimum (minimum sufficient). */
export function effectiveClass(req: Pick<RouteRequest, 'reasoningClass'>, policy: Pick<RoutePolicy, 'minClass'>): ReasoningClass {
  return reasoningRank(req.reasoningClass) < reasoningRank(policy.minClass) && req.reasoningClass !== 'E0' ? policy.minClass : req.reasoningClass;
}

/**
 * Highest data class that may leave the machine in C2. D3 external egress needs a qualified
 * conditional egress profile that does not exist yet; D4 never leaves. Both fail closed.
 */
export const MAX_EXTERNAL_DATA_CLASS: DataClass = 'D2';

/** True when data of `dataClass` may go to a deployment / tool of `locality` at all in C2. */
export function externalEgressAvailable(locality: string, dataClass: DataClass): boolean {
  return locality === 'LOCAL' || dataRank(dataClass) <= dataRank(MAX_EXTERNAL_DATA_CLASS);
}

/** Hard gates for one deployment, in fixed order: operational → privacy/egress → quality → capacity → cost. */
export function hardGate(d: DeploymentView, req: RouteRequest, policy: RoutePolicy, cls: ReasoningClass, at: Timestamp): RejectionCode | null {
  if (req.excludeDeploymentIds?.includes(d.id)) return 'EXCLUDED';
  if (d.providerStatus !== 'ACTIVE') return 'PROVIDER_HOLD';
  if (d.status !== 'ACTIVE') return 'DEPLOYMENT_HOLD';
  if (d.circuitOpenUntil !== null && d.circuitOpenUntil > at) return 'CIRCUIT_OPEN';
  // Privacy / egress before capability, quality or cost (D14-B.4). D4 never leaves the machine.
  if (req.dataClass === 'D4' && d.locality === 'EXTERNAL') return 'D4_EXTERNAL_DENIED';
  // D3 leaves the machine only through a qualified conditional egress profile (account, endpoint,
  // region, features, retention — Stage 14). C2 has no such profile, so it stays closed (D-C2-13).
  if (!externalEgressAvailable(d.locality, req.dataClass)) return 'D3_EXTERNAL_DENIED';
  if (d.egressMaxDataClass === null || dataRank(d.egressMaxDataClass) < dataRank(req.dataClass)) return 'EGRESS_NOT_APPROVED';
  if (!(d.qualification === 'QUALIFIED' || (d.qualification === 'LIMITED_PRODUCTION' && policy.allowLimitedProduction))) return 'NOT_QUALIFIED';
  if (!d.taskClasses.includes(req.taskClass)) return 'TASK_CLASS_NOT_QUALIFIED';
  if (d.reasoningClass !== cls) return 'REASONING_CLASS_MISMATCH';
  if (req.maxOutputTokens > d.maxOutputTokens) return 'OUTPUT_LIMIT';
  if (req.inputTokensUpperBound + req.maxOutputTokens > d.contextWindowTokens) return 'CONTEXT_WINDOW';
  if (d.priceCard === null) return 'NO_PRICE_CARD';
  if (d.priceCard.currency !== req.currency) return 'CURRENCY_MISMATCH';
  if (req.costCeilingMicros !== undefined && worstCase(d.priceCard, req.inputTokensUpperBound, req.maxOutputTokens).economicMicros > req.costCeilingMicros) return 'COST_CEILING';
  return null;
}

export function route(req: RouteRequest, policy: RoutePolicy, deployments: readonly DeploymentView[], at: Timestamp): RouteDecision {
  if (req.taskClass !== policy.taskClass) throw new QandeelError('VALIDATION_FAILED', 'route policy does not govern this task class', { taskClass: req.taskClass });
  // E0 = NO_LLM: deterministic execution; no deployment is even considered (D13-A.3).
  if (req.reasoningClass === 'E0') return { kind: 'NO_LLM', reasoningClass: 'E0' };
  const cls = effectiveClass(req, policy);
  if (reasoningRank(cls) > reasoningRank(req.employeeCeiling) || reasoningRank(cls) > reasoningRank(policy.maxClass)) {
    return { kind: 'NONE', reasoningClass: cls, code: 'REASONING_ABOVE_CEILING', rejected: [] };
  }
  const rejected: Rejection[] = [];
  const eligible: { d: DeploymentView; cost: Cost }[] = [];
  for (const d of [...deployments].sort((a, b) => a.id.localeCompare(b.id))) {
    const code = hardGate(d, req, policy, cls, at);
    if (code !== null) rejected.push({ deploymentId: d.id, code });
    else eligible.push({ d, cost: worstCase(d.priceCard as PriceCard, req.inputTokensUpperBound, req.maxOutputTokens) });
  }
  // Optimization only among eligible routes.
  eligible.sort((a, b) => a.cost.economicMicros - b.cost.economicMicros || a.d.code.localeCompare(b.d.code) || a.d.id.localeCompare(b.d.id));
  const best = eligible[0];
  if (!best) return { kind: 'NONE', reasoningClass: cls, code: 'NO_ELIGIBLE_DEPLOYMENT', rejected };
  return { kind: 'ROUTE', reasoningClass: cls, deployment: best.d, worstCase: best.cost, rejected };
}

/**
 * Fallback (D13-F.4): only to another prequalified route for the same request (same task class,
 * reasoning class and data class → same quality and privacy contract), and never costlier than the
 * route it replaces unless the policy carries an explicit allowance. No silent expensive fallback.
 */
export function planFallback(original: Extract<RouteDecision, { kind: 'ROUTE' }>, req: RouteRequest, policy: RoutePolicy, deployments: readonly DeploymentView[], failedIds: readonly string[], at: Timestamp): RouteDecision {
  const ceiling = Math.max(original.worstCase.economicMicros, policy.fallbackCostCeilingMicros ?? 0);
  return route(
    { ...req, reasoningClass: original.reasoningClass, costCeilingMicros: Math.min(ceiling, req.costCeilingMicros ?? ceiling), excludeDeploymentIds: [...(req.excludeDeploymentIds ?? []), ...failedIds] },
    policy,
    deployments,
    at,
  );
}

/**
 * Observable escalation evidence (D13-C.3). Self-reported model uncertainty alone is never enough
 * to spend more; the runtime must observe a failure.
 */
export const ESCALATION_EVIDENCE = ['OUTPUT_FAILED_VALIDATION', 'TOOL_RESULT_CONTRADICTION', 'CONTEXT_OVERFLOW', 'CHECK_FAILED', 'SELF_REPORTED_UNCERTAINTY'] as const;
export type EscalationEvidence = (typeof ESCALATION_EVIDENCE)[number];
export const OBSERVABLE_EVIDENCE: ReadonlySet<EscalationEvidence> = new Set(['OUTPUT_FAILED_VALIDATION', 'TOOL_RESULT_CONTRADICTION', 'CONTEXT_OVERFLOW', 'CHECK_FAILED']);

export type EscalationDecision = { readonly ok: true; readonly toClass: ReasoningClass } | { readonly ok: false; readonly code: 'EVIDENCE_NOT_OBSERVABLE' | 'DEPTH_EXCEEDED' | 'CEILING_REACHED' };

/** Bounded, evidence-based escalation of one step to the next reasoning class. */
export function planEscalation(current: ReasoningClass, evidence: EscalationEvidence, escalationsSoFar: number, policy: RoutePolicy, employeeCeiling: ReasoningClass): EscalationDecision {
  if (!OBSERVABLE_EVIDENCE.has(evidence)) return { ok: false, code: 'EVIDENCE_NOT_OBSERVABLE' };
  if (escalationsSoFar >= policy.escalation.maxDepth) return { ok: false, code: 'DEPTH_EXCEEDED' };
  const next = REASONING_CLASSES[reasoningRank(current) + 1];
  if (next === undefined || reasoningRank(next) > reasoningRank(policy.maxClass) || reasoningRank(next) > reasoningRank(employeeCeiling)) return { ok: false, code: 'CEILING_REACHED' };
  return { ok: true, toClass: next };
}

/** Retry only what the taxonomy calls retryable, bounded per call (D13-F.2). */
export function mayRetry(retryable: boolean, retriesSoFar: number, policy: Pick<RoutePolicy, 'maxRetriesPerCall'>): boolean {
  return retryable && retriesSoFar < policy.maxRetriesPerCall;
}

/** The stored body of a Router Policy version (validated; bounded; no free text). */
export type RoutePolicyBody = Omit<RoutePolicy, 'id' | 'taskClass' | 'version'>;

export function assertRoutePolicyBody(v: unknown): RoutePolicyBody {
  const p = v as Partial<RoutePolicyBody> | null;
  if (typeof p !== 'object' || p === null) throw new QandeelError('VALIDATION_FAILED', 'route policy must be an object', { field: 'policy' });
  const cls = (x: unknown, f: string): ReasoningClass => {
    if (!(REASONING_CLASSES as readonly unknown[]).includes(x) || x === 'E0') throw new QandeelError('VALIDATION_FAILED', `${f} must be E1..E4`, { field: f });
    return x as ReasoningClass;
  };
  const int = (x: unknown, f: string, min: number, max: number): number => {
    if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < min || x > max) throw new QandeelError('VALIDATION_FAILED', `${f} must be an integer in [${min}, ${max}]`, { field: f });
    return x;
  };
  const minClass = cls(p.minClass, 'minClass');
  const maxClass = cls(p.maxClass, 'maxClass');
  if (reasoningRank(maxClass) < reasoningRank(minClass)) throw new QandeelError('VALIDATION_FAILED', 'maxClass must be at or above minClass', { field: 'maxClass' });
  const esc = p.escalation as Partial<EscalationPolicy> | undefined;
  if (typeof esc !== 'object' || esc === null) throw new QandeelError('VALIDATION_FAILED', 'escalation policy is required', { field: 'escalation' });
  return {
    minClass,
    maxClass,
    allowLimitedProduction: p.allowLimitedProduction === true,
    maxRetriesPerCall: int(p.maxRetriesPerCall, 'maxRetriesPerCall', 0, 5),
    maxCallsPerRun: int(p.maxCallsPerRun, 'maxCallsPerRun', 1, 200),
    fallbackCostCeilingMicros: p.fallbackCostCeilingMicros === null || p.fallbackCostCeilingMicros === undefined ? null : int(p.fallbackCostCeilingMicros, 'fallbackCostCeilingMicros', 0, 1_000_000_000_000_000),
    escalation: { maxDepth: int(esc.maxDepth, 'escalation.maxDepth', 0, 3), maxOverheadMicros: int(esc.maxOverheadMicros, 'escalation.maxOverheadMicros', 0, 1_000_000_000_000_000) },
  };
}
