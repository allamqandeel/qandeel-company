/**
 * CommunicationStore — Founder-facing structured communication (C5, Stage 9).
 *
 * A thread binds the Founder to one Employee (the CEO seat holder for CEO threads) with a purpose and a
 * company context. The Founder writes through the authenticated surface; an Employee writes only from its
 * own governed run (`txRecordMessage`, fenced, reached through runtime-authority) into the thread its Work
 * Item was created to answer. A Founder message that needs an answer creates that Work Item here, in the
 * same transaction, budgeted from the Employee's envelope and released (the queue trigger wakes the runtime).
 *
 * Conversation ≠ Authority (Stage 9 §6, Stage 14): nothing here approves, grants, spends or reassigns;
 * message bodies are company content under the FOUNDER_ONLY scope and never enter audit, events or logs.
 */
import { QandeelError, assertCode, assertId, boundedJson, boundedText, canonicalJson, newId, sha256Hex, type Id, type Timestamp } from '@qandeel-company/domain';
import { assertCognitiveProfile, assertTaskClass, briefAttentionLevel, effectiveClass, isAttentionLevel, isContextKind, isMessagePurpose, isReasoningClass, type AttentionLevel, type ContextKind, type FounderBrief, type MessagePurpose, type ReasoningClass, type ThreadKind } from '@qandeel-company/governance';
import { containsSecretMaterial } from '@qandeel-company/mind';

import { budgetFor, employeeIdFromRef, getEmployeeRow, txAllocateWorkItemBudget } from './governance-core.js';
import { founder, founderAdminWrite, routingSnapshotTx } from './governance.js';
import type { EmployeeRecord } from './governance-records.js';
import { txSetReasoningOverride } from './reasoning-control.js';
import { mapMessage, mapThread, messageMeta, mustRow, type MessageMeta, type MessageRecord, type ThreadRecord } from './founder-records.js';
import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { ceoSeat, seatHolder } from './org-core.js';
import type { Fence } from './records.js';
import { storeContext, type CompanyStore } from './store.js';
import { applyTransition, enqueueJob } from './work-core.js';
import { txDeclareRequirements } from './capability.js';
import { txCreateWorkItem } from './work-items.js';

const EMPLOYEE_TASK = 'c2.employee-task';
/** Founder communication runs are ordinary governed tasks of this class (routed by the Router Policy). */
export const FOUNDER_REPLY_TASK_CLASS = 'founder.reply';
export const FOUNDER_BRIEF_TASK_CLASS = 'founder.brief';
const DEFAULT_REPLY_CAP = { money: 500_000, tokens: 200_000 };

export interface OpenThreadInput {
  readonly kind: ThreadKind;
  /** Omitted for FOUNDER_CEO / CEO_BRIEF (the CEO seat holder is resolved at open time). */
  readonly employeeId?: string;
  readonly subject: string;
  readonly contextKind?: ContextKind | null;
  readonly contextRef?: string | null;
}

export interface FounderSendInput {
  readonly purpose: MessagePurpose;
  readonly body: string;
  readonly attentionLevel?: AttentionLevel;
  readonly responseRequired?: boolean;
  readonly contextRefs?: readonly string[];
  /** Cap of the reply Work Item's budget (bounded by the Employee's envelope). */
  readonly replyCap?: { readonly money: number; readonly tokens: number };
  readonly replyTaskClass?: string;
  /**
   * P1-CHAT-INTEL-01: the Founder's reasoning level for THIS message's reply only (E1..E4). It is recorded, in the same
   * transaction, as the durable one-task override of the reply Work Item (`work_item_reasoning_overrides`), which the run
   * reads when it begins and the reservation enforces. It never touches the Employee's persistent profile, and it is
   * refused (nothing is sent) above the Employee's ceiling or the route policy.
   */
  readonly reasoningClass?: string;
  /**
   * P1-CHAT-INTEL-01: a client-generated idempotency key. A repeated send with the same key (a double submit, a retry after
   * a dropped response) returns the message already recorded and never creates a second message or reply; the same key with
   * a different request (or another thread) is IDEMPOTENCY_CONFLICT.
   */
  readonly clientKey?: string;
}

/**
 * P1-CHAT-INTEL-01: the bounds of one conversation reply (fast, economical chat). One MESSAGE is the whole answer (D-L1-09),
 * so a reply needs one model call, plus at most one evidence-based retry / escalation and one governed side step. The output
 * bound grows with the thinking level, assuming a thinking model spends its reasoning inside the same output allowance (to verify live); the
 * reservation still holds each call's worst case and the reply's own capped budget.
 */
export const CHAT_REPLY_MAX_MODEL_CALLS = 3;
export const CHAT_REPLY_MAX_TURNS = 3;
export const CHAT_REPLY_OUTPUT_TOKENS: Readonly<Record<'E1' | 'E2' | 'E3' | 'E4', number>> = Object.freeze({ E1: 1024, E2: 2048, E3: 4096, E4: 8192 });
const CLIENT_KEY = /^[A-Za-z0-9-]{8,64}$/;
/** The canonical idempotency scope of a Founder chat send: the key binds the MESSAGE itself, with or without a reply. */
export const IDEMPOTENCY_SCOPE_FOUNDER_SEND = 'communication.founder_send';

export interface MessageProposalInput {
  readonly purpose: MessagePurpose;
  readonly attentionLevel: AttentionLevel;
  readonly body: string;
  readonly brief: FounderBrief | null;
  readonly contextRefs: readonly string[];
}

export interface RecordMessageResult {
  readonly outcome: 'RECORDED' | 'REFUSED';
  readonly code: string;
  readonly messageId: Id | null;
  readonly threadId: Id | null;
}

export function getThread(ctx: StoreContext, id: Id): ThreadRecord {
  const r = ctx.db.get('SELECT * FROM communication_threads WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'thread not found', { threadId: id });
  return mapThread(r);
}

function nextSeq(ctx: StoreContext, threadId: Id): number {
  return Number(ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM communication_messages WHERE thread_id = ?', threadId)?.n ?? 1);
}

function touchThread(ctx: StoreContext, t: ThreadRecord): void {
  ctx.db.run('UPDATE communication_threads SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?', ts(ctx), t.id, t.version);
}

const contextRefs = (refs: readonly string[] | undefined): string => {
  const out = (refs ?? []).map((r, i) => boundedText(r, `contextRefs[${i}]`, 128));
  if (out.length > 8) throw new QandeelError('VALIDATION_FAILED', 'too many context refs', { field: 'contextRefs' });
  return JSON.stringify(out);
};

function ceoHolderId(ctx: StoreContext): Id {
  const seat = ceoSeat(ctx);
  const holder = seat ? seatHolder(ctx, seat.id, ts(ctx)).holder : null;
  if (!holder) throw new QandeelError('ORG_NOT_ELIGIBLE', 'the CEO seat is vacant: no CEO thread can be opened', { reason: 'CEO_SEAT_VACANT' });
  return holder.employeeId;
}

/** Opens (or returns) the thread in the caller's transaction. */
export function txOpenThread(ctx: StoreContext, input: OpenThreadInput, actorRef: string): ThreadRecord {
  if (input.kind !== 'FOUNDER_CEO' && input.kind !== 'FOUNDER_EMPLOYEE' && input.kind !== 'CEO_BRIEF') throw new QandeelError('VALIDATION_FAILED', 'unknown thread kind', { field: 'kind' });
  const employeeId = input.kind === 'FOUNDER_EMPLOYEE' ? assertId(input.employeeId, 'employeeId') : ceoHolderId(ctx);
  const e = getEmployeeRow(ctx, employeeId);
  if (e.state === 'RETIRED') throw new QandeelError('ORG_NOT_ELIGIBLE', 'a retired employee holds no thread', { reason: 'EMPLOYEE_RETIRED' });
  const kind = input.contextKind ?? null;
  if (kind !== null && !isContextKind(kind)) throw new QandeelError('VALIDATION_FAILED', 'unknown context kind', { field: 'contextKind' });
  const ref = kind === null ? null : boundedText(input.contextRef, 'contextRef', 161);
  if (kind === null && input.contextRef) throw new QandeelError('VALIDATION_FAILED', 'a context ref needs a context kind', { field: 'contextKind' });
  const id = newId();
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO communication_threads (id, kind, employee_id, subject, context_kind, context_ref, access_scope, state, opened_by_ref, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'FOUNDER_ONLY', 'OPEN', ?, 1, ?, ?)`,
    id, input.kind, employeeId, boundedText(input.subject, 'subject', 160), kind, ref, actorRef, at, at,
  );
  appendAudit(ctx, 'communication.thread_opened', 'thread', id, { actorRef }, 'OK', input.kind, { employeeId, contextKind: kind });
  return getThread(ctx, id);
}

function insertMessage(ctx: StoreContext, t: ThreadRecord, m: { senderKind: 'FOUNDER' | 'EMPLOYEE'; senderRef: string; purpose: MessagePurpose; level: AttentionLevel; body: string; brief: FounderBrief | null; responseRequired: boolean; replyWorkItemId: Id | null; runId: Id | null; contextRefsJson: string }): MessageRecord {
  const id = newId();
  const seq = nextSeq(ctx, t.id);
  ctx.db.run(
    `INSERT INTO communication_messages (id, thread_id, seq, sender_kind, sender_ref, purpose, attention_level, body, body_sha256, brief_json, response_required, reply_work_item_id, run_id, context_refs_json, superseded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    id, t.id, seq, m.senderKind, m.senderRef, m.purpose, m.level, m.body, sha256Hex(m.body), m.brief === null ? null : boundedJson(m.brief, 'brief', 6000), m.responseRequired ? 1 : 0, m.replyWorkItemId, m.runId, m.contextRefsJson, ts(ctx),
  );
  touchThread(ctx, t);
  // Content-free: purpose, level, seq and hashes only (Rule A).
  appendAudit(ctx, 'communication.message', 'thread', t.id, { actorRef: m.senderRef }, 'OK', m.purpose, { messageId: id, seq, level: m.level, responseRequired: m.responseRequired, replyWorkItemId: m.replyWorkItemId, runId: m.runId });
  return mapMessage(mustRow(ctx.db.get('SELECT * FROM communication_messages WHERE id = ?', id), 'message'));
}

/**
 * The Founder's message. When it needs an answer, the Employee's reply is a governed Work Item created here:
 * owned by the Employee, in the Founder's data class, funded from the Employee's envelope, released at once.
 * The thread and the message it answers are bound in its immutable processor input.
 */
export function txFounderSend(ctx: StoreContext, threadId: Id, input: FounderSendInput, founderRef: string): { message: MessageRecord; replyWorkItemId: Id | null; replayed?: boolean } {
  const t = getThread(ctx, threadId);
  if (input.clientKey !== undefined && (typeof input.clientKey !== 'string' || !CLIENT_KEY.test(input.clientKey))) throw new QandeelError('VALIDATION_FAILED', 'clientKey is 8..64 letters, digits or dashes', { field: 'clientKey' });
  if (input.reasoningClass !== undefined && input.reasoningClass !== null && (!isReasoningClass(input.reasoningClass) || input.reasoningClass === 'E0')) throw new QandeelError('VALIDATION_FAILED', 'a reasoning level is E1, E2, E3 or E4', { field: 'reasoningClass', reason: 'REASONING_CLASS' });
  if (!isMessagePurpose(input.purpose) || input.purpose === 'BRIEF') throw new QandeelError('VALIDATION_FAILED', 'the Founder sends a request, question, decision, correction or FYI (a BRIEF is the CEO\'s)', { field: 'purpose' });
  const level = input.attentionLevel ?? 'INFORMATIONAL';
  if (!isAttentionLevel(level)) throw new QandeelError('VALIDATION_FAILED', 'unknown attention level', { field: 'attentionLevel' });
  const body = boundedText(input.body, 'body', 4000);
  if (containsSecretMaterial(body)) throw new QandeelError('VALIDATION_FAILED', 'a message never carries secret material', { field: 'body' });
  const wantsReply = input.responseRequired ?? (input.purpose === 'REQUEST' || input.purpose === 'QUESTION' || input.purpose === 'DECISION_REQUEST');
  const refsJson = contextRefs(input.contextRefs);
  // Idempotency binds the MESSAGE (with or without a reply) through the canonical idempotency records. The fingerprint holds
  // the thread and every request setting, so the same key replays only the same send in the same thread; anything else is a
  // conflict that names no other message. It holds a body hash only, never the text (Rule A).
  const key = input.clientKey ?? null;
  const fingerprint = key === null ? null : sha256Hex(canonicalJson({ threadId: t.id, purpose: input.purpose, level, bodySha256: sha256Hex(body), responseRequired: wantsReply, reasoningClass: input.reasoningClass ?? null, replyTaskClass: input.replyTaskClass ?? null, replyCap: input.replyCap ?? null, contextRefs: refsJson }));
  if (key !== null) {
    const prior = ctx.db.get<{ fingerprint: string; result_ref: string }>('SELECT fingerprint, result_ref FROM idempotency_records WHERE scope = ? AND idem_key = ?', IDEMPOTENCY_SCOPE_FOUNDER_SEND, key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new QandeelError('IDEMPOTENCY_CONFLICT', 'this send key was already used for a different message', { scope: IDEMPOTENCY_SCOPE_FOUNDER_SEND, reason: 'CLIENT_KEY_REUSED' });
      // The same send arriving again is the message already recorded, whatever its reply has become since.
      const message = mapMessage(mustRow(ctx.db.get('SELECT * FROM communication_messages WHERE id = ? AND thread_id = ?', prior.result_ref, t.id), 'message'));
      return { message, replyWorkItemId: message.replyWorkItemId, replayed: true };
    }
  }
  if (t.state !== 'OPEN') throw new QandeelError('COMMUNICATION_INVALID', 'the thread is closed', { threadId: t.id });
  const remember = (message: MessageRecord): void => {
    if (key !== null && fingerprint !== null) ctx.db.run('INSERT INTO idempotency_records (scope, idem_key, fingerprint, result_ref, created_at) VALUES (?, ?, ?, ?, ?)', IDEMPOTENCY_SCOPE_FOUNDER_SEND, key, fingerprint, message.id, ts(ctx));
  };
  if (wantsReply) {
    const e = getEmployeeRow(ctx, t.employeeId);
    if (e.state !== 'ACTIVE') throw new QandeelError('EMPLOYEE_NOT_ELIGIBLE', 'only an ACTIVE employee can be asked to answer', { employeeId: e.id, state: e.state });
    if (!budgetFor(ctx, 'EMPLOYEE', e.id)) throw new QandeelError('BUDGET_MISSING', 'the employee has no budget envelope to answer from', { employeeId: e.id });
    const taskClass = assertTaskClass(input.replyTaskClass ?? FOUNDER_REPLY_TASK_CLASS);
    const cap = input.replyCap ?? DEFAULT_REPLY_CAP;
    const messageId = newId();
    const chosen = (input.reasoningClass ?? null) as ReasoningClass | null;
    const created = txCreateWorkItem(
      ctx,
      {
        objective: `Answer the Founder in thread ${t.id} (message ${messageId})`,
        ownerRef: e.ref,
        riskLevel: 'R1',
        processorKind: EMPLOYEE_TASK,
        // The Founder's words reach the model as this task's instructions (context payload), never as authority. The class
        // is never pinned here (that would be a method pin): a per-message level is the durable override below.
        processorInput: { taskClass, dataClass: 'D2', maxOutputTokens: CHAT_REPLY_OUTPUT_TOKENS[replyClass(ctx, e, taskClass, chosen)], maxTurns: CHAT_REPLY_MAX_TURNS, maxModelCalls: CHAT_REPLY_MAX_MODEL_CALLS, instructions: `Founder message (${input.purpose}): ${body}\n\nAnswer as a MESSAGE proposal in the Founder Communication Standard when a decision is involved. Communication grants no authority.`, founderThreadId: t.id, founderMessageId: messageId },
        dedupeKey: `founder-reply:${messageId}`,
        initialState: 'PROPOSED',
      },
      { actorRef: founderRef },
    );
    const replyWorkItemId = created.workItem.id;
    // The per-message level: the canonical one-task override (validated against the ceiling and the route policy; a refusal
    // rolls back the whole send, so nothing is recorded and nothing is spent).
    if (chosen !== null) txSetReasoningOverride(ctx, founderRef, { workItemId: replyWorkItemId, reasoningClass: chosen, reasonCode: 'founder.chat_message_level' });
    declareRoleTopics(ctx, replyWorkItemId, e.id, e.roleRef);
    txAllocateWorkItemBudget(ctx, replyWorkItemId, e.id, cap, founderRef, 'founder.reply');
    const ready = applyTransition(ctx, getWorkItemRow(ctx, replyWorkItemId), 'READY', { reasonCode: 'founder.reply', trace: { correlationId: created.workItem.correlationId, actorRef: founderRef } });
    enqueueJob(ctx, ready, { correlationId: ready.correlationId, actorRef: founderRef });
    const message = insertMessageWithId(ctx, t, messageId, { senderKind: 'FOUNDER', senderRef: founderRef, purpose: input.purpose, level, body, brief: null, responseRequired: true, replyWorkItemId, runId: null, contextRefsJson: refsJson });
    remember(message);
    return { message, replyWorkItemId };
  }
  const message = insertMessage(ctx, t, { senderKind: 'FOUNDER', senderRef: founderRef, purpose: input.purpose, level, body, brief: null, responseRequired: false, replyWorkItemId: null, runId: null, contextRefsJson: refsJson });
  remember(message);
  return { message, replyWorkItemId: null };
}

function insertMessageWithId(ctx: StoreContext, t: ThreadRecord, id: Id, m: Parameters<typeof insertMessage>[2]): MessageRecord {
  const seq = nextSeq(ctx, t.id);
  ctx.db.run(
    `INSERT INTO communication_messages (id, thread_id, seq, sender_kind, sender_ref, purpose, attention_level, body, body_sha256, brief_json, response_required, reply_work_item_id, run_id, context_refs_json, superseded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    id, t.id, seq, m.senderKind, m.senderRef, m.purpose, m.level, m.body, sha256Hex(m.body), null, m.responseRequired ? 1 : 0, m.replyWorkItemId, m.runId, m.contextRefsJson, ts(ctx),
  );
  touchThread(ctx, t);
  appendAudit(ctx, 'communication.message', 'thread', t.id, { actorRef: m.senderRef }, 'OK', m.purpose, { messageId: id, seq, level: m.level, responseRequired: m.responseRequired, replyWorkItemId: m.replyWorkItemId, runId: null });
  return mapMessage(mustRow(ctx.db.get('SELECT * FROM communication_messages WHERE id = ?', id), 'message'));
}

/**
 * A CEO brief request: a governed Work Item for the CEO seat holder whose MESSAGE proposal (purpose BRIEF)
 * lands in the CEO_BRIEF thread of the given context. Proactive: the runtime / surface asks for it on a
 * durable signal (a pending approval, a blocked item, a due horizon), never on a timer.
 */
export function txRequestCeoBrief(ctx: StoreContext, input: { subject: string; contextKind: ContextKind; contextRef: string; reasonCode: string; instructions: string; cap?: { money: number; tokens: number }; taskClass?: string }, actorRef: string): { thread: ThreadRecord; workItemId: Id; replayed: boolean } {
  const kind = input.contextKind;
  if (!isContextKind(kind)) throw new QandeelError('VALIDATION_FAILED', 'unknown context kind', { field: 'contextKind' });
  const ref = boundedText(input.contextRef, 'contextRef', 161);
  // P1-CHAT-OPS-01: a brief is never about another brief. A CEO brief that itself ends BLOCKED is a durable signal like
  // any other, and briefing about it spawned a new brief per blocked brief: on 2026-10-07 one blocked Founder reply
  // chained 97 brief Work Items while the provider circuit was open. The chain stops here, at its first link.
  if (kind === 'WORK_ITEM' && ref.startsWith('work_item:')) {
    const about = ctx.db.get<{ dedupe_key: string | null }>('SELECT dedupe_key FROM work_items WHERE id = ?', ref.slice('work_item:'.length));
    if (about?.dedupe_key?.startsWith('ceo-brief:')) throw new QandeelError('COMMUNICATION_INVALID', 'a CEO brief is never requested about another CEO brief', { reason: 'BRIEF_ABOUT_BRIEF' });
  }
  const existing = ctx.db.get(`SELECT * FROM communication_threads WHERE kind = 'CEO_BRIEF' AND context_kind = ? AND context_ref = ? AND state = 'OPEN'`, kind, ref);
  const thread = existing ? mapThread(existing) : txOpenThread(ctx, { kind: 'CEO_BRIEF', subject: input.subject, contextKind: kind, contextRef: ref }, actorRef);
  const ceoId = ceoHolderId(ctx);
  const ceo = getEmployeeRow(ctx, ceoId);
  if (ceo.state !== 'ACTIVE') throw new QandeelError('EMPLOYEE_NOT_ELIGIBLE', 'the CEO seat holder is not ACTIVE', { employeeId: ceo.id, state: ceo.state });
  if (!budgetFor(ctx, 'EMPLOYEE', ceo.id)) throw new QandeelError('BUDGET_MISSING', 'the CEO has no budget envelope', { employeeId: ceo.id });
  const instructions = boundedText(input.instructions, 'instructions', 11_000);
  if (containsSecretMaterial(instructions)) throw new QandeelError('VALIDATION_FAILED', 'instructions never carry secret material', { field: 'instructions' });
  // One live brief run per open thread: a repeated signal replays the existing Work Item (never a second run).
  const open = ctx.db.get<{ id: string }>(`SELECT id FROM work_items WHERE dedupe_key = ? AND state NOT IN ('CLOSED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'COMPLETED', 'REVIEWED')`, `ceo-brief:${thread.id}`);
  if (open) return { thread, workItemId: open.id as Id, replayed: true };
  const created = txCreateWorkItem(
    ctx,
    {
      objective: `CEO brief for the Founder: ${boundedText(input.subject, 'subject', 160)}`,
      ownerRef: ceo.ref,
      riskLevel: 'R1',
      processorKind: EMPLOYEE_TASK,
      processorInput: { taskClass: assertTaskClass(input.taskClass ?? FOUNDER_BRIEF_TASK_CLASS), dataClass: 'D2', maxOutputTokens: 1024, instructions, founderThreadId: thread.id, founderMessageId: null },
      // One open brief per context: a repeated signal within the same open thread does not spawn a second run.
      dedupeKey: `ceo-brief:${thread.id}`,
      initialState: 'PROPOSED',
    },
    { actorRef },
  );
  if (created.replayed) return { thread, workItemId: created.workItem.id, replayed: true };
  declareRoleTopics(ctx, created.workItem.id, ceo.id, ceo.roleRef);
  txAllocateWorkItemBudget(ctx, created.workItem.id, ceo.id, input.cap ?? DEFAULT_REPLY_CAP, actorRef, assertCode(input.reasonCode, 'reasonCode'));
  const ready = applyTransition(ctx, getWorkItemRow(ctx, created.workItem.id), 'READY', { reasonCode: input.reasonCode, trace: { correlationId: created.workItem.correlationId, actorRef } });
  enqueueJob(ctx, ready, { correlationId: ready.correlationId, actorRef });
  appendAudit(ctx, 'communication.brief_requested', 'thread', thread.id, { actorRef }, 'OK', input.reasonCode, { workItemId: created.workItem.id, contextKind: kind });
  return { thread, workItemId: created.workItem.id, replayed: false };
}

/**
 * Fenced Employee message (runtime-authority only): the run's Employee writes into the thread its Work Item
 * was created for — bound through the item's immutable processor input — and only there. A message never
 * carries authority; a BRIEF must follow the Founder Communication Standard.
 */
export function txRecordMessage(ctx: StoreContext, fence: Fence, attributedEmployeeId: Id, employeeRef: string, workItemId: Id, input: MessageProposalInput): RecordMessageResult {
  const item = getWorkItemRow(ctx, workItemId);
  const pi = (item.processorInput ?? {}) as Record<string, unknown>;
  const threadId = typeof pi.founderThreadId === 'string' ? pi.founderThreadId : null;
  if (threadId === null) return { outcome: 'REFUSED', code: 'NOT_A_FOUNDER_THREAD_TASK', messageId: null, threadId: null };
  const row = ctx.db.get('SELECT * FROM communication_threads WHERE id = ?', threadId);
  if (!row) return { outcome: 'REFUSED', code: 'THREAD_NOT_FOUND', messageId: null, threadId: null };
  const t = mapThread(row);
  if (t.employeeId !== attributedEmployeeId || employeeIdFromRef(item.ownerRef) !== attributedEmployeeId) return { outcome: 'REFUSED', code: 'NOT_THREAD_PARTICIPANT', messageId: null, threadId: t.id };
  if (t.state !== 'OPEN') return { outcome: 'REFUSED', code: 'THREAD_CLOSED', messageId: null, threadId: t.id };
  if (!isMessagePurpose(input.purpose) || !isAttentionLevel(input.attentionLevel)) return { outcome: 'REFUSED', code: 'INVALID_ARGS', messageId: null, threadId: t.id };
  if (typeof input.body !== 'string' || input.body.trim().length === 0 || input.body.length > 4000) return { outcome: 'REFUSED', code: 'INVALID_ARGS', messageId: null, threadId: t.id };
  // m-20: the model-authored brief is scanned (serialized) like the body it accompanies.
  if (containsSecretMaterial(input.body) || (typeof input.brief === 'object' && input.brief !== null && containsSecretMaterial(JSON.stringify(input.brief)))) return { outcome: 'REFUSED', code: 'SECRET_MATERIAL', messageId: null, threadId: t.id };
  if ((input.purpose === 'BRIEF') !== (input.brief !== null)) return { outcome: 'REFUSED', code: 'BRIEF_SHAPE', messageId: null, threadId: t.id };
  if (input.purpose === 'BRIEF' && t.kind !== 'CEO_BRIEF' && t.kind !== 'FOUNDER_CEO') return { outcome: 'REFUSED', code: 'BRIEF_NOT_CEO', messageId: null, threadId: t.id };
  // One message per (Work Item, purpose, body hash): a resumed run never posts twice.
  const dup = ctx.db.get<{ id: string }>('SELECT id FROM communication_messages WHERE thread_id = ? AND run_id IN (SELECT id FROM runs WHERE work_item_id = ?) AND body_sha256 = ?', t.id, item.id, sha256Hex(input.body));
  if (dup) return { outcome: 'RECORDED', code: 'REPLAYED', messageId: dup.id as Id, threadId: t.id };
  const level = input.brief !== null ? briefAttentionLevel(input.brief) : input.attentionLevel;
  const responseRequired = input.purpose === 'DECISION_REQUEST' || input.purpose === 'ESCALATION' || (input.brief?.decisionNeeded ?? false);
  const m = insertMessage(ctx, t, { senderKind: 'EMPLOYEE', senderRef: employeeRef, purpose: input.purpose, level, body: input.body, brief: input.brief, responseRequired, replyWorkItemId: null, runId: fence.runId, contextRefsJson: contextRefs(input.contextRefs) });
  return { outcome: 'RECORDED', code: 'RECORDED', messageId: m.id, threadId: t.id };
}

function pendingRepliesOf(ctx: StoreContext): { messageId: Id; threadId: Id; replyWorkItemId: Id; workItemState: string; since: Timestamp }[] {
  return ctx.db
    .all<{ id: string; thread_id: string; reply_work_item_id: string; state: string; created_at: string }>(
      `SELECT m.id, m.thread_id, m.reply_work_item_id, w.state, m.created_at FROM communication_messages m JOIN work_items w ON w.id = m.reply_work_item_id
       WHERE m.sender_kind = 'FOUNDER' AND m.reply_work_item_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM communication_messages r JOIN runs x ON x.id = r.run_id WHERE r.thread_id = m.thread_id AND r.seq > m.seq AND x.work_item_id = m.reply_work_item_id)
       ORDER BY m.created_at, m.id`,
    )
    .map((r) => ({ messageId: r.id as Id, threadId: r.thread_id as Id, replyWorkItemId: r.reply_work_item_id as Id, workItemState: r.state, since: r.created_at as Timestamp }));
}

/** The class a reply will start at — the chosen level, else the Employee default, lifted to the route minimum (its bounds only). */
function replyClass(ctx: StoreContext, e: EmployeeRecord, taskClass: string, chosen: ReasoningClass | null): 'E1' | 'E2' | 'E3' | 'E4' {
  const base = chosen ?? assertCognitiveProfile(e.cognitiveProfile).defaultClass;
  const policy = routingSnapshotTx(ctx, taskClass).policy;
  const cls = policy ? effectiveClass({ reasoningClass: base }, policy) : base;
  return cls === 'E0' ? 'E1' : cls;
}

/**
 * P1-CHAT-INTEL-01: the truthful state of one Founder message's reply, derived from canonical execution state (the reply
 * Work Item, its newest queue job and run, and the thread). Never "thinking" for work that ended: a FAILED, BLOCKED or
 * CANCELLED reply says so, with its code, and is never retried here. Codes and IDs only, plus the reply's own money.
 */
export type ReplyStatus = 'QUEUED' | 'RUNNING' | 'WAITING_FOR_BUDGET' | 'WAITING' | 'BLOCKED' | 'FAILED' | 'CANCELLED' | 'REPLIED';

export interface ReplyState {
  readonly messageId: Id;
  readonly replyWorkItemId: Id;
  readonly status: ReplyStatus;
  /** The canonical reason code (a failure, block, wait or retry code), or null. */
  readonly reasonCode: string | null;
  readonly workItemState: string;
  readonly jobState: string | null;
  readonly attempts: number;
  readonly replyMessageId: Id | null;
  /** The Founder's per-message level (the durable override), or null when the reply runs at the Employee default. */
  readonly requestedClass: string | null;
  /** The classes that actually answered (usage evidence), oldest first. */
  readonly answeredClasses: readonly string[];
  readonly calls: number;
  readonly currency: string | null;
  /** The reply's own hard cap, what is held for a call in flight, and what was actually spent (economic / billed). */
  readonly capMoney: number;
  readonly reservedMoney: number;
  readonly spentMoney: number;
  readonly billedMicros: number;
  readonly updatedAt: string;
}

export function txReplyStates(ctx: StoreContext, threadId: Id, messageIds: readonly Id[] | null = null): ReplyState[] {
  const rows = ctx.db.all<{ id: string; seq: number; reply_work_item_id: string; state: string; blocked_reason: string | null; updated_at: string }>(
    `SELECT m.id, m.seq, m.reply_work_item_id, w.state, w.blocked_reason, w.updated_at FROM communication_messages m JOIN work_items w ON w.id = m.reply_work_item_id
      WHERE m.thread_id = ? AND m.sender_kind = 'FOUNDER' AND m.reply_work_item_id IS NOT NULL ORDER BY m.seq`,
    threadId,
  );
  const wanted = messageIds === null ? null : new Set<string>(messageIds);
  return rows.filter((r) => wanted === null || wanted.has(r.id)).map((r) => {
    const wi = r.reply_work_item_id as Id;
    const reply = ctx.db.get<{ id: string }>('SELECT r.id FROM communication_messages r JOIN runs x ON x.id = r.run_id WHERE r.thread_id = ? AND x.work_item_id = ? ORDER BY r.seq LIMIT 1', threadId, wi);
    const job = ctx.db.get<{ state: string; wait_reason: string | null; dead_letter_reason: string | null; last_failure_code: string | null; attempt_count: number }>(
      'SELECT state, wait_reason, dead_letter_reason, last_failure_code, attempt_count FROM queue_jobs WHERE work_item_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', wi,
    );
    const run = ctx.db.get<{ failure_code: string | null }>('SELECT failure_code FROM runs WHERE work_item_id = ? ORDER BY started_at DESC, attempt DESC LIMIT 1', wi);
    let status: ReplyStatus;
    let reasonCode: string | null = null;
    if (reply) status = 'REPLIED';
    else if (r.state === 'FAILED') [status, reasonCode] = ['FAILED', run?.failure_code ?? job?.last_failure_code ?? null];
    else if (r.state === 'COMPLETED' || r.state === 'REVIEWED' || r.state === 'OUTCOME_VERIFIED' || r.state === 'CLOSED') [status, reasonCode] = ['FAILED', 'COMPLETED_WITHOUT_REPLY'];
    else if (r.state === 'CANCELLED' || r.state === 'SUPERSEDED') status = 'CANCELLED';
    else if (r.state === 'BLOCKED' || job?.state === 'DEAD_LETTER' || job?.state === 'RECONCILIATION_HOLD') [status, reasonCode] = ['BLOCKED', r.blocked_reason ?? job?.dead_letter_reason ?? job?.last_failure_code ?? job?.state ?? null];
    else if (job?.state === 'WAITING' && job.wait_reason === 'BUDGET_EXHAUSTED') [status, reasonCode] = ['WAITING_FOR_BUDGET', 'BUDGET_EXHAUSTED'];
    else if (job?.state === 'WAITING' || r.state.startsWith('WAITING')) [status, reasonCode] = ['WAITING', job?.wait_reason ?? r.state];
    else if (job?.state === 'CLAIMED' || r.state === 'IN_PROGRESS' || r.state === 'ASSIGNED') status = 'RUNNING';
    else [status, reasonCode] = ['QUEUED', job !== undefined && job.attempt_count > 0 ? (job.last_failure_code ?? 'RETRY_SCHEDULED') : null];
    const requested = ctx.db.get<{ c: string }>('SELECT reasoning_class AS c FROM work_item_reasoning_overrides WHERE work_item_id = ?', wi)?.c ?? null;
    const answered = ctx.db.all<{ c: string }>('SELECT d.reasoning_class AS c FROM usage_records u JOIN deployments d ON d.id = u.deployment_id WHERE u.work_item_id = ? ORDER BY u.created_at, u.id', wi).map((x) => x.c);
    const usage = ctx.db.get<{ n: number; billed: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(billed_micros), 0) AS billed FROM usage_records WHERE work_item_id = ?', wi);
    const budget = ctx.db.get<{ currency: string; cap_money: number; reserved_money: number; spent_money: number }>(`SELECT currency, cap_money, reserved_money, spent_money FROM budgets WHERE scope = 'WORK_ITEM' AND scope_id = ? ORDER BY created_at DESC LIMIT 1`, wi);
    return {
      messageId: r.id as Id, replyWorkItemId: wi, status, reasonCode, workItemState: r.state, jobState: job?.state ?? null, attempts: Number(job?.attempt_count ?? 0),
      replyMessageId: reply ? (reply.id as Id) : null, requestedClass: requested, answeredClasses: answered, calls: Number(usage?.n ?? 0),
      currency: budget?.currency ?? null, capMoney: Number(budget?.cap_money ?? 0), reservedMoney: Number(budget?.reserved_money ?? 0), spentMoney: Number(budget?.spent_money ?? 0), billedMicros: Number(usage?.billed ?? 0),
      updatedAt: r.updated_at,
    };
  });
}

/** P1-CHAT-INTEL-01: one page of a thread, oldest first, ending before `beforeSeq` (the newest page when omitted). */
export function txMessagesPage(ctx: StoreContext, threadId: Id, opts: { beforeSeq?: number | null; limit?: number | null } = {}): { messages: MessageRecord[]; hasOlder: boolean } {
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? 50)), 200);
  const before = opts.beforeSeq === undefined || opts.beforeSeq === null ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.trunc(opts.beforeSeq));
  const rows = ctx.db.all('SELECT * FROM communication_messages WHERE thread_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?', threadId, before, limit + 1);
  return { messages: rows.slice(0, limit).reverse().map(mapMessage), hasOlder: rows.length > limit };
}

export class CommunicationStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): CommunicationStore {
    return new CommunicationStore(store);
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  #admin<T>(operation: string, actorRef: string, fn: (ctx: StoreContext) => T): T {
    return founderAdminWrite(this.#store, operation, actorRef, fn);
  }

  openThread(actorRef: string, input: OpenThreadInput): ThreadRecord {
    return this.#admin('open thread', actorRef, (ctx) => txOpenThread(ctx, input, founder(ctx, actorRef, null, 'founder communication').ref));
  }

  /** Reuses the open direct thread with an Employee (or the CEO) without a context, else opens one. */
  directThread(actorRef: string, employeeId: string | null): ThreadRecord {
    return this.#admin('direct thread', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'founder communication');
      const kind: ThreadKind = employeeId === null ? 'FOUNDER_CEO' : 'FOUNDER_EMPLOYEE';
      const target = employeeId === null ? ceoHolderId(ctx) : assertId(employeeId, 'employeeId');
      const existing = ctx.db.get(`SELECT * FROM communication_threads WHERE kind = ? AND employee_id = ? AND context_kind IS NULL AND state = 'OPEN' ORDER BY created_at DESC LIMIT 1`, kind, target);
      if (existing) return mapThread(existing);
      const e = getEmployeeRow(ctx, target);
      return txOpenThread(ctx, { kind, employeeId: target, subject: employeeId === null ? 'Founder ↔ CEO' : `Founder ↔ ${e.name.given} ${e.name.family}` }, p.ref);
    });
  }

  send(actorRef: string, threadId: string, input: FounderSendInput): { message: MessageRecord; replyWorkItemId: Id | null; replayed?: boolean } {
    return this.#admin('founder message', actorRef, (ctx) => txFounderSend(ctx, assertId(threadId, 'threadId'), input, founder(ctx, actorRef, null, 'founder communication').ref));
  }

  /**
   * A proactive CEO brief (Stage 9 §17, §10.1): requested by the runtime-side attention policy on a durable
   * signal, not by the Founder — so it is a system write, not a Founder-authority act. The CEO's own governed
   * run produces the brief; this only creates that Work Item (funded from the CEO's envelope) and its thread.
   */
  requestCeoBrief(input: Parameters<typeof txRequestCeoBrief>[1], actorRef = 'system:founder-surface'): { thread: ThreadRecord; workItemId: Id; replayed: boolean } {
    const ctx = storeContext(this.#store);
    return ctx.db.immediate('request ceo brief', () => txRequestCeoBrief(ctx, input, boundedText(actorRef, 'actorRef', 161)));
  }

  closeThread(actorRef: string, threadId: string, reasonCode: string): ThreadRecord {
    return this.#admin('close thread', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'founder communication');
      const t = getThread(ctx, assertId(threadId, 'threadId'));
      if (t.state === 'CLOSED') return t;
      ctx.db.run(`UPDATE communication_threads SET state = 'CLOSED', version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, ts(ctx), t.id, t.version);
      appendAudit(ctx, 'communication.thread_closed', 'thread', t.id, { actorRef: p.ref }, 'OK', assertCode(reasonCode, 'reasonCode'), {});
      return getThread(ctx, t.id);
    });
  }

  thread(id: Id): ThreadRecord {
    return this.#read((ctx) => getThread(ctx, id));
  }

  threads(filter: { employeeId?: Id; kind?: ThreadKind; state?: 'OPEN' | 'CLOSED'; contextRef?: string } = {}): ThreadRecord[] {
    return this.#read((ctx) =>
      ctx.db
        .all('SELECT * FROM communication_threads ORDER BY updated_at DESC, id')
        .map(mapThread)
        .filter((t) => (filter.employeeId === undefined || t.employeeId === filter.employeeId) && (filter.kind === undefined || t.kind === filter.kind) && (filter.state === undefined || t.state === filter.state) && (filter.contextRef === undefined || t.contextRef === filter.contextRef)),
    );
  }

  message(id: Id): MessageRecord {
    return this.#read((ctx) => {
      const r = ctx.db.get('SELECT * FROM communication_messages WHERE id = ?', id);
      if (!r) throw new QandeelError('NOT_FOUND', 'message not found', { messageId: id });
      return mapMessage(r);
    });
  }

  /** Messages with bodies: Founder-scoped company content (never telemetry). */
  messages(threadId: Id): MessageRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM communication_messages WHERE thread_id = ? ORDER BY seq', threadId).map(mapMessage));
  }

  /** P1-CHAT-INTEL-01: one page of the conversation, oldest first (older pages through `beforeSeq`; nothing is lost). */
  messagesPage(threadId: Id, opts: { beforeSeq?: number | null; limit?: number | null } = {}): { messages: MessageRecord[]; hasOlder: boolean } {
    return this.#read((ctx) => {
      getThread(ctx, threadId);
      return txMessagesPage(ctx, threadId, opts);
    });
  }

  /** P1-CHAT-INTEL-01: the truthful state of each Founder message's reply in this thread (or of the given messages). */
  replyStates(threadId: Id, messageIds: readonly Id[] | null = null): ReplyState[] {
    return this.#read((ctx) => txReplyStates(ctx, threadId, messageIds));
  }

  /** Content-free message metadata (IDs, purposes, levels, hashes) for health, tests and telemetry. */
  messageMeta(threadId: Id): MessageMeta[] {
    return this.messages(threadId).map(messageMeta);
  }

  /** Founder messages still waiting for their reply Work Item to answer (durable pending requests, Stage 9 §32). */
  pendingReplies(): { messageId: Id; threadId: Id; replyWorkItemId: Id; workItemState: string; since: Timestamp }[] {
    return this.#read((ctx) => pendingRepliesOf(ctx));
  }

  health(): { threads: number; openThreads: number; messages: number; founderMessages: number; employeeMessages: number; briefs: number; pendingReplies: number } {
    return this.#read((ctx) => {
      const n = (sql: string): number => Number(ctx.db.get<{ n: number }>(sql)?.n ?? 0);
      return {
        threads: n('SELECT COUNT(*) AS n FROM communication_threads'),
        openThreads: n(`SELECT COUNT(*) AS n FROM communication_threads WHERE state = 'OPEN'`),
        messages: n('SELECT COUNT(*) AS n FROM communication_messages'),
        founderMessages: n(`SELECT COUNT(*) AS n FROM communication_messages WHERE sender_kind = 'FOUNDER'`),
        employeeMessages: n(`SELECT COUNT(*) AS n FROM communication_messages WHERE sender_kind = 'EMPLOYEE'`),
        briefs: n(`SELECT COUNT(*) AS n FROM communication_messages WHERE purpose = 'BRIEF'`),
        pendingReplies: pendingRepliesOf(ctx).length,
      };
    });
  }
}

/**
 * L1-02: a Founder-facing reply or brief of an Employee that holds certified / trained Skills declares its role's retrieval
 * topics (never a requirement, never a gate), so the Employee's own pinned role Skills are relevant to its conversation with
 * the Founder whatever words the Founder used. An Employee without passport Skills is unchanged.
 */
function declareRoleTopics(ctx: StoreContext, workItemId: Id, employeeId: Id, roleRef: string): void {
  if (!ctx.db.get(`SELECT 1 AS x FROM passport_entries WHERE employee_id = ? AND status = 'ACTIVE'`, employeeId)) return;
  const tail = roleRef.slice(5).split('.').at(-1) ?? 'role';
  txDeclareRequirements(ctx, workItemId, { requirements: [], topics: [tail, 'founder'] });
}
