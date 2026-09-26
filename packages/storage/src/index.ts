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
  type IsolatedRestoreReport,
} from './backup.js';
export type { FaultHook, FaultPoint } from './internal.js';
export { CURRENT_SCHEMA_VERSION, RELEASED_MIGRATIONS, loadReleasedMigrations, migrationChecksum, type Migration, type MigrationPin, type MigrationReport } from './migrations.js';
export { CHECKPOINT_MAX_BYTES, EVIDENCE_MAX_BYTES, isStaleLease, type Claim, type ClaimOptions, type ReconciliationDecision, type SettleOptions, type SettleOutcome } from './queue.js';
export type { AuditRecord, CheckpointRecord, EventRecord, Fence, JobRecord, RunRecord, SupervisorFence, TransitionRecord, WorkItemRecord } from './records.js';
export type { InstanceState, RuntimeInstanceRecord, SupervisorLease } from './runtime-state.js';
export { CompanyStore, DEFAULT_BUSY_TIMEOUT_MS, STORAGE_VERSION, type HealthCounts, type OpenStoreOptions } from './store.js';
export { DEFAULT_MAX_ATTEMPTS, MAX_LINEAGE_DEPTH, defaultPropagationPolicy, type PropagationPolicy, type TerminationMode, type TerminationOutcome } from './work-core.js';
export { IDEMPOTENCY_SCOPE_CREATE, type CreateOptions, type CreateResult, type CreateWorkItemInput, type TerminationInput, type TransitionInput } from './work-items.js';
export { DATABASE_FILE, assertLocalPathSyntax, layoutFor, openWorkspace, workspaceFreeBytes, type WorkspaceLayout } from './workspace.js';
