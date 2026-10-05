/**
 * C7-B storage proofs: the persistent App Operations & Release Lead seat, the R3 control path through the EXISTING
 * org-act boundary, Review Pool and approval engine, immutable versioned desired state, the datastore contract held
 * without TypeScript, desired ≠ effective, the outbound export seam, Founder Attention / preview, the C7-A refusal
 * amplification guard and the C6 boundary (an issued control is never an outcome).
 * C7B-PROOF: storage-control-plane
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { ManualClock, isQandeelError, newId, sha256Hex, type Id } from '@qandeel-company/domain';

import { AppControlStore, AttentionStore, ExternalEvidenceStore, FounderActionStore, FounderAuthStore, OrganizationStore, RELEASED_MIGRATIONS, ReviewStore, loadReleasedMigrations, type EmployeeRecord } from '../src/index.js';
import { recordOrgAct, settle } from '../src/runtime-authority.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { seed, type Seed } from './c2-helpers.js';
import { activeReviewer, decideActionReview, placed, reviewPlan, runFor, seat } from './c4-helpers.js';
import { backoff, harness, removeRoot, tempRoot, type Harness } from './helpers.js';

const LEAD = 'product.app-operations-release-lead';
const STORE_LEAD = 'product.app-store-release-reputation-lead';
const ACTION_PLAN = reviewPlan({ appliesTo: 'ACTIONS' });
const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;
const raw = (h: Harness) => storeContext(h.store).db;
const n = (h: Harness, sql: string, ...p: string[]): number => Number(raw(h).get<{ n: number }>(sql, ...p)?.n ?? 0);
const aborts = (fn: () => unknown, what: string): void => assert.throws(fn, (e: unknown) => e instanceof Error, what);

interface W {
  readonly h: Harness;
  readonly s: Seed;
  readonly lead: EmployeeRecord;
  readonly grantId: Id;
  readonly controls: AppControlStore;
}

function withWorld(fn: (w: W) => void, opts: { grant?: 'R3' | 'R1' | 'none'; resource?: string } = {}): void {
  const h = harness();
  try {
    const s = seed(h.store);
    activeReviewer(h, s);
    const lead = placed(h, s, LEAD);
    const g = opts.grant === 'none' ? null : s.gov.grant(s.founder, { employeeId: lead.id, capability: 'app-control.issue', resourceScope: opts.resource ?? '*', riskCeiling: opts.grant ?? 'R3', dataClassCeiling: 'D1', reasonCode: 'founder.grant' });
    fn({ h, s, lead, grantId: (g?.id ?? '') as Id, controls: AppControlStore.for(h.store) });
  } finally {
    h.close();
  }
}

let step = 0;
const flag = (state: string, expectedRevision = 0, over: Record<string, unknown> = {}): Record<string, unknown> => ({ family: 'FEATURE_FLAG', scope: { kind: 'CAPABILITY', capability: 'voice.call' }, operation: 'SET', value: { state }, reasonCode: 'incident.voice-errors', evidenceRefs: ['external_record:00000000-0000-4000-8000-000000000001'], expectedRevision, ...over });

/** One proposal from a fresh governed run of `who` (its Work Item carries an ACTION review plan unless told otherwise). */
function propose(w: W, args: Record<string, unknown>, who: EmployeeRecord = w.lead, plan: Record<string, unknown> | null = ACTION_PLAN) {
  const run = runFor(w.h, w.s, who, plan === null ? {} : { reviewPlan: plan });
  const out = recordOrgAct(w.h.store, run.claim.fence, ++step, 'control.propose', args);
  return { run, out, proposal: out.outcome === 'DONE' && out.resultRef?.startsWith('app_control_proposal:') ? w.controls.proposal(out.resultRef.slice('app_control_proposal:'.length)) : null };
}

/** Proposed → independently reviewed (PASS) → AWAITING_FOUNDER with a PENDING R3 approval. */
function reviewed(w: W, args: Record<string, unknown>) {
  const p = propose(w, args);
  assert.equal(p.out.outcome, 'DONE', `proposal refused: ${p.out.code}`);
  decideActionReview(w.h, p.run.workItemId, 'PASS');
  const proposal = w.controls.proposal(String(p.proposal?.id));
  assert.equal(proposal.state, 'AWAITING_FOUNDER');
  return { ...p, proposal };
}

/** The full R3 path: proposed → reviewed → Founder-approved → issued. */
function issued(w: W, args: Record<string, unknown>) {
  const r = reviewed(w, args);
  w.s.gov.decideApproval(w.s.founder, String(r.proposal.approvalId), { decision: 'APPROVE', reasonCode: 'founder.approved' });
  const proposal = w.controls.proposal(r.proposal.id);
  assert.equal(proposal.state, 'ISSUED');
  return { ...r, proposal };
}

// =================================================================================================================
describe('C7-B lifecycle, migration and the persistent seat', () => {
  test('(1) the C7-A closure record states GitHub truth; (2) released migrations 0001–0012 are unchanged; 0013 is pinned', () => {
    const record = readFileSync(new URL('../../../../docs/C7A_CLOSURE_RECORD.md', import.meta.url), 'utf8');
    for (const fact of ['CLOSED / MERGED / CANONICAL', 'PR: #13', '4decc9047abd8bf5ab8ef4662027a705cfd3aa7d', 'run #93', 'e7ca688f3a5ac2de5c317fbca31c5dad3dba2a41', 'run #94', '507ae100d3dc94b0a1bc3879d0f7927cdc844057']) assert.ok(record.includes(fact), fact);
    const frozen: Record<number, string> = { 11: '97ab99eebf4fc8ce49c1e1550eb4448f8a9e515a7b02259381ab33fe95ae2550', 12: '31eeff9a49e284bec44915842ea39453550cc225c9e58b100483a7ad45aaaf09' };
    for (const pin of RELEASED_MIGRATIONS) {
      assert.equal(sha256Hex(readFileSync(new URL(`../../migrations/${pin.file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')), pin.sha256, pin.file);
      if (frozen[pin.version] !== undefined) assert.equal(pin.sha256, frozen[pin.version], `${pin.file} never changes`);
    }
    assert.equal(RELEASED_MIGRATIONS.find((m) => m.version === 13)?.file, '0013_c7b_governed_app_controls.sql');
  });

  test('(3) a released v12 Company upgrades to v13: every row kept, the seat and charter version added, past refusals folded into bounded counters', () => {
    const root = tempRoot('c7b-v12');
    try {
      const v12 = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(12) });
      assert.equal(v12.schemaVersion, 12);
      const { workItem } = v12.createWorkItem({ objective: 'pre-C7-B work', ownerRef: 'owner:founder', processorKind: 'test.noop', initialState: 'READY' });
      const d12 = storeContext(v12).db;
      // Three refusals the released v12 code audited row by row (this release's code no longer writes them that way).
      for (let i = 0; i < 3; i++) d12.run(`INSERT INTO audit_events (occurred_at, action, entity_type, entity_id, actor_ref, correlation_id, causation_id, outcome, reason_code, details_json) VALUES (?, 'external.intake_rejected', 'external_source', 'unresolved', 'system:external-intake', NULL, NULL, 'REJECTED', 'UNREGISTERED_SOURCE', '{}')`, `2026-09-26T12:0${i}:00.000Z`);
      const before = { events: Number(d12.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')?.n), audit: Number(d12.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events')?.n), positions: Number(d12.get<{ n: number }>('SELECT COUNT(*) AS n FROM org_positions')?.n), employees: Number(d12.get<{ n: number }>('SELECT COUNT(*) AS n FROM employees')?.n) };
      v12.close();
      const v13 = openStoreForTests(root, { clock: new ManualClock(), liveSchemaUpdate: true });
      try {
        assert.deepEqual(v13.migration.applied, [13, 14, 15, 16]);
        const d = storeContext(v13).db;
        assert.equal(Number(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')?.n), before.events, 'the outbox keeps every event');
        assert.equal(Number(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events')?.n), before.audit, 'audit history is untouched');
        assert.equal(Number(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM org_positions')?.n), before.positions + 1, 'exactly one seat is added');
        assert.equal(Number(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM employees')?.n), before.employees, '(6) nobody is hired by the release');
        assert.equal(v13.getWorkItem(workItem.id).state, 'READY');
        assert.deepEqual(d.all('PRAGMA foreign_key_check'), []);
        assert.equal(v13.quickCheck(), 'ok');
        const w = d.get<{ refusals: number; source_ref: string; reason_code: string }>(`SELECT * FROM external_intake_refusal_windows`);
        assert.deepEqual({ ...w, window_start: undefined, first_at: undefined, last_at: undefined }, { source_ref: 'unresolved', reason_code: 'UNREGISTERED_SOURCE', refusals: 3, window_start: undefined, first_at: undefined, last_at: undefined }, 'past refusals are counted, not lost');
        const charters = d.all<{ version: number; status: string; seats_json: string }>(`SELECT version, status, seats_json FROM department_charters WHERE department_id = (SELECT id FROM departments WHERE code = 'product') ORDER BY version`);
        assert.deepEqual(charters.map((c) => [c.version, c.status]), [[1, 'SUPERSEDED'], [2, 'BASELINE']], 'the charter is versioned, never edited');
        assert.deepEqual(JSON.parse(charters[1]?.seats_json ?? '[]'), ['director.product', STORE_LEAD, LEAD]);
        assert.deepEqual(JSON.parse(charters[0]?.seats_json ?? '[]'), ['director.product', STORE_LEAD], 'the prior version is history as it was');
      } finally {
        v13.close();
      }
    } finally {
      removeRoot(root);
    }
  });

  test('(4–7) the App Operations & Release Lead is a vacant canonical Product seat under the Product Director, distinct from the App Store Release & Reputation Lead; the seat grants nothing', () => {
    const h = harness();
    try {
      assert.equal(n(h, 'SELECT COUNT(*) AS n FROM employees'), 0, '(6) no Employee exists in a fresh Company: nothing was auto-hired');
      const s = seed(h.store);
      const org = OrganizationStore.for(h.store);
      const ops = seat(h, LEAD);
      const store = seat(h, STORE_LEAD);
      const product = seat(h, 'director.product');
      assert.deepEqual([ops.kind, ops.scope, ops.departmentId, ops.reportsToPositionId, ops.status, ops.title, ops.roleRef], ['LEAD', 'DEPARTMENT', product.departmentId, product.id, 'ACTIVE', 'QANDEEL App Operations & Release Lead', 'role:product.app-operations-release-lead']);
      assert.equal(n(h, `SELECT COUNT(*) AS n FROM org_positions WHERE code = ? AND source = 'CANONICAL_MAP' AND created_by_ref = 'system:release-c7b'`, LEAD), 1);
      assert.deepEqual([store.id, store.code, store.title, store.roleRef, store.reportsToPositionId], ['c4e00000-0000-4000-8000-000000000021', STORE_LEAD, 'App Store Release & Reputation Lead', 'role:product.app-store-release-reputation-lead', product.id], '(5) the App Store seat is unchanged and separate');
      assert.notEqual(ops.id, store.id);
      assert.equal(org.seatHolder(ops.id).holder, null, 'vacant');
      assert.deepEqual(org.charter(product.departmentId as Id)?.seats, ['director.product', STORE_LEAD, LEAD]);
      // (7) holding the seat, without a grant, issues nothing — Title ≠ Authority.
      const lead = placed(h, s, LEAD);
      const run = runFor(h, s, lead, { reviewPlan: ACTION_PLAN });
      assert.equal(recordOrgAct(h.store, run.claim.fence, ++step, 'control.propose', flag('DISABLED')).code, 'NO_GRANT');
      assert.equal(n(h, 'SELECT COUNT(*) AS n FROM app_control_proposals'), 0);
    } finally {
      h.close();
    }
  });
});

// =================================================================================================================
describe('C7-B R3 governance through the existing review and approval engines', () => {
  test('(12, 13) no grant, an R1 grant, a grant for another family, or a grant outside the operating seat: refused', () => {
    withWorld((w) => assert.equal(propose(w, flag('DISABLED')).out.code, 'NO_GRANT', 'no grant'), { grant: 'none' });
    withWorld((w) => assert.equal(propose(w, flag('DISABLED')).out.code, 'NO_GRANT', 'an R1 grant never covers an R3 act'), { grant: 'R1' });
    withWorld((w) => {
      assert.equal(propose(w, { ...flag('DISABLED'), family: 'KILL_SWITCH', value: { effect: 'OUT_OF_SERVICE' } }).out.code, 'NO_GRANT', 'a feature-flag grant does not cover a kill switch');
      assert.equal(propose(w, flag('DISABLED')).out.outcome, 'DONE', 'it covers its own family');
    }, { resource: 'feature-flag' });
    withWorld((w) => {
      // The App Store Release & Reputation Lead with the very same grant is NOT the operating seat.
      const other = placed(w.h, w.s, STORE_LEAD);
      w.s.gov.grant(w.s.founder, { employeeId: other.id, capability: 'app-control.issue', riskCeiling: 'R3', dataClassCeiling: 'D1', reasonCode: 'founder.grant' });
      assert.equal(propose(w, flag('DISABLED'), other).out.code, 'CONTROL_SEAT_NOT_HELD');
      // Acting coverage counts only when its scope names the act (or is the seat's whole remit).
      const org = OrganizationStore.for(w.h.store);
      const until = new Date(Date.parse(w.h.store.now()) + 86_400_000).toISOString();
      org.endAssignment(w.s.founder, org.seatHolder(seat(w.h, LEAD).id).holder?.id ?? '', 'leave');
      org.assignActing(w.s.founder, { positionId: seat(w.h, LEAD).id, employeeId: other.id, until, scope: ['work.delegate'], reasonCode: 'cover' });
      assert.equal(propose(w, flag('DISABLED'), other).out.code, 'CONTROL_SEAT_NOT_HELD', 'acting coverage scoped to other acts');
      assert.equal(propose(w, flag('DISABLED')).out.code, 'CONTROL_SEAT_NOT_HELD', 'the former holder no longer holds the seat');
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_proposals'), 0);
      // The datastore refuses a proposal by an Employee outside the seat even when TypeScript is bypassed.
      const fx = propose(w, flag('DISABLED'), other);
      assert.equal(fx.out.outcome, 'REFUSED');
      aborts(() => raw(w.h).run(`INSERT INTO app_control_proposals (id, work_item_id, run_id, proposer_employee_id, proposer_position_id, grant_id, family, scope_kind, scope_json, operation, value_json, reason_code, evidence_refs_json, expected_revision, fingerprint, state, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, (SELECT id FROM permission_grants WHERE employee_id = ? AND capability = 'app-control.issue'), 'FEATURE_FLAG', 'CAPABILITY', '{"capability":"voice.call","kind":"CAPABILITY"}', 'SET', '{"state":"DISABLED"}', 'x', '[]', 0, ?, 'PROPOSED', 1, ?, ?)`,
        newId(), fx.run.workItemId, fx.run.claim.fence.runId, other.id, seat(w.h, STORE_LEAD).id, other.id, 'a'.repeat(64), w.h.store.now(), w.h.store.now()), 'a direct proposal outside the seat');
    });
  });

  test('(14–17) proposed → independently reviewed (never by its maker) → Founder approved → issued; review alone and approval alone issue nothing', () => {
    withWorld((w) => {
      const rv = ReviewStore.for(w.h.store);
      // No review plan → no review → nothing to issue: refused, nothing persisted.
      assert.equal(propose(w, flag('DISABLED'), w.lead, null).out.code, 'REVIEW_PLAN_MISSING');
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_proposals'), 0);
      const p = propose(w, flag('EMERGENCY_DISABLED'));
      assert.equal(p.out.outcome, 'DONE');
      assert.equal(p.proposal?.state, 'PROPOSED');
      const request = rv.requests({ workItemId: p.run.workItemId }).find((r) => r.subjectKind === 'ACTION');
      assert.deepEqual([request?.riskLevel, request?.subjectRef, request?.state], ['R3', `app_control_proposal:${p.proposal?.id}`, 'OPEN'], 'an R3 action review of exactly this act');
      assert.ok(rv.assignments(request?.id as Id).every((a) => a.reviewerEmployeeId !== w.lead.id), '(14) the maker is never its own reviewer');
      // (15) unreviewed: no approval exists, nothing the Founder could approve, nothing issued.
      assert.equal(n(w.h, `SELECT COUNT(*) AS n FROM approvals WHERE action = 'app-control.issue'`), 0);
      decideActionReview(w.h, p.run.workItemId, 'PASS');
      const awaiting = w.controls.proposal(String(p.proposal?.id));
      assert.equal(awaiting.state, 'AWAITING_FOUNDER');
      // (16) reviewed, not yet approved: the Founder approval is PENDING and NOTHING is issued.
      const approval = w.s.gov.getApproval(awaiting.approvalId as Id);
      assert.deepEqual([approval.state, approval.risk, approval.action, approval.argsSha256, approval.subjectRef], ['PENDING', 'R3', 'app-control.issue', awaiting.fingerprint, w.lead.ref]);
      assert.deepEqual(w.controls.issuedControls().controls, []);
      assert.ok(AttentionStore.for(w.h.store).sync() && AttentionStore.for(w.h.store).list().some((i) => i.sourceRef === `approval:${approval.id}` && i.level === 'NEEDS_DECISION'), 'R3 control awaiting the Founder reaches Founder Attention');
      // An Employee never approves (R3 is the Founder's in Strong v1).
      assert.throws(() => w.s.gov.decideApproval(w.lead.ref, approval.id, { decision: 'APPROVE', reasonCode: 'x' }), (e) => isQandeelError(e));
      // (17) the Founder approves exactly the reviewed act → issued, consuming the review and the approval once.
      w.s.gov.decideApproval(w.s.founder, approval.id, { decision: 'APPROVE', reasonCode: 'founder.approved' });
      const done = w.controls.proposal(awaiting.id);
      assert.equal(done.state, 'ISSUED');
      assert.equal(w.s.gov.getApproval(approval.id).state, 'CONSUMED');
      assert.equal(rv.requests({ workItemId: p.run.workItemId }).find((r) => r.id === request?.id)?.state, 'CONSUMED');
      const [series] = w.controls.series();
      const [rev] = w.controls.revisions(String(series?.id));
      assert.deepEqual([rev?.revision, rev?.operation, rev?.value, rev?.proposerRef, rev?.issuedByRef, rev?.approvalId, rev?.reviewRequestId, rev?.companyState], [1, 'SET', { state: 'EMERGENCY_DISABLED' }, w.lead.ref, w.s.founder, approval.id, request?.id, 'ISSUED']);
      assert.equal(w.controls.proposalHistory(done.id).map((x) => x.to).join('>'), 'PROPOSED>AWAITING_FOUNDER>ISSUED');
      assert.ok(AttentionStore.for(w.h.store).sync() && !AttentionStore.for(w.h.store).list().some((i) => i.sourceRef === `approval:${approval.id}`), 'the decided item leaves Founder Attention; normal history adds none');
    });
  });

  test('(18, 19) a changed act never reuses a review or approval; a rejected act never regenerates', () => {
    withWorld((w) => {
      const a = reviewed(w, flag('DISABLED'));
      const b = propose(w, flag('INTERNAL'));
      assert.equal(b.out.outcome, 'DONE');
      assert.notEqual(b.proposal?.fingerprint, a.proposal.fingerprint);
      assert.equal(b.proposal?.state, 'PROPOSED', 'the changed value is a new act: it waits for its own review');
      assert.equal(b.proposal?.approvalId, null);
      // The Founder's approval of A issues A — never B.
      w.s.gov.decideApproval(w.s.founder, String(a.proposal.approvalId), { decision: 'APPROVE', reasonCode: 'founder.approved' });
      assert.deepEqual(w.controls.issuedControls().controls.map((c) => c.value), [{ state: 'DISABLED' }]);
      assert.equal(w.controls.proposal(String(b.proposal?.id)).state, 'STALE', 'B was made against a revision that is no longer current');
    });
    withWorld((w) => {
      const r = reviewed(w, flag('DISABLED'));
      w.s.gov.decideApproval(w.s.founder, String(r.proposal.approvalId), { decision: 'REJECT', reasonCode: 'founder.rejected' });
      assert.equal(w.controls.proposal(r.proposal.id).state, 'REJECTED');
      assert.equal(w.controls.series().length, 0, 'nothing issued');
      assert.throws(() => w.s.gov.decideApproval(w.s.founder, String(r.proposal.approvalId), { decision: 'APPROVE', reasonCode: 'x' }), code('INVALID_TRANSITION'), 'a decided approval is history');
      aborts(() => raw(w.h).run("UPDATE app_control_proposals SET state = 'AWAITING_FOUNDER', version = version + 1 WHERE id = ?", r.proposal.id), 'a rejected proposal is never revived (datastore)');
      // The forward-only transition list itself (no other rule refuses these): a decided act never returns to review.
      aborts(() => raw(w.h).run("UPDATE app_control_proposals SET state = 'PROPOSED', version = version + 1 WHERE id = ?", r.proposal.id), 'REJECTED → PROPOSED');
      aborts(() => raw(w.h).run("UPDATE app_control_proposals SET state = 'STALE', version = version + 1 WHERE id = ?", r.proposal.id), 'REJECTED → STALE');
      // The same act from the same Work Item is refused; it never comes back as a fresh approval loop.
      assert.equal(recordOrgAct(w.h.store, r.run.claim.fence, ++step, 'control.propose', flag('DISABLED')).code, 'CONTROL_REJECTED');
      assert.equal(n(w.h, `SELECT COUNT(*) AS n FROM approvals WHERE action = 'app-control.issue'`), 1);
    });
  });

  test('a review that is no longer satisfied when the Founder decides refuses issuance (code, then datastore)', () => {
    withWorld((w) => {
      const r = reviewed(w, flag('DISABLED'));
      // Independent Oversight later disputes the satisfied review (SATISFIED → CONFLICT): the act is not issuable now.
      raw(w.h).run(`UPDATE review_requests SET state = 'CONFLICT', version = version + 1 WHERE id = ?`, String(r.proposal.reviewRequestId));
      assert.throws(() => w.s.gov.decideApproval(w.s.founder, String(r.proposal.approvalId), { decision: 'APPROVE', reasonCode: 'founder.approved' }), code('REVIEW_REQUIRED'));
      assert.equal(w.controls.series().length, 0);
      assert.equal(w.s.gov.getApproval(r.proposal.approvalId as Id).state, 'PENDING', 'nothing was decided');
      // The governed preview never offers the approval now — but the Founder can still REJECT the awaiting act.
      const auth = FounderAuthStore.for(w.h.store);
      const session = auth.redeemLaunchToken(auth.mintLaunchToken().token).session;
      const actions = FounderActionStore.for(w.h.store, auth);
      assert.throws(() => actions.preview(session, 'APPROVAL_DECIDE', { approvalId: r.proposal.approvalId, decision: 'APPROVE' }), code('REVIEW_REQUIRED'));
      const rej = actions.preview(session, 'APPROVAL_DECIDE', { approvalId: r.proposal.approvalId, decision: 'REJECT' });
      assert.equal(rej.payload.controlReview, 'CONFLICT', 'the preview states the review as it is now');
      actions.confirm(session, rej.id, rej.fingerprint);
      assert.equal(w.controls.proposal(r.proposal.id).state, 'REJECTED');
    });
  });
});

// =================================================================================================================
describe('C7-B versioned desired state', () => {
  test('(20–24) issued once; exact replay idempotent; a new revision supersedes without deleting; RELEASE is a new revision; stale expectations fail', () => {
    withWorld((w) => {
      const first = issued(w, flag('DISABLED'));
      const replay = recordOrgAct(w.h.store, first.run.claim.fence, step, 'control.propose', flag('DISABLED'));
      assert.equal(replay.replayed, true, 'the same act at the same step replays its recorded outcome');
      const again = recordOrgAct(w.h.store, first.run.claim.fence, ++step, 'control.propose', flag('DISABLED'));
      assert.deepEqual([again.outcome, again.resultRef], ['DONE', `app_control_revision:${first.proposal.revisionId}`], '(21) the exact act again returns the issued revision');
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_revisions'), 1, '(20) issued exactly once');
      assert.equal(propose(w, flag('ENABLED', 0)).out.code, 'STALE_EXPECTED_REVISION', '(24) an act against a revision that is no longer current');
      assert.equal(propose(w, flag('DISABLED', 1)).out.code, 'NO_CHANGE', 'an identical SET is no change');
      issued(w, flag('ENABLED', 1));
      issued(w, { family: 'FEATURE_FLAG', scope: { kind: 'CAPABILITY', capability: 'voice.call' }, operation: 'RELEASE', reasonCode: 'incident.closed', expectedRevision: 2 });
      assert.equal(propose(w, { family: 'FEATURE_FLAG', scope: { kind: 'CAPABILITY', capability: 'voice.call' }, operation: 'RELEASE', reasonCode: 'x', expectedRevision: 3 }).out.code, 'NOTHING_TO_RELEASE');
      const [series] = w.controls.series();
      const revs = w.controls.revisions(String(series?.id));
      assert.deepEqual(revs.map((r) => [r.revision, r.operation, r.value]), [[1, 'SET', { state: 'DISABLED' }], [2, 'SET', { state: 'ENABLED' }], [3, 'RELEASE', null]], '(22, 23) every revision stays history');
      assert.deepEqual(revs.map((r) => r.priorRevisionId), [null, revs[0]?.id, revs[1]?.id]);
      const exp = w.controls.issuedControls();
      assert.deepEqual(exp.controls.map((c) => [c.revision, c.operation, c.value, c.companyState]), [[3, 'RELEASE', null, 'ISSUED']], 'the current Company overlay is removed; nothing is claimed about the App');
    });
  });

  test('(25) concurrent revisions of one series cannot both become current: the second is STALE and its approval REVOKED', () => {
    withWorld((w) => {
      const a = reviewed(w, flag('DISABLED'));
      const b = reviewed(w, flag('INTERNAL'));
      w.s.gov.decideApproval(w.s.founder, String(a.proposal.approvalId), { decision: 'APPROVE', reasonCode: 'founder.approved' });
      assert.equal(w.controls.proposal(b.proposal.id).state, 'STALE');
      assert.equal(w.s.gov.getApproval(b.proposal.approvalId as Id).state, 'REVOKED');
      assert.throws(() => w.s.gov.decideApproval(w.s.founder, String(b.proposal.approvalId), { decision: 'APPROVE', reasonCode: 'x' }), code('INVALID_TRANSITION'));
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_revisions'), 1);
    });
  });

  test('(26) issued history, series identity, proposals and the family catalogue cannot be rewritten or deleted', () => {
    withWorld((w) => {
      const i = issued(w, flag('DISABLED'));
      const d = raw(w.h);
      aborts(() => d.run(`UPDATE app_control_revisions SET value_json = '{"state":"ENABLED"}'`), 'revision update');
      aborts(() => d.run(`UPDATE app_control_revisions SET company_state = 'APPLIED'`), 'no APPLIED rewrite');
      aborts(() => d.run('DELETE FROM app_control_revisions'), 'revision delete');
      aborts(() => d.run(`UPDATE app_control_series SET scope_json = '{"kind":"CAPABILITY","capability":"other"}'`), 'series update');
      aborts(() => d.run('DELETE FROM app_control_series'), 'series delete');
      aborts(() => d.run(`UPDATE app_control_proposals SET state = 'PROPOSED', version = version + 1 WHERE id = ?`, i.proposal.id), 'a proposal never moves back');
      aborts(() => d.run(`UPDATE app_control_proposals SET value_json = '{"state":"ENABLED"}', version = version + 1 WHERE id = ?`, i.proposal.id), 'the proposed act is immutable');
      aborts(() => d.run('DELETE FROM app_control_proposals'), 'proposal delete');
      aborts(() => d.run('DELETE FROM app_control_proposal_history'), 'history delete');
      aborts(() => d.run(`UPDATE app_control_families SET scope_kinds_json = '["APP"]' WHERE family = 'KILL_SWITCH'`), '(10) the catalogue cannot be widened');
      aborts(() => d.run(`INSERT INTO app_control_families (family, ordinal, scope_kinds_json, grant_resource) VALUES ('COMMAND', 8, '["APP"]', 'command')`), '(10) no eighth family by direct SQL');
      aborts(() => d.run(`DELETE FROM app_control_families WHERE family = 'ROUTE_HOLD'`), 'the catalogue is closed');
      assert.deepEqual(w.controls.families().map((f) => f.family), ['FEATURE_FLAG', 'KILL_SWITCH', 'MAINTENANCE_MODE', 'ROLLOUT_CONTROL', 'MINIMUM_SUPPORTED_VERSION', 'APPROVED_REMOTE_CONFIGURATION', 'ROUTE_HOLD'], '(8) exactly seven');
    });
  });
});

// =================================================================================================================
describe('C7-B datastore contract (TypeScript bypassed)', () => {
  /** A harness isolating the family / scope / value and sequence triggers: R3 linkage, issue-time authority and foreign keys switched off for it. */
  function contract(w: W): (row: Record<string, unknown>) => void {
    const d = raw(w.h);
    d.execScript('PRAGMA foreign_keys = OFF; DROP TRIGGER app_control_revisions_r3_governed; DROP TRIGGER app_control_revisions_authority_current;');
    const series = newId();
    d.run(`INSERT INTO app_control_series (id, family, scope_kind, scope_json, created_at) VALUES (?, 'FEATURE_FLAG', 'CAPABILITY', '{"capability":"voice.call","kind":"CAPABILITY"}', ?)`, series, w.h.store.now());
    return (o): Id => {
      const id = newId();
      const r = { series: series, revision: 1, prior: null, family: 'FEATURE_FLAG', kind: 'CAPABILITY', scope: '{"capability":"voice.call","kind":"CAPABILITY"}', op: 'SET', value: '{"state":"DISABLED"}', state: 'ISSUED', ...o };
      if (o.family !== undefined && o.series === undefined) {
        // Each case gets its own series of exactly its family and scope (the series row itself is plain identity).
        d.run('INSERT OR IGNORE INTO app_control_series (id, family, scope_kind, scope_json, created_at) VALUES (?, ?, ?, ?, ?)', newId(), String(r.family), String(r.kind), String(r.scope), w.h.store.now());
        r.series = String(d.get<{ id: string }>('SELECT id FROM app_control_series WHERE family = ? AND scope_json = ?', String(r.family), String(r.scope))?.id ?? newId()) as Id;
      }
      d.run(
        `INSERT INTO app_control_revisions (id, series_id, revision, prior_revision_id, family, scope_kind, scope_json, operation, value_json, reason_code, proposal_id, proposer_ref, review_request_id, approval_id, issued_by_ref, issued_at, digest, company_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'x', ?, 'employee:x', ?, ?, 'founder:x', ?, ?, ?)`,
        id, String(r.series), Number(r.revision), r.prior as string | null, String(r.family), String(r.kind), String(r.scope), String(r.op), r.value as string | null, newId(), newId(), newId(), w.h.store.now(), sha256Hex(newId()), String(r.state),
      );
      return id;
    };
  }

  test('(27) the datastore refuses every illegal family / scope / value combination, free text, unapproved Remote Configuration, a selecting Route Hold and APPLIED state', () => {
    withWorld((w) => {
      const insert = contract(w);
      const refused: [string, Record<string, unknown>][] = [
        ['eighth family', { family: 'COMMAND', kind: 'APP', scope: '{"kind":"APP"}', value: '{"command":"x"}' }],
        ['family / scope combination', { family: 'KILL_SWITCH', kind: 'APP', scope: '{"kind":"APP"}', value: '{"effect":"OUT_OF_SERVICE"}' }],
        ['scope kind mismatch', { family: 'KILL_SWITCH', kind: 'CAPABILITY', scope: '{"kind":"SURFACE","capability":"voice.call"}', value: '{"effect":"OUT_OF_SERVICE"}' }],
        ['extra scope key', { family: 'KILL_SWITCH', kind: 'CAPABILITY', scope: '{"kind":"CAPABILITY","capability":"voice.call","userId":"u1"}', value: '{"effect":"OUT_OF_SERVICE"}' }],
        ['free-text scope', { family: 'KILL_SWITCH', kind: 'CAPABILITY', scope: '{"kind":"CAPABILITY","capability":"voice call for everyone"}', value: '{"effect":"OUT_OF_SERVICE"}' }],
        ['PII-shaped scope', { family: 'KILL_SWITCH', kind: 'CAPABILITY', scope: '{"kind":"CAPABILITY","capability":"u201001234567"}', value: '{"effect":"OUT_OF_SERVICE"}' }],
        ['repeated scope key', { family: 'KILL_SWITCH', kind: 'CAPABILITY', scope: '{"kind":"CAPABILITY","capability":"voice.call","capability":"voice.note"}', value: '{"effect":"OUT_OF_SERVICE"}' }],
        ['invalid flag state', { value: '{"state":"ON"}' }],
        ['extra value key', { value: '{"state":"DISABLED","script":"x"}' }],
        ['repeated value key', { value: '{"state":"DISABLED","state":"ENABLED"}' }],
        ['kill switch command', { family: 'KILL_SWITCH', kind: 'CAPABILITY', scope: '{"kind":"CAPABILITY","capability":"worlds.match"}', value: '{"effect":"KILL_PROCESS"}' }],
        ['maintenance copy', { family: 'MAINTENANCE_MODE', kind: 'APP', scope: '{"kind":"APP"}', value: '{"reason":"We are back at 5pm"}' }],
        ['rollout percentage', { family: 'ROLLOUT_CONTROL', kind: 'COHORT', scope: '{"kind":"COHORT","capability":"worlds.public","cohort":"pilot-a"}', value: '{"exposure":"ENABLED","percentage":50}' }],
        ['malformed version', { family: 'MINIMUM_SUPPORTED_VERSION', kind: 'PLATFORM', scope: '{"kind":"PLATFORM","platform":"IOS"}', value: '{"minVersion":"02.4"}' }],
        ['version with a suffix', { family: 'MINIMUM_SUPPORTED_VERSION', kind: 'PLATFORM', scope: '{"kind":"PLATFORM","platform":"IOS"}', value: '{"minVersion":"2.4.0-beta"}' }],
        ['unknown platform', { family: 'MINIMUM_SUPPORTED_VERSION', kind: 'PLATFORM', scope: '{"kind":"PLATFORM","platform":"SYMBIAN"}', value: '{"minVersion":"2.4.0"}' }],
        ['remote configuration without an approved family', { family: 'APPROVED_REMOTE_CONFIGURATION', kind: 'APP', scope: '{"kind":"APP"}', value: '{"family":"sync.batch-size","value":25}' }],
        ['remote configuration script', { family: 'APPROVED_REMOTE_CONFIGURATION', kind: 'APP', scope: '{"kind":"APP"}', value: '{"family":"x","value":"eval(1)"}' }],
        ['route hold that selects', { family: 'ROUTE_HOLD', kind: 'ROUTE', scope: '{"kind":"ROUTE","route":"conversation.primary"}', value: '{"hold":"FORCE"}' }],
        ['route hold with a replacement', { family: 'ROUTE_HOLD', kind: 'PROVIDER', scope: '{"kind":"PROVIDER","provider":"provider-a"}', value: '{"hold":"HELD","model":"model-b"}' }],
        ['APPLIED state', { state: 'APPLIED' }],
        ['EFFECTIVE_IN_APP state', { state: 'EFFECTIVE_IN_APP' }],
        ['revision skip', { revision: 2 }],
        ['RELEASE of nothing', { op: 'RELEASE', value: null }],
      ];
      for (const [why, row] of refused) aborts(() => insert(row), why);
      // The controls: one valid revision per family shape (proves the harness itself does not refuse everything).
      const rev1 = insert({});
      aborts(() => insert({ revision: 1 }), 'a second revision 1 (two current revisions)');
      aborts(() => insert({ revision: 3, prior: null }), 'a skip after revision 1');
      aborts(() => insert({ revision: 3, prior: rev1 }), 'a skipped revision number after the current one');
      aborts(() => insert({ revision: 1, prior: rev1 }), 'a rollback to an earlier number');
      const rev2 = insert({ revision: 2, prior: rev1, value: '{"state":"ENABLED"}' });
      aborts(() => insert({ revision: 3, prior: rev1, value: '{"state":"DISABLED"}' }), 'a stale prior (compare-and-swap)');
      insert({ revision: 3, prior: rev2, op: 'RELEASE', value: null });
      insert({ family: 'ROUTE_HOLD', kind: 'PROVIDER', scope: '{"kind":"PROVIDER","provider":"provider-a"}', value: '{"hold":"HELD"}' });
      insert({ family: 'MINIMUM_SUPPORTED_VERSION', kind: 'PLATFORM_CAPABILITY', scope: '{"capability":"voice.call","kind":"PLATFORM_CAPABILITY","platform":"ANDROID"}', value: '{"minVersion":"10.0.3"}' });
      insert({ family: 'MAINTENANCE_MODE', kind: 'APP', scope: '{"kind":"APP"}', value: '{"reason":"PLANNED_MAINTENANCE"}' });
      insert({ family: 'ROLLOUT_CONTROL', kind: 'COHORT', scope: '{"capability":"worlds.public","cohort":"pilot-a","kind":"COHORT"}', value: '{"exposure":"LIMITED_ROLLOUT"}' });
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_revisions'), 7);
    });
  });

  test('(27, 47–48) the approved Remote Configuration register is empty and enters only by a controlled release; a future approved family is typed by the datastore', () => {
    withWorld((w) => {
      assert.deepEqual(w.controls.remoteConfigFamilies(), []);
      aborts(() => raw(w.h).run(`INSERT INTO app_remote_config_families (code, version, value_type, min_value, max_value, enum_json, scope_kinds_json, product_approval_ref, architecture_approval_ref, approved_at) VALUES ('sync.batch-size', 1, 'INTEGER', 1, 100, NULL, '["APP"]', 'po:x', 'arch:x', ?)`, w.h.store.now()), 'no runtime path adds an approved family');
      // A LATER release (simulated in this scratch database only: the release would re-create the guard) adds one: the
      // datastore then types its values. Never a production seed.
      const insert = contract(w);
      raw(w.h).execScript(`DROP TRIGGER app_remote_config_families_release_only; INSERT INTO app_remote_config_families (code, version, value_type, min_value, max_value, enum_json, scope_kinds_json, product_approval_ref, architecture_approval_ref, approved_at) VALUES ('sync.batch-size', 1, 'INTEGER', 1, 100, NULL, '["APP"]', 'po:x', 'arch:x', '2026-10-01T00:00:00.000Z');`);
      const rc = (value: string, scope = '{"kind":"APP"}', kind = 'APP') => insert({ family: 'APPROVED_REMOTE_CONFIGURATION', kind, scope, value });
      rc('{"family":"sync.batch-size","value":25}');
      for (const bad of ['{"family":"sync.batch-size","value":101}', '{"family":"sync.batch-size","value":"25"}', '{"family":"sync.batch-size","value":25,"extra":1}', '{"family":"other","value":1}']) aborts(() => rc(bad), bad);
      aborts(() => rc('{"family":"sync.batch-size","value":25}', '{"capability":"voice.call","kind":"CAPABILITY"}', 'CAPABILITY'), 'a scope the family does not admit');
    });
  });

  test('(15–19) without TypeScript: no issued revision without the satisfied review AND the issuing Founder\'s approval of exactly that act', () => {
    withWorld((w) => {
      const r = reviewed(w, flag('DISABLED'));
      const d = raw(w.h);
      const p = w.controls.proposal(r.proposal.id);
      const row = (o: Record<string, unknown> = {}) => {
        const x = { value: '{"state":"DISABLED"}', issuer: w.s.founder, approval: p.approvalId, review: p.reviewRequestId, ...o };
        d.run(
          `INSERT INTO app_control_series (id, family, scope_kind, scope_json, created_at) SELECT ?, 'FEATURE_FLAG', 'CAPABILITY', ?, ? WHERE NOT EXISTS (SELECT 1 FROM app_control_series)`,
          newId(), '{"capability":"voice.call","kind":"CAPABILITY"}', w.h.store.now(),
        );
        d.run(
          `INSERT INTO app_control_revisions (id, series_id, revision, prior_revision_id, family, scope_kind, scope_json, operation, value_json, reason_code, proposal_id, proposer_ref, review_request_id, approval_id, issued_by_ref, issued_at, digest, company_state)
           VALUES (?, (SELECT id FROM app_control_series LIMIT 1), 1, NULL, 'FEATURE_FLAG', 'CAPABILITY', '{"capability":"voice.call","kind":"CAPABILITY"}', 'SET', ?, 'incident.voice-errors', ?, ?, ?, ?, ?, ?, ?, 'ISSUED')`,
          newId(), String(x.value), p.id, w.lead.ref, String(x.review), String(x.approval), String(x.issuer), w.h.store.now(), sha256Hex(newId()),
        );
      };
      aborts(() => row(), '(16) the approval is still PENDING: review alone never issues');
      d.run(`UPDATE approvals SET state = 'APPROVED', decided_by_ref = ?, decided_at = ?, version = version + 1, updated_at = ? WHERE id = ?`, w.s.founder, w.h.store.now(), w.h.store.now(), String(p.approvalId));
      aborts(() => row({ value: '{"state":"ENABLED"}' }), '(18) a changed value never rides the approval');
      aborts(() => row({ issuer: 'founder:someone-else' }), 'issued only by the approving Founder');
      d.run(`UPDATE review_requests SET state = 'CONFLICT', version = version + 1 WHERE id = ?`, String(p.reviewRequestId));
      aborts(() => row(), '(15) the review is no longer satisfied');
      d.run(`UPDATE review_requests SET state = 'CONSUMED', version = version + 1 WHERE id = ?`, String(p.reviewRequestId));
      aborts(() => row(), 'a consumed review never authorizes again');
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_revisions'), 0);
    });
  });
});

// =================================================================================================================
// TL exact-head review (PR #14), MAJOR 1: authority is re-decided at the issue boundary, where the act takes effect.
describe('C7-B issue-time authority (TL MAJOR 1)', () => {
  const approve = (w: W, approvalId: unknown) => w.s.gov.decideApproval(w.s.founder, String(approvalId), { decision: 'APPROVE', reasonCode: 'founder.approved' });
  const denied = (reason: string) => (e: unknown): boolean => isQandeelError(e) && e.code === 'AUTHORITY_DENIED' && e.details.reason === reason;
  /** Refused whole: nothing issued, nothing decided, the act still awaits the Founder (who may still reject it). */
  function refusedWhole(w: W, r: ReturnType<typeof reviewed>, reason: string): void {
    const history = w.controls.proposalHistory(r.proposal.id);
    assert.throws(() => approve(w, r.proposal.approvalId), denied(reason));
    assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_revisions'), 0, 'no revision');
    assert.deepEqual(w.controls.issuedControls().controls, []);
    assert.equal(w.s.gov.getApproval(r.proposal.approvalId as Id).state, 'PENDING', 'nothing was decided');
    assert.equal(ReviewStore.for(w.h.store).requests({ workItemId: r.run.workItemId }).find((q) => q.id === r.proposal.reviewRequestId)?.state, 'SATISFIED', 'the review is not consumed');
    assert.equal(w.controls.proposal(r.proposal.id).state, 'AWAITING_FOUNDER');
    assert.deepEqual(w.controls.proposalHistory(r.proposal.id), history, 'history is coherent: nothing half-written');
    // The governed preview never offers the approval either; the Founder can still reject the act.
    const auth = FounderAuthStore.for(w.h.store);
    const session = auth.redeemLaunchToken(auth.mintLaunchToken().token).session;
    const actions = FounderActionStore.for(w.h.store, auth);
    assert.throws(() => actions.preview(session, 'APPROVAL_DECIDE', { approvalId: r.proposal.approvalId, decision: 'APPROVE' }), denied(reason));
    // Without TypeScript the datastore refuses the revision too (the approval forced APPROVED in this scratch database).
    const d = raw(w.h);
    d.run(`UPDATE approvals SET state = 'APPROVED', decided_by_ref = ?, decided_at = ?, version = version + 1, updated_at = ? WHERE id = ?`, w.s.founder, w.h.store.now(), w.h.store.now(), String(r.proposal.approvalId));
    const series = newId();
    d.run(`INSERT INTO app_control_series (id, family, scope_kind, scope_json, created_at) VALUES (?, 'FEATURE_FLAG', 'CAPABILITY', '{"capability":"voice.call","kind":"CAPABILITY"}', ?)`, series, w.h.store.now());
    assert.throws(
      () => d.run(
        `INSERT INTO app_control_revisions (id, series_id, revision, prior_revision_id, family, scope_kind, scope_json, operation, value_json, reason_code, proposal_id, proposer_ref, review_request_id, approval_id, issued_by_ref, issued_at, digest, company_state)
         VALUES (?, ?, 1, NULL, 'FEATURE_FLAG', 'CAPABILITY', '{"capability":"voice.call","kind":"CAPABILITY"}', 'SET', '{"state":"DISABLED"}', 'incident.voice-errors', ?, ?, ?, ?, ?, ?, ?, 'ISSUED')`,
        newId(), series, r.proposal.id, `employee:${r.proposal.proposerEmployeeId}`, String(r.proposal.reviewRequestId), String(r.proposal.approvalId), w.s.founder, w.h.store.now(), sha256Hex(newId()),
      ),
      (e: unknown) => e instanceof Error && /still holds the seat and a current R3 grant/.test(String((e as { cause?: Error }).cause?.message ?? e.message)),
      'the datastore re-checks issue-time authority',
    );
    assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_revisions'), 0);
  }

  test('the seat ends after the review and before the Founder approves: refused, no revision', () => {
    withWorld((w) => {
      const r = reviewed(w, flag('DISABLED'));
      const org = OrganizationStore.for(w.h.store);
      org.endAssignment(w.s.founder, org.seatHolder(seat(w.h, LEAD).id).holder?.id ?? '', 'leave');
      refusedWhole(w, r, 'CONTROL_SEAT_NOT_HELD');
    });
  });

  test('acting coverage expires before the Founder approves: refused, no revision', () => {
    withWorld((w) => {
      const org = OrganizationStore.for(w.h.store);
      const cover = placed(w.h, w.s, STORE_LEAD);
      w.s.gov.grant(w.s.founder, { employeeId: cover.id, capability: 'app-control.issue', riskCeiling: 'R3', dataClassCeiling: 'D1', reasonCode: 'founder.grant' });
      org.endAssignment(w.s.founder, org.seatHolder(seat(w.h, LEAD).id).holder?.id ?? '', 'leave');
      org.assignActing(w.s.founder, { positionId: seat(w.h, LEAD).id, employeeId: cover.id, until: new Date(Date.parse(w.h.store.now()) + 3_600_000).toISOString(), scope: ['control.propose'], reasonCode: 'cover' });
      const p = propose(w, flag('DISABLED'), cover);
      assert.equal(p.out.outcome, 'DONE', 'acting coverage naming the act may propose');
      decideActionReview(w.h, p.run.workItemId, 'PASS');
      const r = { ...p, proposal: w.controls.proposal(String(p.proposal?.id)) };
      assert.equal(r.proposal.state, 'AWAITING_FOUNDER');
      w.h.clock.advance(2 * 3_600_000);
      refusedWhole(w, r, 'CONTROL_SEAT_NOT_HELD');
    });
  });

  test('the grant is revoked after the proposal: refused, no revision', () => {
    withWorld((w) => {
      const r = reviewed(w, flag('DISABLED'));
      w.s.gov.revokeGrant(w.s.founder, w.grantId, 'founder.revoked');
      refusedWhole(w, r, 'CONTROL_GRANT_NOT_CURRENT');
    });
  });

  test('the grant expires after the proposal: refused, no revision', () => {
    withWorld((w) => {
      w.s.gov.grant(w.s.founder, { employeeId: w.lead.id, capability: 'app-control.issue', riskCeiling: 'R3', dataClassCeiling: 'D1', expiresAt: new Date(Date.parse(w.h.store.now()) + 3_600_000).toISOString(), reasonCode: 'founder.grant' });
      const r = reviewed(w, flag('DISABLED'));
      w.h.clock.advance(2 * 3_600_000);
      refusedWhole(w, r, 'CONTROL_GRANT_NOT_CURRENT');
    }, { grant: 'none' });
  });

  test('authority unchanged: a single-use grant consumed by this very act still issues it (consumption is not loss of authority)', () => {
    withWorld((w) => {
      const g = w.s.gov.grant(w.s.founder, { employeeId: w.lead.id, capability: 'app-control.issue', resourceScope: 'feature-flag', riskCeiling: 'R3', dataClassCeiling: 'D1', maxUses: 1, reasonCode: 'founder.grant' });
      const r = reviewed(w, flag('DISABLED'));
      assert.equal(r.proposal.grantId, g.id);
      assert.equal(n(w.h, 'SELECT uses AS n FROM permission_grants WHERE id = ?', g.id), 1, 'the grant was used by this act');
      approve(w, r.proposal.approvalId);
      assert.equal(w.controls.proposal(r.proposal.id).state, 'ISSUED');
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_revisions'), 1);
      // The grant is spent: a NEW act needs new authority.
      assert.equal(propose(w, flag('ENABLED', 1)).out.code, 'NO_GRANT');
    }, { grant: 'none' });
  });
});

// =================================================================================================================
// TL exact-head review (PR #14), MAJOR 2: a STALE review never strands the control proposal nor keeps its approval alive.
describe('C7-B Review Plan supersession (TL MAJOR 2)', () => {
  const V2 = reviewPlan({ appliesTo: 'ACTIONS', reviewerInstructions: 'Judge the exact control act against the rubric again; cite evidence.' });
  const requests = (w: W, workItemId: Id) => ReviewStore.for(w.h.store).requests({ workItemId }).filter((q) => q.subjectKind === 'ACTION');

  test('OPEN review → plan superseded → STALE → the same proposal is reviewed afresh under the active plan → approved → issued once', () => {
    withWorld((w) => {
      const p = propose(w, flag('DISABLED'));
      const old = String(p.proposal?.reviewRequestId);
      ReviewStore.for(w.h.store).declarePlan(w.s.founder, p.run.workItemId, V2);
      const now = w.controls.proposal(String(p.proposal?.id));
      assert.equal(now.state, 'PROPOSED', 'not stranded, not ended');
      assert.notEqual(now.reviewRequestId, old, 'bound to a fresh review');
      const [stale, fresh] = [requests(w, p.run.workItemId).find((q) => q.id === old), requests(w, p.run.workItemId).find((q) => q.id === now.reviewRequestId)];
      assert.equal(stale?.state, 'STALE', 'the old review is kept as history and never reused');
      assert.deepEqual([fresh?.state, fresh?.subjectFingerprint, fresh?.subjectRef, fresh?.riskLevel], ['OPEN', now.fingerprint, now.ref, 'R3'], 'the same exact act');
      assert.equal(fresh?.planId, ReviewStore.for(w.h.store).plans(p.run.workItemId).find((x) => x.status === 'ACTIVE')?.id, 'under the active plan');
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_proposals'), 1, 'no replacement proposal, no new Work Item');
      decideActionReview(w.h, p.run.workItemId, 'PASS');
      const awaiting = w.controls.proposal(now.id);
      assert.equal(awaiting.state, 'AWAITING_FOUNDER');
      w.s.gov.decideApproval(w.s.founder, String(awaiting.approvalId), { decision: 'APPROVE', reasonCode: 'founder.approved' });
      const [rev] = w.controls.revisions(String(w.controls.series()[0]?.id));
      assert.deepEqual([rev?.reviewRequestId, rev?.approvalId], [now.reviewRequestId, awaiting.approvalId], 'issued on the fresh review only');
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_revisions'), 1, 'exactly one revision');
      assert.deepEqual(w.controls.proposalHistory(now.id).map((x) => `${x.to}:${x.reasonCode}`), ['PROPOSED:app_control.proposed', 'PROPOSED:review.stale', 'PROPOSED:review.rebound', 'AWAITING_FOUNDER:review.passed', 'ISSUED:founder.approved']);
    });
  });

  test('SATISFIED review with a PENDING approval → plan superseded: the approval is REVOKED and can never issue; a new review and a new approval of the same act issue', () => {
    withWorld((w) => {
      const r = reviewed(w, flag('DISABLED'));
      const [oldReview, oldApproval] = [String(r.proposal.reviewRequestId), String(r.proposal.approvalId)];
      ReviewStore.for(w.h.store).declarePlan(w.s.founder, r.run.workItemId, V2);
      assert.equal(w.s.gov.getApproval(oldApproval as Id).state, 'REVOKED', 'the pending approval no longer stands on a stale review');
      const back = w.controls.proposal(r.proposal.id);
      assert.equal(back.state, 'PROPOSED');
      assert.equal(requests(w, r.run.workItemId).find((q) => q.id === oldReview)?.state, 'STALE');
      assert.equal(requests(w, r.run.workItemId).find((q) => q.id === back.reviewRequestId)?.state, 'OPEN');
      // The old approval cannot be used: not by the engine, not through the governed preview, not by direct SQL.
      assert.throws(() => w.s.gov.decideApproval(w.s.founder, oldApproval, { decision: 'APPROVE', reasonCode: 'founder.approved' }), code('INVALID_TRANSITION'));
      const auth = FounderAuthStore.for(w.h.store);
      const session = auth.redeemLaunchToken(auth.mintLaunchToken().token).session;
      assert.throws(() => FounderActionStore.for(w.h.store, auth).preview(session, 'APPROVAL_DECIDE', { approvalId: oldApproval, decision: 'APPROVE' }), (e: unknown) => isQandeelError(e));
      aborts(() => raw(w.h).run(`UPDATE app_control_proposals SET state = 'AWAITING_FOUNDER', version = version + 1 WHERE id = ?`, r.proposal.id), 'never back to the Founder on the stale review');
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_revisions'), 0);
      // Only after the new independent review a NEW approval of the same exact act exists, and only it issues.
      decideActionReview(w.h, r.run.workItemId, 'PASS');
      const awaiting = w.controls.proposal(r.proposal.id);
      assert.equal(awaiting.state, 'AWAITING_FOUNDER');
      assert.notEqual(awaiting.approvalId, oldApproval);
      const fresh = w.s.gov.getApproval(awaiting.approvalId as Id);
      assert.deepEqual([fresh.state, fresh.argsSha256, fresh.risk], ['PENDING', awaiting.fingerprint, 'R3']);
      w.s.gov.decideApproval(w.s.founder, fresh.id, { decision: 'APPROVE', reasonCode: 'founder.approved' });
      assert.equal(w.controls.proposal(r.proposal.id).state, 'ISSUED');
      const [rev] = w.controls.revisions(String(w.controls.series()[0]?.id));
      assert.deepEqual([rev?.approvalId, rev?.reviewRequestId], [fresh.id, awaiting.reviewRequestId]);
      assert.equal(w.s.gov.getApproval(oldApproval as Id).state, 'REVOKED', 'history kept');
      assert.deepEqual(w.controls.proposalHistory(r.proposal.id).map((x) => x.to).join('>'), 'PROPOSED>AWAITING_FOUNDER>PROPOSED>PROPOSED>AWAITING_FOUNDER>ISSUED');
    });
  });

  test('without a plan reviewing actions the proposal waits (never stranded): the exact act again, or the next plan, recovers it — no new Work Item', () => {
    withWorld((w) => {
      const p = propose(w, flag('DISABLED'));
      const rv = ReviewStore.for(w.h.store);
      rv.declarePlan(w.s.founder, p.run.workItemId, reviewPlan({ appliesTo: 'OUTPUT' }));
      assert.equal(w.controls.proposal(String(p.proposal?.id)).state, 'PROPOSED');
      // The executor re-presents the exact act: the same proposal answers (never a duplicate), still waiting for a plan.
      const again = recordOrgAct(w.h.store, p.run.claim.fence, ++step, 'control.propose', flag('DISABLED'));
      assert.deepEqual([again.outcome, again.resultRef], ['DONE', p.out.resultRef]);
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_proposals'), 1);
      rv.declarePlan(w.s.founder, p.run.workItemId, V2);
      const now = w.controls.proposal(String(p.proposal?.id));
      assert.equal(requests(w, p.run.workItemId).find((q) => q.id === now.reviewRequestId)?.state, 'OPEN', 'the next plan reviews the same act');
      decideActionReview(w.h, p.run.workItemId, 'PASS');
      assert.equal(w.controls.proposal(now.id).state, 'AWAITING_FOUNDER');
    });
  });

  test('an exact act that drew REWORK is never revived by a new plan; another series revision makes a recovered act STALE', () => {
    withWorld((w) => {
      const p = propose(w, flag('DISABLED'));
      decideActionReview(w.h, p.run.workItemId, 'FAIL');
      assert.equal(w.controls.proposal(String(p.proposal?.id)).state, 'REVIEW_REJECTED');
      const before = requests(w, p.run.workItemId).length;
      ReviewStore.for(w.h.store).declarePlan(w.s.founder, p.run.workItemId, V2);
      assert.equal(w.controls.proposal(String(p.proposal?.id)).state, 'REVIEW_REJECTED');
      assert.equal(requests(w, p.run.workItemId).length, before, 'no fresh review of a rejected act');
    });
    withWorld((w) => {
      const a = propose(w, flag('DISABLED'));
      issued(w, flag('INTERNAL'));
      // A was made against revision 0 and is STALE already; a superseded plan does not bring it back.
      assert.equal(w.controls.proposal(String(a.proposal?.id)).state, 'STALE');
      ReviewStore.for(w.h.store).declarePlan(w.s.founder, a.run.workItemId, V2);
      assert.equal(w.controls.proposal(String(a.proposal?.id)).state, 'STALE');
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_revisions'), 1);
    });
  });
});

// =================================================================================================================
describe('C7-B desired ≠ effective, privacy and the outbound seam', () => {
  test('(27–29, 57) the Company states ISSUED desired state only; no applied / acknowledged state exists; absence is never a control', () => {
    withWorld((w) => {
      assert.deepEqual(w.controls.issuedControls().controls, [], '(29) no issued control is no control (never an implicit Kill Switch)');
      issued(w, { family: 'KILL_SWITCH', scope: { kind: 'CAPABILITY', capability: 'worlds.matching' }, operation: 'SET', value: { effect: 'OUT_OF_SERVICE' }, reasonCode: 'incident.matching', expectedRevision: 0 });
      issued(w, { family: 'ROUTE_HOLD', scope: { kind: 'PROVIDER', provider: 'provider-a' }, operation: 'SET', value: { hold: 'HELD' }, reasonCode: 'provider.degraded', expectedRevision: 0 });
      const exp = w.controls.issuedControls();
      assert.equal(exp.contract, 'company.issued-controls@1');
      assert.deepEqual(exp.controls.map((c) => c.family), ['KILL_SWITCH', 'ROUTE_HOLD'], 'deterministic family order');
      for (const c of exp.controls) {
        assert.deepEqual(Object.keys(c).sort(), ['companyState', 'digest', 'family', 'issuedAt', 'operation', 'revision', 'scope', 'seriesId', 'value']);
        assert.equal(c.companyState, 'ISSUED');
      }
      assert.deepEqual(w.controls.issuedControls(), exp, 'the export is deterministic');
      const schema = raw(w.h).all<{ name: string; sql: string }>(`SELECT name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND (name LIKE 'app_control%' OR name LIKE 'app_remote%')`);
      for (const o of schema) assert.doesNotMatch(o.sql.replace(/'[^']*'/g, "''"), /\b(?:applied|acknowledg\w*|delivered|effective_in_app|live_in_app|active_in_app)\b/i, `${o.name} has no App-applied state`);
      assert.deepEqual(raw(w.h).all<{ name: string }>(`SELECT name FROM sqlite_schema WHERE type = 'table'`).map((t) => t.name).filter((t) => /acknowledg|(?:^|_)acks?(?:_|$)|applied|receipt|delivered/i.test(t)), [], '(28) no acknowledgement / applied / delivery table');
    });
  });

  test('(30, 38) a telemetry failure or outage never issues a control: source facts are evidence, never a decision', () => {
    withWorld((w) => {
      const x = ExternalEvidenceStore.for(w.h.store);
      const src = x.registerSource(w.s.founder, { sourceKey: 'app-operations.production', family: 'APP_OPERATIONS', contractCode: 'ops.events', contractVersion: 1 }).source;
      x.decideSource(w.s.founder, src.id, { decision: 'ACTIVATE', reasonCode: 'founder.trusted' });
      for (const [i, f] of [{ service: 'voice-api', state: 'DOWN' }, { service: 'chat-api', state: 'DEGRADED' }].entries()) {
        x.ingest({ sourceKey: 'app-operations.production', contractCode: 'ops.events', contractVersion: 1, producerEventId: `down-${i}`, type: 'service.health', occurredAt: w.h.store.now(), fields: f });
      }
      x.ingest({ sourceKey: 'app-operations.production', contractCode: 'ops.events', contractVersion: 1, producerEventId: 'p-1', type: 'provider.status', occurredAt: w.h.store.now(), fields: { provider: 'provider-a', state: 'UNAVAILABLE' } });
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_proposals'), 0);
      assert.equal(n(w.h, `SELECT COUNT(*) AS n FROM approvals WHERE action = 'app-control.issue'`), 0);
      assert.deepEqual(w.controls.issuedControls().controls, [], 'no maintenance, kill switch or route hold is inferred from an outage');
    });
  });

  test('(55, 56, 58) control events and audit are content-free; no secret, credential, private or free-text column exists', () => {
    withWorld((w) => {
      issued(w, { family: 'MAINTENANCE_MODE', scope: { kind: 'APP' }, operation: 'SET', value: { reason: 'PLANNED_MAINTENANCE' }, reasonCode: 'ops.window', expectedRevision: 0 });
      const events = raw(w.h).all<{ type: string; payload_json: string }>(`SELECT type, payload_json FROM events WHERE aggregate_type = 'app_control' ORDER BY seq`);
      assert.deepEqual(events.map((e) => e.type), ['app_control.proposed', 'app_control.proposal_changed', 'app_control.proposal_changed', 'app_control.revision_issued'], 'proposed, reviewed, issued');
      assert.deepEqual(Object.keys(JSON.parse(events[3]?.payload_json ?? '{}')).sort(), ['digest', 'family', 'operation', 'revision', 'revisionId'], 'ids, codes and a digest only');
      for (const e of events) assert.doesNotMatch(e.payload_json, /PLANNED_MAINTENANCE|ops\.window|evidence|external_record/, 'no value, reason or evidence in the outbox');
      const audit = raw(w.h).all<{ details_json: string }>(`SELECT details_json FROM audit_events WHERE action LIKE 'app_control.%'`);
      assert.ok(audit.length >= 3);
      for (const a of audit) assert.doesNotMatch(a.details_json, /PLANNED_MAINTENANCE|evidence|external_record|"value"/, 'audit carries ids and codes only');
      const cols = raw(w.h).all<{ sql: string }>(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name LIKE 'app_%'`).map((r) => r.sql).join('\n');
      assert.doesNotMatch(cols, /\b\w*(?:secret|token|credential|password|api_?key|private_?key|signing|signature|transcript|prompt|conversation|message|content|user_id|email|phone)\w*\s+(?:TEXT|BLOB|INTEGER)/i);
    });
  });

  test('the Founder decides on a decision-ready structured preview of exactly the reviewed act (never free text)', () => {
    withWorld((w) => {
      const r = reviewed(w, flag('EMERGENCY_DISABLED'));
      const auth = FounderAuthStore.for(w.h.store);
      const session = auth.redeemLaunchToken(auth.mintLaunchToken().token).session;
      const actions = FounderActionStore.for(w.h.store, auth);
      const p = actions.preview(session, 'APPROVAL_DECIDE', { approvalId: r.proposal.approvalId, decision: 'APPROVE' });
      assert.deepEqual(
        { family: p.payload.controlFamily, scope: p.payload.controlScope, operation: p.payload.controlOperation, value: p.payload.controlValue, from: p.payload.controlFrom, reason: p.payload.controlReason, evidence: p.payload.controlEvidenceRefs, review: p.payload.controlReview, risk: p.payload.risk },
        { family: 'FEATURE_FLAG', scope: '{"capability":"voice.call","kind":"CAPABILITY"}', operation: 'SET', value: 'EMERGENCY_DISABLED', from: 'NONE', reason: 'incident.voice-errors', evidence: ['external_record:00000000-0000-4000-8000-000000000001'], review: 'SATISFIED', risk: 'R3' },
      );
      const done = actions.confirm(session, p.id, p.fingerprint);
      assert.equal(done.resultRef, `approval:${r.proposal.approvalId}`);
      assert.equal(w.controls.proposal(r.proposal.id).state, 'ISSUED', 'confirmation commits exactly once');
      assert.throws(() => actions.confirm(session, p.id, p.fingerprint), code('FOUNDER_CONFIRMATION_REQUIRED'), 'a replayed confirmation does nothing');
      assert.equal(n(w.h, 'SELECT COUNT(*) AS n FROM app_control_revisions'), 1);
    });
  });
});

// =================================================================================================================
describe('C7-B closes the Company-side storage amplification of C7-A refusals (R-C7A-04)', () => {
  test('(60–63) repeated refusals are counted, not audited row by row; no content is kept; attacker strings never become keys; accepted intake is unaffected', () => {
    withWorld((w) => {
      const x = ExternalEvidenceStore.for(w.h.store);
      const src = x.registerSource(w.s.founder, { sourceKey: 'app-operations.production', family: 'APP_OPERATIONS', contractCode: 'ops.events', contractVersion: 1 }).source;
      x.decideSource(w.s.founder, src.id, { decision: 'ACTIVATE', reasonCode: 'founder.trusted' });
      const audits = (): number => n(w.h, `SELECT COUNT(*) AS n FROM audit_events WHERE action = 'external.intake_rejected'`);
      // 200 refusals with 200 different attacker-chosen source keys and private content: ONE counter, ONE audit row.
      for (let i = 0; i < 200; i++) assert.throws(() => x.ingest({ sourceKey: `attacker-${i}-${'z'.repeat(i % 7)}`, contractCode: 'ops.events', contractVersion: 1, producerEventId: `x-${i}`, type: 'service.health', occurredAt: w.h.store.now(), fields: { service: 'voice-api', state: 'DOWN' } }), code('INTAKE_REJECTED'));
      for (let i = 0; i < 50; i++) assert.throws(() => x.ingest({ sourceKey: 'app-operations.production', contractCode: 'ops.events', contractVersion: 1, producerEventId: `t-${i}`, type: 'service.health', occurredAt: w.h.store.now(), fields: { service: 'voice-api', state: 'DOWN', transcript: `secret conversation ${i}` } }), code('INTAKE_REJECTED'));
      assert.equal(audits(), 2, 'the first refusal of each (source, reason, window) is audited; the rest are counted');
      const windows = raw(w.h).all<{ source_ref: string; reason_code: string; refusals: number }>('SELECT source_ref, reason_code, refusals FROM external_intake_refusal_windows ORDER BY source_ref');
      assert.equal(windows.length, 2, '(63) 200 distinct attacker strings created no new key');
      assert.deepEqual(windows.map((r) => r.refusals).sort((a, b) => a - b), [50, 200]);
      assert.ok(windows.every((r) => r.source_ref === 'unresolved' || r.source_ref === src.id));
      const dump = JSON.stringify(raw(w.h).all('SELECT * FROM external_intake_refusal_windows')) + JSON.stringify(raw(w.h).all(`SELECT * FROM audit_events WHERE action LIKE 'external.%'`));
      assert.doesNotMatch(dump, /attacker|secret conversation|voice-api/, '(61) nothing of a refused payload is kept');
      assert.equal(x.health().perSource.find((p) => p.sourceId === src.id)?.rejected, 50, 'health counts every refusal of the source');
      // A later window: one new audit row (first / material evidence per window); the counters only grow.
      w.h.clock.advance(3_600_000);
      assert.throws(() => x.ingest({ sourceKey: 'nobody', contractCode: 'ops.events', contractVersion: 1, producerEventId: 'y', type: 'service.health', occurredAt: w.h.store.now(), fields: {} }), code('INTAKE_REJECTED'));
      assert.equal(audits(), 3);
      aborts(() => raw(w.h).run(`INSERT INTO external_intake_refusal_windows (source_ref, reason_code, window_start, refusals, first_at, last_at) VALUES (?, 'X', '2026-01-01T00:00:00.000Z', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`, newId()), 'a key is a registered source or unresolved');
      aborts(() => raw(w.h).run('DELETE FROM external_intake_refusal_windows'), 'counters are durable');
      aborts(() => raw(w.h).run('UPDATE external_intake_refusal_windows SET refusals = 1'), 'counters only count forward');
      // (62) valid intake is unaffected; a repeated conflicting replay is counted, not audited row by row.
      const ok = x.ingest({ sourceKey: 'app-operations.production', contractCode: 'ops.events', contractVersion: 1, producerEventId: 'ok-1', type: 'service.health', occurredAt: w.h.store.now(), fields: { service: 'voice-api', state: 'UP' } });
      assert.equal(ok.outcome, 'ACCEPTED');
      for (let i = 0; i < 20; i++) assert.throws(() => x.ingest({ sourceKey: 'app-operations.production', contractCode: 'ops.events', contractVersion: 1, producerEventId: 'ok-1', type: 'service.health', occurredAt: w.h.store.now(), fields: { service: 'voice-api', state: 'DOWN' } }), code('INTAKE_CONFLICT'));
      assert.equal(n(w.h, `SELECT COUNT(*) AS n FROM audit_events WHERE action = 'external.intake_conflict'`), 2, 'the new conflict and the first repeat of the window');
      assert.equal(n(w.h, `SELECT refusals AS n FROM external_intake_refusal_windows WHERE reason_code = 'CONFLICTING_REPLAY_REPEATED'`), 19);
    });
  });
});

// =================================================================================================================
describe('C7-B and C6: an issued control is not an outcome', () => {
  test('(64, 65) issuance creates no verification, evaluation, attribution, lesson or performance claim', () => {
    withWorld((w) => {
      const tables = ['outcome_verifications', 'evaluation_results', 'causal_attributions', 'lessons', 'learning_signals'];
      const before = tables.map((t) => n(w.h, `SELECT COUNT(*) AS n FROM ${t}`));
      const i = issued(w, flag('DISABLED'));
      settle(w.h.store, i.run.claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'control.proposed' } }, { backoff });
      assert.deepEqual(tables.map((t) => n(w.h, `SELECT COUNT(*) AS n FROM ${t}`)), before, 'outcome requires evidence; issuance is not a successful outcome');
      assert.equal(n(w.h, `SELECT COUNT(*) AS n FROM sqlite_schema WHERE type = 'table' AND name LIKE 'app_control%' AND (name LIKE '%outcome%' OR name LIKE '%evaluat%' OR name LIKE '%lesson%' OR name LIKE '%score%')`), 0, 'no parallel control-performance store');
    });
  });
});
