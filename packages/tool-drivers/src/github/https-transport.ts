/**
 * The ONE approved external network path of the Company's tool drivers (verifier `c7d-network-confined`): HTTPS to the
 * fixed GitHub REST host, nothing else. The host is a constant (no configurable URL, no redirect following); every
 * request is re-checked against the endpoint allowlist; the bearer value is used for this request only and never logged,
 * stored or returned; response headers never leave this module; bodies are bounded.
 */
import { assertGitHubEndpoint } from './endpoints.js';
import { GITHUB_API_VERSION } from './declaration.js';
import type { GitHubRequest, GitHubResponse, GitHubTransport } from './transport.js';

const GITHUB_API_ORIGIN = 'https://api.github.com';
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** A JSON body, or null when it is empty or not JSON (never the raw text: provider errors are not surfaced). */
function parseBody(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export class GitHubHttpsTransport implements GitHubTransport {
  async send(request: GitHubRequest, signal: AbortSignal): Promise<GitHubResponse> {
    assertGitHubEndpoint(request.method, request.path);
    const res = await fetch(`${GITHUB_API_ORIGIN}${request.path}`, {
      method: request.method,
      redirect: 'error',
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': 'qandeel-company-tool-driver',
        Authorization: `Bearer ${request.bearer}`,
        ...(request.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
    });
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) return { status: res.status, body: null };
    return { status: res.status, body: parseBody(text) };
  }
}
