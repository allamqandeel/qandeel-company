#!/usr/bin/env node
/**
 * qandeel-founder — the Founder Command Center launcher. Runs under the signed Node runtime; no shell,
 * no service installation, no LAN port.
 *
 *   serve --workspace <dir> [--port <n>] [--fake-provider <code>]... [--provider deepseek]
 *         starts the Company runtime and the loopback Founder surface, prints the launch URL as JSON
 *         (the token is single-use and expires in 90 seconds) and keeps running until Ctrl+C.
 *         `--provider deepseek` (L1-01) wires the real DeepSeek adapter behind the Windows user vault
 *         (`vault:deepseek-company`) and registers the release-pinned DeepSeek V4.1 Flash provisioning
 *         profile for the governed `PROVIDER_PROVISION` confirmation. No key is ever read here.
 *         OPS: every `serve` is the workspace's ONE Founder host — it refuses to start beside a live host
 *         (HOST_ALREADY_RUNNING), publishes the content-free host descriptor and accepts a controlled stop.
 *         `--background` is how the launcher starts it: detached, logging to the workspace's content-free host
 *         log, reporting readiness once over IPC, printing no launch URL.
 *   launch --workspace <dir>
 *         mints a fresh launch token for an already-running surface and prints its URL (same workspace,
 *         same Windows user: the file boundary is the trust anchor).
 *
 * OPS — the Founder's Windows operation (no terminal: the shortcuts run these with `--notify`):
 *   open    [--workspace <dir>] [--provider deepseek] [--no-browser] [--notify]
 *         reuse the running host or start exactly one (bounded readiness), mint a fresh launch token and open the
 *         Command Center in an Edge / Chrome app window; the launcher exits, the host keeps running.
 *   status  [--workspace <dir>] [--notify]       RUNNING / STARTING / STOPPED / STALE / HELD / … (content-free)
 *   stop    [--workspace <dir>] [--force] [--notify]   controlled shutdown of the verified host (`--force` only
 *         terminates a host that does not answer the controlled stop; startup recovery handles the rest)
 *   restart [--workspace <dir>] [--no-browser] [--notify]   controlled stop, then open
 *   install-shortcuts --workspace <dir> [--provider deepseek]
 *         records the production workspace in %LOCALAPPDATA%\QANDEEL_COMPANY\launcher\founder-launcher.json (no secret) and
 *         writes the per-user Desktop and Start-menu QANDEEL COMPANY shortcuts (no elevation, no autostart). The
 *         shortcuts always run the workspace's ACTIVATED release, never this checkout (D-OPS-08).
 *
 * OPS — the production runtime release (D-OPS-08):
 *   release-stage [--releases-dir <dir>]
 *         freezes the current build into a content-addressed release outside the checkout
 *         (%LOCALAPPDATA%\QANDEEL_COMPANY\releases\<id>), after the operator's Build → Test (`npm run ci`).
 *   release-activate --workspace <dir> --release <id | dir> [--provider deepseek] [--releases-dir <dir>] [--no-shortcuts]
 *         the controlled activation: verify → dry run → controlled stop → verified backup → pin → start from the release
 *         (schema safe-upgrade inside) → health → shortcuts; any failure after the pin rolls back to the previous release.
 *   release-status --workspace <dir>      the pin, the pinned release's integrity, and whether THIS build is admitted.
 *   release-check --workspace <dir>       (the activation's dry run, run from the staged release itself)
 *   Without --workspace these read the launcher configuration (`--config <file>` names another one).
 *   provider-check --workspace <dir> --provider deepseek [--probe] [--probe-class E1|E2|E3|E4]
 *         the operator's content-free identity check (L1-01, D-L1-05): resolves the vault reference, asks
 *         the provider what the model alias currently names, records the verdict in the workspace (a system
 *         fact, never Founder authority) and prints it. `--probe` adds one tiny bounded call (non-thinking by
 *         default; `--probe-class E2|E3|E4` sends the official thinking fields under a small ceiling, to
 *         qualify the wire contract) and prints its metering only. Prints no model text, no key, no body.
 *
 * D1 — QANDEEL COMPANY Desktop v1 (D-D1-08: the supported Founder-local install runs only signed binaries):
 *   desktop-local-install --bundle <Desktop bundle dir> [--workspace <existing Company>] [--provider deepseek]
 *         run with the bundle's own node.exe: the existing Company only (read-only check first) → the verified copy into
 *         %LOCALAPPDATA%\Programs\QANDEEL COMPANY\versions\<version> → desktop-install by the INSTALLED copy → the per-user
 *         Windows "Apps" entry. First install, update, repair and reinstall.
 *   desktop-local-uninstall   (run by the "Apps" entry's command) the application-only uninstall; that command then
 *         removes the program directory once this runtime has exited.
 *   Setup.exe (optional engineering artifact) runs the two below:
 *   desktop-install --bundle <installed version dir> [--workspace <existing Company>] [--provider deepseek] [--shortcut-root <dir>]
 *         verify the bundle → the existing Company only → import the bundled release → the canonical activation above →
 *         shortcuts on the bundle's private runtime. First install, update, repair and reinstall are this one path.
 *   desktop-uninstall [--shortcut-root <dir>]   controlled stop + shortcuts removed; Company data is never touched.
 *
 * D2-CTRL-01 — lifecycle control inside the Command Center window (D-D2-01):
 *   desktop-control --workspace <dir>   (started by the RUNNING host for an authenticated Founder Stop / Restart, armed
 *         over IPC only; refuses to run otherwise) the stopped-state desktop controller: the window's local Stop / Start /
 *         Restart through the canonical launcher operations of the configured Company. No Company runtime, no Founder API.
 *
 * Output is content-free JSON. A Founder reference typed on the command line is never authentication:
 * this CLI has no approve / reject / register command.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isQandeelError } from '@qandeel-company/domain';
import { worstCase, type ProviderAdapter, type ProviderProvisioningProfile } from '@qandeel-company/governance';
import { DEEPSEEK_FLASH_PRICE_CARD, DEEPSEEK_MODEL_CODE, DEEPSEEK_PROVIDER_CODE, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DEEPSEEK_V41_FLASH_PROFILE, DEEPSEEK_V41_FLASH_REASONING_PROFILE, DeepSeekHttpsTransport, DeepSeekProviderAdapter, PROBE_MAX_TOKENS, PROBE_THINKING_MAX_TOKENS } from '@qandeel-company/model-providers';
import { Logger, admitRuntimeRelease, jsonLinesSink, selfReleaseRoot, verifyReleaseTree } from '@qandeel-company/runtime';
import { VaultError, WindowsUserVault } from '@qandeel-company/secret-vault';
import { CompanyStore, FounderAuthStore, GovernanceStore } from '@qandeel-company/storage';

import { hostPaths, readDescriptor } from './host/descriptor.js';
import { discoverHost, installShortcuts, launcherConfigDir, launcherConfigPath, noticeFor, notify, openCompany, readLauncherConfig, restartHost, statusNotice, stopHost, writeLauncherConfig } from './host/lifecycle.js';
import { desktopInstall, desktopLocalInstall, desktopUninstall } from './host/desktop.js';
import { DesktopController, acquireDesktopControl, armDesktopController, configuredCompany, type DesktopIntent } from './host/desktop-control.js';
import { activateRelease, releaseCli, releaseStatus, releasesDir, resolveRelease, stageRelease } from './host/release.js';
import { defaultStaticRoots } from './static.js';
import { FounderSurface } from './surface.js';

const USAGE = 'usage: qandeel-founder <serve|launch|provider-check|open|status|stop|restart|install-shortcuts|release-stage|release-activate|release-status|release-check|desktop-local-install|desktop-local-uninstall|desktop-install|desktop-uninstall|desktop-control> [--workspace <dir>] [--port <n>] [--fake-provider <code>] [--provider deepseek] [--probe] [--probe-class E1|E2|E3|E4] [--background] [--no-browser] [--notify] [--force] [--config <file>] [--release <id|dir>] [--releases-dir <dir>] [--no-shortcuts] [--bundle <dir>] [--shortcut-root <dir>] [--uninstall-key <HKCU key>]';
const DESKTOP_COMMANDS = ['desktop-local-install', 'desktop-local-uninstall', 'desktop-install', 'desktop-uninstall'];
const LAUNCHER_COMMANDS = ['open', 'status', 'stop', 'restart'];
/** A host for this workspace already exists (or is coming up): a second `serve` never starts beside it. */
const HOST_PRESENT = ['RUNNING', 'STARTING', 'STOPPING', 'UNHEALTHY', 'FOREIGN_RUNTIME'];

function selfPath(): string {
  return realpathSync(fileURLToPath(import.meta.url));
}

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(code: string, message: string, exit = 1): never {
  process.stderr.write(`${JSON.stringify({ ok: false, code, message })}\n`);
  process.exit(exit);
}

/** The live providers a host may wire (L1-01: DeepSeek only; a second provider is a Founder decision). */
function liveProvider(code: string): { adapter: ProviderAdapter & DeepSeekProviderAdapter; profile: ProviderProvisioningProfile; profiles: readonly ProviderProvisioningProfile[] } {
  if (code !== DEEPSEEK_PROVIDER_CODE) fail('USAGE', `unknown live provider "${code}" (L1-01 wires only ${DEEPSEEK_PROVIDER_CODE})`, 2);
  if (!WindowsUserVault.available()) fail('VAULT_UNAVAILABLE', 'the live provider needs the Windows user vault (DPAPI, CurrentUser)');
  // L1-02 (D-L1-14): the versioned activation profile (E1 / E2 and the Academy task classes) is offered beside the unchanged
  // L1-01 profile; a provider is provisioned once, by the Founder's explicit choice. Both share one model identity.
  // P1-CHAT-INTEL-01: the additive E3 / E4 conversation profile extends an already provisioned provider (never re-provisions).
  return { adapter: new DeepSeekProviderAdapter({ vault: new WindowsUserVault(), transport: new DeepSeekHttpsTransport() }), profile: DEEPSEEK_V41_FLASH_PROFILE, profiles: [DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DEEPSEEK_V41_FLASH_PROFILE, DEEPSEEK_V41_FLASH_REASONING_PROFILE] };
}

/** Whether every configured live provider's vault reference holds a value (a file check: no key is read or decrypted). */
async function providersReady(codes: readonly string[]): Promise<boolean> {
  for (const code of codes) {
    if (code !== DEEPSEEK_PROVIDER_CODE || !WindowsUserVault.available()) return false;
    const vault = new WindowsUserVault();
    const ref = new DeepSeekProviderAdapter({ vault, transport: new DeepSeekHttpsTransport() }).credentialRef;
    if (!(await vault.has(ref))) return false;
  }
  return true;
}

/** Whether this build may start the workspace's Company: ADMITTED, or the refusal reason (content-free). */
function admission(workspace: string): string {
  try {
    admitRuntimeRelease(workspace);
    return 'ADMITTED';
  } catch (error) {
    if (isQandeelError(error, 'RUNTIME_RELEASE_REFUSED')) return String(error.details.reason ?? 'REFUSED');
    return isQandeelError(error) ? error.code : 'UNCLASSIFIED_ERROR';
  }
}

interface LauncherValues {
  readonly workspace?: string | undefined;
  readonly provider?: string[] | undefined;
  readonly 'no-browser'?: boolean | undefined;
  readonly notify?: boolean | undefined;
  readonly force?: boolean | undefined;
  readonly config?: string | undefined;
}

/** OPS launcher commands: discover / open / stop / restart the ONE Founder host (content-free JSON, optional notice). */
async function launcher(command: string, values: LauncherValues): Promise<void> {
  const config = values.workspace === undefined ? readLauncherConfig(values.config === undefined ? launcherConfigPath() : path.resolve(values.config)) : null;
  const workspaceArg = values.workspace ?? config?.workspace;
  if (workspaceArg === undefined) {
    out({ ok: false, command, outcome: 'NOT_CONFIGURED' });
    if (values.notify) await notify(noticeFor(command, 'NOT_CONFIGURED'));
    process.exitCode = 1;
    return;
  }
  const workspace = path.resolve(workspaceArg);
  const providers = [...new Set(values.provider ?? config?.providers ?? [])];
  for (const p of providers) if (p !== DEEPSEEK_PROVIDER_CODE) fail('USAGE', `unknown live provider "${p}"`, 2);
  const start = { cliPath: selfPath(), providers, browser: values['no-browser'] !== true };
  if (command === 'status') {
    const status = await discoverHost(workspace);
    out({ ok: true, command, ...status, release: releaseStatus(workspace), admitted: admission(workspace) });
    if (values.notify) await notify(statusNotice(status));
    return;
  }
  // D-OPS-08: only the activated, intact release may start a pinned Company (the runtime re-checks at start). A stop is
  // always allowed: it only asks the running host to shut down gracefully.
  if (command !== 'stop') {
    const admitted = admission(workspace);
    if (admitted !== 'ADMITTED') {
      out({ ok: false, command, outcome: 'RUNTIME_RELEASE_REFUSED', reason: admitted, workspace });
      if (values.notify) await notify(noticeFor(command, 'RUNTIME_RELEASE_REFUSED'));
      process.exitCode = 1;
      return;
    }
  }
  const result = command === 'open' ? await openCompany(workspace, start) : command === 'stop' ? await stopHost(workspace, { force: values.force === true }) : await restartHost(workspace, { ...start, force: values.force === true });
  let outcome = result.outcome;
  if (result.ok && command !== 'stop' && providers.length > 0 && !(await providersReady(providers))) outcome = 'PROVIDER_NOT_READY';
  out({ ok: result.ok, command, outcome, state: result.status.state, instanceId: result.status.instanceId, origin: result.status.origin, started: result.started ?? false, browser: result.browser ?? null, hold: result.status.hold, reason: result.status.reason, workspace: result.status.workspace, ...(result.launchUrl !== undefined ? { launchUrl: result.launchUrl, expiresAt: result.expiresAt } : {}) });
  if (values.notify) await notify(noticeFor(command, outcome));
  if (!result.ok) process.exitCode = 1;
}

/**
 * D2-CTRL-01: the stopped-state desktop controller. It runs only when the RUNNING host started it with an IPC channel and
 * arms it there (the ticket's hash never travels as an argument); it acts only on the configured Company, with the
 * configured providers, through the canonical launcher operations of THIS release's CLI.
 */
async function desktopControl(workspace: string): Promise<void> {
  const send = (message: Record<string, unknown>): void => {
    if (typeof process.send === 'function' && process.connected) process.send(message);
  };
  if (typeof process.send !== 'function') fail('USAGE', 'desktop-control is started by the running host only', 2);
  const company = configuredCompany(workspace);
  if (company === null) {
    send({ type: 'failed', code: 'DESKTOP_CONTROL_UNAVAILABLE' });
    fail('DESKTOP_CONTROL_UNAVAILABLE', 'the launcher configuration does not name this workspace');
  }
  const release = acquireDesktopControl(company.workspace);
  if (release === null) {
    send({ type: 'failed', code: 'DESKTOP_CONTROL_BUSY' });
    fail('DESKTOP_CONTROL_BUSY', 'a desktop controller already runs for this workspace');
  }
  const logger = new Logger(jsonLinesSink((line) => process.stdout.write(line)));
  const controller = new DesktopController({
    workspace: company.workspace,
    cliPath: selfPath(),
    providers: company.providers,
    roots: defaultStaticRoots(),
    admit: () => admission(company.workspace),
    log: (event, fields) => logger.info(event, fields),
    onExit: () => {
      release();
      process.exit(0);
    },
  });
  const arm = await new Promise<{ ticketHash: string; intent: DesktopIntent } | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 10_000);
    process.once('message', (m: { type?: unknown; ticketHash?: unknown; intent?: unknown }) => {
      clearTimeout(timer);
      resolve(m?.type === 'arm' && typeof m.ticketHash === 'string' && (m.intent === 'STOP' || m.intent === 'RESTART') ? { ticketHash: m.ticketHash, intent: m.intent } : null);
    });
  });
  if (arm === null) {
    release();
    send({ type: 'failed', code: 'DESKTOP_CONTROL_ARM_INVALID' });
    fail('DESKTOP_CONTROL_ARM_INVALID', 'the controller was not armed');
  }
  try {
    controller.arm(arm.ticketHash, arm.intent);
    await controller.listen();
  } catch {
    release();
    send({ type: 'failed', code: 'DESKTOP_CONTROL_FAILED' });
    fail('DESKTOP_CONTROL_FAILED', 'the controller could not listen');
  }
  logger.info('desktop_control.listening', { port: controller.port, intent: arm.intent });
  send({ type: 'listening', port: controller.port });
  if (process.connected) process.disconnect();
  const end = (): void => controller.close();
  process.on('SIGINT', end);
  process.on('SIGTERM', end);
  if (process.platform === 'win32') process.on('SIGBREAK', end);
}

export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: rest, strict: true, options: { workspace: { type: 'string' }, port: { type: 'string' }, 'fake-provider': { type: 'string', multiple: true }, 'fake-driver': { type: 'string', multiple: true }, provider: { type: 'string', multiple: true }, probe: { type: 'boolean', default: false }, 'probe-class': { type: 'string', default: 'E1' }, background: { type: 'boolean', default: false }, 'no-browser': { type: 'boolean', default: false }, notify: { type: 'boolean', default: false }, force: { type: 'boolean', default: false }, config: { type: 'string' }, release: { type: 'string' }, 'releases-dir': { type: 'string' }, 'no-shortcuts': { type: 'boolean', default: false }, bundle: { type: 'string' }, 'shortcut-root': { type: 'string' }, 'uninstall-key': { type: 'string' } } });
  if (!['E1', 'E2', 'E3', 'E4'].includes(values['probe-class'] as string)) fail('USAGE', '--probe-class takes E1, E2, E3 or E4', 2);
  if (command !== undefined && LAUNCHER_COMMANDS.includes(command)) return launcher(command, values);
  if (command === 'release-stage') {
    // The checkout this CLI was built in (packages/command-center/dist/src/cli.js → the repository root).
    if (selfReleaseRoot() !== null) fail('RELEASE_STAGE_REFUSED', 'release-stage runs from a development checkout, not from a release');
    const source = path.resolve(path.dirname(selfPath()), '..', '..', '..', '..');
    try {
      out({ ok: true, command, ...stageRelease(source, values['releases-dir'] === undefined ? releasesDir() : path.resolve(values['releases-dir'])) });
    } catch (error) {
      fail(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'RELEASE_STAGE_FAILED', 'the current build could not be staged as a release');
    }
    return;
  }
  if (DESKTOP_COMMANDS.includes(command ?? '')) {
    // D1: run under a Desktop bundle's private runtime — by the Founder-local install, Windows "Apps", or Setup.exe
    // (never with a secret).
    const providers = values.provider === undefined ? undefined : [...new Set(values.provider)];
    for (const p of providers ?? []) if (p !== DEEPSEEK_PROVIDER_CODE) fail('USAGE', `unknown live provider "${p}"`, 2);
    const shortcutRoot = values['shortcut-root'] === undefined ? {} : { shortcutRoot: path.resolve(values['shortcut-root']) };
    const uninstallKey = values['uninstall-key'] === undefined ? {} : { uninstallKey: values['uninstall-key'] };
    const install = command === 'desktop-install' || command === 'desktop-local-install';
    if (install && values.bundle === undefined) fail('USAGE', `${command} needs --bundle <Desktop bundle directory>`, 2);
    const installOptions = { bundleDir: path.resolve(values.bundle ?? '.'), ...(values.workspace === undefined ? {} : { workspace: values.workspace }), ...(providers === undefined ? {} : { providers }), ...shortcutRoot };
    const r =
      command === 'desktop-install'
        ? await desktopInstall(installOptions)
        : command === 'desktop-local-install'
          ? await desktopLocalInstall({ ...installOptions, ...uninstallKey })
          : command === 'desktop-local-uninstall'
            ? await desktopUninstall(shortcutRoot)
            : await desktopUninstall(shortcutRoot);
    out({ command, ...r });
    if (values.notify) await notify(noticeFor(command as string, r.outcome));
    // Setup reads the exit code: 0 done, 2 setup required (no existing Company chosen), 1 any other bounded failure.
    if (!r.ok) process.exitCode = r.outcome === 'SETUP_REQUIRED' ? 2 : 1;
    return;
  }
  if (command === undefined || values.workspace === undefined) fail('USAGE', USAGE, 2);
  const workspace = path.resolve(values.workspace);
  if (command === 'desktop-control') return desktopControl(workspace);
  switch (command) {
    case 'serve': {
      const port = values.port === undefined ? 0 : Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) fail('USAGE', '--port must be an integer in [0, 65535]', 2);
      const background = values.background === true;
      // --background: readiness (or the refusal code) goes once to the launcher over IPC, then the channel is dropped.
      const report = (message: { type: 'ready' | 'failed'; code?: string; instanceId?: string; port?: number }): Promise<void> =>
        new Promise((resolve) => {
          if (!background || typeof process.send !== 'function' || !process.connected) return resolve();
          const timer = setTimeout(resolve, 1_000);
          process.send(message, undefined, {}, () => {
            clearTimeout(timer);
            resolve();
          });
        });
      // Single instance (OPS): one host per workspace. The durable supervisor lease would hold a second runtime off
      // anyway; refusing here keeps a second process from even registering an instance.
      const existing = await discoverHost(workspace);
      if (HOST_PRESENT.includes(existing.state)) {
        await report({ type: 'failed', code: 'HOST_ALREADY_RUNNING' });
        fail('HOST_ALREADY_RUNNING', `a Founder host already runs for this workspace (${existing.state})`, 3);
      }
      const logger = new Logger(jsonLinesSink((line) => process.stdout.write(line)));
      const live = [...new Set(values.provider ?? [])].map(liveProvider);
      let stopping = false;
      let surface: FounderSurface | null = null;
      const stop = (code = 0): void => {
        if (stopping) return;
        stopping = true;
        void (surface ? surface.stop() : Promise.resolve()).then(
          () => process.exit(code),
          () => process.exit(code === 0 ? 1 : code),
        );
      };
      surface = new FounderSurface({
        workspace,
        port,
        // A fail-stopped runtime (e.g. supervisor authority taken over) ends the host: it never lingers as a zombie surface.
        runtime: {
          logger,
          onFailStop: (code) => {
            logger.error('founder.host_fail_stopped', { code });
            stop(1);
          },
        },
        fakes: { providers: values['fake-provider'] ?? [], drivers: values['fake-driver'] ?? [] },
        providers: live.map((l) => l.adapter),
        provisioningProfiles: live.flatMap((l) => l.profiles),
        log: (event, fields) => logger.info(event, fields),
        host: {
          onStopRequested: () => stop(0),
          // D2-CTRL-01: the window's own lifecycle control (an authenticated Founder request; see host/desktop-control.ts).
          desktop: {
            status: () => {
              const release = releaseStatus(workspace);
              return { available: configuredCompany(workspace) !== null, state: 'RUNNING', runtimeState: surface?.runtime.state ?? null, instanceId: surface?.runtime.instanceId ?? null, release: { pinned: release.pinned, releaseId: release.releaseId, intact: release.intact }, admitted: admission(workspace) };
            },
            control: (intent: DesktopIntent) => armDesktopController({ workspace, cliPath: selfPath(), intent }),
          },
        },
      });
      process.on('SIGINT', () => stop(0));
      process.on('SIGTERM', () => stop(0));
      if (process.platform === 'win32') process.on('SIGBREAK', () => stop(0));
      try {
        await surface.start();
      } catch (error) {
        await report({ type: 'failed', code: isQandeelError(error) ? error.code : 'HOST_START_FAILED' });
        throw error;
      }
      const facts = { ok: true, command, origin: surface.origin, instanceId: surface.runtime.instanceId, state: surface.runtime.state, liveProviders: live.map((l) => l.profile.provider.code), provisioningProfiles: live.flatMap((l) => l.profiles.map((p) => p.code)), workspace };
      if (background) {
        out({ ...facts, background: true }); // to the content-free host log: no launch URL, no token
        await report({ type: 'ready', instanceId: surface.runtime.instanceId, port: surface.listener.port });
        if (process.connected) process.disconnect();
      } else {
        out({ ...facts, launchUrl: surface.launchUrl() });
      }
      return; // the runtime heartbeat and the listener keep the process alive until a stop arrives
    }
    case 'launch': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const { token, expiresAt } = FounderAuthStore.for(store).mintLaunchToken();
        // OPS: the running host's descriptor names its port, so the printed URL is complete.
        const descriptor = readDescriptor(hostPaths(workspace));
        const port = values.port === undefined ? (descriptor?.port ?? null) : Number(values.port);
        out({ ok: true, command, expiresAt, launchUrl: port === null ? `http://127.0.0.1:<port>/launch#${token}` : `http://127.0.0.1:${port}/launch#${token}` });
      } finally {
        store.close();
      }
      return;
    }
    case 'provider-check': {
      const codes = [...new Set(values.provider ?? [])];
      if (codes.length !== 1) fail('USAGE', 'provider-check takes exactly one --provider', 2);
      const { adapter, profile } = liveProvider(codes[0] as string);
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const gov = GovernanceStore.for(store);
        const check = await adapter.checkIdentity();
        const record = gov.recordModelIdentityCheck({ providerCode: profile.provider.code, modelCode: profile.model.code, expectedName: profile.model.expectedPublicName, observedName: check.observedName, observedContextWindow: check.observedContextWindow, observedMaxOutputTokens: check.observedMaxOutputTokens, result: check.result });
        const result: Record<string, unknown> = { ok: check.result === 'MATCH', command, provider: profile.provider.code, model: DEEPSEEK_MODEL_CODE, credentialRef: adapter.credentialRef, result: check.result, expectedName: check.expectedName, observedName: check.observedName, observedContextWindow: check.observedContextWindow, observedMaxOutputTokens: check.observedMaxOutputTokens, checkId: record.id, checkedAt: record.checkedAt };
        if (values.probe && check.result === 'MATCH') {
          const probeClass = values['probe-class'] as 'E1' | 'E2' | 'E3' | 'E4';
          const probe = await adapter.probe(undefined, probeClass);
          const card = { id: 'profile', version: 0, ...DEEPSEEK_FLASH_PRICE_CARD };
          const reserved = worstCase(card, 64, probeClass === 'E1' ? PROBE_MAX_TOKENS : PROBE_THINKING_MAX_TOKENS);
          result.probe = { reasoningClass: probeClass, usage: probe.usage, outputChars: probe.outputChars, peakWorstCaseMicros: reserved.billedMicros, note: 'metering only; the answer text is never printed or stored' };
        }
        out(result);
        // The exit status is set, never forced: the vault's PowerShell child and the HTTPS socket close on their own
        // (a hard exit while those handles close trips the runtime's handle assertion on Windows).
        if (check.result !== 'MATCH') process.exitCode = 1;
      } finally {
        store.close();
      }
      return;
    }
    case 'release-check': {
      // The activation's dry run, executed by the STAGED release's own code: it loads, verifies itself, reads the schema.
      const self = selfReleaseRoot();
      const verified = self === null ? null : verifyReleaseTree(self);
      if (verified === null || !verified.ok) {
        out({ ok: false, command, reason: verified === null ? 'NOT_A_RELEASE' : verified.reason });
        process.exitCode = 1;
        return;
      }
      let schema = 'CURRENT';
      try {
        CompanyStore.open(workspace, { create: false, migrationMode: 'verify' }).close();
      } catch (error) {
        schema = isQandeelError(error, 'SCHEMA_UPDATE_REQUIRED') ? 'UPDATE_REQUIRED' : isQandeelError(error) ? error.code : 'UNCLASSIFIED_ERROR';
      }
      const ok = schema === 'CURRENT' || schema === 'UPDATE_REQUIRED';
      out({ ok, command, releaseId: verified.manifest.releaseId, runtimeVersion: verified.manifest.runtimeVersion, schema });
      if (!ok) process.exitCode = 1;
      return;
    }
    case 'release-status': {
      out({ ok: true, command, workspace, ...releaseStatus(workspace), admitted: admission(workspace) });
      return;
    }
    case 'release-activate': {
      if (values.release === undefined) fail('USAGE', '--release <id | directory> is required (see release-stage)', 2);
      const providers = [...new Set(values.provider ?? [])];
      for (const p of providers) if (p !== DEEPSEEK_PROVIDER_CODE) fail('USAGE', `unknown live provider "${p}"`, 2);
      const root = resolveRelease(values.release, values['releases-dir'] === undefined ? releasesDir() : path.resolve(values['releases-dir']));
      if (root === null) fail('RELEASE_NOT_FOUND', 'no single staged release matches --release');
      const r = await activateRelease(workspace, root, { providers, shortcuts: values['no-shortcuts'] !== true });
      out({ command, ok: r.ok, outcome: r.outcome, code: r.code, releaseId: r.releaseId, previousReleaseId: r.previousReleaseId, backupId: r.backupId, steps: r.steps, state: r.status?.state ?? null, instanceId: r.status?.instanceId ?? null });
      if (!r.ok) process.exitCode = 1;
      return;
    }
    case 'install-shortcuts': {
      const status = await discoverHost(workspace);
      if (status.state === 'WORKSPACE_MISSING' || status.state === 'WORKSPACE_INVALID') fail(status.state, 'install-shortcuts needs an existing Company workspace (nothing is created)');
      // D-OPS-08: the shortcuts run the workspace's activated release — never this (possibly development) build.
      const release = releaseStatus(status.workspace);
      if (values.config === undefined && (release.root === null || release.intact !== true)) fail('RUNTIME_RELEASE_NOT_ACTIVATED', 'activate a release for this workspace first (release-stage, then release-activate)');
      const providers = [...new Set(values.provider ?? [])];
      for (const p of providers) if (p !== DEEPSEEK_PROVIDER_CODE) fail('USAGE', `unknown live provider "${p}"`, 2);
      const file = values.config === undefined ? launcherConfigPath() : path.resolve(values.config);
      writeLauncherConfig(file, { version: 1, workspace: status.workspace, providers });
      // An explicit --config writes only that file (tests, a second configuration); the shortcuts use the default one.
      const shortcuts = process.platform === 'win32' && values.config === undefined && release.root !== null ? await installShortcuts(releaseCli(release.root), launcherConfigDir()) : null;
      out({ ok: shortcuts !== null || values.config !== undefined, command, config: file, workspace: status.workspace, providers, releaseId: release.releaseId, shortcuts });
      if (shortcuts === null && values.config === undefined) process.exitCode = 1;
      return;
    }
    default:
      fail('USAGE', USAGE, 2);
  }
}

const invokedDirectly = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    if (isQandeelError(error)) fail(error.code, error.message);
    if (error instanceof VaultError) fail(error.code, error.message);
    fail('UNCLASSIFIED_ERROR', 'command failed');
  });
}
