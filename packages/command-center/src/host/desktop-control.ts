/**
 * D2-CTRL-01 (D-D2-01; verifier rule `desktop-control-confined`) — the stopped-state desktop controller: how the Founder's
 * OWN Command Center window stops, starts and restarts the existing Company and stays open while the Company is stopped.
 *
 * It is a narrowly scoped, local-only desktop-lifecycle component, NOT a second host: it has no Company runtime, no
 * Founder API, no Company data and no supervisor role. Its only acts are the canonical launcher operations of the ONE
 * configured workspace — `discoverHost`, `stopHost` (controlled, never forced), `ensureRunning` (the admitted, pinned
 * release and the existing launcher configuration) and, once the host is READY again, `mintLaunchUrl` (the same single-use
 * launch token the Desktop shortcut mints for the same Windows user), so the window re-enters through the canonical
 * `/launch` exchange.
 *
 * How the window gets here (authority chain, nothing assumed from localhost or a URL fragment alone):
 *   1. In the RUNNING Command Center the Founder chooses Stop / Restart: `POST /api/desktop/control` on the host, behind
 *      the existing origin gate, Founder session and CSRF secret.
 *   2. The host mints a 256-bit single-use TICKET, starts this controller (the signed runtime, this release's own CLI, via
 *      `processes.ts`) and arms it over IPC with the ticket's SHA-256 only (never an argument, never a log line). The raw
 *      ticket goes to the authenticated page only, in its `no-store` JSON response.
 *   3. The page replaces itself with `http://127.0.0.1:<controller port>/desktop#<ticket>`; the controller page removes
 *      the fragment from history before anything else and redeems it once with an exact-origin, same-origin JSON POST.
 *      Redemption returns a 256-bit CONTROL KEY that lives only in that page's memory and is required (custom header) on
 *      every later call. Only after redemption does the controller run the canonical controlled stop.
 *
 * Refusals, all fail closed and content-free: a Host other than `127.0.0.1:<port>` (DNS rebinding, `localhost`), any POST
 * without `Sec-Fetch-Site: same-origin` and the exact Origin (another site, another loopback port, a non-browser client
 * that omits fetch metadata), a non-JSON body, any other method (no CORS preflight is ever answered), a ticket that is
 * spent, expired (60 s) or wrong (three wrong tickets end the controller), a missing or wrong control key.
 *
 * Bounded lifetime: unredeemed after the ticket's 60 s it exits; once its window's watch stream is gone for 15 s (the X
 * button) it exits after any operation in flight; after handing the window back to the READY Command Center it exits.
 * Closing the window never stops the Company: only an explicit Stop does. One controller per workspace (exclusive lock).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { LOOPBACK_HOST } from '../security.js';
import { resolveStatic, type StaticRoots } from '../static.js';
import { hostPaths, type HostPaths } from './descriptor.js';
import { discoverHost, ensureRunning, heldCode, launcherConfigPath, mintLaunchUrl, readLauncherConfig, stopHost, type HostStatus } from './lifecycle.js';
import { pidAlive, spawnHost } from './processes.js';

export const DESKTOP_CONTROL_LOCK_FILE = 'desktop-control.lock';
export const DESKTOP_CONTROL_PATH = '/desktop';
export const DESKTOP_KEY_HEADER = 'x-qandeel-desktop-key';
/** The ticket's lifetime: the window must arrive and redeem it within this bound. */
export const TICKET_TTL_MS = 60_000;
/** How long the controller outlives its window (a reload reconnects within it; the X button ends it). */
export const WINDOW_GRACE_MS = 15_000;
const ARM_TIMEOUT_MS = 15_000;
const MAX_WRONG_TICKETS = 3;
const MAX_BODY_BYTES = 4 * 1024;
const LOCK_STALE_MS = 24 * 60 * 60_000;

export type DesktopIntent = 'STOP' | 'RESTART';
export type DesktopAction = 'START' | 'STOP' | 'RESTART';
/** What the window shows. The canonical host state (STALE, UNHEALTHY, …) travels beside it, never folded into it. */
export type DesktopPhase = 'ARMED' | 'STOPPING' | 'STOPPED' | 'STARTING' | 'RESTARTING' | 'READY' | 'ENTERED' | 'ERROR' | 'HELD';

// --- the capability material (pure) -------------------------------------------------------------------------------------

const SECRET = /^[A-Za-z0-9_-]{43}$/;

/** A 256-bit single-use secret (base64url) and its SHA-256: the holder keeps the hash, the window the secret. */
export function mintSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: hashSecret(secret) };
}

export const hashSecret = (secret: string): string => createHash('sha256').update(secret, 'utf8').digest('hex');

/** Constant-time comparison of a presented secret with a held hash; anything malformed never matches. */
export function secretMatches(candidate: unknown, hash: string | null): boolean {
  if (hash === null || typeof candidate !== 'string' || !SECRET.test(candidate) || !/^[0-9a-f]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(hashSecret(candidate), 'hex'), Buffer.from(hash, 'hex'));
}

// --- the request gate (pure) ---------------------------------------------------------------------------------------------

export interface ControlRequestFacts {
  readonly method: string;
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly secFetchSite: string | undefined;
  readonly contentType: string | undefined;
}

export type ControlGate = { readonly ok: true } | { readonly ok: false; readonly status: 403 | 405 | 415; readonly code: string };

/**
 * Stricter than the host's gate on purpose: only `127.0.0.1:<port>` (never `localhost`), every POST must carry the browser's
 * `Sec-Fetch-Site: same-origin` (a client that omits fetch metadata is refused, not trusted) and the exact Origin, and
 * nothing but GET of the controller's public files and JSON POSTs exists (no preflight is answered).
 */
export function gateControlRequest(facts: ControlRequestFacts, port: number): ControlGate {
  const origin = `http://${LOOPBACK_HOST}:${port}`;
  if (facts.host === undefined || facts.host.toLowerCase() !== `${LOOPBACK_HOST}:${port}`) return { ok: false, status: 403, code: 'HOST_NOT_CONTROLLER' };
  if (facts.method === 'GET') return { ok: true };
  if (facts.method !== 'POST') return { ok: false, status: 405, code: 'METHOD_NOT_ALLOWED' };
  if (facts.secFetchSite !== 'same-origin') return { ok: false, status: 403, code: 'NOT_SAME_ORIGIN' };
  if (facts.origin === undefined || facts.origin.toLowerCase() !== origin) return { ok: false, status: 403, code: 'ORIGIN_NOT_CONTROLLER' };
  if (facts.contentType === undefined || !/^application\/json(?:\s*;.*)?$/i.test(facts.contentType)) return { ok: false, status: 415, code: 'CONTENT_TYPE' };
  return { ok: true };
}

/** The controller's own public files: its page, the shared stylesheet and font, its one script. Nothing else. */
export function controllerStaticPath(urlPath: string): string | null {
  if (urlPath === DESKTOP_CONTROL_PATH) return '/desktop.html';
  if (urlPath === '/styles.css' || urlPath === '/app/app/desktop.js') return urlPath;
  if (/^\/fonts\/[A-Za-z0-9_-]{1,64}\.woff2$/.test(urlPath)) return urlPath;
  return null;
}

export function controllerHeaders(): Readonly<Record<string, string>> {
  return {
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store',
  };
}

// --- the controller ------------------------------------------------------------------------------------------------------

export interface DesktopSnapshot {
  readonly phase: DesktopPhase;
  /** The canonical host state (RUNNING, STOPPED, STALE, UNHEALTHY, FOREIGN_RUNTIME, UPDATE_REQUIRED, HELD, …) or null. */
  readonly state: string | null;
  readonly reason: string | null;
  readonly hold: string | null;
  /** The refusal / failure code of the last operation (content-free), or null. */
  readonly code: string | null;
  readonly busy: boolean;
}

export interface DesktopControllerOptions {
  readonly workspace: string;
  readonly cliPath: string;
  readonly providers: readonly string[];
  readonly roots: StaticRoots;
  /** The release admission of the launcher (`ADMITTED` or the refusal reason). */
  readonly admit: () => string;
  readonly log?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  readonly onExit?: () => void;
  readonly now?: () => number;
  readonly ticketTtlMs?: number;
  readonly windowGraceMs?: number;
  readonly readyTimeoutMs?: number;
}

const BUSY: readonly DesktopPhase[] = ['STOPPING', 'STARTING', 'RESTARTING'];

export class DesktopController {
  readonly #o: DesktopControllerOptions;
  readonly #server: Server;
  readonly #now: () => number;
  readonly #watchers = new Set<ServerResponse>();
  #port = 0;
  #ticketHash: string | null = null;
  #ticketExpiresAt = 0;
  #intent: DesktopIntent = 'STOP';
  #keyHash: string | null = null;
  #wrongTickets = 0;
  #phase: DesktopPhase = 'ARMED';
  #status: HostStatus | null = null;
  #code: string | null = null;
  #ticketTimer: NodeJS.Timeout | undefined;
  #windowTimer: NodeJS.Timeout | undefined;
  #closed = false;

  constructor(options: DesktopControllerOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#server = createServer((req, res) => {
      this.#handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, code: 'UNCLASSIFIED_ERROR' }));
      });
    });
    this.#server.headersTimeout = 10_000;
    this.#server.requestTimeout = 0; // the watch stream is long-lived; every other request is bounded by its own body cap
    this.#server.maxHeadersCount = 64;
    this.#server.keepAliveTimeout = 5_000;
  }

  get port(): number {
    return this.#port;
  }

  get origin(): string {
    return `http://${LOOPBACK_HOST}:${this.#port}`;
  }

  snapshot(): DesktopSnapshot {
    const s = this.#status;
    return { phase: this.#phase, state: s?.state ?? null, reason: s?.reason ?? null, hold: s?.hold ?? null, code: this.#code, busy: BUSY.includes(this.#phase) };
  }

  /** Arms the controller with the ticket's hash (from the host, over IPC) and starts the ticket's clock. */
  arm(ticketHash: string, intent: DesktopIntent): void {
    if (!/^[0-9a-f]{64}$/.test(ticketHash)) throw new Error('DESKTOP_CONTROL_ARM_INVALID');
    this.#ticketHash = ticketHash;
    this.#intent = intent;
    const ttl = this.#o.ticketTtlMs ?? TICKET_TTL_MS;
    this.#ticketExpiresAt = this.#now() + ttl;
    this.#ticketTimer = setTimeout(() => {
      if (this.#keyHash === null) this.#exit('TICKET_EXPIRED');
    }, ttl);
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once('error', reject);
      // Loopback only, like the Founder listener: never a LAN address.
      this.#server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true }, () => {
        this.#server.off('error', reject);
        this.#port = (this.#server.address() as { port: number }).port;
        resolve();
      });
    });
  }

  #log(event: string, fields: Record<string, string | number | boolean | null> = {}): void {
    this.#o.log?.(event, fields);
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    for (const [k, v] of Object.entries(controllerHeaders())) res.setHeader(k, v);
    const method = (req.method ?? 'GET').toUpperCase();
    const gate = gateControlRequest({ method, host: req.headers.host, origin: req.headers.origin, secFetchSite: req.headers['sec-fetch-site'] as string | undefined, contentType: req.headers['content-type'] }, this.#port);
    if (!gate.ok) return this.#json(res, gate.status, { ok: false, code: gate.code });
    const url = new URL(req.url ?? '/', this.origin);
    if (method === 'GET') {
      const rel = controllerStaticPath(url.pathname);
      const file = rel === null ? null : resolveStatic(this.#o.roots, rel);
      if (file === null) return this.#json(res, 404, { ok: false, code: 'NOT_FOUND' });
      res.writeHead(200, { 'Content-Type': file.contentType, 'Content-Length': file.body.length });
      return void res.end(file.body);
    }
    const body = await readJson(req);
    if (body === null) return this.#json(res, 400, { ok: false, code: 'BODY_NOT_JSON' });
    if (url.pathname === `${DESKTOP_CONTROL_PATH}/redeem`) return this.#redeem(res, body.ticket);
    // Every other act needs the control key the redemption returned (a custom header: a cross-origin caller would need
    // a CORS preflight, which is never answered).
    if (!secretMatches(req.headers[DESKTOP_KEY_HEADER], this.#keyHash)) return this.#json(res, 403, { ok: false, code: 'CONTROL_KEY_INVALID' });
    switch (url.pathname) {
      case `${DESKTOP_CONTROL_PATH}/watch`:
        return this.#watch(res);
      case `${DESKTOP_CONTROL_PATH}/status`:
        if (!this.snapshot().busy) this.#status = await discoverHost(this.#o.workspace);
        return this.#json(res, 200, { ok: true, ...this.snapshot() });
      case `${DESKTOP_CONTROL_PATH}/act`:
        return this.#act(res, body.action);
      case `${DESKTOP_CONTROL_PATH}/enter`:
        return this.#enter(res);
      default:
        return this.#json(res, 404, { ok: false, code: 'NOT_FOUND' });
    }
  }

  #redeem(res: ServerResponse, ticket: unknown): void {
    if (this.#keyHash !== null || this.#ticketHash === null) return this.#json(res, 410, { ok: false, code: 'TICKET_SPENT' });
    if (this.#now() >= this.#ticketExpiresAt) {
      this.#json(res, 410, { ok: false, code: 'TICKET_EXPIRED' });
      return this.#exit('TICKET_EXPIRED');
    }
    if (!secretMatches(ticket, this.#ticketHash)) {
      this.#wrongTickets += 1;
      this.#log('desktop_control.ticket_refused', { attempt: this.#wrongTickets });
      this.#json(res, 403, { ok: false, code: 'TICKET_INVALID' });
      if (this.#wrongTickets >= MAX_WRONG_TICKETS) this.#exit('TICKET_GUESSING');
      return;
    }
    // Single use: the ticket is gone the moment it is redeemed.
    this.#ticketHash = null;
    if (this.#ticketTimer) clearTimeout(this.#ticketTimer);
    const key = mintSecret();
    this.#keyHash = key.hash;
    this.#log('desktop_control.redeemed', { intent: this.#intent });
    this.#json(res, 200, { ok: true, key: key.secret, intent: this.#intent });
    void (this.#intent === 'RESTART' ? this.#restart() : this.#stop());
  }

  #watch(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', Connection: 'keep-alive' });
    res.write(`${JSON.stringify(this.snapshot())}\n`);
    this.#watchers.add(res);
    if (this.#windowTimer) clearTimeout(this.#windowTimer);
    this.#windowTimer = undefined;
    // The response's own close: the request body was already read, so only the connection tells us the window left.
    res.on('close', () => {
      this.#watchers.delete(res);
      if (this.#watchers.size === 0 && !this.#closed) {
        this.#windowTimer = setTimeout(() => this.#windowGone(), this.#o.windowGraceMs ?? WINDOW_GRACE_MS);
      }
    });
  }

  #windowGone(): void {
    if (this.#watchers.size > 0) return;
    // An operation in flight finishes first (a stop is never abandoned half way); the controller then exits.
    if (this.snapshot().busy) return;
    this.#exit('WINDOW_CLOSED');
  }

  #publish(): void {
    const line = `${JSON.stringify(this.snapshot())}\n`;
    for (const w of this.#watchers) w.write(line);
    if (this.#watchers.size === 0 && !this.snapshot().busy && this.#keyHash !== null && this.#windowTimer === undefined && !this.#closed) {
      this.#windowTimer = setTimeout(() => this.#windowGone(), this.#o.windowGraceMs ?? WINDOW_GRACE_MS);
    }
  }

  #set(phase: DesktopPhase, status: HostStatus | null, code: string | null): void {
    this.#phase = phase;
    if (status !== null) this.#status = status;
    this.#code = code;
    this.#log('desktop_control.phase', { phase, state: this.#status?.state ?? null, code });
    this.#publish();
  }

  #act(res: ServerResponse, action: unknown): void {
    if (action !== 'START' && action !== 'STOP' && action !== 'RESTART') return this.#json(res, 400, { ok: false, code: 'VALIDATION_FAILED' });
    if (this.snapshot().busy || this.#phase === 'ENTERED') return this.#json(res, 409, { ok: false, code: 'CONTROL_BUSY' });
    this.#json(res, 202, { ok: true, accepted: action });
    void (action === 'START' ? this.#start('STARTING') : action === 'STOP' ? this.#stop() : this.#restart());
  }

  async #stop(): Promise<boolean> {
    this.#set('STOPPING', null, null);
    const r = await stopHost(this.#o.workspace);
    const after = await discoverHost(this.#o.workspace);
    if (r.ok) {
      this.#set('STOPPED', after, null);
      return true;
    }
    this.#set(after.state === 'HELD' ? 'HELD' : 'ERROR', after, r.outcome);
    return false;
  }

  async #start(phase: 'STARTING' | 'RESTARTING'): Promise<void> {
    this.#set(phase, null, null);
    const admitted = this.#o.admit();
    if (admitted !== 'ADMITTED') return this.#set('ERROR', await discoverHost(this.#o.workspace), 'RUNTIME_RELEASE_REFUSED');
    const r = await ensureRunning(this.#o.workspace, { cliPath: this.#o.cliPath, providers: this.#o.providers, ...(this.#o.readyTimeoutMs ? { readyTimeoutMs: this.#o.readyTimeoutMs } : {}) });
    // READY only on the canonical health: the lease holder's signed identity proof answered and the runtime is READY.
    if (r.code === null && r.status.state === 'RUNNING' && r.status.runtimeState === 'READY') return this.#set('READY', r.status, null);
    if (r.status.state === 'HELD') return this.#set('HELD', r.status, heldCode(r.status.hold));
    return this.#set('ERROR', r.status, r.code ?? 'HOST_UNHEALTHY');
  }

  async #restart(): Promise<void> {
    this.#set('RESTARTING', null, null);
    const r = await stopHost(this.#o.workspace);
    if (!r.ok && r.outcome !== 'NOT_RUNNING') {
      const after = await discoverHost(this.#o.workspace);
      return this.#set(after.state === 'HELD' ? 'HELD' : 'ERROR', after, r.outcome);
    }
    await this.#start('RESTARTING');
  }

  #enter(res: ServerResponse): void {
    const origin = this.#status?.origin ?? null;
    if (this.#phase !== 'READY' || origin === null) return this.#json(res, 409, { ok: false, code: 'NOT_READY' });
    let launchUrl: string;
    try {
      // The canonical single-use, 90-second launch token: the window re-enters through the existing /launch exchange.
      launchUrl = mintLaunchUrl(this.#o.workspace, origin).launchUrl;
    } catch {
      return this.#json(res, 503, { ok: false, code: 'LAUNCH_MINT_FAILED' });
    }
    this.#phase = 'ENTERED';
    this.#keyHash = null; // nothing more can be asked of this controller
    this.#log('desktop_control.entered', { state: 'RUNNING' });
    res.once('finish', () => this.#exit('ENTERED'));
    this.#json(res, 200, { ok: true, launchUrl });
  }

  #json(res: ServerResponse, status: number, payload: Record<string, unknown>): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }

  #exit(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#ticketTimer) clearTimeout(this.#ticketTimer);
    if (this.#windowTimer) clearTimeout(this.#windowTimer);
    this.#ticketHash = null;
    this.#keyHash = null;
    this.#log('desktop_control.exit', { reason });
    for (const w of this.#watchers) w.end();
    this.#watchers.clear();
    this.#server.close(() => this.#o.onExit?.());
    this.#server.closeAllConnections();
  }

  /** Ends the controller now (tests; the CLI's signal handlers). */
  close(): void {
    this.#exit('CLOSED');
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  try {
    const raw = Buffer.concat(chunks).toString('utf8');
    const parsed: unknown = raw.length === 0 ? {} : JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// --- one controller per workspace ---------------------------------------------------------------------------------------

const lockPath = (paths: HostPaths): string => path.join(paths.runtimeDir, DESKTOP_CONTROL_LOCK_FILE);

/** Whether a live controller holds this workspace (a crashed one's lock is stale: its PID is gone). */
export function desktopControlHeld(workspace: string): boolean {
  const file = lockPath(hostPaths(workspace));
  if (!existsSync(file)) return false;
  try {
    const held = JSON.parse(readFileSync(file, 'utf8')) as { pid?: unknown; at?: unknown };
    return typeof held.pid === 'number' && held.pid !== process.pid && pidAlive(held.pid) && typeof held.at === 'number' && Date.now() - held.at < LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/** Takes the workspace's controller lock (exclusive create; a stale lock is replaced). Returns the release, or null. */
export function acquireDesktopControl(workspace: string): (() => void) | null {
  const file = lockPath(hostPaths(workspace));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`, { flag: 'wx' });
      return () => rmSync(file, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return null;
      if (desktopControlHeld(workspace)) return null;
      rmSync(file, { force: true });
    }
  }
  return null;
}

const samePath = (a: string, b: string): boolean => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

/**
 * The existing launcher configuration, when it names THIS workspace: the controller only ever acts on the configured
 * Company (never a workspace a request names). Null when the Desktop lifecycle is not configured for it. The identity is
 * the resolved directory, never the spelling: the host runs on the canonical root, while the configuration may name the
 * same directory through an 8.3 short name (`C:\Users\RUNNER~1\…`), a junction or another letter case.
 */
export function configuredCompany(workspace: string): { workspace: string; providers: readonly string[] } | null {
  const config = readLauncherConfig(launcherConfigPath());
  if (config === null || !samePath(hostPaths(config.workspace).root, hostPaths(workspace).root)) return null;
  return { workspace: hostPaths(workspace).root, providers: config.providers };
}

// --- the host side: start and arm a controller ----------------------------------------------------------------------------

export type ArmResult = { readonly ok: true; readonly controller: string; readonly ticket: string } | { readonly ok: false; readonly code: string };

/**
 * Called by the RUNNING host for an authenticated Founder request: starts this release's controller and arms it with the
 * ticket's hash over IPC. The raw ticket is returned to the caller only (the authenticated page).
 */
export async function armDesktopController(options: { readonly workspace: string; readonly cliPath: string; readonly intent: DesktopIntent; readonly timeoutMs?: number }): Promise<ArmResult> {
  if (configuredCompany(options.workspace) === null) return { ok: false, code: 'DESKTOP_CONTROL_UNAVAILABLE' };
  if (desktopControlHeld(options.workspace)) return { ok: false, code: 'DESKTOP_CONTROL_BUSY' };
  const paths = hostPaths(options.workspace);
  const ticket = mintSecret();
  const fd = openSync(paths.log, 'a');
  let child;
  try {
    child = spawnHost(options.cliPath, ['desktop-control', '--workspace', paths.root], fd);
  } catch {
    return { ok: false, code: 'DESKTOP_CONTROL_SPAWN_FAILED' };
  } finally {
    closeSync(fd);
  }
  const result = await new Promise<ArmResult>((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'DESKTOP_CONTROL_TIMEOUT' }), options.timeoutMs ?? ARM_TIMEOUT_MS);
    const finish = (r: ArmResult): void => {
      clearTimeout(timer);
      resolve(r);
    };
    child.on('message', (m: { type?: unknown; port?: unknown; code?: unknown }) => {
      if (m?.type === 'listening' && typeof m.port === 'number' && Number.isInteger(m.port) && m.port > 0 && m.port < 65536) finish({ ok: true, controller: `http://${LOOPBACK_HOST}:${m.port}${DESKTOP_CONTROL_PATH}`, ticket: ticket.secret });
      else if (m?.type === 'failed') finish({ ok: false, code: typeof m.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(m.code) ? m.code : 'DESKTOP_CONTROL_FAILED' });
    });
    child.once('error', () => finish({ ok: false, code: 'DESKTOP_CONTROL_SPAWN_FAILED' }));
    child.once('exit', () => finish({ ok: false, code: 'DESKTOP_CONTROL_FAILED' }));
    child.once('spawn', () => child.send({ type: 'arm', ticketHash: ticket.hash, intent: options.intent }));
  });
  if (!result.ok && child.exitCode === null) child.kill();
  if (child.connected) child.disconnect();
  child.removeAllListeners();
  child.unref();
  return result;
}
