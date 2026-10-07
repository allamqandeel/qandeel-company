/**
 * The Founder launch handoff (OPS, D-OPS-07; verifier rule `founder-host-confined`): how the launcher gives the browser
 * window it opened the canonical single-use launch token WITHOUT the token ever being a process argument.
 *
 * The browser is started on `http://127.0.0.1:<random port>/` — an address that carries nothing secret. That port is
 * this one-shot loopback responder, which lives inside the launcher process for at most `HANDOFF_TIMEOUT_MS`:
 *
 *   - it answers exactly ONE request: a top-level browser navigation typed or launched by the user (`GET /`, the exact
 *     loopback Host of its own port, `Sec-Fetch-Site: none`, `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`).
 *     A web page cannot produce that request (a page's fetch, form, image or frame is never `Sec-Fetch-Site: none`), and
 *     a DNS-rebound name fails the exact Host;
 *   - only then is the token minted (the same canonical mint as `launch`: single-use, 90 seconds) and handed over as a
 *     `303 See Other` to the host's existing `/launch#<token>` page, which redeems it once and clears it from history;
 *   - it then closes. A request that does not match is refused and consumes nothing; if no browser arrives in time, no
 *     token is minted at all.
 *
 * Nothing is logged: not the request, not its headers (the browser sends its loopback cookies to every port of
 * 127.0.0.1), not the token. The Founder session boundary is unchanged: the token is the existing one, redeemed by
 * the existing exchange, under the existing origin gate and CSRF rules.
 */
import http from 'node:http';

import { LOOPBACK_HOST } from '../security.js';

/** How long the launcher waits for its browser window to arrive (it never mints before that). */
export const HANDOFF_TIMEOUT_MS = 30_000;

export type HandoffResult = 'DELIVERED' | 'TIMEOUT' | 'MINT_FAILED';

export interface LaunchHandoff {
  /** The only address the browser is given: loopback, a random port, `/` — no token, no query, no fragment. */
  readonly url: string;
  readonly result: Promise<HandoffResult>;
  close(): void;
}

const header = (req: http.IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return typeof v === 'string' ? v : undefined;
};

/** Whether a request is the user-initiated top-level navigation of a browser to exactly this responder. */
export function isBrowserNavigation(req: http.IncomingMessage, port: number): boolean {
  return (
    req.method === 'GET' &&
    req.url === '/' &&
    header(req, 'host') === `${LOOPBACK_HOST}:${port}` &&
    header(req, 'sec-fetch-site') === 'none' &&
    header(req, 'sec-fetch-mode') === 'navigate' &&
    header(req, 'sec-fetch-dest') === 'document'
  );
}

/**
 * Starts the one-shot responder. `mint` returns the canonical launch URL (`<host origin>/launch#<token>`) and is called
 * at most once, only for the matching navigation.
 */
export function serveLaunchHandoff(mint: () => string, timeoutMs = HANDOFF_TIMEOUT_MS): Promise<LaunchHandoff> {
  return new Promise((resolveStart, rejectStart) => {
    let settle: (r: HandoffResult) => void = () => undefined;
    const result = new Promise<HandoffResult>((r) => (settle = r));
    let done = false;
    const server = http.createServer({ requestTimeout: 5_000, headersTimeout: 5_000, keepAliveTimeout: 0 });
    const finish = (r: HandoffResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
      settle(r);
    };
    const timer = setTimeout(() => finish('TIMEOUT'), timeoutMs);
    timer.unref();
    server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
      const port = (server.address() as { port: number } | null)?.port ?? 0;
      const base = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', Connection: 'close' };
      if (done || !isBrowserNavigation(req, port)) {
        res.writeHead(done ? 410 : 403, { ...base, 'Content-Type': 'text/plain; charset=utf-8' }).end(done ? 'gone' : 'refused');
        return;
      }
      let location: string;
      try {
        location = mint();
      } catch {
        res.writeHead(503, { ...base, 'Content-Type': 'text/plain; charset=utf-8' }).end('unavailable');
        finish('MINT_FAILED');
        return;
      }
      res.writeHead(303, { ...base, Location: location }).end();
      res.once('finish', () => finish('DELIVERED'));
    });
    server.once('error', (error) => {
      clearTimeout(timer);
      rejectStart(error);
    });
    server.listen(0, LOOPBACK_HOST, () => {
      const port = (server.address() as { port: number }).port;
      resolveStart({ url: `http://${LOOPBACK_HOST}:${port}/`, result, close: () => finish('TIMEOUT') });
    });
  });
}
