/**
 * QANDEEL COMPANY Desktop v1 (D1, D-D1-01 … D-D1-06): the installed Windows product is an orchestration shell over the
 * canonical OPS mechanisms — it adds no runtime, no release format, no updater database, no backup, no host identity
 * and no Founder authentication of its own.
 *
 *   bundle    what one `QANDEEL-COMPANY-Setup.exe` lays down, side by side, in
 *             `%LOCALAPPDATA%\Programs\QANDEEL COMPANY\versions\<desktop version>-<bundle id>\`:
 *               node\node.exe   the private, pinned, hash-verified Node runtime (never on PATH, never global);
 *               release\…       one canonical content-addressed release (`qandeel-release.json`), unchanged;
 *               app\…           the approved product icon;
 *               qandeel-desktop-bundle.json   `qandeel.desktop-bundle/v1`: source commit → release ID → runtime → icon
 *                                             → installer identity, every application file hashed.
 *   install   (first install, update, repair and reinstall are the same bounded path) — run by Setup under the bundle's
 *             own private runtime and the bundle's own release code:
 *               verify the bundle → find the EXISTING Company (launcher configuration, or the Founder's explicit choice of
 *               an existing workspace; never a new Company) → import the release into the canonical releases directory
 *               → the canonical `activateRelease` (verify → dry run → controlled stop → verified backup → pin → start →
 *               health; rollback on failure) → shortcuts that run the private runtime. Success only once the host is READY.
 *   uninstall removes the APPLICATION: controlled stop, then the shortcuts. Setup then removes its own program files.
 *             The workspace, its database, artifacts, backups, the vault, the releases, the production pin and the
 *             launcher configuration are never touched — reinstalling returns to the same Company.
 *
 * Every outcome is content-free: states, codes, IDs and paths of installed application files.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import { readReleasePin, selfReleaseRoot, verifyReleaseTree } from '@qandeel-company/runtime';

import { writeJsonAtomic } from './descriptor.js';
import { discoverHost, ensureRunning, installShortcuts, launcherConfigDir, launcherConfigPath, readLauncherConfig, stopHost, uninstallShortcuts, writeLauncherConfig, PRODUCT_ICON_FILE } from './lifecycle.js';
import { lastShortcutFailure } from './processes.js';
import { activateRelease, importRelease, releaseCli, releasesDir } from './release.js';

export const DESKTOP_PRODUCT = 'QANDEEL COMPANY';
export const DESKTOP_BUNDLE_SCHEMA = 'qandeel.desktop-bundle/v1';
export const DESKTOP_INSTALLER_SCHEMA = 'qandeel.desktop-installer/v1';
export const DESKTOP_BUNDLE_FILE = 'qandeel-desktop-bundle.json';
export const DESKTOP_PRODUCT_RECORD = 'desktop-product.json';
/** The bundle layout (relative, POSIX). The release directory is covered by its own canonical manifest. */
export const BUNDLE_NODE = 'node/node.exe';
export const BUNDLE_RELEASE = 'release';
export const BUNDLE_ICON = `app/${PRODUCT_ICON_FILE}`;

export interface BundleFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface DesktopBundleManifest {
  readonly schema: typeof DESKTOP_BUNDLE_SCHEMA;
  readonly product: typeof DESKTOP_PRODUCT;
  readonly desktopVersion: string;
  /** sha256 of the canonical manifest content without `bundleId` and `createdAt` (time is never identity). */
  readonly bundleId: string;
  readonly source: { readonly commit: string | null; readonly clean: boolean };
  readonly release: { readonly releaseId: string; readonly runtimeVersion: string; readonly files: number };
  readonly node: { readonly version: string; readonly platform: 'win32'; readonly arch: 'x64'; readonly file: typeof BUNDLE_NODE; readonly sha256: string; readonly url: string };
  readonly icon: { readonly file: typeof BUNDLE_ICON; readonly sha256: string; readonly source: string };
  readonly installer: { readonly schema: typeof DESKTOP_INSTALLER_SCHEMA; readonly tool: string; readonly version: string };
  /** Every application file outside `release/` (and outside this manifest), hashed. */
  readonly files: readonly BundleFile[];
  /** Informational only. */
  readonly createdAt: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

/** The bundle's content identity: everything but the identity itself and the creation time. */
export function bundleIdOf(manifest: Omit<DesktopBundleManifest, 'bundleId' | 'createdAt'> & Partial<Pick<DesktopBundleManifest, 'bundleId' | 'createdAt'>>): string {
  const core: Record<string, unknown> = { ...manifest };
  delete core.bundleId;
  delete core.createdAt;
  return createHash('sha256').update(canonical(core)).digest('hex');
}

export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** The application files of a bundle directory (POSIX relative paths), excluding the release tree and the manifest. */
export function bundleApplicationFiles(dir: string): BundleFile[] {
  const out: BundleFile[] = [];
  const walk = (rel: string): void => {
    for (const name of readdirSync(path.join(dir, rel)).sort()) {
      const r = rel === '' ? name : `${rel}/${name}`;
      if (r === BUNDLE_RELEASE || r === DESKTOP_BUNDLE_FILE) continue;
      const full = path.join(dir, r);
      const st = statSync(full);
      if (st.isDirectory()) walk(r);
      else out.push({ path: r, sha256: sha256File(full), size: st.size });
    }
  };
  walk('');
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export type BundleCheck = { readonly ok: true; readonly manifest: DesktopBundleManifest } | { readonly ok: false; readonly reason: string };

/** Verifies a Desktop bundle byte for byte: its identity, every application file, the pinned runtime and the release. */
export function verifyDesktopBundle(dir: string): BundleCheck {
  let m: DesktopBundleManifest;
  try {
    m = JSON.parse(readFileSync(path.join(dir, DESKTOP_BUNDLE_FILE), 'utf8')) as DesktopBundleManifest;
  } catch {
    return { ok: false, reason: 'BUNDLE_INVALID' };
  }
  if (m === null || typeof m !== 'object' || m.schema !== DESKTOP_BUNDLE_SCHEMA || m.product !== DESKTOP_PRODUCT || typeof m.desktopVersion !== 'string' || !Array.isArray(m.files)) return { ok: false, reason: 'BUNDLE_INVALID' };
  if (m.node?.platform !== 'win32' || m.node?.arch !== 'x64' || m.node?.file !== BUNDLE_NODE || !HEX64.test(m.node?.sha256 ?? '') || m.icon?.file !== BUNDLE_ICON || !HEX64.test(m.icon?.sha256 ?? '') || m.installer?.schema !== DESKTOP_INSTALLER_SCHEMA) return { ok: false, reason: 'BUNDLE_INVALID' };
  if (m.bundleId !== bundleIdOf(m)) return { ok: false, reason: 'BUNDLE_TAMPERED' };
  let actual: BundleFile[];
  try {
    actual = bundleApplicationFiles(dir);
  } catch {
    return { ok: false, reason: 'BUNDLE_TAMPERED' };
  }
  if (canonical(actual) !== canonical(m.files)) return { ok: false, reason: 'BUNDLE_TAMPERED' };
  if (m.files.find((f) => f.path === BUNDLE_NODE)?.sha256 !== m.node.sha256) return { ok: false, reason: 'RUNTIME_NOT_PINNED' };
  if (m.files.find((f) => f.path === BUNDLE_ICON)?.sha256 !== m.icon.sha256) return { ok: false, reason: 'BUNDLE_TAMPERED' };
  const release = verifyReleaseTree(path.join(dir, BUNDLE_RELEASE));
  if (!release.ok) return { ok: false, reason: release.reason === 'NOT_A_RELEASE' ? 'BUNDLE_INVALID' : 'RELEASE_TAMPERED' };
  if (release.manifest.releaseId !== m.release?.releaseId || release.manifest.runtimeVersion !== m.release.runtimeVersion) return { ok: false, reason: 'BUNDLE_TAMPERED' };
  return { ok: true, manifest: m };
}

/** The per-user record of the installed Desktop product (beside the launcher configuration; no secret, no content). */
export interface DesktopProductRecord {
  readonly version: 1;
  readonly product: typeof DESKTOP_PRODUCT;
  readonly desktopVersion: string;
  readonly bundleId: string;
  readonly bundleDir: string;
  readonly runtime: string;
  readonly releaseId: string;
  readonly installedAt: string;
}

export const desktopProductRecordPath = (env: NodeJS.ProcessEnv = process.env): string => path.join(launcherConfigDir(env), DESKTOP_PRODUCT_RECORD);

export function readDesktopProductRecord(file: string = desktopProductRecordPath()): DesktopProductRecord | null {
  try {
    const r = JSON.parse(readFileSync(file, 'utf8')) as DesktopProductRecord;
    return r.version === 1 && r.product === DESKTOP_PRODUCT && typeof r.bundleDir === 'string' ? r : null;
  } catch {
    return null;
  }
}

const same = (a: string, b: string): boolean => {
  try {
    return realpathSync.native(a).toLowerCase() === realpathSync.native(b).toLowerCase();
  } catch {
    return false;
  }
};

export interface DesktopInstallOptions {
  readonly bundleDir: string;
  /** The Founder's explicit choice of an EXISTING Company workspace (first run without a launcher configuration). */
  readonly workspace?: string;
  readonly providers?: readonly string[];
  /** Disposable proofs only: shortcuts under this root instead of the real Desktop / Start menu. */
  readonly shortcutRoot?: string;
  readonly readyTimeoutMs?: number;
  readonly now?: () => Date;
}

export interface DesktopOutcome {
  readonly ok: boolean;
  /** INSTALLED, UNINSTALLED, or a bounded refusal / failure code. */
  readonly outcome: string;
  readonly code: string | null;
  readonly desktopVersion: string | null;
  readonly bundleId: string | null;
  readonly releaseId: string | null;
  readonly previousReleaseId: string | null;
  readonly workspace: string | null;
  readonly steps: readonly { readonly step: string; readonly result: string }[];
  readonly state: string | null;
  readonly shortcuts: readonly string[] | null;
}

/** First install, update, repair and reinstall: one bounded path over the canonical activation (see module header). */
export async function desktopInstall(options: DesktopInstallOptions): Promise<DesktopOutcome> {
  const steps: { step: string; result: string }[] = [];
  const now = options.now ?? (() => new Date());
  const bundleDir = path.resolve(options.bundleDir);
  let manifest: DesktopBundleManifest | null = null;
  let workspace: string | null = null;
  const result = (ok: boolean, outcome: string, extra: Partial<DesktopOutcome> = {}): DesktopOutcome => ({ ok, outcome, code: ok ? null : outcome, desktopVersion: manifest?.desktopVersion ?? null, bundleId: manifest?.bundleId ?? null, releaseId: manifest?.release.releaseId ?? null, previousReleaseId: null, workspace, steps, state: null, shortcuts: null, ...extra });

  // 1. The bundle, byte for byte, and this process: the bundle's private runtime running the bundle's own release code.
  const bundle = verifyDesktopBundle(bundleDir);
  steps.push({ step: 'BUNDLE', result: bundle.ok ? 'VERIFIED' : bundle.reason });
  if (!bundle.ok) return result(false, bundle.reason);
  manifest = bundle.manifest;
  const self = selfReleaseRoot();
  const privateRuntime = same(process.execPath, path.join(bundleDir, ...BUNDLE_NODE.split('/'))) && self !== null && same(self, path.join(bundleDir, BUNDLE_RELEASE));
  steps.push({ step: 'RUNTIME', result: privateRuntime ? 'PRIVATE' : 'REFUSED' });
  if (!privateRuntime) return result(false, 'PRIVATE_RUNTIME_REQUIRED');

  // 2. The EXISTING Company: the launcher configuration, or the Founder's explicit choice. Never a new Company.
  const configFile = launcherConfigPath();
  const config = readLauncherConfig(configFile);
  const chosen = options.workspace === undefined ? null : path.resolve(options.workspace);
  if (config === null && chosen === null) {
    steps.push({ step: 'WORKSPACE', result: 'NOT_CONFIGURED' });
    return result(false, 'SETUP_REQUIRED');
  }
  if (config !== null && chosen !== null && !same(config.workspace, chosen)) {
    // Switching the Founder's production Company is not an installer decision.
    steps.push({ step: 'WORKSPACE', result: 'CONFLICT' });
    return result(false, 'WORKSPACE_CONFLICT');
  }
  const status = await discoverHost(chosen ?? (config as { workspace: string }).workspace);
  workspace = status.workspace;
  steps.push({ step: 'WORKSPACE', result: status.state === 'WORKSPACE_MISSING' || status.state === 'WORKSPACE_INVALID' ? status.state : 'EXISTING' });
  if (status.state === 'WORKSPACE_MISSING' || status.state === 'WORKSPACE_INVALID') return result(false, status.state);
  const providers = [...new Set(options.providers ?? config?.providers ?? [])];

  // 3. The bundle's release into the canonical releases directory (same format; an identical one is reused).
  let imported: { releaseId: string; root: string; reused: boolean };
  try {
    imported = importRelease(path.join(bundleDir, BUNDLE_RELEASE), releasesDir());
  } catch (error) {
    steps.push({ step: 'IMPORT', result: 'FAILED' });
    return result(false, error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'RELEASE_IMPORT_FAILED');
  }
  steps.push({ step: 'IMPORT', result: imported.reused ? 'REUSED' : 'IMPORTED' });

  // 4. The canonical controlled activation (D-OPS-08). Rollback on failure is its own.
  const activation = await activateRelease(workspace, imported.root, { providers, shortcuts: false, ...(options.readyTimeoutMs ? { readyTimeoutMs: options.readyTimeoutMs } : {}), now });
  for (const s of activation.steps) steps.push({ step: `ACTIVATE.${s.step}`, result: s.result });
  steps.push({ step: 'ACTIVATE', result: activation.outcome });
  if (!activation.ok) return result(false, activation.outcome === 'ROLLED_BACK' ? 'UPDATE_ROLLED_BACK' : (activation.code ?? 'ACTIVATION_REFUSED'), { code: activation.code, previousReleaseId: activation.previousReleaseId, state: activation.status?.state ?? null });

  // 5. Already the running release (a repair / same-release reinstall while running): a controlled restart moves the
  //    host onto THIS product's private runtime, so the program files of the previous version are no longer in use.
  let state = activation.status?.state ?? null;
  if (activation.outcome === 'ALREADY_ACTIVE') {
    const stopped = await stopHost(workspace);
    steps.push({ step: 'RESTART.STOP', result: stopped.outcome });
    if (!stopped.ok && stopped.outcome !== 'NOT_RUNNING') return result(false, 'HOST_NOT_STOPPED', { state: stopped.status.state });
    const started = await ensureRunning(workspace, { cliPath: releaseCli(imported.root), providers, ...(options.readyTimeoutMs ? { readyTimeoutMs: options.readyTimeoutMs } : {}) });
    const ready = started.code === null && started.status.state === 'RUNNING' && started.status.runtimeState === 'READY';
    steps.push({ step: 'RESTART.HEALTH', result: ready ? 'READY' : (started.code ?? 'FAILED') });
    state = started.status.state;
    if (!ready) return result(false, started.code ?? 'HEALTH_CHECK_FAILED', { state });
  }

  // 6. The launcher configuration (only when the Founder chose the workspace now) and the shortcuts on THIS runtime.
  if (config === null) writeLauncherConfig(configFile, { version: 1, workspace, providers });
  const shortcuts = await installShortcuts(releaseCli(imported.root), launcherConfigDir(), options.shortcutRoot === undefined ? {} : { root: options.shortcutRoot });
  steps.push({ step: 'SHORTCUTS', result: shortcuts === null ? `FAILED:${lastShortcutFailure() ?? 'UNKNOWN'}` : 'OK' });
  writeJsonAtomic(desktopProductRecordPath(), { version: 1, product: DESKTOP_PRODUCT, desktopVersion: manifest.desktopVersion, bundleId: manifest.bundleId, bundleDir, runtime: path.join(bundleDir, ...BUNDLE_NODE.split('/')), releaseId: imported.releaseId, installedAt: now().toISOString() } satisfies DesktopProductRecord);
  if (shortcuts === null) return result(false, 'SHORTCUTS_FAILED', { state });
  return result(true, 'INSTALLED', { previousReleaseId: activation.previousReleaseId, state, shortcuts });
}

export interface DesktopUninstallOptions {
  readonly shortcutRoot?: string;
}

/**
 * Uninstall removes the application only: a controlled stop of the host (the verified host's PID is terminated only if
 * it does not answer the controlled stop, so the program files can be removed), then the shortcuts and the product
 * record. Company data, the vault, the releases, the pin and the launcher configuration stay.
 */
export async function desktopUninstall(options: DesktopUninstallOptions = {}): Promise<DesktopOutcome> {
  const steps: { step: string; result: string }[] = [];
  const config = readLauncherConfig(launcherConfigPath());
  const record = readDesktopProductRecord();
  let state: string | null = null;
  if (config !== null) {
    let stopped = await stopHost(config.workspace);
    steps.push({ step: 'STOP', result: stopped.outcome });
    if (stopped.outcome === 'HOST_UNRESPONSIVE' || stopped.outcome === 'HOST_STOP_TIMEOUT') {
      stopped = await stopHost(config.workspace, { force: true });
      steps.push({ step: 'STOP.FORCE', result: stopped.outcome });
    }
    state = stopped.status.state;
    const ok = stopped.ok || stopped.outcome === 'NOT_RUNNING' || stopped.outcome === 'WORKSPACE_MISSING' || stopped.outcome === 'WORKSPACE_INVALID';
    if (!ok) return { ok: false, outcome: 'HOST_NOT_STOPPED', code: stopped.outcome, desktopVersion: record?.desktopVersion ?? null, bundleId: record?.bundleId ?? null, releaseId: null, previousReleaseId: null, workspace: config.workspace, steps, state, shortcuts: null };
  } else steps.push({ step: 'STOP', result: 'NOT_CONFIGURED' });
  const removed = await uninstallShortcuts(launcherConfigDir(), options.shortcutRoot === undefined ? {} : { root: options.shortcutRoot });
  steps.push({ step: 'SHORTCUTS', result: removed === null ? `FAILED:${lastShortcutFailure() ?? 'UNKNOWN'}` : 'REMOVED' });
  rmSync(desktopProductRecordPath(), { force: true });
  const pin = config === null ? null : readReleasePin(config.workspace);
  return { ok: removed !== null, outcome: removed === null ? 'SHORTCUTS_NOT_REMOVED' : 'UNINSTALLED', code: removed === null ? 'SHORTCUTS_NOT_REMOVED' : null, desktopVersion: record?.desktopVersion ?? null, bundleId: record?.bundleId ?? null, releaseId: pin ? pin.releaseId : null, previousReleaseId: null, workspace: config?.workspace ?? null, steps, state, shortcuts: removed };
}

