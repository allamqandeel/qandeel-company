/**
 * COMPANY-MAJED-ACADEMY-01 — the seat case offers every shadow assignment the program needs and states the program's own
 * number of passed assessments. Majed's program (docs/talent, the approved specification's data) needs three shadow briefs
 * and five passed assessments; before this correction the panel offered shadow work only while none existed and always
 * said "3 passed". The backend rule is unchanged and stays the authority: the offer mirrors its duplicate check.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SHADOW_ENDED, assessmentPrompt, assignableShadow } from '../src/model/academy-ui.js';

type Json = Record<string, unknown>;

// dist/test/<file>.js → the package root → the repository root.
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const MAJED = JSON.parse(readFileSync(path.join(repoRoot, 'docs', 'talent', 'MAJED_EL_KEDWANY.talent.json'), 'utf8')) as { program: { shadowAssignments: Json[]; program: { assessmentTrials: number; probation: { minCases: number } } } };
const assignments = MAJED.program.shadowAssignments.map((a) => ({ code: a.code, objective: a.objective }));
const codes = (list: readonly Json[]): string[] => list.map((a) => String(a.code));
const live = (i: number, state: string): Json => ({ workItemId: `w${i}`, objective: assignments[i]?.objective, state, answer: null });

describe('COMPANY-MAJED-ACADEMY-01: shadow work offers', () => {
  test('Majed\'s program needs three shadow cases and has three distinct assignments: all three are offered first', () => {
    assert.equal(MAJED.program.program.probation.minCases, 3);
    assert.equal(new Set(assignments.map((a) => a.objective)).size, 3);
    assert.deepEqual(codes(assignableShadow(assignments, [])), ['smi.director.shadow-days-1-30', 'smi.director.shadow-days-31-60', 'smi.director.shadow-days-61-90']);
  });

  test('after the first is assigned, the second and third stay available (running, then finished)', () => {
    for (const state of ['READY', 'RUNNING', 'COMPLETED', 'REVIEWED', 'CLOSED']) {
      assert.deepEqual(codes(assignableShadow(assignments, [live(0, state)])), ['smi.director.shadow-days-31-60', 'smi.director.shadow-days-61-90'], state);
    }
    assert.deepEqual(codes(assignableShadow(assignments, [live(0, 'COMPLETED'), live(1, 'RUNNING')])), ['smi.director.shadow-days-61-90']);
  });

  test('an assignment in progress or finished is never offered twice; all three live → nothing to offer', () => {
    assert.deepEqual(codes(assignableShadow(assignments, [live(0, 'COMPLETED'), live(1, 'COMPLETED'), live(2, 'READY')])), []);
    assert.deepEqual(codes(assignableShadow(assignments, [live(0, 'FAILED'), live(0, 'RUNNING'), live(1, 'COMPLETED'), live(2, 'COMPLETED')])), [], 'the re-assignment of a failed one is live again');
  });

  test('a failed, cancelled or superseded assignment may be assigned again (the backend allows it)', () => {
    for (const state of SHADOW_ENDED) {
      assert.deepEqual(codes(assignableShadow(assignments, [live(0, state), live(1, 'COMPLETED'), live(2, 'COMPLETED')])), ['smi.director.shadow-days-1-30'], state);
    }
  });

  test('the offer mirrors the backend duplicate rule (same objective, ended states) — drift shows here', () => {
    const store = readFileSync(path.join(repoRoot, 'packages', 'storage', 'src', 'academy-packages.ts'), 'utf8');
    const rule = /WHERE s\.enrollment_id = \? AND w\.objective = \? AND w\.state NOT IN \(([^)]*)\)`, enrollmentId, a\.objective\)/.exec(store);
    assert.ok(rule?.[1], 'the backend duplicate rule keys on the assignment objective');
    assert.deepEqual(rule[1].split(',').map((x) => x.trim().replace(/'/g, '')), [...SHADOW_ENDED]);
  });

  test('the panel uses the offer instead of "no shadow work yet"', () => {
    const panel = readFileSync(path.join(pkgRoot, 'src', 'app', 'activation.ts'), 'utf8');
    assert.match(panel, /if \(stage === 'SHADOW_WORK'\) for \(const a of assignableShadow\(arr\(pkgReg\?\.shadowAssignments\), shadow\)\)/);
    assert.doesNotMatch(panel, /shadow\.length === 0\) for/);
  });
});

describe('COMPANY-MAJED-ACADEMY-01: the assessment prompt states the program\'s own number', () => {
  test('Majed: five passed; the CEO programs: three; never a hard-coded number in the panel', () => {
    assert.equal(MAJED.program.program.assessmentTrials, 5);
    assert.equal(assessmentPrompt(MAJED.program.program.assessmentTrials), 'Start an assessment (the program needs 5 passed, including a clean hidden holdout)');
    assert.equal(assessmentPrompt(3), 'Start an assessment (the program needs 3 passed, including a clean hidden holdout)');
    const panel = readFileSync(path.join(pkgRoot, 'src', 'app', 'activation.ts'), 'utf8');
    assert.doesNotMatch(panel, /needs \d+ passed/);
    assert.match(panel, /assessmentPrompt\(pkgReg\?\.assessmentTrials\)/);
  });

  test('a missing or invalid number never invents one', () => {
    for (const v of [undefined, null, 0, -1, 2.5, 'x']) assert.equal(assessmentPrompt(v), 'Start an assessment (the program needs its required passes, including a clean hidden holdout)', String(v));
  });
});
