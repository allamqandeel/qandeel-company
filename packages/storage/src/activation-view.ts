/**
 * L1-02 — the Company activation view: the first production CEO's path, read from durable state only (D-L1-13).
 *
 * The Founder's "Activate the Company" flow renders this view and nothing else: the CEO seat and its holder (name, title
 * from the seat, nullable portrait reference — presentation only, never authority), the provider, the Employee's envelope
 * and model access, the Academy package (skills, static security reviews, benchmark runs and their answers), the
 * enrollment (stage history, modules, attempts and their answers, rubric and evaluator results, remediations, shadow work,
 * probation, calibration, certification, the activation request) and the next step. A refresh or a restart renders the
 * same view: nothing here is held in memory. Answers are the Founder's own Company content on the authenticated surface;
 * they never enter telemetry.
 */
import type { Id } from '@qandeel-company/domain';
import { productionEligibility, scoreAnswer, type AcademyPackage, type RubricResult } from '@qandeel-company/mind';

import { txFounderFeedbackOf, type FounderFeedbackView } from './academy-feedback.js';
import { txAnswerOf } from './answers.js';
import { txPackageRecord, txPackageView, type PackageView } from './academy-packages.js';
import { budgetFor, getEmployeeRow } from './governance-core.js';
import { ts, type StoreContext } from './internal.js';
import { getSkillVersionRow, skillVersionView } from './mind-core.js';
import { mapActivation, mapAttempt, mapCertification, mapEnrollment, mapRemediation } from './mind-records.js';
import { ceoSeat, seatHolder } from './org-core.js';
import { storeContext, type CompanyStore } from './store.js';

export interface EmployeeIdentityView {
  readonly employeeId: Id;
  readonly name: string;
  readonly displayNameAr: string | null;
  /** The job title comes from the canonical seat, never from the Employee (Title ≠ Authority). */
  readonly jobTitle: string | null;
  readonly roleRef: string;
  readonly state: string;
  /** Presentation only; null until the Founder supplies / approves an asset. Never authentication, never authority. */
  readonly portraitAssetRef: string | null;
  readonly identityProfile: string | null;
}

export interface AttemptView {
  readonly id: Id;
  readonly kind: string;
  readonly trial: number;
  readonly scenarioCode: string;
  readonly scenarioKind: string;
  readonly holdout: boolean;
  readonly state: string;
  readonly outcome: string | null;
  readonly averagePct: number | null;
  readonly workItemId: Id;
  readonly workItemState: string;
  readonly answer: { readonly body: string; readonly facets: Record<string, unknown> } | null;
  readonly results: readonly { readonly dimension: string; readonly scorePct: number; readonly evaluatorKind: string }[];
  /** The package's advisory facet expectations applied to the answer (shown to the evaluator; never a score). */
  readonly advisory: RubricResult | null;
  /** D-L1-39: the Founder's notes on this attempt and the later attempts whose context carried each (manifest evidence). */
  readonly founderFeedback: readonly FounderFeedbackView[];
}

/**
 * The readiness of one certified enrollment for Production Activation. `blockers` are conditions no Founder decision
 * resolves (a certification no longer VALID, a pinned Skill version no longer production-eligible, a rejected
 * calibration, a missing request); `founderDecisions` are the remaining Founder-only steps, in order. Nothing here acts.
 */
export interface ActivationReadiness {
  readonly certification: { readonly id: Id; readonly status: string; readonly validUntil: string; readonly valid: boolean };
  readonly skillPins: readonly { readonly skillCode: string; readonly skillVersionId: Id; readonly versionLabel: string; readonly proficiency: string; readonly current: boolean; readonly reasons: readonly string[] }[];
  readonly calibration: string;
  readonly lifecycle: string;
  readonly activationRequest: { readonly id: Id; readonly state: string; readonly certificationBound: boolean } | null;
  readonly reasoning: { readonly defaultClass: string; readonly ceilingClass: string; readonly costDiscipline: string };
  readonly blockers: readonly string[];
  readonly founderDecisions: readonly string[];
}

export interface ActivationView {
  readonly at: string;
  readonly seat: { readonly positionId: Id; readonly code: string; readonly title: string; readonly roleRef: string } | null;
  readonly ceo: EmployeeIdentityView | null;
  readonly provider: { readonly provisioned: boolean; readonly status: string | null; readonly routedTaskClasses: readonly string[] };
  readonly envelope: { readonly capMoney: number; readonly spentMoney: number; readonly reservedMoney: number; readonly currency: string } | null;
  readonly companyBudget: { readonly capMoney: number; readonly spentMoney: number; readonly reservedMoney: number; readonly currency: string } | null;
  readonly modelAccess: readonly string[];
  readonly packages: readonly PackageView[];
  readonly enrollment: {
    readonly id: Id;
    readonly stage: string;
    readonly history: readonly { readonly toStage: string; readonly reasonCode: string; readonly at: string }[];
    readonly modules: readonly { readonly code: string; readonly category: string; readonly done: boolean }[];
    readonly attempts: readonly AttemptView[];
    readonly remediations: readonly { readonly id: Id; readonly state: string; readonly categories: readonly string[] }[];
    readonly shadow: readonly { readonly workItemId: Id; readonly objective: string; readonly state: string; readonly answer: { readonly body: string; readonly facets: Record<string, unknown> } | null }[];
    readonly probation: { readonly evidence: Record<string, number>; readonly reviews: readonly { readonly decision: string; readonly round: number }[] };
    readonly calibration: { readonly state: string } | null;
    readonly certification: { readonly id: Id; readonly status: string; readonly validUntil: string } | null;
    readonly activationRequest: { readonly id: Id; readonly state: string } | null;
    /** L1-02 closure: the Production Activation readiness of this enrollment (read-only, from durable state). */
    readonly readiness: ActivationReadiness | null;
  } | null;
  readonly next: string;
}

function identityOf(ctx: StoreContext, employeeId: Id, jobTitle: string | null): EmployeeIdentityView {
  const e = getEmployeeRow(ctx, employeeId);
  const p = (e.profile ?? {}) as { displayName?: { ar?: unknown }; portraitAssetRef?: unknown; identityProfile?: unknown };
  return {
    employeeId: e.id,
    name: `${e.name.given} ${e.name.family}`,
    displayNameAr: typeof p.displayName?.ar === 'string' ? p.displayName.ar : null,
    jobTitle,
    roleRef: e.roleRef,
    state: e.state,
    portraitAssetRef: typeof p.portraitAssetRef === 'string' ? p.portraitAssetRef : null,
    identityProfile: typeof p.identityProfile === 'string' ? p.identityProfile : null,
  };
}

/** The view in one snapshot. `packages` are the host-registered ones (codes, digests and contents are release-pinned). */
export function activationView(store: CompanyStore, packages: readonly AcademyPackage[]): ActivationView {
  const ctx = storeContext(store);
  return ctx.db.snapshot(() => {
    const at = ts(ctx);
    const seatRec = ceoSeat(ctx);
    const seat = seatRec ? { positionId: seatRec.id, code: seatRec.code, title: seatRec.title, roleRef: seatRec.roleRef } : null;
    const holder = seatRec ? seatHolder(ctx, seatRec.id, at).ofRecord : null;
    const ceo = holder ? identityOf(ctx, holder.employeeId, seatRec?.title ?? null) : null;
    const provider = ctx.db.get<{ status: string }>(`SELECT status FROM model_providers ORDER BY created_at LIMIT 1`);
    const routed = ctx.db.all<{ c: string }>(`SELECT task_class AS c FROM route_policies WHERE status = 'ACTIVE' ORDER BY task_class`).map((r) => r.c);
    const money = (b: ReturnType<typeof budgetFor>): ActivationView['envelope'] => (b ? { capMoney: b.capMoney, spentMoney: b.spentMoney, reservedMoney: b.reservedMoney, currency: b.currency } : null);
    const envelope = ceo ? money(budgetFor(ctx, 'EMPLOYEE', ceo.employeeId)) : null;
    const modelAccess = ceo ? ctx.db.all<{ s: string }>(`SELECT resource_scope AS s FROM permission_grants WHERE employee_id = ? AND capability = 'model.invoke' AND status = 'ACTIVE' ORDER BY resource_scope`, ceo.employeeId).map((r) => r.s) : [];
    const views = packages.filter((p) => seat === null || p.roleRef === seat.roleRef).map((p) => txPackageView(ctx, p, packages));
    const pkg = packages.find((p) => txPackageRecord(ctx, p)?.state === 'INSTALLED') ?? null;
    let enrollment: ActivationView['enrollment'] = null;
    if (ceo) {
      const row = ctx.db.get(`SELECT * FROM academy_enrollments WHERE employee_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, ceo.employeeId);
      if (row) {
        const en = mapEnrollment(row);
        const def = JSON.parse(String(ctx.db.get<{ d: string }>('SELECT definition_json AS d FROM academy_program_versions WHERE id = ?', en.programVersionId)?.d ?? '{}')) as { curriculum?: { code: string; category: string }[] };
        const done = new Set(ctx.db.all<{ m: string }>('SELECT module_code AS m FROM academy_module_completions WHERE enrollment_id = ?', en.id).map((r) => r.m));
        const attempts: AttemptView[] = ctx.db.all('SELECT * FROM academy_attempts WHERE enrollment_id = ? ORDER BY created_at, id', en.id).map(mapAttempt).map((a) => {
          const sc = ctx.db.get<{ code: string; kind: string }>('SELECT code, kind FROM academy_scenarios WHERE id = ?', a.scenarioId);
          const ans = txAnswerOf(ctx, a.workItemId);
          const expect = pkg?.scenarios.find((s) => s.code === sc?.code)?.expect;
          return {
            id: a.id,
            kind: a.kind,
            trial: a.trialNo,
            scenarioCode: sc?.code ?? '',
            scenarioKind: sc?.kind ?? '',
            holdout: a.holdout,
            state: a.state,
            outcome: a.outcome,
            averagePct: a.averagePct,
            workItemId: a.workItemId,
            workItemState: String(ctx.db.get<{ s: string }>('SELECT state AS s FROM work_items WHERE id = ?', a.workItemId)?.s ?? ''),
            answer: ans ? { body: ans.body, facets: { ...ans.facets } } : null,
            results: ctx.db.all<{ dimension: string; score_pct: number; evaluator_kind: string }>('SELECT dimension, score_pct, evaluator_kind FROM academy_dimension_results WHERE attempt_id = ? ORDER BY dimension', a.id).map((r) => ({ dimension: r.dimension, scorePct: Number(r.score_pct), evaluatorKind: r.evaluator_kind })),
            advisory: ans && expect && pkg ? scoreAnswer(expect, { body: ans.body, ...ans.facets }, pkg.limits.benchmarkPassPct) : null,
            founderFeedback: txFounderFeedbackOf(ctx, a.id),
          };
        });
        const count = (kind: string, positive: number): number => Number(ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM probation_evidence WHERE enrollment_id = ? AND kind = ? AND positive = ? AND epoch = ?', en.id, kind, positive, en.evidenceEpoch)?.n ?? 0);
        const cert = ctx.db.get(`SELECT * FROM certifications WHERE enrollment_id = ? ORDER BY issued_at DESC LIMIT 1`, en.id);
        const req = ctx.db.get(`SELECT * FROM activation_requests WHERE enrollment_id = ? ORDER BY created_at DESC LIMIT 1`, en.id);
        const certRec = cert ? mapCertification(cert) : null;
        const reqRec = req ? mapActivation(req) : null;
        enrollment = {
          id: en.id,
          stage: en.stage,
          history: ctx.db.all<{ to_stage: string; reason_code: string; occurred_at: string }>('SELECT to_stage, reason_code, occurred_at FROM academy_stage_history WHERE enrollment_id = ? ORDER BY version', en.id).map((r) => ({ toStage: r.to_stage, reasonCode: r.reason_code, at: r.occurred_at })),
          modules: (def.curriculum ?? []).map((m) => ({ code: m.code, category: m.category, done: done.has(m.code) })),
          attempts,
          remediations: ctx.db.all('SELECT * FROM academy_remediations WHERE enrollment_id = ? ORDER BY created_at, id', en.id).map(mapRemediation).map((r) => ({ id: r.id, state: r.state, categories: r.categories })),
          shadow: ctx.db.all<{ work_item_id: string; objective: string; state: string }>('SELECT s.work_item_id, w.objective, w.state FROM academy_shadow_assignments s JOIN work_items w ON w.id = s.work_item_id WHERE s.enrollment_id = ? ORDER BY s.created_at', en.id).map((s) => {
            const ans = txAnswerOf(ctx, s.work_item_id as Id);
            return { workItemId: s.work_item_id as Id, objective: s.objective, state: s.state, answer: ans ? { body: ans.body, facets: { ...ans.facets } } : null };
          }),
          probation: {
            evidence: { CASE: count('CASE', 1), QUALITY: count('QUALITY', 1), DEMONSTRATED_LEARNING: count('DEMONSTRATED_LEARNING', 1), COST_DISCIPLINE: count('COST_DISCIPLINE', 1), CORRECT_ESCALATION: count('CORRECT_ESCALATION', 1), COLLABORATION: count('COLLABORATION', 1), CRITICAL_FAILURE: count('CRITICAL_FAILURE', 0) },
            reviews: ctx.db.all<{ decision: string; review_round: number }>('SELECT decision, review_round FROM probation_reviews WHERE enrollment_id = ? ORDER BY decided_at', en.id).map((r) => ({ decision: r.decision, round: Number(r.review_round) })),
          },
          calibration: (() => {
            const c = ctx.db.get<{ state: string }>('SELECT state FROM founder_calibrations WHERE enrollment_id = ?', en.id);
            return c ? { state: c.state } : null;
          })(),
          certification: certRec ? { id: certRec.id, status: certRec.status, validUntil: certRec.validUntil } : null,
          activationRequest: reqRec ? { id: reqRec.id, state: reqRec.state } : null,
          readiness: certRec ? readinessOf(ctx, at, certRec, reqRec, ctx.db.get<{ state: string }>('SELECT state FROM founder_calibrations WHERE enrollment_id = ?', en.id)?.state ?? 'NOT_REQUIRED', ceo.employeeId) : null,
        };
      }
    }
    const view = { at, seat, ceo, provider: { provisioned: provider !== undefined, status: provider?.status ?? null, routedTaskClasses: routed }, envelope, companyBudget: money(budgetFor(ctx, 'COMPANY', 'company')), modelAccess, packages: views, enrollment };
    return { ...view, next: nextStep(view) };
  });
}

function readinessOf(ctx: StoreContext, at: string, cert: ReturnType<typeof mapCertification>, req: ReturnType<typeof mapActivation> | null, calibration: string, employeeId: Id): ActivationReadiness {
  const e = getEmployeeRow(ctx, employeeId);
  const valid = cert.status === 'VALID' && cert.validUntil > at && cert.roleRef === e.roleRef;
  const skillPins = cert.skillPins.map((p) => {
    const v = getSkillVersionRow(ctx, p.skillVersionId);
    const s = ctx.db.get<{ code: string; skill_type: string }>('SELECT code, skill_type FROM skills WHERE id = ?', v.skillId);
    const elig = productionEligibility(skillVersionView(v, s?.skill_type as Parameters<typeof skillVersionView>[1]));
    return { skillCode: s?.code ?? '', skillVersionId: v.id, versionLabel: v.versionLabel, proficiency: String(p.proficiency), current: elig.eligible, reasons: [...elig.reasons] };
  });
  const open = req !== null && req.state === 'PENDING_APPROVAL';
  const blockers = [
    ...(valid ? [] : [`CERTIFICATION_${cert.status === 'VALID' ? 'EXPIRED' : cert.status}`]),
    ...(skillPins.every((p) => p.current) ? [] : ['SKILL_PIN_NOT_CURRENT']),
    ...(calibration === 'REJECTED' ? ['CALIBRATION_REJECTED'] : []),
    ...(open ? (req?.certificationId === cert.id ? [] : ['REQUEST_NOT_BOUND_TO_CERTIFICATION']) : ['ACTIVATION_REQUEST_MISSING']),
    ...(['SHADOW', 'PROBATION', 'TRAINING'].includes(e.state) ? [] : [`LIFECYCLE_${e.state}`]),
  ];
  const founderDecisions = [
    ...(calibration === 'PENDING' ? ['ACADEMY_CALIBRATION'] : []),
    ...(e.state === 'TRAINING' ? ['EMPLOYEE_LIFECYCLE_TO_PROBATION'] : []),
    ...(open ? ['ACTIVATION_DECIDE'] : []),
  ];
  const p = e.cognitiveProfile as { defaultClass?: string; ceilingClass?: string; costDiscipline?: string };
  return {
    certification: { id: cert.id, status: cert.status, validUntil: cert.validUntil, valid },
    skillPins,
    calibration,
    lifecycle: e.state,
    activationRequest: req ? { id: req.id, state: req.state, certificationBound: req.certificationId === cert.id } : null,
    reasoning: { defaultClass: String(p.defaultClass ?? ''), ceilingClass: String(p.ceilingClass ?? ''), costDiscipline: String(p.costDiscipline ?? '') },
    blockers,
    founderDecisions,
  };
}

/** The next step of the flow (a code the surface renders in Arabic / English). Deterministic from the view. */
function nextStep(v: Omit<ActivationView, 'next'>): string {
  if (!v.provider.provisioned) return 'PROVISION_PROVIDER';
  if (v.seat === null) return 'NO_CEO_SEAT';
  if (v.ceo === null) return 'HIRE_CEO';
  if (v.ceo.state === 'ACTIVE') return 'TALK_TO_CEO';
  if (v.ceo.state === 'CANDIDATE') return 'START_TRAINING';
  if (v.envelope === null || v.modelAccess.length === 0) return 'GRANT_MODEL_ACCESS';
  const p = v.packages[0];
  if (!p?.record) return 'QUALIFY_PACKAGE';
  if (p.record.state === 'QUALIFYING') return p.benchmarkRunsOpen > 0 ? 'BENCHMARK_RUNNING' : p.benchmarkRunsUnclassified > 0 ? 'BENCHMARK_UNCLASSIFIED_NO_ANSWER' : p.installable ? 'INSTALL_PACKAGE' : 'PACKAGE_NOT_QUALIFIED';
  const en = v.enrollment;
  if (en === null) return 'ENROLL';
  const open = en.attempts.find((a) => a.state === 'OPEN');
  if (open) return ['COMPLETED', 'FAILED', 'CANCELLED', 'SUPERSEDED'].includes(open.workItemState) ? 'EVALUATE_ATTEMPT' : 'ATTEMPT_RUNNING';
  switch (en.stage) {
    case 'LEARN':
    case 'CASE_STUDIES':
      return 'COMPLETE_MODULES';
    case 'SIMULATION':
      return 'START_SIMULATION';
    case 'RETRY':
      return en.remediations.some((r) => r.state === 'DIAGNOSED' || r.state === 'RETRAINING') ? 'COMPLETE_RETRAINING' : 'START_RETEST';
    case 'ASSESSMENT':
      return 'START_ASSESSMENT';
    case 'SHADOW_WORK': {
      if (en.shadow.length === 0) return 'ASSIGN_SHADOW_WORK';
      const s = en.shadow.at(-1);
      if (s && !['COMPLETED', 'FAILED', 'CANCELLED', 'SUPERSEDED'].includes(s.state)) return 'SHADOW_RUNNING';
      return 'RECORD_PROBATION_EVIDENCE';
    }
    case 'PROBATION_REVIEW':
      return 'PROBATION_REVIEW';
    case 'CERTIFICATION':
      return 'CERTIFICATION_WAITING';
    case 'ACTIVATION_APPROVAL': {
      // A condition no Founder decision resolves is surfaced first: a preview would never offer a step the gate refuses.
      const blocker = en.readiness?.blockers[0];
      if (blocker !== undefined && blocker !== 'ACTIVATION_REQUEST_MISSING') return blocker;
      if (en.calibration?.state === 'PENDING') return 'FOUNDER_CALIBRATION';
      if (v.ceo.state !== 'SHADOW' && v.ceo.state !== 'PROBATION') return 'MOVE_TO_PROBATION';
      return en.activationRequest?.state === 'PENDING_APPROVAL' ? 'DECIDE_ACTIVATION' : 'ACTIVATION_REQUEST_MISSING';
    }
    case 'BLOCKED':
      return 'BLOCKED';
    default:
      return en.stage;
  }
}
