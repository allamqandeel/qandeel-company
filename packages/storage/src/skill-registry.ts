/**
 * SkillStore — the C3 central Skill Registry, Role Skill Blueprints, Employee Skill Passports and
 * Continuous Skill Intelligence intake (Stage 7).
 *
 * - Skill ≠ Tool ≠ Authority: nothing here creates or changes a grant; `requestedTools` is metadata.
 * - External / Adapted payloads are inert, bounded, hashed text in quarantine. Deterministic steps
 *   (inspection, license / dependency check) are system actions that can only move a version forward
 *   or reject it; every step that admits a version toward production, and every freshness / rollout /
 *   rollback act, is Founder authority and fails closed until the authenticated surface exists (C5).
 * - Production resolves only pinned version IDs, never "latest"; a passport pins only an approved
 *   version (datastore trigger), and proficiency beyond LEARNING comes only from certification.
 */
import { QandeelError, assertCode, assertId, assertOpaqueRef, boundedText, canonicalJson, newId, sha256Hex, type Id } from '@qandeel-company/domain';
import {
  PIPELINE_NEXT,
  assertBlueprintEntries,
  assertDependencies,
  assertDirectives,
  assertKeyCode,
  assertPipelineStep,
  classifyLicense,
  costLabel,
  hasPaidDependency,
  inspectSkillPayload,
  mandatory,
  SKILL_TYPES,
  FRESHNESS_STATES,
  RECERTIFICATION_IMPACTS,
  terms as termsOf,
  type BlueprintEntry,
  type Freshness,
  type IneligibilityReason,
  type PipelineState,
  type RecertificationImpact,
  type SkillType,
} from '@qandeel-company/mind';

import { founder, founderAdminWrite } from './governance.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { SYSTEM_MIND_REF, getSkillVersionRow, versionEligibility } from './mind-core.js';
import {
  mapCertification,
  mapPassport,
  mapSkill,
  mapSkillUpdate,
  mapSkillVersion,
  type BlueprintRecord,
  type PassportEntryRecord,
  type SkillRecord,
  type SkillUpdateRecord,
  type SkillVersionRecord,
} from './mind-records.js';
import { storeContext, type CompanyStore } from './store.js';

export interface RegisterSkillVersionInput {
  readonly skillId: string;
  readonly versionLabel: string;
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly authorRef: string;
  readonly licenseSpdx: string | null;
  readonly dependencies: readonly { name: string; kind: string; paid: boolean }[];
  readonly compatibility?: Record<string, string>;
  readonly requestedTools?: readonly string[];
  readonly directives?: Record<string, string>;
  readonly instructions: string;
  readonly previousVersionId?: string;
  readonly discoveryId?: string;
}

export interface SkillHealth {
  readonly skills: number;
  readonly versionsByPipeline: Record<string, number>;
  readonly versionsByFreshness: Record<string, number>;
  readonly securityHolds: number;
  readonly paidDependencyVersions: number;
  readonly quarantined: number;
  readonly passportsRecertificationRequired: number;
  readonly passportsOnIneligibleVersions: number;
  readonly updatesPlanned: number;
  readonly discoveriesNew: number;
}

function history(ctx: StoreContext, v: SkillVersionRecord, kind: string, from: string | null, to: string, reason: string, actorRef: string, evidenceRef: string | null = null): void {
  ctx.db.run(
    'INSERT INTO skill_version_history (skill_version_id, version, change_kind, from_value, to_value, reason_code, evidence_ref, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    v.id, v.version + 1, kind, from, to, reason, evidenceRef, actorRef, ts(ctx),
  );
  appendAudit(ctx, `skill_version.${kind.toLowerCase()}`, 'skill_version', v.id, { actorRef }, 'OK', reason, { from, to });
}

function passportHistory(ctx: StoreContext, id: Id, version: number, skillVersionId: string, proficiency: string, status: string, reason: string, actorRef: string): void {
  ctx.db.run('INSERT INTO passport_history (passport_entry_id, version, skill_version_id, proficiency, status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, version, skillVersionId, proficiency, status, reason, actorRef, ts(ctx));
}

export class SkillStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): SkillStore {
    return new SkillStore(store);
  }

  #write<T>(operation: string, fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.immediate(operation, () => fn(ctx));
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  // --- Registry --------------------------------------------------------------------------------------

  registerSkill(actorRef: string, input: { code: string; name: string; skillType: SkillType; ownerRef: string; marketCode?: string }): SkillRecord {
    return founderAdminWrite(this.#store, 'register skill', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'skill registration');
      if (!(SKILL_TYPES as readonly string[]).includes(input.skillType)) throw new QandeelError('VALIDATION_FAILED', 'unknown skill type', { field: 'skillType' });
      if (input.marketCode !== undefined && !/^[a-z][a-z0-9-]{1,31}$/.test(input.marketCode)) throw new QandeelError('VALIDATION_FAILED', 'marketCode is a short code', { field: 'marketCode' });
      const id = newId();
      const at = ts(ctx);
      ctx.db.run(
        `INSERT INTO skills (id, code, name, skill_type, owner_ref, market_code, status, version, created_by_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?)`,
        id, assertKeyCode(input.code, 'code'), boundedText(input.name, 'name', 120), input.skillType, assertOpaqueRef(input.ownerRef, 'ownerRef'), input.marketCode ?? null, p.ref, at, at,
      );
      appendAudit(ctx, 'skill.registered', 'skill', id, { actorRef: p.ref }, 'OK', null, { skillType: input.skillType });
      return mapSkill(ctx.db.get('SELECT * FROM skills WHERE id = ?', id) ?? {});
    });
  }

  /**
   * Continuous Skill Intelligence intake (Stage 7 §22): one record per source revision. A repeated
   * sighting only counts, so no Employee re-researches the same update. Intake grants nothing.
   */
  intakeDiscovery(discovererRef: string, input: { skillCode: string; sourceRef: string; sourceRevision: string }): { id: Id; duplicate: boolean; seenCount: number } {
    return this.#write('skill discovery', (ctx) => {
      const skillCode = assertKeyCode(input.skillCode, 'skillCode');
      const sourceRef = assertOpaqueRef(input.sourceRef, 'sourceRef');
      const revision = assertCode(input.sourceRevision, 'sourceRevision');
      const fingerprint = sha256Hex(canonicalJson({ skillCode, sourceRef, revision }));
      const existing = ctx.db.get<{ id: string; seen_count: number }>('SELECT id, seen_count FROM skill_discoveries WHERE fingerprint = ?', fingerprint);
      const at = ts(ctx);
      if (existing) {
        ctx.db.run('UPDATE skill_discoveries SET seen_count = seen_count + 1, updated_at = ? WHERE id = ?', at, existing.id);
        return { id: existing.id as Id, duplicate: true, seenCount: Number(existing.seen_count) + 1 };
      }
      const id = newId();
      ctx.db.run(`INSERT INTO skill_discoveries (id, fingerprint, skill_code, source_ref, source_revision, discovered_by_ref, state, seen_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'NEW', 1, ?, ?)`, id, fingerprint, skillCode, sourceRef, revision, assertOpaqueRef(discovererRef, 'discovererRef'), at, at);
      appendAudit(ctx, 'skill.discovered', 'skill_discovery', id, { actorRef: discovererRef }, 'OK', null, {});
      return { id, duplicate: false, seenCount: 1 };
    });
  }

  /** Registers a pinned version's inert payload in quarantine (DISCOVERED). Nothing is executed or loaded. */
  registerSkillVersion(actorRef: string, input: RegisterSkillVersionInput): SkillVersionRecord {
    return founderAdminWrite(this.#store, 'register skill version', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'skill version registration');
      const skillId = assertId(input.skillId, 'skillId');
      const skill = mapSkill(ctx.db.get('SELECT * FROM skills WHERE id = ?', skillId) ?? notFound('skill', skillId));
      if (skill.status !== 'ACTIVE') throw new QandeelError('TERMINAL_STATE', 'a retired skill takes no versions', { skillId });
      const deps = assertDependencies(input.dependencies);
      const directives = assertDirectives(input.directives ?? {});
      const tools = [...new Set((input.requestedTools ?? []).map((t) => assertKeyCode(t, 'requestedTools')))];
      const instructions = boundedText(input.instructions, 'instructions', 16_000);
      if (input.licenseSpdx !== null && (typeof input.licenseSpdx !== 'string' || !/^[A-Za-z0-9.+-]{1,64}$/.test(input.licenseSpdx))) throw new QandeelError('VALIDATION_FAILED', 'licenseSpdx is an SPDX identifier or null', { field: 'licenseSpdx' });
      const compatibility = input.compatibility ?? {};
      for (const [k, v] of Object.entries(compatibility)) if (!/^[a-z][a-z0-9.-]{0,31}$/.test(k) || typeof v !== 'string' || v.length > 64) throw new QandeelError('VALIDATION_FAILED', 'compatibility is a map of short codes', { field: 'compatibility' });
      const id = newId();
      const at = ts(ctx);
      ctx.db.run(
        `INSERT INTO skill_versions (id, skill_id, version_label, source_ref, source_revision, author_ref, acquired_at, license_spdx, license_status, dependencies_json, paid_dependency, compatibility_json, requested_tools_json, directives_json,
           instructions, instructions_sha256, terms_json, inspection_findings_json, security_status, benchmark_refs_json, pipeline_state, freshness, previous_version_id, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'PENDING', '[]', 'DISCOVERED', 'CURRENT', ?, 1, ?, ?)`,
        id, skillId, boundedText(input.versionLabel, 'versionLabel', 32), assertOpaqueRef(input.sourceRef, 'sourceRef'), assertCode(input.sourceRevision, 'sourceRevision'), assertOpaqueRef(input.authorRef, 'authorRef'), at,
        input.licenseSpdx, classifyLicense(input.licenseSpdx, skill.skillType), JSON.stringify(deps), hasPaidDependency(deps) ? 1 : 0, JSON.stringify(compatibility), JSON.stringify(tools), JSON.stringify(directives),
        instructions, sha256Hex(instructions), JSON.stringify(termsOf(`${skill.code.replace(/[.-]/g, ' ')} ${skill.name} ${instructions}`)), input.previousVersionId === undefined ? null : assertId(input.previousVersionId, 'previousVersionId'), at, at,
      );
      if (input.discoveryId !== undefined) ctx.db.run(`UPDATE skill_discoveries SET state = 'INTAKEN', skill_version_id = ?, updated_at = ? WHERE id = ? AND state = 'NEW'`, id, at, assertId(input.discoveryId, 'discoveryId'));
      const v = getSkillVersionRow(ctx, id);
      ctx.db.run('INSERT INTO skill_version_history (skill_version_id, version, change_kind, from_value, to_value, reason_code, evidence_ref, actor_ref, occurred_at) VALUES (?, 1, ?, NULL, ?, ?, NULL, ?, ?)', id, 'REGISTERED', 'DISCOVERED', 'skill_version.registered', p.ref, at);
      appendAudit(ctx, 'skill_version.registered', 'skill_version', id, { actorRef: p.ref }, 'OK', null, { skillId, licenseStatus: v.licenseStatus, paidDependency: v.paidDependency });
      return v;
    });
  }

  #advance(ctx: StoreContext, v: SkillVersionRecord, to: PipelineState, reason: string, actorRef: string, set: { findings?: string[]; security?: 'CLEARED' | 'FAILED'; benchmark?: string; approvedBy?: string } = {}, evidenceRef: string | null = null): SkillVersionRecord {
    assertPipelineStep(v.pipelineState, to);
    const benchmarks = set.benchmark ? [...v.benchmarkRefs, set.benchmark] : v.benchmarkRefs;
    const changed = ctx.db.run(
      `UPDATE skill_versions SET pipeline_state = ?, failure_reason = ?, inspection_findings_json = COALESCE(?, inspection_findings_json), security_status = COALESCE(?, security_status), benchmark_refs_json = ?, approved_by_ref = COALESCE(?, approved_by_ref), version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
      to, to === 'REJECTED' ? reason.slice(0, 64) : null, set.findings === undefined ? null : JSON.stringify(set.findings), set.security ?? null, JSON.stringify(benchmarks), set.approvedBy ?? null, ts(ctx), v.id, v.version,
    ).changes;
    if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'skill version changed concurrently', { skillVersionId: v.id });
    history(ctx, v, 'PIPELINE', v.pipelineState, to, reason, actorRef, evidenceRef);
    return getSkillVersionRow(ctx, v.id);
  }

  /** Deterministic static inspection (system). Findings reject the version; the reason is preserved. */
  inspectSkillVersion(versionId: string): SkillVersionRecord {
    return this.#write('inspect skill version', (ctx) => {
      const v = getSkillVersionRow(ctx, assertId(versionId, 'versionId'));
      if (v.pipelineState !== 'DISCOVERED') throw new QandeelError('INVALID_TRANSITION', 'only a discovered version is inspected', { skillVersionId: v.id });
      const instructions = String(ctx.db.get<{ i: string }>('SELECT instructions AS i FROM skill_versions WHERE id = ?', v.id)?.i);
      const findings = sha256Hex(instructions) === v.instructionsSha256 ? inspectSkillPayload(instructions, v.directives) : ['INTEGRITY_FAILED'];
      const inspected = this.#advance(ctx, v, 'INSPECTED', findings.length ? 'inspection.findings' : 'inspection.clean', SYSTEM_MIND_REF, { findings });
      return findings.length ? this.#advance(ctx, inspected, 'REJECTED', `INSPECTION_${findings[0]}`, SYSTEM_MIND_REF) : inspected;
    });
  }

  /** Deterministic license / dependency check (system). No clear free license → rejected, never production. */
  checkLicenseAndDependencies(versionId: string): SkillVersionRecord {
    return this.#write('check skill license', (ctx) => {
      const v = getSkillVersionRow(ctx, assertId(versionId, 'versionId'));
      if (v.pipelineState !== 'INSPECTED') throw new QandeelError('INVALID_TRANSITION', 'only an inspected version is license-checked', { skillVersionId: v.id });
      if (!(v.licenseStatus === 'CLEAR_FREE' || v.licenseStatus === 'QANDEEL_OWNED')) return this.#advance(ctx, v, 'REJECTED', `LICENSE_${v.licenseStatus}`, SYSTEM_MIND_REF);
      return this.#advance(ctx, v, 'LICENSE_DEPENDENCY_CHECKED', v.paidDependency ? 'license.clear_paid_dependency' : 'license.clear', SYSTEM_MIND_REF);
    });
  }

  /**
   * The governed pipeline steps from quarantine to rollout (Founder authority): SECURITY_QUARANTINE →
   * SANDBOXED (security cleared, with evidence) → BENCHMARKED → COMPARED → APPROVED → [TARGETED_LEARNING]
   * → ROLLED_OUT, or REJECTED with its reason. Approval re-checks license, findings and paid dependencies.
   */
  advanceSkillVersion(actorRef: string, versionId: string, to: PipelineState, input: { reasonCode: string; evidenceRef?: string; securityPassed?: boolean }): SkillVersionRecord {
    return founderAdminWrite(this.#store, 'advance skill version', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'skill pipeline');
      const v = getSkillVersionRow(ctx, assertId(versionId, 'versionId'));
      if (to === 'INSPECTED' || to === 'LICENSE_DEPENDENCY_CHECKED') throw new QandeelError('INVALID_TRANSITION', 'inspection and license checks are deterministic system steps', { to });
      if (!PIPELINE_NEXT[v.pipelineState].includes(to)) assertPipelineStep(v.pipelineState, to);
      const reason = assertCode(input.reasonCode, 'reasonCode');
      const evidence = input.evidenceRef === undefined ? null : assertOpaqueRef(input.evidenceRef, 'evidenceRef');
      if (to === 'SANDBOXED') {
        if (evidence === null) throw new QandeelError('VALIDATION_FAILED', 'leaving quarantine needs security review evidence', { field: 'evidenceRef' });
        if (input.securityPassed !== true) return this.#advance(ctx, this.#advance(ctx, v, 'SANDBOXED', reason, p.ref, { security: 'FAILED' }, evidence), 'REJECTED', 'SECURITY_REVIEW_FAILED', p.ref);
        return this.#advance(ctx, v, 'SANDBOXED', reason, p.ref, { security: 'CLEARED' }, evidence);
      }
      if (to === 'BENCHMARKED' && evidence === null) throw new QandeelError('VALIDATION_FAILED', 'a benchmark step records its evidence', { field: 'evidenceRef' });
      if (to === 'APPROVED') {
        if (v.paidDependency && !v.paidDependencyAcknowledged) throw new QandeelError('VALIDATION_FAILED', 'FREE_SKILL_PAID_DEPENDENCY: the paid dependency must be acknowledged explicitly first', { reason: 'PAID_DEPENDENCY_UNACKNOWLEDGED' });
        return this.#advance(ctx, v, 'APPROVED', reason, p.ref, { approvedBy: p.ref }, evidence);
      }
      return this.#advance(ctx, v, to, reason, p.ref, to === 'BENCHMARKED' && evidence !== null ? { benchmark: evidence } : {}, evidence);
    });
  }

  /** Makes a paid dependency an explicit, audited decision (spending stays governed by C2 budgets). */
  acknowledgePaidDependency(actorRef: string, versionId: string, reasonCode: string): SkillVersionRecord {
    return founderAdminWrite(this.#store, 'acknowledge paid dependency', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'paid dependency');
      const v = getSkillVersionRow(ctx, assertId(versionId, 'versionId'));
      if (!v.paidDependency) throw new QandeelError('INVALID_TRANSITION', 'this version has no paid dependency', { skillVersionId: v.id });
      ctx.db.run('UPDATE skill_versions SET paid_dependency_ack_ref = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', p.ref, ts(ctx), v.id, v.version);
      history(ctx, v, 'PAID_DEPENDENCY_ACK', null, 'ACKNOWLEDGED', assertCode(reasonCode, 'reasonCode'), p.ref);
      return getSkillVersionRow(ctx, v.id);
    });
  }

  /** Freshness / lifecycle (Stage 7 §23): SECURITY_HOLD and RETIRED block every load immediately. */
  setFreshness(actorRef: string, versionId: string, freshness: Freshness, reasonCode: string): SkillVersionRecord {
    return founderAdminWrite(this.#store, 'skill freshness', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'skill freshness');
      if (!(FRESHNESS_STATES as readonly string[]).includes(freshness)) throw new QandeelError('VALIDATION_FAILED', 'unknown freshness state', { field: 'freshness' });
      const v = getSkillVersionRow(ctx, assertId(versionId, 'versionId'));
      if (v.freshness === 'RETIRED') throw new QandeelError('TERMINAL_STATE', 'a retired version is history', { skillVersionId: v.id });
      ctx.db.run('UPDATE skill_versions SET freshness = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', freshness, ts(ctx), v.id, v.version);
      history(ctx, v, 'FRESHNESS', v.freshness, freshness, assertCode(reasonCode, 'reasonCode'), p.ref);
      return getSkillVersionRow(ctx, v.id);
    });
  }

  // --- Role Skill Blueprints -------------------------------------------------------------------------

  /** A new blueprint version for a role. The prior version is superseded and that role's certifications become REVIEW_DUE. */
  publishBlueprint(actorRef: string, roleRef: string, entries: readonly BlueprintEntry[]): BlueprintRecord {
    return founderAdminWrite(this.#store, 'publish blueprint', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'role blueprint');
      const role = assertOpaqueRef(roleRef, 'roleRef');
      if (!role.startsWith('role:')) throw new QandeelError('VALIDATION_FAILED', 'a blueprint belongs to a role ref', { field: 'roleRef' });
      const list = assertBlueprintEntries(entries);
      for (const e of list) if (!ctx.db.get(`SELECT 1 AS ok FROM skills WHERE id = ? AND status = 'ACTIVE'`, e.skillId)) throw new QandeelError('NOT_FOUND', 'blueprint skill not found', { skillId: e.skillId });
      const prior = ctx.db.get<{ id: string; version: number }>(`SELECT id, version FROM role_blueprints WHERE role_ref = ? AND status = 'ACTIVE'`, role);
      const at = ts(ctx);
      if (prior) ctx.db.run(`UPDATE role_blueprints SET status = 'SUPERSEDED' WHERE id = ?`, prior.id);
      const id = newId();
      ctx.db.run(`INSERT INTO role_blueprints (id, role_ref, version, status, created_by_ref, created_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?)`, id, role, (prior?.version ?? 0) + 1, p.ref, at);
      for (const e of list) ctx.db.run('INSERT INTO role_blueprint_entries (blueprint_id, skill_id, category, min_proficiency, critical) VALUES (?, ?, ?, ?, ?)', id, e.skillId, e.category, e.minProficiency, e.critical ? 1 : 0);
      if (prior) markRoleReviewDue(ctx, role, 'BLUEPRINT_CHANGED', p.ref);
      appendAudit(ctx, 'blueprint.published', 'role_blueprint', id, { actorRef: p.ref }, 'OK', null, { version: (prior?.version ?? 0) + 1, skills: list.length, mandatory: mandatory(list).length });
      return blueprintOf(ctx, id);
    });
  }

  blueprint(roleRef: string): BlueprintRecord | null {
    return this.#read((ctx) => {
      const r = ctx.db.get<{ id: string }>(`SELECT id FROM role_blueprints WHERE role_ref = ? AND status = 'ACTIVE'`, roleRef);
      return r ? blueprintOf(ctx, r.id as Id) : null;
    });
  }

  // --- Passports -------------------------------------------------------------------------------------

  /** Opens a LEARNING passport entry pinned to an approved version (training starts; proficiency comes from certification). */
  openPassportEntry(actorRef: string, employeeId: string, skillVersionId: string): PassportEntryRecord {
    return founderAdminWrite(this.#store, 'open passport entry', actorRef, (ctx) => {
      const id = assertId(employeeId, 'employeeId');
      const p = founder(ctx, actorRef, `employee:${id}`, 'skill passport');
      const v = getSkillVersionRow(ctx, assertId(skillVersionId, 'skillVersionId'));
      const entryId = newId();
      const at = ts(ctx);
      ctx.db.run(
        `INSERT INTO passport_entries (id, employee_id, skill_id, skill_version_id, proficiency, status, training_state, evidence_refs_json, provenance_ref, restrictions_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'LEARNING', 'ACTIVE', 'IN_TRAINING', '[]', ?, '[]', 1, ?, ?)`,
        entryId, id, v.skillId, v.id, `principal:${p.ref.slice(8)}`, at, at,
      );
      passportHistory(ctx, entryId, 1, v.id, 'LEARNING', 'ACTIVE', 'passport.opened', p.ref);
      appendAudit(ctx, 'passport.opened', 'passport_entry', entryId, { actorRef: p.ref }, 'OK', null, { employeeId: id, skillId: v.skillId });
      return mapPassport(ctx.db.get('SELECT * FROM passport_entries WHERE id = ?', entryId) ?? {});
    });
  }

  passport(employeeId: Id): PassportEntryRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM passport_entries WHERE employee_id = ? ORDER BY skill_id', employeeId).map(mapPassport));
  }

  // --- Material updates, rollout and rollback (Stage 7 §26, §28) -----------------------------------------

  /** Plans an update: the impact set (IDs only), the recertification impact and the rollback target (the from-version). */
  planUpdate(actorRef: string, input: { fromVersionId: string; toVersionId: string; material: boolean; recertificationImpact: RecertificationImpact }): SkillUpdateRecord {
    return founderAdminWrite(this.#store, 'plan skill update', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'skill update');
      const from = getSkillVersionRow(ctx, assertId(input.fromVersionId, 'fromVersionId'));
      const to = getSkillVersionRow(ctx, assertId(input.toVersionId, 'toVersionId'));
      if (from.skillId !== to.skillId) throw new QandeelError('VALIDATION_FAILED', 'an update stays within one skill', { field: 'toVersionId' });
      if (!(RECERTIFICATION_IMPACTS as readonly string[]).includes(input.recertificationImpact)) throw new QandeelError('VALIDATION_FAILED', 'unknown recertification impact', { field: 'recertificationImpact' });
      if (!input.material && input.recertificationImpact !== 'NONE') throw new QandeelError('VALIDATION_FAILED', 'a minor update has no recertification impact', { field: 'recertificationImpact' });
      if (!versionEligibility(ctx, to).eligible) throw new QandeelError('VALIDATION_FAILED', 'the target version is not production-eligible (approve it first)', { reason: 'TARGET_NOT_ELIGIBLE' });
      const passports = ctx.db.all<{ id: string; employee_id: string }>('SELECT id, employee_id FROM passport_entries WHERE skill_version_id = ? AND status <> ? ORDER BY id', from.id, 'REVOKED');
      const blueprints = ctx.db.all<{ id: string; role_ref: string }>(`SELECT b.id, b.role_ref FROM role_blueprints b JOIN role_blueprint_entries e ON e.blueprint_id = b.id WHERE e.skill_id = ? AND b.status = 'ACTIVE' ORDER BY b.id`, from.skillId);
      const certifications = ctx.db
        .all(`SELECT * FROM certifications WHERE status IN ('VALID', 'REVIEW_DUE') ORDER BY id`)
        .map(mapCertification)
        .filter((c) => c.skillPins.some((pin) => pin.skillVersionId === from.id));
      const impact = {
        blueprintIds: blueprints.map((b) => b.id),
        roleRefs: [...new Set(blueprints.map((b) => b.role_ref))],
        passportEntryIds: passports.map((x) => x.id),
        employeeIds: [...new Set(passports.map((x) => x.employee_id))],
        certificationIds: certifications.map((c) => c.id),
      };
      const id = newId();
      const at = ts(ctx);
      ctx.db.run(
        `INSERT INTO skill_updates (id, skill_id, from_version_id, to_version_id, material, recertification_impact, impact_json, rollback_target_id, state, planned_by_ref, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', ?, 1, ?, ?)`,
        id, from.skillId, from.id, to.id, input.material ? 1 : 0, input.recertificationImpact, JSON.stringify(impact), from.id, p.ref, at, at,
      );
      if (from.freshness === 'CURRENT') {
        ctx.db.run(`UPDATE skill_versions SET freshness = 'UPDATE_AVAILABLE', version = version + 1, updated_at = ? WHERE id = ?`, at, from.id);
        history(ctx, from, 'FRESHNESS', 'CURRENT', 'UPDATE_AVAILABLE', 'skill.update_planned', p.ref);
      }
      appendAudit(ctx, 'skill.update_planned', 'skill_update', id, { actorRef: p.ref }, 'OK', input.recertificationImpact, { passports: impact.passportEntryIds.length, certifications: impact.certificationIds.length, material: input.material });
      return mapSkillUpdate(ctx.db.get('SELECT * FROM skill_updates WHERE id = ?', id) ?? {});
    });
  }

  /** Controlled rollout: affected passports re-pin; a material update requires recertification (passports + certifications). */
  rolloutUpdate(actorRef: string, updateId: string): SkillUpdateRecord {
    return founderAdminWrite(this.#store, 'rollout skill update', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'skill rollout');
      const u = mapSkillUpdate(ctx.db.get('SELECT * FROM skill_updates WHERE id = ?', assertId(updateId, 'updateId')) ?? notFound('skill update', updateId));
      if (u.state !== 'PLANNED') throw new QandeelError('INVALID_TRANSITION', 'only a planned update rolls out', { updateId: u.id });
      const to = getSkillVersionRow(ctx, u.toVersionId);
      if (!versionEligibility(ctx, to).eligible) throw new QandeelError('VALIDATION_FAILED', 'the target version is no longer production-eligible', { reason: 'TARGET_NOT_ELIGIBLE' });
      const recert = u.material && u.recertificationImpact !== 'NONE';
      for (const pid of u.impact.passportEntryIds) {
        const pe = mapPassport(ctx.db.get('SELECT * FROM passport_entries WHERE id = ?', pid) ?? {});
        if (pe.skillVersionId !== u.fromVersionId || pe.status === 'REVOKED') continue;
        const status = recert ? 'RECERTIFICATION_REQUIRED' : pe.status;
        ctx.db.run(`UPDATE passport_entries SET skill_version_id = ?, status = ?, training_state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, u.toVersionId, status, recert ? 'RETRAINING_REQUIRED' : pe.trainingState, ts(ctx), pe.id, pe.version);
        passportHistory(ctx, pe.id, pe.version + 1, u.toVersionId, pe.proficiency, status, recert ? 'SKILL_MATERIAL_UPDATE' : 'SKILL_MINOR_UPDATE', p.ref);
      }
      if (recert) for (const cid of u.impact.certificationIds) markReviewDue(ctx, cid as Id, 'SKILL_MATERIAL_UPDATE', p.ref);
      if (to.pipelineState === 'APPROVED' || to.pipelineState === 'TARGETED_LEARNING') this.#advance(ctx, to, 'ROLLED_OUT', 'skill.rolled_out', p.ref);
      ctx.db.run(`UPDATE skill_updates SET state = 'ROLLED_OUT', version = version + 1, updated_at = ? WHERE id = ?`, ts(ctx), u.id);
      appendAudit(ctx, 'skill.update_rolled_out', 'skill_update', u.id, { actorRef: p.ref }, 'OK', recert ? 'RECERTIFICATION_REQUIRED' : 'NO_RECERTIFICATION', {});
      return mapSkillUpdate(ctx.db.get('SELECT * FROM skill_updates WHERE id = ?', u.id) ?? {});
    });
  }

  /**
   * Rolls a rolled-out update back to its rollback target, which must still be production-eligible.
   * Passports return to the previous version; certifications already marked REVIEW_DUE stay so
   * (rollback never bypasses recertification). The rolled-back version is deprecated.
   */
  rollbackUpdate(actorRef: string, updateId: string, reasonCode: string): SkillUpdateRecord {
    return founderAdminWrite(this.#store, 'rollback skill update', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'skill rollback');
      const u = mapSkillUpdate(ctx.db.get('SELECT * FROM skill_updates WHERE id = ?', assertId(updateId, 'updateId')) ?? notFound('skill update', updateId));
      if (u.state !== 'ROLLED_OUT') throw new QandeelError('INVALID_TRANSITION', 'only a rolled-out update is rolled back', { updateId: u.id });
      const target = getSkillVersionRow(ctx, u.rollbackTargetId);
      if (!versionEligibility(ctx, target).eligible) throw new QandeelError('VALIDATION_FAILED', 'the rollback target is no longer an approved, eligible version', { reason: 'ROLLBACK_TARGET_INELIGIBLE' });
      const reason = assertCode(reasonCode, 'reasonCode');
      for (const pid of u.impact.passportEntryIds) {
        const pe = mapPassport(ctx.db.get('SELECT * FROM passport_entries WHERE id = ?', pid) ?? {});
        if (pe.skillVersionId !== u.toVersionId || pe.status === 'REVOKED') continue;
        ctx.db.run('UPDATE passport_entries SET skill_version_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', target.id, ts(ctx), pe.id, pe.version);
        passportHistory(ctx, pe.id, pe.version + 1, target.id, pe.proficiency, pe.status, 'SKILL_ROLLED_BACK', p.ref);
      }
      const rolled = getSkillVersionRow(ctx, u.toVersionId);
      if (rolled.freshness !== 'RETIRED' && rolled.freshness !== 'DEPRECATED') {
        ctx.db.run(`UPDATE skill_versions SET freshness = 'DEPRECATED', version = version + 1, updated_at = ? WHERE id = ?`, ts(ctx), rolled.id);
        history(ctx, rolled, 'FRESHNESS', rolled.freshness, 'DEPRECATED', 'SKILL_ROLLED_BACK', p.ref);
      }
      ctx.db.run(`UPDATE skill_updates SET state = 'ROLLED_BACK', version = version + 1, updated_at = ? WHERE id = ?`, ts(ctx), u.id);
      appendAudit(ctx, 'skill.update_rolled_back', 'skill_update', u.id, { actorRef: p.ref }, 'OK', reason, {});
      return mapSkillUpdate(ctx.db.get('SELECT * FROM skill_updates WHERE id = ?', u.id) ?? {});
    });
  }

  // --- Reads -------------------------------------------------------------------------------------------

  skill(id: Id): SkillRecord {
    return this.#read((ctx) => mapSkill(ctx.db.get('SELECT * FROM skills WHERE id = ?', id) ?? notFound('skill', id)));
  }

  version(id: Id): SkillVersionRecord {
    return this.#read((ctx) => getSkillVersionRow(ctx, id));
  }

  versions(skillId: Id): SkillVersionRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY created_at, id', skillId).map(mapSkillVersion));
  }

  /** Production eligibility and the registry cost label of one version (content-free). */
  eligibility(versionId: Id): { eligible: boolean; reasons: readonly IneligibilityReason[]; degraded: boolean; costLabel: 'FREE' | 'FREE_SKILL_PAID_DEPENDENCY' } {
    return this.#read((ctx) => {
      const v = getSkillVersionRow(ctx, versionId);
      return { ...versionEligibility(ctx, v), costLabel: costLabel(v) };
    });
  }

  versionHistory(id: Id): { version: number; changeKind: string; fromValue: string | null; toValue: string; reasonCode: string; evidenceRef: string | null; actorRef: string }[] {
    return this.#read((ctx) =>
      ctx.db
        .all<{ version: number; change_kind: string; from_value: string | null; to_value: string; reason_code: string; evidence_ref: string | null; actor_ref: string }>('SELECT * FROM skill_version_history WHERE skill_version_id = ? ORDER BY version', id)
        .map((r) => ({ version: Number(r.version), changeKind: r.change_kind, fromValue: r.from_value, toValue: r.to_value, reasonCode: r.reason_code, evidenceRef: r.evidence_ref, actorRef: r.actor_ref })),
    );
  }

  update(id: Id): SkillUpdateRecord {
    return this.#read((ctx) => mapSkillUpdate(ctx.db.get('SELECT * FROM skill_updates WHERE id = ?', id) ?? notFound('skill update', id)));
  }

  healthCounts(): SkillHealth {
    return this.#read((ctx) => {
      const n = (sql: string): number => Number(ctx.db.get<{ n: number }>(sql)?.n ?? 0);
      const group = (sql: string): Record<string, number> => Object.fromEntries(ctx.db.all<{ s: string; n: number }>(sql).map((r) => [r.s, Number(r.n)]));
      const ineligible = ctx.db.all<{ v: string }>(`SELECT DISTINCT skill_version_id AS v FROM passport_entries WHERE status <> 'REVOKED'`).filter((r) => !versionEligibility(ctx, getSkillVersionRow(ctx, r.v as Id)).eligible).length;
      return {
        skills: n(`SELECT COUNT(*) AS n FROM skills WHERE status = 'ACTIVE'`),
        versionsByPipeline: group('SELECT pipeline_state AS s, COUNT(*) AS n FROM skill_versions GROUP BY pipeline_state'),
        versionsByFreshness: group('SELECT freshness AS s, COUNT(*) AS n FROM skill_versions GROUP BY freshness'),
        securityHolds: n(`SELECT COUNT(*) AS n FROM skill_versions WHERE freshness = 'SECURITY_HOLD'`),
        paidDependencyVersions: n('SELECT COUNT(*) AS n FROM skill_versions WHERE paid_dependency = 1'),
        quarantined: n(`SELECT COUNT(*) AS n FROM skill_versions WHERE pipeline_state IN ('DISCOVERED', 'INSPECTED', 'LICENSE_DEPENDENCY_CHECKED', 'SECURITY_QUARANTINE', 'SANDBOXED', 'BENCHMARKED', 'COMPARED')`),
        passportsRecertificationRequired: n(`SELECT COUNT(*) AS n FROM passport_entries WHERE status = 'RECERTIFICATION_REQUIRED'`),
        passportsOnIneligibleVersions: ineligible,
        updatesPlanned: n(`SELECT COUNT(*) AS n FROM skill_updates WHERE state = 'PLANNED'`),
        discoveriesNew: n(`SELECT COUNT(*) AS n FROM skill_discoveries WHERE state = 'NEW'`),
      };
    });
  }
}

function blueprintOf(ctx: StoreContext, id: Id): BlueprintRecord {
  const b = ctx.db.get<{ id: string; role_ref: string; version: number; status: string }>('SELECT * FROM role_blueprints WHERE id = ?', id);
  if (!b) throw new QandeelError('NOT_FOUND', 'blueprint not found', { blueprintId: id });
  const entries = ctx.db
    .all<{ skill_id: string; category: string; min_proficiency: string; critical: number }>('SELECT * FROM role_blueprint_entries WHERE blueprint_id = ? ORDER BY skill_id', id)
    .map((e) => ({ skillId: e.skill_id as Id, category: e.category, minProficiency: e.min_proficiency as BlueprintRecord['entries'][number]['minProficiency'], critical: Number(e.critical) === 1 }));
  return { id: b.id as Id, roleRef: b.role_ref, version: Number(b.version), status: b.status as 'ACTIVE' | 'SUPERSEDED', entries };
}

/** Marks one live certification REVIEW_DUE (material change); history and audit together. */
export function markReviewDue(ctx: StoreContext, certificationId: Id, reason: string, actorRef: string): boolean {
  const c = mapCertification(ctx.db.get('SELECT * FROM certifications WHERE id = ?', certificationId) ?? {});
  if (c.status !== 'VALID') return false;
  ctx.db.run(`UPDATE certifications SET status = 'REVIEW_DUE', reason_code = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, reason, ts(ctx), c.id, c.version);
  ctx.db.run('INSERT INTO certification_history (certification_id, version, from_status, to_status, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', c.id, c.version + 1, 'VALID', 'REVIEW_DUE', reason, actorRef, ts(ctx));
  appendAudit(ctx, 'certification.review_due', 'certification', c.id, { actorRef }, 'OK', reason, { employeeId: c.employeeId });
  return true;
}

export function markRoleReviewDue(ctx: StoreContext, roleRef: string, reason: string, actorRef: string): number {
  let n = 0;
  for (const r of ctx.db.all<{ id: string }>(`SELECT id FROM certifications WHERE role_ref = ? AND status = 'VALID'`, roleRef)) if (markReviewDue(ctx, r.id as Id, reason, actorRef)) n++;
  return n;
}

function notFound(what: string, id: string): never {
  throw new QandeelError('NOT_FOUND', `${what} not found`, { id });
}
