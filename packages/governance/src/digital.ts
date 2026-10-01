/**
 * C7-D Digital Presence kernel (pure, deterministic, no I/O): the contracts of the Company's internal Digital Workshop
 * and of its governed external promotion.
 *
 * C7-D builds CAPABILITY, never the QANDEEL website: nothing here names a framework, hosting provider, CMS, analytics,
 * SEO vendor or social platform as chosen — the Company researches and recommends those during a real Pilot.
 *
 *   Digital Project (a long-lived context, never a task engine; Work stays in C1 / C5)
 *   → working revision (logical paths → READY Artifact Store objects; file content never in SQLite)
 *   → FINALIZED revision (immutable; deterministic manifest hash)
 *   → internal Preview (exact revision, isolated origin; not publication, not proof)
 *   → Release Candidate (binds one exact finalized revision + its manifest hash; immutable)
 *   → Promotion (candidate × exact external action × typed target; prepared internally, then executed ONLY as an R3 tool
 *     action through the existing Tool Executor: Review Pool review → Founder approval → idempotent driver → durable
 *     result or reconciliation)
 *
 * Approval is action- and target-specific by construction: the promotion's exact external arguments carry the candidate
 * id and manifest hash, so the existing approval fingerprint binds exactly that content, that target and that action.
 * Publication is never market success: real outcomes enter only through governed C7-A evidence.
 */
import { QandeelError, canonicalJson, sha256Hex, type JsonObject, type RiskLevel, type SideEffectClass } from '@qandeel-company/domain';

import { assertCatalogCode } from './classes.js';

const refuse = (reason: string, field?: string): never => {
  throw new QandeelError('DIGITAL_REFUSED', `digital contract refused: ${reason}`, field === undefined ? { reason } : { reason, field });
};

/** Publication confirms only that a provider accepted an exact action — never traffic, ranking, conversion or fit. */
export const PUBLICATION_IS_NOT_MARKET_SUCCESS = true as const;

/** The closed, Company-native internal authoring Tool (seeded by migration 0015; reserved driver code). */
export const DIGITAL_WORKSPACE_TOOL = 'digital-workspace';
export const DIGITAL_WORKSPACE_DRIVER = 'company.digital-workspace';
export const DIGITAL_WORKSPACE_ACTIONS = [
  'project-create', 'project-activate', 'project-archive', 'revision-open', 'file-put', 'upload-begin', 'upload-chunk', 'upload-commit', 'file-remove',
  'revision-finalize', 'revision-inspect', 'file-read', 'preview-create', 'seo-check', 'candidate-create', 'promotion-prepare', 'promotion-inspect',
] as const;
export type DigitalWorkspaceAction = (typeof DIGITAL_WORKSPACE_ACTIONS)[number];
export const isDigitalWorkspaceAction = (v: unknown): v is DigitalWorkspaceAction => typeof v === 'string' && (DIGITAL_WORKSPACE_ACTIONS as readonly string[]).includes(v);

// --- Digital Project ------------------------------------------------------------------------------------------------

export const DIGITAL_PROJECT_TYPES = ['WEBSITE', 'LANDING_PAGES', 'CONTENT_PROGRAM', 'LAUNCH_CONTENT', 'SOCIAL_PROGRAM'] as const;
export type DigitalProjectType = (typeof DIGITAL_PROJECT_TYPES)[number];
export const DIGITAL_PROJECT_STATES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type DigitalProjectState = (typeof DIGITAL_PROJECT_STATES)[number];

const PROJECT_TRANSITIONS: Readonly<Record<DigitalProjectState, readonly DigitalProjectState[]>> = { DRAFT: ['ACTIVE', 'ARCHIVED'], ACTIVE: ['ARCHIVED'], ARCHIVED: [] };

export function assertProjectType(v: unknown): DigitalProjectType {
  return (DIGITAL_PROJECT_TYPES as readonly unknown[]).includes(v) ? (v as DigitalProjectType) : refuse('PROJECT_TYPE_UNKNOWN', 'projectType');
}

/** Forward only; an archived project is history and never revives. */
export function assertProjectTransition(from: DigitalProjectState, to: DigitalProjectState): void {
  if (!PROJECT_TRANSITIONS[from].includes(to)) refuse('PROJECT_TRANSITION', 'state');
}

// --- Logical paths ---------------------------------------------------------------------------------------------------

export const DIGITAL_PATH_MAX = 200;
export const DIGITAL_MAX_FILES = 2000;
export const DIGITAL_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const DIGITAL_MAX_REVISION_BYTES = 64 * 1024 * 1024;
/** One authoring chunk (decoded bytes). Tool arguments are bounded (8 KiB JSON), so larger files arrive in chunks. */
export const DIGITAL_CHUNK_BYTES = 4096;
export const DIGITAL_MAX_CHUNKS = DIGITAL_MAX_FILE_BYTES / DIGITAL_CHUNK_BYTES;
/** Longest base64 text a chunk argument may carry (4 096 bytes → 5 464 characters). */
export const DIGITAL_CHUNK_BASE64_MAX = Math.ceil(DIGITAL_CHUNK_BYTES / 3) * 4;
/** One read slice returned to a run's context (its JSON stays inside the 2 048-character recent-result bound). */
export const DIGITAL_READ_MAX = 1024;

const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;
const FORBIDDEN_SEGMENT = /^(?:node_modules|\.git|\.svn|\.hg|\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.docker|\.vscode|\.idea|\$recycle\.bin|system volume information)$/i;
const CREDENTIAL_FILE = /^(?:\.env(?:\..*)?|\.npmrc|\.yarnrc(?:\.yml)?|\.netrc|\.pgpass|\.git-credentials|\.gitconfig|\.htpasswd|\.dockercfg|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p8|p12|pfx|jks|keystore|kdbx|ovpn|crt|cer|der))$/i;
// Characters that have no place in a portable logical path (Windows-reserved, separators other than '/', controls).
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001f\u007f\\:*?"<>|]/;

/**
 * Validates one logical project path. A logical path is a name inside one Digital Project — never a host path: it is
 * never joined to the filesystem (content lives in the content-addressed Artifact Store). Refused: absolute paths, drive
 * letters, traversal, empty / dot segments, Windows device names and trailing dots or spaces, NUL / control / reserved
 * characters, credential files (`.env*`, keys, certificates…), dependency folders, VCS / OS / tool folders. The result is
 * NFC-normalized; collisions are detected case-insensitively (Windows file systems are).
 */
export function assertDigitalPath(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > DIGITAL_PATH_MAX) return refuse('PATH_INVALID', 'path');
  const path = v.normalize('NFC');
  if (path !== v) return refuse('PATH_NOT_NORMALIZED', 'path');
  if (BAD_CHARS.test(path)) return refuse('PATH_CHARACTERS', 'path');
  if (path.startsWith('/') || path.startsWith('~') || /^[A-Za-z]:/.test(path)) return refuse('PATH_ABSOLUTE', 'path');
  const segments = path.split('/');
  for (const seg of segments) {
    if (seg.length === 0 || seg === '.' || seg === '..') return refuse('PATH_TRAVERSAL', 'path');
    if (seg.length > 100 || /[. ]$/.test(seg) || seg.startsWith(' ')) return refuse('PATH_SEGMENT', 'path');
    if (WINDOWS_DEVICE.test(seg)) return refuse('PATH_DEVICE', 'path');
    if (FORBIDDEN_SEGMENT.test(seg)) return refuse('PATH_FORBIDDEN_FOLDER', 'path');
  }
  if (segments.length > 12) return refuse('PATH_TOO_DEEP', 'path');
  if (CREDENTIAL_FILE.test(segments[segments.length - 1] as string)) return refuse('PATH_CREDENTIAL_FILE', 'path');
  return path;
}

/** The collision key of a logical path (case-insensitive, as on Windows). */
export const pathKey = (path: string): string => path.toLowerCase();

// --- Media --------------------------------------------------------------------------------------------------------------

/** STATIC files may be served by the internal Preview; SOURCE files are stored and exported but never executed or served. */
export type DigitalFileKind = 'STATIC' | 'SOURCE';

const MEDIA: Readonly<Record<string, { readonly type: string; readonly kind: DigitalFileKind; readonly text: boolean }>> = {
  html: { type: 'text/html', kind: 'STATIC', text: true },
  htm: { type: 'text/html', kind: 'STATIC', text: true },
  css: { type: 'text/css', kind: 'STATIC', text: true },
  js: { type: 'text/javascript', kind: 'STATIC', text: true },
  mjs: { type: 'text/javascript', kind: 'STATIC', text: true },
  json: { type: 'application/json', kind: 'STATIC', text: true },
  webmanifest: { type: 'application/manifest+json', kind: 'STATIC', text: true },
  map: { type: 'application/json', kind: 'STATIC', text: true },
  svg: { type: 'image/svg+xml', kind: 'STATIC', text: true },
  xml: { type: 'application/xml', kind: 'STATIC', text: true },
  txt: { type: 'text/plain', kind: 'STATIC', text: true },
  md: { type: 'text/markdown', kind: 'STATIC', text: true },
  csv: { type: 'text/csv', kind: 'STATIC', text: true },
  png: { type: 'image/png', kind: 'STATIC', text: false },
  jpg: { type: 'image/jpeg', kind: 'STATIC', text: false },
  jpeg: { type: 'image/jpeg', kind: 'STATIC', text: false },
  gif: { type: 'image/gif', kind: 'STATIC', text: false },
  webp: { type: 'image/webp', kind: 'STATIC', text: false },
  avif: { type: 'image/avif', kind: 'STATIC', text: false },
  ico: { type: 'image/x-icon', kind: 'STATIC', text: false },
  woff: { type: 'font/woff', kind: 'STATIC', text: false },
  woff2: { type: 'font/woff2', kind: 'STATIC', text: false },
  ttf: { type: 'font/ttf', kind: 'STATIC', text: false },
  otf: { type: 'font/otf', kind: 'STATIC', text: false },
  mp4: { type: 'video/mp4', kind: 'STATIC', text: false },
  webm: { type: 'video/webm', kind: 'STATIC', text: false },
  // Source the Company may write for a future, Company-chosen stack: stored, reviewed and exported, never served.
  ts: { type: 'text/plain', kind: 'SOURCE', text: true },
  tsx: { type: 'text/plain', kind: 'SOURCE', text: true },
  jsx: { type: 'text/plain', kind: 'SOURCE', text: true },
  vue: { type: 'text/plain', kind: 'SOURCE', text: true },
  svelte: { type: 'text/plain', kind: 'SOURCE', text: true },
  astro: { type: 'text/plain', kind: 'SOURCE', text: true },
  scss: { type: 'text/plain', kind: 'SOURCE', text: true },
  less: { type: 'text/plain', kind: 'SOURCE', text: true },
  yaml: { type: 'text/plain', kind: 'SOURCE', text: true },
  yml: { type: 'text/plain', kind: 'SOURCE', text: true },
  toml: { type: 'text/plain', kind: 'SOURCE', text: true },
  mdx: { type: 'text/plain', kind: 'SOURCE', text: true },
};
const BARE_SOURCE = /^(?:license|readme|changelog|robots\.txt|_headers|_redirects|\.gitignore|\.editorconfig|\.nvmrc)$/i;

export interface DigitalMedia {
  readonly mediaType: string;
  readonly kind: DigitalFileKind;
  readonly text: boolean;
}

/** The media contract of a logical path (by its extension), or a refusal: unknown types are never stored. */
export function digitalMedia(path: string): DigitalMedia {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (BARE_SOURCE.test(name)) return name.toLowerCase() === 'robots.txt' ? { mediaType: 'text/plain', kind: 'STATIC', text: true } : { mediaType: 'text/plain', kind: 'SOURCE', text: true };
  const dot = name.lastIndexOf('.');
  const m = dot > 0 ? MEDIA[name.slice(dot + 1).toLowerCase()] : undefined;
  if (m === undefined) return refuse('MEDIA_TYPE_UNSUPPORTED', 'path');
  return { mediaType: m.type, kind: m.kind, text: m.text };
}

// --- Revisions and manifests ------------------------------------------------------------------------------------------

export const DIGITAL_REVISION_STATES = ['WORKING', 'FINALIZED', 'ABANDONED'] as const;
export type DigitalRevisionState = (typeof DIGITAL_REVISION_STATES)[number];

export interface DigitalManifestEntry {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mediaType: string;
}

/**
 * The deterministic manifest hash of a revision: entries sorted by path (code-point order), canonical JSON, SHA-256.
 * Changing one byte (the object hash) or one path yields a different hash — so a different candidate.
 */
export function digitalManifestSha256(entries: readonly DigitalManifestEntry[]): string {
  const files = [...entries].map((e) => ({ path: e.path, sha256: e.sha256, sizeBytes: e.sizeBytes, mediaType: e.mediaType })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256Hex(canonicalJson({ v: 1, files }));
}

/** The bounds a finalized revision must satisfy (count, total size, unique case-insensitive paths). */
export function assertManifestBounds(entries: readonly DigitalManifestEntry[]): void {
  if (entries.length === 0) refuse('REVISION_EMPTY');
  if (entries.length > DIGITAL_MAX_FILES) refuse('REVISION_TOO_MANY_FILES');
  if (entries.reduce((n, e) => n + e.sizeBytes, 0) > DIGITAL_MAX_REVISION_BYTES) refuse('REVISION_TOO_LARGE');
  const keys = new Set(entries.map((e) => pathKey(e.path)));
  if (keys.size !== entries.length) refuse('PATH_COLLISION');
}

// --- Internal Preview -------------------------------------------------------------------------------------------------

/** A Preview is Company-internal only: there is no other mode (an external preview is a governed promotion). */
export const PREVIEW_MODE = 'INTERNAL' as const;
export const PREVIEW_ENTRY = 'index.html';

export type Previewability = { readonly state: 'READY'; readonly entry: string } | { readonly state: 'CAPABILITY_GAP'; readonly code: 'PREVIEW_REQUIRES_BUILD' | 'PREVIEW_NO_STATIC_ENTRY' };

/**
 * Whether a finalized revision can be inspected by the safe static renderer. Nothing is ever built or executed on the
 * Company host to make a preview work: a revision that needs a build step (a package manifest without a static entry)
 * or has no static entry is a surfaced capability gap, not a reason to add command execution.
 */
export function previewability(paths: readonly string[]): Previewability {
  if (paths.includes(PREVIEW_ENTRY) && digitalMedia(PREVIEW_ENTRY).kind === 'STATIC') return { state: 'READY', entry: PREVIEW_ENTRY };
  if (paths.some((p) => p === 'package.json' || /\.(?:tsx?|jsx|vue|svelte|astro)$/i.test(p))) return { state: 'CAPABILITY_GAP', code: 'PREVIEW_REQUIRES_BUILD' };
  return { state: 'CAPABILITY_GAP', code: 'PREVIEW_NO_STATIC_ENTRY' };
}

// --- Release Candidates ---------------------------------------------------------------------------------------------

export const CANDIDATE_KINDS = ['WEBSITE', 'CONTENT_PACKAGE', 'SOCIAL_POST'] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

export function assertCandidateKind(v: unknown): CandidateKind {
  return (CANDIDATE_KINDS as readonly unknown[]).includes(v) ? (v as CandidateKind) : refuse('CANDIDATE_KIND_UNKNOWN', 'kind');
}

/** The candidate's identity fingerprint: exactly one revision and its manifest hash. */
export function candidateFingerprint(c: { candidateId: string; revisionId: string; manifestSha256: string; kind: CandidateKind }): string {
  return sha256Hex(canonicalJson({ v: 1, ...c }));
}

// --- Promotion targets and actions ----------------------------------------------------------------------------------

export const TARGET_CLASSES = ['CODE_REPOSITORY', 'WEBSITE_PRODUCTION', 'WEBSITE_PREVIEW_EXTERNAL', 'CMS', 'SOCIAL_CHANNEL', 'SEARCH_PROPERTY'] as const;
export type TargetClass = (typeof TARGET_CLASSES)[number];
export const TARGET_STATES = ['ACTIVE', 'SUSPENDED', 'RETIRED'] as const;
export type TargetState = (typeof TARGET_STATES)[number];

export function assertTargetClass(v: unknown): TargetClass {
  return (TARGET_CLASSES as readonly unknown[]).includes(v) ? (v as TargetClass) : refuse('TARGET_CLASS_UNKNOWN', 'targetClass');
}

/**
 * Promotion kinds — each its OWN external action, so one approval can never authorize another: exporting source is not
 * merging to production, an external preview is not production, a rollback is a new governed act. There is no comment,
 * reply, DM or paid-spend kind (separate Product authority).
 */
export const PROMOTION_KINDS = ['EXPORT_SOURCE', 'MERGE_PRODUCTION', 'PREVIEW_EXTERNAL', 'PUBLISH_PRODUCTION', 'ROLLBACK_PRODUCTION', 'SOCIAL_PUBLISH'] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

const KIND_TARGETS: Readonly<Record<PromotionKind, readonly TargetClass[]>> = {
  EXPORT_SOURCE: ['CODE_REPOSITORY'],
  MERGE_PRODUCTION: ['CODE_REPOSITORY'],
  PREVIEW_EXTERNAL: ['WEBSITE_PREVIEW_EXTERNAL'],
  PUBLISH_PRODUCTION: ['WEBSITE_PRODUCTION', 'CMS'],
  ROLLBACK_PRODUCTION: ['WEBSITE_PRODUCTION', 'CMS'],
  SOCIAL_PUBLISH: ['SOCIAL_CHANNEL'],
};
const KIND_CANDIDATES: Readonly<Record<PromotionKind, readonly CandidateKind[]>> = {
  EXPORT_SOURCE: ['WEBSITE', 'CONTENT_PACKAGE'],
  MERGE_PRODUCTION: ['WEBSITE', 'CONTENT_PACKAGE'],
  PREVIEW_EXTERNAL: ['WEBSITE'],
  PUBLISH_PRODUCTION: ['WEBSITE', 'CONTENT_PACKAGE'],
  ROLLBACK_PRODUCTION: ['WEBSITE', 'CONTENT_PACKAGE'],
  SOCIAL_PUBLISH: ['SOCIAL_POST'],
};

export function assertPromotionKind(v: unknown): PromotionKind {
  return (PROMOTION_KINDS as readonly unknown[]).includes(v) ? (v as PromotionKind) : refuse('PROMOTION_KIND_UNKNOWN', 'kind');
}

/** The target class and candidate kind a promotion kind may combine with (refused otherwise). */
export function assertPromotionFits(kind: PromotionKind, targetClass: TargetClass, candidateKind: CandidateKind): void {
  if (!KIND_TARGETS[kind].includes(targetClass)) refuse('TARGET_CLASS_MISMATCH', 'targetId');
  if (!KIND_CANDIDATES[kind].includes(candidateKind)) refuse('CANDIDATE_KIND_MISMATCH', 'candidateId');
}

/** Every promotion is an external publication / mutation under the QANDEEL name: R3 (Founder approval in Strong-v1). */
export const PROMOTION_RISK: RiskLevel = 'R3';

/** The deterministic candidate branch of an export (never a protected or default branch; created, never forced). */
export const exportBranch = (candidateId: string, promotionId: string): string => `qandeel/candidate-${candidateId.slice(0, 8)}-${promotionId.slice(0, 8)}`;

/** The provenance trailers every exported commit carries (how reconciliation recognizes the Company's own effect). */
export function exportCommitMessage(p: { candidateId: string; manifestSha256: string; promotionId: string }): string {
  return `QANDEEL digital candidate ${p.candidateId}\n\nQandeel-Candidate: ${p.candidateId}\nQandeel-Manifest: ${p.manifestSha256}\nQandeel-Promotion: ${p.promotionId}\n`;
}

export interface PromotionArgsInput {
  readonly kind: PromotionKind;
  readonly promotionId: string;
  readonly candidateId: string;
  readonly manifestSha256: string;
  readonly targetId: string;
  readonly pullNumber?: number;
  readonly expectedHeadSha?: string;
  readonly notBefore?: string;
  readonly notAfter?: string;
  readonly expectedCurrentRef?: string;
  readonly rollbackToRef?: string;
}

/**
 * The EXACT external tool arguments of one promotion (string / integer fields only, as every tool argument schema). The
 * candidate id and manifest hash are always present, so the approval fingerprint (which binds the argument hash) binds
 * the exact content; production kinds also bind the expected external state (head / current version).
 */
export function promotionArgs(p: PromotionArgsInput): JsonObject {
  const base = { promotionId: p.promotionId, candidateId: p.candidateId, manifestSha256: p.manifestSha256, targetId: p.targetId };
  switch (p.kind) {
    case 'EXPORT_SOURCE':
      return { ...base, branch: exportBranch(p.candidateId, p.promotionId) };
    case 'MERGE_PRODUCTION':
      if (!Number.isSafeInteger(p.pullNumber) || (p.pullNumber as number) < 1 || !/^[0-9a-f]{40}$/.test(p.expectedHeadSha ?? '')) return refuse('MERGE_NEEDS_EXPORTED_HEAD');
      return { ...base, pullNumber: p.pullNumber as number, expectedHeadSha: p.expectedHeadSha as string };
    case 'SOCIAL_PUBLISH':
      if (!isWindowTs(p.notBefore) || !isWindowTs(p.notAfter) || (p.notAfter as string) <= (p.notBefore as string)) return refuse('SCHEDULE_WINDOW_INVALID');
      return { ...base, notBefore: p.notBefore as string, notAfter: p.notAfter as string };
    case 'ROLLBACK_PRODUCTION':
      if (!isRef(p.expectedCurrentRef) || !isRef(p.rollbackToRef)) return refuse('ROLLBACK_NEEDS_EXACT_VERSIONS');
      return { ...base, expectedCurrentRef: p.expectedCurrentRef as string, rollbackToRef: p.rollbackToRef as string };
    case 'PREVIEW_EXTERNAL':
    case 'PUBLISH_PRODUCTION':
      return base;
  }
}

const isWindowTs = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && !Number.isNaN(Date.parse(v));
const isRef = (v: unknown): boolean => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v);

// --- Provider adapter declarations ---------------------------------------------------------------------------------

/** Words no adapter capability, action or permission may carry: administration, protection bypass, secrets, membership, billing, destruction. */
export const FORBIDDEN_ADAPTER_CAPABILITY = /(?:^|[._:-])(?:admin|administration|branch-protection|protection|bypass|secret|secrets|collaborators?|members?|membership|org-admin|billing|delete|destroy|force|deploy-keys?|webhooks?|hooks|workflows?|actions-variables|environments|keys)(?:$|[._:-])/i;
/** No community interaction (comments / replies / DMs) and no paid spend in C7-D: separate Product authority. */
const INTERACTION_OR_SPEND = /(?:^|[._-])(?:comments?|reply|replies|dms?|direct-message|messages?|inbox|ads?|campaign-spend|spend|boost|sponsor)(?:$|[._-])/i;

export const ADAPTER_PROVIDER_KINDS = ['CODE_HOST', 'HOSTING', 'CMS', 'SOCIAL', 'SEARCH'] as const;
export type AdapterProviderKind = (typeof ADAPTER_PROVIDER_KINDS)[number];

export interface AdapterActionDeclaration {
  readonly actionCode: string;
  /** A promotion kind, or a provider-state read / reconciliation read (no external mutation). */
  readonly kind: PromotionKind | 'READ_STATE' | 'RECONCILE';
  readonly risk: RiskLevel;
  readonly sideEffects: SideEffectClass;
  readonly mutatesExternal: boolean;
}

export interface PromotionAdapterDeclaration {
  readonly adapterCode: string;
  readonly providerKind: AdapterProviderKind;
  /** The exact provider API version the adapter speaks (pinned; never "latest"). */
  readonly apiVersion: string;
  /** Instant after which the pinned version must no longer be used (fail closed), if the provider announced one. */
  readonly apiSunsetAt: string | null;
  readonly targetClasses: readonly TargetClass[];
  readonly actions: readonly AdapterActionDeclaration[];
  /** The minimum provider permissions the adapter needs — requested exactly, never broadened at run time. */
  readonly requiredPermissions: Readonly<Record<string, 'read' | 'write'>>;
}

/**
 * Validates an adapter's declared capability (fail closed). External mutations are R3+ UNSAFE EXTERNAL actions; a
 * hosting / CMS adapter declares preview, production publish, rollback and state read as DISTINCT actions (never one
 * collapsed action); nothing names administration, protection bypass, secrets, membership, billing or destruction;
 * nothing implements comments, replies, DMs or paid spend.
 */
export function assertAdapterDeclaration(d: PromotionAdapterDeclaration): PromotionAdapterDeclaration {
  assertCatalogCode(d.adapterCode, 'adapterCode');
  if (!(ADAPTER_PROVIDER_KINDS as readonly string[]).includes(d.providerKind)) refuse('ADAPTER_KIND_UNKNOWN');
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(d.apiVersion) || /latest/i.test(d.apiVersion)) refuse('ADAPTER_VERSION_NOT_PINNED');
  if (d.apiSunsetAt !== null && !isWindowTs(d.apiSunsetAt)) refuse('ADAPTER_SUNSET_INVALID');
  if (d.targetClasses.length === 0) refuse('ADAPTER_NO_TARGET');
  for (const t of d.targetClasses) assertTargetClass(t);
  for (const [perm, level] of Object.entries(d.requiredPermissions)) {
    if (FORBIDDEN_ADAPTER_CAPABILITY.test(perm) || (level !== 'read' && level !== 'write')) refuse('ADAPTER_PERMISSION_FORBIDDEN');
  }
  const codes = new Set<string>();
  for (const a of d.actions) {
    assertCatalogCode(a.actionCode, 'actionCode');
    if (codes.has(a.actionCode)) refuse('ADAPTER_ACTION_DUPLICATE');
    codes.add(a.actionCode);
    if (FORBIDDEN_ADAPTER_CAPABILITY.test(a.actionCode) || INTERACTION_OR_SPEND.test(a.actionCode)) refuse('ADAPTER_ACTION_FORBIDDEN');
    if (a.kind === 'READ_STATE' || a.kind === 'RECONCILE') {
      if (a.mutatesExternal || a.sideEffects !== 'NONE') refuse('ADAPTER_READ_MUTATES');
    } else {
      assertPromotionKind(a.kind);
      if (!a.mutatesExternal || a.sideEffects !== 'UNSAFE' || (a.risk !== 'R3' && a.risk !== 'R4')) refuse('ADAPTER_MUTATION_NOT_GOVERNED');
      if (!KIND_TARGETS[a.kind].some((t) => d.targetClasses.includes(t))) refuse('ADAPTER_KIND_TARGET_MISMATCH');
    }
  }
  const kinds = d.actions.map((a) => a.kind);
  if (kinds.filter((k) => k !== 'READ_STATE' && k !== 'RECONCILE').length !== new Set(kinds.filter((k) => k !== 'READ_STATE' && k !== 'RECONCILE')).size) refuse('ADAPTER_KIND_DUPLICATE');
  if (d.providerKind === 'HOSTING' || d.providerKind === 'CMS') {
    for (const needed of ['PUBLISH_PRODUCTION', 'ROLLBACK_PRODUCTION', 'READ_STATE'] as const) if (!kinds.includes(needed)) refuse('HOSTING_ACTIONS_INCOMPLETE');
    if (d.targetClasses.includes('WEBSITE_PREVIEW_EXTERNAL') && !kinds.includes('PREVIEW_EXTERNAL')) refuse('HOSTING_ACTIONS_INCOMPLETE');
  }
  return d;
}

/** Whether the adapter's pinned API version may still be used at `at` (an announced sunset fails closed). */
export function adapterVersionUsable(d: Pick<PromotionAdapterDeclaration, 'apiSunsetAt'>, at: string): boolean {
  return d.apiSunsetAt === null || at < d.apiSunsetAt;
}

// --- Social publication contract (provider-neutral; no provider is selected in C7-D) -------------------------------

export const SOCIAL_CONTENT_TYPES = ['TEXT', 'LINK', 'IMAGE', 'MULTI_IMAGE', 'VIDEO'] as const;
export type SocialContentType = (typeof SOCIAL_CONTENT_TYPES)[number];

export interface SocialAdapterDeclaration extends PromotionAdapterDeclaration {
  readonly providerKind: 'SOCIAL';
  readonly contentTypes: readonly SocialContentType[];
  /** Account / page roles the provider requires of the posting identity (e.g. an organization page administrator role). */
  readonly accountRoles: readonly string[];
  readonly editSemantics: 'EDITABLE' | 'IMMUTABLE' | 'DELETE_AND_REPOST';
  readonly deleteSemantics: 'DELETABLE' | 'NOT_SUPPORTED';
  /** Whether the provider accepts a post asynchronously (e.g. container → publish) — the driver then confirms, never assumes. */
  readonly asyncPublish: boolean;
  readonly rateLimit: { readonly maxPublishes: number; readonly perSeconds: number };
}

export function assertSocialDeclaration(d: SocialAdapterDeclaration): SocialAdapterDeclaration {
  assertAdapterDeclaration(d);
  if (d.providerKind !== 'SOCIAL' || !d.targetClasses.includes('SOCIAL_CHANNEL')) refuse('SOCIAL_DECLARATION_KIND');
  if (d.contentTypes.length === 0 || !d.contentTypes.every((t) => (SOCIAL_CONTENT_TYPES as readonly string[]).includes(t))) refuse('SOCIAL_CONTENT_TYPES');
  if (!['EDITABLE', 'IMMUTABLE', 'DELETE_AND_REPOST'].includes(d.editSemantics) || !['DELETABLE', 'NOT_SUPPORTED'].includes(d.deleteSemantics)) refuse('SOCIAL_SEMANTICS');
  if (!Number.isSafeInteger(d.rateLimit.maxPublishes) || d.rateLimit.maxPublishes < 1 || !Number.isSafeInteger(d.rateLimit.perSeconds) || d.rateLimit.perSeconds < 1) refuse('SOCIAL_RATE_LIMIT');
  if (!d.actions.some((a) => a.kind === 'SOCIAL_PUBLISH')) refuse('SOCIAL_NO_PUBLISH_ACTION');
  return d;
}

export interface SocialPostPackage {
  readonly v: 1;
  readonly channelIntent: string;
  readonly text: string;
  readonly media: readonly { readonly path: string; readonly altText: string }[];
  readonly links: readonly string[];
  readonly timing: { readonly notBefore: string; readonly notAfter: string } | null;
  readonly goalRefs: readonly string[];
  readonly hypothesis: string;
}

/** The logical path of a social candidate's package inside its revision. */
export const SOCIAL_PACKAGE_PATH = 'social/post.json';

/**
 * Parses a provider-neutral social post package (`social/post.json`). Media are references to files of the SAME revision
 * (never duplicated binaries) and each carries alt text; links are https only; timing, when present, is an exact window.
 */
export function parseSocialPackage(json: string, revisionPaths: readonly string[]): SocialPostPackage {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return refuse('SOCIAL_PACKAGE_NOT_JSON');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o !== 'object' || o === null || o.v !== 1) return refuse('SOCIAL_PACKAGE_VERSION');
  const str = (v: unknown, max: number, field: string): string => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v : refuse('SOCIAL_PACKAGE_FIELD', field));
  const channelIntent = typeof o.channelIntent === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(o.channelIntent) ? o.channelIntent : refuse('SOCIAL_PACKAGE_FIELD', 'channelIntent');
  const text = str(o.text, 3000, 'text');
  const mediaRaw = Array.isArray(o.media) ? o.media : o.media === undefined ? [] : refuse('SOCIAL_PACKAGE_FIELD', 'media');
  if (mediaRaw.length > 10) refuse('SOCIAL_PACKAGE_FIELD', 'media');
  const media = mediaRaw.map((m: unknown) => {
    const x = m as Record<string, unknown>;
    const path = assertDigitalPath(x?.path);
    if (!revisionPaths.includes(path)) refuse('SOCIAL_MEDIA_NOT_IN_REVISION', 'media');
    const kind = digitalMedia(path).mediaType;
    if (!kind.startsWith('image/') && !kind.startsWith('video/')) refuse('SOCIAL_MEDIA_TYPE', 'media');
    return { path, altText: str(x?.altText, 1000, 'altText') };
  });
  const linksRaw = Array.isArray(o.links) ? o.links : o.links === undefined ? [] : refuse('SOCIAL_PACKAGE_FIELD', 'links');
  if (linksRaw.length > 5) refuse('SOCIAL_PACKAGE_FIELD', 'links');
  const links = linksRaw.map((l: unknown) => (typeof l === 'string' && /^https:\/\/[^\s/$.?#].[^\s]{0,500}$/.test(l) ? l : refuse('SOCIAL_LINK_INVALID', 'links')));
  let timing: SocialPostPackage['timing'] = null;
  if (o.timing !== undefined && o.timing !== null) {
    const t = o.timing as Record<string, unknown>;
    if (!isWindowTs(t.notBefore) || !isWindowTs(t.notAfter) || String(t.notAfter) <= String(t.notBefore)) refuse('SCHEDULE_WINDOW_INVALID', 'timing');
    timing = { notBefore: String(t.notBefore), notAfter: String(t.notAfter) };
  }
  const goalRefs = (Array.isArray(o.goalRefs) ? o.goalRefs : []).map((g: unknown) => (typeof g === 'string' && /^goal:[0-9a-f-]{36}$/.test(g) ? g : refuse('SOCIAL_PACKAGE_FIELD', 'goalRefs')));
  const hypothesis = str(o.hypothesis, 1000, 'hypothesis');
  return { v: 1, channelIntent, text, media, links, timing, goalRefs, hypothesis };
}

/** The content type a package needs from a provider. */
export function socialContentType(p: SocialPostPackage): SocialContentType {
  const videos = p.media.filter((m) => digitalMedia(m.path).mediaType.startsWith('video/')).length;
  if (videos > 0) return 'VIDEO';
  if (p.media.length > 1) return 'MULTI_IMAGE';
  if (p.media.length === 1) return 'IMAGE';
  return p.links.length > 0 ? 'LINK' : 'TEXT';
}

export type SocialPublishCheck = { readonly ok: true } | { readonly ok: false; readonly code: string };

/**
 * The fail-closed gate every social publish passes inside its driver, before any provider call: the pinned API version is
 * still usable, the provider supports the content type, the connected identity holds every required permission and role,
 * and NOW is inside the exact window the approval bound (a scheduled post executes later without a second approval only
 * inside that window). Unsupported behaviour is never emulated.
 */
export function checkSocialPublish(
  d: SocialAdapterDeclaration,
  req: { readonly at: string; readonly contentType: SocialContentType; readonly grantedPermissions: readonly string[]; readonly accountRoles: readonly string[]; readonly notBefore: string; readonly notAfter: string },
): SocialPublishCheck {
  if (!adapterVersionUsable(d, req.at)) return { ok: false, code: 'API_VERSION_UNSUPPORTED' };
  if (!d.contentTypes.includes(req.contentType)) return { ok: false, code: 'CONTENT_TYPE_UNSUPPORTED' };
  for (const p of Object.keys(d.requiredPermissions)) if (!req.grantedPermissions.includes(p)) return { ok: false, code: 'PERMISSION_MISSING' };
  for (const r of d.accountRoles) if (!req.accountRoles.includes(r)) return { ok: false, code: 'ACCOUNT_ROLE_MISSING' };
  if (req.at < req.notBefore) return { ok: false, code: 'BEFORE_APPROVED_WINDOW' };
  if (req.at >= req.notAfter) return { ok: false, code: 'OUTSIDE_APPROVED_WINDOW' };
  return { ok: true };
}

// --- Promotion lifecycle (derived from canonical facts) -------------------------------------------------------------

/**
 * The lifecycle of one promotion as the Founder sees it, DERIVED from the canonical rows that own each fact (review
 * request → approval → tool invocation) — never a second review, approval or execution state.
 */
export const PROMOTION_STATES = ['PREPARED', 'UNDER_REVIEW', 'REVIEW_REJECTED', 'READY_FOR_FOUNDER', 'REJECTED', 'APPROVED', 'EXECUTING', 'PROMOTED', 'FAILED', 'RECONCILIATION_REQUIRED', 'STALE'] as const;
export type PromotionState = (typeof PROMOTION_STATES)[number];

export interface PromotionFacts {
  readonly candidateIntact: boolean;
  readonly review: 'NONE' | 'OPEN' | 'SATISFIED' | 'REWORK' | 'STALE' | 'ESCALATED';
  readonly approval: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CONSUMED' | 'REVOKED';
  readonly invocation: 'NONE' | 'INTENT_RECORDED' | 'SUCCEEDED' | 'FAILED' | 'RETRYABLE' | 'RECONCILIATION_REQUIRED';
}

export function promotionState(f: PromotionFacts): PromotionState {
  if (f.invocation === 'SUCCEEDED') return 'PROMOTED';
  if (f.invocation === 'RECONCILIATION_REQUIRED') return 'RECONCILIATION_REQUIRED';
  if (f.invocation === 'INTENT_RECORDED') return 'EXECUTING';
  if (f.invocation === 'FAILED') return 'FAILED';
  if (f.approval === 'REJECTED') return 'REJECTED';
  if (f.review === 'REWORK') return 'REVIEW_REJECTED';
  if (!f.candidateIntact) return 'STALE';
  if (f.approval === 'APPROVED') return 'APPROVED';
  if (f.approval === 'PENDING') return 'READY_FOR_FOUNDER';
  if (f.approval === 'EXPIRED' || f.approval === 'REVOKED') return 'STALE';
  if (f.review === 'OPEN' || f.review === 'ESCALATED' || f.review === 'SATISFIED') return 'UNDER_REVIEW';
  return 'PREPARED';
}

/** A promotion whose exact act the Founder or the Review Pool refused is history: the same candidate × target × kind never regenerates. */
export const isRefusedPromotion = (s: PromotionState): boolean => s === 'REJECTED' || s === 'REVIEW_REJECTED';
