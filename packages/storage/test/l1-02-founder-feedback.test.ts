/**
 * D-L1-39 — the Academy Founder Feedback Loop at the store boundary: the Founder's textual feedback on one attempt is a
 * governed preview → fingerprint → confirm act, durable, bound to the attempt's exact recorded answer, append-only and
 * content-free in telemetry (Rule A); it reaches the trainee's LATER Academy attempts' governed context (and only those),
 * and the manifest evidence of that exposure is readable. No attempt, answer or score is ever rewritten.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ManualClock, isQandeelError, sha256Hex, type Id } from '@qandeel-company/domain';

import { AcademyStore, FounderActionStore, FounderAuthStore, loadReleasedMigrations } from '../src/index.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { seed, type Seed } from './c2-helpers.js';
import { ANSWER, academyWorld, answerIn, assemble, attempt, claimFor, complete, scores, workItem, type AcademyWorld } from './c3-helpers.js';
import { harness, removeRoot, tempRoot, type Harness } from './helpers.js';

/** Built at run time so no secret-looking literal is in the source (the verifier scans it). */
const FAKE_KEY = ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz99'].join('-');
type Session = ReturnType<FounderAuthStore['redeemLaunchToken']>['session'];
const NOTE = 'The structured decision facet must reflect the operational decision your answer actually takes. مثال: قرار التشغيل الفعلي. marker-7f3a9c';

function withAcademy(fn: (x: { h: Harness; s: Seed; actions: FounderActionStore; sess: Session; w: AcademyWorld; a: AcademyStore; enrollmentId: Id; practice: { id: Id; workItemId: Id } }) => void): void {
  const h = harness();
  try {
    const s = seed(h.store);
    const auth = FounderAuthStore.for(h.store);
    const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
    const w = academyWorld(h, s);
    const a = AcademyStore.for(h.store);
    const e = a.enroll(s.founder, s.employee.id, w.programVersionId);
    for (let i = 0; i < 6; i++) a.recordModuleCompletion(s.founder, e.id, `module-${i}`, `evidence:module-${i}`);
    a.advance(e.id);
    const practice = attempt(h, s, e.id, w.scenarios.practice, 'SIMULATION');
    assert.equal(practice.state, 'EVALUATED');
    a.advance(e.id);
    fn({ h, s, actions: FounderActionStore.for(h.store, auth), sess: session, w, a, enrollmentId: e.id, practice: { id: practice.id, workItemId: practice.workItemId } });
  } finally {
    h.close();
  }
}

const refusedWith = (reason: string) => (e: unknown): boolean => isQandeelError(e) && e.details.reason === reason;
const db = (h: Harness) => storeContext(h.store).db;
const answerOf = (h: Harness, workItemId: Id) => db(h).get<{ id: string; body: string }>('SELECT id, body FROM work_answers WHERE work_item_id = ?', workItemId);
const give = (x: { actions: FounderActionStore; sess: Session }, attemptId: Id, feedback: string) => {
  const p = x.actions.preview(x.sess, 'ACADEMY_FOUNDER_FEEDBACK', { attemptId, feedback });
  x.actions.confirm(x.sess, p.id, p.fingerprint);
  return p;
};
const ready = (h: Harness, id: Id): void => {
  if (h.store.getWorkItem(id).state === 'PROPOSED') h.store.transitionWorkItem(id, { to: 'READY', reasonCode: 'release' });
};
/** Starts an attempt and assembles its first context (as the runtime would), returning the manifest entries for feedback. */
function startAndAssemble(h: Harness, a: AcademyStore, enrollmentId: Id, scenarioId: Id) {
  const started = a.startAttempt(enrollmentId, { scenarioId, kind: 'ASSESSMENT', taskClass: 'draft.memo' });
  ready(h, started.workItemId);
  const { claim, begun } = claimFor(h, started.workItemId);
  assert.ok(begun.ok);
  const ctx = assemble(h, claim, 0);
  assert.equal(ctx.outcome, 'OK');
  const text = ctx.outcome === 'OK' ? ctx.messages.map((m) => m.content).join('\n') : '';
  const entries = db(h).all<{ decision: string; layer: string; item_kind: string; provenance_ref: string }>(`SELECT decision, layer, item_kind, provenance_ref FROM context_manifest_entries WHERE manifest_id = ? AND provenance_ref GLOB 'academy_founder_feedback:*' ORDER BY ordinal`, ctx.manifestId);
  return { started, claim, manifestId: ctx.manifestId, text, entries };
}

describe('D-L1-39: Founder feedback is a governed, durable, append-only act bound to one attempt and its answer', () => {
  test('ACADEMY_FOUNDER_FEEDBACK: the preview shows the attempt, the bound answer and the exact text and writes nothing; the confirm stores it bound to the answer; history is untouched; telemetry is content-free', () => {
    withAcademy((x) => {
      const { h, s, practice } = x;
      const answer = answerOf(h, practice.workItemId);
      assert.ok(answer);
      const attemptBefore = JSON.stringify(db(h).get('SELECT * FROM academy_attempts WHERE id = ?', practice.id));
      const resultsBefore = JSON.stringify(db(h).all('SELECT * FROM academy_dimension_results WHERE attempt_id = ? ORDER BY dimension', practice.id));
      const p = x.actions.preview(x.sess, 'ACADEMY_FOUNDER_FEEDBACK', { attemptId: practice.id, feedback: `  ${NOTE}  ` });
      assert.deepEqual(
        [p.payload.attemptId, p.payload.attemptKind, p.payload.outcome, p.payload.employeeId, p.payload.answerRef, p.payload.answerSha256, p.payload.feedback, p.payload.feedbackSha256, p.payload.priorFeedbackOnAttempt],
        [practice.id, 'SIMULATION', 'PASS', s.employee.id, `work_answer:${answer.id}`, sha256Hex(answer.body), NOTE, sha256Hex(NOTE), 0],
      );
      assert.deepEqual(
        [p.payload.reaches, p.payload.historyChange, p.payload.scoreChange, p.payload.authorityChange, p.payload.budgetChange, p.payload.providerCall],
        ['LATER_ACADEMY_ATTEMPTS_OF_THIS_EMPLOYEE', 'NONE', 'NONE', 'NONE', 'NONE', 'NONE'],
      );
      assert.equal(p.payload.feedbackBytes, Buffer.byteLength(NOTE, 'utf8'));
      assert.equal(db(h).get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_founder_feedback')?.n, 0, 'a preview writes nothing');
      x.actions.confirm(x.sess, p.id, p.fingerprint);

      const rows = db(h).all<Record<string, string | number | null>>('SELECT * FROM academy_founder_feedback');
      assert.equal(rows.length, 1);
      const r: Record<string, string | number | null> = rows[0] ?? {};
      assert.deepEqual([r.attempt_id, r.employee_id, r.work_answer_id, r.answer_sha256, r.body, r.body_sha256, r.data_class, r.set_by_ref], [practice.id, s.employee.id, answer.id, sha256Hex(answer.body), NOTE, sha256Hex(NOTE), 'D1', s.founder]);
      assert.equal(JSON.stringify(db(h).get('SELECT * FROM academy_attempts WHERE id = ?', practice.id)), attemptBefore, 'the attempt and its outcome stand as decided');
      assert.equal(JSON.stringify(db(h).all('SELECT * FROM academy_dimension_results WHERE attempt_id = ? ORDER BY dimension', practice.id)), resultsBefore, 'no score is rewritten');

      // Append-only: never rewritten, never deleted; a later note is a new row.
      assert.throws(() => db(h).run('UPDATE academy_founder_feedback SET body = ? WHERE id = ?', 'rewritten', String(r.id)), /database constraint rejected write/);
      assert.throws(() => db(h).run('DELETE FROM academy_founder_feedback WHERE id = ?', String(r.id)), /database constraint rejected write/);
      give(x, practice.id, 'A second note: name the evidence you relied on.');
      assert.equal(db(h).get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_founder_feedback WHERE attempt_id = ?', practice.id)?.n, 2);
      assert.deepEqual(AcademyStore.for(h.store).founderFeedback(practice.id).map((f) => f.body), [NOTE, 'A second note: name the evidence you relied on.']);

      // Rule A: the text never enters audit or events; the audit row carries IDs and a size.
      for (const t of ['audit_events', 'events']) assert.equal(db(h).get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE CAST(${t === 'events' ? 'payload_json' : 'details_json'} AS TEXT) LIKE '%marker-7f3a9c%'`)?.n, 0, `${t} is content-free`);
      const audit = db(h).all<{ actor_ref: string; details_json: string }>(`SELECT actor_ref, details_json FROM audit_events WHERE action = 'academy.founder_feedback_recorded' ORDER BY rowid`);
      assert.equal(audit.length, 2);
      assert.equal(audit[0]?.actor_ref, s.founder);
      assert.deepEqual(Object.keys(JSON.parse(audit[0]?.details_json ?? '{}')).sort(), ['answerId', 'bytes', 'employeeId', 'feedbackId']);
    });
  });

  test('refusals: an unevaluated attempt, a hidden holdout, an empty / oversize / secret note, more than five notes, a non-Founder actor; the datastore binds the answer', () => {
    withAcademy((x) => {
      const { h, s, a, w, enrollmentId, practice } = x;
      const pv = (attemptId: Id, feedback: unknown) => () => x.actions.preview(x.sess, 'ACADEMY_FOUNDER_FEEDBACK', { attemptId, feedback });
      assert.throws(pv(practice.id, '   '), refusedWith('FEEDBACK_EMPTY'));
      assert.throws(pv(practice.id, 'x'.repeat(2_401)), refusedWith('FEEDBACK_TOO_LONG'));
      assert.throws(pv(practice.id, 'ق'.repeat(1_201)), refusedWith('FEEDBACK_TOO_LONG'), 'the bound is bytes (Arabic is two bytes a character)');
      assert.doesNotThrow(pv(practice.id, 'ق'.repeat(1_200)));
      assert.throws(pv(practice.id, `use this: ${FAKE_KEY}`), refusedWith('SECRET_MATERIAL'));
      // An attempt still OPEN has no decided outcome yet.
      const open = a.startAttempt(enrollmentId, { scenarioId: w.scenarios.holdout, kind: 'ASSESSMENT', taskClass: 'draft.memo' });
      assert.throws(pv(open.attempt.id, NOTE), refusedWith('ATTEMPT_NOT_EVALUATED'));
      // The same attempt once evaluated is a hidden holdout: no feedback (it would expose the holdout).
      ready(h, open.workItemId);
      const { claim } = claimFor(h, open.workItemId);
      const ctx = assemble(h, claim, 0);
      assert.equal(ctx.outcome, 'OK');
      answerIn(h, s, claim, ctx.manifestId, 0, ANSWER);
      complete(h, claim);
      a.evaluateDeterministic(open.attempt.id);
      a.recordEvaluation(s.founder, open.attempt.id, scores(90));
      assert.throws(pv(open.attempt.id, NOTE), refusedWith('HOLDOUT_ATTEMPT'));
      // At most five notes per attempt.
      for (let i = 0; i < 5; i++) give(x, practice.id, `note ${i}`);
      assert.throws(pv(practice.id, 'one more'), refusedWith('FEEDBACK_LIMIT'));
      // Only the Founder gives it: an Employee actor is refused at the store.
      assert.throws(() => AcademyStore.for(h.store).recordFounderFeedback(s.employee.ref, practice.id, { feedback: NOTE, expectedAnswerSha256: 'a'.repeat(64), expectedFeedbackSha256: sha256Hex(NOTE), reasonCode: 'x' }));
      // The datastore binds the row to the attempt's own answer (a mismatched answer digest is refused).
      const ans = answerOf(h, practice.workItemId);
      assert.throws(
        () => db(h).run(`INSERT INTO academy_founder_feedback (id, attempt_id, employee_id, work_answer_id, answer_sha256, body, body_sha256, data_class, set_by_ref, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'D1', ?, 'x', ?)`, '00000000-0000-4000-8000-000000000001', practice.id, s.employee.id, ans?.id ?? '', 'b'.repeat(64), NOTE, sha256Hex(NOTE), s.founder, '2026-09-26T12:00:00.000Z'),
        /database constraint rejected write/,
      );
    });
  });
});

describe('D-L1-39: Founder feedback reaches the trainee\'s later Academy attempts — and only those', () => {
  test('an attempt started after the note carries it (required, integrity-checked, manifest-recorded); an attempt started before it does not; production work never does; the exposure is readable evidence', () => {
    withAcademy((x) => {
      const { h, s, a, w, enrollmentId, practice } = x;
      // An attempt already started before the note: its context never changes mid-attempt.
      const before = startAndAssemble(h, a, enrollmentId, w.scenarios.assessment);
      h.clock.advance(1_000);
      give(x, practice.id, NOTE);
      const fb = db(h).get<{ id: string }>('SELECT id FROM academy_founder_feedback')?.id ?? '';
      const step1 = assemble(h, before.claim, 1);
      assert.equal(step1.outcome, 'OK');
      assert.equal(db(h).get<{ n: number }>(`SELECT COUNT(*) AS n FROM context_manifest_entries WHERE manifest_id IN (?, ?) AND provenance_ref GLOB 'academy_founder_feedback:*'`, before.manifestId, step1.manifestId)?.n, 0, 'notes recorded after an attempt started never enter it');
      assert.ok(!before.text.includes('marker-7f3a9c'));
      answerIn(h, s, before.claim, step1.manifestId, 1, ANSWER);
      complete(h, before.claim);
      a.evaluateDeterministic(before.started.attempt.id);
      a.recordEvaluation(s.founder, before.started.attempt.id, scores(90));

      // The next attempt carries the note: in the RECENT layer, required (never crowded out), the exact text.
      h.clock.advance(1_000);
      const later = startAndAssemble(h, a, enrollmentId, w.scenarios.holdout);
      assert.deepEqual(later.entries.map((e) => ({ ...e })), [{ decision: 'SELECTED', layer: 'RECENT', item_kind: 'TOOL_RESULT', provenance_ref: `academy_founder_feedback:${fb}` }]);
      assert.ok(later.text.includes(NOTE), 'the trainee sees the Founder\'s exact words');
      assert.ok(later.text.includes('Founder feedback on your earlier Academy simulation #1 (practice-1)'));

      // Production work of the same Employee never carries Academy feedback.
      const prod = workItem(h, s, s.employee);
      ready(h, prod);
      const { claim: pc } = claimFor(h, prod);
      const pctx = assemble(h, pc, 0);
      assert.equal(pctx.outcome, 'OK');
      assert.equal(db(h).get<{ n: number }>(`SELECT COUNT(*) AS n FROM context_manifest_entries WHERE manifest_id = ? AND provenance_ref GLOB 'academy_founder_feedback:*'`, pctx.manifestId)?.n, 0);

      // The read model: the note, its bound answer, and the later attempts whose context actually carried it.
      const view = AcademyStore.for(h.store).founderFeedback(practice.id);
      assert.equal(view.length, 1);
      assert.equal(view[0]?.answerRef, `work_answer:${answerOf(h, practice.workItemId)?.id}`);
      assert.deepEqual(view[0]?.exposedTo.map((e) => e.attemptId), [later.started.attempt.id]);
    });
  });
});

describe('D-L1-39: migration 0021', () => {
  test('a released v20 Company upgrades to v21: every Founder preview, attempt, answer, score and migration 0001–0020 is unchanged; the feedback relation starts empty', () => {
    const root = tempRoot('l1-02-v20');
    try {
      const v20 = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(20) });
      const s = seed(v20);
      const auth = FounderAuthStore.for(v20);
      const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
      const company = s.gov.budgetFor('COMPANY', 'company');
      FounderActionStore.for(v20, auth).preview(session, 'BUDGET_CEILING', { budgetId: company?.id, capMoney: 12_000_000 });
      const d20 = storeContext(v20).db;
      const snap = (d: typeof d20) => JSON.stringify(['founder_action_previews', 'academy_attempts', 'work_answers', 'academy_dimension_results'].map((t) => d.all(`SELECT * FROM ${t} ORDER BY 1, 2`)));
      const before = snap(d20);
      const migrations = JSON.stringify(d20.all('SELECT version, name, sha256, applied_at FROM schema_migrations ORDER BY version'));
      assert.notEqual(JSON.parse(JSON.stringify(d20.all('SELECT * FROM founder_action_previews'))).length, 0);
      v20.close();
      const v21 = openStoreForTests(root, { clock: new ManualClock(), liveSchemaUpdate: true, migrations: loadReleasedMigrations(21) });
      try {
        assert.deepEqual(v21.migration.applied, [21]);
        const d = storeContext(v21).db;
        assert.equal(snap(d), before, 'every row is kept as it was');
        assert.equal(JSON.stringify(d.all('SELECT version, name, sha256, applied_at FROM schema_migrations WHERE version <= 20 ORDER BY version')), migrations, '0001–0020 unchanged');
        assert.equal(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM academy_founder_feedback')?.n, 0);
        assert.deepEqual(d.all('PRAGMA foreign_key_check'), []);
        assert.equal(v21.quickCheck(), 'ok');
      } finally {
        v21.close();
      }
    } finally {
      removeRoot(root);
    }
  });
});
