/**
 * C2 governed-execution contracts inside the runtime. A governed processor never receives a store,
 * a provider adapter or a tool driver: it gets these bound services, which enforce authority,
 * routing, budgets and fencing on every call (Stage 12 §11, Stage 13 D13-D).
 */
import type { JsonObject, Processor, ProcessorContext, ProcessorResult } from '@qandeel-company/domain';
import type { EscalationEvidence, ModelProposal, ProviderFailureClass, ProviderUsage, ReasoningClass } from '@qandeel-company/governance';
import type { GovernedRunContext } from '@qandeel-company/storage/runtime-authority';

/**
 * One model step. There are no messages here: the runtime assembles the context for the step through
 * the governed C3 Context Assembler (C3 §11) — a processor never supplies model input directly.
 */
export interface ModelCallRequest {
  readonly taskClass: string;
  /** Defaults to the Employee's Cognitive Profile default class. */
  readonly reasoningClass?: ReasoningClass;
  /** Durable step (turn) of the runtime-owned loop; recorded on the context manifest. */
  readonly step: number;
  /** Bounded recent runtime / tool results this loop already holds (layer L6; never memory). */
  readonly recentResults: readonly string[];
  readonly maxOutputTokens: number;
  /** Evidence-based escalation of this step to the next class (never on self-reported uncertainty alone). */
  readonly escalation?: { readonly fromClass: ReasoningClass; readonly evidence: EscalationEvidence };
}

export type ModelCallOutcome =
  | { readonly kind: 'NO_LLM' }
  | { readonly kind: 'OK'; readonly proposal: ModelProposal; readonly usage: ProviderUsage; readonly deploymentId: string; readonly reasoningClass: ReasoningClass; readonly attempts: number; readonly manifestId: string }
  /** No context could be assembled for this step (typed; never a silent truncation). */
  | { readonly kind: 'CONTEXT'; readonly code: 'CONTEXT_BUDGET_EXHAUSTED' | 'CONFLICT_HOLD' | 'SKILL_CONFLICT' | 'INTEGRITY_FAILURE' | 'CONTEXT_NOT_ASSEMBLED' }
  | { readonly kind: 'DENIED'; readonly code: string }
  | { readonly kind: 'BUDGET'; readonly code: string; readonly detail: string }
  | { readonly kind: 'ESCALATION_REFUSED'; readonly code: string }
  | { readonly kind: 'UNAVAILABLE'; readonly code: string }
  | { readonly kind: 'FAILED'; readonly failure: ProviderFailureClass }
  | { readonly kind: 'UNCERTAIN'; readonly failure: ProviderFailureClass };

export interface ToolRequest {
  readonly tool: string;
  readonly action: string;
  readonly args: JsonObject;
}

export type ToolOutcome =
  | { readonly kind: 'SUCCEEDED'; readonly result: unknown; readonly replayed: boolean }
  | { readonly kind: 'DENIED'; readonly code: string; readonly paused: boolean }
  | { readonly kind: 'APPROVAL_REQUIRED'; readonly approvalId: string }
  | { readonly kind: 'REVIEW_REQUIRED' }
  | { readonly kind: 'BUDGET'; readonly code: string }
  | { readonly kind: 'RECONCILIATION_REQUIRED'; readonly invocationId: string }
  | { readonly kind: 'NOT_EXECUTED'; readonly code: string }
  | { readonly kind: 'FAILED'; readonly code: string };

/** A model-proposed memory candidate or observation: submitted to the Memory Write Policy, never written directly. */
export type MemoryProposal = Extract<ModelProposal, { type: 'MEMORY_CANDIDATE' | 'OBSERVATION' }>;

export type MemoryProposalOutcome =
  | { readonly kind: 'DECIDED'; readonly state: string; readonly reasonCode: string | null }
  | { readonly kind: 'INVALID' | 'REFUSED'; readonly code: string };

export interface GovernedRunServices {
  readonly context: GovernedRunContext;
  invokeModel(request: ModelCallRequest): Promise<ModelCallOutcome>;
  /** Submits a model proposal as a memory candidate; the runtime's Memory Write Policy decides it. */
  proposeMemory(proposal: MemoryProposal, step: number): MemoryProposalOutcome;
  /** `step` is a durable, checkpointed step number: it derives the tool call's idempotency key. */
  executeTool(request: ToolRequest, step: number): Promise<ToolOutcome>;
}

/**
 * A processor that runs inside the governed boundary. The runtime binds the run to its eligible
 * Employee before calling it; an ineligible Employee's run never reaches the processor.
 */
export interface GovernedProcessor extends Processor {
  readonly governed: true;
  runGoverned(context: ProcessorContext, services: GovernedRunServices): Promise<ProcessorResult>;
}

export function isGovernedProcessor(p: Processor): p is GovernedProcessor {
  return (p as Partial<GovernedProcessor>).governed === true && typeof (p as Partial<GovernedProcessor>).runGoverned === 'function';
}
