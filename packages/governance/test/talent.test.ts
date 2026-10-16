/**
 * COMPANY-TALENT-01 — governance contracts: talent intents (structured-only), headcount (D7), access-policy templates and
 * eligibility (D2–D5), the Company documents source list (D3) and the new organizational capabilities.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Timestamp } from '@qandeel-company/domain';

import {
  ACCESS_POLICY_TEMPLATES,
  COMPANY_DOCS_ACTION_DEFINITION,
  COMPANY_LOCATOR_DOCS,
  MUTATING_INTENTS,
  STAFFING_HEADCOUNT_MAX,
  TALENT_INTENTS,
  accessPolicyTemplate,
  assertCapability,
  assertHeadcount,
  classifyFounderIntent,
  decideOrgAct,
  isCompanyDocPath,
  policyEligible,
} from '../src/index.js';

describe('COMPANY-TALENT-01: talent intents are governed and never reached from free text', () => {
  test('every talent intent is a mutating Founder intent (preview → fingerprint → confirm)', () => {
    for (const i of TALENT_INTENTS) assert.ok((MUTATING_INTENTS as readonly string[]).includes(i), i);
  });

  test('no free-text command classifies to a talent intent', () => {
    const phrases = ['approve identity for majed', 'hire majed', 'approve the reddit program', 'grant the leadership policy', 'raise the growth department budget', 'وافق على هوية ماجد', 'عيّن ماجد', 'اعتمد برنامج ريديت', 'evaluate the video editor', 'assign an evaluator'];
    for (const p of phrases) {
      const c = classifyFounderIntent(p);
      assert.ok(!(c.kind === 'MUTATING' && (TALENT_INTENTS as readonly string[]).includes(c.intent)), `${p} → ${JSON.stringify(c)}`);
    }
  });
});

describe('COMPANY-TALENT-01 D7: a staffing request states a bounded headcount', () => {
  test('1..max integers pass; anything else is refused', () => {
    assert.equal(assertHeadcount(1), 1);
    assert.equal(assertHeadcount(STAFFING_HEADCOUNT_MAX), STAFFING_HEADCOUNT_MAX);
    assert.equal(assertHeadcount(undefined), 1, 'an earlier request is one seat');
    for (const bad of [0, -1, 1.5, STAFFING_HEADCOUNT_MAX + 1, '3']) assert.throws(() => assertHeadcount(bad), String(bad));
  });
});

describe('COMPANY-TALENT-01 D2–D5: access-policy templates', () => {
  test('the four templates exist; every grant is read-only R0 or internal R1 and proposal-only', () => {
    assert.deepEqual(ACCESS_POLICY_TEMPLATES.map((t) => t.code), ['leadership.app-knowledge', 'leadership.company-knowledge', 'leadership.proposals', 'leadership.academy-evaluation']);
    for (const t of ACCESS_POLICY_TEMPLATES)
      for (const g of t.grants) {
        assert.doesNotThrow(() => assertCapability(g.capability), g.capability);
        assert.ok(g.riskCeiling === 'R0' || g.riskCeiling === 'R1');
        assert.ok(!/hire|decide|app-control|model\.invoke/.test(g.capability), `${g.capability} is never issued by a policy`);
      }
    for (const code of ['leadership.app-knowledge', 'leadership.company-knowledge']) for (const g of accessPolicyTemplate(code)?.grants ?? []) assert.equal(g.riskCeiling, 'R0', `${code} is read-only`);
    assert.equal(accessPolicyTemplate('nope'), null);
  });

  test('eligibility: PRIMARY CEO / Director seat from CANDIDATE; lost on SUSPENDED, RETIRED or a non-primary seat', () => {
    const g = accessPolicyTemplate('leadership.app-knowledge')?.grants[0];
    assert.ok(g);
    assert.equal(policyEligible('DIRECTOR', 'PRIMARY', 'CANDIDATE', g), true, 'D2: may be issued at CANDIDATE');
    assert.equal(policyEligible('CEO', 'PRIMARY', 'ACTIVE', g), true);
    assert.equal(policyEligible('DIRECTOR', 'PRIMARY', 'SUSPENDED', g), false);
    assert.equal(policyEligible('DIRECTOR', 'PRIMARY', 'RETIRED', g), false);
    assert.equal(policyEligible('DIRECTOR', 'ACTING', 'ACTIVE', g), false);
    assert.equal(policyEligible('SPECIALIST', 'PRIMARY', 'ACTIVE', g), false);
    const review = accessPolicyTemplate('leadership.proposals')?.grants.find((x) => x.capability === 'org.staffing.review');
    assert.ok(review);
    assert.equal(policyEligible('DIRECTOR', 'PRIMARY', 'ACTIVE', review), false, 'only the CEO reviews staffing requests');
  });

  test('the new capabilities parse and still need an explicit grant (Title ≠ Authority)', () => {
    for (const c of ['org.talent.propose', 'org.academy.evaluate', 'org.academy.review']) assert.equal(assertCapability(c), c);
    const at = '2026-10-16T00:00:00.000Z' as Timestamp;
    assert.deepEqual(decideOrgAct('ACTIVE', [], { capability: 'org.talent.propose', resource: '*', at }), { effect: 'DENY', code: 'NO_GRANT' });
    const grant = { id: 'g1', capability: 'org.talent.propose', resourceScope: '*', riskCeiling: 'R1' as const, dataClassCeiling: 'D1' as const, expiresAt: null, maxUses: null, uses: 0, status: 'ACTIVE' as const };
    assert.equal(decideOrgAct('ACTIVE', [grant], { capability: 'org.talent.propose', resource: '*', at }).effect, 'ALLOW');
    assert.equal(decideOrgAct('SUSPENDED', [grant], { capability: 'org.talent.propose', resource: '*', at }).effect, 'DENY');
  });
});

describe('COMPANY-TALENT-01 D3: the Company documents source is a closed list', () => {
  test('README and docs/authority Markdown only; never code, config, hidden files or a climbing path', () => {
    for (const p of COMPANY_LOCATOR_DOCS) assert.ok(isCompanyDocPath(p), p);
    assert.ok(isCompanyDocPath('docs/authority/company-architecture/stage-08/STAGE_08.md'));
    for (const p of ['package.json', 'packages/storage/src/index.ts', 'docs/architecture/DECISION_LOG.md', '.github/workflows/ci.yml', 'docs/authority/../../.env', 'docs/authority/.hidden.md', 'docs/authority//x.md', 'docs\\authority\\x.md', 'docs/authority/x.txt', 'docs/talent/MAJED.md', '/etc/passwd'])
      assert.equal(isCompanyDocPath(p), false, p);
  });

  test('the read is R0, side-effect free, free of charge', () => {
    assert.equal(COMPANY_DOCS_ACTION_DEFINITION.risk, 'R0');
    assert.equal(COMPANY_DOCS_ACTION_DEFINITION.sideEffects, 'NONE');
    assert.equal(COMPANY_DOCS_ACTION_DEFINITION.mutatesExternal, false);
    assert.equal(COMPANY_DOCS_ACTION_DEFINITION.costPerCallMicros, 0);
  });
});
