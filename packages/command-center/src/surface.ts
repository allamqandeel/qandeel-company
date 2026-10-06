/**
 * FounderSurface — runtime + listener + briefing policy in one lifecycle. Starting it never arms Founder
 * authority: a session does, per request. Stopping it revokes every live session (fail closed).
 */
import { CEO_ACADEMY_PACKAGE_V1, CEO_ACADEMY_PACKAGE_V2, CEO_ACADEMY_PACKAGE_V3, CEO_ACADEMY_PACKAGE_V4, CEO_IDENTITY_PROFILE_V1, type AcademyPackage, type EmployeeIdentityProfile } from '@qandeel-company/mind';
import type { ProviderAdapter, ProviderProvisioningProfile } from '@qandeel-company/governance';
import { CompanyRuntime, DeterministicFakeProvider, FakeToolDriver, employeeTaskProcessor, type RuntimeOptions } from '@qandeel-company/runtime';

import { BriefingPolicy } from './briefing.js';
import { FounderListener } from './server/listener.js';
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
   * L1-02: the release-pinned Academy packages and Employee identity profiles the Founder may install / name through the
   * governed confirmation (default: the first CEO package and identity profile). Content, never authority.
   */
  readonly academyPackages?: readonly AcademyPackage[];
  readonly identityProfiles?: readonly EmployeeIdentityProfile[];
  readonly log?: (event: string, fields: Record<string, string | number | boolean | null>) => void;
  readonly briefing?: boolean;
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

  constructor(options: FounderSurfaceOptions) {
    const providers = (options.fakes?.providers ?? []).map((code) => new DeterministicFakeProvider(code));
    const drivers = (options.fakes?.drivers ?? []).map((code) => new FakeToolDriver(code));
    this.fakes = { providers, drivers };
    const extra = options.runtime ?? {};
    const governance = {
      ...(extra.governance ?? {}),
      providers: [...providers, ...(options.providers ?? []), ...(extra.governance?.providers ?? [])],
      toolDrivers: [...drivers, ...(extra.governance?.toolDrivers ?? [])],
      provisioningProfiles: [...(options.provisioningProfiles ?? []), ...(extra.governance?.provisioningProfiles ?? [])],
      academyPackages: [...(options.academyPackages ?? [CEO_ACADEMY_PACKAGE_V4, CEO_ACADEMY_PACKAGE_V3, CEO_ACADEMY_PACKAGE_V2, CEO_ACADEMY_PACKAGE_V1]), ...(extra.governance?.academyPackages ?? [])],
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
    this.listener = new FounderListener({ runtime: this.runtime, roots: options.roots ?? defaultStaticRoots(), ...(options.port !== undefined ? { port: options.port } : {}), log, preview: this.previews });
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
  }

  /** A launch URL for the Founder's browser: the token travels once, in the fragment, never in a log. */
  launchUrl(): string {
    const { token } = this.runtime.founder.auth.mintLaunchToken();
    return `${this.origin}/launch#${token}`;
  }

  async stop(): Promise<void> {
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
