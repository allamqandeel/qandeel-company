/**
 * Runtime-authority storage operations (D-C1-22): Runtime Supervisor lease, execution claims,
 * worker (fenced) writes, claim recovery and runtime-instance bookkeeping.
 *
 * Exported ONLY through the `@qandeel-company/storage/runtime-authority` subpath, which only
 * `@qandeel-company/runtime` may import (ESLint `no-restricted-syntax` + verifier rule
 * `runtime-authority-confined`). The ordinary `@qandeel-company/storage` entry point exposes no
 * claim, no supervisor acquisition and no worker write, so a future package cannot acquire
 * executable work outside the Runtime Supervisor.
 *
 * Every claim presents the current Runtime Supervisor fence (mandatory, verified inside the claim
 * transaction). A fence is accepted only if `acquireSupervisor` issued it in this process: a fence
 * rebuilt from the publicly readable lease row is refused. Every worker write presents its job fence. Recovery writes that take a claim away
 * from a worker also present the supervisor fence.
 */
import { QandeelError, isQandeelError, type Id, type JsonObject, type JsonValue, type ProcessorResult, type Timestamp } from '@qandeel-company/domain';
import { INVALID_OUTPUT_CODES, OUTPUT_CONTRACT_CODES, PROPOSAL_TYPES, type DataClass, type OutputDiagnosticCode, type OutcomeJudgment, type ProviderFailureClass } from '@qandeel-company/governance';

import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import {
  issueSupervisorFence,
  prepareCheckpoint,
  txCheckpoint,
  txClaimJob,
  txClaimNext,
  txInterruptClaim,
  txRenewLease,
  txSettle,
  verifyFence,
  verifySupervisor,
  type Claim,
  type ClaimOptions,
  type SettleOptions,
  type SettleOutcome,
} from './queue.js';
import type { Fence, SupervisorFence } from './records.js';
import {
  readWakeGeneration,
  txAbandonStaleInstances,
  txAcquireSupervisor,
  txRegisterInstance,
  txReleaseSupervisor,
  txRenewSupervisor,
  txUpdateInstance,
  type InstanceState,
} from './runtime-state.js';
import type { SettleUsage } from './governance-core.js';
import type { MemoryCandidateRecord } from './mind-records.js';
import {
  txAuthorizeModelCall,
  txBeginGovernedRun,
  txContainProviderFault,
  txDeploymentOutcome,
  txHold,
  txHoldUnsettledModelCalls,
  GOVERNED_WAITS,
  txRecheckGovernedWait,
  type GovernedWait,
  txRecoverGovernedOrphans,
  txRelease,
  txReserve,
  txSettle as txSettleReservation,
  txToolIntent,
  txToolResult,
  type AuthorizeResult,
  type BeginResult,
  type GovernedRecoverySummary,
  type ReserveInput,
  type ReserveResult,
  type ToolDriverOutcome,
  type ToolIntent,
  type ToolIntentInput,
} from './governed-writes.js';
import { userVersion } from './migrations.js';
import {
  pendingCandidateIds,
  txAssembleContext,
  txDecideMemoryCandidate,
  txRecheckCapabilityWait,
  txRecheckContextHold,
  txRecordStepResult,
  txRefuseCandidate,
  txSubmitMemoryCandidate,
  type AssembleRequest,
  type AssembleResult,
  type CandidateProposal,
  type StepResultKind,
  type SubmitResult,
} from './mind-writes.js';
import { txRecordMessage, type MessageProposalInput, type RecordMessageResult } from './communications.js';
import { digitalRefusalCode, prepareDigitalAct, txDigitalAct, type DigitalActOutcome, type DigitalPrepared } from './digital.js';
import { txGoalAct } from './goals.js';
import { getEmployeeRow, recoverBudgetAdmissions } from './governance-core.js';
import { attributed } from './governed-writes.js';
import { txRecordAnswer, type AnswerInput, type AnswerProvenance, type RecordAnswerResult } from './answers.js';
import { materializeExpiredActing } from './org-core.js';
import { txOrgAct, txReviewDecision, type OrgActResult, type ReviewDecisionResult } from './org-writes.js';
import { sweepReviews } from './review-core.js';
import { storeContext, type CompanyStore } from './store.js';
import { txRequestCancellation, txSupersede } from './work-items.js';
import type { TerminationOutcome } from './work-core.js';

export type { Claim, ClaimOptions, SettleOptions, SettleOutcome } from './queue.js';
export type { InstanceState } from './runtime-state.js';

/** One short `BEGIN IMMEDIATE` transaction on the store's connection (never awaits inside). */
function write<T>(store: CompanyStore, operation: string, fn: (ctx: StoreContext) => T): T {
  const ctx = storeContext(store);
  return ctx.db.immediate(operation, () => fn(ctx));
}

/** Fenced worker write: a STALE_LEASE rejection is itself audited (in its own transaction). */
function fenced<T>(store: CompanyStore, operation: string, fence: Fence, fn: (ctx: StoreContext) => T): T {
  try {
    return write(store, operation, fn);
  } catch (error) {
    if (isQandeelError(error, 'STALE_LEASE')) {
      try {
        write(store, 'audit stale lease', (ctx) =>
          appendAudit(ctx, 'fencing.rejected', 'job', fence.jobId, {}, 'REJECTED', 'STALE_LEASE', {
            operation,
            workerId: fence.workerId,
            presentedToken: fence.fencingToken,
            currentToken: (error.details.currentToken as number | null) ?? null,
          }),
        );
      } catch {
        // Auditing a rejection must never mask the rejection itself.
      }
    }
    throw error;
  }
}

// --- Runtime Supervisor lease -------------------------------------------------------------------

export function acquireSupervisor(store: CompanyStore, holderId: Id, ttlMs: number): SupervisorFence {
  try {
    return issueSupervisorFence(write(store, 'acquire supervisor', (ctx) => txAcquireSupervisor(ctx, holderId, ttlMs)));
  } catch (error) {
    if (isQandeelError(error, 'LEASE_HELD')) {
      try {
        write(store, 'audit acquire refused', (ctx) =>
          appendAudit(ctx, 'supervisor.acquire_refused', 'runtime', holderId, {}, 'REJECTED', 'LEASE_HELD', {
            holder: String(error.details.holderId ?? ''),
            expiresAt: String(error.details.expiresAt ?? ''),
          }),
        );
      } catch {
        // Auditing a rejection must never mask the rejection itself.
      }
    }
    throw error;
  }
}

export interface SupervisorRenewal {
  readonly expiresAt: Timestamp;
  /** The durable wake generation read in the same transaction (lost-wake reconciliation). */
  readonly wakeGeneration: number;
}

/** Token-conditional renewal; fails (SUPERVISOR_NOT_AUTHORITATIVE) after a takeover. */
export function renewSupervisor(store: CompanyStore, fence: SupervisorFence, ttlMs: number): SupervisorRenewal {
  return write(store, 'renew supervisor', (ctx) => ({ expiresAt: txRenewSupervisor(ctx, fence, ttlMs), wakeGeneration: readWakeGeneration(ctx) }));
}

export function releaseSupervisor(store: CompanyStore, fence: SupervisorFence): boolean {
  return write(store, 'release supervisor', (ctx) => txReleaseSupervisor(ctx, fence));
}

// --- Execution claims (supervisor fence mandatory) ----------------------------------------------

export function claimNext(store: CompanyStore, options: ClaimOptions): Claim | null {
  return write(store, 'claim next job', (ctx) => txClaimNext(ctx, options));
}

export function claimJob(store: CompanyStore, jobId: Id, options: ClaimOptions): Claim | null {
  return write(store, 'claim job', (ctx) => txClaimJob(ctx, jobId, options));
}

// --- Worker writes (job fence mandatory) ---------------------------------------------------------

export function renewLease(store: CompanyStore, fence: Fence, leaseMs: number): Timestamp {
  return fenced(store, 'renew lease', fence, (ctx) => txRenewLease(ctx, fence, leaseMs));
}

export function checkpoint(store: CompanyStore, fence: Fence, kind: string, state: JsonValue, kindVersion: number, leaseMs: number): number {
  const prepared = prepareCheckpoint(kind, state, kindVersion);
  const seq = fenced(store, 'checkpoint', fence, (ctx) => txCheckpoint(ctx, fence, prepared, leaseMs));
  storeContext(store).fault('checkpoint.afterCommit');
  return seq;
}

export function settle(store: CompanyStore, fence: Fence, result: ProcessorResult, options: SettleOptions): SettleOutcome {
  return fenced(store, 'settle', fence, (ctx) => {
    const out = txSettle(ctx, fence, result, options);
    // R1-09 backstop: no model-call reservation outlives its run as RESERVED (possibly billed → held).
    txHoldUnsettledModelCalls(ctx, fence.runId);
    // C3: a capability gap may have closed while the run was settling — re-check in the same transaction.
    // Likewise a memory / skill conflict resolved between the held assembly and this park.
    if (result.type === 'WAIT' && ['CAPABILITY_GAP', 'MEMORY_CONFLICT_REVIEW', 'SKILL_CONFLICT_REVIEW'].includes(result.reasonCode)) {
      const wi = ctx.db.get<{ w: string }>('SELECT work_item_id AS w FROM queue_jobs WHERE id = ?', fence.jobId)?.w as Id | undefined;
      if (wi && result.reasonCode === 'CAPABILITY_GAP') txRecheckCapabilityWait(ctx, wi);
      else if (wi) txRecheckContextHold(ctx, wi, result.reasonCode as 'MEMORY_CONFLICT_REVIEW' | 'SKILL_CONFLICT_REVIEW');
    }
    // C2 waits have the same window (R1-06): an approval decided or a cap raised while the job was
    // still claimed found no WAITING job to wake — re-check in this same transaction.
    // C4 waits (independent review, delegation, clarification, escalation) share the window and the remedy.
    if (result.type === 'WAIT' && (GOVERNED_WAITS as readonly string[]).includes(result.reasonCode)) {
      const wi = ctx.db.get<{ w: string }>('SELECT work_item_id AS w FROM queue_jobs WHERE id = ?', fence.jobId)?.w as Id | undefined;
      if (wi) txRecheckGovernedWait(ctx, wi, fence.runId, result.reasonCode as GovernedWait);
    }
    return out;
  });
}

// --- Claim recovery (supervisor fence mandatory) -------------------------------------------------

export function interruptClaim(store: CompanyStore, supervisor: SupervisorFence, jobId: Id, reasonCode: string): ReturnType<typeof txInterruptClaim> {
  return write(store, 'interrupt claim', (ctx) => {
    verifySupervisor(ctx, supervisor);
    return txInterruptClaim(ctx, jobId, reasonCode);
  });
}

/** Closes RUNNING runs whose job no longer points at them (defensive recovery; normally none). */
export function interruptOrphanRun(store: CompanyStore, supervisor: SupervisorFence, runId: Id): boolean {
  return write(store, 'interrupt orphan run', (ctx) => {
    verifySupervisor(ctx, supervisor);
    const changed = ctx.db.run(
      `UPDATE runs SET state = 'INTERRUPTED', ended_at = ?, failure_category = 'INTERRUPTED', failure_code = 'ORPHAN_RUN', recovery_disposition = 'SAFE_TO_RETRY'
        WHERE id = ? AND state = 'RUNNING' AND NOT EXISTS (SELECT 1 FROM queue_jobs j WHERE j.current_run_id = runs.id AND j.state = 'CLAIMED')`,
      ts(ctx),
      runId,
    ).changes;
    if (changed) appendAudit(ctx, 'run.orphan_interrupted', 'run', runId, {}, 'OK', 'ORPHAN_RUN', {});
    return changed === 1;
  });
}

/** Durable termination intent whose job is no longer running: finalize it (recovery). */
export function settleDanglingTermination(store: CompanyStore, supervisor: SupervisorFence, workItemId: Id): TerminationOutcome {
  return write(store, 'settle dangling termination', (ctx) => {
    verifySupervisor(ctx, supervisor);
    const item = getWorkItemRow(ctx, workItemId);
    const mode = item.terminationRequested;
    if (mode === null) return { terminated: [], requested: [], signalJobIds: [], retained: [], alreadyTerminal: [item.id] };
    return mode === 'SUPERSEDED' && item.supersededBy
      ? txSupersede(ctx, item.id, item.supersededBy, { reasonCode: item.terminationReason ?? 'SUPERSEDED' })
      : txRequestCancellation(ctx, item.id, { reasonCode: item.terminationReason ?? 'CANCELLED' });
  });
}

// --- Runtime instances ---------------------------------------------------------------------------

export function registerInstance(store: CompanyStore, id: Id, pid: number, runtimeVersion: string): void {
  write(store, 'register instance', (ctx) => txRegisterInstance(ctx, id, pid, runtimeVersion, userVersion(ctx.db)));
}

export function updateInstance(store: CompanyStore, id: Id, state: InstanceState, fields: { supervisorToken?: number; recovery?: Record<string, number | string | boolean | null> } = {}): void {
  write(store, 'update instance', (ctx) => txUpdateInstance(ctx, id, state, fields));
}

export function abandonStaleInstances(store: CompanyStore, supervisor: SupervisorFence, currentId: Id): number {
  return write(store, 'abandon stale instances', (ctx) => {
    verifySupervisor(ctx, supervisor);
    return txAbandonStaleInstances(ctx, currentId);
  });
}

// --- C2 governed execution writes (job fence mandatory; runtime only) -----------------------------

export type { BeginResult, GovernedRecoverySummary, GovernedRunContext, ReserveInput, ReserveResult, ToolDriverOutcome, ToolIntent, ToolIntentInput, AuthorizeResult } from './governed-writes.js';
export { GOVERNED_STEP_SPAN } from './governed-writes.js';
export type { SettleUsage } from './governance-core.js';

/** Binds the run to its eligible Employee (and Department). */
export function beginGovernedRun(store: CompanyStore, fence: Fence): BeginResult {
  return fenced(store, 'begin governed run', fence, (ctx) => txBeginGovernedRun(ctx, fence));
}

export function authorizeModelCall(store: CompanyStore, fence: Fence, input: { taskClass: string; dataClass: DataClass }): AuthorizeResult {
  return fenced(store, 'authorize model call', fence, (ctx) => txAuthorizeModelCall(ctx, fence, input));
}

/** Worst-case reservation before a call; committed before the call is made. */
export function reserveBudget(store: CompanyStore, fence: Fence, input: ReserveInput): ReserveResult {
  const r = fenced(store, 'reserve budget', fence, (ctx) => txReserve(ctx, fence, input));
  if (r.ok) storeContext(store).fault('reservation.afterCommit');
  return r;
}

/**
 * Settles actual usage. `providerFault` (the runtime's verdict from the provider's own answer) contains
 * the reservation's deployment in the same transaction; usage outside the bounds always does (R1-09).
 */
export function settleReservation(store: CompanyStore, fence: Fence, reservationId: Id, usage: SettleUsage, providerFault = false): Id | null {
  return write(store, 'settle reservation', (ctx) => txSettleReservation(ctx, fence, reservationId, usage, providerFault));
}

export function releaseReservation(store: CompanyStore, fence: Fence, reservationId: Id, reasonCode: string): void {
  write(store, 'release reservation', (ctx) => txRelease(ctx, fence, reservationId, reasonCode));
}

export function holdReservation(store: CompanyStore, fence: Fence, reservationId: Id, reasonCode: string): void {
  write(store, 'hold reservation', (ctx) => txHold(ctx, fence, reservationId, reasonCode));
}

/** Holds the money of a provider answer that broke the contract and contains its deployment, atomically (R1-09). */
export function containProviderFault(store: CompanyStore, fence: Fence, reservationId: Id, reasonCode: string): void {
  write(store, 'contain provider fault', (ctx) => txContainProviderFault(ctx, fence, reservationId, reasonCode));
}

export function recordDeploymentOutcome(store: CompanyStore, fence: Fence, deploymentId: Id, failure: ProviderFailureClass | null): void {
  write(store, 'deployment outcome', (ctx) => txDeploymentOutcome(ctx, fence, deploymentId, failure));
}

/** Durable tool intent after the complete authority path; committed before any driver call. */
export function recordToolIntent(store: CompanyStore, fence: Fence, input: ToolIntentInput): ToolIntent {
  const intent = fenced(store, 'tool intent', fence, (ctx) => txToolIntent(ctx, fence, input));
  if (intent.kind === 'EXECUTE') storeContext(store).fault('toolIntent.afterCommit');
  return intent;
}

export function recordToolResult(store: CompanyStore, fence: Fence, invocationId: Id, outcome: ToolDriverOutcome): string {
  return write(store, 'tool result', (ctx) => txToolResult(ctx, fence, invocationId, outcome));
}

/**
 * C7-D: the effect of one internal `digital-workspace` act, called by the Tool Executor for an EXECUTE intent of that
 * Company-native tool (the intent has already passed the full authority path). Artifact Store I/O happens first (its own
 * fenced, crash-safe protocol); then ONE fenced transaction applies the act and records the tool result together — so a
 * crash leaves either nothing (the orphan intent is retried under the same key) or the whole act. The run receives the
 * act's result; the durable invocation keeps a content-free digest where the result carries file content.
 */
export function recordDigitalWorkspaceAct(store: CompanyStore, fence: Fence, invocationId: Id, actionCode: string, args: JsonObject): { readonly state: string; readonly outcome: DigitalActOutcome } {
  let prepared: DigitalPrepared = {};
  let refusal: string | null = null;
  try {
    prepared = prepareDigitalAct(store, fence, actionCode, args);
  } catch (error) {
    refusal = digitalRefusalCode(error);
    if (refusal === null) throw error;
  }
  return fenced(store, 'digital act', fence, (ctx) => {
    verifyFence(ctx, fence);
    const outcome: DigitalActOutcome = refusal !== null ? { ok: false, code: refusal, sent: 'NO' } : txDigitalAct(ctx, fence, actionCode, args, prepared);
    const durable: ToolDriverOutcome = outcome.ok ? { ok: true, result: outcome.durable ?? outcome.result } : outcome;
    return { state: txToolResult(ctx, fence, invocationId, durable), outcome };
  });
}

/** Recovery (supervisor fence mandatory): classify governed work of runs that are no longer running. */
export function recoverGovernedOrphans(store: CompanyStore, supervisor: SupervisorFence, limit = 100): GovernedRecoverySummary {
  return write(store, 'recover governed orphans', (ctx) => {
    verifySupervisor(ctx, supervisor);
    return txRecoverGovernedOrphans(ctx, limit);
  });
}

/**
 * Recovery (supervisor fence mandatory): R2-03 / FA-1 — one startup pass: stale budget admissions are reclaimed, then
 * BUDGET_EXHAUSTED waiters are admitted against the capacity that returned. Returns the number admitted (and woken).
 */
export function recoverBudgetWaits(store: CompanyStore, supervisor: SupervisorFence): number {
  return write(store, 'recover budget waits', (ctx) => {
    verifySupervisor(ctx, supervisor);
    return recoverBudgetAdmissions(ctx);
  });
}

// --- C3 governed Context Assembly and memory candidates (job fence mandatory; runtime only) --------

export type { AssembleRequest, AssembleResult, CandidateProposal, StepResultKind, SubmitResult } from './mind-writes.js';
export type { MemoryCandidateRecord } from './mind-records.js';

/**
 * Governed Context Assembly for one inference: durable reads, hard budget, integrity-verified content
 * for the selection only, and the Context Manifest — in one transaction. The only producer of model input.
 */
export function assembleContext(store: CompanyStore, fence: Fence, request: AssembleRequest): AssembleResult {
  return fenced(store, 'assemble context', fence, (ctx) => txAssembleContext(ctx, fence, request));
}

/** Records a structured memory CANDIDATE from the run (provenance, evidence and class floor set here, never by the model). */
export function submitMemoryCandidate(store: CompanyStore, fence: Fence, step: number, proposal: CandidateProposal): SubmitResult {
  const r = fenced(store, 'submit memory candidate', fence, (ctx) => txSubmitMemoryCandidate(ctx, fence, step, proposal));
  if (r.kind === 'SUBMITTED') storeContext(store).fault('memoryCandidate.afterCommit');
  return r;
}

/** The runtime-owned Memory Write Policy decides one candidate (its own transaction, after submission). */
export function decideMemoryCandidate(store: CompanyStore, fence: Fence, candidateId: Id): MemoryCandidateRecord {
  return fenced(store, 'decide memory candidate', fence, (ctx) => {
    verifyFence(ctx, fence);
    // The candidate must belong to this run's Work Item (a resumed run replays an earlier run's step).
    const c = ctx.db.get<{ work_item_id: string }>('SELECT work_item_id FROM memory_candidates WHERE id = ?', candidateId);
    const a = ctx.db.get<{ work_item_id: string }>('SELECT work_item_id FROM run_attributions WHERE run_id = ?', fence.runId);
    if (!c || !a || c.work_item_id !== a.work_item_id) throw new QandeelError('AUTHORITY_DENIED', 'this candidate belongs to another Work Item', { candidateId, reason: 'CANDIDATE_NOT_THIS_WORK' });
    return txDecideMemoryCandidate(ctx, candidateId);
  });
}

/**
 * D-L1-20 — the durable, content-free diagnosis of a model output that failed proposal validation: the parser's closed
 * classification, the run step and the reasoning class, as one audit row of the run (job fence mandatory). The output
 * text is never stored; nothing reads this back into a context, so retry / escalation behaviour is unchanged. D-L1-24: an
 * answer-only Work Item also records a VALID proposal that breaks its output contract (WRONG_PROPOSAL_TYPE, naming the
 * recognized proposal type; ANSWER_REFUSED, naming the answer fence's refusal code) — closed codes, never content.
 */
export function recordInvalidOutput(store: CompanyStore, fence: Fence, input: { step: number; code: OutputDiagnosticCode; reasoningClass: string; proposalType?: string; refusalCode?: string }): void {
  fenced(store, 'record invalid model output', fence, (ctx) => {
    verifyFence(ctx, fence);
    if (!(INVALID_OUTPUT_CODES as readonly string[]).includes(input.code) && !(OUTPUT_CONTRACT_CODES as readonly string[]).includes(input.code)) throw new QandeelError('VALIDATION_FAILED', 'an invalid-output code is a closed parser or output-contract classification', { field: 'code' });
    if (!['E1', 'E2', 'E3', 'E4'].includes(input.reasoningClass)) throw new QandeelError('VALIDATION_FAILED', 'unknown reasoning class', { field: 'reasoningClass' });
    if (input.proposalType !== undefined && (input.code !== 'WRONG_PROPOSAL_TYPE' || !(PROPOSAL_TYPES as readonly string[]).includes(input.proposalType))) throw new QandeelError('VALIDATION_FAILED', 'a proposal type is a closed name of a wrong-type diagnosis', { field: 'proposalType' });
    if (input.refusalCode !== undefined && (input.code !== 'ANSWER_REFUSED' || !/^[A-Z][A-Z_]{1,31}$/.test(input.refusalCode))) throw new QandeelError('VALIDATION_FAILED', 'a refusal code is a closed code of a refused answer', { field: 'refusalCode' });
    appendAudit(ctx, 'run.model_output_invalid', 'run', fence.runId, {}, 'REJECTED', input.code, { step: Math.max(0, Math.trunc(input.step)), reasoningClass: input.reasoningClass, ...(input.proposalType !== undefined ? { proposalType: input.proposalType } : {}), ...(input.refusalCode !== undefined ? { refusalCode: input.refusalCode } : {}) });
  });
}

/** Records one step's result for context layer L6 (the runtime's governed services only; job fence mandatory). */
export function recordStepResult(store: CompanyStore, fence: Fence, step: number, kind: StepResultKind, content: string): void {
  fenced(store, 'record step result', fence, (ctx) => txRecordStepResult(ctx, fence, step, kind, content));
}

/**
 * Recovery (supervisor fence mandatory): decide candidates whose run died between submission and
 * decision — each in its own transaction, so one undecidable candidate is refused with a code and can
 * never block startup.
 */
export function decidePendingCandidates(store: CompanyStore, supervisor: SupervisorFence, limit = 100): number {
  const ids = write(store, 'list pending candidates', (ctx) => {
    verifySupervisor(ctx, supervisor);
    return pendingCandidateIds(ctx, limit);
  });
  for (const id of ids) {
    try {
      write(store, 'decide pending candidate', (ctx) => {
        verifySupervisor(ctx, supervisor);
        txDecideMemoryCandidate(ctx, id);
      });
    } catch (error) {
      if (isQandeelError(error, 'SUPERVISOR_NOT_AUTHORITATIVE') || isQandeelError(error, 'STORAGE_BUSY')) throw error;
      write(store, 'refuse pending candidate', (ctx) => {
        verifySupervisor(ctx, supervisor);
        txRefuseCandidate(ctx, id, 'POLICY_ERROR');
      });
    }
  }
  return ids.length;
}

// --- C4 organizational acts and review decisions (job fence mandatory; runtime only) ------------------

export type { OrgActAfter, OrgActResult, ReviewDecisionResult } from './org-writes.js';
/** R2-04: the one open-handoff set (the runtime's `openHandoffs` counts exactly these). */
export { OPEN_HANDOFF_STATES } from './org-core.js';

/** One organizational act of the run's Employee at a Work-Item-global step (idempotent per step). */
export function recordOrgAct(store: CompanyStore, fence: Fence, step: number, action: unknown, args: unknown): OrgActResult {
  return fenced(store, 'organization act', fence, (ctx) => txOrgAct(ctx, fence, step, action, args));
}

/**
 * The reviewer's decision from inside its own review Work Item (re-checked at this boundary) — or, C6-R1, a pool
 * judge's decision on a C6 subject from its own judgment Work Item. An outcome judgment rides along optionally.
 */
export function recordReviewDecision(store: CompanyStore, fence: Fence, input: { outcome: unknown; reasonCode: string; rationale: string | null; evidenceRefs: readonly string[]; outcomeJudgment?: OutcomeJudgment | null }): ReviewDecisionResult {
  return fenced(store, 'review decision', fence, (ctx) => txReviewDecision(ctx, fence, input));
}

// --- C5 Founder communication and goals (job fence mandatory; runtime only) ------------------------------

export type { MessageProposalInput, RecordMessageResult } from './communications.js';

/**
 * The run's Employee posts one structured message into the Founder thread its Work Item answers (C5,
 * Stage 9). The thread binding is the item's immutable processor input; the sender is the attributed
 * Employee, never a value in the output; a message never decides, approves or grants anything.
 */
export function recordMessage(store: CompanyStore, fence: Fence, input: MessageProposalInput): RecordMessageResult {
  return fenced(store, 'founder message', fence, (ctx) => {
    verifyFence(ctx, fence);
    const a = attributed(ctx, fence);
    const e = getEmployeeRow(ctx, a.employeeId);
    return txRecordMessage(ctx, fence, a.employeeId, e.ref, a.workItemId, input);
  });
}

export type { AnswerInput, AnswerProvenance, RecordAnswerResult } from './answers.js';

/**
 * L1-02: the run's Employee records the one typed answer of its own answer-bearing Work Item (an Academy attempt, a Skill
 * benchmark case, shadow work). The binding is the run's own Work Item; the writer is the attributed Employee; the answer
 * never scores, approves or grants anything.
 */
export function recordAnswer(store: CompanyStore, fence: Fence, input: AnswerInput, from: AnswerProvenance): RecordAnswerResult {
  return fenced(store, 'work answer', fence, (ctx) => {
    verifyFence(ctx, fence);
    const a = attributed(ctx, fence);
    return txRecordAnswer(ctx, fence, a.employeeId, a.workItemId, input, from);
  });
}

/**
 * A Director derives a Department goal or links its own work to a goal from inside its governed run (C5, Stage 2
 * §3) — only with BOTH the Director seat and an explicit Founder-delegated `org.goal.*` grant (PO-R2-D, AC-01).
 */
export function recordGoalAct(store: CompanyStore, fence: Fence, action: 'goal.derive' | 'goal.link', args: Record<string, unknown>): { outcome: 'DONE' | 'REFUSED'; code: string; resultRef: string | null } {
  return fenced(store, 'goal act', fence, (ctx) => {
    verifyFence(ctx, fence);
    const a = attributed(ctx, fence);
    const e = getEmployeeRow(ctx, a.employeeId);
    return txGoalAct(ctx, fence, a.employeeId, e.ref, a.departmentId, a.workItemId, action, args);
  });
}

/** Recovery (supervisor fence mandatory): bounded reconciliation of review state and expired acting coverage. */
export function reconcileOrganization(store: CompanyStore, supervisor: SupervisorFence, limit = 100): number {
  return write(store, 'reconcile organization', (ctx) => {
    verifySupervisor(ctx, supervisor);
    return materializeExpiredActing(ctx) + sweepReviews(ctx, limit);
  });
}