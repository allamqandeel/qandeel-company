/**
 * C4 organization / delegation / review record shapes and row mappers (storage-internal mapping; public
 * shapes). Records carry IDs, codes, states and times. Business evidence (staffing justification, review
 * rationale, reviewer instructions) is exposed only as a content hash here; it never enters telemetry.
 */
import type { Id, Timestamp } from '@qandeel-company/domain';
import type { DataClass, OperationalJudgment, PositionKind, PositionScope, PositionStatus, ReviewApplies, ReviewKeyKind, ReviewOutcome, ReviewerLevel, StaffingState } from '@qandeel-company/governance';

import type { Row, SqlValue } from './sqlite/connection.js';

const str = (v: SqlValue | undefined): string => String(v);
const optStr = (v: SqlValue | undefined): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: SqlValue | undefined): number => Number(v);
const optNum = (v: SqlValue | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const arr = (v: SqlValue | undefined): string[] => JSON.parse(String(v)) as string[];

export interface PositionRecord {
  readonly id: Id;
  readonly code: string;
  readonly title: string;
  readonly scope: PositionScope;
  readonly departmentId: Id | null;
  readonly kind: PositionKind;
  readonly roleRef: string;
  readonly reportsToPositionId: Id | null;
  readonly reportsToFounder: boolean;
  readonly accountability: readonly string[];
  readonly status: PositionStatus;
  readonly source: 'CANONICAL_MAP' | 'STAFFING_REQUEST' | 'FOUNDER';
  readonly staffingRequestId: Id | null;
  readonly version: number;
  readonly createdAt: Timestamp;
}

export const mapPosition = (r: Row): PositionRecord => ({
  id: str(r.id) as Id,
  code: str(r.code),
  title: str(r.title),
  scope: str(r.scope) as PositionScope,
  departmentId: optStr(r.department_id) as Id | null,
  kind: str(r.kind) as PositionKind,
  roleRef: str(r.role_ref),
  reportsToPositionId: optStr(r.reports_to_position_id) as Id | null,
  reportsToFounder: num(r.reports_to_founder) === 1,
  accountability: arr(r.accountability_json),
  status: str(r.status) as PositionStatus,
  source: str(r.source) as PositionRecord['source'],
  staffingRequestId: optStr(r.staffing_request_id) as Id | null,
  version: num(r.version),
  createdAt: str(r.created_at) as Timestamp,
});

export interface AssignmentRecord {
  readonly id: Id;
  readonly positionId: Id;
  readonly employeeId: Id;
  readonly kind: 'PRIMARY' | 'ACTING';
  readonly status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  readonly effectiveFrom: Timestamp;
  readonly plannedTo: Timestamp | null;
  readonly effectiveTo: Timestamp | null;
  readonly actingScope: readonly string[];
  readonly coversEmployeeId: Id | null;
  readonly reasonCode: string;
  readonly endReasonCode: string | null;
  readonly decidedByRef: string;
  readonly authorityRef: string | null;
  readonly version: number;
}

export const mapAssignment = (r: Row): AssignmentRecord => ({
  id: str(r.id) as Id,
  positionId: str(r.position_id) as Id,
  employeeId: str(r.employee_id) as Id,
  kind: str(r.kind) as AssignmentRecord['kind'],
  status: str(r.status) as AssignmentRecord['status'],
  effectiveFrom: str(r.effective_from) as Timestamp,
  plannedTo: optStr(r.planned_to) as Timestamp | null,
  effectiveTo: optStr(r.effective_to) as Timestamp | null,
  actingScope: arr(r.acting_scope_json),
  coversEmployeeId: optStr(r.covers_employee_id) as Id | null,
  reasonCode: str(r.reason_code),
  endReasonCode: optStr(r.end_reason_code),
  decidedByRef: str(r.decided_by_ref),
  authorityRef: optStr(r.authority_ref),
  version: num(r.version),
});

export interface CharterRecord {
  readonly id: Id;
  readonly departmentId: Id;
  readonly version: number;
  readonly status: 'BASELINE' | 'ACTIVE' | 'SUPERSEDED';
  readonly mission: string;
  readonly outcomes: readonly string[];
  readonly scope: readonly string[];
  readonly boundaries: readonly string[];
  readonly directorPositionId: Id;
  readonly seats: readonly string[];
  readonly recurringResponsibilities: readonly string[];
  readonly dependencies: readonly string[];
  readonly budgetEnvelopeId: Id | null;
  readonly measures: readonly string[];
  readonly risks: readonly string[];
  readonly source: 'PRODUCT_AUTHORITY' | 'FOUNDER';
  readonly effectiveFrom: Timestamp;
  readonly effectiveTo: Timestamp | null;
}

export const mapCharter = (r: Row): CharterRecord => ({
  id: str(r.id) as Id,
  departmentId: str(r.department_id) as Id,
  version: num(r.version),
  status: str(r.status) as CharterRecord['status'],
  mission: str(r.mission),
  outcomes: arr(r.outcomes_json),
  scope: arr(r.scope_json),
  boundaries: arr(r.boundaries_json),
  directorPositionId: str(r.director_position_id) as Id,
  seats: arr(r.seats_json),
  recurringResponsibilities: arr(r.recurring_responsibilities_json),
  dependencies: arr(r.dependencies_json),
  budgetEnvelopeId: optStr(r.budget_envelope_id) as Id | null,
  measures: arr(r.measures_json),
  risks: arr(r.risks_json),
  source: str(r.source) as CharterRecord['source'],
  effectiveFrom: str(r.effective_from) as Timestamp,
  effectiveTo: optStr(r.effective_to) as Timestamp | null,
});

/** A Staffing Request without its business evidence text (read the request itself through authorized reads). */
export interface StaffingRequestRecord {
  readonly id: Id;
  readonly scope: PositionScope;
  readonly departmentId: Id | null;
  readonly requestedByEmployeeId: Id;
  readonly requestedByPositionId: Id;
  readonly roleRef: string;
  readonly positionKind: PositionKind;
  readonly positionTitle: string;
  readonly expectedCostMicros: number | null;
  readonly priority: number | null;
  readonly state: StaffingState;
  readonly ceoRecommendation: 'APPROVE' | 'REJECT' | null;
  readonly consolidatedIntoId: Id | null;
  readonly decidedByRef: string | null;
  readonly decisionAuthorityRef: string | null;
  readonly approvedPositionId: Id | null;
  readonly hiredEmployeeId: Id | null;
  readonly decisionDueAt: Timestamp | null;
  readonly version: number;
  readonly createdAt: Timestamp;
}

export const mapStaffingRequest = (r: Row): StaffingRequestRecord => ({
  id: str(r.id) as Id,
  scope: str(r.scope) as PositionScope,
  departmentId: optStr(r.department_id) as Id | null,
  requestedByEmployeeId: str(r.requested_by_employee_id) as Id,
  requestedByPositionId: str(r.requested_by_position_id) as Id,
  roleRef: str(r.role_ref),
  positionKind: str(r.position_kind) as PositionKind,
  positionTitle: str(r.position_title),
  expectedCostMicros: optNum(r.expected_cost_micros),
  priority: optNum(r.priority),
  state: str(r.state) as StaffingState,
  ceoRecommendation: optStr(r.ceo_recommendation) as StaffingRequestRecord['ceoRecommendation'],
  consolidatedIntoId: optStr(r.consolidated_into_id) as Id | null,
  decidedByRef: optStr(r.decided_by_ref),
  decisionAuthorityRef: optStr(r.decision_authority_ref),
  approvedPositionId: optStr(r.approved_position_id) as Id | null,
  hiredEmployeeId: optStr(r.hired_employee_id) as Id | null,
  decisionDueAt: optStr(r.decision_due_at) as Timestamp | null,
  version: num(r.version),
  createdAt: str(r.created_at) as Timestamp,
});

export interface AuthorityDelegationRecord {
  readonly id: Id;
  readonly grantId: Id;
  readonly delegatorRef: string;
  readonly delegateEmployeeId: Id;
  readonly purposeCode: string;
  readonly limits: Record<string, unknown>;
  readonly actingAssignmentId: Id | null;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly createdAt: Timestamp;
}

export const mapAuthorityDelegation = (r: Row): AuthorityDelegationRecord => ({
  id: str(r.id) as Id,
  grantId: str(r.grant_id) as Id,
  delegatorRef: str(r.delegator_ref),
  delegateEmployeeId: str(r.delegate_employee_id) as Id,
  purposeCode: str(r.purpose_code),
  limits: JSON.parse(str(r.limits_json)) as Record<string, unknown>,
  actingAssignmentId: optStr(r.acting_assignment_id) as Id | null,
  status: str(r.status) as AuthorityDelegationRecord['status'],
  createdAt: str(r.created_at) as Timestamp,
});

export interface WorkDelegationRecord {
  readonly id: Id;
  readonly kind: 'DELEGATION' | 'SUPPORT';
  readonly parentWorkItemId: Id;
  readonly childWorkItemId: Id;
  readonly rootWorkItemId: Id;
  readonly delegatorEmployeeId: Id;
  readonly delegateEmployeeId: Id;
  readonly accountableOwnerRef: string;
  readonly sourceDepartmentId: Id | null;
  readonly targetDepartmentId: Id | null;
  readonly depth: number;
  readonly state: 'OFFERED' | 'ACCEPTED' | 'CLARIFICATION_REQUESTED' | 'ESCALATED' | 'REFUSED' | 'CANCELLED' | 'SUPERSEDED' | 'COMPLETED' | 'FAILED';
  readonly responseReasonCode: string | null;
  readonly acceptedRunId: Id | null;
  readonly budgetCapMoney: number;
  readonly budgetCapTokens: number;
  readonly dueAt: Timestamp | null;
  readonly version: number;
  readonly createdAt: Timestamp;
}

export const mapWorkDelegation = (r: Row): WorkDelegationRecord => ({
  id: str(r.id) as Id,
  kind: str(r.kind) as WorkDelegationRecord['kind'],
  parentWorkItemId: str(r.parent_work_item_id) as Id,
  childWorkItemId: str(r.child_work_item_id) as Id,
  rootWorkItemId: str(r.root_work_item_id) as Id,
  delegatorEmployeeId: str(r.delegator_employee_id) as Id,
  delegateEmployeeId: str(r.delegate_employee_id) as Id,
  accountableOwnerRef: str(r.accountable_owner_ref),
  sourceDepartmentId: optStr(r.source_department_id) as Id | null,
  targetDepartmentId: optStr(r.target_department_id) as Id | null,
  depth: num(r.depth),
  state: str(r.state) as WorkDelegationRecord['state'],
  responseReasonCode: optStr(r.response_reason_code),
  acceptedRunId: optStr(r.accepted_run_id) as Id | null,
  budgetCapMoney: num(r.budget_cap_money),
  budgetCapTokens: num(r.budget_cap_tokens),
  dueAt: optStr(r.due_at) as Timestamp | null,
  version: num(r.version),
  createdAt: str(r.created_at) as Timestamp,
});

export interface RunOrgSnapshotRecord {
  readonly runId: Id;
  readonly employeeId: Id;
  readonly orgScope: PositionScope;
  readonly departmentId: Id | null;
  readonly positionId: Id | null;
  readonly assignmentId: Id | null;
  readonly assignmentKind: 'PRIMARY' | 'ACTING' | null;
  readonly managerRef: string;
  readonly directorEmployeeId: Id | null;
  readonly ceoEmployeeId: Id | null;
  readonly source: 'ASSIGNMENT' | 'LEGACY_PROJECTION';
  readonly capturedAt: Timestamp;
}

export const mapRunOrgSnapshot = (r: Row): RunOrgSnapshotRecord => ({
  runId: str(r.run_id) as Id,
  employeeId: str(r.employee_id) as Id,
  orgScope: str(r.org_scope) as PositionScope,
  departmentId: optStr(r.department_id) as Id | null,
  positionId: optStr(r.position_id) as Id | null,
  assignmentId: optStr(r.assignment_id) as Id | null,
  assignmentKind: optStr(r.assignment_kind) as RunOrgSnapshotRecord['assignmentKind'],
  managerRef: str(r.manager_ref),
  directorEmployeeId: optStr(r.director_employee_id) as Id | null,
  ceoEmployeeId: optStr(r.ceo_employee_id) as Id | null,
  source: str(r.source) as RunOrgSnapshotRecord['source'],
  capturedAt: str(r.captured_at) as Timestamp,
});

// --- Review ---------------------------------------------------------------------------------------

export interface ReviewPlanRecord {
  readonly id: Id;
  readonly workItemId: Id;
  readonly version: number;
  readonly status: 'ACTIVE' | 'SUPERSEDED';
  readonly domain: string;
  readonly appliesTo: ReviewApplies;
  readonly keys: readonly { readonly kind: ReviewKeyKind }[];
  readonly excludeSameDepartment: boolean;
  readonly requiredEvidence: readonly string[];
  readonly rubricCode: string;
  readonly rubricVersion: number;
  readonly reviewerInstructionsSha256: string;
  readonly reviewTaskClass: string;
  readonly reviewBudgetMoney: number;
  readonly reviewBudgetTokens: number;
  readonly deadlineAt: Timestamp | null;
  readonly declaredByRef: string;
  readonly createdAt: Timestamp;
  /** C6-R1: who makes the operational judgments (outcome, attribution, learning) on this plan's Work Item. */
  readonly operationalJudgment: OperationalJudgment;
}

export const mapReviewPlan = (r: Row): ReviewPlanRecord => ({
  operationalJudgment: (r.operational_judgment === 'REVIEW_POOL' ? 'REVIEW_POOL' : 'FOUNDER') as OperationalJudgment,
  id: str(r.id) as Id,
  workItemId: str(r.work_item_id) as Id,
  version: num(r.version),
  status: str(r.status) as ReviewPlanRecord['status'],
  domain: str(r.domain),
  appliesTo: str(r.applies_to) as ReviewApplies,
  keys: JSON.parse(str(r.keys_json)) as ReviewPlanRecord['keys'],
  excludeSameDepartment: (JSON.parse(str(r.independence_json)) as { excludeSameDepartment?: boolean }).excludeSameDepartment === true,
  requiredEvidence: arr(r.required_evidence_json),
  rubricCode: str(r.rubric_code),
  rubricVersion: num(r.rubric_version),
  reviewerInstructionsSha256: str(r.reviewer_instructions_sha256),
  reviewTaskClass: str(r.review_task_class),
  reviewBudgetMoney: num(r.review_budget_money),
  reviewBudgetTokens: num(r.review_budget_tokens),
  deadlineAt: optStr(r.deadline_at) as Timestamp | null,
  declaredByRef: str(r.declared_by_ref),
  createdAt: str(r.created_at) as Timestamp,
});

export interface ReviewerQualificationRecord {
  readonly id: Id;
  readonly employeeId: Id;
  readonly domain: string;
  readonly level: ReviewerLevel;
  readonly certificationId: Id;
  readonly mode: 'CALIBRATION' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  readonly maxDataClass: DataClass;
  readonly goldCasesPassed: number;
  readonly goldCasesTotal: number;
  readonly calibrationAgreements: number;
  readonly calibrationDisagreements: number;
  readonly qualificationVersion: number;
  readonly admittedByRef: string | null;
  readonly version: number;
}

export const mapQualification = (r: Row): ReviewerQualificationRecord => ({
  id: str(r.id) as Id,
  employeeId: str(r.employee_id) as Id,
  domain: str(r.domain),
  level: str(r.level) as ReviewerLevel,
  certificationId: str(r.certification_id) as Id,
  mode: str(r.mode) as ReviewerQualificationRecord['mode'],
  maxDataClass: str(r.max_data_class) as DataClass,
  goldCasesPassed: num(r.gold_cases_passed),
  goldCasesTotal: num(r.gold_cases_total),
  calibrationAgreements: num(r.calibration_agreements),
  calibrationDisagreements: num(r.calibration_disagreements),
  qualificationVersion: num(r.qualification_version),
  admittedByRef: optStr(r.admitted_by_ref),
  version: num(r.version),
});

export interface ReviewRequestRecord {
  readonly id: Id;
  readonly kind: 'REQUIRED' | 'OVERSIGHT';
  readonly planId: Id | null;
  readonly workItemId: Id;
  readonly subjectKind: 'OUTPUT' | 'ACTION';
  readonly subjectFingerprint: string;
  readonly subjectRef: string;
  readonly dataClass: DataClass;
  readonly riskLevel: string;
  readonly state: 'OPEN' | 'SATISFIED' | 'REWORK' | 'CONFLICT' | 'ESCALATED' | 'STALE' | 'CANCELLED' | 'CONSUMED';
  readonly waitingReason: string | null;
  readonly version: number;
  readonly createdAt: Timestamp;
  readonly decidedAt: Timestamp | null;
}

export const mapReviewRequest = (r: Row): ReviewRequestRecord => ({
  id: str(r.id) as Id,
  kind: str(r.kind) as ReviewRequestRecord['kind'],
  planId: optStr(r.plan_id) as Id | null,
  workItemId: str(r.work_item_id) as Id,
  subjectKind: str(r.subject_kind) as ReviewRequestRecord['subjectKind'],
  subjectFingerprint: str(r.subject_fingerprint),
  subjectRef: str(r.subject_ref),
  dataClass: str(r.data_class) as DataClass,
  riskLevel: str(r.risk_level),
  state: str(r.state) as ReviewRequestRecord['state'],
  waitingReason: optStr(r.waiting_reason),
  version: num(r.version),
  createdAt: str(r.created_at) as Timestamp,
  decidedAt: optStr(r.decided_at) as Timestamp | null,
});

export interface ReviewAssignmentRecord {
  readonly id: Id;
  readonly requestId: Id;
  readonly keyIndex: number;
  readonly keyKind: ReviewKeyKind | 'SHADOW' | 'OVERSIGHT';
  readonly reviewerEmployeeId: Id | null;
  readonly reviewerRef: string;
  readonly qualificationId: Id | null;
  readonly reviewWorkItemId: Id | null;
  readonly state: 'ASSIGNED' | 'DECIDED' | 'WITHDRAWN';
  readonly withdrawReason: string | null;
  readonly version: number;
}

export const mapReviewAssignment = (r: Row): ReviewAssignmentRecord => ({
  id: str(r.id) as Id,
  requestId: str(r.request_id) as Id,
  keyIndex: num(r.key_index),
  keyKind: str(r.key_kind) as ReviewAssignmentRecord['keyKind'],
  reviewerEmployeeId: optStr(r.reviewer_employee_id) as Id | null,
  reviewerRef: str(r.reviewer_ref),
  qualificationId: optStr(r.qualification_id) as Id | null,
  reviewWorkItemId: optStr(r.review_work_item_id) as Id | null,
  state: str(r.state) as ReviewAssignmentRecord['state'],
  withdrawReason: optStr(r.withdraw_reason),
  version: num(r.version),
});

/** A decision's metadata. The rationale is local governed evidence and is exposed here as its hash only. */
export interface ReviewDecisionRecord {
  readonly id: Id;
  readonly assignmentId: Id;
  readonly requestId: Id;
  readonly reviewerRef: string;
  readonly reviewerEmployeeId: Id | null;
  readonly outcome: ReviewOutcome;
  readonly reasonCode: string;
  readonly rationaleSha256: string | null;
  readonly evidenceRefs: readonly string[];
  readonly planId: Id | null;
  readonly planVersion: number | null;
  readonly rubricCode: string | null;
  readonly rubricVersion: number | null;
  readonly subjectFingerprint: string;
  readonly qualificationId: Id | null;
  readonly qualificationVersion: number | null;
  readonly independence: Record<string, unknown>;
  readonly counts: boolean;
  readonly runId: Id | null;
  readonly createdAt: Timestamp;
}

export const mapReviewDecision = (r: Row): ReviewDecisionRecord => ({
  id: str(r.id) as Id,
  assignmentId: str(r.assignment_id) as Id,
  requestId: str(r.request_id) as Id,
  reviewerRef: str(r.reviewer_ref),
  reviewerEmployeeId: optStr(r.reviewer_employee_id) as Id | null,
  outcome: str(r.outcome) as ReviewOutcome,
  reasonCode: str(r.reason_code),
  rationaleSha256: optStr(r.rationale_sha256),
  evidenceRefs: arr(r.evidence_refs_json),
  planId: optStr(r.plan_id) as Id | null,
  planVersion: optNum(r.plan_version),
  rubricCode: optStr(r.rubric_code),
  rubricVersion: optNum(r.rubric_version),
  subjectFingerprint: str(r.subject_fingerprint),
  qualificationId: optStr(r.qualification_id) as Id | null,
  qualificationVersion: optNum(r.qualification_version),
  independence: JSON.parse(str(r.independence_json)) as Record<string, unknown>,
  counts: num(r.counts) === 1,
  runId: optStr(r.run_id) as Id | null,
  createdAt: str(r.created_at) as Timestamp,
});

/** C6-R1: one Review Pool judge of a C6 subject (an attribution proposal, a lesson under review). */
export interface JudgmentAssignmentRecord {
  readonly id: Id;
  readonly subjectKind: 'ATTRIBUTION' | 'LESSON';
  readonly subjectId: Id;
  readonly workItemId: Id;
  readonly planId: Id;
  readonly judgeEmployeeId: Id;
  readonly qualificationId: Id;
  readonly judgeWorkItemId: Id;
  readonly state: 'ASSIGNED' | 'DECIDED' | 'ESCALATED' | 'WITHDRAWN';
  readonly reviewOutcome: ReviewOutcome | null;
  readonly decision: 'VALIDATE' | 'REJECT' | 'ESCALATE' | null;
  readonly reasonCode: string | null;
  readonly evidenceRefs: readonly string[];
  readonly runId: Id | null;
  readonly qualificationVersion: number | null;
  readonly version: number;
  readonly createdAt: Timestamp;
}

export const mapJudgmentAssignment = (r: Row): JudgmentAssignmentRecord => ({
  id: str(r.id) as Id,
  subjectKind: str(r.subject_kind) as JudgmentAssignmentRecord['subjectKind'],
  subjectId: str(r.subject_id) as Id,
  workItemId: str(r.work_item_id) as Id,
  planId: str(r.plan_id) as Id,
  judgeEmployeeId: str(r.judge_employee_id) as Id,
  qualificationId: str(r.qualification_id) as Id,
  judgeWorkItemId: str(r.judge_work_item_id) as Id,
  state: str(r.state) as JudgmentAssignmentRecord['state'],
  reviewOutcome: optStr(r.review_outcome) as ReviewOutcome | null,
  decision: optStr(r.decision) as JudgmentAssignmentRecord['decision'],
  reasonCode: optStr(r.reason_code),
  evidenceRefs: arr(r.evidence_refs_json),
  runId: optStr(r.run_id) as Id | null,
  qualificationVersion: optNum(r.qualification_version),
  version: num(r.version),
  createdAt: str(r.created_at) as Timestamp,
});

export interface ReviewConflictRecord {
  readonly id: Id;
  readonly requestId: Id;
  readonly origin: 'KEY_DISAGREEMENT' | 'OVERSIGHT';
  readonly state: 'OPEN' | 'RESOLVED';
  readonly decisionIds: readonly Id[];
  readonly resolution: 'PASS' | 'REWORK' | null;
  readonly resolvedByRef: string | null;
  readonly createdAt: Timestamp;
}

export const mapReviewConflict = (r: Row): ReviewConflictRecord => ({
  id: str(r.id) as Id,
  requestId: str(r.request_id) as Id,
  origin: str(r.origin) as ReviewConflictRecord['origin'],
  state: str(r.state) as ReviewConflictRecord['state'],
  decisionIds: arr(r.decision_ids_json) as Id[],
  resolution: optStr(r.resolution) as ReviewConflictRecord['resolution'],
  resolvedByRef: optStr(r.resolved_by_ref),
  createdAt: str(r.created_at) as Timestamp,
});

export interface QualityHoldRecord {
  readonly id: Id;
  readonly targetKind: 'REVIEWER' | 'QUALIFICATION' | 'DOMAIN' | 'RUBRIC';
  readonly targetRef: string;
  readonly state: 'ACTIVE' | 'LIFTED';
  readonly origin: 'OVERSIGHT' | 'FOUNDER';
  readonly findingId: Id | null;
  readonly reasonCode: string;
  readonly createdAt: Timestamp;
}

export const mapQualityHold = (r: Row): QualityHoldRecord => ({
  id: str(r.id) as Id,
  targetKind: str(r.target_kind) as QualityHoldRecord['targetKind'],
  targetRef: str(r.target_ref),
  state: str(r.state) as QualityHoldRecord['state'],
  origin: str(r.origin) as QualityHoldRecord['origin'],
  findingId: optStr(r.finding_id) as Id | null,
  reasonCode: str(r.reason_code),
  createdAt: str(r.created_at) as Timestamp,
});

export interface OversightFindingRecord {
  readonly id: Id;
  readonly targetKind: string;
  readonly targetRef: string;
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly state: 'OPEN' | 'ROOT_CAUSED' | 'CORRECTIVE_ACTION' | 'VERIFIED' | 'CLOSED';
  readonly reviewRequestId: Id | null;
  readonly reasonCode: string;
  readonly rootCauseCode: string | null;
  readonly correctiveActionCode: string | null;
  readonly version: number;
  readonly createdAt: Timestamp;
}

export const mapFinding = (r: Row): OversightFindingRecord => ({
  id: str(r.id) as Id,
  targetKind: str(r.target_kind),
  targetRef: str(r.target_ref),
  severity: str(r.severity) as OversightFindingRecord['severity'],
  state: str(r.state) as OversightFindingRecord['state'],
  reviewRequestId: optStr(r.review_request_id) as Id | null,
  reasonCode: str(r.reason_code),
  rootCauseCode: optStr(r.root_cause_code),
  correctiveActionCode: optStr(r.corrective_action_code),
  version: num(r.version),
  createdAt: str(r.created_at) as Timestamp,
});
