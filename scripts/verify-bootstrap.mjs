#!/usr/bin/env node
// C0 repository-contract verifier.
//
// Every run first proves that each rule can fail (self-test against synthetic
// violations), then evaluates the real repository. Any failure exits non-zero.
// Rules read the files Git would commit: tracked files plus untracked files
// that are not ignored (`git ls-files --cached --others --exclude-standard`).

import { execFileSync } from 'node:child_process';
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
];

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

/** @typedef {{ files: string[], read: (p: string) => string | undefined, dirs: (p: string) => string[], env: Record<string, string | undefined>, gitConfig: (key: string) => string | undefined }} Repo */

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

function syntheticRepo(overrides = {}) {
  const baseContents = {
    ...Object.fromEntries([...REQUIRED_FILES, ...REQUIRED_DOCS].map((f) => [f, ''])),
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
  'local-core-longpaths': { longpaths: undefined },
};

export function selfTest() {
  const failures = [];
  const clean = evaluate(syntheticRepo());
  for (const r of clean) if (r.violations.length) failures.push(`clean synthetic repo tripped ${r.id}: ${r.violations.join('; ')}`);
  for (const rule of RULES) {
    const scenario = VIOLATIONS[rule.id];
    if (!scenario) {
      failures.push(`rule ${rule.id} has no violation scenario`);
      continue;
    }
    if (rule.check(syntheticRepo(scenario)).length === 0) failures.push(`rule ${rule.id} did not fail on its violation scenario`);
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
