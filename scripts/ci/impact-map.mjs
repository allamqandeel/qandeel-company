#!/usr/bin/env node
// Canonical validation ownership / impact map (D0, D-D0-01). The ONE source of truth that decides, from the
// changed paths alone, which proof a change needs. Local validation (`npm run validate:affected`, and `npm run
// ci`, which delegates to it) and GitHub classification (`classify-changes.mjs`, `quality-gate.mjs`) both import
// this module; there is no second mapping.
//
//   QUALITY COMPLETE, VALIDATION PROPORTIONAL TO CHANGE.
//   LOCAL = IMPACTED BOUNDARY. FULL HISTORICAL CONTINUITY PROOF = PARALLEL GITHUB GATE.
//
// Per changed path, in this order (first match wins):
//   1. malformed path (empty, absolute, `..`, backslash, NUL)       → FULL
//   2. HIGH_RISK (CI / map / verifier / toolchain / migrations /
//      shared foundations / mutation framework)                     → FULL
//   3. RESERVED (a future boundary whose proofs are not defined yet) → FULL
//   4. documentation                                                 → docs
//   5. exactly one BOUNDARY                                          → affected (that boundary)
//   6. more than one boundary (ambiguous) or none (unknown)          → FULL
// Whole change: no files → FULL; any FULL path → FULL (mixed affected + high-risk is FULL); otherwise any
// boundary → affected (union of the boundaries); otherwise docs.
//
// The map is audited against repository truth by `--self-test` (`auditRepo`): a boundary must declare every
// workspace that (transitively) depends on it, every mutation family whose edits or proof tests touch those
// workspaces, every CI acceptance step that imports them, and must not reach a shared foundation. Adding a
// dependency or a mutation family that touches a boundary without updating the map fails the self-test — the
// map can never silently under-prove.
//
//   node scripts/ci/impact-map.mjs --self-test          decision cases + repository audit
//   node scripts/ci/impact-map.mjs --plan <file> ...    print the plan for the given paths (diagnostic)

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PLAN_SCHEMA = 'qandeel.validation-plan/v1';
export const MODES = ['docs', 'affected', 'full'];
export const WINDOWS = 'windows-latest';
export const UBUNTU = 'ubuntu-latest';
export const OPERATING_SYSTEMS = [WINDOWS, UBUNTU];

/** Every recorded mutation family, in the order of the historical continuity proof. */
export const MUTATION_FAMILIES = ['c1', 'c2', 'c3', 'r1', 'c4', 'c5', 'c6', 'c7a', 'c7b', 'c7c', 'c7d', 'l1'];

/**
 * Shards per family and OS. The FULL matrix in `.github/workflows/ci.yml` must partition each family exactly this
 * way (audited); the affected matrix reuses the same shards, so a family's Windows budget is the same in both modes.
 */
export const MUTATION_SHARDS = {
  [WINDOWS]: { c1: 1, c2: 1, c3: 2, r1: 4, c4: 2, c5: 1, c6: 4, c7a: 4, c7b: 3, c7c: 2, c7d: 2, l1: 12 },
  [UBUNTU]: { c1: 1, c2: 1, c3: 1, r1: 2, c4: 1, c5: 1, c6: 1, c7a: 2, c7b: 2, c7c: 1, c7d: 1, l1: 1 },
};

/** Paths whose change can reduce, redefine or invalidate proof anywhere: always the FULL continuity proof. */
export const HIGH_RISK = [
  { id: 'ci-architecture', re: /^\.github\//, why: 'CI workflow / quality-gate architecture' },
  { id: 'validation-map', re: /^scripts\/ci\//, why: 'validation ownership map, classifier, gate, post-merge, local runner' },
  { id: 'verifier', re: /^scripts\/verify-bootstrap\.mjs$/, why: 'repository verifier architecture' },
  { id: 'test-runner', re: /^scripts\/(?:run-node-tests|test-file-counter)\.mjs$/, why: 'shared test runner' },
  { id: 'mutation-framework', re: /^scripts\/[a-z0-9]+-mutation-check\.mjs$/, why: 'mutation framework / recorded mutation family' },
  { id: 'toolchain', re: /^(?:package\.json|package-lock\.json|\.nvmrc|\.npmrc|tsconfig\.base\.json|eslint\.config\.mjs|\.gitattributes|\.gitignore|\.editorconfig)$/, why: 'dependency / lockfile / toolchain / compiler / lint configuration' },
  { id: 'workspace-manifest', re: /^packages\/[^/]+\/(?:package\.json|tsconfig\.json)$/, why: 'workspace dependency / compiler configuration' },
  { id: 'migrations', re: /^packages\/storage\/migrations\//, why: 'released migrations' },
  { id: 'storage-runtime-foundation', re: /^packages\/(?:storage|runtime)\//, why: 'shared durable storage / runtime foundation' },
  { id: 'domain-governance-foundation', re: /^packages\/(?:domain|governance|mind|bootstrap-contract)\//, why: 'shared domain / governance / authority foundation' },
  // Investigated for D0: the Company Runtime imports these packages, so their impact reaches every runtime proof
  // (C1–C6 acceptance and nearly every mutation family). They are not isolated; ownership is not safely narrow.
  { id: 'runtime-loaded-integration', re: /^packages\/(?:model-providers|secret-vault|tool-drivers)\//, why: 'provider / vault / tool integration loaded by the shared runtime' },
];

/** A future boundary reserved by name only: its proofs are not defined yet, so it is FULL until a stage defines them. */
export const RESERVED = [
  // D1 mapped packaging/windows/ (the desktop-distribution boundary below); every other distribution area stays reserved.
  { id: 'distribution-reserved', re: /^(?:installer|distribution)\/|^packaging\/(?!windows\/)/, why: 'reserved distribution area (only packaging/windows/ is mapped, D-D1-07); proofs undefined, FULL until a stage maps it' },
];

/** Documentation only: anything under docs/, or a Markdown file at the repository root. */
export const isDocsPath = (f) => typeof f === 'string' && f.length > 0 && !f.includes('..') && (/^docs\/[^\0]+$/.test(f) || /^[^/]+\.md$/.test(f));

/**
 * Safely owned boundaries (the Desktop-v1 path). Each declares its full proof: the workspaces whose tests run, the
 * root harness, the CI acceptance steps and the mutation families — all audited against the repository.
 * `os` is where checks / tests / acceptance run; `mutationOs` where the mutation families run (Windows is
 * mandatory for the Founder's Windows host; Ubuntu mutation parity stays a FULL property).
 */
export const BOUNDARIES = [
  {
    id: 'c5-presentation',
    title: 'Founder Command Center UI / C5 presentation',
    paths: [/^packages\/command-center-ui\//, /^scripts\/c5\//, /^scripts\/c5-visual-proof\.mjs$/],
    packages: ['command-center-ui'],
    workspaces: ['command-center-ui', 'command-center'],
    harness: true,
    // D1: the UI ships inside the Desktop release, so its Desktop proofs run too.
    acceptance: ['c5:acceptance', 'c5:spike', 'desktop:e2e', 'desktop:proof'],
    mutation: ['c5', 'c7d', 'l1'],
    os: [WINDOWS, UBUNTU],
    mutationOs: [WINDOWS],
  },
  {
    id: 'founder-host',
    title: 'Founder host / Command Center desktop-operation surface',
    paths: [/^packages\/command-center\//],
    packages: ['command-center'],
    workspaces: ['command-center'],
    harness: false,
    // D1: desktop-install / desktop-uninstall and the shortcuts live here, so the Desktop proofs run too.
    acceptance: ['c5:acceptance', 'c5:spike', 'desktop:e2e', 'desktop:proof'],
    mutation: ['c5', 'c7d', 'l1'],
    os: [WINDOWS, UBUNTU],
    mutationOs: [WINDOWS],
  },
  {
    // D1 (D-D1-07): the Windows Desktop product build and its proofs — pins, icon, Inno Setup definition, bundle /
    // Setup build, desktop:proof and desktop:e2e. It owns no workspace and no mutation family (the product code it
    // packages is founder-host / c5-presentation / FULL). Windows only: the product is a Windows installer.
    id: 'desktop-distribution',
    title: 'Windows Desktop distribution (Setup.exe build, private runtime, installer proofs)',
    paths: [/^packaging\/windows\//],
    packages: [],
    workspaces: [],
    harness: false,
    acceptance: ['desktop:e2e', 'desktop:proof'],
    mutation: [],
    os: [WINDOWS],
    mutationOs: [WINDOWS],
  },
];

/** The one decision for one path: { file, class: 'docs' | 'affected' | 'full', rule, boundary? }. */
export function decide(file) {
  if (typeof file !== 'string' || file.length === 0 || file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.includes('\\') || file.includes('\0') || file.split('/').includes('..')) {
    return { file: String(file), class: 'full', rule: 'malformed-path' };
  }
  for (const h of HIGH_RISK) if (h.re.test(file)) return { file, class: 'full', rule: `high-risk:${h.id}` };
  for (const r of RESERVED) if (r.re.test(file)) return { file, class: 'full', rule: `reserved:${r.id}` };
  if (isDocsPath(file)) return { file, class: 'docs', rule: 'docs' };
  const owners = BOUNDARIES.filter((b) => b.paths.some((re) => re.test(file)));
  if (owners.length === 1) return { file, class: 'affected', rule: `boundary:${owners[0].id}`, boundary: owners[0].id };
  if (owners.length > 1) return { file, class: 'full', rule: `ambiguous:${owners.map((b) => b.id).join('+')}` };
  return { file, class: 'full', rule: 'unknown-path' };
}

const uniq = (xs) => [...new Set(xs)];
const ordered = (xs, order) => [...xs].sort((a, b) => order.indexOf(a) - order.indexOf(b));

/** The ordered steps of an affected plan (the same list runs locally and on every planned OS in CI). */
function affectedSteps(bs) {
  const workspaces = uniq(bs.flatMap((b) => b.workspaces)).sort();
  const acceptance = uniq(bs.flatMap((b) => b.acceptance)).sort();
  return [
    { id: 'build', npm: ['run', 'build'] },
    { id: 'typecheck', npm: ['run', 'typecheck'] },
    { id: 'lint', npm: ['run', 'lint'] },
    { id: 'verify', npm: ['run', 'verify'] },
    ...workspaces.map((w) => ({ id: `test:${w}`, npm: ['run', 'test', '--workspace', `@qandeel-company/${w}`] })),
    ...(bs.some((b) => b.harness) ? [{ id: 'test:harness', npm: ['run', 'test:harness'] }] : []),
    ...acceptance.map((a) => ({ id: `acceptance:${a}`, npm: ['run', a], workspace: a.replace(':', '-') })),
  ];
}

/** The mutation shards an affected plan runs: the same shard specs as the FULL matrix, for the planned families. */
export function mutationMatrix(families, oses) {
  const out = [];
  for (const os of ordered(oses, OPERATING_SYSTEMS)) {
    for (const fam of ordered(families, MUTATION_FAMILIES)) {
      const n = MUTATION_SHARDS[os][fam];
      for (let i = 1; i <= n; i++) out.push({ os, label: `${fam}-${i}of${n}`, suite: `${fam}:${i}/${n}` });
    }
  }
  return out;
}

/** Deterministic digest of the plan's decision content (files, mode, steps, mutation) — binds proofs to the plan. */
export function planDigest(plan) {
  const core = { schema: plan.schema, mode: plan.mode, files: plan.files, boundaries: plan.boundaries, os: plan.os, steps: plan.steps, mutation: plan.mutation };
  return createHash('sha256').update(JSON.stringify(core)).digest('hex');
}

/**
 * The plan for a list of changed paths. Pure and deterministic. Anything unexpected (not a list, no files, a
 * malformed / high-risk / reserved / ambiguous / unknown path) yields FULL.
 */
export function planFor(files) {
  const list = Array.isArray(files) ? uniq(files.map((f) => (typeof f === 'string' ? f : String(f)))).sort() : [];
  const decisions = list.map(decide);
  const base = { schema: PLAN_SCHEMA, files: list, decisions };
  let plan;
  if (!Array.isArray(files) || list.length === 0) {
    plan = { ...base, mode: 'full', reasons: ['no changed files (empty or unreadable diff): fail closed'], boundaries: [], os: OPERATING_SYSTEMS, steps: [], mutation: { families: MUTATION_FAMILIES, os: OPERATING_SYSTEMS, matrix: mutationMatrix(MUTATION_FAMILIES, OPERATING_SYSTEMS) } };
  } else if (decisions.some((d) => d.class === 'full')) {
    plan = { ...base, mode: 'full', reasons: decisions.filter((d) => d.class === 'full').map((d) => `${d.file}: ${d.rule}`), boundaries: [], os: OPERATING_SYSTEMS, steps: [], mutation: { families: MUTATION_FAMILIES, os: OPERATING_SYSTEMS, matrix: mutationMatrix(MUTATION_FAMILIES, OPERATING_SYSTEMS) } };
  } else if (decisions.some((d) => d.class === 'affected')) {
    const ids = BOUNDARIES.map((b) => b.id).filter((id) => decisions.some((d) => d.boundary === id));
    const bs = BOUNDARIES.filter((b) => ids.includes(b.id));
    const families = ordered(uniq(bs.flatMap((b) => b.mutation)), MUTATION_FAMILIES);
    const mutOs = ordered(uniq(bs.flatMap((b) => b.mutationOs)), OPERATING_SYSTEMS);
    plan = { ...base, mode: 'affected', reasons: ids.map((id) => `boundary ${id}`), boundaries: ids, os: ordered(uniq(bs.flatMap((b) => b.os)), OPERATING_SYSTEMS), steps: affectedSteps(bs), mutation: { families, os: mutOs, matrix: mutationMatrix(families, mutOs) } };
  } else {
    plan = { ...base, mode: 'docs', reasons: ['documentation only'], boundaries: [], os: [UBUNTU], steps: [{ id: 'build', npm: ['run', 'build'] }, { id: 'verify', npm: ['run', 'verify'] }], mutation: { families: [], os: [], matrix: [] } };
  }
  return { ...plan, digest: planDigest(plan) };
}

/** A plan read back from disk is trusted only if it is exactly the plan its own file list yields today. */
export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || plan.schema !== PLAN_SCHEMA || !MODES.includes(plan.mode) || !Array.isArray(plan.files)) return ['plan is unreadable or not a validation plan (fail closed)'];
  const fresh = planFor(plan.files);
  const problems = [];
  if (plan.digest !== fresh.digest || planDigest(plan) !== fresh.digest) problems.push('plan does not match the canonical impact map for its own files (plan/result mismatch)');
  if (plan.mode !== fresh.mode) problems.push(`plan mode ${plan.mode} differs from the canonical ${fresh.mode}`);
  return problems;
}

/** Human-readable plan, printed before anything executes. */
export function describePlan(plan) {
  const lines = [`Validation plan — mode ${plan.mode.toUpperCase()} (${plan.files.length} changed file(s), digest ${plan.digest.slice(0, 12)})`];
  for (const d of plan.decisions) lines.push(`  ${d.class.padEnd(8)} ${d.rule.padEnd(40)} ${d.file}`);
  if (plan.mode === 'affected') {
    for (const id of plan.boundaries) lines.push(`  boundary: ${id} — ${BOUNDARIES.find((b) => b.id === id)?.title}`);
    lines.push(`  checks on: ${plan.os.join(', ')}`);
    lines.push(`  steps: ${plan.steps.map((s) => s.id).join(' → ')}`);
    lines.push(`  mutation (GitHub affected proof, ${plan.mutation.os.join(', ')}): ${plan.mutation.families.join(', ')} — ${plan.mutation.matrix.length} shard(s)`);
  } else if (plan.mode === 'full') {
    lines.push('  FULL continuity proof: Windows + Ubuntu, static, every workspace test, every recorded mutation family');
    lines.push('  (sharded, parity on both OSes), acceptance, verifier — on GitHub, never as a local serial run.');
    if (plan.decisions.length === 0) for (const r of plan.reasons) lines.push(`  why: ${r}`);
  } else {
    lines.push('  docs proof: build + repository verifier.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------
// Repository audit: the map must agree with repository truth.

function readJson(f) {
  return JSON.parse(readFileSync(f, 'utf8'));
}

/** Workspace dependency graph: short name → internal dependency short names. */
export function workspaceGraph(root = ROOT) {
  const dir = path.join(root, 'packages');
  const graph = {};
  for (const name of readdirSync(dir)) {
    const pj = path.join(dir, name, 'package.json');
    if (!existsSync(pj)) continue;
    const p = readJson(pj);
    graph[name] = Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.peerDependencies }).filter((d) => d.startsWith('@qandeel-company/')).map((d) => d.slice('@qandeel-company/'.length));
  }
  return graph;
}

/** The packages plus every workspace that transitively depends on any of them. */
export function reverseClosure(graph, packages) {
  const out = new Set(packages);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, deps] of Object.entries(graph)) if (!out.has(name) && deps.some((d) => out.has(d))) (out.add(name), (grew = true));
  }
  return [...out].sort();
}

/** The workspaces a mutation family edits (compiled targets) or runs proof tests in. */
export function familyTouches(fam, root = ROOT) {
  const text = readFileSync(path.join(root, 'scripts', `${fam}-mutation-check.mjs`), 'utf8');
  const edits = [...text.matchAll(/packages\/([a-z0-9-]+)\/dist\/src/g)].map((m) => m[1]);
  const runs = [...text.matchAll(/cwd:\s*'packages\/([a-z0-9-]+)'/g)].map((m) => m[1]);
  return uniq([...edits, ...runs]).sort();
}

/** One job's body in the workflow (from `  <id>:` to the next top-level job). */
export function workflowJob(wf, id) {
  const m = new RegExp(`^  ${id.replace(/[-]/g, '\\-')}:\\s*$`, 'm').exec(wf);
  if (!m) return undefined;
  const rest = wf.slice(m.index + m[0].length);
  const next = /^ {2}[A-Za-z0-9_-]+:\s*$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** FULL-matrix shard specs per OS, read from the workflow's `mutation` job. */
export function fullMatrixShards(wf) {
  const job = workflowJob(wf, 'mutation') ?? '';
  const out = { [WINDOWS]: [], [UBUNTU]: [] };
  for (const m of job.matchAll(/os:\s*([\w-]+),[^}]*suite:\s*'([^']+)'/g)) (out[m[1]] ??= []).push(...m[2].split(/\s+/));
  return out;
}

export function auditRepo(root = ROOT, boundaries = BOUNDARIES) {
  const problems = [];
  const graph = workspaceGraph(root);
  const pkg = readJson(path.join(root, 'package.json'));
  const wf = readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

  // Every workspace is either a mapped boundary or explicitly FULL (never "unknown by omission").
  for (const name of Object.keys(graph)) {
    const probe = `packages/${name}/src/index.ts`;
    const d = decide(probe);
    if (!(d.class === 'affected' || d.rule.startsWith('high-risk:'))) problems.push(`workspace ${name} is neither a boundary nor explicitly high-risk (${d.rule})`);
  }
  // Every mutation family exists and the FULL matrix partitions it exactly as MUTATION_SHARDS says.
  const shards = fullMatrixShards(wf);
  for (const os of OPERATING_SYSTEMS) {
    for (const fam of MUTATION_FAMILIES) {
      if (!existsSync(path.join(root, 'scripts', `${fam}-mutation-check.mjs`))) problems.push(`missing scripts/${fam}-mutation-check.mjs`);
      const n = MUTATION_SHARDS[os][fam];
      const got = shards[os].filter((s) => s.startsWith(`${fam}:`)).map((s) => s.slice(fam.length + 1)).sort();
      const want = Array.from({ length: n }, (_, i) => `${i + 1}/${n}`).sort();
      if (got.join() !== want.join()) problems.push(`${os} FULL matrix shards of ${fam} are [${got.join(' ')}], the map says [${want.join(' ')}]`);
    }
    const extra = shards[os].map((s) => s.split(':')[0]).filter((f) => !MUTATION_FAMILIES.includes(f));
    if (extra.length) problems.push(`${os} FULL matrix runs families the map does not know: ${uniq(extra).join(', ')}`);
  }
  for (const f of readdirSync(path.join(root, 'scripts')).filter((x) => x.endsWith('-mutation-check.mjs'))) {
    if (!MUTATION_FAMILIES.includes(f.replace('-mutation-check.mjs', ''))) problems.push(`scripts/${f} is a mutation family the map does not know`);
  }
  // Every acceptance step the FULL path runs, and which workspaces its script imports.
  const acceptanceJob = workflowJob(wf, 'acceptance') ?? '';
  // D1: the FULL path's `desktop` job runs the reusable Desktop workflow; its steps are FULL acceptance steps too.
  const desktopWfFile = path.join(root, '.github', 'workflows', 'desktop.yml');
  const desktopWf = existsSync(desktopWfFile) ? readFileSync(desktopWfFile, 'utf8') : '';
  if (!/uses:\s*\.\/\.github\/workflows\/desktop\.yml/.test(workflowJob(wf, 'desktop') ?? '')) problems.push('the FULL path has no desktop job running .github/workflows/desktop.yml');
  const ciAcceptance = uniq([...`${acceptanceJob}\n${desktopWf}`.matchAll(/npm run ([a-z0-9]+:[a-z0-9-]+)/g)].map((m) => m[1]).filter((a) => pkg.scripts?.[a]));
  const acceptanceImports = Object.fromEntries(
    ciAcceptance.map((a) => {
      const script = /node\s+(?:--\S+\s+)*((?:scripts|packaging)\/\S+\.mjs)/.exec(pkg.scripts?.[a] ?? '')?.[1];
      const text = script && existsSync(path.join(root, script)) ? readFileSync(path.join(root, script), 'utf8') : '';
      if (!text) problems.push(`acceptance step ${a} has no readable script`);
      return [a, uniq([...text.matchAll(/(?:@qandeel-company\/|packages\/)([a-z0-9-]+)/g)].map((m) => m[1]))];
    }),
  );
  for (const b of boundaries) {
    const closure = reverseClosure(graph, b.packages);
    for (const w of closure) {
      if (!b.workspaces.includes(w)) problems.push(`${b.id}: workspace ${w} depends on the boundary but its tests are not in the plan`);
      if (decide(`packages/${w}/src/index.ts`).class === 'full') problems.push(`${b.id}: shared foundation ${w} depends on the boundary — not isolated, must be FULL`);
    }
    for (const w of b.workspaces) if (!graph[w]) problems.push(`${b.id}: unknown workspace ${w}`);
    for (const fam of MUTATION_FAMILIES) {
      const touches = familyTouches(fam, root);
      if (touches.some((w) => closure.includes(w)) && !b.mutation.includes(fam)) problems.push(`${b.id}: mutation family ${fam} touches ${touches.filter((w) => closure.includes(w)).join(',')} but is not in the plan`);
    }
    for (const fam of b.mutation) if (!MUTATION_FAMILIES.includes(fam)) problems.push(`${b.id}: unknown mutation family ${fam}`);
    for (const [a, imports] of Object.entries(acceptanceImports)) {
      if (imports.some((w) => closure.includes(w)) && !b.acceptance.includes(a)) problems.push(`${b.id}: CI acceptance ${a} imports the boundary but is not in the plan`);
    }
    for (const a of b.acceptance) if (!ciAcceptance.includes(a)) problems.push(`${b.id}: acceptance ${a} is not a step of the FULL acceptance / desktop job`);
    if (b.paths.some((re) => RESERVED.some((r) => [...['packaging/windows/x', 'installer/x', 'distribution/x']].some((probe) => re.test(probe) && r.re.test(probe))))) problems.push(`${b.id}: its paths are still reserved`);
    if (b.harness && !pkg.scripts?.['test:harness']) problems.push(`${b.id}: no root test:harness script`);
    if (!b.os.includes(WINDOWS) || !b.mutationOs.includes(WINDOWS)) problems.push(`${b.id}: Windows proof is mandatory for a Desktop-path boundary`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------
// Decision self-test (the D0 contract's required cases).

export const SELF_TEST_CASES = [
  ['docs-only', ['docs/C4_IMPLEMENTATION_REPORT.md', 'README.md'], 'docs', []],
  ['docs image', ['docs/diagrams/org.png'], 'docs', []],
  ['C5 UI', ['packages/command-center-ui/src/app/view.ts'], 'affected', ['c5-presentation']],
  ['C5 UI + docs', ['packages/command-center-ui/src/app/view.ts', 'docs/architecture/DECISION_LOG.md'], 'affected', ['c5-presentation']],
  ['C5 browser harness', ['scripts/c5/cdp.mjs'], 'affected', ['c5-presentation']],
  ['Founder host', ['packages/command-center/src/host/lifecycle.ts', 'packages/command-center/test/founder-host.test.ts'], 'affected', ['founder-host']],
  ['UI + host', ['packages/command-center-ui/src/app/view.ts', 'packages/command-center/src/cli.ts'], 'affected', ['c5-presentation', 'founder-host']],
  ['Windows Desktop packaging', ['packaging/windows/qandeel-company.iss'], 'affected', ['desktop-distribution']],
  ['Desktop proof', ['packaging/windows/proof/desktop-proof.mjs', 'packaging/windows/lib/desktop-build.mjs'], 'affected', ['desktop-distribution']],
  ['Desktop pins + docs', ['packaging/windows/desktop.pins.json', 'docs/architecture/DECISION_LOG.md'], 'affected', ['desktop-distribution']],
  ['Desktop packaging + host', ['packaging/windows/build.mjs', 'packages/command-center/src/host/desktop.ts'], 'affected', ['founder-host', 'desktop-distribution']],
  ['Desktop packaging + runtime', ['packaging/windows/build.mjs', 'packages/runtime/src/release.ts'], 'full', []],
  ['Desktop workflow', ['.github/workflows/desktop.yml'], 'full', []],
  ['reserved packaging (non-Windows)', ['packaging/macos/build.mjs'], 'full', []],
  ['reserved installer area', ['installer/setup.iss'], 'full', []],
  ['reserved distribution area', ['distribution/channel.json'], 'full', []],
  ['runtime foundation', ['packages/runtime/src/runtime.ts'], 'full', []],
  ['storage foundation', ['packages/storage/src/queue.ts'], 'full', []],
  ['domain foundation', ['packages/domain/src/errors.ts'], 'full', []],
  ['governance foundation', ['packages/governance/src/authority.ts'], 'full', []],
  ['provider integration (runtime-loaded)', ['packages/model-providers/src/deepseek.ts'], 'full', []],
  ['vault integration (runtime-loaded)', ['packages/secret-vault/src/index.ts'], 'full', []],
  ['migration', ['packages/storage/migrations/0020_x.sql'], 'full', []],
  ['lockfile', ['package-lock.json'], 'full', []],
  ['root manifest', ['package.json'], 'full', []],
  ['toolchain', ['.nvmrc'], 'full', []],
  ['lint config', ['eslint.config.mjs'], 'full', []],
  ['compiler config', ['tsconfig.base.json'], 'full', []],
  ['workspace manifest inside a boundary', ['packages/command-center-ui/package.json'], 'full', []],
  ['workspace tsconfig inside a boundary', ['packages/command-center/tsconfig.json'], 'full', []],
  ['CI workflow', ['.github/workflows/ci.yml'], 'full', []],
  ['validation map edit', ['scripts/ci/impact-map.mjs'], 'full', []],
  ['quality gate edit', ['scripts/ci/quality-gate.mjs'], 'full', []],
  ['verifier', ['scripts/verify-bootstrap.mjs'], 'full', []],
  ['mutation framework', ['scripts/c5-mutation-check.mjs'], 'full', []],
  ['test runner', ['scripts/run-node-tests.mjs'], 'full', []],
  ['unknown new path', ['tools/new-thing.mjs'], 'full', []],
  ['unknown script', ['scripts/c5-acceptance.mjs'], 'full', []],
  ['unknown new workspace', ['packages/desktop-shell/src/index.ts'], 'full', []],
  ['nested Markdown outside docs', ['packages/command-center/NOTES.md'], 'affected', ['founder-host']],
  ['sub-directory README', ['sub/README.md'], 'full', []],
  ['mixed affected + high-risk', ['packages/command-center-ui/src/app/view.ts', 'packages/storage/src/queue.ts'], 'full', []],
  ['mixed affected + CI', ['packages/command-center/src/cli.ts', '.github/workflows/ci.yml'], 'full', []],
  ['mixed docs + unknown', ['docs/x.md', 'tools/x.mjs'], 'full', []],
  ['empty diff', [], 'full', []],
  ['unreadable diff', 'not-a-list', 'full', []],
  ['empty path', [''], 'full', []],
  ['traversal', ['docs/../packages/runtime/src/x.ts'], 'full', []],
  ['traversal into a boundary', ['packages/command-center-ui/../storage/src/x.ts'], 'full', []],
  ['backslash path', ['packages\\command-center-ui\\src\\x.ts'], 'full', []],
  ['absolute path', ['/packages/command-center-ui/src/x.ts'], 'full', []],
];

export function selfTest() {
  const failures = [];
  for (const [name, files, mode, boundaries] of SELF_TEST_CASES) {
    const p = planFor(files);
    if (p.mode !== mode) failures.push(`${name}: mode ${p.mode}, expected ${mode}`);
    if (p.boundaries.join() !== boundaries.join()) failures.push(`${name}: boundaries [${p.boundaries}], expected [${boundaries}]`);
    if (validatePlan(p).length) failures.push(`${name}: a fresh plan does not validate`);
  }
  // Affected plans: exact proof, Windows mandatory, no historical universe.
  const ui = planFor(['packages/command-center-ui/src/app/view.ts']);
  const want = ['build', 'typecheck', 'lint', 'verify', 'test:command-center', 'test:command-center-ui', 'test:harness', 'acceptance:c5:acceptance', 'acceptance:c5:spike', 'acceptance:desktop:e2e', 'acceptance:desktop:proof'];
  if (ui.steps.map((s) => s.id).join() !== want.join()) failures.push(`C5 UI steps are [${ui.steps.map((s) => s.id)}]`);
  if (ui.mutation.families.join() !== 'c5,c7d,l1' || ui.mutation.os.join() !== WINDOWS) failures.push('C5 UI mutation proof is not c5,c7d,l1 on Windows');
  if (ui.mutation.matrix.map((m) => m.suite).join(' ') !== 'c5:1/1 c7d:1/2 c7d:2/2 l1:1/12 l1:2/12 l1:3/12 l1:4/12 l1:5/12 l1:6/12 l1:7/12 l1:8/12 l1:9/12 l1:10/12 l1:11/12 l1:12/12') failures.push(`C5 UI mutation shards are ${ui.mutation.matrix.map((m) => m.suite)}`);
  const desk = planFor(['packaging/windows/qandeel-company.iss']);
  if (desk.steps.map((s) => s.id).join() !== 'build,typecheck,lint,verify,acceptance:desktop:e2e,acceptance:desktop:proof' || desk.os.join() !== WINDOWS || desk.mutation.matrix.length !== 0) failures.push(`Desktop distribution plan is [${desk.steps.map((s) => s.id)}] on [${desk.os}]`);
  const host = planFor(['packages/command-center/src/host/lifecycle.ts']);
  if (host.steps.some((s) => s.id === 'test:command-center-ui' || s.id === 'test:harness')) failures.push('Founder host plan runs UI-only proofs');
  if (!host.os.includes(WINDOWS) || !host.mutation.os.includes(WINDOWS)) failures.push('Founder host plan lacks Windows proof');
  // FULL plans keep every family on both OSes, with the full shard sets.
  const full = planFor(['packages/runtime/src/runtime.ts']);
  if (full.mutation.families.join() !== MUTATION_FAMILIES.join() || full.mutation.os.join() !== OPERATING_SYSTEMS.join()) failures.push('FULL plan lost a family or an OS');
  // Tampering with a stored plan is detected.
  const tampered = { ...ui, mutation: { ...ui.mutation, families: ['c5'] } };
  if (validatePlan(tampered).length === 0) failures.push('a tampered plan (mutation removed) validated');
  if (validatePlan({ ...ui, mode: 'docs' }).length === 0) failures.push('a plan with a downgraded mode validated');
  if (validatePlan({ ...ui, files: ['docs/x.md'] }).length === 0) failures.push('a plan with substituted files validated');
  if (validatePlan(null).length === 0 || validatePlan({ schema: 'x' }).length === 0) failures.push('an unreadable plan validated');
  // The repository audit can fail: a boundary that under-declares its proof is refused.
  const ccui = BOUNDARIES[0];
  const weakened = [
    ['a dependent workspace dropped', { ...ccui, workspaces: ['command-center-ui'] }],
    ['a touching mutation family dropped', { ...ccui, mutation: ['c5', 'c7d'] }],
    ['an importing acceptance step dropped', { ...ccui, acceptance: ['c5:spike'] }],
    ['Windows proof dropped', { ...ccui, mutationOs: [UBUNTU] }],
    ['an importing Desktop proof dropped', { ...ccui, acceptance: ['c5:acceptance', 'c5:spike', 'desktop:e2e'] }],
    ['a Desktop boundary without Windows', { ...BOUNDARIES.find((b) => b.id === 'desktop-distribution'), os: [UBUNTU], mutationOs: [UBUNTU] }],
    ['a shared foundation claimed as a boundary', { ...ccui, id: 'storage', packages: ['storage'], workspaces: ['storage'] }],
  ];
  for (const [name, b] of weakened) if (auditRepo(ROOT, [b]).length === 0) failures.push(`repository audit accepted a boundary with ${name}`);
  // Determinism.
  if (planFor(['b/x', 'a/y']).digest !== planFor(['a/y', 'b/x', 'a/y']).digest) failures.push('plan is not order/duplicate independent');
  return failures;
}

function main(argv) {
  if (argv.includes('--self-test')) {
    const failures = [...selfTest(), ...auditRepo().map((p) => `repository audit: ${p}`)];
    for (const f of failures) console.error(`impact-map self-test FAILED: ${f}`);
    if (failures.length) process.exit(1);
    console.log(`impact-map self-test ok (${SELF_TEST_CASES.length} decision cases; repository audit of ${BOUNDARIES.length} boundaries, ${MUTATION_FAMILIES.length} mutation families)`);
    return;
  }
  if (argv[0] === '--plan') {
    const plan = planFor(argv.slice(1).filter((a) => a !== '--json'));
    console.log(describePlan(plan));
    if (argv.includes('--json')) console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.error('usage: impact-map.mjs --self-test | --plan <path> ...');
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
