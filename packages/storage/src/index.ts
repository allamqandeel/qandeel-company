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
