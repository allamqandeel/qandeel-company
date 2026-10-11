/**
 * P1-EMPLOYEE-BASELINE-01 (D-P1-10) at the store boundary, on the real send → reply Work Item → claimed run → assembled
 * context path and the real Founder hire act (no model, no provider call, synthetic text only):
 *   A — every Employee writing to the Founder inherits the one company communication standard, once, after its own
 *       identity; the CEO keeps its own conversation and language guidance on top, with no rule stated twice; an Academy
 *       attempt and background work keep their exact contexts; the CEO's approved kernel is unchanged.
 *   B — a Founder hire without stated classes is AUTO from E1 with ceiling E4 (BALANCED), still a CANDIDATE with no budget,
 *       grant or run; a lower ceiling the Founder states is kept; an out-of-range start is refused; no existing Employee or
 *       certification changes.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { isQandeelError, type Id } from '@qandeel-company/domain';
import { ANSWER_CONTRACT_TEXT, DEFAULT_COGNITIVE_PROFILE } from '@qandeel-company/governance';
import { CEO_IDENTITY_PROFILE_V1 } from '@qandeel-company/mind';

import { AcademyStore, CommunicationStore, FounderActionStore, FounderAuthStore } from '../src/index.js';
import { CEO_CONVERSATION_GUIDANCE, CEO_LANGUAGE_GUIDANCE, EMPLOYEE_COMMUNICATION_STANDARD } from '../src/mind-writes.js';
import { assembleContext, type AssembleResult } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { seed, type Seed } from './c2-helpers.js';
import { academyWorld, assemble, claimFor, workItem } from './c3-helpers.js';
import { claimItem, placed, seat } from './c4-helpers.js';
import { harness, type Harness } from './helpers.js';

const BODY = 'SYNTHETIC: إيه رأيك في خطة الربع الجاي؟';

function withSeed(fn: (h: Harness, s: Seed) => void): void {
  const h = harness();
  try {
    fn(h, seed(h.store));
  } finally {
    h.close();
  }
}

const systemText = (r: AssembleResult): string => (r.outcome === 'OK' ? r.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '');
const assembled = (h: Harness, workItemId: Id, worker: string): AssembleResult => assembleContext(h.store, claimItem(h, workItemId, worker).fence, { step: 0 });
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
/** The Founder's reply to one Employee: its assembled system text. */
function replyContext(h: Harness, s: Seed, employeeId: Id | null, worker: string): string {
  const comm = CommunicationStore.for(h.store);
  const sent = comm.send(s.founder, comm.directThread(s.founder, employeeId).id, { purpose: 'QUESTION', body: BODY });
  const ctx = assembled(h, sent.replyWorkItemId as Id, worker);
  assert.equal(ctx.outcome, 'OK');
  return systemText(ctx);
}

describe('P1-EMPLOYEE-BASELINE-01 A: one company communication standard for every Employee who writes to the Founder', () => {
  test('the CEO turn: the standard once, then the CEO\'s own conversation and language guidance; no general rule is stated twice', () => {
    withSeed((h, s) => {
      placed(h, s, 'company.ceo');
      const sys = replyContext(h, s, null, 'w-ceo-std');
      for (const g of [EMPLOYEE_COMMUNICATION_STANDARD, CEO_CONVERSATION_GUIDANCE, CEO_LANGUAGE_GUIDANCE]) assert.equal(count(sys, g), 1);
      assert.ok(sys.indexOf(EMPLOYEE_COMMUNICATION_STANDARD) < sys.indexOf(CEO_CONVERSATION_GUIDANCE), 'the CEO guidance refines the shared standard');
      assert.ok(sys.indexOf(CEO_CONVERSATION_GUIDANCE) < sys.indexOf(CEO_LANGUAGE_GUIDANCE));
      // The general rules live once, in the standard: the CEO's own text no longer repeats them.
      for (const rule of ['«يا فندم»', 'Modern Standard Arabic', 'translated word for word', 'correct spelling and grammar', 'a verified fact (and its source)']) {
        assert.equal(count(sys, rule), 1, rule);
        assert.equal(CEO_LANGUAGE_GUIDANCE.includes(rule), false, `the CEO guidance does not restate: ${rule}`);
      }
    });
  });

  test('another Employee inherits the standard without the CEO\'s guidance, and keeps its own identity; a CEO brief carries the standard', () => {
    withSeed((h, s) => {
      placed(h, s, 'company.ceo');
      const director = placed(h, s, 'director.product');
      const sys = replyContext(h, s, director.id, 'w-dir-std');
      assert.equal(count(sys, EMPLOYEE_COMMUNICATION_STANDARD), 1);
      assert.equal(sys.includes(CEO_CONVERSATION_GUIDANCE) || sys.includes(CEO_LANGUAGE_GUIDANCE), false, 'the CEO\'s own voice stays the CEO\'s');
      assert.ok(sys.includes(`Employee ${director.id} (${director.name.given} ${director.name.family}), role ${director.roleRef}`), 'its own identity and role');
      const brief = CommunicationStore.for(h.store).requestCeoBrief({ subject: 'SYNTHETIC brief', contextKind: 'APPROVAL', contextRef: 'approval:1', reasonCode: 'brief.test', instructions: 'Brief the Founder as a MESSAGE proposal with purpose BRIEF.' });
      const briefSys = systemText(assembled(h, brief.workItemId, 'w-brief-std'));
      assert.equal(count(briefSys, EMPLOYEE_COMMUNICATION_STANDARD), 1, 'a brief is written to the Founder too');
      assert.equal(briefSys.includes(CEO_LANGUAGE_GUIDANCE), false, 'a brief keeps the CEO conversation guidance out');
    });
  });

  test('an Academy attempt and background work keep their exact contexts (no standard); the ANSWER contract is untouched', () => {
    withSeed((h, s) => {
      const w = academyWorld(h, s);
      const a = AcademyStore.for(h.store);
      const e = a.enroll(s.founder, s.employee.id, w.programVersionId);
      for (let i = 0; i < 6; i++) a.recordModuleCompletion(s.founder, e.id, `module-${i}`, `evidence:module-${i}`);
      a.advance(e.id);
      const started = a.startAttempt(e.id, { scenarioId: w.scenarios.practice, kind: 'SIMULATION', taskClass: 'draft.memo' });
      h.store.transitionWorkItem(started.workItemId, { to: 'READY', reasonCode: 'release' });
      const attempt = assemble(h, claimFor(h, started.workItemId, 'w-academy-std').claim);
      assert.equal(attempt.outcome, 'OK');
      assert.ok(systemText(attempt).includes(ANSWER_CONTRACT_TEXT));
      assert.equal(systemText(attempt).includes(EMPLOYEE_COMMUNICATION_STANDARD), false);
      const background = assemble(h, claimFor(h, workItem(h, s, s.employee), 'w-bg-std').claim);
      assert.equal(background.outcome, 'OK');
      assert.equal(systemText(background).includes(EMPLOYEE_COMMUNICATION_STANDARD), false);
    });
  });

  test('the standard: language follows the Founder, the formal register, no titles, flattery or calques, plain terms, fact vs assumption, own judgment and own voice; bounded', () => {
    const g = EMPLOYEE_COMMUNICATION_STANDARD;
    for (const must of [
      'answer in the Founder\'s language',
      'natural, professional Egyptian Arabic with correct spelling and grammar',
      'when the Founder writes English, write English',
      'professional Modern Standard Arabic for a formal Arabic document',
      'not translated word for word',
      '«يا فندم» is at most occasional, never a habit or the opening of every reply, and never flattery',
      'say what it means in plain words the first time',
      'a verified fact (and its source), your analysis, an assumption still to test, and your recommendation',
      'never present an assumption, an estimate or a projection as an established result',
      'when you disagree, say so and why',
      'take the initiative your role allows',
      'your own identity, role, specialty and personality still decide how you think and speak',
      'It grants no authority',
    ]) assert.ok(g.includes(must), must);
    assert.ok(g.length <= 2_000, 'a bounded addition to the preamble');
    // The approved CEO kernel is byte-for-byte unchanged (no certification-bearing profile change).
    assert.equal(createHash('sha256').update(CEO_IDENTITY_PROFILE_V1.identityKernel).digest('hex'), 'caab7a452326b90920b6caccde5639c3926c54b76f4b22b24808cb96638a0cbf');
  });
});

describe('P1-EMPLOYEE-BASELINE-01 B: a new hire is AUTO from E1 with ceiling E4, and stays a CANDIDATE', () => {
  function withFounder(fn: (h: Harness, s: Seed, act: (intent: string, payload: Record<string, unknown>) => { payload: Record<string, unknown>; ref: string }, preview: (payload: Record<string, unknown>) => unknown) => void): void {
    withSeed((h, s) => {
      const auth = FounderAuthStore.for(h.store);
      const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
      const actions = FounderActionStore.for(h.store, auth);
      fn(h, s, (intent, payload) => {
        const p = actions.preview(session, intent, payload);
        return { payload: p.payload, ref: actions.confirm(session, p.id, p.fingerprint).resultRef };
      }, (payload) => actions.preview(session, 'EMPLOYEE_HIRE', payload));
    });
  }

  test('the standard profile: the default hire is AUTO/E1/E4 BALANCED, a CANDIDATE with no budget or work; nobody else changes', () => {
    withFounder((h, s, act) => {
      assert.deepEqual(DEFAULT_COGNITIVE_PROFILE, { defaultClass: 'E1', ceilingClass: 'E4', costDiscipline: 'BALANCED', selection: 'AUTO' });
      const ceo = placed(h, s, 'company.ceo');
      const db = storeContext(h.store).db;
      const before = { ceo: db.get<{ p: string; v: number }>('SELECT cognitive_profile_json AS p, version AS v FROM employees WHERE id = ?', ceo.id), certs: db.all('SELECT id, status FROM certifications ORDER BY id') };
      const seatId = seat(h, 'director.product').id;
      const { payload, ref } = act('EMPLOYEE_HIRE', { positionId: seatId, givenName: 'Karim', familyName: 'Adel' });
      assert.deepEqual([payload.defaultClass, payload.ceilingClass, payload.selection, payload.costDiscipline, payload.startsAs], ['E1', 'E4', 'AUTO', 'BALANCED', 'CANDIDATE']);
      const hired = s.gov.getEmployee(ref.split(':')[1] as Id);
      assert.equal(hired.state, 'CANDIDATE', 'hiring never activates: the Academy alone does');
      assert.deepEqual(hired.cognitiveProfile, { defaultClass: 'E1', ceilingClass: 'E4', costDiscipline: 'BALANCED', selection: 'AUTO' });
      assert.equal(s.gov.reasoningControl(hired.id).selection, 'AUTO');
      assert.equal(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM budgets WHERE scope = 'EMPLOYEE' AND scope_id = ?`, hired.id)?.n, 0, 'no budget: nothing can be spent');
      assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM work_items WHERE owner_ref = ?', hired.ref)?.n, 0, 'no work');
      assert.deepEqual({ ceo: db.get<{ p: string; v: number }>('SELECT cognitive_profile_json AS p, version AS v FROM employees WHERE id = ?', ceo.id), certs: db.all('SELECT id, status FROM certifications ORDER BY id') }, before, 'no existing profile or certification changed');
    });
  });

  test('the Founder may state a lower ceiling or an E2 start; an out-of-range profile is refused', () => {
    withFounder((h, s, act, preview) => {
      const lower = act('EMPLOYEE_HIRE', { positionId: seat(h, 'director.product').id, givenName: 'Mona', familyName: 'Fawzy', ceilingClass: 'E2' });
      assert.deepEqual(s.gov.getEmployee(lower.ref.split(':')[1] as Id).cognitiveProfile, { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED', selection: 'AUTO' });
      const seatId = seat(h, 'director.growth').id;
      const refused = (e: unknown): boolean => isQandeelError(e) && e.details.reason === 'COGNITIVE_PROFILE';
      for (const bad of [{ defaultClass: 'E3' }, { defaultClass: 'E0' }, { ceilingClass: 'E0' }, { defaultClass: 'E2', ceilingClass: 'E1' }, { ceilingClass: 'E5' }]) {
        assert.throws(() => preview({ positionId: seatId, givenName: 'Hany', familyName: 'Saad', ...bad }), refused, JSON.stringify(bad));
      }
      const e2 = act('EMPLOYEE_HIRE', { positionId: seatId, givenName: 'Hany', familyName: 'Saad', defaultClass: 'E2' });
      assert.deepEqual(s.gov.getEmployee(e2.ref.split(':')[1] as Id).cognitiveProfile, { defaultClass: 'E2', ceilingClass: 'E4', costDiscipline: 'BALANCED', selection: 'AUTO' });
    });
  });
});
