/**
 * COMPANY-TALENT-01 — leadership access policies (D2–D5), the Company documents source (D3), Tool readiness and the
 * Founder's grant of a registered Tool.
 *
 * A policy is a Founder-approved template (`ACCESS_POLICY_TEMPLATES`). While it is ACTIVE, the datastore keeps exactly one
 * individual grant per eligible seat holder and capability — issued in the transaction that makes the holder eligible
 * (the hire into a PRIMARY CEO / Director seat, the policy's approval) and revoked in the one that ends the eligibility
 * (leaving the seat, SUSPENDED, RETIRED, the policy's revocation). Every grant is an ordinary `permission_grants` row,
 * granted by the Founder who approved the policy (`granted_by_ref founder:*`, reason `policy.<code>`), linked to its
 * policy, visible on the Employee and revocable on its own. A grant that existed before the policy (Ahmed's product
 * knowledge) is ADOPTED as it is — never revoked and re-issued — and a revoked policy leaves adopted grants standing.
 * Reconciliation runs inside the caller's transaction only (no polling, no background worker).
 */
import { QandeelError, assertId, newId, type Id, type Timestamp } from '@qandeel-company/domain';
import {
  ACCESS_POLICY_TEMPLATES,
  COMPANY_DOCS_ACTION_DEFINITION,
  COMPANY_DOCS_ADAPTER,
  COMPANY_DOCS_READ_ACTION,
  COMPANY_KNOWLEDGE_TOOL,
  COMPANY_SOURCE_TARGET_CODE,
  PRODUCT_DOCS_ADAPTER,
  PRODUCT_KNOWLEDGE_TOOL,
  accessPolicyTemplate,
  assertProductRepositoryRef,
  policyEligible,
  type AccessPolicyTemplate,
  type EmployeeState,
  type ToolReadiness,
} from '@qandeel-company/governance';

import { DigitalStore } from './digital.js';
import { getEmployeeRow } from './governance-core.js';
import { GovernanceStore } from './governance.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { wakeCapabilityGaps } from './mind-writes.js';
import { storeContext, type CompanyStore } from './store.js';

export const SYSTEM_ACCESS_POLICY_REF = 'system:access-policy';

const transition = (reason: string, message: string, details: Record<string, string | number | boolean | null> = {}): never => {
  throw new QandeelError('INVALID_TRANSITION', message, { reason, ...details });
};

export interface AccessPolicyRecord {
  readonly id: Id;
  readonly code: string;
  readonly state: 'ACTIVE' | 'REVOKED';
  readonly approvedByRef: string;
  readonly approvedAt: string;
  readonly revokedAt: string | null;
}

const mapPolicy = (r: Record<string, unknown>): AccessPolicyRecord => ({ id: String(r.id) as Id, code: String(r.code), state: String(r.state) as AccessPolicyRecord['state'], approvedByRef: String(r.approved_by_ref), approvedAt: String(r.approved_at), revokedAt: r.revoked_at === null ? null : String(r.revoked_at) });

export function txActivePolicies(ctx: StoreContext): AccessPolicyRecord[] {
  // A Company opened by an older build's schema (a test fixture of a released version) has no policies table yet.
  if (!ctx.db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'access_policies'")) return [];
  return ctx.db.all(`SELECT * FROM access_policies WHERE state = 'ACTIVE' ORDER BY code`).map(mapPolicy);
}

interface Holder {
  readonly employeeId: Id;
  readonly positionId: Id;
  readonly seatKind: string;
  readonly state: EmployeeState;
}

/** Every PRIMARY seat holder now (effective assignment, live seat), with seat kind and lifecycle state. */
function primaryHolders(ctx: StoreContext, at: Timestamp): Holder[] {
  return ctx.db
    .all<{ employee_id: string; position_id: string; kind: string; state: string }>(
      `SELECT a.employee_id, a.position_id, p.kind, e.state FROM position_assignments a JOIN org_positions p ON p.id = a.position_id JOIN employees e ON e.id = a.employee_id
       WHERE a.kind = 'PRIMARY' AND a.status = 'ACTIVE' AND a.effective_from <= ? AND (a.effective_to IS NULL OR a.effective_to > ?) AND p.status <> 'RETIRED' ORDER BY a.employee_id`,
      at, at,
    )
    .map((r) => ({ employeeId: r.employee_id as Id, positionId: r.position_id as Id, seatKind: r.kind, state: r.state as EmployeeState }));
}

/** Whether the Tool a policy grant reads is registered and active (a policy never grants an unregistered Tool). */
function toolLive(ctx: StoreContext, capability: string): boolean {
  const m = /^tool:([a-z0-9.-]+)\.([a-z0-9-]+)$/.exec(capability);
  if (!m) return true;
  return ctx.db.get(`SELECT 1 AS x FROM tool_actions a JOIN tools t ON t.id = a.tool_id WHERE t.code = ? AND a.code = ? AND t.status = 'ACTIVE' AND a.status = 'ACTIVE'`, String(m[1]), String(m[2])) !== undefined;
}

/** What one reconciliation would do (read-only; the preview and the act run the same computation). */
export interface AccessPlan {
  readonly issue: readonly { readonly policyCode: string; readonly employeeId: Id; readonly positionId: Id; readonly capability: string }[];
  readonly adopt: readonly { readonly policyCode: string; readonly employeeId: Id; readonly positionId: Id; readonly capability: string; readonly grantId: Id }[];
  readonly revoke: readonly { readonly policyCode: string; readonly employeeId: Id; readonly capability: string; readonly grantId: Id }[];
}

function planFor(ctx: StoreContext, policies: readonly { code: string; id: Id | null }[], scope: ReadonlySet<Id> | null, at: Timestamp, assumeLive: ReadonlySet<string> = new Set()): AccessPlan {
  const issue: AccessPlan['issue'][number][] = [];
  const adopt: AccessPlan['adopt'][number][] = [];
  const revoke: AccessPlan['revoke'][number][] = [];
  const holders = primaryHolders(ctx, at).filter((h) => scope === null || scope.has(h.employeeId));
  for (const policy of policies) {
    const t = accessPolicyTemplate(policy.code);
    if (!t) continue;
    for (const g of t.grants) {
      const eligible = assumeLive.has(g.capability) || toolLive(ctx, g.capability) ? holders.filter((h) => policyEligible(h.seatKind, 'PRIMARY', h.state, g)) : [];
      const linked = policy.id === null ? [] : ctx.db.all<{ grant_id: string; employee_id: string; position_id: string }>(
        `SELECT l.grant_id, l.employee_id, l.position_id FROM policy_grant_links l JOIN permission_grants pg ON pg.id = l.grant_id WHERE l.policy_id = ? AND l.capability = ? AND pg.status = 'ACTIVE'`,
        policy.id, g.capability,
      );
      for (const h of eligible) {
        if (linked.some((l) => l.employee_id === h.employeeId && l.position_id === h.positionId)) continue;
        // An individual grant the Employee already holds (and no policy holds) is adopted as it is.
        const existing = ctx.db.get<{ id: string }>(
          `SELECT g.id FROM permission_grants g WHERE g.employee_id = ? AND g.capability = ? AND g.status = 'ACTIVE' AND g.resource_scope IN (?, '*') AND (g.expires_at IS NULL OR g.expires_at > ?) AND (g.max_uses IS NULL OR g.uses < g.max_uses)
             AND NOT EXISTS (SELECT 1 FROM policy_grant_links l WHERE l.grant_id = g.id) ORDER BY g.created_at, g.id LIMIT 1`,
          h.employeeId, g.capability, g.resourceScope, at,
        );
        if (existing) adopt.push({ policyCode: policy.code, employeeId: h.employeeId, positionId: h.positionId, capability: g.capability, grantId: existing.id as Id });
        else issue.push({ policyCode: policy.code, employeeId: h.employeeId, positionId: h.positionId, capability: g.capability });
      }
      for (const l of linked) {
        if (scope !== null && !scope.has(l.employee_id as Id)) continue;
        if (!eligible.some((h) => h.employeeId === l.employee_id && h.positionId === l.position_id)) revoke.push({ policyCode: policy.code, employeeId: l.employee_id as Id, capability: g.capability, grantId: l.grant_id as Id });
      }
    }
  }
  return { issue, adopt, revoke };
}

function issueGrant(ctx: StoreContext, policy: AccessPolicyRecord, t: AccessPolicyTemplate, item: AccessPlan['issue'][number]): Id {
  const g = t.grants.find((x) => x.capability === item.capability);
  if (!g) throw new QandeelError('STORAGE_INVARIANT', 'policy grant template missing', { capability: item.capability });
  const id = newId();
  const reason = `policy.${policy.code}`.slice(0, 64);
  ctx.db.run(
    `INSERT INTO permission_grants (id, employee_id, capability, resource_scope, risk_ceiling, data_class_ceiling, expires_at, max_uses, uses, status, granted_by_ref, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, 'ACTIVE', ?, ?, ?)`,
    id, item.employeeId, g.capability, g.resourceScope, g.riskCeiling, g.dataClassCeiling, policy.approvedByRef, reason, ts(ctx),
  );
  ctx.db.run('INSERT INTO policy_grant_links (grant_id, policy_id, employee_id, position_id, capability, adopted, linked_at) VALUES (?, ?, ?, ?, ?, 0, ?)', id, policy.id, item.employeeId, item.positionId, g.capability, ts(ctx));
  appendAudit(ctx, 'grant.created', 'grant', id, { actorRef: policy.approvedByRef }, 'OK', reason, { employeeId: item.employeeId, riskCeiling: g.riskCeiling, dataClassCeiling: g.dataClassCeiling, policyId: policy.id });
  wakeCapabilityGaps(ctx, item.employeeId, 'grant.created');
  return id;
}

/**
 * Reconciles the ACTIVE policies' grants with the seats as they are now (in the caller's transaction). `employeeIds`
 * narrows it to the Employees an act touched; null reconciles everyone. Returns the counts (nothing is logged but codes).
 */
export function txReconcileAccess(ctx: StoreContext, employeeIds: readonly Id[] | null = null): { issued: number; adopted: number; revoked: number } {
  const policies = txActivePolicies(ctx);
  if (policies.length === 0) return { issued: 0, adopted: 0, revoked: 0 };
  const at = ts(ctx);
  const plan = planFor(ctx, policies, employeeIds === null ? null : new Set(employeeIds), at);
  for (const item of plan.issue) {
    const p = policies.find((x) => x.code === item.policyCode) as AccessPolicyRecord;
    issueGrant(ctx, p, accessPolicyTemplate(p.code) as AccessPolicyTemplate, item);
  }
  for (const item of plan.adopt) {
    const p = policies.find((x) => x.code === item.policyCode) as AccessPolicyRecord;
    ctx.db.run('INSERT INTO policy_grant_links (grant_id, policy_id, employee_id, position_id, capability, adopted, linked_at) VALUES (?, ?, ?, ?, ?, 1, ?)', item.grantId, p.id, item.employeeId, item.positionId, item.capability, at);
    appendAudit(ctx, 'grant.adopted_by_policy', 'grant', item.grantId, { actorRef: SYSTEM_ACCESS_POLICY_REF }, 'OK', `policy.${p.code}`.slice(0, 64), { employeeId: item.employeeId, policyId: p.id });
  }
  for (const item of plan.revoke) {
    if (ctx.db.run(`UPDATE permission_grants SET status = 'REVOKED', revoked_at = ?, revoked_by_ref = ? WHERE id = ? AND status = 'ACTIVE'`, at, SYSTEM_ACCESS_POLICY_REF, item.grantId).changes === 1) {
      appendAudit(ctx, 'grant.revoked', 'grant', item.grantId, { actorRef: SYSTEM_ACCESS_POLICY_REF }, 'OK', 'policy.eligibility_ended', { employeeId: item.employeeId });
    }
  }
  return { issued: plan.issue.length, adopted: plan.adopt.length, revoked: plan.revoke.length };
}

// --- The Founder's policy decision ------------------------------------------------------------------------------------

const sourcesOf = (ctx: StoreContext, adapter: string): { id: string; code: string; external_ref: string; state: string }[] => ctx.db.all('SELECT id, code, external_ref, state FROM digital_promotion_targets WHERE adapter_code = ? ORDER BY created_at, id', adapter);

/** The one ACTIVE Company documents source, re-read on every call (the reader's resolver). */
export function resolveCompanySource(store: CompanyStore): { readonly ok: true; readonly externalRef: string } | { readonly ok: false; readonly code: string } {
  const ctx = storeContext(store);
  return ctx.db.snapshot(() => {
    const active = sourcesOf(ctx, COMPANY_DOCS_ADAPTER).filter((s) => s.state === 'ACTIVE');
    if (active.length === 0) return { ok: false, code: 'COMPANY_SOURCE_NOT_REGISTERED' } as const;
    if (active.length > 1) return { ok: false, code: 'COMPANY_SOURCE_AMBIGUOUS' } as const;
    return { ok: true, externalRef: String(active[0]?.external_ref) } as const;
  });
}

export interface AccessPolicyPlan {
  readonly template: AccessPolicyTemplate;
  readonly decision: 'APPROVE' | 'REVOKE';
  readonly policyId: Id | null;
  /** APPROVE of the Company documents policy: the source and Tool registered now (null / false when already there). */
  readonly registerSource: string | null;
  readonly registerTool: boolean;
  readonly plan: AccessPlan;
}

export function txPlanAccessPolicy(ctx: StoreContext, input: { policyCode: unknown; decision: unknown; repository?: unknown }): AccessPolicyPlan {
  const template = accessPolicyTemplate(input.policyCode);
  if (!template) throw new QandeelError('VALIDATION_FAILED', `policyCode is one of ${ACCESS_POLICY_TEMPLATES.map((t) => t.code).join(', ')}`, { field: 'policyCode' });
  const decision = input.decision;
  if (decision !== 'APPROVE' && decision !== 'REVOKE') throw new QandeelError('VALIDATION_FAILED', 'decision is APPROVE or REVOKE', { field: 'decision' });
  const active = ctx.db.get(`SELECT * FROM access_policies WHERE code = ? AND state = 'ACTIVE'`, template.code);
  const at = ts(ctx);
  if (decision === 'REVOKE') {
    if (!active) transition('POLICY_NOT_ACTIVE', 'this policy is not in force');
    const p = mapPolicy(active as Record<string, unknown>);
    const revoke = ctx.db.all<{ grant_id: string; employee_id: string; capability: string }>(`SELECT l.grant_id, l.employee_id, l.capability FROM policy_grant_links l JOIN permission_grants g ON g.id = l.grant_id WHERE l.policy_id = ? AND l.adopted = 0 AND g.status = 'ACTIVE' ORDER BY l.grant_id`, p.id).map((r) => ({ policyCode: template.code, employeeId: r.employee_id as Id, capability: r.capability, grantId: r.grant_id as Id }));
    return { template, decision, policyId: p.id, registerSource: null, registerTool: false, plan: { issue: [], adopt: [], revoke } };
  }
  if (active) transition('POLICY_ACTIVE', 'this policy is already in force');
  let registerSource: string | null = null;
  let registerTool = false;
  if (template.source === 'PRODUCT') {
    if (sourcesOf(ctx, PRODUCT_DOCS_ADAPTER).filter((s) => s.state === 'ACTIVE').length !== 1) transition('PRODUCT_SOURCE_NOT_REGISTERED', 'register the product source first (Product knowledge access)');
    if (!ctx.db.get(`SELECT 1 AS x FROM tools WHERE code = ? AND status = 'ACTIVE'`, PRODUCT_KNOWLEDGE_TOOL)) transition('TOOL_NOT_ACTIVE', 'the product-knowledge tool is not registered and active');
  }
  if (template.source === 'COMPANY') {
    const sources = sourcesOf(ctx, COMPANY_DOCS_ADAPTER);
    const live = sources.filter((s) => s.state === 'ACTIVE');
    if (live.length > 1) transition('COMPANY_SOURCE_AMBIGUOUS', 'more than one Company documents source is active');
    if (live.length === 0) {
      if (sources.some((s) => s.code === COMPANY_SOURCE_TARGET_CODE)) transition('COMPANY_SOURCE_INACTIVE', 'the registered Company documents source is suspended or retired');
      if (input.repository === undefined || input.repository === null || input.repository === '') throw new QandeelError('VALIDATION_FAILED', 'name the Company documents source the first time (github:<owner>/<repository>)', { field: 'repository', reason: 'COMPANY_SOURCE_REQUIRED' });
      registerSource = assertProductRepositoryRef(input.repository).externalRef;
    }
    const tool = ctx.db.get<{ status: string; driver_code: string }>('SELECT status, driver_code FROM tools WHERE code = ?', COMPANY_KNOWLEDGE_TOOL);
    if (tool && (tool.status !== 'ACTIVE' || tool.driver_code !== COMPANY_DOCS_ADAPTER)) transition('TOOL_NOT_ACTIVE', 'the company-knowledge tool is not active');
    registerTool = !tool;
  }
  // The grants the approval issues now: computed as if the policy were in force (a fresh policy has no links yet). A Tool
  // registered by this same act counts as live.
  const plan = planFor(ctx, [{ code: template.code, id: null }], null, at, registerTool ? new Set(template.grants.map((g) => g.capability)) : new Set());
  return { template, decision, policyId: null, registerSource, registerTool, plan };
}

/** Executes a confirmed policy plan inside the confirm transaction. Returns the policy ref. */
export function executeAccessPolicy(store: CompanyStore, ctx: StoreContext, founderRef: string, plan: AccessPolicyPlan, reasonCode: string): string {
  const at = ts(ctx);
  if (plan.decision === 'REVOKE') {
    const id = plan.policyId as Id;
    ctx.db.run(`UPDATE access_policies SET state = 'REVOKED', revoked_by_ref = ?, revoked_at = ? WHERE id = ? AND state = 'ACTIVE'`, founderRef, at, id);
    for (const r of plan.plan.revoke) {
      if (ctx.db.run(`UPDATE permission_grants SET status = 'REVOKED', revoked_at = ?, revoked_by_ref = ? WHERE id = ? AND status = 'ACTIVE'`, at, founderRef, r.grantId).changes === 1) appendAudit(ctx, 'grant.revoked', 'grant', r.grantId, { actorRef: founderRef }, 'OK', 'policy.revoked', { employeeId: r.employeeId });
    }
    appendAudit(ctx, 'access.policy_revoked', 'access_policy', id, { actorRef: founderRef }, 'OK', reasonCode, { revoked: plan.plan.revoke.length });
    return `access_policy:${id}`;
  }
  if (plan.registerSource !== null) DigitalStore.for(store).registerTarget(founderRef, { code: COMPANY_SOURCE_TARGET_CODE, targetClass: 'CODE_REPOSITORY', adapterCode: COMPANY_DOCS_ADAPTER, externalRef: plan.registerSource, actions: {} });
  if (plan.registerTool) {
    const gov = GovernanceStore.for(store);
    const tool = gov.registerTool(founderRef, { code: COMPANY_KNOWLEDGE_TOOL, driverCode: COMPANY_DOCS_ADAPTER, egress: 'EXTERNAL' });
    gov.registerToolAction(founderRef, { toolId: tool.id, ...COMPANY_DOCS_ACTION_DEFINITION });
  }
  const id = newId();
  ctx.db.run(`INSERT INTO access_policies (id, code, state, approved_by_ref, approved_at, revoked_by_ref, revoked_at) VALUES (?, ?, 'ACTIVE', ?, ?, NULL, NULL)`, id, plan.template.code, founderRef, at);
  appendAudit(ctx, 'access.policy_approved', 'access_policy', id, { actorRef: founderRef }, 'OK', reasonCode, { code: plan.template.code });
  txReconcileAccess(ctx, null);
  return `access_policy:${id}`;
}

// --- Tool readiness and the Founder's grant of a registered Tool --------------------------------------------------------

/** What the host knows about Tools (drivers it registered, credentials it holds). Absent = unknown here. */
export interface ToolEnvironment {
  readonly drivers: () => readonly string[];
  readonly hasCredential: (ref: string) => boolean;
}

export interface ToolReadinessView {
  readonly toolCode: string;
  readonly readiness: ToolReadiness;
  readonly registered: boolean;
  readonly driverCode: string | null;
  readonly actions: readonly { readonly code: string; readonly risk: string; readonly status: string; readonly costPerCallMicros: number }[];
}

/** The honest readiness of one Tool (TOOL_READINESS). Without a host environment, integration is unknown: NOT_INTEGRATED. */
export function txToolReadiness(ctx: StoreContext, toolCode: string, env: ToolEnvironment | null): ToolReadinessView {
  const t = ctx.db.get<{ id: string; driver_code: string; status: string; credential_ref: string | null }>('SELECT id, driver_code, status, credential_ref FROM tools WHERE code = ?', toolCode);
  if (!t) return { toolCode, readiness: 'NOT_REGISTERED', registered: false, driverCode: null, actions: [] };
  const actions = ctx.db.all<{ code: string; risk_level: string; status: string; cost_per_call_micros: number }>('SELECT code, risk_level, status, cost_per_call_micros FROM tool_actions WHERE tool_id = ? ORDER BY code', t.id).map((a) => ({ code: a.code, risk: a.risk_level, status: a.status, costPerCallMicros: Number(a.cost_per_call_micros) }));
  const base = { toolCode, registered: true, driverCode: t.driver_code, actions };
  if (t.status !== 'ACTIVE' || !actions.some((a) => a.status === 'ACTIVE')) return { ...base, readiness: 'ON_HOLD' };
  if (env === null || !env.drivers().includes(t.driver_code)) return { ...base, readiness: 'NOT_INTEGRATED' };
  if (t.credential_ref !== null && !env.hasCredential(t.credential_ref)) return { ...base, readiness: 'AWAITING_CONNECTION' };
  return { ...base, readiness: 'READY' };
}

export interface RoleToolRequirementRecord {
  readonly id: Id;
  readonly roleRef: string;
  readonly toolCode: string;
  readonly purpose: string;
  readonly state: 'ACTIVE' | 'REMOVED';
  readonly createdAt: string;
}

export function txRoleToolRequirements(ctx: StoreContext, roleRef: string | null): RoleToolRequirementRecord[] {
  const rows = roleRef === null ? ctx.db.all(`SELECT * FROM role_tool_requirements WHERE state = 'ACTIVE' ORDER BY role_ref, tool_code`) : ctx.db.all(`SELECT * FROM role_tool_requirements WHERE state = 'ACTIVE' AND role_ref = ? ORDER BY tool_code`, roleRef);
  return rows.map((r) => ({ id: String(r.id) as Id, roleRef: String(r.role_ref), toolCode: String(r.tool_code), purpose: String(r.purpose), state: String(r.state) as 'ACTIVE', createdAt: String(r.created_at) }));
}

export interface ToolAccessPlan {
  readonly employee: ReturnType<typeof getEmployeeRow>;
  readonly decision: 'GRANT' | 'REVOKE';
  readonly toolCode: string;
  readonly actionCode: string;
  readonly capability: string;
  readonly risk: 'R0' | 'R1';
  readonly dataClass: string;
  readonly costPerCallMicros: number;
  readonly grantIds: readonly Id[];
}

/**
 * The Founder grants (or revokes) one registered, integrated Tool action to one Employee — the same Tool for any number
 * of Employees, one individual grant each, no code per Employee. Only R0 / R1 actions are granted standing: an action
 * with an external effect (R3) stays approved per act. A Tool that is not READY is never granted.
 */
export function txPlanToolAccess(ctx: StoreContext, input: { employeeId: unknown; toolCode: unknown; actionCode: unknown; decision: unknown }, env: ToolEnvironment | null): ToolAccessPlan {
  const e = getEmployeeRow(ctx, assertId(input.employeeId, 'employeeId'));
  const decision = input.decision ?? 'GRANT';
  if (decision !== 'GRANT' && decision !== 'REVOKE') throw new QandeelError('VALIDATION_FAILED', 'decision is GRANT or REVOKE', { field: 'decision' });
  if (typeof input.toolCode !== 'string' || typeof input.actionCode !== 'string') throw new QandeelError('VALIDATION_FAILED', 'name the tool and its action', { field: 'toolCode' });
  const toolCode = input.toolCode;
  const actionCode = input.actionCode;
  const capability = `tool:${toolCode}.${actionCode}`;
  const at = ts(ctx);
  const held = ctx.db.all<{ id: string }>(`SELECT id FROM permission_grants WHERE employee_id = ? AND capability = ? AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at, id`, e.id, capability, at).map((r) => r.id as Id);
  const a = ctx.db.get<{ risk_level: string; data_class_ceiling: string; status: string; cost_per_call_micros: number }>('SELECT a.risk_level, a.data_class_ceiling, a.status, a.cost_per_call_micros FROM tool_actions a JOIN tools t ON t.id = a.tool_id WHERE t.code = ? AND a.code = ?', toolCode, actionCode);
  if (decision === 'REVOKE') {
    if (held.length === 0) transition('NO_ACCESS', 'this Employee holds no grant of this tool action');
    return { employee: e, decision, toolCode, actionCode, capability, risk: (a?.risk_level === 'R1' ? 'R1' : 'R0'), dataClass: a?.data_class_ceiling ?? 'D1', costPerCallMicros: Number(a?.cost_per_call_micros ?? 0), grantIds: held };
  }
  if (e.state === 'RETIRED') transition('RETIRED', 'a retired Employee receives nothing');
  if (held.length > 0) transition('ACCESS_EXISTS', 'this Employee already holds this tool action');
  const readiness = txToolReadiness(ctx, toolCode, env);
  if (readiness.readiness !== 'READY') transition(`TOOL_${readiness.readiness}`, 'only a registered, integrated, connected and active Tool is granted');
  if (!a || a.status !== 'ACTIVE') transition('ACTION_NOT_ACTIVE', 'this tool action is not registered and active');
  if (a?.risk_level !== 'R0' && a?.risk_level !== 'R1') transition('ACTION_RISK', 'a standing grant covers R0 / R1 actions only; an external effect is approved per act');
  if (!['D0', 'D1', 'D2'].includes(String(a?.data_class_ceiling))) transition('ACTION_DATA_CLASS', 'a tool grant carries at most D2');
  return { employee: e, decision, toolCode, actionCode, capability, risk: a?.risk_level === 'R1' ? 'R1' : 'R0', dataClass: String(a?.data_class_ceiling), costPerCallMicros: Number(a?.cost_per_call_micros ?? 0), grantIds: [] };
}

export function executeToolAccess(store: CompanyStore, founderRef: string, plan: ToolAccessPlan, reasonCode: string): string {
  const gov = GovernanceStore.for(store);
  if (plan.decision === 'REVOKE') for (const id of plan.grantIds) gov.revokeGrant(founderRef, id, reasonCode);
  else gov.grant(founderRef, { employeeId: plan.employee.id, capability: plan.capability, resourceScope: plan.toolCode, riskCeiling: plan.risk, dataClassCeiling: plan.dataClass as 'D1', reasonCode });
  return `employee:${plan.employee.id}`;
}

/** The Company documents read action, as the driver declares it. */
export const COMPANY_KNOWLEDGE_TOOL_REGISTRATION = Object.freeze({ tool: { code: COMPANY_KNOWLEDGE_TOOL, driverCode: COMPANY_DOCS_ADAPTER, egress: 'EXTERNAL' as const }, actions: [COMPANY_DOCS_ACTION_DEFINITION], action: COMPANY_DOCS_READ_ACTION });
