/**
 * C3 health (content-free): memory, knowledge, context assembly, Skills, Academy and capability gaps.
 * Counts and reason codes only — never a memory, knowledge, skill or scenario payload (Rule A).
 */
import { AcademyStore, MemoryStore, SkillStore, type AcademyHealth, type CompanyStore, type MindHealth, type SkillHealth } from '@qandeel-company/storage';

export interface C3Health {
  readonly memory: MindHealth;
  readonly skills: SkillHealth;
  readonly academy: AcademyHealth;
}

export function c3HealthOf(store: CompanyStore): C3Health {
  return { memory: MemoryStore.for(store).healthCounts(), skills: SkillStore.for(store).healthCounts(), academy: AcademyStore.for(store).healthCounts() };
}

/** Reason codes: integrity and security need attention; conflicts, reviews and pending decisions degrade. */
export function c3Reasons(h: C3Health | null): string[] {
  if (!h) return [];
  const r: string[] = [];
  if (h.memory.memoryIntegrityFailures + h.memory.knowledgeIntegrityFailures + h.memory.canonicalIntegrityFailures > 0) r.push('MIND_INTEGRITY_FAILURE');
  if (h.memory.memoryConflictsOpen > 0) r.push('MEMORY_CONFLICTS_OPEN');
  if (h.memory.memoryStaleDue > 0) r.push('MEMORY_REVIEW_DUE');
  if (h.memory.candidatesPending > 0) r.push('MEMORY_CANDIDATES_PENDING');
  if (h.memory.lessonsAwaitingReview + h.memory.promotionsPendingReview > 0) r.push('LESSONS_AWAITING_REVIEW');
  if (h.skills.securityHolds > 0) r.push('SKILL_SECURITY_HOLD');
  if (h.skills.passportsOnIneligibleVersions > 0) r.push('PASSPORT_ON_INELIGIBLE_VERSION');
  if (h.skills.passportsRecertificationRequired > 0) r.push('RECERTIFICATION_REQUIRED');
  if (h.academy.blocked > 0) r.push('ACADEMY_BLOCKED');
  if (h.academy.activationApprovalsPending > 0) r.push('ACTIVATION_APPROVALS_PENDING');
  if (h.academy.calibrationsPending > 0) r.push('FOUNDER_CALIBRATIONS_PENDING');
  if (h.academy.capabilityGapsOpen > 0) r.push('CAPABILITY_GAPS_OPEN');
  return r;
}

export const C3_DEGRADED: readonly string[] = ['MEMORY_CONFLICTS_OPEN', 'MEMORY_REVIEW_DUE', 'MEMORY_CANDIDATES_PENDING', 'LESSONS_AWAITING_REVIEW', 'RECERTIFICATION_REQUIRED', 'FOUNDER_CALIBRATIONS_PENDING'];
export const C3_ATTENTION: readonly string[] = ['MIND_INTEGRITY_FAILURE', 'SKILL_SECURITY_HOLD', 'PASSPORT_ON_INELIGIBLE_VERSION', 'ACADEMY_BLOCKED', 'ACTIVATION_APPROVALS_PENDING', 'CAPABILITY_GAPS_OPEN'];
