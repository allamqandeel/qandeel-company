/**
 * Employee Memory and Company Knowledge contracts, and the runtime-owned Memory Write Policy
 * (Stage 5 §1–§7, §10–§13). Pure and deterministic.
 *
 * Memory ≠ Canonical Truth ≠ Company Knowledge ≠ Decision ≠ Policy ≠ Evidence ≠ Session.
 *
 * Events, conversations and model output never become memory by themselves: an Employee (or its
 * model) submits a structured MEMORY CANDIDATE and this policy — not the candidate — decides whether
 * it is stored, as which class, in which scope, with what confidence bound, retention and review
 * requirement. Every decision reads only structured fields; the candidate's text is never
 * interpreted, so no natural-language instruction can grant memory authority.
 */
import { QandeelError, isTimestamp, type Timestamp } from '@qandeel-company/domain';
import { assertDataClass, maxDataClass, type DataClass } from '@qandeel-company/governance';

import { KEY_CODE, containsSecretMaterial, contentFingerprint, similarityPct, terms } from './text.js';

export const MEMORY_CLASSES = ['PROFESSIONAL', 'EXPERIENCE', 'RELATIONSHIP_COLLABORATION', 'CURRENT_WORK', 'PERSONAL_LESSON'] as const;
export type MemoryClass = (typeof MEMORY_CLASSES)[number];

export const MEMORY_STATUSES = ['ACTIVE', 'LOW_CONFIDENCE', 'STALE', 'SUPERSEDED', 'INCORRECT', 'ARCHIVED'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

/** Statuses a record may be retrieved in (a STALE / LOW_CONFIDENCE record is down-weighted, never trusted as ACTIVE). */
export const RETRIEVABLE_STATUSES: readonly MemoryStatus[] = ['ACTIVE', 'LOW_CONFIDENCE'];

/** Company Knowledge layers (Stage 5 §2). */
export const KNOWLEDGE_SCOPES = ['COMPANY', 'DEPARTMENT', 'ROLE', 'MARKET', 'RESTRICTED', 'FOUNDER_ONLY'] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

/** Where a record came from. The provenance kind bounds what a candidate of each class may claim. */
export const PROVENANCE_KINDS = ['RUN', 'WORK_ITEM', 'FOUNDER_CORRECTION', 'VALIDATED_LESSON', 'KNOWLEDGE', 'CANONICAL', 'SKILL_VERSION', 'ACADEMY'] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

/** Canonical truth authority levels (Stage 2 §5 ordering; CONSTITUTION outranks everything). */
export const CANONICAL_LEVELS = ['CONSTITUTION', 'POLICY', 'DECISION', 'VERIFIED_FACT'] as const;
export type CanonicalLevel = (typeof CANONICAL_LEVELS)[number];

/**
 * Engineering constants of the Memory Write Policy. They are internal, non-canonical calibration
 * values (confidence is an integer percentage used only for deterministic ranking), surfaced to the
 * Product Owner rather than presented as a Product contract.
 */
export const CONFIDENCE_CAP: Readonly<Record<Exclude<MemoryClass, 'PERSONAL_LESSON'>, number>> = { CURRENT_WORK: 80, EXPERIENCE: 70, RELATIONSHIP_COLLABORATION: 60, PROFESSIONAL: 70 };
/** Without evidence references a candidate is capped here and stored LOW_CONFIDENCE. */
export const UNEVIDENCED_CONFIDENCE_CAP = 40;
export const LOW_CONFIDENCE_BELOW = 50;
/** Review horizon per class (days). After it the record is STALE until revalidated. */
export const REVIEW_AFTER_DAYS: Readonly<Record<MemoryClass, number>> = { CURRENT_WORK: 30, EXPERIENCE: 365, RELATIONSHIP_COLLABORATION: 180, PROFESSIONAL: 180, PERSONAL_LESSON: 365 };
/** Near-duplicate threshold (Jaccard of normalized terms, same owner / class / topic). */
export const NEAR_DUPLICATE_PCT = 85;
export const MEMORY_CONTENT_MAX = 2_000;

/** Provenance kinds a direct candidate of each class may rest on (anything else is refused). */
const CANDIDATE_PROVENANCE: Readonly<Record<Exclude<MemoryClass, 'PERSONAL_LESSON'>, readonly ProvenanceKind[]>> = {
  CURRENT_WORK: ['RUN', 'WORK_ITEM'],
  EXPERIENCE: ['RUN', 'WORK_ITEM'],
  RELATIONSHIP_COLLABORATION: ['RUN', 'WORK_ITEM'],
  PROFESSIONAL: ['RUN', 'WORK_ITEM', 'KNOWLEDGE', 'SKILL_VERSION', 'ACADEMY'],
};

export interface Provenance {
  readonly kind: ProvenanceKind;
  /** Opaque reference `<kind>:<id>` of the source. */
  readonly ref: string;
  readonly version?: number | null;
  readonly sha256?: string | null;
}

/** A structured memory candidate. There is deliberately no status, scope, review or authority field. */
export interface MemoryCandidate {
  readonly memoryClass: MemoryClass;
  readonly topic: string;
  readonly claimKey?: string | null;
  readonly claimValue?: string | null;
  readonly content: string;
  readonly confidencePct: number;
  readonly dataClass: DataClass;
  readonly marketRef?: string | null;
  readonly projectRef?: string | null;
  readonly evidenceRefs: readonly string[];
  readonly provenance: Provenance;
}

const REF = /^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._:-]{1,128}$/;
const CANDIDATE_KEYS = new Set(['memoryClass', 'topic', 'claimKey', 'claimValue', 'content', 'confidencePct', 'dataClass', 'marketRef', 'projectRef', 'evidenceRefs', 'provenance']);

/** Validates an untrusted candidate shape (closed key set, bounded fields). Throws VALIDATION_FAILED. */
export function assertMemoryCandidate(v: unknown): MemoryCandidate {
  const fail = (field: string, why: string): never => {
    throw new QandeelError('VALIDATION_FAILED', `memory candidate ${field} ${why}`, { field });
  };
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('', 'must be an object');
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!CANDIDATE_KEYS.has(k)) fail(k, 'is not a candidate field (status, scope and authority are decided by the policy)');
  if (!(MEMORY_CLASSES as readonly unknown[]).includes(o.memoryClass)) fail('memoryClass', 'is unknown');
  if (typeof o.topic !== 'string' || o.topic.length > 96 || !KEY_CODE.test(o.topic)) fail('topic', 'must be a short dotted code');
  if (o.claimKey !== undefined && o.claimKey !== null && (typeof o.claimKey !== 'string' || o.claimKey.length > 96 || !KEY_CODE.test(o.claimKey))) fail('claimKey', 'must be a short dotted code');
  if (o.claimValue !== undefined && o.claimValue !== null && (typeof o.claimValue !== 'string' || o.claimValue.length > 96 || !KEY_CODE.test(o.claimValue))) fail('claimValue', 'must be a short dotted code');
  if ((o.claimKey ?? null) === null !== ((o.claimValue ?? null) === null)) fail('claimValue', 'is given exactly when claimKey is');
  if (typeof o.content !== 'string' || o.content.trim().length === 0 || o.content.length > MEMORY_CONTENT_MAX) fail('content', `must be 1..${MEMORY_CONTENT_MAX} characters`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(o.content as string)) fail('content', 'contains control characters');
  if (typeof o.confidencePct !== 'number' || !Number.isInteger(o.confidencePct) || o.confidencePct < 0 || o.confidencePct > 100) fail('confidencePct', 'must be an integer 0..100');
  assertDataClass(o.dataClass, 'memory candidate dataClass');
  for (const f of ['marketRef', 'projectRef'] as const) if (o[f] !== undefined && o[f] !== null && (typeof o[f] !== 'string' || !REF.test(o[f] as string))) fail(f, 'must be an opaque ref');
  if (!Array.isArray(o.evidenceRefs) || o.evidenceRefs.length > 16 || o.evidenceRefs.some((r) => typeof r !== 'string' || !REF.test(r))) fail('evidenceRefs', 'must be ≤ 16 opaque refs');
  const p = o.provenance as Record<string, unknown> | null;
  if (typeof p !== 'object' || p === null) fail('provenance', 'is required');
  const prov = p as Record<string, unknown>;
  if (!(PROVENANCE_KINDS as readonly unknown[]).includes(prov.kind)) fail('provenance.kind', 'is unknown');
  if (typeof prov.ref !== 'string' || !REF.test(prov.ref)) fail('provenance.ref', 'must be an opaque ref');
  return {
    memoryClass: o.memoryClass as MemoryClass,
    topic: o.topic as string,
    claimKey: (o.claimKey as string | null | undefined) ?? null,
    claimValue: (o.claimValue as string | null | undefined) ?? null,
    content: o.content as string,
    confidencePct: o.confidencePct as number,
    dataClass: o.dataClass as DataClass,
    marketRef: (o.marketRef as string | null | undefined) ?? null,
    projectRef: (o.projectRef as string | null | undefined) ?? null,
    evidenceRefs: [...new Set(o.evidenceRefs as string[])],
    provenance: { kind: prov.kind as ProvenanceKind, ref: prov.ref as string, version: typeof prov.version === 'number' ? prov.version : null, sha256: typeof prov.sha256 === 'string' ? prov.sha256 : null },
  };
}

/** What the policy knows about the owner's existing durable records (metadata only). */
export interface ExistingMemory {
  readonly id: string;
  readonly memoryClass: MemoryClass;
  readonly topic: string;
  readonly status: MemoryStatus;
  readonly fingerprint: string;
  readonly terms: readonly string[];
  readonly claimKey: string | null;
  readonly claimValue: string | null;
}

export interface CanonicalClaim {
  readonly id: string;
  readonly claimKey: string;
  readonly claimValue: string;
}

export interface PolicyContext {
  readonly now: Timestamp;
  /** The owner's comparable records (bounded by the caller). */
  readonly existing: readonly ExistingMemory[];
  /** ACTIVE canonical claims on the candidate's claim key (if any). */
  readonly canonical: readonly CanonicalClaim[];
  /** The data class of the source the candidate came from (the run's context): a candidate is never classified below it. */
  readonly sourceDataClass: DataClass;
}

export type PolicyDecision =
  | {
      readonly decision: 'STORE';
      readonly memoryClass: Exclude<MemoryClass, 'PERSONAL_LESSON'>;
      readonly scope: 'PERSONAL';
      readonly status: 'ACTIVE' | 'LOW_CONFIDENCE';
      readonly confidencePct: number;
      readonly dataClass: DataClass;
      readonly reviewAt: Timestamp;
      readonly retentionPolicy: string;
      readonly reviewRequired: false;
      readonly fingerprint: string;
      readonly terms: readonly string[];
      /** Existing non-canonical records asserting a different value for the same claim (a conflict is opened, both kept). */
      readonly conflictsWith: readonly string[];
    }
  /** A personal lesson is never stored directly: it enters the learning-validation path (Stage 5 §4). */
  | { readonly decision: 'ROUTE_TO_LEARNING'; readonly dataClass: DataClass; readonly fingerprint: string; readonly terms: readonly string[] }
  | { readonly decision: 'REFUSE'; readonly reason: RefusalReason; readonly duplicateOf: string | null };

export type RefusalReason = 'PROVENANCE_REQUIRED' | 'SECRET_MATERIAL' | 'DUPLICATE' | 'NEAR_DUPLICATE' | 'CONTRADICTS_CANONICAL';

export function addDays(at: Timestamp, days: number): Timestamp {
  return new Date(Date.parse(at) + days * 86_400_000).toISOString() as Timestamp;
}

/**
 * The Memory Write Policy. Deterministic: the same candidate and durable state always produce the
 * same decision. Refusals preserve the reason; nothing is silently dropped or silently merged.
 */
export function decideMemoryCandidate(c: MemoryCandidate, ctx: PolicyContext): PolicyDecision {
  if (!isTimestamp(ctx.now)) throw new QandeelError('VALIDATION_FAILED', 'policy time must be a canonical timestamp', { field: 'now' });
  // Secrets never enter memory (Stage 14 / Stage 12 §23), whatever the class.
  if (containsSecretMaterial(c.content)) return { decision: 'REFUSE', reason: 'SECRET_MATERIAL', duplicateOf: null };
  const fingerprint = contentFingerprint(c.content);
  const itemTerms = terms(`${c.topic.replace(/[.-]/g, ' ')} ${c.content}`);
  // A candidate is never classified below the context it came from (classification never fails open).
  const dataClass = maxDataClass(c.dataClass, ctx.sourceDataClass);
  const live = ctx.existing.filter((e) => e.status !== 'SUPERSEDED' && e.status !== 'INCORRECT' && e.status !== 'ARCHIVED');
  const exact = live.find((e) => e.fingerprint === fingerprint);
  if (exact) return { decision: 'REFUSE', reason: 'DUPLICATE', duplicateOf: exact.id };
  if (c.claimKey !== null && c.claimKey !== undefined) {
    // Canonical Truth wins immediately (Stage 5 §7): a contradicting candidate is never stored.
    if (ctx.canonical.some((k) => k.claimKey === c.claimKey && k.claimValue !== c.claimValue)) return { decision: 'REFUSE', reason: 'CONTRADICTS_CANONICAL', duplicateOf: null };
  }
  if (c.memoryClass === 'PERSONAL_LESSON') {
    if (!['RUN', 'WORK_ITEM'].includes(c.provenance.kind)) return { decision: 'REFUSE', reason: 'PROVENANCE_REQUIRED', duplicateOf: null };
    return { decision: 'ROUTE_TO_LEARNING', dataClass, fingerprint, terms: itemTerms };
  }
  if (!CANDIDATE_PROVENANCE[c.memoryClass].includes(c.provenance.kind)) return { decision: 'REFUSE', reason: 'PROVENANCE_REQUIRED', duplicateOf: null };
  const near = live.find((e) => e.memoryClass === c.memoryClass && e.topic === c.topic && similarityPct(e.terms, itemTerms) >= NEAR_DUPLICATE_PCT);
  if (near) return { decision: 'REFUSE', reason: 'NEAR_DUPLICATE', duplicateOf: near.id };
  let confidencePct = Math.min(c.confidencePct, CONFIDENCE_CAP[c.memoryClass]);
  if (c.evidenceRefs.length === 0) confidencePct = Math.min(confidencePct, UNEVIDENCED_CONFIDENCE_CAP);
  const conflictsWith = c.claimKey
    ? live.filter((e) => e.claimKey === c.claimKey && e.claimValue !== c.claimValue).map((e) => e.id).sort()
    : [];
  return {
    decision: 'STORE',
    memoryClass: c.memoryClass,
    scope: 'PERSONAL',
    status: confidencePct < LOW_CONFIDENCE_BELOW ? 'LOW_CONFIDENCE' : 'ACTIVE',
    confidencePct,
    dataClass,
    reviewAt: addDays(ctx.now, REVIEW_AFTER_DAYS[c.memoryClass]),
    retentionPolicy: `REVIEW_AFTER_${REVIEW_AFTER_DAYS[c.memoryClass]}D`,
    reviewRequired: false,
    fingerprint,
    terms: itemTerms,
    conflictsWith,
  };
}

/** Freshness of a retrievable record at `now`: past its review horizon, or its source changed → STALE. */
export function isStale(r: { readonly reviewAt: Timestamp | null; readonly sourceChanged: boolean }, now: Timestamp): boolean {
  return r.sourceChanged || (r.reviewAt !== null && r.reviewAt <= now);
}

/** Founder correction dispositions of the prior record (Stage 5 §5): additive, never a rewrite. */
export const CORRECTION_DISPOSITIONS = ['SUPERSEDED', 'INCORRECT', 'STALE'] as const;
export type CorrectionDisposition = (typeof CORRECTION_DISPOSITIONS)[number];

/** Learning-validation stages (Stage 5 §4): a mistake is not automatically a lesson. */
export const LESSON_STAGES = ['OBSERVATION', 'LESSON_CANDIDATE', 'UNDER_REVIEW', 'VALIDATED', 'REJECTED'] as const;
export type LessonStage = (typeof LESSON_STAGES)[number];

/** Promotion targets of a validated lesson (Stage 5 §10). */
export const PROMOTION_TARGETS = ['PERSONAL', 'ROLE', 'DEPARTMENT', 'MARKET', 'COMPANY', 'RESTRICTED'] as const;
export type PromotionTarget = (typeof PROMOTION_TARGETS)[number];

/** PERSONAL stays with its Employee; every other target shares the lesson across Employees and needs independent review. */
export const requiresIndependentReview = (t: PromotionTarget): boolean => t !== 'PERSONAL';

/** Knowledge scope a shared promotion target lands in. */
export const PROMOTION_SCOPE: Readonly<Record<Exclude<PromotionTarget, 'PERSONAL'>, KnowledgeScope>> = { ROLE: 'ROLE', DEPARTMENT: 'DEPARTMENT', MARKET: 'MARKET', COMPANY: 'COMPANY', RESTRICTED: 'RESTRICTED' };

export function assertKnowledgeScope(v: unknown): KnowledgeScope {
  if (!(KNOWLEDGE_SCOPES as readonly unknown[]).includes(v)) throw new QandeelError('VALIDATION_FAILED', 'unknown knowledge scope', { field: 'scope' });
  return v as KnowledgeScope;
}

export function assertKeyCode(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length > 96 || !KEY_CODE.test(v)) throw new QandeelError('VALIDATION_FAILED', `${field} must be a short dotted code`, { field });
  return v;
}
