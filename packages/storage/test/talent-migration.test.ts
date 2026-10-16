/**
 * COMPANY-TALENT-01 — migration 0024 on a LIVE-shaped Company (acceptance 8): a released v23 Company whose CEO is ACTIVE with
 * its model grant, its envelope, a REVIEW_DUE certification, Academy evaluations and history upgrades to v24 with every
 * existing row unchanged; the CEO's assembled context is identical before and after; no policy, grant, budget or Employee
 * is created by the upgrade; the new intents are accepted afterwards.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ManualClock, newId, type Id } from '@qandeel-company/domain';

import { AcademyStore, CommunicationStore, GovernanceStore, OrganizationStore, loadReleasedMigrations } from '../src/index.js';
import { acquireSupervisor, assembleContext, releaseSupervisor } from '../src/runtime-authority.js';
import { markReviewDue } from '../src/skill-registry.js';
import { openStoreForTests, storeContext, type CompanyStore } from '../src/store.js';
import { seed } from './c2-helpers.js';
import { academyWorld, certify } from './c3-helpers.js';
import { claimItem, placed } from './c4-helpers.js';
import { KINDS, removeRoot, tempRoot, type Harness } from './helpers.js';

const TABLES = ['employees', 'employee_history', 'principals', 'permission_grants', 'budgets', 'certifications', 'certification_history', 'academy_enrollments', 'academy_attempts', 'academy_dimension_results', 'academy_scenarios', 'passport_entries', 'org_positions', 'position_assignments', 'staffing_requests', 'tools', 'tool_actions', 'founder_action_previews'];

describe('COMPANY-TALENT-01: migration 0024 preserves a LIVE-shaped Company', () => {
  test('a released v23 Company with an ACTIVE CEO upgrades to v24: every row, grant, budget, certification and history is unchanged; the CEO context is identical; nothing is created', () => {
    const root = tempRoot('talent-v23');
    const clock = new ManualClock();
    const v23 = openStoreForTests(root, { clock, migrations: loadReleasedMigrations(23) });
    const h = { root, clock, store: v23, supervisor: acquireSupervisor(v23, newId(), 30_000), claimOpts: (workerId = 'w1', leaseMs = 10_000) => ({ workerId, leaseMs, kinds: KINDS, supervisor: h.supervisor }) } as unknown as Harness;
    let v24: CompanyStore | null = null;
    try {
      const s = seed(h.store);
      const gov = GovernanceStore.for(h.store);
      // The CEO: ACTIVE in the CEO seat, certified, then its certification REVIEW_DUE (LIVE: REASONING_PROFILE_CHANGED).
      const ceo = placed(h, s, 'company.ceo');
      const cert = certify(h, s, gov.getEmployee(ceo.id), academyWorld(h, s, ceo.roleRef));
      storeContext(h.store).db.immediate('review due', () => markReviewDue(storeContext(h.store), cert.certificationId, 'REASONING_PROFILE_CHANGED', s.founder));
      gov.grant(s.founder, { employeeId: ceo.id, capability: 'model.invoke', resourceScope: 'founder.reply', riskCeiling: 'R0', dataClassCeiling: 'D2', reasonCode: 'founder.model_access' });
      // The CEO's context for one Founder reply (ids masked: each send has its own Work Item and run).
      const contextOf = (store: CompanyStore, supervisor: ReturnType<typeof acquireSupervisor>, worker: string): string => {
        const comm = CommunicationStore.for(store);
        const sent = comm.send(s.founder, comm.directThread(s.founder, ceo.id).id, { purpose: 'QUESTION', body: 'SYNTHETIC: ما أولوياتك؟' });
        const claim = claimItem({ store, claimOpts: (workerId = 'w1', leaseMs = 10_000) => ({ workerId, leaseMs, kinds: KINDS, supervisor }) } as unknown as Harness, sent.replyWorkItemId as Id, worker);
        const r = assembleContext(store, claim.fence, { step: 0 });
        assert.equal(r.outcome, 'OK');
        return (r.outcome === 'OK' ? r.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
      };
      const before23 = contextOf(h.store, h.supervisor, 'w-v23');
      const d23 = storeContext(h.store).db;
      const snapshot = (d: typeof d23): Record<string, string> => Object.fromEntries(TABLES.map((t) => [t, JSON.stringify(d.all(`SELECT * FROM ${t} ORDER BY 1`))]));
      const rows = snapshot(d23);
      const migrations = JSON.stringify(d23.all('SELECT version, name, sha256, applied_at FROM schema_migrations ORDER BY version'));
      releaseSupervisor(h.store, h.supervisor);
      h.store.close();

      v24 = openStoreForTests(root, { clock, liveSchemaUpdate: true, migrations: loadReleasedMigrations(24) });
      const sup24 = acquireSupervisor(v24, newId(), 30_000);
      assert.deepEqual(v24.migration.applied, [24]);
      const d = storeContext(v24).db;
      const after = snapshot(d);
      for (const t of TABLES) {
        if (t === 'academy_scenarios' || t === 'staffing_requests') {
          // The two additive columns (a nullable scenario tool, headcount 1) — every existing value is as it was.
          const col = t === 'academy_scenarios' ? 'tool_code' : 'headcount';
          const list = JSON.parse(after[t] as string) as Record<string, unknown>[];
          for (const r of list) assert.equal(r[col], t === 'academy_scenarios' ? null : 1);
          assert.equal(JSON.stringify(list.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== col)))), rows[t], `${t}: existing values unchanged`);
          continue;
        }
        assert.equal(after[t], rows[t], `${t}: every row unchanged`);
      }
      assert.equal(JSON.stringify(d.all('SELECT version, name, sha256, applied_at FROM schema_migrations WHERE version <= 23 ORDER BY version')), migrations);
      for (const t of ['talent_definitions', 'employee_identity_bindings', 'access_policies', 'policy_grant_links', 'role_tool_requirements', 'talent_proposals', 'academy_manager_evaluations', 'academy_competency_results', 'certification_tool_scopes']) assert.equal(d.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n, 0, `${t} starts empty: the upgrade decides nothing`);
      assert.equal(AcademyStore.for(v24).certifications(ceo.id).find((c) => c.id === cert.certificationId)?.status, 'REVIEW_DUE', 'the CEO certification stays as it was');
      assert.equal(OrganizationStore.for(v24).seatHolder(OrganizationStore.for(v24).positionByCode('company.ceo')?.id as Id).holder?.employeeId, ceo.id);
      assert.equal(contextOf(v24, sup24, 'w-v24'), before23, 'the CEO context is identical (no catalog binding: the release kernel path is unchanged)');
      const sql = String(d.get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'founder_action_previews'")?.sql);
      for (const intent of ['TALENT_DEFINITION_DECIDE', 'ACCESS_POLICY_DECIDE', 'ACADEMY_EVALUATION_REVIEW', 'FOUNDER_DECISION_RECORD', 'BUDGET_CEILING']) assert.match(sql, new RegExp(`'${intent}'`));
      assert.deepEqual(d.all('PRAGMA foreign_key_check'), []);
      assert.equal(v24.quickCheck(), 'ok');
      releaseSupervisor(v24, sup24);
    } finally {
      v24?.close();
      if (!h.store.isClosed) h.store.close();
      removeRoot(root);
    }
  });
});
