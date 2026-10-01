/**
 * C7-D Digital Presence kernel: logical-path safety, media contract, deterministic manifests, preview capability,
 * exact promotion arguments, adapter declarations (no admin / protection / secret / interaction / spend capability;
 * hosting preview ≠ production), the provider-neutral social contract (version, content type, permission, role,
 * exact approved window) and the derived promotion lifecycle.
 * C7D-PROOF: digital-kernel
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isQandeelError } from '@qandeel-company/domain';

import {
  PROMOTION_STATES,
  assertAdapterDeclaration,
  assertDigitalPath,
  assertManifestBounds,
  assertPromotionFits,
  assertSocialDeclaration,
  candidateFingerprint,
  checkSocialPublish,
  digitalManifestSha256,
  digitalMedia,
  exportBranch,
  parseSocialPackage,
  previewability,
  promotionArgs,
  promotionState,
  socialContentType,
  type PromotionAdapterDeclaration,
  type SocialAdapterDeclaration,
} from '../src/index.js';

const refused = (fn: () => unknown, reason?: string): void => {
  assert.throws(fn, (e: unknown) => isQandeelError(e, 'DIGITAL_REFUSED') && (reason === undefined || e.details.reason === reason));
};

const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'a'.repeat(64);

describe('C7-D logical paths and media', () => {
  test('2/40/41 traversal, absolute, device, NUL, credential, dependency and workspace paths are refused; a logical path is never a host path', () => {
    for (const p of ['/etc/passwd', 'C:/Windows/x', 'C:\\x', '\\\\server\\share', '../x', 'a/../b', 'a/./b', 'a//b', '', 'a/b/', 'CON', 'nul.txt', 'aux/x.html', 'a\u0000b', 'x:y', 'a\\b', '.env', 'config/.env.local', 'keys/id_rsa', 'cert.pem', 'store.p12', 'node_modules/x.js', '.git/config', '.ssh/known', 'x.', 'dir /x', '~/x', 'a*b', 'credentials.json', 'secrets.yaml', '.npmrc']) {
      refused(() => assertDigitalPath(p));
    }
    assert.equal(assertDigitalPath('index.html'), 'index.html');
    assert.equal(assertDigitalPath('ar/من-نحن/index.html'), 'ar/من-نحن/index.html');
    // Not NFC → refused (one logical name, one byte form).
    refused(() => assertDigitalPath('cafe\u0301.html'), 'PATH_NOT_NORMALIZED');
  });

  test('media: unknown types are never stored; framework source is SOURCE (stored, never served); robots.txt is static', () => {
    refused(() => digitalMedia('x.exe'), 'MEDIA_TYPE_UNSUPPORTED');
    refused(() => digitalMedia('x.php'), 'MEDIA_TYPE_UNSUPPORTED');
    refused(() => digitalMedia('Makefile'), 'MEDIA_TYPE_UNSUPPORTED');
    assert.deepEqual(digitalMedia('a/index.html'), { mediaType: 'text/html', kind: 'STATIC', text: true });
    assert.equal(digitalMedia('src/App.tsx').kind, 'SOURCE');
    assert.equal(digitalMedia('robots.txt').kind, 'STATIC');
    assert.equal(digitalMedia('logo.PNG').mediaType, 'image/png');
  });
});

describe('C7-D revisions and candidates', () => {
  const e = [
    { path: 'index.html', sha256: 'a'.repeat(64), sizeBytes: 10, mediaType: 'text/html' },
    { path: 'about/index.html', sha256: 'b'.repeat(64), sizeBytes: 12, mediaType: 'text/html' },
  ];

  test('4 the manifest is deterministic (order-free) and one byte or one path changes it', () => {
    assert.equal(digitalManifestSha256(e), digitalManifestSha256([...e].reverse()));
    assert.notEqual(digitalManifestSha256(e), digitalManifestSha256([{ ...e[0]!, sha256: 'c'.repeat(64) }, e[1]!]));
    assert.notEqual(digitalManifestSha256(e), digitalManifestSha256([{ ...e[0]!, path: 'home.html' }, e[1]!]));
    assert.notEqual(digitalManifestSha256(e), digitalManifestSha256([{ ...e[0]!, sizeBytes: 11 }, e[1]!]));
  });

  test('bounds: an empty revision and case-insensitive path collisions (Windows) are refused', () => {
    refused(() => assertManifestBounds([]), 'REVISION_EMPTY');
    refused(() => assertManifestBounds([e[0]!, { ...e[0]!, path: 'INDEX.html' }]), 'PATH_COLLISION');
    assertManifestBounds(e);
  });

  test('10 a candidate fingerprint binds the exact revision and manifest (a changed revision is a new candidate)', () => {
    const a = candidateFingerprint({ candidateId: ID(1), revisionId: ID(2), manifestSha256: SHA, kind: 'WEBSITE' });
    assert.notEqual(a, candidateFingerprint({ candidateId: ID(1), revisionId: ID(3), manifestSha256: SHA, kind: 'WEBSITE' }));
    assert.notEqual(a, candidateFingerprint({ candidateId: ID(1), revisionId: ID(2), manifestSha256: 'b'.repeat(64), kind: 'WEBSITE' }));
  });

  test('preview capability: a static entry previews; a build-needing or entry-less revision is a surfaced gap (nothing is executed to make it work)', () => {
    assert.deepEqual(previewability(['index.html', 'style.css']), { state: 'READY', entry: 'index.html' });
    assert.deepEqual(previewability(['package.json', 'src/main.tsx']), { state: 'CAPABILITY_GAP', code: 'PREVIEW_REQUIRES_BUILD' });
    assert.deepEqual(previewability(['copy/launch.md']), { state: 'CAPABILITY_GAP', code: 'PREVIEW_NO_STATIC_ENTRY' });
  });
});

describe('C7-D promotions', () => {
  const base = { promotionId: ID(9), candidateId: ID(1), manifestSha256: SHA, targetId: ID(5) };

  test('12/13/14 each external act has its own exact arguments: export ≠ merge ≠ publish ≠ another post; the content hash is always bound', () => {
    const exp = promotionArgs({ kind: 'EXPORT_SOURCE', ...base });
    assert.equal(exp.branch, exportBranch(ID(1), ID(9)));
    assert.equal(exp.manifestSha256, SHA);
    refused(() => promotionArgs({ kind: 'MERGE_PRODUCTION', ...base }), 'MERGE_NEEDS_EXPORTED_HEAD');
    const merge = promotionArgs({ kind: 'MERGE_PRODUCTION', ...base, pullNumber: 7, expectedHeadSha: 'f'.repeat(40) });
    assert.notDeepEqual(exp, merge);
    const post1 = promotionArgs({ kind: 'SOCIAL_PUBLISH', ...base, notBefore: '2026-10-02T09:00:00.000Z', notAfter: '2026-10-02T11:00:00.000Z' });
    const post2 = promotionArgs({ kind: 'SOCIAL_PUBLISH', ...base, promotionId: ID(10), notBefore: '2026-10-02T09:00:00.000Z', notAfter: '2026-10-02T11:00:00.000Z' });
    const moved = promotionArgs({ kind: 'SOCIAL_PUBLISH', ...base, notBefore: '2026-10-03T09:00:00.000Z', notAfter: '2026-10-03T11:00:00.000Z' });
    assert.notDeepEqual(post1, post2);
    assert.notDeepEqual(post1, moved, '38 a moved schedule is a different act');
    refused(() => promotionArgs({ kind: 'SOCIAL_PUBLISH', ...base, notBefore: '2026-10-02T11:00:00.000Z', notAfter: '2026-10-02T09:00:00.000Z' }), 'SCHEDULE_WINDOW_INVALID');
    refused(() => promotionArgs({ kind: 'ROLLBACK_PRODUCTION', ...base }), 'ROLLBACK_NEEDS_EXACT_VERSIONS');
    for (const v of [exp, merge, post1]) for (const x of Object.values(v)) assert.ok(typeof x === 'string' || typeof x === 'number', 'arguments are ids, hashes, numbers and timestamps only');
  });

  test('a promotion kind fits only its target class and candidate kind', () => {
    refused(() => assertPromotionFits('EXPORT_SOURCE', 'SOCIAL_CHANNEL', 'WEBSITE'), 'TARGET_CLASS_MISMATCH');
    refused(() => assertPromotionFits('SOCIAL_PUBLISH', 'SOCIAL_CHANNEL', 'WEBSITE'), 'CANDIDATE_KIND_MISMATCH');
    refused(() => assertPromotionFits('PUBLISH_PRODUCTION', 'WEBSITE_PREVIEW_EXTERNAL', 'WEBSITE'), 'TARGET_CLASS_MISMATCH');
    assertPromotionFits('EXPORT_SOURCE', 'CODE_REPOSITORY', 'WEBSITE');
  });

  test('8/11/19/45 the lifecycle is derived from review → approval → invocation; refusal is history; publication never reads as outcome', () => {
    const f = { candidateIntact: true, review: 'NONE', approval: 'NONE', invocation: 'NONE' } as const;
    assert.equal(promotionState(f), 'PREPARED');
    assert.equal(promotionState({ ...f, review: 'OPEN' }), 'UNDER_REVIEW');
    assert.equal(promotionState({ ...f, review: 'REWORK' }), 'REVIEW_REJECTED');
    assert.equal(promotionState({ ...f, review: 'SATISFIED', approval: 'PENDING' }), 'READY_FOR_FOUNDER');
    assert.equal(promotionState({ ...f, review: 'SATISFIED', approval: 'REJECTED' }), 'REJECTED');
    assert.equal(promotionState({ ...f, review: 'SATISFIED', approval: 'APPROVED' }), 'APPROVED');
    assert.equal(promotionState({ ...f, review: 'SATISFIED', approval: 'EXPIRED' }), 'STALE');
    assert.equal(promotionState({ ...f, approval: 'CONSUMED', invocation: 'INTENT_RECORDED' }), 'EXECUTING');
    assert.equal(promotionState({ ...f, approval: 'CONSUMED', invocation: 'RECONCILIATION_REQUIRED' }), 'RECONCILIATION_REQUIRED');
    assert.equal(promotionState({ ...f, approval: 'CONSUMED', invocation: 'SUCCEEDED' }), 'PROMOTED');
    assert.equal(promotionState({ ...f, candidateIntact: false, review: 'SATISFIED', approval: 'PENDING' }), 'STALE', '6 a corrupt candidate is no longer approvable');
    assert.ok(!(PROMOTION_STATES as readonly string[]).some((s) => /SUCCESS|MARKET|TRAFFIC|RANK/.test(s)));
  });
});

describe('C7-D adapter declarations', () => {
  const code: PromotionAdapterDeclaration = {
    adapterCode: 'x.code-host', providerKind: 'CODE_HOST', apiVersion: '2022-11-28', apiSunsetAt: null, targetClasses: ['CODE_REPOSITORY'],
    actions: [{ actionCode: 'export', kind: 'EXPORT_SOURCE', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true }],
    requiredPermissions: { contents: 'write' },
  };

  test('26/28 no administration, protection, secret, membership, deletion, force or interaction / spend capability can be declared', () => {
    assertAdapterDeclaration(code);
    for (const actionCode of ['branch-protection-update', 'admin-set', 'secrets-write', 'delete-repo', 'force-push', 'comments-reply', 'dm-send', 'ads-spend', 'collaborators-add', 'webhook-create']) {
      refused(() => assertAdapterDeclaration({ ...code, actions: [{ ...code.actions[0]!, actionCode }] }));
    }
    for (const perm of ['administration', 'secrets', 'members', 'organization_hooks', 'environments', 'org-admin']) refused(() => assertAdapterDeclaration({ ...code, requiredPermissions: { [perm]: 'read' } }), 'ADAPTER_PERMISSION_FORBIDDEN');
    refused(() => assertAdapterDeclaration({ ...code, actions: [{ ...code.actions[0]!, risk: 'R1' }] }), 'ADAPTER_MUTATION_NOT_GOVERNED');
    refused(() => assertAdapterDeclaration({ ...code, apiVersion: 'latest' }), 'ADAPTER_VERSION_NOT_PINNED');
  });

  test('14 a hosting adapter declares preview, production publish, rollback and state read as DISTINCT acts', () => {
    const hosting: PromotionAdapterDeclaration = {
      adapterCode: 'x.hosting', providerKind: 'HOSTING', apiVersion: 'v1', apiSunsetAt: null, targetClasses: ['WEBSITE_PRODUCTION', 'WEBSITE_PREVIEW_EXTERNAL'],
      actions: [
        { actionCode: 'preview', kind: 'PREVIEW_EXTERNAL', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true },
        { actionCode: 'publish', kind: 'PUBLISH_PRODUCTION', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true },
        { actionCode: 'rollback', kind: 'ROLLBACK_PRODUCTION', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true },
        { actionCode: 'state', kind: 'READ_STATE', risk: 'R0', sideEffects: 'NONE', mutatesExternal: false },
      ],
      requiredPermissions: { deploy: 'write' },
    };
    assertAdapterDeclaration(hosting);
    refused(() => assertAdapterDeclaration({ ...hosting, actions: hosting.actions.filter((a) => a.kind !== 'ROLLBACK_PRODUCTION') }), 'HOSTING_ACTIONS_INCOMPLETE');
    refused(() => assertAdapterDeclaration({ ...hosting, actions: hosting.actions.filter((a) => a.kind !== 'PREVIEW_EXTERNAL') }), 'HOSTING_ACTIONS_INCOMPLETE');
    refused(() => assertAdapterDeclaration({ ...hosting, actions: [...hosting.actions, { actionCode: 'publish2', kind: 'PUBLISH_PRODUCTION', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true }] }), 'ADAPTER_KIND_DUPLICATE');
  });
});

describe('C7-D social contract (provider-neutral)', () => {
  const social: SocialAdapterDeclaration = {
    adapterCode: 'x.social', providerKind: 'SOCIAL', apiVersion: '202609', apiSunsetAt: '2027-09-30T00:00:00.000Z', targetClasses: ['SOCIAL_CHANNEL'],
    actions: [{ actionCode: 'post', kind: 'SOCIAL_PUBLISH', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true }, { actionCode: 'post-state', kind: 'READ_STATE', risk: 'R0', sideEffects: 'NONE', mutatesExternal: false }],
    requiredPermissions: { organization_social: 'write' }, contentTypes: ['TEXT', 'IMAGE'], accountRoles: ['CONTENT_ADMIN'], editSemantics: 'IMMUTABLE', deleteSemantics: 'DELETABLE', asyncPublish: true, rateLimit: { maxPublishes: 100, perSeconds: 86_400 },
  };
  const req = { at: '2026-10-02T10:00:00.000Z', contentType: 'IMAGE' as const, grantedPermissions: ['organization_social'], accountRoles: ['CONTENT_ADMIN'], notBefore: '2026-10-02T09:00:00.000Z', notAfter: '2026-10-02T11:00:00.000Z' };

  test('34/35/36/37 publish only inside the exact approved window, with the declared version, content type, permission and role', () => {
    assertSocialDeclaration(social);
    assert.deepEqual(checkSocialPublish(social, req), { ok: true });
    assert.deepEqual(checkSocialPublish(social, { ...req, at: '2027-10-01T10:00:00.000Z', notBefore: '2027-10-01T09:00:00.000Z', notAfter: '2027-10-01T11:00:00.000Z' }), { ok: false, code: 'API_VERSION_UNSUPPORTED' });
    assert.deepEqual(checkSocialPublish(social, { ...req, contentType: 'VIDEO' }), { ok: false, code: 'CONTENT_TYPE_UNSUPPORTED' });
    assert.deepEqual(checkSocialPublish(social, { ...req, grantedPermissions: [] }), { ok: false, code: 'PERMISSION_MISSING' });
    assert.deepEqual(checkSocialPublish(social, { ...req, accountRoles: ['VIEWER'] }), { ok: false, code: 'ACCOUNT_ROLE_MISSING' });
    assert.deepEqual(checkSocialPublish(social, { ...req, at: '2026-10-02T08:59:59.999Z' }), { ok: false, code: 'BEFORE_APPROVED_WINDOW' });
    assert.deepEqual(checkSocialPublish(social, { ...req, at: '2026-10-02T11:00:00.000Z' }), { ok: false, code: 'OUTSIDE_APPROVED_WINDOW' });
  });

  test('39 a social declaration cannot carry comment / reply / DM / spend acts; the package references media of the same revision with alt text', () => {
    refused(() => assertSocialDeclaration({ ...social, actions: [...social.actions, { actionCode: 'comment-reply', kind: 'READ_STATE', risk: 'R0', sideEffects: 'NONE', mutatesExternal: false }] }), 'ADAPTER_ACTION_FORBIDDEN');
    const pkg = { v: 1, channelIntent: 'LAUNCH_TEASER', text: 'QANDEEL قادم', media: [{ path: 'social/hero.png', altText: 'شعار قنديل' }], links: ['https://example.org/'], timing: { notBefore: '2026-10-02T09:00:00.000Z', notAfter: '2026-10-02T11:00:00.000Z' }, goalRefs: [], hypothesis: 'A teaser will invite early sign-ups.' };
    const parsed = parseSocialPackage(JSON.stringify(pkg), ['social/post.json', 'social/hero.png']);
    assert.equal(socialContentType(parsed), 'IMAGE');
    refused(() => parseSocialPackage(JSON.stringify(pkg), ['social/post.json']), 'SOCIAL_MEDIA_NOT_IN_REVISION');
    refused(() => parseSocialPackage(JSON.stringify({ ...pkg, media: [{ path: 'social/hero.png' }] }), ['social/hero.png']));
    refused(() => parseSocialPackage(JSON.stringify({ ...pkg, links: ['http://insecure.example/'] }), ['social/hero.png']), 'SOCIAL_LINK_INVALID');
  });
});
