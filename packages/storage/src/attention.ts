/**
 * AttentionStore — Founder Attention (C5, Stage 9 §16, §25–§29, Stage 2 §7).
 *
 * Attention is derived from canonical sources and kept as durable dedup / cooldown / resolution state:
 * one item per source (a pending approval, a recommended staffing request, an escalated handoff, an open
 * review conflict, a CEO brief, a Founder-participant thread waiting on the Founder). Items carry IDs and
 * codes only; the Founder reads the source itself. Routine events (a completed task, an FYI) never enter.
 * Silence is never approval: an item stays OPEN until its source is resolved or the Founder dismisses it.
 *
 * `sync` is deterministic and idempotent; the surface calls it after a durable change signal, never on a
 * timer.
 */
import { QandeelError, assertCode, assertId, newId, type Timestamp } from '@qandeel-company/domain';
import { warrantsFounderAttention, type AttentionLane, type AttentionLevel, type MessagePurpose } from '@qandeel-company/governance';

import { founder, founderAdminWrite } from './governance.js';
import { mapAttentionItem, mustRow, type AttentionItemRecord } from './founder-records.js';
import { appendAudit, ts, type StoreContext } from './internal.js';
import { txResilienceStatus } from './resilience.js';
import { storeContext, type CompanyStore } from './store.js';

/** Repeated signals about the same open item re-notify at most once per cooldown (Stage 9 §28). */
export const ATTENTION_COOLDOWN_MS = 4 * 3_600_000;

interface Signal {
  readonly dedupKey: string;
  readonly lane: AttentionLane;
  readonly level: AttentionLevel;
  readonly sourceKind: AttentionItemRecord['sourceKind'];
  readonly sourceRef: string;
  readonly ownerRef: string | null;
  /** The source's last material change: a newer one than the item's last signal counts as a new signal. */
  readonly changedAt: Timestamp;
}

const later = (at: Timestamp, ms: number): Timestamp => new Date(Date.parse(at) + ms).toISOString() as Timestamp;

/** Every source that warrants Founder attention right now (pure read; the order is stable). */
export function collectSignals(ctx: StoreContext): Signal[] {
  const out: Signal[] = [];
  // R3 Founder approvals waiting (R4 is never approvable and never asked for: it is a Founder-only sovereignty).
  for (const a of ctx.db.all<{ id: string; risk_level: string; subject_ref: string; updated_at: string }>(`SELECT id, risk_level, subject_ref, updated_at FROM approvals WHERE state = 'PENDING' AND risk_level IN ('R1', 'R3') ORDER BY created_at, id`)) {
    out.push({ dedupKey: `approval:${a.id}`, lane: 'NEEDS_ME', level: 'NEEDS_DECISION', sourceKind: 'APPROVAL', sourceRef: `approval:${a.id}`, ownerRef: a.subject_ref, changedAt: a.updated_at as Timestamp });
  }
  for (const s of ctx.db.all<{ id: string; updated_at: string; requested_by_employee_id: string }>(`SELECT id, updated_at, requested_by_employee_id FROM staffing_requests WHERE state = 'RECOMMENDED' ORDER BY created_at, id`)) {
    out.push({ dedupKey: `staffing:${s.id}`, lane: 'NEEDS_ME', level: 'NEEDS_DECISION', sourceKind: 'STAFFING_REQUEST', sourceRef: `staffing_request:${s.id}`, ownerRef: `employee:${s.requested_by_employee_id}`, changedAt: s.updated_at as Timestamp });
  }
  for (const d of ctx.db.all<{ id: string; updated_at: string; delegator_employee_id: string }>(`SELECT id, updated_at, delegator_employee_id FROM work_delegations WHERE state = 'ESCALATED' ORDER BY created_at, id`)) {
    out.push({ dedupKey: `escalation:${d.id}`, lane: 'NEEDS_ME', level: 'URGENT', sourceKind: 'ESCALATION', sourceRef: `work_delegation:${d.id}`, ownerRef: `employee:${d.delegator_employee_id}`, changedAt: d.updated_at as Timestamp });
  }
  for (const c of ctx.db.all<{ id: string; created_at: string }>(`SELECT id, created_at FROM review_conflicts WHERE state = 'OPEN' ORDER BY created_at, id`)) {
    out.push({ dedupKey: `conflict:${c.id}`, lane: 'NEEDS_ME', level: 'NEEDS_DECISION', sourceKind: 'REVIEW_CONFLICT', sourceRef: `review_conflict:${c.id}`, ownerRef: null, changedAt: c.created_at as Timestamp });
  }
  for (const g of ctx.db.all<{ id: string; updated_at: string; owner_ref: string }>(`SELECT id, updated_at, owner_ref FROM goals WHERE kind = 'COMPANY' AND state = 'PROPOSED' ORDER BY created_at, id`)) {
    out.push({ dedupKey: `goal:${g.id}`, lane: 'NEEDS_ME', level: 'NEEDS_DECISION', sourceKind: 'GOAL', sourceRef: `goal:${g.id}`, ownerRef: g.owner_ref, changedAt: g.updated_at as Timestamp });
  }
  // Employee messages the Founder has not answered yet: briefs to CEO_BRIEFS; decision requests / escalations
  // / blockers to NEEDS_ME; a thread whose latest employee message merely needs attention to THREADS.
  const latest = ctx.db.all<{ id: string; thread_id: string; purpose: string; attention_level: string; sender_ref: string; created_at: string; seq: number }>(
    `SELECT m.id, m.thread_id, m.purpose, m.attention_level, m.sender_ref, m.created_at, m.seq FROM communication_messages m
      JOIN communication_threads t ON t.id = m.thread_id
     WHERE t.state = 'OPEN' AND m.sender_kind = 'EMPLOYEE' AND m.superseded_by IS NULL
       AND m.seq = (SELECT MAX(seq) FROM communication_messages x WHERE x.thread_id = m.thread_id)
     ORDER BY m.created_at, m.id`,
  );
  for (const m of latest) {
    const purpose = m.purpose as MessagePurpose;
    const level = m.attention_level as AttentionLevel;
    if (purpose === 'BRIEF') {
      out.push({ dedupKey: `brief:${m.id}`, lane: 'CEO_BRIEFS', level, sourceKind: 'BRIEF', sourceRef: `message:${m.id}`, ownerRef: m.sender_ref, changedAt: m.created_at as Timestamp });
      continue;
    }
    if (purpose === 'DECISION_REQUEST' || purpose === 'ESCALATION' || purpose === 'BLOCKER') {
      out.push({ dedupKey: `decision:${m.id}`, lane: 'NEEDS_ME', level: level === 'INFORMATIONAL' ? 'NEEDS_DECISION' : level, sourceKind: 'DECISION_REQUEST', sourceRef: `message:${m.id}`, ownerRef: m.sender_ref, changedAt: m.created_at as Timestamp });
      continue;
    }
    if (warrantsFounderAttention(purpose, level)) out.push({ dedupKey: `thread:${m.thread_id}`, lane: 'THREADS', level, sourceKind: 'THREAD', sourceRef: `thread:${m.thread_id}`, ownerRef: m.sender_ref, changedAt: m.created_at as Timestamp });
  }
  // C6: only MATERIAL improvement / recovery exceptions become attention — a systemic finding awaiting the
  // Founder's decision, a failed restore drill, an off-device backup that is missing its failure domain or its
  // objective, a rolled-back update. Routine evaluations, reports and lessons never enter.
  for (const f of ctx.db.all<{ id: string; updated_at: string }>(`SELECT id, updated_at FROM systemic_findings WHERE state = 'CANDIDATE' ORDER BY created_at, id`)) {
    out.push({ dedupKey: `systemic:${f.id}`, lane: 'NEEDS_ME', level: 'NEEDS_DECISION', sourceKind: 'DECISION_REQUEST', sourceRef: `systemic_finding:${f.id}`, ownerRef: null, changedAt: f.updated_at as Timestamp });
  }
  const resilience = txResilienceStatus(ctx, ts(ctx));
  for (const x of resilience.exceptions.filter((e) => e.material)) {
    out.push({ dedupKey: `resilience:${x.code}`, lane: 'NEEDS_ME', level: 'NEEDS_ATTENTION', sourceKind: 'DECISION_REQUEST', sourceRef: x.ref, ownerRef: null, changedAt: x.at as Timestamp });
  }
  return out;
}

export interface AttentionSyncReport {
  readonly opened: number;
  readonly signalled: number;
  readonly resolved: number;
  readonly open: number;
}

/** Reconciles durable attention state with the sources (idempotent; content-free audit of the deltas). */
export function txSyncAttention(ctx: StoreContext, actorRef: string): AttentionSyncReport {
  const now = ts(ctx);
  const signals = collectSignals(ctx);
  const live = new Set(signals.map((s) => s.dedupKey));
  let opened = 0;
  let signalled = 0;
  let resolved = 0;
  for (const s of signals) {
    const row = ctx.db.get('SELECT * FROM founder_attention_items WHERE dedup_key = ?', s.dedupKey);
    if (!row) {
      ctx.db.run(
        `INSERT INTO founder_attention_items (id, dedup_key, lane, level, source_kind, source_ref, owner_ref, state, first_seen_at, last_signal_at, signal_count, cooldown_until, resolved_at, resolved_reason, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, 1, ?, NULL, NULL, 1)`,
        newId(), s.dedupKey, s.lane, s.level, s.sourceKind, s.sourceRef, s.ownerRef, now, now, later(now, ATTENTION_COOLDOWN_MS),
      );
      opened++;
      continue;
    }
    const item = mapAttentionItem(row);
    if (item.state === 'DISMISSED') continue; // the Founder's dismissal stands until the source resolves
    if (item.state === 'RESOLVED') {
      // The source came back (a re-request, a reopened conflict): it is a new signal on the same key.
      ctx.db.run(`UPDATE founder_attention_items SET state = 'OPEN', level = ?, resolved_at = NULL, resolved_reason = NULL, last_signal_at = ?, signal_count = signal_count + 1, cooldown_until = ?, version = version + 1 WHERE id = ?`, s.level, now, later(now, ATTENTION_COOLDOWN_MS), item.id);
      opened++;
      continue;
    }
    const newSignal = s.changedAt > item.lastSignalAt && (item.cooldownUntil === null || item.cooldownUntil <= now);
    if (newSignal || s.level !== item.level) {
      ctx.db.run(`UPDATE founder_attention_items SET level = ?, last_signal_at = ?, signal_count = signal_count + ?, cooldown_until = ?, version = version + 1 WHERE id = ?`, s.level, newSignal ? now : item.lastSignalAt, newSignal ? 1 : 0, newSignal ? later(now, ATTENTION_COOLDOWN_MS) : item.cooldownUntil, item.id);
      if (newSignal) signalled++;
    }
  }
  for (const row of ctx.db.all(`SELECT * FROM founder_attention_items WHERE state IN ('OPEN', 'DISMISSED')`)) {
    const item = mapAttentionItem(row);
    if (live.has(item.dedupKey)) continue;
    ctx.db.run(`UPDATE founder_attention_items SET state = 'RESOLVED', resolved_at = ?, resolved_reason = 'SOURCE_RESOLVED', version = version + 1 WHERE id = ?`, now, item.id);
    resolved++;
  }
  if (opened + signalled + resolved > 0) appendAudit(ctx, 'founder.attention_synced', 'founder_attention', 'lanes', { actorRef }, 'OK', null, { opened, signalled, resolved });
  const open = Number(ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM founder_attention_items WHERE state = 'OPEN'`)?.n ?? 0);
  return { opened, signalled, resolved, open };
}

export class AttentionStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): AttentionStore {
    return new AttentionStore(store);
  }

  #write<T>(operation: string, fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.immediate(operation, () => fn(ctx));
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  /** Runtime / surface reconciliation (no Founder authority needed: it changes attention, not truth). */
  sync(actorRef = 'system:founder-surface'): AttentionSyncReport {
    return this.#write('sync founder attention', (ctx) => txSyncAttention(ctx, actorRef));
  }

  /** The Founder dismisses an item (the source stays what it is; silence is never approval). */
  dismiss(actorRef: string, itemId: string, reasonCode: string): AttentionItemRecord {
    return founderAdminWrite(this.#store, 'dismiss attention item', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'founder attention');
      const id = assertId(itemId, 'itemId');
      const row = ctx.db.get('SELECT * FROM founder_attention_items WHERE id = ?', id);
      if (!row) throw new QandeelError('NOT_FOUND', 'attention item not found', { itemId: id });
      const item = mapAttentionItem(row);
      if (item.state !== 'OPEN') return item;
      const reason = assertCode(reasonCode, 'reasonCode');
      ctx.db.run(`UPDATE founder_attention_items SET state = 'DISMISSED', resolved_at = ?, resolved_reason = ?, version = version + 1 WHERE id = ?`, ts(ctx), reason, id);
      appendAudit(ctx, 'founder.attention_dismissed', 'founder_attention', id, { actorRef: p.ref }, 'OK', reason, { lane: item.lane, sourceKind: item.sourceKind });
      return mapAttentionItem(mustRow(ctx.db.get('SELECT * FROM founder_attention_items WHERE id = ?', id), 'attention item'));
    });
  }

  list(filter: { lane?: AttentionLane; state?: AttentionItemRecord['state'] } = { state: 'OPEN' }): AttentionItemRecord[] {
    return this.#read((ctx) =>
      ctx.db
        .all('SELECT * FROM founder_attention_items ORDER BY first_seen_at, id')
        .map(mapAttentionItem)
        .filter((i) => (filter.lane === undefined || i.lane === filter.lane) && (filter.state === undefined || i.state === filter.state)),
    );
  }

  /** Open items as of T: opened at or before T and not resolved / dismissed before T (Historical Focus). */
  openAt(at: Timestamp): AttentionItemRecord[] {
    return this.#read((ctx) =>
      ctx.db
        .all('SELECT * FROM founder_attention_items WHERE first_seen_at <= ? ORDER BY first_seen_at, id', at)
        .map(mapAttentionItem)
        .filter((i) => i.resolvedAt === null || i.resolvedAt > at),
    );
  }

  health(): { open: number; byLane: Record<AttentionLane, number>; resolved: number; dismissed: number } {
    return this.#read((ctx) => {
      const n = (sql: string, ...p: string[]): number => Number(ctx.db.get<{ n: number }>(sql, ...p)?.n ?? 0);
      return {
        open: n(`SELECT COUNT(*) AS n FROM founder_attention_items WHERE state = 'OPEN'`),
        byLane: { NEEDS_ME: n(`SELECT COUNT(*) AS n FROM founder_attention_items WHERE state = 'OPEN' AND lane = 'NEEDS_ME'`), CEO_BRIEFS: n(`SELECT COUNT(*) AS n FROM founder_attention_items WHERE state = 'OPEN' AND lane = 'CEO_BRIEFS'`), THREADS: n(`SELECT COUNT(*) AS n FROM founder_attention_items WHERE state = 'OPEN' AND lane = 'THREADS'`) },
        resolved: n(`SELECT COUNT(*) AS n FROM founder_attention_items WHERE state = 'RESOLVED'`),
        dismissed: n(`SELECT COUNT(*) AS n FROM founder_attention_items WHERE state = 'DISMISSED'`),
      };
    });
  }
}
