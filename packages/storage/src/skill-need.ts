/**
 * G4-C2-SNA-01 (D-P1-15) — Skill Need Assessment (SNA): the durable link between a Founder reply and the one governed
 * classification that decides, before the reply's context is assembled, how much the reply needs each eligible Skill.
 *
 * - The send (one transaction): a Founder reply whose Employee holds eligible Skills with a need card opens a small
 *   assessment Work Item (a child of the reply; its own task class, E1 pin, one model call, its own cap from the Employee
 *   envelope) and makes the reply's job available only after the dependency window — no worker waits. Without the task
 *   class's route policy or the Employee's model access for it, the send seals the conservative fallback instead.
 * - The assessment (its own fenced run) records exactly one result — a classification bound to the offered Skills, or a
 *   fallback with its cause — and makes the reply's job available at once.
 * - The reply's Context Assembly reads the decision; with none yet, it seals the fallback itself (window passed, or the
 *   assessment ended without a result). The first writer wins: a late result never replaces a decision the reply planned.
 *
 * The decision orders and protects context space only. Eligibility, certification, conflicts, authority, privacy and the
 * budgets are decided where they always were and are never widened by it. Records are content-free (Rule A).
 */
import { QandeelError, newId, sha256Hex, type Id } from '@qandeel-company/domain';
import {
  SKILL_NEED_CAP,
  SKILL_NEED_CONTEXT_BUDGET_TOKENS,
  SKILL_NEED_MAX_OUTPUT_TOKENS,
  SKILL_NEED_POLICY,
  SKILL_NEED_PREAMBLE_SHA256,
  SKILL_NEED_PROMPT_VERSION,
  SKILL_NEED_TASK_CLASS,
  SKILL_NEED_WINDOW_MS,
  checkSkillNeed,
  isSkillNeedOutcome,
  isSkillNeedTier,
  type SkillNeedOutcome,
  type SkillNeedProposal,
  type SkillNeedTier,
} from '@qandeel-company/governance';
import { SKILL_NEED_CARDS_VERSION, SKILL_NEED_FALLBACK_TIER, hasSkillNeedCard, orderedSkillNeedCodes, skillNeedCardsDigest } from '@qandeel-company/mind';

import { txAllocateWorkItemBudget } from './governance-core.js';
import type { EmployeeRecord } from './governance-records.js';
import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { getSkillVersionMeta, versionEligibility } from './mind-core.js';
import { mapPassport } from './mind-records.js';
import { verifyFence } from './queue.js';
import type { Fence, WorkItemRecord } from './records.js';
import { storeContext, type CompanyStore } from './store.js';
import { applyTransition, enqueueJob, futureTimestamp } from './work-core.js';
import { txCreateWorkItem } from './work-items.js';

/** The processor kind of an assessment Work Item (registered by the runtime next to the Employee loop). */
export const SKILL_NEED_ASSESSMENT_KIND = 'c2.skill-need-assessment';
/** The assessment's job runs before ordinary work (the reply waits on it). */
export const SKILL_NEED_PRIORITY = 70;

export interface OfferedSkill {
  readonly code: string;
  readonly skillVersionId: Id;
}

/** The assessment Work Item's binding (its processor input): ids, hashes and versions only. */
export interface SkillNeedBinding {
  readonly policy: string;
  readonly replyWorkItemId: Id;
  readonly threadId: Id;
  readonly messageId: Id;
  readonly messageSha256: string;
  readonly offered: readonly OfferedSkill[];
  readonly cardsVersion: string;
  readonly cardsSha256: string;
  readonly promptVersion: string;
  readonly promptSha256: string;
}

export interface SkillNeedRecord {
  readonly id: Id;
  readonly replyWorkItemId: Id;
  readonly assessmentWorkItemId: Id | null;
  readonly employeeId: Id;
  readonly messageId: Id;
  readonly messageSha256: string;
  readonly policy: string;
  readonly promptVersion: string | null;
  readonly promptSha256: string | null;
  readonly cardsVersion: string;
  readonly cardsSha256: string;
  readonly offered: readonly OfferedSkill[];
  readonly source: 'MODEL' | 'FALLBACK';
  readonly outcome: SkillNeedOutcome;
  readonly tiers: Readonly<Record<string, SkillNeedTier>>;
  readonly runId: Id | null;
  readonly manifestId: Id | null;
  readonly sealedBy: 'SEND' | 'ASSESSMENT' | 'REPLY';
  readonly createdAt: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const isId = (v: unknown): v is Id => typeof v === 'string' && v.length === 36;

/** The eligible Skills with a need card an Employee holds now (metadata only — never a payload), in declared order. */
export function txOfferedSkills(ctx: StoreContext, employeeId: Id): OfferedSkill[] {
  const out = new Map<string, OfferedSkill>();
  for (const pe of ctx.db.all('SELECT * FROM passport_entries WHERE employee_id = ? ORDER BY skill_id', employeeId).map(mapPassport)) {
    if (pe.status !== 'ACTIVE') continue;
    const skill = ctx.db.get<{ code: string; status: string }>('SELECT code, status FROM skills WHERE id = ?', pe.skillId);
    if (!skill || skill.status !== 'ACTIVE' || !hasSkillNeedCard(skill.code) || out.has(skill.code)) continue;
    const v = getSkillVersionMeta(ctx, pe.skillVersionId);
    if (!versionEligibility(ctx, v).eligible) continue;
    out.set(skill.code, { code: skill.code, skillVersionId: v.id });
  }
  return orderedSkillNeedCodes([...out.keys()]).map((c) => out.get(c) as OfferedSkill);
}

/**
 * Whether an assessment can run for this Employee: the task class has an ACTIVE route policy and the Employee holds an
 * ACTIVE, unexpired, unexhausted `model.invoke` grant covering it. The authorization is re-checked by the call itself;
 * this only avoids opening work that could never run.
 */
export function txSkillNeedProvisioned(ctx: StoreContext, employeeId: Id): boolean {
  if (!ctx.db.get(`SELECT 1 AS x FROM route_policies WHERE task_class = ? AND status = 'ACTIVE'`, SKILL_NEED_TASK_CLASS)) return false;
  return ctx.db.get(
    `SELECT 1 AS x FROM permission_grants WHERE employee_id = ? AND capability = 'model.invoke' AND status = 'ACTIVE' AND resource_scope IN (?, '*')
       AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses) LIMIT 1`,
    employeeId, SKILL_NEED_TASK_CLASS, ts(ctx),
  ) !== undefined;
}

/** What the send decides before it enqueues the reply: the offer and whether the reply waits for an assessment. */
export interface SkillNeedPlan {
  readonly offered: readonly OfferedSkill[];
  readonly assess: boolean;
}

export function txPlanSkillNeed(ctx: StoreContext, employeeId: Id): SkillNeedPlan {
  const offered = txOfferedSkills(ctx, employeeId);
  return { offered, assess: offered.length > 0 && txSkillNeedProvisioned(ctx, employeeId) };
}

/** When a reply that waits for an assessment may start at the latest (its job's availability). */
export const skillNeedReplyAvailableAt = (ctx: StoreContext): ReturnType<typeof futureTimestamp> => futureTimestamp(ctx, SKILL_NEED_WINDOW_MS);

const offeredCodes = (offered: readonly OfferedSkill[]): string[] => offered.map((o) => o.code);
const fallbackTiers = (offered: readonly OfferedSkill[]): Record<string, SkillNeedTier> => Object.fromEntries(offeredCodes(offered).map((c) => [c, SKILL_NEED_FALLBACK_TIER]));

/**
 * After the reply and its message exist (same send transaction): opens the assessment, or — when it cannot run — seals the
 * fallback (NOT_PROVISIONED). Nothing happens for an Employee without an offered Skill (the legacy lexical path).
 */
export function txOpenSkillNeed(ctx: StoreContext, e: EmployeeRecord, reply: WorkItemRecord, plan: SkillNeedPlan, m: { readonly threadId: Id; readonly messageId: Id; readonly body: string; readonly actorRef: string }): Id | null {
  if (plan.offered.length === 0) return null;
  const messageSha256 = sha256Hex(m.body);
  const binding: SkillNeedBinding = {
    policy: SKILL_NEED_POLICY,
    replyWorkItemId: reply.id,
    threadId: m.threadId,
    messageId: m.messageId,
    messageSha256,
    offered: plan.offered,
    cardsVersion: SKILL_NEED_CARDS_VERSION,
    cardsSha256: skillNeedCardsDigest(offeredCodes(plan.offered)),
    promptVersion: SKILL_NEED_PROMPT_VERSION,
    promptSha256: SKILL_NEED_PREAMBLE_SHA256,
  };
  if (!plan.assess) {
    insertRecord(ctx, binding, e.id, null, { source: 'FALLBACK', outcome: 'NOT_PROVISIONED', tiers: fallbackTiers(plan.offered), runId: null, manifestId: null, sealedBy: 'SEND', withPrompt: false });
    return null;
  }
  const created = txCreateWorkItem(
    ctx,
    {
      objective: `Assess the Skill need of Founder message ${m.messageId} (reply ${reply.id})`,
      ownerRef: e.ref,
      riskLevel: 'R1',
      priority: SKILL_NEED_PRIORITY,
      processorKind: SKILL_NEED_ASSESSMENT_KIND,
      // The binding names the message (id + hash) and the offered Skill versions; the text is read only by the assessment's
      // own Context Assembly. No founderThreadId: an assessment is never a thread reply (it can never post a message).
      processorInput: {
        taskClass: SKILL_NEED_TASK_CLASS,
        dataClass: 'D2',
        reasoningClass: 'E1',
        maxOutputTokens: SKILL_NEED_MAX_OUTPUT_TOKENS,
        maxModelCalls: 1,
        contextBudgetTokens: SKILL_NEED_CONTEXT_BUDGET_TOKENS,
        instructions: 'Assess the Skill need of one Founder message (SKILL_NEED output only).',
        skillNeedAssessment: binding as unknown as Record<string, never>,
      },
      parentId: reply.id,
      dedupeKey: `skill-need:${m.messageId}`,
      initialState: 'PROPOSED',
    },
    { actorRef: m.actorRef },
  );
  const sna = created.workItem;
  txAllocateWorkItemBudget(ctx, sna.id, e.id, { money: SKILL_NEED_CAP.money, tokens: SKILL_NEED_CAP.tokens }, m.actorRef, 'skill_need.assessment');
  const ready = applyTransition(ctx, sna, 'READY', { reasonCode: 'skill_need.assessment', trace: { correlationId: sna.correlationId, actorRef: m.actorRef } });
  enqueueJob(ctx, ready, { correlationId: ready.correlationId, actorRef: m.actorRef });
  appendAudit(ctx, 'skill_need.opened', 'work_item', sna.id, { actorRef: m.actorRef, correlationId: sna.correlationId }, 'OK', null, { replyWorkItemId: reply.id, offered: plan.offered.length });
  return sna.id;
}

/** The assessment binding of a Work Item (its processor input), or null for any other Work Item. Never trusts a shape. */
export function skillNeedBindingOf(item: WorkItemRecord): SkillNeedBinding | null {
  const b = (item.processorInput as { skillNeedAssessment?: unknown } | null)?.skillNeedAssessment as Partial<SkillNeedBinding> | undefined;
  if (item.processorKind !== SKILL_NEED_ASSESSMENT_KIND || typeof b !== 'object' || b === null) return null;
  if (b.policy !== SKILL_NEED_POLICY || !isId(b.replyWorkItemId) || !isId(b.threadId) || !isId(b.messageId) || typeof b.messageSha256 !== 'string' || !HEX64.test(b.messageSha256)) return null;
  if (typeof b.cardsVersion !== 'string' || typeof b.cardsSha256 !== 'string' || !HEX64.test(b.cardsSha256) || typeof b.promptVersion !== 'string' || typeof b.promptSha256 !== 'string' || !HEX64.test(b.promptSha256)) return null;
  if (!Array.isArray(b.offered) || b.offered.length === 0 || b.offered.some((o) => typeof o?.code !== 'string' || !hasSkillNeedCard(o.code) || !isId(o.skillVersionId))) return null;
  return b as SkillNeedBinding;
}

/** The reply's marker: a Founder reply created with Skill Need Assessment (CP-1 order, SNA tiers). */
export function replySkillNeedOf(item: WorkItemRecord): { readonly policy: string } | null {
  const v = (item.processorInput as { skillNeed?: unknown } | null)?.skillNeed as { policy?: unknown } | undefined;
  return typeof v === 'object' && v !== null && v.policy === SKILL_NEED_POLICY ? { policy: SKILL_NEED_POLICY } : null;
}

function mapRecord(r: Record<string, unknown>): SkillNeedRecord {
  const tiers = JSON.parse(String(r.tiers_json)) as Record<string, unknown>;
  const outcome = String(r.outcome);
  if (!isSkillNeedOutcome(outcome) || Object.values(tiers).some((t) => !isSkillNeedTier(t))) throw new QandeelError('STORAGE_INVARIANT', 'a skill need record holds an unknown code', { recordId: String(r.id) });
  return {
    id: String(r.id) as Id,
    replyWorkItemId: String(r.reply_work_item_id) as Id,
    assessmentWorkItemId: (r.assessment_work_item_id as Id | null) ?? null,
    employeeId: String(r.employee_id) as Id,
    messageId: String(r.message_id) as Id,
    messageSha256: String(r.message_sha256),
    policy: String(r.policy),
    promptVersion: (r.prompt_version as string | null) ?? null,
    promptSha256: (r.prompt_sha256 as string | null) ?? null,
    cardsVersion: String(r.cards_version),
    cardsSha256: String(r.cards_sha256),
    offered: JSON.parse(String(r.offered_json)) as OfferedSkill[],
    source: r.source === 'MODEL' ? 'MODEL' : 'FALLBACK',
    outcome,
    tiers: tiers as Record<string, SkillNeedTier>,
    runId: (r.run_id as Id | null) ?? null,
    manifestId: (r.manifest_id as Id | null) ?? null,
    sealedBy: r.sealed_by === 'SEND' ? 'SEND' : r.sealed_by === 'REPLY' ? 'REPLY' : 'ASSESSMENT',
    createdAt: String(r.created_at),
  };
}

export function txSkillNeedRecord(ctx: StoreContext, replyWorkItemId: Id): SkillNeedRecord | null {
  const r = ctx.db.get('SELECT * FROM skill_need_assessments WHERE reply_work_item_id = ?', replyWorkItemId);
  return r ? mapRecord(r) : null;
}

function insertRecord(
  ctx: StoreContext,
  b: SkillNeedBinding,
  employeeId: Id,
  assessmentWorkItemId: Id | null,
  d: { source: 'MODEL' | 'FALLBACK'; outcome: SkillNeedOutcome; tiers: Record<string, SkillNeedTier>; runId: Id | null; manifestId: Id | null; sealedBy: 'SEND' | 'ASSESSMENT' | 'REPLY'; withPrompt: boolean },
): SkillNeedRecord {
  const id = newId();
  ctx.db.run(
    `INSERT INTO skill_need_assessments (id, reply_work_item_id, assessment_work_item_id, employee_id, message_id, message_sha256, policy, prompt_version, prompt_sha256, cards_version, cards_sha256, offered_json, source, outcome, tiers_json, run_id, manifest_id, sealed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, b.replyWorkItemId, assessmentWorkItemId, employeeId, b.messageId, b.messageSha256, b.policy,
    d.withPrompt ? b.promptVersion : null, d.withPrompt ? b.promptSha256 : null, b.cardsVersion, b.cardsSha256,
    JSON.stringify(b.offered.map((o) => ({ code: o.code, skillVersionId: o.skillVersionId }))), d.source, d.outcome,
    JSON.stringify(Object.fromEntries(Object.keys(d.tiers).sort().map((c) => [c, d.tiers[c]]))), d.runId, d.manifestId, d.sealedBy, ts(ctx),
  );
  const counts = { TASK_REQUIRED: 0, SUPPORTING: 0, NON_RELEVANT: 0 };
  for (const t of Object.values(d.tiers)) counts[t]++;
  appendAudit(ctx, 'skill_need.recorded', 'work_item', b.replyWorkItemId, { actorRef: 'system:skill-need' }, 'OK', d.outcome, { source: d.source, sealedBy: d.sealedBy, offered: b.offered.length, required: counts.TASK_REQUIRED, supporting: counts.SUPPORTING, nonRelevant: counts.NON_RELEVANT });
  return txSkillNeedRecord(ctx, b.replyWorkItemId) as SkillNeedRecord;
}

/** The reply's job is due now (the decision exists): a QUEUED job waiting for its window becomes available at once. */
function releaseReply(ctx: StoreContext, replyWorkItemId: Id): void {
  const at = ts(ctx);
  ctx.db.run(`UPDATE queue_jobs SET available_at = ?, updated_at = ? WHERE work_item_id = ? AND state = 'QUEUED' AND available_at > ?`, at, at, replyWorkItemId, at);
}

/** What the assessment's own run sees before it calls: whether a call is still useful. */
export interface SkillNeedAssessmentState {
  readonly binding: SkillNeedBinding;
  /** A decision exists already (sealed by the send, the reply or an earlier run): no call. */
  readonly decided: boolean;
  /** The reply ended (cancelled, failed, superseded, done): no call. */
  readonly replyEnded: boolean;
}

const TERMINAL = new Set(['COMPLETED', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED', 'FAILED', 'CANCELLED', 'SUPERSEDED']);

function assessmentOf(ctx: StoreContext, fence: Fence): { item: WorkItemRecord; binding: SkillNeedBinding; employeeId: Id } {
  const job = verifyFence(ctx, fence);
  const a = ctx.db.get<{ employee_id: string; work_item_id: string }>('SELECT employee_id, work_item_id FROM run_attributions WHERE run_id = ?', fence.runId);
  if (!a || a.work_item_id !== job.workItemId) throw new QandeelError('AUTHORITY_DENIED', 'the run was not attributed to an eligible employee', { runId: fence.runId, reason: 'RUN_NOT_ATTRIBUTED' });
  const item = getWorkItemRow(ctx, job.workItemId);
  const binding = skillNeedBindingOf(item);
  if (binding === null || item.parentId !== binding.replyWorkItemId) throw new QandeelError('VALIDATION_FAILED', 'this run is not a Skill Need Assessment', { workItemId: item.id, reason: 'NOT_SKILL_NEED_ASSESSMENT' });
  return { item, binding, employeeId: a.employee_id as Id };
}

export function txSkillNeedAssessmentState(ctx: StoreContext, fence: Fence): SkillNeedAssessmentState {
  const { binding } = assessmentOf(ctx, fence);
  return { binding, decided: txSkillNeedRecord(ctx, binding.replyWorkItemId) !== null, replyEnded: TERMINAL.has(getWorkItemRow(ctx, binding.replyWorkItemId).state) };
}

export type RecordSkillNeedInput =
  /** The model answered with a SKILL_NEED proposal through this run's governed call (its OK manifest). */
  | { readonly kind: 'PROPOSAL'; readonly proposal: SkillNeedProposal; readonly manifestId: Id }
  /** No valid answer: the fallback with its cause (never CLASSIFIED, never a reply-side code). */
  | { readonly kind: 'FALLBACK'; readonly outcome: SkillNeedOutcome };

export type RecordSkillNeedResult = { readonly recorded: true; readonly record: SkillNeedRecord } | { readonly recorded: false; readonly code: 'ALREADY_DECIDED'; readonly record: SkillNeedRecord };

const ASSESSMENT_FALLBACKS: ReadonlySet<SkillNeedOutcome> = new Set(['OUTPUT_INVALID', 'OUTPUT_TRUNCATED', 'ACCESS_DENIED', 'BUDGET_REFUSED', 'CONTEXT_REFUSED', 'CIRCUIT_OPEN', 'PROVIDER_UNAVAILABLE', 'PROVIDER_FAILED', 'PROVIDER_UNCERTAIN', 'RUN_LIMIT']);

/**
 * The assessment's one durable result, written by its own fenced run. A proposal is bound to exactly the offered Skills
 * (`checkSkillNeed`): an unknown or missing code refuses the whole answer, which is then recorded as OUTPUT_INVALID. The
 * manifest must be this run's own OK manifest. A decision that already exists is never replaced (a late result).
 */
export function txRecordSkillNeed(ctx: StoreContext, fence: Fence, input: RecordSkillNeedInput): RecordSkillNeedResult {
  const { item, binding, employeeId } = assessmentOf(ctx, fence);
  const existing = txSkillNeedRecord(ctx, binding.replyWorkItemId);
  if (existing !== null) {
    appendAudit(ctx, 'skill_need.late', 'work_item', item.id, { actorRef: 'system:skill-need' }, 'REJECTED', 'ALREADY_DECIDED', { replyWorkItemId: binding.replyWorkItemId });
    return { recorded: false, code: 'ALREADY_DECIDED', record: existing };
  }
  let record: SkillNeedRecord;
  if (input.kind === 'PROPOSAL') {
    const m = ctx.db.get<{ run_id: string; outcome: string; work_item_id: string }>('SELECT run_id, outcome, work_item_id FROM context_manifests WHERE id = ?', input.manifestId);
    if (!m || m.run_id !== fence.runId || m.outcome !== 'OK' || m.work_item_id !== item.id) throw new QandeelError('VALIDATION_FAILED', 'a classification is bound to this run\'s own assembled context', { field: 'manifestId', reason: 'MANIFEST_NOT_OF_RUN' });
    const check = checkSkillNeed(input.proposal, offeredCodes(binding.offered));
    record = check.ok
      ? insertRecord(ctx, binding, employeeId, item.id, { source: 'MODEL', outcome: 'CLASSIFIED', tiers: { ...check.tiers }, runId: fence.runId, manifestId: input.manifestId, sealedBy: 'ASSESSMENT', withPrompt: true })
      : insertRecord(ctx, binding, employeeId, item.id, { source: 'FALLBACK', outcome: 'OUTPUT_INVALID', tiers: fallbackTiers(binding.offered), runId: fence.runId, manifestId: input.manifestId, sealedBy: 'ASSESSMENT', withPrompt: true });
  } else {
    if (!ASSESSMENT_FALLBACKS.has(input.outcome)) throw new QandeelError('VALIDATION_FAILED', 'an assessment fallback names why no classification exists', { field: 'outcome' });
    record = insertRecord(ctx, binding, employeeId, item.id, { source: 'FALLBACK', outcome: input.outcome, tiers: fallbackTiers(binding.offered), runId: fence.runId, manifestId: null, sealedBy: 'ASSESSMENT', withPrompt: false });
  }
  releaseReply(ctx, binding.replyWorkItemId);
  return { recorded: true, record };
}

/** The Skill need a reply plans with: per offered code a tier, how it was decided, and whether a model result applied. */
export interface ReplySkillNeed {
  readonly record: SkillNeedRecord | null;
  /** Source and outcome as the reply applies them (STALE: a model result bound to other Skill versions is not used). */
  readonly source: 'MODEL' | 'FALLBACK';
  readonly outcome: SkillNeedOutcome | 'STALE_RESULT' | 'NO_OFFER';
  tierOf(code: string): SkillNeedTier;
}

/**
 * The decision of one Founder reply, read at its Context Assembly. With no decision yet the reply seals the fallback now
 * (its assessment ended, or its window passed): every later step of the reply plans with the same decision, and a late
 * result is refused. A model result applies only to exactly the Skill versions it was given and the message it read.
 */
export function txSkillNeedForReply(ctx: StoreContext, reply: WorkItemRecord, employeeId: Id): ReplySkillNeed {
  const offeredNow = txOfferedSkills(ctx, employeeId);
  let record = txSkillNeedRecord(ctx, reply.id);
  if (record === null && offeredNow.length > 0) {
    const sna = ctx.db.get<{ id: string; state: string; processor_input_json: string }>(`SELECT id, state, processor_input_json FROM work_items WHERE parent_id = ? AND processor_kind = ? ORDER BY created_at, id LIMIT 1`, reply.id, SKILL_NEED_ASSESSMENT_KIND);
    const binding = sna ? skillNeedBindingOf(getWorkItemRow(ctx, sna.id as Id)) : null;
    if (binding !== null) {
      record = insertRecord(ctx, binding, employeeId, sna?.id as Id, { source: 'FALLBACK', outcome: TERMINAL.has(String(sna?.state)) ? 'ASSESSMENT_ENDED' : 'WINDOW_EXPIRED', tiers: fallbackTiers(binding.offered), runId: null, manifestId: null, sealedBy: 'REPLY', withPrompt: false });
    }
  }
  if (record === null) return { record: null, source: 'FALLBACK', outcome: offeredNow.length === 0 ? 'NO_OFFER' : 'ASSESSMENT_ENDED', tierOf: () => SKILL_NEED_FALLBACK_TIER };
  const r = record;
  const same = r.offered.length === offeredNow.length && r.offered.every((o, i) => o.code === offeredNow[i]?.code && o.skillVersionId === offeredNow[i]?.skillVersionId);
  if (r.source === 'MODEL' && same) return { record: r, source: 'MODEL', outcome: 'CLASSIFIED', tierOf: (code) => r.tiers[code] ?? SKILL_NEED_FALLBACK_TIER };
  return { record: r, source: 'FALLBACK', outcome: r.source === 'MODEL' ? 'STALE_RESULT' : r.outcome, tierOf: () => SKILL_NEED_FALLBACK_TIER };
}

/** Read-only access to Skill need decisions (content-free records: codes, ids and hashes). */
export class SkillNeedStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): SkillNeedStore {
    return new SkillNeedStore(store);
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  /** The decision of one Founder reply, or null (none yet, or a reply without Skill selection). */
  forReply(replyWorkItemId: Id): SkillNeedRecord | null {
    return this.#read((ctx) => txSkillNeedRecord(ctx, replyWorkItemId));
  }

  /** The assessment Work Item of one Founder reply, or null. */
  assessmentOf(replyWorkItemId: Id): Id | null {
    return this.#read((ctx) => (ctx.db.get<{ id: string }>('SELECT id FROM work_items WHERE parent_id = ? AND processor_kind = ? ORDER BY created_at, id LIMIT 1', replyWorkItemId, SKILL_NEED_ASSESSMENT_KIND)?.id as Id | undefined) ?? null);
  }
}
