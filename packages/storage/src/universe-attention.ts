/** Storage-internal: open attention rows at T (shared by the universe projection and the attention store). */
import type { Timestamp } from '@qandeel-company/domain';

import { mapAttentionItem, type AttentionItemRecord } from './founder-records.js';
import type { StoreContext } from './internal.js';

export function openAtItems(ctx: StoreContext, at: Timestamp): AttentionItemRecord[] {
  return ctx.db
    .all('SELECT * FROM founder_attention_items WHERE first_seen_at <= ? ORDER BY first_seen_at, id', at)
    .map(mapAttentionItem)
    .filter((i) => (i.state === 'OPEN' && i.resolvedAt === null) || (i.resolvedAt !== null && i.resolvedAt > at));
}
