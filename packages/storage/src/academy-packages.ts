/**
 * L1-02 — AcademyPackageStore: a release-pinned Academy package's life in one Company (D-L1-13).
 *
 * QUALIFY (one Founder confirmation; Skill Version qualification only):
 *   register each package Skill + version (QANDEEL-native, text-only) → deterministic inspection → licence check →
 *   quarantine → the deterministic STATIC security review (its verdict, not the Founder, decides SANDBOXED vs
 *   REJECTED) → for every SANDBOXED version, its bounded behavioural benchmark: each case run twice by the trainee subject
 *   in the fenced SKILL_BENCHMARK mode — WITH the exact version and as a BASELINE without it — each a bounded Work Item
 *   with its own capped budget.
 * INSTALL (the Founder's ONE install confirmation, after the evidence exists):
 *   score every finished benchmark run with the deterministic rubric (an unanswered run is VOID, never a pass) → per
 *   version: BENCHMARKED → COMPARED → APPROVED only when its with-skill cases all passed and it is not worse than the
 *   baseline; any version that did not qualify refuses the install (it stays held in the sandbox) → the role blueprint →
 *   the program and its version → the scenarios. The confirmation authorizes installing an inspected package; it never
 *   asserts that a test passed.
 *
 * Employee qualification then runs through the existing Academy engine; Academy success is never benchmark evidence.
 * Every write here is a Founder-authority write (`founderAdminWrite`: armed only by a verified Founder session, a savepoint
 * of the governed confirm). Answers and case texts are local governed content; audit rows carry IDs and codes only.
 */
import { QandeelError, assertId, newId, sha256Hex, type Id } from '@qandeel-company/domain';
import { type AnswerFacets } from '@qandeel-company/governance';
import {
  BENCHMARK_ARMS,
  BQM2_DECLARATION,
  INVALID_OUTPUT_RESULT,
  academyPackageDigest,
  assertAcademyPackage,
  benchmarkVerdict,
  benchmarkVerdictBqm2,
  bindProgram,
  observationsPerArm,
  packageMethod,
  scoreAnswer,
  scoreAnswerR2,
  staticSecurityReview,
  type BenchmarkMethodVersion,
  type RubricVersion,
  type AcademyPackage,
  type BenchmarkArm,
  type BenchmarkVerdict,
  type PackageScenario,
  type RubricResult,
  type StaticSecurityReport,
} from '@qandeel-company/mind';

import { AcademyStore, txStartAttempt } from './academy.js';
import { txAnswerOf, type AnswerRecord } from './answers.js';
import { benchmarkPinMismatch, pinsOfPackage, type BenchmarkPins } from './benchmark-pins.js';
import { txDeclareRequirements } from './capability.js';
import { getEmployeeRow, txAllocateWorkItemBudget } from './governance-core.js';
import { founder, founderAdminWrite } from './governance.js';
import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { getSkillVersionRow, loadSkillPayloadForInspection } from './mind-core.js';
import type { SkillVersionRecord } from './mind-records.js';
import { SkillStore, txCheckSkillLicense, txInspectSkillVersion } from './skill-registry.js';
import { storeContext, type CompanyStore } from './store.js';
import { txCreateWorkItem, txTransition } from './work-items.js';

const EMPLOYEE_TASK = 'c2.employee-task';
/** Retrieval topics that make the CEO's own passport Skills relevant to its Academy and shadow work (no gate). */
const ROLE_TOPICS = (roleRef: string): string[] => [roleRef.slice(5).split('.').at(-1) ?? 'role', 'executive', 'founder', 'governance'];
const TERMINAL_WORK = ['COMPLETED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'];

export interface PackageRecord {
  readonly id: Id;
  readonly code: string;
  readonly version: number;
  readonly sha256: string;
  readonly roleRef: string;
  readonly subjectEmployeeId: Id;
  readonly state: 'QUALIFYING' | 'INSTALLED';
  readonly programId: Id | null;
  readonly programVersionId: Id | null;
  readonly blueprintId: Id | null;
  readonly createdAt: string;
  readonly installedAt: string | null;
  /** D-L1-23: the method the package was registered under, and its pins (null for BQM-1). */
  readonly benchmarkMethod: BenchmarkMethodVersion;
  readonly methodSha256: string | null;
  readonly answerContractVersion: string | null;
  readonly answerContractSha256: string | null;
}

export interface BenchmarkRunView {
  readonly id: Id;
  readonly caseCode: string;
  readonly arm: BenchmarkArm;
  /**
   * D-L1-23: the observation number (BQM-1: always 1), the rubric that scores it, and — once scored — the class of the
   * call that produced its outcome and whether it answered or ended in two invalid outputs (a FAILED observation).
   */
  readonly observationNo: number;
  readonly rubricVersion: RubricVersion;
  readonly answeredClass: string | null;
  /**
   * D-L1-24: UNCLASSIFIED_NO_ANSWER (read model only, never stored) = an R2 observation that finished with no answer for a
   * cause that is neither an output failure nor an allowlisted infrastructure failure: it stays OPEN, is never VOID or
   * re-run, and blocks the qualification (fail closed).
   */
  readonly outcome: 'ANSWERED' | 'INVALID_OUTPUT' | 'UNCLASSIFIED_NO_ANSWER' | null;
  readonly workItemId: Id;
  readonly workItemState: string;
  readonly state: 'OPEN' | 'SCORED' | 'VOID';
  /** The recorded score, or the rubric applied read-only to an answer not yet scored (null without an answer). */
  readonly result: RubricResult | null;
  readonly voidReason: string | null;
  /** The recorded answer, with the ANSWER contract it was produced under (D-L1-23; null before 0018). */
  readonly answer: { readonly body: string; readonly facets: AnswerFacets; readonly answerContractVersion: string | null; readonly answerContractSha256: string | null } | null;
}

export interface PackageSkillView {
  readonly code: string;
  readonly name: string;
  readonly skillId: Id;
  readonly skillVersionId: Id;
  readonly pipelineState: string;
  readonly failureReason: string | null;
  readonly security: { readonly passed: boolean; readonly reviewer: string; readonly checks: readonly { check: string; passed: boolean }[] } | null;
  readonly runs: readonly BenchmarkRunView[];
  readonly verdict: BenchmarkVerdict;
}

export interface PackageView {
  readonly code: string;
  readonly version: number;
  readonly sha256: string;
  readonly title: string;
  readonly roleRef: string;
  readonly record: PackageRecord | null;
  readonly skills: readonly PackageSkillView[];
  /** Every Skill version qualified (security cleared, benchmark and comparison passed): the install may proceed. */
  readonly installable: boolean;
  /** Benchmark runs whose Work Item is still running. */
  readonly benchmarkRunsOpen: number;
  /** D-L1-24: finished R2 observations with an unclassified no-answer outcome (each blocks the qualification). */
  readonly benchmarkRunsUnclassified: number;
  readonly spentMicros: number;
  /** D-L1-23: the method this definition declares (what a qualification would run) — the record holds what it ran. */
  readonly method: { readonly version: BenchmarkMethodVersion; readonly declarationSha256: string | null; readonly answerContract: { readonly version: string; readonly sha256: string } | null; readonly observationsPerArm: number; readonly reasoningClass: string | null; readonly rubricVersion: RubricVersion };
}

function mapPackage(r: Record<string, unknown>): PackageRecord {
  const n = (k: string): Id | null => (r[k] === null ? null : (String(r[k]) as Id));
  return {
    id: String(r.id) as Id,
    code: String(r.code),
    version: Number(r.package_version),
    sha256: String(r.package_sha256),
    roleRef: String(r.role_ref),
    subjectEmployeeId: String(r.subject_employee_id) as Id,
    state: String(r.state) as PackageRecord['state'],
    programId: n('program_id'),
    programVersionId: n('program_version_id'),
    blueprintId: n('blueprint_id'),
    createdAt: String(r.created_at),
    installedAt: r.installed_at === null ? null : String(r.installed_at),
    benchmarkMethod: r.benchmark_method === 'BQM-2' ? 'BQM-2' : 'BQM-1',
    methodSha256: r.method_sha256 == null ? null : String(r.method_sha256),
    answerContractVersion: r.answer_contract_version == null ? null : String(r.answer_contract_version),
    answerContractSha256: r.answer_contract_sha256 == null ? null : String(r.answer_contract_sha256),
  };
}

/**
 * D-L1-23 / D-L1-24: how a FINISHED R2 benchmark Work Item without an answer ended, from its last run's recorded failure
 * code. INVALID_OUTPUT = two outputs failed the observation's contract (parser-invalid, a wrong proposal type or a refused
 * answer — model behaviour, a FAILED observation); INFRASTRUCTURE = an explicitly allowlisted infrastructure / runtime
 * failure (VOID, replaceable); anything else — a completion without an answer, a cancellation, an unlisted code — is
 * UNCLASSIFIED: never inferred to be infrastructure, never VOID.
 */
type NoAnswerOutcome = { readonly kind: 'INVALID_OUTPUT' } | { readonly kind: 'INFRASTRUCTURE'; readonly code: string } | { readonly kind: 'UNCLASSIFIED' };
function noAnswerOutcome(ctx: StoreContext, workItemId: Id, workItemState: string): NoAnswerOutcome {
  if (workItemState !== 'FAILED') return { kind: 'UNCLASSIFIED' };
  const code = ctx.db.get<{ c: string | null }>('SELECT failure_code AS c FROM runs WHERE work_item_id = ? ORDER BY run_seq DESC LIMIT 1', workItemId)?.c ?? null;
  if (code === 'MODEL_OUTPUT_INVALID') return { kind: 'INVALID_OUTPUT' };
  if (code !== null && (BQM2_DECLARATION.infrastructureNoAnswer.runFailureCodes as readonly string[]).includes(code)) return { kind: 'INFRASTRUCTURE', code };
  return { kind: 'UNCLASSIFIED' };
}

/** The reasoning class of the last model call of a Work Item (the call that produced its answer or final invalid output). */
function lastCallClass(ctx: StoreContext, workItemId: Id): string | null {
  return ctx.db.get<{ c: string }>('SELECT d.reasoning_class AS c FROM usage_records u JOIN deployments d ON d.id = u.deployment_id WHERE u.work_item_id = ? ORDER BY u.created_at DESC, u.id DESC LIMIT 1', workItemId)?.c ?? null;
}

const pinsOfRecord = (r: PackageRecord): BenchmarkPins => ({ method: r.benchmarkMethod, methodSha256: r.methodSha256, answerContractVersion: r.answerContractVersion, answerContractSha256: r.answerContractSha256 });

export function txPackageRecord(ctx: StoreContext, pkg: AcademyPackage): PackageRecord | null {
  const r = ctx.db.get('SELECT * FROM academy_packages WHERE code = ? AND package_version = ?', pkg.code, pkg.version);
  return r ? mapPackage(r) : null;
}

/**
 * The live result of one benchmark run: recorded, or its rubric applied read-only. The rubric is the ROW's (fixed at
 * creation): an R1 row (BQM-1: packages v1, v2, v3) is only ever read by the frozen R1 `scoreAnswer`; an R2 row by R2,
 * where two invalid outputs are a FAILED observation (never VOID).
 */
function runResult(pkg: AcademyPackage, skillCode: string, caseCode: string, row: { state: string; checks_json: string | null; score_pct: number | null; passed: number | null; rubric_version: string }, answer: AnswerRecord | null, invalid: boolean): RubricResult | null {
  if (row.state === 'SCORED') {
    const checks = JSON.parse(String(row.checks_json)) as RubricResult['checks'];
    return { checks, scorePct: Number(row.score_pct), criticalPassed: checks.length > 0 && checks.every((c) => !c.critical || c.passed), passed: Number(row.passed) === 1 };
  }
  if (row.state === 'VOID') return null;
  const c = pkg.skills.find((s) => s.code === skillCode)?.benchmark.find((b) => b.code === caseCode);
  if (!c) return null;
  if (row.rubric_version === 'R2') {
    if (answer !== null) return scoreAnswerR2(c, { body: answer.body, ...answer.facets }, pkg.limits.benchmarkPassPct);
    return invalid ? INVALID_OUTPUT_RESULT : null;
  }
  return answer === null ? null : scoreAnswer(c.expect, { body: answer.body, ...answer.facets }, pkg.limits.benchmarkPassPct);
}

/** The whole package as the Founder inspects it before deciding (read-only; usable inside any transaction). */
export function txPackageView(ctx: StoreContext, pkg: AcademyPackage): PackageView {
  const sha = academyPackageDigest(pkg);
  const record = txPackageRecord(ctx, pkg);
  const skills: PackageSkillView[] = [];
  let open = 0;
  let unclassified = 0;
  if (record) {
    for (const ps of ctx.db.all<{ skill_code: string; skill_id: string; skill_version_id: string }>('SELECT * FROM academy_package_skills WHERE package_id = ? ORDER BY skill_code', record.id)) {
      const def = pkg.skills.find((s) => s.code === ps.skill_code);
      const v = getSkillVersionRow(ctx, ps.skill_version_id as Id);
      const sec = ctx.db.get<{ reviewer_ref: string; checks_json: string; passed: number }>('SELECT reviewer_ref, checks_json, passed FROM skill_security_reviews WHERE skill_version_id = ?', v.id);
      const runs: BenchmarkRunView[] = ctx.db
        .all<{ id: string; case_code: string; arm: string; work_item_id: string; state: string; checks_json: string | null; score_pct: number | null; passed: number | null; void_reason: string | null; observation_no: number; rubric_version: string; answered_class: string | null; observation_outcome: string | null }>(
          `SELECT * FROM skill_benchmark_runs WHERE package_id = ? AND skill_version_id = ? AND state <> 'VOID' ORDER BY case_code, arm, observation_no`,
          record.id,
          v.id,
        )
        .map((r) => {
          const answer = txAnswerOf(ctx, r.work_item_id as Id);
          const workItemState = getWorkItemRow(ctx, r.work_item_id as Id).state;
          // Running = its Work Item has not finished yet (a finished run stays OPEN until the install scores it).
          if (r.state === 'OPEN' && !TERMINAL_WORK.includes(workItemState)) open++;
          const noAnswer = r.rubric_version === 'R2' && answer === null && r.state === 'OPEN' && TERMINAL_WORK.includes(workItemState) ? noAnswerOutcome(ctx, r.work_item_id as Id, workItemState) : null;
          const invalid = noAnswer?.kind === 'INVALID_OUTPUT';
          if (noAnswer?.kind === 'UNCLASSIFIED') unclassified++;
          return {
            id: r.id as Id,
            caseCode: r.case_code,
            arm: r.arm as BenchmarkArm,
            observationNo: Number(r.observation_no),
            rubricVersion: (r.rubric_version === 'R2' ? 'R2' : 'R1') as RubricVersion,
            answeredClass: r.answered_class,
            outcome: noAnswer?.kind === 'UNCLASSIFIED' ? 'UNCLASSIFIED_NO_ANSWER' : ((r.observation_outcome as BenchmarkRunView['outcome']) ?? null),
            workItemId: r.work_item_id as Id,
            workItemState,
            state: r.state as BenchmarkRunView['state'],
            result: runResult(pkg, ps.skill_code, r.case_code, r, answer, invalid),
            voidReason: r.void_reason,
            answer: answer === null ? null : { body: answer.body, facets: answer.facets, answerContractVersion: answer.answerContractVersion, answerContractSha256: answer.answerContractSha256 },
          };
        });
      // The verdict follows the method the package was REGISTERED under (its record), never the running build's default.
      const verdict = record.benchmarkMethod === 'BQM-2'
        ? benchmarkVerdictBqm2(def?.benchmark ?? [], runs.map((r) => ({ caseCode: r.caseCode, arm: r.arm, observationNo: r.observationNo, result: r.result })))
        : benchmarkVerdict(def?.benchmark.map((b) => b.code) ?? [], runs.map((r) => ({ caseCode: r.caseCode, arm: r.arm, result: r.result })));
      skills.push({
        code: ps.skill_code,
        name: def?.name ?? ps.skill_code,
        skillId: ps.skill_id as Id,
        skillVersionId: v.id,
        pipelineState: v.pipelineState,
        failureReason: v.failureReason,
        security: sec ? { passed: sec.passed === 1, reviewer: sec.reviewer_ref, checks: JSON.parse(sec.checks_json) as { check: string; passed: boolean }[] } : null,
        runs,
        verdict,
      });
    }
  }
  const spent = record
    ? Number(ctx.db.get<{ s: number }>('SELECT COALESCE(SUM(u.economic_micros), 0) AS s FROM usage_records u JOIN skill_benchmark_runs b ON b.work_item_id = u.work_item_id WHERE b.package_id = ?', record.id)?.s ?? 0)
    : 0;
  const installable = record !== null && record.sha256 === sha && record.state === 'QUALIFYING' && skills.length === pkg.skills.length && skills.every((s) => s.pipelineState === 'SANDBOXED' && s.security?.passed === true && s.verdict.benchmarkPassed && s.verdict.comparePassed);
  const m = packageMethod(pkg);
  const method: PackageView['method'] = { version: m, declarationSha256: pkg.benchmarkMethod?.declarationSha256 ?? null, answerContract: pkg.benchmarkMethod?.answerContract ?? null, observationsPerArm: observationsPerArm(pkg), reasoningClass: m === 'BQM-2' ? BQM2_DECLARATION.reasoningClass : null, rubricVersion: m === 'BQM-2' ? 'R2' : 'R1' };
  return { code: pkg.code, version: pkg.version, sha256: sha, title: pkg.title, roleRef: pkg.roleRef, record, skills, installable, benchmarkRunsOpen: open, benchmarkRunsUnclassified: unclassified, spentMicros: spent, method };
}

/**
 * One benchmark observation as a bounded, budgeted, released Work Item owned by the trainee subject. BQM-2 (D-L1-23) pins
 * the class (E1, both arms) and the same-class retry policy in the Work Item itself, so no run can escalate it.
 */
function txCreateBenchmarkRun(ctx: StoreContext, pkg: AcademyPackage, packageId: Id, versionId: Id, caseCode: string, content: string, arm: BenchmarkArm, subject: { id: Id; ref: string }, actorRef: string, observationNo = 1): Id {
  const bqm2 = packageMethod(pkg) === 'BQM-2';
  const { workItem } = txCreateWorkItem(ctx, {
    objective: 'Skill benchmark case (Skill Version qualification)',
    ownerRef: subject.ref,
    riskLevel: 'R0',
    processorKind: EMPLOYEE_TASK,
    // The case is the Work Item's own instructions; the run never learns which arm (or observation) it is.
    processorInput: {
      taskClass: pkg.taskClasses.benchmark, dataClass: 'D1', maxOutputTokens: pkg.limits.benchmarkMaxOutputTokens, instructions: `Benchmark case. Answer the case below as the Company role you hold.\n\n${content}`,
      // D-L1-24: and the answer-only fence with its hard model-call bound (the store refuses a reservation past it).
      ...(bqm2 ? { reasoningClass: BQM2_DECLARATION.reasoningClass, invalidOutputPolicy: 'SAME_CLASS_RETRY', answerOnly: true, maxModelCalls: BQM2_DECLARATION.deliverable.maxModelCallsPerObservation } : {}),
    },
  }, { actorRef });
  const id = newId();
  ctx.db.run(`INSERT INTO skill_benchmark_runs (id, package_id, skill_version_id, case_code, arm, work_item_id, employee_id, state, created_at, observation_no, rubric_version) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`, id, packageId, versionId, caseCode, arm, workItem.id, subject.id, ts(ctx), observationNo, bqm2 ? 'R2' : 'R1');
  txAllocateWorkItemBudget(ctx, workItem.id, subject.id, { money: pkg.limits.benchmarkCapMicros, tokens: 60_000 }, actorRef, 'skill.benchmark');
  txTransition(ctx, workItem.id, { to: 'READY', reasonCode: 'skill.benchmark.released', actorRef });
  appendAudit(ctx, 'skill.benchmark_run_created', 'skill_benchmark_run', id, { actorRef }, 'OK', arm, { skillVersionId: versionId, workItemId: workItem.id, observationNo });
  return id as Id;
}

/**
 * Scores every finished benchmark run of a package. Each row is scored by ITS rubric, fixed at creation: R1 (frozen; an
 * unanswered run is VOID) or R2 (D-L1-23: two invalid outputs are a FAILED observation; only an infrastructure no-answer
 * is VOID). A row is decided exactly once (the 0017 / 0018 decide-once trigger).
 */
export function txScoreBenchmarks(ctx: StoreContext, pkg: AcademyPackage, packageId: Id): number {
  let changed = 0;
  for (const r of ctx.db.all<{ id: string; work_item_id: string; case_code: string; skill_version_id: string; rubric_version: string }>(`SELECT id, work_item_id, case_code, skill_version_id, rubric_version FROM skill_benchmark_runs WHERE package_id = ? AND state = 'OPEN'`, packageId)) {
    const item = getWorkItemRow(ctx, r.work_item_id as Id);
    const answer = txAnswerOf(ctx, item.id);
    const code = ctx.db.get<{ c: string }>('SELECT skill_code AS c FROM academy_package_skills WHERE package_id = ? AND skill_version_id = ?', packageId, r.skill_version_id)?.c ?? '';
    const c = pkg.skills.find((s) => s.code === code)?.benchmark.find((b) => b.code === r.case_code);
    if (r.rubric_version === 'R2') {
      if (!c || !TERMINAL_WORK.includes(item.state)) continue;
      const noAnswer = answer === null ? noAnswerOutcome(ctx, item.id, item.state) : null;
      // D-L1-24: fail closed — an unclassified no-answer is never scored or voided here (never retryable); it stays OPEN
      // and the qualification is blocked until it is explained.
      if (noAnswer?.kind === 'UNCLASSIFIED') continue;
      const invalid = noAnswer?.kind === 'INVALID_OUTPUT';
      if (answer !== null || invalid) {
        const res = answer !== null ? scoreAnswerR2(c, { body: answer.body, ...answer.facets }, pkg.limits.benchmarkPassPct) : INVALID_OUTPUT_RESULT;
        ctx.db.run(`UPDATE skill_benchmark_runs SET state = 'SCORED', checks_json = ?, score_pct = ?, passed = ?, scored_at = ?, answered_class = ?, observation_outcome = ? WHERE id = ? AND state = 'OPEN'`, JSON.stringify(res.checks), res.scorePct, res.passed ? 1 : 0, ts(ctx), lastCallClass(ctx, item.id), answer !== null ? 'ANSWERED' : 'INVALID_OUTPUT', r.id);
        appendAudit(ctx, 'skill.benchmark_scored', 'skill_benchmark_run', r.id, { actorRef: 'system:skill-benchmark-rubric/r2' }, 'OK', res.passed ? 'PASSED' : answer === null ? 'INVALID_OUTPUT' : 'FAILED', { scorePct: res.scorePct });
      } else if (noAnswer?.kind === 'INFRASTRUCTURE') {
        ctx.db.run(`UPDATE skill_benchmark_runs SET state = 'VOID', void_reason = ? WHERE id = ? AND state = 'OPEN'`, `INFRASTRUCTURE_${noAnswer.code}`.slice(0, 64), r.id);
        appendAudit(ctx, 'skill.benchmark_voided', 'skill_benchmark_run', r.id, { actorRef: 'system:skill-benchmark-rubric/r2' }, 'OK', 'INFRASTRUCTURE_NO_ANSWER', { workItemState: item.state, runFailureCode: noAnswer.code });
      } else continue;
      changed++;
      continue;
    }
    if (answer !== null && c) {
      const res = scoreAnswer(c.expect, { body: answer.body, ...answer.facets }, pkg.limits.benchmarkPassPct);
      ctx.db.run(`UPDATE skill_benchmark_runs SET state = 'SCORED', checks_json = ?, score_pct = ?, passed = ?, scored_at = ? WHERE id = ? AND state = 'OPEN'`, JSON.stringify(res.checks), res.scorePct, res.passed ? 1 : 0, ts(ctx), r.id);
      appendAudit(ctx, 'skill.benchmark_scored', 'skill_benchmark_run', r.id, { actorRef: 'system:skill-benchmark-rubric/v1' }, 'OK', res.passed ? 'PASSED' : 'FAILED', { scorePct: res.scorePct });
      changed++;
    } else if (TERMINAL_WORK.includes(item.state)) {
      ctx.db.run(`UPDATE skill_benchmark_runs SET state = 'VOID', void_reason = ? WHERE id = ? AND state = 'OPEN'`, `WORK_${item.state}_NO_ANSWER`.slice(0, 64), r.id);
      appendAudit(ctx, 'skill.benchmark_voided', 'skill_benchmark_run', r.id, { actorRef: 'system:skill-benchmark-rubric/v1' }, 'OK', 'NO_ANSWER', { workItemState: item.state });
      changed++;
    }
  }
  return changed;
}

export class AcademyPackageStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): AcademyPackageStore {
    return new AcademyPackageStore(store);
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  view(pkg: AcademyPackage): PackageView {
    return this.#read((ctx) => txPackageView(ctx, pkg));
  }

  /**
   * QUALIFY: registers the package's Skill versions and runs their Skill Version qualification up to the bounded
   * benchmark. Re-confirming a QUALIFYING package first FINALIZES every finished run (D-L1-21: an answered run becomes
   * durable SCORED evidence, pass or fail; an unanswered one VOID), then replaces only the VOID runs; a scored run is
   * never re-run, so no result can be cherry-picked. Finalizing with nothing to replace is a successful, idempotent act
   * that creates no work; `finalizeOnly` (a confirmed finalize-scores preview) guarantees it creates no run at all.
   */
  qualify(actorRef: string, pkg: AcademyPackage, input: { subjectEmployeeId: string; expectedSha256: string; finalizeOnly?: boolean }): { packageId: Id; created: boolean; benchmarkRuns: number; scored: number } {
    return founderAdminWrite(this.#store, 'qualify academy package', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'academy package');
      assertAcademyPackage(pkg);
      if (academyPackageDigest(pkg) !== input.expectedSha256) throw new QandeelError('VALIDATION_FAILED', 'the package digest does not match the registered package', { field: 'packageSha256', reason: 'PACKAGE_DIGEST_MISMATCH' });
      const subject = getEmployeeRow(ctx, assertId(input.subjectEmployeeId, 'subjectEmployeeId'));
      if (subject.roleRef !== pkg.roleRef) throw new QandeelError('VALIDATION_FAILED', 'the benchmark subject holds the package role', { reason: 'ROLE_MISMATCH' });
      if (subject.state !== 'TRAINING') throw new QandeelError('INVALID_TRANSITION', 'the benchmark subject is a TRAINING Employee', { state: subject.state });
      const existing = txPackageRecord(ctx, pkg);
      if (existing && existing.state !== 'QUALIFYING') throw new QandeelError('INVALID_TRANSITION', 'this package is already installed', { reason: 'PACKAGE_INSTALLED' });
      // D-L1-23: a BQM-2 package runs only under exactly the method and ANSWER contract it pinned (new or in flight).
      const mismatch = benchmarkPinMismatch(existing ? pinsOfRecord(existing) : pinsOfPackage(pkg));
      if (mismatch !== null) throw new QandeelError('VALIDATION_FAILED', 'the package pins a benchmark method or ANSWER contract this build does not run', { reason: mismatch });
      if (existing && existing.sha256 !== input.expectedSha256) throw new QandeelError('VALIDATION_FAILED', 'a different package with this code and version exists', { reason: 'PACKAGE_DIGEST_MISMATCH' });
      if (existing && existing.subjectEmployeeId !== subject.id) throw new QandeelError('VALIDATION_FAILED', 'the benchmark subject of a package does not change', { reason: 'SUBJECT_MISMATCH' });
      const at = ts(ctx);
      let packageId = existing?.id ?? null;
      let runs = 0;
      const skills = SkillStore.for(this.#store);
      if (packageId === null) {
        // D-L1-19: a package's history only moves forward — a new version of a code is newer than every recorded one, so
        // an earlier (e.g. failed) version is never re-created under a lower number beside its successor.
        const newest = ctx.db.get<{ v: number | null }>('SELECT MAX(package_version) AS v FROM academy_packages WHERE code = ?', pkg.code)?.v ?? null;
        if (newest !== null && newest >= pkg.version) throw new QandeelError('INVALID_TRANSITION', 'a new package version is newer than every recorded version of its code', { reason: 'PACKAGE_VERSION_NOT_NEWER', newest });
        packageId = newId() as Id;
        const pins = pinsOfPackage(pkg);
        ctx.db.run(`INSERT INTO academy_packages (id, code, package_version, package_sha256, role_ref, subject_employee_id, state, qualified_by_ref, created_at, benchmark_method, method_sha256, answer_contract_version, answer_contract_sha256) VALUES (?, ?, ?, ?, ?, ?, 'QUALIFYING', ?, ?, ?, ?, ?, ?)`, packageId, pkg.code, pkg.version, input.expectedSha256, pkg.roleRef, subject.id, p.ref, at, pins.method, pins.methodSha256, pins.answerContractVersion, pins.answerContractSha256);
        appendAudit(ctx, 'academy.package_qualifying', 'academy_package', packageId, { actorRef: p.ref }, 'OK', pins.method, { code: pkg.code, version: pkg.version });
        for (const s of pkg.skills) {
          const { skillId, version } = this.#packageSkillVersion(ctx, skills, p.ref, pkg, s, input.expectedSha256);
          let v = version;
          ctx.db.run('INSERT INTO academy_package_skills (package_id, skill_code, skill_id, skill_version_id) VALUES (?, ?, ?, ?)', packageId, s.code, skillId, v.id);
          // Deterministic, independent of the Founder: inspection, then the licence / dependency check.
          v = txInspectSkillVersion(ctx, v.id);
          if (v.pipelineState === 'REJECTED') continue;
          v = txCheckSkillLicense(ctx, v.id);
          if (v.pipelineState === 'REJECTED') continue;
          v = skills.advanceSkillVersion(p.ref, v.id, 'SECURITY_QUARANTINE', { reasonCode: 'package.quarantine' });
          const report = this.#review(ctx, s, v.id);
          // The static review's verdict decides — the Founder's confirmation is never security evidence.
          v = skills.advanceSkillVersion(p.ref, v.id, 'SANDBOXED', { reasonCode: report.passed ? 'security.static_review_passed' : 'security.static_review_failed', evidenceRef: `skill_security_review:${v.id}`, securityPassed: report.passed });
          if (v.pipelineState !== 'SANDBOXED') continue;
          // Every observation of every case and arm exists from the start (BQM-2: k = 5; no early stop, no later choice).
          for (const c of s.benchmark) for (const arm of BENCHMARK_ARMS) for (let n = 1; n <= observationsPerArm(pkg); n++) {
            txCreateBenchmarkRun(ctx, pkg, packageId, v.id, c.code, c.content, arm, { id: subject.id, ref: subject.ref }, p.ref, n);
            runs++;
          }
        }
        return { packageId, created: true, benchmarkRuns: runs, scored: 0 };
      }
      if (input.finalizeOnly === true && existing === null) throw new QandeelError('INVALID_TRANSITION', 'only a qualifying package has benchmark scores to finalize', { reason: 'PACKAGE_NOT_QUALIFIED' });
      // Re-qualification of a QUALIFYING package: finalize what finished (durably — this transaction no longer ends in a
      // refusal when nothing needs re-running), then replace only the VOID runs.
      const scored = txScoreBenchmarks(ctx, pkg, packageId);
      for (const ps of ctx.db.all<{ skill_code: string; skill_version_id: string }>('SELECT skill_code, skill_version_id FROM academy_package_skills WHERE package_id = ?', packageId)) {
        const v = getSkillVersionRow(ctx, ps.skill_version_id as Id);
        if (v.pipelineState !== 'SANDBOXED') continue;
        const s = pkg.skills.find((x) => x.code === ps.skill_code);
        // The deterministic VOID rule: an observation slot with no live (open or scored) run — its run ended without an
        // answer for an infrastructure reason — gets one new run of the SAME observation number. A scored one never does.
        for (const c of s?.benchmark ?? []) for (const arm of BENCHMARK_ARMS) for (let n = 1; n <= observationsPerArm(pkg); n++) {
          if (ctx.db.get(`SELECT 1 AS x FROM skill_benchmark_runs WHERE package_id = ? AND skill_version_id = ? AND case_code = ? AND arm = ? AND observation_no = ? AND state <> 'VOID'`, packageId, v.id, c.code, arm, n)) continue;
          if (input.finalizeOnly === true) throw new QandeelError('INVALID_TRANSITION', 'a benchmark case needs a re-run: preview the re-run of its void cases', { reason: 'REQUALIFY_REQUIRED' });
          txCreateBenchmarkRun(ctx, pkg, packageId, v.id, c.code, c.content, arm, { id: subject.id, ref: subject.ref }, p.ref, n);
          runs++;
        }
      }
      if (scored > 0 || runs > 0) appendAudit(ctx, 'academy.package_benchmarks_finalized', 'academy_package', packageId, { actorRef: p.ref }, 'OK', null, { scored, replaced: runs });
      return { packageId, created: false, benchmarkRuns: runs, scored };
    });
  }

  /**
   * D-L1-19 — the package-revision seam. A package Skill keeps ONE semantic identity across package versions (its code);
   * each package version qualifies its OWN new Skill Version of it, chained to the skill's latest earlier version. A
   * Skill Version is therefore qualified inside exactly one package (the 0017 one-version-one-package index), so no
   * benchmark evidence can be shared, inherited or confused between package versions. A label already used for this
   * Skill is refused: with a different payload it would be a silent rewrite, with the same payload it would re-enter an
   * earlier package's evidence — either way the new package version takes a new label.
   */
  #packageSkillVersion(ctx: StoreContext, skills: SkillStore, actorRef: string, pkg: AcademyPackage, s: AcademyPackage['skills'][number], sha: string): { skillId: Id; version: SkillVersionRecord } {
    const known = ctx.db.get<{ id: string; skill_type: string; owner_ref: string; status: string }>('SELECT id, skill_type, owner_ref, status FROM skills WHERE code = ?', s.code);
    if (known && (known.skill_type !== 'QANDEEL_NATIVE' || known.owner_ref !== pkg.roleRef || known.status !== 'ACTIVE')) {
      throw new QandeelError('VALIDATION_FAILED', 'a package Skill reuses only an active QANDEEL-native Skill identity of its own role', { reason: 'PACKAGE_SKILL_IDENTITY_MISMATCH', skillCode: s.code });
    }
    const skillId = (known?.id ?? skills.registerSkill(actorRef, { code: s.code, name: s.name, skillType: 'QANDEEL_NATIVE', ownerRef: pkg.roleRef }).id) as Id;
    const taken = ctx.db.get<{ instructions_sha256: string }>('SELECT instructions_sha256 FROM skill_versions WHERE skill_id = ? AND version_label = ?', skillId, s.versionLabel);
    if (taken) {
      const same = taken.instructions_sha256 === sha256Hex(s.instructions);
      throw new QandeelError('VALIDATION_FAILED', same ? 'this Skill version label is already qualified in an earlier package: a new package version takes a new label' : 'this Skill version label already names a different payload', { reason: same ? 'SKILL_VERSION_LABEL_TAKEN' : 'SKILL_VERSION_LABEL_CONFLICT', skillCode: s.code });
    }
    const previous = ctx.db.get<{ id: string }>('SELECT id FROM skill_versions WHERE skill_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', skillId);
    const version = skills.registerSkillVersion(actorRef, {
      skillId,
      versionLabel: s.versionLabel,
      sourceRef: `academy-package:${pkg.code}.v${pkg.version}`,
      sourceRevision: `sha-${sha.slice(0, 16)}`,
      authorRef: 'org:qandeel-company',
      licenseSpdx: null,
      dependencies: [],
      instructions: s.instructions,
      ...(previous ? { previousVersionId: previous.id } : {}),
    });
    return { skillId, version };
  }

  #review(ctx: StoreContext, s: AcademyPackage['skills'][number], versionId: Id): StaticSecurityReport {
    const v = getSkillVersionRow(ctx, versionId);
    const meta = ctx.db.get<{ dependencies_json: string; skill_type: string }>('SELECT v.dependencies_json, k.skill_type FROM skill_versions v JOIN skills k ON k.id = v.skill_id WHERE v.id = ?', versionId);
    const text = loadSkillPayloadForInspection(ctx, versionId) ?? '';
    const report = staticSecurityReview(s, { instructions: text, instructionsSha256: v.instructionsSha256, skillType: meta?.skill_type ?? '', licenseStatus: v.licenseStatus, directives: v.directives, dependencies: JSON.parse(meta?.dependencies_json ?? '[]') as unknown[], requestedTools: v.requestedTools });
    ctx.db.run('INSERT INTO skill_security_reviews (skill_version_id, reviewer_ref, scope, checks_json, passed, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)', versionId, report.reviewer, report.scope, JSON.stringify(report.checks), report.passed ? 1 : 0, ts(ctx));
    appendAudit(ctx, 'skill.static_security_reviewed', 'skill_version', versionId, { actorRef: report.reviewer }, report.passed ? 'OK' : 'REJECTED', report.passed ? 'PASSED' : 'FAILED', { checks: report.checks.length });
    return report;
  }

  /**
   * INSTALL — the Founder's one install confirmation. Every Skill version must have qualified on its own evidence;
   * anything else refuses the install and leaves the version held in the sandbox.
   */
  install(actorRef: string, pkg: AcademyPackage, input: { expectedSha256: string }): { packageId: Id; programId: Id; programVersionId: Id; blueprintId: Id } {
    return founderAdminWrite(this.#store, 'install academy package', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'academy package');
      if (academyPackageDigest(pkg) !== input.expectedSha256) throw new QandeelError('VALIDATION_FAILED', 'the package digest does not match the registered package', { reason: 'PACKAGE_DIGEST_MISMATCH' });
      const rec = txPackageRecord(ctx, pkg);
      if (!rec) throw new QandeelError('INVALID_TRANSITION', 'the package has not been qualified', { reason: 'PACKAGE_NOT_QUALIFIED' });
      if (rec.state === 'INSTALLED') throw new QandeelError('INVALID_TRANSITION', 'this package is already installed', { reason: 'PACKAGE_INSTALLED' });
      if (rec.sha256 !== input.expectedSha256) throw new QandeelError('VALIDATION_FAILED', 'a different package with this code and version exists', { reason: 'PACKAGE_DIGEST_MISMATCH' });
      txScoreBenchmarks(ctx, pkg, rec.id);
      const view = txPackageView(ctx, pkg);
      const unqualified = view.skills.filter((s) => !(s.pipelineState === 'SANDBOXED' && s.security?.passed === true && s.verdict.benchmarkPassed && s.verdict.comparePassed));
      if (view.skills.length !== pkg.skills.length || unqualified.length > 0) {
        throw new QandeelError('VALIDATION_FAILED', 'every package Skill version must qualify on its own security and benchmark evidence', { reason: 'PACKAGE_SKILLS_NOT_QUALIFIED', skills: unqualified.map((s) => `${s.code}:${s.verdict.reason}`).join(',').slice(0, 160) });
      }
      const skills = SkillStore.for(this.#store);
      for (const s of view.skills) {
        skills.advanceSkillVersion(p.ref, s.skillVersionId, 'BENCHMARKED', { reasonCode: 'benchmark.passed', evidenceRef: `skill_benchmark:${s.skillVersionId}` });
        skills.advanceSkillVersion(p.ref, s.skillVersionId, 'COMPARED', { reasonCode: 'benchmark.not_worse_than_baseline', evidenceRef: `skill_benchmark_compare:${s.skillVersionId}` });
        skills.advanceSkillVersion(p.ref, s.skillVersionId, 'APPROVED', { reasonCode: 'package.installed', evidenceRef: `academy_package:${rec.id}` });
      }
      const idOf = (code: string): Id => {
        const s = view.skills.find((x) => x.code === code);
        if (!s) throw new QandeelError('STORAGE_INVARIANT', 'package skill missing', { code });
        return s.skillId;
      };
      const blueprint = skills.publishBlueprint(p.ref, pkg.roleRef, pkg.skills.map((s) => ({ skillId: idOf(s.code), category: s.blueprintCategory, minProficiency: s.minProficiency, critical: s.critical })));
      const academy = AcademyStore.for(this.#store);
      const program = academy.createProgram(p.ref, { code: pkg.code, roleRef: pkg.roleRef });
      const pv = academy.publishProgramVersion(p.ref, program.id, bindProgram(pkg, idOf));
      for (const sc of pkg.scenarios) academy.addScenario(p.ref, pv.id, { code: sc.code, kind: sc.kind, content: sc.content, sourceRef: sc.sourceRef, budgetMicros: sc.budgetMicros });
      ctx.db.run(`UPDATE academy_packages SET state = 'INSTALLED', program_id = ?, program_version_id = ?, blueprint_id = ?, installed_by_ref = ?, installed_at = ? WHERE id = ? AND state = 'QUALIFYING'`, program.id, pv.id, blueprint.id, p.ref, ts(ctx), rec.id);
      appendAudit(ctx, 'academy.package_installed', 'academy_package', rec.id, { actorRef: p.ref }, 'OK', null, { programVersionId: pv.id, blueprintId: blueprint.id, skills: view.skills.length });
      return { packageId: rec.id, programId: program.id, programVersionId: pv.id, blueprintId: blueprint.id };
    });
  }

  /** Enrolls the Employee in the installed program and opens its LEARNING passports on the package's approved versions. */
  enroll(actorRef: string, pkg: AcademyPackage, employeeId: string): { enrollmentId: Id; passports: number } {
    return founderAdminWrite(this.#store, 'enroll from package', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, `employee:${assertId(employeeId, 'employeeId')}`, 'academy enrollment');
      const rec = txPackageRecord(ctx, pkg);
      if (!rec || rec.state !== 'INSTALLED' || rec.programVersionId === null) throw new QandeelError('INVALID_TRANSITION', 'the package is not installed', { reason: 'PACKAGE_NOT_INSTALLED' });
      const e = AcademyStore.for(this.#store).enroll(p.ref, employeeId, rec.programVersionId);
      const skills = SkillStore.for(this.#store);
      let passports = 0;
      for (const ps of ctx.db.all<{ skill_id: string; skill_version_id: string }>('SELECT skill_id, skill_version_id FROM academy_package_skills WHERE package_id = ? ORDER BY skill_code', rec.id)) {
        if (ctx.db.get('SELECT 1 AS x FROM passport_entries WHERE employee_id = ? AND skill_id = ?', e.employeeId, ps.skill_id)) continue;
        skills.openPassportEntry(p.ref, e.employeeId, ps.skill_version_id);
        passports++;
      }
      return { enrollmentId: e.id, passports };
    });
  }

  /** Starts one Academy attempt on a package scenario: the attempt + its bounded budget + topics + release, together. */
  startAttempt(actorRef: string, pkg: AcademyPackage, enrollmentId: string, scenarioCode: string): { attemptId: Id; workItemId: Id } {
    return founderAdminWrite(this.#store, 'start academy attempt', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'academy attempt');
      const sc = this.#scenario(ctx, pkg, enrollmentId, scenarioCode);
      const kind = sc.def.kind === 'PRACTICE' ? 'SIMULATION' : 'ASSESSMENT';
      const out = txStartAttempt(ctx, enrollmentId, { scenarioId: sc.id, kind, taskClass: pkg.taskClasses.attempt, maxOutputTokens: pkg.limits.attemptMaxOutputTokens });
      txDeclareRequirements(ctx, out.workItemId, { requirements: [], topics: ROLE_TOPICS(pkg.roleRef) });
      txAllocateWorkItemBudget(ctx, out.workItemId, sc.employeeId, { money: pkg.limits.attemptCapMicros, tokens: 80_000 }, p.ref, 'academy.attempt');
      txTransition(ctx, out.workItemId, { to: 'READY', reasonCode: 'academy.attempt.released', actorRef: p.ref });
      return { attemptId: out.attempt.id, workItemId: out.workItemId };
    });
  }

  #scenario(ctx: StoreContext, pkg: AcademyPackage, enrollmentId: string, scenarioCode: string): { id: Id; def: PackageScenario; employeeId: Id } {
    const e = ctx.db.get<{ program_version_id: string; employee_id: string }>('SELECT program_version_id, employee_id FROM academy_enrollments WHERE id = ?', assertId(enrollmentId, 'enrollmentId'));
    if (!e) throw new QandeelError('NOT_FOUND', 'enrollment not found', { enrollmentId });
    const rec = txPackageRecord(ctx, pkg);
    if (!rec || rec.programVersionId !== e.program_version_id) throw new QandeelError('VALIDATION_FAILED', 'the enrollment is not in this package\'s program', { reason: 'PACKAGE_MISMATCH' });
    const def = pkg.scenarios.find((s) => s.code === scenarioCode);
    const row = ctx.db.get<{ id: string }>(`SELECT id FROM academy_scenarios WHERE program_version_id = ? AND code = ? AND status = 'ACTIVE'`, e.program_version_id, scenarioCode);
    if (!def || !row) throw new QandeelError('NOT_FOUND', 'scenario not in this program', { scenarioCode: scenarioCode.slice(0, 64) });
    return { id: row.id as Id, def, employeeId: e.employee_id as Id };
  }

  /** Creates the package's shadow assignment for the trainee: its own bounded Work Item, assigned, budgeted, released. */
  assignShadow(actorRef: string, pkg: AcademyPackage, enrollmentId: string, assignmentCode: string): { workItemId: Id } {
    return founderAdminWrite(this.#store, 'assign package shadow work', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'shadow work');
      const e = ctx.db.get<{ program_version_id: string; employee_id: string }>('SELECT program_version_id, employee_id FROM academy_enrollments WHERE id = ?', assertId(enrollmentId, 'enrollmentId'));
      if (!e) throw new QandeelError('NOT_FOUND', 'enrollment not found', { enrollmentId });
      const rec = txPackageRecord(ctx, pkg);
      if (!rec || rec.programVersionId !== e.program_version_id) throw new QandeelError('VALIDATION_FAILED', 'the enrollment is not in this package\'s program', { reason: 'PACKAGE_MISMATCH' });
      const a = pkg.shadowAssignments.find((x) => x.code === assignmentCode);
      if (!a) throw new QandeelError('NOT_FOUND', 'shadow assignment not in this package', { assignmentCode: assignmentCode.slice(0, 64) });
      const emp = getEmployeeRow(ctx, e.employee_id as Id);
      // A shadow assignment of the same code that is still open is never duplicated.
      const open = ctx.db.get<{ id: string }>(`SELECT w.id FROM academy_shadow_assignments s JOIN work_items w ON w.id = s.work_item_id WHERE s.enrollment_id = ? AND w.objective = ? AND w.state NOT IN ('FAILED', 'CANCELLED', 'SUPERSEDED')`, enrollmentId, a.objective);
      if (open) throw new QandeelError('INVALID_TRANSITION', 'this shadow assignment already exists', { reason: 'SHADOW_ALREADY_ASSIGNED', workItemId: open.id });
      const { workItem } = txCreateWorkItem(ctx, {
        objective: a.objective,
        ownerRef: emp.ref,
        riskLevel: 'R0',
        processorKind: EMPLOYEE_TASK,
        processorInput: { taskClass: pkg.taskClasses.shadow, dataClass: 'D1', maxOutputTokens: pkg.limits.shadowMaxOutputTokens, instructions: a.instructions },
      }, { actorRef: p.ref });
      txDeclareRequirements(ctx, workItem.id, { requirements: [], topics: ROLE_TOPICS(pkg.roleRef) });
      AcademyStore.for(this.#store).assignShadowWork(p.ref, enrollmentId, workItem.id);
      txAllocateWorkItemBudget(ctx, workItem.id, emp.id, { money: a.capMicros, tokens: 120_000 }, p.ref, 'academy.shadow');
      txTransition(ctx, workItem.id, { to: 'READY', reasonCode: 'academy.shadow.released', actorRef: p.ref });
      return { workItemId: workItem.id };
    });
  }
}
