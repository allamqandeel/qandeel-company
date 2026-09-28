#!/usr/bin/env node
// Repository-contract verifier (C0; extended at PRE-C1 for the imported authority, at C1 for the
// durable runtime packages and at C2 for governed model / tool / budget boundaries).
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
  'scripts/run-node-tests.mjs',
  'scripts/c1-acceptance.mjs',
  'packages/domain/package.json',
  'packages/storage/package.json',
  'packages/runtime/package.json',
  'packages/storage/src/migrations.ts',
  'packages/storage/src/sqlite/connection.ts',
  'packages/governance/package.json',
  'scripts/c2-acceptance.mjs',
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
  'docs/c1/C1_SCHEMA_AND_STATE.md',
  'docs/c1/C1_RUNTIME_RECOVERY_MODEL.md',
  'docs/C1_IMPLEMENTATION_REPORT.md',
  'docs/C2_IMPLEMENTATION_REPORT.md',
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
// The "by default" pattern checks only the two documents that state the boundary, so an unrelated
// later sentence elsewhere (e.g. "content access is denied by default") stays legal.
const PRIVACY_BOUNDARY_DOCS = [BASELINE, 'docs/architecture/BOUNDARIES.md'];
const STALE_PRIVACY = [
  { pattern: /unless separately authori[sz]ed/i, docs: PRIVACY_SUMMARY_DOCS },
  { pattern: /\b(?:memory|analysis|transcripts?|audio|content|text)\b[^.]{0,40}\bby default\b/i, docs: PRIVACY_BOUNDARY_DOCS },
];

const IMPLEMENTATION_MAP = 'docs/architecture/IMPLEMENTATION_MAP.md';
const C1_CLOSURE = /^docs\/C1_[^/]*CLOSURE[^/]*\.md$/i;

// The change that adds a real package extends this list in the same change. A placeholder
// package is a verifier failure. C1 added domain, storage and runtime; C2 governance; C3 mind.
const ALLOWED_PACKAGES = ['bootstrap-contract', 'domain', 'governance', 'mind', 'storage', 'runtime'];

// C1 persistence boundary: `node:sqlite` (a Release Candidate API) is imported by exactly one module.
const SQLITE_ADAPTER = 'packages/storage/src/sqlite/connection.ts';
const SQLITE_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"](?:node:)?sqlite['"]/;
// C1 runtime has no network surface and makes no provider calls.
const NETWORK_MODULE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns|dns\/promises|undici|child_process|worker_threads)['"]|\bfetch\s*\(|\bnew\s+(?:WebSocket|XMLHttpRequest)\b/;
// Runtime dependencies of workspace packages: only sibling workspaces unless a change adds a
// reviewed exception here (no ORM, provider SDK, queue server, framework or native addon).
const ALLOWED_RUNTIME_DEPENDENCIES = [];
const MIGRATIONS_DIR = 'packages/storage/migrations/';
const MIGRATIONS_REGISTRY = 'packages/storage/src/migrations.ts';
// Non-vacuity contract: the C1 proofs CI must execute. Removing one of these is a verifier failure.
const C1_PROOF_TESTS = [
  'packages/domain/test/work-item-state.test.ts',
  'packages/domain/test/kernel.test.ts',
  'packages/storage/test/sqlite-and-workspace.test.ts',
  'packages/storage/test/migrations.test.ts',
  'packages/storage/test/work-items.test.ts',
  'packages/storage/test/queue.test.ts',
  'packages/storage/test/artifacts.test.ts',
  'packages/storage/test/backup.test.ts',
  'packages/storage/test/multiprocess/multiprocess.test.ts',
  'packages/runtime/test/unit/runtime-units.test.ts',
  'packages/runtime/test/integration/runtime.test.ts',
  'packages/runtime/test/integration/cli.test.ts',
  'packages/runtime/test/integration/robustness.test.ts',
  'packages/runtime/test/faults/fault-matrix.test.ts',
];
const C1_REPORT = 'docs/C1_IMPLEMENTATION_REPORT.md';
// D-C1-22: runtime authority (claims, supervisor lease, worker writes) lives behind one subpath
// that only the runtime package may import; nothing reaches into another package's internals.
const STORAGE_PKG = 'packages/storage/package.json';
const STORAGE_EXPORTS = ['.', './runtime-authority', './testing'];
// D-C2-13: the test-only Founder seam resolves only under the `qandeel-test` export condition, and only
// tests (plus the acceptance harness) may import it.
const TEST_CONDITION = 'qandeel-test';
const TEST_SEAM_HARNESSES = ['scripts/c2-acceptance.mjs', 'scripts/c3-acceptance.mjs'];
const FOUNDER_SEAM_FILES = ['packages/storage/src/governance.ts', 'packages/storage/src/testing/founder-seam.ts'];
const CLI_SOURCE = 'packages/runtime/src/cli.ts';
const AUTHORITY_SUBPATH = '@qandeel-company/storage/runtime-authority';
const STORAGE_SUBPATH_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]@qandeel-company\/storage\/([^'"]+)['"]/g;
const STORAGE_INTERNALS_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"][^'"]*\/storage\/(?:src|dist)\/[^'"]*['"]/;
const AUTHORITY_METHODS = ['claimNext', 'claimJob', 'acquireSupervisor', 'renewSupervisor', 'releaseSupervisor', 'settle', 'checkpoint', 'renewLease', 'interruptClaim'];
// D-C1-20..23: the remediation proofs CI must keep executing (found by marker, not by file name).
const C1_PROOF_MARKERS = ['C1-PROOF: supervisor-claim-authority', 'C1-PROOF: lost-wake-reconciliation', 'C1-PROOF: product-decisions-d-c1-08-09', 'C1-PROOF: backup-finalization-contention'];
const MUTATION_CHECK = 'scripts/c1-mutation-check.mjs';

// --- C2 boundaries ------------------------------------------------------------------------------
const C2_CLOSURE = /^docs\/C2_[^/]*CLOSURE[^/]*\.md$/i;
const C2_REPORT = 'docs/C2_IMPLEMENTATION_REPORT.md';
// The only production module that calls a provider adapter, and the only one that invokes a tool driver.
const MODEL_RUNTIME = 'packages/runtime/src/c2/model-runtime.ts';
const TOOL_EXECUTOR = 'packages/runtime/src/c2/tool-executor.ts';
const ADAPTER_CALL = /\.generate\s*\(/;
const DRIVER_CALL = /\.invoke\s*\(/;
// Budget / reservation / usage writes live in the storage governance modules only, and the runtime
// reaches them only through fenced runtime-authority functions.
const BUDGET_WRITERS = ['packages/storage/src/governance-core.ts', 'packages/storage/src/governed-writes.ts', 'packages/storage/src/governance.ts'];
const BUDGET_WRITE = /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|REPLACE\s+INTO)\s+(?:budgets|budget_reservations|usage_records)\b/i;
const FENCED_BUDGET_FUNCTIONS = ['reserveBudget', 'settleReservation', 'releaseReservation', 'holdReservation', 'recordToolIntent', 'recordToolResult'];
// Plaintext secret material: key formats and private-key blocks (code, config, SQL, tests).
const SECRET_LITERALS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-(?:live|proj|ant|test)?-?[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];
const SECRET_COLUMN = /(?:^|[(,])\s*"?(\w*(?:password|passwd|secret|api_?key|private_?key|access_?token|refresh_?token|bearer)\w*)"?\s+(?:TEXT|BLOB|ANY)\b/im;
// Released canonical migrations (C1 0001–0003, C2 0004, C3 0005–0006) are frozen by content,
// independently of the registry pins: editing one and re-pinning it is still refused (R1-14: C3's
// were released with PR #4 and had not been added).
const FROZEN_MIGRATIONS = [
  { file: '0001_work_foundation.sql', sha256: '3022ed5ed626f9394cfa9a7e897d2ed4e7bcb9b94c8de7a9a4bde7c0c658436e' },
  { file: '0002_queue_runs_artifacts.sql', sha256: 'b3060a1ea7a3e57e8bf0f76a4edba437c9f1b8d2886ef97ff5ca2b6920b0a7c2' },
  { file: '0003_runtime_wake_generation.sql', sha256: 'f47cf341f677585d762672929bdf2f41eeb4bf7440463b68846bac0c777762e4' },
  { file: '0004_c2_governance.sql', sha256: '51dd9a38df306751eace1dc6cf82e231b92e487b7e913b061f336e8c25a0066c' },
  { file: '0005_c3_memory_context.sql', sha256: '2c2f0d8092f108de2596c15e795ba6ba8d17b316761d0ac59e45d8845409e44a' },
  { file: '0006_c3_skills_academy.sql', sha256: 'a4b8709915fbad924212e3278b64d2f58d4d1e40c5ba1ff937cb7c50637d57d8' },
];
// C4 / C5 / C7 subsystems must not appear as C3 schema or packages (Memory / Skills / Academy are C3's own).
const LATER_SCOPE_TABLE = /\bCREATE\s+(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w*(?:review_pool|reviewer|director|delegation|org_chart|founder_ui|command_center|app_ops)\w*)/i;
const LATER_SCOPE_PACKAGE = /^(?:review-pool|reviews?|directors?|delegation|organization|command-center|founder-ui|app-ops)$/;
const C2_PROOF_MARKERS = ['C2-PROOF: governance-kernel', 'C2-PROOF: storage-governance', 'C2-PROOF: concurrent-reservations', 'C2-PROOF: governed-runtime', 'C2-PROOF: governed-crash-recovery'];
const C2_MUTATION_CHECK = 'scripts/c2-mutation-check.mjs';

// --- C3 boundaries ------------------------------------------------------------------------------
const C3_CLOSURE = /^docs\/C3_[^/]*CLOSURE[^/]*\.md$/i;
const C3_REPORT = 'docs/C3_IMPLEMENTATION_REPORT.md';
const C3_PROOF_MARKERS = ['C3-PROOF: mind-kernel', 'C3-PROOF: storage-mind', 'C3-PROOF: runtime-mind', 'C3-PROOF: memory-crash-recovery', 'C3-PROOF: concurrent-certification', 'C3-PROOF: review-fixes', 'C3-PROOF: founder-decisions'];
const C3_MUTATION_CHECK = 'scripts/c3-mutation-check.mjs';
// R1-15: the mutation checks are pinned. Every recorded mutation must stay in its script (a script may
// only grow), the script must keep the machinery that makes a mutation meaningful (the exact-count
// guard, the run of the proof tests, the restore, the failing exit) and the root "ci" script must run it.
const R1_MUTATION_CHECK = 'scripts/r1-mutation-check.mjs';
const MUTATION_PINS = {
  [MUTATION_CHECK]: { script: 'c1:mutation', ids: ['claim-without-supervisor-verification', 'recovery-without-supervisor-verification', 'heartbeat-without-wake-reconciliation', 'backup-finalization-without-retry', 'backup-failure-leaves-attempt', 'backup-record-not-idempotent'] },
  [C2_MUTATION_CHECK]: {
    script: 'c2:mutation',
    ids: ['authority-no-default-deny', 'authority-r4-not-founder-only', 'authority-r3-without-founder-approval', 'governance-admin-not-founder-only', 'approval-self-decision-allowed', 'reservation-without-headroom-check', 'ineligible-employee-can-run', 'denied-tool-reaches-driver', 'idempotent-replay-removed', 'call-despite-refused-reservation', 'd4-external-egress-allowed', 'silent-expensive-fallback', 'processor-can-widen-egress', 'tool-result-does-not-raise-class', 'escalation-on-self-reported-uncertainty', 'founder-ref-is-authentication', 'activation-without-certification', 'd3-external-egress-allowed', 'd3-external-reservation-allowed'],
  },
  [C3_MUTATION_CHECK]: {
    script: 'c3:mutation',
    ids: [
      'memory-secret-stored', 'memory-contradicts-canonical', 'memory-model-sets-confidence', 'context-budget-soft', 'critical-dimension-compensated', 'skill-license-unclear-eligible', 'skill-paid-dependency-silent', 'skill-executable-content-passes',
      'reservation-without-manifest', 'knowledge-scope-leak', 'memory-other-employee-visible', 'corrupt-content-used', 'unpinned-skill-loads', 'capability-gate-bypassed', 'academy-authority-unconstrained', 'holdout-reused', 'evaluator-sets-run-facts',
      'conflict-resolution-no-wake', 'capability-wait-not-rechecked', 'processor-supplied-recent-results', 'canonical-binds-only-if-relevant', 'probation-fail-no-new-epoch', 'rubric-ignores-refused-actions', 'licence-review-skipped', 'model-accepts-foreign-context',
      'pending-candidates-not-recovered', 'context-hold-not-rechecked', 'term-limit-before-filter', 'compaction-crosses-markets', 'failed-attempt-hides-breach', 'role-cert-loss-ignored', 'role-cert-loss-not-at-run-start', 'role-cert-loss-not-at-authorization',
      'role-cert-loss-not-at-reservation', 'role-cert-loss-not-at-tool-intent', 'role-reassignment-without-cert-keeps-active', 'calibration-not-required-at-activation', 'calibration-gates-certification', 'extension-evidence-not-required', 'unlicense-auto-clears',
    ],
  },
  // R1 Independent Core Review: one mutation per fixed finding (docs/R1_INDEPENDENT_CORE_REVIEW_REPORT.md).
  [R1_MUTATION_CHECK]: {
    script: 'r1:mutation',
    ids: [
      'r1-01-tool-result-secret-stored', 'r1-01-step-result-bounded-before-scan', 'r1-01-step-result-key-guard-dropped', 'r1-06-stale-pending-masks-decision', 'r1-12-stale-knowledge-eligible', 'r1-01-secret-instructions-sent', 'r1-01-detector-misses-hyphenated-keys', 'r1-02-tool-args-inherited-field', 'r1-03-step-base-ignored', 'r1-03-step-range-unbounded', 'r1-09-store-contention-blamed-on-provider', 'r1-09-over-bounds-usage-not-blamed',
      'r1-04-governed-reconciliation-unauthenticated', 'r1-05-approval-releases-unresolved-dependencies', 'r1-06-c2-wait-not-rechecked', 'r1-07-grant-does-not-wake-gap', 'r1-08-active-runs-keyed-by-job', 'r1-09-accounting-failure-escapes',
      'r1-09-settle-backstop-removed', 'r1-10-new-attempt-voids-refusal', 'r1-10-withdrawal-voids-refusal', 'r1-10-cancelled-shadow-refusal-skipped', 'r1-11-paused-reassignment-keeps-duty', 'r1-11-on-leave-reassignment-unchecked',
      'r1-12-eligibility-after-limit', 'r1-12-rejection-evidence-dropped', 'r1-12-conflict-pool-dropped', 'r1-12-conflict-pool-unrestricted', 'r1-13-lower-layer-forges-marker', 'r1-final-decision-not-checkpointed', 'r1-unbounded-proposal-code',
    ],
  },
};
// The machinery every mutation script keeps: an exact occurrence guard, a run of the named proofs, the
// restore of every mutated file and a failing exit when a mutation is not caught.
const MUTATION_MACHINERY = [/\bconst\s+MUTATIONS\s*=\s*\[/, /\bexpectedCount\b/, /spawnSync\(\s*process\.execPath,\s*\[\s*'--test'/, /\bfinally\s*\{[^}]*writeFileSync\(/, /process\.exit\(1\)/];
// Every inference is fed by the governed Context Assembler: the runtime module that mints the
// context, the model runtime that accepts only a minted context, and the request type without messages.
const CONTEXT_ASSEMBLER = 'packages/runtime/src/c3/context-assembler.ts';
const RUNTIME_TYPES = 'packages/runtime/src/c2/types.ts';
const MEMORY_PROPOSALS = 'packages/runtime/src/c3/memory-proposals.ts';
// Recent step results (context layer L6) are recorded by the runtime's own governed services only.
const RUNTIME_SERVICES = 'packages/runtime/src/runtime.ts';
// Durable Memory / Knowledge / Canonical Truth / Skill / Academy / certification state changes only in
// the C3 storage modules (never in the runtime, the governance kernel or the ordinary CompanyStore).
const MIND_WRITERS = ['mind-core', 'mind-writes', 'memory', 'skill-registry', 'academy', 'capability'].map((m) => `packages/storage/src/${m}.ts`);
const MIND_WRITE = /\b(?:UPDATE|INSERT\s+(?:OR\s+\w+\s+)?INTO|DELETE\s+FROM|REPLACE\s+INTO)\s+(?:canonical_truth|memory_\w+|lesson\w*|knowledge_\w+|context_\w+|skill\w*|role_blueprint\w*|passport_\w+|academy_\w+|certification\w*|founder_calibrations|probation_\w+|activation_requests|capability_gaps|work_item_capabilities|run_execution_modes)\b/i;
// Founder / evaluator acts that model output must never reach: the runtime and CLI never call them.
const MIND_AUTHORITY_CALL = /\.(?:recordCanonicalTruth|correctMemory|recordKnowledge|validateLesson|decidePromotion|advanceSkillVersion|acknowledgePaidDependency|publishBlueprint|openPassportEntry|rolloutUpdate|rollbackUpdate|recordEvaluation|decideProbationReview|decideFounderCalibration|decideActivation|revokeCertification|requireRecertification|cancelGap)\s*\(/;
const SKILL_LOADER = 'packages/storage/src/mind-core.ts';
const MIND_KERNEL_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"](?:node:(?:fs|fs\/promises|sqlite|child_process|net|http|https)|@qandeel-company\/(?:storage|runtime)(?:\/[^'"]*)?)['"]/;
const CONTENT_IN_TELEMETRY = /\b(?:appendAudit|appendEvent|\.(?:info|warn|error|debug))\s*\([^\n]*[{,]\s*(?:content|instructions|statement|text|messages|claimValue)\s*[,:}]/;
const pkgOf = (f) => f.split('/')[1];
const isTestPath = (f) => /^packages\/[^/]+\/test\//.test(f);

const NODE_ENGINE = /^>=24\.\d+\.\d+ <25(\.0\.0)?$/;

// Code and configuration files whose *content* is scanned. Markdown is excluded:
// the authority documents legitimately name the App repository, APP-OPS and tar.
// The lockfile is excluded: third-party package names (e.g. "tar") are not our code.
const CONTENT_EXTENSIONS = /\.(?:[cm]?[jt]s|json|ya?ml|ps1|psm1|cmd|bat|sh)$/i;
const SELF = 'scripts/verify-bootstrap.mjs';
const scanned = (f) => CONTENT_EXTENSIONS.test(f) && f !== SELF && base(f) !== 'package-lock.json';
const CODE = /\.(?:[cm]?[jt]s)$/i;
const isCode = (f) => CODE.test(f) && f !== SELF && !f.endsWith('.d.ts');

/** A C1 lifecycle claim with the explicit denial "NOT CLOSED" removed first. */
const closedClaim = (text) => /\b(?:CLOSED|PASS|DONE|IMPLEMENTED|COMPLETE|MERGED)\b/i.test((text ?? '').replace(/\bNOT\s+CLOSED\b/gi, ''));
const migrationSha = (text) => createHash('sha256').update((text ?? '').replace(/\r\n/g, '\n'), 'utf8').digest('hex');

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

/** Rows of the manifest's imported-files table: `| area | `path` | archive | inner | src sha | imported sha | class | copy | ...`. */
function manifestRows(text) {
  return (text ?? '').split('\n').flatMap((line) => {
    if (!line.startsWith('|')) return [];
    const cells = line.split('|').slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, ''));
    return cells.length >= 8 && cells[1].startsWith(AUTHORITY_DIR)
      ? [{ path: cells[1], sourceSha256: cells[4], sha256: cells[5], classification: cells[6], copy: cells[7] }]
      : [];
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
    // requires every workspace to track tests and to run them with node:test — directly, or
    // through scripts/run-node-tests.mjs, which additionally refuses zero/skipped/todo tests.
    check: ({ files, read }) =>
      (json(read('package.json'))?.workspaces ?? []).flatMap((w) => {
        const problems = [];
        if (!files.some((f) => f.startsWith(`${w}/test/`) && f.endsWith('.test.ts'))) problems.push(`workspace ${w} tracks no test/**/*.test.ts file`);
        if (!/node --test\b|node \.\.\/\.\.\/scripts\/run-node-tests\.mjs\b/.test(json(read(`${w}/package.json`))?.scripts?.test ?? '')) problems.push(`workspace ${w} "test" script does not run node --test`);
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
      for (const { path: p, sourceSha256, sha256: recorded, classification, copy } of rows) {
        if (listed.has(p)) problems.push(`${p} is listed twice`);
        listed.add(p);
        if (!/^[0-9a-f]{64}$/.test(recorded)) problems.push(`${p} has no valid imported SHA-256`);
        else if (!files.includes(p)) problems.push(`${p} is listed but not present`);
        else if (sha256(p) !== recorded) problems.push(`${p} does not match its recorded SHA-256`);
        if (copy !== 'exact') problems.push(`${p} is not recorded as an exact copy`);
        else if (sourceSha256 !== recorded) problems.push(`${p} is recorded as an exact copy but its source and imported SHA-256 differ`);
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
      for (const { pattern, docs } of STALE_PRIVACY) {
        for (const doc of docs) {
          const hit = normalizeProse(read(doc)).match(pattern);
          if (hit) problems.push(`${doc} contains default-with-exception privacy wording: "${hit[0]}"`);
        }
      }
      return problems;
    },
  },
  {
    id: 'implementation-lifecycle-state',
    // Stage-aware: C1 may be an implementation candidate without a closure record, but it may be
    // marked closed only in the change that adds that record; C2 may start only after C1 closes.
    check: ({ files, read }) => {
      const map = read(IMPLEMENTATION_MAP);
      const problems = [];
      for (const id of ['L0', 'C0']) {
        const state = mapState(map, id);
        if (state !== 'CLOSED / PASS') problems.push(`${id} state is ${JSON.stringify(state)}, expected "CLOSED / PASS"`);
      }
      const c1Closed = files.some((f) => C1_CLOSURE.test(f));
      const c1 = mapState(map, 'C1');
      if (c1 === undefined) problems.push('implementation map has no C1 row');
      else if (closedClaim(c1) && !c1Closed) problems.push(`C1 is marked ${JSON.stringify(c1)} but no docs/C1_*CLOSURE*.md record exists`);
      const c2 = mapState(map, 'C2');
      if (c2 === undefined) problems.push('implementation map has no C2 row');
      else if (c2 !== 'Not started' && !c1Closed) problems.push(`C2 is ${JSON.stringify(c2)} before C1 has a closure record`);
      const report = read(C1_REPORT);
      if (report !== undefined && !c1Closed && /\bC1\s*(?:—|-|:|is)?\s*CLOSED\b/i.test(report.replace(/\bNOT\s+CLOSED\b/gi, ''))) {
        problems.push(`${C1_REPORT} claims C1 is closed without a closure record`);
      }
      return problems;
    },
  },
  {
    id: 'sqlite-confined-to-storage',
    check: ({ files, read }) =>
      files
        .filter((f) => isCode(f) && f !== SQLITE_ADAPTER && SQLITE_IMPORT.test(read(f) ?? ''))
        .map((f) => `${f} imports node:sqlite; only ${SQLITE_ADAPTER} may`),
  },
  {
    id: 'no-network-in-runtime-code',
    check: ({ files, read }) =>
      files
        .filter((f) => /^packages\/[^/]+\/src\//.test(f) && isCode(f) && NETWORK_MODULE.test(read(f) ?? ''))
        .map((f) => `${f} opens a network path or spawns processes (C1 runtime code has neither)`),
  },
  {
    id: 'runtime-dependencies-allowlisted',
    check: ({ files, read }) =>
      allManifests({ files, read }).flatMap(([f, m]) => {
        const deps = Object.keys({ ...m.dependencies, ...m.optionalDependencies, ...m.peerDependencies });
        if (f === 'package.json') return deps.map((d) => `root package.json declares runtime dependency ${d} (devDependencies only)`);
        return deps.filter((d) => !d.startsWith('@qandeel-company/') && !ALLOWED_RUNTIME_DEPENDENCIES.includes(d)).map((d) => `${f} depends on ${d}, which is not an allowlisted runtime dependency`);
      }),
  },
  {
    id: 'migrations-immutable',
    // Every migration file is pinned by SHA-256 in the registry and every pin has its file.
    check: ({ files, read }) => {
      const sqlFiles = files.filter((f) => f.startsWith(MIGRATIONS_DIR) && f.endsWith('.sql'));
      if (sqlFiles.length === 0) return [];
      const registry = read(MIGRATIONS_REGISTRY) ?? '';
      const pins = [...registry.matchAll(/file:\s*'([^']+\.sql)',\s*sha256:\s*'([0-9a-f]{64})'/g)].map((m) => ({ file: `${MIGRATIONS_DIR}${m[1]}`, sha256: m[2] }));
      const problems = [];
      for (const f of sqlFiles) {
        const pin = pins.find((p) => p.file === f);
        if (!pin) problems.push(`${f} is not pinned in ${MIGRATIONS_REGISTRY}`);
        else if (pin.sha256 !== migrationSha(read(f))) problems.push(`${f} does not match its pinned SHA-256 (released migrations are immutable)`);
      }
      for (const p of pins) if (!files.includes(p.file)) problems.push(`${p.file} is pinned but missing`);
      return problems;
    },
  },
  {
    id: 'runtime-authority-confined',
    // Only @qandeel-company/runtime may import the runtime-authority subpath; no code outside the
    // storage package reaches into storage internals; the storage exports map stays closed.
    check: ({ files, read }) => {
      const problems = [];
      for (const f of files.filter((x) => isCode(x) && pkgOf(x) !== 'storage')) {
        const text = read(f) ?? '';
        for (const m of text.matchAll(STORAGE_SUBPATH_IMPORT)) {
          const allowed = (m[1] === 'runtime-authority' && f.startsWith('packages/runtime/')) || (m[1] === 'testing' && (isTestPath(f) || TEST_SEAM_HARNESSES.includes(f)));
          if (!allowed) problems.push(`${f} imports @qandeel-company/storage/${m[1]} (only packages/runtime may import ${AUTHORITY_SUBPATH}; only tests may import the test seam)`);
        }
        if (!(pkgOf(f) === 'runtime' && isTestPath(f)) && STORAGE_INTERNALS_IMPORT.test(text)) problems.push(`${f} imports storage internals by path`);
        if (/^packages\/[^/]+\/src\//.test(f) && /\bcreateRequire\b/.test(text)) problems.push(`${f} uses createRequire, which bypasses the static import boundary`);
      }
      const manifest = json(read(STORAGE_PKG));
      if (manifest) {
        const keys = Object.keys(manifest.exports ?? {});
        if (keys.length !== STORAGE_EXPORTS.length || keys.some((k) => !STORAGE_EXPORTS.includes(k))) problems.push(`${STORAGE_PKG} exports ${JSON.stringify(keys)}; only ${JSON.stringify(STORAGE_EXPORTS)} are allowed`);
        const seam = manifest.exports?.['./testing'];
        const conditional = seam !== null && typeof seam === 'object' && seam.default === null && typeof seam[TEST_CONDITION] === 'object' && Object.keys(seam).length === 2;
        if (seam !== undefined && !conditional) problems.push(`${STORAGE_PKG} "./testing" must resolve only under the "${TEST_CONDITION}" condition (default: null)`);
      }
      return problems;
    },
  },
  {
    id: 'supervisor-claim-fence-mandatory',
    // The claim contract requires the Runtime Supervisor fence; the ordinary storage API has no
    // claim, supervisor or worker-write method and does not re-export the authority module.
    check: ({ files, read }) => {
      const problems = [];
      const storageSrc = files.filter((f) => f.startsWith('packages/storage/src/') && isCode(f));
      const declaring = storageSrc.filter((f) => /\binterface\s+ClaimOptions\b/.test(read(f) ?? ''));
      if (storageSrc.length && declaring.length === 0) problems.push('no ClaimOptions contract found in packages/storage/src');
      for (const f of declaring) {
        const body = (read(f) ?? '').split(/\binterface\s+ClaimOptions\b/)[1]?.split('\n}')[0] ?? '';
        if (!/\breadonly\s+supervisor\s*:\s*SupervisorFence\b/.test(body)) problems.push(`${f}: ClaimOptions.supervisor must be a required SupervisorFence`);
        if (/\bsupervisor\s*\?\s*:/.test(body) || /supervisor\s*:\s*SupervisorFence\s*\|\s*(?:undefined|null)/.test(body)) problems.push(`${f}: ClaimOptions.supervisor is optional`);
      }
      for (const f of storageSrc) {
        const text = read(f) ?? '';
        if (/\bclass\s+CompanyStore\b/.test(text)) {
          for (const name of AUTHORITY_METHODS) if (new RegExp(`^\\s+(?:public\\s+)?${name}\\s*\\(`, 'm').test(text)) problems.push(`${f}: CompanyStore offers ${name}() on the ordinary API`);
        }
      }
      const index = read('packages/storage/src/index.ts');
      if (index !== undefined && /runtime-authority/.test(index.replace(/^\s*\/\/.*$/gm, ''))) problems.push('packages/storage/src/index.ts re-exports the runtime-authority module');
      return problems;
    },
  },
  {
    id: 'no-runtime-store-escape',
    // No package outside storage returns or publicly holds a mutable CompanyStore (read-only views only).
    check: ({ files, read }) =>
      files
        .filter((f) => /^packages\/[^/]+\/src\//.test(f) && isCode(f) && pkgOf(f) !== 'storage')
        .flatMap((f) => {
          const text = read(f) ?? '';
          const escapes = [
            /^\s*(?:public\s+|static\s+)*get\s+[A-Za-z_$][\w$]*\s*\(\s*\)\s*:[^{;]*\bCompanyStore\b/m,
            /^\s*(?:public\s+|static\s+|async\s+)*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*:[^{;=]*\bCompanyStore\b[^{;=]*\{/m,
            /^\s*export\s+(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*:[^{;]*\bCompanyStore\b/m,
            /^\s*(?:public\s+|readonly\s+|static\s+)+[A-Za-z_$][\w$]*\s*[?!]?\s*:[^;=]*\bCompanyStore\b/m,
          ];
          return escapes.some((re) => re.test(text)) ? [`${f} exposes a mutable CompanyStore (hand out CompanyReadView instead)`] : [];
        }),
  },
  {
    id: 'c1-remediation-proofs-present',
    check: ({ files, read }) => {
      const tests = files.filter((f) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(f));
      const problems = C1_PROOF_MARKERS.filter((marker) => !tests.some((f) => (read(f) ?? '').includes(marker))).map((marker) => `no test carries the proof marker "${marker}"`);
      if (!files.includes(MUTATION_CHECK)) problems.push(`missing ${MUTATION_CHECK}`);
      const ci = json(read('package.json'))?.scripts?.ci ?? '';
      if (!/\bc1:mutation\b/.test(ci)) problems.push('the root "ci" script does not run c1:mutation');
      return problems;
    },
  },
  {
    id: 'c1-proof-tests-present',
    check: ({ files }) => C1_PROOF_TESTS.filter((f) => !files.includes(f)).map((f) => `missing C1 proof test ${f}`),
  },
  {
    id: 'model-calls-confined',
    // Provider adapters are called only by the governed Model Runtime (budget, authority, routing).
    check: ({ files, read }) =>
      files
        .filter((f) => /^packages\/[^/]+\/src\//.test(f) && isCode(f) && f !== MODEL_RUNTIME && ADAPTER_CALL.test(read(f) ?? ''))
        .map((f) => `${f} calls a provider adapter (.generate); only ${MODEL_RUNTIME} may`),
  },
  {
    id: 'tool-drivers-confined',
    // Tool drivers are invoked only by the governed Tool Executor (authority path first).
    check: ({ files, read }) =>
      files
        .filter((f) => /^packages\/[^/]+\/src\//.test(f) && isCode(f) && f !== TOOL_EXECUTOR && DRIVER_CALL.test(read(f) ?? ''))
        .map((f) => `${f} invokes a tool driver (.invoke); only ${TOOL_EXECUTOR} may`),
  },
  {
    id: 'founder-surface-test-only',
    // D-C2-13: a Founder ref is not authentication. Production code never reaches the test-only
    // Founder seam, accepts no Founder attestation as activation evidence, and the CLI offers no
    // Founder write command (the authenticated Founder surface is C5).
    check: ({ files, read }) => {
      const problems = [];
      for (const f of files.filter((x) => /^packages\/[^/]+\/src\//.test(x) && isCode(x))) {
        const text = read(f) ?? '';
        if (!FOUNDER_SEAM_FILES.includes(f) && /\bfounderSurfaceInternals\b|testing\/founder-seam/.test(text)) problems.push(`${f} reaches the test-only Founder seam`);
        if (/founder-attestation:/.test(text)) problems.push(`${f} treats a Founder attestation as activation evidence (certification is C3)`);
      }
      const index = read('packages/storage/src/index.ts');
      if (index !== undefined && /founderSurfaceInternals|testing\//.test(index.replace(/^\s*\/\/.*$/gm, ''))) problems.push('packages/storage/src/index.ts exports the test-only Founder seam');
      const cli = read(CLI_SOURCE);
      if (cli !== undefined && (/case\s+['"](?:approve|reject|register-founder)['"]/.test(cli) || /\bactor\s*:\s*\{\s*type\b/.test(cli))) problems.push(`${CLI_SOURCE} exposes a Founder write command (a Founder ref is not authentication; C5)`);
      return problems;
    },
  },
  {
    id: 'budget-mutation-scoped',
    // Budget, reservation and usage rows change only inside the storage governance modules; the
    // runtime's reservation / settlement / tool-intent writes take a job Fence; neither ordinary
    // storage entry point re-exports them.
    check: ({ files, read }) => {
      const problems = files
        .filter((f) => isCode(f) && !BUDGET_WRITERS.includes(f) && BUDGET_WRITE.test(read(f) ?? ''))
        .map((f) => `${f} writes budget / reservation / usage rows outside ${BUDGET_WRITERS.join(', ')}`);
      const authority = read('packages/storage/src/runtime-authority.ts');
      if (authority !== undefined) {
        for (const name of FENCED_BUDGET_FUNCTIONS) {
          const sig = new RegExp(`export\\s+function\\s+${name}\\s*\\(\\s*store:\\s*CompanyStore\\s*,\\s*fence:\\s*Fence\\b`);
          if (!sig.test(authority)) problems.push(`runtime-authority ${name}() must take (store: CompanyStore, fence: Fence, …)`);
        }
      }
      const index = (read('packages/storage/src/index.ts') ?? '').replace(/^\s*\/\/.*$/gm, '');
      if (/governed-writes/.test(index)) problems.push('packages/storage/src/index.ts re-exports the fenced governed writes');
      for (const f of files.filter((x) => x.startsWith('packages/storage/src/') && isCode(x))) {
        const text = read(f) ?? '';
        if (/\bclass\s+(?:CompanyStore|GovernanceStore)\b/.test(text)) {
          for (const name of FENCED_BUDGET_FUNCTIONS) if (new RegExp(`^\\s+(?:public\\s+)?${name}\\s*\\(`, 'm').test(text)) problems.push(`${f}: an ordinary store offers ${name}()`);
        }
      }
      return problems;
    },
  },
  {
    id: 'no-plaintext-secrets',
    // No secret value in code, config, SQL or fixtures; no schema column is shaped to hold one.
    check: ({ files, read }) => [
      ...files.filter((f) => (scanned(f) || f.endsWith('.sql')) && SECRET_LITERALS.some((re) => re.test(read(f) ?? ''))).map((f) => `${f} contains a plaintext secret-looking value`),
      ...files.filter((f) => f.startsWith(MIGRATIONS_DIR) && f.endsWith('.sql') && SECRET_COLUMN.test(read(f) ?? '')).map((f) => `${f} declares a column shaped to hold a secret (store a vault reference instead)`),
    ],
  },
  {
    id: 'released-migrations-frozen',
    // Canonical migrations 0001–0006 (C1, C2, C3) are frozen by content: editing one and re-pinning it
    // is still refused. A later change adds new migrations from 0007.
    check: ({ files, read }) =>
      FROZEN_MIGRATIONS.flatMap(({ file, sha256 }) => {
        const f = `${MIGRATIONS_DIR}${file}`;
        if (!files.includes(f)) return [`released canonical migration ${f} is missing`];
        return migrationSha(read(f)) === sha256 ? [] : [`released canonical migration ${f} was edited (released migrations are immutable)`];
      }),
  },
  {
    id: 'no-later-scope-leakage',
    // C3 does not implement Review Pool / Directors / delegation / organization (C4), the Founder UI
    // (C5) or APP-OPS (C7): no such tables, views or packages.
    check: ({ files, read, dirs }) => [
      ...files.filter((f) => f.startsWith(MIGRATIONS_DIR) && f.endsWith('.sql')).flatMap((f) => {
        const m = (read(f) ?? '').match(LATER_SCOPE_TABLE);
        return m ? [`${f} creates ${m[1]}, which belongs to a later work package`] : [];
      }),
      ...[...new Set([...files.filter((f) => f.startsWith('packages/')).map((f) => f.split('/')[1]), ...dirs('packages')])].filter((p) => p && LATER_SCOPE_PACKAGE.test(p)).map((p) => `packages/${p} belongs to a later work package`),
    ],
  },
  {
    id: 'c2-proofs-present',
    check: ({ files, read }) => {
      const tests = files.filter((f) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(f));
      const problems = C2_PROOF_MARKERS.filter((marker) => !tests.some((f) => (read(f) ?? '').includes(marker))).map((marker) => `no test carries the proof marker "${marker}"`);
      if (!files.includes(C2_MUTATION_CHECK)) problems.push(`missing ${C2_MUTATION_CHECK}`);
      const ci = json(read('package.json'))?.scripts?.ci ?? '';
      if (!/\bc2:mutation\b/.test(ci)) problems.push('the root "ci" script does not run c2:mutation');
      return problems;
    },
  },
  {
    id: 'c2-not-claimed-closed',
    // C2 may be an implementation candidate; it is closed only in the change that adds its record.
    check: ({ files, read }) => {
      const c2Closed = files.some((f) => C2_CLOSURE.test(f));
      if (c2Closed) return [];
      const problems = [];
      const c2 = mapState(read(IMPLEMENTATION_MAP), 'C2');
      if (c2 !== undefined && /\bCLOSED\b/i.test(c2.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`C2 is marked ${JSON.stringify(c2)} but no docs/C2_*CLOSURE*.md record exists`);
      const report = read(C2_REPORT);
      if (report !== undefined && /\bC2\s*(?:—|-|:|is)?\s*CLOSED\b/i.test(report.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`${C2_REPORT} claims C2 is closed without a closure record`);
      const c3 = mapState(read(IMPLEMENTATION_MAP), 'C3');
      if (c3 !== undefined && c3 !== 'Not started' && !c2Closed) problems.push(`C3 is ${JSON.stringify(c3)} before C2 has a closure record`);
      return problems;
    },
  },
  {
    id: 'c3-proofs-present',
    check: ({ files, read }) => {
      const tests = files.filter((f) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(f));
      const problems = C3_PROOF_MARKERS.filter((marker) => !tests.some((f) => (read(f) ?? '').includes(marker))).map((marker) => `no test carries the proof marker "${marker}"`);
      if (!files.includes(C3_MUTATION_CHECK)) problems.push(`missing ${C3_MUTATION_CHECK}`);
      const ci = json(read('package.json'))?.scripts?.ci ?? '';
      if (!/\bc3:mutation\b/.test(ci)) problems.push('the root "ci" script does not run c3:mutation');
      return problems;
    },
  },
  {
    id: 'mutation-checks-pinned',
    // R1-15: a mutation check replaced by a comment, or a recorded mutation removed together with its
    // gate, must fail CI. Scripts may only grow; each keeps the machinery that makes a catch meaningful.
    check: ({ files, read }) => {
      const problems = [];
      const ci = json(read('package.json'))?.scripts?.ci ?? '';
      for (const [f, pin] of Object.entries(MUTATION_PINS)) {
        if (!files.includes(f)) {
          problems.push(`missing ${f}`);
          continue;
        }
        const text = read(f) ?? '';
        for (const re of MUTATION_MACHINERY) if (!re.test(text)) problems.push(`${f} lost its mutation machinery (${re.source})`);
        // A mutation check that can succeed without running its mutations is vacuous (R1 re-review).
        const loop = text.indexOf('for (const m of MUTATIONS)');
        const earlyExit = text.search(/process\s*(?:\.\s*exit|\[\s*['"]exit['"]\s*\])\s*\(|reallyExit/);
        if (/process\.exitCode\s*=/.test(text) || (earlyExit >= 0 && (loop < 0 || earlyExit < loop))) problems.push(`${f} can exit before running its mutations`);
        const pass = text.search(/mutation: PASS/);
        if (loop < 0 || (pass >= 0 && pass < loop)) problems.push(`${f} reports PASS before (or without) its mutation loop`);
        for (const id of pin.ids) if (!text.includes(`id: '${id}'`)) problems.push(`${f} no longer carries the recorded mutation "${id}"`);
        if (!new RegExp(`\\b${pin.script}\\b`).test(ci)) problems.push(`the root "ci" script does not run ${pin.script}`);
      }
      return problems;
    },
  },
  {
    id: 'c3-not-claimed-closed',
    // C3 may be a cloud implementation candidate; it is closed only in the change that adds its record,
    // and R1 / C4 do not start before it.
    check: ({ files, read }) => {
      if (files.some((f) => C3_CLOSURE.test(f))) return [];
      const problems = [];
      const map = read(IMPLEMENTATION_MAP);
      const c3 = mapState(map, 'C3');
      if (c3 !== undefined && /\bCLOSED\b/i.test(c3.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`C3 is marked ${JSON.stringify(c3)} but no docs/C3_*CLOSURE*.md record exists`);
      const report = read(C3_REPORT);
      if (report !== undefined && /\bC3\s*(?:—|-|:|is)?\s*CLOSED\b/i.test(report.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`${C3_REPORT} claims C3 is closed without a closure record`);
      for (const id of ['R1', 'C4']) {
        const st = mapState(map, id);
        if (st !== undefined && st !== 'Not started') problems.push(`${id} is ${JSON.stringify(st)} before C3 has a closure record`);
      }
      return problems;
    },
  },
  {
    id: 'context-assembly-mandatory',
    // Every inference goes through the governed Context Assembler: only it calls the storage
    // assembly, the model runtime accepts only a context it minted (never processor messages), and the
    // model request type carries no messages.
    check: ({ files, read }) => {
      const problems = files
        .filter((f) => /^packages\/[^/]+\/src\//.test(f) && isCode(f) && f !== CONTEXT_ASSEMBLER && pkgOf(f) !== 'storage' && /\bassembleContext\s*\(/.test(read(f) ?? ''))
        .map((f) => `${f} calls the storage context assembly directly; only ${CONTEXT_ASSEMBLER} may`);
      const model = read(MODEL_RUNTIME);
      if (model !== undefined) {
        if (!/\bif\s*\(\s*!isAssembledContext\(\s*context\s*\)\s*\)/.test(model)) problems.push(`${MODEL_RUNTIME} does not refuse a context the assembler did not mint`);
        if (/\breq(?:uest)?\.messages\b/.test(model)) problems.push(`${MODEL_RUNTIME} sends processor-supplied messages to a provider`);
        if (!/\bcontextManifestId\s*:\s*context\.manifestId\b/.test(model)) problems.push(`${MODEL_RUNTIME} does not bind the reservation to the context manifest`);
      }
      const types = read(RUNTIME_TYPES);
      const body = types?.split(/\binterface\s+ModelCallRequest\b/)[1]?.split('\n}')[0];
      if (body !== undefined && /\b(?:messages|recentResults)\s*\??\s*:/.test(body)) problems.push(`${RUNTIME_TYPES}: ModelCallRequest carries messages or results (context comes from the assembler and durable step records only)`);
      for (const f of files.filter((x) => x.startsWith('packages/runtime/src/') && isCode(x) && x !== RUNTIME_SERVICES)) {
        if (/\brecordStepResult\s*\(/.test(read(f) ?? '')) problems.push(`${f} records step results; only the runtime's governed services (${RUNTIME_SERVICES}) may`);
      }
      const asm = read(CONTEXT_ASSEMBLER);
      if (asm !== undefined && !/\bMINTED\.add\(/.test(asm)) problems.push(`${CONTEXT_ASSEMBLER} does not mint its contexts`);
      return problems;
    },
  },
  {
    id: 'memory-writes-confined',
    // Durable C3 state changes only in the C3 storage modules; model output reaches memory only as a
    // candidate through the runtime's memory-proposal path; Founder / evaluator acts are never called
    // by runtime code or the CLI.
    check: ({ files, read }) => {
      const problems = files
        .filter((f) => isCode(f) && !MIND_WRITERS.includes(f) && !isTestPath(f) && MIND_WRITE.test(read(f) ?? ''))
        .map((f) => `${f} writes Memory / Knowledge / Skill / Academy state outside the C3 storage modules`);
      for (const f of files.filter((x) => x.startsWith('packages/runtime/src/') && isCode(x))) {
        const text = read(f) ?? '';
        if (f !== MEMORY_PROPOSALS && /\bsubmitMemoryCandidate\s*\(/.test(text)) problems.push(`${f} submits memory candidates; only ${MEMORY_PROPOSALS} may`);
        if (MIND_AUTHORITY_CALL.test(text)) problems.push(`${f} calls a Founder / evaluator act (model output never writes memory, knowledge, certification or authority)`);
      }
      const index = (read('packages/storage/src/index.ts') ?? '').replace(/^\s*\/\/.*$/gm, '');
      if (/mind-writes|mind-core/.test(index)) problems.push('packages/storage/src/index.ts re-exports the fenced C3 writes or internals');
      return problems;
    },
  },
  {
    id: 'skill-load-pinned',
    // Skill payloads load only through the one pinned, eligibility-checked, hash-verified loader.
    check: ({ files, read }) =>
      files
        .filter((f) => isCode(f) && f !== SKILL_LOADER && !isTestPath(f))
        .filter((f) => {
          const text = read(f) ?? '';
          return /loadVerified\s*\([^)]*['"]skill_versions['"]/.test(text) || /SELECT[^;`'"]*(?<!CAST\()\binstructions\b[^;`'"]*\bFROM\s+skill_versions\b/i.test(text);
        })
        .map((f) => `${f} reads skill instructions directly; only ${SKILL_LOADER} (pinned, eligible, hash-verified) may`),
  },
  {
    id: 'mind-kernel-pure',
    // The C3 kernel decides; it performs no I/O, holds no store and reaches no provider or tool driver.
    check: ({ files, read }) =>
      files
        .filter((f) => f.startsWith('packages/mind/src/') && isCode(f))
        .filter((f) => {
          const text = read(f) ?? '';
          return MIND_KERNEL_IMPORT.test(text) || ADAPTER_CALL.test(text) || DRIVER_CALL.test(text);
        })
        .map((f) => `${f} performs I/O or reaches storage / runtime / a provider / a tool driver (the mind kernel is pure)`),
  },
  {
    id: 'mind-telemetry-content-free',
    // Rule A: C3 audit, events and logs carry IDs, states, counts and codes — never content.
    check: ({ files, read }) =>
      files
        .filter((f) => (MIND_WRITERS.includes(f) || f.startsWith('packages/runtime/src/c3/') || f.startsWith('packages/mind/src/')) && isCode(f) && CONTENT_IN_TELEMETRY.test(read(f) ?? ''))
        .map((f) => `${f} passes content into audit / events / logs (Rule A)`),
  },
  {
    id: 'activation-gate-present',
    // ACTIVE stays fail-closed: the datastore gate exists in a C3 migration and only the test seam
    // (never production code) labels a test activation.
    check: ({ files, read }) => {
      const problems = [];
      const sql = files.filter((f) => f.startsWith(MIGRATIONS_DIR) && f.endsWith('.sql')).map((f) => read(f) ?? '').join('\n');
      if (files.some((f) => f.startsWith(`${MIGRATIONS_DIR}0005`)) && !/CREATE\s+TRIGGER\s+employees_activation_gate\b/.test(sql)) problems.push('no employees_activation_gate trigger guards SHADOW / PROBATION → ACTIVE');
      for (const f of files.filter((x) => /^packages\/[^/]+\/src\//.test(x) && isCode(x) && !FOUNDER_SEAM_FILES.includes(x))) {
        const code = (read(f) ?? '').replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
        if (/`test-seam:|'test-seam:|"test-seam:/.test(code)) problems.push(`${f} writes a test-seam activation label outside the test-only seam`);
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
const synthMap = (c0 = 'CLOSED / PASS', c1 = 'NEXT — CLOUD MEGA-TASK', c2 = 'Not started', c3, r1, c4) =>
  [
    '| Stage | Name | Mode | State |',
    '|---|---|---|---|',
    '| `L0` | Env | Local | CLOSED / PASS |',
    `| \`C0\` | Boot | Local | ${c0} |`,
    `| \`C1\` | Found | Cloud | ${c1} |`,
    `| \`C2\` | Emp | Cloud | ${c2} |`,
    ...(c3 === undefined ? [] : [`| \`C3\` | Mind | Cloud | ${c3} |`]),
    ...(r1 === undefined ? [] : [`| \`R1\` | Review | Review | ${r1} |`]),
    ...(c4 === undefined ? [] : [`| \`C4\` | Org | Cloud | ${c4} |`]),
    '',
  ].join('\n');
const SYNTH_SQL = 'CREATE TABLE t (x INTEGER) STRICT;\n';
// The real, frozen C1 migration texts (read from this checkout) so the synthetic repository is clean.
const C1_MIGRATION_TEXT = Object.fromEntries(FROZEN_MIGRATIONS.map(({ file }) => [file, readFileSync(path.join(ROOT, MIGRATIONS_DIR, file), 'utf8')]));
const c1Pins = () => FROZEN_MIGRATIONS.map(({ file }, i) => `  { version: ${i + 2}, name: 'c1-${i}', file: '${file}', sha256: '${migrationSha(C1_MIGRATION_TEXT[file])}' },\n`).join('');
const SYNTH_C2_SQL = 'CREATE TABLE employees (id TEXT, credential_ref TEXT) STRICT;\n';
const synthRegistry = (sql = SYNTH_SQL) =>
  `export const RELEASED_MIGRATIONS = [\n  { version: 1, name: 'one', file: '0001_one.sql', sha256: '${migrationSha(sql)}' },\n${c1Pins()}  { version: 5, name: 'c2', file: '0004_c2.sql', sha256: '${migrationSha(SYNTH_C2_SQL)}' },\n  { version: 6, name: 'c3', file: '0005_c3.sql', sha256: '${migrationSha(SYNTH_C3_SQL)}' },\n];\n`;
const SYNTH_AUTHORITY = [
  'export function reserveBudget(store: CompanyStore, fence: Fence, input: ReserveInput): ReserveResult {}',
  'export function settleReservation(store: CompanyStore, fence: Fence, id: Id, usage: SettleUsage): Id {}',
  'export function releaseReservation(store: CompanyStore, fence: Fence, id: Id, reason: string): void {}',
  'export function holdReservation(store: CompanyStore, fence: Fence, id: Id, reason: string): void {}',
  'export function recordToolIntent(store: CompanyStore, fence: Fence, input: ToolIntentInput): ToolIntent {}',
  'export function recordToolResult(store: CompanyStore, fence: Fence, id: Id, outcome: ToolDriverOutcome): string {}',
  '',
].join('\n');
const SYNTH_C3_SQL = 'CREATE TABLE memory_records (id TEXT) STRICT;\nCREATE TABLE skill_versions (id TEXT) STRICT;\nCREATE TRIGGER employees_activation_gate BEFORE UPDATE ON employees BEGIN SELECT 1; END;\n';
const SYNTH_ASSEMBLER = "const r = assembleContext(store, fence, request);\nconst context = Object.freeze({ manifestId: r.manifestId });\nMINTED.add(context);\n";
const SYNTH_MODEL_RUNTIME = [
  'async call(store: CompanyStore, fence: Fence, run: GovernedRunContext, req: ModelCallRequest, context: AssembledContext, signal: AbortSignal) {',
  "  if (!isAssembledContext(context)) return { kind: 'CONTEXT', code: 'CONTEXT_NOT_ASSEMBLED' };",
  '  const reserved = reserveBudget(store, fence, { tokens: 1, contextManifestId: context.manifestId });',
  '  const r = await adapter.generate({ messages: context.messages }, signal);',
  '}',
  '',
].join('\n');
const SYNTH_TYPES = 'export interface ModelCallRequest {\n  readonly taskClass: string;\n  readonly step: number;\n}\n';
const SYNTH_BASELINE = `## 5. Data and privacy\n\n- **Rule A — ${PRIVACY_RULES[0]}**\n- **Rule B — ${PRIVACY_RULES[1].replace('private user content', 'private user\n  content')}**\n- **Rule C — ${PRIVACY_RULES[2]}**\n\n## 2. Operating principles\n\n- Event-driven by default.\n`;

// A minimal mutation script that keeps the pinned machinery and IDs (the synthetic repository is clean).
const synthMutationScript = (ids) =>
  [
    'const MUTATIONS = [',
    ...ids.map((id) => `  { id: '${id}', expectedCount: 1 },`),
    '];',
    "for (const m of MUTATIONS) { try { spawnSync(process.execPath, ['--test', ...m.tests]); } finally { writeFileSync(file, original); } }",
    'if (failures) process.exit(1);',
    '',
  ].join('\n');
const SYNTH_QUEUE ="export interface ClaimOptions {\n  readonly workerId: string;\n  readonly supervisor: SupervisorFence;\n}\n";
const SYNTH_STORE = 'export class CompanyStore {\n  static open(root: string): CompanyStore {\n    return new CompanyStore();\n  }\n  wake(id: string): boolean {\n    return true;\n  }\n  readView(): CompanyReadView {\n    return view;\n  }\n}\n';
const SYNTH_RUNTIME = [
  "import { CompanyStore, type CompanyReadView } from '@qandeel-company/storage';",
  "import { claimNext } from '@qandeel-company/storage/runtime-authority';",
  'export class CompanyRuntime {',
  '  #store: CompanyStore | undefined;',
  '  #ready(): CompanyStore {',
  '    return this.#store as CompanyStore;',
  '  }',
  '  get view(): CompanyReadView {',
  '    return this.#ready().readView();',
  '  }',
  '}',
  '',
].join('\n');

function syntheticRepo(overrides = {}) {
  const baseContents = {
    ...Object.fromEntries([...REQUIRED_FILES, ...REQUIRED_DOCS].map((f) => [f, ''])),
    [BASELINE]: SYNTH_BASELINE,
    [IMPLEMENTATION_MAP]: synthMap(),
    [AUTHORITY_INDEX]: `## Missing\n\n**${STAGE_16_MISSING}.**\n`,
    [AUTHORITY_MANIFEST]: synthManifest(manifestRow(SYNTH_SOURCE, SYNTH_SOURCE_TEXT)),
    [SYNTH_SOURCE]: SYNTH_SOURCE_TEXT,
    'package.json': JSON.stringify({ private: true, engines: { node: '>=24.11.0 <25.0.0' }, workspaces: ['packages/bootstrap-contract'], scripts: { ci: 'npm run test && npm run c1:mutation && npm run c2:mutation && npm run c3:mutation && npm run r1:mutation' } }),
    'packages/bootstrap-contract/package.json': JSON.stringify({ private: true, scripts: { test: 'node --test dist/test' } }),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { 'packages/bootstrap-contract': {}, 'node_modules/tar': { version: '7.0.0' } } }),
    '.gitattributes': '* text=auto eol=lf\n*.sh text eol=lf\n*.ps1 text eol=crlf\n*.png binary\n',
    '.npmrc': 'engine-strict=true\n',
    // Legitimate names that earlier rule versions wrongly flagged; they must stay clean.
    'packages/bootstrap-contract/src/secret-store.ts': 'export {};',
    'packages/bootstrap-contract/src/design-tokens.css': '',
    'packages/bootstrap-contract/src/whatsapp-ops.ts': 'export const whatsappOps = 1;',
    ...Object.fromEntries(C1_PROOF_TESTS.map((f) => [f, ''])),
    [SQLITE_ADAPTER]: "import { DatabaseSync } from 'node:sqlite';",
    [MIGRATIONS_REGISTRY]: synthRegistry(),
    [`${MIGRATIONS_DIR}0001_one.sql`]: SYNTH_SQL,
    'packages/runtime/package.json': JSON.stringify({ private: true, dependencies: { '@qandeel-company/storage': '0.1.0' } }),
    [STORAGE_PKG]: JSON.stringify({ private: true, exports: { '.': {}, './runtime-authority': {}, './testing': { [TEST_CONDITION]: {}, default: null } } }),
    'packages/storage/src/queue.ts': SYNTH_QUEUE,
    'packages/storage/src/store.ts': SYNTH_STORE,
    'packages/storage/src/index.ts': "// Claims are not exported here; see the runtime-authority subpath.\nexport { CompanyStore } from './store.js';\n",
    'packages/runtime/src/runtime.ts': SYNTH_RUNTIME,
    'packages/runtime/test/integration/lost-wake.test.ts': `// ${C1_PROOF_MARKERS[1]}\n`,
    'packages/storage/test/supervisor-authority.test.ts': `// ${C1_PROOF_MARKERS[0]}\n`,
    'packages/storage/test/product-decisions.test.ts': `// ${C1_PROOF_MARKERS[2]}\n`,
    'packages/storage/test/backup-finalization.test.ts': `// ${C1_PROOF_MARKERS[3]}\n`,
    [MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[MUTATION_CHECK].ids),
    // Legitimate code that mentions the words without opening a network path must stay clean.
    'packages/runtime/src/wake.ts': "// no fetch here; a 'net' income is not a socket\nexport const prefetched = 1;",
    'packages/storage/test/labels.test.ts': "const root = tempRoot('sqlite');",
    ...Object.fromEntries(FROZEN_MIGRATIONS.map(({ file }) => [`${MIGRATIONS_DIR}${file}`, C1_MIGRATION_TEXT[file]])),
    'packages/storage/src/runtime-authority.ts': SYNTH_AUTHORITY,
    [TOOL_EXECUTOR]: 'const r = await driver.invoke(input, signal);',
    'packages/storage/src/governed-writes.ts': "ctx.db.run('UPDATE budgets SET reserved_money = ? WHERE id = ?', a, b);",
    // Legitimate code that mentions the words: an interface declaration, a vault reference, a CREATE of a C2 table.
    'packages/governance/src/providers.ts': 'export interface ProviderAdapter {\n  generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>;\n}\n',
    'packages/storage/src/credentials.ts': "const credentialRef = 'vault:publisher-token';",
    [`${MIGRATIONS_DIR}0004_c2.sql`]: SYNTH_C2_SQL,
    'packages/runtime/test/c2/proofs.test.ts': C2_PROOF_MARKERS.map((m) => `// ${m}`).join('\n'),
    [C2_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[C2_MUTATION_CHECK].ids),
    // C3: proofs, the minting assembler, a model runtime that accepts only minted context, a request
    // type without messages, the one skill loader, the pure kernel and the activation gate.
    'packages/runtime/test/c3/proofs.test.ts': C3_PROOF_MARKERS.map((m) => `// ${m}`).join('\n'),
    [C3_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[C3_MUTATION_CHECK].ids),
    [R1_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[R1_MUTATION_CHECK].ids),
    [CONTEXT_ASSEMBLER]: SYNTH_ASSEMBLER,
    [MODEL_RUNTIME]: SYNTH_MODEL_RUNTIME,
    [RUNTIME_TYPES]: SYNTH_TYPES,
    [MEMORY_PROPOSALS]: 'const s = submitMemoryCandidate(store, fence, step, proposal);\n',
    [SKILL_LOADER]: "const t = loadVerified(ctx, 'skill_versions', id);\n",
    'packages/storage/src/memory.ts': "ctx.db.run('INSERT INTO memory_records (id) VALUES (?)', id);\nappendAudit(ctx, 'memory.corrected', 'memory', id, a, 'OK', null, { version: 2 });\n",
    'packages/mind/src/memory.ts': "import { QandeelError } from '@qandeel-company/domain';\nexport const decide = (content: string): string => content.trim();\n",
    [`${MIGRATIONS_DIR}0005_c3.sql`]: SYNTH_C3_SQL,
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
  'workspace-tests-present': [
    { remove: ['packages/bootstrap-contract/test/bootstrap-contract.test.ts'] },
    { contents: { 'packages/bootstrap-contract/package.json': JSON.stringify({ private: true, scripts: { test: 'echo skipped' } }) } },
  ],
  'no-placeholder-packages': [{ dirs: ['bootstrap-contract', 'employees'] }, { dirs: ['bootstrap-contract', 'domain', 'storage', 'runtime', 'model-router'] }],
  'gitattributes-explicit': { contents: { '.gitattributes': '*.png binary\n' } },
  'authority-import-integrity': [
    { contents: { [SYNTH_SOURCE]: `${SYNTH_SOURCE_TEXT}edited\n` } },
    {
      // Edited file whose imported-SHA cell was updated too: no longer an exact copy of its source.
      contents: {
        [SYNTH_SOURCE]: `${SYNTH_SOURCE_TEXT}edited\n`,
        [AUTHORITY_MANIFEST]: synthManifest(
          `| Stage | \`${SYNTH_SOURCE}\` | \`a.zip\` | \`a/x.md\` | \`${sha(SYNTH_SOURCE_TEXT)}\` | \`${sha(`${SYNTH_SOURCE_TEXT}edited\n`)}\` | CLOSED / FROZEN | exact | - | - |`,
        ),
      },
    },
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
    { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'IMPLEMENTATION CANDIDATE — CLOSED') } },
    { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'IMPLEMENTATION CANDIDATE — NOT CLOSED', 'IN PROGRESS') } },
    { contents: { [C1_REPORT]: '# Report\n\nC1 — CLOSED.\n' } },
  ],
  'sqlite-confined-to-storage': [
    { contents: { 'packages/runtime/src/shortcut.ts': "import { DatabaseSync } from 'node:sqlite';" } },
    { contents: { 'packages/domain/src/x.js': "const s = require('node:sqlite');" } },
    { contents: { 'packages/runtime/src/y.ts': "const s = await import('node:sqlite');" } },
  ],
  'no-network-in-runtime-code': [
    { contents: { 'packages/runtime/src/server.ts': "import { createServer } from 'node:http';" } },
    { contents: { 'packages/storage/src/sync.ts': "const r = await fetch('https://example.invalid');" } },
    { contents: { 'packages/runtime/src/ipc.ts': "const net = await import('node:net');" } },
    { contents: { 'packages/runtime/src/tool.ts': "import { execFile } from 'node:child_process';" } },
  ],
  'runtime-dependencies-allowlisted': [
    { contents: { 'packages/runtime/package.json': JSON.stringify({ private: true, dependencies: { openai: '4.0.0' } }) } },
    { contents: { 'package.json': JSON.stringify({ private: true, engines: { node: '>=24.11.0 <25.0.0' }, workspaces: ['packages/bootstrap-contract'], dependencies: { 'better-sqlite3': '11.0.0' } }) } },
  ],
  'migrations-immutable': [
    { contents: { [`${MIGRATIONS_DIR}0001_one.sql`]: 'CREATE TABLE t (x INTEGER, y INTEGER) STRICT;\n' } },
    { contents: { [`${MIGRATIONS_DIR}0002_two.sql`]: 'CREATE TABLE u (x INTEGER) STRICT;\n' } },
    { remove: [`${MIGRATIONS_DIR}0001_one.sql`], contents: { [`${MIGRATIONS_DIR}0003_other.sql`]: SYNTH_SQL } },
  ],
  'runtime-authority-confined': [
    { contents: { 'packages/employees/src/worker.ts': "import { claimNext } from '@qandeel-company/storage/runtime-authority';" } },
    { contents: { 'packages/runtime/src/sneaky.ts': "import { txClaimNext } from '@qandeel-company/storage/dist/src/queue.js';" } },
    { contents: { 'packages/domain/src/x.ts': "const q = await import('../../storage/src/queue.js');" } },
    { contents: { 'scripts/drive.mjs': "import { settle } from '@qandeel-company/storage/runtime-authority';" } },
    { contents: { [STORAGE_PKG]: JSON.stringify({ private: true, exports: { '.': {}, './runtime-authority': {}, './testing': { [TEST_CONDITION]: {}, default: null }, './*': {} } }) } },
    { contents: { [STORAGE_PKG]: JSON.stringify({ private: true, exports: { '.': {}, './runtime-authority': {}, './testing': { default: {} } } }) } },
    { contents: { 'packages/runtime/src/admin.ts': "import { armFounderTestSurface } from '@qandeel-company/storage/testing';" } },
    { contents: { 'packages/employees/src/reexport.ts': "export { claimNext } from '@qandeel-company/storage/runtime-authority';" } },
    { contents: { 'packages/employees/src/req.ts': "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);" } },
  ],
  'supervisor-claim-fence-mandatory': [
    { contents: { 'packages/storage/src/queue.ts': SYNTH_QUEUE.replace('readonly supervisor: SupervisorFence', 'readonly supervisor?: SupervisorFence') } },
    { contents: { 'packages/storage/src/queue.ts': SYNTH_QUEUE.replace('readonly supervisor: SupervisorFence', 'readonly supervisor: SupervisorFence | undefined') } },
    { contents: { 'packages/storage/src/queue.ts': SYNTH_QUEUE.replace('  readonly supervisor: SupervisorFence;\n', '') } },
    { contents: { 'packages/storage/src/store.ts': SYNTH_STORE.replace('  wake(id: string)', '  claimNext(options: ClaimOptions): Claim | null {\n    return null;\n  }\n  wake(id: string)') } },
    { contents: { 'packages/storage/src/index.ts': "export * from './runtime-authority.js';\n" } },
  ],
  'no-runtime-store-escape': [
    { contents: { 'packages/runtime/src/runtime.ts': SYNTH_RUNTIME.replace('  get view(): CompanyReadView {', '  get store(): CompanyStore {\n    return this.#ready();\n  }\n  get view(): CompanyReadView {') } },
    { contents: { 'packages/runtime/src/runtime.ts': SYNTH_RUNTIME.replace('  #store: CompanyStore | undefined;', '  readonly store: CompanyStore;') } },
    { contents: { 'packages/runtime/src/runtime.ts': SYNTH_RUNTIME.replace('  #ready(): CompanyStore {', '  unsafeStore(): CompanyStore {') } },
    { contents: { 'packages/c2-approvals/src/open.ts': 'export function companyStore(root: string): CompanyStore {\n  return CompanyStore.open(root);\n}\n' } },
  ],
  'c1-remediation-proofs-present': [
    { remove: ['packages/runtime/test/integration/lost-wake.test.ts'] },
    { contents: { 'packages/storage/test/supervisor-authority.test.ts': '// no marker\n' } },
    { remove: ['packages/storage/test/product-decisions.test.ts'] },
    { contents: { 'packages/storage/test/backup-finalization.test.ts': '// marker removed\n' } },
    { remove: [MUTATION_CHECK] },
    { contents: { 'package.json': JSON.stringify({ private: true, engines: { node: '>=24.11.0 <25.0.0' }, workspaces: ['packages/bootstrap-contract'], scripts: { ci: 'npm run test' } }) } },
  ],
  'c1-proof-tests-present': { remove: ['packages/runtime/test/faults/fault-matrix.test.ts'] },
  'model-calls-confined': [
    { contents: { 'packages/runtime/src/c2/employee-task.ts': 'const out = await adapter.generate(req, signal);' } },
    { contents: { 'packages/storage/src/sneaky.ts': 'provider.generate ({ messages });' } },
  ],
  'founder-surface-test-only': [
    { contents: { 'packages/storage/src/store.ts': "import { founderSurfaceInternals } from './governance.js';" } },
    { contents: { 'packages/governance/src/employee.ts': "export const ACCEPTED = ['founder-attestation:x'];" } },
    { contents: { [CLI_SOURCE]: "switch (command) {\n  case 'approve':\n    break;\n}" } },
    { contents: { [CLI_SOURCE]: "parseArgs({ options: { actor: { type: 'string' } } });" } },
    { contents: { 'packages/storage/src/index.ts': "export { armFounderTestSurface } from './testing/founder-seam.js';\n" } },
  ],
  'tool-drivers-confined': [
    { contents: { 'packages/runtime/src/c2/model-runtime.ts': 'await driver.invoke(input, signal);' } },
    { contents: { 'packages/runtime/src/c2/employee-task.ts': "drivers.get('x')?.invoke(input, s);" } },
  ],
  'budget-mutation-scoped': [
    { contents: { 'packages/runtime/src/cheat.ts': "db.run('UPDATE budgets SET cap_money = 1e15');" } },
    { contents: { 'packages/storage/src/store.ts': 'const q = `INSERT INTO usage_records (id) VALUES (?)`;' } },
    { contents: { 'packages/storage/src/runtime-authority.ts': SYNTH_AUTHORITY.replace('reserveBudget(store: CompanyStore, fence: Fence,', 'reserveBudget(store: CompanyStore,') } },
    { contents: { 'packages/storage/src/index.ts': "export { txReserve } from './governed-writes.js';\n" } },
    { contents: { 'packages/storage/src/governance.ts': 'export class GovernanceStore {\n  reserveBudget(input: ReserveInput): void {}\n}\n' } },
  ],
  'no-plaintext-secrets': [
    { contents: { 'packages/runtime/src/provider.ts': "const key = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';" } },
    { contents: { 'packages/runtime/test/c2/seed.ts': "const pem = '-----BEGIN RSA PRIVATE KEY-----';" } },
    { contents: { [`${MIGRATIONS_DIR}0004_c2.sql`]: 'CREATE TABLE providers (id TEXT, api_key TEXT) STRICT;\n' } },
    { contents: { 'config/ci.yml': 'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789' } },
  ],
  'released-migrations-frozen': [
    // Edited AND re-pinned: migrations-immutable alone would accept this.
    {
      contents: {
        [`${MIGRATIONS_DIR}0002_queue_runs_artifacts.sql`]: `${C1_MIGRATION_TEXT['0002_queue_runs_artifacts.sql']}-- edited\n`,
      },
    },
    { remove: [`${MIGRATIONS_DIR}0003_runtime_wake_generation.sql`] },
    // The C2 migration is canonical too: C3 never edits it.
    { contents: { [`${MIGRATIONS_DIR}0004_c2_governance.sql`]: `${C1_MIGRATION_TEXT['0004_c2_governance.sql']}ALTER TABLE employees ADD COLUMN memory_json TEXT;\n` } },
    // R1-14: the released C3 migrations are canonical too.
    { contents: { [`${MIGRATIONS_DIR}0006_c3_skills_academy.sql`]: `${C1_MIGRATION_TEXT['0006_c3_skills_academy.sql']}-- edited after release\n` } },
    { remove: [`${MIGRATIONS_DIR}0005_c3_memory_context.sql`] },
  ],
  'no-later-scope-leakage': [
    { contents: { [`${MIGRATIONS_DIR}0005_c3.sql`]: `${SYNTH_C3_SQL}CREATE TABLE director_assignments (id TEXT) STRICT;\n` } },
    { contents: { [`${MIGRATIONS_DIR}0004_c2.sql`]: 'CREATE TABLE IF NOT EXISTS review_pool_members (id TEXT) STRICT;\n' } },
    { dirs: ['bootstrap-contract', 'directors'] },
    { dirs: ['bootstrap-contract', 'organization'] },
  ],
  'c2-proofs-present': [
    { contents: { 'packages/runtime/test/c2/proofs.test.ts': '// markers removed\n' } },
    { remove: [C2_MUTATION_CHECK] },
    { contents: { 'package.json': JSON.stringify({ private: true, engines: { node: '>=24.11.0 <25.0.0' }, workspaces: ['packages/bootstrap-contract'], scripts: { ci: 'npm run test && npm run c1:mutation' } }) } },
  ],
  'c2-not-claimed-closed': [
    { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS') } },
    { contents: { [C2_REPORT]: '# Report\n\nC2 — CLOSED.\n' } },
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap('CLOSED / PASS', 'CLOSED / PASS', 'IN PROGRESS')}| \`C3\` | Mem | Cloud | IN PROGRESS |\n` } },
  ],
  'c3-proofs-present': [
    { contents: { 'packages/runtime/test/c3/proofs.test.ts': '// markers removed\n' } },
    { remove: [C3_MUTATION_CHECK] },
    { contents: { 'package.json': JSON.stringify({ private: true, engines: { node: '>=24.11.0 <25.0.0' }, workspaces: ['packages/bootstrap-contract'], scripts: { ci: 'npm run test && npm run c1:mutation && npm run c2:mutation' } }) } },
  ],
  'mutation-checks-pinned': [
    // The whole script replaced by a comment (the R1-15 evidence): exits 0, proves nothing.
    { contents: { [C2_MUTATION_CHECK]: '// C2 mutation check\n' } },
    // A recorded mutation removed (typically together with the gate it proved).
    { contents: { [C3_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[C3_MUTATION_CHECK].ids.filter((id) => id !== 'term-limit-before-filter')) } },
    // The restore / failing exit removed: a mutated dist could leak, or a miss could exit 0.
    { contents: { [MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[MUTATION_CHECK].ids).replace('if (failures) process.exit(1);', 'if (failures) console.log(failures);') } },
    { remove: [MUTATION_CHECK] },
    // An early successful exit (the re-review's bypass): the machinery is present but never runs.
    { contents: { [R1_MUTATION_CHECK]: `process.exit(0);\n${synthMutationScript(MUTATION_PINS[R1_MUTATION_CHECK].ids)}` } },
    { contents: { [R1_MUTATION_CHECK]: `process.exit();\n${synthMutationScript(MUTATION_PINS[R1_MUTATION_CHECK].ids)}` } },
    { contents: { [R1_MUTATION_CHECK]: `if (!process.env.X) { process['exit'](0); }\n${synthMutationScript(MUTATION_PINS[R1_MUTATION_CHECK].ids)}` } },
  ],
  'c3-not-claimed-closed': [
    { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS') } },
    { contents: { [C3_REPORT]: '# Report\n\nC3 — CLOSED.\n' } },
    { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'IN PROGRESS', 'IN PROGRESS') } },
    { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'IN PROGRESS', 'Not started', 'IN PROGRESS') } },
  ],
  'context-assembly-mandatory': [
    { contents: { 'packages/runtime/src/c2/employee-task.ts': "const r = assembleContext(store, fence, { step: 0, recentResults: [] });" } },
    { contents: { [MODEL_RUNTIME]: SYNTH_MODEL_RUNTIME.replace("  if (!isAssembledContext(context)) return { kind: 'CONTEXT', code: 'CONTEXT_NOT_ASSEMBLED' };\n", '') } },
    { contents: { [MODEL_RUNTIME]: SYNTH_MODEL_RUNTIME.replace('messages: context.messages', 'messages: req.messages') } },
    { contents: { [MODEL_RUNTIME]: SYNTH_MODEL_RUNTIME.replace(', contextManifestId: context.manifestId', '') } },
    { contents: { [RUNTIME_TYPES]: SYNTH_TYPES.replace('  readonly step: number;\n', '  readonly messages: readonly ProviderMessage[];\n') } },
    { contents: { [CONTEXT_ASSEMBLER]: SYNTH_ASSEMBLER.replace('MINTED.add(context);\n', '') } },
    { contents: { [RUNTIME_TYPES]: SYNTH_TYPES.replace('  readonly step: number;\n', '  readonly step: number;\n  readonly recentResults: readonly string[];\n') } },
    { contents: { 'packages/runtime/src/c2/employee-task.ts': "recordStepResult(store, fence, step, 'TOOL_RESULT', processorText);" } },
  ],
  'memory-writes-confined': [
    { contents: { 'packages/runtime/src/c3/shortcut.ts': "db.run('INSERT INTO memory_records (id, content) VALUES (?, ?)', id, output);" } },
    { contents: { 'packages/storage/src/store.ts': 'const q = `UPDATE certifications SET status = \'VALID\'`;' } },
    { contents: { 'packages/runtime/src/c2/employee-task.ts': 'submitMemoryCandidate(store, fence, 1, proposal);' } },
    { contents: { 'packages/runtime/src/c2/employee-task.ts': 'mind.memory.recordKnowledge(founder, { content: proposal.content });' } },
    { contents: { [CLI_SOURCE]: "case 'activate':\n  academy.decideActivation(founder, id, { decision: 'APPROVE' });" } },
    { contents: { 'packages/storage/src/index.ts': "export { txSubmitMemoryCandidate } from './mind-writes.js';\n" } },
  ],
  'skill-load-pinned': [
    { contents: { 'packages/storage/src/academy.ts': "const t = loadVerified(ctx, 'skill_versions', id);" } },
    { contents: { 'packages/storage/src/mind-writes.ts': "const r = ctx.db.get('SELECT instructions FROM skill_versions WHERE id = ?', id);" } },
  ],
  'mind-kernel-pure': [
    { contents: { 'packages/mind/src/io.ts': "import { readFileSync } from 'node:fs';" } },
    { contents: { 'packages/mind/src/store.ts': "import { MemoryStore } from '@qandeel-company/storage';" } },
    { contents: { 'packages/mind/src/tool.ts': 'await driver.invoke(input, signal);' } },
  ],
  'mind-telemetry-content-free': [
    { contents: { 'packages/storage/src/memory.ts': "appendAudit(ctx, 'memory.corrected', 'memory', id, a, 'OK', null, { content: input.correctedContent });" } },
    { contents: { 'packages/runtime/src/c3/memory-proposals.ts': "this.log.info('memory.proposed', { topic, content });" } },
  ],
  'activation-gate-present': [
    // The synthetic repository carries the real (frozen) 0006, which holds the gate: drop it as well.
    { contents: { [`${MIGRATIONS_DIR}0005_c3.sql`]: 'CREATE TABLE memory_records (id TEXT) STRICT;\n' }, remove: [`${MIGRATIONS_DIR}0006_c3_skills_academy.sql`] },
    { contents: { 'packages/storage/src/academy.ts': "setEmployeeState(ctx, e, 'ACTIVE', 'CERTIFIED', ref, [`test-seam:${id}`]);" } },
  ],
  'local-core-longpaths': { longpaths: undefined },
};

// Legitimate future states that each rule must accept (stage-awareness, not a frozen snapshot).
const MUST_PASS = [
  // The proofs may be renamed or moved: the marker is what counts.
  {
    id: 'c1-remediation-proofs-present',
    scenario: {
      remove: ['packages/runtime/test/integration/lost-wake.test.ts'],
      contents: { 'packages/runtime/test/wake/missed-hints.test.ts': `// ${C1_PROOF_MARKERS[1]}\n` },
    },
  },
  // ClaimOptions may move to another storage module; runtime tests may spawn storage fixtures by path.
  { id: 'supervisor-claim-fence-mandatory', scenario: { remove: ['packages/storage/src/queue.ts'], contents: { 'packages/storage/src/claims.ts': SYNTH_QUEUE } } },
  { id: 'runtime-authority-confined', scenario: { contents: { 'packages/runtime/test/x.test.ts': "import { claimNext } from '@qandeel-company/storage/runtime-authority';\nconst f = new URL('../../storage/dist/test/fixtures/locker.js', import.meta.url);" } } },
  // Private members and read-only views are legitimate; so is a storage-typed parameter.
  { id: 'no-runtime-store-escape', scenario: { contents: { 'packages/runtime/src/recovery.ts': 'export function runRecovery(store: CompanyStore, fence: SupervisorFence): Summary {\n  return summarize(store);\n}\n' } } },
  { id: 'implementation-lifecycle-state', scenario: { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / PASS'), 'docs/C1_COMPANY_FOUNDATION_CLOSURE.md': '' } } },
  // C1 as an implementation candidate, explicitly not closed, with an honest report.
  { id: 'implementation-lifecycle-state', scenario: { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'IMPLEMENTATION CANDIDATE / IN INDEPENDENT REVIEW — NOT CLOSED'), [C1_REPORT]: '# Report\n\nC1 is NOT CLOSED.\n' } } },
  // After C1 closes, C2 may start and its own package may be added in the same change.
  { id: 'implementation-lifecycle-state', scenario: { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / PASS', 'IN PROGRESS'), 'docs/C1_CLOSURE.md': '' } } },
  // A future migration appended with its pin is accepted.
  {
    id: 'migrations-immutable',
    scenario: {
      contents: {
        [`${MIGRATIONS_DIR}0002_two.sql`]: 'CREATE TABLE u (x INTEGER) STRICT;\n',
        [MIGRATIONS_REGISTRY]: `${synthRegistry()}// later\nconst next = { version: 2, name: 'two', file: '0002_two.sql', sha256: '${migrationSha('CREATE TABLE u (x INTEGER) STRICT;\n')}' };\n`,
      },
    },
  },
  { id: 'workspace-tests-present', scenario: { contents: { 'packages/bootstrap-contract/package.json': JSON.stringify({ private: true, scripts: { test: 'npm run build && node ../../scripts/run-node-tests.mjs' } }) } } },
  // A C2 candidate that is explicitly not closed; C2 closed together with its record.
  { id: 'c2-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / MERGED / CANONICAL', 'IN PROGRESS — implementation candidate, not closed'), [C2_REPORT]: '# Report\n\nC2 is NOT CLOSED.\n' } } },
  { id: 'c2-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS'), 'docs/C2_CLOSURE_RECORD.md': '' } } },
  // A mutation script may grow: a new mutation added next to the recorded ones is accepted.
  { id: 'mutation-checks-pinned', scenario: { contents: { [C3_MUTATION_CHECK]: synthMutationScript([...MUTATION_PINS[C3_MUTATION_CHECK].ids, 'a-new-gate-removed']) } } },
  // CRLF checkouts of the frozen canonical migrations are the same content.
  { id: 'released-migrations-frozen', scenario: { contents: { [`${MIGRATIONS_DIR}0001_work_foundation.sql`]: C1_MIGRATION_TEXT['0001_work_foundation.sql'].replace(/\n/g, '\r\n') } } },
  // Tests (and the acceptance harness) may import the test-only Founder seam.
  { id: 'runtime-authority-confined', scenario: { contents: { 'packages/runtime/test/c2/seed.ts': "import { armFounderTestSurface } from '@qandeel-company/storage/testing';", 'scripts/c2-acceptance.mjs': "await import('@qandeel-company/storage/testing');" } } },
  // Tests may call adapters and drivers directly (fakes); only production src is confined.
  { id: 'model-calls-confined', scenario: { contents: { 'packages/runtime/test/c2/fake.test.ts': 'await provider.generate(req, signal); await driver.invoke(x, s);' } } },
  // C3 owns Memory / Skills / Academy / certification schema and the `mind` package (not later-scope leakage).
  { id: 'no-later-scope-leakage', scenario: { contents: { [`${MIGRATIONS_DIR}0005_c3.sql`]: `${SYNTH_C3_SQL}CREATE TABLE academy_enrollments (id TEXT) STRICT;\nCREATE TABLE certifications (id TEXT) STRICT;\nCREATE TABLE knowledge_items (id TEXT) STRICT;\n` }, dirs: ['bootstrap-contract', 'mind'] } },
  // C3 as a cloud implementation candidate, explicitly not closed, R1 / C4 not started; later, C3 closed with its record.
  { id: 'c3-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'IN PROGRESS — Cloud implementation candidate, NOT CLOSED', 'Not started', 'Not started'), [C3_REPORT]: '# Report\n\nC3 is NOT CLOSED.\n' } } },
  { id: 'c3-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'IN PROGRESS'), 'docs/C3_CLOSURE_RECORD.md': '' } } },
  // Tests may exercise the assembly and write fixtures directly; the kernel may import the domain / governance kernels.
  { id: 'memory-writes-confined', scenario: { contents: { 'packages/storage/test/c3.test.ts': "db.run('UPDATE memory_records SET content = ? WHERE id = ?', x, id);", 'packages/runtime/test/c3/x.test.ts': 'rt.mind.academy.decideActivation(founder, id, input);' } } },
  { id: 'mind-kernel-pure', scenario: { contents: { 'packages/mind/src/academy.ts': "import { QandeelError } from '@qandeel-company/domain';\nimport { maxDataClass } from '@qandeel-company/governance';" } } },
  // A size probe of a payload is not a payload read; a comment naming the seam label is not code.
  { id: 'skill-load-pinned', scenario: { contents: { 'packages/storage/src/mind-writes.ts': "ctx.db.get('SELECT length(CAST(instructions AS BLOB)) AS b FROM skill_versions WHERE id = ?', id);" } } },
  { id: 'activation-gate-present', scenario: { contents: { 'packages/governance/src/employee.ts': ' * certification it cannot verify. `test-seam:` marks the test-only seam label.\n' } } },
  // Content hashes and counts in telemetry are fine; only content itself is refused.
  { id: 'mind-telemetry-content-free', scenario: { contents: { 'packages/storage/src/memory.ts': "appendAudit(ctx, 'memory.stored', 'memory', id, a, 'OK', null, { contentSha256: sha, bytes: n });" } } },
  // Windows checkouts with CRLF do not trip the migration pin.
  { id: 'migrations-immutable', scenario: { contents: { [`${MIGRATIONS_DIR}0001_one.sql`]: SYNTH_SQL.replace(/\n/g, '\r\n') } } },
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
  // C1 packages resolve by name, and the storage entry point exposes no SQL surface.
  const storage = await import('@qandeel-company/storage');
  for (const leaked of ['SqliteConnection', 'storeContext', 'migrate', 'translateError']) {
    if (leaked in storage) problems.push(`@qandeel-company/storage exports ${leaked}: the SQLite adapter must stay internal`);
  }
  for (const leaked of AUTHORITY_METHODS) {
    if (leaked in storage) problems.push(`@qandeel-company/storage exports ${leaked}: runtime authority must stay behind ${AUTHORITY_SUBPATH}`);
    if (leaked in storage.CompanyStore.prototype) problems.push(`CompanyStore offers ${leaked}() on the ordinary API`);
  }
  const authority = await import(AUTHORITY_SUBPATH);
  if (typeof authority.claimNext !== 'function') problems.push(`${AUTHORITY_SUBPATH} does not resolve to the runtime-authority module`);
  const runtime = await import('@qandeel-company/runtime');
  if (typeof runtime.CompanyRuntime !== 'function') problems.push('@qandeel-company/runtime does not export CompanyRuntime');
  if ('store' in runtime.CompanyRuntime.prototype) problems.push('CompanyRuntime exposes a store accessor (only the read-only view is allowed)');
  if ('runRecovery' in runtime) problems.push('@qandeel-company/runtime exports runRecovery: recovery writes belong to the Runtime Supervisor alone');
  try {
    await import('@qandeel-company/storage/dist/src/sqlite/connection.js');
    problems.push('deep import of the SQLite adapter is possible; the exports map must forbid it');
  } catch {
    // expected: ERR_PACKAGE_PATH_NOT_EXPORTED
  }
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
    resolutionProblems = [`cannot import the workspace packages (run "npm run build" first): ${error.message}`];
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
