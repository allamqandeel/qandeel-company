/**
 * L1-02 / D-L1-23 — Benchmark Qualification Method v2 at the store boundary (migration 0018).
 *
 * A BQM-2 package pins its method declaration and its ANSWER contract in its own definition; the store records the pins
 * on the package row, creates every observation up front (k = 5 per case and arm, each pinned to E1 with the same-class
 * retry policy), refuses any qualification and any observation's context whenever the running build's method or contract
 * differs from the pins (an in-flight package is never run under a method it did not pin), scores each row by ITS
 * rubric, keeps a FAILED (two invalid outputs) observation distinct from an infrastructure VOID, replaces a VOID only in
 * its own observation slot, and decides every row exactly once. BQM-1 rows are described truthfully by the 0018 defaults.
 * L1-02-PROOF: bqm2-store
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ManualClock, isQandeelError, newId, type Id } from '@qandeel-company/domain';
import { ANSWER_CONTRACT_SHA256, ANSWER_CONTRACT_TEXT, ANSWER_CONTRACT_VERSION } from '@qandeel-company/governance';
import { BQM2_DECLARATION_SHA256, CEO_ACADEMY_PACKAGE_V3, academyPackageDigest, type AcademyPackage } from '@qandeel-company/mind';

import { FounderActionStore, FounderAuthStore, loadReleasedMigrations } from '../src/index.js';
import { settle } from '../src/runtime-authority.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { hire, seed, type Seed } from './c2-helpers.js';
import { assemble, claimFor } from './c3-helpers.js';
import { backoff, harness, removeRoot, tempRoot, type Harness } from './helpers.js';

/** A datastore refusal (trigger / constraint): the store wraps it as STORAGE_INVARIANT with the database message as cause. */
const rejected = (re: RegExp) => (e: unknown): boolean => isQandeelError(e, 'STORAGE_INVARIANT') && re.test(String((e as Error).cause));
const reason = (r: string) => (e: unknown): boolean => isQandeelError(e) && e.details['reason'] === r;
const pin = { version: 'BQM-2' as const, declarationSha256: BQM2_DECLARATION_SHA256, answerContract: { version: ANSWER_CONTRACT_VERSION, sha256: ANSWER_CONTRACT_SHA256 } };
/** A synthetic BQM-2 fixture (test only): v3's content with BQM-2 pinned. */
const BQ: AcademyPackage = { ...CEO_ACADEMY_PACKAGE_V3, version: 4, title: 'Synthetic BQM-2 fixture (test only)', skills: CEO_ACADEMY_PACKAGE_V3.skills.map((s) => ({ ...s, versionLabel: '1.0.0+bqm2-store' })), benchmarkMethod: pin };
/** A package pinning another ANSWER contract (a definition written for some other build). */
const OTHER: AcademyPackage = { ...BQ, version: 5, skills: BQ.skills.map((s) => ({ ...s, versionLabel: '1.0.0+bqm2-other' })), benchmarkMethod: { ...pin, answerContract: { version: 'AC-3', sha256: 'a'.repeat(64) } } };

interface World {
  readonly h: Harness;
  readonly s: Seed;
  readonly trainee: Id;
  readonly packageId: Id;
  /** The Founder's governed qualify act (preview → exact fingerprint → confirm); returns the preview payload. */
  readonly qualify: (p?: AcademyPackage) => Record<string, unknown>;
  readonly preview: (p?: AcademyPackage) => Record<string, unknown>;
}

function withBqm2(fn: (w: World) => void): void {
  const h = harness();
  try {
    const s = seed(h.store);
    const e = hire(s.gov, s.founder, s.departmentId, false, BQ.roleRef);
    s.gov.transitionEmployee(s.founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    s.gov.createBudget(s.founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 5_000_000, capTokens: 5_000_000, reasonCode: 'seed' });
    s.gov.grant(s.founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D2', reasonCode: 'seed' });
    const auth = FounderAuthStore.for(h.store);
    const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
    const actions = FounderActionStore.for(h.store, auth, { academyPackages: [BQ, OTHER] });
    const args = (p: AcademyPackage) => ({ packageCode: p.code, packageVersion: p.version, packageSha256: academyPackageDigest(p), subjectEmployeeId: e.id });
    const preview = (p: AcademyPackage = BQ): Record<string, unknown> => actions.preview(session, 'SKILL_PACKAGE_QUALIFY', args(p)).payload as Record<string, unknown>;
    const qualify = (p: AcademyPackage = BQ): Record<string, unknown> => {
      const pv = actions.preview(session, 'SKILL_PACKAGE_QUALIFY', args(p));
      actions.confirm(session, pv.id, pv.fingerprint);
      return pv.payload as Record<string, unknown>;
    };
    const first = qualify();
    assert.equal(first.benchmarkRuns, 120);
    const packageId = storeContext(h.store).db.get<{ id: string }>('SELECT id FROM academy_packages WHERE code = ? AND package_version = ?', BQ.code, BQ.version)?.id as Id;
    fn({ h, s, trainee: e.id, packageId, qualify, preview });
  } finally {
    h.close();
  }
}

type Row = { id: string; work_item_id: string; skill_version_id: string; case_code: string; arm: string; observation_no: number; rubric_version: string; state: string; observation_outcome: string | null };
const rows = (w: World): Row[] => storeContext(w.h.store).db.all<Row>('SELECT * FROM skill_benchmark_runs WHERE package_id = ? ORDER BY case_code, arm, observation_no', w.packageId);

describe('D-L1-23: BQM-2 at the store boundary (0018)', () => {
  test('a BQM-2 package records its pins and creates exactly 5 observations per case and arm, every one pinned to E1 with the same-class retry policy', () => {
    withBqm2((w) => {
      const db = storeContext(w.h.store).db;
      const p = db.get('SELECT * FROM academy_packages WHERE id = ?', w.packageId) as Record<string, unknown> | undefined;
      assert.deepEqual([p?.benchmark_method, p?.method_sha256, p?.answer_contract_version, p?.answer_contract_sha256], ['BQM-2', BQM2_DECLARATION_SHA256, ANSWER_CONTRACT_VERSION, ANSWER_CONTRACT_SHA256]);
      const all = rows(w);
      assert.equal(all.length, 120);
      const cells = new Map<string, number[]>();
      for (const r of all) cells.set(`${r.skill_version_id}|${r.case_code}|${r.arm}`, [...(cells.get(`${r.skill_version_id}|${r.case_code}|${r.arm}`) ?? []), r.observation_no]);
      assert.equal(cells.size, 24);
      for (const [cell, ns] of cells) assert.deepEqual(ns, [1, 2, 3, 4, 5], cell);
      for (const r of all) {
        assert.equal(r.rubric_version, 'R2');
        const input = w.h.store.getWorkItem(r.work_item_id as Id).processorInput as Record<string, unknown>;
        assert.deepEqual([input.reasoningClass, input.invalidOutputPolicy], ['E1', 'SAME_CLASS_RETRY'], `${r.case_code} ${r.arm}: the class is fixed in the Work Item itself, both arms alike`);
      }
    });
  });

  test('an in-flight BQM-2 package whose pinned method or ANSWER contract differs from the running build is refused: no context (zero tokens), no new observation; a mismatching new package is never registered', () => {
    withBqm2((w) => {
      const db = storeContext(w.h.store).db;
      const items = rows(w).map((r) => r.work_item_id as Id);
      // Control: under its own pins an observation assembles, carrying the AC-4 contract verbatim.
      const ok = assemble(w.h, claimFor(w.h, items[0] as Id).claim);
      assert.equal(ok.outcome, 'OK');
      assert.ok(ok.outcome === 'OK' && ok.messages.some((m) => m.content.includes(ANSWER_CONTRACT_TEXT)));
      // A later build that runs a different method (the package's pin no longer matches it).
      db.run('DROP TRIGGER academy_packages_forward_only');
      db.run('UPDATE academy_packages SET method_sha256 = ? WHERE id = ?', 'f'.repeat(64), w.packageId);
      const m1 = assemble(w.h, claimFor(w.h, items[1] as Id).claim);
      assert.equal(m1.outcome, 'INTEGRITY_FAILURE', 'the in-flight observation gets no context');
      assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'skill.benchmark_pin_mismatch' AND reason_code = 'BENCHMARK_METHOD_MISMATCH'")?.n, 1);
      assert.throws(() => w.preview(), reason('BENCHMARK_METHOD_MISMATCH'), 'no finalization or re-run under another method');
      // A later build with a different ANSWER contract.
      db.run('UPDATE academy_packages SET method_sha256 = ?, answer_contract_sha256 = ? WHERE id = ?', BQM2_DECLARATION_SHA256, 'e'.repeat(64), w.packageId);
      assert.equal(assemble(w.h, claimFor(w.h, items[2] as Id).claim).outcome, 'INTEGRITY_FAILURE');
      assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'skill.benchmark_pin_mismatch' AND reason_code = 'ANSWER_CONTRACT_MISMATCH'")?.n, 1);
      assert.throws(() => w.preview(), reason('ANSWER_CONTRACT_MISMATCH'));
      assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM budget_reservations')?.n, 0, 'no refused observation reserved anything');
      assert.equal(rows(w).length, 120, 'no observation was created');
      // A new package that pins another contract is refused before anything is written.
      assert.throws(() => w.qualify(OTHER), reason('ANSWER_CONTRACT_MISMATCH'));
      assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_packages WHERE package_version = 5')?.n, 0);
    });
  });

  test('two invalid outputs are a FAILED observation (scored), an infrastructure no-answer is VOID and replaced only in its own slot; a scored observation is decided once and never re-run or duplicated', () => {
    withBqm2((w) => {
      const db = storeContext(w.h.store).db;
      const [x, y] = rows(w).filter((r) => r.case_code === 'talented-but-wasteful' && r.arm === 'WITH_SKILL');
      assert.ok(x && y);
      for (const [r, code] of [[x, 'MODEL_OUTPUT_INVALID'], [y, 'INTEGRITY_FAILURE']] as const) {
        const { claim } = claimFor(w.h, r.work_item_id as Id);
        settle(w.h.store, claim.fence, { type: 'PERMANENT_FAILURE', code }, { backoff });
        assert.equal(w.h.store.getWorkItem(r.work_item_id as Id).state, 'FAILED');
      }
      // Every other observation ends without an answer (no model in a store test): infrastructure-like, so VOID.
      for (const r of rows(w).filter((o) => o.id !== x.id && o.id !== y.id)) settle(w.h.store, claimFor(w.h, r.work_item_id as Id).claim.fence, { type: 'COMPLETED' }, { backoff });
      const out = w.qualify();
      assert.deepEqual([out.qualification, out.scoresToFinalize, out.benchmarkRuns], ['REQUALIFY_VOID_RUNS', 1, 119], 'the preview is truthful: one FAILED observation to finalize, exactly the 119 VOID slots to re-run');
      const after = (id: string) => db.get<Row>('SELECT * FROM skill_benchmark_runs WHERE id = ?', id);
      assert.deepEqual([after(x.id)?.state, after(x.id)?.observation_outcome], ['SCORED', 'INVALID_OUTPUT'], 'model behaviour: a FAILED observation');
      assert.equal(after(y.id)?.state, 'VOID', 'infrastructure: VOID');
      const slot = db.all<Row>('SELECT * FROM skill_benchmark_runs WHERE skill_version_id = ? AND case_code = ? AND arm = ? AND observation_no = ?', y.skill_version_id, y.case_code, y.arm, y.observation_no);
      assert.deepEqual(slot.map((r) => r.state).sort(), ['OPEN', 'VOID'], 'the replacement takes the same observation number');
      assert.equal(db.all<Row>('SELECT * FROM skill_benchmark_runs WHERE skill_version_id = ? AND case_code = ? AND arm = ? AND observation_no = ?', x.skill_version_id, x.case_code, x.arm, x.observation_no).length, 1, 'the FAILED observation is never re-run');
      assert.throws(() => db.run('UPDATE skill_benchmark_runs SET passed = 1 WHERE id = ?', x.id), rejected(/scored or voided exactly once/));
      assert.throws(() => db.run('UPDATE skill_benchmark_runs SET observation_no = 5 WHERE id = ?', slot.find((r) => r.state === 'OPEN')?.id ?? ''), rejected(/scored or voided exactly once/), 'an observation number never changes');
      assert.throws(() => db.run("INSERT INTO skill_benchmark_runs (id, package_id, skill_version_id, case_code, arm, work_item_id, employee_id, state, created_at, observation_no, rubric_version) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, 'R2')", newId(), w.packageId, x.skill_version_id, x.case_code, x.arm, y.work_item_id, w.trainee, '2026-10-06T00:00:00.000Z', x.observation_no), rejected(/UNIQUE/), 'a second live run of a decided observation is impossible');
    });
  });

  test('migration 0018: a released v17 Company upgrades to v18; its package rows are BQM-1 with no pins; 0001–0017 unchanged; a half-pinned BQM-2 row is impossible', () => {
    const root = tempRoot('l1-02-v17');
    try {
      const v17 = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(17) });
      const s = seed(v17);
      const e = hire(s.gov, s.founder, s.departmentId, false, 'role:company.ceo');
      const d17 = storeContext(v17).db;
      const pid = newId();
      d17.run("INSERT INTO academy_packages (id, code, package_version, package_sha256, role_ref, subject_employee_id, state, qualified_by_ref, created_at) VALUES (?, 'ceo.company-ceo', 1, ?, 'role:company.ceo', ?, 'QUALIFYING', ?, '2026-10-06T00:00:00.000Z')", pid, '5'.repeat(64), e.id, s.founder);
      v17.close();
      const v18 = openStoreForTests(root, { clock: new ManualClock(), liveSchemaUpdate: true });
      try {
        assert.deepEqual(v18.migration.applied, [18]);
        const d = storeContext(v18).db;
        const p = d.get('SELECT * FROM academy_packages WHERE id = ?', pid) as Record<string, unknown> | undefined;
        assert.deepEqual([p?.benchmark_method, p?.method_sha256, p?.answer_contract_version, p?.answer_contract_sha256], ['BQM-1', null, null, null], 'an existing package is truthfully BQM-1 with no pins');
        assert.throws(() => d.run("INSERT INTO academy_packages (id, code, package_version, package_sha256, role_ref, subject_employee_id, state, qualified_by_ref, created_at, benchmark_method) VALUES (?, 'ceo.company-ceo', 2, ?, 'role:company.ceo', ?, 'QUALIFYING', ?, '2026-10-06T00:00:00.000Z', 'BQM-2')", newId(), '6'.repeat(64), e.id, s.founder), rejected(/pins its method and ANSWER contract/));
        assert.throws(() => d.run("UPDATE academy_packages SET answer_contract_version = 'AC-4' WHERE id = ?", pid), rejected(/never rewritten/), 'pins are never written after registration');
        assert.deepEqual(d.all('PRAGMA foreign_key_check'), []);
        assert.equal(v18.quickCheck(), 'ok');
      } finally {
        v18.close();
      }
    } finally {
      removeRoot(root);
    }
  });
});
