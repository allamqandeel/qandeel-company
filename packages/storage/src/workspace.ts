/**
 * Company Workspace — live Company state, kept separate from the source checkout.
 *
 * The runtime never assumes its data lives inside the Git repository and never hardcodes a
 * Founder path: the caller supplies the workspace root. C1 creates only the directories it uses:
 *
 *   <workspace>/
 *     state/company.sqlite3      canonical operational store (SQLite/WAL)
 *     artifacts/objects/         content-addressed artifact objects
 *     artifacts/tmp/             task-owned staging files
 *     backups/                   online-backup snapshots + manifests
 *     runtime/                   runtime wake signal
 *
 * SQLite WAL requires every connection to be on the same host and does not work over network
 * filesystems. Network/UNC locations are rejected where reliably detectable; mapped network drives
 * on Windows cannot be detected without native code and are documented as unsupported.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statfsSync } from 'node:fs';
import path from 'node:path';

import { QandeelError } from '@qandeel-company/domain';

export interface WorkspaceLayout {
  readonly root: string;
  readonly stateDir: string;
  readonly databasePath: string;
  readonly artifactsDir: string;
  readonly objectsDir: string;
  readonly artifactTmpDir: string;
  readonly backupsDir: string;
  readonly runtimeDir: string;
  readonly wakeFile: string;
}

export const DATABASE_FILE = 'company.sqlite3';

/** Linux filesystem types that are network or remote mounts (SQLite WAL is unsafe on them). */
const NETWORK_FS_TYPES = new Set(['nfs', 'nfs4', 'cifs', 'smb3', 'smbfs', 'sshfs', 'fuse.sshfs', 'afs', 'glusterfs', 'ceph', 'fuse.glusterfs', '9p', 'fuse.rclone', 'davfs', 'fuse.davfs2']);

export function layoutFor(root: string): WorkspaceLayout {
  const stateDir = path.join(root, 'state');
  const artifactsDir = path.join(root, 'artifacts');
  const runtimeDir = path.join(root, 'runtime');
  return Object.freeze({
    root,
    stateDir,
    databasePath: path.join(stateDir, DATABASE_FILE),
    artifactsDir,
    objectsDir: path.join(artifactsDir, 'objects'),
    artifactTmpDir: path.join(artifactsDir, 'tmp'),
    backupsDir: path.join(root, 'backups'),
    runtimeDir,
    wakeFile: path.join(runtimeDir, 'wake.signal'),
  });
}

/** Rejects paths that are clearly not local: UNC shares and device namespaces (all platforms). */
export function assertLocalPathSyntax(candidate: string, platform: NodeJS.Platform = process.platform): void {
  const unsafe = (why: string): never => {
    throw new QandeelError('UNSAFE_WORKSPACE', `workspace path rejected: ${why}`, { reason: why });
  };
  if (typeof candidate !== 'string' || candidate.trim() === '') unsafe('empty path');
  if (candidate.includes('\0')) unsafe('NUL byte in path');
  // Any leading double separator is a UNC share, `\\?\UNC\…`, or a device namespace. The only
  // allowed form is the local long-path prefix `\\?\C:\…`.
  const backslashed = candidate.replace(/\//g, '\\');
  const localLongPath = /^\\\\\?\\[A-Za-z]:\\/.test(backslashed);
  if (backslashed.startsWith('\\\\') && !localLongPath) unsafe('UNC / network or device path');
  const isAbsolute = platform === 'win32' ? path.win32.isAbsolute(candidate) : path.posix.isAbsolute(candidate);
  if (!isAbsolute) unsafe('workspace path must be absolute');
  if (platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(candidate) && !localLongPath) unsafe('Windows workspace must be on a drive letter');
}

/** Linux only: the filesystem type of the mount that contains `target` (longest mount point match). */
function linuxMountFsType(target: string): string | undefined {
  let info: string;
  try {
    info = readFileSync('/proc/self/mountinfo', 'utf8');
  } catch {
    return undefined;
  }
  let best: { point: string; type: string } | undefined;
  for (const line of info.split('\n')) {
    const [left, right] = line.split(' - ');
    if (left === undefined || right === undefined) continue;
    const point = (left.split(' ')[4] ?? '').replace(/\\040/g, ' ');
    const type = right.split(' ')[0] ?? '';
    const within = target === point || target.startsWith(point.endsWith('/') ? point : `${point}/`);
    if (within && (best === undefined || point.length > best.point.length)) best = { point, type };
  }
  return best?.type;
}

/**
 * Live Company state never lives inside a source checkout (this repository, the QANDEEL App's, or
 * any other): one `git add -A` would otherwise commit Company content. A `.git` file (worktree)
 * counts too.
 */
function assertOutsideSourceCheckout(target: string): void {
  for (let dir = target; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) {
      throw new QandeelError('UNSAFE_WORKSPACE', 'workspace is inside a Git working tree; live Company state must stay outside source checkouts', { reason: 'inside-source-checkout' });
    }
    if (path.dirname(dir) === dir) break;
  }
}

/** The location checks of `openWorkspace`, creating nothing (a live restore validates its target before its first byte). */
export function assertWorkspaceLocation(root: string): void {
  assertLocalPathSyntax(root);
  assertOutsideSourceCheckout(canonicalPath(path.resolve(root)));
}

export interface OpenWorkspaceOptions {
  /** Create missing directories (default true). */
  readonly create?: boolean;
}

/**
 * Validates and (optionally) creates the workspace, returning its canonical layout.
 * Throws UNSAFE_WORKSPACE for network locations, symlinked workspace directories or files where
 * directories are expected.
 */
export function openWorkspace(root: string, options: OpenWorkspaceOptions = {}): WorkspaceLayout {
  assertLocalPathSyntax(root);
  const create = options.create ?? true;
  const resolved = path.resolve(root);
  assertOutsideSourceCheckout(canonicalPath(resolved)); // before anything is created
  if (!existsSync(resolved)) {
    if (!create) throw new QandeelError('UNSAFE_WORKSPACE', 'workspace does not exist', { reason: 'missing' });
    mkdirSync(resolved, { recursive: true });
  }
  const real = realpathSync.native(resolved);
  assertLocalPathSyntax(real);
  if (process.platform === 'linux') {
    const fsType = linuxMountFsType(real);
    if (fsType !== undefined && NETWORK_FS_TYPES.has(fsType)) {
      throw new QandeelError('UNSAFE_WORKSPACE', 'workspace is on a network filesystem; SQLite WAL requires a local filesystem', { reason: 'network-fs', fsType });
    }
  }
  assertOutsideSourceCheckout(real);
  const layout = layoutFor(real);
  for (const dir of [layout.stateDir, layout.artifactsDir, layout.objectsDir, layout.artifactTmpDir, layout.backupsDir, layout.runtimeDir]) {
    if (existsSync(dir)) {
      const st = lstatSync(dir);
      if (st.isSymbolicLink() || !st.isDirectory()) {
        throw new QandeelError('UNSAFE_WORKSPACE', 'workspace directory is a link or not a directory', { reason: 'not-a-plain-directory', dir: path.relative(real, dir) });
      }
    } else if (create) {
      mkdirSync(dir, { recursive: true });
    } else {
      throw new QandeelError('UNSAFE_WORKSPACE', 'workspace directory is missing', { reason: 'missing', dir: path.relative(real, dir) });
    }
  }
  if (!create && !existsSync(layout.databasePath)) {
    throw new QandeelError('UNSAFE_WORKSPACE', 'workspace has no Company database', { reason: 'missing-database' });
  }
  if (existsSync(layout.databasePath) && lstatSync(layout.databasePath).isSymbolicLink()) {
    throw new QandeelError('UNSAFE_WORKSPACE', 'database file is a symbolic link', { reason: 'db-symlink' });
  }
  return layout;
}

/**
 * Canonical real path of `target` even if it does not exist yet: the deepest existing ancestor is
 * resolved with the OS (which also expands Windows 8.3 short names such as `RUNNER~1`) and the
 * remaining segments are appended. Path containment checks must compare canonical paths.
 */
export function canonicalPath(target: string): string {
  const resolved = path.resolve(target);
  const rest: string[] = [];
  let cursor = resolved;
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return resolved;
    rest.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.join(realpathSync.native(cursor), ...rest);
}

/** True if `child` is `parent` or lies inside it (canonical paths; case-insensitive on Windows). */
export function isWithin(parent: string, child: string): boolean {
  const norm = (p: string): string => (process.platform === 'win32' ? canonicalPath(p).toLowerCase() : canonicalPath(p));
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Free space of the workspace volume, for health reporting. */
export function workspaceFreeBytes(layout: WorkspaceLayout): number | undefined {
  try {
    const st = statfsSync(layout.root);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return undefined;
  }
}

/**
 * Resolves `relative` inside `base` and refuses anything that escapes it (path traversal defense
 * in depth; callers already derive paths only from validated IDs and hashes).
 */
export function containedPath(base: string, ...relative: string[]): string {
  const full = path.resolve(base, ...relative);
  const rel = path.relative(base, full);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new QandeelError('UNSAFE_WORKSPACE', 'resolved path escapes its workspace directory', { reason: 'path-traversal' });
  }
  return full;
}
