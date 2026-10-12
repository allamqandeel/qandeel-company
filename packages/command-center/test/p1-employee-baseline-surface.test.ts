/**
 * P1-EMPLOYEE-BASELINE-01 B (D-P1-10) — the Founder's hire preview states the standard new-hire reasoning profile exactly
 * as the store will write it: AUTO from E1, ceiling E4, BALANCED, a CANDIDATE with no authority or budget, and that a level
 * above E2 still needs a route policy, a provisioned deployment and the budget.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { structuredSummary } from '../src/api.js';

describe('P1-EMPLOYEE-BASELINE-01: the hire preview', () => {
  test('names AUTO from E1, ceiling E4, and what still bounds E3 / E4', () => {
    const payload = { givenName: 'Karim', familyName: 'Adel', displayNameAr: null, positionTitle: 'Director, Product', roleRef: 'role:director-product', defaultClass: 'E1', ceilingClass: 'E4', selection: 'AUTO', costDiscipline: 'BALANCED', startsAs: 'CANDIDATE' };
    const text = structuredSummary({} as Parameters<typeof structuredSummary>[0], { intentKind: 'EMPLOYEE_HIRE', payload });
    // P1-AUTO-E12-01 (D-P1-11): AUTO never goes above E2 by itself; E3 / E4 run only when the Founder chooses them.
    for (const must of ['as a CANDIDATE — not active, no authority, no budget', 'reasoning AUTO from E1, ceiling E4', "AUTO never goes above E2 by itself; E3 / E4 run only when you choose them for a task, and only where the task's route policy, a provisioned deployment and the budget allow it", 'cost discipline BALANCED', 'The Academy alone decides activation']) assert.ok(text.includes(must), must);
    const standing = structuredSummary({} as Parameters<typeof structuredSummary>[0], { intentKind: 'EMPLOYEE_HIRE', payload: { ...payload, selection: 'DEFAULT' } });
    assert.ok(standing.includes("(a level above E2 runs only where the task's route policy, a provisioned deployment and the budget allow it)"), 'a DEFAULT hire keeps its wording (its bounded escalation is unchanged)');
    const auto = structuredSummary({} as Parameters<typeof structuredSummary>[0], { intentKind: 'EMPLOYEE_REASONING_PROFILE', payload: { name: 'Karim Adel', previousDefault: 'E1', newDefault: 'E1', previousCeiling: 'E4', newCeiling: 'E4', previousSelection: 'DEFAULT', newSelection: 'AUTO', costDiscipline: 'BALANCED', certificationsReviewDue: [] } });
    assert.ok(auto.includes('up to E2') && auto.includes('AUTO never goes above E2 by itself'), auto);
  });

  test("a lower ceiling the Founder chose is the one the preview states (the payload the store writes)", () => {
    const payload = { givenName: 'Karim', familyName: 'Adel', displayNameAr: null, positionTitle: 'Director, Product', roleRef: 'role:director-product', defaultClass: 'E1', ceilingClass: 'E2', selection: 'AUTO', costDiscipline: 'BALANCED', startsAs: 'CANDIDATE' };
    const text = structuredSummary({} as Parameters<typeof structuredSummary>[0], { intentKind: 'EMPLOYEE_HIRE', payload });
    assert.ok(text.includes('reasoning AUTO from E1, ceiling E2'), text);
    assert.equal(text.includes('ceiling E4'), false);
  });
});
