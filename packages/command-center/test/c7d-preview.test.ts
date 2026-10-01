/**
 * C7-D internal Preview over real HTTP: an Employee's finalized revision is opened by the authenticated Founder on the
 * ISOLATED preview host (127.0.0.2, its own port), never on the Founder surface's origin. Untrusted site code is served
 * sandboxed (opaque origin, no network, no forms, no workers), with noindex / no-store; cookies are never read or set;
 * traversal, credential paths and source files are refused; a corrupt object refuses the preview; the Founder surface
 * refuses anything the preview origin sends it; a new revision is a new preview while the old one stays exact.
 * C7D-PROOF: preview-isolation
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { Id } from '@qandeel-company/domain';
import { DIGITAL_WORKSPACE_ACTIONS } from '@qandeel-company/governance';
import { CompanyStore, GovernanceStore } from '@qandeel-company/storage';
import { activateEmployeeForTest, armFounderTestSurface } from '@qandeel-company/storage/testing';

import { CSRF_COOKIE, CSRF_HEADER, FounderSurface, PREVIEW_HOST, SESSION_COOKIE, gateRequest } from '../src/index.js';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'command-center-ui');

function must<T>(v: T | null | undefined, what = 'value'): T {
  if (v === null || v === undefined) throw new Error(`${what} is missing`);
  return v;
}

interface World {
  readonly founder: string;
  readonly employeeId: Id;
  readonly employeeRef: string;
}

/** A minimal governed world: one active Employee, one fake local model route, explicit workshop grants. */
function seed(company: string): World {
  armFounderTestSurface(company);
  const store = CompanyStore.open(company);
  try {
    const gov = GovernanceStore.for(store);
    const founder = gov.registerFounder().ref;
    gov.createBudget(founder, { scope: 'COMPANY', scopeId: 'company', capMoney: 50_000_000, capTokens: 50_000_000, currency: 'USD', reasonCode: 'seed' });
    const growth = must(gov.departmentByCode('growth'));
    gov.createBudget(founder, { scope: 'DEPARTMENT', scopeId: growth.id, capMoney: 20_000_000, capTokens: 20_000_000, reasonCode: 'seed' });
    const e = gov.createEmployee(founder, { name: { given: 'سلمى', family: 'نور' }, profile: {}, cognitiveProfile: { defaultClass: 'E1', ceilingClass: 'E2', costDiscipline: 'BALANCED' }, roleRef: 'role:web-builder', positionRef: 'position:p1', departmentId: growth.id, managerRef: founder });
    gov.transitionEmployee(founder, e.id, { to: 'TRAINING', reasonCode: 'onboarding' });
    gov.transitionEmployee(founder, e.id, { to: 'PROBATION', reasonCode: 'trained' });
    const active = activateEmployeeForTest(gov, founder, e.id);
    gov.createBudget(founder, { scope: 'EMPLOYEE', scopeId: e.id, capMoney: 5_000_000, capTokens: 5_000_000, reasonCode: 'seed' });
    gov.grant(founder, { employeeId: e.id, capability: 'model.invoke', riskCeiling: 'R0', dataClassCeiling: 'D4', reasonCode: 'seed' });
    for (const a of DIGITAL_WORKSPACE_ACTIONS) gov.grant(founder, { employeeId: e.id, capability: `tool:digital-workspace.${a}`, riskCeiling: 'R1', dataClassCeiling: 'D2', reasonCode: 'seed' });
    const provider = gov.registerProvider(founder, { code: 'fake-local', locality: 'LOCAL' });
    const model = gov.registerModel(founder, { providerId: provider.id, code: 'fake-small' });
    const d = gov.registerDeployment(founder, { code: 'local-e1', modelId: model.id, pinnedRevision: 'r1', reasoningClass: 'E1', contextWindowTokens: 200_000, maxOutputTokens: 4_096, taskClasses: ['draft.memo'] });
    gov.addPriceCard(founder, d.id, { currency: 'USD', billingMode: 'METERED', billedInputPerMTok: 1_000_000, billedOutputPerMTok: 1_000_000, billedPerCall: 0, economicInputPerMTok: 1_000_000, economicOutputPerMTok: 1_000_000, economicPerCall: 0 });
    for (const q of ['BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED'] as const) gov.setQualification(founder, d.id, q, 'qualified');
    gov.approveEgress(founder, d.id, 'D4', 'egress.approved');
    gov.createRoutePolicy(founder, 'draft.memo', { minClass: 'E1', maxClass: 'E2', allowLimitedProduction: false, maxRetriesPerCall: 1, maxCallsPerRun: 10, fallbackCostCeilingMicros: null, escalation: { maxDepth: 1, maxOverheadMicros: 1_000_000 } });
    return { founder, employeeId: active.id, employeeRef: active.ref };
  } finally {
    store.close();
  }
}

const ws = (action: string, args: Record<string, unknown>): unknown => ({ type: 'TOOL_REQUEST', tool: 'digital-workspace', action, args });
const script = (...steps: unknown[]): string => JSON.stringify({ script: steps });

/** The untrusted page: it tries to read cookies, call the Company API and register a service worker. */
const HOSTILE = `<!doctype html><html lang="en"><head><title>Draft</title><link rel="stylesheet" href="/style.css"></head><body><h1>Draft</h1><script>try{document.title=String(document.cookie)}catch(e){}fetch('http://127.0.0.1/api/universe');navigator.serviceWorker&&navigator.serviceWorker.register('/sw.js')</script></body></html>`;

async function runTask(surface: FounderSurface, w: World, instructions: string): Promise<void> {
  const rt = surface.runtime;
  const { workItem } = rt.submitWorkItem({ objective: 'digital work', ownerRef: w.employeeRef, processorKind: 'c2.employee-task', processorInput: { taskClass: 'draft.memo', maxOutputTokens: 256, instructions } });
  rt.governance.createBudget(w.founder, { scope: 'WORK_ITEM', scopeId: workItem.id, capMoney: 1_000_000, capTokens: 1_000_000, reasonCode: 'seed' });
  rt.transitionWorkItem(workItem.id, { to: 'READY', reasonCode: 'release' });
  for (let i = 0; i < 1500; i++) {
    const s = rt.view.getWorkItem(workItem.id).state;
    if (s === 'COMPLETED') return;
    if (s === 'FAILED' || s === 'BLOCKED') throw new Error(`work ${s}: ${JSON.stringify(rt.governance.toolInvocations(workItem.id).map((t) => [t.state, t.failureCode]))}`);
    await sleep(20);
  }
  throw new Error('work did not finish');
}

/** A revision with a hostile page, a stylesheet, a source file, then finalized and previewed (two governed Work Items). */
async function buildPreview(surface: FounderSurface, w: World, title: string, page: string): Promise<{ revisionId: Id; previewId: Id }> {
  await runTask(surface, w, script(
    ws('project-create', { projectType: 'WEBSITE', title }),
    ws('revision-open', { projectId: '$ref:project-create.projectId' }),
    ws('file-put', { revisionId: '$ref:revision-open.revisionId', path: 'index.html', encoding: 'utf8', content: page }),
    ws('file-put', { revisionId: '$ref:revision-open.revisionId', path: 'style.css', encoding: 'utf8', content: 'h1{color:#123}' }),
    ws('file-put', { revisionId: '$ref:revision-open.revisionId', path: 'src/app.ts', encoding: 'utf8', content: 'export const x = 1;' }),
    ws('revision-finalize', { revisionId: '$ref:revision-open.revisionId' }),
    { type: 'FINAL', summaryCode: 'built' },
  ));
  const d = surface.runtime.founder.digital;
  const project = must(d.projects().find((p) => p.title === title));
  const revisionId = must(d.project(project.id).revisions[0]).id;
  await runTask(surface, w, script(ws('preview-create', { revisionId }), { type: 'FINAL', summaryCode: 'previewed' }));
  return { revisionId, previewId: must(d.project(project.id).previews[0]).id };
}

function raw(url: string, headers: Record<string, string>, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: Number(u.port), path: u.pathname + u.search, method, headers, setHost: false }, (res) => {
      let body = '';
      res.on('data', (c) => (body += String(c)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('C7-D internal Preview isolation', () => {
  test('29/43 the preview is sandboxed on its own loopback site; cookies, traversal, credential paths, source files, foreign hosts and corruption are refused', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'qc-c7d-preview-'));
    const company = path.join(base, 'مساحة-العمل');
    const w = seed(company);
    const logs: string[] = [];
    const surface = new FounderSurface({ workspace: company, roots: { app: path.join(uiRoot, 'dist', 'src'), public: path.join(uiRoot, 'public') }, runtime: { supervisorTtlMs: 3_000 }, briefing: false, fakes: { providers: ['fake-local'] }, log: (event, fields) => logs.push(`${event} ${JSON.stringify(fields)}`) });
    try {
      await surface.start();
      const { previewId, revisionId } = await buildPreview(surface, w, 'Draft site', HOSTILE);
      // The Founder opens it through the authenticated surface (session + CSRF).
      const origin = surface.origin;
      const cookies: Record<string, string> = {};
      const launch = await fetch(`${origin}/api/session/launch`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify({ token: surface.launchUrl().split('#')[1] }) });
      for (const line of launch.headers.getSetCookie()) {
        const [k, v] = (line.split(';')[0] ?? '').split('=');
        if (k && v) cookies[k] = v;
      }
      const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
      const noSession = await fetch(`${origin}/api/digital/previews/${previewId}/open`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{}' });
      assert.equal(noSession.status, 403, 'no CSRF / session → refused');
      const opened = await fetch(`${origin}/api/digital/previews/${previewId}/open`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin', Cookie: cookie, [CSRF_HEADER]: must(cookies[CSRF_COOKIE]) }, body: '{}' });
      assert.equal(opened.status, 200);
      const preview = ((await opened.json()) as { preview: { url: string; mode: string } }).preview;
      assert.equal(preview.mode, 'INTERNAL');
      const pu = new URL(preview.url);
      assert.equal(pu.hostname, PREVIEW_HOST, 'a different loopback host than the Founder surface');
      assert.notEqual(pu.origin, new URL(origin).origin);
      assert.notEqual(pu.hostname, new URL(origin).hostname, 'a different host, so a different site: the surface cookies are never sent');
      const host = `${pu.hostname}:${pu.port}`;
      // The Founder's session cookie, even if a browser sent it, changes nothing; no cookie is ever set.
      const page = await raw(preview.url, { Host: host, Cookie: `${SESSION_COOKIE}=${must(cookies[SESSION_COOKIE])}` });
      assert.equal(page.status, 200);
      assert.equal(page.body, HOSTILE);
      assert.equal(page.headers['set-cookie'], undefined);
      const csp = String(page.headers['content-security-policy']);
      assert.match(csp, /^sandbox allow-scripts;/);
      assert.doesNotMatch(csp, /allow-same-origin|allow-forms|allow-top-navigation|allow-popups/);
      assert.match(csp, /connect-src 'none'/);
      assert.match(csp, /form-action 'none'/);
      assert.match(csp, /worker-src 'none'/);
      assert.match(String(page.headers['x-robots-tag']), /noindex/);
      assert.equal(page.headers['cache-control'], 'no-store');
      assert.equal(page.headers['cross-origin-opener-policy'], 'same-origin');
      assert.match(String(page.headers['x-qandeel-preview']), /not production/);
      // Root-absolute assets of the exact revision are served; anything else is not.
      assert.equal((await raw(`${pu.origin}/style.css`, { Host: host })).status, 200);
      for (const p of ['/src/app.ts', '/..%2F..%2Fsecret', '/%2e%2e/%2e%2e/etc', '/.env', '/node_modules/x.js', '/C:%5Cwindows', '/sw.js', '/nope.html']) assert.notEqual((await raw(`${pu.origin}${p}`, { Host: host })).status, 200, p);
      assert.equal((await raw(`${pu.origin}/src/app.ts`, { Host: host })).status, 404, 'source is stored and exported, never served');
      assert.equal((await raw(preview.url, { Host: `127.0.0.1:${pu.port}` })).status, 403, 'DNS rebinding / foreign Host refused');
      assert.equal((await raw(preview.url, { Host: host }, 'POST')).status, 405);
      assert.equal((await raw(preview.url, { Host: host, 'Service-Worker': 'script' })).status, 403);
      // The preview origin cannot reach the Founder surface with Founder authority: cross-site and null-origin requests fail.
      const port = Number(new URL(origin).port);
      for (const facts of [
        { method: 'GET', host: `127.0.0.1:${port}`, origin: undefined, secFetchSite: 'cross-site', contentType: undefined, cookies, csrfHeader: undefined },
        { method: 'POST', host: `127.0.0.1:${port}`, origin: 'null', secFetchSite: 'cross-site', contentType: 'application/json', cookies, csrfHeader: cookies[CSRF_COOKIE] },
        { method: 'POST', host: `127.0.0.1:${port}`, origin: pu.origin, secFetchSite: undefined, contentType: 'application/json', cookies, csrfHeader: cookies[CSRF_COOKIE] },
      ]) assert.equal(gateRequest(facts, port).ok, false);
      const viaPreview = await raw(`${origin}/api/universe`, { Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site', Cookie: cookie });
      assert.equal(viaPreview.status, 403);
      // A preview is history for its exact revision: a new revision gets a new preview, the old one still serves its bytes.
      const second = await buildPreview(surface, w, 'Draft site two', HOSTILE.replace('Draft', 'Second'));
      assert.notEqual(second.previewId, previewId);
      assert.notEqual(second.revisionId, revisionId);
      assert.equal((await raw(preview.url, { Host: host })).body, HOSTILE);
      // Corrupt one object of the first revision on disk: the preview refuses (never a partial, altered site).
      const objects = path.join(company, 'artifacts', 'objects');
      const css = surface.runtime.founder.digital.revisionFiles(revisionId).find((f) => f.path === 'style.css');
      const p2 = path.join(objects, must(css).sha256.slice(0, 2), must(css).sha256.slice(2, 4), must(css).sha256);
      assert.ok(readdirSync(path.dirname(p2)).length > 0);
      writeFileSync(p2, 'tampered');
      assert.equal((await raw(`${pu.origin}/style.css`, { Host: host })).status, 409);
      assert.equal((await raw(preview.url, { Host: host })).status, 409, 'the whole preview refuses once an object is corrupt');
      assert.ok(logs.every((l) => !l.includes('Draft') && !l.includes('document.cookie')), 'no log line carries content');
    } finally {
      await surface.stop().catch(() => undefined);
      rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});
