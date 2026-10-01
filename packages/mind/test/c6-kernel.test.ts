/**
 * C6 Company Improvement Engine — kernel proofs (evaluation, attribution, profile, learning, reporting).
 * C6-PROOF: improvement-kernel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError } from '@qandeel-company/domain';

import {
  adverseStanding,
  assertClaim,
  assessLearningEffect,
  attributionDue,
  buildPerformanceProfile,
  calibrateDefinition,
  composeReport,
  costPerQualifiedOutcome,
  detectSystemicCandidates,
  disjointVerifiedReuses,
  evaluateWork,
  eventPhase,
  learningValidationGate,
  nearMissCodes,
  nextInterventionDecision,
  NO_EXTERNAL_OUTCOME_FACTS,
  patternExpansionAllowed,
  proposeAttribution,
  reportedSystemicCandidate,
  retrainingMaterial,
  reviewerMetaEvaluation,
  standardReferenceCases,
  standardWorkOutcomeDefinition,
  systemicContributor,
  type AdverseSourceEvent,
  type EvaluationFact,
  type FollowupFact,
  type LearningEffect,
  type ReportFacts,
  type WorkEvidence,
} from '../src/index.js';

const req = <T>(x: T | undefined): T => {
  assert.ok(x !== undefined);
  return x;
};
const def = standardWorkOutcomeDefinition();
const good = (): WorkEvidence => req(standardReferenceCases().find((c) => c.kind === 'KNOWN_GOOD')).evidence;
const withEv = (patch: Partial<WorkEvidence>): WorkEvidence => ({ ...good(), ...patch });

let seq = 0;
const fact = (patch: Partial<EvaluationFact> = {}): EvaluationFact => {
  seq++;
  return {
    evaluationId: `e${seq}`,
    workItemId: `w${seq}`,
    comparableKey: 'growth.brief',
    riskLevel: 'R1',
    at: new Date(Date.UTC(2026, 8, 1) + seq * 3_600_000).toISOString(),
    evidenceState: 'SUFFICIENT_EVIDENCE',
    qualifiedOutcome: true,
    verdicts: { OUTCOME: 'POSITIVE', QUALITY: 'POSITIVE', EFFICIENCY: 'POSITIVE', INDEPENDENCE: 'POSITIVE' },
    cost: { productiveMicros: 1_000, overheadMicros: 0 },
    activity: { messages: 1, toolCalls: 1, tokens: 10, runs: 1 },
    attributionDue: false,
    ...patch,
  };
};
const AT = '2026-09-30T00:00:00.000Z';
const profileOf = (evaluations: EvaluationFact[], attributions: Parameters<typeof buildPerformanceProfile>[0]['attributions'] = []) =>
  buildPerformanceProfile({ employeeId: 'emp', at: AT, evaluations, attributions, learningEffects: [], contributions: { validatedPatterns: [], verifiedPatternReuses: [], validatedSystemicFindings: [] } });
function reportBase(cadence: ReportFacts['cadence']): ReportFacts {
  return {
    cadence,
    period: { from: '2026-09-23T00:00:00.000Z', to: AT },
    verifications: [{ id: 'v1', workItemId: 'w1', verdict: 'ACHIEVED' }],
    failedWork: [],
    deadLetters: [],
    reconciliationHeld: [],
    decisionsRequired: [],
    resilienceExceptions: [],
    goals: [],
    evaluations: [fact()],
    previousEvaluations: [],
    lessons: { validated: [], patterns: [], nearMisses: [] },
    systemic: [],
    effects: [],
    profiles: [],
    reviewers: [],
    capabilityGaps: [],
    recertificationDue: [],
    departmentGaps: [],
    minSample: 3,
    external: NO_EXTERNAL_OUTCOME_FACTS,
  };
}

describe('C6 evaluation: evidence before judgement', () => {
  test('COMPLETED alone is not a qualified success', () => {
    const e = evaluateWork({ ...def, requiredEvidence: ['WORK_LINEAGE'] }, withEv({ reviewed: false, outcome: null, review: { pass: 0, fail: 0, uncertain: 0, insufficient: 0, rework: 0, openConflict: false } }));
    assert.equal(e.qualifiedOutcome, false);
    assert.equal(req(e.dimensions.find((d) => d.dimension === 'OUTCOME')).basis, 'COMPLETION_IS_NOT_SUCCESS');
    assert.equal(req(e.dimensions.find((d) => d.dimension === 'OUTCOME')).verdict, 'NOT_ASSESSED');
  });
  test('reviewed + outcome-verified work is qualified', () => {
    const e = evaluateWork(def, good());
    assert.equal(e.evidenceState, 'SUFFICIENT_EVIDENCE');
    assert.equal(e.qualifiedOutcome, true);
  });
  test('missing required evidence stays INSUFFICIENT_EVIDENCE with no verdict', () => {
    const e = evaluateWork(def, withEv({ evidenceClasses: ['WORK_LINEAGE'] }));
    assert.equal(e.evidenceState, 'INSUFFICIENT_EVIDENCE');
    assert.deepEqual(e.missingEvidence, ['REVIEW_DECISION', 'OUTCOME_VERIFICATION']);
    assert.ok(e.dimensions.every((d) => d.verdict === 'NOT_ASSESSED'));
  });
  test('contradictory evidence is CONFLICTING_EVIDENCE, never averaged', () => {
    const e = evaluateWork(def, withEv({ outcome: 'NOT_ACHIEVED' }));
    assert.equal(e.evidenceState, 'CONFLICTING_EVIDENCE');
    assert.ok(e.conflicts.includes('REVIEW_PASSED_OUTCOME_FAILED'));
  });
  test('activity volume never changes a verdict', () => {
    const a = evaluateWork(def, good());
    const b = evaluateWork(def, withEv({ activity: { messages: 900, toolCalls: 900, tokens: 9_000_000, runs: 90 } }));
    assert.deepEqual(a, b);
  });
  test('busy but unverified work earns no positive verdict: activity is observability, not performance', () => {
    const e = evaluateWork({ ...def, requiredEvidence: ['WORK_LINEAGE'] }, withEv({ reviewed: false, outcome: null, review: { pass: 0, fail: 0, uncertain: 0, insufficient: 0, rework: 0, openConflict: false }, activity: { messages: 400, toolCalls: 400, tokens: 1_000_000, runs: 40 } }));
    assert.ok(!e.dimensions.some((d) => d.verdict === 'POSITIVE'), JSON.stringify(e.dimensions));
  });
  test('a valid creative path is initiative, not a defect', () => {
    const e = evaluateWork(def, withEv({ route: { planned: ['a', 'b'], taken: ['c'] } }));
    assert.equal(req(e.dimensions.find((d) => d.dimension === 'INITIATIVE')).verdict, 'POSITIVE');
    assert.ok(!e.dimensions.some((d) => d.verdict === 'NEGATIVE'));
  });
  test('efficiency is never credited to an unqualified (cheap) failure', () => {
    const e = evaluateWork(def, withEv({ outcome: 'NOT_ACHIEVED', reviewed: false, review: { pass: 0, fail: 1, uncertain: 0, insufficient: 0, rework: 0, openConflict: false }, cost: { ...good().cost, productiveMicros: 1 } }));
    assert.equal(req(e.dimensions.find((d) => d.dimension === 'EFFICIENCY')).verdict, 'NOT_ASSESSED');
  });
  test('m-31: work with no recorded cost is not "efficient" — efficiency is not assessed without cost evidence', () => {
    const e = evaluateWork(def, withEv({ cost: { ...good().cost, productiveMicros: 0 } }));
    assert.equal(e.qualifiedOutcome, true);
    assert.deepEqual([req(e.dimensions.find((d) => d.dimension === 'EFFICIENCY')).verdict, req(e.dimensions.find((d) => d.dimension === 'EFFICIENCY')).basis], ['NOT_ASSESSED', 'NO_COST_EVIDENCE']);
  });
  test('a MODEL_GRADER definition has no executable evaluator and fails closed', () => {
    assert.throws(() => evaluateWork({ ...def, evaluatorKind: 'MODEL_GRADER' }, good()), /EVAL_INVALID/);
    assert.equal(calibrateDefinition({ ...def, evaluatorKind: 'MODEL_GRADER' }).passed, false);
  });
});

describe('C6 attribution: a bad outcome is not automatically the Employee', () => {
  test('tool failure is TOOL, not employee judgement', () => {
    const a = proposeAttribution(withEv({ outcome: 'NOT_ACHIEVED', reviewed: false, failures: { ...good().failures, tool: 1 }, runs: { total: 1, failed: 1, retried: 0 } }));
    assert.equal(a.overall, 'TOOL');
    assert.equal(a.employeeAccountable, false);
  });
  test('context and provider failures together are MIXED, still not the Employee', () => {
    const a = proposeAttribution(withEv({ outcome: 'NOT_ACHIEVED', reviewed: false, failures: { ...good().failures, context: 1, provider: 1 } }));
    assert.equal(a.overall, 'MIXED');
    assert.equal(a.employeeAccountable, false);
  });
  test('a rejected output with no system cause is employee judgement', () => {
    const a = proposeAttribution(withEv({ outcome: 'NOT_ACHIEVED', reviewed: false, review: { pass: 0, fail: 1, uncertain: 0, insufficient: 0, rework: 0, openConflict: false } }));
    assert.equal(a.overall, 'EMPLOYEE_JUDGMENT');
    assert.equal(a.employeeAccountable, true);
  });
  test('nothing adverse needs no attribution', () => assert.equal(proposeAttribution(good()).needed, false));
  test('R2-13: a recovered tool failure never exonerates a merits failure; an unrecovered one still does', () => {
    const merits = { outcome: 'NOT_ACHIEVED' as const, reviewed: false, review: { pass: 0, fail: 1, uncertain: 0, insufficient: 0, rework: 1, openConflict: false }, runs: { total: 3, failed: 1, retried: 1 } };
    const recovered = proposeAttribution(withEv({ ...merits, recoveredFailures: { ...good().recoveredFailures, tool: 1 } }));
    assert.equal(req(recovered.causes.find((c) => c.role === 'PRIMARY')).category, 'EMPLOYEE_JUDGMENT');
    assert.equal(recovered.employeeAccountable, true);
    assert.deepEqual(recovered.causes.filter((c) => c.category === 'TOOL').map((c) => [c.role, c.confidence]), [['CONTRIBUTING', 'LOW']]);
    const unrecovered = proposeAttribution(withEv({ ...merits, failures: { ...good().failures, tool: 1 } }));
    assert.deepEqual([unrecovered.overall, unrecovered.employeeAccountable], ['TOOL', false]);
    // Nothing but a recovered attempt went wrong: the failed attempt's own cause, never the Employee.
    const transient = proposeAttribution(withEv({ runs: { total: 2, failed: 1, retried: 1 }, recoveredFailures: { ...good().recoveredFailures, tool: 1 } }));
    assert.deepEqual([transient.overall, transient.employeeAccountable], ['TOOL', false]);
  });
});

describe('C6 meta-evaluation: the grader is evaluated too', () => {
  test('the standard definition passes all five reference kinds', () => {
    const r = calibrateDefinition(def);
    assert.equal(r.passed, true, JSON.stringify(r.cases));
    assert.deepEqual(r.missingKinds, []);
  });
  test('R2-13: the standard calibration carries a recovered-tool-failure merits case the evaluator must attribute to the Employee', () => {
    const c = req(calibrateDefinition(def).cases.find((x) => x.id === 'recovered-tool-failure'));
    assert.deepEqual([c.kind, c.pass], ['KNOWN_BAD', true], c.observed);
    const ev = req(def.referenceCases.find((x) => x.id === 'recovered-tool-failure')).evidence;
    assert.deepEqual([ev.failures.tool, ev.recoveredFailures.tool], [0, 1]);
  });
  test('a grader that answers ambiguous evidence confidently fails its own calibration', () => {
    const guessing = def.referenceCases.map((c) => (c.kind === 'AMBIGUOUS' ? { ...c, evidence: good() } : c));
    const r = calibrateDefinition({ ...def, referenceCases: guessing });
    assert.equal(r.passed, false);
    assert.equal(req(r.cases.find((c) => c.kind === 'AMBIGUOUS')).pass, false);
  });
  test('a definition missing a reference kind cannot calibrate', () => {
    const r = calibrateDefinition({ ...def, referenceCases: def.referenceCases.filter((c) => c.kind !== 'AMBIGUOUS') });
    assert.equal(r.passed, false);
    assert.deepEqual(r.missingKinds, ['AMBIGUOUS']);
  });
  test('a broken expectation (ambiguous evidence labelled known-good) fails calibration', () => {
    const cases = def.referenceCases.map((c) => (c.kind === 'KNOWN_GOOD' ? { ...c, evidence: req(def.referenceCases.find((x) => x.kind === 'AMBIGUOUS')).evidence } : c));
    assert.equal(calibrateDefinition({ ...def, referenceCases: cases }).passed, false);
  });
});

describe('C6 performance profile: multi-dimensional, no score, minimum sample', () => {
  test('one excellent task is INSUFFICIENT_EVIDENCE, not an excellent employee', () => {
    const p = profileOf([fact()]);
    assert.equal(req(p.dimensions.find((d) => d.dimension === 'OUTCOME')).state, 'INSUFFICIENT_EVIDENCE');
    assert.equal(p.readiness.signal, 'INSUFFICIENT_EVIDENCE');
  });
  test('the profile carries no aggregate score, rank or total', () => {
    const p = profileOf([fact(), fact(), fact()]);
    const keys = JSON.stringify(p).match(/"([a-zA-Z]+)":/g) ?? [];
    assert.ok(!keys.some((k) => /score|rank|overall|leaderboard|rating/i.test(k)), keys.join(','));
    assert.equal(p.dimensions.length, 8);
  });
  test('a negative with a validated non-employee cause is excluded; unattributed is pending', () => {
    const bad1 = fact({ qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE' }, attributionDue: true });
    const bad2 = fact({ qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE' }, attributionDue: true });
    const p = profileOf([bad1, bad2, fact(), fact(), fact()], [{ workItemId: bad1.workItemId, state: 'VALIDATED', employeeAccountable: false, overall: 'TOOL' }]);
    const o = req(p.dimensions.find((d) => d.dimension === 'OUTCOME'));
    assert.equal(o.accountableNegative, 0);
    assert.equal(o.excludedNonEmployee, 1);
    assert.equal(o.pendingAttribution, 1);
  });
  test('activity volume alone never makes a good profile', () => {
    const busy = Array.from({ length: 6 }, () => fact({ evidenceState: 'INSUFFICIENT_EVIDENCE', qualifiedOutcome: false, verdicts: {}, activity: { messages: 500, toolCalls: 500, tokens: 1e6, runs: 50 } }));
    const p = profileOf(busy);
    assert.ok(p.dimensions.every((d) => d.positive === 0));
    assert.equal(p.observability.messages, 3000);
    assert.equal(p.readiness.signal, 'INSUFFICIENT_EVIDENCE');
  });
  test('capability and regression are separate signals', () => {
    const early = [fact(), fact(), fact()];
    const lateBad = [fact({ qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE' } }), fact({ qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE' } }), fact({ qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE' } })];
    const attrs = lateBad.map((f) => ({ workItemId: f.workItemId, state: 'VALIDATED' as const, employeeAccountable: true, overall: 'EMPLOYEE_JUDGMENT' }));
    const p = profileOf([...early, ...lateBad], attrs);
    assert.equal(p.capabilities.length, 1);
    assert.equal(p.regressions.length, 1);
  });
  test('R2-18: adverse evidence whose cause is pending (PROPOSED, or due and not yet recorded) is never read as clean', () => {
    const successes = Array.from({ length: 10 }, (_, i) => fact({ riskLevel: 'R2', verdicts: { OUTCOME: 'POSITIVE', QUALITY: 'POSITIVE', EFFICIENCY: 'POSITIVE', INITIATIVE: 'POSITIVE', INDEPENDENCE: 'POSITIVE' }, evaluationId: `ok${i}` }));
    const failures = Array.from({ length: 20 }, () => fact({ riskLevel: 'R2', qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE', QUALITY: 'NEGATIVE', INDEPENDENCE: 'NEGATIVE' }, attributionDue: true }));
    // Ten causes still PROPOSED; ten due and never recorded (absent).
    const p = profileOf([...successes, ...failures], failures.slice(0, 10).map((f) => ({ workItemId: f.workItemId, state: 'PROPOSED' as const, employeeAccountable: true, overall: 'EMPLOYEE_JUDGMENT' })));
    const outcome = req(p.dimensions.find((d) => d.dimension === 'OUTCOME'));
    assert.deepEqual([outcome.sample, outcome.pendingAttribution], [10, 20]);
    assert.equal(outcome.level, null, 'more pending adverse evidence than counted evidence: no level');
    assert.equal(outcome.trend, 'TREND_NOT_ESTABLISHED');
    assert.equal(p.readiness.signal, 'NOT_READY');
    assert.ok(p.readiness.reasons.includes('ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'), p.readiness.reasons.join(','));
    // The monthly review discloses the pending evidence and recommends nothing.
    const monthly = composeReport({ ...reportBase('MONTHLY'), profiles: [p] });
    assert.ok(!monthly.claims.some((c) => c.code === 'CONSIDER_GREATER_RESPONSIBILITY_REVIEW'));
    const disclosed = req(monthly.claims.find((c) => c.code === 'ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'));
    assert.equal(disclosed.subject.id, 'emp');
    assert.equal(disclosed.evidenceRefs.length, 20);
  });
  test('readiness is a signal for review, never a decision', () => {
    const facts = Array.from({ length: 6 }, (_, i) => fact({ riskLevel: i === 0 ? 'R2' : 'R1', verdicts: { OUTCOME: 'POSITIVE', QUALITY: 'POSITIVE', INDEPENDENCE: 'POSITIVE', INITIATIVE: 'POSITIVE' } }));
    const p = profileOf(facts);
    assert.equal(p.readiness.signal, 'READY_FOR_GREATER_RESPONSIBILITY_REVIEW', p.readiness.reasons.join(','));
    assert.equal(p.readiness.isDecision, false);
  });
  const readyBase = (): EvaluationFact[] => Array.from({ length: 6 }, (_, i) => fact({ riskLevel: i === 0 ? 'R2' : 'R1', verdicts: { OUTCOME: 'POSITIVE', QUALITY: 'POSITIVE', INDEPENDENCE: 'POSITIVE', INITIATIVE: 'POSITIVE' } }));
  test('RR3-B: only adverse evidence an attribution is due for (or still undecided on) is pending; a non-adverse negative never holds readiness', () => {
    // Qualified work whose provider fallbacks cost more than the productive call, or that needed a Founder intervention:
    // negative EFFICIENCY / INDEPENDENCE verdicts, but nothing adverse happened, so no attribution is ever due.
    for (const over of [{ EFFICIENCY: 'NEGATIVE' as const }, { INDEPENDENCE: 'NEGATIVE' as const }]) {
      const odd = fact({ verdicts: { OUTCOME: 'POSITIVE', QUALITY: 'POSITIVE', INITIATIVE: 'POSITIVE', INDEPENDENCE: 'POSITIVE', ...over }, attributionDue: false });
      const p = profileOf([...readyBase(), odd]);
      const d = req(p.dimensions.find((x) => x.dimension === Object.keys(over)[0]));
      assert.deepEqual([d.pendingAttribution, d.notAttributable, d.accountableNegative], [0, 1, 0], JSON.stringify(over));
      assert.equal(p.readiness.signal, 'READY_FOR_GREATER_RESPONSIBILITY_REVIEW', p.readiness.reasons.join(','));
      assert.ok(!composeReport({ ...reportBase('MONTHLY'), profiles: [p] }).claims.some((c) => c.code === 'ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'));
    }
    // The same negative is pending where an attribution is due, or where one exists and is undecided.
    const due = fact({ qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE' }, attributionDue: true });
    assert.ok(profileOf([...readyBase(), due]).readiness.reasons.includes('ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'));
    const proposed = fact({ verdicts: { OUTCOME: 'POSITIVE', QUALITY: 'POSITIVE', EFFICIENCY: 'NEGATIVE' }, attributionDue: false });
    assert.ok(profileOf([...readyBase(), proposed], [{ workItemId: proposed.workItemId, state: 'PROPOSED', employeeAccountable: true, overall: 'EMPLOYEE_JUDGMENT' }]).readiness.reasons.includes('ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'));
    // The evaluator's predicate: an adverse outcome with a cause to propose — never for such qualified work.
    const fallbackHeavy: WorkEvidence = withEv({ interventions: { escalations: 0, correctEscalations: 0, founder: 1 }, cost: { ...good().cost, productiveMicros: 100, fallbackMicros: 500, billedMicros: 600 } });
    const verdicts = Object.fromEntries(evaluateWork(def, fallbackHeavy).dimensions.map((d) => [d.dimension, d.verdict]));
    assert.deepEqual([verdicts.EFFICIENCY, verdicts.INDEPENDENCE], ['NEGATIVE', 'NEGATIVE']);
    assert.equal(attributionDue(fallbackHeavy), false, 'no cause can be proposed: nothing adverse happened');
    const failed = withEv({ outcome: 'NOT_ACHIEVED', reviewed: false, review: { pass: 0, fail: 1, uncertain: 0, insufficient: 0, rework: 0, openConflict: false } });
    assert.deepEqual([attributionDue(failed), proposeAttribution(failed).causes.length > 0], [true, true]);
  });
  test('RR3-A: every attribution state has ONE meaning; a REJECTED cause is decided — disclosed, never pending, never counted', () => {
    const rejected = fact({ qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE', QUALITY: 'NEGATIVE' }, attributionDue: true });
    const p = profileOf([...readyBase(), rejected], [{ workItemId: rejected.workItemId, state: 'REJECTED', employeeAccountable: true, overall: 'EMPLOYEE_JUDGMENT' }]);
    const outcome = req(p.dimensions.find((d) => d.dimension === 'OUTCOME'));
    assert.deepEqual([outcome.pendingAttribution, outcome.unattributedAdverse, outcome.accountableNegative], [0, 1, 0]);
    assert.deepEqual(outcome.unattributedEvidenceRefs, [`evaluation:${rejected.evaluationId}`]);
    assert.ok(!p.readiness.reasons.includes('ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'), p.readiness.reasons.join(','));
    const monthly = composeReport({ ...reportBase('MONTHLY'), profiles: [p] });
    assert.ok(!monthly.claims.some((c) => c.code === 'ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'));
    assert.deepEqual(req(monthly.claims.find((c) => c.code === 'ADVERSE_EVIDENCE_WITHOUT_ACCOUNTABLE_CAUSE')).evidenceRefs, [`evaluation:${rejected.evaluationId}`], 'disclosed, never hidden');
    // The one definition, every state.
    const st = (state: 'PROPOSED' | 'VALIDATED' | 'REJECTED' | 'NONE', employeeAccountable: boolean, due: boolean) => adverseStanding({ attributionDue: due, state, employeeAccountable });
    assert.deepEqual(
      [st('VALIDATED', true, true), st('VALIDATED', false, true), st('PROPOSED', true, false), st('NONE', false, true), st('REJECTED', true, true), st('REJECTED', false, false), st('NONE', false, false)],
      ['ACCOUNTABLE', 'NOT_EMPLOYEE', 'PENDING_ATTRIBUTION', 'PENDING_ATTRIBUTION', 'NO_ACCOUNTABLE_CAUSE', 'NO_ACCOUNTABLE_CAUSE', 'NOT_ATTRIBUTABLE'],
    );
  });
});

describe('C6 cost per qualified outcome', () => {
  test('a cheap unqualified failure has no defined cost per qualified outcome', () => {
    const cheap = costPerQualifiedOutcome([fact({ qualifiedOutcome: false, cost: { productiveMicros: 10, overheadMicros: 0 } })]);
    assert.equal(cheap.costPerQualifiedOutcomeMicros, null);
    assert.equal(cheap.state, 'NO_QUALIFIED_OUTCOME');
  });
  test('R2-20: economics are economic cost; the provider bill is carried beside it, never instead of it', () => {
    const c = costPerQualifiedOutcome([fact({ cost: { productiveMicros: 600, overheadMicros: 0, billedMicros: 0 } })]);
    assert.deepEqual([c.totalCostMicros, c.billedMicros, c.costPerQualifiedOutcomeMicros], [600, 0, 600]);
  });
  test('failed and rework cost is charged to the qualified outcomes', () => {
    const c = costPerQualifiedOutcome([fact({ cost: { productiveMicros: 1_000, overheadMicros: 500 } }), fact({ qualifiedOutcome: false, cost: { productiveMicros: 500, overheadMicros: 0 } })]);
    assert.equal(c.costPerQualifiedOutcomeMicros, 2_000);
  });
});

describe('C6 learning closure', () => {
  test('a reflection cannot become validated learning without a validated attribution', () => {
    assert.equal(learningValidationGate({ source: 'REFLECTION', kind: 'SUCCESSFUL_PATTERN', attribution: null, qualifiedEvaluation: false }).allowed, false);
    assert.equal(learningValidationGate({ source: 'REFLECTION', kind: 'SUCCESSFUL_PATTERN', attribution: null, qualifiedEvaluation: true }).allowed, true);
    assert.equal(learningValidationGate({ source: 'REFLECTION', kind: 'MISTAKE_LESSON', attribution: { state: 'PROPOSED', employeeAccountable: true }, qualifiedEvaluation: false }).allowed, false);
    assert.equal(learningValidationGate({ source: 'ATTRIBUTION', kind: 'MISTAKE_LESSON', attribution: { state: 'VALIDATED', employeeAccountable: false }, qualifiedEvaluation: false }).reason, 'CAUSE_IS_NOT_THE_EMPLOYEE');
    assert.equal(learningValidationGate({ source: 'REFLECTION', kind: 'MISTAKE_LESSON', attribution: { state: 'VALIDATED', employeeAccountable: true }, qualifiedEvaluation: false }).allowed, true);
    assert.equal(learningValidationGate({ source: 'REFLECTION', kind: 'NEAR_MISS_WARNING', attribution: null, qualifiedEvaluation: true }).allowed, false);
  });
  test('a successful pattern expands beyond its author only after verified reuse', () => {
    assert.equal(patternExpansionAllowed('PERSONAL', 0).allowed, true);
    assert.equal(patternExpansionAllowed('COMPANY', 1).allowed, false);
    assert.equal(patternExpansionAllowed('COMPANY', 2).allowed, true);
  });
  test('a near miss is recognised without recasting the achieved outcome as failure', () => {
    const ev = withEv({ review: { pass: 1, fail: 1, uncertain: 0, insufficient: 0, rework: 1, openConflict: false }, gateCatches: 1 });
    assert.deepEqual(nearMissCodes(ev), ['REVIEW_CAUGHT_BEFORE_RELEASE', 'GATE_STOPPED_A_RISK']);
    assert.equal(ev.outcome, 'ACHIEVED');
  });
  const follow = (patch: Partial<FollowupFact>): FollowupFact => ({ ...fact({ at: '2026-09-20T00:00:00.000Z' }), workStartedAt: '2026-09-20T00:00:00.000Z', attributionState: 'NONE', accountableCauses: [], adverseEvents: [], ...patch });
  // FB-1: an adverse source event — by default a failed review of output produced AFTER the training (2026-09-10),
  // validated as the Employee's own judgement.
  let evSeq = 0;
  const event = (patch: Partial<AdverseSourceEvent> = {}): AdverseSourceEvent => {
    evSeq++;
    return { sourceRef: `review_decision:d${evSeq}`, kind: 'REVIEW_DECISION', actStartedAt: '2026-09-12T00:00:00.000Z', actEndedAt: '2026-09-12T01:00:00.000Z', attributionRef: `causal_attribution:a${evSeq}`, attributionState: 'VALIDATED', attributionDue: true, accountableCauses: ['EMPLOYEE_JUDGMENT'], attributionUnresolved: false, ...patch };
  };
  const BEFORE = { actStartedAt: '2026-09-04T00:00:00.000Z', actEndedAt: '2026-09-04T01:00:00.000Z' };
  test('training completed is not improvement: later comparable evidence decides', () => {
    assert.equal(assessLearningEffect({ trainingCompletedAt: '2026-09-10T00:00:00.000Z', targetCause: 'EMPLOYEE_JUDGMENT', comparableKey: 'growth.brief', baseline: [], followups: [] }).effect, 'NOT_YET_TESTED');
    assert.equal(assessLearningEffect({ trainingCompletedAt: null, targetCause: 'EMPLOYEE_JUDGMENT', comparableKey: 'growth.brief', baseline: [], followups: [follow({}), follow({})] }).effect, 'NOT_YET_TESTED');
    assert.equal(assessLearningEffect({ trainingCompletedAt: '2026-09-10T00:00:00.000Z', targetCause: 'EMPLOYEE_JUDGMENT', comparableKey: 'growth.brief', baseline: [], followups: [follow({}), follow({})] }).effect, 'IMPROVEMENT_OBSERVED');
    const recurred = assessLearningEffect({ trainingCompletedAt: '2026-09-10T00:00:00.000Z', targetCause: 'EMPLOYEE_JUDGMENT', comparableKey: 'growth.brief', baseline: [follow({ accountableCauses: ['EMPLOYEE_JUDGMENT'] })], followups: [follow({ qualifiedOutcome: false, adverseEvents: [event()] }), follow({})] });
    assert.equal(recurred.effect, 'NO_IMPROVEMENT');
  });
  test('R2-15: "later" is when the work started, not when it was evaluated; evidence names the Work Items', () => {
    const trained = '2026-09-10T00:00:00.000Z';
    // Work started before the training, evaluated after it: never later evidence.
    const early = [follow({ workStartedAt: '2026-09-05T00:00:00.000Z' }), follow({ workStartedAt: '2026-09-06T00:00:00.000Z' })];
    assert.equal(assessLearningEffect({ trainingCompletedAt: trained, targetCause: 'EMPLOYEE_JUDGMENT', comparableKey: 'growth.brief', baseline: [], followups: early }).effect, 'NOT_YET_TESTED');
    const later = [follow({}), follow({})];
    const judged = assessLearningEffect({ trainingCompletedAt: trained, targetCause: 'EMPLOYEE_JUDGMENT', comparableKey: 'growth.brief', baseline: [], followups: [...early, ...later] });
    assert.equal(judged.effect, 'IMPROVEMENT_OBSERVED');
    assert.deepEqual(judged.evidenceRefs, later.map((f) => `work_item:${f.workItemId}`));
  });
  test('R2-17: an adverse follow-up whose cause is pending keeps the effect open', () => {
    const adverse = (attributionState: AdverseSourceEvent['attributionState']): FollowupFact => follow({ qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE', QUALITY: 'NEGATIVE' }, attributionDue: true, adverseEvents: [event({ attributionState, accountableCauses: [] })] });
    const run = (f: FollowupFact) => assessLearningEffect({ trainingCompletedAt: '2026-09-10T00:00:00.000Z', targetCause: 'EMPLOYEE_JUDGMENT', comparableKey: 'growth.brief', baseline: [], followups: [f, follow({}), follow({})] });
    for (const state of ['NONE', 'PROPOSED'] as const) assert.deepEqual([run(adverse(state)).effect, run(adverse(state)).basis], ['NOT_YET_TESTED', 'ATTRIBUTION_PENDING'], state);
    // Validated as someone else's cause (not a recurrence): the effect is decided.
    assert.equal(run(adverse('VALIDATED')).effect, 'IMPROVEMENT_OBSERVED');
    assert.equal(run(follow({ qualifiedOutcome: false, adverseEvents: [event()] })).effect, 'NO_IMPROVEMENT');
  });
  test('RR3-A / FB-1 matrix 6: an adverse event whose cause was REJECTED is decided — the effect is INCONCLUSIVE (recorded, non-final, reassessable), never untested forever and never "no recurrence"', () => {
    const run = (f: FollowupFact) => assessLearningEffect({ trainingCompletedAt: '2026-09-10T00:00:00.000Z', targetCause: 'EMPLOYEE_JUDGMENT', comparableKey: 'growth.brief', baseline: [], followups: [f, follow({}), follow({})] });
    for (const e of [event({ attributionState: 'REJECTED', accountableCauses: [] }), event({ attributionState: 'NONE', attributionDue: false, accountableCauses: [], attributionRef: null })]) {
      const f = follow({ qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE' }, adverseEvents: [e] });
      assert.deepEqual([run(f).effect, run(f).basis, run(f).recurrences], ['INCONCLUSIVE', 'ADVERSE_WITHOUT_ACCOUNTABLE_CAUSE', 0], e.attributionState);
    }
    // INCONCLUSIVE does not block the next cycle.
    assert.equal(nextInterventionDecision(['INCONCLUSIVE']).decision, 'ALLOW_INTERVENTION');
  });

  describe('FB-1: learning is timed by the event that happened, not the date someone judged it', () => {
    const T = '2026-09-10T00:00:00.000Z';
    const spanning = (patch: Partial<FollowupFact>): FollowupFact => follow({ workStartedAt: '2026-09-04T00:00:00.000Z', ...patch });
    const assess = (followups: FollowupFact[], baseline: FollowupFact[] = [follow({ accountableCauses: ['EMPLOYEE_JUDGMENT'] })]) =>
      assessLearningEffect({ trainingCompletedAt: T, targetCause: 'EMPLOYEE_JUDGMENT', comparableKey: 'growth.brief', baseline, followups });
    test('eventPhase: before = the act ended by the training; after = it started after; spanning or unknown = unplaceable', () => {
      assert.equal(eventPhase(BEFORE, T), 'BEFORE_TRAINING');
      assert.equal(eventPhase({ actStartedAt: '2026-09-09T23:00:00.000Z', actEndedAt: T }, T), 'BEFORE_TRAINING');
      assert.equal(eventPhase({ actStartedAt: '2026-09-10T00:00:00.001Z', actEndedAt: '2026-09-10T00:00:00.001Z' }, T), 'AFTER_TRAINING');
      assert.equal(eventPhase({ actStartedAt: '2026-09-09T00:00:00.000Z', actEndedAt: '2026-09-11T00:00:00.000Z' }, T), 'UNPLACEABLE');
      assert.equal(eventPhase({ actStartedAt: null, actEndedAt: null }, T), 'UNPLACEABLE');
      assert.equal(eventPhase({ actStartedAt: null, actEndedAt: '2026-09-11T00:00:00.000Z' }, T), 'UNPLACEABLE');
    });
    test('matrix 1: mistakes made BEFORE the training, reviewed / evaluated / attributed after it, are never a recurrence', () => {
      // Two failed reviews of pre-training output, a validated (true) attribution of them, the work finished correctly after.
      const f1 = spanning({ verdicts: { OUTCOME: 'POSITIVE', QUALITY: 'NEUTRAL' }, attributionState: 'VALIDATED', accountableCauses: ['EMPLOYEE_JUDGMENT'], adverseEvents: [event(BEFORE), event(BEFORE)] });
      const later = [follow({}), follow({})];
      const r = assess([f1, ...later]);
      assert.deepEqual([r.effect, r.basis, r.recurrences], ['IMPROVEMENT_OBSERVED', 'NO_RECURRENCE_ON_QUALIFIED_WORK', 0]);
      assert.ok(!r.evidenceRefs.includes(`work_item:${f1.workItemId}`), 'the pre-training mistakes are not evidence about the training');
      // Even an adverse item-level verdict does not move a pre-training event after the training.
      const g = assess([{ ...f1, verdicts: { OUTCOME: 'NEGATIVE', QUALITY: 'NEGATIVE' }, qualifiedOutcome: false }, ...later]);
      assert.deepEqual([g.effect, g.recurrences], ['IMPROVEMENT_OBSERVED', 0]);
    });
    test('matrix 2: work started before the training whose same mistake truly recurs after it is a recurrence', () => {
      const w = spanning({ qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE', QUALITY: 'NEGATIVE' }, adverseEvents: [event({ kind: 'OUTCOME_VERIFICATION', sourceRef: 'outcome_verification:v1' })] });
      const r = assess([w, follow({}), follow({})]);
      assert.deepEqual([r.effect, r.basis, r.recurrences], ['NO_IMPROVEMENT', 'SAME_MISTAKE_RECURRED', 1]);
      assert.ok(r.evidenceRefs.includes(`work_item:${w.workItemId}`) && r.evidenceRefs.includes('outcome_verification:v1'));
    });
    test('matrix 3: work started before the training and finished cleanly after it is neither positive nor negative evidence', () => {
      const clean = spanning({});
      const withOldMistake = spanning({ adverseEvents: [event(BEFORE)] });
      const only = assess([clean, withOldMistake]);
      assert.deepEqual([only.effect, only.basis, only.followups], ['NOT_YET_TESTED', 'NO_COMPARABLE_WORK_YET', 0], 'no credit for finishing older work');
      const one = assess([clean, withOldMistake, follow({})]);
      assert.deepEqual([one.effect, one.basis, one.followups], ['NOT_YET_TESTED', 'TOO_FEW_SUFFICIENT_FOLLOWUPS', 1], 'not counted as a follow-up either');
    });
    test('matrix 4: work started after the training that became a qualified outcome is eligible positive evidence', () => {
      const later = [follow({}), follow({})];
      const r = assess(later);
      assert.deepEqual([r.effect, r.followups, r.evidenceRefs], ['IMPROVEMENT_OBSERVED', 2, later.map((f) => `work_item:${f.workItemId}`)]);
      assert.deepEqual([assess([follow({ qualifiedOutcome: false }), follow({})]).effect], ['INCONCLUSIVE'], 'unqualified later work proves nothing');
    });
    test('matrix 5: an adverse event after the training whose attribution is PROPOSED (or due and missing) is pending — never clean', () => {
      for (const e of [event({ attributionState: 'PROPOSED', accountableCauses: [] }), event({ attributionState: 'NONE', attributionRef: null, accountableCauses: [] })]) {
        const r = assess([follow({ adverseEvents: [e] }), follow({}), follow({})]);
        assert.deepEqual([r.effect, r.basis], ['NOT_YET_TESTED', 'ATTRIBUTION_PENDING'], e.attributionState);
      }
      // Also on older work: a post-training event of spanning work holds the effect open.
      const r = assess([spanning({ adverseEvents: [event({ attributionState: 'PROPOSED', accountableCauses: [] })] }), follow({}), follow({})]);
      assert.deepEqual([r.effect, r.basis], ['NOT_YET_TESTED', 'ATTRIBUTION_PENDING']);
    });
    test('matrix 7: a Founder-corrected attribution explains its events at their ORIGINAL time', () => {
      // The corrected (Founder) attribution was decided after the training; the events it explains happened before.
      const corrected = spanning({ adverseEvents: [event({ ...BEFORE, attributionRef: 'causal_attribution:founder-corrected' })] });
      assert.deepEqual([assess([corrected, follow({}), follow({})]).effect, assess([corrected, follow({}), follow({})]).recurrences], ['IMPROVEMENT_OBSERVED', 0]);
      const correctedAfter = spanning({ adverseEvents: [event({ attributionRef: 'causal_attribution:founder-corrected' })] });
      assert.equal(assess([correctedAfter, follow({}), follow({})]).recurrences, 1);
    });
    test('matrix 8: one pre- and one post-training adverse event on the same work — only the post-training one counts', () => {
      const pre = event({ ...BEFORE, sourceRef: 'review_decision:pre' });
      const post = event({ sourceRef: 'outcome_verification:post', kind: 'OUTCOME_VERIFICATION' });
      const r = assess([spanning({ qualifiedOutcome: false, adverseEvents: [pre, post] }), follow({}), follow({})]);
      assert.deepEqual([r.effect, r.recurrences], ['NO_IMPROVEMENT', 1]);
      assert.ok(r.evidenceRefs.includes('outcome_verification:post') && !r.evidenceRefs.includes('review_decision:pre'));
      // The post-training event decides: REJECTED there → INCONCLUSIVE, whatever the validated pre-training one says.
      const rejectedPost = assess([spanning({ qualifiedOutcome: false, adverseEvents: [pre, { ...post, attributionState: 'REJECTED', accountableCauses: [] }] }), follow({}), follow({})]);
      assert.deepEqual([rejectedPost.effect, rejectedPost.recurrences], ['INCONCLUSIVE', 0]);
    });
    test('matrix 9: one source event is never multiplied — duplicates (re-evaluations, repeated reads) count once; the share unit is the Work Item', () => {
      const e = event({ sourceRef: 'review_decision:same' });
      const w = follow({ qualifiedOutcome: false, adverseEvents: [e, { ...e }] });
      const r = assess([w, { ...w, evaluationId: 'e-superseding' }, follow({}), follow({})]);
      assert.deepEqual([r.recurrences, r.followups, r.evidenceRefs.filter((x) => x === 'review_decision:same').length], [1, 3, 1]);
      // Two distinct events of one Work Item: one recurring Work Item (share unit), both events named.
      const two = assess([follow({ qualifiedOutcome: false, adverseEvents: [event({ sourceRef: 'run:r1', kind: 'RUN_FAILURE' }), event({ sourceRef: 'run:r2', kind: 'RUN_FAILURE' })] }), follow({})]);
      assert.deepEqual([two.recurrences, two.evidenceRefs.filter((x) => x.startsWith('run:')).length], [1, 2]);
    });
    test('matrix 10: an event that cannot be placed in time, an unresolved attribution, or adverse work without provenance never yields a final NO_IMPROVEMENT / REGRESSION', () => {
      const straddling = event({ actStartedAt: '2026-09-09T00:00:00.000Z', actEndedAt: '2026-09-11T00:00:00.000Z' });
      for (const f of [spanning({ qualifiedOutcome: false, adverseEvents: [straddling] }), follow({ qualifiedOutcome: false, adverseEvents: [event({ attributionUnresolved: true, attributionState: 'NONE', attributionDue: false, accountableCauses: [] })] }), follow({ qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE' }, adverseEvents: [] })]) {
        const r = assess([f, follow({}), follow({})]);
        assert.deepEqual([r.effect, r.basis], ['INCONCLUSIVE', 'ADVERSE_EVENT_NOT_PLACEABLE']);
      }
      // A definite recurrence beside unplaceable ones: final only when no placement could change it.
      const recurring = follow({ qualifiedOutcome: false, adverseEvents: [event()] });
      const unplaceable = spanning({ qualifiedOutcome: false, adverseEvents: [straddling] });
      // Baseline share 1/3: one definite recurrence of four (1/4) is below it, but with the unplaceable one (2/4) above it.
      const third = [follow({ accountableCauses: ['EMPLOYEE_JUDGMENT'] }), follow({}), follow({})];
      const open = assess([recurring, unplaceable, follow({}), follow({})], third);
      assert.deepEqual([open.effect, open.basis, open.recurrences], ['INCONCLUSIVE', 'RECURRENCE_SHARE_NOT_ESTABLISHED', 1]);
      assert.equal(assess([recurring, unplaceable, follow({}), follow({})], [follow({ accountableCauses: ['EMPLOYEE_JUDGMENT'] })]).effect, 'NO_IMPROVEMENT', 'even every unplaceable one counted cannot exceed the baseline');
      assert.equal(assess([recurring, unplaceable, follow({})], [follow({})]).effect, 'REGRESSION', 'the definite recurrences alone exceed the baseline');
    });
    test('matrix 11: the baseline recurrence share is unchanged — read from the evidence that justified the lesson', () => {
      const recurring = follow({ qualifiedOutcome: false, adverseEvents: [event()] });
      assert.equal(assess([recurring, follow({})], [follow({ accountableCauses: ['EMPLOYEE_JUDGMENT'] })]).effect, 'NO_IMPROVEMENT', 'later share 1/2 ≤ baseline 1');
      assert.equal(assess([recurring, follow({})], [follow({ accountableCauses: ['EMPLOYEE_JUDGMENT'] }), follow({}), follow({})]).effect, 'REGRESSION', 'later share 1/2 > baseline 1/3');
      assert.equal(assess([recurring, follow({})], []).effect, 'NO_IMPROVEMENT', 'no baseline = share 1');
    });
    test('matrix 12: the corrected effect is what retraining exhaustion and LEARNING_VELOCITY consume', () => {
      // Two cycles each judged on work whose every mistake was pre-training: never ineffective, never exhausted.
      const cycle = (): LearningEffect => assess([spanning({ qualifiedOutcome: false, verdicts: { OUTCOME: 'POSITIVE', QUALITY: 'NEGATIVE' }, adverseEvents: [event(BEFORE), event(BEFORE)] }), follow({}), follow({})]).effect;
      const effects = [cycle(), cycle()];
      assert.deepEqual(effects, ['IMPROVEMENT_OBSERVED', 'IMPROVEMENT_OBSERVED']);
      assert.equal(nextInterventionDecision(effects).decision, 'ALLOW_INTERVENTION');
      const p = buildPerformanceProfile({ employeeId: 'emp', at: AT, evaluations: [], attributions: [], learningEffects: effects.map((effect, i) => ({ interventionId: `i${i}`, effect })), contributions: { validatedPatterns: [], verifiedPatternReuses: [], validatedSystemicFindings: [] } });
      const lv = req(p.dimensions.find((d) => d.dimension === 'LEARNING_VELOCITY'));
      assert.deepEqual([lv.positive, lv.accountableNegative, lv.level], [2, 0, 'STRONG']);
      // True post-training recurrences in two cycles still exhaust retraining (escalation is kept, not weakened).
      const real = (): LearningEffect => assess([spanning({ qualifiedOutcome: false, adverseEvents: [event()] }), follow({})]).effect;
      assert.equal(nextInterventionDecision([real(), real()]).decision, 'ESCALATE_SYSTEMIC');
    });
  });
  test('R2-16: verified reuses count only on pairwise-disjoint evidence', () => {
    assert.equal(disjointVerifiedReuses([['work_item:a', 'work_item:b'], ['work_item:a', 'work_item:b']]), 1, 'the same evidence twice is one reuse');
    assert.equal(disjointVerifiedReuses([['work_item:a', 'work_item:b'], ['work_item:b', 'work_item:c']]), 1);
    assert.equal(disjointVerifiedReuses([['work_item:a', 'work_item:b'], ['work_item:b'], ['work_item:c', 'work_item:d']]), 2);
    assert.equal(disjointVerifiedReuses([[], []]), 0, 'a reuse with no evidence counts for nothing');
    assert.equal(patternExpansionAllowed('COMPANY', disjointVerifiedReuses([['work_item:a'], ['work_item:a']])).allowed, false);
  });
  test('repeated ineffective retraining escalates instead of looping', () => {
    assert.equal(nextInterventionDecision([]).decision, 'ALLOW_INTERVENTION');
    assert.equal(nextInterventionDecision(['NOT_YET_TESTED']).decision, 'AWAIT_EVIDENCE');
    assert.equal(nextInterventionDecision(['NO_IMPROVEMENT']).decision, 'ALLOW_INTERVENTION');
    assert.equal(nextInterventionDecision(['NO_IMPROVEMENT', 'REGRESSION']).decision, 'ESCALATE_SYSTEMIC');
  });
  test('repeated employee-judgement failures across Employees point at the workflow', () => {
    const f = (i: number, emp: string) => ({ attributionId: `a${i}`, workItemId: `w${i}`, employeeId: emp, comparableKey: 'growth.brief', overall: 'EMPLOYEE_JUDGMENT' as const, causes: [{ category: 'EMPLOYEE_JUDGMENT' as const, role: 'PRIMARY' as const, confidence: 'MEDIUM' as const, basis: 'X' }] });
    assert.deepEqual(detectSystemicCandidates([f(1, 'a'), f(2, 'a'), f(3, 'a')]), []);
    const c = detectSystemicCandidates([f(1, 'a'), f(2, 'b'), f(3, 'a')]);
    assert.equal(c.length, 1);
    assert.equal(req(c[0]).targetKind, 'WORKFLOW');
  });
  test('RB-1: two VALIDATED generations of ONE Work Item are one systemic occurrence, not two', () => {
    const f = (i: number, workItemId: string, emp: string) => ({ attributionId: `a${i}`, workItemId, employeeId: emp, comparableKey: 'growth.brief', overall: 'TOOL' as const, causes: [{ category: 'TOOL' as const, role: 'PRIMARY' as const, confidence: 'MEDIUM' as const, basis: 'X' }] });
    const three = [f(1, 'w1', 'a'), f(2, 'w2', 'b'), f(3, 'w3', 'a')];
    assert.equal(req(detectSystemicCandidates(three)[0]).occurrences, 3);
    // w1 holds a second validated generation: still three Work Items, and two Work Items alone never reach the bound.
    assert.equal(req(detectSystemicCandidates([...three, f(4, 'w1', 'a')])[0]).occurrences, 3);
    assert.deepEqual(detectSystemicCandidates([f(1, 'w1', 'a'), f(4, 'w1', 'a'), f(2, 'w2', 'b')]), []);
  });
  test('a reported systemic problem needs a validated system cause, credits only a reflecting author, and is never a lesson', () => {
    const a = (category: 'TOOL' | 'EMPLOYEE_JUDGMENT') => ({ attributionId: 'a1', workItemId: 'w1', employeeId: 'emp', comparableKey: 'growth.brief', overall: category, causes: [{ category, role: 'PRIMARY' as const, confidence: 'HIGH' as const, basis: 'X' }] });
    assert.throws(() => reportedSystemicCandidate({ signalId: 's', observationId: 'o', attribution: null }), (e: unknown) => isQandeelError(e) && e.details.reason === 'ATTRIBUTION_NOT_VALIDATED');
    assert.throws(() => reportedSystemicCandidate({ signalId: 's', observationId: 'o', attribution: a('EMPLOYEE_JUDGMENT') }), (e: unknown) => isQandeelError(e) && e.details.reason === 'CAUSE_IS_THE_EMPLOYEE');
    const c = reportedSystemicCandidate({ signalId: 's', observationId: 'o', attribution: a('TOOL') });
    assert.equal(c.targetKind, 'TOOL');
    assert.deepEqual(c.evidenceRefs, ['learning_signal:s', 'lesson:o', 'causal_attribution:a1']);
    assert.equal(systemicContributor({ source: 'REFLECTION', observationEmployeeId: 'emp' }), 'emp');
    for (const source of ['ATTRIBUTION', 'REVIEW', 'GATE_CATCH', 'EVALUATION'] as const) assert.equal(systemicContributor({ source, observationEmployeeId: 'emp' }), null);
    assert.equal(learningValidationGate({ source: 'REFLECTION', kind: 'SYSTEMIC_PROBLEM', attribution: { state: 'VALIDATED', employeeAccountable: false }, qualifiedEvaluation: true }).reason, 'SYSTEMIC_PROBLEM_IS_A_FINDING');
  });
  test('hidden holdout / Gold cases are never retraining material', () => {
    assert.deepEqual(retrainingMaterial([{ caseId: 'r', stage: 'REGRESSION_CASE', hidden: false }, { caseId: 'g', stage: 'GOLD_CASE', hidden: true }, { caseId: 'h', stage: 'REGRESSION_CASE', hidden: true }]), ['r']);
  });
});

describe('C6 reviewer meta-evaluation', () => {
  test('false approvals and drift are measured from later outcomes', () => {
    const d = (i: number, outcome: 'PASS' | 'FAIL', later: 'ACHIEVED' | 'NOT_ACHIEVED' | null) => ({ decisionId: `d${i}`, qualificationId: 'q', workItemId: `w${i}`, outcome, counts: true, at: AT, laterOutcome: later, overturned: false });
    const m = reviewerMetaEvaluation([d(1, 'PASS', 'NOT_ACHIEVED'), d(2, 'PASS', 'NOT_ACHIEVED'), d(3, 'PASS', 'ACHIEVED'), d(4, 'PASS', 'ACHIEVED'), d(5, 'PASS', 'ACHIEVED')], []);
    assert.equal(req(m[0]).falseApprovals, 2);
    assert.ok(req(m[0]).concerns.includes('FALSE_APPROVALS'));
  });
});

describe('C6 reporting semantics', () => {
  const base = reportBase;
  test('an assessment without evidence or uncertainty is refused', () => {
    assert.throws(() => assertClaim({ code: 'X', kind: 'ASSESSMENT', subject: { kind: 'COMPANY', id: null }, params: {}, evidenceRefs: [], uncertainty: { state: 'SUFFICIENT_EVIDENCE', confidence: 'LOW', sample: 3 } }), /EVIDENCE_REQUIRED/);
    assert.throws(() => assertClaim({ code: 'X', kind: 'TREND', subject: { kind: 'COMPANY', id: null }, params: {}, evidenceRefs: ['e:1'], uncertainty: null }), /EVIDENCE_REQUIRED/);
    assert.throws(() => assertClaim({ code: 'X', kind: 'FACT', subject: { kind: 'COMPANY', id: null }, params: { employeeScore: 91 }, evidenceRefs: ['e:1'], uncertainty: null }), /no universal score/);
  });
  test('weekly: improvement is not claimed on insufficient evidence; external outcomes are unavailable', () => {
    const r = composeReport(base('WEEKLY'));
    assert.equal(req(r.claims[0]).code, 'IMPROVEMENT_NOT_ESTABLISHED');
    assert.equal(req(r.claims[0]).kind, 'FACT');
    assert.ok(r.claims.some((c) => c.code === 'EXTERNAL_OUTCOMES_UNAVAILABLE'));
    assert.ok(r.claims.every((c) => c.kind === 'FACT' || c.uncertainty !== null));
  });
  test('daily brief lists facts with their evidence; deterministic', () => {
    const a = composeReport(base('DAILY'));
    assert.deepEqual(a, composeReport(base('DAILY')));
    assert.deepEqual(req(a.claims[0]).evidenceRefs, ['outcome_verification:v1']);
  });
});
