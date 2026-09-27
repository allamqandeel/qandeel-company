/** C2 governance record shapes and row mappers (storage-internal mapping; public shapes). */
import type { Id, RiskLevel, SideEffectClass, Timestamp } from '@qandeel-company/domain';
import type {
  ApprovalState,
  AttemptKind,
  BillingMode,
  BudgetScope,
  CognitiveProfile,
  DataClass,
  EmployeeState,
  Locality,
  OperationalStatus,
  PrincipalKind,
  QualificationState,
  ReasoningClass,
  ToolEgress,
} from '@qandeel-company/governance';

import type { Row, SqlValue } from './sqlite/connection.js';

const str = (v: SqlValue | undefined): string => String(v);
const optStr = (v: SqlValue | undefined): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: SqlValue | undefined): number => Number(v);
const optNum = (v: SqlValue | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const parse = (v: SqlValue | undefined): unknown => JSON.parse(String(v));

export interface PrincipalRecord {
  readonly id: Id;
  readonly ref: string;
  readonly kind: PrincipalKind;
  readonly employeeId: Id | null;
  readonly status: 'ACTIVE' | 'RETIRED';
}

export interface DepartmentRecord {
  readonly id: Id;
  readonly code: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'RETIRED';
}

export interface EmployeeRecord {
  readonly id: Id;
  readonly ref: string;
  readonly name: { readonly given: string; readonly family: string };
  readonly nameOrigin: 'EG';
  readonly profile: unknown;
  readonly cognitiveProfile: CognitiveProfile;
  readonly roleRef: string;
  readonly positionRef: string;
  readonly departmentId: Id;
  readonly managerRef: string;
  readonly state: EmployeeState;
  readonly qualificationRefs: readonly string[];
  readonly version: number;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface EmployeeHistoryRecord {
  readonly version: number;
  readonly changeKind: string;
  readonly fromState: string | null;
  readonly toState: string;
  readonly detail: Record<string, unknown>;
  readonly reasonCode: string;
  readonly actorRef: string;
  readonly occurredAt: Timestamp;
}

export interface RunAttributionRecord {
  readonly runId: Id;
  readonly workItemId: Id;
  readonly employeeId: Id;
  readonly departmentId: Id;
  readonly createdAt: Timestamp;
}

export interface ProviderRecord {
  readonly id: Id;
  readonly code: string;
  readonly locality: Locality;
  readonly status: OperationalStatus;
  readonly holdReason: string | null;
  readonly credentialRef: string | null;
}

export interface DeploymentRecord {
  readonly id: Id;
  readonly code: string;
  readonly modelId: Id;
  readonly pinnedRevision: string;
  readonly reasoningClass: ReasoningClass;
  readonly qualification: QualificationState;
  readonly taskClasses: readonly string[];
  readonly egressMaxDataClass: DataClass | null;
  readonly status: OperationalStatus;
  readonly holdReason: string | null;
  readonly circuitFailures: number;
  readonly circuitOpenUntil: Timestamp | null;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly priceCardId: Id | null;
}

export interface PriceCardRecord {
  readonly id: Id;
  readonly deploymentId: Id;
  readonly version: number;
  readonly currency: string;
  readonly billingMode: BillingMode;
  readonly billedInputPerMTok: number;
  readonly billedOutputPerMTok: number;
  readonly billedPerCall: number;
  readonly economicInputPerMTok: number;
  readonly economicOutputPerMTok: number;
  readonly economicPerCall: number;
}

export interface ToolRecord {
  readonly id: Id;
  readonly code: string;
  readonly driverCode: string;
  readonly egress: ToolEgress;
  readonly status: OperationalStatus;
  readonly holdReason: string | null;
  readonly credentialRef: string | null;
}

export interface ToolActionRecord {
  readonly id: Id;
  readonly toolId: Id;
  readonly code: string;
  readonly risk: RiskLevel;
  readonly sideEffects: SideEffectClass;
  readonly mutatesExternal: boolean;
  readonly requiresIdempotency: boolean;
  readonly dataClassCeiling: DataClass;
  readonly resultDataClass: DataClass;
  readonly argsSchema: unknown;
  readonly costPerCallMicros: number;
  readonly status: 'ACTIVE' | 'RETIRED';
}

export interface GrantRecord {
  readonly id: Id;
  readonly employeeId: Id;
  readonly capability: string;
  readonly resourceScope: string;
  readonly riskCeiling: RiskLevel;
  readonly dataClassCeiling: DataClass;
  readonly expiresAt: Timestamp | null;
  readonly maxUses: number | null;
  readonly uses: number;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly grantedByRef: string;
}

export interface ApprovalRecord {
  readonly id: Id;
  readonly subjectRef: string;
  readonly requestedByRef: string;
  readonly action: string;
  readonly resourceRef: string;
  readonly workItemId: Id | null;
  readonly risk: RiskLevel;
  readonly dataClass: DataClass;
  readonly argsSha256: string;
  readonly fingerprint: string;
  readonly state: ApprovalState;
  readonly maxUses: number;
  readonly uses: number;
  readonly expiresAt: Timestamp | null;
  readonly decidedByRef: string | null;
  readonly decidedAt: Timestamp | null;
  readonly reasonCode: string | null;
  readonly rerequestOf: Id | null;
  readonly version: number;
  readonly createdAt: Timestamp;
}

export interface BudgetRecord {
  readonly id: Id;
  readonly scope: BudgetScope;
  readonly scopeId: string;
  readonly parentId: Id | null;
  readonly currency: string;
  readonly capMoney: number;
  readonly capTokens: number;
  readonly reservedMoney: number;
  readonly reservedTokens: number;
  readonly spentMoney: number;
  readonly spentTokens: number;
  readonly overrunMoney: number;
  readonly overrunTokens: number;
  readonly runCapMoney: number | null;
  readonly runCapTokens: number | null;
  readonly version: number;
}

export interface ReservationRecord {
  readonly id: Id;
  readonly budgetId: Id;
  readonly runId: Id;
  readonly jobId: Id;
  readonly fencingToken: number;
  readonly workItemId: Id;
  readonly employeeId: Id;
  readonly departmentId: Id;
  readonly purpose: 'MODEL_CALL' | 'TOOL_CALL';
  readonly attemptKind: AttemptKind;
  readonly deploymentId: Id | null;
  readonly priceCardId: Id | null;
  readonly toolActionId: Id | null;
  readonly routePolicyId: Id | null;
  readonly money: number;
  readonly tokens: number;
  readonly state: 'RESERVED' | 'SETTLED' | 'RELEASED' | 'RECONCILIATION_REQUIRED';
  readonly reasonCode: string | null;
  /** C3: the OK context manifest a model-call reservation is bound to (null for tool calls). */
  readonly contextManifestId: Id | null;
}

export interface UsageRecord {
  readonly id: Id;
  readonly reservationId: Id;
  readonly runId: Id;
  readonly workItemId: Id;
  readonly employeeId: Id;
  readonly departmentId: Id;
  readonly purpose: 'MODEL_CALL' | 'TOOL_CALL';
  readonly attemptKind: AttemptKind;
  readonly providerId: Id | null;
  readonly modelId: Id | null;
  readonly deploymentId: Id | null;
  readonly priceCardId: Id | null;
  readonly priceCardVersion: number | null;
  readonly toolActionId: Id | null;
  readonly sessionId: Id | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly chargedTokens: number;
  readonly billedMicros: number;
  readonly economicMicros: number;
  readonly withinBounds: boolean;
  readonly outcome: 'OK' | 'FAILED_CHARGED' | 'RECONCILED';
}

export interface ToolInvocationRecord {
  readonly id: Id;
  readonly toolActionId: Id;
  readonly idempotencyKey: string;
  readonly argsSha256: string;
  readonly workItemId: Id;
  readonly employeeId: Id;
  readonly runId: Id;
  readonly grantId: Id;
  readonly approvalId: Id | null;
  readonly reservationId: Id | null;
  readonly state: 'INTENT_RECORDED' | 'SUCCEEDED' | 'FAILED' | 'RETRYABLE' | 'RECONCILIATION_REQUIRED';
  readonly attempts: number;
  readonly failureCode: string | null;
  readonly result: unknown;
  readonly resultSha256: string | null;
}

export const mapPrincipal = (r: Row): PrincipalRecord => ({ id: str(r.id) as Id, ref: str(r.ref), kind: str(r.kind) as PrincipalKind, employeeId: optStr(r.employee_id) as Id | null, status: str(r.status) as PrincipalRecord['status'] });

export const mapDepartment = (r: Row): DepartmentRecord => ({ id: str(r.id) as Id, code: str(r.code), name: str(r.name), status: str(r.status) as DepartmentRecord['status'] });

export const mapEmployee = (r: Row): EmployeeRecord => ({
  id: str(r.id) as Id,
  ref: `employee:${str(r.id)}`,
  name: { given: str(r.given_name), family: str(r.family_name) },
  nameOrigin: 'EG',
  profile: parse(r.profile_json),
  cognitiveProfile: parse(r.cognitive_profile_json) as CognitiveProfile,
  roleRef: str(r.role_ref),
  positionRef: str(r.position_ref),
  departmentId: str(r.department_id) as Id,
  managerRef: str(r.manager_ref),
  state: str(r.state) as EmployeeState,
  qualificationRefs: parse(r.qualification_refs_json) as string[],
  version: num(r.version),
  createdAt: str(r.created_at) as Timestamp,
  updatedAt: str(r.updated_at) as Timestamp,
});

export const mapEmployeeHistory = (r: Row): EmployeeHistoryRecord => ({
  version: num(r.version),
  changeKind: str(r.change_kind),
  fromState: optStr(r.from_state),
  toState: str(r.to_state),
  detail: parse(r.detail_json) as Record<string, unknown>,
  reasonCode: str(r.reason_code),
  actorRef: str(r.actor_ref),
  occurredAt: str(r.occurred_at) as Timestamp,
});

export const mapRunAttribution = (r: Row): RunAttributionRecord => ({ runId: str(r.run_id) as Id, workItemId: str(r.work_item_id) as Id, employeeId: str(r.employee_id) as Id, departmentId: str(r.department_id) as Id, createdAt: str(r.created_at) as Timestamp });

export const mapProvider = (r: Row): ProviderRecord => ({ id: str(r.id) as Id, code: str(r.code), locality: str(r.locality) as Locality, status: str(r.status) as OperationalStatus, holdReason: optStr(r.hold_reason), credentialRef: optStr(r.credential_ref) });

export const mapDeployment = (r: Row): DeploymentRecord => ({
  id: str(r.id) as Id,
  code: str(r.code),
  modelId: str(r.model_id) as Id,
  pinnedRevision: str(r.pinned_revision),
  reasoningClass: str(r.reasoning_class) as ReasoningClass,
  qualification: str(r.qualification) as QualificationState,
  taskClasses: parse(r.task_classes_json) as string[],
  egressMaxDataClass: optStr(r.egress_max_data_class) as DataClass | null,
  status: str(r.status) as OperationalStatus,
  holdReason: optStr(r.hold_reason),
  circuitFailures: num(r.circuit_failures),
  circuitOpenUntil: optStr(r.circuit_open_until) as Timestamp | null,
  contextWindowTokens: num(r.context_window_tokens),
  maxOutputTokens: num(r.max_output_tokens),
  priceCardId: optStr(r.price_card_id) as Id | null,
});

export const mapPriceCard = (r: Row): PriceCardRecord => ({
  id: str(r.id) as Id,
  deploymentId: str(r.deployment_id) as Id,
  version: num(r.version),
  currency: str(r.currency),
  billingMode: str(r.billing_mode) as BillingMode,
  billedInputPerMTok: num(r.billed_input_per_mtok),
  billedOutputPerMTok: num(r.billed_output_per_mtok),
  billedPerCall: num(r.billed_per_call),
  economicInputPerMTok: num(r.economic_input_per_mtok),
  economicOutputPerMTok: num(r.economic_output_per_mtok),
  economicPerCall: num(r.economic_per_call),
});

export const mapTool = (r: Row): ToolRecord => ({ id: str(r.id) as Id, code: str(r.code), driverCode: str(r.driver_code), egress: str(r.egress) as ToolEgress, status: str(r.status) as OperationalStatus, holdReason: optStr(r.hold_reason), credentialRef: optStr(r.credential_ref) });

export const mapToolAction = (r: Row): ToolActionRecord => ({
  id: str(r.id) as Id,
  toolId: str(r.tool_id) as Id,
  code: str(r.code),
  risk: str(r.risk_level) as RiskLevel,
  sideEffects: str(r.side_effects) as SideEffectClass,
  mutatesExternal: num(r.mutates_external) === 1,
  requiresIdempotency: num(r.requires_idempotency) === 1,
  dataClassCeiling: str(r.data_class_ceiling) as DataClass,
  resultDataClass: str(r.result_data_class) as DataClass,
  argsSchema: parse(r.args_schema_json),
  costPerCallMicros: num(r.cost_per_call_micros),
  status: str(r.status) as ToolActionRecord['status'],
});

export const mapGrant = (r: Row): GrantRecord => ({
  id: str(r.id) as Id,
  employeeId: str(r.employee_id) as Id,
  capability: str(r.capability),
  resourceScope: str(r.resource_scope),
  riskCeiling: str(r.risk_ceiling) as RiskLevel,
  dataClassCeiling: str(r.data_class_ceiling) as DataClass,
  expiresAt: optStr(r.expires_at) as Timestamp | null,
  maxUses: optNum(r.max_uses),
  uses: num(r.uses),
  status: str(r.status) as GrantRecord['status'],
  grantedByRef: str(r.granted_by_ref),
});

export const mapApproval = (r: Row): ApprovalRecord => ({
  id: str(r.id) as Id,
  subjectRef: str(r.subject_ref),
  requestedByRef: str(r.requested_by_ref),
  action: str(r.action),
  resourceRef: str(r.resource_ref),
  workItemId: optStr(r.work_item_id) as Id | null,
  risk: str(r.risk_level) as RiskLevel,
  dataClass: str(r.data_class) as DataClass,
  argsSha256: str(r.args_sha256),
  fingerprint: str(r.fingerprint),
  state: str(r.state) as ApprovalState,
  maxUses: num(r.max_uses),
  uses: num(r.uses),
  expiresAt: optStr(r.expires_at) as Timestamp | null,
  decidedByRef: optStr(r.decided_by_ref),
  decidedAt: optStr(r.decided_at) as Timestamp | null,
  reasonCode: optStr(r.reason_code),
  rerequestOf: optStr(r.rerequest_of) as Id | null,
  version: num(r.version),
  createdAt: str(r.created_at) as Timestamp,
});

export const mapBudget = (r: Row): BudgetRecord => ({
  id: str(r.id) as Id,
  scope: str(r.scope) as BudgetScope,
  scopeId: str(r.scope_id),
  parentId: optStr(r.parent_id) as Id | null,
  currency: str(r.currency),
  capMoney: num(r.cap_money),
  capTokens: num(r.cap_tokens),
  reservedMoney: num(r.reserved_money),
  reservedTokens: num(r.reserved_tokens),
  spentMoney: num(r.spent_money),
  spentTokens: num(r.spent_tokens),
  overrunMoney: num(r.overrun_money),
  overrunTokens: num(r.overrun_tokens),
  runCapMoney: optNum(r.run_cap_money),
  runCapTokens: optNum(r.run_cap_tokens),
  version: num(r.version),
});

export const mapReservation = (r: Row): ReservationRecord => ({
  id: str(r.id) as Id,
  budgetId: str(r.budget_id) as Id,
  runId: str(r.run_id) as Id,
  jobId: str(r.job_id) as Id,
  fencingToken: num(r.fencing_token),
  workItemId: str(r.work_item_id) as Id,
  employeeId: str(r.employee_id) as Id,
  departmentId: str(r.department_id) as Id,
  purpose: str(r.purpose) as ReservationRecord['purpose'],
  attemptKind: str(r.attempt_kind) as AttemptKind,
  deploymentId: optStr(r.deployment_id) as Id | null,
  priceCardId: optStr(r.price_card_id) as Id | null,
  toolActionId: optStr(r.tool_action_id) as Id | null,
  routePolicyId: optStr(r.route_policy_id) as Id | null,
  money: num(r.money),
  tokens: num(r.tokens),
  state: str(r.state) as ReservationRecord['state'],
  reasonCode: optStr(r.reason_code),
  contextManifestId: optStr(r.context_manifest_id) as Id | null,
});

export const mapUsage = (r: Row): UsageRecord => ({
  id: str(r.id) as Id,
  reservationId: str(r.reservation_id) as Id,
  runId: str(r.run_id) as Id,
  workItemId: str(r.work_item_id) as Id,
  employeeId: str(r.employee_id) as Id,
  departmentId: str(r.department_id) as Id,
  purpose: str(r.purpose) as UsageRecord['purpose'],
  attemptKind: str(r.attempt_kind) as AttemptKind,
  providerId: optStr(r.provider_id) as Id | null,
  modelId: optStr(r.model_id) as Id | null,
  deploymentId: optStr(r.deployment_id) as Id | null,
  priceCardId: optStr(r.price_card_id) as Id | null,
  priceCardVersion: optNum(r.price_card_version),
  toolActionId: optStr(r.tool_action_id) as Id | null,
  sessionId: optStr(r.session_id) as Id | null,
  inputTokens: num(r.input_tokens),
  outputTokens: num(r.output_tokens),
  chargedTokens: num(r.charged_tokens),
  billedMicros: num(r.billed_micros),
  economicMicros: num(r.economic_micros),
  withinBounds: num(r.within_bounds) === 1,
  outcome: str(r.outcome) as UsageRecord['outcome'],
});

export const mapToolInvocation = (r: Row): ToolInvocationRecord => ({
  id: str(r.id) as Id,
  toolActionId: str(r.tool_action_id) as Id,
  idempotencyKey: str(r.idempotency_key),
  argsSha256: str(r.args_sha256),
  workItemId: str(r.work_item_id) as Id,
  employeeId: str(r.employee_id) as Id,
  runId: str(r.run_id) as Id,
  grantId: str(r.grant_id) as Id,
  approvalId: optStr(r.approval_id) as Id | null,
  reservationId: optStr(r.reservation_id) as Id | null,
  state: str(r.state) as ToolInvocationRecord['state'],
  attempts: num(r.attempts),
  failureCode: optStr(r.failure_code),
  result: r.result_json === null || r.result_json === undefined ? null : parse(r.result_json),
  resultSha256: optStr(r.result_sha256),
});
