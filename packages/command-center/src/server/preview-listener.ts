/**
 * C7-D internal Preview — the Founder sees Company-made digital work WITHOUT publishing it. Employee-written site code is
 * untrusted, so it never runs in the Founder surface's security context:
 *
 *   - a SEPARATE loopback site: 127.0.0.2 (a different host, so a different site: the Founder surface's cookies, bound to
 *     127.0.0.1, are never sent here and SameSite treats the two as cross-site), one ephemeral port per opened preview,
 *     closed when it expires; never a LAN address;
 *   - every response carries `Content-Security-Policy: sandbox allow-scripts` WITHOUT allow-same-origin (an opaque origin:
 *     no cookies, no storage, no service worker, `Origin: null`), `connect-src 'none'` (no network from preview code),
 *     `form-action 'none'`, no frames, no workers, plus `noindex`, `no-store`, COOP / CORP / COEP isolation;
 *   - it never reads or sets a cookie, never receives a Company credential, has no API, no database and no filesystem
 *     path: it serves only the exact finalized revision's files, re-verified (manifest recomputed, every object re-hashed)
 *     from the Artifact Store, by logical path; SOURCE files (framework code that would need a build) are never served;
 *   - the Founder surface opens it with `noopener` and refuses any cross-site request (Sec-Fetch-Site), so a preview can
 *     neither drive the Command Center nor act with Founder authority.
 * A preview is internal inspection only: never a deployment, a publication, production, SEO or market evidence.
 * Logs carry route, status and code only (Rule A).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { isQandeelError } from '@qandeel-company/domain';
import { PREVIEW_ENTRY, assertDigitalPath, digitalMedia } from '@qandeel-company/governance';
import type { CompanyRuntime } from '@qandeel-company/runtime';

/** The preview's own loopback host — never the Founder surface's host (127.0.0.1), never a LAN address. */
export const PREVIEW_HOST = '127.0.0.2';
export const PREVIEW_TTL_MS = 30 * 60_000;
export const MAX_OPEN_PREVIEWS = 4;

export function previewSecurityHeaders(origin: string): Readonly<Record<string, string>> {
  return {
    'Content-Security-Policy': `sandbox allow-scripts; default-src 'none'; script-src ${origin} 'unsafe-inline'; style-src ${origin} 'unsafe-inline'; img-src ${origin} data:; font-src ${origin}; media-src ${origin}; connect-src 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; worker-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Cache-Control': 'no-store',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), clipboard-write=()',
    'X-Qandeel-Preview': 'internal; not published; not production',
  };
}

interface OpenPreview {
  readonly previewId: string;
  readonly server: Server;
  readonly port: number;
  readonly expiresAt: number;
  readonly timer: NodeJS.Timeout;
}

export interface OpenedPreview {
  readonly url: string;
  readonly expiresAt: string;
  readonly mode: 'INTERNAL';
}

export class PreviewHost {
  readonly #runtime: CompanyRuntime;
  readonly #log: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  readonly #ttlMs: number;
  readonly #open = new Map<number, OpenPreview>();

  constructor(options: { runtime: CompanyRuntime; ttlMs?: number; log?: (event: string, fields: Record<string, string | number | boolean | null>) => void }) {
    this.#runtime = options.runtime;
    this.#ttlMs = options.ttlMs ?? PREVIEW_TTL_MS;
    this.#log = options.log ?? (() => undefined);
  }

  /**
   * Opens one preview on its own ephemeral port (the Founder surface calls this only for an authenticated Founder). The
   * preview must resolve NOW (READY, exact manifest); the oldest open preview closes beyond the bound.
   */
  async open(previewId: string): Promise<OpenedPreview> {
    const r = this.#runtime.founder.digital.previewResolution(previewId);
    while (this.#open.size >= MAX_OPEN_PREVIEWS) await this.#closeOne([...this.#open.values()].sort((a, b) => a.expiresAt - b.expiresAt)[0] as OpenPreview);
    let port = 0;
    const server = createServer((req, res) => {
      try {
        this.#serve(previewId, port, req, res);
      } catch (error) {
        this.#log('preview.request_crashed', { code: isQandeelError(error) ? error.code : 'UNCLASSIFIED_ERROR' });
        if (!res.headersSent) this.#refuse(res, port, 500, 'PREVIEW_ERROR');
      }
    });
    server.headersTimeout = 10_000;
    server.requestTimeout = 30_000;
    server.maxHeadersCount = 64;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      // Loopback only, on the preview's own host: never the Founder surface's origin, never a LAN address.
      server.listen({ host: PREVIEW_HOST, port: 0, exclusive: true }, () => {
        server.off('error', reject);
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
    const expiresAt = Date.now() + this.#ttlMs;
    const timer = setTimeout(() => void this.#closeOne(this.#open.get(port) as OpenPreview), this.#ttlMs);
    timer.unref();
    this.#open.set(port, { previewId, server, port, expiresAt, timer });
    this.#log('preview.opened', { port });
    return { url: `http://${PREVIEW_HOST}:${port}/${r.entryPath === PREVIEW_ENTRY ? '' : r.entryPath}`, expiresAt: new Date(expiresAt).toISOString(), mode: 'INTERNAL' };
  }

  get openCount(): number {
    return this.#open.size;
  }

  async close(): Promise<void> {
    for (const p of [...this.#open.values()]) await this.#closeOne(p);
  }

  async #closeOne(p: OpenPreview | undefined): Promise<void> {
    if (!p || !this.#open.has(p.port)) return;
    this.#open.delete(p.port);
    clearTimeout(p.timer);
    await new Promise<void>((resolve) => p.server.close(() => resolve()));
    p.server.closeAllConnections();
  }

  #refuse(res: ServerResponse, port: number, status: number, code: string): void {
    for (const [k, v] of Object.entries(previewSecurityHeaders(`http://${PREVIEW_HOST}:${port}`))) res.setHeader(k, v);
    const body = JSON.stringify({ ok: false, code });
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
    this.#log('preview.refused', { status, code });
  }

  #serve(previewId: string, port: number, req: IncomingMessage, res: ServerResponse): void {
    const origin = `http://${PREVIEW_HOST}:${port}`;
    const method = (req.method ?? 'GET').toUpperCase();
    // DNS rebinding sends another Host; only the preview's exact host:port is answered.
    if (req.headers.host?.toLowerCase() !== `${PREVIEW_HOST}:${port}`) return this.#refuse(res, port, 403, 'HOST_NOT_PREVIEW');
    if (method !== 'GET' && method !== 'HEAD') return this.#refuse(res, port, 405, 'METHOD_NOT_ALLOWED');
    // A preview never installs a service worker (it could outlive the preview); the opaque origin forbids it anyway.
    if (req.headers['service-worker'] !== undefined) return this.#refuse(res, port, 403, 'SERVICE_WORKER_REFUSED');
    // Cookies are never read: nothing in a request can carry authority into a preview.
    const url = new URL(req.url ?? '/', origin);
    let logical: string;
    try {
      const segments = url.pathname.split('/').slice(1).map((s) => decodeURIComponent(s));
      const joined = segments.join('/');
      logical = assertDigitalPath(joined === '' || joined.endsWith('/') ? `${joined}${PREVIEW_ENTRY}` : joined);
    } catch {
      return this.#refuse(res, port, 404, 'PATH_REFUSED');
    }
    let resolution;
    try {
      resolution = this.#runtime.founder.digital.previewResolution(previewId);
    } catch (error) {
      return this.#refuse(res, port, 409, isQandeelError(error) ? String(error.details.reason ?? error.code) : 'PREVIEW_UNAVAILABLE');
    }
    let file = resolution.files.get(logical);
    if (!file && !logical.endsWith(`/${PREVIEW_ENTRY}`) && logical !== PREVIEW_ENTRY) file = resolution.files.get(`${logical}/${PREVIEW_ENTRY}`);
    if (!file) return this.#refuse(res, port, 404, 'NOT_IN_REVISION');
    let media;
    try {
      media = digitalMedia(file.path);
    } catch {
      return this.#refuse(res, port, 415, 'MEDIA_TYPE_UNSUPPORTED');
    }
    // Source that would need a build or a server is stored and exported, never executed here.
    if (media.kind !== 'STATIC') return this.#refuse(res, port, 404, 'SOURCE_NOT_SERVED');
    let body: Buffer;
    try {
      body = this.#runtime.artifacts.read(file.artifactId);
    } catch {
      return this.#refuse(res, port, 409, 'ARTIFACT_INTEGRITY');
    }
    for (const [k, v] of Object.entries(previewSecurityHeaders(origin))) res.setHeader(k, v);
    res.writeHead(200, { 'Content-Type': media.text ? `${media.mediaType}; charset=utf-8` : media.mediaType, 'Content-Length': body.byteLength });
    res.end(method === 'HEAD' ? undefined : body);
  }
}
