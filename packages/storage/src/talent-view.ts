/**
 * COMPANY-TALENT-01 — the Staff & Training studio view: one Founder read of the canonical organization, staffing,
 * Talent Catalog, access policies, Tool readiness, Academy progress and cost (nothing here writes, spends or calls).
 *
 * Staffing evidence and definition content are the Founder's own Company content on the authenticated surface; they
 * never enter telemetry. Holdout scenario text is shown only in the definition detail (the Founder's studio), never in
 * any trainee context.
 */
import { assertId, type Id } from '@qandeel-company/domain';
import { ACCESS_POLICY_TEMPLATES } from '@qandeel-company/governance';

import { budgetFor } from './governance-core.js';
import { ts, type StoreContext } from './internal.js';
import { txActivePolicies, txRoleToolRequirements, txToolReadiness, type ToolEnvironment } from './talent-access.js';
import { mapDefinition, txCheckDefinition, txDefinition, txIdentityBindings, type DefinitionRecord } from './talent-catalog.js';
import { storeContext, type CompanyStore } from './store.js';

type Json = Record<string, unknown>;

const money = (b: ReturnType<typeof budgetFor>): Json | null => (b ? { id: b.id, currency: b.currency, capMoney: b.capMoney, spentMoney: b.spentMoney, reservedMoney: b.reservedMoney } : null);

function definitionSummary(d: DefinitionRecord): Json {
  const body = d.body as { skills?: unknown[]; scenarios?: { kind?: string; toolCode?: string }[]; program?: { founderCalibrationRequired?: boolean; competencies?: unknown[] } };
  return {
    id: d.id, kind: d.kind, code: d.code, version: d.version, roleRef: d.roleRef, title: d.title, state: d.state, sha256: d.sha256, rowVersion: d.rowVersion,
    author: d.authorRef.startsWith('employee:') ? { kind: 'EMPLOYEE', employeeId: d.authorRef.slice(9) } : { kind: 'FOUNDER' },
    proposalId: d.proposalId, submittedAt: d.submittedAt, decidedAt: d.decidedAt, updatedAt: d.updatedAt,
    ...(d.kind === 'IDENTITY_PROFILE' ? { name: (d.body as { name?: unknown }).name ?? null } : {}),
    ...(d.kind === 'ACADEMY_PROGRAM' ? { skills: (body.skills ?? []).length, scenarios: (body.scenarios ?? []).length, holdouts: (body.scenarios ?? []).filter((s) => s.kind === 'HOLDOUT').length, toolScenarios: (body.scenarios ?? []).filter((s) => typeof s.toolCode === 'string').length, competencies: (body.program?.competencies ?? []).length, founderCalibrationRequired: body.program?.founderCalibrationRequired === true } : {}),
  };
}

/** Academy spend of an Employee: model usage on its Academy attempts, shadow work and benchmark runs (micro-units). */
function academySpend(ctx: StoreContext, employeeId: Id): number {
  return Number(ctx.db.get<{ s: number }>(
    `SELECT COALESCE(SUM(u.economic_micros), 0) AS s FROM usage_records u WHERE u.work_item_id IN (
       SELECT a.work_item_id FROM academy_attempts a JOIN academy_enrollments n ON n.id = a.enrollment_id WHERE n.employee_id = ?
       UNION SELECT s.work_item_id FROM academy_shadow_assignments s JOIN academy_enrollments n ON n.id = s.enrollment_id WHERE n.employee_id = ?
       UNION SELECT b.work_item_id FROM skill_benchmark_runs b WHERE b.employee_id = ?)`,
    employeeId, employeeId, employeeId,
  )?.s ?? 0);
}

export function talentOverview(store: CompanyStore, release: readonly { code: string }[], tools: ToolEnvironment | null): Json {
  const ctx = storeContext(store);
  return ctx.db.snapshot(() => {
    const at = ts(ctx);
    const releaseCodes = new Set(release.map((p) => p.code));
    const departments = ctx.db.all<{ id: string; code: string; name: string; status: string }>('SELECT id, code, name, status FROM departments ORDER BY code').map((d) => ({ ...d, budget: money(budgetFor(ctx, 'DEPARTMENT', d.id)) }));
    const seats = ctx.db.all<{ id: string; code: string; title: string; kind: string; role_ref: string; department_id: string | null; status: string; reports_to_position_id: string | null; staffing_request_id: string | null; source: string }>(`SELECT id, code, title, kind, role_ref, department_id, status, reports_to_position_id, staffing_request_id, source FROM org_positions WHERE status <> 'RETIRED' ORDER BY department_id, kind, code`).map((p) => {
      const holder = ctx.db.get<{ employee_id: string; given_name: string; family_name: string; state: string }>(`SELECT a.employee_id, e.given_name, e.family_name, e.state FROM position_assignments a JOIN employees e ON e.id = a.employee_id WHERE a.position_id = ? AND a.kind = 'PRIMARY' AND a.status = 'ACTIVE' AND a.effective_from <= ? AND (a.effective_to IS NULL OR a.effective_to > ?) LIMIT 1`, p.id, at, at);
      return { positionId: p.id, code: p.code, title: p.title, kind: p.kind, roleRef: p.role_ref, departmentId: p.department_id, status: p.status, reportsToPositionId: p.reports_to_position_id, staffingRequestId: p.staffing_request_id, source: p.source, holder: holder ? { employeeId: holder.employee_id, name: `${holder.given_name} ${holder.family_name}`, state: holder.state } : null };
    });
    const ceo = seats.find((s) => s.kind === 'CEO');
    const ceoActive = ceo?.holder?.state === 'ACTIVE';
    const staffing = ctx.db.all('SELECT * FROM staffing_requests ORDER BY created_at DESC').map((r) => {
      const requester = ctx.db.get<{ given_name: string; family_name: string }>('SELECT given_name, family_name FROM employees WHERE id = ?', String(r.requested_by_employee_id));
      const state = String(r.state);
      return {
        id: r.id, scope: r.scope, departmentId: r.department_id, roleRef: r.role_ref, positionKind: r.position_kind, positionTitle: r.position_title, headcount: Number(r.headcount ?? 1),
        requestedBy: requester ? `${requester.given_name} ${requester.family_name}` : null, requestedByEmployeeId: r.requested_by_employee_id,
        evidence: { businessNeed: r.business_need, workloadEvidence: r.workload_evidence, skillGap: r.skill_gap, expectedValue: r.expected_value, impactIfNotStaffed: r.impact_if_not_staffed, alternatives: JSON.parse(String(r.alternatives_json)) as Json, expectedCostMicros: r.expected_cost_micros },
        state, priority: r.priority, ceoRecommendation: r.ceo_recommendation, ceoNote: r.ceo_note, consolidatedIntoId: r.consolidated_into_id, decidedAt: r.decided_at, createdAt: r.created_at,
        seats: ctx.db.all<{ id: string; title: string }>('SELECT id, title FROM org_positions WHERE staffing_request_id = ? ORDER BY created_at, id', String(r.id)),
        founderDecidable: state === 'RECOMMENDED' || (!ceoActive && ['SUBMITTED', 'CHALLENGED', 'PRIORITIZED'].includes(state)),
      };
    });
    const definitions = ctx.db.all('SELECT * FROM talent_definitions ORDER BY kind, code, version DESC').map((r) => definitionSummary(mapDefinition(r)));
    const proposals = ctx.db.all('SELECT * FROM talent_proposals ORDER BY created_at DESC').map((r) => {
      const who = ctx.db.get<{ given_name: string; family_name: string }>('SELECT given_name, family_name FROM employees WHERE id = ?', String(r.proposer_employee_id));
      return { id: r.id, kind: r.kind, proposer: who ? `${who.given_name} ${who.family_name}` : null, proposerEmployeeId: r.proposer_employee_id, subjectEmployeeId: r.subject_employee_id, departmentId: r.department_id, roleRef: r.role_ref, rationale: r.rationale, payload: JSON.parse(String(r.payload_json)) as Json, definitionId: r.definition_id, state: r.state, resultRef: r.result_ref, createdAt: r.created_at };
    });
    const active = txActivePolicies(ctx);
    const policies = ACCESS_POLICY_TEMPLATES.map((t) => {
      const p = active.find((x) => x.code === t.code) ?? null;
      const grants = p ? Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM policy_grant_links l JOIN permission_grants g ON g.id = l.grant_id WHERE l.policy_id = ? AND g.status = 'ACTIVE'`, p.id)?.n ?? 0) : 0;
      return { code: t.code, title: t.title, source: t.source, grants: t.grants.map((g) => ({ capability: g.capability, risk: g.riskCeiling, seats: g.seats })), state: p ? 'ACTIVE' : 'NOT_APPROVED', approvedAt: p?.approvedAt ?? null, activeGrants: grants };
    });
    const requirements = txRoleToolRequirements(ctx, null).map((r) => ({ ...r, readiness: txToolReadiness(ctx, r.toolCode, tools) }));
    const toolsList = ctx.db.all<{ code: string }>('SELECT code FROM tools ORDER BY code').map((t) => txToolReadiness(ctx, t.code, tools));
    const evaluations = ctx.db.all(`SELECT * FROM academy_manager_evaluations ORDER BY created_at DESC LIMIT 100`).map((m) => ({ id: m.id, attemptId: m.attempt_id, evaluatorEmployeeId: m.evaluator_employee_id, traineeEmployeeId: m.trainee_employee_id, reviewRequired: Number(m.review_required) === 1, state: m.state, scores: m.scores_json === null ? null : (JSON.parse(String(m.scores_json)) as Json), reviewedByRef: m.reviewed_by_ref, createdAt: m.created_at }));
    const people = ctx.db.all<{ id: string; given_name: string; family_name: string; role_ref: string; state: string; department_id: string | null }>('SELECT id, given_name, family_name, role_ref, state, department_id FROM employees ORDER BY created_at').map((e) => {
      const en = ctx.db.get<{ id: string; stage: string }>('SELECT id, stage FROM academy_enrollments WHERE employee_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', e.id);
      const cert = ctx.db.get<{ id: string; status: string; valid_until: string }>(`SELECT id, status, valid_until FROM certifications WHERE employee_id = ? ORDER BY issued_at DESC LIMIT 1`, e.id);
      const binding = txIdentityBindings(ctx, e.id as Id).find((b) => b.endedAt === null) ?? null;
      return {
        employeeId: e.id, name: `${e.given_name} ${e.family_name}`, roleRef: e.role_ref, state: e.state, departmentId: e.department_id,
        envelope: money(budgetFor(ctx, 'EMPLOYEE', e.id)), academySpentMicros: academySpend(ctx, e.id as Id),
        enrollment: en ?? null, certification: cert ? { id: cert.id, status: cert.status, validUntil: cert.valid_until, toolScopes: ctx.db.all('SELECT tool_code, status, readiness FROM certification_tool_scopes WHERE certification_id = ? ORDER BY tool_code', cert.id) } : null,
        identity: binding ? { definitionId: binding.definitionId, classification: binding.classification, boundAt: binding.boundAt } : null,
        policyGrants: ctx.db.all<{ capability: string; code: string }>(`SELECT l.capability, p.code FROM policy_grant_links l JOIN access_policies p ON p.id = l.policy_id JOIN permission_grants g ON g.id = l.grant_id WHERE l.employee_id = ? AND g.status = 'ACTIVE' ORDER BY p.code`, e.id),
      };
    });
    return {
      at, ceoActive, company: money(budgetFor(ctx, 'COMPANY', 'company')), departments, seats, staffing, definitions, proposals, policies, roleToolRequirements: requirements, tools: toolsList, evaluations, people,
      releaseCodes: [...releaseCodes],
    };
  });
}

/** One definition in full for the Founder's studio (content, holdouts included), its readiness and history. */
export function talentDefinitionDetail(store: CompanyStore, definitionId: string, release: readonly { code: string }[]): Json {
  const ctx = storeContext(store);
  return ctx.db.snapshot(() => {
    const d = txDefinition(ctx, assertId(definitionId, 'definitionId'));
    const check = txCheckDefinition(ctx, d.kind, d.body, new Set(release.map((p) => p.code)));
    const history = ctx.db.all<{ from_state: string | null; to_state: string; reason_code: string; actor_ref: string; occurred_at: string }>('SELECT from_state, to_state, reason_code, actor_ref, occurred_at FROM talent_definition_history WHERE definition_id = ? ORDER BY id', d.id).map((h) => ({ from: h.from_state, to: h.to_state, reasonCode: h.reason_code, actorRef: h.actor_ref, at: h.occurred_at }));
    return { definition: { ...definitionSummary(d), body: d.body }, check, history };
  });
}
