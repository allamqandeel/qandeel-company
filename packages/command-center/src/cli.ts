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
 *   launch --workspace <dir>
 *         mints a fresh launch token for an already-running surface and prints its URL (same workspace,
 *         same Windows user: the file boundary is the trust anchor).
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
import { DEEPSEEK_FLASH_PRICE_CARD, DEEPSEEK_MODEL_CODE, DEEPSEEK_PROVIDER_CODE, DEEPSEEK_V41_FLASH_PROFILE, DeepSeekHttpsTransport, DeepSeekProviderAdapter, PROBE_MAX_TOKENS, PROBE_THINKING_MAX_TOKENS } from '@qandeel-company/model-providers';
import { Logger, jsonLinesSink } from '@qandeel-company/runtime';
import { VaultError, WindowsUserVault } from '@qandeel-company/secret-vault';
import { CompanyStore, FounderAuthStore, GovernanceStore } from '@qandeel-company/storage';

import { FounderSurface } from './surface.js';

const USAGE = 'usage: qandeel-founder <serve|launch|provider-check> --workspace <dir> [--port <n>] [--fake-provider <code>] [--provider deepseek] [--probe] [--probe-class E1|E2|E3|E4]';

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(code: string, message: string, exit = 1): never {
  process.stderr.write(`${JSON.stringify({ ok: false, code, message })}\n`);
  process.exit(exit);
}

/** The live providers a host may wire (L1-01: DeepSeek only; a second provider is a Founder decision). */
function liveProvider(code: string): { adapter: ProviderAdapter & DeepSeekProviderAdapter; profile: ProviderProvisioningProfile } {
  if (code !== DEEPSEEK_PROVIDER_CODE) fail('USAGE', `unknown live provider "${code}" (L1-01 wires only ${DEEPSEEK_PROVIDER_CODE})`, 2);
  if (!WindowsUserVault.available()) fail('VAULT_UNAVAILABLE', 'the live provider needs the Windows user vault (DPAPI, CurrentUser)');
  return { adapter: new DeepSeekProviderAdapter({ vault: new WindowsUserVault(), transport: new DeepSeekHttpsTransport() }), profile: DEEPSEEK_V41_FLASH_PROFILE };
}

export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: rest, strict: true, options: { workspace: { type: 'string' }, port: { type: 'string' }, 'fake-provider': { type: 'string', multiple: true }, 'fake-driver': { type: 'string', multiple: true }, provider: { type: 'string', multiple: true }, probe: { type: 'boolean', default: false }, 'probe-class': { type: 'string', default: 'E1' } } });
  if (!['E1', 'E2', 'E3', 'E4'].includes(values['probe-class'] as string)) fail('USAGE', '--probe-class takes E1, E2, E3 or E4', 2);
  if (command === undefined || values.workspace === undefined) fail('USAGE', USAGE, 2);
  const workspace = path.resolve(values.workspace);
  switch (command) {
    case 'serve': {
      const port = values.port === undefined ? 0 : Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) fail('USAGE', '--port must be an integer in [0, 65535]', 2);
      const logger = new Logger(jsonLinesSink((line) => process.stdout.write(line)));
      const live = [...new Set(values.provider ?? [])].map(liveProvider);
      const surface = new FounderSurface({
        workspace,
        port,
        runtime: { logger },
        fakes: { providers: values['fake-provider'] ?? [], drivers: values['fake-driver'] ?? [] },
        providers: live.map((l) => l.adapter),
        provisioningProfiles: live.map((l) => l.profile),
        log: (event, fields) => logger.info(event, fields),
      });
      let stopping = false;
      const stop = (): void => {
        if (stopping) return;
        stopping = true;
        void surface.stop().then(() => process.exit(0));
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      if (process.platform === 'win32') process.on('SIGBREAK', stop);
      await surface.start();
      out({ ok: true, command, origin: surface.origin, launchUrl: surface.launchUrl(), state: surface.runtime.state, liveProviders: live.map((l) => l.profile.provider.code), provisioningProfiles: live.map((l) => l.profile.code) });
      return; // the runtime heartbeat and the listener keep the process alive until a signal arrives
    }
    case 'launch': {
      const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
      try {
        const { token, expiresAt } = FounderAuthStore.for(store).mintLaunchToken();
        const port = values.port === undefined ? null : Number(values.port);
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
