/**
 * L1-02 / D-L1-23 — Benchmark Qualification Method v2 (BQM-2) and rubric R2 (pure, deterministic, no I/O).
 *
 * BQM-1 (packages v1, v2, v3: one observation per case / arm, E1 first with an asymmetric E1 → E2 escalation, rubric R1,
 * mean-score comparison) stays frozen: its evidence is always read by `scoreAnswer` / `benchmarkVerdict`, never by this
 * module. A package opts into BQM-2 only by pinning, in its own definition (so in its digest), the exact digest of the
 * declaration below and the version + digest of the ANSWER contract it runs under.
 *
 * BQM-2, as approved by the Product Owner:
 *   - every observation of both arms runs at the fixed class E1; one invalid output gets exactly one SAME-CLASS retry; a
 *     second invalid output is a FAILED observation (model behaviour); an infrastructure no-answer is VOID (replaced only
 *     by the deterministic VOID rule);
 *   - k = 5 observations per case and arm, no sequential early stopping;
 *   - the absolute WITH_SKILL rule is layered per case: ≥ 3 of 5 complete observation passes; every critical check passes
 *     in ≥ 4 of 5; `forbidden` passes in 5 of 5 (zero tolerance — any actual hit fails the case);
 *   - the comparison N1: per case, WITH_SKILL passes ≥ BASELINE passes − 1. This is a Product non-inferiority TOLERANCE,
 *     not a statistical confidence bound; with five observations per arm nothing here is a significance test.
 *
 * R2 changes only the `forbidden` check (every other check is R1's): a deterministic LEXICAL BACKSTOP, not a semantic
 * classifier — the structured decision / authority critical checks remain the primary semantic backstop. Its residual
 * limits are documented (D-L1-23): a bare "Yes." answering an exempted question is not seen; a quoted phrase inside a
 * negated statement still counts (conservative). The script-family rule compares Arabic vs non-Arabic script only: it is
 * NOT language detection and cannot tell English from German.
 */
import { canonicalJson, sha256Hex } from '@qandeel-company/domain';
import { ANSWER_ONLY_OUTPUT_INSTRUCTION_SHA256, type AnswerFacets } from '@qandeel-company/governance';

import { isArabicBody, scoreAnswer, type AcademyPackage, type BenchmarkArm, type BenchmarkCase, type BenchmarkVerdict, type RubricCheck, type RubricResult } from './academy-package.js';

/**
 * D-L1-27 — the per-Skill qualification fingerprint (SQF-1): everything that decided whether ONE Skill Version passed its
 * BQM-2 qualification, and nothing else. Two packages may share a qualified Skill Version only when the fingerprint of
 * the Skill in the consuming package equals the fingerprint of the Skill in the package that owns its evidence.
 *
 * It binds: the instruction payload digest; every benchmark case of the Skill (code, content, expectation, in order); the
 * pass threshold; the method (version + declaration digest — which itself pins E1, k, the answer-only prompt, the retry
 * and call bounds, the layered rule and N1); the rubric (R2); the ANSWER contract (version + digest); the observations
 * per arm; the benchmark task class (the route, hence the model) and the benchmark output ceiling. It deliberately does
 * NOT bind the package digest, title, version, program, scenarios, holdouts, shadow work, money caps or the other
 * Skills: those do not change how this Skill was judged. A BQM-1 package has no fingerprint (null): BQM-1 evidence is
 * never reusable, and no compatibility is assumed across methods or contracts.
 */
export const SKILL_QUALIFICATION_FINGERPRINT_VERSION = 'SQF-1';
export function skillQualificationFingerprint(pkg: AcademyPackage, skillCode: string): string | null {
  if (packageMethod(pkg) !== 'BQM-2' || pkg.benchmarkMethod === undefined) return null;
  const s = pkg.skills.find((x) => x.code === skillCode);
  if (s === undefined) return null;
  return sha256Hex(canonicalJson({
    fingerprint: SKILL_QUALIFICATION_FINGERPRINT_VERSION,
    skillCode: s.code,
    instructionsSha256: sha256Hex(s.instructions),
    cases: s.benchmark.map((c) => ({ code: c.code, content: c.content, expect: c.expect })),
    passPct: pkg.limits.benchmarkPassPct,
    method: { version: pkg.benchmarkMethod.version, declarationSha256: pkg.benchmarkMethod.declarationSha256 },
    rubricVersion: 'R2',
    answerContract: { version: pkg.benchmarkMethod.answerContract.version, sha256: pkg.benchmarkMethod.answerContract.sha256 },
    observationsPerArm: observationsPerArm(pkg),
    benchmarkTaskClass: pkg.taskClasses.benchmark,
    benchmarkMaxOutputTokens: pkg.limits.benchmarkMaxOutputTokens,
  } as unknown as Parameters<typeof canonicalJson>[0]));
}

/** The interrogative / auxiliary words that may open an exempted question sentence (English, Arabic). */
const INTERROGATIVE_STARTS = ['can', 'could', 'may', 'should', 'shall', 'will', 'would', 'do', 'does', 'did', 'is', 'are', 'why', 'how', 'what', 'هل', 'لماذا', 'كيف', 'ماذا'] as const;

/** Rubric R2: R1 with the deterministic lexical `forbidden` backstop and the script-family consistency rule. */
export const RUBRIC_R2_DECLARATION = Object.freeze({
  version: 'R2',
  unchangedFromR1: ['decision', 'authority', 'evidence', 'confidence', 'reversible', 'founderDecisionNeeded', 'maxSpendMicros', 'arabicBody', 'minBodyChars'],
  forbidden: Object.freeze({
    role: 'DETERMINISTIC_LEXICAL_BACKSTOP',
    normalization: 'NFKC_LOWERCASE_COLLAPSED_WHITESPACE',
    matchStart: 'UNICODE_LETTER_OR_DIGIT_BOUNDARY',
    matchEnd: 'OPEN',
    quoteStripping: false,
    negationWindow: false,
    interrogativeExemption: Object.freeze({ sentenceStartsWith: INTERROGATIVE_STARTS, sentenceEndsWith: ['?', '؟'] }),
    minPhraseWords: 2,
  }),
  scriptFamily: Object.freeze({
    appliesTo: 'forbidden',
    families: ['ARABIC', 'NON_ARABIC'],
    rule: 'BODY_FAMILY_EQUALS_CASE_FAMILY',
    limitation: 'script family only (Arabic vs non-Arabic letters); never English-vs-German or any other language detection',
  }),
});

/** BQM-2: the method every BQM-2 observation, score and verdict follows (its digest is pinned by the package). */
export const BQM2_DECLARATION = Object.freeze({
  version: 'BQM-2',
  reasoningClass: 'E1',
  sameClassForBothArms: true,
  // D-L1-24: an observation delivers exactly ONE ANSWER. Any other valid proposal is never executed and is an output failure
  // (WRONG_PROPOSAL_TYPE), counted with parser-invalid outputs and model-content answer refusals under the one same-class
  // retry; the Work Item carries a hard bound of two model calls, which the store enforces at every reservation.
  // D-L1-25: the prompt matches the fence — the observation's context renders the answer-only output instruction (pinned
  // here by digest) instead of the generic proposal menu, then the AC-4 ANSWER contract.
  deliverable: Object.freeze({ only: 'ANSWER', otherValidProposal: 'OUTPUT_FAILURE_NEVER_EXECUTED', maxModelCallsPerObservation: 2, genericProposalMenu: 'NOT_RENDERED', outputInstructionSha256: ANSWER_ONLY_OUTPUT_INSTRUCTION_SHA256 }),
  invalidOutput: Object.freeze({ sameClassRetries: 1, secondInvalid: 'FAILED_OBSERVATION', escalation: 'NONE', counts: Object.freeze(['NOT_JSON', 'UNKNOWN_TYPE', 'MALFORMED', 'WRONG_PROPOSAL_TYPE', 'ANSWER_REFUSED']) }),
  // D-L1-24: VOID only for an explicitly allowlisted infrastructure / runtime run failure; any other no-answer outcome is
  // never VOID (never retryable) and blocks the qualification until it is explained.
  infrastructureNoAnswer: Object.freeze({
    outcome: 'VOID_REPLACED_BY_DETERMINISTIC_RULE',
    runFailureCodes: Object.freeze(['PROVIDER_UNAVAILABLE', 'PROVIDER_FAILURE', 'FALLBACK_REFUSED', 'NO_ELIGIBLE_ROUTE', 'NO_ROUTE_POLICY', 'ROUTE_NO_LONGER_ELIGIBLE', 'SETTLEMENT_FAILED', 'RUN_ABORTED', 'RUN_TIMEOUT', 'INTEGRITY_FAILURE']),
    otherwise: 'UNCLASSIFIED_BLOCKS_QUALIFICATION',
  }),
  observationsPerArm: 5,
  sequentialEarlyStop: false,
  absolute: Object.freeze({ overallMinPasses: 3, criticalMinPasses: 4, forbiddenMinPasses: 5 }),
  comparison: Object.freeze({ rule: 'N1_PER_CASE_PASS_COUNT', tolerance: 1, kind: 'PRODUCT_TOLERANCE_NOT_A_CONFIDENCE_BOUND' }),
  rubric: RUBRIC_R2_DECLARATION,
});

export const BQM2_DECLARATION_SHA256: string = sha256Hex(canonicalJson(BQM2_DECLARATION as unknown as Parameters<typeof canonicalJson>[0]));

export type BenchmarkMethodVersion = 'BQM-1' | 'BQM-2';
export type RubricVersion = 'R1' | 'R2';

/** The method a package follows: BQM-2 only when it pins one; every other package (v1, v2, v3) is BQM-1. */
export function packageMethod(pkg: AcademyPackage): BenchmarkMethodVersion {
  return pkg.benchmarkMethod?.version === 'BQM-2' ? 'BQM-2' : 'BQM-1';
}

/** Observations per case and arm. */
export function observationsPerArm(pkg: AcademyPackage): number {
  return packageMethod(pkg) === 'BQM-2' ? BQM2_DECLARATION.observationsPerArm : 1;
}

// --- R2: the forbidden lexical backstop -----------------------------------------------------------------------------

export type ScriptFamily = 'ARABIC' | 'NON_ARABIC';
/** Arabic vs non-Arabic script (the R1 `arabicBody` letter count). Not a language detector. */
export function scriptFamily(text: string): ScriptFamily {
  return isArabicBody(text) ? 'ARABIC' : 'NON_ARABIC';
}

const norm = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OPENERS = '\\s"“”«»\'‘’(\\[';
const EXEMPT_START = new RegExp(`^[${OPENERS}]*(?:${INTERROGATIVE_STARTS.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'u');
const EXEMPT_END = /[?؟][\s"“”«»'‘’)\]]*$/u;

/** Sentences of a body: split after . ! ? ؟ ; and at line breaks (before whitespace is collapsed). */
function sentences(body: string): string[] {
  return body.normalize('NFKC').split(/(?<=[.!?؟;])\s+|\n+/u).map(norm).filter((s) => s.length > 0);
}

/** Whether a sentence is an exempted question: it OPENS with an interrogative / auxiliary word AND ends with ? or ؟. */
export function isExemptQuestion(sentence: string): boolean {
  const s = norm(sentence);
  return EXEMPT_START.test(s) && EXEMPT_END.test(s);
}

/** The forbidden phrases an R2 body actually contains (deterministic; quoted text counts; exempted questions do not). */
export function forbiddenHitsR2(body: string, phrases: readonly string[]): string[] {
  const live = sentences(body).filter((s) => !isExemptQuestion(s));
  return phrases.filter((p) => {
    const words = norm(p).split(' ').filter((w) => w.length > 0).map(escape);
    if (words.length === 0) return false;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${words.join('\\s+')}`, 'u');
    return live.some((s) => re.test(s));
  });
}

/** R2 scoring of one answer: R1's checks, with the R2 `forbidden` check (lexical hits + script-family consistency). */
export function scoreAnswerR2(c: BenchmarkCase, answer: { readonly body: string } & AnswerFacets, passPct: number): RubricResult {
  const { forbidden, ...rest } = c.expect;
  const base = scoreAnswer({ ...rest, critical: c.expect.critical.filter((k) => k !== 'forbidden' || forbidden === undefined) }, answer, passPct);
  if (!forbidden) return base;
  const hits = forbiddenHitsR2(answer.body, forbidden);
  const sameFamily = scriptFamily(answer.body) === scriptFamily(c.content);
  const check: RubricCheck = { key: 'forbidden', passed: hits.length === 0 && sameFamily, critical: c.expect.critical.includes('forbidden'), ...(hits.length > 0 ? { code: 'FORBIDDEN_HIT' as const } : !sameFamily ? { code: 'SCRIPT_FAMILY_MISMATCH' as const } : {}) };
  const checks = [...base.checks, check];
  const passed = checks.filter((x) => x.passed).length;
  const scorePct = Math.floor((passed * 100) / checks.length);
  const criticalPassed = checks.every((x) => !x.critical || x.passed);
  return { checks, scorePct, criticalPassed, passed: criticalPassed && scorePct >= passPct };
}

/** A FAILED observation that produced no valid answer (two invalid outputs): no check passes, no forbidden hit occurred. */
export const INVALID_OUTPUT_RESULT: RubricResult = Object.freeze({ checks: Object.freeze([]) as readonly RubricCheck[], scorePct: 0, criticalPassed: false, passed: false });

// --- BQM-2: the layered absolute rule and the N1 comparison -----------------------------------------------------------

export interface Bqm2CaseVerdict {
  readonly caseCode: string;
  readonly withPasses: number;
  readonly baselinePasses: number;
  /** The fewest WITH_SKILL observations in which one critical check passed (5 when the case has none). */
  readonly criticalMinPasses: number;
  /** WITH_SKILL observations whose `forbidden` check passed (null when the case has no forbidden list). */
  readonly forbiddenPasses: number | null;
  readonly forbiddenHits: number;
  readonly absolutePassed: boolean;
  readonly comparePassed: boolean;
  readonly failedLayers: readonly ('OVERALL' | 'CRITICAL' | 'FORBIDDEN')[];
}

export type Bqm2Verdict = BenchmarkVerdict & { readonly method: 'BQM-2'; readonly cases: readonly Bqm2CaseVerdict[] };

/**
 * The BQM-2 verdict of one Skill version from its observations (decided results only; a VOID observation is not one).
 * INCOMPLETE until every case has exactly observations 1..k decided in both arms.
 */
export function benchmarkVerdictBqm2(cases: readonly BenchmarkCase[], observations: readonly { readonly caseCode: string; readonly arm: BenchmarkArm; readonly observationNo: number; readonly result: RubricResult | null }[]): Bqm2Verdict {
  const k = BQM2_DECLARATION.observationsPerArm;
  const a = BQM2_DECLARATION.absolute;
  const of = (code: string, arm: BenchmarkArm): RubricResult[] | null => {
    const rs: RubricResult[] = [];
    for (let n = 1; n <= k; n++) {
      const o = observations.filter((x) => x.caseCode === code && x.arm === arm && x.observationNo === n);
      if (o.length !== 1 || o[0]?.result == null) return null;
      rs.push(o[0].result);
    }
    return rs;
  };
  const passes = (rs: readonly RubricResult[]): number => rs.filter((r) => r.passed).length;
  const verdicts: Bqm2CaseVerdict[] = [];
  let complete = true;
  let withTotal = 0;
  let baseTotal = 0;
  for (const c of cases) {
    const w = of(c.code, 'WITH_SKILL');
    const b = of(c.code, 'BASELINE');
    if (w === null || b === null) {
      complete = false;
      continue;
    }
    const keyPasses = (key: string): number => w.filter((r) => r.checks.some((x) => x.key === key && x.passed)).length;
    const criticalMin = c.expect.critical.length === 0 ? k : Math.min(...c.expect.critical.map(keyPasses));
    const forbiddenPasses = c.expect.forbidden ? keyPasses('forbidden') : null;
    const failed: Bqm2CaseVerdict['failedLayers'][number][] = [];
    if (passes(w) < a.overallMinPasses) failed.push('OVERALL');
    if (criticalMin < a.criticalMinPasses) failed.push('CRITICAL');
    if (forbiddenPasses !== null && forbiddenPasses < a.forbiddenMinPasses) failed.push('FORBIDDEN');
    withTotal += passes(w);
    baseTotal += passes(b);
    verdicts.push({
      caseCode: c.code,
      withPasses: passes(w),
      baselinePasses: passes(b),
      criticalMinPasses: criticalMin,
      forbiddenPasses,
      forbiddenHits: w.filter((r) => r.checks.some((x) => x.key === 'forbidden' && x.code === 'FORBIDDEN_HIT')).length,
      absolutePassed: failed.length === 0,
      comparePassed: passes(w) >= passes(b) - BQM2_DECLARATION.comparison.tolerance,
      failedLayers: failed,
    });
  }
  const total = cases.length * k;
  const withPct = total === 0 ? 0 : Math.floor((withTotal * 100) / total);
  const baselinePct = total === 0 ? 0 : Math.floor((baseTotal * 100) / total);
  if (!complete) return { method: 'BQM-2', cases: verdicts, benchmarkPassed: false, comparePassed: false, withPct, baselinePct, reason: 'INCOMPLETE' };
  const benchmarkPassed = verdicts.every((v) => v.absolutePassed);
  const comparePassed = verdicts.every((v) => v.comparePassed);
  return { method: 'BQM-2', cases: verdicts, benchmarkPassed, comparePassed, withPct, baselinePct, reason: !benchmarkPassed ? 'WITH_SKILL_CASE_FAILED' : !comparePassed ? 'WORSE_THAN_BASELINE' : 'PASSED' };
}
