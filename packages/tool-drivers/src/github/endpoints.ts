/**
 * The closed GitHub endpoint allowlist (pure). Every request the adapter makes is checked here BEFORE it is sent — by the
 * driver and again by the HTTPS transport. There is no passthrough: no other path, no PATCH, no DELETE, no ref update
 * (so no force-push), and nothing under administration, branch protection, collaborators, hooks, keys, secrets,
 * environments, actions or the organization.
 */
import { QandeelError } from '@qandeel-company/domain';

export type GitHubMethod = 'GET' | 'POST' | 'PUT';

const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const REPO = '[A-Za-z0-9._-]{1,100}';
const BRANCH = '[A-Za-z0-9._/-]{1,100}';
const SHA = '[0-9a-f]{40}';
const NUM = '[1-9][0-9]{0,8}';
const R = `/repos/${OWNER}/${REPO}`;

const ALLOWED: readonly { readonly method: GitHubMethod; readonly re: RegExp; readonly mutates: boolean }[] = [
  { method: 'GET', re: new RegExp(`^${R}$`), mutates: false },
  { method: 'GET', re: new RegExp(`^${R}/rules/branches/${BRANCH}$`), mutates: false },
  { method: 'GET', re: new RegExp(`^${R}/git/ref/heads/${BRANCH}$`), mutates: false },
  { method: 'GET', re: new RegExp(`^${R}/git/commits/${SHA}$`), mutates: false },
  { method: 'GET', re: new RegExp(`^${R}/pulls\\?head=${OWNER}:${BRANCH}&state=all$`), mutates: false },
  { method: 'GET', re: new RegExp(`^${R}/pulls/${NUM}$`), mutates: false },
  { method: 'GET', re: new RegExp(`^${R}/commits/${SHA}/check-runs$`), mutates: false },
  { method: 'GET', re: new RegExp(`^${R}/commits/${SHA}/status$`), mutates: false },
  { method: 'POST', re: new RegExp(`^${R}/git/blobs$`), mutates: true },
  { method: 'POST', re: new RegExp(`^${R}/git/trees$`), mutates: true },
  { method: 'POST', re: new RegExp(`^${R}/git/commits$`), mutates: true },
  { method: 'POST', re: new RegExp(`^${R}/git/refs$`), mutates: true },
  { method: 'POST', re: new RegExp(`^${R}/pulls$`), mutates: true },
  { method: 'PUT', re: new RegExp(`^${R}/pulls/${NUM}/merge$`), mutates: true },
  { method: 'POST', re: /^\/app\/installations\/[1-9][0-9]{0,15}\/access_tokens$/, mutates: false },
];

/** Never allowed, whatever the pattern above might match by accident (defence in depth). */
const FORBIDDEN = /\/(?:protection|collaborators|hooks|keys|secrets|environments|actions|admin|administration|members|teams|invitations|transfer|archive|delete|deployments|pages|rulesets)(?:\/|$|\?)/i;

/** The allowlisted endpoint of a request, or a refusal (`GITHUB_ENDPOINT_FORBIDDEN`). */
export function assertGitHubEndpoint(method: string, path: string): { readonly mutates: boolean } {
  const hit = ALLOWED.find((e) => e.method === method && e.re.test(path));
  // The forbidden-area check reads the endpoint itself: the repository's own name and a branch name are data, not areas.
  const area = path.replace(/^\/repos\/[^/]+\/[^/?]+/, '').replace(/\/(?:rules\/branches|git\/ref\/heads)\/.*$/, '/branch-ref').replace(/\?.*$/, '');
  if (!hit || FORBIDDEN.test(area) || path.includes('..') || path.includes('//')) {
    throw new QandeelError('TOOL_DENIED', 'GitHub endpoint is not allowlisted', { reason: 'GITHUB_ENDPOINT_FORBIDDEN', method: String(method).slice(0, 8) });
  }
  return { mutates: hit.mutates };
}

/** `github:<owner>/<repo>` (a Founder-registered target identifier) → its parts, or null. */
export function parseRepositoryRef(externalRef: string): { readonly owner: string; readonly repo: string; readonly full: string } | null {
  const m = new RegExp(`^github:(${OWNER})/(${REPO})$`).exec(externalRef);
  if (!m || (m[2] as string).includes('..')) return null;
  return { owner: m[1] as string, repo: m[2] as string, full: `${m[1]}/${m[2]}` };
}

export const isBranchName = (v: string): boolean => new RegExp(`^${BRANCH}$`).test(v) && !v.includes('..') && !v.startsWith('/') && !v.endsWith('/');
