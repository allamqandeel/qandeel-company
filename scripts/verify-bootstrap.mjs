#!/usr/bin/env node
// Repository-contract verifier (C0; extended at PRE-C1 for the imported authority).
//
// Every run first proves that each rule can fail (self-test against synthetic
// violations), then evaluates the real repository. Any failure exits non-zero.
// Rules read the files Git would commit: tracked files plus untracked files
// that are not ignored (`git ls-files --cached --others --exclude-standard`).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_FILES = [
  '.github/workflows/ci.yml',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.nvmrc',
  '.npmrc',
  'CLAUDE.md',
  'LICENSE.md',
  'README.md',
  'eslint.config.mjs',
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'scripts/verify-bootstrap.mjs',
  'packages/bootstrap-contract/package.json',
  'packages/bootstrap-contract/tsconfig.json',
  'packages/bootstrap-contract/src/index.ts',
  'packages/bootstrap-contract/test/bootstrap-contract.test.ts',
];

const REQUIRED_DOCS = [
  'docs/authority/COMPANY_CANONICAL_BASELINE.md',
  'docs/authority/IMPLEMENTATION_AUTHORITY_RULES.md',
  'docs/architecture/IMPLEMENTATION_MAP.md',
  'docs/architecture/BOUNDARIES.md',
  'docs/architecture/DECISION_LOG.md',
  'docs/environment/L0_READINESS_DECISION.md',
  'docs/C0_REPOSITORY_BOOTSTRAP_CLOSURE.md',
  'docs/authority/company-architecture/README.md',
  'docs/authority/company-architecture/AUTHORITY_IMPORT_MANIFEST.md',
  'docs/PRE_C1_AUTHORITY_SYNC_CLOSURE.md',
];

// Imported canonical authority (PRE-C1). Files under AUTHORITY_DIR are exact byte
// copies whose SHA-256 is recorded in the manifest's imported-files table.
const AUTHORITY_DIR = 'docs/authority/company-architecture/';
const AUTHORITY_INDEX = `${AUTHORITY_DIR}README.md`;
const AUTHORITY_MANIFEST = `${AUTHORITY_DIR}AUTHORITY_IMPORT_MANIFEST.md`;
const STAGE_16_MISSING = 'STAGE 16 SOURCE ARTIFACT — NOT FOUND IN LOCAL AUTHORITY SET';

// Direct Product Owner privacy rules (baseline §5). Matched after removing Markdown
// emphasis and collapsing whitespace, so line wrapping does not matter.
const BASELINE = 'docs/authority/COMPANY_CANONICAL_BASELINE.md';
const PRIVACY_RULES = [
  'Operational telemetry is ALWAYS content-free.',
  'APP-OPS-01 itself provides no path by which Company Operations receives private user content.',
  'No routine or exceptional human review of private QANDEEL conversation content is authorized through Company Operations or safety-monitoring flows.',
];
// Active summary documents must not reintroduce the C0 wording that read as
// "private content excluded by default, with unspecified exceptions".
const PRIVACY_SUMMARY_DOCS = [BASELINE, 'docs/architecture/BOUNDARIES.md', 'docs/authority/IMPLEMENTATION_AUTHORITY_RULES.md', 'README.md', 'CLAUDE.md'];
const STALE_PRIVACY = [/unless separately authori[sz]ed/i, /\b(?:memory|analysis|transcripts?|audio|content|text)\b[^.]{0,40}\bby default\b/i];

const IMPLEMENTATION_MAP = 'docs/architecture/IMPLEMENTATION_MAP.md';
const C1_CLOSURE = /^docs\/C1_[^/]*CLOSURE[^/]*\.md$/i;

// C1 owns the real package structure and extends this list in the same change
// that adds a real package. A placeholder package is a verifier failure.
const ALLOWED_PACKAGES = ['bootstrap-contract'];

const NODE_ENGINE = /^>=24\.\d+\.\d+ <25(\.0\.0)?$/;

// Code and configuration files whose *content* is scanned. Markdown is excluded:
// the authority documents legitimately name the App repository, APP-OPS and tar.
// The lockfile is excluded: third-party package names (e.g. "tar") are not our code.
const CONTENT_EXTENSIONS = /\.(?:[cm]?[jt]s|json|ya?ml|ps1|psm1|cmd|bat|sh)$/i;
const SELF = 'scripts/verify-bootstrap.mjs';
const scanned = (f) => CONTENT_EXTENSIONS.test(f) && f !== SELF && base(f) !== 'package-lock.json';

// Data-like files named as secrets. Code such as `secret-store.ts` or `design-tokens.css` is allowed.
const SECRET_STEM = /^\.?(secrets?|credentials?|token|access[-_]?tokens?|auth[-_]?tokens?|api[-_]?keys?)([._-](local|dev|prod|production))?$/;
const DATA_EXTENSION = /^(|json|txt|ya?ml|ini|conf|cfg|csv|xml|dat|env)$/;

const lower = (s) => s.toLowerCase();
const base = (p) => lower(p.split('/').pop() ?? '');
const segments = (p) => lower(p).split('/');
const stemAndExt = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot + 1)] : [name, ''];
};

const normalizeProse = (s) => (s ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ');

/** Rows of the manifest's imported-files table: `| area | `path` | archive | inner | src sha | imported sha | class | ...`. */
function manifestRows(text) {
  return (text ?? '').split('\n').flatMap((line) => {
    if (!line.startsWith('|')) return [];
    const cells = line.split('|').slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, ''));
    return cells.length >= 7 && cells[1].startsWith(AUTHORITY_DIR) ? [{ path: cells[1], sha256: cells[5], classification: cells[6] }] : [];
  });
}

/** State column of an implementation-map row whose first cell is `id`. */
function mapState(text, id) {
  const row = (text ?? '').split('\n').find((line) => line.startsWith(`| \`${id}\` |`));
  return row?.split('|').slice(1, -1).map((c) => c.trim())[3];
}

/** @typedef {{ files: string[], read: (p: string) => string | undefined, sha256: (p: string) => string | undefined, dirs: (p: string) => string[], env: Record<string, string | undefined>, gitConfig: (key: string) => string | undefined }} Repo */

/** @type {{ id: string, check: (repo: Repo) => string[] }[]} */
export const RULES = [
  {
    id: 'required-top-level-files',
    check: ({ files }) => REQUIRED_FILES.filter((f) => !files.includes(f)).map((f) => `missing ${f}`),
  },
  {
    id: 'required-docs',
    check: ({ files }) => REQUIRED_DOCS.filter((f) => !files.includes(f)).map((f) => `missing ${f}`),
  },
  {
    id: 'root-package-private',
    check: ({ read }) => (json(read('package.json'))?.private === true ? [] : ['package.json "private" is not true']),
  },
  {
    id: 'node-engine-24-bounded',
    check: ({ read }) => {
      const engine = json(read('package.json'))?.engines?.node;
      return typeof engine === 'string' && NODE_ENGINE.test(engine)
        ? []
        : [`engines.node must be a bounded Node 24 range (">=24.x.y <25.0.0"), got ${JSON.stringify(engine)}`];
    },
  },
  {
    id: 'npm-workspaces-configured',
    check: ({ read, files }) => {
      const ws = json(read('package.json'))?.workspaces;
      if (!Array.isArray(ws) || ws.length === 0) return ['package.json "workspaces" is missing or empty'];
      return ws.flatMap((w) => {
        const manifest = json(read(`${w}/package.json`));
        if (!files.includes(`${w}/package.json`) || !manifest) return [`workspace ${w} has no package.json`];
        return manifest.private === true ? [] : [`workspace ${w} is not private`];
      });
    },
  },
  {
    id: 'package-lock-present',
    check: ({ read, files }) => {
      if (!files.includes('package-lock.json')) return ['package-lock.json is not tracked'];
      const lock = json(read('package-lock.json'));
      if (lock?.lockfileVersion !== 3) return ['package-lock.json is not lockfileVersion 3'];
      const ws = json(read('package.json'))?.workspaces ?? [];
      return ws.filter((w) => !lock.packages?.[w]).map((w) => `package-lock.json does not record workspace ${w}`);
    },
  },
  {
    id: 'no-env-files',
    check: ({ files }) => files.filter((f) => /^\.env(\..+)?$/.test(base(f)) && base(f) !== '.env.example'),
  },
  {
    id: 'no-secret-files',
    check: ({ files, read }) => [
      ...files.filter((f) => {
        const b = base(f);
        return (
          /\.(pem|key|p12|pfx|kdbx|keystore|jks)$/.test(b) ||
          /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(b) ||
          ['.git-credentials', '.netrc', '_netrc'].includes(b) ||
          (([stem, ext]) => SECRET_STEM.test(stem) && DATA_EXTENSION.test(ext))(stemAndExt(b))
        );
      }),
      ...files
        .filter((f) => base(f) === '.npmrc' && /(_authtoken|_auth|_password)\s*=/i.test(read(f) ?? ''))
        .map((f) => `${f} contains registry auth`),
    ],
  },
  {
    id: 'no-node-modules',
    check: ({ files }) => files.filter((f) => segments(f).includes('node_modules')),
  },
  {
    id: 'no-sqlite-runtime-files',
    check: ({ files }) => files.filter((f) => /\.(db|sqlite|sqlite3|db-journal)$|-(wal|shm)$/.test(base(f))),
  },
  {
    id: 'no-native-binaries',
    check: ({ files }) => files.filter((f) => /\.(exe|dll|node|so|dylib|sys|msi|lib|obj|pdb)$/.test(base(f))),
  },
  {
    id: 'no-app-repo-dependency',
    check: ({ files, read }) => {
      const appPath = /qandeel[\\/]+qandeel project|allamqandeel\/qandeel(?:\.git|['"\s/]|$)/i;
      const found = files
        .filter((f) => scanned(f) && appPath.test(read(f) ?? ''))
        .map((f) => `${f} references the QANDEEL App repository`);
      const deps = allManifests({ files, read }).flatMap(([f, m]) =>
        Object.entries({ ...m.dependencies, ...m.devDependencies, ...m.optionalDependencies, ...m.peerDependencies })
          .filter(([, spec]) => /^(file|link|git\+|git:|github:)|\.\.[\\/]/i.test(String(spec)))
          .map(([name, spec]) => `${f} depends on ${name} via ${spec} (outside the registry / repository)`),
      );
      return [...found, ...deps];
    },
  },
  {
    id: 'no-tar-exe-backup',
    check: ({ files, read }) => {
      const tar = new RegExp(String.raw`(^|[\s"'\`(;&|])tar(\.exe)?(\s|["'\`)]|$)`, 'im');
      return files.filter((f) => scanned(f) && tar.test(read(f) ?? ''));
    },
  },
  {
    id: 'no-app-ops-implementation',
    check: ({ files, read }) => {
      const appOps = /\bapp[-_]?ops\b/i;
      return files.filter(
        (f) =>
          !f.startsWith('docs/') &&
          !lower(f).endsWith('.md') &&
          f !== SELF &&
          (appOps.test(f) || (scanned(f) && appOps.test(read(f) ?? ''))),
      );
    },
  },
  {
    id: 'workspace-tests-present',
    // `node --test <glob>` exits 0 when the glob matches nothing, so the verifier
    // requires every workspace to track tests and to run them with node:test.
    check: ({ files, read }) =>
      (json(read('package.json'))?.workspaces ?? []).flatMap((w) => {
        const problems = [];
        if (!files.some((f) => f.startsWith(`${w}/test/`) && f.endsWith('.test.ts'))) problems.push(`workspace ${w} tracks no test/**/*.test.ts file`);
        if (!/node --test\b/.test(json(read(`${w}/package.json`))?.scripts?.test ?? '')) problems.push(`workspace ${w} "test" script does not run node --test`);
        return problems;
      }),
  },
  {
    id: 'no-placeholder-packages',
    check: ({ files, dirs }) => {
      const fromFiles = new Set(files.filter((f) => f.startsWith('packages/')).map((f) => f.split('/')[1]));
      const onDisk = dirs('packages');
      return [...new Set([...fromFiles, ...onDisk])]
        .filter((p) => p !== undefined && !ALLOWED_PACKAGES.includes(p))
        .map((p) => `packages/${p} is not an approved package (C1 owns new packages)`);
    },
  },
  {
    id: 'gitattributes-explicit',
    check: ({ read }) => {
      const ga = read('.gitattributes') ?? '';
      const problems = [];
      if (!/^\*\s+text=auto\b/m.test(ga)) problems.push('.gitattributes lacks an explicit "* text=auto" rule');
      if (!/^\*\.sh\s+text\s+eol=lf/m.test(ga)) problems.push('.gitattributes does not pin *.sh to LF');
      if (!/^\*\.ps1\s+text\s+eol=crlf/m.test(ga)) problems.push('.gitattributes does not pin *.ps1 line endings');
      if (!/^\*\.png\s+binary/m.test(ga)) problems.push('.gitattributes has no binary patterns');
      return problems;
    },
  },
  {
    id: 'authority-import-integrity',
    // Every imported file is listed, present and hash-identical; nothing superseded or
    // unclassified is presented as authority; a missing Stage stays explicitly missing.
    check: ({ files, read, sha256 }) => {
      const manifest = read(AUTHORITY_MANIFEST);
      if (manifest === undefined) return [`missing ${AUTHORITY_MANIFEST}`];
      const rows = manifestRows(manifest);
      if (rows.length === 0) return [`${AUTHORITY_MANIFEST} lists no imported files`];
      const problems = [];
      const listed = new Set();
      for (const { path: p, sha256: recorded, classification } of rows) {
        if (listed.has(p)) problems.push(`${p} is listed twice`);
        listed.add(p);
        if (!/^[0-9a-f]{64}$/.test(recorded)) problems.push(`${p} has no valid imported SHA-256`);
        else if (!files.includes(p)) problems.push(`${p} is listed but not present`);
        else if (sha256(p) !== recorded) problems.push(`${p} does not match its recorded SHA-256`);
        if (/SUPERSEDED|UNKNOWN/i.test(classification)) problems.push(`${p} is imported as ${classification}`);
      }
      for (const f of files.filter((f) => f.startsWith(AUTHORITY_DIR) && f !== AUTHORITY_INDEX && f !== AUTHORITY_MANIFEST)) {
        if (!listed.has(f)) problems.push(`${f} is not listed in the manifest`);
        if (!lower(f).endsWith('.md')) problems.push(`${f} is not Markdown`);
      }
      const stage16Imported = [...listed].some((p) => p.includes('/STAGE_16/'));
      if (!stage16Imported && !(read(AUTHORITY_INDEX) ?? '').includes(STAGE_16_MISSING)) {
        problems.push(`${AUTHORITY_INDEX} does not record "${STAGE_16_MISSING}"`);
      }
      return problems;
    },
  },
  {
    id: 'no-archive-dumps',
    check: ({ files }) =>
      files.filter(
        (f) =>
          /\.(zip|7z|rar|tar|tgz|gz|bz2|xz|cab|iso)$/.test(base(f)) ||
          (f.startsWith('docs/authority/') && !lower(f).endsWith('.md')),
      ),
  },
  {
    id: 'privacy-hard-boundaries',
    check: ({ read }) => {
      const baseline = normalizeProse(read(BASELINE));
      const problems = PRIVACY_RULES.filter((r) => !baseline.includes(r)).map((r) => `${BASELINE} does not state "${r}"`);
      for (const doc of PRIVACY_SUMMARY_DOCS) {
        const text = normalizeProse(read(doc));
        for (const stale of STALE_PRIVACY) {
          const hit = text.match(stale);
          if (hit) problems.push(`${doc} contains default-with-exception privacy wording: "${hit[0]}"`);
        }
      }
      return problems;
    },
  },
  {
    id: 'implementation-lifecycle-state',
    // Stage-aware: C1 may be marked closed only in the change that adds its closure record.
    check: ({ files, read }) => {
      const map = read(IMPLEMENTATION_MAP);
      const problems = [];
      for (const id of ['L0', 'C0']) {
        const state = mapState(map, id);
        if (state !== 'CLOSED / PASS') problems.push(`${id} state is ${JSON.stringify(state)}, expected "CLOSED / PASS"`);
      }
      const c1 = mapState(map, 'C1');
      if (c1 === undefined) problems.push('implementation map has no C1 row');
      else if (/CLOSED|PASS|DONE|IMPLEMENTED|COMPLETE|MERGED/i.test(c1) && !files.some((f) => C1_CLOSURE.test(f))) {
        problems.push(`C1 is marked ${JSON.stringify(c1)} but no docs/C1_*CLOSURE*.md record exists`);
      }
      return problems;
    },
  },
  {
    id: 'local-core-longpaths',
    // A fresh CI checkout has no Founder-local config; the rule applies to local clones.
    check: ({ env, gitConfig }) =>
      env.CI === 'true' || gitConfig('core.longpaths') === 'true'
        ? []
        : ['repository-local core.longpaths is not "true" (required on the Founder Windows host)'],
  },
];

function json(text) {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function allManifests({ files, read }) {
  return files
    .filter((f) => base(f) === 'package.json')
    .map((f) => [f, json(read(f))])
    .filter(([, m]) => m);
}

export function evaluate(repo) {
  return RULES.map((rule) => ({ id: rule.id, violations: rule.check(repo) }));
}

// ---------------------------------------------------------------------------
// Self-test: a clean synthetic repository passes every rule, and a targeted
// violation makes each rule fail. A rule that cannot fail is a verifier bug.

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const SYNTH_SOURCE = `${AUTHORITY_DIR}STAGE_01/QANDEEL_COMPANY_STAGE_1_COMPANY_CONSTITUTION_v1.md`;
const SYNTH_SOURCE_TEXT = '# Stage 1\n\n**Status:** CLOSED / ACCEPTED  \n';
const SYNTH_STAGE_16 = `${AUTHORITY_DIR}STAGE_16/STAGE_16_CANONICAL_CLOSURE_v1.md`;
const manifestRow = (p, text, classification = 'CLOSED / FROZEN') =>
  `| Stage | \`${p}\` | \`a.zip\` | \`a/x.md\` | \`${sha(text)}\` | \`${sha(text)}\` | ${classification} | exact | - | - |`;
const synthManifest = (...rows) => ['# Manifest', '', '| Stage / area | Imported repo path | a | b | c | d | e | f | g | h |', '|---|---|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n');
const synthMap = (c0 = 'CLOSED / PASS', c1 = 'NEXT — CLOUD MEGA-TASK') =>
  ['| Stage | Name | Mode | State |', '|---|---|---|---|', '| `L0` | Env | Local | CLOSED / PASS |', `| \`C0\` | Boot | Local | ${c0} |`, `| \`C1\` | Found | Cloud | ${c1} |`, ''].join('\n');
const SYNTH_BASELINE = `## 5. Data and privacy\n\n- **Rule A — ${PRIVACY_RULES[0]}**\n- **Rule B — ${PRIVACY_RULES[1].replace('private user content', 'private user\n  content')}**\n- **Rule C — ${PRIVACY_RULES[2]}**\n\n## 2. Operating principles\n\n- Event-driven by default.\n`;

function syntheticRepo(overrides = {}) {
  const baseContents = {
    ...Object.fromEntries([...REQUIRED_FILES, ...REQUIRED_DOCS].map((f) => [f, ''])),
    [BASELINE]: SYNTH_BASELINE,
    [IMPLEMENTATION_MAP]: synthMap(),
    [AUTHORITY_INDEX]: `## Missing\n\n**${STAGE_16_MISSING}.**\n`,
    [AUTHORITY_MANIFEST]: synthManifest(manifestRow(SYNTH_SOURCE, SYNTH_SOURCE_TEXT)),
    [SYNTH_SOURCE]: SYNTH_SOURCE_TEXT,
    'package.json': JSON.stringify({ private: true, engines: { node: '>=24.11.0 <25.0.0' }, workspaces: ['packages/bootstrap-contract'] }),
    'packages/bootstrap-contract/package.json': JSON.stringify({ private: true, scripts: { test: 'node --test dist/test' } }),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'packages/bootstrap-contract': {}, 'node_modules/tar': { version: '7.0.0' } } }),
    '.gitattributes': '* text=auto eol=lf\n*.sh text eol=lf\n*.ps1 text eol=crlf\n*.png binary\n',
    '.npmrc': 'engine-strict=true\n',
    // Legitimate names that earlier rule versions wrongly flagged; they must stay clean.
    'packages/bootstrap-contract/src/secret-store.ts': 'export {};',
    'packages/bootstrap-contract/src/design-tokens.css': '',
    'packages/bootstrap-contract/src/whatsapp-ops.ts': 'export const whatsappOps = 1;',
    ...overrides.contents,
  };
  const files = Object.keys(baseContents).filter((f) => !(overrides.remove ?? []).includes(f));
  const longpaths = 'longpaths' in overrides ? overrides.longpaths : 'true';
  return {
    files,
    read: (p) => (files.includes(p) ? baseContents[p] : undefined),
    sha256: (p) => (files.includes(p) ? sha(baseContents[p]) : undefined),
    dirs: (p) => (p === 'packages' ? (overrides.dirs ?? ['bootstrap-contract']) : []),
    env: overrides.env ?? {},
    gitConfig: (key) => (key === 'core.longpaths' ? longpaths : undefined),
  };
}

const VIOLATIONS = {
  'required-top-level-files': { remove: ['CLAUDE.md'] },
  'required-docs': { remove: ['docs/architecture/BOUNDARIES.md'] },
  'root-package-private': { contents: { 'package.json': JSON.stringify({ private: false, engines: { node: '>=24.11.0 <25.0.0' }, workspaces: ['packages/bootstrap-contract'] }) } },
  'node-engine-24-bounded': { contents: { 'package.json': JSON.stringify({ private: true, engines: { node: '>=24' }, workspaces: ['packages/bootstrap-contract'] }) } },
  'npm-workspaces-configured': { contents: { 'package.json': JSON.stringify({ private: true, engines: { node: '>=24.11.0 <25.0.0' } }) } },
  'package-lock-present': { remove: ['package-lock.json'] },
  'no-env-files': { contents: { 'config/.env.local': 'X=1' } },
  'no-secret-files': { contents: { 'deploy/id_ed25519': '', '.npmrc': '//registry.npmjs.org/:_authToken=abc\n' } },
  'no-node-modules': { contents: { 'node_modules/left-pad/index.js': '' } },
  'no-sqlite-runtime-files': { contents: { 'data/company.sqlite-wal': '' } },
  'no-native-binaries': { contents: { 'tools/helper.exe': '' } },
  'no-app-repo-dependency': { contents: { 'scripts/sync.mjs': "const app = 'E:/QANDEEL/QANDEEL PROJECT';" } },
  'no-tar-exe-backup': { contents: { 'scripts/backup.ps1': 'tar.exe -cf backup.tar data' } },
  'no-app-ops-implementation': { contents: { 'packages/bootstrap-contract/src/app-ops.ts': 'export {};' } },
  'workspace-tests-present': { remove: ['packages/bootstrap-contract/test/bootstrap-contract.test.ts'] },
  'no-placeholder-packages': { dirs: ['bootstrap-contract', 'employees'] },
  'gitattributes-explicit': { contents: { '.gitattributes': '*.png binary\n' } },
  'authority-import-integrity': [
    { contents: { [SYNTH_SOURCE]: `${SYNTH_SOURCE_TEXT}edited\n` } },
    { contents: { [SYNTH_STAGE_16]: '# Stage 16 (reconstructed)\n' } },
    { contents: { [AUTHORITY_INDEX]: '## Missing\n\nnone\n' } },
    { contents: { [AUTHORITY_MANIFEST]: synthManifest(manifestRow(SYNTH_SOURCE, SYNTH_SOURCE_TEXT, 'SUPERSEDED')) } },
    { contents: { [AUTHORITY_MANIFEST]: synthManifest(manifestRow(SYNTH_SOURCE, SYNTH_SOURCE_TEXT), manifestRow(`${AUTHORITY_DIR}STAGE_02/gone.md`, 'x')) } },
    { remove: [AUTHORITY_MANIFEST] },
  ],
  'no-archive-dumps': [
    { contents: { [`${AUTHORITY_DIR}QANDEEL_COMPANY_STAGE_1_CANONICAL_CLOSURE_v1.zip`]: '' } },
    { contents: { 'docs/authority/scan.png': '' } },
  ],
  'privacy-hard-boundaries': [
    { contents: { [BASELINE]: `${SYNTH_BASELINE}- QANDEEL COMPANY does not receive private transcripts, Memory or Analysis by default.\n` } },
    { contents: { 'docs/architecture/BOUNDARIES.md': 'It carries no Memory unless separately\n  authorized Product authority says otherwise.\n' } },
    { contents: { [BASELINE]: SYNTH_BASELINE.replace(PRIVACY_RULES[0], 'Operational telemetry is content-free by default.') } },
  ],
  'implementation-lifecycle-state': [
    { contents: { [IMPLEMENTATION_MAP]: synthMap('Current task') } },
    { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / PASS') } },
  ],
  'local-core-longpaths': { longpaths: undefined },
};

// Legitimate future states that each rule must accept (stage-awareness, not a frozen snapshot).
const MUST_PASS = [
  { id: 'implementation-lifecycle-state', scenario: { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / PASS'), 'docs/C1_COMPANY_FOUNDATION_CLOSURE.md': '' } } },
  {
    id: 'authority-import-integrity',
    scenario: {
      contents: {
        [SYNTH_STAGE_16]: '# Stage 16\n',
        [AUTHORITY_MANIFEST]: synthManifest(manifestRow(SYNTH_SOURCE, SYNTH_SOURCE_TEXT), manifestRow(SYNTH_STAGE_16, '# Stage 16\n', 'FINAL CLOSURE RECORD')),
        [AUTHORITY_INDEX]: '## Missing\n\nnone\n',
      },
    },
  },
];

export function selfTest() {
  const failures = [];
  const clean = evaluate(syntheticRepo());
  for (const r of clean) if (r.violations.length) failures.push(`clean synthetic repo tripped ${r.id}: ${r.violations.join('; ')}`);
  for (const rule of RULES) {
    const scenarios = VIOLATIONS[rule.id];
    if (!scenarios) {
      failures.push(`rule ${rule.id} has no violation scenario`);
      continue;
    }
    [scenarios].flat().forEach((scenario, i) => {
      if (rule.check(syntheticRepo(scenario)).length === 0) failures.push(`rule ${rule.id} did not fail on violation scenario ${i + 1}`);
    });
  }
  for (const { id, scenario } of MUST_PASS) {
    const violations = RULES.find((r) => r.id === id)?.check(syntheticRepo(scenario)) ?? [`no rule ${id}`];
    if (violations.length) failures.push(`rule ${id} rejected a legitimate state: ${violations.join('; ')}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function realRepo() {
  const files = git(['-c', 'core.quotepath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
    .filter((f) => existsSync(path.join(ROOT, f)));
  return {
    files,
    read: (p) => {
      const full = path.join(ROOT, p);
      return existsSync(full) && statSync(full).isFile() ? readFileSync(full, 'utf8') : undefined;
    },
    // Hash the bytes on disk, not a decoded string, so any byte-level change is caught.
    sha256: (p) => {
      const full = path.join(ROOT, p);
      return existsSync(full) && statSync(full).isFile() ? createHash('sha256').update(readFileSync(full)).digest('hex') : undefined;
    },
    dirs: (p) => {
      const full = path.join(ROOT, p);
      return existsSync(full) ? readdirSync(full, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
    },
    env: process.env,
    gitConfig: (key) => {
      try {
        return git(['config', '--local', '--get', key]).trim();
      } catch {
        return undefined;
      }
    },
  };
}

async function workspaceResolution() {
  // Resolve the workspace package by name, exactly as a consumer would.
  const mod = await import('@qandeel-company/bootstrap-contract');
  const result = mod.checkRuntime(process.versions.node);
  const problems = [];
  if (mod.BOOTSTRAP_METADATA?.stage !== 'C0') problems.push('bootstrap metadata stage is not C0');
  if (result.status !== 'ok') problems.push(`runtime check failed: ${JSON.stringify(result)}`);
  return problems;
}

async function main() {
  const selfFailures = selfTest();
  if (selfFailures.length) {
    console.error('verify-bootstrap: SELF-TEST FAILED - the verifier itself is broken');
    for (const f of selfFailures) console.error(`  - ${f}`);
    process.exit(2);
  }
  console.log(`verify-bootstrap: self-test ok (${RULES.length} rules each proved able to fail)`);

  const repo = realRepo();
  if (repo.files.length < REQUIRED_FILES.length + REQUIRED_DOCS.length) {
    console.error(`verify-bootstrap: only ${repo.files.length} files visible to git - refusing a vacuous pass`);
    process.exit(1);
  }

  const results = evaluate(repo);
  let resolutionProblems;
  try {
    resolutionProblems = await workspaceResolution();
  } catch (error) {
    resolutionProblems = [`cannot import @qandeel-company/bootstrap-contract (run "npm run build" first): ${error.message}`];
  }
  results.push({ id: 'workspace-resolution', violations: resolutionProblems });

  let failed = 0;
  for (const r of results) {
    if (r.violations.length) {
      failed++;
      console.error(`FAIL ${r.id}`);
      for (const v of r.violations) console.error(`     - ${v}`);
    } else {
      console.log(`ok   ${r.id}`);
    }
  }
  console.log(`verify-bootstrap: ${repo.files.length} files checked, ${results.length - failed}/${results.length} rules passed`);
  if (failed) process.exit(1);
}

// Compare real paths: import.meta.url is the entry's realpath, argv[1] is the path as typed.
const isEntry = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();

if (isEntry) {
  await main();
}
