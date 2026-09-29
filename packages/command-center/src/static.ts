/**
 * Local static assets of the Founder surface: the UI package's compiled modules and public files, the
 * bundled Arabic font and `three` served from the workspace's own `node_modules`. Nothing is fetched from
 * the network; every path is confined to an allow-listed root and an allow-listed extension.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

export interface StaticRoots {
  /** `/app/*` → the UI package's compiled `dist/src`. */
  readonly app: string;
  /** `/` → the UI package's `public` directory (index.html, launch.html, styles, fonts). */
  readonly public: string;
  /** `/vendor/three/*` → the `three` package directory. */
  readonly three: string;
}

/** Walks up from `from` to find `node_modules/three` (npm workspaces hoist it to the repository root). */
export function findThreeRoot(from: string): string {
  let dir = path.resolve(from);
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, 'node_modules', 'three');
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('three is not installed (run npm ci)');
}

/** The UI package root, resolved through its own export map (never a hard-coded path). */
export function uiPackageRoot(): string {
  const entry = fileURLToPath(import.meta.resolve('@qandeel-company/command-center-ui'));
  // <root>/dist/src/index.js → <root>
  return path.resolve(path.dirname(entry), '..', '..');
}

export function defaultStaticRoots(): StaticRoots {
  const ui = uiPackageRoot();
  return { app: path.join(ui, 'dist', 'src'), public: path.join(ui, 'public'), three: findThreeRoot(ui) };
}

export interface StaticFile {
  readonly body: Buffer;
  readonly contentType: string;
  readonly immutable: boolean;
}

/** Resolves one URL path to a file under its root, or null. Dotfiles, traversal and unknown extensions are refused. */
export function resolveStatic(roots: StaticRoots, urlPath: string): StaticFile | null {
  let root: string;
  let rel: string;
  if (urlPath.startsWith('/app/')) {
    root = roots.app;
    rel = urlPath.slice('/app/'.length);
  } else if (urlPath.startsWith('/vendor/three/')) {
    root = roots.three;
    rel = urlPath.slice('/vendor/three/'.length);
  } else {
    root = roots.public;
    rel = urlPath === '/' ? 'index.html' : urlPath === '/launch' ? 'launch.html' : urlPath.slice(1);
  }
  if (rel.length === 0 || rel.length > 512 || rel.includes('\0') || rel.split('/').some((seg) => seg === '' || seg === '.' || seg === '..' || seg.startsWith('.'))) return null;
  const ext = path.extname(rel).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (contentType === undefined) return null;
  const rootReal = safeReal(root);
  if (rootReal === null) return null;
  const full = path.resolve(rootReal, ...rel.split('/'));
  const fullReal = safeReal(full);
  if (fullReal === null || !(fullReal === rootReal || fullReal.startsWith(rootReal + path.sep))) return null;
  try {
    if (!statSync(fullReal).isFile()) return null;
    return { body: readFileSync(fullReal), contentType, immutable: urlPath.startsWith('/vendor/') || ext === '.woff2' };
  } catch {
    return null;
  }
}

function safeReal(p: string): string | null {
  try {
    return realpathSync.native(p);
  } catch {
    return null;
  }
}
