/**
 * C3 record types and row mappers (Memory, Knowledge, Canonical Truth, learning, Context Manifests,
 * Skills, Passports, Capability, Academy). Storage-internal mapping; the types are exported for
 * callers that read C3 state.
 */
import type { Id, Timestamp } from '@qandeel-company/domain';
import type { DataClass } from '@qandeel-company/governance';
import type {
  AssessmentDimension,
  CertificationStatus,
  Freshness,
  KnowledgeScope,
  LearningStage,
  LessonStage,
  LicenseStatus,
  MemoryClass,
  MemoryStatus,
  PipelineState,
  Proficiency,
  PromotionTarget,
  ScenarioKind,
  SkillType,
} from '@qandeel-company/mind';

import type { Row, SqlValue } from './sqlite/connection.js';

const str = (v: SqlValue | undefined): string => String(v);
const optStr = (v: SqlValue | undefined): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: SqlValue | undefined): number => Number(v);
const optNum = (v: SqlValue | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const arr = <T = string>(v: SqlValue | undefined): T[] => JSON.parse(String(v ?? '[]')) as T[];
const obj = <T = Record<string, unknown>>(v: SqlValue | undefined): T => JSON.parse(String(v ?? '{}')) as T;

export interface CanonicalTruthRecord {
  readonly id: Id;
  readonly level: 'CONSTITUTION' | 'POLICY' | 'DECISION' | 'VERIFIED_FACT';
  readonly topic: string;
  readonly claimKey: string | null;
  readonly claimValue: string | null;
  readonly statementSha256: string;
  readonly dataClass: DataClass;
  readonly sourceRef: string;
  readonly status: 'ACTIVE' | 'SUPERSEDED';
  readonly integrity: 'OK' | 'CORRUPT';
  readonly supersedesId: Id | null;
  readonly supersededById: Id | null;
  readonly version: number;
  readonly recordedAt: Timestamp;
}

export function mapCanonical(r: Row): CanonicalTruthRecord {
  return {
    id: str(r.id) as Id,
    level: str(r.level) as CanonicalTruthRecord['level'],
    topic: str(r.topic),
    claimKey: optStr(r.claim_key),
    claimValue: optStr(r.claim_value),
    statementSha256: str(r.statement_sha256),
    dataClass: str(r.data_class) as DataClass,
    sourceRef: str(r.source_ref),
    status: str(r.status) as CanonicalTruthRecord['status'],
    integrity: str(r.integrity) as 'OK' | 'CORRUPT',
    supersedesId: optStr(r.supersedes_id) as Id | null,
    supersededById: optStr(r.superseded_by_id) as Id | null,
    version: num(r.version),
    recordedAt: str(r.recorded_at) as Timestamp,
  };
}

/** Memory metadata. Content is never part of the ordinary record: it is loaded only for selected context. */
export interface MemoryRecord {
  readonly id: Id;
  readonly employeeId: Id;
  readonly memoryClass: MemoryClass;
  readonly scope: 'PERSONAL';
  readonly topic: string;
  readonly claimKey: string | null;
  readonly claimValue: string | null;
  readonly contentSha256: string;
  readonly dataClass: DataClass;
  readonly marketRef: string | null;
  readonly projectRef: string | null;
  readonly provenanceKind: string;
  readonly provenanceRef: string;
  readonly evidenceRefs: readonly string[];
  readonly confidencePct: number;
  readonly status: MemoryStatus;
  readonly integrity: 'OK' | 'CORRUPT';
  readonly retentionPolicy: string;
  readonly reviewAt: Timestamp | null;
  readonly lastValidatedAt: Timestamp | null;
  readonly candidateId: Id | null;
  readonly supersedesId: Id | null;
  readonly supersededById: Id | null;
  readonly version: number;
  readonly createdAt: Timestamp;
}

export function mapMemory(r: Row): MemoryRecord {
  return {
    id: str(r.id) as Id,
    employeeId: str(r.employee_id) as Id,
    memoryClass: str(r.memory_class) as MemoryClass,
    scope: 'PERSONAL',
    topic: str(r.topic),
    claimKey: optStr(r.claim_key),
    claimValue: optStr(r.claim_value),
    contentSha256: str(r.content_sha256),
    dataClass: str(r.data_class) as DataClass,
    marketRef: optStr(r.market_ref),
    projectRef: optStr(r.project_ref),
    provenanceKind: str(r.provenance_kind),
    provenanceRef: str(r.provenance_ref),
    evidenceRefs: arr(r.evidence_refs_json),
    confidencePct: num(r.confidence_pct),
    status: str(r.status) as MemoryStatus,
    integrity: str(r.integrity) as 'OK' | 'CORRUPT',
    retentionPolicy: str(r.retention_policy),
    reviewAt: optStr(r.review_at) as Timestamp | null,
    lastValidatedAt: optStr(r.last_validated_at) as Timestamp | null,
    candidateId: optStr(r.candidate_id) as Id | null,
    supersedesId: optStr(r.supersedes_id) as Id | null,
    supersededById: optStr(r.superseded_by_id) as Id | null,
    version: num(r.version),
    createdAt: str(r.created_at) as Timestamp,
  };
}

export interface MemoryCandidateRecord {
  readonly id: Id;
  readonly employeeId: Id;
  readonly runId: Id;
  readonly workItemId: Id;
  readonly kind: 'MEMORY' | 'OBSERVATION';
  readonly memoryClass: MemoryClass | null;
  readonly state: 'SUBMITTED' | 'ACCEPTED' | 'REFUSED' | 'ROUTED_TO_LEARNING';
  readonly decisionReason: string | null;
  readonly duplicateOf: Id | null;
  readonly resultMemoryId: Id | null;
  readonly resultLessonId: Id | null;
  readonly dataClass: DataClass;
  readonly createdAt: Timestamp;
  readonly decidedAt: Timestamp | null;
}

export function mapCandidate(r: Row): MemoryCandidateRecord {
  return {
    id: str(r.id) as Id,
    employeeId: str(r.employee_id) as Id,
    runId: str(r.run_id) as Id,
    workItemId: str(r.work_item_id) as Id,
    kind: str(r.kind) as 'MEMORY' | 'OBSERVATION',
    memoryClass: optStr(r.memory_class) as MemoryClass | null,
    state: str(r.state) as MemoryCandidateRecord['state'],
    decisionReason: optStr(r.decision_reason),
    duplicateOf: optStr(r.duplicate_of) as Id | null,
    resultMemoryId: optStr(r.result_memory_id) as Id | null,
    resultLessonId: optStr(r.result_lesson_id) as Id | null,
    dataClass: str(r.data_class) as DataClass,
    createdAt: str(r.created_at) as Timestamp,
    decidedAt: optStr(r.decided_at) as Timestamp | null,
  };
}

export interface MemoryConflictRecord {
  readonly id: Id;
  readonly claimKey: string;
  readonly memoryAId: Id;
  readonly memoryBId: Id;
  readonly state: 'OPEN' | 'RESOLVED';
  readonly resolutionRef: string | null;
}

export function mapConflict(r: Row): MemoryConflictRecord {
  return { id: str(r.id) as Id, claimKey: str(r.claim_key), memoryAId: str(r.memory_a_id) as Id, memoryBId: str(r.memory_b_id) as Id, state: str(r.state) as 'OPEN' | 'RESOLVED', resolutionRef: optStr(r.resolution_ref) };
}

export interface LessonRecord {
  readonly id: Id;
  readonly employeeId: Id;
  readonly stage: LessonStage;
  readonly kind: 'OBSERVATION' | 'LESSON';
  readonly observationId: Id | null;
  readonly eventRef: string;
  readonly topic: string;
  readonly claimKey: string | null;
  readonly claimValue: string | null;
  readonly contentSha256: string;
  readonly dataClass: DataClass;
  readonly marketRef: string | null;
  readonly reviewPath: 'FOUNDER' | 'INDEPENDENT_REVIEW' | null;
  readonly decidedByRef: string | null;
  readonly version: number;
  readonly createdAt: Timestamp;
}

export function mapLesson(r: Row): LessonRecord {
  return {
    id: str(r.id) as Id,
    employeeId: str(r.employee_id) as Id,
    stage: str(r.stage) as LessonStage,
    kind: str(r.kind) as 'OBSERVATION' | 'LESSON',
    observationId: optStr(r.observation_id) as Id | null,
    eventRef: str(r.event_ref),
    topic: str(r.topic),
    claimKey: optStr(r.claim_key),
    claimValue: optStr(r.claim_value),
    contentSha256: str(r.content_sha256),
    dataClass: str(r.data_class) as DataClass,
    marketRef: optStr(r.market_ref),
    reviewPath: optStr(r.review_path) as LessonRecord['reviewPath'],
    decidedByRef: optStr(r.decided_by_ref),
    version: num(r.version),
    createdAt: str(r.created_at) as Timestamp,
  };
}

export interface PromotionRecord {
  readonly id: Id;
  readonly lessonId: Id;
  readonly target: PromotionTarget;
  readonly targetRef: string | null;
  readonly state: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  readonly resultMemoryId: Id | null;
  readonly resultKnowledgeId: Id | null;
}

export function mapPromotion(r: Row): PromotionRecord {
  return {
    id: str(r.id) as Id,
    lessonId: str(r.lesson_id) as Id,
    target: str(r.target) as PromotionTarget,
    targetRef: optStr(r.target_ref),
    state: str(r.state) as PromotionRecord['state'],
    resultMemoryId: optStr(r.result_memory_id) as Id | null,
    resultKnowledgeId: optStr(r.result_knowledge_id) as Id | null,
  };
}

export interface KnowledgeRecord {
  readonly id: Id;
  readonly scope: KnowledgeScope;
  readonly scopeRef: string | null;
  readonly topic: string;
  readonly claimKey: string | null;
  readonly claimValue: string | null;
  readonly contentSha256: string;
  readonly dataClass: DataClass;
  readonly marketRef: string | null;
  readonly provenanceKind: string;
  readonly provenanceRef: string;
  readonly confidencePct: number;
  readonly status: MemoryStatus;
  readonly integrity: 'OK' | 'CORRUPT';
  readonly reviewAt: Timestamp | null;
  readonly version: number;
  readonly createdAt: Timestamp;
}

export function mapKnowledge(r: Row): KnowledgeRecord {
  return {
    id: str(r.id) as Id,
    scope: str(r.scope) as KnowledgeScope,
    scopeRef: optStr(r.scope_ref),
    topic: str(r.topic),
    claimKey: optStr(r.claim_key),
    claimValue: optStr(r.claim_value),
    contentSha256: str(r.content_sha256),
    dataClass: str(r.data_class) as DataClass,
    marketRef: optStr(r.market_ref),
    provenanceKind: str(r.provenance_kind),
    provenanceRef: str(r.provenance_ref),
    confidencePct: num(r.confidence_pct),
    status: str(r.status) as MemoryStatus,
    integrity: str(r.integrity) as 'OK' | 'CORRUPT',
    reviewAt: optStr(r.review_at) as Timestamp | null,
    version: num(r.version),
    createdAt: str(r.created_at) as Timestamp,
  };
}

export interface ContextManifestRecord {
  readonly id: Id;
  readonly runId: Id;
  readonly workItemId: Id;
  readonly employeeId: Id;
  readonly inferenceSeq: number;
  readonly step: number;
  readonly outcome: 'OK' | 'CONTEXT_BUDGET_EXHAUSTED' | 'CONFLICT_HOLD' | 'SKILL_CONFLICT' | 'INTEGRITY_FAILURE';
  readonly totalBudget: number;
  readonly usedTokens: number;
  readonly estimatedInputTokens: number;
  readonly maxDataClass: DataClass;
  readonly perLayer: Readonly<Record<string, number>>;
  readonly selectedCount: number;
  readonly rejectedCount: number;
  readonly conflictCount: number;
  readonly prefixSha256: string | null;
  readonly messagesSha256: string | null;
  readonly createdAt: Timestamp;
}

export function mapManifest(r: Row): ContextManifestRecord {
  return {
    id: str(r.id) as Id,
    runId: str(r.run_id) as Id,
    workItemId: str(r.work_item_id) as Id,
    employeeId: str(r.employee_id) as Id,
    inferenceSeq: num(r.inference_seq),
    step: num(r.step),
    outcome: str(r.outcome) as ContextManifestRecord['outcome'],
    totalBudget: num(r.total_budget),
    usedTokens: num(r.used_tokens),
    estimatedInputTokens: num(r.estimated_input_tokens),
    maxDataClass: str(r.max_data_class) as DataClass,
    perLayer: obj(r.per_layer_json),
    selectedCount: num(r.selected_count),
    rejectedCount: num(r.rejected_count),
    conflictCount: num(r.conflict_count),
    prefixSha256: optStr(r.prefix_sha256),
    messagesSha256: optStr(r.messages_sha256),
    createdAt: str(r.created_at) as Timestamp,
  };
}

export interface ManifestEntryRecord {
  readonly ordinal: number;
  readonly decision: 'SELECTED' | 'REJECTED';
  readonly layer: string;
  readonly itemKind: string;
  readonly itemId: string;
  readonly itemVersion: number;
  readonly itemSha256: string;
  readonly provenanceRef: string;
  readonly authorityWeight: number;
  readonly status: string;
  readonly stale: boolean;
  readonly dataClass: DataClass;
  readonly estTokens: number;
  readonly score: number;
  readonly reasonCode: string | null;
}

export function mapManifestEntry(r: Row): ManifestEntryRecord {
  return {
    ordinal: num(r.ordinal),
    decision: str(r.decision) as 'SELECTED' | 'REJECTED',
    layer: str(r.layer),
    itemKind: str(r.item_kind),
    itemId: str(r.item_id),
    itemVersion: num(r.item_version),
    itemSha256: str(r.item_sha256),
    provenanceRef: str(r.provenance_ref),
    authorityWeight: num(r.authority_weight),
    status: str(r.status),
    stale: num(r.stale) === 1,
    dataClass: str(r.data_class) as DataClass,
    estTokens: num(r.est_tokens),
    score: num(r.score),
    reasonCode: optStr(r.reason_code),
  };
}

export interface SummaryRecord {
  readonly id: Id;
  readonly employeeId: Id;
  readonly topic: string;
  readonly sourceIds: readonly Id[];
  readonly status: 'VALID' | 'INVALIDATED';
  readonly invalidationReason: string | null;
  readonly contentSha256: string;
}

export function mapSummary(r: Row): SummaryRecord {
  return { id: str(r.id) as Id, employeeId: str(r.employee_id) as Id, topic: str(r.topic), sourceIds: arr<Id>(r.source_ids_json), status: str(r.status) as 'VALID' | 'INVALIDATED', invalidationReason: optStr(r.invalidation_reason), contentSha256: str(r.content_sha256) };
}

// --- Skills ------------------------------------------------------------------------------------

export interface SkillRecord {
  readonly id: Id;
  readonly code: string;
  readonly name: string;
  readonly skillType: SkillType;
  readonly ownerRef: string;
  readonly marketCode: string | null;
  readonly status: 'ACTIVE' | 'RETIRED';
  readonly version: number;
}

export function mapSkill(r: Row): SkillRecord {
  return { id: str(r.id) as Id, code: str(r.code), name: str(r.name), skillType: str(r.skill_type) as SkillType, ownerRef: str(r.owner_ref), marketCode: optStr(r.market_code), status: str(r.status) as 'ACTIVE' | 'RETIRED', version: num(r.version) };
}

/** Skill version metadata. The instruction payload is never part of the record (progressive disclosure). */
export interface SkillVersionRecord {
  readonly id: Id;
  readonly skillId: Id;
  readonly versionLabel: string;
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly authorRef: string;
  readonly licenseSpdx: string | null;
  readonly licenseStatus: LicenseStatus;
  readonly paidDependency: boolean;
  readonly paidDependencyAcknowledged: boolean;
  readonly requestedTools: readonly string[];
  readonly directives: Readonly<Record<string, string>>;
  readonly instructionsSha256: string;
  readonly inspectionFindings: readonly string[] | null;
  readonly securityStatus: 'PENDING' | 'CLEARED' | 'FAILED';
  readonly benchmarkRefs: readonly string[];
  readonly pipelineState: PipelineState;
  readonly freshness: Freshness;
  readonly integrity: 'OK' | 'CORRUPT';
  readonly failureReason: string | null;
  readonly previousVersionId: Id | null;
  readonly version: number;
  readonly createdAt: Timestamp;
}

export function mapSkillVersion(r: Row): SkillVersionRecord {
  return {
    id: str(r.id) as Id,
    skillId: str(r.skill_id) as Id,
    versionLabel: str(r.version_label),
    sourceRef: str(r.source_ref),
    sourceRevision: str(r.source_revision),
    authorRef: str(r.author_ref),
    licenseSpdx: optStr(r.license_spdx),
    licenseStatus: str(r.license_status) as LicenseStatus,
    paidDependency: num(r.paid_dependency) === 1,
    paidDependencyAcknowledged: r.paid_dependency_ack_ref !== null && r.paid_dependency_ack_ref !== undefined,
    requestedTools: arr(r.requested_tools_json),
    directives: obj<Record<string, string>>(r.directives_json),
    instructionsSha256: str(r.instructions_sha256),
    inspectionFindings: r.inspection_findings_json === null || r.inspection_findings_json === undefined ? null : arr(r.inspection_findings_json),
    securityStatus: str(r.security_status) as SkillVersionRecord['securityStatus'],
    benchmarkRefs: arr(r.benchmark_refs_json),
    pipelineState: str(r.pipeline_state) as PipelineState,
    freshness: str(r.freshness) as Freshness,
    integrity: str(r.integrity) as 'OK' | 'CORRUPT',
    failureReason: optStr(r.failure_reason),
    previousVersionId: optStr(r.previous_version_id) as Id | null,
    version: num(r.version),
    createdAt: str(r.created_at) as Timestamp,
  };
}

export interface PassportEntryRecord {
  readonly id: Id;
  readonly employeeId: Id;
  readonly skillId: Id;
  readonly skillVersionId: Id;
  readonly proficiency: Proficiency;
  readonly status: 'ACTIVE' | 'RECERTIFICATION_REQUIRED' | 'SUSPENDED' | 'REVOKED';
  readonly trainingState: 'NOT_STARTED' | 'IN_TRAINING' | 'TRAINED' | 'RETRAINING_REQUIRED';
  readonly evidenceRefs: readonly string[];
  readonly provenanceRef: string;
  readonly restrictions: readonly string[];
  readonly lastTestedAt: Timestamp | null;
  readonly version: number;
  readonly updatedAt: Timestamp;
}

export function mapPassport(r: Row): PassportEntryRecord {
  return {
    id: str(r.id) as Id,
    employeeId: str(r.employee_id) as Id,
    skillId: str(r.skill_id) as Id,
    skillVersionId: str(r.skill_version_id) as Id,
    proficiency: str(r.proficiency) as Proficiency,
    status: str(r.status) as PassportEntryRecord['status'],
    trainingState: str(r.training_state) as PassportEntryRecord['trainingState'],
    evidenceRefs: arr(r.evidence_refs_json),
    provenanceRef: str(r.provenance_ref),
    restrictions: arr(r.restrictions_json),
    lastTestedAt: optStr(r.last_tested_at) as Timestamp | null,
    version: num(r.version),
    updatedAt: str(r.updated_at) as Timestamp,
  };
}

export interface SkillUpdateRecord {
  readonly id: Id;
  readonly skillId: Id;
  readonly fromVersionId: Id;
  readonly toVersionId: Id;
  readonly material: boolean;
  readonly recertificationImpact: 'NONE' | 'TARGETED' | 'PARTIAL' | 'FULL';
  readonly impact: { readonly blueprintIds: readonly Id[]; readonly passportEntryIds: readonly Id[]; readonly employeeIds: readonly Id[]; readonly certificationIds: readonly Id[]; readonly roleRefs: readonly string[] };
  readonly rollbackTargetId: Id;
  readonly state: 'PLANNED' | 'ROLLED_OUT' | 'ROLLED_BACK' | 'CANCELLED';
  readonly version: number;
}

export function mapSkillUpdate(r: Row): SkillUpdateRecord {
  return {
    id: str(r.id) as Id,
    skillId: str(r.skill_id) as Id,
    fromVersionId: str(r.from_version_id) as Id,
    toVersionId: str(r.to_version_id) as Id,
    material: num(r.material) === 1,
    recertificationImpact: str(r.recertification_impact) as SkillUpdateRecord['recertificationImpact'],
    impact: obj(r.impact_json),
    rollbackTargetId: str(r.rollback_target_id) as Id,
    state: str(r.state) as SkillUpdateRecord['state'],
    version: num(r.version),
  };
}

export interface BlueprintRecord {
  readonly id: Id;
  readonly roleRef: string;
  readonly version: number;
  readonly status: 'ACTIVE' | 'SUPERSEDED';
  readonly entries: readonly { readonly skillId: Id; readonly category: string; readonly minProficiency: Proficiency; readonly critical: boolean }[];
}

export interface CapabilityGapRecord {
  readonly id: Id;
  readonly workItemId: Id;
  readonly employeeId: Id;
  readonly missing: readonly { readonly requirementIndex: number; readonly kind: string; readonly code: string }[];
  readonly suggestions: readonly string[];
  readonly state: 'OPEN' | 'RESOLVED' | 'CANCELLED';
  readonly createdAt: Timestamp;
}

export function mapGap(r: Row): CapabilityGapRecord {
  return { id: str(r.id) as Id, workItemId: str(r.work_item_id) as Id, employeeId: str(r.employee_id) as Id, missing: arr(r.missing_json), suggestions: arr(r.suggestions_json), state: str(r.state) as CapabilityGapRecord['state'], createdAt: str(r.created_at) as Timestamp };
}

// --- Academy -----------------------------------------------------------------------------------

export interface EnrollmentRecord {
  readonly id: Id;
  readonly employeeId: Id;
  readonly programVersionId: Id;
  readonly roleRef: string;
  readonly stage: LearningStage;
  readonly blockedReason: string | null;
  /** Probation evidence window (a probation FAIL opens a new one). */
  readonly evidenceEpoch: number;
  /** Probation review round (each decision closes one). */
  readonly reviewRound: number;
  readonly version: number;
}

export function mapEnrollment(r: Row): EnrollmentRecord {
  return { id: str(r.id) as Id, employeeId: str(r.employee_id) as Id, programVersionId: str(r.program_version_id) as Id, roleRef: str(r.role_ref), stage: str(r.stage) as LearningStage, blockedReason: optStr(r.blocked_reason), evidenceEpoch: num(r.evidence_epoch), reviewRound: num(r.review_round), version: num(r.version) };
}

export interface ScenarioRecord {
  readonly id: Id;
  readonly programVersionId: Id;
  readonly code: string;
  readonly kind: ScenarioKind;
  readonly contentSha256: string;
  readonly sourceRef: string;
  readonly budgetMicros: number;
  readonly status: 'ACTIVE' | 'RETIRED';
}

export function mapScenario(r: Row): ScenarioRecord {
  return { id: str(r.id) as Id, programVersionId: str(r.program_version_id) as Id, code: str(r.code), kind: str(r.kind) as ScenarioKind, contentSha256: str(r.content_sha256), sourceRef: str(r.source_ref), budgetMicros: num(r.budget_micros), status: str(r.status) as 'ACTIVE' | 'RETIRED' };
}

export interface AttemptRecord {
  readonly id: Id;
  readonly enrollmentId: Id;
  readonly scenarioId: Id;
  readonly kind: 'SIMULATION' | 'ASSESSMENT';
  readonly trialNo: number;
  readonly workItemId: Id;
  readonly holdout: boolean;
  readonly holdoutClean: boolean;
  readonly state: 'OPEN' | 'EVALUATED' | 'VOID';
  readonly outcome: 'PASS' | 'FAIL' | null;
  readonly averagePct: number | null;
  readonly failedDimensions: readonly AssessmentDimension[];
  readonly criticalFailures: readonly AssessmentDimension[];
  readonly version: number;
}

export function mapAttempt(r: Row): AttemptRecord {
  return {
    id: str(r.id) as Id,
    enrollmentId: str(r.enrollment_id) as Id,
    scenarioId: str(r.scenario_id) as Id,
    kind: str(r.kind) as 'SIMULATION' | 'ASSESSMENT',
    trialNo: num(r.trial_no),
    workItemId: str(r.work_item_id) as Id,
    holdout: num(r.holdout) === 1,
    holdoutClean: num(r.holdout_clean) === 1,
    state: str(r.state) as AttemptRecord['state'],
    outcome: optStr(r.outcome) as AttemptRecord['outcome'],
    averagePct: optNum(r.average_pct),
    failedDimensions: arr(r.failed_json),
    criticalFailures: arr(r.critical_failures_json),
    version: num(r.version),
  };
}

export interface RemediationRecord {
  readonly id: Id;
  readonly enrollmentId: Id;
  /** The failed attempt diagnosed — or null when a failed probation review was diagnosed. */
  readonly attemptId: Id | null;
  readonly probationReviewId: Id | null;
  readonly failed: readonly AssessmentDimension[];
  readonly criticalFailures: readonly AssessmentDimension[];
  readonly categories: readonly string[];
  readonly modules: readonly string[];
  readonly state: 'DIAGNOSED' | 'RETRAINING' | 'RETEST_READY' | 'RETESTED';
  readonly retestAttemptId: Id | null;
}

export function mapRemediation(r: Row): RemediationRecord {
  return {
    id: str(r.id) as Id,
    enrollmentId: str(r.enrollment_id) as Id,
    attemptId: optStr(r.attempt_id) as Id | null,
    probationReviewId: optStr(r.probation_review_id) as Id | null,
    failed: arr(r.failed_json),
    criticalFailures: arr(r.critical_failures_json),
    categories: arr(r.categories_json),
    modules: arr(r.modules_json),
    state: str(r.state) as RemediationRecord['state'],
    retestAttemptId: optStr(r.retest_attempt_id) as Id | null,
  };
}

export interface CertificationRecord {
  readonly id: Id;
  readonly employeeId: Id;
  readonly roleRef: string;
  readonly enrollmentId: Id;
  readonly programVersionId: Id;
  readonly blueprintId: Id;
  readonly status: CertificationStatus;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly skillPins: readonly { readonly skillId: Id; readonly skillVersionId: Id; readonly proficiency: Proficiency }[];
  readonly issuedAt: Timestamp;
  readonly validUntil: Timestamp;
  readonly reasonCode: string | null;
  readonly version: number;
}

export function mapCertification(r: Row): CertificationRecord {
  return {
    id: str(r.id) as Id,
    employeeId: str(r.employee_id) as Id,
    roleRef: str(r.role_ref),
    enrollmentId: str(r.enrollment_id) as Id,
    programVersionId: str(r.program_version_id) as Id,
    blueprintId: str(r.blueprint_id) as Id,
    status: str(r.status) as CertificationStatus,
    evidence: obj(r.evidence_json),
    skillPins: arr(r.skill_pins_json),
    issuedAt: str(r.issued_at) as Timestamp,
    validUntil: str(r.valid_until) as Timestamp,
    reasonCode: optStr(r.reason_code),
    version: num(r.version),
  };
}

export interface ActivationRequestRecord {
  readonly id: Id;
  readonly employeeId: Id;
  readonly enrollmentId: Id;
  readonly certificationId: Id;
  readonly probationReviewId: Id;
  readonly calibrationId: Id | null;
  readonly state: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CONSUMED';
  readonly decidedByRef: string | null;
}

export function mapActivation(r: Row): ActivationRequestRecord {
  return {
    id: str(r.id) as Id,
    employeeId: str(r.employee_id) as Id,
    enrollmentId: str(r.enrollment_id) as Id,
    certificationId: str(r.certification_id) as Id,
    probationReviewId: str(r.probation_review_id) as Id,
    calibrationId: optStr(r.calibration_id) as Id | null,
    state: str(r.state) as ActivationRequestRecord['state'],
    decidedByRef: optStr(r.decided_by_ref),
  };
}
