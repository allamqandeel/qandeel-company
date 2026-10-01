/**
 * C7-B — the Company-side governed control plane toward the QANDEEL App (the frozen App operations contract §10–§16), over canonical state.
 *
 * One control subsystem inside the existing governance, never a parallel one:
 *   proposed (an Employee act, `control.propose`, through the fenced org-act boundary: the App Operations & Release Lead
 *   seat AND an explicit Founder-created R3 grant — Title ≠ Authority)
 *   → independently reviewed (the existing ACTION review of the Review Pool, bound to the exact act's fingerprint; the
 *   maker never reviews its own act)
 *   → Founder approved (the existing C2 approval engine: once the review is satisfied an R3 approval is PENDING; the
 *   Founder decides it through the existing governed confirmation, `APPROVAL_DECIDE`)
 *   → issued (in the transaction that consumes that approval and that review: the next immutable revision of the
 *   series, compare-and-swap on the revision the proposer saw).
 * There is no other path to an issued control, no emergency bypass and no Founder-originated shortcut (R3 needs the
 * independent review too). The datastore re-checks every gate (0013).
 *
 * What the Company records is what it ISSUED — desired state. Nothing here knows, or claims, what the App applied: the
 * App runtime owns authentication, applicability and effective state (later Production Integration). An issued control
 * is not an outcome either: nothing here touches evaluations, attributions or learning (C6 reads outcomes only from
 * real evidence). No transport, listener, queue, SDK, credential, key or signature exists here; a digest is a
 * fingerprint, not authentication. State, history, audit and outbox commit together; audit and events carry ids, codes
 * and fingerprints only (Rule A).
 */
import { QandeelError, canonicalJson, isQandeelError, newId, sha256Hex, type Id } from '@qandeel-company/domain';
import {
  APP_CONTROL_APPROVAL_ACTION,
  APP_CONTROL_RISK,
  APP_OPERATIONS_LEAD_SEAT,
  COMPANY_CONTROL_STATES,
  ISSUED_CONTROL_CONTRACT,
  assertRemoteConfigFamily,
  controlChangeProblem,
  controlProposalFingerprint,
  controlReviewSubject,
  controlRevisionDigest,
  controlValueCode,
  normalizeControlProposal,
  type ControlFamily,
  type ControlOperation,
  type ControlScope,
  type IssuedControlEnvelope,
  type RemoteConfigFamily,
} from '@qandeel-company/governance';

import { upsertApprovalRequest } from './governance.js';
import { mapApproval, type ApprovalRecord } from './governance-records.js';
import { attributed } from './governed-writes.js';
import { appendAudit, appendEvent, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { heldSeatsAt } from './org-core.js';
import type { ReviewRequestRecord } from './org-records.js';
import type { Fence } from './records.js';
import { actionReviewGate, consumeControlReview } from './review-core.js';
import type { Row } from './sqlite/connection.js';
import { storeContext, type CompanyStore } from './store.js';

/** The review subject / approval resource of a proposal (the review request's `subject_ref`). */
export const CONTROL_PROPOSAL_REF = 'app_control_proposal:';
const CONTROL_ACTOR = 'system:app-control';

export type ControlProposalState = 'PROPOSED' | 'AWAITING_FOUNDER' | 'ISSUED' | 'REJECTED' | 'REVIEW_REJECTED' | 'STALE';

export interface ControlProposalRecord {
  readonly id: Id;
  readonly ref: string;
  readonly workItemId: Id;
  readonly runId: Id;
  readonly proposerEmployeeId: Id;
  readonly proposerPositionId: Id;
  readonly family: ControlFamily;
  readonly scope: ControlScope;
  readonly operation: ControlOperation;
  readonly value: Record<string, unknown> | null;
  readonly reasonCode: string;
  readonly evidenceRefs: readonly string[];
  readonly expectedRevision: number;
  readonly fingerprint: string;
  readonly state: ControlProposalState;
  readonly reviewRequestId: Id | null;
  readonly approvalId: Id | null;
  readonly revisionId: Id | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ControlRevisionRecord {
  readonly id: Id;
  readonly seriesId: Id;
  readonly revision: number;
  readonly priorRevisionId: Id | null;
  readonly family: ControlFamily;
  readonly scope: ControlScope;
  readonly operation: ControlOperation;
  readonly value: Record<string, unknown> | null;
  readonly reasonCode: string;
  readonly proposalId: Id;
  readonly proposerRef: string;
  readonly reviewRequestId: Id;
  readonly approvalId: Id;
  readonly issuedByRef: string;
  readonly issuedAt: string;
  readonly digest: string;
  /** Always ISSUED: Company desired state. Never a statement about the App. */
  readonly companyState: 'ISSUED';
}

const s = (v: unknown): string => String(v);
const os = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const obj = (v: unknown): Record<string, unknown> | null => (v === null || v === undefined ? null : (JSON.parse(String(v)) as Record<string, unknown>));

const mapProposal = (r: Row): ControlProposalRecord => ({
  id: s(r.id) as Id,
  ref: `${CONTROL_PROPOSAL_REF}${s(r.id)}`,
  workItemId: s(r.work_item_id) as Id,
  runId: s(r.run_id) as Id,
  proposerEmployeeId: s(r.proposer_employee_id) as Id,
  proposerPositionId: s(r.proposer_position_id) as Id,
  family: s(r.family) as ControlFamily,
  scope: JSON.parse(s(r.scope_json)) as ControlScope,
  operation: s(r.operation) as ControlOperation,
  value: obj(r.value_json),
  reasonCode: s(r.reason_code),
  evidenceRefs: JSON.parse(s(r.evidence_refs_json)) as string[],
  expectedRevision: Number(r.expected_revision),
  fingerprint: s(r.fingerprint),
  state: s(r.state) as ControlProposalState,
  reviewRequestId: os(r.review_request_id) as Id | null,
  approvalId: os(r.approval_id) as Id | null,
  revisionId: os(r.revision_id) as Id | null,
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

const mapRevision = (r: Row): ControlRevisionRecord => ({
  id: s(r.id) as Id,
  seriesId: s(r.series_id) as Id,
  revision: Number(r.revision),
  priorRevisionId: os(r.prior_revision_id) as Id | null,
  family: s(r.family) as ControlFamily,
  scope: JSON.parse(s(r.scope_json)) as ControlScope,
  operation: s(r.operation) as ControlOperation,
  value: obj(r.value_json),
  reasonCode: s(r.reason_code),
  proposalId: s(r.proposal_id) as Id,
  proposerRef: s(r.proposer_ref),
  reviewRequestId: s(r.review_request_id) as Id,
  approvalId: s(r.approval_id) as Id,
  issuedByRef: s(r.issued_by_ref),
  issuedAt: s(r.issued_at),
  digest: s(r.digest),
  companyState: 'ISSUED',
});

/** The APPROVED Remote Configuration register, as the datastore holds it (empty in this release: fails closed). */
function register(ctx: StoreContext): RemoteConfigFamily[] {
  return ctx.db.all<Row>('SELECT * FROM app_remote_config_families ORDER BY code, version').map((r) =>
    assertRemoteConfigFamily({ code: s(r.code), version: Number(r.version), valueType: s(r.value_type), min: r.min_value === null ? null : Number(r.min_value), max: r.max_value === null ? null : Number(r.max_value), enumValues: obj(r.enum_json), scopeKinds: JSON.parse(s(r.scope_kinds_json)) }),
  );
}

/** The current Company-issued revision of one series (family + exact scope), if any. */
function currentRevision(ctx: StoreContext, family: string, scopeJson: string): ControlRevisionRecord | null {
  const r = ctx.db.get<Row>(
    `SELECT r.* FROM app_control_revisions r JOIN app_control_series x ON x.id = r.series_id WHERE x.family = ? AND x.scope_json = ? ORDER BY r.revision DESC LIMIT 1`,
    family, scopeJson,
  );
  return r ? mapRevision(r) : null;
}

const getProposal = (ctx: StoreContext, id: string): ControlProposalRecord | null => {
  const r = ctx.db.get<Row>('SELECT * FROM app_control_proposals WHERE id = ?', id);
  return r ? mapProposal(r) : null;
};

function moveProposal(ctx: StoreContext, p: ControlProposalRecord, to: ControlProposalState, reasonCode: string, actorRef: string, set: { approvalId?: Id; revisionId?: Id; reviewRequestId?: Id } = {}): void {
  const version = Number(ctx.db.get<{ v: number }>('SELECT version AS v FROM app_control_proposals WHERE id = ?', p.id)?.v);
  const changed = ctx.db.run(
    'UPDATE app_control_proposals SET state = ?, approval_id = COALESCE(?, approval_id), revision_id = COALESCE(?, revision_id), review_request_id = COALESCE(?, review_request_id), version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
    to, set.approvalId ?? null, set.revisionId ?? null, set.reviewRequestId ?? null, ts(ctx), p.id, version,
  ).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'the control proposal changed concurrently', { proposalId: p.id });
  ctx.db.run('INSERT INTO app_control_proposal_history (proposal_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', p.id, version + 1, p.state, to, reasonCode, actorRef, ts(ctx));
  appendAudit(ctx, 'app_control.proposal_changed', 'app_control_proposal', p.id, { actorRef }, 'OK', reasonCode, { from: p.state, to, family: p.family });
  appendEvent(ctx, 'app_control.proposal_changed', 'app_control', p.id, { correlationId: p.id, actorRef }, { from: p.state, to, family: p.family });
}

/** Approval scope of a proposal: the exact act (its fingerprint), R3, the proposer as the subject who gains authority. */
const approvalScope = (p: ControlProposalRecord): Parameters<typeof upsertApprovalRequest>[2] => ({
  subjectRef: `employee:${p.proposerEmployeeId}`,
  action: APP_CONTROL_APPROVAL_ACTION,
  resourceRef: p.ref,
  workItemId: p.workItemId,
  argsSha256: p.fingerprint,
  dataClass: 'D1',
  risk: APP_CONTROL_RISK,
  limits: { maxCostMicros: null },
});

/** The outcome of a `control.propose` act: a durable proposal, or a refusal code (the org-act boundary records it). */
export type ProposeOutcome = { readonly ref: string } | { readonly refused: string };

/**
 * `control.propose` (inside the org-act transaction, after the R3 grant decision): seat eligibility, the closed family /
 * scope / value contract, the revision the proposer saw, then the proposal and its independent review — under the Work
 * Item's Review Plan, or refused (no plan → no review → nothing to issue). The same act from the same Work Item is
 * idempotent; a rejected act never regenerates.
 */
export function txProposeControl(ctx: StoreContext, fence: Fence, e: { id: Id; ref: string }, args: unknown, grantId: Id | null): ProposeOutcome {
  const at = ts(ctx);
  const item = getWorkItemRow(ctx, attributed(ctx, fence).workItemId);
  // Title ≠ Authority, and authority ≠ seat: the grant was decided already; the operating seat (or acting coverage that
  // names this act) is required as well — a grant held outside the seat cannot impersonate the persistent role.
  const seat = heldSeatsAt(ctx, e.id, at).find((x) => x.position.code === APP_OPERATIONS_LEAD_SEAT && x.position.status === 'ACTIVE' && (x.assignment.kind !== 'ACTING' || x.assignment.actingScope.length === 0 || x.assignment.actingScope.includes('control.propose')));
  if (!seat) return { refused: 'CONTROL_SEAT_NOT_HELD' };
  if (grantId === null) return { refused: 'NO_GRANT' };
  let p;
  try {
    p = normalizeControlProposal(args, register(ctx));
  } catch (error) {
    if (isQandeelError(error, 'CONTROL_REFUSED')) return { refused: String(error.details.reason ?? 'CONTROL_REFUSED') };
    throw error;
  }
  const fingerprint = controlProposalFingerprint(p);
  const prior = ctx.db.get<Row>('SELECT * FROM app_control_proposals WHERE work_item_id = ? AND fingerprint = ?', item.id, fingerprint);
  if (prior) {
    // The exact act again: idempotent while it lives; a decided one is never silently regenerated.
    const x = mapProposal(prior);
    if (x.state === 'ISSUED') return { ref: `app_control_revision:${String(x.revisionId)}` };
    if (x.state === 'PROPOSED' || x.state === 'AWAITING_FOUNDER') return { ref: x.ref };
    return { refused: x.state === 'STALE' ? 'STALE_EXPECTED_REVISION' : x.state === 'REVIEW_REJECTED' ? 'REVIEW_REJECTED' : 'CONTROL_REJECTED' };
  }
  const current = currentRevision(ctx, p.family, p.scopeKey);
  if ((current?.revision ?? 0) !== p.expectedRevision) return { refused: 'STALE_EXPECTED_REVISION' };
  const change = controlChangeProblem(current, p);
  if (change !== null) return { refused: change };
  const id = newId();
  // Independent review of exactly this act (R3), shown whole to the reviewer, before anything else can happen.
  const gate = actionReviewGate(ctx, { item, fingerprint, subjectRef: `${CONTROL_PROPOSAL_REF}${id}`, dataClass: 'D1', risk: APP_CONTROL_RISK, actionSubject: controlReviewSubject(p, current) });
  if (gate.kind === 'REFUSED') return { refused: gate.code };
  if (gate.kind === 'REWORK') return { refused: 'REVIEW_REJECTED' };
  if (gate.kind === 'WAIT' && gate.requestId === null) return { refused: gate.code };
  ctx.db.run(
    `INSERT INTO app_control_proposals (id, work_item_id, run_id, proposer_employee_id, proposer_position_id, grant_id, family, scope_kind, scope_json, operation, value_json, reason_code, evidence_refs_json, expected_revision, fingerprint, state, review_request_id, approval_id, revision_id, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?, NULL, NULL, 1, ?, ?)`,
    id, item.id, fence.runId, e.id, seat.position.id, grantId, p.family, p.scope.kind, p.scopeKey, p.operation, p.value === null ? null : canonicalJson(p.value), p.reasonCode,
    JSON.stringify(p.evidenceRefs), p.expectedRevision, fingerprint, gate.requestId, at, at,
  );
  ctx.db.run('INSERT INTO app_control_proposal_history (proposal_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, ?, ?, ?, ?)', id, 'PROPOSED', 'app_control.proposed', e.ref, at);
  appendAudit(ctx, 'app_control.proposed', 'app_control_proposal', id, { actorRef: e.ref, correlationId: item.correlationId }, 'OK', null, { family: p.family, operation: p.operation, workItemId: item.id, reviewRequestId: gate.requestId });
  appendEvent(ctx, 'app_control.proposed', 'app_control', id as Id, { correlationId: id as Id, actorRef: e.ref }, { family: p.family, operation: p.operation, expectedRevision: p.expectedRevision });
  // A review of this very fingerprint already satisfied in this Work Item (a re-proposal after a STALE request) goes on.
  if (gate.kind === 'SATISFIED') txControlReviewSettled(ctx, getRequestFor(ctx, gate.requestId), 'SATISFIED', CONTROL_ACTOR);
  return { ref: `${CONTROL_PROPOSAL_REF}${id}` };
}

function getRequestFor(ctx: StoreContext, id: Id): Pick<ReviewRequestRecord, 'id' | 'subjectRef' | 'subjectFingerprint'> {
  const r = ctx.db.get<Row>('SELECT id, subject_ref, subject_fingerprint FROM review_requests WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'review request not found', { requestId: id });
  return { id: s(r.id) as Id, subjectRef: s(r.subject_ref), subjectFingerprint: s(r.subject_fingerprint) };
}

/**
 * The independent review of a control proposal settled (review-core `applyOutcome`, same transaction): REWORK ends the
 * proposal; SATISFIED puts exactly this act to the Founder as a PENDING R3 approval — unless another revision of the
 * series was issued meanwhile (then it is STALE: a new act needs a new review). Never issues anything.
 */
export function txControlReviewSettled(ctx: StoreContext, request: Pick<ReviewRequestRecord, 'id' | 'subjectRef' | 'subjectFingerprint'>, outcome: 'SATISFIED' | 'REWORK', actorRef: string): void {
  if (!request.subjectRef.startsWith(CONTROL_PROPOSAL_REF)) return;
  const p = getProposal(ctx, request.subjectRef.slice(CONTROL_PROPOSAL_REF.length));
  if (p === null || p.state !== 'PROPOSED' || p.fingerprint !== request.subjectFingerprint) return;
  if (outcome === 'REWORK') {
    moveProposal(ctx, p, 'REVIEW_REJECTED', 'review.rework', actorRef, { reviewRequestId: request.id });
    return;
  }
  if ((currentRevision(ctx, p.family, canonicalJson(p.scope))?.revision ?? 0) !== p.expectedRevision) {
    moveProposal(ctx, p, 'STALE', 'app_control.series_moved', actorRef, { reviewRequestId: request.id });
    return;
  }
  let approval: ApprovalRecord;
  try {
    approval = upsertApprovalRequest(ctx, `employee:${p.proposerEmployeeId}`, approvalScope(p), null);
  } catch (error) {
    // This exact act was already rejected by the Founder: it never regenerates as a fresh approval loop (Stage 3 §5).
    if (isQandeelError(error, 'APPROVAL_REJECTED')) {
      moveProposal(ctx, p, 'REJECTED', 'approval.already_rejected', actorRef, { reviewRequestId: request.id, approvalId: String(error.details.approvalId) as Id });
      return;
    }
    throw error;
  }
  moveProposal(ctx, p, 'AWAITING_FOUNDER', 'review.passed', actorRef, { approvalId: approval.id, reviewRequestId: request.id });
}

/** What the Founder is deciding — the decision-ready, codes-only description a governed preview shows (and re-checks). */
export interface ControlDecisionView {
  readonly proposalId: Id;
  readonly family: ControlFamily;
  readonly scope: string;
  readonly operation: ControlOperation;
  readonly value: string;
  readonly from: string;
  readonly reasonCode: string;
  readonly evidenceRefs: readonly string[];
  readonly risk: 'R3';
  /** The state of its independent review now (SATISFIED for an approvable act). */
  readonly review: string;
}

/** The proposal an R3 control approval decides, checked decidable NOW (the preview never offers what confirm refuses). */
export function txControlDecisionView(ctx: StoreContext, approvalId: Id, decision: 'APPROVE' | 'REJECT'): ControlDecisionView {
  const r = ctx.db.get<Row>('SELECT * FROM app_control_proposals WHERE approval_id = ?', approvalId);
  if (!r) throw new QandeelError('NOT_FOUND', 'no control proposal is decided by this approval', { approvalId });
  const p = mapProposal(r);
  // Approving issues, so it must be issuable now; rejecting ends an awaiting act whatever happened to its review since.
  if (decision === 'APPROVE') assertIssuable(ctx, p);
  else if (p.state !== 'AWAITING_FOUNDER') throw new QandeelError('INVALID_TRANSITION', 'this control proposal is not awaiting the Founder', { proposalId: p.id, state: p.state });
  const current = currentRevision(ctx, p.family, canonicalJson(p.scope));
  return { proposalId: p.id, family: p.family, scope: canonicalJson(p.scope), operation: p.operation, value: controlValueCode(p.value), from: current === null ? 'NONE' : `${current.operation}:${controlValueCode(current.value)}`, reasonCode: p.reasonCode, evidenceRefs: p.evidenceRefs, risk: 'R3', review: ctx.db.get<{ state: string }>('SELECT state FROM review_requests WHERE id = ?', p.reviewRequestId)?.state ?? 'NONE' };
}

/** The issuing preconditions (code; the datastore re-checks them): awaiting the Founder, still reviewed, not stale. */
function assertIssuable(ctx: StoreContext, p: ControlProposalRecord): Id {
  if (p.state !== 'AWAITING_FOUNDER') throw new QandeelError('INVALID_TRANSITION', 'this control proposal is not awaiting the Founder', { proposalId: p.id, state: p.state });
  const review = ctx.db.get<{ id: string }>(`SELECT id FROM review_requests WHERE id = ? AND kind = 'REQUIRED' AND subject_kind = 'ACTION' AND state = 'SATISFIED' AND subject_fingerprint = ?`, p.reviewRequestId, p.fingerprint);
  if (!review) throw new QandeelError('REVIEW_REQUIRED', 'an R3 control is issued only on a satisfied independent review of exactly this act', { proposalId: p.id });
  if ((currentRevision(ctx, p.family, canonicalJson(p.scope))?.revision ?? 0) !== p.expectedRevision) throw new QandeelError('INVALID_TRANSITION', 'another revision of this control was issued first; a new act needs a new review', { proposalId: p.id, reason: 'STALE_EXPECTED_REVISION' });
  return review.id as Id;
}

/**
 * The Founder decided an R3 control approval (`decideApproval`, same transaction, after the approval row changed).
 * REJECTED ends the proposal. APPROVED issues exactly the approved act: the next revision of its series (created on
 * its first revision), consuming the review and the approval (single use) — and every other open proposal of the
 * series becomes STALE (its pending approval REVOKED), so two revisions can never both become current.
 */
export function txControlApprovalDecided(ctx: StoreContext, approval: ApprovalRecord, to: 'APPROVED' | 'REJECTED', founderRef: string): void {
  const r = ctx.db.get<Row>('SELECT * FROM app_control_proposals WHERE approval_id = ?', approval.id);
  if (!r) throw new QandeelError('INVALID_TRANSITION', 'no control proposal awaits this approval', { approvalId: approval.id });
  const p = mapProposal(r);
  if (to === 'REJECTED') {
    if (p.state !== 'AWAITING_FOUNDER') throw new QandeelError('INVALID_TRANSITION', 'this control proposal is not awaiting the Founder', { proposalId: p.id, state: p.state });
    moveProposal(ctx, p, 'REJECTED', 'founder.rejected', founderRef);
    return;
  }
  const reviewRequestId = assertIssuable(ctx, p);
  const at = ts(ctx);
  const scopeJson = canonicalJson(p.scope);
  const current = currentRevision(ctx, p.family, scopeJson);
  let seriesId = (ctx.db.get<{ id: string }>('SELECT id FROM app_control_series WHERE family = ? AND scope_json = ?', p.family, scopeJson)?.id ?? null) as Id | null;
  if (seriesId === null) {
    seriesId = newId();
    ctx.db.run('INSERT INTO app_control_series (id, family, scope_kind, scope_json, created_at) VALUES (?, ?, ?, ?, ?)', seriesId, p.family, p.scope.kind, scopeJson, at);
  }
  const revision = (current?.revision ?? 0) + 1;
  const revisionId = newId();
  const digest = controlRevisionDigest({ seriesId, revision, family: p.family, scope: p.scope, operation: p.operation, value: p.value, priorDigest: current?.digest ?? null });
  ctx.db.run(
    `INSERT INTO app_control_revisions (id, series_id, revision, prior_revision_id, family, scope_kind, scope_json, operation, value_json, reason_code, proposal_id, proposer_ref, review_request_id, approval_id, issued_by_ref, issued_at, digest, company_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED')`,
    revisionId, seriesId, revision, current?.id ?? null, p.family, p.scope.kind, scopeJson, p.operation, p.value === null ? null : canonicalJson(p.value), p.reasonCode, p.id, `employee:${p.proposerEmployeeId}`, reviewRequestId, approval.id, founderRef, at, digest,
  );
  // Single use: the review and the approval authorized exactly this revision.
  consumeControlReview(ctx, reviewRequestId, `app_control_revision:${revisionId}`);
  const live = mapApproval(ctx.db.get<Row>('SELECT * FROM approvals WHERE id = ?', approval.id) ?? {});
  ctx.db.run(`UPDATE approvals SET state = 'CONSUMED', uses = uses + 1, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND state = 'APPROVED'`, at, live.id, live.version);
  ctx.db.run('INSERT INTO approval_history (approval_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', live.id, live.version + 1, 'APPROVED', 'CONSUMED', 'app_control.issued', founderRef, at);
  moveProposal(ctx, p, 'ISSUED', 'founder.approved', founderRef, { revisionId });
  // Concurrent proposals of the same series were made against a revision that is no longer current.
  for (const o of ctx.db.all<Row>(`SELECT * FROM app_control_proposals WHERE family = ? AND scope_json = ? AND state IN ('PROPOSED', 'AWAITING_FOUNDER') AND id <> ? ORDER BY created_at, id`, p.family, scopeJson, p.id).map(mapProposal)) {
    moveProposal(ctx, o, 'STALE', 'app_control.series_moved', founderRef);
    if (o.approvalId !== null) {
      const a = mapApproval(ctx.db.get<Row>('SELECT * FROM approvals WHERE id = ?', o.approvalId) ?? {});
      if (a.state === 'PENDING') {
        ctx.db.run(`UPDATE approvals SET state = 'REVOKED', version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, at, a.id, a.version);
        ctx.db.run('INSERT INTO approval_history (approval_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', a.id, a.version + 1, 'PENDING', 'REVOKED', 'app_control.series_moved', founderRef, at);
        appendAudit(ctx, 'approval.revoked', 'approval', a.id, { actorRef: founderRef }, 'OK', 'app_control.series_moved', { risk: a.risk, action: a.action.slice(0, 64) });
      }
    }
  }
  appendAudit(ctx, 'app_control.revision_issued', 'app_control_series', seriesId, { actorRef: founderRef, correlationId: p.id }, 'OK', p.operation, { revisionId, revision, family: p.family, proposalId: p.id, approvalId: approval.id, reviewRequestId });
  appendEvent(ctx, 'app_control.revision_issued', 'app_control', seriesId, { correlationId: p.id, actorRef: founderRef }, { revisionId, revision, family: p.family, operation: p.operation, digest });
}

/** The Company-issued desired control of one revision, as the outbound contract states it. */
export const controlEnvelope = (r: ControlRevisionRecord): IssuedControlEnvelope => ({
  seriesId: r.seriesId,
  revision: r.revision,
  family: r.family,
  scope: r.scope,
  operation: r.operation,
  value: r.value,
  issuedAt: r.issuedAt,
  digest: r.digest,
  companyState: COMPANY_CONTROL_STATES[0],
});

export interface IssuedControlsExport {
  /** `company.issued-controls@1`: Company-ISSUED desired controls — never App-applied or effective state. */
  readonly contract: typeof ISSUED_CONTROL_CONTRACT;
  readonly controls: readonly IssuedControlEnvelope[];
  /** Deterministic digest of the whole export (a fingerprint, not authentication or a signature). */
  readonly digest: string;
}

export class AppControlStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): AppControlStore {
    return new AppControlStore(store);
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  /** The closed catalogue of the seven approved families, as the datastore holds it. */
  families(): { family: ControlFamily; ordinal: number; scopeKinds: string[]; grantResource: string }[] {
    return this.#read((ctx) => ctx.db.all<Row>('SELECT * FROM app_control_families ORDER BY ordinal').map((r) => ({ family: s(r.family) as ControlFamily, ordinal: Number(r.ordinal), scopeKinds: JSON.parse(s(r.scope_kinds_json)) as string[], grantResource: s(r.grant_resource) })));
  }

  /** The APPROVED Remote Configuration families (empty in this release). */
  remoteConfigFamilies(): RemoteConfigFamily[] {
    return this.#read((ctx) => register(ctx));
  }

  proposals(filter: { state?: ControlProposalState; workItemId?: string } = {}): ControlProposalRecord[] {
    // Filtered in SQL before the bound, so nothing that matches is cut by it.
    return this.#read((ctx) => ctx.db.all<Row>('SELECT * FROM app_control_proposals WHERE (? IS NULL OR state = ?) AND (? IS NULL OR work_item_id = ?) ORDER BY created_at, id LIMIT 2000', filter.state ?? null, filter.state ?? null, filter.workItemId ?? null, filter.workItemId ?? null).map(mapProposal));
  }

  proposal(id: string): ControlProposalRecord {
    return this.#read((ctx) => getProposal(ctx, id) ?? notFound('control proposal', id));
  }

  proposalHistory(id: string): { version: number; from: string | null; to: string; reasonCode: string; actorRef: string }[] {
    return this.#read((ctx) => ctx.db.all<Row>('SELECT * FROM app_control_proposal_history WHERE proposal_id = ? ORDER BY version', id).map((r) => ({ version: Number(r.version), from: os(r.from_state), to: s(r.to_state), reasonCode: s(r.reason_code), actorRef: s(r.actor_ref) })));
  }

  series(): { id: Id; family: ControlFamily; scope: ControlScope; createdAt: string }[] {
    return this.#read((ctx) => ctx.db.all<Row>('SELECT * FROM app_control_series ORDER BY created_at, id').map((r) => ({ id: s(r.id) as Id, family: s(r.family) as ControlFamily, scope: JSON.parse(s(r.scope_json)) as ControlScope, createdAt: s(r.created_at) })));
  }

  /** Every issued revision of one series, oldest first (history is never rewritten). */
  revisions(seriesId: string): ControlRevisionRecord[] {
    return this.#read((ctx) => ctx.db.all<Row>('SELECT * FROM app_control_revisions WHERE series_id = ? ORDER BY revision', seriesId).map(mapRevision));
  }

  /**
   * The outbound read seam later App-side Production Integration may consume: the CURRENT Company-issued revision of
   * every series (a RELEASE included — the overlay was removed), in a deterministic order, bounded operational state
   * only. It is Company desired state; the App runtime alone decides what is effective. No transport exists.
   */
  issuedControls(): IssuedControlsExport {
    return this.#read((ctx) => {
      const controls = ctx.db
        .all<Row>(
          `SELECT r.* FROM app_control_revisions r JOIN app_control_series x ON x.id = r.series_id JOIN app_control_families f ON f.family = x.family
            WHERE r.revision = (SELECT MAX(m.revision) FROM app_control_revisions m WHERE m.series_id = r.series_id)
            ORDER BY f.ordinal, x.scope_json`,
        )
        .map((r) => controlEnvelope(mapRevision(r)));
      return { contract: ISSUED_CONTROL_CONTRACT, controls, digest: sha256Hex(canonicalJson({ contract: ISSUED_CONTROL_CONTRACT, controls })) };
    });
  }

  /** Content-free counts. */
  health(): { families: number; approvedRemoteConfigFamilies: number; proposals: Record<ControlProposalState, number>; series: number; revisions: number; currentSet: number } {
    return this.#read((ctx) => {
      const n = (sql: string, ...p: string[]): number => Number(ctx.db.get<{ n: number }>(sql, ...p)?.n ?? 0);
      const by = (st: ControlProposalState): number => n('SELECT COUNT(*) AS n FROM app_control_proposals WHERE state = ?', st);
      return {
        families: n('SELECT COUNT(*) AS n FROM app_control_families'),
        approvedRemoteConfigFamilies: n('SELECT COUNT(*) AS n FROM app_remote_config_families'),
        proposals: { PROPOSED: by('PROPOSED'), AWAITING_FOUNDER: by('AWAITING_FOUNDER'), ISSUED: by('ISSUED'), REJECTED: by('REJECTED'), REVIEW_REJECTED: by('REVIEW_REJECTED'), STALE: by('STALE') },
        series: n('SELECT COUNT(*) AS n FROM app_control_series'),
        revisions: n('SELECT COUNT(*) AS n FROM app_control_revisions'),
        currentSet: n(`SELECT COUNT(*) AS n FROM app_control_revisions r WHERE r.operation = 'SET' AND r.revision = (SELECT MAX(m.revision) FROM app_control_revisions m WHERE m.series_id = r.series_id)`),
      };
    });
  }
}

function notFound(what: string, id: string): never {
  throw new QandeelError('NOT_FOUND', `${what} not found`, { id: String(id).slice(0, 36) });
}

