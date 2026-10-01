/**
 * The GitHub code-host promotion driver. It is reached ONLY by the governed Tool Executor, after the full authority path
 * (grant → independent review → the Founder's approval of exactly these arguments → idempotent intent); it never decides
 * authority itself, but it refuses anything that does not match what was approved.
 *
 *   candidate-export   exact candidate (re-verified from the Company store by the approved arguments) → blobs → a tree
 *                      that is EXACTLY the candidate → one commit with provenance trailers → a NEW branch (created, never
 *                      updated or forced) → one pull request. Replay of the same promotion returns the same refs.
 *   production-merge   only the exact head the Company exported (expected head SHA), only when GitHub reports the PR
 *                      cleanly mergeable and every check on that head succeeded, merged with the `sha` guard (GitHub
 *                      refuses a changed head). Branch protection is never read through Administration and never bypassed.
 *   *-read / reconcile provider state reads (no mutation) — reconciliation evidence for an uncertain outcome.
 *
 * Failure semantics (Stage 12 §27): anything that fails before the first visible mutation is `sent: NO`; a timeout,
 * network error or unreadable answer from the first visible mutation on is `sent: UNKNOWN` (the Company holds it for
 * reconciliation — it is never blindly retried). Failure codes are short codes; tokens, headers and provider error
 * bodies never leave the driver.
 */
import { QandeelError, isQandeelError, type JsonObject } from '@qandeel-company/domain';
import { adapterVersionUsable, exportBranch, exportCommitMessage, type ToolDriver, type ToolDriverInput, type ToolDriverResult } from '@qandeel-company/governance';

import type { PromotionSource } from '../source.js';
import { installationToken, type GitHubCredentialSource } from './auth.js';
import { GITHUB_API_VERSION, GITHUB_CODE_HOST } from './declaration.js';
import { assertGitHubEndpoint, isBranchName, parseRepositoryRef, type GitHubMethod } from './endpoints.js';
import type { GitHubTransport } from './transport.js';

export interface GitHubDriverOptions {
  readonly transport: GitHubTransport;
  readonly credentials: GitHubCredentialSource;
  /** The `vault:` reference of the App credential (as registered on the adapter's Tool record). */
  readonly credentialRef: string;
  readonly source: PromotionSource;
  /** Host-configured repository allowlist (`owner/repo`); a target outside it is refused even if registered. */
  readonly allowedRepositories: readonly string[];
  readonly clock?: () => Date;
}

class Stop extends Error {
  constructor(readonly code: string, readonly sent: 'NO' | 'UNKNOWN') {
    super(code);
  }
}

function no(code: string): never {
  throw new Stop(code, 'NO');
}

const SHA = /^[0-9a-f]{40}$/;

type Client = (method: GitHubMethod, path: string, body?: JsonObject) => Promise<{ status: number; raw: unknown; body: Record<string, unknown> }>;

export class GitHubCodeHostDriver implements ToolDriver {
  readonly driverCode = GITHUB_CODE_HOST.adapterCode;
  readonly #o: GitHubDriverOptions;
  readonly #allowed: ReadonlySet<string>;

  constructor(options: GitHubDriverOptions) {
    if (!/^vault:[a-z0-9][a-z0-9.-]{0,57}$/.test(options.credentialRef)) throw new QandeelError('VALIDATION_FAILED', 'the GitHub App credential is a vault reference', { field: 'credentialRef' });
    this.#o = options;
    this.#allowed = new Set(options.allowedRepositories.map((r) => r.toLowerCase()));
  }

  async invoke(input: ToolDriverInput, signal: AbortSignal): Promise<ToolDriverResult> {
    const now = (this.#o.clock ?? (() => new Date()))();
    let mutated = false;
    try {
      if (!adapterVersionUsable(GITHUB_CODE_HOST, now.toISOString())) no('API_VERSION_UNSUPPORTED');
      const declared = GITHUB_CODE_HOST.actions.find((a) => a.actionCode === input.actionCode) ?? no('ACTION_NOT_DECLARED');
      const markMutated = (): void => {
        mutated = true;
      };
      switch (declared.actionCode) {
        case 'repository-read':
          return ok(await this.#repositoryRead(input.args, now, signal));
        case 'pull-request-read':
          return ok(await this.#pullRead(input.args, now, signal));
        case 'promotion-reconcile':
          return ok(await this.#reconcile(input.args, now, signal));
        case 'candidate-export':
          return ok(await this.#export(input.args, now, signal, markMutated));
        case 'production-merge':
          return ok(await this.#merge(input.args, now, signal, markMutated));
        default:
          return no('ACTION_NOT_DECLARED');
      }
    } catch (error) {
      if (error instanceof Stop) return { ok: false, code: error.code, sent: error.code === 'PROVIDER_OUTCOME_UNKNOWN' ? 'UNKNOWN' : error.sent };
      if (isQandeelError(error)) return { ok: false, code: String(error.details.reason ?? error.code).slice(0, 64), sent: mutated ? 'UNKNOWN' : 'NO' };
      // Network failure, abort, timeout or an unreadable answer: the provider may have acted once a mutation was sent.
      return { ok: false, code: mutated ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_UNREACHABLE', sent: mutated ? 'UNKNOWN' : 'NO' };
    }
  }

  // --- Context ------------------------------------------------------------------------------------------------------

  #repository(externalRef: string): { owner: string; repo: string; full: string } {
    const r = parseRepositoryRef(externalRef) ?? no('TARGET_NOT_A_GITHUB_REPOSITORY');
    if (!this.#allowed.has(r.full.toLowerCase())) no('REPOSITORY_NOT_ALLOWLISTED');
    return r;
  }

  async #client(repo: { repo: string }, now: Date, signal: AbortSignal): Promise<Client> {
    const c = this.#o.credentials.appCredentials(this.#o.credentialRef) ?? no('CREDENTIAL_UNAVAILABLE');
    const token = await installationToken(this.#o.transport, c, repo.repo, now, signal);
    return async (method, path, body) => {
      assertGitHubEndpoint(method, path);
      const res = await this.#o.transport.send({ method, path, bearer: token, ...(body !== undefined ? { body } : {}) }, signal);
      return { status: res.status, raw: res.body, body: (typeof res.body === 'object' && res.body !== null && !Array.isArray(res.body) ? res.body : {}) as Record<string, unknown> };
    };
  }

  #target(targetId: unknown): { owner: string; repo: string; full: string } {
    const t = this.#o.source.target(GITHUB_CODE_HOST.adapterCode, String(targetId)) ?? no('TARGET_NOT_FOUND');
    if (t.state !== 'ACTIVE') no('TARGET_NOT_ACTIVE');
    if (t.targetClass !== 'CODE_REPOSITORY') no('TARGET_CLASS_MISMATCH');
    return this.#repository(t.externalRef);
  }

  // --- Reads --------------------------------------------------------------------------------------------------------

  async #repositoryRead(args: JsonObject, now: Date, signal: AbortSignal): Promise<JsonObject> {
    const r = this.#target(args.targetId);
    const gh = await this.#client(r, now, signal);
    const repo = await gh('GET', `/repos/${r.full}`);
    if (repo.status !== 200) no(`GITHUB_HTTP_${repo.status}`);
    const def = String(repo.body.default_branch ?? '');
    if (!isBranchName(def)) no('DEFAULT_BRANCH_UNREADABLE');
    // Effective rules through the Metadata permission (never the Administration-only protection endpoint).
    const rules = await gh('GET', `/repos/${r.full}/rules/branches/${def}`);
    const types: string[] = [];
    for (const x of rules.status === 200 && Array.isArray(rules.raw) ? (rules.raw as { type?: unknown }[]) : []) if (typeof x?.type === 'string' && /^[a-z_]{1,40}$/.test(x.type)) types.push(x.type);
    return { repository: r.full, defaultBranch: def, visibility: String(repo.body.visibility ?? 'unknown').slice(0, 16), ruleTypes: [...new Set(types)].sort(), apiVersion: GITHUB_API_VERSION };
  }

  async #pullState(gh: Client, full: string, n: number): Promise<{ headSha: string; baseRef: string; state: string; merged: boolean; mergeCommitSha: string | null; mergeableState: string; checks: { total: number; succeeded: number; failed: number; pending: number }; status: string }> {
    const pr = await gh('GET', `/repos/${full}/pulls/${n}`);
    if (pr.status !== 200) no(`GITHUB_HTTP_${pr.status}`);
    const head = String((pr.body.head as { sha?: unknown } | undefined)?.sha ?? '');
    if (!SHA.test(head)) no('PULL_REQUEST_UNREADABLE');
    const runs = await gh('GET', `/repos/${full}/commits/${head}/check-runs`);
    const all = Array.isArray(runs.body.check_runs) ? (runs.body.check_runs as { status?: unknown; conclusion?: unknown }[]) : [];
    const checks = { total: all.length, succeeded: 0, failed: 0, pending: 0 };
    for (const c of all) {
      if (c.status !== 'completed') checks.pending++;
      else if (c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral') checks.succeeded++;
      else checks.failed++;
    }
    const st = await gh('GET', `/repos/${full}/commits/${head}/status`);
    return {
      headSha: head,
      baseRef: String((pr.body.base as { ref?: unknown } | undefined)?.ref ?? ''),
      state: String(pr.body.state ?? ''),
      merged: pr.body.merged === true,
      mergeCommitSha: typeof pr.body.merge_commit_sha === 'string' && SHA.test(pr.body.merge_commit_sha) ? pr.body.merge_commit_sha : null,
      // Unknown / still computing (`null`) is never "clean": fail closed.
      mergeableState: typeof pr.body.mergeable_state === 'string' ? pr.body.mergeable_state : 'unknown',
      checks,
      status: st.status === 200 && typeof st.body.state === 'string' ? st.body.state : 'unknown',
    };
  }

  async #pullRead(args: JsonObject, now: Date, signal: AbortSignal): Promise<JsonObject> {
    const r = this.#target(args.targetId);
    const gh = await this.#client(r, now, signal);
    const s = await this.#pullState(gh, r.full, Number(args.pullNumber));
    return { repository: r.full, pullNumber: Number(args.pullNumber), headSha: s.headSha, state: s.merged ? 'merged' : s.state, mergeableState: s.mergeableState, checksTotal: s.checks.total, checksSucceeded: s.checks.succeeded, checksFailed: s.checks.failed, checksPending: s.checks.pending, combinedStatus: s.status, apiVersion: GITHUB_API_VERSION };
  }

  /** Finds this promotion's own branch / commit / pull request (by its deterministic branch and provenance trailer). */
  async #findExport(gh: Client, r: { owner: string; full: string }, branch: string, promotionId: string): Promise<{ commitSha: string; treeSha: string; pullNumber: number | null } | 'ABSENT' | 'FOREIGN'> {
    const ref = await gh('GET', `/repos/${r.full}/git/ref/heads/${branch}`);
    if (ref.status === 404) return 'ABSENT';
    if (ref.status !== 200) no(`GITHUB_HTTP_${ref.status}`);
    const sha = String((ref.body.object as { sha?: unknown } | undefined)?.sha ?? '');
    if (!SHA.test(sha)) no('REF_UNREADABLE');
    const commit = await gh('GET', `/repos/${r.full}/git/commits/${sha}`);
    if (commit.status !== 200) no(`GITHUB_HTTP_${commit.status}`);
    if (!String(commit.body.message ?? '').includes(`Qandeel-Promotion: ${promotionId}`)) return 'FOREIGN';
    const pulls = await gh('GET', `/repos/${r.full}/pulls?head=${r.owner}:${branch}&state=all`);
    const first = Array.isArray(pulls.raw) ? (pulls.raw as { number?: unknown }[])[0] : undefined;
    return { commitSha: sha, treeSha: String((commit.body.tree as { sha?: unknown } | undefined)?.sha ?? ''), pullNumber: typeof first?.number === 'number' ? first.number : null };
  }

  async #reconcile(args: JsonObject, now: Date, signal: AbortSignal): Promise<JsonObject> {
    const promotionId = String(args.promotionId);
    const bound = this.#o.source.promotionArgs(promotionId) ?? no('PROMOTION_NOT_FOUND');
    const r = this.#target(bound.targetId);
    const gh = await this.#client(r, now, signal);
    if (typeof bound.branch === 'string') {
      const found = await this.#findExport(gh, r, bound.branch, promotionId);
      if (found === 'ABSENT' || found === 'FOREIGN') return { promotionId, repository: r.full, found: false, evidence: found };
      return { promotionId, repository: r.full, found: true, branch: bound.branch, commitSha: found.commitSha, ...(found.pullNumber !== null ? { pullNumber: found.pullNumber } : {}), apiVersion: GITHUB_API_VERSION };
    }
    const s = await this.#pullState(gh, r.full, Number(bound.pullNumber));
    return { promotionId, repository: r.full, found: s.merged, ...(s.mergeCommitSha !== null && s.merged ? { mergeCommitSha: s.mergeCommitSha } : {}), headSha: s.headSha, apiVersion: GITHUB_API_VERSION };
  }

  // --- Mutations ----------------------------------------------------------------------------------------------------

  async #export(args: JsonObject, now: Date, signal: AbortSignal, markMutated: () => void): Promise<JsonObject> {
    const res = this.#o.source.resolve(GITHUB_CODE_HOST.adapterCode, args, { includeContent: true });
    if (!res.ok) return no(res.code);
    const x = res.export;
    if (x.kind !== 'EXPORT_SOURCE' || x.target.targetClass !== 'CODE_REPOSITORY') no('PROMOTION_KIND_MISMATCH');
    const branch = exportBranch(x.candidateId, x.promotionId);
    if (args.branch !== branch || !isBranchName(branch)) no('BRANCH_NOT_EXPECTED');
    const r = this.#repository(x.target.externalRef);
    const gh = await this.#client(r, now, signal);
    // Replay: the same promotion already reached GitHub — return the same refs, create nothing.
    const prior = await this.#findExport(gh, r, branch, x.promotionId);
    if (prior === 'FOREIGN') no('BRANCH_CONFLICT');
    if (prior !== 'ABSENT' && prior.pullNumber !== null) return { repository: r.full, branch, commitSha: prior.commitSha, treeSha: prior.treeSha, pullNumber: prior.pullNumber, replayed: true, apiVersion: GITHUB_API_VERSION };
    const repo = await gh('GET', `/repos/${r.full}`);
    if (repo.status !== 200) no(`GITHUB_HTTP_${repo.status}`);
    const base = String(repo.body.default_branch ?? '');
    if (!isBranchName(base)) no('DEFAULT_BRANCH_UNREADABLE');
    let commitSha: string;
    let treeSha: string;
    if (prior !== 'ABSENT') {
      // The branch exists with this promotion's own commit (an earlier attempt stopped before the PR): reuse it.
      commitSha = prior.commitSha;
      treeSha = prior.treeSha;
    } else {
      const baseRef = await gh('GET', `/repos/${r.full}/git/ref/heads/${base}`);
      const baseSha = String((baseRef.body.object as { sha?: unknown } | undefined)?.sha ?? '');
      if (baseRef.status !== 200 || !SHA.test(baseSha)) no('BASE_UNREADABLE');
      const tree: JsonObject[] = [];
      for (const f of x.files) {
        const blob = await gh('POST', `/repos/${r.full}/git/blobs`, { content: Buffer.from(f.content).toString('base64'), encoding: 'base64' });
        const sha = String(blob.body.sha ?? '');
        if (blob.status !== 201 || !SHA.test(sha)) no(`GITHUB_HTTP_${blob.status}`);
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha });
      }
      // No base tree: the exported tree is EXACTLY the candidate (a file absent from it is visibly removed in the PR).
      const t = await gh('POST', `/repos/${r.full}/git/trees`, { tree });
      treeSha = String(t.body.sha ?? '');
      if (t.status !== 201 || !SHA.test(treeSha)) no(`GITHUB_HTTP_${t.status}`);
      const c = await gh('POST', `/repos/${r.full}/git/commits`, { message: exportCommitMessage({ candidateId: x.candidateId, manifestSha256: x.manifestSha256, promotionId: x.promotionId }), tree: treeSha, parents: [baseSha] });
      commitSha = String(c.body.sha ?? '');
      if (c.status !== 201 || !SHA.test(commitSha)) no(`GITHUB_HTTP_${c.status}`);
      // From the branch creation on, the effect is visible: an unanswered call may have taken effect.
      markMutated();
      const ref = await gh('POST', `/repos/${r.full}/git/refs`, { ref: `refs/heads/${branch}`, sha: commitSha });
      if (ref.status !== 201) no(ref.status === 422 ? 'BRANCH_CONFLICT' : `GITHUB_HTTP_${ref.status}`);
    }
    markMutated();
    const pr = await gh('POST', `/repos/${r.full}/pulls`, {
      title: `QANDEEL digital candidate ${x.candidateId.slice(0, 8)}`,
      head: branch,
      base,
      body: `Exact internal release candidate exported by QANDEEL COMPANY.\n\nCandidate: ${x.candidateId}\nManifest: ${x.manifestSha256}\nPromotion: ${x.promotionId}\n\nMerging to production is a separate, Founder-approved act.`,
      maintainer_can_modify: false,
      draft: false,
    });
    const pullNumber = Number(pr.body.number);
    if (pr.status !== 201 || !Number.isSafeInteger(pullNumber)) return no(`GITHUB_HTTP_${pr.status}`);
    return { repository: r.full, branch, commitSha, treeSha, pullNumber, headSha: commitSha, apiVersion: GITHUB_API_VERSION };
  }

  async #merge(args: JsonObject, now: Date, signal: AbortSignal, markMutated: () => void): Promise<JsonObject> {
    const res = this.#o.source.resolve(GITHUB_CODE_HOST.adapterCode, args, { includeContent: false });
    if (!res.ok) return no(res.code);
    const x = res.export;
    if (x.kind !== 'MERGE_PRODUCTION') no('PROMOTION_KIND_MISMATCH');
    const expected = String(args.expectedHeadSha);
    const n = Number(args.pullNumber);
    if (!SHA.test(expected) || !Number.isSafeInteger(n)) no('MERGE_ARGS_INVALID');
    const r = this.#repository(x.target.externalRef);
    const gh = await this.#client(r, now, signal);
    const repo = await gh('GET', `/repos/${r.full}`);
    const def = String(repo.body.default_branch ?? '');
    const s = await this.#pullState(gh, r.full, n);
    // Replay: this exact head is already merged — the same external result, nothing new.
    if (s.merged && s.headSha === expected && s.mergeCommitSha !== null) return { repository: r.full, pullNumber: n, headSha: expected, mergeCommitSha: s.mergeCommitSha, replayed: true, apiVersion: GITHUB_API_VERSION };
    if (s.headSha !== expected) no('HEAD_CHANGED');
    if (s.baseRef !== def) no('BASE_NOT_DEFAULT_BRANCH');
    if (s.state !== 'open') no('PULL_REQUEST_NOT_OPEN');
    // Every required gate GitHub enforces (protection rules, required reviews and checks) must already be satisfied:
    // only `clean` is mergeable here; blocked / behind / dirty / unstable / unknown all refuse. No bypass exists.
    if (s.mergeableState !== 'clean') no('MERGE_NOT_READY');
    if (s.checks.pending > 0 || s.checks.failed > 0 || s.status === 'failure' || s.status === 'error') no('CHECKS_NOT_SATISFIED');
    markMutated();
    const m = await gh('PUT', `/repos/${r.full}/pulls/${n}/merge`, { sha: expected, merge_method: 'merge', commit_title: `QANDEEL production merge of candidate ${x.candidateId.slice(0, 8)}` });
    if (m.status === 409) no('HEAD_CHANGED');
    if (m.status === 405) no('MERGE_NOT_ALLOWED');
    const sha = String(m.body.sha ?? '');
    if (m.status !== 200 || m.body.merged !== true || !SHA.test(sha)) return no(`GITHUB_HTTP_${m.status}`);
    return { repository: r.full, pullNumber: n, headSha: expected, mergeCommitSha: sha, apiVersion: GITHUB_API_VERSION };
  }
}

const ok = (result: JsonObject): ToolDriverResult => ({ ok: true, result });
