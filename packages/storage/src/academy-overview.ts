/**
 * D2-UX-01 — the company-wide Academy overview: a read-only projection of the canonical Academy, Skills and Employee
 * records (Stage 6, Stage 7), in one snapshot. It reads what the C3 / L1-02 stores already hold and writes nothing: no
 * enrollment, attempt, certification, passport, budget or lifecycle row is touched, no Work Item is created, no model is
 * called. Content-minimal: IDs, codes, states, scores and dates — never an answer, a scenario's content, an instruction
 * payload or an evaluator note (those stay in the CEO activation view, read explicitly).
 *
 * The same projection, narrowed to one Employee, gives the profile sheet its truthful "About" facts and training
 * summary: the record holds no biography, so none is invented.
 */
import type { Id } from '@qandeel-company/domain';

import { ts } from './internal.js';
import { primaryAssignmentAt } from './org-core.js';
import type { Row } from './sqlite/connection.js';
import { storeContext, type CompanyStore } from './store.js';

export interface AcademyAttemptSummary {
  readonly kind: string;
  readonly trial: number;
  readonly holdout: boolean;
  readonly state: string;
  readonly outcome: string | null;
  readonly averagePct: number | null;
  readonly createdAt: string;
  readonly evaluatedAt: string | null;
}

export interface AcademyEmployeeView {
  readonly employeeId: Id;
  readonly name: string;
  readonly displayNameAr: string | null;
  readonly roleRef: string;
  /** The seat's title (Title ≠ Authority), from the Employee's primary assignment; null without a seat. */
  readonly jobTitle: string | null;
  readonly departmentId: Id | null;
  readonly lifecycle: string;
  readonly since: string;
  /** The identity profile code the hire bound (e.g. the CEO Constitution kernel); null when none. */
  readonly identityProfile: string | null;
  /** Work on record, owned by this Employee (counts only). */
  readonly work: { readonly total: number; readonly completed: number };
  /** The latest enrollment (open or closed), or null when the Employee never entered the Academy. */
  readonly enrollment: {
    readonly stage: string;
    readonly blockedReason: string | null;
    readonly programCode: string;
    readonly programVersion: number;
    readonly modulesDone: number;
    readonly modulesTotal: number;
    readonly attempts: readonly AcademyAttemptSummary[];
    readonly remediationsOpen: number;
    readonly calibration: string | null;
    readonly activationRequest: string | null;
    readonly startedAt: string;
    readonly updatedAt: string;
  } | null;
  /** The latest certification, or null. */
  readonly certification: { readonly status: string; readonly roleRef: string; readonly issuedAt: string; readonly validUntil: string } | null;
  /** The Skill Passport: one entry per Skill. */
  readonly skills: readonly { readonly code: string; readonly name: string; readonly proficiency: string; readonly status: string; readonly trainingState: string; readonly lastTestedAt: string | null }[];
  /** What the role's active blueprint requires (Stage 7 §2), or empty when no blueprint is published for the role. */
  readonly roleRequires: readonly { readonly code: string; readonly name: string; readonly category: string; readonly minProficiency: string; readonly critical: boolean }[];
  /** Review Pool qualifications (Stage 11). */
  readonly reviewer: readonly { readonly domain: string; readonly level: string; readonly mode: string }[];
}

export interface AcademyOverview {
  readonly at: string;
  readonly employees: readonly AcademyEmployeeView[];
  readonly packages: readonly {
    readonly code: string;
    readonly version: number;
    readonly roleRef: string;
    readonly state: string;
    readonly subjectEmployeeId: Id;
    readonly createdAt: string;
    readonly installedAt: string | null;
    readonly skills: readonly { readonly code: string; readonly securityReview: 'PASSED' | 'FAILED' | 'NONE'; readonly benchmarkRuns: number }[];
  }[];
  readonly programs: readonly { readonly code: string; readonly roleRef: string; readonly version: number; readonly modules: number; readonly scenarios: number; readonly enrollments: number }[];
  readonly totals: { readonly employees: number; readonly enrolled: number; readonly certifiedValid: number; readonly attemptsEvaluated: number; readonly attemptsPassed: number; readonly packagesInstalled: number };
}

// (Row: a raw SQLite row, read only.)
const s = (v: unknown): string => String(v);
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** The overview in one snapshot. `employeeId` narrows it to one Employee (the profile sheet). Reads only. */
export function academyOverview(store: CompanyStore, options: { employeeId?: Id } = {}): AcademyOverview {
  const ctx = storeContext(store);
  return ctx.db.snapshot(() => {
    const at = ts(ctx);
    const rows = options.employeeId === undefined
      ? ctx.db.all<Row>(`SELECT * FROM employees ORDER BY created_at, rowid`)
      : ctx.db.all<Row>(`SELECT * FROM employees WHERE id = ?`, options.employeeId);
    const employees: AcademyEmployeeView[] = rows.map((r) => {
      const id = s(r.id) as Id;
      const profile = JSON.parse(s(r.profile_json)) as { displayName?: { ar?: unknown }; identityProfile?: unknown };
      const seat = primaryAssignmentAt(ctx, id, at);
      const title = seat ? sn(ctx.db.get<{ t: string }>(`SELECT title AS t FROM org_positions WHERE id = ?`, seat.positionId)?.t) : null;
      const work = ctx.db.get<{ total: number; completed: number }>(`SELECT COUNT(*) AS total, COALESCE(SUM(state = 'COMPLETED'), 0) AS completed FROM work_items WHERE owner_ref = ?`, `employee:${id}`);
      const en = ctx.db.get<Row>(`SELECT * FROM academy_enrollments WHERE employee_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, id);
      let enrollment: AcademyEmployeeView['enrollment'] = null;
      if (en) {
        const pv = ctx.db.get<{ code: string; version: number; d: string }>(`SELECT p.code AS code, v.version AS version, v.definition_json AS d FROM academy_program_versions v JOIN academy_programs p ON p.id = v.program_id WHERE v.id = ?`, s(en.program_version_id));
        const curriculum = (JSON.parse(pv?.d ?? '{}') as { curriculum?: unknown[] }).curriculum ?? [];
        enrollment = {
          stage: s(en.stage),
          blockedReason: sn(en.blocked_reason),
          programCode: pv?.code ?? '',
          programVersion: Number(pv?.version ?? 0),
          modulesDone: Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM academy_module_completions WHERE enrollment_id = ?`, s(en.id))?.n ?? 0),
          modulesTotal: curriculum.length,
          attempts: ctx.db.all<Row>(`SELECT kind, trial_no, holdout, state, outcome, average_pct, created_at, evaluated_at FROM academy_attempts WHERE enrollment_id = ? ORDER BY created_at, rowid`, s(en.id)).map((a) => ({
            kind: s(a.kind),
            trial: Number(a.trial_no),
            holdout: Number(a.holdout) === 1,
            state: s(a.state),
            outcome: sn(a.outcome),
            averagePct: a.average_pct === null ? null : Number(a.average_pct),
            createdAt: s(a.created_at),
            evaluatedAt: sn(a.evaluated_at),
          })),
          remediationsOpen: Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM academy_remediations WHERE enrollment_id = ? AND state IN ('DIAGNOSED', 'RETRAINING')`, s(en.id))?.n ?? 0),
          calibration: sn(ctx.db.get<{ state: string }>(`SELECT state FROM founder_calibrations WHERE enrollment_id = ?`, s(en.id))?.state),
          activationRequest: sn(ctx.db.get<{ state: string }>(`SELECT state FROM activation_requests WHERE enrollment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, s(en.id))?.state),
          startedAt: s(en.created_at),
          updatedAt: s(en.updated_at),
        };
      }
      const cert = ctx.db.get<Row>(`SELECT status, role_ref, issued_at, valid_until FROM certifications WHERE employee_id = ? ORDER BY issued_at DESC, rowid DESC LIMIT 1`, id);
      const blueprint = ctx.db.get<{ id: string }>(`SELECT id FROM role_blueprints WHERE role_ref = ? AND status = 'ACTIVE'`, s(r.role_ref));
      return {
        employeeId: id,
        name: `${s(r.given_name)} ${s(r.family_name)}`,
        displayNameAr: typeof profile.displayName?.ar === 'string' ? profile.displayName.ar : null,
        roleRef: s(r.role_ref),
        jobTitle: title,
        departmentId: sn(r.department_id) as Id | null,
        lifecycle: s(r.state),
        since: s(r.created_at),
        identityProfile: typeof profile.identityProfile === 'string' ? profile.identityProfile : null,
        work: { total: Number(work?.total ?? 0), completed: Number(work?.completed ?? 0) },
        enrollment,
        certification: cert ? { status: s(cert.status), roleRef: s(cert.role_ref), issuedAt: s(cert.issued_at), validUntil: s(cert.valid_until) } : null,
        skills: ctx.db.all<Row>(`SELECT k.code, k.name, p.proficiency, p.status, p.training_state, p.last_tested_at FROM passport_entries p JOIN skills k ON k.id = p.skill_id WHERE p.employee_id = ? ORDER BY k.code`, id).map((p) => ({ code: s(p.code), name: s(p.name), proficiency: s(p.proficiency), status: s(p.status), trainingState: s(p.training_state), lastTestedAt: sn(p.last_tested_at) })),
        roleRequires: blueprint
          ? ctx.db.all<Row>(`SELECT k.code, k.name, e.category, e.min_proficiency, e.critical FROM role_blueprint_entries e JOIN skills k ON k.id = e.skill_id WHERE e.blueprint_id = ? ORDER BY e.critical DESC, k.code`, blueprint.id).map((e) => ({ code: s(e.code), name: s(e.name), category: s(e.category), minProficiency: s(e.min_proficiency), critical: Number(e.critical) === 1 }))
          : [],
        reviewer: ctx.db.all<Row>(`SELECT domain, level, mode FROM reviewer_qualifications WHERE employee_id = ? AND mode <> 'REVOKED' ORDER BY domain`, id).map((q) => ({ domain: s(q.domain), level: s(q.level), mode: s(q.mode) })),
      };
    });
    const narrowed = options.employeeId !== undefined;
    const packages = narrowed
      ? []
      : ctx.db.all<Row>(`SELECT * FROM academy_packages ORDER BY created_at, rowid`).map((p) => ({
          code: s(p.code),
          version: Number(p.package_version),
          roleRef: s(p.role_ref),
          state: s(p.state),
          subjectEmployeeId: s(p.subject_employee_id) as Id,
          createdAt: s(p.created_at),
          installedAt: sn(p.installed_at),
          skills: ctx.db.all<Row>(`SELECT ps.skill_code, ps.skill_version_id, r.passed FROM academy_package_skills ps LEFT JOIN skill_security_reviews r ON r.skill_version_id = ps.skill_version_id WHERE ps.package_id = ? ORDER BY ps.skill_code`, s(p.id)).map((k) => ({
            code: s(k.skill_code),
            securityReview: k.passed === null || k.passed === undefined ? ('NONE' as const) : Number(k.passed) === 1 ? ('PASSED' as const) : ('FAILED' as const),
            benchmarkRuns: Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM skill_benchmark_runs WHERE package_id = ? AND skill_version_id = ?`, s(p.id), s(k.skill_version_id))?.n ?? 0),
          })),
        }));
    const programs = narrowed
      ? []
      : ctx.db.all<Row>(`SELECT p.code, p.role_ref, v.id AS vid, v.version, v.definition_json FROM academy_programs p JOIN academy_program_versions v ON v.program_id = p.id AND v.status = 'ACTIVE' ORDER BY p.code`).map((p) => ({
          code: s(p.code),
          roleRef: s(p.role_ref),
          version: Number(p.version),
          modules: ((JSON.parse(s(p.definition_json)) as { curriculum?: unknown[] }).curriculum ?? []).length,
          scenarios: Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM academy_scenarios WHERE program_version_id = ? AND status = 'ACTIVE'`, s(p.vid))?.n ?? 0),
          enrollments: Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM academy_enrollments WHERE program_version_id = ?`, s(p.vid))?.n ?? 0),
        }));
    const attempts = employees.flatMap((e) => e.enrollment?.attempts ?? []).filter((a) => a.state === 'EVALUATED');
    return {
      at,
      employees,
      packages,
      programs,
      totals: {
        employees: employees.length,
        enrolled: employees.filter((e) => e.enrollment !== null).length,
        certifiedValid: employees.filter((e) => e.certification?.status === 'VALID' && e.certification.validUntil > at).length,
        attemptsEvaluated: attempts.length,
        attemptsPassed: attempts.filter((a) => a.outcome === 'PASS').length,
        packagesInstalled: packages.filter((p) => p.state === 'INSTALLED').length,
      },
    };
  });
}
