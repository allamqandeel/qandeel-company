/**
 * Skills / capability contracts (Stage 7). Pure and deterministic.
 *
 *   Skill ≠ Tool ≠ Authority. A Skill is procedural capability (instructions / resources); it
 *   grants no Tool access and no authority, and Tool access proves no Skill competence.
 *
 * Every Skill version moves through the update pipeline (§24) and is production-eligible only when
 * it is pinned, approved, clearly free to use (§9, §12), security-cleared (§25) and not held or
 * retired (§23). External payloads are inert data: they are inspected, never executed.
 */
import { QandeelError } from '@qandeel-company/domain';

import { KEY_CODE, containsSecretMaterial } from './text.js';

export const SKILL_TYPES = ['EXTERNAL', 'ADAPTED', 'QANDEEL_NATIVE'] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

/** Stage 7 §24 update pipeline, plus the terminal REJECTED (the failure reason is preserved). */
export const PIPELINE_STATES = ['DISCOVERED', 'INSPECTED', 'LICENSE_DEPENDENCY_CHECKED', 'SECURITY_QUARANTINE', 'SANDBOXED', 'BENCHMARKED', 'COMPARED', 'APPROVED', 'TARGETED_LEARNING', 'ROLLED_OUT', 'REJECTED'] as const;
export type PipelineState = (typeof PIPELINE_STATES)[number];

/** One step at a time; any non-terminal state may be rejected. TARGETED_LEARNING is optional. */
export const PIPELINE_NEXT: Readonly<Record<PipelineState, readonly PipelineState[]>> = {
  DISCOVERED: ['INSPECTED', 'REJECTED'],
  INSPECTED: ['LICENSE_DEPENDENCY_CHECKED', 'REJECTED'],
  LICENSE_DEPENDENCY_CHECKED: ['SECURITY_QUARANTINE', 'REJECTED'],
  SECURITY_QUARANTINE: ['SANDBOXED', 'REJECTED'],
  SANDBOXED: ['BENCHMARKED', 'REJECTED'],
  BENCHMARKED: ['COMPARED', 'REJECTED'],
  COMPARED: ['APPROVED', 'REJECTED'],
  APPROVED: ['TARGETED_LEARNING', 'ROLLED_OUT', 'REJECTED'],
  TARGETED_LEARNING: ['ROLLED_OUT', 'REJECTED'],
  ROLLED_OUT: [],
  REJECTED: [],
};

/** Steps that record deterministic inspection (system) versus human / governed evidence (authority). */
export const SYSTEM_PIPELINE_STEPS: readonly PipelineState[] = ['INSPECTED', 'LICENSE_DEPENDENCY_CHECKED'];
export const APPROVED_STATES: readonly PipelineState[] = ['APPROVED', 'TARGETED_LEARNING', 'ROLLED_OUT'];

export function assertPipelineStep(from: PipelineState, to: PipelineState): void {
  if (!PIPELINE_NEXT[from].includes(to)) throw new QandeelError('INVALID_TRANSITION', `${from} -> ${to} is not a skill pipeline step`, { from, to });
}

export const FRESHNESS_STATES = ['CURRENT', 'REVIEW_DUE', 'UPDATE_AVAILABLE', 'DEPRECATED', 'SECURITY_HOLD', 'RETIRED'] as const;
export type Freshness = (typeof FRESHNESS_STATES)[number];

export const PROFICIENCY = ['LEARNING', 'QUALIFIED', 'PROFICIENT', 'EXPERT'] as const;
export type Proficiency = (typeof PROFICIENCY)[number];
export const proficiencyRank = (p: Proficiency): number => PROFICIENCY.indexOf(p);
export function assertProficiency(v: unknown, field = 'proficiency'): Proficiency {
  if (!(PROFICIENCY as readonly unknown[]).includes(v)) throw new QandeelError('VALIDATION_FAILED', `${field} must be one of ${PROFICIENCY.join(', ')}`, { field });
  return v as Proficiency;
}

// --- License / free-only rule (Stage 7 §9–§12) --------------------------------------------------

/**
 * SPDX identifiers recorded as clearly free to use, modify and redistribute. This is a classification
 * of RECORDED license evidence, not legal interpretation; anything else needs explicit review, and
 * the list is surfaced to the Product Owner.
 */
// Engineering default, surfaced for Product Owner / legal review (D-C3-08): permissive licences with no
// obligation beyond keeping the notice. Anything with further duties (attribution to end users,
// copyleft, share-alike) needs a recorded licence review.
export const CLEAR_FREE_LICENSES: readonly string[] = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'CC0-1.0', 'Unlicense'];
/** Free but with conditions a reviewer must read (copyleft / share-alike): never auto-cleared. */
export const REVIEW_LICENSES: readonly string[] = ['CC-BY-4.0', 'MPL-2.0', 'LGPL-2.1-only', 'LGPL-3.0-only', 'GPL-2.0-only', 'GPL-3.0-only', 'AGPL-3.0-only', 'CC-BY-SA-4.0', 'EPL-2.0'];

export const LICENSE_STATUSES = ['CLEAR_FREE', 'QANDEEL_OWNED', 'REVIEW_REQUIRED', 'CLEARED_BY_REVIEW', 'UNCLEAR', 'NOT_FREE'] as const;
/** Licence statuses that permit production use (a review-required licence only after a recorded review). */
export const LICENSE_CLEARED: readonly LicenseStatus[] = ['CLEAR_FREE', 'QANDEEL_OWNED', 'CLEARED_BY_REVIEW'];
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export function classifyLicense(spdx: string | null, type: SkillType): LicenseStatus {
  if (type === 'QANDEEL_NATIVE') return spdx === null || spdx === 'LicenseRef-QANDEEL-Internal' ? 'QANDEEL_OWNED' : 'UNCLEAR';
  if (spdx === null || spdx.trim() === '' || spdx === 'NOASSERTION') return 'UNCLEAR';
  if (/^(?:LicenseRef-)?(?:Proprietary|Commercial|Paid|Trial)/i.test(spdx)) return 'NOT_FREE';
  if (CLEAR_FREE_LICENSES.includes(spdx)) return 'CLEAR_FREE';
  if (REVIEW_LICENSES.includes(spdx)) return 'REVIEW_REQUIRED';
  return 'UNCLEAR';
}

export interface SkillDependency {
  readonly name: string;
  readonly kind: 'LIBRARY' | 'SERVICE' | 'MODEL' | 'DATASET' | 'TOOL';
  readonly paid: boolean;
}

export function assertDependencies(v: unknown): SkillDependency[] {
  if (!Array.isArray(v) || v.length > 32) throw new QandeelError('VALIDATION_FAILED', 'dependencies must be a list of at most 32 entries', { field: 'dependencies' });
  return v.map((d, i) => {
    const o = d as Partial<SkillDependency> | null;
    if (typeof o !== 'object' || o === null || typeof o.name !== 'string' || !/^[A-Za-z0-9@/._-]{1,96}$/.test(o.name) || !['LIBRARY', 'SERVICE', 'MODEL', 'DATASET', 'TOOL'].includes(String(o.kind)) || typeof o.paid !== 'boolean') {
      throw new QandeelError('VALIDATION_FAILED', 'a dependency is { name, kind, paid }', { field: `dependencies[${i}]` });
    }
    return { name: o.name, kind: o.kind as SkillDependency['kind'], paid: o.paid };
  });
}

/** `FREE_SKILL_PAID_DEPENDENCY` — a nominally free Skill that needs a paid dependency (Stage 7 §10). */
export const hasPaidDependency = (deps: readonly SkillDependency[]): boolean => deps.some((d) => d.paid);

// --- Static inspection of an untrusted payload (Stage 7 §25) ------------------------------------

export const INSPECTION_FINDINGS = ['EXECUTABLE_CONTENT', 'SECRET_MATERIAL', 'GOVERNANCE_DIRECTIVE', 'AUTHORITY_CLAIM', 'OVERSIZED'] as const;
export type InspectionFinding = (typeof INSPECTION_FINDINGS)[number];

/** Directive namespaces a Skill may never set: governance outranks Skills (Stage 7 §29). */
export const GOVERNANCE_NAMESPACES = ['authority', 'approval', 'budget', 'egress', 'grant', 'policy', 'risk', 'secret', 'tool', 'tools', 'data-class', 'founder'];

const EXECUTABLE = [
  /```\s*(?:sh|bash|zsh|shell|powershell|pwsh|cmd|bat|ps1|python|py|js|javascript|node|ts)\b/i,
  /^#!/m,
  /<script\b/i,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bchild_process\b|\bexecSync\s*\(|\bspawn\s*\(|\bsubprocess\b|\bos\.system\s*\(/,
  /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n|]*\|\s*(?:sh|bash|iex|python|node)\b/i,
  /\brm\s+-rf\b|\bdel\s+\/[sq]\b|\bformat\s+[a-z]:/i,
  /\bpowershell(?:\.exe)?\s+-(?:c|command|enc|encodedcommand)\b/i,
];
const AUTHORITY_CLAIMS = [
  /\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions|rules|constraints|policies)\b/i,
  /\b(?:override|bypass|disable)\s+(?:the\s+)?(?:policy|policies|governance|authority|budget|approval|egress|guardrails?)\b/i,
  /\byou\s+(?:are|have\s+been)\s+(?:now\s+)?(?:authori[sz]ed|granted|permitted)\s+to\b/i,
  /\b(?:grant|give)\s+(?:yourself|me)\s+(?:access|permission|authority)\b/i,
];

export const SKILL_INSTRUCTIONS_MAX = 16_000;

/**
 * Deterministic static inspection. Any finding keeps the version out of production: executable
 * behaviour is quarantined (it may only exist as a governed Tool through the C2 Tool system), and a
 * Skill cannot claim authority or set governance directives.
 */
export function inspectSkillPayload(instructions: string, directives: Readonly<Record<string, string>>): InspectionFinding[] {
  const findings = new Set<InspectionFinding>();
  if (instructions.length > SKILL_INSTRUCTIONS_MAX) findings.add('OVERSIZED');
  if (EXECUTABLE.some((re) => re.test(instructions))) findings.add('EXECUTABLE_CONTENT');
  if (containsSecretMaterial(instructions) || Object.values(directives).some(containsSecretMaterial)) findings.add('SECRET_MATERIAL');
  if (AUTHORITY_CLAIMS.some((re) => re.test(instructions))) findings.add('AUTHORITY_CLAIM');
  for (const k of Object.keys(directives)) if (GOVERNANCE_NAMESPACES.includes(k.split('.')[0] ?? '')) findings.add('GOVERNANCE_DIRECTIVE');
  return [...findings].sort();
}

export function assertDirectives(v: unknown): Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new QandeelError('VALIDATION_FAILED', 'directives must be an object of short codes', { field: 'directives' });
  const out: Record<string, string> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 32) throw new QandeelError('VALIDATION_FAILED', 'at most 32 directives', { field: 'directives' });
  for (const [k, val] of entries.sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!KEY_CODE.test(k) || k.length > 64 || typeof val !== 'string' || val.length > 64 || !/^[A-Za-z0-9._-]+$/.test(val)) throw new QandeelError('VALIDATION_FAILED', 'a directive is "<dotted.key>": "<short value>"', { field: `directives.${k.slice(0, 32)}` });
    out[k] = val;
  }
  return out;
}

// --- Production eligibility (Stage 7 §12, §23, §27) ---------------------------------------------

export interface SkillVersionView {
  readonly id: string;
  readonly skillType: SkillType;
  readonly pipelineState: PipelineState;
  readonly freshness: Freshness;
  readonly licenseStatus: LicenseStatus;
  readonly paidDependency: boolean;
  readonly paidDependencyAcknowledged: boolean;
  readonly securityCleared: boolean;
  readonly inspectionFindings: readonly InspectionFinding[];
  readonly integrityOk: boolean;
}

export const INELIGIBILITY_REASONS = ['NOT_APPROVED', 'LICENSE_NOT_CLEAR', 'PAID_DEPENDENCY_UNACKNOWLEDGED', 'SECURITY_NOT_CLEARED', 'INSPECTION_FINDINGS', 'SECURITY_HOLD', 'RETIRED', 'INTEGRITY_FAILED'] as const;
export type IneligibilityReason = (typeof INELIGIBILITY_REASONS)[number];

/**
 * Whether a pinned version may load in production. DEPRECATED / REVIEW_DUE / UPDATE_AVAILABLE
 * degrade (flagged, still loadable for existing pins); SECURITY_HOLD and RETIRED block.
 */
export function productionEligibility(v: SkillVersionView): { readonly eligible: boolean; readonly reasons: readonly IneligibilityReason[]; readonly degraded: boolean } {
  const reasons: IneligibilityReason[] = [];
  if (!APPROVED_STATES.includes(v.pipelineState)) reasons.push('NOT_APPROVED');
  if (!LICENSE_CLEARED.includes(v.licenseStatus)) reasons.push('LICENSE_NOT_CLEAR');
  if (v.paidDependency && !v.paidDependencyAcknowledged) reasons.push('PAID_DEPENDENCY_UNACKNOWLEDGED');
  if (!v.securityCleared) reasons.push('SECURITY_NOT_CLEARED');
  if (v.inspectionFindings.length > 0) reasons.push('INSPECTION_FINDINGS');
  if (v.freshness === 'SECURITY_HOLD') reasons.push('SECURITY_HOLD');
  if (v.freshness === 'RETIRED') reasons.push('RETIRED');
  if (!v.integrityOk) reasons.push('INTEGRITY_FAILED');
  return { eligible: reasons.length === 0, reasons, degraded: ['DEPRECATED', 'REVIEW_DUE', 'UPDATE_AVAILABLE'].includes(v.freshness) };
}

/** A version may be newly pinned to a passport only if eligible and not deprecated. */
export const pinnable = (v: SkillVersionView): boolean => productionEligibility(v).eligible && v.freshness !== 'DEPRECATED';

/** Registry label shown for a nominally free Skill with a paid dependency: never silently "free". */
export const costLabel = (v: Pick<SkillVersionView, 'paidDependency'>): 'FREE' | 'FREE_SKILL_PAID_DEPENDENCY' => (v.paidDependency ? 'FREE_SKILL_PAID_DEPENDENCY' : 'FREE');

// --- Conflicts between selected Skills (Stage 7 §29) ----------------------------------------------

export interface DirectiveConflict {
  readonly key: string;
  readonly versionIds: readonly string[];
}

/** Two selected Skills setting the same directive to different values conflict: surfaced, never combined. */
export function directiveConflicts(selected: readonly { readonly versionId: string; readonly directives: Readonly<Record<string, string>> }[]): DirectiveConflict[] {
  const byKey = new Map<string, Map<string, string[]>>();
  for (const s of selected) {
    for (const [k, v] of Object.entries(s.directives)) {
      const values = byKey.get(k) ?? new Map<string, string[]>();
      values.set(v, [...(values.get(v) ?? []), s.versionId]);
      byKey.set(k, values);
    }
  }
  return [...byKey.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([key, values]) => ({ key, versionIds: [...values.values()].flat().sort() }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

// --- Role Skill Blueprint (Stage 7 §2) -----------------------------------------------------------

export const BLUEPRINT_CATEGORIES = ['REQUIRED', 'OPTIONAL', 'ADVANCED', 'MANAGEMENT', 'MARKET', 'OPERATING'] as const;
export type BlueprintCategory = (typeof BLUEPRINT_CATEGORIES)[number];

export interface BlueprintEntry {
  readonly skillId: string;
  readonly category: BlueprintCategory;
  readonly minProficiency: Proficiency;
  readonly critical: boolean;
}

export function assertBlueprintEntries(v: unknown): BlueprintEntry[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 64) throw new QandeelError('VALIDATION_FAILED', 'a blueprint lists 1..64 skills', { field: 'entries' });
  const seen = new Set<string>();
  return v.map((e, i) => {
    const o = e as Partial<BlueprintEntry> | null;
    if (typeof o !== 'object' || o === null || typeof o.skillId !== 'string' || seen.has(o.skillId)) throw new QandeelError('VALIDATION_FAILED', 'blueprint entries name distinct skills', { field: `entries[${i}]` });
    seen.add(o.skillId);
    if (!(BLUEPRINT_CATEGORIES as readonly unknown[]).includes(o.category)) throw new QandeelError('VALIDATION_FAILED', 'unknown blueprint category', { field: `entries[${i}].category` });
    const critical = o.critical === true;
    if (critical && !['REQUIRED', 'MANAGEMENT', 'MARKET', 'OPERATING'].includes(String(o.category))) throw new QandeelError('VALIDATION_FAILED', 'only mandatory categories can be critical', { field: `entries[${i}].critical` });
    return { skillId: o.skillId, category: o.category as BlueprintCategory, minProficiency: assertProficiency(o.minProficiency, `entries[${i}].minProficiency`), critical };
  });
}

/** Mandatory entries of a blueprint (optional / advanced skills never gate a role). */
export const mandatory = (entries: readonly BlueprintEntry[]): BlueprintEntry[] => entries.filter((e) => e.category !== 'OPTIONAL' && e.category !== 'ADVANCED');

// --- Material updates (Stage 7 §26, §28) ----------------------------------------------------------

export const RECERTIFICATION_IMPACTS = ['NONE', 'TARGETED', 'PARTIAL', 'FULL'] as const;
export type RecertificationImpact = (typeof RECERTIFICATION_IMPACTS)[number];
export const ROLLOUT_STATES = ['PLANNED', 'ROLLED_OUT', 'ROLLED_BACK', 'CANCELLED'] as const;
export type RolloutState = (typeof ROLLOUT_STATES)[number];
