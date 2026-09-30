/**
 * C6 storage proofs: the Eval Registry calibrates its own evaluator, completion is not success, outcome
 * verification is governed evidence, evaluations are idempotent evidence records, attribution separates the
 * Employee from the system, reflection is a hypothesis, patterns are candidate-first, interventions are judged
 * on later evidence, reports carry typed claims and no score, and systemic findings reach Founder Attention.
 * All through the real C1–C5 paths (Review Pool, Founder chokepoint, lesson lifecycle). C6-PROOF: storage-improvement
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, newId, type Id } from '@qandeel-company/domain';
import { standardWorkOutcomeDefinition } from '@qandeel-company/mind';

import { AttentionStore, FounderActionStore, FounderAuthStore, ImprovementStore, MemoryStore, ReviewStore, type Claim, type EmployeeRecord } from '../src/index.js';
import { insertLesson } from '../src/mind-writes.js';
import { reserveBudget, settle, settleReservation } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { grantAll, hire, seed, testManifest, type Seed } from './c2-helpers.js';
import { propose } from './c3-helpers.js';
import { activeReviewer, claimItem, decideAssignment, reviewPlan, runFor } from './c4-helpers.js';
import { backoff, harness, type Harness } from './helpers.js';

const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;
const reason = (r: string) => (e: unknown): boolean => isQandeelError(e) && e.details.reason === r;
const HOUR = 3_600_000;

function withSeed(fn: (h: Harness, s: Seed, m: ImprovementStore) => void): void {
  const h = harness();
  try {
    fn(h, seed(h.store), ImprovementStore.for(h.store));
  } finally {
    h.close();
  }
}

function activate(s: Seed, m: ImprovementStore, spec = standardWorkOutcomeDefinition()): Id {
  const d = m.registerDefinition(s.founder, spec);
  const run = m.calibrateDefinition(s.founder, d.id);
  assert.equal(run.passed, true);
  return m.activateDefinition(s.founder, d.id, run.id).id;
}

const PLAN = reviewPlan({ appliesTo: 'OUTPUT' });

/**
 * One governed model call of the run, reserved and settled on the usage ledger (Employee work costs money). The
 * default card is the seed's METERED one; `priceCardId` names another (e.g. a SUBSCRIPTION card: billed 0).
 */
function spend(h: Harness, s: Seed, claim: Claim, employeeId: Id, priceCardId: Id = s.priceCardId, attemptKind: 'PRIMARY' | 'FALLBACK' = 'PRIMARY'): void {
  const r = reserveBudget(h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind, deploymentId: s.deploymentId, priceCardId, routePolicyId: s.policyId, money: 1_000, tokens: 1_000, contextManifestId: testManifest(h, claim.fence, employeeId) });
  assert.ok(r.ok, 'the model call is reserved');
  if (r.ok) settleReservation(h.store, claim.fence, r.reservation.id, { inputTokens: 100, outputTokens: 50, withinBounds: true, sessionId: null, outcome: 'OK' });
}

/** The open output review's counting key decides (from its reviewer's own fenced run). */
function decideOpenReview(h: Harness, workItemId: Id, outcome: 'PASS' | 'FAIL'): void {
  const rv = ReviewStore.for(h.store);
  const request = rv.requests({ workItemId }).find((r) => r.state === 'OPEN');
  const key = request ? rv.assignments(request.id).find((a) => a.keyKind === 'SPECIALIST' && a.state === 'ASSIGNED') : undefined;
  assert.ok(key?.reviewWorkItemId, 'a counting reviewer is assigned');
  decideAssignment(h, key.reviewWorkItemId, outcome);
}

/** Runs one output-reviewed Work Item to REVIEWED; optionally with one failed review first and a reflection. */
function reviewedWork(h: Harness, s: Seed, owner: EmployeeRecord, opts: { failFirst?: boolean; reflection?: string; priceCardId?: Id; fallbacks?: number } = {}): { workItemId: Id; observationId: Id | null } {
  const { workItemId, claim } = runFor(h, s, owner, { reviewPlan: PLAN });
  let observationId: Id | null = null;
  if (opts.reflection) observationId = (propose(h, claim, 1, { kind: 'OBSERVATION', memoryClass: null, topic: 'drafting.figures', content: opts.reflection }).decided?.resultLessonId ?? null) as Id | null;
  spend(h, s, claim, owner.id, opts.priceCardId);
  for (let i = 0; i < (opts.fallbacks ?? 0); i++) spend(h, s, claim, owner.id, opts.priceCardId, 'FALLBACK');
  settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
  if (opts.failFirst) {
    decideOpenReview(h, workItemId, 'FAIL');
    const again = claimItem(h, workItemId, `w-rework-${workItemId.slice(0, 6)}`);
    settle(h.store, again.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v2' } }, { backoff });
  }
  decideOpenReview(h, workItemId, 'PASS');
  assert.equal(h.store.getWorkItem(workItemId).state, 'REVIEWED');
  return { workItemId, observationId };
}

const verify = (s: Seed, m: ImprovementStore, workItemId: Id, verdict: 'ACHIEVED' | 'NOT_ACHIEVED') =>
  m.verifyOutcome(s.founder, workItemId, { verdict, evidenceClasses: ['REVIEW_DECISION', 'WORK_LINEAGE'], evidenceRefs: [`work_item:${workItemId}`], reasonCode: 'founder.verified' });

describe('C6 Eval Registry: provider-independent, versioned, and the evaluator is itself evaluated', () => {
  test('a definition that cannot calibrate (missing the ambiguous case) is never activated; evaluation needs an active one', () => {
    withSeed((h, s, m) => {
      const { workItemId } = runFor(h, s, s.employee);
      assert.throws(() => m.evaluate(workItemId), reason('NO_ACTIVE_DEFINITION'));
      const spec = standardWorkOutcomeDefinition();
      const d = m.registerDefinition(s.founder, { ...spec, referenceCases: spec.referenceCases.filter((c) => c.kind !== 'AMBIGUOUS') });
      const run = m.calibrateDefinition(s.founder, d.id);
      assert.equal(run.passed, false);
      assert.throws(() => m.activateDefinition(s.founder, d.id, run.id), reason('CALIBRATION_NOT_PASSED'));
      const good = activate(s, m);
      assert.equal(m.definitions({ status: 'ACTIVE' })[0]?.id, good);
      // A newer calibrated version supersedes the active one (history is kept).
      const v2 = m.registerDefinition(s.founder, spec);
      m.activateDefinition(s.founder, v2.id, m.calibrateDefinition(s.founder, v2.id).id);
      assert.deepEqual(m.definitions({ code: spec.code }).map((x) => [x.defVersion, x.status]), [[1, 'DRAFT'], [2, 'SUPERSEDED'], [3, 'ACTIVE']]);
    });
  });

  test('a Founder-only registry: without the armed Founder surface every registry act fails closed', () => {
    const h = harness();
    try {
      const m = ImprovementStore.for(h.store);
      assert.throws(() => m.registerDefinition('founder:nobody', standardWorkOutcomeDefinition()), code('FOUNDER_SURFACE_UNAVAILABLE'));
    } finally {
      h.close();
    }
  });
});

describe('C6 evaluation: completion is not success; evidence before judgement', () => {
  test('C6-PROOF: COMPLETED alone is never qualified and cannot be outcome-verified; REVIEWED + ACHIEVED is qualified', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const { workItemId: done, claim } = runFor(h, s, s.employee);
      settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
      assert.equal(h.store.getWorkItem(done).state, 'COMPLETED');
      assert.throws(() => verify(s, m, done, 'ACHIEVED'), reason('NOT_REVIEWED'));
      const completedOnly = m.evaluate(done).evaluation;
      assert.equal(completedOnly.qualifiedOutcome, false);
      assert.equal(completedOnly.evidenceState, 'INSUFFICIENT_EVIDENCE');

      const { workItemId } = reviewedWork(h, s, s.employee);
      assert.throws(() => m.verifyOutcome(s.founder, workItemId, { verdict: 'ACHIEVED', evidenceClasses: ['EXTERNAL_OUTCOME'], evidenceRefs: [`work_item:${workItemId}`], reasonCode: 'x' }), reason('EXTERNAL_OUTCOME_UNAVAILABLE'));
      assert.throws(() => m.verifyOutcome(s.founder, workItemId, { verdict: 'ACHIEVED', evidenceClasses: ['REVIEW_DECISION'], evidenceRefs: [], reasonCode: 'x' }), code('EVIDENCE_REQUIRED'));
      assert.equal(verify(s, m, workItemId, 'ACHIEVED').state, 'OUTCOME_VERIFIED');
      const first = m.evaluate(workItemId);
      assert.equal(first.changed, true);
      assert.equal(first.evaluation.qualifiedOutcome, true);
      assert.equal(first.evaluation.evidenceState, 'SUFFICIENT_EVIDENCE');
      // Idempotent: unchanged evidence records nothing new.
      const again = m.evaluate(workItemId);
      assert.equal(again.changed, false);
      assert.equal(again.evaluation.id, first.evaluation.id);
      // A smart success became a pattern CANDIDATE (an observation), never Company practice.
      const [signal] = m.signals({ workItemId, kind: 'SUCCESSFUL_PATTERN' });
      assert.equal(signal?.source, 'EVALUATION');
      assert.equal(MemoryStore.for(h.store).lesson(signal?.observationId as Id).stage, 'OBSERVATION');
      // Telemetry stays content-free.
      assert.ok(!JSON.stringify(h.store.audit(first.evaluation.id)).includes('Smart success'));
    });
  });
});

describe('C6 attribution and learning: the Employee is not blamed for the system; reflection is a hypothesis', () => {
  test('C6-PROOF: a reflected mistake is not validated until an independent attribution makes the Employee accountable — and never when the cause is a tool', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const mem = MemoryStore.for(h.store);
      const { workItemId, observationId } = reviewedWork(h, s, s.employee, { failFirst: true, reflection: 'I believe I misread the brief and skipped sourcing the figures.' });
      verify(s, m, workItemId, 'NOT_ACHIEVED');
      assert.equal(h.store.getWorkItem(workItemId).state, 'CLOSED');
      const ev = m.evaluate(workItemId);
      assert.equal(ev.evaluation.dimensions.find((d) => d.dimension === 'OUTCOME')?.verdict, 'NEGATIVE');
      const proposed = m.attributions({ workItemId })[0];
      assert.equal(proposed?.state, 'PROPOSED');
      assert.equal(proposed?.overall, 'EMPLOYEE_JUDGMENT');
      // The Employee's own observation is a REFLECTION.
      const sig = m.classifyObservation(observationId as Id, 'MISTAKE_LESSON');
      assert.equal(sig.source, 'REFLECTION');
      const lesson = mem.nominateLesson(s.founder, observationId as Id, 'founder.nominated');
      assert.throws(() => mem.validateLesson(s.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'x' }), reason('ATTRIBUTION_NOT_VALIDATED'));
      // The Founder's independent cause analysis: a tool broke — not the Employee.
      const decided = m.decideAttribution(s.founder, proposed?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.cause', causes: [{ category: 'TOOL', role: 'PRIMARY', confidence: 'HIGH', basis: 'TOOL_RETURNED_STALE_DATA' }] });
      assert.equal(decided.attribution.employeeAccountable, false);
      assert.equal(decided.attribution.source, 'FOUNDER');
      assert.throws(() => mem.validateLesson(s.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'x' }), reason('CAUSE_IS_NOT_THE_EMPLOYEE'));
      // The profile never counts that failure against the Employee.
      const outcome = m.profile(s.employee.id).dimensions.find((d) => d.dimension === 'OUTCOME');
      assert.equal(outcome?.accountableNegative, 0);
      assert.equal(outcome?.excludedNonEmployee, 1);
    });
  });

  test('C6-PROOF: validated learning → governed intervention → training completed is NOT improvement → later comparable evidence decides', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const mem = MemoryStore.for(h.store);
      const { workItemId, observationId } = reviewedWork(h, s, s.employee, { failFirst: true, reflection: 'I skipped sourcing the figures under time pressure.' });
      verify(s, m, workItemId, 'NOT_ACHIEVED');
      m.evaluate(workItemId);
      const proposed = m.attributions({ workItemId })[0];
      m.decideAttribution(s.founder, proposed?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.confirmed' });
      m.classifyObservation(observationId as Id, 'MISTAKE_LESSON');
      const lesson = mem.nominateLesson(s.founder, observationId as Id, 'founder.nominated');
      assert.equal(mem.validateLesson(s.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'founder.validated' }).stage, 'VALIDATED');

      const planned = m.planIntervention(s.founder, lesson.id, { kind: 'TARGETED_RETRAINING' });
      assert.equal(planned.outcome, 'PLANNED');
      const intervention = planned.intervention?.id as Id;
      // One retraining at a time: a second cycle waits for the first one's evidence.
      assert.equal(m.planIntervention(s.founder, lesson.id, { kind: 'TARGETED_RETRAINING' }).outcome, 'AWAIT_EVIDENCE');
      assert.equal(m.assessIntervention(intervention).intervention.effect, 'NOT_YET_TESTED');
      h.clock.advance(HOUR);
      m.completeTraining(s.founder, intervention);
      const untested = m.assessIntervention(intervention);
      assert.equal(untested.intervention.effect, 'NOT_YET_TESTED', 'training completed is not learning proven');
      // Later comparable work, reviewed and verified.
      for (let i = 0; i < 2; i++) {
        h.clock.advance(HOUR);
        const later = reviewedWork(h, s, s.employee).workItemId;
        verify(s, m, later, 'ACHIEVED');
        m.evaluate(later);
      }
      const judged = m.assessIntervention(intervention);
      assert.equal(judged.intervention.effect, 'IMPROVEMENT_OBSERVED');
      assert.equal(judged.intervention.evidenceRefs.length, 2);
      assert.equal(m.assessIntervention(intervention).changed, false, 'a decisive effect is final');
    });
  });

  test('C6-PROOF: a successful pattern is validated only on a qualified outcome and shared only after verified reuse', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const mem = MemoryStore.for(h.store);
      const { workItemId } = reviewedWork(h, s, s.employee);
      verify(s, m, workItemId, 'ACHIEVED');
      m.evaluate(workItemId);
      const [signal] = m.signals({ workItemId, kind: 'SUCCESSFUL_PATTERN' });
      const lesson = mem.nominateLesson(s.founder, signal?.observationId as Id, 'pattern.candidate');
      mem.validateLesson(s.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'pattern.validated' });
      const promotion = mem.requestPromotion('employee:requester', lesson.id, 'COMPANY');
      assert.throws(() => mem.decidePromotion(s.founder, promotion.id, { decision: 'APPROVE', reasonCode: 'share' }), reason('PATTERN_REUSE_NOT_VERIFIED'));
      assert.equal(mem.requestPromotion('employee:requester', lesson.id, 'PERSONAL').state, 'APPROVED', 'personal scope is the author’s own');
    });
  });
});

describe('C6 systemic findings, reports and Founder Attention', () => {
  test('C6-PROOF: repeated employee-judgement failures across Employees become a systemic candidate that reaches Founder Attention; reports carry typed claims and no score', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const other = s.gov.getEmployee(activateSecond(s));
      for (const owner of [s.employee, other, s.employee]) {
        const { workItemId } = reviewedWork(h, s, owner, { failFirst: true });
        verify(s, m, workItemId, 'NOT_ACHIEVED');
        m.evaluate(workItemId);
        const a = m.attributions({ workItemId })[0];
        m.decideAttribution(s.founder, a?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.confirmed' });
      }
      const [finding] = m.systemicFindings({ state: 'CANDIDATE' });
      assert.equal(finding?.targetKind, 'WORKFLOW');
      assert.equal(finding?.distinctEmployees, 2);
      // System-detected from reviewer-derived attributions: the subjects of the failures are not its authors.
      assert.equal(finding?.origin, 'REPEATED_ATTRIBUTION');
      assert.equal(finding?.sourceSignalId, null);
      assert.equal(finding?.contributorEmployeeId, null);
      const sync = AttentionStore.for(h.store).sync();
      assert.ok(sync.opened >= 1);
      assert.ok(AttentionStore.for(h.store).list().some((i) => i.sourceRef === `systemic_finding:${finding?.id}`));
      assert.equal(AttentionStore.for(h.store).sync().opened, 0, 'a stable world reconciles in silence');

      assert.throws(() => m.generateReport('WEEKLY', { at: '2026-09-30' }), code('VALIDATION_FAILED'));
      const weekly = m.generateReport('WEEKLY');
      assert.equal(weekly.changed, true);
      assert.equal(m.generateReport('WEEKLY').changed, false, 'identical regeneration is idempotent');
      const claims = weekly.report.claims;
      assert.ok(claims.some((c) => c.code === 'REPEATED_FAILURE_PATTERN' && c.kind === 'TREND' && c.uncertainty !== null));
      assert.ok(claims.some((c) => c.code === 'EXTERNAL_OUTCOMES_UNAVAILABLE'));
      assert.ok(claims.every((c) => c.kind === 'FACT' || (c.evidenceRefs.length > 0 && c.uncertainty !== null)));
      assert.ok(!/score|rank|leaderboard/i.test(JSON.stringify(claims.map((c) => Object.keys(c.params)))));
      // The Founder decides: validated, it becomes a recommendation, and the attention item resolves.
      m.decideSystemicFinding(s.founder, finding?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.agreed' });
      assert.equal(AttentionStore.for(h.store).sync().resolved, 1);
      const monthly = m.generateReport('MONTHLY').report.claims;
      assert.ok(monthly.some((c) => c.code === 'CONSIDER_PROCESS_CHANGE' && c.kind === 'RECOMMENDATION'));
      for (const e of [s.employee.id, other.id]) assert.ok(!contributionRefs(m, e).some((r) => r.startsWith('systemic_finding:')), 'a failure subject is never credited with the finding');
    });
  });

  test('C6-PROOF: an Employee-reflected systemic problem is traceable to its author, credited only once the Founder validates it, and grants no authority', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const ctx = storeContext(h.store);
      const { workItemId, observationId } = reviewedWork(h, s, s.employee, { failFirst: true, reflection: 'The figures tool returned last quarter’s data; the workflow never checks its freshness.' });
      verify(s, m, workItemId, 'NOT_ACHIEVED');
      m.evaluate(workItemId);
      const proposed = m.attributions({ workItemId })[0];
      // Reflection is a hypothesis: before an independent attribution nothing is recorded (the classification rolls back).
      assert.throws(() => m.classifyObservation(observationId as Id, 'SYSTEMIC_PROBLEM'), reason('ATTRIBUTION_NOT_VALIDATED'));
      assert.equal(m.signals({ workItemId }).length, 0);
      assert.equal(m.systemicFindings().length, 0);
      m.decideAttribution(s.founder, proposed?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.cause', causes: [{ category: 'TOOL', role: 'PRIMARY', confidence: 'HIGH', basis: 'TOOL_RETURNED_STALE_DATA' }] });
      const authority = authorityFingerprint(ctx);

      const signal = m.classifyObservation(observationId as Id, 'SYSTEMIC_PROBLEM');
      assert.equal(signal.source, 'REFLECTION');
      const [finding] = m.systemicFindings({ state: 'CANDIDATE' });
      assert.equal(finding?.origin, 'REPORTED_OBSERVATION');
      assert.equal(finding?.targetKind, 'TOOL');
      assert.equal(finding?.sourceSignalId, signal.id);
      assert.equal(finding?.contributorEmployeeId, s.employee.id, 'traceable to the Employee who reflected it');
      assert.ok(finding?.evidenceRefs.includes(`lesson:${observationId}`));
      assert.ok(JSON.stringify(h.store.audit(finding?.id as Id)).includes(s.employee.id), 'the audit trail names the contributor by id');
      // A systemic problem is a finding about the company, never a lesson about the Employee.
      const lesson = MemoryStore.for(h.store).nominateLesson(s.founder, observationId as Id, 'founder.nominated');
      assert.throws(() => MemoryStore.for(h.store).validateLesson(s.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'x' }), reason('SYSTEMIC_PROBLEM_IS_A_FINDING'));

      // Provenance is credit, never authority: the contributor cannot decide the finding, and credit waits for the Founder.
      assert.throws(() => m.decideSystemicFinding(s.employee.ref, finding?.id as Id, { decision: 'VALIDATE', reasonCode: 'self.approved' }), (e: unknown) => isQandeelError(e));
      assert.ok(!contributionRefs(m, s.employee.id).includes(`systemic_finding:${finding?.id}`));
      m.decideSystemicFinding(s.founder, finding?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.agreed' });
      assert.ok(contributionRefs(m, s.employee.id).includes(`systemic_finding:${finding?.id}`));
      assert.equal(authorityFingerprint(ctx), authority, 'no role, grant, budget, approval, seat, hold or certification changed');
      // The provenance is fixed: nobody can re-credit the finding to someone else.
      assert.throws(() => ctx.db.immediate('bypass', () => ctx.db.run('UPDATE systemic_findings SET contributor_employee_id = NULL, version = version + 1 WHERE id = ?', finding?.id)), code('STORAGE_INVARIANT'));
    });
  });

  test('C6-PROOF: a system-recorded observation of the same problem credits nobody, and a false contributor is refused by the store', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const ctx = storeContext(h.store);
      const { workItemId } = reviewedWork(h, s, s.employee, { failFirst: true });
      verify(s, m, workItemId, 'NOT_ACHIEVED');
      m.evaluate(workItemId);
      m.decideAttribution(s.founder, m.attributions({ workItemId })[0]?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.cause', causes: [{ category: 'TOOL', role: 'PRIMARY', confidence: 'HIGH', basis: 'TOOL_RETURNED_STALE_DATA' }] });
      // An observation the system recorded about the Employee's work (no candidate: not the Employee's reflection).
      const observationId = ctx.db.immediate('system observation', () =>
        insertLesson(ctx, { employeeId: s.employee.id, kind: 'OBSERVATION', observationId: null, eventRef: `work_item:${workItemId}`, topic: 'c6.systemic', claimKey: null, claimValue: null, content: 'Recorded by the evaluator.', dataClass: 'D1', marketRef: null, candidateId: null }),
      );
      const signal = m.classifyObservation(observationId, 'SYSTEMIC_PROBLEM');
      assert.equal(signal.source, 'ATTRIBUTION');
      const [finding] = m.systemicFindings();
      assert.equal(finding?.origin, 'REPORTED_OBSERVATION');
      assert.equal(finding?.sourceSignalId, signal.id, 'traceable to its source');
      assert.equal(finding?.contributorEmployeeId, null, 'the subject of a system record is not its author');
      m.decideSystemicFinding(s.founder, finding?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.agreed' });
      assert.ok(!contributionRefs(m, s.employee.id).some((r) => r.startsWith('systemic_finding:')));
      // The store refuses a finding that names a contributor who did not author a reflected source, or one with no source.
      const insert = (origin: string, signalId: string | null, contributor: string | null): unknown =>
        ctx.db.immediate('bypass', () =>
          ctx.db.run(
            `INSERT INTO systemic_findings (id, dedup_key, target_kind, target_ref, cause, origin, source_signal_id, contributor_employee_id, occurrences, distinct_employees, evidence_refs_json, state, recommendation_code, version, created_at, updated_at) VALUES (?, ?, 'TOOL', 'x', 'TOOL', ?, ?, ?, 1, 1, '["x"]', 'CANDIDATE', 'R', 1, ?, ?)`,
            newId(), `k-${newId()}`, origin, signalId, contributor, h.store.now(), h.store.now(),
          ),
        );
      assert.throws(() => insert('REPORTED_OBSERVATION', signal.id, s.employee.id), code('STORAGE_INVARIANT'));
      assert.throws(() => insert('REPEATED_ATTRIBUTION', null, s.employee.id), code('STORAGE_INVARIANT'));
    });
  });
});

const contributionRefs = (m: ImprovementStore, employeeId: Id): readonly string[] => m.profile(employeeId).dimensions.find((d) => d.dimension === 'SYSTEM_CONTRIBUTION')?.evidenceRefs ?? [];

function authorityFingerprint(ctx: ReturnType<typeof storeContext>): string {
  return ['employees', 'permission_grants', 'budgets', 'approvals', 'org_positions', 'position_assignments', 'quality_holds', 'certifications', 'passport_entries']
    .map((t) => `${t}:${JSON.stringify(ctx.db.all(`SELECT * FROM ${t} ORDER BY rowid`))}`)
    .join('|');
}

describe('C6 evidence: the cause is read from the run’s own recorded failure', () => {
  test('C6-PROOF: a run that failed because its tool did not execute is TOOL evidence; a billed failed call alone is cost, never a provider cause', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      const { workItemId, claim } = runFor(h, s, s.employee);
      settle(h.store, claim.fence, { type: 'RETRYABLE_FAILURE', code: 'TOOL_NOT_EXECUTED' }, { backoff });
      const ev = m.inspect({ kind: 'WORK_ITEM', id: workItemId }).evidence as { failures: { tool: number; provider: number } };
      assert.equal(ev.failures.tool, 1);
      assert.equal(ev.failures.provider, 0);
      const proposal = m.evaluate(workItemId).attributionId;
      const a = m.attributions({ workItemId }).find((x) => x.id === proposal);
      assert.equal(a?.overall, 'TOOL');
      assert.equal(a?.employeeAccountable, false);
    });
  });
});

describe('C6 boundaries: a report, a readiness signal or a recommendation is never permission to act', () => {
  test('C6-PROOF: generating every report and deciding a systemic finding changes no authority, role, budget, grant, approval, seat or hold', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      const ctx = storeContext(h.store);
      const fingerprint = (): string =>
        ['employees', 'permission_grants', 'budgets', 'approvals', 'org_positions', 'position_assignments', 'quality_holds', 'certifications', 'passport_entries', 'canonical_truth', 'knowledge_items']
          .map((t) => `${t}:${JSON.stringify(ctx.db.all(`SELECT * FROM ${t} ORDER BY rowid`))}`)
          .join('|');
      const before = fingerprint();
      for (const c of ['DAILY', 'WEEKLY', 'MONTHLY'] as const) m.generateReport(c);
      m.profile(s.employee.id);
      m.inspect({ kind: 'COMPANY' });
      assert.equal(fingerprint(), before);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------
// R2 (Full Strong-v1 Independent Review, cluster K4): C6 must distinguish productive learning from repeated
// activity — the unit of evidence is the Work Item, "later" is the work's own time, an unvalidated adverse fact
// is never read as clean, a recovered failure is not the cause, and cost is the economic cost.

/** A validated mistake lesson of `owner` (its work failed on the merits; the cause validated as theirs). */
function validatedMistakeLesson(h: Harness, s: Seed, m: ImprovementStore, owner: EmployeeRecord = s.employee): Id {
  const mem = MemoryStore.for(h.store);
  const { workItemId, observationId } = reviewedWork(h, s, owner, { failFirst: true, reflection: 'I skipped sourcing the figures.' });
  verify(s, m, workItemId, 'NOT_ACHIEVED');
  m.evaluate(workItemId);
  m.decideAttribution(s.founder, m.attributions({ workItemId })[0]?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.confirmed' });
  m.classifyObservation(observationId as Id, 'MISTAKE_LESSON');
  const lesson = mem.nominateLesson(s.founder, observationId as Id, 'founder.nominated');
  mem.validateLesson(s.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'founder.validated' });
  return lesson.id;
}

/** Comparable work of `owner`: a qualified success, or the same mistake again (its cause validated unless `validate` is false). */
function laterWork(h: Harness, s: Seed, m: ImprovementStore, owner: EmployeeRecord, kind: 'SUCCESS' | 'RECURRENCE', validate = true): Id {
  const { workItemId } = reviewedWork(h, s, owner, { failFirst: kind === 'RECURRENCE' });
  verify(s, m, workItemId, kind === 'SUCCESS' ? 'ACHIEVED' : 'NOT_ACHIEVED');
  m.evaluate(workItemId);
  const proposal = m.attributions({ workItemId }).find((a) => a.state === 'PROPOSED');
  if (kind === 'RECURRENCE' && validate) m.decideAttribution(s.founder, proposal?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.confirmed' });
  return workItemId;
}

describe('R2: C6 evidence identity, work time, pending causes, recovered failures and economic cost', () => {
  test('R2-13: a recovered transient tool failure is never the primary cause of the Employee’s merits failure', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const { workItemId, claim } = runFor(h, s, s.employee, { reviewPlan: PLAN });
      settle(h.store, claim.fence, { type: 'RETRYABLE_FAILURE', code: 'TOOL_NOT_EXECUTED' }, { backoff });
      h.clock.advance(120_000);
      const retry = claimItem(h, workItemId, 'w-retry');
      spend(h, s, retry, s.employee.id);
      settle(h.store, retry.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
      decideOpenReview(h, workItemId, 'FAIL');
      const rework = claimItem(h, workItemId, 'w-rework');
      settle(h.store, rework.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v2' } }, { backoff });
      decideOpenReview(h, workItemId, 'PASS');
      verify(s, m, workItemId, 'NOT_ACHIEVED');
      m.evaluate(workItemId);
      const a = m.attributions({ workItemId })[0];
      assert.equal(a?.causes.find((c) => c.role === 'PRIMARY')?.category, 'EMPLOYEE_JUDGMENT', JSON.stringify(a?.causes));
      assert.equal(a?.employeeAccountable, true);
      assert.ok((a?.causes ?? []).filter((c) => c.category !== 'EMPLOYEE_JUDGMENT').every((c) => c.role === 'CONTRIBUTING' && c.confidence === 'LOW'), 'a recovered failure is at most a low-confidence contributing cause');
      // The recovered failure stays visible as evidence (observability / overhead), never as the cause.
      const ev = m.inspect({ kind: 'WORK_ITEM', id: workItemId }).evidence as { failures: { tool: number }; recoveredFailures?: { tool: number } };
      assert.deepEqual([ev.failures.tool, ev.recoveredFailures?.tool], [0, 1]);
    });
  });

  test('R2-14: one Work Item is one unit of evidence — re-evaluated under new definition versions or other codes, it counts once', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const { workItemId } = reviewedWork(h, s, s.employee);
      verify(s, m, workItemId, 'ACHIEVED');
      m.evaluate(workItemId);
      for (let v = 2; v <= 3; v++) {
        h.clock.advance(60_000);
        activate(s, m);
        assert.equal(m.evaluate(workItemId).changed, true, 'a new definition version re-evaluates the work');
      }
      const live = (): number => m.evaluations().filter((e) => e.workItemId === workItemId && e.supersededBy === null).length;
      assert.equal(live(), 1, 'the new version supersedes the older versions’ live evaluation');
      // Another definition code may evaluate the same work: every read still counts the Work Item once.
      activate(s, m, standardWorkOutcomeDefinition('work-outcome.alternate'));
      m.evaluate(workItemId, { definitionCode: 'work-outcome.alternate' });
      assert.equal(live(), 2);
      const p = m.profile(s.employee.id);
      const outcome = p.dimensions.find((d) => d.dimension === 'OUTCOME');
      assert.deepEqual([outcome?.sample, outcome?.positive], [1, 1]);
      assert.equal(p.capabilities.length, 0, 'one success is not a demonstrated capability');
      assert.deepEqual([p.economics.qualifiedOutcomes, p.economics.evaluatedItems], [1, 1]);
      assert.deepEqual([m.economics({ employeeId: s.employee.id }).qualifiedOutcomes, m.health().qualifiedOutcomes, m.health().evaluations], [1, 1, 1]);
      assert.equal(m.generateReport('WEEKLY').report.claims.find((c) => c.code === 'COST_PER_QUALIFIED_OUTCOME')?.params.qualifiedOutcomes, 1);
    });
  });

  test('R2-15: work done before the retraining is never "later" evidence, however late it is verified', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const lessonId = validatedMistakeLesson(h, s, m);
      // Two more pieces of comparable work, executed and reviewed BEFORE the retraining, verified only afterwards.
      const early = [reviewedWork(h, s, s.employee).workItemId, reviewedWork(h, s, s.employee).workItemId];
      const iid = m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).intervention?.id as Id;
      h.clock.advance(HOUR);
      m.completeTraining(s.founder, iid);
      h.clock.advance(HOUR);
      for (const w of early) {
        verify(s, m, w, 'ACHIEVED');
        m.evaluate(w);
      }
      assert.equal(m.assessIntervention(iid).intervention.effect, 'NOT_YET_TESTED', 'no work was started after the training');
      const later: Id[] = [];
      for (let i = 0; i < 2; i++) {
        h.clock.advance(HOUR);
        later.push(laterWork(h, s, m, s.employee, 'SUCCESS'));
      }
      const judged = m.assessIntervention(iid).intervention;
      assert.equal(judged.effect, 'IMPROVEMENT_OBSERVED');
      assert.deepEqual([...judged.evidenceRefs].sort(), later.map((w) => `work_item:${w}`).sort(), 'the effect rests on the later Work Items only');
    });
  });

  test('R2-17: a recurrence whose cause is not yet validated keeps the effect open; once validated it decides', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const lessonId = validatedMistakeLesson(h, s, m);
      const iid = m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).intervention?.id as Id;
      h.clock.advance(HOUR);
      m.completeTraining(s.founder, iid);
      h.clock.advance(HOUR);
      const recurrence = laterWork(h, s, m, s.employee, 'RECURRENCE', false);
      for (let i = 0; i < 2; i++) {
        h.clock.advance(HOUR);
        laterWork(h, s, m, s.employee, 'SUCCESS');
      }
      const pending = m.assessIntervention(iid);
      assert.equal(pending.intervention.effect, 'NOT_YET_TESTED', 'an adverse follow-up with a pending cause is not "no recurrence"');
      assert.equal(pending.changed, false);
      const proposal = m.attributions({ workItemId: recurrence }).find((a) => a.state === 'PROPOSED');
      m.decideAttribution(s.founder, proposal?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.confirmed' });
      assert.equal(m.assessIntervention(iid).intervention.effect, 'NO_IMPROVEMENT', 'the validated recurrence decides');
    });
  });

  test('R2-16: a pattern is shared only after two verified reuses on distinct work; one open reuse per Employee; only another Employee’s reuse is the author’s contribution', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const mem = MemoryStore.for(h.store);
      const { workItemId } = reviewedWork(h, s, s.employee);
      verify(s, m, workItemId, 'ACHIEVED');
      m.evaluate(workItemId);
      const [signal] = m.signals({ workItemId, kind: 'SUCCESSFUL_PATTERN' });
      const lesson = mem.nominateLesson(s.founder, signal?.observationId as Id, 'pattern.candidate');
      mem.validateLesson(s.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'pattern.validated' });
      const promotion = mem.requestPromotion('employee:requester', lesson.id, 'COMPANY');
      const reuse = (by: EmployeeRecord): { id: Id; refs: readonly string[] } => {
        const planned = m.planIntervention(s.founder, lesson.id, { kind: 'PATTERN_REUSE', employeeId: by.id });
        assert.equal(planned.outcome, 'PLANNED');
        const id = planned.intervention?.id as Id;
        assert.equal(m.planIntervention(s.founder, lesson.id, { kind: 'PATTERN_REUSE', employeeId: by.id }).outcome, 'AWAIT_EVIDENCE', 'one open reuse per lesson and Employee');
        h.clock.advance(HOUR);
        m.completeTraining(s.founder, id);
        assert.equal(m.assessIntervention(id).intervention.effect, 'NOT_YET_TESTED');
        for (let i = 0; i < 2; i++) {
          h.clock.advance(HOUR);
          laterWork(h, s, m, by, 'SUCCESS');
        }
        const assessed = m.assessIntervention(id).intervention;
        assert.equal(assessed.effect, 'IMPROVEMENT_OBSERVED');
        assert.ok(assessed.evidenceRefs.length > 0 && assessed.evidenceRefs.every((r) => r.startsWith('work_item:')), 'a reuse’s evidence names Work Items');
        return { id, refs: assessed.evidenceRefs };
      };
      const first = reuse(s.employee);
      assert.throws(() => mem.decidePromotion(s.founder, promotion.id, { decision: 'APPROVE', reasonCode: 'share' }), reason('PATTERN_REUSE_NOT_VERIFIED'));
      const second = reuse(s.employee);
      assert.ok(!second.refs.some((r) => first.refs.includes(r)), 'each reuse is judged on its own later work');
      // PG-03: the author's own reuse counts as a verified reuse only with distinct evidence per reuse.
      assert.equal(mem.decidePromotion(s.founder, promotion.id, { decision: 'APPROVE', reasonCode: 'share' }).state, 'APPROVED');
      assert.ok(!contributionRefs(m, s.employee.id).some((r) => r.startsWith('learning_intervention:')), 'reusing one’s own pattern is not a system contribution');
      const byOther = reuse(s.gov.getEmployee(activateSecond(s)));
      assert.ok(contributionRefs(m, s.employee.id).includes(`learning_intervention:${byOther.id}`), 'another Employee’s verified reuse is the author’s contribution');
    });
  });

  test('R2-16: the application gate refuses two "verified" reuses resting on the same evidence (before the datastore has to)', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const mem = MemoryStore.for(h.store);
      const { workItemId } = reviewedWork(h, s, s.employee);
      verify(s, m, workItemId, 'ACHIEVED');
      m.evaluate(workItemId);
      const [signal] = m.signals({ workItemId, kind: 'SUCCESSFUL_PATTERN' });
      const lesson = mem.nominateLesson(s.founder, signal?.observationId as Id, 'pattern.candidate');
      mem.validateLesson(s.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'pattern.validated' });
      const promotion = mem.requestPromotion('employee:requester', lesson.id, 'COMPANY');
      const ctx = storeContext(h.store);
      const at = h.store.now();
      for (const cycle of [1, 2]) {
        ctx.db.immediate('legacy reuse rows', () =>
          ctx.db.run(
            `INSERT INTO learning_interventions (id, lesson_id, employee_id, kind, cycle_no, target_cause, comparable_key, remediation_id, baseline_json, state, effect, effect_basis, evidence_refs_json, training_completed_at, assessed_at, created_by_ref, version, created_at, updated_at)
             VALUES (?, ?, ?, 'PATTERN_REUSE', ?, 'EMPLOYEE_JUDGMENT', 'draft.memo', NULL, '[]', 'EFFECT_ASSESSED', 'IMPROVEMENT_OBSERVED', 'NO_RECURRENCE_ON_QUALIFIED_WORK', ?, ?, ?, 'system:legacy', 1, ?, ?)`,
            newId(), lesson.id, s.employee.id, cycle, JSON.stringify([`work_item:${workItemId}`]), at, at, at, at,
          ),
        );
      }
      assert.throws(() => mem.decidePromotion(s.founder, promotion.id, { decision: 'APPROVE', reasonCode: 'share' }), reason('PATTERN_REUSE_NOT_VERIFIED'));
    });
  });

  test('R2-19: a problem that recurs after its finding was ADDRESSED opens a new linked finding counting only the later evidence', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      const toolFailure = (): void => {
        const { workItemId, claim } = runFor(h, s, s.employee);
        settle(h.store, claim.fence, { type: 'RETRYABLE_FAILURE', code: 'TOOL_NOT_EXECUTED' }, { backoff });
        const r = m.evaluate(workItemId);
        m.decideAttribution(s.founder, r.attributionId as Id, { decision: 'VALIDATE', reasonCode: 'founder.confirmed' });
      };
      for (let i = 0; i < 3; i++) toolFailure();
      const [first] = m.systemicFindings();
      assert.equal(first?.occurrences, 3);
      m.decideSystemicFinding(s.founder, first?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.agreed' });
      h.clock.advance(HOUR);
      m.decideSystemicFinding(s.founder, first?.id as Id, { decision: 'ADDRESSED', reasonCode: 'tool.repaired' });
      AttentionStore.for(h.store).sync();
      for (let i = 0; i < 2; i++) {
        h.clock.advance(HOUR);
        toolFailure();
      }
      assert.equal(m.systemicFindings({ state: 'CANDIDATE' }).length, 0, 'only evidence after the decision counts: two recurrences are below the threshold');
      h.clock.advance(HOUR);
      toolFailure();
      const [again] = m.systemicFindings({ state: 'CANDIDATE' });
      assert.ok(again && again.id !== first?.id, 'a new finding, not a reopened one');
      assert.equal(again.occurrences, 3);
      assert.ok(again.evidenceRefs.includes(`systemic_finding:${first?.id}`), 'linked to the prior finding');
      assert.deepEqual([again.targetKind, again.targetRef, again.cause], [first?.targetKind, first?.targetRef, first?.cause]);
      assert.equal(m.systemicFindings().find((f) => f.id === first?.id)?.state, 'ADDRESSED', 'the decided finding is never rewritten');
      assert.ok(AttentionStore.for(h.store).sync().opened >= 1, 'the recurrence reaches the Founder');
      assert.ok(m.generateReport('WEEKLY').report.claims.some((c) => c.code === 'REPEATED_FAILURE_PATTERN' && c.subject.id === again.id));
    });
  });

  test('R2-19: a second Employee’s exhausted retraining on the same work merges into the open candidate', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const other = s.gov.getEmployee(activateSecond(s));
      const exhaust = (owner: EmployeeRecord): Id | null => {
        const lessonId = validatedMistakeLesson(h, s, m, owner);
        let finding: Id | null = null;
        for (let cycle = 0; cycle < 2; cycle++) {
          const planned = m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' });
          assert.equal(planned.outcome, 'PLANNED');
          h.clock.advance(HOUR);
          m.completeTraining(s.founder, planned.intervention?.id as Id);
          for (let i = 0; i < 2; i++) {
            h.clock.advance(HOUR);
            laterWork(h, s, m, owner, 'RECURRENCE');
          }
          const assessed = m.assessIntervention(planned.intervention?.id as Id);
          assert.equal(assessed.intervention.effect, 'NO_IMPROVEMENT');
          finding = assessed.findingId;
        }
        return finding;
      };
      const exhausted = (): ReturnType<ImprovementStore['systemicFindings']> => m.systemicFindings().filter((f) => f.origin === 'RETRAINING_EXHAUSTED');
      const firstId = exhaust(s.employee);
      const before = exhausted();
      assert.deepEqual(before.map((f) => [f.id, f.state, f.distinctEmployees]), [[firstId, 'CANDIDATE', 1]]);
      assert.equal(exhaust(other), firstId, 'the same open candidate');
      const merged = exhausted();
      assert.equal(merged.length, 1);
      assert.equal(merged[0]?.distinctEmployees, 2);
      assert.ok((merged[0]?.occurrences ?? 0) > (before[0]?.occurrences ?? 0), 'occurrences grow');
      assert.ok(before[0]?.evidenceRefs.every((r) => merged[0]?.evidenceRefs.includes(r)), 'evidence is appended, never replaced');
    });
  });

  test('R2-20: C6 cost is the economic cost the budget ledger charges — a subscription route is not free work', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const card = s.gov.addPriceCard(s.founder, s.deploymentId, { currency: 'USD', billingMode: 'SUBSCRIPTION', billedInputPerMTok: 0, billedOutputPerMTok: 0, billedPerCall: 0, economicInputPerMTok: 2_000_000, economicOutputPerMTok: 8_000_000, economicPerCall: 0 });
      const { workItemId } = reviewedWork(h, s, s.employee, { priceCardId: card.id });
      assert.deepEqual(s.gov.usage({ workItemId }).map((u) => [u.billedMicros, u.economicMicros]), [[0, 600]]);
      verify(s, m, workItemId, 'ACHIEVED');
      const e = m.evaluate(workItemId).evaluation;
      assert.equal(e.cost.productiveMicros, 600, 'the economic cost, not the (zero) bill');
      assert.equal(e.cost.billedMicros, 0, 'the bill is carried separately');
      const economics = m.economics({ employeeId: s.employee.id });
      assert.deepEqual([economics.totalCostMicros, economics.costPerQualifiedOutcomeMicros], [600, 600]);
    });
  });
});

// RR3 (second correction cycle): ONE meaning of adverse evidence in every attribution state (`adverseStanding`).
describe('RR3: adverse evidence has one meaning in every attribution state', () => {
  const founderActions = (h: Harness) => {
    const auth = FounderAuthStore.for(h.store);
    const { token } = auth.mintLaunchToken();
    return { actions: FounderActionStore.for(h.store, auth), session: auth.redeemLaunchToken(token).session };
  };

  test('RR3-A: a Founder REJECT is a decided "no accountable cause" — the effect is INCONCLUSIVE, the next cycle may start, readiness is not held; corrected causes are validated through ATTRIBUTION_DECIDE', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const { actions, session } = founderActions(h);
      const lessonId = validatedMistakeLesson(h, s, m);
      const iid = m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).intervention?.id as Id;
      h.clock.advance(HOUR);
      m.completeTraining(s.founder, iid);
      h.clock.advance(HOUR);
      const recurrence = laterWork(h, s, m, s.employee, 'RECURRENCE', false);
      const proposal = m.attributions({ workItemId: recurrence }).find((a) => a.state === 'PROPOSED');
      assert.ok(proposal);
      assert.throws(() => actions.preview(session, 'ATTRIBUTION_DECIDE', { attributionId: proposal.id, decision: 'REJECT', causes: [{ category: 'TOOL', role: 'PRIMARY', confidence: 'HIGH', basis: 'TOOL_MISCONFIGURED' }] }), code('VALIDATION_FAILED'), 'corrected causes are validated, never rejected');
      const rejectPreview = actions.preview(session, 'ATTRIBUTION_DECIDE', { attributionId: proposal.id, decision: 'REJECT', reasonCode: 'founder.disputed' });
      actions.confirm(session, rejectPreview.id, rejectPreview.fingerprint);
      for (let i = 0; i < 2; i++) {
        h.clock.advance(HOUR);
        laterWork(h, s, m, s.employee, 'SUCCESS');
      }
      const assessed = m.assessIntervention(iid);
      assert.deepEqual([assessed.intervention.effect, assessed.intervention.effectBasis, assessed.changed], ['INCONCLUSIVE', 'ADVERSE_WITHOUT_ACCOUNTABLE_CAUSE', true], 'recorded and non-final — never NOT_YET_TESTED forever, never "no recurrence"');
      assert.ok(assessed.intervention.evidenceRefs.includes(`work_item:${recurrence}`));
      assert.equal(m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).outcome, 'PLANNED', 'the next cycle is not blocked');
      const p = m.profile(s.employee.id);
      const outcome = p.dimensions.find((d) => d.dimension === 'OUTCOME');
      assert.deepEqual([outcome?.pendingAttribution, outcome?.unattributedAdverse], [0, 1], 'decided, disclosed, not pending');
      assert.equal(outcome?.accountableNegative, 1, 'only the lesson work, whose cause was validated, counts against the Employee');
      assert.ok(!p.readiness.reasons.includes('ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'), p.readiness.reasons.join(','));
      const monthly = m.generateReport('MONTHLY').report.claims;
      assert.ok(!monthly.some((c) => c.code === 'ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'));
      assert.equal(monthly.find((c) => c.code === 'ADVERSE_EVIDENCE_WITHOUT_ACCOUNTABLE_CAUSE')?.params.items, 1);
      // The Founder may instead validate CORRECTED causes (structured, API-only), reaching the existing corrected-causes path.
      h.clock.advance(HOUR);
      const disputed = laterWork(h, s, m, s.employee, 'RECURRENCE', false);
      const second = m.attributions({ workItemId: disputed }).find((a) => a.state === 'PROPOSED');
      assert.ok(second);
      assert.throws(() => actions.preview(session, 'ATTRIBUTION_DECIDE', { attributionId: second.id, decision: 'VALIDATE', causes: [{ category: 'TOOL', role: 'PRIMARY', confidence: 'HIGH', basis: 'X' }, { category: 'MODEL', role: 'PRIMARY', confidence: 'HIGH', basis: 'Y' }] }), code('ATTRIBUTION_INVALID'));
      assert.throws(() => actions.preview(session, 'ATTRIBUTION_DECIDE', { attributionId: second.id, decision: 'VALIDATE', causes: [{ category: 'TOOL', role: 'PRIMARY', confidence: 'HIGH', basis: 'free text is refused' }] }), code('ATTRIBUTION_INVALID'));
      const corrected = actions.preview(session, 'ATTRIBUTION_DECIDE', { attributionId: second.id, decision: 'VALIDATE', reasonCode: 'founder.corrected', causes: [{ category: 'TOOL', role: 'PRIMARY', confidence: 'HIGH', basis: 'TOOL_MISCONFIGURED' }] });
      assert.deepEqual(corrected.payload.causes, ['TOOL|PRIMARY|HIGH|TOOL_MISCONFIGURED']);
      const out = actions.confirm(session, corrected.id, corrected.fingerprint);
      const validated = m.attributions({ workItemId: disputed }).find((a) => a.state === 'VALIDATED');
      assert.equal(out.resultRef, `causal_attribution:${validated?.id}`);
      assert.deepEqual([validated?.source, validated?.overall, validated?.employeeAccountable], ['FOUNDER', 'TOOL', false]);
      assert.equal(m.attributions({ workItemId: disputed }).find((a) => a.id === second.id)?.state, 'SUPERSEDED');
    });
  });

  test('RR3-B: a negative on work where no attribution is due (provider fallback cost) is never "pending" — it holds no readiness and is not disclosed as pending', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const { workItemId } = reviewedWork(h, s, s.employee, { fallbacks: 2 });
      verify(s, m, workItemId, 'ACHIEVED');
      const r = m.evaluate(workItemId);
      assert.equal(r.evaluation.dimensions.find((d) => d.dimension === 'EFFICIENCY')?.verdict, 'NEGATIVE');
      assert.deepEqual([r.attributionId, m.attributions({ workItemId }).length], [null, 0], 'nothing adverse happened: no attribution can ever exist');
      const p = m.profile(s.employee.id);
      const efficiency = p.dimensions.find((d) => d.dimension === 'EFFICIENCY');
      assert.deepEqual([efficiency?.pendingAttribution, efficiency?.notAttributable, efficiency?.accountableNegative], [0, 1, 0]);
      assert.ok(!p.readiness.reasons.includes('ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'), p.readiness.reasons.join(','));
      assert.ok(!m.generateReport('MONTHLY').report.claims.some((c) => c.code === 'ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'));
    });
  });

  test('RR3-E / FB-1 matrix 2 + 8: the same mistake truly made after the training on work started before it is a recurrence — and only the post-training event counts', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const lessonId = validatedMistakeLesson(h, s, m);
      const iid = m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).intervention?.id as Id;
      // Comparable work started BEFORE the training: its first output fails review.
      const { workItemId: w, claim } = runFor(h, s, s.employee, { reviewPlan: PLAN });
      settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
      decideOpenReview(h, w, 'FAIL');
      h.clock.advance(HOUR);
      m.completeTraining(s.founder, iid);
      h.clock.advance(HOUR);
      // AFTER the training the Employee reworks it and makes the same mistake; the cause is validated as theirs.
      const again = claimItem(h, w, 'w-rework-after-training');
      settle(h.store, again.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v2' } }, { backoff });
      decideOpenReview(h, w, 'PASS');
      verify(s, m, w, 'NOT_ACHIEVED');
      m.evaluate(w);
      m.decideAttribution(s.founder, m.attributions({ workItemId: w }).find((a) => a.state === 'PROPOSED')?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.confirmed' });
      for (let i = 0; i < 2; i++) {
        h.clock.advance(HOUR);
        laterWork(h, s, m, s.employee, 'SUCCESS');
      }
      const judged = m.assessIntervention(iid).intervention;
      assert.deepEqual([judged.effect, judged.effectBasis], ['NO_IMPROVEMENT', 'SAME_MISTAKE_RECURRED']);
      assert.ok(judged.evidenceRefs.includes(`work_item:${w}`));
      // FB-1: the recurrence is the post-training NOT_ACHIEVED outcome (of the output made after the training); the
      // failed review of the pre-training output is not.
      const verification = m.evaluation(w)?.evidenceRefs.find((r) => r.startsWith('outcome_verification:'));
      assert.ok(verification && judged.evidenceRefs.includes(verification), JSON.stringify(judged.evidenceRefs));
      const failed = failedReviewRefs(h, w);
      assert.equal(failed.length, 1);
      assert.ok(failed.every((r) => !judged.evidenceRefs.includes(r)), 'the pre-training mistake is never a recurrence');
    });
  });
});

/** The counting FAILED review decisions of a Work Item, as source references. */
function failedReviewRefs(h: Harness, workItemId: Id): string[] {
  const rv = ReviewStore.for(h.store);
  return rv.requests({ workItemId }).flatMap((r) => rv.decisions(r.id)).filter((d) => d.outcome === 'FAIL').map((d) => `review_decision:${d.id}`);
}

/** The effect assessment the store recorded last for an intervention (its audit: counts only — Rule A). */
function assessedCounts(h: Harness, interventionId: Id): { followups: number; recurrences: number } | undefined {
  const rows = h.store.audit(interventionId).filter((x) => x.action === 'learning.effect_assessed');
  const d = rows.at(-1)?.details as { followups?: number; recurrences?: number } | undefined;
  return d ? { followups: Number(d.followups), recurrences: Number(d.recurrences) } : undefined;
}

// FB-1 (R2 Architecture Closure Correction): learning-effect chronology belongs to the SOURCE EVIDENCE EVENT — never the
// Work Item's final state, its evaluation, or its attribution's decision.
describe('FB-1: learning is timed by the event that happened, not the date someone judged it', () => {
  /** Comparable work started BEFORE the training (a lesson's intervention): its output fails review `preFails` times, all before it. */
  const startBeforeTraining = (h: Harness, s: Seed, preFails: number): { w: Id; claim: Claim } => {
    const { workItemId: w, claim } = runFor(h, s, s.employee, { reviewPlan: PLAN });
    settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
    for (let i = 0; i < preFails; i++) {
      decideOpenReview(h, w, 'FAIL');
      h.clock.advance(60_000);
      const again = claimItem(h, w, `w-pre-${i}`);
      settle(h.store, again.fence, { type: 'COMPLETED', evidence: { summaryCode: `draft.v${i + 2}` } }, { backoff });
    }
    return { w, claim };
  };
  const train = (h: Harness, s: Seed, m: ImprovementStore, iid: Id): void => {
    h.clock.advance(HOUR);
    m.completeTraining(s.founder, iid);
    h.clock.advance(HOUR);
  };
  const twoLaterSuccesses = (h: Harness, s: Seed, m: ImprovementStore): Id[] =>
    [0, 1].map(() => {
      h.clock.advance(HOUR);
      return laterWork(h, s, m, s.employee, 'SUCCESS');
    });

  test('matrix 1 (the FB-1 probe): mistakes all made before the training, finished correctly after it, truly attributed after it — never a recurrence', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const lessonId = validatedMistakeLesson(h, s, m);
      const iid = m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).intervention?.id as Id;
      // Two failed reviews, both of pre-training output.
      const { w } = startBeforeTraining(h, s, 1);
      decideOpenReview(h, w, 'FAIL');
      train(h, s, m, iid);
      // AFTER the training: reworked correctly — review PASS, outcome ACHIEVED.
      const after = claimItem(h, w, 'w-rework-after-training');
      settle(h.store, after.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v3' } }, { backoff });
      decideOpenReview(h, w, 'PASS');
      verify(s, m, w, 'ACHIEVED');
      const e = m.evaluate(w).evaluation;
      assert.equal(e.dimensions.find((d) => d.dimension === 'QUALITY')?.verdict, 'NEGATIVE', 'the Work-Item-level verdict is adverse — it cannot tell WHEN');
      // The proposal is TRUE (the output was rejected twice — before the training): validated after the training.
      m.decideAttribution(s.founder, m.attributions({ workItemId: w }).find((a) => a.state === 'PROPOSED')?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.confirmed' });
      const later = twoLaterSuccesses(h, s, m);
      const judged = m.assessIntervention(iid).intervention;
      assert.deepEqual([judged.effect, judged.effectBasis], ['IMPROVEMENT_OBSERVED', 'NO_RECURRENCE_ON_QUALIFIED_WORK'], 'never NO_IMPROVEMENT SAME_MISTAKE_RECURRED');
      assert.ok(!judged.evidenceRefs.includes(`work_item:${w}`), 'the pre-training mistakes are not evidence about the training');
      assert.deepEqual([...judged.evidenceRefs].sort(), later.map((x) => `work_item:${x}`).sort());
      assert.deepEqual(assessedCounts(h, iid), { followups: 2, recurrences: 0 });
    });
  });

  test('matrix 1: a failed review DECIDED after the training of output PRODUCED before it stays a pre-training event', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const lessonId = validatedMistakeLesson(h, s, m);
      const iid = m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).intervention?.id as Id;
      const { w } = startBeforeTraining(h, s, 0);
      train(h, s, m, iid);
      decideOpenReview(h, w, 'FAIL'); // reviewed after the training; the output was made before it
      const after = claimItem(h, w, 'w-rework-after-training');
      settle(h.store, after.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v2' } }, { backoff });
      decideOpenReview(h, w, 'PASS');
      verify(s, m, w, 'ACHIEVED');
      m.evaluate(w);
      m.decideAttribution(s.founder, m.attributions({ workItemId: w }).find((a) => a.state === 'PROPOSED')?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.confirmed' });
      twoLaterSuccesses(h, s, m);
      const judged = m.assessIntervention(iid).intervention;
      assert.equal(judged.effect, 'IMPROVEMENT_OBSERVED');
      assert.ok(!judged.evidenceRefs.includes(`work_item:${w}`));
    });
  });

  test('matrix 3: work started before the training and completed cleanly after it is neither positive nor negative evidence', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const lessonId = validatedMistakeLesson(h, s, m);
      const iid = m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).intervention?.id as Id;
      const { w } = startBeforeTraining(h, s, 0);
      train(h, s, m, iid);
      decideOpenReview(h, w, 'PASS');
      verify(s, m, w, 'ACHIEVED');
      m.evaluate(w);
      h.clock.advance(HOUR);
      laterWork(h, s, m, s.employee, 'SUCCESS');
      const one = m.assessIntervention(iid);
      assert.deepEqual([one.intervention.effect, one.changed], ['NOT_YET_TESTED', false], 'the older work is not a second follow-up');
      h.clock.advance(HOUR);
      const second = laterWork(h, s, m, s.employee, 'SUCCESS');
      const judged = m.assessIntervention(iid).intervention;
      assert.equal(judged.effect, 'IMPROVEMENT_OBSERVED');
      assert.ok(!judged.evidenceRefs.includes(`work_item:${w}`) && judged.evidenceRefs.includes(`work_item:${second}`), 'no credit for finishing older work');
    });
  });

  test('matrix 7: the Founder validates CORRECTED causes after the training — the events keep their original (pre-training) time', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const lessonId = validatedMistakeLesson(h, s, m);
      const iid = m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).intervention?.id as Id;
      const { w } = startBeforeTraining(h, s, 1);
      decideOpenReview(h, w, 'FAIL');
      train(h, s, m, iid);
      const after = claimItem(h, w, 'w-rework-after-training');
      settle(h.store, after.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v3' } }, { backoff });
      decideOpenReview(h, w, 'PASS');
      verify(s, m, w, 'ACHIEVED');
      m.evaluate(w);
      const proposal = m.attributions({ workItemId: w }).find((a) => a.state === 'PROPOSED');
      assert.ok(proposal);
      const corrected = m.decideAttribution(s.founder, proposal.id, { decision: 'VALIDATE', reasonCode: 'founder.corrected', causes: [{ category: 'EMPLOYEE_JUDGMENT', role: 'PRIMARY', confidence: 'HIGH', basis: 'SKIPPED_SOURCING' }] }).attribution;
      assert.deepEqual([corrected.source, corrected.state, corrected.employeeAccountable], ['FOUNDER', 'VALIDATED', true]);
      assert.deepEqual(corrected.evidenceRefs, proposal.evidenceRefs, 'the corrected attribution explains the same source events');
      twoLaterSuccesses(h, s, m);
      const judged = m.assessIntervention(iid).intervention;
      assert.equal(judged.effect, 'IMPROVEMENT_OBSERVED', 'a correction decided after the training never moves a pre-training event after it');
      assert.ok(!judged.evidenceRefs.includes(`work_item:${w}`));
    });
  });

  test('matrix 9: re-evaluations and another definition code over the same source events make ONE recurrence', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const lessonId = validatedMistakeLesson(h, s, m);
      const iid = m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).intervention?.id as Id;
      train(h, s, m, iid);
      const recurrence = laterWork(h, s, m, s.employee, 'RECURRENCE');
      for (let v = 0; v < 2; v++) {
        h.clock.advance(60_000);
        activate(s, m);
        assert.equal(m.evaluate(recurrence).changed, true, 'a new definition version re-evaluates (supersedes) the work');
      }
      activate(s, m, standardWorkOutcomeDefinition('work-outcome.alternate'));
      m.evaluate(recurrence, { definitionCode: 'work-outcome.alternate' });
      h.clock.advance(HOUR);
      laterWork(h, s, m, s.employee, 'SUCCESS');
      const judged = m.assessIntervention(iid).intervention;
      assert.equal(judged.effect, 'NO_IMPROVEMENT');
      assert.deepEqual(assessedCounts(h, iid), { followups: 2, recurrences: 1 });
      assert.equal(new Set(judged.evidenceRefs).size, judged.evidenceRefs.length, 'every source is named once');
      assert.equal(judged.evidenceRefs.filter((r) => r === `work_item:${recurrence}`).length, 1);
    });
  });

  test('matrix 10: a mistake whose act spans the training boundary cannot be placed — INCONCLUSIVE, never a final NO_IMPROVEMENT / REGRESSION', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const lessonId = validatedMistakeLesson(h, s, m);
      const iid = m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).intervention?.id as Id;
      // The run starts before the training and delivers its (failing) output after it.
      const { workItemId: w, claim } = runFor(h, s, s.employee, { reviewPlan: PLAN });
      h.clock.advance(60_000);
      m.completeTraining(s.founder, iid);
      h.clock.advance(60_000);
      settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
      decideOpenReview(h, w, 'FAIL');
      h.clock.advance(HOUR);
      const after = claimItem(h, w, 'w-rework-after-training');
      settle(h.store, after.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v2' } }, { backoff });
      decideOpenReview(h, w, 'PASS');
      verify(s, m, w, 'ACHIEVED');
      m.evaluate(w);
      m.decideAttribution(s.founder, m.attributions({ workItemId: w }).find((a) => a.state === 'PROPOSED')?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.confirmed' });
      twoLaterSuccesses(h, s, m);
      const judged = m.assessIntervention(iid).intervention;
      assert.deepEqual([judged.effect, judged.effectBasis], ['INCONCLUSIVE', 'ADVERSE_EVENT_NOT_PLACEABLE']);
      assert.equal(m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).outcome, 'PLANNED', 'non-final: the next cycle is not blocked');
    });
  });

  test('matrix 12: the corrected effect is what LEARNING_VELOCITY, retraining exhaustion and systemic escalation consume', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const lessonId = validatedMistakeLesson(h, s, m);
      const findings: (Id | null)[] = [];
      // Two retraining cycles, each judged beside work whose every mistake was made before that cycle's training.
      for (let cycle = 0; cycle < 2; cycle++) {
        h.clock.advance(HOUR);
        const planned = m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' });
        assert.equal(planned.outcome, 'PLANNED', `cycle ${cycle + 1} is planned`);
        const iid = planned.intervention?.id as Id;
        const { w } = startBeforeTraining(h, s, 1);
        decideOpenReview(h, w, 'FAIL');
        train(h, s, m, iid);
        const after = claimItem(h, w, `w-after-${cycle}`);
        settle(h.store, after.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v3' } }, { backoff });
        decideOpenReview(h, w, 'PASS');
        verify(s, m, w, 'ACHIEVED');
        m.evaluate(w);
        m.decideAttribution(s.founder, m.attributions({ workItemId: w }).find((a) => a.state === 'PROPOSED')?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.confirmed' });
        twoLaterSuccesses(h, s, m);
        const assessed = m.assessIntervention(iid);
        assert.equal(assessed.intervention.effect, 'IMPROVEMENT_OBSERVED', `cycle ${cycle + 1}`);
        findings.push(assessed.findingId);
      }
      assert.deepEqual(findings, [null, null], 'retraining is never "exhausted" by mistakes made before it');
      assert.equal(m.systemicFindings().filter((f) => f.origin === 'RETRAINING_EXHAUSTED').length, 0, 'no systemic escalation');
      assert.equal(m.planIntervention(s.founder, lessonId, { kind: 'TARGETED_RETRAINING' }).outcome, 'PLANNED', 'the retraining bound is not consumed');
      const velocity = m.profile(s.employee.id).dimensions.find((d) => d.dimension === 'LEARNING_VELOCITY');
      assert.deepEqual([velocity?.positive, velocity?.accountableNegative], [2, 0]);
    });
  });

  test('B2: an undecided proposal is re-proposed when new adverse source events arrive — whoever decides it decides every event it explains', () => {
    withSeed((h, s, m) => {
      activate(s, m);
      activeReviewer(h, s);
      const { workItemId: w, claim } = runFor(h, s, s.employee, { reviewPlan: PLAN });
      settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
      decideOpenReview(h, w, 'FAIL');
      m.evaluate(w);
      const first = m.attributions({ workItemId: w }).find((a) => a.state === 'PROPOSED');
      assert.ok(first);
      const again = claimItem(h, w, 'w-rework-1');
      settle(h.store, again.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v2' } }, { backoff });
      decideOpenReview(h, w, 'FAIL');
      const third = claimItem(h, w, 'w-rework-2');
      settle(h.store, third.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v3' } }, { backoff });
      decideOpenReview(h, w, 'PASS');
      verify(s, m, w, 'ACHIEVED');
      m.evaluate(w);
      const live = m.attributions({ workItemId: w }).find((a) => a.state === 'PROPOSED');
      assert.ok(live);
      assert.deepEqual(live.causes, first.causes, 'the same proposed causes');
      assert.notEqual(live.id, first.id, 'yet a new proposal: the second failure is new evidence to decide');
      assert.equal(m.attributions({ workItemId: w }).find((a) => a.id === first.id)?.state, 'SUPERSEDED');
      const failed = failedReviewRefs(h, w);
      assert.equal(failed.length, 2);
      assert.ok(failed.every((r) => live.evidenceRefs.includes(r)), 'the live proposal holds every failed review it will decide');
      // Unchanged evidence re-evaluates to nothing new (no churn).
      assert.equal(m.evaluate(w).changed, false);
    });
  });
});

function activateSecond(s: Seed): Id {
  // A second ACTIVE, budgeted, granted Employee of the same role (the C2 fixture path).
  const e = hire(s.gov, s.founder, s.departmentId, true, s.employee.roleRef);
  s.gov.createBudget(s.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 500_000, capTokens: 500_000, reasonCode: 'seed' });
  grantAll(s.gov, s.founder, e.id);
  return e.id;
}
