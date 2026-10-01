/**
 * C7-D on the real runtime: an Employee creates and iterates digital work inside the Company — project, working revision,
 * files, finalized revision, internal preview, SEO readiness, release candidate — through the ordinary Tool Executor with
 * explicit grants and NO Founder approval; then exports the exact candidate to GitHub only after independent review and
 * the Founder's approval, and a production merge is a separate approval bound to the exported head.
 * C7D-PROOF: runtime-c7d
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, test } from 'node:test';

import type { Id } from '@qandeel-company/domain';
import { FakeGitHubTransport, GitHubCodeHostDriver } from '@qandeel-company/tool-drivers';

import type { CompanyRuntime } from '../../src/index.js';
import { removeRoot, tempRoot, eventually } from '../helpers.js';
import { fakes, final, governedRuntime, script, seedWorld, submitTask, type C2World } from '../c2/c2-seed.js';
import { certifyAndPromote, plan, seedReviewer, submitTaskWithPlan } from '../c4/c4-seed.js';
import { PAGE, gh, grantGitHub, grantWorkshop, registerGitHub, ws } from './c7d-seed.js';

const done = async (rt: CompanyRuntime, id: string, states: readonly string[], ms = 30_000): Promise<string> =>
  eventually(() => (states.includes(rt.view.getWorkItem(id as Id).state) ? rt.view.getWorkItem(id as Id).state : undefined), ms, `work item → ${states.join('|')}`);

const explain = (rt: CompanyRuntime, id: string): string => JSON.stringify({ runs: rt.view.runsForWorkItem(id as Id).map((r) => [r.state, r.failureCode]), tools: rt.governance.toolInvocations(id as Id).map((t) => [t.state, t.failureCode]) });

/** Two ordinary Work Items: build (project → revision → files → finalize), then package (preview → SEO → candidate). */
async function buildCandidate(rt: CompanyRuntime, w: C2World, title = 'Launch site exploration'): Promise<{ projectId: Id; revisionId: Id; candidateId: Id }> {
  const build = submitTask(rt, w, {
    instructions: script(
      ws('project-create', { projectType: 'WEBSITE', title }),
      ws('revision-open', { projectId: '$ref:project-create.projectId' }),
      ws('file-put', { revisionId: '$ref:revision-open.revisionId', path: 'index.html', encoding: 'utf8', content: PAGE('QANDEEL') }),
      ws('file-put', { revisionId: '$ref:revision-open.revisionId', path: 'about/index.html', encoding: 'utf8', content: PAGE('About QANDEEL', 'من نحن') }),
      ws('file-put', { revisionId: '$ref:revision-open.revisionId', path: 'logo.png', encoding: 'base64', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') }),
      ws('revision-finalize', { revisionId: '$ref:revision-open.revisionId' }),
      final('digital.built'),
    ),
  });
  assert.equal(await done(rt, build, ['COMPLETED', 'FAILED', 'BLOCKED']), 'COMPLETED', explain(rt, build));
  const project = rt.founder.digital.projects().find((p) => p.title === title);
  assert.ok(project);
  const revisionId = rt.founder.digital.project(project.id).revisions[0]!.id;
  const pack = submitTask(rt, w, {
    instructions: script(
      ws('preview-create', { revisionId }),
      ws('seo-check', { revisionId }),
      ws('candidate-create', { revisionId, kind: 'WEBSITE', summary: 'First internal draft of the launch site: home and about pages.' }),
      final('digital.packaged'),
    ),
  });
  assert.equal(await done(rt, pack, ['COMPLETED', 'FAILED', 'BLOCKED']), 'COMPLETED', explain(rt, pack));
  const candidateId = rt.founder.digital.project(project.id).candidates[0]!.id;
  return { projectId: project.id, revisionId, candidateId };
}

describe('C7-D Digital Workshop on the runtime', () => {
  test('1/33 an Employee builds, previews and packages a website candidate internally with no Founder approval; content stays in the Artifact Store', async () => {
    const root = tempRoot('c7d-runtime');
    const w = seedWorld(root);
    const rt = governedRuntime(root, fakes());
    await rt.start();
    try {
      grantWorkshop(rt, w);
      const { projectId, revisionId } = await buildCandidate(rt, w);
      const p = rt.founder.digital.project(projectId);
      const rev = p.revisions[0]!;
      assert.equal(rev.id, revisionId);
      assert.equal(rev.state, 'FINALIZED');
      assert.match(rev.manifestSha256 ?? '', /^[0-9a-f]{64}$/);
      assert.equal(rev.fileCount, 3);
      assert.equal(p.previews[0]?.state, 'READY');
      assert.equal(p.previews[0]?.mode, 'INTERNAL');
      assert.equal(p.candidates.length, 1);
      assert.equal(p.candidates[0]?.manifestSha256, rev.manifestSha256);
      assert.equal(p.candidates[0]?.intact, true);
      // Internal creation needed no Founder decision at all.
      assert.equal(rt.governance.listApprovals().length, 0);
      const files = rt.founder.digital.revisionFiles(rev.id);
      assert.deepEqual(files.map((x) => x.path), ['about/index.html', 'index.html', 'logo.png']);
      for (const x of files) assert.match(x.sha256, /^[0-9a-f]{64}$/);
    } finally {
      await rt.stop();
      removeRoot(root);
    }
  });

  test('16/18/21/23/13 export reaches GitHub only through review + Founder approval of the exact act; the merge is a separate approval bound to the exported head', async () => {
    const root = tempRoot('c7d-github');
    const w = seedWorld(root);
    const rw = seedReviewer(root, w);
    const f = fakes();
    const github = new FakeGitHubTransport();
    github.addRepo('qandeel-test/site');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    let rtRef: CompanyRuntime | null = null;
    const source = {
      resolve: (...a: Parameters<ReturnType<CompanyRuntime['promotionSource']>['resolve']>) => (rtRef as CompanyRuntime).promotionSource().resolve(...a),
      target: (a: string, t: string) => (rtRef as CompanyRuntime).promotionSource().target(a, t),
      promotionArgs: (id: string) => (rtRef as CompanyRuntime).promotionSource().promotionArgs(id),
    };
    const driver = new GitHubCodeHostDriver({ transport: github, credentials: { appCredentials: () => ({ appId: '1001', installationId: '2002', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }) }, credentialRef: 'vault:github-app', source, allowedRepositories: ['qandeel-test/site'] });
    const rt = governedRuntime(root, f, { governance: { providers: [f.local, f.cloud], toolDrivers: [...Object.values(f.drivers), driver], modelCallTimeoutMs: 5_000, toolCallTimeoutMs: 5_000 } });
    rtRef = rt;
    await rt.start();
    try {
      grantWorkshop(rt, w);
      grantGitHub(rt, w);
      const { targetId } = registerGitHub(rt, w);
      await certifyAndPromote(rt, w, rw);
      const { candidateId } = await buildCandidate(rt, w);
      // The promotion: prepared internally, then the exact external act (reviewed, then approved by the Founder).
      const exportWi = submitTaskWithPlan(rt, w, script(ws('promotion-prepare', { candidateId, targetId, kind: 'EXPORT_SOURCE' }), gh('candidate-export', '$ref:promotion-prepare.args'), final('digital.exported')), plan('ACTIONS', 'PASS'));
      const pending = await eventually(() => rt.governance.listApprovals('PENDING').find((a) => a.workItemId === exportWi), 60_000, 'export approval');
      // Before the Founder decides, nothing reached GitHub except nothing at all (no token, no write).
      assert.equal(github.requests.length, 0);
      const promotion = rt.founder.digital.project(rt.founder.digital.projects()[0]!.id).candidates[0]!.promotions[0]!;
      assert.equal(promotion.state, 'READY_FOR_FOUNDER');
      assert.equal(promotion.kind, 'EXPORT_SOURCE');
      assert.equal(rt.founder.digital.decisions()[0]?.approvalId, pending.id);
      rt.governance.decideApproval(w.founder, pending.id, { decision: 'APPROVE', reasonCode: 'founder.export' });
      assert.equal(await done(rt, exportWi, ['COMPLETED', 'FAILED', 'BLOCKED'], 60_000), 'COMPLETED', explain(rt, exportWi));
      const exported = rt.founder.digital.promotion(promotion.id);
      assert.equal(exported.state, 'PROMOTED');
      assert.equal(exported.countsAsMarketOutcome, false);
      assert.equal(exported.externalRef?.pullNumber, 1);
      const repo = github.repos.get('qandeel-test/site')!;
      const head = repo.refs.get(String(exported.externalRef?.branch));
      assert.equal(head, exported.externalRef?.commitSha);
      assert.match(repo.commits.get(String(head))!.message, new RegExp(`Qandeel-Promotion: ${promotion.id}`));
      // Production is untouched: the export approval authorized the export only.
      assert.equal(repo.pulls[0]?.merged, false);
      assert.equal(github.requests.filter((r) => r.method === 'PUT').length, 0);
      // The production merge: its own preparation, its own review and its own Founder approval, bound to the exported head.
      const mergeWi = submitTaskWithPlan(rt, w, script(ws('promotion-prepare', { candidateId, targetId, kind: 'MERGE_PRODUCTION' }), gh('production-merge', '$ref:promotion-prepare.args'), final('digital.merged')), plan('ACTIONS', 'PASS'));
      const mergeApproval = await eventually(() => rt.governance.listApprovals('PENDING').find((a) => a.workItemId === mergeWi), 60_000, 'merge approval');
      assert.notEqual(mergeApproval.id, pending.id);
      assert.equal(repo.pulls[0]?.merged, false);
      rt.governance.decideApproval(w.founder, mergeApproval.id, { decision: 'APPROVE', reasonCode: 'founder.merge' });
      assert.equal(await done(rt, mergeWi, ['COMPLETED', 'FAILED', 'BLOCKED'], 60_000), 'COMPLETED', explain(rt, mergeWi));
      assert.equal(repo.pulls[0]?.merged, true);
      const merge = rt.founder.digital.project(rt.founder.digital.projects()[0]!.id).candidates[0]!.promotions.find((p) => p.kind === 'MERGE_PRODUCTION');
      assert.equal(merge?.state, 'PROMOTED');
      assert.equal(merge?.args.expectedHeadSha, exported.externalRef?.commitSha);
      // No request ever touched administration, protection, secrets or a ref update.
      for (const r of github.requests) assert.doesNotMatch(r.path, /protection|collaborators|secrets|hooks|keys|admin/);
      assert.equal(github.requests.filter((r) => r.method === 'POST' && /\/git\/refs$/.test(r.path)).length, 1);
      for (const r of github.requests) assert.ok((r.method as string) !== 'DELETE' && (r.method as string) !== 'PATCH');
    } finally {
      await rt.stop();
      removeRoot(root);
    }
  });

  test('11/19/20 a Founder rejection is history (the same act never regenerates; a changed candidate may); an uncertain export is held for reconciliation, never retried', async () => {
    const root = tempRoot('c7d-reject');
    const w = seedWorld(root);
    const rw = seedReviewer(root, w);
    const f = fakes();
    const github = new FakeGitHubTransport();
    github.addRepo('qandeel-test/site');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    let rtRef: CompanyRuntime | null = null;
    const source = {
      resolve: (...a: Parameters<ReturnType<CompanyRuntime['promotionSource']>['resolve']>) => (rtRef as CompanyRuntime).promotionSource().resolve(...a),
      target: (a: string, t: string) => (rtRef as CompanyRuntime).promotionSource().target(a, t),
      promotionArgs: (id: string) => (rtRef as CompanyRuntime).promotionSource().promotionArgs(id),
    };
    const driver = new GitHubCodeHostDriver({ transport: github, credentials: { appCredentials: () => ({ appId: '1001', installationId: '2002', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }) }, credentialRef: 'vault:github-app', source, allowedRepositories: ['qandeel-test/site'] });
    const rt = governedRuntime(root, f, { governance: { providers: [f.local, f.cloud], toolDrivers: [...Object.values(f.drivers), driver], modelCallTimeoutMs: 5_000, toolCallTimeoutMs: 5_000 } });
    rtRef = rt;
    await rt.start();
    try {
      grantWorkshop(rt, w);
      grantGitHub(rt, w);
      const { targetId } = registerGitHub(rt, w);
      await certifyAndPromote(rt, w, rw);
      const first = await buildCandidate(rt, w, 'Rejected draft');
      const wi1 = submitTaskWithPlan(rt, w, script(ws('promotion-prepare', { candidateId: first.candidateId, targetId, kind: 'EXPORT_SOURCE' }), gh('candidate-export', '$ref:promotion-prepare.args'), final('x')), plan('ACTIONS', 'PASS'));
      const pending = await eventually(() => rt.governance.listApprovals('PENDING').find((a) => a.workItemId === wi1), 60_000, 'approval');
      rt.governance.decideApproval(w.founder, pending.id, { decision: 'REJECT', reasonCode: 'founder.not_now' });
      await done(rt, wi1, ['COMPLETED', 'FAILED', 'BLOCKED'], 60_000);
      const promo = rt.founder.digital.project(first.projectId).candidates[0]!.promotions[0]!;
      assert.equal(promo.state, 'REJECTED');
      assert.equal(github.requests.length, 0, 'a rejected act never reached GitHub');
      // The same candidate × target × kind never regenerates as a fresh approval loop.
      const wi2 = submitTask(rt, w, { instructions: script(ws('promotion-prepare', { candidateId: first.candidateId, targetId, kind: 'EXPORT_SOURCE' }), final('x')) });
      await done(rt, wi2, ['COMPLETED', 'FAILED', 'BLOCKED']);
      assert.equal(rt.governance.toolInvocations(wi2).find((t) => t.failureCode !== null)?.failureCode, 'PROMOTION_REFUSED_BEFORE');
      assert.equal(rt.founder.digital.project(first.projectId).candidates[0]!.promotions.length, 1);
      assert.equal(rt.governance.listApprovals('PENDING').length, 0);
      // A changed candidate is the way forward — and its export's answer is lost after the branch exists: UNKNOWN → held.
      const second = await buildCandidate(rt, w, 'Second draft');
      github.failNext((q) => q.method === 'POST' && q.path.endsWith('/pulls'), 'throw');
      const wi3 = submitTaskWithPlan(rt, w, script(ws('promotion-prepare', { candidateId: second.candidateId, targetId, kind: 'EXPORT_SOURCE' }), gh('candidate-export', '$ref:promotion-prepare.args'), final('x')), plan('ACTIONS', 'PASS'));
      const p3 = await eventually(() => rt.governance.listApprovals('PENDING').find((a) => a.workItemId === wi3), 60_000, 'approval 3');
      rt.governance.decideApproval(w.founder, p3.id, { decision: 'APPROVE', reasonCode: 'founder.ok' });
      assert.equal(await done(rt, wi3, ['COMPLETED', 'FAILED', 'BLOCKED'], 60_000), 'BLOCKED', explain(rt, wi3));
      const held = rt.founder.digital.project(second.projectId).candidates[0]!.promotions[0]!;
      assert.equal(held.state, 'RECONCILIATION_REQUIRED');
      assert.equal(rt.governance.toolInvocations(wi3).find((t) => t.state === 'RECONCILIATION_REQUIRED') !== undefined, true);
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(github.requests.filter((q) => q.method === 'POST' && q.path.endsWith('/git/refs')).length, 1, 'never blindly retried');
      assert.equal(held.countsAsMarketOutcome, false);
    } finally {
      await rt.stop();
      removeRoot(root);
    }
  });
});
