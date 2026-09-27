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
import { appendAudit, ts, type StoreContext } from './internal.js';
import { SYSTEM_MIND_REF, getKnowledgeRow, getMemoryRow, indexTerms, insertMemory, setMemoryStatus } from './mind-core.js';
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
  }
  for (const k of ctx.db.all(`SELECT * FROM knowledge_items WHERE claim_key = ? AND claim_value <> ? AND status IN ('ACTIVE', 'LOW_CONFIDENCE', 'STALE')`, claimKey, claimValue).map(mapKnowledge)) {
    setKnowledgeStatus(ctx, k, 'INCORRECT', 'CONTRADICTS_CANONICAL', actorRef);
  }
}

function setKnowledgeStatus(ctx: StoreContext, k: KnowledgeRecord, to: KnowledgeRecord['status'], reasonCode: string, actorRef: string, supersededById: Id | null = null): void {
  const changed = ctx.db.run('UPDATE knowledge_items SET status = ?, superseded_by_id = COALESCE(?, superseded_by_id), version = version + 1, updated_at = ? WHERE id = ? AND version = ?', to, supersededById, ts(ctx), k.id, k.version).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'knowledge changed concurrently', { knowledgeId: k.id });
  ctx.db.run('INSERT INTO knowledge_history (knowledge_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', k.id, k.version + 1, k.status, to, reasonCode, actorRef, ts(ctx));
  appendAudit(ctx, 'knowledge.status', 'knowledge', k.id, { actorRef }, 'OK', reasonCode, { from: k.status, to });
}

function insertKnowledge(ctx: StoreContext, f: { scope: KnowledgeScope; scopeRef: string | null; topic: string; claimKey: string | null; claimValue: string | null; content: string; dataClass: DataClass; marketRef: string | null; provenanceKind: 'VALIDATED_LESSON' | 'FOUNDER_DECISION' | 'CANONICAL'; provenanceRef: string; confidencePct: number; reviewAt: Timestamp | null; supersedesId: Id | null; actorRef: string }): Id {
  if (f.claimKey !== null) {
    const canon = ctx.db.get<{ claim_value: string }>(`SELECT claim_value FROM canonical_truth WHERE claim_key = ? AND status = 'ACTIVE'`, f.claimKey);
    if (canon && canon.claim_value !== f.claimValue) throw new QandeelError('VALIDATION_FAILED', 'knowledge may not contradict canonical truth', { reason: 'CONTRADICTS_CANONICAL' });
    const clash = ctx.db.get<{ id: string }>(`SELECT id FROM knowledge_items WHERE scope = ? AND COALESCE(scope_ref, '') = ? AND claim_key = ? AND status IN ('ACTIVE', 'LOW_CONFIDENCE') AND id IS NOT ?`, f.scope, f.scopeRef ?? '', f.claimKey, f.supersedesId);
    if (clash) throw new QandeelError('VALIDATION_FAILED', 'this scope already holds knowledge for the claim; supersede it explicitly', { reason: 'KNOWLEDGE_CONFLICT', knowledgeId: clash.id });
  }
  const id = newId();
  const at = ts(ctx);
  // The predecessor is superseded first (its successor link is a deferred reference), so the unique
  // active-claim rule never sees two live records.
  if (f.supersedesId !== null && !['ACTIVE', 'LOW_CONFIDENCE', 'STALE'].includes(getKnowledgeRow(ctx, f.supersedesId).status)) throw new QandeelError('INVALID_TRANSITION', 'only live knowledge is superseded', { knowledgeId: f.supersedesId });
  if (f.supersedesId !== null) setKnowledgeStatus(ctx, getKnowledgeRow(ctx, f.supersedesId), 'SUPERSEDED', 'knowledge.superseded', f.actorRef, id);
  ctx.db.run(
    `INSERT INTO knowledge_items (id, scope, scope_ref, topic, claim_key, claim_value, content, content_sha256, fingerprint, terms_json, data_class, market_ref, provenance_kind, provenance_ref, confidence_pct, status, integrity, review_at, last_validated_at, supersedes_id, version, created_by_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'OK', ?, ?, ?, 1, ?, ?, ?)`,
    id, f.scope, f.scopeRef, f.topic, f.claimKey, f.claimValue, f.content, sha256Hex(f.content), contentFingerprint(f.content), JSON.stringify(indexTerms(f.topic, f.content)), f.dataClass, f.marketRef, f.provenanceKind, f.provenanceRef, f.confidencePct, f.reviewAt, at, f.supersedesId, f.actorRef, at, at,
  );
  ctx.db.run('INSERT INTO knowledge_history (knowledge_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, ?, ?, ?, ?)', id, 'ACTIVE', 'knowledge.recorded', f.actorRef, at);
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
      }
      appendAudit(ctx, 'memory.corrected', 'memory', m.id, { actorRef: p.ref }, 'OK', reason, { disposition: to, correctedMemoryId: correctedId });
      return { correctionId, correctedMemoryId: correctedId };
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

  // --- Learning validation and promotion (Stage 5 §4, §10) ---------------------------------------------

  /** Requests validation of a lesson candidate. The independent review path (C4) does not exist, so it waits. */
  requestLessonReview(lessonId: string): LessonRecord {
    return this.#write('request lesson review', (ctx) => {
      const l = getLesson(ctx, assertId(lessonId, 'lessonId'));
      if (l.stage !== 'LESSON_CANDIDATE') throw new QandeelError('INVALID_TRANSITION', 'only a lesson candidate goes to review', { lessonId: l.id, stage: l.stage });
      ctx.db.run(`UPDATE lessons SET stage = 'UNDER_REVIEW', review_path = 'INDEPENDENT_REVIEW', version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, ts(ctx), l.id, l.version);
      lessonHistory(ctx, l, 'UNDER_REVIEW', 'REVIEW_PATH_UNAVAILABLE', SYSTEM_MIND_REF);
      return getLesson(ctx, l.id);
    });
  }

  /** Validates or rejects a lesson (Founder review path; the maker is never the validator). */
  validateLesson(actorRef: string, lessonId: string, input: { decision: 'VALIDATE' | 'REJECT'; reasonCode: string }): LessonRecord {
    return founderAdminWrite(this.#store, 'validate lesson', actorRef, (ctx) => {
      const l = getLesson(ctx, assertId(lessonId, 'lessonId'));
      const p = founder(ctx, actorRef, `employee:${l.employeeId}`, 'lesson validation');
      if (!['LESSON_CANDIDATE', 'UNDER_REVIEW'].includes(l.stage)) throw new QandeelError('INVALID_TRANSITION', 'only a lesson candidate is validated', { lessonId: l.id, stage: l.stage });
      const to = input.decision === 'VALIDATE' ? 'VALIDATED' : 'REJECTED';
      ctx.db.run(`UPDATE lessons SET stage = ?, review_path = 'FOUNDER', decided_by_ref = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, to, p.ref, ts(ctx), l.id, l.version);
      lessonHistory(ctx, l, to, assertCode(input.reasonCode, 'reasonCode'), p.ref);
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
      const requester = assertOpaqueRef(requesterRef, 'requesterRef');
      const id = newId();
      const at = ts(ctx);
      ctx.db.run(`INSERT INTO lesson_promotions (id, lesson_id, target, target_ref, state, requested_by_ref, created_at) VALUES (?, ?, ?, ?, 'PENDING_REVIEW', ?, ?)`, id, l.id, target, ref, requester, at);
      if (!requiresIndependentReview(target)) {
        const content = String(ctx.db.get<{ c: string }>('SELECT content AS c FROM lessons WHERE id = ?', l.id)?.c);
        const memoryId = insertMemory(
          ctx,
          { employeeId: l.employeeId, memoryClass: 'PERSONAL_LESSON', topic: l.topic, claimKey: l.claimKey, claimValue: l.claimValue, content, fingerprint: contentFingerprint(content), terms: indexTerms(l.topic, content), dataClass: l.dataClass, marketRef: null, projectRef: null, provenanceKind: 'VALIDATED_LESSON', provenanceRef: `lesson:${l.id}`, sourceVersion: null, sourceSha256: null, evidenceRefs: [l.eventRef], confidencePct: 80, status: 'ACTIVE', retentionPolicy: 'REVIEW_AFTER_365D', reviewAt: addDays(at, 365), candidateId: null, supersedesId: null, validatedAt: at },
          SYSTEM_MIND_REF,
          'learning.promoted_personal',
        );
        ctx.db.run(`UPDATE lesson_promotions SET state = 'APPROVED', result_memory_id = ?, decided_by_ref = ?, reason_code = 'PERSONAL_SCOPE', decided_at = ? WHERE id = ?`, memoryId, l.decidedByRef ?? SYSTEM_MIND_REF, at, id);
      }
      appendAudit(ctx, 'learning.promotion_requested', 'lesson', l.id, { actorRef: requester }, 'OK', target, { promotionId: id });
      return mapPromotion(ctx.db.get('SELECT * FROM lesson_promotions WHERE id = ?', id) ?? {});
    });
  }

  /** Decides a shared promotion (independent review — the Founder in Strong v1; the Review Pool is C4). */
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
        const content = String(ctx.db.get<{ c: string }>('SELECT content AS c FROM lessons WHERE id = ?', l.id)?.c);
        const scope = PROMOTION_SCOPE[pr.target];
        const knowledgeId = insertKnowledge(ctx, { scope, scopeRef: pr.targetRef, topic: l.topic, claimKey: l.claimKey, claimValue: l.claimValue, content, dataClass: maxDataClass(l.dataClass, input.dataClass ?? 'D0'), marketRef: pr.target === 'MARKET' ? pr.targetRef : null, provenanceKind: 'VALIDATED_LESSON', provenanceRef: `lesson:${l.id}`, confidencePct: 80, reviewAt: addDays(at, 365), supersedesId: null, actorRef: p.ref });
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
        knowledge: group('SELECT scope || ":" || status AS s, COUNT(*) AS n FROM knowledge_items GROUP BY scope, status'),
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
