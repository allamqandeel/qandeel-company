/**
 * Tool Registry contracts (Stage 7 §14–15, Stage 12 §11/§50–51, Stage 14 D14-B.7).
 *
 * Skill ≠ Tool; having a Skill grants no Tool. A tool is a named, reviewed action surface with a
 * fixed risk, side-effect/replay class, capability, data-class ceiling and argument schema. There is
 * no generic shell or "execute anything" tool, and a driver is invoked only by the Tool Executor.
 */
import { QandeelError, boundedJson, type JsonObject, type JsonValue, type RiskLevel, type SideEffectClass } from '@qandeel-company/domain';

import { assertCatalogCode, type DataClass } from './classes.js';

/** Tool / action codes that would name a generic execution surface are refused outright. */
const FORBIDDEN_TOOL_WORDS = /(?:^|[.-])(?:shell|exec|execute|eval|cmd|command|powershell|pwsh|bash|zsh|sh|spawn|system|run-anything|anything|script|terminal|sudo)(?:$|[.-])/;

export function assertToolCode(v: unknown, field: string): string {
  const code = assertCatalogCode(v, field);
  if (FORBIDDEN_TOOL_WORDS.test(code)) throw new QandeelError('VALIDATION_FAILED', 'generic execution tools are not permitted (no shell / execute-anything surface)', { field });
  return code;
}

/** Where a tool's effect lands; EXTERNAL makes a new, independent egress decision (D14-B.7). */
export const TOOL_EGRESS = ['NONE', 'EXTERNAL'] as const;
export type ToolEgress = (typeof TOOL_EGRESS)[number];

export type ArgType = 'string' | 'integer' | 'boolean';
export interface ArgField {
  readonly type: ArgType;
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
}
export interface ArgsSchema {
  readonly fields: Readonly<Record<string, ArgField>>;
}

export function assertArgsSchema(v: unknown): ArgsSchema {
  const s = v as Partial<ArgsSchema> | null;
  if (typeof s !== 'object' || s === null || typeof s.fields !== 'object' || s.fields === null) throw new QandeelError('VALIDATION_FAILED', 'argsSchema must be { fields }', { field: 'argsSchema' });
  const names = Object.keys(s.fields);
  if (names.length > 32) throw new QandeelError('VALIDATION_FAILED', 'too many argument fields', { field: 'argsSchema' });
  for (const n of names) {
    if (!/^[a-z][A-Za-z0-9]{0,31}$/.test(n)) throw new QandeelError('VALIDATION_FAILED', 'argument names are short identifiers', { field: 'argsSchema' });
    const f = (s.fields as Record<string, ArgField>)[n] as ArgField;
    if (!['string', 'integer', 'boolean'].includes(f.type)) throw new QandeelError('VALIDATION_FAILED', 'argument types are string, integer or boolean', { field: `argsSchema.${n}` });
  }
  boundedJson(s, 'argsSchema', 4096);
  return { fields: s.fields };
}

/** Strict argument validation: unknown keys, wrong types and oversize values are refused. */
export function validateArgs(schema: ArgsSchema, args: unknown): JsonObject {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new QandeelError('VALIDATION_FAILED', 'tool arguments must be an object', { field: 'args' });
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(args)) {
    const f = schema.fields[k];
    if (!f) throw new QandeelError('VALIDATION_FAILED', 'unknown tool argument', { field: `args.${k.slice(0, 32)}` });
    if (f.type === 'string' && !(typeof v === 'string' && v.length <= (f.maxLength ?? 1024))) throw new QandeelError('VALIDATION_FAILED', 'string argument invalid', { field: `args.${k}` });
    if (f.type === 'integer' && !(typeof v === 'number' && Number.isSafeInteger(v) && v >= (f.min ?? -Number.MAX_SAFE_INTEGER) && v <= (f.max ?? Number.MAX_SAFE_INTEGER))) throw new QandeelError('VALIDATION_FAILED', 'integer argument invalid', { field: `args.${k}` });
    if (f.type === 'boolean' && typeof v !== 'boolean') throw new QandeelError('VALIDATION_FAILED', 'boolean argument invalid', { field: `args.${k}` });
    out[k] = v as JsonValue;
  }
  for (const [k, f] of Object.entries(schema.fields)) if (f.required && !(k in out)) throw new QandeelError('VALIDATION_FAILED', 'required tool argument missing', { field: `args.${k}` });
  boundedJson(out, 'args', 8192);
  return out;
}

export interface ToolActionDefinition {
  readonly toolCode: string;
  readonly actionCode: string;
  readonly risk: RiskLevel;
  readonly sideEffects: SideEffectClass;
  /** Mutates something outside Company state (external record, publication, payment…). */
  readonly mutatesExternal: boolean;
  readonly dataClassCeiling: DataClass;
  readonly egress: ToolEgress;
  readonly argsSchema: ArgsSchema;
  /** Internal economic cost per call (money micros; 0 allowed). */
  readonly costPerCallMicros: number;
}

/**
 * Consistency rules for an action definition: an external mutation is never side-effect-free, it
 * always needs an idempotency key, and it is at least R3 in Strong v1 (Stage 3 §2: sensitive /
 * external action). An R0 action is read-only.
 */
export function assertActionConsistency(a: Pick<ToolActionDefinition, 'risk' | 'sideEffects' | 'mutatesExternal' | 'egress'>): void {
  if (a.mutatesExternal && a.sideEffects === 'NONE') throw new QandeelError('VALIDATION_FAILED', 'an external mutation cannot declare side effects NONE', { field: 'sideEffects' });
  if (a.mutatesExternal && a.egress !== 'EXTERNAL') throw new QandeelError('VALIDATION_FAILED', 'an external mutation has EXTERNAL egress', { field: 'egress' });
  if (a.mutatesExternal && (a.risk === 'R0' || a.risk === 'R1')) throw new QandeelError('VALIDATION_FAILED', 'external mutations are at least R2 (sensitive / external)', { field: 'risk' });
  if (a.risk === 'R0' && a.sideEffects !== 'NONE') throw new QandeelError('VALIDATION_FAILED', 'R0 actions are read / analyze only', { field: 'risk' });
}

/** Idempotency keys are required for every external mutation (Stage 8 §40, Stage 12 §16). */
export function requiresIdempotencyKey(a: Pick<ToolActionDefinition, 'mutatesExternal' | 'sideEffects'>): boolean {
  return a.mutatesExternal || a.sideEffects !== 'NONE';
}

export interface ToolDriverInput {
  readonly actionCode: string;
  readonly args: JsonObject;
  readonly idempotencyKey: string;
}

export type ToolDriverResult =
  | { readonly ok: true; readonly result: JsonObject }
  | { readonly ok: false; readonly code: string; readonly sent: 'NO' | 'UNKNOWN' };

/**
 * A tool driver: the only code that performs a tool's effect. Drivers are handed to the Tool
 * Executor at construction and are reachable from nowhere else (verifier rule).
 */
export interface ToolDriver {
  readonly driverCode: string;
  invoke(input: ToolDriverInput, signal: AbortSignal): Promise<ToolDriverResult>;
}
