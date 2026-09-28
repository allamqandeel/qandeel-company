/**
 * ReviewStore — Review Plans, the dynamic Review Pool, conflicts, Quality Holds and Independent Oversight
 * over one CompanyStore (Stage 11, Stage 3 §4; D-C4-05 / D-C4-06).
 *
 * The Review Pool is a registry of qualified reviewers, never a Department: qualification is evidence —
 * a VALID C3 certification for `role:reviewer.<domain>`, clean holdout ("Gold") cases from that
 * certification's own Academy enrollment, and calibration agreement from shadow reviews — admitted to
 * independent review by the Founder. Seniority, titles and seats play no part.
 *
 * Execute ≠ Review ≠ Approve: nothing here approves an action; a review never makes R4 executable; the
 * Founder resolving a conflict or escalation acts as the Founder, not as a reviewer of their own work.
 * Founder writes fail closed without the authenticated Founder surface (D-C2-13). Reads are content-free
 * except the explicit rationale read (local governed content, never telemetry — Rule A).
 */
import { QandeelError, assertCode, assertId, boundedText, newId, type Id } from '@qandeel-company/domain';
import {
  MIN_GOLD_CASES,
  assertDataClass,
  assertReviewDomain,
  dataRank,
  isReviewOutcome,
  isReviewerLevel,
  promotionGaps,
  reviewerRoleFor,
  type DataClass,
  type ReviewOutcome,
  type ReviewerLevel,
} from '@qandeel-company/governance';
import { containsSecretMaterial } from '@qandeel-company/mind';

import { getEmployeeRow } from './governance-core.js';
import { founder, founderAdminWrite } from './governance.js';
import { effectiveDataClass } from './governed-writes.js';
import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import {
  mapFinding,
  mapQualification,
  mapQualityHold,
  mapReviewAssignment,
  mapReviewConflict,
  mapReviewDecision,
  mapReviewPlan,
  mapReviewRequest,
  type OversightFindingRecord,
  type QualityHoldRecord,
  type ReviewAssignmentRecord,
  type ReviewConflictRecord,
  type ReviewDecisionRecord,
  type ReviewPlanRecord,
  type ReviewRequestRecord,
  type ReviewerQualificationRecord,
} from './org-records.js';
import {
  activePlan,
  applyOutcome,
  currentOutputSubject,
  eligibleReviewers,
  fillAssignments,
  getRequest,
  recordCalibration,
  recordDecision,
  refillDomain,
  setRequestState,
  sweepReviews,
  txDeclarePlan,
} from './review-core.js';
import { storeContext, type CompanyStore } from './store.js';

export interface ReviewHealth {
  readonly openRequests: number;
  readonly waitingForReviewer: number;
  readonly waitingForPlan: number;
  readonly conflictsOpen: number;
  readonly escalated: number;
  readonly qualityHoldsActive: number;
  readonly findingsOpen: number;
  readonly reviewersActive: number;
  readonly reviewersCalibrating: number;
}

function qualification(ctx: StoreContext, id: Id): ReviewerQualificationRecord {
  const r = ctx.db.get('SELECT * FROM reviewer_qualifications WHERE id = ?', id);
  if (!r) throw new QandeelError('NOT_FOUND', 'reviewer qualification not found', { qualificationId: id });
  return mapQualification(r);
}

/** Clean holdout (Gold) cases of the certification's own Academy enrollment — evidence, never supplied. */
function goldCases(ctx: StoreContext, certificationId: Id): { passed: number; total: number } {
  const r = ctx.db.get<{ passed: number; total: number }>(
    `SELECT COALESCE(SUM(CASE WHEN a.outcome = 'PASS' AND a.holdout_clean = 1 THEN 1 ELSE 0 END), 0) AS passed, COUNT(*) AS total
       FROM academy_attempts a JOIN certifications c ON c.enrollment_id = a.enrollment_id
      WHERE c.id = ? AND a.holdout = 1 AND a.state = 'EVALUATED'`,
    certificationId,
  );
  return { passed: Number(r?.passed ?? 0), total: Number(r?.total ?? 0) };
}

function setMode(ctx: StoreContext, q: ReviewerQualificationRecord, to: ReviewerQualificationRecord['mode'], reasonCode: string, actorRef: string, extra: { admittedByRef?: string; gold?: { passed: number; total: number }; level?: ReviewerLevel } = {}): ReviewerQualificationRecord {
  const at = ts(ctx);
  ctx.db.run(
    `UPDATE reviewer_qualifications SET mode = ?, admitted_by_ref = COALESCE(?, admitted_by_ref), gold_cases_passed = MAX(gold_cases_passed, ?), gold_cases_total = MAX(gold_cases_total, ?), level = ?,
       qualification_version = qualification_version + ?, reason_code = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
    to, extra.admittedByRef ?? null, extra.gold?.passed ?? 0, extra.gold?.total ?? 0, extra.level ?? q.level, to === 'ACTIVE' || extra.level !== undefined ? 1 : 0, reasonCode, at, q.id, q.version,
  );
  ctx.db.run('INSERT INTO reviewer_qualification_history (qualification_id, version, from_mode, to_mode, reason_code, actor_ref, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)', q.id, q.version + 1, q.mode, to, reasonCode, actorRef, at);
  appendAudit(ctx, 'review.qualification_mode', 'reviewer_qualification', q.id, { actorRef }, 'OK', reasonCode, { from: q.mode, to, employeeId: q.employeeId });
  // Open assignments of a reviewer who can no longer review are withdrawn and their keys refilled.
  if (to === 'SUSPENDED' || to === 'REVOKED') {
    for (const a of ctx.db.all(`SELECT * FROM review_assignments WHERE qualification_id = ? AND state = 'ASSIGNED'`, q.id).map(mapReviewAssignment)) {
      ctx.db.run(`UPDATE review_assignments SET state = 'WITHDRAWN', withdraw_reason = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`, `REVIEWER_${to}`, at, a.id, a.version);
      const r = getRequest(ctx, a.requestId);
      if (r.state === 'OPEN') fillAssignments(ctx, r);
    }
  }
  return qualification(ctx, q.id);
}

export class ReviewStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): ReviewStore {
    return new ReviewStore(store);
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  #admin<T>(operation: string, actorRef: string, fn: (ctx: StoreContext) => T): T {
    return founderAdminWrite(this.#store, operation, actorRef, fn);
  }

  // --- Review Plans ---------------------------------------------------------------------------------------

  /** Declares (before the first run) or supersedes a Work Item's Review Plan (Founder). */
  declarePlan(actorRef: string, workItemId: string, plan: unknown): ReviewPlanRecord {
    return this.#admin('declare review plan', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'review plan');
      return txDeclarePlan(ctx, getWorkItemRow(ctx, assertId(workItemId, 'workItemId')), plan, p.ref, null);
    });
  }

  // --- The Review Pool (qualification, calibration, admission) ------------------------------------------

  /**
   * Enters an Employee into the Review Pool of a domain in CALIBRATION mode (shadow reviews that never
   * count). Requires a VALID certification for the domain's reviewer role; the Gold cases are read from it.
   */
  admitReviewer(actorRef: string, input: { employeeId: string; domain: string; level: ReviewerLevel; maxDataClass: DataClass; reasonCode: string }): ReviewerQualificationRecord {
    return this.#admin('admit reviewer', actorRef, (ctx) => {
      const employeeId = assertId(input.employeeId, 'employeeId');
      const p = founder(ctx, actorRef, `employee:${employeeId}`, 'reviewer qualification');
      const domain = assertReviewDomain(input.domain);
      if (!isReviewerLevel(input.level)) throw new QandeelError('VALIDATION_FAILED', 'level is QUALIFIED, SENIOR or EXPERT', { field: 'level' });
      const cls = assertDataClass(input.maxDataClass, 'maxDataClass');
      const e = getEmployeeRow(ctx, employeeId);
      if (e.state !== 'ACTIVE') throw new QandeelError('REVIEWER_NOT_ELIGIBLE', 'a reviewer is an ACTIVE Employee', { reason: 'EMPLOYEE_NOT_ACTIVE' });
      const cert = ctx.db.get<{ id: string }>(`SELECT id FROM certifications WHERE employee_id = ? AND role_ref = ? AND status = 'VALID' AND valid_until > ? ORDER BY issued_at DESC LIMIT 1`, employeeId, reviewerRoleFor(domain), ts(ctx));
      if (!cert) throw new QandeelError('REVIEWER_NOT_ELIGIBLE', `review qualification needs a VALID certification for ${reviewerRoleFor(domain)}`, { reason: 'REVIEWER_CERTIFICATION_MISSING' });
      const gold = goldCases(ctx, cert.id as Id);
      const id = newId();
      const at = ts(ctx);
      try {
        ctx.db.run(
          `INSERT INTO reviewer_qualifications (id, employee_id, domain, level, certification_id, mode, max_data_class, max_data_rank, gold_cases_passed, gold_cases_total, calibration_agreements, calibration_disagreements, qualification_version, admitted_by_ref, reason_code, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'CALIBRATION', ?, ?, ?, ?, 0, 0, 1, NULL, ?, 1, ?, ?)`,
          id, employeeId, domain, input.level, cert.id, cls, dataRank(cls), gold.passed, gold.total, assertCode(input.reasonCode, 'reasonCode'), at, at,
        );
      } catch (error) {
        if (error instanceof QandeelError && error.code === 'STORAGE_INVARIANT') throw new QandeelError('VALIDATION_FAILED', 'this Employee already has a live qualification in this domain', { field: 'domain' });
        throw error;
      }
      ctx.db.run('INSERT INTO reviewer_qualification_history (qualification_id, version, from_mode, to_mode, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, ?, ?, ?, ?)', id, 'CALIBRATION', input.reasonCode, p.ref, at);
      appendAudit(ctx, 'review.reviewer_admitted', 'reviewer_qualification', id, { actorRef: p.ref }, 'OK', input.reasonCode, { employeeId, domain, mode: 'CALIBRATION' });
      refillDomain(ctx, domain);
      return qualification(ctx, id as Id);
    });
  }

  /** CALIBRATION → ACTIVE (independent review authority) only with Gold cases and calibration evidence. */
  promoteReviewer(actorRef: string, qualificationId: string, reasonCode: string): ReviewerQualificationRecord {
    return this.#admin('promote reviewer', actorRef, (ctx) => {
      const q = qualification(ctx, assertId(qualificationId, 'qualificationId'));
      const p = founder(ctx, actorRef, `employee:${q.employeeId}`, 'reviewer qualification');
      if (q.mode !== 'CALIBRATION') throw new QandeelError('INVALID_TRANSITION', 'only a calibrating reviewer is promoted', { mode: q.mode });
      const gold = goldCases(ctx, q.certificationId);
      const gaps = promotionGaps({ goldPassed: Math.max(gold.passed, q.goldCasesPassed), agreements: q.calibrationAgreements, disagreements: q.calibrationDisagreements });
      if (gaps.length > 0) throw new QandeelError('REVIEWER_NOT_ELIGIBLE', 'independent review authority needs Gold cases and calibration evidence', { reason: gaps[0] ?? 'EVIDENCE_MISSING', gaps: gaps.join(','), minGoldCases: MIN_GOLD_CASES });
      const next = setMode(ctx, q, 'ACTIVE', assertCode(reasonCode, 'reasonCode'), p.ref, { admittedByRef: p.ref, gold });
      refillDomain(ctx, q.domain);
      return next;
    });
  }

  /**
   * Founder calibration of one shadow decision (bootstrap of a domain with no independent reviewer yet): the
   * Founder's own judgement of the same subject is the authoritative comparison. Once per decision.
   */
  calibrateShadowDecision(actorRef: string, decisionId: string, founderOutcome: 'PASS' | 'FAIL'): 'AGREE' | 'DISAGREE' | 'NONE' | 'ALREADY_CALIBRATED' {
    return this.#admin('calibrate shadow decision', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'reviewer calibration');
      if (founderOutcome !== 'PASS' && founderOutcome !== 'FAIL') throw new QandeelError('VALIDATION_FAILED', 'the Founder outcome is PASS or FAIL', { field: 'founderOutcome' });
      return recordCalibration(ctx, assertId(decisionId, 'decisionId'), founderOutcome === 'PASS' ? 'SATISFIED' : 'REWORK', 'FOUNDER', p.ref);
    });
  }

  suspendReviewer(actorRef: string, qualificationId: string, reasonCode: string): ReviewerQualificationRecord {
    return this.#admin('suspend reviewer', actorRef, (ctx) => {
      const q = qualification(ctx, assertId(qualificationId, 'qualificationId'));
      const p = founder(ctx, actorRef, null, 'reviewer qualification');
      if (q.mode !== 'ACTIVE' && q.mode !== 'CALIBRATION') throw new QandeelError('INVALID_TRANSITION', 'only a live reviewer is suspended', { mode: q.mode });
      return setMode(ctx, q, 'SUSPENDED', assertCode(reasonCode, 'reasonCode'), p.ref);
    });
  }

  /** SUSPENDED → CALIBRATION: trust is rebuilt through calibration, never restored by decree. */
  reinstateReviewer(actorRef: string, qualificationId: string, reasonCode: string): ReviewerQualificationRecord {
    return this.#admin('reinstate reviewer', actorRef, (ctx) => {
      const q = qualification(ctx, assertId(qualificationId, 'qualificationId'));
      const p = founder(ctx, actorRef, `employee:${q.employeeId}`, 'reviewer qualification');
      if (q.mode !== 'SUSPENDED') throw new QandeelError('INVALID_TRANSITION', 'only a suspended reviewer is reinstated', { mode: q.mode });
      const next = setMode(ctx, q, 'CALIBRATION', assertCode(reasonCode, 'reasonCode'), p.ref);
      refillDomain(ctx, q.domain);
      return next;
    });
  }

  revokeReviewer(actorRef: string, qualificationId: string, reasonCode: string): ReviewerQualificationRecord {
    return this.#admin('revoke reviewer', actorRef, (ctx) => {
      const q = qualification(ctx, assertId(qualificationId, 'qualificationId'));
      const p = founder(ctx, actorRef, null, 'reviewer qualification');
      if (q.mode === 'REVOKED') throw new QandeelError('INVALID_TRANSITION', 'already revoked', { mode: q.mode });
      return setMode(ctx, q, 'REVOKED', assertCode(reasonCode, 'reasonCode'), p.ref);
    });
  }

  // --- Founder keys, conflicts and escalations -------------------------------------------------------------

  /** The Founder's decision on a FOUNDER key of a plan (a review key, recorded like any other). */
  decideFounderKey(actorRef: string, assignmentId: string, input: { outcome: ReviewOutcome; reasonCode: string; rationale?: string }): ReviewRequestRecord {
    return this.#admin('founder review key', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'founder review key');
      const row = ctx.db.get('SELECT * FROM review_assignments WHERE id = ?', assertId(assignmentId, 'assignmentId'));
      if (!row) throw new QandeelError('NOT_FOUND', 'review assignment not found', { assignmentId });
      const a = mapReviewAssignment(row);
      if (a.keyKind !== 'FOUNDER' || a.reviewerRef !== p.ref) throw new QandeelError('AUTHORITY_DENIED', 'this is not the Founder\'s review key', { reason: 'NOT_FOUNDER_KEY' });
      if (!isReviewOutcome(input.outcome)) throw new QandeelError('VALIDATION_FAILED', 'unknown review outcome', { field: 'outcome' });
      const rationale = input.rationale === undefined ? null : boundedText(input.rationale, 'rationale', 4000);
      if (rationale !== null && containsSecretMaterial(rationale)) throw new QandeelError('VALIDATION_FAILED', 'rationale carries secret material', { field: 'rationale' });
      const r = recordDecision(ctx, a, p.ref, { outcome: input.outcome, reasonCode: assertCode(input.reasonCode, 'reasonCode'), rationale, evidenceRefs: [] }, null);
      if (!r.recorded) throw new QandeelError('REVIEW_STALE', 'the review key can no longer be decided', { reason: r.code });
      return r.request;
    });
  }

  /**
   * Resolves an explicit Review Conflict (Founder authority, Stage 11 §20): PASS or REWORK — never an
   * average. The subject's consequences follow in the same transaction; R4 is never made to pass.
   */
  resolveConflict(actorRef: string, conflictId: string, resolution: 'PASS' | 'REWORK', reasonCode: string): ReviewConflictRecord {
    return this.#admin('resolve review conflict', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'review conflict');
      const row = ctx.db.get('SELECT * FROM review_conflicts WHERE id = ?', assertId(conflictId, 'conflictId'));
      if (!row) throw new QandeelError('NOT_FOUND', 'review conflict not found', { conflictId });
      const c = mapReviewConflict(row);
      if (c.state !== 'OPEN') throw new QandeelError('INVALID_TRANSITION', 'this conflict was already resolved', { conflictId: c.id });
      if (resolution !== 'PASS' && resolution !== 'REWORK') throw new QandeelError('VALIDATION_FAILED', 'resolution is PASS or REWORK', { field: 'resolution' });
      const request = getRequest(ctx, c.requestId);
      if (resolution === 'PASS' && request.riskLevel === 'R4') throw new QandeelError('FOUNDER_ONLY', 'R4 work is never made executable by review', { risk: 'R4' });
      const at = ts(ctx);
      ctx.db.run(`UPDATE review_conflicts SET state = 'RESOLVED', resolution = ?, resolved_by_ref = ?, reason_code = ?, resolved_at = ? WHERE id = ?`, resolution, p.ref, assertCode(reasonCode, 'reasonCode'), at, c.id);
      appendAudit(ctx, 'review.conflict_resolved', 'review_conflict', c.id, { actorRef: p.ref }, 'OK', resolution, { requestId: request.id });
      if (request.state === 'CONFLICT') {
        const next = setRequestState(ctx, request, resolution === 'PASS' ? 'SATISFIED' : 'REWORK', `review.conflict_${resolution.toLowerCase()}`, p.ref);
        if (c.origin === 'KEY_DISAGREEMENT') applyOutcome(ctx, next, resolution === 'PASS' ? 'SATISFIED' : 'REWORK', p.ref);
        // An OVERSIGHT conflict is about work already REVIEWED, which never reopens (C1 state machine): a REWORK
        // resolution keeps the oversight finding open; the remedy is a superseding Work Item (a Founder act).
        else if (resolution === 'REWORK') appendAudit(ctx, 'oversight.rework_required', 'work_item', request.workItemId, { actorRef: p.ref }, 'OK', 'SUPERSEDE_TO_REWORK', { reviewRequestId: request.id });
      }
      return mapReviewConflict(ctx.db.get('SELECT * FROM review_conflicts WHERE id = ?', c.id) ?? {});
    });
  }

  /** Resolves an ESCALATED review (explicit uncertainty) with a Founder decision: PASS or REWORK. */
  resolveEscalation(actorRef: string, requestId: string, resolution: 'PASS' | 'REWORK', reasonCode: string): ReviewRequestRecord {
    return this.#admin('resolve review escalation', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'review escalation');
      const r = getRequest(ctx, assertId(requestId, 'requestId'));
      if (r.state !== 'ESCALATED' || r.kind !== 'REQUIRED') throw new QandeelError('INVALID_TRANSITION', 'only an escalated required review is resolved here', { state: r.state });
      if (resolution !== 'PASS' && resolution !== 'REWORK') throw new QandeelError('VALIDATION_FAILED', 'resolution is PASS or REWORK', { field: 'resolution' });
      if (resolution === 'PASS' && r.riskLevel === 'R4') throw new QandeelError('FOUNDER_ONLY', 'R4 work is never made executable by review', { risk: 'R4' });
      const next = setRequestState(ctx, r, resolution === 'PASS' ? 'SATISFIED' : 'REWORK', `review.escalation_${resolution.toLowerCase()}`, p.ref);
      applyOutcome(ctx, next, resolution === 'PASS' ? 'SATISFIED' : 'REWORK', p.ref);
      appendAudit(ctx, 'review.escalation_resolved', 'review_request', r.id, { actorRef: p.ref }, 'OK', assertCode(reasonCode, 'reasonCode'), { resolution });
      return getRequest(ctx, r.id);
    });
  }

  // --- Quality Holds and Independent Oversight ---------------------------------------------------------------

  placeQualityHold(actorRef: string, input: { targetKind: QualityHoldRecord['targetKind']; targetRef: string; reasonCode: string; findingId?: string }): QualityHoldRecord {
    return this.#admin('place quality hold', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'quality hold');
      if (!['REVIEWER', 'QUALIFICATION', 'DOMAIN', 'RUBRIC'].includes(input.targetKind)) throw new QandeelError('VALIDATION_FAILED', 'targetKind is REVIEWER, QUALIFICATION, DOMAIN or RUBRIC', { field: 'targetKind' });
      const id = newId();
      ctx.db.run(
        `INSERT INTO quality_holds (id, target_kind, target_ref, state, origin, finding_id, reason_code, placed_by_ref, lifted_by_ref, created_at, lifted_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?, ?, NULL, ?, NULL)`,
        id, input.targetKind, boundedText(input.targetRef, 'targetRef', 161), input.findingId === undefined ? 'FOUNDER' : 'OVERSIGHT', input.findingId === undefined ? null : assertId(input.findingId, 'findingId'), assertCode(input.reasonCode, 'reasonCode'), p.ref, ts(ctx),
      );
      appendAudit(ctx, 'review.quality_hold_placed', 'quality_hold', id, { actorRef: p.ref }, 'OK', input.reasonCode, { targetKind: input.targetKind });
      // Reliance stops now: open assignments caught by the hold are withdrawn at their decision boundary
      // (eligibility is re-checked there); new selection already excludes them.
      return mapQualityHold(ctx.db.get('SELECT * FROM quality_holds WHERE id = ?', id) ?? {});
    });
  }

  liftQualityHold(actorRef: string, holdId: string, reasonCode: string): QualityHoldRecord {
    return this.#admin('lift quality hold', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'quality hold');
      const h = mapQualityHold(ctx.db.get('SELECT * FROM quality_holds WHERE id = ?', assertId(holdId, 'holdId')) ?? {});
      if (h.state !== 'ACTIVE') throw new QandeelError('INVALID_TRANSITION', 'only an active hold is lifted', { holdId });
      ctx.db.run(`UPDATE quality_holds SET state = 'LIFTED', lifted_by_ref = ?, lifted_at = ? WHERE id = ?`, p.ref, ts(ctx), h.id);
      appendAudit(ctx, 'review.quality_hold_lifted', 'quality_hold', h.id, { actorRef: p.ref }, 'OK', assertCode(reasonCode, 'reasonCode'), { targetKind: h.targetKind });
      refillDomain(ctx, null);
      return mapQualityHold(ctx.db.get('SELECT * FROM quality_holds WHERE id = ?', h.id) ?? {});
    });
  }

  /**
   * Independent Quality Oversight of a completed output (Stage 11 §27): a second, independent look that
   * never satisfies or bypasses a gate. Its reviewer is independent of the executor AND of the reviewers
   * of the required review; a FAIL opens a finding (and a conflict against a passed review).
   */
  requestOversight(actorRef: string, workItemId: string, reasonCode: string): ReviewRequestRecord {
    return this.#admin('request oversight', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'independent oversight');
      const item = getWorkItemRow(ctx, assertId(workItemId, 'workItemId'));
      const plan = ctx.db.get(`SELECT * FROM review_plans WHERE work_item_id = ? ORDER BY version DESC LIMIT 1`, item.id);
      if (!plan) throw new QandeelError('REVIEW_REQUIRED', 'oversight samples work that has a review domain (a plan)', { reason: 'NO_REVIEW_DOMAIN' });
      const subject = currentOutputSubject(ctx, item);
      if (!ctx.db.get(`SELECT 1 AS x FROM runs WHERE work_item_id = ? AND state = 'SUCCEEDED'`, item.id)) throw new QandeelError('INVALID_TRANSITION', 'oversight reviews a completed output', { workItemId: item.id });
      const live = ctx.db.get(`SELECT * FROM review_requests WHERE work_item_id = ? AND subject_fingerprint = ? AND kind = 'OVERSIGHT' AND state IN ('OPEN', 'SATISFIED', 'CONFLICT', 'ESCALATED')`, item.id, subject.fingerprint);
      if (live) return mapReviewRequest(live);
      const id = newId();
      const at = ts(ctx);
      const cls = mapReviewPlan(plan);
      // The oversight reviewer sees the output: its effective class (declared, contexts, tool results) governs.
      const dataClass: DataClass = effectiveDataClass(ctx, item.id);
      ctx.db.run(
        `INSERT INTO review_requests (id, kind, plan_id, work_item_id, subject_kind, subject_fingerprint, subject_ref, data_class, risk_level, state, version, created_at, updated_at) VALUES (?, 'OVERSIGHT', ?, ?, 'OUTPUT', ?, ?, ?, ?, 'OPEN', 1, ?, ?)`,
        id, cls.id, item.id, subject.fingerprint, subject.ref, dataClass, item.riskLevel, at, at,
      );
      ctx.db.run('INSERT INTO review_request_history (request_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, ?, ?, ?, ?)', id, 'OPEN', assertCode(reasonCode, 'reasonCode'), p.ref, at);
      appendAudit(ctx, 'oversight.requested', 'review_request', id, { actorRef: p.ref }, 'OK', reasonCode, { workItemId: item.id });
      return fillAssignments(ctx, getRequest(ctx, id as Id));
    });
  }

  /** Finding → Root Cause → Corrective Action → Verified → Closed (forward only; the datastore enforces it). */
  advanceFinding(actorRef: string, findingId: string, input: { to: OversightFindingRecord['state']; rootCauseCode?: string; correctiveActionCode?: string; reasonCode: string }): OversightFindingRecord {
    return this.#admin('advance finding', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'oversight finding');
      const f = mapFinding(ctx.db.get('SELECT * FROM oversight_findings WHERE id = ?', assertId(findingId, 'findingId')) ?? {});
      ctx.db.run(
        'UPDATE oversight_findings SET state = ?, root_cause_code = COALESCE(?, root_cause_code), corrective_action_code = COALESCE(?, corrective_action_code), reason_code = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
        input.to, input.rootCauseCode === undefined ? null : assertCode(input.rootCauseCode, 'rootCauseCode'), input.correctiveActionCode === undefined ? null : assertCode(input.correctiveActionCode, 'correctiveActionCode'), assertCode(input.reasonCode, 'reasonCode'), ts(ctx), f.id, f.version,
      );
      appendAudit(ctx, 'oversight.finding_advanced', 'oversight_finding', f.id, { actorRef: p.ref }, 'OK', input.reasonCode, { from: f.state, to: input.to });
      return mapFinding(ctx.db.get('SELECT * FROM oversight_findings WHERE id = ?', f.id) ?? {});
    });
  }

  /** Bounded reconciliation of review state (runtime recovery and the supervisor sweep call this). */
  sweep(limit = 100): number {
    const ctx = storeContext(this.#store);
    return ctx.db.immediate('review sweep', () => sweepReviews(ctx, Math.max(1, Math.min(500, limit))));
  }

  // --- Reads (content-free unless stated) ------------------------------------------------------------------

  plan(workItemId: Id): ReviewPlanRecord | null {
    return this.#read((ctx) => activePlan(ctx, workItemId));
  }

  plans(workItemId: Id): ReviewPlanRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM review_plans WHERE work_item_id = ? ORDER BY version', workItemId).map(mapReviewPlan));
  }

  qualifications(filter: { domain?: string; employeeId?: Id } = {}): ReviewerQualificationRecord[] {
    return this.#read((ctx) =>
      ctx.db
        .all('SELECT * FROM reviewer_qualifications ORDER BY domain, employee_id, created_at')
        .map(mapQualification)
        .filter((q) => (filter.domain === undefined || q.domain === filter.domain) && (filter.employeeId === undefined || q.employeeId === filter.employeeId)),
    );
  }

  /** Who could independently review in a domain right now (the pool's live view; eligibility decided in SQL). */
  pool(domain: string, dataClass: DataClass = 'D1', limit = 20): { employeeId: Id; qualificationId: Id; level: string }[] {
    return this.#read((ctx) => eligibleReviewers(ctx, { domain: assertReviewDomain(domain), mode: 'ACTIVE', dataClass, excluded: [], excludeDepartmentId: null, minLevelRank: 0, onlyEmployeeId: null, limit }));
  }

  requests(filter: { workItemId?: Id; state?: ReviewRequestRecord['state'] } = {}): ReviewRequestRecord[] {
    return this.#read((ctx) =>
      ctx.db
        .all('SELECT * FROM review_requests ORDER BY created_at, id')
        .map(mapReviewRequest)
        .filter((r) => (filter.workItemId === undefined || r.workItemId === filter.workItemId) && (filter.state === undefined || r.state === filter.state)),
    );
  }

  request(id: Id): ReviewRequestRecord {
    return this.#read((ctx) => getRequest(ctx, id));
  }

  assignments(requestId: Id): ReviewAssignmentRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM review_assignments WHERE request_id = ? ORDER BY key_index, created_at', requestId).map(mapReviewAssignment));
  }

  decisions(requestId: Id): ReviewDecisionRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM review_decisions WHERE request_id = ? ORDER BY created_at, id', requestId).map(mapReviewDecision));
  }

  /** A decision's rationale (local governed content for the Founder and the reviewed executor; never telemetry). */
  rationale(decisionId: Id): string | null {
    return this.#read((ctx) => ctx.db.get<{ r: string | null }>('SELECT rationale AS r FROM review_decisions WHERE id = ?', decisionId)?.r ?? null);
  }

  conflicts(state?: ReviewConflictRecord['state']): ReviewConflictRecord[] {
    return this.#read((ctx) => (state ? ctx.db.all('SELECT * FROM review_conflicts WHERE state = ? ORDER BY created_at', state) : ctx.db.all('SELECT * FROM review_conflicts ORDER BY created_at')).map(mapReviewConflict));
  }

  holds(activeOnly = true): QualityHoldRecord[] {
    return this.#read((ctx) => (activeOnly ? ctx.db.all(`SELECT * FROM quality_holds WHERE state = 'ACTIVE' ORDER BY created_at`) : ctx.db.all('SELECT * FROM quality_holds ORDER BY created_at')).map(mapQualityHold));
  }

  findings(): OversightFindingRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM oversight_findings ORDER BY created_at').map(mapFinding));
  }

  health(): ReviewHealth {
    return this.#read((ctx) => {
      const n = (sql: string): number => Number(ctx.db.get<{ n: number }>(sql)?.n ?? 0);
      return {
        openRequests: n(`SELECT COUNT(*) AS n FROM review_requests WHERE state = 'OPEN'`),
        waitingForReviewer: n(`SELECT COUNT(*) AS n FROM review_requests WHERE state = 'OPEN' AND waiting_reason = 'REVIEWER_UNAVAILABLE'`),
        waitingForPlan: n(`SELECT COUNT(*) AS n FROM work_items w WHERE w.state = 'WAITING_REVIEW' AND NOT EXISTS (SELECT 1 FROM review_plans p WHERE p.work_item_id = w.id AND p.status = 'ACTIVE')`),
        conflictsOpen: n(`SELECT COUNT(*) AS n FROM review_conflicts WHERE state = 'OPEN'`),
        escalated: n(`SELECT COUNT(*) AS n FROM review_requests WHERE state = 'ESCALATED'`),
        qualityHoldsActive: n(`SELECT COUNT(*) AS n FROM quality_holds WHERE state = 'ACTIVE'`),
        findingsOpen: n(`SELECT COUNT(*) AS n FROM oversight_findings WHERE state <> 'CLOSED'`),
        reviewersActive: n(`SELECT COUNT(*) AS n FROM reviewer_qualifications WHERE mode = 'ACTIVE'`),
        reviewersCalibrating: n(`SELECT COUNT(*) AS n FROM reviewer_qualifications WHERE mode = 'CALIBRATION'`),
      };
    });
  }
}
