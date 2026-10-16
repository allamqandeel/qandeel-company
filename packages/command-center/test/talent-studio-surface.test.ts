/**
 * COMPANY-TALENT-01 — the Staff & Training studio on the Founder surface, over real loopback HTTP on an isolated workspace
 * shaped like the live Company (the CEO hired, ACTIVE, with its release identity):
 *   - the studio reads seats, staffing evidence, the Talent Catalog, policies, Tool readiness and people;
 *   - a template carries this build's BQM-2 pins; a Founder draft is Company content (session + CSRF, no preview), larger
 *     than an ordinary act; its approval is a structured preview whose sentence states that nothing is hired, installed,
 *     granted or spent; a hire then names the approved identity;
 *   - a seat's case is the generalized activation view of THAT seat; the CEO's "Activate the Company" view is unchanged;
 *   - free text never produces a Talent act, and a draft without the session's CSRF secret is refused.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyFounderIntent } from '@qandeel-company/governance';
import { CEO_IDENTITY_PROFILE_V1 } from '@qandeel-company/mind';
import { CompanyStore, GovernanceStore, OrganizationStore } from '@qandeel-company/storage';
import { activateEmployeeForTest, armFounderTestSurface } from '@qandeel-company/storage/testing';

import { CSRF_COOKIE, CSRF_HEADER, FounderSurface } from '../src/index.js';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'command-center-ui');
type Body = Record<string, unknown>;

function seed(company: string): void {
  armFounderTestSurface(company);
  const store = CompanyStore.open(company);
  try {
    const gov = GovernanceStore.for(store);
    const org = OrganizationStore.for(store);
    const founder = gov.registerFounder().ref;
    gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: 5_000_000, capTokens: 20_000_000, currency: 'USD', reasonCode: 'seed' });
    const seat = org.positionByCode('company.ceo');
    assert.ok(seat);
    const ceo = org.hire(founder, { positionId: seat.id, name: { given: 'Ahmed', family: 'Zaki' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E4', costDiscipline: 'BALANCED' }, profile: { displayName: { en: 'Ahmed Zaki', ar: 'أحمد زكي' }, portraitAssetRef: null, identityProfile: CEO_IDENTITY_PROFILE_V1.code, identityKernel: CEO_IDENTITY_PROFILE_V1.identityKernel }, reasonCode: 'seed' });
    gov.transitionEmployee(founder, ceo.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(founder, ceo.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, founder, ceo.id);
  } finally {
    store.close();
  }
}

describe('COMPANY-TALENT-01: the Staff & Training studio on the Founder surface', () => {
  test('studio → template → draft (content) → approval preview (moves nothing) → hire with the approved identity → the seat\'s own case; no free-text path; CSRF enforced', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'qc-talent-'));
    const company = path.join(base, 'company');
    seed(company);
    const surface = new FounderSurface({ workspace: company, roots: { app: path.join(uiRoot, 'dist', 'src'), public: path.join(uiRoot, 'public') }, runtime: { supervisorTtlMs: 3_000 }, briefing: false });
    const cookies: Record<string, string> = {};
    const cookie = (): string => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const get = async (p: string): Promise<Body> => (await (await fetch(`${surface.origin}${p}`, { headers: { Cookie: cookie() } })).json()) as Body;
    const post = async (p: string, body: unknown, csrf = true): Promise<{ status: number; body: Body }> => {
      const res = await fetch(`${surface.origin}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: surface.origin, 'Sec-Fetch-Site': 'same-origin', Cookie: cookie(), ...(csrf ? { [CSRF_HEADER]: cookies[CSRF_COOKIE] ?? '' } : {}) }, body: JSON.stringify(body) });
      for (const line of res.headers.getSetCookie()) {
        const [k, v] = (line.split(';')[0] ?? '').split('=');
        if (k && v !== undefined) cookies[k.trim()] = v.trim();
      }
      return { status: res.status, body: (await res.json()) as Body };
    };
    const preview = async (intent: string, payload: Body): Promise<Body> => {
      const p = await post('/api/previews', { intent, payload });
      assert.equal(p.status, 200, JSON.stringify(p.body));
      return p.body.preview as Body;
    };
    const confirm = async (pv: Body): Promise<string> => {
      const c = await post(`/api/previews/${String(pv.id)}/confirm`, { fingerprint: pv.fingerprint });
      assert.equal(c.status, 200, JSON.stringify(c.body));
      return String(c.body.resultRef);
    };
    try {
      await surface.start();
      assert.equal((await post('/api/session/launch', { token: surface.launchUrl().split('#')[1] })).status, 200);
      const studio = (await get('/api/talent')) as { ok: boolean; overview: Body; presets: Body };
      assert.equal(studio.ok, true);
      const seats = studio.overview.seats as Body[];
      const smi = seats.find((s) => s.roleRef === 'role:director.strategic-market-intelligence');
      assert.ok(smi && smi.holder === null, 'the vacant Director seat is listed');
      assert.equal((studio.overview.policies as Body[]).length, 4, 'the four policy templates, none approved');
      assert.ok((studio.presets as Record<string, unknown[]>)['platform-growth'], 'specialty competency presets');

      // A template: an empty identity, and a program skeleton with this build's BQM-2 pins (the Founder fills it).
      const tpl = (await get(`/api/talent/template?kind=IDENTITY_PROFILE&roleRef=${encodeURIComponent(String(smi.roleRef))}`)).body as Body;
      assert.equal(tpl.roleRef, smi.roleRef);
      const prog = (await get('/api/talent/template?kind=ACADEMY_PROGRAM&roleRef=role:director.strategic-market-intelligence&code=smi.director')).body as Body;
      assert.equal(((prog.program as Body).founderCalibrationRequired), true, 'a Director program starts with Founder Calibration (D6)');
      assert.equal(((prog.benchmarkMethod as Body).version), 'BQM-2');

      // A draft is Company content: saved with the session (CSRF), no preview; its gaps are reported.
      const body = { ...tpl, title: 'SYNTHETIC Head of Strategic Market Intelligence', roleSummary: 'SYNTHETIC: leads the Company\'s market intelligence with evidence and honest uncertainty.', personality: ['analytical', 'calm'], professionalStyle: 'SYNTHETIC: structured and evidence first in every brief.', communicationStyle: 'SYNTHETIC: concise; facts apart from analysis and assumptions.', specialties: ['SYNTHETIC: market sizing'], workBehaviour: 'SYNTHETIC: verifies sources and escalates beyond its authority.', qualityStandards: ['SYNTHETIC: every claim cited'], boundaries: ['SYNTHETIC: never spends without approval'], sourceRef: 'doc:docs/talent/synthetic.md' };
      assert.notEqual((await post('/api/talent/drafts', { kind: 'IDENTITY_PROFILE', code: 'majed-el-kedwany', body }, false)).status, 200, 'a draft without the session CSRF secret is refused');
      const saved = await post('/api/talent/drafts', { kind: 'IDENTITY_PROFILE', code: 'majed-el-kedwany', body: { ...body, boundaries: [] } });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.deepEqual(((saved.body.check as Body).gaps as Body[]).map((g) => g.field), ['boundaries']);
      const def = saved.body.definition as Body;
      const fixed = await post('/api/talent/drafts', { kind: 'IDENTITY_PROFILE', definitionId: def.id, expectedRowVersion: def.rowVersion, body });
      assert.equal(((fixed.body.check as Body).ok), true);
      // A large program draft fits (above the ordinary 64 KB body bound).
      const big = { ...prog, title: 'x'.repeat(10), skills: Array.from({ length: 6 }, (_, i) => ({ code: `smi.director.s${i}`, name: `S${i}`, versionLabel: '1.0.0', instructions: 'SYNTHETIC '.repeat(1_500), blueprintCategory: 'REQUIRED', critical: true, minProficiency: 'QUALIFIED', targetProficiency: 'QUALIFIED', sourceRefs: ['authority:stage-7'], benchmark: [] })) };
      assert.equal((await post('/api/talent/drafts', { kind: 'ACADEMY_PROGRAM', body: big })).status, 200, 'a program draft larger than 64 KB is accepted');

      // Approval: a structured preview; the sentence says nothing is hired, installed, granted or spent.
      const pv = await preview('TALENT_DEFINITION_DECIDE', { definitionId: def.id, decision: 'APPROVE' });
      const summary = String(pv.summary);
      for (const must of ['Approve the identity profile majed-el-kedwany v1', 'Nothing is hired, installed, granted or spent now']) assert.ok(summary.includes(must), `${must} — ${summary}`);
      await confirm(pv);
      const hire = await preview('EMPLOYEE_HIRE', { positionId: smi.positionId, givenName: 'Majed', familyName: 'Kedwany', identityDefinitionId: def.id });
      assert.ok(String(hire.summary).includes('with the approved identity majed-el-kedwany v1'));
      const employee = (await confirm(hire)).split(':')[1];
      // The seat's own case: the generalized activation view of THAT seat (holder = Majed), not the CEO's.
      const seatCase = (await get(`/api/activation?positionId=${String(smi.positionId)}`)) as { view: Body; registry: Body };
      assert.equal(((seatCase.view.ceo as Body).employeeId), employee);
      assert.equal(((seatCase.view.seat as Body).kind), 'DIRECTOR');
      const ceoCase = (await get('/api/activation')) as { view: Body };
      assert.equal(((ceoCase.view.ceo as Body).name), 'Ahmed Zaki', 'the CEO activation view is unchanged');
      // Free text never produces a Talent act.
      for (const text of ['approve the identity of Majed', 'hire Majed into strategic market intelligence', 'open a seat for a reddit specialist', 'grant company knowledge to the directors']) {
        const intent = classifyFounderIntent(text);
        assert.ok(intent.kind !== 'MUTATING' || !['TALENT_DEFINITION_DECIDE', 'EMPLOYEE_HIRE', 'POSITION_CREATE', 'ACCESS_POLICY_DECIDE'].includes(intent.intent), text);
      }
      const studio2 = (await get('/api/talent')) as { overview: Body };
      const people = studio2.overview.people as Body[];
      assert.ok(people.some((p) => p.employeeId === employee && p.identity !== null), 'the studio shows the new Employee with its catalog identity');
    } finally {
      await surface.stop();
      rmSync(base, { recursive: true, force: true });
    }
  });
});
