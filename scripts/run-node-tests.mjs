#!/usr/bin/env node
// Runs a workspace's compiled node:test suite and refuses a vacuous pass.
//
// `node --test <glob>` exits 0 when nothing matches, and a skipped test is silently green. This
// runner therefore (1) lists every tracked test source `test/**/*.test.ts` (optionally only those
// under `test/<group>/`), (2) requires each compiled `dist/test/**/*.test.js` to exist, (3) runs
// exactly that file list, and (4) fails unless EVERY file ran at least one passing test (counted per
// file by `test-file-counter.mjs`, R1-15: a run-wide total let an emptied proof file pass) and the TAP
// summary shows zero failures, zero cancelled, zero skipped and zero todo tests.
//
// Usage (from a workspace directory): node ../../scripts/run-node-tests.mjs [group]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cwd = process.cwd();
const group = process.argv[2];
const sourceRoot = path.join(cwd, 'test', group ?? '');

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return walk(full);
    return d.name.endsWith('.test.ts') ? [full] : [];
  });
}

const sources = walk(sourceRoot).sort();
if (sources.length === 0) {
  console.error(`run-node-tests: no test/**/*.test.ts files under ${path.relative(cwd, sourceRoot) || '.'} - refusing a vacuous pass`);
  process.exit(1);
}

const compiled = sources.map((s) => path.join(cwd, 'dist', path.relative(cwd, s)).replace(/\.ts$/, '.js'));
const missing = compiled.filter((f) => !existsSync(f));
if (missing.length) {
  console.error('run-node-tests: compiled test files are missing (run the build first):');
  for (const f of missing) console.error(`  - ${path.relative(cwd, f)}`);
  process.exit(1);
}

// Test processes (and every fixture process they spawn) resolve the test-only Founder seam through
// the `qandeel-test` export condition; production processes never carry it (D-C2-13).
function testEnv(env = process.env) {
  const flag = '--conditions=qandeel-test';
  const current = env.NODE_OPTIONS ?? '';
  return { ...env, NODE_OPTIONS: current.split(/\s+/).includes(flag) ? current : `${current} ${flag}`.trim() };
}

const reportDir = mkdtempSync(path.join(tmpdir(), 'qc-tests-'));
const tapFile = path.join(reportDir, 'report.tap');
const countFile = path.join(reportDir, 'per-file.json');
const counter = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-file-counter.mjs')).href;
const result = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-concurrency=1',
    '--test-timeout=180000',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=tap',
    `--test-reporter-destination=${tapFile}`,
    `--test-reporter=${counter}`,
    `--test-reporter-destination=${countFile}`,
    ...compiled,
  ],
  { cwd, stdio: 'inherit', shell: false, env: testEnv() },
);

const summary = {};
let perFile;
try {
  const tap = readFileSync(tapFile, 'utf8');
  for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...tap.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))];
    summary[key] = matches.length ? Number(matches.at(-1)[1]) : undefined;
  }
  try {
    perFile = JSON.parse(readFileSync(countFile, 'utf8'));
  } catch {
    perFile = null;
  }
} finally {
  rmSync(reportDir, { recursive: true, force: true });
}

// Windows paths compare case-insensitively.
const fileKey = (f) => (process.platform === 'win32' ? path.resolve(f).toLowerCase() : path.resolve(f));
const passedPerFile = new Map(Object.entries(perFile ?? {}).map(([f, n]) => [fileKey(f), n]));

const problems = [];
if (result.status !== 0) problems.push(`node --test exited with ${result.status ?? result.signal}`);
if (!(summary.tests >= compiled.length)) problems.push(`only ${summary.tests} tests ran for ${compiled.length} test files`);
if (perFile === null) problems.push('the per-file test counter produced no report');
else for (const f of compiled) if (!((passedPerFile.get(fileKey(f)) ?? 0) >= 1)) problems.push(`${path.relative(cwd, f)} ran no passing test (a test file must prove something)`);
if (summary.fail !== 0) problems.push(`${summary.fail} failed`);
for (const key of ['cancelled', 'skipped', 'todo']) if (summary[key] !== 0) problems.push(`${summary[key]} ${key} (not allowed)`);

console.log(`run-node-tests: ${compiled.length} files, ${summary.tests} tests, ${summary.pass} passed, ${summary.fail} failed`);
if (problems.length) {
  for (const p of problems) console.error(`run-node-tests: FAIL - ${p}`);
  process.exit(1);
}
