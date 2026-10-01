/**
 * C7-C Pilot evidence kernel proofs: readiness is an advisory checklist (never a score, never a decision), autonomy is
 * JUDGMENT + INDEPENDENCE only, blame stays with C6 attribution, training completion is not improvement, zero
 * qualified outcomes are never efficient, and internal training is never market success.
 * C7C-PROOF: pilot-evidence-kernel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  READINESS_CRITERIA,
  assessReadiness,
  buildPerformanceProfile,
  classifyAutonomy,
  costPerQualifiedOutcome,
  dimensionOf,
  evaluateWork,
  localizeFailure,
  marketClaimOf,
  pilotScopedFact,
  standardReferenceCases,
  standardWorkOutcomeDefinition,
  type EvaluationFact,
  type PilotReadinessFacts,
  type WorkEvidence,
} from '../src/index.js';

const def = standardWorkOutcomeDefinition();
const good = (): WorkEvidence => {
  const c = standardReferenceCases().find((x) => x.kind === 'KNOWN_GOOD');
  assert.ok(c);
  return c.evidence;
};
const withEv = (patch: Partial<WorkEvidence>): WorkEvidence => ({ ...good(), ...patch });
const dims = (ev: WorkEvidence) => evaluateWork(def, ev).dimensions;

let seq = 0;
const fact = (patch: Partial<EvaluationFact> = {}): EvaluationFact => {
  seq++;
  return {
    evaluationId: `e${seq}`, workItemId: `w${seq}`, comparableKey: 'growth.brief', riskLevel: 'R1', at: new Date(Date.UTC(2026, 8, 1) + seq * 3_600_000).toISOString(),
    evidenceState: 'SUFFICIENT_EVIDENCE', qualifiedOutcome: true, verdicts: { OUTCOME: 'POSITIVE', QUALITY: 'POSITIVE', EFFICIENCY: 'POSITIVE', INDEPENDENCE: 'POSITIVE' },
    cost: { productiveMicros: 1_000, overheadMicros: 0 }, activity: { messages: 1, toolCalls: 1, tokens: 10, runs: 1 }, attributionDue: false, ...patch,
  };
};
const AT = '2026-09-30T00:00:00.000Z';
const profileOf = (evaluations: EvaluationFact[], attributions: Parameters<typeof buildPerformanceProfile>[0]['attributions'] = []) =>
  buildPerformanceProfile({ employeeId: 'emp', at: AT, evaluations, attributions, learningEffects: [], contributions: { validatedPatterns: [], verifiedPatternReuses: [], validatedSystemicFindings: [] } });

const base = (patch: Partial<PilotReadinessFacts> = {}): PilotReadinessFacts => ({
  mode: 'TRAINING_INTERNAL',
  requiresExternalOutcome: false,
  briefing: { answered: 0, pending: 0, refs: [] },
  goal: { bound: false, state: null, criteria: 0, derivedGoals: 0, linkedWork: 0, refs: [] },
  collaboration: { departments: 1, completedHandoffs: 0, problemHandoffs: 0, refs: [] },
  review: { satisfied: 0, rework: 0, openConflicts: 0, makerDecisions: 0, refs: [] },
  autonomy: { profiles: [], boundaryRefused: 0, refs: [] },
  learning: { validatedLessons: 0, improvementObserved: 0, noImprovement: 0, regression: 0, trainingCompletedUntested: 0, refs: [] },
  economics: costPerQualifiedOutcome([]),
  external: { qualifiedWithCurrentExternal: 0, contested: 0, refs: [] },
  ...patch,
});
const stateOf = (f: PilotReadinessFacts, c: (typeof READINESS_CRITERIA)[number]) => assessReadiness(f).find((r) => r.criterion === c)?.state;

describe('C7-C readiness is an advisory checklist, never a score', () => {
  test('(23) exactly the eight criteria, each with its own state; nothing blended, nothing decided, no score / rank key anywhere', () => {
    const out = assessReadiness(base());
    assert.deepEqual(out.map((r) => r.criterion), [...READINESS_CRITERIA]);
    assert.ok(out.every((r) => r.isDecision === false));
    assert.ok(out.every((r) => r.state === 'INSUFFICIENT_EVIDENCE' || r.state === 'NOT_APPLICABLE'), 'no evidence supports nothing');
    const keys = JSON.stringify(out).match(/"[A-Za-z_]+":/g) ?? [];
    assert.ok(!keys.some((k) => /score|rank|leaderboard|rating|grade|percent|overall|weight/i.test(k)), keys.join());
  });

  test('(18) activity alone never produces positive readiness', () => {
    const busy = Array.from({ length: 12 }, () => fact({ qualifiedOutcome: false, evidenceState: 'SUFFICIENT_EVIDENCE', verdicts: { OUTCOME: 'NOT_ASSESSED' }, activity: { messages: 400, toolCalls: 90, tokens: 900_000, runs: 30 } }));
    const p = profileOf(busy);
    const f = base({ autonomy: { profiles: [{ employeeId: 'emp', judgment: dimensionOf(p.dimensions, 'JUDGMENT'), independence: dimensionOf(p.dimensions, 'INDEPENDENCE') }], boundaryRefused: 0, refs: [] }, economics: costPerQualifiedOutcome(busy) });
    for (const r of assessReadiness(f)) assert.notEqual(r.state, 'SUPPORTED', `${r.criterion} is not supported by activity`);
  });

  test('(19, 20) one good task cannot manufacture broad excellence; C6 minimum evidence and confidence are preserved through the Pilot view', () => {
    const one = [fact()];
    const p = profileOf(one.map(pilotScopedFact));
    for (const d of p.dimensions) assert.ok(d.state !== 'SUFFICIENT_EVIDENCE' || d.sample >= 3, `${d.dimension} needs the C6 minimum sample`);
    assert.equal(dimensionOf(p.dimensions, 'OUTCOME').level, null);
    const many = Array.from({ length: 6 }, () => fact());
    assert.deepEqual(profileOf(many.map(pilotScopedFact)).dimensions, profileOf(many).dimensions, 'the Pilot view is the C6 profile for ordinary facts');
    assert.equal(stateOf(base({ autonomy: { profiles: [{ employeeId: 'emp', judgment: dimensionOf(p.dimensions, 'JUDGMENT'), independence: dimensionOf(p.dimensions, 'INDEPENDENCE') }], boundaryRefused: 0, refs: [] } }), 'APPROPRIATE_AUTONOMY'), 'INSUFFICIENT_EVIDENCE');
  });

  test('(21, 22) negative Employee evidence needs governed attribution; a validated non-Employee cause is never counted against them', () => {
    const adverse = Array.from({ length: 4 }, () => fact({ qualifiedOutcome: false, verdicts: { OUTCOME: 'NEGATIVE', INDEPENDENCE: 'NEGATIVE' }, attributionDue: true }));
    const pending = profileOf(adverse);
    assert.equal(dimensionOf(pending.dimensions, 'INDEPENDENCE').accountableNegative, 0, 'no attribution → not counted');
    assert.ok(dimensionOf(pending.dimensions, 'INDEPENDENCE').pendingAttribution > 0, '… and disclosed as pending');
    const ap = { employeeId: 'emp', judgment: dimensionOf(pending.dimensions, 'JUDGMENT'), independence: dimensionOf(pending.dimensions, 'INDEPENDENCE') };
    assert.equal(stateOf(base({ autonomy: { profiles: [ap], boundaryRefused: 0, refs: [] } }), 'APPROPRIATE_AUTONOMY'), 'INSUFFICIENT_EVIDENCE', 'pending adverse evidence holds the criterion, never clean');
    const system = profileOf(adverse, adverse.map((a) => ({ workItemId: a.workItemId, state: 'VALIDATED' as const, employeeAccountable: false, overall: 'NEGATIVE' })));
    assert.equal(dimensionOf(system.dimensions, 'INDEPENDENCE').accountableNegative, 0);
    assert.equal(dimensionOf(system.dimensions, 'INDEPENDENCE').excludedNonEmployee, 4, '(22) a non-Employee cause is excluded');
    const loc = localizeFailure(withEv({ outcome: 'NOT_ACHIEVED', failures: { ...good().failures, workflow: 1 } }), 0, null);
    assert.deepEqual([loc.areas.includes('WORKFLOW'), loc.employeeAccountable, loc.attributedCauses], [true, null, []], '(34) the trace points at the workflow; nobody is blamed without a validated attribution');
    const proposed = localizeFailure(withEv({ outcome: 'NOT_ACHIEVED' }), 1, { state: 'PROPOSED', employeeAccountable: true, categories: ['EMPLOYEE_JUDGMENT'] });
    assert.deepEqual([proposed.employeeAccountable, proposed.areas.includes('HANDOFF')], [null, true], 'a proposed attribution blames nobody yet');
    const validated = localizeFailure(withEv({ outcome: 'NOT_ACHIEVED' }), 0, { state: 'VALIDATED', employeeAccountable: false, categories: ['WORKFLOW_PROCESS'] });
    assert.deepEqual([validated.employeeAccountable, validated.attributedCauses], [false, ['WORKFLOW_PROCESS']], '(34) a systemic cause can be the workflow, not the Employee');
  });
});

describe('C7-C appropriate autonomy is JUDGMENT + INDEPENDENCE', () => {
  test('(24, 25, 26) correct high-authority escalation is good judgment, never dependence; an authority-boundary refusal is never positive; routine work handled independently is autonomy', () => {
    const escalated = dims(withEv({ interventions: { escalations: 1, correctEscalations: 1, founder: 0 } }));
    assert.equal(classifyAutonomy(escalated), 'CORRECT_ESCALATION', '(25) a legitimate escalation is not penalized');
    assert.ok(escalated.find((d) => d.dimension === 'INDEPENDENCE')?.verdict !== 'NEGATIVE');
    const refused = dims(withEv({ authorityRefusals: 1, route: { planned: ['a'], taken: ['b'] } }));
    assert.equal(classifyAutonomy(refused), 'AUTHORITY_BOUNDARY_REFUSED', '(26) an attempted unauthorized act is never autonomy');
    assert.equal(classifyAutonomy(dims(good())), 'ROUTINE_HANDLED_INDEPENDENTLY');
    assert.equal(classifyAutonomy(dims(withEv({ interventions: { escalations: 0, correctEscalations: 0, founder: 1 } }))), 'UNNECESSARY_DEPENDENCE_EVIDENCED');
    assert.equal(classifyAutonomy([]), 'INSUFFICIENT_EVIDENCE');
    // (26) Inside a Pilot an item whose JUDGMENT is NEGATIVE never adds POSITIVE INITIATIVE.
    const f = fact({ verdicts: { OUTCOME: 'POSITIVE', JUDGMENT: 'NEGATIVE', INITIATIVE: 'POSITIVE' } });
    assert.equal(pilotScopedFact(f).verdicts.INITIATIVE, 'NOT_ASSESSED');
    assert.equal(pilotScopedFact(fact({ verdicts: { INITIATIVE: 'POSITIVE' } })).verdicts.INITIATIVE, 'POSITIVE', 'a valid creative path stays initiative');
  });
});

describe('C7-C learning, economics and market claims', () => {
  test('(31, 32, 33) reflection or training completion is not improvement; only later comparable evidence (C6 IMPROVEMENT_OBSERVED) supports learning closure', () => {
    assert.equal(stateOf(base({ learning: { validatedLessons: 0, improvementObserved: 0, noImprovement: 0, regression: 0, trainingCompletedUntested: 0, refs: [] } }), 'LEARNING_CLOSURE'), 'INSUFFICIENT_EVIDENCE', '(31)');
    assert.equal(stateOf(base({ learning: { validatedLessons: 2, improvementObserved: 0, noImprovement: 0, regression: 0, trainingCompletedUntested: 2, refs: [] } }), 'LEARNING_CLOSURE'), 'INSUFFICIENT_EVIDENCE', '(32) training complete ≠ improvement');
    assert.equal(stateOf(base({ learning: { validatedLessons: 2, improvementObserved: 1, noImprovement: 0, regression: 0, trainingCompletedUntested: 0, refs: [] } }), 'LEARNING_CLOSURE'), 'SUPPORTED', '(33)');
    assert.equal(stateOf(base({ learning: { validatedLessons: 2, improvementObserved: 1, noImprovement: 0, regression: 1, trainingCompletedUntested: 0, refs: [] } }), 'LEARNING_CLOSURE'), 'CONCERN', 'a regression is never hidden by an improvement');
  });

  test('(36, 37) cost per qualified outcome carries failures and rework; zero qualified outcomes are never efficient', () => {
    const facts = [fact(), fact({ qualifiedOutcome: false, cost: { productiveMicros: 2_000, overheadMicros: 500 } })];
    const e = costPerQualifiedOutcome(facts);
    assert.equal(e.costPerQualifiedOutcomeMicros, 3_500, '(36) the failed item is carried');
    assert.equal(stateOf(base({ economics: e }), 'COST_DISCIPLINE'), 'SUPPORTED');
    const none = costPerQualifiedOutcome([fact({ qualifiedOutcome: false, cost: { productiveMicros: 1, overheadMicros: 0 } })]);
    assert.equal(stateOf(base({ economics: none }), 'COST_DISCIPLINE'), 'CONCERN', '(37) cheap but useless is not efficient');
    assert.equal(stateOf(base({ economics: costPerQualifiedOutcome([]) }), 'COST_DISCIPLINE'), 'INSUFFICIENT_EVIDENCE');
  });

  test('(38, 39, 40, 41) internal training never claims market success; a real claim needs current governed evidence; a contest overrides support', () => {
    assert.equal(marketClaimOf('TRAINING_INTERNAL', { qualifiedWithCurrentExternal: 9, contested: 0 }), 'NOT_CLAIMABLE_TRAINING_INTERNAL', '(38) even with evidence');
    assert.equal(stateOf(base({ external: { qualifiedWithCurrentExternal: 9, contested: 0, refs: [] } }), 'REAL_WORLD_OUTCOME'), 'NOT_APPLICABLE');
    assert.equal(marketClaimOf('CONTROLLED_REAL', { qualifiedWithCurrentExternal: 0, contested: 0 }), 'NOT_SUPPORTED', '(39)');
    assert.equal(marketClaimOf('CONTROLLED_REAL', { qualifiedWithCurrentExternal: 2, contested: 0 }), 'SUPPORTED_BY_GOVERNED_EVIDENCE');
    assert.equal(marketClaimOf('CONTROLLED_REAL', { qualifiedWithCurrentExternal: 2, contested: 1 }), 'CONTESTED', '(40) a late conflict contests at once');
    assert.equal(stateOf(base({ mode: 'CONTROLLED_REAL', external: { qualifiedWithCurrentExternal: 2, contested: 1, refs: [] } }), 'REAL_WORLD_OUTCOME'), 'CONTESTED');
    assert.equal(stateOf(base({ mode: 'CONTROLLED_REAL', requiresExternalOutcome: false }), 'REAL_WORLD_OUTCOME'), 'INSUFFICIENT_EVIDENCE', 'absence is not failure unless required');
    assert.equal(stateOf(base({ mode: 'CONTROLLED_REAL', requiresExternalOutcome: true }), 'REAL_WORLD_OUTCOME'), 'CONCERN');
  });

  test('(27, 28, 29, 30) review discipline and handoffs read canonical review / delegation records, never message volume', () => {
    assert.equal(stateOf(base({ review: { satisfied: 3, rework: 2, openConflicts: 0, makerDecisions: 0, refs: [] } }), 'REVIEW_DISCIPLINE'), 'SUPPORTED', '(28) rework is history, not a failure');
    assert.equal(stateOf(base({ review: { satisfied: 3, rework: 0, openConflicts: 0, makerDecisions: 1, refs: [] } }), 'REVIEW_DISCIPLINE'), 'CONCERN', '(27) a maker decision is a concern');
    assert.equal(stateOf(base({ review: { satisfied: 3, rework: 0, openConflicts: 1, makerDecisions: 0, refs: [] } }), 'REVIEW_DISCIPLINE'), 'CONCERN');
    assert.equal(stateOf(base({ collaboration: { departments: 1, completedHandoffs: 0, problemHandoffs: 0, refs: [] } }), 'CROSS_DEPARTMENT_EXECUTION'), 'INSUFFICIENT_EVIDENCE', 'cross-department work is never manufactured');
    assert.equal(stateOf(base({ collaboration: { departments: 2, completedHandoffs: 1, problemHandoffs: 0, refs: [] } }), 'CROSS_DEPARTMENT_EXECUTION'), 'SUPPORTED', '(29)');
    assert.equal(stateOf(base({ collaboration: { departments: 3, completedHandoffs: 4, problemHandoffs: 1, refs: [] } }), 'CROSS_DEPARTMENT_EXECUTION'), 'CONCERN');
    // (30) there is no message input to readiness at all.
    assert.ok(!JSON.stringify(base()).includes('message'));
  });
});
