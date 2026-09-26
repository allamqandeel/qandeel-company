/**
 * Runtime Supervisor lease, runtime instance records and outbox delivery metadata.
 *
 * The supervisor lease is a durable singleton with a monotonically increasing fencing token.
 * Process existence proves nothing: a supervisor is authoritative only while its lease row names
 * it, carries its token and has not expired. A second supervisor cannot silently take over a live
 * lease; it can take over only after expiry, and the takeover bumps the token.
 */
import { QandeelError, toTimestamp, type Id, type Timestamp } from '@qandeel-company/domain';

import { appendAudit, mapAudit, mapEvent, ts, type StoreContext } from './internal.js';
import type { AuditRecord, EventRecord, SupervisorFence } from './records.js';

export interface SupervisorLease {
  readonly holderId: Id;
  readonly fencingToken: number;
  readonly acquiredAt: Timestamp;
  readonly renewedAt: Timestamp;
  readonly expiresAt: Timestamp;
}

export function readSupervisorLease(ctx: StoreContext): SupervisorLease | null {
  const r = ctx.db.get<{ holder_id: string; fencing_token: number; acquired_at: string; renewed_at: string; expires_at: string }>(
    `SELECT holder_id, fencing_token, acquired_at, renewed_at, expires_at FROM runtime_leases WHERE name = 'supervisor'`,
  );
  return r
    ? { holderId: r.holder_id as Id, fencingToken: Number(r.fencing_token), acquiredAt: r.acquired_at as Timestamp, renewedAt: r.renewed_at as Timestamp, expiresAt: r.expires_at as Timestamp }
    : null;
}

export function txAcquireSupervisor(ctx: StoreContext, holderId: Id, ttlMs: number): SupervisorFence {
  const at = ts(ctx);
  const expires = toTimestamp(ctx.clock.nowMs() + ttlMs);
  const current = readSupervisorLease(ctx);
  if (current === null) {
    ctx.db.run(`INSERT INTO runtime_leases (name, holder_id, fencing_token, acquired_at, renewed_at, expires_at) VALUES ('supervisor', ?, 1, ?, ?, ?)`, holderId, at, at, expires);
    appendAudit(ctx, 'supervisor.acquired', 'runtime', holderId, {}, 'OK', null, { fencingToken: 1 });
    return { holderId, fencingToken: 1 };
  }
  if (current.holderId !== holderId && current.expiresAt > at) {
    // The refusal is audited by the caller in its own transaction (this one rolls back).
    throw new QandeelError('LEASE_HELD', 'another runtime supervisor holds a live lease', { holderId: current.holderId, expiresAt: current.expiresAt });
  }
  const token = current.fencingToken + 1;
  ctx.db.run(`UPDATE runtime_leases SET holder_id = ?, fencing_token = ?, acquired_at = ?, renewed_at = ?, expires_at = ? WHERE name = 'supervisor' AND fencing_token = ?`, holderId, token, at, at, expires, current.fencingToken);
  appendAudit(ctx, 'supervisor.acquired', 'runtime', holderId, {}, 'OK', current.holderId === holderId ? 'REACQUIRED' : 'TAKEOVER_AFTER_EXPIRY', { fencingToken: token, previousHolder: current.holderId });
  return { holderId, fencingToken: token };
}

/** Renews the lease; fails (SUPERVISOR_NOT_AUTHORITATIVE) if it was lost or expired. */
export function txRenewSupervisor(ctx: StoreContext, fence: SupervisorFence, ttlMs: number): Timestamp {
  const at = ts(ctx);
  const expires = toTimestamp(ctx.clock.nowMs() + ttlMs);
  // Token-conditional: the lease is renewed while the row still names this holder and token.
  // After a host sleep the lease may have expired; if no other supervisor took over meanwhile
  // (holder and token unchanged — a takeover always bumps the token), authority is unbroken and
  // the renewal is safe. Worker claims that expired during the sleep are still fenced by their own
  // job leases and recovered by the dispatcher.
  const current = readSupervisorLease(ctx);
  const changed = ctx.db.run(
    `UPDATE runtime_leases SET renewed_at = ?, expires_at = ? WHERE name = 'supervisor' AND holder_id = ? AND fencing_token = ?`,
    at,
    expires,
    fence.holderId,
    fence.fencingToken,
  ).changes;
  if (changed !== 1) throw new QandeelError('SUPERVISOR_NOT_AUTHORITATIVE', 'supervisor lease was taken over', { holderId: fence.holderId, fencingToken: fence.fencingToken });
  if (current && current.expiresAt <= at) {
    appendAudit(ctx, 'supervisor.renewed_after_expiry', 'runtime', fence.holderId, {}, 'OK', 'NO_TAKEOVER', { fencingToken: fence.fencingToken, expiredAt: current.expiresAt });
  }
  return expires;
}

export function txReleaseSupervisor(ctx: StoreContext, fence: SupervisorFence): boolean {
  const at = ts(ctx);
  const changed = ctx.db.run(`UPDATE runtime_leases SET expires_at = ?, renewed_at = ? WHERE name = 'supervisor' AND holder_id = ? AND fencing_token = ? AND expires_at > ?`, at, at, fence.holderId, fence.fencingToken, at).changes;
  if (changed === 1) appendAudit(ctx, 'supervisor.released', 'runtime', fence.holderId, {}, 'OK', null, { fencingToken: fence.fencingToken });
  return changed === 1;
}

export type InstanceState = 'STARTING' | 'RECOVERING' | 'READY' | 'STOPPING' | 'STOPPED' | 'FAILED' | 'ABANDONED';

export interface RuntimeInstanceRecord {
  readonly id: Id;
  readonly pid: number;
  readonly runtimeVersion: string;
  readonly schemaVersion: number;
  readonly state: InstanceState;
  readonly supervisorToken: number | null;
  readonly recovery: Record<string, unknown>;
  readonly startedAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly stoppedAt: Timestamp | null;
}

export function txRegisterInstance(ctx: StoreContext, id: Id, pid: number, runtimeVersion: string, schemaVersion: number): void {
  const at = ts(ctx);
  ctx.db.run(`INSERT INTO runtime_instances (id, pid, runtime_version, schema_version, state, started_at, updated_at) VALUES (?, ?, ?, ?, 'STARTING', ?, ?)`, id, pid, runtimeVersion, schemaVersion, at, at);
}

export function txUpdateInstance(ctx: StoreContext, id: Id, state: InstanceState, fields: { supervisorToken?: number; recovery?: Record<string, number | string | boolean | null> } = {}): void {
  const at = ts(ctx);
  const terminal = state === 'STOPPED' || state === 'FAILED' || state === 'ABANDONED';
  ctx.db.run(
    `UPDATE runtime_instances SET state = ?, updated_at = ?, supervisor_token = COALESCE(?, supervisor_token),
            recovery_json = COALESCE(?, recovery_json), stopped_at = CASE WHEN ? THEN ? ELSE stopped_at END WHERE id = ?`,
    state,
    at,
    fields.supervisorToken ?? null,
    fields.recovery === undefined ? null : JSON.stringify(fields.recovery),
    terminal ? 1 : 0,
    at,
    id,
  );
}

/** Marks earlier instances that never recorded a clean stop as ABANDONED (they lost their lease). */
export function txAbandonStaleInstances(ctx: StoreContext, currentId: Id): number {
  const at = ts(ctx);
  return ctx.db.run(`UPDATE runtime_instances SET state = 'ABANDONED', updated_at = ?, stopped_at = ? WHERE id <> ? AND state NOT IN ('STOPPED', 'FAILED', 'ABANDONED')`, at, at, currentId).changes;
}

export function readInstance(ctx: StoreContext, id: Id): RuntimeInstanceRecord | null {
  const r = ctx.db.get('SELECT * FROM runtime_instances WHERE id = ?', id);
  if (!r) return null;
  return {
    id: String(r.id) as Id,
    pid: Number(r.pid),
    runtimeVersion: String(r.runtime_version),
    schemaVersion: Number(r.schema_version),
    state: String(r.state) as InstanceState,
    supervisorToken: r.supervisor_token === null ? null : Number(r.supervisor_token),
    recovery: JSON.parse(String(r.recovery_json)) as Record<string, unknown>,
    startedAt: String(r.started_at) as Timestamp,
    updatedAt: String(r.updated_at) as Timestamp,
    stoppedAt: r.stopped_at === null ? null : (String(r.stopped_at) as Timestamp),
  };
}

// ---------------------------------------------------------------------------------------------
// Outbox delivery and audit reads

export function pendingEvents(ctx: StoreContext, limit: number): EventRecord[] {
  return ctx.db.all('SELECT * FROM events WHERE dispatched_at IS NULL ORDER BY seq LIMIT ?', limit).map(mapEvent);
}

export function txMarkDispatched(ctx: StoreContext, ids: readonly Id[]): number {
  const at = ts(ctx);
  let n = 0;
  for (const id of ids) n += ctx.db.run('UPDATE events SET dispatched_at = ?, dispatch_count = dispatch_count + 1 WHERE id = ? AND dispatched_at IS NULL', at, id).changes;
  return n;
}

export function eventsFor(ctx: StoreContext, aggregateId: Id): EventRecord[] {
  return ctx.db.all('SELECT * FROM events WHERE aggregate_id = ? ORDER BY seq LIMIT 1000', aggregateId).map(mapEvent);
}

export function auditFor(ctx: StoreContext, entityId: string): AuditRecord[] {
  return ctx.db.all('SELECT * FROM audit_events WHERE entity_id = ? ORDER BY id LIMIT 1000', entityId).map(mapAudit);
}

export function auditByAction(ctx: StoreContext, action: string, limit = 1000): AuditRecord[] {
  return ctx.db.all('SELECT * FROM audit_events WHERE action = ? ORDER BY id LIMIT ?', action, limit).map(mapAudit);
}
