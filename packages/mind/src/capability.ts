/**
 * Capability Requirements and the Eligibility Gate (Stage 7 §16–§17, §20). Pure and deterministic.
 *
 * A Work Item may require Skills at a minimum proficiency, a role Certification, market / domain
 * capability and Tool capability. Eligibility is evaluated BEFORE any model or tool call; if the
 * owning Employee does not satisfy it, the runtime never substitutes the "nearest" Employee: it
 * records a durable Capability Gap and parks the work with a typed reason.
 *
 * Tool capability is only CHECKED here (read-only, against C2 grants): it never grants a tool, and
 * a Skill never satisfies a tool requirement, nor a tool grant a Skill requirement.
 */
import { QandeelError, type Timestamp } from '@qandeel-company/domain';
import { CAPABILITY } from '@qandeel-company/governance';

import { assertProficiency, proficiencyRank, type Proficiency } from './skills.js';

export type CapabilityRequirement =
  | { readonly kind: 'SKILL'; readonly skillId: string; readonly minProficiency: Proficiency }
  | { readonly kind: 'CERTIFICATION'; readonly roleRef: string }
  | { readonly kind: 'MARKET'; readonly marketCode: string; readonly minProficiency: Proficiency }
  | { readonly kind: 'TOOL'; readonly capability: string };

const ROLE_REF = /^role:[A-Za-z0-9._:-]{1,128}$/;
const MARKET_CODE = /^[a-z][a-z0-9-]{1,31}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function assertRequirements(v: unknown): CapabilityRequirement[] {
  if (!Array.isArray(v) || v.length > 16) throw new QandeelError('VALIDATION_FAILED', 'capability requirements are a list of at most 16', { field: 'requirements' });
  return v.map((r, i) => {
    const o = r as Record<string, unknown> | null;
    const field = `requirements[${i}]`;
    if (typeof o !== 'object' || o === null) throw new QandeelError('VALIDATION_FAILED', 'a requirement is an object', { field });
    switch (o.kind) {
      case 'SKILL':
        if (typeof o.skillId !== 'string' || !ID.test(o.skillId)) throw new QandeelError('VALIDATION_FAILED', 'SKILL requires a skillId', { field });
        return { kind: 'SKILL', skillId: o.skillId, minProficiency: assertProficiency(o.minProficiency, `${field}.minProficiency`) };
      case 'CERTIFICATION':
        if (typeof o.roleRef !== 'string' || !ROLE_REF.test(o.roleRef)) throw new QandeelError('VALIDATION_FAILED', 'CERTIFICATION requires a role ref', { field });
        return { kind: 'CERTIFICATION', roleRef: o.roleRef };
      case 'MARKET':
        if (typeof o.marketCode !== 'string' || !MARKET_CODE.test(o.marketCode)) throw new QandeelError('VALIDATION_FAILED', 'MARKET requires a market code', { field });
        return { kind: 'MARKET', marketCode: o.marketCode, minProficiency: assertProficiency(o.minProficiency, `${field}.minProficiency`) };
      case 'TOOL':
        if (typeof o.capability !== 'string' || !CAPABILITY.test(o.capability) || !o.capability.startsWith('tool:')) throw new QandeelError('VALIDATION_FAILED', 'TOOL requires a tool capability', { field });
        return { kind: 'TOOL', capability: o.capability };
      default:
        throw new QandeelError('VALIDATION_FAILED', 'unknown requirement kind', { field });
    }
  });
}

export interface PassportView {
  readonly skillId: string;
  readonly versionId: string;
  readonly proficiency: Proficiency;
  readonly status: 'ACTIVE' | 'RECERTIFICATION_REQUIRED' | 'SUSPENDED' | 'REVOKED';
  /** Production eligibility of the pinned version (C3 pipeline / license / security / freshness). */
  readonly versionEligible: boolean;
  /** Market this skill covers, when it is a market / domain capability. */
  readonly marketCode: string | null;
}

export interface CertificationView {
  readonly roleRef: string;
  readonly status: 'VALID' | 'REVIEW_DUE' | 'EXPIRED' | 'REVOKED' | 'SUPERSEDED';
  readonly validUntil: Timestamp | null;
}

export interface EligibilitySnapshot {
  readonly passport: readonly PassportView[];
  readonly certifications: readonly CertificationView[];
  /** Tool capabilities currently covered by an ACTIVE C2 grant (read-only). */
  readonly grantedToolCapabilities: readonly string[];
  /** Skills that have at least one production-eligible version in the Registry. */
  readonly skillsWithEligibleVersion: readonly string[];
  readonly now: Timestamp;
}

export const GAP_CODES = ['SKILL_MISSING', 'PROFICIENCY_BELOW', 'SKILL_VERSION_INELIGIBLE', 'PASSPORT_NOT_ACTIVE', 'CERTIFICATION_MISSING', 'CERTIFICATION_NOT_VALID', 'MARKET_MISSING', 'TOOL_ACCESS_MISSING'] as const;
export type GapCode = (typeof GAP_CODES)[number];

export const GAP_SUGGESTIONS = ['TRAINING', 'NEW_SKILL', 'TASK_DECOMPOSITION', 'SPECIALIST_NEEDED', 'ESCALATION'] as const;
export type GapSuggestion = (typeof GAP_SUGGESTIONS)[number];

export interface GapItem {
  readonly requirementIndex: number;
  readonly kind: CapabilityRequirement['kind'];
  readonly code: GapCode;
}

export interface CapabilityDecision {
  readonly ok: boolean;
  readonly missing: readonly GapItem[];
  readonly suggestions: readonly GapSuggestion[];
}

/** A certification is valid only for its own role, while VALID and unexpired (role A never certifies role B). */
export function certificationValid(c: CertificationView, roleRef: string, now: Timestamp): boolean {
  return c.roleRef === roleRef && c.status === 'VALID' && (c.validUntil === null || c.validUntil > now);
}

export function evaluateCapability(reqs: readonly CapabilityRequirement[], s: EligibilitySnapshot): CapabilityDecision {
  const missing: GapItem[] = [];
  const suggestions = new Set<GapSuggestion>();
  const skillCheck = (i: number, kind: 'SKILL' | 'MARKET', entries: readonly PassportView[], min: Proficiency, skillIds: readonly string[]): void => {
    if (entries.length === 0) {
      missing.push({ requirementIndex: i, kind, code: kind === 'MARKET' ? 'MARKET_MISSING' : 'SKILL_MISSING' });
      suggestions.add(skillIds.some((id) => s.skillsWithEligibleVersion.includes(id)) ? 'TRAINING' : 'NEW_SKILL');
      if (kind === 'SKILL' && skillIds.some((id) => s.skillsWithEligibleVersion.includes(id))) suggestions.add('SPECIALIST_NEEDED');
      return;
    }
    const usable = entries.filter((e) => e.status === 'ACTIVE' && e.versionEligible && proficiencyRank(e.proficiency) >= proficiencyRank(min));
    if (usable.length > 0) return;
    if (entries.some((e) => e.status !== 'ACTIVE')) {
      missing.push({ requirementIndex: i, kind, code: 'PASSPORT_NOT_ACTIVE' });
      suggestions.add('TRAINING');
    } else if (entries.some((e) => !e.versionEligible)) {
      missing.push({ requirementIndex: i, kind, code: 'SKILL_VERSION_INELIGIBLE' });
      suggestions.add('ESCALATION');
    } else {
      missing.push({ requirementIndex: i, kind, code: 'PROFICIENCY_BELOW' });
      suggestions.add('TRAINING');
    }
  };
  reqs.forEach((r, i) => {
    switch (r.kind) {
      case 'SKILL':
        skillCheck(i, 'SKILL', s.passport.filter((p) => p.skillId === r.skillId), r.minProficiency, [r.skillId]);
        break;
      case 'MARKET': {
        const entries = s.passport.filter((p) => p.marketCode === r.marketCode);
        skillCheck(i, 'MARKET', entries, r.minProficiency, entries.map((e) => e.skillId));
        break;
      }
      case 'CERTIFICATION': {
        const forRole = s.certifications.filter((c) => c.roleRef === r.roleRef);
        if (forRole.some((c) => certificationValid(c, r.roleRef, s.now))) break;
        missing.push({ requirementIndex: i, kind: 'CERTIFICATION', code: forRole.length === 0 ? 'CERTIFICATION_MISSING' : 'CERTIFICATION_NOT_VALID' });
        suggestions.add('TRAINING');
        break;
      }
      case 'TOOL':
        if (!s.grantedToolCapabilities.includes(r.capability)) {
          missing.push({ requirementIndex: i, kind: 'TOOL', code: 'TOOL_ACCESS_MISSING' });
          suggestions.add('ESCALATION');
        }
        break;
    }
  });
  if (missing.length >= 3) suggestions.add('TASK_DECOMPOSITION');
  return { ok: missing.length === 0, missing, suggestions: [...suggestions].sort() };
}
