#!/usr/bin/env node
// CI quality gate (D-R1-07, D-C4-08): the one stable, required status. It passes only when every job the
// run's mode requires succeeded AND — on the full path — every recorded mutation of every mutation check ran
// exactly once on EACH operating system across its shards (proof parity: parallelism never deletes coverage).
//
//   node scripts/ci/quality-gate.mjs --mode docs|full|fast-integrity --needs <needs.json> [--reports <dir>]

import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MUTATION_SCRIPTS = ['c1', 'c2', 'c3', 'r1', 'c4', 'c5', 'c6', 'c7a', 'c7b', 'c7c', 'c7d'];
export const OPERATING_SYSTEMS = ['windows-latest', 'ubuntu-latest'];
const REQUIRED = {
  docs: ['classify', 'docs-fast'],
  'fast-integrity': ['classify', 'integrity'],
  full: ['classify', 'static', 'tests', 'mutation', 'acceptance'],
};

/** The recorded mutation ids of one script, read from its MUTATIONS table (the same ids the verifier pins). */
export function recordedIds(script) {
  const text = readFileSync(path.join(ROOT, 'scripts', `${script}-mutation-check.mjs`), 'utf8');
  const table = text.slice(text.indexOf('const MUTATIONS = ['), text.indexOf('\n];', text.indexOf('const MUTATIONS = [')));
  return [...table.matchAll(/^ {4}id: '([^']+)',/gm)].map((m) => m[1]);
}

/** Proof parity for one OS: the union of the shards' `ran` lists is exactly the recorded ids, each once. */
export function parity(reports, os) {
  const problems = [];
  for (const script of MUTATION_SCRIPTS) {
    const mine = reports.filter((r) => r.os === os && r.script === `${script}:mutation`);
    const ran = mine.flatMap((r) => r.ran);
    const want = recordedIds(script);
    const dup = ran.filter((id, i) => ran.indexOf(id) !== i);
    const missing = want.filter((id) => !ran.includes(id));
    const unknown = ran.filter((id) => !want.includes(id));
    if (mine.length === 0) problems.push(`${os}: no ${script}:mutation report`);
    if (dup.length) problems.push(`${os}: ${script} ran ${dup.join(',')} more than once`);
    if (missing.length) problems.push(`${os}: ${script} never ran ${missing.join(',')}`);
    if (unknown.length) problems.push(`${os}: ${script} ran unrecorded ${unknown.join(',')}`);
    if (mine.some((r) => r.total !== want.length)) problems.push(`${os}: ${script} reports a total other than ${want.length}`);
  }
  return problems;
}

function readReports(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ os: f.split('__')[0], ...JSON.parse(readFileSync(path.join(dir, f), 'utf8')) }));
}

const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? String(argv[argv.indexOf(name) + 1] ?? '') : '');
const mode = arg('--mode');
const problems = [];
if (!Object.hasOwn(REQUIRED, mode)) problems.push(`unknown mode ${JSON.stringify(mode)} (fail closed)`);
let needs = {};
try {
  needs = JSON.parse(readFileSync(arg('--needs'), 'utf8'));
} catch {
  problems.push('needs are unreadable (fail closed)');
}
for (const job of REQUIRED[mode] ?? []) {
  const result = needs?.[job]?.result;
  if (result !== 'success') problems.push(`job ${job} is ${JSON.stringify(result ?? 'missing')}, not success`);
}
let reports = [];
if (mode === 'full') {
  reports = readReports(arg('--reports'));
  for (const os of OPERATING_SYSTEMS) problems.push(...parity(reports, os));
}
const lines = [`## Quality gate — ${mode || 'unknown'}`, '', problems.length ? `**FAIL** (${problems.length})` : '**PASS**', '', ...problems.map((p) => `- ${p}`)];
if (mode === 'full') lines.push('', `Mutation reports: ${reports.length}; ${MUTATION_SCRIPTS.map((s) => `${s}=${recordedIds(s).length}`).join(', ')} recorded, each proven on ${OPERATING_SYSTEMS.join(' and ')}.`);
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
if (problems.length) process.exit(1);
