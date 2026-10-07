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
 *         writes the per-user Desktop and Start-menu QANDEEL COMPANY shortcuts (no elevation, no autostart).
 *   Without --workspace these read the launcher configuration (`--config <file>` names another one).
 *   provider-check --workspace <dir> --provider deepseek [--probe] [--probe-class E1|E2|E3|E4]
 *         the operator's content-free identity check (L1-01, D-L1-05): resolves the vault reference, asks
 *         the provider what the model alias currently names, records the verdict in the workspace (a system
 *         fact, never Founder authority) and prints it. `--probe` adds one tiny bounded call (non-thinking by
 *         default; `--probe-class E2|E3|E4` sends the official thinking fields under a small ceiling, to
 *         qualify the wire contract) and prints its metering only. Prints no model text, no key, no body.
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
import { DEEPSEEK_FLASH_PRICE_CARD, DEEPSEEK_MODEL_CODE, DEEPSEEK_PROVIDER_CODE, DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DEEPSEEK_V41_FLASH_PROFILE, DeepSeekHttpsTransport, DeepSeekProviderAdapter, PROBE_MAX_TOKENS, PROBE_THINKING_MAX_TOKENS } from '@qandeel-company/model-providers';
import { Logger, jsonLinesSink } from '@qandeel-company/runtime';
import { VaultError, WindowsUserVault } from '@qandeel-company/secret-vault';
import { CompanyStore, FounderAuthStore, GovernanceStore } from '@qandeel-company/storage';

import { hostPaths, readDescriptor } from './host/descriptor.js';
import { discoverHost, installShortcuts, launcherConfigDir, launcherConfigPath, noticeFor, notify, openCompany, readLauncherConfig, restartHost, statusNotice, stopHost, writeLauncherConfig } from './host/lifecycle.js';
import { FounderSurface } from './surface.js';

const USAGE = 'usage: qandeel-founder <serve|launch|provider-check|open|status|stop|restart|install-shortcuts> [--workspace <dir>] [--port <n>] [--fake-provider <code>] [--provider deepseek] [--probe] [--probe-class E1|E2|E3|E4] [--background] [--no-browser] [--notify] [--force] [--config <file>]';
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
  return { adapter: new DeepSeekProviderAdapter({ vault: new WindowsUserVault(), transport: new DeepSeekHttpsTransport() }), profile: DEEPSEEK_V41_FLASH_PROFILE, profiles: [DEEPSEEK_V41_FLASH_ACADEMY_PROFILE, DEEPSEEK_V41_FLASH_PROFILE] };
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
    out({ ok: true, command, ...status });
    if (values.notify) await notify(statusNotice(status));
    return;
  }
  const result = command === 'open' ? await openCompany(workspace, start) : command === 'stop' ? await stopHost(workspace, { force: values.force === true }) : await restartHost(workspace, { ...start, force: values.force === true });
  let outcome = result.outcome;
  if (result.ok && command !== 'stop' && providers.length > 0 && !(await providersReady(providers))) outcome = 'PROVIDER_NOT_READY';
  out({ ok: result.ok, command, outcome, state: result.status.state, instanceId: result.status.instanceId, origin: result.status.origin, started: result.started ?? false, browser: result.browser ?? null, hold: result.status.hold, reason: result.status.reason, workspace: result.status.workspace, ...(result.launchUrl !== undefined ? { launchUrl: result.launchUrl, expiresAt: result.expiresAt } : {}) });
  if (values.notify) await notify(noticeFor(command, outcome));
  if (!result.ok) process.exitCode = 1;
}

export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: rest, strict: true, options: { workspace: { type: 'string' }, port: { type: 'string' }, 'fake-provider': { type: 'string', multiple: true }, 'fake-driver': { type: 'string', multiple: true }, provider: { type: 'string', multiple: true }, probe: { type: 'boolean', default: false }, 'probe-class': { type: 'string', default: 'E1' }, background: { type: 'boolean', default: false }, 'no-browser': { type: 'boolean', default: false }, notify: { type: 'boolean', default: false }, force: { type: 'boolean', default: false }, config: { type: 'string' } } });
  if (!['E1', 'E2', 'E3', 'E4'].includes(values['probe-class'] as string)) fail('USAGE', '--probe-class takes E1, E2, E3 or E4', 2);
  if (command !== undefined && LAUNCHER_COMMANDS.includes(command)) return launcher(command, values);
  if (command === undefined || values.workspace === undefined) fail('USAGE', USAGE, 2);
  const workspace = path.resolve(values.workspace);
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
        host: { onStopRequested: () => stop(0) },
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
    case 'install-shortcuts': {
      const status = await discoverHost(workspace);
      if (status.state === 'WORKSPACE_MISSING' || status.state === 'WORKSPACE_INVALID') fail(status.state, 'install-shortcuts needs an existing Company workspace (nothing is created)');
      const providers = [...new Set(values.provider ?? [])];
      for (const p of providers) if (p !== DEEPSEEK_PROVIDER_CODE) fail('USAGE', `unknown live provider "${p}"`, 2);
      const file = values.config === undefined ? launcherConfigPath() : path.resolve(values.config);
      writeLauncherConfig(file, { version: 1, workspace: status.workspace, providers });
      // An explicit --config writes only that file (tests, a second configuration); the shortcuts use the default one.
      const shortcuts = process.platform === 'win32' && values.config === undefined ? await installShortcuts(selfPath(), launcherConfigDir()) : null;
      out({ ok: shortcuts !== null || values.config !== undefined, command, config: file, workspace: status.workspace, providers, shortcuts });
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
