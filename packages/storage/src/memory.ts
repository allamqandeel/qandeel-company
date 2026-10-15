/**
 * MemoryStore — C3 Employee Memory, Company Knowledge, Canonical Truth and the learning-validation
 * path over one CompanyStore (Stage 5).
 *
 * - Writes that carry authority (canonical truth, Founder corrections, curated knowledge, lesson
 *   validation, shared promotion) go through the one Founder-authority gate (`founderAdminWrite`):
 *   until the authenticated Founder surface exists (C5) they fail closed with
 *   FOUNDER_SURFACE_UNAVAILABLE. A Founder reference is not authentication (D-C2-13).
 * - Memory itself is written only by the runtime-owned Memory Write Policy (fenced runtime writes),
 *   by a Founder correction, or by promoting a validated lesson — never by a model directly.
 * - Reads return metadata only (IDs, classes, statuses, hashes): no semantic payload leaves storage
 *   except inside an assembled context.
 */
import { QandeelError, assertCode, assertId, assertOpaqueRef, boundedText, newId, sha256Hex, type Id, type Timestamp } from '@qandeel-company/domain';
import { assertDataClass, maxDataClass, type DataClass } from '@qandeel-company/governance';
import {
  CANONICAL_LEVELS,
  CORRECTION_DISPOSITIONS,
  PROMOTION_SCOPE,
  PROMOTION_TARGETS,
  REVIEW_AFTER_DAYS,
  addDays,
  assertKeyCode,
  assertKnowledgeScope,
  containsSecretMaterial,
  contentFingerprint,
  requiresIndependentReview,
  type CanonicalLevel,
  type CorrectionDisposition,
  type KnowledgeScope,
  type PromotionTarget,
} from '@qandeel-company/mind';

import { founder, founderAdminWrite } from './governance.js';
import { txDecideLesson, txPatternShareGate, txRequestLessonJudgment } from './improvement.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { FOUNDER_DECISION_SOURCE, SYSTEM_MIND_REF, assertNotContradictingCanonical, getKnowledgeRow, getMemoryRow, indexItemTerms, indexSalienceTerms, indexTerms, insertMemory, setMemoryStatus, wakeEmployeeWaits } from './mind-core.js';
import {
  mapCandidate,
  mapCanonical,
  mapConflict,
  mapKnowledge,
  mapLesson,
  mapManifest,
  mapManifestEntry,
  mapMemory,
  mapPromotion,
  mapSummary,
  type CanonicalTruthRecord,
  type ContextManifestRecord,
  type KnowledgeRecord,
  type LessonRecord,
  type ManifestEntryRecord,
  type MemoryCandidateRecord,
  type MemoryConflictRecord,
  type MemoryRecord,
  type PromotionRecord,
  type SummaryRecord,
} from './mind-records.js';
import { storeContext, type CompanyStore } from './store.js';
import { insertLesson, liveClaimDisagreements, txOpenMemoryConflicts } from './mind-writes.js';

const text = (v: unknown, field: string, max: number): string => {
  const t = boundedText(v, field, max);
  if (containsSecretMaterial(t)) throw new QandeelError('VALIDATION_FAILED', `${field} contains secret-shaped material; secrets never enter Company memory or knowledge`, { field });
  return t;
};
const optKey = (v: unknown, field: string): string | null => (v === undefined || v === null ? null : assertKeyCode(v, field));

export interface CanonicalInput {
  readonly level: CanonicalLevel;
  readonly topic: string;
  readonly claimKey?: string;
  readonly claimValue?: string;
  readonly statement: string;
  readonly dataClass: DataClass;
  /** Where the truth is recorded (e.g. `authority:docs/...` or `decision:<id>`). */
  readonly sourceRef: string;
  readonly sourceSha256?: string;
  /** The ACTIVE record this one supersedes (required when the claim already has an active record). */
  readonly supersedes?: string;
}

export interface KnowledgeInput {
  readonly scope: KnowledgeScope;
  readonly scopeRef?: string;
  readonly topic: string;
  readonly claimKey?: string;
  readonly claimValue?: string;
  readonly content: string;
  readonly dataClass: DataClass;
  readonly marketRef?: string;
  readonly confidencePct?: number;
  readonly reviewAfterDays?: number;
  readonly supersedes?: string;
}

export interface CorrectionInput {
  readonly disposition: CorrectionDisposition;
  readonly reasonCode: string;
  /** The corrected interpretation (required for SUPERSEDED). */
  readonly correctedContent?: string;
  readonly correctedClaimValue?: string;
  readonly contextRef?: string;
}

// --- G4-FINAL-CLOSURE-01 (D-P1-17): Founder decision continuity ----------------------------------------------------------
//
// A decision the Founder states in the Founder ↔ CEO conversation becomes durable ONLY when the Founder records it — a
// structured, confirmed act (never a model's reading of the conversation). It is a Company Knowledge item of provenance
// FOUNDER_DECISION whose source is the Founder's own message, readable by the CEO's role (or the whole Company when the
// Founder says so), never by another Employee: the thread is Founder-only, and so is what comes out of it unless widened.
// An amendment is the existing supersession chain (one live version per decision key), a revocation the existing ARCHIVED
// status; history stays. A recorded decision states what was decided: it moves no budget, grant or assignment by itself.

export const FOUNDER_DECISION_TOPIC = 'founder.decision';
export const FOUNDER_DECISION_AUDIENCES = ['CEO', 'COMPANY'] as const;
export type FounderDecisionAudience = (typeof FOUNDER_DECISION_AUDIENCES)[number];
export const FOUNDER_DECISION_SUBJECT_MAX = 160;
export const FOUNDER_DECISION_STATEMENT_MAX = 1_500;
/** A recorded decision is reviewed after a year (the knowledge review horizon), never silently dropped. */
const FOUNDER_DECISION_REVIEW_DAYS = 365;

export interface FounderDecisionInput {
  /** The Founder message the decision is recorded from (a Founder turn of the Founder ↔ CEO conversation). */
  readonly messageId: unknown;
  readonly subject: unknown;
  readonly statement: unknown;
  readonly audience?: unknown;
  readonly dataClass?: unknown;
  /** The live recorded decision this one amends (same decision key, next version). */
  readonly supersedes?: unknown;
}

export interface FounderDecisionPlan {
  readonly messageId: Id;
  readonly threadId: Id;
  readonly messageAt: Timestamp;
  readonly ceoId: Id;
  readonly subject: string;
  readonly statement: string;
  readonly audience: FounderDecisionAudience;
  readonly dataClass: 'D1' | 'D2';
  readonly scope: 'ROLE' | 'COMPANY';
  readonly scopeRef: string | null;
  /** The stable identity of the decision across its versions (the knowledge claim key). */
  readonly decisionKey: string;
  readonly version: number;
  readonly content: string;
  readonly contentSha256: string;
  readonly supersedes: { readonly id: Id; readonly version: number; readonly decisionVersion: number } | null;
}

export interface FounderDecisionView {
  readonly id: Id;
  readonly decisionKey: string;
  readonly decisionVersion: number;
  readonly subject: string;
  readonly statement: string;
  readonly audience: FounderDecisionAudience;
  readonly dataClass: DataClass;
  readonly status: KnowledgeRecord['status'];
  readonly inForce: boolean;
  readonly sourceMessageId: Id;
  readonly supersedesId: Id | null;
  readonly supersededById: Id | null;
  readonly recordedAt: Timestamp;
  readonly version: number;
}

const DECISION_HEAD = /^Founder decision \(recorded from the Founder message of \d{4}-\d{2}-\d{2}(?:; it replaces an earlier version)?\): /;

const decisionRefuse = (reason: string, message: string, field: string, code: 'VALIDATION_FAILED' | 'INVALID_TRANSITION' | 'NOT_FOUND' = 'VALIDATION_FAILED'): never => {
  throw new QandeelError(code, message, { reason, field });
};

/** One plain line (a subject) or bounded text (a statement), secret-scanned; never empty. */
function decisionText(v: unknown, field: string, max: number, oneLine: boolean): string {
  if (typeof v !== 'string') return decisionRefuse('TEXT_REQUIRED', `${field} is required`, field);
  const t = (oneLine ? v.replace(/\s+/g, ' ') : v.replace(/\r\n/g, '\n')).trim();
  if (t.length < 2 || t.length > max) return decisionRefuse('TEXT_LENGTH', `${field} is 2..${max} characters`, field);
  if (containsSecretMaterial(t)) return decisionRefuse('SECRET_MATERIAL', `${field} contains secret-shaped material; secrets never enter Company knowledge`, field);
  return t;
}

/** A row of `knowledge_items` that is a recorded Founder decision (its source is a Founder message), or a typed refusal. */
function decisionRow(ctx: StoreContext, id: Id): KnowledgeRecord {
  const k = getKnowledgeRow(ctx, id);
  if (k.provenanceKind !== 'FOUNDER_DECISION' || !k.provenanceRef.startsWith(FOUNDER_DECISION_SOURCE) || k.topic !== FOUNDER_DECISION_TOPIC) decisionRefuse('NOT_A_FOUNDER_DECISION', 'this knowledge item is not a recorded Founder decision', 'decisionId', 'NOT_FOUND');
  return k;
}

const decisionVersionOf = (k: KnowledgeRecord): number => Number(String(k.claimValue ?? 'v1').slice(1)) || 1;

/** The Founder turn of a Founder ↔ CEO conversation a decision is recorded from, with its thread and the CEO. */
function decisionSource(ctx: StoreContext, messageId: unknown): { id: Id; threadId: Id; seq: number; at: Timestamp; ceoId: Id } {
  const id = assertId(messageId, 'messageId');
  const m = ctx.db.get<{ thread_id: string; seq: number; sender_kind: string; created_at: string; kind: string; employee_id: string }>(
    'SELECT m.thread_id, m.seq, m.sender_kind, m.created_at, t.kind, t.employee_id FROM communication_messages m JOIN communication_threads t ON t.id = m.thread_id WHERE m.id = ?',
    id,
  );
  if (!m) return decisionRefuse('MESSAGE_NOT_FOUND', 'the source message was not found', 'messageId', 'NOT_FOUND');
  // Only the Founder's own words in the Founder ↔ CEO conversation: never an Employee's reply, a brief or another thread.
  if (m.kind !== 'FOUNDER_CEO') decisionRefuse('NOT_CEO_CONVERSATION', 'a Founder decision is recorded from the Founder ↔ CEO conversation', 'messageId');
  if (m.sender_kind !== 'FOUNDER') decisionRefuse('NOT_FOUNDER_MESSAGE', 'a Founder decision is recorded from a message the Founder wrote', 'messageId');
  return { id, threadId: m.thread_id as Id, seq: Number(m.seq), at: m.created_at as Timestamp, ceoId: m.employee_id as Id };
}

/**
 * Validates one record / amendment against durable state (the preview and the confirm run the same plan). The content is
 * deterministic from (source message, subject, statement, amendment), so a repeated request is recognised, never duplicated.
 */
export function txPlanFounderDecision(ctx: StoreContext, input: FounderDecisionInput): FounderDecisionPlan {
  const src = decisionSource(ctx, input.messageId);
  const subject = decisionText(input.subject, 'subject', FOUNDER_DECISION_SUBJECT_MAX, true);
  const statement = decisionText(input.statement, 'statement', FOUNDER_DECISION_STATEMENT_MAX, false);
  const audience = input.audience === undefined || input.audience === null ? 'CEO' : input.audience;
  if (!(FOUNDER_DECISION_AUDIENCES as readonly unknown[]).includes(audience)) decisionRefuse('AUDIENCE', 'the audience is CEO or COMPANY', 'audience');
  const dataClass = input.dataClass === undefined || input.dataClass === null ? 'D2' : input.dataClass;
  if (dataClass !== 'D1' && dataClass !== 'D2') decisionRefuse('DATA_CLASS', 'a recorded decision is D1 or D2 (what a Founder conversation reply may hold)', 'dataClass');
  const ceo = ctx.db.get<{ role_ref: string }>('SELECT role_ref FROM employees WHERE id = ?', src.ceoId);
  if (!ceo) return decisionRefuse('CEO_NOT_FOUND', 'the conversation has no CEO record', 'messageId', 'NOT_FOUND');
  let supersedes: FounderDecisionPlan['supersedes'] = null;
  let decisionKey = `founder-decision.${sha256Hex(`${src.id}\n${subject.normalize('NFKC').toLowerCase()}`).slice(0, 16)}`;
  if (input.supersedes !== undefined && input.supersedes !== null) {
    const prior = decisionRow(ctx, assertId(input.supersedes, 'supersedes'));
    if (!['ACTIVE', 'LOW_CONFIDENCE', 'STALE'].includes(prior.status)) decisionRefuse('NOT_IN_FORCE', 'only a decision in force is amended (a replaced or revoked one is history)', 'supersedes', 'INVALID_TRANSITION');
    const priorSrc = decisionSource(ctx, prior.provenanceRef.slice(FOUNDER_DECISION_SOURCE.length));
    if (priorSrc.threadId !== src.threadId) decisionRefuse('OTHER_CONVERSATION', 'an amendment comes from the same conversation', 'supersedes');
    if (src.seq < priorSrc.seq) decisionRefuse('SOURCE_OLDER', 'an amendment is recorded from a message no older than the decision it replaces', 'messageId');
    decisionKey = String(prior.claimKey);
    supersedes = { id: prior.id, version: prior.version, decisionVersion: decisionVersionOf(prior) };
  }
  const version = supersedes === null ? 1 : supersedes.decisionVersion + 1;
  const content = `Founder decision (recorded from the Founder message of ${src.at.slice(0, 10)}${supersedes === null ? '' : '; it replaces an earlier version'}): ${subject}\n${statement}`;
  const contentSha256 = sha256Hex(content);
  // Idempotent: the same words from the same message are one decision, whatever the number of requests.
  const same = ctx.db.get<{ id: string }>(`SELECT id FROM knowledge_items WHERE provenance_ref = ? AND content_sha256 = ? AND status IN ('ACTIVE', 'LOW_CONFIDENCE', 'STALE')`, `${FOUNDER_DECISION_SOURCE}${src.id}`, contentSha256);
  if (same) throw new QandeelError('INVALID_TRANSITION', 'this decision is already recorded', { reason: 'ALREADY_RECORDED', knowledgeId: same.id });
  if (supersedes === null) {
    const live = ctx.db.get<{ id: string }>(`SELECT id FROM knowledge_items WHERE claim_key = ? AND status IN ('ACTIVE', 'LOW_CONFIDENCE', 'STALE')`, decisionKey);
    if (live) throw new QandeelError('INVALID_TRANSITION', 'this message already holds a decision on that subject; amend it instead', { reason: 'ALREADY_RECORDED', knowledgeId: live.id });
  }
  return {
    messageId: src.id, threadId: src.threadId, messageAt: src.at, ceoId: src.ceoId, subject, statement, audience: audience as FounderDecisionAudience, dataClass: dataClass as 'D1' | 'D2',
    scope: audience === 'COMPANY' ? 'COMPANY' : 'ROLE', scopeRef: audience === 'COMPANY' ? null : ceo.role_ref, decisionKey, version, content, contentSha256, supersedes,
  };
}

/** The decision a revocation targets, in force now. */
export function txPlanFounderDecisionRevoke(ctx: StoreContext, input: { decisionId: unknown; messageId?: unknown }): { decision: KnowledgeRecord; messageId: Id | null } {
  const k = decisionRow(ctx, assertId(input.decisionId, 'decisionId'));
  if (!['ACTIVE', 'LOW_CONFIDENCE', 'STALE'].includes(k.status)) decisionRefuse('NOT_IN_FORCE', 'only a decision in force is revoked (a replaced or revoked one is history)', 'decisionId', 'INVALID_TRANSITION');
  let messageId: Id | null = null;
  if (input.messageId !== undefined && input.messageId !== null) {
    const src = decisionSource(ctx, input.messageId);
    const priorSrc = decisionSource(ctx, k.provenanceRef.slice(FOUNDER_DECISION_SOURCE.length));
    if (src.threadId !== priorSrc.threadId) decisionRefuse('OTHER_CONVERSATION', 'a revocation comes from the same conversation', 'messageId');
    messageId = src.id;
  }
  return { decision: k, messageId };
}

function decisionView(r: Parameters<typeof mapKnowledge>[0]): FounderDecisionView {
  const k = mapKnowledge(r);
  const [head = '', ...rest] = String(r.content).split('\n');
  const opt = (v: unknown): Id | null => (typeof v === 'string' && v.length > 0 ? (v as Id) : null);
  const inForce = ['ACTIVE', 'LOW_CONFIDENCE', 'STALE'].includes(k.status);
  return {
    id: k.id, decisionKey: String(k.claimKey), decisionVersion: decisionVersionOf(k), subject: head.replace(DECISION_HEAD, ''), statement: rest.join('\n'),
    audience: k.scope === 'COMPANY' ? 'COMPANY' : 'CEO', dataClass: k.dataClass, status: k.status, inForce,
    sourceMessageId: k.provenanceRef.slice(FOUNDER_DECISION_SOURCE.length) as Id, supersedesId: opt(r.supersedes_id), supersededById: opt(r.superseded_by_id), recordedAt: k.createdAt, version: k.version,
  };
}

/** Every decision recorded from one conversation (in force and history), oldest first. Founder-scoped content; a read. */
export function txFounderDecisionsOfThread(ctx: StoreContext, threadId: Id): FounderDecisionView[] {
  return ctx.db
    .all(
      `SELECT k.* FROM knowledge_items k JOIN communication_messages m ON k.provenance_ref = '${FOUNDER_DECISION_SOURCE}' || m.id
        WHERE m.thread_id = ? AND k.provenance_kind = 'FOUNDER_DECISION' AND k.topic = ? ORDER BY k.created_at, CAST(substr(k.claim_value, 2) AS INTEGER), k.id`,
      threadId, FOUNDER_DECISION_TOPIC,
    )
    .map((r) => decisionView(r));
}

export interface MindHealth {
  readonly memories: Record<string, number>;
  readonly memoryIntegrityFailures: number;
  readonly memoryConflictsOpen: number;
  readonly memoryStaleDue: number;
  readonly candidatesPending: number;
  readonly knowledge: Record<string, number>;
  readonly knowledgeIntegrityFailures: number;
  readonly canonicalIntegrityFailures: number;
  readonly lessonsAwaitingReview: number;
  readonly promotionsPendingReview: number;
  readonly contextManifests: number;
  readonly contextFailures: number;
  readonly summariesValid: number;
}

/** Contradicting memory and knowledge are marked INCORRECT at once: canonical truth wins immediately (Stage 5 §7). */
function applyCanonicalClaim(ctx: StoreContext, canonicalId: Id, claimKey: string, claimValue: string, actorRef: string): void {
  const at = ts(ctx);
  for (const m of ctx.db.all(`SELECT * FROM memory_records WHERE claim_key = ? AND claim_value <> ? AND status IN ('ACTIVE', 'LOW_CONFIDENCE', 'STALE')`, claimKey, claimValue).map(mapMemory)) {
    setMemoryStatus(ctx, m, 'INCORRECT', 'CONTRADICTS_CANONICAL', actorRef);
  }
  for (const c of ctx.db.all(`SELECT * FROM memory_conflicts WHERE claim_key = ? AND state = 'OPEN'`, claimKey).map(mapConflict)) {
    ctx.db.run(`UPDATE memory_conflicts SET state = 'RESOLVED', resolution_ref = ?, resolved_by_ref = ?, resolved_at = ? WHERE id = ?`, `canonical_truth:${canonicalId}`, actorRef, at, c.id);
    appendAudit(ctx, 'memory.conflict_resolved', 'memory_conflict', c.id, { actorRef }, 'OK', 'CANONICAL_TRUTH', {});
    wakeConflictWaits(ctx, c);
  }
  for (const k of ctx.db.all(`SELECT * FROM knowledge_items WHERE claim_key = ? AND claim_value <> ? AND status IN ('ACTIVE', 'LOW_CONFIDENCE', 'STALE')`, claimKey, claimValue).map(mapKnowledge)) {
    setKnowledgeStatus(ctx, k, 'INCORRECT', 'CONTRADICTS_CANONICAL', actorRef);
  }
  // Lessons still on their way to validation that contradict the truth are rejected now (a validated
  // one can no longer be promoted: every memory / knowledge insert re-checks canonical truth).
  for (const l of ctx.db.all(`SELECT * FROM lessons WHERE claim_key = ? AND claim_value <> ? AND stage IN ('LESSON_CANDIDATE', 'UNDER_REVIEW')`, claimKey, claimValue).map(mapLesson)) {
    ctx.db.run(`UPDATE lessons SET stage = 'REJECTED', decided_by_ref = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, actorRef, at, l.id, l.version);
    lessonHistory(ctx, l, 'REJECTED', 'CONTRADICTS_CANONICAL', actorRef);
  }
  // A pending promotion of a validated lesson that contradicts the truth is decided now (REJECTED), never
  // left waiting on a review that could only fail.
  for (const r of ctx.db.all<{ id: string; lesson_id: string }>(`SELECT p.id, p.lesson_id FROM lesson_promotions p JOIN lessons l ON l.id = p.lesson_id WHERE p.state = 'PENDING_REVIEW' AND l.claim_key = ? AND l.claim_value <> ?`, claimKey, claimValue)) {
    ctx.db.run(`UPDATE lesson_promotions SET state = 'REJECTED', decided_by_ref = ?, reason_code = 'CONTRADICTS_CANONICAL', decided_at = ? WHERE id = ? AND state = 'PENDING_REVIEW'`, actorRef, at, r.id);
    appendAudit(ctx, 'learning.promotion_decided', 'lesson', r.lesson_id as Id, { actorRef }, 'OK', 'CONTRADICTS_CANONICAL', { promotionId: r.id, decision: 'REJECT' });
  }
}

/** A resolved conflict wakes its Employee's work held for memory-conflict review (same transaction). */
function wakeConflictWaits(ctx: StoreContext, c: MemoryConflictRecord): void {
  const owner = ctx.db.get<{ e: string }>('SELECT employee_id AS e FROM memory_records WHERE id = ?', c.memoryAId)?.e;
  if (owner) wakeEmployeeWaits(ctx, owner as Id, ['MEMORY_CONFLICT_REVIEW'], 'memory.conflict_resolved');
}

function setKnowledgeStatus(ctx: StoreContext, k: KnowledgeRecord, to: KnowledgeRecord['status'], reasonCode: string, actorRef: string, supersededById: Id | null = null): void {
  const changed = ctx.db.run('UPDATE knowledge_items SET status = ?, superseded_by_id = COALESCE(?, superseded_by_id), version = version + 1, updated_at = ? WHERE id = ? AND version = ?', to, supersededById, ts(ctx), k.id, k.version).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'knowledge changed concurrently', { knowledgeId: k.id });
  ctx.db.run('INSERT INTO knowledge_history (knowledge_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', k.id, k.version + 1, k.status, to, reasonCode, actorRef, ts(ctx));
  appendAudit(ctx, 'knowledge.status', 'knowledge', k.id, { actorRef }, 'OK', reasonCode, { from: k.status, to });
}

function insertKnowledge(ctx: StoreContext, f: { scope: KnowledgeScope; scopeRef: string | null; topic: string; claimKey: string | null; claimValue: string | null; content: string; dataClass: DataClass; marketRef: string | null; provenanceKind: 'VALIDATED_LESSON' | 'FOUNDER_DECISION' | 'CANONICAL'; provenanceRef: string; confidencePct: number; reviewAt: Timestamp | null; supersedesId: Id | null; actorRef: string; indexText?: { topic: string; text: string } }): Id {
  if (f.claimKey !== null) {
    assertNotContradictingCanonical(ctx, f.claimKey, f.claimValue);
    const clash = ctx.db.get<{ id: string }>(`SELECT id FROM knowledge_items WHERE scope = ? AND COALESCE(scope_ref, '') = ? AND claim_key = ? AND status IN ('ACTIVE', 'LOW_CONFIDENCE') AND id IS NOT ?`, f.scope, f.scopeRef ?? '', f.claimKey, f.supersedesId);
    if (clash) throw new QandeelError('VALIDATION_FAILED', 'this scope already holds knowledge for the claim; supersede it explicitly', { reason: 'KNOWLEDGE_CONFLICT', knowledgeId: clash.id });
  }
  // G4-FINAL-CLOSURE-01 (D-P1-17): a recorded Founder decision is indexed on its own words (subject and statement), never on
  // its framing ("Founder decision …"), so it is relevant only to a task about its subject.
  const ix = f.indexText ?? { topic: f.topic, text: f.content };
  const id = newId();
  const at = ts(ctx);
  // The predecessor is superseded first (its successor link is a deferred reference), so the unique
  // active-claim rule never sees two live records.
  if (f.supersedesId !== null && !['ACTIVE', 'LOW_CONFIDENCE', 'STALE'].includes(getKnowledgeRow(ctx, f.supersedesId).status)) throw new QandeelError('INVALID_TRANSITION', 'only live knowledge is superseded', { knowledgeId: f.supersedesId });
  if (f.supersedesId !== null) setKnowledgeStatus(ctx, getKnowledgeRow(ctx, f.supersedesId), 'SUPERSEDED', 'knowledge.superseded', f.actorRef, id);
  ctx.db.run(
    `INSERT INTO knowledge_items (id, scope, scope_ref, topic, claim_key, claim_value, content, content_sha256, fingerprint, terms_json, data_class, market_ref, provenance_kind, provenance_ref, confidence_pct, status, integrity, review_at, last_validated_at, supersedes_id, version, created_by_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'OK', ?, ?, ?, 1, ?, ?, ?)`,
    id, f.scope, f.scopeRef, f.topic, f.claimKey, f.claimValue, f.content, sha256Hex(f.content), contentFingerprint(f.content), JSON.stringify(indexTerms(ix.topic, ix.text)), f.dataClass, f.marketRef, f.provenanceKind, f.provenanceRef, f.confidencePct, f.reviewAt, at, f.supersedesId, f.actorRef, at, at,
  );
  ctx.db.run('INSERT INTO knowledge_history (knowledge_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, ?, ?, ?, ?)', id, 'ACTIVE', 'knowledge.recorded', f.actorRef, at);
  indexItemTerms(ctx, 'KNOWLEDGE', '', id, indexTerms(ix.topic, ix.text));
  indexSalienceTerms(ctx, 'KNOWLEDGE', '', id, ix.topic, ix.text, indexTerms(ix.topic, ix.text));
  appendAudit(ctx, 'knowledge.recorded', 'knowledge', id, { actorRef: f.actorRef }, 'OK', null, { scope: f.scope, dataClass: f.dataClass, provenance: f.provenanceKind });
  return id;
}

function scopeRefFor(scope: KnowledgeScope, ref: string | undefined): string | null {
  if (scope === 'COMPANY' || scope === 'FOUNDER_ONLY') {
    if (ref !== undefined) throw new QandeelError('VALIDATION_FAILED', `${scope} knowledge has no scope ref`, { field: 'scopeRef' });
    return null;
  }
  const r = assertOpaqueRef(ref, 'scopeRef');
  const prefix = { DEPARTMENT: 'department:', ROLE: 'role:', MARKET: 'market:', RESTRICTED: 'restricted:' }[scope];
  if (!r.startsWith(prefix)) throw new QandeelError('VALIDATION_FAILED', `${scope} knowledge is scoped by a "${prefix}<id>" ref`, { field: 'scopeRef' });
  return r;
}

function lessonHistory(ctx: StoreContext, l: LessonRecord, to: LessonRecord['stage'], reasonCode: string, actorRef: string): void {
  ctx.db.run('INSERT INTO lesson_history (lesson_id, version, from_stage, to_stage, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', l.id, l.version + 1, l.stage, to, reasonCode, actorRef, ts(ctx));
  appendAudit(ctx, 'learning.stage', 'lesson', l.id, { actorRef }, 'OK', reasonCode, { from: l.stage, to });
}

function getLesson(ctx: StoreContext, id: Id): LessonRecord {
  const r = ctx.db.get('SELECT * FROM lessons WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'lesson not found', { lessonId: id });
  return mapLesson(r);
}

export class MemoryStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): MemoryStore {
    return new MemoryStore(store);
  }

  #write<T>(operation: string, fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.immediate(operation, () => fn(ctx));
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  // --- Canonical Truth (Founder authority) -------------------------------------------------------

  /** Records canonical truth. It supersedes, never rewrites; contradicting memory / knowledge become INCORRECT at once. */
  recordCanonicalTruth(actorRef: string, input: CanonicalInput): CanonicalTruthRecord {
    return founderAdminWrite(this.#store, 'record canonical truth', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'canonical truth');
      if (!(CANONICAL_LEVELS as readonly string[]).includes(input.level)) throw new QandeelError('VALIDATION_FAILED', 'unknown canonical level', { field: 'level' });
      const topic = assertKeyCode(input.topic, 'topic');
      const claimKey = optKey(input.claimKey, 'claimKey');
      const claimValue = optKey(input.claimValue, 'claimValue');
      if ((claimKey === null) !== (claimValue === null)) throw new QandeelError('VALIDATION_FAILED', 'claimKey and claimValue go together', { field: 'claimValue' });
      const statement = text(input.statement, 'statement', 2_000);
      const supersedes = input.supersedes === undefined ? null : assertId(input.supersedes, 'supersedes');
      const current = claimKey ? ctx.db.get<{ id: string }>(`SELECT id FROM canonical_truth WHERE claim_key = ? AND status = 'ACTIVE'`, claimKey) : undefined;
      if (current && current.id !== supersedes) throw new QandeelError('VALIDATION_FAILED', 'this claim already has active canonical truth; supersede it explicitly', { reason: 'CANONICAL_EXISTS', canonicalId: current.id });
      const id = newId();
      const at = ts(ctx);
      if (supersedes !== null) {
        const old = mapCanonical(ctx.db.get('SELECT * FROM canonical_truth WHERE id = ?', supersedes) ?? {});
        if (old.status !== 'ACTIVE') throw new QandeelError('INVALID_TRANSITION', 'only active canonical truth is superseded', { canonicalId: supersedes });
        // The predecessor releases the claim first; its successor link is a deferred reference (checked at commit).
        ctx.db.run(`UPDATE canonical_truth SET status = 'SUPERSEDED', superseded_by_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, id, at, supersedes, old.version);
      }
      ctx.db.run(
        `INSERT INTO canonical_truth (id, level, topic, claim_key, claim_value, statement, statement_sha256, terms_json, data_class, source_ref, source_sha256, status, integrity, supersedes_id, version, recorded_by_ref, recorded_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'OK', ?, 1, ?, ?, ?)`,
        id, input.level, topic, claimKey, claimValue, statement, sha256Hex(statement), JSON.stringify(indexTerms(topic, statement)), assertDataClass(input.dataClass, 'dataClass'), assertOpaqueRef(input.sourceRef, 'sourceRef'), input.sourceSha256 ?? null, supersedes, p.ref, at, at,
      );
      indexItemTerms(ctx, 'CANONICAL', '', id, indexTerms(topic, statement));
      indexSalienceTerms(ctx, 'CANONICAL', '', id, topic, statement, indexTerms(topic, statement));
      appendAudit(ctx, 'canonical_truth.recorded', 'canonical_truth', id, { actorRef: p.ref }, 'OK', null, { level: input.level, supersedes });
      if (claimKey !== null && claimValue !== null) applyCanonicalClaim(ctx, id, claimKey, claimValue, p.ref);
      return mapCanonical(ctx.db.get('SELECT * FROM canonical_truth WHERE id = ?', id) ?? {});
    });
  }

  canonical(id: Id): CanonicalTruthRecord {
    return this.#read((ctx) => mapCanonical(ctx.db.get('SELECT * FROM canonical_truth WHERE id = ?', id) ?? notFound('canonical truth', id)));
  }

  // --- Founder corrections (Stage 5 §5) --------------------------------------------------------------

  /**
   * An explicit, additive Founder correction: the prior memory is marked SUPERSEDED / INCORRECT / STALE
   * (never rewritten), the reason and context are kept, and a corrected record (when given) is favoured
   * by retrieval from then on.
   */
  correctMemory(actorRef: string, memoryId: string, input: CorrectionInput): { correctionId: Id; correctedMemoryId: Id | null } {
    return founderAdminWrite(this.#store, 'correct memory', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'memory correction');
      const m = getMemoryRow(ctx, assertId(memoryId, 'memoryId'));
      if (!(CORRECTION_DISPOSITIONS as readonly string[]).includes(input.disposition)) throw new QandeelError('VALIDATION_FAILED', 'unknown correction disposition', { field: 'disposition' });
      if (['SUPERSEDED', 'INCORRECT', 'ARCHIVED'].includes(m.status)) throw new QandeelError('TERMINAL_STATE', 'this memory is already history', { memoryId: m.id, status: m.status });
      const reason = assertCode(input.reasonCode, 'reasonCode');
      if (input.disposition === 'SUPERSEDED' && input.correctedContent === undefined) throw new QandeelError('VALIDATION_FAILED', 'a superseding correction states the corrected interpretation', { field: 'correctedContent' });
      let correctedId: Id | null = null;
      if (input.correctedContent !== undefined) {
        const content = text(input.correctedContent, 'correctedContent', 2_000);
        const claimValue = m.claimKey === null ? null : input.correctedClaimValue === undefined ? m.claimValue : assertKeyCode(input.correctedClaimValue, 'correctedClaimValue');
        correctedId = insertMemory(
          ctx,
          {
            employeeId: m.employeeId,
            memoryClass: m.memoryClass,
            topic: m.topic,
            claimKey: m.claimKey,
            claimValue,
            content,
            fingerprint: contentFingerprint(content),
            terms: indexTerms(m.topic, content),
            dataClass: m.dataClass,
            marketRef: m.marketRef,
            projectRef: m.projectRef,
            provenanceKind: 'FOUNDER_CORRECTION',
            provenanceRef: `memory:${m.id}`,
            sourceVersion: null,
            sourceSha256: null,
            evidenceRefs: [`memory:${m.id}`],
            confidencePct: 95,
            status: 'ACTIVE',
            retentionPolicy: 'FOUNDER_CORRECTION',
            reviewAt: addDays(ts(ctx), 365),
            candidateId: null,
            supersedesId: m.id,
            validatedAt: ts(ctx),
          },
          p.ref,
          'memory.founder_corrected',
        );
      }
      const to = input.disposition;
      setMemoryStatus(ctx, m, to, `CORRECTION_${to}`, p.ref, correctedId ? { supersededById: correctedId } : {});
      const correctionId = newId();
      ctx.db.run(
        'INSERT INTO memory_corrections (id, memory_id, disposition, corrected_memory_id, reason_code, context_ref, actor_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        correctionId, m.id, to, correctedId, reason, input.contextRef === undefined ? null : assertOpaqueRef(input.contextRef, 'contextRef'), p.ref, ts(ctx),
      );
      for (const c of ctx.db.all(`SELECT * FROM memory_conflicts WHERE state = 'OPEN' AND (memory_a_id = ? OR memory_b_id = ?)`, m.id, m.id).map(mapConflict)) {
        ctx.db.run(`UPDATE memory_conflicts SET state = 'RESOLVED', resolution_ref = ?, resolved_by_ref = ?, resolved_at = ? WHERE id = ?`, `memory_correction:${correctionId}`, p.ref, ts(ctx), c.id);
        appendAudit(ctx, 'memory.conflict_resolved', 'memory_conflict', c.id, { actorRef: p.ref }, 'OK', 'FOUNDER_CORRECTION', {});
        wakeConflictWaits(ctx, c);
      }
      appendAudit(ctx, 'memory.corrected', 'memory', m.id, { actorRef: p.ref }, 'OK', reason, { disposition: to, correctedMemoryId: correctedId });
      return { correctionId, correctedMemoryId: correctedId };
    });
  }

  /**
   * Re-validates a STALE memory (Founder review): it returns to ACTIVE with a new review horizon and a
   * history row. Staleness is decay, not deletion; a superseded / incorrect / corrupt memory never returns.
   */
  revalidateMemory(actorRef: string, memoryId: string, reasonCode: string): MemoryRecord {
    return founderAdminWrite(this.#store, 'revalidate memory', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'memory revalidation');
      const m = getMemoryRow(ctx, assertId(memoryId, 'memoryId'));
      if (m.status !== 'STALE' || m.integrity !== 'OK') throw new QandeelError('INVALID_TRANSITION', 'only a stale, intact memory is revalidated', { memoryId: m.id, status: m.status });
      assertNotContradictingCanonical(ctx, m.claimKey, m.claimValue);
      const at = ts(ctx);
      return setMemoryStatus(ctx, m, 'ACTIVE', assertCode(reasonCode, 'reasonCode'), p.ref, { validatedAt: at, reviewAt: addDays(at, REVIEW_AFTER_DAYS[m.memoryClass]) });
    });
  }

  // --- Company Knowledge ------------------------------------------------------------------------------

  /** Founder-curated knowledge (e.g. Academy source material). Shared learning arrives through promotion instead. */
  recordKnowledge(actorRef: string, input: KnowledgeInput): KnowledgeRecord {
    return founderAdminWrite(this.#store, 'record knowledge', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'company knowledge');
      const scope = assertKnowledgeScope(input.scope);
      const id = insertKnowledge(ctx, {
        scope,
        scopeRef: scopeRefFor(scope, input.scopeRef),
        topic: assertKeyCode(input.topic, 'topic'),
        claimKey: optKey(input.claimKey, 'claimKey'),
        claimValue: optKey(input.claimValue, 'claimValue'),
        content: text(input.content, 'content', 4_000),
        dataClass: assertDataClass(input.dataClass, 'dataClass'),
        marketRef: input.marketRef === undefined ? null : assertOpaqueRef(input.marketRef, 'marketRef'),
        provenanceKind: 'FOUNDER_DECISION',
        provenanceRef: `principal:${p.ref.slice(8)}`,
        confidencePct: input.confidencePct === undefined ? 90 : Math.max(0, Math.min(100, Math.trunc(input.confidencePct))),
        reviewAt: addDays(ts(ctx), input.reviewAfterDays === undefined ? 365 : Math.max(1, Math.min(3650, Math.trunc(input.reviewAfterDays)))),
        supersedesId: input.supersedes === undefined ? null : assertId(input.supersedes, 'supersedes'),
        actorRef: p.ref,
      });
      return getKnowledgeRow(ctx, id);
    });
  }

  knowledge(id: Id): KnowledgeRecord {
    return this.#read((ctx) => getKnowledgeRow(ctx, id));
  }

  /**
   * G4-FINAL-CLOSURE-01 (D-P1-17): records (or amends) a Founder decision from the Founder's own message — the Founder's
   * act only, inside the governed confirmation. Re-planned here: the content and the amended version must be exactly the
   * previewed ones, else nothing is written. One knowledge row (+ its history), the supersession of the prior version, and
   * a content-free audit row commit together. It changes no budget, grant, assignment or approval.
   */
  recordFounderDecision(actorRef: string, input: FounderDecisionInput & { readonly expectedContentSha256?: string; readonly expectedSupersedesVersion?: number; readonly reasonCode?: string }): KnowledgeRecord {
    return founderAdminWrite(this.#store, 'record founder decision', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'founder decision');
      const plan = txPlanFounderDecision(ctx, input);
      if (input.expectedContentSha256 !== undefined && input.expectedContentSha256 !== plan.contentSha256) throw new QandeelError('INVALID_TRANSITION', 'the decision changed since the preview', { reason: 'PREVIEW_STALE' });
      if (input.expectedSupersedesVersion !== undefined && input.expectedSupersedesVersion !== (plan.supersedes?.version ?? 0)) throw new QandeelError('VERSION_CONFLICT', 'the amended decision changed since the preview', { reason: 'PREVIEW_STALE' });
      const at = ts(ctx);
      const id = insertKnowledge(ctx, {
        scope: plan.scope,
        scopeRef: plan.scopeRef,
        topic: FOUNDER_DECISION_TOPIC,
        claimKey: plan.decisionKey,
        claimValue: `v${plan.version}`,
        content: plan.content,
        dataClass: plan.dataClass,
        marketRef: null,
        provenanceKind: 'FOUNDER_DECISION',
        provenanceRef: `${FOUNDER_DECISION_SOURCE}${plan.messageId}`,
        confidencePct: 100,
        reviewAt: addDays(at, FOUNDER_DECISION_REVIEW_DAYS),
        supersedesId: plan.supersedes?.id ?? null,
        actorRef: p.ref,
        indexText: { topic: '', text: `${plan.subject}\n${plan.statement}` },
      });
      // Rule A: IDs, codes and versions only — the decision's words live in the knowledge item alone.
      appendAudit(ctx, 'founder_decision.recorded', 'knowledge', id, { actorRef: p.ref }, 'OK', assertCode(input.reasonCode ?? 'founder.decision', 'reasonCode'), { messageId: plan.messageId, threadId: plan.threadId, audience: plan.audience, dataClass: plan.dataClass, decisionVersion: plan.version, supersedesId: plan.supersedes?.id ?? null });
      return getKnowledgeRow(ctx, id);
    });
  }

  /** Revokes a Founder decision in force (ARCHIVED, terminal; its history stays). The Founder's act only. */
  revokeFounderDecision(actorRef: string, decisionId: string, input: { readonly messageId?: unknown; readonly expectedVersion?: number; readonly reasonCode?: string } = {}): KnowledgeRecord {
    return founderAdminWrite(this.#store, 'revoke founder decision', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'founder decision');
      const plan = txPlanFounderDecisionRevoke(ctx, { decisionId, messageId: input.messageId });
      const k = plan.decision;
      if (input.expectedVersion !== undefined && input.expectedVersion !== k.version) throw new QandeelError('VERSION_CONFLICT', 'the decision changed since the preview', { reason: 'PREVIEW_STALE' });
      setKnowledgeStatus(ctx, k, 'ARCHIVED', 'founder_decision.revoked', p.ref);
      appendAudit(ctx, 'founder_decision.revoked', 'knowledge', k.id, { actorRef: p.ref }, 'OK', assertCode(input.reasonCode ?? 'founder.decision_revoked', 'reasonCode'), { messageId: plan.messageId });
      return getKnowledgeRow(ctx, k.id);
    });
  }

  /** The decisions recorded from one Founder ↔ CEO conversation, in force and history (Founder-scoped content; a read). */
  founderDecisions(threadId: Id): FounderDecisionView[] {
    return this.#read((ctx) => txFounderDecisionsOfThread(ctx, threadId));
  }

  // --- Learning validation and promotion (Stage 5 §4, §10) ---------------------------------------------

  /**
   * Nominates a recorded observation as a lesson candidate. Deliberate and attributed (a mistake is not
   * automatically a lesson): the Founder's path. Classified, work-derived learning under a Review Plan that
   * delegates judgment goes to independent Review Pool review instead (ImprovementStore.requestLearningReview).
   * The observation stays as recorded; the candidate links to it.
   */
  nominateLesson(actorRef: string, observationId: string, reasonCode: string): LessonRecord {
    return founderAdminWrite(this.#store, 'nominate lesson', actorRef, (ctx) => {
      const o = getLesson(ctx, assertId(observationId, 'observationId'));
      const p = founder(ctx, actorRef, `employee:${o.employeeId}`, 'lesson nomination');
      if (o.stage !== 'OBSERVATION') throw new QandeelError('INVALID_TRANSITION', 'only a recorded observation is nominated', { lessonId: o.id, stage: o.stage });
      if (ctx.db.get(`SELECT 1 AS x FROM lessons WHERE observation_id = ?`, o.id)) throw new QandeelError('INVALID_TRANSITION', 'this observation already has a lesson candidate', { lessonId: o.id, reason: 'ALREADY_NOMINATED' });
      const r = ctx.db.get<{ content: string; candidate_id: string }>('SELECT content, candidate_id FROM lessons WHERE id = ?', o.id);
      const id = insertLesson(ctx, { employeeId: o.employeeId, kind: 'LESSON', observationId: o.id, eventRef: o.eventRef, topic: o.topic, claimKey: o.claimKey, claimValue: o.claimValue, content: String(r?.content), dataClass: o.dataClass, marketRef: o.marketRef, candidateId: (r?.candidate_id ?? null) as Id | null });
      appendAudit(ctx, 'learning.nominated', 'lesson', id, { actorRef: p.ref }, 'OK', assertCode(reasonCode, 'reasonCode'), { observationId: o.id });
      return getLesson(ctx, id);
    });
  }

  /**
   * Requests independent review of a lesson candidate. Where its work's Review Plan delegates judgment (C6-R1),
   * one independent qualified judge is drawn from the C4 Review Pool; otherwise it waits for the Founder.
   */
  requestLessonReview(lessonId: string): LessonRecord {
    return this.#write('request lesson review', (ctx) => {
      const l = getLesson(ctx, assertId(lessonId, 'lessonId'));
      if (l.stage !== 'LESSON_CANDIDATE') throw new QandeelError('INVALID_TRANSITION', 'only a lesson candidate goes to review', { lessonId: l.id, stage: l.stage });
      ctx.db.run(`UPDATE lessons SET stage = 'UNDER_REVIEW', review_path = 'INDEPENDENT_REVIEW', version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, ts(ctx), l.id, l.version);
      lessonHistory(ctx, l, 'UNDER_REVIEW', 'lesson.review_requested', SYSTEM_MIND_REF);
      txRequestLessonJudgment(ctx, l.id);
      return getLesson(ctx, l.id);
    });
  }

  /** Validates or rejects a lesson on the Founder's path (the maker is never the validator; C6 gate in txDecideLesson). */
  validateLesson(actorRef: string, lessonId: string, input: { decision: 'VALIDATE' | 'REJECT'; reasonCode: string }): LessonRecord {
    return founderAdminWrite(this.#store, 'validate lesson', actorRef, (ctx) => {
      const l = getLesson(ctx, assertId(lessonId, 'lessonId'));
      const p = founder(ctx, actorRef, `employee:${l.employeeId}`, 'lesson validation');
      txDecideLesson(ctx, l.id, input.decision === 'VALIDATE' ? 'VALIDATE' : 'REJECT', assertCode(input.reasonCode, 'reasonCode'), { ref: p.ref, path: 'FOUNDER' });
      return getLesson(ctx, l.id);
    });
  }

  /**
   * Promotes a VALIDATED lesson. PERSONAL becomes a Personal Lesson memory of its own Employee at once;
   * every shared target waits for independent review (PENDING_REVIEW) — nothing is shared by default.
   */
  requestPromotion(requesterRef: string, lessonId: string, target: PromotionTarget, targetRef?: string): PromotionRecord {
    return this.#write('request promotion', (ctx) => {
      const l = getLesson(ctx, assertId(lessonId, 'lessonId'));
      if (l.stage !== 'VALIDATED') throw new QandeelError('INVALID_TRANSITION', 'only a validated lesson is promoted', { lessonId: l.id, stage: l.stage, reason: 'LESSON_NOT_VALIDATED' });
      if (!(PROMOTION_TARGETS as readonly string[]).includes(target)) throw new QandeelError('VALIDATION_FAILED', 'unknown promotion target', { field: 'target' });
      const ref = target === 'PERSONAL' || target === 'COMPANY' ? null : scopeRefFor(PROMOTION_SCOPE[target], targetRef);
      // The requester is data, never an actor: a request carries no authority (and cannot claim the Founder's).
      const requester = assertOpaqueRef(requesterRef, 'requesterRef');
      if (requester.startsWith('founder:') || requester.startsWith('principal:')) throw new QandeelError('VALIDATION_FAILED', 'a promotion request cannot claim Founder authority', { field: 'requesterRef' });
      if (ctx.db.get(`SELECT 1 AS x FROM lesson_promotions WHERE lesson_id = ? AND target = ? AND COALESCE(target_ref, '') = ?`, l.id, target, ref ?? '')) throw new QandeelError('INVALID_TRANSITION', 'this lesson already has a promotion to that target', { lessonId: l.id, reason: 'PROMOTION_EXISTS' });
      const id = newId();
      const at = ts(ctx);
      ctx.db.run(`INSERT INTO lesson_promotions (id, lesson_id, target, target_ref, state, requested_by_ref, created_at) VALUES (?, ?, ?, ?, 'PENDING_REVIEW', ?, ?)`, id, l.id, target, ref, requester, at);
      if (!requiresIndependentReview(target)) {
        const content = String(ctx.db.get<{ c: string }>('SELECT content AS c FROM lessons WHERE id = ?', l.id)?.c);
        const memoryId = insertMemory(
          ctx,
          { employeeId: l.employeeId, memoryClass: 'PERSONAL_LESSON', topic: l.topic, claimKey: l.claimKey, claimValue: l.claimValue, content, fingerprint: contentFingerprint(content), terms: indexTerms(l.topic, content), dataClass: l.dataClass, marketRef: l.marketRef, projectRef: null, provenanceKind: 'VALIDATED_LESSON', provenanceRef: `lesson:${l.id}`, sourceVersion: null, sourceSha256: null, evidenceRefs: [l.eventRef], confidencePct: 80, status: 'ACTIVE', retentionPolicy: 'REVIEW_AFTER_365D', reviewAt: addDays(at, 365), candidateId: null, supersedesId: null, validatedAt: at },
          SYSTEM_MIND_REF,
          'learning.promoted_personal',
        );
        // A promoted lesson may disagree with a live memory on its claim: a conflict is opened exactly as the Memory
        // Write Policy opens one (both kept, important work held), never an automatic supersession (R2-27).
        txOpenMemoryConflicts(ctx, memoryId, l.employeeId, l.claimKey, liveClaimDisagreements(ctx, l.employeeId, l.claimKey, l.claimValue, memoryId));
        ctx.db.run(`UPDATE lesson_promotions SET state = 'APPROVED', result_memory_id = ?, decided_by_ref = ?, reason_code = 'PERSONAL_SCOPE', decided_at = ? WHERE id = ?`, memoryId, l.decidedByRef ?? SYSTEM_MIND_REF, at, id);
      }
      appendAudit(ctx, 'learning.promotion_requested', 'lesson', l.id, { actorRef: SYSTEM_MIND_REF }, 'OK', target, { promotionId: id });
      return mapPromotion(ctx.db.get('SELECT * FROM lesson_promotions WHERE id = ?', id) ?? {});
    });
  }

  /**
   * Decides a shared promotion. Widening a lesson's force beyond its Employee (team, Department, Company) is
   * governed scope expansion and stays the Founder's decision: validating a lesson (C6-R1) never shares it.
   */
  decidePromotion(actorRef: string, promotionId: string, input: { decision: 'APPROVE' | 'REJECT'; reasonCode: string; dataClass?: DataClass }): PromotionRecord {
    return founderAdminWrite(this.#store, 'decide promotion', actorRef, (ctx) => {
      const pr = mapPromotion(ctx.db.get('SELECT * FROM lesson_promotions WHERE id = ?', assertId(promotionId, 'promotionId')) ?? notFound('promotion', promotionId));
      const l = getLesson(ctx, pr.lessonId);
      const p = founder(ctx, actorRef, `employee:${l.employeeId}`, 'knowledge promotion');
      if (pr.state !== 'PENDING_REVIEW') throw new QandeelError('INVALID_TRANSITION', 'only a pending promotion is decided', { promotionId: pr.id });
      const reason = assertCode(input.reasonCode, 'reasonCode');
      const at = ts(ctx);
      if (input.decision === 'REJECT') {
        ctx.db.run(`UPDATE lesson_promotions SET state = 'REJECTED', decided_by_ref = ?, reason_code = ?, decided_at = ? WHERE id = ?`, p.ref, reason, at, pr.id);
      } else {
        if (pr.target === 'PERSONAL') throw new QandeelError('INVALID_TRANSITION', 'personal promotion needs no review', { promotionId: pr.id });
        // C6: a successful pattern becomes shared practice only after verified reuse.
        const share = txPatternShareGate(ctx, l.id, pr.target);
        if (!share.allowed) throw new QandeelError('LEARNING_GATE', 'a successful pattern is shared only after verified reuse', { promotionId: pr.id, reason: share.reason });
        // Sharing D3 / D4 work-derived content stays closed until the Product Owner defines it (Rule C / Stage 14).
        const shared = maxDataClass(l.dataClass, input.dataClass ?? 'D0');
        if (shared === 'D3' || shared === 'D4') throw new QandeelError('VALIDATION_FAILED', 'shared promotion of D3 / D4 content is not authorized', { reason: 'DATA_CLASS_NOT_SHAREABLE', promotionId: pr.id });
        const content = String(ctx.db.get<{ c: string }>('SELECT content AS c FROM lessons WHERE id = ?', l.id)?.c);
        const scope = PROMOTION_SCOPE[pr.target];
        const knowledgeId = insertKnowledge(ctx, { scope, scopeRef: pr.targetRef, topic: l.topic, claimKey: l.claimKey, claimValue: l.claimValue, content, dataClass: maxDataClass(l.dataClass, input.dataClass ?? 'D0'), marketRef: pr.target === 'MARKET' ? pr.targetRef : l.marketRef, provenanceKind: 'VALIDATED_LESSON', provenanceRef: `lesson:${l.id}`, confidencePct: 80, reviewAt: addDays(at, 365), supersedesId: null, actorRef: p.ref });
        ctx.db.run(`UPDATE lesson_promotions SET state = 'APPROVED', result_knowledge_id = ?, decided_by_ref = ?, reason_code = ?, decided_at = ? WHERE id = ?`, knowledgeId, p.ref, reason, at, pr.id);
      }
      appendAudit(ctx, 'learning.promotion_decided', 'lesson', l.id, { actorRef: p.ref }, 'OK', reason, { promotionId: pr.id, decision: input.decision });
      return mapPromotion(ctx.db.get('SELECT * FROM lesson_promotions WHERE id = ?', pr.id) ?? {});
    });
  }

  // --- Reads (metadata only) ----------------------------------------------------------------------------

  memory(id: Id): MemoryRecord {
    return this.#read((ctx) => getMemoryRow(ctx, id));
  }

  memories(employeeId: Id, filter: { status?: MemoryRecord['status']; limit?: number } = {}): MemoryRecord[] {
    const n = Math.max(1, Math.min(1_000, Math.trunc(filter.limit ?? 200)));
    return this.#read((ctx) =>
      (filter.status ? ctx.db.all('SELECT * FROM memory_records WHERE employee_id = ? AND status = ? ORDER BY created_at, id LIMIT ?', employeeId, filter.status, n) : ctx.db.all('SELECT * FROM memory_records WHERE employee_id = ? ORDER BY created_at, id LIMIT ?', employeeId, n)).map(mapMemory),
    );
  }

  memoryHistory(id: Id): { version: number; fromStatus: string | null; toStatus: string; reasonCode: string; actorRef: string }[] {
    return this.#read((ctx) =>
      ctx.db
        .all<{ version: number; from_status: string | null; to_status: string; reason_code: string; actor_ref: string }>('SELECT * FROM memory_history WHERE memory_id = ? ORDER BY version', id)
        .map((r) => ({ version: Number(r.version), fromStatus: r.from_status, toStatus: r.to_status, reasonCode: r.reason_code, actorRef: r.actor_ref })),
    );
  }

  candidates(workItemId: Id): MemoryCandidateRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM memory_candidates WHERE work_item_id = ? ORDER BY created_at, id', workItemId).map(mapCandidate));
  }

  pendingCandidates(): MemoryCandidateRecord[] {
    return this.#read((ctx) => ctx.db.all(`SELECT * FROM memory_candidates WHERE state = 'SUBMITTED' ORDER BY created_at, id`).map(mapCandidate));
  }

  conflicts(state?: 'OPEN' | 'RESOLVED'): MemoryConflictRecord[] {
    return this.#read((ctx) => (state ? ctx.db.all('SELECT * FROM memory_conflicts WHERE state = ? ORDER BY created_at, id', state) : ctx.db.all('SELECT * FROM memory_conflicts ORDER BY created_at, id')).map(mapConflict));
  }

  corrections(memoryId: Id): { id: Id; disposition: string; correctedMemoryId: Id | null; reasonCode: string; actorRef: string }[] {
    return this.#read((ctx) =>
      ctx.db
        .all<{ id: string; disposition: string; corrected_memory_id: string | null; reason_code: string; actor_ref: string }>('SELECT * FROM memory_corrections WHERE memory_id = ? ORDER BY created_at, id', memoryId)
        .map((r) => ({ id: r.id as Id, disposition: r.disposition, correctedMemoryId: r.corrected_memory_id as Id | null, reasonCode: r.reason_code, actorRef: r.actor_ref })),
    );
  }

  lessons(employeeId: Id): LessonRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM lessons WHERE employee_id = ? ORDER BY created_at, id', employeeId).map(mapLesson));
  }

  lesson(id: Id): LessonRecord {
    return this.#read((ctx) => getLesson(ctx, id));
  }

  promotions(lessonId: Id): PromotionRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM lesson_promotions WHERE lesson_id = ? ORDER BY created_at, id', lessonId).map(mapPromotion));
  }

  manifest(id: Id): ContextManifestRecord {
    return this.#read((ctx) => mapManifest(ctx.db.get('SELECT * FROM context_manifests WHERE id = ?', id) ?? notFound('context manifest', id)));
  }

  manifestsFor(runOrWorkItemId: Id): ContextManifestRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM context_manifests WHERE run_id = ? OR work_item_id = ? ORDER BY created_at, inference_seq', runOrWorkItemId, runOrWorkItemId).map(mapManifest));
  }

  manifestEntries(manifestId: Id): ManifestEntryRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM context_manifest_entries WHERE manifest_id = ? ORDER BY ordinal', manifestId).map(mapManifestEntry));
  }

  summaries(employeeId: Id): SummaryRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM context_summaries WHERE employee_id = ? ORDER BY created_at, id', employeeId).map(mapSummary));
  }

  healthCounts(): MindHealth {
    return this.#read((ctx) => {
      const n = (sql: string, ...p: string[]): number => Number(ctx.db.get<{ n: number }>(sql, ...p)?.n ?? 0);
      const at = ts(ctx);
      const group = (sql: string): Record<string, number> => Object.fromEntries(ctx.db.all<{ s: string; n: number }>(sql).map((r) => [r.s, Number(r.n)]));
      return {
        memories: group('SELECT status AS s, COUNT(*) AS n FROM memory_records GROUP BY status'),
        memoryIntegrityFailures: n(`SELECT COUNT(*) AS n FROM memory_records WHERE integrity = 'CORRUPT'`),
        memoryConflictsOpen: n(`SELECT COUNT(*) AS n FROM memory_conflicts WHERE state = 'OPEN'`),
        memoryStaleDue: n(`SELECT COUNT(*) AS n FROM memory_records WHERE status IN ('ACTIVE', 'LOW_CONFIDENCE') AND review_at IS NOT NULL AND review_at <= ?`, at),
        candidatesPending: n(`SELECT COUNT(*) AS n FROM memory_candidates WHERE state = 'SUBMITTED'`),
        knowledge: group("SELECT scope || ':' || status AS s, COUNT(*) AS n FROM knowledge_items GROUP BY scope, status"),
        knowledgeIntegrityFailures: n(`SELECT COUNT(*) AS n FROM knowledge_items WHERE integrity = 'CORRUPT'`),
        canonicalIntegrityFailures: n(`SELECT COUNT(*) AS n FROM canonical_truth WHERE integrity = 'CORRUPT' AND status = 'ACTIVE'`),
        lessonsAwaitingReview: n(`SELECT COUNT(*) AS n FROM lessons WHERE stage IN ('LESSON_CANDIDATE', 'UNDER_REVIEW')`),
        promotionsPendingReview: n(`SELECT COUNT(*) AS n FROM lesson_promotions WHERE state = 'PENDING_REVIEW'`),
        contextManifests: n('SELECT COUNT(*) AS n FROM context_manifests'),
        contextFailures: n(`SELECT COUNT(*) AS n FROM context_manifests WHERE outcome <> 'OK'`),
        summariesValid: n(`SELECT COUNT(*) AS n FROM context_summaries WHERE status = 'VALID'`),
      };
    });
  }
}

function notFound(what: string, id: string): never {
  throw new QandeelError('NOT_FOUND', `${what} not found`, { id });
}
