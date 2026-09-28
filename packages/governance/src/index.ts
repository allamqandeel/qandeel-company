/**
 * @qandeel-company/governance — the C2 governance kernel.
 *
 * Pure, deterministic policy with no I/O: Employee identity and lifecycle, R0–R4 authority and
 * approval scope, reasoning / data classes, the provider-neutral Router Policy, checked token and
 * cost economics, the provider-adapter and tool-driver contracts and typed model proposals.
 * Persistence lives in @qandeel-company/storage; execution in @qandeel-company/runtime.
 */
export * from './authority.js';
export * from './classes.js';
export * from './economics.js';
export * from './employee.js';
export * from './organization.js';
export * from './proposals.js';
export * from './providers.js';
export * from './review.js';
export * from './routing.js';
export * from './tools.js';
