#!/usr/bin/env node
/**
 * qandeel-founder — the Founder Command Center launcher. Runs under the signed Node runtime; no shell,
 * no service installation, no LAN port.
 *
 *   serve --workspace <dir> [--port <n>] [--fake-provider <code>]...
 *         starts the Company runtime and the loopback Founder surface, prints the launch URL as JSON
 *         (the token is single-use and expires in 90 seconds) and keeps running until Ctrl+C.
 *   launch --workspace <dir>
 *         mints a fresh launch token for an already-running surface and prints its URL (same workspace,
 *         same Windows user: the file boundary is the trust anchor).
 *
 * Output is content-free JSON. A Founder reference typed on the command line is never authentication:
 * this CLI has no approve / reject / register command.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isQandeelError } from '@qandeel-company/domain';
import { CompanyStore, FounderAuthStore } from '@qandeel-company/storage';
import { Logger, jsonLinesSink } from '@qandeel-company/runtime';

import { FounderSurface } from './surface.js';

const USAGE = 'usage: qandeel-founder <serve|launch> --workspace <dir> [--port <n>] [--fake-provider <code>]';

function out(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(code: string, message: string, exit = 1): never {
  process.stderr.write(`${JSON.stringify({ ok: false, code, message })}\n`);
  process.exit(exit);
}

export async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: rest, strict: true, options: { workspace: { type: 'string' }, port: { type: 'string' }, 'fake-provider': { type: 'string', multiple: true }, 'fake-driver': { type: 'string', multiple: true } } });
  if (command === undefined || values.workspace === undefined) fail('USAGE', USAGE, 2);
  const workspace = path.resolve(values.workspace);
  switch (command) {
    case 'serve': {
      const port = values.port === undefined ? 0 : Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) fail('USAGE', '--port must be an integer in [0, 65535]', 2);
      const logger = new Logger(jsonLinesSink((line) => process.stdout.write(line)));
      const surface = new FounderSurface({
        workspace,
        port,
        runtime: { logger },
        fakes: { providers: values['fake-provider'] ?? [], drivers: values['fake-driver'] ?? [] },
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
      out({ ok: true, command, origin: surface.origin, launchUrl: surface.launchUrl(), state: surface.runtime.state });
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
    fail('UNCLASSIFIED_ERROR', 'command failed');
  });
}
