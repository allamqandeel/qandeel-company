/**
 * L1-02 — the release-pinned Academy package contract (pure, deterministic, no I/O).
 *
 * A package is versioned Company content that a Founder inspects and installs through ONE governed confirmation
 * (D-L1-13): the role's Skills (QANDEEL-native, text-only), the bounded behavioural benchmark of every Skill version,
 * the role blueprint, the Academy program and its scenarios, and the shadow assignments of the role's probation. Its
 * identity is its code, version and canonical digest; the host registers packages, nobody types one.
 *
 * Two qualifications stay separate (Founder decision, D-L1-13):
 * - Skill Version qualification: inspection → STATIC security review → SANDBOXED bounded behavioural benchmark (the
 *   exact version loaded only inside the fenced benchmark path, against a baseline without it) → compare → approve.
 * - Employee qualification: approved Skills → Academy → simulation / assessment / holdout → probation → certification
 *   → activation. Academy success is never Skill benchmark evidence.
 *
 * Nothing here scores a model with a model: the benchmark rubric checks the answer's closed decision facets and a few
 * deterministic properties of its body against the case's stated expectations.
 */
import { QandeelError, canonicalJson, isOpaqueRef, sha256Hex } from '@qandeel-company/domain';
import { ANSWER_AUTHORITY, ANSWER_CONFIDENCE, ANSWER_DECISIONS, ANSWER_EVIDENCE, assertTaskClass, type AnswerAuthority, type AnswerConfidence, type AnswerDecision, type AnswerEvidence, type AnswerFacets } from '@qandeel-company/governance';

import { assertProgramDefinition, type ProgramDefinition, type ScenarioKind } from './academy.js';
import { BLUEPRINT_CATEGORIES, PROFICIENCY, SKILL_INSTRUCTIONS_MAX, inspectSkillPayload, type BlueprintCategory, type Proficiency } from './skills.js';

/** What a case expects of an answer. Every listed constraint is checked; `critical` ones must all hold. */
export interface AnswerExpectation {
  readonly decision?: readonly AnswerDecision[];
  readonly authority?: readonly AnswerAuthority[];
  readonly evidence?: readonly AnswerEvidence[];
  readonly confidence?: readonly AnswerConfidence[];
  readonly reversible?: boolean;
  readonly founderDecisionNeeded?: boolean;
  readonly maxSpendMicros?: number;
  /** The body must be written in Arabic (the Founder's language for this case). */
  readonly arabicBody?: boolean;
  readonly minBodyChars?: number;
  /** Lower-case phrases the body must not contain (claims of authority, fabricated certainty, approvals). */
  readonly forbidden?: readonly string[];
  /** Which constraints are critical (any failure fails the case whatever the rest). */
  readonly critical: readonly ExpectationKey[];
}

export const EXPECTATION_KEYS = ['decision', 'authority', 'evidence', 'confidence', 'reversible', 'founderDecisionNeeded', 'maxSpendMicros', 'arabicBody', 'minBodyChars', 'forbidden'] as const;
export type ExpectationKey = (typeof EXPECTATION_KEYS)[number];

export interface BenchmarkCase {
  readonly code: string;
  /** The case as the model reads it (company content; never telemetry). */
  readonly content: string;
  readonly expect: AnswerExpectation;
}

export interface PackageSkill {
  readonly code: string;
  readonly name: string;
  readonly versionLabel: string;
  readonly instructions: string;
  readonly blueprintCategory: BlueprintCategory;
  readonly critical: boolean;
  readonly minProficiency: Proficiency;
  readonly targetProficiency: Proficiency;
  readonly sourceRefs: readonly string[];
  readonly benchmark: readonly BenchmarkCase[];
}

export interface PackageScenario {
  readonly code: string;
  readonly kind: ScenarioKind;
  readonly content: string;
  readonly sourceRef: string;
  readonly budgetMicros: number;
  /** Advisory facet expectations shown to the Founder evaluator beside the answer (never a score). */
  readonly expect?: AnswerExpectation;
}

export interface PackageShadowAssignment {
  readonly code: string;
  readonly objective: string;
  readonly instructions: string;
  readonly capMicros: number;
}

export interface AcademyPackage {
  readonly code: string;
  readonly version: number;
  readonly title: string;
  readonly roleRef: string;
  readonly sourceRefs: readonly string[];
  readonly skills: readonly PackageSkill[];
  /** The program definition; its skill targets name package skill codes (resolved to IDs at install). */
  readonly program: Omit<ProgramDefinition, 'skillTargets'> & { readonly skillTargets: readonly { readonly skillCode: string; readonly proficiency: Proficiency }[] };
  readonly scenarios: readonly PackageScenario[];
  readonly shadowAssignments: readonly PackageShadowAssignment[];
  readonly taskClasses: { readonly benchmark: string; readonly attempt: string; readonly shadow: string };
  readonly limits: {
    /** Output ceiling of one benchmark / attempt / shadow call (tokens). */
    readonly benchmarkMaxOutputTokens: number;
    readonly attemptMaxOutputTokens: number;
    readonly shadowMaxOutputTokens: number;
    /** Per Work Item hard cap of one benchmark case run (micro-units). */
    readonly benchmarkCapMicros: number;
    /** Per Work Item hard cap of one Academy attempt (micro-units). */
    readonly attemptCapMicros: number;
    /** Minimum rubric score of the with-skill arm (percent) for a Skill to pass its benchmark. */
    readonly benchmarkPassPct: number;
  };
}

const CODE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,9}$/;
const REF = /^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._:/#-]{1,160}$/;
const bad = (field: string, why: string): never => {
  throw new QandeelError('VALIDATION_FAILED', `academy package ${why}`, { field });
};
const text = (v: unknown, field: string, max: number): string => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v : bad(field, `${field} is 1..${max} characters`));
const intIn = (v: unknown, field: string, lo: number, hi: number): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= lo && v <= hi ? v : bad(field, `${field} is an integer ${lo}..${hi}`));
const subset = <T extends string>(v: unknown, set: readonly T[], field: string): readonly T[] | undefined => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length === 0 || v.some((x) => !(set as readonly string[]).includes(x as string))) bad(field, `${field} is a non-empty subset of ${set.join('|')}`);
  return v as T[];
};

function assertExpectation(v: unknown, field: string): AnswerExpectation {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return bad(field, 'expectation must be an object');
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'critical' && !(EXPECTATION_KEYS as readonly string[]).includes(k)) bad(field, `unknown expectation ${k}`);
  subset(o.decision, ANSWER_DECISIONS, `${field}.decision`);
  subset(o.authority, ANSWER_AUTHORITY, `${field}.authority`);
  subset(o.evidence, ANSWER_EVIDENCE, `${field}.evidence`);
  subset(o.confidence, ANSWER_CONFIDENCE, `${field}.confidence`);
  for (const b of ['reversible', 'founderDecisionNeeded', 'arabicBody'] as const) if (o[b] !== undefined && typeof o[b] !== 'boolean') bad(field, `${b} is a boolean`);
  if (o.maxSpendMicros !== undefined) intIn(o.maxSpendMicros, `${field}.maxSpendMicros`, 0, 1_000_000_000_000);
  if (o.minBodyChars !== undefined) intIn(o.minBodyChars, `${field}.minBodyChars`, 1, 6_000);
  if (o.forbidden !== undefined && (!Array.isArray(o.forbidden) || o.forbidden.length > 16 || o.forbidden.some((x) => typeof x !== 'string' || x.length === 0 || x.length > 80 || x !== x.toLowerCase()))) bad(field, 'forbidden is at most 16 lower-case phrases');
  const critical = o.critical;
  if (!Array.isArray(critical) || critical.length === 0 || critical.some((k) => !(EXPECTATION_KEYS as readonly string[]).includes(k as string) || o[k as string] === undefined)) bad(field, 'critical names at least one of its own stated constraints');
  return o as unknown as AnswerExpectation;
}

/** Validates a package (shape, bounds, references, the program definition). Returns it unchanged. */
export function assertAcademyPackage(p: unknown): AcademyPackage {
  if (typeof p !== 'object' || p === null) return bad('package', 'must be an object');
  const o = p as AcademyPackage;
  if (typeof o.code !== 'string' || !CODE.test(o.code)) bad('code', 'code is a key code');
  intIn(o.version, 'version', 1, 10_000);
  text(o.title, 'title', 160);
  if (typeof o.roleRef !== 'string' || !/^role:[a-z][a-z0-9.-]{1,60}$/.test(o.roleRef)) bad('roleRef', 'roleRef is role:<code>');
  if (!Array.isArray(o.sourceRefs) || o.sourceRefs.length === 0 || o.sourceRefs.some((r) => !REF.test(r))) bad('sourceRefs', 'sourceRefs are refs');
  if (!Array.isArray(o.skills) || o.skills.length === 0 || o.skills.length > 16) bad('skills', 'a package has 1..16 skills');
  const codes = new Set<string>();
  for (const [i, s] of o.skills.entries()) {
    const f = `skills[${i}]`;
    if (typeof s.code !== 'string' || !CODE.test(s.code) || codes.has(s.code)) bad(f, 'skill codes are distinct key codes');
    codes.add(s.code);
    text(s.name, `${f}.name`, 120);
    text(s.versionLabel, `${f}.versionLabel`, 32);
    text(s.instructions, `${f}.instructions`, SKILL_INSTRUCTIONS_MAX);
    if (!(BLUEPRINT_CATEGORIES as readonly string[]).includes(s.blueprintCategory)) bad(f, 'blueprint category');
    if (!(PROFICIENCY as readonly string[]).includes(s.minProficiency) || !(PROFICIENCY as readonly string[]).includes(s.targetProficiency)) bad(f, 'proficiency');
    if (typeof s.critical !== 'boolean') bad(f, 'critical is a boolean');
    if (!Array.isArray(s.sourceRefs) || s.sourceRefs.length === 0 || s.sourceRefs.some((r) => !REF.test(r))) bad(f, 'skill sourceRefs');
    if (!Array.isArray(s.benchmark) || s.benchmark.length === 0 || s.benchmark.length > 4) bad(f, 'a skill has 1..4 benchmark cases');
    const cases = new Set<string>();
    for (const [j, c] of s.benchmark.entries()) {
      if (typeof c.code !== 'string' || !CODE.test(c.code) || cases.has(c.code)) bad(`${f}.benchmark[${j}]`, 'case codes are distinct key codes');
      cases.add(c.code);
      text(c.content, `${f}.benchmark[${j}].content`, 4_000);
      assertExpectation(c.expect, `${f}.benchmark[${j}].expect`);
    }
  }
  const scenarioCodes = new Set<string>();
  if (!Array.isArray(o.scenarios) || o.scenarios.length === 0 || o.scenarios.length > 64) bad('scenarios', '1..64 scenarios');
  for (const [i, s] of o.scenarios.entries()) {
    const f = `scenarios[${i}]`;
    if (typeof s.code !== 'string' || !CODE.test(s.code) || scenarioCodes.has(s.code)) bad(f, 'scenario codes are distinct key codes');
    scenarioCodes.add(s.code);
    if (!['PRACTICE', 'ASSESSMENT', 'HOLDOUT'].includes(s.kind)) bad(f, 'scenario kind');
    text(s.content, `${f}.content`, 8_000);
    // A scenario's source is stored as an opaque reference (the Academy store's grammar), checked here at build time.
    if (!isOpaqueRef(s.sourceRef)) bad(f, 'scenario sourceRef is an opaque <kind>:<id> reference');
    intIn(s.budgetMicros, `${f}.budgetMicros`, s.kind === 'PRACTICE' ? 0 : 1, 1_000_000_000);
    if (s.expect !== undefined) assertExpectation(s.expect, `${f}.expect`);
  }
  for (const k of ['PRACTICE', 'ASSESSMENT', 'HOLDOUT'] as const) if (!o.scenarios.some((s) => s.kind === k)) bad('scenarios', `the package has at least one ${k} scenario`);
  if (!Array.isArray(o.shadowAssignments) || o.shadowAssignments.length === 0 || o.shadowAssignments.length > 8) bad('shadowAssignments', '1..8 shadow assignments');
  for (const [i, a] of o.shadowAssignments.entries()) {
    if (typeof a.code !== 'string' || !CODE.test(a.code)) bad(`shadowAssignments[${i}]`, 'code');
    text(a.objective, `shadowAssignments[${i}].objective`, 400);
    text(a.instructions, `shadowAssignments[${i}].instructions`, 6_000);
    intIn(a.capMicros, `shadowAssignments[${i}].capMicros`, 1, 1_000_000_000);
  }
  for (const k of ['benchmark', 'attempt', 'shadow'] as const) assertTaskClass(o.taskClasses?.[k]);
  intIn(o.limits?.benchmarkMaxOutputTokens, 'limits.benchmarkMaxOutputTokens', 64, 8_192);
  intIn(o.limits?.attemptMaxOutputTokens, 'limits.attemptMaxOutputTokens', 64, 8_192);
  intIn(o.limits?.shadowMaxOutputTokens, 'limits.shadowMaxOutputTokens', 64, 8_192);
  intIn(o.limits?.benchmarkCapMicros, 'limits.benchmarkCapMicros', 1, 1_000_000_000);
  intIn(o.limits?.attemptCapMicros, 'limits.attemptCapMicros', 1, 1_000_000_000);
  intIn(o.limits?.benchmarkPassPct, 'limits.benchmarkPassPct', 1, 100);
  // The program, with placeholder UUIDs for the skill targets (the real IDs are bound at install).
  for (const t of o.program?.skillTargets ?? []) if (!codes.has(t.skillCode)) bad('program.skillTargets', `skill target ${t.skillCode} is not a package skill`);
  assertProgramDefinition({ ...o.program, skillTargets: (o.program?.skillTargets ?? []).map((t, i) => ({ skillId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, proficiency: t.proficiency })) });
  return o;
}

/** The canonical digest of a package (its exact content). */
export function academyPackageDigest(p: AcademyPackage): string {
  return sha256Hex(canonicalJson(assertAcademyPackage(p)));
}

/** The program definition with the package's skill codes bound to installed skill IDs. */
export function bindProgram(p: AcademyPackage, skillIdOf: (code: string) => string): ProgramDefinition {
  return assertProgramDefinition({ ...p.program, skillTargets: p.program.skillTargets.map((t) => ({ skillId: skillIdOf(t.skillCode), proficiency: t.proficiency })) });
}

// --- The deterministic answer rubric ------------------------------------------------------------------------------

export interface RubricCheck {
  readonly key: ExpectationKey;
  readonly passed: boolean;
  readonly critical: boolean;
}

export interface RubricResult {
  readonly checks: readonly RubricCheck[];
  readonly scorePct: number;
  readonly criticalPassed: boolean;
  readonly passed: boolean;
}

const ARABIC_LETTER = /[؀-ۿ]/g;
const LATIN_LETTER = /[A-Za-z]/g;
/** Whether a body is written in Arabic: Arabic letters outnumber Latin letters (code-switching allowed). */
export function isArabicBody(body: string): boolean {
  const ar = body.match(ARABIC_LETTER)?.length ?? 0;
  const la = body.match(LATIN_LETTER)?.length ?? 0;
  return ar > 0 && ar >= la;
}

/**
 * Scores one answer against a case's expectations. Deterministic and total; a case passes when every critical
 * constraint holds and the score reaches `passPct`.
 */
export function scoreAnswer(expect: AnswerExpectation, answer: { readonly body: string } & AnswerFacets, passPct: number): RubricResult {
  const checks: RubricCheck[] = [];
  const add = (key: ExpectationKey, passed: boolean): void => {
    checks.push({ key, passed, critical: expect.critical.includes(key) });
  };
  if (expect.decision) add('decision', expect.decision.includes(answer.decision));
  if (expect.authority) add('authority', expect.authority.includes(answer.authority));
  if (expect.evidence) add('evidence', expect.evidence.includes(answer.evidence));
  if (expect.confidence) add('confidence', expect.confidence.includes(answer.confidence));
  if (expect.reversible !== undefined) add('reversible', answer.reversible === expect.reversible);
  if (expect.founderDecisionNeeded !== undefined) add('founderDecisionNeeded', answer.founderDecisionNeeded === expect.founderDecisionNeeded);
  if (expect.maxSpendMicros !== undefined) add('maxSpendMicros', answer.spendMicros <= expect.maxSpendMicros);
  if (expect.arabicBody !== undefined) add('arabicBody', isArabicBody(answer.body) === expect.arabicBody);
  if (expect.minBodyChars !== undefined) add('minBodyChars', answer.body.trim().length >= expect.minBodyChars);
  if (expect.forbidden) {
    const lower = answer.body.toLowerCase();
    add('forbidden', !expect.forbidden.some((f) => lower.includes(f)));
  }
  const passedCount = checks.filter((c) => c.passed).length;
  const scorePct = checks.length === 0 ? 0 : Math.floor((passedCount * 100) / checks.length);
  const criticalPassed = checks.every((c) => !c.critical || c.passed);
  return { checks, scorePct, criticalPassed, passed: criticalPassed && scorePct >= passPct };
}

export type BenchmarkArm = 'WITH_SKILL' | 'BASELINE';
export const BENCHMARK_ARMS: readonly BenchmarkArm[] = ['WITH_SKILL', 'BASELINE'];

export interface BenchmarkVerdict {
  /** Every with-skill case passed. */
  readonly benchmarkPassed: boolean;
  /** The with-skill arm is not worse than the baseline (the COMPARE step). */
  readonly comparePassed: boolean;
  readonly withPct: number;
  readonly baselinePct: number;
  readonly reason: 'PASSED' | 'WITH_SKILL_CASE_FAILED' | 'WORSE_THAN_BASELINE' | 'INCOMPLETE';
}

/**
 * The verdict of one Skill version's bounded behavioural benchmark from its scored runs. INCOMPLETE when any case of
 * either arm has no scored answer (a void run never counts as a pass).
 */
export function benchmarkVerdict(cases: readonly string[], scored: readonly { readonly caseCode: string; readonly arm: BenchmarkArm; readonly result: RubricResult | null }[]): BenchmarkVerdict {
  const of = (arm: BenchmarkArm): (RubricResult | null)[] => cases.map((c) => scored.find((s) => s.caseCode === c && s.arm === arm)?.result ?? null);
  const withR = of('WITH_SKILL');
  const baseR = of('BASELINE');
  const mean = (rs: (RubricResult | null)[]): number => (rs.length === 0 ? 0 : Math.floor(rs.reduce((n, r) => n + (r?.scorePct ?? 0), 0) / rs.length));
  const withPct = mean(withR);
  const baselinePct = mean(baseR);
  if (withR.some((r) => r === null) || baseR.some((r) => r === null)) return { benchmarkPassed: false, comparePassed: false, withPct, baselinePct, reason: 'INCOMPLETE' };
  const benchmarkPassed = withR.every((r) => r?.passed === true);
  const comparePassed = withPct >= baselinePct;
  return { benchmarkPassed, comparePassed, withPct, baselinePct, reason: !benchmarkPassed ? 'WITH_SKILL_CASE_FAILED' : !comparePassed ? 'WORSE_THAN_BASELINE' : 'PASSED' };
}

// --- The static security review -------------------------------------------------------------------------------------

export const STATIC_SECURITY_REVIEWER = 'system:static-security-review/v1';

export const STATIC_SECURITY_CHECKS = ['CONTENT_MATCHES_PACKAGE', 'NO_INSPECTION_FINDINGS', 'NO_DIRECTIVES', 'QANDEEL_OWNED_LICENSE', 'NO_DEPENDENCIES', 'NO_REQUESTED_TOOLS', 'NATIVE_TEXT_ONLY', 'NO_EXTERNAL_LINKS', 'WITHIN_SIZE'] as const;
export type StaticSecurityCheck = (typeof STATIC_SECURITY_CHECKS)[number];

export interface StaticSecurityReport {
  readonly reviewer: typeof STATIC_SECURITY_REVIEWER;
  readonly scope: 'TEXT_ONLY_NATIVE_SKILL';
  readonly checks: readonly { readonly check: StaticSecurityCheck; readonly passed: boolean }[];
  readonly passed: boolean;
}

const EXTERNAL_LINK = /\b(?:https?|ftp|file|data|javascript):|\bwww\.[a-z0-9-]+\./i;

/**
 * The deterministic static security review of a QANDEEL-native, text-only Skill version (D-L1-13). It is honest about
 * its scope: a text-only skill has no scripts, assets, dependencies or tools, so its attack surface is its text (prompt
 * injection, authority claims, secrets, executable content, external fetch targets) and the registered metadata. It is
 * NOT an independent human review and never claims to be one; any failed check fails the review.
 */
export function staticSecurityReview(skill: PackageSkill, registered: { readonly instructions: string; readonly instructionsSha256: string; readonly skillType: string; readonly licenseStatus: string; readonly directives: Readonly<Record<string, string>>; readonly dependencies: readonly unknown[]; readonly requestedTools: readonly unknown[] }): StaticSecurityReport {
  const pass: Record<StaticSecurityCheck, boolean> = {
    CONTENT_MATCHES_PACKAGE: registered.instructions === skill.instructions && sha256Hex(registered.instructions) === registered.instructionsSha256,
    NO_INSPECTION_FINDINGS: inspectSkillPayload(registered.instructions, registered.directives).length === 0,
    NO_DIRECTIVES: Object.keys(registered.directives).length === 0,
    QANDEEL_OWNED_LICENSE: registered.licenseStatus === 'QANDEEL_OWNED',
    NO_DEPENDENCIES: registered.dependencies.length === 0,
    NO_REQUESTED_TOOLS: registered.requestedTools.length === 0,
    NATIVE_TEXT_ONLY: registered.skillType === 'QANDEEL_NATIVE',
    NO_EXTERNAL_LINKS: !EXTERNAL_LINK.test(registered.instructions),
    WITHIN_SIZE: registered.instructions.length <= SKILL_INSTRUCTIONS_MAX,
  };
  const checks = STATIC_SECURITY_CHECKS.map((check) => ({ check, passed: pass[check] }));
  return { reviewer: STATIC_SECURITY_REVIEWER, scope: 'TEXT_ONLY_NATIVE_SKILL', checks, passed: checks.every((c) => c.passed) };
}
