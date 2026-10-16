/**
 * COMPANY-TALENT-01 — parity between the studio's ordinary fields (`@qandeel-company/command-center-ui` talentForms) and
 * the real contracts: the closed lists match, and Benchmark cases and competencies built only through the fields pass
 * the same `assertAcademyPackage` a catalog program passes on save and approval. The browser bundle cannot import the
 * contracts, so this is where drift would show.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { talentForms as f } from '@qandeel-company/command-center-ui';
import { ANSWER_AUTHORITY, ANSWER_CONFIDENCE, ANSWER_DECISIONS, ANSWER_EVIDENCE } from '@qandeel-company/governance';
import { CEO_ACADEMY_PACKAGE_V7, CURRICULUM_CATEGORIES, EXPECTATION_KEYS, assertAcademyPackage, assertCompetencies } from '@qandeel-company/mind';

describe('COMPANY-TALENT-01: the studio fields match the Academy contracts', () => {
  test('closed lists are identical', () => {
    assert.deepEqual(f.EXPECT_CHOICES.decision, ANSWER_DECISIONS);
    assert.deepEqual(f.EXPECT_CHOICES.authority, ANSWER_AUTHORITY);
    assert.deepEqual(f.EXPECT_CHOICES.evidence, ANSWER_EVIDENCE);
    assert.deepEqual(f.EXPECT_CHOICES.confidence, ANSWER_CONFIDENCE);
    assert.deepEqual(f.EXPECTATION_KEYS, EXPECTATION_KEYS);
    assert.deepEqual(f.CURRICULUM_CATEGORIES, CURRICULUM_CATEGORIES);
  });

  test('cases and competencies made only with the fields pass assertAcademyPackage', () => {
    const c1 = f.newCase('ceo.form.case-1');
    c1.content = 'SYNTHETIC: a partner offers a paid campaign today on unverified reach numbers. Decide what to do.';
    f.setChoice(c1, 'decision', 'GATHER_EVIDENCE', true);
    f.setChoice(c1, 'decision', 'ESCALATE_TO_FOUNDER', true);
    f.setCritical(c1, 'decision', true);
    f.setTri(c1, 'reversible', 'YES');
    f.setNumber(c1, 'maxSpendMicros', '0');
    f.setNumber(c1, 'minBodyChars', '200');
    f.setForbidden(c1, 'I Approved The Campaign\nguaranteed reach');
    f.setCritical(c1, 'forbidden', true);
    const c2 = f.newCase('ceo.form.case-2');
    c2.content = 'SYNTHETIC: answer in Arabic — the Founder asks for a short status.';
    f.setArabic(c2, true);
    f.setCritical(c2, 'arabicBody', true);
    for (const c of [c1, c2]) assert.equal(f.caseProblem(c), null);

    const comps: Record<string, unknown>[] = [];
    const a = f.newCompetency(comps);
    a.code = f.competencyCode('source verification');
    a.title = 'Separates verified facts from rumours';
    comps.push(a);
    const b = f.newCompetency(comps);
    b.title = 'Testable hypotheses with a metric and a stop rule';
    b.critical = false;
    b.retrain = 'REAL_CASE_STUDIES';
    comps.push(b);
    for (const c of comps) assert.equal(f.competencyProblem(c, comps), null);
    assert.equal(assertCompetencies(comps).length, 2);

    const base = structuredClone(CEO_ACADEMY_PACKAGE_V7) as unknown as { skills: Record<string, unknown>[]; program: Record<string, unknown> };
    base.skills[0] = { ...base.skills[0], benchmark: [c1, c2] };
    base.program.competencies = comps;
    assert.doesNotThrow(() => assertAcademyPackage(base));
  });
});
