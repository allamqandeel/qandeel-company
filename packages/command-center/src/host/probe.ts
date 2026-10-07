/**
 * The launcher's loopback client (OPS, D-OPS-03; verifier rule `founder-host-confined`): the only network path the host
 * lifecycle opens, and only to 127.0.0.1 on the port a host descriptor names. It reaches exactly the two host-control
 * routes (`/host/identity`, `/host/stop`), never a Founder `/api` route: discovery and controlled stop need no Founder
 * session and carry none. Bounded: 3-second timeout, 16 KiB response cap, no redirects, no keep-alive.
 */
import http from 'node:http';

import { LOOPBACK_HOST } from '../security.js';
import { HOST_IDENTITY_PATH, HOST_STOP_PATH } from './descriptor.js';

const TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 16 * 1024;

export interface ProbeResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

function request(port: number, method: 'GET' | 'POST', pathname: typeof HOST_IDENTITY_PATH | typeof HOST_STOP_PATH, query: string, body?: Record<string, unknown>): Promise<ProbeResponse | null> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = { Connection: 'close', Accept: 'application/json' };
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(payload));
    headers.Origin = `http://${LOOPBACK_HOST}:${port}`; // the surface's exact-origin gate applies to every state change
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: ProbeResponse | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = http.request({ host: LOOPBACK_HOST, port, method, path: `${pathname}${query}`, headers, timeout: TIMEOUT_MS, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy();
          done(null);
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          parsed = {};
        }
        done({ status: res.statusCode ?? 0, body: typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {} });
      });
      res.on('error', () => done(null));
    });
    req.on('timeout', () => {
      req.destroy();
      done(null);
    });
    req.on('error', () => done(null));
    req.end(payload);
  });
}

/** Asks whatever listens on the port to prove it is the host (null: nothing answered, or not in time). */
export function probeIdentity(port: number, nonce: string): Promise<ProbeResponse | null> {
  return request(port, 'GET', HOST_IDENTITY_PATH, `?nonce=${nonce}`);
}

/** Delivers a controlled-stop request whose one-shot proof the launcher left in the workspace. */
export function requestHostStop(port: number, requestId: string): Promise<ProbeResponse | null> {
  return request(port, 'POST', HOST_STOP_PATH, '', { requestId });
}
