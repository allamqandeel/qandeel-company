/**
 * The C7-A intake kernel: governed contracts for content-free operational facts and external outcome evidence.
 * Pure and deterministic; no I/O, no SDK, no parser that accepts what it does not know.
 *
 * - Allowlist first. An occurrence is a closed envelope (source, contract, producer id, type, times, fields); every
 *   field of every type is declared with a bounded shape. Anything else is refused — an unknown key, an array, a
 *   nested bag, free text, a secret-shaped value — with a reason CODE that never echoes the refused content (an
 *   unknown key's name may itself be content, so it is never repeated back).
 * - Private content has no path (Rules A / B / C): conversation / message text, audio, transcripts, prompts, model
 *   output, Memory / Analysis / World payloads, raw request / response bodies, credentials and raw error text are
 *   refused by name before the allowlist, so the refusal says what kind of thing was refused, and refused anyway by
 *   the allowlist if a name were missed. No value may contain whitespace: free text cannot ride in an identifier.
 * - Two semantic lanes on one intake core: an OPERATIONAL_EVENT (one of the frozen App → Company operational domains) is an
 *   operational fact, never proof that Company work succeeded; an EXTERNAL_OUTCOME observation is a measured
 *   real-world result (search, web, store, business, campaign, social, App health) — evidence, never a verdict.
 * - Provider-neutral: metric and event codes name what was measured, never who measured it; a provider is a later
 *   source registration, never a new evidence contract.
 * - A user-scoped operational diagnostic may carry only a producer-side pseudonym (64 hex). It contributes to the
 *   occurrence's identity fingerprint and is never part of the normalized, stored record: there is nothing to browse.
 */
import { QandeelError, isTimestamp, type Timestamp } from '@qandeel-company/domain';

export const EXTERNAL_LANES = ['OPERATIONAL_EVENT', 'EXTERNAL_OUTCOME'] as const;
export type ExternalLane = (typeof EXTERNAL_LANES)[number];

/** The frozen App → Company operational domains (D-C7A-01). Approval of a domain is not evidence that it is emitted. */
export const OPERATIONAL_DOMAINS = [
  'SERVICE_HEALTH', 'CRASH_ERROR', 'LATENCY_PERFORMANCE', 'SESSION_STATUS', 'CALL_STATUS', 'AI_PROVIDER', 'MODEL', 'RUNTIME_PATH',
  'COST_USAGE', 'FEATURE_USAGE', 'BUSINESS_METRIC', 'RELEASE_ADOPTION', 'RATINGS_AGGREGATE', 'USER_DIAGNOSTIC',
] as const;
export type OperationalDomain = (typeof OPERATIONAL_DOMAINS)[number];

/** Outcome families a governed outcome source may measure (C7-C / C7-D register concrete sources later). */
export const OUTCOME_FAMILIES = ['SEARCH', 'WEB_ANALYTICS', 'APP_STORE', 'BUSINESS', 'CAMPAIGN', 'SOCIAL', 'APP_HEALTH'] as const;
export type OutcomeFamily = (typeof OUTCOME_FAMILIES)[number];

/** What a source is: the App's operational stream, or one outcome family. Never a provider name. */
export const SOURCE_FAMILIES = ['APP_OPERATIONS', ...OUTCOME_FAMILIES] as const;
export type SourceFamily = (typeof SOURCE_FAMILIES)[number];

export const SOURCE_STATES = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'RETIRED'] as const;
export type SourceState = (typeof SOURCE_STATES)[number];
export const SOURCE_DECISIONS = ['ACTIVATE', 'SUSPEND', 'RETIRE'] as const;
export type SourceDecision = (typeof SOURCE_DECISIONS)[number];

/** Forward-only source lifecycle: nothing becomes trusted without a decision; RETIRED is final. */
export function nextSourceState(from: SourceState, decision: SourceDecision): SourceState {
  const to: SourceState = decision === 'ACTIVATE' ? 'ACTIVE' : decision === 'SUSPEND' ? 'SUSPENDED' : 'RETIRED';
  const allowed = (from === 'DRAFT' && (to === 'ACTIVE' || to === 'RETIRED')) || (from === 'ACTIVE' && (to === 'SUSPENDED' || to === 'RETIRED')) || (from === 'SUSPENDED' && (to === 'ACTIVE' || to === 'RETIRED'));
  if (!allowed) throw new QandeelError('INVALID_TRANSITION', `${from} -> ${to} is not a source lifecycle step`, { from, to });
  return to;
}

export const SCOPE_KINDS = ['SITE', 'PAGE_GROUP', 'APP', 'STORE_LISTING', 'CAMPAIGN', 'SOCIAL_ACCOUNT', 'BUSINESS_LINE', 'RELEASE'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const METRIC_UNITS = ['COUNT', 'RATIO', 'MONEY_MICROS', 'POSITION', 'RATING_MILLI', 'MILLISECONDS'] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

/** What a Founder binding says an accepted record is FOR (an operational fact is never outcome evidence). */
export const BINDING_ROLES = ['OUTCOME_EVIDENCE', 'DEPENDENCY_FAILURE'] as const;
export type BindingRole = (typeof BINDING_ROLES)[number];
export const BINDING_SUBJECTS = ['WORK_ITEM', 'GOAL'] as const;
export type BindingSubject = (typeof BINDING_SUBJECTS)[number];

// ---------------------------------------------------------------------------------------------------------
// Field shapes. Every string shape excludes whitespace, so no field can carry free text.

export type FieldSpec =
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  /** An upper-case machine code: an error class / code, never a message. */
  | { readonly kind: 'code' }
  /** A lower-case identifier (service, component, feature, model …). */
  | { readonly kind: 'ident' }
  | { readonly kind: 'version' }
  | { readonly kind: 'int'; readonly min: number; readonly max: number }
  | { readonly kind: 'ratio' }
  | { readonly kind: 'currency' }
  /** A producer-side pseudonym (64 hex): identity material only, never stored. */
  | { readonly kind: 'pseudonym' };

const SHAPES = {
  code: /^[A-Z][A-Z0-9_]{0,47}$/,
  ident: /^[a-z0-9][a-z0-9._-]{0,47}$/,
  version: /^[0-9]{1,4}(?:\.[0-9]{1,4}){1,2}$/,
  currency: /^[A-Z]{3}$/,
  pseudonym: /^[0-9a-f]{64}$/,
  sourceKey: /^[a-z0-9][a-z0-9.-]{2,63}$/,
  contractCode: /^[a-z][a-z0-9.-]{1,47}$/,
  producerId: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
  typeCode: /^[a-z][a-z0-9_]{0,23}\.[a-z][a-z0-9_]{0,39}$/,
} as const;

export interface FieldDecl {
  readonly spec: FieldSpec;
  readonly required: boolean;
}
const req = (spec: FieldSpec): FieldDecl => ({ spec, required: true });
const opt = (spec: FieldSpec): FieldDecl => ({ spec, required: false });
const COUNT: FieldSpec = { kind: 'int', min: 0, max: 1_000_000_000 };
const PLATFORM: FieldSpec = { kind: 'enum', values: ['IOS', 'ANDROID', 'WEB', 'SERVER'] };

export interface EventTypeSpec {
  readonly type: string;
  readonly domain: OperationalDomain;
  readonly fields: Readonly<Record<string, FieldDecl>>;
  /** When an accepted event of this type is evidence of a failure an external dependency had (bindable as DEPENDENCY_FAILURE). */
  readonly failure: 'ALWAYS' | 'NEVER' | { readonly field: string; readonly values: readonly string[] };
}

export interface MetricSpec {
  readonly metric: string;
  readonly family: OutcomeFamily;
  readonly unit: MetricUnit;
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
  readonly scopes: readonly ScopeKind[];
  readonly window: 'REQUIRED' | 'OPTIONAL';
  /** MONEY_MICROS metrics state their ISO 4217 currency. */
  readonly currency: boolean;
}

export interface ContractSpec {
  readonly code: string;
  readonly version: number;
  readonly lane: ExternalLane;
  readonly families: readonly SourceFamily[];
  readonly eventTypes: readonly EventTypeSpec[];
  readonly metrics: readonly MetricSpec[];
}

/** The frozen App → Company operational domains as typed, versioned, content-free operational events. */
const OPS_EVENTS_V1: ContractSpec = {
  code: 'ops.events',
  version: 1,
  lane: 'OPERATIONAL_EVENT',
  families: ['APP_OPERATIONS'],
  metrics: [],
  eventTypes: [
    { type: 'service.health', domain: 'SERVICE_HEALTH', fields: { service: req({ kind: 'ident' }), state: req({ kind: 'enum', values: ['UP', 'DEGRADED', 'DOWN'] }) }, failure: { field: 'state', values: ['DEGRADED', 'DOWN'] } },
    { type: 'app.crash', domain: 'CRASH_ERROR', fields: { errorClass: req({ kind: 'code' }), release: req({ kind: 'version' }), platform: req(PLATFORM), count: req({ kind: 'int', min: 1, max: 1_000_000_000 }) }, failure: 'ALWAYS' },
    { type: 'app.error', domain: 'CRASH_ERROR', fields: { errorCode: req({ kind: 'code' }), component: req({ kind: 'ident' }), count: req({ kind: 'int', min: 1, max: 1_000_000_000 }) }, failure: 'ALWAYS' },
    { type: 'latency.observed', domain: 'LATENCY_PERFORMANCE', fields: { operation: req({ kind: 'ident' }), p50Ms: req({ kind: 'int', min: 0, max: 3_600_000 }), p95Ms: req({ kind: 'int', min: 0, max: 3_600_000 }), sample: req(COUNT) }, failure: 'NEVER' },
    { type: 'session.status', domain: 'SESSION_STATUS', fields: { state: req({ kind: 'enum', values: ['STARTED', 'ENDED', 'FAILED'] }), count: req(COUNT) }, failure: { field: 'state', values: ['FAILED'] } },
    { type: 'call.status', domain: 'CALL_STATUS', fields: { state: req({ kind: 'enum', values: ['CONNECTED', 'COMPLETED', 'DROPPED', 'FAILED'] }), count: req(COUNT) }, failure: { field: 'state', values: ['DROPPED', 'FAILED'] } },
    { type: 'provider.status', domain: 'AI_PROVIDER', fields: { provider: req({ kind: 'ident' }), state: req({ kind: 'enum', values: ['AVAILABLE', 'DEGRADED', 'UNAVAILABLE'] }), errorCode: opt({ kind: 'code' }) }, failure: { field: 'state', values: ['DEGRADED', 'UNAVAILABLE'] } },
    { type: 'model.usage', domain: 'MODEL', fields: { provider: req({ kind: 'ident' }), model: req({ kind: 'ident' }), calls: req(COUNT) }, failure: 'NEVER' },
    { type: 'runtime.path', domain: 'RUNTIME_PATH', fields: { path: req({ kind: 'ident' }), state: req({ kind: 'enum', values: ['ACTIVE', 'FALLBACK', 'HELD'] }) }, failure: { field: 'state', values: ['HELD'] } },
    { type: 'cost.usage', domain: 'COST_USAGE', fields: { category: req({ kind: 'enum', values: ['MODEL', 'INFRASTRUCTURE', 'STORAGE', 'OTHER'] }), costMicros: req({ kind: 'int', min: 0, max: 1_000_000_000_000_000 }), currency: req({ kind: 'currency' }), units: opt(COUNT) }, failure: 'NEVER' },
    { type: 'feature.usage', domain: 'FEATURE_USAGE', fields: { feature: req({ kind: 'ident' }), count: req(COUNT) }, failure: 'NEVER' },
    { type: 'subscription.count', domain: 'BUSINESS_METRIC', fields: { plan: req({ kind: 'ident' }), active: req(COUNT), started: req(COUNT), cancelled: req(COUNT) }, failure: 'NEVER' },
    { type: 'release.adoption', domain: 'RELEASE_ADOPTION', fields: { release: req({ kind: 'version' }), platform: req(PLATFORM), ratio: req({ kind: 'ratio' }) }, failure: 'NEVER' },
    // Aggregate store ratings only: public review TEXT is outside this content-free core (D-C7A-01).
    { type: 'rating.aggregate', domain: 'RATINGS_AGGREGATE', fields: { store: req({ kind: 'enum', values: ['APP_STORE', 'PLAY_STORE', 'OTHER'] }), averageMilli: req({ kind: 'int', min: 0, max: 5_000 }), ratingsCount: req(COUNT) }, failure: 'NEVER' },
    // Structural per-user reliability fact: a pseudonym, a code and a state — never user content, never stored per user.
    { type: 'user.diagnostic', domain: 'USER_DIAGNOSTIC', fields: { userPseudonym: req({ kind: 'pseudonym' }), code: req({ kind: 'code' }), state: req({ kind: 'enum', values: ['OK', 'DEGRADED', 'FAILED'] }) }, failure: 'NEVER' },
  ],
};

const metric = (m: string, family: OutcomeFamily, unit: MetricUnit, scopes: readonly ScopeKind[], window: 'REQUIRED' | 'OPTIONAL' = 'REQUIRED'): MetricSpec => {
  const bounds: Record<MetricUnit, [number, number, boolean]> = {
    COUNT: [0, 1_000_000_000_000, true],
    RATIO: [0, 1, false],
    MONEY_MICROS: [0, 1_000_000_000_000_000, true],
    POSITION: [1, 1_000, false],
    RATING_MILLI: [0, 5_000, true],
    MILLISECONDS: [0, 86_400_000, true],
  };
  const [min, max, integer] = bounds[unit];
  return { metric: m, family, unit, min, max, integer, scopes, window, currency: unit === 'MONEY_MICROS' };
};

/** Provider-neutral external outcome metrics; a provider is a later source registration, never a new contract. */
const OUTCOME_METRICS_V1: ContractSpec = {
  code: 'outcome.metrics',
  version: 1,
  lane: 'EXTERNAL_OUTCOME',
  families: [...OUTCOME_FAMILIES],
  eventTypes: [],
  metrics: [
    metric('search.impressions', 'SEARCH', 'COUNT', ['SITE', 'PAGE_GROUP']),
    metric('search.clicks', 'SEARCH', 'COUNT', ['SITE', 'PAGE_GROUP']),
    metric('search.click_through_rate', 'SEARCH', 'RATIO', ['SITE', 'PAGE_GROUP']),
    metric('search.average_position', 'SEARCH', 'POSITION', ['SITE', 'PAGE_GROUP']),
    metric('web.sessions', 'WEB_ANALYTICS', 'COUNT', ['SITE', 'PAGE_GROUP', 'CAMPAIGN']),
    metric('web.users', 'WEB_ANALYTICS', 'COUNT', ['SITE', 'PAGE_GROUP', 'CAMPAIGN']),
    metric('web.conversions', 'WEB_ANALYTICS', 'COUNT', ['SITE', 'PAGE_GROUP', 'CAMPAIGN']),
    metric('web.conversion_rate', 'WEB_ANALYTICS', 'RATIO', ['SITE', 'PAGE_GROUP', 'CAMPAIGN']),
    metric('store.rating_average', 'APP_STORE', 'RATING_MILLI', ['STORE_LISTING'], 'OPTIONAL'),
    metric('store.ratings_count', 'APP_STORE', 'COUNT', ['STORE_LISTING'], 'OPTIONAL'),
    metric('store.installs', 'APP_STORE', 'COUNT', ['STORE_LISTING']),
    metric('store.page_views', 'APP_STORE', 'COUNT', ['STORE_LISTING']),
    metric('business.active_subscriptions', 'BUSINESS', 'COUNT', ['BUSINESS_LINE', 'APP'], 'OPTIONAL'),
    metric('business.new_subscriptions', 'BUSINESS', 'COUNT', ['BUSINESS_LINE', 'APP']),
    metric('business.cancelled_subscriptions', 'BUSINESS', 'COUNT', ['BUSINESS_LINE', 'APP']),
    metric('business.revenue', 'BUSINESS', 'MONEY_MICROS', ['BUSINESS_LINE', 'APP']),
    metric('campaign.reach', 'CAMPAIGN', 'COUNT', ['CAMPAIGN']),
    metric('campaign.clicks', 'CAMPAIGN', 'COUNT', ['CAMPAIGN']),
    metric('campaign.conversions', 'CAMPAIGN', 'COUNT', ['CAMPAIGN']),
    metric('campaign.spend', 'CAMPAIGN', 'MONEY_MICROS', ['CAMPAIGN']),
    metric('social.impressions', 'SOCIAL', 'COUNT', ['SOCIAL_ACCOUNT', 'CAMPAIGN']),
    metric('social.engagements', 'SOCIAL', 'COUNT', ['SOCIAL_ACCOUNT', 'CAMPAIGN']),
    metric('social.followers', 'SOCIAL', 'COUNT', ['SOCIAL_ACCOUNT'], 'OPTIONAL'),
    metric('social.video_views', 'SOCIAL', 'COUNT', ['SOCIAL_ACCOUNT', 'CAMPAIGN']),
    metric('app.crash_free_sessions_rate', 'APP_HEALTH', 'RATIO', ['APP', 'RELEASE']),
    metric('app.release_adoption_rate', 'APP_HEALTH', 'RATIO', ['APP', 'RELEASE']),
    metric('app.availability_rate', 'APP_HEALTH', 'RATIO', ['APP']),
    metric('app.p95_latency', 'APP_HEALTH', 'MILLISECONDS', ['APP', 'RELEASE']),
  ],
};

/** Every contract this release can validate. A source names exactly one (code, version); anything else fails closed. */
export const EXTERNAL_CONTRACTS: readonly ContractSpec[] = Object.freeze([OPS_EVENTS_V1, OUTCOME_METRICS_V1]);

export function contractOf(code: unknown, version: unknown): ContractSpec | null {
  return EXTERNAL_CONTRACTS.find((c) => c.code === code && c.version === version) ?? null;
}

export function assertSourceRegistration(input: { sourceKey: unknown; family: unknown; contractCode: unknown; contractVersion: unknown }): { sourceKey: string; family: SourceFamily; contract: ContractSpec } {
  if (typeof input.sourceKey !== 'string' || !SHAPES.sourceKey.test(input.sourceKey)) throw new QandeelError('VALIDATION_FAILED', 'sourceKey is a short lower-case code', { field: 'sourceKey' });
  if (typeof input.family !== 'string' || !(SOURCE_FAMILIES as readonly string[]).includes(input.family)) throw new QandeelError('VALIDATION_FAILED', 'family is a known source family', { field: 'family' });
  const contract = contractOf(input.contractCode, input.contractVersion);
  if (contract === null) throw new QandeelError('VALIDATION_FAILED', 'contract is a known (code, version) of this release', { field: 'contract', reason: 'UNKNOWN_CONTRACT' });
  if (!contract.families.includes(input.family as SourceFamily)) throw new QandeelError('VALIDATION_FAILED', 'the contract does not serve this source family', { field: 'family', reason: 'CONTRACT_FAMILY_MISMATCH' });
  return { sourceKey: input.sourceKey, family: input.family as SourceFamily, contract };
}

// ---------------------------------------------------------------------------------------------------------
// Refusal by name (before the allowlist) — so a refusal says WHAT KIND of thing was refused, never what it said.

export const INTAKE_REJECTIONS = [
  'NOT_AN_OBJECT', 'TOO_LARGE', 'ARRAY_NOT_ALLOWED', 'PRIVATE_CONTENT_FIELD', 'CREDENTIAL_FIELD', 'RAW_PAYLOAD_FIELD', 'FREE_FORM_BAG', 'UNKNOWN_FIELD',
  'MISSING_FIELD', 'INVALID_FIELD', 'FREE_TEXT_VALUE', 'CREDENTIAL_VALUE', 'UNKNOWN_CONTRACT', 'CONTRACT_MISMATCH', 'UNKNOWN_TYPE', 'NOT_ALLOWED_FOR_SOURCE',
  'INVALID_TIME', 'OCCURRED_IN_FUTURE', 'INVALID_WINDOW', 'UNREGISTERED_SOURCE', 'SOURCE_NOT_ACTIVE', 'CONTRACT_DRIFT',
] as const;
export type IntakeRejection = (typeof INTAKE_REJECTIONS)[number];

const reject = (reason: IntakeRejection, field?: string): never => {
  throw new QandeelError('INTAKE_REJECTED', 'the occurrence was refused (content is never echoed)', field === undefined ? { reason } : { reason, field });
};

const fold = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const CONTENT_KEY = /(text|message|content|transcript|audio|voice|recording|prompt|completion|output|response|reply|answer|memory|analysis|understanding|world|conversation|utterance|chat|body|note|comment|reviewtext|description|query|email|phone|name|address|location|attachment|image|file)/;
const CREDENTIAL_KEY = /(token|secret|password|passwd|passphrase|credential|apikey|authorization|bearer|cookie|privatekey|signature|otp|pin$)/;
const RAW_KEY = /(raw|payload|stack|trace|exception|dump|header|request|html|blob|base64)/;
const BAG_KEY = /^(metadata|meta|attributes|attrs|labels|tags|dimensions|context|extra|extras|properties|props|data|details|custom|params)$/;

/** Every key the envelope may use (top level, scope, window and every declared field). Never refused by name. */
const ENVELOPE_KEYS = ['sourceKey', 'contractCode', 'contractVersion', 'producerEventId', 'type', 'occurredAt', 'scope', 'window', 'fields', 'kind', 'ref', 'from', 'to'] as const;
const DECLARED_KEYS = new Set<string>([...ENVELOPE_KEYS, 'value', 'currency', ...EXTERNAL_CONTRACTS.flatMap((c) => c.eventTypes.flatMap((t) => Object.keys(t.fields)))]);

/** The forbidden class a key name belongs to, or null. A declared key is never refused by name. */
export function forbiddenKeyClass(key: string): IntakeRejection | null {
  if (DECLARED_KEYS.has(key)) return null;
  const f = fold(key);
  if (BAG_KEY.test(f)) return 'FREE_FORM_BAG';
  if (CREDENTIAL_KEY.test(f)) return 'CREDENTIAL_FIELD';
  if (RAW_KEY.test(f)) return 'RAW_PAYLOAD_FIELD';
  if (CONTENT_KEY.test(f)) return 'PRIVATE_CONTENT_FIELD';
  return null;
}

const SECRET_VALUE = [/^eyJ[A-Za-z0-9_-]{6,}\./, /^sk-/i, /^gh[pousr]_/, /^AKIA[0-9A-Z]{12,}/, /^xox[abprs]-/, /^AIza/, /bearer/i, /-----BEGIN/, /^(?=[^+/]*[+/])[A-Za-z0-9+/]{40,}={0,2}$/];

const MAX_KEYS = 48;
const MAX_STRING = 256;

/**
 * Walks the raw envelope once: shape bounds, arrays, forbidden key names, free text and secret-shaped values. Runs
 * before anything else reads the envelope (even before its source is looked up), so private content is refused first.
 */
export function screenOccurrence(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) reject('NOT_AN_OBJECT');
  let keys = 0;
  const walk = (v: unknown, depth: number): void => {
    if (depth > 3) reject('TOO_LARGE');
    if (Array.isArray(v)) reject('ARRAY_NOT_ALLOWED');
    if (typeof v === 'string') {
      if (v.length > MAX_STRING) reject('TOO_LARGE');
      if (SECRET_VALUE.some((re) => re.test(v))) reject('CREDENTIAL_VALUE');
      if (/\s/.test(v)) reject('FREE_TEXT_VALUE');
      return;
    }
    if (typeof v !== 'object' || v === null) return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (++keys > MAX_KEYS || k.length > 64) reject('TOO_LARGE');
      const cls = forbiddenKeyClass(k);
      if (cls !== null) reject(cls);
      walk(x, depth + 1);
    }
  };
  walk(raw, 0);
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function onlyKeys(o: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) reject('UNKNOWN_FIELD');
  for (const k of required) if (o[k] === undefined) reject('MISSING_FIELD', k);
}

function fieldValue(name: string, spec: FieldSpec, v: unknown): string | number {
  const bad = (): never => reject('INVALID_FIELD', name);
  switch (spec.kind) {
    case 'enum':
      return typeof v === 'string' && spec.values.includes(v) ? v : bad();
    case 'code':
    case 'ident':
    case 'version':
    case 'currency':
    case 'pseudonym':
      return typeof v === 'string' && SHAPES[spec.kind].test(v) ? v : bad();
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) && v >= spec.min && v <= spec.max ? v : bad();
    case 'ratio':
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : bad();
  }
}

/** Accepted clock skew between a producer and the Company. Arrival order is never truth; event time is kept as sent. */
export const INTAKE_FUTURE_SKEW_MS = 5 * 60_000;
const EPOCH_FLOOR = '2020-01-01T00:00:00.000Z';
const MAX_WINDOW_MS = 400 * 86_400_000;

/** A validated, normalized occurrence. `fields` is exactly what may be stored; `identity` is what the fingerprint covers. */
export interface NormalizedOccurrence {
  readonly lane: ExternalLane;
  readonly sourceKey: string;
  readonly contractCode: string;
  readonly contractVersion: number;
  readonly producerEventId: string;
  readonly type: string;
  /** The operational domain, or the outcome family. */
  readonly domain: string;
  readonly occurredAt: Timestamp;
  readonly scope: { readonly kind: ScopeKind; readonly ref: string } | null;
  readonly window: { readonly from: Timestamp; readonly to: Timestamp } | null;
  readonly value: number | null;
  readonly unit: MetricUnit | null;
  /** Normalized, bounded, declared scalar fields (never a pseudonym). */
  readonly fields: Readonly<Record<string, string | number>>;
  readonly userScoped: boolean;
  /** An operational fact that evidences a dependency failure (bindable as DEPENDENCY_FAILURE only). */
  readonly failureSignal: boolean;
  /** Canonical identity material of the occurrence (hashed into its fingerprint; contains no free text). */
  readonly identity: Readonly<Record<string, unknown>>;
}

/**
 * Validates and normalizes one raw occurrence against the contract the source is registered under. Pure: the caller
 * supplies the source's registered (family, contract) and the observation time. Any refusal throws INTAKE_REJECTED
 * with a reason code (and, for a DECLARED field only, its name).
 */
export function normalizeOccurrence(raw: unknown, source: { readonly family: SourceFamily; readonly contractCode: string; readonly contractVersion: number }, observedAt: Timestamp): NormalizedOccurrence {
  screenOccurrence(raw);
  const o = raw as Record<string, unknown>;
  if (typeof o.contractCode !== 'string' || typeof o.contractVersion !== 'number') reject('MISSING_FIELD', 'contractCode');
  const contract = contractOf(o.contractCode, o.contractVersion);
  if (contract === null) reject('UNKNOWN_CONTRACT');
  const c = contract as ContractSpec;
  if (c.code !== source.contractCode || c.version !== source.contractVersion) reject('CONTRACT_MISMATCH');
  const outcome = c.lane === 'EXTERNAL_OUTCOME';
  onlyKeys(o, outcome ? ['sourceKey', 'contractCode', 'contractVersion', 'producerEventId', 'type', 'occurredAt', 'scope', 'window', 'fields'] : ['sourceKey', 'contractCode', 'contractVersion', 'producerEventId', 'type', 'occurredAt', 'fields'], outcome ? ['sourceKey', 'producerEventId', 'type', 'occurredAt', 'scope', 'fields'] : ['sourceKey', 'producerEventId', 'type', 'occurredAt', 'fields']);
  if (typeof o.sourceKey !== 'string' || !SHAPES.sourceKey.test(o.sourceKey)) reject('INVALID_FIELD', 'sourceKey');
  if (typeof o.producerEventId !== 'string' || !SHAPES.producerId.test(o.producerEventId)) reject('INVALID_FIELD', 'producerEventId');
  if (typeof o.type !== 'string' || !SHAPES.typeCode.test(o.type)) reject('UNKNOWN_TYPE');
  if (!isTimestamp(o.occurredAt) || o.occurredAt < EPOCH_FLOOR) reject('INVALID_TIME', 'occurredAt');
  const occurredAt = o.occurredAt as Timestamp;
  if (Date.parse(occurredAt) > Date.parse(observedAt) + INTAKE_FUTURE_SKEW_MS) reject('OCCURRED_IN_FUTURE', 'occurredAt');
  if (!isPlain(o.fields)) reject('INVALID_FIELD', 'fields');
  const rawFields = o.fields as Record<string, unknown>;
  const base = { sourceKey: o.sourceKey as string, contractCode: c.code, contractVersion: c.version, producerEventId: o.producerEventId as string, type: o.type as string, occurredAt };

  if (!outcome) {
    const t = c.eventTypes.find((x) => x.type === o.type);
    if (t === undefined) return reject('UNKNOWN_TYPE');
    onlyKeys(rawFields, Object.keys(t.fields), Object.entries(t.fields).filter(([, d]) => d.required).map(([k]) => k));
    const all: Record<string, string | number> = {};
    for (const [k, d] of Object.entries(t.fields)) if (rawFields[k] !== undefined) all[k] = fieldValue(k, d.spec, rawFields[k]);
    const stored: Record<string, string | number> = {};
    let userScoped = false;
    for (const [k, v] of Object.entries(all)) {
      if (t.fields[k]?.spec.kind === 'pseudonym') userScoped = true;
      else stored[k] = v;
    }
    const failureSignal = t.failure === 'ALWAYS' || (t.failure !== 'NEVER' && t.failure.values.includes(String(all[t.failure.field])));
    return { ...base, lane: 'OPERATIONAL_EVENT', domain: t.domain, scope: null, window: null, value: null, unit: null, fields: stored, userScoped, failureSignal, identity: { ...base, fields: all } };
  }

  const m = c.metrics.find((x) => x.metric === o.type);
  if (m === undefined) return reject('UNKNOWN_TYPE');
  if (m.family !== source.family) reject('NOT_ALLOWED_FOR_SOURCE', 'type');
  if (!isPlain(o.scope)) return reject('INVALID_FIELD', 'scope');
  onlyKeys(o.scope, ['kind', 'ref'], ['kind', 'ref']);
  const kind = o.scope.kind;
  if (typeof kind !== 'string' || !(m.scopes as readonly string[]).includes(kind)) reject('INVALID_FIELD', 'scope');
  const ref = fieldValue('scope', { kind: 'ident' }, o.scope.ref) as string;
  let window: { from: Timestamp; to: Timestamp } | null = null;
  if (o.window !== undefined) {
    if (!isPlain(o.window)) return reject('INVALID_WINDOW', 'window');
    onlyKeys(o.window, ['from', 'to'], ['from', 'to']);
    const { from, to } = o.window;
    if (!isTimestamp(from) || !isTimestamp(to) || from < EPOCH_FLOOR || from >= to || Date.parse(to) - Date.parse(from) > MAX_WINDOW_MS || Date.parse(to) > Date.parse(observedAt) + INTAKE_FUTURE_SKEW_MS || to > occurredAt) reject('INVALID_WINDOW', 'window');
    window = { from: from as Timestamp, to: to as Timestamp };
  } else if (m.window === 'REQUIRED') reject('MISSING_FIELD', 'window');
  onlyKeys(rawFields, m.currency ? ['value', 'currency'] : ['value'], m.currency ? ['value', 'currency'] : ['value']);
  const value = rawFields.value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < m.min || value > m.max || (m.integer && !Number.isInteger(value))) reject('INVALID_FIELD', 'value');
  const fields: Record<string, string | number> = m.currency ? { currency: fieldValue('currency', { kind: 'currency' }, rawFields.currency) } : {};
  const scope = { kind: kind as ScopeKind, ref };
  return { ...base, lane: 'EXTERNAL_OUTCOME', domain: m.family, scope, window, value: value as number, unit: m.unit, fields, userScoped: false, failureSignal: false, identity: { ...base, scope, window, value, fields } };
}

/** Which binding roles an accepted record may take (a Founder decision still makes each binding). */
export function bindableRole(record: { readonly lane: ExternalLane; readonly failureSignal: boolean }, role: BindingRole, subject: BindingSubject): boolean {
  if (role === 'OUTCOME_EVIDENCE') return record.lane === 'EXTERNAL_OUTCOME';
  // An operational fact never proves Company work; it may only explain a Work Item's failure as an external dependency.
  return record.lane === 'OPERATIONAL_EVENT' && record.failureSignal && subject === 'WORK_ITEM';
}
