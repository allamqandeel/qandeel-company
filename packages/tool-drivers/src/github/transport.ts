/** The GitHub transport contract (no I/O here). The adapter talks only through it; tests use a deterministic fake. */
import type { JsonObject } from '@qandeel-company/domain';

import type { GitHubMethod } from './endpoints.js';

export interface GitHubRequest {
  readonly method: GitHubMethod;
  /** An allowlisted API path (see `endpoints.ts`) — never a URL or a host. */
  readonly path: string;
  readonly body?: JsonObject;
  /** A short-lived installation token or the App's signed JWT, used for this request only and never recorded. */
  readonly bearer: string;
}

export interface GitHubResponse {
  readonly status: number;
  /** The parsed JSON body (bounded); response headers are never surfaced to the Company. */
  readonly body: unknown;
}

export interface GitHubTransport {
  send(request: GitHubRequest, signal: AbortSignal): Promise<GitHubResponse>;
}
