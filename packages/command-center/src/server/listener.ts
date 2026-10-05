/**
 * The loopback listener of the Founder surface — the ONE network path in the repository (verifier rule
 * `founder-listener-loopback-only`; every other package still has no network surface).
 *
 * - Binds 127.0.0.1 only, never a LAN address (Stage 12 §47).
 * - Every request passes the pure origin gate (`security.ts`); every API call except the launch exchange
 *   needs a verified session; every state change needs the CSRF secret too (Stage 12 §49).
 * - Routes are explicit capabilities (Stage 12 §50); bodies are bounded JSON; responses are `no-store`.
 * - Server-Sent Events push a content-free "changed" nudge after commits (no polling anywhere).
 * - Logs carry method, route, status and code — never a body, a name or a message (Rule A).
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { QandeelError, isQandeelError } from '@qandeel-company/domain';
import type { FounderSession } from '@qandeel-company/storage';
import type { CompanyRuntime } from '@qandeel-company/runtime';

import * as api from '../api.js';
import { CSRF_HEADER, LAUNCH_PATH, LOOPBACK_HOST, MAX_BODY_BYTES, SESSION_COOKIE, clearedCookies, csrfCookie, gateRequest, parseCookies, securityHeaders, sessionCookie, statusForCode } from '../security.js';
import { resolveStatic, type StaticRoots } from '../static.js';

export interface ListenerOptions {
  readonly runtime: CompanyRuntime;
  readonly roots: StaticRoots;
  readonly port?: number;
  readonly log?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  /** C7-D: the isolated internal Preview host (its own loopback site), if running. */
  readonly preview?: api.PreviewOpener;
}

type Json = Record<string, unknown>;
type Handler = (ctx: api.ApiContext, params: Record<string, string>, body: Json, query: URLSearchParams) => unknown;

interface Route {
  readonly method: 'GET' | 'POST';
  readonly pattern: RegExp;
  readonly name: string;
  readonly handler: Handler;
  readonly stateChange: boolean;
}

const ID = '([0-9a-f-]{36})';
const route = (method: Route['method'], path: string, name: string, handler: Handler, stateChange = method === 'POST'): Route => ({ method, name, handler, stateChange, pattern: new RegExp(`^${path.replace(/:id/g, ID)}$`) });

const ROUTES: readonly Route[] = [
  route('GET', '/api/session', 'session', (ctx) => ({ founderRef: ctx.session.founderRef, expiresAt: ctx.session.expiresAt, sessionId: ctx.session.id })),
  route('GET', '/api/universe', 'universe', (ctx, _p, _b, q) => api.universe(ctx, { at: q.get('at') ?? undefined })),
  route('GET', '/api/employees/:id', 'employee', (ctx, p) => api.employeeDetail(ctx, p[0] as string)),
  route('GET', '/api/goals/:id', 'goal', (ctx, p) => api.goalDetail(ctx, p[0] as string)),
  route('GET', '/api/attention', 'attention', (ctx) => api.attention(ctx)),
  route('GET', '/api/threads', 'threads', (ctx) => api.threads(ctx)),
  route('GET', '/api/threads/:id/messages', 'messages', (ctx, p) => api.messages(ctx, p[0] as string)),
  route('GET', '/api/calendar', 'calendar', (ctx, _p, _b, q) => api.calendar(ctx, { from: q.get('from') ?? undefined, to: q.get('to') ?? undefined })),
  route('GET', '/api/timeline', 'timeline', (ctx) => api.timeline(ctx)),
  route('GET', '/api/health', 'health', (ctx) => api.health(ctx)),
  route('GET', '/api/directory', 'directory', (ctx) => api.directory(ctx)),
  route('POST', '/api/command', 'command', (ctx, _p, b) => api.command(ctx, b)),
  route('POST', '/api/previews', 'preview', (ctx, _p, b) => api.createPreview(ctx, b)),
  route('POST', '/api/previews/:id/confirm', 'confirm', (ctx, p, b) => api.confirmPreview(ctx, p[0] as string, b)),
  route('POST', '/api/previews/:id/reject', 'reject', (ctx, p, b) => api.rejectPreview(ctx, p[0] as string, b)),
  route('POST', '/api/threads', 'open-thread', (ctx, _p, b) => api.openThread(ctx, b)),
  route('POST', '/api/threads/:id/messages', 'send', (ctx, p, b) => api.sendMessage(ctx, p[0] as string, b)),
  route('POST', '/api/attention/:id/dismiss', 'dismiss', (ctx, p, b) => api.dismissAttention(ctx, p[0] as string, b)),
  route('POST', '/api/goals/propose', 'propose-goal', (ctx, _p, b) => api.proposeGoal(ctx, b)),
  // C6: exception-first reports, evidence drill-down, profiles and recovery status — reads, plus one idempotent
  // report generation (a system derivation; it grants and decides nothing).
  route('GET', '/api/improvement/reports', 'report-latest', (ctx, _p, _b, q) => api.latestReport(ctx, q.get('cadence') ?? 'DAILY')),
  route('POST', '/api/improvement/reports', 'report-generate', (ctx, _p, b) => api.generateReport(ctx, b)),
  route('GET', '/api/improvement/inspect', 'inspect', (ctx, _p, _b, q) => api.inspect(ctx, { kind: q.get('kind') ?? 'COMPANY', id: q.get('id') ?? undefined })),
  route('GET', '/api/improvement/profiles/:id', 'profile', (ctx, p) => api.profile(ctx, p[0] as string)),
  route('GET', '/api/improvement/resilience', 'resilience', (ctx) => api.resilience(ctx)),
  // C7-C Pilots: reads only (a Pilot is created and moved through /api/previews, confirmed with its fingerprint).
  route('GET', '/api/pilots', 'pilots', (ctx) => api.pilots(ctx)),
  route('GET', '/api/pilots/:id', 'pilot', (ctx, p) => api.pilotBoard(ctx, p[0] as string)),
  route('GET', '/api/pilots/:id/inspect', 'pilotInspect', (ctx, p, _b, q) => api.pilotInspect(ctx, p[0] as string, { workItemId: q.get('workItemId') ?? undefined })),
  // L1-01 model providers: a read (profiles, identity checks, what is provisioned); provisioning goes through /api/previews.
  route('GET', '/api/providers', 'providers', (ctx) => api.providers(ctx)),
  // C7-D Digital Workshop: reads, and opening an internal Preview on the isolated preview host (session + CSRF). A promotion
  // is decided through the existing governed APPROVAL_DECIDE confirmation, never here.
  route('GET', '/api/digital/projects', 'digitalProjects', (ctx) => api.digitalProjects(ctx)),
  route('GET', '/api/digital/projects/:id', 'digitalProject', (ctx, p) => api.digitalProject(ctx, p[0] as string)),
  route('POST', '/api/digital/previews/:id/open', 'digitalPreviewOpen', (ctx, p) => api.openDigitalPreview(ctx, p[0] as string)),
];

export class FounderListener {
  readonly #server: Server;
  readonly #runtime: CompanyRuntime;
  readonly #roots: StaticRoots;
  readonly #log: NonNullable<ListenerOptions['log']>;
  readonly #preview: api.PreviewOpener | undefined;
  readonly #streams = new Set<ServerResponse>();
  readonly #unsubscribe: (() => void)[] = [];
  #port = 0;
  #keepalive: NodeJS.Timeout | undefined;

  constructor(options: ListenerOptions) {
    this.#runtime = options.runtime;
    this.#roots = options.roots;
    this.#log = options.log ?? (() => undefined);
    this.#preview = options.preview;
    this.#port = options.port ?? 0;
    this.#server = createServer((req, res) => {
      this.#handle(req, res).catch((error: unknown) => {
        this.#log('founder.request_crashed', { code: isQandeelError(error) ? error.code : 'UNCLASSIFIED_ERROR' });
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'UNCLASSIFIED_ERROR' }));
      });
    });
    // Slowloris and oversized-header protection for a single-user loopback surface.
    this.#server.headersTimeout = 10_000;
    this.#server.requestTimeout = 30_000;
    this.#server.maxHeadersCount = 64;
    this.#server.keepAliveTimeout = 5_000;
  }

  get port(): number {
    return this.#port;
  }

  get origin(): string {
    return `http://${LOOPBACK_HOST}:${this.#port}`;
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once('error', reject);
      // Loopback only: the surface is never reachable from the LAN (Stage 12 §47, C5 §18).
      this.#server.listen({ host: LOOPBACK_HOST, port: this.#port, exclusive: true }, () => {
        this.#server.off('error', reject);
        this.#port = (this.#server.address() as AddressInfo).port;
        resolve();
      });
    });
    const nudge = (): void => this.#broadcast('changed');
    this.#unsubscribe.push(this.#runtime.onFounderChange(nudge), this.#runtime.onEvent(nudge));
    // A comment line keeps proxies and browsers from closing an idle stream; it carries nothing.
    this.#keepalive = setInterval(() => this.#broadcast(null), 25_000);
    this.#keepalive.unref();
    this.#log('founder.listening', { port: this.#port, host: LOOPBACK_HOST });
  }

  async close(): Promise<void> {
    for (const u of this.#unsubscribe) u();
    if (this.#keepalive) clearInterval(this.#keepalive);
    for (const s of this.#streams) s.end();
    this.#streams.clear();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
    this.#server.closeAllConnections();
  }

  #broadcast(event: string | null): void {
    const line = event === null ? ':keepalive\n\n' : `event: ${event}\ndata: {}\n\n`;
    for (const s of this.#streams) s.write(line);
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const nonce = randomBytes(16).toString('base64');
    for (const [k, v] of Object.entries(securityHeaders(nonce))) res.setHeader(k, v);
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', this.origin);
    const cookies = parseCookies(req.headers.cookie);
    const facts = { method, host: req.headers.host, origin: req.headers.origin, secFetchSite: req.headers['sec-fetch-site'] as string | undefined, contentType: req.headers['content-type'], cookies, csrfHeader: req.headers[CSRF_HEADER] as string | undefined };
    const gate = gateRequest(facts, this.#port, { csrfExempt: method === 'POST' && url.pathname === LAUNCH_PATH });
    if (!gate.ok) return this.#json(res, gate.status, { ok: false, code: gate.code }, method, 'gate');
    if (method === 'HEAD') {
      res.writeHead(200);
      return void res.end();
    }
    if (url.pathname.startsWith('/api/')) return this.#api(req, res, method, url, cookies, facts.csrfHeader);
    if (method !== 'GET') return this.#json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, method, 'static');
    const file = resolveStatic(this.#roots, url.pathname);
    if (file === null) return this.#json(res, 404, { ok: false, code: 'NOT_FOUND' }, method, 'static');
    let body = file.body;
    if (file.contentType.startsWith('text/html')) body = Buffer.from(file.body.toString('utf8').replaceAll('{{nonce}}', nonce), 'utf8');
    res.writeHead(200, { 'Content-Type': file.contentType, 'Content-Length': body.length, 'Cache-Control': file.immutable ? 'private, max-age=86400, immutable' : 'no-store' });
    res.end(body);
  }

  async #api(req: IncomingMessage, res: ServerResponse, method: string, url: URL, cookies: Record<string, string>, csrfHeader: string | undefined): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    if (method === 'POST' && url.pathname === LAUNCH_PATH) return this.#launch(req, res);
    if (method === 'POST' && url.pathname === '/api/session/logout') return this.#logout(res, cookies, csrfHeader);
    const auth = this.#runtime.founder.auth;
    let session: FounderSession;
    try {
      session = auth.verifySession(cookies[SESSION_COOKIE], method === 'POST' ? csrfHeader : undefined);
    } catch (error) {
      return this.#json(res, 401, { ok: false, code: isQandeelError(error) ? error.code : 'FOUNDER_SESSION_INVALID' }, method, 'session');
    }
    if (method === 'GET' && url.pathname === '/api/events') return this.#stream(req, res);
    const match = ROUTES.map((r) => ({ r, m: r.method === method ? r.pattern.exec(url.pathname) : null })).find((x) => x.m !== null);
    if (!match || !match.m) return this.#json(res, 404, { ok: false, code: 'NOT_FOUND' }, method, 'unknown');
    let body: Json = {};
    if (method === 'POST') {
      const raw = await readBody(req);
      if (raw === null) return this.#json(res, 413, { ok: false, code: 'BODY_TOO_LARGE' }, method, match.r.name);
      try {
        const parsed: unknown = raw.length === 0 ? {} : JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('shape');
        body = parsed as Json;
      } catch {
        return this.#json(res, 400, { ok: false, code: 'BODY_NOT_JSON' }, method, match.r.name);
      }
    }
    const params = match.m.slice(1).reduce<Record<string, string>>((acc, v, i) => ({ ...acc, [String(i)]: v ?? '' }), {});
    try {
      const out = await match.r.handler({ runtime: this.#runtime, session, ...(this.#preview ? { preview: this.#preview } : {}) }, params, body, url.searchParams);
      return this.#json(res, 200, { ok: true, ...(out as Json) }, method, match.r.name);
    } catch (error) {
      const code = isQandeelError(error) ? error.code : 'UNCLASSIFIED_ERROR';
      const details = isQandeelError(error) ? error.details : {};
      this.#log('founder.request_refused', { route: match.r.name, code });
      return this.#json(res, statusForCode(code), { ok: false, code, details }, method, match.r.name);
    }
  }

  async #launch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req);
    let token: unknown;
    try {
      token = raw === null ? undefined : (JSON.parse(raw) as { token?: unknown }).token;
    } catch {
      token = undefined;
    }
    try {
      const out = this.#runtime.founder.auth.redeemLaunchToken(token);
      const ttl = Math.max(1, Math.floor((Date.parse(out.session.expiresAt) - Date.now()) / 1000));
      res.setHeader('Set-Cookie', [sessionCookie(out.cookieValue, ttl), csrfCookie(out.csrf, ttl)]);
      return this.#json(res, 200, { ok: true, founderRef: out.session.founderRef, expiresAt: out.session.expiresAt }, 'POST', 'launch');
    } catch (error) {
      const code = isQandeelError(error) ? error.code : 'FOUNDER_SESSION_INVALID';
      return this.#json(res, 401, { ok: false, code }, 'POST', 'launch');
    }
  }

  #logout(res: ServerResponse, cookies: Record<string, string>, csrfHeader: string | undefined): void {
    try {
      const session = this.#runtime.founder.auth.verifySession(cookies[SESSION_COOKIE], csrfHeader);
      this.#runtime.founder.auth.revokeSession(session.id, 'founder.logout');
    } catch {
      // An invalid session has nothing to revoke; the cookies are cleared either way.
    }
    res.setHeader('Set-Cookie', [...clearedCookies()]);
    return this.#json(res, 200, { ok: true }, 'POST', 'logout');
  }

  #stream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(':connected\n\n');
    this.#streams.add(res);
    req.on('close', () => this.#streams.delete(res));
  }

  #json(res: ServerResponse, status: number, payload: Json, method: string, routeName: string): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
    if (status >= 400) this.#log('founder.response', { method, route: routeName, status, code: String(payload.code ?? '') });
  }
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function assertLoopbackOnly(host: string): void {
  if (host !== LOOPBACK_HOST) throw new QandeelError('VALIDATION_FAILED', 'the Founder surface binds loopback only', { host });
}
