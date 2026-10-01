/**
 * C7-B — the Company → App governed control kernel (the frozen App operations contract §10–§15, PO-OPS-07 / -08 / -15 / -18 / -19). Pure.
 *
 * A Company control is an OPERATIONAL OVERLAY, never Product authority. It may restrict, hold, disable, gate rollout,
 * require an upgrade or enter maintenance; it never manufactures consent, privacy, ownership, truth or entitlement,
 * never rewrites history and never runs anything. `RELEASE` removes the Company's own overlay for one exact series —
 * nothing more. A less restrictive revision (a flag ENABLED, a rollout ENABLED) likewise only removes Company
 * restriction: the App runtime still intersects it with its own Product, launch, entitlement and Safety authority.
 *
 * - Exactly seven families exist (an eighth needs a later controlled Product / Architecture change).
 * - Every family admits only its own closed scope kinds; every scope is short opaque codes (no user, PII or selector).
 * - Every value is a closed, typed shape: no free text, no JSON bag, no expression, script, query, prompt or URL.
 * - Approved Remote Configuration exists only under a separately approved typed family; the production register is
 *   EMPTY, so it fails closed (`NO_APPROVED_REMOTE_CONFIG_FAMILY`) until a later controlled release adds one.
 * - Route Hold is negative only: it holds a named provider or route out of eligibility; it never selects, forces,
 *   ranks, falls back or chooses FAST / DEEP.
 * - The Company knows what it ISSUED (desired state). It never states what the App applied: that needs authenticated
 *   App-side evidence (later Production Integration). A hash is a fingerprint, never authentication.
 */
import { QandeelError, canonicalJson, sha256Hex } from '@qandeel-company/domain';

export const CONTROL_FAMILIES = ['FEATURE_FLAG', 'KILL_SWITCH', 'MAINTENANCE_MODE', 'ROLLOUT_CONTROL', 'MINIMUM_SUPPORTED_VERSION', 'APPROVED_REMOTE_CONFIGURATION', 'ROUTE_HOLD'] as const;
export type ControlFamily = (typeof CONTROL_FAMILIES)[number];
export const isControlFamily = (v: unknown): v is ControlFamily => typeof v === 'string' && (CONTROL_FAMILIES as readonly string[]).includes(v);

export const CONTROL_OPERATIONS = ['SET', 'RELEASE'] as const;
export type ControlOperation = (typeof CONTROL_OPERATIONS)[number];

/** The ONLY Company state of an issued revision. There is no applied / delivered / acknowledged / effective state. */
export const COMPANY_CONTROL_STATES = ['ISSUED'] as const;
export type CompanyControlState = (typeof COMPANY_CONTROL_STATES)[number];

/** The explicit grant an Employee needs to propose a control revision (R3; resource = the family's grant code). */
export const APP_CONTROL_CAPABILITY = 'app-control.issue';
/** The action of the Founder approval a control revision needs (the C2 approval engine, R3). */
export const APP_CONTROL_APPROVAL_ACTION = 'app-control.issue';
/** Every Company → App control revision is production-impacting: R3 in Strong v1 (independent review AND Founder). */
export const APP_CONTROL_RISK = 'R3';
/** The persistent Product seat that operates controls (PO-OPS-09). A seat is eligibility, never authority. */
export const APP_OPERATIONS_LEAD_SEAT = 'product.app-operations-release-lead';

export const CONTROL_SCOPE_KINDS = ['APP', 'CAPABILITY', 'SURFACE', 'COHORT', 'PLATFORM', 'PLATFORM_CAPABILITY', 'PROVIDER', 'ROUTE'] as const;
export type ControlScopeKind = (typeof CONTROL_SCOPE_KINDS)[number];

/** The exact identifier keys of each scope kind (sorted; nothing else is admitted). */
const SCOPE_KEYS: Readonly<Record<ControlScopeKind, readonly string[]>> = Object.freeze({
  APP: [],
  CAPABILITY: ['capability'],
  SURFACE: ['surface'],
  COHORT: ['capability', 'cohort'],
  PLATFORM: ['platform'],
  PLATFORM_CAPABILITY: ['capability', 'platform'],
  PROVIDER: ['provider'],
  ROUTE: ['route'],
});

/** Which scope kinds each family admits (the frozen App operations contract §10.1 "explicit scope", §11). */
export const FAMILY_SCOPES: Readonly<Record<ControlFamily, readonly ControlScopeKind[]>> = Object.freeze({
  FEATURE_FLAG: ['CAPABILITY'],
  KILL_SWITCH: ['CAPABILITY'],
  MAINTENANCE_MODE: ['APP', 'CAPABILITY', 'SURFACE'],
  ROLLOUT_CONTROL: ['COHORT'],
  MINIMUM_SUPPORTED_VERSION: ['PLATFORM', 'PLATFORM_CAPABILITY'],
  APPROVED_REMOTE_CONFIGURATION: ['APP', 'CAPABILITY', 'SURFACE'],
  ROUTE_HOLD: ['PROVIDER', 'ROUTE'],
});

/** The frozen CW2-08 feature-flag state vocabulary (CW2-08 §24 stays the one feature-flag authority). */
export const FEATURE_FLAG_STATES = ['DISABLED', 'INTERNAL', 'LIMITED_ROLLOUT', 'ENABLED', 'EMERGENCY_DISABLED'] as const;
/** Cohort-scoped exposure (the frozen App operations contract §11 row 4). No percentage: the frozen authority defines none. */
export const ROLLOUT_EXPOSURES = ['INTERNAL', 'LIMITED_ROLLOUT', 'ENABLED'] as const;
/** Structured operational reasons for maintenance (never user-facing copy: that moment belongs to the E2E audit). */
export const MAINTENANCE_REASONS = ['PLANNED_MAINTENANCE', 'INFRASTRUCTURE_WORK', 'DATA_MIGRATION', 'INCIDENT_MITIGATION', 'DEPENDENCY_UNAVAILABLE', 'SECURITY_REMEDIATION'] as const;
export const CONTROL_PLATFORMS = ['IOS', 'ANDROID', 'WEB'] as const;
/** Kill Switch: the one effect is taking the exact scope out of service. */
export const KILL_SWITCH_EFFECT = 'OUT_OF_SERVICE';
/** Route Hold: the one value is a hold. Negative only (the frozen App operations contract §14). */
export const ROUTE_HOLD_VALUE = 'HELD';

/** The resource code a family's grant is scoped to (`feature-flag`, `route-hold`, …; or `*`). */
export const controlGrantResource = (family: unknown): string => (isControlFamily(family) ? family.toLowerCase().replace(/_/g, '-') : 'app-control-invalid');

/** Engineering bounds (policy, not Product semantics). */
export const MAX_CONTROL_EVIDENCE_REFS = 8;
const IDENT = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,7}$/;
const VERSION = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const EVIDENCE_REF = /^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._:-]{1,95}$/;

/**
 * Field names that would turn a control into something it may never be. Every object is an exact allowlist anyway;
 * these only name WHY an unknown key is refused (a generic-execution, private-content or route-selection attempt).
 */
const EXECUTION_KEY = /^(?:code|scripts?|sql|query|queries|command|commands|cmd|shell|exec|execute|eval|expressions?|expr|rules?|prompts?|template|instructions?|url|uri|endpoint|webhook|function|lambda|module|bundle|patch|ota|action|actions|operation_args|args|arguments|payload|body|config|json|data|metadata|meta|extra|attributes|conditions?|filter|targeting|segment|percentage|percent)$/i;
const PRIVATE_KEY = /^(?:user|users|user_?id|user_?ref|account|account_?id|email|phone|msisdn|name|conversation|conversation_?id|session|session_?id|memory|memory_?id|analysis|transcript|audio|message|messages|content|text|world|location|ip|device_?id|pseudonym)$/i;
const SELECTION_KEY = /^(?:select|selected|force|forced|prefer|preferred|primary|fallback|replacement|model|route_?to|use|fast|deep|path|mode|rank|ranking|weight|priority)$/i;

function refuse(reason: string, field?: string): never {
  throw new QandeelError('CONTROL_REFUSED', 'the control was refused', field === undefined ? { reason } : { reason, field });
}

/** An exact-key object: anything else is refused with the reason its name implies. */
function exact(v: unknown, keys: readonly string[], where: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) refuse('NOT_AN_OBJECT', where);
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (keys.includes(k)) continue;
    if (EXECUTION_KEY.test(k)) refuse('GENERIC_EXECUTION_REFUSED', where);
    if (PRIVATE_KEY.test(k)) refuse('PRIVATE_FIELD_REFUSED', where);
    if (SELECTION_KEY.test(k)) refuse('SELECTION_REFUSED', where);
    refuse('UNKNOWN_FIELD', where);
  }
  for (const k of keys) if (!Object.hasOwn(o, k)) refuse('MISSING_FIELD', where);
  return o;
}

/**
 * A scope identifier: a short opaque code. Never a user / account / conversation identifier, an e-mail, a phone
 * number or a UUID-like key, and never a selector or expression (no spaces, operators or wildcards can pass).
 */
export function assertScopeIdent(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length < 2 || v.length > 64 || !IDENT.test(v)) refuse('INVALID_SCOPE_IDENTIFIER', field);
  if (/\d{6,}/.test(v) || /[0-9a-f]{8}-[0-9a-f]{4}/.test(v)) refuse('PRIVATE_IDENTIFIER_REFUSED', field);
  return v;
}

export type ControlScope = Readonly<Record<string, string>> & { readonly kind: ControlScopeKind };

/** Normalizes a scope against the family's admitted scope kinds (returns a fresh, sorted object). */
export function normalizeScope(family: ControlFamily, raw: unknown, admitted: readonly ControlScopeKind[] = FAMILY_SCOPES[family]): ControlScope {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) refuse('NOT_AN_OBJECT', 'scope');
  const kind = (raw as Record<string, unknown>).kind;
  if (typeof kind !== 'string' || !(CONTROL_SCOPE_KINDS as readonly string[]).includes(kind)) refuse('UNKNOWN_SCOPE_KIND', 'scope.kind');
  if (!admitted.includes(kind as ControlScopeKind)) refuse('SCOPE_NOT_ALLOWED_FOR_FAMILY', 'scope.kind');
  const keys = SCOPE_KEYS[kind as ControlScopeKind];
  const o = exact(raw, ['kind', ...keys], 'scope');
  const out: Record<string, string> = { kind };
  for (const k of keys) {
    if (k === 'platform') {
      const p = o[k];
      if (typeof p !== 'string' || !(CONTROL_PLATFORMS as readonly string[]).includes(p)) refuse('INVALID_PLATFORM', 'scope.platform');
      out[k] = p as string;
    } else out[k] = assertScopeIdent(o[k], `scope.${k}`);
  }
  return out as ControlScope;
}

// --- Approved Remote Configuration (PO-OPS-18) -----------------------------------------------------------

/** A separately approved Remote Configuration family: one typed, bounded, scope-limited value. No free text exists. */
export interface RemoteConfigFamily {
  readonly code: string;
  readonly version: number;
  readonly valueType: 'BOOLEAN' | 'INTEGER' | 'ENUM';
  readonly min: number | null;
  readonly max: number | null;
  readonly enumValues: readonly string[] | null;
  readonly scopeKinds: readonly ('APP' | 'CAPABILITY' | 'SURFACE')[];
}

/**
 * The production register of approved Remote Configuration families. EMPTY: P4 froze no initial family and none has
 * been approved by Product Owner + Architecture since. A later controlled release adds one (a migration of the
 * datastore register too); nothing in this release invents a key.
 */
export const PRODUCTION_REMOTE_CONFIG_FAMILIES: readonly RemoteConfigFamily[] = Object.freeze([]);

/** Validates a family DEFINITION: what a future approval may contain (typed and bounded, never generic). */
export function assertRemoteConfigFamily(def: unknown): RemoteConfigFamily {
  const o = exact(def, ['code', 'version', 'valueType', 'min', 'max', 'enumValues', 'scopeKinds'], 'remoteConfigFamily');
  const code = assertScopeIdent(o.code, 'remoteConfigFamily.code');
  if (!Number.isSafeInteger(o.version) || (o.version as number) < 1) refuse('INVALID_FAMILY_DEFINITION', 'version');
  const valueType = o.valueType;
  if (valueType !== 'BOOLEAN' && valueType !== 'INTEGER' && valueType !== 'ENUM') refuse('INVALID_FAMILY_DEFINITION', 'valueType');
  const scopes = o.scopeKinds;
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some((s) => s !== 'APP' && s !== 'CAPABILITY' && s !== 'SURFACE')) refuse('INVALID_FAMILY_DEFINITION', 'scopeKinds');
  const bounded = (v: unknown): number | null => {
    if (v === null) return null;
    if (!Number.isSafeInteger(v) || Math.abs(v as number) > 1_000_000_000) refuse('INVALID_FAMILY_DEFINITION', 'bounds');
    return v as number;
  };
  const min = bounded(o.min);
  const max = bounded(o.max);
  if (valueType === 'INTEGER' && (min === null || max === null || min > max)) refuse('INVALID_FAMILY_DEFINITION', 'bounds');
  if (valueType !== 'INTEGER' && (min !== null || max !== null)) refuse('INVALID_FAMILY_DEFINITION', 'bounds');
  let enumValues: string[] | null = null;
  if (valueType === 'ENUM') {
    const e = o.enumValues;
    if (!Array.isArray(e) || e.length === 0 || e.length > 16 || e.some((x) => typeof x !== 'string' || !/^[A-Z][A-Z0-9_]{0,31}$/.test(x)) || new Set(e).size !== e.length) refuse('INVALID_FAMILY_DEFINITION', 'enumValues');
    enumValues = [...(e as string[])];
  } else if (o.enumValues !== null) refuse('INVALID_FAMILY_DEFINITION', 'enumValues');
  return Object.freeze({ code, version: o.version as number, valueType, min, max, enumValues: enumValues === null ? null : Object.freeze(enumValues), scopeKinds: Object.freeze([...new Set(scopes as ('APP' | 'CAPABILITY' | 'SURFACE')[])]) });
}

function remoteConfigValue(raw: unknown, scope: ControlScope, register: readonly RemoteConfigFamily[]): Record<string, unknown> {
  // Fail closed before anything else is read: with no approved family there is no Remote Configuration at all.
  if (register.length === 0) refuse('NO_APPROVED_REMOTE_CONFIG_FAMILY', 'value.family');
  const o = exact(raw, ['family', 'value'], 'value');
  const fam = register.find((f) => f.code === o.family);
  if (fam === undefined) refuse('NO_APPROVED_REMOTE_CONFIG_FAMILY', 'value.family');
  if (!(fam.scopeKinds as readonly string[]).includes(scope.kind)) refuse('SCOPE_NOT_ALLOWED_FOR_FAMILY', 'scope.kind');
  const v = o.value;
  if (fam.valueType === 'BOOLEAN' && typeof v !== 'boolean') refuse('INVALID_VALUE', 'value.value');
  if (fam.valueType === 'INTEGER' && (!Number.isSafeInteger(v) || (v as number) < (fam.min ?? 0) || (v as number) > (fam.max ?? 0))) refuse('INVALID_VALUE', 'value.value');
  if (fam.valueType === 'ENUM' && (typeof v !== 'string' || !(fam.enumValues ?? []).includes(v))) refuse('INVALID_VALUE', 'value.value');
  return { family: fam.code, value: v };
}

/** The family's value for SET (a closed typed shape) — or null for RELEASE (no value: the overlay is removed). */
export function normalizeValue(family: ControlFamily, operation: ControlOperation, raw: unknown, scope: ControlScope, register: readonly RemoteConfigFamily[]): Record<string, unknown> | null {
  if (operation === 'RELEASE') {
    if (raw !== undefined && raw !== null) refuse('RELEASE_HAS_NO_VALUE', 'value');
    return null;
  }
  const one = (key: string, allowed: readonly string[]): Record<string, unknown> => {
    const o = exact(raw, [key], 'value');
    if (typeof o[key] !== 'string' || !allowed.includes(o[key] as string)) refuse('INVALID_VALUE', `value.${key}`);
    return { [key]: o[key] };
  };
  switch (family) {
    case 'FEATURE_FLAG':
      return one('state', FEATURE_FLAG_STATES);
    case 'KILL_SWITCH':
      return one('effect', [KILL_SWITCH_EFFECT]);
    case 'MAINTENANCE_MODE':
      return one('reason', MAINTENANCE_REASONS);
    case 'ROLLOUT_CONTROL':
      return one('exposure', ROLLOUT_EXPOSURES);
    case 'MINIMUM_SUPPORTED_VERSION': {
      const o = exact(raw, ['minVersion'], 'value');
      if (typeof o.minVersion !== 'string' || !VERSION.test(o.minVersion)) refuse('INVALID_VERSION', 'value.minVersion');
      return { minVersion: o.minVersion };
    }
    case 'APPROVED_REMOTE_CONFIGURATION':
      return remoteConfigValue(raw, scope, register);
    case 'ROUTE_HOLD':
      return one('hold', [ROUTE_HOLD_VALUE]);
  }
}

// --- A proposed control revision ---------------------------------------------------------------------------

export interface ControlProposal {
  readonly family: ControlFamily;
  readonly scope: ControlScope;
  /** The canonical scope: the series identity together with the family. */
  readonly scopeKey: string;
  readonly operation: ControlOperation;
  readonly value: Record<string, unknown> | null;
  readonly reasonCode: string;
  readonly evidenceRefs: readonly string[];
  /** The Company-issued revision the proposer saw as current (0: none). A later issuance makes this proposal stale. */
  readonly expectedRevision: number;
}

/** Validates a proposed revision (model output is untrusted data: every byte is checked, nothing is inferred). */
export function normalizeControlProposal(raw: unknown, register: readonly RemoteConfigFamily[] = PRODUCTION_REMOTE_CONFIG_FAMILIES): ControlProposal {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) refuse('NOT_AN_OBJECT', 'control');
  const r = raw as Record<string, unknown>;
  const allowed = ['family', 'scope', 'operation', 'value', 'reasonCode', 'evidenceRefs', 'expectedRevision'];
  for (const k of Object.keys(r)) if (!allowed.includes(k)) exact({ [k]: null }, [], 'control');
  if (!isControlFamily(r.family)) refuse('UNKNOWN_CONTROL_FAMILY', 'family');
  const family = r.family;
  if (r.operation !== 'SET' && r.operation !== 'RELEASE') refuse('UNKNOWN_OPERATION', 'operation');
  const operation = r.operation;
  const scope = normalizeScope(family, r.scope);
  const value = normalizeValue(family, operation, r.value, scope, register);
  if (typeof r.reasonCode !== 'string' || r.reasonCode.length > 64 || !IDENT.test(r.reasonCode)) refuse('INVALID_REASON_CODE', 'reasonCode');
  const refs = r.evidenceRefs === undefined ? [] : r.evidenceRefs;
  if (!Array.isArray(refs) || refs.length > MAX_CONTROL_EVIDENCE_REFS || refs.some((x) => typeof x !== 'string' || !EVIDENCE_REF.test(x))) refuse('INVALID_EVIDENCE_REFS', 'evidenceRefs');
  const expected = r.expectedRevision;
  if (!Number.isSafeInteger(expected) || (expected as number) < 0) refuse('INVALID_EXPECTED_REVISION', 'expectedRevision');
  return Object.freeze({ family, scope, scopeKey: canonicalJson(scope), operation, value, reasonCode: r.reasonCode, evidenceRefs: Object.freeze([...new Set(refs as string[])].sort()), expectedRevision: expected as number });
}

/**
 * The fingerprint of exactly the act that is reviewed and approved. Any material change (family, scope, operation,
 * value, reason, evidence, expected revision) is a different fingerprint, so a review or an approval never carries over.
 */
export function controlProposalFingerprint(p: ControlProposal): string {
  return sha256Hex(canonicalJson({ v: 1, kind: 'company.app-control.proposal', family: p.family, scope: p.scope, operation: p.operation, value: p.value, reasonCode: p.reasonCode, evidenceRefs: p.evidenceRefs, expectedRevision: p.expectedRevision }));
}

/** The content digest of one issued revision (deterministic; a fingerprint, never authentication or a signature). */
export function controlRevisionDigest(r: { seriesId: string; revision: number; family: ControlFamily; scope: ControlScope; operation: ControlOperation; value: Record<string, unknown> | null; priorDigest: string | null }): string {
  return sha256Hex(canonicalJson({ v: 1, kind: 'company.issued-control', seriesId: r.seriesId, revision: r.revision, family: r.family, scope: r.scope, operation: r.operation, value: r.value, priorDigest: r.priorDigest }));
}

/**
 * Whether a proposed revision changes the Company's desired state of its series at all. RELEASE needs a live SET to
 * remove; a SET identical to the current SET is no change (a no-op is never re-issued).
 */
export function controlChangeProblem(current: { operation: ControlOperation; value: Record<string, unknown> | null } | null, p: Pick<ControlProposal, 'operation' | 'value'>): 'NOTHING_TO_RELEASE' | 'NO_CHANGE' | null {
  if (p.operation === 'RELEASE') return current === null || current.operation === 'RELEASE' ? 'NOTHING_TO_RELEASE' : null;
  if (current !== null && current.operation === 'SET' && canonicalJson(current.value) === canonicalJson(p.value)) return 'NO_CHANGE';
  return null;
}

/** The one code that states a value (for previews, review subjects and summaries — codes only). */
export function controlValueCode(value: Record<string, unknown> | null): string {
  if (value === null) return 'RELEASED';
  if (Object.hasOwn(value, 'family')) return `${String(value.family)}=${String(value.value)}`;
  return Object.values(value).map(String).join(',');
}

/**
 * What the independent reviewer is shown: the whole act, codes only (it is local governed evidence, never telemetry),
 * stated as what it is — an operational overlay that restricts, never Product authority.
 */
export function controlReviewSubject(p: ControlProposal, current: { revision: number; operation: ControlOperation; value: Record<string, unknown> | null } | null): string {
  return [
    `Company-to-App operational control revision (risk ${APP_CONTROL_RISK}).`,
    `Family: ${p.family}. Scope: ${p.scopeKey}. Operation: ${p.operation}. Value: ${p.value === null ? 'none (the Company overlay is removed)' : canonicalJson(p.value)}.`,
    `Current Company-issued revision: ${current === null ? 'none' : `${current.revision} ${current.operation} ${controlValueCode(current.value)}`}; expected: ${p.expectedRevision}.`,
    `Reason: ${p.reasonCode}. Evidence: ${p.evidenceRefs.length === 0 ? 'none cited' : p.evidenceRefs.join(', ')}.`,
    'A Company control is an operational overlay: it may only restrict; a RELEASE or a less restrictive revision only removes Company restriction and grants no Product, entitlement, launch, consent, privacy or Safety authority. Issued is not applied: the App runtime decides what is effective.',
  ].join(' ');
}

// --- The outbound contract (no transport) --------------------------------------------------------------------

/** The exported contract name: Company-ISSUED desired controls (never App-applied / effective state). */
export const ISSUED_CONTROL_CONTRACT = 'company.issued-controls@1';

/** One Company-issued desired control, as a later App-side integration may consume it. Bounded operational state only. */
export interface IssuedControlEnvelope {
  readonly seriesId: string;
  readonly revision: number;
  readonly family: ControlFamily;
  readonly scope: ControlScope;
  readonly operation: ControlOperation;
  readonly value: Record<string, unknown> | null;
  readonly issuedAt: string;
  readonly digest: string;
  readonly companyState: CompanyControlState;
}

/** The only keys an envelope carries (proof and verifier anchor: no metadata bag, rationale, actor or content). */
export const ISSUED_CONTROL_ENVELOPE_KEYS = ['companyState', 'digest', 'family', 'issuedAt', 'operation', 'revision', 'scope', 'seriesId', 'value'] as const;
