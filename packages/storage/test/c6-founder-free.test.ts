/**
 * C6-R1 storage proofs — operational judgment is delegated by evidence, qualification, review policy and risk;
 * execution authority stays separately governed. The ordinary Work → Review → Verify → Evaluate → Attribute →
 * Learn → Retrain → Later evidence cycle runs with the Founder surface DISARMED (any Founder act would fail
 * closed), through the real C4 Review Pool and fenced review runs, and leaves every grant, budget cap, approval,
 * route / model / tool policy, seat and certification exactly as it was. C6-PROOF: storage-founder-free
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError, newId, type Id } from '@qandeel-company/domain';
import type { OutcomeJudgment } from '@qandeel-company/governance';
import { standardWorkOutcomeDefinition } from '@qandeel-company/mind';

import { AttentionStore, ImprovementStore, MemoryStore, ReviewStore, type EmployeeRecord } from '../src/index.js';
import { recordReviewDecision, settle } from '../src/runtime-authority.js';
import { storeContext } from '../src/store.js';
import { armFounderTestSurface, disarmFounderTestSurface } from '../src/testing/founder-seam.js';
import { GOVERNED_KIND, seed, type Seed } from './c2-helpers.js';
import { propose } from './c3-helpers.js';
import { activeReviewer, claimItem, placed, reviewPlan } from './c4-helpers.js';
import { backoff, harness, type Harness } from './helpers.js';

const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;
const reason = (r: string) => (e: unknown): boolean => isQandeelError(e) && e.details.reason === r;
const HOUR = 3_600_000;
const POOL = reviewPlan({ appliesTo: 'OUTPUT', operationalJudgment: 'REVIEW_POOL' });
const REVIEW_BUDGET = (POOL.reviewBudget as { money: number; tokens: number });
const judged = (verdict: OutcomeJudgment['verdict']): OutcomeJudgment => ({ verdict, evidenceClasses: ['REVIEW_DECISION', 'WORK_LINEAGE'] });

function withSeed(fn: (h: Harness, s: Seed, m: ImprovementStore) => void): void {
  const h = harness();
  try {
    const s = seed(h.store);
    const m = ImprovementStore.for(h.store);
    const d = m.registerDefinition(s.founder, standardWorkOutcomeDefinition());
    m.activateDefinition(s.founder, d.id, m.calibrateDefinition(s.founder, d.id).id);
    fn(h, s, m);
  } finally {
    h.close();
  }
}

/** Ordinary governed work the Founder prepared beforehand: a Work Item budget and a Review Plan, not yet released. */
function prepared(h: Harness, s: Seed, owner: EmployeeRecord, plan: Record<string, unknown> = POOL): Id {
  const { workItem } = h.store.createWorkItem({ objective: 'ordinary governed work', ownerRef: owner.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', dataClass: 'D1', instructions: 'x' } });
  s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 100_000, capTokens: 100_000, reasonCode: 'seed' });
  ReviewStore.for(h.store).declarePlan(s.founder, workItem.id, plan);
  return workItem.id;
}

/** The Employee executes inside its grant and budget (a fenced run), optionally reflecting on its own work. */
function execute(h: Harness, workItemId: Id, reflection?: string): Id | null {
  if (h.store.getWorkItem(workItemId).state === 'PROPOSED') h.store.transitionWorkItem(workItemId, { to: 'READY', reasonCode: 'release' });
  const claim = claimItem(h, workItemId, `w-${newId().slice(0, 8)}`);
  const observation = reflection ? ((propose(h, claim, 1, { kind: 'OBSERVATION', memoryClass: null, topic: 'drafting.figures', content: reflection }).decided?.resultLessonId ?? null) as Id | null) : null;
  settle(h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
  return observation;
}

/** One key of the open output review decides from the reviewer's own run, with (or without) its outcome judgment. */
function review(h: Harness, workItemId: Id, outcome: 'PASS' | 'FAIL' | 'UNCERTAIN', judgment: OutcomeJudgment | null = null, keyIndex = 0): ReturnType<typeof recordReviewDecision> {
  const rv = ReviewStore.for(h.store);
  const request = rv.requests({ workItemId }).find((r) => r.state === 'OPEN');
  const key = request ? rv.assignments(request.id).find((a) => a.keyKind === 'SPECIALIST' && a.state === 'ASSIGNED' && a.keyIndex === keyIndex) : undefined;
  assert.ok(key?.reviewWorkItemId, 'a qualified independent reviewer is assigned');
  const claim = claimItem(h, key.reviewWorkItemId, `w-${newId().slice(0, 8)}`);
  const out = recordReviewDecision(h.store, claim.fence, { outcome, reasonCode: 'rubric.applied', rationale: null, evidenceRefs: ['evidence:rubric'], outcomeJudgment: judgment });
  settle(h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
  return out;
}

/** The subject's pool judge decides from its own judgment Work Item (the same fenced review-decision path). */
function judge(h: Harness, m: ImprovementStore, subjectId: Id, outcome: 'PASS' | 'FAIL' | 'UNCERTAIN'): ReturnType<typeof recordReviewDecision> {
  const j = m.judgments({ subjectId, state: 'ASSIGNED' })[0];
  assert.ok(j, 'a pool judge is assigned');
  const claim = claimItem(h, j.judgeWorkItemId, `w-${newId().slice(0, 8)}`);
  const out = recordReviewDecision(h.store, claim.fence, { outcome, reasonCode: 'judgment.applied', rationale: null, evidenceRefs: ['evidence:attribution'] });
  settle(h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
  return out;
}

// Operational counters (uses, spend, reservations, calibration counts, versions, timestamps) are expected evidence
// of work; everything that is authority, money ceilings or policy is fingerprinted exactly.
const VOLATILE = /^(uses|reserved_|spent_|overrun_|calibration_|last_|consecutive_|circuit|version$|updated_at$)/;
const AUTHORITY_TABLES: Readonly<Record<string, string>> = {
  permission_grants: '1 = 1',
  authority_delegations: '1 = 1',
  approvals: '1 = 1',
  budgets: `scope IN ('COMPANY', 'DEPARTMENT', 'EMPLOYEE')`,
  route_policies: '1 = 1',
  model_providers: '1 = 1',
  models: '1 = 1',
  deployments: '1 = 1',
  price_cards: '1 = 1',
  tools: '1 = 1',
  tool_actions: '1 = 1',
  org_positions: '1 = 1',
  position_assignments: '1 = 1',
  certifications: '1 = 1',
  role_blueprints: '1 = 1',
  role_blueprint_entries: '1 = 1',
  reviewer_qualifications: '1 = 1',
  employees: '1 = 1',
};
function authorityFingerprint(h: Harness): Record<string, string[]> {
  const ctx = storeContext(h.store);
  return Object.fromEntries(
    Object.entries(AUTHORITY_TABLES).map(([t, where]) => [t, ctx.db.all(`SELECT * FROM ${t} WHERE ${where}`).map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !VOLATILE.test(k))))).sort()]),
  );
}
const maxRowid = (h: Harness, t: string): number => Number(storeContext(h.store).db.get<{ n: number | null }>(`SELECT MAX(rowid) AS n FROM ${t}`)?.n ?? 0);

describe('C6-R1: the ordinary judgment loop runs without the Founder and changes no authority or money', () => {
  test('C6-PROOF: Work → independent review → pool-verified outcome → evaluation → pool-validated attribution → pool-validated lesson → retraining → later evidence, with the Founder surface disarmed; the authority / spend fingerprint is unchanged', () => {
    withSeed((h, s, m) => {
      // --- Established beforehand by the Founder: a qualified reviewer, budgets, grants, plans. ---------------
      const { reviewer } = activeReviewer(h, s);
      const mem = MemoryStore.for(h.store);
      const w1 = prepared(h, s, s.employee);
      const later = [prepared(h, s, s.employee), prepared(h, s, s.employee)];
      const before = authorityFingerprint(h);
      const budgetsFrom = maxRowid(h, 'budgets');

      disarmFounderTestSurface(h.store.workspace.root);
      try {
        // Nothing below can reach the Founder: every Founder act fails closed.
        assert.throws(() => m.verifyOutcome(s.founder, w1, { verdict: 'ACHIEVED', evidenceClasses: ['REVIEW_DECISION'], evidenceRefs: [`work_item:${w1}`], reasonCode: 'x' }), code('FOUNDER_SURFACE_UNAVAILABLE'));

        // 1–4. Work inside the existing grant and budget; independent review; the keys verify the outcome.
        const observation = execute(h, w1, 'I believe I misread the brief and skipped sourcing the figures.');
        assert.ok(observation);
        assert.equal(review(h, w1, 'FAIL').outcome, 'RECORDED');
        execute(h, w1);
        assert.equal(review(h, w1, 'PASS', judged('NOT_ACHIEVED')).outcome, 'RECORDED');
        assert.equal(h.store.getWorkItem(w1).state, 'CLOSED', 'the pool-verified NOT_ACHIEVED closes the work');
        const v1 = storeContext(h.store).db.get<{ verifier_kind: string; verifier_ref: string; verdict: string; evidence_refs_json: string }>('SELECT verifier_kind, verifier_ref, verdict, evidence_refs_json FROM outcome_verifications WHERE work_item_id = ?', w1);
        assert.equal(v1?.verifier_kind, 'REVIEW_POOL');
        assert.match(String(v1?.verifier_ref), /^review_request:/);
        assert.ok((JSON.parse(String(v1?.evidence_refs_json)) as string[]).some((r) => r.startsWith('review_decision:')), 'the verification cites the independent review decisions');

        // 5–7. Evaluation (system) → an attribution proposal → one independent, qualified pool judge (never the subject).
        m.evaluate(w1);
        const proposal = m.attributions({ workItemId: w1 })[0];
        assert.equal(proposal?.state, 'PROPOSED');
        assert.equal(proposal?.overall, 'EMPLOYEE_JUDGMENT');
        const [aj] = m.judgments({ subjectId: proposal?.id as Id });
        assert.equal(aj?.judgeEmployeeId, reviewer.id);
        // The reflection goes up for review before its cause is judged: no judge is spent on a hypothesis whose
        // independent evidence has not arrived — it waits (not escalated) and is drawn once the cause is validated.
        assert.equal(m.classifyObservation(observation, 'MISTAKE_LESSON').source, 'REFLECTION');
        const lr = m.requestLearningReview(observation);
        assert.equal(lr.changed, true);
        assert.equal(lr.judgmentId, null, 'evidence pending: no lesson judge yet');
        assert.deepEqual([mem.lesson(lr.lessonId).stage, mem.lesson(lr.lessonId).reviewPath], ['UNDER_REVIEW', 'INDEPENDENT_REVIEW']);
        assert.notEqual(aj?.judgeEmployeeId, s.employee.id, 'the subject never judges its own cause');
        // The judge's governed Work Item consumes only the plan's pre-authorized review budget, carved from its own envelope.
        const jb = storeContext(h.store).db.get<{ cap_money: number; cap_tokens: number; parent: string }>(`SELECT b.cap_money, b.cap_tokens, p.scope || ':' || p.scope_id AS parent FROM budgets b JOIN budgets p ON p.id = b.parent_id WHERE b.scope = 'WORK_ITEM' AND b.scope_id = ?`, aj?.judgeWorkItemId as Id);
        assert.deepEqual([jb?.cap_money, jb?.cap_tokens, jb?.parent], [REVIEW_BUDGET.money, REVIEW_BUDGET.tokens, `EMPLOYEE:${reviewer.id}`]);
        assert.equal(judge(h, m, proposal?.id as Id, 'PASS').code, 'RECORDED');
        const validated = m.attributions({ workItemId: w1 })[0];
        assert.deepEqual([validated?.state, validated?.decidedByRef], ['VALIDATED', `employee:${reviewer.id}`]);

        // 8. The validated cause wakes the waiting lesson: an independent pool judge validates it.
        assert.equal(m.judgments({ subjectId: lr.lessonId, state: 'ASSIGNED' }).length, 1, 'the evidence arrived: the lesson gets its judge');
        assert.equal(m.requestLearningReview(observation).changed, false, 'idempotent per observation');
        assert.notEqual(m.judgments({ subjectId: lr.lessonId })[0]?.judgeEmployeeId, s.employee.id, 'the maker never validates its own lesson');
        assert.equal(judge(h, m, lr.lessonId, 'PASS').code, 'RECORDED');
        const lesson = mem.lesson(lr.lessonId);
        assert.deepEqual([lesson.stage, lesson.reviewPath, lesson.decidedByRef], ['VALIDATED', 'INDEPENDENT_REVIEW', `employee:${reviewer.id}`]);
        // Validation never widens a lesson's force: Company-wide sharing stays separately governed.
        assert.equal(mem.requestPromotion('system:learning', lesson.id, 'COMPANY').state, 'PENDING_REVIEW');
        assert.equal(mem.requestPromotion('system:learning', lesson.id, 'PERSONAL').state, 'APPROVED', 'the lesson is delivered to its own Employee');

        // 9. Ordinary retraining inside the existing envelope; training completed is not improvement.
        const planned = m.planReviewedIntervention(lesson.id, 'TARGETED_RETRAINING');
        assert.equal(planned.outcome, 'PLANNED');
        assert.equal(planned.intervention?.remediationId, null);
        h.clock.advance(HOUR);
        assert.equal(m.completeReviewedTraining(planned.intervention?.id as Id).state, 'TRAINING_COMPLETED');
        assert.equal(m.assessIntervention(planned.intervention?.id as Id).intervention.effect, 'NOT_YET_TESTED');

        // 10. Later comparable work, reviewed and pool-verified, proves the effect.
        for (const id of later) {
          h.clock.advance(HOUR);
          execute(h, id);
          review(h, id, 'PASS', judged('ACHIEVED'));
          assert.equal(h.store.getWorkItem(id).state, 'OUTCOME_VERIFIED');
          assert.equal(m.evaluate(id).evaluation.qualifiedOutcome, true, 'a pool-verified ACHIEVED is a qualified outcome');
        }
        assert.equal(m.assessIntervention(planned.intervention?.id as Id).intervention.effect, 'IMPROVEMENT_OBSERVED');
      } finally {
        armFounderTestSurface(h.store.workspace.root);
      }

      // 11–17. Safety fingerprint: grants, budget caps, approvals, route / model / tool policy, seats, certifications,
      // qualifications and Employees are exactly as before. New budgets are only per-work allocations under an envelope.
      assert.deepEqual(authorityFingerprint(h), before);
      const created = storeContext(h.store).db.all<{ scope: string; cap_money: number; parent_scope: string | null }>('SELECT b.scope, b.cap_money, p.scope AS parent_scope FROM budgets b LEFT JOIN budgets p ON p.id = b.parent_id WHERE b.rowid > ?', budgetsFrom);
      assert.ok(created.length > 0);
      for (const b of created) {
        assert.ok(b.scope === 'WORK_ITEM' || b.scope === 'RUN', `only per-work allocations are created (saw ${b.scope})`);
        if (b.scope === 'WORK_ITEM') assert.deepEqual([b.parent_scope, b.cap_money <= REVIEW_BUDGET.money], ['EMPLOYEE', true], 'a review / judgment Work Item is funded within the pre-authorized review budget');
      }
      // Nobody but the Founder ever holds a grant or an approval decision (datastore).
      assert.equal(storeContext(h.store).db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM permission_grants WHERE granted_by_ref NOT GLOB 'founder:*'`)?.n, 0);
      assert.equal(storeContext(h.store).db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM approvals WHERE decided_by_ref IS NOT NULL AND decided_by_ref NOT GLOB 'founder:*'`)?.n, 0);
    });
  });
});

describe('C6-R1: judgment is scoped by plan, risk, qualification and independence', () => {
  test('a plan that keeps Founder judgment keeps it: review keys verify nothing, no pool judge is drawn, learning waits for the Founder', () => {
    withSeed((h, s, m) => {
      activeReviewer(h, s);
      assert.throws(() => ReviewStore.for(h.store).declarePlan(s.founder, prepared(h, s, s.employee, reviewPlan({ appliesTo: 'OUTPUT' })), { ...POOL, keys: [{ kind: 'SPECIALIST' }, { kind: 'FOUNDER' }] }), reason('FOUNDER_KEY_RESERVES_JUDGMENT'));
      const w = prepared(h, s, s.employee, reviewPlan({ appliesTo: 'OUTPUT' }));
      const observation = execute(h, w, 'I think I rushed the figures.');
      review(h, w, 'PASS', judged('NOT_ACHIEVED'));
      assert.equal(h.store.getWorkItem(w).state, 'REVIEWED', 'a FOUNDER plan: the keys\' outcome judgment is not a verification');
      assert.equal(storeContext(h.store).db.get<{ n: number }>('SELECT COUNT(*) AS n FROM outcome_verifications WHERE work_item_id = ?', w)?.n, 0);
      m.verifyOutcome(s.founder, w, { verdict: 'NOT_ACHIEVED', evidenceClasses: ['REVIEW_DECISION'], evidenceRefs: [`work_item:${w}`], reasonCode: 'founder.verified' });
      m.evaluate(w);
      assert.equal(m.attributions({ workItemId: w })[0]?.state, 'PROPOSED');
      assert.deepEqual(m.judgments({ workItemId: w }), [], 'no pool judge where the plan keeps Founder judgment');
      m.classifyObservation(observation as Id, 'MISTAKE_LESSON');
      assert.throws(() => m.requestLearningReview(observation as Id), reason('FOUNDER_JUDGMENT'));
    });
  });

  test('the executor and subject never judge; a title never qualifies; nobody forges a judge, a verifier or an R4 judgment (datastore)', () => {
    withSeed((h, s, m) => {
      const { reviewer, qualification } = activeReviewer(h, s);
      const { reviewer: second } = activeReviewer(h, s);
      // The reviewer executes: the other qualified reviewer reviews it and judges its cause — never itself.
      const w = prepared(h, s, reviewer);
      execute(h, w);
      review(h, w, 'PASS', judged('NOT_ACHIEVED'));
      // While the only other qualified reviewer is held, the executor — the sole remaining pool member — is never drawn.
      const hold = ReviewStore.for(h.store).placeQualityHold(s.founder, { targetKind: 'REVIEWER', targetRef: second.ref, reasonCode: 'reviewer.drift' });
      m.evaluate(w);
      const a = m.attributions({ workItemId: w })[0];
      assert.deepEqual([a?.state, a?.employeeId], ['PROPOSED', reviewer.id]);
      assert.deepEqual(m.judgments({ subjectId: a?.id as Id }), [], 'no independent judge available: the cause waits (the Founder can always decide it)');
      // Capacity returns: the waiting subject gets its independent judge (no polling — the pool refill draws it).
      ReviewStore.for(h.store).liftQualityHold(s.founder, hold.id, 'reviewer.recalibrated');
      assert.equal(m.judgments({ subjectId: a?.id as Id })[0]?.judgeEmployeeId, second.id);
      // A Director seat with every budget and grant is still no judge without Review Pool qualification (Title ≠ Authority).
      const director = placed(h, s, 'director.growth');
      const ctx = storeContext(h.store);
      const plan = ReviewStore.for(h.store).plan(w);
      // R2-32: the judge's own Work Item is created BEFORE the forged insert's transaction (a nested transaction
      // would be refused first and satisfy the assertion vacuously), and each refusal must be the trigger's own.
      const refusedBy = (message: RegExp) => (e: unknown): boolean => isQandeelError(e, 'STORAGE_INVARIANT') && message.test(String((e as Error).cause));
      const judgeRefused = refusedBy(/independent, qualified pool reviewer/);
      const insertJudgment = (judgeId: Id, qualificationId: Id, workItemId: Id, subjectId: Id, planId: Id = plan?.id as Id): unknown => {
        const judgeWork = h.store.createWorkItem({ objective: 'forged judgment', ownerRef: `employee:${judgeId}`, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', instructions: 'x' } }).workItem.id;
        return ctx.db.immediate('forge judgment', () =>
          ctx.db.run(
            `INSERT INTO judgment_assignments (id, subject_kind, subject_id, work_item_id, plan_id, judge_employee_id, qualification_id, judge_work_item_id, state, evidence_refs_json, version, created_at, updated_at) VALUES (?, 'ATTRIBUTION', ?, ?, ?, ?, ?, ?, 'ASSIGNED', '[]', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
            newId(), subjectId, workItemId, planId, judgeId, qualificationId, judgeWork,
          ),
        );
      };
      assert.throws(() => insertJudgment(director.id, qualification.id, w, a?.id as Id), judgeRefused, 'a title with no qualification never judges');
      assert.throws(() => insertJudgment(reviewer.id, qualification.id, w, a?.id as Id), judgeRefused, 'the executor / subject never judges');
      // An Employee's name on a decided cause or lesson is exactly an assigned judge's.
      assert.throws(() => ctx.db.immediate('forge decision', () => ctx.db.run(`UPDATE causal_attributions SET state = 'VALIDATED', decided_by_ref = ?, reason_code = 'x', version = version + 1 WHERE id = ?`, `employee:${director.id}`, a?.id as Id)), refusedBy(/decided by the Founder or by its assigned pool judge/));
      // A pool verification without a satisfied, pool-delegated review is refused.
      const other = prepared(h, s, s.employee, reviewPlan({ appliesTo: 'OUTPUT' }));
      execute(h, other);
      review(h, other, 'PASS');
      const req = ReviewStore.for(h.store).requests({ workItemId: other }).find((r) => r.state === 'SATISFIED');
      assert.throws(
        () => ctx.db.immediate('forge verification', () => ctx.db.run(`INSERT INTO outcome_verifications (id, work_item_id, verdict, evidence_classes_json, evidence_refs_json, verifier_kind, verifier_ref, review_request_id, reason_code, created_at) VALUES (?, ?, 'ACHIEVED', '["REVIEW_DECISION"]', '["work_item:x"]', 'REVIEW_POOL', ?, ?, 'forged', '2026-01-01T00:00:00.000Z')`, newId(), other, `review_request:${req?.id}`, req?.id as Id)),
        refusedBy(/pool verification rests on a satisfied review/),
      );
      // R4 is Founder-only: no pool judge on R4 work, whatever its plan says.
      const r4 = h.store.createWorkItem({ objective: 'r4 work', ownerRef: s.employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', instructions: 'x' }, riskLevel: 'R4' }).workItem.id;
      ReviewStore.for(h.store).declarePlan(s.founder, r4, POOL);
      const r4Attribution = newId();
      ctx.db.immediate('seed r4 attribution', () => ctx.db.run(`INSERT INTO causal_attributions (id, work_item_id, evaluation_id, employee_id, comparable_key, overall, causes_json, employee_accountable, confidence, source, state, proposed_by_ref, decided_by_ref, reason_code, evidence_refs_json, version, created_at, updated_at) VALUES (?, ?, NULL, ?, 'draft.memo', 'EMPLOYEE_JUDGMENT', '[]', 1, 'LOW', 'EVALUATOR_PROPOSAL', 'PROPOSED', 'system:evaluator', NULL, NULL, '[]', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`, r4Attribution, r4, s.employee.id));
      assert.throws(() => insertJudgment(reviewer.id, qualification.id, r4, r4Attribution, ReviewStore.for(h.store).plan(r4)?.id as Id), judgeRefused, 'R4 is never judged by the pool');
    });
  });
});

describe('C6-R1: never averaged — insufficient evidence stays inconclusive, uncertainty reaches the Founder', () => {
  test('keys that disagree are recorded INCONCLUSIVE (never averaged) and reach the Founder; keys without a judgment verify nothing; an external outcome is refused', () => {
    withSeed((h, s, m) => {
      activeReviewer(h, s);
      activeReviewer(h, s);
      const two = { ...POOL, keys: [{ kind: 'SPECIALIST' }, { kind: 'SPECIALIST' }] };
      const w = prepared(h, s, s.employee, two);
      execute(h, w);
      // Within one reviewer run: an external outcome is refused (unavailable until C7), then the cited judgment counts.
      const rv = ReviewStore.for(h.store);
      const request = rv.requests({ workItemId: w }).find((r) => r.state === 'OPEN');
      const key0 = request ? rv.assignments(request.id).find((a) => a.keyKind === 'SPECIALIST' && a.keyIndex === 0 && a.state === 'ASSIGNED') : undefined;
      const run = claimItem(h, key0?.reviewWorkItemId as Id, 'w-key0');
      assert.equal(recordReviewDecision(h.store, run.fence, { outcome: 'PASS', reasonCode: 'rubric.applied', rationale: null, evidenceRefs: [], outcomeJudgment: { verdict: 'ACHIEVED', evidenceClasses: ['EXTERNAL_OUTCOME'] } }).code, 'OUTCOME_EVIDENCE_INVALID');
      assert.equal(recordReviewDecision(h.store, run.fence, { outcome: 'PASS', reasonCode: 'rubric.applied', rationale: null, evidenceRefs: [], outcomeJudgment: judged('ACHIEVED') }).outcome, 'RECORDED');
      settle(h.store, run.fence, { type: 'COMPLETED' }, { backoff });
      review(h, w, 'PASS', judged('NOT_ACHIEVED'), 1);
      assert.equal(h.store.getWorkItem(w).state, 'REVIEWED');
      const v = storeContext(h.store).db.get<{ verdict: string; reason_code: string }>('SELECT verdict, reason_code FROM outcome_verifications WHERE work_item_id = ?', w);
      assert.deepEqual([v?.verdict, v?.reason_code], ['INCONCLUSIVE', 'review_keys.outcome_conflict']);
      AttentionStore.for(h.store).sync();
      assert.ok(AttentionStore.for(h.store).list().some((i) => i.sourceRef === `work_item:${w}`), 'the disagreement reaches the Founder');
      // The Founder is the exception authority.
      assert.equal(m.verifyOutcome(s.founder, w, { verdict: 'ACHIEVED', evidenceClasses: ['REVIEW_DECISION'], evidenceRefs: [`work_item:${w}`], reasonCode: 'founder.resolved' }).state, 'OUTCOME_VERIFIED');
      AttentionStore.for(h.store).sync();
      assert.ok(!AttentionStore.for(h.store).list().some((i) => i.sourceRef === `work_item:${w}`));

      const silent = prepared(h, s, s.employee);
      execute(h, silent);
      review(h, silent, 'PASS');
      assert.equal(h.store.getWorkItem(silent).state, 'REVIEWED', 'a passed review without an outcome judgment is not a verified outcome');
      assert.equal(storeContext(h.store).db.get<{ n: number }>('SELECT COUNT(*) AS n FROM outcome_verifications WHERE work_item_id = ?', silent)?.n, 0);
    });
  });

  test('a pool judge\'s uncertainty escalates to the Founder (never re-drawn, never guessed); an ineligible judge is refused at the decision boundary', () => {
    withSeed((h, s, m) => {
      const { reviewer } = activeReviewer(h, s);
      const w = prepared(h, s, s.employee);
      execute(h, w);
      review(h, w, 'FAIL');
      execute(h, w);
      review(h, w, 'PASS', judged('NOT_ACHIEVED'));
      m.evaluate(w);
      const a = m.attributions({ workItemId: w })[0] as { id: Id };
      assert.equal(judge(h, m, a.id, 'UNCERTAIN').code, 'ESCALATED');
      assert.equal(m.attributions({ workItemId: w })[0]?.state, 'PROPOSED', 'uncertainty decides nothing');
      assert.equal(m.judgments({ subjectId: a.id })[0]?.state, 'ESCALATED');
      AttentionStore.for(h.store).sync();
      assert.ok(AttentionStore.for(h.store).list().some((i) => i.sourceRef.startsWith('judgment_assignment:')), 'the escalation reaches the Founder');
      m.evaluate(w);
      assert.equal(m.judgments({ subjectId: a.id }).length, 1, 'an escalated judgment is not re-drawn');
      assert.equal(m.decideAttribution(s.founder, a.id, { decision: 'VALIDATE', reasonCode: 'founder.decided' }).attribution.state, 'VALIDATED');

      // Eligibility is re-checked when the judge decides: a Quality Hold on the judge refuses the decision.
      const w2 = prepared(h, s, s.employee);
      execute(h, w2);
      review(h, w2, 'FAIL');
      execute(h, w2);
      review(h, w2, 'PASS', judged('NOT_ACHIEVED'));
      m.evaluate(w2);
      const a2 = m.attributions({ workItemId: w2 }).find((x) => x.state === 'PROPOSED') as { id: Id };
      const hold = ReviewStore.for(h.store).placeQualityHold(s.founder, { targetKind: 'REVIEWER', targetRef: reviewer.ref, reasonCode: 'reviewer.drift' });
      assert.equal(judge(h, m, a2.id, 'PASS').code, 'REVIEWER_NOT_ELIGIBLE');
      assert.equal(m.attributions({ workItemId: w2 }).find((x) => x.id === a2.id)?.state, 'PROPOSED');
      ReviewStore.for(h.store).liftQualityHold(s.founder, hold.id, 'reviewer.recalibrated');
    });
  });
});

describe('R2 K1: pool judges — one eligibility predicate, gated lesson draws, release on every end path', () => {
  /** A PROPOSED attribution of a failed-then-passed Work Item, with its pool judge drawn. */
  function proposedAttribution(h: Harness, s: Seed, m: ImprovementStore): Id {
    const w = prepared(h, s, s.employee);
    execute(h, w);
    review(h, w, 'FAIL');
    execute(h, w);
    review(h, w, 'PASS', judged('NOT_ACHIEVED'));
    m.evaluate(w);
    return (m.attributions({ workItemId: w }).find((x) => x.state === 'PROPOSED') as { id: Id }).id;
  }

  test('R2-09: no lesson judge is drawn (or funded) before the lesson\'s independent evidence exists — not by the refill / recovery sweep either', () => {
    withSeed((h, s, m) => {
      activeReviewer(h, s);
      const w = prepared(h, s, s.employee);
      const obs = execute(h, w, 'I believe I misread the brief.') as Id;
      m.classifyObservation(obs, 'MISTAKE_LESSON');
      const lr = m.requestLearningReview(obs);
      assert.equal(lr.judgmentId, null, 'evidence pending: no judge');
      for (let i = 0; i < 3; i++) ReviewStore.for(h.store).sweep(100);
      assert.equal(m.judgments({ subjectId: lr.lessonId }).length, 0, 'the sweep never draws around the evidence gate');
    });
  });

  test('R2-08 / m-15: a RUBRIC hold refuses the judge at the decision boundary; a suspended qualification withdraws its open judgments', () => {
    withSeed((h, s, m) => {
      const { qualification } = activeReviewer(h, s);
      const rv = ReviewStore.for(h.store);
      const a1 = proposedAttribution(h, s, m);
      const hold = rv.placeQualityHold(s.founder, { targetKind: 'RUBRIC', targetRef: 'quality.rubric@1', reasonCode: 'rubric.suspect' });
      assert.equal(judge(h, m, a1, 'PASS').code, 'REVIEWER_NOT_ELIGIBLE');
      assert.equal(m.attributions().find((x) => x.id === a1)?.state, 'PROPOSED', 'nothing is validated under a held rubric');
      rv.liftQualityHold(s.founder, hold.id, 'rubric.fixed');
      const open = m.judgments({ subjectId: a1, state: 'ASSIGNED' })[0];
      assert.ok(open, 'the hold lifted, the (transiently withdrawn) judge is drawn again');
      rv.suspendReviewer(s.founder, qualification.id, 'reviewer.drift');
      assert.equal(m.judgments({ subjectId: a1 }).find((j) => j.id === open.id)?.state, 'WITHDRAWN', 'the qualification ends: so do its open judgments');
    });
  });

  test('m-11: a judge Work Item that ends FAILED releases its judgment in the same transaction', () => {
    withSeed((h, s, m) => {
      activeReviewer(h, s);
      const a1 = proposedAttribution(h, s, m);
      const j = m.judgments({ subjectId: a1, state: 'ASSIGNED' })[0];
      const claim = claimItem(h, j?.judgeWorkItemId as Id, `w-${newId().slice(0, 8)}`);
      settle(h.store, claim.fence, { type: 'PERMANENT_FAILURE', code: 'PROVIDER_REFUSED' }, { backoff });
      assert.equal(m.judgments({ subjectId: a1 }).find((x) => x.id === j?.id)?.state, 'WITHDRAWN', 'never left ASSIGNED until a restart');
    });
  });
});
