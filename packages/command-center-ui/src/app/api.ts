/**
 * Same-origin API client. Every state change carries the CSRF header (double submit with the readable
 * CSRF cookie; the session cookie itself is HttpOnly). A 401 means the session is gone: the app locks.
 */
const CSRF_HEADER = 'x-qandeel-founder-csrf';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details: Record<string, unknown> = {}) {
    super(`${code} (${status})`);
  }
}

function csrfCookie(): string {
  const m = /(?:^|;\s*)qandeel_csrf=([A-Za-z0-9_-]+)/.exec(document.cookie);
  return m?.[1] ?? '';
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    headers[CSRF_HEADER] = csrfCookie();
  }
  const init: RequestInit = { method, headers, credentials: 'same-origin', cache: 'no-store' };
  if (method === 'POST') init.body = JSON.stringify(body ?? {});
  const res = await fetch(path, init);
  const json = (await res.json().catch(() => ({ ok: false, code: 'BAD_JSON' }))) as { ok: boolean; code?: string; details?: Record<string, unknown> } & T;
  if (!res.ok || !json.ok) throw new ApiError(res.status, json.code ?? 'UNKNOWN', json.details ?? {});
  return json;
}

export const api = {
  get: <T>(path: string): Promise<T> => call<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => call<T>('POST', path, body),
};

/** Server-Sent "changed" nudges (content-free). Reconnects with backoff; never polls the API. */
export function subscribeChanges(onChange: () => void, onState: (state: 'open' | 'closed') => void): () => void {
  let source: EventSource | null = null;
  let closed = false;
  let attempt = 0;
  const connect = (): void => {
    if (closed) return;
    source = new EventSource('/api/events');
    source.addEventListener('changed', () => {
      attempt = 0;
      onChange();
    });
    source.onopen = () => {
      attempt = 0;
      onState('open');
    };
    source.onerror = () => {
      onState('closed');
      source?.close();
      source = null;
      attempt = Math.min(attempt + 1, 6);
      setTimeout(connect, 500 * 2 ** attempt);
    };
  };
  connect();
  return () => {
    closed = true;
    source?.close();
  };
}
