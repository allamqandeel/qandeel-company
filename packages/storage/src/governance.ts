/**
 * GovernanceStore — C2 governance administration and inspection over one CompanyStore.
 *
 * Every mutating method is one short `BEGIN IMMEDIATE` transaction that writes the state change,
 * its append-only history and a content-free audit row together. Administration (grants, approvals,
 * budget caps, qualification, egress approval, holds, activation) is Founder authority in Strong-v1
 * C2 (Stage 3 §3/§6): an employee actor is refused — on itself as a self-escalation. Director /
 * manager delegation is C4 and does not exist here.
 *
 * A Founder reference is an identifier, not authentication. Until C5 provides the authenticated
 * Founder surface, every Founder-authority write fails closed with `FOUNDER_SURFACE_UNAVAILABLE`
 * (D-C2-13): presenting a Founder ref grants nothing. The only way to exercise these paths is the
 * test-only seam (`src/testing/founder-seam.ts`), which production code cannot reach.
 *
 * Nothing here executes work, claims jobs, calls a model or invokes a tool: the Runtime Supervisor
 * does that through the fenced `runtime-authority` writes.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';

import {
  QandeelError,
  assertCode,
  assertId,
  assertOpaqueRef,
  boundedText,
  canonicalJson,
  isTimestamp,
  newId,
  sha256Hex,
  type Id,
  type RiskLevel,
  type Timestamp,
} from '@qandeel-company/domain';
import {
  PARENT_SCOPE,
  QUALIFICATION_NEXT,
  RESOURCE_SCOPE,
  approvalFingerprint,
  assertActionConsistency,
  assertActivationAvailable,
  assertApprover,
  assertArgsSchema,
  assertCapability,
  assertCatalogCode,
  assertCognitiveProfile,
  assertCurrency,
  assertDataClass,
  assertEmployeeName,
  assertEmployeeTransition,
  assertGovernanceAuthority,
  assertMoney,
  assertPriceCardRates,
  assertQualificationRefs,
  assertReasoningClass,
  assertRoutePolicyBody,
  assertTaskClass,
  assertTokens,
  assertToolCode,
  isDataClass,
  requiresIdempotencyKey,
  utilisationPercent,
  NEAR_LIMIT_PERCENT,
  profileJson,
  type BillingMode,
  type BudgetScope,
  type DataClass,
  type DeploymentView,
  type EmployeeState,
  type Locality,
  type QualificationState,
  type ReasoningClass,
  type RoutePolicy,
  type ToolEgress,
  externalEgressAvailable,
  MAX_EXTERNAL_DATA_CLASS,
} from '@qandeel-company/governance';

import {
  budgetChain,
  budgetFor,
  employeeIdFromRef,
  getBudgetRow,
  getEmployeeRow,
  getReservationRow,
  holdReservationTx,
  releaseReservationTx,
  resolvePrincipal,
  setEmployeeState,
  settleReservationTx,
  wakeWorkItemJob,
  writeEmployeeHistory,
  type Principal,
} from './governance-core.js';
import {
  mapApproval,
  mapBudget,
  mapDepartment,
  mapDeployment,
  mapEmployee,
  mapEmployeeHistory,
  mapGrant,
  mapPriceCard,
  mapProvider,
  mapReservation,
  mapRunAttribution,
  mapTool,
  mapToolAction,
  mapToolInvocation,
  mapUsage,
  type ApprovalRecord,
  type BudgetRecord,
  type DepartmentRecord,
  type DeploymentRecord,
  type EmployeeHistoryRecord,
  type EmployeeRecord,
  type GrantRecord,
  type PriceCardRecord,
  type ProviderRecord,
  type ReservationRecord,
  type RunAttributionRecord,
  type ToolActionRecord,
  type ToolInvocationRecord,
  type ToolRecord,
  type UsageRecord,
} from './governance-records.js';
import { appendAudit, appendEvent, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { storeContext, type CompanyStore } from './store.js';
import { applyTransition, enqueueJob } from './work-core.js';

const at = (ctx: StoreContext): Timestamp => ts(ctx);

function catalogHistory(ctx: StoreContext, entityType: string, entityId: string, changeKind: string, from: string | null, to: string | null, reasonCode: string, actorRef: string): void {
  ctx.db.run(
    'INSERT INTO catalog_history (entity_type, entity_id, change_kind, from_value, to_value, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    entityType,
    entityId,
    changeKind,
    from,
    to,
    reasonCode,
    actorRef,
    at(ctx),
  );
  appendAudit(ctx, `${entityType}.${changeKind.toLowerCase()}`, entityType, entityId, { actorRef }, 'OK', reasonCode, { from, to });
}

/** Founder authority for an administrative act; `subjectRef` detects self-escalation. */
export function founder(ctx: StoreContext, actorRef: string, subjectRef: string | null, what: string): Principal {
  const p = resolvePrincipal(ctx, actorRef);
  assertGovernanceAuthority(p.kind, p.ref, subjectRef, what);
  return p;
}

const optionalTimestamp = (v: unknown, field: string): Timestamp | null => {
  if (v === undefined || v === null) return null;
  if (!isTimestamp(v)) throw new QandeelError('VALIDATION_FAILED', `${field} must be a canonical UTC timestamp`, { field });
  return v;
};

export interface CreateEmployeeInput {
  readonly name: { readonly given: string; readonly family: string };
  readonly profile?: unknown;
  readonly cognitiveProfile: { readonly defaultClass: ReasoningClass; readonly ceilingClass: ReasoningClass; readonly costDiscipline: 'STRICT' | 'BALANCED' | 'THOROUGH' };
  readonly roleRef: string;
  readonly positionRef: string;
  readonly departmentId: string;
  readonly managerRef: string;
}

export interface RegisterDeploymentInput {
  readonly code: string;
  readonly modelId: string;
  readonly pinnedRevision: string;
  readonly reasoningClass: ReasoningClass;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly taskClasses?: readonly string[];
}

export interface PriceCardInput {
  readonly currency: string;
  readonly billingMode: BillingMode;
  readonly billedInputPerMTok: number;
  readonly billedOutputPerMTok: number;
  readonly billedPerCall: number;
  readonly economicInputPerMTok: number;
  readonly economicOutputPerMTok: number;
  readonly economicPerCall: number;
}

export interface RegisterToolActionInput {
  readonly toolId: string;
  readonly code: string;
  readonly risk: RiskLevel;
  readonly sideEffects: 'NONE' | 'IDEMPOTENT' | 'UNSAFE';
  readonly mutatesExternal: boolean;
  readonly dataClassCeiling: DataClass;
  /** Highest data class the result may carry into the run's context; defaults to the ceiling. */
  readonly resultDataClass?: DataClass;
  readonly argsSchema: unknown;
  readonly costPerCallMicros: number;
}

export interface GrantInput {
  readonly employeeId: string;
  readonly capability: string;
  readonly resourceScope?: string;
  readonly riskCeiling: RiskLevel;
  readonly dataClassCeiling: DataClass;
  readonly expiresAt?: string;
  readonly maxUses?: number;
  readonly reasonCode: string;
}

export interface CreateBudgetInput {
  readonly scope: BudgetScope;
  /** `company` for the Company budget; otherwise the department / employee / work item id. */
  readonly scopeId: string;
  readonly capMoney: number;
  readonly capTokens: number;
  /** Required for the Company budget; every other budget inherits the Company currency. */
  readonly currency?: string;
  readonly runCapMoney?: number;
  readonly runCapTokens?: number;
  readonly reasonCode: string;
}

export type ReconcileDecision = { readonly kind: 'CHARGE'; readonly inputTokens: number; readonly outputTokens: number } | { readonly kind: 'RELEASE' };

export interface GovernanceHealth {
  readonly employees: Record<string, number>;
  readonly executableEmployees: number;
  readonly providersOnHold: number;
  readonly deploymentsOnHold: number;
  readonly circuitsOpen: number;
  readonly qualifiedDeployments: number;
  readonly toolsOnHold: number;
  readonly activeToolActions: number;
  readonly toolInvocationsAwaitingReconciliation: number;
  readonly pendingApprovals: number;
  readonly budgetsExhausted: number;
  readonly budgetsNearLimit: number;
  readonly budgetsOverrun: number;
  readonly openReservations: number;
  readonly reservationsAwaitingReconciliation: number;
}

/**
 * Workspaces whose Founder-authority surface is armed in this process. Nothing in production arms
 * one: the only entry is the test-only seam, reachable solely under the `qandeel-test` export
 * condition. C5 replaces this with an authenticated Founder surface.
 */
const armedFounderSurfaces = new Set<string>();
/** The workspace root is canonical (realpath); an armed root is compared the same way (Windows 8.3 / symlinked temp dirs). */
const canonical = (root: string): string => {
  try {
    return realpathSync.native(root);
  } catch {
    return path.resolve(root);
  }
};
const founderSurfaceArmed = (store: CompanyStore): boolean => {
  if (armedFounderSurfaces.size === 0) return false;
  const root = canonical(store.workspace.root);
  for (const armed of armedFounderSurfaces) if (canonical(armed) === root) return true;
  return false;
};
let storeOf: (gov: GovernanceStore) => CompanyStore;

/** Test-seam internals: not exported from the package index; only `src/testing/` may import them. */
export const founderSurfaceInternals = Object.freeze({
  arm(root: string): void {
    armedFounderSurfaces.add(path.resolve(root));
  },
  disarm(root: string): void {
    const target = canonical(root);
    for (const armed of [...armedFounderSurfaces]) if (canonical(armed) === target) armedFounderSurfaces.delete(armed);
  },
  /** ACTIVE without C3 certification: a test fixture only, recorded as such in history and audit. */
  activateEmployee(gov: GovernanceStore, actorRef: string, employeeId: string): EmployeeRecord {
    const store = storeOf(gov);
    if (!founderSurfaceArmed(store)) throw new QandeelError('FOUNDER_SURFACE_UNAVAILABLE', 'the Founder test surface is not armed for this workspace');
    const ctx = storeContext(store);
    return ctx.db.immediate('test-seam activation', () => {
      const id = assertId(employeeId, 'employeeId');
      const p = founder(ctx, actorRef, `employee:${id}`, 'employee lifecycle');
      const e = getEmployeeRow(ctx, id);
      assertEmployeeTransition(e.state, 'ACTIVE');
      // The datastore keeps its invariant (ACTIVE carries evidence refs); the seam labels its own,
      // under a kind production refuses, so it can never pass for Academy certification.
      return setEmployeeState(ctx, e, 'ACTIVE', 'TEST_SEAM_ACTIVATION', p.ref, [...e.qualificationRefs, `test-seam:${id}`]);
    });
  },
});

/**
 * The one Founder-authority write path shared by the C2 and C3 stores (storage-internal; the package
 * index does not export it). An administrative refusal rolls its transaction back; the refusal itself
 * is audited in its own transaction (content-free) so misuse attempts stay visible (D14-E.1).
 */
export function founderAdminWrite<T>(store: CompanyStore, operation: string, actorRef: string, fn: (ctx: StoreContext) => T): T {
  const write = <R>(op: string, f: (ctx: StoreContext) => R): R => {
    const ctx = storeContext(store);
    return ctx.db.immediate(op, () => f(ctx));
  };
  try {
    // Before anything else: a caller-supplied ref is never authentication (D-C2-13).
    if (!founderSurfaceArmed(store)) {
      throw new QandeelError('FOUNDER_SURFACE_UNAVAILABLE', 'Founder authority requires the authenticated Founder surface (C5); a Founder reference is not authentication', { operation: operation.slice(0, 64) });
    }
    return write(operation, fn);
  } catch (error) {
    if (error instanceof QandeelError && ['FOUNDER_SURFACE_UNAVAILABLE', 'FOUNDER_ONLY', 'SELF_ESCALATION_REFUSED', 'AUTHORITY_DENIED'].includes(error.code)) {
      try {
        write('audit refusal', (ctx) => appendAudit(ctx, 'governance.refused', 'governance', 'admin', { actorRef: String(actorRef).slice(0, 161) }, 'REJECTED', error.code, { operation: operation.slice(0, 64) }));
      } catch {
        // Auditing a refusal never masks the refusal itself.
      }
    }
    throw error;
  }
}

export class GovernanceStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static {
    storeOf = (gov) => gov.#store;
  }

  /** A governance view over an open CompanyStore (same connection, same transactions). */
  static for(store: CompanyStore): GovernanceStore {
    return new GovernanceStore(store);
  }

  #write<T>(operation: string, fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.immediate(operation, () => fn(ctx));
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  /**
   * An administrative refusal rolls its transaction back; the refusal itself is audited in its own
   * transaction (content-free) so misuse attempts stay visible (D14-E.1).
   */
  #admin<T>(operation: string, actorRef: string, fn: (ctx: StoreContext) => T): T {
    return founderAdminWrite(this.#store, operation, actorRef, fn);
  }

  // --- Principals & organization ------------------------------------------------------------------

  /**
   * Registers the single Founder principal (human identity ≠ Employee, D14-A.2). Creating Founder
   * authority is itself a Founder-surface act: it fails closed until C5 authenticates the human.
   */
  registerFounder(): { ref: string; id: Id } {
    return this.#admin('register founder', 'founder:unauthenticated', (ctx) => {
      const existing = ctx.db.get(`SELECT id FROM principals WHERE kind = 'FOUNDER' AND status = 'ACTIVE'`);
      if (existing) throw new QandeelError('AUTHORITY_DENIED', 'a Founder principal is already registered', { reason: 'FOUNDER_EXISTS' });
      const id = newId();
      const ref = `founder:${id}`;
      ctx.db.run(`INSERT INTO principals (id, ref, kind, employee_id, status, created_at) VALUES (?, ?, 'FOUNDER', NULL, 'ACTIVE', ?)`, id, ref, at(ctx));
      appendAudit(ctx, 'principal.founder_registered', 'principal', id, { actorRef: ref }, 'OK', null, {});
      return { ref, id };
    });
  }

  founderRef(): string | null {
    return this.#read((ctx) => ctx.db.get<{ ref: string }>(`SELECT ref FROM principals WHERE kind = 'FOUNDER' AND status = 'ACTIVE'`)?.ref ?? null);
  }

  createDepartment(actorRef: string, input: { code: string; name: string }): DepartmentRecord {
    return this.#admin('create department', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'department creation');
      const id = newId();
      ctx.db.run(`INSERT INTO departments (id, code, name, status, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?)`, id, assertCatalogCode(input.code, 'code'), boundedText(input.name, 'name', 120), at(ctx), at(ctx));
      appendAudit(ctx, 'department.created', 'department', id, { actorRef: p.ref }, 'OK', null, {});
      return mapDepartment(ctx.db.get('SELECT * FROM departments WHERE id = ?', id) ?? {});
    });
  }

  // --- Employees ----------------------------------------------------------------------------------

  /** Creates a persistent Employee (CANDIDATE) and its employee principal. */
  createEmployee(actorRef: string, input: CreateEmployeeInput): EmployeeRecord {
    return this.#admin('create employee', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'employee creation');
      const name = assertEmployeeName(input.name);
      const cognitive = assertCognitiveProfile(input.cognitiveProfile);
      const dept = assertId(input.departmentId, 'departmentId');
      if (!ctx.db.get(`SELECT 1 AS ok FROM departments WHERE id = ? AND status = 'ACTIVE'`, dept)) throw new QandeelError('NOT_FOUND', 'department not found', { departmentId: dept });
      const id = newId();
      try {
        ctx.db.run(
          `INSERT INTO employees (id, given_name, family_name, name_origin, profile_json, cognitive_profile_json, role_ref, position_ref, department_id, manager_ref, state, version, created_at, updated_at)
           VALUES (?, ?, ?, 'EG', ?, ?, ?, ?, ?, ?, 'CANDIDATE', 1, ?, ?)`,
          id,
          name.given,
          name.family,
          profileJson(input.profile),
          canonicalJson(cognitive),
          assertOpaqueRef(input.roleRef, 'roleRef'),
          assertOpaqueRef(input.positionRef, 'positionRef'),
          dept,
          assertOpaqueRef(input.managerRef, 'managerRef'),
          at(ctx),
          at(ctx),
        );
      } catch (error) {
        if (error instanceof QandeelError && error.code === 'STORAGE_INVARIANT') throw new QandeelError('VALIDATION_FAILED', 'employee names are distinct; this name is already in use', { field: 'name' });
        throw error;
      }
      ctx.db.run(`INSERT INTO principals (id, ref, kind, employee_id, status, created_at) VALUES (?, ?, 'EMPLOYEE', ?, 'ACTIVE', ?)`, newId(), `employee:${id}`, id, at(ctx));
      const e = getEmployeeRow(ctx, id);
      writeEmployeeHistory(ctx, e, 'CREATED', null, 'CANDIDATE', 'employee.created', p.ref, { departmentId: dept });
      appendAudit(ctx, 'employee.created', 'employee', id, { actorRef: p.ref }, 'OK', null, { departmentId: dept });
      return e;
    });
  }

  /**
   * Lifecycle transition (Stage 4 §8). Activation (SHADOW / PROBATION → ACTIVE) requires Academy
   * certification, which C3 provides: in C2 it always fails closed, with no substitute (D-C2-13).
   */
  transitionEmployee(actorRef: string, employeeId: string, input: { to: EmployeeState; reasonCode: string; qualificationRefs?: readonly string[] }): EmployeeRecord {
    return this.#admin('transition employee', actorRef, (ctx) => {
      const id = assertId(employeeId, 'employeeId');
      const p = founder(ctx, actorRef, `employee:${id}`, 'employee lifecycle');
      const e = getEmployeeRow(ctx, id);
      assertEmployeeTransition(e.state, input.to);
      const refs = input.qualificationRefs === undefined ? e.qualificationRefs : assertQualificationRefs(input.qualificationRefs);
      if (input.to === 'ACTIVE') assertActivationAvailable(e.state);
      const next = setEmployeeState(ctx, e, input.to, assertCode(input.reasonCode, 'reasonCode'), p.ref, refs);
      if (input.to === 'RETIRED') {
        // A retired employee loses active authority (Stage 4 §14): its grants are revoked.
        ctx.db.run(`UPDATE permission_grants SET status = 'REVOKED', revoked_at = ?, revoked_by_ref = ? WHERE employee_id = ? AND status = 'ACTIVE'`, at(ctx), p.ref, id);
        ctx.db.run(`UPDATE principals SET status = 'RETIRED' WHERE employee_id = ?`, id);
      }
      return next;
    });
  }

  /** Role / Position / Department / Manager change: same Employee ID, history recorded (Stage 4 §9). */
  reassignEmployee(actorRef: string, employeeId: string, input: { roleRef?: string; positionRef?: string; departmentId?: string; managerRef?: string; reasonCode: string }): EmployeeRecord {
    return this.#admin('reassign employee', actorRef, (ctx) => {
      const id = assertId(employeeId, 'employeeId');
      const p = founder(ctx, actorRef, `employee:${id}`, 'employee assignment');
      const e = getEmployeeRow(ctx, id);
      if (e.state === 'RETIRED') throw new QandeelError('TERMINAL_STATE', 'a retired employee is history', { employeeId: id });
      const roleRef = input.roleRef === undefined ? e.roleRef : assertOpaqueRef(input.roleRef, 'roleRef');
      const positionRef = input.positionRef === undefined ? e.positionRef : assertOpaqueRef(input.positionRef, 'positionRef');
      const managerRef = input.managerRef === undefined ? e.managerRef : assertOpaqueRef(input.managerRef, 'managerRef');
      if (managerRef === e.ref) throw new QandeelError('VALIDATION_FAILED', 'an employee cannot manage itself', { field: 'managerRef' });
      const departmentId = input.departmentId === undefined ? e.departmentId : assertId(input.departmentId, 'departmentId');
      ctx.db.run(`UPDATE employees SET role_ref = ?, position_ref = ?, department_id = ?, manager_ref = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, roleRef, positionRef, departmentId, managerRef, at(ctx), id, e.version);
      const next = getEmployeeRow(ctx, id);
      writeEmployeeHistory(ctx, next, 'ASSIGNMENT', e.roleRef, roleRef, assertCode(input.reasonCode, 'reasonCode'), p.ref, { departmentId, previousDepartmentId: e.departmentId });
      appendAudit(ctx, 'employee.reassigned', 'employee', id, { actorRef: p.ref }, 'OK', input.reasonCode, { departmentId });
      return next;
    });
  }

  getEmployee(id: Id): EmployeeRecord {
    return this.#read((ctx) => getEmployeeRow(ctx, id));
  }

  listEmployees(state?: EmployeeState): EmployeeRecord[] {
    return this.#read((ctx) => (state ? ctx.db.all('SELECT * FROM employees WHERE state = ? ORDER BY created_at, id', state) : ctx.db.all('SELECT * FROM employees ORDER BY created_at, id')).map(mapEmployee));
  }

  employeeHistory(id: Id): EmployeeHistoryRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM employee_history WHERE employee_id = ? ORDER BY version', id).map(mapEmployeeHistory));
  }

  runAttributions(employeeId: Id): RunAttributionRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM run_attributions WHERE employee_id = ? ORDER BY created_at, run_id', employeeId).map(mapRunAttribution));
  }

  runAttribution(runId: Id): RunAttributionRecord | null {
    return this.#read((ctx) => {
      const r = ctx.db.get('SELECT * FROM run_attributions WHERE run_id = ?', runId);
      return r ? mapRunAttribution(r) : null;
    });
  }

  // --- Model catalog ------------------------------------------------------------------------------

  registerProvider(actorRef: string, input: { code: string; locality: Locality; credentialRef?: string }): ProviderRecord {
    return this.#admin('register provider', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'provider registration');
      if (!['LOCAL', 'EXTERNAL'].includes(input.locality)) throw new QandeelError('VALIDATION_FAILED', 'locality is LOCAL or EXTERNAL', { field: 'locality' });
      const cred = input.credentialRef === undefined ? null : assertCredentialRef(input.credentialRef);
      const id = newId();
      ctx.db.run(`INSERT INTO model_providers (id, code, locality, status, credential_ref, version, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', ?, 1, ?, ?)`, id, assertCatalogCode(input.code, 'code'), input.locality, cred, at(ctx), at(ctx));
      catalogHistory(ctx, 'provider', id, 'REGISTERED', null, 'ACTIVE', 'provider.registered', p.ref);
      return mapProvider(ctx.db.get('SELECT * FROM model_providers WHERE id = ?', id) ?? {});
    });
  }

  registerModel(actorRef: string, input: { providerId: string; code: string }): { id: Id; code: string } {
    return this.#admin('register model', actorRef, (ctx) => {
      founder(ctx, actorRef, null, 'model registration');
      const id = newId();
      ctx.db.run('INSERT INTO models (id, provider_id, code, created_at) VALUES (?, ?, ?, ?)', id, assertId(input.providerId, 'providerId'), assertCatalogCode(input.code, 'code'), at(ctx));
      return { id, code: input.code };
    });
  }

  /** A deployment profile starts as CANDIDATE with no approved egress: nothing routes to it yet. */
  registerDeployment(actorRef: string, input: RegisterDeploymentInput): DeploymentRecord {
    return this.#admin('register deployment', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'deployment registration');
      const cls = assertReasoningClass(input.reasoningClass, 'reasoningClass');
      if (cls === 'E0') throw new QandeelError('VALIDATION_FAILED', 'E0 is NO_LLM and has no deployment', { field: 'reasoningClass' });
      const tasks = [...new Set((input.taskClasses ?? []).map((t) => assertTaskClass(t)))];
      const id = newId();
      ctx.db.run(
        `INSERT INTO deployments (id, code, model_id, pinned_revision, reasoning_class, qualification, task_classes_json, egress_max_data_class, status, context_window_tokens, max_output_tokens, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'CANDIDATE', ?, NULL, 'ACTIVE', ?, ?, 1, ?, ?)`,
        id,
        assertCatalogCode(input.code, 'code'),
        assertId(input.modelId, 'modelId'),
        assertCode(input.pinnedRevision, 'pinnedRevision'),
        cls,
        JSON.stringify(tasks),
        assertTokens(input.contextWindowTokens, 'contextWindowTokens'),
        assertTokens(input.maxOutputTokens, 'maxOutputTokens'),
        at(ctx),
        at(ctx),
      );
      catalogHistory(ctx, 'deployment', id, 'REGISTERED', null, 'CANDIDATE', 'deployment.registered', p.ref);
      return this.#deployment(ctx, id);
    });
  }

  #deployment(ctx: StoreContext, id: Id): DeploymentRecord {
    const r = ctx.db.get('SELECT * FROM deployments WHERE id = ?', id);
    if (!r) throw new QandeelError('NOT_FOUND', 'deployment not found', { deploymentId: id });
    return mapDeployment(r);
  }

  #bumpDeployment(ctx: StoreContext, d: DeploymentRecord, set: string, ...values: (string | number | null)[]): DeploymentRecord {
    const changed = ctx.db.run(`UPDATE deployments SET ${set}, version = version + 1, updated_at = ? WHERE id = ?`, ...values, at(ctx), d.id).changes;
    if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'deployment changed concurrently', { deploymentId: d.id });
    return this.#deployment(ctx, d.id);
  }

  /** Adds a new immutable price-card version and makes it current (price provenance). */
  addPriceCard(actorRef: string, deploymentId: string, input: PriceCardInput): PriceCardRecord {
    return this.#admin('add price card', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'price card');
      const d = this.#deployment(ctx, assertId(deploymentId, 'deploymentId'));
      assertPriceCardRates(input);
      const company = budgetFor(ctx, 'COMPANY', 'company');
      if (company && company.currency !== input.currency) throw new QandeelError('CURRENCY_MISMATCH', 'price cards use the Company currency', { currency: input.currency });
      const version = Number(ctx.db.get<{ v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM price_cards WHERE deployment_id = ?', d.id)?.v ?? 0) + 1;
      const id = newId();
      ctx.db.run(
        `INSERT INTO price_cards (id, deployment_id, version, currency, billing_mode, billed_input_per_mtok, billed_output_per_mtok, billed_per_call, economic_input_per_mtok, economic_output_per_mtok, economic_per_call, created_by_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, d.id, version, input.currency, input.billingMode, input.billedInputPerMTok, input.billedOutputPerMTok, input.billedPerCall, input.economicInputPerMTok, input.economicOutputPerMTok, input.economicPerCall, p.ref, at(ctx),
      );
      this.#bumpDeployment(ctx, d, 'price_card_id = ?', id);
      catalogHistory(ctx, 'deployment', d.id, 'PRICE_CARD', d.priceCardId, id, 'price_card.added', p.ref);
      return mapPriceCard(ctx.db.get('SELECT * FROM price_cards WHERE id = ?', id) ?? {});
    });
  }

  /** Qualification advances one step at a time (D13-B.5); requalification restarts at CANDIDATE. */
  setQualification(actorRef: string, deploymentId: string, to: QualificationState, reasonCode: string): DeploymentRecord {
    return this.#admin('qualification', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'deployment qualification');
      const d = this.#deployment(ctx, assertId(deploymentId, 'deploymentId'));
      if (!(QUALIFICATION_NEXT[d.qualification] === to || to === 'CANDIDATE')) throw new QandeelError('INVALID_TRANSITION', `${d.qualification} -> ${to} is not a qualification step`, { from: d.qualification, to });
      const next = this.#bumpDeployment(ctx, d, 'qualification = ?', to);
      catalogHistory(ctx, 'deployment', d.id, 'QUALIFICATION', d.qualification, to, assertCode(reasonCode, 'reasonCode'), p.ref);
      return next;
    });
  }

  qualifyTaskClass(actorRef: string, deploymentId: string, taskClass: string, reasonCode: string): DeploymentRecord {
    return this.#admin('qualify task class', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'task class qualification');
      const d = this.#deployment(ctx, assertId(deploymentId, 'deploymentId'));
      const tasks = [...new Set([...d.taskClasses, assertTaskClass(taskClass)])];
      const next = this.#bumpDeployment(ctx, d, 'task_classes_json = ?', JSON.stringify(tasks));
      catalogHistory(ctx, 'deployment', d.id, 'TASK_CLASS', null, taskClass, assertCode(reasonCode, 'reasonCode'), p.ref);
      return next;
    });
  }

  /**
   * Explicit egress approval for one deployment / egress profile (D14-B.3/.5). D4 never goes to an
   * external provider, and in C2 neither does D3: its external authorization needs a qualified
   * conditional egress profile (account / endpoint / region / features / retention) that C2 does not
   * implement, so it fails closed (D-C2-13). `null` withdraws the approval.
   */
  approveEgress(actorRef: string, deploymentId: string, maxDataClass: DataClass | null, reasonCode: string): DeploymentRecord {
    return this.#admin('approve egress', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'egress approval');
      const d = this.#deployment(ctx, assertId(deploymentId, 'deploymentId'));
      if (maxDataClass !== null) assertDataClass(maxDataClass, 'maxDataClass');
      const locality = ctx.db.get<{ locality: string }>('SELECT p.locality FROM models m JOIN model_providers p ON p.id = m.provider_id WHERE m.id = ?', d.modelId)?.locality;
      if (maxDataClass === 'D4' && locality !== 'LOCAL') throw new QandeelError('EGRESS_DENIED', 'D4 is local-only and never approved for an external provider', { deploymentId: d.id });
      if (maxDataClass !== null && !externalEgressAvailable(locality === 'LOCAL' ? 'LOCAL' : 'EXTERNAL', maxDataClass)) {
        throw new QandeelError('EGRESS_DENIED', 'D3 external egress requires a qualified conditional egress profile, which C2 does not provide', { deploymentId: d.id, reason: 'D3_EGRESS_PROFILE_UNAVAILABLE' });
      }
      const next = this.#bumpDeployment(ctx, d, 'egress_max_data_class = ?', maxDataClass);
      catalogHistory(ctx, 'deployment', d.id, 'EGRESS', d.egressMaxDataClass, maxDataClass, assertCode(reasonCode, 'reasonCode'), p.ref);
      return next;
    });
  }

  /** Emergency stop / release for a provider, deployment or tool (Stage 1 §1). */
  setHold(actorRef: string, target: { entity: 'provider' | 'deployment' | 'tool'; id: string }, hold: boolean, reasonCode: string): void {
    this.#admin('hold', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'operational hold');
      const table = { provider: 'model_providers', deployment: 'deployments', tool: 'tools' }[target.entity];
      const id = assertId(target.id, 'id');
      const row = ctx.db.get<{ status: string }>(`SELECT status FROM ${table} WHERE id = ?`, id);
      if (!row) throw new QandeelError('NOT_FOUND', `${target.entity} not found`, { id });
      if (row.status === 'RETIRED') throw new QandeelError('TERMINAL_STATE', 'retired entities never change', { id });
      const code = assertCode(reasonCode, 'reasonCode');
      ctx.db.run(`UPDATE ${table} SET status = ?, hold_reason = ?, version = version + 1, updated_at = ? WHERE id = ?`, hold ? 'HOLD' : 'ACTIVE', hold ? code.slice(0, 64) : null, at(ctx), id);
      if (!hold && target.entity === 'deployment') ctx.db.run('UPDATE deployments SET circuit_failures = 0, circuit_open_until = NULL WHERE id = ?', id);
      catalogHistory(ctx, target.entity, id, hold ? 'HOLD' : 'RELEASE', row.status, hold ? 'HOLD' : 'ACTIVE', code, p.ref);
    });
  }

  resetCircuit(actorRef: string, deploymentId: string, reasonCode: string): DeploymentRecord {
    return this.#admin('reset circuit', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'circuit reset');
      const d = this.#deployment(ctx, assertId(deploymentId, 'deploymentId'));
      const next = this.#bumpDeployment(ctx, d, 'circuit_failures = 0, circuit_open_until = ?', null);
      catalogHistory(ctx, 'deployment', d.id, 'CIRCUIT_RESET', d.circuitOpenUntil, null, assertCode(reasonCode, 'reasonCode'), p.ref);
      return next;
    });
  }

  /** A new Router Policy version for one task class; the previous ACTIVE version is superseded. */
  createRoutePolicy(actorRef: string, taskClass: string, body: unknown): RoutePolicy {
    return this.#admin('route policy', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'route policy');
      const task = assertTaskClass(taskClass);
      const policy = assertRoutePolicyBody(body);
      const version = Number(ctx.db.get<{ v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM route_policies WHERE task_class = ?', task)?.v ?? 0) + 1;
      ctx.db.run(`UPDATE route_policies SET status = 'SUPERSEDED' WHERE task_class = ? AND status = 'ACTIVE'`, task);
      const id = newId();
      ctx.db.run(`INSERT INTO route_policies (id, task_class, version, policy_json, status, created_by_ref, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`, id, task, version, canonicalJson(policy), p.ref, at(ctx));
      catalogHistory(ctx, 'route_policy', id, 'ACTIVATED', null, String(version), 'route_policy.created', p.ref);
      return { id, taskClass: task, version, ...policy };
    });
  }

  /** The routing inputs for one task class, read in one consistent snapshot. */
  routingSnapshot(taskClass: string): { policy: RoutePolicy | null; deployments: DeploymentView[] } {
    return this.#read((ctx) => routingSnapshotTx(ctx, taskClass));
  }

  deployment(id: Id): DeploymentRecord {
    return this.#read((ctx) => this.#deployment(ctx, id));
  }

  provider(id: Id): ProviderRecord {
    return this.#read((ctx) => {
      const r = ctx.db.get('SELECT * FROM model_providers WHERE id = ?', id);
      if (!r) throw new QandeelError('NOT_FOUND', 'provider not found', { providerId: id });
      return mapProvider(r);
    });
  }

  catalogHistory(entityId: Id): { changeKind: string; fromValue: string | null; toValue: string | null; reasonCode: string; actorRef: string }[] {
    return this.#read((ctx) =>
      ctx.db
        .all<{ change_kind: string; from_value: string | null; to_value: string | null; reason_code: string; actor_ref: string }>('SELECT * FROM catalog_history WHERE entity_id = ? ORDER BY id', entityId)
        .map((r) => ({ changeKind: r.change_kind, fromValue: r.from_value, toValue: r.to_value, reasonCode: r.reason_code, actorRef: r.actor_ref })),
    );
  }

  // --- Tools ---------------------------------------------------------------------------------------

  registerTool(actorRef: string, input: { code: string; driverCode: string; egress: ToolEgress; credentialRef?: string }): ToolRecord {
    return this.#admin('register tool', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'tool registration');
      if (!['NONE', 'EXTERNAL'].includes(input.egress)) throw new QandeelError('VALIDATION_FAILED', 'egress is NONE or EXTERNAL', { field: 'egress' });
      const id = newId();
      ctx.db.run(
        `INSERT INTO tools (id, code, driver_code, egress, status, credential_ref, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, 1, ?, ?)`,
        id,
        assertToolCode(input.code, 'code'),
        assertToolCode(input.driverCode, 'driverCode'),
        input.egress,
        input.credentialRef === undefined ? null : assertCredentialRef(input.credentialRef),
        at(ctx),
        at(ctx),
      );
      catalogHistory(ctx, 'tool', id, 'REGISTERED', null, 'ACTIVE', 'tool.registered', p.ref);
      return mapTool(ctx.db.get('SELECT * FROM tools WHERE id = ?', id) ?? {});
    });
  }

  registerToolAction(actorRef: string, input: RegisterToolActionInput): ToolActionRecord {
    return this.#admin('register tool action', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'tool action registration');
      const toolId = assertId(input.toolId, 'toolId');
      const tool = ctx.db.get<{ egress: string }>('SELECT egress FROM tools WHERE id = ?', toolId);
      if (!tool) throw new QandeelError('NOT_FOUND', 'tool not found', { toolId });
      const def = { risk: input.risk, sideEffects: input.sideEffects, mutatesExternal: input.mutatesExternal === true, egress: tool.egress as ToolEgress };
      assertActionConsistency(def);
      if (def.egress === 'EXTERNAL' && !externalEgressAvailable('EXTERNAL', assertDataClass(input.dataClassCeiling, 'dataClassCeiling'))) {
        throw new QandeelError('EGRESS_DENIED', `an external tool action accepts at most ${MAX_EXTERNAL_DATA_CLASS} in C2 (no qualified D3 egress profile)`, { field: 'dataClassCeiling' });
      }
      const schema = assertArgsSchema(input.argsSchema);
      const id = newId();
      ctx.db.run(
        `INSERT INTO tool_actions (id, tool_id, code, risk_level, side_effects, mutates_external, requires_idempotency, data_class_ceiling, result_data_class, args_schema_json, cost_per_call_micros, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        id,
        toolId,
        assertToolCode(input.code, 'code'),
        input.risk,
        input.sideEffects,
        def.mutatesExternal ? 1 : 0,
        requiresIdempotencyKey(def) ? 1 : 0,
        assertDataClass(input.dataClassCeiling, 'dataClassCeiling'),
        assertDataClass(input.resultDataClass ?? input.dataClassCeiling, 'resultDataClass'),
        canonicalJson(schema),
        assertMoney(input.costPerCallMicros, 'costPerCallMicros'),
        at(ctx),
      );
      appendAudit(ctx, 'tool_action.registered', 'tool_action', id, { actorRef: p.ref }, 'OK', null, { toolId, risk: input.risk });
      return mapToolAction(ctx.db.get('SELECT * FROM tool_actions WHERE id = ?', id) ?? {});
    });
  }

  /** Driver codes that ACTIVE tools depend on (Tool Executor readiness: every one must be registered). */
  activeToolDriverCodes(): string[] {
    return this.#read((ctx) => ctx.db.all<{ d: string }>(`SELECT DISTINCT driver_code AS d FROM tools WHERE status = 'ACTIVE' ORDER BY d`).map((r) => r.d));
  }

  tool(id: Id): ToolRecord {
    return this.#read((ctx) => mapTool(ctx.db.get('SELECT * FROM tools WHERE id = ?', id) ?? notFound('tool', id)));
  }

  toolInvocations(runOrWorkItemId: Id): ToolInvocationRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM tool_invocations WHERE run_id = ? OR work_item_id = ? ORDER BY created_at, id', runOrWorkItemId, runOrWorkItemId).map(mapToolInvocation));
  }

  // --- Grants --------------------------------------------------------------------------------------

  /** An explicit, scoped grant (D14-C.3). R2 and R4 are never grantable (review / Founder-only). */
  grant(actorRef: string, input: GrantInput): GrantRecord {
    return this.#admin('grant', actorRef, (ctx) => {
      const employeeId = assertId(input.employeeId, 'employeeId');
      const p = founder(ctx, actorRef, `employee:${employeeId}`, 'permission grant');
      const e = getEmployeeRow(ctx, employeeId);
      if (e.state === 'RETIRED') throw new QandeelError('TERMINAL_STATE', 'a retired employee receives no grants', { employeeId });
      if (!['R0', 'R1', 'R3'].includes(input.riskCeiling)) throw new QandeelError('VALIDATION_FAILED', 'grants carry R0, R1 or R3 ceilings; R2 needs independent review and R4 is Founder-only', { field: 'riskCeiling' });
      const scope = input.resourceScope ?? '*';
      if (!RESOURCE_SCOPE.test(scope)) throw new QandeelError('VALIDATION_FAILED', 'resourceScope must be "*" or one resource code', { field: 'resourceScope' });
      if (input.maxUses !== undefined && !(Number.isSafeInteger(input.maxUses) && input.maxUses >= 1 && input.maxUses <= 1_000_000)) throw new QandeelError('VALIDATION_FAILED', 'maxUses must be 1..1000000', { field: 'maxUses' });
      const id = newId();
      ctx.db.run(
        `INSERT INTO permission_grants (id, employee_id, capability, resource_scope, risk_ceiling, data_class_ceiling, expires_at, max_uses, uses, status, granted_by_ref, reason_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'ACTIVE', ?, ?, ?)`,
        id,
        employeeId,
        assertCapability(input.capability),
        scope,
        input.riskCeiling,
        assertDataClass(input.dataClassCeiling, 'dataClassCeiling'),
        optionalTimestamp(input.expiresAt, 'expiresAt'),
        input.maxUses ?? null,
        p.ref,
        assertCode(input.reasonCode, 'reasonCode'),
        at(ctx),
      );
      appendAudit(ctx, 'grant.created', 'grant', id, { actorRef: p.ref }, 'OK', input.reasonCode, { employeeId, riskCeiling: input.riskCeiling, dataClassCeiling: input.dataClassCeiling });
      return mapGrant(ctx.db.get('SELECT * FROM permission_grants WHERE id = ?', id) ?? {});
    });
  }

  /** Immediate, enforceable revocation (Stage 3 §8). */
  revokeGrant(actorRef: string, grantId: string, reasonCode: string): GrantRecord {
    return this.#admin('revoke grant', actorRef, (ctx) => {
      const id = assertId(grantId, 'grantId');
      const p = founder(ctx, actorRef, null, 'grant revocation');
      const changed = ctx.db.run(`UPDATE permission_grants SET status = 'REVOKED', revoked_at = ?, revoked_by_ref = ? WHERE id = ? AND status = 'ACTIVE'`, at(ctx), p.ref, id).changes;
      if (changed !== 1) throw new QandeelError('INVALID_TRANSITION', 'grant is not active', { grantId: id });
      appendAudit(ctx, 'grant.revoked', 'grant', id, { actorRef: p.ref }, 'OK', assertCode(reasonCode, 'reasonCode'), {});
      return mapGrant(ctx.db.get('SELECT * FROM permission_grants WHERE id = ?', id) ?? {});
    });
  }

  grants(employeeId: Id): GrantRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM permission_grants WHERE employee_id = ? ORDER BY created_at, id', employeeId).map(mapGrant));
  }

  // --- Approvals -----------------------------------------------------------------------------------

  /**
   * Requests Founder approval to execute an approval-gated Work Item (the C1 fail-closed gate).
   * The scope binds the owner, the Work Item and the SHA-256 of its immutable content; a rejected
   * request does not silently regenerate (Stage 3 §5): a re-request must name the rejection it follows.
   */
  requestWorkItemApproval(requesterRef: string, workItemId: string, options: { reRequestOf?: string } = {}): ApprovalRecord {
    return this.#write('request work item approval', (ctx) => {
      const requester = resolvePrincipal(ctx, requesterRef);
      const item = getWorkItemRow(ctx, assertId(workItemId, 'workItemId'));
      if (item.state !== 'WAITING_APPROVAL') throw new QandeelError('INVALID_TRANSITION', 'only work waiting for approval needs a work-item approval', { workItemId: item.id, state: item.state });
      const argsSha256 = sha256Hex(canonicalJson({ objective: item.objective, processorKind: item.processorKind, processorInput: item.processorInput, owner: item.ownerRef }));
      const scope = { subjectRef: item.ownerRef, action: 'work_item.execute', resourceRef: `work_item:${item.id}`, workItemId: item.id, argsSha256, dataClass: workItemDataClass(item.processorInput), risk: item.riskLevel, limits: { maxCostMicros: null } };
      return upsertApprovalRequest(ctx, requester.ref, scope, options.reRequestOf === undefined ? null : assertId(options.reRequestOf, 'reRequestOf'));
    });
  }

  /**
   * Decides an approval (Founder only for R3 in Strong v1; R2 / R4 are never approvable). Approving
   * a `work_item.execute` approval releases the Work Item in the same transaction; approving a tool
   * approval wakes the parked Work Item (targeted) so its run resumes and re-checks everything.
   */
  decideApproval(actorRef: string, approvalId: string, input: { decision: 'APPROVE' | 'REJECT'; reasonCode: string; expiresAt?: string }): ApprovalRecord {
    return this.#admin('decide approval', actorRef, (ctx) => {
      const id = assertId(approvalId, 'approvalId');
      const a = getApproval(ctx, id);
      const p = resolvePrincipal(ctx, actorRef);
      // The subject is who gains authority: it never approves itself. (Filing a request on someone's
      // behalf and deciding it is not self-escalation; decisions are Founder-only anyway.)
      if (p.ref === a.subjectRef || (p.kind !== 'FOUNDER' && p.ref === a.requestedByRef)) throw new QandeelError('SELF_ESCALATION_REFUSED', 'an actor cannot approve its own request', { what: 'approval' });
      assertApprover(p.kind, a.risk);
      if (a.state !== 'PENDING') throw new QandeelError('INVALID_TRANSITION', 'only a pending approval can be decided', { approvalId: id, state: a.state });
      const reason = assertCode(input.reasonCode, 'reasonCode');
      const expiresAt = optionalTimestamp(input.expiresAt, 'expiresAt');
      if (expiresAt !== null && expiresAt <= at(ctx)) throw new QandeelError('VALIDATION_FAILED', 'expiresAt must be in the future', { field: 'expiresAt' });
      const to = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      ctx.db.run(
        `UPDATE approvals SET state = ?, decided_by_ref = ?, decided_at = ?, reason_code = ?, expires_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
        to,
        p.ref,
        at(ctx),
        reason,
        expiresAt,
        at(ctx),
        id,
        a.version,
      );
      approvalHistory(ctx, id, a.version + 1, 'PENDING', to, reason, p.ref);
      appendAudit(ctx, `approval.${to.toLowerCase()}`, 'approval', id, { actorRef: p.ref }, 'OK', reason, { risk: a.risk, action: a.action.slice(0, 64) });
      if (to === 'APPROVED' && a.workItemId !== null) {
        if (a.action === 'work_item.execute') releaseApprovedWorkItem(ctx, a.workItemId, id, p.ref);
        else wakeWorkItemJob(ctx, a.workItemId, ['AWAITING_APPROVAL'], 'approval.granted');
      }
      if (to === 'REJECTED' && a.workItemId !== null && a.action !== 'work_item.execute') wakeWorkItemJob(ctx, a.workItemId, ['AWAITING_APPROVAL'], 'approval.rejected');
      return getApproval(ctx, id);
    });
  }

  getApproval(id: Id): ApprovalRecord {
    return this.#read((ctx) => getApproval(ctx, id));
  }

  listApprovals(state?: ApprovalRecord['state']): ApprovalRecord[] {
    return this.#read((ctx) => (state ? ctx.db.all('SELECT * FROM approvals WHERE state = ? ORDER BY created_at, id', state) : ctx.db.all('SELECT * FROM approvals ORDER BY created_at, id')).map(mapApproval));
  }

  approvalHistory(id: Id): { version: number; fromState: string | null; toState: string; reasonCode: string; actorRef: string }[] {
    return this.#read((ctx) =>
      ctx.db
        .all<{ version: number; from_state: string | null; to_state: string; reason_code: string; actor_ref: string }>('SELECT * FROM approval_history WHERE approval_id = ? ORDER BY version', id)
        .map((r) => ({ version: Number(r.version), fromState: r.from_state, toState: r.to_state, reasonCode: r.reason_code, actorRef: r.actor_ref })),
    );
  }

  // --- Budgets -------------------------------------------------------------------------------------

  /**
   * Creates one level of the hard hierarchy. A child cap never exceeds its parent's cap; the parent
   * must already exist (Company → Department → Employee → Work Item). Run budgets are created by the
   * runtime at the first reservation of a run, within the Work Item budget.
   */
  createBudget(actorRef: string, input: CreateBudgetInput): BudgetRecord {
    return this.#admin('create budget', actorRef, (ctx) => {
      const subject = input.scope === 'EMPLOYEE' ? `employee:${input.scopeId}` : input.scope === 'WORK_ITEM' ? getWorkItemRow(ctx, assertId(input.scopeId, 'scopeId')).ownerRef : null;
      const p = founder(ctx, actorRef, subject, 'budget creation');
      if (input.scope === 'RUN') throw new QandeelError('VALIDATION_FAILED', 'run budgets are derived by the runtime from the Work Item budget', { field: 'scope' });
      const capMoney = assertMoney(input.capMoney, 'capMoney');
      const capTokens = assertTokens(input.capTokens, 'capTokens');
      let parent: BudgetRecord | null = null;
      let currency: string;
      let scopeId: string;
      if (input.scope === 'COMPANY') {
        if (input.scopeId !== 'company') throw new QandeelError('VALIDATION_FAILED', 'the Company budget scope id is "company"', { field: 'scopeId' });
        scopeId = 'company';
        currency = assertCurrency(input.currency);
      } else {
        scopeId = assertId(input.scopeId, 'scopeId');
        parent = parentBudgetFor(ctx, input.scope, scopeId as Id);
        currency = parent.currency;
        if (input.currency !== undefined && input.currency !== currency) throw new QandeelError('CURRENCY_MISMATCH', 'all budgets use the Company currency', { currency: input.currency });
        if (capMoney > parent.capMoney || capTokens > parent.capTokens) throw new QandeelError('BUDGET_EXHAUSTED', 'a child budget cap cannot exceed its parent cap', { scope: input.scope, parentId: parent.id });
      }
      const runCapMoney = input.runCapMoney === undefined ? null : assertMoney(input.runCapMoney, 'runCapMoney');
      const runCapTokens = input.runCapTokens === undefined ? null : assertTokens(input.runCapTokens, 'runCapTokens');
      if (input.scope !== 'WORK_ITEM' && (runCapMoney !== null || runCapTokens !== null)) throw new QandeelError('VALIDATION_FAILED', 'run caps belong to Work Item budgets', { field: 'runCapMoney' });
      if (budgetFor(ctx, input.scope, scopeId)) throw new QandeelError('VALIDATION_FAILED', 'this scope already has a budget; change its cap instead', { scope: input.scope });
      const id = newId();
      ctx.db.run(
        `INSERT INTO budgets (id, scope, scope_id, parent_id, currency, cap_money, cap_tokens, run_cap_money, run_cap_tokens, version, created_by_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        id, input.scope, scopeId, parent?.id ?? null, currency, capMoney, capTokens, runCapMoney, runCapTokens, p.ref, at(ctx), at(ctx),
      );
      budgetHistory(ctx, id, 'CREATED', capMoney, capTokens, assertCode(input.reasonCode, 'reasonCode'), p.ref);
      return getBudgetRow(ctx, id);
    });
  }

  /**
   * Changes a cap. Employees can never change their own (or any) cap; Company / Department caps
   * require the Founder (Stage 3 §6). A cap never drops below what is already reserved and spent,
   * and never rises above the parent cap. Raising a cap wakes only the work it was blocking.
   */
  changeBudgetCap(actorRef: string, budgetId: string, input: { capMoney: number; capTokens: number; reasonCode: string }): BudgetRecord {
    return this.#admin('change budget cap', actorRef, (ctx) => {
      const b = getBudgetRow(ctx, assertId(budgetId, 'budgetId'));
      founder(ctx, actorRef, budgetSubjectRef(ctx, b), 'budget cap change');
      const capMoney = assertMoney(input.capMoney, 'capMoney');
      const capTokens = assertTokens(input.capTokens, 'capTokens');
      if (b.parentId !== null) {
        const parent = getBudgetRow(ctx, b.parentId);
        if (capMoney > parent.capMoney || capTokens > parent.capTokens) throw new QandeelError('BUDGET_EXHAUSTED', 'a child budget cap cannot exceed its parent cap', { budgetId: b.id, parentId: parent.id });
      }
      const children = ctx.db.get<{ m: number | null; t: number | null }>('SELECT MAX(cap_money) AS m, MAX(cap_tokens) AS t FROM budgets WHERE parent_id = ?', b.id);
      if (capMoney < Number(children?.m ?? 0) || capTokens < Number(children?.t ?? 0)) throw new QandeelError('VALIDATION_FAILED', 'a cap cannot drop below a child budget\'s cap; lower the children first', { budgetId: b.id });
      if (capMoney + b.overrunMoney < b.reservedMoney + b.spentMoney || capTokens + b.overrunTokens < b.reservedTokens + b.spentTokens) throw new QandeelError('VALIDATION_FAILED', 'a cap cannot drop below what is already reserved and spent', { budgetId: b.id });
      ctx.db.run('UPDATE budgets SET cap_money = ?, cap_tokens = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', capMoney, capTokens, at(ctx), b.id, b.version);
      const actor = resolvePrincipal(ctx, actorRef);
      budgetHistory(ctx, b.id, 'CAP_CHANGED', capMoney, capTokens, assertCode(input.reasonCode, 'reasonCode'), actor.ref);
      if (capMoney > b.capMoney || capTokens > b.capTokens) {
        for (const w of workItemsUnderBudget(ctx, b)) wakeWorkItemJob(ctx, w, ['BUDGET_EXHAUSTED'], 'budget.raised');
      }
      return getBudgetRow(ctx, b.id);
    });
  }

  budget(id: Id): BudgetRecord {
    return this.#read((ctx) => getBudgetRow(ctx, id));
  }

  budgetFor(scope: BudgetScope, scopeId: string): BudgetRecord | null {
    return this.#read((ctx) => budgetFor(ctx, scope, scopeId));
  }

  reservations(runId: Id): ReservationRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM budget_reservations WHERE run_id = ? ORDER BY created_at, id', runId).map(mapReservation));
  }

  reservationsInState(state: ReservationRecord['state']): ReservationRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM budget_reservations WHERE state = ? ORDER BY created_at, id', state).map(mapReservation));
  }

  usage(filter: { runId?: Id; workItemId?: Id; employeeId?: Id } = {}): UsageRecord[] {
    return this.#read((ctx) => {
      if (filter.runId) return ctx.db.all('SELECT * FROM usage_records WHERE run_id = ? ORDER BY created_at, id', filter.runId).map(mapUsage);
      if (filter.workItemId) return ctx.db.all('SELECT * FROM usage_records WHERE work_item_id = ? ORDER BY created_at, id', filter.workItemId).map(mapUsage);
      if (filter.employeeId) return ctx.db.all('SELECT * FROM usage_records WHERE employee_id = ? ORDER BY created_at, id', filter.employeeId).map(mapUsage);
      return ctx.db.all('SELECT * FROM usage_records ORDER BY created_at, id').map(mapUsage);
    });
  }

  /**
   * Explicit reconciliation of a held reservation (an uncertain provider call or an interrupted run):
   * charge the usage the provider reports, or release it once it is known nothing was billed.
   */
  reconcileReservation(actorRef: string, reservationId: string, decision: ReconcileDecision, reasonCode: string): ReservationRecord {
    return this.#admin('reconcile reservation', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'reservation reconciliation');
      const r = getReservationRow(ctx, assertId(reservationId, 'reservationId'));
      if (r.state !== 'RECONCILIATION_REQUIRED') throw new QandeelError('INVALID_TRANSITION', 'only a held reservation is reconciled', { reservationId: r.id, state: r.state });
      if (ctx.db.get(`SELECT 1 AS x FROM tool_invocations WHERE reservation_id = ? AND state = 'RECONCILIATION_REQUIRED'`, r.id)) {
        throw new QandeelError('INVALID_TRANSITION', 'this reservation belongs to an uncertain tool invocation; resolve the invocation instead', { reservationId: r.id });
      }
      const code = assertCode(reasonCode, 'reasonCode');
      if (decision.kind === 'RELEASE') releaseReservationTx(ctx, r, code, p.ref);
      else settleReservationTx(ctx, r, { inputTokens: assertTokens(decision.inputTokens, 'inputTokens'), outputTokens: assertTokens(decision.outputTokens, 'outputTokens'), withinBounds: true, sessionId: null, outcome: 'RECONCILED' }, p.ref);
      appendAudit(ctx, 'budget.reconciled', 'reservation', r.id, { actorRef: p.ref }, 'OK', code, { decision: decision.kind });
      return getReservationRow(ctx, r.id);
    });
  }

  /**
   * Explicit resolution of a tool invocation whose outcome was uncertain (Stage 12 §27): the
   * operator checked external reality. A confirmed effect is never repeated; a confirmed non-effect
   * may be retried by the resumed run under the same idempotency key.
   */
  resolveToolInvocation(actorRef: string, invocationId: string, outcome: 'CONFIRMED_SUCCEEDED' | 'CONFIRMED_NOT_EXECUTED', reasonCode: string): ToolInvocationRecord {
    return this.#admin('resolve tool invocation', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'tool reconciliation');
      const id = assertId(invocationId, 'invocationId');
      const inv = mapToolInvocation(ctx.db.get('SELECT * FROM tool_invocations WHERE id = ?', id) ?? notFound('tool invocation', id));
      if (inv.state !== 'RECONCILIATION_REQUIRED') throw new QandeelError('INVALID_TRANSITION', 'only an uncertain invocation is resolved', { invocationId: id, state: inv.state });
      const code = assertCode(reasonCode, 'reasonCode');
      const r = inv.reservationId ? getReservationRow(ctx, inv.reservationId) : null;
      if (outcome === 'CONFIRMED_SUCCEEDED') {
        const result = { reconciled: true };
        ctx.db.run(`UPDATE tool_invocations SET state = 'SUCCEEDED', result_json = ?, result_sha256 = ?, updated_at = ? WHERE id = ?`, JSON.stringify(result), sha256Hex(canonicalJson(result)), at(ctx), id);
        if (r && (r.state === 'RESERVED' || r.state === 'RECONCILIATION_REQUIRED')) settleReservationTx(ctx, r, { inputTokens: 0, outputTokens: 0, withinBounds: true, sessionId: null, outcome: 'RECONCILED' }, p.ref);
      } else {
        ctx.db.run(`UPDATE tool_invocations SET state = 'RETRYABLE', failure_code = ?, updated_at = ? WHERE id = ?`, 'CONFIRMED_NOT_EXECUTED', at(ctx), id);
        if (r && (r.state === 'RESERVED' || r.state === 'RECONCILIATION_REQUIRED')) releaseReservationTx(ctx, r, 'CONFIRMED_NOT_EXECUTED', p.ref);
      }
      appendAudit(ctx, 'tool.reconciled', 'tool_invocation', id, { actorRef: p.ref }, 'OK', code, { outcome });
      return mapToolInvocation(ctx.db.get('SELECT * FROM tool_invocations WHERE id = ?', id) ?? {});
    });
  }

  // --- Health & invariants -------------------------------------------------------------------------

  healthCounts(): GovernanceHealth {
    return this.#read((ctx) => {
      const n = (sql: string, ...p: (string | number)[]): number => Number(ctx.db.get<{ n: number }>(sql, ...p)?.n ?? 0);
      const now = at(ctx);
      const budgets = ctx.db.all('SELECT * FROM budgets').map(mapBudget);
      return {
        employees: Object.fromEntries(ctx.db.all<{ state: string; n: number }>('SELECT state, COUNT(*) AS n FROM employees GROUP BY state').map((r) => [r.state, Number(r.n)])),
        executableEmployees: n(`SELECT COUNT(*) AS n FROM employees WHERE state = 'ACTIVE'`),
        providersOnHold: n(`SELECT COUNT(*) AS n FROM model_providers WHERE status = 'HOLD'`),
        deploymentsOnHold: n(`SELECT COUNT(*) AS n FROM deployments WHERE status = 'HOLD'`),
        circuitsOpen: n(`SELECT COUNT(*) AS n FROM deployments WHERE circuit_open_until IS NOT NULL AND circuit_open_until > ?`, now),
        qualifiedDeployments: n(`SELECT COUNT(*) AS n FROM deployments WHERE qualification = 'QUALIFIED' AND status = 'ACTIVE'`),
        toolsOnHold: n(`SELECT COUNT(*) AS n FROM tools WHERE status = 'HOLD'`),
        activeToolActions: n(`SELECT COUNT(*) AS n FROM tool_actions a JOIN tools t ON t.id = a.tool_id WHERE a.status = 'ACTIVE' AND t.status = 'ACTIVE'`),
        toolInvocationsAwaitingReconciliation: n(`SELECT COUNT(*) AS n FROM tool_invocations WHERE state = 'RECONCILIATION_REQUIRED'`),
        pendingApprovals: n(`SELECT COUNT(*) AS n FROM approvals WHERE state = 'PENDING'`),
        budgetsExhausted: budgets.filter((b) => b.scope !== 'RUN' && utilisationPercent(b) >= 100).length,
        budgetsNearLimit: budgets.filter((b) => b.scope !== 'RUN' && utilisationPercent(b) >= NEAR_LIMIT_PERCENT && utilisationPercent(b) < 100).length,
        budgetsOverrun: budgets.filter((b) => b.overrunMoney > 0 || b.overrunTokens > 0).length,
        openReservations: n(`SELECT COUNT(*) AS n FROM budget_reservations WHERE state = 'RESERVED'`),
        reservationsAwaitingReconciliation: n(`SELECT COUNT(*) AS n FROM budget_reservations WHERE state = 'RECONCILIATION_REQUIRED'`),
      };
    });
  }

  /**
   * Accounting invariants, recomputed from the append-only facts: for every budget, `reserved`
   * equals the open reservations beneath it and `spent` equals the usage charged beneath it. Returns
   * the violations (empty when coherent). Used by tests, crash proofs and health.
   */
  accountingInvariants(): string[] {
    return this.#read((ctx) => {
      const budgets = ctx.db.all('SELECT * FROM budgets').map(mapBudget);
      const byId = new Map(budgets.map((b) => [b.id, b]));
      const expected = new Map(budgets.map((b) => [b.id, { rm: 0, rt: 0, sm: 0, st: 0 }]));
      const ancestors = (leaf: Id): Id[] => {
        const out: Id[] = [];
        for (let c: Id | null = leaf; c !== null && out.length < 6; c = byId.get(c)?.parentId ?? null) out.push(c);
        return out;
      };
      for (const r of ctx.db.all(`SELECT * FROM budget_reservations WHERE state IN ('RESERVED', 'RECONCILIATION_REQUIRED')`).map(mapReservation)) {
        for (const id of ancestors(r.budgetId)) {
          const e = expected.get(id);
          if (e) {
            e.rm += r.money;
            e.rt += r.tokens;
          }
        }
      }
      for (const u of ctx.db.all<{ budget_id: string; economic_micros: number; charged_tokens: number }>('SELECT r.budget_id, u.economic_micros, u.charged_tokens FROM usage_records u JOIN budget_reservations r ON r.id = u.reservation_id')) {
        for (const id of ancestors(u.budget_id as Id)) {
          const e = expected.get(id);
          if (e) {
            e.sm += Number(u.economic_micros);
            e.st += Number(u.charged_tokens);
          }
        }
      }
      const violations: string[] = [];
      for (const b of budgets) {
        const e = expected.get(b.id) as { rm: number; rt: number; sm: number; st: number };
        if (e.rm !== b.reservedMoney || e.rt !== b.reservedTokens) violations.push(`budget ${b.id} (${b.scope}) reserved ${b.reservedMoney}/${b.reservedTokens} != open reservations ${e.rm}/${e.rt}`);
        if (e.sm !== b.spentMoney || e.st !== b.spentTokens) violations.push(`budget ${b.id} (${b.scope}) spent ${b.spentMoney}/${b.spentTokens} != usage ${e.sm}/${e.st}`);
        if (b.reservedMoney + b.spentMoney > b.capMoney + b.overrunMoney || b.reservedTokens + b.spentTokens > b.capTokens + b.overrunTokens) violations.push(`budget ${b.id} exceeds its cap`);
      }
      for (const b of budgets) {
        const parent = b.parentId ? byId.get(b.parentId) : undefined;
        if (parent && (b.capMoney > parent.capMoney || b.capTokens > parent.capTokens)) violations.push(`budget ${b.id} (${b.scope}) cap exceeds its parent's cap`);
      }
      const n = (sql: string): number => Number(ctx.db.get<{ n: number }>(sql)?.n ?? 0);
      const usageOnOpen = n(`SELECT COUNT(*) AS n FROM usage_records u JOIN budget_reservations r ON r.id = u.reservation_id WHERE r.state <> 'SETTLED'`);
      if (usageOnOpen) violations.push(`${usageOnOpen} usage record(s) on a reservation that is not SETTLED`);
      const succeededUnsettled = n(`SELECT COUNT(*) AS n FROM tool_invocations i JOIN budget_reservations r ON r.id = i.reservation_id WHERE i.state = 'SUCCEEDED' AND r.state <> 'SETTLED'`);
      if (succeededUnsettled) violations.push(`${succeededUnsettled} succeeded tool invocation(s) whose reservation is not settled`);
      const wrongLeaf = n(`SELECT COUNT(*) AS n FROM budget_reservations r JOIN budgets b ON b.id = r.budget_id WHERE b.scope <> 'RUN' OR b.scope_id <> r.run_id`);
      if (wrongLeaf) violations.push(`${wrongLeaf} reservation(s) not held against their own Run budget`);
      const misattributed = n(`SELECT COUNT(*) AS n FROM budget_reservations r JOIN run_attributions a ON a.run_id = r.run_id WHERE a.employee_id <> r.employee_id OR a.department_id <> r.department_id OR a.work_item_id <> r.work_item_id`);
      if (misattributed) violations.push(`${misattributed} reservation(s) attributed differently from their run`);
      const settledWithoutUsage = Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM budget_reservations r WHERE r.state = 'SETTLED' AND NOT EXISTS (SELECT 1 FROM usage_records u WHERE u.reservation_id = r.id)`)?.n ?? 0);
      if (settledWithoutUsage) violations.push(`${settledWithoutUsage} settled reservation(s) without a usage record`);
      return violations;
    });
  }
}

// --- helpers --------------------------------------------------------------------------------------

function notFound(what: string, id: string): never {
  throw new QandeelError('NOT_FOUND', `${what} not found`, { id });
}

/** `vault:<name>` — a reference to a secret held in the host's protected vault, never a value. */
export function assertCredentialRef(v: unknown): string {
  if (typeof v !== 'string' || !/^vault:[a-z0-9][a-z0-9.-]{0,57}$/.test(v)) throw new QandeelError('VALIDATION_FAILED', 'credentialRef is a vault reference "vault:<name>", never a secret value', { field: 'credentialRef' });
  return v;
}

/**
 * The data class declared for a governed Work Item's context. Missing → D1 INTERNAL (the Company's
 * ordinary internal class; surfaced to the Product Owner). Present but not a valid class → D4:
 * classification fails closed, never open (a typo can never widen egress).
 */
export function workItemDataClass(processorInput: unknown): DataClass {
  const o = processorInput as { dataClass?: unknown } | null;
  if (o === null || typeof o !== 'object' || !('dataClass' in o) || o.dataClass === undefined) return 'D1';
  return isDataClass(o.dataClass) ? o.dataClass : 'D4';
}

function getApproval(ctx: StoreContext, id: Id): ApprovalRecord {
  const r = ctx.db.get('SELECT * FROM approvals WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'approval not found', { approvalId: id });
  return mapApproval(r);
}

function approvalHistory(ctx: StoreContext, approvalId: Id, version: number, from: string | null, to: string, reasonCode: string, actorRef: string): void {
  ctx.db.run('INSERT INTO approval_history (approval_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', approvalId, version, from, to, reasonCode, actorRef, at(ctx));
}

export interface ApprovalScopeInput {
  readonly subjectRef: string;
  readonly action: string;
  readonly resourceRef: string;
  readonly workItemId: Id | null;
  readonly argsSha256: string;
  readonly dataClass: DataClass;
  readonly risk: RiskLevel;
  readonly limits: { readonly maxCostMicros: number | null };
}

/**
 * Creates (or returns the existing pending) approval request for one exact scope. A rejected scope
 * is not silently re-requested (Stage 3 §5); an explicit re-request links the rejection it follows.
 */
export function upsertApprovalRequest(ctx: StoreContext, requesterRef: string, scope: ApprovalScopeInput, reRequestOf: Id | null): ApprovalRecord {
  const fingerprint = approvalFingerprint(scope);
  const live = ctx.db.get(`SELECT * FROM approvals WHERE fingerprint = ? AND state IN ('PENDING', 'APPROVED') ORDER BY created_at DESC LIMIT 1`, fingerprint);
  if (live) return mapApproval(live);
  const rejected = ctx.db.get<{ id: string }>(`SELECT id FROM approvals WHERE fingerprint = ? AND state = 'REJECTED' ORDER BY created_at DESC LIMIT 1`, fingerprint);
  if (rejected && reRequestOf !== rejected.id) throw new QandeelError('APPROVAL_REJECTED', 'this exact request was rejected; re-request it explicitly after a meaningful change', { approvalId: rejected.id });
  const id = newId();
  ctx.db.run(
    `INSERT INTO approvals (id, subject_ref, requested_by_ref, action, resource_ref, work_item_id, risk_level, data_class, args_sha256, fingerprint, limits_json, state, max_uses, uses, rerequest_of, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 1, 0, ?, 1, ?, ?)`,
    id, scope.subjectRef, requesterRef, scope.action, scope.resourceRef, scope.workItemId, scope.risk, scope.dataClass, scope.argsSha256, fingerprint, canonicalJson(scope.limits), rejected ? rejected.id : null, at(ctx), at(ctx),
  );
  approvalHistory(ctx, id, 1, null, 'PENDING', 'approval.requested', requesterRef);
  appendAudit(ctx, 'approval.requested', 'approval', id, { actorRef: requesterRef }, 'OK', null, { risk: scope.risk, action: scope.action.slice(0, 64) });
  if (scope.workItemId !== null) {
    const item = getWorkItemRow(ctx, scope.workItemId);
    appendEvent(ctx, 'work_item.approval_requested', 'work_item', item.id, { correlationId: item.correlationId }, { approvalId: id, risk: scope.risk });
  }
  return getApproval(ctx, id);
}

/** Consumes an approved work_item.execute approval and releases the Work Item (C1 gate → READY). */
function releaseApprovedWorkItem(ctx: StoreContext, workItemId: Id, approvalId: Id, actorRef: string): void {
  const item = getWorkItemRow(ctx, workItemId);
  if (item.state !== 'WAITING_APPROVAL') throw new QandeelError('INVALID_TRANSITION', 'the work item no longer waits for approval', { workItemId, state: item.state });
  const a = getApproval(ctx, approvalId);
  ctx.db.run(`UPDATE approvals SET state = 'CONSUMED', uses = uses + 1, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, at(ctx), approvalId, a.version);
  approvalHistory(ctx, approvalId, a.version + 1, a.state, 'CONSUMED', 'work_item.released', actorRef);
  ctx.db.run('UPDATE work_items SET approval_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?', approvalId, at(ctx), item.id, item.version);
  const trace = { correlationId: item.correlationId, actorRef };
  const bound = getWorkItemRow(ctx, item.id);
  const released = applyTransition(ctx, bound, 'READY', { reasonCode: 'approval.granted', trace });
  appendEvent(ctx, 'work_item.approved', 'work_item', item.id, trace, { approvalId });
  appendAudit(ctx, 'work_item.approved', 'work_item', item.id, trace, 'OK', 'approval.granted', { approvalId });
  enqueueJob(ctx, released, trace);
}

function budgetHistory(ctx: StoreContext, budgetId: Id, kind: 'CREATED' | 'CAP_CHANGED', capMoney: number, capTokens: number, reasonCode: string, actorRef: string): void {
  ctx.db.run('INSERT INTO budget_history (budget_id, change_kind, cap_money, cap_tokens, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', budgetId, kind, capMoney, capTokens, reasonCode, actorRef, at(ctx));
  appendAudit(ctx, kind === 'CREATED' ? 'budget.created' : 'budget.cap_changed', 'budget', budgetId, { actorRef }, 'OK', reasonCode, { capMoney, capTokens });
}

/** The parent budget a new budget of `scope` must hang under (it must already exist). */
function parentBudgetFor(ctx: StoreContext, scope: BudgetScope, scopeId: Id): BudgetRecord {
  const parentScope = PARENT_SCOPE[scope];
  let parentScopeId: string;
  if (scope === 'DEPARTMENT') {
    if (!ctx.db.get('SELECT 1 AS ok FROM departments WHERE id = ?', scopeId)) throw new QandeelError('NOT_FOUND', 'department not found', { departmentId: scopeId });
    parentScopeId = 'company';
  } else if (scope === 'EMPLOYEE') {
    parentScopeId = getEmployeeRow(ctx, scopeId).departmentId;
  } else {
    const item = getWorkItemRow(ctx, scopeId);
    const owner = employeeIdFromRef(item.ownerRef);
    if (owner === null) throw new QandeelError('VALIDATION_FAILED', 'governed Work Item budgets belong to Work Items owned by an Employee', { workItemId: scopeId });
    parentScopeId = owner;
  }
  const parent = parentScope === null ? null : budgetFor(ctx, parentScope, parentScopeId);
  if (!parent) throw new QandeelError('BUDGET_MISSING', `the ${String(parentScope)} budget must exist first`, { scope, parentScope });
  return parent;
}

/** The actor a budget belongs to, for self-escalation detection (an Employee's own budgets). */
function budgetSubjectRef(ctx: StoreContext, b: BudgetRecord): string | null {
  if (b.scope === 'EMPLOYEE') return `employee:${b.scopeId}`;
  if (b.scope === 'WORK_ITEM') return getWorkItemRow(ctx, b.scopeId as Id).ownerRef;
  if (b.scope === 'RUN') {
    const a = ctx.db.get<{ employee_id: string }>('SELECT employee_id FROM run_attributions WHERE run_id = ?', b.scopeId);
    return a ? `employee:${a.employee_id}` : null;
  }
  return null;
}

/** Work Items whose chain includes budget `b` (targeted wake after a cap increase). */
function workItemsUnderBudget(ctx: StoreContext, b: BudgetRecord): Id[] {
  const leaves = ctx.db.all<{ scope_id: string }>(
    `WITH RECURSIVE sub(id, scope, scope_id) AS (SELECT id, scope, scope_id FROM budgets WHERE id = ?
       UNION ALL SELECT c.id, c.scope, c.scope_id FROM budgets c JOIN sub ON c.parent_id = sub.id)
     SELECT scope_id FROM sub WHERE scope = 'WORK_ITEM' LIMIT 1000`,
    b.id,
  );
  return leaves.map((r) => r.scope_id as Id);
}

/** Builds the routing inputs (policy + deployment views) for one task class. */
export function routingSnapshotTx(ctx: StoreContext, taskClass: string): { policy: RoutePolicy | null; deployments: DeploymentView[] } {
  const pr = ctx.db.get<{ id: string; task_class: string; version: number; policy_json: string }>(`SELECT * FROM route_policies WHERE task_class = ? AND status = 'ACTIVE'`, taskClass);
  const policy: RoutePolicy | null = pr ? { id: pr.id, taskClass: pr.task_class, version: Number(pr.version), ...assertRoutePolicyBody(JSON.parse(pr.policy_json)) } : null;
  const rows = ctx.db.all(
    `SELECT d.*, m.code AS model_code, p.id AS provider_id, p.code AS provider_code, p.status AS provider_status, p.locality AS locality
       FROM deployments d JOIN models m ON m.id = d.model_id JOIN model_providers p ON p.id = m.provider_id
      WHERE d.status <> 'RETIRED' ORDER BY d.id`,
  );
  const deployments: DeploymentView[] = rows.map((r) => {
    const d = mapDeployment(r);
    const card = d.priceCardId ? mapPriceCard(ctx.db.get('SELECT * FROM price_cards WHERE id = ?', d.priceCardId) ?? {}) : null;
    return {
      id: d.id,
      code: d.code,
      providerId: String(r.provider_id),
      providerCode: String(r.provider_code),
      providerStatus: String(r.provider_status) as DeploymentView['providerStatus'],
      modelCode: String(r.model_code),
      locality: String(r.locality) as Locality,
      status: d.status,
      qualification: d.qualification,
      reasoningClass: d.reasoningClass,
      taskClasses: d.taskClasses,
      egressMaxDataClass: d.egressMaxDataClass,
      circuitOpenUntil: d.circuitOpenUntil,
      contextWindowTokens: d.contextWindowTokens,
      maxOutputTokens: d.maxOutputTokens,
      priceCard: card,
    };
  });
  return { policy, deployments };
}

export { budgetChain, holdReservationTx };
