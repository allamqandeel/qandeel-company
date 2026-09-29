/**
 * @qandeel-company/runtime — the C1 durable Company runtime.
 *
 * Runtime Supervisor, bounded worker pool, event-driven wake-up, startup recovery, graceful
 * shutdown, health/readiness and deterministic processors. It makes zero model/provider calls,
 * opens no network listener and executes no external tools.
 */
export { DETERMINISTIC_PROCESSORS, ProcessorRegistry, noopProcessor, stepsProcessor, type StepsInput } from './deterministic-processors.js';
export { LOW_DISK_BYTES, inspectWorkspace, runtimeHealth, type HealthSnapshot, type HealthStatus, type ReadinessChecks } from './health.js';
export { Logger, errorCode, jsonLinesSink, silentLogger, type LogFields, type LogLevel, type LogRecord, type LogSink } from './logger.js';
// runRecovery is internal: recovery writes belong to the Runtime Supervisor alone (D-C1-22).
export type { RecoverySummary } from './recovery.js';
export { CompanyRuntime, RUNTIME_VERSION, type FounderAdmin, type GovernanceAdmin, type MindAdmin, type OrgAdmin, type ArtifactReadView, type EventHandler, type RuntimeDiagnostics, type RuntimeFaultPoint, type RuntimeOptions, type RuntimeState } from './runtime.js';
export { WakeSignal, notifyRuntime } from './wake.js';
// C2 governed execution: the only model-call and tool-driver paths, plus deterministic fakes.
export { DeterministicFakeProvider, FakeToolDriver } from './c2/deterministic-fakes.js';
export { EMPLOYEE_TASK_KIND, employeeTaskProcessor, type EmployeeTaskInput } from './c2/employee-task.js';
export { isGovernedProcessor, type GovernedProcessor, type GovernedRunServices, type ModelCallOutcome, type ModelCallRequest, type ToolOutcome, type ToolRequest } from './c2/types.js';
// C3: health counts (content-free). The context assembler and memory proposal path are internal to the
// runtime: a processor reaches them only through its bound GovernedRunServices.
export type { C3Health } from './c3/health.js';
export type { MemoryProposal, MemoryProposalOutcome } from './c2/types.js';
// C5: the Founder surface's proposal types (a message never carries authority; a goal act is fenced).
export type { GoalActOutcome, GoalActProposal, MessageOutcome, MessageProposal } from './c2/types.js';
export type { C4Health } from './c4/health.js';
