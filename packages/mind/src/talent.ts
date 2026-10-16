/**
 * COMPANY-TALENT-01 — the Talent Catalog contract: Employee identity profiles and specialty competencies as versioned
 * Company data (pure, deterministic, no I/O).
 *
 * An identity profile is presentation and behavioural-design content of ONE Employee (Stage 4 §2, §5, §7): its
 * identity, personality, professional and communication style, specialties, market expertise, work behaviour, quality
 * standards and the things it never does, plus an optional designed pre-QANDEEL background that stays labelled as
 * designed (Stage 4 §3). It is authored in the Company's own surface, approved by the Founder and frozen by its digest;
 * the identity kernel the runtime renders is derived from it deterministically. It grants zero authority: role, seat,
 * Department, manager, lifecycle and authority references are read live from canonical state at every run, never
 * from the profile.
 */
import { QandeelError, canonicalJson, sha256Hex } from '@qandeel-company/domain';

import { ANSWER_CONTRACT_SHA256, ANSWER_CONTRACT_VERSION } from '@qandeel-company/governance';

import { BQM2_DECLARATION, BQM2_DECLARATION_SHA256 } from './benchmark-method.js';
import { inspectSkillPayload } from './skills.js';
import { containsSecretMaterial } from './text.js';

export const IDENTITY_KERNEL_MAX = 2_400;

export interface IdentitySpec {
  readonly roleRef: string;
  /** The proposed display name (presentation; the hire states the final name). */
  readonly name: { readonly given: string; readonly family: string; readonly ar: string | null } | null;
  readonly title: string;
  readonly roleSummary: string;
  readonly personality: readonly string[];
  readonly professionalStyle: string;
  readonly communicationStyle: string;
  readonly specialties: readonly string[];
  readonly marketExpertise: readonly string[];
  readonly workBehaviour: string;
  readonly qualityStandards: readonly string[];
  readonly boundaries: readonly string[];
  /** Stage 4 §3: an optional designed pre-QANDEEL background, never real QANDEEL history. */
  readonly designedBackground: string | null;
  /** Where the approved specification lives (e.g. `doc:docs/talent/...`). */
  readonly sourceRef: string;
}

const REF = /^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._:/#-]{1,160}$/;
const ROLE = /^role:[a-z][a-z0-9.-]{1,60}$/;
const LATIN_NAME = /^[A-Za-z][A-Za-z' -]{1,39}$/;
const ARABIC_NAME = /^[ء-ي٠-٩][ء-ي٠-٩ ]{1,59}$/;

/** The first missing or malformed field of a profile, as a stable code (the completeness gate). */
export type IdentityGap = { readonly field: string; readonly reason: string };

function textOk(v: unknown, max: number, min = 1): v is string {
  return typeof v === 'string' && v.trim().length >= min && v.length <= max;
}
function listOk(v: unknown, lo: number, hi: number, maxEach: number): v is string[] {
  return Array.isArray(v) && v.length >= lo && v.length <= hi && v.every((x) => textOk(x, maxEach));
}

/**
 * Every gap of a profile (empty = complete). Stage 4 §7 minimum content must be present: identity (title and role
 * summary), personality, professional style, communication style; plus specialties, work behaviour, quality standards
 * and boundaries. A profile whose kernel would exceed the context cap is incomplete (it must be condensed, never cut).
 */
export function identityGaps(v: unknown): IdentityGap[] {
  const gaps: IdentityGap[] = [];
  const gap = (field: string, reason: string): void => {
    gaps.push({ field, reason });
  };
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return [{ field: 'profile', reason: 'NOT_AN_OBJECT' }];
  const o = v as Record<string, unknown>;
  const known = ['roleRef', 'name', 'title', 'roleSummary', 'personality', 'professionalStyle', 'communicationStyle', 'specialties', 'marketExpertise', 'workBehaviour', 'qualityStandards', 'boundaries', 'designedBackground', 'sourceRef'];
  for (const k of Object.keys(o)) if (!known.includes(k)) gap(k, 'UNKNOWN_FIELD');
  if (typeof o.roleRef !== 'string' || !ROLE.test(o.roleRef)) gap('roleRef', 'ROLE_REF');
  if (o.name !== null && o.name !== undefined) {
    const n = o.name as Record<string, unknown>;
    if (typeof n !== 'object' || !LATIN_NAME.test(String(n.given ?? '')) || !LATIN_NAME.test(String(n.family ?? ''))) gap('name', 'NAME_SHAPE');
    else if (n.ar !== null && n.ar !== undefined && !ARABIC_NAME.test(String(n.ar))) gap('name.ar', 'NAME_SHAPE');
  }
  if (!textOk(o.title, 120)) gap('title', 'REQUIRED');
  if (!textOk(o.roleSummary, 600, 20)) gap('roleSummary', 'REQUIRED');
  if (!listOk(o.personality, 2, 8, 120)) gap('personality', 'TWO_TO_EIGHT_TRAITS');
  if (!textOk(o.professionalStyle, 600, 20)) gap('professionalStyle', 'REQUIRED');
  if (!textOk(o.communicationStyle, 600, 20)) gap('communicationStyle', 'REQUIRED');
  if (!listOk(o.specialties, 1, 12, 160)) gap('specialties', 'ONE_TO_TWELVE');
  if (o.marketExpertise !== undefined && !listOk(o.marketExpertise, 0, 12, 160)) gap('marketExpertise', 'AT_MOST_TWELVE');
  if (!textOk(o.workBehaviour, 800, 20)) gap('workBehaviour', 'REQUIRED');
  if (!listOk(o.qualityStandards, 1, 10, 240)) gap('qualityStandards', 'ONE_TO_TEN');
  if (!listOk(o.boundaries, 1, 10, 240)) gap('boundaries', 'ONE_TO_TEN');
  if (o.designedBackground !== null && o.designedBackground !== undefined && !textOk(o.designedBackground, 1_500)) gap('designedBackground', 'AT_MOST_1500');
  if (typeof o.sourceRef !== 'string' || !REF.test(o.sourceRef)) gap('sourceRef', 'SOURCE_REF');
  if (gaps.length > 0) return gaps;
  const all = identityTexts(o as unknown as IdentitySpec).join('\n');
  if (containsSecretMaterial(all)) gap('profile', 'SECRET_MATERIAL');
  // The same static inspection a Skill payload gets: no executable content and no claim of authority.
  for (const f of inspectSkillPayload(all, {})) if (f !== 'OVERSIZED') gap('profile', f);
  if (gaps.length === 0 && identityKernel(o as unknown as IdentitySpec).length > IDENTITY_KERNEL_MAX) gap('profile', 'KERNEL_TOO_LONG');
  return gaps;
}

function identityTexts(s: IdentitySpec): string[] {
  return [s.title, s.roleSummary, ...s.personality, s.professionalStyle, s.communicationStyle, ...s.specialties, ...(s.marketExpertise ?? []), s.workBehaviour, ...s.qualityStandards, ...s.boundaries, s.designedBackground ?? ''];
}

/** A complete profile, normalized (unknown or incomplete refuses with the first gap). */
export function assertIdentitySpec(v: unknown): IdentitySpec {
  const gaps = identityGaps(v);
  const first = gaps[0];
  if (first) throw new QandeelError('VALIDATION_FAILED', `the identity profile is incomplete: ${first.field} (${first.reason})`, { field: first.field, reason: `IDENTITY_${first.reason}`, gaps: gaps.length });
  const o = v as IdentitySpec;
  return {
    roleRef: o.roleRef,
    name: o.name ? { given: o.name.given.trim(), family: o.name.family.trim(), ar: o.name.ar ? o.name.ar.trim() : null } : null,
    title: o.title.trim(),
    roleSummary: o.roleSummary.trim(),
    personality: o.personality.map((x) => x.trim()),
    professionalStyle: o.professionalStyle.trim(),
    communicationStyle: o.communicationStyle.trim(),
    specialties: o.specialties.map((x) => x.trim()),
    marketExpertise: (o.marketExpertise ?? []).map((x) => x.trim()),
    workBehaviour: o.workBehaviour.trim(),
    qualityStandards: o.qualityStandards.map((x) => x.trim()),
    boundaries: o.boundaries.map((x) => x.trim()),
    designedBackground: o.designedBackground ? o.designedBackground.trim() : null,
    sourceRef: o.sourceRef,
  };
}

/** The canonical digest of a profile (what an approval freezes). */
export function identitySpecDigest(s: IdentitySpec): string {
  return sha256Hex(canonicalJson(assertIdentitySpec(s) as unknown as Parameters<typeof canonicalJson>[0]));
}

/**
 * The identity kernel rendered into the Employee's governed context, derived deterministically from the profile. It
 * never states role, seat, manager, lifecycle or authority (the runtime reads those live), and it always carries the
 * constructed-knowledge rule: never claim to be human, a real past employer or a biography as fact.
 */
export function identityKernel(s: IdentitySpec): string {
  const line = (label: string, v: string | readonly string[]): string => `${label}: ${Array.isArray(v) ? v.join('; ') : v}`;
  return [
    `You are ${s.title}. ${s.roleSummary}`,
    line('Personality', s.personality),
    line('Professional style', s.professionalStyle),
    line('Communication style', s.communicationStyle),
    line('Specialties', s.specialties),
    ...(s.marketExpertise.length > 0 ? [line('Market and domain expertise', s.marketExpertise)] : []),
    line('How you work', s.workBehaviour),
    line('Your quality standards', s.qualityStandards),
    line('You never', s.boundaries),
    ...(s.designedBackground ? [`Designed professional background (designed before QANDEEL, not real QANDEEL history or achievements; never present it as fact): ${s.designedBackground}`] : []),
    'Your experience is constructed knowledge (versioned QANDEEL knowledge, studied cases, simulations); never claim to be human, to have feelings, or that a designed background is a real employer, degree or achievement. Your title grants no authority.',
  ].join('\n');
}

// --- Starter templates (data the studio pre-fills; a template is never a definition until the Founder approves it) -----

/** An empty identity profile for a role (every field is the Founder's, or a proposing leader's, to write). */
export function identityTemplate(roleRef: string): IdentitySpec {
  return { roleRef, name: null, title: '', roleSummary: '', personality: [], professionalStyle: '', communicationStyle: '', specialties: [], marketExpertise: [], workBehaviour: '', qualityStandards: [], boundaries: [], designedBackground: null, sourceRef: 'doc:docs/talent' };
}

/**
 * A program skeleton for a role: the BQM-2 method pins of this build, the six Stage 6 §4 curriculum categories, the ten
 * dimensions with the four Stage 6 §6 critical ones critical, the probation criteria, the Academy task classes and bounded
 * limits. Skills, scenarios (practice / assessment / holdout) and shadow work are left for the author: until they exist
 * the skeleton fails `assertAcademyPackage` and cannot be submitted. A leadership role sets `founderCalibrationRequired`.
 */
export function programTemplate(input: { roleRef: string; code: string; title: string; leader: boolean }): Record<string, unknown> {
  const area = input.code.split('.').at(-1) ?? 'role';
  return {
    code: input.code,
    version: 1,
    title: input.title,
    roleRef: input.roleRef,
    sourceRefs: ['authority:stage-6', 'authority:stage-7'],
    skills: [],
    program: {
      curriculum: [
        { code: `${area}.qandeel-fundamentals`, category: 'QANDEEL_FUNDAMENTALS', sourceRefs: ['authority:baseline#1'] },
        { code: `${area}.founder-understanding`, category: 'FOUNDER_UNDERSTANDING', sourceRefs: ['authority:stage-4#7'] },
        { code: `${area}.role-mastery`, category: 'ROLE_MASTERY', sourceRefs: ['authority:stage-6#4'] },
        { code: `${area}.case-studies`, category: 'REAL_CASE_STUDIES', sourceRefs: ['authority:stage-4#4'] },
        { code: `${area}.market-intelligence`, category: 'MARKET_INTELLIGENCE', sourceRefs: ['authority:stage-10'] },
        { code: `${area}.company-operating-skills`, category: 'COMPANY_OPERATING_SKILLS', sourceRefs: ['authority:stage-8'] },
      ],
      dimensions: [
        { dimension: 'REASONING_QUALITY', critical: false, passPct: 65 },
        { dimension: 'CORRECTNESS', critical: false, passPct: 65 },
        { dimension: 'EVIDENCE_USE', critical: true, passPct: 70 },
        { dimension: 'QANDEEL_UNDERSTANDING', critical: false, passPct: 60 },
        { dimension: 'ROLE_MASTERY', critical: true, passPct: 70 },
        { dimension: 'AUTHORITY_COMPLIANCE', critical: true, passPct: 100 },
        { dimension: 'COST_DISCIPLINE', critical: true, passPct: 100 },
        { dimension: 'COLLABORATION', critical: false, passPct: 60 },
        { dimension: 'FOUNDER_COMMUNICATION', critical: input.leader, passPct: 65 },
        { dimension: 'LEARNING_FROM_FEEDBACK', critical: false, passPct: 60 },
      ],
      passAveragePct: 75,
      assessmentTrials: 2,
      holdoutRequired: true,
      founderCalibrationRequired: input.leader,
      maxRepeatedCriticalFailures: 2,
      certificationValidityDays: 180,
      probation: { minCases: 1, maxCriticalFailures: 0, requireDemonstratedLearning: true, requireCostDiscipline: true, requireCorrectEscalation: true, requireCollaboration: true },
      skillTargets: [],
    },
    scenarios: [],
    shadowAssignments: [],
    taskClasses: { benchmark: 'skill.benchmark', attempt: 'academy.attempt', shadow: 'academy.shadow' },
    limits: { benchmarkMaxOutputTokens: 1_536, attemptMaxOutputTokens: 2_048, shadowMaxOutputTokens: 3_072, benchmarkCapMicros: 40_000, attemptCapMicros: 60_000, benchmarkPassPct: 75 },
    benchmarkMethod: { version: BQM2_DECLARATION.version, declarationSha256: BQM2_DECLARATION_SHA256, answerContract: { version: ANSWER_CONTRACT_VERSION, sha256: ANSWER_CONTRACT_SHA256 } },
  };
}

/**
 * Specialty competency presets (COMPANY-TALENT-01 C). Platform algorithms change: a specialist proves the ability to
 * research, verify, experiment and keep current — never claimed knowledge of unpublished details. Tool operation (for
 * example editing a video) is a separate Tool scenario, assessed only when an integrated Tool exists.
 */
export const COMPETENCY_PRESETS: Readonly<Record<string, readonly { code: string; title: string; critical: boolean; passPct: number; retrain: string }[]>> = Object.freeze({
  'platform-growth': [
    { code: 'PLATFORM_RESEARCH', title: 'Researches the platform from current, citable sources (rules, formats, published guidance) and dates them', critical: true, passPct: 70, retrain: 'MARKET_INTELLIGENCE' },
    { code: 'SOURCE_VERIFICATION', title: 'Separates verified facts from rumours about the algorithm; never claims unpublished internals', critical: true, passPct: 75, retrain: 'COMPANY_OPERATING_SKILLS' },
    { code: 'OPPORTUNITY_DISCOVERY', title: 'Finds real growth opportunities (communities, formats, timing) grounded in evidence', critical: false, passPct: 65, retrain: 'ROLE_MASTERY' },
    { code: 'METRIC_INTERPRETATION', title: 'Reads platform metrics correctly (reach vs engagement vs conversion; sample size; noise)', critical: true, passPct: 70, retrain: 'ROLE_MASTERY' },
    { code: 'HYPOTHESIS_QUALITY', title: 'States testable hypotheses with a success metric, a baseline and a stop rule', critical: false, passPct: 65, retrain: 'REAL_CASE_STUDIES' },
    { code: 'EXPERIMENT_DESIGN', title: 'Designs small, cheap, reversible experiments within budget and authority', critical: false, passPct: 65, retrain: 'COMPANY_OPERATING_SKILLS' },
    { code: 'UPDATE_DISCIPLINE', title: 'Re-checks assumptions when the platform changes and says what it would re-test', critical: false, passPct: 60, retrain: 'MARKET_INTELLIGENCE' },
  ],
  'video-production': [
    { code: 'CREATIVE_BRIEF', title: 'Turns a goal into a clear short-form brief (hook, story, length, format per platform)', critical: true, passPct: 70, retrain: 'ROLE_MASTERY' },
    { code: 'EDIT_PLAN_QUALITY', title: 'Produces an edit plan (shot list, cuts, captions, pacing) that matches the brief', critical: true, passPct: 70, retrain: 'ROLE_MASTERY' },
    { code: 'QUALITY_REVIEW', title: 'Reviews a cut against brand, accessibility and platform specs; names concrete fixes', critical: false, passPct: 65, retrain: 'REAL_CASE_STUDIES' },
    { code: 'BRAND_FIT', title: 'Keeps the Brand & Creative voice; never makes claims the brand cannot support', critical: true, passPct: 75, retrain: 'COMPANY_OPERATING_SKILLS' },
    { code: 'RIGHTS_AND_LICENSING', title: 'Uses only cleared music, footage and fonts; flags anything unclear', critical: true, passPct: 80, retrain: 'COMPANY_OPERATING_SKILLS' },
  ],
});

/**
 * COMPANY-TALENT-01 (D4 / G9): how a leader turns an agreed staffing or development need into a structured proposal from its
 * own run — a conversation with the Founder included — so nothing is re-typed. Shown only to an Employee holding the
 * capability (listing grants nothing; the runtime decides every proposal again, and a proposal decides nothing).
 */
export const GRANTED_ORG_ACT_GUIDANCE: Readonly<Record<string, string>> = Object.freeze({
  'org.staffing.request':
    'Granted act: propose a staffing request (a proposal; the CEO reviews and the Founder decides). When the Founder or your manager agrees a hiring need, file it yourself before your reply: {"type":"ORG_ACTION","action":"staffing.request.create","args":{"departmentCode":"<your Department code, or null for the Company>","roleRef":"role:<code>","positionKind":"SPECIALIST|LEAD|MANAGER","positionTitle":"...","headcount":1,"businessNeed":"...","workloadEvidence":"...","skillGap":"...","expectedValue":"...","impactIfNotStaffed":"...","alternatives":{"redistributeWork":"...","improveSkillOrTraining":"...","automate":"...","temporarySpecialistOrCapability":"..."},"expectedCostMicros":0}}. State only evidence you have; it hires and spends nothing.',
  'org.talent.propose':
    'Granted act: propose development (a proposal; the Founder decides). {"type":"ORG_ACTION","action":"talent.propose","args":{"kind":"SKILL|RETRAIN|IDENTITY_PROFILE|ACADEMY_PROGRAM|DEPARTMENT_BUDGET","rationale":"...", "roleRef":"role:<code>", "subjectEmployeeId":"<for RETRAIN>", "skill":{...}, "definition":{...}, "capMoney":0}} — for your own Department (the CEO: the Company). It approves, grants, certifies and spends nothing.',
});
