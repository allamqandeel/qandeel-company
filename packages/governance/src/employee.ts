/**
 * Persistent Employee identity and lifecycle (Stage 4). An Employee is a durable Company entity,
 * independent of provider, model, session, run, process and task (Employee != Model != Session !=
 * Run != Process). Nothing here names a model.
 */
import { QandeelError, boundedJson, boundedText } from '@qandeel-company/domain';

import { REASONING_CLASSES, assertReasoningClass, reasoningRank, type ReasoningClass } from './classes.js';

/** Stage 4 §8: Candidate → Training → Shadow / Probation → Active, plus the additional states. */
export const EMPLOYEE_STATES = ['CANDIDATE', 'TRAINING', 'SHADOW', 'PROBATION', 'ACTIVE', 'PAUSED', 'ON_LEAVE', 'RETRAINING', 'SUSPENDED', 'RETIRED'] as const;
export type EmployeeState = (typeof EMPLOYEE_STATES)[number];

const TRANSITIONS: Readonly<Record<EmployeeState, readonly EmployeeState[]>> = {
  CANDIDATE: ['TRAINING', 'RETIRED'],
  TRAINING: ['SHADOW', 'PROBATION', 'SUSPENDED', 'RETIRED'],
  SHADOW: ['PROBATION', 'ACTIVE', 'TRAINING', 'SUSPENDED', 'RETIRED'],
  PROBATION: ['ACTIVE', 'TRAINING', 'SUSPENDED', 'RETIRED'],
  ACTIVE: ['PAUSED', 'ON_LEAVE', 'RETRAINING', 'SUSPENDED', 'RETIRED'],
  PAUSED: ['ACTIVE', 'RETRAINING', 'SUSPENDED', 'RETIRED'],
  ON_LEAVE: ['ACTIVE', 'SUSPENDED', 'RETIRED'],
  // Retraining re-enters through Shadow / Probation: it never jumps straight back to Active.
  RETRAINING: ['SHADOW', 'PROBATION', 'SUSPENDED', 'RETIRED'],
  // A suspension is lifted only through retraining (Stage 3 §9: autonomy reduction → retraining).
  SUSPENDED: ['RETRAINING', 'RETIRED'],
  // Retired / Former Employee is permanent; history and attribution remain (Stage 4 §14).
  RETIRED: [],
};

export function isEmployeeState(v: unknown): v is EmployeeState {
  return typeof v === 'string' && (EMPLOYEE_STATES as readonly string[]).includes(v);
}

export function canTransitionEmployee(from: EmployeeState, to: EmployeeState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertEmployeeTransition(from: EmployeeState, to: EmployeeState): void {
  if (from === 'RETIRED') throw new QandeelError('TERMINAL_STATE', 'a retired employee never changes state again', { from, to });
  if (!canTransitionEmployee(from, to)) throw new QandeelError('INVALID_TRANSITION', `${from} -> ${to} is not an allowed employee transition`, { from, to });
}

/**
 * Only an ACTIVE employee may execute work (Stage 4 §8: no employee enters active duty before
 * required training/certification; Stage 7 §17 eligibility gate). Shadow / probation execution is
 * Academy-controlled (C3) and is not granted here.
 */
export function canExecute(state: EmployeeState): boolean {
  return state === 'ACTIVE';
}

/**
 * Entering ACTIVE fails closed unless qualification evidence references exist. C2 cannot verify
 * certification (the Academy is C3): it records opaque evidence refs attested by the Founder and
 * never claims they prove certification.
 */
export function assertActivationEvidence(qualificationRefs: readonly string[]): void {
  if (qualificationRefs.length === 0) {
    throw new QandeelError('EMPLOYEE_NOT_ELIGIBLE', 'activation requires qualification evidence references (Academy certification is C3; none is assumed)', { reason: 'QUALIFICATION_EVIDENCE_MISSING' });
  }
}

// --- Identity package --------------------------------------------------------------------------

/**
 * One name part: Unicode letters/marks, optionally with an inner hyphen, apostrophe or one space
 * for compound given names (e.g. "عبد الرحمن"). Digits, emoji and control characters are refused.
 */
const NAME_PART = /^\p{L}[\p{L}\p{M}'’-]*(?: \p{L}[\p{L}\p{M}'’-]*)?$/u;

export interface EmployeeName {
  /** Given name (first part). */
  readonly given: string;
  /** Family name (second part). */
  readonly family: string;
}

/** Stage 1 §4 / Stage 4 §2: a distinct Egyptian two-part human-style name. */
export function assertEmployeeName(name: unknown): EmployeeName {
  const n = name as Partial<EmployeeName> | null;
  if (typeof n !== 'object' || n === null) throw new QandeelError('VALIDATION_FAILED', 'name must be { given, family }', { field: 'name' });
  const parts = [boundedText(n.given, 'name.given', 40), boundedText(n.family, 'name.family', 40)];
  for (const [i, p] of parts.entries()) {
    if (p.trim() !== p || p.length < 2 || !NAME_PART.test(p)) throw new QandeelError('VALIDATION_FAILED', 'each name part is a human-style name (letters only)', { field: i === 0 ? 'name.given' : 'name.family' });
  }
  return { given: parts[0] as string, family: parts[1] as string };
}

export const COST_DISCIPLINES = ['STRICT', 'BALANCED', 'THOROUGH'] as const;
export type CostDiscipline = (typeof COST_DISCIPLINES)[number];

/**
 * Cognitive / Reasoning Profile (Stage 4 §6), independent of any model. `defaultClass` is the
 * intended minimum-sufficient starting point; `ceilingClass` is the highest class this employee's
 * work may ever reach (escalation and routing can never exceed it).
 */
export interface CognitiveProfile {
  readonly defaultClass: ReasoningClass;
  readonly ceilingClass: ReasoningClass;
  readonly costDiscipline: CostDiscipline;
}

export function assertCognitiveProfile(v: unknown): CognitiveProfile {
  const p = v as Partial<CognitiveProfile> | null;
  if (typeof p !== 'object' || p === null) throw new QandeelError('VALIDATION_FAILED', 'cognitive profile must be an object', { field: 'cognitiveProfile' });
  const defaultClass = assertReasoningClass(p.defaultClass, 'cognitiveProfile.defaultClass');
  const ceilingClass = assertReasoningClass(p.ceilingClass, 'cognitiveProfile.ceilingClass');
  if (reasoningRank(ceilingClass) < reasoningRank(defaultClass)) throw new QandeelError('VALIDATION_FAILED', 'ceilingClass must be at or above defaultClass', { field: 'cognitiveProfile.ceilingClass' });
  if (!(COST_DISCIPLINES as readonly string[]).includes(String(p.costDiscipline))) throw new QandeelError('VALIDATION_FAILED', 'unknown cost discipline', { field: 'cognitiveProfile.costDiscipline' });
  return { defaultClass, ceilingClass, costDiscipline: p.costDiscipline as CostDiscipline };
}

export const DEFAULT_COGNITIVE_PROFILE: CognitiveProfile = Object.freeze({ defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' });

/**
 * Professional profile / personality metadata (Stage 4 §2–§5). Bounded JSON; credential-named keys
 * are refused. Pre-QANDEEL background is designed profile material, never real QANDEEL history
 * (Stage 4 §3), so it is stored separately from the durable history tables.
 */
export function profileJson(v: unknown): string {
  return boundedJson(v ?? {}, 'profile', 8192);
}

/** Opaque qualification evidence references (C3 owns their meaning), e.g. `academy:cert-123`. */
export const QUALIFICATION_REF = /^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._:-]{1,128}$/;

/**
 * Reference kinds reserved for later subsystems. `academy:` certificates are issued by the C3
 * Academy, which does not exist yet: C2 refuses them rather than store something that looks like
 * certification it cannot verify.
 */
export const RESERVED_QUALIFICATION_KINDS: readonly string[] = ['academy', 'certification', 'cert'];

export function assertQualificationRefs(v: unknown): string[] {
  if (!Array.isArray(v)) throw new QandeelError('VALIDATION_FAILED', 'qualification refs must be an array', { field: 'qualificationRefs' });
  if (v.length > 32) throw new QandeelError('VALIDATION_FAILED', 'too many qualification refs', { field: 'qualificationRefs' });
  return [...new Set(v.map((r, i) => {
    if (typeof r !== 'string' || !QUALIFICATION_REF.test(r)) throw new QandeelError('VALIDATION_FAILED', 'a qualification ref is "<kind>:<id>"', { field: `qualificationRefs[${i}]` });
    if (RESERVED_QUALIFICATION_KINDS.includes(r.slice(0, r.indexOf(':')))) throw new QandeelError('VALIDATION_FAILED', 'certification references belong to the C3 Academy; C2 records Founder attestation references only', { field: `qualificationRefs[${i}]` });
    return r;
  }))];
}

export { REASONING_CLASSES };
