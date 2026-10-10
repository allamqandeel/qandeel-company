/**
 * P1-PRODUCT-KNOWLEDGE-01 (D-P1-06) — the Founder surface, over real loopback HTTP on an isolated workspace shaped like the
 * live Company (the CEO hired into the company-scoped seat as Salim Nasser / سليم ناصر):
 *   - the rename is a governed preview whose sentence states what stays the same; the person sheet re-reads the new English
 *     and Arabic name on the same Employee ID, with the same grants and budget;
 *   - product knowledge is granted through its own preview (read-only, anonymous, no budget change), the person sheet shows
 *     the grant, and revocation removes it;
 *   - the host wires the read-only reader as a Tool driver (inert until granted); nothing is read by any of this.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CEO_IDENTITY_PROFILE_V1 } from '@qandeel-company/mind';
import { CompanyStore, GovernanceStore, OrganizationStore } from '@qandeel-company/storage';
import { activateEmployeeForTest, armFounderTestSurface } from '@qandeel-company/storage/testing';
import { FakeProductDocsTransport } from '@qandeel-company/tool-drivers';

import { CSRF_COOKIE, CSRF_HEADER, FounderSurface } from '../src/index.js';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'command-center-ui');
type Body = Record<string, unknown>;

function seed(company: string): { ceoId: string } {
  armFounderTestSurface(company);
  const store = CompanyStore.open(company);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const founder = gov.registerFounder().ref;
    gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: 590_000, capTokens: 2_000_000, currency: 'USD', reasonCode: 'seed' });
    const seat = org.positionByCode('company.ceo');
    assert.ok(seat);
    const ceo = org.hire(founder, { positionId: seat.id, name: { given: 'Salim', family: 'Nasser' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, profile: { displayName: { en: 'Salim Nasser', ar: 'سليم ناصر' }, portraitAssetRef: null, identityProfile: CEO_IDENTITY_PROFILE_V1.code, identityKernel: CEO_IDENTITY_PROFILE_V1.identityKernel }, reasonCode: 'seed' });
    gov.transitionEmployee(founder, ceo.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(founder, ceo.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, founder, ceo.id);
    gov.createBudget(founder, { scope: 'EMPLOYEE', scopeId: ceo.id, capMoney: 300_000, capTokens: 1_000_000, reasonCode: 'seed' });
    return { ceoId: ceo.id };
  } finally {
    store.close();
  }
}

describe('P1-PRODUCT-KNOWLEDGE-01: the rename and product knowledge on the Founder surface', () => {
  test('governed previews state what changes and what stays; the person sheet re-reads the same Employee', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'qc-p1-pk-'));
    const company = path.join(base, 'company');
    const { ceoId } = seed(company);
    const docs = new FakeProductDocsTransport();
    const surface = new FounderSurface({ workspace: company, roots: { app: path.join(uiRoot, 'dist', 'src'), public: path.join(uiRoot, 'public') }, runtime: { supervisorTtlMs: 3_000 }, briefing: false, productDocsTransport: docs });
    const cookies: Record<string, string> = {};
    const cookie = (): string => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const get = async (p: string): Promise<Body> => (await (await fetch(`${surface.origin}${p}`, { headers: { Cookie: cookie() } })).json()) as Body;
    const post = async (p: string, body: unknown): Promise<{ status: number; body: Body }> => {
      const res = await fetch(`${surface.origin}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: surface.origin, 'Sec-Fetch-Site': 'same-origin', Cookie: cookie(), [CSRF_HEADER]: cookies[CSRF_COOKIE] ?? '' }, body: JSON.stringify(body) });
      for (const line of res.headers.getSetCookie()) {
        const [k, v] = (line.split(';')[0] ?? '').split('=');
        if (k && v !== undefined) cookies[k.trim()] = v.trim();
      }
      return { status: res.status, body: (await res.json()) as Body };
    };
    const confirm = async (intent: string, payload: Body): Promise<{ summary: string; payload: Body }> => {
      const p = await post('/api/previews', { intent, payload });
      assert.equal(p.status, 200, JSON.stringify(p.body));
      const pv = p.body.preview as Body;
      const c = await post(`/api/previews/${String(pv.id)}/confirm`, { fingerprint: pv.fingerprint });
      assert.equal(c.status, 200, JSON.stringify(c.body));
      return { summary: String(pv.summary), payload: pv.payload as Body };
    };
    try {
      await surface.start();
      assert.ok(surface.runtime.governanceDiagnostics().toolDrivers.includes('github.product-docs'), 'the host wires the read-only reader');
      assert.equal((await post('/api/session/launch', { token: surface.launchUrl().split('#')[1] })).status, 200);
      const before = await get(`/api/employees/${ceoId}`);
      assert.deepEqual((before.employee as Body).name, { given: 'Salim', family: 'Nasser' });

      // The rename: refused shapes write nothing; the confirmation sentence names what stays the same.
      const bad = await post('/api/previews', { intent: 'EMPLOYEE_RENAME', payload: { employeeId: ceoId, givenName: 'Ahmed', familyName: 'Zaki', displayNameAr: 'Ahmed Zaki' } });
      assert.equal(bad.status, 400);
      const rename = await confirm('EMPLOYEE_RENAME', { employeeId: ceoId, givenName: 'Ahmed', familyName: 'Zaki', displayNameAr: 'أحمد ذكي', reasonCode: 'founder.rename' });
      assert.match(rename.summary, /^Rename Salim Nasser \(سليم ناصر\) to Ahmed Zaki \(أحمد ذكي\)\. The same Employee: its ID, seat, lifecycle, grants, budget, memory, skills, certifications, conversations and history stay as they are\./);
      const after = await get(`/api/employees/${ceoId}`);
      assert.equal((after.employee as Body).id, ceoId);
      assert.deepEqual((after.employee as Body).name, { given: 'Ahmed', family: 'Zaki' });
      assert.equal((after.profile as Body).displayNameAr, 'أحمد ذكي');
      assert.deepEqual(after.grants, before.grants);
      assert.deepEqual(after.budget, before.budget);

      // Product knowledge: the first grant names the source; the sentence states read-only and no budget change.
      const grant = await confirm('PRODUCT_KNOWLEDGE_ACCESS', { employeeId: ceoId, repository: 'github:acme-test/product', reasonCode: 'founder.product_knowledge' });
      assert.match(grant.summary, /^Grant Ahmed Zaki read-only product knowledge: on request, it reads the QANDEEL App's documentation from github:acme-test\/product/);
      assert.match(grant.summary, /Read-only: no write, commit, merge, branch, local repository, shell or secret\. No budget, reasoning level or other authority changes; no provider call now$/);
      const granted = await get(`/api/employees/${ceoId}`);
      assert.ok((granted.grants as Body[]).some((g) => g.capability === 'tool:product-knowledge.product-docs-read' && g.riskCeiling === 'R0'));
      assert.deepEqual(granted.budget, before.budget, 'no budget change');
      const revoke = await confirm('PRODUCT_KNOWLEDGE_ACCESS', { employeeId: ceoId, decision: 'REVOKE', reasonCode: 'founder.product_knowledge_revoke' });
      assert.match(revoke.summary, /^Revoke Ahmed Zaki's read-only product knowledge access \(1 grant\(s\)\)/);
      assert.ok(!((await get(`/api/employees/${ceoId}`)).grants as Body[]).some((g) => g.capability === 'tool:product-knowledge.product-docs-read'));
      assert.equal(docs.requests.length, 0, 'granting reads nothing: only a granted Employee\'s own request does');
    } finally {
      await surface.stop().catch(() => undefined);
      rmSync(base, { recursive: true, force: true });
    }
  });
});
