/**
 * Storage-internal C3 transaction helpers shared by the Memory / Skill / Academy stores and the
 * fenced runtime writes. Every helper runs inside a transaction opened by its caller.
 *
 * Content is loaded only through the loaders here, and every load verifies the stored SHA-256: a
 * mismatch quarantines the row (integrity = CORRUPT, audited) and returns nothing — corruption fails
 * closed. Skill instructions load only for a pinned, production-eligible version.
 */
import { QandeelError, newId, sha256Hex, type Id, type Timestamp } from '@qandeel-company/domain';
import { dataRank, grantCovers, maxDataClass, type DataClass } from '@qandeel-company/governance';
import {
  certificationStatusAt,
  productionEligibility,
  terms as termsOf,
  type CertificationView,
  type EligibilitySnapshot,
  type InspectionFinding,
  type PassportView,
  type SkillVersionView,
} from '@qandeel-company/mind';

import { getEmployeeRow, setEmployeeState, wakeWorkItemJob } from './governance-core.js';
import { mapGrant, type EmployeeRecord } from './governance-records.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import {
  mapCertification,
  mapKnowledge,
  mapMemory,
  mapPassport,
  mapSkillVersion,
  type CertificationRecord,
  type KnowledgeRecord,
  type MemoryRecord,
  type SkillVersionRecord,
} from './mind-records.js';

export const SYSTEM_MIND_REF = 'system:runtime';

// --- Memory -------------------------------------------------------------------------------------

export function getMemoryRow(ctx: StoreContext, id: Id): MemoryRecord {
  const r = ctx.db.get('SELECT * FROM memory_records WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'memory not found', { memoryId: id });
  return mapMemory(r);
}

export function memoryHistory(ctx: StoreContext, memoryId: Id, version: number, from: string | null, to: string, reasonCode: string, actorRef: string): void {
  ctx.db.run('INSERT INTO memory_history (memory_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', memoryId, version, from, to, reasonCode, actorRef, ts(ctx));
}

/** One status change: version + 1, history row and a content-free audit row, together. */
export function setMemoryStatus(ctx: StoreContext, m: MemoryRecord, to: MemoryRecord['status'], reasonCode: string, actorRef: string, extra: { supersededById?: Id; validatedAt?: Timestamp; reviewAt?: Timestamp } = {}): MemoryRecord {
  // Any status change of a source invalidates the compaction summaries built from it (derived, never truth).
  if (to !== m.status) invalidateSummariesOf(ctx, m.id, 'SOURCE_CHANGED');
  const changed = ctx.db.run(
    'UPDATE memory_records SET status = ?, superseded_by_id = COALESCE(?, superseded_by_id), last_validated_at = COALESCE(?, last_validated_at), review_at = COALESCE(?, review_at), version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
    to,
    extra.supersededById ?? null,
    extra.validatedAt ?? null,
    extra.reviewAt ?? null,
    ts(ctx),
    m.id,
    m.version,
  ).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'memory changed concurrently', { memoryId: m.id });
  memoryHistory(ctx, m.id, m.version + 1, m.status, to, reasonCode, actorRef);
  appendAudit(ctx, 'memory.status', 'memory', m.id, { actorRef }, 'OK', reasonCode, { from: m.status, to, employeeId: m.employeeId });
  // A held memory that stops being live (stale, incorrect, superseded…) may lift a conflict hold: wake it.
  if (to !== 'ACTIVE' && to !== 'LOW_CONFIDENCE' && ctx.db.get(`SELECT 1 AS x FROM memory_conflicts WHERE state = 'OPEN' AND (memory_a_id = ? OR memory_b_id = ?)`, m.id, m.id)) {
    wakeEmployeeWaits(ctx, m.employeeId, ['MEMORY_CONFLICT_REVIEW'], 'memory.conflict_member_retired');
  }
  return getMemoryRow(ctx, m.id);
}

export interface NewMemory {
  readonly employeeId: Id;
  readonly memoryClass: MemoryRecord['memoryClass'];
  readonly topic: string;
  readonly claimKey: string | null;
  readonly claimValue: string | null;
  readonly content: string;
  readonly fingerprint: string;
  readonly terms: readonly string[];
  readonly dataClass: DataClass;
  readonly marketRef: string | null;
  readonly projectRef: string | null;
  readonly provenanceKind: string;
  readonly provenanceRef: string;
  readonly sourceVersion: number | null;
  readonly sourceSha256: string | null;
  readonly evidenceRefs: readonly string[];
  readonly confidencePct: number;
  readonly status: 'ACTIVE' | 'LOW_CONFIDENCE';
  readonly retentionPolicy: string;
  readonly reviewAt: Timestamp | null;
  readonly candidateId: Id | null;
  readonly supersedesId: Id | null;
  readonly validatedAt: Timestamp | null;
}

/** Summaries derived from this memory stop being valid (they would otherwise keep its old text). */
export function invalidateSummariesOf(ctx: StoreContext, memoryId: Id, reason: string): void {
  for (const s of ctx.db.all<{ id: string; employee_id: string }>(`SELECT id, employee_id FROM context_summaries WHERE status = 'VALID' AND EXISTS (SELECT 1 FROM json_each(source_ids_json) j WHERE j.value = ?)`, memoryId)) {
    ctx.db.run(`UPDATE context_summaries SET status = 'INVALIDATED', invalidation_reason = ?, invalidated_at = ? WHERE id = ? AND status = 'VALID'`, reason, ts(ctx), s.id);
    appendAudit(ctx, 'context_summary.invalidated', 'context_summary', s.id, { actorRef: SYSTEM_MIND_REF }, 'OK', reason, { employeeId: s.employee_id });
  }
}

/** Term index rows for deterministic lexical retrieval (one per normalized term; never rewritten). */
export function indexItemTerms(ctx: StoreContext, kind: 'MEMORY' | 'KNOWLEDGE' | 'CANONICAL', ownerKey: string, itemId: Id, terms: readonly string[]): void {
  for (const t of new Set(terms)) if (t.length >= 1 && t.length <= 64) ctx.db.run('INSERT OR IGNORE INTO mind_terms (item_kind, owner_key, term, item_id) VALUES (?, ?, ?, ?)', kind, ownerKey, t, itemId);
}

/** Canonical Truth outranks every lower layer at write time too: no memory / knowledge contradicts an ACTIVE claim. */
export function assertNotContradictingCanonical(ctx: StoreContext, claimKey: string | null, claimValue: string | null): void {
  if (claimKey === null) return;
  const c = ctx.db.get<{ id: string; claim_value: string }>(`SELECT id, claim_value FROM canonical_truth WHERE claim_key = ? AND status = 'ACTIVE'`, claimKey);
  if (c && c.claim_value !== claimValue) throw new QandeelError('VALIDATION_FAILED', 'this claim contradicts active Canonical Truth', { reason: 'CONTRADICTS_CANONICAL', canonicalId: c.id });
}

/**
 * Wakes work of one Employee parked for the given reasons (conflict / skill review resolved). The
 * wake advances the durable wake generation in the same transaction (D-C1-23); no polling.
 */
export function wakeEmployeeWaits(ctx: StoreContext, employeeId: Id, reasons: readonly string[], reasonCode: string): number {
  const rows = ctx.db.all<{ w: string }>(
    `SELECT q.work_item_id AS w FROM queue_jobs q JOIN work_items i ON i.id = q.work_item_id WHERE q.state = 'WAITING' AND q.wait_reason IN (SELECT value FROM json_each(?)) AND i.owner_ref = ?`,
    JSON.stringify(reasons),
    `employee:${employeeId}`,
  );
  let n = 0;
  for (const r of rows) if (wakeWorkItemJob(ctx, r.w as Id, reasons, reasonCode)) n++;
  return n;
}

export function insertMemory(ctx: StoreContext, m: NewMemory, actorRef: string, reasonCode: string): Id {
  assertNotContradictingCanonical(ctx, m.claimKey, m.claimValue);
  const id = newId();
  const at = ts(ctx);
  ctx.db.run(
    `INSERT INTO memory_records (id, employee_id, memory_class, scope, topic, claim_key, claim_value, content, content_sha256, fingerprint, terms_json, data_class, market_ref, project_ref,
       provenance_kind, provenance_ref, source_version, source_sha256, evidence_refs_json, confidence_pct, status, integrity, retention_policy, review_at, last_validated_at, candidate_id, supersedes_id, version, created_at, updated_at)
     VALUES (?, ?, ?, 'PERSONAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OK', ?, ?, ?, ?, ?, 1, ?, ?)`,
    id, m.employeeId, m.memoryClass, m.topic, m.claimKey, m.claimValue, m.content, sha256Hex(m.content), m.fingerprint, JSON.stringify(m.terms), m.dataClass, m.marketRef, m.projectRef,
    m.provenanceKind, m.provenanceRef, m.sourceVersion, m.sourceSha256, JSON.stringify(m.evidenceRefs), m.confidencePct, m.status, m.retentionPolicy, m.reviewAt, m.validatedAt, m.candidateId, m.supersedesId, at, at,
  );
  memoryHistory(ctx, id, 1, null, m.status, reasonCode, actorRef);
  indexItemTerms(ctx, 'MEMORY', m.employeeId, id, m.terms);
  appendAudit(ctx, 'memory.stored', 'memory', id, { actorRef }, 'OK', reasonCode, { employeeId: m.employeeId, memoryClass: m.memoryClass, dataClass: m.dataClass, provenance: m.provenanceKind });
  return id;
}

type ContentTable = 'memory_records' | 'knowledge_items' | 'canonical_truth' | 'skill_versions' | 'context_summaries' | 'academy_scenarios';
const CONTENT_COLUMNS: Readonly<Record<ContentTable, { text: string; sha: string; integrity: boolean; entity: string }>> = {
  memory_records: { text: 'content', sha: 'content_sha256', integrity: true, entity: 'memory' },
  knowledge_items: { text: 'content', sha: 'content_sha256', integrity: true, entity: 'knowledge' },
  canonical_truth: { text: 'statement', sha: 'statement_sha256', integrity: true, entity: 'canonical_truth' },
  skill_versions: { text: 'instructions', sha: 'instructions_sha256', integrity: true, entity: 'skill_version' },
  context_summaries: { text: 'content', sha: 'content_sha256', integrity: false, entity: 'context_summary' },
  academy_scenarios: { text: 'content', sha: 'content_sha256', integrity: false, entity: 'academy_scenario' },
};

/**
 * Loads one content payload and verifies its hash. A mismatch quarantines the row (CORRUPT, audited)
 * and returns null: corrupt content is never used.
 */
export function loadVerified(ctx: StoreContext, table: ContentTable, id: string): string | null {
  const c = CONTENT_COLUMNS[table];
  const row = ctx.db.get<{ t: string; s: string; v: number | null }>(`SELECT ${c.text} AS t, ${c.sha} AS s, ${c.integrity ? 'version' : 'NULL'} AS v FROM ${table} WHERE id = ?`, id);
  if (!row) return null;
  if (sha256Hex(String(row.t)) === row.s) return String(row.t);
  if (c.integrity) {
    const changed = ctx.db.run(`UPDATE ${table} SET integrity = 'CORRUPT', version = version + 1, updated_at = ? WHERE id = ? AND integrity = 'OK'`, ts(ctx), id).changes;
    // The version bump is recorded in the entity's own history (no version gaps).
    if (changed === 1 && row.v !== null) integrityHistory(ctx, table, id, Number(row.v) + 1);
    if (table === 'memory_records') invalidateSummariesOf(ctx, id as Id, 'INTEGRITY_FAILED');
  } else if (table === 'context_summaries') {
    ctx.db.run(`UPDATE context_summaries SET status = 'INVALIDATED', invalidation_reason = 'INTEGRITY_FAILED', invalidated_at = ? WHERE id = ? AND status = 'VALID'`, ts(ctx), id);
  }
  appendAudit(ctx, `${c.entity}.integrity_failed`, c.entity, id, { actorRef: SYSTEM_MIND_REF }, 'ERROR', 'CONTENT_HASH_MISMATCH', {});
  return null;
}

function integrityHistory(ctx: StoreContext, table: ContentTable, id: string, version: number): void {
  const at = ts(ctx);
  if (table === 'memory_records') {
    const st = ctx.db.get<{ s: string }>('SELECT status AS s FROM memory_records WHERE id = ?', id)?.s ?? 'ACTIVE';
    memoryHistory(ctx, id as Id, version, st, st, 'INTEGRITY_FAILED', SYSTEM_MIND_REF);
  } else if (table === 'knowledge_items') {
    const st = ctx.db.get<{ s: string }>('SELECT status AS s FROM knowledge_items WHERE id = ?', id)?.s ?? 'ACTIVE';
    ctx.db.run('INSERT INTO knowledge_history (knowledge_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, version, st, st, 'INTEGRITY_FAILED', SYSTEM_MIND_REF, at);
  } else if (table === 'skill_versions') {
    ctx.db.run('INSERT INTO skill_version_history (skill_version_id, version, change_kind, from_value, to_value, reason_code, evidence_ref, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)', id, version, 'INTEGRITY', 'OK', 'CORRUPT', 'INTEGRITY_FAILED', SYSTEM_MIND_REF, at);
  }
}

/** Whether a record's recorded source has changed since it was derived (stale by source version / hash). */
export function sourceChanged(ctx: StoreContext, kind: string, ref: string, version: number | null, sha: string | null): boolean {
  if (version === null && sha === null) return false;
  const id = ref.slice(ref.indexOf(':') + 1);
  const probe = (sql: string): { v: number; s: string; st: string } | undefined => ctx.db.get<{ v: number; s: string; st: string }>(sql, id);
  let cur: { v: number; s: string; st: string } | undefined;
  if (kind === 'KNOWLEDGE') cur = probe('SELECT version AS v, content_sha256 AS s, status AS st FROM knowledge_items WHERE id = ?');
  else if (kind === 'CANONICAL') cur = probe('SELECT version AS v, statement_sha256 AS s, status AS st FROM canonical_truth WHERE id = ?');
  else if (kind === 'SKILL_VERSION') cur = probe(`SELECT version AS v, instructions_sha256 AS s, CASE WHEN freshness IN ('SECURITY_HOLD', 'RETIRED', 'DEPRECATED') THEN 'STALE' ELSE 'ACTIVE' END AS st FROM skill_versions WHERE id = ?`);
  else return false;
  if (!cur) return true;
  if (sha !== null && cur.s !== sha) return true;
  // A pinned skill version's identity is its payload hash; knowledge / canonical rows also version by status.
  if (version !== null && kind !== 'SKILL_VERSION' && cur.v !== version) return true;
  return !['ACTIVE', 'LOW_CONFIDENCE'].includes(cur.st);
}

// --- Knowledge access (re-evaluated at every use, Stage 14 D14-C.6) ------------------------------

export interface KnowledgeAccess {
  readonly departmentScopes: readonly string[];
  readonly roleRef: string;
  readonly marketRef: string | null;
  readonly restrictedScopes: readonly string[];
  /** Cross-department grants by department scope ref (grant id for attribution). */
  readonly crossDepartmentGrants: ReadonlyMap<string, Id>;
  readonly restrictedGrants: ReadonlyMap<string, Id>;
}

/**
 * Scopes an Employee may read now: Company-wide, its own Department and Role, the Work Item's market,
 * plus Departments / Restricted scopes named by an ACTIVE, unexpired, exact grant. Founder-only
 * knowledge is never readable by an Employee. Department membership alone grants no restricted scope.
 */
export function knowledgeAccess(ctx: StoreContext, e: EmployeeRecord, marketRef: string | null, dataClass: DataClass): KnowledgeAccess {
  const at = ts(ctx);
  const grants = ctx.db.all(`SELECT * FROM permission_grants WHERE employee_id = ? AND status = 'ACTIVE' AND capability IN ('knowledge.read', 'knowledge.restricted')`, e.id).map(mapGrant);
  const cross = new Map<string, Id>();
  const restricted = new Map<string, Id>();
  for (const g of grants) {
    // Exact scopes only: a wildcard never opens every Department or every Restricted scope.
    if (g.resourceScope === '*') continue;
    if (!grantCovers(g, { capability: g.capability, resource: g.resourceScope, risk: 'R0', dataClass, at })) continue;
    (g.capability === 'knowledge.read' ? cross : restricted).set(g.resourceScope, g.id);
  }
  // C4: a company-scoped executive (the CEO seat) belongs to no Department: it reads Company scope and
  // explicitly granted scopes only — never an implicit Department scope (D-C4-02).
  const own = e.departmentId === null ? [] : [`department:${e.departmentId}`];
  return { departmentScopes: [...own, ...cross.keys()], roleRef: e.roleRef, marketRef, restrictedScopes: [...restricted.keys()], crossDepartmentGrants: cross, restrictedGrants: restricted };
}

export function knowledgeReadable(k: Pick<KnowledgeRecord, 'scope' | 'scopeRef'>, a: KnowledgeAccess): boolean {
  switch (k.scope) {
    case 'COMPANY':
      return true;
    case 'DEPARTMENT':
      return k.scopeRef !== null && a.departmentScopes.includes(k.scopeRef);
    case 'ROLE':
      return k.scopeRef === a.roleRef;
    case 'MARKET':
      return k.scopeRef !== null && k.scopeRef === a.marketRef;
    case 'RESTRICTED':
      return k.scopeRef !== null && a.restrictedScopes.includes(k.scopeRef);
    case 'FOUNDER_ONLY':
      return false;
  }
}

export function getKnowledgeRow(ctx: StoreContext, id: Id): KnowledgeRecord {
  const r = ctx.db.get('SELECT * FROM knowledge_items WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'knowledge not found', { knowledgeId: id });
  return mapKnowledge(r);
}

// --- Skills ---------------------------------------------------------------------------------------

export function getSkillVersionRow(ctx: StoreContext, id: Id): SkillVersionRecord {
  const r = ctx.db.get('SELECT * FROM skill_versions WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'skill version not found', { skillVersionId: id });
  return mapSkillVersion(r);
}

export function skillVersionView(v: SkillVersionRecord, skillType: SkillVersionView['skillType']): SkillVersionView {
  return {
    id: v.id,
    skillType,
    pipelineState: v.pipelineState,
    freshness: v.freshness,
    licenseStatus: v.licenseStatus,
    paidDependency: v.paidDependency,
    paidDependencyAcknowledged: v.paidDependencyAcknowledged,
    securityCleared: v.securityStatus === 'CLEARED',
    // Not yet inspected counts as a finding: an uninspected payload is never production-eligible.
    inspectionFindings: (v.inspectionFindings ?? ['EXECUTABLE_CONTENT']) as InspectionFinding[],
    integrityOk: v.integrity === 'OK',
  };
}

export function versionEligibility(ctx: StoreContext, v: SkillVersionRecord): ReturnType<typeof productionEligibility> {
  const type = ctx.db.get<{ t: string }>('SELECT skill_type AS t FROM skills WHERE id = ?', v.skillId)?.t as SkillVersionView['skillType'];
  return productionEligibility(skillVersionView(v, type));
}

/**
 * THE Skill payload loader. Production resolves only a pinned version id (never "latest"), and loads
 * its instructions only when that version is production-eligible and its hash verifies.
 */
export function loadPinnedSkillInstructions(ctx: StoreContext, skillVersionId: Id): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string } {
  const v = getSkillVersionRow(ctx, skillVersionId);
  const e = versionEligibility(ctx, v);
  if (!e.eligible) return { ok: false, reason: e.reasons[0] ?? 'NOT_APPROVED' };
  const text = loadVerified(ctx, 'skill_versions', v.id);
  if (text === null) return { ok: false, reason: 'INTEGRITY_FAILED' };
  return { ok: true, text };
}

/**
 * The payload of an unapproved version for the deterministic static inspection step only (never into a
 * context): returned only when its hash verifies. Kept beside the pinned loader so skill payload reads
 * live in one module (verifier rule `skill-load-pinned`).
 */
export function loadSkillPayloadForInspection(ctx: StoreContext, skillVersionId: Id): string | null {
  const text = ctx.db.get<{ i: string }>('SELECT instructions AS i FROM skill_versions WHERE id = ?', skillVersionId)?.i;
  const v = getSkillVersionRow(ctx, skillVersionId);
  return typeof text === 'string' && sha256Hex(text) === v.instructionsSha256 ? text : null;
}

/**
 * L1-02 (D-L1-13): the payload of the ONE Skill version a fenced SKILL_BENCHMARK run benchmarks, for that run's WITH_SKILL
 * arm only. It never relaxes production eligibility: the version must be exactly the open benchmark run's version, in
 * the sandbox (SANDBOXED — statically reviewed and security-cleared, not approved), with zero inspection findings,
 * integrity OK and a verifying hash. A BASELINE run, a closed run, another version or an approved / rejected version
 * loads nothing. Kept beside the pinned loader (verifier rules `skill-load-pinned`, `l1-02-benchmark-load-confined`).
 */
export function loadBenchmarkSkillInstructions(ctx: StoreContext, runId: Id): { readonly skillVersionId: Id; readonly text: string } | null {
  const r = ctx.db.get<{ v: string; arm: string; state: string }>(
    `SELECT b.skill_version_id AS v, b.arm, b.state FROM run_benchmark_modes m JOIN skill_benchmark_runs b ON b.id = m.benchmark_run_id WHERE m.run_id = ?`,
    runId,
  );
  if (!r || r.arm !== 'WITH_SKILL' || r.state !== 'OPEN') return null;
  const v = getSkillVersionRow(ctx, r.v as Id);
  if (v.pipelineState !== 'SANDBOXED' || v.securityStatus !== 'CLEARED' || (v.inspectionFindings ?? []).length > 0 || v.integrity !== 'OK') return null;
  const text = loadVerified(ctx, 'skill_versions', v.id);
  return text === null ? null : { skillVersionId: v.id, text };
}

// --- Capability eligibility snapshot --------------------------------------------------------------

/** Certification status at now, materializing EXPIRED (history + audit) when a write transaction is open. */
export function liveCertifications(ctx: StoreContext, employeeId: Id, materialize: boolean): CertificationRecord[] {
  const now = ts(ctx);
  const out: CertificationRecord[] = [];
  for (const c of ctx.db.all(`SELECT * FROM certifications WHERE employee_id = ? AND status IN ('VALID', 'REVIEW_DUE')`, employeeId).map(mapCertification)) {
    if (certificationStatusAt(c, now) === 'EXPIRED' && materialize) {
      ctx.db.run(`UPDATE certifications SET status = 'EXPIRED', reason_code = 'VALIDITY_ENDED', version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, now, c.id, c.version);
      ctx.db.run('INSERT INTO certification_history (certification_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', c.id, c.version + 1, c.status, 'EXPIRED', 'VALIDITY_ENDED', SYSTEM_MIND_REF, now);
      out.push({ ...c, status: 'EXPIRED' });
    } else out.push({ ...c, status: certificationStatusAt(c, now) });
  }
  return out;
}

/**
 * Founder Decision D-C3-18 (loss of role certification): the Employee's certification for its CURRENT
 * role is lost when no live one remains (VALID / REVIEW_DUE, time-aware) and the latest one was REVOKED
 * or has EXPIRED. REVIEW_DUE is not a loss. An Employee that never held a certification for the role is
 * not covered by this rule (it is not a loss). Expiry is read from the clock, and materialized.
 */
export function roleCertificationLoss(ctx: StoreContext, e: EmployeeRecord): { readonly code: 'ROLE_CERTIFICATION_REVOKED' | 'ROLE_CERTIFICATION_EXPIRED'; readonly certificationId: Id } | null {
  if (liveCertifications(ctx, e.id, true).some((c) => c.roleRef === e.roleRef && (c.status === 'VALID' || c.status === 'REVIEW_DUE'))) return null;
  const lost = ctx.db.get<{ id: string; status: string }>(`SELECT id, status FROM certifications WHERE employee_id = ? AND role_ref = ? AND status IN ('REVOKED', 'EXPIRED') ORDER BY updated_at DESC, rowid DESC LIMIT 1`, e.id, e.roleRef);
  if (!lost) return null;
  return { code: lost.status === 'REVOKED' ? 'ROLE_CERTIFICATION_REVOKED' : 'ROLE_CERTIFICATION_EXPIRED', certificationId: lost.id as Id };
}

/**
 * The ordinary-duty eligibility boundary for certification loss (D-C3-18), run inside the caller's
 * transaction at every point where an ACTIVE Employee would start or continue ordinary work (run
 * start, model authorization, reservation, tool intent) and when a certification is revoked. An ACTIVE
 * Employee whose current-role certification was lost moves to RETRAINING (deterministic, system actor,
 * audited; same identity; history and evidence untouched) and so can no longer execute ordinary work.
 * Returns the Employee as it now stands.
 */
export function enforceRoleCertification(ctx: StoreContext, e: EmployeeRecord): EmployeeRecord {
  if (e.state !== 'ACTIVE') return e;
  const loss = roleCertificationLoss(ctx, e);
  if (loss === null) return e;
  const next = setEmployeeState(ctx, e, 'RETRAINING', loss.code, SYSTEM_MIND_REF);
  appendAudit(ctx, 'employee.certification_lost', 'employee', e.id, { actorRef: SYSTEM_MIND_REF }, 'OK', loss.code, { certificationId: loss.certificationId, from: 'ACTIVE', to: 'RETRAINING' });
  return next;
}

export function eligibilitySnapshot(ctx: StoreContext, employeeId: Id, materialize: boolean): EligibilitySnapshot {
  const now = ts(ctx);
  const passport: PassportView[] = ctx.db.all('SELECT * FROM passport_entries WHERE employee_id = ?', employeeId).map(mapPassport).filter((p) => p.status !== 'REVOKED').map((p) => {
    const v = getSkillVersionRow(ctx, p.skillVersionId);
    const skill = ctx.db.get<{ market_code: string | null; status: string }>('SELECT market_code, status FROM skills WHERE id = ?', p.skillId);
    return {
      skillId: p.skillId,
      versionId: p.skillVersionId,
      proficiency: p.proficiency,
      status: p.status as PassportView['status'],
      versionEligible: skill?.status === 'ACTIVE' && versionEligibility(ctx, v).eligible,
      marketCode: skill?.market_code ?? null,
    };
  });
  const certifications: CertificationView[] = liveCertifications(ctx, employeeId, materialize).map((c) => ({ roleRef: c.roleRef, status: c.status, validUntil: c.validUntil }));
  const grants = ctx.db.all(`SELECT * FROM permission_grants WHERE employee_id = ? AND status = 'ACTIVE' AND capability GLOB 'tool:*'`, employeeId).map(mapGrant);
  const grantedToolCapabilities = [...new Set(grants.filter((g) => (g.expiresAt === null || g.expiresAt > now) && (g.maxUses === null || g.uses < g.maxUses)).map((g) => g.capability))];
  const skillsWithEligibleVersion = ctx.db
    .all<{ id: string }>(`SELECT DISTINCT s.id FROM skills s JOIN skill_versions v ON v.skill_id = s.id WHERE s.status = 'ACTIVE' AND v.pipeline_state IN ('APPROVED', 'TARGETED_LEARNING', 'ROLLED_OUT') AND v.freshness NOT IN ('SECURITY_HOLD', 'RETIRED') AND v.integrity = 'OK'`)
    .map((r) => r.id);
  return { passport, certifications, grantedToolCapabilities, skillsWithEligibleVersion, now };
}

// --- Misc -----------------------------------------------------------------------------------------

export function employeeOf(ctx: StoreContext, id: Id): EmployeeRecord {
  return getEmployeeRow(ctx, id);
}

/** Terms of a topic code plus text (for retrieval indexing at write time). */
export const indexTerms = (topic: string, text: string): string[] => termsOf(`${topic.replace(/[.-]/g, ' ')} ${text}`);

export const higherClass = (a: DataClass, b: DataClass): DataClass => maxDataClass(a, b);
export const classAbove = (a: DataClass, ceiling: DataClass): boolean => dataRank(a) > dataRank(ceiling);

export function certificationsOf(ctx: StoreContext, employeeId: Id): CertificationRecord[] {
  return ctx.db.all('SELECT * FROM certifications WHERE employee_id = ? ORDER BY issued_at, id', employeeId).map(mapCertification);
}
