/**
 * What an external promotion driver may know about the Company: the read-only, re-verifying resolution of ONE prepared
 * promotion (by its exact, approved arguments), of one Founder-registered target, and nothing else. The host wires it to
 * the Company store (`@qandeel-company/storage` `resolvePromotionExport`); a driver never opens the store, never sees a
 * workspace path and never receives file content through its arguments.
 */
import type { JsonObject } from '@qandeel-company/domain';
import type { PromotionKind, TargetClass } from '@qandeel-company/governance';

export interface PromotionSourceFile {
  readonly path: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly content: Uint8Array;
}

export interface PromotionSourceExport {
  readonly promotionId: string;
  readonly kind: PromotionKind;
  readonly candidateId: string;
  readonly manifestSha256: string;
  readonly target: { readonly id: string; readonly targetClass: TargetClass; readonly adapterCode: string; readonly externalRef: string };
  readonly files: readonly PromotionSourceFile[];
}

export type PromotionSourceResult = { readonly ok: true; readonly export: PromotionSourceExport } | { readonly ok: false; readonly code: string };

export interface PromotionSourceTarget {
  readonly id: string;
  readonly targetClass: TargetClass;
  readonly externalRef: string;
  readonly state: string;
}

export interface PromotionSource {
  /** The exact promotion these arguments name, re-verified now (arguments hash, adapter, target, candidate integrity). */
  resolve(adapterCode: string, args: JsonObject, options: { readonly includeContent: boolean }): PromotionSourceResult;
  /** One registered target of this adapter (for provider-state reads), or null. */
  target(adapterCode: string, targetId: string): PromotionSourceTarget | null;
  /** The exact arguments a prepared promotion bound (for reconciliation reads), or null. */
  promotionArgs(promotionId: string): JsonObject | null;
}
