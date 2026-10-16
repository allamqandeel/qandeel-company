/**
 * COMPANY-TALENT-01 — the structured-only Talent intents of the governed Founder confirmation.
 *
 * Same boundary as every Founder act: each intent is validated against durable state at PREVIEW (a preview never offers
 * a step the confirmation would refuse), pinned by its fingerprint, and executed at CONFIRM inside the one confirm
 * transaction by the canonical store it names. Payloads carry IDs, codes, digests and bounded numbers only (a definition's
 * content stays in the Talent Catalog; the preview pins its digest). Nothing here creates an Employee except through
 * the existing hire, and nothing makes anyone ACTIVE.
 */
import { QandeelError, assertCode, assertId, newId, type Id } from '@qandeel-company/domain';
import { assertToolCode, isStaffableKind, type MutatingIntent } from '@qandeel-company/governance';
import type { AcademyPackage } from '@qandeel-company/mind';

import { budgetFor, getEmployeeRow } from './governance-core.js';
import { GovernanceStore } from './governance.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { getPosition } from './org-core.js';
import { OrganizationStore } from './organization.js';
import { executeAccessPolicy, executeToolAccess, txPlanAccessPolicy, txPlanToolAccess, type ToolEnvironment } from './talent-access.js';
import { mapDefinition, txBindIdentity, txCheckDefinition, txDecideDefinition, txDefinition, txLiveIdentityBinding, txSaveDraft } from './talent-catalog.js';
import { txExecuteEvaluationAssign, txPlanEvaluationAssign, txReviewManagerEvaluation } from './talent-org.js';
import type { CompanyStore } from './store.js';

export type TalentPayload = Record<string, string | number | boolean | null | readonly string[]>;

export interface TalentEnv {
  readonly releasePackages: readonly AcademyPackage[];
  readonly tools: ToolEnvironment | null;
}

const refuse = (reason: string, message: string, details: Record<string, string | number | boolean | null> = {}): never => {
  throw new QandeelError('VALIDATION_FAILED', message, { reason, ...details });
};
const transition = (reason: string, message: string, details: Record<string, string | number | boolean | null> = {}): never => {
  throw new QandeelError('INVALID_TRANSITION', message, { reason, ...details });
};
const nameOf = (e: { name: { given: string; family: string } }): string => `${e.name.given} ${e.name.family}`;

function proposalRow(ctx: StoreContext, id: unknown): { id: Id; kind: string; state: string; proposer_employee_id: string; subject_employee_id: string | null; department_id: string | null; role_ref: string | null; payload_json: string; definition_id: string | null; version: number } {
  const r = ctx.db.get<{ id: string; kind: string; state: string; proposer_employee_id: string; subject_employee_id: string | null; department_id: string | null; role_ref: string | null; payload_json: string; definition_id: string | null; version: number }>('SELECT * FROM talent_proposals WHERE id = ?', assertId(id, 'proposalId'));
  if (!r) throw new QandeelError('NOT_FOUND', 'talent proposal not found', { proposalId: String(id).slice(0, 36) });
  return { ...r, id: r.id as Id };
}

/** The draft program a SKILL proposal lands in: the role's newest draft, else a new draft version of its newest approved program. */
function skillTarget(ctx: StoreContext, roleRef: string): { kind: 'DRAFT'; id: Id; code: string } | { kind: 'NEW'; fromId: Id; code: string; version: number } | null {
  const draft = ctx.db.get<{ id: string; code: string }>(`SELECT id, code FROM talent_definitions WHERE kind = 'ACADEMY_PROGRAM' AND role_ref = ? AND state = 'DRAFT' ORDER BY updated_at DESC LIMIT 1`, roleRef);
  if (draft) return { kind: 'DRAFT', id: draft.id as Id, code: draft.code };
  const approved = ctx.db.get<{ id: string; code: string; version: number }>(`SELECT id, code, version FROM talent_definitions WHERE kind = 'ACADEMY_PROGRAM' AND role_ref = ? AND state = 'APPROVED' ORDER BY version DESC LIMIT 1`, roleRef);
  if (!approved) return null;
  const top = ctx.db.get<{ v: number }>(`SELECT MAX(version) AS v FROM talent_definitions WHERE kind = 'ACADEMY_PROGRAM' AND code = ?`, approved.code)?.v ?? approved.version;
  return { kind: 'NEW', fromId: approved.id as Id, code: approved.code, version: Number(top) + 1 };
}

/** Validates one Talent intent's payload against durable state; returns the canonical payload. */
export function validateTalentPayload(ctx: StoreContext, intent: MutatingIntent, raw: Record<string, unknown>, env: TalentEnv): TalentPayload {
  const releaseCodes = new Set(env.releasePackages.map((p) => p.code));
  switch (intent) {
    case 'TALENT_DEFINITION_DECIDE': {
      const d = txDefinition(ctx, assertId(raw.definitionId, 'definitionId'));
      const decision = raw.decision;
      if (decision !== 'APPROVE' && decision !== 'REJECT') refuse('DECISION', 'decision is APPROVE or REJECT', { field: 'decision' });
      if (d.state !== 'DRAFT' && d.state !== 'SUBMITTED') transition('DEFINITION_DECIDED', 'only a draft or submitted definition is decided', { state: d.state });
      const check = txCheckDefinition(ctx, d.kind, d.body, releaseCodes);
      if (decision === 'APPROVE' && !check.ok) refuse('DEFINITION_INCOMPLETE', `the definition is not complete: ${check.gaps[0]?.field ?? ''} (${check.gaps[0]?.reason ?? ''})`, { gaps: check.gaps.length });
      const sha = d.sha256 ?? check.sha256 ?? '';
      if (decision === 'REJECT' && d.state === 'DRAFT') transition('NOT_SUBMITTED', 'a draft is withdrawn by its author; the Founder rejects a submitted definition');
      const prior = ctx.db.get<{ version: number }>(`SELECT version FROM talent_definitions WHERE kind = ? AND code = ? AND state = 'APPROVED'`, d.kind, d.code);
      const pkg = d.kind === 'ACADEMY_PROGRAM' ? (d.body as unknown as AcademyPackage) : null;
      return {
        definitionId: d.id, kind: d.kind, code: d.code, version: d.version, roleRef: d.roleRef, title: d.title.slice(0, 160), state: d.state, rowVersion: d.rowVersion,
        sha256: sha, decision: String(decision), authorRef: d.authorRef.startsWith('employee:') ? 'EMPLOYEE_PROPOSAL' : 'FOUNDER',
        supersedesVersion: prior ? Number(prior.version) : 0,
        ...(pkg ? { skills: pkg.skills.length, scenarios: pkg.scenarios.length, holdouts: pkg.scenarios.filter((s) => s.kind === 'HOLDOUT').length, toolScenarios: pkg.scenarios.filter((s) => s.toolCode !== undefined).length, competencies: (pkg.program.competencies ?? []).length, founderCalibrationRequired: pkg.program.founderCalibrationRequired, benchmarkCasesNew: pkg.skills.filter((s) => s.binding !== 'REUSE_QUALIFIED').reduce((n, s) => n + s.benchmark.length, 0), benchmarkCapMicros: pkg.limits.benchmarkCapMicros, attemptCapMicros: pkg.limits.attemptCapMicros } : {}),
        grants: 'NONE', budgetChange: 'NONE', providerCall: 'NONE',
        reasonCode: assertCode(raw.reasonCode ?? (decision === 'APPROVE' ? 'talent.approved' : 'talent.rejected'), 'reasonCode'),
      };
    }
    case 'TALENT_PROPOSAL_DECIDE': {
      const p = proposalRow(ctx, raw.proposalId);
      const decision = raw.decision;
      if (decision !== 'ACCEPT' && decision !== 'DECLINE') refuse('DECISION', 'decision is ACCEPT or DECLINE', { field: 'decision' });
      if (p.state !== 'PROPOSED') transition('PROPOSAL_DECIDED', 'this proposal is already decided', { state: p.state });
      const proposer = getEmployeeRow(ctx, p.proposer_employee_id as Id);
      const payload = JSON.parse(p.payload_json) as Record<string, unknown>;
      const base = { proposalId: p.id, kind: p.kind, proposer: nameOf(proposer), proposerEmployeeId: proposer.id, decision: String(decision), version: p.version };
      if (decision === 'DECLINE') return { ...base, effect: 'NONE', reasonCode: assertCode(raw.reasonCode ?? 'talent.proposal_declined', 'reasonCode') };
      switch (p.kind) {
        case 'IDENTITY_PROFILE':
        case 'ACADEMY_PROGRAM':
          // The proposal is already a draft: accepting it keeps the draft for the Founder to edit, submit and approve.
          return { ...base, effect: 'DRAFT_KEPT_FOR_REVIEW', definitionId: p.definition_id, reasonCode: assertCode(raw.reasonCode ?? 'talent.proposal_accepted', 'reasonCode') };
        case 'SKILL': {
          const t = skillTarget(ctx, String(p.role_ref));
          if (t === null) transition('NO_PROGRAM_FOR_ROLE', 'the role has no draft or approved program to add the Skill to (create the program first)');
          const skill = payload.skill as { code?: unknown };
          if (typeof skill?.code !== 'string') refuse('SKILL_SHAPE', 'the proposed Skill has a code');
          return { ...base, effect: t?.kind === 'DRAFT' ? 'ADDED_TO_DRAFT' : 'NEW_DRAFT_VERSION', targetCode: String(t?.code), skillCode: String(skill.code), roleRef: String(p.role_ref), reasonCode: assertCode(raw.reasonCode ?? 'talent.proposal_accepted', 'reasonCode') };
        }
        case 'RETRAIN': {
          const s = getEmployeeRow(ctx, p.subject_employee_id as Id);
          if (s.state !== 'ACTIVE') transition('SUBJECT_NOT_ACTIVE', 'only an ACTIVE Employee is moved to retraining', { state: s.state });
          return { ...base, effect: 'ACTIVE_TO_RETRAINING', subjectEmployeeId: s.id, subject: nameOf(s), reasonCode: assertCode(raw.reasonCode ?? 'talent.retrain', 'reasonCode') };
        }
        case 'DEPARTMENT_BUDGET': {
          const dept = String(p.department_id);
          const company = budgetFor(ctx, 'COMPANY', 'company');
          if (!company) transition('COMPANY_BUDGET_MISSING', 'provision the Company cap first');
          const cap = Number(payload.capMoney);
          if (cap > Number(company?.capMoney)) refuse('CAP_ABOVE_COMPANY', 'a Department cap is within the Company cap');
          const existing = budgetFor(ctx, 'DEPARTMENT', dept);
          return { ...base, effect: existing ? 'DEPARTMENT_CAP_CHANGED' : 'DEPARTMENT_BUDGET_CREATED', departmentId: dept, capMoney: cap, capTokens: Number(payload.capTokens), previousCapMoney: existing?.capMoney ?? 0, currency: company?.currency ?? 'USD', reasonCode: assertCode(raw.reasonCode ?? 'talent.department_budget', 'reasonCode') };
        }
        default:
          return refuse('PROPOSAL_KIND', 'unknown proposal kind');
      }
    }
    case 'EMPLOYEE_IDENTITY_REVISE': {
      const e = getEmployeeRow(ctx, assertId(raw.employeeId, 'employeeId'));
      if (e.state === 'RETIRED') transition('RETIRED', 'a retired Employee\'s record is history');
      const d = txDefinition(ctx, assertId(raw.definitionId, 'definitionId'));
      if (d.kind !== 'IDENTITY_PROFILE' || d.state !== 'APPROVED') refuse('IDENTITY_NOT_APPROVED', 'only an approved identity profile is bound');
      if (d.roleRef !== e.roleRef) refuse('IDENTITY_ROLE_MISMATCH', 'the identity profile belongs to another role');
      const classification = raw.classification;
      if (classification !== 'MINOR' && classification !== 'MATERIAL') refuse('CLASSIFICATION', 'a revision is MINOR or MATERIAL', { field: 'classification' });
      const live = txLiveIdentityBinding(ctx, e.id);
      if (live?.definitionId === d.id) transition('IDENTITY_UNCHANGED', 'the Employee already carries this identity version');
      const due = classification === 'MATERIAL' ? ctx.db.all<{ id: string }>(`SELECT id FROM certifications WHERE employee_id = ? AND status = 'VALID'`, e.id).length : 0;
      return { employeeId: e.id, name: nameOf(e), roleRef: e.roleRef, definitionId: d.id, code: d.code, version: d.version, sha256: String(d.sha256), previousVersion: live ? Number(ctx.db.get<{ v: number }>('SELECT version AS v FROM talent_definitions WHERE id = ?', live.definitionId)?.v ?? 0) : 0, classification: String(classification), certificationsReviewDue: due, historyChange: 'APPENDED', authorityChange: 'NONE', budgetChange: 'NONE', reasonCode: assertCode(raw.reasonCode ?? 'founder.identity_revision', 'reasonCode') };
    }
    case 'POSITION_CREATE': {
      const departmentId = assertId(raw.departmentId, 'departmentId');
      const dept = ctx.db.get<{ id: string; code: string; status: string; name: string }>('SELECT id, code, status, name FROM departments WHERE id = ?', departmentId);
      if (!dept || dept.status !== 'ACTIVE') transition('DEPARTMENT_NOT_ACTIVE', 'a seat opens in an existing, active Department');
      const kind = raw.kind;
      if (!isStaffableKind(kind)) refuse('POSITION_KIND', 'a new seat is a MANAGER, LEAD or SPECIALIST seat (Director seats come from the canonical map)', { field: 'kind' });
      const roleRef = typeof raw.roleRef === 'string' && /^role:[a-z][a-z0-9.-]{1,60}$/.test(raw.roleRef) ? raw.roleRef : refuse('ROLE_REF', 'roleRef is role:<code>', { field: 'roleRef' });
      const title = typeof raw.title === 'string' && raw.title.trim().length > 0 && raw.title.length <= 120 ? raw.title.trim() : refuse('TITLE', 'title is 1..120 characters', { field: 'title' });
      const reportsTo = raw.reportsToPositionId === undefined || raw.reportsToPositionId === null ? (ctx.db.get<{ id: string }>(`SELECT id FROM org_positions WHERE kind = 'DIRECTOR' AND department_id = ? AND status <> 'RETIRED'`, departmentId)?.id ?? null) : assertId(raw.reportsToPositionId, 'reportsToPositionId');
      if (reportsTo === null) transition('NO_REPORTING_SEAT', 'the Department has no Director seat to report to');
      const parent = getPosition(ctx, reportsTo as Id);
      if (parent.departmentId !== departmentId) refuse('REPORTS_ACROSS_DEPARTMENTS', 'a Department seat reports within its Department');
      const code = typeof raw.code === 'string' && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,7}$/.test(raw.code) ? raw.code : `${dept?.code}.${String(roleRef).slice(5).split('.').at(-1)}.${newId().slice(0, 4)}`;
      if (ctx.db.get('SELECT 1 AS x FROM org_positions WHERE code = ?', code)) refuse('POSITION_CODE_TAKEN', 'a seat with this code exists', { field: 'code' });
      return { departmentId, departmentCode: String(dept?.code), departmentName: String(dept?.name).slice(0, 80), kind: String(kind), roleRef, title, code, reportsToPositionId: parent.id, reportsToTitle: parent.title.slice(0, 120), hires: 'NONE', budgetChange: 'NONE', reasonCode: assertCode(raw.reasonCode ?? 'founder.position_created', 'reasonCode') };
    }
    case 'DEPARTMENT_BUDGET': {
      const departmentId = assertId(raw.departmentId, 'departmentId');
      const dept = ctx.db.get<{ status: string; name: string }>('SELECT status, name FROM departments WHERE id = ?', departmentId);
      if (!dept || dept.status !== 'ACTIVE') transition('DEPARTMENT_NOT_ACTIVE', 'a Department budget is for an existing, active Department');
      const company = budgetFor(ctx, 'COMPANY', 'company');
      if (!company) transition('COMPANY_BUDGET_MISSING', 'provision the Company cap first');
      if (budgetFor(ctx, 'DEPARTMENT', departmentId)) transition('DEPARTMENT_BUDGET_EXISTS', 'this Department already has a budget (change its ceiling instead)');
      const capMoney = raw.capMoney;
      if (typeof capMoney !== 'number' || !Number.isSafeInteger(capMoney) || capMoney <= 0 || capMoney > Number(company?.capMoney)) refuse('CAP', 'a Department cap is a bounded positive amount within the Company cap', { field: 'capMoney' });
      const capTokens = raw.capTokens ?? Math.max(1_000_000, Number(capMoney) * 2);
      if (typeof capTokens !== 'number' || !Number.isSafeInteger(capTokens) || capTokens <= 0) refuse('CAP', 'capTokens is a positive integer', { field: 'capTokens' });
      return { departmentId, departmentName: String(dept?.name).slice(0, 80), currency: String(company?.currency), capMoney: Number(capMoney), capTokens: Number(capTokens), companyCapMoney: Number(company?.capMoney), spend: 'NONE', reasonCode: assertCode(raw.reasonCode ?? 'founder.department_budget', 'reasonCode') };
    }
    case 'ACCESS_POLICY_DECIDE': {
      const plan = txPlanAccessPolicy(ctx, { policyCode: raw.policyCode, decision: raw.decision, repository: raw.repository });
      const label = (x: { employeeId: Id }): string => nameOf(getEmployeeRow(ctx, x.employeeId));
      return {
        policyCode: plan.template.code, title: plan.template.title, decision: plan.decision, policyId: plan.policyId,
        registerSource: plan.registerSource, registerTool: plan.registerTool,
        issue: plan.plan.issue.map((x) => `${label(x)}: ${x.capability}`), adopt: plan.plan.adopt.map((x) => `${label(x)}: ${x.capability}`), revoke: plan.plan.revoke.map((x) => `${label(x)}: ${x.capability}`),
        eligibility: 'PRIMARY CEO / Director seat; issued from the hire (CANDIDATE); revoked on leaving the seat, SUSPENDED or RETIRED',
        authority: plan.template.grants.map((g) => `${g.capability} ${g.riskCeiling}`).join(', '), budgetChange: 'NONE', providerCall: 'NONE',
        reasonCode: assertCode(raw.reasonCode ?? (plan.decision === 'APPROVE' ? 'founder.access_policy' : 'founder.access_policy_revoked'), 'reasonCode'),
      };
    }
    case 'ROLE_TOOL_REQUIREMENT': {
      const roleRef = typeof raw.roleRef === 'string' && /^role:[a-z][a-z0-9.-]{1,60}$/.test(raw.roleRef) ? raw.roleRef : refuse('ROLE_REF', 'roleRef is role:<code>', { field: 'roleRef' });
      const toolCode = assertToolCode(raw.toolCode, 'toolCode');
      const decision = raw.decision ?? 'ADD';
      if (decision !== 'ADD' && decision !== 'REMOVE') refuse('DECISION', 'decision is ADD or REMOVE', { field: 'decision' });
      const live = ctx.db.get<{ id: string }>(`SELECT id FROM role_tool_requirements WHERE role_ref = ? AND tool_code = ? AND state = 'ACTIVE'`, roleRef, toolCode);
      if (decision === 'ADD' && live) transition('REQUIREMENT_EXISTS', 'this role already needs this tool');
      if (decision === 'REMOVE' && !live) transition('NO_REQUIREMENT', 'this role does not list this tool');
      const purpose = decision === 'ADD' ? (typeof raw.purpose === 'string' && raw.purpose.trim().length > 0 && raw.purpose.length <= 400 ? raw.purpose.trim() : refuse('PURPOSE', 'say what the tool is for (1..400 characters)', { field: 'purpose' })) : null;
      const tool = ctx.db.get<{ status: string }>('SELECT status FROM tools WHERE code = ?', toolCode);
      return { roleRef, toolCode, decision: String(decision), purpose, requirementId: live?.id ?? null, registered: tool !== undefined, toolGrant: 'NONE', integration: 'NONE', reasonCode: assertCode(raw.reasonCode ?? 'founder.role_tool', 'reasonCode') };
    }
    case 'TOOL_ACCESS': {
      const plan = txPlanToolAccess(ctx, { employeeId: raw.employeeId, toolCode: raw.toolCode, actionCode: raw.actionCode, decision: raw.decision }, env.tools);
      return { employeeId: plan.employee.id, name: nameOf(plan.employee), decision: plan.decision, toolCode: plan.toolCode, actionCode: plan.actionCode, capability: plan.capability, risk: plan.risk, dataClass: plan.dataClass, costPerCallMicros: plan.costPerCallMicros, grantIds: [...plan.grantIds], reasonCode: assertCode(raw.reasonCode ?? (plan.decision === 'GRANT' ? 'founder.tool_access' : 'founder.tool_access_revoked'), 'reasonCode') };
    }
    case 'EMPLOYEE_RETRAIN': {
      const e = getEmployeeRow(ctx, assertId(raw.employeeId, 'employeeId'));
      if (e.state !== 'ACTIVE') transition('NOT_ACTIVE', 'only an ACTIVE Employee is moved to retraining', { state: e.state });
      return { employeeId: e.id, name: nameOf(e), roleRef: e.roleRef, from: 'ACTIVE', to: 'RETRAINING', identityChange: 'NONE', historyChange: 'APPENDED', certifications: 'KEPT_AS_HISTORY', returnPath: 'Academy enrollment, then SHADOW / PROBATION and the activation decision', reasonCode: assertCode(raw.reasonCode ?? 'founder.retrain', 'reasonCode') };
    }
    case 'ACADEMY_EVALUATION_ASSIGN': {
      const plan = txPlanEvaluationAssign(ctx, { attemptId: raw.attemptId, evaluatorEmployeeId: raw.evaluatorEmployeeId, taskClass: raw.taskClass, capMicros: raw.capMicros });
      const evaluator = getEmployeeRow(ctx, plan.evaluatorId);
      const trainee = getEmployeeRow(ctx, plan.traineeId);
      const b = budgetFor(ctx, 'EMPLOYEE', evaluator.id);
      if (!b) transition('NO_ENVELOPE', 'the manager has no envelope for its evaluation work');
      return { attemptId: plan.attemptId, attemptKind: plan.attemptKind, scenarioCode: plan.scenarioCode, scenarioKind: plan.scenarioKind, evaluatorEmployeeId: evaluator.id, evaluator: nameOf(evaluator), traineeEmployeeId: trainee.id, trainee: nameOf(trainee), answerRef: `work_answer:${plan.answerId}`, answerSha256: plan.answerSha256, reviewRequired: plan.reviewRequired, taskClass: plan.taskClass, capMicros: plan.capMicros, envelopeRemainingMicros: b ? Math.max(0, b.capMoney - b.spentMoney - b.reservedMoney) : 0, competencies: [...plan.competencies], reasonCode: assertCode(raw.reasonCode ?? 'founder.evaluation_assigned', 'reasonCode') };
    }
    case 'ACADEMY_EVALUATION_REVIEW': {
      const id = assertId(raw.evaluationId, 'evaluationId');
      const m = ctx.db.get<{ state: string; review_required: number; scores_json: string | null; evaluator_employee_id: string; trainee_employee_id: string; attempt_id: string }>('SELECT state, review_required, scores_json, evaluator_employee_id, trainee_employee_id, attempt_id FROM academy_manager_evaluations WHERE id = ?', id);
      if (!m) throw new QandeelError('NOT_FOUND', 'manager evaluation not found', { evaluationId: id });
      if (m.state !== 'PROPOSED' || m.review_required !== 1) transition('NOT_AWAITING_REVIEW', 'only a proposed assessment evaluation is reviewed', { state: m.state });
      const decision = raw.decision;
      if (decision !== 'CONFIRM' && decision !== 'REJECT') refuse('DECISION', 'decision is CONFIRM or REJECT', { field: 'decision' });
      const scores = JSON.parse(String(m.scores_json)) as { dimensions: Record<string, number>; competencies: Record<string, number> };
      return { evaluationId: id, attemptId: m.attempt_id, evaluator: nameOf(getEmployeeRow(ctx, m.evaluator_employee_id as Id)), trainee: nameOf(getEmployeeRow(ctx, m.trainee_employee_id as Id)), decision: String(decision), scores: [...Object.entries(scores.dimensions), ...Object.entries(scores.competencies)].map(([k, v]) => `${k}:${v}`), reasonCode: assertCode(raw.reasonCode ?? 'founder.evaluation_reviewed', 'reasonCode') };
    }
    default:
      return refuse('UNKNOWN_INTENT', 'unknown talent intent', { field: 'intent' });
  }
}

/** Executes one confirmed Talent intent at its canonical boundary (inside the confirm transaction). */
export function executeTalent(store: CompanyStore, ctx: StoreContext, founderRef: string, intent: string, pl: Record<string, unknown>, env: TalentEnv): string {
  const str = (k: string): string => String(pl[k]);
  const releaseCodes = new Set(env.releasePackages.map((p) => p.code));
  switch (intent) {
    case 'TALENT_DEFINITION_DECIDE': {
      const d = txDefinition(ctx, str('definitionId') as Id);
      if (d.rowVersion !== Number(pl.rowVersion)) throw new QandeelError('INVALID_TRANSITION', 'the definition changed since the preview', { reason: 'PREVIEW_STALE' });
      const out = txDecideDefinition(ctx, founderRef, d.id, { decision: pl.decision as 'APPROVE', expectedSha256: str('sha256'), reasonCode: str('reasonCode') }, releaseCodes);
      return `talent_definition:${out.id}`;
    }
    case 'TALENT_PROPOSAL_DECIDE': {
      const p = proposalRow(ctx, str('proposalId'));
      if (p.state !== 'PROPOSED' || p.version !== Number(pl.version)) throw new QandeelError('INVALID_TRANSITION', 'the proposal changed since the preview', { reason: 'PREVIEW_STALE' });
      let result = `talent_proposal:${p.id}`;
      if (pl.decision === 'ACCEPT') {
        const payload = JSON.parse(p.payload_json) as Record<string, unknown>;
        if (p.kind === 'SKILL') {
          const t = skillTarget(ctx, String(p.role_ref));
          if (t === null) throw new QandeelError('INVALID_TRANSITION', 'the role has no program to add the Skill to', { reason: 'NO_PROGRAM_FOR_ROLE' });
          const skill = payload.skill as Record<string, unknown>;
          if (t.kind === 'DRAFT') {
            const d = txDefinition(ctx, t.id);
            const body = d.body as { skills?: Record<string, unknown>[] };
            const draft = txSaveDraft(ctx, founderRef, { kind: 'ACADEMY_PROGRAM', definitionId: d.id, expectedRowVersion: d.rowVersion, body: { ...body, skills: [...(body.skills ?? []).filter((s) => s.code !== skill.code), skill] } });
            result = `talent_definition:${draft.id}`;
          } else {
            const from = mapDefinition(ctx.db.get('SELECT * FROM talent_definitions WHERE id = ?', t.fromId) ?? {});
            const body = from.body as { skills?: Record<string, unknown>[] };
            const draft = txSaveDraft(ctx, founderRef, { kind: 'ACADEMY_PROGRAM', body: { ...body, version: t.version, skills: [...(body.skills ?? []).filter((s) => s.code !== skill.code), skill] }, proposalId: null });
            result = `talent_definition:${draft.id}`;
          }
        } else if (p.kind === 'RETRAIN') {
          const e = GovernanceStore.for(store).transitionEmployee(founderRef, String(p.subject_employee_id), { to: 'RETRAINING', reasonCode: 'talent.retrain_proposal' });
          result = `employee:${e.id}`;
        } else if (p.kind === 'DEPARTMENT_BUDGET') {
          const gov = GovernanceStore.for(store);
          const existing = budgetFor(ctx, 'DEPARTMENT', String(p.department_id));
          const b = existing
            ? gov.changeBudgetCap(founderRef, existing.id, { capMoney: Number(payload.capMoney), capTokens: Number(payload.capTokens), reasonCode: 'talent.department_budget' })
            : gov.createBudget(founderRef, { scope: 'DEPARTMENT', scopeId: String(p.department_id), capMoney: Number(payload.capMoney), capTokens: Number(payload.capTokens), reasonCode: 'talent.department_budget' });
          result = `budget:${b.id}`;
        } else if (p.definition_id !== null) result = `talent_definition:${p.definition_id}`;
      }
      const at = ts(ctx);
      ctx.db.run(`UPDATE talent_proposals SET state = ?, decided_by_ref = ?, decided_at = ?, result_ref = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, pl.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED', founderRef, at, result.slice(0, 161), at, p.id, p.version);
      appendAudit(ctx, pl.decision === 'ACCEPT' ? 'talent.proposal_accepted' : 'talent.proposal_declined', 'talent_proposal', p.id, { actorRef: founderRef }, 'OK', str('reasonCode'), { kind: p.kind });
      return result;
    }
    case 'EMPLOYEE_IDENTITY_REVISE': {
      const b = txBindIdentity(ctx, founderRef, str('employeeId') as Id, str('definitionId') as Id, pl.classification as 'MINOR', str('reasonCode'));
      if (b.sha256 !== str('sha256')) throw new QandeelError('INVALID_TRANSITION', 'the identity profile changed since the preview', { reason: 'PREVIEW_STALE' });
      return `employee:${b.employeeId}`;
    }
    case 'POSITION_CREATE': {
      const p = OrganizationStore.for(store).createPosition(founderRef, { code: str('code'), title: str('title'), scope: 'DEPARTMENT', departmentId: str('departmentId'), kind: pl.kind as 'SPECIALIST', roleRef: str('roleRef'), reportsToPositionId: str('reportsToPositionId'), status: 'ACTIVE', reasonCode: str('reasonCode') });
      return `position:${p.id}`;
    }
    case 'DEPARTMENT_BUDGET': {
      const b = GovernanceStore.for(store).createBudget(founderRef, { scope: 'DEPARTMENT', scopeId: str('departmentId'), capMoney: Number(pl.capMoney), capTokens: Number(pl.capTokens), reasonCode: str('reasonCode') });
      return `budget:${b.id}`;
    }
    case 'ACCESS_POLICY_DECIDE': {
      const plan = txPlanAccessPolicy(ctx, { policyCode: pl.policyCode, decision: pl.decision, repository: pl.registerSource ?? undefined });
      if (plan.registerTool !== (pl.registerTool === true) || plan.registerSource !== (pl.registerSource ?? null)) throw new QandeelError('INVALID_TRANSITION', 'the policy plan changed since the preview', { reason: 'PREVIEW_STALE' });
      return executeAccessPolicy(store, ctx, founderRef, plan, str('reasonCode'));
    }
    case 'ROLE_TOOL_REQUIREMENT': {
      const at = ts(ctx);
      if (pl.decision === 'ADD') {
        const id = newId();
        ctx.db.run(`INSERT INTO role_tool_requirements (id, role_ref, tool_code, purpose, state, created_by_ref, created_at, removed_by_ref, removed_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, NULL, NULL)`, id, str('roleRef'), str('toolCode'), str('purpose'), founderRef, at);
        appendAudit(ctx, 'talent.role_tool_added', 'role_tool_requirement', id, { actorRef: founderRef }, 'OK', str('reasonCode'), { toolCode: str('toolCode') });
        return `role_tool_requirement:${id}`;
      }
      ctx.db.run(`UPDATE role_tool_requirements SET state = 'REMOVED', removed_by_ref = ?, removed_at = ? WHERE id = ? AND state = 'ACTIVE'`, founderRef, at, str('requirementId'));
      appendAudit(ctx, 'talent.role_tool_removed', 'role_tool_requirement', str('requirementId'), { actorRef: founderRef }, 'OK', str('reasonCode'), { toolCode: str('toolCode') });
      return `role_tool_requirement:${str('requirementId')}`;
    }
    case 'TOOL_ACCESS': {
      const plan = txPlanToolAccess(ctx, { employeeId: pl.employeeId, toolCode: pl.toolCode, actionCode: pl.actionCode, decision: pl.decision }, env.tools);
      if (plan.grantIds.join(',') !== (Array.isArray(pl.grantIds) ? (pl.grantIds as string[]).join(',') : '')) throw new QandeelError('INVALID_TRANSITION', 'tool access changed since the preview', { reason: 'PREVIEW_STALE' });
      return executeToolAccess(store, founderRef, plan, str('reasonCode'));
    }
    case 'EMPLOYEE_RETRAIN': {
      const e = GovernanceStore.for(store).transitionEmployee(founderRef, str('employeeId'), { to: 'RETRAINING', reasonCode: str('reasonCode') });
      return `employee:${e.id}`;
    }
    case 'ACADEMY_EVALUATION_ASSIGN': {
      const plan = txPlanEvaluationAssign(ctx, { attemptId: pl.attemptId, evaluatorEmployeeId: pl.evaluatorEmployeeId, taskClass: pl.taskClass, capMicros: pl.capMicros });
      if (`work_answer:${plan.answerId}` !== str('answerRef') || plan.answerSha256 !== str('answerSha256')) throw new QandeelError('INVALID_TRANSITION', 'the answer changed since the preview', { reason: 'ANSWER_CHANGED' });
      return `academy_manager_evaluation:${txExecuteEvaluationAssign(ctx, founderRef, plan)}`;
    }
    case 'ACADEMY_EVALUATION_REVIEW':
      return `academy_manager_evaluation:${txReviewManagerEvaluation(ctx, str('evaluationId') as Id, founderRef, pl.decision as 'CONFIRM')}`;
    default:
      throw new QandeelError('VALIDATION_FAILED', 'unknown talent intent', { field: 'intent' });
  }
}
