/**
 * C7-A at the C6 kernel seam — external outcomes are runtime evidence, never a compile-time flag: the Eval Registry may
 * require EXTERNAL_OUTCOME only while a governed source is active; reports state the three truthful states (no governed
 * source / nothing relevant / cited evidence) and every external-result claim cites canonical records. C7A-PROOF: c6-seam-kernel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError } from '@qandeel-company/domain';

import * as mind from '../src/index.js';
import { NO_EXTERNAL_OUTCOME_FACTS, assertEvalDefinition, calibrateDefinition, composeReport, standardWorkOutcomeDefinition, type ExternalOutcomeFacts, type ReportFacts } from '../src/index.js';

const AT = '2026-09-30T00:00:00.000Z';
function weekly(external: ExternalOutcomeFacts): ReportFacts {
  return {
    cadence: 'WEEKLY', period: { from: '2026-09-23T00:00:00.000Z', to: AT }, verifications: [], failedWork: [], deadLetters: [], reconciliationHeld: [], decisionsRequired: [], resilienceExceptions: [], goals: [],
    evaluations: [], previousEvaluations: [], lessons: { validated: [], patterns: [], nearMisses: [] }, systemic: [], effects: [], profiles: [], reviewers: [], capabilityGaps: [], recertificationDue: [], departmentGaps: [], minSample: 3, external,
  };
}

describe('C7-A: external outcomes at the C6 kernel are durable truth passed in, never a flag', () => {
  test('there is no global availability constant; requiring EXTERNAL_OUTCOME needs an active governed source (fail closed by default)', () => {
    assert.equal('EXTERNAL_OUTCOMES_AVAILABLE' in mind, false, 'the static C6 flag is gone');
    const spec = { ...standardWorkOutcomeDefinition('work-outcome.external'), requiredEvidence: ['WORK_LINEAGE', 'REVIEW_DECISION', 'OUTCOME_VERIFICATION', 'EXTERNAL_OUTCOME'] as mind.EvidenceClass[] };
    assert.throws(() => assertEvalDefinition(spec), (e) => isQandeelError(e, 'EVAL_INVALID'));
    assert.throws(() => calibrateDefinition(spec), (e) => isQandeelError(e, 'EVAL_INVALID'));
    assert.doesNotThrow(() => assertEvalDefinition(spec, { governedSource: true }));
    // Required external evidence that the work does not have is INSUFFICIENT — never invented.
    const c = calibrateDefinition(spec, { governedSource: true });
    assert.equal(c.passed, false, 'reference cases without external evidence cannot satisfy it (the evaluator says "not known")');
  });

  test('reports: no governed source ⇒ stated unavailable; a governed source without relevant evidence ⇒ said so citing the source; evidence ⇒ cited by canonical refs', () => {
    const none = composeReport(weekly(NO_EXTERNAL_OUTCOME_FACTS)).claims;
    assert.deepEqual(none.filter((c) => c.code.startsWith('EXTERNAL_')).map((c) => [c.code, c.params.reason, c.evidenceRefs.length]), [['EXTERNAL_OUTCOMES_UNAVAILABLE', 'NO_GOVERNED_SOURCE', 0]]);
    const quiet = composeReport(weekly({ state: 'NO_RELEVANT_EVIDENCE', sources: ['s1'], evidence: [], verifications: [] })).claims.filter((c) => c.code.startsWith('EXTERNAL_'));
    assert.deepEqual(quiet.map((c) => [c.code, c.evidenceRefs]), [['EXTERNAL_OUTCOMES_NO_RELEVANT_EVIDENCE', ['external_source:s1']]]);
    const cited = composeReport(weekly({ state: 'EVIDENCE_AVAILABLE', sources: ['s1'], evidence: [{ subjectKind: 'GOAL', subjectId: 'g1', recordIds: ['r1', 'r2'], bindingIds: ['b1', 'b2'], types: ['search.clicks'] }], verifications: [{ id: 'v1', workItemId: 'w1', verdict: 'ACHIEVED', recordIds: ['r1'] }] })).claims.filter((c) => c.code.startsWith('EXTERNAL_'));
    assert.deepEqual(cited.map((c) => c.code), ['EXTERNAL_OUTCOME_EVIDENCE', 'EXTERNAL_OUTCOMES_IN_VERIFICATION']);
    assert.deepEqual(cited[0]?.subject, { kind: 'GOAL', id: 'g1' });
    assert.deepEqual(cited[0]?.evidenceRefs, ['external_record:r1', 'external_record:r2', 'external_binding:b1', 'external_binding:b2']);
    assert.deepEqual(cited[1]?.evidenceRefs, ['outcome_verification:v1', 'external_record:r1']);
    assert.ok(cited.every((c) => c.kind === 'FACT' && c.evidenceRefs.length > 0), 'every external-result claim cites canonical evidence');
    // A bounded report discloses its cut (and cites the sources), never hides it.
    const cut = composeReport(weekly({ state: 'EVIDENCE_AVAILABLE', sources: ['s1'], evidence: [{ subjectKind: 'WORK_ITEM', subjectId: 'w1', recordIds: ['r1'], bindingIds: ['b1'], types: ['web.sessions'] }], verifications: [], truncated: { shown: 500, total: 812 } })).claims.find((c) => c.code === 'EXTERNAL_OUTCOME_EVIDENCE_TRUNCATED');
    assert.deepEqual([cut?.params, cut?.evidenceRefs], [{ shown: 500, total: 812 }, ['external_source:s1']]);
    // An inconsistent state (claims "available" with no source) still never invents availability.
    assert.equal(composeReport(weekly({ state: 'EVIDENCE_AVAILABLE', sources: [], evidence: [], verifications: [] })).claims.some((c) => c.code === 'EXTERNAL_OUTCOMES_UNAVAILABLE'), true);
  });

  test('D-C7A-11: a contested verification is conflicting evidence (never a qualified outcome) and is reported as contested, never as a result', () => {
    // The evaluator: a contested outcome is a contradiction in the evidence itself — never averaged into a verdict.
    const spec = standardWorkOutcomeDefinition('work-outcome.contest');
    const reference = calibrateDefinition(spec);
    assert.equal(reference.passed, true);
    const achieved = spec.referenceCases.find((c) => c.kind === 'KNOWN_GOOD')?.evidence;
    assert.ok(achieved, 'the standard definition carries a qualified reference case');
    assert.equal(mind.evaluateWork(spec, achieved).qualifiedOutcome, true);
    const contested = mind.evaluateWork(spec, { ...achieved, outcome: null, outcomeContested: true });
    assert.deepEqual([contested.evidenceState, contested.qualifiedOutcome, contested.conflicts], ['CONFLICTING_EVIDENCE', false, ['OUTCOME_EVIDENCE_CONTESTED']]);
    // Reports: only current verifications are external results or achieved outcomes; a contested one is stated as such.
    const facts = weekly({ state: 'EVIDENCE_AVAILABLE', sources: ['s1'], evidence: [], verifications: [{ id: 'v1', workItemId: 'w1', verdict: 'ACHIEVED', recordIds: ['r1'], validity: 'CONTESTED', conflictIds: ['k1'] }, { id: 'v2', workItemId: 'w2', verdict: 'ACHIEVED', recordIds: ['r2'] }, { id: 'v3', workItemId: 'w3', verdict: 'ACHIEVED', recordIds: ['r3'], validity: 'REPLACED' }] });
    const external = composeReport(facts).claims.filter((c) => c.code.startsWith('EXTERNAL_'));
    assert.deepEqual(external.map((c) => c.code), ['EXTERNAL_OUTCOMES_IN_VERIFICATION', 'EXTERNAL_OUTCOME_CONTESTED']);
    assert.deepEqual(external[0]?.evidenceRefs, ['outcome_verification:v2', 'external_record:r2'], 'only the current verification is an external result');
    assert.deepEqual([external[1]?.subject, external[1]?.evidenceRefs], [{ kind: 'WORK_ITEM', id: 'w1' }, ['outcome_verification:v1', 'external_record_conflict:k1', 'external_record:r1']]);
    const daily = composeReport({ ...facts, cadence: 'DAILY', verifications: [{ id: 'v1', workItemId: 'w1', verdict: 'ACHIEVED', validity: 'CONTESTED' }, { id: 'v2', workItemId: 'w2', verdict: 'ACHIEVED' }, { id: 'v3', workItemId: 'w3', verdict: 'NOT_ACHIEVED', validity: 'RETRACTED' }] }).claims;
    assert.deepEqual(daily.find((c) => c.code === 'OUTCOMES_ACHIEVED')?.evidenceRefs, ['outcome_verification:v2']);
    assert.deepEqual(daily.find((c) => c.code === 'OUTCOMES_CONTESTED')?.evidenceRefs, ['outcome_verification:v1']);
    assert.equal(daily.some((c) => c.code === 'MATERIAL_FAILURES'), false, 'a retracted verdict is no outcome either way');
  });
});
