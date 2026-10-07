/**
 * D-L1-44 (D-L1-36) — Employee Reasoning Control at the store boundary: the persistent profile and the one-task override
 * are Founder acts of the governed preview → fingerprint → confirm boundary; a profile change is version-safe, recorded
 * in Employee history and audit, and marks VALID certifications REVIEW_DUE (Stage 6 §14); an override belongs to exactly
 * one not-yet-run Work Item, never exceeds the ceiling, never touches the profile, and cannot be bypassed downward at
 * reservation. Reasoning grants nothing.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ManualClock, isQandeelError, type Id } from '@qandeel-company/domain';

import { AcademyStore, FounderActionStore, FounderAuthStore, GovernanceStore, loadReleasedMigrations, type EmployeeRecord } from '../src/index.js';
import { reserveBudget } from '../src/runtime-authority.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { GOVERNED_KIND, seed, testManifest, type Seed } from './c2-helpers.js';
import { academyWorld, certify, claimFor } from './c3-helpers.js';
import { harness, removeRoot, tempRoot, type Harness } from './helpers.js';

function withSeed(fn: (h: Harness, s: Seed, actions: FounderActionStore, sess: ReturnType<FounderAuthStore['redeemLaunchToken']>['session']) => void): void {
  const h = harness();
  try {
    const s = seed(h.store);
    const auth = FounderAuthStore.for(h.store);
    const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
    fn(h, s, FounderActionStore.for(h.store, auth), session);
  } finally {
    h.close();
  }
}

/** A governed Work Item that has not been released yet (PROPOSED, budgeted): an override can still be set on it. */
function pending(h: Harness, s: Seed, employee: EmployeeRecord = s.employee, input: Record<string, unknown> = {}): Id {
  const { workItem } = h.store.createWorkItem({ objective: 'reasoning control work', ownerRef: employee.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', dataClass: 'D1', instructions: 'x', ...input } });
  s.gov.createBudget(s.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 100_000, capTokens: 100_000, reasonCode: 'seed' });
  return workItem.id;
}
const release = (h: Harness, id: Id): void => void h.store.transitionWorkItem(id, { to: 'READY', reasonCode: 'release' });

const refusedWith = (reason: string) => (e: unknown): boolean => isQandeelError(e) && e.details.reason === reason;
const grantsOf = (s: Seed, id: Id): string => JSON.stringify(s.gov.grants(id).map((g) => [g.capability, g.resourceScope, g.riskCeiling, g.dataClassCeiling, g.status]));
const auditOf = (h: Harness, action: string): { actor_ref: string; reason_code: string; details_json: string }[] =>
  storeContext(h.store).db.all(`SELECT actor_ref, reason_code, details_json FROM audit_events WHERE action = ? ORDER BY rowid`, action);

/** A second, more expensive E2 deployment for the seed's draft.memo route (the seed provisions only E1). */
function e2Deployment(s: Seed): { id: Id; cardId: Id } {
  const modelId = s.gov.deployment(s.deploymentId).modelId;
  const d = s.gov.registerDeployment(s.founder, { code: 'local-e2', modelId, pinnedRevision: 'r1', reasoningClass: 'E2', contextWindowTokens: 100_000, maxOutputTokens: 4_096, taskClasses: ['draft.memo'] });
  const card = s.gov.addPriceCard(s.founder, d.id, { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: 6_000_000, billedOutputPerMTok: 24_000_000, billedPerCall: 0, economicInputPerMTok: 6_000_000, economicOutputPerMTok: 24_000_000, economicPerCall: 0 });
  for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED'] as const) s.gov.setQualification(s.founder, d.id, q, 'qualification.step');
  s.gov.approveEgress(s.founder, d.id, 'D3', 'egress.approved');
  return { id: d.id, cardId: card.id };
}

describe('D-L1-44: the persistent reasoning profile is a governed Founder act', () => {
  test('EMPLOYEE_REASONING_PROFILE: the preview shows previous/new default and ceiling and changes nothing; the confirm writes the profile version-safely with history and audit; grants and budget are untouched', () => {
    withSeed((h, s, actions, sess) => {
      const before = s.gov.getEmployee(s.employee.id);
      assert.deepEqual(before.cognitiveProfile, { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' });
      const grants = grantsOf(s, before.id);
      const budget = s.gov.budgetFor('EMPLOYEE', before.id);
      const p = actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: before.id, defaultClass: 'E2', ceilingClass: 'E4', reasonCode: 'founder.deeper' });
      assert.deepEqual(
        [p.payload.employeeId, p.payload.previousDefault, p.payload.newDefault, p.payload.previousCeiling, p.payload.newCeiling, p.payload.costDiscipline, p.payload.costDisciplineChange, p.payload.reasonCode, p.payload.authorityChange, p.payload.budgetChange, p.payload.providerCall],
        [before.id, 'E1', 'E2', 'E2', 'E4', 'BALANCED', 'UNCHANGED', 'founder.deeper', 'NONE', 'NONE', 'NONE'],
      );
      assert.equal(p.payload.name, `${before.name.given} ${before.name.family}`);
      assert.deepEqual(s.gov.getEmployee(before.id).cognitiveProfile, before.cognitiveProfile, 'a preview changes nothing');
      actions.confirm(sess, p.id, p.fingerprint);
      const after = s.gov.getEmployee(before.id);
      assert.deepEqual(after.cognitiveProfile, { defaultClass: 'E2', ceilingClass: 'E4', costDiscipline: 'BALANCED' });
      assert.equal(after.version, before.version + 1);
      assert.equal(after.state, before.state, 'reasoning is not a lifecycle step');
      const hist = s.gov.employeeHistory(before.id).filter((x) => x.changeKind === 'PROFILE');
      assert.equal(hist.length, 1);
      assert.deepEqual([hist[0]?.fromState, hist[0]?.toState, hist[0]?.reasonCode, hist[0]?.actorRef], ['E1/E2', 'E2/E4', 'founder.deeper', s.founder]);
      const audit = auditOf(h, 'employee.reasoning_profile_changed');
      assert.equal(audit.length, 1);
      assert.equal(audit[0]?.actor_ref, s.founder, 'attributable to the Founder');
      assert.deepEqual(JSON.parse(audit[0]?.details_json ?? '{}'), { from: 'E1/E2', to: 'E2/E4', certificationsReviewDue: 0 }, 'content-free: classes and counts only');
      assert.equal(grantsOf(s, before.id), grants, 'Reasoning ≠ Authority: grants unchanged');
      assert.deepEqual(s.gov.budgetFor('EMPLOYEE', before.id), budget, 'no budget change');
      // Lowering again is the same governed act (E2 → E1 default, E4 → E2 ceiling).
      const down = actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: before.id, defaultClass: 'E1', ceilingClass: 'E2' });
      actions.confirm(sess, down.id, down.fingerprint);
      assert.deepEqual(s.gov.getEmployee(before.id).cognitiveProfile, { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' });
    });
  });

  test('invalid profiles are refused at preview: ceiling below default, E0, an unknown class, a cost-discipline change, no change; a stale preview is refused at confirm (version-safe)', () => {
    withSeed((h, s, actions, sess) => {
      const id = s.employee.id;
      assert.throws(() => actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: id, defaultClass: 'E3', ceilingClass: 'E2' }), refusedWith('CEILING_BELOW_DEFAULT'));
      assert.throws(() => actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: id, defaultClass: 'E3' }), refusedWith('CEILING_BELOW_DEFAULT'), 'the default alone may not pass the standing ceiling');
      assert.throws(() => actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: id, defaultClass: 'E0' }), refusedWith('REASONING_CLASS'));
      assert.throws(() => actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: id, ceilingClass: 'E9' }), refusedWith('REASONING_CLASS'));
      assert.throws(() => actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: id, ceilingClass: 'E3', costDiscipline: 'THOROUGH' }), refusedWith('COST_DISCIPLINE_UNCHANGED'));
      assert.throws(() => actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: id, defaultClass: 'E1', ceilingClass: 'E2' }), refusedWith('PROFILE_UNCHANGED'));
      const stale = actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: id, ceilingClass: 'E3' });
      const other = actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: id, ceilingClass: 'E4' });
      actions.confirm(sess, other.id, other.fingerprint);
      assert.throws(() => actions.confirm(sess, stale.id, stale.fingerprint), (e) => isQandeelError(e, 'VERSION_CONFLICT'), 'a preview of an older version never overwrites a newer profile');
      assert.equal(s.gov.getEmployee(id).cognitiveProfile.ceilingClass, 'E4');
    });
  });

  test('an Employee can never change its own reasoning profile or set an override: the Founder-authority write refuses a non-Founder actor', () => {
    withSeed((h, s) => {
      assert.throws(() => s.gov.changeReasoningProfile(s.employee.ref, s.employee.id, { defaultClass: 'E2', ceilingClass: 'E4', expectedVersion: s.employee.version, reasonCode: 'self' }), (e) => isQandeelError(e) && ['SELF_ESCALATION_REFUSED', 'FOUNDER_ONLY'].includes(e.code));
      const wi = pending(h, s);
      assert.throws(() => s.gov.setWorkItemReasoningOverride(s.employee.ref, wi, { reasoningClass: 'E2', reasonCode: 'self' }), (e) => isQandeelError(e) && ['SELF_ESCALATION_REFUSED', 'FOUNDER_ONLY'].includes(e.code));
      assert.deepEqual(s.gov.getEmployee(s.employee.id).cognitiveProfile.ceilingClass, 'E2');
      assert.equal(s.gov.reasoningControl(s.employee.id).overrides.length, 0);
    });
  });

  test('certification safety: a real profile change marks the Employee\'s VALID certification REVIEW_DUE through the canonical mechanism (the preview names it); the Employee state is unchanged', () => {
    withSeed((h, s, actions, sess) => {
      const w = academyWorld(h, s);
      const { certificationId } = certify(h, s, s.employee, w);
      const academy = AcademyStore.for(h.store);
      assert.equal(academy.certifications(s.employee.id).find((c) => c.id === certificationId)?.status, 'VALID');
      const state = s.gov.getEmployee(s.employee.id).state;
      const p = actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: s.employee.id, ceilingClass: 'E3' });
      assert.deepEqual(p.payload.certificationsReviewDue, [certificationId], 'the consequence is visible before the confirm');
      assert.equal(academy.certifications(s.employee.id).find((c) => c.id === certificationId)?.status, 'VALID', 'a preview changes nothing');
      actions.confirm(sess, p.id, p.fingerprint);
      const cert = academy.certifications(s.employee.id).find((c) => c.id === certificationId);
      assert.equal(cert?.status, 'REVIEW_DUE');
      assert.equal(cert?.reasonCode, 'REASONING_PROFILE_CHANGED');
      assert.equal(s.gov.getEmployee(s.employee.id).state, state, 'REVIEW_DUE never demotes');
      assert.equal(auditOf(h, 'certification.review_due').length, 1);
    });
  });
});

describe('D-L1-44: the one-task reasoning override', () => {
  test('WORK_ITEM_REASONING_OVERRIDE: the preview shows Work Item, Employee, standing default and ceiling, requested and effective class; the confirm records one durable row; the persistent profile is untouched', () => {
    withSeed((h, s, actions, sess) => {
      const wi = pending(h, s);
      const grants = grantsOf(s, s.employee.id);
      const p = actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: wi, reasoningClass: 'E2' });
      assert.deepEqual(
        [p.payload.workItemId, p.payload.employeeId, p.payload.employeeDefault, p.payload.employeeCeiling, p.payload.requestedClass, p.payload.effectiveClass, p.payload.routePolicyMaxClass, p.payload.scope, p.payload.persistentProfileChange, p.payload.authorityChange, p.payload.budgetChange],
        [wi, s.employee.id, 'E1', 'E2', 'E2', 'E2', 'E2', 'THIS_WORK_ITEM_ONLY', 'NONE', 'NONE', 'NONE'],
      );
      assert.equal(p.payload.deploymentAvailable, false, 'the seed has no E2 deployment: stated, not hidden');
      assert.equal(s.gov.reasoningControl(s.employee.id).overrides.length, 0, 'a preview records nothing');
      const out = actions.confirm(sess, p.id, p.fingerprint);
      assert.equal(out.resultRef, `work_item:${wi}`);
      const view = s.gov.reasoningControl(s.employee.id);
      assert.deepEqual(view.overrides.map((o) => [o.workItemId, o.reasoningClass, o.setByRef]), [[wi, 'E2', s.founder]]);
      assert.deepEqual([view.defaultClass, view.ceilingClass, view.costDiscipline], ['E1', 'E2', 'BALANCED'], 'the persistent profile is unchanged');
      assert.equal(s.gov.getEmployee(s.employee.id).version, s.employee.version, 'the Employee row is not written at all');
      assert.equal(grantsOf(s, s.employee.id), grants);
      const audit = auditOf(h, 'work_item.reasoning_override_set');
      assert.equal(audit.length, 1);
      assert.equal(audit[0]?.actor_ref, s.founder);
      assert.deepEqual(JSON.parse(audit[0]?.details_json ?? '{}'), { employeeId: s.employee.id, reasoningClass: 'E2', standingDefault: 'E1', standingCeiling: 'E2' });
      assert.throws(() => actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: wi, reasoningClass: 'E1' }), refusedWith('OVERRIDE_EXISTS'), 'one override per Work Item');
      // The datastore keeps the row immutable.
      const db = storeContext(h.store).db;
      assert.throws(() => db.immediate('t', () => db.run(`UPDATE work_item_reasoning_overrides SET reasoning_class = 'E1' WHERE work_item_id = ?`, wi)));
      assert.throws(() => db.immediate('t', () => db.run('DELETE FROM work_item_reasoning_overrides WHERE work_item_id = ?', wi)));
    });
  });

  test('ceiling protection: an override above the Employee ceiling is refused before anything runs (raise the ceiling first, explicitly); E0, a started Work Item, a pinned class and non-Employee work are refused', () => {
    withSeed((h, s, actions, sess) => {
      const wi = pending(h, s);
      assert.throws(() => actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: wi, reasoningClass: 'E3' }), refusedWith('ABOVE_EMPLOYEE_CEILING'));
      assert.throws(() => actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: wi, reasoningClass: 'E0' }), refusedWith('REASONING_CLASS'));
      // The datastore refuses an override above the recorded ceiling even if a caller skipped the store's own check.
      const db = storeContext(h.store).db;
      assert.throws(() => db.immediate('t', () => db.run(`INSERT INTO work_item_reasoning_overrides (work_item_id, employee_id, reasoning_class, standing_default, standing_ceiling, set_by_ref, reason_code, created_at) VALUES (?, ?, 'E3', 'E1', 'E2', ?, 'x', ?)`, wi, s.employee.id, s.founder, h.store.now())));
      const pinned = pending(h, s, s.employee, { reasoningClass: 'E1' });
      assert.throws(() => actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: pinned, reasoningClass: 'E2' }), refusedWith('CLASS_PINNED_BY_WORK_ITEM'));
      const started = pending(h, s);
      release(h, started);
      assert.ok(claimFor(h, started).begun.ok);
      assert.throws(() => actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: started, reasoningClass: 'E2' }), refusedWith('WORK_ITEM_STARTED'), 'visible before execution only');
      const { workItem: plain } = h.store.createWorkItem({ objective: 'not employee work', ownerRef: s.founder, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', instructions: 'x' } });
      assert.throws(() => actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: plain.id, reasoningClass: 'E2' }), refusedWith('NOT_EMPLOYEE_WORK'));
      // After the Founder raises the ceiling, the same override is allowed (still within the route policy maximum E2).
      const raise = actions.preview(sess, 'EMPLOYEE_REASONING_PROFILE', { employeeId: s.employee.id, ceilingClass: 'E3' });
      actions.confirm(sess, raise.id, raise.fingerprint);
      assert.throws(() => actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: wi, reasoningClass: 'E3' }), refusedWith('ABOVE_ROUTE_POLICY'), 'never above the route policy maximum');
    });
  });

  test('the run carries the override; a reservation below it is refused (never bypassed downward); at its class it reserves that class\'s higher worst case', () => {
    withSeed((h, s, actions, sess) => {
      const e2 = e2Deployment(s);
      const wi = pending(h, s);
      const p = actions.preview(sess, 'WORK_ITEM_REASONING_OVERRIDE', { workItemId: wi, reasoningClass: 'E2' });
      assert.equal(p.payload.deploymentAvailable, true);
      actions.confirm(sess, p.id, p.fingerprint);
      release(h, wi);
      const { claim, begun } = claimFor(h, wi);
      assert.ok(begun.ok);
      if (!begun.ok) return;
      assert.equal(begun.context.reasoningOverride, 'E2');
      assert.equal(begun.context.cognitiveProfile.defaultClass, 'E1', 'the profile in the run is the standing one');
      const manifest = testManifest(h, claim.fence, s.employee.id);
      const below = reserveBudget(h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: s.deploymentId, priceCardId: s.priceCardId, routePolicyId: s.policyId, money: 1_000, tokens: 2_000, contextManifestId: manifest });
      assert.ok(!below.ok && below.code === 'ROUTE_NO_LONGER_ELIGIBLE' && below.detail === 'BELOW_REASONING_OVERRIDE');
      const at = reserveBudget(h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: e2.id, priceCardId: e2.cardId, routePolicyId: s.policyId, money: 3_000, tokens: 2_000, contextManifestId: manifest });
      assert.ok(at.ok, 'at the override class the reservation proceeds under the same budget chain');
      // Ordinary work of the same Employee (no override) still begins with no override.
      const ordinary = pending(h, s);
      release(h, ordinary);
      const b2 = claimFor(h, ordinary, 'w-2').begun;
      assert.ok(b2.ok && b2.context.reasoningOverride === null);
    });
  });
});

describe('D-L1-44: migration 0020', () => {
  test('a released v19 Company upgrades to v20: every Founder preview, Employee profile and migration 0001–0019 is unchanged; the override relation starts empty', () => {
    const root = tempRoot('l1-02-v19');
    try {
      const v19 = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(19) });
      const s = seed(v19);
      const auth = FounderAuthStore.for(v19);
      const { session } = auth.redeemLaunchToken(auth.mintLaunchToken().token);
      const company = s.gov.budgetFor('COMPANY', 'company');
      FounderActionStore.for(v19, auth).preview(session, 'BUDGET_CEILING', { budgetId: company?.id, capMoney: 12_000_000 });
      const d19 = storeContext(v19).db;
      const previews = JSON.stringify(d19.all('SELECT * FROM founder_action_previews ORDER BY id'));
      const employees = JSON.stringify(d19.all('SELECT id, cognitive_profile_json, version FROM employees ORDER BY id'));
      const migrations = JSON.stringify(d19.all('SELECT version, name, sha256, applied_at FROM schema_migrations ORDER BY version'));
      assert.notEqual(JSON.parse(previews).length, 0);
      v19.close();
      const v20 = openStoreForTests(root, { clock: new ManualClock(), liveSchemaUpdate: true, migrations: loadReleasedMigrations(20) });
      try {
        assert.deepEqual(v20.migration.applied, [20]);
        const d = storeContext(v20).db;
        assert.equal(JSON.stringify(d.all('SELECT * FROM founder_action_previews ORDER BY id')), previews, 'every preview row is kept as it was');
        assert.equal(JSON.stringify(d.all('SELECT id, cognitive_profile_json, version FROM employees ORDER BY id')), employees, 'no Employee profile is rewritten');
        assert.equal(JSON.stringify(d.all('SELECT version, name, sha256, applied_at FROM schema_migrations WHERE version <= 19 ORDER BY version')), migrations, '0001–0019 unchanged');
        assert.equal(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM work_item_reasoning_overrides')?.n, 0);
        assert.deepEqual(GovernanceStore.for(v20).getEmployee(s.employee.id).cognitiveProfile, { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' });
        assert.deepEqual(d.all('PRAGMA foreign_key_check'), []);
        assert.equal(v20.quickCheck(), 'ok');
      } finally {
        v20.close();
      }
    } finally {
      removeRoot(root);
    }
  });
});
