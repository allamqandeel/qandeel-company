/**
 * L1-02 — the candidate's answer as durable, provenance-bound evidence (D-L1-18).
 *
 * An answer is accepted only from the live fence of the answer-bearing Work Item's own run, bound to the exact Context
 * Manifest of the model call that produced it (this run, this item, this step, OK, spent on a reservation), and for an
 * Academy attempt to the manifest that exposed the scenario. It is append-only and idempotent under replay; it scores,
 * passes, approves and activates nothing. An evaluator scores only an attempt that has its answer, and the answer's
 * reference is bound into every evaluator result automatically. L1-02-PROOF: academy-answer
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ManualClock, isQandeelError, type Id } from '@qandeel-company/domain';
import { parseProposal } from '@qandeel-company/governance';

import { AcademyStore, loadReleasedMigrations } from '../src/index.js';
import { interruptClaim, recordAnswer, reserveBudget } from '../src/runtime-authority.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { seed, type Seed } from './c2-helpers.js';
import { ANSWER, academyWorld, answerIn, answerWork, assemble, claimFor, complete, scores, workItem } from './c3-helpers.js';
import { harness, removeRoot, tempRoot, type Harness } from './helpers.js';

const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;
const reason = (r: string) => (e: unknown): boolean => isQandeelError(e) && e.details['reason'] === r;
// A distinctive body: the leak checks look for it in every content-free table.
const BODY = 'L1-02 distinctive answer body: gather the missing evidence before any irreversible step.';

function withSeed(fn: (h: Harness, s: Seed) => void): void {
  const h = harness();
  try {
    fn(h, seed(h.store));
  } finally {
    h.close();
  }
}

/** An enrolled trainee (the seed Employee) with one open practice attempt released for its run. */
function openAttempt(h: Harness, s: Seed): { a: AcademyStore; attemptId: Id; workItemId: Id; enrollmentId: Id } {
  const w = academyWorld(h, s);
  const a = AcademyStore.for(h.store);
  const e = a.enroll(s.founder, s.employee.id, w.programVersionId);
  for (let i = 0; i < 6; i++) a.recordModuleCompletion(s.founder, e.id, `module-${i}`, `evidence:m${i}`);
  a.advance(e.id);
  const started = a.startAttempt(e.id, { scenarioId: w.scenarios.practice, kind: 'SIMULATION', taskClass: 'draft.memo' });
  s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: started.workItemId, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'seed' });
  h.store.transitionWorkItem(started.workItemId, { to: 'READY', reasonCode: 'release' });
  return { a, attemptId: started.attempt.id, workItemId: started.workItemId, enrollmentId: e.id };
}

const reserve = (h: Harness, s: Seed, fence: Parameters<typeof reserveBudget>[1], manifestId: Id) =>
  reserveBudget(h.store, fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: s.deploymentId, priceCardId: s.priceCardId, routePolicyId: s.policyId, money: 1_000, tokens: 10_000, contextManifestId: manifestId });

describe('L1-02: the Academy answer — durable, bound to its exact model call, evidence only', () => {
  test('ANSWER parses only its exact bounded shape (closed facets; no score, no extra key)', () => {
    const ok = { type: 'ANSWER', body: 'x', decision: 'GATHER_EVIDENCE', reversible: true, authority: 'NEEDS_FOUNDER', evidence: 'PARTIAL', confidence: 'LOW', founderDecisionNeeded: true, spendMicros: 0 };
    assert.equal(parseProposal(JSON.stringify(ok)).type, 'ANSWER');
    for (const bad of [
      { ...ok, scorePct: 100 },
      { ...ok, passed: true },
      { ...ok, decision: 'APPROVE' },
      { ...ok, authority: 'GRANTED' },
      { ...ok, spendMicros: -1 },
      { ...ok, spendMicros: 1.5 },
      { ...ok, reversible: 'yes' },
      { ...ok, body: '' },
      { ...ok, body: 'x'.repeat(6_001) },
      Object.fromEntries(Object.entries(ok).filter(([k]) => k !== 'confidence')),
    ]) assert.equal(parseProposal(JSON.stringify(bad)).type, 'INVALID', JSON.stringify(Object.keys(bad)));
  });

  test('ordinary work cannot persist an answer; one run cannot answer with another run\'s or another item\'s manifest; wrong step or an unspent manifest is refused', () => {
    withSeed((h, s) => {
      // Ordinary (non answer-bearing) work.
      const plain = claimFor(h, workItem(h, s, s.employee)).claim;
      const pm = assemble(h, plain, 0);
      assert.equal(pm.outcome, 'OK');
      assert.ok(reserve(h, s, plain.fence, pm.manifestId).ok);
      assert.equal(recordAnswer(h.store, plain.fence, ANSWER, { manifestId: pm.manifestId, step: 0 }).code, 'NOT_AN_ANSWER_TASK');
      // The attempt's run.
      const at = openAttempt(h, s);
      const run = claimFor(h, at.workItemId).claim;
      const m0 = assemble(h, run, 0);
      assert.equal(m0.outcome, 'OK');
      // Unspent manifest (no model call was reserved against it).
      assert.equal(recordAnswer(h.store, run.fence, ANSWER, { manifestId: m0.manifestId, step: 0 }).code, 'MANIFEST_MISMATCH');
      assert.ok(reserve(h, s, run.fence, m0.manifestId).ok);
      // Another run's manifest (the ordinary run's), the wrong step, an unknown manifest.
      assert.equal(recordAnswer(h.store, run.fence, ANSWER, { manifestId: pm.manifestId, step: 0 }).code, 'MANIFEST_MISMATCH');
      assert.equal(recordAnswer(h.store, run.fence, ANSWER, { manifestId: m0.manifestId, step: 1 }).code, 'MANIFEST_MISMATCH');
      assert.equal(recordAnswer(h.store, run.fence, ANSWER, { manifestId: '00000000-0000-4000-8000-000000000000' as Id, step: 0 }).code, 'MANIFEST_MISMATCH');
      // The ordinary run cannot use the attempt's manifest either (it is not its run / item).
      assert.equal(recordAnswer(h.store, plain.fence, ANSWER, { manifestId: m0.manifestId, step: 0 }).code, 'NOT_AN_ANSWER_TASK');
      assert.equal(at.a.attemptAnswer(at.attemptId), null, 'nothing was stored by any refused write');
      // The right binding records.
      const rec = recordAnswer(h.store, run.fence, { ...ANSWER, body: BODY }, { manifestId: m0.manifestId, step: 0 });
      assert.deepEqual([rec.outcome, rec.code], ['RECORDED', 'RECORDED']);
    });
  });

  test('the attempt\'s manifest exposed its scenario (recorded by the assembler) — and only such a manifest binds an answer', () => {
    withSeed((h, s) => {
      const at = openAttempt(h, s);
      const run = claimFor(h, at.workItemId).claim;
      const m = assemble(h, run, 0);
      assert.equal(m.outcome, 'OK');
      const db = storeContext(h.store).db;
      assert.equal(Number(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_scenario_exposures WHERE attempt_id = ? AND manifest_id = ?', at.attemptId, m.manifestId)?.n), 1);
      assert.ok(reserve(h, s, run.fence, m.manifestId).ok);
      assert.equal(recordAnswer(h.store, run.fence, ANSWER, { manifestId: m.manifestId, step: 0 }).outcome, 'RECORDED');
    });
  });

  test('defence in depth: an otherwise valid answer whose OK, spent manifest did NOT expose the attempt\'s scenario is refused and nothing is stored', () => {
    withSeed((h, s) => {
      const at = openAttempt(h, s);
      const run = claimFor(h, at.workItemId).claim;
      const m = assemble(h, run, 0);
      assert.equal(m.outcome, 'OK');
      assert.ok(reserve(h, s, run.fence, m.manifestId).ok);
      // FIXTURE ONLY (this throwaway test database): no production path produces an OK attempt manifest without its
      // exposure row (the assembler writes both in one transaction, and the table is append-only), so the malformed
      // durable state is constructed directly — the append-only trigger is lifted, the one row removed, the trigger restored.
      const db = storeContext(h.store).db;
      db.immediate('fixture: unexposed manifest', () => {
        db.run('DROP TRIGGER academy_scenario_exposures_append_only_d');
        db.run('DELETE FROM academy_scenario_exposures WHERE attempt_id = ? AND manifest_id = ?', at.attemptId, m.manifestId);
        db.run(`CREATE TRIGGER academy_scenario_exposures_append_only_d BEFORE DELETE ON academy_scenario_exposures BEGIN SELECT RAISE(ABORT, 'academy scenario exposures is append-only'); END`);
      });
      assert.equal(Number(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_scenario_exposures WHERE attempt_id = ?', at.attemptId)?.n), 0);
      const rec = recordAnswer(h.store, run.fence, ANSWER, { manifestId: m.manifestId, step: 0 });
      assert.deepEqual([rec.outcome, rec.code, rec.answerId], ['REFUSED', 'SCENARIO_NOT_EXPOSED', null]);
      assert.equal(at.a.attemptAnswer(at.attemptId), null);
      assert.equal(Number(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM work_answers WHERE work_item_id = ?', at.workItemId)?.n), 0, 'no answer row persisted');
    });
  });

  test('replay is idempotent: the same answer replays to the same record; a different second answer is refused and returns the stored one; the table is append-only', () => {
    withSeed((h, s) => {
      const at = openAttempt(h, s);
      const run = claimFor(h, at.workItemId).claim;
      const m = assemble(h, run, 0);
      const first = answerIn(h, s, run, m.manifestId, 0, { ...ANSWER, body: BODY });
      const again = recordAnswer(h.store, run.fence, { ...ANSWER, body: BODY }, { manifestId: m.manifestId, step: 0 });
      assert.deepEqual([again.outcome, again.code, again.answerId], ['RECORDED', 'REPLAYED', first.answerId]);
      const other = recordAnswer(h.store, run.fence, { ...ANSWER, body: 'A different answer.' }, { manifestId: m.manifestId, step: 0 });
      assert.deepEqual([other.outcome, other.code, other.answerId], ['REFUSED', 'ALREADY_ANSWERED', first.answerId], 'a resumed run learns which answer stands');
      assert.equal(at.a.attemptAnswer(at.attemptId)?.body, BODY);
      const db = storeContext(h.store).db;
      assert.equal(Number(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM work_answers WHERE work_item_id = ?', at.workItemId)?.n), 1);
      assert.throws(() => db.immediate('bypass', () => db.run(`UPDATE work_answers SET body = 'x' WHERE work_item_id = ?`, at.workItemId)), code('STORAGE_INVARIANT'));
      assert.throws(() => db.immediate('bypass', () => db.run('DELETE FROM work_answers WHERE work_item_id = ?', at.workItemId)), code('STORAGE_INVARIANT'));
    });
  });

  test('a dead worker\'s fence writes nothing; the resumed run answers once; an ended run cannot answer', () => {
    withSeed((h, s) => {
      const at = openAttempt(h, s);
      const dead = claimFor(h, at.workItemId, 'w-dead').claim;
      const dm = assemble(h, dead, 0);
      assert.ok(reserve(h, s, dead.fence, dm.manifestId).ok);
      interruptClaim(h.store, h.supervisor, dead.fence.jobId, 'PROCESS_DIED');
      assert.throws(() => recordAnswer(h.store, dead.fence, ANSWER, { manifestId: dm.manifestId, step: 0 }), code('STALE_LEASE'));
      h.clock.advance(60 * 60_000);
      const resumed = claimFor(h, at.workItemId, 'w-resumed').claim;
      const rm = assemble(h, resumed, 1);
      answerIn(h, s, resumed, rm.manifestId, 1);
      complete(h, resumed);
      assert.throws(() => recordAnswer(h.store, resumed.fence, { ...ANSWER, body: 'late' }, { manifestId: rm.manifestId, step: 1 }), code('STALE_LEASE'), 'an ended run holds no fence');
      assert.equal(Number(storeContext(h.store).db.get<{ n: number }>('SELECT COUNT(*) AS n FROM work_answers WHERE work_item_id = ?', at.workItemId)?.n), 1);
    });
  });

  test('storing an answer changes no score, no attempt outcome, no stage, no lifecycle state', () => {
    withSeed((h, s) => {
      const at = openAttempt(h, s);
      const before = { stage: at.a.enrollment(at.enrollmentId).stage, employee: s.gov.getEmployee(s.employee.id).state };
      const run = claimFor(h, at.workItemId).claim;
      const m = assemble(h, run, 0);
      answerIn(h, s, run, m.manifestId, 0);
      const attemptRow = at.a.attempts(at.enrollmentId).find((x) => x.id === at.attemptId);
      assert.deepEqual([attemptRow?.state, attemptRow?.outcome ?? null], ['OPEN', null]);
      assert.deepEqual(at.a.dimensionResults(at.attemptId), []);
      assert.deepEqual({ stage: at.a.enrollment(at.enrollmentId).stage, employee: s.gov.getEmployee(s.employee.id).state }, before);
    });
  });

  test('an evaluator scores only a recorded answer; scores stay evaluator-owned (never the trainee, never deterministic dimensions); the answer reference is bound into every result', () => {
    withSeed((h, s) => {
      // No answer (the run ended with no ANSWER): an evaluator score is refused.
      const at = openAttempt(h, s);
      const run = claimFor(h, at.workItemId).claim;
      assemble(h, run, 0);
      complete(h, run);
      at.a.evaluateDeterministic(at.attemptId);
      assert.throws(() => at.a.recordEvaluation(s.founder, at.attemptId, scores(90)), reason('ANSWER_REQUIRED'));
    });
    withSeed((h, s) => {
      const at = openAttempt(h, s);
      const st = { attempt: { id: at.attemptId }, workItemId: at.workItemId };
      answerWork(h, s, st.workItemId, { ...ANSWER, body: BODY });
      at.a.evaluateDeterministic(st.attempt.id);
      assert.throws(() => at.a.recordEvaluation(s.employee.ref, st.attempt.id, scores(100)), code('SELF_ESCALATION_REFUSED'), 'the trainee never scores itself');
      assert.throws(() => at.a.recordEvaluation(s.founder, st.attempt.id, [{ dimension: 'AUTHORITY_COMPLIANCE', scorePct: 100 }]), reason('DETERMINISTIC_DIMENSION'));
      const answer = at.a.attemptAnswer(st.attempt.id);
      assert.ok(answer);
      at.a.recordEvaluation(s.founder, st.attempt.id, scores(90).map((r) => ({ ...r, evidenceRefs: ['evidence:founder-notes'] })));
      const evaluated = storeContext(h.store).db.all<{ evidence_refs_json: string }>(`SELECT evidence_refs_json FROM academy_dimension_results WHERE attempt_id = ? AND evaluator_kind = 'EVALUATOR'`, st.attempt.id).map((r) => ({ evidenceRefs: JSON.parse(r.evidence_refs_json) as string[] }));
      assert.ok(evaluated.length > 0 && evaluated.every((d) => d.evidenceRefs[0] === `work_answer:${answer.id}` && d.evidenceRefs.includes('evidence:founder-notes')), 'the scored answer is part of every evaluator result');
    });
  });

  test('the answer body never reaches audit, events or step telemetry metadata (Rule A)', () => {
    withSeed((h, s) => {
      const at = openAttempt(h, s);
      answerWork(h, s, at.workItemId, { ...ANSWER, body: BODY });
      const db = storeContext(h.store).db;
      for (const table of ['audit_events', 'events']) {
        const rows = JSON.stringify(db.all(`SELECT * FROM ${table}`));
        assert.ok(!rows.includes('distinctive answer body'), `${table} carries no answer content`);
      }
      assert.ok(db.all(`SELECT * FROM audit_events WHERE action = 'answer.recorded'`).length === 1);
    });
  });

  test('migration 0017: a released v16 Company upgrades to v17; every prior row kept; 0001–0016 unchanged', () => {
    const root = tempRoot('l1-02-v16');
    try {
      const v16 = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(16) });
      assert.equal(v16.schemaVersion, 16);
      const d16 = storeContext(v16).db;
      const count = (d: typeof d16, t: string): number => Number(d.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n);
      const before = { previews: count(d16, 'founder_action_previews'), audit: count(d16, 'audit_events'), employees: count(d16, 'employees') };
      v16.close();
      const v17 = openStoreForTests(root, { clock: new ManualClock(), liveSchemaUpdate: true });
      try {
        assert.deepEqual(v17.migration.applied, [17, 18, 19, 20, 21]);
        const d = storeContext(v17).db;
        assert.deepEqual({ previews: count(d, 'founder_action_previews'), audit: count(d, 'audit_events'), employees: count(d, 'employees') }, before);
        assert.equal(count(d, 'work_answers'), 0, 'the release creates no answer');
        assert.deepEqual(d.all('PRAGMA foreign_key_check'), []);
        assert.equal(v17.quickCheck(), 'ok');
      } finally {
        v17.close();
      }
    } finally {
      removeRoot(root);
    }
  });
});
