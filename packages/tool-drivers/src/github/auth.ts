/**
 * GitHub App authentication at the protected driver boundary (Stage 14 D14-A.4 / D14-D.2): the App's private key is
 * obtained from protected credential material through a `vault:` reference — never from the Company database, a model
 * context, an artifact or an argument — and used only to sign a short-lived JWT, which is exchanged for a ~1-hour
 * installation token scoped to ONE repository and EXACTLY the adapter's declared permissions. The token is never cached
 * durably, logged, recorded or returned. A token response granting anything beyond what was asked fails closed.
 */
import { createSign } from 'node:crypto';

import { QandeelError } from '@qandeel-company/domain';

import { GITHUB_TOKEN_PERMISSIONS } from './declaration.js';
import type { GitHubTransport } from './transport.js';

export interface GitHubAppCredentials {
  readonly appId: string;
  readonly installationId: string;
  readonly privateKeyPem: string;
}

/**
 * Resolves a `vault:<name>` reference at the protected boundary (the Founder host's user-scoped vault). The Company
 * stores only the reference (on the adapter's Tool record); the material never crosses into Company state.
 */
export interface GitHubCredentialSource {
  appCredentials(credentialRef: string): GitHubAppCredentials | null;
}

const b64url = (v: Buffer | string): string => Buffer.from(v).toString('base64url');

const denied = (reason: string): QandeelError => new QandeelError('TOOL_DENIED', 'GitHub authentication refused', { reason });

/** An RS256 GitHub App JWT (issued 60 s in the past against clock drift; expires within GitHub's 10-minute bound). */
export function appJwt(c: GitHubAppCredentials, now: Date): string {
  if (!/^[1-9][0-9]{0,15}$/.test(c.appId)) throw denied('GITHUB_APP_ID_INVALID');
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 540, iss: c.appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${b64url(signer.sign(c.privateKeyPem))}`;
}

const RANK = { read: 1, write: 2 } as const;

/** True when the granted permission set is within what the adapter asked for (no extra key, no higher level). */
export function permissionsWithinRequest(granted: unknown): boolean {
  if (typeof granted !== 'object' || granted === null || Array.isArray(granted)) return false;
  for (const [k, v] of Object.entries(granted as Record<string, unknown>)) {
    const asked = GITHUB_TOKEN_PERMISSIONS[k];
    if (asked === undefined || (v !== 'read' && v !== 'write') || RANK[v] > RANK[asked]) return false;
  }
  return true;
}

/** A fresh installation token for exactly one repository and exactly the declared permissions. */
export async function installationToken(transport: GitHubTransport, c: GitHubAppCredentials, repo: string, now: Date, signal: AbortSignal): Promise<string> {
  if (!/^[1-9][0-9]{0,15}$/.test(c.installationId)) throw denied('GITHUB_INSTALLATION_INVALID');
  const res = await transport.send({ method: 'POST', path: `/app/installations/${c.installationId}/access_tokens`, bearer: appJwt(c, now), body: { repositories: [repo], permissions: { ...GITHUB_TOKEN_PERMISSIONS } } }, signal);
  const b = res.body as { token?: unknown; permissions?: unknown; repositories?: unknown } | null;
  if (res.status !== 201 || typeof b?.token !== 'string' || b.token.length < 20) throw denied(`GITHUB_TOKEN_${res.status}`);
  if (!permissionsWithinRequest(b.permissions)) throw denied('PERMISSIONS_BROADER_THAN_REQUESTED');
  if (Array.isArray(b.repositories) && (b.repositories.length !== 1 || (b.repositories[0] as { name?: unknown })?.name !== repo)) throw denied('REPOSITORY_SCOPE_BROADER_THAN_REQUESTED');
  return b.token;
}
