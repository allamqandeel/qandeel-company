/**
 * Proactive CEO briefing policy (C5 §10.1, Stage 9 §17–§18, §27–§28).
 *
 * The CEO briefs the Founder without being asked, but only on durable signals that warrant it: a Founder
 * approval now pending, a Work Item blocked, an escalated handoff, a company goal approaching its horizon.
 * Every signal is deduplicated per context (one open brief thread per context; a repeated signal never
 * spawns a second run) and rate-limited by a cooldown, so there is no notification storm. The policy is
 * event-driven (it subscribes to the runtime's durable events); it never polls and never calls a model —
 * the CEO's own governed run writes the brief.
 */
import type { EventRecord } from '@qandeel-company/storage';

import type { FounderAdmin } from '@qandeel-company/runtime';

export const BRIEF_COOLDOWN_MS = 6 * 3_600_000;

export interface BriefSignal {
  readonly contextKind: 'APPROVAL' | 'WORK_ITEM' | 'GOAL' | 'INCIDENT';
  readonly contextRef: string;
  readonly subject: string;
  readonly reasonCode: string;
  /** Content-free prompt frame: the CEO's context assembler supplies the durable facts (C3). */
  readonly instructions: string;
}

/** Maps one durable event to a brief signal, or null when routine (most events are routine). */
export function signalFor(event: EventRecord): BriefSignal | null {
  if (event.type === 'work_item.approval_requested') {
    return {
      contextKind: 'APPROVAL',
      contextRef: `work_item:${event.aggregateId}`,
      subject: 'قرار مطلوب من المؤسس',
      reasonCode: 'brief.approval_pending',
      instructions: `A Founder approval is pending for work item ${event.aggregateId}. Brief the Founder in the Founder Communication Standard as a MESSAGE proposal with purpose BRIEF: what is happening, why it matters, your recommendation, and whether a decision is needed. Then FINAL.`,
    };
  }
  if (event.type === 'work_item.transitioned' && event.payload.to === 'BLOCKED') {
    return {
      contextKind: 'WORK_ITEM',
      contextRef: `work_item:${event.aggregateId}`,
      subject: 'عمل متوقف',
      reasonCode: 'brief.work_blocked',
      instructions: `Work item ${event.aggregateId} is BLOCKED (${String(event.payload.blockedReason ?? 'unknown reason')}). Brief the Founder in the Founder Communication Standard as a MESSAGE proposal with purpose BRIEF, then FINAL.`,
    };
  }
  return null;
}

export class BriefingPolicy {
  readonly #founder: FounderAdmin;
  readonly #lastByContext = new Map<string, number>();
  readonly #now: () => number;
  readonly #log: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  #enabled = true;

  constructor(founder: FounderAdmin, options: { now?: () => number; log?: (event: string, fields: Record<string, string | number | boolean | null>) => void } = {}) {
    this.#founder = founder;
    this.#now = options.now ?? (() => Date.now());
    this.#log = options.log ?? (() => undefined);
  }

  /** Requests a brief for a signal unless the same context was briefed within the cooldown. Content-free logging. */
  onSignal(signal: BriefSignal): { requested: boolean; code: string; workItemId?: string } {
    if (!this.#enabled) return { requested: false, code: 'DISABLED' };
    const key = `${signal.contextKind}:${signal.contextRef}`;
    const last = this.#lastByContext.get(key);
    const now = this.#now();
    if (last !== undefined && now - last < BRIEF_COOLDOWN_MS) return { requested: false, code: 'COOLDOWN' };
    try {
      const out = this.#founder.communications.requestCeoBrief({ subject: signal.subject, contextKind: signal.contextKind, contextRef: signal.contextRef, reasonCode: signal.reasonCode, instructions: signal.instructions });
      this.#lastByContext.set(key, now);
      this.#log('founder.brief_requested', { contextKind: signal.contextKind, replayed: out.replayed, workItemId: out.workItemId });
      return { requested: !out.replayed, code: out.replayed ? 'REPLAYED' : 'REQUESTED', workItemId: out.workItemId };
    } catch (error) {
      // A vacant CEO seat, an inactive CEO or a missing envelope: the signal stays in Founder Attention anyway.
      const code = (error as { code?: string }).code ?? 'UNCLASSIFIED_ERROR';
      this.#log('founder.brief_not_requested', { contextKind: signal.contextKind, code });
      return { requested: false, code };
    }
  }

  onEvent(event: EventRecord): void {
    const s = signalFor(event);
    if (s !== null) this.onSignal(s);
  }

  disable(): void {
    this.#enabled = false;
  }
}
