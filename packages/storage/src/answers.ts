/**
 * L1-02 — the typed deliverable of an answer-bearing Work Item (D-L1-13).
 *
 * An Academy attempt, a Skill benchmark case or a probation shadow assignment exists to produce one answer the
 * evaluators can read: a bounded prose body plus the closed decision facets of the `ANSWER` proposal. The write is
 * fenced (runtime-authority only): the answer binds to the run's OWN Work Item, the writer is the run's attributed
 * Employee (never a value in the output), and the item must be answer-bearing and still open for an answer. The body is
 * local governed business content (D1): it never enters telemetry, events or audit (Rule A); audit rows carry IDs only.
 * An answer decides, approves, scores and grants nothing — evaluators and the deterministic rubric do.
 */
import { newId, sha256Hex, type Id } from '@qandeel-company/domain';
import { ANSWER_BODY_MAX, answerFacetsOf, type AnswerFacets } from '@qandeel-company/governance';
import { containsSecretMaterial } from '@qandeel-company/mind';

import { employeeIdFromRef } from './governance-core.js';
import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import type { Fence } from './records.js';

export type AnswerInput = { readonly body: string } & AnswerFacets;

export interface RecordAnswerResult {
  readonly outcome: 'RECORDED' | 'REFUSED';
  readonly code: 'RECORDED' | 'REPLAYED' | 'NOT_AN_ANSWER_TASK' | 'NOT_THE_OWNER' | 'ANSWER_CLOSED' | 'ALREADY_ANSWERED' | 'INVALID_ARGS' | 'SECRET_MATERIAL';
  readonly answerId: Id | null;
}

export interface AnswerRecord {
  readonly id: Id;
  readonly workItemId: Id;
  readonly runId: Id;
  readonly employeeId: Id;
  readonly body: string;
  readonly facets: AnswerFacets;
  readonly createdAt: string;
}

/** What makes a Work Item answer-bearing, and whether it still takes an answer. */
function answerTask(ctx: StoreContext, workItemId: Id): { kind: 'ATTEMPT' | 'BENCHMARK' | 'SHADOW'; open: boolean } | null {
  const attempt = ctx.db.get<{ state: string }>('SELECT state FROM academy_attempts WHERE work_item_id = ?', workItemId);
  if (attempt) return { kind: 'ATTEMPT', open: attempt.state === 'OPEN' };
  const bench = ctx.db.get<{ state: string }>('SELECT state FROM skill_benchmark_runs WHERE work_item_id = ?', workItemId);
  if (bench) return { kind: 'BENCHMARK', open: bench.state === 'OPEN' };
  const shadow = ctx.db.get<{ x: number }>('SELECT 1 AS x FROM academy_shadow_assignments WHERE work_item_id = ?', workItemId);
  if (shadow) return { kind: 'SHADOW', open: true };
  return null;
}

/** The fenced answer write (the caller verified the fence and resolved the attributed Employee). */
export function txRecordAnswer(ctx: StoreContext, fence: Fence, attributedEmployeeId: Id, workItemId: Id, input: AnswerInput): RecordAnswerResult {
  const item = getWorkItemRow(ctx, workItemId);
  const task = answerTask(ctx, item.id);
  const refuse = (code: RecordAnswerResult['code']): RecordAnswerResult => {
    appendAudit(ctx, 'answer.refused', 'work_item', item.id, { actorRef: `employee:${attributedEmployeeId}` }, 'REJECTED', code, { runId: fence.runId });
    return { outcome: 'REFUSED', code, answerId: null };
  };
  if (task === null) return refuse('NOT_AN_ANSWER_TASK');
  if (employeeIdFromRef(item.ownerRef) !== attributedEmployeeId) return refuse('NOT_THE_OWNER');
  const facets = answerFacetsOf(input as unknown as Record<string, unknown>);
  if (facets === null || typeof input.body !== 'string' || input.body.trim().length === 0 || input.body.length > ANSWER_BODY_MAX) return refuse('INVALID_ARGS');
  if (containsSecretMaterial(input.body)) return refuse('SECRET_MATERIAL');
  const sha = sha256Hex(input.body);
  // One answer per Work Item: a resumed run replays the same answer; a different second answer is refused.
  const prior = ctx.db.get<{ id: string; body_sha256: string }>('SELECT id, body_sha256 FROM work_answers WHERE work_item_id = ?', item.id);
  if (prior) return prior.body_sha256 === sha ? { outcome: 'RECORDED', code: 'REPLAYED', answerId: prior.id as Id } : refuse('ALREADY_ANSWERED');
  if (!task.open) return refuse('ANSWER_CLOSED');
  const id = newId();
  ctx.db.run('INSERT INTO work_answers (id, work_item_id, run_id, employee_id, body, body_sha256, facets_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, item.id, fence.runId, attributedEmployeeId, input.body, sha, JSON.stringify(facets), ts(ctx));
  appendAudit(ctx, 'answer.recorded', 'work_answer', id, { actorRef: `employee:${attributedEmployeeId}` }, 'OK', task.kind, { workItemId: item.id, runId: fence.runId });
  return { outcome: 'RECORDED', code: 'RECORDED', answerId: id as Id };
}

export function mapAnswer(r: Record<string, unknown>): AnswerRecord {
  const facets = answerFacetsOf(JSON.parse(String(r.facets_json)) as Record<string, unknown>);
  if (facets === null) throw new Error('stored answer facets are malformed');
  return { id: String(r.id) as Id, workItemId: String(r.work_item_id) as Id, runId: String(r.run_id) as Id, employeeId: String(r.employee_id) as Id, body: String(r.body), facets, createdAt: String(r.created_at) };
}

/** The answer of one Work Item (local governed content for its evaluators and the Founder), or null. */
export function txAnswerOf(ctx: StoreContext, workItemId: Id): AnswerRecord | null {
  const r = ctx.db.get('SELECT * FROM work_answers WHERE work_item_id = ?', workItemId);
  return r ? mapAnswer(r) : null;
}
