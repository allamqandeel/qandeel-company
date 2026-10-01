/**
 * The hosting / CMS adapter SEAM (no provider is selected or implemented in C7-D: Vercel, Cloudflare, Netlify, a CMS or
 * anything else is chosen later by the Company's own research and the Founder, then registered as a Tool).
 *
 * A provider plugs in by implementing `HostingProviderPort` — four DISTINCT operations — and declaring a validated
 * adapter capability. The driver maps each declared action to exactly one operation: an external preview is never a
 * production publish, a rollback is its own governed act bound to the exact current and target versions, and every
 * external act is reached only through the Tool Executor (review → Founder approval → idempotent intent).
 */
import type { JsonObject } from '@qandeel-company/domain';
import { adapterVersionUsable, assertAdapterDeclaration, type PromotionAdapterDeclaration, type ToolDriver, type ToolDriverInput, type ToolDriverResult } from '@qandeel-company/governance';

import type { PromotionSource, PromotionSourceExport } from './source.js';

export type HostingOutcome =
  | { readonly status: 'ACCEPTED'; readonly deploymentId: string; readonly version: string }
  | { readonly status: 'REFUSED'; readonly code: string }
  /** The provider may have acted (timeout, ambiguous answer): the Company reconciles before anything repeats. */
  | { readonly status: 'UNKNOWN' };

export interface HostingProviderPort {
  readonly declaration: PromotionAdapterDeclaration;
  /** A provider-hosted preview of the exact candidate (external: still a governed act). */
  previewExternal(candidate: PromotionSourceExport, idempotencyKey: string, signal: AbortSignal): Promise<HostingOutcome>;
  /** Production publication of the exact candidate. */
  publishProduction(candidate: PromotionSourceExport, idempotencyKey: string, signal: AbortSignal): Promise<HostingOutcome>;
  /** Production rollback to an exact earlier production version. */
  rollbackProduction(target: { readonly externalRef: string; readonly rollbackToRef: string }, idempotencyKey: string, signal: AbortSignal): Promise<HostingOutcome>;
  /** The provider's current production version of a target (a read; no mutation). */
  currentProduction(target: { readonly externalRef: string }, signal: AbortSignal): Promise<{ readonly version: string } | null>;
}

const fail = (code: string, sent: 'NO' | 'UNKNOWN' = 'NO'): ToolDriverResult => ({ ok: false, code, sent });

function outcome(o: HostingOutcome, extra: JsonObject): ToolDriverResult {
  if (o.status === 'ACCEPTED') return { ok: true, result: { ...extra, deploymentId: o.deploymentId, version: o.version } };
  if (o.status === 'REFUSED') return fail(o.code);
  return fail('PROVIDER_OUTCOME_UNKNOWN', 'UNKNOWN');
}

export class HostingPromotionDriver implements ToolDriver {
  readonly driverCode: string;
  readonly #port: HostingProviderPort;
  readonly #source: PromotionSource;
  readonly #clock: () => Date;

  constructor(port: HostingProviderPort, source: PromotionSource, clock: () => Date = () => new Date()) {
    const d = assertAdapterDeclaration(port.declaration);
    if (d.providerKind !== 'HOSTING' && d.providerKind !== 'CMS') throw new Error('a hosting driver needs a HOSTING or CMS declaration');
    this.driverCode = d.adapterCode;
    this.#port = port;
    this.#source = source;
    this.#clock = clock;
  }

  async invoke(input: ToolDriverInput, signal: AbortSignal): Promise<ToolDriverResult> {
    const d = this.#port.declaration;
    if (!adapterVersionUsable(d, this.#clock().toISOString())) return fail('API_VERSION_UNSUPPORTED');
    const action = d.actions.find((a) => a.actionCode === input.actionCode);
    if (!action) return fail('ACTION_NOT_DECLARED');
    try {
      switch (action.kind) {
        case 'PREVIEW_EXTERNAL':
        case 'PUBLISH_PRODUCTION': {
          const r = this.#source.resolve(d.adapterCode, input.args, { includeContent: true });
          if (!r.ok) return fail(r.code);
          if (r.export.kind !== action.kind) return fail('PROMOTION_KIND_MISMATCH');
          const o = action.kind === 'PREVIEW_EXTERNAL' ? await this.#port.previewExternal(r.export, input.idempotencyKey, signal) : await this.#port.publishProduction(r.export, input.idempotencyKey, signal);
          return outcome(o, { promotionId: r.export.promotionId, kind: action.kind, manifestSha256: r.export.manifestSha256 });
        }
        case 'ROLLBACK_PRODUCTION': {
          const r = this.#source.resolve(d.adapterCode, input.args, { includeContent: false });
          if (!r.ok) return fail(r.code);
          if (r.export.kind !== 'ROLLBACK_PRODUCTION') return fail('PROMOTION_KIND_MISMATCH');
          // A rollback is bound to the exact production version it replaces: anything else changed meanwhile → refused.
          const current = await this.#port.currentProduction({ externalRef: r.export.target.externalRef }, signal);
          if (current === null || current.version !== String(input.args.expectedCurrentRef)) return fail('CURRENT_VERSION_CHANGED');
          return outcome(await this.#port.rollbackProduction({ externalRef: r.export.target.externalRef, rollbackToRef: String(input.args.rollbackToRef) }, input.idempotencyKey, signal), { promotionId: r.export.promotionId, kind: 'ROLLBACK_PRODUCTION' });
        }
        case 'READ_STATE':
        case 'RECONCILE': {
          const t = this.#source.target(d.adapterCode, String(input.args.targetId));
          if (t === null) return fail('TARGET_NOT_FOUND');
          const current = await this.#port.currentProduction({ externalRef: t.externalRef }, signal);
          return { ok: true, result: { targetId: t.id, version: current?.version ?? 'NONE' } };
        }
        default:
          return fail('ACTION_NOT_DECLARED');
      }
    } catch {
      return fail(action.mutatesExternal ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_UNREACHABLE', action.mutatesExternal ? 'UNKNOWN' : 'NO');
    }
  }
}
