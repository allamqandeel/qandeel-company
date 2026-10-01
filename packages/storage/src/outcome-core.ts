/**
 * Storage-internal: the one write path of an outcome verification (Completed != Reviewed != Outcome Verified),
 * shared by the Founder's verification and the Review Pool's (C6-R1). It runs inside its caller's transaction.
 * A verification is judgment evidence only: it transitions the judged Work Item and records who judged it and
 * on what evidence — it grants, approves, funds and routes nothing.
 *
 * C7-A: EXTERNAL_OUTCOME is no longer refused by a compile-time flag; it is admitted exactly when the cited
 * `external_record:` references are usable governed evidence bound to this Work Item (`txAssertExternalEvidence`,
 * re-checked by the datastore). An external observation is evidence for the verifier — never itself a verdict.
 */
import { QandeelError, newId, type Id } from '@qandeel-company/domain';
import { EVIDENCE_CLASSES } from '@qandeel-company/mind';

import { txAssertExternalEvidence, verificationValidity } from './external-core.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import type { WorkItemRecord } from './records.js';
import { applyTransition } from './work-core.js';

export type OutcomeVerifier = { readonly kind: 'FOUNDER'; readonly ref: string } | { readonly kind: 'REVIEW_POOL'; readonly reviewRequestId: Id };

/** Evidence classes of a verification: named and known (whether EXTERNAL_OUTCOME is usable is decided from durable evidence). */
export function assertOutcomeClasses(input: readonly string[]): string[] {
  const classes = [...new Set(input)];
  if (classes.length === 0 || !classes.every((c) => (EVIDENCE_CLASSES as readonly string[]).includes(c))) throw new QandeelError('EVIDENCE_REQUIRED', 'an outcome verification names its evidence classes', { field: 'evidenceClasses' });
  return classes;
}

export function txRecordOutcome(ctx: StoreContext, w: WorkItemRecord, input: { verdict: 'ACHIEVED' | 'NOT_ACHIEVED' | 'INCONCLUSIVE'; classes: readonly string[]; refs: readonly string[]; reasonCode: string }, verifier: OutcomeVerifier): { verificationId: Id; state: string } {
  if (!['REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'].includes(w.state)) throw new QandeelError('INVALID_TRANSITION', 'an outcome is verified only after independent review (completion is not success)', { workItemId: w.id, state: w.state, reason: 'NOT_REVIEWED' });
  if (input.verdict !== 'INCONCLUSIVE' && w.state !== 'REVIEWED') throw new QandeelError('INVALID_TRANSITION', 'this Work Item already has its verified outcome', { workItemId: w.id, state: w.state });
  txAssertExternalEvidence(ctx, w.id, input.classes, input.refs);
  const id = newId();
  const verifierRef = verifier.kind === 'FOUNDER' ? verifier.ref : `review_request:${verifier.reviewRequestId}`;
  ctx.db.run(
    `INSERT INTO outcome_verifications (id, work_item_id, verdict, evidence_classes_json, evidence_refs_json, verifier_kind, verifier_ref, review_request_id, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, w.id, input.verdict, JSON.stringify(input.classes), JSON.stringify(input.refs), verifier.kind, verifierRef, verifier.kind === 'REVIEW_POOL' ? verifier.reviewRequestId : null, input.reasonCode, ts(ctx),
  );
  let state: string = w.state;
  const trace = { correlationId: w.correlationId, actorRef: verifierRef };
  if (input.verdict === 'ACHIEVED') state = applyTransition(ctx, w, 'OUTCOME_VERIFIED', { reasonCode: 'outcome.verified', outcome: 'ACHIEVED', trace }).state;
  if (input.verdict === 'NOT_ACHIEVED') state = applyTransition(ctx, w, 'CLOSED', { reasonCode: 'outcome.not_achieved', outcome: 'NOT_ACHIEVED', trace }).state;
  appendAudit(ctx, 'outcome.verified', 'work_item', w.id, { actorRef: verifierRef }, 'OK', input.reasonCode, { verificationId: id, verdict: input.verdict, evidenceClasses: input.classes.length, verifierKind: verifier.kind, externalRecords: input.refs.filter((r) => r.startsWith('external_record:')).length });
  return { verificationId: id, state };
}

// ---------------------------------------------------------------------------------------------------------
// C7-A: a verification CONTESTED by a later integrity conflict on its external evidence (the datastore records the
// contest with the conflict) is resolved only by the Founder. History is never rewritten: the decision is a new validity
// row, and a replacement is a new verification of the same Work Item and verdict (no lifecycle change).

export const CONTEST_DECISIONS = ['UPHOLD', 'REPLACE', 'RETRACT'] as const;
export type ContestDecision = (typeof CONTEST_DECISIONS)[number];

/** The verification, when it is CONTESTED now (a typed refusal otherwise). */
export function txContestedVerification(ctx: StoreContext, verificationId: Id): { id: Id; workItemId: Id; verdict: 'ACHIEVED' | 'NOT_ACHIEVED' | 'INCONCLUSIVE' } {
  const v = ctx.db.get<{ id: string; work_item_id: string; verdict: string }>('SELECT id, work_item_id, verdict FROM outcome_verifications WHERE id = ?', verificationId);
  if (!v) throw new QandeelError('NOT_FOUND', 'outcome verification not found', { verificationId });
  if (verificationValidity(ctx, verificationId).state !== 'CONTESTED') throw new QandeelError('INVALID_TRANSITION', 'only a contested verification awaits this decision', { verificationId, reason: 'NOT_CONTESTED' });
  return { id: v.id as Id, workItemId: v.work_item_id as Id, verdict: v.verdict as 'ACHIEVED' | 'NOT_ACHIEVED' | 'INCONCLUSIVE' };
}

/**
 * The Founder's decision on a contested verification: UPHOLD (it stands; current truth again), REPLACE (a re-verification
 * on usable evidence — the governed external-evidence rule applies — becomes current) or RETRACT (no current verified
 * outcome). The caller restates C6 current truth in the same transaction.
 */
export function txResolveContest(ctx: StoreContext, verificationId: Id, decision: ContestDecision, input: { classes: readonly string[]; refs: readonly string[]; reasonCode: string }, founderRef: string): { verificationId: Id; state: 'UPHELD' | 'REPLACED' | 'RETRACTED' } {
  const v = txContestedVerification(ctx, verificationId);
  const at = ts(ctx);
  let replacement: Id | null = null;
  if (decision === 'REPLACE') {
    txAssertExternalEvidence(ctx, v.workItemId, input.classes, input.refs);
    replacement = newId();
    ctx.db.run(
      `INSERT INTO outcome_verifications (id, work_item_id, verdict, evidence_classes_json, evidence_refs_json, verifier_kind, verifier_ref, review_request_id, reason_code, replaces_verification_id, created_at) VALUES (?, ?, ?, ?, ?, 'FOUNDER', ?, NULL, ?, ?, ?)`,
      replacement, v.workItemId, v.verdict, JSON.stringify(input.classes), JSON.stringify(input.refs), founderRef, input.reasonCode, v.id, at,
    );
    appendAudit(ctx, 'outcome.verified', 'work_item', v.workItemId, { actorRef: founderRef }, 'OK', input.reasonCode, { verificationId: replacement, verdict: v.verdict, evidenceClasses: input.classes.length, verifierKind: 'FOUNDER', externalRecords: input.refs.filter((r) => r.startsWith('external_record:')).length, replaces: v.id });
  }
  const state = decision === 'UPHOLD' ? 'UPHELD' : decision === 'REPLACE' ? 'REPLACED' : 'RETRACTED';
  const seq = Number(ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM outcome_verification_validity WHERE verification_id = ?', v.id)?.n ?? 1);
  ctx.db.run(
    `INSERT INTO outcome_verification_validity (verification_id, seq, state, conflict_id, replacement_verification_id, actor_ref, reason_code, occurred_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
    v.id, seq, state, replacement, founderRef, input.reasonCode, at,
  );
  appendAudit(ctx, 'outcome.contest_resolved', 'work_item', v.workItemId, { actorRef: founderRef }, 'OK', input.reasonCode, { verificationId: v.id, decision, replacementId: replacement });
  return { verificationId: replacement ?? v.id, state };
}
