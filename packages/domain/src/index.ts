/**
 * @qandeel-company/domain — the C1 domain kernel.
 *
 * Pure contracts and rules with no I/O: stable IDs, UTC clock, Work Item / Job / Run state
 * models, retry policy, the deterministic processor contract and the durable event envelope.
 * Nothing here knows about SQLite, files, processes, models or providers.
 */
export * from './errors.js';
export * from './events.js';
export * from './execution.js';
export * from './ids.js';
export * from './time.js';
export * from './validation.js';
export * from './work-item.js';
