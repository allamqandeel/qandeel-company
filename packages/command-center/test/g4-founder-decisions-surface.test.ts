/**
 * G4-FINAL-CLOSURE-01 (D-P1-17) — recording a Founder decision on the Founder surface, over real loopback HTTP on an
 * isolated workspace shaped like the live Company (the CEO hired into the company-scoped seat):
 *   - the decision is a structured governed preview from the Founder's own message: its sentence states what is recorded,
 *     who retrieves it and that it moves no budget, grant, assignment or approval; nothing is recorded before the confirm;
 *   - the conversation page lists the decisions recorded from it (in force and history); a revocation is its own preview;
 *   - free text never produces the act (no command path), and a request without the session's CSRF secret is refused.
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
    const ceo = org.hire(founder, { positionId: seat.id, name: { given: 'Ahmed', family: 'Zaki' }, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E4', costDiscipline: 'BALANCED' }, profile: { displayName: { en: 'Ahmed Zaki', ar: 'أحمد زكي' }, portraitAssetRef: null, identityProfile: CEO_IDENTITY_PROFILE_V1.code, identityKernel: CEO_IDENTITY_PROFILE_V1.identityKernel }, reasonCode: 'seed' });
    gov.transitionEmployee(founder, ceo.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(founder, ceo.id, { to: 'PROBATION', reasonCode: 'trained' });
    activateEmployeeForTest(gov, founder, ceo.id);
    return { ceoId: ceo.id };
  } finally {
    store.close();
  }
}

describe('G4-FINAL-CLOSURE-01: Founder decisions on the Founder surface', () => {
  test('record → listed in force; amend → v2 in force, v1 history; revoke → none in force; the sentence states it moves nothing; no free-text path', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'qc-g4-fd-'));
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
      const thread = ((await post('/api/threads', {})).body.thread as Body).id as string;
      const say = async (body: string): Promise<string> => (((await post(`/api/threads/${thread}/messages`, { purpose: 'FYI', body, responseRequired: false })).body.message as Body).id as string);
      const decisions = async (): Promise<Body[]> => (await get(`/api/threads/${thread}/messages?limit=50`)).decisions as Body[];
      const m1 = await say('قررنا إن ميزانية التسويق للربع الجاي 40 ألف جنيه، وسارة مسؤولة عنها.');
      assert.deepEqual(await decisions(), [], 'a conversation records nothing by itself');

      const pv = await preview('FOUNDER_DECISION_RECORD', { messageId: m1, subject: 'ميزانية التسويق للربع الجاي', statement: 'ميزانية التسويق للربع الجاي 40,000 جنيه، وسارة مسؤولة عنها.' });
      const summary = String(pv.summary);
      for (const must of ['Record as your decision (v1, D2)', 'ميزانية التسويق للربع الجاي', 'the CEO', 'it moves no budget, grant, assignment or approval', 'No provider call']) assert.ok(summary.includes(must), must);
      assert.deepEqual(await decisions(), [], 'a preview records nothing');
      const unsafe = await post(`/api/previews/${String(pv.id)}/confirm`, { fingerprint: pv.fingerprint }, false);
      assert.notEqual(unsafe.status, 200, 'a confirm without the session CSRF secret is refused');
      assert.deepEqual(await decisions(), []);
      const v1 = (await confirm(pv)).replace('knowledge:', '');
      let list = await decisions();
      assert.deepEqual(list.map((d) => [d.id, d.decisionVersion, d.inForce, d.sourceMessageId]), [[v1, 1, true, m1]]);

      const m2 = await say('عدّل ميزانية التسويق من 40 لـ 30 ألف.');
      const amend = await preview('FOUNDER_DECISION_RECORD', { messageId: m2, subject: 'ميزانية التسويق للربع الجاي', statement: 'ميزانية التسويق للربع الجاي 30,000 جنيه، وسارة مسؤولة عنها.', supersedesId: v1 });
      assert.match(String(amend.summary), /It replaces version 1 of this decision/);
      const v2 = (await confirm(amend)).replace('knowledge:', '');
      list = await decisions();
      assert.deepEqual(list.map((d) => [d.id, d.decisionVersion, d.inForce, d.status]), [[v1, 1, false, 'SUPERSEDED'], [v2, 2, true, 'ACTIVE']]);

      const revoke = await preview('FOUNDER_DECISION_REVOKE', { decisionId: v2 });
      assert.match(String(revoke.summary), /stops being in force at once.*its history is kept/);
      await confirm(revoke);
      list = await decisions();
      assert.equal(list.filter((d) => d.inForce === true).length, 0);
      assert.equal(list.length, 2, 'history is kept');

      // Free text never produces the act: the command palette has no path to it.
      const cmd = await post('/api/command', { text: 'اعتمدت ميزانية التسويق 40 ألف' });
      assert.notEqual((cmd.body as Body).intent, 'FOUNDER_DECISION_RECORD');
      assert.equal(JSON.stringify(cmd.body).includes('FOUNDER_DECISION_RECORD'), false);
    } finally {
      await surface.stop();
      rmSync(base, { recursive: true, force: true });
    }
  });
});
