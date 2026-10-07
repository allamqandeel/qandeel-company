/**
 * The production runtime release (OPS, D-OPS-08): the Founder's shortcuts start a frozen, activated release — never
 * whatever build the development checkout currently holds.
 *
 *   stage     freezes the CURRENT build (after the operator's Build → Test, `npm run ci`) into a content-addressed
 *             release outside the checkout: `%LOCALAPPDATA%\QANDEEL_COMPANY\releases\<id>\`. Branch switches, `npm ci`
 *             and rebuilds in the checkout never touch it.
 *   activate  the one controlled path that makes a release the production runtime of a workspace (Stage 12):
 *             verify the release → dry run (the release's own CLI checks itself and the workspace schema) → controlled
 *             stop of the running host → backup (verified) → pin → start the host FROM the release (its runtime runs the
 *             existing schema safe-upgrade: rehearsal, verification, UPDATE_HOLD on failure) → health (the host proves
 *             its identity and is READY) → point the shortcuts at the release. Any failure after the pin restores the
 *             previous pin and the previous host.
 *
 * Admission itself lives in the runtime (`admitRuntimeRelease`, checked by every `CompanyRuntime.start`), so a pinned
 * workspace is never run by an unactivated build, whichever entry point starts it.
 */
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { isQandeelError } from '@qandeel-company/domain';
import { RELEASE_MANIFEST_FILE, RUNTIME_VERSION, hashReleaseTree, readReleasePin, releaseIdOf, releasePinPath, verifyReleaseTree, type ReleaseManifest, type ReleasePin } from '@qandeel-company/runtime';
import { CompanyStore, createBackup, verifyBackup } from '@qandeel-company/storage';

import { writeJsonAtomic } from './descriptor.js';
import { discoverHost, ensureRunning, installShortcuts, launcherConfigDir, stopHost, type HostStatus } from './lifecycle.js';
import { runReleaseCli } from './processes.js';

const DRY_RUN_TIMEOUT_MS = 60_000;

/** Per-user, beside the launcher configuration, outside every checkout and workspace. */
export function releasesDir(env: NodeJS.ProcessEnv = process.env): string {
  const local = env.LOCALAPPDATA && path.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : path.join(homedir(), '.local', 'share');
  return path.join(local, 'QANDEEL_COMPANY', 'releases');
}

/** The Founder CLI inside a release (what the host is spawned from and the shortcuts run). */
export const releaseCli = (root: string): string => path.join(root, 'node_modules', '@qandeel-company', 'command-center', 'dist', 'src', 'cli.js');

const inside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** The source commit of a checkout, read from `.git` (informational only; never part of the release ID). */
function sourceCommit(sourceRoot: string): string | null {
  try {
    const git = path.join(sourceRoot, '.git');
    const head = readFileSync(path.join(git, 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const ref = /^ref: (refs\/[\w./-]+)$/.exec(head)?.[1];
    if (!ref) return null;
    const loose = path.join(git, ...ref.split('/'));
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim().match(/^[0-9a-f]{40}$/)?.[0] ?? null;
    const packed = readFileSync(path.join(git, 'packed-refs'), 'utf8');
    return packed.split('\n').find((l) => l.endsWith(` ${ref}`))?.slice(0, 40).match(/^[0-9a-f]{40}$/)?.[0] ?? null;
  } catch {
    return null;
  }
}

/** The runtime file set of one workspace package: its package.json, compiled `dist/src` modules, and its data dirs. */
function copyPackage(pkgDir: string, target: string): void {
  mkdirSync(target, { recursive: true });
  cpSync(path.join(pkgDir, 'package.json'), path.join(target, 'package.json'));
  cpSync(path.join(pkgDir, 'dist', 'src'), path.join(target, 'dist', 'src'), {
    recursive: true,
    filter: (src) => statSync(src).isDirectory() || (/\.(?:js|json)$/.test(src) && !src.endsWith('.tsbuildinfo')),
  });
  for (const data of ['migrations', 'public']) if (existsSync(path.join(pkgDir, data))) cpSync(path.join(pkgDir, data), path.join(target, data), { recursive: true });
}

export interface StagedRelease {
  readonly releaseId: string;
  readonly root: string;
  readonly reused: boolean;
  readonly files: number;
  readonly sourceCommit: string | null;
}

/**
 * Freezes the built checkout at `sourceRoot` into `<dir>/<id prefix>`. Idempotent: the same build is the same release.
 * Refuses an unbuilt package and a destination inside the checkout.
 */
export function stageRelease(sourceRoot: string, dir: string = releasesDir(), now: () => Date = () => new Date()): StagedRelease {
  const root = path.resolve(sourceRoot);
  const target = path.resolve(dir);
  if (inside(target, root)) throw new Error('RELEASES_DIR_INSIDE_CHECKOUT');
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { workspaces?: unknown };
  const workspaces = Array.isArray(manifest.workspaces) ? manifest.workspaces.filter((w): w is string => typeof w === 'string') : [];
  if (workspaces.length === 0) throw new Error('SOURCE_NOT_A_CHECKOUT');
  mkdirSync(target, { recursive: true });
  const staging = path.join(target, `.staging-${randomBytes(6).toString('hex')}`);
  try {
    for (const w of workspaces) {
      const pkgDir = path.join(root, w);
      const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as { name?: unknown };
      if (typeof pkg.name !== 'string' || !/^@qandeel-company\/[a-z0-9-]+$/.test(pkg.name)) throw new Error('SOURCE_PACKAGE_INVALID');
      if (!existsSync(path.join(pkgDir, 'dist', 'src'))) throw new Error('SOURCE_NOT_BUILT');
      copyPackage(pkgDir, path.join(staging, 'node_modules', ...pkg.name.split('/')));
    }
    const files = hashReleaseTree(staging);
    if (files === null) throw new Error('SOURCE_TREE_INVALID');
    const releaseId = releaseIdOf(RUNTIME_VERSION, files);
    const commit = sourceCommit(root);
    const body: ReleaseManifest = { version: 1, releaseId, runtimeVersion: RUNTIME_VERSION, sourceCommit: commit, stagedAt: now().toISOString(), files };
    writeFileSync(path.join(staging, RELEASE_MANIFEST_FILE), `${JSON.stringify(body, null, 2)}\n`);
    const final = path.join(target, releaseId.slice(0, 16));
    if (existsSync(final)) {
      const existing = verifyReleaseTree(final);
      if (!existing.ok || existing.manifest.releaseId !== releaseId) throw new Error('RELEASE_DIR_CONFLICT');
      return { releaseId, root: final, reused: true, files: files.length, sourceCommit: existing.manifest.sourceCommit };
    }
    renameSync(staging, final);
    return { releaseId, root: final, reused: false, files: files.length, sourceCommit: commit };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Imports an already-staged release (the one a Desktop Setup carries, D-D1-02) into `<dir>/<id prefix>` — the SAME
 * content-addressed release format and location `stageRelease` produces; nothing is rebuilt. The source must verify
 * byte-for-byte before and the copy after; an existing identical release is reused, anything else there is refused.
 */
export function importRelease(sourceRoot: string, dir: string = releasesDir()): StagedRelease {
  const source = verifyReleaseTree(sourceRoot);
  if (!source.ok) throw new Error(source.reason);
  const { releaseId } = source.manifest;
  const target = path.resolve(dir);
  const final = path.join(target, releaseId.slice(0, 16));
  if (existsSync(final)) {
    const existing = verifyReleaseTree(final);
    if (!existing.ok || existing.manifest.releaseId !== releaseId) throw new Error('RELEASE_DIR_CONFLICT');
    return { releaseId, root: final, reused: true, files: existing.manifest.files.length, sourceCommit: existing.manifest.sourceCommit };
  }
  mkdirSync(target, { recursive: true });
  const staging = path.join(target, `.import-${randomBytes(6).toString('hex')}`);
  try {
    cpSync(path.resolve(sourceRoot), staging, { recursive: true });
    const copied = verifyReleaseTree(staging);
    if (!copied.ok || copied.manifest.releaseId !== releaseId) throw new Error('RELEASE_IMPORT_FAILED');
    renameSync(staging, final);
    return { releaseId, root: final, reused: false, files: copied.manifest.files.length, sourceCommit: copied.manifest.sourceCommit };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Resolves `--release <id | id prefix | directory>` against the releases directory. */
export function resolveRelease(ref: string, dir: string = releasesDir()): string | null {
  if (path.isAbsolute(ref)) return existsSync(path.join(ref, RELEASE_MANIFEST_FILE)) ? path.resolve(ref) : null;
  if (!/^[0-9a-f]{8,64}$/.test(ref) || !existsSync(dir)) return null;
  const hit = readdirSync(dir).filter((d) => /^[0-9a-f]{16}$/.test(d) && (ref.startsWith(d) || d.startsWith(ref)));
  return hit.length === 1 ? path.join(dir, hit[0] as string) : null;
}

/** The release status of a workspace: its pin and whether the pinned release is intact (content-free). */
export function releaseStatus(workspace: string): { pinned: boolean; pin: 'VALID' | 'ABSENT' | 'INVALID'; releaseId: string | null; root: string | null; intact: boolean | null; previousReleaseId: string | null } {
  const pin = readReleasePin(workspace);
  if (pin === null) return { pinned: false, pin: 'ABSENT', releaseId: null, root: null, intact: null, previousReleaseId: null };
  if (pin === undefined) return { pinned: true, pin: 'INVALID', releaseId: null, root: null, intact: null, previousReleaseId: null };
  const v = verifyReleaseTree(pin.root);
  return { pinned: true, pin: 'VALID', releaseId: pin.releaseId, root: pin.root, intact: v.ok && v.manifest.releaseId === pin.releaseId, previousReleaseId: pin.previous?.releaseId ?? null };
}

export interface ActivationOptions {
  readonly providers: readonly string[];
  /** Point the Founder's shortcuts at the release (Windows; the default). Tests pass false. */
  readonly shortcuts?: boolean;
  /** Disposable proofs only: write the shortcuts under this root instead of the user's Desktop / Start menu. */
  readonly shortcutRoot?: string;
  readonly readyTimeoutMs?: number;
  readonly now?: () => Date;
}

export interface ActivationOutcome {
  readonly ok: boolean;
  /** ACTIVATED / ALREADY_ACTIVE / ROLLED_BACK, or a refusal before anything changed. */
  readonly outcome: string;
  readonly code: string | null;
  readonly releaseId: string | null;
  readonly previousReleaseId: string | null;
  readonly backupId: string | null;
  readonly steps: readonly { readonly step: string; readonly result: string }[];
  readonly status: HostStatus | null;
}

function writePin(workspace: string, pin: ReleasePin | null): void {
  const file = releasePinPath(workspace);
  if (pin === null) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, pin);
}

/** A verified backup of the stopped Company (Stage 12 "Backup"); a pending schema update is snapshotted by safe-upgrade itself. */
async function backupBeforeActivation(workspace: string): Promise<{ result: string; backupId: string | null }> {
  let store: CompanyStore;
  try {
    store = CompanyStore.open(workspace, { create: false, migrationMode: 'verify' });
  } catch (error) {
    if (isQandeelError(error, 'SCHEMA_UPDATE_REQUIRED')) return { result: 'BY_SAFE_UPGRADE', backupId: null };
    throw error;
  }
  try {
    const r = await createBackup(store, { runtimeVersion: RUNTIME_VERSION });
    const v = verifyBackup(r.directory, { liveDatabasePath: store.workspace.databasePath, artifactObjectsDir: store.workspace.objectsDir, expected: { snapshotSha256: r.manifest.snapshot.sha256, manifestSha256: r.manifestSha256 } });
    if (!v.ok) throw new Error('BACKUP_NOT_VERIFIED');
    return { result: 'VERIFIED', backupId: r.backupId };
  } finally {
    store.close();
  }
}

/** The one controlled path that makes a staged release the production runtime of a workspace (see the module header). */
export async function activateRelease(workspace: string, releaseRoot: string, options: ActivationOptions): Promise<ActivationOutcome> {
  const steps: { step: string; result: string }[] = [];
  const now = options.now ?? (() => new Date());
  const before = readReleasePin(workspace);
  const previousReleaseId = before ? before.releaseId : null;
  const refuse = (code: string, status: HostStatus | null = null, releaseId: string | null = null): ActivationOutcome => ({ ok: false, outcome: 'REFUSED', code, releaseId, previousReleaseId, backupId: null, steps, status });
  if (before === undefined) return refuse('PIN_INVALID');
  const initial = await discoverHost(workspace);
  if (initial.state === 'WORKSPACE_MISSING' || initial.state === 'WORKSPACE_INVALID') return refuse(initial.state, initial);
  if (initial.state === 'HELD') return refuse(initial.hold === 'RESTORE_IN_PROGRESS' || initial.hold === 'RESTORE_CHECK_COPY' ? initial.hold : 'UPDATE_HOLD', initial);
  if (initial.state === 'FOREIGN_RUNTIME') return refuse('FOREIGN_RUNTIME', initial);

  // 1. Verify: exactly the files its manifest lists, byte-identical.
  const verified = verifyReleaseTree(releaseRoot);
  steps.push({ step: 'VERIFY', result: verified.ok ? 'OK' : verified.reason });
  if (!verified.ok) return refuse(verified.reason, initial);
  const releaseId = verified.manifest.releaseId;
  const root = path.resolve(releaseRoot);
  const cli = releaseCli(root);
  if (before && before.releaseId === releaseId && initial.state === 'RUNNING') return { ok: true, outcome: 'ALREADY_ACTIVE', code: null, releaseId, previousReleaseId, backupId: null, steps, status: initial };

  // 2. Dry run: the release's OWN code loads, re-verifies itself and checks the workspace schema (read-only).
  const dry = await runReleaseCli(cli, ['release-check', '--workspace', initial.workspace], DRY_RUN_TIMEOUT_MS);
  let check: { ok?: unknown; releaseId?: unknown; schema?: unknown } = {};
  try {
    check = JSON.parse(dry.stdout.trim().split('\n').at(-1) ?? '{}') as typeof check;
  } catch {
    // an unparsable dry run is a failed one
  }
  const dryOk = dry.ok && check.ok === true && check.releaseId === releaseId && (check.schema === 'CURRENT' || check.schema === 'UPDATE_REQUIRED');
  steps.push({ step: 'DRY_RUN', result: dryOk ? String(check.schema) : 'FAILED' });
  if (!dryOk) return refuse('DRY_RUN_FAILED', initial, releaseId);

  // 3. Controlled stop of the running host (nothing changed yet if it does not stop).
  const wasRunning = initial.leaseLive && initial.state !== 'STALE';
  if (wasRunning) {
    const stopped = await stopHost(workspace);
    steps.push({ step: 'STOP', result: stopped.outcome });
    if (!stopped.ok && stopped.outcome !== 'NOT_RUNNING') return refuse('HOST_NOT_STOPPED', stopped.status, releaseId);
  } else steps.push({ step: 'STOP', result: 'NOT_RUNNING' });

  // 4. Backup, verified.
  let backupId: string | null = null;
  try {
    const b = await backupBeforeActivation(workspace);
    backupId = b.backupId;
    steps.push({ step: 'BACKUP', result: b.result });
  } catch (error) {
    steps.push({ step: 'BACKUP', result: 'FAILED' });
    const restarted = before && wasRunning ? await ensureRunning(workspace, { cliPath: releaseCli(before.root), providers: options.providers, ...(options.readyTimeoutMs ? { readyTimeoutMs: options.readyTimeoutMs } : {}) }) : null;
    return { ...refuse(isQandeelError(error) ? error.code : 'BACKUP_FAILED', restarted?.status ?? null, releaseId), backupId };
  }

  // 5. Pin, 6. start from the release (safe-upgrade runs inside its runtime start), 7. health.
  // Re-activating the pinned release itself (a Desktop repair / reinstall, D-D1-05) keeps the real previous release as
  // the rollback point instead of recording the release as its own predecessor.
  const previous = before ? (before.releaseId === releaseId ? before.previous : { releaseId: before.releaseId, root: before.root }) : null;
  writePin(workspace, { version: 1, releaseId, root, activatedAt: now().toISOString(), previous });
  steps.push({ step: 'PIN', result: 'OK' });
  const started = await ensureRunning(workspace, { cliPath: cli, providers: options.providers, ...(options.readyTimeoutMs ? { readyTimeoutMs: options.readyTimeoutMs } : {}) });
  steps.push({ step: 'START', result: started.code ?? 'RUNNING' });
  const healthy = started.code === null && started.status.state === 'RUNNING' && started.status.runtimeState === 'READY';
  steps.push({ step: 'HEALTH', result: healthy ? 'READY' : 'FAILED' });
  if (healthy) {
    if (options.shortcuts !== false && process.platform === 'win32') {
      const written = await installShortcuts(cli, launcherConfigDir(), options.shortcutRoot === undefined ? {} : { root: options.shortcutRoot });
      steps.push({ step: 'SHORTCUTS', result: written === null ? 'FAILED' : 'OK' });
    }
    return { ok: true, outcome: 'ACTIVATED', code: null, releaseId, previousReleaseId, backupId, steps, status: started.status };
  }

  // Rollback: the previous pin (or none), the previous host if one ran. A schema the new release migrated stays
  // migrated (forward-only; its pre-update snapshot is the existing `rollback-update` path).
  const after = await discoverHost(workspace);
  if (after.leaseLive && after.state !== 'STALE') await stopHost(workspace, { force: true });
  writePin(workspace, before);
  steps.push({ step: 'ROLLBACK_PIN', result: before ? 'PREVIOUS' : 'UNPINNED' });
  let status: HostStatus = await discoverHost(workspace);
  if (before && wasRunning) {
    const back = await ensureRunning(workspace, { cliPath: releaseCli(before.root), providers: options.providers, ...(options.readyTimeoutMs ? { readyTimeoutMs: options.readyTimeoutMs } : {}) });
    steps.push({ step: 'ROLLBACK_START', result: back.code ?? 'RUNNING' });
    status = back.status;
  }
  return { ok: false, outcome: 'ROLLED_BACK', code: started.code ?? 'HEALTH_CHECK_FAILED', releaseId, previousReleaseId, backupId, steps, status };
}
