/**
 * C7-A storage proofs — governed sources, content-free intake, idempotency / provenance, privacy, the separation of
 * operational facts from outcome evidence, and the integration into the EXISTING C6 engine (outcome verification by
 * the Founder or the Review Pool → evaluation → attribution → reports), durability and upgrade from released v11.
 * Everything runs through the real paths (Founder chokepoint, governed confirmation, Review Pool, C6 evaluator).
 * C7A-PROOF: storage-external-evidence
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { ManualClock, canonicalJson, isQandeelError, newId, sha256Hex, type Id } from '@qandeel-company/domain';
import { EXTERNAL_CONTRACTS, contractOf, normalizeOccurrence, type OutcomeJudgment } from '@qandeel-company/governance';
import { standardWorkOutcomeDefinition } from '@qandeel-company/mind';

import { AttentionStore, ExternalEvidenceStore, FounderActionStore, FounderAuthStore, GoalStore, ImprovementStore, MemoryStore, RELEASED_MIGRATIONS, ReviewStore, loadReleasedMigrations, type EmployeeRecord } from '../src/index.js';
import { contractDigest } from '../src/external-evidence.js';
import { recordReviewDecision, reserveBudget, settle, settleReservation } from '../src/runtime-authority.js';
import { openStoreForTests, storeContext } from '../src/store.js';
import { disarmFounderTestSurface, armFounderTestSurface } from '../src/testing/founder-seam.js';
import { GOVERNED_KIND, seed, testManifest, type Seed } from './c2-helpers.js';
import { activeReviewer, claimItem, reviewPlan } from './c4-helpers.js';
import { backoff, harness, owner, removeRoot, tempRoot, type Harness } from './helpers.js';

const code = (c: string) => (e: unknown): boolean => isQandeelError(e) && e.code === c;
const reason = (r: string) => (e: unknown): boolean => isQandeelError(e) && e.details.reason === r;
const refusedBy = (r: string) => (e: unknown): boolean => isQandeelError(e, 'INTAKE_REJECTED') && e.details.reason === r;
const POOL = reviewPlan({ appliesTo: 'OUTPUT', operationalJudgment: 'REVIEW_POOL' });
const FOUNDER_PLAN = reviewPlan({ appliesTo: 'OUTPUT' });

interface X {
  readonly h: Harness;
  readonly s: Seed;
  readonly m: ImprovementStore;
  readonly x: ExternalEvidenceStore;
}

function withSeed(fn: (x: X) => void): void {
  const h = harness();
  try {
    const s = seed(h.store);
    const m = ImprovementStore.for(h.store);
    const d = m.registerDefinition(s.founder, standardWorkOutcomeDefinition());
    m.activateDefinition(s.founder, d.id, m.calibrateDefinition(s.founder, d.id).id);
    // One Academy-certified, Founder-admitted reviewer: ordinary work is independently reviewed before any outcome.
    activeReviewer(h, s);
    fn({ h, s, m, x: ExternalEvidenceStore.for(h.store) });
  } finally {
    h.close();
  }
}

const db = (x: X) => storeContext(x.h.store).db;
const count = (x: X, sql: string, ...p: string[]): number => Number(db(x).get<{ n: number }>(sql, ...p)?.n ?? 0);

/** A governed outcome source, registered and (by default) activated by the Founder. */
function outcomeSource(x: X, key = 'web-analytics.main', family = 'WEB_ANALYTICS', activate = true): Id {
  const src = x.x.registerSource(x.s.founder, { sourceKey: key, family, contractCode: 'outcome.metrics', contractVersion: 1 }).source;
  if (activate) x.x.decideSource(x.s.founder, src.id, { decision: 'ACTIVATE', reasonCode: 'founder.trusted' });
  return src.id;
}
function opsSource(x: X, key = 'app-operations.production', activate = true): Id {
  const src = x.x.registerSource(x.s.founder, { sourceKey: key, family: 'APP_OPERATIONS', contractCode: 'ops.events', contractVersion: 1 }).source;
  if (activate) x.x.decideSource(x.s.founder, src.id, { decision: 'ACTIVATE', reasonCode: 'founder.trusted' });
  return src.id;
}

const OCCURRED = '2026-09-26T10:00:00.000Z';
const metric = (producerEventId: string, value = 1200, patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  sourceKey: 'web-analytics.main',
  contractCode: 'outcome.metrics',
  contractVersion: 1,
  producerEventId,
  type: 'web.sessions',
  occurredAt: OCCURRED,
  scope: { kind: 'SITE', ref: 'qandeel-site' },
  window: { from: '2026-09-19T00:00:00.000Z', to: '2026-09-26T00:00:00.000Z' },
  fields: { value },
  ...patch,
});
const opsEvent = (producerEventId: string, type = 'service.health', fields: Record<string, unknown> = { service: 'voice-api', state: 'DOWN' }, occurredAt = OCCURRED): Record<string, unknown> => ({
  sourceKey: 'app-operations.production',
  contractCode: 'ops.events',
  contractVersion: 1,
  producerEventId,
  type,
  occurredAt,
  fields,
});

/** Ordinary governed work prepared by the Founder (budget + plan) and executed by the Employee to its review. */
function prepared(x: X, plan: Record<string, unknown> = FOUNDER_PLAN, who: EmployeeRecord = x.s.employee, withCost = false): Id {
  const { workItem } = x.h.store.createWorkItem({ objective: 'governed growth work', ownerRef: who.ref, processorKind: GOVERNED_KIND, processorInput: { taskClass: 'draft.memo', dataClass: 'D1', instructions: 'x' } });
  x.s.gov.createBudget(x.s.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 100_000, capTokens: 100_000, reasonCode: 'seed' });
  ReviewStore.for(x.h.store).declarePlan(x.s.founder, workItem.id, plan);
  if (x.h.store.getWorkItem(workItem.id).state === 'PROPOSED') x.h.store.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  const claim = claimItem(x.h, workItem.id, `w-${newId().slice(0, 8)}`);
  if (withCost) {
    // One governed model call on the usage ledger: a qualified outcome with cost evidence can be a smart success.
    const r = reserveBudget(x.h.store, claim.fence, { purpose: 'MODEL_CALL', attemptKind: 'PRIMARY', deploymentId: x.s.deploymentId, priceCardId: x.s.priceCardId, routePolicyId: x.s.policyId, money: 1_000, tokens: 1_000, contextManifestId: testManifest(x.h, claim.fence, who.id) });
    assert.ok(r.ok, 'the model call is reserved');
    if (r.ok) settleReservation(x.h.store, claim.fence, r.reservation.id, { inputTokens: 100, outputTokens: 50, withinBounds: true, sessionId: null, outcome: 'OK' });
  }
  settle(x.h.store, claim.fence, { type: 'COMPLETED', evidence: { summaryCode: 'draft.ready' } }, { backoff });
  return workItem.id;
}

/** One key of the open output review decides from the reviewer's own run, citing `evidenceRefs`. */
function review(x: X, workItemId: Id, outcome: 'PASS' | 'FAIL', judgment: OutcomeJudgment | null = null, evidenceRefs: string[] = ['evidence:rubric']): ReturnType<typeof recordReviewDecision> {
  const rv = ReviewStore.for(x.h.store);
  const request = rv.requests({ workItemId }).find((r) => r.state === 'OPEN');
  const key = request ? rv.assignments(request.id).find((a) => a.keyKind === 'SPECIALIST' && a.state === 'ASSIGNED') : undefined;
  assert.ok(key?.reviewWorkItemId, 'a qualified independent reviewer is assigned');
  const claim = claimItem(x.h, key.reviewWorkItemId, `w-${newId().slice(0, 8)}`);
  const out = recordReviewDecision(x.h.store, claim.fence, { outcome, reasonCode: 'rubric.applied', rationale: null, evidenceRefs, outcomeJudgment: judgment });
  settle(x.h.store, claim.fence, { type: 'COMPLETED' }, { backoff });
  return out;
}

/** A reviewed Work Item (Founder-judged plan) whose outcome is still unverified. */
function reviewedWork(x: X, withCost = false): Id {
  const w = prepared(x, FOUNDER_PLAN, x.s.employee, withCost);
  review(x, w, 'PASS');
  assert.equal(x.h.store.getWorkItem(w).state, 'REVIEWED');
  return w;
}

const bind = (x: X, recordId: Id, subjectId: Id, role = 'OUTCOME_EVIDENCE', subjectKind = 'WORK_ITEM') => x.x.bindEvidence(x.s.founder, { recordId, subjectKind, subjectId, role, reasonCode: 'founder.relevant' }).binding;
const verifyExternal = (x: X, w: Id, refs: string[], verdict: 'ACHIEVED' | 'NOT_ACHIEVED' = 'ACHIEVED', classes = ['EXTERNAL_OUTCOME', 'REVIEW_DECISION']) =>
  x.m.verifyOutcome(x.s.founder, w, { verdict, evidenceClasses: classes, evidenceRefs: refs, reasonCode: 'founder.verified' });

function founderActions(x: X): { actions: FounderActionStore; session: ReturnType<FounderAuthStore['redeemLaunchToken']>['session'] } {
  const auth = FounderAuthStore.for(x.h.store);
  const { token } = auth.mintLaunchToken();
  return { actions: FounderActionStore.for(x.h.store, auth), session: auth.redeemLaunchToken(token).session };
}

/** Every text the Company keeps about its operations (telemetry) plus every C7-A table, as one string. */
function everything(x: X): string {
  const tables = ['audit_events', 'events', 'external_sources', 'external_source_history', 'external_source_contracts', 'external_records', 'external_record_conflicts', 'external_evidence_bindings', 'external_binding_history', 'outcome_verifications'];
  return tables.map((t) => JSON.stringify(db(x).all(`SELECT * FROM ${t}`))).join('\n');
}

// =================================================================================================================
describe('C7-A source governance: nothing becomes trusted without a Founder decision', () => {
  test('(1, 2) an unregistered source cannot ingest; DRAFT, SUSPENDED and RETIRED sources create no evidence (code and datastore)', () => {
    withSeed((x) => {
      assert.throws(() => x.x.ingest(metric('m-1')), refusedBy('UNREGISTERED_SOURCE'));
      assert.equal(count(x, `SELECT COUNT(*) AS n FROM audit_events WHERE action = 'external.intake_rejected' AND entity_id = 'unresolved' AND reason_code = 'UNREGISTERED_SOURCE'`), 1, 'the refusal is audited by reason code');
      const id = outcomeSource(x, 'web-analytics.main', 'WEB_ANALYTICS', false);
      assert.equal(x.x.source(id).state, 'DRAFT');
      assert.throws(() => x.x.ingest(metric('m-1')), refusedBy('SOURCE_NOT_ACTIVE'));
      // The datastore refuses a record of a non-ACTIVE source even if code were bypassed.
      const contractId = x.x.source(id).contract?.id as Id;
      const raw = (sourceId: Id) => () =>
        db(x).immediate('bypass', () =>
          db(x).run(`INSERT INTO external_records (id, source_id, contract_id, producer_event_id, lane, record_type, domain, occurred_at, received_at, scope_kind, scope_ref, window_from, window_to, value_num, unit, normalized_fields_json, user_scoped, failure_signal, fingerprint, status)
            VALUES (?, ?, ?, 'forged', 'EXTERNAL_OUTCOME', 'web.sessions', 'WEB_ANALYTICS', ?, ?, 'SITE', 'qandeel-site', NULL, NULL, 5, 'COUNT', '{}', 0, 0, ?, 'ACCEPTED')`, newId(), sourceId, contractId, OCCURRED, OCCURRED, 'a'.repeat(64)));
      assert.throws(raw(id), code('STORAGE_INVARIANT'));
      x.x.decideSource(x.s.founder, id, { decision: 'ACTIVATE', reasonCode: 'founder.trusted' });
      assert.equal(x.x.ingest(metric('m-1')).outcome, 'ACCEPTED');
      x.x.decideSource(x.s.founder, id, { decision: 'SUSPEND', reasonCode: 'founder.untrusted' });
      assert.throws(() => x.x.ingest(metric('m-2')), refusedBy('SOURCE_NOT_ACTIVE'));
      assert.throws(raw(id), code('STORAGE_INVARIANT'));
      x.x.decideSource(x.s.founder, id, { decision: 'RETIRE', reasonCode: 'founder.retired' });
      assert.throws(() => x.x.ingest(metric('m-3')), refusedBy('SOURCE_NOT_ACTIVE'));
      assert.equal(count(x, 'SELECT COUNT(*) AS n FROM external_records'), 1, 'only the occurrence of the ACTIVE period is evidence');
    });
  });

  test('(3) registering and activating a source uses the existing authority path: fails closed without the Founder surface, refuses an Employee, and works through the governed confirmation', () => {
    withSeed((x) => {
      assert.throws(() => x.x.registerSource(x.s.employee.ref, { sourceKey: 'search.console', family: 'SEARCH', contractCode: 'outcome.metrics', contractVersion: 1 }), (e) => isQandeelError(e) && ['FOUNDER_ONLY', 'AUTHORITY_DENIED', 'SELF_ESCALATION_REFUSED'].includes(e.code));
      const draft = x.x.registerSource(x.s.founder, { sourceKey: 'store.listing', family: 'APP_STORE', contractCode: 'outcome.metrics', contractVersion: 1 }).source;
      assert.throws(() => x.x.decideSource(x.s.employee.ref, draft.id, { decision: 'ACTIVATE', reasonCode: 'self' }), (e) => isQandeelError(e) && ['FOUNDER_ONLY', 'AUTHORITY_DENIED', 'SELF_ESCALATION_REFUSED'].includes(e.code), 'an Employee never activates a source');
      assert.equal(x.x.source(draft.id).state, 'DRAFT');
      disarmFounderTestSurface(x.h.store.workspace.root);
      assert.throws(() => x.x.registerSource(x.s.founder, { sourceKey: 'search.console', family: 'SEARCH', contractCode: 'outcome.metrics', contractVersion: 1 }), code('FOUNDER_SURFACE_UNAVAILABLE'));
      armFounderTestSurface(x.h.store.workspace.root);
      // Through the governed confirmation (C5 preview → explicit, fingerprinted confirm) — the production path.
      const { actions, session } = founderActions(x);
      assert.throws(() => actions.preview(session, 'SOURCE_REGISTER', { sourceKey: 'search.console', family: 'SEARCH', contractCode: 'outcome.metrics', contractVersion: 9 }), reason('UNKNOWN_CONTRACT'));
      assert.throws(() => actions.preview(session, 'SOURCE_REGISTER', { sourceKey: 'search.console', family: 'APP_OPERATIONS', contractCode: 'outcome.metrics', contractVersion: 1 }), reason('CONTRACT_FAMILY_MISMATCH'));
      const reg = actions.preview(session, 'SOURCE_REGISTER', { sourceKey: 'search.console', family: 'SEARCH', contractCode: 'outcome.metrics', contractVersion: 1 });
      const sourceId = actions.confirm(session, reg.id, reg.fingerprint).resultRef.slice('external_source:'.length) as Id;
      assert.equal(x.x.source(sourceId).state, 'DRAFT');
      // A source awaiting the activation decision is a material Founder decision (and only that).
      AttentionStore.for(x.h.store).sync();
      assert.ok(AttentionStore.for(x.h.store).list().some((i) => i.sourceRef === `external_source:${sourceId}` && i.lane === 'NEEDS_ME'));
      assert.throws(() => actions.preview(session, 'SOURCE_DECIDE', { sourceId, decision: 'SUSPEND' }), code('INVALID_TRANSITION'), 'a preview never offers a step the lifecycle refuses');
      const act = actions.preview(session, 'SOURCE_DECIDE', { sourceId, decision: 'ACTIVATE', reasonCode: 'founder.trusted' });
      actions.confirm(session, act.id, act.fingerprint);
      const src = x.x.source(sourceId);
      assert.equal(src.state, 'ACTIVE');
      assert.match(String(src.decidedByRef), /^founder:/);
      AttentionStore.for(x.h.store).sync();
      assert.ok(!AttentionStore.for(x.h.store).list().some((i) => i.sourceRef === `external_source:${sourceId}`), 'the decision resolves the attention item');
      // Content-free outbox events of the external_source aggregate, in the same transactions.
      const events = db(x).all<{ type: string; payload_json: string }>(`SELECT type, payload_json FROM events WHERE aggregate_type = 'external_source' AND aggregate_id = ? ORDER BY seq`, sourceId);
      assert.deepEqual(events.map((e) => e.type), ['external_source.registered', 'external_source.state_changed']);
    });
  });

  test('(4) source version / schema drift fails closed; a new contract version supersedes the old one only by the Founder', () => {
    withSeed((x) => {
      const id = outcomeSource(x);
      assert.throws(() => x.x.ingest(metric('m-1', 5, { contractVersion: 2 })), refusedBy('UNKNOWN_CONTRACT'));
      assert.throws(() => x.x.ingest({ ...opsEvent('m-1'), sourceKey: 'web-analytics.main' }), refusedBy('CONTRACT_MISMATCH'));
      assert.throws(() => x.x.registerSource(x.s.founder, { sourceKey: 'web-analytics.main', family: 'WEB_ANALYTICS', contractCode: 'outcome.metrics', contractVersion: 2 }), reason('UNKNOWN_CONTRACT'));
      assert.equal(x.x.registerSource(x.s.founder, { sourceKey: 'web-analytics.main', family: 'WEB_ANALYTICS', contractCode: 'outcome.metrics', contractVersion: 1 }).changed, false, 'the same contract is idempotent');
      assert.throws(() => x.x.registerSource(x.s.founder, { sourceKey: 'web-analytics.main', family: 'SEARCH', contractCode: 'outcome.metrics', contractVersion: 1 }), reason('SOURCE_IDENTITY_IMMUTABLE'));
      // D-C7A-10: the datastore holds this release's contract catalogue — a version it does not catalogue, or a digest that
      // is not the catalogued one, cannot even be registered, whoever writes.
      assert.ok(Object.isFrozen(contractOf('outcome.metrics', 1)?.metrics), 'a pinned contract cannot change in-process');
      const forgeContract = (version: number, sha: string) => () =>
        db(x).immediate('forge a contract', () => {
          db(x).run(`UPDATE external_source_contracts SET state = 'SUPERSEDED', updated_at = ? WHERE source_id = ? AND state = 'CURRENT'`, OCCURRED, id);
          db(x).run(`INSERT INTO external_source_contracts (id, source_id, contract_code, contract_version, contract_sha256, state, registered_by_ref, created_at, updated_at) VALUES (?, ?, 'outcome.metrics', ?, ?, 'CURRENT', ?, ?, ?)`, newId(), id, version, sha, x.s.founder, OCCURRED, OCCURRED);
        });
      assert.throws(forgeContract(7, 'b'.repeat(64)), code('STORAGE_INVARIANT'), 'a contract version this release does not catalogue');
      assert.throws(forgeContract(1, 'd'.repeat(64)), code('STORAGE_INVARIANT'), 'a digest that is not the catalogued one');
      assert.throws(() => db(x).immediate('re-catalogue', () => db(x).run(`UPDATE external_contract_catalog SET contract_sha256 = ?`, 'd'.repeat(64))), code('STORAGE_INVARIANT'), 'the catalogue is frozen');
      // A database whose catalogue predates a definition change made WITHOUT a version bump (simulated: a database without
      // this release's registration guard, holding a source pinned to an older digest): intake fails closed in code.
      const drifted = newId();
      db(x).immediate('pinned to an older definition', () => {
        db(x).run('DROP TRIGGER external_source_contracts_catalogued');
        db(x).run(`INSERT INTO external_sources (id, source_key, lane, family, state, registered_by_ref, decided_by_ref, decision_reason_code, version, created_at, updated_at) VALUES (?, 'search.drifted', 'EXTERNAL_OUTCOME', 'SEARCH', 'DRAFT', ?, NULL, NULL, 1, ?, ?)`, drifted, x.s.founder, OCCURRED, OCCURRED);
        db(x).run(`INSERT INTO external_source_history (source_id, version, from_state, to_state, reason_code, actor_ref, occurred_at) VALUES (?, 1, NULL, 'DRAFT', 'source.registered', ?, ?)`, drifted, x.s.founder, OCCURRED);
        db(x).run(`INSERT INTO external_source_contracts (id, source_id, contract_code, contract_version, contract_sha256, state, registered_by_ref, created_at, updated_at) VALUES (?, ?, 'outcome.metrics', 1, ?, 'CURRENT', ?, ?, ?)`, newId(), drifted, 'd'.repeat(64), x.s.founder, OCCURRED, OCCURRED);
      });
      x.x.decideSource(x.s.founder, drifted, { decision: 'ACTIVATE', reasonCode: 'founder.trusted' });
      assert.throws(() => x.x.ingest({ ...metric('m-drift', 5, { type: 'search.clicks' }), sourceKey: 'search.drifted' }), refusedBy('CONTRACT_DRIFT'));
      assert.equal(x.x.ingest(metric('m-ok')).outcome, 'ACCEPTED', 'a source pinned to the current definition validates');
      assert.throws(() => db(x).immediate('rewrite', () => db(x).run(`UPDATE external_source_contracts SET contract_sha256 = ? WHERE source_id = ? AND state = 'CURRENT'`, 'c'.repeat(64), id)), code('STORAGE_INVARIANT'), 'a contract version is immutable');
    });
  });

  test('(5) source history is never deleted; RETIRED is final', () => {
    withSeed((x) => {
      const id = outcomeSource(x);
      x.x.decideSource(x.s.founder, id, { decision: 'SUSPEND', reasonCode: 'founder.paused' });
      x.x.decideSource(x.s.founder, id, { decision: 'ACTIVATE', reasonCode: 'founder.resumed' });
      x.x.decideSource(x.s.founder, id, { decision: 'RETIRE', reasonCode: 'founder.retired' });
      assert.deepEqual(x.x.sourceHistory(id).map((r) => [r.from, r.to]), [[null, 'DRAFT'], ['DRAFT', 'ACTIVE'], ['ACTIVE', 'SUSPENDED'], ['SUSPENDED', 'ACTIVE'], ['ACTIVE', 'RETIRED']]);
      assert.throws(() => x.x.decideSource(x.s.founder, id, { decision: 'ACTIVATE', reasonCode: 'x' }), code('INVALID_TRANSITION'));
      assert.throws(() => x.x.registerSource(x.s.founder, { sourceKey: 'web-analytics.main', family: 'WEB_ANALYTICS', contractCode: 'outcome.metrics', contractVersion: 1 }), code('INVALID_TRANSITION'));
      for (const sql of ['DELETE FROM external_sources', 'DELETE FROM external_source_history', 'DELETE FROM external_source_contracts', `UPDATE external_sources SET state = 'ACTIVE', version = version + 1`]) {
        assert.throws(() => db(x).immediate('erase', () => db(x).run(sql)), code('STORAGE_INVARIANT'), sql);
      }
    });
  });
});

// =================================================================================================================
describe('C7-A idempotency and provenance', () => {
  test('(6, 7, 10) a first occurrence is accepted once; an exact replay (any key order) is a no-op returning the canonical record; its ref resolves deterministically', () => {
    withSeed((x) => {
      const sourceId = outcomeSource(x);
      const first = x.x.ingest(metric('m-1'));
      assert.equal(first.outcome, 'ACCEPTED');
      const before = { audit: count(x, 'SELECT COUNT(*) AS n FROM audit_events'), events: count(x, 'SELECT COUNT(*) AS n FROM events') };
      const reordered = Object.fromEntries(Object.entries(metric('m-1')).reverse());
      const again = x.x.ingest(reordered);
      assert.deepEqual([again.outcome, again.changed, again.record.id], ['DUPLICATE', false, first.record.id]);
      assert.deepEqual({ audit: count(x, 'SELECT COUNT(*) AS n FROM audit_events'), events: count(x, 'SELECT COUNT(*) AS n FROM events') }, before, 'an exact replay writes no history, audit or event');
      // Provenance: source, contract, producer identity, both times, the normalized fingerprint — and the ref resolves.
      const r = x.x.record(first.record.ref.slice('external_record:'.length));
      assert.equal(r.sourceId, sourceId);
      assert.equal(r.contractId, x.x.source(sourceId).contract?.id);
      assert.equal(r.producerEventId, 'm-1');
      assert.deepEqual([r.lane, r.type, r.domain, r.value, r.unit, r.scope?.kind, r.window?.from], ['EXTERNAL_OUTCOME', 'web.sessions', 'WEB_ANALYTICS', 1200, 'COUNT', 'SITE', '2026-09-19T00:00:00.000Z']);
      const n = normalizeOccurrence(metric('m-1'), { family: 'WEB_ANALYTICS', contractCode: 'outcome.metrics', contractVersion: 1 }, r.receivedAt as never);
      assert.equal(r.fingerprint, sha256Hex(canonicalJson(n.identity)), 'the fingerprint is the canonical identity of the normalized occurrence');
      assert.equal(count(x, `SELECT COUNT(*) AS n FROM events WHERE type = 'external_record.accepted' AND aggregate_id = ?`, sourceId), 1);
    });
  });

  test('(8) the same producer identity with a different fingerprint is a conflicting replay: refused, recorded, audited, never applied, and the record stops being usable evidence', () => {
    withSeed((x) => {
      const sourceId = outcomeSource(x);
      const first = x.x.ingest(metric('m-1', 1200)).record;
      // A 9-digit sentinel: a short number would also turn up by chance inside a random id or fingerprint.
      assert.throws(() => x.x.ingest(metric('m-1', 987654321)), (e) => isQandeelError(e, 'INTAKE_CONFLICT') && e.details.recordId === first.id);
      assert.equal(x.x.record(first.id).value, 1200, 'the first accepted record stands');
      assert.equal(x.x.record(first.id).conflicts, 1);
      assert.throws(() => x.x.ingest(metric('m-1', 987654321)), code('INTAKE_CONFLICT'));
      assert.equal(count(x, 'SELECT COUNT(*) AS n FROM external_record_conflicts'), 1, 'the same conflicting replay is recorded once');
      assert.equal(count(x, `SELECT COUNT(*) AS n FROM audit_events WHERE action = 'external.intake_conflict'`), 2, 'every conflicting replay is audited');
      assert.equal(count(x, `SELECT COUNT(*) AS n FROM events WHERE type = 'external_record.conflict_detected'`), 1);
      assert.ok(!everything(x).includes('987654321'), 'the conflicting value is never stored, audited or evented');
      // A source integrity conflict is a material exception for the Founder.
      AttentionStore.for(x.h.store).sync();
      assert.ok(AttentionStore.for(x.h.store).list().some((i) => i.dedupKey === `external_integrity:${sourceId}` && i.level === 'URGENT'));
      const w = reviewedWork(x);
      assert.throws(() => bind(x, first.id, w), reason('RECORD_CONFLICTED'));
      x.x.decideSource(x.s.founder, sourceId, { decision: 'SUSPEND', reasonCode: 'founder.integrity' });
      AttentionStore.for(x.h.store).sync();
      assert.ok(!AttentionStore.for(x.h.store).list().some((i) => i.dedupKey === `external_integrity:${sourceId}`), 'the Founder decision resolves it');
    });
  });

  test('(9) out-of-order delivery is allowed: event time and receipt time stay distinct; arrival order is not truth', () => {
    withSeed((x) => {
      opsSource(x);
      x.h.clock.advance(60_000);
      const late = x.x.ingest(opsEvent('o-2', 'session.status', { state: 'STARTED', count: 4 }, '2026-09-26T11:00:00.000Z')).record;
      x.h.clock.advance(60_000);
      const early = x.x.ingest(opsEvent('o-1', 'session.status', { state: 'FAILED', count: 1 }, '2026-09-26T09:00:00.000Z')).record;
      assert.ok(early.receivedAt > late.receivedAt && early.occurredAt < late.occurredAt);
      assert.deepEqual([early.occurredAt, late.occurredAt], ['2026-09-26T09:00:00.000Z', '2026-09-26T11:00:00.000Z']);
      assert.throws(() => x.x.ingest(opsEvent('o-3', 'session.status', { state: 'ENDED', count: 1 }, '2026-09-26T13:00:00.000Z')), refusedBy('OCCURRED_IN_FUTURE'));
    });
  });
});

// =================================================================================================================
describe('C7-A privacy: structural, allowlist-first, and nothing refused is kept', () => {
  const SECRET = 'eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.signature';
  const PRIVATE = 'my-private-conversation-with-qandeel';
  const cases: [string, Record<string, unknown>, string][] = [
    ['(11) a conversation / message text field', { fields: { service: 'voice-api', state: 'DOWN', message: PRIVATE } }, 'PRIVATE_CONTENT_FIELD'],
    ['(12) a transcript field', { fields: { service: 'voice-api', state: 'DOWN', transcript: PRIVATE } }, 'PRIVATE_CONTENT_FIELD'],
    ['(12) an audio field', { audio: PRIVATE }, 'PRIVATE_CONTENT_FIELD'],
    ['(12) a prompt field', { fields: { service: 'voice-api', state: 'DOWN', prompt: PRIVATE } }, 'PRIVATE_CONTENT_FIELD'],
    ['(12) a model output field', { fields: { service: 'voice-api', state: 'DOWN', modelOutput: PRIVATE } }, 'PRIVATE_CONTENT_FIELD'],
    ['(13) a Memory payload', { memory: { fact: PRIVATE } }, 'PRIVATE_CONTENT_FIELD'],
    ['(13) an Analysis payload', { fields: { service: 'voice-api', state: 'DOWN', analysis: PRIVATE } }, 'PRIVATE_CONTENT_FIELD'],
    ['(13) a World payload', { worldState: PRIVATE }, 'PRIVATE_CONTENT_FIELD'],
    ['(14) a credential field', { fields: { service: 'voice-api', state: 'DOWN', apiKey: PRIVATE } }, 'CREDENTIAL_FIELD'],
    ['(14) a token field', { accessToken: PRIVATE }, 'CREDENTIAL_FIELD'],
    ['(14) a secret-shaped value in a declared field', { fields: { service: SECRET, state: 'DOWN' } }, 'CREDENTIAL_VALUE'],
    ['(15) a raw request body', { rawBody: PRIVATE }, 'RAW_PAYLOAD_FIELD'],
    ['(15) a payload bag', { payload: { anything: PRIVATE } }, 'RAW_PAYLOAD_FIELD'],
    ['(16) a raw stack trace', { fields: { service: 'voice-api', state: 'DOWN', stackTrace: PRIVATE } }, 'RAW_PAYLOAD_FIELD'],
    ['(16) raw error text in a code field', { type: 'app.error', fields: { errorCode: 'TypeError: cannot read the user message', component: 'chat', count: 1 } }, 'FREE_TEXT_VALUE'],
    ['(17) a metadata bag', { metadata: { userText: PRIVATE } }, 'FREE_FORM_BAG'],
    ['(17) a labels bag inside fields', { fields: { service: 'voice-api', state: 'DOWN', labels: { k: PRIVATE } } }, 'FREE_FORM_BAG'],
    ['(17) an unknown innocuous-looking field', { fields: { service: 'voice-api', state: 'DOWN', region: PRIVATE } }, 'UNKNOWN_FIELD'],
    ['(17) an array smuggling values', { fields: { service: 'voice-api', state: ['DOWN', PRIVATE] } }, 'ARRAY_NOT_ALLOWED'],
  ];
  for (const [label, patch, why] of cases) {
    test(`${label} is refused (${why}) and never copied into storage, audit, outbox or the error`, () => {
      withSeed((x) => {
        opsSource(x);
        let error: unknown;
        try {
          x.x.ingest({ ...opsEvent('p-1'), ...patch });
        } catch (e) {
          error = e;
        }
        assert.ok(refusedBy(why)(error), `${label}: ${String(error)}`);
        assert.ok(!JSON.stringify({ message: (error as Error).message, details: (error as { details: unknown }).details }).includes(PRIVATE), '(18) the error echoes no content');
        assert.ok(!String((error as Error).message).includes(SECRET));
        const all = everything(x);
        assert.ok(!all.includes(PRIVATE) && !all.includes(SECRET), '(18) nothing refused reaches storage, audit or the outbox');
        assert.equal(count(x, 'SELECT COUNT(*) AS n FROM external_records'), 0);
        assert.equal(x.x.health().perSource[0]?.rejected, 1, 'the refusal counts against the source that sent it (by its registered id)');
        const audit = db(x).all<{ details_json: string }>(`SELECT details_json FROM audit_events WHERE action = 'external.intake_rejected' AND reason_code = ?`, why);
        assert.equal(audit.length, 1, 'the refusal itself is audited by code');
        const details = JSON.parse(String(audit[0]?.details_json)) as Record<string, unknown>;
        assert.ok(Object.keys(details).every((k) => k === 'field') && (details.field === undefined || /^[a-zA-Z]{2,24}$/.test(String(details.field))), '(18) the refusal audit carries a reason code and at most a DECLARED field name — no fragment of the refused occurrence');
      });
    });
  }

  test('(15, 17) the schema has no raw-payload column and the datastore refuses an undeclared field even if code were bypassed', () => {
    withSeed((x) => {
      const cols = ['external_sources', 'external_source_contracts', 'external_records', 'external_record_conflicts', 'external_evidence_bindings'].flatMap((t) => db(x).all<{ name: string }>(`SELECT name FROM pragma_table_info('${t}')`).map((c) => c.name));
      assert.deepEqual(cols.filter((c) => /raw|payload|body|content|text|message|transcript|prompt|pseudonym|user_ref|credential|secret|token/i.test(c)), []);
      const sourceId = opsSource(x);
      const contractId = x.x.source(sourceId).contract?.id as Id;
      const forged = (fields: string) => () =>
        db(x).immediate('bypass', () =>
          db(x).run(`INSERT INTO external_records (id, source_id, contract_id, producer_event_id, lane, record_type, domain, occurred_at, received_at, scope_kind, scope_ref, window_from, window_to, value_num, unit, normalized_fields_json, user_scoped, failure_signal, fingerprint, status)
            VALUES (?, ?, ?, ?, 'OPERATIONAL_EVENT', 'service.health', 'SERVICE_HEALTH', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, 0, 1, ?, 'ACCEPTED')`, newId(), sourceId, contractId, newId(), OCCURRED, OCCURRED, fields, 'a'.repeat(64)));
      assert.throws(forged(JSON.stringify({ service: 'voice-api', message: 'hello' })), code('STORAGE_INVARIANT'));
      assert.throws(forged(JSON.stringify({ service: 'voice api with spaces' })), code('STORAGE_INVARIANT'));
      assert.throws(forged(JSON.stringify({ userPseudonym: 'f'.repeat(64) })), code('STORAGE_INVARIANT'));
      assert.throws(forged(JSON.stringify({ service: { nested: 'x' } })), code('STORAGE_INVARIANT'));
    });
  });

  test('(19) a user-specific operational diagnostic is accepted content-free; its pseudonym is never stored and no read path browses per-user facts', () => {
    withSeed((x) => {
      opsSource(x);
      const pseudonym = 'ab'.repeat(32);
      const r = x.x.ingest(opsEvent('u-1', 'user.diagnostic', { userPseudonym: pseudonym, code: 'MIC_PERMISSION_DENIED', state: 'FAILED' })).record;
      assert.equal(r.userScoped, true);
      assert.deepEqual(r.fields, { code: 'MIC_PERMISSION_DENIED', state: 'FAILED' });
      assert.ok(!everything(x).includes(pseudonym), 'the pseudonym exists only inside the fingerprint hash');
      // Another user's identical diagnostic is a different occurrence identity (the pseudonym is in the fingerprint).
      const other = x.x.ingest(opsEvent('u-2', 'user.diagnostic', { userPseudonym: 'cd'.repeat(32), code: 'MIC_PERMISSION_DENIED', state: 'FAILED' })).record;
      assert.notEqual(other.fingerprint, r.fingerprint);
      assert.equal(x.x.health().userScopedRecords, 2, 'per-user facts are visible only as an aggregate count');
      // The store's whole surface: no per-user lookup, search, browse or export exists.
      const methods = Object.getOwnPropertyNames(ExternalEvidenceStore.prototype).filter((n) => n !== 'constructor').sort();
      assert.deepEqual(methods, ['availability', 'bindEvidence', 'bindings', 'decideSource', 'evidenceFor', 'health', 'ingest', 'record', 'registerSource', 'source', 'sourceHistory', 'sources', 'unbindEvidence']);
    });
  });
});

// =================================================================================================================
describe('C7-A operational facts vs outcome evidence: evidence is never a verdict', () => {
  test('(20) an operational event alone cannot verify Company work: it is never bindable as outcome evidence and never citable', () => {
    withSeed((x) => {
      opsSource(x);
      outcomeSource(x);
      const w = reviewedWork(x);
      const op = x.x.ingest(opsEvent('o-1')).record;
      assert.throws(() => bind(x, op.id, w), reason('OPERATIONAL_FACT_IS_NOT_OUTCOME_EVIDENCE'));
      const { actions, session } = founderActions(x);
      assert.throws(() => actions.preview(session, 'EVIDENCE_BIND', { recordId: op.id, subjectKind: 'WORK_ITEM', subjectId: w, role: 'OUTCOME_EVIDENCE' }), reason('OPERATIONAL_FACT_IS_NOT_OUTCOME_EVIDENCE'), 'the preview refuses it too');
      assert.throws(() => verifyExternal(x, w, [op.ref]), reason('NOT_OUTCOME_EVIDENCE'));
      assert.throws(
        () => db(x).immediate('bypass', () => db(x).run(`INSERT INTO external_evidence_bindings (id, record_id, role, subject_kind, subject_id, state, bound_by_ref, reason_code, ended_by_ref, end_reason_code, superseded_by, version, created_at, updated_at) VALUES (?, ?, 'OUTCOME_EVIDENCE', 'WORK_ITEM', ?, 'ACTIVE', ?, 'x', NULL, NULL, NULL, 1, ?, ?)`, newId(), op.id, w, x.s.founder, OCCURRED, OCCURRED)),
        code('STORAGE_INVARIANT'),
      );
      assert.equal(x.h.store.getWorkItem(w).state, 'REVIEWED');
    });
  });

  test('(21) an external outcome observation alone — accepted and even bound — never changes a Work Item', () => {
    withSeed((x) => {
      outcomeSource(x);
      const w = reviewedWork(x);
      const before = x.h.store.getWorkItem(w);
      const rec = x.x.ingest(metric('m-1')).record;
      bind(x, rec.id, w);
      const after = x.h.store.getWorkItem(w);
      assert.deepEqual([after.state, after.outcome, after.version], [before.state, before.outcome, before.version]);
      assert.equal(count(x, 'SELECT COUNT(*) AS n FROM outcome_verifications WHERE work_item_id = ?', w), 0, 'no verification is invented');
    });
  });

  test('(22) evidence bound to one Work Item cannot verify another (code and datastore)', () => {
    withSeed((x) => {
      outcomeSource(x);
      const w1 = reviewedWork(x);
      const w2 = reviewedWork(x);
      const rec = x.x.ingest(metric('m-1')).record;
      bind(x, rec.id, w1);
      assert.throws(() => verifyExternal(x, w2, [rec.ref]), reason('NOT_BOUND_TO_WORK_ITEM'));
      assert.throws(
        () => db(x).immediate('bypass', () => db(x).run(`INSERT INTO outcome_verifications (id, work_item_id, verdict, evidence_classes_json, evidence_refs_json, verifier_kind, verifier_ref, review_request_id, reason_code, created_at) VALUES (?, ?, 'ACHIEVED', '["EXTERNAL_OUTCOME"]', ?, 'FOUNDER', ?, NULL, 'x', ?)`, newId(), w2, JSON.stringify([rec.ref]), x.s.founder, OCCURRED)),
        code('STORAGE_INVARIANT'),
      );
      assert.equal(x.h.store.getWorkItem(w2).state, 'REVIEWED');
    });
  });

  test('(23) an Employee cannot bind favorable evidence to its own work, and a pool reviewer cannot verify around the binding authority', () => {
    withSeed((x) => {
      activeReviewer(x.h, x.s);
      outcomeSource(x);
      const w = prepared(x, POOL);
      const rec = x.x.ingest(metric('m-1')).record;
      // The executing Employee (and any Employee) has no binding authority — bindings are Founder decisions.
      assert.throws(() => x.x.bindEvidence(x.s.employee.ref, { recordId: rec.id, subjectKind: 'WORK_ITEM', subjectId: w, role: 'OUTCOME_EVIDENCE', reasonCode: 'mine' }), (e) => isQandeelError(e) && ['FOUNDER_ONLY', 'AUTHORITY_DENIED', 'SELF_ESCALATION_REFUSED'].includes(e.code));
      assert.throws(() => db(x).immediate('bypass', () => db(x).run(`INSERT INTO external_evidence_bindings (id, record_id, role, subject_kind, subject_id, state, bound_by_ref, reason_code, ended_by_ref, end_reason_code, superseded_by, version, created_at, updated_at) VALUES (?, ?, 'OUTCOME_EVIDENCE', 'WORK_ITEM', ?, 'ACTIVE', ?, 'x', NULL, NULL, NULL, 1, ?, ?)`, newId(), rec.id, w, x.s.employee.ref, OCCURRED, OCCURRED)), code('STORAGE_INVARIANT'));
      // A pool reviewer citing UNBOUND external evidence (or the class without records) records no judgment.
      const ext: OutcomeJudgment = { verdict: 'ACHIEVED', evidenceClasses: ['EXTERNAL_OUTCOME', 'REVIEW_DECISION'] };
      const rv = ReviewStore.for(x.h.store);
      const request = rv.requests({ workItemId: w }).find((r) => r.state === 'OPEN');
      const key = request ? rv.assignments(request.id).find((a) => a.keyKind === 'SPECIALIST' && a.state === 'ASSIGNED') : undefined;
      const run = claimItem(x.h, key?.reviewWorkItemId as Id, 'w-key');
      assert.equal(recordReviewDecision(x.h.store, run.fence, { outcome: 'PASS', reasonCode: 'rubric.applied', rationale: null, evidenceRefs: [rec.ref], outcomeJudgment: ext }).code, 'OUTCOME_EVIDENCE_INVALID');
      assert.equal(recordReviewDecision(x.h.store, run.fence, { outcome: 'PASS', reasonCode: 'rubric.applied', rationale: null, evidenceRefs: ['evidence:rubric'], outcomeJudgment: ext }).code, 'OUTCOME_EVIDENCE_INVALID');
      assert.equal(recordReviewDecision(x.h.store, run.fence, { outcome: 'PASS', reasonCode: 'rubric.applied', rationale: null, evidenceRefs: [`external_record:${newId()}`], outcomeJudgment: ext }).code, 'OUTCOME_EVIDENCE_INVALID', 'a forged reference is not evidence');
      assert.equal(count(x, 'SELECT COUNT(*) AS n FROM outcome_verifications WHERE work_item_id = ?', w), 0);
    });
  });

  test('(24, 30) a negative external result never blames the Employee automatically; a bound external dependency failure makes the proposed cause EXTERNAL_DEPENDENCY', () => {
    withSeed((x) => {
      outcomeSource(x);
      opsSource(x);
      // A: NOT_ACHIEVED on a measured result — the cause is only PROPOSED (nothing counts it until an independent decision).
      const a = reviewedWork(x);
      const low = x.x.ingest(metric('m-low', 3)).record;
      bind(x, low.id, a);
      verifyExternal(x, a, [low.ref], 'NOT_ACHIEVED');
      x.m.evaluate(a);
      const pa = x.m.attributions({ workItemId: a });
      assert.deepEqual(pa.map((p) => p.state), ['PROPOSED']);
      const profile = x.m.profile(x.s.employee.id);
      const outcome = profile.dimensions.find((d) => d.dimension === 'OUTCOME');
      assert.equal(outcome?.accountableNegative, 0, 'an unvalidated proposal never counts against the Employee');
      // The Founder may establish a non-employee cause: then nothing counts against the Employee.
      x.m.decideAttribution(x.s.founder, pa[0]?.id as Id, { decision: 'VALIDATE', reasonCode: 'founder.market', causes: [{ category: 'EXTERNAL_DEPENDENCY', role: 'PRIMARY', confidence: 'HIGH', basis: 'MARKET_SHIFT' }] });
      assert.equal(x.m.attributions({ workItemId: a, state: 'VALIDATED' })[0]?.employeeAccountable, false);
      // B: the work depended on an external service that was DOWN — Founder-bound as a dependency failure.
      const b = reviewedWork(x);
      const down = x.x.ingest(opsEvent('o-down')).record;
      assert.equal(down.failureSignal, true);
      const up = x.x.ingest(opsEvent('o-up', 'service.health', { service: 'voice-api', state: 'UP' })).record;
      assert.throws(() => bind(x, up.id, b, 'DEPENDENCY_FAILURE'), reason('ROLE_NOT_BINDABLE'), 'a healthy fact is no failure evidence');
      bind(x, down.id, b, 'DEPENDENCY_FAILURE');
      const lowB = x.x.ingest(metric('m-low-b', 2)).record;
      bind(x, lowB.id, b);
      verifyExternal(x, b, [lowB.ref], 'NOT_ACHIEVED');
      const ev = x.m.evaluate(b);
      assert.ok(ev.evaluation.evidenceRefs.includes(down.ref) && ev.evaluation.evidenceRefs.includes(lowB.ref), 'the evaluation cites the external evidence');
      const pb = x.m.attributions({ workItemId: b })[0];
      assert.deepEqual([pb?.overall, pb?.employeeAccountable], ['EXTERNAL_DEPENDENCY', false]);
    });
  });
});

// =================================================================================================================
describe('C7-A integration into the existing C6 engine', () => {
  test('(25) no governed source ⇒ external outcomes are unavailable everywhere (verification, definitions, reports, inspection)', () => {
    withSeed((x) => {
      const w = reviewedWork(x);
      assert.throws(() => verifyExternal(x, w, [`work_item:${w}`]), reason('EXTERNAL_OUTCOME_UNAVAILABLE'));
      const spec = { ...standardWorkOutcomeDefinition('work-outcome.external'), requiredEvidence: ['WORK_LINEAGE', 'EXTERNAL_OUTCOME'] as const };
      assert.throws(() => x.m.registerDefinition(x.s.founder, { ...spec, requiredEvidence: [...spec.requiredEvidence] }), code('EVAL_INVALID'));
      const weekly = x.m.generateReport('WEEKLY').report;
      const claim = weekly.claims.find((c) => c.code === 'EXTERNAL_OUTCOMES_UNAVAILABLE');
      assert.deepEqual(claim?.params, { reason: 'NO_GOVERNED_SOURCE' });
      assert.equal((x.m.inspect({ kind: 'COMPANY' }).externalOutcomes as { state: string }).state, 'NO_GOVERNED_SOURCE');
      // A DRAFT source is not governed evidence either.
      outcomeSource(x, 'web-analytics.main', 'WEB_ANALYTICS', false);
      assert.throws(() => verifyExternal(x, w, [`work_item:${w}`]), reason('EXTERNAL_OUTCOME_UNAVAILABLE'));
      // A governed source without relevant evidence: said so, citing the source — never filled.
      x.x.decideSource(x.s.founder, x.x.sources()[0]?.id as Id, { decision: 'ACTIVATE', reasonCode: 'founder.trusted' });
      x.h.clock.advance(1_000);
      const none = x.m.generateReport('WEEKLY').report.claims.find((c) => c.code === 'EXTERNAL_OUTCOMES_NO_RELEVANT_EVIDENCE');
      assert.deepEqual(none?.evidenceRefs, [`external_source:${x.x.sources()[0]?.id}`]);
      assert.equal(x.x.availability().state, 'NO_RELEVANT_EVIDENCE');
    });
  });

  test('(26, 28, 29) governed source + bound evidence + the Founder as verifier reach the existing C6 path: OUTCOME_VERIFIED, evaluated with EXTERNAL_OUTCOME, cited by reports and inspection', () => {
    withSeed((x) => {
      outcomeSource(x);
      const w = reviewedWork(x);
      const rec = x.x.ingest(metric('m-1', 1800)).record;
      const binding = bind(x, rec.id, w);
      // Through the governed confirmation (the production path for the Founder's verification).
      const { actions, session } = founderActions(x);
      assert.throws(() => actions.preview(session, 'OUTCOME_VERIFY', { workItemId: w, verdict: 'ACHIEVED', evidenceClasses: ['EXTERNAL_OUTCOME'], evidenceRefs: [`work_item:${w}`] }), reason('EXTERNAL_EVIDENCE_MISSING'));
      const p = actions.preview(session, 'OUTCOME_VERIFY', { workItemId: w, verdict: 'ACHIEVED', evidenceClasses: ['EXTERNAL_OUTCOME', 'REVIEW_DECISION'], evidenceRefs: [rec.ref, `work_item:${w}`] });
      actions.confirm(session, p.id, p.fingerprint);
      assert.equal(x.h.store.getWorkItem(w).state, 'OUTCOME_VERIFIED');
      const e = x.m.evaluate(w).evaluation;
      assert.equal(e.qualifiedOutcome, true);
      assert.ok(e.evidenceRefs.includes(rec.ref), 'the C6 evaluation cites the canonical external record');
      assert.ok((x.m.inspect({ kind: 'WORK_ITEM', id: w }) as { evidence: { evidenceClasses: string[] } }).evidence.evidenceClasses.includes('EXTERNAL_OUTCOME'), 'the evaluator sees the EXTERNAL_OUTCOME evidence class');
      const inspect = x.m.inspect({ kind: 'WORK_ITEM', id: w }) as { externalEvidence: { ref: string; usable: boolean; bindingRef: string }[] };
      assert.deepEqual(inspect.externalEvidence.map((v) => [v.ref, v.usable, v.bindingRef]), [[rec.ref, true, `external_binding:${binding.id}`]]);
      const claims = x.m.generateReport('WEEKLY').report.claims;
      const evidence = claims.find((c) => c.code === 'EXTERNAL_OUTCOME_EVIDENCE');
      assert.deepEqual(evidence?.subject, { kind: 'WORK_ITEM', id: w });
      assert.ok(evidence?.evidenceRefs.includes(rec.ref) && evidence.evidenceRefs.includes(`external_binding:${binding.id}`));
      const verified = claims.find((c) => c.code === 'EXTERNAL_OUTCOMES_IN_VERIFICATION');
      assert.ok(verified?.evidenceRefs.some((r) => r.startsWith('outcome_verification:')) && verified.evidenceRefs.includes(rec.ref));
      assert.ok(!claims.some((c) => c.code === 'EXTERNAL_OUTCOMES_UNAVAILABLE'));
      // A Goal-level binding is drill-down evidence for the Goal (reporting), never a Work Item verdict.
      const goal = GoalStore.for(x.h.store).propose(x.s.founder, { kind: 'COMPANY', title: 'Grow organic traffic', summary: 'x', ownerRef: x.s.founder });
      bind(x, rec.id, goal.id, 'OUTCOME_EVIDENCE', 'GOAL');
      assert.equal(x.x.evidenceFor('GOAL', goal.id)[0]?.ref, rec.ref);
      assert.ok((x.m.inspect({ kind: 'GOAL', id: goal.id }) as { externalEvidence: unknown[] }).externalEvidence.length === 1);
    });
  });

  test('(28) the Review Pool, where the plan delegates judgment, verifies from its own cited, Founder-bound external evidence — with the Founder surface disarmed', () => {
    withSeed((x) => {
      activeReviewer(x.h, x.s);
      outcomeSource(x);
      const w = prepared(x, POOL);
      const rec = x.x.ingest(metric('m-1', 1800)).record;
      bind(x, rec.id, w);
      disarmFounderTestSurface(x.h.store.workspace.root);
      const out = review(x, w, 'PASS', { verdict: 'ACHIEVED', evidenceClasses: ['EXTERNAL_OUTCOME', 'REVIEW_DECISION'] }, [rec.ref]);
      assert.equal(out.code, 'RECORDED');
      assert.equal(x.h.store.getWorkItem(w).state, 'OUTCOME_VERIFIED');
      const v = db(x).get<{ verifier_kind: string; classes: string; refs: string }>('SELECT verifier_kind, evidence_classes_json AS classes, evidence_refs_json AS refs FROM outcome_verifications WHERE work_item_id = ?', w);
      assert.equal(v?.verifier_kind, 'REVIEW_POOL');
      assert.ok((JSON.parse(String(v?.classes)) as string[]).includes('EXTERNAL_OUTCOME') && (JSON.parse(String(v?.refs)) as string[]).includes(rec.ref));
    });
  });

  test('(27) forged, missing, undeclared, suspended, conflicted and revoked external evidence fails closed (Founder path and pool path)', () => {
    withSeed((x) => {
      const sourceId = outcomeSource(x);
      outcomeSource(x, 'search.console', 'SEARCH'); // another governed source stays ACTIVE: refusals below are about THIS evidence
      const w = reviewedWork(x);
      const rec = x.x.ingest(metric('m-1')).record;
      const b = bind(x, rec.id, w);
      assert.throws(() => verifyExternal(x, w, [`external_record:${newId()}`]), reason('UNKNOWN_RECORD'));
      assert.throws(() => verifyExternal(x, w, [`work_item:${w}`]), reason('EXTERNAL_EVIDENCE_MISSING'));
      assert.throws(() => verifyExternal(x, w, [rec.ref], 'ACHIEVED', ['REVIEW_DECISION']), reason('EXTERNAL_EVIDENCE_UNDECLARED'));
      x.x.unbindEvidence(x.s.founder, b.id, 'founder.not_relevant');
      assert.throws(() => verifyExternal(x, w, [rec.ref]), reason('NOT_BOUND_TO_WORK_ITEM'));
      bind(x, rec.id, w);
      x.x.decideSource(x.s.founder, sourceId, { decision: 'SUSPEND', reasonCode: 'founder.untrusted' });
      assert.throws(() => verifyExternal(x, w, [rec.ref]), reason('SOURCE_NOT_ACTIVE'));
      x.x.decideSource(x.s.founder, sourceId, { decision: 'ACTIVATE', reasonCode: 'founder.trusted' });
      assert.throws(() => x.x.ingest(metric('m-1', 77)), code('INTAKE_CONFLICT'));
      assert.throws(() => verifyExternal(x, w, [rec.ref]), reason('RECORD_CONFLICTED'));
      assert.equal(x.h.store.getWorkItem(w).state, 'REVIEWED');
      assert.deepEqual(x.x.bindings({ recordId: rec.id }).map((y) => y.state).sort(), ['ACTIVE', 'REVOKED'], 'ending a binding keeps its history');

      // Pool path: the source is suspended between the reviewer's decision and the outcome — never silently verified.
      activeReviewer(x.h, x.s);
      const w2 = prepared(x, { ...POOL, keys: [{ kind: 'SPECIALIST' }, { kind: 'SPECIALIST' }] });
      activeReviewer(x.h, x.s);
      const rec2 = x.x.ingest(metric('m-2')).record;
      bind(x, rec2.id, w2);
      const ext: OutcomeJudgment = { verdict: 'ACHIEVED', evidenceClasses: ['EXTERNAL_OUTCOME', 'REVIEW_DECISION'] };
      const rv = ReviewStore.for(x.h.store);
      const request = rv.requests({ workItemId: w2 }).find((r) => r.state === 'OPEN');
      const keys = request ? rv.assignments(request.id).filter((a) => a.keyKind === 'SPECIALIST' && a.state === 'ASSIGNED') : [];
      assert.equal(keys.length, 2);
      const first = claimItem(x.h, keys[0]?.reviewWorkItemId as Id, 'w-k0');
      assert.equal(recordReviewDecision(x.h.store, first.fence, { outcome: 'PASS', reasonCode: 'rubric.applied', rationale: null, evidenceRefs: [rec2.ref], outcomeJudgment: ext }).code, 'RECORDED');
      settle(x.h.store, first.fence, { type: 'COMPLETED' }, { backoff });
      x.x.decideSource(x.s.founder, sourceId, { decision: 'SUSPEND', reasonCode: 'founder.untrusted' });
      const second = claimItem(x.h, keys[1]?.reviewWorkItemId as Id, 'w-k1');
      assert.equal(recordReviewDecision(x.h.store, second.fence, { outcome: 'PASS', reasonCode: 'rubric.applied', rationale: null, evidenceRefs: ['evidence:rubric'], outcomeJudgment: { verdict: 'ACHIEVED', evidenceClasses: ['REVIEW_DECISION'] } }).code, 'RECORDED');
      settle(x.h.store, second.fence, { type: 'COMPLETED' }, { backoff });
      const v = db(x).get<{ verdict: string; reason_code: string; classes: string }>('SELECT verdict, reason_code, evidence_classes_json AS classes FROM outcome_verifications WHERE work_item_id = ?', w2);
      assert.deepEqual([v?.verdict, v?.reason_code], ['INCONCLUSIVE', 'review_keys.external_evidence_unusable']);
      assert.ok(!(JSON.parse(String(v?.classes)) as string[]).includes('EXTERNAL_OUTCOME'));
      AttentionStore.for(x.h.store).sync();
      assert.ok(AttentionStore.for(x.h.store).list().some((i) => i.sourceRef === `work_item:${w2}`), 'unusable external evidence reaches the Founder as an exception');
    });
  });

  test('(31) learning and performance consume the existing C6 lineage; no parallel evaluation / learning / performance store exists', () => {
    withSeed((x) => {
      outcomeSource(x);
      const w = reviewedWork(x);
      const rec = x.x.ingest(metric('m-1')).record;
      bind(x, rec.id, w);
      verifyExternal(x, w, [rec.ref]);
      const e = x.m.evaluate(w).evaluation;
      assert.equal(count(x, 'SELECT COUNT(*) AS n FROM evaluation_results WHERE id = ?', e.id), 1, 'the one evaluation store');
      assert.ok(x.m.profile(x.s.employee.id).dimensions.find((d) => d.dimension === 'OUTCOME')?.evidenceRefs.includes(`evaluation:${e.id}`), 'the existing profile reads it');
      const tables = db(x).all<{ name: string }>(`SELECT name FROM sqlite_schema WHERE type = 'table'`).map((t) => t.name);
      assert.deepEqual(tables.filter((t) => /^(external|c7)/.test(t)).sort(), ['external_binding_history', 'external_contract_catalog', 'external_contract_families', 'external_contract_fields', 'external_contract_scopes', 'external_contract_types', 'external_evidence_bindings', 'external_intake_refusal_windows', 'external_record_conflicts', 'external_records', 'external_source_contracts', 'external_source_history', 'external_sources']); // C7-B adds only the bounded refusal counters (R-C7A-04)
      assert.deepEqual(tables.filter((t) => /evaluat|lesson|learning|attribution|performance|score|report/.test(t) && !['evaluation_results', 'eval_definitions', 'eval_definition_history', 'eval_calibration_runs', 'lessons', 'lesson_promotions', 'learning_signals', 'learning_interventions', 'learning_intervention_history', 'causal_attributions', 'causal_attribution_history', 'report_snapshots', 'lesson_history', 'run_attributions'].includes(t)), [], 'only the pre-existing C2–C6 stores');
    });
  });
});

// =================================================================================================================
describe('C7-A late integrity conflict: disputed evidence leaves current C6 truth until the Founder decides (D-C7A-11)', () => {
  const states = (x: X, verificationId: Id): string[] => db(x).all<{ state: string }>('SELECT state FROM outcome_verification_validity WHERE verification_id = ? ORDER BY seq', verificationId).map((r) => r.state);
  const outcomeRefs = (x: X): readonly string[] => x.m.profile(x.s.employee.id).dimensions.find((d) => d.dimension === 'OUTCOME')?.evidenceRefs ?? [];

  test('(36) accept → bind → decisive verification → qualified evaluation → a late conflicting replay: history kept; evaluation, profile, economics, reports and Attention stop trusting it; a governed Founder replacement restores current truth', () => {
    withSeed((x) => {
      outcomeSource(x);
      const w = reviewedWork(x, true);
      const rec = x.x.ingest(metric('m-1', 1800)).record;
      bind(x, rec.id, w);
      const v = verifyExternal(x, w, [rec.ref, `work_item:${w}`]);
      const qualified = x.m.evaluate(w).evaluation;
      assert.equal(qualified.qualifiedOutcome, true);
      assert.ok(outcomeRefs(x).includes(`evaluation:${qualified.id}`) && x.m.economics({ employeeId: x.s.employee.id }).qualifiedOutcomes === 1, 'counted as a qualified success before');
      // Learning built on it: the success's pattern lesson, validated by the Founder, counts as the Employee's contribution.
      const [pattern] = x.m.signals({ workItemId: w, kind: 'SUCCESSFUL_PATTERN' });
      assert.ok(pattern, 'the qualified success yields a pattern candidate');
      const mem = MemoryStore.for(x.h.store);
      const lesson = mem.nominateLesson(x.s.founder, pattern.observationId as Id, 'pattern.candidate');
      mem.validateLesson(x.s.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'pattern.validated' });
      const patterns = (): readonly string[] => (x.m.profile(x.s.employee.id).dimensions.find((d) => d.dimension === 'SYSTEM_CONTRIBUTION')?.evidenceRefs ?? []).filter((r) => r.startsWith('lesson:')).map((r) => r.slice('lesson:'.length));
      assert.ok(patterns().includes(lesson.id), 'the validated pattern is the Employee\'s system contribution');

      // The late conflicting replay of the same producer occurrence (it commits, then refuses: the runtime announces it).
      assert.throws(() => x.x.ingest(metric('m-1', 9000)), (e) => isQandeelError(e, 'INTAKE_CONFLICT') && e.details.recorded === true && e.details.contestedVerifications === 1);
      assert.throws(() => x.x.ingest(metric('m-1', 9000)), (e) => isQandeelError(e, 'INTAKE_CONFLICT') && e.details.recorded === false, 'a repeated conflict commits nothing new');

      // History is preserved: the verification, the qualified evaluation and the lifecycle are never rewritten.
      assert.equal(count(x, 'SELECT COUNT(*) AS n FROM outcome_verifications WHERE id = ?', v.verificationId), 1);
      assert.equal(count(x, 'SELECT COUNT(*) AS n FROM evaluation_results WHERE id = ?', qualified.id), 1);
      assert.equal(x.h.store.getWorkItem(w).state, 'OUTCOME_VERIFIED', 'the Work Item lifecycle is history');
      assert.deepEqual(states(x, v.verificationId), ['CONTESTED']);
      // Current qualified truth no longer counts it — restated through the same C6 evaluator, in the conflict's transaction.
      const now = x.m.evaluation(w);
      assert.notEqual(now?.id, qualified.id, 'the qualified evaluation is superseded, not edited');
      assert.deepEqual([now?.qualifiedOutcome, now?.evidenceState, now?.conflicts], [false, 'CONFLICTING_EVIDENCE', ['OUTCOME_EVIDENCE_CONTESTED']]);
      assert.ok(now?.evidenceRefs.includes(`outcome_verification:${v.verificationId}`) && now.evidenceRefs.some((r) => r.startsWith('external_record_conflict:')), 'the evaluation cites what it could not trust');
      assert.ok(!now?.evidenceRefs.includes(rec.ref) && !(x.m.inspect({ kind: 'WORK_ITEM', id: w }) as { evidence: { evidenceClasses: string[] } }).evidence.evidenceClasses.includes('EXTERNAL_OUTCOME'), 'the disputed record is no longer external outcome evidence');
      assert.equal(x.m.evaluate(w).changed, false, 'the restated truth is stable');
      // Profile / performance / economics no longer count it as a qualified success.
      assert.ok(!outcomeRefs(x).includes(`evaluation:${qualified.id}`));
      assert.equal(x.m.economics({ employeeId: x.s.employee.id }).qualifiedOutcomes, 0);
      assert.equal(x.m.health().qualifiedOutcomes, 0);
      // Learning stops relying on it: the lesson stays VALIDATED (history) but no longer counts as a contribution.
      assert.equal(count(x, `SELECT COUNT(*) AS n FROM lessons WHERE id = ? AND stage = 'VALIDATED'`, lesson.id), 1);
      assert.ok(!patterns().includes(lesson.id), 'a pattern from a contested success is not a contribution');
      assert.deepEqual((x.m.inspect({ kind: 'WORK_ITEM', id: w }) as { verification: { validity: string; current: boolean } }).verification, { id: v.verificationId, verdict: 'ACHIEVED', validity: 'CONTESTED', current: false });
      // Current reporting states the contestation and never presents it as a trusted external result.
      const weekly = x.m.generateReport('WEEKLY').report.claims;
      const contestedClaim = weekly.find((c) => c.code === 'EXTERNAL_OUTCOME_CONTESTED');
      assert.deepEqual(contestedClaim?.subject, { kind: 'WORK_ITEM', id: w });
      assert.ok(contestedClaim?.evidenceRefs.includes(`outcome_verification:${v.verificationId}`) && contestedClaim.evidenceRefs.some((r) => r.startsWith('external_record_conflict:')));
      assert.ok(!weekly.some((c) => c.code === 'EXTERNAL_OUTCOMES_IN_VERIFICATION' && c.evidenceRefs.includes(`outcome_verification:${v.verificationId}`)));
      assert.ok(!weekly.some((c) => c.code === 'EXTERNAL_OUTCOME_EVIDENCE' && c.evidenceRefs.includes(rec.ref)));
      const daily = x.m.generateReport('DAILY').report.claims;
      assert.ok(daily.find((c) => c.code === 'OUTCOMES_CONTESTED')?.evidenceRefs.includes(`outcome_verification:${v.verificationId}`));
      assert.ok(!daily.some((c) => c.code === 'OUTCOMES_ACHIEVED' && c.evidenceRefs.includes(`outcome_verification:${v.verificationId}`)));
      // Founder Attention receives it as a decision the Founder owes.
      AttentionStore.for(x.h.store).sync();
      assert.ok(AttentionStore.for(x.h.store).list().some((i) => i.dedupKey === `outcome_contest:${v.verificationId}` && i.level === 'NEEDS_DECISION' && i.lane === 'NEEDS_ME'));

      // Governed Founder replacement: never on the disputed record; on fresh usable evidence it restores current truth.
      const { actions, session } = founderActions(x);
      assert.throws(() => actions.preview(session, 'OUTCOME_CONTEST_RESOLVE', { verificationId: v.verificationId, decision: 'REPLACE', evidenceClasses: ['EXTERNAL_OUTCOME', 'REVIEW_DECISION'], evidenceRefs: [rec.ref] }), reason('RECORD_CONFLICTED'));
      assert.throws(() => x.m.resolveOutcomeContest(x.s.employee.ref, v.verificationId, { decision: 'UPHOLD', reasonCode: 'mine' }), (e) => isQandeelError(e) && ['FOUNDER_ONLY', 'AUTHORITY_DENIED', 'SELF_ESCALATION_REFUSED'].includes(e.code), 'an Employee never decides its own contested outcome');
      const rec2 = x.x.ingest(metric('m-2', 1750)).record;
      bind(x, rec2.id, w);
      const p = actions.preview(session, 'OUTCOME_CONTEST_RESOLVE', { verificationId: v.verificationId, decision: 'REPLACE', evidenceClasses: ['EXTERNAL_OUTCOME', 'REVIEW_DECISION'], evidenceRefs: [rec2.ref, `work_item:${w}`] });
      const replacementId = actions.confirm(session, p.id, p.fingerprint).resultRef.slice('outcome_verification:'.length);
      assert.notEqual(replacementId, v.verificationId);
      const restored = x.m.evaluation(w);
      assert.deepEqual([restored?.qualifiedOutcome, restored?.evidenceState], [true, 'SUFFICIENT_EVIDENCE']);
      assert.ok(restored?.evidenceRefs.includes(rec2.ref) && restored.evidenceRefs.includes(`outcome_verification:${replacementId}`) && !restored.evidenceRefs.includes(rec.ref));
      assert.equal(x.m.economics({ employeeId: x.s.employee.id }).qualifiedOutcomes, 1);
      assert.ok(patterns().includes(lesson.id), 'the re-verified success counts its pattern again');
      // Nothing was deleted: both verifications, the contest and its resolution, and every evaluation stay history.
      assert.deepEqual(states(x, v.verificationId), ['CONTESTED', 'REPLACED']);
      assert.equal(count(x, 'SELECT COUNT(*) AS n FROM outcome_verifications WHERE work_item_id = ?', w), 2);
      assert.equal(count(x, 'SELECT COUNT(*) AS n FROM evaluation_results WHERE work_item_id = ?', w), 3);
      AttentionStore.for(x.h.store).sync();
      assert.ok(!AttentionStore.for(x.h.store).list().some((i) => i.dedupKey === `outcome_contest:${v.verificationId}` && i.state === 'OPEN'), 'the Founder decision answers it');
      const after = x.m.generateReport('WEEKLY').report.claims;
      assert.ok(after.some((c) => c.code === 'EXTERNAL_OUTCOMES_IN_VERIFICATION' && c.evidenceRefs.includes(`outcome_verification:${replacementId}`) && !c.evidenceRefs.includes(`outcome_verification:${v.verificationId}`)));
      assert.ok(!after.some((c) => c.code === 'EXTERNAL_OUTCOME_CONTESTED'));
      // REPLACED is final; a replacement is the one current decisive verification.
      assert.throws(() => x.m.resolveOutcomeContest(x.s.founder, v.verificationId, { decision: 'UPHOLD', reasonCode: 'again' }), reason('NOT_CONTESTED'));
      for (const sql of ['DELETE FROM outcome_verification_validity', `UPDATE outcome_verification_validity SET state = 'UPHELD'`]) assert.throws(() => db(x).immediate('rewrite', () => db(x).run(sql)), code('STORAGE_INVARIANT'), sql);
    });
  });

  test('(37) only an evidence-integrity conflict contests (never a suspension); the datastore contests even a directly written conflict; UPHOLD restores, a second conflict re-contests, RETRACT ends it; validity cannot be forged', () => {
    withSeed((x) => {
      const sourceId = outcomeSource(x);
      const w = reviewedWork(x);
      const rec = x.x.ingest(metric('m-1', 1800)).record;
      bind(x, rec.id, w);
      const v = verifyExternal(x, w, [rec.ref, `work_item:${w}`]);
      const first = x.m.evaluate(w).evaluation;
      // Ordinary suspension is not evidence of a dispute: nothing is invalidated retroactively.
      x.x.decideSource(x.s.founder, sourceId, { decision: 'SUSPEND', reasonCode: 'founder.paused' });
      assert.deepEqual(states(x, v.verificationId), []);
      assert.deepEqual([x.m.evaluate(w).changed, x.m.evaluation(w)?.id, x.m.evaluation(w)?.qualifiedOutcome], [false, first.id, true]);
      x.x.decideSource(x.s.founder, sourceId, { decision: 'ACTIVATE', reasonCode: 'founder.resumed' });
      // A forged validity row is refused: no contest without a conflict on cited evidence, no decision without a contest.
      assert.throws(() => db(x).immediate('forge', () => db(x).run(`INSERT INTO outcome_verification_validity (verification_id, seq, state, conflict_id, replacement_verification_id, actor_ref, reason_code, occurred_at) VALUES (?, 1, 'RETRACTED', NULL, NULL, ?, 'x', ?)`, v.verificationId, x.s.founder, OCCURRED)), code('STORAGE_INVARIANT'));
      // The datastore contests even a conflict written without the intake path, in that write's own transaction.
      db(x).immediate('direct conflict', () => db(x).run('INSERT INTO external_record_conflicts (id, record_id, source_id, conflicting_fingerprint, received_at) VALUES (?, ?, ?, ?, ?)', newId(), rec.id, sourceId, 'e'.repeat(64), OCCURRED));
      assert.deepEqual(states(x, v.verificationId), ['CONTESTED']);
      assert.equal(x.m.evaluate(w).evaluation.qualifiedOutcome, false, 'the evaluator never trusts a contested verification');
      // UPHOLD: the Founder's decision that the verification stands — current truth again (a new evaluation, history kept).
      const up = x.m.resolveOutcomeContest(x.s.founder, v.verificationId, { decision: 'UPHOLD', reasonCode: 'founder.producer_bug' });
      assert.deepEqual(up, { verificationId: v.verificationId, state: 'UPHELD' });
      assert.equal(x.m.evaluation(w)?.qualifiedOutcome, true);
      // A NEW conflicting replay after the decision contests it again (new information), restated in the same transaction.
      assert.throws(() => x.x.ingest(metric('m-1', 4321)), code('INTAKE_CONFLICT'));
      assert.deepEqual(states(x, v.verificationId), ['CONTESTED', 'UPHELD', 'CONTESTED']);
      assert.equal(x.m.evaluation(w)?.qualifiedOutcome, false);
      // RETRACT: no current verified outcome — never qualified, never an adverse event either; final.
      assert.throws(() => x.m.resolveOutcomeContest(x.s.founder, v.verificationId, { decision: 'RETRACT', reasonCode: 'founder.retracted', evidenceRefs: [rec.ref] }), code('VALIDATION_FAILED'));
      x.m.resolveOutcomeContest(x.s.founder, v.verificationId, { decision: 'RETRACT', reasonCode: 'founder.retracted' });
      assert.deepEqual(states(x, v.verificationId), ['CONTESTED', 'UPHELD', 'CONTESTED', 'RETRACTED']);
      const retracted = x.m.evaluation(w);
      assert.equal(retracted?.qualifiedOutcome, false);
      assert.ok(!retracted?.conflicts.includes('OUTCOME_EVIDENCE_CONTESTED'), 'decided: no longer a pending dispute');
      assert.throws(() => x.m.resolveOutcomeContest(x.s.founder, v.verificationId, { decision: 'UPHOLD', reasonCode: 'again' }), reason('NOT_CONTESTED'));
      db(x).immediate('a later conflict', () => db(x).run('INSERT INTO external_record_conflicts (id, record_id, source_id, conflicting_fingerprint, received_at) VALUES (?, ?, ?, ?, ?)', newId(), rec.id, sourceId, 'f'.repeat(64), OCCURRED));
      assert.deepEqual(states(x, v.verificationId), ['CONTESTED', 'UPHELD', 'CONTESTED', 'RETRACTED'], 'RETRACTED is final: a later conflict contests nothing');
      // Every contest and decision is audited by ids and codes only.
      assert.equal(count(x, `SELECT COUNT(*) AS n FROM audit_events WHERE action = 'outcome.contested'`), 1, 'the intake path audits its contest (the direct write had no code path)');
      assert.equal(count(x, `SELECT COUNT(*) AS n FROM audit_events WHERE action = 'outcome.contest_resolved'`), 2);
    });
  });

  test('(40) qualified success → SUCCESSFUL_PATTERN → validated lesson → PATTERN_REUSE open → late conflicting replay: no new reuse, the open reuse is cancelled (history kept); UPHOLD / valid REPLACE re-open FUTURE reuse, RETRACT keeps it closed', () => {
    withSeed((x) => {
      outcomeSource(x);
      const w = reviewedWork(x, true);
      const rec = x.x.ingest(metric('m-1', 1800)).record;
      bind(x, rec.id, w);
      const v = verifyExternal(x, w, [rec.ref, `work_item:${w}`]);
      assert.equal(x.m.evaluate(w).evaluation.qualifiedOutcome, true);
      const [pattern] = x.m.signals({ workItemId: w, kind: 'SUCCESSFUL_PATTERN' });
      assert.ok(pattern, 'the qualified success yields a pattern candidate');
      const mem = MemoryStore.for(x.h.store);
      const lesson = mem.nominateLesson(x.s.founder, pattern.observationId as Id, 'pattern.candidate');
      mem.validateLesson(x.s.founder, lesson.id, { decision: 'VALIDATE', reasonCode: 'pattern.validated' });
      const reuse = () => x.m.planIntervention(x.s.founder, lesson.id, { kind: 'PATTERN_REUSE' });
      const notCurrent = (e: unknown): boolean => isQandeelError(e, 'LEARNING_GATE') && e.details.reason === 'PATTERN_OUTCOME_NOT_CURRENT';
      const stateOf = (id: Id): string | undefined => x.m.interventions({ lessonId: lesson.id }).find((i) => i.id === id)?.state;
      const contributions = (): readonly string[] => x.m.profile(x.s.employee.id).dimensions.find((d) => d.dimension === 'SYSTEM_CONTRIBUTION')?.evidenceRefs ?? [];

      // A reuse of the trusted pattern is planned and its training completed (an open reuse).
      const r1 = reuse().intervention;
      assert.ok(r1);
      x.m.completeTraining(x.s.founder, r1.id);
      assert.equal(stateOf(r1.id), 'TRAINING_COMPLETED');

      // The late conflicting replay contests the originating outcome.
      assert.throws(() => x.x.ingest(metric('m-1', 9000)), (e) => isQandeelError(e, 'INTAKE_CONFLICT') && e.details.recorded === true);
      assert.deepEqual(states(x, v.verificationId), ['CONTESTED']);
      // 1. No new PATTERN_REUSE can be planned from the contested pattern.
      assert.throws(reuse, notCurrent);
      // 2. The open reuse cannot progress as trusted learning: cancelled in the conflict's own transaction.
      assert.equal(stateOf(r1.id), 'CANCELLED');
      assert.throws(() => x.m.completeTraining(x.s.founder, r1.id), code('INVALID_TRANSITION'));
      assert.deepEqual([x.m.assessIntervention(r1.id).changed, x.m.interventions({ lessonId: lesson.id }).find((i) => i.id === r1.id)?.effect], [false, 'NOT_YET_TESTED']);
      assert.throws(() => db(x).immediate('revive', () => db(x).run(`UPDATE learning_interventions SET state = 'TRAINING_COMPLETED', version = version + 1 WHERE id = ?`, r1.id)), code('STORAGE_INVARIANT'), 'a cancelled reuse never resumes');
      // 3. It never counts as verified reuse, contribution or a basis for sharing.
      assert.equal(count(x, `SELECT COUNT(*) AS n FROM learning_interventions WHERE lesson_id = ? AND effect = 'IMPROVEMENT_OBSERVED'`, lesson.id), 0);
      assert.ok(!contributions().some((r) => r === `lesson:${lesson.id}` || r === `learning_intervention:${r1.id}`));
      // 4. History is preserved: the lesson, the reuse and its every step stay.
      assert.equal(count(x, `SELECT COUNT(*) AS n FROM lessons WHERE id = ? AND stage = 'VALIDATED'`, lesson.id), 1);
      assert.deepEqual(db(x).all<{ state: string; reason_code: string }>('SELECT state, reason_code FROM learning_intervention_history WHERE intervention_id = ? ORDER BY id', r1.id).map((h) => `${h.state}:${h.reason_code}`), ['PLANNED:intervention.planned', 'TRAINING_COMPLETED:training.completed', 'CANCELLED:intervention.pattern_outcome_not_current']);
      assert.equal(count(x, `SELECT COUNT(*) AS n FROM audit_events WHERE action = 'learning.intervention_cancelled' AND entity_id = ?`, r1.id), 1);
      // 5. The Founder Attention / contest path is unchanged.
      AttentionStore.for(x.h.store).sync();
      assert.ok(AttentionStore.for(x.h.store).list().some((i) => i.dedupKey === `outcome_contest:${v.verificationId}` && i.level === 'NEEDS_DECISION'));

      // 6. UPHOLD restores FUTURE reuse eligibility; the interrupted reuse stays history.
      x.m.resolveOutcomeContest(x.s.founder, v.verificationId, { decision: 'UPHOLD', reasonCode: 'founder.producer_bug' });
      const r2 = reuse().intervention;
      assert.ok(r2 && r2.id !== r1.id && r2.state === 'PLANNED');
      assert.equal(stateOf(r1.id), 'CANCELLED');
      // A new conflict contests it again: the PLANNED reuse is cancelled too.
      assert.throws(() => x.x.ingest(metric('m-1', 4321)), code('INTAKE_CONFLICT'));
      assert.equal(stateOf(r2.id), 'CANCELLED');
      assert.throws(reuse, notCurrent);

      // 7. A valid REPLACE (fresh usable evidence) restores future reuse eligibility.
      const rec2 = x.x.ingest(metric('m-2', 1750)).record;
      bind(x, rec2.id, w);
      const replaced = x.m.resolveOutcomeContest(x.s.founder, v.verificationId, { decision: 'REPLACE', reasonCode: 'founder.replaced', evidenceClasses: ['EXTERNAL_OUTCOME', 'REVIEW_DECISION'], evidenceRefs: [rec2.ref, `work_item:${w}`] });
      assert.equal(x.m.evaluation(w)?.qualifiedOutcome, true);
      const r3 = reuse().intervention;
      assert.ok(r3 && r3.state === 'PLANNED');

      // 8. RETRACT keeps reuse unavailable: the replacement is contested in turn, then retracted.
      assert.throws(() => x.x.ingest(metric('m-2', 99)), code('INTAKE_CONFLICT'));
      assert.equal(stateOf(r3.id), 'CANCELLED');
      const replacementId = (replaced as { replacementVerificationId?: Id }).replacementVerificationId ?? (db(x).get<{ id: string }>('SELECT id FROM outcome_verifications WHERE replaces_verification_id = ?', v.verificationId)?.id as Id);
      x.m.resolveOutcomeContest(x.s.founder, replacementId, { decision: 'RETRACT', reasonCode: 'founder.retracted' });
      assert.equal(x.m.evaluation(w)?.qualifiedOutcome, false);
      assert.throws(reuse, notCurrent);
      assert.deepEqual(x.m.interventions({ lessonId: lesson.id }).map((i) => i.state), ['CANCELLED', 'CANCELLED', 'CANCELLED'], 'every interrupted reuse is history; none was deleted');
    });
  });
});

// =================================================================================================================
describe('C7-A the datastore enforces the registered contract, not only TypeScript (D-C7A-10)', () => {
  /** A direct datastore write under an ACTIVE source and its CURRENT contract — the bypass every case below attempts. */
  const forge = (x: X, sourceId: Id, row: { lane: string; type: string; domain: string; scopeKind?: string | null; value?: number | null; unit?: string | null; window?: boolean; fields?: Record<string, unknown>; failure?: 0 | 1; userScoped?: 0 | 1 }) => {
    const contractId = x.x.source(sourceId).contract?.id as Id;
    const outcome = row.lane === 'EXTERNAL_OUTCOME';
    return () =>
      db(x).immediate('bypass', () =>
        db(x).run(
          `INSERT INTO external_records (id, source_id, contract_id, producer_event_id, lane, record_type, domain, occurred_at, received_at, scope_kind, scope_ref, window_from, window_to, value_num, unit, normalized_fields_json, user_scoped, failure_signal, fingerprint, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACCEPTED')`,
          newId(), sourceId, contractId, newId(), row.lane, row.type, row.domain, OCCURRED, OCCURRED,
          row.scopeKind === undefined ? (outcome ? 'SITE' : null) : row.scopeKind, outcome ? 'qandeel-site' : null,
          row.window === false || !outcome ? null : '2026-09-19T00:00:00.000Z', row.window === false || !outcome ? null : '2026-09-26T00:00:00.000Z',
          row.value === undefined ? (outcome ? 10 : null) : row.value, row.unit === undefined ? (outcome ? 'COUNT' : null) : row.unit,
          JSON.stringify(row.fields ?? {}), row.userScoped ?? 0, row.failure ?? 0, 'a'.repeat(64),
        ),
      );
  };

  test('(38) every contract-incompatible record fails closed at the datastore under an ACTIVE source and its CURRENT contract', () => {
    withSeed((x) => {
      const search = outcomeSource(x, 'search.console', 'SEARCH');
      const ops = opsSource(x);
      const opsContract = x.x.source(ops).contract?.id as Id;
      const ok = { lane: 'EXTERNAL_OUTCOME', type: 'search.clicks', domain: 'SEARCH' };
      // The control: a conforming direct write is accepted, so every refusal below is about the contract, not the bypass.
      assert.doesNotThrow(forge(x, search, ok));
      assert.doesNotThrow(forge(x, ops, { lane: 'OPERATIONAL_EVENT', type: 'service.health', domain: 'SERVICE_HEALTH', fields: { service: 'voice-api', state: 'DOWN' }, failure: 1 }));
      const refused = (what: string, f: () => void): void => assert.throws(f, code('STORAGE_INVARIANT'), what);
      // 1. A SEARCH source carrying a WEB_ANALYTICS record type (with its own family as domain, and with the type's).
      refused('SEARCH source / web type', forge(x, search, { ...ok, type: 'web.sessions', domain: 'WEB_ANALYTICS' }));
      refused('SEARCH source / web type under its own domain', forge(x, search, { ...ok, type: 'web.sessions' }));
      // 2. A valid type under the wrong domain.
      refused('wrong outcome domain', forge(x, search, { ...ok, domain: 'WEB_ANALYTICS' }));
      refused('wrong operational domain', forge(x, ops, { lane: 'OPERATIONAL_EVENT', type: 'service.health', domain: 'CRASH_ERROR', fields: { service: 'voice-api', state: 'DOWN' }, failure: 1 }));
      // 3. An operational event type the contract does not define.
      refused('unknown operational type', forge(x, ops, { lane: 'OPERATIONAL_EVENT', type: 'service.unknown', domain: 'SERVICE_HEALTH', fields: { service: 'voice-api', state: 'DOWN' }, failure: 1 }));
      refused('an outcome metric under the operational contract', forge(x, ops, { lane: 'OPERATIONAL_EVENT', type: 'search.clicks', domain: 'SEARCH' }));
      refused('an unknown operational type with no fields to betray it', forge(x, ops, { lane: 'OPERATIONAL_EVENT', type: 'feature.unknown', domain: 'FEATURE_USAGE' }));
      // 4. Type-specific field mismatch: another type's field, a wrong enum value, a wrong shape, a missing required field.
      const health = (fields: Record<string, unknown>, failure: 0 | 1 = 1) => forge(x, ops, { lane: 'OPERATIONAL_EVENT', type: 'service.health', domain: 'SERVICE_HEALTH', fields, failure });
      refused('another type\'s field', health({ service: 'voice-api', state: 'DOWN', errorCode: 'E_TIMEOUT' }));
      refused('a value outside the enum', health({ service: 'voice-api', state: 'EXPLODED' }));
      refused('an ident in a code shape', forge(x, ops, { lane: 'OPERATIONAL_EVENT', type: 'app.error', domain: 'CRASH_ERROR', fields: { errorCode: 'lower_case', component: 'voice', count: 1 }, failure: 1 }));
      refused('an int out of its declared bounds', forge(x, ops, { lane: 'OPERATIONAL_EVENT', type: 'app.error', domain: 'CRASH_ERROR', fields: { errorCode: 'E_TIMEOUT', component: 'voice', count: 0 }, failure: 1 }));
      refused('a missing required field', health({ service: 'voice-api' }));
      refused('a failure signal the contract does not derive', health({ service: 'voice-api', state: 'UP' }, 1));
      // A duplicated key: SQLite reads the first value, every JSON reader the last — never a way to disagree with the contract.
      const duplicated = (failure: 0 | 1) => () =>
        db(x).immediate('bypass', () => db(x).run(`INSERT INTO external_records (id, source_id, contract_id, producer_event_id, lane, record_type, domain, occurred_at, received_at, scope_kind, scope_ref, window_from, window_to, value_num, unit, normalized_fields_json, user_scoped, failure_signal, fingerprint, status)
          VALUES (?, ?, ?, ?, 'OPERATIONAL_EVENT', 'service.health', 'SERVICE_HEALTH', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, '{"service":"voice-api","state":"UP","state":"DOWN"}', 0, ?, ?, 'ACCEPTED')`, newId(), ops, opsContract, newId(), OCCURRED, OCCURRED, failure, 'a'.repeat(64)));
      refused('a duplicated field (SQLite would read UP, a JSON reader DOWN)', duplicated(0));
      refused('a duplicated field, the other way', duplicated(1));
      refused('a currency on a metric without one', forge(x, search, { ...ok, fields: { currency: 'USD' } }));
      // 5. A unit that is not the metric's (and a value outside the metric's bounds).
      refused('wrong unit', forge(x, search, { ...ok, unit: 'RATIO' }));
      refused('a ratio above 1', forge(x, search, { ...ok, type: 'search.click_through_rate', unit: 'RATIO', value: 3 }));
      refused('a fractional count', forge(x, search, { ...ok, value: 10.5 }));
      // 6. A scope the metric does not allow; a required window missing.
      refused('invalid scope', forge(x, search, { ...ok, scopeKind: 'CAMPAIGN' }));
      refused('missing required window', forge(x, search, { ...ok, window: false }));
      // 7. The bypass itself: none of the refused rows exists; the conforming ones do.
      assert.equal(count(x, 'SELECT COUNT(*) AS n FROM external_records'), 2);
      // And a pseudonym-bearing type must be marked user-scoped (and only it).
      refused('a user diagnostic not marked user-scoped', forge(x, ops, { lane: 'OPERATIONAL_EVENT', type: 'user.diagnostic', domain: 'USER_DIAGNOSTIC', fields: { code: 'E_MIC', state: 'FAILED' } }));
      assert.doesNotThrow(forge(x, ops, { lane: 'OPERATIONAL_EVENT', type: 'user.diagnostic', domain: 'USER_DIAGNOSTIC', fields: { code: 'E_MIC', state: 'FAILED' }, userScoped: 1 }));
    });
  });

  test('(39) the datastore catalogue is exactly the release\'s TypeScript contracts (one definition, two enforcement points)', () => {
    withSeed((x) => {
      const rows = (sql: string) => db(x).all(sql).map((r) => JSON.stringify(r));
      const catalogued = { contracts: rows('SELECT contract_code, contract_version, lane, contract_sha256 FROM external_contract_catalog ORDER BY 1, 2'), types: rows('SELECT * FROM external_contract_types ORDER BY 1, 2, 3'), fields: rows('SELECT * FROM external_contract_fields ORDER BY 1, 2, 3, 4'), scopes: rows('SELECT * FROM external_contract_scopes ORDER BY 1, 2, 3, 4') };
      const expected = { contracts: [] as string[], types: [] as string[], fields: [] as string[], scopes: [] as string[] };
      for (const c of EXTERNAL_CONTRACTS) {
        expected.contracts.push(JSON.stringify({ contract_code: c.code, contract_version: c.version, lane: c.lane, contract_sha256: contractDigest(c) }));
        for (const t of c.eventTypes) {
          const mode = t.failure === 'ALWAYS' || t.failure === 'NEVER' ? t.failure : 'FIELD';
          expected.types.push(JSON.stringify({ contract_code: c.code, contract_version: c.version, record_type: t.type, domain: t.domain, source_family: 'APP_OPERATIONS', unit: null, value_min: null, value_max: null, value_integer: null, window_required: 0, user_scoped: Object.values(t.fields).some((d) => d.spec.kind === 'pseudonym') ? 1 : 0, failure_mode: mode, failure_field: mode === 'FIELD' && typeof t.failure === 'object' ? t.failure.field : null, failure_values_json: mode === 'FIELD' && typeof t.failure === 'object' ? JSON.stringify(t.failure.values) : null }));
          for (const [field, d] of Object.entries(t.fields)) {
            if (d.spec.kind === 'pseudonym') continue;
            expected.fields.push(JSON.stringify({ contract_code: c.code, contract_version: c.version, record_type: t.type, field, shape: d.spec.kind, required: d.required ? 1 : 0, int_min: d.spec.kind === 'int' ? d.spec.min : null, int_max: d.spec.kind === 'int' ? d.spec.max : null, enum_json: d.spec.kind === 'enum' ? JSON.stringify(d.spec.values) : null }));
          }
        }
        for (const m of c.metrics) {
          expected.types.push(JSON.stringify({ contract_code: c.code, contract_version: c.version, record_type: m.metric, domain: m.family, source_family: m.family, unit: m.unit, value_min: m.min, value_max: m.max, value_integer: m.integer ? 1 : 0, window_required: m.window === 'REQUIRED' ? 1 : 0, user_scoped: 0, failure_mode: 'NEVER', failure_field: null, failure_values_json: null }));
          for (const s of m.scopes) expected.scopes.push(JSON.stringify({ contract_code: c.code, contract_version: c.version, record_type: m.metric, scope_kind: s }));
          if (m.currency) expected.fields.push(JSON.stringify({ contract_code: c.code, contract_version: c.version, record_type: m.metric, field: 'currency', shape: 'currency', required: 1, int_min: null, int_max: null, enum_json: null }));
        }
      }
      const sort = (o: typeof expected) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]));
      assert.deepEqual(sort(catalogued), sort(expected));
    });
  });
});

// =================================================================================================================
describe('C7-A durability', () => {
  test('(32) a real released v11 Company upgrades to v12: every row kept (outcome verifications, judgments, the outbox, previews), then external evidence flows', () => {
    const root = tempRoot('c7a-v11');
    try {
      const v11 = openStoreForTests(root, { clock: new ManualClock(), migrations: loadReleasedMigrations(11) });
      assert.equal(v11.schemaVersion, 11);
      const { workItem } = v11.createWorkItem({ objective: 'pre-C7 work', ownerRef: owner, processorKind: 'test.noop', initialState: 'READY' });
      const ctx11 = storeContext(v11).db;
      const counts11 = { events: Number(ctx11.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')?.n), maxSeq: Number(ctx11.get<{ n: number }>('SELECT MAX(seq) AS n FROM events')?.n) };
      v11.close();
      const v12 = openStoreForTests(root, { clock: new ManualClock(), liveSchemaUpdate: true });
      try {
        // C7-B appended 0013 after 0012: the upgrade applies every pending release, in order.
        assert.deepEqual(v12.migration.applied, [12, 13, 14, 15, 16]);
        const d = storeContext(v12).db;
        assert.deepEqual({ events: Number(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')?.n), maxSeq: Number(d.get<{ n: number }>('SELECT MAX(seq) AS n FROM events')?.n) }, counts11, 'the outbox keeps every event and its order');
        assert.equal(v12.getWorkItem(workItem.id).state, 'READY');
        assert.deepEqual(d.all('PRAGMA foreign_key_check'), []);
        assert.equal(v12.quickCheck(), 'ok');
        // The re-created C6 gates are present and the new aggregate is accepted.
        const triggers = d.all<{ name: string }>(`SELECT name FROM sqlite_schema WHERE type = 'trigger' AND tbl_name IN ('outcome_verifications', 'review_outcome_judgments', 'events', 'founder_action_previews')`).map((t) => t.name).sort();
        for (const t of ['outcome_verifications_need_review', 'outcome_verifications_by_review_keys', 'outcome_verifications_external_evidence_governed', 'review_outcome_judgments_of_counting_review', 'review_outcome_judgments_external_evidence_governed', 'events_envelope_immutable', 'events_no_delete', 'founder_action_previews_decide_once']) assert.ok(triggers.includes(t), t);
        const next = d.get<{ seq: number }>(`SELECT seq FROM sqlite_sequence WHERE name = 'events'`);
        assert.ok(Number(next?.seq) >= counts11.maxSeq, 'AUTOINCREMENT continues past the copied sequence');
      } finally {
        v12.close();
      }
    } finally {
      removeRoot(root);
    }
  });

  test('(33) released migrations 0001–0012 are byte-identical to their pins (0012 frozen at the C7-A release)', () => {
    const pins: Record<number, string> = {
      1: '3022ed5ed626f9394cfa9a7e897d2ed4e7bcb9b94c8de7a9a4bde7c0c658436e', 2: 'b3060a1ea7a3e57e8bf0f76a4edba437c9f1b8d2886ef97ff5ca2b6920b0a7c2', 3: 'f47cf341f677585d762672929bdf2f41eeb4bf7440463b68846bac0c777762e4',
      4: '51dd9a38df306751eace1dc6cf82e231b92e487b7e913b061f336e8c25a0066c', 5: '2c2f0d8092f108de2596c15e795ba6ba8d17b316761d0ac59e45d8845409e44a', 6: 'a4b8709915fbad924212e3278b64d2f58d4d1e40c5ba1ff937cb7c50637d57d8',
      7: '9c46b838c21caf7b38d5db1244fc6fdd83c5e47f1a24fe2f973a9828f417fc3b', 8: 'd937856f2a730ff33d3fb83f61c8e6b3ce0c932c4189492d6c50e8eeafb899f5', 9: '803f9eef58fad2afaabbca562c509648aaf59cc21ad647728957fa31d6ab00b1',
      10: 'a8696420f2c20abc8dfe1b62b729adedc57314cfecd7e644bc31687fa9c989ee', 11: '97ab99eebf4fc8ce49c1e1550eb4448f8a9e515a7b02259381ab33fe95ae2550',
      12: '31eeff9a49e284bec44915842ea39453550cc225c9e58b100483a7ad45aaaf09',
    };
    for (const pin of RELEASED_MIGRATIONS) {
      const text = readFileSync(new URL(`../../migrations/${pin.file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
      assert.equal(sha256Hex(text), pin.sha256, pin.file);
      if (pin.version <= 12) assert.equal(pin.sha256, pins[pin.version], `${pin.file} is a released migration and never changes`);
    }
    assert.equal(RELEASED_MIGRATIONS[11]?.file, '0012_c7a_operational_data_external_outcomes.sql');
  });

  test('(34) a failed intake or registration rolls back completely: no half-written source, record, history, audit or event', () => {
    withSeed((x) => {
      const external = (): Record<string, number> => ({ sources: count(x, 'SELECT COUNT(*) AS n FROM external_sources'), history: count(x, 'SELECT COUNT(*) AS n FROM external_source_history'), events: count(x, 'SELECT COUNT(*) AS n FROM events'), audit: count(x, `SELECT COUNT(*) AS n FROM audit_events WHERE action LIKE 'external.%'`) });
      const before = external();
      db(x).execScript(`CREATE TEMP TRIGGER c7a_fault_history BEFORE INSERT ON external_source_contracts BEGIN SELECT RAISE(ABORT, 'injected'); END;`);
      assert.throws(() => outcomeSource(x), code('STORAGE_INVARIANT'));
      db(x).execScript('DROP TRIGGER temp.c7a_fault_history');
      assert.deepEqual(external(), before, 'nothing of the failed registration remains');
      const sourceId = outcomeSource(x);
      const mid = { records: count(x, 'SELECT COUNT(*) AS n FROM external_records'), events: count(x, 'SELECT COUNT(*) AS n FROM events'), audit: count(x, `SELECT COUNT(*) AS n FROM audit_events WHERE action = 'external.record_accepted'`) };
      db(x).execScript(`CREATE TEMP TRIGGER c7a_fault_event BEFORE INSERT ON events WHEN NEW.type = 'external_record.accepted' BEGIN SELECT RAISE(ABORT, 'injected'); END;`);
      assert.throws(() => x.x.ingest(metric('m-1')), code('STORAGE_INVARIANT'));
      db(x).execScript('DROP TRIGGER temp.c7a_fault_event');
      assert.deepEqual({ records: count(x, 'SELECT COUNT(*) AS n FROM external_records'), events: count(x, 'SELECT COUNT(*) AS n FROM events'), audit: count(x, `SELECT COUNT(*) AS n FROM audit_events WHERE action = 'external.record_accepted'`) }, mid);
      assert.equal(x.x.ingest(metric('m-1')).outcome, 'ACCEPTED', 'the occurrence is accepted once the fault is gone');
      assert.equal(x.x.source(sourceId).state, 'ACTIVE');
    });
  });

  test('(35) restart / reopen preserves sources, records, bindings and idempotency', () => {
    const h = harness();
    try {
      const s = seed(h.store);
      activeReviewer(h, s);
      const x: X = { h, s, m: ImprovementStore.for(h.store), x: ExternalEvidenceStore.for(h.store) };
      outcomeSource(x);
      const w = reviewedWork(x);
      const rec = x.x.ingest(metric('m-1')).record;
      bind(x, rec.id, w);
      h.store.close();
      const reopened = h.open();
      const y = ExternalEvidenceStore.for(reopened);
      assert.equal(y.sources()[0]?.state, 'ACTIVE');
      assert.equal(y.record(rec.id).fingerprint, rec.fingerprint);
      assert.deepEqual(y.ingest(metric('m-1')).outcome, 'DUPLICATE', 'idempotency survives the restart');
      assert.throws(() => y.ingest(metric('m-1', 5)), code('INTAKE_CONFLICT'));
      assert.equal(y.evidenceFor('WORK_ITEM', w)[0]?.ref, rec.ref);
    } finally {
      h.close();
    }
  });
});
