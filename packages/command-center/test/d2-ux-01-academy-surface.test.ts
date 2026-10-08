/**
 * D2-UX-01 — the company-wide Academy overview on the authenticated surface, over real loopback HTTP on a fresh
 * workspace: no session, no read; the overview is a GET-only Founder read that reports the empty Company truthfully,
 * carries the release-pinned package titles only for recorded packages, and changes nothing the Company counts (no
 * Work Item, job, run, audit, attention or session beyond the Founder's own). The Meeting Room has no route at all.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CSRF_COOKIE, CSRF_HEADER, FounderSurface } from '../src/index.js';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'command-center-ui');
type Body = Record<string, unknown>;

describe('D2-UX-01: the Academy overview on the Founder surface', () => {
  test('Founder-only, GET-only, truthful on an empty Company, and it changes nothing', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'qc-d2-ux-01-'));
    const surface = new FounderSurface({ workspace: path.join(base, 'company'), roots: { app: path.join(uiRoot, 'dist', 'src'), public: path.join(uiRoot, 'public') }, runtime: { supervisorTtlMs: 3_000 }, briefing: false, log: () => undefined });
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
    try {
      await surface.start();
      assert.equal((await get('/api/academy')).status, 401, 'no session, no Academy');
      assert.equal((await post('/api/session/launch', { token: surface.launchUrl().split('#')[1] })).status, 200);
      const health = async (): Promise<string> => {
        const h = (await get('/api/health')).body;
        return JSON.stringify({ attention: h.attention, communication: h.communication, goals: h.goals, sessions: h.sessions, org: h.org, governance: h.governance });
      };
      const before = await health();
      const first = await get('/api/academy');
      assert.equal(first.status, 200);
      const v = first.body;
      assert.deepEqual(v.packages, [], 'no package is recorded on a fresh Company — none is shown');
      assert.deepEqual(v.programs, []);
      assert.deepEqual(v.totals, { employees: (v.employees as unknown[]).length, enrolled: 0, certifiedValid: 0, attemptsEvaluated: 0, attemptsPassed: 0, packagesInstalled: 0 });
      for (let i = 0; i < 3; i++) {
        const again = await get('/api/academy');
        assert.deepEqual({ ...again.body, at: null }, { ...v, at: null }, 'a refresh reads the same facts');
      }
      assert.equal(await health(), before, 'opening and refreshing the Academy changes nothing the Company counts');
      assert.equal((await post('/api/academy', {})).status, 404, 'the Academy has no write route');
      for (const p of ['/api/meetings', '/api/meeting-room']) assert.equal((await get(p)).status, 404, `${p}: the Meeting Room reads and writes nothing`);
    } finally {
      await surface.stop();
      rmSync(base, { recursive: true, force: true });
    }
  });
});
