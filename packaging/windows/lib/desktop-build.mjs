/**
 * The QANDEEL COMPANY Desktop v1 build (D1, D-D1-02): source check → build → stage the canonical release → the pinned,
 * verified private Node runtime → compose the Desktop bundle → compile Setup.exe (Inno Setup, pinned) → verify →
 * hashes / verification record. Pure JavaScript; nothing here touches a Company workspace, the vault or LIVE.
 *
 * Downloads are pinned by SHA-256 (the official Node.js SHASUMS256 value for `win-x64/node.exe`; the Inno Setup
 * release asset digest) and refused on any mismatch. Generated binaries live in the build directory outside the
 * repository; nothing generated is committed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PACKAGING_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = path.resolve(PACKAGING_DIR, '..', '..');
export const SETUP_NAME = 'QANDEEL-COMPANY-Setup';
export const VERIFICATION_SCHEMA = 'qandeel.desktop-setup-verification/v1';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const sha256File = (file) => sha256(readFileSync(file));

export function loadPins(file = path.join(PACKAGING_DIR, 'desktop.pins.json')) {
  const pins = JSON.parse(readFileSync(file, 'utf8'));
  const hex = /^[0-9a-f]{64}$/;
  if (pins.schema !== 'qandeel.desktop-pins/v1' || pins.product !== 'QANDEEL COMPANY') throw new Error('PINS_INVALID');
  if (!/^\d+\.\d+\.\d+$/.test(pins.desktopVersion)) throw new Error('PINS_INVALID: desktopVersion must be MAJOR.MINOR.PATCH');
  if (!/^24\.\d+\.\d+$/.test(pins.node?.version) || pins.node.platform !== 'win32' || pins.node.arch !== 'x64') throw new Error('PINS_INVALID: node must be a Node 24 win32 x64 runtime');
  if (!pins.node.url?.startsWith(`https://nodejs.org/dist/v${pins.node.version}/win-x64/`) || !hex.test(pins.node.sha256) || !hex.test(pins.node.licenseSha256 ?? '')) throw new Error('PINS_INVALID: node URL / SHA-256');
  if (!/^\d+\.\d+\.\d+$/.test(pins.inno?.version) || !pins.inno.url?.startsWith('https://github.com/jrsoftware/issrc/releases/download/') || !hex.test(pins.inno.sha256)) throw new Error('PINS_INVALID: inno');
  if (!hex.test(pins.icon?.sha256 ?? '') || !/^\{[0-9A-F-]{36}\}$/.test(pins.appId ?? '')) throw new Error('PINS_INVALID: icon / appId');
  return pins;
}

/** The machine type of a PE image: 'x64' | 'x86' | 'arm64' | null (not a PE file). */
export function peMachine(buf) {
  if (buf.length < 64 || buf.readUInt16LE(0) !== 0x5a4d) return null;
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 6 > buf.length || buf.readUInt32LE(pe) !== 0x00004550) return null;
  return { 0x8664: 'x64', 0x014c: 'x86', 0xaa64: 'arm64' }[buf.readUInt16LE(pe + 4)] ?? 'other';
}

/** The pinned runtime, refused unless it is exactly the pinned bytes AND a Windows x64 image. */
export function verifyNodeRuntime(file, pins) {
  const buf = readFileSync(file);
  if (sha256(buf) !== pins.node.sha256) throw new Error('RUNTIME_HASH_MISMATCH');
  const machine = peMachine(buf);
  if (machine !== pins.node.arch) throw new Error(`RUNTIME_ARCH_MISMATCH (${machine})`);
  return { sha256: pins.node.sha256, machine, bytes: buf.length };
}

/** Downloads (or reuses from the cache) one pinned file; a cached or fresh file with another hash is refused and removed. */
export async function fetchPinned({ url, sha256: want, cacheDir, name }) {
  mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${want.slice(0, 16)}-${name}`);
  if (existsSync(file)) {
    if (sha256File(file) === want) return file;
    rmSync(file, { force: true });
  }
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`DOWNLOAD_FAILED ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== want) throw new Error(`PIN_MISMATCH ${name}: got ${sha256(buf)}`);
  writeFileSync(`${file}.part`, buf);
  renameSync(`${file}.part`, file);
  return file;
}

/** The source commit and whether the tree is clean (a FOUNDER-RC must come from a clean, exact commit). */
export function sourceState(root = ROOT) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  try {
    return { commit: git(['rev-parse', 'HEAD']), clean: git(['status', '--porcelain']) === '' };
  } catch {
    return { commit: null, clean: false };
  }
}

/** The compiled command-center modules (stageRelease, the bundle contract) — the build uses the product's own code. */
export async function productModules(root = ROOT) {
  const dist = path.join(root, 'packages', 'command-center', 'dist', 'src', 'host');
  if (!existsSync(path.join(dist, 'desktop.js'))) throw new Error('SOURCE_NOT_BUILT: run npm run build first');
  const release = await import(pathToFileURL(path.join(dist, 'release.js')).href);
  const desktop = await import(pathToFileURL(path.join(dist, 'desktop.js')).href);
  return { release, desktop };
}

/**
 * Composes `<out>/bundle` from the built checkout: the canonical release (staged by `stageRelease`, unchanged), the
 * pinned runtime and its license, the approved icon, and the `qandeel.desktop-bundle/v1` manifest.
 */
export async function composeBundle({ root = ROOT, out, pins, nodeExe, nodeLicense, desktopVersion = pins.desktopVersion, source = sourceState(root), releaseRoot, now = () => new Date() }) {
  const { release, desktop } = await productModules(root);
  verifyNodeRuntime(nodeExe, pins);
  if (sha256File(nodeLicense) !== pins.node.licenseSha256) throw new Error('RUNTIME_LICENSE_MISMATCH');
  const icon = path.join(PACKAGING_DIR, pins.icon.file);
  if (sha256File(icon) !== pins.icon.sha256) throw new Error('ICON_NOT_APPROVED: the icon differs from the pinned derivative of the canonical asset');
  // The canonical release, staged by the product's own stageRelease (or an already-staged release, for update proofs).
  const staged = releaseRoot ? { root: releaseRoot } : release.stageRelease(root, path.join(out, 'releases'));
  const bundle = path.join(out, 'bundle');
  rmSync(bundle, { recursive: true, force: true });
  mkdirSync(path.join(bundle, 'node'), { recursive: true });
  mkdirSync(path.join(bundle, 'app'), { recursive: true });
  cpSync(staged.root, path.join(bundle, desktop.BUNDLE_RELEASE), { recursive: true });
  cpSync(nodeExe, path.join(bundle, ...desktop.BUNDLE_NODE.split('/')));
  cpSync(nodeLicense, path.join(bundle, 'node', 'LICENSE'));
  cpSync(icon, path.join(bundle, ...desktop.BUNDLE_ICON.split('/')));
  const relManifest = JSON.parse(readFileSync(path.join(bundle, desktop.BUNDLE_RELEASE, 'qandeel-release.json'), 'utf8'));
  const core = {
    schema: desktop.DESKTOP_BUNDLE_SCHEMA,
    product: desktop.DESKTOP_PRODUCT,
    desktopVersion,
    source: { commit: source.commit, clean: source.clean },
    release: { releaseId: relManifest.releaseId, runtimeVersion: relManifest.runtimeVersion, files: relManifest.files.length },
    node: { version: pins.node.version, platform: 'win32', arch: 'x64', file: desktop.BUNDLE_NODE, sha256: pins.node.sha256, url: pins.node.url },
    icon: { file: desktop.BUNDLE_ICON, sha256: pins.icon.sha256, source: 'QANDEEL brand authority I-08B2.5 — APP_ICON_B_DARK_LUMINOUS.svg sha256 859665d86a7bbf4248ff479034031a8df1f08833c7db36336b3d29832bcddd09 (packaging/windows/assets/ICON_PROVENANCE.json)' },
    installer: { schema: desktop.DESKTOP_INSTALLER_SCHEMA, tool: 'Inno Setup', version: pins.inno.version },
    files: desktop.bundleApplicationFiles(bundle),
  };
  const manifest = { ...core, bundleId: desktop.bundleIdOf(core), createdAt: now().toISOString() };
  writeFileSync(path.join(bundle, desktop.DESKTOP_BUNDLE_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  const check = desktop.verifyDesktopBundle(bundle);
  if (!check.ok) throw new Error(`BUNDLE_SELF_CHECK_FAILED ${check.reason}`);
  return { bundleDir: bundle, manifest, versionDir: `${desktopVersion}-${manifest.bundleId.slice(0, 12)}`, releaseRoot: staged.root };
}

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{24,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /"(?:apiKey|api_key|password|clientSecret|client_secret)"\s*:\s*"[^"]{6,}"/i,
];

/**
 * No development path, no secret: every text file of a bundle / build output is scanned for the checkout path (both
 * separators, any case), a `node_modules/.bin` / npm reference, and credential shapes. node.exe (the official signed
 * runtime, hash-pinned) is the only file not scanned as text.
 */
export function scanForLeaks(dir, { checkout = ROOT, skip = (rel) => rel.endsWith('node/node.exe') || rel.endsWith('.ico') || rel.endsWith('.exe') } = {}) {
  const problems = [];
  // The checkout path as written by hand, with forward slashes, and JSON-escaped (`E:\\QANDEEL_COMPANY`).
  const win = checkout.replace(/\//g, '\\');
  const needles = [...new Set([checkout, checkout.replace(/\\/g, '/'), win, win.replace(/\\/g, '\\\\')])].map((s) => s.toLowerCase());
  const walk = (rel) => {
    for (const name of readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      const full = path.join(dir, r);
      if (statSync(full).isDirectory()) {
        if (name === '.bin') problems.push(`${r}: an npm .bin directory`);
        walk(r);
        continue;
      }
      if (skip(r)) continue;
      const text = readFileSync(full, 'utf8');
      const lower = text.toLowerCase();
      for (const n of needles) if (n.length > 3 && lower.includes(n)) problems.push(`${r}: references the development checkout`);
      for (const re of SECRET_PATTERNS) if (re.test(text)) problems.push(`${r}: a credential-shaped value (${re.source.slice(0, 24)}…)`);
    }
  };
  walk('');
  return problems;
}

/** The pinned Inno Setup compiler: installed once (per-user, silent, into the build's tool directory) from the verified installer. */
export async function ensureInno({ pins, cacheDir, toolsDir }) {
  const iscc = path.join(toolsDir, `inno-${pins.inno.version}`, 'ISCC.exe');
  if (!existsSync(iscc)) {
    if (process.platform !== 'win32') throw new Error('INNO_REQUIRES_WINDOWS');
    const installer = await fetchPinned({ url: pins.inno.url, sha256: pins.inno.sha256, cacheDir, name: `innosetup-${pins.inno.version}.exe` });
    const r = spawnSync(installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/CURRENTUSER', '/NOICONS', `/DIR=${path.dirname(iscc)}`], { windowsHide: true, timeout: 300_000 });
    if (r.status !== 0 || !existsSync(iscc)) throw new Error(`INNO_INSTALL_FAILED (${r.status})`);
  }
  // The compiler's own file version (its banner may omit the patch level), then the banner as a fallback.
  const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const info = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${iscc.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  const banner = spawnSync(iscc, ['/?'], { encoding: 'utf8', windowsHide: true });
  const text = `${info.stdout ?? ''}\n${banner.stdout ?? ''}${banner.stderr ?? ''}`;
  if (!new RegExp(`(^|[^\\d.])${pins.inno.version.replace(/\./g, '\\.')}([^\\d.]|$)`, 'm').test(text)) throw new Error(`INNO_VERSION_MISMATCH: expected ${pins.inno.version}, found ${text.trim().slice(0, 200)}`);
  return iscc;
}

/**
 * The signing seam (D-D1-06). Credentials never live in the repository: a code-signing certificate in the build
 * user's certificate store, named by thumbprint, and signtool from the Windows SDK. Unset → an unsigned ENGINEERING
 * artifact. Setup and its uninstaller are signed by Inno Setup itself (SignTool / SignedUninstaller).
 */
export function signingFromEnv(env = process.env) {
  const thumb = env.QANDEEL_SIGN_THUMBPRINT;
  if (!thumb) return null;
  if (!/^[0-9A-Fa-f]{40}$/.test(thumb)) throw new Error('SIGNING_THUMBPRINT_INVALID');
  const signtool = env.QANDEEL_SIGNTOOL;
  if (!signtool || !existsSync(signtool)) throw new Error('SIGNTOOL_NOT_FOUND: set QANDEEL_SIGNTOOL to signtool.exe');
  const timestamp = env.QANDEEL_SIGN_TIMESTAMP_URL ?? 'http://timestamp.digicert.com';
  return { command: `$q${signtool}$q sign /sha1 ${thumb} /fd sha256 /tr ${timestamp} /td sha256 /d $qQANDEEL COMPANY$q $f` };
}

/** Compiles Setup.exe from a composed bundle. Returns the Setup path. */
export function compileSetup({ iscc, bundleDir, manifest, versionDir, pins, outDir, signing = null }) {
  mkdirSync(outDir, { recursive: true });
  const args = [
    '/Qp',
    `/O${outDir}`,
    `/F${SETUP_NAME}`,
    `/DAppVersion=${manifest.desktopVersion}`,
    `/DAppGuid=${pins.appId.slice(1, -1)}`,
    `/DPublisher=${pins.publisher}`,
    `/DBundleDir=${bundleDir}`,
    `/DVersionDir=${versionDir}`,
    `/DBundleId=${manifest.bundleId}`,
    `/DReleaseId=${manifest.release.releaseId}`,
    `/DSourceCommit=${manifest.source.commit ?? 'unknown'}`,
    `/DIconFile=${path.join(PACKAGING_DIR, pins.icon.file)}`,
    ...(signing ? ['/DSigned=1', `/Sqandeelsign=${signing.command}`] : []),
    path.join(PACKAGING_DIR, 'qandeel-company.iss'),
  ];
  const r = spawnSync(iscc, args, { encoding: 'utf8', windowsHide: true, timeout: 900_000 });
  const setup = path.join(outDir, `${SETUP_NAME}.exe`);
  if (r.status !== 0 || !existsSync(setup)) throw new Error(`SETUP_COMPILE_FAILED (${r.status})\n${(r.stdout ?? '').slice(-4000)}\n${(r.stderr ?? '').slice(-2000)}`);
  return setup;
}

/** Authenticode status of a file (Windows): { status, signer, issuer, thumbprint, timestamped }. */
export function authenticode(file) {
  if (process.platform !== 'win32') return { status: 'UNAVAILABLE', signer: null, issuer: null, thumbprint: null, timestamped: false };
  const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; [pscustomobject]@{ status = [string]$s.Status; signer = $s.SignerCertificate.Subject; issuer = $s.SignerCertificate.Issuer; thumbprint = $s.SignerCertificate.Thumbprint; timestamped = [bool]$s.TimeStamperCertificate } | ConvertTo-Json -Compress`;
  const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  try {
    const j = JSON.parse(r.stdout.trim());
    return { status: j.status, signer: j.signer ?? null, issuer: j.issuer ?? null, thumbprint: j.thumbprint ?? null, timestamped: j.timestamped === true };
  } catch {
    return { status: 'UNKNOWN', signer: null, issuer: null, thumbprint: null, timestamped: false };
  }
}

/**
 * The artifact verification record. FOUNDER-RC only when every condition holds: a clean exact source commit, a
 * trusted valid Authenticode signature, and the bundle verified; anything else is ENGINEERING (never "final").
 */
export function verificationRecord({ setup, manifest, versionDir, signature, requestedClass = 'ENGINEERING', now = () => new Date() }) {
  const founderRc = requestedClass === 'FOUNDER-RC' && manifest.source.clean && /^[0-9a-f]{40}$/.test(manifest.source.commit ?? '') && signature.status === 'Valid';
  const blockers = [];
  if (requestedClass === 'FOUNDER-RC' && !founderRc) {
    if (!manifest.source.clean || !manifest.source.commit) blockers.push('SOURCE_NOT_CLEAN_EXACT_COMMIT');
    if (signature.status !== 'Valid') blockers.push('SIGNING_CREDENTIAL_MISSING');
  }
  return {
    schema: VERIFICATION_SCHEMA,
    artifact: path.basename(setup),
    artifactClass: founderRc ? 'FOUNDER-RC' : 'ENGINEERING',
    blockers,
    setupSha256: sha256File(setup),
    setupBytes: statSync(setup).size,
    product: manifest.product,
    desktopVersion: manifest.desktopVersion,
    sourceCommit: manifest.source.commit,
    sourceClean: manifest.source.clean,
    releaseId: manifest.release.releaseId,
    runtimeVersion: manifest.release.runtimeVersion,
    node: { version: manifest.node.version, arch: manifest.node.arch, sha256: manifest.node.sha256 },
    bundleId: manifest.bundleId,
    versionDir,
    installer: manifest.installer,
    icon: manifest.icon,
    authenticode: signature,
    builtAt: now().toISOString(),
  };
}
