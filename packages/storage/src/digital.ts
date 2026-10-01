/**
 * C7-D — the Company's internal Digital Workshop and the identity of its governed external promotion (migration 0015).
 *
 * Inside the existing systems, never beside them:
 *   - every Employee act here is an action of the closed `digital-workspace` Tool, reached ONLY through the Tool Executor
 *     after the full C2 authority path (explicit Founder grant per action, risk ladder, idempotency, budget, fencing);
 *     its effect and its tool result commit in ONE fenced transaction (`txDigitalAct` + `txToolResult`);
 *   - file content lives in the content-addressed Artifact Store; SQLite holds paths, hashes, sizes and codes only;
 *   - a promotion is prepared here (exact arguments, ids and hashes only) and executed ONLY as an R3 tool action of the
 *     target's adapter: Review Pool review → Founder approval → driver → result / reconciliation. Its lifecycle is
 *     DERIVED from review_requests / approvals / tool_invocations — there is no second review, approval or execution
 *     state, and nothing here can mark a promotion approved or done;
 *   - publication is never an outcome: nothing here writes evaluations, attributions, learning or external evidence.
 * Audit and events carry ids, hashes and codes only (Rule A): never file content, a title or a summary.
 */
import { QandeelError, assertId, boundedText, canonicalJson, isQandeelError, isSha256Hex, newId, sha256Hex, type Id, type JsonObject } from '@qandeel-company/domain';
import {
  DIGITAL_CHUNK_BASE64_MAX,
  DIGITAL_CHUNK_BYTES,
  DIGITAL_MAX_FILE_BYTES,
  DIGITAL_READ_MAX,
  DIGITAL_WORKSPACE_DRIVER,
  PREVIEW_MODE,
  SOCIAL_PACKAGE_PATH,
  approvalFingerprint,
  assertCandidateKind,
  assertDigitalPath,
  assertManifestBounds,
  assertProjectTransition,
  assertProjectType,
  assertPromotionFits,
  assertPromotionKind,
  candidateFingerprint,
  digitalManifestSha256,
  digitalMedia,
  isRefusedPromotion,
  parseSocialPackage,
  pathKey,
  previewability,
  promotionArgs,
  promotionState,
  toolCapability,
  type CandidateKind,
  type DigitalManifestEntry,
  type DigitalProjectState,
  type DigitalProjectType,
  type PromotionFacts,
  type PromotionKind,
  type PromotionState,
  type TargetClass,
  type TargetState,
} from '@qandeel-company/governance';
import { containsSecretMaterial, seoReadiness, type SeoInputFile, type SeoReport } from '@qandeel-company/mind';

import { ArtifactStore } from './artifacts.js';
import { getEmployeeRow } from './governance-core.js';
import { founder, founderAdminWrite } from './governance.js';
import { attributed } from './governed-writes.js';
import { appendAudit, appendEvent, getWorkItemRow, ts, type StoreContext } from './internal.js';
import type { Fence } from './records.js';
import type { Row } from './sqlite/connection.js';
import { storeContext, type CompanyStore } from './store.js';

const s = (v: unknown): string => String(v);
const os = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** A refused digital act: its reason code becomes the tool failure code (never the refused content). */
const refuse = (reason: string): never => {
  throw new QandeelError('DIGITAL_REFUSED', `digital act refused: ${reason}`, { reason });
};

/** The tool failure code of a refused act (null: not a refusal — rethrow). */
export function digitalRefusalCode(error: unknown): string | null {
  if (isQandeelError(error, 'DIGITAL_REFUSED')) return s(error.details.reason ?? 'DIGITAL_REFUSED').slice(0, 64);
  if (isQandeelError(error, 'VALIDATION_FAILED')) return 'INVALID_ARGS';
  if (isQandeelError(error, 'NOT_FOUND')) return 'NOT_FOUND';
  if (isQandeelError(error, 'ARTIFACT_INTEGRITY') || isQandeelError(error, 'ARTIFACT_NOT_READY')) return 'ARTIFACT_INTEGRITY';
  return null;
}

// --- Content guards -----------------------------------------------------------------------------------------------

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** Strict base64 (canonical alphabet, padding, round-trip exact) — a malformed chunk is refused, never "repaired". */
function decodeBase64(v: string): Buffer {
  if (v.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v)) return refuse('BASE64_INVALID');
  const b = Buffer.from(v, 'base64');
  if (b.toString('base64') !== v) return refuse('BASE64_INVALID');
  return b;
}

/**
 * Text content is valid UTF-8 and carries no secret material anywhere (scanned in overlapping windows, so a long file is
 * scanned whole). Secrets never enter the Artifact Store through the workshop.
 */
function assertTextContent(bytes: Buffer): void {
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch {
    return refuse('TEXT_NOT_UTF8');
  }
  const WINDOW = 8000;
  for (let i = 0; i < text.length; i += WINDOW - 400) {
    if (containsSecretMaterial(text.slice(i, i + WINDOW))) refuse('SECRET_MATERIAL');
    if (i + WINDOW >= text.length) break;
  }
}

function assertCompanyText(v: unknown, field: string, max: number): string {
  const t = boundedText(v, field, max);
  if (containsSecretMaterial(t)) refuse('SECRET_MATERIAL');
  return t;
}

const optString = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : String(v));

// --- Rows -----------------------------------------------------------------------------------------------------------

export interface DigitalProjectRecord {
  readonly id: Id;
  readonly projectType: DigitalProjectType;
  readonly title: string;
  readonly goalId: Id | null;
  readonly state: DigitalProjectState;
  readonly workItemId: Id | null;
  readonly createdByRef: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DigitalRevisionRecord {
  readonly id: Id;
  readonly projectId: Id;
  readonly ordinal: number;
  readonly baseRevisionId: Id | null;
  readonly state: 'WORKING' | 'FINALIZED' | 'ABANDONED';
  readonly workItemId: Id;
  readonly createdByRef: string;
  readonly manifestSha256: string | null;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly createdAt: string;
  readonly finalizedAt: string | null;
}

export interface DigitalFileRecord {
  readonly path: string;
  readonly artifactId: Id;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mediaType: string;
}

export interface DigitalPreviewRecord {
  readonly id: Id;
  readonly revisionId: Id;
  readonly manifestSha256: string;
  readonly mode: typeof PREVIEW_MODE;
  readonly state: 'READY' | 'CAPABILITY_GAP';
  readonly entryPath: string | null;
  readonly gapCode: string | null;
  readonly createdByRef: string;
  readonly createdAt: string;
}

export interface DigitalCandidateRecord {
  readonly id: Id;
  readonly projectId: Id;
  readonly revisionId: Id;
  readonly manifestSha256: string;
  readonly kind: CandidateKind;
  readonly summary: string;
  readonly fingerprint: string;
  readonly workItemId: Id;
  readonly makerEmployeeId: Id;
  readonly createdAt: string;
}

export interface DigitalTargetRecord {
  readonly id: Id;
  readonly code: string;
  readonly targetClass: TargetClass;
  readonly adapterCode: string;
  readonly externalRef: string;
  readonly capability: { readonly actions: Readonly<Partial<Record<PromotionKind, string>>> };
  readonly state: TargetState;
  readonly registeredByRef: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DigitalPromotionRecord {
  readonly id: Id;
  readonly candidateId: Id;
  readonly targetId: Id;
  readonly kind: PromotionKind;
  readonly toolActionId: Id;
  readonly workItemId: Id;
  readonly employeeId: Id;
  readonly args: JsonObject;
  readonly argsSha256: string;
  readonly priorPromotionId: Id | null;
  readonly createdAt: string;
}

const mapProject = (r: Row): DigitalProjectRecord => ({ id: s(r.id) as Id, projectType: s(r.project_type) as DigitalProjectType, title: s(r.title), goalId: os(r.goal_id) as Id | null, state: s(r.state) as DigitalProjectState, workItemId: os(r.work_item_id) as Id | null, createdByRef: s(r.created_by_ref), createdAt: s(r.created_at), updatedAt: s(r.updated_at) });
const mapRevision = (r: Row): DigitalRevisionRecord => ({
  id: s(r.id) as Id, projectId: s(r.project_id) as Id, ordinal: Number(r.ordinal), baseRevisionId: os(r.base_revision_id) as Id | null, state: s(r.state) as DigitalRevisionRecord['state'], workItemId: s(r.work_item_id) as Id,
  createdByRef: s(r.created_by_ref), manifestSha256: os(r.manifest_sha256), fileCount: Number(r.file_count), totalBytes: Number(r.total_bytes), createdAt: s(r.created_at), finalizedAt: os(r.finalized_at),
});
const mapFile = (r: Row): DigitalFileRecord => ({ path: s(r.path), artifactId: s(r.artifact_id) as Id, sha256: s(r.sha256), sizeBytes: Number(r.size_bytes), mediaType: s(r.media_type) });
const mapPreview = (r: Row): DigitalPreviewRecord => ({ id: s(r.id) as Id, revisionId: s(r.revision_id) as Id, manifestSha256: s(r.manifest_sha256), mode: PREVIEW_MODE, state: s(r.state) as DigitalPreviewRecord['state'], entryPath: os(r.entry_path), gapCode: os(r.gap_code), createdByRef: s(r.created_by_ref), createdAt: s(r.created_at) });
const mapCandidate = (r: Row): DigitalCandidateRecord => ({ id: s(r.id) as Id, projectId: s(r.project_id) as Id, revisionId: s(r.revision_id) as Id, manifestSha256: s(r.manifest_sha256), kind: s(r.kind) as CandidateKind, summary: s(r.summary), fingerprint: s(r.fingerprint), workItemId: s(r.work_item_id) as Id, makerEmployeeId: s(r.maker_employee_id) as Id, createdAt: s(r.created_at) });
const mapTarget = (r: Row): DigitalTargetRecord => ({ id: s(r.id) as Id, code: s(r.code), targetClass: s(r.target_class) as TargetClass, adapterCode: s(r.adapter_code), externalRef: s(r.external_ref), capability: JSON.parse(s(r.capability_json)) as DigitalTargetRecord['capability'], state: s(r.state) as TargetState, registeredByRef: s(r.registered_by_ref), createdAt: s(r.created_at), updatedAt: s(r.updated_at) });
const mapPromotion = (r: Row): DigitalPromotionRecord => ({ id: s(r.id) as Id, candidateId: s(r.candidate_id) as Id, targetId: s(r.target_id) as Id, kind: s(r.kind) as PromotionKind, toolActionId: s(r.tool_action_id) as Id, workItemId: s(r.work_item_id) as Id, employeeId: s(r.employee_id) as Id, args: JSON.parse(s(r.args_json)) as JsonObject, argsSha256: s(r.args_sha256), priorPromotionId: os(r.prior_promotion_id) as Id | null, createdAt: s(r.created_at) });

const one = <T>(ctx: StoreContext, sql: string, map: (r: Row) => T, ...params: string[]): T | null => {
  const r = ctx.db.get<Row>(sql, ...params);
  return r ? map(r) : null;
};
const getProject = (ctx: StoreContext, id: string): DigitalProjectRecord => one(ctx, 'SELECT * FROM digital_projects WHERE id = ?', mapProject, assertId(id, 'projectId')) ?? refuse('PROJECT_NOT_FOUND');
const getRevision = (ctx: StoreContext, id: string): DigitalRevisionRecord => one(ctx, 'SELECT * FROM digital_revisions WHERE id = ?', mapRevision, assertId(id, 'revisionId')) ?? refuse('REVISION_NOT_FOUND');
const getCandidate = (ctx: StoreContext, id: string): DigitalCandidateRecord => one(ctx, 'SELECT * FROM digital_release_candidates WHERE id = ?', mapCandidate, assertId(id, 'candidateId')) ?? refuse('CANDIDATE_NOT_FOUND');
const getTarget = (ctx: StoreContext, id: string): DigitalTargetRecord => one(ctx, 'SELECT * FROM digital_promotion_targets WHERE id = ?', mapTarget, assertId(id, 'targetId')) ?? refuse('TARGET_NOT_FOUND');
const getPromotion = (ctx: StoreContext, id: string): DigitalPromotionRecord => one(ctx, 'SELECT * FROM digital_promotions WHERE id = ?', mapPromotion, assertId(id, 'promotionId')) ?? refuse('PROMOTION_NOT_FOUND');
const activeFiles = (ctx: StoreContext, revisionId: string): DigitalFileRecord[] => ctx.db.all<Row>(`SELECT * FROM digital_revision_files WHERE revision_id = ? AND state = 'ACTIVE' ORDER BY path`, revisionId).map(mapFile);

/** A working revision is edited only by runs of the Work Item that opened it (stale or foreign work cannot change it). */
function ownedWorking(ctx: StoreContext, revisionId: string, workItemId: Id): DigitalRevisionRecord {
  const r = getRevision(ctx, revisionId);
  if (r.state !== 'WORKING') refuse('REVISION_NOT_WORKING');
  if (r.workItemId !== workItemId) refuse('REVISION_NOT_OWNED');
  return r;
}

// --- Pre-transaction phase (Artifact Store I/O) -----------------------------------------------------------------

/**
 * What an act needs from the Artifact Store, done BEFORE its transaction (file I/O never runs inside one; the store's own
 * protocol is fenced and crash-safe). An object put here that the act then refuses stays an unreferenced READY artifact —
 * never a mapped file. Reads re-hash content: a missing or corrupt object refuses the act.
 */
export interface DigitalPrepared {
  readonly artifactId?: Id;
  readonly sha256?: string;
  readonly sizeBytes?: number;
  readonly mediaType?: string;
  readonly verified?: boolean;
  readonly slice?: { readonly content: string; readonly encoding: 'utf8' | 'base64'; readonly sha256: string; readonly sizeBytes: number; readonly offset: number; readonly length: number; readonly eof: boolean };
  readonly seo?: SeoReport;
  readonly socialPackageValid?: boolean;
}

const artifactsOf = (store: CompanyStore): ArtifactStore => new ArtifactStore(store);

/** Re-hashes every live file of a revision through the Artifact Store (corruption demotes the object and refuses). */
function verifyRevisionContent(store: CompanyStore, files: readonly DigitalFileRecord[]): void {
  const a = artifactsOf(store);
  for (const f of files) {
    const data = a.read(f.artifactId);
    if (data.byteLength !== f.sizeBytes || sha256Hex(data) !== f.sha256) refuse('ARTIFACT_INTEGRITY');
  }
}

export function prepareDigitalAct(store: CompanyStore, fence: Fence, actionCode: string, args: JsonObject): DigitalPrepared {
  const ctx = storeContext(store);
  const read = <T>(fn: () => T): T => ctx.db.snapshot(fn);
  const a = artifactsOf(store);
  const workItemId = read(() => attributed(ctx, fence).workItemId);
  const put = (bytes: Buffer, mediaType: string, label: string): DigitalPrepared => {
    const rec = a.put({ content: bytes, mediaType, label, workItemId, runId: fence.runId, fence });
    return { artifactId: rec.id, sha256: rec.sha256, sizeBytes: rec.sizeBytes, mediaType };
  };
  switch (actionCode) {
    case 'file-put': {
      const path = assertDigitalPath(args.path);
      const media = digitalMedia(path);
      const enc = s(args.encoding);
      const bytes = enc === 'utf8' ? Buffer.from(s(args.content), 'utf8') : enc === 'base64' ? decodeBase64(s(args.content)) : refuse('ENCODING_UNKNOWN');
      if (bytes.byteLength > DIGITAL_CHUNK_BYTES) refuse('FILE_PUT_TOO_LARGE_USE_UPLOAD');
      if (media.text) assertTextContent(bytes);
      return put(bytes, media.mediaType, 'digital.file');
    }
    case 'upload-chunk': {
      const data = s(args.data);
      if (data.length > DIGITAL_CHUNK_BASE64_MAX) refuse('CHUNK_TOO_LARGE');
      const bytes = decodeBase64(data);
      if (bytes.byteLength === 0 || bytes.byteLength > DIGITAL_CHUNK_BYTES) refuse('CHUNK_SIZE');
      if (sha256Hex(bytes) !== s(args.chunkSha256)) refuse('CHUNK_HASH_MISMATCH');
      return put(bytes, 'application/octet-stream', 'digital.chunk');
    }
    case 'upload-commit': {
      const u = read(() => ctx.db.get<Row>('SELECT * FROM digital_uploads WHERE id = ?', assertId(args.uploadId, 'uploadId'))) ?? refuse('UPLOAD_NOT_FOUND');
      const chunks = read(() => ctx.db.all<Row>('SELECT * FROM digital_upload_chunks WHERE upload_id = ? ORDER BY seq', s(u.id)));
      if (chunks.length !== Number(u.chunk_count)) refuse('UPLOAD_INCOMPLETE');
      const whole = Buffer.concat(chunks.map((c) => a.read(s(c.artifact_id) as Id)));
      if (whole.byteLength !== Number(u.expected_size) || sha256Hex(whole) !== s(u.expected_sha256)) refuse('UPLOAD_HASH_MISMATCH');
      const media = digitalMedia(s(u.path));
      if (media.text) assertTextContent(whole);
      return put(whole, media.mediaType, 'digital.file');
    }
    case 'revision-finalize': {
      const files = read(() => activeFiles(ctx, assertId(args.revisionId, 'revisionId')));
      verifyRevisionContent(store, files);
      return { verified: true };
    }
    case 'file-read': {
      const path = assertDigitalPath(args.path);
      const f = read(() => one(ctx, `SELECT * FROM digital_revision_files WHERE revision_id = ? AND path_key = ? AND state = 'ACTIVE'`, mapFile, assertId(args.revisionId, 'revisionId'), pathKey(path))) ?? refuse('FILE_NOT_FOUND');
      const data = a.read(f.artifactId);
      const offset = args.offset === undefined ? 0 : Number(args.offset);
      const length = Math.min(args.length === undefined ? DIGITAL_READ_MAX : Number(args.length), DIGITAL_READ_MAX);
      const part = data.subarray(offset, offset + length);
      const text = digitalMedia(path).text;
      return { slice: { content: text ? part.toString('utf8') : part.toString('base64'), encoding: text ? 'utf8' : 'base64', sha256: f.sha256, sizeBytes: f.sizeBytes, offset, length: part.byteLength, eof: offset + part.byteLength >= data.byteLength } };
    }
    case 'seo-check': {
      const files = read(() => activeFiles(ctx, assertId(args.revisionId, 'revisionId')));
      const needsText = (f: DigitalFileRecord): boolean => f.mediaType === 'text/html' || f.path === 'sitemap.xml' || f.path === 'robots.txt' || f.path === 'seo/routes.json';
      const input: SeoInputFile[] = files.map((f) => ({ path: f.path, mediaType: f.mediaType, text: needsText(f) ? a.read(f.artifactId).toString('utf8') : null }));
      return { seo: seoReadiness(input) };
    }
    case 'candidate-create': {
      const files = read(() => activeFiles(ctx, assertId(args.revisionId, 'revisionId')));
      verifyRevisionContent(store, files);
      if (assertCandidateKind(args.kind) !== 'SOCIAL_POST') return { verified: true };
      const pkg = files.find((f) => f.path === SOCIAL_PACKAGE_PATH) ?? refuse('SOCIAL_PACKAGE_MISSING');
      parseSocialPackage(a.read(pkg.artifactId).toString('utf8'), files.map((f) => f.path));
      return { verified: true, socialPackageValid: true };
    }
    case 'promotion-prepare': {
      const c = read(() => getCandidate(ctx, s(args.candidateId)));
      verifyRevisionContent(store, read(() => activeFiles(ctx, c.revisionId)));
      return { verified: true };
    }
    default:
      return {};
  }
}

// --- The acts (inside the fenced transaction that also records the tool result) ------------------------------------

export type DigitalActOutcome = { readonly ok: true; readonly result: JsonObject; readonly durable?: JsonObject } | { readonly ok: false; readonly code: string; readonly sent: 'NO' };

interface ActContext {
  readonly ctx: StoreContext;
  readonly fence: Fence;
  readonly employee: { readonly id: Id; readonly ref: string };
  readonly workItemId: Id;
  readonly correlationId: Id;
  readonly at: string;
}

function event(a: ActContext, type: Parameters<typeof appendEvent>[1], payload: Record<string, string | number | boolean | null>): void {
  appendEvent(a.ctx, type, 'work_item', a.workItemId, { correlationId: a.correlationId, actorRef: a.employee.ref }, payload);
}
function audit(a: ActContext, action: string, entityType: string, entityId: string, details: Record<string, string | number | boolean | null>): void {
  appendAudit(a.ctx, action, entityType, entityId, { actorRef: a.employee.ref, correlationId: a.correlationId }, 'OK', null, details);
}

function projectStep(a: ActContext, p: DigitalProjectRecord, to: DigitalProjectState, reason: string): void {
  assertProjectTransition(p.state, to);
  const v = Number(a.ctx.db.get<{ v: number }>('SELECT version AS v FROM digital_projects WHERE id = ?', p.id)?.v);
  a.ctx.db.run('UPDATE digital_projects SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', to, a.at, p.id, v);
  a.ctx.db.run('INSERT INTO digital_project_history (project_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', p.id, v + 1, p.state, to, reason, a.employee.ref, a.at);
  audit(a, `digital.project_${to.toLowerCase()}`, 'digital_project', p.id, { from: p.state, to });
  event(a, 'digital.project_changed', { projectId: p.id, from: p.state, to });
}

function upsertFile(a: ActContext, revisionId: Id, path: string, f: { artifactId: Id; sha256: string; sizeBytes: number; mediaType: string }): void {
  const key = pathKey(path);
  const existing = a.ctx.db.get<Row>('SELECT path FROM digital_revision_files WHERE revision_id = ? AND path_key = ?', revisionId, key);
  if (existing) {
    a.ctx.db.run(`UPDATE digital_revision_files SET path = ?, artifact_id = ?, sha256 = ?, size_bytes = ?, media_type = ?, state = 'ACTIVE', updated_at = ? WHERE revision_id = ? AND path_key = ?`, path, f.artifactId, f.sha256, f.sizeBytes, f.mediaType, a.at, revisionId, key);
  } else {
    if (Number(a.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM digital_revision_files WHERE revision_id = ? AND state = 'ACTIVE'`, revisionId)?.n) >= 2000) refuse('REVISION_TOO_MANY_FILES');
    a.ctx.db.run(`INSERT INTO digital_revision_files (revision_id, path_key, path, artifact_id, sha256, size_bytes, media_type, state, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`, revisionId, key, path, f.artifactId, f.sha256, f.sizeBytes, f.mediaType, a.at);
  }
}

/** The external tool action that serves `kind` for the target's adapter (declared at registration), if active. */
function promotionAction(ctx: StoreContext, t: DigitalTargetRecord, kind: PromotionKind): { id: Id; toolCode: string; actionCode: string } {
  const code = t.capability.actions[kind] ?? refuse('TARGET_DOES_NOT_SUPPORT_KIND');
  const r = ctx.db.get<Row>(
    `SELECT a.id, t.code AS tool_code, a.code FROM tool_actions a JOIN tools t ON t.id = a.tool_id WHERE t.driver_code = ? AND a.code = ? AND a.status = 'ACTIVE' AND t.status = 'ACTIVE' AND a.mutates_external = 1 AND a.risk_level IN ('R3', 'R4')`,
    t.adapterCode, code,
  );
  if (!r) return refuse('ADAPTER_TOOL_NOT_REGISTERED');
  return { id: s(r.id) as Id, toolCode: s(r.tool_code), actionCode: s(r.code) };
}

/** Content-free fields of a provider's confirmed result that the Company keeps as external state (allowlisted keys). */
const EXTERNAL_REF_KEYS = ['repository', 'branch', 'commitSha', 'treeSha', 'pullNumber', 'headSha', 'mergeCommitSha', 'externalId', 'deploymentId', 'version', 'state', 'apiVersion', 'replayed'] as const;
export function externalRefOf(resultJson: string | null): Record<string, string | number | boolean> | null {
  if (resultJson === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const k of EXTERNAL_REF_KEYS) {
    const v = (parsed as Record<string, unknown>)[k];
    if ((typeof v === 'string' && v.length <= 200 && /^[A-Za-z0-9._:/#@+-]*$/.test(v)) || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export interface PromotionView extends DigitalPromotionRecord {
  readonly state: PromotionState;
  readonly reviewRequestId: Id | null;
  readonly approvalId: Id | null;
  readonly invocationId: Id | null;
  readonly externalRef: Record<string, string | number | boolean> | null;
  /** Always false: provider confirmation is not traffic, ranking, conversion or market fit (C7-A owns real outcomes). */
  readonly countsAsMarketOutcome: false;
}

/**
 * The derived lifecycle of one promotion, read from the canonical rows that own each fact, matched by the exact act
 * (Work Item, tool action, argument hash; for the review, the approval fingerprint of that act).
 */
export function txPromotionView(ctx: StoreContext, p: DigitalPromotionRecord): PromotionView {
  const action = ctx.db.get<{ code: string; tool_code: string; risk: string; cost: number }>('SELECT a.code, t.code AS tool_code, a.risk_level AS risk, a.cost_per_call_micros AS cost FROM tool_actions a JOIN tools t ON t.id = a.tool_id WHERE a.id = ?', p.toolActionId);
  const resourceRef = `tool_action:${p.toolActionId}`;
  const inv = ctx.db.get<Row>('SELECT id, state, result_json FROM tool_invocations WHERE tool_action_id = ? AND work_item_id = ? AND args_sha256 = ? ORDER BY created_at DESC, id DESC LIMIT 1', p.toolActionId, p.workItemId, p.argsSha256);
  const appr = ctx.db.get<Row>('SELECT id, state FROM approvals WHERE work_item_id = ? AND resource_ref = ? AND args_sha256 = ? ORDER BY created_at DESC, id DESC LIMIT 1', p.workItemId, resourceRef, p.argsSha256);
  const fingerprints = action === undefined ? [] : (['D0', 'D1', 'D2'] as const).map((dataClass) => approvalFingerprint({ subjectRef: `employee:${p.employeeId}`, action: toolCapability(action.tool_code, action.code), resourceRef, workItemId: p.workItemId, argsSha256: p.argsSha256, dataClass, risk: action.risk as 'R3', limits: { maxCostMicros: Number(action.cost) } }));
  const review = ctx.db.get<Row>('SELECT id, state FROM review_requests WHERE work_item_id = ? AND subject_ref = ? AND subject_fingerprint IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC, id DESC LIMIT 1', p.workItemId, resourceRef, JSON.stringify(fingerprints));
  const reviewState = review === undefined ? 'NONE' : ({ OPEN: 'OPEN', CONFLICT: 'OPEN', ESCALATED: 'ESCALATED', SATISFIED: 'SATISFIED', CONSUMED: 'SATISFIED', REWORK: 'REWORK', STALE: 'STALE', CANCELLED: 'STALE' } as const)[s(review.state) as 'OPEN'] ?? 'NONE';
  const c = getCandidate(ctx, p.candidateId);
  const facts: PromotionFacts = {
    candidateIntact: candidateIntact(ctx, c),
    review: reviewState,
    approval: appr === undefined ? 'NONE' : (s(appr.state) as PromotionFacts['approval']),
    invocation: inv === undefined ? 'NONE' : (s(inv.state) as PromotionFacts['invocation']),
  };
  return { ...p, state: promotionState(facts), reviewRequestId: os(review?.id) as Id | null, approvalId: os(appr?.id) as Id | null, invocationId: os(inv?.id) as Id | null, externalRef: inv !== undefined && s(inv.state) === 'SUCCEEDED' ? externalRefOf(os(inv.result_json)) : null, countsAsMarketOutcome: false };
}

/** Cheap structural integrity (DB): every file of the candidate's revision still maps to a READY object with its hash. */
function candidateIntact(ctx: StoreContext, c: DigitalCandidateRecord): boolean {
  const bad = ctx.db.get(
    `SELECT 1 AS x FROM digital_revision_files f LEFT JOIN artifacts a ON a.id = f.artifact_id WHERE f.revision_id = ? AND f.state = 'ACTIVE' AND (a.id IS NULL OR a.state <> 'READY' OR a.sha256 <> f.sha256) LIMIT 1`,
    c.revisionId,
  );
  const rev = ctx.db.get<{ m: string | null; st: string }>('SELECT manifest_sha256 AS m, state AS st FROM digital_revisions WHERE id = ?', c.revisionId);
  return bad === undefined && rev?.st === 'FINALIZED' && rev.m === c.manifestSha256 && manifestOf(ctx, c.revisionId) === c.manifestSha256;
}

const manifestOf = (ctx: StoreContext, revisionId: string): string => digitalManifestSha256(activeFiles(ctx, revisionId).map((f) => ({ path: f.path, sha256: f.sha256, sizeBytes: f.sizeBytes, mediaType: f.mediaType })));

/**
 * Applies one internal digital act inside the caller's fenced transaction. Refusals are typed codes (the caller records
 * them as the tool's NOT-EXECUTED result); a savepoint guarantees a refused act leaves nothing behind.
 */
export function txDigitalAct(ctx: StoreContext, fence: Fence, actionCode: string, args: JsonObject, prepared: DigitalPrepared): DigitalActOutcome {
  const att = attributed(ctx, fence);
  const e = getEmployeeRow(ctx, att.employeeId);
  const item = getWorkItemRow(ctx, att.workItemId);
  const a: ActContext = { ctx, fence, employee: { id: e.id, ref: e.ref }, workItemId: item.id, correlationId: item.correlationId, at: ts(ctx) };
  try {
    return ctx.db.savepoint('digital act', () => act(a, actionCode, args, prepared));
  } catch (error) {
    const code = digitalRefusalCode(error);
    if (code === null) throw error;
    return { ok: false, code, sent: 'NO' };
  }
}

function act(a: ActContext, actionCode: string, args: JsonObject, prepared: DigitalPrepared): DigitalActOutcome {
  const { ctx } = a;
  switch (actionCode) {
    case 'project-create': {
      const projectType = assertProjectType(args.projectType);
      const title = assertCompanyText(args.title, 'title', 160);
      const goalId = optString(args.goalId);
      if (goalId !== undefined) {
        const g = ctx.db.get<{ state: string }>('SELECT state FROM goals WHERE id = ?', assertId(goalId, 'goalId'));
        if (!g || !['APPROVED', 'ACTIVE'].includes(g.state)) refuse('GOAL_NOT_LIVE');
      }
      const prior = one(ctx, 'SELECT * FROM digital_projects WHERE work_item_id = ? AND title = ?', mapProject, a.workItemId, title);
      if (prior) return { ok: true, result: { projectId: prior.id, state: prior.state, existing: true } };
      const id = newId();
      ctx.db.run(`INSERT INTO digital_projects (id, project_type, title, goal_id, state, work_item_id, created_by_ref, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, 1, ?, ?)`, id, projectType, title, goalId ?? null, a.workItemId, a.employee.ref, a.at, a.at);
      ctx.db.run(`INSERT INTO digital_project_history (project_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, 'DRAFT', 'digital.project_created', ?, ?)`, id, a.employee.ref, a.at);
      audit(a, 'digital.project_created', 'digital_project', id, { projectType, goalId: goalId ?? null });
      event(a, 'digital.project_changed', { projectId: id, from: null, to: 'DRAFT' });
      return { ok: true, result: { projectId: id, state: 'DRAFT' } };
    }
    case 'project-activate':
    case 'project-archive': {
      const p = getProject(ctx, s(args.projectId));
      const to: DigitalProjectState = actionCode === 'project-activate' ? 'ACTIVE' : 'ARCHIVED';
      if (p.state === to) return { ok: true, result: { projectId: p.id, state: to } };
      projectStep(a, p, to, `digital.${actionCode}`);
      return { ok: true, result: { projectId: p.id, state: to } };
    }
    case 'revision-open': {
      const p = getProject(ctx, s(args.projectId));
      if (p.state === 'ARCHIVED') refuse('PROJECT_ARCHIVED');
      const baseId = optString(args.baseRevisionId);
      const base = baseId === undefined ? null : getRevision(ctx, baseId);
      if (base !== null && (base.projectId !== p.id || base.state !== 'FINALIZED')) refuse('BASE_REVISION_NOT_FINALIZED');
      const ordinal = Number(ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(ordinal), 0) AS n FROM digital_revisions WHERE project_id = ?', p.id)?.n) + 1;
      const id = newId();
      ctx.db.run(`INSERT INTO digital_revisions (id, project_id, ordinal, base_revision_id, state, work_item_id, created_by_ref, created_at, updated_at) VALUES (?, ?, ?, ?, 'WORKING', ?, ?, ?, ?)`, id, p.id, ordinal, base?.id ?? null, a.workItemId, a.employee.ref, a.at, a.at);
      if (base !== null) {
        ctx.db.run(
          `INSERT INTO digital_revision_files (revision_id, path_key, path, artifact_id, sha256, size_bytes, media_type, state, updated_at)
           SELECT ?, path_key, path, artifact_id, sha256, size_bytes, media_type, 'ACTIVE', ? FROM digital_revision_files WHERE revision_id = ? AND state = 'ACTIVE'`,
          id, a.at, base.id,
        );
      }
      audit(a, 'digital.revision_opened', 'digital_revision', id, { projectId: p.id, ordinal, baseRevisionId: base?.id ?? null });
      return { ok: true, result: { revisionId: id, projectId: p.id, ordinal, fileCount: base?.fileCount ?? 0 } };
    }
    case 'file-put': {
      const r = ownedWorking(ctx, s(args.revisionId), a.workItemId);
      const path = assertDigitalPath(args.path);
      if (prepared.artifactId === undefined) return refuse('CONTENT_NOT_STORED');
      upsertFile(a, r.id, path, { artifactId: prepared.artifactId, sha256: prepared.sha256 as string, sizeBytes: prepared.sizeBytes as number, mediaType: prepared.mediaType as string });
      return { ok: true, result: { revisionId: r.id, path, sha256: prepared.sha256 as string, sizeBytes: prepared.sizeBytes as number } };
    }
    case 'upload-begin': {
      const r = ownedWorking(ctx, s(args.revisionId), a.workItemId);
      const path = assertDigitalPath(args.path);
      const media = digitalMedia(path);
      const size = Number(args.sizeBytes);
      const sha = s(args.sha256);
      if (!Number.isSafeInteger(size) || size < 1 || size > DIGITAL_MAX_FILE_BYTES) refuse('UPLOAD_SIZE');
      if (!isSha256Hex(sha)) refuse('UPLOAD_HASH_INVALID');
      const chunkCount = Math.ceil(size / DIGITAL_CHUNK_BYTES);
      const open = ctx.db.get<Row>(`SELECT * FROM digital_uploads WHERE revision_id = ? AND path_key = ? AND state = 'OPEN'`, r.id, pathKey(path));
      if (open) {
        if (Number(open.expected_size) === size && s(open.expected_sha256) === sha) return { ok: true, result: { uploadId: s(open.id), chunkCount, chunkBytes: DIGITAL_CHUNK_BYTES } };
        refuse('UPLOAD_ALREADY_OPEN');
      }
      const id = newId();
      ctx.db.run(`INSERT INTO digital_uploads (id, revision_id, path_key, path, media_type, expected_size, expected_sha256, chunk_count, state, work_item_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`, id, r.id, pathKey(path), path, media.mediaType, size, sha, chunkCount, a.workItemId, a.at, a.at);
      return { ok: true, result: { uploadId: id, chunkCount, chunkBytes: DIGITAL_CHUNK_BYTES } };
    }
    case 'upload-chunk': {
      const u = ctx.db.get<Row>('SELECT * FROM digital_uploads WHERE id = ?', assertId(args.uploadId, 'uploadId')) ?? refuse('UPLOAD_NOT_FOUND');
      if (s(u.state) !== 'OPEN') refuse('UPLOAD_NOT_OPEN');
      if (s(u.work_item_id) !== a.workItemId) refuse('REVISION_NOT_OWNED');
      const seq = Number(args.seq);
      const count = Number(u.chunk_count);
      if (!Number.isSafeInteger(seq) || seq < 0 || seq >= count) refuse('CHUNK_OUT_OF_RANGE');
      const expected = seq < count - 1 ? DIGITAL_CHUNK_BYTES : Number(u.expected_size) - DIGITAL_CHUNK_BYTES * (count - 1);
      if (prepared.sizeBytes !== expected) refuse('CHUNK_SIZE');
      const prior = ctx.db.get<Row>('SELECT sha256 FROM digital_upload_chunks WHERE upload_id = ? AND seq = ?', s(u.id), seq);
      if (prior) {
        if (s(prior.sha256) !== prepared.sha256) refuse('CHUNK_CONFLICT');
      } else {
        ctx.db.run('INSERT INTO digital_upload_chunks (upload_id, seq, artifact_id, sha256, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)', s(u.id), seq, prepared.artifactId as string, prepared.sha256 as string, prepared.sizeBytes as number, a.at);
      }
      const received = Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM digital_upload_chunks WHERE upload_id = ?', s(u.id))?.n);
      return { ok: true, result: { uploadId: s(u.id), seq, received, chunkCount: count } };
    }
    case 'upload-commit': {
      const u = ctx.db.get<Row>('SELECT * FROM digital_uploads WHERE id = ?', assertId(args.uploadId, 'uploadId')) ?? refuse('UPLOAD_NOT_FOUND');
      if (s(u.state) !== 'OPEN') refuse('UPLOAD_NOT_OPEN');
      const r = ownedWorking(ctx, s(u.revision_id), a.workItemId);
      if (prepared.artifactId === undefined || prepared.sha256 !== s(u.expected_sha256)) refuse('UPLOAD_HASH_MISMATCH');
      ctx.db.run(`UPDATE digital_uploads SET state = 'COMMITTED', artifact_id = ?, updated_at = ? WHERE id = ?`, prepared.artifactId as string, a.at, s(u.id));
      upsertFile(a, r.id, s(u.path), { artifactId: prepared.artifactId as Id, sha256: prepared.sha256 as string, sizeBytes: prepared.sizeBytes as number, mediaType: s(u.media_type) });
      return { ok: true, result: { revisionId: r.id, path: s(u.path), sha256: prepared.sha256 as string, sizeBytes: prepared.sizeBytes as number } };
    }
    case 'file-remove': {
      const r = ownedWorking(ctx, s(args.revisionId), a.workItemId);
      const path = assertDigitalPath(args.path);
      const changed = ctx.db.run(`UPDATE digital_revision_files SET state = 'REMOVED', updated_at = ? WHERE revision_id = ? AND path_key = ? AND state = 'ACTIVE'`, a.at, r.id, pathKey(path)).changes;
      if (changed !== 1) refuse('FILE_NOT_FOUND');
      return { ok: true, result: { revisionId: r.id, path, removed: true } };
    }
    case 'revision-finalize': {
      const r = ownedWorking(ctx, s(args.revisionId), a.workItemId);
      if (prepared.verified !== true) refuse('CONTENT_NOT_VERIFIED');
      const files = activeFiles(ctx, r.id);
      const entries: DigitalManifestEntry[] = files.map((f) => ({ path: f.path, sha256: f.sha256, sizeBytes: f.sizeBytes, mediaType: f.mediaType }));
      assertManifestBounds(entries);
      const manifest = digitalManifestSha256(entries);
      const total = entries.reduce((n, x) => n + x.sizeBytes, 0);
      ctx.db.run(`UPDATE digital_revisions SET state = 'FINALIZED', manifest_sha256 = ?, file_count = ?, total_bytes = ?, finalized_at = ?, updated_at = ? WHERE id = ? AND state = 'WORKING'`, manifest, entries.length, total, a.at, a.at, r.id);
      ctx.db.run(`UPDATE digital_uploads SET state = 'ABANDONED', updated_at = ? WHERE revision_id = ? AND state = 'OPEN'`, a.at, r.id);
      audit(a, 'digital.revision_finalized', 'digital_revision', r.id, { projectId: r.projectId, manifestSha256: manifest, files: entries.length });
      event(a, 'digital.revision_finalized', { revisionId: r.id, projectId: r.projectId, manifestSha256: manifest, files: entries.length });
      return { ok: true, result: { revisionId: r.id, manifestSha256: manifest, fileCount: entries.length, totalBytes: total } };
    }
    case 'revision-inspect': {
      const r = getRevision(ctx, s(args.revisionId));
      const offset = args.offset === undefined ? 0 : Number(args.offset);
      const files = activeFiles(ctx, r.id);
      const page = files.slice(offset, offset + 8).map((f) => ({ path: f.path, sha256: f.sha256, sizeBytes: f.sizeBytes, mediaType: f.mediaType }));
      return { ok: true, result: { revisionId: r.id, state: r.state, manifestSha256: r.manifestSha256, fileCount: files.length, offset, files: page, more: offset + page.length < files.length } };
    }
    case 'file-read': {
      const sl = prepared.slice ?? refuse('FILE_NOT_FOUND');
      // The run sees the slice; the durable tool record keeps only its digest (file content is never copied into SQLite
      // tool history — the Artifact Store holds it).
      return { ok: true, result: { revisionId: s(args.revisionId), path: s(args.path), ...sl }, durable: { revisionId: s(args.revisionId), path: s(args.path), sha256: sl.sha256, offset: sl.offset, length: sl.length } };
    }
    case 'preview-create': {
      const r = getRevision(ctx, s(args.revisionId));
      if (r.state !== 'FINALIZED') refuse('REVISION_NOT_FINALIZED');
      const existing = one(ctx, 'SELECT * FROM digital_previews WHERE revision_id = ?', mapPreview, r.id);
      if (existing) return { ok: true, result: { previewId: existing.id, state: existing.state, gapCode: existing.gapCode, mode: PREVIEW_MODE } };
      const files = activeFiles(ctx, r.id);
      const p = previewability(files.map((f) => f.path));
      const id = newId();
      ctx.db.run(
        'INSERT INTO digital_previews (id, revision_id, manifest_sha256, mode, state, entry_path, gap_code, work_item_id, created_by_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, r.id, r.manifestSha256 as string, PREVIEW_MODE, p.state, p.state === 'READY' ? p.entry : null, p.state === 'CAPABILITY_GAP' ? p.code : null, a.workItemId, a.employee.ref, a.at,
      );
      audit(a, 'digital.preview_created', 'digital_preview', id, { revisionId: r.id, state: p.state, gapCode: p.state === 'CAPABILITY_GAP' ? p.code : null });
      event(a, 'digital.preview_created', { previewId: id, revisionId: r.id, state: p.state });
      return { ok: true, result: { previewId: id, state: p.state, gapCode: p.state === 'CAPABILITY_GAP' ? p.code : null, mode: PREVIEW_MODE } };
    }
    case 'seo-check': {
      const r = getRevision(ctx, s(args.revisionId));
      const report = prepared.seo ?? refuse('SEO_NOT_RUN');
      return { ok: true, result: { revisionId: r.id, manifestSha256: r.manifestSha256, pagesChecked: report.pagesChecked, basis: report.basis, searchPerformance: report.searchPerformance, bySeverity: { ...report.bySeverity }, findings: report.findings.slice(0, 12).map((f) => ({ ...f })), more: report.findings.length > 12 } };
    }
    case 'candidate-create': {
      const r = getRevision(ctx, s(args.revisionId));
      if (r.state !== 'FINALIZED') refuse('REVISION_NOT_FINALIZED');
      const kind = assertCandidateKind(args.kind);
      if (prepared.verified !== true || (kind === 'SOCIAL_POST' && prepared.socialPackageValid !== true)) refuse('CONTENT_NOT_VERIFIED');
      const summary = assertCompanyText(args.summary, 'summary', 500);
      const existing = one(ctx, 'SELECT * FROM digital_release_candidates WHERE revision_id = ? AND kind = ?', mapCandidate, r.id, kind);
      if (existing) return { ok: true, result: { candidateId: existing.id, manifestSha256: existing.manifestSha256, fingerprint: existing.fingerprint, existing: true } };
      const id = newId();
      const fingerprint = candidateFingerprint({ candidateId: id, revisionId: r.id, manifestSha256: r.manifestSha256 as string, kind });
      ctx.db.run(
        'INSERT INTO digital_release_candidates (id, project_id, revision_id, manifest_sha256, kind, summary, fingerprint, work_item_id, maker_employee_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, r.projectId, r.id, r.manifestSha256 as string, kind, summary, fingerprint, a.workItemId, a.employee.id, a.at,
      );
      audit(a, 'digital.candidate_created', 'digital_candidate', id, { revisionId: r.id, manifestSha256: r.manifestSha256, kind });
      event(a, 'digital.candidate_created', { candidateId: id, revisionId: r.id, manifestSha256: r.manifestSha256, kind });
      return { ok: true, result: { candidateId: id, manifestSha256: r.manifestSha256 as string, fingerprint } };
    }
    case 'promotion-prepare':
      return preparePromotion(a, args, prepared);
    case 'promotion-inspect': {
      const v = txPromotionView(ctx, getPromotion(ctx, s(args.promotionId)));
      return { ok: true, result: { promotionId: v.id, kind: v.kind, state: v.state, externalRef: v.externalRef, countsAsMarketOutcome: false } };
    }
    default:
      return refuse('UNKNOWN_DIGITAL_ACTION');
  }
}

/**
 * `promotion-prepare`: binds candidate × kind × target to the EXACT external arguments and tool action, or refuses.
 * Idempotent while the same act lives; a refused act (Founder rejection, review rework) never regenerates for the same
 * candidate, target and kind — a changed candidate is the way forward. Nothing external happens here.
 */
function preparePromotion(a: ActContext, args: JsonObject, prepared: DigitalPrepared): DigitalActOutcome {
  const { ctx } = a;
  const c = getCandidate(ctx, s(args.candidateId));
  if (prepared.verified !== true || !candidateIntact(ctx, c)) refuse('CANDIDATE_NOT_INTACT');
  const t = getTarget(ctx, s(args.targetId));
  if (t.state !== 'ACTIVE') refuse('TARGET_NOT_ACTIVE');
  const kind = assertPromotionKind(args.kind);
  assertPromotionFits(kind, t.targetClass, c.kind);
  const tool = promotionAction(ctx, t, kind);
  const siblings = ctx.db.all<Row>('SELECT * FROM digital_promotions WHERE candidate_id = ? AND target_id = ? AND kind = ? ORDER BY created_at, id', c.id, t.id, kind).map(mapPromotion).map((p) => txPromotionView(ctx, p));
  if (siblings.some((v) => isRefusedPromotion(v.state))) refuse('PROMOTION_REFUSED_BEFORE');
  let prior: Id | null = null;
  let extra: { pullNumber?: number; expectedHeadSha?: string; notBefore?: string; notAfter?: string; expectedCurrentRef?: string; rollbackToRef?: string } = {};
  if (kind === 'MERGE_PRODUCTION') {
    // The merge binds the head the Company itself exported and the provider confirmed — never a head named by the run.
    const exported = ctx.db.all<Row>(`SELECT * FROM digital_promotions WHERE candidate_id = ? AND target_id = ? AND kind = 'EXPORT_SOURCE' ORDER BY created_at DESC, id DESC`, c.id, t.id).map(mapPromotion).map((p) => txPromotionView(ctx, p)).find((v) => v.state === 'PROMOTED');
    const ref = exported?.externalRef;
    if (!exported || typeof ref?.pullNumber !== 'number' || typeof ref.commitSha !== 'string') refuse('NO_CONFIRMED_EXPORT');
    prior = (exported as PromotionView).id;
    extra = { pullNumber: ref?.pullNumber as number, expectedHeadSha: ref?.commitSha as string };
  } else if (kind === 'SOCIAL_PUBLISH') {
    extra = { notBefore: optString(args.notBefore) ?? '', notAfter: optString(args.notAfter) ?? '' };
    if ((extra.notAfter ?? '') <= a.at) refuse('SCHEDULE_WINDOW_PASSED');
  } else if (kind === 'ROLLBACK_PRODUCTION') {
    extra = { expectedCurrentRef: optString(args.expectedCurrentRef) ?? '', rollbackToRef: optString(args.rollbackToRef) ?? '' };
  }
  // One live act per candidate × target × kind: the same terms again are idempotent; other terms (another window, another
  // head) are never silently swapped for the live act's — they wait for it to be decided, or come as a new candidate.
  const live = siblings.find((v) => !['STALE', 'FAILED'].includes(v.state));
  if (live) {
    const same = canonicalJson(promotionArgs({ kind, promotionId: live.id, candidateId: c.id, manifestSha256: c.manifestSha256, targetId: t.id, ...extra })) === canonicalJson(live.args);
    if (!same) refuse('PROMOTION_LIVE_WITH_OTHER_TERMS');
    return { ok: true, result: { promotionId: live.id, tool: tool.toolCode, action: tool.actionCode, args: live.args, risk: 'R3', state: live.state, existing: true } };
  }
  const promotionId = newId();
  const exact = promotionArgs({ kind, promotionId, candidateId: c.id, manifestSha256: c.manifestSha256, targetId: t.id, ...extra });
  const argsSha256 = sha256Hex(canonicalJson(exact));
  ctx.db.run(
    'INSERT INTO digital_promotions (id, candidate_id, target_id, kind, tool_action_id, work_item_id, employee_id, args_json, args_sha256, prior_promotion_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    promotionId, c.id, t.id, kind, tool.id, a.workItemId, a.employee.id, canonicalJson(exact), argsSha256, prior, a.at,
  );
  audit(a, 'digital.promotion_prepared', 'digital_promotion', promotionId, { candidateId: c.id, targetId: t.id, kind, toolActionId: tool.id, argsSha256 });
  event(a, 'digital.promotion_prepared', { promotionId, candidateId: c.id, targetId: t.id, kind });
  return { ok: true, result: { promotionId, tool: tool.toolCode, action: tool.actionCode, args: exact, risk: 'R3', state: 'PREPARED', next: 'call exactly this tool action with exactly these arguments; it needs independent review and the Founder\'s approval' } };
}

// --- Export source for promotion drivers (read-only) --------------------------------------------------------------

export interface PromotionExportFile {
  readonly path: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly content: Buffer;
}

export interface PromotionExport {
  readonly promotionId: Id;
  readonly kind: PromotionKind;
  readonly candidateId: Id;
  readonly manifestSha256: string;
  readonly target: { readonly id: Id; readonly targetClass: TargetClass; readonly adapterCode: string; readonly externalRef: string };
  readonly files: readonly PromotionExportFile[];
}

export type PromotionExportResult = { readonly ok: true; readonly export: PromotionExport } | { readonly ok: false; readonly code: string };

/**
 * What a promotion driver may publish — resolved and RE-VERIFIED at execution time from the exact arguments the
 * approval bound: the promotion exists with exactly these arguments (hash), it is served by this adapter, its target
 * is active, the candidate's revision is finalized and its manifest recomputes to the bound hash, and every object
 * re-hashes. Anything else refuses (the driver then sends nothing). Content is read here, never carried in arguments.
 */
export function resolvePromotionExport(store: CompanyStore, adapterCode: string, args: JsonObject, options: { includeContent: boolean } = { includeContent: true }): PromotionExportResult {
  const ctx = storeContext(store);
  try {
    const meta = ctx.db.snapshot(() => {
      const p = getPromotion(ctx, s(args.promotionId));
      if (p.argsSha256 !== sha256Hex(canonicalJson(args)) || canonicalJson(p.args) !== canonicalJson(args)) refuse('PROMOTION_ARGS_MISMATCH');
      const t = getTarget(ctx, p.targetId);
      if (t.adapterCode !== adapterCode) refuse('ADAPTER_MISMATCH');
      if (t.state !== 'ACTIVE') refuse('TARGET_NOT_ACTIVE');
      const c = getCandidate(ctx, p.candidateId);
      if (c.manifestSha256 !== s(args.manifestSha256) || !candidateIntact(ctx, c)) refuse('CANDIDATE_HASH_MISMATCH');
      return { p, t, c, files: activeFiles(ctx, c.revisionId) };
    });
    const art = artifactsOf(store);
    const files = meta.files.map((f) => {
      const content = options.includeContent ? art.read(f.artifactId) : Buffer.alloc(0);
      if (options.includeContent && sha256Hex(content) !== f.sha256) refuse('ARTIFACT_INTEGRITY');
      return { path: f.path, mediaType: f.mediaType, sha256: f.sha256, content };
    });
    return { ok: true, export: { promotionId: meta.p.id, kind: meta.p.kind, candidateId: meta.c.id, manifestSha256: meta.c.manifestSha256, target: { id: meta.t.id, targetClass: meta.t.targetClass, adapterCode: meta.t.adapterCode, externalRef: meta.t.externalRef }, files } };
  } catch (error) {
    const code = digitalRefusalCode(error);
    if (code === null) throw error;
    return { ok: false, code };
  }
}

/** One registered target of this adapter (driver provider-state reads), or null. */
export function resolvePromotionTarget(store: CompanyStore, adapterCode: string, targetId: string): { id: Id; targetClass: TargetClass; externalRef: string; state: string } | null {
  const ctx = storeContext(store);
  return ctx.db.snapshot(() => {
    const r = /^[0-9a-f-]{36}$/.test(targetId) ? one(ctx, 'SELECT * FROM digital_promotion_targets WHERE id = ? AND adapter_code = ?', mapTarget, targetId, adapterCode) : null;
    return r === null ? null : { id: r.id, targetClass: r.targetClass, externalRef: r.externalRef, state: r.state };
  });
}

/** The exact arguments a prepared promotion bound (reconciliation reads), or null. */
export function promotionArgsOf(store: CompanyStore, promotionId: string): JsonObject | null {
  const ctx = storeContext(store);
  return ctx.db.snapshot(() => (/^[0-9a-f-]{36}$/.test(promotionId) ? (one(ctx, 'SELECT * FROM digital_promotions WHERE id = ?', mapPromotion, promotionId)?.args ?? null) : null));
}

// --- Read model / Founder administration -------------------------------------------------------------------------

export interface PreviewResolution {
  readonly previewId: Id;
  readonly revisionId: Id;
  readonly manifestSha256: string;
  readonly entryPath: string;
  readonly files: ReadonlyMap<string, DigitalFileRecord>;
}

export interface DigitalDecisionView {
  readonly promotionId: Id;
  readonly kind: PromotionKind;
  readonly candidateId: Id;
  readonly candidateSummary: string;
  readonly manifestSha256: string;
  readonly targetCode: string;
  readonly targetClass: TargetClass;
  readonly externalRef: string;
  readonly review: string;
  readonly risk: 'R3';
}

/** The digital promotion an R3 tool approval decides, if any (enriches the Founder's governed APPROVAL_DECIDE preview). */
export function txDigitalDecisionView(ctx: StoreContext, approvalId: Id): DigitalDecisionView | null {
  const ap = ctx.db.get<{ work_item_id: string | null; resource_ref: string; args_sha256: string }>('SELECT work_item_id, resource_ref, args_sha256 FROM approvals WHERE id = ?', approvalId);
  if (!ap || ap.work_item_id === null || !ap.resource_ref.startsWith('tool_action:')) return null;
  const r = ctx.db.get<Row>('SELECT * FROM digital_promotions WHERE work_item_id = ? AND tool_action_id = ? AND args_sha256 = ?', ap.work_item_id, ap.resource_ref.slice('tool_action:'.length), ap.args_sha256);
  if (!r) return null;
  const v = txPromotionView(ctx, mapPromotion(r));
  const c = getCandidate(ctx, v.candidateId);
  const t = getTarget(ctx, v.targetId);
  return { promotionId: v.id, kind: v.kind, candidateId: c.id, candidateSummary: c.summary, manifestSha256: c.manifestSha256, targetCode: t.code, targetClass: t.targetClass, externalRef: t.externalRef, review: v.reviewRequestId === null ? 'NONE' : s(ctx.db.get<{ s: string }>('SELECT state AS s FROM review_requests WHERE id = ?', v.reviewRequestId)?.s), risk: 'R3' };
}

export interface RegisterTargetInput {
  readonly code: string;
  readonly targetClass: TargetClass;
  readonly adapterCode: string;
  readonly externalRef: string;
  /** Promotion kind → the adapter's action code for it (from the adapter's validated declaration). */
  readonly actions: Readonly<Partial<Record<PromotionKind, string>>>;
}

export class DigitalStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): DigitalStore {
    return new DigitalStore(store);
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  /**
   * Registers a promotion target (Founder only, through the authenticated Founder chokepoint). It stores an allowlisted
   * provider identifier and the adapter's action map — never a URL, a token or a password (credentials stay `vault:`
   * references on the adapter's Tool record).
   */
  registerTarget(actorRef: string, input: RegisterTargetInput): DigitalTargetRecord {
    return founderAdminWrite(this.#store, 'register digital target', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'digital target registration');
      const actions: Record<string, string> = {};
      for (const [k, v] of Object.entries(input.actions)) {
        assertPromotionKind(k);
        if (typeof v !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(v)) refuse('TARGET_ACTION_INVALID');
        actions[k] = v;
      }
      const id = newId();
      const at = ts(ctx);
      ctx.db.run(
        `INSERT INTO digital_promotion_targets (id, code, target_class, adapter_code, external_ref, capability_json, state, registered_by_ref, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 1, ?, ?)`,
        id, input.code, input.targetClass, input.adapterCode, input.externalRef, canonicalJson({ actions }), p.ref, at, at,
      );
      appendAudit(ctx, 'digital.target_registered', 'digital_target', id, { actorRef: p.ref }, 'OK', null, { targetClass: input.targetClass, adapterCode: input.adapterCode });
      return getTarget(ctx, id);
    });
  }

  /** Suspends, re-activates or retires a target (Founder only; a retired target is history). */
  setTargetState(actorRef: string, targetId: string, to: TargetState): DigitalTargetRecord {
    return founderAdminWrite(this.#store, 'set digital target state', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'digital target state');
      const t = getTarget(ctx, targetId);
      if (t.state === to) return t;
      const v = Number(ctx.db.get<{ v: number }>('SELECT version AS v FROM digital_promotion_targets WHERE id = ?', t.id)?.v);
      ctx.db.run('UPDATE digital_promotion_targets SET state = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', to, ts(ctx), t.id, v);
      appendAudit(ctx, 'digital.target_state', 'digital_target', t.id, { actorRef: p.ref }, 'OK', null, { from: t.state, to });
      return getTarget(ctx, t.id);
    });
  }

  targets(): DigitalTargetRecord[] {
    return this.#read((ctx) => ctx.db.all<Row>('SELECT * FROM digital_promotion_targets ORDER BY created_at, id').map(mapTarget));
  }

  projects(): (DigitalProjectRecord & { revisions: number; latestFinalizedRevisionId: Id | null; candidates: number; pilotId: Id | null })[] {
    return this.#read((ctx) =>
      ctx.db.all<Row>('SELECT * FROM digital_projects ORDER BY created_at DESC, id LIMIT 500').map(mapProject).map((p) => ({
        ...p,
        revisions: Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM digital_revisions WHERE project_id = ?', p.id)?.n),
        latestFinalizedRevisionId: (ctx.db.get<{ id: string }>(`SELECT id FROM digital_revisions WHERE project_id = ? AND state = 'FINALIZED' ORDER BY ordinal DESC LIMIT 1`, p.id)?.id ?? null) as Id | null,
        candidates: Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM digital_release_candidates WHERE project_id = ?', p.id)?.n),
        pilotId: pilotOf(ctx, p.goalId),
      })),
    );
  }

  /** One project for the Founder: revisions, previews, candidates and their promotions with the derived lifecycle. */
  project(id: string): {
    project: DigitalProjectRecord;
    pilotId: Id | null;
    revisions: DigitalRevisionRecord[];
    previews: DigitalPreviewRecord[];
    candidates: (DigitalCandidateRecord & { intact: boolean; promotions: (PromotionView & { target: { code: string; targetClass: TargetClass; externalRef: string } })[] })[];
  } {
    return this.#read((ctx) => {
      const project = getProject(ctx, id);
      const revisions = ctx.db.all<Row>('SELECT * FROM digital_revisions WHERE project_id = ? ORDER BY ordinal DESC', project.id).map(mapRevision);
      const previews = ctx.db.all<Row>('SELECT p.* FROM digital_previews p JOIN digital_revisions r ON r.id = p.revision_id WHERE r.project_id = ? ORDER BY p.created_at DESC', project.id).map(mapPreview);
      const candidates = ctx.db.all<Row>('SELECT * FROM digital_release_candidates WHERE project_id = ? ORDER BY created_at DESC, id', project.id).map(mapCandidate).map((c) => ({
        ...c,
        intact: candidateIntact(ctx, c),
        promotions: ctx.db.all<Row>('SELECT * FROM digital_promotions WHERE candidate_id = ? ORDER BY created_at, id', c.id).map(mapPromotion).map((p) => {
          const t = getTarget(ctx, p.targetId);
          return { ...txPromotionView(ctx, p), target: { code: t.code, targetClass: t.targetClass, externalRef: t.externalRef } };
        }),
      }));
      return { project, pilotId: pilotOf(ctx, project.goalId), revisions, previews, candidates };
    });
  }

  revisionFiles(revisionId: string): DigitalFileRecord[] {
    return this.#read((ctx) => activeFiles(ctx, getRevision(ctx, revisionId).id));
  }

  promotion(id: string): PromotionView {
    return this.#read((ctx) => txPromotionView(ctx, getPromotion(ctx, id)));
  }

  /** Promotions awaiting the Founder's exact decision (decision-ready, codes and short Company labels only). */
  decisions(): (DigitalDecisionView & { approvalId: Id })[] {
    return this.#read((ctx) =>
      ctx.db
        .all<Row>('SELECT * FROM digital_promotions ORDER BY created_at, id LIMIT 2000')
        .map(mapPromotion)
        .map((p) => txPromotionView(ctx, p))
        .filter((v) => v.state === 'READY_FOR_FOUNDER' && v.approvalId !== null)
        .map((v) => ({ ...(txDigitalDecisionView(ctx, v.approvalId as Id) as DigitalDecisionView), approvalId: v.approvalId as Id })),
    );
  }

  /**
   * The internal Preview's exact file map (for the isolated preview listener): the preview exists and is READY, its
   * revision is FINALIZED, and the live file map recomputes to the bound manifest hash — otherwise it refuses whole.
   */
  previewResolution(previewId: string): PreviewResolution {
    return this.#read((ctx) => {
      const p = one(ctx, 'SELECT * FROM digital_previews WHERE id = ?', mapPreview, assertId(previewId, 'previewId')) ?? refuse('PREVIEW_NOT_FOUND');
      if (p.state !== 'READY' || p.entryPath === null) refuse(p.gapCode ?? 'PREVIEW_NOT_READY');
      const r = getRevision(ctx, p.revisionId);
      if (r.state !== 'FINALIZED' || r.manifestSha256 !== p.manifestSha256 || manifestOf(ctx, r.id) !== p.manifestSha256) refuse('PREVIEW_MANIFEST_MISMATCH');
      // A missing or corrupt object anywhere in the revision refuses the whole preview (never a partial site).
      if (ctx.db.get(`SELECT 1 AS x FROM digital_revision_files f LEFT JOIN artifacts a ON a.id = f.artifact_id WHERE f.revision_id = ? AND f.state = 'ACTIVE' AND (a.id IS NULL OR a.state <> 'READY' OR a.sha256 <> f.sha256) LIMIT 1`, r.id)) refuse('PREVIEW_CONTENT_INTEGRITY');
      return { previewId: p.id, revisionId: r.id, manifestSha256: p.manifestSha256, entryPath: p.entryPath as string, files: new Map(activeFiles(ctx, r.id).map((f) => [f.path, f])) };
    });
  }

  /**
   * Digital evidence inside a set of Work Items (the C7-C Pilot lens): counts and states only. Publication is a confirmed
   * provider act, never market success — it never counts as an outcome (C7-A real evidence does).
   */
  evidenceForWorkItems(workItemIds: readonly string[]): { revisionsFinalized: number; previews: number; candidates: number; promotions: Record<PromotionState, number>; publicationIsMarketSuccess: false; countsAsOutcome: false } {
    return this.#read((ctx) => {
      const ids = JSON.stringify([...new Set(workItemIds)]);
      const n = (sql: string): number => Number(ctx.db.get<{ n: number }>(sql, ids)?.n ?? 0);
      const promotions = Object.fromEntries(['PREPARED', 'UNDER_REVIEW', 'REVIEW_REJECTED', 'READY_FOR_FOUNDER', 'REJECTED', 'APPROVED', 'EXECUTING', 'PROMOTED', 'FAILED', 'RECONCILIATION_REQUIRED', 'STALE'].map((k) => [k, 0])) as Record<PromotionState, number>;
      for (const p of ctx.db.all<Row>('SELECT * FROM digital_promotions WHERE work_item_id IN (SELECT value FROM json_each(?))', ids).map(mapPromotion)) promotions[txPromotionView(ctx, p).state]++;
      return {
        revisionsFinalized: n(`SELECT COUNT(*) AS n FROM digital_revisions WHERE state = 'FINALIZED' AND work_item_id IN (SELECT value FROM json_each(?))`),
        previews: n('SELECT COUNT(*) AS n FROM digital_previews WHERE work_item_id IN (SELECT value FROM json_each(?))'),
        candidates: n('SELECT COUNT(*) AS n FROM digital_release_candidates WHERE work_item_id IN (SELECT value FROM json_each(?))'),
        promotions,
        publicationIsMarketSuccess: false,
        countsAsOutcome: false,
      };
    });
  }

  /**
   * The exact publication windows prepared promotions bound (for the existing Company Calendar projection — there is no
   * second scheduler; a window is executed by an ordinary Work Item within it, and the driver refuses outside it).
   */
  publicationWindows(from: string, to: string): { promotionId: Id; kind: PromotionKind; notBefore: string; notAfter: string; state: PromotionState }[] {
    return this.#read((ctx) =>
      ctx.db
        .all<Row>(`SELECT * FROM digital_promotions WHERE kind = 'SOCIAL_PUBLISH' AND json_extract(args_json, '$.notAfter') >= ? AND json_extract(args_json, '$.notBefore') < ? ORDER BY json_extract(args_json, '$.notBefore'), id LIMIT 500`, from, to)
        .map(mapPromotion)
        .map((p) => ({ promotionId: p.id, kind: p.kind, notBefore: s(p.args.notBefore), notAfter: s(p.args.notAfter), state: txPromotionView(ctx, p).state })),
    );
  }

  /** Content-free counts. */
  health(): { projects: number; revisions: number; finalized: number; previews: number; candidates: number; targets: number; promotions: number } {
    return this.#read((ctx) => {
      const n = (sql: string): number => Number(ctx.db.get<{ n: number }>(sql)?.n ?? 0);
      return {
        projects: n('SELECT COUNT(*) AS n FROM digital_projects'),
        revisions: n('SELECT COUNT(*) AS n FROM digital_revisions'),
        finalized: n(`SELECT COUNT(*) AS n FROM digital_revisions WHERE state = 'FINALIZED'`),
        previews: n('SELECT COUNT(*) AS n FROM digital_previews'),
        candidates: n('SELECT COUNT(*) AS n FROM digital_release_candidates'),
        targets: n('SELECT COUNT(*) AS n FROM digital_promotion_targets'),
        promotions: n('SELECT COUNT(*) AS n FROM digital_promotions'),
      };
    });
  }
}

/** The C7-C Pilot whose root Goal is this project's Goal or one of its ancestors (a reference, never a copy). */
function pilotOf(ctx: StoreContext, goalId: Id | null): Id | null {
  let g: string | null = goalId;
  for (let i = 0; g !== null && i < 8; i++) {
    const pilot = ctx.db.get<{ id: string }>('SELECT id FROM pilots WHERE root_goal_id = ?', g);
    if (pilot) return pilot.id as Id;
    g = ctx.db.get<{ p: string | null }>('SELECT parent_goal_id AS p FROM goals WHERE id = ?', g)?.p ?? null;
  }
  return null;
}

/** True when the internal driver code names the Company-native workshop (handled inside the Tool Executor). */
export const isDigitalWorkspaceDriver = (driverCode: string): boolean => driverCode === DIGITAL_WORKSPACE_DRIVER;
