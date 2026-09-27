import { QandeelError } from '@qandeel-company/domain';

/**
 * QANDEEL internal reasoning classes (Stage 13 D13-A.3). Provider-independent: a class names how
 * much reasoning a step needs, never which model provides it.
 *   E0 NO_LLM (deterministic)  E1 LIGHT  E2 STANDARD  E3 DEEP  E4 EXTENDED
 */
export const REASONING_CLASSES = ['E0', 'E1', 'E2', 'E3', 'E4'] as const;
export type ReasoningClass = (typeof REASONING_CLASSES)[number];

/**
 * Data classes (Stage 14 D14-B). The highest class in an outbound context governs egress.
 *   D0 PUBLIC  D1 INTERNAL  D2 CONFIDENTIAL  D3 RESTRICTED  D4 SOVEREIGN / SECRET
 */
export const DATA_CLASSES = ['D0', 'D1', 'D2', 'D3', 'D4'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const reasoningRank = (c: ReasoningClass): number => REASONING_CLASSES.indexOf(c);
export const dataRank = (c: DataClass): number => DATA_CLASSES.indexOf(c);

export function isReasoningClass(v: unknown): v is ReasoningClass {
  return typeof v === 'string' && (REASONING_CLASSES as readonly string[]).includes(v);
}

export function isDataClass(v: unknown): v is DataClass {
  return typeof v === 'string' && (DATA_CLASSES as readonly string[]).includes(v);
}

export function assertReasoningClass(v: unknown, field: string): ReasoningClass {
  if (!isReasoningClass(v)) throw new QandeelError('VALIDATION_FAILED', `${field} must be one of ${REASONING_CLASSES.join(', ')}`, { field });
  return v;
}

export function assertDataClass(v: unknown, field: string): DataClass {
  if (!isDataClass(v)) throw new QandeelError('VALIDATION_FAILED', `${field} must be one of ${DATA_CLASSES.join(', ')}`, { field });
  return v;
}

/** The highest (most sensitive) of the given data classes. */
export function maxDataClass(...classes: readonly DataClass[]): DataClass {
  return classes.reduce<DataClass>((a, b) => (dataRank(b) > dataRank(a) ? b : a), 'D0');
}

/** Task classes are short dotted codes owned by the route policy (e.g. `draft.internal-memo`). */
export const TASK_CLASS = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,7}$/;

export function assertTaskClass(v: unknown, field = 'taskClass'): string {
  if (typeof v !== 'string' || v.length > 64 || !TASK_CLASS.test(v)) throw new QandeelError('VALIDATION_FAILED', `${field} must be a short dotted code`, { field });
  return v;
}

/** Catalog codes (providers, models, deployments, tools, actions, departments). */
export const CATALOG_CODE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,7}$/;

export function assertCatalogCode(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length > 64 || !CATALOG_CODE.test(v)) throw new QandeelError('VALIDATION_FAILED', `${field} must be a short lower-case code`, { field });
  return v;
}
