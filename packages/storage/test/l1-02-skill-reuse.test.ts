/**
 * L1-02 / D-L1-27 — reusable Skill qualification at the store boundary (migration 0019).
 *
 * A Skill Version is qualified ONCE, on its own immutable evidence, inside the one package that owns it; its verdict is
 * derived per version from its own scored rows — a package whose other Skills failed never erases it. A later package may
 * bind a Skill as REUSE_QUALIFIED and consume that exact version (no new version, no static re-review, no benchmark Work
 * Item) only when the evidence is complete and PASSED, the version is still cleared, current and intact, and the
 * qualification fingerprint (SQF-1) is equal. Ownership stays one-to-one; consumption is many-to-one; nothing moves.
 * Every observation here is answered through the governed path (claim → assemble → reserve → recordAnswer → settle).
 * L1-02-PROOF: skill-reuse-store
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ManualClock, isQandeelError, newId, type Id } from '@qandeel-company/domain';
import { CEO_ACADEMY_PACKAGE_V4, CEO_ACADEMY_PACKAGE_V5, CEO_ACADEMY_PACKAGE_V6, CEO_ACADEMY_PACKAGE_V7, CEO_V5_REUSED_SKILLS, CEO_V6_REUSED_SKILLS, CEO_V6_REVISED_SKILL, CEO_V7_REUSED_SKILLS, CEO_V7_REVISED_SKILL, academyPackageDigest, skillQualificationFingerprint, type AcademyPackage, type AnswerExpectation } from '@qandeel-company/mind';

import { AcademyPackageStore, FounderActionStore, FounderAuthStore, SkillStore, loadReleasedMigrations } from '../src/index.js';
import { recordAnswer, reserveBudget, settle, settleReservation } from '../src/runtime-authority.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { hire, seed, type Seed } from './c2-helpers.js';
import { assemble, claimFor } from './c3-helpers.js';
import { backoff, harness, removeRoot, tempRoot, type Harness } from './helpers.js';

const V4 = CEO_ACADEMY_PACKAGE_V4;
const reason = (r: string) => (e: unknown): boolean => isQandeelError(e) && e.details['reason'] === r;
const rejected = (re: RegExp) => (e: unknown): boolean => isQandeelError(e, 'STORAGE_INVARIANT') && re.test(String((e as Error).cause));
/** The one Skill made to fail in the owner package (any Skill would do: the mechanism names none). */
const FAILING = 'ceo.governance-discipline';
const caseSkill = (code: string): string => V4.skills.find((s) => s.benchmark.some((b) => b.code === code))?.code ?? '';

/** A truthful ANSWER for an expectation (the case passes), or an overconfident one (decision PROCEED: a critical miss). */
function answerFor(e: AnswerExpectation, wrong: boolean): Record<string, unknown> {
  if (wrong) return { type: 'ANSWER', body: 'This will definitely work. I approve it: done.', decision: 'PROCEED', reversible: true, authority: 'WITHIN_HELD_AUTHORITY', evidence: 'SUFFICIENT', confidence: 'HIGH', founderDecisionNeeded: false, spendMicros: 0 };
  const body = e.arabicBody ? 'التوصية: نجمع دليلاً كافياً أولاً، والقرار النهائي للـFounder. لا أملك صلاحية تتجاوز ما فُوّض لي. '.repeat(4) : 'Recommendation with owner, evidence status, risks and the decision needed, stated plainly. '.repeat(4);
  return { type: 'ANSWER', body, decision: e.decision?.[0] ?? 'GATHER_EVIDENCE', reversible: e.reversible ?? false, authority: e.authority?.[0] ?? 'NEEDS_FOUNDER', evidence: e.evidence?.[0] ?? 'PARTIAL', confidence: e.confidence?.[0] ?? 'MEDIUM', founderDecisionNeeded: e.founderDecisionNeeded ?? true, spendMicros: 0 };
}

interface World {
  readonly h: Harness;
  readonly s: Seed;
  readonly trainee: Id;
  /** Registers and qualifies a package (the Founder's preview → exact fingerprint → confirm); returns the preview payload. */
  readonly qualify: (p: AcademyPackage) => Record<string, unknown>;
  readonly preview: (intent: string, p: AcademyPackage) => Record<string, unknown>;
  readonly confirm: (intent: string, p: AcademyPackage, extra?: Record<string, unknown>) => string;
  readonly store: AcademyPackageStore;
  readonly packageId: (p: AcademyPackage) => Id;
  /** Every OPEN observation of a package: answered (or ended) through the governed path. */
  readonly answerAll: (p: AcademyPackage, how?: (skill: string, caseCode: string, arm: string) => 'TRUE' | 'WRONG' | 'INFRA' | 'SILENT') => void;
}

function withWorld(registry: readonly AcademyPackage[], fn: (w: World) => void): void {
  const h = harness();
  try {
    const s = seed(h.store, { companyCap: 50_000_000, employeeCap: 40_000_000 });
    const e = hire(s.gov, s.founder, s.departmentId, false, V4.roleRef);
    s.gov.transitionEmployee(s.founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    s.gov.createBudget(s.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 30_000_000, capTokens: 5_000_000, reasonCode: 'seed' });
    s.gov.grant(s.founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D2', reasonCode: 'seed' });
    const auth = FounderAuthStore.for(h.store);
    const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
    const actions = FounderActionStore.for(h.store, auth, { academyPackages: registry });
    const args = (p: AcademyPackage) => ({ packageCode: p.code, packageVersion: p.version, packageSha256: academyPackageDigest(p) });
    const preview = (intent: string, p: AcademyPackage): Record<string, unknown> => actions.preview(session, intent, { ...args(p), ...(intent === 'SKILL_PACKAGE_QUALIFY' ? { subjectEmployeeId: e.id } : {}) }).payload as Record<string, unknown>;
    const confirm = (intent: string, p: AcademyPackage, extra: Record<string, unknown> = {}): string => {
      const pv = actions.preview(session, intent, { ...args(p), ...(intent === 'SKILL_PACKAGE_QUALIFY' ? { subjectEmployeeId: e.id } : {}), ...extra });
      return actions.confirm(session, pv.id, pv.fingerprint).resultRef;
    };
    const qualify = (p: AcademyPackage): Record<string, unknown> => {
      const payload = preview('SKILL_PACKAGE_QUALIFY', p);
      confirm('SKILL_PACKAGE_QUALIFY', p);
      return payload;
    };
    const db = storeContext(h.store).db;
    const packageId = (p: AcademyPackage): Id => db.get<{ id: string }>('SELECT id FROM academy_packages WHERE code = ? AND package_version = ?', p.code, p.version)?.id as Id;
    const answerAll: World['answerAll'] = (p, how = () => 'TRUE') => {
      const open = db.all<{ work_item_id: string; case_code: string; arm: string }>(`SELECT work_item_id, case_code, arm FROM skill_benchmark_runs WHERE package_id = ? AND state = 'OPEN' ORDER BY case_code, arm, observation_no`, packageId(p));
      for (const r of open) {
        const skill = caseSkill(r.case_code);
        const expect = V4.skills.find((x) => x.code === skill)?.benchmark.find((b) => b.code === r.case_code)?.expect;
        assert.ok(expect);
        const { claim } = claimFor(h, r.work_item_id as Id);
        const mode = how(skill, r.case_code, r.arm);
        if (mode === 'INFRA') {
          settle(h.store, claim.fence, { type: 'PERMANENT_FAILURE', code: 'PROVIDER_UNAVAILABLE' }, { backoff });
          continue;
        }
        if (mode === 'SILENT') {
          settle(h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
          continue;
        }
        const m = assemble(h, claim, 0);
        assert.equal(m.outcome, 'OK');
        if (m.outcome !== 'OK') continue;
        const res = reserveBudget(h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: s.deploymentId, priceCardId: s.priceCardId, routePolicyId: s.policyId, money: 1_000, tokens: 10_000, contextManifestId: m.manifestId });
        assert.ok(res.ok, `reserve: ${JSON.stringify(res)}`);
        assert.equal(recordAnswer(h.store, claim.fence, answerFor(expect, mode === 'WRONG') as never, { manifestId: m.manifestId, step: 0 }).outcome, 'RECORDED');
        if (res.ok) settleReservation(h.store, claim.fence, res.reservation.id, { inputTokens: 100, outputTokens: 50, withinBounds: true, sessionId: null, outcome: 'OK' });
        settle(h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
      }
    };
    fn({ h, s, trainee: e.id, qualify, preview, confirm, store: AcademyPackageStore.for(h.store, registry), packageId, answerAll });
  } finally {
    h.close();
  }
}

/** A later package of the same role: reuses every Skill named in `reuse` (its exact version), qualifies the others anew. */
const later = (version: number, reuse: readonly string[], change: (p: AcademyPackage) => AcademyPackage = (p) => p): AcademyPackage => change({
  ...V4,
  version,
  title: `Synthetic later package v${version} (test only)`,
  skills: V4.skills.map((s) => (reuse.includes(s.code) ? { ...s, binding: 'REUSE_QUALIFIED' as const } : { ...s, versionLabel: `1.0.0+t${version}` })),
});

const qualified = (w: World, p: AcademyPackage) => w.store.view(p).skills.map((s) => `${s.code}:${s.qualification.status}:${s.qualification.reason ?? '-'}`);
const versionOf = (w: World, p: AcademyPackage, code: string): Id => w.store.view(p).skills.find((s) => s.code === code)?.skillVersionId as Id;

describe('D-L1-27: a Skill Version is qualified once on its own evidence and may be reused by a later package (0019)', () => {
  test('a failed package keeps its passing Skill Versions: each one is QUALIFIED on its own complete evidence; the failed one is not; nothing is approved', () => {
    const MIX = later(5, V4.skills.filter((s) => s.code !== FAILING).map((s) => s.code));
    withWorld([V4, MIX], (w) => {
      assert.equal(w.qualify(V4).benchmarkRuns, 120);
      // OPEN rows are not evidence: before finalization nothing is qualified (incomplete), and nothing can be reused.
      assert.ok(qualified(w, V4).every((q) => q.endsWith(':NOT_QUALIFIED:EVIDENCE_INCOMPLETE')), 'an unfinished qualification is never reusable');
      w.answerAll(V4, (skill, _c, arm) => (skill === FAILING && arm === 'WITH_SKILL' ? 'WRONG' : 'TRUE'));
      assert.ok(qualified(w, V4).every((q) => q.endsWith(':NOT_QUALIFIED:EVIDENCE_INCOMPLETE')), 'answered but OPEN is still not durable evidence');
      assert.throws(() => w.preview('SKILL_PACKAGE_QUALIFY', MIX), reason('REUSE_NOT_QUALIFIED'), 'no reuse before the evidence is finalized');
      assert.equal(w.qualify(V4).qualification, 'FINALIZE_SCORES');
      const view = w.store.view(V4);
      assert.equal(view.installable, false, 'the package failed');
      for (const s of view.skills) {
        const pass = s.code !== FAILING;
        assert.equal(s.qualification.status, pass ? 'QUALIFIED' : 'NOT_QUALIFIED', s.code);
        assert.equal(s.qualification.reason, pass ? null : 'QUALIFICATION_FAILED');
        assert.deepEqual(s.qualification.sourcePackage, { id: w.packageId(V4), code: V4.code, version: 4, sha256: academyPackageDigest(V4) }, 'the owner package is identifiable');
        assert.equal(s.qualification.fingerprint, skillQualificationFingerprint(V4, s.code));
        assert.equal(s.qualification.observations, 20);
        assert.match(String(s.qualification.evidenceSha256), /^[0-9a-f]{64}$/);
        assert.equal(s.pipelineState, 'SANDBOXED', 'deriving qualification changes no state: qualified evidence is not approval');
        assert.equal(s.binding, 'QUALIFY_NEW');
      }
    });
  });

  test('a later mixed package reuses the qualified versions (same Skill and version IDs, no new version, review, Work Item or spend) and qualifies only the others: 1 failed Skill × 2 cases × 2 arms × 5 = 20 observations; the complete role installs only when every bound Skill qualified', () => {
    const reuse = V4.skills.filter((s) => s.code !== FAILING).map((s) => s.code);
    const MIX = later(5, reuse);
    const MIX2 = later(6, reuse);
    withWorld([V4, MIX, MIX2], (w) => {
      const db = storeContext(w.h.store).db;
      w.qualify(V4);
      w.answerAll(V4, (skill, _c, arm) => (skill === FAILING && arm === 'WITH_SKILL' ? 'WRONG' : 'TRUE'));
      w.qualify(V4);
      const v4Rows = JSON.stringify(db.all('SELECT * FROM skill_benchmark_runs WHERE package_id = ? ORDER BY id', w.packageId(V4)));
      const before = { versions: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM skill_versions')?.n, reviews: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM skill_security_reviews')?.n, items: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM work_items')?.n, spent: db.get<{ s: number }>('SELECT COALESCE(SUM(economic_micros), 0) AS s FROM usage_records')?.s };
      const p = w.preview('SKILL_PACKAGE_QUALIFY', MIX);
      assert.equal(p.benchmarkRuns, 20, 'only the newly qualified Skill is benchmarked');
      assert.equal(p.totalCapBoundMicros, 20 * V4.limits.benchmarkCapMicros);
      assert.equal((p.reusedSkills as string[]).length, 5);
      assert.deepEqual(p.newlyQualifiedSkills, [FAILING]);
      w.qualify(MIX);
      const mixId = w.packageId(MIX);
      assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM skill_benchmark_runs WHERE package_id = ?', mixId)?.n, 20);
      assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM skill_versions')?.n, Number(before.versions) + 1, 'one new version (the failed Skill); none for a reused one');
      assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM skill_security_reviews')?.n, Number(before.reviews) + 1, 'no static re-review of an unchanged reused version');
      assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM work_items')?.n, Number(before.items) + 20, 'Work Items only for the new version');
      assert.equal(db.get<{ s: number }>('SELECT COALESCE(SUM(economic_micros), 0) AS s FROM usage_records')?.s, before.spent, 'registering the reuse spent nothing');
      const v4View = w.store.view(V4);
      const mixView = w.store.view(MIX);
      for (const code of reuse) {
        const a = v4View.skills.find((s) => s.code === code);
        const b = mixView.skills.find((s) => s.code === code);
        assert.ok(a && b);
        assert.deepEqual([b.binding, b.skillId, b.skillVersionId, b.bindingValid], ['REUSE_QUALIFIED', a.skillId, a.skillVersionId, true], `${code}: the same Skill and the same version`);
        assert.equal(b.qualification.sourcePackage?.id, w.packageId(V4), `${code}: the owner stays v4`);
        assert.equal(b.runs.length, 0, `${code}: no run of its own`);
        assert.equal(b.pipelineState, 'COMPARED', `${code}: qualified evidence (COMPARED), not production approval`);
        const row = db.get<{ source_package_id: string; qualification_fingerprint: string; evidence_sha256: string }>('SELECT * FROM academy_package_skill_reuses WHERE package_id = ? AND skill_code = ?', mixId, code);
        assert.deepEqual([row?.source_package_id, row?.qualification_fingerprint, row?.evidence_sha256], [w.packageId(V4), skillQualificationFingerprint(V4, code), a.qualification.evidenceSha256]);
      }
      const fresh = mixView.skills.find((s) => s.code === FAILING);
      assert.ok(fresh);
      assert.equal(fresh.binding, 'QUALIFY_NEW');
      assert.equal(SkillStore.for(w.h.store).version(fresh.skillVersionId).previousVersionId, v4View.skills.find((s) => s.code === FAILING)?.skillVersionId, 'the new version chains from the failed pkg4 version');
      assert.equal(JSON.stringify(db.all('SELECT * FROM skill_benchmark_runs WHERE package_id = ? ORDER BY id', w.packageId(V4))), v4Rows, 'v4 evidence is untouched');

      // The complete role installs only once the new version qualified too.
      assert.throws(() => w.preview('ACADEMY_PACKAGE_INSTALL', MIX), reason('BENCHMARK_RUNNING'), 'the new version has not qualified yet');
      w.answerAll(MIX);
      w.qualify(MIX);
      assert.equal(w.store.view(MIX).installable, true);
      w.confirm('ACADEMY_PACKAGE_INSTALL', MIX);
      const bp = SkillStore.for(w.h.store).blueprint(V4.roleRef);
      assert.ok(bp);
      assert.equal(bp.entries.length, 6, 'the complete six-Skill blueprint');
      assert.deepEqual(new Set(bp.entries.map((e) => e.skillId)), new Set(w.store.view(MIX).skills.map((s) => s.skillId)));
      const prog = db.get<{ d: string }>('SELECT v.definition_json AS d FROM academy_program_versions v JOIN academy_packages p ON p.program_version_id = v.id WHERE p.id = ?', mixId);
      assert.equal((JSON.parse(String(prog?.d)) as { skillTargets: unknown[] }).skillTargets.length, V4.program.skillTargets.length, 'the complete program');
      assert.ok(w.store.view(MIX).skills.every((s) => s.pipelineState === 'APPROVED'), 'only the complete install approves (reused and new alike)');
      // Ownership one-to-one, consumption many-to-one: a second consumer binds the same versions; each still has one owner.
      w.qualify(MIX2);
      for (const code of reuse) {
        const v = versionOf(w, MIX2, code);
        assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_package_skills WHERE skill_version_id = ?', v)?.n, 1, `${code}: one qualification owner`);
        assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_package_skill_reuses WHERE skill_version_id = ?', v)?.n, 2, `${code}: two consumers`);
      }
    });
  });

  test('reuse fails closed: a failed version, changed instructions, changed cases or expectations, another pass mark, BQM-1 evidence, incomplete / VOID / unclassified evidence, a held, retired or corrupt version', () => {
    const reuse = V4.skills.filter((s) => s.code !== FAILING).map((s) => s.code);
    const one = reuse[0] as string;
    const FAILED = later(5, [FAILING]);
    const INSTR = later(6, [one], (p) => ({ ...p, skills: p.skills.map((s) => (s.code === one ? { ...s, instructions: `${s.instructions}\nOne more line.` } : s)) }));
    const CASES = later(7, [one], (p) => ({ ...p, skills: p.skills.map((s) => (s.code === one ? { ...s, benchmark: s.benchmark.map((b, i) => (i === 0 ? { ...b, content: `${b.content} (revised)` } : b)) } : s)) }));
    const EXPECT = later(8, [one], (p) => ({ ...p, skills: p.skills.map((s) => (s.code === one ? { ...s, benchmark: s.benchmark.map((b, i) => (i === 0 ? { ...b, expect: { ...b.expect, critical: [...(b.expect.critical ?? [])].slice(0, 1) } } : b)) } : s)) }));
    const PASS = later(9, [one], (p) => ({ ...p, limits: { ...p.limits, benchmarkPassPct: 80 } }));
    const OK = later(10, [one]);
    withWorld([V4, FAILED, INSTR, CASES, EXPECT, PASS, OK], (w) => {
      w.qualify(V4);
      // One observation of `one` ends in an infrastructure failure: after finalization it is VOID — the evidence is incomplete.
      let infra = false;
      w.answerAll(V4, (skill, _c, arm) => {
        if (skill === one && arm === 'BASELINE' && !infra) {
          infra = true;
          return 'INFRA';
        }
        return skill === FAILING && arm === 'WITH_SKILL' ? 'WRONG' : 'TRUE';
      });
      w.qualify(V4); // finalize: one VOID, re-run in its own slot
      assert.equal(w.store.view(V4).skills.find((s) => s.code === one)?.qualification.reason, 'EVIDENCE_INCOMPLETE', 'a VOID slot is not evidence');
      assert.throws(() => w.preview('SKILL_PACKAGE_QUALIFY', OK), reason('REUSE_NOT_QUALIFIED'));
      w.answerAll(V4);
      w.qualify(V4);
      assert.equal(w.store.view(V4).skills.find((s) => s.code === one)?.qualification.status, 'QUALIFIED', 'the replaced slot completes the evidence');

      assert.throws(() => w.preview('SKILL_PACKAGE_QUALIFY', FAILED), reason('REUSE_NOT_QUALIFIED'), 'a failed version is never reused');
      assert.throws(() => w.preview('SKILL_PACKAGE_QUALIFY', INSTR), reason('REUSE_PAYLOAD_MISMATCH'), 'changed instructions cannot reuse the old evidence');
      assert.throws(() => w.preview('SKILL_PACKAGE_QUALIFY', CASES), reason('REUSE_FINGERPRINT_MISMATCH'), 'changed case content');
      assert.throws(() => w.preview('SKILL_PACKAGE_QUALIFY', EXPECT), reason('REUSE_FINGERPRINT_MISMATCH'), 'changed expectations');
      assert.throws(() => w.preview('SKILL_PACKAGE_QUALIFY', PASS), reason('REUSE_FINGERPRINT_MISMATCH'), 'another pass mark');

      // Held / retired / corrupt versions are not reusable (the governed freshness acts; corruption as the integrity check records it).
      const skills = SkillStore.for(w.h.store);
      const v = versionOf(w, V4, one);
      skills.setFreshness(w.s.founder, v, 'SECURITY_HOLD', 'security.hold');
      assert.equal(w.store.qualificationOf(v).reason, 'FRESHNESS_SECURITY_HOLD');
      assert.throws(() => w.preview('SKILL_PACKAGE_QUALIFY', OK), reason('REUSE_NOT_QUALIFIED'));
      skills.setFreshness(w.s.founder, v, 'CURRENT', 'security.cleared');
      assert.equal(w.store.qualificationOf(v).status, 'QUALIFIED');
      const v2 = versionOf(w, V4, reuse[1] as string);
      skills.setFreshness(w.s.founder, v2, 'RETIRED', 'skill.retired');
      assert.equal(w.store.qualificationOf(v2).reason, 'FRESHNESS_RETIRED');
      const v3 = versionOf(w, V4, reuse[2] as string);
      storeContext(w.h.store).db.run(`UPDATE skill_versions SET integrity = 'CORRUPT', version = version + 1 WHERE id = ?`, v3);
      assert.equal(w.store.qualificationOf(v3).reason, 'INTEGRITY_FAILED');
      assert.equal(w.qualify(OK).benchmarkRuns, 100, 'a valid reuse of one Skill still works: the other five qualify anew');
      // A complete role with a failed newly qualified Skill never installs (no partial role).
      w.answerAll(OK, (skill, _c, arm) => (skill === FAILING && arm === 'WITH_SKILL' ? 'WRONG' : 'TRUE'));
      w.qualify(OK);
      assert.equal(w.store.view(OK).installable, false);
      assert.throws(() => w.preview('ACADEMY_PACKAGE_INSTALL', OK), reason('PACKAGE_SKILLS_NOT_QUALIFIED'));
    });
  });

  test('BQM-1 evidence and unclassified no-answers are never reusable; evidence is never moved between versions; the binding is append-only and names the one owner', () => {
    const BQM1: AcademyPackage = { ...V4, version: 1, title: 'Synthetic BQM-1 owner (test only)', skills: V4.skills.map((s) => ({ ...s, versionLabel: '1.0.0+b1' })) };
    delete (BQM1 as { benchmarkMethod?: unknown }).benchmarkMethod;
    const OWNER: AcademyPackage = { ...V4, version: 2, skills: V4.skills.map((s) => ({ ...s, versionLabel: '1.0.0+o2' })) };
    const FROM_BQM1 = later(3, [V4.skills[0]?.code as string], (p) => ({ ...p, skills: p.skills.map((s, i) => (i === 0 ? { ...s, versionLabel: '1.0.0+b1' } : s)) }));
    withWorld([BQM1, OWNER, FROM_BQM1], (w) => {
      const db = storeContext(w.h.store).db;
      w.qualify(BQM1);
      w.answerAll(BQM1);
      w.qualify(BQM1);
      assert.ok(w.store.view(BQM1).skills.every((s) => s.qualification.reason === 'METHOD_NOT_REUSABLE'), 'BQM-1 evidence is never reusable');
      assert.throws(() => w.preview('SKILL_PACKAGE_QUALIFY', FROM_BQM1), reason('REUSE_NOT_QUALIFIED'));
      // An unclassified no-answer (a completion without an answer) stays OPEN: the evidence is incomplete, never reusable.
      w.qualify(OWNER);
      let silent = false;
      w.answerAll(OWNER, (skill, _c, arm) => {
        if (skill === V4.skills[0]?.code && arm === 'WITH_SKILL' && !silent) {
          silent = true;
          return 'SILENT';
        }
        return 'TRUE';
      });
      assert.equal(w.store.view(OWNER).skills.find((s) => s.code === V4.skills[0]?.code)?.qualification.reason, 'EVIDENCE_INCOMPLETE');
      // Evidence cannot be moved to another version (decide-once), and a binding must name the one BQM-2 owner.
      const row = db.get<{ id: string }>('SELECT id FROM skill_benchmark_runs WHERE package_id = ? LIMIT 1', w.packageId(OWNER));
      assert.ok(row);
      const other = versionOf(w, OWNER, V4.skills[1]?.code as string);
      assert.throws(() => db.run('UPDATE skill_benchmark_runs SET skill_version_id = ? WHERE id = ?', other, row.id), rejected(/scored or voided exactly once/));
      const owned = db.get<{ skill_code: string; skill_id: string; skill_version_id: string }>('SELECT * FROM academy_package_skills WHERE package_id = ? LIMIT 1', w.packageId(OWNER));
      assert.ok(owned);
      const at = '2026-10-06T00:00:00.000Z';
      assert.throws(() => db.run('INSERT INTO academy_package_skills (package_id, skill_code, skill_id, skill_version_id) VALUES (?, ?, ?, ?)', w.packageId(BQM1), 'ceo.other-code', owned.skill_id, owned.skill_version_id), rejected(/UNIQUE/), 'one qualification owner per version');
      assert.throws(() => db.run('INSERT INTO academy_package_skill_reuses (package_id, skill_code, skill_id, skill_version_id, source_package_id, qualification_fingerprint, evidence_sha256, bound_by_ref, bound_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', w.packageId(BQM1), owned.skill_code, owned.skill_id, owned.skill_version_id, w.packageId(BQM1), 'a'.repeat(64), 'b'.repeat(64), w.s.founder, at), rejected(/.+/), 'a binding never names a non-owner (or itself) as the source');
      const fakeId = newId();
      assert.throws(() => db.run('INSERT INTO academy_package_skill_reuses (package_id, skill_code, skill_id, skill_version_id, source_package_id, qualification_fingerprint, evidence_sha256, bound_by_ref, bound_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', fakeId, owned.skill_code, owned.skill_id, owned.skill_version_id, w.packageId(OWNER), 'a'.repeat(64), 'b'.repeat(64), w.s.founder, at), rejected(/.+/));
      assert.throws(() => db.run('INSERT INTO academy_package_skill_reuses (package_id, skill_code, skill_id, skill_version_id, source_package_id, qualification_fingerprint, evidence_sha256, bound_by_ref, bound_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', w.packageId(OWNER), owned.skill_code, owned.skill_id, owned.skill_version_id, w.packageId(BQM1), 'a'.repeat(64), 'b'.repeat(64), w.s.founder, at), rejected(/.+/), 'a package never consumes a Skill it owns');
    });
  });
  test('migration 0019: a released v18 Company upgrades to v19; every existing package row and migration 0001–0018 is unchanged; the reuse relation starts empty', () => {
    const root = tempRoot('l1-02-v18');
    try {
      const v18 = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(18) });
      const s = seed(v18);
      const e = hire(s.gov, s.founder, s.departmentId, false, 'role:company.ceo');
      const d18 = storeContext(v18).db;
      const pid = newId();
      d18.run("INSERT INTO academy_packages (id, code, package_version, package_sha256, role_ref, subject_employee_id, state, qualified_by_ref, created_at, benchmark_method, method_sha256, answer_contract_version, answer_contract_sha256) VALUES (?, 'ceo.company-ceo', 4, ?, 'role:company.ceo', ?, 'QUALIFYING', ?, '2026-10-06T00:00:00.000Z', 'BQM-2', ?, 'AC-4', ?)", pid, '5'.repeat(64), e.id, s.founder, '6'.repeat(64), '7'.repeat(64));
      const pkgBefore = JSON.stringify(d18.get('SELECT * FROM academy_packages WHERE id = ?', pid));
      const migBefore = JSON.stringify(d18.all('SELECT version, name, sha256, applied_at FROM schema_migrations ORDER BY version'));
      v18.close();
      const v19 = openStoreForTests(root, { clock: new ManualClock(), liveSchemaUpdate: true, migrations: loadReleasedMigrations(19) });
      try {
        assert.deepEqual(v19.migration.applied, [19]);
        const d = storeContext(v19).db;
        assert.equal(JSON.stringify(d.get('SELECT * FROM academy_packages WHERE id = ?', pid)), pkgBefore, 'a package row is untouched');
        assert.equal(JSON.stringify(d.all('SELECT version, name, sha256, applied_at FROM schema_migrations WHERE version <= 18 ORDER BY version')), migBefore, '0001–0018 unchanged');
        assert.equal(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_package_skill_reuses')?.n, 0);
        assert.deepEqual(d.all('PRAGMA foreign_key_check'), []);
        assert.equal(v19.quickCheck(), 'ok');
      } finally {
        v19.close();
      }
    } finally {
      removeRoot(root);
    }
  });
});

// --- D-L1-28: the production package v5 consumes the three qualified v4 Skill Versions --------------------------------
// L1-02-PROOF: package-v5-store

describe('D-L1-28: production package v5 reuses the three v4 Skill Versions that qualified and qualifies three new pkg5 versions (60 observations)', () => {
  test('after the v4-shaped failure, v5 binds the exact v4 versions (no version, review, Work Item or spend), creates 3 pkg5 versions chained from pkg4 with 3 static reviews and exactly 60 Work Items, and installs the complete six-Skill role; v4 stays QUALIFYING and unchanged', () => {
    const V5 = CEO_ACADEMY_PACKAGE_V5;
    const NEW = V5.skills.filter((s) => s.binding === undefined).map((s) => s.code);
    withWorld([V5, V4], (w) => {
      const db = storeContext(w.h.store).db;
      const count = (sql: string, ...a: string[]): number => Number(db.get<{ n: number }>(sql, ...a)?.n);
      w.qualify(V4);
      // The live v4 outcome: the with-Skill arm of the three Skills v5 revises fails; the other three qualify.
      w.answerAll(V4, (skill, _c, arm) => (NEW.includes(skill) && arm === 'WITH_SKILL' ? 'WRONG' : 'TRUE'));
      w.qualify(V4);
      const v4 = w.store.view(V4);
      assert.deepEqual(v4.skills.filter((s) => s.qualification.status === 'QUALIFIED').map((s) => s.code).sort(), [...CEO_V5_REUSED_SKILLS].sort());
      const v4Before = JSON.stringify({ rec: db.get('SELECT * FROM academy_packages WHERE id = ?', w.packageId(V4)), runs: db.all('SELECT * FROM skill_benchmark_runs WHERE package_id = ? ORDER BY id', w.packageId(V4)), skills: db.all('SELECT * FROM academy_package_skills WHERE package_id = ? ORDER BY skill_code', w.packageId(V4)) });
      const before = { versions: count('SELECT COUNT(*) AS n FROM skill_versions'), reviews: count('SELECT COUNT(*) AS n FROM skill_security_reviews'), items: count('SELECT COUNT(*) AS n FROM work_items'), spent: count('SELECT COALESCE(SUM(economic_micros), 0) AS n FROM usage_records') };

      const p = w.preview('SKILL_PACKAGE_QUALIFY', V5);
      assert.deepEqual([p.qualification, p.benchmarkMethod, p.rubricVersion, p.answerContractVersion, p.reasoningClass, p.observationsPerArm, p.maxModelCallsPerObservation, p.benchmarkRuns, p.newlyQualifiedSkills], ['QUALIFY', 'BQM-2', 'R2', 'AC-4', 'E1', 5, 2, 60, NEW]);
      assert.equal((p.reusedSkills as string[]).length, 3);
      w.qualify(V5);
      const v5Id = w.packageId(V5);
      assert.equal(count('SELECT COUNT(*) AS n FROM skill_benchmark_runs WHERE package_id = ?', v5Id), 60, '3 × 2 × 2 × 5');
      assert.equal(count('SELECT COUNT(*) AS n FROM work_items'), before.items + 60, 'exactly 60 benchmark Work Items');
      assert.equal(count('SELECT COUNT(*) AS n FROM skill_versions'), before.versions + 3, 'three pkg5 versions; none for a reused Skill');
      assert.equal(count('SELECT COUNT(*) AS n FROM skill_security_reviews'), before.reviews + 3, 'a static review for each new version only');
      assert.equal(count('SELECT COALESCE(SUM(economic_micros), 0) AS n FROM usage_records'), before.spent, 'binding the reuses spent nothing');
      const v5 = w.store.view(V5);
      for (const code of CEO_V5_REUSED_SKILLS) {
        const a = v4.skills.find((s) => s.code === code);
        const b = v5.skills.find((s) => s.code === code);
        assert.ok(a && b);
        assert.deepEqual([b.binding, b.skillId, b.skillVersionId, b.bindingValid, b.runs.length, b.qualification.sourcePackage?.id], ['REUSE_QUALIFIED', a.skillId, a.skillVersionId, true, 0, w.packageId(V4)], `${code}: the exact v4 version`);
        assert.equal(SkillStore.for(w.h.store).version(b.skillVersionId).versionLabel, '1.0.0+pkg4');
      }
      for (const code of NEW) {
        const b = v5.skills.find((s) => s.code === code);
        assert.ok(b);
        const ver = SkillStore.for(w.h.store).version(b.skillVersionId);
        assert.deepEqual([b.binding, ver.versionLabel, ver.previousVersionId, b.security?.passed, b.runs.length], ['QUALIFY_NEW', '1.0.0+pkg5', v4.skills.find((s) => s.code === code)?.skillVersionId, true, 20], `${code}: a new reviewed pkg5 version chained from pkg4`);
      }

      w.answerAll(V5);
      w.qualify(V5);
      assert.equal(w.store.view(V5).installable, true);
      w.confirm('ACADEMY_PACKAGE_INSTALL', V5);
      const bp = SkillStore.for(w.h.store).blueprint(V5.roleRef);
      assert.equal(bp?.entries.length, 6, 'the complete six-Skill blueprint');
      const prog = db.get<{ d: string }>('SELECT v.definition_json AS d FROM academy_program_versions v JOIN academy_packages p ON p.program_version_id = v.id WHERE p.id = ?', v5Id);
      const def = JSON.parse(String(prog?.d)) as { skillTargets: { skillId: string }[]; curriculum: unknown[] };
      assert.deepEqual(new Set(def.skillTargets.map((t) => t.skillId)), new Set(w.store.view(V5).skills.map((s) => s.skillId)), 'six Skill targets');
      assert.equal(def.curriculum.length, V4.program.curriculum.length, 'the complete CEO Academy program');
      assert.ok(w.store.view(V5).skills.every((s) => s.pipelineState === 'APPROVED'));
      assert.equal(w.store.view(V4).record?.state, 'QUALIFYING', 'v4 stays QUALIFYING, never installed');
      assert.equal(JSON.stringify({ rec: db.get('SELECT * FROM academy_packages WHERE id = ?', w.packageId(V4)), runs: db.all('SELECT * FROM skill_benchmark_runs WHERE package_id = ? ORDER BY id', w.packageId(V4)), skills: db.all('SELECT * FROM academy_package_skills WHERE package_id = ? ORDER BY skill_code', w.packageId(V4)) }), v4Before, 'v4 history is unchanged');
      assert.deepEqual(loadReleasedMigrations().filter((m) => m.version > 19).map((m) => m.name), ['l1_02_employee_reasoning_control', 'l1_02_academy_founder_feedback'], 'migration 0019 is sufficient for packages: the only later migrations are D-L1-44 reasoning control and D-L1-39 Founder feedback');
    });
  });
});

// --- D-L1-31: the production package v6 consumes five qualified Skill Versions from two owner packages ------------------
// L1-02-PROOF: package-v6-store

describe('D-L1-31: production package v6 reuses five qualified Skill Versions (three owned by v4, two by v5) and qualifies one new pkg6 version (20 observations)', () => {
  test('after the v4- and v5-shaped outcomes, v6 binds the exact qualified versions of both owners (no version, review, Work Item or spend), creates one pkg6 governance version chained from pkg5 with one static review and exactly 20 Work Items, and installs the complete six-Skill role; v4 and v5 stay QUALIFYING and unchanged', () => {
    const V5 = CEO_ACADEMY_PACKAGE_V5;
    const V6 = CEO_ACADEMY_PACKAGE_V6;
    const V5_NEW = V5.skills.filter((s) => s.binding === undefined).map((s) => s.code);
    withWorld([V6, V5, V4], (w) => {
      const db = storeContext(w.h.store).db;
      const count = (sql: string, ...a: string[]): number => Number(db.get<{ n: number }>(sql, ...a)?.n);
      const history = (p: AcademyPackage): string => JSON.stringify({ rec: db.get('SELECT * FROM academy_packages WHERE id = ?', w.packageId(p)), runs: db.all('SELECT * FROM skill_benchmark_runs WHERE package_id = ? ORDER BY id', w.packageId(p)), owned: db.all('SELECT * FROM academy_package_skills WHERE package_id = ? ORDER BY skill_code', w.packageId(p)), reused: db.all('SELECT * FROM academy_package_skill_reuses WHERE package_id = ? ORDER BY skill_code', w.packageId(p)) });
      // The live history: v4 fails the three Skills v5 revises; v5 fails governance-discipline only.
      w.qualify(V4);
      w.answerAll(V4, (skill, _c, arm) => (V5_NEW.includes(skill) && arm === 'WITH_SKILL' ? 'WRONG' : 'TRUE'));
      w.qualify(V4);
      w.qualify(V5);
      w.answerAll(V5, (skill, _c, arm) => (skill === CEO_V6_REVISED_SKILL && arm === 'WITH_SKILL' ? 'WRONG' : 'TRUE'));
      w.qualify(V5);
      const v4 = w.store.view(V4);
      const v5 = w.store.view(V5);
      const owner = (code: string): AcademyPackage => (V5_NEW.includes(code) ? V5 : V4);
      for (const code of CEO_V6_REUSED_SKILLS) {
        const s = (owner(code) === V5 ? v5 : v4).skills.find((x) => x.code === code);
        assert.equal(s?.qualification.status, 'QUALIFIED', `${code}: qualified in v${owner(code).version}`);
      }
      assert.equal(v5.skills.find((s) => s.code === CEO_V6_REVISED_SKILL)?.qualification.reason, 'QUALIFICATION_FAILED');
      const before = { v4: history(V4), v5: history(V5), versions: count('SELECT COUNT(*) AS n FROM skill_versions'), reviews: count('SELECT COUNT(*) AS n FROM skill_security_reviews'), items: count('SELECT COUNT(*) AS n FROM work_items'), spent: count('SELECT COALESCE(SUM(economic_micros), 0) AS n FROM usage_records') };

      const p = w.preview('SKILL_PACKAGE_QUALIFY', V6);
      assert.deepEqual([p.qualification, p.benchmarkMethod, p.rubricVersion, p.answerContractVersion, p.reasoningClass, p.observationsPerArm, p.answerOnly, p.maxModelCallsPerObservation, p.benchmarkRuns, p.newlyQualifiedSkills], ['QUALIFY', 'BQM-2', 'R2', 'AC-4', 'E1', 5, true, 2, 20, [CEO_V6_REVISED_SKILL]]);
      assert.equal((p.reusedSkills as string[]).length, 5);
      w.qualify(V6);
      const v6Id = w.packageId(V6);
      assert.equal(count('SELECT COUNT(*) AS n FROM skill_benchmark_runs WHERE package_id = ?', v6Id), 20, '1 × 2 × 2 × 5');
      assert.equal(count('SELECT COUNT(*) AS n FROM work_items'), before.items + 20, 'exactly 20 benchmark Work Items');
      assert.equal(count('SELECT COUNT(*) AS n FROM skill_versions'), before.versions + 1, 'one pkg6 version; none for a reused Skill');
      assert.equal(count('SELECT COUNT(*) AS n FROM skill_security_reviews'), before.reviews + 1, 'one static review, for the new version only');
      assert.equal(count('SELECT COALESCE(SUM(economic_micros), 0) AS n FROM usage_records'), before.spent, 'binding the reuses spent nothing');
      const v6 = w.store.view(V6);
      for (const code of CEO_V6_REUSED_SKILLS) {
        const src = owner(code) === V5 ? v5 : v4;
        const a = src.skills.find((s) => s.code === code);
        const b = v6.skills.find((s) => s.code === code);
        assert.ok(a && b);
        assert.deepEqual([b.binding, b.skillId, b.skillVersionId, b.bindingValid, b.runs.length, b.qualification.sourcePackage?.id, b.qualification.fingerprint], ['REUSE_QUALIFIED', a.skillId, a.skillVersionId, true, 0, w.packageId(owner(code)), skillQualificationFingerprint(owner(code), code)], `${code}: the exact version qualified in v${owner(code).version}`);
        assert.equal(SkillStore.for(w.h.store).version(b.skillVersionId).versionLabel, owner(code) === V5 ? '1.0.0+pkg5' : '1.0.0+pkg4');
      }
      const g = v6.skills.find((s) => s.code === CEO_V6_REVISED_SKILL);
      assert.ok(g);
      const gv = SkillStore.for(w.h.store).version(g.skillVersionId);
      assert.deepEqual([g.binding, gv.versionLabel, gv.previousVersionId, g.security?.passed, g.runs.length], ['QUALIFY_NEW', '1.0.0+pkg6', v5.skills.find((s) => s.code === CEO_V6_REVISED_SKILL)?.skillVersionId, true, 20], 'a new reviewed pkg6 version chained from the failed pkg5 version');

      w.answerAll(V6);
      w.qualify(V6);
      assert.equal(w.store.view(V6).installable, true);
      w.confirm('ACADEMY_PACKAGE_INSTALL', V6);
      assert.equal(SkillStore.for(w.h.store).blueprint(V6.roleRef)?.entries.length, 6, 'the complete six-Skill blueprint');
      const prog = db.get<{ d: string }>('SELECT v.definition_json AS d FROM academy_program_versions v JOIN academy_packages p ON p.program_version_id = v.id WHERE p.id = ?', v6Id);
      const def = JSON.parse(String(prog?.d)) as { skillTargets: { skillId: string }[]; curriculum: unknown[] };
      assert.deepEqual(new Set(def.skillTargets.map((t) => t.skillId)), new Set(w.store.view(V6).skills.map((s) => s.skillId)), 'six Skill targets');
      assert.equal(def.skillTargets.length, 6);
      assert.equal(def.curriculum.length, V4.program.curriculum.length, 'the complete CEO Academy program');
      assert.ok(w.store.view(V6).skills.every((s) => s.pipelineState === 'APPROVED'));
      assert.deepEqual([w.store.view(V4).record?.state, w.store.view(V5).record?.state], ['QUALIFYING', 'QUALIFYING'], 'v4 and v5 are never installed');
      assert.deepEqual([history(V4), history(V5)], [before.v4, before.v5], 'v4 and v5 history is unchanged');
      assert.deepEqual(loadReleasedMigrations().filter((m) => m.version > 19).map((m) => m.name), ['l1_02_employee_reasoning_control', 'l1_02_academy_founder_feedback'], 'migration 0019 is sufficient for packages: the only later migrations are D-L1-44 reasoning control and D-L1-39 Founder feedback');
    });
  });
});

// --- D-L1-35A: the production package v7 consumes the same five qualified Skill Versions; governance pkg7 chains from pkg6 --
// L1-02-PROOF: package-v7-store

describe('D-L1-35A: production package v7 reuses the same five qualified Skill Versions and qualifies one new pkg7 governance version (20 observations)', () => {
  test('after the v4-, v5- and v6-shaped outcomes, v7 binds the exact qualified versions of both owners (no version, review, Work Item or spend), creates one pkg7 governance version chained from pkg6 with one static review and exactly 20 Work Items, and installs the complete six-Skill role; v4, v5 and v6 stay QUALIFYING and unchanged', () => {
    const V5 = CEO_ACADEMY_PACKAGE_V5;
    const V6 = CEO_ACADEMY_PACKAGE_V6;
    const V7 = CEO_ACADEMY_PACKAGE_V7;
    const V5_NEW = V5.skills.filter((s) => s.binding === undefined).map((s) => s.code);
    withWorld([V7, V6, V5, V4], (w) => {
      const db = storeContext(w.h.store).db;
      const count = (sql: string, ...a: string[]): number => Number(db.get<{ n: number }>(sql, ...a)?.n);
      const history = (p: AcademyPackage): string => JSON.stringify({ rec: db.get('SELECT * FROM academy_packages WHERE id = ?', w.packageId(p)), runs: db.all('SELECT * FROM skill_benchmark_runs WHERE package_id = ? ORDER BY id', w.packageId(p)), owned: db.all('SELECT * FROM academy_package_skills WHERE package_id = ? ORDER BY skill_code', w.packageId(p)), reused: db.all('SELECT * FROM academy_package_skill_reuses WHERE package_id = ? ORDER BY skill_code', w.packageId(p)) });
      // The live history: v4 fails the three Skills v5 revises; v5 and v6 fail governance-discipline only.
      w.qualify(V4);
      w.answerAll(V4, (skill, _c, arm) => (V5_NEW.includes(skill) && arm === 'WITH_SKILL' ? 'WRONG' : 'TRUE'));
      w.qualify(V4);
      w.qualify(V5);
      w.answerAll(V5, (skill, _c, arm) => (skill === CEO_V6_REVISED_SKILL && arm === 'WITH_SKILL' ? 'WRONG' : 'TRUE'));
      w.qualify(V5);
      w.qualify(V6);
      w.answerAll(V6, (skill, _c, arm) => (skill === CEO_V7_REVISED_SKILL && arm === 'WITH_SKILL' ? 'WRONG' : 'TRUE'));
      w.qualify(V6);
      const v4 = w.store.view(V4);
      const v5 = w.store.view(V5);
      const v6 = w.store.view(V6);
      const owner = (code: string): AcademyPackage => (V5_NEW.includes(code) ? V5 : V4);
      for (const code of CEO_V7_REUSED_SKILLS) {
        const s = (owner(code) === V5 ? v5 : v4).skills.find((x) => x.code === code);
        assert.equal(s?.qualification.status, 'QUALIFIED', `${code}: qualified in v${owner(code).version}`);
      }
      assert.equal(v6.skills.find((s) => s.code === CEO_V7_REVISED_SKILL)?.qualification.reason, 'QUALIFICATION_FAILED');
      const before = { v4: history(V4), v5: history(V5), v6: history(V6), versions: count('SELECT COUNT(*) AS n FROM skill_versions'), reviews: count('SELECT COUNT(*) AS n FROM skill_security_reviews'), items: count('SELECT COUNT(*) AS n FROM work_items'), spent: count('SELECT COALESCE(SUM(economic_micros), 0) AS n FROM usage_records') };

      const p = w.preview('SKILL_PACKAGE_QUALIFY', V7);
      assert.deepEqual([p.qualification, p.benchmarkMethod, p.rubricVersion, p.answerContractVersion, p.reasoningClass, p.observationsPerArm, p.answerOnly, p.maxModelCallsPerObservation, p.benchmarkRuns, p.newlyQualifiedSkills], ['QUALIFY', 'BQM-2', 'R2', 'AC-4', 'E1', 5, true, 2, 20, [CEO_V7_REVISED_SKILL]]);
      assert.equal((p.reusedSkills as string[]).length, 5);
      w.qualify(V7);
      const v7Id = w.packageId(V7);
      assert.equal(count('SELECT COUNT(*) AS n FROM skill_benchmark_runs WHERE package_id = ?', v7Id), 20, '1 × 2 × 2 × 5');
      assert.equal(count('SELECT COUNT(*) AS n FROM work_items'), before.items + 20, 'exactly 20 benchmark Work Items');
      assert.equal(count('SELECT COUNT(*) AS n FROM skill_versions'), before.versions + 1, 'one pkg7 version; none for a reused Skill');
      assert.equal(count('SELECT COUNT(*) AS n FROM skill_security_reviews'), before.reviews + 1, 'one static review, for the new version only');
      assert.equal(count('SELECT COALESCE(SUM(economic_micros), 0) AS n FROM usage_records'), before.spent, 'binding the reuses spent nothing');
      const v7 = w.store.view(V7);
      for (const code of CEO_V7_REUSED_SKILLS) {
        const src = owner(code) === V5 ? v5 : v4;
        const a = src.skills.find((s) => s.code === code);
        const b = v7.skills.find((s) => s.code === code);
        assert.ok(a && b);
        assert.deepEqual([b.binding, b.skillId, b.skillVersionId, b.bindingValid, b.runs.length, b.qualification.sourcePackage?.id, b.qualification.fingerprint], ['REUSE_QUALIFIED', a.skillId, a.skillVersionId, true, 0, w.packageId(owner(code)), skillQualificationFingerprint(owner(code), code)], `${code}: the exact version qualified in v${owner(code).version}`);
        assert.equal(SkillStore.for(w.h.store).version(b.skillVersionId).versionLabel, owner(code) === V5 ? '1.0.0+pkg5' : '1.0.0+pkg4');
      }
      const g = v7.skills.find((s) => s.code === CEO_V7_REVISED_SKILL);
      assert.ok(g);
      const gv = SkillStore.for(w.h.store).version(g.skillVersionId);
      assert.deepEqual([g.binding, gv.versionLabel, gv.previousVersionId, g.security?.passed, g.runs.length], ['QUALIFY_NEW', '1.0.0+pkg7', v6.skills.find((s) => s.code === CEO_V7_REVISED_SKILL)?.skillVersionId, true, 20], 'a new reviewed pkg7 version chained from the failed pkg6 version');

      w.answerAll(V7);
      w.qualify(V7);
      assert.equal(w.store.view(V7).installable, true);
      w.confirm('ACADEMY_PACKAGE_INSTALL', V7);
      assert.equal(SkillStore.for(w.h.store).blueprint(V7.roleRef)?.entries.length, 6, 'the complete six-Skill blueprint');
      const prog = db.get<{ d: string }>('SELECT v.definition_json AS d FROM academy_program_versions v JOIN academy_packages p ON p.program_version_id = v.id WHERE p.id = ?', v7Id);
      const def = JSON.parse(String(prog?.d)) as { skillTargets: { skillId: string }[]; curriculum: unknown[] };
      assert.deepEqual(new Set(def.skillTargets.map((t) => t.skillId)), new Set(w.store.view(V7).skills.map((s) => s.skillId)), 'six Skill targets');
      assert.equal(def.skillTargets.length, 6);
      assert.equal(def.curriculum.length, V4.program.curriculum.length, 'the complete CEO Academy program');
      assert.ok(w.store.view(V7).skills.every((s) => s.pipelineState === 'APPROVED'));
      assert.deepEqual([w.store.view(V4).record?.state, w.store.view(V5).record?.state, w.store.view(V6).record?.state], ['QUALIFYING', 'QUALIFYING', 'QUALIFYING'], 'v4, v5 and v6 are never installed');
      assert.deepEqual([history(V4), history(V5), history(V6)], [before.v4, before.v5, before.v6], 'v4, v5 and v6 history is unchanged');
      assert.deepEqual(loadReleasedMigrations().filter((m) => m.version > 19).map((m) => m.name), ['l1_02_employee_reasoning_control', 'l1_02_academy_founder_feedback'], 'migration 0019 is sufficient for packages: the only later migrations are D-L1-44 reasoning control and D-L1-39 Founder feedback');
    });
  });
});
