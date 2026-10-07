/**
 * CapabilityStore — Work Item capability requirements and durable Capability Gaps (Stage 7 §16–§20).
 *
 * Requirements are declared by whoever submits the Work Item, before it is released, and can only
 * restrict: they add gates, never authority. The gate itself runs inside the fenced run start (before
 * any model or tool call); a gap is opened there and parks the work. A gap resolves by itself when the
 * gate next passes (for example after certification, which also wakes the parked work).
 */
import { QandeelError, assertCode, assertId, type Id } from '@qandeel-company/domain';
import { assertKeyCode, assertRequirements, terms as termsOf, type CapabilityRequirement } from '@qandeel-company/mind';

import { wakeWorkItemJob } from './governance-core.js';
import { founder, founderAdminWrite } from './governance.js';
import { appendAudit, getWorkItemRow, ts, type StoreContext } from './internal.js';
import { mapGap, type CapabilityGapRecord } from './mind-records.js';
import { storeContext, type CompanyStore } from './store.js';
import { workItemCapabilities, type WorkItemCapabilities } from './mind-writes.js';

export interface DeclareRequirementsInput {
  readonly requirements: readonly CapabilityRequirement[];
  /** Market / domain context of the work (e.g. `market:eg`): scopes market knowledge and memory. */
  readonly marketRef?: string;
  /** IMPORTANT work never proceeds on an unresolved memory conflict. */
  readonly importance?: 'ORDINARY' | 'IMPORTANT';
  /** Topic codes that make retrieval task-relevant (lexical, deterministic). */
  readonly topics?: readonly string[];
  readonly expectedOutcomeCode?: string;
}

export class CapabilityStore {
  readonly #store: CompanyStore;

  private constructor(store: CompanyStore) {
    this.#store = store;
  }

  static for(store: CompanyStore): CapabilityStore {
    return new CapabilityStore(store);
  }

  #write<T>(operation: string, fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.immediate(operation, () => fn(ctx));
  }

  #read<T>(fn: (ctx: StoreContext) => T): T {
    const ctx = storeContext(this.#store);
    return ctx.db.snapshot(() => fn(ctx));
  }

  /** Declares the Work Item's capability requirements and retrieval context (once, before release). */
  declareRequirements(workItemId: string, input: DeclareRequirementsInput): WorkItemCapabilities {
    return this.#write('declare capability requirements', (ctx) => txDeclareRequirements(ctx, workItemId, input));
  }

  requirements(workItemId: Id): WorkItemCapabilities {
    return this.#read((ctx) => workItemCapabilities(ctx, workItemId));
  }

  gaps(state?: CapabilityGapRecord['state']): CapabilityGapRecord[] {
    return this.#read((ctx) => (state ? ctx.db.all('SELECT * FROM capability_gaps WHERE state = ? ORDER BY created_at, id', state) : ctx.db.all('SELECT * FROM capability_gaps ORDER BY created_at, id')).map(mapGap));
  }

  gapFor(workItemId: Id): CapabilityGapRecord | null {
    return this.#read((ctx) => {
      const r = ctx.db.get(`SELECT * FROM capability_gaps WHERE work_item_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`, workItemId);
      return r ? mapGap(r) : null;
    });
  }

  /** Cancels an open gap (the requirement was revised or the work withdrawn). Founder authority; never re-routes work. */
  cancelGap(actorRef: string, gapId: string, reasonCode: string): CapabilityGapRecord {
    return founderAdminWrite(this.#store, 'cancel capability gap', actorRef, (ctx) => {
      const p = founder(ctx, actorRef, null, 'capability gap');
      const id = assertId(gapId, 'gapId');
      const reason = assertCode(reasonCode, 'reasonCode');
      const changed = ctx.db.run(`UPDATE capability_gaps SET state = 'CANCELLED', resolved_by_ref = ?, reason_code = ?, resolved_at = ? WHERE id = ? AND state = 'OPEN'`, p.ref, reason, ts(ctx), id).changes;
      if (changed !== 1) throw new QandeelError('INVALID_TRANSITION', 'the gap is not open', { gapId: id });
      const gap = mapGap(ctx.db.get('SELECT * FROM capability_gaps WHERE id = ?', id) ?? {});
      appendAudit(ctx, 'capability.gap_cancelled', 'capability_gap', id, { actorRef: p.ref }, 'OK', reason, { workItemId: gap.workItemId });
      // The parked work is woken to end: its next run start sees the cancelled gap and fails (never re-routed).
      wakeWorkItemJob(ctx, gap.workItemId, ['CAPABILITY_GAP'], 'capability.gap_cancelled');
      return gap;
    });
  }
}

/** Declares a PROPOSED Work Item's capability requirements and retrieval topics (in the caller's transaction). */
export function txDeclareRequirements(ctx: StoreContext, workItemId: string, input: DeclareRequirementsInput): WorkItemCapabilities {
  const item = getWorkItemRow(ctx, assertId(workItemId, 'workItemId'));
  if (item.state !== 'PROPOSED') throw new QandeelError('INVALID_TRANSITION', 'requirements are declared before the Work Item is released', { state: item.state });
  const requirements = assertRequirements(input.requirements);
  const market = input.marketRef === undefined ? null : input.marketRef;
  if (market !== null && !/^market:[a-z][a-z0-9-]{1,31}$/.test(market)) throw new QandeelError('VALIDATION_FAILED', 'marketRef is "market:<code>"', { field: 'marketRef' });
  for (const r of requirements) if (r.kind === 'MARKET' && market !== `market:${r.marketCode}`) throw new QandeelError('VALIDATION_FAILED', 'a MARKET requirement names the Work Item market', { field: 'marketRef' });
  const topics = (input.topics ?? []).slice(0, 16).map((t) => assertKeyCode(t, 'topics'));
  ctx.db.run(
    'INSERT INTO work_item_capabilities (work_item_id, requirements_json, market_ref, importance, topic_terms_json, expected_outcome_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    item.id, JSON.stringify(requirements), market, input.importance === 'IMPORTANT' ? 'IMPORTANT' : 'ORDINARY', JSON.stringify(termsOf(topics.map((t) => t.replace(/[.-]/g, ' ')).join(' '))), input.expectedOutcomeCode === undefined ? null : assertCode(input.expectedOutcomeCode, 'expectedOutcomeCode'), ts(ctx),
  );
  appendAudit(ctx, 'capability.requirements_declared', 'work_item', item.id, {}, 'OK', null, { requirements: requirements.length });
  return workItemCapabilities(ctx, item.id);
}
