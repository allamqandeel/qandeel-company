/**
 * L1-02 — the "Activate the Company" read over real loopback HTTP, on a FRESH workspace with no test seam: the launch
 * token registers the Founder, the activation view shows the vacant canonical CEO seat and the release-pinned registry,
 * text never produces an activation act (structured-only), a typed / altered package digest is refused, and the provider
 * view labels the cap in the profile's own currency. L1-02-PROOF: activation-surface
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CEO_ACADEMY_PACKAGE_V1, CEO_ACADEMY_PACKAGE_V2, CEO_ACADEMY_PACKAGE_V3, academyPackageDigest } from '@qandeel-company/mind';
import { DEEPSEEK_V41_FLASH_ACADEMY_PROFILE } from '@qandeel-company/model-providers';

import { structuredSummary } from '../src/api.js';
import { CSRF_COOKIE, CSRF_HEADER, FounderSurface } from '../src/index.js';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'command-center-ui');
type Body = Record<string, unknown>;

function client(origin: string) {
  const cookies: Record<string, string> = {};
  const header = (): string => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    async get(p: string): Promise<{ status: number; body: Body }> {
      const res = await fetch(`${origin}${p}`, { headers: { Cookie: header() } });
      return { status: res.status, body: (await res.json()) as Body };
    },
    async post(p: string, body: unknown, noCsrf = false): Promise<{ status: number; body: Body }> {
      const res = await fetch(`${origin}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin', Cookie: header(), ...(noCsrf ? {} : { [CSRF_HEADER]: cookies[CSRF_COOKIE] ?? '' }) }, body: JSON.stringify(body) });
      for (const line of res.headers.getSetCookie()) {
        const [k, v] = (line.split(';')[0] ?? '').split('=');
        if (k && v !== undefined) cookies[k.trim()] = v.trim();
      }
      return { status: res.status, body: (await res.json()) as Body };
    },
  };
}

describe('L1-02: the Company activation flow on the authenticated surface', () => {
  test('a fresh workspace: the launch token registers the Founder; the activation view shows the vacant CEO seat and the release-pinned package; text never hires; a typed digest is refused', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'qc-l1-02-surface-'));
    const logs: string[] = [];
    const surface = new FounderSurface({ workspace: path.join(base, 'company'), roots: { app: path.join(uiRoot, 'dist', 'src'), public: path.join(uiRoot, 'public') }, runtime: { supervisorTtlMs: 3_000 }, provisioningProfiles: [DEEPSEEK_V41_FLASH_ACADEMY_PROFILE], briefing: false, log: (event, fields) => logs.push(`${event} ${JSON.stringify(fields)}`) });
    try {
      await surface.start();
      const c = client(surface.origin);
      assert.equal((await c.get('/api/activation')).status, 401, 'no session, no activation view');
      assert.equal((await c.get('/api/academy/attempts/00000000-0000-4000-8000-000000000001/answer')).status, 401, 'no session, no answer read');
      assert.equal((await c.post('/api/session/launch', { token: surface.launchUrl().split('#')[1] }, true)).status, 200);
      // The answer read is explicit and Founder-scoped: an unknown attempt is NOT_FOUND, never a generic inspection.
      const none = await c.get('/api/academy/attempts/00000000-0000-4000-8000-000000000001/answer');
      assert.equal(none.status, 404);
      assert.equal((await c.get('/api/academy/attempts/not-an-id/answer')).status, 404, 'only an attempt ID matches the route');
      const a = await c.get('/api/activation');
      assert.equal(a.status, 200);
      const view = a.body.view as Body;
      const registry = a.body.registry as Body;
      assert.equal(view.next, 'PROVISION_PROVIDER');
      assert.equal(view.ceo, null, 'the canonical CEO seat starts vacant');
      assert.equal((view.seat as Body).code, 'company.ceo');
      assert.equal((view.seat as Body).roleRef, 'role:company.ceo');
      // D-L1-19 / D-L1-22: the current package version (v3) and the failed v2 and v1 (history) are all registered, each with its exact digest.
      const listed = registry.packages as Body[];
      assert.deepEqual(listed.map((p) => `${String(p.code)}@${String(p.version)}:${String(p.sha256)}`), [CEO_ACADEMY_PACKAGE_V3, CEO_ACADEMY_PACKAGE_V2, CEO_ACADEMY_PACKAGE_V1].map((p) => `${p.code}@${p.version}:${academyPackageDigest(p)}`), 'the exact digests the Founder qualifies / installs are visible');
      const pkg = listed[0];
      assert.ok((pkg?.scenarios as Body[]).filter((s) => s.kind === 'HOLDOUT').every((s) => s.content === null), 'holdout scenarios are never shown in advance');
      const profile = ((registry.providers as Body).profiles as Body[])[0];
      assert.equal(profile?.currency, 'USD', 'the cap is labelled in the profile\'s own currency');
      assert.deepEqual(profile?.taskClasses, ['founder.reply', 'founder.brief', 'skill.benchmark', 'academy.attempt', 'academy.shadow']);
      // The read intent; text never produces an activation act (structured-only).
      const read = await c.post('/api/command', { text: 'تفعيل الشركة' });
      assert.equal((read.body.intent as Body).intent, 'SHOW_ACTIVATION');
      assert.ok(read.body.activation, 'the palette receives the activation view');
      for (const text of ['hire Salim Nasser as CEO', 'activate Salim', 'approve activation of Salim', 'وافق على تفعيل سليم']) {
        const r = await c.post('/api/command', { text });
        assert.equal(r.body.preview, undefined, `"${text}" never produces a preview`);
      }
      // A preview of a package with an altered digest is refused (release-pinned; never typed).
      const bad = await c.post('/api/previews', { intent: 'SKILL_PACKAGE_QUALIFY', payload: { packageCode: CEO_ACADEMY_PACKAGE_V1.code, packageVersion: 1, packageSha256: 'f'.repeat(64), subjectEmployeeId: '00000000-0000-4000-8000-000000000001' } });
      assert.equal(bad.status >= 400, true);
      assert.match(JSON.stringify(bad.body), /PACKAGE_DIGEST_MISMATCH|digest/);
      assert.ok(logs.every((l) => !l.includes('تفعيل') && !l.includes('Salim')), 'no log line carries Founder text');
    } finally {
      await surface.stop().catch(() => undefined);
      rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });

  test('the production default (CEO briefing on, as `qandeel-founder serve` runs it) constructs and starts (D-L1-17)', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'qc-l1-02-serve-'));
    const surface = new FounderSurface({ workspace: path.join(base, 'company'), roots: { app: path.join(uiRoot, 'dist', 'src'), public: path.join(uiRoot, 'public') }, runtime: { supervisorTtlMs: 3_000 } });
    try {
      await surface.start();
      assert.notEqual(surface.briefing, null, 'the briefing policy exists once the runtime is open');
      assert.equal(surface.runtime.state, 'READY');
    } finally {
      await surface.stop().catch(() => undefined);
      rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
  // D-L1-23 / L1-02-PROOF: bqm2-preview — the Founder reads exactly the method, the observation count and the enforced bounds.
  test('a BQM-2 qualification preview states its method, fixed class, observations and enforced cost bounds (never an estimate posing as a bound)', () => {
    const payload = { qualification: 'QUALIFY', packageCode: 'ceo.company-ceo', packageVersion: 4, packageSha256: 'b'.repeat(64), benchmarkMethod: 'BQM-2', methodSha256: 'ddaefacfb58656c643268e4ad3d49738787d276124cb09a8546bc58987f3f81a', rubricVersion: 'R2', answerContractVersion: 'AC-4', answerContractSha256: 'f787b888c16220aa50fa1149d8bafc250ecaf41861f98ce047c1049d315ecaae', reasoningClass: 'E1', observationsPerArm: 5, maxModelCallsPerObservation: 2, benchmarkRuns: 120, perRunCapMicros: 40000, totalCapBoundMicros: 4800000, envelopeRemainingMicros: 341214, scoresToFinalize: 0 };
    const text = structuredSummary({} as Parameters<typeof structuredSummary>[0], { intentKind: 'SKILL_PACKAGE_QUALIFY', payload });
    for (const part of ['under benchmark method BQM-2 (declaration ddaefacfb586…, rubric R2, ANSWER contract AC-4 f787b888c162…)', '120 bounded benchmark observations', '5 per case and arm, every one at the fixed reasoning class E1', 'one same-class retry after an invalid output; two invalid outputs fail the observation', 'each capped at 40000 micro-units for at most 2 model calls', 'the enforced cap bound on the total is 4800000 micro-units', 'the hard stop is the Employee envelope (341214 micro-units remaining)', 'exhausting it leaves the package incomplete, never overspent, and no budget is raised', 'Nothing is approved here']) assert.ok(text.includes(part), part);
    const bqm1 = structuredSummary({} as Parameters<typeof structuredSummary>[0], { intentKind: 'SKILL_PACKAGE_QUALIFY', payload: { ...payload, benchmarkMethod: undefined, benchmarkRuns: 24 } });
    assert.ok(!bqm1.includes('BQM-2') && bqm1.includes('24 bounded benchmark runs (with / without each skill)'), 'a BQM-1 preview text is unchanged');
  });
});
