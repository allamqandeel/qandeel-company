/**
 * FounderActionStore — the governed confirmation boundary (C5 §11.3 / §15, Stage 14 D14-A.6).
 *
 * A mutating intent (from the command palette or a brief's "decision needed") becomes a structured PREVIEW
 * bound to the Founder's session: intent kind, a validated payload of IDs / codes / bounded numbers, a
 * fingerprint and an expiry. Confirming means presenting the preview id AND its fingerprint from a verified
 * session with a matching CSRF secret; only then does `confirm` call the real authority boundary (the C2
 * approval engine, the Goal store, the C4 organization / review stores) — never a text-derived call.
 *
 * Previews grant nothing, never widen an intent, and R4 (Founder-only sovereignty) is never offered as an
 * approvable action: a Founder decides R4 work outside the approval engine, as before.
 *
 * R2-21: the Founder's exception decisions (an uncertain tool effect, a held reservation or governed job, an
 * escalated review, a systemic finding, an escalated attribution / lesson, a pool-inconclusive outcome, a
 * lesson promotion) are structured-only intents of this same boundary. R2-26: a confirmation is ONE
 * `BEGIN IMMEDIATE` — the check, the effect, CONFIRMED and the audit commit together or not at all.
 */
import { QandeelError, assertCode, assertId, boundedJson, canonicalJson, isTimestamp, newId, sha256Hex, type Id, type Timestamp } from '@qandeel-company/domain';
import { ACTIVATION_INTENTS, APP_CONTROL_APPROVAL_ACTION, BINDING_ROLES, BINDING_SUBJECTS, PILOT_MODES, SOURCE_DECISIONS, assertGoalTransition, assertMoney, assertSourceRegistration, assertTokens, cachedInputRate, isGoalState, isMutatingIntent, nextSourceState, provisioningProfileDigest, type GoalState, type MutatingIntent, type PilotMode, type PilotState, type ProviderProvisioningProfile, type SourceDecision, type SourceState } from '@qandeel-company/governance';
import { academyPackageDigest, assertCauses, containsSecretMaterial, summarizeCauses, type AcademyPackage, type AttributedCause, type EmployeeIdentityProfile } from '@qandeel-company/mind';

import { txControlDecisionView } from './app-controls.js';
import { txDigitalDecisionView } from './digital.js';
import { executeActivation, validateActivationPayload, type ActivationEnv } from './founder-activation.js';
import { txAssertExternalEvidence } from './external-core.js';
import { ExternalEvidenceStore, txAssertBindable } from './external-evidence.js';
import { getBudgetRow, budgetFor } from './governance-core.js';
import { GovernanceStore, IDENTITY_CHECK_MAX_AGE_MS, founderConfirmInternals, isGovernedJob, resolveGovernedReconciliation } from './governance.js';
import { mapIdentityCheck } from './governance-records.js';
import { getGoal, GoalStore } from './goals.js';
import { mapActionPreview, type ActionPreviewRecord } from './founder-records.js';
import { ImprovementStore } from './improvement.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { MemoryStore } from './memory.js';
import { OrganizationStore } from './organization.js';
import { getStaffingRequest } from './organization.js';
import { CONTEST_DECISIONS, assertOutcomeClasses, txContestedVerification, type ContestDecision } from './outcome-core.js';
import { PilotStore, planPilotStep, txBriefingStatus } from './pilots.js';
import { txResolveReconciliation } from './queue.js';
import { ReviewStore } from './review.js';
import { storeContext, type CompanyStore } from './store.js';
import type { FounderAuthStore, FounderSession } from './founder-auth.js';

export const PREVIEW_TTL_MS = 10 * 60_000;

type Payload = Record<string, string | number | boolean | null | readonly string[]>;

const OUTCOME_REF = /^[a-z_]{2,32}:[A-Za-z0-9._:-]{1,96}$/;

/** One of `allowed`, or a typed refusal naming the field. */
function oneOf<T extends string>(raw: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const v = raw[field];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new QandeelError('VALIDATION_FAILED', `${field} is ${allowed.join(' or ')}`, { field });
  return v as T;
}

/** A bounded token count reported by the provider (an integer, never a guess). */
function tokens(raw: Record<string, unknown>, field: string): number {
  const v = raw[field];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1_000_000_000) throw new QandeelError('VALIDATION_FAILED', `${field} is a token count`, { field });
  return v;
}

/** The row a decision targets, in the state the decision needs (IDs / states only). */
function heldRow<R extends { state: string }>(ctx: StoreContext, sql: string, id: Id, what: string, states: readonly string[]): R {
  const r = ctx.db.get<R>(sql, id);
  if (!r) throw new QandeelError('NOT_FOUND', `${what} not found`, { id });
  if (!states.includes(r.state)) throw new QandeelError('INVALID_TRANSITION', `this ${what} is not awaiting that decision`, { id, state: r.state });
  return r;
}

const uncertainToolOn = (ctx: StoreContext, column: 'reservation_id' | 'work_item_id', id: string): boolean =>
  ctx.db.get(`SELECT 1 AS x FROM tool_invocations WHERE ${column} = ? AND state = 'RECONCILIATION_REQUIRED' LIMIT 1`, id) !== undefined;

const later = (at: Timestamp, ms: number): Timestamp => new Date(Date.parse(at) + ms).toISOString() as Timestamp;

/** A corrected cause in a preview payload: one code string `CATEGORY|ROLE|CONFIDENCE|BASIS` (payloads hold codes only). */
const encodeCause = (c: AttributedCause): string => `${c.category}|${c.role}|${c.confidence}|${c.basis}`;
const decodeCause = (v: string): unknown => {
  const [category, role, confidence, basis] = v.split('|');
  return { category, role, confidence, basis };
};

export interface FounderActionOptions {
  /** L1-01: the release-pinned provider profiles the host registered (the only ones PROVIDER_PROVISION may name). */
  readonly profiles?: readonly ProviderProvisioningProfile[];
  /** L1-02: the release-pinned Academy packages the host registered (the only ones the activation intents may name). */
  readonly academyPackages?: readonly AcademyPackage[];
  /** L1-02: the release-pinned Employee identity profiles the host registered (the only ones a hire may name). */
  readonly identityProfiles?: readonly EmployeeIdentityProfile[];
}

const isActivationIntent = (v: string): boolean => (ACTIVATION_INTENTS as readonly string[]).includes(v);

/** Validates one intent's payload against durable state. Returns the canonical (re-shaped) payload. */
function validatePayload(ctx: StoreContext, intent: MutatingIntent, raw: Record<string, unknown>, profiles: readonly ProviderProvisioningProfile[], env: ActivationEnv): Payload {
  // L1-02: the activation intents live in their own module (same boundary, same preview → fingerprint → confirm).
  if (isActivationIntent(intent)) return validateActivationPayload(ctx, intent, raw, env);
  const s = (k: string, max = 161): string => {
    const v = raw[k];
    if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) throw new QandeelError('VALIDATION_FAILED', `${k} is required`, { field: k });
    return v;
  };
  switch (intent) {
    case 'APPROVAL_DECIDE': {
      const approvalId = assertId(raw.approvalId, 'approvalId');
      const decision = raw.decision;
      if (decision !== 'APPROVE' && decision !== 'REJECT') throw new QandeelError('VALIDATION_FAILED', 'decision is APPROVE or REJECT', { field: 'decision' });
      const a = ctx.db.get<{ state: string; risk_level: string; subject_ref: string; action: string }>('SELECT state, risk_level, subject_ref, action FROM approvals WHERE id = ?', approvalId);
      if (!a) throw new QandeelError('NOT_FOUND', 'approval not found', { approvalId });
      if (a.state !== 'PENDING') throw new QandeelError('INVALID_TRANSITION', 'only a pending approval can be decided', { approvalId, state: a.state });
      if (a.risk_level === 'R4' || a.risk_level === 'R2') throw new QandeelError('FOUNDER_ONLY', 'R4 is never approvable through the approval engine and R2 is review-only', { approvalId, risk: a.risk_level });
      const base = { approvalId, decision, reasonCode: assertCode(raw.reasonCode ?? 'founder.decided', 'reasonCode'), risk: a.risk_level, subjectRef: a.subject_ref, action: a.action.slice(0, 64) };
      if (a.action !== APP_CONTROL_APPROVAL_ACTION) {
        // C7-D: an R3 digital promotion is decided on its exact act — which candidate (its manifest hash and summary),
        // what kind of external act, which typed target and the state of its independent review. One promotion only:
        // approving an export never authorizes production, and one post never authorizes another.
        const d = txDigitalDecisionView(ctx, approvalId);
        if (d === null) return base;
        return { ...base, promotionId: d.promotionId, promotionKind: d.kind, candidateId: d.candidateId, candidateSummary: d.candidateSummary.slice(0, 500), manifestSha256: d.manifestSha256, targetCode: d.targetCode, targetClass: d.targetClass, targetRef: d.externalRef, promotionReview: d.review };
      }
      // C7-B: an R3 Company → App control is decided on its exact, reviewed act — what control, which scope, what
      // restriction changes (from → to), why, the evidence cited and the risk; re-checked decidable now (never stale).
      const c = txControlDecisionView(ctx, approvalId, decision);
      return { ...base, proposalId: c.proposalId, controlFamily: c.family, controlScope: c.scope, controlOperation: c.operation, controlValue: c.value, controlFrom: c.from, controlReason: c.reasonCode, controlEvidenceRefs: [...c.evidenceRefs], controlReview: c.review };
    }
    case 'GOAL_APPROVE': {
      const g = getGoal(ctx, assertId(raw.goalId, 'goalId'));
      if (g.kind !== 'COMPANY' || (g.state !== 'PROPOSED' && g.state !== 'DRAFT')) throw new QandeelError('GOAL_INVALID', 'only a proposed company goal is approved', { goalId: g.id, state: g.state });
      return { goalId: g.id, to: raw.activate === true ? 'ACTIVE' : 'APPROVED', reasonCode: assertCode(raw.reasonCode ?? 'goal.approved', 'reasonCode'), title: g.title.slice(0, 120) };
    }
    case 'GOAL_STATE': {
      const g = getGoal(ctx, assertId(raw.goalId, 'goalId'));
      const to = raw.to;
      if (!isGoalState(to)) throw new QandeelError('VALIDATION_FAILED', 'unknown goal state', { field: 'to' });
      // A preview never offers a step the lifecycle refuses (an ACTIVE goal is not "activated" again, R2-23).
      assertGoalTransition(g.state, to);
      return { goalId: g.id, to, reasonCode: assertCode(raw.reasonCode ?? 'goal.state', 'reasonCode'), title: g.title.slice(0, 120) };
    }
    case 'GOAL_PROPOSE': {
      const kind = raw.kind === 'DEPARTMENT' ? 'DEPARTMENT' : 'COMPANY';
      const departmentId = kind === 'DEPARTMENT' ? assertId(raw.departmentId, 'departmentId') : null;
      const parentGoalId = kind === 'DEPARTMENT' ? assertId(raw.parentGoalId, 'parentGoalId') : null;
      const horizonTo = raw.horizonTo === undefined || raw.horizonTo === null ? null : raw.horizonTo;
      if (horizonTo !== null && !isTimestamp(horizonTo)) throw new QandeelError('VALIDATION_FAILED', 'horizonTo must be a canonical UTC timestamp', { field: 'horizonTo' });
      // C7-C: success criteria travel with the proposal (a Pilot activates only on a root goal that states them); each is a
      // short line of Company content, secret-scanned again by the Goal store.
      const criteria = raw.successCriteria === undefined || raw.successCriteria === null ? [] : raw.successCriteria;
      if (!Array.isArray(criteria) || criteria.length > 12 || !criteria.every((c) => typeof c === 'string' && c.trim().length > 0 && c.length <= 400)) throw new QandeelError('VALIDATION_FAILED', 'successCriteria is a list of at most 12 short lines', { field: 'successCriteria' });
      return { kind, departmentId, parentGoalId, title: s('title', 160), summary: s('summary', 2000), ownerRef: s('ownerRef'), horizonTo: horizonTo as string | null, activate: raw.activate === true, successCriteria: criteria as string[] };
    }
    case 'STAFFING_DECIDE': {
      const r = getStaffingRequest(ctx, assertId(raw.requestId, 'requestId'));
      const decision = raw.decision;
      if (decision !== 'APPROVE' && decision !== 'REJECT') throw new QandeelError('VALIDATION_FAILED', 'decision is APPROVE or REJECT', { field: 'decision' });
      if (r.state !== 'RECOMMENDED' && r.state !== 'CONSOLIDATED') throw new QandeelError('INVALID_TRANSITION', 'the Founder decides a recommended request', { requestId: r.id, state: r.state });
      return { requestId: r.id, decision, reasonCode: assertCode(raw.reasonCode ?? 'founder.decided', 'reasonCode'), positionKind: r.positionKind };
    }
    case 'CONFLICT_RESOLVE': {
      const id = assertId(raw.conflictId, 'conflictId');
      const c = ctx.db.get<{ state: string }>('SELECT state FROM review_conflicts WHERE id = ?', id);
      if (!c) throw new QandeelError('NOT_FOUND', 'review conflict not found', { conflictId: id });
      if (c.state !== 'OPEN') throw new QandeelError('INVALID_TRANSITION', 'the conflict is already resolved', { conflictId: id });
      const resolution = raw.resolution;
      if (resolution !== 'PASS' && resolution !== 'REWORK') throw new QandeelError('VALIDATION_FAILED', 'resolution is PASS or REWORK', { field: 'resolution' });
      return { conflictId: id, resolution, reasonCode: assertCode(raw.reasonCode ?? 'founder.resolved', 'reasonCode') };
    }
    case 'BUDGET_CEILING': {
      const budgetId = assertId(raw.budgetId, 'budgetId');
      const b = getBudgetRow(ctx, budgetId);
      const capMoney = raw.capMoney;
      const capTokens = raw.capTokens ?? b.capTokens;
      if (typeof capMoney !== 'number' || !Number.isInteger(capMoney) || capMoney < 0 || capMoney > 1_000_000_000_000_000) throw new QandeelError('VALIDATION_FAILED', 'capMoney is an integer amount in micro-units', { field: 'capMoney' });
      if (typeof capTokens !== 'number' || !Number.isInteger(capTokens) || capTokens < 0) throw new QandeelError('VALIDATION_FAILED', 'capTokens is an integer', { field: 'capTokens' });
      const currency = raw.currency ?? b.currency;
      if (currency !== b.currency) throw new QandeelError('CURRENCY_MISMATCH', 'the ceiling must be stated in the budget\'s currency', { budgetId, currency: b.currency });
      return { budgetId, scope: b.scope, scopeId: b.scopeId, currency: b.currency, capMoney, capTokens, reasonCode: assertCode(raw.reasonCode ?? 'founder.ceiling', 'reasonCode') };
    }
    case 'DELEGATE_WORK': {
      // Founder-originated authority delegation (C4): a capability grant, bounded and reviewed; never work delegation by text.
      const employeeId = assertId(raw.employeeId, 'employeeId');
      const capability = s('capability', 96);
      const expiresAt = raw.expiresAt;
      if (!isTimestamp(expiresAt) || expiresAt <= ts(ctx)) throw new QandeelError('VALIDATION_FAILED', 'expiresAt must be a future canonical UTC timestamp', { field: 'expiresAt' });
      if (!ctx.db.get('SELECT 1 AS ok FROM employees WHERE id = ?', employeeId)) throw new QandeelError('NOT_FOUND', 'employee not found', { employeeId });
      return { employeeId, capability, expiresAt, purposeCode: assertCode(raw.purposeCode ?? 'founder.delegation', 'purposeCode'), reasonCode: assertCode(raw.reasonCode ?? 'founder.delegated', 'reasonCode') };
    }
    // --- R2-21: the Founder's exception decisions (structured only; each guarded by the state it decides) ---
    case 'TOOL_RECONCILE': {
      // The Founder checked external reality: the uncertain effect did or did not happen (Stage 12 §27).
      const invocationId = assertId(raw.invocationId, 'invocationId');
      const outcome = oneOf(raw, 'outcome', ['CONFIRMED_SUCCEEDED', 'CONFIRMED_NOT_EXECUTED'] as const);
      const t = heldRow<{ state: string; work_item_id: string }>(ctx, 'SELECT state, work_item_id FROM tool_invocations WHERE id = ?', invocationId, 'tool invocation', ['RECONCILIATION_REQUIRED']);
      return { invocationId, outcome, reasonCode: assertCode(raw.reasonCode ?? 'founder.reconciled', 'reasonCode'), workItemId: t.work_item_id };
    }
    case 'RESERVATION_RECONCILE': {
      // Charge what the provider reports, or release what was provably not billed (D-C2-07).
      const reservationId = assertId(raw.reservationId, 'reservationId');
      const decision = oneOf(raw, 'decision', ['RELEASE', 'CHARGE'] as const);
      const r = heldRow<{ state: string; work_item_id: string | null }>(ctx, 'SELECT state, work_item_id FROM budget_reservations WHERE id = ?', reservationId, 'reservation', ['RECONCILIATION_REQUIRED']);
      if (uncertainToolOn(ctx, 'reservation_id', reservationId)) throw new QandeelError('INVALID_TRANSITION', 'this reservation belongs to an uncertain tool invocation; decide the invocation instead', { reservationId });
      const charge = decision === 'CHARGE';
      return { reservationId, decision, inputTokens: charge ? tokens(raw, 'inputTokens') : null, outputTokens: charge ? tokens(raw, 'outputTokens') : null, reasonCode: assertCode(raw.reasonCode ?? 'founder.reconciled', 'reasonCode'), workItemId: r.work_item_id };
    }
    case 'JOB_RECONCILE': {
      // Governed work held after an uncertain effect (R1-04): its tool decision comes first.
      const jobId = assertId(raw.jobId, 'jobId');
      const decision = oneOf(raw, 'decision', ['RETRY', 'CONFIRMED_COMPLETED', 'FAILED'] as const);
      const j = heldRow<{ state: string; work_item_id: string }>(ctx, 'SELECT state, work_item_id FROM queue_jobs WHERE id = ?', jobId, 'job', ['RECONCILIATION_HOLD']);
      if (!isGovernedJob(ctx, jobId)) throw new QandeelError('VALIDATION_FAILED', 'plain C1 work keeps the operator decision; the Founder decides governed work', { jobId, reason: 'NOT_GOVERNED_WORK' });
      if (uncertainToolOn(ctx, 'work_item_id', j.work_item_id)) throw new QandeelError('INVALID_TRANSITION', 'decide the uncertain tool invocation first', { jobId });
      return { jobId, decision, reasonCode: assertCode(raw.reasonCode ?? 'founder.reconciled', 'reasonCode'), workItemId: j.work_item_id };
    }
    case 'REVIEW_ESCALATION_RESOLVE': {
      // An escalated required review (explicit reviewer uncertainty): PASS or REWORK. R4 is never made executable by review.
      const requestId = assertId(raw.requestId, 'requestId');
      const decision = oneOf(raw, 'decision', ['PASS', 'REWORK'] as const);
      const r = heldRow<{ state: string; kind: string; risk_level: string; work_item_id: string }>(ctx, 'SELECT state, kind, risk_level, work_item_id FROM review_requests WHERE id = ?', requestId, 'review request', ['ESCALATED']);
      if (r.kind !== 'REQUIRED') throw new QandeelError('INVALID_TRANSITION', 'only an escalated required review is resolved here', { requestId });
      if (decision === 'PASS' && r.risk_level === 'R4') throw new QandeelError('FOUNDER_ONLY', 'R4 work is never made executable by review', { requestId, risk: 'R4' });
      return { requestId, decision, reasonCode: assertCode(raw.reasonCode ?? 'founder.resolved', 'reasonCode'), risk: r.risk_level, workItemId: r.work_item_id };
    }
    case 'SYSTEMIC_DECIDE': {
      const findingId = assertId(raw.findingId, 'findingId');
      const decision = oneOf(raw, 'decision', ['VALIDATE', 'REJECT', 'ADDRESSED'] as const);
      heldRow(ctx, 'SELECT state FROM systemic_findings WHERE id = ?', findingId, 'systemic finding', decision === 'ADDRESSED' ? ['VALIDATED'] : ['CANDIDATE']);
      return { findingId, decision, reasonCode: assertCode(raw.reasonCode ?? 'founder.decided', 'reasonCode') };
    }
    case 'ATTRIBUTION_DECIDE': {
      // The Founder validates the proposed causes as they stand, validates CORRECTED causes (RR3: an optional structured
      // `causes` list — codes only, API-only, no UI form, PG-04 — reaching the existing corrected-causes path), or rejects
      // the proposal (a decided "no accountable cause was established", `adverseStanding`). Causes accompany VALIDATE only.
      const attributionId = assertId(raw.attributionId, 'attributionId');
      const decision = oneOf(raw, 'decision', ['VALIDATE', 'REJECT'] as const);
      const a = heldRow<{ state: string; work_item_id: string }>(ctx, 'SELECT state, work_item_id FROM causal_attributions WHERE id = ?', attributionId, 'attribution', ['PROPOSED']);
      const base = { attributionId, decision, reasonCode: assertCode(raw.reasonCode ?? 'founder.decided', 'reasonCode'), workItemId: a.work_item_id };
      if (raw.causes === undefined) return base;
      if (decision !== 'VALIDATE') throw new QandeelError('VALIDATION_FAILED', 'corrected causes accompany a VALIDATE decision only', { field: 'causes' });
      const causes = assertCauses(raw.causes);
      summarizeCauses(causes); // exactly one PRIMARY cause, each category once (the same rule the store applies)
      return { ...base, causes: causes.map(encodeCause) };
    }
    case 'LESSON_DECIDE': {
      const lessonId = assertId(raw.lessonId, 'lessonId');
      const decision = oneOf(raw, 'decision', ['VALIDATE', 'REJECT'] as const);
      heldRow(ctx, 'SELECT stage AS state FROM lessons WHERE id = ?', lessonId, 'lesson', ['LESSON_CANDIDATE', 'UNDER_REVIEW']);
      return { lessonId, decision, reasonCode: assertCode(raw.reasonCode ?? 'founder.decided', 'reasonCode') };
    }
    case 'OUTCOME_VERIFY': {
      // Values the Founder states (evidence classes and records) arrive through the structured API only (PG-04).
      const workItemId = assertId(raw.workItemId, 'workItemId');
      const verdict = oneOf(raw, 'verdict', ['ACHIEVED', 'NOT_ACHIEVED', 'INCONCLUSIVE'] as const);
      heldRow(ctx, 'SELECT state FROM work_items WHERE id = ?', workItemId, 'work item', ['REVIEWED']);
      const list = (field: string, max: number, shape: RegExp): string[] => {
        const v = raw[field];
        if (!Array.isArray(v) || v.length === 0 || v.length > max || !v.every((x) => typeof x === 'string' && shape.test(x))) throw new QandeelError('EVIDENCE_REQUIRED', 'an outcome verification names its evidence', { field });
        return [...new Set(v as string[])];
      };
      const evidenceClasses = assertOutcomeClasses(list('evidenceClasses', 8, /^[A-Z_]{2,48}$/));
      const evidenceRefs = list('evidenceRefs', 16, OUTCOME_REF);
      // C7-A: a preview never offers a verification on external evidence that is not usable for this Work Item.
      txAssertExternalEvidence(ctx, workItemId, evidenceClasses, evidenceRefs);
      return { workItemId, verdict, evidenceClasses, evidenceRefs, reasonCode: assertCode(raw.reasonCode ?? 'founder.verified', 'reasonCode') };
    }
    case 'PROMOTION_DECIDE': {
      const promotionId = assertId(raw.promotionId, 'promotionId');
      const decision = oneOf(raw, 'decision', ['APPROVE', 'REJECT'] as const);
      const pr = heldRow<{ state: string; target: string }>(ctx, 'SELECT state, target FROM lesson_promotions WHERE id = ?', promotionId, 'promotion', ['PENDING_REVIEW']);
      return { promotionId, decision, target: pr.target, reasonCode: assertCode(raw.reasonCode ?? 'founder.decided', 'reasonCode') };
    }
    // --- C7-A: what the Company may treat as real-world evidence (structured only; the store re-checks everything) ---
    case 'SOURCE_REGISTER': {
      const { sourceKey, family, contract } = assertSourceRegistration({ sourceKey: raw.sourceKey, family: raw.family, contractCode: raw.contractCode, contractVersion: raw.contractVersion });
      return { sourceKey, family, contractCode: contract.code, contractVersion: contract.version, lane: contract.lane, reasonCode: assertCode(raw.reasonCode ?? 'source.registered', 'reasonCode') };
    }
    case 'SOURCE_DECIDE': {
      const sourceId = assertId(raw.sourceId, 'sourceId');
      const decision = oneOf(raw, 'decision', SOURCE_DECISIONS);
      const src = ctx.db.get<{ state: string; source_key: string }>('SELECT state, source_key FROM external_sources WHERE id = ?', sourceId);
      if (!src) throw new QandeelError('NOT_FOUND', 'external source not found', { sourceId });
      // A preview never offers a lifecycle step the source cannot take.
      const to = nextSourceState(src.state as SourceState, decision as SourceDecision);
      return { sourceId, decision, from: src.state, to, sourceKey: src.source_key, reasonCode: assertCode(raw.reasonCode ?? 'founder.decided', 'reasonCode') };
    }
    case 'EVIDENCE_BIND': {
      const recordId = assertId(raw.recordId, 'recordId');
      const subjectKind = oneOf(raw, 'subjectKind', BINDING_SUBJECTS);
      const role = oneOf(raw, 'role', BINDING_ROLES);
      const subjectId = assertId(raw.subjectId, 'subjectId');
      // A preview never offers a binding the confirmation would refuse (role, source state, conflict, subject).
      txAssertBindable(ctx, recordId, role, subjectKind, subjectId);
      const supersedes = raw.supersedesBindingId === undefined || raw.supersedesBindingId === null ? null : assertId(raw.supersedesBindingId, 'supersedesBindingId');
      return { recordId, subjectKind, subjectId, role, supersedesBindingId: supersedes, reasonCode: assertCode(raw.reasonCode ?? 'founder.bound', 'reasonCode') };
    }
    case 'EVIDENCE_UNBIND': {
      const bindingId = assertId(raw.bindingId, 'bindingId');
      heldRow(ctx, 'SELECT state FROM external_evidence_bindings WHERE id = ?', bindingId, 'binding', ['ACTIVE']);
      return { bindingId, reasonCode: assertCode(raw.reasonCode ?? 'founder.unbound', 'reasonCode') };
    }
    case 'OUTCOME_CONTEST_RESOLVE': {
      const verificationId = assertId(raw.verificationId, 'verificationId');
      const decision = oneOf(raw, 'decision', CONTEST_DECISIONS);
      // A preview never offers a decision the confirmation would refuse: the verification is contested now, and a
      // replacement's evidence passes the same governed external-evidence rule.
      const v = txContestedVerification(ctx, verificationId);
      const base = { verificationId, decision, workItemId: v.workItemId, verdict: v.verdict, reasonCode: assertCode(raw.reasonCode ?? 'founder.decided', 'reasonCode') };
      if (decision !== 'REPLACE') {
        if (raw.evidenceClasses !== undefined || raw.evidenceRefs !== undefined) throw new QandeelError('VALIDATION_FAILED', 'evidence accompanies a REPLACE decision only', { field: 'evidenceRefs' });
        return base;
      }
      const list = (field: string, max: number, shape: RegExp): string[] => {
        const v = raw[field];
        if (!Array.isArray(v) || v.length === 0 || v.length > max || !v.every((x) => typeof x === 'string' && shape.test(x))) throw new QandeelError('EVIDENCE_REQUIRED', 'a replacement verification names its evidence', { field });
        return [...new Set(v as string[])];
      };
      const evidenceClasses = assertOutcomeClasses(list('evidenceClasses', 8, /^[A-Z_]{2,48}$/));
      const evidenceRefs = list('evidenceRefs', 16, OUTCOME_REF);
      txAssertExternalEvidence(ctx, v.workItemId, evidenceClasses, evidenceRefs);
      return { ...base, evidenceClasses, evidenceRefs };
    }
    // --- C7-C: the Pilot is created and moved only by an explicit Founder act (structured only; the store re-checks) ---
    case 'PILOT_CREATE': {
      const mode = oneOf(raw, 'mode', PILOT_MODES);
      const title = s('title', 160);
      // The preview payload is durable: a secret never enters it (the store refuses it again at confirm).
      if (containsSecretMaterial(title)) throw new QandeelError('VALIDATION_FAILED', 'pilot title carries secret material', { field: 'title', reason: 'SECRET_MATERIAL' });
      const requiresExternalOutcome = raw.requiresExternalOutcome === true;
      if (requiresExternalOutcome && mode !== 'CONTROLLED_REAL') throw new QandeelError('VALIDATION_FAILED', 'only a controlled real-world pilot may require external outcome evidence', { field: 'requiresExternalOutcome' });
      return { mode, title, requiresExternalOutcome, reasonCode: assertCode(raw.reasonCode ?? 'pilot.created', 'reasonCode') };
    }
    case 'PILOT_ADVANCE': {
      // A preview never offers a step the confirmation would refuse (lifecycle, briefing evidence, root goal, bindings).
      const plan = planPilotStep(ctx, assertId(raw.pilotId, 'pilotId'), { to: raw.to as PilotState, reasonCode: String(raw.reasonCode ?? 'pilot.advanced'), ...(raw.threadId === undefined || raw.threadId === null ? {} : { threadId: String(raw.threadId) }), ...(raw.goalId === undefined || raw.goalId === null ? {} : { goalId: String(raw.goalId) }) });
      if (plan.noop) throw new QandeelError('INVALID_TRANSITION', 'the pilot already took this step', { pilotId: plan.pilot.id, state: plan.pilot.state });
      const briefing = txBriefingStatus(ctx, plan.pilot);
      return { pilotId: plan.pilot.id, from: plan.pilot.state, to: plan.to, mode: plan.pilot.mode, threadId: plan.threadId, goalId: plan.goalId, answeredBriefingRequests: briefing.answered.length, unansweredBriefingRequests: briefing.pending.length, reasonCode: plan.reasonCode };
    }
    // --- L1-01: one release-pinned provider profile, provisioned through the canonical catalog APIs (D-L1-06) -------
    case 'PROVIDER_PROVISION': {
      const profileCode = assertCode(raw.profileCode, 'profileCode');
      const profile = profiles.find((p) => p.code === profileCode);
      if (!profile) throw new QandeelError('VALIDATION_FAILED', 'unknown provisioning profile (profiles are release-pinned and registered by the host, never typed)', { field: 'profileCode' });
      const digest = provisioningProfileDigest(profile);
      if (raw.profileSha256 !== undefined && raw.profileSha256 !== digest) throw new QandeelError('VALIDATION_FAILED', 'the profile digest does not match the registered profile', { field: 'profileSha256' });
      if (ctx.db.get('SELECT 1 AS x FROM model_providers WHERE code = ?', profile.provider.code)) throw new QandeelError('INVALID_TRANSITION', 'this provider is already provisioned', { providerCode: profile.provider.code });
      // Alias drift fails closed (D-L1-05): the preview exists only on a fresh MATCH identity check of the model alias.
      const latest = ctx.db.get('SELECT * FROM model_identity_checks WHERE provider_code = ? AND model_code = ? ORDER BY checked_at DESC, id DESC LIMIT 1', profile.provider.code, profile.model.code);
      const check = latest ? mapIdentityCheck(latest) : null;
      if (!check || check.result !== 'MATCH' || check.expectedName !== profile.model.expectedPublicName || Date.parse(ts(ctx)) - Date.parse(check.checkedAt) > IDENTITY_CHECK_MAX_AGE_MS) {
        throw new QandeelError('VALIDATION_FAILED', 'provisioning needs a fresh MATCH identity check of the model alias (run the provider check first)', { field: 'identityCheck', reason: 'IDENTITY_CHECK_REQUIRED' });
      }
      const capMoney = assertMoney(raw.capMoney, 'capMoney');
      const capTokens = assertTokens(raw.capTokens, 'capTokens');
      if (capMoney === 0 || capTokens === 0) throw new QandeelError('VALIDATION_FAILED', 'the first Company cap is a bounded positive amount (never zero, never unlimited)', { field: 'capMoney' });
      const company = budgetFor(ctx, 'COMPANY', 'company');
      if (company && company.currency !== profile.priceCard.currency) throw new QandeelError('CURRENCY_MISMATCH', 'the profile is priced in another currency than the Company budget', { currency: profile.priceCard.currency });
      const card = profile.priceCard;
      return {
        profileCode,
        profileSha256: digest,
        providerCode: profile.provider.code,
        modelCode: profile.model.code,
        expectedPublicName: profile.model.expectedPublicName,
        observedPublicName: check.observedName ?? '',
        identityCheckId: check.id,
        identityCheckedAt: check.checkedAt,
        deploymentCodes: profile.deployments.map((d) => `${d.code} (${d.reasoningClass}, ctx ${d.contextWindowTokens}, out ${d.maxOutputTokens})`),
        egressMaxDataClass: profile.egressMaxDataClass,
        qualificationTarget: profile.qualificationTarget,
        currency: card.currency,
        peakInputPerMTok: card.billedInputPerMTok,
        peakCachedInputPerMTok: cachedInputRate(card),
        peakOutputPerMTok: card.billedOutputPerMTok,
        offPeakInputPerMTok: card.schedule?.offPeakInputPerMTok ?? card.billedInputPerMTok,
        offPeakOutputPerMTok: card.schedule?.offPeakOutputPerMTok ?? card.billedOutputPerMTok,
        pricingBasisSource: card.schedule?.basisSource ?? '',
        pricingBasisDate: card.schedule?.basisDate ?? '',
        capMoney,
        capTokens,
        companyBudgetExists: company !== null,
        existingCapMoney: company ? company.capMoney : 0,
        reasonCode: assertCode(raw.reasonCode ?? 'provider.provisioned', 'reasonCode'),
      };
    }
    default:
      throw new QandeelError('VALIDATION_FAILED', 'unknown intent', { field: 'intent' });
  }
}

function getPreview(ctx: StoreContext, id: Id): ActionPreviewRecord {
  const r = ctx.db.get('SELECT * FROM founder_action_previews WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'action preview not found', { previewId: id });
  return mapActionPreview(r);
}

/** A confirmation presents a live preview of its own session with the exact fingerprint (typed refusal otherwise). */
function checkPreview(ctx: StoreContext, session: FounderSession, previewId: string, fingerprint: unknown): ActionPreviewRecord {
  const preview = getPreview(ctx, assertId(previewId, 'previewId'));
  const refuse = (code: string): never => {
    // The refusal is audited in its own transaction (this one rolls back with the throw).
    throw new QandeelError('FOUNDER_CONFIRMATION_REQUIRED', 'the action was not confirmed', { reason: code, previewId: preview.id });
  };
  if (preview.sessionId !== session.id) refuse('SESSION_MISMATCH');
  if (preview.state !== 'PREVIEW') refuse(`ALREADY_${preview.state}`);
  if (typeof fingerprint !== 'string' || fingerprint !== preview.fingerprint) refuse('FINGERPRINT_MISMATCH');
  return preview;
}

export interface ConfirmResult {
  readonly preview: ActionPreviewRecord;
  readonly resultRef: string;
}

export class FounderActionStore {
  readonly #store: CompanyStore;
  readonly #auth: FounderAuthStore;
  readonly #profiles: readonly ProviderProvisioningProfile[];
  readonly #activation: ActivationEnv;

  private constructor(store: CompanyStore, auth: FounderAuthStore, options: FounderActionOptions) {
    this.#store = store;
    this.#auth = auth;
    this.#profiles = options.profiles ?? [];
    this.#activation = { packages: options.academyPackages ?? [], identities: options.identityProfiles ?? [] };
  }

  /** L1-02: the exact digest of one registered Academy package (what a form posts back; never typed by the Founder). */
  packageDigest(code: string, version: number): string | null {
    const p = this.#activation.packages.find((x) => x.code === code && x.version === version);
    return p ? academyPackageDigest(p) : null;
  }

  /** L1-02: the registered Academy packages and identity profiles (read by the activation view; never typed). */
  activationEnv(): ActivationEnv {
    return this.#activation;
  }

  static for(store: CompanyStore, auth: FounderAuthStore, options: FounderActionOptions = {}): FounderActionStore {
    return new FounderActionStore(store, auth, options);
  }

  /** The release-pinned provisioning profiles this store may offer (codes, digests, display facts; never a credential). */
  provisioningProfiles(): readonly { code: string; sha256: string; providerCode: string; modelCode: string; expectedPublicName: string; currency: string; deployments: number; taskClasses: readonly string[] }[] {
    return this.#profiles.map((p) => ({ code: p.code, sha256: provisioningProfileDigest(p), providerCode: p.provider.code, modelCode: p.model.code, expectedPublicName: p.model.expectedPublicName, currency: p.priceCard.currency, deployments: p.deployments.length, taskClasses: p.routePolicies.map((r) => r.taskClass) }));
  }

  /** One write transaction; an optional `onRefusal` runs (in its own transaction) after a typed refusal rolled back. */
  #write<T>(operation: string, fn: (ctx: StoreContext) => T, onRefusal?: (code: string) => void): T {
    const ctx = storeContext(this.#store);
    try {
      return ctx.db.immediate(operation, () => fn(ctx));
    } catch (error) {
      if (onRefusal && error instanceof QandeelError && error.code === 'FOUNDER_CONFIRMATION_REQUIRED') {
        try {
          onRefusal(String(error.details.reason ?? 'REFUSED'));
        } catch {
          // Auditing a refusal never masks the refusal itself.
        }
      }
      throw error;
    }
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  /** Creates a preview for a verified session. Validation reads durable state; nothing is mutated. */
  preview(session: FounderSession, intent: unknown, payload: unknown): ActionPreviewRecord {
    return this.#write('founder action preview', (ctx) => {
      if (!isMutatingIntent(intent)) throw new QandeelError('VALIDATION_FAILED', 'unknown mutating intent', { field: 'intent' });
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new QandeelError('VALIDATION_FAILED', 'payload must be an object', { field: 'payload' });
      const canonical = validatePayload(ctx, intent, payload as Record<string, unknown>, this.#profiles, this.#activation);
      const id = newId();
      const at = ts(ctx);
      const fingerprint = sha256Hex(canonicalJson({ v: 1, intent, payload: canonical, session: session.id }));
      ctx.db.run(
        `INSERT INTO founder_action_previews (id, session_id, intent_kind, payload_json, fingerprint, state, result_ref, result_code, created_at, expires_at, decided_at) VALUES (?, ?, ?, ?, ?, 'PREVIEW', NULL, NULL, ?, ?, NULL)`,
        id, session.id, intent, boundedJson(canonical, 'payload', 4096), fingerprint, at, later(at, PREVIEW_TTL_MS),
      );
      appendAudit(ctx, 'founder.action_previewed', 'founder_action', id, { actorRef: session.founderRef }, 'OK', intent, { sessionId: session.id });
      return getPreview(ctx, id);
    });
  }

  /**
   * Confirms exactly one preview: same session, same fingerprint, not expired. The real boundary is called
   * inside the Founder session scope and inside ONE write transaction with the preview check, CONFIRMED and
   * the audit (R2-26): an interrupted confirm leaves neither the effect nor a decided preview, so a retry can
   * never repeat an act, and FAILED always means "not executed". A typed refusal records nothing; any other
   * failure rolls the whole confirm back and records FAILED in its own transaction.
   */
  confirm(session: FounderSession, previewId: string, fingerprint: unknown): ConfirmResult {
    // A stale preview is expired durably first (its own transaction), then refused.
    this.#write('expire stale preview', (ctx) => {
      const id = assertId(previewId, 'previewId');
      const now = ts(ctx);
      ctx.db.run(`UPDATE founder_action_previews SET state = 'EXPIRED', decided_at = ?, result_code = 'EXPIRED' WHERE id = ? AND state = 'PREVIEW' AND expires_at <= ?`, now, id, now);
    });
    const refused = (code: string): void => this.#write('audit refused confirmation', (ctx) => appendAudit(ctx, 'founder.action_refused', 'founder_action', String(previewId).slice(0, 36), { actorRef: session.founderRef }, 'REJECTED', code, { sessionId: session.id }));
    const p = this.#write('founder action check', (ctx) => checkPreview(ctx, session, previewId, fingerprint), refused);
    try {
      return this.#auth.withSession(session, (founderRef) =>
        this.#write('founder action confirm', (ctx) => {
          // Re-checked inside the one transaction: a concurrent confirm of the same preview cannot also execute.
          const live = checkPreview(ctx, session, p.id, fingerprint);
          const resultRef = founderConfirmInternals.join(ctx, () => this.#execute(ctx, founderRef, live));
          ctx.db.run(`UPDATE founder_action_previews SET state = 'CONFIRMED', decided_at = ?, result_ref = ?, result_code = 'DONE' WHERE id = ? AND state = 'PREVIEW'`, ts(ctx), resultRef, live.id);
          appendAudit(ctx, 'founder.action_confirmed', 'founder_action', live.id, { actorRef: session.founderRef }, 'OK', live.intentKind, { resultRef: resultRef.slice(0, 128) });
          return { preview: getPreview(ctx, live.id), resultRef };
        }, refused),
      );
    } catch (error) {
      // A refused confirmation decided nothing and is already audited: the preview stays as it was.
      if (error instanceof QandeelError && error.code === 'FOUNDER_CONFIRMATION_REQUIRED') throw error;
      const code = error instanceof QandeelError ? error.code : 'UNCLASSIFIED_ERROR';
      try {
        this.#write('founder action failed', (ctx) => {
          ctx.db.run(`UPDATE founder_action_previews SET state = 'FAILED', decided_at = ?, result_code = ? WHERE id = ? AND state = 'PREVIEW'`, ts(ctx), code.slice(0, 64), p.id);
          appendAudit(ctx, 'founder.action_failed', 'founder_action', p.id, { actorRef: session.founderRef }, 'ERROR', code.slice(0, 64), { intent: p.intentKind });
        });
      } catch {
        // Recording the failure never masks it (the preview then simply expires).
      }
      throw error;
    }
  }

  /**
   * Executes a confirmed preview at its real boundary, inside the session scope and the confirm's own
   * transaction (every boundary here is a synchronous Founder-authority write that joins it).
   */
  #execute(ctx: StoreContext, founderRef: string, p: ActionPreviewRecord): string {
    const pl = p.payload;
    if (isActivationIntent(p.intentKind)) return executeActivation(this.#store, ctx, founderRef, p.intentKind, pl as Record<string, unknown>, this.#activation);
    const str = (k: string): string => String(pl[k]);
    const strings = (k: string): string[] => (Array.isArray(pl[k]) ? (pl[k] as readonly string[]).map(String) : []);
    switch (p.intentKind) {
      case 'APPROVAL_DECIDE': {
        const a = GovernanceStore.for(this.#store).decideApproval(founderRef, str('approvalId'), { decision: pl.decision as 'APPROVE' | 'REJECT', reasonCode: str('reasonCode') });
        return `approval:${a.id}`;
      }
      case 'GOAL_APPROVE': {
        const goals = GoalStore.for(this.#store);
        const g = getGoal(ctx, str('goalId') as Id);
        let cur = g;
        if (cur.state === 'DRAFT') cur = goals.transition(founderRef, cur.id, { to: 'PROPOSED', reasonCode: str('reasonCode') });
        cur = goals.transition(founderRef, cur.id, { to: 'APPROVED', reasonCode: str('reasonCode') });
        if (pl.to === 'ACTIVE') cur = goals.transition(founderRef, cur.id, { to: 'ACTIVE', reasonCode: str('reasonCode') });
        return `goal:${cur.id}`;
      }
      case 'GOAL_STATE': {
        const g = GoalStore.for(this.#store).transition(founderRef, str('goalId'), { to: pl.to as GoalState, reasonCode: str('reasonCode') });
        return `goal:${g.id}`;
      }
      case 'GOAL_PROPOSE': {
        const goals = GoalStore.for(this.#store);
        let g = goals.propose(founderRef, { kind: pl.kind as 'COMPANY' | 'DEPARTMENT', departmentId: pl.departmentId as string | null, parentGoalId: pl.parentGoalId as string | null, title: str('title'), summary: str('summary'), ownerRef: str('ownerRef'), horizonTo: pl.horizonTo as string | null, successCriteria: strings('successCriteria') });
        if (pl.activate === true) {
          g = goals.transition(founderRef, g.id, { to: 'APPROVED', reasonCode: 'goal.approved' });
          g = goals.transition(founderRef, g.id, { to: 'ACTIVE', reasonCode: 'goal.activated' });
        }
        return `goal:${g.id}`;
      }
      case 'STAFFING_DECIDE': {
        const r = OrganizationStore.for(this.#store).decideStaffingRequest(founderRef, str('requestId'), { decision: pl.decision as 'APPROVE' | 'REJECT', reasonCode: str('reasonCode') });
        return `staffing_request:${r.id}`;
      }
      case 'CONFLICT_RESOLVE': {
        const c = ReviewStore.for(this.#store).resolveConflict(founderRef, str('conflictId'), pl.resolution as 'PASS' | 'REWORK', str('reasonCode'));
        return `review_conflict:${c.id}`;
      }
      case 'BUDGET_CEILING': {
        const b = GovernanceStore.for(this.#store).changeBudgetCap(founderRef, str('budgetId'), { capMoney: Number(pl.capMoney), capTokens: Number(pl.capTokens), reasonCode: str('reasonCode') });
        return `budget:${b.id}`;
      }
      case 'DELEGATE_WORK': {
        const d = OrganizationStore.for(this.#store).delegateAuthority(founderRef, { employeeId: str('employeeId'), capability: str('capability'), expiresAt: str('expiresAt'), purposeCode: str('purposeCode'), reasonCode: str('reasonCode') });
        return `authority_delegation:${d.id}`;
      }
      // --- R2-21: each exception decision at its EXISTING boundary (no second implementation) ---
      case 'TOOL_RECONCILE': {
        const t = GovernanceStore.for(this.#store).resolveToolInvocation(founderRef, str('invocationId'), pl.outcome as 'CONFIRMED_SUCCEEDED' | 'CONFIRMED_NOT_EXECUTED', str('reasonCode'));
        return `tool_invocation:${t.id}`;
      }
      case 'RESERVATION_RECONCILE': {
        const decision = pl.decision === 'CHARGE' ? { kind: 'CHARGE' as const, inputTokens: Number(pl.inputTokens), outputTokens: Number(pl.outputTokens) } : { kind: 'RELEASE' as const };
        const r = GovernanceStore.for(this.#store).reconcileReservation(founderRef, str('reservationId'), decision, str('reasonCode'));
        return `budget_reservation:${r.id}`;
      }
      case 'JOB_RECONCILE': {
        // The governed path of the C1 decision (R1-04): Founder authority, after the tool decision.
        const jobId = str('jobId') as Id;
        resolveGovernedReconciliation(this.#store, jobId, founderRef, (c, trace) => txResolveReconciliation(c, jobId, pl.decision as 'RETRY' | 'CONFIRMED_COMPLETED' | 'FAILED', str('reasonCode'), trace));
        return `queue_job:${jobId}`;
      }
      case 'REVIEW_ESCALATION_RESOLVE': {
        const r = ReviewStore.for(this.#store).resolveEscalation(founderRef, str('requestId'), pl.decision as 'PASS' | 'REWORK', str('reasonCode'));
        return `review_request:${r.id}`;
      }
      case 'SYSTEMIC_DECIDE': {
        const f = ImprovementStore.for(this.#store).decideSystemicFinding(founderRef, str('findingId'), { decision: pl.decision as 'VALIDATE' | 'REJECT' | 'ADDRESSED', reasonCode: str('reasonCode') });
        return `systemic_finding:${f.id}`;
      }
      case 'ATTRIBUTION_DECIDE': {
        // RR3: corrected causes (validated at preview) reach the existing `decideAttribution` corrected-causes path.
        const causes = Array.isArray(pl.causes) ? strings('causes').map(decodeCause) : undefined;
        const out = ImprovementStore.for(this.#store).decideAttribution(founderRef, str('attributionId'), { decision: pl.decision as 'VALIDATE' | 'REJECT', reasonCode: str('reasonCode'), ...(causes === undefined ? {} : { causes }) });
        return `causal_attribution:${out.attribution.id}`;
      }
      case 'LESSON_DECIDE': {
        const l = MemoryStore.for(this.#store).validateLesson(founderRef, str('lessonId'), { decision: pl.decision as 'VALIDATE' | 'REJECT', reasonCode: str('reasonCode') });
        return `lesson:${l.id}`;
      }
      case 'OUTCOME_VERIFY': {
        const v = ImprovementStore.for(this.#store).verifyOutcome(founderRef, str('workItemId'), { verdict: pl.verdict as 'ACHIEVED' | 'NOT_ACHIEVED' | 'INCONCLUSIVE', evidenceClasses: strings('evidenceClasses'), evidenceRefs: strings('evidenceRefs'), reasonCode: str('reasonCode') });
        return `outcome_verification:${v.verificationId}`;
      }
      case 'PROMOTION_DECIDE': {
        const pr = MemoryStore.for(this.#store).decidePromotion(founderRef, str('promotionId'), { decision: pl.decision as 'APPROVE' | 'REJECT', reasonCode: str('reasonCode') });
        return `lesson_promotion:${pr.id}`;
      }
      // --- C7-A: each at the ExternalEvidenceStore boundary (no second implementation) ---
      case 'SOURCE_REGISTER': {
        const out = ExternalEvidenceStore.for(this.#store).registerSource(founderRef, { sourceKey: str('sourceKey'), family: str('family'), contractCode: str('contractCode'), contractVersion: Number(pl.contractVersion), reasonCode: str('reasonCode') });
        return `external_source:${out.source.id}`;
      }
      case 'SOURCE_DECIDE': {
        const src = ExternalEvidenceStore.for(this.#store).decideSource(founderRef, str('sourceId'), { decision: pl.decision as SourceDecision, reasonCode: str('reasonCode') });
        return `external_source:${src.id}`;
      }
      case 'EVIDENCE_BIND': {
        const out = ExternalEvidenceStore.for(this.#store).bindEvidence(founderRef, { recordId: str('recordId'), subjectKind: str('subjectKind'), subjectId: str('subjectId'), role: str('role'), reasonCode: str('reasonCode'), ...(pl.supersedesBindingId ? { supersedesBindingId: str('supersedesBindingId') } : {}) });
        return `external_binding:${out.binding.id}`;
      }
      case 'EVIDENCE_UNBIND': {
        const b = ExternalEvidenceStore.for(this.#store).unbindEvidence(founderRef, str('bindingId'), str('reasonCode'));
        return `external_binding:${b.id}`;
      }
      case 'OUTCOME_CONTEST_RESOLVE': {
        // At the C6 boundary that owns verifications (no second implementation).
        const replace = pl.decision === 'REPLACE';
        const out = ImprovementStore.for(this.#store).resolveOutcomeContest(founderRef, str('verificationId'), { decision: pl.decision as ContestDecision, reasonCode: str('reasonCode'), ...(replace ? { evidenceClasses: strings('evidenceClasses'), evidenceRefs: strings('evidenceRefs') } : {}) });
        return `outcome_verification:${out.verificationId}`;
      }
      // --- C7-C: at the PilotStore boundary (Founder only; the datastore re-checks every rule) ---
      case 'PILOT_CREATE': {
        const pilot = PilotStore.for(this.#store).create(founderRef, { mode: pl.mode as PilotMode, title: str('title'), requiresExternalOutcome: pl.requiresExternalOutcome === true }, { reasonCode: str('reasonCode') });
        return `pilot:${pilot.id}`;
      }
      case 'PILOT_ADVANCE': {
        const pilot = PilotStore.for(this.#store).advance(founderRef, str('pilotId'), { to: pl.to as PilotState, reasonCode: str('reasonCode'), ...(pl.threadId ? { threadId: str('threadId') } : {}), ...(pl.goalId ? { goalId: str('goalId') } : {}) });
        return `pilot:${pilot.id}`;
      }
      // --- L1-01: the whole profile through the canonical catalog APIs, inside this one confirm (D-L1-06) ---
      case 'PROVIDER_PROVISION': {
        const profile = this.#profiles.find((x) => x.code === str('profileCode'));
        if (!profile || provisioningProfileDigest(profile) !== str('profileSha256')) throw new QandeelError('VALIDATION_FAILED', 'the registered profile changed since the preview', { field: 'profileSha256' });
        const out = GovernanceStore.for(this.#store).provisionProviderProfile(founderRef, profile, { capMoney: Number(pl.capMoney), capTokens: Number(pl.capTokens), reasonCode: str('reasonCode') });
        return `provider:${out.providerId}`;
      }
      default:
        throw new QandeelError('VALIDATION_FAILED', 'unknown intent', { field: 'intent' });
    }
  }

  reject(session: FounderSession, previewId: string, reasonCode: string): ActionPreviewRecord {
    return this.#write('founder action rejected', (ctx) => {
      const p = getPreview(ctx, assertId(previewId, 'previewId'));
      if (p.sessionId !== session.id) throw new QandeelError('FOUNDER_CONFIRMATION_REQUIRED', 'the preview belongs to another session', { reason: 'SESSION_MISMATCH', previewId: p.id });
      if (p.state !== 'PREVIEW') return p;
      const reason = assertCode(reasonCode, 'reasonCode');
      ctx.db.run(`UPDATE founder_action_previews SET state = 'REJECTED', decided_at = ?, result_code = ? WHERE id = ?`, ts(ctx), reason, p.id);
      appendAudit(ctx, 'founder.action_rejected', 'founder_action', p.id, { actorRef: session.founderRef }, 'OK', reason, {});
      return getPreview(ctx, p.id);
    });
  }

  /** Marks every stale PREVIEW as EXPIRED (called on demand by the surface). */
  expireStale(): number {
    return this.#write('expire founder previews', (ctx) => {
      const now = ts(ctx);
      const stale = ctx.db.all<{ id: string }>(`SELECT id FROM founder_action_previews WHERE state = 'PREVIEW' AND expires_at <= ?`, now);
      for (const s of stale) ctx.db.run(`UPDATE founder_action_previews SET state = 'EXPIRED', decided_at = ?, result_code = 'EXPIRED' WHERE id = ?`, now, s.id);
      return stale.length;
    });
  }

  get(id: Id): ActionPreviewRecord {
    return this.#read((ctx) => getPreview(ctx, id));
  }

  list(filter: { sessionId?: Id; state?: ActionPreviewRecord['state'] } = {}): ActionPreviewRecord[] {
    return this.#read((ctx) =>
      ctx.db
        .all('SELECT * FROM founder_action_previews ORDER BY created_at, id')
        .map(mapActionPreview)
        .filter((p) => (filter.sessionId === undefined || p.sessionId === filter.sessionId) && (filter.state === undefined || p.state === filter.state)),
    );
  }

  /** The Employee's open envelope (the ceiling a BUDGET_CEILING intent addresses), if any. */
  employeeBudgetId(employeeId: Id): Id | null {
    return this.#read((ctx) => budgetFor(ctx, 'EMPLOYEE', employeeId)?.id ?? null);
  }
}
