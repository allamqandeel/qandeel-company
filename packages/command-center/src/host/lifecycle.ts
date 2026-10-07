/**
 * The Founder host lifecycle (OPS — Operational / Desktop Packaging): discover, open, stop and restart the ONE Company
 * host of a production workspace, so the Founder never needs a terminal, a port or a workspace path.
 *
 * It adds no runtime and no authority. The host is the existing `qandeel-founder serve` (FounderSurface → the canonical
 * CompanyRuntime) started detached; single-instance stays the durable supervisor lease (D-C1-22), which the launcher reads
 * and never takes; startup recovery stays the runtime's own; the Founder session still begins with the canonical
 * single-use launch token redeemed by the existing `/launch` page.
 *
 * Discovery trusts no PID, port or file alone:
 *   lease live?  ──no──▶  STOPPED (no descriptor) | STALE (a crashed host's descriptor is left)
 *       │yes
 *   descriptor names the lease holder? ──no──▶ STARTING (holder still starting) | FOREIGN_RUNTIME | STALE (holder PID gone)
 *       │yes
 *   signed identity proof on the descriptor's port verifies? ──▶ RUNNING | STARTING (not READY yet) | UNHEALTHY | STALE
 *
 * D-OPS-09: an UNHEALTHY that a host disappearing this very moment can cause (the store not yet readable, or a holder not
 * answering) is re-classified a few times within a short bound before it is reported; the last reading is the answer. A
 * wrong identity is reported at once, a healthy host is never delayed, nothing is removed or ignored, and a holder that
 * is genuinely alive stays UNHEALTHY (never startable), so no second runtime starts beside it.
 *
 * Every outcome is content-free: states, codes, IDs, a PID and a loopback port.
 */
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { isQandeelError } from '@qandeel-company/domain';
import { CompanyStore, FounderAuthStore, layoutFor, restoreStatus } from '@qandeel-company/storage';

import { LOOPBACK_HOST } from '../security.js';
import { hostPaths, newNonce, readDescriptor, removeStaleDescriptor, verifyIdentityProof, writeJsonAtomic, writeStopRequest, type HostDescriptor, type HostPaths } from './descriptor.js';
import { serveLaunchHandoff } from './handoff.js';
import { probeIdentity, requestHostStop } from './probe.js';
import { openBrowser, pidAlive, showNotice, spawnHost, terminateProcess, writeShortcuts, type ShortcutSpec } from './processes.js';

export type HostState = 'RUNNING' | 'STARTING' | 'STOPPING' | 'STOPPED' | 'STALE' | 'UPDATE_REQUIRED' | 'HELD' | 'UNHEALTHY' | 'FOREIGN_RUNTIME' | 'WORKSPACE_MISSING' | 'WORKSPACE_INVALID';

export interface HostStatus {
  readonly state: HostState;
  readonly workspace: string;
  readonly instanceId: string | null;
  readonly pid: number | null;
  readonly port: number | null;
  readonly origin: string | null;
  readonly runtimeState: string | null;
  readonly leaseLive: boolean;
  readonly descriptor: 'VALID' | 'ABSENT' | 'STALE';
  /** UPDATE_HOLD / RESTORE_IN_PROGRESS / RESTORE_CHECK_COPY when the workspace is held. */
  readonly hold: string | null;
  readonly reason: string | null;
}

/** States from which `open` starts a host (the runtime itself waits out a crashed holder's lease and recovers). */
const STARTABLE: readonly HostState[] = ['STOPPED', 'STALE', 'UPDATE_REQUIRED'];
/** States a waiting launcher waits through (bounded). */
const TRANSIENT: readonly HostState[] = ['STARTING', 'STOPPING'];
/** A runtime READY this recently without a descriptor is a host between READY and publishing its surface. */
const PUBLISH_GRACE_MS = 30_000;
export const HOST_READY_TIMEOUT_MS = 120_000;
export const HOST_STOP_TIMEOUT_MS = 90_000;
const START_LOCK_STALE_MS = 180_000;
/** D-OPS-09: the bound on re-classifying a possibly-settling UNHEALTHY (a just-killed holder's teardown on Windows). */
export const DISCOVERY_SETTLE_MS = 1_500;
const DISCOVERY_SETTLE_STEP_MS = 250;
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The Founder-facing code of a hold: a restore's own code, else UPDATE_HOLD (a failed, rolled-back update). */
export const heldCode = (hold: string | null): string => (hold === 'RESTORE_IN_PROGRESS' || hold === 'RESTORE_CHECK_COPY' ? hold : 'UPDATE_HOLD');

function base(workspace: string, state: HostState, extra: Partial<HostStatus> = {}): HostStatus {
  return { state, workspace, instanceId: null, pid: null, port: null, origin: null, runtimeState: null, leaseLive: false, descriptor: 'ABSENT', hold: null, reason: null, ...extra };
}

/** Reads the durable lease and its holder's instance record (never a write, never content). */
function readLease(root: string): { lease: { holderId: string; expiresAt: string } | null; instance: { id: string; pid: number; state: string; startedAt: string; updatedAt: string } | null } | { error: string } {
  let store: CompanyStore | null = null;
  try {
    store = CompanyStore.open(root, { create: false, migrationMode: 'verify' });
    const lease = store.supervisorLease();
    const instance = lease ? store.instance(lease.holderId) : null;
    return { lease: lease ? { holderId: lease.holderId, expiresAt: lease.expiresAt } : null, instance: instance ? { id: instance.id, pid: instance.pid, state: instance.state, startedAt: instance.startedAt, updatedAt: instance.updatedAt } : null };
  } catch (error) {
    return { error: isQandeelError(error) ? error.code : 'UNCLASSIFIED_ERROR' };
  } finally {
    store?.close();
  }
}

/**
 * Whether an UNHEALTHY reading may be a host disappearing right now: the durable store briefly unreadable while a killed
 * process's file locks are released, or the holder not answering while its process is still being torn down. A wrong
 * identity on the port (a squatter) is never a settling state.
 */
const mayBeSettling = (s: HostStatus): boolean => s.state === 'UNHEALTHY' && s.reason !== 'HOST_IDENTITY_MISMATCH';

/** D-OPS-09: bounded re-classification of a possibly-settling UNHEALTHY; every other reading is returned at once. */
export async function settleDiscovery(classify: () => Promise<HostStatus>, budgetMs: number = DISCOVERY_SETTLE_MS, stepMs: number = DISCOVERY_SETTLE_STEP_MS): Promise<HostStatus> {
  const deadline = Date.now() + budgetMs;
  let status = await classify();
  while (mayBeSettling(status) && Date.now() < deadline) {
    await sleep(stepMs);
    status = await classify();
  }
  return status;
}

export async function discoverHost(workspace: string, now: () => number = Date.now): Promise<HostStatus> {
  return settleDiscovery(() => classifyHost(workspace, now));
}

/** One discovery reading: one durable read and at most one identity probe (exported for the crash-recovery diagnostics). */
export async function classifyHost(workspace: string, now: () => number = Date.now): Promise<HostStatus> {
  const paths = hostPaths(workspace);
  const ws = paths.root;
  if (!existsSync(ws)) return base(ws, 'WORKSPACE_MISSING', { reason: 'WORKSPACE_MISSING' });
  // The launcher never creates a Company: a directory without the canonical store is not a production workspace.
  if (!existsSync(layoutFor(ws).databasePath)) return base(ws, 'WORKSPACE_INVALID', { reason: 'NO_COMPANY_STORE' });
  let hold: string | null;
  try {
    const rs = restoreStatus(ws);
    hold = rs.blocked ? (rs.hold ?? 'HELD') : null;
  } catch (error) {
    return base(ws, 'WORKSPACE_INVALID', { reason: isQandeelError(error) ? error.code : 'UNCLASSIFIED_ERROR' });
  }
  const read = readLease(ws);
  const rawDescriptor = readDescriptor(paths);
  const descriptor: HostDescriptor | null = rawDescriptor ?? null;
  const descriptorState: HostStatus['descriptor'] = rawDescriptor === null ? 'ABSENT' : rawDescriptor === undefined ? 'STALE' : 'VALID';
  if ('error' in read) {
    if (hold) return base(ws, 'HELD', { hold, reason: read.error, descriptor: descriptorState });
    // A host that is running has already migrated; a pending schema update means none is (start runs safe-upgrade).
    if (read.error === 'SCHEMA_UPDATE_REQUIRED') return base(ws, 'UPDATE_REQUIRED', { reason: read.error, descriptor: descriptorState });
    if (read.error === 'UNSAFE_WORKSPACE') return base(ws, 'WORKSPACE_INVALID', { reason: read.error });
    return base(ws, 'UNHEALTHY', { reason: read.error, descriptor: descriptorState });
  }
  const { lease, instance } = read;
  const leaseLive = lease !== null && Date.parse(lease.expiresAt) > now();
  if (!leaseLive) {
    if (hold) return base(ws, 'HELD', { hold, reason: hold, descriptor: descriptorState });
    return base(ws, descriptorState === 'ABSENT' ? 'STOPPED' : 'STALE', { descriptor: descriptorState, reason: descriptorState === 'ABSENT' ? null : 'DESCRIPTOR_WITHOUT_LIVE_LEASE', runtimeState: instance?.state ?? null });
  }
  const holder = lease.holderId;
  const pid = instance?.pid ?? null;
  const alive = pid !== null && pidAlive(pid);
  const common = { leaseLive: true, instanceId: holder, pid, runtimeState: instance?.state ?? null, descriptor: descriptorState, hold } as const;
  if (descriptor !== null && descriptor.instanceId === holder) {
    const origin = `http://${LOOPBACK_HOST}:${descriptor.port}`;
    const nonce = newNonce();
    const answer = await probeIdentity(descriptor.port, nonce);
    const withPort = { ...common, port: descriptor.port, origin };
    if (answer === null) return base(ws, alive ? 'UNHEALTHY' : 'STALE', { ...withPort, reason: alive ? 'HOST_NOT_ANSWERING' : 'HOST_PROCESS_GONE' });
    if (answer.status === 503) return base(ws, instance?.state === 'STOPPING' ? 'STOPPING' : 'STARTING', { ...withPort, reason: 'RUNTIME_NOT_READY' });
    if (answer.status !== 200 || !verifyIdentityProof(descriptor, nonce, answer.body)) return base(ws, 'UNHEALTHY', { ...withPort, reason: 'HOST_IDENTITY_MISMATCH' });
    return base(ws, instance?.state === 'READY' ? 'RUNNING' : 'STARTING', withPort);
  }
  // The lease holder has published no (matching) descriptor.
  if (!alive) return base(ws, 'STALE', { ...common, reason: 'HOST_PROCESS_GONE' });
  const state = instance?.state ?? 'UNKNOWN';
  if (state === 'STARTING' || state === 'RECOVERING') return base(ws, 'STARTING', { ...common, reason: 'RUNTIME_STARTING' });
  if (state === 'STOPPING') return base(ws, 'STOPPING', { ...common, reason: 'RUNTIME_STOPPING' });
  if (state === 'READY' && instance && now() - Date.parse(instance.updatedAt) < PUBLISH_GRACE_MS) return base(ws, 'STARTING', { ...common, reason: 'SURFACE_PUBLISHING' });
  // A live runtime without the Founder surface (e.g. the engineering `qandeel-company start`): never start a second one.
  return base(ws, 'FOREIGN_RUNTIME', { ...common, reason: 'RUNTIME_WITHOUT_FOUNDER_SURFACE' });
}

/** Bounded wait while the predicate holds (no unbounded loop; each step is one durable read and at most one probe). */
export async function waitWhile(workspace: string, holds: (s: HostStatus) => boolean, timeoutMs: number, stepMs = 400): Promise<HostStatus> {
  const deadline = Date.now() + timeoutMs;
  let status = await discoverHost(workspace);
  while (holds(status) && Date.now() < deadline) {
    await sleep(stepMs);
    status = await discoverHost(workspace);
  }
  return status;
}

const transient = (s: HostStatus): boolean => TRANSIENT.includes(s.state);

/** The canonical launch URL for a running host: a fresh single-use, 90-second token (the same mint as `launch`). */
export function mintLaunchUrl(workspace: string, origin: string): { launchUrl: string; expiresAt: string } {
  const store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
  try {
    const { token, expiresAt } = FounderAuthStore.for(store).mintLaunchToken();
    return { launchUrl: `${origin}/launch#${token}`, expiresAt };
  } finally {
    store.close();
  }
}

// --- starting the host ------------------------------------------------------------------------------------------------

export interface StartOptions {
  readonly cliPath: string;
  readonly providers: readonly string[];
  readonly readyTimeoutMs?: number;
}

type StartAttempt = { readonly kind: 'READY' } | { readonly kind: 'BUSY' } | { readonly kind: 'FAILED'; readonly code: string };

function startLockHolder(paths: HostPaths): { pid?: unknown; at?: unknown } | null {
  if (!existsSync(paths.startLock)) return null;
  try {
    return JSON.parse(readFileSync(paths.startLock, 'utf8')) as { pid?: unknown; at?: unknown };
  } catch {
    return {}; // torn or foreign: treated as stale
  }
}

/** Whether another live launcher is starting a host right now (a crashed launcher's lock is stale: PID gone or too old). */
export function startLockHeld(paths: HostPaths): boolean {
  const holder = startLockHolder(paths);
  return holder !== null && typeof holder.pid === 'number' && holder.pid !== process.pid && pidAlive(holder.pid) && typeof holder.at === 'number' && Date.now() - holder.at < START_LOCK_STALE_MS;
}

/** One launcher at a time starts a host for a workspace. */
function acquireStartLock(paths: HostPaths): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(paths.startLock, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`, { flag: 'wx' });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (startLockHeld(paths)) return false;
      rmSync(paths.startLock, { force: true });
    }
  }
  return false;
}

function rotateLog(paths: HostPaths): void {
  try {
    if (existsSync(paths.log) && statSync(paths.log).size > LOG_ROTATE_BYTES) renameSync(paths.log, `${paths.log}.1`);
  } catch {
    // A log that cannot be rotated is appended to; it never blocks a start.
  }
}

async function startHost(paths: HostPaths, options: StartOptions): Promise<StartAttempt> {
  if (!acquireStartLock(paths)) return { kind: 'BUSY' };
  try {
    const again = await discoverHost(paths.root);
    if (!STARTABLE.includes(again.state)) return { kind: 'BUSY' };
    if (again.descriptor !== 'ABSENT' && !again.leaseLive) removeStaleDescriptor(paths);
    mkdirSync(paths.runtimeDir, { recursive: true });
    rotateLog(paths);
    const fd = openSync(paths.log, 'a');
    let child;
    try {
      child = spawnHost(options.cliPath, ['serve', '--workspace', paths.root, '--background', ...options.providers.flatMap((p) => ['--provider', p])], fd);
    } finally {
      closeSync(fd);
    }
    const outcome = await new Promise<StartAttempt>((resolve) => {
      const timer = setTimeout(() => resolve({ kind: 'FAILED', code: 'HOST_START_TIMEOUT' }), options.readyTimeoutMs ?? HOST_READY_TIMEOUT_MS);
      const finish = (a: StartAttempt): void => {
        clearTimeout(timer);
        resolve(a);
      };
      child.on('message', (m: { type?: unknown; code?: unknown }) => {
        if (m?.type === 'ready') finish({ kind: 'READY' });
        else if (m?.type === 'failed') finish(m.code === 'HOST_ALREADY_RUNNING' ? { kind: 'BUSY' } : { kind: 'FAILED', code: typeof m.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(m.code) ? m.code : 'HOST_START_FAILED' });
      });
      child.once('error', () => finish({ kind: 'FAILED', code: 'HOST_SPAWN_FAILED' }));
      child.once('exit', (code) => finish({ kind: 'FAILED', code: code === 3 ? 'HOST_ALREADY_RUNNING' : 'HOST_START_FAILED' }));
    });
    // The host lives on without us: drop the IPC channel and every handle to it.
    if (child.connected) child.disconnect();
    child.removeAllListeners();
    child.unref();
    return outcome.kind === 'FAILED' && outcome.code === 'HOST_ALREADY_RUNNING' ? { kind: 'BUSY' } : outcome;
  } finally {
    rmSync(paths.startLock, { force: true });
  }
}

export interface Outcome {
  readonly ok: boolean;
  /** OPENED / STARTED_AND_OPENED / STOPPED / NOT_RUNNING / TERMINATED / or a refusal code. */
  readonly outcome: string;
  readonly status: HostStatus;
  readonly started?: boolean;
  readonly browser?: string | null;
  readonly launchUrl?: string;
  readonly expiresAt?: string;
}

/** Brings the host to RUNNING: reuse it, or start exactly one, or wait for the launcher that is starting it. */
export async function ensureRunning(workspace: string, options: StartOptions): Promise<{ status: HostStatus; started: boolean; code: string | null }> {
  const paths = hostPaths(workspace);
  let status = await discoverHost(workspace);
  let started = false;
  for (let round = 0; round < 3 && status.state !== 'RUNNING'; round++) {
    if (transient(status)) {
      status = await waitWhile(workspace, transient, options.readyTimeoutMs ?? HOST_READY_TIMEOUT_MS);
      continue;
    }
    if (!STARTABLE.includes(status.state)) return { status, started, code: status.state === 'HELD' ? heldCode(status.hold) : status.state === 'UNHEALTHY' ? 'HOST_UNHEALTHY' : status.state };
    const attempt = await startHost(paths, options);
    if (attempt.kind === 'FAILED') return { status: await discoverHost(workspace), started, code: attempt.code };
    if (attempt.kind === 'READY') started = true;
    // READY → confirm by identity; BUSY → another launcher is starting it: wait for that one, bounded. If it gave up, the
    // next round starts the host itself.
    const ready = attempt.kind === 'READY';
    status = await waitWhile(workspace, (s) => transient(s) || (STARTABLE.includes(s.state) && (ready || startLockHeld(paths))), ready ? 15_000 : (options.readyTimeoutMs ?? HOST_READY_TIMEOUT_MS));
  }
  return { status, started, code: status.state === 'RUNNING' ? null : status.state === 'UNHEALTHY' ? 'HOST_UNHEALTHY' : status.state };
}

/** Opens a browser window on a URL (the default is the installed Edge / Chrome in app mode; tests inject a recorder). */
export type BrowserOpener = (url: string) => Promise<{ ok: boolean; browser: string | null }>;

export async function openCompany(workspace: string, options: StartOptions & { readonly browser: boolean; readonly openBrowser?: BrowserOpener; readonly handoffTimeoutMs?: number }): Promise<Outcome> {
  const r = await ensureRunning(workspace, options);
  if (r.code !== null || r.status.origin === null) return { ok: false, outcome: r.code ?? 'HOST_UNHEALTHY', status: r.status, started: r.started };
  const origin = r.status.origin;
  if (!options.browser) {
    // Terminal use only (`--no-browser`): the URL goes to this process's own stdout, never into another process's arguments.
    const { launchUrl, expiresAt } = mintLaunchUrl(r.status.workspace, origin);
    return { ok: true, outcome: r.started ? 'STARTED' : 'REUSED', status: r.status, started: r.started, browser: null, launchUrl, expiresAt };
  }
  // D-OPS-07: the browser's argument is the one-shot loopback handoff address, never the launch credential. The token is
  // minted only when the browser's own navigation arrives, and handed over as a redirect to the canonical /launch page.
  const handoff = await serveLaunchHandoff(() => mintLaunchUrl(r.status.workspace, origin).launchUrl, options.handoffTimeoutMs);
  const opened = await (options.openBrowser ?? openBrowser)(handoff.url);
  if (!opened.ok) {
    handoff.close();
    return { ok: false, outcome: 'BROWSER_UNAVAILABLE', status: r.status, started: r.started, browser: opened.browser };
  }
  const delivered = await handoff.result;
  if (delivered !== 'DELIVERED') return { ok: false, outcome: delivered === 'MINT_FAILED' ? 'LAUNCH_MINT_FAILED' : 'BROWSER_HANDOFF_TIMEOUT', status: r.status, started: r.started, browser: opened.browser };
  return { ok: true, outcome: r.started ? 'STARTED_AND_OPENED' : 'OPENED', status: r.status, started: r.started, browser: opened.browser };
}

// --- controlled stop / restart ------------------------------------------------------------------------------------------

const lingering = (s: HostStatus): boolean => s.leaseLive && s.runtimeState !== 'STOPPED' && s.runtimeState !== 'FAILED' && s.state !== 'FOREIGN_RUNTIME' && s.state !== 'STALE';

export async function stopHost(workspace: string, options: { readonly force?: boolean; readonly timeoutMs?: number } = {}): Promise<Outcome> {
  const paths = hostPaths(workspace);
  const status = await discoverHost(workspace);
  if (status.state === 'WORKSPACE_MISSING' || status.state === 'WORKSPACE_INVALID') return { ok: false, outcome: status.state, status };
  // Nothing to stop: no live lease, or a crashed holder whose lease simply expires (the next start recovers).
  if (!status.leaseLive || status.state === 'STALE') return { ok: true, outcome: 'NOT_RUNNING', status };
  if (status.state === 'FOREIGN_RUNTIME') return { ok: false, outcome: 'FOREIGN_RUNTIME', status };
  const descriptor = readDescriptor(paths);
  const timeoutMs = options.timeoutMs ?? HOST_STOP_TIMEOUT_MS;
  if (descriptor && descriptor.instanceId === status.instanceId && (status.state === 'RUNNING' || status.state === 'STARTING' || status.state === 'UNHEALTHY')) {
    const requestId = writeStopRequest(paths, descriptor.instanceId);
    const reply = await requestHostStop(descriptor.port, requestId);
    if (reply?.status === 202) {
      const deadline = Date.now() + timeoutMs;
      let s = await discoverHost(workspace);
      while (lingering(s) && Date.now() < deadline) {
        await sleep(400);
        s = await discoverHost(workspace);
      }
      return lingering(s) ? { ok: false, outcome: 'HOST_STOP_TIMEOUT', status: s } : { ok: true, outcome: 'STOPPED', status: s };
    }
    rmSync(paths.stopRequest, { force: true });
  }
  if (status.state === 'STOPPING') {
    const s = await waitWhile(workspace, (x) => x.state === 'STOPPING', timeoutMs);
    return { ok: !s.leaseLive || !lingering(s), outcome: lingering(s) ? 'HOST_STOP_TIMEOUT' : 'STOPPED', status: s };
  }
  // Not answering a controlled stop. Only an explicit --force terminates, and only the verified lease holder's PID.
  if (!options.force || status.pid === null || !pidAlive(status.pid)) return { ok: false, outcome: 'HOST_UNRESPONSIVE', status };
  terminateProcess(status.pid);
  const deadline = Date.now() + 15_000;
  while (pidAlive(status.pid) && Date.now() < deadline) await sleep(200);
  return { ok: !pidAlive(status.pid), outcome: 'TERMINATED', status: await discoverHost(workspace) };
}

export async function restartHost(workspace: string, options: StartOptions & { readonly browser: boolean; readonly force?: boolean; readonly openBrowser?: BrowserOpener }): Promise<Outcome> {
  const stopped = await stopHost(workspace, { ...(options.force !== undefined ? { force: options.force } : {}) });
  if (!stopped.ok && stopped.outcome !== 'NOT_RUNNING') return stopped;
  return openCompany(workspace, options);
}

// --- the Founder launcher configuration and shortcuts --------------------------------------------------------------------

export interface LauncherConfig {
  readonly version: 1;
  readonly workspace: string;
  readonly providers: readonly string[];
}

/** Per-user, outside every checkout and workspace, beside the vault: `%LOCALAPPDATA%\QANDEEL_COMPANY\launcher\founder-launcher.json`. No secret. */
export function launcherConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const local = env.LOCALAPPDATA && path.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : path.join(homedir(), '.local', 'share');
  return path.join(local, 'QANDEEL_COMPANY', 'launcher');
}

export const launcherConfigPath = (env: NodeJS.ProcessEnv = process.env): string => path.join(launcherConfigDir(env), 'founder-launcher.json');

export function readLauncherConfig(file: string): LauncherConfig | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LauncherConfig>;
    if (raw.version !== 1 || typeof raw.workspace !== 'string' || !path.isAbsolute(raw.workspace) || !Array.isArray(raw.providers) || !raw.providers.every((p) => typeof p === 'string' && /^[a-z0-9-]{1,32}$/.test(p))) return null;
    return { version: 1, workspace: raw.workspace, providers: raw.providers };
  } catch {
    return null;
  }
}

export function writeLauncherConfig(file: string, config: LauncherConfig): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, config);
}

export const SHORTCUT_FOLDER = 'QANDEEL COMPANY';

/** The Founder's entry points: the Desktop launcher, and Start-menu Open / Status / Stop / Restart. */
export function shortcutSpecs(cliPath: string, configDir: string): ShortcutSpec[] {
  const target = process.execPath;
  const q = (s: string): string => `"${s}"`;
  const mk = (folder: ShortcutSpec['folder'], name: string, command: string, description: string, subfolder?: string): ShortcutSpec => ({ folder, name, target, arguments: `${q(cliPath)} ${command} --notify`, workingDirectory: configDir, description, ...(subfolder ? { subfolder } : {}) });
  return [
    mk('Desktop', 'QANDEEL COMPANY', 'open', 'افتح شركة قنديل — Open QANDEEL COMPANY'),
    mk('Programs', 'QANDEEL COMPANY', 'open', 'افتح شركة قنديل — Open QANDEEL COMPANY', SHORTCUT_FOLDER),
    mk('Programs', 'QANDEEL COMPANY — Status', 'status', 'حالة الشركة — Company status', SHORTCUT_FOLDER),
    mk('Programs', 'QANDEEL COMPANY — Stop', 'stop', 'إيقاف الشركة بأمان — Controlled stop', SHORTCUT_FOLDER),
    mk('Programs', 'QANDEEL COMPANY — Restart', 'restart', 'إعادة تشغيل الشركة — Controlled restart', SHORTCUT_FOLDER),
  ];
}

export async function installShortcuts(cliPath: string, configDir: string): Promise<string[] | null> {
  return writeShortcuts(shortcutSpecs(cliPath, configDir));
}

// --- Founder notices -------------------------------------------------------------------------------------------------------

const TITLE = 'QANDEEL COMPANY';

/** Fixed, content-free Founder notices: what happened and what to do; the code is shown for support, nothing else. */
export function noticeFor(command: string, outcome: string): { kind: 'info' | 'warning' | 'error'; message: string } | null {
  const m = (kind: 'info' | 'warning' | 'error', ar: string, en: string): { kind: 'info' | 'warning' | 'error'; message: string } => ({ kind, message: `${ar}\n\n${en}\n\n(${outcome})` });
  switch (outcome) {
    case 'OPENED':
    case 'STARTED_AND_OPENED':
    case 'STARTED':
    case 'REUSED':
      return command === 'restart' ? m('info', 'أُعيد تشغيل الشركة وفُتح مركز القيادة.', 'The Company was restarted and the Command Center opened.') : null;
    case 'PROVIDER_NOT_READY':
      return m('warning', 'الشركة تعمل، لكن مفتاح DeepSeek غير موجود في خزنة Windows؛ العمل الذي يحتاج النموذج متوقف حتى يُضاف.', 'The Company is running, but the DeepSeek key is not in the Windows vault; model work is held until it is added.');
    case 'STOPPED':
      return m('info', 'أُوقفت الشركة بأمان. كل الحالة محفوظة.', 'The Company was stopped safely. All state is preserved.');
    case 'NOT_RUNNING':
      return m('info', 'الشركة ليست قيد التشغيل.', 'The Company is not running.');
    case 'TERMINATED':
      return m('warning', 'أُنهيت عملية الشركة قسرًا. سيستعيد التشغيل التالي الحالة تلقائيًا.', 'The Company process was terminated. The next start recovers automatically.');
    case 'NOT_CONFIGURED':
      return m('error', 'لم يُضبط مكان مساحة عمل الشركة على هذا الجهاز.', 'No Company workspace is configured on this computer.');
    case 'WORKSPACE_MISSING':
      return m('error', 'مساحة عمل الشركة غير موجودة. تأكد من أن القرص متصل.', 'The Company workspace was not found. Check that its drive is connected.');
    case 'WORKSPACE_INVALID':
      return m('error', 'المجلد المضبوط ليس مساحة عمل صالحة للشركة. لن يُنشأ أي شيء جديد.', 'The configured folder is not a valid Company workspace. Nothing new is created.');
    case 'UPDATE_HOLD':
      return m('error', 'الشركة موقوفة بسبب تحديث فشل وأُعيد. تحتاج مراجعة تشغيلية قبل البدء.', 'The Company is held after a failed, rolled-back update. It needs operator review before it starts.');
    case 'RESTORE_IN_PROGRESS':
      return m('error', 'استعادة نسخة احتياطية جارية أو لم تكتمل في مساحة العمل هذه.', 'A backup restore is in progress or incomplete in this workspace.');
    case 'RESTORE_CHECK_COPY':
      return m('error', 'هذه نسخة تحقق معزولة من نسخة احتياطية، ولا تُشغَّل أبدًا.', 'This is an isolated backup verification copy; it never runs.');
    case 'HOST_UNHEALTHY':
    case 'HOST_UNRESPONSIVE':
      return m('error', 'الشركة تعمل لكنها لا تستجيب. استخدم «QANDEEL COMPANY — Restart».', 'The Company is running but not responding. Use "QANDEEL COMPANY — Restart".');
    case 'FOREIGN_RUNTIME':
      return m('error', 'تعمل نسخة تشغيل هندسية للشركة بدون مركز القيادة. أوقفها أولًا.', 'An engineering Company runtime is running without the Command Center. Stop it first.');
    case 'BROWSER_UNAVAILABLE':
      return m('error', 'تعذّر فتح Edge أو Chrome. الشركة تعمل؛ أعد المحاولة بعد تثبيت المتصفح.', 'Edge or Chrome could not be opened. The Company is running; try again once a browser is available.');
    case 'RUNTIME_RELEASE_REFUSED':
      return m('error', 'هذه النسخة من الشركة ليست الإصدار المفعّل للإنتاج، فلم يبدأ شيء. استخدم اختصار «QANDEEL COMPANY» أو فعّل الإصدار أولًا.', 'This build of the Company is not the activated production release, so nothing was started. Use the "QANDEEL COMPANY" shortcut, or activate the release first.');
    case 'BROWSER_HANDOFF_TIMEOUT':
      return m('error', 'فُتح المتصفح لكنه لم يصل إلى مركز القيادة في الوقت المتوقع. الشركة تعمل؛ افتحها مرة أخرى.', 'The browser opened but did not reach the Command Center in time. The Company is running; open it again.');
    case 'HOST_START_TIMEOUT':
      return m('error', 'استغرق بدء الشركة وقتًا أطول من المتوقع. أعد المحاولة بعد دقيقة.', 'The Company took longer than expected to start. Try again in a minute.');
    case 'HOST_STOP_TIMEOUT':
      return m('error', 'لم تكتمل عملية الإيقاف في الوقت المتوقع.', 'The controlled stop did not finish in time.');
    default:
      return m('error', 'تعذّر بدء الشركة.', 'The Company could not be started.');
  }
}

export function statusNotice(s: HostStatus): { kind: 'info' | 'warning' | 'error'; message: string } {
  const ar: Record<string, string> = { RUNNING: 'الشركة تعمل.', STARTING: 'الشركة تبدأ الآن.', STOPPING: 'الشركة تتوقف الآن.', STOPPED: 'الشركة متوقفة.', STALE: 'الشركة متوقفة (توقفت آخر مرة بشكل غير متوقع؛ ستُستعاد عند البدء).', UPDATE_REQUIRED: 'الشركة متوقفة؛ سيُطبق تحديث المخطط الآمن عند البدء.' };
  const known = ar[s.state];
  if (known === undefined) return noticeFor('status', s.state === 'HELD' ? heldCode(s.hold) : s.state) ?? { kind: 'error', message: s.state };
  return { kind: s.state === 'STALE' ? 'warning' : 'info', message: `${known}\n\n${s.state}${s.instanceId ? ` · ${s.instanceId.slice(0, 8)}` : ''}` };
}

export async function notify(notice: { kind: 'info' | 'warning' | 'error'; message: string } | null): Promise<void> {
  if (notice !== null) await showNotice(TITLE, notice.message, notice.kind);
}
