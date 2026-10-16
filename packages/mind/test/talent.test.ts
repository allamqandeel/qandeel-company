/**
 * COMPANY-TALENT-01 — the Talent Catalog's pure contracts: identity completeness, the identity kernel and digest,
 * specialty competencies, Skill licence provenance and Tool scenarios. Synthetic text only; no I/O.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CEO_ACADEMY_PACKAGE_V7,
  COMPETENCY_PRESETS,
  IDENTITY_KERNEL_MAX,
  academyPackageDigest,
  assertAcademyPackage,
  assertCompetencies,
  assertIdentitySpec,
  evaluateCompetencies,
  identityGaps,
  identityKernel,
  identitySpecDigest,
  identityTemplate,
  programTemplate,
  type IdentitySpec,
} from '../src/index.js';

const spec = (overrides: Partial<IdentitySpec> = {}): IdentitySpec => ({
  roleRef: 'role:growth.reddit',
  name: { given: 'Synthetic', family: 'Person', ar: 'شخص تجريبي' },
  title: 'Reddit Growth Specialist',
  roleSummary: 'SYNTHETIC: grows QANDEEL on Reddit from evidence, within budget and authority.',
  personality: ['curious', 'careful'],
  professionalStyle: 'SYNTHETIC: evidence first, states assumptions and confidence explicitly.',
  communicationStyle: 'SYNTHETIC: short, clear, separates facts from analysis.',
  specialties: ['community research', 'experiment design'],
  marketExpertise: ['SYNTHETIC: Arabic-speaking communities'],
  workBehaviour: 'SYNTHETIC: plans small, verifies sources, escalates beyond its authority.',
  qualityStandards: ['every claim cites its source'],
  boundaries: ['never spends or publishes without approval'],
  designedBackground: null,
  sourceRef: 'doc:docs/talent/synthetic.md',
  ...overrides,
});

const skill = (code: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  code,
  name: `Skill ${code}`,
  versionLabel: '1.0.0',
  instructions: `SYNTHETIC skill ${code}: work from current, citable sources; state the evidence and its date; separate verified facts from assumptions; propose a small reversible test with a success metric and a stop rule.`,
  blueprintCategory: 'REQUIRED',
  critical: true,
  minProficiency: 'QUALIFIED',
  targetProficiency: 'QUALIFIED',
  sourceRefs: ['authority:stage-7'],
  benchmark: [{ code: `${code}.case-1`, content: `SYNTHETIC benchmark case for ${code}: a growth idea arrives with weak evidence. Decide.`, expect: { evidence: ['INSUFFICIENT', 'PARTIAL'], critical: ['evidence'] } }],
  ...extra,
});

function pkg(opts: { skills?: Record<string, unknown>[]; scenarios?: Record<string, unknown>[]; competencies?: unknown } = {}): Record<string, unknown> {
  const base = programTemplate({ roleRef: 'role:growth.reddit', code: 'growth.reddit', title: 'Reddit specialist program', leader: false }) as Record<string, unknown> & { program: Record<string, unknown> };
  const skills = opts.skills ?? [skill('growth.reddit.research'), skill('growth.reddit.experiments')];
  return {
    ...base,
    skills,
    program: { ...base.program, skillTargets: skills.map((s) => ({ skillCode: s.code, proficiency: 'QUALIFIED' })), ...(opts.competencies !== undefined ? { competencies: opts.competencies } : {}) },
    scenarios: opts.scenarios ?? [
      { code: 'growth.reddit.practice-1', kind: 'PRACTICE', sourceRef: 'scenario:synthetic', budgetMicros: 40_000, content: 'SYNTHETIC practice: plan a first two-week test.' },
      { code: 'growth.reddit.assess-1', kind: 'ASSESSMENT', sourceRef: 'scenario:synthetic', budgetMicros: 40_000, content: 'SYNTHETIC assessment: read these metrics.' },
      { code: 'growth.reddit.assess-2', kind: 'ASSESSMENT', sourceRef: 'scenario:synthetic', budgetMicros: 40_000, content: 'SYNTHETIC assessment: a rumour says the algorithm changed.' },
      { code: 'growth.reddit.holdout-1', kind: 'HOLDOUT', sourceRef: 'scenario:synthetic', budgetMicros: 40_000, content: 'SYNTHETIC hidden holdout: promise viral reach.' },
    ],
    shadowAssignments: [{ code: 'growth.reddit.shadow-1', objective: 'SYNTHETIC internal brief', instructions: 'SYNTHETIC: write an internal brief only.', capMicros: 60_000 }],
  };
}

const refusedField = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { details?: { field?: string } }).details?.field ?? (e as Error).message);
  }
  return 'NOT_REFUSED';
};

describe('COMPANY-TALENT-01: an identity profile is complete data, never authority', () => {
  test('a complete profile has no gaps; the empty template has every Stage 4 §7 gap', () => {
    assert.deepEqual(identityGaps(spec()), []);
    const gaps = identityGaps(identityTemplate('role:growth.reddit')).map((g) => g.field);
    for (const f of ['title', 'roleSummary', 'personality', 'professionalStyle', 'communicationStyle', 'specialties', 'workBehaviour', 'qualityStandards', 'boundaries']) assert.ok(gaps.includes(f), `template lacks ${f}`);
    assert.equal(identityGaps(null)[0]?.reason, 'NOT_AN_OBJECT');
  });

  test('unknown fields, bad refs, secrets and authority claims are refused', () => {
    assert.ok(identityGaps({ ...spec(), grants: ['tool:x.y'] }).some((g) => g.field === 'grants' && g.reason === 'UNKNOWN_FIELD'), 'a profile cannot carry grants');
    assert.ok(identityGaps(spec({ roleRef: 'growth' })).some((g) => g.field === 'roleRef'));
    assert.ok(identityGaps(spec({ sourceRef: 'not a ref' })).some((g) => g.field === 'sourceRef'));
    assert.ok(identityGaps(spec({ personality: ['one'] })).some((g) => g.field === 'personality'));
    const secret = ['sk', '-ant-', 'api03-', 'aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zaB3dE5gH7jK9'].join('');
    assert.ok(identityGaps(spec({ workBehaviour: `SYNTHETIC: uses the key ${secret} for everything` })).some((g) => g.reason === 'SECRET_MATERIAL'));
    assert.equal(refusedField(() => assertIdentitySpec(spec({ title: '' }))), 'title');
  });

  test('the kernel is deterministic, bounded, never states authority, and labels a designed background', () => {
    const s = assertIdentitySpec(spec({ designedBackground: 'SYNTHETIC: ten years of community work before QANDEEL.' }));
    const k = identityKernel(s);
    assert.equal(k, identityKernel(assertIdentitySpec(spec({ designedBackground: 'SYNTHETIC: ten years of community work before QANDEEL.' }))));
    assert.ok(k.length <= IDENTITY_KERNEL_MAX);
    assert.match(k, /^You are Reddit Growth Specialist\./);
    assert.match(k, /not real QANDEEL history/);
    assert.match(k, /Your title grants no authority/);
    assert.doesNotMatch(k, /role:growth|doc:docs/, 'role and source refs stay out of the kernel (read live)');
    const long = 'SYNTHETIC long standard that keeps going and going to exceed the kernel cap on purpose.'.padEnd(239, '.');
    assert.ok(identityGaps(spec({ qualityStandards: Array(10).fill(long), boundaries: Array(10).fill(long) })).some((g) => g.reason === 'KERNEL_TOO_LONG'), 'an over-long kernel must be condensed, never cut');
  });

  test('the digest freezes content: normalization-equal profiles share it, any change does not', () => {
    const a = identitySpecDigest(spec());
    assert.equal(a, identitySpecDigest(spec({ title: '  Reddit Growth Specialist  ' })));
    assert.notEqual(a, identitySpecDigest(spec({ specialties: ['community research'] })));
    assert.match(a, /^[0-9a-f]{64}$/);
  });
});

describe('COMPANY-TALENT-01: specialty competencies (condition C)', () => {
  test('the presets are valid rules; platform research and verification are critical', () => {
    for (const [name, rules] of Object.entries(COMPETENCY_PRESETS)) assert.equal(assertCompetencies(rules).length, rules.length, name);
    const growth = COMPETENCY_PRESETS['platform-growth'] ?? [];
    assert.ok(growth.find((r) => r.code === 'SOURCE_VERIFICATION')?.critical);
    assert.match(growth.find((r) => r.code === 'SOURCE_VERIFICATION')?.title ?? '', /never claims unpublished internals/);
  });

  test('a duplicate code, a bad threshold or an unknown retrain category is refused', () => {
    const r = { code: 'PLATFORM_RESEARCH', title: 'x', critical: true, passPct: 70, retrain: 'MARKET_INTELLIGENCE' };
    assert.throws(() => assertCompetencies([r, r]), /distinct/);
    assert.throws(() => assertCompetencies([{ ...r, passPct: 0 }]), /passPct/);
    assert.throws(() => assertCompetencies([{ ...r, retrain: 'VIBES' }]), /retrain/);
    assert.throws(() => assertCompetencies(Array.from({ length: 13 }, (_, i) => ({ ...r, code: `CODE_${i}A` }))), /at most 12/);
  });

  test('evaluation names missing, failed and critical failures', () => {
    const rules = assertCompetencies(COMPETENCY_PRESETS['platform-growth']);
    const all = rules.map((x) => ({ code: x.code, scorePct: 90 }));
    assert.deepEqual(evaluateCompetencies(rules, all), { missing: [], failed: [], criticalFailures: [] });
    const v = evaluateCompetencies(rules, all.map((x) => (x.code === 'METRIC_INTERPRETATION' ? { ...x, scorePct: 40 } : x.code === 'HYPOTHESIS_QUALITY' ? { ...x, scorePct: 10 } : x)).filter((x) => x.code !== 'UPDATE_DISCIPLINE'));
    assert.deepEqual(v.missing, ['UPDATE_DISCIPLINE']);
    assert.deepEqual([...v.failed].sort(), ['HYPOTHESIS_QUALITY', 'METRIC_INTERPRETATION']);
    assert.deepEqual(v.criticalFailures, ['METRIC_INTERPRETATION']);
  });
});

describe('COMPANY-TALENT-01: Academy programs as data', () => {
  test('a complete program validates; competencies ride in the program and change its digest', () => {
    const plain = assertAcademyPackage(pkg());
    const withComp = assertAcademyPackage(pkg({ competencies: COMPETENCY_PRESETS['platform-growth'] }));
    assert.notEqual(academyPackageDigest(plain), academyPackageDigest(withComp));
    assert.throws(() => assertAcademyPackage(pkg({ competencies: [{ code: 'bad' }] })));
  });

  test('the skeleton template cannot be submitted (no Skills, no scenarios) and pins this build’s BQM-2 method', () => {
    const t = programTemplate({ roleRef: 'role:growth.reddit', code: 'growth.reddit', title: 'x', leader: true }) as { program: { founderCalibrationRequired: boolean }; benchmarkMethod: unknown };
    assert.equal(t.program.founderCalibrationRequired, true, 'a leadership program requires Founder Calibration (D6)');
    assert.throws(() => assertAcademyPackage(t));
    assert.deepEqual((assertAcademyPackage(pkg()) as unknown as { benchmarkMethod: unknown }).benchmarkMethod, t.benchmarkMethod);
  });

  test('provenance: a QANDEEL-native Skill adapted from a clearly free source passes; unclear or missing licences are refused', () => {
    const ok = skill('growth.reddit.research', { provenance: { origin: 'ADAPTED_FREE_SOURCE', sources: [{ ref: 'url:https://example.org/guide', licenseSpdx: 'CC0-1.0' }] } });
    assert.doesNotThrow(() => assertAcademyPackage(pkg({ skills: [ok, skill('growth.reddit.experiments')] })));
    const bad = skill('growth.reddit.research', { provenance: { origin: 'ADAPTED_FREE_SOURCE', sources: [{ ref: 'url:https://example.org/paid', licenseSpdx: 'LicenseRef-Proprietary' }] } });
    assert.throws(() => assertAcademyPackage(pkg({ skills: [bad, skill('growth.reddit.experiments')] })));
    const none = skill('growth.reddit.research', { provenance: { origin: 'ADAPTED_FREE_SOURCE', sources: [] } });
    assert.throws(() => assertAcademyPackage(pkg({ skills: [none, skill('growth.reddit.experiments')] })));
  });

  test('a Tool scenario never stands in for the text assessment, and never runs as practice', () => {
    const base = (pkg() as { scenarios: Record<string, unknown>[] }).scenarios;
    const tool = { code: 'growth.reddit.tool-1', kind: 'ASSESSMENT', sourceRef: 'scenario:synthetic', budgetMicros: 40_000, toolCode: 'video-editor', content: 'SYNTHETIC tool scenario.' };
    assert.doesNotThrow(() => assertAcademyPackage(pkg({ scenarios: [...base, tool] })));
    assert.throws(() => assertAcademyPackage(pkg({ scenarios: [...base, { ...tool, kind: 'PRACTICE' }] })), 'a Tool scenario is never practice');
    const onlyToolAssessment = base.filter((s) => s.kind !== 'ASSESSMENT').concat([tool]);
    assert.throws(() => assertAcademyPackage(pkg({ scenarios: onlyToolAssessment })), 'the text assessment must exist without the Tool');
  });

  test('the released CEO package is untouched: no competencies, same digest after validation', () => {
    assert.equal('competencies' in CEO_ACADEMY_PACKAGE_V7.program, false);
    assert.equal(academyPackageDigest(assertAcademyPackage(CEO_ACADEMY_PACKAGE_V7)), academyPackageDigest(CEO_ACADEMY_PACKAGE_V7));
  });
});
