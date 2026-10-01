/**
 * C7-D provider seams (no provider selected): a hosting / CMS adapter's preview, production publish and rollback are
 * DISTINCT operations — one never reaches another — and a rollback is bound to the exact current production version;
 * a social adapter publishes only after the fail-closed gate (current permissions and roles, pinned version, declared
 * content type, the exact approved window), one post per promotion (replay / restart never posts twice), an asynchronous
 * provider's answer is SUBMITTED (not "published"), and an unknown outcome is held, never retried blindly.
 * C7D-PROOF: provider-seams
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { JsonObject } from '@qandeel-company/domain';
import { promotionArgs, type PromotionAdapterDeclaration, type SocialAdapterDeclaration } from '@qandeel-company/governance';

import { HostingPromotionDriver, SocialPublishDriver, type HostingProviderPort, type PromotionSource, type SocialProviderPort } from '../src/index.js';

const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'd'.repeat(64);
const run = (d: { invoke: HostingPromotionDriver['invoke'] }, actionCode: string, args: JsonObject): ReturnType<HostingPromotionDriver['invoke']> => d.invoke({ actionCode, args, idempotencyKey: 'wi:x:s1' }, new AbortController().signal);

function sourceFor(kind: 'PREVIEW_EXTERNAL' | 'PUBLISH_PRODUCTION' | 'ROLLBACK_PRODUCTION' | 'SOCIAL_PUBLISH', files: { path: string; mediaType: string; content: string }[] = [{ path: 'index.html', mediaType: 'text/html', content: '<h1>x</h1>' }]): PromotionSource {
  return {
    resolve: (_a, args) => ({ ok: true, export: { promotionId: String(args.promotionId), kind, candidateId: ID(1), manifestSha256: SHA, target: { id: ID(5), targetClass: kind === 'SOCIAL_PUBLISH' ? 'SOCIAL_CHANNEL' : 'WEBSITE_PRODUCTION', adapterCode: 'x', externalRef: 'site:main' }, files: files.map((f) => ({ ...f, sha256: 'x', content: Buffer.from(f.content) })) } }),
    target: () => ({ id: ID(5), targetClass: 'WEBSITE_PRODUCTION', externalRef: 'site:main', state: 'ACTIVE' }),
    promotionArgs: () => ({ promotionId: ID(9), targetId: ID(5) }),
  };
}

describe('C7-D hosting / CMS seam', () => {
  const declaration: PromotionAdapterDeclaration = {
    adapterCode: 'example.hosting', providerKind: 'HOSTING', apiVersion: 'v1', apiSunsetAt: null, targetClasses: ['WEBSITE_PRODUCTION', 'WEBSITE_PREVIEW_EXTERNAL'],
    actions: [
      { actionCode: 'preview-deploy', kind: 'PREVIEW_EXTERNAL', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true },
      { actionCode: 'production-publish', kind: 'PUBLISH_PRODUCTION', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true },
      { actionCode: 'production-rollback', kind: 'ROLLBACK_PRODUCTION', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true },
      { actionCode: 'production-state', kind: 'READ_STATE', risk: 'R0', sideEffects: 'NONE', mutatesExternal: false },
    ],
    requiredPermissions: { deployments: 'write' },
  };
  const port = (): HostingProviderPort & { calls: string[]; current: string } => {
    const p = {
      declaration, calls: [] as string[], current: 'v7',
      previewExternal: async () => (p.calls.push('preview'), { status: 'ACCEPTED' as const, deploymentId: 'p-1', version: 'pv1' }),
      publishProduction: async () => (p.calls.push('publish'), { status: 'ACCEPTED' as const, deploymentId: 'd-8', version: 'v8' }),
      rollbackProduction: async (t: { rollbackToRef: string }) => (p.calls.push(`rollback:${t.rollbackToRef}`), { status: 'ACCEPTED' as const, deploymentId: 'd-9', version: t.rollbackToRef }),
      currentProduction: async () => ({ version: p.current }),
    };
    return p;
  };
  const base = { promotionId: ID(9), candidateId: ID(1), manifestSha256: SHA, targetId: ID(5) };

  test('13/14 preview never reaches production and production never runs as a preview (distinct operations)', async () => {
    const p = port();
    const d = new HostingPromotionDriver(p, sourceFor('PREVIEW_EXTERNAL'));
    assert.equal((await run(d, 'preview-deploy', promotionArgs({ kind: 'PREVIEW_EXTERNAL', ...base }))).ok, true);
    assert.deepEqual(p.calls, ['preview']);
    // The production action with a preview promotion's resolution is refused (kind mismatch), sending nothing.
    assert.deepEqual(await run(d, 'production-publish', promotionArgs({ kind: 'PUBLISH_PRODUCTION', ...base })), { ok: false, code: 'PROMOTION_KIND_MISMATCH', sent: 'NO' });
    assert.deepEqual(p.calls, ['preview']);
    const live = new HostingPromotionDriver(p, sourceFor('PUBLISH_PRODUCTION'));
    assert.equal((await run(live, 'production-publish', promotionArgs({ kind: 'PUBLISH_PRODUCTION', ...base }))).ok, true);
    assert.deepEqual(p.calls, ['preview', 'publish']);
  });

  test('25 a rollback is its own act bound to the exact current version; a changed production refuses it', async () => {
    const p = port();
    const d = new HostingPromotionDriver(p, sourceFor('ROLLBACK_PRODUCTION'));
    const args = promotionArgs({ kind: 'ROLLBACK_PRODUCTION', ...base, expectedCurrentRef: 'v7', rollbackToRef: 'v6' });
    p.current = 'v8';
    assert.deepEqual(await run(d, 'production-rollback', args), { ok: false, code: 'CURRENT_VERSION_CHANGED', sent: 'NO' });
    p.current = 'v7';
    const r = await run(d, 'production-rollback', args);
    assert.equal(r.ok && r.result.version, 'v6');
    assert.deepEqual(p.calls, ['rollback:v6']);
  });

  test('an incomplete or collapsed hosting declaration cannot become a driver; an unknown outcome is held', async () => {
    assert.throws(() => new HostingPromotionDriver({ ...port(), declaration: { ...declaration, actions: declaration.actions.filter((a) => a.kind !== 'ROLLBACK_PRODUCTION') } }, sourceFor('PUBLISH_PRODUCTION')));
    const p = port();
    p.publishProduction = async () => ({ status: 'UNKNOWN' as const });
    assert.deepEqual(await run(new HostingPromotionDriver(p, sourceFor('PUBLISH_PRODUCTION')), 'production-publish', promotionArgs({ kind: 'PUBLISH_PRODUCTION', ...base })), { ok: false, code: 'PROVIDER_OUTCOME_UNKNOWN', sent: 'UNKNOWN' });
  });
});

describe('C7-D social seam', () => {
  const declaration: SocialAdapterDeclaration = {
    adapterCode: 'example.social', providerKind: 'SOCIAL', apiVersion: '202609', apiSunsetAt: '2027-09-30T00:00:00.000Z', targetClasses: ['SOCIAL_CHANNEL'],
    actions: [{ actionCode: 'post-publish', kind: 'SOCIAL_PUBLISH', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true }, { actionCode: 'post-state', kind: 'READ_STATE', risk: 'R0', sideEffects: 'NONE', mutatesExternal: false }],
    requiredPermissions: { w_organization_social: 'write' }, contentTypes: ['TEXT', 'IMAGE'], accountRoles: ['CONTENT_ADMIN'], editSemantics: 'IMMUTABLE', deleteSemantics: 'DELETABLE', asyncPublish: true, rateLimit: { maxPublishes: 100, perSeconds: 86_400 },
  };
  const pkg = { v: 1, channelIntent: 'LAUNCH_TEASER', text: 'QANDEEL قادم', media: [{ path: 'social/hero.png', altText: 'شعار' }], links: [], timing: null, goalRefs: [], hypothesis: 'Invite early interest.' };
  const files = [{ path: 'social/post.json', mediaType: 'application/json', content: JSON.stringify(pkg) }, { path: 'social/hero.png', mediaType: 'image/png', content: 'png' }];
  const window = { notBefore: '2026-10-02T09:00:00.000Z', notAfter: '2026-10-02T11:00:00.000Z' };
  const args = promotionArgs({ kind: 'SOCIAL_PUBLISH', promotionId: ID(9), candidateId: ID(1), manifestSha256: SHA, targetId: ID(5), ...window });
  const port = (perms: string[] = ['w_organization_social'], roles: string[] = ['CONTENT_ADMIN']): SocialProviderPort & { posts: Map<string, string> } => {
    const p = {
      declaration, posts: new Map<string, string>(),
      identity: async () => ({ grantedPermissions: perms, accountRoles: roles }),
      publish: async (_post: unknown, key: string) => (p.posts.set(key, `urn:post:${p.posts.size + 1}`), { status: 'SUBMITTED' as const, externalId: `urn:post:${p.posts.size}` }),
      findByKey: async (_t: string, key: string) => (p.posts.has(key) ? { externalId: p.posts.get(key) as string, state: 'PUBLISHED' } : null),
    };
    return p;
  };
  const at = (iso: string) => () => new Date(iso);

  test('34/37 inside the approved window with current permissions: one SUBMITTED post per promotion; replay and restart never post twice', async () => {
    const p = port();
    const d = new SocialPublishDriver(p, sourceFor('SOCIAL_PUBLISH', files), at('2026-10-02T10:00:00.000Z'));
    const first = await run(d, 'post-publish', args);
    assert.equal(first.ok && first.result.state, 'SUBMITTED', 'an asynchronous provider answer is a submission, not a confirmed publication');
    const again = await new SocialPublishDriver(p, sourceFor('SOCIAL_PUBLISH', files), at('2026-10-02T10:30:00.000Z')).invoke({ actionCode: 'post-publish', args, idempotencyKey: 'wi:x:s7' }, new AbortController().signal);
    assert.equal(again.ok && again.result.replayed, true);
    assert.equal(p.posts.size, 1);
  });

  test('35/36/38 outside the window, a lost permission or role, a sunset version or an unsupported content type fail closed before any provider call', async () => {
    const cases: [SocialProviderPort & { posts: Map<string, string> }, string, string][] = [
      [port(), '2026-10-02T08:00:00.000Z', 'BEFORE_APPROVED_WINDOW'],
      [port(), '2026-10-02T11:00:00.000Z', 'OUTSIDE_APPROVED_WINDOW'],
      [port([]), '2026-10-02T10:00:00.000Z', 'PERMISSION_MISSING'],
      [port(undefined, ['VIEWER']), '2026-10-02T10:00:00.000Z', 'ACCOUNT_ROLE_MISSING'],
      [port(), '2027-10-01T10:00:00.000Z', 'API_VERSION_UNSUPPORTED'],
    ];
    for (const [p, when, code] of cases) {
      const r = await run(new SocialPublishDriver(p, sourceFor('SOCIAL_PUBLISH', files), at(when)), 'post-publish', args);
      assert.deepEqual(r, { ok: false, code, sent: 'NO' }, code);
      assert.equal(p.posts.size, 0);
    }
    const video = [{ path: 'social/post.json', mediaType: 'application/json', content: JSON.stringify({ ...pkg, media: [{ path: 'social/clip.mp4', altText: 'clip' }] }) }, { path: 'social/clip.mp4', mediaType: 'video/mp4', content: 'mp4' }];
    const p = port();
    assert.deepEqual(await run(new SocialPublishDriver(p, sourceFor('SOCIAL_PUBLISH', video), at('2026-10-02T10:00:00.000Z')), 'post-publish', args), { ok: false, code: 'CONTENT_TYPE_UNSUPPORTED', sent: 'NO' });
    assert.equal(p.posts.size, 0);
  });

  test('39 no comment, reply or DM operation exists on the seam; an unknown outcome after sending is held', async () => {
    assert.throws(() => new SocialPublishDriver({ ...port(), declaration: { ...declaration, actions: [...declaration.actions, { actionCode: 'reply-to-comment', kind: 'READ_STATE', risk: 'R0', sideEffects: 'NONE', mutatesExternal: false }] } }, sourceFor('SOCIAL_PUBLISH', files)));
    const p = port();
    p.publish = async () => ({ status: 'UNKNOWN' as const });
    assert.deepEqual(await run(new SocialPublishDriver(p, sourceFor('SOCIAL_PUBLISH', files), at('2026-10-02T10:00:00.000Z')), 'post-publish', args), { ok: false, code: 'PROVIDER_OUTCOME_UNKNOWN', sent: 'UNKNOWN' });
  });
});
