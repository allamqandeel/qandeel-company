/**
 * ExternalEvidenceStore — C7-A Operational Data + External Outcome Core over canonical Company state.
 *
 * - The governed source registry: a Founder registers a source (stable, provider-neutral key; one family; one
 *   contract version of this release, pinned by digest) and decides its lifecycle — DRAFT until ACTIVATE, SUSPEND fails
 *   closed for new evidence and keeps history, RETIRE is final. No Employee, model or producer can authorize a source.
 * - The intake seam (`ingest`) that App-side production integration and L1 can call later: screen (privacy first) →
 *   resolve the source → validate and normalize against its contract (allowlist; nothing unknown passes) → idempotent
 *   by (source, producer event id): an exact replay is a no-op returning the canonical record, a different fingerprint
 *   is a recorded, audited conflict that never overwrites. No transport, listener, queue or SDK lives here.
 * - Bindings: only the Founder states that an accepted record is relevant to a Work Item or a Goal (an operational fact
 *   is never outcome evidence; it may only explain a Work Item's failure as an external dependency).
 * - Evidence is not a verdict: nothing here touches a Work Item, an evaluation, an attribution, a lesson, authority,
 *   budget or the App. C6 reads usable evidence through its own outcome-verification and evaluation paths; when a
 *   conflicting replay puts accepted evidence in dispute, C6 itself (`txOutcomesContestedBy`) takes the verifications
 *   that rested on it out of current truth in the same transaction (D-C7A-11).
 *
 * State, history, audit and the outbox event of every mutation commit in one short `BEGIN IMMEDIATE`. Audit and
 * events carry ids, codes and counts only; a refused occurrence is audited by reason code, never by its content.
 */
import { QandeelError, assertCode, assertId, canonicalJson, newId, sha256Hex, type Id, type Timestamp } from '@qandeel-company/domain';
import {
  BINDING_ROLES,
  BINDING_SUBJECTS,
  SOURCE_DECISIONS,
  assertSourceRegistration,
  bindableRole,
  contractOf,
  nextSourceState,
  normalizeOccurrence,
  screenOccurrence,
  type BindingRole,
  type BindingSubject,
  type ContractSpec,
  type ExternalLane,
  type SourceDecision,
  type SourceFamily,
  type SourceState,
} from '@qandeel-company/governance';

import { boundEvidence, externalAvailability, type ExternalEvidenceView, type ExternalOutcomeState } from './external-core.js';
import { founder, founderAdminWrite } from './governance.js';
import { txOutcomesContestedBy } from './improvement.js';
import { appendAudit, appendEvent, ts, type StoreContext } from './internal.js';
import type { Row } from './sqlite/connection.js';
import { storeContext, type CompanyStore } from './store.js';

/** The intake actor: a producer is a source, never a principal with authority. */
export const INTAKE_ACTOR_REF = 'system:external-intake';

export interface ExternalSourceRecord {
  readonly id: Id;
  readonly sourceKey: string;
  readonly lane: ExternalLane;
  readonly family: SourceFamily;
  readonly state: SourceState;
  readonly contract: { readonly id: Id; readonly code: string; readonly version: number; readonly sha256: string } | null;
  readonly registeredByRef: string;
  readonly decidedByRef: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An accepted record as any reader sees it: normalized, declared scalars and provenance — no payload, no user ref. */
export interface ExternalRecordView {
  readonly id: Id;
  readonly ref: string;
  readonly sourceId: Id;
  readonly contractId: Id;
  readonly producerEventId: string;
  readonly lane: ExternalLane;
  readonly type: string;
  readonly domain: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly scope: { readonly kind: string; readonly ref: string } | null;
  readonly window: { readonly from: string; readonly to: string } | null;
  readonly value: number | null;
  readonly unit: string | null;
  readonly fields: Readonly<Record<string, string | number>>;
  readonly userScoped: boolean;
  readonly failureSignal: boolean;
  readonly fingerprint: string;
  readonly conflicts: number;
}

export interface ExternalBindingRecord {
  readonly id: Id;
  readonly recordId: Id;
  readonly role: BindingRole;
  readonly subjectKind: BindingSubject;
  readonly subjectId: Id;
  readonly state: 'ACTIVE' | 'REVOKED' | 'SUPERSEDED';
  readonly boundByRef: string;
  readonly reasonCode: string;
  readonly endedByRef: string | null;
  readonly supersededBy: Id | null;
  readonly createdAt: string;
}

export type IntakeResult = { readonly outcome: 'ACCEPTED' | 'DUPLICATE'; readonly changed: boolean; readonly record: ExternalRecordView };

const s = (v: unknown): string => String(v);
const os = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** The digest a contract version is pinned by: any change to its definition without a version bump is drift. */
export const contractDigest = (c: ContractSpec): string => sha256Hex(canonicalJson(c));

function mapSource(ctx: StoreContext, r: Row): ExternalSourceRecord {
  const c = ctx.db.get<Row>(`SELECT * FROM external_source_contracts WHERE source_id = ? AND state = 'CURRENT'`, s(r.id));
  return {
    id: s(r.id) as Id,
    sourceKey: s(r.source_key),
    lane: s(r.lane) as ExternalLane,
    family: s(r.family) as SourceFamily,
    state: s(r.state) as SourceState,
    contract: c ? { id: s(c.id) as Id, code: s(c.contract_code), version: Number(c.contract_version), sha256: s(c.contract_sha256) } : null,
    registeredByRef: s(r.registered_by_ref),
    decidedByRef: os(r.decided_by_ref),
    version: Number(r.version),
    createdAt: s(r.created_at),
    updatedAt: s(r.updated_at),
  };
}

function mapRecord(ctx: StoreContext, r: Row): ExternalRecordView {
  return {
    id: s(r.id) as Id,
    ref: `external_record:${s(r.id)}`,
    sourceId: s(r.source_id) as Id,
    contractId: s(r.contract_id) as Id,
    producerEventId: s(r.producer_event_id),
    lane: s(r.lane) as ExternalLane,
    type: s(r.record_type),
    domain: s(r.domain),
    occurredAt: s(r.occurred_at),
    receivedAt: s(r.received_at),
    scope: r.scope_kind === null ? null : { kind: s(r.scope_kind), ref: s(r.scope_ref) },
    window: r.window_from === null ? null : { from: s(r.window_from), to: s(r.window_to) },
    value: r.value_num === null ? null : Number(r.value_num),
    unit: os(r.unit),
    fields: JSON.parse(s(r.normalized_fields_json)) as Record<string, string | number>,
    userScoped: Number(r.user_scoped) === 1,
    failureSignal: Number(r.failure_signal) === 1,
    fingerprint: s(r.fingerprint),
    conflicts: Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM external_record_conflicts WHERE record_id = ?', s(r.id))?.n ?? 0),
  };
}

const mapBinding = (r: Row): ExternalBindingRecord => ({
  id: s(r.id) as Id,
  recordId: s(r.record_id) as Id,
  role: s(r.role) as BindingRole,
  subjectKind: s(r.subject_kind) as BindingSubject,
  subjectId: s(r.subject_id) as Id,
  state: s(r.state) as ExternalBindingRecord['state'],
  boundByRef: s(r.bound_by_ref),
  reasonCode: s(r.reason_code),
  endedByRef: os(r.ended_by_ref),
  supersededBy: os(r.superseded_by) as Id | null,
  createdAt: s(r.created_at),
});

const sourceRow = (ctx: StoreContext, id: Id): Row => {
  const r = ctx.db.get<Row>('SELECT * FROM external_sources WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'external source not found', { sourceId: id });
  return r;
};

function sourceHistory(ctx: StoreContext, sourceId: Id, version: number, from: string | null, to: string, reason: string, actor: string): void {
  ctx.db.run('INSERT INTO external_source_history (source_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', sourceId, version, from, to, reason, actor, ts(ctx));
}

/** One outbox event of the external-source aggregate (correlated by the source it concerns). */
const sourceEvent = (ctx: StoreContext, type: 'external_source.registered' | 'external_source.contract_registered' | 'external_source.state_changed' | 'external_record.accepted' | 'external_record.conflict_detected' | 'external_binding.changed', sourceId: Id, actorRef: string, payload: Record<string, string | number | boolean | null>): void => {
  appendEvent(ctx, type, 'external_source', sourceId, { correlationId: sourceId, actorRef }, payload);
};

function insertContract(ctx: StoreContext, sourceId: Id, contract: ContractSpec, actorRef: string): Id {
  const id = newId();
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO external_source_contracts (id, source_id, contract_code, contract_version, contract_sha256, state, registered_by_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'CURRENT', ?, ?, ?)`,
    id, sourceId, contract.code, contract.version, contractDigest(contract), actorRef, at, at,
  );
  return id;
}

/**
 * Whether a record may be bound now in this role to this subject (code; the datastore re-checks it). Shared by the store
 * and the governed preview, so a preview never offers a binding the confirmation would refuse.
 */
export function txAssertBindable(ctx: StoreContext, recordId: Id, role: BindingRole, subjectKind: BindingSubject, subjectId: Id): ExternalRecordView {
  const rec = ctx.db.get<Row>('SELECT x.*, s.state AS source_state FROM external_records x JOIN external_sources s ON s.id = x.source_id WHERE x.id = ?', recordId);
  if (!rec) throw new QandeelError('NOT_FOUND', 'external record not found', { recordId });
  const view = mapRecord(ctx, rec);
  if (!bindableRole(view, role, subjectKind)) throw new QandeelError('EVIDENCE_REQUIRED', 'this record cannot play that role for that subject', { recordId, reason: view.lane === 'OPERATIONAL_EVENT' && role === 'OUTCOME_EVIDENCE' ? 'OPERATIONAL_FACT_IS_NOT_OUTCOME_EVIDENCE' : 'ROLE_NOT_BINDABLE' });
  if (s(rec.source_state) !== 'ACTIVE') throw new QandeelError('EVIDENCE_REQUIRED', 'evidence of a source that is not ACTIVE is not newly used', { recordId, reason: 'SOURCE_NOT_ACTIVE' });
  if (view.conflicts > 0) throw new QandeelError('EVIDENCE_REQUIRED', 'a record with a conflicting replay is not usable evidence', { recordId, reason: 'RECORD_CONFLICTED' });
  const exists = subjectKind === 'WORK_ITEM' ? ctx.db.get('SELECT 1 AS x FROM work_items WHERE id = ?', subjectId) : ctx.db.get('SELECT 1 AS x FROM goals WHERE id = ?', subjectId);
  if (!exists) throw new QandeelError('NOT_FOUND', 'binding subject not found', { subjectKind, subjectId });
  return view;
}

const SOURCE_KEY_SHAPE = /^[a-z0-9][a-z0-9.-]{2,63}$/;

/** The coalescing window of intake refusals (engineering policy, not Product semantics). */
export const REFUSAL_WINDOW_MS = 3_600_000;
const REFUSAL_REASON = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * C7-B — the Company-side storage-amplification guard of R-C7A-04. One durable counter per (registered source id or
 * `unresolved`, refusal reason code, hour window): the caller audits only the FIRST refusal of a window (returns true);
 * every later one only counts. The key space is bounded by registered sources × the kernel's closed reason codes × time
 * — never by anything a producer supplies (an unknown reason folds into `OTHER`) — and nothing of the refused payload
 * is stored. No timer runs: the window is derived from the refusal's own time. This is NOT network / edge rate
 * limiting (L1 / App-side Production Integration own that): it only bounds what refusals cost the Company's datastore.
 */
export function txCountRefusal(ctx: StoreContext, sourceRef: string, reasonCode: string): boolean {
  const reason = REFUSAL_REASON.test(reasonCode) ? reasonCode : 'OTHER';
  const at = ts(ctx);
  const window = new Date(Math.floor(Date.parse(at) / REFUSAL_WINDOW_MS) * REFUSAL_WINDOW_MS).toISOString();
  const updated = ctx.db.run('UPDATE external_intake_refusal_windows SET refusals = refusals + 1, last_at = ? WHERE source_ref = ? AND reason_code = ? AND window_start = ?', at, sourceRef, reason, window).changes;
  if (updated === 1) return false;
  ctx.db.run('INSERT INTO external_intake_refusal_windows (source_ref, reason_code, window_start, refusals, first_at, last_at) VALUES (?, ?, ?, 1, ?, ?)', sourceRef, reason, window, at, at);
  return true;
}

type Ingested = { kind: 'ACCEPTED' | 'DUPLICATE'; record: ExternalRecordView } | { kind: 'CONFLICT'; recordId: Id; sourceId: Id; recorded: boolean; contested: number };

/** The intake transaction. A refusal throws (and is audited by the caller in its own transaction); a conflict commits its record. */
function txIngest(ctx: StoreContext, raw: unknown, refused: { sourceId: Id | null }): Ingested {
  // Privacy first: nothing reads the envelope (not even its source key) before it passed the screen.
  screenOccurrence(raw);
  const envelope = raw as Row;
  const key = envelope.sourceKey;
  const row = typeof key === 'string' ? ctx.db.get<Row>('SELECT * FROM external_sources WHERE source_key = ?', key) : undefined;
  if (!row) throw new QandeelError('INTAKE_REJECTED', 'the occurrence was refused (content is never echoed)', { reason: 'UNREGISTERED_SOURCE' });
  const source = mapSource(ctx, row);
  refused.sourceId = source.id;
  if (source.state !== 'ACTIVE' || source.contract === null) throw new QandeelError('INTAKE_REJECTED', 'the occurrence was refused (content is never echoed)', { reason: 'SOURCE_NOT_ACTIVE', state: source.state });
  // Schema drift fails closed: the contract this release validates against must be the one the Founder registered.
  const contract = contractOf(source.contract.code, source.contract.version);
  if (contract === null || contractDigest(contract) !== source.contract.sha256) throw new QandeelError('INTAKE_REJECTED', 'the occurrence was refused (content is never echoed)', { reason: 'CONTRACT_DRIFT' });
  const receivedAt = ts(ctx);
  const n = normalizeOccurrence(raw, { family: source.family, contractCode: contract.code, contractVersion: contract.version }, receivedAt as Timestamp);
  const fingerprint = sha256Hex(canonicalJson(n.identity));
  const existing = ctx.db.get<Row>('SELECT * FROM external_records WHERE source_id = ? AND producer_event_id = ?', source.id, n.producerEventId);
  if (existing) {
    if (s(existing.fingerprint) === fingerprint) return { kind: 'DUPLICATE', record: mapRecord(ctx, existing) };
    // A conflicting replay: recorded and audited, never applied; the first accepted record stands.
    const recordId = s(existing.id) as Id;
    const known = ctx.db.get('SELECT 1 AS x FROM external_record_conflicts WHERE record_id = ? AND conflicting_fingerprint = ?', recordId, fingerprint) !== undefined;
    let contested = 0;
    if (!known) {
      const conflictId = newId();
      ctx.db.run('INSERT INTO external_record_conflicts (id, record_id, source_id, conflicting_fingerprint, received_at) VALUES (?, ?, ?, ?, ?)', conflictId, recordId, source.id, fingerprint, receivedAt);
      sourceEvent(ctx, 'external_record.conflict_detected', source.id, INTAKE_ACTOR_REF, { recordId, lane: n.lane });
      // The disputed evidence leaves current C6 truth in this same transaction: every verification that rested on it is
      // contested (by the datastore) and C6 restates its evaluation — history stays, the Founder decides.
      contested = txOutcomesContestedBy(ctx, conflictId as Id).length;
    }
    // C7-B (R-C7A-04): a NEW conflict is always audited; the same conflicting replay sent again is counted per window and
    // audited once per window (it commits nothing new), so a misbehaving producer cannot grow the audit without bound.
    if (!known || txCountRefusal(ctx, source.id, 'CONFLICTING_REPLAY_REPEATED')) appendAudit(ctx, 'external.intake_conflict', 'external_record', recordId, { actorRef: INTAKE_ACTOR_REF }, 'REJECTED', 'CONFLICTING_REPLAY', { sourceId: source.id, repeated: known, contestedVerifications: contested });
    return { kind: 'CONFLICT', recordId, sourceId: source.id, recorded: !known, contested };
  }
  const id = newId();
  ctx.db.run(
    `INSERT INTO external_records (id, source_id, contract_id, producer_event_id, lane, record_type, domain, occurred_at, received_at, scope_kind, scope_ref, window_from, window_to, value_num, unit, normalized_fields_json, user_scoped, failure_signal, fingerprint, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACCEPTED')`,
    id, source.id, source.contract.id, n.producerEventId, n.lane, n.type, n.domain, n.occurredAt, receivedAt, n.scope?.kind ?? null, n.scope?.ref ?? null, n.window?.from ?? null, n.window?.to ?? null, n.value, n.unit,
    canonicalJson(n.fields), n.userScoped ? 1 : 0, n.failureSignal ? 1 : 0, fingerprint,
  );
  appendAudit(ctx, 'external.record_accepted', 'external_record', id, { actorRef: INTAKE_ACTOR_REF }, 'OK', n.lane, { sourceId: source.id, domain: n.domain });
  sourceEvent(ctx, 'external_record.accepted', source.id, INTAKE_ACTOR_REF, { recordId: id, lane: n.lane, domain: n.domain });
  return { kind: 'ACCEPTED', record: mapRecord(ctx, ctx.db.get<Row>('SELECT * FROM external_records WHERE id = ?', id) ?? {}) };
}

export class ExternalEvidenceStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): ExternalEvidenceStore {
    return new ExternalEvidenceStore(store);
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  #admin<T>(operation: string, actorRef: string, fn: (ctx: StoreContext) => T): T {
    return founderAdminWrite(this.#store, operation, actorRef, fn);
  }

  // --- The governed source registry (Founder) -------------------------------------------------------------

  /**
   * Registers a source (DRAFT: trusted by nothing until activated), or a new contract version of an existing one (it
   * supersedes the current contract for NEW intake; accepted records keep theirs). Idempotent for the same contract.
   */
  registerSource(actorRef: string, input: { sourceKey: string; family: string; contractCode: string; contractVersion: number; reasonCode?: string }): { source: ExternalSourceRecord; changed: boolean } {
    return this.#admin('register external source', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'external source registry');
      const { sourceKey, family, contract } = assertSourceRegistration(input);
      const reason = assertCode(input.reasonCode ?? 'source.registered', 'reasonCode');
      const at = ts(ctx);
      const existing = ctx.db.get<Row>('SELECT * FROM external_sources WHERE source_key = ?', sourceKey);
      if (!existing) {
        const id = newId();
        ctx.db.run(
          `INSERT INTO external_sources (id, source_key, lane, family, state, registered_by_ref, decided_by_ref, decision_reason_code, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'DRAFT', ?, NULL, NULL, 1, ?, ?)`,
          id, sourceKey, contract.lane, family, p.ref, at, at,
        );
        sourceHistory(ctx, id as Id, 1, null, 'DRAFT', reason, p.ref);
        const contractId = insertContract(ctx, id as Id, contract, p.ref);
        appendAudit(ctx, 'external.source_registered', 'external_source', id, { actorRef: p.ref }, 'OK', reason, { lane: contract.lane, family, contractVersion: contract.version });
        sourceEvent(ctx, 'external_source.registered', id as Id, p.ref, { lane: contract.lane, family, state: 'DRAFT', contractId });
        return { source: mapSource(ctx, sourceRow(ctx, id as Id)), changed: true };
      }
      const current = mapSource(ctx, existing);
      if (current.state === 'RETIRED') throw new QandeelError('INVALID_TRANSITION', 'a retired source is final; register a new source key', { sourceId: current.id, state: current.state });
      if (current.family !== family || current.lane !== contract.lane) throw new QandeelError('VALIDATION_FAILED', 'a source keeps its family and lane; register a new source key', { sourceId: current.id, reason: 'SOURCE_IDENTITY_IMMUTABLE' });
      if (current.contract?.code === contract.code && current.contract.version === contract.version) return { source: current, changed: false };
      if (ctx.db.get('SELECT 1 AS x FROM external_source_contracts WHERE source_id = ? AND contract_code = ? AND contract_version = ?', current.id, contract.code, contract.version)) {
        throw new QandeelError('INVALID_TRANSITION', 'a superseded contract version is never reinstated', { sourceId: current.id, reason: 'CONTRACT_VERSION_SUPERSEDED' });
      }
      ctx.db.run(`UPDATE external_source_contracts SET state = 'SUPERSEDED', updated_at = ? WHERE source_id = ? AND state = 'CURRENT'`, at, current.id);
      const contractId = insertContract(ctx, current.id, contract, p.ref);
      ctx.db.run('UPDATE external_sources SET version = version + 1, updated_at = ? WHERE id = ?', at, current.id);
      sourceHistory(ctx, current.id, current.version + 1, current.state, current.state, 'source.contract_registered', p.ref);
      appendAudit(ctx, 'external.contract_registered', 'external_source', current.id, { actorRef: p.ref }, 'OK', reason, { contractVersion: contract.version });
      sourceEvent(ctx, 'external_source.contract_registered', current.id, p.ref, { contractId, contractVersion: contract.version });
      return { source: mapSource(ctx, sourceRow(ctx, current.id)), changed: true };
    });
  }

  /** ACTIVATE (now trusted for new evidence), SUSPEND (fails closed for new evidence; history kept) or RETIRE (final). */
  decideSource(actorRef: string, sourceId: string, input: { decision: SourceDecision; reasonCode: string }): ExternalSourceRecord {
    return this.#admin('decide external source', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'external source lifecycle');
      const src = mapSource(ctx, sourceRow(ctx, assertId(sourceId, 'sourceId')));
      if (!(SOURCE_DECISIONS as readonly string[]).includes(input.decision)) throw new QandeelError('VALIDATION_FAILED', 'decision is ACTIVATE, SUSPEND or RETIRE', { field: 'decision' });
      const to = nextSourceState(src.state, input.decision);
      const reason = assertCode(input.reasonCode, 'reasonCode');
      const at = ts(ctx);
      ctx.db.run('UPDATE external_sources SET state = ?, decided_by_ref = ?, decision_reason_code = ?, version = version + 1, updated_at = ? WHERE id = ?', to, p.ref, reason, at, src.id);
      sourceHistory(ctx, src.id, src.version + 1, src.state, to, reason, p.ref);
      appendAudit(ctx, `external.source_${to.toLowerCase()}`, 'external_source', src.id, { actorRef: p.ref }, 'OK', reason, { from: src.state, to });
      sourceEvent(ctx, 'external_source.state_changed', src.id, p.ref, { from: src.state, to });
      return mapSource(ctx, sourceRow(ctx, src.id));
    });
  }

  // --- Bindings (Founder): explicit relevance, never inferred ---------------------------------------------------

  /**
   * Binds an accepted record to a Work Item or Goal in a role it may play (`bindableRole`). `supersedesBindingId`
   * moves an existing binding (the old one is SUPERSEDED by this one; its history stays). Idempotent for a live one.
   */
  bindEvidence(actorRef: string, input: { recordId: string; subjectKind: string; subjectId: string; role: string; reasonCode: string; supersedesBindingId?: string }): { binding: ExternalBindingRecord; changed: boolean } {
    return this.#admin('bind external evidence', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'external evidence binding');
      const recordId = assertId(input.recordId, 'recordId');
      const subjectId = assertId(input.subjectId, 'subjectId');
      if (!(BINDING_SUBJECTS as readonly string[]).includes(input.subjectKind)) throw new QandeelError('VALIDATION_FAILED', 'subjectKind is WORK_ITEM or GOAL', { field: 'subjectKind' });
      if (!(BINDING_ROLES as readonly string[]).includes(input.role)) throw new QandeelError('VALIDATION_FAILED', 'role is OUTCOME_EVIDENCE or DEPENDENCY_FAILURE', { field: 'role' });
      const subjectKind = input.subjectKind as BindingSubject;
      const role = input.role as BindingRole;
      const reason = assertCode(input.reasonCode, 'reasonCode');
      const view = txAssertBindable(ctx, recordId as Id, role, subjectKind, subjectId as Id);
      const live = ctx.db.get<Row>(`SELECT * FROM external_evidence_bindings WHERE record_id = ? AND role = ? AND subject_kind = ? AND subject_id = ? AND state = 'ACTIVE'`, recordId, role, subjectKind, subjectId);
      if (live) return { binding: mapBinding(live), changed: false };
      const prior = input.supersedesBindingId === undefined ? null : ctx.db.get<Row>('SELECT * FROM external_evidence_bindings WHERE id = ?', assertId(input.supersedesBindingId, 'supersedesBindingId'));
      if (input.supersedesBindingId !== undefined && (!prior || s(prior.state) !== 'ACTIVE' || s(prior.record_id) !== recordId)) throw new QandeelError('INVALID_TRANSITION', 'only a live binding of the same record is superseded', { reason: 'BINDING_NOT_SUPERSEDABLE' });
      const id = newId();
      const at = ts(ctx);
      ctx.db.run(
        `INSERT INTO external_evidence_bindings (id, record_id, role, subject_kind, subject_id, state, bound_by_ref, reason_code, ended_by_ref, end_reason_code, superseded_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, NULL, NULL, NULL, 1, ?, ?)`,
        id, recordId, role, subjectKind, subjectId, p.ref, reason, at, at,
      );
      ctx.db.run('INSERT INTO external_binding_history (binding_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, ?, ?, ?, ?)', id, 'ACTIVE', reason, p.ref, at);
      if (prior) {
        ctx.db.run(`UPDATE external_evidence_bindings SET state = 'SUPERSEDED', ended_by_ref = ?, end_reason_code = ?, superseded_by = ?, version = version + 1, updated_at = ? WHERE id = ?`, p.ref, reason, id, at, s(prior.id));
        ctx.db.run('INSERT INTO external_binding_history (binding_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', s(prior.id), Number(prior.version) + 1, 'ACTIVE', 'SUPERSEDED', reason, p.ref, at);
      }
      appendAudit(ctx, 'external.evidence_bound', 'external_binding', id, { actorRef: p.ref }, 'OK', reason, { recordId, role, subjectKind, subjectId, supersedes: prior ? s(prior.id) : null });
      sourceEvent(ctx, 'external_binding.changed', view.sourceId, p.ref, { bindingId: id, recordId, role, subjectKind, state: 'ACTIVE' });
      return { binding: mapBinding(ctx.db.get<Row>('SELECT * FROM external_evidence_bindings WHERE id = ?', id) ?? {}), changed: true };
    });
  }

  /** Ends a live binding (REVOKED). Verifications that already cited it stay history; it is not newly usable. */
  unbindEvidence(actorRef: string, bindingId: string, reasonCode: string): ExternalBindingRecord {
    return this.#admin('unbind external evidence', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'external evidence binding');
      const b = ctx.db.get<Row>('SELECT b.*, x.source_id FROM external_evidence_bindings b JOIN external_records x ON x.id = b.record_id WHERE b.id = ?', assertId(bindingId, 'bindingId'));
      if (!b) throw new QandeelError('NOT_FOUND', 'binding not found', { bindingId: String(bindingId).slice(0, 36) });
      if (s(b.state) !== 'ACTIVE') throw new QandeelError('INVALID_TRANSITION', 'only a live binding is ended', { bindingId: s(b.id), state: s(b.state) });
      const reason = assertCode(reasonCode, 'reasonCode');
      const at = ts(ctx);
      ctx.db.run(`UPDATE external_evidence_bindings SET state = 'REVOKED', ended_by_ref = ?, end_reason_code = ?, version = version + 1, updated_at = ? WHERE id = ?`, p.ref, reason, at, s(b.id));
      ctx.db.run('INSERT INTO external_binding_history (binding_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', s(b.id), Number(b.version) + 1, 'ACTIVE', 'REVOKED', reason, p.ref, at);
      appendAudit(ctx, 'external.evidence_unbound', 'external_binding', s(b.id), { actorRef: p.ref }, 'OK', reason, { recordId: s(b.record_id) });
      sourceEvent(ctx, 'external_binding.changed', s(b.source_id) as Id, p.ref, { bindingId: s(b.id), recordId: s(b.record_id), state: 'REVOKED' });
      return mapBinding(ctx.db.get<Row>('SELECT * FROM external_evidence_bindings WHERE id = ?', s(b.id)) ?? {});
    });
  }

  // --- The intake seam (producer → Company) ------------------------------------------------------------------

  /**
   * Accepts one content-free occurrence from a governed source. ACCEPTED (a new canonical record) or DUPLICATE (an
   * exact replay: nothing is written, the canonical record is returned). A refusal throws INTAKE_REJECTED (reason code
   * only) and is audited in its own transaction — the refused payload is never stored, logged or echoed. A conflicting
   * replay is recorded and audited, then throws INTAKE_CONFLICT (the first record stands).
   */
  ingest(occurrence: unknown): IntakeResult {
    const ctx = storeContext(this.#store);
    const refused: { sourceId: Id | null } = { sourceId: null };
    let out: Ingested;
    try {
      out = ctx.db.immediate('external intake', () => txIngest(ctx, occurrence, refused));
    } catch (error) {
      if (error instanceof QandeelError && error.code === 'INTAKE_REJECTED') {
        const reason = String(error.details.reason ?? 'REJECTED').slice(0, 64);
        const field = typeof error.details.field === 'string' ? error.details.field : null;
        try {
          ctx.db.immediate('audit refused intake', () => {
            // A refusal raised before the source was resolved (the privacy screen runs first) is still attributed to the
            // registered source a shape-valid key names — a registered identifier, never content — so its health counts it.
            const key = refused.sourceId === null && typeof occurrence === 'object' && occurrence !== null ? (occurrence as Record<string, unknown>).sourceKey : undefined;
            const named = typeof key === 'string' && SOURCE_KEY_SHAPE.test(key) ? ctx.db.get<{ id: string }>('SELECT id FROM external_sources WHERE source_key = ?', key)?.id : undefined;
            // C7-B (R-C7A-04): refusals are counted per (source, reason, window); only the first of a window is audited.
            if (txCountRefusal(ctx, refused.sourceId ?? named ?? 'unresolved', reason)) appendAudit(ctx, 'external.intake_rejected', 'external_source', refused.sourceId ?? named ?? 'unresolved', { actorRef: INTAKE_ACTOR_REF }, 'REJECTED', reason, field === null ? {} : { field });
          });
        } catch {
          // Auditing a refusal never masks the refusal itself.
        }
      }
      throw error;
    }
    // `recorded`: this replay committed a NEW conflict (and `contestedVerifications` were taken out of current truth).
    if (out.kind === 'CONFLICT') throw new QandeelError('INTAKE_CONFLICT', 'the same producer occurrence was replayed with different content; the first accepted record stands', { recordId: out.recordId, sourceId: out.sourceId, reason: 'CONFLICTING_REPLAY', recorded: out.recorded, contestedVerifications: out.contested });
    return { outcome: out.kind, changed: out.kind === 'ACCEPTED', record: out.record };
  }

  // --- Reads (bounded; by canonical id; never a payload, a user reference or arbitrary search) ------------------

  sources(filter: { state?: SourceState } = {}): ExternalSourceRecord[] {
    return this.#read((ctx) => ctx.db.all<Row>('SELECT * FROM external_sources ORDER BY created_at, id').map((r) => mapSource(ctx, r)).filter((x) => filter.state === undefined || x.state === filter.state));
  }

  source(sourceId: string): ExternalSourceRecord {
    return this.#read((ctx) => mapSource(ctx, sourceRow(ctx, assertId(sourceId, 'sourceId'))));
  }

  sourceHistory(sourceId: string): { version: number; from: string | null; to: string; reasonCode: string; actorRef: string; at: string }[] {
    return this.#read((ctx) =>
      ctx.db
        .all<Row>('SELECT * FROM external_source_history WHERE source_id = ? ORDER BY version', assertId(sourceId, 'sourceId'))
        .map((r) => ({ version: Number(r.version), from: os(r.from_state), to: s(r.to_state), reasonCode: s(r.reason_code), actorRef: s(r.actor_ref), at: s(r.occurred_at) })),
    );
  }

  record(recordId: string): ExternalRecordView {
    return this.#read((ctx) => {
      const r = ctx.db.get<Row>('SELECT * FROM external_records WHERE id = ?', assertId(recordId, 'recordId'));
      if (!r) throw new QandeelError('NOT_FOUND', 'external record not found', { recordId: String(recordId).slice(0, 36) });
      return mapRecord(ctx, r);
    });
  }

  bindings(filter: { recordId?: string; subjectKind?: BindingSubject; subjectId?: string; state?: ExternalBindingRecord['state'] } = {}): ExternalBindingRecord[] {
    return this.#read((ctx) => {
      const clauses: string[] = [];
      const params: string[] = [];
      const add = (column: string, value: string | undefined): void => {
        if (value === undefined) return;
        clauses.push(`${column} = ?`);
        params.push(value);
      };
      add('record_id', filter.recordId);
      add('subject_kind', filter.subjectKind);
      add('subject_id', filter.subjectId);
      add('state', filter.state);
      return ctx.db.all<Row>(`SELECT * FROM external_evidence_bindings${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at, id LIMIT 2000`, ...params).map(mapBinding);
    });
  }

  /** The external evidence bound to one Work Item or Goal (drill-down for C6 reports and inspection). */
  evidenceFor(subjectKind: BindingSubject, subjectId: string): ExternalEvidenceView[] {
    if (!(BINDING_SUBJECTS as readonly string[]).includes(subjectKind)) throw new QandeelError('VALIDATION_FAILED', 'subjectKind is WORK_ITEM or GOAL', { field: 'subjectKind' });
    return this.#read((ctx) => boundEvidence(ctx, subjectKind, assertId(subjectId, 'subjectId')));
  }

  /** Runtime truth about external outcomes (never a compile-time flag). */
  availability(): { state: ExternalOutcomeState; activeOutcomeSources: Id[]; boundRecords: number } {
    return this.#read((ctx) => externalAvailability(ctx));
  }

  /** Aggregate source health (content-free counts and times; per-user facts only as a count). */
  health(): { sources: Record<SourceState, number>; perSource: { sourceId: Id; state: SourceState; lane: ExternalLane; accepted: number; conflicts: number; rejected: number; lastReceivedAt: string | null }[]; userScopedRecords: number; bindingsActive: number } {
    return this.#read((ctx) => {
      const n = (sql: string, ...p: string[]): number => Number(ctx.db.get<{ n: number }>(sql, ...p)?.n ?? 0);
      const grouped = (sql: string): Map<string, Row> => new Map(ctx.db.all<Row>(sql).map((r) => [s(r.k), r]));
      const records = grouped('SELECT source_id AS k, COUNT(*) AS n, MAX(received_at) AS at FROM external_records GROUP BY source_id');
      const conflicts = grouped('SELECT source_id AS k, COUNT(*) AS n FROM external_record_conflicts GROUP BY source_id');
      // Refusals are counted by the bounded refusal counters (C7-B, R-C7A-04; history before 0013 folded in), never by audit rows.
      const rejected = grouped(`SELECT source_ref AS k, SUM(refusals) AS n FROM external_intake_refusal_windows WHERE reason_code <> 'CONFLICTING_REPLAY_REPEATED' GROUP BY source_ref`);
      const perSource = ctx.db.all<Row>('SELECT id, state, lane FROM external_sources ORDER BY created_at, id').map((r) => ({
        sourceId: s(r.id) as Id,
        state: s(r.state) as SourceState,
        lane: s(r.lane) as ExternalLane,
        accepted: Number(records.get(s(r.id))?.n ?? 0),
        conflicts: Number(conflicts.get(s(r.id))?.n ?? 0),
        rejected: Number(rejected.get(s(r.id))?.n ?? 0),
        lastReceivedAt: os(records.get(s(r.id))?.at),
      }));
      const by = (st: SourceState): number => n('SELECT COUNT(*) AS n FROM external_sources WHERE state = ?', st);
      return {
        sources: { DRAFT: by('DRAFT'), ACTIVE: by('ACTIVE'), SUSPENDED: by('SUSPENDED'), RETIRED: by('RETIRED') },
        perSource,
        userScopedRecords: n('SELECT COUNT(*) AS n FROM external_records WHERE user_scoped = 1'),
        bindingsActive: n(`SELECT COUNT(*) AS n FROM external_evidence_bindings WHERE state = 'ACTIVE'`),
      };
    });
  }
}
