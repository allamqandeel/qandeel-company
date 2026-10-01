/**
 * @qandeel-company/storage — the C1 persistence layer.
 *
 * Exposes Company operations only. The SQLite adapter (`node:sqlite`, a Release Candidate API)
 * stays inside this package: no database handle and no "execute SQL" function is exported, and
 * the package `exports` map forbids deep imports.
 */
export { ArtifactStore, ARTIFACT_MAX_BYTES, type ArtifactRecord, type ArtifactRecoveryReport, type ArtifactState, type ArtifactVerifyReport, type PutArtifactInput } from './artifacts.js';
export {
  BACKUP_FORMAT,
  createBackup,
  listBackups,
  restoreToIsolatedWorkspace,
  verifyBackup,
  type BackupCounts,
  type BackupManifest,
  type BackupResult,
  type BackupVerification,
  type ExpectedBackup,
  type IsolatedRestoreReport,
} from './backup.js';
export type { FaultHook, FaultPoint } from './internal.js';
export { CURRENT_SCHEMA_VERSION, RELEASED_MIGRATIONS, loadReleasedMigrations, migrationChecksum, type Migration, type MigrationPin, type MigrationReport } from './migrations.js';
// Claims, worker writes and the supervisor lease are NOT exported here: they live behind the
// runtime-only `@qandeel-company/storage/runtime-authority` subpath (D-C1-22).
export { CHECKPOINT_MAX_BYTES, EVIDENCE_MAX_BYTES, isStaleLease, type Claim, type ReconciliationDecision, type SettleOutcome } from './queue.js';
export type { AuditRecord, CheckpointRecord, EventRecord, Fence, JobRecord, RunRecord, SupervisorFence, TransitionRecord, WorkItemRecord } from './records.js';
export type { InstanceState, RuntimeInstanceRecord, SupervisorLease } from './runtime-state.js';
export { CompanyStore, DEFAULT_BUSY_TIMEOUT_MS, STORAGE_VERSION, type CompanyReadView, type HealthCounts, type OpenStoreOptions } from './store.js';
export { DEFAULT_MAX_ATTEMPTS, MAX_LINEAGE_DEPTH, defaultPropagationPolicy, type PropagationPolicy, type TerminationMode, type TerminationOutcome } from './work-core.js';
export { IDEMPOTENCY_SCOPE_CREATE, type CreateOptions, type CreateResult, type CreateWorkItemInput, type TerminationInput, type TransitionInput } from './work-items.js';
export { DATABASE_FILE, assertLocalPathSyntax, layoutFor, openWorkspace, workspaceFreeBytes, type WorkspaceLayout } from './workspace.js';
// C2 governance administration and inspection (Founder authority; no execution, no claims).
export {
  GovernanceStore,
  assertCredentialRef,
  workItemDataClass,
  type CreateBudgetInput,
  type CreateEmployeeInput,
  type GovernanceHealth,
  type GrantInput,
  type PriceCardInput,
  type ReconcileDecision,
  type RegisterDeploymentInput,
  type RegisterToolActionInput,
} from './governance.js';
export type {
  ApprovalRecord,
  BudgetRecord,
  DepartmentRecord,
  DeploymentRecord,
  EmployeeHistoryRecord,
  EmployeeRecord,
  GrantRecord,
  PriceCardRecord,
  PrincipalRecord,
  ProviderRecord,
  ReservationRecord,
  RunAttributionRecord,
  ToolActionRecord,
  ToolInvocationRecord,
  ToolRecord,
  UsageRecord,
} from './governance-records.js';
// C3 Employee Mind: Memory / Knowledge / Canonical Truth, Skills / Passports, Capability, Academy.
// Reads are content-free metadata; authority writes fail closed until C5 (D-C2-13); memory is written
// by the runtime-owned Memory Write Policy through the runtime-authority subpath only.
export { MemoryStore, type CanonicalInput, type CorrectionInput, type KnowledgeInput, type MindHealth } from './memory.js';
export { SkillStore, type RegisterSkillVersionInput, type SkillHealth } from './skill-registry.js';
export { CapabilityStore, type DeclareRequirementsInput } from './capability.js';
export { AcademyStore, type AcademyHealth } from './academy.js';
export type {
  ActivationRequestRecord,
  AttemptRecord,
  BlueprintRecord,
  CanonicalTruthRecord,
  CapabilityGapRecord,
  CertificationRecord,
  ContextManifestRecord,
  EnrollmentRecord,
  KnowledgeRecord,
  LessonRecord,
  ManifestEntryRecord,
  MemoryCandidateRecord,
  MemoryConflictRecord,
  MemoryRecord,
  PassportEntryRecord,
  PromotionRecord,
  RemediationRecord,
  ScenarioRecord,
  SkillRecord,
  SkillUpdateRecord,
  SkillVersionRecord,
  SummaryRecord,
} from './mind-records.js';
// C4 Organization (Founder → CEO seat → Directors → Department seats; assignments are canonical), work
// and authority delegation, the dynamic Review Pool and Independent Oversight. Founder writes fail closed
// until C5 (D-C2-13); Employees act only through fenced runtime-authority acts.
export { OrganizationStore, type CharterInput, type CreatePositionInput, type DelegateAuthorityInput, type EmployeeOrganization, type HireInput, type OrganizationHealth } from './organization.js';
export { ReviewStore, type ReviewHealth } from './review.js';
// C5 Founder Command Center: the authenticated Founder surface (sessions are hashes; a ref is not
// authentication), the durable Goal model, Founder-facing structured communication, Founder Attention,
// governed action previews and the derived Company Universe projection. Employee messages and Director goal
// acts are written only through the fenced runtime-authority subpath.
export { FounderAuthStore, LAUNCH_TOKEN_TTL_MS, SESSION_IDLE_MS, SESSION_TTL_MS, type FounderSession } from './founder-auth.js';
export { GoalStore, type ProposeGoalInput } from './goals.js';
export { CommunicationStore, FOUNDER_BRIEF_TASK_CLASS, FOUNDER_REPLY_TASK_CLASS, type FounderSendInput, type OpenThreadInput } from './communications.js';
export { AttentionStore, ATTENTION_COOLDOWN_MS, type AttentionSyncReport } from './attention.js';
export { FounderActionStore, PREVIEW_TTL_MS, type ConfirmResult } from './founder-actions.js';
export { CANONICAL_DEPARTMENT_ORDER, projectUniverse, type CompanyUniverse, type RelationKind, type UniverseAttention, type UniverseDepartment, type UniverseEmployee, type UniverseGoal, type UniverseRelation, type UniverseSeat, type UniverseWork } from './universe.js';
export type { ActionPreviewRecord, AttentionItemRecord, FounderSessionRecord, GoalHistoryRecord, GoalRecord, GoalWorkLinkRecord, MessageMeta, MessageRecord, ThreadRecord } from './founder-records.js';
export type {
  AssignmentRecord,
  AuthorityDelegationRecord,
  CharterRecord,
  JudgmentAssignmentRecord,
  OversightFindingRecord,
  PositionRecord,
  QualityHoldRecord,
  ReviewAssignmentRecord,
  ReviewConflictRecord,
  ReviewDecisionRecord,
  ReviewPlanRecord,
  ReviewRequestRecord,
  ReviewerQualificationRecord,
  RunOrgSnapshotRecord,
  StaffingRequestRecord,
  WorkDelegationRecord,
} from './org-records.js';
// C6 Company Improvement Engine: the Eval Registry, outcome verification, evaluation, causal attribution,
// learning signals / interventions / systemic findings / failure cases (over the C3 lesson lifecycle and the
// C3 Academy), reports with typed claims, profiles without any aggregate score, and Stage 15 resilience
// (encrypted portable packages, destinations, generational retention, restore drills, update safety).
export {
  ImprovementStore,
  STANDARD_DEFINITION_CODE,
  SYSTEM_EVALUATOR_REF,
  SYSTEM_REPORTER_REF,
  type AttributionRecord,
  type CalibrationRunRecord,
  type EvalDefinitionRecord,
  type EvaluationRecord,
  type FailureCaseRecord,
  type InterventionPlan,
  type InterventionRecord,
  type JudgmentResult,
  type LearningSignalRecord,
  type ReportRecord,
  type SystemicFindingRecord,
  type SystemicOrigin,
} from './improvement.js';
export {
  DEFAULT_RETENTION,
  DirectoryDestination,
  MAX_PORTABLE_PAYLOAD_BYTES,
  MIN_PASSPHRASE_LENGTH,
  PORTABLE_FORMAT,
  RECOVERY_OBJECTIVES,
  RESTORE_HOLD_CODE,
  createPortableBackup,
  isOffDevice,
  planRetention,
  prunePortableBackups,
  pruneLocalBackups,
  resilienceStatus,
  restorePortableBackup,
  runRestoreDrill,
  verifyPortableBackup,
  type BackupDestination,
  type CleanRestoreReport,
  type FailureDomain,
  type PortableBackupResult,
  type RecoveryObjective,
  type ResilienceStatus,
  type RestorePortableOptions,
  type RetentionPolicy,
} from './resilience.js';
export { rollbackSchemaUpdate, safeUpgrade, type RollbackReport, type SafeUpgradeReport } from './maintenance.js';
// C7-A Operational Data + External Outcome Core: the Founder-governed source registry and evidence bindings, and the
// content-free intake seam (allowlisted, normalized, idempotent, conflict-detecting). It feeds the C6 engine through
// outcome verification and evaluation only; there is no transport, listener or per-user browsing path.
export { ExternalEvidenceStore, INTAKE_ACTOR_REF, contractDigest, type ExternalBindingRecord, type ExternalRecordView, type ExternalSourceRecord, type IntakeResult } from './external-evidence.js';
export type { ExternalEvidenceView, ExternalOutcomeState } from './external-core.js';
export { RESTORE_IN_PROGRESS, clearUpdateHold, readUpdateHold, restoreStatus, type RestoreMarker, type RestorePhase, type RestoreStatus, type UpdateHold } from './update-hold.js';