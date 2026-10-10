/**
 * A deterministic in-memory public GitHub for the product documentation reader (D-P1-06): a repository's `main` ref,
 * the files of each commit and its recent commit headlines. It answers only the reads the reader makes, records every
 * request (so proofs can show nothing else was ever sent, and never with a credential) and makes no network call.
 */
import { createHash } from 'node:crypto';

import type { GitHubRequest, GitHubResponse, GitHubTransport } from './transport.js';

const sha1 = (v: string): string => createHash('sha1').update(v).digest('hex');

interface FakeDocCommit {
  readonly sha: string;
  readonly date: string;
  readonly message: string;
  readonly files: ReadonlyMap<string, string>;
}

export class FakeProductDocsTransport implements GitHubTransport {
  readonly requests: GitHubRequest[] = [];
  readonly #repos = new Map<string, FakeDocCommit[]>();
  /** When set, every request answers this status (e.g. 403 for an exhausted anonymous rate limit). */
  failStatus: number | null = null;

  /** Adds a commit on `main` of `owner/repo` with exactly these files; returns its SHA. */
  commit(full: string, files: Readonly<Record<string, string>>, message: string, date = '2026-10-10T08:00:00Z'): string {
    const history = this.#repos.get(full.toLowerCase()) ?? [];
    const sha = sha1(`${full}:${history.length}:${message}`);
    history.unshift({ sha, date, message, files: new Map(Object.entries(files)) });
    this.#repos.set(full.toLowerCase(), history);
    return sha;
  }

  async send(request: GitHubRequest): Promise<GitHubResponse> {
    this.requests.push(request);
    if (this.failStatus !== null) return { status: this.failStatus, body: null };
    if (request.method !== 'GET') return { status: 405, body: null };
    const m = /^\/repos\/([^/]+\/[^/?]+)(\/.*)$/.exec(request.path);
    const history = m ? this.#repos.get((m[1] as string).toLowerCase()) : undefined;
    if (!m || !history) return { status: 404, body: null };
    const rest = m[2] as string;
    if (rest === '/git/ref/heads/main') return { status: 200, body: { ref: 'refs/heads/main', object: { sha: (history[0] as FakeDocCommit).sha, type: 'commit' } } };
    const list = /^\/commits\?sha=([0-9a-f]{40})&per_page=(\d)$/.exec(rest);
    if (list) {
      const at = history.findIndex((c) => c.sha === list[1]);
      if (at < 0) return { status: 404, body: null };
      return { status: 200, body: history.slice(at, at + Number(list[2])).map((c) => ({ sha: c.sha, commit: { message: c.message, committer: { date: c.date } } })) };
    }
    const content = /^\/contents\/(.+)\?ref=([0-9a-f]{40})$/.exec(rest);
    if (content) {
      const c = history.find((x) => x.sha === content[2]);
      const text = c?.files.get(content[1] as string);
      if (text === undefined) return { status: 404, body: null };
      const bytes = Buffer.from(text, 'utf8');
      return { status: 200, body: { type: 'file', path: content[1], size: bytes.length, encoding: 'base64', content: bytes.toString('base64') } };
    }
    return { status: 404, body: null };
  }
}
