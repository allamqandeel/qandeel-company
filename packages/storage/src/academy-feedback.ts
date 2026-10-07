/**
 * D-L1-39 — the Academy Founder Feedback Loop: the Founder's own textual feedback on one Academy attempt.
 *
 * One structured Founder act (ACADEMY_FOUNDER_FEEDBACK), confirmed through the governed preview → fingerprint → confirm
 * boundary. The note is durable in `academy_founder_feedback` (0021), bound to ONE evaluated, non-holdout attempt and to
 * that attempt's exact recorded answer (id + SHA-256). It is append-only: a later note is a new row, and nothing rewrites
 * the attempt, its answer or its scores (history stands as it was decided).
 *
 * It reaches the trainee's LATER Academy attempts: every attempt started after the note carries it in its governed
 * context (RECENT layer, integrity re-checked by SHA-256 on load; the newest note is required, so it is never silently
 * crowded out). The context manifest records each exposure by id — the durable evidence on which a later claim of
 * LEARNING_FROM_FEEDBACK can stand or fall. Production (non-Academy) work never sees it.
 *
 * Governed D1 training content: the body lives only in its own table and the Founder's own preview; audit rows carry
 * IDs, codes and sizes only (Rule A). Feedback grants nothing, scores nothing and calls no model.
 */
import { QandeelError, assertId, newId, sha256Hex, type Id } from '@qandeel-company/domain';
import { containsSecretMaterial } from '@qandeel-company/mind';

import { txAnswerOf } from './answers.js';
import { getEmployeeRow } from './governance-core.js';
import type { EmployeeRecord } from './governance-records.js';
import { appendAudit, ts, type StoreContext } from './internal.js';

/** UTF-8 bytes of one note (≈1,200 Arabic or 2,400 Latin characters; it fits the bounded preview payload). */
export const FEEDBACK_BODY_MAX_BYTES = 2_400;
/** Notes per attempt (append-only additions, bounded). */
export const FEEDBACK_PER_ATTEMPT_MAX = 5;
/** Notes carried into one later attempt's context (newest first; the newest is required). */
export const FEEDBACK_IN_CONTEXT_MAX = 3;

const refuse = (reason: string, message: string, details: Record<string, string | number | boolean | null> = {}): never => {
  throw new QandeelError('VALIDATION_FAILED', message, { reason, ...details });
};
const transition = (reason: string, message: string, details: Record<string, string | number | boolean | null> = {}): never => {
  throw new QandeelError('INVALID_TRANSITION', message, { reason, ...details });
};

export interface FounderFeedbackPlan {
  readonly attemptId: Id;
  readonly attemptKind: string;
  readonly trial: number;
  readonly scenarioCode: string;
  readonly outcome: string;
  readonly averagePct: number | null;
  readonly employee: EmployeeRecord;
  readonly answerId: Id;
  readonly answerSha256: string;
  readonly body: string;
  readonly bodySha256: string;
  readonly bodyBytes: number;
  readonly priorOnAttempt: number;
}

/** Validates one Founder note against durable state (read-only; the preview and the confirmation both run it). */
export function txPlanFounderFeedback(ctx: StoreContext, input: { attemptId: unknown; body: unknown }): FounderFeedbackPlan {
  const attemptId = assertId(input.attemptId, 'attemptId');
  const a = ctx.db.get<{ id: string; kind: string; trial_no: number; state: string; outcome: string | null; average_pct: number | null; holdout: number; work_item_id: string; employee_id: string; scenario_code: string }>(
    `SELECT a.id, a.kind, a.trial_no, a.state, a.outcome, a.average_pct, a.holdout, a.work_item_id, e.employee_id, s.code AS scenario_code
       FROM academy_attempts a JOIN academy_enrollments e ON e.id = a.enrollment_id JOIN academy_scenarios s ON s.id = a.scenario_id WHERE a.id = ?`,
    attemptId,
  );
  if (!a) throw new QandeelError('NOT_FOUND', 'attempt not found', { attemptId });
  if (a.state !== 'EVALUATED') transition('ATTEMPT_NOT_EVALUATED', 'Founder feedback is given on an evaluated attempt (its scores are decided first, and never rewritten)', { state: a.state });
  // A holdout stays hidden: feedback on it would carry the holdout into the trainee's later contexts.
  if (a.holdout === 1) refuse('HOLDOUT_ATTEMPT', 'a hidden holdout attempt takes no feedback (it would expose the holdout to later attempts)');
  const answer = txAnswerOf(ctx, a.work_item_id as Id);
  if (!answer) refuse('NO_ANSWER', 'Founder feedback is bound to the attempt\'s recorded answer; this attempt has none');
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (body.length === 0) refuse('FEEDBACK_EMPTY', 'write the feedback', { field: 'feedback' });
  const bodyBytes = Buffer.byteLength(body, 'utf8');
  if (bodyBytes > FEEDBACK_BODY_MAX_BYTES) refuse('FEEDBACK_TOO_LONG', `feedback is at most ${FEEDBACK_BODY_MAX_BYTES} bytes`, { field: 'feedback', bytes: bodyBytes });
  if (containsSecretMaterial(body)) refuse('SECRET_MATERIAL', 'feedback must not contain secret material', { field: 'feedback' });
  const priorOnAttempt = Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_founder_feedback WHERE attempt_id = ?', a.id)?.n ?? 0);
  if (priorOnAttempt >= FEEDBACK_PER_ATTEMPT_MAX) transition('FEEDBACK_LIMIT', `at most ${FEEDBACK_PER_ATTEMPT_MAX} notes per attempt`);
  const ans = answer as NonNullable<typeof answer>;
  return {
    attemptId: a.id as Id, attemptKind: a.kind, trial: Number(a.trial_no), scenarioCode: a.scenario_code, outcome: String(a.outcome), averagePct: a.average_pct === null ? null : Number(a.average_pct),
    employee: getEmployeeRow(ctx, a.employee_id as Id), answerId: ans.id, answerSha256: sha256Hex(ans.body), body, bodySha256: sha256Hex(body), bodyBytes, priorOnAttempt,
  };
}

/** Records one Founder note (in the caller's Founder transaction). The confirmed answer and note must be the planned ones. */
export function txRecordFounderFeedback(ctx: StoreContext, actorRef: string, input: { attemptId: Id; body: string; expectedAnswerSha256: string; expectedBodySha256: string; reasonCode: string }): { readonly id: Id; readonly plan: FounderFeedbackPlan } {
  const plan = txPlanFounderFeedback(ctx, input);
  if (plan.answerSha256 !== input.expectedAnswerSha256) transition('ANSWER_CHANGED', 'the answer the feedback addresses is not the recorded one');
  if (plan.bodySha256 !== input.expectedBodySha256) transition('FEEDBACK_CHANGED', 'the feedback is not the previewed text');
  const id = newId();
  ctx.db.run(
    `INSERT INTO academy_founder_feedback (id, attempt_id, employee_id, work_answer_id, answer_sha256, body, body_sha256, data_class, set_by_ref, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'D1', ?, ?, ?)`,
    id, plan.attemptId, plan.employee.id, plan.answerId, plan.answerSha256, plan.body, plan.bodySha256, actorRef, input.reasonCode, ts(ctx),
  );
  appendAudit(ctx, 'academy.founder_feedback_recorded', 'academy_attempt', plan.attemptId, { actorRef }, 'OK', input.reasonCode, { feedbackId: id, employeeId: plan.employee.id, answerId: plan.answerId, bytes: plan.bodyBytes });
  return { id, plan };
}

export interface FeedbackForContext {
  readonly id: Id;
  readonly prefix: string;
  readonly body: string;
  readonly bodySha256: string;
  readonly createdAt: string;
}

/**
 * The Founder notes a NEW Academy attempt of this Employee carries: notes recorded before the attempt started (so every
 * inference of one attempt sees the same notes), on the Employee's other attempts, newest first, bounded.
 */
export function txFeedbackForAttemptContext(ctx: StoreContext, employeeId: Id, attemptId: Id): readonly FeedbackForContext[] {
  return ctx.db
    .all<{ id: string; body: string; body_sha256: string; created_at: string; kind: string; trial_no: number; code: string }>(
      `SELECT f.id, f.body, f.body_sha256, f.created_at, a.kind, a.trial_no, s.code
         FROM academy_founder_feedback f JOIN academy_attempts a ON a.id = f.attempt_id JOIN academy_scenarios s ON s.id = a.scenario_id
        WHERE f.employee_id = ? AND f.attempt_id <> ? AND f.created_at <= (SELECT created_at FROM academy_attempts WHERE id = ?)
        ORDER BY f.created_at DESC, f.rowid DESC LIMIT ?`,
      employeeId, attemptId, attemptId, FEEDBACK_IN_CONTEXT_MAX,
    )
    .map((f) => ({ id: f.id as Id, prefix: `Founder feedback on your earlier Academy ${f.kind.toLowerCase()} #${f.trial_no} (${f.code}) — apply it in this attempt: `, body: f.body, bodySha256: f.body_sha256, createdAt: f.created_at }));
}

export interface FounderFeedbackView {
  readonly id: Id;
  readonly body: string;
  readonly setByRef: string;
  readonly createdAt: string;
  readonly answerRef: string;
  /** Later attempts whose governed context actually carried this note (manifest evidence; never inferred). */
  readonly exposedTo: readonly { readonly attemptId: Id; readonly manifests: number }[];
}

/** Read-only: the Founder notes on one attempt and where each one was exposed (the evidence for learning from feedback). */
export function txFounderFeedbackOf(ctx: StoreContext, attemptId: Id): readonly FounderFeedbackView[] {
  return ctx.db
    .all<{ id: string; body: string; body_sha256: string; set_by_ref: string; created_at: string; work_answer_id: string }>('SELECT id, body, body_sha256, set_by_ref, created_at, work_answer_id FROM academy_founder_feedback WHERE attempt_id = ? ORDER BY created_at, rowid', attemptId)
    .map((f) => ({
      id: f.id as Id,
      body: sha256Hex(f.body) === f.body_sha256 ? f.body : '',
      setByRef: f.set_by_ref,
      createdAt: f.created_at,
      answerRef: `work_answer:${f.work_answer_id}`,
      exposedTo: ctx.db
        .all<{ attempt_id: string; n: number }>(
          `SELECT a.id AS attempt_id, COUNT(*) AS n FROM context_manifest_entries x JOIN context_manifests m ON m.id = x.manifest_id JOIN academy_attempts a ON a.work_item_id = m.work_item_id
            WHERE x.provenance_ref = ? AND x.decision = 'SELECTED' AND m.outcome = 'OK' GROUP BY a.id ORDER BY MIN(m.created_at)`,
          `academy_founder_feedback:${f.id}`,
        )
        .map((r) => ({ attemptId: r.attempt_id as Id, manifests: Number(r.n) })),
    }));
}
