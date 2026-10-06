/**
 * L1-02 — the structured-only activation intents of the governed Founder confirmation (D-L1-13).
 *
 * Each intent is validated against durable state at PREVIEW (a preview never offers a step the confirmation would
 * refuse) and executed at CONFIRM by the EXISTING canonical store — OrganizationStore.hire, GovernanceStore lifecycle /
 * budget / grant, the AcademyPackageStore (skill qualification and install), and AcademyStore's own Founder acts — inside
 * the one confirm transaction (R2-26). Nothing here creates authority: the hire is CANDIDATE, lifecycle steps never reach
 * ACTIVE (only `decideActivation` does), deterministic Academy steps stay system steps, and the model never scores itself.
 * Payloads carry IDs, codes and bounded numbers only (no prose, no answer text).
 */
import { QandeelError, assertCode, assertId, sha256Hex, type Id } from '@qandeel-company/domain';
import { assertTaskClass, isReasoningClass } from '@qandeel-company/governance';
import { ASSESSMENT_DIMENSIONS, BENCHMARK_ARMS, BQM2_DECLARATION, DETERMINISTIC_DIMENSIONS, academyPackageDigest, containsSecretMaterial, observationsPerArm, packageMethod, type AcademyPackage, type AssessmentDimension, type EmployeeIdentityProfile } from '@qandeel-company/mind';

import { AcademyStore, txAdvance, txCollectShadowEvidence, txEvaluateDeterministic } from './academy.js';
import { AcademyPackageStore, txPackageRecord, txPackageView } from './academy-packages.js';
import { txAnswerOf } from './answers.js';
import { benchmarkPinMismatch, pinsOfPackage } from './benchmark-pins.js';
import { budgetFor, getEmployeeRow } from './governance-core.js';
import { GovernanceStore } from './governance.js';
import { getWorkItemRow, type StoreContext } from './internal.js';
import { getPosition, seatHolder } from './org-core.js';
import { OrganizationStore } from './organization.js';
import { ts } from './internal.js';
import type { CompanyStore } from './store.js';

export type ActivationPayload = Record<string, string | number | boolean | null | readonly string[]>;

export interface ActivationEnv {
  readonly packages: readonly AcademyPackage[];
  readonly identities: readonly EmployeeIdentityProfile[];
}

const LATIN_NAME = /^[A-Za-z][A-Za-z' -]{1,39}$/;
const ARABIC_NAME = /^[ء-ي٠-٩][ء-ي٠-٩ ]{1,59}$/;
const TRAINEE_TARGETS = ['TRAINING', 'SHADOW', 'PROBATION'] as const;
const EVIDENCE_KINDS = ['QUALITY', 'DEMONSTRATED_LEARNING', 'COST_DISCIPLINE', 'CORRECT_ESCALATION', 'COLLABORATION'] as const;
const EVALUATOR_DIMENSIONS = ASSESSMENT_DIMENSIONS.filter((d) => !DETERMINISTIC_DIMENSIONS.includes(d));
const WORK_DONE = ['COMPLETED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'];

const refuse = (code: string, message: string, details: Record<string, string | number | boolean | null> = {}): never => {
  throw new QandeelError('VALIDATION_FAILED', message, { reason: code, ...details });
};
const transition = (message: string, reason: string, details: Record<string, string | number | boolean | null> = {}): never => {
  throw new QandeelError('INVALID_TRANSITION', message, { reason, ...details });
};
const strList = (raw: Record<string, unknown>, field: string, max: number): string[] => {
  const v = raw[field];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== 'string' || x.length === 0 || x.length > 96)) refuse('INVALID_LIST', `${field} is a list of at most ${max} codes`, { field });
  return [...new Set(v as string[])];
};

/** The registered package a payload names, with its digest re-checked (a typed package is never accepted). */
function packageOf(raw: Record<string, unknown>, env: ActivationEnv): { pkg: AcademyPackage; sha: string } {
  const code = assertCode(raw.packageCode, 'packageCode');
  const version = raw.packageVersion;
  const pkg = env.packages.find((p) => p.code === code && p.version === version);
  if (!pkg) return refuse('PACKAGE_UNKNOWN', 'unknown Academy package (packages are release-pinned and registered by the host, never typed)', { field: 'packageCode' });
  const sha = academyPackageDigest(pkg);
  if (raw.packageSha256 !== sha) refuse('PACKAGE_DIGEST_MISMATCH', 'the package digest does not match the registered package', { field: 'packageSha256' });
  return { pkg, sha };
}

const enrollmentOf = (ctx: StoreContext, id: unknown): { id: Id; employee_id: string; stage: string; program_version_id: string } => {
  const e = ctx.db.get<{ id: string; employee_id: string; stage: string; program_version_id: string }>('SELECT id, employee_id, stage, program_version_id FROM academy_enrollments WHERE id = ?', assertId(id, 'enrollmentId'));
  if (!e) throw new QandeelError('NOT_FOUND', 'enrollment not found', { enrollmentId: String(id).slice(0, 36) });
  return { ...e, id: e.id as Id };
};

/** Validates one activation intent's payload against durable state; returns the canonical payload. */
export function validateActivationPayload(ctx: StoreContext, intent: string, raw: Record<string, unknown>, env: ActivationEnv): ActivationPayload {
  switch (intent) {
    case 'EMPLOYEE_HIRE': {
      const pos = getPosition(ctx, assertId(raw.positionId, 'positionId'));
      if (pos.status !== 'ACTIVE') transition('only an ACTIVE seat is filled', 'SEAT_NOT_ACTIVE');
      if (seatHolder(ctx, pos.id, ts(ctx)).ofRecord !== null) transition('the seat is held', 'SEAT_OCCUPIED', { positionId: pos.id });
      const given = typeof raw.givenName === 'string' ? raw.givenName.trim() : '';
      const family = typeof raw.familyName === 'string' ? raw.familyName.trim() : '';
      // A display name is presentation only: letters, spaces, hyphens, apostrophes — it can carry no instruction.
      if (!LATIN_NAME.test(given) || !LATIN_NAME.test(family)) refuse('NAME_SHAPE', 'the name is two words of letters (2..40 each)', { field: 'givenName' });
      const ar = raw.displayNameAr === undefined || raw.displayNameAr === null ? null : String(raw.displayNameAr).trim();
      if (ar !== null && !ARABIC_NAME.test(ar)) refuse('NAME_SHAPE', 'the Arabic display name is Arabic letters and spaces', { field: 'displayNameAr' });
      if (ctx.db.get('SELECT 1 AS x FROM employees WHERE given_name = ? AND family_name = ?', given, family)) refuse('NAME_TAKEN', 'an Employee already has this name', { field: 'givenName' });
      const identityCode = raw.identityProfileCode === undefined || raw.identityProfileCode === null ? null : assertCode(raw.identityProfileCode, 'identityProfileCode');
      const identity = identityCode === null ? null : env.identities.find((i) => i.code === identityCode);
      if (identityCode !== null && !identity) refuse('IDENTITY_UNKNOWN', 'unknown identity profile (release-pinned, never typed)', { field: 'identityProfileCode' });
      if (identity && identity.roleRef !== pos.roleRef) refuse('IDENTITY_ROLE_MISMATCH', 'the identity profile belongs to another role', { field: 'identityProfileCode' });
      const defaultClass = raw.defaultClass ?? 'E1';
      const ceilingClass = raw.ceilingClass ?? 'E2';
      if (!isReasoningClass(defaultClass) || !isReasoningClass(ceilingClass) || !['E1', 'E2'].includes(defaultClass) || !['E1', 'E2'].includes(ceilingClass) || defaultClass > ceilingClass) refuse('COGNITIVE_PROFILE', 'the first activation uses a conservative E1 / E2 cognitive profile', { field: 'ceilingClass' });
      return { positionId: pos.id, positionCode: pos.code, positionTitle: pos.title.slice(0, 120), roleRef: pos.roleRef, givenName: given, familyName: family, displayNameAr: ar, identityProfileCode: identityCode, defaultClass: String(defaultClass), ceilingClass: String(ceilingClass), costDiscipline: 'BALANCED', startsAs: 'CANDIDATE', portraitAssetRef: null, reasonCode: assertCode(raw.reasonCode ?? 'founder.hired', 'reasonCode') };
    }
    case 'EMPLOYEE_LIFECYCLE': {
      const e = getEmployeeRow(ctx, assertId(raw.employeeId, 'employeeId'));
      const to = raw.to;
      // Activation is never a lifecycle step here: ACTIVE comes only from the Academy's activation decision.
      if (typeof to !== 'string' || !(TRAINEE_TARGETS as readonly string[]).includes(to)) refuse('LIFECYCLE_TARGET', 'the Founder moves a trainee to TRAINING, SHADOW or PROBATION (activation is the Academy\'s decision)', { field: 'to' });
      const allowed: Record<string, readonly string[]> = { CANDIDATE: ['TRAINING'], TRAINING: ['SHADOW', 'PROBATION'], SHADOW: ['PROBATION', 'TRAINING'], PROBATION: ['TRAINING'], RETRAINING: ['SHADOW', 'PROBATION'] };
      if (!(allowed[e.state] ?? []).includes(String(to))) transition('this lifecycle step is not allowed now', 'LIFECYCLE_STEP', { from: e.state, to: String(to) });
      return { employeeId: e.id, name: `${e.name.given} ${e.name.family}`, from: e.state, to: String(to), reasonCode: assertCode(raw.reasonCode ?? 'founder.lifecycle', 'reasonCode') };
    }
    case 'EMPLOYEE_MODEL_ACCESS': {
      const e = getEmployeeRow(ctx, assertId(raw.employeeId, 'employeeId'));
      if (e.state === 'RETIRED') transition('a retired Employee receives nothing', 'RETIRED');
      const classes = strList(raw, 'taskClasses', 8).map((c) => assertTaskClass(c));
      if (classes.length === 0) refuse('TASK_CLASSES', 'name the task classes this access covers', { field: 'taskClasses' });
      for (const c of classes) if (!ctx.db.get(`SELECT 1 AS x FROM route_policies WHERE task_class = ? AND status = 'ACTIVE'`, c)) refuse('NO_ROUTE_POLICY', 'every task class needs a provisioned route policy', { taskClass: c });
      const dataClass = raw.dataClassCeiling ?? 'D2';
      if (dataClass !== 'D1' && dataClass !== 'D2') refuse('DATA_CLASS', 'model access is D1 or D2 at most (D3 external egress is closed, D4 never leaves)', { field: 'dataClassCeiling' });
      const company = budgetFor(ctx, 'COMPANY', 'company');
      if (!company) transition('provision the provider (and its Company cap) first', 'COMPANY_BUDGET_MISSING');
      const existing = budgetFor(ctx, 'EMPLOYEE', e.id);
      const capMoney = raw.capMoney;
      if (existing === null && (typeof capMoney !== 'number' || !Number.isSafeInteger(capMoney) || capMoney <= 0 || capMoney > (company?.capMoney ?? 0))) refuse('CAP', 'the Employee envelope is a bounded positive amount within the Company cap', { field: 'capMoney' });
      const granted = new Set(ctx.db.all<{ s: string }>(`SELECT resource_scope AS s FROM permission_grants WHERE employee_id = ? AND capability = 'model.invoke' AND status = 'ACTIVE'`, e.id).map((r) => r.s));
      const missing = classes.filter((c) => !granted.has(c) && !granted.has('*'));
      if (existing !== null && missing.length === 0) transition('this access already exists', 'ACCESS_EXISTS');
      return { employeeId: e.id, name: `${e.name.given} ${e.name.family}`, currency: company?.currency ?? 'USD', envelopeExists: existing !== null, capMoney: existing?.capMoney ?? Number(capMoney), capTokens: existing?.capTokens ?? Math.max(1_000_000, Number(capMoney) * 2), taskClasses: missing, dataClassCeiling: String(dataClass), riskCeiling: 'R0', reasonCode: assertCode(raw.reasonCode ?? 'founder.model_access', 'reasonCode') };
    }
    case 'SKILL_PACKAGE_QUALIFY': {
      const { pkg, sha } = packageOf(raw, env);
      const subject = getEmployeeRow(ctx, assertId(raw.subjectEmployeeId, 'subjectEmployeeId'));
      if (subject.roleRef !== pkg.roleRef) refuse('ROLE_MISMATCH', 'the benchmark subject holds the package role');
      if (subject.state !== 'TRAINING') transition('the benchmark subject is a TRAINING Employee', 'SUBJECT_NOT_TRAINING', { state: subject.state });
      const rec = txPackageRecord(ctx, pkg);
      if (rec?.state === 'INSTALLED') transition('this package is already installed', 'PACKAGE_INSTALLED');
      // D-L1-23: a BQM-2 package is previewed only when this build runs exactly the method and ANSWER contract it pins.
      const pinMismatch = benchmarkPinMismatch(rec ? { method: rec.benchmarkMethod, methodSha256: rec.methodSha256, answerContractVersion: rec.answerContractVersion, answerContractSha256: rec.answerContractSha256 } : pinsOfPackage(pkg));
      if (pinMismatch !== null) refuse(pinMismatch, 'the package pins a benchmark method or ANSWER contract this build does not run');
      const view = txPackageView(ctx, pkg);
      const k = observationsPerArm(pkg);
      // D-L1-21 / D-L1-23: a sandboxed version's observation slot (case, arm, observation) needs a run when its live run
      // finished without an answer for an infrastructure reason (it becomes VOID) or it has no live run; a finished OPEN
      // run with a result (an answer, or under R2 two invalid outputs) is finalized to SCORED (never re-run).
      const voidCases = rec === null ? 0 : view.skills.filter((s) => s.pipelineState === 'SANDBOXED').reduce((n, s) => {
        const cases = pkg.skills.find((d) => d.code === s.code)?.benchmark ?? [];
        let slots = 0;
        for (const c of cases) for (const arm of BENCHMARK_ARMS) for (let o = 1; o <= k; o++) {
          const r = s.runs.find((x) => x.caseCode === c.code && x.arm === arm && x.observationNo === o);
          if (r === undefined || (r.result === null && WORK_DONE.includes(r.workItemState))) slots++;
        }
        return n + slots;
      }, 0);
      const toFinalize = rec === null ? 0 : view.skills.reduce((n, s) => n + s.runs.filter((r) => r.state === 'OPEN' && r.result !== null && WORK_DONE.includes(r.workItemState)).length, 0);
      if (rec !== null && view.benchmarkRunsOpen > 0) transition('the benchmark is still running', 'BENCHMARK_RUNNING', { open: view.benchmarkRunsOpen });
      if (rec !== null && voidCases === 0 && toFinalize === 0) transition('nothing to finalize or re-run: every benchmark case is scored', 'NOTHING_TO_REQUALIFY');
      const runs = rec === null ? pkg.skills.reduce((n, s) => n + s.benchmark.length * 2 * k, 0) : voidCases;
      const qualification = rec === null ? 'QUALIFY' : voidCases === 0 ? 'FINALIZE_SCORES' : 'REQUALIFY_VOID_RUNS';
      for (const c of [pkg.taskClasses.benchmark]) if (!ctx.db.get(`SELECT 1 AS x FROM permission_grants WHERE employee_id = ? AND capability = 'model.invoke' AND status = 'ACTIVE' AND resource_scope IN (?, '*')`, subject.id, c)) transition('the subject has no model access for the benchmark task class', 'NO_MODEL_ACCESS', { taskClass: c });
      if (!budgetFor(ctx, 'EMPLOYEE', subject.id)) transition('the subject has no Employee envelope', 'NO_ENVELOPE');
      // D-L1-23: a BQM-2 preview states its method, observation count and its ENFORCED cost bounds — the per-observation
      // Work Item cap (at most two model calls each), their product, and the Employee envelope, which is the hard stop
      // (exhausting it leaves the package incomplete, never overspent; no budget is ever raised here).
      const bqm2 = packageMethod(pkg) === 'BQM-2' ? {
        benchmarkMethod: 'BQM-2', methodSha256: pkg.benchmarkMethod?.declarationSha256 ?? '', rubricVersion: 'R2',
        answerContractVersion: pkg.benchmarkMethod?.answerContract.version ?? '', answerContractSha256: pkg.benchmarkMethod?.answerContract.sha256 ?? '',
        reasoningClass: BQM2_DECLARATION.reasoningClass, observationsPerArm: k, maxModelCallsPerObservation: 1 + BQM2_DECLARATION.invalidOutput.sameClassRetries,
        totalCapBoundMicros: runs * pkg.limits.benchmarkCapMicros,
      } : {};
      return { packageCode: pkg.code, packageVersion: pkg.version, packageSha256: sha, packageTitle: pkg.title.slice(0, 160), subjectEmployeeId: subject.id, qualification, skills: pkg.skills.map((s) => `${s.code} (${s.benchmark.length} cases)`), benchmarkRuns: runs, scoresToFinalize: toFinalize, paidProviderCalls: runs === 0 ? 'NONE' : 'BOUNDED_BY_CAPS', benchmarkTaskClass: pkg.taskClasses.benchmark, perRunCapMicros: pkg.limits.benchmarkCapMicros, envelopeRemainingMicros: (() => { const b = budgetFor(ctx, 'EMPLOYEE', subject.id); return b ? Math.max(0, b.capMoney - b.spentMoney - b.reservedMoney) : 0; })(), securityReview: 'STATIC_DETERMINISTIC (text-only native skills; not a human review)', ...bqm2, reasonCode: assertCode(raw.reasonCode ?? 'package.qualify', 'reasonCode') };
    }
    case 'ACADEMY_PACKAGE_INSTALL': {
      const { pkg, sha } = packageOf(raw, env);
      const view = txPackageView(ctx, pkg);
      if (!view.record) transition('the package has not been qualified', 'PACKAGE_NOT_QUALIFIED');
      if (view.record?.state === 'INSTALLED') transition('this package is already installed', 'PACKAGE_INSTALLED');
      if (view.benchmarkRunsOpen > 0 && view.skills.some((s) => s.verdict.reason === 'INCOMPLETE')) transition('the benchmark is still running', 'BENCHMARK_RUNNING', { open: view.benchmarkRunsOpen });
      if (!view.installable) refuse('PACKAGE_SKILLS_NOT_QUALIFIED', 'every package Skill version must qualify on its own security and benchmark evidence', { skills: view.skills.filter((s) => !(s.security?.passed && s.verdict.benchmarkPassed && s.verdict.comparePassed)).map((s) => `${s.code}:${s.verdict.reason}`).join(',').slice(0, 160) });
      const kinds = (k: string): number => pkg.scenarios.filter((s) => s.kind === k).length;
      return {
        packageCode: pkg.code, packageVersion: pkg.version, packageSha256: sha, packageTitle: pkg.title.slice(0, 160), roleRef: pkg.roleRef,
        skills: view.skills.map((s) => `${s.code}: security ${s.security?.passed ? 'PASSED' : 'FAILED'}, benchmark ${s.verdict.withPct}% vs baseline ${s.verdict.baselinePct}% → ${s.verdict.reason}`),
        benchmarkSpentMicros: view.spentMicros,
        founderCalibrationRequired: pkg.program.founderCalibrationRequired, assessmentTrials: pkg.program.assessmentTrials, holdoutRequired: pkg.program.holdoutRequired,
        scenarios: `${kinds('PRACTICE')} practice, ${kinds('ASSESSMENT')} assessment, ${kinds('HOLDOUT')} holdout`,
        recommendation: 'INSTALL (every Skill version qualified on its own evidence)',
        reasonCode: assertCode(raw.reasonCode ?? 'package.install', 'reasonCode'),
      };
    }
    case 'ACADEMY_ENROLL': {
      const { pkg, sha } = packageOf(raw, env);
      const rec = txPackageRecord(ctx, pkg);
      if (rec?.state !== 'INSTALLED') transition('the package is not installed', 'PACKAGE_NOT_INSTALLED');
      const e = getEmployeeRow(ctx, assertId(raw.employeeId, 'employeeId'));
      if (e.roleRef !== pkg.roleRef) refuse('ROLE_MISMATCH', 'the program is for another role');
      if (!['TRAINING', 'SHADOW', 'PROBATION', 'RETRAINING'].includes(e.state)) transition('this Employee cannot enroll now', 'NOT_ENROLLABLE', { state: e.state });
      if (ctx.db.get(`SELECT 1 AS x FROM academy_enrollments WHERE employee_id = ? AND program_version_id = ? AND stage NOT IN ('WITHDRAWN', 'BLOCKED', 'ACTIVATED')`, e.id, rec?.programVersionId ?? '')) transition('already enrolled in this program', 'ALREADY_ENROLLED');
      return { packageCode: pkg.code, packageVersion: pkg.version, packageSha256: sha, employeeId: e.id, name: `${e.name.given} ${e.name.family}`, roleRef: e.roleRef, passports: pkg.skills.length, founderCalibrationRequired: pkg.program.founderCalibrationRequired, reasonCode: assertCode(raw.reasonCode ?? 'academy.enrolled', 'reasonCode') };
    }
    case 'ACADEMY_MODULES_COMPLETE': {
      const en = enrollmentOf(ctx, raw.enrollmentId);
      if (en.stage !== 'LEARN' && en.stage !== 'CASE_STUDIES') transition('modules are recorded in LEARN / CASE_STUDIES', 'STAGE', { stage: en.stage });
      const def = JSON.parse(String(ctx.db.get<{ d: string }>('SELECT definition_json AS d FROM academy_program_versions WHERE id = ?', en.program_version_id)?.d ?? '{}')) as { curriculum?: { code: string; category: string }[] };
      const done = new Set(ctx.db.all<{ m: string }>('SELECT module_code AS m FROM academy_module_completions WHERE enrollment_id = ?', en.id).map((r) => r.m));
      const codes = strList(raw, 'moduleCodes', 16);
      if (codes.length === 0 || codes.some((c) => !(def.curriculum ?? []).some((m) => m.code === c) || done.has(c))) refuse('MODULES', 'name open modules of this program', { field: 'moduleCodes' });
      return { enrollmentId: en.id, stage: en.stage, moduleCodes: codes, evidence: 'pinned skill passports delivered in context (trainer acknowledgement)', reasonCode: assertCode(raw.reasonCode ?? 'academy.modules', 'reasonCode') };
    }
    case 'ACADEMY_ATTEMPT_START': {
      const { pkg, sha } = packageOf(raw, env);
      const en = enrollmentOf(ctx, raw.enrollmentId);
      const code = assertCode(raw.scenarioCode, 'scenarioCode');
      const sc = pkg.scenarios.find((s) => s.code === code);
      if (!sc) refuse('SCENARIO_UNKNOWN', 'scenario not in this package', { field: 'scenarioCode' });
      const kind = sc?.kind === 'PRACTICE' ? 'SIMULATION' : 'ASSESSMENT';
      const stages = kind === 'SIMULATION' ? ['SIMULATION', 'RETRY'] : ['ASSESSMENT'];
      if (!stages.includes(en.stage)) transition(`a ${kind} attempt needs stage ${stages.join('/')}`, 'STAGE', { stage: en.stage });
      if (ctx.db.get(`SELECT 1 AS x FROM academy_attempts WHERE enrollment_id = ? AND state = 'OPEN'`, en.id)) transition('one attempt at a time', 'ATTEMPT_OPEN');
      if (sc?.kind === 'HOLDOUT' && ctx.db.get(`SELECT 1 AS x FROM academy_scenario_exposures x JOIN academy_scenarios s ON s.id = x.scenario_id WHERE x.employee_id = ? AND s.code = ? AND s.program_version_id = ?`, en.employee_id, code, en.program_version_id)) refuse('HOLDOUT_ALREADY_EXPOSED', 'this holdout was already exposed; use a fresh holdout');
      return { packageCode: pkg.code, packageVersion: pkg.version, packageSha256: sha, enrollmentId: en.id, scenarioCode: code, scenarioKind: sc?.kind ?? '', attemptKind: kind, taskClass: pkg.taskClasses.attempt, capMicros: pkg.limits.attemptCapMicros, scenarioBudgetMicros: sc?.budgetMicros ?? 0, maxOutputTokens: pkg.limits.attemptMaxOutputTokens, reasonCode: assertCode(raw.reasonCode ?? 'academy.attempt', 'reasonCode') };
    }
    case 'ACADEMY_EVALUATE': {
      const attemptId = assertId(raw.attemptId, 'attemptId');
      const a = ctx.db.get<{ state: string; work_item_id: string; enrollment_id: string; kind: string }>('SELECT state, work_item_id, enrollment_id, kind FROM academy_attempts WHERE id = ?', attemptId);
      if (!a) throw new QandeelError('NOT_FOUND', 'attempt not found', { attemptId });
      if (a.state !== 'OPEN') transition('this attempt already has its outcome', 'ATTEMPT_DECIDED');
      const item = getWorkItemRow(ctx, a.work_item_id as Id);
      if (!WORK_DONE.includes(item.state)) transition('the attempt has not finished running', 'ATTEMPT_RUNNING', { state: item.state });
      const answer = txAnswerOf(ctx, item.id);
      const answered = answer !== null;
      const scores = strList(raw, 'scores', 10);
      if (!answer) {
        // No answer: nothing to score; the deterministic rubric closes the attempt (void, or failed on a refusal).
        if (scores.length > 0) refuse('NO_ANSWER', 'an attempt without an answer is not scored by an evaluator');
        return { attemptId, kind: a.kind, answered: false, scores: [], reasonCode: 'academy.void' };
      }
      const parsed = new Map<string, number>();
      for (const s of scores) {
        const [d, v] = s.split(':');
        const pct = Number(v);
        if (!d || !(EVALUATOR_DIMENSIONS as readonly string[]).includes(d) || !Number.isInteger(pct) || pct < 0 || pct > 100) refuse('SCORE_SHAPE', 'scores are "DIMENSION:0..100" for the evaluator dimensions (the deterministic ones are never typed)', { field: 'scores' });
        parsed.set(String(d), pct);
      }
      if (EVALUATOR_DIMENSIONS.some((d) => !parsed.has(d))) refuse('SCORES_INCOMPLETE', 'score every evaluator dimension', { field: 'scores' });
      return { attemptId, kind: a.kind, answered, answerRef: `work_answer:${answer.id}`, answerSha256: sha256Hex(answer.body), scores: EVALUATOR_DIMENSIONS.map((d) => `${d}:${parsed.get(d)}`), deterministic: 'AUTHORITY_COMPLIANCE, COST_DISCIPLINE from run facts', reasonCode: assertCode(raw.reasonCode ?? 'academy.evaluated', 'reasonCode') };
    }
    case 'ACADEMY_RETRAIN_COMPLETE': {
      const id = assertId(raw.remediationId, 'remediationId');
      const r = ctx.db.get<{ state: string; enrollment_id: string; categories_json: string }>('SELECT state, enrollment_id, categories_json FROM academy_remediations WHERE id = ?', id);
      if (!r) throw new QandeelError('NOT_FOUND', 'remediation not found', { remediationId: id });
      if (r.state !== 'DIAGNOSED' && r.state !== 'RETRAINING') transition('this remediation is not in retraining', 'REMEDIATION_STATE', { state: r.state });
      return { remediationId: id, enrollmentId: r.enrollment_id, categories: JSON.parse(r.categories_json) as string[], reasonCode: assertCode(raw.reasonCode ?? 'academy.retrained', 'reasonCode') };
    }
    case 'ACADEMY_SHADOW_ASSIGN': {
      const { pkg, sha } = packageOf(raw, env);
      const en = enrollmentOf(ctx, raw.enrollmentId);
      if (en.stage !== 'SHADOW_WORK') transition('shadow work is assigned at the SHADOW_WORK stage', 'STAGE', { stage: en.stage });
      const code = assertCode(raw.assignmentCode, 'assignmentCode');
      const a = pkg.shadowAssignments.find((x) => x.code === code);
      if (!a) refuse('ASSIGNMENT_UNKNOWN', 'shadow assignment not in this package');
      return { packageCode: pkg.code, packageVersion: pkg.version, packageSha256: sha, enrollmentId: en.id, assignmentCode: code, objective: a?.objective.slice(0, 200) ?? '', capMicros: a?.capMicros ?? 0, taskClass: pkg.taskClasses.shadow, externalEffect: 'NONE', reasonCode: assertCode(raw.reasonCode ?? 'academy.shadow', 'reasonCode') };
    }
    case 'ACADEMY_PROBATION_EVIDENCE': {
      const en = enrollmentOf(ctx, raw.enrollmentId);
      if (en.stage !== 'SHADOW_WORK' && en.stage !== 'PROBATION_REVIEW') transition('probation evidence is recorded during shadow work', 'STAGE', { stage: en.stage });
      const workItemId = assertId(raw.workItemId, 'workItemId');
      if (!ctx.db.get('SELECT 1 AS x FROM academy_shadow_assignments WHERE work_item_id = ? AND enrollment_id = ?', workItemId, en.id)) refuse('NOT_SHADOW_WORK', 'evidence refers to this enrollment\'s shadow work');
      if (!WORK_DONE.includes(getWorkItemRow(ctx, workItemId).state)) transition('the shadow work has not finished', 'SHADOW_RUNNING');
      const positive = strList(raw, 'positive', 5);
      const negative = strList(raw, 'negative', 5);
      if ([...positive, ...negative].some((k) => !(EVIDENCE_KINDS as readonly string[]).includes(k)) || positive.some((k) => negative.includes(k)) || positive.length + negative.length === 0) refuse('EVIDENCE_KINDS', `evidence kinds are ${EVIDENCE_KINDS.join(', ')} (each once, positive or negative)`);
      return { enrollmentId: en.id, workItemId, answered: txAnswerOf(ctx, workItemId) !== null, positive, negative, reasonCode: assertCode(raw.reasonCode ?? 'academy.probation_evidence', 'reasonCode') };
    }
    case 'ACADEMY_PROBATION_REVIEW': {
      const en = enrollmentOf(ctx, raw.enrollmentId);
      if (en.stage !== 'PROBATION_REVIEW') transition('no probation review is due', 'STAGE', { stage: en.stage });
      const decision = raw.decision;
      if (decision !== 'PASS' && decision !== 'FAIL' && decision !== 'EXTEND') refuse('DECISION', 'decision is PASS, FAIL or EXTEND', { field: 'decision' });
      return { enrollmentId: en.id, decision: String(decision), reasonCode: assertCode(raw.reasonCode ?? 'academy.probation_review', 'reasonCode') };
    }
    case 'ACADEMY_CALIBRATION': {
      const en = enrollmentOf(ctx, raw.enrollmentId);
      const c = ctx.db.get<{ state: string }>('SELECT state FROM founder_calibrations WHERE enrollment_id = ?', en.id);
      if (!c) transition('this program has no Founder Calibration', 'NO_CALIBRATION');
      if (c?.state !== 'PENDING') transition('the calibration is already decided', 'CALIBRATION_DECIDED');
      const decision = raw.decision;
      if (decision !== 'APPROVE' && decision !== 'REJECT') refuse('DECISION', 'decision is APPROVE or REJECT', { field: 'decision' });
      const refs = strList(raw, 'evidenceRefs', 16);
      if (refs.some((r) => !/^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._:-]{1,95}$/.test(r))) refuse('EVIDENCE_REFS', 'evidence refs are kind:id references');
      if (decision === 'APPROVE' && refs.length === 0) refuse('EVIDENCE_REFS', 'an approval names the evidence it rests on');
      return { enrollmentId: en.id, employeeId: en.employee_id, decision: String(decision), evidenceRefs: refs, reasonCode: assertCode(raw.reasonCode ?? 'academy.calibration', 'reasonCode') };
    }
    case 'ACTIVATION_DECIDE': {
      const requestId = assertId(raw.requestId, 'requestId');
      const r = ctx.db.get<{ state: string; employee_id: string; enrollment_id: string; certification_id: string }>('SELECT state, employee_id, enrollment_id, certification_id FROM activation_requests WHERE id = ?', requestId);
      if (!r) throw new QandeelError('NOT_FOUND', 'activation request not found', { requestId });
      if (r.state !== 'PENDING_APPROVAL') transition('only a pending activation request is decided', 'REQUEST_NOT_PENDING', { state: r.state });
      const decision = raw.decision;
      if (decision !== 'APPROVE' && decision !== 'REJECT') refuse('DECISION', 'decision is APPROVE or REJECT', { field: 'decision' });
      const e = getEmployeeRow(ctx, r.employee_id as Id);
      if (decision === 'APPROVE' && e.state !== 'SHADOW' && e.state !== 'PROBATION') transition('activation applies to an Employee in SHADOW or PROBATION (move the trainee first)', 'LIFECYCLE_NOT_PROBATION', { state: e.state });
      const cal = ctx.db.get<{ state: string }>('SELECT state FROM founder_calibrations WHERE enrollment_id = ?', r.enrollment_id);
      if (decision === 'APPROVE' && cal && cal.state !== 'APPROVED') transition('activation of this role needs an approved Founder Calibration', `CALIBRATION_${cal.state}`);
      return { requestId, employeeId: e.id, name: `${e.name.given} ${e.name.family}`, roleRef: e.roleRef, from: e.state, decision: String(decision), certificationId: r.certification_id, calibration: cal?.state ?? 'NOT_REQUIRED', reasonCode: assertCode(raw.reasonCode ?? 'founder.activation', 'reasonCode') };
    }
    default:
      return refuse('UNKNOWN_INTENT', 'unknown activation intent', { field: 'intent' });
  }
}

/** Executes one confirmed activation intent at its canonical boundary (inside the confirm transaction). */
export function executeActivation(store: CompanyStore, ctx: StoreContext, founderRef: string, intent: string, pl: Record<string, unknown>, env: ActivationEnv): string {
  const str = (k: string): string => String(pl[k]);
  const list = (k: string): string[] => (Array.isArray(pl[k]) ? (pl[k] as unknown[]).map(String) : []);
  const pkgOf = (): AcademyPackage => {
    const p = env.packages.find((x) => x.code === str('packageCode') && x.version === Number(pl.packageVersion));
    if (!p || academyPackageDigest(p) !== str('packageSha256')) throw new QandeelError('VALIDATION_FAILED', 'the registered package changed since the preview', { reason: 'PACKAGE_DIGEST_MISMATCH' });
    return p;
  };
  switch (intent) {
    case 'EMPLOYEE_HIRE': {
      const identity = pl.identityProfileCode === null ? null : env.identities.find((i) => i.code === str('identityProfileCode'));
      if (pl.identityProfileCode !== null && !identity) throw new QandeelError('VALIDATION_FAILED', 'the identity profile changed since the preview', { reason: 'IDENTITY_UNKNOWN' });
      const profile = {
        displayName: { en: `${str('givenName')} ${str('familyName')}`, ...(pl.displayNameAr === null ? {} : { ar: str('displayNameAr') }) },
        portraitAssetRef: null,
        ...(identity ? { identityProfile: identity.code, identityKernel: identity.identityKernel } : {}),
      };
      if (containsSecretMaterial(JSON.stringify(profile))) throw new QandeelError('VALIDATION_FAILED', 'the profile carries secret material', { reason: 'SECRET_MATERIAL' });
      const e = OrganizationStore.for(store).hire(founderRef, { positionId: str('positionId'), name: { given: str('givenName'), family: str('familyName') }, cognitiveProfile: { defaultClass: pl.defaultClass as 'E1', ceilingClass: pl.ceilingClass as 'E2', costDiscipline: 'BALANCED' }, profile, reasonCode: str('reasonCode') });
      return `employee:${e.id}`;
    }
    case 'EMPLOYEE_LIFECYCLE': {
      const e = GovernanceStore.for(store).transitionEmployee(founderRef, str('employeeId'), { to: pl.to as 'TRAINING', reasonCode: str('reasonCode') });
      return `employee:${e.id}`;
    }
    case 'EMPLOYEE_MODEL_ACCESS': {
      const gov = GovernanceStore.for(store);
      const id = str('employeeId') as Id;
      if (!budgetFor(ctx, 'EMPLOYEE', id)) gov.createBudget(founderRef, { scope: 'EMPLOYEE', scopeId: id, capMoney: Number(pl.capMoney), capTokens: Number(pl.capTokens), reasonCode: str('reasonCode') });
      for (const c of list('taskClasses')) gov.grant(founderRef, { employeeId: id, capability: 'model.invoke', resourceScope: c, riskCeiling: 'R0', dataClassCeiling: str('dataClassCeiling') as 'D2', reasonCode: str('reasonCode') });
      return `employee:${id}`;
    }
    case 'SKILL_PACKAGE_QUALIFY': {
      // A confirmed finalize-scores preview promised zero runs and zero provider calls: the store holds it to that.
      const out = AcademyPackageStore.for(store).qualify(founderRef, pkgOf(), { subjectEmployeeId: str('subjectEmployeeId'), expectedSha256: str('packageSha256'), finalizeOnly: pl.qualification === 'FINALIZE_SCORES' });
      return `academy_package:${out.packageId}`;
    }
    case 'ACADEMY_PACKAGE_INSTALL': {
      const out = AcademyPackageStore.for(store).install(founderRef, pkgOf(), { expectedSha256: str('packageSha256') });
      return `academy_package:${out.packageId}`;
    }
    case 'ACADEMY_ENROLL': {
      const out = AcademyPackageStore.for(store).enroll(founderRef, pkgOf(), str('employeeId'));
      return `academy_enrollment:${out.enrollmentId}`;
    }
    case 'ACADEMY_MODULES_COMPLETE': {
      const academy = AcademyStore.for(store);
      for (const m of list('moduleCodes')) academy.recordModuleCompletion(founderRef, str('enrollmentId'), m, `academy_module:${str('enrollmentId')}:${m}`);
      txAdvance(ctx, str('enrollmentId'));
      return `academy_enrollment:${str('enrollmentId')}`;
    }
    case 'ACADEMY_ATTEMPT_START': {
      const out = AcademyPackageStore.for(store).startAttempt(founderRef, pkgOf(), str('enrollmentId'), str('scenarioCode'));
      return `academy_attempt:${out.attemptId}`;
    }
    case 'ACADEMY_EVALUATE': {
      const attemptId = str('attemptId');
      // The deterministic rubric first (system, from run facts) — then the evaluator's own dimensions.
      let a = txEvaluateDeterministic(ctx, attemptId);
      if (pl.answered === true && a.state === 'OPEN') {
        // The answer the Founder scored is the one stored now (append-only; re-checked inside the confirmation).
        const answer = txAnswerOf(ctx, a.workItemId);
        if (!answer || pl.answerRef !== `work_answer:${answer.id}` || pl.answerSha256 !== sha256Hex(answer.body)) throw new QandeelError('INVALID_TRANSITION', 'the scored answer is not the recorded one', { reason: 'ANSWER_CHANGED' });
        const results = list('scores').map((s) => {
          const [d, v] = s.split(':');
          return { dimension: d as AssessmentDimension, scorePct: Number(v), evidenceRefs: [`academy_attempt:${attemptId}`] };
        });
        a = AcademyStore.for(store).recordEvaluation(founderRef, attemptId, results);
      }
      txAdvance(ctx, a.enrollmentId);
      return `academy_attempt:${attemptId}`;
    }
    case 'ACADEMY_RETRAIN_COMPLETE': {
      const r = AcademyStore.for(store).completeRetraining(founderRef, str('remediationId'), `academy_remediation:${str('remediationId')}`);
      txAdvance(ctx, r.enrollmentId);
      return `academy_remediation:${r.id}`;
    }
    case 'ACADEMY_SHADOW_ASSIGN': {
      const out = AcademyPackageStore.for(store).assignShadow(founderRef, pkgOf(), str('enrollmentId'), str('assignmentCode'));
      return `work_item:${out.workItemId}`;
    }
    case 'ACADEMY_PROBATION_EVIDENCE': {
      const academy = AcademyStore.for(store);
      txCollectShadowEvidence(ctx, str('enrollmentId'));
      for (const k of list('positive')) academy.recordProbationEvidence(founderRef, str('enrollmentId'), { kind: k as 'QUALITY', workItemId: str('workItemId'), positive: true });
      for (const k of list('negative')) academy.recordProbationEvidence(founderRef, str('enrollmentId'), { kind: k as 'QUALITY', workItemId: str('workItemId'), positive: false });
      txAdvance(ctx, str('enrollmentId'));
      return `academy_enrollment:${str('enrollmentId')}`;
    }
    case 'ACADEMY_PROBATION_REVIEW': {
      const out = AcademyStore.for(store).decideProbationReview(founderRef, str('enrollmentId'), pl.decision as 'PASS');
      // PASS: certification is issued and the activation request filed by the deterministic engine (never activation).
      txAdvance(ctx, str('enrollmentId'));
      return `probation_review:${out.id}`;
    }
    case 'ACADEMY_CALIBRATION': {
      AcademyStore.for(store).decideFounderCalibration(founderRef, str('enrollmentId'), { decision: pl.decision as 'APPROVE', evidenceRefs: list('evidenceRefs') });
      return `academy_enrollment:${str('enrollmentId')}`;
    }
    case 'ACTIVATION_DECIDE': {
      const r = AcademyStore.for(store).decideActivation(founderRef, str('requestId'), { decision: pl.decision as 'APPROVE', reasonCode: str('reasonCode') });
      return `activation_request:${r.id}`;
    }
    default:
      throw new QandeelError('VALIDATION_FAILED', 'unknown activation intent', { field: 'intent' });
  }
}
