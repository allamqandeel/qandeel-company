/**
 * D-L1-44 (D-L1-36) — Employee Reasoning Control: the Founder's control of how deeply an Employee reasons.
 *
 * Two Founder acts, both structured-only and confirmed through the governed preview → fingerprint → confirm boundary:
 *
 * - The persistent PROFILE: the Employee's standing default and ceiling reasoning class, kept where they always were
 *   (`employees.cognitive_profile_json`), version-safe, with Employee history (PROFILE) and a content-free audit row.
 *   A reasoning profile is a material change (Stage 6 §14): the Employee's VALID certifications become REVIEW_DUE
 *   through the canonical `markReviewDue`, never silently left VALID.
 * - The one-task OVERRIDE: the reasoning class of exactly one Employee Work Item that has never run, durable in
 *   `work_item_reasoning_overrides` (0020). It never touches the persistent profile, and it never exceeds the
 *   Employee's ceiling: raising the ceiling is the profile act, first.
 *
 * Reasoning is not authority: nothing here changes grants, tools, risk, approvals, data class, egress or budget. The
 * runtime still routes under the Employee ceiling and the route policy, reserves the class's worst case before any
 * provider call, and records the class that actually answered on the usage record.
 */
import { QandeelError, canonicalJson, type Id } from '@qandeel-company/domain';
import { assertCognitiveProfile, effectiveClass, isReasoningClass, isReasoningSelection, reasoningRank, reasoningSelectionOf, type ReasoningClass, type ReasoningSelection } from '@qandeel-company/governance';

import { employeeIdFromRef, getEmployeeRow, writeEmployeeHistory } from './governance-core.js';
import type { EmployeeRecord } from './governance-records.js';
import { routingSnapshotTx } from './governance.js';
import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { markReviewDue } from './skill-registry.js';

const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'];

const refuse = (reason: string, message: string, details: Record<string, string | number | boolean | null> = {}): never => {
  throw new QandeelError('VALIDATION_FAILED', message, { reason, ...details });
};
const transition = (reason: string, message: string, details: Record<string, string | number | boolean | null> = {}): never => {
  throw new QandeelError('INVALID_TRANSITION', message, { reason, ...details });
};

/** A Founder-set reasoning level: E1..E4 (E0 is deterministic NO_LLM execution, not a level of model reasoning). */
function founderClass(v: unknown, field: string): ReasoningClass {
  if (!isReasoningClass(v) || v === 'E0') refuse('REASONING_CLASS', 'a reasoning level is E1, E2, E3 or E4', { field });
  return v as ReasoningClass;
}

const above = (a: ReasoningClass, b: ReasoningClass): boolean => reasoningRank(a) > reasoningRank(b);

/** The Founder's one-task reasoning class of this Work Item, or null. Read by the run's begin from durable state only. */
export function txReasoningOverride(ctx: StoreContext, workItemId: Id): ReasoningClass | null {
  const r = ctx.db.get<{ c: string }>('SELECT reasoning_class AS c FROM work_item_reasoning_overrides WHERE work_item_id = ?', workItemId);
  return r && isReasoningClass(r.c) ? r.c : null;
}

export interface ReasoningProfilePlan {
  readonly employee: EmployeeRecord;
  readonly previousDefault: ReasoningClass;
  readonly previousCeiling: ReasoningClass;
  readonly newDefault: ReasoningClass;
  readonly newCeiling: ReasoningClass;
  /** P1-REASON-AUTO-RECOVERY-01: how the starting class is chosen (AUTO / DEFAULT), before and after. */
  readonly previousSelection: ReasoningSelection;
  readonly newSelection: ReasoningSelection;
  readonly costDiscipline: string;
  /** The Employee's VALID certifications this material change marks REVIEW_DUE (Stage 6 §14). */
  readonly certificationsReviewDue: readonly Id[];
}

/** Validates a persistent profile change against durable state (the preview and the confirm run the same check). */
export function txPlanReasoningProfile(ctx: StoreContext, input: { employeeId: Id; defaultClass?: unknown; ceilingClass?: unknown; costDiscipline?: unknown; selection?: unknown }): ReasoningProfilePlan {
  const e = getEmployeeRow(ctx, input.employeeId);
  if (e.state === 'RETIRED') transition('RETIRED', 'a retired Employee has no reasoning profile to change');
  const current = assertCognitiveProfile(e.cognitiveProfile);
  const newDefault = input.defaultClass === undefined || input.defaultClass === null ? current.defaultClass : founderClass(input.defaultClass, 'defaultClass');
  const newCeiling = input.ceilingClass === undefined || input.ceilingClass === null ? current.ceilingClass : founderClass(input.ceilingClass, 'ceilingClass');
  if (above(newDefault, newCeiling)) refuse('CEILING_BELOW_DEFAULT', 'the ceiling is at or above the default', { field: 'ceilingClass', defaultClass: newDefault, ceilingClass: newCeiling });
  // Cost discipline is not a reasoning control: it is kept exactly as it is.
  if (input.costDiscipline !== undefined && input.costDiscipline !== null && input.costDiscipline !== current.costDiscipline) refuse('COST_DISCIPLINE_UNCHANGED', 'cost discipline is not changed by a reasoning control', { field: 'costDiscipline' });
  // AUTO / DEFAULT is part of the reasoning profile: turning it on or off is the same governed, material profile act (it
  // changes how every future starting class is chosen), so it takes the canonical REVIEW_DUE path below — no exemption.
  const previousSelection = reasoningSelectionOf(current);
  if (input.selection !== undefined && input.selection !== null && !isReasoningSelection(input.selection)) refuse('REASONING_SELECTION', 'the selection is AUTO or DEFAULT', { field: 'selection' });
  const newSelection = input.selection === undefined || input.selection === null ? previousSelection : (input.selection as ReasoningSelection);
  if (newDefault === current.defaultClass && newCeiling === current.ceilingClass && newSelection === previousSelection) transition('PROFILE_UNCHANGED', 'the reasoning profile already is this');
  const certificationsReviewDue = ctx.db.all<{ id: string }>(`SELECT id FROM certifications WHERE employee_id = ? AND status = 'VALID' ORDER BY id`, e.id).map((r) => r.id as Id);
  return { employee: e, previousDefault: current.defaultClass, previousCeiling: current.ceilingClass, newDefault, newCeiling, previousSelection, newSelection, costDiscipline: current.costDiscipline, certificationsReviewDue };
}

/**
 * Writes a persistent profile change (inside a Founder-authority write): version-safe against the version the Founder
 * previewed, Employee history PROFILE, the material-change REVIEW_DUE of each VALID certification and the audit row.
 */
export function txChangeReasoningProfile(ctx: StoreContext, actorRef: string, input: { employeeId: Id; defaultClass: ReasoningClass; ceilingClass: ReasoningClass; selection?: ReasoningSelection; expectedVersion: number; reasonCode: string }): EmployeeRecord {
  const plan = txPlanReasoningProfile(ctx, { employeeId: input.employeeId, defaultClass: input.defaultClass, ceilingClass: input.ceilingClass, ...(input.selection !== undefined ? { selection: input.selection } : {}) });
  const e = plan.employee;
  if (e.version !== input.expectedVersion) throw new QandeelError('VERSION_CONFLICT', 'the Employee changed since the preview', { employeeId: e.id, expected: input.expectedVersion, actual: e.version });
  // A profile that never carried a selection keeps that exact stored form while it stays DEFAULT.
  const keepsForm = plan.newSelection === 'DEFAULT' && assertCognitiveProfile(e.cognitiveProfile).selection === undefined;
  const profile = { defaultClass: plan.newDefault, ceilingClass: plan.newCeiling, costDiscipline: plan.costDiscipline, ...(keepsForm ? {} : { selection: plan.newSelection }) };
  const changed = ctx.db.run(`UPDATE employees SET cognitive_profile_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, canonicalJson(assertCognitiveProfile(profile)), ts(ctx), e.id, e.version).changes;
  if (changed !== 1) throw new QandeelError('VERSION_CONFLICT', 'the Employee changed concurrently', { employeeId: e.id });
  const next = getEmployeeRow(ctx, e.id);
  let reviewDue = 0;
  for (const id of plan.certificationsReviewDue) if (markReviewDue(ctx, id, 'REASONING_PROFILE_CHANGED', actorRef)) reviewDue++;
  // The selection appears in the history line only when it changes (a class-only change keeps the D-L1-44 form).
  const mode = (sel: string): string => (plan.previousSelection === plan.newSelection ? '' : `/${sel}`);
  const from = `${plan.previousDefault}/${plan.previousCeiling}${mode(plan.previousSelection)}`;
  const to = `${plan.newDefault}/${plan.newCeiling}${mode(plan.newSelection)}`;
  writeEmployeeHistory(ctx, next, 'PROFILE', from, to, input.reasonCode, actorRef, { previousDefault: plan.previousDefault, newDefault: plan.newDefault, previousCeiling: plan.previousCeiling, newCeiling: plan.newCeiling, previousSelection: plan.previousSelection, newSelection: plan.newSelection, costDiscipline: plan.costDiscipline, certificationsReviewDue: reviewDue });
  appendAudit(ctx, 'employee.reasoning_profile_changed', 'employee', e.id, { actorRef }, 'OK', input.reasonCode, { from, to, certificationsReviewDue: reviewDue });
  return next;
}

export interface ReasoningOverridePlan {
  readonly workItemId: Id;
  readonly workItemState: string;
  readonly taskClass: string;
  readonly employee: EmployeeRecord;
  readonly standingDefault: ReasoningClass;
  readonly standingCeiling: ReasoningClass;
  readonly requestedClass: ReasoningClass;
  /** The class the router will request: the override lifted to the route policy minimum (never above the ceiling). */
  readonly effectiveClass: ReasoningClass;
  readonly routePolicyMaxClass: ReasoningClass;
  /** Informational: whether a deployment of that class is provisioned for the task class now (routing re-checks). */
  readonly deploymentAvailable: boolean;
}

/** Validates a one-task override against durable state (the preview and the confirm run the same check). */
export function txPlanReasoningOverride(ctx: StoreContext, input: { workItemId: Id; reasoningClass: unknown }): ReasoningOverridePlan {
  const item = getWorkItemRow(ctx, input.workItemId);
  const employeeId = employeeIdFromRef(item.ownerRef);
  if (employeeId === null) refuse('NOT_EMPLOYEE_WORK', 'a reasoning override applies to an Employee Work Item');
  if (TERMINAL.includes(item.state)) transition('WORK_ITEM_DONE', 'this Work Item has finished', { state: item.state });
  // Visible before execution: once any run of it began, the class it started from is history.
  if (ctx.db.get('SELECT 1 AS x FROM runs WHERE work_item_id = ? LIMIT 1', item.id)) transition('WORK_ITEM_STARTED', 'a reasoning override is set before the Work Item first runs');
  if (txReasoningOverride(ctx, item.id) !== null) transition('OVERRIDE_EXISTS', 'this Work Item already carries a Founder reasoning override (one per Work Item)');
  const pi = (item.processorInput ?? {}) as { taskClass?: unknown; reasoningClass?: unknown };
  if (typeof pi.taskClass !== 'string') refuse('NOT_MODEL_WORK', 'this Work Item makes no governed model call');
  // A class pinned in the submitter's immutable input is a method pin (e.g. a BQM-2 benchmark observation), not a choice.
  if (pi.reasoningClass !== undefined) transition('CLASS_PINNED_BY_WORK_ITEM', 'this Work Item pins its reasoning class in its own input');
  const e = getEmployeeRow(ctx, employeeId as Id);
  if (e.state === 'RETIRED') transition('RETIRED', 'a retired Employee runs nothing');
  const profile = assertCognitiveProfile(e.cognitiveProfile);
  const requestedClass = founderClass(input.reasoningClass, 'reasoningClass');
  // Never a hidden ceiling raise: the override stays within the Employee's ceiling (raise the ceiling first, explicitly).
  if (above(requestedClass, profile.ceilingClass)) refuse('ABOVE_EMPLOYEE_CEILING', 'the class is above the Employee ceiling: change the persistent ceiling first', { field: 'reasoningClass', ceilingClass: profile.ceilingClass });
  const snap = routingSnapshotTx(ctx, String(pi.taskClass));
  if (!snap.policy) return transition('NO_ROUTE_POLICY', 'the Work Item task class has no route policy', { taskClass: String(pi.taskClass) });
  const eff = effectiveClass({ reasoningClass: requestedClass }, snap.policy);
  if (above(eff, snap.policy.maxClass)) refuse('ABOVE_ROUTE_POLICY', 'the class is above the route policy maximum for this task class', { field: 'reasoningClass', maxClass: snap.policy.maxClass });
  if (above(eff, profile.ceilingClass)) refuse('ABOVE_EMPLOYEE_CEILING', 'the route policy minimum lifts the class above the Employee ceiling', { field: 'reasoningClass' });
  const deploymentAvailable = snap.deployments.some((d) => d.reasoningClass === eff && d.status === 'ACTIVE' && d.providerStatus === 'ACTIVE');
  return { workItemId: item.id, workItemState: item.state, taskClass: String(pi.taskClass), employee: e, standingDefault: profile.defaultClass, standingCeiling: profile.ceilingClass, requestedClass, effectiveClass: eff, routePolicyMaxClass: snap.policy.maxClass, deploymentAvailable };
}

/** Records a one-task override (inside a Founder-authority write): one durable row and its audit; the profile is untouched. */
export function txSetReasoningOverride(ctx: StoreContext, actorRef: string, input: { workItemId: Id; reasoningClass: ReasoningClass; reasonCode: string }): ReasoningOverridePlan {
  const plan = txPlanReasoningOverride(ctx, input);
  ctx.db.run(
    'INSERT INTO work_item_reasoning_overrides (work_item_id, employee_id, reasoning_class, standing_default, standing_ceiling, set_by_ref, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    plan.workItemId, plan.employee.id, plan.requestedClass, plan.standingDefault, plan.standingCeiling, actorRef, input.reasonCode, ts(ctx),
  );
  appendAudit(ctx, 'work_item.reasoning_override_set', 'work_item', plan.workItemId, { actorRef }, 'OK', input.reasonCode, { employeeId: plan.employee.id, reasoningClass: plan.requestedClass, standingDefault: plan.standingDefault, standingCeiling: plan.standingCeiling });
  return plan;
}

export interface ReasoningControlView {
  readonly employeeId: Id;
  readonly defaultClass: ReasoningClass;
  readonly ceilingClass: ReasoningClass;
  readonly selection: ReasoningSelection;
  readonly costDiscipline: string;
  /** Founder one-task overrides on this Employee's Work Items (newest first, bounded). */
  readonly overrides: readonly { readonly workItemId: Id; readonly reasoningClass: ReasoningClass; readonly workItemState: string; readonly setByRef: string; readonly createdAt: string }[];
  /** The class that actually answered completed model calls, per Work Item (usage evidence; newest first, bounded). */
  readonly modelCalls: readonly { readonly workItemId: Id; readonly reasoningClass: string; readonly calls: number }[];
}

/** Read-only: the Employee's reasoning control and the evidence of the classes actually used (IDs, codes, counts). */
export function txReasoningControlView(ctx: StoreContext, employeeId: Id): ReasoningControlView {
  const e = getEmployeeRow(ctx, employeeId);
  const p = assertCognitiveProfile(e.cognitiveProfile);
  const overrides = ctx.db
    .all<{ work_item_id: string; reasoning_class: string; state: string; set_by_ref: string; created_at: string }>(
      'SELECT o.work_item_id, o.reasoning_class, w.state, o.set_by_ref, o.created_at FROM work_item_reasoning_overrides o JOIN work_items w ON w.id = o.work_item_id WHERE o.employee_id = ? ORDER BY o.created_at DESC, o.work_item_id LIMIT 50',
      e.id,
    )
    .map((r) => ({ workItemId: r.work_item_id as Id, reasoningClass: r.reasoning_class as ReasoningClass, workItemState: r.state, setByRef: r.set_by_ref, createdAt: r.created_at }));
  const modelCalls = ctx.db
    .all<{ work_item_id: string; c: string; n: number; last: string }>(
      `SELECT u.work_item_id, d.reasoning_class AS c, COUNT(*) AS n, MAX(u.created_at) AS last FROM usage_records u JOIN deployments d ON d.id = u.deployment_id
        WHERE u.employee_id = ? GROUP BY u.work_item_id, d.reasoning_class ORDER BY last DESC, u.work_item_id LIMIT 50`,
      e.id,
    )
    .map((r) => ({ workItemId: r.work_item_id as Id, reasoningClass: r.c, calls: Number(r.n) }));
  return { employeeId: e.id, defaultClass: p.defaultClass, ceilingClass: p.ceilingClass, selection: reasoningSelectionOf(p), costDiscipline: p.costDiscipline, overrides, modelCalls };
}

/** P1-CHAT-INTEL-01: why one reasoning level can or cannot answer the Employee's conversation now (codes only). */
export type LevelAvailability = 'AVAILABLE' | 'ABOVE_EMPLOYEE_CEILING' | 'ABOVE_ROUTE_POLICY' | 'NOT_PROVISIONED' | 'NO_ROUTE_POLICY';

export interface EmployeeIntelligenceView {
  readonly employeeId: Id;
  readonly employeeState: string;
  readonly taskClass: string;
  /** The model identity of the deployments serving the task class (one model only — mixing models is not offered). */
  readonly model: { readonly providerCode: string; readonly modelCode: string; readonly publicName: string | null } | null;
  readonly defaultClass: ReasoningClass;
  readonly ceilingClass: ReasoningClass;
  /** AUTO (the governed Reasoning Demand picks the starting class) or DEFAULT (the standing default). */
  readonly selection: ReasoningSelection;
  readonly routeMinClass: ReasoningClass | null;
  readonly routeMaxClass: ReasoningClass | null;
  readonly levels: readonly { readonly reasoningClass: ReasoningClass; readonly availability: LevelAvailability; readonly deploymentProvisioned: boolean }[];
  /** Actual usage of this Employee's model calls by the class that answered (every task class), economic and billed money. */
  readonly usage: readonly { readonly reasoningClass: string; readonly calls: number; readonly inputTokens: number; readonly outputTokens: number; readonly economicMicros: number; readonly billedMicros: number }[];
  readonly envelope: { readonly currency: string; readonly capMoney: number; readonly reservedMoney: number; readonly spentMoney: number } | null;
}

const FOUNDER_LEVELS: readonly ReasoningClass[] = ['E1', 'E2', 'E3', 'E4'];

/**
 * Read-only: the Employee's intelligence for one task class (default: the conversation reply) — the standing profile, what
 * each level E1..E4 would meet (the Employee ceiling, the route policy, a qualified ACTIVE deployment) and the actual usage
 * and money. IDs, codes and numbers only. It changes nothing; every change is a governed preview.
 */
export function txEmployeeIntelligence(ctx: StoreContext, employeeId: Id, taskClass: string): EmployeeIntelligenceView {
  const e = getEmployeeRow(ctx, employeeId);
  const p = assertCognitiveProfile(e.cognitiveProfile);
  const snap = routingSnapshotTx(ctx, taskClass);
  const policy = snap.policy;
  const qualified = (q: string): boolean => q === 'QUALIFIED' || (q === 'LIMITED_PRODUCTION' && policy?.allowLimitedProduction === true);
  const serving = snap.deployments.filter((d) => d.taskClasses.includes(taskClass) && d.status === 'ACTIVE' && d.providerStatus === 'ACTIVE' && qualified(d.qualification));
  const first = serving[0] ?? snap.deployments.find((d) => d.taskClasses.includes(taskClass)) ?? null;
  const publicName = first ? (ctx.db.get<{ n: string }>(`SELECT expected_name AS n FROM model_identity_checks WHERE provider_code = ? AND model_code = ? AND result = 'MATCH' ORDER BY checked_at DESC, rowid DESC LIMIT 1`, first.providerCode, first.modelCode)?.n ?? null) : null;
  const levels = FOUNDER_LEVELS.map((c) => {
    const provisioned = serving.some((d) => d.reasoningClass === c);
    const availability: LevelAvailability = !policy ? 'NO_ROUTE_POLICY' : above(c, p.ceilingClass) ? 'ABOVE_EMPLOYEE_CEILING' : above(c, policy.maxClass) ? 'ABOVE_ROUTE_POLICY' : !provisioned ? 'NOT_PROVISIONED' : 'AVAILABLE';
    return { reasoningClass: c, availability, deploymentProvisioned: provisioned };
  });
  const usage = ctx.db
    .all<{ c: string; n: number; i: number; o: number; eco: number; billed: number }>(
      `SELECT d.reasoning_class AS c, COUNT(*) AS n, COALESCE(SUM(u.input_tokens), 0) AS i, COALESCE(SUM(u.output_tokens), 0) AS o, COALESCE(SUM(u.economic_micros), 0) AS eco, COALESCE(SUM(u.billed_micros), 0) AS billed
         FROM usage_records u JOIN deployments d ON d.id = u.deployment_id WHERE u.employee_id = ? GROUP BY d.reasoning_class ORDER BY d.reasoning_class`,
      e.id,
    )
    .map((r) => ({ reasoningClass: r.c, calls: Number(r.n), inputTokens: Number(r.i), outputTokens: Number(r.o), economicMicros: Number(r.eco), billedMicros: Number(r.billed) }));
  const env = ctx.db.get<{ currency: string; cap_money: number; reserved_money: number; spent_money: number }>(`SELECT currency, cap_money, reserved_money, spent_money FROM budgets WHERE scope = 'EMPLOYEE' AND scope_id = ? AND status = 'OPEN'`, e.id);
  return {
    employeeId: e.id, employeeState: e.state, taskClass,
    model: first ? { providerCode: first.providerCode, modelCode: first.modelCode, publicName } : null,
    defaultClass: p.defaultClass, ceilingClass: p.ceilingClass, selection: reasoningSelectionOf(p), routeMinClass: policy?.minClass ?? null, routeMaxClass: policy?.maxClass ?? null,
    levels, usage,
    envelope: env ? { currency: env.currency, capMoney: Number(env.cap_money), reservedMoney: Number(env.reserved_money), spentMoney: Number(env.spent_money) } : null,
  };
}
