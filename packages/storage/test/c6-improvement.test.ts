/**
 * C6 storage proofs: the Eval Registry calibrates its own evaluator, completion is not success, outcome
 * verification is governed evidence, evaluations are idempotent evidence records, attribution separates the
 * Employee from the system, reflection is a hypothesis, patterns are candidate-first, interventions are judged
 * on later evidence, reports carry typed claims and no score, and systemic findings reach Founder Attention.
 * All through the real C1–C5 paths (Review Pool, Founder chokepoint, lesson lifecycle). C6-PROOF: storage-improvement
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, type Id } from '@qandeel-company/domain';
import { standardWorkOutcomeDefinition } from '@qandeel-company/mind';

import { AttentionStore, ImprovementStore, MemoryStore, ReviewStore, type EmployeeRecord } from '../src/index.js';
import { settle } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { grantAll, hire, seed, type Seed } from './c2-helpers.js';
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

function activate(s: Seed, m: ImprovementStore): Id {
  const d = m.registerDefinition(s.founder, standardWorkOutcomeDefinition());
  const run = m.calibrateDefinition(s.founder, d.id);
  assert.equal(run.passed, true);
  return m.activateDefinition(s.founder, d.id, run.id).id;
}

const PLAN = reviewPlan({ appliesTo: 'OUTPUT' });

/** Runs one output-reviewed Work Item to REVIEWED; optionally with one failed review first and a reflection. */
function reviewedWork(h: Harness, s: Seed, owner: EmployeeRecord, opts: { failFirst?: boolean; reflection?: string } = {}): { workItemId: Id; observationId: Id | null } {
  const rv = ReviewStore.for(h.store);
  const { workItemId, claim } = runFor(h, s, owner, { reviewPlan: PLAN });
  let observationId: Id | null = null;
  if (opts.reflection) observationId = (propose(h, claim, 1, { kind: 'OBSERVATION', memoryClass: null, topic: 'drafting.figures', content: opts.reflection }).decided?.resultLessonId ?? null) as Id | null;
  settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
  const decide = (outcome: 'PASS' | 'FAIL'): void => {
    const request = rv.requests({ workItemId }).find((r) => r.state === 'OPEN');
    const key = request ? rv.assignments(request.id).find((a) => a.keyKind === 'SPECIALIST' && a.state === 'ASSIGNED') : undefined;
    assert.ok(key?.reviewWorkItemId, 'a counting reviewer is assigned');
    decideAssignment(h, key.reviewWorkItemId, outcome);
  };
  if (opts.failFirst) {
    decide('FAIL');
    const again = claimItem(h, workItemId, `w-rework-${workItemId.slice(0, 6)}`);
    settle(h.store, again.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.v2' } }, { backoff });
  }
  decide('PASS');
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
    });
  });
});

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

function activateSecond(s: Seed): Id {
  // A second ACTIVE, budgeted, granted Employee of the same role (the C2 fixture path).
  const e = hire(s.gov, s.founder, s.departmentId, true, s.employee.roleRef);
  s.gov.createBudget(s.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 500_000, capTokens: 500_000, reasonCode: 'seed' });
  grantAll(s.gov, s.founder, e.id);
  return e.id;
}
