/**
 * FounderSurface — runtime + listener + briefing policy in one lifecycle. Starting it never arms Founder
 * authority: a session does, per request. Stopping it revokes every live session (fail closed).
 *
 * OPS (D-OPS-02): as the Founder host (`host` option) it also publishes the content-free host descriptor once it listens,
 * answers signed identity probes and accepts a controlled stop proven by a one-shot workspace file. That role adds no
 * Founder authority and no second runtime: it only makes THIS runtime discoverable and stoppable.
 */
import { CEO_ACADEMY_PACKAGE_V1, CEO_ACADEMY_PACKAGE_V2, CEO_ACADEMY_PACKAGE_V3, CEO_ACADEMY_PACKAGE_V4, CEO_ACADEMY_PACKAGE_V5, CEO_ACADEMY_PACKAGE_V6, CEO_ACADEMY_PACKAGE_V7, CEO_IDENTITY_PROFILE_V1, type AcademyPackage, type EmployeeIdentityProfile } from '@qandeel-company/mind';
import type { ProviderAdapter, ProviderProvisioningProfile } from '@qandeel-company/governance';
import { CompanyRuntime, DeterministicFakeProvider, FakeToolDriver, employeeTaskProcessor, type RuntimeOptions } from '@qandeel-company/runtime';
import { ProductDocsDriver, type GitHubTransport } from '@qandeel-company/tool-drivers';

import { BriefingPolicy } from './briefing.js';
import { HostIdentity, consumeStopRequest, hostPaths, removeDescriptorIfOwned, writeJsonAtomic, type HostPaths } from './host/descriptor.js';
import { FounderListener, type DesktopControl, type HostControl } from './server/listener.js';
import { PreviewHost } from './server/preview-listener.js';
import { defaultStaticRoots, type StaticRoots } from './static.js';

export interface FounderSurfaceOptions {
  readonly workspace: string;
  readonly port?: number;
  readonly roots?: StaticRoots;
  readonly runtime?: Partial<RuntimeOptions>;
  /** Deterministic fake provider / drivers for local acceptance and visual proof (never a paid provider). */
  readonly fakes?: { readonly providers?: readonly string[]; readonly drivers?: readonly string[] };
  /**
   * L1-01: real provider adapters the host wired (the DeepSeek adapter behind the Windows vault) and the
   * release-pinned provisioning profiles the Founder may confirm. Handed to the governed Model Runtime only.
   */
  readonly providers?: readonly ProviderAdapter[];
  readonly provisioningProfiles?: readonly ProviderProvisioningProfile[];
  /**
   * P1-PRODUCT-KNOWLEDGE-01 (D-P1-06): the transport of the read-only product documentation reader (production: the one
   * approved fixed-host GitHub transport, anonymous). With it the host registers the reader as a Tool driver; it reads
   * nothing until the Founder registers the product source and grants an Employee the read, and then only on request.
   */
  readonly productDocsTransport?: GitHubTransport;
  /**
   * L1-02: the release-pinned Academy packages and Employee identity profiles the Founder may install / name through the
   * governed confirmation (default: the first CEO package and identity profile). Content, never authority.
   */
  readonly academyPackages?: readonly AcademyPackage[];
  readonly identityProfiles?: readonly EmployeeIdentityProfile[];
  readonly log?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  readonly briefing?: boolean;
  /**
   * OPS: run as the workspace's Founder host — publish the descriptor and accept a controlled stop. `onStopRequested` is
   * called (after the reply) when a verified stop request arrives; the host process stops the surface and exits.
   */
  readonly host?: { readonly onStopRequested: () => void; readonly desktop?: DesktopControl };
}

export class FounderSurface {
  readonly runtime: CompanyRuntime;
  readonly listener: FounderListener;
  /** C7-D: the isolated internal Preview host (its own loopback site; previews open on demand and expire). */
  readonly previews: PreviewHost;
  /** The CEO briefing policy (null when disabled); built at start, once the runtime's store is open. */
  briefing: BriefingPolicy | null = null;
  readonly #briefingEnabled: boolean;
  readonly fakes: { readonly providers: readonly DeterministicFakeProvider[]; readonly drivers: readonly FakeToolDriver[] };
  #unsubscribe: (() => void) | null = null;
  readonly #log: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  readonly #hostOptions: FounderSurfaceOptions['host'];
  readonly #hostPaths: HostPaths;
  #identity: HostIdentity | null = null;

  constructor(options: FounderSurfaceOptions) {
    const providers = (options.fakes?.providers ?? []).map((code) => new DeterministicFakeProvider(code));
    const drivers = (options.fakes?.drivers ?? []).map((code) => new FakeToolDriver(code));
    this.fakes = { providers, drivers };
    const extra = options.runtime ?? {};
    const governance = {
      ...(extra.governance ?? {}),
      providers: [...providers, ...(options.providers ?? []), ...(extra.governance?.providers ?? [])],
      toolDrivers: [...drivers, ...(options.productDocsTransport ? [new ProductDocsDriver({ transport: options.productDocsTransport, source: { productSource: () => this.runtime.productSource().productSource() } })] : []), ...(extra.governance?.toolDrivers ?? [])],
      provisioningProfiles: [...(options.provisioningProfiles ?? []), ...(extra.governance?.provisioningProfiles ?? [])],
      academyPackages: [...(options.academyPackages ?? [CEO_ACADEMY_PACKAGE_V7, CEO_ACADEMY_PACKAGE_V6, CEO_ACADEMY_PACKAGE_V5, CEO_ACADEMY_PACKAGE_V4, CEO_ACADEMY_PACKAGE_V3, CEO_ACADEMY_PACKAGE_V2, CEO_ACADEMY_PACKAGE_V1]), ...(extra.governance?.academyPackages ?? [])],
      identityProfiles: [...(options.identityProfiles ?? [CEO_IDENTITY_PROFILE_V1]), ...(extra.governance?.identityProfiles ?? [])],
    };
    const runtimeOptions: RuntimeOptions = {
      ...extra,
      workspace: options.workspace,
      processors: [...(extra.processors ?? []), employeeTaskProcessor],
      governance,
    };
    this.runtime = new CompanyRuntime(runtimeOptions);
    const log = options.log ?? (() => undefined);
    this.previews = new PreviewHost({ runtime: this.runtime, log });
    this.#hostOptions = options.host;
    this.#hostPaths = hostPaths(options.workspace);
    const host: HostControl | undefined = options.host ? { identity: (port, nonce) => this.#prove(port, nonce), requestStop: (requestId) => this.#acceptStop(requestId) } : undefined;
    const desktop = options.host?.desktop;
    this.listener = new FounderListener({ runtime: this.runtime, roots: options.roots ?? defaultStaticRoots(), ...(options.port !== undefined ? { port: options.port } : {}), log, preview: this.previews, ...(host ? { host } : {}), ...(desktop ? { desktop } : {}) });
    // L1-02 (D-L1-17): the briefing policy reads `runtime.founder`, which exists only once the runtime opened its store;
    // building it here made every production `serve` (briefing on by default) fail with RUNTIME_NOT_READY.
    this.#briefingEnabled = options.briefing !== false;
    this.#log = log;
  }

  get origin(): string {
    return this.listener.origin;
  }

  async start(): Promise<void> {
    await this.runtime.start();
    if (this.#briefingEnabled && this.briefing === null) this.briefing = new BriefingPolicy(this.runtime.founder, { log: this.#log });
    if (this.briefing) this.#unsubscribe = this.runtime.onEvent((e) => this.briefing?.onEvent(e));
    await this.listener.listen();
    if (this.#hostOptions) {
      // The identity is born with this runtime instance; only its public key reaches the workspace.
      this.#identity = new HostIdentity(this.runtime.instanceId);
      writeJsonAtomic(this.#hostPaths.descriptor, this.#identity.descriptor(process.pid, this.listener.port, new Date().toISOString()));
      this.#log('founder.host_published', { instanceId: this.runtime.instanceId, port: this.listener.port });
    }
  }

  /** The host's current identity (null when not running as the Founder host). */
  get hostInstanceId(): string | null {
    return this.#identity?.instanceId ?? null;
  }

  #prove(port: number, nonce: string): { instanceId: string; signature: string } | null {
    if (this.#identity === null || this.runtime.state !== 'READY') return null;
    return this.#identity.prove(port, nonce);
  }

  #acceptStop(requestId: unknown): boolean {
    const identity = this.#identity;
    const onStop = this.#hostOptions?.onStopRequested;
    if (identity === null || onStop === undefined || !consumeStopRequest(this.#hostPaths, identity.instanceId, requestId)) return false;
    setImmediate(onStop); // after the 202 reaches the launcher
    return true;
  }

  /** A launch URL for the Founder's browser: the token travels once, in the fragment, never in a log. */
  launchUrl(): string {
    const { token } = this.runtime.founder.auth.mintLaunchToken();
    return `${this.origin}/launch#${token}`;
  }

  async stop(): Promise<void> {
    // Unpublish first: from here a launcher sees the instance as stopping (lease still held), never as reusable.
    if (this.#identity) removeDescriptorIfOwned(this.#hostPaths, this.#identity.instanceId);
    this.#identity = null;
    this.#unsubscribe?.();
    try {
      this.runtime.founder.auth.revokeAll('surface.stopped');
    } catch {
      // The store may already be closed by a failed runtime; sessions expire on their own.
    }
    await this.previews.close();
    await this.listener.close();
    await this.runtime.stop();
  }
}
