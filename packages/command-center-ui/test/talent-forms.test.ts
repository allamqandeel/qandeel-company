/**
 * COMPANY-TALENT-01 — the Skills & Academy studio's ordinary fields for Benchmark cases and competencies (the pure
 * model). The Founder never has to type JSON: ticking, numbers and lines keep the case in the contract's shape — an
 * unset constraint is absent, `critical` names only stated constraints, forbidden phrases are lower-case, spend is
 * entered in USD. The governed check on save stays the authority (parity with the real contract:
 * `packages/command-center/test/talent-forms-parity.test.ts`).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { caseProblem, competencyCode, competencyProblem, forbiddenText, isCritical, newCase, newCompetency, numberText, parseNumber, setArabic, setChoice, setCritical, setForbidden, setNumber, setTri, statedKeys, triOf } from '../src/model/talent-forms.js';

describe('COMPANY-TALENT-01: Benchmark cases as ordinary fields', () => {
  test('a new case is ready once it has its text; the default expects thin evidence to be recognised (critical)', () => {
    const c = newCase('growth.case-1');
    assert.equal(caseProblem(c), 'the case needs its text');
    c.content = 'A stakeholder wants a commitment today on thin evidence.';
    assert.equal(caseProblem(c), null);
    assert.deepEqual(c.expect, { evidence: ['INSUFFICIENT', 'PARTIAL'], critical: ['evidence'] });
  });

  test('ticking keeps the closed order; unticking the last one unsets the constraint and drops it from critical', () => {
    const c = newCase('x.case-1');
    setChoice(c, 'decision', 'ESCALATE_TO_FOUNDER', true);
    setChoice(c, 'decision', 'GATHER_EVIDENCE', true);
    assert.deepEqual((c.expect as Record<string, unknown>).decision, ['GATHER_EVIDENCE', 'ESCALATE_TO_FOUNDER']);
    setCritical(c, 'decision', true);
    assert.deepEqual((c.expect as Record<string, unknown>).critical, ['decision', 'evidence']);
    setChoice(c, 'decision', 'GATHER_EVIDENCE', false);
    setChoice(c, 'decision', 'ESCALATE_TO_FOUNDER', false);
    assert.equal('decision' in (c.expect as object), false, 'never an empty list');
    assert.equal(isCritical(c, 'decision'), false);
  });

  test('an unstated constraint is never critical', () => {
    const c = newCase('x.case-1');
    setCritical(c, 'reversible', true);
    assert.equal(isCritical(c, 'reversible'), false);
    setTri(c, 'reversible', 'YES');
    setCritical(c, 'reversible', true);
    assert.equal(isCritical(c, 'reversible'), true);
    assert.equal(triOf(c, 'reversible'), 'YES');
    setTri(c, 'reversible', 'ANY');
    assert.equal(isCritical(c, 'reversible'), false);
  });

  test('numbers: spend in USD kept as micros; blank unsets', () => {
    const c = newCase('x.case-1');
    setNumber(c, 'maxSpendMicros', '0.25');
    assert.equal((c.expect as Record<string, unknown>).maxSpendMicros, 250_000);
    assert.equal(numberText(c, 'maxSpendMicros'), '0.25');
    setNumber(c, 'minBodyChars', '400');
    assert.equal((c.expect as Record<string, unknown>).minBodyChars, 400);
    setNumber(c, 'maxSpendMicros', '');
    assert.equal('maxSpendMicros' in (c.expect as object), false);
    setNumber(c, 'minBodyChars', '٤٠٠');
    assert.equal((c.expect as Record<string, unknown>).minBodyChars, 400, 'Arabic-Indic digits are read');
    assert.equal(parseNumber('۰٫۵'), 0.5);
    assert.equal(parseNumber('abc'), null);
  });

  test('forbidden phrases: one per line, trimmed, lower-case; Arabic is a flag', () => {
    const c = newCase('x.case-1');
    setForbidden(c, '  I Approved The Budget \n\nguaranteed results');
    assert.deepEqual((c.expect as Record<string, unknown>).forbidden, ['i approved the budget', 'guaranteed results']);
    assert.equal(forbiddenText(c), 'i approved the budget\nguaranteed results');
    setArabic(c, true);
    assert.deepEqual(statedKeys(c), ['evidence', 'arabicBody', 'forbidden']);
    setArabic(c, false);
    setForbidden(c, '');
    assert.deepEqual(statedKeys(c), ['evidence']);
  });

  test('a case with nothing critical says so in plain words', () => {
    const c = newCase('x.case-1');
    c.content = 'text';
    setCritical(c, 'evidence', false);
    assert.equal(caseProblem(c), 'mark at least one stated expectation as critical');
    setChoice(c, 'evidence', 'INSUFFICIENT', false);
    setChoice(c, 'evidence', 'PARTIAL', false);
    assert.equal(caseProblem(c), 'state at least one expectation');
  });
});

describe('COMPANY-TALENT-01: competencies as ordinary fields', () => {
  test('a typed code becomes the UPPER_CASE contract code; problems are plain words', () => {
    assert.equal(competencyCode(' source verification '), 'SOURCE_VERIFICATION');
    assert.equal(competencyCode('Reddit-community rules!'), 'REDDIT_COMMUNITY_RULES');
    const all = [newCompetency([])];
    assert.equal(all[0]?.code, 'COMPETENCY_1');
    assert.equal(competencyProblem(all[0] as Record<string, unknown>, all), 'the competency needs a description');
    (all[0] as Record<string, unknown>).title = 'Separates verified facts from rumours';
    assert.equal(competencyProblem(all[0] as Record<string, unknown>, all), null);
    all.push({ ...all[0] });
    assert.equal(competencyProblem(all[1] as Record<string, unknown>, all), 'two competencies share this code');
    assert.equal(newCompetency(all).code, 'COMPETENCY_3');
    assert.equal(competencyProblem({ code: 'AB', title: 'x', critical: true, passPct: 70, retrain: 'ROLE_MASTERY' }, []), 'the code needs at least three letters or digits, starting with a letter');
    assert.equal(competencyProblem({ code: 'ABC', title: 'x', critical: true, passPct: 0, retrain: 'ROLE_MASTERY' }, []), 'the pass mark is 1 to 100');
  });
});
