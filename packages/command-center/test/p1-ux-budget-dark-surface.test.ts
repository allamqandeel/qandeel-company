/**
 * P1-UX-BUDGET-DARK-01 — the Company budget on the authenticated Founder surface, over real loopback HTTP on an isolated
 * workspace shaped like the live Company (a USD COMPANY envelope of 0.59, the CEO hired into the company-scoped seat with
 * an envelope beneath it). The Company envelope is a GET-only Founder read; its ceiling moves only through the existing
 * BUDGET_CEILING preview → fingerprint → confirm path: an invalid value is refused with no write, Cancel changes nothing,
 * a stale or tampered preview executes nothing, a ceiling above its parent is refused at confirmation, 0.59 → 5.00 changes
 * the COMPANY ceiling alone (token ceiling, spend, reservations and every other envelope as they were), the CEO's own
 * budget path still works afterwards, and re-reading shows the real new value.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CompanyStore, GovernanceStore, OrganizationStore } from '@qandeel-company/storage';
import { activateEmployeeForTest, armFounderTestSurface } from '@qandeel-company/storage/testing';

import { CSRF_COOKIE, CSRF_HEADER, FounderSurface } from '../src/index.js';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'command-center-ui');
type Body = Record<string, unknown>;

const USD = (units: number): number => Math.round(units * 1_000_000);
const COMPANY_TOKENS = 2_000_000;

function seed(company: string): { ceoId: string } {
  armFounderTestSurface(company);
  const store = CompanyStore.open(company);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const founder = gov.registerFounder().ref;
    gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: USD(0.59), capTokens: COMPANY_TOKENS, currency: 'USD', reasonCode: 'seed' });
    const seat = org.positionByCode('company.ceo');
    assert.ok(seat, 'the CEO seat exists');
    const ceo = org.hire(founder, { positionId: seat.id, name: { given: 'سليم', family: 'التجريبي' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, reasonCode: 'seed' });
    assert.equal(ceo.orgScope, 'COMPANY', 'the CEO is company-scoped: the COMPANY envelope is the parent of his');
    gov.transitionEmployee(founder, ceo.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(founder, ceo.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, founder, ceo.id);
    gov.createBudget(founder, { scope: 'EMPLOYEE', scopeId: ceo.id, capMoney: USD(0.3), capTokens: 1_000_000, reasonCode: 'seed' });
    return { ceoId: ceo.id };
  } finally {
    store.close();
  }
}

describe('P1-UX-BUDGET-DARK-01: the Company budget on the Founder surface', () => {
  test('a GET-only read; the ceiling moves only through the governed BUDGET_CEILING confirmation', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'qc-p1-ux-budget-'));
    const company = path.join(base, 'company');
    const { ceoId } = seed(company);
    const logs: string[] = [];
    const surface = new FounderSurface({ workspace: company, roots: { app: path.join(uiRoot, 'dist', 'src'), public: path.join(uiRoot, 'public') }, runtime: { supervisorTtlMs: 3_000 }, briefing: false, log: (event, fields) => logs.push(`${event} ${JSON.stringify(fields)}`) });
    const cookies: Record<string, string> = {};
    const cookie = (): string => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const get = async (p: string): Promise<{ status: number; body: Body }> => {
      const res = await fetch(`${surface.origin}${p}`, { headers: { Cookie: cookie() } });
      return { status: res.status, body: (await res.json()) as Body };
    };
    const post = async (p: string, body: unknown): Promise<{ status: number; body: Body }> => {
      const res = await fetch(`${surface.origin}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: surface.origin, 'Sec-Fetch-Site': 'same-origin', Cookie: cookie(), [CSRF_HEADER]: cookies[CSRF_COOKIE] ?? '' }, body: JSON.stringify(body) });
      for (const line of res.headers.getSetCookie()) {
        const [k, v] = (line.split(';')[0] ?? '').split('=');
        if (k && v !== undefined) cookies[k.trim()] = v.trim();
      }
      return { status: res.status, body: (await res.json()) as Body };
    };
    const companyBudget = async (): Promise<Body> => {
      const r = await get('/api/company/budget');
      assert.equal(r.status, 200);
      return r.body.budget as Body;
    };
    const ceoBudget = async (): Promise<Body> => (await get(`/api/employees/${ceoId}`)).body.budget as Body;
    const preview = async (budgetId: string, capMoney: unknown): Promise<{ status: number; body: Body }> => post('/api/previews', { intent: 'BUDGET_CEILING', payload: { budgetId, capMoney, currency: 'USD', reasonCode: 'founder.ceiling' } });
    try {
      await surface.start();
      assert.equal((await get('/api/company/budget')).status, 401, 'no session, no Company budget');
      assert.equal((await post('/api/session/launch', { token: surface.launchUrl().split('#')[1] })).status, 200);

      // The read: the COMPANY envelope as recorded, in the shape the person sheet reads; reading changes nothing.
      const first = await companyBudget();
      assert.deepEqual({ ...first, id: null }, { id: null, currency: 'USD', capMoney: USD(0.59), spentMoney: 0, reservedMoney: 0 });
      const companyId = String(first.id);
      assert.deepEqual(await companyBudget(), first, 'a second read reads the same facts');
      assert.equal((await post('/api/company/budget', { capMoney: USD(5) })).status, 404, 'the Company budget has no write route');
      const ceoBefore = await ceoBudget();
      assert.equal(ceoBefore.capMoney, USD(0.3));

      // An invalid ceiling never becomes a preview, and writes nothing.
      for (const bad of [-1, 1.5, '5', null]) {
        const r = await preview(companyId, bad);
        assert.equal(r.status, 400, `capMoney ${JSON.stringify(bad)} is refused`);
        assert.equal(r.body.code, 'VALIDATION_FAILED');
      }
      assert.equal((await post('/api/previews', { intent: 'BUDGET_CEILING', payload: { budgetId: companyId, capMoney: USD(5), currency: 'EGP', reasonCode: 'founder.ceiling' } })).body.code, 'CURRENCY_MISMATCH');
      assert.deepEqual(await companyBudget(), first, 'refused entries changed nothing');

      // The preview names the COMPANY envelope and the change from → to; the token ceiling is carried unchanged.
      const p1 = await preview(companyId, USD(5));
      assert.equal(p1.status, 200);
      const pv1 = p1.body.preview as Body;
      const pl1 = pv1.payload as Body;
      assert.deepEqual({ scope: pl1.scope, scopeId: pl1.scopeId, capMoney: pl1.capMoney, capTokens: pl1.capTokens, currency: pl1.currency }, { scope: 'COMPANY', scopeId: 'company', capMoney: USD(5), capTokens: COMPANY_TOKENS, currency: 'USD' });
      assert.match(String(pv1.summary), /^Change the COMPANY budget ceiling from USD 0\.59 to USD 5\.00\. Only the Company envelope changes/);
      // Cancel: the preview is rejected and nothing changes; it can no longer be confirmed.
      assert.equal((await post(`/api/previews/${String(pv1.id)}/reject`, { reasonCode: 'founder.cancelled' })).status, 200);
      const late = await post(`/api/previews/${String(pv1.id)}/confirm`, { fingerprint: pv1.fingerprint });
      assert.deepEqual([late.status, late.body.code, (late.body.details as Body).reason], [409, 'FOUNDER_CONFIRMATION_REQUIRED', 'ALREADY_REJECTED']);
      assert.deepEqual(await companyBudget(), first, 'Cancel changed nothing');

      // A preview whose fingerprint does not match executes nothing.
      const p2 = (await preview(companyId, USD(5))).body.preview as Body;
      const stale = await post(`/api/previews/${String(p2.id)}/confirm`, { fingerprint: `${String(p2.fingerprint).slice(0, -1)}${String(p2.fingerprint).endsWith('0') ? '1' : '0'}` });
      assert.deepEqual([stale.body.code, (stale.body.details as Body).reason], ['FOUNDER_CONFIRMATION_REQUIRED', 'FINGERPRINT_MISMATCH']);
      assert.deepEqual(await companyBudget(), first, 'a stale confirmation changed nothing');

      // Before the Company is raised, the CEO cannot be raised above it: refused at confirmation, nothing changes.
      const ceoTooHigh = (await preview(String(ceoBefore.id), USD(2))).body.preview as Body;
      assert.match(String(ceoTooHigh.summary), /^Change the budget ceiling of سليم التجريبي from USD 0\.30 to USD 2\.00$/);
      const refusedCeo = await post(`/api/previews/${String(ceoTooHigh.id)}/confirm`, { fingerprint: ceoTooHigh.fingerprint });
      assert.equal(refusedCeo.body.code, 'BUDGET_EXHAUSTED');
      assert.deepEqual(await ceoBudget(), ceoBefore);
      assert.deepEqual(await companyBudget(), first);

      // Confirm: 0.59 → 5.00 on the COMPANY envelope alone; the re-read shows the real new value.
      const ok = await post(`/api/previews/${String(p2.id)}/reject`, { reasonCode: 'founder.cancelled' });
      assert.equal(ok.status, 200);
      const p3 = (await preview(companyId, USD(5))).body.preview as Body;
      const done = await post(`/api/previews/${String(p3.id)}/confirm`, { fingerprint: p3.fingerprint });
      assert.equal(done.status, 200);
      assert.equal(done.body.resultRef, `budget:${companyId}`);
      assert.deepEqual(await companyBudget(), { ...first, capMoney: USD(5) }, 'the Company ceiling is 5.00; spent and reserved are as they were');
      assert.deepEqual(await ceoBudget(), ceoBefore, 'the CEO envelope did not change with the Company');

      // The CEO's own Budget path still works (now inside the raised Company ceiling).
      const ceoRaise = (await preview(String(ceoBefore.id), USD(2))).body.preview as Body;
      assert.equal((await post(`/api/previews/${String(ceoRaise.id)}/confirm`, { fingerprint: ceoRaise.fingerprint })).status, 200);
      assert.deepEqual(await ceoBudget(), { ...ceoBefore, capMoney: USD(2) });
      assert.equal((await companyBudget()).capMoney, USD(5), 'raising the CEO left the Company ceiling as it was');
      // …and the Company cannot be lowered beneath an envelope that can still spend.
      const tooLow = (await preview(companyId, USD(1))).body.preview as Body;
      assert.equal((await post(`/api/previews/${String(tooLow.id)}/confirm`, { fingerprint: tooLow.fingerprint })).body.code, 'VALIDATION_FAILED');
      assert.equal((await companyBudget()).capMoney, USD(5));
    } finally {
      await surface.stop();
    }
    try {
      // After the surface: the durable record holds exactly the two confirmed changes.
      const store = CompanyStore.open(company);
      try {
        const gov = GovernanceStore.for(store);
        const b = gov.budgetFor('COMPANY', 'company');
        assert.ok(b);
        assert.deepEqual({ capMoney: b.capMoney, capTokens: b.capTokens, spentMoney: b.spentMoney, reservedMoney: b.reservedMoney, spentTokens: b.spentTokens, reservedTokens: b.reservedTokens }, { capMoney: USD(5), capTokens: COMPANY_TOKENS, spentMoney: 0, reservedMoney: 0, spentTokens: 0, reservedTokens: 0 });
        const e = gov.budgetFor('EMPLOYEE', ceoId);
        assert.deepEqual({ capMoney: e?.capMoney, capTokens: e?.capTokens }, { capMoney: USD(2), capTokens: 1_000_000 });
      } finally {
        store.close();
      }
      assert.ok(logs.every((l) => !l.includes('سليم')), 'no log line carries content');
    } finally {
      rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});
