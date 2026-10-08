/**
 * D2-UX-01 — the pure pieces of the Founder UX corrections: a budget ceiling is only ever an explicit amount above zero
 * in the envelope's own currency (never a silent zero), and an Employee's training line states exactly what the Academy
 * record holds (an empty record reads as empty).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { trainingFacts } from '../src/app/halls.js';
import { budgetCeilingMicros } from '../src/app/panels.js';

describe('D2-UX-01: the budget ceiling entry', () => {
  test('an explicit amount above zero, up to two decimals, becomes micro-units', () => {
    assert.equal(budgetCeilingMicros('250'), 250_000_000);
    assert.equal(budgetCeilingMicros(' 250.5 '), 250_500_000);
    assert.equal(budgetCeilingMicros('0.01'), 10_000);
    assert.equal(budgetCeilingMicros('1,250.75'), 1_250_750_000);
  });
  test('empty, zero, negative, malformed or over-precise entries are refused (nothing is sent)', () => {
    for (const bad of ['', '   ', '0', '0.00', '-5', '+5', '5.123', 'abc', '1e3', '٥', '5.', '.5', 'EGP 5', '9999999999999']) assert.equal(budgetCeilingMicros(bad), null, JSON.stringify(bad));
  });
});

describe('D2-UX-01: an Employee training line', () => {
  test('an Employee who never entered the Academy reads as such', () => {
    const f = trainingFacts({ enrollment: null, certification: null, skills: [] });
    assert.deepEqual(f, { stage: 'Not enrolled', modules: '—', attempts: 'No attempts', certification: 'No certification', skills: 'No skills on the passport' });
  });
  test('a certified Employee: the stage, modules, attempts, certification and passport as recorded', () => {
    const f = trainingFacts({
      enrollment: { stage: 'ACTIVATION_APPROVAL', blockedReason: null, modulesDone: 6, modulesTotal: 6, attempts: [{ state: 'EVALUATED', outcome: 'PASS', averagePct: 88 }, { state: 'EVALUATED', outcome: 'FAIL', averagePct: 61 }, { state: 'OPEN', outcome: null, averagePct: null }] },
      certification: { status: 'VALID', validUntil: '2027-10-08T00:00:00.000Z' },
      skills: [{ proficiency: 'QUALIFIED' }, { proficiency: 'LEARNING' }],
    });
    assert.equal(f.stage, 'Awaiting activation approval');
    assert.equal(f.modules, '6 of 6 modules');
    assert.equal(f.attempts, '1 of 2 evaluated attempts passed · latest 61% · 1 open');
    assert.match(f.certification, /^Valid until /);
    assert.equal(f.skills, '2 skills · 1 qualified or above');
  });
});
