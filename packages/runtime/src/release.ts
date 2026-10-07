/**
 * Production runtime release admission (OPS, D-OPS-08; Stage 12: Build → Test → Migration Check → Backup → Staging /
 * Dry Run → Health Check → Activate — "direct unvalidated mutation of the live runtime is not the default").
 *
 * A **release** is a frozen, content-addressed copy of the built runtime, outside every development checkout:
 * `<releases>/<id>/node_modules/@qandeel-company/<package>/…` plus `qandeel-release.json`, a manifest of every file's
 * SHA-256. The release ID is the SHA-256 of that file list, so equal builds have equal IDs and any edit is a new ID.
 *
 * A workspace is **pinned** once a release is activated for it: `<workspace>/runtime/production-release.json` names the
 * one release ID that may run it. From then on `CompanyRuntime.start` admits only that release, intact:
 *
 *   - a build that is not a release (a development checkout's `dist`, whatever its branch or last `npm ci`) → refused
 *     `NOT_A_RELEASE`;
 *   - another release → refused `NOT_ACTIVATED`;
 *   - the activated release with any file added, removed or changed → refused `RELEASE_TAMPERED`;
 *   - an unreadable pin → refused `PIN_INVALID` (never treated as unpinned).
 *
 * An unpinned workspace (a development or test Company) admits any build, exactly as before. The check runs before the
 * schema safe-upgrade, so an unadmitted build can never migrate a production Company either. It reads files only:
 * no network, no process, no Company content; refusals carry a reason code only.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { QandeelError, canonicalJson, isSha256Hex, sha256Hex } from '@qandeel-company/domain';
import { layoutFor } from '@qandeel-company/storage';

export const RELEASE_MANIFEST_FILE = 'qandeel-release.json';
export const RELEASE_PIN_FILE = 'production-release.json';
/** How far above a runtime module its release root may sit (`node_modules/@qandeel-company/runtime/dist/src/x.js` = 6). */
const MAX_RELEASE_DEPTH = 8;
const MAX_RELEASE_FILES = 5_000;

export interface ReleaseFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface ReleaseManifest {
  readonly version: 1;
  readonly releaseId: string;
  readonly runtimeVersion: string;
  /** Informational: the source commit the release was staged from (not part of the ID). */
  readonly sourceCommit: string | null;
  readonly stagedAt: string;
  readonly files: readonly ReleaseFile[];
}

export interface ReleasePin {
  readonly version: 1;
  readonly releaseId: string;
  /** Where the activated release lives (the launcher starts its CLI; admission compares IDs, not paths). */
  readonly root: string;
  readonly activatedAt: string;
  readonly previous: { readonly releaseId: string; readonly root: string } | null;
}

export type ReleaseAdmission = { readonly mode: 'UNPINNED'; readonly releaseId: null } | { readonly mode: 'PINNED'; readonly releaseId: string; readonly root: string };

export type ReleaseRefusal = 'PIN_INVALID' | 'NOT_A_RELEASE' | 'NOT_ACTIVATED' | 'RELEASE_TAMPERED';

const refuse = (reason: ReleaseRefusal, message: string): never => {
  throw new QandeelError('RUNTIME_RELEASE_REFUSED', message, { reason });
};

/** The release ID: the SHA-256 of the canonical file list and runtime version (never the staging time or source). */
export function releaseIdOf(runtimeVersion: string, files: readonly ReleaseFile[]): string {
  return sha256Hex(canonicalJson({ version: 1, runtimeVersion, files: [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((f) => ({ path: f.path, sha256: f.sha256, size: f.size })) }));
}

/** Every file under a release root except its manifest, hashed (posix relative paths). A link is never followed. */
export function hashReleaseTree(root: string): ReleaseFile[] | null {
  const out: ReleaseFile[] = [];
  const walk = (dir: string, rel: string): boolean => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (lstatSync(abs).isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        if (!walk(abs, r)) return false;
      } else if (entry.isFile()) {
        if (r === RELEASE_MANIFEST_FILE) continue;
        if (out.length >= MAX_RELEASE_FILES) return false;
        const data = readFileSync(abs);
        out.push({ path: r, sha256: createHash('sha256').update(data).digest('hex'), size: data.length });
      } else return false;
    }
    return true;
  };
  return walk(root, '') ? out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) : null;
}

function parseManifest(raw: unknown): ReleaseManifest | null {
  const m = raw as Partial<ReleaseManifest> | null;
  if (m === null || typeof m !== 'object' || m.version !== 1 || !isSha256Hex(m.releaseId) || typeof m.runtimeVersion !== 'string' || typeof m.stagedAt !== 'string' || !Array.isArray(m.files)) return null;
  if (!(m.sourceCommit === null || (typeof m.sourceCommit === 'string' && /^[0-9a-f]{40}$/.test(m.sourceCommit)))) return null;
  for (const f of m.files as unknown[]) {
    const x = f as Partial<ReleaseFile> | null;
    if (x === null || typeof x !== 'object' || typeof x.path !== 'string' || x.path.length === 0 || x.path.includes('\\') || x.path.split('/').some((p) => p === '' || p === '.' || p === '..') || !isSha256Hex(x.sha256) || !Number.isInteger(x.size) || (x.size as number) < 0) return null;
  }
  return m as ReleaseManifest;
}

export function readReleaseManifest(root: string): ReleaseManifest | null {
  try {
    return parseManifest(JSON.parse(readFileSync(path.join(root, RELEASE_MANIFEST_FILE), 'utf8')));
  } catch {
    return null;
  }
}

/** Verifies a release tree against its own manifest: exactly the listed files, byte-identical, and the ID they imply. */
export function verifyReleaseTree(root: string): { ok: true; manifest: ReleaseManifest } | { ok: false; reason: 'NOT_A_RELEASE' | 'RELEASE_TAMPERED' } {
  if (!existsSync(path.join(root, RELEASE_MANIFEST_FILE))) return { ok: false, reason: 'NOT_A_RELEASE' };
  const manifest = readReleaseManifest(root);
  if (manifest === null) return { ok: false, reason: 'RELEASE_TAMPERED' };
  let actual: ReleaseFile[] | null;
  try {
    actual = hashReleaseTree(root);
  } catch {
    actual = null;
  }
  if (actual === null || canonicalJson(actual) !== canonicalJson([...manifest.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((f) => ({ path: f.path, sha256: f.sha256, size: f.size })))) return { ok: false, reason: 'RELEASE_TAMPERED' };
  if (releaseIdOf(manifest.runtimeVersion, manifest.files) !== manifest.releaseId) return { ok: false, reason: 'RELEASE_TAMPERED' };
  return { ok: true, manifest };
}

/** The release this runtime build was loaded from, or null for a non-release build (a development checkout). */
export function selfReleaseRoot(fromFile: string = fileURLToPath(import.meta.url)): string | null {
  let dir = path.dirname(fromFile);
  for (let i = 0; i < MAX_RELEASE_DEPTH; i++) {
    if (existsSync(path.join(dir, RELEASE_MANIFEST_FILE))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

export const releasePinPath = (workspace: string): string => path.join(layoutFor(path.resolve(workspace)).runtimeDir, RELEASE_PIN_FILE);

/** null = unpinned; undefined = a pin exists but is unreadable or malformed (fail closed). */
export function readReleasePin(workspace: string): ReleasePin | null | undefined {
  const file = releasePinPath(workspace);
  if (!existsSync(file)) return null;
  try {
    const p = JSON.parse(readFileSync(file, 'utf8')) as Partial<ReleasePin> | null;
    const prev = p?.previous;
    if (p === null || typeof p !== 'object' || p.version !== 1 || !isSha256Hex(p.releaseId) || typeof p.root !== 'string' || !path.isAbsolute(p.root) || typeof p.activatedAt !== 'string') return undefined;
    if (!(prev === null || (typeof prev === 'object' && isSha256Hex(prev.releaseId) && typeof prev.root === 'string' && path.isAbsolute(prev.root)))) return undefined;
    return p as ReleasePin;
  } catch {
    return undefined;
  }
}

/**
 * Admits this runtime build for a workspace, or throws `RUNTIME_RELEASE_REFUSED` (reason in `details.reason`).
 * `self` is the release root this build was loaded from (default: located from this module).
 */
export function admitRuntimeRelease(workspace: string, self: string | null = selfReleaseRoot()): ReleaseAdmission {
  const pin = readReleasePin(workspace);
  if (pin === null) return { mode: 'UNPINNED', releaseId: null };
  if (pin === undefined) return refuse('PIN_INVALID', 'the production release pin of this workspace is unreadable');
  if (self === null) return refuse('NOT_A_RELEASE', 'this workspace is pinned to an activated release; a development build may not run it');
  const verified = verifyReleaseTree(self);
  if (!verified.ok) return refuse(verified.reason === 'NOT_A_RELEASE' ? 'NOT_A_RELEASE' : 'RELEASE_TAMPERED', 'this runtime build does not match its release manifest');
  if (verified.manifest.releaseId !== pin.releaseId) return refuse('NOT_ACTIVATED', 'this release is not the one activated for this workspace');
  return { mode: 'PINNED', releaseId: pin.releaseId, root: self };
}
