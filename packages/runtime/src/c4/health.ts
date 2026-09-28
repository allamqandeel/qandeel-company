/**
 * C4 health (content-free): the organization, delegation and the Review Pool. Counts and reason codes
 * only — never staffing evidence, handoff messages, review rationale or instructions (Rule A).
 */
import { OrganizationStore, ReviewStore, type CompanyStore, type OrganizationHealth, type ReviewHealth } from '@qandeel-company/storage';

export interface C4Health {
  readonly organization: OrganizationHealth;
  readonly review: ReviewHealth;
}

export function c4HealthOf(store: CompanyStore): C4Health {
  return { organization: OrganizationStore.for(store).health(), review: ReviewStore.for(store).health() };
}

/**
 * Reason codes. Acting coverage past its end or a review with no eligible reviewer / no plan needs attention
 * (work cannot flow there); pending decisions and open conflicts degrade. Vacant canonical seats are reported
 * but change no status: the Founder staffs the skeleton (headcount is data, never invented).
 */
export function c4Reasons(h: C4Health | null): string[] {
  if (!h) return [];
  const r: string[] = [];
  if (h.organization.ceoSeatVacant) r.push('CEO_SEAT_VACANT');
  if (h.organization.vacantDirectorSeats > 0) r.push('DIRECTOR_SEATS_VACANT');
  if (h.organization.actingPastEnd > 0) r.push('ACTING_COVERAGE_PAST_END');
  if (h.organization.escalatedHandoffs > 0) r.push('HANDOFFS_ESCALATED');
  if (h.organization.staffingAwaitingCeo + h.organization.staffingAwaitingFounder > 0) r.push('STAFFING_DECISIONS_PENDING');
  if (h.review.waitingForReviewer > 0) r.push('REVIEWER_UNAVAILABLE');
  if (h.review.waitingForPlan > 0) r.push('REVIEW_PLAN_MISSING');
  if (h.review.conflictsOpen > 0) r.push('REVIEW_CONFLICTS_OPEN');
  if (h.review.escalated > 0) r.push('REVIEWS_ESCALATED');
  if (h.review.qualityHoldsActive > 0) r.push('QUALITY_HOLDS_ACTIVE');
  if (h.review.findingsOpen > 0) r.push('OVERSIGHT_FINDINGS_OPEN');
  return r;
}

export const C4_DEGRADED: readonly string[] = ['HANDOFFS_ESCALATED', 'STAFFING_DECISIONS_PENDING', 'REVIEW_CONFLICTS_OPEN', 'REVIEWS_ESCALATED', 'QUALITY_HOLDS_ACTIVE', 'OVERSIGHT_FINDINGS_OPEN'];
export const C4_ATTENTION: readonly string[] = ['ACTING_COVERAGE_PAST_END', 'REVIEWER_UNAVAILABLE', 'REVIEW_PLAN_MISSING'];
