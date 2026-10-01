/**
 * C7-D GitHub code-host adapter, adversarially (deterministic fake GitHub; no network, no real credential):
 * allowlisted repository only; one-repository installation tokens with exactly the declared permissions (a broader grant
 * fails closed); a vault reference, never a PAT; a closed endpoint allowlist (no admin, protection, secrets, delete,
 * PATCH / force); exact-candidate export with provenance; replay returns the same refs; a timeout after the branch exists
 * is UNKNOWN (never a blind retry) and reconciliation finds the Company's own effect; the merge binds the exported head,
 * needs a clean PR and green checks, and never bypasses protection; results never carry tokens; a sunset API version
 * fails closed.
 * C7D-PROOF: github-adapter
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, test } from 'node:test';

import { isQandeelError, type JsonObject } from '@qandeel-company/domain';
import { assertAdapterDeclaration, exportBranch, promotionArgs } from '@qandeel-company/governance';

import { FakeGitHubTransport, GITHUB_CODE_HOST, GITHUB_TOKEN_PERMISSIONS, GitHubCodeHostDriver, GitHubHttpsTransport, assertGitHubEndpoint, permissionsWithinRequest, type PromotionSource, type PromotionSourceExport } from '../src/index.js';

/** The value a proof relies on, present by construction of the fixture. */
function must<T>(v: T | null | undefined, what = 'value'): T {
  if (v === null || v === undefined) throw new Error(`${what} is missing`);
  return v;
}


const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'c'.repeat(64);
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function world(repo = 'qandeel-test/site', allowed = ['qandeel-test/site']): { gh: FakeGitHubTransport; driver: GitHubCodeHostDriver; exportArgs: JsonObject; source: PromotionSource & { refuse: string | null; promotions: Map<string, JsonObject> } } {
  const gh = new FakeGitHubTransport();
  gh.addRepo('qandeel-test/site');
  gh.addRepo('qandeel-test/other');
  const exportArgs = promotionArgs({ kind: 'EXPORT_SOURCE', promotionId: ID(9), candidateId: ID(1), manifestSha256: SHA, targetId: ID(5) });
  const files = [{ path: 'index.html', mediaType: 'text/html', sha256: 'x', content: Buffer.from('<h1>QANDEEL</h1>') }, { path: 'about/index.html', mediaType: 'text/html', sha256: 'y', content: Buffer.from('<h1>About</h1>') }];
  const source = {
    refuse: null as string | null,
    promotions: new Map<string, JsonObject>([[ID(9), exportArgs]]),
    resolve(_adapter: string, args: JsonObject): ReturnType<PromotionSource['resolve']> {
      if (source.refuse) return { ok: false, code: source.refuse };
      const kind = typeof args.expectedHeadSha === 'string' ? 'MERGE_PRODUCTION' : 'EXPORT_SOURCE';
      const x: PromotionSourceExport = { promotionId: String(args.promotionId), kind, candidateId: ID(1), manifestSha256: SHA, target: { id: ID(5), targetClass: 'CODE_REPOSITORY', adapterCode: GITHUB_CODE_HOST.adapterCode, externalRef: `github:${repo}` }, files };
      return { ok: true, export: x };
    },
    target: () => ({ id: ID(5), targetClass: 'CODE_REPOSITORY' as const, externalRef: `github:${repo}`, state: 'ACTIVE' }),
    promotionArgs: (id: string) => source.promotions.get(id) ?? null,
  };
  const driver = new GitHubCodeHostDriver({ transport: gh, credentials: { appCredentials: (ref) => (ref === 'vault:github-app' ? { appId: '1001', installationId: '2002', privateKeyPem: PEM } : null) }, credentialRef: 'vault:github-app', source, allowedRepositories: allowed, clock: () => new Date('2026-10-01T12:00:00.000Z') });
  return { gh, driver, exportArgs, source };
}

const call = (d: GitHubCodeHostDriver, actionCode: string, args: JsonObject, key = 'wi:x:s1'): ReturnType<GitHubCodeHostDriver['invoke']> => d.invoke({ actionCode, args, idempotencyKey: key }, new AbortController().signal);

describe('C7-D GitHub code-host adapter', () => {
  test('the declaration is valid and least-privilege: no administration, protection, secret or workflow permission; a pinned API version', () => {
    assertAdapterDeclaration(GITHUB_CODE_HOST);
    assert.deepEqual(Object.keys(GITHUB_TOKEN_PERMISSIONS).sort(), ['checks', 'contents', 'metadata', 'pull_requests', 'statuses']);
    assert.ok(Object.isFrozen(GITHUB_TOKEN_PERMISSIONS));
    assert.equal(GITHUB_CODE_HOST.apiVersion, '2022-11-28');
    assert.ok(!permissionsWithinRequest({ ...GITHUB_TOKEN_PERMISSIONS, administration: 'read' }));
    assert.ok(!permissionsWithinRequest({ metadata: 'write' }));
    assert.ok(permissionsWithinRequest({ contents: 'write', metadata: 'read' }));
  });

  test('no PAT: the App credential is a vault reference only', () => {
    const { gh, source } = world();
    assert.throws(() => new GitHubCodeHostDriver({ transport: gh, credentials: { appCredentials: () => null }, credentialRef: ['gh', 'p_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join(''), source, allowedRepositories: [] }), (e: unknown) => isQandeelError(e, 'VALIDATION_FAILED'));
  });

  test('28 no arbitrary endpoint: the allowlist refuses admin, protection, secrets, collaborators, hooks, delete, PATCH and the HTTPS transport refuses before any network call', async () => {
    for (const [m, p] of [['PUT', '/repos/o/r/branches/main/protection'], ['GET', '/repos/o/r/branches/main/protection'], ['PUT', '/repos/o/r/collaborators/x'], ['POST', '/repos/o/r/hooks'], ['GET', '/repos/o/r/actions/secrets'], ['DELETE', '/repos/o/r'], ['PATCH', '/repos/o/r/git/refs/heads/main'], ['POST', '/repos/o/r/git/refs/../x'], ['GET', '/orgs/o/members'], ['GET', '/user'], ['POST', '/repos/o/r/environments/prod']] as const) {
      assert.throws(() => assertGitHubEndpoint(m, p), (e: unknown) => isQandeelError(e, 'TOOL_DENIED'), `${m} ${p}`);
    }
    assert.deepEqual(assertGitHubEndpoint('GET', '/repos/o/pages'), { mutates: false }, 'a repository named like an area is data, not the area');
    await assert.rejects(new GitHubHttpsTransport().send({ method: 'GET', path: '/repos/o/r/branches/main/protection', bearer: 'x' }, new AbortController().signal), (e: unknown) => isQandeelError(e, 'TOOL_DENIED'));
  });

  test('16/21 export: an exact tree with provenance, a NEW branch and one PR; replay returns the same refs and creates nothing', async () => {
    const { gh, driver, exportArgs } = world();
    const first = await call(driver, 'candidate-export', exportArgs);
    assert.equal(first.ok, true);
    const r = first.ok ? first.result : {};
    assert.equal(r.branch, exportBranch(ID(1), ID(9)));
    assert.equal(r.pullNumber, 1);
    const repo = must(gh.repos.get('qandeel-test/site'));
    assert.match(must(repo.commits.get(String(r.commitSha))).message, /Qandeel-Manifest: c{64}/);
    const tree = must(gh.requests.find((q) => q.path.endsWith('/git/trees')));
    assert.deepEqual((tree.body as { tree: { path: string }[] }).tree.map((x) => x.path).sort(), ['about/index.html', 'index.html']);
    assert.equal((tree.body as Record<string, unknown>).base_tree, undefined, 'the exported tree is exactly the candidate');
    const writes = gh.requests.filter((q) => q.method !== 'GET' && !q.path.startsWith('/app/')).length;
    const again = await call(driver, 'candidate-export', exportArgs, 'wi:x:s2');
    assert.equal(again.ok && again.result.replayed, true);
    assert.equal(again.ok && again.result.commitSha, r.commitSha);
    assert.equal(gh.requests.filter((q) => q.method !== 'GET' && !q.path.startsWith('/app/')).length, writes, 'replay wrote nothing');
    // 22: no token, bearer value or header ever appears in a result.
    assert.doesNotMatch(JSON.stringify([first, again]), /ghs_|Bearer|eyJ|authorization/i);
    // Tokens were scoped to the one repository and requested exactly the declared permissions.
    for (const q of gh.requests.filter((x) => x.path.startsWith('/app/'))) {
      assert.deepEqual((q.body as { repositories: string[] }).repositories, ['site']);
      assert.deepEqual((q.body as { permissions: unknown }).permissions, { ...GITHUB_TOKEN_PERMISSIONS });
    }
  });

  test('a repository outside the host allowlist is refused before any token is minted; a broader installation grant fails closed', async () => {
    const a = world('qandeel-test/other');
    const r = await call(a.driver, 'candidate-export', a.exportArgs);
    assert.deepEqual(r, { ok: false, code: 'REPOSITORY_NOT_ALLOWLISTED', sent: 'NO' });
    assert.equal(a.gh.requests.length, 0);
    const b = world();
    b.gh.grantedPermissions = { ...GITHUB_TOKEN_PERMISSIONS, administration: 'write' };
    const r2 = await call(b.driver, 'candidate-export', b.exportArgs);
    assert.deepEqual(r2, { ok: false, code: 'PERMISSIONS_BROADER_THAN_REQUESTED', sent: 'NO' });
    assert.equal(b.gh.requests.filter((q) => q.method !== 'GET' && !q.path.startsWith('/app/')).length, 0);
  });

  test('12/24 candidate hash mismatch (or any refused resolution) sends nothing; a foreign branch of the same name is a conflict, never overwritten', async () => {
    const a = world();
    a.source.refuse = 'CANDIDATE_HASH_MISMATCH';
    assert.deepEqual(await call(a.driver, 'candidate-export', a.exportArgs), { ok: false, code: 'CANDIDATE_HASH_MISMATCH', sent: 'NO' });
    assert.equal(a.gh.requests.length, 0);
    const b = world();
    must(b.gh.repos.get('qandeel-test/site')).refs.set(String(b.exportArgs.branch), 'f'.repeat(40));
    must(b.gh.repos.get('qandeel-test/site')).commits.set('f'.repeat(40), { message: 'someone else', tree: 't', parents: [] });
    assert.deepEqual(await call(b.driver, 'candidate-export', b.exportArgs), { ok: false, code: 'BRANCH_CONFLICT', sent: 'NO' });
    assert.equal(b.gh.requests.filter((q) => q.method === 'POST' && q.path.endsWith('/git/refs')).length, 0);
  });

  test('19/20 a timeout after the branch exists is UNKNOWN (held for reconciliation); reconciliation finds the Company\'s own commit; a re-run reuses it', async () => {
    const { gh, driver, exportArgs } = world();
    gh.failNext((q) => q.method === 'POST' && q.path.endsWith('/pulls'), 'throw');
    const r = await call(driver, 'candidate-export', exportArgs);
    assert.deepEqual(r, { ok: false, code: 'PROVIDER_OUTCOME_UNKNOWN', sent: 'UNKNOWN' });
    const rec = await call(driver, 'promotion-reconcile', { promotionId: ID(9) });
    assert.equal(rec.ok && rec.result.found, true);
    const again = await call(driver, 'candidate-export', exportArgs, 'wi:x:s1');
    assert.equal(again.ok, true);
    assert.equal(gh.requests.filter((q) => q.method === 'POST' && q.path.endsWith('/git/refs')).length, 1, 'the branch was created exactly once');
    // A failure before anything visible changed is a safe NO.
    const w2 = world();
    w2.gh.failNext((q) => q.method === 'POST' && q.path.endsWith('/git/blobs'), 'throw');
    assert.deepEqual(await call(w2.driver, 'candidate-export', w2.exportArgs), { ok: false, code: 'PROVIDER_UNREACHABLE', sent: 'NO' });
  });

  test('24/26 merge: only the exported head, only when cleanly mergeable with green checks; a moved head, a blocked PR or red checks refuse; replay returns the same merge', async () => {
    const { gh, driver, exportArgs } = world();
    const ex = await call(driver, 'candidate-export', exportArgs);
    const head = String(ex.ok && ex.result.commitSha);
    const mergeArgs = promotionArgs({ kind: 'MERGE_PRODUCTION', promotionId: ID(10), candidateId: ID(1), manifestSha256: SHA, targetId: ID(5), pullNumber: 1, expectedHeadSha: head });
    const repo = must(gh.repos.get('qandeel-test/site'));
    repo.mergeableState = 'blocked';
    assert.deepEqual(await call(driver, 'production-merge', mergeArgs), { ok: false, code: 'MERGE_NOT_READY', sent: 'NO' });
    repo.mergeableState = 'clean';
    repo.checks = [{ status: 'completed', conclusion: 'failure' }];
    assert.deepEqual(await call(driver, 'production-merge', mergeArgs), { ok: false, code: 'CHECKS_NOT_SATISFIED', sent: 'NO' });
    repo.checks = [{ status: 'in_progress', conclusion: null }];
    assert.deepEqual(await call(driver, 'production-merge', mergeArgs), { ok: false, code: 'CHECKS_NOT_SATISFIED', sent: 'NO' });
    repo.checks = [{ status: 'completed', conclusion: 'success' }];
    gh.pushToPull('qandeel-test/site', 1);
    assert.deepEqual(await call(driver, 'production-merge', mergeArgs), { ok: false, code: 'HEAD_CHANGED', sent: 'NO' });
    assert.equal(gh.requests.filter((q) => q.method === 'PUT').length, 0, 'nothing was merged');
    // A fresh world: a clean, green PR at exactly the exported head merges once, with the sha guard.
    const w2 = world();
    const ex2 = await call(w2.driver, 'candidate-export', w2.exportArgs);
    const args2 = promotionArgs({ kind: 'MERGE_PRODUCTION', promotionId: ID(10), candidateId: ID(1), manifestSha256: SHA, targetId: ID(5), pullNumber: 1, expectedHeadSha: String(ex2.ok && ex2.result.commitSha) });
    const m = await call(w2.driver, 'production-merge', args2);
    assert.equal(m.ok, true);
    const put = must(w2.gh.requests.find((q) => q.method === 'PUT'));
    assert.equal((put.body as { sha: string }).sha, args2.expectedHeadSha);
    assert.equal(JSON.stringify(put.body).includes('admin'), false);
    const replay = await call(w2.driver, 'production-merge', args2, 'wi:x:s9');
    assert.equal(replay.ok && replay.result.replayed, true);
    assert.equal(replay.ok && replay.result.mergeCommitSha, m.ok && m.result.mergeCommitSha);
  });

  test('35 the pinned API version fails closed after its announced sunset; an undeclared action is refused', async () => {
    const { gh, source } = world();
    const late = new GitHubCodeHostDriver({ transport: gh, credentials: { appCredentials: () => ({ appId: '1', installationId: '2', privateKeyPem: PEM }) }, credentialRef: 'vault:github-app', source, allowedRepositories: ['qandeel-test/site'], clock: () => new Date('2028-03-10T00:00:00.000Z') });
    assert.deepEqual(await call(late, 'repository-read', { targetId: ID(5) }), { ok: false, code: 'API_VERSION_UNSUPPORTED', sent: 'NO' });
    const ok = world();
    assert.deepEqual(await call(ok.driver, 'branch-protection-update', {}), { ok: false, code: 'ACTION_NOT_DECLARED', sent: 'NO' });
    const read = await call(ok.driver, 'repository-read', { targetId: ID(5) });
    assert.equal(read.ok && read.result.defaultBranch, 'main');
    assert.ok(!ok.gh.requests.some((q) => /protection/.test(q.path)), 'effective rules are read through Metadata, never Administration');
  });
});
