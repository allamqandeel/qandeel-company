/**
 * P1-PRODUCT-KNOWLEDGE-01 (D-P1-06) — Shared Product Knowledge on the existing governed mechanisms.
 *
 * Nothing here is a new knowledge base, runtime or tool system:
 * - the source is ONE Founder-registered digital target of the `github.product-docs` adapter (C7-D registry): the App
 *   repository is data, never named in Company code;
 * - the capability is ONE Tool (`product-knowledge.product-docs-read`, R0, no side effect, no credential) in the C2 Tool
 *   Registry, executed only by the Tool Executor after the full authority path;
 * - access is an explicit per-Employee grant (Stage 3: titles grant nothing, grants never inherit), given or revoked by
 *   the Founder through the governed preview → confirm boundary;
 * - what a read returns reaches the Employee as a recent step result (C3 L6, neutralized data) in that Work Item only.
 *
 * The Founder act registers the Tool and the source only when they are missing; it never widens an existing grant, never
 * touches a budget or a reasoning level, and never makes a provider call.
 */
import { QandeelError, assertId, type Id, type Timestamp } from '@qandeel-company/domain';
import {
  PRODUCT_DOCS_ADAPTER,
  PRODUCT_DOCS_ARGS_SCHEMA,
  PRODUCT_DOCS_CAPABILITY,
  PRODUCT_DOCS_READ_ACTION,
  PRODUCT_KNOWLEDGE_TOOL,
  PRODUCT_SOURCE_TARGET_CODE,
  assertProductRepositoryRef,
} from '@qandeel-company/governance';
import { GRANTED_TOOL_GUIDANCE } from '@qandeel-company/mind';

import { DigitalStore } from './digital.js';
import { getEmployeeRow } from './governance-core.js';
import type { EmployeeRecord } from './governance-records.js';
import { GovernanceStore } from './governance.js';
import { ts, type StoreContext } from './internal.js';
import { storeContext, type CompanyStore } from './store.js';

/**
 * The Tool Registry entry (the same values the read-only driver declares). The data-class ceiling is D2 because a
 * conversation reply runs at D2; it is safe because the reader sends nothing of the Company to GitHub — only the public
 * document paths it reads. The result (public documentation) is D1.
 */
export const PRODUCT_KNOWLEDGE_ACTION_DEFINITION = Object.freeze({ code: PRODUCT_DOCS_READ_ACTION, risk: 'R0' as const, sideEffects: 'NONE' as const, mutatesExternal: false, dataClassCeiling: 'D2' as const, resultDataClass: 'D1' as const, argsSchema: PRODUCT_DOCS_ARGS_SCHEMA, costPerCallMicros: 0 });

const transition = (reason: string, message: string, details: Record<string, string | number | boolean | null> = {}): never => {
  throw new QandeelError('INVALID_TRANSITION', message, { reason, ...details });
};

type SourceRow = {
  readonly id: string;
  readonly code: string;
  readonly external_ref: string;
  readonly state: string;
};

const sourcesOf = (ctx: StoreContext): SourceRow[] => ctx.db.all<SourceRow>('SELECT id, code, external_ref, state FROM digital_promotion_targets WHERE adapter_code = ? ORDER BY created_at, id', PRODUCT_DOCS_ADAPTER);

/** The one ACTIVE product source, re-read on every call (the reader's resolver). Never a guess between two. */
export function resolveProductSource(store: CompanyStore): { readonly ok: true; readonly externalRef: string } | { readonly ok: false; readonly code: string } {
  const ctx = storeContext(store);
  return ctx.db.snapshot(() => {
    const active = sourcesOf(ctx).filter((s) => s.state === 'ACTIVE');
    if (active.length === 0) return { ok: false, code: 'PRODUCT_SOURCE_NOT_REGISTERED' } as const;
    if (active.length > 1) return { ok: false, code: 'PRODUCT_SOURCE_AMBIGUOUS' } as const;
    return { ok: true, externalRef: (active[0] as SourceRow).external_ref } as const;
  });
}

const activeGrantIds = (ctx: StoreContext, employeeId: string, at: Timestamp): string[] =>
  ctx.db
    .all<{ id: string }>(`SELECT id FROM permission_grants WHERE employee_id = ? AND capability = ? AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses) ORDER BY created_at, id`, employeeId, PRODUCT_DOCS_CAPABILITY, at)
    .map((r) => r.id);

export interface ProductKnowledgeAccessPlan {
  readonly employee: EmployeeRecord;
  readonly decision: 'GRANT' | 'REVOKE';
  /** GRANT: the source to register now (null when one is already registered and ACTIVE). */
  readonly registerSource: string | null;
  /** The source the read will use (registered now or already). */
  readonly sourceRef: string;
  readonly registerTool: boolean;
  /** REVOKE: the grants to revoke. */
  readonly grantIds: readonly string[];
}

/** Validates the Founder's product-knowledge act against durable state (the preview and the confirm run the same check). */
export function txPlanProductKnowledgeAccess(ctx: StoreContext, input: { employeeId: unknown; decision: unknown; repository?: unknown }): ProductKnowledgeAccessPlan {
  const e = getEmployeeRow(ctx, assertId(input.employeeId, 'employeeId'));
  const decision = input.decision ?? 'GRANT';
  if (decision !== 'GRANT' && decision !== 'REVOKE') throw new QandeelError('VALIDATION_FAILED', 'decision is GRANT or REVOKE', { field: 'decision' });
  const at = ts(ctx);
  const held = activeGrantIds(ctx, e.id, at);
  const sources = sourcesOf(ctx);
  const active = sources.filter((s) => s.state === 'ACTIVE');
  if (decision === 'REVOKE') {
    if (held.length === 0) transition('NO_ACCESS', 'this Employee holds no product-knowledge access');
    return { employee: e, decision, registerSource: null, sourceRef: active[0]?.external_ref ?? 'none', registerTool: false, grantIds: held };
  }
  if (e.state === 'RETIRED') transition('RETIRED', 'a retired Employee receives nothing');
  if (held.length > 0) transition('ACCESS_EXISTS', 'this Employee already holds product-knowledge access');
  if (active.length > 1) transition('PRODUCT_SOURCE_AMBIGUOUS', 'more than one product source is active');
  let registerSource: string | null = null;
  if (active.length === 0) {
    if (sources.some((s) => s.code === PRODUCT_SOURCE_TARGET_CODE)) transition('PRODUCT_SOURCE_INACTIVE', 'the registered product source is suspended or retired');
    if (input.repository === undefined || input.repository === null || input.repository === '') throw new QandeelError('VALIDATION_FAILED', 'name the product source the first time (github:<owner>/<repository>)', { field: 'repository', reason: 'PRODUCT_SOURCE_REQUIRED' });
    registerSource = assertProductRepositoryRef(input.repository).externalRef;
  } else if (input.repository !== undefined && input.repository !== null && input.repository !== '' && assertProductRepositoryRef(input.repository).externalRef !== (active[0] as SourceRow).external_ref) {
    transition('PRODUCT_SOURCE_DIFFERS', 'a different product source is already registered (this act never replaces it)');
  }
  const tool = ctx.db.get<{ id: string; status: string; driver_code: string }>('SELECT id, status, driver_code FROM tools WHERE code = ?', PRODUCT_KNOWLEDGE_TOOL);
  if (tool && (tool.status !== 'ACTIVE' || tool.driver_code !== PRODUCT_DOCS_ADAPTER)) transition('TOOL_NOT_ACTIVE', 'the product-knowledge tool is not active');
  if (tool && !ctx.db.get(`SELECT 1 AS x FROM tool_actions WHERE tool_id = ? AND code = ? AND status = 'ACTIVE' AND risk_level = 'R0' AND mutates_external = 0`, tool.id, PRODUCT_DOCS_READ_ACTION)) transition('TOOL_NOT_ACTIVE', 'the product-knowledge read action is not registered as a read');
  return { employee: e, decision, registerSource, sourceRef: registerSource ?? (active[0] as SourceRow).external_ref, registerTool: !tool, grantIds: [] };
}

/** Executes a confirmed plan through the canonical stores (inside the one confirm transaction). Returns the target ref. */
export function executeProductKnowledgeAccess(store: CompanyStore, founderRef: string, plan: ProductKnowledgeAccessPlan, reasonCode: string): string {
  const gov = GovernanceStore.for(store);
  if (plan.decision === 'REVOKE') {
    for (const id of plan.grantIds) gov.revokeGrant(founderRef, id, reasonCode);
    return `employee:${plan.employee.id}`;
  }
  if (plan.registerSource !== null) {
    DigitalStore.for(store).registerTarget(founderRef, { code: PRODUCT_SOURCE_TARGET_CODE, targetClass: 'CODE_REPOSITORY', adapterCode: PRODUCT_DOCS_ADAPTER, externalRef: plan.registerSource, actions: {} });
  }
  if (plan.registerTool) {
    const tool = gov.registerTool(founderRef, { code: PRODUCT_KNOWLEDGE_TOOL, driverCode: PRODUCT_DOCS_ADAPTER, egress: 'EXTERNAL' });
    gov.registerToolAction(founderRef, { toolId: tool.id, ...PRODUCT_KNOWLEDGE_ACTION_DEFINITION });
  }
  gov.grant(founderRef, { employeeId: plan.employee.id, capability: PRODUCT_DOCS_CAPABILITY, resourceScope: PRODUCT_KNOWLEDGE_TOOL, riskCeiling: 'R0', dataClassCeiling: 'D2', reasonCode });
  return `employee:${plan.employee.id}`;
}

/**
 * The preamble lines of the Tools this Employee may request NOW: an ACTIVE, unexpired, unexhausted grant of a capability
 * with release-pinned guidance, on an ACTIVE tool action. Nothing else is listed; listing grants nothing (the runtime
 * decides every request again).
 */
export function txGrantedToolGuidance(ctx: StoreContext, employeeId: Id, at: Timestamp): string[] {
  const out: string[] = [];
  for (const [capability, guidance] of Object.entries(GRANTED_TOOL_GUIDANCE)) {
    const m = /^tool:([a-z0-9.-]+)\.([a-z0-9-]+)$/.exec(capability);
    if (!m) continue;
    const toolCode = m[1] as string;
    const actionCode = m[2] as string;
    const granted = ctx.db.get(`SELECT 1 AS x FROM permission_grants WHERE employee_id = ? AND capability = ? AND status = 'ACTIVE' AND (resource_scope = '*' OR resource_scope = ?) AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses) LIMIT 1`, employeeId, capability, toolCode, at);
    if (!granted) continue;
    const live = ctx.db.get(`SELECT 1 AS x FROM tool_actions a JOIN tools t ON t.id = a.tool_id WHERE t.code = ? AND a.code = ? AND t.status = 'ACTIVE' AND a.status = 'ACTIVE'`, toolCode, actionCode);
    if (live) out.push(guidance);
  }
  return out;
}
