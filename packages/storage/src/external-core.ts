/**
 * C7-A storage internals: the ONE definition of usable external evidence, shared by every C6 seam that reads it —
 * outcome verification (Founder and Review Pool), the evaluator's Work Item evidence, reports, inspection and
 * Founder Attention. Not exported from the package. Runs inside its caller's transaction.
 *
 * A record is usable evidence of a Work Item's outcome only when ALL hold (and the datastore re-checks it):
 * - it is an EXTERNAL_OUTCOME observation (an operational fact never verifies Company work);
 * - its governed source is ACTIVE (a suspended or retired source fails closed for new use; its history stays);
 * - it has no conflicting replay;
 * - an ACTIVE Founder binding names it OUTCOME_EVIDENCE of exactly that Work Item (no inference, no self-binding).
 * Availability is runtime truth read from these rows — never a compile-time flag.
 */
import { QandeelError, type Id } from '@qandeel-company/domain';

import type { StoreContext } from './internal.js';
import type { Row } from './sqlite/connection.js';

export const EXTERNAL_REF_PREFIX = 'external_record:';
const REF = /^external_record:([0-9a-f-]{36})$/;

export const externalRecordIdOf = (ref: string): string | null => REF.exec(ref)?.[1] ?? null;
export const isExternalRef = (ref: string): boolean => ref.startsWith(EXTERNAL_REF_PREFIX);

/** Why a reference is not usable outcome evidence of `workItemId` (a code), or null when it is. */
export function externalEvidenceProblem(ctx: StoreContext, ref: string, workItemId: Id): string | null {
  const id = externalRecordIdOf(ref);
  if (id === null) return 'UNKNOWN_RECORD';
  const r = ctx.db.get<{ lane: string; state: string }>('SELECT x.lane, s.state FROM external_records x JOIN external_sources s ON s.id = x.source_id WHERE x.id = ?', id);
  if (!r) return 'UNKNOWN_RECORD';
  if (r.lane !== 'EXTERNAL_OUTCOME') return 'NOT_OUTCOME_EVIDENCE';
  if (r.state !== 'ACTIVE') return 'SOURCE_NOT_ACTIVE';
  if (ctx.db.get('SELECT 1 AS x FROM external_record_conflicts WHERE record_id = ?', id)) return 'RECORD_CONFLICTED';
  const bound = ctx.db.get(`SELECT 1 AS x FROM external_evidence_bindings WHERE record_id = ? AND state = 'ACTIVE' AND role = 'OUTCOME_EVIDENCE' AND subject_kind = 'WORK_ITEM' AND subject_id = ?`, id, workItemId);
  return bound ? null : 'NOT_BOUND_TO_WORK_ITEM';
}

export type ExternalOutcomeState = 'NO_GOVERNED_SOURCE' | 'NO_RELEVANT_EVIDENCE' | 'EVIDENCE_AVAILABLE';

/** Durable truth: is there any ACTIVE governed outcome source, and any usable bound outcome evidence at all? */
export function externalAvailability(ctx: StoreContext): { state: ExternalOutcomeState; activeOutcomeSources: Id[]; boundRecords: number } {
  const activeOutcomeSources = ctx.db.all<{ id: string }>(`SELECT id FROM external_sources WHERE state = 'ACTIVE' AND lane = 'EXTERNAL_OUTCOME' ORDER BY created_at, id`).map((r) => r.id as Id);
  if (activeOutcomeSources.length === 0) return { state: 'NO_GOVERNED_SOURCE', activeOutcomeSources, boundRecords: 0 };
  const boundRecords = Number(
    ctx.db.get<{ n: number }>(
      `SELECT COUNT(DISTINCT x.id) AS n FROM external_records x JOIN external_sources s ON s.id = x.source_id JOIN external_evidence_bindings b ON b.record_id = x.id
        WHERE x.lane = 'EXTERNAL_OUTCOME' AND s.state = 'ACTIVE' AND b.state = 'ACTIVE' AND b.role = 'OUTCOME_EVIDENCE'
          AND NOT EXISTS (SELECT 1 FROM external_record_conflicts k WHERE k.record_id = x.id)`,
    )?.n ?? 0,
  );
  return { state: boundRecords > 0 ? 'EVIDENCE_AVAILABLE' : 'NO_RELEVANT_EVIDENCE', activeOutcomeSources, boundRecords };
}

/**
 * The governed external-evidence rule of an outcome verification (both verifier paths). EXTERNAL_OUTCOME is cited
 * exactly when `external_record:` references are, and every one of them is usable for the verified Work Item. With no
 * governed source at all, external outcomes are unavailable (never invented).
 */
export function txAssertExternalEvidence(ctx: StoreContext, workItemId: Id, classes: readonly string[], refs: readonly string[]): void {
  const external = refs.filter(isExternalRef);
  const declared = classes.includes('EXTERNAL_OUTCOME');
  if (!declared && external.length === 0) return;
  if (declared && externalAvailability(ctx).state === 'NO_GOVERNED_SOURCE') throw new QandeelError('EVIDENCE_REQUIRED', 'external outcomes are unavailable: no governed source is active', { reason: 'EXTERNAL_OUTCOME_UNAVAILABLE' });
  if (!declared) throw new QandeelError('EVIDENCE_REQUIRED', 'external records are cited only under the EXTERNAL_OUTCOME evidence class', { reason: 'EXTERNAL_EVIDENCE_UNDECLARED' });
  if (external.length === 0) throw new QandeelError('EVIDENCE_REQUIRED', 'EXTERNAL_OUTCOME cites the governed records it rests on', { reason: 'EXTERNAL_EVIDENCE_MISSING' });
  for (const ref of external) {
    const problem = externalEvidenceProblem(ctx, ref, workItemId);
    if (problem !== null) throw new QandeelError('EVIDENCE_REQUIRED', 'cited external evidence is not usable for this Work Item', { reason: problem, workItemId });
  }
}

/** Unrecovered external-dependency failures of a Work Item: Founder-bound failure facts of ACTIVE sources, unconflicted. */
export function externalDependencyFailures(ctx: StoreContext, workItemId: Id): string[] {
  return ctx.db
    .all<{ id: string }>(
      `SELECT DISTINCT x.id FROM external_evidence_bindings b JOIN external_records x ON x.id = b.record_id JOIN external_sources s ON s.id = x.source_id
        WHERE b.subject_kind = 'WORK_ITEM' AND b.subject_id = ? AND b.state = 'ACTIVE' AND b.role = 'DEPENDENCY_FAILURE' AND s.state = 'ACTIVE'
          AND x.failure_signal = 1 AND NOT EXISTS (SELECT 1 FROM external_record_conflicts k WHERE k.record_id = x.id)
        ORDER BY x.occurred_at, x.id`,
      workItemId,
    )
    .map((r) => `${EXTERNAL_REF_PREFIX}${r.id}`);
}

/** The external references a recorded verification cited (empty when it cited none). */
export function verificationExternalRefs(ctx: StoreContext, verificationId: Id): string[] {
  const v = ctx.db.get<{ classes: string; refs: string }>('SELECT evidence_classes_json AS classes, evidence_refs_json AS refs FROM outcome_verifications WHERE id = ?', verificationId);
  if (!v || !(JSON.parse(v.classes) as string[]).includes('EXTERNAL_OUTCOME')) return [];
  return (JSON.parse(v.refs) as string[]).filter(isExternalRef);
}

/** Bound, usable outcome evidence of a subject (Work Item or Goal): content-free record views with their binding. */
export function boundEvidence(ctx: StoreContext, subjectKind: 'WORK_ITEM' | 'GOAL', subjectId: Id): ExternalEvidenceView[] {
  return ctx.db
    .all<Row>(
      `SELECT b.id AS binding_id, b.role, b.created_at AS bound_at, x.id, x.source_id, x.lane, x.record_type, x.domain, x.occurred_at, x.received_at, x.scope_kind, x.scope_ref, x.window_from, x.window_to, x.value_num, x.unit, s.state AS source_state,
              EXISTS (SELECT 1 FROM external_record_conflicts k WHERE k.record_id = x.id) AS conflicted
         FROM external_evidence_bindings b JOIN external_records x ON x.id = b.record_id JOIN external_sources s ON s.id = x.source_id
        WHERE b.subject_kind = ? AND b.subject_id = ? AND b.state = 'ACTIVE' ORDER BY x.occurred_at, x.id, b.id`,
      subjectKind,
      subjectId,
    )
    .map((r) => ({
      ref: `${EXTERNAL_REF_PREFIX}${String(r.id)}`,
      bindingRef: `external_binding:${String(r.binding_id)}`,
      role: String(r.role) as ExternalEvidenceView['role'],
      recordId: String(r.id) as Id,
      sourceId: String(r.source_id) as Id,
      lane: String(r.lane) as ExternalEvidenceView['lane'],
      type: String(r.record_type),
      domain: String(r.domain),
      occurredAt: String(r.occurred_at),
      receivedAt: String(r.received_at),
      scope: r.scope_kind === null ? null : { kind: String(r.scope_kind), ref: String(r.scope_ref) },
      window: r.window_from === null ? null : { from: String(r.window_from), to: String(r.window_to) },
      value: r.value_num === null ? null : Number(r.value_num),
      unit: r.unit === null ? null : String(r.unit),
      usable: String(r.source_state) === 'ACTIVE' && Number(r.conflicted) === 0,
    }));
}

export interface ExternalEvidenceView {
  readonly ref: string;
  readonly bindingRef: string;
  readonly role: 'OUTCOME_EVIDENCE' | 'DEPENDENCY_FAILURE';
  readonly recordId: Id;
  readonly sourceId: Id;
  readonly lane: 'OPERATIONAL_EVENT' | 'EXTERNAL_OUTCOME';
  readonly type: string;
  readonly domain: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly scope: { readonly kind: string; readonly ref: string } | null;
  readonly window: { readonly from: string; readonly to: string } | null;
  readonly value: number | null;
  readonly unit: string | null;
  /** Its source is ACTIVE and it has no conflicting replay (a binding alone is not trust). */
  readonly usable: boolean;
}

/** Report facts (C6 reporting): availability, the period's relevant bound outcome evidence per subject, and verifications that cited it. */
export function externalReportFacts(ctx: StoreContext, period: { from: string; to: string }): {
  state: ExternalOutcomeState;
  sources: string[];
  evidence: { subjectKind: 'WORK_ITEM' | 'GOAL'; subjectId: string; recordIds: string[]; bindingIds: string[]; types: string[] }[];
  verifications: { id: string; workItemId: string; verdict: string; recordIds: string[] }[];
} {
  const a = externalAvailability(ctx);
  const rows = ctx.db.all<{ subject_kind: string; subject_id: string; binding_id: string; record_id: string; record_type: string }>(
    `SELECT b.subject_kind, b.subject_id, b.id AS binding_id, x.id AS record_id, x.record_type FROM external_evidence_bindings b JOIN external_records x ON x.id = b.record_id JOIN external_sources s ON s.id = x.source_id
      WHERE b.state = 'ACTIVE' AND b.role = 'OUTCOME_EVIDENCE' AND x.lane = 'EXTERNAL_OUTCOME' AND s.state = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM external_record_conflicts k WHERE k.record_id = x.id)
        AND x.occurred_at >= ? AND x.occurred_at <= ?
      ORDER BY b.subject_kind, b.subject_id, x.occurred_at, x.id LIMIT 500`,
    period.from,
    period.to,
  );
  const bySubject = new Map<string, { subjectKind: 'WORK_ITEM' | 'GOAL'; subjectId: string; recordIds: string[]; bindingIds: string[]; types: string[] }>();
  for (const r of rows) {
    const key = `${r.subject_kind}:${r.subject_id}`;
    const e = bySubject.get(key) ?? { subjectKind: r.subject_kind as 'WORK_ITEM' | 'GOAL', subjectId: r.subject_id, recordIds: [], bindingIds: [], types: [] };
    if (!e.recordIds.includes(r.record_id)) e.recordIds.push(r.record_id);
    e.bindingIds.push(r.binding_id);
    if (!e.types.includes(r.record_type)) e.types.push(r.record_type);
    bySubject.set(key, e);
  }
  const verifications = ctx.db
    .all<{ id: string; work_item_id: string; verdict: string; refs: string }>(
      `SELECT v.id, v.work_item_id, v.verdict, v.evidence_refs_json AS refs FROM outcome_verifications v
        WHERE v.created_at >= ? AND v.created_at <= ? AND EXISTS (SELECT 1 FROM json_each(v.evidence_classes_json) c WHERE c.value = 'EXTERNAL_OUTCOME')
        ORDER BY v.created_at, v.id`,
      period.from,
      period.to,
    )
    .map((v) => ({ id: v.id, workItemId: v.work_item_id, verdict: v.verdict, recordIds: (JSON.parse(v.refs) as string[]).map(externalRecordIdOf).filter((x): x is string => x !== null) }));
  return { state: a.state === 'NO_GOVERNED_SOURCE' ? 'NO_GOVERNED_SOURCE' : bySubject.size > 0 || verifications.length > 0 ? 'EVIDENCE_AVAILABLE' : 'NO_RELEVANT_EVIDENCE', sources: a.activeOutcomeSources, evidence: [...bySubject.values()], verifications };
}

/**
 * Material external-evidence exceptions for Founder Attention (C5 lanes; never routine ingestion): a registered source
 * awaiting the Founder's activation decision, and an ACTIVE source whose producer replayed an accepted occurrence with
 * different content (an integrity conflict) since the source's last decision.
 */
export function externalAttentionSignals(ctx: StoreContext): { dedupKey: string; sourceRef: string; changedAt: string; level: 'NEEDS_DECISION' | 'URGENT' }[] {
  const out: { dedupKey: string; sourceRef: string; changedAt: string; level: 'NEEDS_DECISION' | 'URGENT' }[] = [];
  for (const s of ctx.db.all<{ id: string; updated_at: string }>(`SELECT id, updated_at FROM external_sources WHERE state = 'DRAFT' ORDER BY created_at, id`)) {
    out.push({ dedupKey: `external_source:${s.id}`, sourceRef: `external_source:${s.id}`, changedAt: s.updated_at, level: 'NEEDS_DECISION' });
  }
  for (const s of ctx.db.all<{ id: string; at: string }>(
    `SELECT s.id, MAX(k.received_at) AS at FROM external_sources s JOIN external_record_conflicts k ON k.source_id = s.id
      WHERE s.state = 'ACTIVE' AND k.received_at >= s.updated_at GROUP BY s.id ORDER BY s.id`,
  )) {
    out.push({ dedupKey: `external_integrity:${s.id}`, sourceRef: `external_source:${s.id}`, changedAt: s.at, level: 'URGENT' });
  }
  return out;
}
