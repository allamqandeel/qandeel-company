/**
 * The social publication SEAM (provider-neutral; no social platform is selected or implemented in C7-D).
 *
 * Platforms differ — permissions, page / organization roles, API versions and sunsets, content types, asynchronous
 * publish (submitted → confirmed), edit / delete semantics, rate limits — so there is no universal social API here. A
 * provider plugs in with an explicit, version-pinned `SocialAdapterDeclaration` and a `SocialProviderPort`; this driver
 * owns the fail-closed gate every publish passes BEFORE the provider is called:
 *   exact candidate (re-verified) → provider-neutral package → declared content type → the connected identity's CURRENT
 *   permissions and roles → the pinned API version not sunset → NOW inside the exact window the Founder approved.
 * Unsupported behaviour is refused, never emulated. There is no comment, reply, DM or paid-spend operation.
 */
import { isQandeelError } from '@qandeel-company/domain';
import { adapterVersionUsable, assertSocialDeclaration, checkSocialPublish, parseSocialPackage, socialContentType, SOCIAL_PACKAGE_PATH, type SocialAdapterDeclaration, type ToolDriver, type ToolDriverInput, type ToolDriverResult } from '@qandeel-company/governance';

import type { PromotionSource } from './source.js';

export interface SocialPost {
  readonly targetRef: string;
  readonly text: string;
  readonly links: readonly string[];
  readonly media: readonly { readonly path: string; readonly mediaType: string; readonly altText: string; readonly content: Uint8Array }[];
}

export type SocialPublishOutcome =
  | { readonly status: 'PUBLISHED' | 'SUBMITTED'; readonly externalId: string }
  | { readonly status: 'REFUSED'; readonly code: string }
  | { readonly status: 'UNKNOWN' };

export interface SocialProviderPort {
  readonly declaration: SocialAdapterDeclaration;
  /** The connected identity's CURRENT permissions and account / page roles (read at every publish; never cached as authority). */
  identity(targetRef: string, signal: AbortSignal): Promise<{ readonly grantedPermissions: readonly string[]; readonly accountRoles: readonly string[] }>;
  publish(post: SocialPost, idempotencyKey: string, signal: AbortSignal): Promise<SocialPublishOutcome>;
  /** The post this idempotency key already created, if any (replay / reconciliation). */
  findByKey(targetRef: string, idempotencyKey: string, signal: AbortSignal): Promise<{ readonly externalId: string; readonly state: string } | null>;
}

const fail = (code: string, sent: 'NO' | 'UNKNOWN' = 'NO'): ToolDriverResult => ({ ok: false, code, sent });

export class SocialPublishDriver implements ToolDriver {
  readonly driverCode: string;
  readonly #port: SocialProviderPort;
  readonly #source: PromotionSource;
  readonly #clock: () => Date;

  constructor(port: SocialProviderPort, source: PromotionSource, clock: () => Date = () => new Date()) {
    this.driverCode = assertSocialDeclaration(port.declaration).adapterCode;
    this.#port = port;
    this.#source = source;
    this.#clock = clock;
  }

  async invoke(input: ToolDriverInput, signal: AbortSignal): Promise<ToolDriverResult> {
    const d = this.#port.declaration;
    const at = this.#clock().toISOString();
    if (!adapterVersionUsable(d, at)) return fail('API_VERSION_UNSUPPORTED');
    const action = d.actions.find((a) => a.actionCode === input.actionCode);
    if (!action) return fail('ACTION_NOT_DECLARED');
    let sent = false;
    try {
      if (action.kind === 'READ_STATE' || action.kind === 'RECONCILE') {
        const args = this.#source.promotionArgs(String(input.args.promotionId));
        if (args === null) return fail('PROMOTION_NOT_FOUND');
        const t = this.#source.target(d.adapterCode, String(args.targetId));
        if (t === null) return fail('TARGET_NOT_FOUND');
        const found = await this.#port.findByKey(t.externalRef, `promotion:${String(input.args.promotionId)}`, signal);
        return { ok: true, result: { promotionId: String(input.args.promotionId), found: found !== null, ...(found ? { externalId: found.externalId, state: found.state } : {}) } };
      }
      if (action.kind !== 'SOCIAL_PUBLISH') return fail('ACTION_NOT_DECLARED');
      const r = this.#source.resolve(d.adapterCode, input.args, { includeContent: true });
      if (!r.ok) return fail(r.code);
      if (r.export.kind !== 'SOCIAL_PUBLISH') return fail('PROMOTION_KIND_MISMATCH');
      const files = r.export.files;
      const pkgFile = files.find((f) => f.path === SOCIAL_PACKAGE_PATH);
      if (!pkgFile) return fail('SOCIAL_PACKAGE_MISSING');
      const pkg = parseSocialPackage(Buffer.from(pkgFile.content).toString('utf8'), files.map((f) => f.path));
      const contentType = socialContentType(pkg);
      const identity = await this.#port.identity(r.export.target.externalRef, signal);
      const gate = checkSocialPublish(d, { at, contentType, grantedPermissions: identity.grantedPermissions, accountRoles: identity.accountRoles, notBefore: String(input.args.notBefore), notAfter: String(input.args.notAfter) });
      if (!gate.ok) return fail(gate.code);
      // One post per promotion: the stable key is the promotion, so a restart or a replay never posts twice.
      const key = `promotion:${r.export.promotionId}`;
      const prior = await this.#port.findByKey(r.export.target.externalRef, key, signal);
      if (prior) return { ok: true, result: { promotionId: r.export.promotionId, externalId: prior.externalId, state: prior.state, replayed: true, apiVersion: d.apiVersion } };
      sent = true;
      const o = await this.#port.publish({ targetRef: r.export.target.externalRef, text: pkg.text, links: pkg.links, media: pkg.media.map((m) => { const f = files.find((x) => x.path === m.path); return { path: m.path, altText: m.altText, mediaType: f?.mediaType ?? 'application/octet-stream', content: f?.content ?? new Uint8Array() }; }) }, key, signal);
      if (o.status === 'REFUSED') return fail(o.code);
      if (o.status === 'UNKNOWN') return fail('PROVIDER_OUTCOME_UNKNOWN', 'UNKNOWN');
      // SUBMITTED (asynchronous provider): accepted for processing, not yet confirmed published — recorded as such.
      return { ok: true, result: { promotionId: r.export.promotionId, externalId: o.externalId, state: o.status, contentType, apiVersion: d.apiVersion } };
    } catch (error) {
      if (!sent && isQandeelError(error)) return fail(String(error.details.reason ?? error.code).slice(0, 64));
      return fail(sent ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_UNREACHABLE', sent ? 'UNKNOWN' : 'NO');
    }
  }
}
