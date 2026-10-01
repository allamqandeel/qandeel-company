/**
 * The GitHub code-host promotion adapter's declared capability (Strong-v1's first external code host, D-C7D-xx).
 *
 * GitHub is an EXTERNAL PROMOTION TARGET, never the Company's editing substrate: Employees iterate in the internal
 * Digital Workshop; exporting an exact approved candidate to a branch + pull request is one governed act, and merging
 * that exact head to production is a SEPARATE governed act. The adapter speaks one pinned REST API version and requests
 * exactly the minimum installation permissions below — never Administration, never secrets, environments, webhooks,
 * collaborators, deploy keys, workflows or branch protection; it never force-pushes, deletes or bypasses protection.
 */
import { assertAdapterDeclaration, type PromotionAdapterDeclaration } from '@qandeel-company/governance';

/**
 * Pinned REST API version and its announced end of support (docs.github.com "API Versions": 2022-11-28 is supported
 * until 2028-03-10). After the sunset the adapter fails closed (`API_VERSION_UNSUPPORTED`) until a reviewed upgrade.
 */
export const GITHUB_API_VERSION = '2022-11-28';
export const GITHUB_API_SUNSET = '2028-03-10T00:00:00.000Z';

/**
 * The exact installation permissions the adapter requests for each short-lived token (scoped to ONE repository).
 * Contents: write covers blobs / trees / commits / refs and the merge endpoint; Pull requests: write opens the PR;
 * Checks / Commit statuses: read show CI; Metadata: read covers repository and effective-rules reads. Frozen: nothing
 * at run time can broaden it.
 */
export const GITHUB_TOKEN_PERMISSIONS: Readonly<Record<string, 'read' | 'write'>> = Object.freeze({ contents: 'write', pull_requests: 'write', checks: 'read', statuses: 'read', metadata: 'read' });

export const GITHUB_CODE_HOST: PromotionAdapterDeclaration = Object.freeze(
  assertAdapterDeclaration({
    adapterCode: 'github.code-host',
    providerKind: 'CODE_HOST',
    apiVersion: GITHUB_API_VERSION,
    apiSunsetAt: GITHUB_API_SUNSET,
    targetClasses: ['CODE_REPOSITORY'],
    actions: [
      { actionCode: 'repository-read', kind: 'READ_STATE', risk: 'R0', sideEffects: 'NONE', mutatesExternal: false },
      { actionCode: 'pull-request-read', kind: 'READ_STATE', risk: 'R0', sideEffects: 'NONE', mutatesExternal: false },
      { actionCode: 'promotion-reconcile', kind: 'RECONCILE', risk: 'R0', sideEffects: 'NONE', mutatesExternal: false },
      { actionCode: 'candidate-export', kind: 'EXPORT_SOURCE', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true },
      { actionCode: 'production-merge', kind: 'MERGE_PRODUCTION', risk: 'R3', sideEffects: 'UNSAFE', mutatesExternal: true },
    ],
    requiredPermissions: GITHUB_TOKEN_PERMISSIONS,
  }),
);

const id = { type: 'string' as const, required: true, maxLength: 36 };
const sha64 = { type: 'string' as const, required: true, maxLength: 64 };

/**
 * What the Founder registers for this adapter (the existing Tool Registry; tools are never granted automatically): one
 * EXTERNAL tool whose driver code is the adapter code and whose credential is a `vault:` reference, with exactly these
 * actions and argument schemas. Every argument is an id, a hash, a number or the kernel-built branch — never a URL,
 * a path on the host, file content or a token.
 */
export const GITHUB_TOOL_REGISTRATION = Object.freeze({
  tool: { code: 'github-code-host', driverCode: GITHUB_CODE_HOST.adapterCode, egress: 'EXTERNAL' as const },
  actions: [
    { code: 'repository-read', risk: 'R0' as const, sideEffects: 'NONE' as const, mutatesExternal: false, dataClassCeiling: 'D1' as const, argsSchema: { fields: { targetId: id } }, costPerCallMicros: 0 },
    { code: 'pull-request-read', risk: 'R0' as const, sideEffects: 'NONE' as const, mutatesExternal: false, dataClassCeiling: 'D1' as const, argsSchema: { fields: { targetId: id, pullNumber: { type: 'integer' as const, required: true, min: 1, max: 100_000_000 } } }, costPerCallMicros: 0 },
    { code: 'promotion-reconcile', risk: 'R0' as const, sideEffects: 'NONE' as const, mutatesExternal: false, dataClassCeiling: 'D1' as const, argsSchema: { fields: { promotionId: id } }, costPerCallMicros: 0 },
    {
      code: 'candidate-export', risk: 'R3' as const, sideEffects: 'UNSAFE' as const, mutatesExternal: true, dataClassCeiling: 'D1' as const,
      argsSchema: { fields: { promotionId: id, candidateId: id, manifestSha256: sha64, targetId: id, branch: { type: 'string' as const, required: true, maxLength: 64 } } }, costPerCallMicros: 0,
    },
    {
      code: 'production-merge', risk: 'R3' as const, sideEffects: 'UNSAFE' as const, mutatesExternal: true, dataClassCeiling: 'D1' as const,
      argsSchema: { fields: { promotionId: id, candidateId: id, manifestSha256: sha64, targetId: id, pullNumber: { type: 'integer' as const, required: true, min: 1, max: 100_000_000 }, expectedHeadSha: { type: 'string' as const, required: true, maxLength: 40 } } }, costPerCallMicros: 0,
    },
  ],
  /** The promotion kinds this adapter serves, by action code (a target's registered action map). */
  promotionActions: { EXPORT_SOURCE: 'candidate-export', MERGE_PRODUCTION: 'production-merge' } as const,
});
