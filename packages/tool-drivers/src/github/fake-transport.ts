/**
 * Deterministic in-memory GitHub (the only GitHub "server" in CI, as the runtime's deterministic fakes are the only
 * models): one or more repositories with refs, git objects, pull requests, check runs, a mergeable state and an App
 * installation. It enforces what real GitHub enforces for this adapter — the merge `sha` guard (409), refs that already
 * exist (422), installation tokens scoped to the requested repositories and permissions — and records every request so
 * proofs can show what was (never) sent. It makes no network call and reads no credential.
 */
import { createHash } from 'node:crypto';

import type { GitHubRequest, GitHubResponse, GitHubTransport } from './transport.js';

const sha1 = (v: string): string => createHash('sha1').update(v).digest('hex');

interface FakeRepo {
  defaultBranch: string;
  refs: Map<string, string>;
  commits: Map<string, { message: string; tree: string; parents: string[] }>;
  pulls: { number: number; head: string; base: string; headSha: string; state: 'open' | 'closed'; merged: boolean; mergeCommitSha: string | null }[];
  mergeableState: string;
  checks: { status: string; conclusion: string | null }[];
  combinedStatus: string;
  rules: { type: string }[];
}

export class FakeGitHubTransport implements GitHubTransport {
  readonly requests: GitHubRequest[] = [];
  readonly repos = new Map<string, FakeRepo>();
  /** Permissions the fake installation grants (tests can make it broader than requested). */
  grantedPermissions: Record<string, string> | null = null;
  #tokens = new Map<string, { repos: string[] }>();
  #fail: { match: (r: GitHubRequest) => boolean; mode: 'throw' | 'hang' | { status: number } } | null = null;

  addRepo(full: string, init: Partial<Pick<FakeRepo, 'defaultBranch' | 'mergeableState' | 'checks' | 'combinedStatus' | 'rules'>> = {}): FakeRepo {
    const base = sha1(`root:${full}`);
    const repo: FakeRepo = {
      defaultBranch: init.defaultBranch ?? 'main',
      refs: new Map([[init.defaultBranch ?? 'main', base]]),
      commits: new Map([[base, { message: 'initial', tree: sha1('tree:empty'), parents: [] }]]),
      pulls: [],
      mergeableState: init.mergeableState ?? 'clean',
      checks: init.checks ?? [{ status: 'completed', conclusion: 'success' }],
      combinedStatus: init.combinedStatus ?? 'success',
      rules: init.rules ?? [{ type: 'pull_request' }, { type: 'required_status_checks' }],
    };
    this.repos.set(full.toLowerCase(), repo);
    return repo;
  }

  /** The next request matching `match` fails: a thrown network error, a hang until aborted, or an HTTP status. */
  failNext(match: (r: GitHubRequest) => boolean, mode: 'throw' | 'hang' | { status: number }): this {
    this.#fail = { match, mode };
    return this;
  }

  /** Simulates someone pushing to the PR branch after the Company's export (the head moves). */
  pushToPull(full: string, number: number): string {
    const repo = this.repos.get(full.toLowerCase());
    const pr = repo?.pulls.find((p) => p.number === number);
    if (!repo || !pr) throw new Error('no such pull');
    const sha = sha1(`foreign:${pr.headSha}`);
    repo.commits.set(sha, { message: 'foreign push', tree: sha1('tree:foreign'), parents: [pr.headSha] });
    repo.refs.set(pr.head, sha);
    pr.headSha = sha;
    return sha;
  }

  async send(request: GitHubRequest, signal: AbortSignal): Promise<GitHubResponse> {
    this.requests.push(request);
    if (this.#fail && this.#fail.match(request)) {
      const f = this.#fail;
      this.#fail = null;
      if (f.mode === 'throw') throw new Error('network');
      if (f.mode === 'hang') {
        // The request reaches the provider (it is applied) but the answer never comes back: an unknown outcome.
        this.#apply(request);
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        throw new Error('aborted');
      }
      return { status: f.mode.status, body: { message: 'injected' } };
    }
    return this.#apply(request);
  }

  #apply(req: GitHubRequest): GitHubResponse {
    const tok = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(req.path);
    if (tok) {
      if (!req.bearer.includes('.')) return { status: 401, body: {} };
      const body = req.body as { repositories?: string[]; permissions?: Record<string, string> };
      const token = `ghs_fake${sha1(`${this.#tokens.size}`).slice(0, 32)}`;
      this.#tokens.set(token, { repos: body.repositories ?? [] });
      return { status: 201, body: { token, expires_at: '2030-01-01T00:00:00Z', permissions: this.grantedPermissions ?? body.permissions ?? {}, repositories: (body.repositories ?? []).map((name) => ({ name })) } };
    }
    const m = /^\/repos\/([^/]+)\/([^/?]+)(.*)$/.exec(req.path);
    if (!m) return { status: 404, body: {} };
    const scope = this.#tokens.get(req.bearer);
    if (!scope || !scope.repos.includes(m[2] as string)) return { status: 403, body: {} };
    const full = `${m[1]}/${m[2]}`;
    const repo = this.repos.get(full.toLowerCase());
    if (!repo) return { status: 404, body: {} };
    const rest = m[3] as string;
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (req.method === 'GET' && rest === '') return { status: 200, body: { full_name: full, default_branch: repo.defaultBranch, visibility: 'private' } };
    let x = /^\/rules\/branches\/(.+)$/.exec(rest);
    if (req.method === 'GET' && x) return { status: 200, body: repo.rules };
    x = /^\/git\/ref\/heads\/(.+)$/.exec(rest);
    if (req.method === 'GET' && x) {
      const sha = repo.refs.get(x[1] as string);
      return sha ? { status: 200, body: { ref: `refs/heads/${x[1]}`, object: { sha } } } : { status: 404, body: {} };
    }
    x = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest);
    if (req.method === 'GET' && x) {
      const c = repo.commits.get(x[1] as string);
      return c ? { status: 200, body: { sha: x[1], message: c.message, tree: { sha: c.tree } } } : { status: 404, body: {} };
    }
    if (req.method === 'POST' && rest === '/git/blobs') return { status: 201, body: { sha: sha1(`blob:${String(b.content)}`) } };
    if (req.method === 'POST' && rest === '/git/trees') return { status: 201, body: { sha: sha1(`tree:${JSON.stringify(b.tree)}`) } };
    if (req.method === 'POST' && rest === '/git/commits') {
      const sha = sha1(`commit:${String(b.message)}:${String(b.tree)}:${JSON.stringify(b.parents)}`);
      repo.commits.set(sha, { message: String(b.message), tree: String(b.tree), parents: b.parents as string[] });
      return { status: 201, body: { sha } };
    }
    if (req.method === 'POST' && rest === '/git/refs') {
      const name = String(b.ref).replace(/^refs\/heads\//, '');
      if (repo.refs.has(name)) return { status: 422, body: { message: 'Reference already exists' } };
      repo.refs.set(name, String(b.sha));
      return { status: 201, body: { ref: b.ref, object: { sha: b.sha } } };
    }
    x = /^\/pulls\?head=[^:]+:(.+)&state=all$/.exec(rest);
    if (req.method === 'GET' && x) return { status: 200, body: repo.pulls.filter((p) => p.head === x?.[1]).map((p) => ({ number: p.number })) };
    if (req.method === 'POST' && rest === '/pulls') {
      const head = String(b.head);
      if (repo.pulls.some((p) => p.head === head && p.state === 'open')) return { status: 422, body: {} };
      const number = repo.pulls.length + 1;
      repo.pulls.push({ number, head, base: String(b.base), headSha: repo.refs.get(head) ?? '', state: 'open', merged: false, mergeCommitSha: null });
      return { status: 201, body: { number } };
    }
    x = /^\/pulls\/(\d+)$/.exec(rest);
    if (req.method === 'GET' && x) {
      const p = repo.pulls.find((q) => q.number === Number(x?.[1]));
      return p ? { status: 200, body: { number: p.number, state: p.state, merged: p.merged, merge_commit_sha: p.mergeCommitSha, mergeable_state: repo.mergeableState, head: { sha: p.headSha, ref: p.head }, base: { ref: p.base } } } : { status: 404, body: {} };
    }
    x = /^\/commits\/([0-9a-f]{40})\/check-runs$/.exec(rest);
    if (req.method === 'GET' && x) return { status: 200, body: { total_count: repo.checks.length, check_runs: repo.checks } };
    x = /^\/commits\/([0-9a-f]{40})\/status$/.exec(rest);
    if (req.method === 'GET' && x) return { status: 200, body: { state: repo.combinedStatus } };
    x = /^\/pulls\/(\d+)\/merge$/.exec(rest);
    if (req.method === 'PUT' && x) {
      const p = repo.pulls.find((q) => q.number === Number(x?.[1]));
      if (!p) return { status: 404, body: {} };
      if (p.merged) return { status: 405, body: {} };
      if (String(b.sha) !== p.headSha) return { status: 409, body: { message: 'Head branch was modified' } };
      if (repo.mergeableState !== 'clean') return { status: 405, body: {} };
      const sha = sha1(`merge:${p.headSha}`);
      p.merged = true;
      p.state = 'closed';
      p.mergeCommitSha = sha;
      repo.refs.set(p.base, sha);
      return { status: 200, body: { sha, merged: true } };
    }
    return { status: 404, body: {} };
  }
}
