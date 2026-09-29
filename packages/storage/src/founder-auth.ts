/**
 * The authenticated Founder surface (C5, Stage 14 D14-A / D14-C, D-C2-13 replaced in production).
 *
 * Trust chain: the Founder's own Windows user runs `founder open` against the workspace it owns → a
 * single-use launch token (its SHA-256 is stored; the value travels once, in a URL fragment) → the
 * browser redeems it once for a session (cookie value hashed at rest; a per-session CSRF secret hashed
 * at rest) → every privileged request re-verifies the session row (hash, expiry, revocation) → the
 * verified session arms the Founder chokepoint for exactly one synchronous scope.
 *
 * Nothing here trusts "local": a presented `founder:<id>` string is never authentication, a session
 * value never extends its own expiry, and every refusal is audited content-free. No secret is stored.
 */
import { randomBytes } from 'node:crypto';

import { QandeelError, assertCode, newId, sha256Hex, type Id, type Timestamp } from '@qandeel-company/domain';

import { founderSessionInternals } from './governance.js';
import { mapFounderSession, mustRow, type FounderSessionRecord } from './founder-records.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { storeContext, type CompanyStore } from './store.js';

export const LAUNCH_TOKEN_TTL_MS = 90_000;
export const SESSION_TTL_MS = 8 * 3_600_000;
export const SESSION_IDLE_MS = 2 * 3_600_000;

const TOKEN_BYTES = 32;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const hash = (value: string): string => sha256Hex(value);
const later = (at: Timestamp, ms: number): Timestamp => new Date(Date.parse(at) + ms).toISOString() as Timestamp;

/**
 * Refuses without revealing which check failed to the caller. The refusal is audited by `#write` in its own
 * transaction after this one rolled back (an audit row written before the throw would roll back with it);
 * the error's details carry only the code, the entity and its id, never the presented secret.
 */
function invalid(reason: string, details: { sessionId?: Id; entity?: 'founder_session' | 'founder_launch'; entityId?: string } = {}): never {
  throw new QandeelError('FOUNDER_SESSION_INVALID', details.entity === 'founder_launch' ? 'the launch token is not valid' : 'the Founder session is not valid', {
    reason,
    entity: details.entity ?? 'founder_session',
    entityId: details.entityId ?? details.sessionId ?? 'surface',
    ...(details.sessionId ? { sessionId: details.sessionId } : {}),
  });
}

function readSession(ctx: StoreContext, cookieValue: unknown): FounderSessionRecord {
  if (typeof cookieValue !== 'string' || !TOKEN_SHAPE.test(cookieValue)) invalid('TOKEN_SHAPE');
  const row = ctx.db.get('SELECT * FROM founder_sessions WHERE token_sha256 = ?', hash(cookieValue as string));
  if (!row) invalid('UNKNOWN_SESSION');
  const s = mapFounderSession(row);
  const now = ts(ctx);
  if (s.revokedAt !== null) invalid('REVOKED', { sessionId: s.id });
  if (s.expiresAt <= now) invalid('EXPIRED', { sessionId: s.id });
  if (later(s.lastSeenAt, SESSION_IDLE_MS) <= now) invalid('IDLE_TIMEOUT', { sessionId: s.id });
  if (!ctx.db.get(`SELECT 1 AS ok FROM principals WHERE ref = ? AND kind = 'FOUNDER' AND status = 'ACTIVE'`, s.founderRef)) invalid('FOUNDER_PRINCIPAL_MISSING', { sessionId: s.id });
  return s;
}

/** A verified session handle. Opaque outside this module: only the id, principal and expiry are readable. */
export interface FounderSession {
  readonly id: Id;
  readonly founderRef: string;
  readonly expiresAt: Timestamp;
}

const VERIFIED = new WeakSet<FounderSession>();

export class FounderAuthStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): FounderAuthStore {
    return new FounderAuthStore(store);
  }

  /** One write transaction; a typed refusal is audited in its own transaction after the first rolled back. */
  #write<T>(operation: string, fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    try {
      return ctx.db.immediate(operation, () => fn(ctx));
    } catch (error) {
      if (error instanceof QandeelError && error.code === 'FOUNDER_SESSION_INVALID') this.#auditRefusal(error);
      throw error;
    }
  }

  /** Content-free refusal audit (code, entity, id): the presented secret is never part of the error or the row. */
  #auditRefusal(error: QandeelError): void {
    const d = error.details;
    const entity = d.entity === 'founder_launch' ? 'founder_launch' : 'founder_session';
    const entityId = typeof d.entityId === 'string' ? d.entityId.slice(0, 36) : 'surface';
    const reason = typeof d.reason === 'string' ? d.reason.slice(0, 64) : 'REFUSED';
    const details = typeof d.sessionId === 'string' ? { sessionId: d.sessionId } : {};
    try {
      const ctx = storeContext(this.#store);
      ctx.db.immediate('audit refused founder request', () => appendAudit(ctx, entity === 'founder_launch' ? 'founder.launch_refused' : 'founder.request_refused', entity, entityId, {}, 'REJECTED', reason, details));
    } catch {
      // Auditing a refusal never masks the refusal itself.
    }
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  /**
   * Mints a single-use launch token. Callable only by a process that can write the workspace (the
   * Founder's Windows user): that file-system boundary, not this method, is the trust anchor.
   */
  mintLaunchToken(): { token: string; launchId: Id; expiresAt: Timestamp } {
    return this.#write('mint launch token', (ctx) => {
      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      const id = newId();
      const at = ts(ctx);
      const expiresAt = later(at, LAUNCH_TOKEN_TTL_MS);
      ctx.db.run('INSERT INTO founder_launch_tokens (id, token_sha256, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, NULL)', id, hash(token), at, expiresAt);
      appendAudit(ctx, 'founder.launch_minted', 'founder_launch', id, {}, 'OK', null, {});
      return { token, launchId: id, expiresAt };
    });
  }

  /**
   * Redeems a launch token once for a session. The first redemption of a workspace registers the Founder
   * principal (Strong v1 has one human principal, the workspace owner); nothing here activates anyone.
   */
  redeemLaunchToken(token: unknown): { session: FounderSession; cookieValue: string; csrf: string; record: FounderSessionRecord } {
    return this.#write('redeem launch token', (ctx) => {
      if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) invalid('TOKEN_SHAPE', { entity: 'founder_launch', entityId: 'unknown' });
      const row = ctx.db.get<{ id: string; expires_at: string; consumed_at: string | null }>('SELECT id, expires_at, consumed_at FROM founder_launch_tokens WHERE token_sha256 = ?', hash(token));
      const at = ts(ctx);
      const reason = !row ? 'UNKNOWN_TOKEN' : row.consumed_at !== null ? 'TOKEN_CONSUMED' : row.expires_at <= at ? 'TOKEN_EXPIRED' : null;
      if (!row || reason !== null) invalid(reason ?? 'UNKNOWN_TOKEN', { entity: 'founder_launch', entityId: row?.id ?? 'unknown' });
      const launch = row;
      ctx.db.run('UPDATE founder_launch_tokens SET consumed_at = ? WHERE id = ?', at, launch.id);
      let founderRef = ctx.db.get<{ ref: string }>(`SELECT ref FROM principals WHERE kind = 'FOUNDER' AND status = 'ACTIVE'`)?.ref ?? null;
      if (founderRef === null) {
        const pid = newId();
        founderRef = `founder:${pid}`;
        ctx.db.run(`INSERT INTO principals (id, ref, kind, employee_id, status, created_at) VALUES (?, ?, 'FOUNDER', NULL, 'ACTIVE', ?)`, pid, founderRef, at);
        appendAudit(ctx, 'principal.founder_registered', 'principal', pid, { actorRef: founderRef }, 'OK', 'LAUNCH_TOKEN', { launchId: launch.id });
      }
      const cookieValue = randomBytes(TOKEN_BYTES).toString('base64url');
      const csrf = randomBytes(TOKEN_BYTES).toString('base64url');
      const id = newId();
      const expiresAt = later(at, SESSION_TTL_MS);
      ctx.db.run(
        'INSERT INTO founder_sessions (id, token_sha256, csrf_sha256, founder_ref, launch_id, created_at, expires_at, last_seen_at, revoked_at, revoke_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)',
        id, hash(cookieValue), hash(csrf), founderRef, launch.id, at, expiresAt, at,
      );
      appendAudit(ctx, 'founder.session_issued', 'founder_session', id, { actorRef: founderRef }, 'OK', null, { launchId: launch.id });
      const session: FounderSession = Object.freeze({ id: id as Id, founderRef, expiresAt });
      VERIFIED.add(session);
      return { session, cookieValue, csrf, record: mapFounderSession(mustRow(ctx.db.get('SELECT * FROM founder_sessions WHERE id = ?', id), 'session')) };
    });
  }

  /**
   * Verifies the cookie (and, for a state change, the CSRF secret) against the durable row and touches
   * `last_seen_at`. Fails closed with FOUNDER_SESSION_INVALID; the reason is audited, not returned.
   */
  verifySession(cookieValue: unknown, csrf?: unknown): FounderSession {
    return this.#write('verify founder session', (ctx) => {
      const s = readSession(ctx, cookieValue);
      if (csrf !== undefined) {
        if (typeof csrf !== 'string' || !TOKEN_SHAPE.test(csrf)) invalid('CSRF_SHAPE', { sessionId: s.id });
        const row = ctx.db.get<{ csrf_sha256: string }>('SELECT csrf_sha256 FROM founder_sessions WHERE id = ?', s.id);
        if (row?.csrf_sha256 !== hash(csrf as string)) invalid('CSRF_MISMATCH', { sessionId: s.id });
      }
      ctx.db.run('UPDATE founder_sessions SET last_seen_at = ? WHERE id = ?', ts(ctx), s.id);
      const session: FounderSession = Object.freeze({ id: s.id, founderRef: s.founderRef, expiresAt: s.expiresAt });
      VERIFIED.add(session);
      return session;
    });
  }

  revokeSession(sessionId: string, reasonCode: string): FounderSessionRecord {
    return this.#write('revoke founder session', (ctx) => {
      const reason = assertCode(reasonCode, 'reasonCode');
      const row = ctx.db.get('SELECT * FROM founder_sessions WHERE id = ?', sessionId);
      if (!row) throw new QandeelError('NOT_FOUND', 'session not found', { sessionId: String(sessionId).slice(0, 36) });
      const s = mapFounderSession(row);
      if (s.revokedAt === null) {
        ctx.db.run('UPDATE founder_sessions SET revoked_at = ?, revoke_reason = ? WHERE id = ?', ts(ctx), reason, s.id);
        appendAudit(ctx, 'founder.session_revoked', 'founder_session', s.id, { actorRef: s.founderRef }, 'OK', reason, {});
      }
      return mapFounderSession(mustRow(ctx.db.get('SELECT * FROM founder_sessions WHERE id = ?', s.id), 'session'));
    });
  }

  /** Revokes every live session (server stop, security intervention). Returns the count revoked. */
  revokeAll(reasonCode: string): number {
    return this.#write('revoke all founder sessions', (ctx) => {
      const reason = assertCode(reasonCode, 'reasonCode');
      const at = ts(ctx);
      const live = ctx.db.all<{ id: string; founder_ref: string }>('SELECT id, founder_ref FROM founder_sessions WHERE revoked_at IS NULL');
      for (const s of live) {
        ctx.db.run('UPDATE founder_sessions SET revoked_at = ?, revoke_reason = ? WHERE id = ?', at, reason, s.id);
        appendAudit(ctx, 'founder.session_revoked', 'founder_session', s.id, { actorRef: s.founder_ref }, 'OK', reason, {});
      }
      return live.length;
    });
  }

  sessions(): FounderSessionRecord[] {
    return this.#read((ctx) => ctx.db.all('SELECT * FROM founder_sessions ORDER BY created_at, id').map(mapFounderSession));
  }

  /**
   * Runs `fn` with Founder authority: the session is re-verified against its row first (a stale handle
   * fails closed), then the chokepoint is armed for the synchronous extent of `fn` only.
   */
  withSession<T>(session: FounderSession, fn: (founderRef: string) => T): T {
    if (!VERIFIED.has(session)) throw new QandeelError('FOUNDER_SESSION_INVALID', 'not a verified session handle', { reason: 'UNVERIFIED_HANDLE' });
    const fresh = this.#write('recheck founder session', (ctx) => {
      const row = ctx.db.get('SELECT * FROM founder_sessions WHERE id = ?', session.id);
      if (!row) invalid('UNKNOWN_SESSION');
      const s = mapFounderSession(row);
      const now = ts(ctx);
      if (s.revokedAt !== null) invalid('REVOKED', { sessionId: s.id });
      if (s.expiresAt <= now) invalid('EXPIRED', { sessionId: s.id });
      if (s.founderRef !== session.founderRef) invalid('PRINCIPAL_MISMATCH', { sessionId: s.id });
      return s;
    });
    return founderSessionInternals.scope(this.#store.workspace.root, () => fn(fresh.founderRef));
  }
}
