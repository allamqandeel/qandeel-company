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
export { CompanyRuntime, RUNTIME_VERSION, type ArtifactReadView, type EventHandler, type RuntimeDiagnostics, type RuntimeFaultPoint, type RuntimeOptions, type RuntimeState } from './runtime.js';
export { WakeSignal, notifyRuntime } from './wake.js';
