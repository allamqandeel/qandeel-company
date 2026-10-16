/**
 * COMPANY-TALENT-01 — the Talent Catalog: identity profiles and Academy program definitions as versioned Company data.
 *
 * A definition is authored in the Company's own surface — by the Founder, or proposed by a leader's governed run — as an
 * editable DRAFT. Submitting it validates it with the SAME validators the release-pinned definitions use (the identity
 * completeness gate; `assertAcademyPackage`, BQM-2 pins) and freezes its content by digest. Only the Founder approves it
 * (TALENT_DEFINITION_DECIDE, the governed confirmation); an approved version is in use until its successor supersedes it,
 * and stays readable forever (in-flight programs keep resolving it). From there the existing engines run unchanged: an
 * approved program is qualified (BQM-2), installed, enrolled and certified exactly like a release-pinned package, and an
 * approved identity profile is bound at hire and rendered as the Employee's identity kernel.
 *
 * Drafting grants nothing, spends nothing and calls no model. Definition content is local governed Company content: audit
 * rows carry IDs, codes and digests only (Rule A).
 */
import { QandeelError, assertCode, assertId, canonicalJson, newId, sha256Hex, type Id } from '@qandeel-company/domain';
import { assertAcademyPackage, academyPackageDigest, assertIdentitySpec, identityGaps, identityKernel, identitySpecDigest, type AcademyPackage, type IdentitySpec } from '@qandeel-company/mind';

import { benchmarkPinMismatch, pinsOfPackage } from './benchmark-pins.js';
import { getEmployeeRow, writeEmployeeHistory } from './governance-core.js';
import { founder, founderAdminWrite } from './governance.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { markReviewDue } from './skill-registry.js';
import { storeContext, type CompanyStore } from './store.js';

export type DefinitionKind = 'IDENTITY_PROFILE' | 'ACADEMY_PROGRAM';
export type DefinitionState = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED' | 'WITHDRAWN';

export interface DefinitionRecord {
  readonly id: Id;
  readonly kind: DefinitionKind;
  readonly code: string;
  readonly version: number;
  readonly roleRef: string;
  readonly title: string;
  readonly state: DefinitionState;
  readonly body: Record<string, unknown>;
  readonly sha256: string | null;
  readonly authorRef: string;
  readonly proposalId: Id | null;
  readonly submittedAt: string | null;
  readonly decidedByRef: string | null;
  readonly decidedAt: string | null;
  readonly decisionCode: string | null;
  readonly rowVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A draft's readiness: the gaps the validators report now (empty = it can be submitted). */
export interface DefinitionCheck {
  readonly ok: boolean;
  readonly gaps: readonly { readonly field: string; readonly reason: string }[];
  /** The digest the content would be frozen under (null while incomplete). */
  readonly sha256: string | null;
}

const KEY = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,9}$/;
const BODY_MAX = 1_900_000;
/** Pipeline states of an approved definition (in use or kept for in-flight programs). */
const RESOLVABLE: readonly DefinitionState[] = ['APPROVED', 'SUPERSEDED'];

export function mapDefinition(r: Record<string, unknown>): DefinitionRecord {
  const n = (k: string): string | null => (r[k] === null || r[k] === undefined ? null : String(r[k]));
  return {
    id: String(r.id) as Id,
    kind: String(r.kind) as DefinitionKind,
    code: String(r.code),
    version: Number(r.version),
    roleRef: String(r.role_ref),
    title: String(r.title),
    state: String(r.state) as DefinitionState,
    body: JSON.parse(String(r.body_json)) as Record<string, unknown>,
    sha256: n('sha256'),
    authorRef: String(r.author_ref),
    proposalId: n('proposal_id') as Id | null,
    submittedAt: n('submitted_at'),
    decidedByRef: n('decided_by_ref'),
    decidedAt: n('decided_at'),
    decisionCode: n('decision_code'),
    rowVersion: Number(r.row_version),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function txDefinition(ctx: StoreContext, id: Id): DefinitionRecord {
  const r = ctx.db.get('SELECT * FROM talent_definitions WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'talent definition not found', { definitionId: id });
  return mapDefinition(r);
}

function history(ctx: StoreContext, d: { id: Id; sha256: string | null }, from: DefinitionState | null, to: DefinitionState, reasonCode: string, actorRef: string): void {
  ctx.db.run('INSERT INTO talent_definition_history (definition_id, from_state, to_state, sha256, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', d.id, from, to, d.sha256, reasonCode, actorRef, ts(ctx));
}

/**
 * The validation a definition must pass to be submitted (and again at approval), with the context the datastore holds:
 * - IDENTITY_PROFILE: the Stage 4 §7 completeness gate (`identityGaps`), including the kernel cap.
 * - ACADEMY_PROGRAM: `assertAcademyPackage`; BQM-2 pinned exactly to this build (no new BQM-1 program); a code never used
 *   by a release-pinned package; D6 — a program for a CEO or Director seat role requires Founder Calibration.
 */
export function txCheckDefinition(ctx: StoreContext, kind: DefinitionKind, body: unknown, releaseCodes: ReadonlySet<string>): DefinitionCheck {
  if (kind === 'IDENTITY_PROFILE') {
    const gaps = identityGaps(body);
    return { ok: gaps.length === 0, gaps, sha256: gaps.length === 0 ? identitySpecDigest(body as IdentitySpec) : null };
  }
  try {
    const pkg = assertAcademyPackage(body);
    const gaps: { field: string; reason: string }[] = [];
    if (pkg.benchmarkMethod === undefined || benchmarkPinMismatch(pinsOfPackage(pkg)) !== null) gaps.push({ field: 'benchmarkMethod', reason: 'BQM2_PINS_REQUIRED' });
    if (releaseCodes.has(pkg.code)) gaps.push({ field: 'code', reason: 'RELEASE_PACKAGE_CODE' });
    const leader = ctx.db.get(`SELECT 1 AS x FROM org_positions WHERE role_ref = ? AND kind IN ('CEO', 'DIRECTOR') LIMIT 1`, pkg.roleRef) !== undefined;
    if (leader && !pkg.program.founderCalibrationRequired) gaps.push({ field: 'program.founderCalibrationRequired', reason: 'LEADER_CALIBRATION_REQUIRED' });
    const newest = ctx.db.get<{ v: number | null }>('SELECT MAX(package_version) AS v FROM academy_packages WHERE code = ?', pkg.code)?.v ?? null;
    if (newest !== null && newest >= pkg.version) gaps.push({ field: 'version', reason: 'PACKAGE_VERSION_NOT_NEWER' });
    return { ok: gaps.length === 0, gaps, sha256: gaps.length === 0 ? academyPackageDigest(pkg) : null };
  } catch (error) {
    if (error instanceof QandeelError) return { ok: false, gaps: [{ field: String(error.details.field ?? 'program'), reason: error.message.slice(0, 160) }], sha256: null };
    throw error;
  }
}

/** What a body names as its code / version / role / title (program: from the package; identity: given + next version). */
function headerOf(ctx: StoreContext, kind: DefinitionKind, body: Record<string, unknown>, code: unknown): { code: string; version: number; roleRef: string; title: string } {
  const roleRef = typeof body.roleRef === 'string' && /^role:[a-z][a-z0-9.-]{1,60}$/.test(body.roleRef) ? body.roleRef : null;
  if (roleRef === null) throw new QandeelError('VALIDATION_FAILED', 'a definition names its role (role:<code>)', { field: 'roleRef' });
  if (kind === 'ACADEMY_PROGRAM') {
    const c = body.code;
    const v = body.version;
    if (typeof c !== 'string' || !KEY.test(c) || c.length > 96) throw new QandeelError('VALIDATION_FAILED', 'a program definition has a key code', { field: 'code' });
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 10_000) throw new QandeelError('VALIDATION_FAILED', 'a program definition has a version 1..10000', { field: 'version' });
    const title = typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim().slice(0, 160) : c;
    return { code: c, version: v, roleRef, title };
  }
  if (typeof code !== 'string' || !KEY.test(code) || code.length > 96) throw new QandeelError('VALIDATION_FAILED', 'an identity profile has a key code (e.g. majed-el-kedwany)', { field: 'code' });
  const next = (ctx.db.get<{ v: number | null }>(`SELECT MAX(version) AS v FROM talent_definitions WHERE kind = 'IDENTITY_PROFILE' AND code = ?`, code)?.v ?? 0) + 1;
  const title = typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim().slice(0, 160) : code;
  return { code, version: next, roleRef, title };
}

function bodyJson(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new QandeelError('VALIDATION_FAILED', 'a definition body is an object', { field: 'body' });
  const json = canonicalJson(body);
  if (json.length > BODY_MAX) throw new QandeelError('VALIDATION_FAILED', `a definition body is at most ${BODY_MAX} characters`, { field: 'body' });
  return json;
}

/**
 * Writes a DRAFT (in the caller's transaction): a new definition, or new content for an existing draft (version-safe).
 * An author is the Founder or a proposing Employee; neither grants anything.
 */
export function txSaveDraft(ctx: StoreContext, authorRef: string, input: { kind: DefinitionKind; body: unknown; code?: unknown; definitionId?: unknown; expectedRowVersion?: unknown; proposalId?: Id | null }): DefinitionRecord {
  const json = bodyJson(input.body);
  const body = JSON.parse(json) as Record<string, unknown>;
  const at = ts(ctx);
  if (input.definitionId !== undefined && input.definitionId !== null) {
    const d = txDefinition(ctx, assertId(input.definitionId, 'definitionId'));
    if (d.state !== 'DRAFT') throw new QandeelError('INVALID_TRANSITION', 'only a draft is edited; a submitted definition is frozen (a new version replaces it)', { reason: 'DEFINITION_FROZEN', state: d.state });
    if (input.expectedRowVersion !== undefined && input.expectedRowVersion !== d.rowVersion) throw new QandeelError('VERSION_CONFLICT', 'the draft changed since it was read', { definitionId: d.id });
    if (d.kind !== input.kind) throw new QandeelError('VALIDATION_FAILED', 'a draft keeps its kind', { field: 'kind' });
    const h = d.kind === 'ACADEMY_PROGRAM' ? headerOf(ctx, d.kind, body, null) : { ...headerOf(ctx, d.kind, body, d.code), version: d.version };
    if (h.code !== d.code || h.version !== d.version) throw new QandeelError('VALIDATION_FAILED', 'a draft keeps its code and version (a new code or version is a new draft)', { field: 'code' });
    ctx.db.run('UPDATE talent_definitions SET body_json = ?, role_ref = ?, title = ?, row_version = row_version + 1, updated_at = ? WHERE id = ? AND row_version = ?', json, h.roleRef, h.title, at, d.id, d.rowVersion);
    appendAudit(ctx, 'talent.definition_drafted', 'talent_definition', d.id, { actorRef: authorRef }, 'OK', d.kind, { rowVersion: d.rowVersion + 1 });
    return txDefinition(ctx, d.id);
  }
  const h = headerOf(ctx, input.kind, body, input.code);
  if (ctx.db.get('SELECT 1 AS x FROM talent_definitions WHERE kind = ? AND code = ? AND version = ?', input.kind, h.code, h.version)) throw new QandeelError('VALIDATION_FAILED', 'this code and version already exist: a new version takes a new number', { reason: 'DEFINITION_VERSION_TAKEN', field: 'version' });
  const id = newId();
  ctx.db.run(
    `INSERT INTO talent_definitions (id, kind, code, version, role_ref, title, state, body_json, sha256, author_ref, proposal_id, submitted_at, decided_by_ref, decided_at, decision_code, row_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, NULL, ?, ?, NULL, NULL, NULL, NULL, 1, ?, ?)`,
    id, input.kind, h.code, h.version, h.roleRef, h.title, json, authorRef, input.proposalId ?? null, at, at,
  );
  history(ctx, { id, sha256: null }, null, 'DRAFT', 'talent.drafted', authorRef);
  appendAudit(ctx, 'talent.definition_drafted', 'talent_definition', id, { actorRef: authorRef }, 'OK', input.kind, { version: h.version });
  return txDefinition(ctx, id);
}

/** DRAFT → SUBMITTED: validated now and frozen by its digest (refused with the first gap otherwise). */
export function txSubmitDefinition(ctx: StoreContext, actorRef: string, id: Id, releaseCodes: ReadonlySet<string>): DefinitionRecord {
  const d = txDefinition(ctx, id);
  if (d.state !== 'DRAFT') throw new QandeelError('INVALID_TRANSITION', 'only a draft is submitted', { reason: 'NOT_A_DRAFT', state: d.state });
  const check = txCheckDefinition(ctx, d.kind, d.body, releaseCodes);
  const first = check.gaps[0];
  if (!check.ok || check.sha256 === null) throw new QandeelError('VALIDATION_FAILED', `the definition is not complete: ${first?.field ?? ''} (${first?.reason ?? ''})`, { reason: 'DEFINITION_INCOMPLETE', field: first?.field ?? null, gaps: check.gaps.length });
  const at = ts(ctx);
  ctx.db.run(`UPDATE talent_definitions SET state = 'SUBMITTED', sha256 = ?, submitted_at = ?, row_version = row_version + 1, updated_at = ? WHERE id = ? AND row_version = ?`, check.sha256, at, at, d.id, d.rowVersion);
  history(ctx, { id: d.id, sha256: check.sha256 }, 'DRAFT', 'SUBMITTED', 'talent.submitted', actorRef);
  appendAudit(ctx, 'talent.definition_submitted', 'talent_definition', d.id, { actorRef }, 'OK', d.kind, { sha256: check.sha256.slice(0, 16) });
  return txDefinition(ctx, d.id);
}

/**
 * The Founder's decision on a definition (inside the governed confirmation). APPROVE freezes a still-draft definition
 * first (the previewed digest must be its digest now) and supersedes the code's previous approved version; REJECT closes
 * it. Nothing here installs, enrolls, hires or grants: an approved definition is only available to those acts.
 */
export function txDecideDefinition(ctx: StoreContext, founderRef: string, id: Id, input: { decision: 'APPROVE' | 'REJECT'; expectedSha256: string; reasonCode: string }, releaseCodes: ReadonlySet<string>): DefinitionRecord {
  let d = txDefinition(ctx, id);
  if (d.state === 'DRAFT') d = txSubmitDefinition(ctx, founderRef, d.id, releaseCodes);
  if (d.state !== 'SUBMITTED') throw new QandeelError('INVALID_TRANSITION', 'only a submitted definition is decided', { reason: 'NOT_SUBMITTED', state: d.state });
  if (d.sha256 !== input.expectedSha256) throw new QandeelError('VALIDATION_FAILED', 'the definition changed since the preview', { reason: 'DEFINITION_DIGEST_MISMATCH' });
  const at = ts(ctx);
  const reason = assertCode(input.reasonCode, 'reasonCode');
  if (input.decision === 'APPROVE') {
    // The check runs again at approval: what the Founder approves is valid in the datastore's current state.
    const check = txCheckDefinition(ctx, d.kind, d.body, releaseCodes);
    if (!check.ok || check.sha256 !== d.sha256) throw new QandeelError('VALIDATION_FAILED', 'the definition no longer passes its checks', { reason: 'DEFINITION_INCOMPLETE', field: check.gaps[0]?.field ?? null });
    const prior = ctx.db.get(`SELECT * FROM talent_definitions WHERE kind = ? AND code = ? AND state = 'APPROVED'`, d.kind, d.code);
    if (prior) {
      const p = mapDefinition(prior);
      ctx.db.run(`UPDATE talent_definitions SET state = 'SUPERSEDED', row_version = row_version + 1, updated_at = ? WHERE id = ? AND row_version = ?`, at, p.id, p.rowVersion);
      history(ctx, p, 'APPROVED', 'SUPERSEDED', 'talent.superseded', founderRef);
    }
  }
  const to = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  ctx.db.run(`UPDATE talent_definitions SET state = ?, decided_by_ref = ?, decided_at = ?, decision_code = ?, row_version = row_version + 1, updated_at = ? WHERE id = ? AND row_version = ?`, to, founderRef, at, reason, at, d.id, d.rowVersion);
  history(ctx, d, 'SUBMITTED', to, reason, founderRef);
  appendAudit(ctx, input.decision === 'APPROVE' ? 'talent.definition_approved' : 'talent.definition_rejected', 'talent_definition', d.id, { actorRef: founderRef }, 'OK', reason, { kind: d.kind, version: d.version });
  return txDefinition(ctx, d.id);
}

/**
 * The approved Academy program definitions (APPROVED, or SUPERSEDED but still resolvable for programs in flight), each
 * re-validated and checked against its frozen digest. A row whose content no longer matches its digest is never served.
 */
export function txCatalogPackages(ctx: StoreContext): AcademyPackage[] {
  const out: AcademyPackage[] = [];
  // A Company opened by an older build's schema (a test fixture of a released version) has no catalog yet.
  if (!ctx.db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'talent_definitions'")) return out;
  for (const r of ctx.db.all(`SELECT * FROM talent_definitions WHERE kind = 'ACADEMY_PROGRAM' AND state IN ('APPROVED', 'SUPERSEDED') ORDER BY code, version`)) {
    const d = mapDefinition(r);
    try {
      const pkg = assertAcademyPackage(d.body);
      if (academyPackageDigest(pkg) === d.sha256 && pkg.code === d.code && pkg.version === d.version) out.push(pkg);
    } catch {
      // An invalid frozen row is never served (the datastore's own triggers make this unreachable).
    }
  }
  return out;
}

/** The release-pinned packages plus the approved catalog programs (a release code always wins; codes never collide). */
export function txAllPackages(ctx: StoreContext, release: readonly AcademyPackage[]): AcademyPackage[] {
  const codes = new Set(release.map((p) => p.code));
  return [...release, ...txCatalogPackages(ctx).filter((p) => !codes.has(p.code))];
}

/** An approved identity profile (refused otherwise), with its spec, digest and kernel. */
export function txApprovedIdentity(ctx: StoreContext, id: Id): { definition: DefinitionRecord; spec: IdentitySpec; kernel: string } {
  const d = txDefinition(ctx, id);
  if (d.kind !== 'IDENTITY_PROFILE') throw new QandeelError('VALIDATION_FAILED', 'not an identity profile', { reason: 'NOT_AN_IDENTITY_PROFILE' });
  if (d.state !== 'APPROVED') throw new QandeelError('VALIDATION_FAILED', 'only an approved identity profile is used', { reason: 'IDENTITY_NOT_APPROVED', state: d.state });
  const spec = assertIdentitySpec(d.body);
  if (identitySpecDigest(spec) !== d.sha256) throw new QandeelError('STORAGE_INVARIANT', 'an approved identity profile no longer matches its digest', { definitionId: d.id });
  return { definition: d, spec, kernel: identityKernel(spec) };
}

export interface IdentityBindingRecord {
  readonly id: Id;
  readonly employeeId: Id;
  readonly definitionId: Id;
  readonly sha256: string;
  readonly kernelSha256: string;
  readonly classification: 'INITIAL' | 'MINOR' | 'MATERIAL';
  readonly boundByRef: string;
  readonly boundAt: string;
  readonly endedAt: string | null;
}

const mapBinding = (r: Record<string, unknown>): IdentityBindingRecord => ({
  id: String(r.id) as Id,
  employeeId: String(r.employee_id) as Id,
  definitionId: String(r.definition_id) as Id,
  sha256: String(r.sha256),
  kernelSha256: String(r.kernel_sha256),
  classification: String(r.classification) as IdentityBindingRecord['classification'],
  boundByRef: String(r.bound_by_ref),
  boundAt: String(r.bound_at),
  endedAt: r.ended_at === null ? null : String(r.ended_at),
});

export function txLiveIdentityBinding(ctx: StoreContext, employeeId: Id): IdentityBindingRecord | null {
  if (!ctx.db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'employee_identity_bindings'")) return null;
  const r = ctx.db.get('SELECT * FROM employee_identity_bindings WHERE employee_id = ? AND ended_at IS NULL', employeeId);
  return r ? mapBinding(r) : null;
}

export function txIdentityBindings(ctx: StoreContext, employeeId: Id): IdentityBindingRecord[] {
  return ctx.db.all('SELECT * FROM employee_identity_bindings WHERE employee_id = ? ORDER BY bound_at, id', employeeId).map(mapBinding);
}

/**
 * The identity kernel the runtime renders for an Employee: its live binding's approved profile, else the kernel copied
 * at hire (`profile_json.identityKernel`, the release-pinned CEO profile path — kept exactly as it is).
 */
export function txIdentityKernelOf(ctx: StoreContext, employeeId: Id, profile: unknown): { kernel: string | null; source: string | null } {
  const b = txLiveIdentityBinding(ctx, employeeId);
  if (b) {
    const r = ctx.db.get<{ body_json: string; code: string; version: number }>('SELECT body_json, code, version FROM talent_definitions WHERE id = ?', b.definitionId);
    if (r) {
      const kernel = identityKernel(assertIdentitySpec(JSON.parse(r.body_json)));
      if (sha256Hex(kernel) === b.kernelSha256) return { kernel, source: `talent:${r.code}@v${r.version}` };
    }
  }
  const p = profile as { identityKernel?: unknown; identityProfile?: unknown } | null;
  const k = p?.identityKernel;
  return { kernel: typeof k === 'string' && k.trim().length > 0 && k.length <= 2_400 ? k : null, source: typeof p?.identityProfile === 'string' ? p.identityProfile : null };
}

/** Whether an identity profile code is already carried by a live Employee (an identity is one person). */
export function txIdentityCarrier(ctx: StoreContext, code: string): Id | null {
  return (ctx.db.get<{ e: string }>(`SELECT b.employee_id AS e FROM employee_identity_bindings b JOIN talent_definitions d ON d.id = b.definition_id WHERE d.code = ? AND d.kind = 'IDENTITY_PROFILE' AND b.ended_at IS NULL LIMIT 1`, code)?.e ?? null) as Id | null;
}

/**
 * Binds an approved identity profile to an Employee (in the caller's transaction): ends the live binding, starts the
 * next, appends Employee history. A MATERIAL revision makes the Employee's VALID certifications REVIEW_DUE (Stage 4 §5,
 * Stage 6 §14), like a reasoning-profile change; a MINOR one changes no certification.
 */
export function txBindIdentity(ctx: StoreContext, founderRef: string, employeeId: Id, definitionId: Id, classification: 'INITIAL' | 'MINOR' | 'MATERIAL', reasonCode: string): IdentityBindingRecord {
  const e = getEmployeeRow(ctx, employeeId);
  const { definition, kernel } = txApprovedIdentity(ctx, definitionId);
  if (definition.roleRef !== e.roleRef) throw new QandeelError('VALIDATION_FAILED', 'the identity profile belongs to another role', { reason: 'IDENTITY_ROLE_MISMATCH' });
  const carrier = txIdentityCarrier(ctx, definition.code);
  if (carrier !== null && carrier !== e.id) throw new QandeelError('VALIDATION_FAILED', 'this identity is already carried by another Employee', { reason: 'IDENTITY_CARRIED' });
  const live = txLiveIdentityBinding(ctx, e.id);
  const at = ts(ctx);
  if (live) {
    if (live.definitionId === definitionId) throw new QandeelError('INVALID_TRANSITION', 'the Employee already carries this identity version', { reason: 'IDENTITY_UNCHANGED' });
    ctx.db.run('UPDATE employee_identity_bindings SET ended_at = ?, ended_by_ref = ? WHERE id = ? AND ended_at IS NULL', at, founderRef, live.id);
  }
  const id = newId();
  ctx.db.run('INSERT INTO employee_identity_bindings (id, employee_id, definition_id, sha256, kernel_sha256, classification, bound_by_ref, bound_at, ended_at, ended_by_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)', id, e.id, definitionId, definition.sha256, sha256Hex(kernel), classification, founderRef, at);
  if (classification !== 'INITIAL') {
    // The profile copy the hire made follows the binding (one version, one PROFILE history row); nothing earlier is rewritten.
    const profile = { ...((e.profile ?? {}) as Record<string, unknown>), identityProfile: `talent:${definition.code}@v${definition.version}`, identityKernel: kernel };
    const changed = ctx.db.run('UPDATE employees SET profile_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', JSON.stringify(profile), at, e.id, e.version).changes;
    if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'employee changed concurrently', { employeeId: e.id });
    writeEmployeeHistory(ctx, getEmployeeRow(ctx, e.id), 'PROFILE', live ? live.sha256.slice(0, 16) : null, String(definition.sha256).slice(0, 16), reasonCode, founderRef, { field: 'identity', definitionId, version: definition.version, classification });
  }
  if (classification === 'MATERIAL') for (const c of ctx.db.all<{ id: string }>(`SELECT id FROM certifications WHERE employee_id = ? AND status = 'VALID'`, e.id)) markReviewDue(ctx, c.id as Id, 'IDENTITY_MATERIAL_REVISION', founderRef);
  appendAudit(ctx, 'employee.identity_bound', 'employee', e.id, { actorRef: founderRef }, 'OK', classification, { definitionId, version: definition.version });
  return mapBinding(ctx.db.get('SELECT * FROM employee_identity_bindings WHERE id = ?', id) ?? {});
}

/** The catalog store: Founder drafting (a session write — content, never authority) and reads. */
export class TalentCatalogStore {
  readonly #store: CompanyStore;
  readonly #releaseCodes: ReadonlySet<string>;

  private constructor(store: CompanyStore, release: readonly AcademyPackage[]) {
    this.#store = store;
    this.#releaseCodes = new Set(release.map((p) => p.code));
  }

  static for(store: CompanyStore, release: readonly AcademyPackage[] = []): TalentCatalogStore {
    return new TalentCatalogStore(store, release);
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  /** The Founder drafts (or edits a draft). Requires the armed Founder surface; grants and spends nothing. */
  saveDraft(actorRef: string, input: { kind: DefinitionKind; body: unknown; code?: unknown; definitionId?: unknown; expectedRowVersion?: unknown }): { definition: DefinitionRecord; check: DefinitionCheck } {
    return founderAdminWrite(this.#store, 'talent draft', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'talent draft');
      if (input.kind !== 'IDENTITY_PROFILE' && input.kind !== 'ACADEMY_PROGRAM') throw new QandeelError('VALIDATION_FAILED', 'kind is IDENTITY_PROFILE or ACADEMY_PROGRAM', { field: 'kind' });
      const d = txSaveDraft(ctx, p.ref, input);
      return { definition: d, check: txCheckDefinition(ctx, d.kind, d.body, this.#releaseCodes) };
    });
  }

  submit(actorRef: string, definitionId: string): DefinitionRecord {
    return founderAdminWrite(this.#store, 'talent submit', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'talent submit');
      return txSubmitDefinition(ctx, p.ref, assertId(definitionId, 'definitionId'), this.#releaseCodes);
    });
  }

  withdraw(actorRef: string, definitionId: string): DefinitionRecord {
    return founderAdminWrite(this.#store, 'talent withdraw', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'talent withdraw');
      const d = txDefinition(ctx, assertId(definitionId, 'definitionId'));
      if (d.state !== 'DRAFT' && d.state !== 'SUBMITTED') throw new QandeelError('INVALID_TRANSITION', 'only a draft or submitted definition is withdrawn', { state: d.state });
      ctx.db.run(`UPDATE talent_definitions SET state = 'WITHDRAWN', row_version = row_version + 1, updated_at = ? WHERE id = ? AND row_version = ?`, ts(ctx), d.id, d.rowVersion);
      history(ctx, d, d.state, 'WITHDRAWN', 'talent.withdrawn', p.ref);
      appendAudit(ctx, 'talent.definition_withdrawn', 'talent_definition', d.id, { actorRef: p.ref }, 'OK', d.kind, {});
      return txDefinition(ctx, d.id);
    });
  }

  get(definitionId: string): DefinitionRecord {
    return this.#read((ctx) => txDefinition(ctx, assertId(definitionId, 'definitionId')));
  }

  check(definitionId: string): DefinitionCheck {
    return this.#read((ctx) => {
      const d = txDefinition(ctx, assertId(definitionId, 'definitionId'));
      return txCheckDefinition(ctx, d.kind, d.body, this.#releaseCodes);
    });
  }

  list(filter: { kind?: DefinitionKind; roleRef?: string } = {}): DefinitionRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM talent_definitions ORDER BY kind, code, version').map(mapDefinition).filter((d) => (filter.kind === undefined || d.kind === filter.kind) && (filter.roleRef === undefined || d.roleRef === filter.roleRef)));
  }

  history(definitionId: string): { fromState: string | null; toState: string; reasonCode: string; actorRef: string; at: string }[] {
    return this.#read((ctx) => ctx.db.all<{ from_state: string | null; to_state: string; reason_code: string; actor_ref: string; occurred_at: string }>('SELECT * FROM talent_definition_history WHERE definition_id = ? ORDER BY id', assertId(definitionId, 'definitionId')).map((r) => ({ fromState: r.from_state, toState: r.to_state, reasonCode: r.reason_code, actorRef: r.actor_ref, at: r.occurred_at })));
  }

  bindings(employeeId: string): IdentityBindingRecord[] {
    return this.#read((ctx) => txIdentityBindings(ctx, assertId(employeeId, 'employeeId')));
  }

  packages(release: readonly AcademyPackage[]): AcademyPackage[] {
    return this.#read((ctx) => txAllPackages(ctx, release));
  }
}

export const RESOLVABLE_DEFINITION_STATES = RESOLVABLE;
